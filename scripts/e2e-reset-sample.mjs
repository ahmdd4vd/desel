import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];

await p.reload();
await p.waitForSelector(".cv", { timeout: 30000 });
await p.waitForTimeout(1000);
await p.keyboard.press("Escape");

// drop the sample deck (takes its pins + versions with it), then load it fresh
await p.locator(".tab", { hasText: "Proyek" }).click();
await p.waitForTimeout(500);
const row = p.locator(".project-row", { hasText: "Editorial print" }).first();
if (await row.count()) {
  await row.locator('[title="Hapus"]').click();
  await p.waitForTimeout(900);
}
await p.locator(".tab", { hasText: "Chat" }).click();
await p.waitForTimeout(500);
const ghost = p.locator(".starter-ghost", { hasText: "Muat contoh" });
if (await ghost.count()) {
  await ghost.click();
} else {
  await p.locator(".tab", { hasText: "Proyek" }).click();
  await p.waitForTimeout(300);
  await p.getByText("Contoh", { exact: true }).first().click();
}
await p.waitForTimeout(1600);
const state = await p.evaluate(() => ({
  thumbs: document.querySelectorAll(".thumb").length,
  pins: document.querySelectorAll(".cv-pin").length,
  title: document.querySelector(".topbar input")?.value ?? "",
}));
console.log(JSON.stringify(state));
await b.close();
