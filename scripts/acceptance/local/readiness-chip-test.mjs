// Narrow-layout readiness indicator: below 1200px the topbar actions collapse
// into the project menu, hiding the not-configured pill. The readiness chip
// keeps "Hubungkan model" + its fix action visible; it hides when a provider
// is configured, on the magpie path, while busy, and on wide layouts.
// Fixture only - no real provider.
import path from'node:path';import os from'node:os';import fs from'node:fs';const out=process.env.DESEL_QA_OUTPUT||path.join(os.tmpdir(),'desel-ui-regressions');fs.mkdirSync(out,{recursive:true});
import{spawn}from'node:child_process';import puppeteer from'puppeteer-core';const root=process.cwd();const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1422'],{cwd:root,stdio:'ignore'});let b;
const boot=async(width,kind,apiKey)=>{const p=await b.newPage();await p.setViewport({width,height:844});await p.goto('http://127.0.0.1:1422/',{waitUntil:'networkidle0'});await p.evaluate(async(kind,apiKey)=>{const{useStudio}=await import('/src/state/studio.ts');useStudio.setState({settings:{...useStudio.getState().settings,providerKind:kind,apiKey,baseUrl:kind==='openai-compatible'?'https://api.openai.com/v1':'https://fixture.magpie.local'}})},kind,apiKey);await p.waitForFunction(()=>document.querySelector('.topbar-menu'));return p};
const chipVisible=p=>p.evaluate(()=>{const c=document.querySelector('.readiness-chip');return c?getComputedStyle(c).display!=='none':false});
try{await new Promise(r=>setTimeout(r,1200));b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
// Narrow, unconfigured: chip visible and opens settings.
let p=await boot(390,'openai-compatible','');
if(!await chipVisible(p))throw Error('chip hidden on narrow unconfigured');
const chipText=await p.evaluate(()=>document.querySelector('.readiness-chip').textContent);
if(!chipText.includes('Hubungkan model'))throw Error('chip label missing: '+chipText);
await p.evaluate(()=>document.querySelector('.readiness-chip').click());
await p.waitForFunction(()=>document.querySelector('.modal'));
// Menu pill still available as before.
await p.evaluate(()=>Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.trim()==='Tutup').click());
await p.close();
// Narrow, configured: chip hidden.
p=await boot(390,'openai-compatible','sk-fixture');if(await chipVisible(p))throw Error('chip visible with apiKey');await p.close();
// Narrow, magpie path: chip hidden.
p=await boot(390,'magpie-managed','');if(await chipVisible(p))throw Error('chip visible on magpie path');await p.close();
// Wide, unconfigured: chip visible (the menu pill is collapsed behind the project menu at all widths).
p=await boot(1440,'openai-compatible','');
if(!await chipVisible(p))throw Error('chip hidden on wide unconfigured');
await p.evaluate(()=>document.querySelector('.menu-trigger').click());
await p.waitForFunction(()=>document.querySelector('.topbar-actions.menu-open'));
if(!await p.evaluate(()=>document.querySelector('.topbar-actions.menu-open').innerText.includes('Hubungkan model')))throw Error('menu pill missing when menu open');
await p.close();
console.log({chipVisibleOnNarrowUnconfigured:true,chipLabelAndActionOpenSettings:true,chipHiddenWhenConfigured:true,chipHiddenOnMagpiePath:true,chipVisibleOnWide:true,menuPillIntactWhenOpen:true,noRealProvider:true});
}finally{if(b)await b.close();vite.kill();await new Promise(r=>vite.once('exit',r))}
