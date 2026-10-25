import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');const st=()=>useStudio.getState();st().addSlide();st().addSlide();const second=st().deck.slides[1].id;await st().saveDeck();await st().addComment(second,10,10,'catatan slide yang dihapus');st().deleteSlide(second);await st().saveDeck();if(st().comments.length!==0)throw Error('setup: comment still in state after slide delete')});
await p.reload({waitUntil:'networkidle0'});await new Promise(r=>setTimeout(r,800));
const result=await p.evaluate(async()=>{
const{useStudio}=await import('/src/state/studio.ts');const st=()=>useStudio.getState();await new Promise(r=>setTimeout(r,500));
const stored=JSON.parse(localStorage.getItem('desel.v2.comments')??'[]');
const orphan=stored.find(c=>c.body==='catatan slide yang dihapus');
if(!orphan)throw Error('orphan comment row missing from storage; undo restoration would break');
if(st().deck.slides.length!==1)throw Error('setup: expected one slide after reload');
if(!st().comments.some(c=>c.id===orphan.id))throw Error('setup: orphan not reloaded into state');
document.querySelector('[aria-label="Properti dan riwayat slide"]')?.click();
await new Promise(r=>setTimeout(r,300));
const notesTab=[...document.querySelectorAll('button.tab')].find(el=>el.textContent.includes('Catatan'));
if(!notesTab)throw Error('notes tab not found');
notesTab.click();
await new Promise(r=>setTimeout(r,300));
if(document.querySelector('.tab-count'))throw Error('ghost badge count visible for deleted slide note');
const sendLink=[...document.querySelectorAll('button.link')].find(el=>el.title.includes('catatan'));
if(!sendLink)throw Error('send-notes link not found');
if(!sendLink.disabled)throw Error('send-to-agent enabled with only orphaned notes');
if(sendLink.title!=='Belum ada catatan terbuka')throw Error('send-to-agent title not updated');
return{orphanRetainedInStorage:true,noGhostBadge:true,sendToAgentDisabled:true}});
console.log(result);}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
