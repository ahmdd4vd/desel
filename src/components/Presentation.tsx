import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Maximize2,X} from 'lucide-react';
import type {Deck} from '../lib/types';
import {aspectSize} from '../lib/types';
import {safeDoc} from '../lib/safe-doc';

/** Read-only slideshow. Fullscreen is optional; no slide contents are changed. */
export function Presentation({deck,initialId,onClose}:{deck:Deck;initialId:string|null;onClose:()=>void}){
 const slides=deck.slides.filter(s=>!s.hidden);
 const [index,setIndex]=useState(()=>Math.max(0,slides.findIndex(s=>s.id===initialId)));
 const [fullscreenError,setFullscreenError]=useState('');
 const root=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const [scale,setScale]=useState(.2);
 const size=aspectSize(deck.aspect),slide=slides[Math.min(index,slides.length-1)];
 const move=(delta:number)=>setIndex(i=>Math.min(slides.length-1,Math.max(0,i+delta)));
 useLayoutEffect(()=>{const el=stage.current;if(!el)return;const update=()=>setScale(Math.max(.01,Math.min(el.clientWidth/size.w,el.clientHeight/size.h)));const observer=new ResizeObserver(update);observer.observe(el);update();return()=>observer.disconnect()},[size.w,size.h]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;const dialog=root.current;dialog?.focus();
  const key=(e:KeyboardEvent)=>{
   e.stopImmediatePropagation();
   // Space on a focused button must activate it,not advance the slide.
   if(e.key===' '&&(e.target as HTMLElement)?.closest('button'))return;
   if(e.key==='Tab'){const controls=Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);const at=controls.indexOf(document.activeElement as HTMLButtonElement);const next=e.shiftKey?(at<=0?controls.length-1:at-1):(at+1)%controls.length;e.preventDefault();controls[next]?.focus()}
   else if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeRef.current()}
   else if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();move(1)}
   else if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();move(-1)}
   else if(e.key==='Home'){e.preventDefault();setIndex(0)}
   else if(e.key==='End'){e.preventDefault();setIndex(slides.length-1)}
  };
  window.addEventListener('keydown',key,true);
  return()=>{window.removeEventListener('keydown',key,true);if(document.fullscreenElement===dialog)void document.exitFullscreen().catch(()=>{});previous?.focus()};
 },[slides.length]);
 return <div className="presentation" role="dialog" aria-modal="true" aria-label="Presentasi slide" tabIndex={-1} ref={root}>
  <header><span>{deck.title} <small>Pratinjau baca-saja</small></span><div><button className="icon-btn" aria-label="Layar penuh presentasi" onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen();setFullscreenError('')}catch{setFullscreenError('Layar penuh tidak tersedia. Presentasi tetap dapat dipakai.')}}}><Maximize2 size={17}/></button><button className="icon-btn" aria-label="Tutup presentasi" onClick={onClose}><X size={19}/></button></div></header>
  <div className="presentation-stage" ref={stage}>{slide?<div style={{width:size.w*scale,height:size.h*scale,position:'relative'}}><iframe key={slide.id} title={`Presentasi: ${slide.title}`} tabIndex={-1} sandbox="allow-same-origin" srcDoc={safeDoc(slide.html,size.w,size.h)} style={{width:size.w,height:size.h,transform:`scale(${scale})`,transformOrigin:'top left',border:0,pointerEvents:'none'}}/></div>:<p>Tidak ada slide terlihat.</p>}</div>
  <footer><button className="btn btn-sm" aria-label="Slide sebelumnya" disabled={index<=0} onClick={()=>move(-1)}><ChevronLeft size={18}/></button><span aria-live="polite">{slide?index+1:0} / {slides.length}<small>{slide?.title}</small></span><button className="btn btn-sm" aria-label="Slide berikutnya" disabled={index>=slides.length-1} onClick={()=>move(1)}><ChevronRight size={18}/></button></footer>{fullscreenError&&<p className="presentation-error">{fullscreenError}</p>}
 </div>
}
