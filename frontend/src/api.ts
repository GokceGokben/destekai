import { readEvents } from "./sse";
import type { Admin, ChatEvent, Customer, Order, Shipment } from "./types";

export class UnauthorizedError extends Error {}

/** The agent refuses more messages for a while: too many were sent too fast. */
export class RateLimitedError extends Error {}

/** A refused request, with the order API's error code, e.g. "invalid_credentials". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { code?: string };
    throw new ApiError(response.status, error.code ?? "request_failed");
  }
  return response.json() as Promise<T>;
}

export function passwordLogin(email: string, password: string) {
  return postJson<{ token: string; customer: Customer }>("/api/order/v1/auth/login", {
    email,
    password,
  });
}

export function adminLogin(email: string, password: string) {
  return postJson<{ token: string; admin: Admin }>("/api/order/v1/admin/login", {
    email,
    password,
  });
}

export async function listAdminCustomers(token: string): Promise<Customer[]> {
  const response = await fetch("/api/order/v1/admin/customers", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await getJson<{ customers: Customer[] }>(response)).customers;
}

/** A 15-minute read-only token for one customer. The order API records the view. */
export function openCustomerView(adminToken: string, customerId: string) {
  return postJson<{ token: string; customer: Customer }>(
    `/api/order/v1/admin/customers/${customerId}/view-token`,
    {},
    adminToken,
  );
}

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

/** The order API answers 404 for an order that is not the caller's, as for one that is missing. */
export async function getShipment(token: string, orderId: string): Promise<Shipment> {
  const response = await fetch(`/api/order/v1/orders/${orderId}/shipment`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return getJson<Shipment>(response);
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
  if (response.status === 429) throw new RateLimitedError();
  if (!response.ok || !response.body) throw new Error(`chat failed: ${response.status}`);
  yield* readEvents(response.body);
}
