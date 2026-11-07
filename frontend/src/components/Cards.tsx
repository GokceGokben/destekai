import { useState } from "react";

import type { Card } from "../chatReducer";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  orderBadge,
  orderTitle,
  RETURN_LABELS,
  returnCode,
} from "../format";
import type { Order, ReturnRequest, Shipment } from "../types";
import { Icon } from "./Icon";
import { ProductImage } from "./ProductImage";

export function CardView({ card, compact = false }: { card: Card; compact?: boolean }) {
  switch (card.kind) {
    case "order":
      return <OrderCard order={card.order} />;
    case "shipment":
      return compact ? (
        <MobileShipmentCard shipment={card.shipment} />
      ) : (
        <ShipmentCard shipment={card.shipment} />
      );
    case "return":
      return compact ? (
        <MobileReturnCard request={card.request} />
      ) : (
        <ReturnCard request={card.request} />
      );
  }
}

function CopyButton({ text, label, className }: { text: string; label: string; className: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" title={label} onClick={copy} className={className}>
      <Icon name="content_copy" className="text-[16px]" />
      <span>{copied ? "Kopyalandı!" : label}</span>
    </button>
  );
}

function OrderCard({ order }: { order: Order }) {
  const badge = orderBadge(order);
  return (
    <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-space-md w-full border border-surface-variant/40">
      <div className="flex items-center justify-between gap-space-sm pb-space-xs">
        <div className="flex items-center gap-space-sm min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary-fixed flex items-center justify-center text-on-primary-fixed-variant shrink-0">
            <Icon name="package_2" className="text-[20px]" />
          </div>
          <div className="min-w-0">
            <h4 className="font-headline-sm text-headline-sm text-on-surface truncate">
              Sipariş {order.id} • {orderTitle(order)}
            </h4>
            <span className="font-label-sm text-[12px] text-on-surface-variant">
              {formatDate(order.placed_at)}
            </span>
          </div>
        </div>
        <span
          className={`px-2.5 py-1 rounded-md font-code-sm text-[11px] font-semibold shrink-0 ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>
      <div className="p-space-sm bg-surface-container-low rounded-lg flex flex-col gap-1">
        {order.items.map((item) => (
          <div
            key={item.product_name}
            className="flex items-center justify-between gap-space-md font-body-sm text-body-sm text-on-surface"
          >
            <span className="flex items-center gap-space-sm">
              <ProductImage item={item} className="size-10" />
              {item.quantity} × {item.product_name}
            </span>
            <span className="font-code-sm text-[12px] text-on-surface-variant">
              {formatMoney(item.unit_price_kurus)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1 font-headline-sm text-[13px] font-bold text-on-surface">
          <span>Toplam</span>
          <span>{formatMoney(order.total_kurus)}</span>
        </div>
      </div>
    </div>
  );
}

const STAGES = [
  { label: "Sipariş Alındı", event: "label_created", icon: "receipt_long" },
  { label: "Paketlendi", event: "label_created", icon: "package_2" },
  { label: "Yolda / Aktarmada", event: "in_transit", icon: "local_shipping" },
  { label: "Teslimat", event: "delivered", icon: "home_pin" },
];

const MOBILE_STAGE_LABELS = ["Alındı", "Paket", "Yolda", "Teslim"];

const ACTIVE_STAGE: Record<Shipment["status"], number> = {
  label_created: 1,
  in_transit: 2,
  out_for_delivery: 2,
  delivered: 4,
};

const MOBILE_STATUS: Record<Shipment["status"], string> = {
  label_created: "Hazırlandı",
  in_transit: "Yolda",
  out_for_delivery: "Dağıtımda",
  delivered: "Teslim Edildi",
};

export function latestEvent(shipment: Shipment) {
  return shipment.events[shipment.events.length - 1];
}

/**
 * The four shipping stages with the current one highlighted. Each stage takes a quarter of the
 * width, so the line between the first and last centres runs from 12.5% to 87.5%.
 */
export function ShipmentProgress({ shipment }: { shipment: Shipment }) {
  const active = ACTIVE_STAGE[shipment.status];
  const latest = latestEvent(shipment);
  const progress = (Math.min(active, 3) / 3) * 75;
  return (
    <ol className="relative flex items-start justify-between w-full pt-1 pb-2">
      <span
        aria-hidden="true"
        className="absolute left-[12.5%] right-[12.5%] top-4 h-1 bg-surface-container-high rounded-full"
      />
      <span
        aria-hidden="true"
        className="absolute left-[12.5%] top-4 h-1 rounded-full bg-secondary"
        style={{ width: `${progress}%` }}
      />
      {STAGES.map((stage, index) => {
        const when = shipment.events.find((event) => event.status === stage.event);
        const state = index < active ? "done" : index === active ? "active" : "pending";
        return (
          <li key={stage.label} className="flex flex-1 flex-col items-center z-10">
            <span
              aria-current={state === "active" ? "step" : undefined}
              className={`w-8 h-8 rounded-full flex items-center justify-center ring-4 ${
                state === "done"
                  ? "bg-secondary text-on-secondary shadow-sm ring-surface-container-lowest"
                  : state === "active"
                    ? "bg-primary-container text-on-primary ring-primary/20 shadow-md animate-pulse"
                    : "bg-surface-container-high text-on-surface-variant ring-surface-container-lowest"
              }`}
            >
              <Icon
                name={state === "done" ? "check" : stage.icon}
                className={state === "active" ? "text-[18px]" : "text-[16px]"}
              />
            </span>
            <span className="flex flex-col items-center mt-2.5 text-center">
              <span
                className={`font-label-sm text-[11px] ${
                  state === "active"
                    ? "font-bold text-primary"
                    : state === "done"
                      ? "font-semibold text-on-surface"
                      : "text-on-surface-variant"
                }`}
              >
                {stage.label}
              </span>
              <span
                className={`font-code-sm text-[10px] mt-0.5 ${
                  state === "active" ? "font-medium text-primary" : "text-on-surface-variant"
                }`}
              >
                {state === "pending"
                  ? "Bekleniyor"
                  : state === "active"
                    ? (latest?.location ?? "")
                    : when
                      ? formatDateTime(when.occurred_at)
                      : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ShipmentCard({ shipment }: { shipment: Shipment }) {
  const latest = latestEvent(shipment);

  return (
    <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-space-md w-full border border-surface-variant/40">
      <div className="flex items-center justify-between gap-space-sm pb-space-xs">
        <div className="flex items-center gap-space-sm min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary-fixed flex items-center justify-center text-on-primary-fixed-variant shrink-0">
            <Icon name="package_2" className="text-[20px]" />
          </div>
          <div className="min-w-0">
            <h4 className="font-headline-sm text-headline-sm text-on-surface">
              Sipariş #{shipment.order_id}
            </h4>
            <span className="font-label-sm text-[12px] text-on-surface-variant">
              {shipment.carrier} Takip:{" "}
              <span className="font-code-sm font-semibold text-primary">
                {shipment.tracking_number}
              </span>
            </span>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-surface-container text-primary font-code-sm text-[11px] font-semibold shrink-0">
          Tahmini: {formatDate(shipment.estimated_delivery)}
        </span>
      </div>

      <div className="py-space-sm px-space-xs">
        <ShipmentProgress shipment={shipment} />
      </div>

      <div className="flex items-center justify-between gap-space-sm bg-surface-container-low rounded-lg p-space-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="near_me" className="text-primary text-[20px]" />
          {latest && (
            <span className="font-body-sm text-body-sm text-on-surface">
              <strong className="font-semibold">{latest.description}</strong> (
              {formatDateTime(latest.occurred_at)})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReturnCard({ request }: { request: ReturnRequest }) {
  const code = returnCode(request.id);
  return (
    <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-space-sm w-full border border-surface-variant/40">
      <div className="flex items-center justify-between gap-space-sm pb-space-xs">
        <div className="flex items-center gap-space-sm min-w-0">
          <div className="w-8 h-8 rounded-lg bg-secondary-container flex items-center justify-center text-on-secondary-fixed-variant shrink-0">
            <Icon name="assignment_return" className="text-[20px]" />
          </div>
          <div className="min-w-0">
            <h4 className="font-headline-sm text-headline-sm text-on-surface">
              İade Talebi Doğrulaması
            </h4>
            <span className="font-label-sm text-[12px] text-on-surface-variant">
              Sipariş: #{request.order_id}
            </span>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-md border border-secondary bg-card text-secondary font-code-sm text-[11px] font-semibold shrink-0">
          {RETURN_LABELS[request.status]}
        </span>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
        İade sebebi: {request.reason}
      </p>
      <div className="p-space-sm bg-surface-container-low rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-space-sm">
          <Icon name="barcode" className="text-primary text-[22px]" />
          <div>
            <div className="font-label-sm text-[11px] text-on-surface-variant">İade Kodu</div>
            <div className="font-headline-sm text-headline-sm font-bold tracking-wider text-on-surface">
              {code}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton
            text={code}
            label="Kodu Kopyala"
            className="px-3 py-1.5 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-sm text-label-sm font-semibold flex items-center gap-1 shadow-sm transition-colors"
          />
        </div>
      </div>
    </div>
  );
}

function MobileShipmentCard({ shipment }: { shipment: Shipment }) {
  const active = ACTIVE_STAGE[shipment.status];
  const latest = latestEvent(shipment);
  return (
    <div className="w-full bg-surface-container-lowest shadow-md rounded-xl p-space-md flex flex-col gap-space-sm">
      <div className="flex items-center justify-between pb-space-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0">
            <Icon name="local_shipping" className="text-[20px]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-headline-sm text-[14px] text-on-surface">
              #{shipment.order_id} Kargo Takibi
            </span>
            <span className="font-body-sm text-[12px] text-on-surface-variant truncate">
              {shipment.carrier}
            </span>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-md border border-secondary bg-card text-secondary font-label-sm text-[11px] font-bold shrink-0">
          {MOBILE_STATUS[shipment.status]}
        </span>
      </div>
      <div className="py-space-xs">
        <ol className="flex items-center justify-between relative px-2">
          <span
            aria-hidden="true"
            className="absolute left-6 right-6 top-3 h-1 bg-surface-container-high"
          />
          <span
            aria-hidden="true"
            className="absolute left-6 top-3 h-1 bg-secondary"
            style={{ width: `${(Math.min(active, 3) / 3) * 85}%` }}
          />
          {MOBILE_STAGE_LABELS.map((label, index) => (
            <li key={label} className="flex flex-col items-center gap-1 z-10">
              <span
                aria-current={index === active ? "step" : undefined}
                className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  index < active
                    ? "bg-secondary text-on-secondary"
                    : index === active
                      ? "bg-primary-container text-on-primary-container ring-4 ring-primary-fixed animate-pulse"
                      : "bg-surface-container-high text-outline"
                }`}
              >
                <Icon
                  name={index < active ? "check" : index === active ? "local_shipping" : "schedule"}
                  className="text-[13px]"
                />
              </span>
              <span
                className={`font-label-sm text-[10px] ${
                  index === active
                    ? "font-bold text-primary"
                    : index < active
                      ? "text-on-surface"
                      : "text-outline"
                }`}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="bg-surface-container-low rounded-lg p-space-sm flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-label-sm text-[11px] text-on-surface-variant">Tahmini Teslimat</span>
          <span className="font-headline-sm text-[13px] text-secondary font-bold">
            {formatDate(shipment.estimated_delivery)}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className="font-label-sm text-[11px] text-on-surface-variant">Takip No</span>
          <span className="font-code-sm text-code-sm text-on-surface font-semibold">
            {shipment.tracking_number}
          </span>
        </div>
      </div>
      {latest && (
        <p className="font-body-sm text-[12px] text-on-surface-variant">
          {latest.description} • {latest.location}
        </p>
      )}
    </div>
  );
}

function MobileReturnCard({ request }: { request: ReturnRequest }) {
  const code = returnCode(request.id);
  return (
    <div className="w-full bg-surface-container-lowest shadow-md rounded-xl p-space-md flex flex-col gap-space-sm">
      <div className="flex items-center justify-between pb-space-xs">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-secondary-container flex items-center justify-center text-on-secondary-fixed-variant">
            <Icon name="assignment_turned_in" className="text-[20px]" />
          </div>
          <div className="flex flex-col">
            <span className="font-headline-sm text-[14px] text-on-surface">İade Talebi Alındı</span>
            <span className="font-body-sm text-[12px] text-on-surface-variant">
              #{request.order_id}
            </span>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-md border border-secondary bg-card text-secondary font-label-sm text-[11px] font-bold">
          {RETURN_LABELS[request.status]}
        </span>
      </div>
      <div className="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-2">
        <span className="font-label-sm text-[11px] text-on-surface-variant">İade Kodu:</span>
        <div className="flex items-center justify-between bg-surface-container-lowest px-3 py-2 rounded-lg">
          <span className="font-code-sm text-[15px] font-bold tracking-wider text-primary">
            {code}
          </span>
          <CopyButton
            text={code}
            label="Kopyala"
            className="flex items-center gap-1 px-2 py-1 rounded bg-surface-container-high text-on-surface font-label-sm text-[11px] hover:bg-surface-variant transition-colors"
          />
        </div>
      </div>
    </div>
  );
}
