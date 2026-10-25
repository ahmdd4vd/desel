/**
 * Deterministic safe reflow of a slide to a new canvas size.
 *
 * The original slide document is preserved verbatim inside a stage element
 * that is uniformly scaled to fit the target canvas and centered. Nothing is
 * cropped and nothing overflows: the worst case is empty margin on two sides.
 * This is a starting variant for review, not a redesign; the copy in the UI
 * says exactly that.
 */

export interface CanvasSize {
  w: number;
  h: number;
}

function findBody(html: string): { tag: string; openEnd: number; close: number } | null {
  const openMatch = /<body[^>]*>/i.exec(html);
  if (!openMatch) return null;
  const closeMatch = /<\/body\s*>/i.exec(html.slice(openMatch.index + openMatch[0].length));
  if (!closeMatch) return null;
  const openEnd = openMatch.index + openMatch[0].length;
  return { tag: openMatch[0], openEnd, close: openEnd + closeMatch.index };
}

function attr(tag: string, name: string): string {
  const m =
    new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag) ??
    new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return m?.[1] ?? "";
}

/** First background / background-color declaration found in an inline style. */
function backgroundOf(style: string): string {
  const m = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style);
  return m?.[1].trim() ?? "";
}

/**
 * Wrap the slide's body content in a scaled, centered stage at the new canvas
 * size. Returns null when the html has no usable <body> (caller keeps the
 * original slide and flags it for manual review).
 */
export function reflowSlideHtml(html: string, from: CanvasSize, to: CanvasSize): string | null {
  if (from.w <= 0 || from.h <= 0 || to.w <= 0 || to.h <= 0) return null;
  const trimmed = html.trim();
  if (!trimmed) return null;
  const scale = Math.min(to.w / from.w, to.h / from.h);
  const dx = Math.round((to.w - from.w * scale) / 2);
  const dy = Math.round((to.h - from.h * scale) / 2);
  const scaleText = Number(scale.toFixed(6)).toString();

  const body = findBody(trimmed);
  // Body-level inline styles (background, font, color) carry the slide's
  // look: transfer them to the stage and let the canvas reuse the background,
  // so the letterbox margins match the deck instead of going black.
  const bodyStyle = body ? attr(body.tag, "style") : "";
  const bodyClass = body ? attr(body.tag, "class") : "";
  const canvasBg = backgroundOf(bodyStyle);
  const baseCss = `html,body{margin:0;padding:0;width:${to.w}px;height:${to.h}px;overflow:hidden${canvasBg ? `;background:${canvasBg}` : ""}}`;
  const stageClass = bodyClass ? `desel-reflow-stage ${bodyClass}` : "desel-reflow-stage";
  // In one style attribute a later declaration wins, so appending the frame
  // geometry after the transferred body style needs no surgical removal.
  const stageStyle = `${bodyStyle ? `${bodyStyle};` : ""}position:absolute;left:${dx}px;top:${dy}px;width:${from.w}px;height:${from.h}px;margin:0;transform:scale(${scaleText});transform-origin:top left`;
  const stageOpen = `<div class="${stageClass}" style="${stageStyle}">`;

  if (!body) {
    // Fragment without a body tag: still wrappable, head styles unlikely.
    return `<!doctype html><html><head><style>${baseCss}</style></head><body>${stageOpen}${trimmed}</div></body></html>`;
  }

  const headMatch = /<head[^>]*>([\s\S]*?)<\/head\s*>/i.exec(trimmed);
  const headInner = headMatch ? headMatch[1] : "";
  const inner = trimmed.slice(body.openEnd, body.close);
  return `<!doctype html><html><head><style>${baseCss}</style>${headInner}</head><body>${stageOpen}${inner}</div></body></html>`;
}

export function reflowScale(from: CanvasSize, to: CanvasSize): number {
  return Math.min(to.w / from.w, to.h / from.h);
}
