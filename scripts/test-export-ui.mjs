import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";

const globalRequire = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = globalRequire("playwright");
const EXE = (process.env.CHROME_BIN || "chromium");

const slide = `<style>body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#0d0c0b;
  color:#f1ebe0;font-family:Georgia,serif}h1{position:absolute;left:96px;top:300px;margin:0;
  font-size:140px;line-height:.92}.g{position:absolute;inset:0;opacity:.18;background:
  radial-gradient(circle at 1px 1px,#ffffff2e 1px,transparent 0);background-size:6px 6px}
  .k{position:absolute;left:96px;top:140px;font:22px Arial;letter-spacing:.28em;color:#c6f54e}</style>
  <div class="g"></div><div class="k">CATATAN</div><h1>Kerja bagus<br>tidak cukup.</h1>`;

mkdirSync("shots/export", { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);

await page.evaluate((html) => {
  const now = new Date().toISOString();
  const deck = {
    id: "deck_export", title: "Export test", caption: "Caption test", aspect: "4:5",
    slides: [0, 1].map((i) => ({ id: `sl_${i}`, title: `Slide ${i + 1}`, html, rationale: "", hidden: false })),
    styleGuide: "Editorial print", palette: ["#c6f54e"], brandHandle: "@desel",
    saveLabel: "Save", fromTemplateId: null, createdAt: now, updatedAt: now,
  };
  localStorage.setItem("desel.v2.decks", JSON.stringify([deck]));
}, slide);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const downloads = [];
page.on("download", async (d) => {
  const name = d.suggestedFilename();
  const path = `shots/export/${name}`;
  await d.saveAs(path);
  downloads.push({ name, bytes: existsSync(path) ? statSync(path).size : 0 });
});

await page.getByRole("button", { name: "Export", exact: true }).click();
await page.waitForTimeout(400);
// turn on PDF too
const pdfBox = page.locator(".export-option").nth(1).locator("input");
if (!(await pdfBox.isChecked())) await pdfBox.check();
await page.getByRole("button", { name: "Export", exact: true }).last().click();

await page.waitForTimeout(9000);

console.log("downloads:", downloads);
console.log("errors:", errors.length ? errors : "none");

// verify PNG dimensions from the saved file header
for (const d of downloads.filter((x) => x.name.endsWith(".png"))) {
  const buf = (await import("node:fs")).readFileSync(`shots/export/${d.name}`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const sig = buf.subarray(1, 4).toString("ascii");
  console.log(`${d.name}: ${sig}, ${w}x${h}, ${d.bytes} bytes`);
}

await browser.close();
