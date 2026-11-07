import { useCallback, useEffect, useState } from "react";

import { getShipment, listOrders, UnauthorizedError } from "../api";
import { useGenie } from "../genie";
import type { Admin, Customer, Order } from "../types";
import { AdminBadge } from "./AdminHome";
import { useChat } from "../useChat";
import { useIsMobile } from "../useIsMobile";
import { AppHeader } from "./AppHeader";
import { ChatPanel } from "./ChatPanel";
import { Icon } from "./Icon";
import { MobileSupport } from "./MobileSupport";
import { CustomerCard } from "./CustomerCard";
import { OrderList } from "./OrdersPanel";

interface Props {
  token: string;
  customer: Customer;
  /** Back to the login screen, or to the customer list for an admin. */
  onLogout: () => void;
  /** Set when an admin views this customer read-only. */
  viewer?: Admin;
}

export function SupportScreen({ token, customer, onLogout, viewer }: Props) {
  const { state, latencyMs, send, reset } = useChat(token, onLogout);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [draft, setDraft] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const mobile = useIsMobile();
  const { windowRef, launcherRef, shown } = useGenie(chatOpen, !mobile, [state, draft]);

  // Also runs after each reply, because the agent may have opened a return.
  useEffect(() => {
    if (state.streaming) return;
    listOrders(token)
      .then(setOrders)
      .catch((error) => {
        if (error instanceof UnauthorizedError) onLogout();
      });
  }, [token, state.streaming, onLogout]);

  // Stable across renders, so an open tracking view does not fetch again on every chat update.
  const loadShipment = useCallback((orderId: string) => getShipment(token, orderId), [token]);

  function askAbout(orderId: string) {
    setDraft(`${orderId} numaralı siparişim hakkında bilgi almak istiyorum.`);
    setChatOpen(true);
  }

  function askPolicy() {
    setChatOpen(true);
    send("İade politikası");
  }

  // The same words as the quick reply, so the agent's handoff rule treats it the same way.
  function askHuman() {
    setChatOpen(true);
    send("Temsilciye bağlan");
  }

  return (
    <>
      <Header customer={customer} onLogout={onLogout} viewer={viewer} />
      {viewer && <ReadOnlyBanner customer={customer} onBack={onLogout} />}
      <main className={`w-full bg-background min-h-screen ${viewer ? "pt-28" : "pt-16"}`}>
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-gutter px-gutter-sm py-space-lg lg:flex-row lg:items-start lg:px-margin">
          <CustomerCard
            customer={customer}
            onAskPolicy={askPolicy}
            onAskHuman={viewer ? undefined : askHuman}
          />
          <OrderList
            orders={orders}
            onAsk={askAbout}
            onOpenChat={() => setChatOpen(true)}
            loadShipment={loadShipment}
          />
        </div>
      </main>
      <Footer />

      {/* Always mounted, so the window can animate out as well as in. `inert` takes the
          closed window out of keyboard and screen reader reach, and visibility switches
          only after the animation, because it transitions at its end. The desktop window is
          animated by genie.ts instead, which needs it laid out and only transparent when
          closed: a hidden window could not be snapshotted. */}
      {mobile ? (
        <div
          inert={!chatOpen}
          className={`fixed inset-0 z-[60] overflow-y-auto bg-surface transition-[translate,opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${
            // translate-none when open: any translate makes this the containing block of
            // the chat's fixed header and nav, which would then scroll with the content.
            chatOpen ? "visible translate-none opacity-100" : "invisible translate-y-full opacity-0"
          }`}
        >
          <MobileSupport
            customer={customer}
            orders={orders}
            state={state}
            latencyMs={latencyMs}
            draft={draft}
            onDraftChange={setDraft}
            onSend={send}
            onPickOrder={askAbout}
            onClose={() => setChatOpen(false)}
            readOnly={Boolean(viewer)}
          />
        </div>
      ) : (
        <div
          role="dialog"
          aria-label="Akıllı Asistan"
          ref={windowRef}
          inert={!chatOpen}
          className={`fixed right-6 bottom-24 z-50 h-[calc(100dvh-11rem)] w-[45vw] min-w-[420px] ${
            shown ? "" : "pointer-events-none opacity-0"
          }`}
        >
          <ChatPanel
            state={state}
            draft={draft}
            onDraftChange={setDraft}
            onSend={send}
            onReset={reset}
            onClose={() => setChatOpen(false)}
            readOnly={Boolean(viewer)}
          />
        </div>
      )}

      {!(chatOpen && mobile) && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setChatOpen(!chatOpen)}
          aria-expanded={chatOpen}
          className="fixed right-6 bottom-6 z-50 flex h-14 items-center gap-2 rounded-full bg-ai px-5 font-label-md text-label-md font-semibold text-white shadow-xl transition hover:bg-ai-deep"
        >
          <Icon name={chatOpen ? "close" : "smart_toy"} className="text-[22px]" />
          {chatOpen ? "Kapat" : "Akıllı Asistan"}
        </button>
      )}
    </>
  );
}

/** Fixed under the header: an admin must never mistake the view for the customer's own. */
function ReadOnlyBanner({ customer, onBack }: { customer: Customer; onBack: () => void }) {
  return (
    <div
      role="status"
      className="fixed top-16 left-0 right-0 z-30 flex flex-wrap items-center justify-between gap-space-sm px-gutter-sm lg:px-margin py-2 bg-amber-50 text-amber-900 border-b border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800"
    >
      <span className="flex items-center gap-1.5 font-label-md text-label-md">
        <Icon name="visibility" className="text-[18px]" />
        Yönetici görünümü: <b>{customer.full_name}</b> — salt okunur
      </span>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 font-label-md text-label-md font-semibold hover:underline"
      >
        <Icon name="arrow_back" className="text-[16px]" /> Müşteri listesine dön
      </button>
    </div>
  );
}

function Header({
  customer,
  onLogout,
  viewer,
}: {
  customer: Customer;
  onLogout: () => void;
  viewer?: Admin;
}) {
  if (viewer) {
    return (
      <AppHeader active="Müşteri Desteği">
        <AdminBadge onLogout={onLogout} />
      </AppHeader>
    );
  }
  return (
    <AppHeader active="Müşteri Desteği">
      <button
        type="button"
        onClick={onLogout}
        aria-label="Müşteri Değiştir"
        title="Müşteri Değiştir"
        className="flex items-center gap-space-xs pl-space-xs border-l border-surface-variant"
      >
        <span className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-primary font-bold text-xs">
          <Icon name="account_circle" className="text-[18px]" />
        </span>
        {/* The signed-in customer, not an admin: the demo login acts as this customer. */}
        <span className="hidden xl:flex flex-col text-left leading-tight">
          <span className="font-label-sm text-xs font-semibold text-on-surface">
            {customer.full_name}
          </span>
          <span className="font-code-sm text-[10px] text-on-surface-variant">
            Müşteri değiştir
          </span>
        </span>
      </button>
    </AppHeader>
  );
}

function Footer() {
  return (
    <footer className="w-full bg-surface-container-lowest pt-3 pb-20 md:pb-3 border-t border-surface-variant/40">
      {/* Right padding keeps the text clear of the assistant button. */}
      <div className="w-full px-gutter-sm lg:pl-margin md:pr-56 flex flex-col md:flex-row items-center justify-between gap-1 md:gap-space-md text-on-surface-variant font-label-sm text-[12px]">
        <div className="flex items-center gap-space-sm">
          <span>© {new Date().getFullYear()} DestekAI Bilişim A.Ş.</span>
          <span className="text-outline-variant">•</span>
          <span>Yapay Zekâ Destek Operasyonları</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-space-lg">
          <span>
            Ürün fotoğrafları:{" "}
            <a
              className="underline"
              href="https://unsplash.com/?utm_source=destekai&utm_medium=referral"
              target="_blank"
              rel="noreferrer"
            >
              Unsplash
            </a>
          </span>
          <span>KVKK &amp; Veri Güvenliği</span>
          <span>Yardım Dokümantasyonu</span>
        </div>
      </div>
    </footer>
  );
}
