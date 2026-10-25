// Test-connection honesty and single-flight guard: the inference test call can
// cost money, so rapid clicks must issue exactly one call; a stale result must
// never land on an edited form or another connection; failures are named.
// Fixture only - api.testConnection is mocked, no real provider call.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');const s=useStudio.getState().settings;useStudio.setState({settings:{...s,providerKind:'openai-compatible',baseUrl:'https://a.example/v1',model:'m-1',activeConnection:'c1',connections:[{id:'c1',name:'Koneksi A',kind:'openai-compatible',baseUrl:'https://a.example/v1',apiKey:'',model:'m-1',modelCapabilities:[],reasoningEffort:'auto'},{id:'c2',name:'Koneksi B',kind:'openai-compatible',baseUrl:'https://b.example/v1',apiKey:'',model:'m-2',modelCapabilities:[],reasoningEffort:'auto'}]}});const{api}=await import('/src/lib/api.ts');window.testCalls=0;window.testImpl=async()=>({provider:'FixtureProvider',model:'m-1'});api.testConnection=async()=>{window.testCalls++;return window.testImpl()}});
await p.click('[aria-label="Pengaturan workspace"]');
await p.waitForFunction(()=>document.body.innerText.includes('Belum diuji'));
const clickTest=()=>p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.includes('Tes koneksi')).click());
// Success path shows the provider/model answer.
await clickTest();
await p.waitForFunction(()=>document.body.innerText.includes('FixtureProvider · m-1'));
// Rapid double-click during a slow call issues exactly one inference request.
await p.evaluate(()=>{window.testCalls=0;window.testImpl=()=>new Promise(r=>setTimeout(()=>r({provider:'FixtureProvider',model:'m-1'}),400))});
await p.evaluate(()=>{const btn=Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.includes('Tes koneksi'));btn.click();btn.click();btn.click()});
await p.waitForFunction(()=>document.body.innerText.includes('FixtureProvider · m-1')&&window.testCalls>=1);
await sleep(600);
const calls=await p.evaluate(()=>window.testCalls);
if(calls!==1)throw Error('expected exactly 1 test call, got '+calls);
// Failure is named and the form stays usable.
await p.evaluate(()=>{window.testImpl=async()=>{throw Error('Fixture auth gagal: HTTP 401')}});
await clickTest();
await p.waitForFunction(()=>document.body.innerText.includes('Fixture auth gagal'));
if(!await p.evaluate(()=>{const btn=Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.includes('Tes koneksi'));return btn&&!btn.disabled}))throw Error('test button stuck disabled after failure');
// Editing the form mid-flight discards the stale result.
await p.evaluate(()=>{window.testCalls=0;window.testImpl=()=>new Promise(r=>setTimeout(()=>r({provider:'StaleProvider',model:'m-1'}),500))});
await clickTest();
await p.waitForFunction(()=>document.body.innerText.includes('Menguji koneksi'));
await p.evaluate(()=>{const i=Array.from(document.querySelectorAll('.modal input')).find(x=>x.value&&x.value.startsWith('https://a.example'));const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,'https://edited.example/v1');i.dispatchEvent(new Event('input',{bubbles:true}))});
await p.waitForFunction(()=>document.body.innerText.includes('Belum diuji'));
await sleep(700);
if(await p.evaluate(()=>document.body.innerText.includes('StaleProvider')))throw Error('stale result landed on edited form');
// Switching connections after a success does not carry the success over.
await p.evaluate(()=>{window.testImpl=async()=>({provider:'FixtureProvider',model:'m-1'})});
await clickTest();
await p.waitForFunction(()=>document.body.innerText.includes('FixtureProvider · m-1'));
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal .connection-item')).find(b=>b.textContent.includes('Koneksi B')).click());
await p.waitForFunction(()=>document.body.innerText.includes('Belum diuji'));
if(await p.evaluate(()=>document.body.innerText.includes('FixtureProvider')))throw Error('stale success carried to another connection');
console.log({successShowsAnswer:true,singleFlightOnRapidClicks:true,failureNamed:true,buttonRecoversAfterFailure:true,staleResultDiscardedOnEdit:true,noStaleSuccessAcrossConnections:true,mockOnlyNoRealInference:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
