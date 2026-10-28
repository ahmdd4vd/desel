import puppeteer from 'puppeteer-core';import fs from 'fs';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1080,height:1350});
let i=0;for(const f of process.argv.slice(3)){await p.setContent(fs.readFileSync(f,'utf8'),{waitUntil:'load'});await p.screenshot({path:process.argv[2]+i+'.png'});i++}await b.close();
