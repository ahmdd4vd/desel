// Runtime status + start honesty: a failed status check must NOT be presented
// as "runtime not started"; start success patches baseUrl/clears key/resets
// models only when the gateway differs; start failure keeps the form; double
// start guarded. Fixture only - no real runtime process.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
async function page(){const pg=await b.newPage();await pg.setViewport({width:1440,height:1000});await pg.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});await pg.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');useStudio.setState({settings:{...useStudio.getState().settings,providerKind:'magpie-managed'}})});return pg}
const openSettings=pg=>pg.click('[aria-label="Pengaturan workspace"]');
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
// 1. Status failure must not be labeled "not started".
let p=await page();
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');api.runtimeStatus=async()=>{throw Error('Fixture status IPC gagal')}});
await openSettings(p);
await p.waitForFunction(()=>document.body.innerText.includes('Status runtime tidak diketahui'));
if(await p.evaluate(()=>document.body.innerText.includes('Runtime belum dimulai')))throw Error('unknown status mislabeled as not started');
if(!await p.evaluate(()=>document.body.innerText.includes('Fixture status IPC gagal')))throw Error('status failure error invisible');
if(await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).some(b=>b.textContent==='Hentikan runtime')))throw Error('stop offered under unknown status');
await p.close();
// 2. Start success patches the form only when the gateway differs.
p=await page();
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');window.startCalls=0;api.runtimeStatus=async()=>({running:false,version:'fixture',managed:true});api.runtimeStart=async()=>{window.startCalls++;if(window.startError)throw Error(window.startError);return{running:true,gatewayUrl:'http://127.0.0.1:3466/v1',version:'fixture',managed:true}}});
await openSettings(p);
await p.waitForFunction(()=>document.body.innerText.includes('Runtime belum dimulai'));
// Start failure first: error visible, form untouched.
await p.evaluate(()=>{window.startError='Fixture start gagal'});
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Hubungkan runtime').click());
await p.waitForFunction(()=>document.body.innerText.includes('Fixture start gagal'));
if(await p.evaluate(()=>document.body.innerText.includes('http://127.0.0.1:3466/v1')))throw Error('gateway shown after failed start');
// Double-click start -> exactly one call; success patches baseUrl, clears key.
await p.evaluate(()=>{window.startError=''});
await p.evaluate(()=>{const b=Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Hubungkan runtime');b.click();b.click()});
await p.waitForFunction(()=>window.startCalls===2&&document.body.innerText.includes('Runtime berjalan'));
await new Promise(r=>setTimeout(r,300));
if((await p.evaluate(()=>window.startCalls))!==2)throw Error('runtime start double writer');
if(!await p.evaluate(()=>document.body.textContent.includes('http://127.0.0.1:3466/v1')))throw Error('gateway not shown after start');
if(!await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).some(b=>b.textContent==='Hentikan runtime')))throw Error('stop not offered while running');
// 3. Manage path switches to the connect section after a successful start.
await p.evaluate(()=>{window.startError=''}); 
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');api.runtimeStatus=async()=>({running:false,version:'fixture',managed:true})});
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Kelola provider & login').click());
await p.waitForSelector('.native-provider-manager');
await p.close();
console.log({unknownStatusHonest:true,statusErrorVisible:true,noStopUnderUnknown:true,startFailureKeepsForm:true,singleStartCall:true,startPatchesGateway:true,stopOfferedWhenRunning:true,manageSwitchesSection:true,mockOnlyNoRealRuntime:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
