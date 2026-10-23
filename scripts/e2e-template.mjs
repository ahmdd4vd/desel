import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];
await p.keyboard.press("Escape");
await p.waitForTimeout(400);

await p.getByRole("button", { name: "Simpan desain sebagai template" }).click();
await p.waitForTimeout(700);
const modalFields = await p.evaluate(() => [...document.querySelectorAll(".modal input, .modal textarea")].map(el => ({ tag: el.tagName.toLowerCase(), placeholder: el.placeholder || "", value: el.value || "" })));
await p.locator(".modal input").first().fill("Editorial bata");
await p.locator(".modal textarea").first().fill("Serif display, aksen bata, grain.");
await p.getByRole("button", { name: "Simpan", exact: true }).last().click();
await p.waitForTimeout(1200);

await p.getByRole("button", { name: "Template", exact: true }).click();
await p.waitForTimeout(800);
const templates = await p.evaluate(() => [...document.querySelectorAll(".tpl, .template, .card")].map(e => (e.textContent || "").trim().slice(0, 60)).filter(Boolean).slice(0, 6));
await p.screenshot({ path: "shots/e2e-template.png" });
console.log(JSON.stringify({ modalFields, templates }, null, 1));
await b.close();
