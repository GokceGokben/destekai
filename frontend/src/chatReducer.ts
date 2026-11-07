import type { ChatEvent, Order, ReturnRequest, Shipment, ToolResult, Usage } from "./types";

export type Card =
  | { kind: "order"; order: Order }
  | { kind: "shipment"; shipment: Shipment }
  | { kind: "return"; request: ReturnRequest };

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  cards: Card[];
  error: boolean;
  time?: string;
}

interface TraceEntry {
  id: number;
  name: string;
  args: Record<string, unknown>;
  result: ToolResult | null;
  startedAt: number;
  durationMs: number | null;
}

export interface ChatState {
  messages: ChatMessage[];
  trace: TraceEntry[];
  streaming: boolean;
  usage: Usage;
  handoffSummary: string | null;
}

export type ChatAction =
  | { type: "send"; text: string; time?: string }
  // The timestamp is passed in because a reducer has to stay pure.
  | { type: "event"; event: ChatEvent; at: number }
  | { type: "failed"; message: string }
  | { type: "reset" };

export const initialChatState: ChatState = {
  messages: [],
  trace: [],
  streaming: false,
  usage: { input_tokens: 0, output_tokens: 0 },
  handoffSummary: null,
};

function cardFrom(name: string, result: ToolResult): Card | null {
  if ("error" in result) return null;
  switch (name) {
    case "get_order_status":
      return { kind: "order", order: result as unknown as Order };
    case "track_shipment":
      return { kind: "shipment", shipment: result as unknown as Shipment };
    case "create_return_request":
      return { kind: "return", request: result as unknown as ReturnRequest };
    default:
      return null;
  }
}

function cardKey(card: Card): string {
  switch (card.kind) {
    case "order":
      return `order:${card.order.id}`;
    case "shipment":
      return `shipment:${card.shipment.order_id}`;
    case "return":
      return `return:${card.request.id}`;
  }
}

function updateLastMessage(
  state: ChatState,
  update: (message: ChatMessage) => ChatMessage,
): ChatState {
  const last = state.messages[state.messages.length - 1];
  return { ...state, messages: [...state.messages.slice(0, -1), update(last)] };
}

function addCard(state: ChatState, card: Card): ChatState {
  // A model that repeats a tool call replaces its card instead of stacking a copy.
  return updateLastMessage(state, (message) => ({
    ...message,
    cards: [...message.cards.filter((c) => cardKey(c) !== cardKey(card)), card],
  }));
}

function applyEvent(state: ChatState, event: ChatEvent, at: number): ChatState {
  switch (event.event) {
    case "token":
      return updateLastMessage(state, (message) => ({
        ...message,
        text: message.text + event.data.text,
      }));
    case "tool_call":
      return {
        ...state,
        trace: [
          ...state.trace,
          {
            id: state.trace.length,
            name: event.data.name,
            args: event.data.args,
            result: null,
            startedAt: at,
            durationMs: null,
          },
        ],
      };
    case "tool_result": {
      // The agent runs tools one at a time, so a result belongs to the newest call.
      const trace = state.trace.map((entry, index) =>
        index === state.trace.length - 1
          ? { ...entry, result: event.data.result, durationMs: at - entry.startedAt }
          : entry,
      );
      const card = cardFrom(event.data.name, event.data.result);
      return card ? addCard({ ...state, trace }, card) : { ...state, trace };
    }
    case "handoff":
      return { ...state, handoffSummary: event.data.summary };
    case "done":
      return {
        ...state,
        streaming: false,
        usage: {
          input_tokens: state.usage.input_tokens + event.data.usage.input_tokens,
          output_tokens: state.usage.output_tokens + event.data.usage.output_tokens,
        },
      };
    case "error":
      return failed(state, event.data.message);
    // Nothing to show the customer; the agent logs them.
    case "guardrail":
    case "grounding_violation":
      return state;
    // A newer agent may send events this version does not know; they must not wipe the chat.
    default:
      return state;
  }
}

function failed(state: ChatState, message: string): ChatState {
  return {
    ...updateLastMessage(state, (last) => ({
      ...last,
      text: last.text ? `${last.text}\n\n${message}` : message,
      error: true,
    })),
    streaming: false,
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      const id = state.messages.length;
      return {
        ...state,
        streaming: true,
        messages: [
          ...state.messages,
          { id, role: "user", text: action.text, cards: [], error: false, time: action.time },
          {
            id: id + 1,
            role: "assistant",
            text: "",
            cards: [],
            error: false,
            time: action.time,
          },
        ],
      };
    }
    case "event":
      return applyEvent(state, action.event, action.at);
    case "failed":
      return failed(state, action.message);
    case "reset":
      return initialChatState;
  }
}
