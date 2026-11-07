import { useCallback, useState } from "react";

import { adminLogin, login, openCustomerView, passwordLogin } from "./api";
import { AdminHome } from "./components/AdminHome";
import { AdminScreen } from "./components/AdminScreen";
import { DemoScreen, LoginScreen, type LoginTab } from "./components/LoginScreen";
import { ReplayScreen } from "./components/ReplayScreen";
import { SupportScreen } from "./components/SupportScreen";
import { HREF, useRoute } from "./route";
import type { Admin, Customer } from "./types";

type Session =
  | { kind: "customer"; token: string; customer: Customer }
  | { kind: "admin"; token: string; admin: Admin };

/** A customer's panel opened by an admin, with its own short read-only token. */
interface View {
  token: string;
  customer: Customer;
}

export function App() {
  // Memory only: a token in localStorage would be readable by any injected script.
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View | null>(null);
  const route = useRoute();

  const logout = useCallback(() => {
    setSession(null);
    setView(null);
  }, []);
  const closeView = useCallback(() => setView(null), []);

  const signIn = useCallback(async (tab: LoginTab, email: string, password: string) => {
    if (tab === "admin") {
      const { token, admin } = await adminLogin(email, password);
      setSession({ kind: "admin", token, admin });
    } else {
      const { token, customer } = await passwordLogin(email, password);
      setSession({ kind: "customer", token, customer });
    }
  }, []);

  const admin = session?.kind === "admin" ? session : null;

  // The evaluation pages are for admins; nginx also refuses the report without an admin token.
  if (route.page === "admin" || route.page === "replay") {
    if (!admin) {
      return <LoginScreen initialTab="admin" onLogin={signIn} />;
    }
    return route.page === "admin" ? (
      <AdminScreen token={admin.token} onLogout={logout} />
    ) : (
      <ReplayScreen id={route.id} token={admin.token} onLogout={logout} />
    );
  }

  if (!session) {
    if (route.page === "demo") {
      return (
        <DemoScreen
          onSelect={async (id) => {
            setSession({ kind: "customer", ...(await login(id)) });
            window.location.hash = HREF.support;
          }}
        />
      );
    }
    return <LoginScreen onLogin={signIn} />;
  }

  if (session.kind === "admin") {
    if (view) {
      return (
        <SupportScreen
          key={`view-${view.customer.id}`}
          token={view.token}
          customer={view.customer}
          viewer={session.admin}
          onLogout={closeView}
        />
      );
    }
    return (
      <AdminHome
        token={session.token}
        onOpen={async (id) => setView(await openCustomerView(session.token, id))}
        onLogout={logout}
      />
    );
  }

  return (
    <SupportScreen
      key={session.customer.id}
      token={session.token}
      customer={session.customer}
      onLogout={logout}
    />
  );
}
