// Platform variants in the export bundle: the dialog offers editable
// .desel.json variants for the other formats; files carry a valid checksum
// (verified through the same canonical writer), reflowed stage html and the
// right aspect; PNG-less export skips rendering; summary names the variants.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const p=await b.newPage();await p.setViewport({width:1440,height:1000});
await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});
await p.evaluate(async()=>{const{useStudio}=await import('/src/state/studio.ts');await useStudio.getState().newDeck();useStudio.getState().updateDeck({title:'Variant journey',aspect:'4:5'});useStudio.getState().addSlide();const st=useStudio.getState();st.updateSlide(st.selectedSlideId,{title:'Cover',html:'<body style="margin:0;width:1080px;height:1350px;background:#e6d8b8"><h1 style="position:absolute;left:100px;top:200px;font-size:90px">Variant cover</h1></body>'});useStudio.getState().addSlide();const st2=useStudio.getState();st2.updateSlide(st2.selectedSlideId,{title:'Body',html:'<body style="margin:0;width:1080px;height:1350px;background:#274b68;color:#fff"><p style="position:absolute;left:100px;top:200px;font-size:60px">Variant body</p></body>'});await useStudio.getState().saveDeck()});
await p.keyboard.down('Control');await p.keyboard.press('e');await p.keyboard.up('Control');
await p.waitForSelector('.export-preflight');
await p.click('.export-preflight .btn');
await p.waitForFunction(()=>document.querySelector('.export-preflight').textContent.includes('penghalang'));
if(!await p.$eval('.export-preflight',e=>e.textContent.includes('0 penghalang')))throw Error('fixture deck has export blockers');
const ack=await p.$('.export-preflight .check input');if(ack)await ack.click();
// No PNG/PDF/caption: variants alone must enable export.
await p.$eval('.export-list .export-option:nth-child(1) input',e=>{if(e.checked)e.click()});
const variantsLabel=await p.waitForFunction(()=>Array.from(document.querySelectorAll('.export-modal label.check')).find(l=>l.textContent.includes('Varian platform')));
if(!variantsLabel)throw Error('variants option missing');
await p.evaluate(()=>Array.from(document.querySelectorAll('.export-modal label.check')).find(l=>l.textContent.includes('Varian platform')).querySelector('input').click());
await p.screenshot({path:path.join(out,'desel-variants-export-dialog.png')});
if(await p.$eval('.export-modal .modal-actions .btn-primary',e=>e.disabled))throw Error('variants-only export still disabled');
await p.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');api.writeExport=async(_dir,files)=>{window.captured=files.map(f=>({name:f.name,encoding:f.encoding,data:f.encoding==='utf8'?f.data:null}));return{directory:'Fixture',files:files.map(f=>f.name)}}});
await p.click('.export-modal .modal-actions .btn-primary');
await p.waitForFunction(()=>!document.querySelector('.export-modal'),{timeout:30000});
const result=await p.evaluate(async()=>{const{verifyProjectFile}=await import('/src/lib/variant-package.ts');const files=window.captured;if(!files)throw Error('export wrote nothing');
const names=files.map(f=>f.name);
const variants=files.filter(f=>f.name.startsWith('variants/'));
if(variants.length!==3)throw Error('expected 3 variant files, got '+names.join(','));
for(const want of ['variants/variant-journey-1x1.desel.json','variants/variant-journey-9x16.desel.json','variants/variant-journey-16x9.desel.json'])if(!names.includes(want))throw Error('missing '+want);
if(names.some(n=>n.endsWith('.png')||n.endsWith('.pdf')))throw Error('render output written despite PNG/PDF off');
const summary=files.find(f=>f.name==='export-summary.txt');
if(!summary||!summary.data.includes('Platform variants: 3 editable .desel.json files'))throw Error('summary does not name variants: '+(summary&&summary.data));
const checks=[];
for(const v of variants){const parsed=JSON.parse(v.data);
if(parsed.format!=='desel-project'||parsed.version!==1)throw Error('bad variant header');
if(!await verifyProjectFile(v.data))throw Error('checksum mismatch in '+v.name);
const aspect=v.name.match(/-(\d+x\d+)\./)[1].replace('x',':');
if(parsed.payload.deck.aspect!==aspect)throw Error('aspect not switched in '+v.name);
if(!parsed.payload.deck.title.endsWith('· '+aspect))throw Error('variant title not labelled in '+v.name);
if(parsed.payload.deck.slides.length!==2)throw Error('slides missing in '+v.name);
for(const s of parsed.payload.deck.slides){if(!s.html.includes('desel-reflow-stage'))throw Error('slide not reflowed in '+v.name);if(!/scale\(\d+(\.\d+)?\)/.test(s.html))throw Error('no uniform scale in '+v.name);}
checks.push(v.name)}
return{variantFiles:checks,checksumValid:true,aspectSwitched:true,stageWrap:true,noRenderOutput:true,summaryNamesVariants:true}});
console.log(result);
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
