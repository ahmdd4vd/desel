import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/lib/reconcile-deck.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const{reconcileDeck}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const base={id:'d',title:'Title',caption:'',aspect:'4:5',slides:[{id:'a',title:'A',html:'old A',rationale:'',hidden:false},{id:'b',title:'B',html:'old B',rationale:'',hidden:false}],styleGuide:'',palette:[],brandHandle:'',saveLabel:'',fromTemplateId:null,createdAt:'',updatedAt:''};
const copy=()=>structuredClone(base);
let local=copy(),remote=copy();local.title='local';local.slides[0].html='manual';remote.slides[0].html='agent';remote.slides[0].title='agent title';remote.slides[1].html='unrelated agent';
let m=reconcileDeck(base,local,remote);assert.equal(m.conflicts,true);assert.equal(m.retained,true);assert.equal(m.deck.title,'local');assert.equal(m.deck.slides[0].html,'manual');assert.equal(m.deck.slides[0].title,'agent title');assert.equal(m.deck.slides[1].html,'unrelated agent');
local=copy();remote=copy();local.slides.reverse();remote.slides.push({...remote.slides[0],id:'c',title:'new'});m=reconcileDeck(base,local,remote);assert.deepEqual(m.deck.slides.map(s=>s.id),['b','a','c']);assert.equal(m.conflicts,false);
local=copy();remote=copy();local.slides.pop();remote.slides[1].html='updated deleted';m=reconcileDeck(base,local,remote);assert.equal(m.deck.slides.length,1);assert.equal(m.conflicts,true);
local=copy();remote=copy();local.slides[0].html='unsaved resurrect';remote.slides.shift();m=reconcileDeck(base,local,remote);assert.equal(m.conflicts,true);assert.equal(m.deck.slides.find(s=>s.id==='a').html,'unsaved resurrect');
m=reconcileDeck(base,copy(),copy());assert.equal(m.retained,false);assert.equal(m.conflicts,false);
const other={...copy(),id:'other'};assert.equal(reconcileDeck(base,copy(),other).deck,other);
console.log('Editor contracts: same-slide field merge, unrelated changes, order/add/delete conflicts and project boundary pass.');

const draftSource=await fs.readFile(new URL('../src/lib/local-drafts.ts',import.meta.url),'utf8');
const draftJs=ts.transpileModule(draftSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
const{readLocalDraft,retainLocalDraft,clearLocalDraft}=await import(`data:text/javascript;base64,${Buffer.from(draftJs).toString('base64')}`);
assert.equal(retainLocalDraft(base),true);assert.equal(readLocalDraft('d').deck.title,'Title');
const newer={...base,title:'newer'};retainLocalDraft(newer);clearLocalDraft('d',base);assert.equal(readLocalDraft('d').deck.title,'newer');clearLocalDraft('d',newer);assert.equal(readLocalDraft('d'),null);
assert.equal(retainLocalDraft({...base,title:'a'.repeat(9*1024*1024)}),false);
globalThis.localStorage.setItem=()=>{throw Error('quota')};assert.equal(retainLocalDraft(base),false);
console.log('Local draft contracts: retention, matching-only cleanup, oversized and quota failure pass.');

// A damaged recovery record must not be silently replaced by the next edit.
globalThis.localStorage.setItem=(k,v)=>storage.set(k,v);
for(const damaged of ['{broken draft', '[]', 'null', '"not a draft record"']){
 storage.set('desel.local-drafts.v1',damaged);
 assert.equal(readLocalDraft('d'),null);
 assert.equal(retainLocalDraft(base),false,'damaged draft storage was overwritten');
 clearLocalDraft('d');
 assert.equal(storage.get('desel.local-drafts.v1'),damaged,'damaged draft bytes were removed');
}
console.log('Damaged draft storage: malformed/wrong-root bytes preserved; no false retention claim.');

for(const deck of [
 {id:'d',slides:[]},
 {...base,slides:[{id:'a',title:'A',html:42}]},
 {...base,slides:[{...base.slides[0]},{...base.slides[0]}]},
 {...base,palette:'not-an-array'},
 {...base,aspect:'unknown'},
 {...base,title:null}
]){
 const raw=JSON.stringify({d:{deck,savedAt:'2026-10-25T00:00:00.000Z'}});
 storage.set('desel.local-drafts.v1',raw);
 assert.equal(readLocalDraft('d'),null,'invalid deck offered for draft recovery');
 assert.equal(storage.get('desel.local-drafts.v1'),raw,'invalid deck bytes changed on read');
}
console.log('Recovery draft deck contracts: invalid fields, duplicate slide IDs and unsupported aspect rejected.');

for(const damagedEntry of [null,42,{deck:{id:'other',slides:[]},savedAt:'invalid'}]){
 const raw=JSON.stringify({other:damagedEntry});storage.set('desel.local-drafts.v1',raw);
 assert.equal(retainLocalDraft(base),false,'invalid sibling draft entry was rewritten');
 clearLocalDraft('d');assert.equal(storage.get('desel.local-drafts.v1'),raw,'invalid sibling bytes changed');
}
console.log('Recovery draft sibling contracts: damaged entries preserve original bytes.');
const mixedDrafts=JSON.stringify({d:{deck:base,savedAt:'2026-10-25T00:00:00.000Z'},other:null});
storage.set('desel.local-drafts.v1',mixedDrafts);
assert.equal(readLocalDraft('d')?.deck.title,base.title,'valid draft hidden by damaged sibling');
assert.equal(storage.get('desel.local-drafts.v1'),mixedDrafts);
console.log('Recovery draft isolation: valid project remains readable beside damaged sibling.');

const brSrc=await fs.readFile(new URL('../src/lib/chat-branches.ts',import.meta.url),'utf8');
const brJs=ts.transpileModule(brSrc,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const B=await import(`data:text/javascript;base64,${Buffer.from(brJs).toString('base64')}`);
let bs=B.emptyBranches();for(const id of['u1','a1','u2','a2'])bs=B.appendNode(bs,id);
assert.deepEqual(B.pathTo(bs,bs.activeLeaf),['u1','a1','u2','a2']);
bs=B.forkFrom(bs,'a1');bs=B.appendNode(bs,'u2b');bs=B.appendNode(bs,'a2b','a2');
assert.deepEqual(B.pathTo(bs,bs.activeLeaf),['u1','a1','u2b','a2b']);
const msgs=['u1','a1','u2','a2','u2b','a2b'].map(id=>({id,deckId:'d',role:'user',content:id,createdAt:''}));
assert.deepEqual(B.activeMessages(bs,msgs).map(m=>m.id),['u1','a1','u2b','a2b']);
const lin=[{id:'x1',role:'user'},{id:'y1',role:'assistant'},{id:'x2',role:'user'},{id:'y2',role:'assistant'}];let sd=B.seedFromLog(lin);assert.deepEqual(B.activeMessages(sd,lin).map(m=>m.id),['x1','y1','x2','y2']);sd=B.forkAtUser(sd,'x2');sd=B.appendNode(sd,'x3');assert.deepEqual(B.activeMessages(sd,[...lin,{id:'x3',role:'user'},{id:'y3',role:'assistant'}]).map(m=>m.id),['x1','y1','x3','y3']);assert.deepEqual(B.siblings(sd,'x3').sort(),['x2','x3']);
assert.deepEqual(B.siblings(bs,'u2').sort(),['u2','u2b']);
bs=B.switchTo(bs,'u2');assert.equal(bs.activeLeaf,'a2');assert.equal(B.forkFrom(bs,'nope'),bs);
assert.equal(B.appendNode(bs,'a2'),bs);
const cyc={nodes:[{messageId:'x',parentId:'y',branchId:'m'},{messageId:'y',parentId:'x',branchId:'m'}],activeLeaf:'x'};assert.equal(B.pathTo(cyc,'x').length,2);
console.log('Chat branch contracts: fork, retry lineage, active-path isolation, sibling switch, cycle safety pass.');
