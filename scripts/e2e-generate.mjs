import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];

// close anything left open by an earlier probe
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// settings: point the app at the local mock provider
await p.getByRole("button", { name: "Pengaturan (Ctrl+,)" }).click();
await p.waitForTimeout(500);
const field = (label) => p.locator(".modal label", { hasText: label }).locator("input").first();
await field("Base URL").fill("http://127.0.0.1:9001/v1");
await field("API key").fill("mock-key");
await field("Model").fill("mock-designer");
await p.getByRole("button", { name: "Simpan", exact: true }).click();
await p.waitForTimeout(900);

// ask for a deck
const composer = p.locator("textarea[placeholder^='Tulis brief']");
await composer.fill("Bikin carousel 3 slide soal kerja kreatif yang tidak cukup cuma rajin, gaya editorial print.");
await composer.press("Enter");

// wait for the agent to write three slides
await p.waitForFunction(() => document.querySelectorAll(".thumb").length >= 3, null, { timeout: 60000 });
await p.waitForTimeout(2500);

const thumbs = await p.locator(".thumb").count();
const lintBadges = await p.locator(".thumb-lint").count();
const chatText = await p.locator(".chat-log").innerText();
const assistant = chatText.split("\n").filter(Boolean).slice(-4).join(" | ");
await p.screenshot({ path: "shots/e2e-generated.png" });

console.log(JSON.stringify({ thumbs, lintBadges, assistantTail: assistant.slice(0, 220) }, null, 1));
await b.close();
