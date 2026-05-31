// =============================================================================
// analysis.js — Meta-analysis façade
// =============================================================================
// Owns the two core functions (meta, compute) plus clES, and re-exports the
// full public API from sub-modules so all callers can import from one place.
//
// Owned here
// ----------
//   isValidStudy(s)
//     Returns true when a study has finite yi and finite vi > 0.
//     Canonical validity predicate — use instead of inlining the check.
//   validStudies(studies)
//     Returns studies.filter(isValidStudy). Use everywhere instead of inline.
//
//   compute(s, type)
//     Dispatches per-study (yi, vi) computation via profiles.js.
//     Returns NaN yi/vi/se with w=0 on validation failure so meta() skips it.
//
//   meta(studies, method, ciMethod, alpha, tau2Init)
//     FE + RE pooling. τ² estimator selected via TAU2_FN lookup table.
//     Returns { FE, seFE, RE, seRE, tau2, Q, df, I2,
//               ciLow, ciHigh, predLow, predHigh,
//               crit, stat, pval, dist, tauCI, I2CI, H2CI }.
//     Results are shallow-memoised per studies-array reference.
//
// Return-shape contract (two patterns — do not mix)
// -------------------------------------------------
//   Per-study (compute / profiles.js):
//     { yi: NaN, vi: NaN, se: NaN, w: 0 }  on validation failure.
//     Callers pass these to meta(); meta() skips w=0 rows automatically.
//
//   Top-level analyses (meta, metaRegression, metaMH, metaPeto, meta3level,
//     mvMeta, goshCompute, …):
//     { error: string, …NaN fields }  on any error.
//     Always check `if (result.error)` first; remaining fields are NaN (not
//     undefined) so accidental access fails gracefully rather than silently.
//
//   clES(d, ci)
//     Common Language Effect Size Φ(d/√2); transforms d CI endpoints.
//
// Re-exported from sub-modules via export * (import from here or directly — same binding)
// -------------------------------------------------------------------------------------
//   tau2.js         — export *  (τ² estimators, logLik, RE_mean, FE_mean, I2)
//   bayes.js        — export *
//   multivariate.js — export *
//   binary.js       — export *
//   pubbias.js      — export *
//   influence.js    — export *
//   regression.js   — export *
//   selection.js    — export *
//   robust.js       — export *
//
// Circular imports (bayes.js, regression.js, robust.js) are safe: cross-module
// calls only happen inside function bodies, never at module initialisation time.
// =============================================================================

import { tCritical, normalCDF, normalQuantile, tCDF, sum } from "../core/utils.js";
import { MIN_VAR, REML_TOL } from "../core/constants.js";
import { tau2_DL, tau2_HS, tau2_DLIT, tau2_HSk, tau2_HE, tau2_SJ, tau2_ML,
         logLik, tau2_REML, tau2_PM, tau2_EB, tau2_PMM, tau2_GENQM,
         tau2_SQGENQ, tau2_GENQ } from "./tau2.js";
import { getProfile, autoDetectType } from "../core/profiles.js";
// Circular imports — safe: these are only called inside function bodies, never at
// module initialisation time.
import { profileLikCI } from "./bayes.js";       // bayes no longer imports back
import { heterogeneityCIs } from "./regression.js";

// ================= STUDY VALIDITY PREDICATE =================
/**
 * Returns true when a single study is valid for meta-analysis:
 * yi must be finite, vi must be finite and positive.
 * This is the canonical validity rule — use it instead of inlining the check.
 * @param {{ yi: number, vi: number }} s
 * @returns {boolean}
 */
export function isValidStudy(s) {
  return isFinite(s.yi) && isFinite(s.vi) && s.vi > 0;
}

/**
 * Returns the subset of studies that are valid for meta-analysis.
 * Equivalent to studies.filter(isValidStudy); centralised so the rule can't drift.
 * @param {{ yi: number, vi: number }[]} studies
 * @returns {{ yi: number, vi: number }[]}
 */
export function validStudies(studies) {
  return studies.filter(isValidStudy);
}

// resolveClusterIds(studies) → string[]
// Returns one cluster-ID string per study.  Missing or blank cluster values
// (null, undefined, or whitespace-only) produce a synthetic "__s<i>" fallback
// that makes every such study its own singleton cluster.
export function resolveClusterIds(studies) {
  return studies.map((s, i) => {
    const c = s.cluster;
    if (c !== null && c !== undefined) {
      const t = String(c).trim();
      if (t !== "") return t;
    }
    return `__s${i}`;
  });
}

// groupByCluster(studies) → Map<string, study[]>
// Groups studies by resolved cluster ID (see resolveClusterIds).
// Preserves insertion order of first encounter per cluster.
export function groupByCluster(studies) {
  const ids = resolveClusterIds(studies);
  const map = new Map();
  for (let i = 0; i < studies.length; i++) {
    const id = ids[i];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(studies[i]);
  }
  return map;
}

// ================= DYNAMIC COMPUTE =================
/**
 * Compute per-study (yi, vi) for one study row using the named effect profile.
 * Delegates entirely to profiles.js — effectProfiles is the single source of truth
 * for all effect-type formulas.
 *
 * @param {Object} s       - Raw study object; required fields vary by `type`.
 * @param {string} [type]  - Effect-type key (e.g. "SMD", "OR"); falsy = auto-detect
 *                           from field names (MD for continuous, OR for 2×2 counts).
 * @returns {{ yi: number, vi: number, se: number, w: number } & Object}
 *   Returns NaN yi/vi/se with w=0 on validation failure so meta() skips the study.
 */
export function compute(s, type) {
  const resolvedType = type || autoDetectType(s);
  if (!resolvedType) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
  const profile = getProfile(resolvedType);
  if (!profile) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
  return profile.compute(s);
}

export * from "./tau2.js";
export * from "./bayes.js";
export * from "./multivariate.js";
export * from "./binary.js";
export * from "./pubbias.js";
export * from "./influence.js";
export * from "./regression.js";

/**
 * Common Language Effect Size (CLES / CL statistic / AUC).
 * P(X₁ > X₂) for two independent normal populations with equal variance
 * and standardised mean difference d.
 *
 * CL = Φ(d / √2)        (McGraw & Wong 1992)
 * CI: transform the d CI endpoints through the same function.
 *
 * @param {number} d   - pooled SMD (Hedges' g or Cohen's d, on analysis scale)
 * @param {number[]} ci - [lower, upper] CI for d
 * @returns {{ estimate: number, ci: number[] }}
 */
export function clES(d, ci) {
  const transform = x => normalCDF(x / Math.SQRT2);
  return {
    estimate: transform(d),
    ci: [transform(ci[0]), transform(ci[1])],
  };
}

// ================ META-ANALYSIS ===============
// Shallow memo: WeakMap<studies[], Map<"method::ciMethod", result>>.
// A WeakMap entry is GC'd automatically when the studies array is released
// (i.e. after each runAnalysis() cycle), so no manual invalidation is needed.
const _metaCache = new WeakMap();

// Per-family iteration caps. Not exported — callers go through meta().
// REML/EBLUP: 500 — Fisher scoring with REML correction converges slowly
//   near the τ²=0 boundary; extra headroom avoids false non-convergence flags.
// ML: 100 — same algorithm without the REML leverage correction; converges
//   roughly 2–3× faster in practice.
// PM: 100 — fixed-point update is simple (Q-target)/W; converges in <20 iters
//   for well-behaved data.
// EB/PMM/SJ/DLIT: 200 — moderately complex updates or unusual seed geometry
//   (SJ starts from raw between-study variance, not DL) need more room.
const _ITER_REML = 500;
const _ITER_ML   = 100;
const _ITER_PM   = 100;
const _ITER_STD  = 200;

// Dispatch table for τ² estimators.
// Uniform signature: (s, t0) => result, where t0 is the warm-start τ² (or null).
// Closed-form estimators accept t0 for signature uniformity but do not forward it.
// DL is the default fallback (TAU2_FN[method] ?? TAU2_FN.DL).
// EBLUP is an alias for REML — see legacy estimator notes in benchmark-data.md.
const TAU2_FN = {
  // ---- closed-form (t0 accepted, not forwarded) ----
  DL:     (s, t0) => tau2_DL    (s),
  HS:     (s, t0) => tau2_HS    (s),
  HE:     (s, t0) => tau2_HE    (s),
  GENQ:   (s, t0) => tau2_GENQ  (s),
  GENQM:  (s, t0) => tau2_GENQM (s),
  SQGENQ: (s, t0) => tau2_SQGENQ(s),
  HSk:    (s, t0) => tau2_HSk   (s),
  // ---- iterative (t0 forwarded as warm start) ----
  REML:   (s, t0) => tau2_REML (s, REML_TOL, _ITER_REML, t0),
  EBLUP:  (s, t0) => tau2_REML (s, REML_TOL, _ITER_REML, t0),
  ML:     (s, t0) => tau2_ML   (s, REML_TOL, _ITER_ML,   t0),
  PM:     (s, t0) => tau2_PM   (s, REML_TOL, _ITER_PM,   t0),
  EB:     (s, t0) => tau2_EB   (s, REML_TOL, _ITER_STD,  t0),
  PMM:    (s, t0) => tau2_PMM  (s, REML_TOL, _ITER_STD,  t0),
  SJ:     (s, t0) => tau2_SJ   (s, REML_TOL, _ITER_STD,  t0),
  DLIT:   (s, t0) => tau2_DLIT (s, REML_TOL, _ITER_STD,  t0),
};

/**
 * Fit fixed-effect and random-effects meta-analysis models.
 * @param {{ yi: number, vi: number }[]} studies    - Per-study effect sizes and variances.
 * @param {string} [method="DL"]       - τ² estimator: "DL","REML","PM","ML","HS","HE","SJ","GENQ","HSk","DLIT","SQGENQ","EBLUP".
 * @param {string} [ciMethod="normal"] - CI method: "normal","t","kr","hksj".
 * @returns {{ FE: number, seFE: number, RE: number, seRE: number,
 *             tau2: number, Q: number, df: number, I2: number,
 *             tauCI: number[], I2CI: number[], H2CI: number[],
 *             predLow: number, predHigh: number,
 *             ciLow: number, ciHigh: number,
 *             crit: number, stat: number, pval: number, dist: string|null }}
 */
export function meta(studies, method="DL", ciMethod="normal", alpha=0.05, tau2Init=null) {
  // Cache check — same array reference + same method/ciMethod/alpha → return cached result.
  const _cacheKey = `${method}::${ciMethod}::${alpha}`;
  let _byMethod = _metaCache.get(studies);
  if (_byMethod?.has(_cacheKey)) return _byMethod.get(_cacheKey);

  const valid = validStudies(studies);
  const studies0 = studies;                              // original reference — preserved for cache keying
  if (valid.length < studies.length) studies = valid;

  const k = studies.length;
  if(k === 0){
    return { FE: NaN, seFE: NaN, RE: NaN, seRE: NaN, tau2:0, Q:NaN, df:0, I2:0, predLow:NaN, predHigh:NaN, ciLow:NaN, ciHigh:NaN, crit:NaN, stat:NaN, pval:NaN, dist:null };
  }

  // ---------- FIXED EFFECT ----------
  const wFE = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W = sum(wFE);
  const FE = W > 0 ? studies.reduce((acc, d, i) => acc + d.yi * wFE[i], 0)/W : NaN;
  const seFE = W > 0 ? Math.sqrt(1/W) : NaN;

  // Cochran's Q statistic (FE weights, Higgins & Thompson 2002, eq. 3):
  //   Q = Σᵢ wᵢ (yᵢ − FE)²,  wᵢ = 1/vᵢ,  df = k − 1.
  let Q = 0;
  for(let i=0;i<k;i++){ Q += wFE[i]*Math.pow(studies[i].yi - FE,2); }
  const dfQ = k-1;

  // σ²_typical — "typical" within-study variance (Higgins & Thompson 2002, eq. 6/9):
  //   c       = Σwᵢ − Σwᵢ²/Σwᵢ   (FE weights wᵢ = 1/vᵢ)
  //   σ²_typ  = (k−1) / c
  // Depends only on vᵢ, not on τ² — computed here once for use in I² below.
  const _W2FE   = wFE.reduce((acc, w) => acc + w * w, 0);
  const _cFE    = W - _W2FE / W;
  const sigma2  = _cFE > 0 ? dfQ / _cFE : dfQ / W;

  const _tau2Result = (TAU2_FN[method] ?? TAU2_FN.DL)(studies, tau2Init);
  const tau2 = typeof _tau2Result === "object" ? _tau2Result.tau2 : _tau2Result;
  const convergence = typeof _tau2Result === "object"
    ? { converged: _tau2Result.converged, iters: _tau2Result.iters, maxIters: _tau2Result.maxIters,
        reason: _tau2Result.converged ? null : 'max_iters', source: 'tau2_' + method }
    : { converged: true, iters: 0, maxIters: 0, reason: null, source: 'tau2_' + method };
  const tau2Boundary = typeof _tau2Result === "object"
    ? (_tau2Result.tau2Boundary ?? false)
    : (tau2 === 0 && k >= 2);

  // I² — τ²-based formula (Higgins & Thompson 2002, eq. 6/9; matches metafor for all methods).
  // For DL this is algebraically identical to (Q−df)/Q (Q-based formula). For REML/ML/PM/SJ/etc.
  // it uses the estimated τ², making I² sensitive to the estimator — consistent with metafor.
  let I2 = sigma2 > 0 ? 100 * tau2 / (tau2 + sigma2) : (tau2 > 0 ? 100 : 0);
  I2 = Math.max(0, Math.min(100, I2));

  // ---------- RANDOM EFFECT ----------
  const wRE = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
  const WRE = sum(wRE);
  const RE = WRE>0 ? studies.reduce((acc, d, i) => acc + d.yi * wRE[i], 0)/WRE : NaN;
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

	  crit = tCritical(df, alpha);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * tCDF(-Math.abs(stat), df);

	} else if (ciMethod === "t" && k > 1) {
	  // --- t-distribution (no variance adjustment) ---
	  const df = k - 1;

	  crit = tCritical(df, alpha);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * tCDF(-Math.abs(stat), df);

	} else {
	  // --- Normal (Wald) ---
	  crit = normalQuantile(1 - alpha / 2);
	  stat = RE / seRE;
	  dist = "z";
	  pval = k <= 1 ? NaN : 2 * (1 - normalCDF(Math.abs(stat)));
	}

  // Prediction interval critical value matches the CI method's distributional
  // assumption, consistent with metafor predict.rma() behaviour:
  //   normal → z(1−α/2)          (test="z" in metafor)
  //   t / KH → t(k−1, 1−α/2)    (test="t" / "knha"; df = k − p, p=1)
  // Requires k >= 3. Uses base seRE (not KH-adjusted variance).
  const predVar  = seRE_base * seRE_base + tau2;
  const predCrit = k >= 3
    ? (ciMethod === "normal"
        ? normalQuantile(1 - alpha / 2)
        : tCritical(k - 1, alpha))
    : NaN;

  // Q-profile CIs for τ², I², H²
  const hetCI = heterogeneityCIs(studies, tau2, alpha);

  // CI bounds — overridden below for profile likelihood.
  let ciLow  = RE - crit * seRE;
  let ciHigh = RE + crit * seRE;

  if (ciMethod === "PL" && k > 1) {
    // Profile likelihood CI: invert the LR test using ML internally.
    // Point estimate and p-value remain Wald-based.
    const plCI = profileLikCI(studies, alpha);
    ciLow  = plCI[0];
    ciHigh = plCI[1];
  }

  const _result = {
    FE,
    seFE,
    RE,
    seRE,
    tau2,
    tau2Boundary,
    convergence,
    Q,
    df: dfQ,
    I2,
    tauCI:  hetCI.tauCI,
    I2CI:   hetCI.I2CI,
    H2CI:   hetCI.H2CI,
    predLow:  isFinite(predCrit) ? RE - predCrit * Math.sqrt(predVar) : NaN,
    predHigh: isFinite(predCrit) ? RE + predCrit * Math.sqrt(predVar) : NaN,
    ciLow,
    ciHigh,
    crit,
    stat,
    pval,
    dist
  };
  if (!_byMethod) { _byMethod = new Map(); _metaCache.set(studies0, _byMethod); }
  _byMethod.set(_cacheKey, _result);
  return _result;
}

export * from "./selection.js";
export * from "./robust.js";
