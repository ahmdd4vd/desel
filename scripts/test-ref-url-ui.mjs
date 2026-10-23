import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.launch({ executablePath: "C:\\Users\\david\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await p.evaluate(() => localStorage.removeItem("desel.v2.refs"));
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1100);

// open the link row
await p.getByRole("button", { name: "Link", exact: true }).click();
await p.waitForTimeout(300);
const row = await p.locator(".refs-url").count();

// a same-origin image works even with CORS restrictions
await p.locator(".refs-url input").fill("http://127.0.0.1:1420/desel-icon.png");
await p.getByRole("button", { name: "Ambil", exact: true }).click();
await p.waitForTimeout(1400);
const afterGood = await p.locator(".ref").count();
const rowClosed = await p.locator(".refs-url").count();

// a page (not an image) must fail loudly, not silently
await p.getByRole("button", { name: "Link", exact: true }).click();
await p.locator(".refs-url input").fill("http://127.0.0.1:1420/");
await p.getByRole("button", { name: "Ambil", exact: true }).click();
await p.waitForTimeout(1200);
const toast = await p.locator(".toast").innerText().catch(() => "");
const afterBad = await p.locator(".ref").count();
await p.screenshot({ path: "shots/final-ref-link.png" });

const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("desel.v2.refs") || "[]").length);
console.log(JSON.stringify({ row, afterGood, rowClosed, toast, afterBad, stored, errors }, null, 1));
await b.close();
