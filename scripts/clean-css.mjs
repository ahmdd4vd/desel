// Remove only provably superseded declarations: identical selector, property,
// ancestor conditions and importance. Preserve order and shorthand semantics.
import fs from 'node:fs';import postcss from 'postcss';
const file='src/styles/app.css',css=fs.readFileSync(file,'utf8'),root=postcss.parse(css);
const seen=new Map();let removed=0;
const rules=[];root.walkRules(r=>rules.push(r));
for(const rule of rules.reverse()){
 const chain=[];for(let p=rule.parent;p&&p.type!=='root';p=p.parent)chain.unshift(`${p.name}:${p.params}`);
 // Multi-selector rules keep their exact list to avoid changing specificity.
 const key=`${chain.join('/')}//${rule.selector}`;
 let props=seen.get(key);if(!props)seen.set(key,props=new Map());
 for(const d of [...rule.nodes].reverse())if(d.type==='decl'){
  const next=props.get(d.prop);if(next&&(next.important||!d.important)){d.remove();removed++}else props.set(d.prop,d);
 }
 if(!rule.nodes.some(n=>n.type==='decl'||n.type==='rule'||n.type==='atrule'))rule.remove();
}
root.walkComments(c=>{if(/Isolated direction study|Measured Harness|Review[234]:|Calm UI layer/.test(c.text))c.remove()});
let result=root.toString().replace(/\n{3,}/g,'\n\n');
fs.writeFileSync(file,result);console.log({removed,bytesBefore:css.length,bytesAfter:result.length});
