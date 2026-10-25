// Store provider API journey: list rows, on/off toggle single-call + failure
// retry, delete confirm decline = no call / accept = one call, custom provider
// add payload shape + secret hygiene (key cleared on success, retained on
// failure), account priority/toggle/remove with stale-reference honesty.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});
let acceptDialogs=true;p.on('dialog',d=>void(acceptDialogs?d.accept():d.dismiss()));
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');window.calls={off:0,on:0,del:0,add:0,use:0,accoff:0,accon:0,accrem:0};window.addPayloads=[];
window.providerRows=[{id:'openai',name:'OpenAI',host:'api.openai.com',models:['gpt-a','gpt-b'],off:false,keyList:[{id:'k1',name:'utama',masked:'sk-...1',active:true,on:true},{id:'k2',name:'cadangan',masked:'sk-...2',active:false,on:false}]},{id:'backup',name:'Backup API',host:'backup.example.com',models:['m1'],off:true,keyList:[]}];
api.providerManagement=async(action,payload)=>{if(action==='providers')return{providers:window.providerRows,presets:[{id:'anthropic',name:'Anthropic / Claude API'}],plugins:[]};if(action==='plugins')return{plugins:[]};
if(action==='provider_off'){window.calls.off++;if(window.failNext)throw Error(window.failNext);window.providerRows=window.providerRows.map(r=>r.id===payload.id?{...r,off:true}:r);return{};}
if(action==='provider_on'){window.calls.on++;window.providerRows=window.providerRows.map(r=>r.id===payload.id?{...r,off:false}:r);return{};}
if(action==='provider_delete'){window.calls.del++;if(window.failNext)throw Error(window.failNext);window.providerRows=window.providerRows.filter(r=>r.id!==payload.id);return{};}
if(action==='provider_add'){window.calls.add++;window.addPayloads.push(payload);if(window.failNext)throw Error(window.failNext);window.providerRows=[...window.providerRows,{id:'custom'+window.calls.add,name:payload.name||'Custom API',host:payload.endpoint||'preset',models:payload.models||[],off:false,keyList:[]}];return{};}
if(action==='account_use'){window.calls.use++;if(window.failNext)throw Error(window.failNext);window.providerRows=window.providerRows.map(r=>({...r,keyList:(r.keyList||[]).map(k=>({...k,active:k.id===payload.ref&&r.id===payload.id}))}));return{};}
if(action==='account_off'){window.calls.accoff++;window.providerRows=window.providerRows.map(r=>({...r,keyList:(r.keyList||[]).map(k=>k.id===payload.ref&&r.id===payload.id?{...k,on:false}:k)}));return{};}
if(action==='account_on'){window.calls.accon++;window.providerRows=window.providerRows.map(r=>({...r,keyList:(r.keyList||[]).map(k=>k.id===payload.ref&&r.id===payload.id?{...k,on:true}:k)}));return{};}
if(action==='account_remove'){window.calls.accrem++;window.providerRows=window.providerRows.map(r=>({...r,keyList:(r.keyList||[]).filter(k=>!(k.id===payload.ref&&r.id===payload.id))}));return{};}
throw Error('Unexpected fixture action '+action)}});
await p.click('[aria-label="Pengaturan workspace"]');
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Provider & Plugin Store').click());
await p.waitForSelector('.native-provider-manager');
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .presets .chip')).find(b=>b.textContent==='API & gateway').click());
await p.waitForFunction(()=>document.body.innerText.includes('Backup API'));
const clickInRow=(row,label)=>p.evaluate((row,label)=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes(row));Array.from(r.querySelectorAll('button')).find(b=>b.textContent===label).click()},row,label);
// Row status honesty.
const openaiRow=await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('OpenAI')).textContent);
if(!openaiRow.includes('2 model')||!openaiRow.includes('Aktif'))throw Error('provider row status wrong');
if(!await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('Backup API')).textContent.includes('Nonaktif')))throw Error('off provider not shown Nonaktif');
// Toggle off: failure visible + retry, then success refreshes row.
await p.evaluate(()=>{window.failNext='Fixture toggle gagal'});
await clickInRow('OpenAI','Nonaktifkan');
await p.waitForFunction(()=>document.body.innerText.includes('Fixture toggle gagal'));
if((await p.evaluate(()=>window.calls.off))!==1)throw Error('toggle call missing');
await p.evaluate(()=>{window.failNext=''});
await clickInRow('OpenAI','Nonaktifkan');
await p.waitForFunction(()=>window.calls.off===2&&Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('OpenAI')).textContent.includes('Nonaktif'));
// Delete: declined confirm = zero calls; accepted = one call; error keeps row.
await p.evaluate(()=>{window.__accept=false});acceptDialogs=false;
await clickInRow('Backup API','Hapus');
await new Promise(r=>setTimeout(r,400));
if((await p.evaluate(()=>window.calls.del))!==0)throw Error('delete fired despite declined confirm');
acceptDialogs=true;
await p.evaluate(()=>{window.failNext='Fixture hapus gagal'});
await clickInRow('Backup API','Hapus');
await p.waitForFunction(()=>document.body.innerText.includes('Fixture hapus gagal'));
if(!await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).some(r=>r.textContent.includes('Backup API'))))throw Error('row vanished after failed delete');
await p.evaluate(()=>{window.failNext=''});
await clickInRow('Backup API','Hapus');
await p.waitForFunction(()=>window.calls.del===2&&!Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).some(r=>r.textContent.includes('Backup API')));
// Custom provider add: fields appear, payload shape, key cleared on success.
await p.select('.native-provider-manager select','');
await p.waitForFunction(()=>document.body.innerText.includes('Protokol upstream'));
await p.type('.native-provider-manager input[placeholder="https://provider.example/v1"]','https://api.example.com/v1');
await p.evaluate(()=>{const i=document.querySelector('.native-provider-manager input[type="password"]');const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,'secret-key-1');i.dispatchEvent(new Event('input',{bubbles:true}))});
await p.evaluate(()=>{const labels=Array.from(document.querySelectorAll('.native-provider-manager label'));const i=labels.find(l=>l.textContent.includes('ID model manual')).querySelector('input');const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,'m-a, m-b');i.dispatchEvent(new Event('input',{bubbles:true}))});
// Failure first: error visible, key retained for correction.
await p.evaluate(()=>{window.failNext='Endpoint provider tidak valid'});
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager button')).find(b=>b.textContent==='Tambah provider').click());
await p.waitForFunction(()=>document.body.innerText.includes('Endpoint provider tidak valid'));
if(await p.$eval('.native-provider-manager input[type="password"]',i=>!i.value))throw Error('key wiped after failed add');
await p.evaluate(()=>{window.failNext=''});
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager button')).find(b=>b.textContent==='Tambah provider').click());
await p.waitForFunction(()=>window.calls.add===2);
const payload=await p.evaluate(()=>window.addPayloads[1]);
if(payload.endpoint!=='https://api.example.com/v1'||payload.protocol!=='chat'||String(payload.models)!=='m-a,m-b'||payload.key!=='secret-key-1'||payload.preset!=='')throw Error('custom add payload wrong: '+JSON.stringify(payload));
await p.waitForFunction(()=>document.querySelector('.native-provider-manager input[type="password"]').value==='');
// Accounts tab: priority, toggle, remove with stale-reference honesty.
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .presets .chip')).find(b=>b.textContent==='Akun & koneksi').click());
await p.waitForFunction(()=>document.body.innerText.includes('cadangan'));
if(await p.evaluate(()=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('utama'));return !Array.from(r.querySelectorAll('button')).find(b=>b.textContent==='Utamakan').disabled}))throw Error('active key still offered Utamakan');
await p.evaluate(()=>{window.failNext='Akun tidak ditemukan atau status berubah. Segarkan daftar.'});
await clickInRow('cadangan','Utamakan');
await p.waitForFunction(()=>document.body.innerText.includes('Segarkan daftar'));
await p.evaluate(()=>{window.failNext=''});
await clickInRow('cadangan','Utamakan');
await p.waitForFunction(()=>window.calls.use===2&&Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('cadangan')).textContent.includes('Prioritas pertama'));
await clickInRow('utama','Jeda');
await p.waitForFunction(()=>window.calls.accoff===1&&Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('utama')).textContent.includes('Nonaktif'));
acceptDialogs=false;
await clickInRow('cadangan','Hapus lokal');
await new Promise(r=>setTimeout(r,400));
if((await p.evaluate(()=>window.calls.accrem))!==0)throw Error('account remove fired despite declined confirm');
acceptDialogs=true;
await clickInRow('cadangan','Hapus lokal');
await p.waitForFunction(()=>window.calls.accrem===1&&!document.body.innerText.includes('cadangan'));
console.log({rowStatusHonest:true,toggleFailureRetry:true,deleteConfirmRespected:true,failedDeleteKeepsRow:true,customPayloadShape:true,keyClearedOnSuccess:true,keyRetainedOnFailure:true,accountPriorityToggleRemove:true,staleReferenceSurfaced:true,mockOnlyNoRealProvider:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
