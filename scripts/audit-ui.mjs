import { createRequire } from "node:module";
const globalRequire = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = globalRequire("playwright");

const EXE = (process.env.CHROME_BIN || "chromium");

const slide = `<style>body{margin:0;width:1080px;height:1350px;background:#0d0c0b;color:#f1ebe0;
  font-family:Georgia,serif}h1{position:absolute;left:96px;top:300px;margin:0;font-size:140px;line-height:.92}
  .k{position:absolute;left:96px;top:140px;font:22px Arial;letter-spacing:.28em;color:#c6f54e}
  .g{position:absolute;inset:0;opacity:.15;background:radial-gradient(circle at 1px 1px,#fff3 1px,transparent 0);
  background-size:6px 6px}</style><div class="g"></div><div class="k">CATATAN</div><h1>Kerja bagus<br>tidak cukup.</h1>`;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

await page.evaluate((html) => {
  const now = new Date().toISOString();
  const deck = {
    id: "deck_audit",
    title: "Carousel editorial — portofolio",
    caption: "Hook + isi + hashtag",
    aspect: "4:5",
    slides: Array.from({ length: 5 }, (_, i) => ({
      id: `sl_${i}`,
      title: ["Cover — kerja bagus", "Dua alasan", "Ketiga", "Keempat", "CTA"][i],
      html,
      rationale: "Grid cetak, satu aksen lime.",
      hidden: false,
    })),
    styleGuide: "Editorial print dengan aksen lime.",
    palette: ["#171512", "#e8e2d6", "#b8412f", "#c6f54e"],
    brandHandle: "@desel.studio",
    saveLabel: "Save this post",
    fromTemplateId: null,
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem("desel.v2.decks", JSON.stringify([deck]));
  localStorage.setItem("desel.v2.messages", JSON.stringify([
    { id: "m1", deckId: "deck_audit", role: "user", content: "Bikin carousel 5 slide soal portofolio developer.", createdAt: now },
    { id: "m2", deckId: "deck_audit", role: "assistant", content: "Sudah dua slide pertama. Arahnya editorial print: kertas hangat, satu aksen merah bata.", createdAt: now },
  ]));
}, slide);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cs = (el) => (el ? getComputedStyle(el) : null);

  const body = cs(document.body);
  const topbar = q(".topbar");
  const left = q(".panel-left");
  const right = q(".panel-right");
  const stage = q(".stage");
  const board = q(".board");
  const stageArea = q(".stage-area");
  const rail = q(".rail");
  const send = q(".send");
  const thumb = q(".thumb-frame");

  // smallest font actually used
  let minFont = 99;
  let minSelector = "";
  document.querySelectorAll(".workspace *").forEach((el) => {
    if (!el.textContent || !el.textContent.trim()) return;
    if (el.children.length > 0 && el.childElementCount === el.children.length && !el.matches("p,strong,span,small,h1,h2,button")) return;
    const f = parseFloat(cs(el).fontSize);
    if (f && f < minFont) {
      minFont = f;
      minSelector = el.className || el.tagName;
    }
  });

  const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const overflowY = document.documentElement.scrollHeight - document.documentElement.clientHeight;

  const frame = q(".board iframe");
  let frameOk = false;
  try {
    const doc = frame.contentDocument;
    frameOk = !!doc && doc.body.getBoundingClientRect().height > 100;
  } catch {
    frameOk = false;
  }

  return {
    viewport: { w: innerWidth, h: innerHeight },
    bodyFont: body.fontFamily,
    bodySize: body.fontSize,
    bg: body.backgroundColor,
    overflowX,
    overflowY,
    topbar: box(topbar),
    left: box(left),
    right: box(right),
    stage: box(stage),
    stageArea: box(stageArea),
    board: box(board),
    boardFits: board && stageArea
      ? board.getBoundingClientRect().bottom <= stageArea.getBoundingClientRect().bottom + 1
      : false,
    rail: box(rail),
    thumb: box(thumb),
    sendBg: send ? cs(send).backgroundColor : null,
    accent: cs(document.documentElement).getPropertyValue("--ui-accent").trim(),
    minFont,
    minSelector,
    frameOk,
    thumbCount: document.querySelectorAll(".thumb").length,
    railScrolls: q(".rail-track") ? q(".rail-track").scrollWidth > q(".rail-track").clientWidth : null,
  };
});

console.log(JSON.stringify(report, null, 2));
console.log("console errors:", errors.length ? errors : "none");

await browser.close();
