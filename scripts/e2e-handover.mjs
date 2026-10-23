import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];

await p.keyboard.press("Escape");
await p.waitForTimeout(400);

// clear the provider so the app is handed over unconfigured
await p.getByRole("button", { name: "Pengaturan (Ctrl+,)" }).click();
await p.waitForTimeout(400);
const field = (label) => p.locator(".modal label", { hasText: label }).locator("input").first();
await field("Base URL").fill("");
await field("API key").fill("");
await field("Model").fill("");
await p.getByRole("button", { name: "Simpan", exact: true }).click();
await p.waitForTimeout(600);

// keep only the sample deck
await p.locator(".tab", { hasText: "Proyek" }).click();
await p.waitForTimeout(600);
const readRows = () => p.locator(".project-row").evaluateAll((els) => els.map((e) => e.querySelector("strong")?.textContent ?? ""));
for (let guard = 0; guard < 20; guard++) {
  const rows = await readRows();
  const victim = rows.findIndex((t) => t !== "Editorial print — contoh");
  if (victim < 0) break;
  await p.locator(".project-row").nth(victim).locator('.icon-btn[title="Hapus"]').click();
  await p.waitForTimeout(700);
}
const finalRows = await readRows();
const pill = await p.locator(".model-pill, .pill").first().innerText().catch(() => "");
await p.screenshot({ path: "shots/handover.png" });
console.log(JSON.stringify({ finalRows, pill }));
await b.close();
