import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--port','1424'],{stdio:'ignore'});let b;
try{for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:1424')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.goto('http://127.0.0.1:1424',{waitUntil:'networkidle0'});
const r=await p.evaluate(async()=>{
 const{api}=await import('/src/lib/api.ts');const W=await import('/src/lib/creator-workspace.ts');
 const sent=[];api.saveCreatorWorkspace=async(id,v)=>{sent.push([id,v])};
 const ws={...W.blankWorkspace(),draft:'hi',memory:[{id:'m',kind:'fact',text:'Fakta',source:'user',pinned:true,updatedAt:'x'}]};
 W.saveWorkspace('p1',ws);await new Promise(r=>setTimeout(r,50));
 const mirrored=sent.length===1&&sent[0][0]==='p1'&&sent[0][1].memory[0].id==='m';
 localStorage.removeItem('desel.creator.v1.p1');
 api.getCreatorWorkspace=async()=>sent[0][1];
 const back=await W.hydrateWorkspace('p1');
 const restored=back?.memory[0].text==='Fakta'&&localStorage.getItem('desel.creator.v1.p1')!==null;
 // damaged mirror is rejected and leaves no local copy
 localStorage.removeItem('desel.creator.v1.p2');api.getCreatorWorkspace=async()=>({draft:5});
 const bad=await W.hydrateWorkspace('p2');
 // existing local copy is never overwritten by native
 api.getCreatorWorkspace=async()=>({...ws,draft:'REMOTE'});const skip=await W.hydrateWorkspace('p1');
 return{mirrored,restored,badRejected:bad===null&&localStorage.getItem('desel.creator.v1.p2')===null,localWins:skip===null&&W.readWorkspace('p1').draft==='hi'};
});
if(!Object.values(r).every(Boolean))throw Error(JSON.stringify(r));console.log(r);
}finally{await b?.close();vite.kill()}
