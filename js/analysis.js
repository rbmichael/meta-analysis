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

import { tCritical, normalCDF, normalQuantile, tCDF } from "./utils.js";
import { MIN_VAR, REML_TOL } from "./constants.js";
import { tau2_DL, tau2_HS, tau2_DLIT, tau2_HSk, tau2_HE, tau2_SJ, tau2_ML,
         logLik, tau2_REML, tau2_PM, tau2_EB, tau2_PMM, tau2_GENQM,
         tau2_SQGENQ, tau2_GENQ, RE_mean, FE_mean, I2 } from "./tau2.js";
import { getProfile, autoDetectType } from "./profiles.js";
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
 * @param {Object} [options={}] - Reserved for future use; currently unused.
 * @returns {{ yi: number, vi: number, se: number, w: number } & Object}
 *   Returns NaN yi/vi/se with w=0 on validation failure so meta() skips the study.
 */
export function compute(s, type, options = {}) {
  const resolvedType = type || autoDetectType(s);
  if (!resolvedType) {
    console.warn("compute(): cannot auto-detect effect type", s);
    return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
  }
  const profile = getProfile(resolvedType);
  if (!profile) {
    console.warn(`compute(): unknown effect type "${resolvedType}"`);
    return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
  }
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

// Dispatch table for τ² estimators.  All entries accept (studies, tau2Init).
// DL is the default fallback (TAU2_FN[method] ?? TAU2_FN.DL).
// EBLUP is an alias for REML — see legacy estimator notes in benchmark-data.md.
const TAU2_FN = {
  DL:     s       => tau2_DL   (s),
  REML:   (s, t0) => tau2_REML (s, REML_TOL, 500, t0),
  PM:     (s, t0) => tau2_PM   (s, REML_TOL, 100, t0),
  EB:     (s, t0) => tau2_EB   (s, REML_TOL, 200, t0),
  PMM:    (s, t0) => tau2_PMM  (s, REML_TOL, 200, t0),
  ML:     (s, t0) => tau2_ML   (s, REML_TOL, 100, t0),
  SJ:     (s, t0) => tau2_SJ   (s, REML_TOL, 200, t0),
  DLIT:   (s, t0) => tau2_DLIT (s, REML_TOL, 200, t0),
  EBLUP:  (s, t0) => tau2_REML (s, REML_TOL, 500, t0),
  GENQM:  s       => tau2_GENQM(s),
  HS:     s       => tau2_HS   (s),
  HE:     s       => tau2_HE   (s),
  GENQ:   s       => tau2_GENQ (s),
  SQGENQ: s       => tau2_SQGENQ(s),
  HSk:    s       => tau2_HSk  (s),
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
  if (valid.length < studies.length) {
    console.warn(`meta(): dropped ${studies.length - valid.length} study/studies with non-finite or non-positive vi/yi`);
    studies = valid;
  }

  const k = studies.length;
  if(k === 0){
    return { FE: NaN, seFE: NaN, RE: NaN, seRE: NaN, tau2:0, Q:NaN, df:0, I2:0, predLow:NaN, predHigh:NaN, ciLow:NaN, ciHigh:NaN, crit:NaN, stat:NaN, pval:NaN, dist:null };
  }

  // ---------- FIXED EFFECT ----------
  const wFE = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W = wFE.reduce((acc, b) => acc + b, 0);
  const FE = W > 0 ? studies.reduce((acc, d, i) => acc + d.yi * wFE[i], 0)/W : NaN;
  const seFE = W > 0 ? Math.sqrt(1/W) : NaN;

  // Cochran's Q statistic (FE weights, Higgins & Thompson 2002, eq. 3):
  //   Q = Σᵢ wᵢ (yᵢ − FE)²,  wᵢ = 1/vᵢ,  df = k − 1.
  let Q = 0;
  for(let i=0;i<k;i++){ Q += wFE[i]*Math.pow(studies[i].yi - FE,2); }
  const dfQ = k-1;

  // I² — proportion of total variance due to between-study heterogeneity.
  // Q-based formula (Higgins & Thompson 2002, Stat Med 21:1539–1558, eq. 9):
  //   I² = max(0, (Q − (k−1)) / Q) × 100 %
  // This is equivalent to τ²_DL / (τ²_DL + σ²_typical) when method = "DL",
  // but is applied uniformly here regardless of the τ² estimator for
  // consistency across methods.
  //
  // Note: metafor uses this Q-based formula for moment estimators (DL, HS, HE)
  // but switches to the τ²-based formula I² = τ² / (τ² + σ²_typical) for
  // likelihood estimators (REML, ML).  Using the Q-based formula throughout
  // means I² is insensitive to the choice of τ² estimator — a deliberate
  // trade-off.  The I²CI bounds in heterogeneityCIs() are τ²-based, so when
  // τ² > 0 the point estimate and CI bounds may use different formulas.
  let I2 = 0;
  if(Q>dfQ && Q>0) I2 = ((Q-dfQ)/Q)*100;
  I2 = Math.max(0, Math.min(100,I2));

  const tau2 = (TAU2_FN[method] ?? TAU2_FN.DL)(studies, tau2Init);

  // ---------- RANDOM EFFECT ----------
  const wRE = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
  const WRE = wRE.reduce((acc, b) => acc + b, 0);
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
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

	} else if (ciMethod === "t" && k > 1) {
	  // --- t-distribution (no variance adjustment) ---
	  const df = k - 1;

	  crit = tCritical(df, alpha);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

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
  if (!_byMethod) { _byMethod = new Map(); _metaCache.set(studies, _byMethod); }
  _byMethod.set(_cacheKey, _result);
  return _result;
}

export * from "./selection.js";
export * from "./robust.js";
