import { useEffect, useState } from "react";

// Hash routes: three screens do not need a router library, and a hash survives a reload
// behind nginx's single index.html without any server rules.
export type Route =
  | { page: "support" }
  | { page: "demo" }
  | { page: "admin" }
  | { page: "replay"; id: string };

export function parseRoute(hash: string): Route {
  const replay = /^#\/admin\/([a-z0-9-]+)$/.exec(hash);
  if (replay) return { page: "replay", id: replay[1] };
  if (hash === "#/admin") return { page: "admin" };
  if (hash === "#/demo") return { page: "demo" };
  return { page: "support" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

export const HREF = {
  support: "#/",
  demo: "#/demo",
  admin: "#/admin",
  replay: (id: string) => `#/admin/${id}`,
};
