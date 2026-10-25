// Store plugin install journey: honest empty state, catalog search/category,
// detail facts, consent-gated pinned install, failure visible + retry, success
// reflected as Terpasang (detail + grid), manual install disarmed after success,
// double-submit guarded. Fixture only - no real runtime install.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});p.on('dialog',d=>void d.accept());
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');window.calls={add:0};window.addCalls=[];window.installedRows=[];
window.listings=[{name:'Foo Connect',package:'@magpie-community/foo',community:true,kind:'provider',providers:['openai'],npm:{version:'1.1.0',description:'Koneksi OpenAI komunitas.',license:'MIT',publisher:'magpie'}},{name:'Toolpack',package:'thirdparty/toolpack',kind:'tools',providers:[],npm:{version:'0.3.0',description:'Alat tambahan.',license:'Apache-2.0',publisher:'thirdparty'}},{name:'NoMeta',package:'thirdparty/nometa',kind:'provider',providers:[]}];
api.providerManagement=async(action,payload)=>{if(action==='providers')return{providers:[],presets:[],plugins:[]};if(action==='plugins')return{plugins:window.installedRows};if(action==='market')return{listings:window.listings};if(action==='plugin_add'){window.calls.add++;window.addCalls.push(payload&&payload.spec);if(window.addError)throw Error(window.addError);const m=String(payload.spec).match(/^(.*)@([^@]+)$/);window.installedRows=[...window.installedRows,{spec:payload.spec,package:m[1],version:m[2],off:false,providers:[],autoUpdate:false}];return{}};throw Error('Unexpected fixture action '+action)}});
await p.click('[aria-label="Pengaturan workspace"]');
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Provider & Plugin Store').click());
await p.waitForSelector('.native-provider-manager');
await p.waitForFunction(()=>Array.from(document.querySelectorAll('.native-provider-manager button')).some(b=>b.textContent==='Buka katalog'));
const clickBtn=t=>p.evaluate(t=>Array.from(document.querySelectorAll('.native-provider-manager button')).find(b=>b.textContent===t)?.click(),t);
const cards=()=>p.$$eval('.native-provider-manager .store-grid .store-card',cs=>cs.map(c=>c.textContent));
// Honest empty state before the catalog is opened: nothing silently installed.
if(!await p.evaluate(()=>document.body.innerText.includes('Katalog belum dimuat')))throw Error('empty state missing before catalog load');
if((await cards()).length!==0)throw Error('cards shown before catalog load');
await clickBtn('Buka katalog');
await p.waitForFunction(()=>document.querySelectorAll('.native-provider-manager .store-grid .store-card').length===3);
// Search narrows to the matching card only.
await p.type('.native-provider-manager .store-search input','toolpack');
await p.waitForFunction(()=>document.querySelectorAll('.native-provider-manager .store-grid .store-card').length===1);
await p.evaluate(()=>{const i=document.querySelector('.native-provider-manager .store-search input');const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))});
await p.waitForFunction(()=>document.querySelectorAll('.native-provider-manager .store-grid .store-card').length===3);
// Category filter: Alat shows tool-kind only.
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .store-filters .chip')).find(b=>b.textContent==='Alat').click());
await p.waitForFunction(()=>document.querySelectorAll('.native-provider-manager .store-grid .store-card').length===1);
if(!(await cards())[0].includes('Toolpack'))throw Error('category filter wrong card');
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .store-filters .chip')).find(b=>b.textContent==='Semua').click());
await p.waitForFunction(()=>document.querySelectorAll('.native-provider-manager .store-grid .store-card').length===3);
// Detail without npm version can never install.
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .store-grid .store-card')).find(c=>c.textContent.includes('NoMeta')).click());
await p.waitForSelector('.native-provider-manager .store-detail');
await p.evaluate(()=>{const c=document.querySelector('.native-provider-manager .store-detail .check input');c.click()});
if(!await p.$eval('.native-provider-manager .store-detail .btn-primary',b=>b.disabled))throw Error('no-version plugin install not blocked');
await clickBtn('← Kembali ke Store');
await p.waitForSelector('.native-provider-manager .store-grid');
// Detail facts + consent gate + failure visible + retry + success reflected.
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .store-grid .store-card')).find(c=>c.textContent.includes('Foo Connect')).click());
await p.waitForSelector('.native-provider-manager .store-detail');
const detail=await p.$eval('.native-provider-manager .store-detail',d=>d.textContent);
for(const t of['@magpie-community/foo','1.1.0','MIT','magpie'])if(!detail.includes(t))throw Error('detail fact missing: '+t);
if(!await p.$eval('.native-provider-manager .store-detail .btn-primary',b=>b.disabled))throw Error('install enabled before consent');
await p.evaluate(()=>{document.querySelector('.native-provider-manager .store-detail .check input').click()});
if(await p.$eval('.native-provider-manager .store-detail .btn-primary',b=>b.disabled))throw Error('install still disabled after consent');
await p.evaluate(()=>{window.addError='Fixture install gagal'});
await p.evaluate(()=>document.querySelector('.native-provider-manager .store-detail .btn-primary').click());
await p.waitForFunction(()=>window.calls.add===1);
await p.waitForFunction(()=>document.body.innerText.includes('Fixture install gagal'));
if(await p.$eval('.native-provider-manager .store-detail .btn-primary',b=>b.disabled))throw Error('failed install not retryable');
await p.evaluate(()=>{window.addError=''});
await p.evaluate(()=>document.querySelector('.native-provider-manager .store-detail .btn-primary').click());
await p.waitForFunction(()=>window.calls.add===2);
const specs=await p.evaluate(()=>window.addCalls);
if(specs.join(',')!=='@magpie-community/foo@1.1.0,@magpie-community/foo@1.1.0')throw Error('install spec not pinned catalog version: '+specs);
await p.waitForFunction(()=>{const b=document.querySelector('.native-provider-manager .store-detail .btn-primary');return b&&b.disabled&&b.textContent==='Terpasang'});
await p.screenshot({path:path.join(out,'desel-store-install-detail.png')});
await clickBtn('← Kembali ke Store');
await p.waitForSelector('.native-provider-manager .store-grid');
await p.waitForFunction(()=>Array.from(document.querySelectorAll('.native-provider-manager .store-grid .store-card')).some(c=>c.textContent.includes('Foo Connect')&&c.textContent.includes('Terpasang')));
// Manual install: consent-gated, exact pinned spec, disarmed after success, double-submit guarded.
await p.evaluate(()=>{document.querySelector('.native-provider-manager details').open=true});
if(!await p.$eval('.native-provider-manager details .btn-primary',b=>b.disabled))throw Error('manual install enabled without spec/consent');
await p.type('.native-provider-manager details .field input','@scope/plugin@1.2.3');
await p.evaluate(()=>{const c=document.querySelector('.native-provider-manager details .check input');c.click()});
if(await p.$eval('.native-provider-manager details .btn-primary',b=>b.disabled))throw Error('manual install blocked with spec+consent');
await p.evaluate(()=>{const b=document.querySelector('.native-provider-manager details .btn-primary');b.click();b.click()});
await p.waitForFunction(()=>window.calls.add===3);
if((await p.evaluate(()=>window.addCalls))[2]!=='@scope/plugin@1.2.3')throw Error('manual spec not passed verbatim');
if((await p.evaluate(()=>window.calls.add))!==3)throw Error('manual install double writer');
await p.waitForFunction(()=>document.querySelector('.native-provider-manager details .field input').value==='');
if(await p.$eval('.native-provider-manager details .check input',c=>c.checked))throw Error('consent left armed after success');
console.log({honestEmptyState:true,searchAndCategory:true,noVersionBlocked:true,consentGatedPinnedInstall:true,failureVisibleRetryable:true,successShownInstalled:true,manualDisarmedAfterSuccess:true,doubleSubmitGuarded:true,mockOnlyNoRealInstall:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
