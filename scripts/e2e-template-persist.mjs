import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
await p.getByRole("button", { name: "Template", exact: true }).click();
await p.waitForTimeout(700);
const rows = await p.locator(".template-row").count();
const names = await p.locator(".template-row strong").evaluateAll(els => els.map(e => e.textContent));

// use it: a new deck should inherit the slides
await p.locator(".template-row button").first().click();
await p.waitForTimeout(1800);
const thumbs = await p.locator(".thumb").count();
const deckTitle = await p.locator(".topbar input").first().inputValue().catch(() => "");
await p.screenshot({ path: "shots/e2e-from-template.png" });
console.log(JSON.stringify({ rows, names, thumbs, deckTitle }, null, 1));
await b.close();
