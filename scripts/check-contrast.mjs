import { createRequire } from "node:module";
const r = createRequire("C:/nvm4w/nodejs/node_modules/");
const { chromium } = r("playwright");
const b = await chromium.launch({ executablePath: (process.env.CHROME_BIN || "chromium"), headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await p.waitForTimeout(900);
const out = await p.evaluate(() => {
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  const rgb = (v) => { probe.style.color = ""; probe.style.color = v; return getComputedStyle(probe).color; };
  const toNums = (s) => (s.match(/[\d.]+/g) || []).slice(0,3).map(Number);
  const lum = (c) => toNums(c).map(v => { const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); }).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0);
  const ratio = (a,b) => { const x = lum(a), y = lum(b); return +(((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)); };
  const css = getComputedStyle(document.documentElement);
  const t = (n) => rgb(css.getPropertyValue(n).trim());
  const panel = rgb("#0e0e11"), app = rgb("#0b0b0d"), input = rgb("#17171c");
  const res = {
    text_on_panel: ratio(t("--text"), panel),
    text2_on_panel: ratio(t("--text-2"), panel),
    text3_on_panel: ratio(t("--text-3"), panel),
    text4_on_panel: ratio(t("--text-4"), panel),
    accent_on_app: ratio(t("--accent"), app),
    primary_ink_on_primary: ratio(t("--primary-ink"), t("--primary")),
    text_on_input: ratio(t("--text"), input),
    ok_on_app: ratio(t("--ok"), app),
    danger_on_app: ratio(t("--danger"), app),
  };
  probe.remove();
  return res;
});
console.log(JSON.stringify(out, null, 2));
await b.close();
