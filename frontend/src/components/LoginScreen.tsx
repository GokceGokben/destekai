import { useEffect, useState } from "react";

import { listDemoCustomers } from "../api";
import { formatPoints } from "../format";
import type { Customer } from "../types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { AppHeader } from "./AppHeader";
import { CustomerAvatar } from "./CustomerAvatar";
import { Icon } from "./Icon";
import { VIP_RING, VipPill } from "./OrdersPanel";


// What the seed data sets up for each customer, so a tester can pick a scenario.
const SCENARIOS: Record<string, string> = {
  "CUS-1001": "İade edilebilir teslimat, kargodaki ve hazırlanan siparişler.",
  "CUS-1002": "İade süresi dolmuş sipariş, açık iade talebi ve iptal.",
  "CUS-1003": "İade süresinin son günü, dağıtımdaki kargo ve ücret iadesi.",
  "CUS-1004": "İade edilebilir teslimat ve reddedilmiş iade talebi.",
  "CUS-1005": "Geciken kargo, iade edilebilir teslimat ve iptal.",
  "CUS-1006": "Süresi dolmuş ve iade edilebilir teslimatlar.",
  "CUS-1007": "Onaylanmış iade ve süresi yeni dolmuş sipariş.",
  "CUS-1008": "İade edilebilir teslimat ve hazırlanan sipariş.",
  "CUS-1009": "Kargodaki sipariş, iade edilebilir teslimat ve iptal.",
  "CUS-1010": "İade edilebilir teslimat ve sipariş geçmişi.",
};

function TierBadge({ tier }: { tier: Customer["tier"] }) {
  if (tier === "vip") return <VipPill />;
  if (tier === "new") {
    return (
      <div className="inline-flex items-center gap-1 px-space-sm py-1 rounded-md border border-secondary bg-card text-secondary">
        <Icon name="eco" filled className="text-[15px]" />
        <span className="font-label-sm text-label-sm font-semibold">Yeni Müşteri</span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1 px-space-sm py-1 rounded-md border border-[#0037b0] bg-card text-[#0037b0] dark:border-blue-400 dark:text-blue-300">
      <Icon name="verified_user" filled className="text-[15px]" />
      <span className="font-label-sm text-label-sm font-semibold">Standart Müşteri</span>
    </div>
  );
}

function Header() {
  return (
    <AppHeader>
      {/* This screen stands in for each customer's own login; it grants no admin rights. */}
      <div className="flex items-center gap-space-xs px-space-sm py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant">
        <Icon name="science" className="text-[16px]" />
        <span className="font-label-sm text-label-sm font-semibold">Demo Girişi</span>
      </div>
    </AppHeader>
  );
}

interface Props {
  onSelect: (customerId: string) => Promise<void>;
}

export function LoginScreen({ onSelect }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listDemoCustomers()
      .then(setCustomers)
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <Header />
      <main className="w-full pt-16 bg-surface bg-pattern min-h-screen">
        <div className="relative w-full max-w-7xl mx-auto px-margin py-space-xl flex flex-col items-center">
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary-fixed/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-40 right-10 w-72 h-72 bg-primary-fixed/20 rounded-full blur-3xl pointer-events-none" />
          <div className="relative w-full max-w-3xl text-center mb-space-xl flex flex-col items-center">
            <div className="inline-flex items-center gap-space-xs px-space-md py-1 rounded-full bg-surface-container-high text-on-primary-fixed-variant shadow-sm mb-space-md">
              <Icon name="switch_account" filled className="text-[16px] text-primary" />
              <span className="font-code-sm text-code-sm uppercase tracking-wider">
                Simülasyon Ortamı
              </span>
              <span className="text-outline-variant">•</span>
              <span className="font-label-sm text-label-sm text-primary font-semibold">
                Test Modu v2.4
              </span>
            </div>
            <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight mb-space-sm">
              Demo Müşteri Seç
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl leading-relaxed">
              Gerçek uygulamada her müşteri kendi hesabıyla giriş yapar. Bu demo ekranında bir
              müşteri seçtiğinizde, yalnızca o müşterinin göreceği paneli görürsünüz.
            </p>
          </div>

          {failed && (
            <p
              role="alert"
              className="relative mb-space-md rounded-lg bg-error-container px-space-md py-space-sm text-on-error-container"
            >
              Müşteriler yüklenemedi. Servislerin çalıştığını kontrol edin.
            </p>
          )}

          <div className="relative w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter items-stretch mb-space-xl">
            {customers.map((customer) => (
              <Card key={customer.id} className="group relative w-full dark:bg-[#2a2c30]">
                <div className="flex items-start justify-between gap-space-sm px-6">
                  <div
                    className={cn(
                      "relative w-16 h-16 rounded-full bg-surface-container shadow-sm flex items-center justify-center font-headline-md text-headline-md text-primary",
                      customer.tier === "vip" && VIP_RING,
                    )}
                  >
                    <CustomerAvatar customer={customer} />
                    <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-secondary ring-2 ring-card" />
                  </div>
                  <TierBadge tier={customer.tier} />
                </div>
                <CardHeader>
                  <CardTitle className="font-headline-md text-headline-md">
                    {customer.full_name}
                  </CardTitle>
                  <CardDescription className="font-code-sm text-code-sm">
                    {customer.email}{" "}
                    <span className="whitespace-nowrap">
                      <span className="text-outline-variant">•</span> {customer.id}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-space-md">
                  <div className="grid grid-cols-2 gap-space-xs bg-surface-container-low p-space-sm rounded-lg">
                    <div className="flex flex-col">
                      <span className="font-code-sm text-code-sm text-on-surface-variant">
                        Toplam Sipariş
                      </span>
                      <span className="font-headline-sm text-headline-sm text-on-surface font-semibold mt-0.5">
                        {customer.order_count} Adet
                      </span>
                    </div>
                    <div className="flex flex-col pl-space-xs">
                      <span className="font-code-sm text-code-sm text-on-surface-variant">
                        Sadakat Puanı
                      </span>
                      <span className="font-headline-sm text-headline-sm text-accent-orange font-semibold mt-0.5">
                        {formatPoints(customer.loyalty_points)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-space-xs">
                      <Icon name="psychology" className="text-[16px] text-primary" />
                      <span className="font-label-sm text-label-sm text-on-surface font-semibold">
                        Senaryo Özeti
                      </span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant bg-surface-container-low/60 p-space-sm rounded-lg leading-snug">
                      {SCENARIOS[customer.id]}
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="mt-auto">
                  <Button
                    className="w-full font-label-md text-label-md font-semibold bg-linear-to-r from-[#6b9787] to-[#3f6f69] text-[#fbf8ef] hover:from-[#5c8878] hover:to-[#33615b]"
                    onClick={() => onSelect(customer.id).catch(() => setFailed(true))}
                  >
                    Giriş Yap
                    <Icon
                      name="arrow_forward"
                      className="text-[18px] transition-transform group-hover:translate-x-1"
                    />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <footer className="w-full bg-surface-container-low shadow-[0_-1px_6px_rgba(0,0,0,0.02)] py-space-lg">
        <div className="w-full px-margin flex flex-col md:flex-row items-center justify-between gap-space-md font-body-sm text-body-sm text-on-surface-variant">
          <div className="flex flex-wrap items-center gap-space-md">
            <span className="font-medium text-on-surface">© 2025 DestekAI Bilişim A.Ş.</span>
            <span className="hidden md:inline text-outline-variant">|</span>
            <div className="flex items-center gap-space-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
              <span className="font-label-sm text-label-sm text-on-secondary-container">
                Sistemler Operasyonel • %99.98 Uptime
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-space-lg font-label-sm text-label-sm">
            <span>KVKK Aydınlatma Metni</span>
            <span>Veri Güvenliği Politikası</span>
            <span>API &amp; Durum Panosu</span>
            <span>İletişim &amp; Destek</span>
          </div>
        </div>
      </footer>
    </>
  );
}
