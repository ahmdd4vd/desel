import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.launch({ executablePath: (process.env.CHROME_BIN || "chromium"), headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.log("pageerror:", String(e)));
await p.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await p.evaluate(() => {
  const now = new Date().toISOString();
  const html = `<style>body{margin:0;width:1080px;height:1350px;background:#0d0c0b;color:#f1ebe0;font-family:Georgia,serif}h1{position:absolute;left:96px;top:300px;margin:0;font-size:140px}</style><h1>Cover</h1>`;
  localStorage.setItem("desel.v2.decks", JSON.stringify([{ id: "d1", title: "Ref test", caption: "", aspect: "4:5", slides: [{ id: "s1", title: "Cover", html, rationale: "", hidden: false }], styleGuide: "", palette: [], brandHandle: "", saveLabel: "Save", fromTemplateId: null, createdAt: now, updatedAt: now }]));
});
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1200);

const before = await p.locator(".ref").count();
await p.locator('input[type="file"]').setInputFiles(["referensi/ref1/cover1.jpg", "referensi/ref2/cover2.jpg"]);
await p.waitForTimeout(1200);
const after = await p.locator(".ref").count();
const imgs = await p.locator(".ref img").evaluateAll((els) => els.map((e) => ({ w: e.naturalWidth, h: e.naturalHeight })));
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("desel.v2.refs") || "[]").length);
const note = await p.locator(".refs-note").count();
await p.screenshot({ path: "shots/final-refs.png" });
console.log(JSON.stringify({ before, after, imgs, stored, note }, null, 2));

// removal
await p.locator(".ref").first().hover();
await p.locator(".ref-x").first().click({ force: true });
await p.waitForTimeout(500);
console.log("after remove:", await p.locator(".ref").count(), "stored:", await p.evaluate(() => JSON.parse(localStorage.getItem("desel.v2.refs") || "[]").length));
await b.close();
