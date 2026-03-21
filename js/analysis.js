import { tCritical, normalCDF, tCDF } from "./utils.js";

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

export function compute(s,type){
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

// ================= REML TAU² =================
function tau2_REML(studies, tol = 1e-8, maxIter = 100){

 const k = studies.length;
 if(k <= 1) return 0;

 // Initial value: DL estimate (good starting point)
 const W = d3.sum(studies, d => d.w);
 const FE = d3.sum(studies, d => d.md * d.w) / W;

 const Q = d3.sum(studies, d => d.w * (d.md - FE)**2);
 const df = k - 1;
 const sumW2 = d3.sum(studies, d => d.w * d.w);
 const C = W - (sumW2 / W);

 let tau2 = C > 0 ? Math.max(0, (Q - df) / C) : 0;

 // Iterative REML
 for(let iter = 0; iter < maxIter; iter++){

  const w = studies.map(d => 1 / Math.max(d.varMD + tau2, MIN_VAR));
  const Wt = d3.sum(w);

  const mu = d3.sum(studies.map((d,i) => d.md * w[i])) / Wt;

  // Score function (REML)
  let S = 0;
  let info = 0;

  for(let i = 0; i < k; i++){
   const vi = studies[i].varMD + tau2;
   const ri = studies[i].md - mu;

   S += (ri*ri - vi) / (vi*vi);
   info += 1 / (vi*vi);
  }

  // Newton-Raphson update
  const delta = S / info;
  const newTau2 = Math.max(0, tau2 + delta);

  if(Math.abs(newTau2 - tau2) < tol){
   tau2 = newTau2;
   break;
  }

  tau2 = newTau2;
 }

 return tau2;
}

export function meta(studies, method="DL", ciMethod="normal"){

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

 // ---------- tau² (REML or DerSimonian–Laird) ----------
 let tau2;

 if(method === "REML"){
  tau2 = tau2_REML(studies);
 } else {
  const sumW2 = d3.sum(studies, d => d.w * d.w);
  const C = W - (sumW2 / W);
  tau2 = C > 0 ? Math.max(0, (Q - df) / C) : 0;
 }

 // ---------- random-effects ----------
 const wRE = studies.map(d => 1 / Math.max(d.varMD + tau2, MIN_VAR));
 const WRE = d3.sum(wRE);

 const RE = WRE > 0
  ? d3.sum(studies.map((d,i) => d.md * wRE[i])) / WRE
  : NaN;

 let seRE = WRE > 0 ? Math.sqrt(1 / WRE) : NaN;
 let crit = 1.96; // default normal

 if(ciMethod === "KH" && studies.length > 1){

  const df = studies.length - 1;

  // KH variance estimator
  let sum = 0;
  for(let i = 0; i < studies.length; i++){
   const diff = studies[i].md - RE;
   sum += wRE[i] * diff * diff;
  }

  const varKH = sum / (df * WRE);
  seRE = Math.sqrt(Math.max(varKH, 0));

  crit = tCritical(df);
 }

let stat, pval, dist;

if(ciMethod === "KH" && studies.length > 1){

 const df = studies.length - 1;

 stat = RE / seRE;
 dist = "t";

 const p = 1 - tCDF(Math.abs(stat), df);
 pval = 2 * p;

} else {

 stat = RE / seRE;
 dist = "z";

 const p = 1 - normalCDF(Math.abs(stat));
 pval = 2 * p;
} 
 
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
  predHigh: RE + 1.96 * Math.sqrt(predVar),
  ciLow: RE - crit * seRE,
  ciHigh: RE + crit * seRE,
  crit,
  stat,
  pval,
  dist
 };
}