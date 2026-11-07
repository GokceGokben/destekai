import { useEffect, useState } from "react";

import { listAdminCustomers, UnauthorizedError } from "../api";
import { HREF } from "../route";
import type { Customer } from "../types";
import { Icon } from "./Icon";
import { CustomerGrid, PageShell } from "./LoginScreen";

/** Who is signed in as admin, with a way out. Shown on every admin page. */
export function AdminBadge({ onLogout }: { onLogout: () => void }) {
  return (
    <button
      type="button"
      onClick={onLogout}
      title="Çıkış Yap"
      className="flex items-center gap-space-xs pl-space-xs border-l border-surface-variant"
    >
      <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <Icon name="admin_panel_settings" className="text-[18px]" />
      </span>
      <span className="hidden xl:flex flex-col text-left leading-tight">
        <span className="font-label-sm text-xs font-semibold text-on-surface">Yönetici</span>
        <span className="font-code-sm text-[10px] text-on-surface-variant">Çıkış yap</span>
      </span>
    </button>
  );
}

interface Props {
  token: string;
  onOpen: (customerId: string) => Promise<void>;
  onLogout: () => void;
}

/** An admin's start page: every customer, each opened read-only. */
export function AdminHome({ token, onOpen, onLogout }: Props) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listAdminCustomers(token)
      .then(setCustomers)
      .catch((error) => (error instanceof UnauthorizedError ? onLogout() : setFailed(true)));
  }, [token, onLogout]);

  return (
    <PageShell aside={<AdminBadge onLogout={onLogout} />}>
      <section className="relative text-center max-w-2xl flex flex-col items-center gap-space-sm">
        <span className="inline-flex items-center gap-1.5 px-space-md py-1 rounded-full bg-surface-container-high font-code-sm text-code-sm text-primary">
          <Icon name="visibility" className="text-[16px]" /> SALT OKUNUR GÖRÜNÜM
        </span>
        <h1 className="font-headline-xl text-headline-xl text-on-surface">Müşteriler</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Bir müşterinin panelini, onun gördüğü gibi açarsınız. İade açmak gibi işlemler bu
          görünümden yapılamaz ve her görüntüleme kayda geçer.
        </p>
        <a href={HREF.admin} className="font-label-md text-label-md text-primary hover:underline">
          Değerlendirme panelini aç →
        </a>
      </section>
      {failed && (
        <p role="alert" className="rounded-lg bg-error-container px-space-md py-space-sm text-on-error-container">
          Müşteriler yüklenemedi veya panel açılamadı. Lütfen tekrar deneyin.
        </p>
      )}
      {customers && (
        <CustomerGrid
          customers={customers}
          actionLabel="Paneli Görüntüle"
          onSelect={(id) => onOpen(id).catch(() => setFailed(true))}
        />
      )}
    </PageShell>
  );
}
