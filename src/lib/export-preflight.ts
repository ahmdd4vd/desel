import type{Deck}from './types';import{measureRevision,reviewRevision}from './render-review';
export interface ExportFinding{slideId:string;index:number;severity:'block'|'warn';message:string}
export interface ExportPreflight{revision:string;findings:ExportFinding[];slides:number}
export const exportRevision=(d:Deck)=>JSON.stringify({id:d.id,title:d.title,caption:d.caption,brandHandle:d.brandHandle,saveLabel:d.saveLabel,styleGuide:d.styleGuide,aspect:d.aspect,slides:d.slides.map(s=>({id:s.id,title:s.title,html:s.html,hidden:s.hidden}))});
export async function inspectExport(deck:Deck,frames:(HTMLIFrameElement|null)[]):Promise<ExportPreflight>{
 const findings:ExportFinding[]=[];let slides=0;
 await Promise.all(deck.slides.map(async(slide,index)=>{if(slide.hidden)return;slides++;const add=(severity:'block'|'warn',message:string)=>findings.push({slideId:slide.id,index,severity,message});
 if(!slide.html.trim()){add('block','Slide kosong.');return;}
 const source=new DOMParser().parseFromString(slide.html,'text/html');
 const imageSources=Array.from(source.querySelectorAll('img')).map(i=>i.getAttribute('src')??'');
 if(imageSources.some(s=>!s.trim()))add('block','Gambar tanpa sumber. Pilih aset atau hapus elemen kosong.');
 if(/asset:[A-Za-z0-9_-]+/.test(slide.html))add('block','Referensi aset belum diselesaikan. Impor/tautkan gambar sebelum ekspor.');
 if(imageSources.some(s=>/^https?:/i.test(s))||/url\(\s*["']?https?:/i.test(slide.html))add('warn','Gambar/aset eksternal bergantung jaringan dan izin CORS; ekspor dapat berbeda atau gagal.');
 const expected=reviewRevision(slide.id,deck.aspect,slide.html);const result=await measureRevision(()=>{const doc=frames[index]?.contentDocument;if(doc?.querySelector('meta[name="desel-review-revision"]')?.getAttribute('content')===expected)return{doc,revision:expected};},expected,4000);
 if('error' in result)add('block','Render terbaru/gambar belum siap: '+result.error);
 else for(const issue of result.issues)add('warn',issue.message);
 }));if(!slides)findings.push({slideId:'',index:0,severity:'block',message:'Tidak ada slide terlihat untuk diekspor.'});
 return{revision:exportRevision(deck),slides,findings:findings.sort((a,b)=>a.index-b.index)};
}
