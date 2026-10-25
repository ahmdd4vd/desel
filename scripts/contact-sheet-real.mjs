/**
 * Renders a realistic carousel using REAL screenshots cropped from the
 * reference posts, then screenshots every slide at artboard size.
 *
 * This is the honest test: if the layout only works with grey placeholders,
 * it does not work.
 *
 *   node scripts/contact-sheet-real.mjs [url]
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = require("playwright");

const CHROME =
  (process.env.CHROME_BIN || "chromium");

const OUT = path.resolve("shots/real");
mkdirSync(OUT, { recursive: true });

const URL = process.argv[2] ?? "http://127.0.0.1:1420";

const dataUrl = (file) => {
  const buf = readFileSync(path.resolve("shots/test-media", file));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
};

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
    slide("cover", {
      headline: "GitHub hides *pure gold*",
      media: { src: dataUrl("art-mascot.jpg"), alt: "mascot", fit: "card" },
    }),
    slide("media", {
      link: "github.com/awesome-selfhosted/awesome-selfhosted",
      body: "A huge list of open-source software you can host on your own server. Alternatives to Google Drive, Notion, GitHub and Spotify.",
      media: { src: dataUrl("card-selfhosted.jpg"), alt: "Awesome Selfhosted", fit: "card" },
    }),
    slide("media", {
      link: "github.com/timvisee/send",
      body: "A self-hosted server for secure file transfer with end-to-end encryption. Files are deleted automatically after download.",
      media: { src: dataUrl("card-sharex.jpg"), alt: "Send", fit: "card" },
    }),
    slide("media", {
      link: "github.com/starship/starship",
      body: "A customizable prompt for any shell and any OS. Shows the git branch, language version and command status without clutter.",
      media: { src: dataUrl("card-starship.jpg"), alt: "Starship", fit: "card" },
    }),
    slide("media", {
      link: "github.com/tstack/lnav",
      body: "An advanced log file viewer for the terminal. Merges several files by timestamp, highlights errors and lets you filter with SQL.",
      media: { src: dataUrl("card-lnav.jpg"), alt: "lnav", fit: "card" },
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
    slide("cta", {
      label: "SIMPEN",
      headline: "Simpen dulu, baca nanti",
      body: "Follow buat kurasi repo baru tiap minggu.",
    }),
  ],
};

const THEMES = ["vault", "terminal", "press", "swiss", "noir", "riso"];

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
    const s = window.__desel.getState();
    s.replaceWith(doc);
    s.setBrandHandle(doc.brandHandle);
    s.setSaveLabel(doc.saveLabel);
  }, SAMPLE);
  await page.waitForTimeout(800);

  const select = async (i) => {
    await page.evaluate((idx) => {
      const s = window.__desel.getState();
      s.select(s.doc.slides[idx].id);
    }, i);
    await page.waitForTimeout(300);
  };

  // Full carousel in vault.
  for (let i = 0; i < SAMPLE.slides.length; i += 1) {
    await select(i);
    await shot(page, `vault-${String(i + 1).padStart(2, "0")}-${SAMPLE.slides[i].kind}`);
  }

  // The media template across themes.
  for (const theme of THEMES) {
    await page.evaluate((t) => window.__desel.getState().setTheme(t), theme);
    await select(1);
    await shot(page, `theme-${theme}-media`);
    await select(0);
    await shot(page, `theme-${theme}-cover`);
  }

  console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page errors");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
