import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.keyboard.press("Escape");
await p.waitForTimeout(500);

// slide 1 selected, open the code tab
await p.locator(".thumb").first().click();
await p.waitForTimeout(600);
await p.locator(".tab", { hasText: "Kode" }).click();
await p.waitForTimeout(500);

const area = p.locator(".source textarea");
const original = await area.inputValue();
const edited = original.replace("Kerja bagus", "UJI RIWAYAT");
await area.fill(edited);
await p.waitForTimeout(1800);

// reload so the save is definitely flushed, then look at the history
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
await p.locator(".tab", { hasText: "Desain" }).click();
await p.waitForTimeout(1200);

const rows = await p.locator(".rev-row").count();
const textNow = await p.evaluate(() => document.querySelector(".board iframe")?.contentDocument?.body?.innerText.slice(0, 40) ?? "");

let restoredText = "";
let toast = "";
if (rows > 0) {
  await p.locator(".rev-row").first().getByText("Pulihkan").click();
  await p.waitForTimeout(2500);
  toast = await p.locator(".toast").innerText().catch(() => "");
  restoredText = await p.evaluate(() => document.querySelector(".board iframe")?.contentDocument?.body?.innerText.slice(0, 40) ?? "");
}

await p.screenshot({ path: "shots/e2e-history.png" });
console.log(JSON.stringify({ editedApplied: textNow, revisions: rows, toast, restoredText }, null, 1));
await b.close();
