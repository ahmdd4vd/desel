// Model discovery failure honesty: a failed discovery must not claim
// "0 model" - the previous list stays visible with the failure named; a later
// successful discovery restores the count; editing baseUrl clears both the
// list and the stale failure. Fixture only - no real provider call.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
const modelset=n=>Array.from({length:n},(_,i)=>({id:'m-'+(i+1),name:'Model '+(i+1),provider:'fixture',source:'',efforts:[],inputModalities:['text']}));
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');useStudio.setState({settings:{...useStudio.getState().settings,providerKind:'openai-compatible',baseUrl:'https://fixture.example/v1'}});const{api}=await import('/src/lib/api.ts');api.discoverModels=async form=>{if(window.discError)throw Error(window.discError);const ms=modelsetFixture(window.nModels);return ms.map(m=>({...m,source:form.baseUrl}))};window.nModels=2;window.modelsetFixture=n=>Array.from({length:n},(_,i)=>({id:'m-'+(i+1),name:'Model '+(i+1),provider:'fixture',efforts:[],inputModalities:['text']}))});
await p.click('[aria-label="Pengaturan workspace"]');
await p.waitForFunction(()=>document.body.innerText.includes('0 model dari koneksi ini'));
const clickDiscover=()=>p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.title&&b.title.includes('Ambil daftar model')).click());
// First-try failure with no prior list names the failure without claiming a previous list.
await p.evaluate(()=>{window.discError='Fixture discovery gagal awal: HTTP 500'});
await clickDiscover();
await p.waitForFunction(()=>document.body.innerText.includes('Discovery model gagal'));
if(await p.evaluate(()=>document.body.innerText.includes('daftar sebelumnya')))throw Error('claims previous list when none exists');
if(await p.evaluate(()=>document.body.innerText.includes('0 model dari koneksi ini')))throw Error('false zero count on first failure');
// Successful discovery shows the true count.
await p.evaluate(()=>{window.discError=''});
await clickDiscover();
await p.waitForFunction(()=>document.body.innerText.includes('2 model dari koneksi ini'));
if(!await p.evaluate(()=>document.body.innerText.includes('Model 1')))throw Error('discovered models not listed');
// Failure keeps the previous list and names the failure - no false zero.
await p.evaluate(()=>{window.discError='Fixture discovery gagal: HTTP 500'});
await clickDiscover();
await p.waitForFunction(()=>document.body.innerText.includes('Discovery model gagal - daftar sebelumnya tetap ditampilkan'));
if(await p.evaluate(()=>document.body.innerText.includes('0 model dari koneksi ini')))throw Error('false zero count after failed discovery');
if(!await p.evaluate(()=>document.body.innerText.includes('Fixture discovery gagal')))throw Error('discovery error invisible');
if(!await p.evaluate(()=>document.body.innerText.includes('Model 1')))throw Error('previous list dropped after failure');
// Recovery restores the count.
await p.evaluate(()=>{window.discError='';window.nModels=3});
await clickDiscover();
await p.waitForFunction(()=>document.body.innerText.includes('3 model dari koneksi ini'));
// baseUrl edit clears list and stale failure together.
await p.evaluate(()=>{window.discError='Fixture discovery gagal lagi'});
await clickDiscover();
await p.waitForFunction(()=>document.body.innerText.includes('Discovery model gagal'));
await p.evaluate(()=>{const i=Array.from(document.querySelectorAll('.modal input')).find(x=>x.value&&x.value.startsWith('https://fixture.example'));const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,'https://lain.example/v1');i.dispatchEvent(new Event('input',{bubbles:true}))});
await p.waitForFunction(()=>document.body.innerText.includes('0 model dari koneksi ini'));
if(await p.evaluate(()=>document.body.innerText.includes('Discovery model gagal')))throw Error('stale failure survived baseUrl edit');
console.log({trueCountOnSuccess:true,firstFailureClaimsNoPriorList:true,noFalseZeroOnFailure:true,errorNamed:true,previousListKept:true,recoveryRestoresCount:true,baseUrlEditClearsBoth:true,mockOnlyNoRealDiscovery:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
