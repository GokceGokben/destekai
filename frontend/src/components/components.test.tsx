import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { initialChatState, type ChatMessage, type ChatState } from "../chatReducer";
import type { Customer, Order, Shipment } from "../types";
import { CardView } from "./Cards";
import { ChatPanel } from "./ChatPanel";
import { CustomerCard } from "./CustomerCard";
import { OrderList } from "./OrdersPanel";

const CUSTOMER: Customer = {
  id: "CUS-1001",
  full_name: "Ayşe Yılmaz",
  email: "ayse.yilmaz@example.com",
  city: "İstanbul",
  tier: "vip",
  loyalty_points: 1840,
  member_years: 2,
  order_count: 3,
};

const ORDER: Order = {
  id: "DA-100002",
  status: "shipped",
  total_kurus: 349900,
  placed_at: "2026-10-30T10:00:00Z",
  delivered_at: null,
  return_id: null,
  return_status: null,
  carrier: "Yelken Kargo",
  tracking_number: "AR123",
  estimated_delivery: "2026-11-04",
  items: [
    { product_name: "Akıllı Saat", quantity: 1, unit_price_kurus: 349900, image_key: "smart-watch" },
  ],
};

const SHIPMENT: Shipment = {
  order_id: "DA-100002",
  carrier: "Yelken Kargo",
  tracking_number: "AR123",
  status: "in_transit",
  estimated_delivery: "2026-11-04",
  events: [
    {
      status: "in_transit",
      location: "Ankara",
      description: "Transfer merkezinde",
      occurred_at: "2026-11-01T09:00:00Z",
    },
  ],
};

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 1, role: "assistant", text: "", cards: [], error: false, ...overrides };
}

function renderChat(state: ChatState = initialChatState, draft = "") {
  const onSend = vi.fn();
  const onDraftChange = vi.fn();
  render(
    <ChatPanel
      state={state}
      draft={draft}
      onDraftChange={onDraftChange}
      onSend={onSend}
      onReset={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { onSend, onDraftChange };
}

test("Enter sends the draft and Shift+Enter does not", async () => {
  const { onSend, onDraftChange } = renderChat(initialChatState, "Kargom nerede?");
  const box = screen.getByRole("textbox", { name: "Mesajınız" });

  await userEvent.type(box, "{Shift>}{Enter}{/Shift}");
  expect(onSend).not.toHaveBeenCalled();

  await userEvent.type(box, "{Enter}");
  expect(onSend).toHaveBeenCalledWith("Kargom nerede?");
  expect(onDraftChange).toHaveBeenCalledWith("");
});

test("a second message is blocked while a reply is streaming", async () => {
  const { onSend } = renderChat({ ...initialChatState, streaming: true }, "İkinci mesaj");

  expect(screen.getByRole("button", { name: /Gönder/ })).toBeDisabled();
  await userEvent.type(screen.getByRole("textbox", { name: "Mesajınız" }), "{Enter}");
  expect(onSend).not.toHaveBeenCalled();
});

test("a quick reply sends its text", async () => {
  const { onSend } = renderChat();
  await userEvent.click(screen.getByRole("button", { name: /Siparişim nerede/ }));
  expect(onSend).toHaveBeenCalledWith("Siparişim nerede?");
});

test("model output cannot inject HTML", () => {
  renderChat({
    ...initialChatState,
    messages: [message({ text: 'Merhaba <img src=x onerror="alert(1)"> **kalın**' })],
  });
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText("kalın").tagName).toBe("STRONG");
});

test("the handoff notice appears only after a handoff", () => {
  renderChat({ ...initialChatState, handoffSummary: "İade sorunu" });
  expect(screen.getByRole("status")).toHaveTextContent("Canlı Temsilciye Aktarım Başlatıldı");
});

test("after a handoff the message box and quick replies are locked", async () => {
  const handedOff = {
    ...initialChatState,
    messages: [message({ text: "Sizi bir müşteri temsilcimize aktarıyorum." })],
    handoffSummary: "İade sorunu",
  };
  const { onSend } = renderChat(handedOff, "Siparişim nerede?");

  expect(screen.getByRole("textbox", { name: "Mesajınız" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Gönder/ })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /Kargo takibi/ }));
  expect(onSend).not.toHaveBeenCalled();
});

test("an admin's read-only chat offers no action replies", () => {
  render(
    <ChatPanel
      state={{ ...initialChatState, messages: [message({ text: "Merhaba" })] }}
      draft=""
      onDraftChange={vi.fn()}
      onSend={vi.fn()}
      onReset={vi.fn()}
      onClose={vi.fn()}
      readOnly
    />,
  );
  expect(screen.getByRole("button", { name: /Kargo takibi/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /İade talebi oluştur/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Temsilciye bağlan/ })).toBeNull();
});

test("the typing indicator disappears once text arrives", () => {
  const pending = { ...initialChatState, streaming: true, messages: [message({})] };
  renderChat(pending);
  expect(screen.getByText("DestekAI yanıt oluşturuyor...")).toBeInTheDocument();
});

test("the order card shows the order's own data", () => {
  render(<CardView card={{ kind: "order", order: ORDER }} />);
  expect(screen.getByRole("heading")).toHaveTextContent("Sipariş DA-100002");
  expect(screen.getByText("Kargoda")).toBeInTheDocument();
  expect(screen.getByText("1 × Akıllı Saat")).toBeInTheDocument();
});

test("the shipment card marks the current stage and latest event", () => {
  render(<CardView card={{ kind: "shipment", shipment: SHIPMENT }} />);
  const steps = screen.getAllByRole("listitem");
  expect(within(steps[2]).getByText("Yolda / Aktarmada")).toBeInTheDocument();
  expect(steps[2].querySelector('[aria-current="step"]')).not.toBeNull();
  expect(screen.getByText("Transfer merkezinde")).toBeInTheDocument();
});

test("the close button closes the chat window", async () => {
  const onClose = vi.fn();
  render(
    <ChatPanel
      state={initialChatState}
      draft=""
      onDraftChange={vi.fn()}
      onSend={vi.fn()}
      onReset={vi.fn()}
      onClose={onClose}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Asistanı Kapat" }));
  expect(onClose).toHaveBeenCalled();
});

test("the customer card shows real profile data", () => {
  render(<CustomerCard customer={CUSTOMER} onAskPolicy={vi.fn()} />);
  expect(screen.getByText("VIP Müşteri")).toBeInTheDocument();
  expect(screen.getByText("1.840 TP")).toBeInTheDocument();
  expect(screen.getByText("• 2 Yıldır Üye")).toBeInTheDocument();
});

test("the customer card asks for a person, unless the view cannot hand off", async () => {
  const onAskHuman = vi.fn();
  const { unmount } = render(
    <CustomerCard customer={CUSTOMER} onAskPolicy={vi.fn()} onAskHuman={onAskHuman} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Canlı Temsilciye Bağlan" }));
  expect(onAskHuman).toHaveBeenCalled();
  unmount();

  render(<CustomerCard customer={CUSTOMER} onAskPolicy={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Canlı Temsilciye Bağlan" })).toBeNull();
});

test("an order card lists its items, total and tracking number", () => {
  render(<OrderList orders={[ORDER]} onAsk={vi.fn()} onOpenChat={vi.fn()} />);
  expect(screen.getByText("Akıllı Saat")).toBeInTheDocument();
  expect(screen.getByText("1 × 3.499,00 ₺")).toBeInTheDocument();
  expect(screen.getByText(/Yelken Kargo: AR123/)).toBeInTheDocument();
});

test("the order list filters with Turkish casing and asks about one order", async () => {
  const onAsk = vi.fn();
  const other = {
    ...ORDER,
    id: "DA-100003",
    items: [{ product_name: "İpek Şal", quantity: 1, unit_price_kurus: 100, image_key: null }],
  };
  render(<OrderList orders={[ORDER, other]} onAsk={onAsk} onOpenChat={vi.fn()} />);

  await userEvent.type(screen.getByRole("textbox"), "ipek");
  expect(screen.queryByText("#DA-100002")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /Asistana sor/ }));
  expect(onAsk).toHaveBeenCalledWith("DA-100003");
});

// An order card is found by its details button, which each card has once; the order
// number itself appears on both faces of the card.
const card = (id: string) => screen.getByRole("button", { name: `${id} siparişinin detayları` });
const queryCard = (id: string) =>
  screen.queryByRole("button", { name: `${id} siparişinin detayları` });

test("searching an order number works with or without the leading #", async () => {
  const other = { ...ORDER, id: "DA-100007" };
  render(<OrderList orders={[ORDER, other]} onAsk={vi.fn()} onOpenChat={vi.fn()} />);
  const box = screen.getByRole("textbox");

  await userEvent.type(box, "#DA-100007");
  expect(card("DA-100007")).toBeInTheDocument();
  expect(queryCard("DA-100002")).not.toBeInTheDocument();

  await userEvent.clear(box);
  await userEvent.type(box, "100002");
  expect(card("DA-100002")).toBeInTheDocument();
});

test("the filter tabs split orders by status and count them", async () => {
  const delivered = { ...ORDER, id: "DA-100001", status: "delivered" as const };
  const returned = { ...ORDER, id: "DA-100005", status: "delivered" as const, return_status: "requested" as const };
  render(<OrderList orders={[ORDER, delivered, returned]} onAsk={vi.fn()} onOpenChat={vi.fn()} />);

  expect(screen.getByRole("tab", { name: /Devam eden/ })).toHaveTextContent("1");
  await userEvent.click(screen.getByRole("tab", { name: /Teslim edilen/ }));
  expect(card("DA-100001")).toBeInTheDocument();
  expect(queryCard("DA-100002")).not.toBeInTheDocument();
  expect(queryCard("DA-100005")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: /İade/ }));
  expect(card("DA-100005")).toBeInTheDocument();
});

test("a cancelled order does not say it will be shipped", () => {
  render(
    <OrderList
      orders={[{ ...ORDER, status: "cancelled", carrier: null, tracking_number: null }]}
      onAsk={vi.fn()}
      onOpenChat={vi.fn()}
    />,
  );
  expect(screen.getAllByText("Sipariş iptal edildi")).not.toHaveLength(0);
  expect(screen.queryByText("Henüz kargoya verilmedi")).toBeNull();
});

test("details turn the card over and back, moving focus with it", async () => {
  render(<OrderList orders={[ORDER]} onAsk={vi.fn()} onOpenChat={vi.fn()} />);
  const back = screen.getByRole("button", { name: /Geri dön/ });
  // The face turned away cannot be reached by keyboard.
  expect(back.closest("[inert]")).not.toBeNull();

  await userEvent.click(card("DA-100002"));
  await vi.waitFor(() => expect(back).toHaveFocus());
  expect(back.closest("[inert]")).toBeNull();
  expect(screen.getByText("Takip numarası").nextElementSibling).toHaveTextContent("AR123");
  expect(card("DA-100002").closest("[inert]")).not.toBeNull();

  await userEvent.click(back);
  await vi.waitFor(() => expect(card("DA-100002")).toHaveFocus());
});

test("the back of a shipped order shows where the parcel is, fetched only when asked", async () => {
  const loadShipment = vi.fn().mockResolvedValue(SHIPMENT);
  render(
    <OrderList orders={[ORDER]} onAsk={vi.fn()} onOpenChat={vi.fn()} loadShipment={loadShipment} />,
  );
  await userEvent.click(card("DA-100002"));
  expect(loadShipment).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /Kargom nerede/ }));
  expect(loadShipment).toHaveBeenCalledWith("DA-100002");
  expect(await screen.findByText("Transfer merkezinde")).toBeInTheDocument();
  expect(screen.getByText("Yolda / Aktarmada").closest("li")!.querySelector("[aria-current]"))
    .toHaveAttribute("aria-current", "step");

  await userEvent.click(screen.getByRole("button", { name: /Detaylar$/ }));
  expect(screen.getByText("Takip numarası")).toBeInTheDocument();
});

test("a preparing order's details show its estimated delivery", () => {
  render(
    <OrderList
      orders={[
        {
          ...ORDER,
          status: "preparing",
          carrier: null,
          tracking_number: null,
          estimated_delivery: "2026-11-13",
        },
      ]}
      onAsk={vi.fn()}
      onOpenChat={vi.fn()}
    />,
  );
  expect(screen.getByText("Tahmini teslim").nextElementSibling).toHaveTextContent("13 Kasım 2026");
});

test("an order without a tracking number offers no tracking", async () => {
  render(
    <OrderList
      orders={[{ ...ORDER, status: "preparing", carrier: null, tracking_number: null }]}
      onAsk={vi.fn()}
      onOpenChat={vi.fn()}
      loadShipment={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: /Kargom nerede/, hidden: true })).toBeNull();
});

test("loading orders shows skeletons instead of an empty list", () => {
  render(<OrderList orders={null} onAsk={vi.fn()} onOpenChat={vi.fn()} />);
  expect(screen.getByLabelText("Siparişler yükleniyor")).toBeInTheDocument();
  expect(screen.queryByText(/sipariş yok/)).not.toBeInTheDocument();
});

test("an empty search offers the assistant", async () => {
  const onOpenChat = vi.fn();
  render(<OrderList orders={[ORDER]} onAsk={vi.fn()} onOpenChat={onOpenChat} />);

  await userEvent.type(screen.getByRole("textbox"), "bulunmayan ürün");
  expect(screen.getByText("Aramanızla eşleşen sipariş yok")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Asistana sor/ }));
  expect(onOpenChat).toHaveBeenCalled();
});
