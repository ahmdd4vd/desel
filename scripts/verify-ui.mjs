/**
 * Visual verification for Desel.
 *
 * Uses the already-installed global Playwright (C:\nvm4w\nodejs\node_modules)
 * and the already-downloaded Chromium — nothing is installed here.
 *
 *   node scripts/verify-ui.mjs [url]
 */

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = require("playwright");

// Use the Chromium that is already on disk instead of downloading a new build.
const CHROME =
  (process.env.CHROME_BIN || "chromium");

const OUT = path.resolve("shots");
mkdirSync(OUT, { recursive: true });

const URL = process.argv[2] ?? "http://127.0.0.1:1420";

const SAMPLE = {
  title: "10 Repo GitHub Paling Trending Hari Ini",
  caption:
    "10 repo yang lagi naik daun minggu ini.\n\nSimpen dulu, dipake kapan-kapan.\n\n#github #coding #devtools",
  themeId: "editorial",
  aspect: "4:5",
  brandHandle: "@desel.studio",
  showSlideNumbers: true,
  slides: [
    {
      kind: "cover",
      kicker: "SWIPE",
      headline: "10 repo yang bakal *ngubah* cara lo ngoding",
      subhead: "Semua open source. Semua gratis. Cek sampai habis.",
      body: "",
      items: [],
      stat: null,
      footer: "",
    },
    {
      kind: "point",
      kicker: "POIN 01",
      headline: "Framework yang ngegabungin frontend dan backend",
      subhead: "Satu repo, satu bahasa, nggak perlu mikir dua stack.",
      body: "Cocok buat yang males setup server terpisah tapi tetap mau kontrol penuh.",
      items: [],
      stat: null,
      footer: "",
    },
    {
      kind: "list",
      kicker: "BAGIAN 02",
      headline: "Empat repo yang wajib lo bookmark",
      subhead: "",
      body: "",
      items: [
        "vercel/next.js — React full-stack dengan server components",
        "tauri-apps/tauri — app desktop super ringan pakai Rust",
        "shadcn-ui/ui — komponen siap copy-paste, bukan library",
        "biomejs/biome — linter dan formatter dalam satu binary",
      ],
      stat: null,
      footer: "",
    },
    {
      kind: "stat",
      kicker: "DATA",
      headline: "Repo paling banyak di-star minggu ini",
      subhead: "Naik 40 persen dibanding minggu lalu, tanpa rilis besar.",
      body: "",
      items: [],
      stat: { value: "12.4k", label: "star dalam 7 hari" },
      footer: "",
    },
    {
      kind: "quote",
      kicker: "CATATAN",
      headline: "Repo bagus itu yang bikin lo berhenti nulis kode sendiri",
      subhead: "",
      body: "Kalau ada yang udah nyelesaiin masalah lo dengan rapi, pakai aja. Waktu lo lebih berharga buat hal yang belum ada solusinya.",
      items: [],
      stat: null,
      footer: "",
    },
    {
      kind: "steps",
      kicker: "CARA PAKAI",
      headline: "Cara cek repo layak dipakai atau nggak",
      subhead: "",
      body: "",
      items: [
        "Lihat commit terakhir, jangan yang nganggur setahun",
        "Baca issue terbuka, cek seberapa cepat maintainer jawab",
        "Coba di project kecil dulu sebelum masuk produksi",
      ],
      stat: null,
      footer: "",
    },
    {
      kind: "cta",
      kicker: "SIMPAN",
      headline: "Simpen post ini biar nggak lupa",
      subhead: "Follow buat list repo baru tiap minggu",
      body: "",
      items: [],
      stat: null,
      footer: "",
    },
  ],
};

async function seed(page, themeId = "editorial") {
  await page.evaluate(
    ([doc, theme]) => {
      const store = window.__desel;
      if (!store) throw new Error("store handle window.__desel tidak ada");
      store.getState().replaceWith(doc);
      store.getState().setTheme(theme);
      store.getState().setBrandHandle(doc.brandHandle);
    },
    [SAMPLE, themeId],
  );
  await page.waitForTimeout(450);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  await seed(page);
  await page.screenshot({ path: path.join(OUT, "01-shell-editorial.png") });

  // Every theme on the cover slide.
  const themes = ["editorial", "bold", "dark-tech", "minimal", "retro", "neon", "paper", "mono"];
  for (const theme of themes) {
    await seed(page, theme);
    await page.waitForTimeout(320);
    await page.screenshot({ path: path.join(OUT, `theme-${theme}.png`) });
  }

  // Slide kinds at full size.
  await seed(page);
  const count = await page.evaluate(() => window.__desel.getState().doc.slides.length);
  for (let i = 0; i < count; i += 1) {
    await page.evaluate((idx) => {
      const s = window.__desel.getState();
      s.select(s.doc.slides[idx].id);
    }, i);
    await page.waitForTimeout(260);
    const kind = await page.evaluate(
      (idx) => window.__desel.getState().doc.slides[idx].kind,
      i,
    );
    await page.screenshot({ path: path.join(OUT, `slide-${String(i + 1).padStart(2, "0")}-${kind}.png`) });
  }

  console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
