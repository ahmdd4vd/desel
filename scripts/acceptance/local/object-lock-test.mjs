import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';import fs from'node:fs';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--port','1425'],{stdio:'ignore'});let b;const out='/downloads/creator-studio';fs.mkdirSync(out,{recursive:true});
try{for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:1425')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1600,height:1000});await p.goto('http://127.0.0.1:1425',{waitUntil:'networkidle0'});await p.waitForSelector('.composer textarea');
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');await useStudio.getState().newDeck();useStudio.getState().addSlide();useStudio.getState().updateSlide(useStudio.getState().deck.slides[0].id,{title:'Kunci objek',html:'<html><head><style>body{width:1080px;height:1350px;background:#e1d6bd;color:#213c2d;font-family:Arial}#heading{position:absolute;left:100px;top:200px;font-size:80px}#card{position:absolute;left:100px;top:500px;width:700px;height:300px;background:#b0c2a4}#card p{font-size:40px;padding:30px}</style></head><body><h1 id="heading">Judul tetap</h1><div id="card"><p>Konten yang dikunci.</p></div></body></html>'});await useStudio.getState().saveDeck()});
await new Promise(r=>setTimeout(r,700));
await p.click('.cv-object-panel > button');await p.waitForSelector('.cv-object-list button');
await p.evaluate(()=>Array.from(document.querySelectorAll('.cv-object-list button')).find(b=>b.textContent.startsWith('div')).click());
await p.waitForFunction(()=>Array.from(document.querySelectorAll('.cv-object-actions button')).some(b=>b.textContent==='Kunci objek'));
await p.evaluate(()=>Array.from(document.querySelectorAll('.cv-object-actions button')).find(b=>b.textContent==='Kunci objek').click());
await p.waitForFunction(()=>Array.from(document.querySelectorAll('.cv-object-actions button')).some(b=>b.textContent==='Buka kunci objek'));
await new Promise(r=>setTimeout(r,200));
await p.waitForFunction(()=>Array.from(document.querySelectorAll('.cv-object-list button')).some(b=>b.textContent.includes('🔒')));
const locked=await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');const W=await import('/src/lib/creator-workspace.ts');const ws=W.readWorkspace(useStudio.getState().deck.id);return{n:ws.lockedObjects.length,slideOk:ws.lockedObjects[0]?.slideId===useStudio.getState().deck.slides[0].id,selector:ws.lockedObjects[0]?.selector??'',label:ws.lockedObjects[0]?.label??''}});
if(locked.n!==1||!locked.slideOk||!locked.selector.includes('card'))throw Error('lock not persisted: '+JSON.stringify(locked));
await p.screenshot({path:out+'/08-object-locks.png'});
// scope sent to the agent carries the locks
const scopeCheck=await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');const{useStudio}=await import('/src/state/studio.ts');let seen;api.sendToAgent=async(deckId,text,onEvent,context)=>{seen=context};const ta=document.querySelector('.composer textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,'Revisi judul saja');ta.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,150));document.querySelector('.composer .send').click();await new Promise(r=>setTimeout(r,300));return{hasLocks:seen?.lockedObjects?.length===1&&seen.lockedObjects[0].selector.includes('card'),mode:seen?.mode}});
if(!scopeCheck.hasLocks)throw Error('scope missing locks: '+JSON.stringify(scopeCheck));
// workspaces saved before object locks existed still load
const legacy=await p.evaluate(async()=>{const W=await import('/src/lib/creator-workspace.ts');localStorage.setItem('desel.creator.v1.legacyp',JSON.stringify({draft:'x',queue:[{id:'q',text:'t',scope:{mode:'produce',assetIds:[],lockedSlideIds:[]},createdAt:'y'}],memory:[],mode:'produce',lockedSlideIds:[]}));const ws=W.readWorkspace('legacyp');return{objects:ws.lockedObjects.length,queueObjects:Array.isArray(ws.queue[0].scope.lockedObjects)}});
if(legacy.objects!==0||!legacy.queueObjects)throw Error('legacy workspace failed: '+JSON.stringify(legacy));
// unlock removes it
await p.evaluate(()=>Array.from(document.querySelectorAll('.cv-object-actions button')).find(b=>b.textContent==='Buka kunci objek').click());
await p.waitForFunction(()=>Array.from(document.querySelectorAll('.cv-object-actions button')).some(b=>b.textContent==='Kunci objek'));
const unlocked=await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');const W=await import('/src/lib/creator-workspace.ts');return W.readWorkspace(useStudio.getState().deck.id).lockedObjects.length});
if(unlocked!==0)throw Error('unlock failed');
console.log({lockPersisted:true,lockShownInList:true,scopeCarriesLocks:true,legacyWorkspaceLoads:true,unlockWorks:true,screenshot:out+'/08-object-locks.png'});
}finally{await b?.close();vite.kill()}
