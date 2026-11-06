import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vitest runs in frontend/, which the paths are relative to. jsdom gives import.meta.url an
// http scheme, so it cannot point at the files.
// nginx allows the inline theme script in index.html by its hash. Editing the script
// without updating security-headers.conf would block it in production, silently.
test("the CSP allows exactly the inline script in index.html", () => {
  const html = readFileSync(resolve("index.html"), "utf8");
  const headers = readFileSync(resolve("security-headers.conf"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(script).toBeDefined();

  const hash = createHash("sha256").update(script!).digest("base64");
  expect(headers).toContain(`'sha256-${hash}'`);
});
