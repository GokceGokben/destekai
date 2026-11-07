import { CARD_SHADOW, cn } from "@/lib/utils";

import { formatPoints, memberSince } from "../format";
import type { Customer } from "../types";
import { CustomerAvatar } from "./CustomerAvatar";
import { Icon } from "./Icon";

const LINK_BUTTON =
  "w-full py-2 px-space-md rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container font-label-sm text-label-sm flex items-center justify-center gap-space-xs transition-colors border border-surface-container-high";

/** Gold ring for a VIP customer's portrait, in the VIP pill's gradient (see index.css). */
export const VIP_RING = "vip-ring";

export function VipPill() {
  return (
    <span
      className="px-2.5 py-0.5 rounded-md font-code-sm text-code-sm font-semibold inline-flex items-center gap-1 shadow-sm"
      style={{
        background: "var(--vip-gradient)",
        border: "1px solid rgb(212, 175, 55)",
        color: "rgb(61, 38, 0)",
      }}
    >
      <svg aria-hidden="true" className="w-3 h-3 shrink-0" fill="#3d2600" viewBox="0 0 24 24">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5m14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
      </svg>
      <span className="font-bold text-[11px] tracking-wide">VIP Müşteri</span>
    </span>
  );
}

function TierPill({ customer }: { customer: Customer }) {
  if (customer.tier === "vip") return <VipPill />;
  if (customer.tier === "new") {
    return (
      <span className="px-2.5 py-0.5 rounded-md border border-secondary bg-card text-secondary font-code-sm text-[11px] font-semibold">
        Yeni Müşteri
      </span>
    );
  }
  return (
    <span className="px-2.5 py-0.5 rounded-md border border-[#0037b0] bg-card text-[#0037b0] dark:border-blue-400 dark:text-blue-300 font-code-sm text-[11px] font-semibold">
      Standart Müşteri
    </span>
  );
}

interface CustomerCardProps {
  customer: Customer;
  onAskPolicy: () => void;
  /** Asks the assistant for a person. Left out in the read-only view, which cannot hand off. */
  onAskHuman?: () => void;
}

export function CustomerCard({ customer, onAskPolicy, onAskHuman }: CustomerCardProps) {
  return (
    <aside className="w-full lg:w-80 flex flex-col gap-space-md shrink-0 lg:sticky lg:top-20">
      <div
        className={cn(
          "bg-surface-container-lowest dark:bg-[#2a2c30] rounded-xl p-space-md border border-surface-variant/40 relative overflow-hidden",
          CARD_SHADOW,
        )}
      >
        <div
          aria-hidden="true"
          className="bg-pattern-panel relative -mx-space-md -mt-space-md mb-space-sm h-12 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
        <div className="flex items-center gap-space-md">
          <div className="relative shrink-0">
            <div
              className={cn(
                "relative w-14 h-14 rounded-full bg-surface-container flex items-center justify-center font-headline-sm text-headline-sm text-primary",
                customer.tier === "vip" ? VIP_RING : "ring-2 ring-primary/20",
              )}
            >
              <CustomerAvatar customer={customer} />
            </div>
            <span
              className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-secondary ring-2 ring-surface-container-lowest"
              title="Çevrimiçi"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-space-xs">
              <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">
                {customer.full_name}
              </h3>
              {customer.tier === "vip" && (
                <Icon name="verified" filled className="text-[16px] text-secondary" />
              )}
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant truncate">
              {customer.email}
            </span>
            <div className="flex items-center gap-space-xs mt-1">
              <TierPill customer={customer} />
              <span className="text-on-surface-variant font-label-sm text-[11px]">
                • {memberSince(customer.member_years)}
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-space-xs mt-space-md pt-space-sm bg-surface-container-low rounded-lg p-space-sm text-center border border-surface-container-high">
          <div>
            <div className="font-code-sm text-[11px] text-on-surface-variant">Toplam Sipariş</div>
            <div className="font-headline-sm text-headline-sm text-primary font-bold">
              {customer.order_count} Adet
            </div>
          </div>
          <div>
            <div className="font-code-sm text-[11px] text-on-surface-variant">Sadakat Puanı</div>
            <div className="font-headline-sm text-headline-sm text-accent-orange font-bold">
              {formatPoints(customer.loyalty_points)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onAskPolicy}
          className={cn(LINK_BUTTON, CARD_SHADOW)}
        >
          <Icon name="policy" className="text-[16px] text-primary" />
          Mağaza İade &amp; Değişim Politikaları
        </button>
        {onAskHuman && (
          <button
            type="button"
            onClick={onAskHuman}
            className={cn(LINK_BUTTON, CARD_SHADOW)}
          >
            <Icon name="support_agent" className="text-[16px] text-secondary" />
            Canlı Temsilciye Bağlan
          </button>
        )}
      </div>
    </aside>
  );
}
