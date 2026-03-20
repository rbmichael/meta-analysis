// ================= TRIM-FILL =================
export function trimFill(studies){
 if(studies.length<3) return [];
 const center=d3.median(studies,d=>d.md);
 let left=studies.filter(d=>d.md<center);
 let right=studies.filter(d=>d.md>center);
 let missing=Math.abs(left.length-right.length);
 let source=left.length>right.length?left:right;

 return source.slice(0,missing).map(d=>({
  ...d,
  md:2*center-d.md,
  filled:true,
  label:d.label+" (filled)"
 }));
}
