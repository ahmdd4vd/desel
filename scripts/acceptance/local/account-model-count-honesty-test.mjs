// Account tab model-count honesty: a provider whose model count was never
// reported must show "jumlah model belum diketahui", never a false "0 model".
// A real count shows the count. Fixture only - providerManagement mocked.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1440,height:1000});
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');api.providerManagement=async(action)=>{if(action==='providers')return{providers:[{id:'x1',name:'API Terukur',host:'api.example',models:[{},{}],off:false,keyList:[]},{id:'x2',name:'API Belum Dibaca',host:'api2.example',off:false,keyList:[]}],presets:[],plugins:[{id:'pa',pid:'pa',name:'Provider Terukur',signedIn:true,models:2,methods:[{label:'Login',type:'oauth'}]},{id:'pb',pid:'pb',name:'Provider Belum Dicek',signedIn:true,methods:[{label:'Login',type:'oauth'}]},{id:'pc',pid:'pc',name:'Provider Nol Nyata',signedIn:true,models:0,methods:[{label:'Login',type:'oauth'}]}]};if(action==='plugins')return{plugins:[]};return{}}});
await p.click('[aria-label="Pengaturan workspace"]');
await p.waitForFunction(()=>document.body.innerText.includes('Provider & Plugin Store'));
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.trim()==='Provider & Plugin Store').click());
await p.waitForFunction(()=>document.body.innerText.includes('Akun & koneksi'));
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.trim()==='Akun & koneksi').click());
await p.waitForFunction(()=>document.body.innerText.includes('Provider Terukur'));
const body=await p.evaluate(()=>document.body.innerText);
const row=async name=>p.evaluate(n=>{const el=Array.from(document.querySelectorAll('.native-provider-row')).find(r=>r.textContent.includes(n));return el?el.textContent:''},name);
const rowA=await row('Provider Terukur');
const rowB=await row('Provider Belum Dicek');
const rowC=await row('Provider Nol Nyata');
if(!rowA.includes('2 model'))throw Error('real count missing: '+rowA);
if(!rowB.includes('jumlah model belum diketahui'))throw Error('unknown count not named: '+rowB);
if(rowB.includes('0 model'))throw Error('false zero shown for unknown count: '+rowB);
if(!rowC.includes('0 model'))throw Error('real zero count should show as 0 model: '+rowC);
if(!rowA.includes('Terhubung'))throw Error('signed-in state missing');
// Providers tab: same honesty for the API provider list.
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.trim()==='API & gateway').click());
await p.waitForFunction(()=>document.body.innerText.includes('API Terukur'));
const rowX1=await row('API Terukur');
const rowX2=await row('API Belum Dibaca');
if(!rowX1.includes('2 model'))throw Error('providers-tab real count missing: '+rowX1);
if(!rowX2.includes('jumlah model belum diketahui'))throw Error('providers-tab unknown count not named: '+rowX2);
if(rowX2.includes('0 model'))throw Error('providers-tab false zero: '+rowX2);
console.log({realCountShown:true,unknownCountNamed:true,noFalseZeroForUnknown:true,realZeroStillShown:true,signedInStateShown:true,providersTabRealCount:true,providersTabUnknownNamed:true,providersTabNoFalseZero:true,mockOnlyNoRealRuntime:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
