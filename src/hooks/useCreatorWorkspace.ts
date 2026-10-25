import{useCallback,useEffect,useMemo,useState}from'react';
import{hydrateWorkspace,readWorkspace,saveWorkspace,blankWorkspace,type CreatorWorkspace}from'../lib/creator-workspace';
export function useCreatorWorkspace(id:string,onError:(text:string)=>void){
 const [cache,setCache]=useState<Record<string,CreatorWorkspace>>({});
 const loaded=useMemo(()=>{try{return{value:readWorkspace(id),error:''}}catch(e){return{value:blankWorkspace(),error:String(e)}}},[id]);
 useEffect(()=>{let live=true;void hydrateWorkspace(id).then(v=>{if(live&&v)setCache(all=>({...all,[id]:v}))}).catch(()=>{});return()=>{live=false}},[id]);
 const workspace=cache[id]??loaded.value;
 const update=useCallback((mutate:(previous:CreatorWorkspace)=>CreatorWorkspace)=>{
  if(loaded.error){onError(loaded.error);return false;}
  // Read the last committed value, not a stale React closure, for rapid events.
  try{const previous=readWorkspace(id);const next=mutate(previous);saveWorkspace(id,next);setCache(all=>({...all,[id]:next}));return true;}catch(e){onError(`Belum tersimpan: ${String(e)}`);return false;}
 },[id,loaded.error,onError]);
 return{workspace,update,storageError:loaded.error};
}
