import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';import fs from'node:fs';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--port','1423'],{stdio:'ignore'});let b;const out='/downloads/creator-studio';fs.mkdirSync(out,{recursive:true});
try{for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:1423')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1600,height:1000});await p.goto('http://127.0.0.1:1423',{waitUntil:'networkidle0'});await p.waitForSelector('.composer textarea');
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');await useStudio.getState().loadSample();const d=useStudio.getState().deck;const m=(id,role,content)=>({id,deckId:d.id,role,content,createdAt:'2026-01-01T00:00:0'+id.length+'Z'});useStudio.setState({messages:[m('u1','user','Buat cover tentang open source'),m('a1','assistant','Cover v1 selesai.'),m('u2','user','Ganti jadi gaya editorial gelap')]  ,branches:{nodes:[],activeLeaf:null}});});
await p.waitForSelector('.msg.user .branch-fork');
const users=()=>p.$$eval('.msg.user .msg-text',e=>e.map(x=>x.textContent));
if((await users()).length!==2)throw Error('expected two user turns');
// fork at u2: draft prefilled, old branch hidden once new turn exists
const forks=await p.$$('.msg.user .branch-fork');await forks[1].click();await p.waitForFunction(()=>document.querySelector('.composer textarea').value.includes('editorial gelap'));
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');const s=useStudio.getState();const d=s.deck.id;const nm=(id,role,content)=>({id,deckId:d,role,content,createdAt:'2026-01-01T00:00:09Z'});useStudio.setState({messages:[...s.messages,nm('u3','user','Ganti jadi gaya cerah minimal'),nm('a3','assistant','Versi cerah.')],branches:(await import('/src/lib/chat-branches.ts')).appendNode(s.branches,'u3')});});
await p.waitForFunction(()=>document.querySelectorAll('.msg.user').length===2&&document.querySelector('.branch-switch'));
let t=await users();if(t.some(x=>x.includes('editorial gelap')))throw Error('old branch leaked into view');if(!t.some(x=>x.includes('cerah minimal')))throw Error('new branch missing');
if(await p.evaluate(()=>[...document.querySelectorAll('.msg.agent')].some(e=>e.textContent.includes('editorial gelap'))))throw Error('agent reply leaked');
await p.screenshot({path:out+'/05-branches.png'});
// switch back to branch 1
await p.click('.branch-switch button[aria-label="Cabang sebelumnya"]');await p.waitForFunction(()=>[...document.querySelectorAll('.msg.user')].some(e=>e.textContent.includes('editorial gelap')));
t=await users();if(t.some(x=>x.includes('cerah minimal')))throw Error('switch leaked other branch');
// persisted across reload
const saved=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('desel.branches.')).length);if(saved!==1)throw Error('branches not persisted');
console.log({branchForkHidesOldPath:true,switchWorks:true,persisted:true,screenshot:out+'/05-branches.png'});
}finally{await b?.close();vite.kill()}
