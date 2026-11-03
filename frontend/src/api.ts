import { readEvents } from "./sse";
import type { ChatEvent, Customer, Order } from "./types";

export class UnauthorizedError extends Error {}

async function getJson<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function listDemoCustomers(): Promise<Customer[]> {
  const response = await fetch("/api/order/v1/dev/customers");
  return (await getJson<{ customers: Customer[] }>(response)).customers;
}

export async function login(customerId: string): Promise<{ token: string; customer: Customer }> {
  const response = await fetch("/api/order/v1/dev/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer_id: customerId }),
  });
  return getJson(response);
}

export async function listOrders(token: string): Promise<Order[]> {
  const response = await fetch("/api/order/v1/orders", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await getJson<{ orders: Order[] }>(response)).orders;
}

export async function* streamChat(
  token: string,
  conversationId: string,
  message: string,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const response = await fetch("/api/agent/v1/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, message }),
    signal,
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok || !response.body) throw new Error(`chat failed: ${response.status}`);
  yield* readEvents(response.body);
}
