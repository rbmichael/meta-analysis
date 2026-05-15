// =============================================================================
// pubbias.js — Publication bias tests and corrections
// =============================================================================
// Extracted from analysis.js.  analysis.js re-exports everything via:
//   export * from "./pubbias.js";
//
// Exports
// -------
//   eggerTest(studies)
//   beggTest(studies)
//   fatPetTest(studies)
//   petPeeseTest(studies)
//   harbordTest(studies)
//   petersTest(studies)
//   deeksTest(studies)
//   rueckerTest(studies)
//   failSafeN(studies, alpha, trivial)
//   henmiCopas(studies, alpha)
//   tesTest(studies, m)
//   waapWls(studies)
//
// Dependencies
// ------------
//   analysis.js  wls(), robustWlsResult()  [circular — safe]
//   utils.js     normalCDF, normalQuantile, tCDF, regularizedGammaP
//   constants.js BISECTION_ITERS

import { robustWlsResult, validStudies } from "./analysis.js";
import { wls } from "./linalg.js";
import { normalCDF, normalQuantile, tCDF, regularizedGammaP } from "./utils.js";
import { BISECTION_ITERS } from "./constants.js";

// ================= EGGER TEST =================
export function eggerTest(studies){
  const k = studies.length;
  if(k < 3) return { intercept: NaN, slope: NaN, se: NaN, t: NaN, df: NaN, p: NaN };
  const Z = studies.map(d => d.yi / d.se);
  const X = studies.map(d => 1 / d.se);
  const meanX = X.reduce((acc, b) => acc + b, 0)/X.length, meanZ = Z.reduce((acc, b) => acc + b, 0)/Z.length;
  let num=0, den=0;
  for(let i=0;i<k;i++){ num += (X[i]-meanX)*(Z[i]-meanZ); den += (X[i]-meanX)**2; }
  const slope = num/den;
  const intercept = meanZ - slope*meanX;
  let rss=0;
  for(let i=0;i<k;i++){ rss += (Z[i] - (intercept + slope*X[i]))**2; }
  const df = k-2;
  const se = Math.sqrt(rss/df) * Math.sqrt(1/k + (meanX*meanX)/den);
  const t = intercept/se;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  const result = { intercept, slope, se, t, df, p };

  // Cluster-robust extension: reads study.cluster (set by ui.js)
  const clusters = studies.map(s => s.cluster?.trim() || null);
  if (clusters.some(id => id)) {
    const X2d = studies.map((_, i) => [1, X[i]]);
    const wUnit = Array(k).fill(1);
    const rob = robustWlsResult(X2d, wUnit, Z, [intercept, slope], clusters);
    if (!rob.error) {
      result.robustInterceptSE = rob.robustSE[0];
      result.robustInterceptZ  = rob.robustZ[0];
      result.robustInterceptP  = rob.robustP[0];
      result.robustSlopeSE     = rob.robustSE[1];
      result.robustSlopeZ      = rob.robustZ[1];
      result.robustSlopeP      = rob.robustP[1];
      result.robustDf          = rob.df;
      result.clustersUsed      = rob.C;
      result.allSingletons     = rob.allSingletons;
    } else {
      result.robustError = rob.error;
    }
  }
  return result;
}

// ================= BEGG'S RANK CORRELATION TEST =================
// Kendall's τ between standardised effect (yᵢ − FE) and variance vᵢ.
// Begg & Mazumdar (1994). Tests funnel asymmetry non-parametrically.
//
// Returns: { tau, S, z, p }
//   tau — Kendall's τ_b (normalised S)
//   S   — raw concordance statistic
//   z   — continuity-corrected normal z
//   p   — two-tailed p-value
export function beggTest(studies) {
  const valid = validStudies(studies);
  const k = valid.length;
  if (k < 3) return { tau: NaN, S: NaN, z: NaN, p: NaN };

  // Rank on raw yi. Begg & Mazumdar (1994, eq. 2) suggest FE-centering, but
  // any common offset cancels in every pairwise sign(adjᵢ − adjⱼ), so
  // adj[i] = yi[i] is equivalent and requires no weight computation.
  const adj = valid.map(s => s.yi);

  // Kendall S = Σ_{i<j} sign(adj_i − adj_j) · sign(vi_i − vi_j)
  let S = 0;
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      S += Math.sign(adj[i] - adj[j]) * Math.sign(valid[i].vi - valid[j].vi);
    }
  }

  // Variance of S under H₀ with Kendall-Gibbons tie correction
  // (Kendall & Gibbons 1990 §3.3).
  // Var(S) = [k(k−1)(2k+5) − tieTermX − tieTermY] / 18
  // where tieTermZ = Σ t(t−1)(2t+5) over tie groups of size t in Z.
  const tieStats = vals => {
    const counts = new Map();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    let varTerm = 0, pairs = 0;
    for (const t of counts.values()) {
      if (t > 1) { varTerm += t * (t - 1) * (2 * t + 5); pairs += t * (t - 1) / 2; }
    }
    return { varTerm, pairs };
  };
  const tsX  = tieStats(adj);
  const tsY  = tieStats(valid.map(s => s.vi));
  const varS = (k * (k - 1) * (2 * k + 5) - tsX.varTerm - tsY.varTerm) / 18;

  // Continuity-corrected z; guard degenerate varS (all values tied)
  const z = (S === 0 || varS <= 0) ? 0 : (Math.abs(S) - 1) / Math.sqrt(varS) * Math.sign(S);
  const p = 2 * (1 - normalCDF(Math.abs(z)));

  // Kendall τ_b with tie-corrected denominator
  const p0    = k * (k - 1) / 2;
  const denom = Math.sqrt((p0 - tsX.pairs) * (p0 - tsY.pairs));
  const tau   = denom > 0 ? S / denom : 0;

  return { tau, S, z, p };
}

// ================= SHARED WLS HELPERS (pub-bias tests) =================
// Used by fatPetTest, harbordTest, petersTest, deeksTest, rueckerTest.

// NaN result object for when a pub-bias regression cannot be computed.
function _pubBiasNaN(df) {
  return {
    intercept: NaN, interceptSE: NaN, interceptT: NaN, interceptP: NaN,
    slope:     NaN, slopeSE:     NaN, slopeT:     NaN, slopeP:     NaN,
    df
  };
}

// Compute RSS, s², SE/t/p for intercept and slope from WLS output.
// ys, xs, ws must be parallel arrays of length k; df = k − 2.
function _wlsFinish(beta, vcov, ys, xs, ws, df) {
  let rss = 0;
  for (let i = 0; i < ys.length; i++) {
    const e = ys[i] - beta[0] - beta[1] * xs[i];
    rss += ws[i] * e * e;
  }
  const s2          = df > 0 ? rss / df : NaN;
  const interceptSE = Math.sqrt(s2 * vcov[0][0]);
  const slopeSE     = Math.sqrt(s2 * vcov[1][1]);
  const interceptT  = beta[0] / interceptSE;
  const slopeT      = beta[1] / slopeSE;
  const interceptP  = 2 * (1 - tCDF(Math.abs(interceptT), df));
  const slopeP      = 2 * (1 - tCDF(Math.abs(slopeT),     df));
  return {
    intercept: beta[0], interceptSE, interceptT, interceptP,
    slope:     beta[1], slopeSE,     slopeT,     slopeP,
    df
  };
}

// ================= FAT-PET =================
// Precision-Effect Test / Funnel Asymmetry Test (Stanley & Doucouliagos 2014).
// WLS regression of yᵢ on SEᵢ with weights wᵢ = 1/vᵢ:
//   yᵢ = β₀ + β₁·SEᵢ + εᵢ
//
// FAT: H₀: β₁ = 0  (no funnel asymmetry / no publication bias)
// PET: β₀ = effect estimate purged of bias (effect at SE → 0)
//
// Returns: { intercept, interceptSE, interceptT, interceptP,
//            slope,     slopeSE,     slopeT,     slopeP,     df }
export function fatPetTest(studies) {
  const valid = validStudies(studies);
  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = valid.map(s => s.yi);
  const xs = valid.map(s => s.se ?? Math.sqrt(s.vi));
  const ws = valid.map(s => 1 / s.vi);

  const X = xs.map(x => [1, x]);
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  const result = _wlsFinish(beta, vcov, ys, xs, ws, k - 2);

  // Cluster-robust extension: reads study.cluster (set by ui.js)
  const clusters = valid.map(s => s.cluster?.trim() || null);
  if (clusters.some(id => id)) {
    const rob = robustWlsResult(X, ws, ys, beta, clusters);
    if (!rob.error) {
      result.robustInterceptSE = rob.robustSE[0];
      result.robustInterceptZ  = rob.robustZ[0];
      result.robustInterceptP  = rob.robustP[0];
      result.robustSlopeSE     = rob.robustSE[1];
      result.robustSlopeZ      = rob.robustZ[1];
      result.robustSlopeP      = rob.robustP[1];
      result.robustDf          = rob.df;
      result.clustersUsed      = rob.C;
      result.allSingletons     = rob.allSingletons;
    } else {
      result.robustError = rob.error;
    }
  }
  return result;
}

// ================= PET-PEESE =================
// Two-stage pub-bias correction (Stanley & Doucouliagos 2014, J Econ Surveys 28:103-121;
// Stanley 2008, Oxford Bull Econ Stat 70:103-127).
//
// Stage 1 — FAT-PET (same WLS as fatPetTest):
//   yᵢ = β₀ + β₁·SEᵢ + εᵢ,  wᵢ = 1/vᵢ
//   If β₁ is significant (interceptP < 0.10) → evidence of bias → use PEESE.
//
// Stage 2 — PEESE (Precision-Effect Estimate with Standard Error):
//   yᵢ = γ₀ + γ₁·vᵢ  + εᵢ,  wᵢ = 1/vᵢ
//   γ₀ is the bias-corrected effect estimate (effect as vᵢ → 0).
//
// usePeese = (fat.interceptP < 0.10)
//
// Returns: { fat, peese, usePeese }
//   fat/peese each have the same shape as _wlsFinish output.
export function petPeeseTest(studies) {
  const fat = fatPetTest(studies);
  const valid = validStudies(studies);
  const k = valid.length;
  let peese = _pubBiasNaN(k - 2);
  if (k >= 3 && !isNaN(fat.intercept)) {
    const ys = valid.map(s => s.yi);
    const xs = valid.map(s => s.vi);           // predictor is vᵢ, not SEᵢ
    const ws = valid.map(s => 1 / s.vi);
    const X  = xs.map(x => [1, x]);
    const { beta, vcov, rankDeficient } = wls(X, ys, ws);
    if (!rankDeficient) peese = _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
  }
  const usePeese = isFinite(fat.interceptP) && fat.interceptP < 0.10;
  return { fat, peese, usePeese };
}

// ================= HARBORD TEST =================
// Harbord et al. (2006, Stat Med 25:3443-3457): modified Egger test for OR
// studies that avoids the artefactual correlation between log(OR) and its SE.
//
// For each 2×2 table (a,b,c,d), N = a+b+c+d:
//   E_i   = (a+b)(a+c)/N               (expected events under H₀)
//   V_i   = (a+b)(c+d)(a+c)(b+d) / (N²(N−1))   (hypergeometric variance)
//   z_i   = (a − E_i) / √V_i           (standardized score)
//
// OLS regression of z_i on √V_i; test H₀: intercept = 0.
// Studies with V_i ≤ 0 (zero marginal or N < 2) are skipped.
export function harbordTest(studies) {
  const valid = studies.filter(s => {
    const { a, b, c, d } = s;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false;
    if (a < 0 || b < 0 || c < 0 || d < 0) return false;
    const N = a + b + c + d;
    if (N < 2) return false;
    const V = (a+b) * (c+d) * (a+c) * (b+d) / (N * N * (N - 1));
    return V > 0;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = [], xs = [];
  for (const s of valid) {
    const { a, b, c, d } = s;
    const N     = a + b + c + d;
    const E     = (a + b) * (a + c) / N;
    const V     = (a + b) * (c + d) * (a + c) * (b + d) / (N * N * (N - 1));
    const sqrtV = Math.sqrt(V);
    ys.push((a - E) / sqrtV);
    xs.push(sqrtV);
  }

  const X  = xs.map(x => [1, x]);
  const ws = xs.map(() => 1);   // OLS — uniform weights
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= PETERS TEST =================
// Peters et al. (2006, JAMA 295:676-680): WLS regression of yi on 1/N.
// Uses inverse-variance weights (same as the meta-analysis model), which
// avoids the Egger test's artefactual SE/yi correlation for binary outcomes.
//
// N is extracted in priority order: a+b+c+d → n1+n2 → n.
// Studies where N cannot be determined or N < 2 are skipped.
export function petersTest(studies) {
  // Resolve total N from whatever count fields are present
  function getN(s) {
    if (isFinite(s.a) && isFinite(s.b) && isFinite(s.c) && isFinite(s.d))
      return s.a + s.b + s.c + s.d;
    if (isFinite(s.n1) && isFinite(s.n2))
      return s.n1 + s.n2;
    if (isFinite(s.n))
      return s.n;
    return NaN;
  }

  const valid = studies.filter(s => {
    if (!isFinite(s.yi) || !isFinite(s.vi) || s.vi <= 0) return false;
    const N = getN(s);
    return isFinite(N) && N >= 2;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = valid.map(s => s.yi);
  const xs = valid.map(s => 1 / getN(s));
  const ws = valid.map(s => 1 / s.vi);

  const X = xs.map(x => [1, x]);
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= DEEKS TEST =================
// Deeks et al. (2005, J Clin Epidemiol 58:882-893): funnel-plot asymmetry
// test for meta-analyses of diagnostic test accuracy (DOR studies).
//
// For each 2×2 table (a,b,c,d), N = a+b+c+d:
//   ESS_i = 2(a+c)(b+d)/N   (effective sample size: harmonic mean of row totals × 2)
//   DOR_i = (a·d)/(b·c)     (diagnostic odds ratio)
//
// WLS regression of log(DOR_i) on 1/√ESS_i with weights ESS_i;
// test H₀: intercept = 0.
// Studies with any zero cell (log DOR undefined) or ESS ≤ 0 are skipped.
export function deeksTest(studies) {
  const valid = studies.filter(s => {
    const { a, b, c, d } = s;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false;
    if (a <= 0 || b <= 0 || c <= 0 || d <= 0) return false;   // log DOR requires all > 0
    const N = a + b + c + d;
    const ESS = 2 * (a + c) * (b + d) / N;
    return ESS > 0;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = [], xs = [], ws = [];
  for (const s of valid) {
    const { a, b, c, d } = s;
    const N   = a + b + c + d;
    const ESS = 2 * (a + c) * (b + d) / N;
    ys.push(Math.log((a * d) / (b * c)));
    xs.push(1 / Math.sqrt(ESS));
    ws.push(ESS);
  }

  const X = xs.map(x => [1, x]);
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= RÜCKER TEST =================
// Rücker et al. (2008, Stat Med 27:4450-4465): arcsine-based Egger test for
// binary outcomes. Applies the variance-stabilising arcsine transformation so
// that the effect size and its precision are less correlated than for log-OR,
// reducing the artefactual bias inflated type-I error of the standard Egger test.
//
// For each 2×2 table (a,b,c,d):
//   n1 = a+b,  n2 = c+d
//   p1 = a/n1, p2 = c/n2
//   y_i  = asin(√p1) − asin(√p2)          (arcsine risk difference)
//   se_i = √(1/(4n1) + 1/(4n2))
//   z_i  = y_i / se_i                      (standardised statistic)
//
// OLS regression (weights = 1) of z_i on 1/se_i (precision);
// test H₀: intercept = 0.
// Studies with n1 = 0 or n2 = 0 are skipped (se undefined).
export function rueckerTest(studies) {
  const valid = studies.filter(s => {
    const { a, b, c, d } = s;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false;
    if (a < 0 || b < 0 || c < 0 || d < 0) return false;
    return (a + b) > 0 && (c + d) > 0;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = [], xs = [];
  for (const s of valid) {
    const { a, b, c, d } = s;
    const n1  = a + b;
    const n2  = c + d;
    const p1  = a / n1;
    const p2  = c / n2;
    const se  = Math.sqrt(1 / (4 * n1) + 1 / (4 * n2));
    const y   = Math.asin(Math.sqrt(p1)) - Math.asin(Math.sqrt(p2));
    ys.push(y / se);
    xs.push(1 / se);
  }

  const X  = xs.map(x => [1, x]);
  const ws = xs.map(() => 1);   // OLS — uniform weights
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= FAIL-SAFE N =================
// Rosenthal's (1979) file-drawer number: how many null studies (effect = 0)
// would be needed to push the combined p-value above alpha.
//
//   Nfs = (Σzᵢ / z_α)² − k   where zᵢ = Φ⁻¹(1 − pᵢ/2)  ≥ 0
//
// Also computes Orwin's (1983) fail-safe N: studies needed to bring the
// pooled RE below a trivial threshold |effect_trivial|.
//
//   N_orwin = k · (|RE| − |trivial|) / |trivial|   (clamped to 0)
//
// Returns: { rosenthal, orwin, sumZ, z_crit, k }
export function failSafeN(studies, alpha = 0.05, trivial = 0.1) {
  const valid = validStudies(studies);
  const k = valid.length;
  if (k < 1) return { rosenthal: NaN, orwin: NaN, sumZ: NaN, z_crit: NaN, k: 0 };

  // One-sided z for each study: z = |yi| / se  (using study-level statistic)
  const sumZ = valid.reduce((acc, d) => {
    const z = Math.abs(d.yi) / Math.sqrt(d.vi);
    return acc + z;
  }, 0);

  // Critical z for the chosen alpha (two-tailed → one-sided z_α/2... but
  // Rosenthal uses one-tailed z_α; for α=0.05, z_crit = 1.6449)
  // We derive it by inversion: z such that normalCDF(z) = 1 − alpha
  const z_crit = (() => {
    const target = 1 - alpha;
    let lo = 0, hi = 10;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      normalCDF(mid) < target ? lo = mid : hi = mid;
    }
    return (lo + hi) / 2;
  })();

  const rosenthal = Math.max(0, (sumZ / z_crit) ** 2 - k);

  // Orwin: uses FE pooled estimate (Orwin 1983 predates RE meta-analysis)
  const w0 = valid.map(s => 1 / s.vi);
  const W  = w0.reduce((acc, b) => acc + b, 0);
  const FE = valid.reduce((acc, d, i) => acc + w0[i] * d.yi, 0) / W;
  const orwin = Math.max(0, k * (Math.abs(FE) - Math.abs(trivial)) / Math.abs(trivial));

  return { rosenthal, orwin, sumZ, z_crit, k };
}

// ================= HENMI-COPAS METHOD =================
/**
 * Henmi & Copas (2010) confidence interval robust to publication bias.
 *
 * Always uses DL τ² and FE weights (wi = 1/vi), matching metafor::hc().
 * The CI is centred on the FE estimate but accounts for potential small-study
 * bias by integrating over the conditional distribution of Q given the
 * ratio R = (theta_hat - mu) / sqrt(vb).
 *
 * Algorithm: Henmi M & Copas JB (2010). Confidence intervals for random
 *   effects meta-analysis and robustness to publication bias.
 *   Statistics in Medicine, 29(29), 2969–2983.
 *
 * Ported from metafor::hc.rma.uni (original code by Henmi & Copas,
 * modified by Michael Dewey).
 *
 * Returns: { beta, se, ci, tau2, t0, u0, k } or { error }
 */
export function henmiCopas(studies, alpha = 0.05) {
  const valid = validStudies(studies);
  const k = valid.length;
  if (k < 3) return { error: "k < 3" };

  const yi = valid.map(s => s.yi);
  const vi = valid.map(s => s.vi);

  // FE weights (NOT RE weights — metafor hc() uses wi = 1/vi)
  const wi = vi.map(v => 1 / v);
  const W1 = wi.reduce((s, w) => s + w, 0);
  const W2 = wi.reduce((s, w) => s + w * w, 0) / W1;
  const W3 = wi.reduce((s, w) => s + w * w * w, 0) / W1;
  const W4 = wi.reduce((s, w) => s + w * w * w * w, 0) / W1;

  // FE estimate and Q statistic
  const beta = yi.reduce((s, y, i) => s + wi[i] * y, 0) / W1;
  const Q    = yi.reduce((s, y, i) => s + wi[i] * (y - beta) ** 2, 0);

  // DL τ² (always DL in HC, matching metafor)
  const tau2 = Math.max(0, (Q - (k - 1)) / (W1 - W2));

  // Variance of beta under RE model
  const vb  = (tau2 * W2 + 1) / W1;
  const se  = Math.sqrt(vb);

  // Variance/SD of ratio R
  const VR  = 1 + tau2 * W2;
  const SDR = Math.sqrt(VR);

  // Conditional mean of Q given R = r
  const EQ = r =>
    (k - 1) + tau2 * (W1 - W2) +
    tau2 ** 2 * ((1 / VR ** 2) * r * r - 1 / VR) * (W3 - W2 ** 2);

  // Conditional variance of Q given R = r
  const VQ = r => {
    const rsq      = r * r;
    const recipvr2 = 1 / VR ** 2;
    return (
      2 * (k - 1) +
      4 * tau2 * (W1 - W2) +
      2 * tau2 ** 2 * (W1 * W2 - 2 * W3 + W2 ** 2) +
      4 * tau2 ** 2 * (recipvr2 * rsq - 1 / VR) * (W3 - W2 ** 2) +
      4 * tau2 ** 3 * (recipvr2 * rsq - 1 / VR) * (W4 - 2 * W2 * W3 + W2 ** 3) +
      2 * tau2 ** 4 * (recipvr2 - 2 * (1 / VR ** 3) * rsq) * (W3 - W2 ** 2) ** 2
    );
  };

  // Gamma distribution params (shape/scale) as functions of r
  const shapeF = r => { const eq = EQ(r); const vq = VQ(r); return vq > 0 ? eq * eq / vq : NaN; };
  const scaleF = r => { const eq = EQ(r); const vq = VQ(r); return eq > 0 ? vq / eq : NaN; };

  // finv(f) = (W1/W2 − 1)·(f² − 1) + (k − 1)
  const finv = f => (W1 / W2 - 1) * (f * f - 1) + (k - 1);

  // pgamma(q, shape, scale) = regularizedGammaP(shape, q/scale)
  const pgamma = (q, shape, scale) => {
    if (!isFinite(q) || !isFinite(shape) || !isFinite(scale) || shape <= 0 || scale <= 0) {
      return q <= 0 ? 0 : 1;
    }
    if (q <= 0) return 0;
    return regularizedGammaP(shape, q / scale);
  };

  const SQRT2PI = Math.sqrt(2 * Math.PI);
  const dnorm   = x => Math.exp(-0.5 * x * x) / SQRT2PI;

  // Numerical integration ∫ₓ^∞ pgamma(finv(r/x), shape(SDR·r), scale(SDR·r))·φ(r) dr
  // via composite Simpson's rule (N=400 panels). dnorm decays to ~0 by r≈7,
  // so truncating at max(lo+0.01, 7) is safe for any practical x < 7.
  const integrate = x => {
    const lo = x;
    const hi = Math.max(lo + 0.01, 7.0);
    const N  = 400; // must be even
    const h  = (hi - lo) / N;
    let sum  = 0;
    for (let i = 0; i <= N; i++) {
      const r      = lo + i * h;
      const rv     = SDR * r;
      const fv     = finv(r / x);
      const pg     = pgamma(fv, shapeF(rv), scaleF(rv));
      const coeff  = (i === 0 || i === N) ? 1 : (i % 2 === 0 ? 2 : 4);
      sum += coeff * pg * dnorm(r);
    }
    return (sum * h) / 3;
  };

  // Solve eqn(t0) = 0  where  eqn(x) = ∫ₓ^∞ (…) dr − α/2
  // Root exists in (0, ∞); bracket: eqn(ε)≈0.5−α/2>0, eqn(large)<0.
  const halfAlpha = alpha / 2;
  const eqn = x => integrate(x) - halfAlpha;

  let lo = 1e-4, hi = 10;
  if (!isFinite(eqn(lo)) || !isFinite(eqn(hi)) || eqn(lo) < 0) {
    return { error: "HC: failed to bracket root" };
  }

  let t0 = (lo + hi) / 2;
  for (let iter = 0; iter < BISECTION_ITERS; iter++) {
    t0 = (lo + hi) / 2;
    const fmid = eqn(t0);
    if (Math.abs(fmid) < 1e-12 || (hi - lo) < 1e-14) break;
    if (fmid > 0) lo = t0; else hi = t0;
  }

  const u0 = SDR * t0;

  return {
    beta,
    se,
    ci:   [beta - u0 * se, beta + u0 * se],
    tau2,
    t0,
    u0,
    k,
  };
}

// ================= TEST OF EXCESS SIGNIFICANCE (TES) =================
/**
 * Ioannidis & Trikalinos (2007) test of excess significance.
 * Tests whether the observed number of statistically significant results
 * exceeds what is expected given the per-study power under the true effect θ.
 *
 * θ defaults to the RE pooled estimate m.RE (passed as the second argument).
 * Significance threshold is always α = 0.05 two-tailed (z_{0.025} ≈ 1.96).
 *
 * @param {{ yi: number, vi: number, label?: string }[]} studies
 * @param {{ RE: number }}                                m   — fitted meta object
 * @returns {{ O: number, E: number, Var: number, z: number, chi2: number,
 *             p: number, k: number, theta: number,
 *             powers: number[], sig: boolean[] }}
 */
export function tesTest(studies, m) {
  const valid = validStudies(studies);
  const k = valid.length;
  const nan = { O: NaN, E: NaN, Var: NaN, z: NaN, chi2: NaN, p: NaN, k, theta: NaN, powers: [], sig: [] };
  if (k < 2 || !m || !isFinite(m.RE)) return nan;

  const theta = m.RE;
  const z025  = normalQuantile(0.975);   // ≈ 1.959964

  const powers = valid.map(s => {
    const se = Math.sqrt(s.vi);
    const ncp = Math.abs(theta) / se;
    // Two-tailed power: Φ(ncp − z) + Φ(−z − ncp)
    return normalCDF(ncp - z025) + normalCDF(-z025 - ncp);
  });

  const sig = valid.map(s => Math.abs(s.yi / Math.sqrt(s.vi)) > z025);

  const O   = sig.reduce((n, b) => n + (b ? 1 : 0), 0);
  const E   = powers.reduce((s, p) => s + p, 0);
  // Binomial-approximation variance: E*(1-E/k)  — matches metafor tes()
  const Var = E * (1 - E / k);

  if (Var <= 0) return nan;

  const z    = (O - E) / Math.sqrt(Var);
  const chi2 = z * z;
  // One-sided p for excess significance: p < 0.5 when O > E.
  // pval = 1 − Φ(z); when O < E, z < 0 and p > 0.5 (no excess).
  const p = 1 - normalCDF(z);

  return { O, E, Var, z, chi2, p, k, theta, powers, sig };
}

// ================= WAAP-WLS =================
/**
 * Weighted Average of Adequately Powered studies (Stanley & Doucouliagos 2015).
 *
 * Algorithm:
 *  1. Full WLS (FE precision weights wi = 1/vi) over all valid studies → μ̂_WLS.
 *  2. For each study compute two-tailed power to detect |μ̂_WLS| at α = 0.05.
 *  3. Keep studies with power ≥ 0.80 ("adequately powered").
 *  4. WAAP = WLS restricted to that subset.
 *     If no study qualifies (kAdequate = 0) fallback to the full WLS estimate.
 *
 * All estimates remain on the analysis scale (log scale for OR/RR/etc.);
 * call profile.transform() in the UI layer for display.
 *
 * @param {{ yi: number, vi: number }[]} studies
 * @returns {{ estimate, se, ci, z, p, k, kAdequate, wlsEstimate, fallback }}
 */
export function waapWls(studies) {
  const valid = validStudies(studies);
  const k     = valid.length;
  const nan   = { estimate: NaN, se: NaN, ci: [NaN, NaN], z: NaN, p: NaN,
                  k, kAdequate: 0, wlsEstimate: NaN, fallback: false };
  if (k < 1) return nan;

  const z025 = normalQuantile(0.975);   // ≈ 1.95996

  // Step 1 — full WLS (intercept-only, weights wi = 1/vi)
  const W      = valid.reduce((s, d) => s + 1 / d.vi, 0);
  const wlsEst = valid.reduce((s, d) => s + d.yi / d.vi, 0) / W;

  // Step 2 — per-study power to detect |wlsEst| at two-tailed α = 0.05
  const adequate = valid.filter(d => {
    const ncp   = Math.abs(wlsEst) / Math.sqrt(d.vi);
    const power = normalCDF(ncp - z025) + normalCDF(-z025 - ncp);
    return power >= 0.80;
  });

  const kAdequate = adequate.length;
  const fallback  = kAdequate === 0;
  const subset    = fallback ? valid : adequate;

  // Step 3 — WLS on the adequate subset (or all studies if none qualify)
  const Wa   = subset.reduce((s, d) => s + 1 / d.vi, 0);
  const waap = subset.reduce((s, d) => s + d.yi / d.vi, 0) / Wa;
  const se   = Math.sqrt(1 / Wa);

  const z = waap / se;
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  const ci = [waap - z025 * se, waap + z025 * se];

  return { estimate: waap, se, ci, z, p, k, kAdequate, wlsEstimate: wlsEst, fallback };
}
