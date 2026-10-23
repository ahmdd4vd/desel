import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.launch({ executablePath: "C:\\Users\\david\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });

const mk = (n) => `<!doctype html><html><head><style>html,body{margin:0;width:1080px;height:1350px;background:#111;color:#eee;font-family:Georgia}h1{position:absolute;left:90px;top:300px;font-size:160px;margin:0}</style></head><body><h1>${n}</h1></body></html>`;
await p.evaluate((htmls) => {
  const now = new Date().toISOString();
  localStorage.setItem("desel.v2.decks", JSON.stringify([{ id: "d1", title: "Reorder", caption: "", aspect: "4:5",
    slides: ["A","B","C"].map((t, i) => ({ id: "s" + i, title: t, html: htmls[i], rationale: "", hidden: false })),
    styleGuide: "", palette: [], brandHandle: "", saveLabel: "Save", fromTemplateId: null, createdAt: now, updatedAt: now }]));
}, ["A","B","C"].map(mk));
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1300);

const before = await p.locator(".thumb-title").evaluateAll(els => els.map(e => e.textContent));
await p.locator(".thumb").nth(2).dragTo(p.locator(".thumb").nth(0));
await p.waitForTimeout(900);
const after = await p.locator(".thumb-title").evaluateAll(els => els.map(e => e.textContent));
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("desel.v2.decks") || "[]")[0].slides.map(s => s.title));
await p.screenshot({ path: "shots/final-reorder.png" });
console.log(JSON.stringify({ before, after, stored, errors }, null, 1));
await b.close();
