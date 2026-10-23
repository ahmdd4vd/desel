import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.launch({ executablePath: "C:\\Users\\david\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.log("pageerror:", String(e)));
await p.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await p.evaluate(() => {
  const now = new Date().toISOString();
  const html = `<style>body{margin:0;width:1080px;height:1350px;background:#0d0c0b;color:#f1ebe0;font-family:Georgia,serif}h1{position:absolute;left:96px;top:300px;margin:0;font-size:140px}</style><h1>Cover</h1>`;
  localStorage.setItem("desel.v2.decks", JSON.stringify([{ id: "d1", title: "Pin test", caption: "", aspect: "4:5", slides: [{ id: "s1", title: "Cover", html, rationale: "", hidden: false }], styleGuide: "", palette: [], brandHandle: "", saveLabel: "Save", fromTemplateId: null, createdAt: now, updatedAt: now }]));
});
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1300);

// pin tool -> click on canvas -> comment modal -> save
await p.getByTitle("Pin komentar ke canvas").click();
await p.waitForTimeout(200);
const board = p.locator(".board-inner");
const box = await board.boundingBox();
await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
await p.waitForTimeout(400);
const modal = await p.locator(".modal").count();
await p.locator('.modal textarea').fill("Headline ini kekecilan, naikin 20%.");
await p.getByRole("button", { name: "Tambah", exact: true }).click();
await p.waitForTimeout(600);

const pins = await p.locator(".pin").count();
const notes = await p.locator(".note").count();
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("desel.v2.comments") || "[]").length);
await p.screenshot({ path: "shots/final-pin.png" });

// resolve it
await p.getByRole("button", { name: "Selesai" }).first().click();
await p.waitForTimeout(500);
const resolved = await p.evaluate(() => (JSON.parse(localStorage.getItem("desel.v2.comments") || "[]")[0] || {}).status);
console.log(JSON.stringify({ modal, pins, notes, stored, resolved }));
await b.close();
