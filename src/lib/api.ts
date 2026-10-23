import { Channel } from "@tauri-apps/api/core";
import type {
  AgentEvent,
  Asset,
  AppSettings,
  ChatMessage,
  Comment,
  Deck,
  DeckSummary,
  LintIssue,
  SlideLint,
  SlideRevision,
  TemplateRecord,
} from "./types";

export type { AppSettings } from "./types";
export interface GenerateRequest { topic: string; audience: string; tone: string; language: string; slideCount: number; themeHint: string; brandHandle: string; sourceMaterial: string }
export interface ExportFile { name: string; encoding: "base64" | "utf8"; data: string }
export interface ExportOutcome { directory: string; files: string[] }

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return browserShim<T>(cmd, args);
  const { invoke: realInvoke } = await import("@tauri-apps/api/core");
  return realInvoke<T>(cmd, args);
}

const defaults: AppSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  temperature: 0.85,
  maxTurns: 24,
  exportDir: null,
  brandHandle: "",
  saveLabel: "Save this post",
  enableResearch: true,
  enableFileTools: true,
  sendReferences: false,
};
const LS_SETTINGS = "desel.v2.settings";
const LS_DECKS = "desel.v2.decks";
const LS_MESSAGES = "desel.v2.messages";
const LS_TEMPLATES = "desel.v2.templates";
const LS_COMMENTS = "desel.v2.comments";
const LS_REFS = "desel.v2.refs";
const LS_REVISIONS = "desel.v2.revisions";
const parseLS = <T,>(key: string, fallback: T): T => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : fallback; } catch { return fallback; }
};
const saveLS = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

async function browserShim<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const decks = parseLS<Deck[]>(LS_DECKS, []);
  const messages = parseLS<ChatMessage[]>(LS_MESSAGES, []);
  const templates = parseLS<TemplateRecord[]>(LS_TEMPLATES, []);
  const comments = parseLS<Comment[]>(LS_COMMENTS, []);
  const revisions = parseLS<SlideRevision[]>(LS_REVISIONS, []);
  switch (cmd) {
    case "get_settings": return parseLS(LS_SETTINGS, defaults) as T;
    case "save_settings": saveLS(LS_SETTINGS, args.settings); return args.settings as T;
    case "list_models": return ["gpt-4o-mini", "gpt-4o", "deepseek-chat"] as T;
    case "test_connection": return { ok: false, provider: "Browser", reply: "Browser mode: Rust backend tidak tersedia." } as T;
    case "list_decks": return decks.map(toSummary) as T;
    case "get_deck": return (decks.find(d => d.id === args.id) ?? null) as T;
    case "create_deck": {
      const payload = args.args as { title?: string; aspect?: string; templateId?: string };
      const base = payload.templateId ? templates.find(t => t.id === payload.templateId)?.deck : undefined;
      const now = new Date().toISOString();
      const deck: Deck = { ...(base ?? emptyDeck()), id: id("deck"), title: payload.title || base?.title || "Untitled deck", aspect: (payload.aspect || base?.aspect || "4:5") as Deck["aspect"], fromTemplateId: payload.templateId ?? null, createdAt: now, updatedAt: now };
      saveLS(LS_DECKS, [...decks, deck]); return deck as T;
    }
    case "save_deck": {
      const deck = args.deck as Deck;
      const before = decks.find(d => d.id === deck.id);
      if (before) {
        // Mirror the desktop rule: one snapshot per slide per editing burst.
        const fresh = [...revisions];
        let dirty = false;
        for (const prev of before.slides) {
          const now = deck.slides.find(s => s.id === prev.id);
          if (!now || !prev.html.trim() || (now.html === prev.html && now.title === prev.title)) continue;
          const last = fresh.filter(r => r.slideId === prev.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (last && Date.now() - Date.parse(last.createdAt) < 25_000) continue;
          fresh.push({ id: id("rev"), deckId: deck.id, slideId: prev.id, title: prev.title, html: prev.html, createdAt: new Date().toISOString() });
          dirty = true;
        }
        if (dirty) saveLS(LS_REVISIONS, fresh.slice(-200));
      }
      const next = decks.some(d => d.id === deck.id) ? decks.map(d => d.id === deck.id ? deck : d) : [deck, ...decks];
      saveLS(LS_DECKS, next);
      return deck as T;
    }
    case "delete_deck": saveLS(LS_DECKS, decks.filter(d => d.id !== args.id)); return undefined as T;
    case "duplicate_deck": {
      const original = decks.find(d => d.id === args.id); if (!original) throw new Error("Deck not found");
      const deck = { ...original, id: id("deck"), title: `${original.title} (copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; saveLS(LS_DECKS, [deck, ...decks]); return deck as T;
    }
    case "list_messages": return messages.filter(m => m.deckId === args.deckId) as T;
    case "clear_messages": saveLS(LS_MESSAGES, messages.filter(m => m.deckId !== args.deckId)); return undefined as T;
    case "append_message": {
      const m: ChatMessage = { id: id("msg"), deckId: String(args.deckId), role: String(args.role) as ChatMessage["role"], content: String(args.content), createdAt: new Date().toISOString() };
      saveLS(LS_MESSAGES, [...messages, m]); return m as T;
    }
    case "send_to_agent": throw new Error("Agent chat hanya tersedia di app desktop setelah mengisi provider API.");
    case "list_templates": return templates as T;
    case "save_template": {
      const payload = args.args as { name: string; description?: string; deck: Deck };
      const now = new Date().toISOString(); const t: TemplateRecord = { id: id("tpl"), name: payload.name, description: payload.description ?? "", deck: payload.deck, createdAt: now, updatedAt: now };
      saveLS(LS_TEMPLATES, [t, ...templates]); return t as T;
    }
    case "delete_template": saveLS(LS_TEMPLATES, templates.filter(t => t.id !== args.id)); return undefined as T;
    case "list_comments": return comments.filter(c => c.deckId === args.deckId) as T;
    case "add_comment": {
      const payload = args.args as Omit<Comment, "id" | "status" | "createdAt">;
      const c: Comment = { ...payload, id: id("cm"), status: "open", createdAt: new Date().toISOString() }; saveLS(LS_COMMENTS, [...comments, c]); return c as T;
    }
    case "set_comment_status": saveLS(LS_COMMENTS, comments.map(c => c.id === args.id ? { ...c, status: args.status as Comment["status"] } : c)); return undefined as T;
    case "delete_comment": saveLS(LS_COMMENTS, comments.filter(c => c.id !== args.id)); return undefined as T;
    case "list_revisions":
      return revisions
        .filter(r => r.slideId === args.slideId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12) as T;
    case "restore_revision": {
      const rev = revisions.find(r => r.id === args.id);
      if (!rev) throw new Error("versi itu sudah tidak tersimpan");
      const deck = decks.find(d => d.id === rev.deckId);
      if (!deck) throw new Error("deck-nya sudah dihapus");
      const current = deck.slides.find(s => s.id === rev.slideId);
      if (!current) throw new Error("slide itu sudah tidak ada di deck");
      const next: Deck = {
        ...deck,
        slides: deck.slides.map(s => s.id === rev.slideId ? { ...s, html: rev.html, title: rev.title || s.title } : s),
        updatedAt: new Date().toISOString(),
      };
      saveLS(LS_DECKS, decks.map(d => d.id === next.id ? next : d));
      saveLS(LS_REVISIONS, [...revisions, { id: id("rev"), deckId: deck.id, slideId: rev.slideId, title: current.title, html: current.html, createdAt: new Date().toISOString() }].slice(-200));
      return next as T;
    }
    case "list_references":
    case "reference_data": {
      const refs = parseLS<Asset[]>(LS_REFS, []).filter(r => r.deckId === args.deckId);
      return (cmd === "list_references" ? refs.map(r => ({ ...r, data: "" })) : refs) as T;
    }
    case "add_reference_data": {
      const refs = parseLS<Asset[]>(LS_REFS, []);
      const dataUrl = String(args.dataUrl);
      const [head, payload] = dataUrl.split(",");
      const mime = head.replace("data:", "").split(";")[0] || "image/jpeg";
      const asset: Asset = { id: id("ref"), deckId: String(args.deckId), name: String(args.name), mime, data: payload ?? "", profile: null, createdAt: new Date().toISOString() };
      saveLS(LS_REFS, [...refs, asset]);
      return refs.filter(r => r.deckId === args.deckId).concat(asset).map(r => ({ ...r, data: "" })) as T;
    }
    case "add_reference_paths": throw new Error("Pilih gambar lewat tombol; browser tidak bisa membaca path lokal.");
    case "add_reference_url": {
      const res = await fetch(String(args.url), { mode: "cors" }).catch(() => null);
      if (!res || !res.ok) throw new Error("Link tidak bisa diambil dari browser (CORS). Pakai app desktop, atau simpan gambarnya lalu lampirkan.");
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Link ini halaman web, bukan file gambar. Salin alamat gambarnya (klik kanan → Copy image address).");
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      const [head, payload] = dataUrl.split(",");
      const mime = head.replace("data:", "").split(";")[0] || blob.type;
      const refs = parseLS<Asset[]>(LS_REFS, []);
      const asset: Asset = { id: id("ref"), deckId: String(args.deckId), name: String(args.url).split("/").pop() || "referensi", mime, data: payload ?? "", profile: null, createdAt: new Date().toISOString() };
      saveLS(LS_REFS, [...refs, asset]);
      return refs.filter(r => r.deckId === args.deckId).concat(asset).map(r => ({ ...r, data: "" })) as T;
    }
    case "delete_reference": saveLS(LS_REFS, parseLS<Asset[]>(LS_REFS, []).filter(r => r.id !== args.id)); return undefined as T;
    case "lint_deck": {
      const deck = decks.find(d => d.id === args.id);
      if (!deck) return [] as T;
      return deck.slides.map(s => ({ slideId: s.id, issues: browserLint(s.html, deck.aspect) })) as T;
    }
    case "export_default_dir": return "Downloads/Desel" as T;
    case "write_export": {
      const files = args.files as { name: string; encoding: "base64" | "utf8"; data: string }[];
      for (const f of files) {
        const blob = f.encoding === "base64" ? new Blob([Uint8Array.from(atob(f.data), c => c.charCodeAt(0))]) : new Blob([f.data], { type: "text/plain" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      return { directory: "Downloads/Desel", files: files.map(f => f.name) } as T;
    }
    case "reveal_path": return undefined as T;
    case "storage_info": return { decks: decks.length, templates: templates.length, provider: "Browser" } as T;
    default: throw new Error(`Unknown command: ${cmd}`);
  }
}

const id = (prefix: string) => `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
function emptyDeck(): Deck {
  const now = new Date().toISOString();
  return { id: id("deck"), title: "Untitled deck", caption: "", aspect: "4:5", slides: [], styleGuide: "", palette: [], brandHandle: "", saveLabel: "Save this post", fromTemplateId: null, createdAt: now, updatedAt: now };
}
function toSummary(deck: Deck): DeckSummary { return { id: deck.id, title: deck.title, slideCount: deck.slides.length, aspect: deck.aspect, updatedAt: deck.updatedAt, thumbnail: null }; }

/** Dev-only subset of the Rust linter, so the browser build shows real findings. */
function browserLint(html: string, aspect: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const hay = html.toLowerCase();
  const size = aspect === "1:1" ? [1080, 1080] : aspect === "9:16" ? [1080, 1920] : [1080, 1350];

  if (hay.includes("<script")) issues.push({ rule: "no-script", severity: "error", message: "Ada <script>. Slide harus statis." });
  if (/(src|href)="http|url\(['"]?http|@import/.test(hay)) issues.push({ rule: "external-asset", severity: "error", message: "Ada aset eksternal (http). Gambar harus CSS atau inline SVG." });
  if (!(hay.includes(`${size[0]}px`) && hay.includes(`${size[1]}px`))) issues.push({ rule: "canvas-size", severity: "warn", message: `Kanvas tidak dinyatakan eksplisit (harus ${size[0]}×${size[1]}px).` });

  const colors = new Set((html.match(/#[0-9a-f]{6}\b/gi) ?? []).map(c => c.toLowerCase()));
  if (colors.size > 7) issues.push({ rule: "too-many-colors", severity: "warn", message: `${colors.size} warna berbeda. Palet harus maksimal 3 warna + 1 aksen.` });
  if (/(1f3|1f4|1f6|26[0-9a-f]|27[0-9a-f])/i.test(html) && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html)) issues.push({ rule: "emoji", severity: "warn", message: "Ada emoji di dalam slide. Pakai bentuk/ikon SVG." });

  const texture = hay.includes("feturbulence") || hay.includes("repeating-") || hay.includes("data:image/svg+xml") || (hay.includes("radial-gradient") && hay.includes("background-size"));
  if (!texture) issues.push({ rule: "no-texture", severity: "warn", message: "Tidak ada tekstur (grain/halftone/paper). Kanvas polos terasa generat." });

  const centered = (hay.match(/text-align:\s*center|align-items:\s*center|justify-content:\s*center|place-items:\s*center|margin:\s*0 auto/g) ?? []).length;
  if (centered >= 4) issues.push({ rule: "centered", severity: "warn", message: `${centered} elemen dipusatkan. Hierarki nyata butuh ketegangan.` });

  const fonts = [...html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
  const maxFont = fonts.length ? Math.max(...fonts) : 0;
  if (maxFont < size[0] * 0.085) issues.push({ rule: "no-dominance", severity: "warn", message: `Teks terbesar cuma ${maxFont}px. Tidak ada elemen yang jelas dominan.` });

  return issues;
}

export const api = {
  isTauri,
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
  listModels: () => invoke<string[]>("list_models"),
  testConnection: () => invoke<Record<string, unknown>>("test_connection"),
  listDecks: () => invoke<DeckSummary[]>("list_decks"),
  getDeck: (id: string) => invoke<Deck | null>("get_deck", { id }),
  createDeck: (title = "Untitled deck", aspect: Deck["aspect"] = "4:5", templateId: string | null = null) => invoke<Deck>("create_deck", { args: { title, aspect, templateId } }),
  saveDeck: (deck: Deck, thumbnail: string | null = null) => invoke<Deck>("save_deck", { deck, thumbnail }),
  deleteDeck: (id: string) => invoke<void>("delete_deck", { id }),
  duplicateDeck: (id: string) => invoke<Deck>("duplicate_deck", { id }),
  listMessages: (deckId: string) => invoke<ChatMessage[]>("list_messages", { deckId }),
  clearMessages: (deckId: string) => invoke<void>("clear_messages", { deckId }),
  appendMessage: (deckId: string, role: ChatMessage["role"], content: string) => invoke<ChatMessage>("append_message", { deckId, role, content }),
  sendToAgent: (deckId: string, text: string, onEvent: (event: AgentEvent) => void) => {
    const channel = new Channel<AgentEvent>(onEvent);
    return invoke<void>("send_to_agent", { deckId, text, channel });
  },
  listTemplates: () => invoke<TemplateRecord[]>("list_templates"),
  saveTemplate: (name: string, description: string, deck: Deck) => invoke<TemplateRecord>("save_template", { args: { name, description, deck } }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  listComments: (deckId: string) => invoke<Comment[]>("list_comments", { deckId }),
  addComment: (comment: Omit<Comment, "id" | "status" | "createdAt">) => invoke<Comment>("add_comment", { args: comment }),
  setCommentStatus: (id: string, status: Comment["status"]) => invoke<void>("set_comment_status", { id, status }),
  deleteComment: (id: string) => invoke<void>("delete_comment", { id }),
  listRevisions: (slideId: string) => invoke<SlideRevision[]>("list_revisions", { slideId }),
  restoreRevision: (id: string) => invoke<Deck>("restore_revision", { id }),
  listReferences: (deckId: string) => invoke<Asset[]>("list_references", { deckId }),
  referenceData: (deckId: string) => invoke<Asset[]>("reference_data", { deckId }),
  addReferencePaths: (deckId: string, paths: string[]) => invoke<Asset[]>("add_reference_paths", { deckId, paths }),
  addReferenceUrl: (deckId: string, url: string) => invoke<Asset[]>("add_reference_url", { deckId, url }),
  addReferenceData: (deckId: string, name: string, dataUrl: string) => invoke<Asset[]>("add_reference_data", { deckId, name, dataUrl }),
  deleteReference: (id: string) => invoke<void>("delete_reference", { id }),
  lintDeck: (id: string) => invoke<SlideLint[]>("lint_deck", { id }),
  exportDefaultDir: (slug: string) => invoke<string>("export_default_dir", { slug }),
  writeExport: (directory: string, files: { name: string; encoding: "base64" | "utf8"; data: string }[], rememberDir?: string | null) => invoke<{ directory: string; files: string[] }>("write_export", { directory, files, rememberDir }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  storageInfo: () => invoke<{ decks: number; templates: number; provider: string }>("storage_info"),
};

export { defaults as defaultSettings };
export function emptyDeckRecord(): Deck { return emptyDeck(); }
export { type AgentEvent, type ChatMessage, type Comment, type Deck, type DeckSummary, type TemplateRecord };
