// Mirrors the JSON of order-api and the SSE events of agent-service.

export interface Admin {
  id: string;
  full_name: string;
  email: string;
}

export interface Customer {
  id: string;
  full_name: string;
  email: string;
  city: string;
  tier: "vip" | "standard" | "new";
  loyalty_points: number;
  member_years: number;
  order_count: number;
}

export interface OrderItem {
  product_name: string;
  quantity: number;
  unit_price_kurus: number;
  image_key: string | null;
}

export interface Order {
  id: string;
  status: "preparing" | "shipped" | "delivered" | "cancelled";
  total_kurus: number;
  placed_at: string;
  delivered_at: string | null;
  return_id: string | null;
  return_status: "requested" | "approved" | "refunded" | null;
  carrier: string | null;
  tracking_number: string | null;
  /** The shipment's estimate, or for an order still being prepared the shipping policy's
   * latest date; null for a cancelled order. */
  estimated_delivery: string | null;
  items: OrderItem[];
}

interface ShipmentEvent {
  status: string;
  location: string;
  description: string;
  occurred_at: string;
}

export interface Shipment {
  order_id: string;
  carrier: string;
  tracking_number: string;
  status: "label_created" | "in_transit" | "out_for_delivery" | "delivered";
  estimated_delivery: string;
  events: ShipmentEvent[];
}

export interface ReturnRequest {
  id: string;
  order_id: string;
  reason: string;
  status: "requested" | "approved" | "rejected" | "refunded";
  created_at: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export type ToolResult = Record<string, unknown>;

export type ChatEvent =
  | { event: "token"; data: { text: string } }
  | { event: "tool_call"; data: { name: string; args: Record<string, unknown> } }
  | { event: "tool_result"; data: { name: string; result: ToolResult } }
  | { event: "handoff"; data: { reason: string; summary: string } }
  // A message blocked as prompt injection; the refusal itself arrives as tokens.
  | { event: "guardrail"; data: { kind: string } }
  // The reply named an order or tracking number no tool returned. Logged by the agent.
  | { event: "grounding_violation"; data: { references: string[] } }
  | { event: "done"; data: { usage: Usage } }
  | { event: "error"; data: { message: string } };
