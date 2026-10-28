// Dev harness: node scripts/geo-measure.mjs DIR  -> prints one "Slide N (title): message" line per ERROR-severity geometry finding.
import puppeteer from 'puppeteer-core';import fs from 'fs';
if(process.argv[2]==='--file'){const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1080,height:1350});await p.setContent(fs.readFileSync(process.argv[3],'utf8'),{waitUntil:'load'});await p.addScriptTag({content:fs.readFileSync(process.argv[4]||'/tmp/g.js','utf8')});console.log(JSON.stringify(await p.evaluate(()=>G.measureOverlapIssues(document))));await b.close();process.exit(0)}
const dir=process.argv[2];const gjs=process.argv[3]||'/tmp/g.js';
const titles=fs.existsSync(`${dir}/titles.json`)?JSON.parse(fs.readFileSync(`${dir}/titles.json`,'utf8')):[];
const n=fs.readdirSync(dir).filter(f=>/^\d+\.html$/.test(f)).length;
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1080,height:1350});
for(let i=0;i<n;i++){await p.setContent(fs.readFileSync(`${dir}/${i}.html`,'utf8'),{waitUntil:'load'});await p.addScriptTag({content:fs.readFileSync(gjs,'utf8')});
const r=await p.evaluate(()=>G.measureOverlapIssues(document).filter(x=>x.severity==='error').map(x=>x.message));
for(const m of r)console.log(`Slide ${i+1} ("${titles[i]||''}"): ${m}`);}
await b.close();
