import { readEvents } from "./sse";
import type { ChatEvent } from "./types";

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of readEvents(stream)) events.push(event);
  return events;
}

const encode = (text: string) => new TextEncoder().encode(text);
const TOKEN = 'event: token\r\ndata: {"text": "Kargoğ"}\r\n\r\n';
const DONE = 'event: done\r\ndata: {"usage": {"input_tokens": 1, "output_tokens": 2}}\r\n\r\n';

test("reads CRLF-separated events from one chunk", async () => {
  expect(await collect(streamOf(encode(TOKEN + DONE)))).toEqual([
    { event: "token", data: { text: "Kargoğ" } },
    { event: "done", data: { usage: { input_tokens: 1, output_tokens: 2 } } },
  ]);
});

test("reads LF-separated events", async () => {
  const body = 'event: token\ndata: {"text": "a"}\n\n';
  expect(await collect(streamOf(encode(body)))).toEqual([{ event: "token", data: { text: "a" } }]);
});

test("gives the same result wherever the chunks are cut", async () => {
  const bytes = encode(TOKEN + DONE);
  const expected = await collect(streamOf(bytes));
  for (let cut = 1; cut < bytes.length; cut++) {
    const events = await collect(streamOf(bytes.slice(0, cut), bytes.slice(cut)));
    expect(events).toEqual(expected);
  }
});

test("skips keep-alive comments", async () => {
  const events = await collect(streamOf(encode(`: ping\r\n\r\n${TOKEN}`)));
  expect(events).toHaveLength(1);
});
