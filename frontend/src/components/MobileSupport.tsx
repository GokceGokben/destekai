import { useEffect, useRef, useState } from "react";

import type { ChatMessage, ChatState } from "../chatReducer";
import { formatMoney, formatPoints, orderBadge, orderTitle } from "../format";
import type { Customer, Order } from "../types";
import { cn } from "@/lib/utils";
import { CardView } from "./Cards";
import {
  forViewer,
  HANDED_OFF_PLACEHOLDER,
  MAX_MESSAGE_LENGTH,
  MessageMarkdown,
} from "./ChatPanel";
import { CustomerAvatar } from "./CustomerAvatar";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { VIP_RING, VipPill } from "./OrdersPanel";

const QUICK_REPLIES = [
  { emoji: "📦", text: "Siparişim nerede?" },
  { emoji: "🔄", text: "İade talebi oluştur" },
  { emoji: "🚚", text: "Kargo takibi" },
  { emoji: "📋", text: "İade politikası" },
];

const WELCOME =
  "Merhaba! Siparişleriniz, kargo takibi veya iade işlemleri için size yardımcı olabilirim.";

// VIP customers get the gold VipPill instead.
const TIER_LABELS: Record<Exclude<Customer["tier"], "vip">, string> = {
  standard: "Standart",
  new: "Yeni Müşteri",
};

interface Props {
  customer: Customer;
  orders: Order[] | null;
  state: ChatState;
  latencyMs: number | null;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  onPickOrder: (orderId: string) => void;
  onClose: () => void;
  readOnly?: boolean;
}

export function MobileSupport({
  customer,
  orders,
  state,
  latencyMs,
  draft,
  onDraftChange,
  onSend,
  onPickOrder,
  onClose,
  readOnly = false,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const lastMessage = state.messages[state.messages.length - 1];
  const handedOff = state.handoffSummary !== null;
  const activeOrder = orders?.find((order) => order.status === "shipped") ?? orders?.[0];

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [state.messages.length, lastMessage?.text, lastMessage?.cards.length]);

  function submit() {
    const text = draft.trim();
    if (!text || state.streaming || handedOff) return;
    onDraftChange("");
    onSend(text);
  }

  return (
    <div className="bg-surface text-on-surface min-h-dvh flex flex-col antialiased">
      <header className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 px-gutter-sm flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <button
              type="button"
              onClick={onClose}
              aria-label="Asistanı Kapat"
              className="w-11 h-11 flex items-center justify-center rounded-lg text-on-surface hover:bg-surface-container-high transition-colors"
            >
              <Icon name="arrow_back" className="text-[24px]" />
            </button>
            <Logo className="h-10" />
          </div>
          <div className="flex items-center gap-space-sm">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface">
              <Icon name="storefront" className="text-secondary text-[16px]" />
              <span className="font-label-sm text-label-sm font-semibold max-w-[80px] truncate">
                ModaTrend Mağaza
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative w-full pt-16 pb-24 bg-surface">
        <section className="px-gutter-sm pt-space-xs pb-space-sm z-30">
          <button
            type="button"
            onClick={() => setDrawerOpen(!drawerOpen)}
            aria-expanded={drawerOpen}
            className="w-full text-left cursor-pointer bg-surface-container-lowest shadow-sm rounded-xl p-space-sm flex items-center justify-between transition-all active:scale-[0.99]"
          >
            <span className="flex items-center gap-space-sm min-w-0">
              <span className="relative shrink-0">
                <span
                  className={cn(
                    "relative w-10 h-10 rounded-full bg-surface-container shadow-sm flex items-center justify-center font-label-md text-label-md font-semibold text-primary",
                    customer.tier === "vip" && VIP_RING,
                  )}
                >
                  <CustomerAvatar customer={customer} />
                </span>
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-secondary ring-2 ring-surface-container-lowest flex items-center justify-center">
                  <Icon name="star" filled className="text-[10px] text-on-secondary" />
                </span>
              </span>
              <span className="flex flex-col min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="font-headline-sm text-[14px] text-on-surface truncate">
                    {customer.full_name}
                  </span>
                  {customer.tier === "vip" ? (
                    <VipPill />
                  ) : (
                    <span className="px-1.5 rounded-md border border-secondary bg-card text-secondary font-label-sm text-[10px] uppercase font-bold tracking-wider whitespace-nowrap">
                      {TIER_LABELS[customer.tier]}
                    </span>
                  )}
                </span>
                {activeOrder && (
                  <span className="flex items-center gap-1 text-on-surface-variant font-body-sm text-[12px]">
                    <Icon name="local_mall" className="text-[14px] text-primary" />
                    <span className="truncate">
                      Aktif Sipariş: <strong className="text-on-surface">#{activeOrder.id}</strong>
                    </span>
                  </span>
                )}
              </span>
            </span>
            <span className="flex items-center gap-1 shrink-0 pl-space-xs">
              <span className="px-2 py-0.5 rounded-full bg-surface-container font-code-sm text-code-sm text-primary">
                {formatPoints(customer.loyalty_points)}
              </span>
              <Icon
                name="expand_more"
                className={`text-outline text-[20px] transition-transform duration-300 ${
                  drawerOpen ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>
          {drawerOpen && (
            <CustomerDrawer
              customer={customer}
              orders={orders ?? []}
              onPick={(id) => {
                onPickOrder(id);
                setDrawerOpen(false);
              }}
            />
          )}
        </section>

        {state.handoffSummary !== null && (
          <section className="px-gutter-sm pb-space-sm">
            <div
              role="status"
              className="bg-surface-container-high shadow-sm rounded-xl p-space-sm flex items-center gap-2.5"
            >
              <div className="w-8 h-8 rounded-full bg-tertiary-fixed flex items-center justify-center shrink-0">
                <Icon name="support_agent" className="text-tertiary text-[18px]" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-tertiary animate-ping" />
                  <span className="font-headline-sm text-[12px] text-on-surface truncate">
                    Temsilciye Aktarım Başlatıldı
                  </span>
                </div>
                <p className="font-body-sm text-[11px] text-on-surface-variant truncate">
                  Müşteri temsilcimiz bağlanıyor
                </p>
              </div>
            </div>
          </section>
        )}

        <section aria-live="polite" className="flex flex-col px-gutter-sm gap-space-md pb-44">
          {state.messages[0]?.time && (
            <div className="flex items-center justify-center my-space-xs">
              <span className="px-3 py-0.5 rounded-full bg-surface-container font-label-sm text-[11px] text-on-surface-variant">
                Bugün {state.messages[0].time}
              </span>
            </div>
          )}
          {state.messages.length === 0 && (
            <MobileMessage
              message={{ id: -1, role: "assistant", text: WELCOME, cards: [], error: false }}
              latency={null}
              pending={false}
            />
          )}
          {state.messages.map((message) => (
            <MobileMessage
              key={message.id}
              message={message}
              latency={message === lastMessage ? latencyMs : null}
              pending={state.streaming && message === lastMessage}
            />
          ))}
          <div ref={end} />
        </section>

        <div className="fixed bottom-16 left-0 w-full z-40 flex flex-col pointer-events-none">
          <div className="w-full max-w-[480px] mx-auto pointer-events-auto flex flex-col">
            <div className="px-gutter-sm pb-2 flex gap-1.5 overflow-x-auto">
              {forViewer(QUICK_REPLIES, readOnly).map((reply) => (
                <button
                  key={reply.text}
                  type="button"
                  disabled={state.streaming || handedOff}
                  onClick={() => onSend(reply.text)}
                  className="shrink-0 px-3 py-1.5 rounded-full bg-surface-container-lowest shadow-sm text-ai-deep font-headline-sm text-[12px] flex items-center gap-1 hover:bg-ai-container transition-colors disabled:opacity-50"
                >
                  <span>{reply.emoji}</span> {reply.text}
                </button>
              ))}
            </div>
            <div className="bg-surface-container-lowest shadow-xl px-gutter-sm py-2 flex items-center gap-2">
              <div className="flex items-center gap-0.5 text-outline">
                {["add_circle", "photo_camera"].map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    aria-label={icon === "add_circle" ? "Dosya Ekle" : "Fotoğraf Çek"}
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors"
                  >
                    <Icon name={icon} className="text-[20px]" />
                  </button>
                ))}
              </div>
              <div className="flex-1 min-w-0 bg-ai-container rounded-full px-3.5 py-2 flex items-center gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && submit()}
                  maxLength={MAX_MESSAGE_LENGTH}
                  aria-label="Mesajınız"
                  disabled={handedOff}
                  placeholder={handedOff ? HANDED_OFF_PLACEHOLDER : "Siparişiniz veya ürünler hakkında bir soru sorun..."}
                  className="w-full bg-transparent border-none outline-none font-body-sm text-[13px] text-on-surface placeholder:text-ai-outline"
                />
                <button
                  type="button"
                  aria-label="Sesli Mesaj"
                  className="text-outline hover:text-on-surface transition-colors"
                >
                  <Icon name="mic" className="text-[18px]" />
                </button>
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={state.streaming || handedOff || !draft.trim()}
                aria-label="Gönder"
                className="w-9 h-9 rounded-full bg-ai-deep text-white flex items-center justify-center shadow-md active:scale-95 transition-transform shrink-0 disabled:opacity-50"
              >
                <Icon name="send" className="text-[18px]" />
              </button>
            </div>
          </div>
        </div>

      </main>

      <nav className="fixed bottom-0 w-full z-50 bg-surface/80 backdrop-blur-xl shadow-[0_-1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 px-gutter-sm flex items-center justify-around">
          <NavButton icon="forum" label="Destek" active />
          <NavButton icon="local_shipping" label="Siparişler" onClick={onClose} />
          <NavButton icon="monitoring" label="Metrikler" />
        </div>
      </nav>
    </div>
  );
}

interface NavButtonProps {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function NavButton({ icon, label, active = false, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-0.5 transition-colors ${
        active ? "text-primary font-semibold" : "text-on-surface-variant hover:text-on-surface"
      }`}
    >
      <Icon name={icon} className="text-[22px]" />
      <span className="font-label-sm text-label-sm">{label}</span>
    </button>
  );
}

interface DrawerProps {
  customer: Customer;
  orders: Order[];
  onPick: (orderId: string) => void;
}

function CustomerDrawer({ customer, orders, onPick }: DrawerProps) {
  return (
    <div className="overflow-hidden mt-2 bg-surface-container-lowest shadow-md rounded-xl p-space-md">
      <div className="flex items-center justify-between pb-space-sm">
        <div className="flex flex-col min-w-0">
          <span className="font-label-sm text-label-sm text-on-surface-variant">Kayıtlı E-Posta</span>
          <span className="font-headline-sm text-[13px] text-on-surface truncate">
            {customer.email}
          </span>
        </div>
        <div className="flex flex-col text-right shrink-0">
          <span className="font-label-sm text-label-sm text-on-surface-variant">Toplam Sipariş</span>
          <span className="font-headline-sm text-headline-sm text-primary">
            {customer.order_count} Adet
          </span>
        </div>
      </div>
      <div className="pt-space-xs">
        <span className="block mb-space-xs font-label-sm text-label-sm text-on-surface-variant font-semibold">
          Son Siparişler
        </span>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {orders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => onPick(order.id)}
              className="min-w-[210px] bg-surface-container-low rounded-lg p-2.5 flex flex-col gap-1.5 shadow-sm text-left"
            >
              <span className="flex items-center justify-between">
                <span className="font-code-sm text-code-sm text-primary font-bold">#{order.id}</span>
                <span className={`px-1.5 py-0.5 rounded-md font-label-sm text-[10px] ${orderBadge(order).classes}`}>
                  {orderBadge(order).label}
                </span>
              </span>
              <span className="flex flex-col min-w-0">
                <span className="font-headline-sm text-[12px] truncate text-on-surface">
                  {orderTitle(order)}
                </span>
                <span className="font-body-sm text-[11px] text-on-surface-variant">
                  {formatMoney(order.total_kurus)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface MessageProps {
  message: ChatMessage;
  latency: number | null;
  pending: boolean;
}

function MobileMessage({ message, latency, pending }: MessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[85%] self-end">
        <div className="bg-ai-deep text-white rounded-2xl p-3.5 shadow-sm whitespace-pre-wrap">
          <p className="font-body-md text-[13px] leading-relaxed">{message.text}</p>
        </div>
        <div className="flex items-center gap-1 pr-1 font-label-sm text-[10px] text-outline">
          <span>{message.time}</span>
          <Icon name="done_all" filled className="text-[13px] text-ai-deep" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-space-sm max-w-[95%] self-start w-full">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-ai flex items-center justify-center">
          <Icon name="smart_toy" className="text-ai-ink text-[16px]" />
        </div>
        <span className="font-headline-sm text-[13px] text-on-surface">DestekAI Asistanı</span>
        {latency !== null && !pending && (
          <span className="px-1.5 rounded-full border border-secondary bg-card text-secondary font-code-sm text-[10px]">
            {Math.round(latency)}ms
          </span>
        )}
      </div>
      {message.text && (
        <div
          className={`markdown shadow-sm rounded-2xl p-3.5 font-body-md text-[13px] leading-relaxed ${
            message.error
              ? "bg-error-container text-on-error-container"
              : "bg-surface-container-lowest text-on-surface"
          }`}
        >
          <MessageMarkdown text={message.text} />
        </div>
      )}
      {message.cards.map((card, index) => (
        <CardView key={index} card={card} compact />
      ))}
      {pending && !message.text && (
        <div className="bg-surface-container-lowest shadow-sm rounded-2xl p-3.5 flex items-center gap-1" aria-hidden="true">
          <span className="w-2 h-2 rounded-full bg-ai-deep animate-bounce" />
          <span className="w-2 h-2 rounded-full bg-ai-deep animate-bounce [animation-delay:0.2s]" />
          <span className="w-2 h-2 rounded-full bg-ai-deep animate-bounce [animation-delay:0.4s]" />
        </div>
      )}
    </div>
  );
}
