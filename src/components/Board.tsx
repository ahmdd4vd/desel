import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus, Scan } from "lucide-react";
import type { Slide } from "../lib/types";
import { markChangedElements } from "../lib/live-diff";

interface BoardProps {
  slides: Slide[];
  activeId: string | null;
  width: number;
  height: number;
  noteCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}
const ARTBOARD_W = 340;
const GAP = 36;
const clamp = (n: number) => Math.max(.15, Math.min(3, n));

/** Keep the previous pixels until the replacement frame is ready. */
function Preview({ html, width, height }: { html: string; width: number; height: number }) {
  const [layers, setLayers] = useState([{ id: 0, html, previous: null as string | null }]);
  const [ready, setReady] = useState(0);
  const seq = useRef(0);
  const previous = useRef(html);
  useEffect(() => {
    if (previous.current === html) return;
    const old = previous.current;
    previous.current = html;
    const id = ++seq.current;
    setLayers(l => [...l.slice(-1), { id, html, previous: old }]);
  }, [html]);
  useEffect(() => {
    if (layers.length < 2 || ready !== layers[layers.length - 1].id) return;
    const timer = setTimeout(() => setLayers(l => l.filter(x => x.id === ready)), 360);
    return () => clearTimeout(timer);
  }, [ready, layers]);
  return <>{layers.map(layer => <iframe key={layer.id} title="Pratinjau slide" tabIndex={-1}
    sandbox="allow-same-origin" srcDoc={layer.html}
    onLoad={e => {
      const doc = e.currentTarget.contentDocument;
      if (doc && layer.previous) markChangedElements(doc, layer.previous);
      setReady(r => Math.max(r, layer.id));
    }}
    style={{ position: "absolute", left: 0, top: 0, width, height,
      transform: `scale(${ARTBOARD_W / width})`, transformOrigin: "top left",
      pointerEvents: "none", border: 0, display: "block", background: "transparent",
      opacity: layer.previous && ready < layer.id ? 0 : 1, transition: "opacity 220ms ease" }}
  />)}</>;
}

export default function Board({ slides, activeId, width, height, noteCounts, onSelect, onFocus }: BoardProps) {
  const root = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ x: 28, y: 28, scale: 1 });
  const vpRef = useRef(vp); vpRef.current = vp;
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<null | { x: number; y: number; px: number; py: number }>(null);
  const moved = useRef(false);
  const columns = Math.min(3, Math.max(1, slides.length));
  const cardH = height * ARTBOARD_W / width;
  const planeW = columns * (ARTBOARD_W + GAP) - GAP;
  const planeH = Math.max(1,Math.ceil(slides.length / columns)) * (cardH + 32 + GAP) - GAP;
  const fit = useCallback(() => {
    const r = root.current?.getBoundingClientRect(); if (!r) return;
    const scale = Math.max(.15, Math.min(1, (r.width - 64) / planeW, (r.height - 140) / planeH));
    setVp({ scale, x: (r.width - planeW * scale) / 2, y: Math.max(28, (r.height - 60 - planeH * scale) / 2) });
  }, [planeW, planeH]);
  useLayoutEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left; const py = e.clientY - r.top;
      setVp(v => {
        const scale = clamp(v.scale * Math.exp(-e.deltaY * .002));
        return { scale, x: px - (px - v.x) * scale / v.scale, y: py - (py - v.y) * scale / v.scale };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    const resize = new ResizeObserver(fit); resize.observe(el);
    return () => { el.removeEventListener("wheel", wheel); resize.disconnect(); };
  }, [fit]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.defaultPrevented||target.closest("button,input,textarea,select,[contenteditable],.board-item")) return;
      if (e.code === "Space") { e.preventDefault(); setSpace(e.type === "keydown"); }
      if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); fit(); }
    };
    const blur = () => { setSpace(false); setDragging(false); drag.current = null; };
    window.addEventListener("keydown", key); window.addEventListener("keyup", key); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("blur", blur); };
  }, [fit]);
  const zoom = (factor: number) => {
    const r = root.current?.getBoundingClientRect(); if (!r) return;
    setVp(v => { const scale = clamp(v.scale * factor); return { scale, x: r.width / 2 - (r.width / 2 - v.x) * scale / v.scale, y: r.height / 2 - (r.height / 2 - v.y) * scale / v.scale }; });
  };
  return <div ref={root} className={`board board-plane ${space || dragging ? "board-pan" : ""}`} data-pan="1"
    onPointerDown={e => {
      if ((e.target as HTMLElement).closest(".board-item") && !space && e.button === 0) moved.current = false;
      if (e.button !== 0 && e.button !== 1) return;
      if (!space && e.button !== 1 && (e.target as HTMLElement).closest(".board-item,.board-tools")) return;
      e.preventDefault(); moved.current = false;
      drag.current = { x: e.clientX, y: e.clientY, px: vp.x, py: vp.y };
      setDragging(true); e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      const d = drag.current; if (!d) return;
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) moved.current = true;
      setVp(v => ({ ...v, x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
    }}
    onPointerUp={e => { drag.current = null; setDragging(false); if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={() => { drag.current = null; setDragging(false); }}>
    {!slides.length&&<p className="board-empty">Tidak ada slide terlihat di papan. Pilih thumbnail dan aktifkan kembali melalui Properti slide.</p>}
    <div className="board-grid" style={{ position: "absolute", left: 0, top: 0, width: planeW, height: planeH, display: "grid", gridTemplateColumns: `repeat(${columns}, ${ARTBOARD_W}px)`, gap: GAP, transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.scale})`, transformOrigin: "top left" }}>
      {slides.map((s, i) => <div key={s.id} className={`board-item ${s.id === activeId ? "active" : ""}`} role="button" tabIndex={0} aria-label={`Edit slide ${i+1}: ${s.title||"Tanpa judul"}`} aria-pressed={s.id===activeId}
        onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onFocus(s.id)}}}
        onClick={() => { if (!moved.current && !space) onSelect(s.id); moved.current = false; }}
        onDoubleClick={() => { if (!space) onFocus(s.id); }}
        title={`${s.title || `Slide ${i + 1}`} - klik 2x untuk mengedit di mode fokus`}>
        <div className="board-frame" style={{ width: ARTBOARD_W, height: cardH }}>
          <Preview html={s.html} width={width} height={height} />
          {(noteCounts[s.id] ?? 0) > 0 && <span className="board-notes">{noteCounts[s.id]}</span>}
        </div>
        <div className="board-label"><span className="board-num">{i + 1}</span><span className="board-title">{s.title || "Slide"}</span></div>
      </div>)}
    </div>
    <div className="board-tools" aria-label="Kontrol papan">
      <button title="Perkecil papan" onClick={() => zoom(1 / 1.2)}><Minus size={15}/></button>
      <span aria-label="Zoom papan">{Math.round(vp.scale * 100)}%</span>
      <button title="Perbesar papan" onClick={() => zoom(1.2)}><Plus size={15}/></button>
      <button title="Pas semua slide (Ctrl+0)" onClick={fit}><Scan size={15}/></button>
    </div>
    <span className="board-help">Scroll untuk zoom · Space + drag untuk geser · Klik 2x untuk edit</span>
  </div>;
}
