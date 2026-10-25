// Store plugin update journey: a new version actually appears, partial check
// failures are named (not reported as full success), upgrade confirm -> single
// call -> failure visible + retry, auto-update toggle stays community-only.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});p.on('dialog',d=>void d.accept());
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');window.calls={upgrade:0,auto:0,check:0};
window.pluginRows=[{spec:'@magpie-community/foo@1.0.0',package:'@magpie-community/foo',version:'1.0.0',off:false,providers:['openai'],autoUpdate:false},{spec:'thirdparty/bar@2.0.0',package:'thirdparty/bar',version:'2.0.0',off:false,providers:[],autoUpdate:false}];
api.providerManagement=async(action,payload)=>{if(action==='providers')return{providers:[],presets:[],plugins:[]};if(action==='plugins')return{plugins:window.pluginRows};if(action==='market')return{listings:[]};if(action==='plugin_check'){window.calls.check++;if(window.checkError)throw Error(window.checkError);return{state:{plugins:window.checkState}}};if(action==='plugin_upgrade'){window.calls.upgrade++;if(window.upgradeError)throw Error(window.upgradeError);window.pluginRows=window.pluginRows.map(r=>r.package==='@magpie-community/foo'?{...r,spec:payload.spec,version:window.upgradeTo,latest:window.upgradeTo}:r);return{}};if(action==='plugin_auto'){window.calls.auto++;window.pluginRows=window.pluginRows.map(r=>r.package==='@magpie-community/foo'?{...r,spec:'@magpie-community/foo@latest',autoUpdate:true}:r);return{}};throw Error('Unexpected fixture action '+action)}});
await p.click('[aria-label="Pengaturan workspace"]');
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Provider & Plugin Store').click());
await p.waitForSelector('.native-provider-manager');
await p.waitForFunction(()=>Array.from(document.querySelectorAll('.native-provider-manager button')).some(b=>b.textContent==='Pembaruan'));
const clickBtn=t=>p.evaluate(t=>Array.from(document.querySelectorAll('.native-provider-manager button')).find(b=>b.textContent===t)?.click(),t);
const rowText=name=>p.evaluate(name=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes(name));return r?r.textContent:''},name);
const updateButtons=()=>p.$$eval('.native-provider-manager .native-provider-row button',bs=>bs.map(b=>({t:b.textContent,dis:b.disabled})));
await clickBtn('Pembaruan');
await p.waitForFunction(()=>document.body.innerText.includes('Belum diperiksa'));
if(!(await rowText('foo')).includes('1.0.0 → Belum diperiksa'))throw Error('unchecked foo version not honest');
if((await updateButtons()).filter(x=>x.t==='Perbarui'&&!x.dis).length!==0)throw Error('Perbarui enabled before any check');
// A new version actually appears for foo; bar stays current.
await p.evaluate(()=>{window.checkState=[{spec:'@magpie-community/foo@1.0.0',package:'@magpie-community/foo',version:'1.0.0',latest:'1.1.0',autoUpdate:false},{spec:'thirdparty/bar@2.0.0',package:'thirdparty/bar',version:'2.0.0',latest:'2.0.0',autoUpdate:false}]});
await clickBtn('Periksa pembaruan');
await p.waitForFunction(()=>document.body.innerText.includes('Pemeriksaan pembaruan selesai.'));
if(!(await rowText('foo')).includes('1.0.0 → 1.1.0'))throw Error('new version not shown after check');
const btns=await updateButtons();const fooBtn=btns[0],barBtn=btns[1];
if(fooBtn.t!=='Perbarui'||fooBtn.dis)throw Error('outdated plugin upgrade not offered');
if(barBtn.t!=='Perbarui'||!barBtn.dis)throw Error('current plugin offered upgrade');
// Upgrade: confirm accepted, exactly one call, failure visible + retry, success refreshes.
await p.evaluate(()=>{window.upgradeTo='1.1.0'});
await p.evaluate(()=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('@magpie-community/foo'));Array.from(r.querySelectorAll('button')).find(b=>b.textContent==='Perbarui').click()});
await p.waitForFunction(()=>window.calls&&window.calls.upgrade===1);
await p.waitForFunction(()=>document.body.innerText.includes('1.1.0 → 1.1.0'));
if((await updateButtons()).some(x=>x.t==='Perbarui'&&!x.dis))throw Error('upgrade offered again after success');
await p.evaluate(()=>{window.upgradeError='Fixture upgrade gagal';window.upgradeTo='1.2.0';window.checkState=[{spec:'@magpie-community/foo@1.1.0',package:'@magpie-community/foo',version:'1.1.0',latest:'1.2.0',autoUpdate:false},{spec:'thirdparty/bar@2.0.0',package:'thirdparty/bar',version:'2.0.0',latest:'2.0.0',autoUpdate:false}]});
await clickBtn('Periksa pembaruan');
await p.waitForFunction(()=>document.body.innerText.includes('1.1.0 → 1.2.0'));
await p.evaluate(()=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('@magpie-community/foo'));Array.from(r.querySelectorAll('button')).find(b=>b.textContent==='Perbarui').click()});
await p.waitForFunction(()=>window.calls.upgrade===2);
await p.waitForFunction(()=>document.body.innerText.includes('Fixture upgrade gagal'));
if(!await p.$('.native-provider-manager'))throw Error('failed upgrade dismissed Store');
if((await updateButtons()).filter(x=>x.t==='Perbarui'&&!x.dis).length!==1)throw Error('failed upgrade not retryable');
await p.evaluate(()=>{window.upgradeError=''});
await p.evaluate(()=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('@magpie-community/foo'));Array.from(r.querySelectorAll('button')).find(b=>b.textContent==='Perbarui').click()});
await p.waitForFunction(()=>window.calls.upgrade===3);
await p.waitForFunction(()=>document.body.innerText.includes('1.2.0 → 1.2.0'));
// Partial check failure must be named, not reported as full success.
await p.evaluate(()=>{window.checkState=[{spec:'@magpie-community/foo@1.2.0',package:'@magpie-community/foo',version:'1.2.0',latest:'1.2.0',autoUpdate:false},{spec:'thirdparty/bar@2.0.0',package:'thirdparty/bar',version:'2.0.0',updateError:'Registry tidak merespons',autoUpdate:false}]});
await clickBtn('Periksa pembaruan');
await p.waitForFunction(()=>document.body.innerText.includes('gagal diperiksa'));
const barRow=await rowText('thirdparty');
if(!barRow.includes('Registry tidak merespons'))throw Error('per-plugin check failure not shown on row');
await p.screenshot({path:path.join(out,'desel-store-update-partial.png')});
// A failed whole check must clear the stale partial-failure notice and show the error.
await p.evaluate(()=>{window.checkError='Fixture check gagal'});
await clickBtn('Periksa pembaruan');
await p.waitForFunction(()=>document.body.innerText.includes('Fixture check gagal'));
if(await p.evaluate(()=>document.body.innerText.includes('Pemeriksaan selesai, tetapi')))throw Error('stale partial-failure notice survived failed recheck');
if(await p.evaluate(()=>document.body.innerText.includes('Pemeriksaan pembaruan selesai.')))throw Error('stale success notice survived failed recheck');
await p.evaluate(()=>{window.checkError=''});
// Auto-update consent stays community-only and fires exactly once.
await clickBtn('Terpasang · 2');
await p.waitForFunction(()=>document.body.innerText.includes('Pembaruan otomatis:'));
const autoRow=await rowText('foo');
if(!autoRow.includes('Auto update…'))throw Error('community plugin auto-update toggle missing');
if((await rowText('thirdparty')).includes('Auto update…'))throw Error('third-party plugin offered auto-update');
await p.evaluate(()=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('@magpie-community/foo'));Array.from(r.querySelectorAll('button')).find(b=>b.textContent==='Auto update…').click()});
await p.waitForFunction(()=>window.calls.auto===1);
await p.waitForFunction(()=>document.body.innerText.includes('Pembaruan otomatis: Aktif'));
console.log({newVersionJourney:true,singleUpgradeCall:true,upgradeFailureVisibleRetryable:true,partialCheckFailureNamed:true,staleNoticeCleared:true,autoUpdateCommunityOnly:true,mockOnlyNoRealRuntime:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
