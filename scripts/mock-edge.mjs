// Two edge-case providers used by the end-to-end checks:
//   9002 — asks a clarifying question first, then writes a slide
//   9003 — always fails with 401, to check the error surface
import { createServer } from "node:http";

const mode = process.argv[2] ?? "ask";
const port = Number(process.argv[3] ?? (mode === "ask" ? 9002 : 9003));

const slide = `<!doctype html><html><head><style>
html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#0b0b0d;color:#f2ece1;font-family:Georgia}
.grain{position:absolute;inset:0;opacity:.13;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
h1{position:absolute;left:88px;top:300px;margin:0;width:900px;font-size:150px;line-height:.92}
</style></head><body><div class="grain"></div><h1>Soal kopi.</h1></body></html>`;

function sse(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

createServer((req, res) => {
  if (req.method !== "POST") {
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

    if (mode === "401") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key provided.", type: "invalid_request_error" } }));
      return;
    }

    const users = (body.messages ?? []).filter((m) => m.role === "user").length;
    console.log(`[mock-${mode}] user messages=${users}`);

    if (users <= 1) {
      sse(res, [
        {
          choices: [
            {
              delta: {
                content: "Sebelum saya desain: ",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_ask",
                    type: "function",
                    function: {
                      name: "ask_user",
                      arguments: JSON.stringify({ question: "Ini carousel untuk brand kopi apa, dan audiensnya siapa?" }),
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
              tool_calls: [
                {
                  index: 0,
                  id: "call_slide",
                  type: "function",
                  function: {
                    name: "write_slide",
                    arguments: JSON.stringify({ index: 0, title: "Cover kopi", html: slide, rationale: "dark editorial" }),
                  },
                },
              ],
            },
          },
        ],
      },
    ]);
  });
}).listen(port, "127.0.0.1", () => console.log(`mock-${mode} on ${port}`));
