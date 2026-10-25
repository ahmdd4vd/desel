import type {Slide} from './types';
import {reviewRevision} from './render-review';
export type ReviewedSnapshot={revision:string;aspect:string;slide:Slide;at:string};
export type ReviewHistory={lastClear?:ReviewedSnapshot;latest:{revision:string;findings:number;error?:string};regressed:boolean};
/** Pure transition. Only revision-matched, successful receipts may become a
 * recovery candidate. Mechanical-zero is never visual/copy approval. */
export function recordReview(previous:ReviewHistory|undefined,slide:Slide,aspect:string,receipt:{revision:string;issues:unknown[];error?:string}):ReviewHistory|undefined{
 const revision=reviewRevision(slide.id,aspect,slide.html);if(receipt.revision!==revision)return previous;
 const clear=!receipt.error&&receipt.issues.length===0;
 const lastClear=clear?{revision,aspect,slide:{...slide},at:new Date().toISOString()}:previous?.lastClear;
 return{lastClear,latest:{revision,findings:receipt.issues.length,error:receipt.error},regressed:!!lastClear&&lastClear.revision!==revision&&(!clear)};
}
const key=(deckId:string,slideId:string)=>`desel.review-history.${deckId}.${slideId}`;
function validHistory(value:unknown,slideId:string):value is ReviewHistory{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const h=value as ReviewHistory,l=h.latest;
 if(typeof h.regressed!=="boolean"||!l||typeof l.revision!=="string"||!l.revision||!Number.isSafeInteger(l.findings)||l.findings<0||(l.error!==undefined&&typeof l.error!=="string"))return false;
 const clear=h.lastClear;
 if(clear!==undefined){const slide=clear?.slide;if(!clear||typeof clear.aspect!=="string"||typeof clear.at!=="string"||!Number.isFinite(Date.parse(clear.at))||!slide||slide.id!==slideId||typeof slide.html!=="string"||typeof slide.title!=="string"||typeof clear.revision!=="string"||reviewRevision(slide.id,clear.aspect,slide.html)!==clear.revision)return false;}
 return !h.regressed||!!clear&&clear.revision!==l.revision;
}
export function readReviewHistory(deckId:string,slideId:string):ReviewHistory|undefined{try{const value:unknown=JSON.parse(localStorage.getItem(key(deckId,slideId))||'null');return validHistory(value,slideId)?value:undefined}catch{return undefined}}
export function retainReview(deckId:string,slide:Slide,aspect:string,receipt:{revision:string;issues:unknown[];error?:string},session?:ReviewHistory){const next=recordReview(session??readReviewHistory(deckId,slide.id),slide,aspect,receipt);if(next)try{localStorage.setItem(key(deckId,slide.id),JSON.stringify(next))}catch{/* Keep current-session evidence; actual recovery additionally requires DB history. */}return next;}
