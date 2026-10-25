import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bold, Check, Italic, Maximize2, MessageSquarePlus, Minus, Plus, Scan } from "lucide-react";
import type { Asset, Comment } from "../lib/types";
import {captureObjectStyle,applyObjectStyle,type ObjectStyle} from "../lib/object-style";
import {duplicateObject} from "../lib/duplicate-object";
import {readWorkspacePosition} from "../lib/workspace-position";
import {alignObject,nudgeObject,setObjectBox} from "../lib/object-position";
import { markChangedElements,cleanLiveHighlightClone } from "../lib/live-diff";

/**
 * The artboard, handled like a design tool instead of a picture:
 * cursor-anchored zoom, drag-to-pan, element picking inside the slide,
 * inline text editing, and notes pinned to a position (and an element).
 */

export interface CanvasProps {
  /** Sanitised, self-contained slide document. */
  doc: string;
  assets?:Asset[];
  deckKey?: string;
  slideTitle?: string;
  neighbour?: {id:string;title:string;doc:string};
  onSelectNeighbour?: (id:string) => void;
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
  onEditHtml: (html: string, slideId: string) => void;
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

/** Internal reveal/editor markers must never become durable element identity. */
const contentClasses = (el: Element) => Array.from(el.classList).filter(c => !c.startsWith("desel-"));

/** Unique structural path, independent of transient reveal classes. */
function pathOf(el: Element, doc: Document): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.body && node !== doc.documentElement) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${CSS.escape(node.id)}` : "";
    const classes = contentClasses(node).slice(0, 2).map(c => CSS.escape(c));
    const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(s => s.tagName === node!.tagName) : [];
    const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : "";
    parts.unshift(`${tag}${id}${classes.length ? `.${classes.join(".")}` : ""}${nth}`);
    const path = parts.join(" > ");
    if (doc.querySelectorAll(path).length === 1) return path;
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function labelOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = contentClasses(el).slice(0, 2).join(".");
  return cls ? `${tag}.${cls}` : tag;
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return "#a9ecc6";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Fonts the slides are allowed to use (same constraint the agent follows). */
const STYLE_FONTS = [
  "Georgia", "Arial", "Helvetica", "Impact", "Courier New", "Segoe UI",
  "Consolas", "Trebuchet MS", "Palatino Linotype", "Franklin Gothic Medium",
  "Arial Black", "Cambria", "Constantia", "Times New Roman",
];

/** Elements that make sense to edit as text. */
function editableOf(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  if (!text) return false;
  // Only leaf-ish elements: editing a wrapper would merge separate runs.
  return Array.from(el.children).every((c) => (c.textContent ?? "").trim().length === 0 || c.children.length > 0 === false);
}

export default function Canvas(props: CanvasProps) {
  const { doc, slideKey, width, height, notes, pinning, activeNoteId, onTogglePinning, onRequestPin, onSelectNote, onEditHtml, onNotify } = props;
  const [offset, setOffset] = useState({x:0,y:0});
  const offsetRef = useRef(offset); offsetRef.current = offset;
  const artDrag = useRef<{x:number;y:number;ox:number;oy:number}|null>(null);
  const positionKey = `desel.spatial.${props.deckKey ?? "deck"}.${props.slideKey}`;
  useEffect(() => {try {setOffset(readWorkspacePosition(localStorage.getItem(positionKey)));} catch {setOffset({x:0,y:0});}},[positionKey]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [vp, setVp] = useState<Viewport>({ scale: 0.4, tx: 0, ty: 0 });
  const [hover, setHover] = useState<(Box & { label: string }) | null>(null);
  const [pick, setPick] = useState<(Box & { label: string; selector: string; editable: boolean }) | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Style toolbar owns the frame until it commits, like text editing. */
  const [styling, setStyling] = useState(false);
  const [styleTick, setStyleTick] = useState(0);
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [objectsOpen,setObjectsOpen]=useState(false);
  const [arrangeTick,setArrangeTick]=useState(0);
  const [objectTick,setObjectTick]=useState(0);
  const [imageAsset,setImageAsset]=useState("");
  const [addingImage,setAddingImage]=useState(false);
  const addingImageRef=useRef(false);
  const [copiedStyle,setCopiedStyle]=useState<ObjectStyle|null>(null);

  const vpRef = useRef(vp);
  vpRef.current = vp;
  const spaceRef = useRef(space);
  spaceRef.current = space;
  const pinRef = useRef(pinning);
  pinRef.current = pinning;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const stylingRef = useRef(styling);
  stylingRef.current = styling;
  /** Late-bound so the keyboard effect can commit style edits. */
  const commitStyleRef = useRef<() => void>(() => {});
  /** Agent doc that arrived while the user was mid manual edit. */
  const pendingAgentUpdateRef = useRef(false);
  /** Detach handle for the listeners bound to the current slide document. */
  const wiredRef = useRef<(() => void) | null>(null);

  /* ------------------------------------------- live-update frame layers ---
   * Every new slide document lands in its own iframe layered over the
   * previous one and fades in, so an agent edit never flashes a blank
   * artboard. The previous document feeds a real DOM diff: elements that
   * are new or changed get a staggered reveal. */
  interface FrameLayer { id: number; doc: string; key:string; fade: boolean }
  const [layers, setLayers] = useState<FrameLayer[]>([{ id: 0, doc,key:slideKey, fade: false }]);
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set([0]));
  const layerId = useRef(1);
  const slideRef = useRef({ key: slideKey, doc });
  /** Previous document (same slide) to diff the next frame against. */
  const pendingDiffRef = useRef<string | null>(null);

  useEffect(() => {
    // A manual text or style edit owns the frame until it commits; an
    // incoming agent update waits instead of wiping half-finished work.
    if (editing || styling) {
      if (slideRef.current.doc !== doc) pendingAgentUpdateRef.current = true;
      return;
    }
    const sameSlide = slideRef.current.key === slideKey;
    const prevDoc = slideRef.current.doc;
    slideRef.current = { key: slideKey, doc };
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.doc === doc && top.key === slideKey) return prev;
      pendingDiffRef.current = sameSlide ? prevDoc : null;
      const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      return [...prev.slice(-1), { id: layerId.current++, doc,key:slideKey, fade: sameSlide && !reduce }];
    });
  }, [doc, slideKey, editing, styling]);

  // Drop the outgoing layer once the crossfade has finished.
  useEffect(() => {
    if (layers.length < 2) return;
    const t = setTimeout(() => setLayers((p) => p.slice(-1)), 340);
    return () => clearTimeout(t);
  }, [layers]);

  /* ---------------------------------------------------------------- fit --- */

  const fit = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 44;
    const inspecting=objectsOpen||!!pick;
    const narrow=rect.width<620;
    const dockReserve=170+(inspecting&&narrow?250:0);
    const usableWidth=rect.width-(inspecting&&!narrow?280:0);
    const spatial=!!props.neighbour&&usableWidth>=620;
    const scale = clamp(Math.min((usableWidth - (spatial ? 150 : 130)) / (width * (spatial ? 1.8 : 1)), (rect.height - pad * 2 - dockReserve) / height), MIN_SCALE, 1);
    setVp({
      scale,
      tx: spatial ? Math.max(90, (usableWidth - width*scale*1.8)/2) + width*scale*.8 : Math.max(35, (usableWidth - width * scale) / 2),
      ty: (rect.height - dockReserve - height * scale) / 2,
    });
  }, [width, height, props.neighbour?.id,objectsOpen,!!pick]);

  const resetWorkspace=useCallback(()=>{setOffset({x:0,y:0});try{localStorage.removeItem(positionKey)}catch{onNotify?.("Posisi workspace tidak dapat direset di penyimpanan; tampilan tetap dipusatkan.")}fit()},[fit,positionKey,onNotify]);

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
      // Inspector/form wheels belong to their own scroll/input surface.
      // Only artwork/background wheels control the workspace viewport.
      const target=e.target as Element|null;
      if(target?.closest('.cv-object-panel,.cv-stylebar,button,input,select,textarea'))return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, wheelFactor(e));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || (e.target as HTMLElement | null)?.isContentEditable;
      if (typing || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
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
        resetWorkspace();
      } else if (e.key === "1") {
        e.preventDefault();
        setVp((v) => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect) return v;
          return { scale: 1, tx: (rect.width - width) / 2, ty: (rect.height - height) / 2 };
        });
      } else if (e.key === "Escape" && stylingRef.current) {
        commitStyleRef.current();
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
  }, [fit, resetWorkspace, hovered, pinning, onTogglePinning, zoomBy, width, height]);

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

  const textEditStyle = useRef<{el:HTMLElement;properties:[string,string,string][]}|null>(null);

  const commitEdit = useCallback(
    (frame: HTMLIFrameElement) => {
      const docEl = frame.contentDocument?.documentElement;
      if (!docEl) return;
      // Restore only our temporary selection decoration, not authored styles.
      const previous=textEditStyle.current;
      if(previous&&previous.el.ownerDocument===frame.contentDocument){
        previous.el.style.removeProperty('outline');previous.el.style.removeProperty('outline-offset');
        for(const [prop,value,priority] of previous.properties)previous.el.style.setProperty(prop,value,priority);
        textEditStyle.current=null;
      }
      const clone = docEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[contenteditable]").forEach((el) => {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-desel-editing");
        if (!(el as HTMLElement).getAttribute("style")) el.removeAttribute("style");
      });
      cleanLiveHighlightClone(docEl,clone);
      // Never let live-reveal artifacts leak into the stored slide:
      // exports and lints render from the stored HTML.
      clone.querySelectorAll('#desel-live-style,#desel-static-style,meta[http-equiv="Content-Security-Policy"]').forEach((el) => el.remove());
      clone.querySelectorAll(".desel-live-in").forEach((el) => {
        el.classList.remove("desel-live-in");
        (el as HTMLElement).style.removeProperty("animation-delay");
        if (!(el as HTMLElement).getAttribute("style")) el.removeAttribute("style");
        if (!el.getAttribute("class")) el.removeAttribute("class");
      });
      // Final sanitation: no empty class artifacts in stored slides.
      clone.querySelectorAll('[class=""]').forEach((el) => el.removeAttribute("class"));
      onEditHtml(`<!doctype html>\n${clone.outerHTML}`,frame.dataset.slideKey??slideKey);
      editingRef.current=false;stylingRef.current=false;
      setEditing(false);setStyling(false);
      setPick(null);
      if (pendingAgentUpdateRef.current) {
        pendingAgentUpdateRef.current = false;
        // The manual commit wins over the agent doc that landed mid-edit;
        // say so instead of silently dropping either side.
        onNotify?.("Agent mengirim perubahan saat kamu mengedit - versi kamu yang disimpan. Versi agent aman di Riwayat slide kalau mau dipulihkan.");
      }
    },
    [onEditHtml, onNotify,slideKey],
  );

  /** Resolve the currently picked element inside the live frame. */
  const pickedEl = useCallback((): HTMLElement | null => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !pick) return null;
    try {
      return doc.querySelector<HTMLElement>(pick.selector);
    } catch {
      return null;
    }
  }, [pick]);

  /** Apply one inline style mutation to the picked element, locally. */
  const mutatePicked = useCallback(
    (fn: (el: HTMLElement, cs: CSSStyleDeclaration) => void) => {
      const el = pickedEl();
      const win = frameRef.current?.contentWindow;
      if (!el || !win) return;
      stylingRef.current=true;setStyling(true);
      fn(el, win.getComputedStyle(el));
      // The box can move (font-size changes); keep the outline honest.
      const r = el.getBoundingClientRect();
      setPick((p) => (p ? { ...p, x: r.left, y: r.top, w: r.width, h: r.height } : p));
      setStyleTick((n) => n + 1);
    },
    [pickedEl],
  );

  const selectObject=(el:HTMLElement)=>{
    if(stylingRef.current)commitStyleRef.current();
    const r=el.getBoundingClientRect();const d=el.ownerDocument;
    setPick({x:r.left,y:r.top,w:r.width,h:r.height,label:labelOf(el),selector:pathOf(el,d),editable:editableOf(el)});
  };
  const addObject=(kind:'text'|'box')=>{
    if(editingRef.current||stylingRef.current)commitPending.current();
    const frame=frameRef.current,doc=frame?.contentDocument;if(!frame||!doc?.body)return;
    const el=doc.createElement(kind==='text'?'p':'div');el.id=`desel-${kind}-${crypto.randomUUID()}`;
    const w=Math.round(width*.6),h=Math.round(height*.15),x=Math.round(width*.2),y=Math.round(height*(kind==='text'?.2:.55));
    el.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;margin:0;padding:0;box-sizing:border-box;z-index:1;transform:none;opacity:1;overflow:hidden;`;
    if(kind==='text'){el.textContent='Teks baru';el.style.fontFamily='Arial, sans-serif';el.style.fontSize=`${Math.max(24,Math.round(width*.055))}px`;el.style.lineHeight='1.2';el.style.color='#f5f2ec';el.style.backgroundColor='#263c30';}
    else{el.style.backgroundColor='#a9ecc6';el.style.borderRadius='0';}
    doc.body.append(el);setObjectsOpen(true);commitEdit(frame);onNotify?.(kind==='text'?'Teks baru ditambahkan. Pilih untuk mengedit teks/gaya.':'Kotak ditambahkan. Pilih melalui Objek slide.');
  };
  const addImage=async(replace=false)=>{
    if(addingImageRef.current)return;
    const asset=props.assets?.find(a=>a.id===imageAsset);const frame=frameRef.current;
    if(!asset||!frame||!/^image\/(png|jpeg|webp|gif|avif)$/.test(asset.mime)||!asset.data||asset.data.length>4*1024*1024){onNotify?.('Pilih gambar lokal raster maksimal4MB base64.');return;}
    const origin=frame.dataset.slideKey;const replacing=replace?pickedEl():null;
    if(replacing&&(replacing.hasAttribute("srcset")||replacing.closest("picture"))){onNotify?.("Gambar responsif picture/srcset belum dapat diganti melalui kontrol ini.");return}
    if(replace&&replacing?.tagName!=="IMG"){onNotify?.("Pilih objek gambar untuk mengganti sumbernya.");return}
    addingImageRef.current=true;setAddingImage(true);
    try{
      if((frame.contentDocument?.documentElement.outerHTML.length??0)+asset.data.length>4*1024*1024)throw Error('HTML slide dan gambar akan melebihi4MB. Gunakan gambar yang lebih kecil.');
      const src=`data:${asset.mime};base64,${asset.data}`;const probe=new Image();probe.src=src;
      await Promise.race([probe.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Gambar belum siap')),4000))]);
      if(frameRef.current!==frame||frame.dataset.slideKey!==origin)throw Error('Slide berubah; gambar tidak ditambahkan.');
      if(!probe.naturalWidth||probe.naturalWidth*probe.naturalHeight>40000000)throw Error('Dimensi gambar tidak didukung.');
      if(replacing){if(!replacing.isConnected||replacing.ownerDocument!==frame.contentDocument)throw Error('Gambar terpilih berubah. Pilih ulang.');(replacing as HTMLImageElement).src=src;(replacing as HTMLImageElement).alt=asset.provenance?.altText||asset.name;commitEdit(frame);onNotify?.('Sumber gambar diganti. Ukuran,posisi,fit dan gaya objek tetap.');return}
      if(editingRef.current||stylingRef.current)commitPending.current();
      const doc=frame.contentDocument;if(!doc?.body)throw Error('Slide belum siap.');
      const img=doc.createElement('img');img.id=`desel-image-${crypto.randomUUID()}`;img.src=src;img.alt=asset.provenance?.altText||asset.name;
      const w=Math.round(width*.6),h=Math.min(height*.6,w*probe.naturalHeight/probe.naturalWidth);
      img.style.cssText=`position:absolute;left:${Math.round(width*.2)}px;top:${Math.round(height*.2)}px;width:${w}px;height:${Math.round(h)}px;object-fit:contain;transform:none;opacity:1;z-index:2;margin:0;padding:0;`;
      doc.body.append(img);commitEdit(frame);setObjectsOpen(true);onNotify?.('Gambar disisipkan sebagai salinan mandiri di HTML slide. Catatan hak pakai bukan persetujuan lisensi.');
    }catch(err){onNotify?.(String(err))}finally{addingImageRef.current=false;setAddingImage(false)}
  };
  const deleteObject=()=>{const el=pickedEl();const frame=frameRef.current;if(!el||!frame)return;el.remove();setStyling(false);commitEdit(frame);onNotify?.("Elemen dihapus. Undo proyek untuk memulihkannya.");};
  /** Commit pending style edits into the stored slide HTML. */
  const commitStyle = useCallback(() => {
    if (!stylingRef.current) return;
    const frame = frameRef.current;
    setStyling(false);
    if (frame) commitEdit(frame);
  }, [commitEdit]);

  commitStyleRef.current = commitStyle;
  const commitPending=useRef<()=>void>(()=>{});
  commitPending.current=()=>{if((editingRef.current||stylingRef.current)&&frameRef.current)commitEdit(frameRef.current)};
  useLayoutEffect(()=>{const flush=()=>commitPending.current();const warn=(e:BeforeUnloadEvent)=>{if(editingRef.current||stylingRef.current){e.preventDefault();e.returnValue='';}};window.addEventListener('desel-before-context-switch',flush);window.addEventListener('beforeunload',warn);return()=>{window.removeEventListener('desel-before-context-switch',flush);window.removeEventListener('beforeunload',warn)}},[]);
  const editingSlide=useRef(slideKey);
  useLayoutEffect(()=>{
    if(editingSlide.current===slideKey)return;
    editingSlide.current=slideKey;
    if((editingRef.current||stylingRef.current)&&frameRef.current){commitEdit(frameRef.current);setStyling(false);setEditing(false);pendingAgentUpdateRef.current=false;onNotify?.("Edit objek disimpan ke slide asal sebelum berpindah.");}
    setPick(null);setHover(null);
  },[slideKey,commitEdit,onNotify]);

  const startEdit = useCallback(
    (frame: HTMLIFrameElement, el: HTMLElement) => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return;
      editingRef.current=true;setEditing(true);
      textEditStyle.current={el,properties:Array.from(el.style).filter(p=>p==='outline'||p.startsWith('outline-')).map(p=>[p,el.style.getPropertyValue(p),el.style.getPropertyPriority(p)])};
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
        if (stylingRef.current) commitStyle();
        setPick(null);
        return;
      }
      if (stylingRef.current) commitStyle();
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
  }, [height, onNotify, onRequestPin, startEdit, commitStyle, width, zoomAt]);

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
    // An agent update landing mid manual edit must not orphan the session:
    // the toolbar and the picked element stay until the user commits.
    if (stylingRef.current || editingRef.current) return;
    setPick(null);
    setHover(null);
  }, [doc, slideKey]);

  /* ------------------------------------------------------------- render --- */

  const pins = useMemo(() => notes.slice(0, 40), [notes]);
  const moving = panning || space;

  return (
    <div
      ref={rootRef}
      className={`cv ${(objectsOpen||pick)?"cv-inspecting":""} ${moving ? "cv-pan" : ""} ${pinning ? "cv-arming" : ""} ${editing ? "cv-editing" : ""}`}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDoubleClick={(e) => {
        // Double-click on empty canvas fits the artboard again.
        if (e.target === rootRef.current) resetWorkspace();
      }}
    >
      <div className="cv-space" data-pan="1" />

      {props.neighbour && vp.scale * width * 1.8 + 90 + ((objectsOpen||pick)?280:0) < (rootRef.current?.clientWidth ?? 0) && <button className="spatial-neighbour" title={`Buka ${props.neighbour.title}`} aria-label={`Buka ${props.neighbour.title}`} onClick={() => props.onSelectNeighbour?.(props.neighbour!.id)} style={{left:vp.tx - width*vp.scale*.8,top:vp.ty+height*vp.scale*.07,width:width*vp.scale*.66,height:height*vp.scale*.66}}><span>{props.neighbour.title}</span><div style={{width:"100%",height:"100%",overflow:"hidden"}}><iframe title="Slide sebelah" sandbox="allow-same-origin" srcDoc={props.neighbour.doc} style={{width,height,transform:`scale(${vp.scale*.66})`,transformOrigin:"top left",border:0,pointerEvents:"none"}}/></div></button>}
      <div
        className="cv-page"
        style={{
          width,
          height,
          transform: `translate3d(${vp.tx+offset.x}px, ${vp.ty+offset.y}px, 0) scale(${vp.scale})`,
        }}
      >
        <button className="spatial-label" title="Geser posisi slide di workspace (bukan ukuran ekspor)" style={{transform:`translateY(-100%) scale(${1/vp.scale})`,transformOrigin:"bottom left"}}
          onPointerDown={e=>{e.stopPropagation();e.preventDefault();artDrag.current={x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y};e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerMove={e=>{const d=artDrag.current;if(d)setOffset({x:d.ox+e.clientX-d.x,y:d.oy+e.clientY-d.y});}}
          onPointerUp={e=>{if(!artDrag.current)return;artDrag.current=null;try {localStorage.setItem(positionKey,JSON.stringify(offsetRef.current));} catch {onNotify?.("Posisi workspace tidak dapat disimpan.");}e.currentTarget.releasePointerCapture(e.pointerId);}}
          onDoubleClick={resetWorkspace}>{props.slideTitle ?? "Slide"}</button>
        <div className="cv-stack">
          {layers.map((layer, i) => {
            const isTop = i === layers.length - 1;
            const isLoaded = loaded.has(layer.id);
            return (
              <iframe
                key={layer.id}
                data-slide-key={layer.key}
                ref={(el) => {
                  if (isTop && el) frameRef.current = el;
                }}
                title={isTop ? "Artboard" : "Artboard (outgoing)"}
                sandbox="allow-same-origin"
                srcDoc={layer.doc}
                style={{
                  pointerEvents: !isTop || space || panning ? "none" : "auto",
                  opacity: layer.fade && !isLoaded ? 0 : 1,
                }}
                onLoad={(e) => {
                  setLoaded((prev) => {
                    if (prev.has(layer.id)) return prev;
                    const next = new Set(prev);
                    next.add(layer.id);
                    return next;
                  });
                  if (!isTop) return;
                  setPick(null);
                  setHover(null);
                  setObjectTick(n=>n+1);
                  attach();
                  const frame = e.currentTarget;
                  if (frame.contentDocument) {
                    markChangedElements(frame.contentDocument, pendingDiffRef.current);
                  }
                  pendingDiffRef.current = null;
                }}
              />
            );
          })}
        </div>

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
            <span className="cv-pick-hint">{pick.editable?'klik 2× untuk ubah teks':'atur lewat toolbar elemen'}</span>
          </div>
        )}

        {pick && !editing && !pinning && (() => {
          const el = pickedEl();
          const cs = el ? el.ownerDocument.defaultView?.getComputedStyle(el) : null;
          const bold = cs ? parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === "bold" : false;
          const italic = cs?.fontStyle === "italic";
          const size = cs ? Math.round(parseFloat(cs.fontSize)) : 0;
          void styleTick;
          const above = false;
          // Counter-scale keeps the bar a constant on-screen size at every
          // zoom, like Figma's viewport UI. Position stays clamped to stage.
          const barScale = 1 / vp.scale;
          return (
            <div
              className="cv-stylebar"
              style={{
                left: 0,
                top: height + 18 / vp.scale,
                transform: `translateY(${above ? "-100%" : "0"}) scale(${barScale})`,
                transformOrigin: above ? "bottom left" : "top left",
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {el?.tagName==='IMG' ? <>
                <span style={{fontSize:10}}>Gambar</span>
                {(['left','top','width','height'] as const).map((prop,i)=><label key={prop} style={{display:'flex',gap:3,alignItems:'center',fontSize:10}}>{['X','Y','W','H'][i]}<input aria-label={`Gambar ${prop}`} type="number" disabled={(prop==='left'||prop==='top')&&!(['absolute','fixed','relative'].includes(cs?.position??''))} defaultValue={Math.round(parseFloat(cs?.[prop]??'0'))||0} key={`${pick.selector}-${prop}-${arrangeTick}`} onBlur={e=>{const target=pickedEl();const css=target?.ownerDocument.defaultView?.getComputedStyle(target);if(css)e.currentTarget.value=String(Math.round(parseFloat(css[prop]))||0);setArrangeTick(n=>n+1)}} style={{width:50,background:'#122019',color:'#e8f4ec',border:'1px solid #425548',padding:4}} onChange={e=>{if(e.target.value==='')return;const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=50000)mutatePicked((el2,css)=>{setObjectBox(el2,prop,n);});}}/></label>)}
                <select title="Image fit" value={cs?.objectFit??'contain'} onChange={e=>mutatePicked(el2=>{el2.style.objectFit=e.target.value})}><option value="contain">Utuh</option><option value="cover">Isi / crop</option></select>
                {styling&&<button className="cv-style-done" title="Simpan gambar" onClick={commitStyle}><Check size={13}/>Selesai</button>}
              </> : <>
              <button
                className={`cv-style-btn ${bold ? "on" : ""}`}
                title="Tebal"
                onClick={() => mutatePicked((el2, cs2) => {
                  const on = parseInt(cs2.fontWeight, 10) >= 600 || cs2.fontWeight === "bold";
                  el2.style.fontWeight = on ? "400" : "700";
                })}
              >
                <Bold size={13} />
              </button>
              <button
                className={`cv-style-btn ${italic ? "on" : ""}`}
                title="Miring"
                onClick={() => mutatePicked((el2, cs2) => {
                  el2.style.fontStyle = cs2.fontStyle === "italic" ? "normal" : "italic";
                })}
              >
                <Italic size={13} />
              </button>
              <span className="cv-style-sep" />
              <select
                className="cv-style-font"
                title="Font"
                value={cs ? [...STYLE_FONTS].sort((a,b)=>b.length-a.length).find((f) => cs.fontFamily.split(",")[0].replace(/['"]/g,"").trim().toLowerCase()===f.toLowerCase()) ?? "" : ""}
                onChange={(e) => mutatePicked((el2) => {
                  el2.style.fontFamily = e.target.value;
                })}
              >
                <option value="" disabled>
                  Font…
                </option>
                {STYLE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="cv-style-sep" />
              <button
                className="cv-style-btn"
                title="Perkecil"
                onClick={() => mutatePicked((el2, cs2) => {
                  el2.style.fontSize = `${Math.max(8, Math.round(parseFloat(cs2.fontSize)) - 2)}px`;
                  setArrangeTick(n=>n+1);
                })}
              >
                <Minus size={13} />
              </button>
              <span className="cv-style-size">{size || "–"}</span>
              <button
                className="cv-style-btn"
                title="Perbesar"
                onClick={() => mutatePicked((el2, cs2) => {
                  el2.style.fontSize = `${Math.min(500,Math.round(parseFloat(cs2.fontSize)) + 2)}px`;
                  setArrangeTick(n=>n+1);
                })}
              >
                <Plus size={13} />
              </button>
              <span className="cv-style-sep" />
              <label className="cv-style-color" title="Warna teks">
                <input
                  type="color"
                  key={`${pick.selector}-${styleTick}`}
                  defaultValue={cs ? rgbToHex(cs.color) : "#a9ecc6"}
                  onChange={(e) => mutatePicked((el2) => {
                    el2.style.color = e.target.value;
                  })}
                />
              </label>
              {styling && (
                <>
                  <span className="cv-style-sep" />
                  <button className="cv-style-done" title="Simpan perubahan gaya (Esc)" onClick={commitStyle}>
                    <Check size={13} /> Selesai
                  </button>
                </>
              )}
              </>}
            </div>
          );
        })()}

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

      <div className="cv-object-panel" onPointerDown={e=>e.stopPropagation()}>
        <button className="btn btn-sm" aria-expanded={objectsOpen} onClick={()=>setObjectsOpen(!objectsOpen)}>Objek slide</button>
        {objectsOpen&&<div className="cv-object-add"><button className="btn btn-sm" onClick={()=>addObject("text")}>+ Teks</button><button className="btn btn-sm" onClick={()=>addObject("box")}>+ Kotak</button></div>}
        {objectsOpen&&<div className="cv-image-add"><select aria-label="Gambar proyek untuk slide" value={imageAsset} onChange={e=>setImageAsset(e.target.value)}><option value="">Pilih gambar proyek...</option>{(props.assets??[]).filter(a=>a.mime.startsWith("image/")).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="btn btn-sm" disabled={!imageAsset||addingImage} onClick={()=>void addImage()}>{addingImage?"Memuat...":"Sisipkan gambar"}</button>{pick&&pickedEl()?.tagName==="IMG"&&<button className="btn btn-sm" disabled={!imageAsset||addingImage} onClick={()=>void addImage(true)}>Ganti gambar terpilih</button>}</div>}
        {objectsOpen&&<div className="cv-object-list" data-revision={objectTick}>{Array.from(frameRef.current?.contentDocument?.body?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,li,img,svg,div,section,article,span')??[]).filter(el=>el.getBoundingClientRect().width>0&&!el.closest('[data-desel-editing]')).slice(0,100).map((el,i)=><button key={i} className={pick?.selector===pathOf(el,el.ownerDocument)?'on':''} onClick={()=>selectObject(el)} title={pathOf(el,el.ownerDocument)}>{labelOf(el)} · {(el.tagName==='IMG'?(el as HTMLImageElement).alt:el.textContent??'').trim().slice(0,50)||'visual'}</button>)}</div>}
        {pick&&!editing&&!pinning&&(()=>{const el=pickedEl();const cs=el?.ownerDocument.defaultView?.getComputedStyle(el);if(!el||!cs)return null;const movable=['absolute','fixed','relative'].includes(cs.position);const focus=cs.objectPosition.trim().split(/\s+/);const percentFocus=focus.length===2&&focus.every(v=>/^-?\d+(?:\.\d+)?%$/.test(v)&&parseFloat(v)>=0&&parseFloat(v)<=100);return <section className="cv-object-properties"><strong>{pick.label}</strong><p>Nilai relatif ke parent CSS. Selesai menyimpan ke riwayat proyek.</p>{movable?<div className="cv-object-grid">{(['left','top','width','height'] as const).map((prop,i)=><label key={prop}>{['X','Y','Lebar','Tinggi'][i]}<input aria-label={`Objek ${prop}`} type="number" key={`${pick.selector}-${prop}-${arrangeTick}`} onBlur={()=>setArrangeTick(n=>n+1)} defaultValue={Math.round(parseFloat(cs[prop])||0)} onChange={e=>{if(e.target.value==='')return;const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=50000)mutatePicked(a=>{setObjectBox(a,prop,n)})}}/></label>)}</div>:<p>Elemen mengikuti alur CSS. Posisi bebas tidak dipaksakan agar layout tidak rusak.</p>}<div className="cv-object-grid"><label>Opasitas<input aria-label="Opasitas objek" type="range" min="0" max="1" step=".05" value={cs.opacity} onChange={e=>mutatePicked(a=>{a.style.opacity=e.target.value})}/></label><label>Urutan z<input aria-label="Urutan z objek" type="number" key={`${pick.selector}-z-${arrangeTick}`} defaultValue={parseInt(cs.zIndex)||0} onChange={e=>{const v=Number(e.target.value);if(Number.isInteger(v)&&Math.abs(v)<10000)mutatePicked(a=>{if(cs.position==='static')a.style.position='relative';a.style.zIndex=String(v)})}}/></label></div><div className="cv-object-grid"><label>Sudut membulat px<input aria-label="Radius sudut objek" type="number" min="0" max="10000" key={`${pick.selector}-radius-${arrangeTick}`} defaultValue={parseFloat(cs.borderTopLeftRadius)||0} onChange={e=>{if(e.target.value==='')return;const v=Number(e.target.value);if(v>=0&&v<=10000)mutatePicked(a=>{a.style.borderRadius=`${v}px`})}}/></label><label>Tebal garis px<input aria-label="Tebal garis objek" type="number" min="0" max="100" key={`${pick.selector}-border-${arrangeTick}`} defaultValue={parseFloat(cs.borderTopWidth)||0} onChange={e=>{if(e.target.value==='')return;const v=Number(e.target.value);if(v>=0&&v<=100)mutatePicked(a=>{a.style.borderWidth=`${v}px`;a.style.borderStyle='solid';a.style.boxSizing='border-box'})}}/></label></div><label>Warna garis<input aria-label="Warna garis objek" type="color" value={rgbToHex(cs.borderTopColor)} onChange={e=>mutatePicked(a=>{a.style.borderColor=e.target.value})}/></label>{el.tagName==='IMG'&&<><div className="cv-image-focus"><p>Titik fokus gambar (%). Dipakai saat Isi / crop.</p>{!percentFocus&&<p>Posisi CSS khusus dipertahankan. Kontrol persen tidak tersedia.</p>}{(["x","y"] as const).map((axis,i)=><label key={axis}>Fokus {axis.toUpperCase()} %<input aria-label={`Fokus gambar ${axis.toUpperCase()}`} type="range" min="0" max="100" step="1" disabled={!percentFocus} value={percentFocus?Number.parseFloat(focus[i]):50} onChange={e=>{if(!percentFocus)return;mutatePicked(a=>{const position=a.ownerDocument.defaultView!.getComputedStyle(a).objectPosition.split(" ");position[i]=`${e.target.value}%`;a.style.objectPosition=position.join(" ")})}}/></label>)}</div><label>Teks alternatif gambar<input aria-label="Teks alternatif gambar" type="text" maxLength={1000} key={`${pick.selector}-alt`} defaultValue={(el as HTMLImageElement).alt} onChange={e=>mutatePicked(a=>{(a as HTMLImageElement).alt=e.target.value})}/></label></>}<label>Warna latar<input aria-label="Warna latar objek" type="color" value={rgbToHex(cs.backgroundColor)} onChange={e=>mutatePicked(a=>{a.style.backgroundColor=e.target.value})}/></label>{movable&&cs.transform==='none'&&<div className="cv-object-arrange"><p>Geser10px (posisi CSS)</p><div>{([[-10,0,'←'],[0,-10,'↑'],[0,10,'↓'],[10,0,'→']] as const).map(([x,y,label])=><button className="btn btn-sm" key={label} aria-label={`Geser objek ${label}`} onClick={()=>mutatePicked(a=>{if(!nudgeObject(a,x,y))onNotify?.('Posisi otomatis belum bisa digeser. Tentukan X/Y dulu.');setArrangeTick(n=>n+1)})}>{label}</button>)}</div>{['absolute','fixed'].includes(cs.position)&&<><p>Rata terhadap parent CSS</p><div>{([['x','start','Kiri'],['x','center','Tengah X'],['x','end','Kanan'],['y','start','Atas'],['y','center','Tengah Y'],['y','end','Bawah']] as const).map(([axis,edge,label])=><button className="btn btn-sm" key={label} onClick={()=>mutatePicked(a=>{if(!alignObject(a,axis,edge))onNotify?.('Elemen/parent belum mendukung perataan ini.');setArrangeTick(n=>n+1)})}>{label}</button>)}</div></>}</div>}{!['IMG','SVG'].includes(el.tagName)&&<div className="cv-text-properties"><p>Tipografi elemen terpilih (diwarisi anak tanpa gaya sendiri).</p><div className="cv-object-grid"><label>Ukuran teks px<input aria-label="Ukuran teks objek" type="number" min="8" max="500" key={`${pick.selector}-font-${arrangeTick}`} defaultValue={parseFloat(cs.fontSize)||16} onChange={e=>{const v=Number(e.target.value);if(v>=8&&v<=500)mutatePicked(a=>{a.style.fontSize=`${v}px`})}}/></label><label>Jarak huruf px<input aria-label="Jarak huruf objek" type="number" min="-20" max="100" step=".5" key={`${pick.selector}-spacing-${arrangeTick}`} defaultValue={parseFloat(cs.letterSpacing)||0} onChange={e=>{if(e.target.value==='')return;const v=Number(e.target.value);if(v>=-20&&v<=100)mutatePicked(a=>{a.style.letterSpacing=`${v}px`})}}/></label><label>Tinggi baris px<input aria-label="Tinggi baris objek" type="number" min="1" max="1000" key={`${pick.selector}-line-${arrangeTick}`} defaultValue={parseFloat(cs.lineHeight)||Math.round(parseFloat(cs.fontSize)*1.2)} onChange={e=>{const v=Number(e.target.value);if(v>=1&&v<=1000)mutatePicked(a=>{a.style.lineHeight=`${v}px`})}}/></label><label>Rata teks<select aria-label="Rata teks objek" value={cs.textAlign} onChange={e=>mutatePicked(a=>{a.style.textAlign=e.target.value})}><option value="start">Awal</option><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option><option value="end">Akhir</option><option value="justify">Rata kiri-kanan</option></select></label></div></div>}<div className="cv-object-actions"><button className="btn btn-sm" onClick={()=>{const target=pickedEl();if(target){setCopiedStyle(captureObjectStyle(target));onNotify?.("Gaya dasar disalin di sesi ini. Posisi,ukuran dan isi tidak ikut.")}}}>Salin gaya</button><button className="btn btn-sm" disabled={!copiedStyle} onClick={()=>{if(copiedStyle){mutatePicked(a=>applyObjectStyle(a,copiedStyle));setArrangeTick(n=>n+1)}}}>Tempel gaya</button>{pick.editable&&<button className="btn btn-sm" onClick={()=>{const target=pickedEl();if(target&&frameRef.current)startEdit(frameRef.current,target)}}>Edit teks</button>}{el.parentElement&&el.parentElement!==el.ownerDocument.body&&<button className="btn btn-sm" onClick={()=>selectObject(el.parentElement!)}>Pilih parent</button>}<button className="btn btn-sm" onClick={()=>{const target=pickedEl(),frame=frameRef.current;if(!target||!frame)return;try{if(duplicateObject(target)){commitEdit(frame);onNotify?.("Elemen diduplikasi. Flow CSS dipertahankan; objek posisi bebas digeser20px bila didukung.")}}catch(err){onNotify?.(String(err))}}}>Duplikat elemen</button><button className="btn btn-sm" onClick={deleteObject}>Hapus elemen</button>{styling&&<button className="btn btn-primary btn-sm" onClick={commitStyle}>Selesai</button>}</div></section>})()}
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
        <button className="cv-tool" title="Sesuaikan layar (0)" onClick={resetWorkspace}>
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
            <em>{pick.selector !== pick.label ? pick.selector : ""}</em>
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