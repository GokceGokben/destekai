import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  formatDate,
  formatMoney,
  formatPoints,
  memberSince,
  orderBadge,
  returnCode,
} from "../format";
import type { Customer, Order } from "../types";
import { CustomerAvatar } from "./CustomerAvatar";
import { Icon } from "./Icon";
import { ProductImage } from "./ProductImage";

function matchesOrder(order: Order, query: string): boolean {
  // Cards show order numbers as "#DA-100007", so a pasted number arrives with the "#".
  const needle = query.trim().replace(/^#/, "").toLocaleLowerCase("tr");
  return [order.id, ...order.items.map((item) => item.product_name)].some((text) =>
    text.toLocaleLowerCase("tr").includes(needle),
  );
}

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
}

export function CustomerCard({ customer, onAskPolicy }: CustomerCardProps) {
  return (
    <aside className="w-full lg:w-80 flex flex-col gap-space-md shrink-0 lg:sticky lg:top-20">
      <div className="bg-surface-container-lowest dark:bg-[#2a2c30] rounded-xl p-space-md shadow-sm border border-surface-variant/40 relative overflow-hidden">
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
          className="w-full py-2 px-space-md rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container font-label-sm text-label-sm flex items-center justify-center gap-space-xs transition-colors border border-surface-container-high"
        >
          <Icon name="policy" className="text-[16px] text-primary" />
          Mağaza İade &amp; Değişim Politikaları
        </button>
        <button
          type="button"
          className="w-full py-2 px-space-md rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container font-label-sm text-label-sm flex items-center justify-center gap-space-xs transition-colors border border-surface-container-high"
        >
          <Icon name="support_agent" className="text-[16px] text-secondary" />
          Canlı Destek Telefon Hattı (0850)
        </button>
      </div>
    </aside>
  );
}

type Filter = "all" | "active" | "delivered" | "returns";

const FILTERS: { value: Filter; label: string; matches: (order: Order) => boolean }[] = [
  { value: "all", label: "Tümü", matches: () => true },
  {
    value: "active",
    label: "Devam eden",
    matches: (o) => !o.return_status && (o.status === "preparing" || o.status === "shipped"),
  },
  {
    value: "delivered",
    label: "Teslim edilen",
    matches: (o) => !o.return_status && o.status === "delivered",
  },
  { value: "returns", label: "İade", matches: (o) => o.return_status !== null },
];

interface OrderListProps {
  orders: Order[] | null;
  onAsk: (orderId: string) => void;
  onOpenChat: () => void;
}

export function OrderList({ orders, onAsk, onOpenChat }: OrderListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const active = FILTERS.find((f) => f.value === filter)!;
  const visible = orders?.filter((order) => active.matches(order) && matchesOrder(order, query));

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-space-md">
      <div className="relative isolate flex flex-col gap-space-sm overflow-hidden rounded-xl px-space-md py-space-md sm:flex-row sm:items-center sm:justify-between">
        {/* The login screen's pattern as a band that fades out, tying the two screens together. */}
        <div
          aria-hidden="true"
          className="bg-pattern-panel absolute inset-0 -z-10 [mask-image:linear-gradient(to_right,black,transparent_85%)]"
        />
        <div className="flex items-center gap-space-sm">
          <h1 className="font-headline-md text-headline-md text-on-surface">Siparişlerim</h1>
          {orders && (
            <span className="font-code-sm text-code-sm px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">
              {orders.length} Kayıt
            </span>
          )}
        </div>
        <div className="relative sm:w-72">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]"
          />
          <input
            type="text"
            aria-label="Siparişlerde ara"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sipariş no, ürün adı ara..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-container-lowest text-on-surface font-body-sm text-body-sm placeholder:text-on-surface-variant focus:outline-none border border-surface-variant/60 focus:border-primary transition-all"
          />
        </div>
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList className="max-w-full overflow-x-auto">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value} className="px-3">
              {f.label}
              {orders && (
                <span className="font-code-sm text-[11px] text-on-surface-variant">
                  {orders.filter(f.matches).length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={filter} className="flex flex-col gap-space-md pt-space-sm">
          {orders === null ? (
            <OrderSkeletons />
          ) : visible && visible.length > 0 ? (
            visible.map((order) => <OrderCard key={order.id} order={order} onAsk={onAsk} />)
          ) : (
            <EmptyState searching={query.trim() !== ""} onOpenChat={onOpenChat} />
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function OrderSkeletons() {
  return (
    <div aria-label="Siparişler yükleniyor" className="flex flex-col gap-space-md">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-space-md rounded-xl border border-surface-variant/40 bg-surface-container-lowest p-space-md"
        >
          <div className="flex justify-between">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-6 w-28" />
          </div>
          <div className="flex items-center gap-space-md">
            <Skeleton className="size-16 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ searching, onOpenChat }: { searching: boolean; onOpenChat: () => void }) {
  return (
    <div className="flex flex-col items-center gap-space-sm rounded-xl border border-dashed border-surface-variant/60 bg-surface-container-lowest px-space-lg py-space-xl text-center">
      <div aria-hidden="true" className="bg-pattern-panel relative size-20 rounded-full border border-surface-variant/40" />
      <h2 className="font-headline-sm text-headline-sm text-on-surface">
        {searching ? "Aramanızla eşleşen sipariş yok" : "Bu bölümde sipariş yok"}
      </h2>
      <p className="max-w-sm font-body-sm text-body-sm text-on-surface-variant">
        {searching
          ? "Sipariş numarasını ya da ürün adını kontrol edin. Aradığınızı bulamazsanız asistana sorabilirsiniz."
          : "Başka bir sekmeye geçebilir ya da sorunuzu asistana iletebilirsiniz."}
      </p>
      <Button variant="outline" size="sm" onClick={onOpenChat} className="mt-space-xs">
        <Icon name="smart_toy" className="text-[16px] text-ai" />
        Asistana sor
      </Button>
    </div>
  );
}

function OrderCard({ order, onAsk }: { order: Order; onAsk: (orderId: string) => void }) {
  const badge = orderBadge(order);
  // A soft shadow under each card, so neighbouring orders read as separate.
  return (
    <Card className="gap-0 py-0 shadow-[0_10px_24px_-12px_rgba(70,50,30,0.28)] dark:shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)]">
      <CardHeader className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-variant/40 py-space-md">
        <div className="flex items-center gap-space-sm">
          {order.items.length > 1 && (
            // A glance at what is inside before reading the list.
            <div className="flex -space-x-3">
              {order.items.slice(0, 3).map((item) => (
                <ProductImage
                  key={item.product_name}
                  item={item}
                  className="size-9 rounded-full ring-2 ring-card"
                />
              ))}
            </div>
          )}
          <div className="flex flex-col">
            <span className="font-code-sm text-code-sm font-semibold text-primary">#{order.id}</span>
            <span className="font-label-sm text-[12px] text-on-surface-variant">
              {formatDate(order.placed_at)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-space-md">
          <span
            className={`px-2 py-0.5 rounded-md font-code-sm text-[11px] font-semibold flex items-center gap-1 ${badge.classes}`}
          >
            {badge.dot && <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-ping" />}
            {badge.label}
          </span>
          <span className="font-headline-sm text-headline-sm text-on-surface">
            {formatMoney(order.total_kurus)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-space-sm py-space-md">
        {order.items.map((item) => (
          <div key={item.product_name} className="flex items-center gap-space-md">
            <ProductImage item={item} className="size-16" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-body-md text-body-md font-medium text-on-surface">
                {item.product_name}
              </span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                {item.quantity} × {formatMoney(item.unit_price_kurus)}
              </span>
            </div>
            <span className="font-body-md text-body-md text-on-surface">
              {formatMoney(item.quantity * item.unit_price_kurus)}
            </span>
          </div>
        ))}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-variant/40 py-space-sm">
        <span className="flex items-center gap-1.5 font-code-sm text-[12px] text-on-surface-variant">
          {order.return_id ? (
            <span className="text-error">İade kodu: {returnCode(order.return_id)}</span>
          ) : order.tracking_number ? (
            <>
              <Icon name="local_shipping" className="text-[16px] text-primary" />
              {order.carrier}: {order.tracking_number}
            </>
          ) : (
            "Henüz kargoya verilmedi"
          )}
        </span>
        <Button variant="outline" size="sm" onClick={() => onAsk(order.id)}>
          <Icon name="smart_toy" className="text-[16px] text-ai" />
          Asistana sor
        </Button>
      </CardFooter>
    </Card>
  );
}
