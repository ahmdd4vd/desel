export type RunMode='discuss'|'edit'|'produce';
export interface LockedObject{slideId:string;selector:string;label:string}
export interface ChatScope{mode:RunMode;slideId?:string;objectContext?:{slideId:string;selector:string;label:string};assetIds:string[];lockedSlideIds:string[];lockedObjects:LockedObject[]}
export interface QueuedBrief{id:string;text:string;scope:ChatScope;createdAt:string}
export interface ProjectMemory{id:string;kind:'brief'|'audience'|'brand'|'decision'|'fact';text:string;source:string;pinned:boolean;updatedAt:string}
export interface CreatorWorkspace{draft:string;queue:QueuedBrief[];memory:ProjectMemory[];mode:RunMode;lockedSlideIds:string[];lockedObjects:LockedObject[]}
const prefix='desel.creator.v1.';
export const blankWorkspace=():CreatorWorkspace=>({draft:'',queue:[],memory:[],mode:'produce',lockedSlideIds:[],lockedObjects:[]});
function normLocks(v:unknown):LockedObject[]{
 if(v===undefined||v===null)return[]; // workspaces saved before object locks existed
 if(!Array.isArray(v))throw Error('Kunci objek tidak terbaca.');
 if(v.some(o=>!o||typeof o.slideId!=='string'||typeof o.selector!=='string'||typeof o.label!=='string'))throw Error('Kunci objek tidak valid.');
 return v;
}
export function readWorkspace(id:string):CreatorWorkspace{
 const raw=localStorage.getItem(prefix+id);if(raw===null)return blankWorkspace();const d=JSON.parse(raw);
 if(!d||typeof d.draft!=='string'||!Array.isArray(d.queue)||!Array.isArray(d.memory)||!['discuss','edit','produce'].includes(d.mode)||!Array.isArray(d.lockedSlideIds))throw Error('Data Creator Studio tidak terbaca. Data lama tetap disimpan.');
 if(d.queue.some((q:QueuedBrief)=>!q||typeof q.id!=='string'||typeof q.text!=='string'||!q.scope||!['discuss','edit','produce'].includes(q.scope.mode)||!Array.isArray(q.scope.assetIds)||!Array.isArray(q.scope.lockedSlideIds)))throw Error('Antrean tidak valid; tidak dijalankan.');
 if(d.memory.some((m:ProjectMemory)=>!m||typeof m.id!=='string'||typeof m.text!=='string'||typeof m.source!=='string'||typeof m.pinned!=='boolean'||!['brief','audience','brand','decision','fact'].includes(m.kind)))throw Error('Memori proyek tidak valid; tidak dikirim.');
 return{...d,lockedObjects:normLocks(d.lockedObjects),queue:d.queue.map((q:QueuedBrief)=>({...q,scope:{...q.scope,lockedObjects:normLocks(q.scope.lockedObjects)}}))};
}
export function saveWorkspace(id:string,value:CreatorWorkspace){const text=JSON.stringify(value);if(text.length>512*1024)throw Error('Data Creator Studio melebihi 512 KB. Kurangi antrean/memori.');localStorage.setItem(prefix+id,text);void import('./api').then(({api})=>api.saveCreatorWorkspace(id,value)).catch(e=>console.warn('Creator workspace native mirror failed; WebView copy remains',e));}
/** When the WebView copy is missing (storage cleared / moved machine), restore from the native mirror after validating it. */
export async function hydrateWorkspace(id:string):Promise<CreatorWorkspace|null>{
 if(localStorage.getItem(prefix+id)!==null)return null;
 const{api}=await import('./api');const remote=await api.getCreatorWorkspace(id);if(!remote)return null;
 localStorage.setItem(prefix+id,JSON.stringify(remote));
 try{return readWorkspace(id)}catch{localStorage.removeItem(prefix+id);return null}
}
export interface CreatorRequest extends ChatScope{memory:ProjectMemory[];runId?:string}
export interface CreatorRun{id:string;deckId:string;state:string;lastEvent:string;updatedAt:string;request:{text:string;context?:CreatorRequest}}

export function selectMemory(memory:ProjectMemory[],brief:string,budget=12000):ProjectMemory[]{
 const words=new Set(brief.toLowerCase().split(/\W+/).filter(w=>w.length>3));let used=0;
 return [...memory].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||((b.text.toLowerCase().split(/\W+/).filter(w=>words.has(w)).length)-(a.text.toLowerCase().split(/\W+/).filter(w=>words.has(w)).length))||b.updatedAt.localeCompare(a.updatedAt)).filter(m=>{const size=m.text.length+m.source.length+100;if(used+size>budget)return false;used+=size;return true;});
}
