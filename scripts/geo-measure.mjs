// Dev harness: node scripts/geo-measure.mjs DIR  -> prints one "Slide N (title): message" line per ERROR-severity geometry finding.
import puppeteer from 'puppeteer-core';import fs from 'fs';

// Pixel check: credit text color vs the pixels behind it (credit hidden), WCAG-style ratio.
async function creditContrast(p){
  const items=await p.evaluate(()=>{const out=[];for(const el of Array.from(document.body.querySelectorAll('*'))){const own=Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();if(!/^foto:/i.test(own))continue;const r=el.getBoundingClientRect();if(r.width<5||r.height<5)continue;const cs=getComputedStyle(el);out.push({x:r.left,y:r.top,w:r.width,h:r.height,color:cs.color,text:own.slice(0,40),idx:out.length});el.setAttribute('data-cc',String(out.length-1))}return out});
  const issues=[];
  for(const it of items){
    await p.evaluate(i=>{const e=document.querySelector(`[data-cc="${i}"]`);e.style.visibility='hidden'},it.idx);
    const b64=await p.screenshot({clip:{x:Math.max(0,it.x),y:Math.max(0,it.y),width:Math.ceil(it.w),height:Math.ceil(it.h)},encoding:'base64'});
    await p.evaluate(i=>{const e=document.querySelector(`[data-cc="${i}"]`);e.style.visibility=''},it.idx);
    const ratio=await p.evaluate(async(b64,color)=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);const d=x.getImageData(0,0,c.width,c.height).data;const L=(r,g,b)=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};const ls=[];for(let i=0;i<d.length;i+=4)ls.push(L(d[i],d[i+1],d[i+2]));ls.sort((a,b)=>a-b);const bgLo=ls[Math.floor(ls.length*.1)],bgHi=ls[Math.floor(ls.length*.9)];const m=color.match(/rgba?\(([^)]+)\)/);const p=m[1].split(',').map(Number);const tl=L(p[0],p[1],p[2]);const cr=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);return Math.min(cr(tl,bgLo),cr(tl,bgHi))},b64,it.color);
    if(ratio<3)issues.push({rule:'credit-contrast',severity:'error',message:`Kredit "${it.text}" kontras ${ratio.toFixed(1)}:1 terhadap foto/latar di belakangnya (minimal 3:1). Beri chip latar solid gelap/terang di belakang kredit, atau pindahkan ke area polos.`});
  }
  return issues;
}
if(process.argv[2]==='--file'){const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1080,height:1350});await p.setContent(fs.readFileSync(process.argv[3],'utf8'),{waitUntil:'load'});await p.addScriptTag({content:fs.readFileSync(process.argv[4]||'/tmp/g.js','utf8')});console.log(JSON.stringify((await p.evaluate(()=>G.measureOverlapIssues(document))).concat(await creditContrast(p))));await b.close();process.exit(0)}
const dir=process.argv[2];const gjs=process.argv[3]||'/tmp/g.js';
const titles=fs.existsSync(`${dir}/titles.json`)?JSON.parse(fs.readFileSync(`${dir}/titles.json`,'utf8')):[];
const n=fs.readdirSync(dir).filter(f=>/^\d+\.html$/.test(f)).length;
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1080,height:1350});
for(let i=0;i<n;i++){await p.setContent(fs.readFileSync(`${dir}/${i}.html`,'utf8'),{waitUntil:'load'});await p.addScriptTag({content:fs.readFileSync(gjs,'utf8')});
const r=(await p.evaluate(()=>G.measureOverlapIssues(document))).concat(await creditContrast(p)).filter(x=>x.severity==='error').map(x=>x.message);
for(const m of r)console.log(`Slide ${i+1} ("${titles[i]||''}"): ${m}`);}
await b.close();
