import { chatReducer, initialChatState, type ChatAction, type ChatState } from "./chatReducer";
import type { ChatEvent, Order, Shipment } from "./types";

const ORDER: Order = {
  id: "DA-100001",
  status: "delivered",
  total_kurus: 239700,
  placed_at: "2026-10-20T10:00:00Z",
  delivered_at: "2026-10-23T10:00:00Z",
  return_id: null,
  return_status: null,
  carrier: null,
  tracking_number: null,
  items: [{ product_name: "Kulaklık", quantity: 1, unit_price_kurus: 239700, image_key: null }],
};

const SHIPMENT: Shipment = {
  order_id: "DA-100002",
  carrier: "Yelken Kargo",
  tracking_number: "AR123",
  status: "in_transit",
  estimated_delivery: "2026-11-04",
  events: [],
};

function run(...events: ChatEvent[]): ChatState {
  const actions: ChatAction[] = [
    { type: "send", text: "Selam" },
    ...events.map((event, index): ChatAction => ({ type: "event", event, at: index * 100 })),
  ];
  return actions.reduce(chatReducer, initialChatState);
}

const lastMessage = (state: ChatState) => state.messages[state.messages.length - 1];

function toolCall(name: string): ChatEvent {
  return { event: "tool_call", data: { name, args: {} } };
}

function toolResult(name: string, result: object): ChatEvent {
  return { event: "tool_result", data: { name, result: result as Record<string, unknown> } };
}

const DONE: ChatEvent = { event: "done", data: { usage: { input_tokens: 3, output_tokens: 4 } } };

test("send adds the customer message and an empty reply", () => {
  const state = run();
  expect(state.streaming).toBe(true);
  expect(state.messages.map((m) => [m.role, m.text])).toEqual([
    ["user", "Selam"],
    ["assistant", ""],
  ]);
});

test("tokens build up the reply and done ends the stream", () => {
  const state = run(
    { event: "token", data: { text: "Mer" } },
    { event: "token", data: { text: "haba" } },
    DONE,
  );
  expect(lastMessage(state).text).toBe("Merhaba");
  expect(state.streaming).toBe(false);
  expect(state.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
});

test("usage adds up across messages", () => {
  const first = run(DONE);
  const second = [
    { type: "send", text: "Bir daha" },
    { type: "event", event: DONE, at: 0 },
  ] satisfies ChatAction[];
  expect(second.reduce(chatReducer, first).usage).toEqual({ input_tokens: 6, output_tokens: 8 });
});

test("a tool result completes its trace entry with the duration", () => {
  const state = run(toolCall("list_my_orders"), toolResult("list_my_orders", { orders: [] }));
  expect(state.trace).toHaveLength(1);
  expect(state.trace[0].result).toEqual({ orders: [] });
  expect(state.trace[0].durationMs).toBe(100);
});

test("tools produce the matching cards", () => {
  const state = run(
    toolCall("get_order_status"),
    toolResult("get_order_status", ORDER),
    toolCall("track_shipment"),
    toolResult("track_shipment", SHIPMENT),
  );
  expect(lastMessage(state).cards.map((card) => card.kind)).toEqual(["order", "shipment"]);
});

test("a failed tool shows in the trace but produces no card", () => {
  const state = run(
    toolCall("get_order_status"),
    toolResult("get_order_status", { error: "order_not_found", message: "order not found" }),
  );
  expect(lastMessage(state).cards).toEqual([]);
  expect(state.trace[0].result).toHaveProperty("error");
});

test("a repeated tool call replaces its card", () => {
  const state = run(
    toolCall("get_order_status"),
    toolResult("get_order_status", ORDER),
    toolCall("get_order_status"),
    toolResult("get_order_status", ORDER),
  );
  expect(lastMessage(state).cards).toHaveLength(1);
});

test("list_my_orders produces no card, because the side panel already shows orders", () => {
  const state = run(toolCall("list_my_orders"), toolResult("list_my_orders", { orders: [ORDER] }));
  expect(lastMessage(state).cards).toEqual([]);
});

test("an error event ends the stream and keeps the partial text", () => {
  const state = run(
    { event: "token", data: { text: "Sipariş" } },
    { event: "error", data: { message: "Bir sorun oluştu." } },
  );
  expect(state.streaming).toBe(false);
  expect(lastMessage(state).error).toBe(true);
  expect(lastMessage(state).text).toBe("Sipariş\n\nBir sorun oluştu.");
});

test("a handoff event stores the summary", () => {
  const state = run({ event: "handoff", data: { summary: "Müşteri iade istiyor" } });
  expect(state.handoffSummary).toBe("Müşteri iade istiyor");
});

test("reset clears the conversation", () => {
  expect(chatReducer(run(DONE), { type: "reset" })).toEqual(initialChatState);
});
