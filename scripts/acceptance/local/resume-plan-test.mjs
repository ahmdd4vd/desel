import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';import fs from'node:fs';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--port','1425'],{stdio:'ignore'});let b;const out='/downloads/creator-studio';fs.mkdirSync(out,{recursive:true});
try{for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:1425')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1600,height:1000});
await p.evaluateOnNewDocument(()=>{window.__patch=true});
await p.goto('http://127.0.0.1:1425',{waitUntil:'networkidle0'});await p.waitForSelector('.composer textarea');
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');const{useStudio}=await import('/src/state/studio.ts');await useStudio.getState().loadSample();const d=useStudio.getState().deck;
 api.creatorRuns=async()=>[{id:'r1',deckId:d.id,state:'running',lastEvent:'tool started',updatedAt:'x',request:{text:'Bikin 5 slide soal rilis'}}];
 api.creatorResumePlan=async()=>({runId:'r1',finished:[{callId:'c1',tool:'write_slide'}],uncertain:[{callId:'c2',tool:'add_asset'}],safeBoundary:false});
 api.isTauri=true;useStudio.setState({status:'generating'});await new Promise(r=>setTimeout(r,100));useStudio.setState({status:'idle'});});
await p.waitForSelector('.creator-runs',{timeout:8000});await p.click('.creator-runs summary');
await p.waitForSelector('.creator-runs article button');await p.click('.creator-runs article button');
await p.waitForFunction(()=>document.querySelector('.composer textarea').value.includes('BELUM PASTI'),{timeout:5000});
const v=await p.$eval('.composer textarea',e=>e.value);
if(!v.includes('write_slide (c1)')||!v.includes('add_asset (c2)')||!v.includes('Bukan batas aman')||!v.includes('Bikin 5 slide soal rilis'))throw Error(v);
await p.screenshot({path:out+'/06-resume-plan.png'});console.log({resumeBriefListsFinishedAndUncertain:true,unsafeBoundaryFlagged:true,notAutoSent:true});
}finally{await b?.close();vite.kill()}
