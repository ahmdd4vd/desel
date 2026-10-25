// Backup path honesty: desktop routes through the explicit native writer
// (exportProject -> exportDefaultDir -> writeExport) so completion is
// verifiable (actual directory returned); browser keeps the anchor download.
// Browser with the real shim errors honestly (backup needs the desktop app).
// Fixture only - no desktop execution, no real provider.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
const boot=async()=>{const p=await b.newPage();await p.setViewport({width:1440,height:900});await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(()=>{window.__dlCapture=[];const origCreate=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=origCreate(blob);window.__dlCapture.push({url,blob});return url};const origClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__dlCapture[window.__dlCapture.length-1].download=this.download;window.__dlCapture[window.__dlCapture.length-1].clicked=true;return;}return origClick.call(this);};});
await p.waitForFunction(()=>document.querySelector('.topbar-menu'));return p};
const clickBackup=async p=>{await p.evaluate(()=>document.querySelector('.menu-trigger').click());await p.waitForFunction(()=>document.querySelector('.topbar-actions.menu-open'));await p.evaluate(()=>Array.from(document.querySelectorAll('.topbar-actions button')).find(b=>b.textContent.includes('Backup proyek')).click());};
const toast=p=>p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');return useStudio.getState().toast;});
const waitToast=(p,substr)=>p.waitForFunction(async s=>{const{useStudio}=await import('/src/state/studio.ts');const t=useStudio.getState().toast;return t&&t.text.includes(s);},{timeout:15000},substr);
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
// 1. Native branch (fixture): writeExport called with expected contract, toast names directory, no anchor download.
let p=await boot();
await p.evaluate(()=>import('/src/lib/api.ts').then(({api})=>{api.isTauri=true;window.__we=null;api.exportProject=async(deckId)=>JSON.stringify({deck:{id:deckId,title:'Untitled deck'},assets:[]});api.exportDefaultDir=async slug=>'Downloads/Desel/'+slug;api.writeExport=async(dir,files)=>{window.__we={dir,files};return{directory:dir,files:files.map(f=>f.name)}};}));
await clickBackup(p);
await waitToast(p,'Backup tersimpan di Downloads/Desel/untitled-deck');
const we=await p.evaluate(()=>window.__we);
if(!we)throw Error('writeExport not called on native branch');
if(we.dir!=='Downloads/Desel/untitled-deck')throw Error('unexpected dir: '+we.dir);
if(we.files.length!==1||we.files[0].name!=='untitled-deck.desel.json'||we.files[0].encoding!=='utf8')throw Error('bad file contract: '+JSON.stringify(we.files));
const payload=JSON.parse(we.files[0].data);if(!payload.deck||payload.deck.title!=='Untitled deck')throw Error('payload not the exported project JSON');
const t1=await toast(p);if(t1.kind!=='ok'||!t1.text.includes('Akun/API key dan chat tidak disertakan.'))throw Error('native toast wrong: '+JSON.stringify(t1));
const dl1=await p.evaluate(()=>window.__dlCapture.filter(d=>d.clicked).length);
if(dl1!==0)throw Error('anchor download attempted on native branch');
await p.close();
// 2. Browser branch (exportProject mocked): anchor download with real bytes and filename.
p=await boot();
await p.evaluate(()=>import('/src/lib/api.ts').then(({api})=>{api.exportProject=async(deckId)=>JSON.stringify({deck:{id:deckId,title:'Untitled deck'},assets:[{id:'a1',mime:'image/png'}]});}));
await clickBackup(p);
await waitToast(p,'Proyek dan aset dibackup');
const dl=await p.evaluate(async()=>{const d=window.__dlCapture.find(x=>x.clicked);if(!d)return null;return{download:d.download,text:await d.blob.text()};});
if(!dl)throw Error('no anchor download on browser branch');
if(dl.download!=='untitled-deck.desel.json')throw Error('wrong download filename: '+dl.download);
const dlPayload=JSON.parse(dl.text);if(!dlPayload.deck||!Array.isArray(dlPayload.assets)||dlPayload.assets.length!==1)throw Error('downloaded bytes are not the exported project JSON');
const t2=await toast(p);if(t2.kind!=='ok'||!t2.text.includes('Akun/API key dan chat tidak disertakan.'))throw Error('browser toast wrong: '+JSON.stringify(t2));
await p.close();
// 3. Browser with real shim: honest error, no false success, no download.
p=await boot();
await clickBackup(p);
await waitToast(p,'memerlukan aplikasi desktop');
const t3=await toast(p);if(t3.kind!=='error')throw Error('shim failure not an error toast: '+JSON.stringify(t3));
const dl3=await p.evaluate(()=>window.__dlCapture.filter(d=>d.clicked).length);
if(dl3!==0)throw Error('download attempted despite failed export');
await p.close();
console.log({nativeWriteContract:true,nativeToastNamesDirectory:true,noAnchorOnNative:true,browserDownloadBytesAndFilename:true,browserToastAccurate:true,shimFailureHonest:true,noRealDesktop:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
