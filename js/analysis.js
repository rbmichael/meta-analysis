import { tCritical, normalCDF, tCDF, chiSquareCDF } from "./utils.js";

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

export function compute(s, type) {

  // ================= BINARY DATA (OR / RR) =================
  if (type === "OR" || type === "RR") {

    let { a, b, c, d } = s;

    // Guard: invalid input
    if ([a, b, c, d].some(v => !isFinite(v) || v < 0)) {
      return {
        ...s,
        yi: NaN,
        vi: NaN,
        se: NaN,
        w: 0
      };
    }

    // Continuity correction
    if (a === 0 || b === 0 || c === 0 || d === 0) {
      a += 0.5;
      b += 0.5;
      c += 0.5;
      d += 0.5;
    }

    let yi, vi;

    if (type === "OR") {
      yi = Math.log((a * d) / (b * c));
      vi = 1/a + 1/b + 1/c + 1/d;
    }

    if (type === "RR") {
      const risk1 = a / (a + b);
      const risk2 = c / (c + d);

      yi = Math.log(risk1 / risk2);
      vi = (1/a - 1/(a + b)) + (1/c - 1/(c + d));
    }

    return {
      ...s,
      yi,
      vi: Math.max(vi, MIN_VAR),
      se: Math.sqrt(Math.max(vi, MIN_VAR)),
      w: 1 / Math.max(vi, MIN_VAR),
      md: yi,        // keep compatibility
      varMD: vi
    };
  }

  // ================= CONTINUOUS DATA =================
  if (type === "SMD") {
    const g = hedgesG(s);
    return {
      ...s,
      md: g.es,
      varMD: g.var,
      se: Math.sqrt(g.var),
      w: 1 / g.var,
      yi: g.es,
      vi: g.var
    };
  }

  // MD
  const varMD = Math.max((s.sd1 ** 2) / s.n1 + (s.sd2 ** 2) / s.n2, MIN_VAR);

  return {
    ...s,
    md: s.m1 - s.m2,
    varMD,
    se: Math.sqrt(varMD),
    w: 1 / varMD,
    yi: s.m1 - s.m2,
    vi: varMD
  };
}

// ================= REML TAU² =================
function tau2_REML(studies, tol = 1e-8, maxIter = 100){

  const k = studies.length;
  if(k <= 1) return 0;

  // Initial FE
  const wFE = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W = d3.sum(wFE);

  const FE = W > 0
    ? d3.sum(studies.map((d,i) => d.yi * wFE[i])) / W
    : 0;

  const Q = d3.sum(studies.map((d,i) =>
    wFE[i] * Math.pow(d.yi - FE, 2)
  ));

  const df = k - 1;

  const sumW2 = d3.sum(wFE.map(w => w*w));
  const C = W - (sumW2 / W);

  let tau2 = C > 0 ? Math.max(0, (Q - df) / C) : 0;

  // Iterative REML
  for(let iter = 0; iter < maxIter; iter++){

    const w = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
    const Wt = d3.sum(w);

    const mu = d3.sum(studies.map((d,i) => d.yi * w[i])) / Wt;

    let S = 0;
    let info = 0;

    for(let i = 0; i < k; i++){
      const vi = studies[i].vi + tau2;
      const ri = studies[i].yi - mu;

      S += (ri*ri - vi) / (vi*vi);
      info += 1 / (vi*vi);
    }

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

// ================= EGGER TEST =================
export function eggerTest(studies){

 const k = studies.length;
 if(k < 3){
  return { intercept: NaN, slope: NaN, p: NaN };
 }

 const Z = studies.map(d => d.yi / d.se);
 const X = studies.map(d => 1 / d.se);

 const meanX = d3.mean(X);
 const meanZ = d3.mean(Z);

 // slope
 let num = 0, den = 0;
 for(let i=0;i<k;i++){
  num += (X[i]-meanX)*(Z[i]-meanZ);
  den += (X[i]-meanX)*(X[i]-meanX);
 }

 const slope = num / den;
 const intercept = meanZ - slope * meanX;

 // residual variance
 let rss = 0;
 for(let i=0;i<k;i++){
  const fit = intercept + slope * X[i];
  rss += (Z[i] - fit)**2;
 }

 const df = k - 2;
 const seIntercept = Math.sqrt(rss / df) * Math.sqrt(1/k + (meanX*meanX)/den);

 const t = intercept / seIntercept;

 // approximate p-value (use normal for now)
 const p = 2 * (1 - normalCDF(Math.abs(t)));

 return {
  intercept,
  slope,
  p,
  t
 };
}

// ================= INFLUENCE DIAGNOSTICS =================
export function influenceDiagnostics(studies, method="DL", ciMethod="normal"){
  const n = studies.length;
  if(n < 2) return [];

  // full RE meta-analysis
  const full = meta(studies, method, ciMethod);

  const diagnostics = studies.map((study, idx) => {
    // leave-one-out studies
    const loo = studies.filter((_, i) => i !== idx);
    const looMeta = meta(loo, method, ciMethod);

    // standardized residual
	const r = (study.yi - full.RE) / Math.sqrt(study.vi + full.tau2);

    // DFBETA for RE
	const dfbeta = (full.RE - looMeta.RE) / looMeta.seRE;

    // change in tau²
    const deltaTau2 = full.tau2 - looMeta.tau2;

	const outlier = Math.abs(r) > 2;
	const influential = Math.abs(dfbeta) > 1;

	return {
	  label: study.label,
	  RE_loo: looMeta.RE,
	  tau2_loo: looMeta.tau2,
	  stdResidual: r,
	  DFBETA: dfbeta,
	  deltaTau2: deltaTau2,
	  outlier,
	  influential
	};
  });

  return diagnostics;
}

export function subgroupAnalysis(studies, method="REML", ciMethod="z") {
  // Filter valid studies with group
  const valid = studies.filter(s =>
    s && isFinite(s.yi) && isFinite(s.vi) && s.group != null && s.group !== ""
  );

  if (valid.length < 2) return null;

  // Group studies
  const groups = {};
  valid.forEach(s => {
    const g = String(s.group).trim();
    if (!g) return;
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  const groupNames = Object.keys(groups);
  if (groupNames.length < 2) return null;

  // Overall meta
  const overall = meta(valid, method, ciMethod);

  // Per-group meta
  const results = {};
  let Qwithin_sum = 0;

  groupNames.forEach(g => {
    const groupStudies = groups[g];
    let res;

    if (groupStudies.length === 1) {
      // Only one study → use its yi/vi as effect size
      const s = groupStudies[0];
      res = {
        RE: s.yi,
        se: Math.sqrt(s.vi),
        ciLow: s.yi - 1.96 * Math.sqrt(s.vi),
        ciHigh: s.yi + 1.96 * Math.sqrt(s.vi),
        tau2: 0,
        I2: 0,
        Q: 0
      };
    } else {
      res = meta(groupStudies, method, ciMethod);
    }

    // Map to UI-friendly structure
    results[g] = {
      k: groupStudies.length,
      y: res.RE,
      se: res.se ?? Math.sqrt(res.vi ?? 0), // fallback if se missing
      ci: { lb: res.ciLow, ub: res.ciHigh },
      tau2: res.tau2 ?? 0,
      I2: res.I2 ?? 0
    };

    if (isFinite(res.Q)) Qwithin_sum += res.Q;
  });

  // Between-group heterogeneity
  let Qbetween = overall.Q - Qwithin_sum;
  if (!isFinite(Qbetween) || Qbetween < 0) Qbetween = 0;

  const df = groupNames.length - 1;

  // p-value using chi-square CDF
  const p = 1 - chiSquareCDF(Qbetween, df);

  return {
    groups: results,
    Qbetween,
    df,
    p,
    k: valid.length,
    G: groupNames.length
  };
}

// ================ META-ANALYSIS ===============
export function meta(studies, method="DL", ciMethod="normal") {

  const k = studies.length;

  if (k === 0) {
    return {
      FE: NaN, seFE: NaN,
      RE: NaN, seRE: NaN,
      tau2: 0, Q: NaN, df: 0, I2: 0,
      predLow: NaN, predHigh: NaN,
      ciLow: NaN, ciHigh: NaN,
      crit: NaN, stat: NaN, pval: NaN, dist: null
    };
  }

  // ---------- fixed-effect ----------
  const wFE = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W = d3.sum(wFE);

  const FE = W > 0
    ? d3.sum(studies.map((d, i) => d.yi * wFE[i])) / W
    : NaN;

  const seFE = W > 0 ? Math.sqrt(1 / W) : NaN;

  // ---------- heterogeneity (FE weights) ----------
  let Q = 0;
  for (let i = 0; i < k; i++) {
    Q += wFE[i] * Math.pow(studies[i].yi - FE, 2);
  }

  const dfQ = k - 1;

  // ---------- I² ----------
  let I2 = 0;
  if (Q > dfQ && Q > 0) {
    I2 = ((Q - dfQ) / Q) * 100;
  }
  I2 = Math.max(0, Math.min(100, I2));

  // ---------- tau² ----------
  let tau2 = 0;

  if (method === "REML") {
    tau2 = tau2_REML(studies);
  } else {
    const sumW2 = d3.sum(wFE.map(w => w * w));
    const C = W - (sumW2 / W);
    tau2 = C > 0 ? Math.max(0, (Q - dfQ) / C) : 0;
  }

  // ---------- random-effects ----------
  const wRE = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
  const WRE = d3.sum(wRE);

  const RE = WRE > 0
    ? d3.sum(studies.map((d, i) => d.yi * wRE[i])) / WRE
    : NaN;

  let seRE = WRE > 0 ? Math.sqrt(1 / WRE) : NaN;

  let crit = 1.96;
  let stat, pval, dist;

  // ---------- Knapp-Hartung (exact small-sample t) ----------
  if ((ciMethod === "KH" || ciMethod === "t") && k > 1) {

    const dfKH = k - 1;

    let sum = 0;
    for (let i = 0; i < k; i++) {
      sum += wRE[i] * Math.pow(studies[i].yi - RE, 2);
    }

    const varKH = sum / (dfKH * WRE);
    seRE = Math.sqrt(Math.max(varKH, 0));

    crit = tCritical(dfKH);
    stat = RE / seRE;
    dist = "t";
    pval = 2 * (1 - tCDF(Math.abs(stat), dfKH));

  } else {

    stat = RE / seRE;
    dist = "z";
    pval = 2 * (1 - normalCDF(Math.abs(stat)));
  }

  // ---------- prediction interval ----------
  const predVar = seRE * seRE + tau2;

  return {
    FE,
    seFE,
    RE,
    seRE,
    tau2,
    Q,
    df: dfQ,
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