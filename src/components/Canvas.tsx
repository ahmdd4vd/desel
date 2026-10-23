import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Maximize2, MessageSquarePlus, Minus, Plus, Scan } from "lucide-react";
import type { Comment } from "../lib/types";

/**
 * The artboard, handled like a design tool instead of a picture:
 * cursor-anchored zoom, drag-to-pan, element picking inside the slide,
 * inline text editing, and notes pinned to a position (and an element).
 */

export interface CanvasProps {
  /** Sanitised, self-contained slide document. */
  doc: string;
  /** Change this to reset the viewport (slide switch). */
  slideKey: string;
  width: number;
  height: number;
  notes: Comment[];
  /** Comment tool armed: next click drops a pin. */
  pinning: boolean;
  activeNoteId?: string | null;
  onTogglePinning: () => void;
  /** Click on the artboard while the note tool is armed. */
  onRequestPin: (x: number, y: number, selector: string) => void;
  onSelectNote: (id: string) => void;
  /** Text was edited directly on the artboard. */
  onEditHtml: (html: string) => void;
  onNotify?: (text: string) => void;
}

interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SCALE = 0.08;
const MAX_SCALE = 4;

/** Wheel → zoom factor. Damped, and clamped so one notch never jumps. */
function wheelFactor(e: WheelEvent) {
  const raw = Math.exp(-e.deltaY * (e.ctrlKey ? 0.006 : 0.0016));
  return clamp(raw, 0.82, 1.22);
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Readable, stable-ish path for an element inside the slide. */
function pathOf(el: Element, doc: Document): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.body && node !== doc.documentElement && parts.length < 4) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const classes = Array.from(node.classList).slice(0, 2);
    parts.unshift(`${tag}${id}${classes.length ? `.${classes.join(".")}` : ""}`);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function labelOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = Array.from(el.classList).slice(0, 2).join(".");
  return cls ? `${tag}.${cls}` : tag;
}

/** Elements that make sense to edit as text. */
function editableOf(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  if (!text) return false;
  // Only leaf-ish elements: editing a wrapper would merge separate runs.
  return Array.from(el.children).every((c) => (c.textContent ?? "").trim().length === 0 || c.children.length > 0 === false);
}

export default function Canvas(props: CanvasProps) {
  const { doc, slideKey, width, height, notes, pinning, activeNoteId, onTogglePinning, onRequestPin, onSelectNote, onEditHtml, onNotify } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [vp, setVp] = useState<Viewport>({ scale: 0.4, tx: 0, ty: 0 });
  const [hover, setHover] = useState<(Box & { label: string }) | null>(null);
  const [pick, setPick] = useState<(Box & { label: string; selector: string; editable: boolean }) | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [editing, setEditing] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState(false);

  const vpRef = useRef(vp);
  vpRef.current = vp;
  const spaceRef = useRef(space);
  spaceRef.current = space;
  const pinRef = useRef(pinning);
  pinRef.current = pinning;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  /** Detach handle for the listeners bound to the current slide document. */
  const wiredRef = useRef<(() => void) | null>(null);

  /* ---------------------------------------------------------------- fit --- */

  const fit = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 44;
    const scale = clamp(Math.min((rect.width - pad * 2) / width, (rect.height - pad * 2) / height), MIN_SCALE, 1);
    setVp({
      scale,
      tx: (rect.width - width * scale) / 2,
      ty: (rect.height - height * scale) / 2,
    });
  }, [width, height]);

  useLayoutEffect(() => {
    fit();
  }, [fit, slideKey]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Keep the same spot on screen when the panel is resized.
      setVp((v) => v);
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  /* --------------------------------------------------------------- zoom --- */

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setVp((v) => {
      const next = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      if (next === v.scale) return v;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const wx = (px - v.tx) / v.scale;
      const wy = (py - v.ty) / v.scale;
      return { scale: next, tx: px - wx * next, ty: py - wy * next };
    });
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  /* ------------------------------------------------ wheel, keys, panning --- */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, wheelFactor(e));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable;
      if (typing) return;
      if (e.code === "Space" && hovered) {
        e.preventDefault();
        setSpace(true);
      }
      if (!hovered) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(1.2);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(1 / 1.2);
      } else if (e.key === "0") {
        e.preventDefault();
        fit();
      } else if (e.key === "1") {
        e.preventDefault();
        setVp((v) => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect) return v;
          return { scale: 1, tx: (rect.width - width) / 2, ty: (rect.height - height) / 2 };
        });
      } else if (e.key === "Escape" && pinning) {
        onTogglePinning();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const clearSpace = () => setSpace(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearSpace);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearSpace);
    };
  }, [fit, hovered, pinning, onTogglePinning, zoomBy, width, height]);

  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const startPan = (e: React.PointerEvent) => {
    const middle = e.button === 1;
    const onBackground = e.target === rootRef.current || (e.target as HTMLElement).dataset.pan === "1";
    if (!middle && !spaceRef.current && !onBackground) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panStart.current = { x: e.clientX, y: e.clientY, tx: vpRef.current.tx, ty: vpRef.current.ty };
    setPanning(true);
  };

  const movePan = (e: React.PointerEvent) => {
    if (!panStart.current) return;
    const d = panStart.current;
    setVp((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  };

  const endPan = () => {
    panStart.current = null;
    setPanning(false);
  };

  /* -------------------------------------------------- slide interactions --- */

  const commitEdit = useCallback(
    (frame: HTMLIFrameElement) => {
      const docEl = frame.contentDocument?.documentElement;
      if (!docEl) return;
      const clone = docEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[contenteditable]").forEach((el) => {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-desel-editing");
        (el as HTMLElement).style.removeProperty("outline");
        (el as HTMLElement).style.removeProperty("outline-offset");
        if (!(el as HTMLElement).getAttribute("style")) el.removeAttribute("style");
      });
      onEditHtml(`<!doctype html>\n${clone.outerHTML}`);
      setEditing(false);
      setPick(null);
    },
    [onEditHtml],
  );

  const startEdit = useCallback(
    (frame: HTMLIFrameElement, el: HTMLElement) => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return;
      setEditing(true);
      el.setAttribute("contenteditable", "true");
      el.setAttribute("data-desel-editing", "1");
      el.style.outline = "2px solid #7aa2f7";
      el.style.outlineOffset = "2px";
      el.focus();
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const stop = () => {
        el.removeEventListener("blur", stop);
        commitEdit(frame);
      };
      el.addEventListener("blur", stop, { once: true });
      el.addEventListener("keydown", (ev) => {
        const ke = ev as KeyboardEvent;
        if (ke.key === "Escape" || (ke.key === "Enter" && (ke.ctrlKey || ke.metaKey))) {
          ke.preventDefault();
          el.blur();
        }
      });
    },
    [commitEdit],
  );

  /** Wire listeners into the slide document (same-origin, so no bridge needed). */
  const wire = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!frame || !doc || !win) return;

    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };

    const onMove = (e: MouseEvent) => {
      setCursor({ x: e.clientX / width, y: e.clientY / height });
      if (editingRef.current) return;
      const target = e.target as Element | null;
      if (!target || target === doc.documentElement || target === doc.body) {
        setHover(null);
        return;
      }
      setHover({ ...boxOf(target), label: labelOf(target) });
    };

    const onLeave = () => {
      setHover(null);
      setCursor(null);
    };

    const onClick = (e: MouseEvent) => {
      if (editingRef.current) return;
      const target = e.target as Element | null;
      if (!target) return;
      if (pinRef.current) {
        e.preventDefault();
        const x = clamp(e.clientX / width, 0, 1);
        const y = clamp(e.clientY / height, 0, 1);
        const selector = target === doc.body ? "" : pathOf(target, doc);
        onRequestPin(x, y, selector);
        return;
      }
      if (target === doc.body || target === doc.documentElement) {
        setPick(null);
        return;
      }
      setPick({
        ...boxOf(target),
        label: labelOf(target),
        selector: pathOf(target, doc),
        editable: editableOf(target),
      });
    };

    const onDblClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || pinRef.current || editingRef.current) return;
      if (!editableOf(target)) {
        onNotify?.("Elemen ini bukan teks — ubah lewat tab Kode.");
        return;
      }
      e.preventDefault();
      startEdit(frame, target as HTMLElement);
    };

    const onKeyDownDoc = (e: KeyboardEvent) => {
      if (e.code === "Space" && !editingRef.current) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const onKeyUpDoc = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };

    const onWheelDoc = (e: WheelEvent) => {
      e.preventDefault();
      const rect = frame.getBoundingClientRect();
      zoomAt(rect.left + e.clientX * vpRef.current.scale, rect.top + e.clientY * vpRef.current.scale, wheelFactor(e));
    };

    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseleave", onLeave);
    doc.addEventListener("click", onClick);
    doc.addEventListener("dblclick", onDblClick);
    doc.addEventListener("keydown", onKeyDownDoc);
    doc.addEventListener("keyup", onKeyUpDoc);
    win.addEventListener("wheel", onWheelDoc, { passive: false });
    win.addEventListener("blur", onKeyUpDoc as unknown as EventListener);

    return () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseleave", onLeave);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("dblclick", onDblClick);
      doc.removeEventListener("keydown", onKeyDownDoc);
      doc.removeEventListener("keyup", onKeyUpDoc);
      win.removeEventListener("wheel", onWheelDoc);
      win.removeEventListener("blur", onKeyUpDoc as unknown as EventListener);
    };
  }, [height, onNotify, onRequestPin, startEdit, width, zoomAt]);

  const attach = useCallback(() => {
    wiredRef.current?.();
    wiredRef.current = wire() ?? null;
  }, [wire]);

  useEffect(() => {
    attach();
    return () => {
      wiredRef.current?.();
      wiredRef.current = null;
    };
    // srcDoc changes replace the document, so re-bind on every new one.
  }, [attach, doc]);

  useEffect(() => {
    setPick(null);
    setHover(null);
  }, [doc, slideKey]);

  /* ------------------------------------------------------------- render --- */

  const pins = useMemo(() => notes.slice(0, 40), [notes]);
  const moving = panning || space;

  return (
    <div
      ref={rootRef}
      className={`cv ${moving ? "cv-pan" : ""} ${pinning ? "cv-arming" : ""} ${editing ? "cv-editing" : ""}`}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDoubleClick={(e) => {
        // Double-click on empty canvas fits the artboard again.
        if (e.target === rootRef.current) fit();
      }}
    >
      <div className="cv-space" data-pan="1" />

      <div
        className="cv-page"
        style={{
          width,
          height,
          transform: `translate3d(${vp.tx}px, ${vp.ty}px, 0) scale(${vp.scale})`,
        }}
      >
        <iframe
          ref={frameRef}
          title="Artboard"
          sandbox="allow-same-origin"
          srcDoc={doc}
          style={{ pointerEvents: space || panning ? "none" : "auto" }}
          onLoad={() => {
            setPick(null);
            setHover(null);
            attach();
          }}
        />

        {hover && !pick && !editing && !pinning && (
          <div
            className="cv-hover"
            style={{ left: hover.x, top: hover.y, width: hover.w, height: hover.h }}
          >
            <span className="cv-tag">{hover.label}</span>
          </div>
        )}

        {pick && !editing && (
          <div className="cv-pick" style={{ left: pick.x, top: pick.y, width: pick.w, height: pick.h }}>
            <span className="cv-tag">
              {pick.label}
              <em>
                {Math.round(pick.w)}×{Math.round(pick.h)}
              </em>
            </span>
            <span className="cv-pick-hint">klik 2× untuk ubah teks</span>
          </div>
        )}

        {pins.map((c, i) => (
          <button
            key={c.id}
            className={`cv-pin ${c.status} ${activeNoteId === c.id ? "active" : ""}`}
            style={{
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              transform: `translate(-50%, -50%) scale(${1 / vp.scale})`,
              // while the note tool is armed, pins must not eat the click
              pointerEvents: pinning ? "none" : "auto",
            }}
            title={`${c.selector ? `${c.selector}\n` : ""}${c.body}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectNote(c.id);
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* floating tool bar, Figma-style: bottom-left, out of the artwork's way */}
      <div className="cv-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={`cv-tool ${pinning ? "on" : ""}`}
          title="Komentari canvas (C)"
          onClick={onTogglePinning}
        >
          <MessageSquarePlus size={15} />
        </button>
        <span className="cv-sep" />
        <button className="cv-tool" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.2)}>
          <Minus size={15} />
        </button>
        <button className="cv-zoom" title="Klik untuk 100%" onClick={() => setVp((v) => ({ ...v, scale: 1 }))}>
          {Math.round(vp.scale * 100)}%
        </button>
        <button className="cv-tool" title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
          <Plus size={15} />
        </button>
        <span className="cv-sep" />
        <button className="cv-tool" title="Sesuaikan layar (0)" onClick={fit}>
          <Scan size={15} />
        </button>
        <button
          className="cv-tool"
          title="Ukuran asli (1)"
          onClick={() =>
            setVp((v) => {
              const rect = rootRef.current?.getBoundingClientRect();
              if (!rect) return v;
              return { scale: 1, tx: (rect.width - width) / 2, ty: (rect.height - height) / 2 };
            })
          }
        >
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="cv-hud">
        {pinning ? (
          <span className="cv-hint">
            <Check size={12} /> Klik titik mana pun di slide — posisi &amp; elemennya ikut tercatat
          </span>
        ) : pick ? (
          <span className="cv-meta">
            <strong>{pick.label}</strong>
            <em>{pick.selector}</em>
          </span>
        ) : cursor ? (
          <span className="cv-meta">
            <em>
              x {Math.round(cursor.x * width)} · y {Math.round(cursor.y * height)}
            </em>
          </span>
        ) : (
          <span className="cv-meta dim">Scroll untuk zoom · space + drag untuk geser</span>
        )}
      </div>
    </div>
  );
}