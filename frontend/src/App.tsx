import { useCallback, useState } from "react";

import { login } from "./api";
import { AdminScreen } from "./components/AdminScreen";
import { LoginScreen } from "./components/LoginScreen";
import { ReplayScreen } from "./components/ReplayScreen";
import { SupportScreen } from "./components/SupportScreen";
import { useRoute } from "./route";
import type { Customer } from "./types";

interface Session {
  token: string;
  customer: Customer;
}

export function App() {
  // Memory only: a token in localStorage would be readable by any injected script.
  const [session, setSession] = useState<Session | null>(null);

  const logout = useCallback(() => setSession(null), []);
  const route = useRoute();

  // The admin pages need no customer session. Phase 7 puts them behind an admin login; the
  // report they read holds only seed data.
  if (route.page === "admin") return <AdminScreen />;
  if (route.page === "replay") return <ReplayScreen id={route.id} />;

  if (!session) {
    return <LoginScreen onSelect={async (id) => setSession(await login(id))} />;
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
