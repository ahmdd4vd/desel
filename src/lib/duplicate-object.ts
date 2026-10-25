import {finishLiveHighlights} from "./live-diff";
/** Duplicate one static subtree without reusing its DOM IDs or local references. */
export function duplicateObject(source:HTMLElement):HTMLElement|null{
 if(!source.parentElement||['HTML','BODY','HEAD'].includes(source.tagName))return null;
 if(source.querySelector('style'))throw Error('Subtree dengan stylesheet belum dapat diduplikasi dengan aman. Gunakan duplikat slide.');
 finishLiveHighlights(source);
 const copy=source.cloneNode(true) as HTMLElement;
 const elements=[copy,...Array.from(copy.querySelectorAll<HTMLElement>('*'))];
 const originals=[source,...Array.from(source.querySelectorAll<HTMLElement>('*'))];
 if(elements.length>100)throw Error('Duplikasi dibatasi100elemen per subtree.');
 // Freeze current static appearance because new IDs no longer match external #id CSS.
 for(let i=0;i<elements.length;i++){const win=source.ownerDocument.defaultView;if(!win)continue;for(const pseudo of ['::before','::after']){const content=win.getComputedStyle(originals[i],pseudo).content;if(content&&content!=='none'&&content!=='normal'&&content!=='""')throw Error('Elemen dengan konten pseudo CSS belum dapat diduplikasi dengan aman. Gunakan duplikat slide.')}const css=win.getComputedStyle(originals[i]);for(const property of Array.from(css)){if(property.startsWith('animation')||property.startsWith('transition'))continue;elements[i].style.setProperty(property,css.getPropertyValue(property))}}
 const ids=new Map<string,string>();
 for(const el of elements){if(!el.id)continue;if(ids.has(el.id))throw Error('Subtree contains duplicate IDs; fix them before duplicating.');ids.set(el.id,`desel-copy-${crypto.randomUUID()}`)}
 const rewriteUrl=(text:string)=>text.replace(/url\(\s*(["']?)#([^\s)"']+)\1\s*\)/g,(full,quote,id)=>ids.has(id)?`url(${quote}#${ids.get(id)}${quote})`:full);
 for(const el of elements){const old=el.id;if(old)el.id=ids.get(old)!;
  for(const attr of Array.from(el.attributes)){
   if(['for','aria-labelledby','aria-describedby','aria-controls','aria-owns','headers'].includes(attr.name)){el.setAttribute(attr.name,attr.value.split(/\s+/).map(v=>ids.get(v)||v).join(' '))}
   else if(attr.name==='href'||attr.name==='xlink:href'){const id=attr.value.startsWith('#')?ids.get(attr.value.slice(1)):null;if(id)el.setAttribute(attr.name,`#${id}`)}
   else if(attr.value.includes('url('))el.setAttribute(attr.name,rewriteUrl(attr.value));
  }
 }
 const css=source.ownerDocument.defaultView?.getComputedStyle(source);
 if(css&&['absolute','fixed'].includes(css.position)&&css.transform==='none'){
  const left=parseFloat(css.left),top=parseFloat(css.top);
  if(Number.isFinite(left)){copy.style.width=css.width;copy.style.left=`${left+20}px`;copy.style.right='auto'}
  if(Number.isFinite(top)){copy.style.height=css.height;copy.style.top=`${top+20}px`;copy.style.bottom='auto'}
 }
 if(copy.outerHTML.length+source.ownerDocument.documentElement.outerHTML.length>4*1024*1024)throw Error('Duplikasi akan melebihi batas HTML4MB.');
 source.after(copy);return copy;
}
