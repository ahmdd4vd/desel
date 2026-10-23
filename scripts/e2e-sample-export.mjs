import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];

// make sure the export dialog is open
if (!(await p.locator(".modal").count())) {
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Export" }).click();
  await p.waitForTimeout(600);
}
await p.getByRole("button", { name: "Export", exact: true }).last().click();
for (let i = 0; i < 40; i++) {
  const toast = await p.locator(".toast").innerText().catch(() => "");
  if (/selesai/i.test(toast)) break;
  await p.waitForTimeout(1000);
}
const toast = await p.locator(".toast").innerText().catch(() => "");

await p.keyboard.press("Escape");
await p.waitForTimeout(500);
await p.screenshot({ path: "shots/e2e-sample-studio.png" });
await p.locator(".board iframe").first().screenshot({ path: "shots/sample-cover.png" });
console.log(JSON.stringify({ toast }));
await b.close();
