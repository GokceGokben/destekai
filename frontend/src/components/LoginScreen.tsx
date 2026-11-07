import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { ApiError, listDemoCustomers } from "../api";
import { HREF } from "../route";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { AppHeader } from "./AppHeader";
import { CustomerAvatar } from "./CustomerAvatar";
import { Icon } from "./Icon";
import { VIP_RING, VipPill } from "./CustomerCard";


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

function Header({ demo, aside }: { demo: boolean; aside?: ReactNode }) {
  return (
    <AppHeader>
      {aside}
      {demo && (
        <div className="flex items-center gap-space-xs px-space-sm py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant">
          <Icon name="science" className="text-[16px]" />
          <span className="font-label-sm text-label-sm font-semibold">Demo Açık</span>
        </div>
      )}
    </AppHeader>
  );
}

/** The customer cards, used by the demo picker and by an admin's customer list. */
export function CustomerGrid({
  customers,
  actionLabel,
  onSelect,
}: {
  customers: Customer[];
  actionLabel: string;
  onSelect: (customerId: string) => void;
}) {
  return (
    <div className="relative w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter items-stretch">
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
              onClick={() => onSelect(customer.id)}
            >
              {actionLabel}
              <Icon
                name="arrow_forward"
                className="text-[18px] transition-transform group-hover:translate-x-1"
              />
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

/** The login screen's frame, shared with an admin's customer list. */
export function PageShell({
  demo = false,
  aside,
  children,
}: {
  demo?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Header demo={demo} aside={aside} />
      <main className="w-full pt-16 bg-surface bg-pattern min-h-screen">
        <div className="relative w-full max-w-7xl mx-auto px-margin py-space-xl flex flex-col items-center gap-space-xl">
          {children}
        </div>
      </main>
    <footer className="w-full bg-surface-container-low shadow-[0_-1px_6px_rgba(0,0,0,0.02)] py-space-lg">
      <div className="w-full px-margin flex flex-col md:flex-row items-center justify-between gap-space-md font-body-sm text-body-sm text-on-surface-variant">
        <div className="flex flex-wrap items-center gap-space-md">
          <span className="font-medium text-on-surface">© {new Date().getFullYear()} DestekAI Bilişim A.Ş.</span>
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

const LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: "E-posta veya şifre hatalı.",
  too_many_attempts: "Çok fazla hatalı deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.",
};

export type LoginTab = "customer" | "admin";

/** The demo customers, or an empty list when the order API runs without DEV_LOGIN. */
function useDemoCustomers(): Customer[] | null {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  useEffect(() => {
    listDemoCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);
  return customers;
}

interface Props {
  initialTab?: LoginTab;
  onLogin: (tab: LoginTab, email: string, password: string) => Promise<void>;
}

export function LoginScreen({ initialTab = "customer", onLogin }: Props) {
  const demo = (useDemoCustomers() ?? []).length > 0;

  return (
    <PageShell demo={demo}>
      <section className="relative w-full max-w-md flex flex-col items-center text-center gap-space-sm">
        <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
          DestekAI'ye Giriş Yapın
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Müşteriler kendi siparişlerini, yöneticiler müşteri panellerini salt okunur görür.
        </p>
        <LoginForm initialTab={initialTab} onLogin={onLogin} />
        {demo && (
          <a
            href={HREF.demo}
            className="mt-space-xs font-label-md text-label-md text-primary hover:underline"
          >
            Demo müşterilerle dene →
          </a>
        )}
      </section>
    </PageShell>
  );
}

/** A separate page: pick a demo customer and sign in without a password (DEV_LOGIN only). */
export function DemoScreen({ onSelect }: { onSelect: (customerId: string) => Promise<void> }) {
  const customers = useDemoCustomers();
  const [failed, setFailed] = useState(false);

  return (
    <PageShell demo={Boolean(customers?.length)}>
      <section className="relative w-full max-w-3xl flex flex-col items-center text-center gap-space-sm">
        <a href={HREF.support} className="self-start font-label-md text-label-md text-primary hover:underline">
          ← Giriş ekranına dön
        </a>
        <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
          Demo Müşteri Seç
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Demo modunda şifresiz giriş: bir müşteri seçtiğinizde yalnızca onun göreceği paneli
          görürsünüz. Demo şifreleri README dosyasında yazılıdır.
        </p>
      </section>
      {customers?.length === 0 && (
        <p className="font-body-md text-body-md text-on-surface-variant">
          Demo girişi kapalı. Lütfen e-posta ve şifrenizle giriş yapın.
        </p>
      )}
      {failed && (
        <p
          role="alert"
          className="rounded-lg bg-error-container px-space-md py-space-sm text-on-error-container"
        >
          Giriş yapılamadı. Servislerin çalıştığını kontrol edin.
        </p>
      )}
      {customers && customers.length > 0 && (
        <CustomerGrid
          customers={customers}
          actionLabel="Giriş Yap"
          onSelect={(id) => onSelect(id).catch(() => setFailed(true))}
        />
      )}
    </PageShell>
  );
}

function LoginForm({ initialTab, onLogin }: { initialTab: LoginTab; onLogin: Props["onLogin"] }) {
  const [tab, setTab] = useState<LoginTab>(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(tab, email, password);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setError(LOGIN_ERRORS[code] ?? "Giriş yapılamadı. Lütfen biraz sonra tekrar deneyin.");
      setBusy(false);
    }
  }

  const inputClass =
    "rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm py-2 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Card className="w-full text-left dark:bg-[#2a2c30]">
      <CardContent className="flex flex-col gap-space-md">
        <Tabs value={tab} onValueChange={(value) => setTab(value as LoginTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="customer">Müşteri Girişi</TabsTrigger>
            <TabsTrigger value="admin">Yönetici Girişi</TabsTrigger>
          </TabsList>
        </Tabs>
        <form onSubmit={submit} className="flex flex-col gap-space-sm">
          <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
            E-posta
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
            Şifre
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          {error && (
            <p role="alert" className="font-body-sm text-body-sm text-error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy}
            className="w-full font-label-md text-label-md font-semibold bg-linear-to-r from-[#6b9787] to-[#3f6f69] text-[#fbf8ef] hover:from-[#5c8878] hover:to-[#33615b]"
          >
            {busy
              ? "Giriş yapılıyor..."
              : tab === "admin"
                ? "Yönetici Olarak Giriş Yap"
                : "Giriş Yap"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
