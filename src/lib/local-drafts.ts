import type{Deck}from './types';
export interface LocalDraft{deck:Deck;savedAt:string}
const KEY='desel.local-drafts.v1';const BUDGET=8*1024*1024;
function readAll(validateEntries=true):Record<string,LocalDraft>{const raw=localStorage.getItem(KEY);if(raw===null)return {};const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid draft storage');if(validateEntries)for(const [id,entry] of Object.entries(data)){const d=entry as LocalDraft;if(!d||!validDeck(d.deck,id)||typeof d.savedAt!=='string'||!Number.isFinite(Date.parse(d.savedAt)))throw Error('Invalid draft entry');}return data;}
function validDeck(value:unknown,id:string):value is Deck{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const deck=value as Deck;
 if(deck.id!==id||!id||!["4:5","1:1","9:16","16:9"].includes(deck.aspect))return false;
 if(![deck.title,deck.caption,deck.styleGuide,deck.brandHandle,deck.saveLabel,deck.createdAt,deck.updatedAt].every(v=>typeof v==="string")||!(deck.fromTemplateId===null||typeof deck.fromTemplateId==="string"))return false;
 if(!Array.isArray(deck.palette)||!deck.palette.every(v=>typeof v==="string")||!Array.isArray(deck.slides))return false;
 const ids=new Set<string>();
 for(const slide of deck.slides){if(!slide||typeof slide!=="object"||typeof slide.id!=="string"||!slide.id||ids.has(slide.id)||![slide.title,slide.html,slide.rationale].every(v=>typeof v==="string")||typeof slide.hidden!=="boolean")return false;ids.add(slide.id);}
 return true;
}
export function readLocalDraft(id:string):LocalDraft|null{try{const d=readAll(false)[id];return d&&validDeck(d.deck,id)&&typeof d.savedAt==='string'&&Number.isFinite(Date.parse(d.savedAt))?d:null;}catch{return null;}}
export function retainLocalDraft(deck:Deck):boolean{try{const all=readAll();all[deck.id]={deck,savedAt:new Date().toISOString()};let text=JSON.stringify(all);for(const id of Object.keys(all).sort((a,b)=>String(all[a].savedAt).localeCompare(String(all[b].savedAt)))){if(text.length<=BUDGET)break;if(id===deck.id)continue;delete all[id];text=JSON.stringify(all);}if(text.length>BUDGET)return false;localStorage.setItem(KEY,text);return true;}catch{return false}}
export function clearLocalDraft(id:string,ifMatching?:Deck):boolean{try{const all=readAll();if(ifMatching&&JSON.stringify(all[id]?.deck)!==JSON.stringify(ifMatching))return true;delete all[id];localStorage.setItem(KEY,JSON.stringify(all));return true;}catch{return false; /* database save remains authoritative */}}
