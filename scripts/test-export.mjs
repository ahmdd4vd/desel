/**
 * End-to-end export test against the media-first model.
 *
 * Generates a carousel with the offline planner, injects a real screenshot,
 * then rasterises every slide through the real export layer and writes the
 * PNGs to shots/export/ for inspection at true resolution.
 *
 *   node scripts/test-export.mjs [url]
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = require("playwright");

const CHROME =
  (process.env.CHROME_BIN || "chromium");

const OUT = path.resolve("shots/export");
mkdirSync(OUT, { recursive: true });

const URL = process.argv[2] ?? "http://127.0.0.1:1420";

const mediaDataUrl = (file) => {
  const buf = readFileSync(path.resolve("shots/test-media", file));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
};

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

  // 1. Generate with the offline planner (no API key needed).
  await page.evaluate(async () => {
    const s = window.__desel.getState();
    await s.generate({
      topic: "Repo GitHub paling menarik minggu ini",
      audience: "developer pemula",
      tone: "Santai & akrab",
      language: "Bahasa Indonesia",
      slideCount: 7,
      themeHint: "vault",
      brandHandle: "GitHub Vault",
      sourceMaterial: [
        "awesome-selfhosted — A huge list of open-source software you can host on your own server",
        "timvisee/send — Self-hosted file transfer with end-to-end encryption",
        "starship/starship — Customizable prompt for any shell and OS",
        "tstack/lnav — Advanced log file viewer with SQL queries",
        "xbmc/xbmc — Open-source media player",
      ].join("\n"),
    });
  });
  await page.waitForTimeout(900);

  // 2. Drop a real screenshot into the first media slide.
  await page.evaluate((src) => {
    const s = window.__desel.getState();
    const target = s.doc.slides.find((x) => x.kind === "media");
    if (target) s.setSlideMedia(target.id, { src, alt: "screenshot" });
  }, mediaDataUrl("card-selfhosted.jpg"));
  await page.waitForTimeout(700);

  const doc = await page.evaluate(() => window.__desel.getState().doc);
  console.log(`doc: "${doc.title}" | slides: ${doc.slides.length} | theme: ${doc.themeId}`);
  console.log("kinds:", doc.slides.map((s) => s.kind).join(", "));

  // 3. Rasterise every slide through the export layer.
  const results = await page.evaluate(async () => {
    const mod = await import("/src/lib/export.ts");
    const nodes = [...document.querySelectorAll('[aria-hidden="true"] .slide-canvas')];
    const state = window.__desel.getState();
    if (nodes.length < state.doc.slides.length) {
      return { error: `only ${nodes.length} export nodes for ${state.doc.slides.length} slides` };
    }
    const out = [];
    for (let i = 0; i < state.doc.slides.length; i += 1) {
      const b64 = await mod.renderSlidePng(nodes[i], 1);
      out.push({ i, kind: state.doc.slides[i].kind, b64 });
    }
    return { slides: out };
  });

  if (results.error) throw new Error(results.error);

  for (const s of results.slides) {
    const buf = Buffer.from(s.b64, "base64");
    const file = path.join(OUT, `${String(s.i + 1).padStart(2, "0")}-${s.kind}.png`);
    writeFileSync(file, buf);
    console.log(`wrote ${path.basename(file)} (${(buf.length / 1024).toFixed(0)} KB)`);
  }

  console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no errors");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
