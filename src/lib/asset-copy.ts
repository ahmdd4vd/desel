import {api} from './api';
import type {Asset} from './types';

// Retain partially completed writes across dialog close/reopen within this workspace.
// A retry finishes the same copy instead of creating an uncredited duplicate.
export function createAssetCopySaver(){
 const pending=new Map<string,{id:string;name:string;data:string;metadataSaved:boolean}>();
 return async(source:Asset,target:string,name:string,data:string,refresh:()=>Promise<void>)=>{
  const key=JSON.stringify([target,source.id]);
  let copy=pending.get(key);
  if(copy&&(copy.name!==name||copy.data!==data)){
   // Only discard our incomplete, not-yet-delivered copy, never the source asset.
   if(!copy.metadataSaved)await api.deleteReference(copy.id);
   pending.delete(key);copy=undefined;
  }
  if(!copy){
   const prior=new Set((await api.listReferences(target)).map(a=>a.id));
   const result=await api.addReferenceData(target,name,data);
   const added=result.filter(a=>!prior.has(a.id)&&a.name===name);
   if(added.length!==1)throw Error('Salinan belum dapat dikenali dengan aman. Periksa pustaka sebelum mencoba lagi.');
   copy={id:added[0].id,name,data,metadataSaved:false};pending.set(key,copy);
  }
  if(!copy.metadataSaved){
   if(source.provenance){try{await api.setAssetProvenance(target,copy.id,source.provenance);}catch(e){throw Error(`Gambar salinan sudah tersimpan, catatan belum tersimpan. Coba lagi untuk melengkapi salinan yang sama sebelum memuat ulang aplikasi. ${String(e)}`)}}
   copy.metadataSaved=true;
  }
  await refresh();
  pending.delete(key);
 };
}
