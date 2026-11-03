import { useCallback, useState } from "react";

import { login } from "./api";
import { LoginScreen } from "./components/LoginScreen";
import { SupportScreen } from "./components/SupportScreen";
import type { Customer } from "./types";

interface Session {
  token: string;
  customer: Customer;
}

export function App() {
  // Memory only: a token in localStorage would be readable by any injected script.
  const [session, setSession] = useState<Session | null>(null);

  const logout = useCallback(() => setSession(null), []);

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
