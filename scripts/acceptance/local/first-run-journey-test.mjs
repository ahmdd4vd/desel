// First-run journey: fresh storage seeds the sample project; a user who sends
// a brief before any provider is configured gets an honest failure that names
// the real cause (never a guessed "connection lost"), keeps the draft, allows
// a single retry path, and the deck survives. Fixture only - browser shim.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
// Fresh boot seeds the sample project - the studio is not an empty grey box.
await p.waitForFunction(()=>document.querySelector('.composer textarea'));
// Fresh boot offers orientation and a sample, not a grey box.
await p.waitForFunction(()=>document.body.innerText.includes('Mau bikin apa hari ini'));
if(!await p.evaluate(()=>document.body.innerText.includes('Muat contoh deck editorial')))throw Error('no sample-load action on first run');
const slideCount=await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');return useStudio.getState().deck.slides.length});
// Count send attempts; keep the real shim behavior (throws: provider needed).
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');window.sendCalls=0;const orig=api.sendToAgent.bind(api);api.sendToAgent=(...a)=>{window.sendCalls++;return orig(...a)}});
// Type a brief and send it.
await p.evaluate(()=>{const t=document.querySelector('.composer textarea');const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;setter.call(t,'Buat carousel 3 slide tentang kopi');t.dispatchEvent(new Event('input',{bubbles:true}))});
await p.evaluate(()=>{const t=document.querySelector('.composer textarea');t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))});
// The failure names the real cause; the status never claims a dropped connection.
await p.waitForFunction(()=>document.body.innerText.includes('Pesan belum terkirim'));
if(await p.evaluate(()=>document.body.innerText.includes('Koneksi terputus')))throw Error('status asserts an unknown transport cause');
await p.waitForFunction(()=>{const t=document.querySelector('.toast');return t&&t.textContent.includes('provider API')});
const toastText=await p.evaluate(()=>document.querySelector('.toast').textContent);
// Draft restored; composer usable; exactly one send attempt (no auto retry).
await p.waitForFunction(()=>document.querySelector('.composer textarea').value.includes('kopi'));
await sleep(800);
const calls=await p.evaluate(()=>window.sendCalls);
if(calls!==1)throw Error('expected exactly 1 send attempt, got '+calls);
if(await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');return useStudio.getState().status!=='idle'}))throw Error('studio stuck busy after failed send');
// The deck survives the failed send.
const slidesAfter=await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');return useStudio.getState().deck.slides.length});
if(slidesAfter!==slideCount)throw Error('deck changed after failed send');
// Retry path: same composer still works after the failure (single guarded send).
await p.evaluate(()=>{const t=document.querySelector('.composer textarea');t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))});
await p.waitForFunction(()=>window.sendCalls===2);
await p.waitForFunction(()=>document.body.innerText.includes('Pesan belum terkirim'));
console.log({firstRunOffersGuidanceAndSample:true,failureNamesRealCause:true,noFalseTransportClaim:true,toastText:toastText.slice(0,80),draftRestored:true,singleAttemptNoAutoRetry:true,studioRecoversToIdle:true,deckSurvives:true,retryPathWorks:true,browserShimOnlyNoNative:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
