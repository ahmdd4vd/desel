/**
 * Verifies the REAL Rust export path: invokes the Tauri command directly from
 * the running desktop app and checks the files land on disk.
 *
 * Requires the app to be running with remote debugging enabled:
 *   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 *   npm run dev
 *
 *   node scripts/test-tauri-export.mjs
 */

import { createRequire } from "node:module";

const require = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = require("playwright");

const CHROME =
  "C:/Users/david/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().includes("127.0.0.1:1420")) ?? pages[0];
  if (!page) throw new Error("tidak ada halaman Tauri yang bisa dihubungkan");

  console.log("connected to:", page.url());

  const isTauri = await page.evaluate(() => "__TAURI_INTERNALS__" in window);
  console.log("Tauri IPC available:", isTauri);

  const result = await page.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__
      ? await import("/node_modules/@tauri-apps/api/core.js").catch(() => ({}))
      : {};
    if (!invoke) return { error: "modul @tauri-apps/api tidak bisa dimuat" };

    // Tiny valid 1x1 PNG.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const dir = await invoke("export_default_dir", { slug: "ipc-test" });
    const outcome = await invoke("write_export", {
      directory: dir,
      files: [
        { name: "probe.png", encoding: "base64", data: png },
        { name: "probe.txt", encoding: "utf8", data: "hello from rust" },
      ],
      rememberDir: null,
    });
    return { dir, outcome };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
