import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const dir=process.env.SHOTS||'/downloads/ui-before';fs.mkdirSync(dir,{recursive:true});
const v=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1422'],{stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');await useStudio.getState().loadSample()});await new Promise(r=>setTimeout(r,5000));
for(const w of [1440,1100,760,420]){await p.setViewport({width:w,height:1000});if(w<600)await p.evaluate(()=>Array.from(document.querySelectorAll('.mobile-workspace-switch button')).find(b=>b.textContent==='Canvas').click());await new Promise(r=>setTimeout(r,250));await p.screenshot({path:`${dir}/deck-${w}.png`});await p.click('.canvas-export');await p.waitForSelector('.export-modal');await new Promise(r=>setTimeout(r,250));await p.screenshot({path:`${dir}/export-${w}.png`});await p.keyboard.press('Escape');if(w<600)await p.evaluate(()=>Array.from(document.querySelectorAll('.mobile-workspace-switch button')).find(b=>b.textContent==='Chat & proyek').click());await p.screenshot({path:`${dir}/chat-${w}.png`});}
console.log(dir)}finally{if(b)await b.close();v.kill();}
