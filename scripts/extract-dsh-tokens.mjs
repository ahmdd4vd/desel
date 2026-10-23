import { openSync, readSync, fstatSync, closeSync } from "node:fs";

const PATH = "C:\\Users\\david\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const NEEDLE = Buffer.from("--background");
const CHUNK = 8 * 1024 * 1024;

const fd = openSync(PATH, "r");
const total = fstatSync(fd).size;
const buf = Buffer.alloc(CHUNK);
let offset = 0;
const hits = [];

while (offset < total) {
  const n = readSync(fd, buf, 0, CHUNK, offset);
  if (n <= 0) break;
  const slice = buf.subarray(0, n);
  let idx = slice.indexOf(NEEDLE);
  while (idx !== -1) {
    hits.push({ at: offset + idx, chunk: Buffer.from(slice.subarray(Math.max(0, idx - 3000), Math.min(n, idx + 5000))) });
    idx = slice.indexOf(NEEDLE, idx + 1);
    if (hits.length > 40) break;
  }
  offset += n - 4096;
  if (hits.length > 40) break;
}
closeSync(fd);

console.log("hits:", hits.length);

// Pick the hit whose neighbourhood has the most CSS custom properties.
const scored = hits
  .map((h) => {
    const text = h.chunk.toString("utf8");
    const vars = (text.match(/--[a-z0-9-]+\s*:/gi) || []).length;
    return { text, vars, at: h.at };
  })
  .sort((a, b) => b.vars - a.vars);

if (!scored.length) process.exit(0);

const best = scored[0];
console.log("best hit at byte", best.at, "custom props:", best.vars, "\n");
console.log(best.text.slice(0, 5000));
