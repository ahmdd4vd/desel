// Offline rendered quality gate. No provider call or paid inference.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import puppeteer from 'puppeteer-core';
const args=process.argv.slice(2);const value=k=>args[args.indexOf(k)+1];
const output=args.includes('--out')?value('--out'):'/downloads/desel-benchmark';fs.mkdirSync(output,{recursive:true});
const project=args.includes('--project')?JSON.parse(fs.readFileSync(value('--project'),'utf8')):null;
const evidence=args.includes('--evidence')?JSON.parse(fs.readFileSync(value('--evidence'),'utf8')):null;
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1437','--strictPort'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:1437')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:1200,height:1450});
 await page.setRequestInterception(true);page.on('request',r=>{const u=r.url();if(u.startsWith('http://127.0.0.1:1437/')||u.startsWith('data:')||u.startsWith('about:')||u.startsWith('blob:'))r.continue();else r.abort()});
 await page.goto('http://127.0.0.1:1437',{waitUntil:'networkidle0'});
 const report=await page.evaluate(async({project,evidence})=>{
  const {inspectDesignBenchmark}=await import('/src/lib/design-benchmark.ts');const{sampleDeck}=await import('/src/lib/sample.ts');const{safeDoc}=await import('/src/lib/safe-doc.ts');const{aspectSize}=await import('/src/lib/types.ts');const{reviewRevision}=await import('/src/lib/render-review.ts');
  const deck=structuredClone(project?.payload?.deck??project?.deck??project??sampleDeck());const assets=project?.payload?.assets??project?.assets??[];
  // Only in-memory assets. Never fetch an external source or execute slide JS.
  const byId=new Map(assets.map(a=>[a.id,a]));for(const slide of deck.slides)slide.html=slide.html.replace(/asset:([A-Za-z0-9_-]+)/g,(ref,id)=>{const a=byId.get(id);return a?`data:${a.mime};base64,${a.data}`:ref});
  const ev=evidence??{slides:Object.fromEntries(deck.slides.map((s,i)=>[s.id,{role:i===0?'cover':i===deck.slides.length-1?'closer':'body'}])),referenceSetAvailable:false,claimsReviewed:false,rightsReviewed:false};
  document.body.replaceChildren();document.body.style.cssText='margin:0;background:#202622';const{w,h}=aspectSize(deck.aspect);const frames=[];
  for(const slide of deck.slides){const f=document.createElement('iframe');f.sandbox='allow-same-origin';f.style.cssText=`width:${w}px;height:${h}px;border:0;display:block;margin:20px;`;document.body.append(f);frames.push(f);const loaded=new Promise(r=>f.onload=r);f.srcdoc=safeDoc(slide.html,w,h).replace('</head>',`<meta name="desel-review-revision" content="${reviewRevision(slide.id,deck.aspect,slide.html)}"></head>`);await loaded;await f.contentDocument.fonts.ready;await Promise.all([...f.contentDocument.images].map(i=>i.decode().catch(()=>{})))}
  window.benchmarkFrames=frames;return inspectDesignBenchmark(deck,frames,ev);
 },{project,evidence});
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 // Actual first slide pixels, not a claimed model generation.
 const frames=await page.$$('iframe');if(frames[0])await frames[0].screenshot({path:path.join(output,'first-slide.png')});
 console.log(JSON.stringify({structuralGate:report.structuralGate,qualityApproval:report.qualityApproval,failures:report.failures,output},null,2));
 if(args.includes('--strict')&&report.structuralGate==='failed')process.exitCode=1;
}finally{await browser?.close();vite.kill()}
