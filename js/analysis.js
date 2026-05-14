// =============================================================================
// analysis.js — Core statistical engine
// =============================================================================
// Responsible for all numerical computation that sits above the per-study
// effect-size level.  profiles.js computes each study's yi/vi; this module
// takes those values and produces pooled estimates, heterogeneity statistics,
// confidence intervals, and diagnostic tests.
//
// Main exports
// ------------
//   compute(studies, type)
//     Dispatches per-study effect-size computation by effect type.
//     Returns the studies array with yi, vi, se, w appended to each row.
//
//   meta(studies, method, ciMethod)
//     Fits a random-effects (and fixed-effect) model.
//     Returns { FE, seFE, RE, seRE, tau2, Q, df, I2, ciLow, ciHigh,
//               predLow, predHigh, crit, stat, pval, dist, tauCI, I2CI, H2CI }.
//
//   tau2_DL / tau2_REML / tau2_ML / tau2_PM / tau2_HS / tau2_HE /
//   tau2_SJ / tau2_GENQ
//     Standalone τ² estimators; each accepts studies[] and returns a scalar.
//     Four additional estimators (DLIT, HSk, SQGENQ, EBLUP) are retained in
//     the codebase but removed from the UI — see individual comments.
//
//   eggerTest / beggTest / fatPetTest / harbordTest / petersTest /
//   deeksTest / rueckerTest
//     Publication-bias tests.  Each accepts studies[] (and m where needed)
//     and returns an object with slope, intercept, z/t, and p-value fields.
//
//   failSafeN(studies, alpha, target)
//     Rosenthal and Orwin fail-safe N.
//
//   heterogeneityCIs(studies, method)
//     Profile-likelihood CIs for τ², I², and H².
//
//   trimFill (re-exported from trimfill.js via analysis pipeline)
//
//   influenceDiagnostics / leaveOneOut / cumulativeMeta /
//   subgroupAnalysis / metaRegression / estimatorComparison
//     Sensitivity, influence, and moderator-analysis functions.
//
//   baujat(studies)
//     Baujat diagnostic: per-study contribution to Cochran's Q (x) and
//     influence on the FE pooled estimate (y).  All quantities are analytical
//     (no iterative leave-one-out meta() calls required).
//
//   blupMeta(studies, m, alpha)
//     Per-study BLUPs (Empirical Bayes shrunken estimates) under the RE model.
//     Returns shrunken estimate, full-uncertainty SE/CI, random effect, and
//     shrinkage weight λᵢ for each study.
//
//   bfgs(f, x0, opts)
//     General-purpose BFGS minimizer with central-difference gradient and
//     Armijo backtracking.  Returns { x, fval, gnorm, iters, converged }.
//
//   selIntervalProbs / selIntervalIdx / selectionLogLik
//     Low-level helpers for the Vevea-Hedges selection model; exported for
//     testing.  Not part of the public API.
//
//   SEL_CUTS_ONE_SIDED / SEL_CUTS_TWO_SIDED
//     Default p-value cutpoint presets for veveaHedges().
//
//   veveaHedges(studies, cuts, sides)
//     Vevea-Hedges (1995) step-function selection model for publication bias.
//     Fits ω_j weights via BFGS ML; returns corrected pooled estimate, τ²,
//     selection weights with SEs (delta method), and an LRT vs no-selection.
//
//   bayesMeta(studies, opts)
//     Conjugate normal-normal Bayesian random-effects model.  Prior: μ ~ N(μ₀, σ_μ²),
//     τ ~ HalfNormal(σ_τ).  Posterior approximated by 1-D grid over τ (nGrid = 300);
//     at each grid point the conditional posterior of μ is analytic (conjugate).
//     Returns posterior mean and 95% credible interval for μ and τ, plus marginal
//     density arrays for plotting.
//
//   metaMH(studies, type)
//     Mantel-Haenszel fixed-effects pooling for 2×2 binary data.
//     type ∈ {"OR","RR","RD"}.  Reads raw cell counts (a,b,c,d) from each study
//     object (stored by profile.compute via ...s spread).  Returns an object shaped
//     like meta() with RE/tau2 = NaN and isMH: true.
//
//   metaPeto(studies)
//     Peto one-step log-OR estimator for 2×2 binary data (OR only).
//     Based on observed-minus-expected cell counts and hypergeometric variance.
//     Returns an object shaped like meta() with RE/tau2 = NaN and isPeto: true.
//
//   sandwichVar(X, w, residuals, clusterIds)
//     Cluster-robust (sandwich) variance estimator.  Groups rows by clusterIds;
//     rows with null/empty IDs are treated as singletons.  Applies CR1 small-sample
//     correction C/(C−p).  Returns { V_rob, SE_rob, df, C, B, allSingletons } or
//     { error } if C < 2 or C ≤ p.
//
//   robustWlsResult(X, w, y, beta, clusterIds)
//     Post-processes a WLS fit with cluster-robust SEs via sandwichVar.
//     Returns { robustSE, robustZ, robustP, robustCi, df, C, allSingletons } or
//     { error }.  Used by eggerTest, fatPetTest, and metaRegression.
//
//   robustMeta(studies, method, ciMethod)
//     Wraps meta() and appends cluster-robust pooled-estimate SE/CI.
//     Reads cluster IDs from study.cluster; returns meta() result extended with
//     robustSE, robustCiLow, robustCiHigh, robustStat, robustPval, robustDf,
//     clustersUsed, isClustered.  Falls back to meta() when no clusters present.
//
// Dependencies: utils.js, constants.js, profiles.js
// =============================================================================

import { tCritical, normalCDF, normalQuantile, tCDF } from "./utils.js";
import { MIN_VAR, REML_TOL, Z_95 } from "./constants.js";
import { tau2_HS, tau2_DLIT, tau2_HSk, tau2_HE, tau2_SJ, tau2_ML,
         logLik, tau2_REML, tau2_PM, tau2_EB, tau2_PMM, tau2_GENQM,
         tau2_SQGENQ, tau2_GENQ, RE_mean, FE_mean, I2 } from "./tau2.js";
import { getProfile, autoDetectType } from "./profiles.js";
// Circular imports — safe: these are only called inside function bodies, never at
// module initialisation time.
import { profileLikCI } from "./bayes.js";       // bayes no longer imports back
import { heterogeneityCIs } from "./regression.js";

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

// τ² estimators and primitives (tau2.js) — export * kept: all names are τ² functions
export * from "./tau2.js";

// Bayesian meta-analysis (bayes.js)
export { profileLikCI, profileLikTau2, bayesMeta, priorSensitivity } from "./bayes.js";

// Multivariate meta-analysis (multivariate.js)
export { vcalc, mvMeta } from "./multivariate.js";


// Q for heterogeneity: IV weights (1/vi) with M-H estimate as reference.
export function metaMH(studies, type, alpha = 0.05) {
  const k = studies.length;
  if (k < 2) return { error: "Mantel-Haenszel requires at least 2 studies." };

  const MH_TYPES = ["OR", "RR", "RD"];
  if (!MH_TYPES.includes(type)) {
    return { error: `Mantel-Haenszel pooling is only available for OR, RR, and RD (got "${type}").` };
  }
  if (studies[0]?.a === undefined) {
    return { error: "Mantel-Haenszel requires raw cell counts (a, b, c, d)." };
  }

  let est, varEst;
  let kEff = 0;  // studies that passed the per-type guard

  if (type === "OR") {
    let sumR = 0, sumS = 0;
    let sumPR = 0, sumPS_QR = 0, sumQS = 0;

    for (const s of studies) {
      const { a, b, c, d } = s;
      const N = a + b + c + d;
      if (N === 0) continue;
      const R = a * d / N;
      const S = b * c / N;
      const P = (a + d) / N;
      const Q = (b + c) / N;
      sumR      += R;
      sumS      += S;
      sumPR     += P * R;
      sumPS_QR  += P * S + Q * R;
      sumQS     += Q * S;
      kEff++;
    }

    if (kEff < 2) return { error: "Fewer than 2 studies contributed to the M-H OR estimate." };
    if (sumR === 0) return { error: "M-H OR is undefined: no events in the treatment arm across all studies." };
    if (sumS === 0) return { error: "M-H OR is undefined: no events in the control arm across all studies." };

    est     = Math.log(sumR / sumS);
    varEst  = sumPR / (2 * sumR * sumR)
            + sumPS_QR / (2 * sumR * sumS)
            + sumQS / (2 * sumS * sumS);

  } else if (type === "RR") {
    let sumR = 0, sumS = 0, sumC = 0;

    for (const s of studies) {
      const { a, b, c, d } = s;
      const n1 = a + b, n2 = c + d, N = n1 + n2;
      if (N === 0) continue;
      if (a + c === 0) continue;  // no events in either arm — contributes nothing
      const R = a * n2 / N;
      const S = c * n1 / N;
      const C = (n1 * n2 * (a + c) - a * c * N) / (N * N);
      sumR += R;
      sumS += S;
      sumC += C;
      kEff++;
    }

    if (kEff < 2) return { error: "Fewer than 2 studies contributed to the M-H RR estimate." };
    if (sumR === 0) return { error: "M-H RR is undefined: no events in the treatment arm across all studies." };
    if (sumS === 0) return { error: "M-H RR is undefined: no events in the control arm across all studies." };

    est    = Math.log(sumR / sumS);
    varEst = sumC / (sumR * sumS);

  } else {  // RD
    let sumW = 0, sumNum1 = 0, sumNum2 = 0;

    for (const s of studies) {
      const { a, b, c, d } = s;
      const n1 = a + b, n2 = c + d, N = n1 + n2;
      if (N === 0 || n1 === 0 || n2 === 0) continue;
      sumW    += n1 * n2 / N;                                  // Σw
      sumNum1 += a * n2 / N - c * n1 / N;                      // Σ(a·n2/N − c·n1/N) = Σw·RD
      // Sato et al. (1989) variance components:
      sumNum2 += c * (n1 / N) ** 2 - a * (n2 / N) ** 2
               + (n1 / N) * (n2 / N) * (n2 - n1) / 2;         // A term
      kEff++;
    }

    if (kEff < 2) return { error: "Fewer than 2 studies contributed to the M-H RD estimate." };
    if (sumW === 0) return { error: "M-H RD is undefined: total weight is zero." };

    est = sumNum1 / sumW;

    // Sato et al. numerator: beta·ΣA + ΣB/2  where B_i = a(n2-c)/N + c(n1-a)/N
    let sumB = 0;
    for (const s of studies) {
      const { a, b, c, d } = s;
      const n1 = a + b, n2 = c + d, N = n1 + n2;
      if (N === 0 || n1 === 0 || n2 === 0) continue;
      sumB += (a * (n2 - c) + c * (n1 - a)) / N;
    }
    varEst = (est * sumNum2 + sumB / 2) / (sumW * sumW);
  }

  if (!isFinite(est) || !isFinite(varEst) || varEst <= 0) {
    return { error: "M-H estimate is not finite — check for degenerate cell counts." };
  }

  const se = Math.sqrt(varEst);

  // Q from IV weights with M-H estimate as the null
  const df = k - 1;
  let Q = 0;
  for (const s of studies) Q += (s.yi - est) ** 2 / Math.max(s.vi, MIN_VAR);
  const I2 = (df > 0 && Q > 0) ? Math.max(0, Math.min(100, (Q - df) / Q * 100)) : 0;

  const hetCI = heterogeneityCIs(studies, 0);
  const stat  = est / se;
  const pval  = 2 * (1 - normalCDF(Math.abs(stat)));

  const mhCrit = normalQuantile(1 - alpha / 2);
  return {
    FE: est, seFE: se,
    ciLow:   est - mhCrit * se,
    ciHigh:  est + mhCrit * se,
    RE: NaN, seRE: NaN, tau2: NaN,
    tauCI:   hetCI.tauCI,
    I2CI:    hetCI.I2CI,
    H2CI:    hetCI.H2CI,
    Q, df, I2,
    predLow: NaN, predHigh: NaN,
    stat, pval, crit: mhCrit, dist: "z",
    isMH: true, k,
  };
}


// ================= PETO OR =================
// One-step Peto log-OR estimator for 2×2 OR data only.
// Most appropriate when events are rare and arm sizes are balanced.
// Based on observed-minus-expected counts and hypergeometric variance.
//
// Reference: Yusuf et al. (1985) Statistics in Medicine 4:127-144.
//   E_i = n₁·(a+c) / N
//   V_i = n₁·n₂·(a+c)·(b+d) / (N²·(N−1))
//   log OR_Peto = Σ(a − E_i) / ΣV_i
//   Var  = 1 / ΣV_i
//
// Q for heterogeneity: IV weights (1/vi) with Peto estimate as reference.
export function metaPeto(studies, alpha = 0.05) {
  const k = studies.length;
  if (k < 2) return { error: "Peto OR requires at least 2 studies." };
  if (studies[0]?.a === undefined) {
    return { error: "Peto OR requires raw cell counts (a, b, c, d)." };
  }

  let sumOmE = 0, sumV = 0, sumOmE2V = 0;
  let kEff   = 0;

  for (const s of studies) {
    const { a, b, c, d } = s;
    const n1 = a + b, n2 = c + d, N = n1 + n2;
    if (N <= 1) continue;
    const events     = a + c;
    const nonevents  = b + d;
    if (events === 0 || nonevents === 0) continue;  // V_i = 0; contributes nothing
    const E = n1 * events / N;
    const V = n1 * n2 * events * nonevents / (N * N * (N - 1));
    if (!isFinite(V) || V <= 0) continue;
    const omE = a - E;
    sumOmE   += omE;
    sumV     += V;
    sumOmE2V += omE * omE / V;  // Σ(a-E)²/V, used for Peto Q
    kEff++;
  }

  if (kEff < 2) return { error: "Fewer than 2 studies contributed to the Peto OR estimate." };
  if (sumV  === 0) return { error: "Peto OR is undefined: total hypergeometric variance is zero." };

  const est    = sumOmE / sumV;
  const varEst = 1 / sumV;

  if (!isFinite(est) || varEst <= 0) {
    return { error: "Peto OR estimate is not finite — check for degenerate cell counts." };
  }

  const se = Math.sqrt(varEst);

  // Q using Peto hypergeometric weights (matches R rma.peto QE):
  //   Q = Σ(a-E)²/V − (Σ(a-E))²/ΣV
  const df = k - 1;
  let Q = sumOmE2V - sumOmE * sumOmE / sumV;
  const I2 = (df > 0 && Q > 0) ? Math.max(0, Math.min(100, (Q - df) / Q * 100)) : 0;

  const hetCI = heterogeneityCIs(studies, 0);
  const stat  = est / se;
  const pval  = 2 * (1 - normalCDF(Math.abs(stat)));

  const petoCrit = normalQuantile(1 - alpha / 2);
  return {
    FE: est, seFE: se,
    ciLow:   est - petoCrit * se,
    ciHigh:  est + petoCrit * se,
    RE: NaN, seRE: NaN, tau2: NaN,
    tauCI:   hetCI.tauCI,
    I2CI:    hetCI.I2CI,
    H2CI:    hetCI.H2CI,
    Q, df, I2,
    predLow: NaN, predHigh: NaN,
    stat, pval, crit: petoCrit, dist: "z",
    isPeto: true, k,
  };
}


// Publication bias tests (pubbias.js)
export { eggerTest, beggTest, fatPetTest, petPeeseTest,
         harbordTest, petersTest, deeksTest, rueckerTest,
         failSafeN, henmiCopas, tesTest, waapWls } from "./pubbias.js";

// Sensitivity and influence (influence.js)
export { influenceDiagnostics, leaveOneOut, cumulativeMeta,
         estimatorComparison, baujat, blupMeta } from "./influence.js";

// Meta-regression and moderators (regression.js)
export { subgroupAnalysis, heterogeneityCIs, rcsKnots, rcsBasis,
         buildDesignMatrix, tau2_metaReg, metaRegression, testContrast, adjustPvals,
         lsModel, rvePooled, meta3level } from "./regression.js";

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

// Lookup table replacing the 15-branch if-chain in meta().
// Each function receives (studies, wFE, W, Q, dfQ, tau2Init); most only use a subset.
// DL is the default fallback (TAU2_FN[method] ?? TAU2_FN.DL).
// EBLUP is an alias for REML — see legacy estimator notes in benchmark-data.md.
const TAU2_FN = {
  REML:   (s, _w, _W, _Q, _d, t0) => tau2_REML (s, 1e-12,    500, t0),
  PM:     (s, _w, _W, _Q, _d, t0) => tau2_PM   (s, REML_TOL, 100, t0),
  EB:     (s, _w, _W, _Q, _d, t0) => tau2_EB   (s, REML_TOL, 200, t0),
  PMM:    (s, _w, _W, _Q, _d, t0) => tau2_PMM  (s, REML_TOL, 200, t0),
  ML:     (s, _w, _W, _Q, _d, t0) => tau2_ML   (s, REML_TOL, 100, t0),
  SJ:     (s, _w, _W, _Q, _d, t0) => tau2_SJ   (s, REML_TOL, 200, t0),
  DLIT:   (s, _w, _W, _Q, _d, t0) => tau2_DLIT (s, REML_TOL, 200, t0),
  EBLUP:  (s, _w, _W, _Q, _d, t0) => tau2_REML (s, 1e-12,    500, t0),  // alias for REML
  GENQM:  (s)                      => tau2_GENQM(s),                      // bisection — tau2Init not applicable
  HS:     (s)                      => tau2_HS   (s),
  HE:     (s)                      => tau2_HE   (s),
  GENQ:   (s)                      => tau2_GENQ (s),
  SQGENQ: (s)                      => tau2_SQGENQ(s),
  HSk:    (s)                      => tau2_HSk  (s),
  DL:     (s, wFE, W, Q, dfQ)      => {
    const sumW2 = wFE.reduce((acc, w) => acc + w * w, 0);
    const C = W - (sumW2 / W);
    return C > 0 ? Math.max(0, (Q - dfQ) / C) : 0;
  },
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

  const valid = studies.filter(s => isFinite(s.vi) && s.vi > 0 && isFinite(s.yi));
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

  const tau2 = (TAU2_FN[method] ?? TAU2_FN.DL)(studies, wFE, W, Q, dfQ, tau2Init);

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

// ================= WEIGHTED LEAST SQUARES =================
/**
 * Weighted least squares: fit y = X·β with diagonal weight matrix W = diag(w).
 * Called at every τ² iteration inside metaRegression, so kept lean.
 * @param {number[][]} X - k×p row-major design matrix (from buildDesignMatrix).
 * @param {number[]}   y - k-length array of effect sizes.
 * @param {number[]}   w - k-length array of weights (typically 1/(vi + τ²)).
 * @returns {{ beta: number[], vcov: number[][], rankDeficient: boolean }}
 *   beta: p-length coefficient vector;
 *   vcov: p×p variance-covariance matrix = (X'WX)⁻¹;
 *   rankDeficient: true when X'WX is singular (all results NaN-filled).
 */
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
  const beta = inv.map(row => row.reduce((acc, v, j) => acc + v * XtWy[j], 0));

  return { beta, vcov: inv, rankDeficient: false };
}

// Gauss-Jordan elimination with partial pivoting.
// Returns the inverse of the p×p matrix A, or null if singular.
// Exported for selection.js (numericalHessian) and regression.js.
export function matInverse(A) {
  const p = A.length;

  // Augment A with the identity: M = [A | I]
  const M = A.map((row, i) => {
    const aug = row.slice();
    for (let j = 0; j < p; j++) aug.push(i === j ? 1 : 0);
    return aug;
  });

  // Scale singularity threshold by the largest entry in A so tiny-valued
  // matrices (e.g. scaled covariates) are not incorrectly flagged singular.
  const matScale = A.reduce((m, row) => Math.max(m, ...row.map(Math.abs)), 0);
  const singTol  = 1e-14 * Math.max(1, matScale);

  for (let col = 0; col < p; col++) {
    // Partial pivoting: swap in the row with the largest absolute value
    let pivotRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < singTol) return null;   // singular or near-singular

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

// log|det(A)| via partial-pivoting Gaussian elimination.
// A must be square and positive definite (used only for X'WX, which always is).
// Returns -Infinity if the matrix is (near-)singular.
export function logDet(A) {
  const n = A.length;
  const M = A.map(row => row.slice());
  let logd = 0;
  for (let i = 0; i < n; i++) {
    let maxVal = Math.abs(M[i][i]), maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxVal) { maxVal = Math.abs(M[k][i]); maxRow = k; }
    }
    if (maxRow !== i) [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-15) return -Infinity;
    logd += Math.log(Math.abs(M[i][i]));
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return logd;
}

// Selection models and p-value methods (selection.js)
export { pCurve, pUniform, veveaHedges, SELECTION_PRESETS,
         SEL_CUTS_ONE_SIDED, SEL_CUTS_TWO_SIDED,
         bfgs, selIntervalProbs, selIntervalIdx, selectionLogLik,
         halfNormalSelModel, powerSelModel, negexpSelModel, betaSelModel } from "./selection.js";

// ================= SANDWICH (CLUSTER-ROBUST) VARIANCE ESTIMATOR =================
// Computes the cluster-robust (sandwich) variance matrix for a WLS estimator.
//
// Parameters
// ----------
//   X          — k×p design matrix (array of k p-vectors)
//   w          — k-vector of weights w_i
//   residuals  — k-vector of residuals ê_i = y_i − x_i'β̂
//   clusterIds — k-vector of cluster identifiers (strings/numbers).
//                Rows with null/undefined/empty string are treated as singletons.
//
// Returns
// -------
//   { V_rob, SE_rob, df, C, B, allSingletons }  on success
//   { error }  when C < 2 or C ≤ p
//
//   V_rob       — p×p robust variance matrix (array of p p-vectors)
//   SE_rob      — p-vector of robust SEs (sqrt of diagonal of V_rob)
//   df          — C − p  (degrees of freedom for small-sample t CI)
//   C           — number of clusters
//   B           — p×p meat matrix
//   allSingletons — true if every cluster contains exactly one study
//
// Small-sample correction: V_rob is multiplied by C/(C−p), consistent with
// the CR1 correction in R's clubSandwich package.
export function sandwichVar(X, w, residuals, clusterIds) {
  const k = residuals.length;
  const p = X[0].length;

  // Assign a cluster label to every row; missing/blank → unique singleton key
  const ids = Array.from({ length: k }, (_, i) => {
    const id = clusterIds ? clusterIds[i] : null;
    return (id !== null && id !== undefined && String(id).trim() !== "")
      ? String(id).trim()
      : `__s_${i}`;
  });

  // Group row indices by cluster
  const clusterMap = new Map();
  for (let i = 0; i < k; i++) {
    const id = ids[i];
    if (!clusterMap.has(id)) clusterMap.set(id, []);
    clusterMap.get(id).push(i);
  }
  const C = clusterMap.size;
  const allSingletons = [...clusterMap.values()].every(rows => rows.length === 1);

  if (C < 2)  return { error: "Need at least 2 clusters for robust SE." };
  if (C <= p) return { error: `Fewer clusters (C=${C}) than parameters (p=${p}); robust SE not available.` };

  // A = (X'WX)^{-1}
  const XtWX = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < k; i++) {
    const wi = w[i];
    for (let j = 0; j < p; j++) {
      for (let l = j; l < p; l++) {
        const v = wi * X[i][j] * X[i][l];
        XtWX[j][l] += v;
        if (l !== j) XtWX[l][j] += v;
      }
    }
  }
  const A = matInverse(XtWX);
  if (A === null) return { error: "Design matrix is singular; robust SE not available." };

  // Small-sample CR1 correction: C / (C − p)
  const cr1 = C / (C - p);

  // Meat B = Σ_c g_c g_c'   where g_c = Σ_{i∈c} w_i X[i] ê_i   (p-vector)
  const B = Array.from({ length: p }, () => Array(p).fill(0));
  for (const clRows of clusterMap.values()) {
    const g = Array(p).fill(0);
    for (const i of clRows) {
      const wiei = w[i] * residuals[i];
      for (let j = 0; j < p; j++) g[j] += X[i][j] * wiei;
    }
    for (let j = 0; j < p; j++) {
      for (let l = 0; l < p; l++) B[j][l] += g[j] * g[l];
    }
  }

  // V_rob = cr1 · A B A   (A is symmetric)
  // First compute AB, then V_rob[j][l] = cr1 · Σ_m AB[j][m] · A[l][m]
  const AB = Array.from({ length: p }, () => Array(p).fill(0));
  for (let j = 0; j < p; j++)
    for (let l = 0; l < p; l++)
      for (let m = 0; m < p; m++) AB[j][l] += A[j][m] * B[m][l];

  const V_rob = Array.from({ length: p }, () => Array(p).fill(0));
  for (let j = 0; j < p; j++)
    for (let l = 0; l < p; l++) {
      let v = 0;
      for (let m = 0; m < p; m++) v += AB[j][m] * A[l][m];
      V_rob[j][l] = cr1 * v;
    }

  const SE_rob = Array.from({ length: p }, (_, j) => Math.sqrt(Math.max(0, V_rob[j][j])));

  return { V_rob, SE_rob, df: C - p, C, B, allSingletons };
}

// ================= CLUSTER-ROBUST WLS POST-PROCESSOR =================
// Given a WLS fit (X, w, y, beta), computes cluster-robust SEs and returns
// robust inference alongside the model-based fit.
//
// Parameters
// ----------
//   X          — k×p design matrix (same as passed to wls())
//   w          — k-vector of weights (same as passed to wls())
//   y          — k-vector of response values
//   beta       — p-vector of fitted coefficients from wls()
//   clusterIds — k-vector of cluster IDs; rows with null/empty are singletons
//
// Returns
// -------
//   { robustSE, robustZ, robustP, robustCi, df, C, allSingletons }  on success
//   { error }  if sandwichVar returns an error
export function robustWlsResult(X, w, y, beta, clusterIds) {
  const k = y.length;
  const residuals = y.map((yi, i) => yi - X[i].reduce((acc, xij, j) => acc + xij * beta[j], 0));

  const rob = sandwichVar(X, w, residuals, clusterIds);
  if (rob.error) return { error: rob.error };

  const useT = rob.df < 30;
  const crit = useT ? tCritical(rob.df) : Z_95;

  const robustSE = rob.SE_rob;
  const robustZ  = beta.map((b, j) => b / robustSE[j]);
  const robustP  = robustZ.map(z =>
    useT
      ? 2 * (1 - tCDF(Math.abs(z), rob.df))
      : 2 * (1 - normalCDF(Math.abs(z)))
  );
  const robustCi = beta.map((b, j) => [b - crit * robustSE[j], b + crit * robustSE[j]]);

  return {
    robustSE, robustZ, robustP, robustCi,
    df: rob.df, C: rob.C, allSingletons: rob.allSingletons,
  };
}

// ================= CLUSTER-ROBUST POOLED-ESTIMATE WRAPPER =================
// Wraps meta() and appends a cluster-robust SE and CI for the pooled estimate.
// Cluster IDs are read from study.cluster on each study object.
//
// Parameters
// ----------
//   studies   — array of study objects (must have yi, vi, and optionally cluster)
//   method    — τ² estimator string, forwarded to meta()
//   ciMethod  — CI method string, forwarded to meta()
//
// Returns
// -------
//   meta() result extended with:
//     robustSE, robustCiLow, robustCiHigh, robustStat, robustPval,
//     robustDf, clustersUsed, isClustered, allSingletons
//   Falls back to plain meta() result when no studies carry a cluster ID.
//   Adds robustError when sandwichVar fails (robust fields are then absent).
export function robustMeta(studies, method, ciMethod, alpha = 0.05) {
  const m = meta(studies, method, ciMethod, alpha);

  const clusterIds = studies.map(s => s.cluster?.trim() || null);
  if (clusterIds.every(id => !id)) return m;

  const k = studies.length;
  const X = Array.from({ length: k }, () => [1]);
  const w = studies.map(s => 1 / Math.max(s.vi + m.tau2, MIN_VAR));
  const residuals = studies.map(s => s.yi - m.RE);

  const rob = sandwichVar(X, w, residuals, clusterIds);
  if (rob.error) return { ...m, robustError: rob.error };

  const robSE = rob.SE_rob[0];
  const useT  = rob.df < 30;
  const crit  = useT ? tCritical(rob.df, alpha) : normalQuantile(1 - alpha / 2);
  const robStat = m.RE / robSE;
  const robPval = useT
    ? 2 * (1 - tCDF(Math.abs(robStat), rob.df))
    : 2 * (1 - normalCDF(Math.abs(robStat)));

  return {
    ...m,
    robustSE:     robSE,
    robustCiLow:  m.RE - crit * robSE,
    robustCiHigh: m.RE + crit * robSE,
    robustStat:   robStat,
    robustPval:   robPval,
    robustDf:     rob.df,
    clustersUsed: rob.C,
    isClustered:  true,
    allSingletons: rob.allSingletons,
  };
}
