import type { Customer, Order, ReturnRequest } from "./types";

const money = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2 });
const points = new Intl.NumberFormat("tr-TR");
const date = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});
const time = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

export function formatMoney(kurus: number): string {
  return `${money.format(kurus / 100)} ₺`;
}

export function formatPoints(value: number): string {
  return `${points.format(value)} TP`;
}

export function formatDate(value: string): string {
  return date.format(new Date(value));
}

export function formatDateTime(value: string): string {
  return dateTime.format(new Date(value));
}

export function formatTime(value: Date): string {
  return time.format(value);
}

export function memberSince(years: number): string {
  return years === 0 ? "Yeni Üye" : `${years} Yıldır Üye`;
}

export function initials(customer: Customer): string {
  return customer.full_name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

export function orderTitle(order: Order): string {
  const [first, ...rest] = order.items;
  if (!first) return "Sipariş";
  if (rest.length === 0) return first.product_name;
  const names = order.items.map((item) => item.product_name).join(", ");
  return `${names} (${order.items.length} ürün)`;
}

export function returnCode(returnId: string): string {
  return `IAD-${returnId.slice(0, 4).toUpperCase()}`;
}

export const RETURN_LABELS: Record<ReturnRequest["status"], string> = {
  requested: "Talep Alındı",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  refunded: "Ücret İade Edildi",
};

interface Badge {
  label: string;
  classes: string;
  dot: boolean;
}

// Outlined on the card background: the colour carries the status without a loud fill.
const ORDER_BADGES: Record<Order["status"], Badge> = {
  preparing: {
    label: "Hazırlanıyor",
    classes: "border bg-card border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-300",
    dot: true,
  },
  shipped: {
    label: "Kargoda",
    classes: "border bg-card border-blue-500 text-blue-700 dark:border-blue-400 dark:text-blue-300",
    dot: false,
  },
  delivered: {
    label: "Teslim Edildi",
    classes: "border bg-card border-emerald-500 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300",
    dot: false,
  },
  cancelled: {
    label: "İptal Edildi",
    classes: "border bg-card border-outline text-on-surface-variant",
    dot: false,
  },
};

/** A live return says more about the order than its delivery status does. */
export function orderBadge(order: Order): Badge {
  if (!order.return_status) return ORDER_BADGES[order.status];
  return {
    label: order.return_status === "refunded" ? "Ücret İade Edildi" : "İade Sürecinde",
    classes: "border bg-card border-error text-error",
    dot: false,
  };
}
