import { tCritical, normalCDF, tCDF, chiSquareCDF } from "./utils.js";

window.MIN_VAR = 1e-8;

// ================= STATS =================
function hedgesG(s, options = {}) {
  const n1 = s.n1, n2 = s.n2;
  const df = n1 + n2 - 2;

  // pooled SD
  const sp = Math.sqrt(((n1 - 1) * s.sd1 ** 2 + (n2 - 1) * s.sd2 ** 2) / df);

  // raw Cohen's d
  const d = (s.m1 - s.m2) / sp;

  // Hedge's g correction applied only if requested
  const applyHedges = options.hedgesCorrection ?? true;
  const J = 1 - (3 / (4 * df - 1));
  const g = applyHedges ? d * J : d;

  // variance using raw d (textbook style) or g
  const varBase = (n1 + n2) / (n1 * n2) + (d * d) / (2 * (n1 + n2));

  return {
    es: g,
    var: Math.max(varBase, MIN_VAR)
  };
}

// ================= DYNAMIC COMPUTE =================
export function compute(s, type, options = {}) {
  if (!type) {
    if ("m1" in s && "m2" in s && "sd1" in s && "sd2" in s && "n1" in s && "n2" in s) {
      type = "MD"; // default numeric
    } else if ("a" in s && "b" in s && "c" in s && "d" in s) {
      type = "OR"; // default binary counts
    } else {
      console.warn("Unknown effect type in compute", s);
      return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
    }
  }

	// ================= BINARY DATA =================
	if (type === "OR" || type === "RR" || type === "RD") {
	  let { a, b, c, d } = s;
	  if ([a, b, c, d].some(v => !isFinite(v) || v < 0)) 
		return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
	  
	  // optional continuity correction for OR/RR
	  if (type === "OR" || type === "RR") {
		if (a === 0 || b === 0 || c === 0 || d === 0) a += 0.5, b += 0.5, c += 0.5, d += 0.5;
	  }

	  let yi, vi;

	  if (type === "OR") { 
		yi = Math.log((a*d)/(b*c)); 
		vi = 1/a + 1/b + 1/c + 1/d; 
	  } else if (type === "RR") { 
		const risk1 = a/(a+b), risk2 = c/(c+d); 
		yi = Math.log(risk1/risk2); 
		vi = (1/a - 1/(a+b)) + (1/c - 1/(c+d)); 
	  } else if (type === "RD") {
		// Risk Difference
		const risk1 = a / (a + b);
		const risk2 = c / (c + d);
		yi = risk1 - risk2;
		vi = (risk1*(1-risk1)/ (a+b)) + (risk2*(1-risk2)/ (c+d));
	  }

	  const safeVi = Math.max(vi, MIN_VAR);
	  return {
		...s,
		yi,
		vi: safeVi,
		se: Math.sqrt(safeVi),
		w: 1/safeVi,
		md: yi,
		varMD: safeVi
	  };
	}

  // ================= CONTINUOUS DATA (SMD) =================
  if (type === "SMD") {
    const g = hedgesG(s, options);
    return { ...s, md: g.es, varMD: g.var, se: Math.sqrt(g.var), w: 1/g.var, yi: g.es, vi: g.var };
  }

	// ================ PAIRED MEAN DIFFERENCES ================
	if (type === "MD_paired") {
	  const { m_pre, m_post, sd_pre, sd_post, n, r } = s;

	  if (![m_pre, m_post, sd_pre, sd_post, n].every(isFinite) || n < 2) {
		return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
	  }

	  const corr = isFinite(r) ? r : 0.5; // fallback assumption

	  const md = m_post - m_pre;

	  const varMD = (sd_pre**2 + sd_post**2 - 2*corr*sd_pre*sd_post) / n;

	  return {
		...s,
		yi: md,
		vi: Math.max(varMD, MIN_VAR),
		se: Math.sqrt(Math.max(varMD, MIN_VAR)),
		w: 1 / Math.max(varMD, MIN_VAR),
		md,
		varMD
	  };
	}

	// =============== STANDARDIZED PAIRED MEAN DIFFERENCES =================
	if (type === "SMD_paired") {
	  const { m_pre, m_post, sd_pre, sd_post, n, r } = s;

	  if (![m_pre, m_post, sd_pre, sd_post, n].every(isFinite) || n < 2) {
		return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
	  }

	  const corr = isFinite(r) ? r : 0.5;

	  const mean_change = m_post - m_pre;

	  const sd_change = Math.sqrt(
		sd_pre**2 + sd_post**2 - 2*corr*sd_pre*sd_post
	  );

	  const d = mean_change / sd_change;

	  // Hedges correction
	  const df = n - 1;
	  const J = 1 - (3 / (4*df - 1));
	  const g = d * J;

	  const var_d = (1/n) + (d*d)/(2*n);

	  return {
		...s,
		yi: g,
		vi: Math.max(var_d, MIN_VAR),
		se: Math.sqrt(Math.max(var_d, MIN_VAR)),
		w: 1 / Math.max(var_d, MIN_VAR),
		md: g,
		varMD: var_d
	  };
	}

	// ================ GENERIC ===============
	if (type === "GENERIC") {
	  return {
		...s,
		yi: s.yi,
		vi: Math.max(s.vi, MIN_VAR),
		se: Math.sqrt(Math.max(s.vi, MIN_VAR)),
		w: 1 / Math.max(s.vi, MIN_VAR),
		md: s.yi,
		varMD: s.vi
	  };
	}

  // ================= MD fallback =================
  const varMD = Math.max((s.sd1**2)/s.n1 + (s.sd2**2)/s.n2, MIN_VAR);
  return { ...s, md: s.m1 - s.m2, varMD, se: Math.sqrt(varMD), w: 1/varMD, yi: s.m1 - s.m2, vi: varMD };
}

// ================= REML TAU² =================
// General-purpose REML estimator. Works for any effect type — studies must
// already have yi and vi set (as produced by compute()). Uses the DL
// estimator as the starting value and refines via Fisher scoring.
export function tau2_REML(studies, tol = 1e-10, maxIter = 100) {

  const k = studies.length;
  if (k <= 1) return 0;

  // --- 1️⃣ Initial tau² (DL / HE estimator) ---
  const w0 = studies.map(d => 1 / d.vi);
  const W0 = w0.reduce((a, b) => a + b, 0);
  const ybar = studies.reduce((sum, d, i) => sum + w0[i] * d.yi, 0) / W0;
  const Q = studies.reduce((sum, d, i) => sum + w0[i] * (d.yi - ybar) ** 2, 0);
  const c = W0 - w0.reduce((sum, wi) => sum + wi * wi / W0, 0);
  let tau2 = Math.max(0, (Q - (k - 1)) / c);

  // --- 2️⃣ Fisher scoring iteration ---
  for (let iter = 0; iter < maxIter; iter++) {
    const w = studies.map(d => 1 / (d.vi + tau2));
    const W = w.reduce((a, b) => a + b, 0);
    const mu = studies.reduce((sum, d, i) => sum + w[i] * d.yi, 0) / W;

    const h = w.map(wi => wi / W);

    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const vi_tau = studies[i].vi + tau2;
      const ri = studies[i].yi - mu;
      score += (ri * ri) / (vi_tau * vi_tau) - (1 - h[i]) / vi_tau;
      info  += (1 - h[i]) / (vi_tau * vi_tau);
    }

    let step = score / info;
    let newTau2 = tau2 + step;

    // Step-halving to keep tau² non-negative
    let halveIter = 0;
    while (newTau2 < 0 && halveIter < 20) {
      step /= 2;
      newTau2 = tau2 + step;
      halveIter++;
    }
    newTau2 = Math.max(0, newTau2);

    if (Math.abs(newTau2 - tau2) < tol) {
      tau2 = newTau2;
      break;
    }

    tau2 = newTau2;
  }

  return tau2;
}

// ================= TAU² PAULE-MANDEL =================
export function tau2_PM(studies, tol = 1e-10, maxIter = 100) {
  const k = studies.length;
  if (k <= 1) return 0;

  let tau2 = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    const w = studies.map(d => 1 / (d.vi + tau2));
    const W = w.reduce((a, b) => a + b, 0);
    const mu = studies.reduce((sum, d, i) => sum + w[i] * d.yi, 0) / W;

    const Q = studies.reduce((sum, d, i) => {
      return sum + w[i] * Math.pow(d.yi - mu, 2);
    }, 0);

    const newTau2 = Math.max(0, tau2 + (Q - (k - 1)) / W);

    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }

  return tau2;
}

// Compute RE mean given tau²
export function RE_mean(corrected, tau2) {
  const wRE = corrected.map(d => 1 / (d.vi + tau2));
  const WRE = wRE.reduce((a,b)=>a+b,0);
  return corrected.reduce((sum,d,i)=> sum + wRE[i]*d.yi,0)/WRE;
}

// -------------------------------
// Compute FE mean
export function FE_mean(corrected) {
  const wFE = corrected.map(d => 1 / d.vi);
  const WFE = wFE.reduce((a,b)=>a+b,0);
  return corrected.reduce((sum,d,i)=> sum + wFE[i]*d.yi,0)/WFE;
}

// -------------------------------
// Compute I²
export function I2(corrected, tau2) {
  const wRE = corrected.map(d => 1 / (d.vi + tau2));
  const WRE = wRE.reduce((a,b)=>a+b,0);
  const mu = corrected.reduce((sum,d,i)=> sum + wRE[i]*d.yi,0)/WRE;
  const Q = corrected.reduce((sum,d,i)=> sum + wRE[i]*(d.yi - mu)**2,0);
  const k = corrected.length;
  return k>1 ? Math.max(0, (Q - (k-1))/Q)*100 : 0;
}

// ================= EGGER TEST =================
export function eggerTest(studies){
  const k = studies.length;
  if(k < 3) return { intercept: NaN, slope: NaN, p: NaN };
  const Z = studies.map(d => d.yi / d.se);
  const X = studies.map(d => 1 / d.se);
  const meanX = d3.mean(X), meanZ = d3.mean(Z);
  let num=0, den=0;
  for(let i=0;i<k;i++){ num += (X[i]-meanX)*(Z[i]-meanZ); den += (X[i]-meanX)**2; }
  const slope = num/den;
  const intercept = meanZ - slope*meanX;
  let rss=0;
  for(let i=0;i<k;i++){ rss += (Z[i] - (intercept + slope*X[i]))**2; }
  const df = k-2;
  const seIntercept = Math.sqrt(rss/df) * Math.sqrt(1/k + (meanX*meanX)/den);
  const t = intercept/seIntercept;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  return { intercept, slope, p, t };
}

// ================= INFLUENCE DIAGNOSTICS =================
export function influenceDiagnostics(studies, method="DL", ciMethod="normal"){
  const n = studies.length;
  if(n < 2) return [];
  const full = meta(studies, method, ciMethod);
  return studies.map((study, idx) => {
    const loo = studies.filter((_, i) => i !== idx);
    const looMeta = meta(loo, method, ciMethod);
    const r = (study.yi - full.RE) / Math.sqrt(study.vi + full.tau2);
    const dfbeta = (full.RE - looMeta.RE) / looMeta.seRE;
    const deltaTau2 = full.tau2 - looMeta.tau2;
    const outlier = Math.abs(r) > 2;
    const influential = Math.abs(dfbeta) > 1;
    return {
      label: study.label,
      RE_loo: looMeta.RE,
      tau2_loo: looMeta.tau2,
      stdResidual: r,
      DFBETA: dfbeta,
      deltaTau2,
      outlier,
      influential
    };
  });
}

// ================= SUBGROUP =================
export function subgroupAnalysis(studies, method="REML", ciMethod="z") {
  const valid = studies.filter(s => s && isFinite(s.yi) && isFinite(s.vi) && s.group != null && s.group !== "");
  if(valid.length < 2) return null;
  const groups = {};
  valid.forEach(s => { const g = String(s.group).trim(); if(!g) return; if(!groups[g]) groups[g]=[]; groups[g].push(s); });
  const groupNames = Object.keys(groups);
  if(groupNames.length < 2) return null;
  const overall = meta(valid, method, ciMethod);
  const results = {};
  let Qwithin_sum = 0;
  groupNames.forEach(g => {
    const groupStudies = groups[g];
    let res;
    if(groupStudies.length === 1){
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
    results[g] = {
      k: groupStudies.length,
      y: res.RE,
      se: res.se ?? Math.sqrt(res.vi ?? 0),
      ci: { lb: res.ciLow, ub: res.ciHigh },
      tau2: res.tau2 ?? 0,
      I2: res.I2 ?? 0
    };
    if(isFinite(res.Q)) Qwithin_sum += res.Q;
  });
  let Qbetween = overall.Q - Qwithin_sum;
  if(!isFinite(Qbetween) || Qbetween < 0) Qbetween = 0;
  const df = groupNames.length - 1;
  const p = 1 - chiSquareCDF(Qbetween, df);
  return { groups: results, Qbetween, df, p, k: valid.length, G: groupNames.length };
}

// ================ META-ANALYSIS ===============
export function meta(studies, method="DL", ciMethod="normal") {
  const k = studies.length;
  if(k === 0){
    return { FE: NaN, seFE: NaN, RE: NaN, seRE: NaN, tau2:0, Q:NaN, df:0, I2:0, predLow:NaN, predHigh:NaN, ciLow:NaN, ciHigh:NaN, crit:NaN, stat:NaN, pval:NaN, dist:null };
  }

  // ---------- FIXED EFFECT ----------
  const wFE = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W = d3.sum(wFE);
  const FE = W > 0 ? d3.sum(studies.map((d,i)=>d.yi*wFE[i]))/W : NaN;
  const seFE = W > 0 ? Math.sqrt(1/W) : NaN;

  let Q = 0;
  for(let i=0;i<k;i++){ Q += wFE[i]*Math.pow(studies[i].yi - FE,2); }
  const dfQ = k-1;
  let I2 = 0;
  if(Q>dfQ && Q>0) I2 = ((Q-dfQ)/Q)*100;
  I2 = Math.max(0, Math.min(100,I2));

  let tau2 = 0;
	if (method === "REML") {
	  tau2 = tau2_REML(studies, 1e-12, 500);
	}
	else if (method === "PM") {
	  tau2 = tau2_PM(studies);
	}
	else { // DL fallback
		const sumW2 = d3.sum(wFE.map(w=>w*w));
		const C = W - (sumW2/W);
		tau2 = C>0 ? Math.max(0, (Q-dfQ)/C) : 0;
	}

  // ---------- RANDOM EFFECT ----------
  const wRE = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
  const WRE = d3.sum(wRE);
  const RE = WRE>0 ? d3.sum(studies.map((d,i)=>d.yi*wRE[i]))/WRE : NaN;
  let seRE = WRE>0 ? Math.sqrt(1/WRE) : NaN;

	let crit, stat, pval, dist;

	if (ciMethod === "KH" && k > 1) {
	  // --- Knapp-Hartung ---
	  const df = k - 1;

	  let sum = 0;
	  for (let i = 0; i < k; i++) {
		sum += wRE[i] * Math.pow(studies[i].yi - RE, 2);
	  }

	  const varKH = sum / (df * WRE);
	  seRE = Math.sqrt(Math.max(varKH, 0));

	  crit = tCritical(df);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

	} else if (ciMethod === "t" && k > 1) {
	  // --- t-distribution (no variance adjustment) ---
	  const df = k - 1;

	  crit = tCritical(df);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

	} else {
	  // --- Normal (Wald) ---
	  crit = 1.96;
	  stat = RE / seRE;
	  dist = "z";
	  pval = k <= 1 ? NaN : 2 * (1 - normalCDF(Math.abs(stat)));
	}

  const predVar = seRE*seRE + tau2;
  
  return {
    FE,
    seFE,
    RE,
    seRE,
    tau2,
    Q,
    df: dfQ,
    I2,
    predLow: RE - 1.96*Math.sqrt(predVar),
    predHigh: RE + 1.96*Math.sqrt(predVar),
    ciLow: RE - crit*seRE,
    ciHigh: RE + crit*seRE,
    crit,
    stat,
    pval,
    dist
  };
}

// ================= INPUT VALIDATION =================
export function validateStudy(study, type) {
  const errors = {};
  let valid = true;

  if (!type) return { valid: false, errors: { general: "Unknown effect type" } };

  if (type === "MD" || type === "SMD") {
    const n1 = study.n1, n2 = study.n2;
    const sd1 = study.sd1, sd2 = study.sd2;
    if (!isFinite(n1) || n1 < 2) { valid = false; errors.n1 = "n1 must be ≥ 2"; }
    if (!isFinite(n2) || n2 < 2) { valid = false; errors.n2 = "n2 must be ≥ 2"; }
    if (!isFinite(sd1) || sd1 <= 0) { valid = false; errors.sd1 = "sd1 must be > 0"; }
    if (!isFinite(sd2) || sd2 <= 0) { valid = false; errors.sd2 = "sd2 must be > 0"; }
    if (!isFinite(study.m1)) { valid = false; errors.m1 = "m1 must be numeric"; }
    if (!isFinite(study.m2)) { valid = false; errors.m2 = "m2 must be numeric"; }
  }
  else if (type === "OR" || type === "RR") {
    ["a","b","c","d"].forEach(k => {
      const v = study[k];
      if (!isFinite(v) || v < 0) { valid = false; errors[k] = `${k} must be ≥ 0`; }
    });
  }
  else if (type === "GENERIC") {
    if (!isFinite(study.yi)) { valid = false; errors.yi = "yi must be numeric"; }
    if (!isFinite(study.vi) || study.vi <= 0) { valid = false; errors.vi = "vi must be > 0"; }
  }
  else {
    valid = false;
    errors.general = "Unsupported effect type";
  }

  return { valid, errors };
}