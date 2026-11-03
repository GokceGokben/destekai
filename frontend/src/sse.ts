import type { ChatEvent } from "./types";

// sse-starlette separates events with CRLF; the spec also allows bare LF.
const EVENT_SEPARATOR = /\r?\n\r?\n/;

function parseEvent(block: string): ChatEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trim());
    }
  }
  // Keep-alive comments have no data.
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join("\n")) } as ChatEvent;
}

/** Network chunks do not follow event boundaries, so complete events are cut from a buffer. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  // stream: true keeps a Turkish letter intact when a chunk ends between its two bytes.
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split(EVENT_SEPARATOR);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseEvent(block);
        if (event) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
