import type { LintIssue } from './types';
export const geometryRules=new Set(['overlap','text-image-overlap','text-overflow','text-hidden-by-photo','credit-clipped']);
/** Rendered text glyph lines, not container boxes. Findings require review,
 * not an assertion that every overlap is wrong. data-overlap="intentional"
 * explicitly exempts an authored layering group, never inferred from a class. */
export function measureOverlapIssues(doc:Document):LintIssue[]{
 const win=doc.defaultView;if(!win||!doc.body)return[];
 type TextRun={el:HTMLElement;rect:DOMRect;text:string};const runs:TextRun[]=[];const issues:LintIssue[]=[];
 const skip=(el:HTMLElement)=>{for(let p:HTMLElement|null=el;p&&p!==doc.body;p=p.parentElement){const c=win.getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)<.4||p.dataset.overlap==='intentional')return true;}return false};
 const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let n:Node|null;
 while((n=walker.nextNode())){const el=n.parentElement;if(!el||['STYLE','SCRIPT'].includes(el.tagName)||skip(el))continue;const text=n.textContent?.trim()||'';const cs=win.getComputedStyle(el);if(text.length<3||parseFloat(cs.fontSize)<12)continue;const color=cs.color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);if(color&&Number(color[1])<.3)continue;const range=doc.createRange();range.selectNodeContents(n);for(const rect of Array.from(range.getClientRects()))if(rect.width>3&&rect.height>3)runs.push({el,rect,text});}
 const canvas=doc.body.getBoundingClientRect();const snip=(s:string)=>s.slice(0,38);const seen=new Set<string>();
 const add=(rule:string,message:string,severity:'warn'|'error'='warn')=>{const key=rule+message;if(!seen.has(key)){seen.add(key);issues.push({rule,severity,message})}};
 const intersect=(a:DOMRect,b:DOMRect)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 for(const r of runs){if(/^foto:/i.test(r.text)){const m=24;if(r.rect.left<canvas.left+m-1||r.rect.right>canvas.right-m+1||r.rect.bottom>canvas.bottom-m+1||r.rect.top<canvas.top+m-1||runs.filter(x=>x.el===r.el).length>1)add('credit-clipped',`Kredit "${snip(r.text)}" terpotong/terlalu dekat tepi atau membungkus >1 baris. Beri margin >=24px dari tepi kanvas, satu baris (white-space:nowrap).`,'error')}}
 for(let i=0;i<runs.length;i++){const a=runs[i];if(a.rect.left<canvas.left-2||a.rect.right>canvas.right+2||a.rect.top<canvas.top-2||a.rect.bottom>canvas.bottom+2)add('text-overflow',`Teks keluar kanvas: "${snip(a.text)}". Periksa crop yang disengaja.`);
 for(let j=i+1;j<runs.length;j++){const b=runs[j];if(a.el===b.el||a.el.contains(b.el)||b.el.contains(a.el))continue;const min=Math.min(a.rect.width*a.rect.height,b.rect.width*b.rect.height);if(min>0&&intersect(a.rect,b.rect)/min>.2)add('overlap',`Baris teks bertumpuk: "${snip(a.text)}" dan "${snip(b.text)}". Periksa keterbacaan.`);}
 for(const image of Array.from(doc.images)){if(skip(image)||image.parentElement?.closest('[data-overlap="intentional"]'))continue;const rect=image.getBoundingClientRect();if(rect.width>canvas.width*.9&&rect.height>canvas.height*.85)continue; // full-bleed backdrop, not product panel
 {const rr=intersect(a.rect,rect)/(a.rect.width*a.rect.height);if(rr>.1&&doc.elementsFromPoint){const hit=[.1,.3,.5,.7,.9].filter(f=>(doc.elementsFromPoint(a.rect.left+a.rect.width*f,a.rect.top+a.rect.height/2) as HTMLElement[])[0]===image).length;if(hit>=1)add('text-hidden-by-photo',`Teks "${snip(a.text)}" tertutup foto (${hit} dari 5 titik teks ada DI BAWAH foto, z-order foto di atas teks). WAJIB: perkecil/geser foto atau kolom teks supaya tidak bertumpuk, atau beri teks z-index lebih tinggi di area gelap. Koordinat: kanan teks harus <= kiri foto - 24px.`,'error');}}
 if(intersect(a.rect,rect)/(a.rect.width*a.rect.height)>.2)add('text-image-overlap',`Teks "${snip(a.text)}" berpotongan dengan gambar [${image.id||image.alt||Array.from(doc.images).indexOf(image)}]. Periksa judul/screenshot; tandai intentional hanya bila memang aman dibaca.`);}
 }
 return issues.slice(0,20);
}
