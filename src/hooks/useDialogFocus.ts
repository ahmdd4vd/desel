import {useEffect,useRef} from 'react';
/** Keep keyboard focus in a local dialog and isolate global editor shortcuts. */
export function useDialogFocus(onClose:()=>void){
 const root=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const controls=()=>Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')??[]).filter(el=>el.getClientRects().length>0);
  (controls()[0]??root.current)?.focus();
  const key=(e:KeyboardEvent)=>{
   e.stopImmediatePropagation();
   if(e.key==='Escape'){e.preventDefault();close.current()}
   if(e.key==='Tab'){const list=controls(),at=list.indexOf(document.activeElement as HTMLElement);e.preventDefault();(list[e.shiftKey?(at<=0?list.length-1:at-1):(at+1)%list.length]??root.current)?.focus()}
  };
  window.addEventListener('keydown',key,true);
  return()=>{window.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus()};
 },[]);
 return root;
}
