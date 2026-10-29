/**
 * Shared data contracts for Desel.
 *
 * This file is the single source of truth for the frontend. The Rust side
 * mirrors these shapes with serde; the IPC command list is documented in
 * `docs/IPC.md`.
 *
 * Design principle: a **deck** is not a template. Each slide carries its own
 * self-contained HTML + CSS (and optionally inline SVG), authored by the model
 * or the user. Templates are just saved decks that can be reused as a starting
 * point — never a constraint on what a slide can be.
 */

/* -------------------------------------------------------------------------- */
/* Deck + slide                                                               */
/* -------------------------------------------------------------------------- */

export type Aspect = "4:5" | "1:1" | "9:16" | "16:9";

export const ASPECTS: { id: Aspect; label: string; w: number; h: number }[] = [
  { id: "4:5", label: "4:5 · 1080×1350", w: 1080, h: 1350 },
  { id: "1:1", label: "1:1 · 1080×1080", w: 1080, h: 1080 },
  { id: "9:16", label: "9:16 · 1080×1920", w: 1080, h: 1920 },
  { id: "16:9", label: "16:9 · 1920×1080", w: 1920, h: 1080 },
];

export function aspectSize(aspect: string) {
  return ASPECTS.find((a) => a.id === aspect) ?? ASPECTS[0];
}

/**
 * One slide. `html` is a complete document fragment rendered in a sandboxed
 * iframe at exact export resolution, so what the model writes is what gets
 * exported — no translation layer, no template interpreter.
 */
export interface Slide {
  id: string;
  /** Human label shown in the rail. */
  title: string;
  /** Full HTML document string (may include <style> and inline <svg>). */
  html: string;
  /** Optional per-slide notes from the model ("why this works"). */
  rationale: string;
  /** Soft-deleted / hidden from export. */
  hidden: boolean;
}

export interface Deck {
  id: string;
  title: string;
  caption: string;
  aspect: Aspect;
  /** Ordered slides. */
  slides: Slide[];
  /** Free-form design system the model committed to, reused across slides. */
  styleGuide: string;
  /** Optional palette the deck uses, for the swatch strip. */
  palette: string[];
  brandHandle: string;
  saveLabel: string;
  /** Template this deck was created from, if any. */
  fromTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeckSummary {
  id: string;
  title: string;
  slideCount: number;
  aspect: Aspect;
  updatedAt: string;
  thumbnail: string | null;
}

export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  /** Deck snapshot used as the starting point. */
  deck: Deck;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Comments / annotations                                                     */
/* -------------------------------------------------------------------------- */

export type CommentStatus = "open" | "resolved";

/** A previous wording of one slide, kept so a rewrite can be undone. */
export interface SlideRevision {
  id: string;
  deckId: string;
  slideId: string;
  title: string;
  html: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  deckId: string;
  slideId: string;
  /** Normalised position on the artboard (0..1), so it survives resizes. */
  x: number;
  y: number;
  body: string;
  /** CSS-ish path of the element under the pin, when one was picked. */
  selector?: string;
  author: "user" | "agent";
  status: CommentStatus;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Chat                                                                       */
/* -------------------------------------------------------------------------- */

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  reasoningContent?:string;
  id: string;
  deckId: string;
  role: ChatRole;
  content: string;
  /** Tool call metadata for assistant messages. */
  toolCalls?: ToolCallRecord[];
  /** For role=tool. */
  toolCallId?: string;
  /** True while the model is still streaming into this message. */
  streaming?: boolean;
  createdAt: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: string;
  result?: string;
  state: "pending" | "running" | "done" | "error";
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface ModelCapability {id:string;inputModalities:string[];efforts:string[];defaultEffort?:string;reasoningMandatory:boolean;source:string;name?:string;contextWindow?:number;maxOutput?:number;reasoning?:boolean;metadataOrigin?:string;discoveredAt?:string;provider?:string;tools?:boolean}
export interface ProviderConnection {id:string;name:string;kind:string;baseUrl:string;apiKey:string;model:string;reasoningEffort?:string;modelCapabilities?:ModelCapability[]}
export interface AppSettings {
  providerKind?:string;
  activeConnection?:string;
  connections?:ProviderConnection[];
  reasoningEffort?:string;
  modelCapabilities?:ModelCapability[];
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  /** Max agent turns before it must stop. */
  maxTurns: number;
  exportDir: string | null;
  brandHandle: string;
  saveLabel: string;
  /** Enable web research tools (search + fetch). */
  enableResearch: boolean;
  /** Enable filesystem write tools. */
  enableFileTools: boolean;
  /** Send the raw reference images to the model (vision models only). */
  sendReferences: boolean;
}

/* -------------------------------------------------------------------------- */
/* Visual references                                                          */
/* -------------------------------------------------------------------------- */

export interface ImageProfile {
  width: number;
  height: number;
  /** Dominant colours, most present first. */
  palette: string[];
  luminance: number;
  contrast: number;
  lightRatio: number;
}

export interface AssetProvenance { sourceUrl:string; creator:string; rightsNote:string; altText:string; medium:string; }
export interface Asset {
  provenance?:AssetProvenance|null;
  referenceRole?: "" | "cover" | "body" | "closer" | "asset";
  referenceStatus?: "" | "candidate" | "approved" | "rejected";
  id: string;
  deckId: string | null;
  name: string;
  mime: string;
  /** Base64 payload without the data-URL prefix (empty in summaries). */
  data: string;
  profile: ImageProfile | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Agent events (streamed from Rust)                                          */
/* -------------------------------------------------------------------------- */

export type AgentEvent =
  | { type: "turn_start"; turn: number }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type:"render_request";request_id:string;index:number;revision?:string;candidate?:{base:Slide;slide:Slide;aspect:string} }
  | { type: "tool_call"; id: string; name: string; args: string }
  | { type: "tool_result"; id: string; name: string; result: string; ok: boolean }
  | { type: "deck_updated"; deck: Deck }
  | { type: "done"; reason: string }
  | { type: "error"; message: string };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

let counter = 0;
export function newId(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptySlide(title = "Slide"): Slide {
  return { id: newId("sl"), title, html: blankSlideHtml(), rationale: "", hidden: false };
}

/** A neutral starting canvas. Deliberately plain — it is not a design. */
export function blankSlideHtml(w = 1080, h = 1350): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;
    background:#101010;color:#f2ece1;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .frame{width:100%;height:100%;display:grid;place-items:center;padding:96px}
  .hint{font-size:28px;line-height:1.5;color:#6b6560;text-align:center;max-width:70%}
</style></head>
<body><div class="frame"><p class="hint">Slide kosong — minta agent mendesain, atau tempel HTML sendiri.</p></div></body></html>`;
}

export function emptyDeck(partial: Partial<Deck> = {}): Deck {
  const now = new Date().toISOString();
  return {
    id: newId("deck"),
    title: "Untitled deck",
    caption: "",
    aspect: "4:5",
    slides: [],
    styleGuide: "",
    palette: [],
    brandHandle: "",
    saveLabel: "Save this post",
    fromTemplateId: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function deckSummary(deck: Deck, thumbnail: string | null = null): DeckSummary {
  return {
    id: deck.id,
    title: deck.title,
    slideCount: deck.slides.length,
    aspect: deck.aspect,
    updatedAt: deck.updatedAt,
    thumbnail,
  };
}

/** Strip everything except the body content — used for thumbnails/preview. */
export function slideToSrcDoc(html: string): string {
  return html.trim();
}

/* -------------------------------------------------------------------------- */
/* Design review                                                              */
/* -------------------------------------------------------------------------- */

export type LintSeverity = "error" | "warn";

export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
}

export interface SlideLint {
  slideId: string;
  issues: LintIssue[];
}
export interface BrandProfile{id:string;name:string;styleGuide:string;palette:string[];brandHandle:string;saveLabel:string;updatedAt:string}
