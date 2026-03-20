window.MIN_VAR = 1e-8;

// ================= STATS =================
function hedgesG(s){
 const sp = Math.sqrt(((s.n1-1)*s.sd1**2 + (s.n2-1)*s.sd2**2) / (s.n1+s.n2-2));
 const d = (s.m1 - s.m2) / sp;
 const J = 1 - (3 / (4*(s.n1+s.n2) - 9));
 const g = J * d;

 const varg = (s.n1+s.n2)/(s.n1*s.n2) + (g*g)/(2*(s.n1+s.n2-2));

 return {
  es: g,
  var: Math.max(varg, MIN_VAR)
 };
}

function compute(s,type){
 if(type === "SMD"){
  const g = hedgesG(s);
  return {
   ...s,
   md: g.es,
   varMD: g.var,
   se: Math.sqrt(g.var),
   w: 1 / g.var
  };
 }

 const varMD = Math.max((s.sd1**2)/s.n1 + (s.sd2**2)/s.n2, MIN_VAR);

 return {
  ...s,
  md: s.m1 - s.m2,
  varMD,
  se: Math.sqrt(varMD),
  w: 1 / varMD
 };
}

function meta(studies){

 // ---------- guards ----------
 const k = studies.length;
 if(k === 0){
  return {
   FE: NaN, seFE: NaN,
   RE: NaN, seRE: NaN,
   tau2: 0, Q: NaN, df: 0, I2: 0,
   predLow: NaN, predHigh: NaN
  };
 }

 // ---------- fixed-effect ----------
 const W = d3.sum(studies, d => d.w);
 const FE = W > 0 ? d3.sum(studies, d => d.md * d.w) / W : 0;
 const seFE = W > 0 ? Math.sqrt(1 / W) : NaN;

 // ---------- heterogeneity (FE weights ONLY) ----------
 let Q = 0;
 for(let i = 0; i < k; i++){
  const d = studies[i];
  const diff = d.md - FE;
  Q += d.w * diff * diff;
 }

 const df = k - 1;

 // ---------- I² ----------
 let I2 = 0;
 if(Q > df && Q > 0){
  I2 = ((Q - df) / Q) * 100;
 }
 I2 = Math.max(0, Math.min(100, I2));

 // ---------- tau² (DerSimonian–Laird) ----------
 const sumW2 = d3.sum(studies, d => d.w * d.w);
 const C = W > 0 ? (W - (sumW2 / W)) : 0;

 let tau2 = 0;
 if(C > 0 && Q > df){
  tau2 = (Q - df) / C;
 }
 tau2 = Math.max(0, tau2);

 // ---------- random-effects ----------
 const wRE = studies.map(d => 1 / Math.max(d.varMD + tau2, MIN_VAR));
 const WRE = d3.sum(wRE);

 const RE = WRE > 0
  ? d3.sum(studies.map((d,i) => d.md * wRE[i])) / WRE
  : NaN;

 const seRE = WRE > 0 ? Math.sqrt(1 / WRE) : NaN;

 // ---------- prediction interval ----------
 const predVar = (seRE * seRE) + tau2;

 return {
  FE,
  seFE,
  RE,
  seRE,
  tau2,
  Q,
  df,
  I2,
  predLow: RE - 1.96 * Math.sqrt(predVar),
  predHigh: RE + 1.96 * Math.sqrt(predVar)
 };
}