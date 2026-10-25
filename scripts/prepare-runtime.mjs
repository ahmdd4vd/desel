// Developer/build preparation only. Release app contains these files as Tauri
// resources; end users never install Magpie separately.
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,chmod,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../src-tauri/binaries/',import.meta.url);
const entries=[
 ['magpie-linux-amd64','magpie-cli-linux-amd64','614af55d482331fe7b2a864572d12529a072354b19879b77628a82605b2066cf'],
 ['magpie-windows-amd64.exe','magpie-cli-windows-amd64.exe','610e7e1484355db361a6651445d1659672fbc573953f024eb4c1f17e8943f881'],
];
const digest=b=>createHash('sha256').update(b).digest('hex');
await mkdir(root,{recursive:true});
for(const [file,asset,sha]of entries){const dest=new URL(file,root);let existing;try{existing=await readFile(dest);}catch{}if(existing&&digest(existing)===sha){console.log(`Verified bundled runtime ${file}`);continue;}if(existing)throw Error(`Runtime checksum mismatch: ${file}. Remove the file and rerun preparation.`);const url=`https://github.com/yetone/magpie/releases/download/v0.1.1404/${asset}`;const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error(`Runtime download failed: HTTP ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());if(digest(bytes)!==sha)throw Error(`Downloaded runtime checksum mismatch: ${file}`);const temp=new URL(file+'.download',root);try{await writeFile(temp,bytes,{flag:'wx',mode:0o755});await rename(temp,dest);await chmod(dest,0o755);}finally{await rm(temp,{force:true});}console.log(`Prepared bundled runtime ${file} at ${fileURLToPath(dest)}`);}
