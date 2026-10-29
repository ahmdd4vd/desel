/**
 * Platform-variant packaging for export.
 *
 * Builds editable Desel project files (.desel.json) for the other canvas
 * formats: every slide is reflowed with the safe scale-to-fit stage (see
 * reflow.ts), so each variant is a starting point for review, not a redesign.
 *
 * The file is produced entirely in the UI, so the JSON must be byte-identical
 * to what the Rust importer re-serializes when it checks the checksum
 * (src-tauri/src/project_file.rs: digest(payload) == sha256 of
 * serde_json::to_vec(payload)). The canonical writer below mirrors serde_json
 * exactly: struct fields in declaration order (camelCase), Option fields with
 * skip_serializing_if omitted when empty, free-form Values with
 * BTreeMap-sorted keys, no whitespace, and ryu-style floats (an integral f64
 * prints with a trailing ".0"). The core harness fixture test verifies the
 * bytes against the real importer and exporter.
 */
import { reflowSlideHtml } from "./reflow.ts";
import { ASPECTS, aspectSize, type Aspect, type Asset, type Comment, type Deck } from "./types.ts";
import type { CreatorWorkspace } from "./creator-workspace.ts";

const str = (s: string) => JSON.stringify(s);
/** serde_json/ryu float formatting for values that are f64/f32 on the Rust side. */
const f64 = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Free-form serde_json::Value: object keys sort (BTreeMap), integers stay integers. */
function value(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return `[${v.map(value).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${str(k)}:${value(o[k])}`).join(",")}}`;
}

const slideJson = (s: { id: string; title?: string; html?: string; rationale?: string; hidden?: boolean }) =>
  `{"id":${str(s.id)},"title":${str(s.title ?? "")},"html":${str(s.html ?? "")},"rationale":${str(s.rationale ?? "")},"hidden":${s.hidden === true}}`;

const deckJson = (d: Deck) =>
  `{"id":${str(d.id)},"title":${str(d.title)},"caption":${str(d.caption)},"aspect":${str(d.aspect)},"slides":[${d.slides.map(slideJson).join(",")}],"styleGuide":${str(d.styleGuide)},"palette":[${d.palette.map(str).join(",")}],"brandHandle":${str(d.brandHandle)},"saveLabel":${str(d.saveLabel)},"fromTemplateId":${d.fromTemplateId == null ? "null" : str(d.fromTemplateId)},"createdAt":${str(d.createdAt)},"updatedAt":${str(d.updatedAt)}}`;

const provenanceJson = (p: { sourceUrl?: string; creator?: string; rightsNote?: string; altText?: string; medium?: string }) =>
  `{"sourceUrl":${str(p.sourceUrl ?? "")},"creator":${str(p.creator ?? "")},"rightsNote":${str(p.rightsNote ?? "")},"altText":${str(p.altText ?? "")},"medium":${str(p.medium ?? "")}}`;

const profileJson = (p: { width: number; height: number; palette: string[]; luminance: number; contrast: number; lightRatio: number }) =>
  `{"width":${p.width},"height":${p.height},"palette":[${p.palette.map(str).join(",")}],"luminance":${f64(p.luminance)},"contrast":${f64(p.contrast)},"lightRatio":${f64(p.lightRatio)}}`;

const assetJson = (a: Asset) => {
  const provenance = a.provenance ? `"provenance":${provenanceJson(a.provenance)},` : "";
  return `{${provenance}"referenceRole":${str(a.referenceRole ?? "")},"referenceStatus":${str(a.referenceStatus ?? "")},"id":${str(a.id)},"deckId":${a.deckId == null ? "null" : str(a.deckId)},"name":${str(a.name)},"mime":${str(a.mime)},"data":${str(a.data)},"profile":${a.profile ? profileJson(a.profile) : "null"},"createdAt":${str(a.createdAt)}}`;
};

const commentJson = (c: Comment) =>
  `{"id":${str(c.id)},"deckId":${str(c.deckId)},"slideId":${str(c.slideId)},"x":${f64(c.x)},"y":${f64(c.y)},"body":${str(c.body)},"author":${str(c.author)},"status":${str(c.status)},"selector":${str(c.selector ?? "")},"createdAt":${str(c.createdAt)}}`;

/** sha256 hex of the canonical payload bytes; matches Rust digest(). */
export async function payloadDigest(payloadJson: string): Promise<string> {
  const bytes = new TextEncoder().encode(payloadJson);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalPayloadJson(deck: Deck, assets: Asset[], comments: Comment[], workspace: CreatorWorkspace | null): string {
  const w = workspace ? `,"workspace":${value(workspace)}` : "";
  return `{"deck":${deckJson(deck)},"assets":[${assets.map(assetJson).join(",")}],"comments":[${comments.map(commentJson).join(",")}]${w}}`;
}

export async function canonicalProjectFile(deck: Deck, assets: Asset[], comments: Comment[], workspace: CreatorWorkspace | null): Promise<string> {
  const payload = canonicalPayloadJson(deck, assets, comments, workspace);
  const checksum = await payloadDigest(payload);
  return `{"format":"desel-project","version":1,"checksum":${str(checksum)},"payload":${payload}}`;
}

/** Recompute and check the checksum of a project file (fixture/tests). */
export async function verifyProjectFile(text: string): Promise<boolean> {
  try {
    const file = JSON.parse(text);
    if (file?.format !== "desel-project" || file?.version !== 1 || typeof file?.checksum !== "string") return false;
    const p = file.payload;
    const payload = canonicalPayloadJson(p.deck, p.assets ?? [], p.comments ?? [], p.workspace ?? null);
    return (await payloadDigest(payload)) === file.checksum;
  } catch {
    return false;
  }
}

export interface VariantResult {
  aspect: Aspect;
  fileName: string;
  text: string;
  /** Slides that kept their original html (no usable document to reflow). */
  keptOriginal: number;
}

/**
 * Editable .desel.json project files for every format other than the current
 * one. Slide IDs, comments, assets and workspace carry over unchanged, so the
 * native import treats each variant as a normal portable project.
 */
export async function buildVariantProjects(deck: Deck, assets: Asset[], comments: Comment[], workspace: CreatorWorkspace | null): Promise<VariantResult[]> {
  const from = aspectSize(deck.aspect);
  const out: VariantResult[] = [];
  for (const target of ASPECTS) {
    if (target.id === deck.aspect) continue;
    let keptOriginal = 0;
    const slides = deck.slides.map((s) => {
      const html = reflowSlideHtml(s.html, from, target);
      if (html === null) {
        keptOriginal += 1;
        return s;
      }
      return { ...s, html };
    });
    const variantDeck: Deck = { ...deck, aspect: target.id, title: `${deck.title} · ${target.id}`, slides };
    const text = await canonicalProjectFile(variantDeck, assets, comments, workspace);
    const base = deck.title || "project";
    out.push({
      aspect: target.id,
      fileName: `variants/${base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project"}-${target.id.replace(":", "x")}.desel.json`,
      text,
      keptOriginal,
    });
  }
  return out;
}
