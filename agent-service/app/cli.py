"""Terminal chat over the real SSE endpoint.

Usage: python -m app.cli --customer CUS-1001 [--message "Siparişlerim nerede?"]
"""

import argparse
import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator

import httpx

from app.auth import issue_dev_token


async def read_events(response: httpx.Response) -> AsyncIterator[tuple[str, dict]]:
    event = "message"
    async for line in response.aiter_lines():
        if line.startswith("event:"):
            event = line.removeprefix("event:").strip()
        elif line.startswith("data:"):
            yield event, json.loads(line.removeprefix("data:"))


def render(event: str, data: dict) -> None:
    if event == "token":
        print(data["text"], end="", flush=True)
    elif event == "tool_call":
        print(f"\n  [tool] {data['name']}({json.dumps(data['args'], ensure_ascii=False)})")
    elif event == "tool_result":
        result = json.dumps(data["result"], ensure_ascii=False)
        print(f"  [result] {result[:200]}")
    elif event == "error":
        print(f"\n[error] {data['message']}")
    elif event == "done":
        usage = data["usage"]
        print(f"\n  [tokens] in={usage['input_tokens']} out={usage['output_tokens']}")


async def send(http: httpx.AsyncClient, conversation_id: str, message: str) -> None:
    body = {"conversation_id": conversation_id, "message": message}
    async with http.stream("POST", "/v1/chat", json=body) as response:
        if response.is_error:
            print(f"[http {response.status_code}]")
            return
        async for event, data in read_events(response):
            render(event, data)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--customer", default="CUS-1001")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--message", help="send one message and exit")
    args = parser.parse_args()

    token = issue_dev_token(os.environ["JWT_SECRET"], args.customer)
    conversation_id = str(uuid.uuid4())
    headers = {"Authorization": f"Bearer {token}"}
    timeout = httpx.Timeout(10.0, read=120.0)

    async with httpx.AsyncClient(base_url=args.url, headers=headers, timeout=timeout) as http:
        if args.message:
            await send(http, conversation_id, args.message)
            return
        print(f"{args.customer} olarak bağlandınız. Çıkmak için Ctrl+C.")
        while True:
            message = input("\nSiz: ").strip()
            if message:
                await send(http, conversation_id, message)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, EOFError):
        pass
