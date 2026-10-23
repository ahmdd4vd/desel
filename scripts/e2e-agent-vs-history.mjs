import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];

const composer = p.locator("textarea[placeholder^='Tulis brief']");
const field = (label) => p.locator(".modal label", { hasText: label }).locator("input").first();

const configure = async (base, model) => {
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Pengaturan (Ctrl+,)" }).click();
  await p.waitForTimeout(400);
  await field("Base URL").fill(base);
  await field("API key").fill("mock-key");
  await field("Model").fill(model);
  await p.getByRole("button", { name: "Simpan", exact: true }).click();
  await p.waitForTimeout(800);
};

const send = async (text, expectThumbs) => {
  await composer.fill(text);
  await composer.press("Enter");
  await p.waitForFunction((n) => document.querySelectorAll(".thumb").length >= n, expectThumbs, { timeout: 60000 });
  await p.waitForTimeout(2500);
};

const out = {};
await configure("http://127.0.0.1:9001/v1", "mock-editorial");

// fresh project so the run is clean
await p.locator(".tab", { hasText: "Proyek" }).click();
await p.waitForTimeout(400);
await p.getByText("Baru", { exact: true }).click();
await p.waitForTimeout(1200);
await p.locator(".tab", { hasText: "Chat" }).click();
await p.waitForTimeout(800);

await send("Bikin carousel 3 slide soal disiplin desain.", 1);
out.firstRun = await p.evaluate(() => ({
  title: document.querySelector(".topbar input")?.value ?? "",
  thumbs: document.querySelectorAll(".thumb").length,
  bad: document.querySelectorAll(".thumb-lint").length,
}));

await send("Tulis ulang slide 1 dengan nada lebih tegas.", 1);
out.secondRun = await p.evaluate(() => ({
  thumbs: document.querySelectorAll(".thumb").length,
  bad: document.querySelectorAll(".thumb-lint").length,
}));

// revisions from the agent's rewrite
await p.locator(".thumb").first().click();
await p.waitForTimeout(800);
await p.locator(".tab", { hasText: "Desain" }).click();
await p.waitForTimeout(1200);
out.revisions = await p.locator(".rev-row").count();

await p.screenshot({ path: "shots/e2e-agent-history.png" });
console.log(JSON.stringify(out, null, 1));
await b.close();
