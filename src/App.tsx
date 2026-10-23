import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  Layers,
  ImageDown,
  LayoutTemplate,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  Palette,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { api } from "./lib/api";
import {
  ASPECTS,
  aspectSize,
  type ChatMessage,
  type Comment,
  type Deck,
  type LintIssue,
  type Slide,
  type TemplateRecord,
  type ToolCallRecord,
} from "./lib/types";
import Canvas from "./components/Canvas";
import { useStudio } from "./state/studio";

type LeftTab = "chat" | "projects" | "templates";
type RightTab = "design" | "source" | "notes";

/** One conversation turn: all assistant segments until the next user message. */
type Turn =
  | { kind: "user"; id: string; text: string }
  | { kind: "agent"; id: string; text: string; steps: ToolCallRecord[] };

function buildTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pending: { id: string; parts: string[]; steps: ToolCallRecord[] } | null = null;
  const flush = () => {
    if (!pending) return;
    turns.push({
      kind: "agent",
      id: pending.id,
      text: pending.parts.filter(Boolean).join(" ").trim(),
      steps: pending.steps,
    });
    pending = null;
  };
  for (const m of messages) {
    if (m.role === "user") {
      flush();
      turns.push({ kind: "user", id: m.id, text: m.content });
    } else if (m.role === "assistant") {
      // Tool-only responses arrive as separate messages; one bubble per turn.
      pending ??= { id: m.id, parts: [], steps: [] };
      if (m.content.trim()) pending.parts.push(m.content.trim());
      if (m.toolCalls?.length) pending.steps.push(...m.toolCalls);
    }
  }
  flush();
  return turns;
}

/** One-click endpoints, so nobody has to know the base URL by heart. */
const PROVIDERS = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
];

export default function App() {
  const boot = useStudio((s) => s.boot);
  const deck = useStudio((s) => s.deck);
  const decks = useStudio((s) => s.decks);
  const templates = useStudio((s) => s.templates);
  const messages = useStudio((s) => s.messages);

  /** Persisted tool replies, so finished turns can still show what the agent did. */
  const toolResults = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      if (m.role === "tool" && m.toolCallId) map.set(m.toolCallId, m.content);
    }
    return map;
  }, [messages]);

  /** One bubble + one receipts list per turn. */
  const turns = useMemo(() => buildTurns(messages), [messages]);

  const comments = useStudio((s) => s.comments);
  const settings = useStudio((s) => s.settings);
  const settingsLoaded = useStudio((s) => s.settingsLoaded);
  const selectedSlideId = useStudio((s) => s.selectedSlideId);
  const status = useStudio((s) => s.status);
  const statusMessage = useStudio((s) => s.statusMessage);
  const streamingText = useStudio((s) => s.streamingText);
  const liveTools = useStudio((s) => s.liveTools);
  const toast = useStudio((s) => s.toast);
  const openDeck = useStudio((s) => s.openDeck);
  const newDeck = useStudio((s) => s.newDeck);
  const loadSample = useStudio((s) => s.loadSample);
  const duplicateDeck = useStudio((s) => s.duplicateDeck);
  const deleteDeck = useStudio((s) => s.deleteDeck);
  const saveDeck = useStudio((s) => s.saveDeck);
  const updateDeck = useStudio((s) => s.updateDeck);
  const selectSlide = useStudio((s) => s.selectSlide);
  const updateSlide = useStudio((s) => s.updateSlide);
  const addSlide = useStudio((s) => s.addSlide);
  const duplicateSlide = useStudio((s) => s.duplicateSlide);
  const deleteSlide = useStudio((s) => s.deleteSlide);
  const moveSlide = useStudio((s) => s.moveSlide);
  const reorderSlide = useStudio((s) => s.reorderSlide);
  const sendMessage = useStudio((s) => s.sendMessage);
  const clearChat = useStudio((s) => s.clearChat);
  const references = useStudio((s) => s.references);
  const lints = useStudio((s) => s.lints);
  const revisions = useStudio((s) => s.revisions);
  const refreshRevisions = useStudio((s) => s.refreshRevisions);
  const restoreRevision = useStudio((s) => s.restoreRevision);
  const attachReferenceData = useStudio((s) => s.attachReferenceData);
  const attachReferencePaths = useStudio((s) => s.attachReferencePaths);
  const attachReferenceUrl = useStudio((s) => s.attachReferenceUrl);
  const removeReference = useStudio((s) => s.removeReference);
  const saveTemplate = useStudio((s) => s.saveTemplate);
  const deleteTemplate = useStudio((s) => s.deleteTemplate);
  const addComment = useStudio((s) => s.addComment);
  const setCommentStatus = useStudio((s) => s.setCommentStatus);
  const deleteComment = useStudio((s) => s.deleteComment);
  const saveSettings = useStudio((s) => s.saveSettings);
  const notify = useStudio((s) => s.notify);
  const activeCommentId = useStudio((s) => s.activeCommentId);
  const setActiveComment = useStudio((s) => s.setActiveComment);
  const clearToast = useStudio((s) => s.clearToast);

  const [left, setLeft] = useState<LeftTab>("chat");
  const [right, setRight] = useState<RightTab>("design");
  const [draft, setDraft] = useState("");
  const [pinning, setPinning] = useState(false);
  const [pinAt, setPinAt] = useState<{ x: number; y: number; selector: string } | null>(null);
  const [pinText, setPinText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateNote, setTemplateNote] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPng, setExportPng] = useState(true);
  const [exportPdf, setExportPdf] = useState(false);
  const [exportCaption, setExportCaption] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [refUrl, setRefUrl] = useState("");
  const [refUrlOpen, setRefUrlOpen] = useState(false);
  const [refBusy, setRefBusy] = useState(false);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Hidden full-size renders used by the exporter. */
  const frames = useRef<(HTMLIFrameElement | null)[]>([]);

  const pickReferences = useCallback(async () => {
    if (api.isTauri) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({
          multiple: true,
          title: "Pilih gambar referensi",
          filters: [{ name: "Gambar", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }],
        });
        const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
        if (paths.length) await attachReferencePaths(paths as string[]);
      } catch (err) {
        notify("error", `Gagal membuka pemilih file: ${String(err)}`);
      }
      return;
    }
    fileRef.current?.click();
  }, [attachReferencePaths, notify]);

  const submitReferenceUrl = useCallback(async () => {
    const value = refUrl.trim();
    if (!value || refBusy) return;
    setRefBusy(true);
    try {
      await attachReferenceUrl(value);
      setRefUrl("");
      setRefUrlOpen(false);
    } finally {
      setRefBusy(false);
    }
  }, [attachReferenceUrl, refBusy, refUrl]);

  const size = aspectSize(deck.aspect);
  const selected = deck.slides.find((s) => s.id === selectedSlideId) ?? deck.slides[0] ?? null;
  const slideNotes = useMemo(
    () => comments.filter((c) => c.slideId === selected?.id),
    [comments, selected?.id],
  );
  const openNotes = comments.filter((c) => c.status === "open").length;
  const reviewMessage = useMemo(() => {
    const open = comments.filter((c) => c.status === "open");
    if (!open.length) return "";
    const lines = open.map((c) => {
      const index = deck.slides.findIndex((s) => s.id === c.slideId);
      const title = index >= 0 ? deck.slides[index].title : "slide";
      const spot = `titik ${Math.round(c.x * 100)}%, ${Math.round(c.y * 100)}%`;
      const target = c.selector ? ` pada elemen \`${c.selector}\`` : "";
      return `- Slide ${index + 1} — ${title} (${spot}${target}): ${c.body}`;
    });
    return `Tolong perbaiki deck ini berdasarkan catatan review berikut. Tulis ulang slide yang perlu, jangan cuma menjelaskan.\n\n${lines.join("\n")}`;
  }, [comments, deck.slides]);
  const busy = status === "generating";

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (selected?.id) void refreshRevisions(selected.id);
  }, [selected?.id, refreshRevisions]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, liveTools.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 4800);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveDeck(); }
      if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); setExportOpen(true); }
      if (mod && e.key === ",") { e.preventDefault(); setSettingsOpen(true); }
      if (!mod && e.key.toLowerCase() === "c" && !(e.target as HTMLElement)?.closest("input, textarea, .cv")) {
        e.preventDefault();
        setPinning((v) => !v);
        setRight("notes");
      }
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setTemplateOpen(false);
        setExportOpen(false);
        setPinAt(null);
        setPinning(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveDeck]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    await sendMessage(text);
    void refreshRevisions();
  }, [draft, busy, sendMessage, refreshRevisions]);

  const submitPin = async () => {
    if (!pinAt || !selected || !pinText.trim()) return;
    await addComment(selected.id, pinAt.x, pinAt.y, pinText.trim(), pinAt.selector);
    setPinText("");
    setPinAt(null);
    setPinning(false);
    setRight("notes");
  };

  const openSettings = async () => {
    setSettingsOpen(true);
  };

  const runExport = async () => {
    if (!deck.slides.length) return notify("info", "Belum ada slide untuk diexport.");
    setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 120));
      const { toPng } = await import("html-to-image");
      const visible = deck.slides
        .map((slide, index) => ({ slide, index }))
        .filter(({ slide }) => !slide.hidden);

      const pngs: { name: string; data: string }[] = [];
      const files: { name: string; encoding: "base64" | "utf8"; data: string }[] = [];

      for (const { slide, index } of visible) {
        const frame = frames.current[index];
        const body = frame?.contentDocument?.body;
        if (!body) throw new Error(`Render slide ${index + 1} belum siap, coba lagi.`);
        await (frame!.contentDocument!.fonts?.ready ?? Promise.resolve());
        const url = await toPng(body, {
          width: size.w,
          height: size.h,
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: "#111111",
        });
        const data = url.split(",")[1] ?? "";
        const name = `${String(index + 1).padStart(2, "0")}-${slug(slide.title || `slide-${index + 1}`)}.png`;
        pngs.push({ name, data });
        if (exportPng) files.push({ name, encoding: "base64", data });
      }

      if (exportPdf && pngs.length) {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({
          orientation: size.w > size.h ? "landscape" : "portrait",
          unit: "px",
          format: [size.w, size.h],
          compress: true,
        });
        pngs.forEach((p, i) => {
          if (i) pdf.addPage([size.w, size.h]);
          pdf.addImage(`data:image/png;base64,${p.data}`, "PNG", 0, 0, size.w, size.h, undefined, "FAST");
        });
        files.push({
          name: `${slug(deck.title)}.pdf`,
          encoding: "base64",
          data: pdf.output("datauristring").split(",")[1] ?? "",
        });
      }

      if (exportCaption) {
        const caption = [
          deck.caption || deck.title,
          deck.brandHandle ? `\n${deck.brandHandle}` : "",
          "",
          `${visible.length} slides · ${size.w}×${size.h}`,
          deck.styleGuide ? `\nArt direction: ${deck.styleGuide}` : "",
        ].join("\n");
        files.push({ name: "caption.txt", encoding: "utf8", data: caption });
      }

      const dir = await api.exportDefaultDir(slug(deck.title || "desel"));
      const result = await api.writeExport(dir, files, settings.exportDir);
      setExportOpen(false);
      notify("ok", `Export selesai — ${result.files.length} file ditulis.`);
    } catch (err) {
      notify("error", `Export gagal: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  if (!settingsLoaded) {
    return (
      <div className="boot">
        <img src="/desel-icon@2x.png" alt="Desel" />
        <small>Menyiapkan studio…</small>
      </div>
    );
  }

  return (
    <div className="app">
      {busy && <div className="progress-line" />}

      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/desel-icon@2x.png" alt="Desel" />
          <div>
            <div className="brand-name">Desel</div>
            <div className="brand-sub">Carousel Studio</div>
          </div>
        </div>

        <span className="topbar-divider" />

        <input
          className="title-input"
          value={deck.title}
          onChange={(e) => updateDeck({ title: e.target.value })}
          placeholder="Judul carousel"
          spellCheck={false}
        />

        <div className="topbar-actions">
          <span className={`pill ${busy ? "busy" : settings.apiKey ? "live" : ""}`} title={settings.baseUrl}>
            <span className="pill-dot" />
            {busy ? statusMessage || "Bekerja…" : settings.model || "belum ada model"}
          </span>
          <button className="btn btn-ghost btn-icon" title="Simpan (Ctrl+S)" onClick={() => void saveDeck()}>
            <Save size={15} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            title="Simpan desain sebagai template"
            onClick={() => {
              setTemplateName(deck.title);
              setTemplateOpen(true);
            }}
          >
            <Layers size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" title="Pengaturan (Ctrl+,)" onClick={() => void openSettings()}>
            <Settings2 size={15} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setExportOpen(true)}>
            <Download size={14} /> Export
          </button>
        </div>
      </header>

      <div className="workspace">
        {/* ---------------- left ---------------- */}
        <aside className="panel panel-left">
          <div className="tabs">
            <button className={`tab ${left === "chat" ? "active" : ""}`} onClick={() => setLeft("chat")}>
              <MessageSquare size={13} /> Chat
            </button>
            <button className={`tab ${left === "projects" ? "active" : ""}`} onClick={() => setLeft("projects")}>
              <FolderPlus size={13} /> Proyek
            </button>
            <button className={`tab ${left === "templates" ? "active" : ""}`} onClick={() => setLeft("templates")}>
              <Layers size={13} /> Template
            </button>
          </div>

          {left === "chat" && (
            <div className="chat">
              <div className="chat-log" ref={logRef}>
                {messages.length === 0 && (
                  <div className="chat-hello">
                    <h2>
                      Mau bikin apa <em>hari ini?</em>
                    </h2>
                    <p>
                      Kasih topik, audiens, atau referensi visual. Agent akan menanyakan hal yang belum jelas,
                      riset fakta kalau perlu, lalu menulis kode HTML/CSS/SVG tiap slide dari nol.
                    </p>
                    <div className="starters">
                      <button
                        className="starter"
                        onClick={() =>
                          setDraft(
                            "Bikin carousel 6 slide: kenapa developer Indonesia perlu personal site. Audiens developer junior. Tone tajam, visual editorial cetak, cover berani. Riset 2-3 fakta yang relevan.",
                          )
                        }
                      >
                        <span>Carousel editorial, 6 slide</span>
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="starter"
                        onClick={() =>
                          setDraft(
                            "Eksplor arah visual cover dulu, copy belum final. Topik: keamanan AI agent. Gaya poster kolase merah-hitam dengan halftone dan ghost type. Tanya satu hal penting sebelum mulai.",
                          )
                        }
                      >
                        <span>Eksplor arah visual cover</span>
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="starter"
                        onClick={() =>
                          setDraft(
                            "Kritik desain semua slide yang ada. Jangan ubah apa pun dulu — sebutkan bagian yang terasa generik dan konkretnya harus diapakan.",
                          )
                        }
                      >
                        <span>Kritik deck yang sekarang</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>
                    <button className="starter-ghost" onClick={() => void loadSample()}>
                      <LayoutTemplate size={14} />
                      <span>Muat contoh deck editorial</span>
                    </button>
                  </div>
                )}

                {turns.map((t) =>
                  t.kind === "user" ? (
                    <div className="msg user" key={t.id}>
                      <div className="msg-avatar">K</div>
                      <div className="msg-text">
                        <p>{t.text}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="msg agent" key={t.id}>
                      <div className="msg-avatar">
                        <Sparkles size={12} />
                      </div>
                      <div className="msg-text">
                        {t.text && <p>{t.text}</p>}
                        {t.steps.length > 0 && (
                          <details className="step-group">
                            <summary>
                              <span>{t.steps.length} langkah</span>
                              <span className="step-names">
                                {[...new Set(t.steps.map((c) => stepLabel(c.name)))].slice(0, 3).join(" · ")}
                                {t.steps.length > 3 ? " …" : ""}
                              </span>
                            </summary>
                            <div className="step-body">
                              {t.steps.map((c) => {
                                const result = toolResults.get(c.id) ?? "";
                                return (
                                  <div className="step done" key={c.id}>
                                    <span className="dot">
                                      <Check size={11} />
                                    </span>
                                    <span className="step-name">{stepLabel(c.name)}</span>
                                    {result && <code>{result.replace(/\s+/g, " ").slice(0, 150)}</code>}
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  ),
                )}

                {liveTools.length > 0 && (
                  <div className="agent-steps">
                    {liveTools.map((t) => (
                      <div className={`step ${t.state}`} key={t.id}>
                        <span className="dot">
                          {t.state === "done" ? <Check size={11} /> : t.state === "error" ? <X size={11} /> : <i />}
                        </span>
                        <span>{stepLabel(t.name)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {streamingText && (
                  <div className="msg agent">
                    <div className="msg-avatar">
                      <Sparkles size={12} />
                    </div>
                    <div className="msg-text">
                      <p>
                        {streamingText}
                        <i className="caret" />
                      </p>
                    </div>
                  </div>
                )}

                {busy && !streamingText && (
                  <div className="thinking">
                    <span className="pulse">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{statusMessage || "Agent sedang bekerja…"}</span>
                  </div>
                )}
              </div>

              <div className="refs">
                <div className="refs-head">
                  <span>Referensi visual</span>
                  <span className="refs-actions">
                    <button className="link" onClick={() => setRefUrlOpen((v) => !v)}>
                      Link
                    </button>
                    <button className="link" onClick={() => void pickReferences()}>
                      {references.length ? "Tambah" : "Lampirkan"}
                    </button>
                  </span>
                </div>
                {refUrlOpen && (
                  <div className="refs-url">
                    <input
                      autoFocus
                      value={refUrl}
                      placeholder="Tempel link gambar (Pinterest, Dribbble, ...)"
                      onChange={(e) => setRefUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitReferenceUrl();
                        if (e.key === "Escape") setRefUrlOpen(false);
                      }}
                    />
                    <button className="btn btn-sm" disabled={refBusy || !refUrl.trim()} onClick={() => void submitReferenceUrl()}>
                      {refBusy ? <span className="spin" /> : "Ambil"}
                    </button>
                  </div>
                )}
                {references.length === 0 ? (
                  <button className="refs-empty" onClick={() => void pickReferences()}>
                    <Pin size={13} />
                    <span>Lampirkan cover yang kamu suka — agent meniru grammar-nya, bukan menjiplak.</span>
                  </button>
                ) : (
                  <div className="refs-track">
                    {references.map((r) => (
                      <div
                        className="ref"
                        key={r.id}
                        title={
                          r.profile
                            ? `${r.name} · ${r.profile.width}×${r.profile.height} · ${r.profile.palette.join(" ")}`
                            : r.name
                        }
                      >
                        <img src={`data:${r.mime};base64,${r.data}`} alt={r.name} />
                        <button
                          className="ref-x"
                          title="Hapus referensi"
                          onClick={() => void removeReference(r.id)}
                        >
                          <X size={10} />
                        </button>
                        {r.profile && (
                          <span className="ref-dots">
                            {r.profile.palette.slice(0, 4).map((c) => (
                              <i key={c} style={{ background: c }} />
                            ))}
                          </span>
                        )}
                      </div>
                    ))}
                    <button className="ref-add" title="Tambah referensi" onClick={() => void pickReferences()}>
                      <Plus size={14} />
                    </button>
                  </div>
                )}
                {references.length > 0 && (
                  <p className="refs-note">
                    {settings.sendReferences
                      ? "Gambar dikirim ke model (vision aktif)."
                      : "Model menerima palet, kontras, dan ukuran. Aktifkan vision di Pengaturan kalau modelnya bisa melihat gambar."}
                  </p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    for (const file of files) {
                      const url = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result));
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                      }).catch(() => "");
                      if (url) await attachReferenceData(file.name, url);
                    }
                  }}
                />
              </div>

              <div className="composer">
                <div className="composer-box">
                  <textarea
                    ref={composerRef}
                    value={draft}
                    rows={1}
                    placeholder="Tulis brief atau revisi…"
                    onChange={(e) => {
                      setDraft(e.target.value);
                      const el = e.target;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-foot">
                    <span className="composer-hint">
                      {settings.enableResearch ? "Riset aktif" : "Riset nonaktif"} · {deck.slides.length} slide
                    </span>
                    <button className="send" disabled={!draft.trim() || busy} onClick={() => void send()} title="Kirim (Enter)">
                      {busy ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {left === "projects" && (
            <div className="panel-body">
              <div className="panel-section">
                <div className="section-title">
                  <span>Proyek tersimpan</span>
                  <span className="title-actions">
                    <button className="link" title="Buka deck contoh yang ditulis tangan" onClick={() => void loadSample()}>
                      Contoh
                    </button>
                    <button className="link" onClick={() => void newDeck()}>
                      Baru
                    </button>
                  </span>
                </div>
              </div>
              <div className="side-list">
                {decks.map((d) => (
                  <button
                    key={d.id}
                    className={`project-row ${d.id === deck.id ? "active" : ""}`}
                    onClick={() => void openDeck(d.id)}
                  >
                    <span className="project-swatch">{(d.title || "D").slice(0, 1).toUpperCase()}</span>
                    <span className="project-info">
                      <strong>{d.title || "Tanpa judul"}</strong>
                      <span>
                        {d.slideCount} slide · {when(d.updatedAt)}
                      </span>
                    </span>
                    <span className="project-tools">
                      <span
                        className="icon-btn"
                        title="Duplikat"
                        onClick={(e) => {
                          e.stopPropagation();
                          void duplicateDeck(d.id);
                        }}
                      >
                        <Copy size={13} />
                      </span>
                      <span
                        className="icon-btn"
                        title="Hapus"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteDeck(d.id);
                        }}
                      >
                        <Trash2 size={13} />
                      </span>
                    </span>
                  </button>
                ))}
                {!decks.length && <div className="empty-note">Belum ada proyek. Mulai dari chat atau tombol Baru.</div>}
              </div>
            </div>
          )}

          {left === "templates" && (
            <div className="panel-body">
              <div className="panel-section">
                <div className="section-title">
                  <span>Design system tersimpan</span>
                  <button className="link" onClick={() => { setTemplateName(deck.title); setTemplateOpen(true); }}>
                    Simpan ini
                  </button>
                </div>
                <p style={{ margin: 0, color: "var(--text-3)", fontSize: 11.5, lineHeight: 1.6 }}>
                  Template cuma titik mulai. Agent tetap bebas menulis ulang semuanya.
                </p>
              </div>
              <div style={{ padding: "0 12px 16px" }}>
                {templates.map((t) => (
                  <div className="template-row" key={t.id}>
                    <button onClick={() => void newDeck(t.id)}>
                      <span className="template-glyph">{t.name.slice(0, 1).toUpperCase()}</span>
                      <span style={{ minWidth: 0 }}>
                        <strong>{t.name}</strong>
                        <small>
                          {t.deck.slides.length} slide · {t.deck.aspect}
                        </small>
                      </span>
                    </button>
                    <span className="icon-btn" title="Hapus template" onClick={() => void deleteTemplate(t.id)}>
                      <Trash2 size={13} />
                    </span>
                  </div>
                ))}
                {!templates.length && <div className="empty-note">Belum ada template. Simpan deck yang sudah jadi.</div>}
              </div>
            </div>
          )}
        </aside>

        {/* ---------------- stage ---------------- */}
        <main className="stage">
          <div className="stage-bar">
            <div className="stage-title">
              {selected ? (
                <>
                  <strong>{selected.title || "Slide"}</strong>
                  <span style={{ color: "var(--text-3)", fontSize: 11 }}>
                    {deck.slides.indexOf(selected) + 1}/{deck.slides.length}
                  </span>
                </>
              ) : (
                <strong>Canvas</strong>
              )}
            </div>

            <div className="stage-bar-actions">
              <label style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
                <select
                  value={deck.aspect}
                  onChange={(e) => updateDeck({ aspect: e.target.value as Deck["aspect"] })}
                  style={{
                    appearance: "none",
                    height: 28,
                    padding: "0 22px 0 9px",
                    borderRadius: 6,
                    border: "1px solid var(--line-strong)",
                    background: "#ffffff07",
                    color: "var(--text)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {ASPECTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} style={{ position: "absolute", right: 7, pointerEvents: "none", color: "var(--text-2)" }} />
              </label>

            </div>
          </div>

          <div className="stage-area">
            {!deck.slides.length ? (
              <div className="empty-stage">
                <img className="mark" src="/desel-icon@2x.png" alt="" />
                <h1>Mulai dari satu sudut pandang.</h1>
                <p>
                  Belum ada slide. Ceritakan subjek, audiens, dan rasa visual yang kamu mau —
                  agent akan menyusun design system lalu menulis tiap slide sebagai kode asli.
                </p>
                <button className="btn btn-primary" onClick={() => { setLeft("chat"); composerRef.current?.focus(); }}>
                  <Wand2 size={14} /> Tulis brief
                </button>
              </div>
            ) : selected ? (
              <Canvas
                doc={safeDoc(selected.html, size.w, size.h)}
                slideKey={selected.id}
                width={size.w}
                height={size.h}
                notes={slideNotes}
                pinning={pinning}
                activeNoteId={activeCommentId}
                onTogglePinning={() => {
                  setPinning((v) => !v);
                  setRight("notes");
                }}
                onRequestPin={(x, y, selector) => setPinAt({ x, y, selector })}
                onSelectNote={(id) => {
                  setRight("notes");
                  setActiveComment(id);
                }}
                onEditHtml={(html) => {
                  updateSlide(selected.id, { html });
                  notify("ok", "Teks di canvas diperbarui.");
                }}
                onNotify={(text) => notify("info", text)}
              />
            ) : null}

            {pinAt && (
              <div
                className="overlay"
                style={{ background: "transparent", backdropFilter: "none", placeItems: "start end", padding: 0 }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setPinAt(null);
                }}
              >
                <div className="modal" style={{ width: 300, margin: "0 24px 24px 0" }}>
                  <div className="modal-head">
                    <h2 style={{ fontSize: 19 }}>Catatan baru</h2>
                    <button className="icon-btn" onClick={() => setPinAt(null)}>
                      <X size={15} />
                    </button>
                  </div>
                  <p className="modal-sub">Nempel di titik ini. Agent bisa membacanya saat revisi.</p>
                  <div className="field">
                    <span>Komentar</span>
                    <textarea
                      autoFocus
                      value={pinText}
                      onChange={(e) => setPinText(e.target.value)}
                      placeholder="Contoh: headline terlalu kecil, naikin 20%."
                      style={{ minHeight: 88 }}
                    />
                  </div>
                  <div className="modal-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPinAt(null)}>
                      Batal
                    </button>
                    <button className="btn btn-primary btn-sm" disabled={!pinText.trim()} onClick={() => void submitPin()}>
                      Tambah
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rail">
            <div className="rail-head">
              <span className="label">Sequence · {deck.slides.length} slide</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="btn btn-ghost btn-tiny" onClick={() => selected && duplicateSlide(selected.id)} disabled={!selected}>
                  <Copy size={12} /> Duplikat
                </button>
                <button className="btn btn-ghost btn-tiny" onClick={() => selected && deleteSlide(selected.id)} disabled={!selected}>
                  <Trash2 size={12} /> Hapus
                </button>
                <button className="btn btn-sm" onClick={addSlide}>
                  <Plus size={13} /> Slide
                </button>
              </div>
            </div>
            <div className="rail-track">
              {deck.slides.map((s, i) => (
                <Thumb
                  key={s.id}
                  slide={s}
                  index={i}
                  deck={deck}
                  issues={lints[s.id]}
                  onReorder={reorderSlide}
                  active={s.id === selected?.id}
                  onSelect={() => selectSlide(s.id)}
                  onMove={(dir) => moveSlide(s.id, dir)}
                />
              ))}
              {deck.slides.length > 0 && (
                <button className="thumb-add" onClick={addSlide}>
                  <Plus size={16} />
                  <span>Slide</span>
                </button>
              )}
            </div>
          </div>
        </main>

        {/* ---------------- right ---------------- */}
        <aside className="panel panel-right">
          <div className="tabs">
            <button className={`tab ${right === "design" ? "active" : ""}`} onClick={() => setRight("design")}>
              <Palette size={13} /> Desain
            </button>
            <button className={`tab ${right === "source" ? "active" : ""}`} onClick={() => setRight("source")}>
              <Code2 size={13} /> Kode
            </button>
            <button className={`tab ${right === "notes" ? "active" : ""}`} onClick={() => setRight("notes")}>
              <MessageSquare size={13} /> Catatan
              {openNotes > 0 && <span className="tab-count">{openNotes}</span>}
            </button>
          </div>

          {right === "design" && (
            <div className="panel-body">
              <div className="panel-section">
                <div className="section-title">Dokumen</div>
                <label className="field">
                  <span>Judul</span>
                  <input value={deck.title} onChange={(e) => updateDeck({ title: e.target.value })} placeholder="Judul carousel" />
                </label>
                <label className="field">
                  <span>Caption siap posting</span>
                  <textarea
                    value={deck.caption}
                    onChange={(e) => updateDeck({ caption: e.target.value })}
                    placeholder="Hook + isi + hashtag"
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Format</span>
                    <select value={deck.aspect} onChange={(e) => updateDeck({ aspect: e.target.value as Deck["aspect"] })}>
                      {ASPECTS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Brand handle</span>
                    <input
                      value={deck.brandHandle}
                      onChange={(e) => updateDeck({ brandHandle: e.target.value })}
                      placeholder="@brand"
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Label CTA</span>
                  <input value={deck.saveLabel} onChange={(e) => updateDeck({ saveLabel: e.target.value })} placeholder="Save this post" />
                </label>
              </div>

              <div className="panel-section">
                <div className="section-title">Art direction</div>
                <label className="field">
                  <span>Design system yang dipakai</span>
                  <textarea
                    value={deck.styleGuide}
                    onChange={(e) => updateDeck({ styleGuide: e.target.value })}
                    placeholder="Belum ditetapkan. Agent akan mengisinya saat mulai mendesain."
                    style={{ minHeight: 108 }}
                  />
                  <small>Agent membaca ini supaya semua slide tetap satu bahasa visual.</small>
                </label>
                {deck.palette.length > 0 && (
                  <div className="field">
                    <span>Palet</span>
                    <div className="swatches">
                      {deck.palette.map((c) => (
                        <span key={c} className="swatch" style={{ background: c }} title={c} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {selected && (
                <div className="panel-section">
                  <div className="section-title">Slide terpilih</div>
                  <label className="field">
                    <span>Nama slide</span>
                    <input value={selected.title} onChange={(e) => updateSlide(selected.id, { title: e.target.value })} />
                  </label>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => moveSlide(selected.id, -1)}>
                      <ChevronLeft size={13} /> Maju
                    </button>
                    <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => moveSlide(selected.id, 1)}>
                      Mundur <ChevronRight size={13} />
                    </button>
                  </div>
                  <button
                    className="link"
                    style={{ marginTop: 8, alignSelf: "flex-start" }}
                    onClick={() => {
                      const index = deck.slides.findIndex((s) => s.id === selected.id);
                      const notes = comments.filter((c) => c.slideId === selected.id && c.status === "open");
                      const extra = notes.length ? ` Catatan: ${notes.map((c) => c.body).join("; ")}` : "";
                      setDraft(`Revisi slide ${index + 1} (${selected.title}): ${extra}`.trim());
                      composerRef.current?.focus();
                    }}
                  >
                    Minta revisi slide ini
                  </button>
                </div>
              )}

              {selected && (
                <div className="panel-section">
                  <div className="section-title">
                    <span>Pemeriksaan desain</span>
                    <span className="lint-count">{(lints[selected.id] ?? []).length || "bersih"}</span>
                  </div>
                  {(lints[selected.id] ?? []).length === 0 ? (
                    <p className="lint-clean">
                      Tidak ada temuan: kanvas, palet, tekstur, dan hierarki lolos pemeriksaan.
                    </p>
                  ) : (
                    <ul className="lint-list">
                      {(lints[selected.id] ?? []).map((issue) => (
                        <li key={issue.rule} className={`lint-item ${issue.severity}`}>
                          <span className="lint-dot" />
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selected && revisions.length > 0 && (
                <div className="panel-section">
                  <div className="section-title">
                    <span>Riwayat slide</span>
                    <span className="lint-count">{revisions.length}</span>
                  </div>
                  <ul className="rev-list">
                    {revisions.slice(0, 6).map((rev) => (
                      <li key={rev.id} className="rev-row">
                        <span className="rev-when">{when(rev.createdAt)}</span>
                        <span className="rev-size">{Math.round(rev.html.length / 100) / 10}k</span>
                        <button className="link" onClick={() => void restoreRevision(rev.id)}>
                          Pulihkan
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="rev-hint">Tersimpan otomatis tiap kali sebuah slide ditulis ulang.</p>
                </div>
              )}
            </div>
          )}

          {right === "source" && (
            <div className="source">
              {selected ? (
                <>
                  <div className="panel-section" style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="section-title" style={{ marginBottom: 0 }}>
                      <span>{selected.title || "Slide"}</span>
                      <span style={{ color: "var(--text-3)", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                        HTML
                      </span>
                    </div>
                  </div>
                  <textarea
                    value={selected.html}
                    spellCheck={false}
                    onChange={(e) => updateSlide(selected.id, { html: e.target.value })}
                  />
                  <div className="source-foot">
                    <span>Perubahan tersimpan otomatis</span>
                    <span>{selected.html.length.toLocaleString()} char</span>
                  </div>
                  {selected.rationale && <div className="rationale">{selected.rationale}</div>}
                </>
              ) : (
                <div className="empty-note">Pilih slide untuk melihat kodenya.</div>
              )}
            </div>
          )}

          {right === "notes" && (
            <div className="panel-body">
              <div className="panel-section">
                <div className="section-title">
                  <span>Review · {slideNotes.length}</span>
                  <span className="title-actions">
                    <button
                      className="link"
                      disabled={!openNotes}
                      title={openNotes ? "Kirim semua catatan terbuka ke agent" : "Belum ada catatan terbuka"}
                      onClick={() => {
                        setDraft(reviewMessage);
                        composerRef.current?.focus();
                      }}
                    >
                      Kirim ke agent
                    </button>
                    <button className="link" onClick={() => setPinning(true)}>
                      Pin baru
                    </button>
                  </span>
                </div>
                <p style={{ margin: 0, color: "var(--text-3)", fontSize: 11.5, lineHeight: 1.6 }}>
                  Klik ikon pin di toolbar canvas, lalu tandai titik yang mau dikomentari.
                </p>
              </div>
              <div style={{ padding: "0 16px 16px" }}>
                {slideNotes.map((c, i) => (
                  <div className={`note ${c.status}`} key={c.id}>
                    <span className="note-index">{i + 1}</span>
                    <div className="note-body">
                      <p>{c.body}</p>
                      <div className="note-meta">
                        <span>{c.author === "agent" ? "Agent" : "Kamu"}</span>
                        <button onClick={() => void setCommentStatus(c.id, c.status === "open" ? "resolved" : "open")}>
                          {c.status === "open" ? "Selesai" : "Buka lagi"}
                        </button>
                        <button className="danger" onClick={() => void deleteComment(c.id)}>
                          Hapus
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {!slideNotes.length && <div className="empty-note">Belum ada catatan di slide ini.</div>}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* offscreen renderers used by export */}
      <div className="offscreen" aria-hidden>
        {deck.slides.map((s, i) => (
          <iframe
            key={s.id}
            ref={(el) => {
              frames.current[i] = el;
            }}
            title={`render-${i}`}
            sandbox="allow-same-origin"
            srcDoc={safeDoc(s.html, size.w, size.h)}
            style={{ width: size.w, height: size.h }}
          />
        ))}
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}

      {templateOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setTemplateOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <h2>Simpan design system</h2>
              <button className="icon-btn" onClick={() => setTemplateOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <p className="modal-sub">
              Menyimpan slide dan art direction sebagai titik mulai. Desain berikutnya tetap bebas berubah total.
            </p>
            <label className="field">
              <span>Nama</span>
              <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Misal: Editorial kaos kaki" />
            </label>
            <label className="field">
              <span>Catatan pemakaian</span>
              <textarea value={templateNote} onChange={(e) => setTemplateNote(e.target.value)} placeholder="Cocok untuk…" />
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setTemplateOpen(false)}>
                Batal
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!templateName.trim()}
                onClick={async () => {
                  await saveTemplate(templateName.trim(), templateNote.trim());
                  setTemplateOpen(false);
                  setTemplateNote("");
                }}
              >
                <Save size={13} /> Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setExportOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <h2>Export</h2>
              <button className="icon-btn" onClick={() => setExportOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <p className="modal-sub">
              Dirender dari HTML yang sama dengan preview, jadi hasilnya identik.
            </p>
            <div className="export-list">
              <label className="export-option">
                <input type="checkbox" checked={exportPng} onChange={(e) => setExportPng(e.target.checked)} />
                <span className="info">
                  <strong>PNG per slide</strong>
                  <small>
                    {deck.slides.length} gambar · {size.w} × {size.h}
                  </small>
                </span>
                <ImageDown size={16} />
              </label>
              <label className="export-option">
                <input type="checkbox" checked={exportPdf} onChange={(e) => setExportPdf(e.target.checked)} />
                <span className="info">
                  <strong>PDF deck</strong>
                  <small>Satu halaman per slide</small>
                </span>
                <FileText size={16} />
              </label>
              <label className="export-option">
                <input type="checkbox" checked={exportCaption} onChange={(e) => setExportCaption(e.target.checked)} />
                <span className="info">
                  <strong>Caption & catatan</strong>
                  <small>File teks pendamping</small>
                </span>
                <MessageSquare size={16} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setExportOpen(false)}>
                Batal
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={exporting || (!exportPng && !exportPdf && !exportCaption)}
                onClick={() => void runExport()}
              >
                {exporting ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                {exporting ? "Merender…" : "Export"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} onClick={clearToast}>
          {toast.kind === "error" ? <X size={14} /> : <Check size={14} />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                     */
/* -------------------------------------------------------------------------- */

function Thumb({
  slide,
  index,
  deck,
  active,
  issues,
  onSelect,
  onMove,
  onReorder,
}: {
  slide: Slide;
  index: number;
  deck: Deck;
  active: boolean;
  issues?: LintIssue[];
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onReorder: (id: string, to: number) => void;
}) {
  const [over, setOver] = useState(false);
  const size = aspectSize(deck.aspect);
  const width = 62;
  const height = Math.round((width * size.h) / size.w);
  return (
    <button
      className={`thumb ${active ? "active" : ""} ${over ? "over" : ""}`}
      draggable
      onClick={onSelect}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/desel-slide", slide.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("text/desel-slide")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/desel-slide");
        if (id) onReorder(id, index);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMove(e.shiftKey ? -1 : 1);
      }}
      title={`${slide.title} — geser untuk ubah urutan`}
    >
      <span className="thumb-frame" style={{ height }}>
        <iframe title={`thumb-${index}`} sandbox="allow-same-origin" srcDoc={safeDoc(slide.html, size.w, size.h)} />
        <span className="thumb-num">{index + 1}</span>
        {issues && issues.length > 0 && (
          <span
            className={`thumb-lint ${issues.some((i) => i.severity === "error") ? "bad" : ""}`}
            title={issues.map((i) => i.message).join("\n")}
          >
            {issues.length}
          </span>
        )}
      </span>
      <span className="thumb-title">{slide.title || "Slide"}</span>
    </button>
  );
}

function SettingsModal({
  settings,
  onClose,
  onSave,
}: {
  settings: ReturnType<typeof useStudio.getState>["settings"];
  onClose: () => void;
  onSave: (patch: Partial<ReturnType<typeof useStudio.getState>["settings"]>) => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<"idle" | "busy" | "ok" | "bad">("idle");
  const [testMsg, setTestMsg] = useState("");

  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const loadModels = async () => {
    try {
      setModels(await api.listModels());
    } catch {
      setModels([]);
    }
  };

  const runTest = async () => {
    setTest("busy");
    setTestMsg("");
    try {
      const res = (await api.testConnection()) as { provider?: string; model?: string };
      setTest("ok");
      setTestMsg(`${res.provider ?? "Provider"} · ${res.model ?? form.model}`);
    } catch (err) {
      setTest("bad");
      setTestMsg(String(err).slice(0, 160));
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h2>Pengaturan</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="modal-sub">Tersimpan di database lokal aplikasi — tetap ada setelah app ditutup.</p>

        <div className="presets">
          {PROVIDERS.map((p) => (
            <button
              key={p.label}
              className={`chip ${form.baseUrl.replace(/\/+$/, "") === p.baseUrl ? "on" : ""}`}
              onClick={() => patch({ baseUrl: p.baseUrl, model: form.model.trim() || p.model })}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Base URL (OpenAI-compatible)</span>
          <input value={form.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
        </label>

        <label className="field">
          <span>API key</span>
          <div className="inline-input">
            <input
              type={showKey ? "text" : "password"}
              value={form.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
              placeholder="sk-…"
            />
            <button onClick={() => setShowKey((v) => !v)} title={showKey ? "Sembunyikan" : "Tampilkan"}>
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Model</span>
            <div className="inline-input">
              <input value={form.model} onChange={(e) => patch({ model: e.target.value })} list="model-list" placeholder="gpt-4o-mini" />
              <button title="Ambil daftar model" onClick={() => void loadModels()}>
                <RefreshCw size={12} />
              </button>
            </div>
            <datalist id="model-list">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Temperature · {form.temperature.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={form.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
              style={{ accentColor: "var(--accent)", width: "100%", height: 32 }}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Brand handle</span>
            <input value={form.brandHandle} onChange={(e) => patch({ brandHandle: e.target.value })} placeholder="@brand" />
          </label>
          <label className="field">
            <span>Folder export</span>
            <input value={form.exportDir ?? ""} onChange={(e) => patch({ exportDir: e.target.value || null })} placeholder="Default: Pictures/Desel" />
          </label>
        </div>

        <div style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 6 }}>
          <label className="check">
            <input type="checkbox" checked={form.enableResearch} onChange={(e) => patch({ enableResearch: e.target.checked })} />
            <span>
              <strong>Riset web</strong>
              <small>Cari dan baca halaman publik untuk verifikasi fakta.</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.enableFileTools} onChange={(e) => patch({ enableFileTools: e.target.checked })} />
            <span>
              <strong>Tool agent</strong>
              <small>Izinkan agent mengubah slide dan menyimpan design system.</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.sendReferences} onChange={(e) => patch({ sendReferences: e.target.checked })} />
            <span>
              <strong>Model bisa melihat gambar</strong>
              <small>
                Kirim gambar referensi apa adanya ke model (butuh model vision: GPT-4o, Claude, Gemini, Qwen-VL).
                Kalau mati, agent tetap menerima palet, kontras, dan ukuran tiap referensi dalam bentuk teks.
              </small>
            </span>
          </label>
        </div>

        <div className={`check-line ${test === "ok" ? "ok" : test === "bad" ? "bad" : ""}`}>
          <span className="dot" />
          <span>{test === "busy" ? "Menguji koneksi…" : testMsg || "Belum diuji"}</span>
          <button className="btn btn-ghost btn-tiny" style={{ marginLeft: "auto" }} onClick={() => void runTest()} disabled={test === "busy"}>
            Tes koneksi
          </button>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              await onSave(form);
              onClose();
            }}
          >
            <Check size={13} /> Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function safeDoc(input: string, width: number, height: number) {
  let html = (input || "").trim();
  if (!html) {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:${width}px;height:${height}px;background:#111"></body></html>`;
  }
  // Strip anything executable; slides are static design only.
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/<link\b[^>]*>/gi, "");

  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  }
  // Guarantee the document fills the artboard even if the model forgot.
  const base = `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;}*{box-sizing:border-box;}</style>`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`) : `${base}${html}`;
  return html;
}

function slug(v: string) {
  return (
    v
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "desel"
  );
}

function when(iso: string) {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "baru";
  const diff = Math.max(0, Date.now() - d);
  if (diff < 60_000) return "baru saja";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} mnt lalu`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function stepLabel(name: string) {
  const map: Record<string, string> = {
    search_web: "Mencari referensi & fakta",
    fetch_url: "Membaca sumber",
    read_deck: "Membaca deck",
    set_deck_meta: "Menetapkan art direction",
    write_slide: "Menulis slide",
    delete_slide: "Menghapus slide",
    save_template: "Menyimpan design system",
    load_template: "Memuat design system",
    list_templates: "Melihat design system",
    ask_user: "Bertanya",
  };
  return map[name] ?? name.replace(/_/g, " ");
}
