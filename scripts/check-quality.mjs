import { createRequire } from "node:module";
const globalRequire = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = globalRequire("playwright");
const EXE = "C:\\Users\\david\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  await document.fonts.ready;

  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const ratio = (fg, bg) => {
    const a = lum(parse(fg));
    const b = lum(parse(bg));
    return +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
  };

  const css = getComputedStyle(document.documentElement);
  const token = (n) => css.getPropertyValue(n).trim();
  const bg = "rgb(11, 11, 13)";

  const pairs = {
    "text on app bg": ratio(getComputedStyle(document.body).color, bg),
    "text-2 on panel": ratio(token("--text-2"), "rgb(14, 14, 17)"),
    "text-3 on panel": ratio(token("--text-3"), "rgb(14, 14, 17)"),
    "text-4 on panel": ratio(token("--text-4"), "rgb(14, 14, 17)"),
    "accent on app bg": ratio(token("--accent"), bg),
  };

  const logo = document.querySelector(".brand-mark");
  const imgs = [...document.images].map((i) => ({
    src: i.currentSrc.split("/").pop(),
    ok: i.complete && i.naturalWidth > 0,
    w: i.naturalWidth,
  }));

  const small = [...document.querySelectorAll("button")].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
  }).length;

  const unnamed = [...document.querySelectorAll("button")].filter(
    (b) => b.getBoundingClientRect().width > 0 && !(b.innerText || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title"),
  ).length;

  return {
    fonts: {
      interLoaded: document.fonts.check('13.5px "Inter Variable"'),
      monoLoaded: document.fonts.check('12px "JetBrains Mono Variable"'),
      faces: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i),
    },
    imgs,
    logoBox: logo ? { w: Math.round(logo.getBoundingClientRect().width), h: Math.round(logo.getBoundingClientRect().height) } : null,
    contrast: pairs,
    smallTargets: small,
    unnamedButtons: unnamed,
    body: getComputedStyle(document.body).fontFamily,
  };
});

console.log(JSON.stringify(out, null, 2));

for (const w of [1280, 1024]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.waitForTimeout(400);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`overflow @${w}:`, ov);
}

await browser.close();
