/**
 * Live-editing support.
 *
 * followChangedSlideId: after a deck update, follow the slide the agent is
 * actually changing instead of always jumping to the last slide.
 *
 * markChangedElements: diff the freshly loaded slide document against the
 * previous one and tag the elements that are new or changed, so the canvas
 * can reveal them progressively (staggered) instead of flashing a full reload.
 */

export interface SlideLike {
  id: string;
  html: string;
  title?: string;
}

/**
 * Pick which slide to show after a deck update:
 * the last slide whose content actually changed; when nothing changed, keep
 * the current selection (or the final slide if the selection is gone).
 */
export function followChangedSlideId(
  prev: SlideLike[],
  next: SlideLike[],
  current: string | null,
): string | null {
  const prevById = new Map(prev.map((s) => [s.id, s]));
  let changed: string | null = null;
  for (const s of next) {
    const p = prevById.get(s.id);
    if (!p || p.html !== s.html || (p.title ?? "") !== (s.title ?? "")) changed = s.id;
  }
  if (changed) return changed;
  if (current && next.some((s) => s.id === current)) return current;
  return next.length ? next[next.length - 1].id : current;
}

/** Reveal at most this many elements individually; beyond that, whole blocks. */
const MAX_MARKS = 12;
const STAGGER_MS = 70;

const LIVE_STYLE_ID = "desel-live-style";
const LIVE_CLASS = "desel-live-in";
const authoredDelay=new WeakMap<HTMLElement,{value:string;priority:string}>();
/** End temporary highlights before copying computed static appearance. */
export function finishLiveHighlights(root:HTMLElement){
 for(const el of [root,...Array.from(root.querySelectorAll<HTMLElement>("*"))]){const saved=authoredDelay.get(el);if(!saved)continue;el.classList.remove(LIVE_CLASS);if(saved.value)el.style.setProperty("animation-delay",saved.value,saved.priority);else el.style.removeProperty("animation-delay");authoredDelay.delete(el);}
}
/** Strip temporary reveal state from a clone without losing authored delay. */
export function cleanLiveHighlightClone(source:HTMLElement,clone:HTMLElement){
 const originals=Array.from(source.querySelectorAll<HTMLElement>("*")),copies=Array.from(clone.querySelectorAll<HTMLElement>("*"));
 originals.forEach((el,i)=>{if(!el.classList.contains(LIVE_CLASS))return;const copy=copies[i];if(!copy)return;const saved=authoredDelay.get(el);copy.classList.remove(LIVE_CLASS);if(saved?.value)copy.style.setProperty("animation-delay",saved.value,saved.priority);else copy.style.removeProperty("animation-delay");if(!copy.getAttribute("style"))copy.removeAttribute("style");if(!copy.getAttribute("class"))copy.removeAttribute("class");});
}
const LIVE_STYLE = `@keyframes deselLiveIn{from{outline:2px solid rgba(130,220,170,.65);outline-offset:3px}to{outline:2px solid transparent;outline-offset:3px}}
.${LIVE_CLASS}{animation:deselLiveIn .45s cubic-bezier(.2,.8,.25,1) both}
@media (prefers-reduced-motion:reduce){.${LIVE_CLASS}{animation:none}}`;

/** Path of an element relative to the given root: tag + index among siblings. */
function relPath(el: Element, root: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent || parent === root) {
      const idx = parent ? Array.from(parent.children).indexOf(node) : 0;
      parts.unshift(`${node.tagName}[${idx}]`);
      break;
    }
    const idx = Array.from(parent.children).indexOf(node);
    parts.unshift(`${node.tagName}[${idx}]`);
    node = parent;
  }
  return parts.join("/");
}

/**
 * Tag changed elements inside the loaded frame document with a reveal
 * animation. oldHtml is the previously shown document for the same slide
 * (null on first render). Returns the number of elements tagged.
 */
export function markChangedElements(frameDoc: Document, oldHtml: string | null): number {
  const body = frameDoc.body;
  if (!body) return 0;
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return 0; // no reveal animation under reduced motion
  }
  if (!frameDoc.getElementById(LIVE_STYLE_ID)) {
    const style = frameDoc.createElement("style");
    style.id = LIVE_STYLE_ID;
    style.textContent = LIVE_STYLE;
    frameDoc.head.appendChild(style);
  }

  let marks: HTMLElement[] = [];
  if (oldHtml) {
    let oldDoc: Document | null = null;
    try {
      oldDoc = new DOMParser().parseFromString(oldHtml, "text/html");
    } catch {
      oldDoc = null;
    }
    const oldMap = new Map<string, string>();
    if (oldDoc?.body) {
      const oldBody = oldDoc.body;
      const walk = (el: Element) => {
        oldMap.set(relPath(el, oldBody), el.outerHTML);
        Array.from(el.children).forEach(walk);
      };
      Array.from(oldBody.children).forEach(walk);
    }
    const consider = (el: Element) => {
      const old = oldMap.get(relPath(el, body));
      if (old !== undefined && old === el.outerHTML) return; // identical subtree
      if (old === undefined) {
        marks.push(el as HTMLElement); // brand new subtree
        return;
      }
      const kids = Array.from(el.children);
      if (!kids.length) {
        marks.push(el as HTMLElement); // changed leaf (text, image, …)
        return;
      }
      kids.forEach(consider); // changed wrapper: find the finer change
    };
    Array.from(body.children).forEach(consider);
  }

  if (!oldHtml || marks.length > MAX_MARKS) {
    // No baseline, or too much changed for per-element cues:
    // reveal the top-level blocks with a stagger instead.
    marks = Array.from(body.children).slice(0, 8) as HTMLElement[];
  }
  marks.forEach((el, i) => {
    const previous=authoredDelay.get(el);const delay=previous?.value??el.style.getPropertyValue("animation-delay"),priority=previous?.priority??el.style.getPropertyPriority("animation-delay");
    authoredDelay.set(el,{value:delay,priority});
    el.classList.add(LIVE_CLASS);
    el.style.setProperty("animation-delay",`${i * STAGGER_MS}ms`);
    // Ignore child/authored animation events; only our own reveal may clean up.
    const finish=(event:AnimationEvent)=>{
      if(event.target!==el||event.animationName!=="deselLiveIn")return;
      el.classList.remove(LIVE_CLASS);
      if(delay)el.style.setProperty("animation-delay",delay,priority);else el.style.removeProperty("animation-delay");
      authoredDelay.delete(el);
      el.removeEventListener("animationend",finish);
      el.removeEventListener("animationcancel",finish);
    };
    el.addEventListener("animationend",finish);
    el.addEventListener("animationcancel",finish);
  });
  return marks.length;
}
