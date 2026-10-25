import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.launch({ executablePath: (process.env.CHROME_BIN || "chromium"), headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.log("pageerror:", String(e)));
await p.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });

const slop = `<!doctype html><html><body style="margin:0;width:1080px;height:1350px;background:linear-gradient(#6a5cff,#3aa0ff)">
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;height:100%">
<h1 style="text-align:center;font-size:64px;color:#7b61ff">5 Tips Produktivitas</h1>
<div style="border-radius:16px;background:#8b5cf6;width:600px;height:100px"></div>
<div style="border-radius:16px;background:#a78bfa;width:600px;height:100px"></div>
<p style="text-align:center;font-size:28px">Belajar hal baru setiap hari.</p></div></body></html>`;

const good = `<!doctype html><html><head><style>
html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#0d0c0b;color:#f2ece1}
.grain{position:absolute;inset:0;opacity:.12;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.8'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
h1{position:absolute;left:92px;top:250px;margin:0;width:880px;font-size:150px;line-height:.92}
h1 em{color:#b8412f}.foot{position:absolute;left:96px;bottom:96px;font-size:22px;color:#6d655c}
</style></head><body><div class="grain"></div><h1>Kerja bagus<br><em>tidak</em> cukup.</h1><div class="foot">Desel</div></body></html>`;

await p.evaluate(([slop, good]) => {
  const now = new Date().toISOString();
  localStorage.setItem("desel.v2.decks", JSON.stringify([{ id: "d1", title: "Review test", caption: "", aspect: "4:5",
    slides: [
      { id: "s_slop", title: "Slop", html: slop, rationale: "", hidden: false },
      { id: "s_good", title: "Editorial", html: good, rationale: "", hidden: false },
    ], styleGuide: "", palette: [], brandHandle: "", saveLabel: "Save", fromTemplateId: null, createdAt: now, updatedAt: now }]));
}, [slop, good]);
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1600);

const badges = await p.locator(".thumb-lint").count();
const badgeText = badges ? await p.locator(".thumb-lint").first().innerText() : null;

// select the slop slide -> inspector findings
await p.locator(".thumb").first().click();
await p.waitForTimeout(900);
const items = await p.locator(".lint-item").count();
const messages = await p.locator(".lint-item").evaluateAll(els => els.map(e => e.textContent.slice(0, 60)));
await p.screenshot({ path: "shots/final-review.png" });

// select the good slide -> clean
await p.locator(".thumb").nth(1).click();
await p.waitForTimeout(900);
const clean = await p.locator(".lint-clean").count();
console.log(JSON.stringify({ badges, badgeText, items, messages, clean }, null, 2));
await b.close();
