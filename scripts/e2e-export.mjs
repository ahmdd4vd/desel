import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.keyboard.press("Escape");
await p.waitForTimeout(400);

await p.getByRole("button", { name: "Export" }).click();
await p.waitForTimeout(700);

// turn on PDF as well (PNG and caption are already on)
const boxes = p.locator(".modal input[type=checkbox]");
const count = await boxes.count();
for (let i = 0; i < count; i++) {
  if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
}

await p.getByRole("button", { name: "Export", exact: true }).last().click();
await p.waitForTimeout(1000);
// export runs in the background with a toast when done
for (let i = 0; i < 60; i++) {
  const toast = await p.locator(".toast").innerText().catch(() => "");
  if (/selesai|tersimpan|Export/i.test(toast) && !/memproses|menyiapkan/i.test(toast)) break;
  await p.waitForTimeout(1000);
}
const toast = await p.locator(".toast").innerText().catch(() => "");
console.log(JSON.stringify({ toast }));
await b.close();
