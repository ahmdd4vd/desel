import { appendFileSync } from "node:fs";
// A throwaway OpenAI-compatible endpoint used to exercise the real desktop app
// end to end: it streams text, calls write_slide three times, then finishes.
//
//   node scripts/mock-provider.mjs [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 9001);

const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const page = (body) => `<!doctype html><html><head><style>
html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#0d0c0b;color:#f2ece1;font-family:Georgia,'Times New Roman',serif}
.grain{position:absolute;inset:0;pointer-events:none;opacity:.14;mix-blend-mode:overlay;background-image:${grain}}
.rule{position:absolute;left:92px;right:92px;top:104px;height:1px;background:#f2ece126}
.kicker{position:absolute;left:96px;top:64px;font-family:Arial,sans-serif;font-size:19px;letter-spacing:.22em;text-transform:uppercase;color:#b8412f}
.pg{position:absolute;right:96px;top:64px;font-family:Arial,sans-serif;font-size:19px;color:#8b8378}
${body.css}
</style></head><body><div class="grain"></div><div class="rule"></div>
<div class="kicker">${body.kicker}</div><div class="pg">${body.page}</div>${body.html}</body></html>`;

const slides = [
  {
    title: "Cover - kerja bagus tidak cukup",
    html: page({
      kicker: "Catatan untuk pembuat",
      page: "01 / 03",
      css: `h1{position:absolute;left:88px;top:232px;margin:0;width:900px;font-size:158px;line-height:.9;letter-spacing:-.03em}
            h1 em{font-style:normal;color:#b8412f}
            .sub{position:absolute;left:96px;top:840px;width:620px;font-size:31px;line-height:1.45;color:#b9b0a3}
            .stamp{position:absolute;right:70px;bottom:120px;width:190px;height:190px;border:2px solid #b8412f;border-radius:50%;display:grid;place-items:center;transform:rotate(-11deg);font-family:Arial,sans-serif;font-size:16px;letter-spacing:.16em;text-transform:uppercase;color:#b8412f;text-align:center;line-height:1.5}`,
      html: `<h1>Kerja bagus<br><em>tidak</em> cukup.</h1>
             <div class="sub">Yang membedakan bukan jam kerja, tapi keputusan yang berani diulang setiap hari.</div>
             <div class="stamp">Edisi<br>01</div>`,
    }),
  },
  {
    title: "Isi - satu ide",
    html: page({
      kicker: "Bagian satu",
      page: "02 / 03",
      css: `.num{position:absolute;left:60px;top:170px;font-size:520px;line-height:.8;color:#ffffff0f;font-family:Arial,sans-serif;font-weight:700}
            h2{position:absolute;left:96px;top:520px;margin:0;width:800px;font-size:74px;line-height:1.06}
            p{position:absolute;left:96px;top:880px;width:640px;font-size:30px;line-height:1.5;color:#b9b0a3}
            .bar{position:absolute;left:96px;top:820px;width:120px;height:4px;background:#b8412f}`,
      html: `<div class="num">01</div><h2>Kejelasan mengalahkan kelengkapan.</h2><div class="bar"></div>
             <p>Satu slide, satu ide. Sisanya pindah ke slide berikutnya, bukan ditumpuk di tempat yang sama.</p>`,
    }),
  },
  {
    title: "CTA - simpan",
    html: page({
      kicker: "Penutup",
      page: "03 / 03",
      css: `.big{position:absolute;left:88px;top:300px;width:900px;font-size:120px;line-height:.94;margin:0}
            .cta{position:absolute;left:96px;bottom:180px;display:inline-flex;align-items:center;gap:18px;font-family:Arial,sans-serif;font-size:26px;letter-spacing:.02em;color:#0d0c0b;background:#f2ece1;padding:22px 34px}
            .dot{width:10px;height:10px;background:#b8412f}`,
      html: `<h1 class="big">Simpan ini<br>untuk nanti.</h1><div class="cta"><span class="dot"></span>Save this post</div>`,
    }),
  },
];

function sse(res, chunks) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-designer" }] }));
    return;
  }
  if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const messages = body.messages ?? [];
    // Round counts only this turn: everything after the last user message.
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const round = messages.slice(lastUser + 1).filter((m) => m.role === "tool").length;
    const variant = messages.filter((m) => m.role === "user").length;

    console.log(`[mock] request round=${round} messages=${messages.length}`);
    try { appendFileSync("mock-debug.log", JSON.stringify({ round, variant, roles: messages.map((m) => m.role) }) + "\n"); } catch {}

    // On a revision turn, act like a careful agent: read the slide you are
    // about to change instead of rewriting it blind.
    if (variant > 1 && round === 0) {
      sse(res, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_read",
                    type: "function",
                    function: { name: "read_deck", arguments: JSON.stringify({ index: 0 }) },
                  },
                ],
              },
            },
          ],
        },
      ]);
      return;
    }

    const slideRound = variant > 1 ? round - 1 : round;
    if (slideRound >= 0 && slideRound < slides.length) {
      const slide = slides[slideRound];
      sse(res, [
        { choices: [{ delta: { content: round === 0 ? "Saya baca slide dulu, lalu tulis ulang editorial print. " : "" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${slideRound}`,
                    type: "function",
                    function: {
                      name: "write_slide",
                      arguments: JSON.stringify({
                        index: slideRound,
                        title: slide.title,
                        html: slide.html.replace("</body>", `<div style="position:absolute;right:24px;bottom:24px;font-family:monospace;font-size:14px;opacity:.45">rev ${variant}</div></body>`),
                        rationale: "Editorial print: serif display, satu aksen bata, grain overlay.",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
      return;
    }

    sse(res, [
      {
        choices: [
          {
            delta: {
              content:
                "Selesai — tiga slide dengan sistem editorial yang sama: serif display, aksen bata, grain di setiap kanvas.",
            },
          },
        ],
      },
    ]);
  });
});

server.listen(port, "127.0.0.1", () => console.log(`mock provider on http://127.0.0.1:${port}/v1`));
