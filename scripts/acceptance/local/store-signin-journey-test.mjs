// Store account signin journey: multi-step prompt -> consent -> single-session
// login (programmatic double-submit guarded), status polling -> done ->
// refresh, callback error retained, cancel clears. Anthropic subscription
// login stays refused. Fixture only - no real account, no real OAuth.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});p.on('dialog',d=>void d.accept());
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');window.calls={prompt:0,signin:0,status:0,cancel:0,callback:0,providers:0};window.statusState='pending';
api.providerManagement=async(action,payload)=>{if(action==='providers'){window.calls.providers++;return{providers:[{id:'openai',name:'OpenAI',host:'api.openai.com',models:['a','b'],keyList:[{id:'k1',name:'utama',masked:'sk-...1',active:true,on:true}]}],presets:[],plugins:[{id:'foo-sub',pid:'@magpie-community/foo',name:'Foo Account',signedIn:false,models:3,methods:[{type:'oauth',label:'Browser login'},{type:'api',label:'API key'}]},{id:'claude-sub',pid:'@magpie-community/anthropic',name:'Claude Account',signedIn:false,models:2,methods:[{type:'oauth',label:'Browser login'}]}]};}
if(action==='plugins')return{plugins:[{spec:'@magpie-community/foo@1.1.0',package:'@magpie-community/foo',version:'1.1.0',off:false,providers:['openai'],autoUpdate:false}]};
if(action==='plugin_prompt'){window.calls.prompt++;if(window.promptError)return{error:window.promptError};if(payload&&payload.key==='region')return{inputs:{step:2},prompt:null};return{inputs:{step:1},prompt:{message:'Pilih region akun',type:'select',key:'region',options:[{value:'us',label:'US'},{value:'eu',label:'EU'}]}};}
if(action==='plugin_signin'){window.calls.signin++;return{id:'sess1',state:'pending',url:'https://vendor.example/login',instructions:'Selesaikan di browser lalu periksa status.',code:'ABCD-1234',pasteCallback:true};}
if(action==='signin_status'){window.calls.status++;return{id:'sess1',state:window.statusState};}
if(action==='signin_cancel'){window.calls.cancel++;return{};}
if(action==='signin_callback'){window.calls.callback++;if(window.callbackError)throw Error(window.callbackError);return{};}
throw Error('Unexpected fixture action '+action)}});
await p.click('[aria-label="Pengaturan workspace"]');
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Provider & Plugin Store').click());
await p.waitForSelector('.native-provider-manager');
await p.evaluate(()=>Array.from(document.querySelectorAll('.native-provider-manager .presets .chip')).find(b=>b.textContent==='Akun & koneksi').click());
await p.waitForFunction(()=>document.body.innerText.includes('Foo Account'));
const clickBtn=t=>p.evaluate(t=>Array.from(document.querySelectorAll('.native-provider-manager button')).find(b=>b.textContent===t)?.click(),t);
// Honest labels and anthropic refusal.
if(!await p.evaluate(()=>document.body.innerText.includes('Browser login · belum diuji')))throw Error('login method not marked untested');
const subRows=await p.$$eval('.native-provider-manager .native-provider-row',rs=>rs.map(r=>({t:r.textContent,dis:Array.from(r.querySelectorAll('button')).map(b=>b.disabled)})));
const claude=subRows.find(r=>r.t.includes('Claude Account'));
if(!claude||!claude.dis.every(Boolean))throw Error('anthropic subscription login not refused');
// Prompt error surfaces and the flow stays retryable.
await p.evaluate(()=>{window.promptError='Fixture prompt ditolak'});
await p.evaluate(()=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('Foo Account'));Array.from(r.querySelectorAll('button')).find(b=>b.textContent.startsWith('Browser login')).click()});
await p.waitForFunction(()=>document.body.innerText.includes('Fixture prompt ditolak'));
await p.evaluate(()=>{window.promptError=''});
// Multi-step prompt: select question -> answer -> begin panel.
await p.evaluate(()=>{const r=Array.from(document.querySelectorAll('.native-provider-manager .native-provider-row')).find(r=>r.textContent.includes('Foo Account'));Array.from(r.querySelectorAll('button')).find(b=>b.textContent.startsWith('Browser login')).click()});
await p.waitForFunction(()=>document.body.innerText.includes('Pilih region akun'));
await p.select('.native-provider-manager .auth-boundary select','us');
await clickBtn('Lanjut');
await p.waitForFunction(()=>document.body.innerText.includes('Mulai login'));
if((await p.evaluate(()=>window.calls.prompt))!==3)throw Error('prompt chain wrong call count');
// Begin: programmatic double submit creates exactly one session.
await p.evaluate(()=>{const b=Array.from(document.querySelectorAll('.native-provider-manager button')).find(b=>b.textContent==='Mulai login');b.click();b.click()});
await p.waitForFunction(()=>window.calls.signin===1);
await new Promise(r=>setTimeout(r,300));
if((await p.evaluate(()=>window.calls.signin))!==1)throw Error('signin double writer');
await p.waitForFunction(()=>document.body.innerText.includes('ABCD-1234')&&document.body.innerText.includes('Status login: pending'));
// Callback error keeps the input; success clears and re-checks.
await p.evaluate(()=>{window.callbackError='Fixture callback ditolak'});
await p.type('.native-provider-manager .auth-boundary input[type="password"]','https://vendor.example/cb?code=1');
await clickBtn('Kirim callback');
await p.waitForFunction(()=>document.body.innerText.includes('Fixture callback ditolak'));
if(await p.$eval('.native-provider-manager .auth-boundary input[type="password"]',i=>!i.value))throw Error('callback input wiped after failure');
await p.evaluate(()=>{window.callbackError=''});
await clickBtn('Kirim callback');
await p.waitForFunction(()=>window.calls.callback===2&&window.calls.status===1);
// Status polling: pending stays, done triggers refresh; double poll guarded.
const providersBefore=await p.evaluate(()=>window.calls.providers);
await p.evaluate(()=>{const b=Array.from(document.querySelectorAll('.native-provider-manager button')).find(b=>b.textContent==='Periksa status');b.click();b.click()});
await p.waitForFunction(()=>window.calls.status>=2);
await new Promise(r=>setTimeout(r,300));
if((await p.evaluate(()=>window.calls.status))!==2)throw Error('status poll double writer');
if(!await p.evaluate(()=>document.body.innerText.includes('Status login: pending')))throw Error('pending status not shown');
await p.evaluate(()=>{window.statusState='done'});
await clickBtn('Periksa status');
await p.waitForFunction(()=>window.calls.status===3);
await p.waitForFunction(()=>document.body.innerText.includes('Status login: done'));
await p.waitForFunction(pb=>window.calls.providers>pb,{},providersBefore);
if(true){}
// Cancel clears the session panel.
await clickBtn('Batalkan login');
await p.waitForFunction(()=>window.calls.cancel===1&&!document.body.innerText.includes('Status login:'));
console.log({honestUntestedLabels:true,anthropicRefused:true,promptErrorRetryable:true,multiStepPrompt:true,singleSigninSession:true,callbackErrorRetained:true,singleStatusPoll:true,doneTriggersRefresh:true,cancelClears:true,mockOnlyNoRealAccount:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
