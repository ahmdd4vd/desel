// Diagnostics copy privacy: one-click, whitelisted by default. The copied text
// carries version/provider-kind/runtime/counts and never freeform user text:
// adversarial endpoints (embedded credentials, private hosts, query tokens),
// secret-like model ids, unknown provider kinds, connection names, project
// titles and chat must all stay out. Copy failure names the error without
// echoing the payload. Fixture only - clipboard stubbed in-page.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.waitForFunction(()=>document.querySelector('.composer textarea'));
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');const s=useStudio.getState().settings;useStudio.setState({settings:{...s,providerKind:'openai-compatible',baseUrl:'https://user:pass123@internal-host.corp.local/v1?token=sekret',apiKey:'sk-secret-AAA',model:'sk-live-XYZ model palsu',activeConnection:'c1',connections:[{id:'c1',name:'Koneksi Rahasia',kind:'openai-compatible',baseUrl:'https://user:pass123@internal-host.corp.local/v1?token=sekret',apiKey:'sk-secret-AAA',model:'sk-live-XYZ model palsu',modelCapabilities:[],reasoningEffort:'auto'}]}});useStudio.setState({messages:[{id:'m1',deckId:useStudio.getState().deck.id,role:'user',content:'isi chat rahasia',createdAt:new Date().toISOString()}]});});
await p.evaluate(()=>{window.copied=null;window.copyFails=false;navigator.clipboard.writeText=async t=>{if(window.copyFails)throw Error('Clipboard ditolak perangkat');window.copied=t}});
await p.click('[aria-label="Pengaturan workspace"]');
await p.waitForFunction(()=>document.body.innerText.includes('Salin info diagnosis'));
const clickCopy=()=>p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.includes('Salin info diagnosis')).click());
await clickCopy();
await p.waitForFunction(()=>window.copied!==null);
const text=await p.evaluate(()=>window.copied);
const secrets=['sk-secret-AAA','pass123','user:pass123','internal-host','corp.local','sekret','sk-live-XYZ','model palsu','Koneksi Rahasia','isi chat rahasia'];
for(const secret of secrets)if(text.includes(secret))throw Error('diagnostics leaked: '+secret);
const deckTitle=await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');return useStudio.getState().deck.title});
if(deckTitle&&text.includes(deckTitle))throw Error('diagnostics leaked project title');
for(const needed of ['Desel ','Provider: openai-compatible','Endpoint: kustom (tidak disertakan)','Model: dipilih (tidak disertakan)','API key: tersimpan (tidak disertakan)','Koneksi tersimpan: 1','Runtime:','Proyek:','Template:','Status simpan:','Tidak menyertakan API key, nama koneksi, detail endpoint, nama model'])if(!text.includes(needed))throw Error('diagnostics missing: '+needed);
// A preset endpoint is named as preset without detail (edited in the open form).
await p.evaluate(()=>{window.copied=null});
await p.evaluate(()=>{const i=Array.from(document.querySelectorAll('.modal input')).find(x=>x.value&&x.value.includes('internal-host'));const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,'https://api.openai.com/v1');i.dispatchEvent(new Event('input',{bubbles:true}))});
await clickCopy();
await p.waitForFunction(()=>window.copied!==null);
const text2=await p.evaluate(()=>window.copied);
if(!text2.includes('Endpoint: preset bawaan (tanpa detail)'))throw Error('preset endpoint not whitelisted as preset');
if(text2.includes('api.openai.com'))throw Error('preset endpoint detail copied');
// An unknown provider kind from stored settings is not echoed (reopen modal: form initializes at open).
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.trim()==='Tutup').click());
await p.waitForFunction(()=>!document.querySelector('.modal'));
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');const s=useStudio.getState().settings;useStudio.setState({settings:{...s,providerKind:'jenis-aneh-rahasia'}});});
await p.click('[aria-label="Pengaturan workspace"]');
await p.waitForFunction(()=>document.body.innerText.includes('Salin info diagnosis'));
await p.evaluate(()=>{window.copied=null});
await clickCopy();
await p.waitForFunction(()=>window.copied!==null);
const text3=await p.evaluate(()=>window.copied);
if(text3.includes('jenis-aneh-rahasia'))throw Error('unknown provider kind echoed');
if(!text3.includes('Provider: tidak dikenal (tidak disertakan)'))throw Error('unknown provider kind not handled');
// Copy failure names the error and never echoes the payload.
await p.evaluate(()=>{window.copyFails=true});
await clickCopy();
await p.waitForFunction(()=>{const t=document.querySelector('.toast');return t&&t.textContent.includes('belum tersalin')});
const toastText=await p.evaluate(()=>document.querySelector('.toast').textContent);
for(const secret of secrets)if(toastText.includes(secret))throw Error('failure toast echoed: '+secret);
console.log({redactsApiKey:true,redactsAdversarialEndpoint:true,redactsSecretLikeModel:true,redactsUnknownProviderKind:true,redactsConnectionNames:true,redactsProjectTitle:true,redactsChat:true,presetEndpointWhitelistedWithoutDetail:true,carriesRequiredFields:true,declaresExclusions:true,copyFailureNamedWithoutPayloadEcho:true,clipboardStubbedNoRealWrite:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
