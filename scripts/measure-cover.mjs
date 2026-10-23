/**
 * Measures the cover composition, with and without artwork.
 *
 *   node scripts/measure-cover.mjs [url]
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = require("playwright");

const CHROME =
  "C:/Users/david/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe";
const URL = process.argv[2] ?? "http://127.0.0.1:1420";

const dataUrl = (file) =>
  `data:image/jpeg;base64,${readFileSync(path.resolve("shots/test-media", file)).toString("base64")}`;

const base = {
  kind: "cover",
  label: "",
  headline: "GitHub hides *pure gold*",
  link: "",
  body: "",
  items: [],
  stat: null,
  media: null,
};

const DOC = {
  title: "measure",
  caption: "",
  themeId: "vault",
  aspect: "4:5",
  brandHandle: "GitHub Vault",
  saveLabel: "Save this post",
  showSlideNumbers: false,
  slides: [base, { ...base, id: "b", media: { src: dataUrl("art-mascot.jpg"), alt: "m", fit: "card" } }],
};

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.evaluate((doc) => window.__desel.getState().replaceWith(doc), DOC);
  await page.waitForTimeout(600);

  for (const [idx, label] of [
    [0, "no artwork"],
    [1, "with artwork"],
  ]) {
    await page.evaluate((i) => {
      const s = window.__desel.getState();
      s.select(s.doc.slides[i].id);
    }, idx);
    await page.waitForTimeout(350);

    const geo = await page.evaluate(() => {
      const canvas = document.querySelector(".stage-canvas .slide-canvas");
      const cb = canvas.getBoundingClientRect();
      const r = (sel) => {
        const el = canvas.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          top: +((b.top - cb.top) / cb.height).toFixed(3),
          bottom: +((b.bottom - cb.top) / cb.height).toFixed(3),
          h: +(b.height / cb.height).toFixed(3),
        };
      };
      return {
        type: r(".cover-type"),
        headline: r(".cover-headline"),
        media: r(".cover-media"),
        frame: r(".cover-media .media-frame"),
      };
    });
    console.log(label, JSON.stringify(geo));
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
