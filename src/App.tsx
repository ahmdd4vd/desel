import {ProductionReview} from "./components/ProductionReview";
import {productionBundle} from "./lib/production-bundle";
import {CreatorMemory} from "./components/CreatorMemory";
import {CreatorRuns} from "./components/CreatorRuns";
import {ChatMarkdown} from "./components/ChatMarkdown";
import {useCreatorWorkspace} from "./hooks/useCreatorWorkspace";
import type {ChatScope} from "./lib/creator-workspace";
import {useDialogFocus} from "./hooks/useDialogFocus";
import {createAssetCopySaver} from './lib/asset-copy';
import {inspectExport,exportRevision,type ExportPreflight} from "./lib/export-preflight";
import pkg from "../package.json";
import {safeDoc} from "./lib/safe-doc";
import {ProviderManager} from "./components/ProviderManager";
import {evaluateLayoutCandidate} from "./lib/layout-candidate";
import {reviewRevision,measureRevision} from "./lib/render-review";
import {measureOverlapIssues} from "./lib/geometry";
import {ProjectReview} from './components/ProjectReview';
import {AspectChange} from './components/AspectChange';
import {SlideSearch} from './components/SlideSearch';
import {SlideOrganizer} from './components/SlideOrganizer';
import {Presentation} from './components/Presentation';
import {PaletteEditor} from './components/PaletteEditor';
import {RevisionCompare} from './components/RevisionCompare';
import {BrandLibrary} from './components/BrandLibrary';
import {AssetLibrary} from './components/AssetLibrary';
import {AssetEditor} from './components/AssetEditor';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ArrowRight,
  Square,
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
  LayoutGrid,
  Layers,
  ImageDown,
  LayoutTemplate,
  Loader2,
  Maximize2,
  MessageSquare,
  Paperclip,
  MousePointer2,
  Type,
  MoreHorizontal,
  Minus,
  Palette,
  PanelRight,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Scan,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
  X,
  StickyNote, ClipboardCheck,
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
import { reflowSlideHtml } from "./lib/reflow";
import { buildVariantProjects } from "./lib/variant-package";
import Canvas from "./components/Canvas";
import Board from "./components/Board";
import { useStudio } from "./state/studio";
import { activeMessages, siblings } from "./lib/chat-branches";

type LeftTab = "chat" | "projects" | "templates";
type RightTab = "design" | "source" | "notes";

/** One conversation turn: all assistant segments until the next user message. */
type Turn =
  | { kind: "user"; id: string; text: string }
  | { kind: "agent"; id: string; text: string; reasoning:string; steps: ToolCallRecord[] };


function buildTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pending: { id: string; parts: string[]; reasoning:string[]; steps: ToolCallRecord[] } | null = null;
  const flush = () => {
    if (!pending) return;
    turns.push({
      kind: "agent",
      id: pending.id,
      text: pending.parts.filter(Boolean).join(" ").trim(),
      steps: pending.steps,
      reasoning:pending.reasoning.join("\n"),
    });
    pending = null;
  };
  for (const m of messages) {
    if (m.role === "user") {
      flush();
      turns.push({ kind: "user", id: m.id, text: m.content });
    } else if (m.role === "assistant") {
      // Tool-only responses arrive as separate messages; one bubble per turn.
      pending ??= { id: m.id, parts: [], reasoning:[],steps: [] };
      if(m.reasoningContent)pending.reasoning.push(m.reasoningContent);
      if (m.content.trim()) pending.parts.push(m.content.trim());
      if (m.toolCalls?.length) pending.steps.push(...m.toolCalls);
    }
  }
  flush();
  return turns;
}

/** One-click endpoints, so nobody has to know the base URL by heart. */
const PROVIDERS = [
  { label: "Magpie", baseUrl: "http://127.0.0.1:3425/v1", model: "", kind: "magpie-managed" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
];

/**
 * Capture a rendered slide as PNG data, preserving mix-blend-mode layers.
 * html-to-image serialises to SVG foreignObject, where blend modes are
 * silently dropped, so we capture the content and each blend layer
 * separately and composite them on a 2D canvas, which understands the
 * same blend operators.
 */
async function captureSlidePng(
  toPng: (node: HTMLElement, options?: Record<string, unknown>) => Promise<string>,
  doc: Document,
  w: number,
  h: number,
): Promise<string> {
  const body = doc.body;
  const rootEl = doc.documentElement;
  const win = doc.defaultView!;
  const bodyBg = win.getComputedStyle(body).backgroundColor;
  const rootBg = win.getComputedStyle(rootEl).backgroundColor;
  const isTransparent = (c: string) => c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const pageBg = !isTransparent(bodyBg) ? bodyBg : !isTransparent(rootBg) ? rootBg : null;

  const blendEls = Array.from(body.querySelectorAll<HTMLElement>("*")).filter(
    (el) => win.getComputedStyle(el).mixBlendMode !== "normal",
  );

  if (!blendEls.length) {
    return toPng(body, { width: w, height: h, pixelRatio: 1, cacheBust: true, backgroundColor: pageBg ?? undefined });
  }

  type Undo = () => void;
  const undos: Undo[] = [];
  const setBg = (el: HTMLElement) => {
    const css=el.getAttribute("style");undos.push(() => { if(css===null)el.removeAttribute("style");else el.setAttribute("style",css); });
    el.style.setProperty("background", "transparent", "important");
  };

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("layer gagal dimuat"));
      img.src = src;
    });

  try {
    // Content layer without the blend overlays, on a transparent page.
    const removed = blendEls.map((el) => {
      const parent = el.parentNode!;
      const next = el.nextSibling;
      parent.removeChild(el);
      return { parent, next, el };
    });
    removed.forEach(({ parent, next, el }) => void undos.push(() => parent.insertBefore(el, next)));
    setBg(body);
    setBg(rootEl);
    const contentUrl = await toPng(body, { width: w, height: h, pixelRatio: 1, cacheBust: true });
    removed.reverse().forEach(({ parent, next, el }) => parent.insertBefore(el, next));

    // Blend overlays. html-to-image's foreignObject path mis-handles the
    // grain texture's SVG filter (feTurbulence): an as-is capture applies the
    // blend with opacity and pixel alpha ignored (uniform darkening), and an
    // isolated capture loses the filter entirely. Data-URI SVG backgrounds
    // are therefore rasterised natively (the browser's own SVG rasteriser
    // evaluates the filter correctly) and tiled over the element's rect on
    // the composite canvas, where the 2D context applies blend mode and
    // opacity with correct alpha math. Blend content without a data-URI SVG
    // background falls back to an isolated flat capture.
    type NativeOverlay = { uri: string; x: number; y: number; w: number; h: number };
    const overlays: { mode: string; opacity: number; url?: string; native?: NativeOverlay }[] = [];
    for (const el of blendEls) {
      const cs = win.getComputedStyle(el);
      const mode = cs.mixBlendMode;
      const opacity = parseFloat(cs.opacity || "1");
      // The URI itself may contain single quotes (xmlns='...'), so match the
      // quoted forms explicitly instead of excluding quotes from the payload.
      const bgMatch = cs.backgroundImage.match(/url\((?:"(data:[^"]+)"|'(data:[^']+)'|([^)]+))\)/);
      const bgUri = bgMatch?.[1] ?? bgMatch?.[2] ?? bgMatch?.[3];
      if (bgUri?.startsWith("data:image/svg+xml,") && (cs.backgroundSize === "auto" || cs.backgroundSize === "auto auto")) {
        const rect = el.getBoundingClientRect();
        overlays.push({ mode, opacity, native: { uri: bgUri, x: rect.left, y: rect.top, w: rect.width, h: rect.height } });
        continue;
      }
      const savedCss=el.getAttribute("style");
      const restoreStyle=()=>{if(savedCss===null)el.removeAttribute("style");else el.setAttribute("style",savedCss)};
      undos.push(restoreStyle);
      el.style.setProperty("mix-blend-mode", "normal", "important");
      el.style.setProperty("opacity", "1", "important");
      const parent = el.parentNode!;
      const siblings = Array.from(parent.children).filter((c) => c !== el) as HTMLElement[];
      const styles = siblings.map((s) => s.getAttribute("style"));
      siblings.forEach((s) => s.style.setProperty("visibility","hidden","important"));
      let url:string;
      try{url = await toPng(body, { width: w, height: h, pixelRatio: 1, cacheBust: true });}
      finally{siblings.forEach((s,i)=>{const css=styles[i];if(css===null)s.removeAttribute("style");else s.setAttribute("style",css)});restoreStyle();}
      overlays.push({ mode, opacity, url });
    }

    const canvas = doc.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    if (pageBg) {
      ctx.fillStyle = pageBg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(await loadImage(contentUrl), 0, 0);
    for (const overlay of overlays) {
      ctx.globalCompositeOperation = overlay.mode as GlobalCompositeOperation;
      ctx.globalAlpha = overlay.opacity;
      if (overlay.native) {
        const img = await loadImage(overlay.native.uri);
        const pat = ctx.createPattern(img, "repeat");
        if (pat) {
          ctx.save();
          ctx.translate(overlay.native.x, overlay.native.y);
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, overlay.native.w, overlay.native.h);
          ctx.restore();
        }
      } else if (overlay.url) {
        ctx.drawImage(await loadImage(overlay.url), 0, 0);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    return canvas.toDataURL("image/png");
  } finally {
    for (let i = undos.length - 1; i >= 0; i--) undos[i]();
  }
}

export default function App() {
  const boot = useStudio((s) => s.boot);
  const deck = useStudio((s) => s.deck);
  const decks = useStudio((s) => s.decks);
  const templates = useStudio((s) => s.templates);
  const allMessages = useStudio((s) => s.messages);
  const branches = useStudio((s) => s.branches);
  const messages = useMemo(() => activeMessages(branches, allMessages), [branches, allMessages]);

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
  const streamingReasoning=useStudio(s=>s.streamingReasoning);
  const streamingText = useStudio((s) => s.streamingText);
  const liveTools = useStudio((s) => s.liveTools);
  const toast = useStudio((s) => s.toast);
  const openDeck = useStudio((s) => s.openDeck);
  const newDeck = useStudio((s) => s.newDeck);
  const loadSample = useStudio((s) => s.loadSample);
  const duplicateDeck = useStudio((s) => s.duplicateDeck);
  const deleteDeck = useStudio((s) => s.deleteDeck);
  const recoverableDraft=useStudio(s=>s.recoverableDraft);
  const recoveringDraft=useStudio(s=>s.recoveringDraft);
  const savingRecoveryCopy=useStudio(s=>s.savingRecoveryCopy);
  const recoverLocalDraft=useStudio(s=>s.recoverLocalDraft);
  const dismissLocalDraft=useStudio(s=>s.dismissLocalDraft);
  const draftWarning=useStudio(s=>s.draftWarning);
  const saveState=useStudio(s=>s.saveState);
  const saveError=useStudio(s=>s.saveError);
  const saveRecoveryCopy=useStudio(s=>s.saveRecoveryCopy);
  const historyCounts=useStudio(s=>s.historyCounts);
  const stepHistory=useStudio(s=>s.stepHistory);
  const refreshHistory=useStudio(s=>s.refreshHistory);
  useEffect(()=>{void refreshHistory();},[deck.id,refreshHistory]);
  useEffect(()=>{void useStudio.getState().refreshBranches();},[deck.id,allMessages.length===0]);
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
  const mergeGeometryLints = useStudio((s) => s.mergeGeometryLints);
  const stopAgent = useStudio((s) => s.stopAgent);
  const revisions = useStudio((s) => s.revisions);
  const bootError=useStudio(s=>s.bootError);
  const reviewHistory=useStudio(s=>s.reviewHistory);
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
  const [noteMutationBusy,setNoteMutationBusy]=useState("");
  const noteMutationRef=useRef(false);
  const mutateNote=async(id:string,operation:()=>Promise<void>)=>{if(noteMutationRef.current)return;noteMutationRef.current=true;setNoteMutationBusy(id);try{await operation()}catch(err){useStudio.getState().notify("error",`Catatan belum diperbarui: ${String(err)}`)}finally{noteMutationRef.current=false;setNoteMutationBusy("")}};
  const saveSettings = useStudio((s) => s.saveSettings);
  const notify = useStudio((s) => s.notify);
  const activeCommentId = useStudio((s) => s.activeCommentId);
  const setActiveComment = useStudio((s) => s.setActiveComment);
  const clearToast = useStudio((s) => s.clearToast);

  const [projectQuery,setProjectQuery]=useState("");
  const [deleteRequest,setDeleteRequest]=useState<{kind:"project"|"template";id:string;title:string}|null>(null);
  const [deleting,setDeleting]=useState(false);
  const deletionDialog=useRef<HTMLDivElement>(null);
  const deletingRef=useRef(false);deletingRef.current=deleting;
  useEffect(()=>{if(!deleteRequest)return;const previous=document.activeElement as HTMLElement|null;deletionDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();const key=(e:KeyboardEvent)=>{e.stopImmediatePropagation();if(e.key==="Escape"){e.preventDefault();if(!deletingRef.current)setDeleteRequest(null)}if(e.key==="Tab"){const controls=Array.from(deletionDialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")??[]);const at=controls.indexOf(document.activeElement as HTMLButtonElement);e.preventDefault();controls[e.shiftKey?(at<=0?controls.length-1:at-1):(at+1)%controls.length]?.focus()}};window.addEventListener("keydown",key,true);return()=>{window.removeEventListener("keydown",key,true);previous?.focus()}},[deleteRequest]);
  const [deleteError,setDeleteError]=useState("");
  const [left, setLeft] = useState<LeftTab>("chat");
  const [right, setRight] = useState<RightTab>("design");
  const [menuOpen, setMenuOpen] = useState(false);
  const [refsExpanded, setRefsExpanded] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [mobilePane,setMobilePane]=useState<"chat"|"canvas">("canvas");
  const [view, setView] = useState<"board" | "focus">("focus");
  const creatorError=useCallback((text:string)=>useStudio.getState().notify("error",text),[]);
  const {workspace:creator,update:updateCreator,storageError:creatorStorageError}=useCreatorWorkspace(deck.id,creatorError);
  const draft=creator.draft;
  const setDraft=useCallback((value:string|((current:string)=>string))=>{updateCreator(c=>({...c,draft:typeof value==='function'?value(c.draft):value}));},[updateCreator]);
  const [chatQuery,setChatQuery]=useState("");
  const [scopeSelected,setScopeSelected]=useState(false);
  const [scopeAsset,setScopeAsset]=useState("");
  const [objectContext,setObjectContext]=useState<ChatScope['objectContext']>();
  const [includeObject,setIncludeObject]=useState(false);
  useEffect(()=>{setObjectContext(undefined);setIncludeObject(false);},[deck.id,selectedSlideId]);
  const [jumpVisible,setJumpVisible]=useState(false);
  const sendLock=useRef(false);
  useEffect(()=>{setChatQuery("");setScopeSelected(false);setScopeAsset("");},[deck.id]);
  const [pinning, setPinning] = useState(false);
  const [pinAt, setPinAt] = useState<{ x: number; y: number; selector: string;deckId:string;slideId:string } | null>(null);
  const [pinText, setPinText] = useState("");
  const [pinSaving,setPinSaving]=useState(false),[pinError,setPinError]=useState("");
  const pinSavingRef=useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateNote, setTemplateNote] = useState("");
  const [templateSaving,setTemplateSaving]=useState(false);const templateSavingRef=useRef(false);const [templateError,setTemplateError]=useState("");
  const projectInput=useRef<HTMLInputElement>(null);
  const [projectBusy,setProjectBusy]=useState(false);const projectBusyRef=useRef(false);
  const backupProject=async()=>{if(projectBusyRef.current)return;projectBusyRef.current=true;setProjectBusy(true);try{await saveDeck();const content=await api.exportProject(deck.id);const name=`${slug(deck.title||"project")}.desel.json`;if(api.isTauri){const dir=await api.exportDefaultDir(slug(deck.title||"project"));const result=await api.writeExport(dir,[{name,encoding:"utf8",data:content}]);notify("ok",`Backup tersimpan di ${result.directory}. Akun/API key dan chat tidak disertakan.`);}else{const blob=new Blob([content],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify("ok","Proyek dan aset dibackup. Akun/API key dan chat tidak disertakan.");}}catch(e){notify("error",String(e));}finally{projectBusyRef.current=false;setProjectBusy(false);}};
  const restoreProject=async(file?:File)=>{if(!file||projectBusyRef.current)return;if(file.size>32*1024*1024){notify("error","File proyek maksimal32MB.");return;}projectBusyRef.current=true;setProjectBusy(true);const source=useStudio.getState().deck;try{const imported=await api.importProject(await file.text());await useStudio.getState().refreshDecks();if(useStudio.getState().deck!==source){notify("info","Salinan impor tersimpan di daftar proyek; edit terbaru tetap terbuka.");return;}await useStudio.getState().openDeck(imported.id);if(useStudio.getState().deck.id!==imported.id){const detail=useStudio.getState().toast?.text;notify("info",`Salinan impor tersimpan di daftar proyek, tetapi belum dibuka. Proyek saat ini tetap terbuka.${detail?` ${detail}`:""}`);return;}notify("ok","Proyek dipulihkan sebagai salinan baru. Proyek lama tidak ditimpa.");}catch(e){notify("error",String(e));}finally{projectBusyRef.current=false;setProjectBusy(false);if(projectInput.current)projectInput.current.value="";}};
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPng, setExportPng] = useState(true);
  const [exportPdf, setExportPdf] = useState(false);
  const [preflight,setPreflight]=useState<ExportPreflight|null>(null);
  const [checkingExport,setCheckingExport]=useState(false);
  const [ackExport,setAckExport]=useState(false);
  const checkExport=async()=>{setCheckingExport(true);setAckExport(false);setPreflight(null);try{const result=await inspectExport(deck,frames.current);if(exportRevision(useStudio.getState().deck)===result.revision)setPreflight(result);}catch(err){notify("error",`Pemeriksaan ekspor gagal: ${String(err)}`);}finally{setCheckingExport(false);}};
  const [exportCaption, setExportCaption] = useState(true);
  const [exportBundle,setExportBundle]=useState(true);
  const [exportVariants,setExportVariants]=useState(false);
  const downloadBrief=()=>{try{for(const file of productionBundle(deck,references,creator)){const url=URL.createObjectURL(new Blob([file.data],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}notify('ok','Brief dan manifest diunduh. Catatan sumber bukan verifikasi izin.');}catch(e){notify('error',String(e));}};
  const [exporting, setExporting] = useState(false);
  const exportingRef=useRef(false);
  const closeExport=()=>{if(!exportingRef.current)setExportOpen(false)};
  useEffect(()=>{if(!exportOpen)return;const key=(e:KeyboardEvent)=>{if(e.key==="Escape"&&exportingRef.current){e.preventDefault();e.stopImmediatePropagation()}};window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true)},[exportOpen]);
  const [lastExport,setLastExport]=useState<{directory:string;files:string[]}|null>(null);
  const [refUrl, setRefUrl] = useState("");
  const [refUrlOpen, setRefUrlOpen] = useState(false);
  const [refBusy, setRefBusy] = useState(false);
  const [compareRevision,setCompareRevision]=useState<import("./lib/types").SlideRevision|null>(null);
  const [brandOpen,setBrandOpen]=useState(false);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const assetCopySaver=useRef<ReturnType<typeof createAssetCopySaver>|null>(null);
  if(!assetCopySaver.current)assetCopySaver.current=createAssetCopySaver();
  const [editingAsset,setEditingAsset]=useState<import("./lib/types").Asset|null>(null);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const followingChat = useRef(true);
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

  const refBusyRef=useRef(false);
  const submitReferenceUrl = useCallback(async () => {
    const value = refUrl.trim();
    if (!value || refBusyRef.current) return;
    refBusyRef.current=true;setRefBusy(true);
    try {
      if(await attachReferenceUrl(value)){setRefUrl("");setRefUrlOpen(false);}
    } finally {
      refBusyRef.current=false;setRefBusy(false);
    }
  }, [attachReferenceUrl, refBusy, refUrl]);

  const size = aspectSize(deck.aspect);
  const selected = deck.slides.find((s) => s.id === selectedSlideId) ?? deck.slides[0] ?? null;
  const slideNotes = useMemo(
    () => comments.filter((c) => c.slideId === selected?.id),
    [comments, selected?.id],
  );
  const openNotes = comments.filter((c) => c.status === "open" && deck.slides.some((s) => s.id === c.slideId)).length;
  const reviewMessage = useMemo(() => {
    const open = comments.filter((c) => c.status === "open" && deck.slides.some((s) => s.id === c.slideId));
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
  const [presenting,setPresenting]=useState(false);
  const [organizerOpen,setOrganizerOpen]=useState(false);
  const [slideSearchOpen,setSlideSearchOpen]=useState(false);
  const [toolsOpen,setToolsOpen]=useState(()=>{try{return localStorage.getItem('desel-tools-open')==='1'}catch{return false}});
  const toggleTools=()=>setToolsOpen(v=>{const n=!v;try{localStorage.setItem('desel-tools-open',n?'1':'0')}catch{}return n});
  const [projectReviewOpen,setProjectReviewOpen]=useState(false);
  const [aspectChange,setAspectChange]=useState<{deckId:string;from:Deck["aspect"];to:Deck["aspect"]}|null>(null);
  const busy = status === "generating";

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (selected?.id) void refreshRevisions(selected.id);
  }, [selected?.id, refreshRevisions]);
  // Opening the drawer re-reads revisions: commits made while it was closed
  // (including conflict-preserved agent versions) must show immediately.
  useEffect(() => {
    if (inspector && selected?.id) void refreshRevisions(selected.id);
  }, [inspector, selected?.id, refreshRevisions]);

  useEffect(() => {
    const el = logRef.current;
    if (el && followingChat.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, streamingReasoning,liveTools.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 4800);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if(mod&&e.key.toLowerCase()==="z"&&!(e.target as HTMLElement)?.closest("input, textarea, [contenteditable=true], .cv")){e.preventDefault();void stepHistory(e.shiftKey?"redo":"undo");}
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveDeck().catch(()=>undefined); }
      if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); setExportOpen(true); }
      if (mod && e.key === ",") { e.preventDefault(); setSettingsOpen(true); }
      if (!mod && e.key.toLowerCase() === "c" && !(e.target as HTMLElement)?.closest("input, textarea, .cv")) {
        e.preventDefault();
        setPinning((v) => !v);
        setRight("notes");
      }
      if (e.key === "Escape") {
        if(!deleting)setDeleteRequest(null);
        setMenuOpen(false);
        setSettingsOpen(false);
        if(!templateSavingRef.current)setTemplateOpen(false);
        setExportOpen(false);
        setInspector(false);
        if(!pinSavingRef.current)setPinAt(null);
        setPinning(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveDeck,stepHistory,deleting]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {if (!(e.target as HTMLElement)?.closest(".topbar-menu")) setMenuOpen(false);};
    document.addEventListener("pointerdown",close);
    return () => document.removeEventListener("pointerdown",close);
  },[menuOpen]);

  const currentScope=():ChatScope=>({mode:creator.mode,slideId:scopeSelected?selectedSlideId??undefined:undefined,objectContext:includeObject&&objectContext?.slideId===selectedSlideId?objectContext:undefined,assetIds:scopeAsset?[scopeAsset]:[],lockedSlideIds:creator.lockedSlideIds,lockedObjects:creator.lockedObjects});
  const toggleObjectLock=(obj:{slideId:string;selector:string;label:string})=>{updateCreator(c=>{const has=c.lockedObjects.some(o=>o.slideId===obj.slideId&&o.selector===obj.selector);return{...c,lockedObjects:has?c.lockedObjects.filter(o=>!(o.slideId===obj.slideId&&o.selector===obj.selector)):[...c.lockedObjects,obj]};});};
  const send = async () => {
    const text=draft.trim();if(!text||sendLock.current||creatorStorageError)return;
    const scope=currentScope();
    if(scope.mode==='edit'&&scope.slideId&&scope.lockedSlideIds.includes(scope.slideId)){notify("error","Slide konteks terkunci. Buka kunci sebelum mengedit.");return;}
    if(scope.mode==='edit'&&!scope.slideId){notify("error","Pilih slide lalu aktifkan konteks slide untuk mode Edit.");return;}
    if(busy){updateCreator(c=>({...c,draft:'',queue:[...c.queue,{id:crypto.randomUUID(),text,scope,createdAt:new Date().toISOString()}]}));return;}
    sendLock.current=true;followingChat.current=true;
    if(!updateCreator(c=>({...c,draft:''}))){sendLock.current=false;return;}
    if(composerRef.current)composerRef.current.style.height='auto';
    const sourceId=deck.id;
    try{const sent=await sendMessage(text,{...scope,memory:creator.memory});if(!sent){updateCreator(c=>({...c,draft:c.draft||text}));}if(useStudio.getState().deck.id===sourceId)void refreshRevisions();}
    finally{sendLock.current=false;}
  };
  const runQueued=async(id:string)=>{
    if(busy||sendLock.current)return;const item=creator.queue.find(q=>q.id===id);if(!item)return;
    sendLock.current=true;
    try{const ok=await sendMessage(item.text,{...item.scope,memory:creator.memory});if(ok)updateCreator(c=>({...c,queue:c.queue.filter(q=>q.id!==id)}));}
    finally{sendLock.current=false;}
  };
  const copyChat=async(text:string)=>{try{await navigator.clipboard.writeText(text);notify("ok","Pesan disalin.");}catch{notify("error","Clipboard tidak tersedia. Pilih teks untuk menyalin.");}};

  // Geometry lints (overlap) need a rendered layout, so measure the offscreen
  // preview iframes after each slide change settles and merge with string lints.
  useEffect(() => {
    const timer = setTimeout(() => {
      const geo: Record<string, LintIssue[]> = {};
      deck.slides.forEach((s, i) => {
        const doc = frames.current[i]?.contentDocument ?? undefined;
        if (!doc) return;
        const found = measureOverlapIssues(doc);
        if (found.length) geo[s.id] = found;
      });
      mergeGeometryLints(geo);
      // Forward to the desktop agent so it can self-correct what the user sees
      // in the lint panel; the browser shim keeps findings local to the UI.
      const lines: string[] = [];
      deck.slides.forEach((s, i) => {
        for (const issue of geo[s.id] ?? []) lines.push(`Slide ${i + 1} ("${s.title}"): ${issue.message}`);
      });
      for(const [sid,history]of Object.entries(useStudio.getState().reviewHistory)){if(history.lastClear&&deck.slides.some(s=>s.id===sid))lines.push(`Previously mechanically-reviewed slide ${sid}; stage layout-only changes before commit. Mechanical-zero is not quality approval.`);}
      void api.reportGeometryLints(deck.id, lines);
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.slides]);

  const submitPin = async () => {
    if (pinSavingRef.current||!pinAt || !selected || !pinText.trim()) return;
    if(useStudio.getState().deck.id!==pinAt.deckId||selected.id!==pinAt.slideId){setPinError("Slide berubah. Tutup catatan ini dan tandai slide yang dituju lagi.");return;}
    pinSavingRef.current=true;setPinSaving(true);setPinError("");
    try{await addComment(selected.id, pinAt.x, pinAt.y, pinText.trim(), pinAt.selector);setPinText("");setPinAt(null);setPinning(false);setRight("notes");}
    catch(e){setPinError(String(e));}
    finally{pinSavingRef.current=false;setPinSaving(false);}
  };

  const openSettings = async () => {
    setSettingsOpen(true);
  };

  useEffect(()=>{
    const capture=async(e:Event)=>{const {request_id,index,revision,candidate}=(e as CustomEvent<{request_id:string;index:number;revision?:string;candidate?:{base:Slide;slide:Slide;aspect:Deck["aspect"]}}>).detail;
      if(candidate&&revision){const dimensions=aspectSize(candidate.aspect);const receipt=await evaluateLayoutCandidate(candidate.base,candidate.slide,candidate.aspect,html=>safeDoc(html,dimensions.w,dimensions.h));await api.submitRenderReview(deck.id,request_id,receipt);return;}
      if(revision){const receipt=await measureRevision(()=>{const current=useStudio.getState().deck;const slide=current.slides[index];const frame=frames.current[index];const doc=frame?.contentDocument;if(!slide||!doc||doc.querySelector('meta[name="desel-review-revision"]')?.getAttribute("content")!==revision)return;return{doc,revision:reviewRevision(slide.id,current.aspect,slide.html)};},revision);if(!("error" in receipt)&&useStudio.getState().settings.sendReferences){try{const doc=frames.current[index]?.contentDocument;if(!doc)throw Error("render missing");const {toPng}=await import("html-to-image");const png=await captureSlidePng(toPng,doc,size.w,size.h);await api.addReferenceData(deck.id,`__render_${request_id}`,png);}catch(err){Object.assign(receipt,{pixelError:String(err)});}}const current=useStudio.getState().deck;const target=current.slides[index];if(target)useStudio.getState().acceptRenderReview(target.id,receipt);await api.submitRenderReview(deck.id,request_id,receipt);return;}
      try{const doc=frames.current[index]?.contentDocument;if(!doc?.body)throw new Error("Render belum siap");await doc.fonts?.ready;const {toPng}=await import("html-to-image");const png=await captureSlidePng(toPng,doc,size.w,size.h);await api.addReferenceData(deck.id,`__render_${request_id}`,png);}catch(err){notify("error",`Pemeriksaan visual gagal: ${String(err)}`);}
    };
    window.addEventListener("desel-render-request",capture);return()=>window.removeEventListener("desel-render-request",capture);
  },[deck.id,size.w,size.h,notify]);

  const runExport = async () => {
    if(exportingRef.current)return;
    if(busy)return notify("error","Hentikan atau tunggu agent sebelum mengekspor.");
    if(!preflight||preflight.revision!==exportRevision(deck))return notify("error","Periksa kesiapan ekspor untuk versi terbaru dulu.");
    if(preflight.findings.some(f=>f.severity==="block"))return notify("error","Perbaiki penghalang ekspor terlebih dahulu.");
    if(preflight.findings.length&&!ackExport)return notify("error","Tinjau dan akui peringatan ekspor dulu.");
    if (!deck.slides.length) return notify("info", "Belum ada slide untuk diexport.");
    exportingRef.current=true;setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 120));
      const { toPng } = await import("html-to-image");
      const visible = deck.slides
        .map((slide, index) => ({ slide, index }))
        .filter(({ slide }) => !slide.hidden);

      const pngs: { name: string; data: string }[] = [];
      const files: { name: string; encoding: "base64" | "utf8"; data: string }[] = [];
      const skippedSlides: number[] = [];
      const partialSlides: number[] = [];

      const verifySnapshot=()=>{if(exportRevision(useStudio.getState().deck)!==preflight.revision)throw Error("Proyek berubah selama ekspor. File belum dikirim; periksa versi terbaru lalu ekspor ulang.");};
      for (const { slide, index } of (exportPng||exportPdf)?visible:[]) {
        verifySnapshot();
        const frame = frames.current[index];
        const body = frame?.contentDocument?.body;
        if (!body) throw new Error(`Render slide ${index + 1} belum siap, coba lagi.`);
        const doc = frame!.contentDocument!;
        if(doc.querySelector('meta[name="desel-review-revision"]')?.getAttribute('content')!==reviewRevision(slide.id,deck.aspect,slide.html))throw Error(`Render slide ${index+1} berubah; periksa ulang sebelum ekspor.`);
        await Promise.race([doc.fonts?.ready??Promise.resolve(),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error("Font belum siap setelah10detik")),10000))]);
        // html-to-image has no fetch timeout; a hung image request would
        // otherwise freeze the whole export forever.
        const captureWithTimeout = () =>
          Promise.race([
            captureSlidePng(toPng, doc, size.w, size.h),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("render timeout 30 detik")), 30_000)),
          ]);
        let url: string;
        try {
          url = await captureWithTimeout();
        } catch (err) {
          // A remote image the browser cannot fetch (CORS) otherwise kills the
          // whole export with an opaque error. Exporting without the image
          // changes the user's content, so it only happens after they say yes.
          const remoteImgs = Array.from(body.querySelectorAll<HTMLImageElement>("img")).filter((img) =>
            /^https?:\/\//.test(img.src),
          );
          if (!remoteImgs.length) throw new Error(`Slide ${index + 1} gagal dirender: ${String(err)}`);
          const allowPartial = window.confirm(
            `Slide ${index + 1} punya ${remoteImgs.length} gambar remote yang tidak bisa dimuat dari browser (CORS).\n\n` +
              `OK = ekspor slide ini TANPA gambar itu.\nBatal = lewati slide ini sepenuhnya.\n\n` +
              `App desktop mencoba mengunduh gambar remote lebih dulu. Jika gagal, gunakan gambar lokal lalu ekspor ulang.`,
          );
          if (!allowPartial) {
            skippedSlides.push(index + 1);
            continue;
          }
          // Hiding is not enough: html-to-image clones the DOM and still tries
          // to fetch every img it finds. Remove them for the retry, then restore.
          const removedImgs = remoteImgs.map((img) => {
            const parent = img.parentNode!;
            const next = img.nextSibling;
            parent.removeChild(img);
            return { parent, next, img };
          });
          try {
            url = await captureWithTimeout();
          } finally {
            removedImgs.forEach(({ parent, next, img }) => parent.insertBefore(img, next));
          }
          partialSlides.push(index + 1);
        }
        verifySnapshot();
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

      verifySnapshot();
      if ((exportPng||exportPdf) && !pngs.length) throw new Error("Tidak ada slide yang berhasil diekspor.");

      if (exportCaption) {
        const caption = [
          deck.caption || deck.title,
          deck.brandHandle ? `\n${deck.brandHandle}` : "",
          "",
          `${pngs.length} exported slides · ${size.w}×${size.h}`,
          deck.styleGuide ? `\nArt direction: ${deck.styleGuide}` : "",
        ].join("\n");
        files.push({ name: "caption.txt", encoding: "utf8", data: caption });
      }

      if(exportBundle)files.push(...productionBundle(deck,references,creator));
      let variantNote="Platform variants: not requested";
      if(exportVariants){
        verifySnapshot();
        const variants=await buildVariantProjects(useStudio.getState().deck,references.filter(a=>a.deckId===deck.id),comments,creator);
        for(const v of variants)files.push({name:v.fileName,encoding:"utf8",data:v.text});
        const kept=variants.reduce((n,v)=>n+v.keptOriginal,0);
        variantNote=`Platform variants: ${variants.length} editable .desel.json files (${variants.map(v=>v.aspect).join(', ')}) - scaled starting variants for review, not redesigns${kept?`; ${kept} slide(s) kept original html (no usable document)`:""}`;
      }
      files.push({name:"export-summary.txt",encoding:"utf8",data:[`Desel export: ${deck.title}`,`Size: ${size.w}x${size.h}`,`Exported slide numbers: ${visible.filter(v=>!skippedSlides.includes(v.index+1)).map(v=>v.index+1).join(', ')}`,`Skipped slides: ${skippedSlides.join(', ')||'none'}`,`Slides without remote images: ${partialSlides.join(', ')||'none'}`,variantNote,"Mechanical checks are not visual/content/rights approval."].join("\n")});
      const dir = await api.exportDefaultDir(slug(deck.title || "desel"));
      verifySnapshot();
      const result = await api.writeExport(dir, files, settings.exportDir);
      setLastExport(result);
      setExportOpen(false);
      if (skippedSlides.length) {
        notify("error", `Ekspor selesai, tapi slide ${skippedSlides.join(", ")} dilewati (gambar remote tidak bisa dimuat).`);
      } else if (partialSlides.length) {
        notify("info", `Ekspor selesai — slide ${partialSlides.join(", ")} diekspor tanpa gambar remote (pilihanmu tadi).`);
      } else {
        notify("ok", `Ekspor selesai — ${result.files.length} file ditulis.`);
      }
    } catch (err) {
      notify("error", `Ekspor gagal: ${String(err)}`);
    } finally {
      exportingRef.current=false;setExporting(false);
    }
  };

  if(bootError)return <main className="studio-recovery" role="alert"><section><p className="recovery-eyebrow">DESEL</p><h1>Data studio belum terbuka.</h1><p>{bootError}</p><button className="btn btn-primary" onClick={()=>void boot()}>Coba buka lagi</button><p className="recovery-note">Tidak ada reset data otomatis. Jika tetap gagal, simpan data aplikasi sebelum mengubah instalasi.</p></section></main>;

  if (!settingsLoaded) {
    return (
      <div className="boot">
        <img src="/desel-icon@2x.png" alt="Desel" />
        <small>Menyiapkan studio…</small>
      </div>
    );
  }

  return (
    <>{projectReviewOpen&&<ProjectReview deck={deck} comments={comments} onOpen={(slideId,commentId)=>{selectSlide(slideId);setActiveComment(commentId);setView("focus");setRight("notes");setInspector(true)}} onStatus={setCommentStatus} onClose={()=>setProjectReviewOpen(false)}/>} {aspectChange&&<AspectChange from={aspectChange.from} to={aspectChange.to} slide={selected} onCancel={()=>setAspectChange(null)} onConfirm={()=>{if(deck.id!==aspectChange.deckId||deck.aspect!==aspectChange.from){notify("error","Proyek/format berubah. Tinjau kembali sebelum menerapkan.");setAspectChange(null);return}updateDeck({aspect:aspectChange.to});setAspectChange(null)}} onReflow={()=>{if(deck.id!==aspectChange.deckId||deck.aspect!==aspectChange.from){notify("error","Proyek/format berubah. Tinjau kembali sebelum menerapkan.");setAspectChange(null);return}const fromSize=aspectSize(aspectChange.from),toSize=aspectSize(aspectChange.to);const reflowed=deck.slides.map(s=>({...s,html:reflowSlideHtml(s.html,fromSize,toSize)??s.html}));updateDeck({aspect:aspectChange.to,slides:reflowed});notify("info","Varian terskala dibuat. Konten asli utuh di dalam bingkai; tinjau tiap slide.");setAspectChange(null)}}/>} {slideSearchOpen&&<SlideSearch deck={deck} onSelect={id=>{selectSlide(id);setView("focus")}} onClose={()=>setSlideSearchOpen(false)}/>} {organizerOpen&&<SlideOrganizer deck={deck} selectedId={selected?.id??null} onSelect={selectSlide} onMove={moveSlide} onDuplicate={duplicateSlide} onDelete={deleteSlide} onVisibility={(id,hidden)=>updateSlide(id,{hidden})} onAdd={addSlide} onClose={()=>setOrganizerOpen(false)}/>} {deleteRequest&&<div className="overlay"><div ref={deletionDialog} className="modal delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><div className="modal-head"><h2 id="delete-title">Hapus {deleteRequest.kind==="project"?"proyek":"template"}?</h2></div><p className="delete-item-name">{deleteRequest.title}</p><p className="modal-sub">{deleteRequest.kind==="project"?"Proyek, chat, catatan, aset lokal dan riwayatnya dihapus. Tindakan ini tidak dapat dibatalkan melalui Undo. Buat backup sebelum melanjutkan jika masih diperlukan.":"Template dihapus dari pustaka. Proyek yang dibuat dari template ini tetap ada. Penghapusan tidak dapat dibatalkan."}</p>{deleteError&&<p className="model-error">{deleteError}</p>}<div className="modal-actions"><button autoFocus disabled={deleting} className="btn btn-sm" onClick={()=>setDeleteRequest(null)}>Batal</button><button className="btn btn-sm danger" disabled={deleting||busy} onClick={async()=>{if(deletingRef.current)return;deletingRef.current=true;setDeleting(true);setDeleteError("");try{if(deleteRequest.kind==="project")await deleteDeck(deleteRequest.id);else await deleteTemplate(deleteRequest.id);setDeleteRequest(null)}catch(err){setDeleteError(String(err))}finally{deletingRef.current=false;setDeleting(false)}}}>{deleting?"Menghapus...":"Hapus permanen"}</button></div></div></div>}{presenting&&<Presentation deck={deck} initialId={selected?.id??null} onClose={()=>setPresenting(false)}/>}<div className={`app clean-preview ${view === "board" ? "view-board" : "view-focus"}`}>
      {busy && <div className="progress-line" />}
      {recoverableDraft&&<div className="draft-recovery-banner" role="status"><span>Draft lokal belum tersimpan ditemukan: {recoverableDraft.deck.title||"Tanpa judul"}. Pulihkan sebagai proyek baru, tanpa menimpa database.</span><button disabled={busy||recoveringDraft} onClick={()=>void recoverLocalDraft()}>{recoveringDraft?"Memulihkan draft...":"Pulihkan salinan draft"}</button><button disabled={recoveringDraft} onClick={dismissLocalDraft}>Abaikan draft</button></div>}
      {saveState==="error"&&<div className="save-error-banner" role="alert"><span>Perubahan belum tersimpan. Edit lokal tetap ada di canvas.{saveError?` ${saveError}`:""}</span><button onClick={()=>void saveDeck().catch(()=>undefined)}>Coba simpan</button><button disabled={busy||savingRecoveryCopy} onClick={()=>void saveRecoveryCopy()}>{savingRecoveryCopy?"Menyimpan salinan...":"Simpan salinan pemulihan"}</button></div>}

      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/desel-icon@2x.png" alt="Desel" />
          <div>
            <div className="brand-name">Desel</div>
            <div className="brand-sub">Design workspace</div>
          </div>
        </div>

        <span className="topbar-divider" />

        <input
          className="title-input"
          aria-label="Judul carousel"
          value={deck.title}
          onChange={(e) => updateDeck({ title: e.target.value })}
          placeholder="Judul carousel"
          spellCheck={false}
        />

        <div className="topbar-menu"><button className="top-settings" aria-label="Pengaturan workspace" onClick={() => void openSettings()}><Settings2 size={16}/> Pengaturan</button>{!(settings.apiKey || settings.providerKind?.startsWith("magpie") || busy) && <button className="pill needs-key readiness-chip" title="Pilih koneksi provider dan model di Pengaturan." onClick={() => void openSettings()}><span className="pill-dot" />Hubungkan model</button>}<button className="menu-trigger" title="Menu proyek" aria-label="Menu proyek" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><MoreHorizontal size={18}/></button><div className={`topbar-actions ${menuOpen ? "menu-open" : ""}`} onClick={e=>{if((e.target as HTMLElement).closest("button"))setMenuOpen(false);}}>
          {settings.apiKey || settings.providerKind?.startsWith("magpie") || busy ? (
            <span className={`pill ${busy ? "busy" : "configured"}`} title={`Konfigurasi: ${settings.baseUrl}. Status koneksi belum diverifikasi.`}>
              <span className="pill-dot" />
              {busy ? statusMessage || "Bekerja…" : settings.model || "belum ada model"}
            </span>
          ) : (
            <button
              className="pill needs-key"
              title="Pilih koneksi provider dan model di Pengaturan."
              onClick={() => void openSettings()}
            >
              <span className="pill-dot" />
              Hubungkan model
            </button>
          )}
          <div className="menu-section-label">Proyek</div>
          <label className="menu-title-field">Judul carousel<input aria-label="Ubah judul carousel" value={deck.title} onChange={e=>updateDeck({title:e.target.value})} placeholder="Judul carousel" spellCheck={false}/></label>
          {draftWarning&&<div className="save-health error">Draft cadangan lokal tidak tersedia (batas ruang/perangkat). Simpan atau backup sebelum menutup.</div>}
          <div className={`save-health ${saveState}`} role="status" title={saveError}>{saveState==="saved"?"Semua perubahan tersimpan lokal":saveState==="saving"?"Menyimpan perubahan…":saveState==="dirty"?"Perubahan belum tersimpan":"Belum tersimpan. Coba Simpan atau buat salinan pemulihan lokal."}</div>
          <button className="menu-row" disabled={busy||projectBusy||!historyCounts[0]} onClick={()=>void stepHistory("undo")}><span>Batalkan perubahan proyek</span><kbd>Ctrl+Z</kbd></button>
          <button className="menu-row" disabled={busy||projectBusy||!historyCounts[1]} onClick={()=>void stepHistory("redo")}><span>Ulangi perubahan proyek</span><kbd>Ctrl+Shift+Z</kbd></button>
          <button className="menu-row" aria-label="Simpan" title="Simpan (Ctrl+S)" onClick={() => void saveDeck().catch(()=>undefined)}><Save size={16}/><span>Simpan deck</span><kbd>Ctrl+S</kbd></button>
          <button className="menu-row" disabled={busy||projectBusy||savingRecoveryCopy} onClick={()=>void saveRecoveryCopy()}><Copy size={16}/><span>Simpan salinan pemulihan lokal</span></button>
          <button className="menu-row" disabled={busy||projectBusy} onClick={()=>void backupProject()}><Download size={16}/><span>{projectBusy?"Memproses proyek…":"Backup proyek + aset"}</span></button>
          <button className="menu-row" disabled={busy||projectBusy} onClick={()=>projectInput.current?.click()}><FolderPlus size={16}/><span>Pulihkan proyek dari file</span></button>
          <input ref={projectInput} type="file" accept=".json,.desel.json" hidden onChange={e=>void restoreProject(e.target.files?.[0])}/>
          <button className="menu-row" aria-label="Simpan sebagai template" onClick={() => {setTemplateName(deck.title);setTemplateError("");setTemplateOpen(true);}}><Layers size={16}/><span>Simpan sebagai template</span></button>
        </div></div>
      </header>

      <nav className="mobile-workspace-switch" aria-label="Tampilan workspace"><button className={mobilePane==='chat'?'active':''} onClick={()=>setMobilePane('chat')}>Chat & proyek</button><button className={mobilePane==='canvas'?'active':''} onClick={()=>setMobilePane('canvas')}>Canvas</button></nav>
      <div className={`workspace mobile-${mobilePane} ${inspector ? "inspector-open" : ""}`}>
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
              <div className="chat-toolbar"><Search size={13}/><input aria-label="Cari percakapan" placeholder="Cari percakapan…" value={chatQuery} onChange={e=>setChatQuery(e.target.value)}/></div>
              <div className="chat-log" ref={logRef} onScroll={e => {const el=e.currentTarget;followingChat.current=el.scrollHeight-el.clientHeight-el.scrollTop<90;setJumpVisible(!followingChat.current);}}>
                {messages.length === 0 && !deck.slides.length && (
                  <div className="chat-hello">
                    <h2>
                      Mau bikin apa hari ini?
                    </h2>
                    <p>
                      Kasih topik, audiens, atau referensi visual. Agent menanyakan yang belum jelas,
                      riset kalau perlu, atau eksplor ide dulu sebelum mendesain.
                    </p>
                    <div className="starters">
                      <button
                        className="starter"
                        onClick={() =>
                          setDraft(
                            "Aku ingin bahas kenapa developer perlu personal site. Bantu pikirkan arah dan format yang cocok.",
                          )
                        }
                      >
                        <span>Pikirkan ide bareng</span>
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="starter"
                        onClick={() =>
                          setDraft(
                            "Eksplor satu cover keamanan AI agent. Gaya poster kolase merah-hitam dengan halftone. Copy belum final, bantu cari arah yang pas.",
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

                {messages.length === 0 && deck.slides.length > 0 && <div className="chat-context"><span className="context-eyebrow">ASISTEN DESAIN</span><h2>Lanjutkan dari sini.</h2><p>{deck.slides.length} slide sudah ada di canvas. Pilih slide untuk edit langsung, atau minta perubahan lewat chat.</p><button className="context-action" onClick={() => setDraft("Tinjau deck ini. Sebutkan masalah desain tanpa mengubah slide dulu.")}>Tinjau desain <ArrowRight size={14}/></button></div>}
                {turns.filter(t=>!chatQuery||t.text.toLowerCase().includes(chatQuery.toLowerCase())).map((t) =>
                  t.kind === "user" ? (
                    <div className="msg user" key={t.id}>
                      <div className="msg-avatar">K</div>
                      <div className="msg-text">
                        <ChatMarkdown text={t.text}/><div className="chat-actions"><button title="Salin pesan" onClick={()=>void copyChat(t.text)}>Salin</button><button title="Kutip ke draft" onClick={()=>setDraft(d=>(d?d+'\n\n':'')+t.text.split('\n').map(line=>'> '+line).join('\n')+'\n\n')}>Kutip</button><button title="Gunakan sebagai brief baru; riwayat tetap utuh" onClick={()=>setDraft(t.text)}>Pakai lagi</button><button className="branch-fork" title="Edit dan kirim ulang sebagai cabang baru; cabang lama tetap tersimpan dan tidak dilihat agent" onClick={()=>{void useStudio.getState().forkAtMessage(t.id).then(ok=>{if(ok)setDraft(t.text)})}}>Cabang baru</button>{(()=>{const sib=siblings(branches,t.id);if(sib.length<2)return null;const i=sib.indexOf(t.id);return <span className="branch-switch" aria-label="Cabang percakapan"><button aria-label="Cabang sebelumnya" disabled={i<=0} onClick={()=>void useStudio.getState().switchBranch(sib[i-1])}>‹</button><span>{i+1}/{sib.length}</span><button aria-label="Cabang berikutnya" disabled={i>=sib.length-1} onClick={()=>void useStudio.getState().switchBranch(sib[i+1])}>›</button></span>})()}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="msg agent" key={t.id}>
                      <div className="msg-avatar">
                        <Sparkles size={12} />
                      </div>
                      <div className="msg-text">
                        {t.reasoning && <details className="provider-reasoning"><summary>Thinking - output provider</summary><p>{t.reasoning}</p></details>}
                        {t.text && <><ChatMarkdown text={t.text}/><div className="chat-actions"><button title="Salin pesan" onClick={()=>void copyChat(t.text)}>Salin</button><button title="Kutip ke draft" onClick={()=>setDraft(d=>(d?d+'\n\n':'')+t.text.split('\n').map(line=>'> '+line).join('\n')+'\n\n')}>Kutip</button><button title="Gunakan sebagai brief baru; riwayat tetap utuh" onClick={()=>setDraft(t.text)}>Pakai lagi</button>{(()=>{const idx=turns.findIndex(x=>x.id===t.id);let prev:typeof turns[number]|undefined;for(let i=idx-1;i>=0;i--){if(turns[i].kind==="user"){prev=turns[i];break}}if(!prev)return null;const u=prev;return <button className="branch-fork retry-reply" title="Ulangi balasan ini: buka cabang baru dari pesan lo sebelumnya dan isi ulang draft. Belum terkirim; lo yang kirim." onClick={()=>{void useStudio.getState().forkAtMessage(u.id).then(ok=>{if(ok)setDraft(u.text)})}}>Ulangi balasan</button>})()}</div></>}
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

                {streamingReasoning && <details className="provider-reasoning"><summary>Thinking - output provider</summary><p>{streamingReasoning}</p></details>}
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

              {!busy&&deck.slides.map(slide=>{const h=reviewHistory[slide.id];return h?.regressed?<div className="completion-review" key={`regression-${slide.id}`} role="status"><span>Regresi pada {slide.title}: {h.latest.findings} temuan. Versi {h.lastClear?.revision} tanpa temuan mekanis tersimpan, belum disetujui visual/isi.</span><button className="link" onClick={()=>{selectSlide(slide.id);setRight("design");setInspector(true);void refreshRevisions(slide.id);}}>Tinjau versi dan pemulihan</button></div>:null;})}
              {!busy&&statusMessage&&!Object.values(reviewHistory).some(h=>h.regressed)&&<div className="completion-review" role="status"><span>{statusMessage}</span>{deck.slides.some(s=>(lints[s.id]??[]).some(i=>["overlap","text-image-overlap","text-overflow"].includes(i.rule)))&&<button className="link" onClick={()=>{setDraft("Perbaiki temuan geometri pada deck ini saja. Baca slide terkait, pertahankan konten dan slide lain. Jangan klaim selesai sebelum temuan terselesaikan.");composerRef.current?.focus();}}>Siapkan revisi tata letak</button>}</div>}
              <div className={`refs ${refsExpanded || references.length ? "refs-expanded" : "refs-collapsed"}`}>
                <div className="refs-head">
                  <button className="refs-toggle" onClick={() => setRefsExpanded(v => !v)}><Paperclip size={15} strokeWidth={1.6}/> Referensi & aset <ChevronDown size={12}/></button>
                  <span className="refs-actions">
                    <button className="link" disabled={refBusy} onClick={() => setRefUrlOpen((v) => !v)}>
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
                      disabled={refBusy}
                      value={refUrl}
                      placeholder="Tempel link gambar (Pinterest, Dribbble, ...)"
                      onChange={(e) => setRefUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitReferenceUrl();
                        if (e.key === "Escape"&&!refBusyRef.current) setRefUrlOpen(false);
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
                        <button className="ref-open" title="Lihat aset dan atur crop" onClick={()=>setEditingAsset(r)}><img src={`data:${r.mime};base64,${r.data}`} alt={r.name} /></button>
                        <button
                          className="ref-x"
                          title="Hapus referensi"
                          onClick={() => void removeReference(r.id)}
                        >
                          <X size={10} />
                        </button>
                        <div className="ref-intent">
                          <select aria-label={`Peran referensi ${r.name}`} value={r.referenceRole||""} onChange={e=>void useStudio.getState().setReferenceIntent(r.id,e.target.value,r.referenceStatus||"")}>
                            <option value="">Peran belum diatur</option><option value="cover">Cover</option><option value="body">Isi</option><option value="closer">Penutup</option><option value="asset">Aset produk</option>
                          </select>
                          <select aria-label={`Status referensi ${r.name}`} value={r.referenceStatus||""} onChange={e=>void useStudio.getState().setReferenceIntent(r.id,r.referenceRole||"",e.target.value)}>
                            <option value="">Belum dinilai</option><option value="candidate">Kandidat</option><option value="approved">Disukai</option><option value="rejected">Ditolak</option>
                          </select>
                        </div>
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
                      ? "Pengiriman gambar aktif; dukungan mengikuti kemampuan provider/model."
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

              {jumpVisible&&<button className="chat-jump" onClick={()=>{followingChat.current=true;setJumpVisible(false);if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;}}>Ke pesan terbaru ↓</button>}
              {toolsOpen&&<div className="composer-tools" id="composer-tools">
              <div className="library-entry" role="group" aria-label="Aset dan brand"><button className="btn btn-sm" onClick={()=>setLibraryOpen(true)}>Pustaka aset proyek</button><button className="btn btn-sm" onClick={()=>setBrandOpen(true)}>Profil brand</button></div>
              <div className="creator-workbench">
                <CreatorMemory key={deck.id} memory={creator.memory} update={updateCreator}/>
                <CreatorRuns deckId={deck.id} busy={busy} onContinue={setDraft}/>
                <ProductionReview key={'production-'+deck.id} workspace={creator} onBrief={text=>{updateCreator(c=>({...c,mode:'discuss',draft:text}));}} onBundle={downloadBrief}/>
              </div>
              </div>}
              <div className="composer">
                {creatorStorageError&&<p role="alert">{creatorStorageError}</p>}
                {creator.queue.length>0&&<details className="brief-queue" open><summary>Antrean brief · {creator.queue.length} · jalankan setelah review</summary>{creator.queue.map(q=><div key={q.id}><span>{q.text}</span><button disabled={busy} onClick={()=>void runQueued(q.id)}>Jalankan</button><button onClick={()=>updateCreator(c=>({...c,queue:c.queue.filter(item=>item.id!==q.id)}))}>Hapus</button></div>)}</details>}
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
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-foot">
                    <button type="button" className="tools-toggle" aria-label="Alat proyek" aria-expanded={toolsOpen} aria-controls="composer-tools" title="Aset, brand, memori, production desk" onClick={toggleTools}><Plus size={16}/></button>
                <details className="creator-scope" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();e.stopPropagation();}}}>
                  <summary className="scope-summary" aria-label="Atur scope agent">{creator.mode==='discuss'?'Diskusi':creator.mode==='edit'?'Edit':'Produksi'} · {scopeSelected&&selectedSlideId?`Slide ${deck.slides.findIndex(s=>s.id===selectedSlideId)+1}`:'Deck'}<ChevronDown size={12}/></summary>
                  <div className="scope-options">
                  <select aria-label="Mode agent" value={creator.mode} onChange={e=>updateCreator(c=>({...c,mode:e.target.value as ChatScope['mode']}))}><option value="discuss">Diskusi · tanpa edit</option><option value="edit">Edit · slide terpilih</option><option value="produce">Produksi · seluruh deck</option></select>
                  <label><input type="checkbox" checked={scopeSelected} disabled={!selectedSlideId} onChange={e=>setScopeSelected(e.target.checked)}/> Slide terpilih</label>
                  {objectContext&&<label title="Konteks objek adalah referensi, bukan kunci region. Mode Edit tetap dibatasi slide."><input type="checkbox" checked={includeObject} onChange={e=>{setIncludeObject(e.target.checked);if(e.target.checked)setScopeSelected(true);}}/> @obj {objectContext.label}</label>}
                  {scopeSelected&&selectedSlideId&&<span className="scope-chip">@slide {deck.slides.findIndex(s=>s.id===selectedSlideId)+1}</span>}
                  <select aria-label="Konteks aset" value={scopeAsset} onChange={e=>setScopeAsset(e.target.value)}><option value="">+ Aset konteks</option>{references.map(a=><option key={a.id} value={a.id}>@asset {a.name}</option>)}</select>
                  {selectedSlideId&&<button title="Kunci slide dari edit agent" className={creator.lockedSlideIds.includes(selectedSlideId)?'active':''} onClick={()=>updateCreator(c=>({...c,lockedSlideIds:c.lockedSlideIds.includes(selectedSlideId!)?c.lockedSlideIds.filter(id=>id!==selectedSlideId):[...c.lockedSlideIds,selectedSlideId!]}))}>{creator.lockedSlideIds.includes(selectedSlideId)?'Terkunci':'Kunci slide'}</button>}
                  </div>
                </details>
                    <span className="foot-spacer"/>
                    {busy && <button className="queue-send" disabled={!draft.trim()} onClick={()=>void send()}>Antrekan</button>}
                    {busy ? (
                      <button className="send stop" onClick={() => void stopAgent()} title="Hentikan agent">
                        <Square size={13} />
                      </button>
                    ) : (
                      <button className="send" disabled={!draft.trim()} onClick={() => void send()} title="Kirim (Enter)">
                        <ArrowRight size={15} />
                      </button>
                    )}
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
                <label className="project-search"><span>Cari proyek</span><input aria-label="Cari proyek" value={projectQuery} onChange={e=>setProjectQuery(e.target.value)} placeholder="Nama proyek..."/></label>
                {decks.filter(d=>(d.title||"Tanpa judul").toLowerCase().includes(projectQuery.trim().toLowerCase())).map((d) => (
                  <div
                    key={d.id}
                    className={`project-row ${d.id === deck.id ? "active" : ""}`}
                  >
                    <button className="project-open" aria-label={`Buka proyek ${d.title||"Tanpa judul"}`} onClick={()=>void openDeck(d.id)}>
                    <span className="project-swatch">{(d.title || "D").slice(0, 1).toUpperCase()}</span>
                    <span className="project-info">
                      <strong>{d.title || "Tanpa judul"}</strong>
                      <span>
                        {d.slideCount} slide · {when(d.updatedAt)}
                      </span>
                    </span>
                    </button>
                    <span className="project-tools">
                      <button
                        className="icon-btn"
                        title="Duplikat"
                        aria-label={`Duplikat proyek ${d.title||"Tanpa judul"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void duplicateDeck(d.id);
                        }}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Hapus"
                        aria-label={`Hapus proyek ${d.title||"Tanpa judul"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteError("");setDeleteRequest({kind:"project",id:d.id,title:d.title||"Tanpa judul"});
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                ))}
                {decks.length>0&&!decks.some(d=>(d.title||"Tanpa judul").toLowerCase().includes(projectQuery.trim().toLowerCase()))&&<div className="empty-note">Tidak ada proyek dengan nama ini.</div>}
                {!decks.length && <div className="empty-note">Belum ada proyek. Mulai dari chat atau tombol Baru.</div>}
              </div>
            </div>
          )}

          {left === "templates" && (
            <div className="panel-body">
              <div className="panel-section">
                <div className="section-title">
                  <span>Design system tersimpan</span>
                  <button className="link" onClick={() => { setTemplateName(deck.title);setTemplateError(""); setTemplateOpen(true); }}>
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
                    <span className="icon-btn" title="Hapus template" onClick={() => {setDeleteError("");setDeleteRequest({kind:"template",id:t.id,title:t.name})}}>
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
        <main className={`stage ${inspector ? "inspector-visible" : ""}`}>
          <div className="stage-bar">
            <div className="stage-title">
              {selected ? (
                <>
                  <strong>{selected.title || "Slide"}</strong>
                  <span style={{ color: "var(--text-3)", fontSize: 11 }}>
                    {deck.slides.indexOf(selected) + 1}/{deck.slides.length}
                  </span>
                  {busy && (
                    <span className="stage-live" title="Agent sedang mengedit canvas — perubahan muncul langsung">
                      <i /> live
                    </span>
                  )}
                </>
              ) : (
                <strong>Canvas</strong>
              )}
            </div>

            <div className="stage-bar-actions">
              <button
                className={`icon-btn ${view === "board" ? "on" : ""}`}
                title="Papan: semua slide terhampar"
                onClick={() => setView("board")}
              >
                <LayoutGrid size={15} /><span>Papan</span>
              </button>
              <button
                className={`icon-btn ${view === "focus" ? "on" : ""}`}
                title="Fokus: satu artboard untuk diedit"
                onClick={() => setView("focus")}
              >
                <Scan size={15} /><span>Edit slide</span>
              </button>
              <span className="topbar-divider" />
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
              <button
                className={`icon-btn ${inspector ? "on" : ""}`}
                title={inspector ? "Tutup panel desain" : "Buka panel desain (properti, kode, catatan)"}
                onClick={() => setInspector((v) => !v)}
              >
                <PanelRight size={16} strokeWidth={1.6} /><span>Properti</span>
              </button>

            </div>
          </div>

          <div className="stage-area">
            <div className="canvas-actions">
            <button className="canvas-present" disabled={!deck.slides.some(s=>!s.hidden)} onClick={()=>{window.dispatchEvent(new Event("desel-before-context-switch"));setPresenting(true)}}><Maximize2 size={14}/> Presentasi</button>
            <button className="canvas-export" disabled={!deck.slides.length} onClick={() => setExportOpen(true)}><Download size={14}/> Ekspor</button>
            </div>
            <nav className="canvas-palette" aria-label="Alat canvas">
              <button title="Pilih dan edit elemen" aria-label="Pilih elemen" className={!pinning && view === "focus" ? "on" : ""} onClick={() => {setPinning(false);setView("focus");}}><MousePointer2 size={17}/></button>
              <button title="Review catatan seluruh proyek" aria-label="Review seluruh proyek" onClick={()=>setProjectReviewOpen(true)}><ClipboardCheck size={17}/></button>
              <button title="Cari teks dalam proyek" aria-label="Cari teks slide" onClick={()=>{window.dispatchEvent(new Event("desel-before-context-switch"));setSlideSearchOpen(true)}}><Search size={17}/></button>
              <button title="Kelola urutan dan visibilitas slide" aria-label="Kelola slide" onClick={()=>{window.dispatchEvent(new Event("desel-before-context-switch"));setOrganizerOpen(true)}}><Layers size={17}/></button>
              <button disabled={!deck.slides.length} title="Lihat semua slide" aria-label="Lihat semua slide" className={view === "board" ? "on" : ""} onClick={() => setView("board")}><LayoutGrid size={17}/></button>
              <button disabled={!selected} title="Edit teks: klik dua kali teks pada slide" aria-label="Mode edit teks" onClick={() => {setView("focus");setPinning(false);notify("info","Klik dua kali teks pada slide untuk mengedit.");}}><Type size={17}/></button>
              <button title="Properti dan riwayat slide" aria-label="Properti dan riwayat slide" onClick={() => {setRight("design");setInspector(v => !v);}}><PanelRight size={17}/></button>
              <button disabled={!selected} title="Tambah catatan pada slide" aria-label="Tambah catatan" className={pinning ? "on" : ""} onClick={() => {setView("focus");setPinning(v => !v);}}><StickyNote size={17}/></button>
            </nav>
            {!deck.slides.length ? (
              <div className="empty-stage">
                <img className="mark" src="/desel-icon@2x.png" alt="" />
                <h1>Mulai dari satu sudut pandang.</h1>
                <p>
                  Belum ada slide. Ceritakan subjek, audiens, dan rasa visual yang kamu mau —
                  slide pertama muncul di sini sambil agent mendesain.
                </p>
                <button className="btn btn-primary" onClick={() => { setLeft("chat");setMobilePane("chat"); composerRef.current?.focus(); }}>
                  <Wand2 size={14} /> Tulis brief
                </button>
              </div>
            ) : view === "board" ? (
              <Board
                slides={deck.slides.filter((s) => !s.hidden).map((s) => ({ ...s, html: safeDoc(s.html, size.w, size.h) }))}
                activeId={selected?.id ?? null}
                width={size.w}
                height={size.h}
                noteCounts={comments
                  .filter((c) => c.status === "open")
                  .reduce<Record<string, number>>((acc, c) => {
                    acc[c.slideId] = (acc[c.slideId] ?? 0) + 1;
                    return acc;
                  }, {})}
                onSelect={(id) => selectSlide(id)}
                onFocus={(id) => {
                  selectSlide(id);
                  setView("focus");
                }}
              />
            ) : selected ? (
              <Canvas
                doc={safeDoc(selected.html, size.w, size.h)}
                assets={references}
                deckKey={deck.id}
                onObjectContext={context=>setObjectContext(context??undefined)}
                objectLocks={creator.lockedObjects.filter(o=>o.slideId===selected.id)}
                onToggleObjectLock={toggleObjectLock}
                neighbour={deck.slides.filter(s => !s.hidden && s.id !== selected.id).map(s => ({id:s.id,title:s.title,doc:safeDoc(s.html,size.w,size.h)}))[0]}
                onSelectNeighbour={id => selectSlide(id)}
                slideTitle={`Slide ${deck.slides.indexOf(selected)+1} · ${selected.title}` }
                slideKey={selected.id}
                width={size.w}
                height={size.h}
                notes={slideNotes}
                pinning={pinning}
                activeNoteId={activeCommentId}
                onTogglePinning={() => {
                  setPinning((v) => !v);
                  setRight("notes");
                  setInspector(true);
                }}
                onRequestPin={(x, y, selector) => {setPinError("");setPinAt({ x, y, selector,deckId:deck.id,slideId:selected.id })}}
                onSelectNote={(id) => {
                  setRight("notes");
                  setInspector(true);
                  setActiveComment(id);
                }}
                onEditHtml={(html,slideId) => {
                  updateSlide(slideId, { html });
                  notify("ok", "Elemen canvas diperbarui.");
                }}
                onNotify={(text) => notify("info", text)}
              />
            ) : null}

            {pinAt && (
              <div
                className="overlay"
                style={{ background: "transparent", backdropFilter: "none", placeItems: "start end", padding: 0 }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget&&!pinSavingRef.current) setPinAt(null);
                }}
              >
                <div className="modal" style={{ width: 300, margin: "0 24px 24px 0" }}>
                  <div className="modal-head">
                    <h2 style={{ fontSize: 19 }}>Catatan baru</h2>
                    <button className="icon-btn" disabled={pinSaving} onClick={() => setPinAt(null)}>
                      <X size={15} />
                    </button>
                  </div>
                  <p className="modal-sub">Nempel di titik ini. Agent bisa membacanya saat revisi.</p>
                  <div className="field">
                    <span>Komentar</span>
                    <textarea
                      disabled={pinSaving}
                      autoFocus
                      value={pinText}
                      onChange={(e) => setPinText(e.target.value)}
                      placeholder="Contoh: headline terlalu kecil, naikin 20%."
                      style={{ minHeight: 88 }}
                    />
                  </div>
                  {pinError&&<p className="model-error pin-error" role="alert">{pinError}</p>}
                  <div className="modal-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost btn-sm" disabled={pinSaving} onClick={() => setPinAt(null)}>
                      Batal
                    </button>
                    <button className="btn btn-primary btn-sm" disabled={pinSaving||!pinText.trim()} onClick={() => void submitPin()}>
                      {pinSaving?"Menyimpan...":"Tambah"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rail">
            <div className="rail-head">
              <span className="label">Urutan slide · {deck.slides.length}</span>
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
        {inspector && (
        <aside className="panel panel-right panel-drawer">
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
            <span className="tabs-spacer" />
            <button className="icon-btn" title="Tutup panel (Esc)" onClick={() => setInspector(false)} autoFocus>
              <X size={14} />
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
                    <select aria-label="Format proyek" value={deck.aspect} onChange={(e) => {window.dispatchEvent(new Event("desel-before-context-switch"));const to=e.target.value as Deck["aspect"];if(!deck.slides.length)updateDeck({aspect:to});else setAspectChange({deckId:deck.id,from:deck.aspect,to})}}>
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
                <PaletteEditor colors={deck.palette} onChange={palette=>updateDeck({palette})}/>
              </div>

              {selected && (
                <div className="panel-section">
                  <div className="section-title">Slide terpilih</div>
                  <label className="field">
                    <span>Nama slide</span>
                    <input value={selected.title} onChange={(e) => updateSlide(selected.id, { title: e.target.value })} />
                  </label>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button className="btn btn-sm" style={{ flex: 1 }} disabled={deck.slides.indexOf(selected) === 0} onClick={() => moveSlide(selected.id, -1)}>
                      <ChevronLeft size={13} /> Maju
                    </button>
                    <button className="btn btn-sm" style={{ flex: 1 }} disabled={deck.slides.indexOf(selected) === deck.slides.length-1} onClick={() => moveSlide(selected.id, 1)}>
                      Mundur <ChevronRight size={13} />
                    </button>
                  </div>
                  <label className="check slide-visibility"><input type="checkbox" checked={!selected.hidden} onChange={e=>updateSlide(selected.id,{hidden:!e.target.checked})}/><span>Sertakan slide ini di ekspor dan papan</span></label>{selected.hidden&&<p className="rev-hint">Slide disimpan, tetapi disembunyikan dari ekspor dan papan. Masih dapat dipilih melalui thumbnail.</p>}
                  <div className="slide-manage"><button className="btn btn-sm" onClick={() => duplicateSlide(selected.id)}><Copy size={13}/> Duplikat</button><button className="btn btn-sm" onClick={() => deleteSlide(selected.id)}><Trash2 size={13}/> Hapus</button></div>
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
                      Tidak ada temuan mekanis saat ini. Ini bukan jaminan kualitas visual atau kebenaran isi. Periksa preview.
                    </p>
                  ) : (
                    <ul className="lint-list">
                      {(lints[selected.id] ?? []).map((issue,index) => (
                        <li key={`${issue.rule}-${index}`} className={`lint-item ${issue.severity}`}>
                          <span className="lint-dot" />
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selected&&reviewHistory[selected.id]?.regressed&&<div className="panel-section"><p>Versi {reviewHistory[selected.id].lastClear?.revision}: tanpa temuan mekanis saat direview, bukan persetujuan visual/isi. Pemulihan hanya slide ini dan perlu konfirmasi.</p><button className="link" onClick={()=>void useStudio.getState().recoverReviewed(selected.id)}>Pulihkan versi yang direview...</button></div>}
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
                        <button className="link" onClick={() => setCompareRevision(rev)}>
                          Bandingkan
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
                        <button disabled={!!noteMutationBusy} onClick={() => void mutateNote(c.id,()=>setCommentStatus(c.id, c.status === "open" ? "resolved" : "open"))}>
                          {c.status === "open" ? "Selesai" : "Buka lagi"}
                        </button>
                        <button className="danger" disabled={!!noteMutationBusy} onClick={() => void mutateNote(c.id,()=>deleteComment(c.id))}>
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
        </aside> )}
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
            srcDoc={safeDoc(s.html, size.w, size.h).replace("</head>",`<meta name="desel-review-revision" content="${reviewRevision(s.id,deck.aspect,s.html)}"></head>`)}
            style={{ width: size.w, height: size.h }}
          />
        ))}
      </div>

      {compareRevision&&selected&&compareRevision.slideId===selected.id&&<RevisionCompare current={selected} revision={compareRevision} aspect={deck.aspect} onClose={()=>setCompareRevision(null)} onRestore={async()=>{if(!await restoreRevision(compareRevision.id))throw Error("Pemulihan belum selesai. Periksa pesan dan coba lagi.")}}/>}
      {brandOpen&&<BrandLibrary deck={deck} onClose={()=>setBrandOpen(false)} onApply={updateDeck}/>}
      {libraryOpen&&<AssetLibrary deckId={deck.id} onClose={()=>setLibraryOpen(false)} onCopied={()=>useStudio.getState().refreshReferences(deck.id)}/>}
      {editingAsset&&<AssetEditor asset={editingAsset} onMetadataSaved={async()=>{await useStudio.getState().refreshReferences(editingAsset.deckId??deck.id);const latest=useStudio.getState().references.find(r=>r.id===editingAsset.id);if(latest)setEditingAsset(latest)}} onClose={()=>setEditingAsset(null)} onSave={async(name,data)=>{const target=editingAsset.deckId??deck.id;await assetCopySaver.current!(editingAsset,target,name,data,async()=>{if(useStudio.getState().deck.id!==target)throw Error("Proyek berubah saat menyimpan salinan aset; periksa pustaka proyek asal.");await useStudio.getState().refreshReferences(target);});}} onUse={data=>{if(!selected)throw Error("Pilih atau buat slide dulu. Aset tetap tersedia.");if(selected.html.length+data.length>4*1024*1024)throw Error("HTML slide dan gambar akan melebihi4MB. Gunakan gambar lebih kecil.");const doc=new DOMParser().parseFromString(selected.html,"text/html");const image=doc.createElement("img");image.id=`desel-image-${crypto.randomUUID()}`;image.src=data;image.alt=editingAsset.provenance?.altText||"Aset visual";image.style.cssText="position:absolute;left:8%;top:28%;width:84%;height:48%;object-fit:contain;z-index:10";doc.body.appendChild(image);updateSlide(selected.id,{html:"<!doctype html>"+doc.documentElement.outerHTML});notify("ok","Aset ditambahkan. Posisi/ukuran dapat diatur lewat kode atau chat; versi lama tetap di riwayat.");}}/>}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}

      {templateOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !templateSavingRef.current && setTemplateOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <h2>Simpan design system</h2>
              <button className="icon-btn" disabled={templateSaving} onClick={() => setTemplateOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <p className="modal-sub">
              Menyimpan slide dan art direction sebagai titik mulai. Desain berikutnya tetap bebas berubah total.
            </p>
            <label className="field">
              <span>Nama</span>
              <input disabled={templateSaving} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Misal: Editorial kaos kaki" />
            </label>
            <label className="field">
              <span>Catatan pemakaian</span>
              <textarea disabled={templateSaving} value={templateNote} onChange={(e) => setTemplateNote(e.target.value)} placeholder="Cocok untuk…" />
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" disabled={templateSaving} onClick={() => setTemplateOpen(false)}>
                Batal
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={templateSaving||!templateName.trim()}
                onClick={async () => {
                  if(templateSavingRef.current)return;
                  templateSavingRef.current=true;setTemplateSaving(true);setTemplateError("");
                  try{await saveTemplate(templateName.trim(), templateNote.trim());setTemplateOpen(false);setTemplateNote("");}
                  catch(error){setTemplateError(String(error));}
                  finally{templateSavingRef.current=false;setTemplateSaving(false);}
                }}
              >
                <Save size={13} /> {templateSaving?"Menyimpan...":"Simpan"}
              </button>{templateError&&<p role="alert" className="model-error">{templateError}</p>}
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeExport()}>
          <div className="modal export-modal">
            <div className="modal-head">
              <h2>Ekspor</h2>
              <button className="icon-btn" disabled={exporting} aria-label="Tutup ekspor" onClick={closeExport}>
                <X size={15} />
              </button>
            </div>
            <p className="modal-sub">
              Dirender dari HTML preview. Periksa gambar, font, dan peringatan; hasil dapat berbeda bila aset gagal dimuat.
            </p>
            {lastExport&&<p className="export-last">Ekspor terakhir: {lastExport.files.length} file<br/><code>{lastExport.directory}</code>{"__TAURI_INTERNALS__" in window&&<button className="btn btn-sm" onClick={()=>void api.revealPath(lastExport.directory).catch(e=>notify("error",String(e)))}>Buka folder</button>}</p>}
            <div className="export-preflight"><button className="btn btn-sm" disabled={checkingExport||exporting} onClick={()=>void checkExport()}>{checkingExport?"Memeriksa render…":"Periksa kesiapan ekspor"}</button>
            <p>Pemeriksaan mekanis, bukan persetujuan visual, fakta, atau hak pakai.</p>
            {preflight&&preflight.revision!==exportRevision(deck)&&<p role="alert">Slide berubah. Periksa ulang sebelum ekspor.</p>}
            {preflight&&preflight.revision===exportRevision(deck)&&<><p>{preflight.slides} slide · {preflight.findings.filter(f=>f.severity==="block").length} penghalang · {preflight.findings.filter(f=>f.severity==="warn").length} peringatan</p><div className="preflight-findings">{preflight.findings.map((f,i)=><button key={i} className={`preflight-finding ${f.severity}`} disabled={exporting} onClick={()=>{if(f.slideId)selectSlide(f.slideId);setExportOpen(false);}}>{f.slideId?`Slide ${f.index+1}: `:""}{f.message} →</button>)}</div>{preflight.findings.some(f=>f.severity==="warn")&&!preflight.findings.some(f=>f.severity==="block")&&<label className="check"><input type="checkbox" disabled={exporting} checked={ackExport} onChange={e=>setAckExport(e.target.checked)}/><span>Saya sudah meninjau peringatan dan tetap ingin mengekspor versi ini.</span></label>}</>}
            </div>
            <div className="export-list">
              <label className="export-option">
                <input type="checkbox" disabled={exporting} checked={exportPng} onChange={(e) => setExportPng(e.target.checked)} />
                <span className="info">
                  <strong>PNG per slide</strong>
                  <small>
                    {deck.slides.filter(s=>!s.hidden).length} gambar · {size.w} × {size.h}
                  </small>
                </span>
                <ImageDown size={16} />
              </label>
              <label className="export-option">
                <input type="checkbox" disabled={exporting} checked={exportPdf} onChange={(e) => setExportPdf(e.target.checked)} />
                <span className="info">
                  <strong>PDF deck</strong>
                  <small>Satu halaman per slide</small>
                </span>
                <FileText size={16} />
              </label>
              <label className="export-option">
                <input type="checkbox" disabled={exporting} checked={exportCaption} onChange={(e) => setExportCaption(e.target.checked)} />
                <span className="info">
                  <strong>Caption & catatan</strong>
                  <small>File teks pendamping</small>
                </span>
                <MessageSquare size={16} />
              </label>
            </div>
            <label className="check"><input type="checkbox" disabled={exporting} checked={exportBundle} onChange={e=>setExportBundle(e.target.checked)}/><span>Production bundle: brief, sumber aset, keputusan dan manifest (tanpa key / akun / chat)</span></label>
            <label className="check"><input type="checkbox" disabled={exporting} checked={exportVariants} onChange={e=>setExportVariants(e.target.checked)}/><span>Varian platform: file proyek .desel.json editable untuk {ASPECTS.filter(a=>a.id!==deck.aspect).length} format lain (varian terskala, konten asli utuh di dalam bingkai)</span></label>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" disabled={exporting} onClick={closeExport}>
                Batal
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={busy||exporting||checkingExport||!preflight||preflight.revision!==exportRevision(deck)||preflight.findings.some(f=>f.severity==="block")||(preflight.findings.length>0&&!ackExport)||(!exportPng && !exportPdf && !exportCaption && !exportVariants)}
                onClick={() => void runExport()}
              >
                {exporting ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                {exporting ? "Merender…" : "Ekspor"}
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
    </div></>
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
  const width = 46;
  const height = Math.round((width * size.h) / size.w);
  return (
    <button
      className={`thumb ${slide.hidden?"thumb-hidden":""} ${active ? "active" : ""} ${over ? "over" : ""}`}
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
      title={`${slide.title}${slide.hidden?" (tidak diekspor)":""} - geser untuk ubah urutan`}
    >
      <span className="thumb-frame" style={{ height }}>
        <iframe title={`thumb-${index}`} sandbox="allow-same-origin" srcDoc={safeDoc(slide.html, size.w, size.h)} style={{width:size.w,height:size.h,transform:`scale(${width / size.w})`,transformOrigin:"top left"}} />
        <span className="thumb-num">{index + 1}</span>{slide.hidden&&<span className="thumb-hidden-badge" aria-label="Slide tersembunyi"><EyeOff size={12}/></span>}
        {issues && issues.length > 0 && (
          <span
            className={`thumb-lint ${issues.some((i) => i.severity === "error") ? "bad" : ""}`}
            title={issues.map((i) => i.message).join("\n")}
          >
            {issues.length}
          </span>
        )}
      </span>
      <span className="thumb-title">{slide.hidden?"Tersembunyi · ":""}{slide.title || "Slide"}</span>
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
  const [form, setForm] = useState(()=>({...settings,activeConnection:settings.activeConnection||crypto.randomUUID()}));
  const [saving,setSaving]=useState(false);
  const savingRef=useRef(false);
  const runtimeBusyRef=useRef(false);
  const storeBusyRef=useRef(false);
  const [storeBusy,setStoreBusy]=useState(false);
  const closeSettings=()=>{if(!savingRef.current&&!runtimeBusyRef.current&&!storeBusyRef.current)onClose()};
  const settingsDialog=useDialogFocus(closeSettings);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<import("./lib/types").ModelCapability[]>(settings.modelCapabilities ?? []);
  const [modelError,setModelError]=useState("");
  const [modelsBusy,setModelsBusy]=useState(false);
  const capability=models.find(m=>m.id===form.model && m.source.replace(/\/+$/, "")===form.baseUrl.replace(/\/+$/, ""));
  const [connectionName,setConnectionName]=useState("");
  const [searchModels,setSearchModels]=useState("");
  const [managerError,setManagerError]=useState("");
  const [runtime,setRuntime]=useState<{running:boolean;gatewayUrl?:string;version:string;managed:boolean}|null>(null);
  const [runtimeBusy,setRuntimeBusy]=useState(false);
  const [runtimeFailed,setRuntimeFailed]=useState(false);
  const [nativeManager,setNativeManager]=useState(true);
 const [settingsSection,setSettingsSection]=useState<"model"|"connect">("model");
  useEffect(()=>{void api.runtimeStatus().then(r=>{setRuntime(r);setRuntimeFailed(false);}).catch(e=>{setManagerError(String(e));setRuntimeFailed(true);});},[]);
  const isManaged=form.providerKind==="magpie-managed";
  const isMagpie=isManaged||form.providerKind==="magpie";
  const tokenCount=(n?:number)=>n ? n.toLocaleString("en-US")+" token" : "Belum diketahui";
  const snapshot=()=>({id:form.activeConnection||crypto.randomUUID(),name:connectionName.trim()||form.connections?.find(c=>c.id===form.activeConnection)?.name||(isMagpie?"Magpie lokal":"Koneksi API"),kind:form.providerKind||"openai-compatible",baseUrl:form.baseUrl,apiKey:form.apiKey,model:form.model,reasoningEffort:form.reasoningEffort,modelCapabilities:models.filter(m=>m.source===form.baseUrl)});
  const remember=()=>{const c=snapshot();return {...form,activeConnection:c.id,connections:[...(form.connections??[]).filter(x=>x.id!==c.id),c],modelCapabilities:c.modelCapabilities};};
  const switchConnection=(id:string)=>{const saved=remember();const c=saved.connections.find(x=>x.id===id);if(!c)return;setForm({...saved,activeConnection:c.id,providerKind:c.kind,baseUrl:c.baseUrl,apiKey:c.apiKey,model:c.model,reasoningEffort:c.reasoningEffort??"auto",modelCapabilities:c.modelCapabilities??[]});setModels(c.modelCapabilities??[]);setConnectionName(c.name);setTest("idle");setTestMsg("");setModelError("");};
  const newConnection=(baseUrl:string,model:string,kind="openai-compatible",name="Koneksi API")=>{const saved=remember();setForm({...saved,activeConnection:crypto.randomUUID(),providerKind:kind,baseUrl,apiKey:"",model,reasoningEffort:"auto",modelCapabilities:[]});setModels([]);setConnectionName(name);setTest("idle");setTestMsg("");setModelError("");};
  const startRuntime=async(manage=false)=>{if(runtimeBusyRef.current||savingRef.current)return;runtimeBusyRef.current=true;try{setRuntimeBusy(true);setManagerError("");const r=await api.runtimeStart();setRuntime(r);if(r.gatewayUrl){if(form.baseUrl!==r.gatewayUrl){setModels([]);patch({baseUrl:r.gatewayUrl,apiKey:"",reasoningEffort:"auto",modelCapabilities:[]});}}if(manage){setNativeManager(true);setSettingsSection("connect");}}catch(e){setManagerError(String(e));}finally{runtimeBusyRef.current=false;setRuntimeBusy(false);}};
  const stopRuntime=async()=>{if(runtimeBusyRef.current||savingRef.current)return;runtimeBusyRef.current=true;setRuntimeBusy(true);setManagerError("");try{await api.runtimeStop();setRuntime(await api.runtimeStatus());}catch(e){setManagerError(String(e));}finally{runtimeBusyRef.current=false;setRuntimeBusy(false)}};
  const discoveryTarget=useRef("");
  discoveryTarget.current=[form.activeConnection,form.baseUrl,form.apiKey,form.providerKind,form.model].join("|");
  const [test, setTest] = useState<"idle" | "busy" | "ok" | "bad">("idle");
  const [testMsg, setTestMsg] = useState("");
  const testBusyRef = useRef(false);

  const patch = (p: Partial<typeof form>) => {if(["baseUrl","apiKey","model","providerKind"].some(k=>k in p)){setTest("idle");setTestMsg("");}setForm((f) => ({ ...f, ...p }));};

  const loadModels = async () => {
    const target=discoveryTarget.current;
    try {
      setModelsBusy(true);setModelError("");
      const discovered=await api.discoverModels(form);
      if(target!==discoveryTarget.current)return;setModels(discovered);patch({...(isManaged&&discovered[0]?{baseUrl:discovered[0].source}:{}),modelCapabilities:discovered,reasoningEffort:"auto",...(form.model?{}:{model:discovered[0]?.id??""})});
    } catch (e) {
      if(target!==discoveryTarget.current)return;
      setModelError(String(e));
    } finally {setModelsBusy(false);}
  };

  const runTest = async () => {
    if(testBusyRef.current)return;
    testBusyRef.current=true;
    const target=discoveryTarget.current;
    setTest("busy");
    setTestMsg("");
    try {
      const res = (await api.testConnection(form)) as { provider?: string; model?: string };
      if(target!==discoveryTarget.current)return;
      setTest("ok");
      setTestMsg(`${res.provider ?? "Provider"} · ${res.model ?? form.model}`);
    } catch (err) {
      if(target!==discoveryTarget.current)return;
      setTest("bad");
      setTestMsg(String(err).slice(0, 160));
    } finally {testBusyRef.current=false;}
  };

  // One-click diagnostics, redacted by default: version, whitelisted provider
  // path facts, runtime status and counts. Freeform user text (endpoint, model
  // id, connection names, project titles/content, chat) is never included -
  // custom endpoints can embed credentials or private hosts, and model ids are
  // arbitrary user text, so only their configured/not-configured state is copied.
  const copyDiagnostics=async()=>{
    const s=useStudio.getState();
    const knownKind=["openai-compatible","magpie","magpie-managed"].includes(form.providerKind||"")?form.providerKind:"tidak dikenal (tidak disertakan)";
    const endpoint=!form.baseUrl?"belum diisi":PROVIDERS.some(p=>p.baseUrl.replace(/\/+$/,"")===(form.baseUrl||"").replace(/\/+$/,""))?"preset bawaan (tanpa detail)":"kustom (tidak disertakan)";
    const runtimeVersion=runtime&&/^[\d.]+$/.test(runtime.version)?` · v${runtime.version}`:"";
    const lines=[
      `Desel ${pkg.version} · ${api.isTauri?"desktop":"browser"}`,
      `Provider: ${knownKind}`,
      `Endpoint: ${endpoint}`,
      `Model: ${form.model?"dipilih (tidak disertakan)":"belum dipilih"}`,
      `API key: ${form.apiKey?"tersimpan (tidak disertakan)":"belum diisi"}`,
      `Koneksi tersimpan: ${(form.connections??[]).length}`,
      `Runtime: ${runtimeFailed?"status tidak diketahui":runtime?`${runtime.running?"berjalan":"berhenti"}${runtimeVersion}`:"belum diperiksa"}`,
      `Proyek: ${s.decks.length} · Template: ${s.templates.length}`,
      `Status simpan: ${s.saveState}`,
      "Tidak menyertakan API key, nama koneksi, detail endpoint, nama model, judul/isi proyek, atau isi chat.",
    ];
    try{await navigator.clipboard.writeText(lines.join("\n"));s.notify("ok","Info diagnosis disalin tanpa secret.");}catch(e){s.notify("error",`Info diagnosis belum tersalin: ${String(e)}`);}
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeSettings()}>
      <div className="modal wide" ref={settingsDialog} role="dialog" aria-modal="true" aria-label="Pengaturan workspace">
        <div className="modal-head">
          <h2>Pengaturan</h2>
          <button className="icon-btn" disabled={saving||runtimeBusy||storeBusy} onClick={closeSettings}>
            <X size={15} />
          </button>
        </div>
        <fieldset disabled={saving||runtimeBusy||storeBusy} style={{display:"contents"}}><div className="presets"><button className={`chip ${settingsSection==="model"?"on":""}`} onClick={()=>setSettingsSection("model")}>Model & workspace</button><button className={`chip ${settingsSection==="connect"?"on":""}`} onClick={()=>setSettingsSection("connect")}>Provider & Plugin Store</button></div>{settingsSection==="connect"?<ProviderManager onBusyChange={value=>{storeBusyRef.current=value;setStoreBusy(value)}}/>:<>
        <p className="modal-sub">Koneksi tersimpan di database lokal, termasuk API key. Jangan bagikan database aplikasi.</p>
        <div className="provider-workspace">
          <div className="connection-heading"><span>Koneksi tersimpan</span><button className="btn btn-ghost btn-tiny" onClick={()=>newConnection("https://api.openai.com/v1","","openai-compatible","Koneksi baru")}>+ Koneksi</button></div>
          <div className="connection-list">{(form.connections??[]).map(c=><button key={c.id} className={`connection-item ${form.activeConnection===c.id?"selected":""}`} onClick={()=>switchConnection(c.id)}><span>{c.name}</span><small>{c.kind==="magpie-managed"?"Provider bawaan":c.kind==="magpie"?"Magpie eksternal":"API compatible"} · {c.model||"Belum pilih model"}</small></button>)}{!(form.connections?.length)&&<small>Koneksi sekarang akan disimpan saat lo klik Simpan.</small>}</div>
          {form.activeConnection&&form.connections?.some(c=>c.id===form.activeConnection)&&<button className="btn btn-ghost btn-tiny" onClick={()=>{const next=(form.connections??[]).filter(c=>c.id!==form.activeConnection);const c=next[0];setForm({...form,connections:next,activeConnection:c?.id??crypto.randomUUID(),providerKind:c?.kind??"openai-compatible",baseUrl:c?.baseUrl??"https://api.openai.com/v1",apiKey:c?.apiKey??"",model:c?.model??"",modelCapabilities:c?.modelCapabilities??[],reasoningEffort:c?.reasoningEffort??"auto"});setModels(c?.modelCapabilities??[]);setConnectionName(c?.name??"");setTest("idle");setTestMsg("");}}>Hapus koneksi ini dari Desel</button>}
          <label className="field"><span>Nama koneksi</span><input value={connectionName||form.connections?.find(c=>c.id===form.activeConnection)?.name||""} placeholder={isMagpie?"Magpie lokal":"API utama"} onChange={e=>setConnectionName(e.target.value)}/></label>
        </div>

        <div className="presets">
          {PROVIDERS.map((p) => (
            <button
              key={p.label}
              className={`chip ${form.baseUrl.replace(/\/+$/, "") === p.baseUrl ? "on" : ""}`}
              onClick={() => newConnection(p.baseUrl,p.model,"kind" in p?String(p.kind):"openai-compatible",p.label)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="field"><span>Jalur koneksi</span><select value={form.providerKind||"openai-compatible"} onChange={e=>{setModels([]);patch({providerKind:e.target.value,apiKey:"",modelCapabilities:[],reasoningEffort:"auto"});}}><option value="openai-compatible">API OpenAI-compatible</option><option value="magpie-managed">Provider bawaan Desel</option><option value="magpie">Magpie eksternal (advanced)</option></select></label>
        {isMagpie&&<div className="gateway-guide"><strong>{isManaged?"Provider bawaan Desel":"Gateway Magpie eksternal"}</strong><p>{isManaged?"Runtime otomatis, tanpa instalasi terpisah. Kelola provider di Desel.":"Advanced: sambungkan gateway yang lo jalankan sendiri. Provider dan login dikelola oleh runtime eksternal itu."}</p>
        {isManaged&&<><div className="connection-heading"><span>{runtimeFailed?"Status runtime tidak diketahui":runtime?.running?"Runtime berjalan":"Runtime belum dimulai"}{runtimeFailed?"":` · v${runtime?.version||"0.1.1404"}`}</span></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn btn-primary btn-sm" disabled={runtimeBusy} onClick={()=>void startRuntime(true)}>{runtimeBusy?"Memproses runtime…":"Kelola provider & login"}</button><button className="btn btn-ghost btn-sm" disabled={runtimeBusy} onClick={()=>void startRuntime()}>Hubungkan runtime</button>{runtime?.running&&<button className="btn btn-ghost btn-sm" disabled={runtimeBusy} onClick={()=>void stopRuntime()}>Hentikan runtime</button>}</div></>}
        <details><summary>Privasi, plugin, dan keamanan</summary><small>Data runtime disimpan terpisah di folder aplikasi Desel. Pencarian login aplikasi lain dan telemetry dimatikan saat awal. Plugin dapat mengakses proses, file, dan kredensial; pasang hanya yang dipercaya. Login bisa membuka halaman OAuth resmi vendor lalu kembali ke Desel. Tidak ada langganan atau topup otomatis.</small></details>{managerError&&<small className="model-error">{managerError}</small>}</div>}

        {isManaged?<details><summary>Detail koneksi lokal (otomatis)</summary><small>Alamat runtime ditetapkan Desel saat mulai. Tidak perlu mengisi server atau key.</small><code>{runtime?.gatewayUrl||"Runtime akan dimulai saat dibutuhkan"}</code></details>:<>
        <label className="field">
          <span>{isMagpie?"Alamat gateway Magpie":"Base URL (OpenAI-compatible)"}</span>
          <input readOnly={isManaged} value={form.baseUrl} onChange={(e) => {setModels([]);setModelError("");patch({ baseUrl: e.target.value,apiKey:"",modelCapabilities:[],reasoningEffort:"auto" });}} placeholder="https://api.openai.com/v1" />
        </label>

        <label className="field">
          <span>{isMagpie?"Gateway key (loopback bawaan tidak perlu key)":"API key"}</span>
          <div className="inline-input">
            <input
              type={showKey ? "text" : "password"}
              readOnly={isManaged} value={form.apiKey}
              onChange={(e) => {setModels([]);patch({ apiKey: e.target.value,modelCapabilities:[],reasoningEffort:"auto" });}}
              placeholder={isMagpie?"Kosong jika gateway lokal tidak meminta key":"sk-…"}
            />
            <button onClick={() => setShowKey((v) => !v)} title={showKey ? "Sembunyikan" : "Tampilkan"}>
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </label>

        </>}
        {modelError && <p className="model-error">{modelError}</p>}
        <div className="field-row">
          <label className="field">
            <span>Model</span>
            <div className="inline-input">
              <input value={form.model} onChange={(e) => patch({ model: e.target.value,reasoningEffort:"auto" })} list="model-list" placeholder="gpt-4o-mini" />
              <button disabled={modelsBusy} title="Ambil daftar model dari Base URL di form ini (tanpa inferensi)" onClick={() => void loadModels()}>
                <RefreshCw size={12} />
              </button>
            </div>
            <datalist id="model-list">
              {models.map((m) => (
                <option key={m.id} value={m.id} />
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

        <div className="model-picker"><div className="connection-heading"><span>{modelError?(models.length?"Discovery model gagal - daftar sebelumnya tetap ditampilkan":"Discovery model gagal"):`${models.length} model dari koneksi ini`}</span><small>Discovery tanpa inferensi</small></div><input aria-label="Cari model" placeholder="Cari model atau provider…" value={searchModels} onChange={e=>setSearchModels(e.target.value)}/><div className="model-results">{models.filter(m=>m.source===form.baseUrl&&(m.id+" "+(m.name??"")+" "+(m.provider??"")).toLowerCase().includes(searchModels.toLowerCase())).map(m=><button className={`model-choice ${form.model===m.id?"selected":""}`} key={m.id} onClick={()=>patch({model:m.id,reasoningEffort:"auto"})}><span>{m.name||m.id}</span><code>{m.id}</code><small>{m.contextWindow?tokenCount(m.contextWindow)+" input":"Context belum diketahui"} · {m.efforts.length?m.efforts.join(" / "):"Effort tidak tersedia"}</small></button>)}</div></div>
        <div className="capability-grid"><div><small>Context / input limit</small><strong>{tokenCount(capability?.contextWindow)}</strong></div><div><small>Output maksimum</small><strong>{tokenCount(capability?.maxOutput)}</strong></div><div><small>Input</small><strong>{capability?.inputModalities.length?capability.inputModalities.join(", "):"Belum diketahui"}</strong></div><div><small>Asal metadata</small><strong>{capability?(isMagpie?"Dilaporkan Magpie":"Endpoint provider"):"Belum diambil"}</strong></div></div>
        <p className="metadata-note">{capability?(isMagpie?"Magpie dapat memakai data provider, katalog, cache, atau plugin. Sumber tiap field tidak diekspos; bukan hasil pengujian kapasitas Desel.":"Batas dilaporkan endpoint, belum diuji dengan inferensi."):"Ambil daftar model untuk mengisi kemampuan. Model manual tetap bisa dipakai; context dan effort tidak ditebak."}{capability?.discoveredAt&&` Diambil ${new Date(capability.discoveredAt).toLocaleString("id-ID")}.`}</p>
        <label className="field"><span>Thinking effort</span><select value={form.reasoningEffort ?? "auto"} onChange={e=>patch({reasoningEffort:e.target.value})}><option value="auto">Auto - default provider</option>{capability?.efforts.map(level=><option key={level} value={level}>{level}</option>)}</select><small>{capability?.efforts.length?`Level untuk model ini: ${capability.efforts.join(", ")}. Effort lebih tinggi bisa lebih lama dan mahal.`:"Tidak ada level yang dilaporkan. Auto tidak mengirim parameter effort."}</small></label>
        <div className="field-row">
          <label className="field">
            <span>Brand handle</span>
            <input value={form.brandHandle} onChange={(e) => patch({ brandHandle: e.target.value })} placeholder="@brand" />
          </label>
          <label className="field">
            <span>Folder ekspor</span>
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
              <strong>Kirim gambar ke model</strong>
              <small>
                Aktifkan hanya untuk model yang mendukung gambar. Termasuk referensi dan pemeriksaan render slide; dukungan belum diketahui jika metadata tidak tersedia.
                Kalau mati, agent tetap menerima palet, kontras, dan ukuran tiap referensi dalam bentuk teks.
              </small>
            </span>
          </label>
        </div>

        <div className={`check-line ${test === "ok" ? "ok" : test === "bad" ? "bad" : ""}`}>
          <span className="dot" />
          <span>{test === "busy" ? "Menguji koneksi…" : testMsg || "Belum diuji. Tes memakai koneksi di form ini dan dapat berbiaya."}</span>
          <button className="btn btn-ghost btn-tiny" style={{ marginLeft: "auto" }} onClick={() => void runTest()} disabled={test === "busy"}>
            Tes koneksi (inferensi)
          </button>
        </div>

        </>}
        <div className="diagnostics-row"><button className="btn btn-ghost btn-sm" disabled={saving||runtimeBusy||storeBusy} onClick={()=>void copyDiagnostics()}>Salin info diagnosis</button><small>Versi, jalur provider, status runtime dan jumlah data. API key, nama koneksi, detail endpoint, nama model, judul/isi proyek dan chat tidak disertakan.</small></div>
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={closeSettings}>
            Tutup
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              if(savingRef.current||runtimeBusyRef.current||storeBusyRef.current)return;savingRef.current=true;setSaving(true);try{await onSave(remember());onClose();}catch{/* error notice already shown; keep unsaved form open */}finally{savingRef.current=false;setSaving(false)}
            }}
          >
            <Check size={13} /> {saving?"Menyimpan...":"Simpan"}
          </button>
        </div></fieldset>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */


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
    github_trending:"Membaca GitHub Trending",import_image:"Mengunduh aset sumber",review_render:"Menganalisis render slide",
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
