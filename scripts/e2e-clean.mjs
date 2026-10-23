import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
await p.locator(".tab", { hasText: "Proyek" }).click();
await p.waitForTimeout(600);

const readRows = () =>
  p.locator(".project-row").evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector("strong")?.textContent ?? "",
      meta: el.querySelector(".project-info span")?.textContent ?? "",
    })),
  );

const before = await readRows();

for (let guard = 0; guard < 30; guard++) {
  const rows = await readRows();
  const keep = "Editorial print — contoh";
  const seen = new Set();
  let victim = -1;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].title;
    if (t === keep && !seen.has(keep)) {
      seen.add(keep);
      continue;
    }
    victim = i;
    break;
  }
  if (victim < 0) break;
  await p.locator(".project-row").nth(victim).locator('.icon-btn[title="Hapus"]').click();
  await p.waitForTimeout(700);
}

const after = await readRows();
await p.screenshot({ path: "shots/e2e-clean-projects.png" });
console.log(JSON.stringify({ before, after }, null, 1));
await b.close();
