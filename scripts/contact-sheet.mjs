/**
 * Contact sheet for the media-first design system.
 *
 * Seeds a realistic carousel (cover + media slides + cta), then screenshots the
 * artboard for every theme and every slide template.
 *
 *   node scripts/contact-sheet.mjs [url]
 */

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = require("playwright");

const CHROME =
  (process.env.CHROME_BIN || "chromium");

const OUT = path.resolve("shots/sheet");
mkdirSync(OUT, { recursive: true });

const URL = process.argv[2] ?? "http://127.0.0.1:1420";

const slide = (kind, extra = {}) => ({
  kind,
  label: "",
  headline: "",
  link: "",
  body: "",
  items: [],
  stat: null,
  media: null,
  ...extra,
});

const SAMPLE = {
  title: "Repos worth stealing",
  caption: "caption sample",
  themeId: "vault",
  aspect: "4:5",
  brandHandle: "GitHub Vault",
  saveLabel: "Save this post",
  showSlideNumbers: false,
  slides: [
    slide("cover", { headline: "GitHub hides *pure gold*" }),
    slide("media", {
      link: "github.com/awesome-selfhosted/awesome-selfhosted",
      body: "A huge list of open-source software you can host on your own server. Alternatives to Google Drive, Notion, GitHub and Spotify.",
    }),
    slide("media", {
      link: "github.com/timvisee/send",
      body: "A self-hosted server for secure file transfer with end-to-end encryption. Files are deleted automatically after download.",
    }),
    slide("media", {
      link: "github.com/starship/starship",
      body: "A customizable prompt for any shell and any OS. Shows the git branch, language version and command status without clutter.",
    }),
    slide("list", {
      label: "ALSO WORTH IT",
      headline: "Tiga repo yang jarang dibahas",
      items: [
        "github.com/imsnif/bandwhich — network traffic monitor",
        "github.com/tstack/lnav — log viewer dengan SQL",
        "github.com/xbmc/xbmc — media player open-source",
      ],
    }),
    slide("note", {
      label: "CATATAN",
      headline: "Repo bagus itu yang bikin lo berhenti nulis kode sendiri",
      body: "Kalau ada yang sudah menyelesaikan masalah lo dengan rapi, pakai. Waktu lo lebih berharga.",
    }),
    slide("stat", {
      stat: { value: "298k", label: "stars" },
      body: "Awesome-Selfhosted adalah salah satu repo paling di-star di GitHub, dan tetap dirawat sampai sekarang.",
    }),
    slide("quote", {
      headline: "Read the README before you read the code",
      link: "— kebanyakan maintainer",
    }),
    slide("cta", {
      label: "SIMPEN",
      headline: "Simpen dulu, baca nanti",
      body: "Follow buat kurasi repo baru tiap minggu.",
    }),
  ],
};

const THEMES = [
  "vault",
  "vault-soft",
  "terminal",
  "press",
  "swiss",
  "noir",
  "riso",
  "brutal",
];

async function shot(page, name) {
  const el = page.locator(".stage-canvas .slide-canvas").first();
  await el.waitFor({ state: "visible" });
  await el.screenshot({ path: path.join(OUT, `${name}.png`), scale: "css" });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  await page.evaluate((doc) => {
    window.__desel.getState().replaceWith(doc);
    window.__desel.getState().setBrandHandle(doc.brandHandle);
    window.__desel.getState().setSaveLabel(doc.saveLabel);
  }, SAMPLE);
  await page.waitForTimeout(600);

  // Every theme on the cover + one media slide.
  for (const theme of THEMES) {
    await page.evaluate((t) => window.__desel.getState().setTheme(t), theme);
    for (const idx of [0, 1]) {
      await page.evaluate((i) => {
        const s = window.__desel.getState();
        s.select(s.doc.slides[i].id);
      }, idx);
      await page.waitForTimeout(260);
      await shot(page, `theme-${theme}-${idx === 0 ? "cover" : "media"}`);
    }
  }

  // Every template, in vault.
  await page.evaluate(() => window.__desel.getState().setTheme("vault"));
  for (let i = 0; i < SAMPLE.slides.length; i += 1) {
    await page.evaluate((idx) => {
      const s = window.__desel.getState();
      s.select(s.doc.slides[idx].id);
    }, i);
    await page.waitForTimeout(260);
    await shot(page, `kind-${String(i + 1).padStart(2, "0")}-${SAMPLE.slides[i].kind}`);
  }

  // Same templates in editorial press.
  await page.evaluate(() => window.__desel.getState().setTheme("press"));
  for (const i of [0, 1, 4, 5, 8]) {
    await page.evaluate((idx) => {
      const s = window.__desel.getState();
      s.select(s.doc.slides[idx].id);
    }, i);
    await page.waitForTimeout(260);
    await shot(page, `press-${String(i + 1).padStart(2, "0")}-${SAMPLE.slides[i].kind}`);
  }

  console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page errors");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
