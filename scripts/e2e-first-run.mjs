import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);
const out = await p.evaluate(() => ({
  title: document.querySelector(".topbar input")?.value ?? "",
  thumbs: document.querySelectorAll(".thumb").length,
  badges: document.querySelectorAll(".thumb-lint").length,
  tabs: [...document.querySelectorAll(".tab")].map((t) => t.textContent.trim()),
}));
await p.screenshot({ path: "shots/first-run.png" });
console.log(JSON.stringify(out));
await b.close();
