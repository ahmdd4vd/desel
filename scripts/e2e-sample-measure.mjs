import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.keyboard.press("Escape");
await p.waitForTimeout(400);

const measure = () =>
  p.evaluate(() => {
    const frame = document.querySelector(".board iframe");
    const doc = frame?.contentDocument;
    if (!doc) return null;
    const body = doc.body;
    const nodes = [...doc.querySelectorAll("body *")];
    const overflow = nodes
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      })
      .filter((r) => r.left < -1 || r.top < -1 || r.right > 1081 || r.bottom > 1351);
    const sizes = nodes
      .map((el) => parseFloat(getComputedStyle(el).fontSize) || 0)
      .sort((a, z) => z - a);
    const colors = new Set(
      nodes.flatMap((el) => {
        const s = getComputedStyle(el);
        return [s.color, s.backgroundColor, s.borderTopColor];
      }),
    );
    return { canvas: [body.scrollWidth, body.scrollHeight], overflow, maxFont: Math.round(sizes[0] ?? 0), colors: colors.size };
  });

const rows = [];
for (let i = 0; i < 4; i++) {
  await p.locator(".thumb").nth(i).click();
  await p.waitForTimeout(700);
  rows.push(await measure());
}

await p.getByRole("button", { name: "Export" }).click().catch(() => {});
await p.waitForTimeout(500);
console.log(JSON.stringify({ rows }));
await b.close();
