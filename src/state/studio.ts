import { create } from "zustand";
import { api, defaultSettings, emptyDeckRecord } from "../lib/api";
import { sampleDeck } from "../lib/sample";
import type { AgentEvent, AppSettings, Asset, ChatMessage, Comment, Deck, DeckSummary, LintIssue, Slide, SlideRevision, TemplateRecord, ToolCallRecord } from "../lib/types";

export type StudioStatus = "idle" | "generating" | "exporting";
type Toast = { kind: "ok" | "error" | "info"; text: string } | null;

interface StudioState {
  deck: Deck;
  decks: DeckSummary[];
  templates: TemplateRecord[];
  messages: ChatMessage[];
  comments: Comment[];
  references: Asset[];
  lints: Record<string, LintIssue[]>;
  revisions: SlideRevision[];
  settings: AppSettings;
  settingsLoaded: boolean;
  selectedSlideId: string | null;
  activeCommentId: string | null;
  setActiveComment: (id: string | null) => void;
  status: StudioStatus;
  statusMessage: string;
  streamingText: string;
  liveTools: ToolCallRecord[];
  toast: Toast;
  boot: () => Promise<void>;
  refreshDecks: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  openDeck: (id: string) => Promise<void>;
  newDeck: (templateId?: string) => Promise<void>;
  loadSample: () => Promise<void>;
  deleteDeck: (id: string) => Promise<void>;
  duplicateDeck: (id: string) => Promise<void>;
  saveDeck: () => Promise<void>;
  updateDeck: (patch: Partial<Deck>) => void;
  selectSlide: (id: string | null) => void;
  updateSlide: (id: string, patch: Partial<Slide>) => void;
  addSlide: () => void;
  duplicateSlide: (id: string) => void;
  deleteSlide: (id: string) => void;
  moveSlide: (id: string, delta: -1 | 1) => void;
  reorderSlide: (id: string, to: number) => void;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => Promise<void>;
  saveTemplate: (name: string, description: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  addComment: (slideId: string, x: number, y: number, body: string, selector?: string) => Promise<void>;
  setCommentStatus: (id: string, status: Comment["status"]) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  refreshReferences: (deckId?: string) => Promise<void>;
  attachReferenceData: (name: string, dataUrl: string) => Promise<void>;
  attachReferencePaths: (paths: string[]) => Promise<void>;
  attachReferenceUrl: (url: string) => Promise<void>;
  removeReference: (id: string) => Promise<void>;
  refreshLints: (deckId?: string) => Promise<void>;
  refreshRevisions: (slideId?: string) => Promise<void>;
  restoreRevision: (id: string) => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setStatus: (status: StudioStatus, message?: string) => void;
  notify: (kind: NonNullable<Toast>["kind"], text: string) => void;
  clearToast: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lintTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(deck: Deck) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api.saveDeck(deck).catch((err) => useStudio.getState().notify("error", `Autosave gagal: ${String(err)}`));
  }, 450);
}
const touched = (deck: Deck, patch: Partial<Deck> = {}): Deck => ({ ...deck, ...patch, updatedAt: new Date().toISOString() });
const localId = (prefix: string) => `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export const useStudio = create<StudioState>((set, get) => ({
  deck: emptyDeckRecord(),
  decks: [],
  templates: [],
  messages: [],
  comments: [],
  references: [],
  lints: {},
  revisions: [],
  settings: defaultSettings,
  settingsLoaded: false,
  selectedSlideId: null,
  activeCommentId: null,
  setActiveComment: (id) => set({ activeCommentId: id }),
  status: "idle",
  statusMessage: "",
  streamingText: "",
  liveTools: [],
  toast: null,

  boot: async () => {
    try {
      const [settings, decks, templates] = await Promise.all([api.getSettings(), api.listDecks(), api.listTemplates()]);
      let active = decks.length ? await api.getDeck(decks[0].id) : null;
      if (!active) active = await api.createDeck("Untitled deck", settings.baseUrl ? "4:5" : "4:5");
      const [messages, comments, freshDecks, references] = await Promise.all([api.listMessages(active.id), api.listComments(active.id), api.listDecks(), api.referenceData(active.id).catch(() => [])]);
      set({ settings: { ...defaultSettings, ...settings }, settingsLoaded: true, decks: freshDecks, templates, deck: active, selectedSlideId: active.slides[0]?.id ?? null, messages, comments, references });
      void get().refreshLints(active.id);
    } catch (err) {
      set({ settingsLoaded: true });
      get().notify("error", `Gagal membuka studio: ${String(err)}`);
    }
  },

  refreshDecks: async () => set({ decks: await api.listDecks() }),
  refreshTemplates: async () => set({ templates: await api.listTemplates() }),

  openDeck: async (id) => {
    const deck = await api.getDeck(id);
    if (!deck) return get().notify("error", "Project tidak ditemukan.");
    const [messages, comments, references] = await Promise.all([api.listMessages(id), api.listComments(id), api.referenceData(id).catch(() => [])]);
    set({ deck, messages, comments, references, selectedSlideId: deck.slides[0]?.id ?? null, activeCommentId: null, streamingText: "", liveTools: [], lints: {} });
    void get().refreshLints(id);
  },

  newDeck: async (templateId) => {
    try {
      const template = templateId ? get().templates.find((t) => t.id === templateId) : undefined;
      const deck = await api.createDeck(template?.name ?? "Untitled deck", get().deck.aspect, templateId ?? null);
      set({ deck, messages: [], comments: [], references: [], selectedSlideId: deck.slides[0]?.id ?? null, streamingText: "", liveTools: [] });
      void get().refreshLints(deck.id);
      await get().refreshDecks();
      get().notify("ok", templateId ? "Project baru dibuat dari template." : "Project kosong dibuat. Mulai dari brief kamu.");
    } catch (err) { get().notify("error", String(err).replace(/^Error:\s*/, "")); }
  },

  loadSample: async () => {
    try {
      const existing = get().decks.find((d) => d.title === "Editorial print — contoh");
      if (existing) {
        await get().openDeck(existing.id);
        get().notify("info", "Contoh deck sudah ada — dibuka lagi.");
        return;
      }
      const created = await api.createDeck("Editorial print — contoh", "4:5", null);
      const sample = sampleDeck();
      const deck: Deck = {
        ...created,
        title: sample.title,
        caption: sample.caption,
        styleGuide: sample.styleGuide,
        palette: sample.palette,
        brandHandle: sample.brandHandle,
        saveLabel: sample.saveLabel,
        slides: sample.slides.map((s, i) => ({ ...s, id: `${created.id}_s${i + 1}` })),
      };
      await api.saveDeck(deck);
      set({ deck, messages: [], comments: [], references: [], selectedSlideId: deck.slides[0].id, streamingText: "", liveTools: [], lints: {} });
      await get().refreshDecks();
      void get().refreshLints(deck.id);
      get().notify("ok", "Contoh deck dimuat — patokan visual yang bisa lo pakai atau ubah.");
    } catch (err) {
      get().notify("error", String(err).replace(/^Error:\\s*/, ""));
    }
  },

  deleteDeck: async (id) => {
    await api.deleteDeck(id);
    const decks = await api.listDecks();
    set({ decks });
    if (get().deck.id === id) {
      const next = decks[0] ? await api.getDeck(decks[0].id) : await api.createDeck();
      const messages = next ? await api.listMessages(next.id) : [];
      set({ deck: next ?? emptyDeckRecord(), messages, comments: [], selectedSlideId: next?.slides[0]?.id ?? null });
    }
  },

  duplicateDeck: async (id) => {
    const deck = await api.duplicateDeck(id);
    await get().refreshDecks();
    await get().openDeck(deck.id);
    get().notify("ok", "Project diduplikasi.");
  },

  saveDeck: async () => {
    if (saveTimer) clearTimeout(saveTimer);
    await api.saveDeck(get().deck);
    await get().refreshDecks();
    get().notify("ok", "Tersimpan ke database lokal.");
  },

  updateDeck: (patch) => {
    const deck = touched(get().deck, patch);
    set({ deck });
    scheduleSave(deck);
  },

  selectSlide: (id) => set({ selectedSlideId: id }),

  updateSlide: (id, patch) => {
    const deck = touched(get().deck, { slides: get().deck.slides.map((s) => s.id === id ? { ...s, ...patch } : s) });
    set({ deck });
    scheduleSave(deck);
    if (patch.html !== undefined) {
      if (lintTimer) clearTimeout(lintTimer);
      lintTimer = setTimeout(() => void get().refreshLints(deck.id), 700);
    }
  },

  addSlide: () => {
    const slide: Slide = { id: localId("sl"), title: `Slide ${get().deck.slides.length + 1}`, html: "<!doctype html><html><head><meta charset=\"utf-8\"><style>*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#151515;color:#f5f2ec;font-family:Arial,sans-serif}.canvas{height:100%;display:grid;place-items:center;color:#6d6a64;font-size:32px}</style></head><body><div class=\"canvas\">Minta agent mendesain slide ini</div></body></html>", rationale: "", hidden: false };
    const deck = touched(get().deck, { slides: [...get().deck.slides, slide] });
    set({ deck, selectedSlideId: slide.id }); scheduleSave(deck);
  },

  duplicateSlide: (id) => {
    const slides = [...get().deck.slides]; const index = slides.findIndex(s => s.id === id); if (index < 0) return;
    const copy = { ...slides[index], id: localId("sl"), title: `${slides[index].title} copy` }; slides.splice(index + 1, 0, copy);
    const deck = touched(get().deck, { slides }); set({ deck, selectedSlideId: copy.id }); scheduleSave(deck);
  },

  deleteSlide: (id) => {
    const slides = get().deck.slides.filter(s => s.id !== id);
    const deck = touched(get().deck, { slides });
    set({ deck, selectedSlideId: get().selectedSlideId === id ? slides[0]?.id ?? null : get().selectedSlideId, comments: get().comments.filter(c => c.slideId !== id) }); scheduleSave(deck);
  },

  moveSlide: (id, delta) => {
    const slides = [...get().deck.slides]; const index = slides.findIndex(s => s.id === id); const target = index + delta;
    if (index < 0 || target < 0 || target >= slides.length) return;
    [slides[index], slides[target]] = [slides[target], slides[index]];
    const deck = touched(get().deck, { slides }); set({ deck }); scheduleSave(deck);
  },

  reorderSlide: (id, to) => {
    const slides = [...get().deck.slides];
    const from = slides.findIndex((s) => s.id === id);
    if (from < 0 || to < 0 || to >= slides.length || from === to) return;
    const [moved] = slides.splice(from, 1);
    slides.splice(to, 0, moved);
    const deck = touched(get().deck, { slides });
    set({ deck });
    scheduleSave(deck);
  },

  sendMessage: async (raw) => {
    const text = raw.trim(); if (!text || get().status === "generating") return;
    const deckId = get().deck.id;
    const userMsg: ChatMessage = { id: localId("msg"), deckId, role: "user", content: text, createdAt: new Date().toISOString() };
    set({ status: "generating", statusMessage: "Agent bekerja", messages: [...get().messages, userMsg], streamingText: "", liveTools: [] });
    try {
      await api.sendToAgent(deckId, text, (event: AgentEvent) => applyAgentEvent(event, set, get));
      const [messages, deck, comments] = await Promise.all([api.listMessages(deckId), api.getDeck(deckId), api.listComments(deckId)]);
      set({ messages, ...(deck ? { deck } : {}), comments, streamingText: "", liveTools: [], status: "idle", statusMessage: "" });
      await get().refreshDecks();
    } catch (err) {
      set({ status: "idle", statusMessage: "", streamingText: "" });
      get().notify("error", String(err));
    }
  },

  clearChat: async () => { await api.clearMessages(get().deck.id); set({ messages: [], streamingText: "", liveTools: [] }); },

  saveTemplate: async (name, description) => {
    await api.saveTemplate(name, description, get().deck);
    await get().refreshTemplates();
    get().notify("ok", "Desain disimpan sebagai template reusable.");
  },
  deleteTemplate: async (id) => { await api.deleteTemplate(id); await get().refreshTemplates(); },

  addComment: async (slideId, x, y, body, selector) => {
    const c = await api.addComment({ deckId: get().deck.id, slideId, x, y, body, selector, author: "user" });
    set({ comments: [...get().comments, c], activeCommentId: c.id });
  },
  setCommentStatus: async (id, status) => { await api.setCommentStatus(id, status); set({ comments: get().comments.map(c => c.id === id ? { ...c, status } : c) }); },
  deleteComment: async (id) => { await api.deleteComment(id); set({ comments: get().comments.filter(c => c.id !== id), activeCommentId: null }); },

  refreshReferences: async (deckId) => {
    const target = deckId ?? get().deck.id;
    try { set({ references: await api.referenceData(target) }); }
    catch (err) { get().notify("error", `Gagal memuat referensi: ${String(err)}`); }
  },

  attachReferenceData: async (name, dataUrl) => {
    try {
      await api.addReferenceData(get().deck.id, name, dataUrl);
      await get().refreshReferences();
      get().notify("ok", `Referensi "${name}" ditambahkan. Agent akan memakainya sebagai arah rasa.`);
    } catch (err) { get().notify("error", `Gagal menambah referensi: ${String(err)}`); }
  },

  attachReferencePaths: async (paths) => {
    try {
      await api.addReferencePaths(get().deck.id, paths);
      await get().refreshReferences();
      get().notify("ok", `${paths.length} referensi ditambahkan.`);
    } catch (err) { get().notify("error", `Gagal menambah referensi: ${String(err)}`); }
  },

  refreshLints: async (deckId) => {
    const target = deckId ?? get().deck.id;
    if (!target) return;
    try {
      const rows = await api.lintDeck(target);
      const map: Record<string, LintIssue[]> = {};
      for (const row of rows) if (row.issues.length) map[row.slideId] = row.issues;
      if (get().deck.id === target) set({ lints: map });
    } catch { /* review is advisory; never block the studio */ }
  },

  refreshRevisions: async (slideId) => {
    const target = slideId ?? get().selectedSlideId ?? get().deck.slides[0]?.id;
    if (!target) {
      set({ revisions: [] });
      return;
    }
    try {
      set({ revisions: await api.listRevisions(target) });
    } catch {
      set({ revisions: [] });
    }
  },

  restoreRevision: async (id) => {
    try {
      const deck = await api.restoreRevision(id);
      set({ deck });
      await get().refreshRevisions();
      void get().refreshLints(deck.id);
      get().notify("ok", "Versi sebelumnya dipulihkan.");
    } catch (err) {
      get().notify("error", String(err).replace(/^Error:\s*/, ""));
    }
  },

  attachReferenceUrl: async (url) => {
    try {
      const refs = await api.addReferenceUrl(get().deck.id, url);
      set({ references: refs });
      get().notify("ok", "Referensi ditambahkan dari link.");
    } catch (err) {
      get().notify("error", String(err).replace(/^Error:\s*/, ""));
    }
  },

  removeReference: async (id) => {
    try {
      await api.deleteReference(id);
      set({ references: get().references.filter(r => r.id !== id) });
    } catch (err) { get().notify("error", `Gagal menghapus referensi: ${String(err)}`); }
  },

  saveSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try { await api.saveSettings(settings); get().notify("ok", "Pengaturan tersimpan di database lokal."); }
    catch (err) { get().notify("error", `Gagal menyimpan settings: ${String(err)}`); }
  },

  setStatus: (status, statusMessage = "") => set({ status, statusMessage }),
  notify: (kind, text) => set({ toast: { kind, text } }),
  clearToast: () => set({ toast: null }),
}));

function applyAgentEvent(event: AgentEvent, set: (partial: Partial<StudioState>) => void, get: () => StudioState) {
  switch (event.type) {
    case "turn_start": set({ statusMessage: event.turn === 1 ? "Membaca brief" : `Agent lanjut · langkah ${event.turn}` }); break;
    case "text_delta": set({ streamingText: get().streamingText + event.text, statusMessage: "Menulis" }); break;
    case "tool_call": {
      const call: ToolCallRecord = { id: event.id, name: event.name, args: event.args, state: "running" };
      set({ liveTools: [...get().liveTools, call], statusMessage: labelTool(event.name) }); break;
    }
    case "tool_result": set({ liveTools: get().liveTools.map(t => t.id === event.id ? { ...t, state: event.ok ? "done" : "error", result: event.result } : t) }); break;
    case "deck_updated":
      set({ deck: event.deck, selectedSlideId: event.deck.slides.at(-1)?.id ?? get().selectedSlideId });
      void get().refreshLints(event.deck.id);
      break;
    case "done": set({ statusMessage: event.reason === "question" ? "Menunggu jawaban" : "Selesai" }); break;
    case "error": set({ status: "idle", statusMessage: "" }); get().notify("error", event.message); break;
  }
}
function labelTool(name: string) {
  const labels: Record<string, string> = { search_web: "Riset web", fetch_url: "Membaca sumber", read_deck: "Membaca deck", set_deck_meta: "Menetapkan art direction", write_slide: "Menulis kode slide", delete_slide: "Menghapus slide", save_template: "Menyimpan template", load_template: "Memuat template", ask_user: "Bertanya" };
  return labels[name] ?? name;
}

export type { AgentEvent, AppSettings, ChatMessage, Comment, Deck, DeckSummary, Slide, TemplateRecord, ToolCallRecord };
