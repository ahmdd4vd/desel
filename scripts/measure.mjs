/**
 * Measures the real geometry of a media slide and prints it as a ratio of the
 * canvas, so the composition can be compared against the reference carousels.
 */

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = require("playwright");

const CHROME =
  "C:/Users/david/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe";
const URL = process.argv[2] ?? "http://127.0.0.1:1420";
mkdirSync("shots", { recursive: true });

const SAMPLE = {
  title: "measure",
  caption: "",
  themeId: "vault",
  aspect: "4:5",
  brandHandle: "GitHub Vault",
  saveLabel: "Save this post",
  showSlideNumbers: false,
  slides: [
    {
      kind: "media",
      label: "",
      headline: "",
      link: "github.com/awesome-selfhosted/awesome-selfhosted",
      body: "A huge list of open-source software you can host on your own server. Alternatives to Google Drive, Notion, GitHub and Spotify.",
      items: [],
      stat: null,
      media: null,
    },
  ],
};

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  await page.evaluate((doc) => {
    window.__desel.getState().replaceWith(doc);
    window.__desel.getState().setBrandHandle(doc.brandHandle);
    window.__desel.getState().setSaveLabel(doc.saveLabel);
  }, SAMPLE);
  await page.waitForTimeout(500);

  const geo = await page.evaluate(() => {
    const canvas = document.querySelector(".stage-canvas .slide-canvas");
    const r = (sel) => {
      const el = canvas.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const cb = canvas.getBoundingClientRect();
      return {
        top: +((b.top - cb.top) / cb.height).toFixed(3),
        height: +(b.height / cb.height).toFixed(3),
        bottom: +((b.bottom - cb.top) / cb.height).toFixed(3),
      };
    };
    return {
      canvas: { w: canvas.getBoundingClientRect().width, h: canvas.getBoundingClientRect().height },
      inner: r(".slide-inner"),
      card: r(".media-frame"),
      caption: r(".media-caption"),
      link: r(".caption-link"),
      body: r(".caption-body"),
      footer: r(".slide-footer"),
    };
  });

  console.log(JSON.stringify(geo, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
