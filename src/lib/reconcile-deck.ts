import type{Deck,Slide}from './types';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Merge accepted server state with edits that have not finished saving yet.
 * Local conflicting work stays on canvas and is snapshotted when later saved;
 * the accepted server version remains the next save's expected baseline. */
export function reconcileDeck(base:Deck|undefined,local:Deck,incoming:Deck):{deck:Deck;retained:boolean;conflicts:boolean}{
 if(!base||local.id!==incoming.id||base.id!==incoming.id)return{deck:incoming,retained:false,conflicts:false};
 let retained=false,conflicts=false;const merged={...incoming};
 for(const key of ['title','caption','aspect','styleGuide','palette','brandHandle','saveLabel','fromTemplateId'] as const){if(!equal(local[key],base[key])){retained=true;if(!equal(incoming[key],base[key])&&!equal(incoming[key],local[key]))conflicts=true;Object.assign(merged,{[key]:local[key]});}}
 const old=new Map(base.slides.map(s=>[s.id,s]));const remote=new Map(incoming.slides.map(s=>[s.id,s]));const localMap=new Map(local.slides.map(s=>[s.id,s]));const result=new Map<string,Slide>();
 for(const server of incoming.slides){const prev=old.get(server.id),mine=localMap.get(server.id);if(prev&&!mine){retained=true;if(!equal(server,prev))conflicts=true;continue;}if(mine&&prev&&!equal(mine,prev)){retained=true;const slide={...server};for(const key of ['title','html','rationale','hidden'] as const){if(!equal(mine[key],prev[key])){if(!equal(server[key],prev[key])&&!equal(server[key],mine[key]))conflicts=true;Object.assign(slide,{[key]:mine[key]});}}result.set(server.id,slide);}else result.set(server.id,server);}
 for(const mine of local.slides){if(remote.has(mine.id))continue;const prev=old.get(mine.id);if(!prev||!equal(mine,prev)){retained=true;if(prev)conflicts=true;result.set(mine.id,mine);}}
 const baseOrder=base.slides.map(s=>s.id),localOrder=local.slides.map(s=>s.id);const order=equal(baseOrder,localOrder)?incoming.slides.map(s=>s.id):localOrder;if(!equal(baseOrder,localOrder))retained=true;
 merged.slides=[...order.filter(id=>result.has(id)).map(id=>result.get(id)!),...[...result.values()].filter(s=>!order.includes(s.id))];
 return{deck:merged,retained,conflicts};
}
