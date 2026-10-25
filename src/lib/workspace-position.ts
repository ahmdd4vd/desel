/** Workspace metadata must never make a valid project unrenderable. */
export function readWorkspacePosition(raw:string|null):{x:number;y:number}{
 try{const p=JSON.parse(raw??'null');if(p&&typeof p==='object'&&typeof p.x==='number'&&typeof p.y==='number'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=50000&&Math.abs(p.y)<=50000)return{x:p.x,y:p.y}}catch{/* Ignore malformed workspace metadata, not project data. */}
 return{x:0,y:0};
}
