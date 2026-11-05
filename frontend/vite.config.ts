import { readFile } from "node:fs/promises";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The development twin of nginx's /reports/latest.json, with the same admin check.
function evalReport(): Plugin {
  const file = new URL("../evals/reports/latest.json", import.meta.url);
  return {
    name: "eval-report",
    configureServer(server) {
      server.middlewares.use("/reports/latest.json", async (req, res) => {
        const check = await fetch("http://127.0.0.1:8080/v1/admin/me", {
          headers: { Authorization: req.headers.authorization ?? "" },
        }).catch(() => null);
        if (!check?.ok) {
          res.statusCode = check?.status ?? 502;
          res.end();
          return;
        }
        readFile(file)
          .then((body) => {
            res.setHeader("Content-Type", "application/json");
            res.end(body);
          })
          .catch(() => {
            res.statusCode = 404;
            res.end();
          });
      });
    },
  };
}

// Mirrors nginx.conf, so the browser sees one origin in development as well.
export default defineConfig({
  plugins: [react(), tailwindcss(), evalReport()],
  // The import style shadcn/ui components use. "@/" with the slash, so that scoped
  // packages such as @testing-library are not rewritten.
  resolve: {
    alias: [{ find: /^@\//, replacement: "/src/" }],
  },
  server: {
    proxy: {
      "/api/agent": {
        target: "http://127.0.0.1:8000",
        rewrite: (path) => path.replace(/^\/api\/agent/, ""),
      },
      "/api/order": {
        target: "http://127.0.0.1:8080",
        rewrite: (path) => path.replace(/^\/api\/order/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
