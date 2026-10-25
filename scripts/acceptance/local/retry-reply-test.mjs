import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';import fs from'node:fs';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--port','1423'],{stdio:'ignore'});let b;const out='/downloads/creator-studio';fs.mkdirSync(out,{recursive:true});
try{for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:1423')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1600,height:1000});await p.goto('http://127.0.0.1:1423',{waitUntil:'networkidle0'});await p.waitForSelector('.composer textarea');
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');await useStudio.getState().loadSample();const d=useStudio.getState().deck;const m=(id,role,content)=>({id,deckId:d.id,role,content,createdAt:'2026-01-01T00:00:0'+id.length+'Z'});useStudio.setState({messages:[m('u1','user','Buat cover tentang open source'),m('a1','assistant','Cover v1 selesai.'),m('u2','user','Ganti jadi gaya editorial gelap')]  ,branches:{nodes:[],activeLeaf:null}});});
await p.waitForSelector('.msg.user .branch-fork');
await p.waitForSelector('.msg.agent .retry-reply');
const agents=await p.$$('.msg.agent .retry-reply');if(agents.length<1)throw Error('no retry button on agent reply');
const out2=out;await agents[agents.length-1].click();
await p.waitForFunction(()=>document.querySelector('.composer textarea').value.includes('Buat cover tentang open source'));
const sent=await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');return useStudio.getState().messages.length});
if(sent!==3)throw Error('retry must not send or delete anything, got '+sent);
await p.screenshot({path:out2+'/07-retry-reply.png'});
console.log({retryButtonForksAndPrefills:true,nothingSent:true,screenshot:out2+'/07-retry-reply.png'});
}finally{await b?.close();vite.kill()}
