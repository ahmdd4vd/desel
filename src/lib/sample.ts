import type { Deck, Slide } from "./types";

/**
 * A hand-written deck that ships with the app.
 *
 * It exists for two reasons: a first-run studio should not be an empty grey box,
 * and it shows the visual language the generator aims for — one type stack, one
 * accent, real texture, asymmetric margins — without needing an API key.
 *
 * Every slide here is expected to pass the same automated design review the
 * agent's slides go through.
 */

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const shell = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;width:1080px;height:1350px;overflow:hidden;background:#f4efe6;color:#14110e}
  body{font-family:Georgia,'Times New Roman',serif}
  .grain{position:absolute;inset:0;pointer-events:none;opacity:.5;mix-blend-mode:multiply;background-image:${GRAIN}}
  .hair{position:absolute;background:#14110e;height:1px;opacity:.85}
  .kicker{position:absolute;font-family:Arial,Helvetica,sans-serif;font-size:19px;letter-spacing:.24em;text-transform:uppercase}
  .mono{font-family:'Courier New',monospace;font-size:20px;letter-spacing:.06em}
  .foot{position:absolute;left:84px;bottom:72px;font-family:Arial,Helvetica,sans-serif;font-size:18px;letter-spacing:.16em;text-transform:uppercase;color:#6f665a}
  .pg{position:absolute;right:84px;bottom:72px;font-family:'Courier New',monospace;font-size:18px;color:#6f665a}
${body}
</style></head><body>
  <div class="grain"></div>
  <div class="foot">Desel Studio</div>
  <div class="pg">%PAGE%</div>
</body></html>`;

const slide1 = shell(`
  .hair-a{left:84px;right:84px;top:118px}
  .kicker-a{left:84px;top:64px;color:#b8412f}
  .issue{position:absolute;right:84px;top:60px;font-family:'Courier New',monospace;font-size:19px;color:#b8412f}
  h1{position:absolute;left:76px;top:214px;margin:0;width:940px;font-size:172px;line-height:.86;letter-spacing:-.035em;font-weight:400}
  h1 em{font-style:italic;color:#b8412f}
  .dek{position:absolute;left:84px;top:820px;width:640px;font-size:32px;line-height:1.46;color:#4a423a}
  .stamp{position:absolute;right:70px;bottom:190px;width:184px;height:184px;border:2px solid #b8412f;border-radius:50%;display:grid;place-items:center;text-align:center;transform:rotate(-12deg);font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;letter-spacing:.18em;text-transform:uppercase;color:#b8412f}
  .hair-b{left:84px;right:84px;bottom:118px}
`)
  .replace("%PAGE%", "01 — 04")
  .replace("</body>", `<h1>Kerja bagus<br><em>tidak</em> cukup.</h1>
  <div class="kicker kicker-a">Catatan untuk pembuat</div>
  <div class="issue">No. 01</div>
  <div class="hair hair-a"></div>
  <div class="dek">Yang membedakan bukan jumlah jam kerja, tapi keputusan kecil yang diulang setiap hari.</div>
  <div class="stamp">Edisi<br>pertama</div>
  <div class="hair hair-b"></div>
</body>`);

const slide2 = shell(`
  .num{position:absolute;left:52px;top:120px;font-family:Arial,Helvetica,sans-serif;font-size:420px;line-height:.78;font-weight:700;color:#14110e0f;letter-spacing:-.05em}
  .kicker-a{left:84px;top:64px;color:#6f665a}
  h2{position:absolute;left:84px;top:392px;margin:0;width:800px;font-size:112px;line-height:1.02;letter-spacing:-.02em;font-weight:400}
  .rule{position:absolute;left:84px;top:300px;width:96px;height:6px;background:#b8412f}
  .body{position:absolute;left:84px;top:812px;width:660px;font-size:30px;line-height:1.5;color:#4a423a}
  .side{position:absolute;right:84px;top:812px;width:200px;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:1.6;letter-spacing:.1em;text-transform:uppercase;color:#6f665a;text-align:right}
`)
  .replace("%PAGE%", "02 — 04")
  .replace("</body>", `<div class="num">01</div>
  <div class="kicker kicker-a">Prinsip pertama</div>
  <div class="rule"></div>
  <h2>Kejelasan<br>mengalahkan<br>kelengkapan.</h2>
  <div class="body">Satu slide, satu ide. Sisanya pindah ke halaman berikutnya, bukan ditumpuk sampai penuh.</div>
  <div class="side">Hal yang paling sering dilupakan</div>
</body>`);

const slide3 = shell(`
  .kicker-a{left:84px;top:64px;color:#6f665a}
  .lead{position:absolute;left:84px;top:150px;margin:0;width:780px;font-size:96px;line-height:.98;letter-spacing:-.025em;font-weight:400}
  .list{position:absolute;left:84px;right:84px;top:520px}
  .row{display:flex;align-items:baseline;gap:34px;padding:34px 0;border-top:1px solid #14110e33}
  .row:last-child{border-bottom:1px solid #14110e33}
  .n{font-family:'Courier New',monospace;font-size:22px;color:#b8412f;width:44px;flex:none}
  .t{font-family:Arial,Helvetica,sans-serif;font-size:38px;line-height:1.24;letter-spacing:-.01em}
  .t small{display:block;margin-top:10px;font-size:21px;line-height:1.5;color:#5d554b;letter-spacing:0;max-width:640px}
`)
  .replace("%PAGE%", "03 — 04")
  .replace("</body>", `<div class="kicker kicker-a">Tiga kebiasaan</div>
  <h2 class="lead">Yang bisa kamu mulai hari ini.</h2>
  <div class="list">
    <div class="row"><span class="n">01</span><span class="t">Tulis judulnya lebih dulu.<small>Kalau judulnya lemah, tidak ada layout yang bisa menyelamatkan.</small></span></div>
    <div class="row"><span class="n">02</span><span class="t">Pilih satu aksen, bukan lima.<small>Satu warna yang dipakai dengan disiplin lebih berani daripada pelangi.</small></span></div>
    <div class="row"><span class="n">03</span><span class="t">Buang satu elemen.<small>Slide yang lega terasa mahal. Slide penuh terasa panik.</small></span></div>
  </div>
</body>`);

const slide4 = shell(`
  .kicker-a{left:84px;top:64px;color:#6f665a}
  h2{position:absolute;left:76px;top:196px;margin:0;width:920px;font-size:146px;line-height:.9;letter-spacing:-.03em;font-weight:400}
  h2 em{font-style:italic;color:#b8412f}
  .cta{position:absolute;left:84px;bottom:250px;display:inline-flex;align-items:center;gap:20px;background:#14110e;color:#f4efe6;font-family:Arial,Helvetica,sans-serif;font-size:26px;letter-spacing:.02em;padding:26px 40px}
  .dot{width:11px;height:11px;background:#b8412f;border-radius:50%}
  .note{position:absolute;left:84px;bottom:150px;font-family:'Courier New',monospace;font-size:18px;color:#6f665a}
`)
  .replace("%PAGE%", "04 — 04")
  .replace("</body>", `<div class="kicker kicker-a">Penutup</div>
  <h2>Simpan ini<br>untuk <em>nanti.</em></h2>
  <div class="cta"><span class="dot"></span>Save this post</div>
  <div class="note">@desel.studio</div>
</body>`);

const slides: Slide[] = [
  { id: "sample-1", title: "Cover — kerja bagus tidak cukup", html: slide1, rationale: "Editorial print: serif display, aksen bata, grain kertas.", hidden: false },
  { id: "sample-2", title: "Prinsip — kejelasan", html: slide2, rationale: "Angka ghost besar sebagai jangkar visual.", hidden: false },
  { id: "sample-3", title: "Daftar — tiga kebiasaan", html: slide3, rationale: "Daftar bergaris, bukan tiga kartu sejajar.", hidden: false },
  { id: "sample-4", title: "CTA — simpan", html: slide4, rationale: "Tipografi besar + satu tombol nyata.", hidden: false },
];

export function sampleDeck(): Deck {
  const now = new Date().toISOString();
  return {
    id: "sample-deck",
    title: "Editorial print — contoh",
    caption: "Kerja bagus tidak cukup.\n\nTiga kebiasaan kecil yang membedakan deck yang rapi dari deck yang penuh.\n\n#desel #carousel #desain",
    aspect: "4:5",
    slides,
    styleGuide:
      "Editorial print: Georgia display + Arial label + Courier data, kertas #f4efe6, tinta #14110e, satu aksen bata #b8412f, grain di setiap kanvas, hairline tipis, margin asimetris kiri 84px.",
    palette: ["#f4efe6", "#14110e", "#b8412f"],
    brandHandle: "@desel.studio",
    saveLabel: "Save this post",
    fromTemplateId: null,
    createdAt: now,
    updatedAt: now,
  };
}
