import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.keyboard.press("Escape");
await p.waitForTimeout(400);

await p.locator(".tab", { hasText: "Proyek" }).click();
await p.waitForTimeout(400);
await p.getByText("Contoh", { exact: true }).click();
await p.waitForTimeout(2500);

const thumbs = await p.locator(".thumb").count();
const titles = await p.locator(".thumb-title").evaluateAll((els) => els.map((e) => e.textContent));
const badges = await p.locator(".thumb-lint").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
const deckTitle = await p.locator(".topbar input").first().inputValue().catch(() => "");

// measure the selected slide inside its iframe: nothing may overflow the canvas
const metrics = await p.evaluate(() => {
  const frame = document.querySelector(".board iframe");
  const doc = frame?.contentDocument;
  if (!doc) return null;
  const body = doc.body;
  const els = [...doc.querySelectorAll("body *")].filter((el) => {
    const s = getComputedStyle(el);
    return s.position === "absolute" || s.display === "flex";
  });
  const overflow = els
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: el.className, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    })
    .filter((r) => r.left < -1 || r.top < -1 || r.right > 1081 || r.bottom > 1351);
  return {
    canvas: [body.scrollWidth, body.scrollHeight],
    overflow,
    fonts: [...new Set([...doc.querySelectorAll("h1,h2,.t,.dek,.body")].map((e) => getComputedStyle(e).fontFamily))],
  };
});

await p.screenshot({ path: "shots/e2e-sample.png" });
console.log(JSON.stringify({ thumbs, titles, badges, deckTitle, metrics }, null, 1));
await b.close();
