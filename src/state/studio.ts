import {aspectSize as geometryAspect} from "../lib/types";
import {readLocalDraft,retainLocalDraft,clearLocalDraft,type LocalDraft} from "../lib/local-drafts";
import {reconcileDeck} from "../lib/reconcile-deck";
import {reviewRevision} from "../lib/render-review";
import {retainReview,readReviewHistory,type ReviewHistory} from "../lib/review-history";
import {geometryRules} from "../lib/geometry";
import { create } from "zustand";
import { api, defaultSettings, emptyDeckRecord } from "../lib/api";
import { sampleDeck } from "../lib/sample";
import type { AgentEvent, AppSettings, Asset, ChatMessage, Comment, Deck, DeckSummary, LintIssue, Slide, SlideRevision, TemplateRecord, ToolCallRecord } from "../lib/types";
import { followChangedSlideId } from "../lib/live-diff";

export type StudioStatus = "idle" | "generating" | "exporting";
type Toast = { kind: "ok" | "error" | "info"; text: string } | null;

interface StudioState {
  deck: Deck;
  saveState:"saved"|"dirty"|"saving"|"error";
  saveError:string;
  recoverableDraft:LocalDraft|null;
  draftWarning:boolean;
  recoveringDraft:boolean;
  savingRecoveryCopy:boolean;
  recoverLocalDraft:()=>Promise<void>;
  dismissLocalDraft:()=>void;
  decks: DeckSummary[];
  templates: TemplateRecord[];
  messages: ChatMessage[];
  comments: Comment[];
  references: Asset[];
  lints: Record<string, LintIssue[]>;
  revisions: SlideRevision[];
  reviewHistory: Record<string,ReviewHistory>;
  recoverReviewed:(slideId:string)=>Promise<void>;
  acceptRenderReview:(slideId:string,receipt:{revision:string;issues:unknown[];error?:string})=>void;
  settings: AppSettings;
  settingsLoaded: boolean;
  bootError:string;
  selectedSlideId: string | null;
  activeCommentId: string | null;
  setActiveComment: (id: string | null) => void;
  status: StudioStatus;
  statusMessage: string;
  streamingReasoning: string;
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
  saveRecoveryCopy:()=>Promise<void>;
  historyCounts:[number,number];
  refreshHistory:()=>Promise<void>;
  stepHistory:(direction:"undo"|"redo")=>Promise<void>;
  updateDeck: (patch: Partial<Deck>) => void;
  selectSlide: (id: string | null) => void;
  updateSlide: (id: string, patch: Partial<Slide>) => void;
  addSlide: () => void;
  duplicateSlide: (id: string) => void;
  deleteSlide: (id: string) => void;
  moveSlide: (id: string, delta: -1 | 1) => void;
  reorderSlide: (id: string, to: number) => void;
  sendMessage: (text: string) => Promise<boolean>;
  stopAgent: () => Promise<void>;
  clearChat: () => Promise<void>;
  saveTemplate: (name: string, description: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  addComment: (slideId: string, x: number, y: number, body: string, selector?: string) => Promise<void>;
  setCommentStatus: (id: string, status: Comment["status"]) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  refreshReferences: (deckId?: string) => Promise<void>;
  attachReferenceData: (name: string, dataUrl: string) => Promise<void>;
  attachReferencePaths: (paths: string[]) => Promise<void>;
  attachReferenceUrl: (url: string) => Promise<boolean>;
  setReferenceIntent: (id:string,role:string,status:string)=>Promise<void>;
  removeReference: (id: string) => Promise<void>;
  refreshLints: (deckId?: string) => Promise<void>;
  /** Merge geometry-based findings (overlap) measured from the live preview. */
  mergeGeometryLints: (geo: Record<string, LintIssue[]>) => void;
  refreshRevisions: (slideId?: string) => Promise<void>;
  restoreRevision: (id: string) => Promise<boolean>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setStatus: (status: StudioStatus, message?: string) => void;
  notify: (kind: NonNullable<Toast>["kind"], text: string) => void;
  clearToast: () => void;
}

const cleanProjectReview=()=>({reviewHistory:{},lints:{},revisions:[],historyCounts:[0,0] as [number,number],activeCommentId:null,statusMessage:""});
let referenceRequest=0;
let deckListRequest=0;
let templateListRequest=0;
let historyRequest=0;
let revisionRequest=0;
let lintRequest=0;
let openEpoch=0;
let creatingProject=false;
let steppingHistory=false;
const duplicatingProjects=new Set<string>();
const deletedProjects=new Set<string>();
let saveFailureEpoch=0;
const referenceIntentWrites=new Map<string,Promise<void>>();
const referenceIntentVersions=new Map<string,number>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lintTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue:Promise<unknown>=Promise.resolve();
const persisted=new Map<string,Deck>();
const remoteEpoch=new Map<string,number>();
function rememberPersisted(deck:Deck,remote=true){persisted.set(deck.id,structuredClone(deck));if(remote)remoteEpoch.set(deck.id,(remoteEpoch.get(deck.id)??0)+1);}
function persistDeck(deck:Deck){const epoch=remoteEpoch.get(deck.id)??0;const pending=saveQueue.catch(()=>undefined).then(async()=>{if(useStudio.getState().deck.id===deck.id)useStudio.setState({saveState:"saving",saveError:""});if((remoteEpoch.get(deck.id)??0)!==epoch)throw Error("Project berubah sebelum autosave; edit lokal tetap ada. Simpan salinan pemulihan bila perlu.");if(deletedProjects.has(deck.id))throw Error("Proyek telah dihapus; autosave lama dibatalkan.");const saved=await api.saveDeck(deck,null,persisted.get(deck.id)??null);rememberPersisted(saved,false);clearLocalDraft(deck.id,deck);if(useStudio.getState().deck.id===deck.id)useStudio.setState({saveState:JSON.stringify(useStudio.getState().deck)===JSON.stringify(deck)?"saved":"dirty",saveError:""});return saved;}).catch(err=>{++saveFailureEpoch;const s=useStudio.getState();if(s.deck.id===deck.id)useStudio.setState({saveState:"error",saveError:String(err).replace(/^Error:\s*/,"")});if(s.toast?.kind==="ok")useStudio.setState({toast:null});throw err;});saveQueue=pending;return pending;}

async function flushDeck(deck:Deck){if(saveTimer){clearTimeout(saveTimer);saveTimer=undefined;await persistDeck(deck);}else await saveQueue;}
function scheduleSave(deck: Deck) {
  const retained=retainLocalDraft(deck);
  useStudio.setState({saveState:"dirty",saveError:"",draftWarning:!retained});
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer=undefined;
    void persistDeck(deck).then(()=>{if(useStudio.getState().deck.id===deck.id){if(useStudio.getState().deck===deck)void useStudio.getState().refreshLints(deck.id);void useStudio.getState().refreshHistory().catch(err=>useStudio.getState().notify("error",`Perubahan tersimpan, tetapi riwayat belum dimuat: ${String(err)}`));void useStudio.getState().refreshDecks().catch(err=>useStudio.getState().notify("error",`Daftar proyek belum diperbarui: ${String(err)}`));}}).catch((err) => useStudio.getState().notify("error", `Autosave gagal: ${String(err)}`));
  }, 450);
}
const touched = (deck: Deck, patch: Partial<Deck> = {}): Deck => ({ ...deck, ...patch, updatedAt: new Date().toISOString() });
const localId = (prefix: string) => `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

let bootInFlight:Promise<void>|null=null;
export const useStudio = create<StudioState>((set, get) => ({
  deck: emptyDeckRecord(),saveState:"saved",saveError:"",recoverableDraft:null,draftWarning:false,recoveringDraft:false,savingRecoveryCopy:false,
  dismissLocalDraft:()=>{if(get().recoveringDraft)return;const d=get().recoverableDraft;if(d&&!clearLocalDraft(d.deck.id,d.deck)){get().notify("error","Draft belum diabaikan karena penyimpanan lokal tidak bisa diperbarui. Coba lagi; draft tetap tersedia.");return;}set({recoverableDraft:null});},
  recoverLocalDraft:async()=>{
    const draft=get().recoverableDraft;if(!draft||get().status!=="idle"||get().recoveringDraft)return;
    set({recoveringDraft:true});const current=get().deck;
    try{
      const copy=await api.saveRecoveryCopy(draft.deck);
      clearLocalDraft(draft.deck.id,draft.deck);set({recoverableDraft:null});
      try{await get().refreshDecks();}catch(err){get().notify("error",`Salinan draft tersimpan, tetapi daftar proyek belum dimuat. Jangan pulihkan ulang. ${String(err)}`);return;}
      if(get().deck!==current||get().saveState!=="saved"){get().notify("info","Salinan draft tersimpan di daftar proyek; edit terbaru tetap terbuka.");return;}
      await get().openDeck(copy.id);
      if(get().deck.id!==copy.id){const detail=get().toast?.text;get().notify("info",`Salinan draft tersimpan di daftar proyek, tetapi belum dibuka. Proyek saat ini tetap terbuka.${detail?` ${detail}`:""}`);return;}
      get().notify("ok","Draft dipulihkan sebagai proyek baru; versi database tetap utuh.");
    }catch(err){get().notify("error",String(err));}finally{set({recoveringDraft:false});}
  },
  decks: [],
  templates: [],
  messages: [],
  comments: [],
  references: [],
  lints: {},
  revisions: [],
  reviewHistory:{},
  recoverReviewed:async(slideId)=>{const d=get().deck;const slide=d.slides.find(s=>s.id===slideId);const h=get().reviewHistory[slideId];if(!slide||!h?.lastClear||reviewRevision(slide.id,d.aspect,slide.html)!==h.latest.revision||d.aspect!==h.lastClear.aspect){get().notify("error","Slide berubah sejak review. Periksa versi terbaru; tidak dipulihkan.");return;}
    const versions=await api.listRevisions(slideId);const candidate=versions.find(r=>r.html===h.lastClear?.slide.html&&r.title===h.lastClear.slide.title);if(!candidate){get().notify("error","Snapshot tersimpan lokal, tetapi versi pemulihan tidak ditemukan. Hasil terbaru tidak diubah.");return;}
    if(!window.confirm("Pulihkan hanya slide ini ke versi tanpa temuan mekanis? Versi tersebut belum disetujui visual/isi. Perubahan terbaru tetap ada di riwayat."))return;
    const current=get().deck;const now=current.slides.find(s=>s.id===slideId);if(current.id!==d.id||!now||reviewRevision(now.id,current.aspect,now.html)!==h.latest.revision){get().notify("error","Slide berubah selama review; pemulihan dibatalkan.");return;}await get().restoreRevision(candidate.id);},
  acceptRenderReview:(slideId,receipt)=>{const d=get().deck;const slide=d.slides.find(s=>s.id===slideId);if(!slide)return;const next=retainReview(d.id,slide,d.aspect,receipt,get().reviewHistory[slideId]);if(next)set({reviewHistory:{...get().reviewHistory,[slideId]:next},...(next.regressed?{statusMessage:`Regresi tata letak: ${next.latest.findings} temuan baru setelah versi tanpa temuan mekanis. Hasil terbaru tetap tersimpan; versi sebelumnya tersedia untuk ditinjau.`}:{})});},
  settings: defaultSettings,
  settingsLoaded: false,
  bootError:"",
  selectedSlideId: null,
  activeCommentId: null,
  setActiveComment: (id) => set({ activeCommentId: id }),
  status: "idle",
  statusMessage: "",
  streamingReasoning: "", streamingText: "",
  liveTools: [],
  toast: null,

  boot: async () => {
    if(bootInFlight)return bootInFlight;
    bootInFlight=(async()=>{set({bootError:"",settingsLoaded:false});try {
      const [settings, decks, templates] = await Promise.all([api.getSettings(), api.listDecks(), api.listTemplates()]);
      let active = decks.length ? await api.getDeck(decks[0].id) : null;
      if(decks.length&&!active)throw Error("Proyek terakhir tidak bisa dibaca. Tidak membuat proyek pengganti.");
      if (!active) active = await api.createDeck("Untitled deck", settings.baseUrl ? "4:5" : "4:5");
      const [messages, comments, freshDecks, references] = await Promise.all([api.listMessages(active.id), api.listComments(active.id), api.listDecks(), api.referenceData(active.id).catch(() => [])]);
      rememberPersisted(active);
      const draft=readLocalDraft(active.id);const recoverableDraft=draft&&JSON.stringify(draft.deck)!==JSON.stringify(active)?draft:null;if(draft&&!recoverableDraft)clearLocalDraft(active.id);
      set({ ...cleanProjectReview(),recoverableDraft,settings: { ...defaultSettings, ...settings }, settingsLoaded: true, decks: freshDecks, templates, deck: active, selectedSlideId: active.slides[0]?.id ?? null, messages, comments, references });
      void get().refreshLints(active.id);
    } catch (err) {
      set({ settingsLoaded: true,bootError:"Data studio belum bisa dibuka. Data lokal tidak dihapus. Coba lagi; jangan membuat proyek pengganti sebelum data lama terbaca." });
      get().notify("error", `Gagal membuka studio: ${String(err)}`);
    }finally{bootInFlight=null;}})();return bootInFlight;
  },

  refreshDecks: async () => {const request=++deckListRequest;const decks=await api.listDecks();if(request===deckListRequest)set({decks});},
  refreshTemplates: async () => {const request=++templateListRequest;const templates=await api.listTemplates();if(request===templateListRequest)set({templates});},

  openDeck: async (id) => {
    window.dispatchEvent(new Event('desel-before-context-switch'));
    if(get().status!=="idle")return get().notify("info","Tunggu proses agent selesai atau hentikan sebelum pindah proyek.");
    const request=++openEpoch;const source=get().deck;try{await flushDeck(source);}catch(err){get().notify("error",`Perubahan belum tersimpan. Simpan salinan pemulihan sebelum pindah: ${String(err)}`);return;}
    if(request!==openEpoch)return;
    try{
    const deck = await api.getDeck(id);
    if(request!==openEpoch)return;
    if (!deck) return get().notify("error", "Project tidak ditemukan.");
    rememberPersisted(deck);
    const [messages, comments, references] = await Promise.all([api.listMessages(id), api.listComments(id), api.referenceData(id).catch(() => [])]);
    if(request!==openEpoch)return;
    if(get().deck!==source){get().notify("info","Edit terbaru tetap terbuka. Pilih proyek lagi setelah menyimpan.");return;}
    const draft=readLocalDraft(deck.id);const recoverableDraft=draft&&JSON.stringify(draft.deck)!==JSON.stringify(deck)?draft:null;
    set({ ...cleanProjectReview(),recoverableDraft,deck,saveState:"saved",saveError:"", messages, comments, references, selectedSlideId: deck.slides[0]?.id ?? null, activeCommentId: null, streamingReasoning: "", streamingText: "", liveTools: [], lints: {} });
    void get().refreshLints(id);
    }catch(err){if(request===openEpoch)get().notify("error",`Proyek belum dibuka; versi yang terbuka tetap aman: ${String(err)}`);}
  },

  newDeck: async (templateId) => {
    window.dispatchEvent(new Event('desel-before-context-switch'));
    if(get().status!=="idle")return get().notify("info","Hentikan agent sebelum membuat proyek baru.");
    if(creatingProject)return;creatingProject=true;
    const request=++openEpoch;const source=get().deck;let committed=false;
    try {
      await flushDeck(source);
      const template = templateId ? get().templates.find((t) => t.id === templateId) : undefined;
      const deck = await api.createDeck(template?.name ?? "Untitled deck", template?.deck.aspect??get().deck.aspect, templateId ?? null);
      committed=true;rememberPersisted(deck);
      if(request!==openEpoch||get().deck!==source){await get().refreshDecks();get().notify("info","Proyek baru tersimpan di daftar; edit terbaru tetap terbuka.");return;}
      set({ ...cleanProjectReview(),deck,saveState:"saved",saveError:"",recoverableDraft:null,draftWarning:false, messages: [], comments: [], references: [], selectedSlideId: deck.slides[0]?.id ?? null, streamingReasoning: "", streamingText: "", liveTools: [] });
      void get().refreshLints(deck.id);
      await get().refreshDecks();
      if(get().deck.id!==deck.id)return;get().notify("ok", templateId ? "Project baru dibuat dari template." : "Project kosong dibuat. Mulai dari brief kamu.");
    } catch (err) { get().notify("error",committed?`Proyek baru tersimpan, tetapi daftar proyek belum dimuat. Jangan buat ulang. ${String(err)}`:String(err).replace(/^Error:\s*/, "")); }finally{creatingProject=false;}
  },

  loadSample: async () => {
    window.dispatchEvent(new Event('desel-before-context-switch'));
    if(get().status!=="idle")return get().notify("info","Hentikan agent sebelum membuka contoh.");
    if(creatingProject)return;creatingProject=true;
    const request=++openEpoch;const source=get().deck;let committed=false;
    try {
      await flushDeck(source);
      const existing = get().decks.find((d) => d.title === "Editorial print — contoh");
      if (existing) {
        await get().openDeck(existing.id);
        if(get().deck.id===existing.id)get().notify("info", "Contoh deck sudah ada - dibuka lagi.");
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
      await api.saveDeck(deck);committed=true;rememberPersisted(deck);
      if(request!==openEpoch||get().deck!==source){await get().refreshDecks();get().notify("info","Contoh tersimpan di daftar; edit terbaru tetap terbuka.");return;}
      set({ ...cleanProjectReview(),deck,saveState:"saved",saveError:"",recoverableDraft:null,draftWarning:false, messages: [], comments: [], references: [], selectedSlideId: deck.slides[0].id, streamingReasoning: "", streamingText: "", liveTools: [], lints: {} });
      await get().refreshDecks();
      if(get().deck.id!==deck.id)return;void get().refreshLints(deck.id);
      get().notify("ok", "Contoh deck dimuat — patokan visual yang bisa kamu pakai atau ubah.");
    } catch (err) {
      get().notify("error",committed?`Contoh tersimpan, tetapi daftar proyek belum dimuat. Jangan buat ulang. ${String(err)}`:String(err).replace(/^Error:\s*/, ""));
    }finally{creatingProject=false;}
  },

  deleteDeck: async (id) => {
    if(get().status!=="idle")return get().notify("info","Hentikan agent sebelum menghapus proyek.");
    ++openEpoch;
    if(id!==get().deck.id){try{await flushDeck(get().deck);}catch(err){get().notify("error",String(err));return;}}
    const canceledSave=saveTimer?get().deck:null;if(saveTimer){clearTimeout(saveTimer);saveTimer=undefined;}await saveQueue.catch(()=>undefined);
    try{await api.deleteDeck(id);}catch(err){if(canceledSave&&get().deck.id===canceledSave.id&&!saveTimer)scheduleSave(get().deck);throw err;}deletedProjects.add(id);if(get().deck.id===id&&saveTimer){clearTimeout(saveTimer);saveTimer=undefined;}clearLocalDraft(id);persisted.delete(id);remoteEpoch.set(id,(remoteEpoch.get(id)??0)+1);++deckListRequest;
    const retired=get().deck.id===id?emptyDeckRecord():null;
    if(retired)set({...cleanProjectReview(),deck:retired,saveState:"saved",saveError:"",recoverableDraft:null,draftWarning:false,messages:[],comments:[],references:[],selectedSlideId:null,decks:get().decks.filter(d=>d.id!==id)});
    else set({decks:get().decks.filter(d=>d.id!==id)});
    try{
      const listRequest=++deckListRequest;const decks=await api.listDecks();if(listRequest!==deckListRequest)return;set({decks});
      if(!retired||get().deck!==retired)return;
      const next=decks[0]?await api.getDeck(decks[0].id):await api.createDeck();
      const [messages,comments,references]=next?await Promise.all([api.listMessages(next.id),api.listComments(next.id),api.referenceData(next.id)]):[[],[],[]];
      if(get().deck!==retired)return;
      if(next)rememberPersisted(next);
      set({...cleanProjectReview(),deck:next??retired,saveState:"saved",saveError:"",recoverableDraft:null,draftWarning:false,references,messages,comments,selectedSlideId:next?.slides[0]?.id??null});
      await get().refreshDecks();
    }catch(err){get().notify("error",`Proyek sudah dihapus, tetapi proyek berikutnya belum selesai dimuat. Muat ulang daftar atau pilih proyek lagi. ${String(err)}`);}
  },

  duplicateDeck: async (id) => {
    window.dispatchEvent(new Event('desel-before-context-switch'));
    if(get().status!=="idle")return get().notify("info","Hentikan agent sebelum menduplikasi proyek.");
    if(duplicatingProjects.has(id))return;duplicatingProjects.add(id);
    const source=get().deck;const request=++openEpoch;let committed=false;
    try{
      await flushDeck(source);
      const deck = await api.duplicateDeck(id);committed=true;
      await get().refreshDecks();
      if(request!==openEpoch||get().deck!==source){get().notify("info","Duplikat tersimpan di daftar; edit terbaru tetap terbuka.");return;}
      await get().openDeck(deck.id);
      if(get().deck.id===deck.id)get().notify("ok", "Project diduplikasi.");else if(get().deck===source)get().notify("info",`Duplikat tersimpan, tetapi belum dibuka. ${get().toast?.text??""}`);
    }catch(err){if(request===openEpoch)get().notify("error",committed?`Duplikat tersimpan, tetapi daftar proyek belum dimuat. Jangan duplikasi ulang; buka salinan yang sudah ada setelah memuat ulang daftar. ${String(err)}`:String(err));}finally{duplicatingProjects.delete(id);}
  },

  saveRecoveryCopy:async()=>{window.dispatchEvent(new Event("desel-before-context-switch"));if(get().status!=="idle"||get().savingRecoveryCopy)return;set({savingRecoveryCopy:true});const draft=get().deck;let committed=false;let adopted:Deck|null=null;try{if(saveTimer){clearTimeout(saveTimer);saveTimer=undefined;}await saveQueue.catch(()=>undefined);const copy=await api.saveRecoveryCopy(draft);committed=true;if(get().deck!==draft){get().notify("info","Salinan pemulihan tersimpan di daftar proyek; edit terbaru tetap terbuka.");await get().refreshDecks();return;}const comments=await api.listComments(copy.id);if(get().deck!==draft){await get().refreshDecks();get().notify("info","Salinan tersimpan; edit yang lebih baru tetap terbuka.");return;}adopted=copy;rememberPersisted(copy);clearLocalDraft(draft.id);saveQueue=Promise.resolve();set({...cleanProjectReview(),recoverableDraft:null,draftWarning:false,deck:copy,saveState:"saved",saveError:"",messages:[],comments,references:[],selectedSlideId:copy.slides[0]?.id??null,reviewHistory:{}});const refRequest=++referenceRequest;const references=await api.referenceData(copy.id);if(refRequest===referenceRequest&&get().deck.id===copy.id)set({references});await get().refreshDecks();if(get().deck.id!==copy.id)return;await get().refreshHistory();if(get().deck.id!==copy.id)return;get().notify("ok","Edit lokal disimpan sebagai proyek baru. Versi sebelumnya tetap utuh.");}catch(e){if(committed){if(adopted&&get().deck.id!==adopted.id)return;try{await get().refreshDecks();}catch{/* keep original read failure */}if(adopted&&get().deck.id!==adopted.id)return;get().notify("error",`Salinan pemulihan tersimpan, tetapi data lanjutan belum dimuat. Jangan buat salinan lagi; buka salinan yang sudah ada di daftar proyek. ${String(e)}`);}else get().notify("error",String(e));}finally{set({savingRecoveryCopy:false});}},
  historyCounts:[0,0],
  refreshHistory:async()=>{const id=get().deck.id,request=++historyRequest;const historyCounts=await api.deckHistoryCounts(id);if(request===historyRequest&&get().deck.id===id)set({historyCounts});},
  stepHistory:async(direction)=>{
    if(steppingHistory||get().status!=="idle")return;
    steppingHistory=true;
    window.dispatchEvent(new Event("desel-before-context-switch"));
    const before=get().deck;
    try{
      await flushDeck(before);
      if(get().deck!==before)throw Error("Project berubah saat menyimpan; coba lagi.");
      const deck=await api.stepDeckHistory(before,direction);rememberPersisted(deck);
      if(get().deck!==before){get().notify("info","Riwayat berubah, tetapi edit lokal terbaru tetap dipertahankan. Simpan untuk melanjutkan.");return;}
      // History has committed. Adopt its deck before optional follow-up reads;
      // a failed notes/list request must not leave the editor on the old version.
      set({deck,saveState:"saved",saveError:"",selectedSlideId:deck.slides.some(s=>s.id===get().selectedSlideId)?get().selectedSlideId:deck.slides[0]?.id??null,comments:get().comments.filter(c=>deck.slides.some(s=>s.id===c.slideId)),activeCommentId:null,revisions:[],reviewHistory:{},lints:{}});
      void get().refreshLints(deck.id);
      const failures:string[]=[];
      try{const comments=await api.listComments(deck.id);if(get().deck===deck)set({comments});}catch(err){failures.push(`Catatan: ${String(err)}`);}
      try{await get().refreshHistory();}catch(err){failures.push(`Riwayat: ${String(err)}`);}
      try{await get().refreshDecks();}catch(err){failures.push(`Daftar proyek: ${String(err)}`);}
      if(get().deck.id===deck.id)get().notify(failures.length?"error":"ok",failures.length?`Perubahan riwayat tersimpan, tetapi data pendukung belum dimuat. ${failures.join("; ")}`:direction==="undo"?"Perubahan proyek dibatalkan.":"Perubahan proyek diulang.");
    }catch(err){get().notify("error",String(err));}finally{steppingHistory=false;}
  },
  saveDeck: async () => {
    window.dispatchEvent(new Event("desel-before-context-switch"));
    if(saveTimer){clearTimeout(saveTimer);saveTimer=undefined;}
    const saved=get().deck;
    const failureEpoch=saveFailureEpoch;
    await persistDeck(saved);
    if(get().deck===saved)void get().refreshLints(saved.id);
    const failures:string[]=[];
    try{await get().refreshHistory();}catch(err){failures.push(`Riwayat: ${String(err)}`);}
    try{await get().refreshDecks();}catch(err){failures.push(`Daftar proyek: ${String(err)}`);}
    if(get().deck.id===saved.id&&saveFailureEpoch===failureEpoch)get().notify(failures.length?"error":"ok",failures.length?`Perubahan tersimpan, tetapi data pendukung belum dimuat. ${failures.join("; ")}`:"Tersimpan ke database lokal.");
  },

  updateDeck: (patch) => {
    const deck = touched(get().deck, patch);
    set({ deck });
    scheduleSave(deck);
  },

  selectSlide: (id) => {window.dispatchEvent(new Event('desel-before-context-switch'));set({ selectedSlideId: id });},

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
    window.dispatchEvent(new Event('desel-before-context-switch'));
    const slide: Slide = { id: localId("sl"), title: `Slide ${get().deck.slides.length + 1}`, html: "<!doctype html><html><head><meta charset=\"utf-8\"><style>*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#151515;color:#f5f2ec;font-family:Arial,sans-serif}.canvas{height:100%;display:grid;place-items:center;color:#6d6a64;font-size:32px}</style></head><body><div class=\"canvas\">Minta agent mendesain slide ini</div></body></html>", rationale: "", hidden: false };
    const dimensions=geometryAspect(get().deck.aspect);slide.html=slide.html.replace("width:1080px;height:1350px",`width:${dimensions.w}px;height:${dimensions.h}px`);
    const deck = touched(get().deck, { slides: [...get().deck.slides, slide] });
    set({ deck, selectedSlideId: slide.id }); scheduleSave(deck); void get().refreshLints(deck.id);
  },

  duplicateSlide: (id) => {
    window.dispatchEvent(new Event('desel-before-context-switch'));
    const slides = [...get().deck.slides]; const index = slides.findIndex(s => s.id === id); if (index < 0) return;
    const copy = { ...slides[index], id: localId("sl"), title: `${slides[index].title} copy` }; slides.splice(index + 1, 0, copy);
    const deck = touched(get().deck, { slides }); set({ deck, selectedSlideId: copy.id }); scheduleSave(deck); void get().refreshLints(deck.id);
  },

  deleteSlide: (id) => {
    window.dispatchEvent(new Event('desel-before-context-switch'));
    const slides = get().deck.slides.filter(s => s.id !== id);
    const deck = touched(get().deck, { slides });
    set({ deck, selectedSlideId: get().selectedSlideId === id ? slides[0]?.id ?? null : get().selectedSlideId, comments: get().comments.filter(c => c.slideId !== id) }); scheduleSave(deck); void get().refreshLints(deck.id);
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
    window.dispatchEvent(new Event('desel-before-context-switch'));
    const text = raw.trim(); if (!text || get().status !== "idle") return false;
    const source=get().deck;
    try{await flushDeck(source);}catch(err){get().notify("error",`Simpan perubahan gagal; agent belum dimulai: ${String(err)}`);return false;}
    if(get().status!=="idle")return false;
    if(get().deck.id!==source.id){get().notify("info","Proyek berubah saat menyimpan. Pesan belum dikirim; tinjau proyek lalu kirim lagi.");return false;}
    const deckId = source.id;
    const userMsg: ChatMessage = { id: localId("msg"), deckId, role: "user", content: text, createdAt: new Date().toISOString() };
    set({ status: "generating", statusMessage: "Agent bekerja", messages: [...get().messages, userMsg], streamingReasoning: "", streamingText: "", liveTools: [] });
    let runError=false;
    let endReason="";
    try {
      await api.sendToAgent(deckId, text, (event: AgentEvent) => {if(event.type==="error")runError=true;if(event.type==="done")endReason=event.reason;applyAgentEvent(event, set, get)});
      const [messages, deck, comments] = await Promise.all([api.listMessages(deckId), api.getDeck(deckId), api.listComments(deckId)]);
      const merge=deck?reconcileDeck(persisted.get(deck.id),get().deck,deck):null;
      if(deck)rememberPersisted(deck);if(merge?.retained)scheduleSave(merge.deck);
      set({ messages, ...(merge ? { deck:merge.deck,...(!merge.retained?{saveState:"saved" as const,saveError:""}:{}) } : {}), comments, streamingReasoning: "", streamingText: "", liveTools: [], status: "idle", statusMessage: runError ? "Proses terputus. Hasil tersimpan dimuat; periksa sebelum lanjut." : Object.values(get().reviewHistory).some(r=>r.regressed) ? "Regresi tata letak: hasil terbaru tersimpan; versi tanpa temuan mekanis tersedia untuk ditinjau, bukan otomatis dipulihkan." : endReason === "review_required" ? "Hasil tersimpan, review wajib: temuan tersisa atau render belum terverifikasi." : endReason === "cancelled" ? "Dihentikan. Hasil tersimpan tetap ada; kirim pesan untuk lanjut." : endReason === "max_turns" ? "Batas langkah tercapai. Hasil tersimpan; lanjutkan lewat chat." : "" });
      await get().refreshDecks();
      await get().refreshHistory();
      await get().refreshReferences(deckId);
      // The render checker settles asynchronously after canvas updates.
      // Do not equate model completion with a reviewed, usable deck.
      if(!Object.values(get().reviewHistory).some(r=>r.regressed)&&!runError&&!endReason.includes("cancel")&&endReason!=="max_turns"&&endReason!=="review_required")set({statusMessage:"Hasil tersimpan. Periksa preview dan temuan review sebelum digunakan."});
      return !runError;
    } catch (err) {
      // Transport failure does not mean persisted tool writes rolled back.
      try{const [deck,messages]=await Promise.all([api.getDeck(deckId),api.listMessages(deckId)]);if(deck&&get().deck.id===deckId){const merge=reconcileDeck(persisted.get(deck.id),get().deck,deck);rememberPersisted(deck);set({deck:merge.deck,messages});if(merge.retained)scheduleSave(merge.deck);}}catch{/* keep the current canvas; never retry generation automatically */}
      set({ status: "idle", statusMessage: "Pesan belum terkirim. Hasil tersimpan dimuat kembali; periksa sebelum lanjut.", streamingReasoning: "", streamingText: "",liveTools:[] });
      get().notify("error", String(err));
      return false;
    }
  },

  stopAgent: async () => {
    if (get().status !== "generating") return;
    try {
      set({statusMessage:"Menghentikan agent; hasil yang tersimpan tetap ada."});
      await api.cancelAgent(get().deck.id);
    } catch { /* the Done event settles the state either way */ }
  },

  clearChat: async () => {
    if(get().status!=="idle")return get().notify("info","Hentikan agent sebelum membersihkan chat.");
    const target=get().deck.id;
    try{await api.clearMessages(target);if(get().deck.id===target)set({ messages: [], streamingReasoning: "", streamingText: "", liveTools: [] });}
    catch(err){get().notify("error",`Chat belum dibersihkan: ${String(err)}`);}
  },

  saveTemplate: async (name, description) => {
    window.dispatchEvent(new Event("desel-before-context-switch"));
    await api.saveTemplate(name, description, get().deck);
    try{await get().refreshTemplates();}
    catch(err){get().notify("error",`Template tersimpan, tetapi daftar belum dimuat. Jangan simpan ulang; buka ulang pustaka. ${String(err)}`);return;}
    get().notify("ok", "Desain disimpan sebagai template reusable.");
  },
  deleteTemplate: async (id) => {
    await api.deleteTemplate(id);
    // Remove the confirmed-deleted record even if the subsequent list read fails.
    ++templateListRequest;
    set({templates:get().templates.filter(t=>t.id!==id)});
    try{await get().refreshTemplates();}
    catch(err){get().notify("error",`Template dihapus, tetapi daftar belum dimuat ulang. ${String(err)}`);}
  },

  addComment: async (slideId, x, y, body, selector) => {
    const target=get().deck.id;const c = await api.addComment({ deckId: target, slideId, x, y, body, selector, author: "user" });
    if(get().deck.id!==target)return;
    set({ comments: [...get().comments, c], activeCommentId: c.id });
  },
  setCommentStatus: async (id, status) => { const target=get().deck.id;await api.setCommentStatus(id, status);if(get().deck.id!==target)return;set({ comments: get().comments.map(c => c.id === id ? { ...c, status } : c) }); },
  deleteComment: async (id) => { const target=get().deck.id;await api.deleteComment(id);if(get().deck.id!==target)return;set({ comments: get().comments.filter(c => c.id !== id), activeCommentId: get().activeCommentId===id?null:get().activeCommentId }); },

  refreshReferences: async (deckId) => {
    const target = deckId ?? get().deck.id;const request=++referenceRequest;
    try { const references=await api.referenceData(target);if(request===referenceRequest&&get().deck.id===target)set({references:references.map(asset=>{if(!referenceIntentVersions.has(JSON.stringify([target,asset.id])))return asset;const pending=get().references.find(r=>r.id===asset.id);return pending?{...asset,referenceRole:pending.referenceRole,referenceStatus:pending.referenceStatus}:asset})}); }
    catch (err) { if(request===referenceRequest&&get().deck.id===target)get().notify("error", `Gagal memuat referensi: ${String(err)}`); }
  },

  attachReferenceData: async (name, dataUrl) => {
    try {
      const target=get().deck.id;await api.addReferenceData(target, name, dataUrl);
      if(get().deck.id!==target)return;
      await get().refreshReferences(target);
      get().notify("ok", `Referensi "${name}" ditambahkan. Agent akan memakainya sebagai arah rasa.`);
    } catch (err) { get().notify("error", `Gagal menambah referensi: ${String(err)}`); }
  },

  attachReferencePaths: async (paths) => {
    try {
      const target=get().deck.id;await api.addReferencePaths(target, paths);
      if(get().deck.id!==target)return;
      await get().refreshReferences(target);
      get().notify("ok", `${paths.length} referensi ditambahkan.`);
    } catch (err) { get().notify("error", `Gagal menambah referensi: ${String(err)}`); }
  },

  refreshLints: async (deckId) => {
    const target = deckId ?? get().deck.id;
    if (!target) return;
    const request=++lintRequest;const snapshot=get().deck;
    try {
      const rows = await api.lintDeck(target);
      const map: Record<string, LintIssue[]> = {};
      for (const row of rows) if (row.issues.length) map[row.slideId] = row.issues;
      if (request===lintRequest&&get().deck===snapshot&&get().deck.id === target) {
        // Keep any geometry findings already merged; the string linter cannot
        // see them and must not wipe them on every refresh.
        const geo: Record<string, LintIssue[]> = {};
        for (const [sid, issues] of Object.entries(get().lints)) {
          const keep = issues.filter((i) => geometryRules.has(i.rule));
          if (keep.length) geo[sid] = keep;
        }
        for (const [sid, issues] of Object.entries(geo)) {
          map[sid] = [...(map[sid] ?? []), ...issues];
        }
        set({ lints: map });
      }
    } catch { /* review is advisory; never block the studio */ }
  },

  mergeGeometryLints: (geo) => {
    const next: Record<string, LintIssue[]> = {};
    const current = get().lints;
    const slideIds = new Set([...Object.keys(current), ...Object.keys(geo)]);
    for (const sid of slideIds) {
      const kept = (current[sid] ?? []).filter((i) => !geometryRules.has(i.rule));
      const merged = [...kept, ...(geo[sid] ?? [])];
      if (merged.length) next[sid] = merged;
    }
    const hasGeometry=Object.values(geo).some(issues=>issues.length>0);
    set({ lints: next,...(hasGeometry&&get().status==="idle"&&!Object.values(get().reviewHistory).some(r=>r.regressed)?{statusMessage:"Hasil tersimpan, perlu review tata letak. Periksa temuan sebelum digunakan."}:{}) });
  },

  refreshRevisions: async (slideId) => {
    const request=++revisionRequest;
    const target = slideId ?? get().selectedSlideId ?? get().deck.slides[0]?.id;
    if (!target) {
      set({ revisions: [] });
      return;
    }
    const deckId=get().deck.id;
    try {
      const history=readReviewHistory(deckId,target);const revisions=await api.listRevisions(target);if(request===revisionRequest&&get().deck.id===deckId&&(get().selectedSlideId===target||(!get().selectedSlideId&&get().deck.slides[0]?.id===target)))set({revisions,...(history&&!get().reviewHistory[target]?{reviewHistory:{...get().reviewHistory,[target]:history}}:{})});
    } catch {
      if(request===revisionRequest&&get().deck.id===deckId&&get().selectedSlideId===target)set({ revisions: [] });
    }
  },

  restoreRevision: async (id) => {
    window.dispatchEvent(new Event("desel-before-context-switch"));
    if(get().status!=="idle")return false;
    const before=get().deck;
    try {
      await flushDeck(before);
      if(get().deck!==before)throw Error("Project berubah; pemulihan versi dibatalkan.");
      const deck = await api.restoreRevision(id);rememberPersisted(deck);
      if(get().deck!==before){await get().refreshDecks();get().notify("info","Versi dipulihkan di database; edit lokal terbaru tetap terbuka.");return false;}
      set({ deck,saveState:"saved",saveError:"" });
      // The restore is already committed. A supporting read failing must not
      // tell the comparison dialog to retry a mutation that succeeded.
      const failures:string[]=[];
      try{await get().refreshHistory();}catch(err){failures.push(`Riwayat: ${String(err)}`);}
      await get().refreshRevisions();
      try{await get().refreshDecks();}catch(err){failures.push(`Daftar proyek: ${String(err)}`);}
      void get().refreshLints(deck.id);
      if(get().deck.id===deck.id)get().notify(failures.length?"error":"ok",failures.length?`Versi dipulihkan, tetapi data pendukung belum dimuat. ${failures.join("; ")}`:"Versi sebelumnya dipulihkan.");return true;
    } catch (err) {
      get().notify("error", String(err).replace(/^Error:\s*/, ""));return false;
    }
  },

  attachReferenceUrl: async (url) => {
    try {
      const target=get().deck.id;const refs = await api.addReferenceUrl(target, url);
      if(get().deck.id!==target)return true;
      set({ references: refs });
      get().notify("ok", "Referensi ditambahkan dari link.");return true;
    } catch (err) {
      get().notify("error", String(err).replace(/^Error:\s*/, ""));return false;
    }
  },

  setReferenceIntent: async(id,role,status)=>{
    if(!["","cover","body","closer","asset"].includes(role)||!["","candidate","approved","rejected"].includes(status)){get().notify("error","Pilihan referensi tidak valid.");return;}
    const target=get().deck.id,key=JSON.stringify([target,id]);
    if(!get().references.some(r=>r.id===id))return;
    const version=(referenceIntentVersions.get(key)??0)+1;referenceIntentVersions.set(key,version);
    set({references:get().references.map(r=>r.id===id?{...r,referenceRole:role as Asset["referenceRole"],referenceStatus:status as Asset["referenceStatus"]}:r)});
    const write=(referenceIntentWrites.get(key)??Promise.resolve()).catch(()=>undefined).then(()=>api.setReferenceIntent(target,id,role,status));
    referenceIntentWrites.set(key,write);
    try{await write;}catch(err){get().notify("error",`Pilihan referensi belum tersimpan: ${String(err)}`);}
    finally{if(referenceIntentVersions.get(key)===version){referenceIntentWrites.delete(key);referenceIntentVersions.delete(key);await get().refreshReferences(target);}}
  },
  removeReference: async (id) => {
    const target=get().deck.id;
    try {
      await api.deleteReference(id);
      if(get().deck.id!==target)return;
      ++referenceRequest; // Reads begun before the deletion cannot revive it.
      set({ references: get().references.filter(r => r.id !== id) });
    } catch (err) { get().notify("error", `Gagal menghapus referensi: ${String(err)}`); }
  },

  saveSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    try { await api.saveSettings(settings);set({settings});get().notify("ok", "Pengaturan tersimpan di database lokal."); }
    catch (err) { get().notify("error", `Gagal menyimpan settings: ${String(err)}`);throw err; }
  },

  setStatus: (status, statusMessage = "") => set({ status, statusMessage }),
  notify: (kind, text) => set({ toast: { kind, text } }),
  clearToast: () => set({ toast: null }),
}));

function applyAgentEvent(event: AgentEvent, set: (partial: Partial<StudioState>) => void, get: () => StudioState) {
  switch (event.type) {
    case "turn_start": set({ statusMessage: event.turn === 1 ? "Membaca brief" : `Agent lanjut · langkah ${event.turn}` }); break;
    case "render_request": window.dispatchEvent(new CustomEvent("desel-render-request",{detail:event}));set({statusMessage:"Merender slide untuk pemeriksaan visual"});break;
    case "reasoning_delta": set({streamingReasoning:get().streamingReasoning+event.text,statusMessage:"Thinking - output provider"});break;
    case "text_delta": set({ streamingText: get().streamingText + event.text, statusMessage: "Menulis" }); break;
    case "tool_call": {
      const call: ToolCallRecord = { id: event.id, name: event.name, args: event.args, state: "running" };
      set({ liveTools: [...get().liveTools, call], statusMessage: labelTool(event.name) }); break;
    }
    case "tool_result": set({ liveTools: get().liveTools.map(t => t.id === event.id ? { ...t, state: event.ok ? "done" : "error", result: event.result } : t) }); break;
    case "deck_updated": {
      // Live editing: follow the slide the agent is actually changing,
      // not blindly the last one.
      const follow = followChangedSlideId(get().deck.slides, event.deck.slides, get().selectedSlideId);
      const merge=reconcileDeck(persisted.get(event.deck.id),get().deck,event.deck);
      rememberPersisted(event.deck);
      set({ deck: merge.deck, ...(follow ? { selectedSlideId: follow } : {}) });
      if(merge.retained){scheduleSave(merge.deck);if(merge.conflicts)get().notify("info","Edit lokal dipertahankan saat hasil agent tiba. Kedua versi masuk riwayat; periksa slide sebelum lanjut.");}
      void get().refreshLints(event.deck.id);
      break;
    }
    case "done": set({ statusMessage: event.reason === "question" ? "Menunggu jawaban" : event.reason === "cancelled" ? "Dihentikan; hasil tersimpan tetap ada." : event.reason === "max_turns" ? "Belum selesai: batas langkah tercapai." : "Generasi berhenti; pemeriksaan hasil belum berarti lolos kualitas." }); break;
    case "error": set({ statusMessage: "Proses gagal; menunggu penyimpanan dan pemulihan state selesai." }); get().notify("error", event.message); break;
  }
}
function labelTool(name: string) {
  const labels: Record<string, string> = { review_render:"Memeriksa render",import_image:"Mengunduh aset",github_trending:"Membaca GitHub Trending", search_web: "Riset web", fetch_url: "Membaca sumber", read_deck: "Membaca deck", set_deck_meta: "Menetapkan art direction", write_slide: "Menulis kode slide", patch_slide: "Mengedit slide", delete_slide: "Menghapus slide", save_template: "Menyimpan template", load_template: "Memuat template", ask_user: "Bertanya" };
  return labels[name] ?? name;
}

export type { AgentEvent, AppSettings, ChatMessage, Comment, Deck, DeckSummary, Slide, TemplateRecord, ToolCallRecord };

// Dev-only test hook: lets automated drivers exercise store transitions the
// way deck_updated events would. Not used by the app itself.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __studio: typeof useStudio }).__studio = useStudio;
}

if(typeof window!=="undefined")window.addEventListener("beforeunload",e=>{if(useStudio.getState().saveState!=="saved"){e.preventDefault();e.returnValue="";}});
