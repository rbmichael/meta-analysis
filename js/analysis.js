import { tCritical, normalCDF, tCDF, chiSquareCDF, fCDF } from "./utils.js";

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

  // ================= CORRELATION =================
  if (type === "COR" || type === "ZCOR") {
    const { r, n } = s;

    if (!isFinite(r) || !isFinite(n) || Math.abs(r) >= 1 || n < 2)
      return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };

    if (type === "COR") {
      // Raw correlation: yi = r, vi = (1−r²)²/(n−1)
      const vi = Math.max((1 - r * r) ** 2 / (n - 1), MIN_VAR);
      return { ...s, yi: r, vi, se: Math.sqrt(vi), w: 1 / vi };
    }

    // ZCOR: Fisher's z-transform, vi = 1/(n−3)
    if (n < 4) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
    const yi = Math.atanh(r);           // 0.5 * ln((1+r)/(1−r))
    const vi = Math.max(1 / (n - 3), MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
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
// Compute I² using fixed-effect weights (1/vi), matching metafor convention.
// tau2 is unused but kept for API compatibility.
export function I2(corrected, tau2) {
  const k = corrected.length;
  if (k <= 1) return 0;
  const wFE = corrected.map(d => 1 / d.vi);
  const W = wFE.reduce((a, b) => a + b, 0);
  const mu = corrected.reduce((sum, d, i) => sum + wFE[i] * d.yi, 0) / W;
  const Q = corrected.reduce((sum, d, i) => sum + wFE[i] * (d.yi - mu) ** 2, 0);
  return Math.max(0, Math.min(100, ((Q - (k - 1)) / Q) * 100));
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
export function subgroupAnalysis(studies, method="REML", ciMethod="normal") {
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
  const seRE_base = WRE>0 ? Math.sqrt(1/WRE) : NaN;  // used for prediction interval
  let seRE = seRE_base;

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

  // Prediction interval: Higgins et al. (2009), t_{k-2} quantile.
  // Requires k >= 3 (df = k-2 >= 1). Uses base seRE, not KH-adjusted.
  const predVar = seRE_base * seRE_base + tau2;
  const predCrit = k >= 3 ? tCritical(k - 2) : NaN;

  return {
    FE,
    seFE,
    RE,
    seRE,
    tau2,
    Q,
    df: dfQ,
    I2,
    predLow:  isFinite(predCrit) ? RE - predCrit * Math.sqrt(predVar) : NaN,
    predHigh: isFinite(predCrit) ? RE + predCrit * Math.sqrt(predVar) : NaN,
    ciLow: RE - crit*seRE,
    ciHigh: RE + crit*seRE,
    crit,
    stat,
    pval,
    dist
  };
}

// ================= META-REGRESSION DESIGN MATRIX =================
// Builds the k×p design matrix X for meta-regression.
//
// moderators: array of { key: string, type: "continuous" | "categorical" }
//   key  — property name on each study object
//   type — "continuous" (read as number) or "categorical" (dummy-coded)
//
// Returns:
//   X         — k×p row-major matrix (array of k rows, each a p-length array)
//   colNames  — p column labels; first is always "intercept"
//   refLevels — maps each categorical key to its (dropped) reference level
//   validMask — k booleans; true when all entries in that row are finite
//   k, p      — matrix dimensions
export function buildDesignMatrix(studies, moderators = []) {
  const k = studies.length;

  // Build column-by-column, then transpose to row-major at the end.
  const columns  = [Array(k).fill(1)];  // intercept
  const colNames = ["intercept"];
  const refLevels = {};

  for (const { key, type } of moderators) {
    const raw = studies.map(s => s[key]);

    if (type === "categorical") {
      // Unique non-null levels, sorted so the reference is deterministic.
      const levels = [...new Set(raw.filter(v => v != null && v !== ""))].sort();
      if (levels.length < 2) continue;  // degenerate — nothing to dummy-code

      refLevels[key] = levels[0];

      for (const level of levels.slice(1)) {
        // Missing values become NaN so validMask catches them.
        columns.push(raw.map(v => (v == null || v === "") ? NaN : (v === level ? 1 : 0)));
        colNames.push(`${key}:${level}`);
      }

    } else {
      // Continuous: coerce to number; non-numeric (including undefined) → NaN.
      columns.push(raw.map(v => +v));
      colNames.push(key);
    }
  }

  const p = columns.length;

  // Transpose: X[i][j] = study i, column j.
  const X = Array.from({ length: k }, (_, i) => columns.map(col => col[i]));

  // A row is valid only when every entry is finite (no NaN / ±Infinity).
  const validMask = X.map(row => row.every(isFinite));

  return { X, colNames, refLevels, validMask, k, p };
}

// ================= WEIGHTED LEAST SQUARES =================
// Fits y = X·beta by WLS with weights w = 1/(vi + tau²).
// Called at every tau² iteration inside metaRegression, so kept lean.
//
// X    — k×p row-major design matrix (from buildDesignMatrix)
// y    — k-length array of effect sizes
// w    — k-length array of weights
//
// Returns:
//   beta          — p-length coefficient vector
//   vcov          — p×p variance-covariance matrix = (X'WX)⁻¹
//   rankDeficient — true when X'WX is singular (results are NaN-filled)
export function wls(X, y, w) {
  const k = X.length;
  const p = X[0].length;

  // --- X'WX (p×p, symmetric) and X'Wy (p-vector) ---
  const XtWX = Array.from({ length: p }, () => Array(p).fill(0));
  const XtWy = Array(p).fill(0);

  for (let i = 0; i < k; i++) {
    const wi = w[i];
    for (let j = 0; j < p; j++) {
      XtWy[j] += wi * X[i][j] * y[i];
      for (let l = j; l < p; l++) {            // exploit symmetry
        const v = wi * X[i][j] * X[i][l];
        XtWX[j][l] += v;
        if (l !== j) XtWX[l][j] += v;
      }
    }
  }

  // --- Invert X'WX ---
  const inv = matInverse(XtWX);
  if (inv === null) {
    return {
      beta: Array(p).fill(NaN),
      vcov: Array.from({ length: p }, () => Array(p).fill(NaN)),
      rankDeficient: true
    };
  }

  // --- beta = (X'WX)⁻¹ · X'Wy ---
  const beta = inv.map(row => row.reduce((s, v, j) => s + v * XtWy[j], 0));

  return { beta, vcov: inv, rankDeficient: false };
}

// Gauss-Jordan elimination with partial pivoting.
// Returns the inverse of the p×p matrix A, or null if singular.
// Not exported — used only by wls.
function matInverse(A) {
  const p = A.length;

  // Augment A with the identity: M = [A | I]
  const M = A.map((row, i) => {
    const aug = row.slice();
    for (let j = 0; j < p; j++) aug.push(i === j ? 1 : 0);
    return aug;
  });

  for (let col = 0; col < p; col++) {
    // Partial pivoting: swap in the row with the largest absolute value
    let pivotRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-14) return null;   // singular or near-singular

    // Scale the pivot row so the leading entry becomes 1
    for (let j = col; j < 2 * p; j++) M[col][j] /= pivot;

    // Zero out every other row in this column
    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const f = M[row][col];
      if (f === 0) continue;
      for (let j = col; j < 2 * p; j++) M[row][j] -= f * M[col][j];
    }
  }

  // The right half of M is now A⁻¹
  return M.map(row => row.slice(p));
}

// ================= TAU² FOR META-REGRESSION =================

function dot(a, b) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function quadForm(A, x) {
  return dot(x, A.map(row => dot(row, x)));
}

function tau2Reg_DL(yi, vi, X) {
  const k = vi.length, p = X[0].length;
  const df = k - p;
  if (df <= 0) return 0;
  const w0 = vi.map(v => 1 / v);
  const { beta, vcov, rankDeficient } = wls(X, yi, w0);
  if (rankDeficient) return 0;
  const QE = yi.reduce((s, y, i) => {
    const e = y - dot(X[i], beta);
    return s + w0[i] * e * e;
  }, 0);
  const c = w0.reduce((s, wi, i) => s + wi * (1 - wi * quadForm(vcov, X[i])), 0);
  return c > 0 ? Math.max(0, (QE - df) / c) : 0;
}

function tau2Reg_REML(yi, vi, X, tol = 1e-10, maxIter = 100) {
  const k = vi.length, p = X[0].length;
  if (k - p <= 0) return 0;
  let tau2 = tau2Reg_DL(yi, vi, X);
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, vcov, rankDeficient } = wls(X, yi, w);
    if (rankDeficient) break;
    const h = X.map((xi, i) => w[i] * quadForm(vcov, xi));
    const e = yi.map((y, i) => y - dot(X[i], beta));
    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const pi = w[i] * (1 - h[i]);
      score += w[i] * w[i] * e[i] * e[i] - pi;
      info  += w[i] * pi;
    }
    if (info <= 0) break;
    let step = score / info;
    let newTau2 = tau2 + step;
    let sh = 0;
    while (newTau2 < 0 && sh++ < 20) { step /= 2; newTau2 = tau2 + step; }
    newTau2 = Math.max(0, newTau2);
    if (Math.abs(newTau2 - tau2) < tol) { tau2 = newTau2; break; }
    tau2 = newTau2;
  }
  return tau2;
}

function tau2Reg_PM(yi, vi, X, tol = 1e-10, maxIter = 100) {
  const k = vi.length, p = X[0].length;
  const df = k - p;
  if (df <= 0) return 0;
  let tau2 = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, rankDeficient } = wls(X, yi, w);
    if (rankDeficient) break;
    const QE = yi.reduce((s, y, i) => {
      const e = y - dot(X[i], beta);
      return s + w[i] * e * e;
    }, 0);
    const sumW = w.reduce((a, b) => a + b, 0);
    const newTau2 = Math.max(0, tau2 + (QE - df) / sumW);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }
  return tau2;
}

export function tau2_metaReg(yi, vi, X, method = "REML", tol = 1e-10, maxIter = 100) {
  if (method === "REML") return tau2Reg_REML(yi, vi, X, tol, maxIter);
  if (method === "PM")   return tau2Reg_PM  (yi, vi, X, tol, maxIter);
  return tau2Reg_DL(yi, vi, X);
}

// ================= META-REGRESSION =================
// Fits a weighted mixed-effects meta-regression model.
//
// Parameters:
//   studies    — array of study objects, each with { yi, vi, ... }
//   moderators — array of { key, type } passed to buildDesignMatrix
//   method     — tau² estimator: "REML" (default), "DL", "PM"
//   ciMethod   — "normal" (default) or "KH" (Knapp-Hartung)
//
// Returns:
//   beta       — p-vector of coefficients
//   se         — p-vector of standard errors
//   zval/tval  — test statistics (z for normal, t for KH)
//   pval       — two-tailed p-values
//   ci         — [ [lo,hi], ... ] per coefficient
//   tau2       — estimated between-study variance
//   QE         — residual heterogeneity statistic
//   QEdf       — df for QE (k − p)
//   QEp        — p-value for QE (chi-squared)
//   QM         — omnibus test for moderators (Wald chi-sq or F)
//   QMdf       — df for QM (p − 1, i.e. excluding intercept)
//   QMp        — p-value for QM
//   I2         — residual I² (%)
//   colNames   — column names matching beta
//   k          — number of studies used
//   p          — number of parameters
//   rankDeficient — true if design matrix was singular
export function metaRegression(studies, moderators = [], method = "REML", ciMethod = "normal") {
  // Filter to studies with finite yi and vi
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;

  const { X, colNames, validMask, p } = buildDesignMatrix(valid, moderators);

  // Further filter rows where all moderator values are finite
  const rows   = valid.filter((_, i) => validMask[i]);
  const Xf     = X.filter((_, i) => validMask[i]);
  const kf     = rows.length;
  const yi     = rows.map(s => s.yi);
  const vi     = rows.map(s => s.vi);

  const empty = {
    beta: Array(p).fill(NaN), se: Array(p).fill(NaN),
    zval: Array(p).fill(NaN), pval: Array(p).fill(NaN),
    ci: Array(p).fill([NaN, NaN]),
    tau2: NaN, QE: NaN, QEdf: kf - p, QEp: NaN,
    QM: NaN, QMdf: p - 1, QMp: NaN, I2: NaN,
    colNames, k: kf, p, rankDeficient: true
  };

  if (kf < p + 1) return empty;

  // ---- tau² ----
  const tau2 = tau2_metaReg(yi, vi, Xf, method);

  // ---- pseudo-R² (proportion of heterogeneity explained by moderators) ----
  // Only meaningful when there are actual moderators (p > 1).
  const X0   = Xf.map(() => [1]);  // intercept-only design matrix
  const tau2_0 = p > 1 ? tau2_metaReg(yi, vi, X0, method) : tau2;
  const R2 = p > 1 && tau2_0 > 0 ? Math.max(0, (tau2_0 - tau2) / tau2_0) : NaN;

  // ---- WLS with RE weights ----
  const w = vi.map(v => 1 / (v + tau2));
  const { beta, vcov, rankDeficient } = wls(Xf, yi, w);
  if (rankDeficient) return { ...empty, rankDeficient: true };

  // ---- residuals and QE ----
  const e   = yi.map((y, i) => y - dot(Xf[i], beta));
  const QE  = e.reduce((s, ei, i) => s + w[i] * ei * ei, 0);
  const QEdf = kf - p;
  const QEp  = QEdf > 0 ? 1 - chiSquareCDF(QE, QEdf) : NaN;

  // ---- I² (residual) ----
  // Use tau2/(tau2 + typical_vi) so I² is consistent with tau2 (avoids I²=0
  // when tau2>0, which happens with REML when QE≤QEdf).
  // typical_vi = QEdf/c where c = Σw0ᵢ(1−hᵢ) is the FE-leverage-adjusted
  // denominator (same as used in the DL estimator for regression).
  const w0 = vi.map(v => 1 / v);
  const { vcov: vcov0, rankDeficient: rd0 } = wls(Xf, yi, w0);
  let I2 = 0;
  if (!rd0 && QEdf > 0) {
    const c = w0.reduce((s, wi, i) => s + wi * (1 - wi * quadForm(vcov0, Xf[i])), 0);
    if (c > 0) I2 = Math.max(0, tau2 / (tau2 + QEdf / c) * 100);
  }

  // ---- SE and CIs for beta ----
  // s2: KH variance inflation factor (Knapp & Hartung 2003, eq. 8)
  const useKH = ciMethod === "KH" && kf > p && QEdf > 0;
  const s2 = useKH ? Math.max(1, QE / QEdf) : 1;

  let se, crit, zval, pval, ci, dist;

  if (useKH) {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j]) * s2));
    crit  = tCritical(QEdf);
    dist  = "t";
    zval  = beta.map((b, j) => b / se[j]);
    pval  = zval.map(t => 2 * (1 - tCDF(Math.abs(t), QEdf)));
    ci    = beta.map((b, j) => [b - crit * se[j], b + crit * se[j]]);
  } else {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j])));
    crit  = 1.96;
    dist  = "z";
    zval  = beta.map((b, j) => b / se[j]);
    pval  = zval.map(z => 2 * (1 - normalCDF(Math.abs(z))));
    ci    = beta.map((b, j) => [b - crit * se[j], b + crit * se[j]]);
  }

  // ---- Omnibus test for moderators (QM) ----
  // Normal: Wald chi-sq on beta[1..p-1] with p-1 df.
  // KH:     F = QM_chi / (s2 * (p-1))  with F(p-1, k-p) distribution.
  let QM = NaN, QMdf = p - 1, QMp = NaN;
  if (p > 1) {
    const idx = Array.from({ length: p - 1 }, (_, i) => i + 1);
    const betaMod = idx.map(j => beta[j]);
    const vcovMod = idx.map(r => idx.map(c => vcov[r][c]));
    const invMod  = matInverse(vcovMod);
    if (invMod !== null) {
      const QMchi = betaMod.reduce((s, bi, r) =>
        s + bi * invMod[r].reduce((ss, v, c) => ss + v * betaMod[c], 0), 0);
      if (useKH) {
        QM  = QMchi / (s2 * QMdf);   // F-statistic
        QMp = 1 - fCDF(QM, QMdf, QEdf);
      } else {
        QM  = QMchi;                   // chi-sq statistic
        QMp = 1 - chiSquareCDF(QM, QMdf);
      }
    }
  }

  const fitted      = Xf.map(xi => dot(xi, beta));
  const stdResiduals = e.map((ei, i) => ei / Math.sqrt(vi[i] + tau2));

  return {
    beta, se, zval, pval, ci, vcov, crit, s2,
    tau2, tau2_0, R2,
    QE, QEdf, QEp,
    QM, QMdf, QMp, QMdist: useKH ? "F" : "chi2",
    I2, colNames, k: kf, p, rankDeficient: false, dist,
    fitted, residuals: e, stdResiduals,
    labels: rows.map(s => s.label || ""),
    studiesUsed: rows,   // exact set used in the fit (for bubble plot)
    yi, vi    // pass through for display
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
  else if (type === "OR" || type === "RR" || type === "RD") {
    ["a","b","c","d"].forEach(k => {
      const v = study[k];
      if (!isFinite(v) || v < 0) { valid = false; errors[k] = `${k} must be ≥ 0`; }
    });
  }
  else if (type === "MD_paired" || type === "SMD_paired") {
    if (!isFinite(study.m_pre))              { valid = false; errors.m_pre  = "m_pre must be numeric"; }
    if (!isFinite(study.m_post))             { valid = false; errors.m_post = "m_post must be numeric"; }
    if (!isFinite(study.sd_pre)  || study.sd_pre  <= 0) { valid = false; errors.sd_pre  = "sd_pre must be > 0"; }
    if (!isFinite(study.sd_post) || study.sd_post <= 0) { valid = false; errors.sd_post = "sd_post must be > 0"; }
    if (!isFinite(study.n) || study.n < 2)  { valid = false; errors.n = "n must be ≥ 2"; }
    if (isFinite(study.r) && (study.r < -1 || study.r > 1)) { valid = false; errors.r = "r must be between -1 and 1"; }
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