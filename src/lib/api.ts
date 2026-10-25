import type {CreatorRequest,CreatorRun} from "./creator-workspace";
import { Channel } from "@tauri-apps/api/core";
import type {
  AgentEvent,
  Asset,
  AssetProvenance,
  BrandProfile,
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
  try { const s = localStorage.getItem(key); return s===null ? fallback : JSON.parse(s) as T; } catch { throw Error("Data lokal tidak terbaca. Tidak ada data yang dihapus atau diganti."); }
};
const saveLS = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

// A browser command can touch several localStorage keys. Stage serialization
// before writing and restore exact previous bytes on a synchronous failure.
// This is not crash atomicity or a replacement for the desktop DB transaction.
function saveBatch(entries:[string,unknown][]){
 const staged=entries.map(([key,value])=>({key,text:JSON.stringify(value),before:localStorage.getItem(key)}));
 const written:typeof staged=[];
 try{for(const entry of staged){localStorage.setItem(entry.key,entry.text);written.push(entry);}}
 catch(err){let rollbackFailed=false;for(const entry of written.reverse()){try{if(entry.before===null)localStorage.removeItem(entry.key);else localStorage.setItem(entry.key,entry.before);}catch{rollbackFailed=true;}}
 if(rollbackFailed)throw Error(`Penyimpanan gagal dan pemulihan otomatis ikut gagal, jadi data tersimpan bisa tidak konsisten. Edit yang terbuka tetap ada. Jangan muat ulang aplikasi sebelum perubahan berhasil disimpan, lalu periksa kembali isi proyek. ${err instanceof Error?err.message:String(err)}`);
 throw err;}
}

function inlineCopyAssets(deck:Deck,assets:Asset[]):Deck{
 let total=0;
 return {...deck,slides:deck.slides.map(slide=>{
  const html=slide.html.replace(/asset:([A-Za-z0-9_-]+)/g,(_,id)=>{const asset=assets.find(a=>a.id===id&&a.deckId===deck.id);if(!asset)throw Error("Copy contains missing asset; no project was created");return `data:${asset.mime};base64,${asset.data}`;});
  const bytes=new TextEncoder().encode(html).length;total+=bytes;if(bytes>4*1024*1024||total>32*1024*1024)throw Error("Copy images exceed safe inline limits");
  return {...slide,html};
 })};
}

async function browserShim<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const decks = parseLS<Deck[]>(LS_DECKS, []);
  const messages = parseLS<ChatMessage[]>(LS_MESSAGES, []);
  const templates = parseLS<TemplateRecord[]>(LS_TEMPLATES, []);
  const comments = parseLS<Comment[]>(LS_COMMENTS, []);
  const revisions = parseLS<SlideRevision[]>(LS_REVISIONS, []);
  switch (cmd) {
    case "get_settings": return parseLS(LS_SETTINGS, defaults) as T;
    case "save_settings": saveLS(LS_SETTINGS, args.settings); return args.settings as T;
    case "provider_management": throw new Error("Pengelola provider tersedia di Desel desktop. Preview ini tidak menambah provider nyata.");
    case "provider_runtime_status": return {running:false,gatewayUrl:null,version:"0.1.1404",managed:true} as T;
    case "provider_runtime_start":
    case "provider_runtime_stop":
    case "provider_runtime_manage": throw new Error("Runtime bawaan tersedia di Desel desktop, bukan preview browser.");
    case "list_models": throw new Error("Discovery model memerlukan aplikasi desktop.");
    case "discover_models": throw new Error("Discovery model memerlukan aplikasi desktop. Tidak ada metadata model palsu di mode browser.");
    case "test_connection": throw new Error("Tes koneksi memerlukan aplikasi desktop. Tidak ada backend provider di browser.");
    case "list_decks": {
      // Mirror the desktop ordering (most recently touched first) so the boot
      // flow opens the deck you actually worked on last.
      const ordered = [...decks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return ordered.map(toSummary) as T;
    }
    case "get_deck": return (decks.find(d => d.id === args.id) ?? null) as T;
    case "create_deck": {
      const payload = args.args as { title?: string; aspect?: string; templateId?: string };
      const base = payload.templateId ? templates.find(t => t.id === payload.templateId)?.deck : undefined;
      if(payload.templateId&&!base)throw Error("Template tidak ditemukan; proyek tidak dibuat");
      const now = new Date().toISOString();
      const deck: Deck = { ...(base ?? emptyDeck()), id: id("deck"), title: payload.title || base?.title || "Untitled deck",slides:base?.slides.map(s=>({...s,id:id("slide")}))??[], aspect: (payload.aspect || base?.aspect || "4:5") as Deck["aspect"], fromTemplateId: payload.templateId ?? null, createdAt: now, updatedAt: now };
      saveLS(LS_DECKS, [...decks, deck]); return deck as T;
    }
    case "deck_history_counts":{const h=parseLS<Record<string,{undo:Deck[];redo:Deck[]}>>("desel.v2.deckHistory",{})[String(args.id)];return [h?.undo.length??0,h?.redo.length??0] as T;}
    case "step_deck_history":{const expected=args.expected as Deck;const current=decks.find(d=>d.id===expected.id);if(!current||JSON.stringify(current)!==JSON.stringify(expected))throw Error("Project changed. Refresh before undo/redo.");const all=parseLS<Record<string,{undo:Deck[];redo:Deck[]}>>("desel.v2.deckHistory",{});const h=all[expected.id]??{undo:[],redo:[]};const direction=args.direction as "undo"|"redo";if(direction!=="undo"&&direction!=="redo")throw Error("Invalid history direction");const restored=h[direction].pop();if(!restored)throw Error("No history available");h[direction==="undo"?"redo":"undo"].push(current);restored.updatedAt=new Date().toISOString();all[expected.id]=h;saveBatch([["desel.v2.deckHistory",all],[LS_DECKS,decks.map(d=>d.id===expected.id?restored:d)]]);return restored as T;}
    case "save_deck": {
      const deck = args.deck as Deck;const writes:[string,unknown][]=[];
      const before = decks.find(d => d.id === deck.id);
      if(args.expected&&JSON.stringify(before)!==JSON.stringify(args.expected))throw Error("Project changed in another operation. Local edits were not overwritten.");
      if(before&&JSON.stringify(before)!==JSON.stringify(deck)){const all=parseLS<Record<string,{undo:Deck[];redo:Deck[]}>>("desel.v2.deckHistory",{});const h=all[deck.id]??{undo:[],redo:[]};h.undo=[...h.undo,before].slice(-30);h.redo=[];all[deck.id]=h;writes.push(["desel.v2.deckHistory",all]);}
      if (before) {
        // Mirror the desktop rule: one snapshot per slide per editing burst.
        const fresh = [...revisions];
        let dirty = false;
        for (const prev of before.slides) {
          const now = deck.slides.find(s => s.id === prev.id);
          if (!now || !prev.html.trim() || (now.html === prev.html && now.title === prev.title)) continue;
          const last = fresh.filter(r => r.slideId === prev.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          // Coalesce bursts of the same content only - a different version
          // (e.g. agent's) overwritten seconds later must stay recoverable.
          if (last && last.html === prev.html && last.title===prev.title && Date.now() - Date.parse(last.createdAt) < 25_000) continue;
          fresh.push({ id: id("rev"), deckId: deck.id, slideId: prev.id, title: prev.title, html: prev.html, createdAt: new Date().toISOString() });
          dirty = true;
        }
        if (dirty) writes.push([LS_REVISIONS,fresh.slice(-200)]);
      }
      const next = decks.some(d => d.id === deck.id) ? decks.map(d => d.id === deck.id ? deck : d) : [deck, ...decks];
      writes.push([LS_DECKS,next]);saveBatch(writes);
      return deck as T;
    }
    case "delete_deck": saveBatch([[LS_DECKS,decks.filter(d=>d.id!==args.id)],[LS_REFS,parseLS<Asset[]>(LS_REFS,[]).filter(r=>r.deckId!==args.id)],[LS_MESSAGES,messages.filter(m=>m.deckId!==args.id)],[LS_COMMENTS,comments.filter(c=>c.deckId!==args.id)],[LS_REVISIONS,revisions.filter(r=>r.deckId!==args.id)]]);return undefined as T;
    case "save_recovery_copy":{const draft=inlineCopyAssets(args.deck as Deck,parseLS<Asset[]>(LS_REFS,[]));const copy={...draft,id:id("deck"),title:`${draft.title} (local recovery)`,slides:draft.slides.map(s=>({...s,id:id("slide")})),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};const mapping=new Map(draft.slides.map((s,i)=>[s.id,copy.slides[i].id]));const pins=comments.filter(c=>c.deckId===draft.id&&mapping.has(c.slideId)).map(c=>({...c,id:id("cm"),deckId:copy.id,slideId:mapping.get(c.slideId)!}));const refs=parseLS<Asset[]>(LS_REFS,[]);saveBatch([[LS_REFS,[...refs,...refs.filter(r=>r.deckId===draft.id).map(r=>({...r,id:id("ref"),deckId:copy.id}))]],[LS_COMMENTS,[...comments,...pins]],[LS_DECKS,[copy,...decks]]]);return copy as T;}
    case "duplicate_deck": {
      const source = decks.find(d => d.id === args.id); if (!source) throw new Error("Deck not found");const original=inlineCopyAssets(source,parseLS<Asset[]>(LS_REFS,[]));
      const now=new Date().toISOString();const deck:Deck={...original,id:id("deck"),title:`${original.title} (copy)`,createdAt:now,updatedAt:now,fromTemplateId:null,slides:original.slides.map(s=>({...s,id:id("slide")}))};
      const mapping=new Map(original.slides.map((s,i)=>[s.id,deck.slides[i].id]));const pins=comments.filter(c=>c.deckId===original.id).map(c=>({...c,id:id("cm"),deckId:deck.id,slideId:mapping.get(c.slideId)??c.slideId}));const refs=parseLS<Asset[]>(LS_REFS,[]);const copies=refs.filter(r=>r.deckId===original.id).map(r=>({...r,id:id("ref"),deckId:deck.id}));
      saveBatch([[LS_REFS,[...refs,...copies]],[LS_COMMENTS,[...comments,...pins]],[LS_DECKS,[deck,...decks]]]);return deck as T;
    }
    case "list_messages": return messages.filter(m => m.deckId === args.deckId) as T;
    case "creator_resume_plan": return {runId:String(args.runId),finished:[],uncertain:[],safeBoundary:true} as T;
    case "get_creator_workspace": return null as T;
    case "save_creator_workspace": return undefined as T;
    case "get_chat_branches": return (JSON.parse(localStorage.getItem(`desel.branches.${args.deckId}`)||"null")) as T;
    case "save_chat_branches": localStorage.setItem(`desel.branches.${args.deckId}`, JSON.stringify(args.branches)); return undefined as T;
    case "clear_messages": localStorage.removeItem(`desel.branches.${args.deckId}`); saveLS(LS_MESSAGES, messages.filter(m => m.deckId !== args.deckId)); return undefined as T;
    case "append_message": {
      const m: ChatMessage = { id: id("msg"), deckId: String(args.deckId), role: String(args.role) as ChatMessage["role"], content: String(args.content), createdAt: new Date().toISOString() };
      saveLS(LS_MESSAGES, [...messages, m]); return m as T;
    }
    case "creator_runs":return [] as T;
    case "send_to_agent": throw new Error("Agent chat hanya tersedia di app desktop setelah mengisi provider API.");
    case "submit_render_review": return undefined as T;
    case "report_geometry_lints": return undefined as T; // browser: findings stay in the UI
    case "cancel_agent": return undefined as T; // browser: agent never runs here
    case "list_templates": return templates as T;
    case "save_template": {
      const payload = args.args as { name: string; description?: string; deck: Deck };
      const deck=structuredClone(payload.deck);const assets=parseLS<Asset[]>(LS_REFS,[]).filter(a=>a.deckId===deck.id);let total=0;for(const slide of deck.slides){slide.html=slide.html.replace(/asset:([A-Za-z0-9_-]+)/g,(_,id)=>{const a=assets.find(a=>a.id===id);if(!a)throw Error("Template contains missing asset");return `data:${a.mime};base64,${a.data}`});total+=slide.html.length;if(slide.html.length>4*1024*1024||total>32*1024*1024)throw Error("Template images exceed safe inline limits");}
      const now = new Date().toISOString(); const t: TemplateRecord = { id: id("tpl"), name: payload.name, description: payload.description ?? "", deck, createdAt: now, updatedAt: now };
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
      saveBatch([[LS_DECKS,decks.map(d=>d.id===next.id?next:d)],[LS_REVISIONS,[...revisions,{id:id("rev"),deckId:deck.id,slideId:rev.slideId,title:current.title,html:current.html,createdAt:new Date().toISOString()}].slice(-200)]]);
      return next as T;
    }
    case "list_brands":return parseLS<BrandProfile[]>("desel.v2.brands",[]) as T;
    case "save_brand":{const b=args.brand as BrandProfile;if(!b.id||b.id.length>100||!b.name.trim()||new TextEncoder().encode(b.name).length>160||b.palette.length>12||b.palette.some(c=>!/^#[0-9a-f]{6}$/i.test(c)))throw Error("Nama/palet brand tidak valid");for(const v of [b.styleGuide,b.brandHandle,b.saveLabel]){if(new TextEncoder().encode(v).length>8000||v.includes("\0"))throw Error("Teks brand terlalu panjang/tidak valid");}const brands=parseLS<BrandProfile[]>("desel.v2.brands",[]);saveLS("desel.v2.brands",[{...b,updatedAt:new Date().toISOString()},...brands.filter(v=>v.id!==b.id)]);return undefined as T;}
    case "delete_brand":saveLS("desel.v2.brands",parseLS<BrandProfile[]>("desel.v2.brands",[]).filter(b=>b.id!==args.id));return undefined as T;
    case "set_asset_provenance": {
      const refs=parseLS<Asset[]>(LS_REFS,[]);if(!refs.some(r=>r.id===args.id&&r.deckId===args.deckId))throw Error("Asset not found in this project");
      const v=args.value as AssetProvenance;for(const text of Object.values(v)){if(typeof text!=="string"||new TextEncoder().encode(text).length>4000||text.includes("\0"))throw Error("Catatan aset tidak valid/maksimal4000byte");}
      if(v.sourceUrl&&!/^https?:\/\//.test(v.sourceUrl))throw Error("URL sumber harus HTTP/HTTPS");
      saveLS(LS_REFS,refs.map(r=>r.id===args.id?{...r,provenance:v}:r));return undefined as T;
    }
    case "asset_by_id":{const a=parseLS<Asset[]>(LS_REFS,[]).find(a=>a.id===args.id&&a.deckId===args.deckId&&a.mime.startsWith("image/"));if(!a)throw Error("Image not found in this project");return a as T;}
    case "list_asset_library": return parseLS<Asset[]>(LS_REFS,[]).filter(r=>decks.some(d=>d.id===r.deckId)&&r.mime.startsWith("image/")&&!r.name.startsWith("__render")).map(r=>({...r,data:""})) as T;
    case "copy_library_asset": {
      const refs=parseLS<Asset[]>(LS_REFS,[]);const source=refs.find(r=>r.id===args.id&&r.deckId===args.sourceDeck&&r.mime.startsWith("image/")&&!r.name.startsWith("__render"));
      if(!source||!decks.some(d=>d.id===args.deckId))throw Error("Asset/project not found");const copy={...source,id:id("ref"),deckId:String(args.deckId),createdAt:new Date().toISOString()};saveLS(LS_REFS,[...refs,copy]);return copy as T;
    }
    case "set_reference_intent": {
      const refs=parseLS<Asset[]>(LS_REFS,[]);const item=refs.find(r=>r.id===args.id&&r.deckId===args.deckId);
      if(!item)throw new Error("Reference not found in this deck");
      if(!["","cover","body","closer","asset"].includes(String(args.role))||!["","candidate","approved","rejected"].includes(String(args.status)))throw new Error("Invalid reference intent");
      saveLS(LS_REFS,refs.map(r=>r.id===args.id?{...r,referenceRole:args.role,referenceStatus:args.status}:r));return undefined as T;
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
    case "export_project":
    case "import_project": throw new Error("Backup/pemulihan proyek memerlukan aplikasi desktop Desel. Browser preview tidak menyimpan file proyek native.");
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
  const size = aspect === "16:9" ? [1920,1080] : aspect === "1:1" ? [1080, 1080] : aspect === "9:16" ? [1080, 1920] : [1080, 1350];

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
  exportProject: (deckId:string)=>invoke<string>("export_project",{deckId}),
  importProject: (content:string)=>invoke<Deck>("import_project",{content}),
  providerManagement: (action:string,payload?:Record<string,unknown>) => invoke<Record<string,unknown>>("provider_management",{action,payload}),
  runtimeStatus: () => invoke<{running:boolean;gatewayUrl?:string;version:string;managed:boolean}>("provider_runtime_status"),
  runtimeStart: () => invoke<{running:boolean;gatewayUrl?:string;version:string;managed:boolean}>("provider_runtime_start"),
  runtimeStop: () => invoke<void>("provider_runtime_stop"),
  runtimeManage: () => invoke<void>("provider_runtime_manage"),
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
  discoverModels: (settings:AppSettings) => invoke<import("./types").ModelCapability[]>("discover_models",{settings}),
  listModels: () => invoke<string[]>("list_models"),
  testConnection: (settings?:AppSettings) => invoke<Record<string, unknown>>("test_connection",{settings}),
  listDecks: () => invoke<DeckSummary[]>("list_decks"),
  getDeck: (id: string) => invoke<Deck | null>("get_deck", { id }),
  createDeck: (title = "Untitled deck", aspect: Deck["aspect"] = "4:5", templateId: string | null = null) => invoke<Deck>("create_deck", { args: { title, aspect, templateId } }),
  deckHistoryCounts:(id:string)=>invoke<[number,number]>("deck_history_counts",{id}),
  stepDeckHistory:(expected:Deck,direction:"undo"|"redo")=>invoke<Deck>("step_deck_history",{expected,direction}),
  saveDeck: (deck: Deck, thumbnail: string | null = null,expected:Deck|null=null) => invoke<Deck>("save_deck", { deck, thumbnail,expected }),
  deleteDeck: (id: string) => invoke<void>("delete_deck", { id }),
  saveRecoveryCopy:(deck:Deck)=>invoke<Deck>("save_recovery_copy",{deck}),
  duplicateDeck: (id: string) => invoke<Deck>("duplicate_deck", { id }),
  listMessages: (deckId: string) => invoke<ChatMessage[]>("list_messages", { deckId }),
  getCreatorWorkspace: (deckId: string) => invoke<unknown | null>("get_creator_workspace", { deckId }),
  saveCreatorWorkspace: (deckId: string, workspace: unknown) => invoke<void>("save_creator_workspace", { deckId, workspace }),
  creatorResumePlan: (runId: string) => invoke<{runId:string;finished:{callId:string;tool:string}[];uncertain:{callId:string;tool:string}[];safeBoundary:boolean}>("creator_resume_plan", { runId }),
  getChatBranches: (deckId: string) => invoke<unknown | null>("get_chat_branches", { deckId }),
  saveChatBranches: (deckId: string, branches: unknown) => invoke<void>("save_chat_branches", { deckId, branches }),
  clearMessages: (deckId: string) => invoke<void>("clear_messages", { deckId }),
  appendMessage: (deckId: string, role: ChatMessage["role"], content: string) => invoke<ChatMessage>("append_message", { deckId, role, content }),
  creatorRuns:(deckId:string)=>invoke<CreatorRun[]>("creator_runs",{deckId}),
  sendToAgent: (deckId: string, text: string, onEvent: (event: AgentEvent) => void, context?:CreatorRequest) => {
    // The Tauri Channel constructor throws outside the desktop runtime, so build
    // it only there; in the browser the invoke shim answers with its own error.
    if (!isTauri) return invoke<void>("send_to_agent", { deckId, text });
    const channel = new Channel<AgentEvent>(onEvent);
    return invoke<void>("send_to_agent", { deckId, text, channel, context });
  },
  listTemplates: () => invoke<TemplateRecord[]>("list_templates"),
  submitRenderReview: (deckId:string,requestId:string,receipt:unknown) => invoke<void>("submit_render_review",{deckId,requestId,receipt}),
  reportGeometryLints: (deckId: string, issues: string[]) => invoke<void>("report_geometry_lints", { deckId, issues }),
  cancelAgent: (deckId: string) => invoke<void>("cancel_agent", { deckId }),
  saveTemplate: (name: string, description: string, deck: Deck) => invoke<TemplateRecord>("save_template", { args: { name, description, deck } }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  listComments: (deckId: string) => invoke<Comment[]>("list_comments", { deckId }),
  addComment: (comment: Omit<Comment, "id" | "status" | "createdAt">) => invoke<Comment>("add_comment", { args: comment }),
  setCommentStatus: (id: string, status: Comment["status"]) => invoke<void>("set_comment_status", { id, status }),
  deleteComment: (id: string) => invoke<void>("delete_comment", { id }),
  listRevisions: (slideId: string) => invoke<SlideRevision[]>("list_revisions", { slideId }),
  restoreRevision: (id: string) => invoke<Deck>("restore_revision", { id }),
  setReferenceIntent: (deckId:string,id:string,role:string,status:string)=>invoke<void>("set_reference_intent",{deckId,id,role,status}),
  setAssetProvenance:(deckId:string,id:string,value:AssetProvenance)=>invoke<void>("set_asset_provenance",{deckId,id,value}),
  listBrands:()=>invoke<BrandProfile[]>("list_brands"),
  saveBrand:(brand:BrandProfile)=>invoke<void>("save_brand",{brand}),
  deleteBrand:(id:string)=>invoke<void>("delete_brand",{id}),
  assetById:(deckId:string,id:string)=>invoke<Asset>("asset_by_id",{deckId,id}),
  listAssetLibrary:()=>invoke<Asset[]>("list_asset_library"),
  copyLibraryAsset:(deckId:string,sourceDeck:string,id:string)=>invoke<Asset>("copy_library_asset",{deckId,sourceDeck,id}),
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
