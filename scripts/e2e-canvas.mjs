import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts()[0].pages()[0];

const errors = [];
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// fresh mount so "fit to screen" is exercised from scratch
await p.reload();
await p.waitForSelector(".cv", { timeout: 30000 });
await p.waitForTimeout(1200);

const box = await p.locator(".cv").boundingBox();
const read = () =>
  p.evaluate(() => {
    const page = document.querySelector(".cv-page");
    const m = page?.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px.*scale\(([\d.]+)\)/);
    const r = page?.getBoundingClientRect();
    return {
      scale: m ? +m[3] : null,
      tx: m ? +m[1] : null,
      ty: m ? +m[2] : null,
      zoom: document.querySelector(".cv-zoom")?.textContent ?? "",
      hud: document.querySelector(".cv-hud")?.textContent?.trim() ?? "",
      pins: document.querySelectorAll(".cv-pin").length,
      pick: document.querySelector(".cv-pick .cv-tag")?.textContent ?? "",
      pageRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      canvasRect: (() => {
        const c = document.querySelector(".cv")?.getBoundingClientRect();
        return c ? { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) } : null;
      })(),
    };
  });

const out = { fit: await read() };

// --- zoom anchored on the cursor: the world point under the pointer must not drift
const ax = box.x + box.width * 0.62;
const ay = box.y + box.height * 0.44;
const world = async () =>
  p.evaluate(
    ([cx, cy]) => {
      const page = document.querySelector(".cv-page");
      const m = page.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px.*scale\(([\d.]+)\)/);
      const r = document.querySelector(".cv").getBoundingClientRect();
      const scale = +m[3];
      return { x: (cx - r.left - +m[1]) / scale, y: (cy - r.top - +m[2]) / scale };
    },
    [ax, ay],
  );
const before = await world();
await p.mouse.move(ax, ay);
for (let i = 0; i < 4; i++) {
  await p.mouse.wheel(0, -100);
  await p.waitForTimeout(120);
}
await p.waitForTimeout(250);
const afterZoom = await world();
out.zoom = {
  from: out.fit.zoom,
  to: (await read()).zoom,
  anchorDrift: +Math.hypot(afterZoom.x - before.x, afterZoom.y - before.y).toFixed(2),
};

// --- space + drag pans exactly by the drag delta
const p0 = await read();
await p.keyboard.down("Space");
await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.5 + 90, box.y + box.height * 0.5 + 55, { steps: 6 });
await p.mouse.up();
await p.keyboard.up("Space");
await p.waitForTimeout(200);
const p1 = await read();
out.pan = { dx: Math.round(p1.tx - p0.tx), dy: Math.round(p1.ty - p0.ty) };

// --- click art to select an element
const frame = p.frameLocator(".cv-page iframe");
await frame.locator("h1 em").first().click({ force: true });
await p.waitForTimeout(300);
out.pick = await read();

// --- arm the note tool and pin that element
await p.locator(".cv-tool").first().click();
await p.waitForTimeout(200);
await frame.locator("h1 em").first().click({ force: true });
await p.waitForTimeout(500);
out.dialog = (await p.locator(".modal", { hasText: "Catatan baru" }).count()) > 0;
await p.locator(".modal textarea").fill("Headline kurang tegas, naikkan kontrasnya.");
await p.getByRole("button", { name: "Tambah", exact: true }).click();
await p.waitForTimeout(900);
const pinned = await read();
out.pin = {
  pins: pinned.pins,
  titles: await p.locator(".cv-pin").evaluateAll((els) => els.map((e) => e.getAttribute("title"))),
};

// --- inline text edit on another slide (the pinned one is covered by its pin)
await p.locator(".thumb").nth(1).click();
await p.waitForTimeout(900);
const frame2 = p.frameLocator(".cv-page iframe");
const target = (await frame2.locator("h1, h2").count()) ? frame2.locator("h1, h2").first() : frame2.locator("p").first();
await target.dblclick();
await p.waitForTimeout(250);
out.viewAfterSwitch = await read();
out.editing = await p.evaluate(() => {
  const doc = document.querySelector(".cv-page iframe")?.contentDocument;
  const el = doc?.querySelector("[contenteditable]");
  return { active: !!el, tag: el?.tagName ?? "", focused: doc?.activeElement?.tagName ?? "" };
});
if (out.editing.active) {
  await p.keyboard.press("Control+A");
  await p.keyboard.type("TIDAK CUKUP");
  await p.waitForTimeout(200);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1500);
  out.saved = await p.evaluate(() => {
    const doc = document.querySelector(".cv-page iframe")?.contentDocument;
    return {
      inDoc: doc?.body?.innerHTML.includes("TIDAK CUKUP") ?? false,
      editable: !!doc?.querySelector("[contenteditable]"),
      toast: document.querySelector(".toast")?.textContent?.trim() ?? "",
    };
  });
}

// leave the sample deck exactly as shipped (this run edited a pixel)
await p.keyboard.press("Control+s");
await p.waitForTimeout(900);
await p.locator(".tab", { hasText: "Proyek" }).click();
await p.waitForTimeout(500);
const sampleRow = p.locator(".project-row", { hasText: "Editorial print" }).first();
if (await sampleRow.count()) {
  await sampleRow.locator('[title="Hapus"]').click();
  await p.waitForTimeout(900);
}
await p.locator(".tab", { hasText: "Chat" }).click();
await p.waitForTimeout(400);
await p.locator(".starter-ghost", { hasText: "Muat contoh" }).click();
await p.waitForTimeout(1500);
out.cleaned = await p.evaluate(() => ({
  thumbs: document.querySelectorAll(".thumb").length,
  pins: document.querySelectorAll(".cv-pin").length,
}));

out.errors = [...new Set(errors)].filter((e) => !e.includes("Blocked script execution")).slice(0, 3);
out.blockedScripts = errors.filter((e) => e.includes("Blocked script execution")).length;
await p.screenshot({ path: "shots/canvas-figma.png" });
console.log(JSON.stringify(out, null, 1));
await b.close();