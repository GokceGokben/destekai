import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Mirrors nginx.conf, so the browser sees one origin in development as well.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
