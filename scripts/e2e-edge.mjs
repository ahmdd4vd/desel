import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];

const setProvider = async (base, model) => {
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Pengaturan (Ctrl+,)" }).click();
  await p.waitForTimeout(400);
  const field = (label) => p.locator(".modal label", { hasText: label }).locator("input").first();
  await field("Base URL").fill(base);
  await field("API key").fill("mock-key");
  await field("Model").fill(model);
  await p.getByRole("button", { name: "Simpan", exact: true }).click();
  await p.waitForTimeout(700);
};

const composer = p.locator("textarea[placeholder^='Tulis brief']");

// ---- 1. clarifying question -------------------------------------------------
await setProvider("http://127.0.0.1:9002/v1", "mock-edge");
await composer.fill("Bikin carousel soal kopi.");
await composer.press("Enter");

await p.waitForFunction(() => document.querySelector(".chat-log")?.innerText.includes("brand kopi"), null, { timeout: 45000 });
const afterAsk = await p.evaluate(() => ({
  text: document.querySelector(".chat-log").innerText.slice(-300),
  status: document.querySelector(".composer")?.className,
  disabled: document.querySelector("textarea[placeholder^='Tulis brief']")?.disabled,
  placeholder: document.querySelector("textarea[placeholder^='Tulis brief']")?.placeholder,
}));

// answer the question
await composer.fill("Brand kopi susu lokal, audiens mahasiswa.");
await composer.press("Enter");
await p.waitForFunction(() => document.querySelectorAll(".thumb").length >= 1, null, { timeout: 45000 });
const thumbsAfterAnswer = await p.locator(".thumb").count();

// ---- 2. provider error ------------------------------------------------------
await setProvider("http://127.0.0.1:9003/v1", "bad-key");
await composer.fill("Coba generate lagi.");
await composer.press("Enter");
await p.waitForTimeout(4000);
const toast = await p.locator(".toast").innerText().catch(() => "");
const status = await p.locator(".composer").getAttribute("class");
await p.screenshot({ path: "shots/e2e-question.png" });

console.log(JSON.stringify({ afterAsk, thumbsAfterAnswer, toast, status }, null, 1));
await b.close();
