import assert from 'node:assert/strict';import fs from 'node:fs';import {spawn} from 'node:child_process';import puppeteer from 'puppeteer-core';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1438','--strictPort'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:1438')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const p=await browser.newPage();await p.goto('http://127.0.0.1:1438',{waitUntil:'networkidle0'});
 const out=await p.evaluate(async()=>{
  const{inspectDesignBenchmark}=await import('/src/lib/design-benchmark.ts');const{safeDoc}=await import('/src/lib/safe-doc.ts');const{sampleDeck}=await import('/src/lib/sample.ts');const{reviewRevision}=await import('/src/lib/render-review.ts');
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=400;const c=canvas.getContext('2d');c.fillStyle='#234';c.fillRect(0,0,400,400);c.fillStyle='#def';c.fillRect(30,30,340,90);const image=canvas.toDataURL();
  const html=body=>`<!doctype html><html><head><style>body{margin:0;width:1080px;height:1350px}h1{position:absolute;left:60px;top:30px;font:60px Arial}img,svg{position:absolute;left:100px;top:300px;width:700px;height:700px}</style></head><body><h1>Fixture only, not real product</h1>${body}</body></html>`;
  const f=document.createElement('iframe');f.sandbox='allow-same-origin';f.style.cssText='width:1080px;height:1350px';document.body.append(f);
  const deck=sampleDeck();deck.slides=[{...deck.slides[0],id:'s'}];const ev={slides:{s:{role:'body',mediaKind:'product-screenshot',sourceUrl:'https://example.invalid/fixture',reviewed:true}},referenceSetAvailable:false,claimsReviewed:false,rightsReviewed:false};
  async function check(body,e=ev){const loaded=new Promise(r=>f.onload=r);deck.slides[0].html=html(body);f.srcdoc=safeDoc(deck.slides[0].html,1080,1350).replace('</head>',`<meta name="desel-review-revision" content="${reviewRevision("s",deck.aspect,deck.slides[0].html)}"></head>`);await loaded;await Promise.all([...f.contentDocument.images].map(i=>i.decode().catch(()=>{})));return inspectDesignBenchmark(deck,[f],e)}
  const text=await check('');if(text.structuralGate!=='failed')throw Error('text-only accepted');
  const valid=await check(`<img src="${image}">`);if(valid.structuralGate!=='clear'||valid.qualityApproval!=='unverified'||valid.parity!=='unverified')throw Error('structural gate falsely implies aesthetic approval');
  const stacked=await check(`<img src="${image}"><img src="${image}">`);if(stacked.slides[0].mediaCoverage!==valid.slides[0].mediaCoverage)throw Error('stacked media counted twice');
  const hidden=await check(`<img style="opacity:0" src="${image}">`);if(hidden.structuralGate!=='failed'||hidden.slides[0].mediaCoverage!==0)throw Error('hidden image accepted');
  const broken=await check('<img src="data:image/png;base64,broken">');if(broken.slides[0].missingImages!==1||broken.structuralGate!=='failed')throw Error('broken image accepted');
  const tiny=await check('<svg style="width:20px;height:20px"><rect width="20" height="20"/></svg>');if(tiny.slides[0].largeVectors!==0||tiny.structuralGate!=='failed')throw Error('icon accepted as focal image');
  const clipped=await check(`<img style="left:1070px" src="${image}">`);if(clipped.slides[0].mediaCoverage>=.12||clipped.structuralGate!=='failed')throw Error('off-canvas media accepted');
  const collision=await check(`<img src="${image}"><p style="position:absolute;top:60px;left:60px;font:60px Arial">Collision fixture</p>`);if(!collision.slides[0].geometryFindings.length||collision.structuralGate!=='failed')throw Error('collision accepted');
  const role=await check(`<img src="${image}">`,{...ev,slides:{}});if(!role.slides[0].review.some(s=>s.includes('role')))throw Error('missing role hidden');
  deck.slides[0].html+='changed';const stale=inspectDesignBenchmark(deck,[f],ev);if(!stale.failures.some(x=>x.includes('stale')))throw Error('stale rendered document accepted');
  deck.slides[0].hidden=true;const empty=inspectDesignBenchmark(deck,[f],ev);if(empty.structuralGate!=='failed')throw Error('no visible slide accepted');
  f.remove();return{textOnlyRejected:true,syntheticMediaStructuralOnly:true,stackedMediaUnion:true,hiddenMediaRejected:true,brokenMediaRejected:true,iconsRejected:true,offCanvasClipped:true,geometryCollisionRejected:true,missingRoleNeedsReview:true,noVisibleSlidesRejected:true,staleRevisionRejected:true};
 });assert.equal(Object.values(out).every(Boolean),true);console.log(out);
}finally{await browser?.close();vite.kill()}
