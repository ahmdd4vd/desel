/** Explicit allowlist. No URLs,position,dimensions,IDs or content are copied. */
const PROPERTIES=['color','background-color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style','border-top-color','border-right-color','border-bottom-color','border-left-color','border-top-left-radius','border-top-right-radius','border-bottom-left-radius','border-bottom-right-radius','opacity'] as const;
export type ObjectStyle=Partial<Record<typeof PROPERTIES[number],string>>;
export function captureObjectStyle(el:HTMLElement):ObjectStyle{
 const css=el.ownerDocument.defaultView?.getComputedStyle(el);if(!css)throw Error('Elemen belum siap.');const result:ObjectStyle={};for(const p of PROPERTIES){const value=css.getPropertyValue(p);if(value&&!/url\s*\(/i.test(value)&&value.length<1000)result[p]=value}return result;
}
export function applyObjectStyle(el:HTMLElement,style:ObjectStyle){for(const p of PROPERTIES){const v=style[p];if(v&&v.length<1000&&!/url\s*\(/i.test(v))el.style.setProperty(p,v)}}
