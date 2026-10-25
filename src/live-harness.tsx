/**
 * Test-only harness (not shipped): mounts the real Canvas component and
 * exposes window hooks so an automated driver can push new slide documents
 * the way deck_updated events would, then verify the live-editing behavior.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import { followChangedSlideId } from "./lib/live-diff";
import "../src/styles/app.css";

const W = 540;
const H = 675;

declare global {
  interface Window {
    __setDoc: (html: string) => void;
    __setSlide: (key: string, html: string) => void;
    __follow: typeof followChangedSlideId;
    __canvas: () => HTMLIFrameElement | null;
  }
}

function slideDoc(bg: string, blocks: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;
    background:${bg};font-family:system-ui,sans-serif}
    .pad{padding:40px}
    h1{font-size:44px;margin:0 0 16px}
    p{font-size:20px;margin:0 0 16px;opacity:.85}
    .card{border-radius:14px;padding:22px;margin-top:18px;font-size:18px}
  </style></head><body><div class="pad">${blocks}</div></body></html>`;
}

const DOC_A = slideDoc("#101010", `
  <h1 style="color:#f2ece1">Judul awal</h1>
  <p style="color:#f2ece1">Subjudul versi pertama.</p>
  <div class="card" style="background:#1d2b22;color:#a9ecc6">Kartu pertama</div>
`);

const DOC_B = slideDoc("#101010", `
  <h1 style="color:#f2ece1">Judul awal</h1>
  <p style="color:#ffd9a0">Subjudul DIREVISI agent.</p>
  <div class="card" style="background:#1d2b22;color:#a9ecc6">Kartu pertama</div>
  <div class="card" style="background:#3a2a1d;color:#ffb38a">Kartu baru ditambahkan</div>
`);

function Harness() {
  const [doc, setDoc] = useState(DOC_A);
  const [key, setKey] = useState("s1");
  window.__setDoc = setDoc;
  window.__setSlide = (k, h) => { setKey(k); setDoc(h); };
  return (
    <div style={{ width: 900, height: 760, position: "relative", background: "#191919", display: "flex" }}>
      <style>{`.cv{flex:1 1 auto}`}</style>
      <Canvas
        doc={doc}
        slideKey={key}
        width={W}
        height={H}
        notes={[]}
        pinning={false}
        onTogglePinning={() => {}}
        onRequestPin={() => {}}
        onSelectNote={() => {}}
        onEditHtml={(h) => { (window as unknown as { __lastEdit: string }).__lastEdit = h; }}
      />
    </div>
  );
}

window.__follow = followChangedSlideId;
window.__canvas = () => {
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>(".cv-stack iframe"));
  return frames.length ? frames[frames.length - 1] : null;
};

createRoot(document.getElementById("root")!).render(<Harness />);
