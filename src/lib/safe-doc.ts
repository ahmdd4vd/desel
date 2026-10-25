/** Slides are static artwork, never application documents. Sandboxed consumers
 * retain same-origin only for geometry/editing, never allow-scripts. */
export function safeDoc(input:string,width:number,height:number):string{
 const doc=new DOMParser().parseFromString(input||"", "text/html");
 doc.querySelectorAll("script,iframe,frame,frameset,object,embed,base,link,portal,meta[http-equiv]").forEach(e=>e.remove());
 for(const el of doc.querySelectorAll("*")){
  for(const a of Array.from(el.attributes)){
   const name=a.name.toLowerCase();const value=a.value.replace(/[\u0000-\u0020\u007f]/g,"").toLowerCase();
   if(name.startsWith("on")||["srcdoc","action","formaction","target","ping","autofocus"].includes(name)||((name==="href"||name==="xlink:href"||name==="src")&&/^(javascript|vbscript):/.test(value))||(el.tagName==="A"&&name==="href"))el.removeAttribute(a.name);
  }
 }
 const policy=doc.createElement("meta");policy.httpEquiv="Content-Security-Policy";
 policy.content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 doc.head.prepend(policy);
 doc.querySelectorAll("#desel-static-style").forEach(el=>el.remove());
 const style=doc.createElement("style");style.id="desel-static-style";style.textContent=`html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;}*{box-sizing:border-box;}`;doc.head.append(style);
 if(!input.trim())doc.body.style.background="#111";
 return `<!doctype html>${doc.documentElement.outerHTML}`;
}
