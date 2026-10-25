/** Only axis-aligned absolute/fixed objects in a measurable containing block.
 * Relative/flow objects retain their layout and are never converted. */
export function alignObject(el:HTMLElement,axis:'x'|'y',edge:'start'|'center'|'end'):boolean{
 const win=el.ownerDocument.defaultView;if(!win)return false;const css=win.getComputedStyle(el);if(!['absolute','fixed'].includes(css.position)||css.transform!=='none')return false;
 const parent=el.offsetParent as HTMLElement|null;if(!parent&&css.position!=='fixed')return false;
 const span=axis==='x'?(parent?.clientWidth??win.innerWidth):(parent?.clientHeight??win.innerHeight);const size=axis==='x'?el.offsetWidth:el.offsetHeight;
 if(!Number.isFinite(span)||span<=0||size<=0)return false;
 const margin=parseFloat(axis==='x'?css.marginLeft:css.marginTop)||0;const value=(edge==='start'?0:edge==='center'?(span-size)/2:span-size)-margin;
 if(axis==='x'){el.style.width=css.width;el.style.left=`${Math.round(value)}px`;el.style.right='auto'}else{el.style.height=css.height;el.style.top=`${Math.round(value)}px`;el.style.bottom='auto'}return true;
}
export function nudgeObject(el:HTMLElement,dx:number,dy:number):boolean{
 const css=el.ownerDocument.defaultView?.getComputedStyle(el);if(!css||!['absolute','fixed','relative'].includes(css.position)||css.transform!=='none')return false;
 if(dx){const old=parseFloat(css.left);if(!Number.isFinite(old)&&css.position!=='relative')return false;if(css.position!=='relative')el.style.width=css.width;el.style.left=`${Math.round((Number.isFinite(old)?old:0)+dx)}px`;el.style.right='auto'}
 if(dy){const old=parseFloat(css.top);if(!Number.isFinite(old)&&css.position!=='relative')return false;if(css.position!=='relative')el.style.height=css.height;el.style.top=`${Math.round((Number.isFinite(old)?old:0)+dy)}px`;el.style.bottom='auto'}return true;
}

/** Editing an inset must not shrink a stretched positioned object. */
export function setObjectBox(el:HTMLElement,prop:'left'|'top'|'width'|'height',value:number):boolean{
 if(!Number.isFinite(value)||Math.abs(value)>50000)return false;
 const css=el.ownerDocument.defaultView?.getComputedStyle(el);if(!css)return false;
 if(prop==='left'||prop==='top'){
  if(!['absolute','fixed','relative'].includes(css.position))return false;
  if(css.position!=='relative')el.style[prop==='left'?'width':'height']=css[prop==='left'?'width':'height'];
  el.style[prop==='left'?'right':'bottom']='auto';
 }
 el.style[prop]=`${prop==='width'||prop==='height'?Math.max(1,value):value}px`;return true;
}
