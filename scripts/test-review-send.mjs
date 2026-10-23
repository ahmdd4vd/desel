import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.launch({ executablePath: "C:\\Users\\david\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });

const html = `<!doctype html><html><head><style>html,body{margin:0;width:1080px;height:1350px;background:#101010;color:#eee;font-family:Georgia}h1{position:absolute;left:90px;top:300px;font-size:150px;margin:0}</style></head><body><h1>Review</h1></body></html>`;
await p.evaluate((html) => {
  const now = new Date().toISOString();
  localStorage.setItem("desel.v2.decks", JSON.stringify([{ id: "d1", title: "Review deck", caption: "", aspect: "4:5",
    slides: [{ id: "s1", title: "Cover", html, rationale: "", hidden: false }, { id: "s2", title: "Isi", html, rationale: "", hidden: false }],
    styleGuide: "", palette: [], brandHandle: "", saveLabel: "Save", fromTemplateId: null, createdAt: now, updatedAt: now }]));
  localStorage.setItem("desel.v2.comments", JSON.stringify([
    { id: "c1", deckId: "d1", slideId: "s1", x: 0.5, y: 0.3, body: "Headline kekecilan, naikin 20%.", author: "user", status: "open", createdAt: now },
    { id: "c2", deckId: "d1", slideId: "s2", x: 0.2, y: 0.7, body: "Kontras teks kurang.", author: "user", status: "open", createdAt: now },
  ]));
}, html);
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1500);

await p.locator(".tab", { hasText: "Catatan" }).click();
await p.waitForTimeout(500);
await p.getByText("Kirim ke agent", { exact: true }).click();
await p.waitForTimeout(500);
const draft = await p.locator("textarea[placeholder^='Tulis brief']").inputValue();

// per-slide revision action
await p.locator(".tab", { hasText: "Desain" }).click();
await p.waitForTimeout(400);
await p.getByText("Minta revisi slide ini", { exact: true }).click();
await p.waitForTimeout(400);
const slideDraft = await p.locator("textarea[placeholder^='Tulis brief']").inputValue();
await p.screenshot({ path: "shots/final-review-send.png" });
console.log(JSON.stringify({ draft, slideDraft, errors }, null, 1));
await b.close();
