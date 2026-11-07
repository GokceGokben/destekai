import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD_SHADOW, cn } from "@/lib/utils";

import {
  formatDate,
  formatDateTime,
  formatMoney,
  orderBadge,
  RETURN_LABELS,
  returnCode,
} from "../format";
import type { Order, Shipment } from "../types";
import { latestEvent, ShipmentProgress } from "./Cards";
import { Icon } from "./Icon";
import { ProductImage } from "./ProductImage";

export type LoadShipment = (orderId: string) => Promise<Shipment>;

/** What the card says about shipping under the items. */
function shippingNote(order: Order): string {
  if (order.status === "cancelled") return "Sipariş iptal edildi";
  return "Henüz kargoya verilmedi";
}

/**
 * An order card that turns over to show its details. Both faces sit in the same grid cell,
 * so the card keeps the height of the taller one and does not jump when it turns; the face
 * turned away is inert, so the keyboard cannot reach its buttons.
 */
export function OrderCard({
  order,
  onAsk,
  loadShipment,
}: {
  order: Order;
  onAsk: (orderId: string) => void;
  loadShipment?: LoadShipment;
}) {
  const [flipped, setFlipped] = useState(false);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

  function turn(toBack: boolean) {
    setFlipped(toBack);
    // Focus follows the card to the face now showing.
    requestAnimationFrame(() => (toBack ? backButton : detailsButton).current?.focus());
  }

  return (
    <div className="perspective-[1600px]">
      <div
        className={cn(
          "grid transform-3d transition-transform duration-500 ease-out motion-reduce:transition-none",
          flipped && "rotate-y-180",
        )}
      >
        <div className="[grid-area:1/1] backface-hidden" inert={flipped}>
          <OrderFront
            order={order}
            onAsk={onAsk}
            onDetails={() => turn(true)}
            detailsButton={detailsButton}
          />
        </div>
        <div className="[grid-area:1/1] backface-hidden rotate-y-180" inert={!flipped}>
          <OrderBack
            order={order}
            onBack={() => turn(false)}
            backButton={backButton}
            loadShipment={loadShipment}
          />
        </div>
      </div>
    </div>
  );
}

function OrderFront({
  order,
  onAsk,
  onDetails,
  detailsButton,
}: {
  order: Order;
  onAsk: (orderId: string) => void;
  onDetails: () => void;
  detailsButton: RefObject<HTMLButtonElement | null>;
}) {
  const badge = orderBadge(order);
  return (
    <Card className={cn("h-full gap-0 py-0", CARD_SHADOW)}>
      <CardHeader className="bg-pattern-panel relative flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-variant/40 py-space-md [--pattern-panel-dark-opacity:0.3] [--pattern-panel-opacity:0.3]">
        <div className="relative flex items-center gap-space-sm">
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
        <div className="relative flex items-center gap-space-md">
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

      {/* mt-auto: when the back is the taller face, the footer stays at the bottom. The pattern
          matches the back's header, so the two faces mirror each other when the card turns. */}
      <CardFooter className="bg-pattern-panel relative mt-auto flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-variant/40 py-space-sm [--pattern-panel-dark-opacity:0.3] [--pattern-panel-opacity:0.3]">
        <span className="relative flex items-center gap-1.5 font-code-sm text-[12px] text-on-surface-variant">
          {order.return_id ? (
            <span className="text-error">İade kodu: {returnCode(order.return_id)}</span>
          ) : order.tracking_number ? (
            <>
              <Icon name="local_shipping" className="text-[16px] text-primary" />
              {order.carrier}: {order.tracking_number}
            </>
          ) : (
            shippingNote(order)
          )}
        </span>
        <div className="relative flex items-center gap-space-xs">
          <Button variant="outline" size="sm" onClick={() => onAsk(order.id)}>
            <Icon name="smart_toy" className="text-[16px] text-ai" />
            Asistana sor
          </Button>
          <Button
            ref={detailsButton}
            variant="ghost"
            size="sm"
            onClick={onDetails}
            aria-label={`${order.id} siparişinin detayları`}
            className="text-primary"
          >
            Detaylar
            <Icon name="arrow_forward" className="text-[16px]" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function OrderBack({
  order,
  onBack,
  backButton,
  loadShipment,
}: {
  order: Order;
  onBack: () => void;
  backButton: RefObject<HTMLButtonElement | null>;
  loadShipment?: LoadShipment;
}) {
  // Only an order with a tracking number has a shipment to show.
  const canTrack = order.tracking_number !== null && loadShipment !== undefined;
  const [tracking, setTracking] = useState(false);
  const pieces = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const rows: [string, string][] = [
    ["Sipariş tarihi", formatDate(order.placed_at)],
    ["Durum", orderBadge(order).label],
    order.delivered_at
      ? ["Teslim tarihi", formatDate(order.delivered_at)]
      : [
          "Tahmini teslim",
          order.estimated_delivery && order.status !== "cancelled"
            ? formatDate(order.estimated_delivery)
            : "–",
        ],
    ["Kargo firması", order.carrier ?? "–"],
    ["Takip numarası", order.tracking_number ?? "–"],
    [
      "İade",
      order.return_id && order.return_status
        ? `${RETURN_LABELS[order.return_status]} (${returnCode(order.return_id)})`
        : "Yok",
    ],
    ["Ürün sayısı", `${pieces} adet, ${order.items.length} çeşit`],
    ["Toplam tutar", formatMoney(order.total_kurus)],
  ];
  return (
    <Card className={cn("h-full gap-0 py-0", CARD_SHADOW)}>
      {/* The panel pattern, half strength in both themes; the contents are positioned so they
          paint above the pattern's ::before layer. */}
      <CardHeader className="bg-pattern-panel relative flex items-center justify-between gap-space-sm border-b border-surface-variant/40 py-space-md [--pattern-panel-dark-opacity:0.3] [--pattern-panel-opacity:0.3]">
        <Button
          ref={backButton}
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="relative text-primary"
        >
          <Icon name="arrow_back" className="text-[16px]" />
          Geri dön
        </Button>
        <span className="relative font-code-sm text-code-sm font-semibold text-primary">
          #{order.id}
        </span>
      </CardHeader>
      <CardContent className="py-space-md">
        <div className="mb-space-sm flex items-center justify-between gap-space-sm">
          <h3 className="font-headline-sm text-headline-sm text-on-surface">
            {tracking ? "Kargo Takibi" : "Sipariş Detayları"}
          </h3>
          {canTrack && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTracking(!tracking)}
              className="text-primary"
            >
              <Icon name={tracking ? "list_alt" : "local_shipping"} className="text-[16px]" />
              {tracking ? "Detaylar" : "Kargom nerede?"}
            </Button>
          )}
        </div>
        {tracking && loadShipment ? (
          <ShipmentTracking orderId={order.id} loadShipment={loadShipment} />
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-space-lg gap-y-space-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="font-label-sm text-[12px] text-on-surface-variant">{label}</dt>
                <dd className="font-body-md text-body-md text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The shipment's stages, as the assistant shows them in the chat. Fetched when first opened,
 * so turning cards over does not cost a request per order.
 */
function ShipmentTracking({
  orderId,
  loadShipment,
}: {
  orderId: string;
  loadShipment: LoadShipment;
}) {
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true; // ignores an answer that arrives after the view has closed
    loadShipment(orderId)
      .then((result) => current && setShipment(result))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [orderId, loadShipment]);

  if (failed) {
    return (
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        Kargo bilgisi şu anda alınamadı. Biraz sonra tekrar deneyin ya da asistana sorun.
      </p>
    );
  }
  if (!shipment) {
    return (
      <div aria-label="Kargo bilgisi yükleniyor" className="flex flex-col gap-space-sm">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  const latest = latestEvent(shipment);
  return (
    <div className="flex flex-col gap-space-sm">
      <ShipmentProgress shipment={shipment} />
      <div className="flex flex-wrap items-center justify-between gap-space-sm rounded-lg bg-surface-container-low p-space-sm">
        {latest && (
          <span className="flex items-center gap-2 font-body-sm text-body-sm text-on-surface">
            <Icon name="near_me" className="text-[18px] text-primary" />
            <span>
              <strong className="font-semibold">{latest.description}</strong> ({latest.location},{" "}
              {formatDateTime(latest.occurred_at)})
            </span>
          </span>
        )}
        <span className="font-code-sm text-[12px] text-primary">
          Tahmini: {formatDate(shipment.estimated_delivery)}
        </span>
      </div>
    </div>
  );
}
