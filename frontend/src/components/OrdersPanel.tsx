import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { Order } from "../types";
import { Icon } from "./Icon";
import { OrderCard, type LoadShipment } from "./OrderCard";

function matchesOrder(order: Order, query: string): boolean {
  // Cards show order numbers as "#DA-100007", so a pasted number arrives with the "#".
  const needle = query.trim().replace(/^#/, "").toLocaleLowerCase("tr");
  return [order.id, ...order.items.map((item) => item.product_name)].some((text) =>
    text.toLocaleLowerCase("tr").includes(needle),
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
  /** Fetches an order's shipment for the tracking view on the back of its card. */
  loadShipment?: LoadShipment;
}

export function OrderList({ orders, onAsk, onOpenChat, loadShipment }: OrderListProps) {
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
            visible.map((order) => (
              <OrderCard key={order.id} order={order} onAsk={onAsk} loadShipment={loadShipment} />
            ))
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
