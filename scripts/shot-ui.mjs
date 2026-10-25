import { createRequire } from "node:module";

const globalRequire = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = globalRequire("playwright");

const EXE = (process.env.CHROME_BIN || "chromium");

const seedSlides = [
  `<style>
    @page{margin:0}
    body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#0d0c0b;color:#f2ece1;
      font-family:Georgia,'Times New Roman',serif}
    .grain{position:absolute;inset:0;opacity:.16;mix-blend-mode:overlay;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E")}
    .rule{position:absolute;left:96px;right:96px;top:110px;height:1px;background:#f2ece133}
    .kicker{position:absolute;left:96px;top:132px;font-family:Arial,sans-serif;font-size:23px;
      letter-spacing:.28em;text-transform:uppercase;color:#c6f54e}
    h1{position:absolute;left:92px;top:250px;margin:0;width:880px;font-size:150px;line-height:.92;
      letter-spacing:-.045em;font-weight:400}
    h1 em{font-style:italic;color:#c6f54e}
    .ghost{position:absolute;right:-40px;bottom:40px;font-size:430px;line-height:1;color:#f2ece10e;
      font-style:italic;pointer-events:none}
    .sub{position:absolute;left:96px;bottom:210px;width:620px;font-size:31px;line-height:1.5;color:#a49c90}
    .foot{position:absolute;left:96px;bottom:96px;font-family:Arial,sans-serif;font-size:22px;
      letter-spacing:.16em;text-transform:uppercase;color:#6d655c}
  </style>
  <div class="grain"></div><div class="rule"></div>
  <div class="kicker">Catatan / 01</div>
  <h1>Kerja bagus<br><em>tidak</em> cukup<br>dilihat.</h1>
  <div class="ghost">01</div>
  <p class="sub">Kenapa portofolio yang rapi masih kalah dari satu halaman yang berani.</p>
  <div class="foot">Desel Studio</div>`,

  `<style>
    body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#e8e2d6;color:#171512;
      font-family:Arial,Helvetica,sans-serif}
    .rule{position:absolute;left:96px;right:96px;top:120px;height:2px;background:#171512}
    .num{position:absolute;right:96px;top:150px;font-size:210px;line-height:.8;font-weight:700;
      letter-spacing:-.06em;color:#171512}
    .label{position:absolute;left:96px;top:152px;font-size:24px;letter-spacing:.24em;
      text-transform:uppercase}
    h2{position:absolute;left:96px;top:360px;margin:0;width:760px;font-size:96px;line-height:1;
      letter-spacing:-.03em}
    .list{position:absolute;left:96px;top:720px;width:760px}
    .row{display:flex;gap:22px;padding:26px 0;border-top:1px solid #17151233;font-size:29px;line-height:1.45}
    .row b{color:#b8412f;font-family:Georgia,serif;font-style:italic;font-weight:400}
    .foot{position:absolute;left:96px;bottom:96px;font-size:22px;letter-spacing:.18em;
      text-transform:uppercase;color:#17151299}
  </style>
  <div class="rule"></div><div class="label">Dua alasan</div><div class="num">02</div>
  <h2>Yang bikin orang<br>berhenti scroll.</h2>
  <div class="list">
    <div class="row"><b>i.</b><span>Hierarki yang berani — satu hal jelas paling penting.</span></div>
    <div class="row"><b>ii.</b><span>Tekstur yang terasa dicetak, bukan digenerate.</span></div>
  </div>
  <div class="foot">Desel Studio</div>`,
];

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "shots/ui-empty.png" });

// Seed a deck with two real slides to exercise the board, rail and inspector.
await page.evaluate((slides) => {
  const now = new Date().toISOString();
  const deck = {
    id: "deck_seed",
    title: "Carousel editorial — portofolio",
    caption: "Hook + isi + hashtag",
    aspect: "4:5",
    slides: slides.map((html, i) => ({
      id: `sl_${i}`,
      title: i === 0 ? "Cover — kerja bagus" : "Dua alasan",
      html,
      rationale: "Grid cetak, satu aksen lime, ghost numeral di belakang.",
      hidden: false,
    })),
    styleGuide:
      "Editorial print: Georgia display + Arial label, kertas #e8e2d6 / ink #171512, aksen #b8412f, rule 2px, ghost numeral 210px.",
    palette: ["#171512", "#e8e2d6", "#b8412f", "#c6f54e"],
    brandHandle: "@desel.studio",
    saveLabel: "Save this post",
    fromTemplateId: null,
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem("desel.v2.decks", JSON.stringify([deck]));
  localStorage.setItem("desel.v2.messages", JSON.stringify([]));
}, seedSlides);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.screenshot({ path: "shots/ui-board.png" });

// Chat tab with a fake transcript to check message + tool step styling.
await page.evaluate(() => {
  const now = Date.now();
  const msgs = [
    { id: "m1", deckId: "deck_seed", role: "user", content: "Bikin carousel 5 slide soal portofolio developer. Visual editorial cetak, cover berani.", createdAt: new Date(now - 60000).toISOString() },
    { id: "m2", deckId: "deck_seed", role: "assistant", content: "Sudah saya tulis dua slide pertama. Arah visualnya editorial print: kertas hangat, satu aksen merah bata, ghost numeral besar di belakang judul.", createdAt: new Date(now - 30000).toISOString() },
  ];
  localStorage.setItem("desel.v2.messages", JSON.stringify(msgs));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.screenshot({ path: "shots/ui-chat.png" });

await page.getByRole("button", { name: "Kode" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/ui-source.png" });

await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(600);
await page.screenshot({ path: "shots/ui-compact.png" });

await browser.close();
console.log("ok");
