import type { Deck } from './types';
import { measureOverlapIssues } from './geometry';
import { reviewRevision } from './render-review';

/** Evidence is supplied by a reviewer, never inferred from filenames, alt text
 * or a model saying it saw an image. A clean result is only a structural gate. */
export interface BenchmarkEvidence {
  slides: Record<string, {role:'cover'|'body'|'closer'|'other';mediaKind?:'illustration'|'product-screenshot'|'other';sourceUrl?:string;reviewed?:boolean}>;
  referenceSetAvailable:boolean;
  claimsReviewed:boolean;
  rightsReviewed:boolean;
}
export interface BenchmarkSlide {
  id:string; role:string; textCharacters:number; mediaCoverage:number;
  loadedImages:number; missingImages:number; largeVectors:number;
  geometryFindings:string[]; failures:string[]; review:string[];
}
export interface BenchmarkReport {
  schema:'desel.design-benchmark.v1'; structuralGate:'clear'|'failed';
  qualityApproval:'unverified'; parity:'unverified'; slides:BenchmarkSlide[];
  failures:string[]; review:string[]; policy:{minimumMediaFraction:number;ruleSource:string;thresholdStatus:string};
}
const MIN_MEDIA=.12;
export function inspectDesignBenchmark(deck:Deck,frames:(HTMLIFrameElement|null)[],evidence:BenchmarkEvidence):BenchmarkReport {
  const failures:string[]=[];const review:string[]=[];
  const slides=deck.slides.flatMap((slide,index):BenchmarkSlide[]=>{
    if(slide.hidden)return[];
    const entry=evidence.slides[slide.id],doc=frames[index]?.contentDocument,win=doc?.defaultView;
    const result:BenchmarkSlide={id:slide.id,role:entry?.role??'unassigned',textCharacters:0,mediaCoverage:0,loadedImages:0,missingImages:0,largeVectors:0,geometryFindings:[],failures:[],review:[]};
    if(!doc?.body||!win){result.failures.push('Current rendered document missing.');return[result]}
    const expected=reviewRevision(slide.id,deck.aspect,slide.html);
    if(doc.querySelector('meta[name="desel-review-revision"]')?.getAttribute('content')!==expected){result.failures.push('Rendered document is stale or has no matching revision marker.');return[result]}
    const canvas=doc.body.getBoundingClientRect();
    if(!canvas.width||!canvas.height){result.failures.push('Canvas has no area.');return[result]}
    const visible=(el:Element)=>{for(let p:Element|null=el;p;p=p.parentElement){const c=win.getComputedStyle(p);if(c.display==='none'||c.visibility!=='visible'||Number(c.opacity)<.4)return false}return true};
    type Box={left:number;right:number;top:number;bottom:number};const media:Box[]=[];
    const add=(el:Element)=>{if(!visible(el))return;const r=el.getBoundingClientRect();const b={left:Math.max(canvas.left,r.left),right:Math.min(canvas.right,r.right),top:Math.max(canvas.top,r.top),bottom:Math.min(canvas.bottom,r.bottom)};if(b.right>b.left&&b.bottom>b.top)media.push(b)};
    for(const image of Array.from(doc.images)){
      if(!visible(image))continue;
      if(!image.complete||!image.naturalWidth){result.missingImages++;continue}
      result.loadedImages++;add(image);
    }
    for(const svg of Array.from(doc.querySelectorAll('svg')).filter(s=>!s.parentElement?.closest('svg'))){
      if(!visible(svg))continue;const r=svg.getBoundingClientRect();
      // Small icons and hidden vectors cannot make a text-only deck pass.
      if(r.width*r.height>=canvas.width*canvas.height*.04){result.largeVectors++;add(svg)}
    }
    // Exact union area of axis-aligned clipped boxes, avoids counting stacked
    // images twice. CSS transforms/crops do NOT prove useful artwork coverage.
    const xs=[...new Set(media.flatMap(b=>[b.left,b.right]))].sort((a,b)=>a-b);let area=0;
    for(let i=1;i<xs.length;i++){const left=xs[i-1],right=xs[i];const spans=media.filter(b=>b.left<right&&b.right>left).map(b=>[b.top,b.bottom]).sort((a,b)=>a[0]-b[0]);let start=0,end=0,height=0;for(const[a,b]of spans){if(a>end){height+=end-start;start=a;end=b}else end=Math.max(end,b)}height+=end-start;area+=(right-left)*height}
    result.mediaCoverage=Number((area/(canvas.width*canvas.height)).toFixed(4));
    const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let node:Node|null;
    while((node=walker.nextNode())){const p=node.parentElement;if(p&&!p.closest('style,script')&&visible(p))result.textCharacters+=(node.textContent?.trim().length??0)}
    result.geometryFindings=measureOverlapIssues(doc).map(i=>i.message);
    if(!entry)result.review.push('Slide role has not been assigned by reviewer.');
    if(result.missingImages)result.failures.push('Visible image failed to load.');
    if(result.geometryFindings.length)result.failures.push('Rendered geometry needs review.');
    if(!result.textCharacters)result.review.push('No visible text; check narrative intent.');
    if(entry?.role==='cover'||entry?.role==='body'){
      if(result.mediaCoverage<MIN_MEDIA)result.failures.push('No substantial loaded image/vector focal area (text-only/decorative-only risk).');
      if(entry.role==='body'&&!result.loadedImages)result.failures.push('Body has no loaded raster screenshot.');
      const wanted=entry.role==='body'?'product-screenshot':'illustration';
      if(entry.mediaKind!==wanted||!entry.reviewed)result.review.push(`Reviewer must confirm relevant ${wanted}, not a pasted unrelated image.`);
      if(!entry.sourceUrl||!/^https:\/\//i.test(entry.sourceUrl))result.review.push('Primary visual source/rights evidence not supplied.');
    }
    if(entry?.role==='closer')result.review.push('Closer must suit narrative; CTA is not mandatory.');
    result.review.push('Focal point, crop, hierarchy, screenshot legibility and reference parity require pixel review.');
    return[result];
  });
  if(!slides.length)failures.push('No visible slides.');
  if(!slides.some(s=>s.role==='cover'))review.push('Cover role not assigned; no fixed slide count or mandatory closer is assumed.');
  if(!evidence.referenceSetAvailable)review.push('Original reference images/approved benchmark absent; image-to-image parity unavailable.');
  if(!evidence.claimsReviewed)review.push('Research claims have not been checked against primary sources.');
  if(!evidence.rightsReviewed)review.push('Asset rights have not been checked.');
  failures.push(...slides.flatMap(s=>s.failures.map(f=>`${s.id}: ${f}`)));
  review.push('Structural clearance is NOT premium-design, factual, rights or autonomous-generation approval.');
  return{schema:'desel.design-benchmark.v1',structuralGate:failures.length?'failed':'clear',qualityApproval:'unverified',parity:'unverified',slides,failures,review,policy:{minimumMediaFraction:MIN_MEDIA,ruleSource:'User-recorded cover illustration / real product screenshots + roomy text / suitable closer; text-only slides rejected.',thresholdStatus:'12% media-box union is a local triage heuristic, NOT a user-approved pixel ratio or aesthetic score.'}};
}
