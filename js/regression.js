// =============================================================================
// regression.js — subgroup analysis, heterogeneity CIs, RCS helpers,
//                 meta-regression, location-scale model, RVE, three-level MA
//
// Extracted from analysis.js (item 4.1.5 of TECHNICAL IMPROVEMENT ROADMAP).
// =============================================================================

// Circular imports — safe: these are only called inside function bodies.
import { meta, robustWlsResult, logLik, validStudies, resolveClusterIds, groupByCluster } from "./analysis.js";
import { tau2Core_REML, tau2Core_ML, tau2Core_PM, tau2Core_DL, tau2Core_HS, tau2Core_HE, tau2Core_SJ } from "./tau2.js";
import { wls, wlsCholesky, matInverse, logDet, numericalHessian } from "./linalg.js";
import { normalCDF, normalQuantile, tCDF, tCritical, fCDF, chiSquareCDF, chiSquareQuantile } from "./utils.js";
import { MIN_VAR, REML_TOL, BISECTION_ITERS } from "./constants.js";
import { bfgs } from "./selection.js";

// ================= SUBGROUP =================
export function subgroupAnalysis(studies, method="REML", ciMethod="normal", alpha=0.05) {
  const valid = studies.filter(s => s && isFinite(s.yi) && isFinite(s.vi) && s.group != null && s.group !== "");
  const kNoGroup = studies.filter(s => s && isFinite(s.yi) && isFinite(s.vi) && (s.group == null || s.group === "")).length;
  if(valid.length < 2) return null;
  const groups = {};
  valid.forEach(s => { const g = String(s.group).trim(); if(!g) return; if(!groups[g]) groups[g]=[]; groups[g].push(s); });
  const groupNames = Object.keys(groups);
  if(groupNames.length < 2) return null;
  const overall = meta(valid, method, ciMethod, alpha);
  const sgCrit = normalQuantile(1 - alpha / 2);
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
        ciLow: s.yi - sgCrit * Math.sqrt(s.vi),
        ciHigh: s.yi + sgCrit * Math.sqrt(s.vi),
        tau2: 0,
        I2: 0,
        Q: 0
      };
    } else {
      res = meta(groupStudies, method, ciMethod, alpha);
    }
    results[g] = {
      k: groupStudies.length,
      y: res.RE,
      se: res.seRE ?? res.se ?? Math.sqrt(res.vi ?? 0),
      ci: { lb: res.ciLow, ub: res.ciHigh },
      tau2: res.tau2 ?? 0,
      I2: res.I2 ?? 0
    };
    if(isFinite(res.Q)) Qwithin_sum += res.Q;
  });
  const Qtotal = isFinite(overall.Q) ? overall.Q : 0;
  let Qbetween = Qtotal - Qwithin_sum;
  if(!isFinite(Qbetween) || Qbetween < 0) Qbetween = 0;
  const df = groupNames.length - 1;
  const p = 1 - chiSquareCDF(Qbetween, df);
  return { groups: results, Qtotal, Qwithin: Qwithin_sum, Qbetween, df, p, k: valid.length, G: groupNames.length, kNoGroup };
}

// ================= Q-PROFILE HETEROGENEITY CIs =================
// Weighted Q statistic as a function of τ². Monotone decreasing in τ²;
// equals Q_FE when τ² = 0.
function qProfile(tau2, studies) {
  const w  = studies.map(d => 1 / (d.vi + tau2));
  const W  = w.reduce((acc, b) => acc + b, 0);
  const mu = studies.reduce((acc, d, i) => acc + w[i] * d.yi, 0) / W;
  return studies.reduce((acc, d, i) => acc + w[i] * (d.yi - mu) ** 2, 0);
}

// Q-profile 95% CI for τ², I², H² (Viechtbauer 2007).
// Inverts the Q-profile statistic against chi-square quantiles.
//
// Returns: { tauCI: [lo, hi], I2CI: [lo, hi], H2CI: [lo, hi] }
//   tauCI  — 95% CI for τ² on the variance scale
//   I2CI   — corresponding I² (%) bounds
//   H2CI   — corresponding H² bounds
export function heterogeneityCIs(studies, tau2, alpha = 0.05) {
  const k = studies.length;
  if (k < 2) return { tauCI: [0, NaN], I2CI: [0, NaN], H2CI: [1, NaN] };

  const df    = k - 1;
  const chiLo = chiSquareQuantile(alpha / 2,       df);  // lower quantile (small x)
  const chiHi = chiSquareQuantile(1 - alpha / 2,   df);  // upper quantile (large x)

  const Q_FE = qProfile(0, studies);

  // --- Lower τ² bound: Q_τ(τ²_lo) = chiHi ---
  // Q is decreasing; if Q_FE ≤ chiHi, no positive solution → τ²_lo = 0.
  const MAX_BOUND = 1e12;  // guard against unbounded doubling on pathological input
  let tau2_lo;
  if (Q_FE <= chiHi) {
    tau2_lo = 0;
  } else {
    let lo = 0, hi = Math.max(tau2, 1);
    while (qProfile(hi, studies) > chiHi && hi < MAX_BOUND) hi *= 2;
    if (qProfile(hi, studies) > chiHi) {
      tau2_lo = NaN;  // bracket not found within MAX_BOUND
    } else {
      for (let i = 0; i < BISECTION_ITERS; i++) {
        const mid = (lo + hi) / 2;
        if (qProfile(mid, studies) > chiHi) lo = mid; else hi = mid;
      }
      tau2_lo = (lo + hi) / 2;
    }
  }

  // --- Upper τ² bound: Q_τ(τ²_hi) = chiLo ---
  // Q → 0 as τ² → ∞, so a solution always exists when chiLo > 0.
  let tau2_hi;
  if (!isFinite(chiLo) || chiLo <= 0) {
    tau2_hi = Infinity;
  } else {
    let lo = isFinite(tau2_lo) ? tau2_lo : 0, hi = Math.max(tau2, 1);
    while (qProfile(hi, studies) > chiLo && hi < MAX_BOUND) hi *= 2;
    if (qProfile(hi, studies) > chiLo) {
      tau2_hi = NaN;  // bracket not found within MAX_BOUND
    } else {
      for (let i = 0; i < BISECTION_ITERS; i++) {
        const mid = (lo + hi) / 2;
        if (qProfile(mid, studies) > chiLo) lo = mid; else hi = mid;
      }
      tau2_hi = (lo + hi) / 2;
    }
  }

  // --- I² and H² CIs ---
  // Convert τ²CI bounds to I²/H²CI using the τ²-based formula
  // (Higgins & Thompson 2002, Stat Med 21:1539–1558, eq. 6 and 9):
  //   c          = Σwᵢ − Σwᵢ²/Σwᵢ        — H&T eq. 6 (wᵢ = 1/vᵢ)
  //   σ²_typical = (k−1) / c              — H&T eq. 9 rearranged
  //   I²         = τ² / (τ² + σ²_typical) × 100 %
  //   H²         = τ² / σ²_typical + 1
  // Using c (not Σwᵢ) in the denominator matches metafor's confint() and the
  // Higgins & Thompson paper; it gives larger σ²_typical, hence smaller I²/H²
  // CI upper bounds, especially when study weights are heterogeneous.
  const sumWFE  = studies.reduce((acc, d) => acc + 1 / d.vi,          0);
  const sumWFE2 = studies.reduce((acc, d) => acc + 1 / (d.vi * d.vi), 0);
  const c       = sumWFE - sumWFE2 / sumWFE;
  const sigma2  = c > 0 ? df / c : df / sumWFE;

  const toI2 = t => 100 * t / (t + sigma2);
  const toH2 = t => t / sigma2 + 1;

  return {
    tauCI: [tau2_lo, tau2_hi],
    I2CI:  [toI2(tau2_lo), isFinite(tau2_hi) ? toI2(tau2_hi) : 100],
    H2CI:  [toH2(tau2_lo), isFinite(tau2_hi) ? toH2(tau2_hi) : Infinity]
  };
}

// ================= RESTRICTED CUBIC SPLINE HELPERS =================
/**
 * Compute knot positions for a restricted cubic spline using Harrell's
 * recommended percentile-based placement.
 *   3 knots → {10, 50, 90}th percentiles
 *   4 knots → {5, 35, 65, 95}th percentiles
 *   5 knots → {5, 27.5, 50, 72.5, 95}th percentiles
 * @param {number[]} values - array of predictor values (NaN entries ignored)
 * @param {number}   nKnots - 3, 4, or 5
 * @returns {number[]} sorted knot positions
 */
export function rcsKnots(values, nKnots) {
  const pctMap = {
    3: [10, 50, 90],
    4: [5, 35, 65, 95],
    5: [5, 27.5, 50, 72.5, 95],
  };
  const pcts = pctMap[nKnots];
  if (!pcts) throw new Error(`rcsKnots: nKnots must be 3, 4, or 5; got ${nKnots}`);

  const sorted = values.filter(isFinite).slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return pcts.map(() => NaN);

  const knots = pcts.map(p => {
    const idx = (p / 100) * (n - 1);
    const lo  = Math.floor(idx);
    const hi  = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
  });

  // rcsBasis divides by (last knot − second-to-last knot); guard before caller hits NaN.
  if (knots[nKnots - 1] === knots[nKnots - 2])
    throw new Error(`RCS requires ${nKnots} distinct knot positions — moderator has too few unique values. Use fewer knots or a linear term.`);

  return knots;
}

/**
 * Evaluate the restricted cubic spline (RCS) nonlinear basis columns for a
 * single x value given a set of knots, using Harrell's formula.
 *
 * For k knots t[0]…t[k-1], produces k-2 nonlinear columns φ₁…φ_{k-2}:
 *   φ_j(x) = (x − t_j)³₊
 *             − (t_{k-1} − t_j)/(t_{k-1} − t_{k-2}) · (x − t_{k-2})³₊
 *             + (t_{k-2} − t_j)/(t_{k-1} − t_{k-2}) · (x − t_{k-1})³₊
 * for j = 0, 1, …, k-3.
 *
 * Note: the linear term (x itself) is NOT included here; buildDesignMatrix
 * adds x as its own column and then appends the rcsBasis columns.
 *
 * @param {number}   x     - predictor value
 * @param {number[]} knots - k knot positions (k = 3, 4, or 5)
 * @returns {number[]} array of k-2 nonlinear basis values
 */
export function rcsBasis(x, knots) {
  const k   = knots.length;          // total number of knots
  const tk  = knots[k - 1];          // last knot
  const tk1 = knots[k - 2];          // second-to-last knot
  const denom = tk - tk1;

  const pos3 = t => {
    const d = x - t;
    return d > 0 ? d * d * d : 0;
  };

  const result = [];
  for (let j = 0; j <= k - 3; j++) {
    const tj = knots[j];
    const phi = pos3(tj)
      - ((tk - tj) / denom) * pos3(tk1)
      + ((tk1 - tj) / denom) * pos3(tk);
    result.push(phi);
  }
  return result;
}

// ================= META-REGRESSION DESIGN MATRIX =================
// Builds the k×p design matrix X for meta-regression.
//
// moderators: array of { key: string, type: "continuous"|"categorical",
//                        transform?: "linear"|"poly2"|"poly3"|"rcs3"|"rcs4"|"rcs5" }
//   key       — property name on each study object
//   type      — "continuous" (read as number) or "categorical" (dummy-coded)
//   transform — nonlinear transform for continuous moderators (default "linear")
//
// interactions: array of { name: string, termA: string, termB: string }
//   name      — display name (e.g. "age×region"); used as key in modColMap
//   termA/B   — keys of moderators already processed above; outer product of
//               their columns is appended to the design matrix.
//               Poly/RCS moderators: all basis columns participate in the product.
//
// Returns:
//   X         — k×p row-major matrix (array of k rows, each a p-length array)
//   colNames  — p column labels; first is always "intercept"
//   refLevels — maps each categorical key to its (dropped) reference level
//   modColMap — maps each moderator key to the column indices it occupies in X
//               e.g. continuous "age" (linear) → [2]
//                    continuous "age" (poly2)  → [2, 3]  (x, x²)
//                    categorical "type" (3 lvl)→ [3, 4]
//               degenerate moderators (< 2 levels) map to []
//               interaction "age×region"        → [5, 6]  (one per level pair)
//   modKnots  — maps moderator key to knot array (only set for rcs* transforms)
//   validMask — k booleans; true when all entries in that row are finite
//   k, p      — matrix dimensions
export function buildDesignMatrix(studies, moderators = [], interactions = []) {
  const k = studies.length;

  // Build column-by-column, then transpose to row-major at the end.
  const columns  = [Array(k).fill(1)];  // intercept
  const colNames = ["intercept"];
  const refLevels = {};
  const modColMap = {};
  const modKnots  = {};
  let nextColIdx = 1;  // intercept occupies index 0

  for (const { key, type, transform = "linear" } of moderators) {
    const raw = studies.map(s => s[key]);

    if (type === "categorical") {
      // Unique non-null levels, sorted so the reference is deterministic.
      const levels = [...new Set(raw.filter(v => v != null && v !== ""))].sort();
      if (levels.length < 2) {
        modColMap[key] = [];  // degenerate — no columns added
        continue;
      }

      refLevels[key] = levels[0];
      modColMap[key] = [];

      for (const level of levels.slice(1)) {
        // Missing values become NaN so validMask catches them.
        columns.push(raw.map(v => (v == null || v === "") ? NaN : (v === level ? 1 : 0)));
        colNames.push(`${key}:${level}`);
        modColMap[key].push(nextColIdx++);
      }

    } else {
      // Continuous: coerce to number; non-numeric (including undefined) → NaN.
      const xVals = raw.map(v => +v);

      if (transform === "poly2") {
        // x and x²
        columns.push(xVals);
        columns.push(xVals.map(v => v * v));
        colNames.push(key, `${key}²`);
        modColMap[key] = [nextColIdx, nextColIdx + 1];
        nextColIdx += 2;

      } else if (transform === "poly3") {
        // x, x², x³
        columns.push(xVals);
        columns.push(xVals.map(v => v * v));
        columns.push(xVals.map(v => v * v * v));
        colNames.push(key, `${key}²`, `${key}³`);
        modColMap[key] = [nextColIdx, nextColIdx + 1, nextColIdx + 2];
        nextColIdx += 3;

      } else if (transform === "rcs3" || transform === "rcs4" || transform === "rcs5") {
        const nKnots = parseInt(transform.slice(3), 10);  // 3, 4, or 5
        const knots  = rcsKnots(xVals, nKnots);
        modKnots[key] = knots;

        // Linear term
        columns.push(xVals);
        colNames.push(key);
        modColMap[key] = [nextColIdx++];

        // Nonlinear RCS terms (nKnots - 2 columns)
        const nNL = nKnots - 2;
        for (let j = 0; j < nNL; j++) {
          columns.push(xVals.map(v => isFinite(v) ? rcsBasis(v, knots)[j] : NaN));
          colNames.push(`${key}_rcs${j + 1}`);
          modColMap[key].push(nextColIdx++);
        }

      } else {
        // Default: linear
        columns.push(xVals);
        colNames.push(key);
        modColMap[key] = [nextColIdx++];
      }
    }
  }

  // ---- Interaction terms (outer product of parent moderator columns) ----
  for (const { name, termA, termB } of interactions) {
    const colsA = modColMap[termA] ?? [];
    const colsB = modColMap[termB] ?? [];
    modColMap[name] = [];
    if (colsA.length === 0 || colsB.length === 0) continue;
    for (const ia of colsA) {
      for (const ib of colsB) {
        const ca = columns[ia], cb = columns[ib];
        columns.push(ca.map((a, i) => a * cb[i]));
        // Name each product column from its parent column names.
        colNames.push(`${colNames[ia]}×${colNames[ib]}`);
        modColMap[name].push(nextColIdx++);
      }
    }
  }

  const p = columns.length;

  // Transpose: X[i][j] = study i, column j.
  const X = Array.from({ length: k }, (_, i) => columns.map(col => col[i]));

  // A row is valid only when every entry is finite (no NaN / ±Infinity).
  const validMask = X.map(row => row.every(isFinite));

  return { X, colNames, refLevels, modColMap, modKnots, validMask, k, p };
}

// ================= TAU² FOR META-REGRESSION =================

function dot(a, b) {
  return a.reduce((acc, v, i) => acc + v * b[i], 0);
}

function quadForm(A, x) {
  return dot(x, A.map(row => dot(row, x)));
}

export function tau2_metaReg(yi, vi, X, method = "REML", tol = REML_TOL, maxIter = 100) {
  const k = vi.length, p = X[0].length, df = k - p;
  if (df <= 0) return 0;

  const reFitFn = (tau2) => {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, vcov, rankDeficient } = wlsCholesky(X, yi, w);
    if (rankDeficient) return null;
    const W = w.reduce((s, v) => s + v, 0);
    return {
      e: yi.map((y, i) => y - dot(X[i], beta)),
      h: X.map((xi, i) => w[i] * quadForm(vcov, xi)),
      W
    };
  };

  const feFitFn = () => {
    const w0 = vi.map(v => 1 / v);
    const { beta, vcov, rankDeficient } = wlsCholesky(X, yi, w0);
    if (rankDeficient) return null;
    const W = w0.reduce((s, v) => s + v, 0);
    return {
      e: yi.map((y, i) => y - dot(X[i], beta)),
      h: X.map((xi, i) => w0[i] * quadForm(vcov, xi)),
      W
    };
  };

  const uwFitFn = () => {
    const { beta, rankDeficient } = wls(X, yi, vi.map(() => 1));
    if (rankDeficient) return null;
    return { e: yi.map((y, i) => y - dot(X[i], beta)) };
  };

  if (method === "REML") return tau2Core_REML(vi, reFitFn, tau2Core_DL(vi, feFitFn, df), tol, maxIter);
  if (method === "ML")   return tau2Core_ML  (vi, reFitFn, tau2Core_DL(vi, feFitFn, df), tol, maxIter);
  if (method === "PM")   return tau2Core_PM  (vi, reFitFn, df, 0, tol, maxIter);
  if (method === "HS")   return tau2Core_HS  (vi, feFitFn, df);
  if (method === "HE")   return tau2Core_HE  (vi, uwFitFn, df);
  if (method === "SJ") {
    const fit0 = uwFitFn();
    if (!fit0) return 0;
    const seed = fit0.e.reduce((s, ei) => s + ei * ei, 0) / k;
    return tau2Core_SJ(vi, reFitFn, seed, tol, maxIter);
  }
  return tau2Core_DL(vi, feFitFn, df);
}

// ================= META-REGRESSION =================
// Fits a weighted mixed-effects meta-regression model.
//
// Parameters:
//   studies    — array of study objects, each with { yi, vi, ... }
//   moderators — array of { key, type } passed to buildDesignMatrix
//   method     — τ² estimator: "REML" (default), "DL", "PM"
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
//   QM         — omnibus test for all moderators jointly (Wald chi-sq or F)
//   QMdf       — df for QM (p − 1, i.e. excluding intercept)
//   QMp        — p-value for QM
//   modTests   — per-moderator omnibus tests (one entry per input moderator):
//                  { name, colIdxs, QM, QMdf, QMp }
//                Same chi-sq/F logic as the global QM but restricted to each
//                moderator's own columns.  Identical to global QM when there is
//                exactly one moderator.  QMdf = 0 for degenerate moderators.
//   vif        — p-length array; vif[0] = NaN (intercept), vif[j] = VIF for
//                column j.  VIF_j = 1/(1 − R²_j) where R²_j is from unweighted
//                OLS of X[:,j] on all other columns.  NaN when the auxiliary
//                regression is rank-deficient or the column is constant.
//                VIF = 1 with a single predictor (no collinearity possible).
//   maxVIF     — max of vif[1..p-1]; 0 when p ≤ 1; NaN entries excluded.
//   I2         — residual I² (%)
//   colNames   — column names matching beta
//   k          — number of studies used
//   p          — number of parameters
//   rankDeficient — true if design matrix was singular
/**
 * Fit a random-effects meta-regression model via WLS/REML.
 * Full return-value documentation in the block comment above.
 * @param {{ yi: number, vi: number, [key: string]: * }[]} studies
 * @param {{ key: string, type: "continuous"|"categorical" }[]} [moderators=[]]
 * @param {string} [method="REML"]     - τ² estimator: "REML","DL","PM","ML".
 * @param {string} [ciMethod="normal"] - CI method: "normal","t","kr","hksj".
 * @returns {{ beta: number[], se: number[], zval: number[], pval: number[],
 *             ci: {lb: number, ub: number}[], tau2: number,
 *             QE: number, QEp: number, QM: number, QMp: number,
 *             I2: number, R2: number|null, vif: number[], maxVIF: number,
 *             colNames: string[], k: number, p: number, rankDeficient: boolean }}
 */
export function metaRegression(studies, moderators = [], method = "REML", ciMethod = "normal", alpha = 0.05, interactions = []) {
  // Filter to studies with finite yi and vi
  const valid = validStudies(studies);
  const k = valid.length;

  const { X, colNames, modColMap, modKnots, validMask, p } = buildDesignMatrix(valid, moderators, interactions);

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
    QM: NaN, QMdf: p - 1, QMp: NaN, modTests: [],
    vif: Array(p).fill(NaN), maxVIF: NaN, I2: NaN,
    colNames, modColMap, modKnots, k: kf, p, rankDeficient: true, rankDeficientCause: "collinear"
  };

  if (kf < p + 1) return { ...empty, rankDeficientCause: "insufficient_k" };

  // ---- τ² ----
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
  // QE uses FE weights (1/vᵢ) with FE-estimated fitted values (β from FE-WLS).
  // This matches metafor's convention and gives QE ~ χ²(k−p) under H₀: τ²=0
  // with a null distribution that does not depend on τ².  Using RE weights or
  // RE-fitted values is circular (τ² appears while testing τ²=0) and produces
  // wrong p-values.  See Thompson & Sharp (1999), Viechtbauer (2010).
  const w0  = vi.map(v => 1 / v);   // FE weights — also used below for I²
  const { beta: betaFE, vcov: vcov0, rankDeficient: rd0 } = wls(Xf, yi, w0);
  const QE  = !rd0 ? yi.reduce((acc, y, i) => {
    const e = y - dot(Xf[i], betaFE);
    return acc + w0[i] * e * e;
  }, 0) : NaN;
  const QEdf = kf - p;
  const QEp  = QEdf > 0 && isFinite(QE) ? 1 - chiSquareCDF(QE, QEdf) : NaN;

  // ---- I² (residual) ----
  // τ²-based formula (Higgins & Thompson 2002, eq. 9 rearranged):
  //   I² = τ² / (τ² + σ²_typical) × 100 %
  // where σ²_typical = QEdf / c  (leverage-adjusted typical within-study variance,
  //   c = Σ(1/vᵢ)(1 − hᵢ), the FE hat-matrix diagonal adjustment).
  // The τ²-based formula is used here — not the Q-based formula in meta() —
  // because with REML the fitted τ² can be > 0 while QE ≤ QEdf (residual Q
  // below its expectation), which would produce I² = 0 from the Q formula
  // despite positive heterogeneity.
  // vcov0 (FE vcov) already computed above for QE; reuse here for I².
  let I2 = 0;
  if (!rd0 && QEdf > 0) {
    const c = w0.reduce((acc, wi, i) => acc + wi * (1 - wi * quadForm(vcov0, Xf[i])), 0);
    if (c > 0) I2 = Math.max(0, tau2 / (tau2 + QEdf / c) * 100);
  }

  // ---- SE and CIs for beta ----
  // s2: KH variance inflation factor (Knapp & Hartung 2003, eq. 8).
  // Uses RE residuals (RE weights × RE-fitted values), NOT QE (which uses FE
  // weights × FE-fitted values).  These are distinct quantities — QE tests
  // residual heterogeneity while s2 scales the RE-WLS covariance matrix.
  const useKH = ciMethod === "KH" && kf > p && QEdf > 0;
  let s2 = 1;
  if (useKH) {
    const rssRE = yi.reduce((acc, y, i) => {
      const e = y - dot(Xf[i], beta);  // RE-WLS residuals
      return acc + w[i] * e * e;       // RE weights
    }, 0);
    s2 = Math.max(1, rssRE / QEdf);
  }

  let se, crit, zval, pval, ci, dist;

  if (useKH) {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j]) * s2));
    crit  = tCritical(QEdf, alpha);
    dist  = "t";
    zval  = beta.map((b, j) => b / se[j]);
    pval  = zval.map(t => 2 * (1 - tCDF(Math.abs(t), QEdf)));
    ci    = beta.map((b, j) => [b - crit * se[j], b + crit * se[j]]);
  } else {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j])));
    crit  = normalQuantile(1 - alpha / 2);
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
      const QMchi = betaMod.reduce((acc, bi, r) =>
        acc + bi * invMod[r].reduce((iacc, v, c) => iacc + v * betaMod[c], 0), 0);
      if (useKH) {
        QM  = QMchi / (s2 * QMdf);   // F-statistic
        QMp = 1 - fCDF(QM, QMdf, QEdf);
      } else {
        QM  = QMchi;                   // chi-sq statistic
        QMp = 1 - chiSquareCDF(QM, QMdf);
      }
    }
  }

  // ---- Per-moderator omnibus tests ----
  // One Wald test per input moderator (and per interaction term), restricted to
  // the columns that term contributed to the design matrix.  Same chi-sq / F
  // logic as the global QM above.  When there is exactly one moderator (and no
  // interactions), modTests[0] equals the global QM.
  const _allTermKeys = [
    ...moderators.map(m => m.key),
    ...interactions.map(ix => ix.name),
  ];
  const modTests = _allTermKeys.map(key => {
    const colIdxs = modColMap[key] ?? [];
    const df = colIdxs.length;
    if (df === 0) return { name: key, colIdxs, QM: NaN, QMdf: 0, QMp: NaN };

    const betaMod = colIdxs.map(j => beta[j]);
    const vcovMod = colIdxs.map(r => colIdxs.map(c => vcov[r][c]));
    const invMod  = matInverse(vcovMod);
    if (invMod === null) return { name: key, colIdxs, QM: NaN, QMdf: df, QMp: NaN };

    const QMchi = betaMod.reduce((acc, bi, r) =>
      acc + bi * invMod[r].reduce((iacc, v, c) => iacc + v * betaMod[c], 0), 0);

    let modQM, modQMp;
    if (useKH) {
      modQM  = QMchi / (s2 * df);
      modQMp = 1 - fCDF(modQM, df, QEdf);
    } else {
      modQM  = QMchi;
      modQMp = 1 - chiSquareCDF(modQM, df);
    }

    return { name: key, colIdxs, QM: modQM, QMdf: df, QMp: modQMp };
  });

  // ---- Variance Inflation Factors ----
  // VIF_j = 1 / (1 − R²_j), where R²_j is the coefficient of determination
  // from an unweighted OLS regression of column j on all other columns of Xf.
  // Only meaningful for non-intercept columns (j ≥ 1).
  // With a single predictor (p = 2) the auxiliary regression has only an
  // intercept, R² = 0, so VIF = 1 — no collinearity possible.
  const vif = Array(p).fill(NaN);   // vif[0] remains NaN (intercept)
  if (p > 1) {
    const wOnes = Array(kf).fill(1);
    for (let j = 1; j < p; j++) {
      const yAux = Xf.map(row => row[j]);
      // X_minus_j: every column of Xf except column j (keeps the intercept).
      const XAux = Xf.map(row => row.filter((_, c) => c !== j));

      const { beta: betaAux, rankDeficient: rdAux } = wls(XAux, yAux, wOnes);
      if (rdAux) continue;  // vif[j] stays NaN

      const meanY  = yAux.reduce((s, v) => s + v, 0) / kf;
      const ssTot  = yAux.reduce((s, v) => s + (v - meanY) ** 2, 0);
      if (ssTot < 1e-14) continue;  // constant column — VIF undefined

      const ssRes = yAux.reduce((s, v, i) => {
        const fit = XAux[i].reduce((acc, x, c) => acc + x * betaAux[c], 0);
        return s + (v - fit) ** 2;
      }, 0);

      const r2  = Math.max(0, 1 - ssRes / ssTot);
      vif[j] = r2 < 1 ? 1 / (1 - r2) : Infinity;
    }
  }
  const maxVIF = vif.slice(1).reduce((mx, v) => isFinite(v) && v > mx ? v : mx, 0);

  const fitted      = Xf.map(xi => dot(xi, beta));
  const eRE         = yi.map((y, i) => y - fitted[i]);
  const stdResiduals = eRE.map((ei, i) => ei / Math.sqrt(vi[i] + tau2));

  // ---- Cluster-robust SEs for regression coefficients ----
  // Reads study.cluster from each study in rows (the filtered set used in the fit).
  let robustSE, robustZ, robustP, robustCi, robustDf, robustC, robustError, allSingletons;
  if (rows.some(s => s.cluster?.trim())) {
    const clusters = resolveClusterIds(rows);
    const rob = robustWlsResult(Xf, w, yi, beta, clusters);
    if (!rob.error) {
      robustSE      = rob.robustSE;
      robustZ       = rob.robustZ;
      robustP       = rob.robustP;
      robustCi      = rob.robustCi;
      robustDf      = rob.df;
      robustC       = rob.C;
      allSingletons = rob.allSingletons;
    } else {
      robustError = rob.error;
    }
  }

  // ---- Log-likelihood, AIC, BIC ----
  //
  // ML log-likelihood at the fitted (β̂, τ²):
  //   LL_ML = −½ Σ [ log(2π) + log(vᵢ+τ²) + (yᵢ − xᵢ′β̂)² / (vᵢ+τ²) ]
  //
  // REML log-likelihood (fixed effects marginalised out):
  //   LL_REML = LL_ML − ½ log(det(X′WX))   where W = diag(1/(vᵢ+τ²))
  //
  // Number of parameters (both ML and REML):
  //   npar = p + 1  (p fixed-effect coefficients + 1 variance component τ²)
  //
  // Effective sample size for BIC:
  //   ML:   k       (full number of studies)
  //   REML: k − p   (REML likelihood is defined over k−p error contrasts after
  //                  projecting out the p-dimensional column space of X)
  //
  // Matches metafor AIC.rma() / BIC.rma() conventions (verified 4.8-0).
  // REML AIC/BIC can only be compared across models with identical fixed-effect
  // structure; ML AIC/BIC can compare models differing in predictors or τ².
  let LL_ML = 0;
  for (let i = 0; i < kf; i++) {
    const v = vi[i] + tau2;
    LL_ML -= 0.5 * (Math.log(2 * Math.PI) + Math.log(v) + (yi[i] - fitted[i]) ** 2 / v);
  }

  // ---- Per-moderator Likelihood Ratio Tests ----
  // LRT = 2·(LL_ML_full − LL_ML_reduced) ~ χ²(df_mod) where reduced model
  // omits the columns contributed by that moderator.  Must use ML for valid
  // nested-model comparisons — REML LL cannot be compared across different
  // fixed-effect structures (Verbeke & Molenberghs 2000).
  //
  // LL_ML is always evaluated at the ML estimates (beta_ML, tau2_ML), not at
  // the current method's estimates, so LRT is valid even when method = "REML".
  // Augments each modTest entry in-place with {lrt, lrtDf, lrtP}.
  {
    // --- ML fit of the full model (used as LRT baseline for all moderators) ---
    // Always checks tau2=0 (boundary) as well as the Fisher-scoring optimum,
    // then returns the higher LL. This handles cases where the true ML estimate
    // is at the boundary (tau2=0) but the iterative solver converges elsewhere.
    const _llAt = (X_, t2) => {
      const w_ = vi.map(v => 1 / (v + t2));
      const { beta: b_, rankDeficient: rd_ } = wls(X_, yi, w_);
      if (rd_ || !b_) return NaN;
      let ll = 0;
      for (let i = 0; i < kf; i++) {
        const v = vi[i] + t2;
        const fit = X_[i].reduce((acc, x, c) => acc + x * b_[c], 0);
        ll -= 0.5 * (Math.log(2 * Math.PI) + Math.log(v) + (yi[i] - fit) ** 2 / v);
      }
      return ll;
    };
    const _mlFit = (X_) => {
      const t2_opt = Math.max(0, tau2_metaReg(yi, vi, X_, "ML"));
      const ll_opt = _llAt(X_, t2_opt);
      if (t2_opt === 0) return ll_opt;
      const ll_bnd = _llAt(X_, 0);
      return isFinite(ll_bnd) && ll_bnd > ll_opt ? ll_bnd : ll_opt;
    };
    const LL_ML_full = _mlFit(Xf);
    for (const mt of modTests) {
      if (mt.QMdf === 0 || mt.colIdxs.length === 0 || !isFinite(LL_ML_full)) {
        mt.lrt = NaN; mt.lrtDf = 0; mt.lrtP = NaN;
        continue;
      }
      // Reduced design matrix: drop the moderator's columns (keep intercept, col 0).
      const dropSet = new Set(mt.colIdxs);
      const Xr = Xf.map(row => row.filter((_, c) => !dropSet.has(c)));
      const ll_red = _mlFit(Xr);
      const lrtStat = 2 * (LL_ML_full - ll_red);
      mt.lrt   = isFinite(lrtStat) ? Math.max(0, lrtStat) : NaN;
      mt.lrtDf = mt.QMdf;  // columns dropped = same df as Wald test
      mt.lrtP  = isFinite(mt.lrt) ? 1 - chiSquareCDF(mt.lrt, mt.lrtDf) : NaN;
    }
  }

  // X′WX (W = diag(1/(vᵢ+τ²)) already in w[]) and X′X (unweighted) for REML correction.
  // REML LL = ML LL + p/2·log(2π) + ½·log|X′X| − ½·log|X′WX|
  // (Harville 1977; metafor 4.8.0 convention with REMLf = TRUE)
  const XtWX = Xf[0].map((_, r) =>
    Xf[0].map((_, c) => Xf.reduce((s, row, i) => s + w[i] * row[r] * row[c], 0))
  );
  const XtX = Xf[0].map((_, r) =>
    Xf[0].map((_, c) => Xf.reduce((s, row) => s + row[r] * row[c], 0))
  );
  const LL_REML = LL_ML + 0.5 * p * Math.log(2 * Math.PI) + 0.5 * logDet(XtX) - 0.5 * logDet(XtWX);
  const isREML  = method === "REML";
  const LL      = isREML ? LL_REML : LL_ML;
  const npar    = p + 1;                              // same for ML and REML
  const kBIC    = isREML ? Math.max(kf - p, 1) : kf; // error contrasts for REML
  const AIC     = -2 * LL + 2 * npar;
  const BIC     = -2 * LL + npar * Math.log(kBIC);

  return {
    beta, se, zval, pval, ci, vcov, crit, s2,
    tau2, tau2_0, R2,
    QE, QEdf, QEp,
    QM, QMdf, QMp, QMdist: useKH ? "F" : "chi2",
    modTests, vif, maxVIF,
    I2, colNames, modColMap, modKnots, k: kf, p, rankDeficient: false, dist,
    method,
    fitted, residuals: eRE, stdResiduals,
    labels: rows.map(s => s.label || ""),
    studiesUsed: rows,   // exact set used in the fit (for bubble plot)
    Xf,        // filtered design matrix (k×p) — used by permutation worker
    yi, vi,    // pass through for display
    // Model-fit indices
    LL, LL_ML, LL_REML, AIC, BIC, npar, kBIC,
    // Cluster-robust fields (undefined when no clusters present)
    robustSE, robustZ, robustP, robustCi, robustDf,
    clustersUsed: robustC, allSingletons,
    robustError,
    isClustered: robustSE !== undefined,
  };
}

// ================= CUSTOM CONTRAST =================
/**
 * testContrast(reg, L)
 * Test an arbitrary linear combination L·β of meta-regression coefficients.
 *
 * @param {object}   reg  metaRegression() result (must not be rankDeficient)
 * @param {number[]} L    contrast vector, length reg.p
 * @returns {{ est: number, se: number, stat: number, p: number, ci: [number,number] }}
 */
export function testContrast(reg, L) {
  const { beta, vcov, crit, dist, QEdf } = reg;
  const est    = dot(L, beta);
  const varEst = quadForm(vcov, L);          // L' V L
  const se     = Math.sqrt(Math.max(0, varEst));
  const stat   = se > 0 ? est / se : NaN;
  const p      = !isFinite(stat) ? NaN
    : dist === "t"
    ? 2 * (1 - tCDF(Math.abs(stat), QEdf))
    : 2 * (1 - normalCDF(Math.abs(stat)));
  const ci = [est - crit * se, est + crit * se];
  return { est, se, stat, p, ci };
}

// ================= MULTIPLE COMPARISON CORRECTION =================
/**
 * Adjust an array of p-values for multiple comparisons.
 * @param {number[]} pvals  - raw p-values (length m)
 * @param {string}   method - "none" | "bonferroni" | "holm"
 * @returns {number[]} adjusted p-values (same length, each in [0,1])
 */
export function adjustPvals(pvals, method) {
  const m = pvals.length;
  if (!m || method === "none") return pvals.slice();

  if (method === "bonferroni") {
    return pvals.map(p => Math.min(1, isFinite(p) ? p * m : NaN));
  }

  if (method === "holm") {
    // Step-down: sort by ascending p, multiply by decreasing factor, enforce monotonicity.
    const order = pvals.map((_, i) => i).sort((a, b) => {
      if (!isFinite(pvals[a]) && !isFinite(pvals[b])) return 0;
      if (!isFinite(pvals[a])) return 1;
      if (!isFinite(pvals[b])) return -1;
      return pvals[a] - pvals[b];
    });
    const adj = new Array(m);
    let runMax = 0;
    for (let rank = 0; rank < m; rank++) {
      const i = order[rank];
      const raw = pvals[i];
      const a = isFinite(raw) ? Math.min(1, raw * (m - rank)) : NaN;
      if (isFinite(a)) runMax = Math.max(runMax, a);
      adj[i] = isFinite(a) ? runMax : NaN;
    }
    return adj;
  }

  return pvals.slice();
}

// ================= LOCATION-SCALE MODEL =================
/**
 * Location-scale meta-regression (rma.ls equivalent).
 *
 * Fits separate moderator models for:
 *   Location (mean):  E[yᵢ] = Xᵢ β
 *   Scale (log τ²):   log(τᵢ²) = Zᵢ γ  →  τᵢ² = exp(Zᵢ γ)
 *
 * Estimation: ML (not REML) — profile likelihood over γ with β profiled out.
 *   β̂(γ) = (X'W(γ)X)⁻¹ X'W(γ) y,  wᵢ = 1/(vᵢ + exp(Zᵢγ))
 *   LL(γ) = −½ Σ [ log(vᵢ + τᵢ²) + (yᵢ − Xᵢ β̂)²/(vᵢ + τᵢ²) ]
 *
 * @param {object[]} studies      - array of study objects with yi, vi
 * @param {object[]} locMods      - location moderators { key, type, transform }
 * @param {object[]} scaleMods    - scale moderators { key, type, transform }
 * @param {object}   [opts]
 *   ciMethod  "normal"|"t"  (default "normal")
 *   alpha     confidence level (default 0.05)
 * @returns structured result object
 */
export function lsModel(studies, locMods = [], scaleMods = [], opts = {}) {
  const ciMethod    = opts.ciMethod    ?? "normal";
  const alpha       = opts.alpha       ?? 0.05;
  const locInteractions = opts.locInteractions ?? [];

  // ---- Filter valid studies ----
  const valid = validStudies(studies);
  const k = valid.length;

  // ---- Build design matrices ----
  const locDM   = buildDesignMatrix(valid, locMods, locInteractions);
  const scaleDM = buildDesignMatrix(valid, scaleMods);

  const validMask = locDM.validMask.map((v, i) => v && scaleDM.validMask[i]);
  const rows   = valid.filter((_, i) => validMask[i]);
  const Xloc   = locDM.X.filter((_, i) => validMask[i]);
  const Zscale = scaleDM.X.filter((_, i) => validMask[i]);
  const kf     = rows.length;
  const yi     = rows.map(s => s.yi);
  const vi     = rows.map(s => s.vi);
  const p      = locDM.p;    // location parameters
  const q      = scaleDM.p;  // scale parameters

  const emptyResult = {
    beta: Array(p).fill(NaN), se_beta: Array(p).fill(NaN),
    zval_beta: Array(p).fill(NaN), pval_beta: Array(p).fill(NaN),
    ci_beta: Array(p).fill([NaN, NaN]),
    gamma: Array(q).fill(NaN), se_gamma: Array(q).fill(NaN),
    zval_gamma: Array(q).fill(NaN), pval_gamma: Array(q).fill(NaN),
    ci_gamma: Array(q).fill([NaN, NaN]),
    tau2_i: Array(kf).fill(NaN),
    QE: NaN, QEdf: kf - p, QEp: NaN,
    QM_loc: NaN, QM_locDf: p - 1, QM_locP: NaN,
    QM_scale: NaN, QM_scaleDf: q - 1, QM_scaleP: NaN,
    LRchi2: NaN, LRdf: q - 1, LRp: NaN,
    LL: NaN, LL0: NaN, I2: NaN,
    locColNames: locDM.colNames, scaleColNames: scaleDM.colNames,
    locColMap: locDM.modColMap, scaleColMap: scaleDM.modColMap,
    locKnots: locDM.modKnots, scaleKnots: scaleDM.modKnots,
    k: kf, p, q, rankDeficient: true, converged: false,
    studiesUsed: rows, yi, vi,
  };

  if (kf < p + q) return { ...emptyResult, rankDeficientCause: "insufficient_k" };

  // ---- Profile likelihood over γ ----
  // Returns { beta, tau2_i, LL } for a given gamma vector.
  function profileAt(gamma) {
    const tau2_i = Zscale.map(z => Math.exp(dot(z, gamma)));
    const w      = vi.map((v, i) => 1 / (v + tau2_i[i]));
    const { beta, rankDeficient } = wls(Xloc, yi, w);
    if (rankDeficient) return null;
    const resid = yi.map((y, i) => y - dot(Xloc[i], beta));
    const LL    = -0.5 * resid.reduce((acc, e, i) => {
      return acc + Math.log(vi[i] + tau2_i[i]) + e * e * w[i];
    }, 0);
    return { beta, tau2_i, w, resid, LL };
  }

  // Objective: negative profile LL (minimise).
  function negLL(gamma) {
    const res = profileAt(gamma);
    return res ? -res.LL : 1e10;
  }

  // ---- Starting point: γ₀ = [log(median vi), 0, 0, …] ----
  const medVi  = vi.slice().sort((a, b) => a - b)[Math.floor(kf / 2)];
  const gamma0 = Array(q).fill(0);
  gamma0[0]    = Math.log(Math.max(medVi * 0.1, 1e-6));

  // ---- Optimize ----
  const opt = bfgs(negLL, gamma0, { maxIter: 600, gtol: 1e-7 });
  const gamma_hat = opt.x;
  const pr        = profileAt(gamma_hat);
  if (!pr) return emptyResult;

  const { beta, tau2_i, w, resid, LL } = pr;

  // ---- SE for β: (X'W(γ̂)X)⁻¹ ----
  const { vcov: vcov_beta, rankDeficient: rdBeta } = wls(Xloc, yi, w);
  if (rdBeta) return emptyResult;

  // ---- SE for γ: numerical Hessian of negLL at γ̂ ----
  const H_gamma = numericalHessian(negLL, gamma_hat);

  const vcov_gamma_raw = matInverse(H_gamma);
  const vcov_gamma = vcov_gamma_raw ?? Array.from({ length: q }, () => Array(q).fill(NaN));
  const rdGamma    = vcov_gamma_raw === null;

  // ---- Inference for β ----
  const crit = normalQuantile(1 - alpha / 2);
  const se_beta  = vcov_beta.map((row, j) => Math.sqrt(Math.max(0, row[j])));
  const zval_beta = beta.map((b, j) => b / se_beta[j]);
  const pval_beta = zval_beta.map(z => 2 * (1 - normalCDF(Math.abs(z))));
  const ci_beta   = beta.map((b, j) => [b - crit * se_beta[j], b + crit * se_beta[j]]);

  // ---- Inference for γ ----
  const se_gamma   = vcov_gamma.map((row, j) => Math.sqrt(Math.max(0, row[j])));
  const zval_gamma = gamma_hat.map((g, j) => g / se_gamma[j]);
  const pval_gamma = zval_gamma.map(z => 2 * (1 - normalCDF(Math.abs(z))));
  const ci_gamma   = gamma_hat.map((g, j) => [g - crit * se_gamma[j], g + crit * se_gamma[j]]);

  // ---- QE: residual heterogeneity (FE-based, same convention as metaRegression) ----
  const w0  = vi.map(v => 1 / v);
  const { beta: betaFE, rankDeficient: rdFE } = wls(Xloc, yi, w0);
  const QE  = !rdFE ? yi.reduce((acc, y, i) => {
    const e = y - dot(Xloc[i], betaFE);
    return acc + w0[i] * e * e;
  }, 0) : NaN;
  const QEdf = kf - p;
  const QEp  = QEdf > 0 && isFinite(QE) ? 1 - chiSquareCDF(QE, QEdf) : NaN;

  // ---- QM for location moderators (Wald test on β[1..p-1]) ----
  let QM_loc = NaN, QM_locDf = p - 1, QM_locP = NaN;
  if (p > 1) {
    const idx = Array.from({ length: p - 1 }, (_, i) => i + 1);
    const bm  = idx.map(j => beta[j]);
    const Vm  = idx.map(r => idx.map(c => vcov_beta[r][c]));
    const iVm = matInverse(Vm);
    if (iVm) {
      QM_loc  = bm.reduce((acc, b, r) => acc + b * iVm[r].reduce((s, v, c) => s + v * bm[c], 0), 0);
      QM_locP = 1 - chiSquareCDF(QM_loc, QM_locDf);
    }
  }

  // ---- QM for scale moderators (Wald test on γ[1..q-1]) ----
  let QM_scale = NaN, QM_scaleDf = q - 1, QM_scaleP = NaN;
  if (q > 1 && !rdGamma) {
    const idx = Array.from({ length: q - 1 }, (_, i) => i + 1);
    const gm  = idx.map(j => gamma_hat[j]);
    const Vgm = idx.map(r => idx.map(c => vcov_gamma[r][c]));
    const iVgm = matInverse(Vgm);
    if (iVgm) {
      QM_scale  = gm.reduce((acc, g, r) => acc + g * iVgm[r].reduce((s, v, c) => s + v * gm[c], 0), 0);
      QM_scaleP = 1 - chiSquareCDF(QM_scale, QM_scaleDf);
    }
  }

  // ---- Likelihood ratio test for scale moderators ----
  // Compare full model (q scale params) vs intercept-only scale model (1 scale param).
  // The null model uses only the intercept of the scale matrix.
  let LRchi2 = NaN, LRdf = q - 1, LRp = NaN, LL0 = NaN;
  if (q > 1) {
    // Negative profile LL for intercept-only scale model (gamma is a scalar).
    function negLL0_fn(g1) {
      const tau2_0 = Math.exp(g1[0]);
      const w_0    = vi.map(v => 1 / (v + tau2_0));
      const { beta: b0, rankDeficient: rd0 } = wls(Xloc, yi, w_0);
      if (rd0) return 1e10;
      const e0 = yi.map((y, i) => y - dot(Xloc[i], b0));
      return 0.5 * e0.reduce((acc, e, i) => acc + Math.log(vi[i] + tau2_0) + e * e * w_0[i], 0);
    }
    const opt0  = bfgs(negLL0_fn, [gamma_hat[0]], { maxIter: 600, gtol: 1e-7 });
    LL0    = -negLL0_fn(opt0.x);
    LRchi2 = 2 * (LL - LL0);
    LRp    = LRchi2 > 0 ? 1 - chiSquareCDF(LRchi2, LRdf) : 1;
  }

  // ---- I² (residual) using mean τ² ----
  const tau2_mean = tau2_i.reduce((s, t) => s + t, 0) / kf;
  const { vcov: vcov_FE } = !rdFE ? wls(Xloc, yi, w0) : { vcov: null };
  const I2 = !rdFE && QEdf > 0 && vcov_FE ? (() => {
    const c = w0.reduce((acc, wi, i) => acc + wi * (1 - wi * quadForm(vcov_FE, Xloc[i])), 0);
    if (c <= 0) return 0;
    return Math.max(0, tau2_mean / (tau2_mean + QEdf / c) * 100);
  })() : 0;

  // ---- Per-location-moderator Wald tests ----
  const locModTests = locMods.map(({ key }) => {
    const colIdxs = locDM.modColMap[key] ?? [];
    const df = colIdxs.length;
    if (df === 0) return { name: key, colIdxs, QM: NaN, QMdf: 0, QMp: NaN };
    const bm  = colIdxs.map(j => beta[j]);
    const Vm  = colIdxs.map(r => colIdxs.map(c => vcov_beta[r][c]));
    const iVm = matInverse(Vm);
    if (!iVm) return { name: key, QM: NaN, QMdf: df, QMp: NaN };
    const QMchi = bm.reduce((acc, b, r) => acc + b * iVm[r].reduce((s, v, c) => s + v * bm[c], 0), 0);
    return { name: key, colIdxs, QM: QMchi, QMdf: df, QMp: 1 - chiSquareCDF(QMchi, df) };
  });

  // ---- Per-scale-moderator Wald tests ----
  const scaleModTests = scaleMods.map(({ key }) => {
    const colIdxs = scaleDM.modColMap[key] ?? [];
    const df = colIdxs.length;
    if (df === 0 || rdGamma) return { name: key, colIdxs, QM: NaN, QMdf: 0, QMp: NaN };
    const gm  = colIdxs.map(j => gamma_hat[j]);
    const Vgm = colIdxs.map(r => colIdxs.map(c => vcov_gamma[r][c]));
    const iVgm = matInverse(Vgm);
    if (!iVgm) return { name: key, colIdxs, QM: NaN, QMdf: df, QMp: NaN };
    const QMchi = gm.reduce((acc, g, r) => acc + g * iVgm[r].reduce((s, v, c) => s + v * gm[c], 0), 0);
    return { name: key, colIdxs, QM: QMchi, QMdf: df, QMp: 1 - chiSquareCDF(QMchi, df) };
  });

  // ---- Fitted values and residuals ----
  const fitted    = rows.map((_, i) => dot(Xloc[i], beta));
  const residuals = yi.map((y, i) => y - fitted[i]);

  return {
    beta, se_beta, zval_beta, pval_beta, ci_beta,
    gamma: gamma_hat, se_gamma, zval_gamma, pval_gamma, ci_gamma,
    tau2_i, tau2_mean,
    vcov_beta,
    QE, QEdf, QEp,
    QM_loc, QM_locDf, QM_locP,
    QM_scale, QM_scaleDf, QM_scaleP,
    LRchi2, LRdf, LRp,
    LL, LL0, I2,
    locColNames: locDM.colNames,
    scaleColNames: scaleDM.colNames,
    locColMap: locDM.modColMap,
    scaleColMap: scaleDM.modColMap,
    locKnots: locDM.modKnots,
    scaleKnots: scaleDM.modKnots,
    locModTests, scaleModTests,
    k: kf, p, q,
    rankDeficient: false, converged: opt.converged,
    studiesUsed: rows,
    fitted, residuals,
    yi, vi,
    labels: rows.map(s => s.label || ""),
    crit, alpha,
  };
}

// ================= ROBUST VARIANCE ESTIMATION (RVE) =================
//
// Model-based correction for dependent effect sizes.
// Hedges, Tipton & Johnson (2010, Res Synth Methods 1(1):39–65).
//
// Working covariance model (block-diagonal across clusters):
//   Vᵢ[j,j]  = vⱼ          (within-study variance — on diagonal)
//   Vᵢ[j,k]  = ρ√(vⱼ·vₖ)  (off-diagonal, j≠k, same cluster)
//
// Vᵢ = (1−ρ)Dᵢ + ρ·dᵢdᵢ'  where dᵢⱼ = √vⱼ.  Sherman-Morrison gives
//   Vᵢ⁻¹[j,k] = [wⱼδⱼₖ·cᵢ − ρ√(wⱼwₖ)] / ((1−ρ)·cᵢ)
//   where wⱼ = 1/vⱼ and cᵢ = 1−ρ+ρkᵢ.
//
// For p predictors (intercept always included as column 0):
//   Aᵢ = Xᵢ'Vᵢ⁻¹Xᵢ = (WXXᵢ − ρ/cᵢ · SXᵢ⊗SXᵢ) / (1−ρ)       p×p
//   bᵢ = Xᵢ'Vᵢ⁻¹yᵢ = (WXYᵢ − ρ/cᵢ · SXᵢ·SYᵢ)  / (1−ρ)       p-vec
//   β̂  = (ΣAᵢ)⁻¹ · Σbᵢ
//
// Sandwich SE (CR1 small-sample correction):
//   gᵢ  = Xᵢ'Vᵢ⁻¹eᵢ = (WXEᵢ − ρ/cᵢ · SXᵢ·SEᵢ) / (1−ρ)
//   V̂(β̂) = m/(m−1) · B⁻¹ · (Σgᵢgᵢ') · B⁻¹   where B = ΣAᵢ
//   df = m − p,  t = β̂ⱼ/SE(β̂ⱼ),  p = two-tailed t-test
//
// Parameters
// ----------
//   studies     — [{yi, vi, cluster?, <mod>?}] — cluster absent/blank → singleton
//   opts        — { rho: 0.80, alpha: 0.05, moderators: [] }
//     moderators — array of study property names to use as covariates
//                  (intercept is always included; studies missing a moderator
//                   value are silently excluded)
//
// Returns
// -------
//   { est, se, ci: [lo, hi], df, t, p, coefs, rho, kCluster, k }
//   coefs: [{ name, est, se, ci, t, p }] — one entry per coefficient
//          (coefs[0] is always the intercept / pooled effect)
//   or { error: string } on failure
//
export function rvePooled(studies, opts = {}) {
  const rho        = opts.rho        ?? 0.80;
  const alpha      = opts.alpha      ?? 0.05;
  const moderators = opts.moderators ?? [];   // array of covariate names

  if (rho <= -1 || rho >= 1) return { error: "ρ must be in (−1, 1)." };

  const p    = 1 + moderators.length;  // intercept + moderators
  const rho1 = 1 - rho;

  // Filter to valid studies — finite yi/vi and all moderator values present.
  const valid = studies.filter(s => {
    if (!s || !isFinite(s.yi) || !isFinite(s.vi) || s.vi <= 0) return false;
    for (const mod of moderators) if (!isFinite(s[mod])) return false;
    return true;
  });
  const k = valid.length;
  if (k < 2) return { error: "Need at least 2 valid studies." };

  // Group studies by cluster; studies without a cluster ID are singletons.
  const clusterMap = groupByCluster(valid);
  const m = clusterMap.size;
  if (m < 2) return { error: "Need at least 2 clusters for RVE." };

  const df = m - p;
  if (df < 1) return { error: `Too few clusters (m=${m}) for ${p} predictors; need m > p.` };

  // Design vector for a study: [1, mod1, mod2, ...]
  const xVec = s => [1, ...moderators.map(mod => s[mod])];

  // --- First pass: accumulate B = ΣAᵢ (p×p) and b = Σbᵢ (p) ---
  const B = Array.from({ length: p }, () => new Array(p).fill(0));
  const bVec = new Array(p).fill(0);
  const clList = [];   // [{SX, ci, clStudies}] for second pass

  for (const clStudies of clusterMap.values()) {
    const ki = clStudies.length;
    const ci = rho1 + rho * ki;   // 1−ρ+ρkᵢ  (> 0 since ρ < 1)

    // Per-cluster sums needed for Sherman-Morrison
    const WXX = Array.from({ length: p }, () => new Array(p).fill(0));
    const SX  = new Array(p).fill(0);
    const WXY = new Array(p).fill(0);
    let SY = 0;

    for (const s of clStudies) {
      const wj = 1 / s.vi;
      const sj = Math.sqrt(wj);
      const xj = xVec(s);
      SY += sj * s.yi;
      for (let r = 0; r < p; r++) {
        SX[r]  += sj * xj[r];
        WXY[r] += wj * xj[r] * s.yi;
        for (let c = 0; c < p; c++) WXX[r][c] += wj * xj[r] * xj[c];
      }
    }

    // Aᵢ and bᵢ via Sherman-Morrison
    for (let r = 0; r < p; r++) {
      bVec[r] += (WXY[r] - rho * SX[r] * SY / ci) / rho1;
      for (let c = 0; c < p; c++) {
        B[r][c] += (WXX[r][c] - rho * SX[r] * SX[c] / ci) / rho1;
      }
    }

    clList.push({ SX, ci, clStudies });
  }

  // --- Solve β̂ = B⁻¹·b ---
  const Binv = matInverse(B);
  if (Binv === null) return { error: "Design matrix is singular (collinear moderators?)." };

  const beta = Binv.map(row => row.reduce((acc, v, j) => acc + v * bVec[j], 0));

  // --- Second pass: sandwich meat M = Σ gᵢgᵢ' ---
  const Meat = Array.from({ length: p }, () => new Array(p).fill(0));

  for (const { SX, ci, clStudies } of clList) {
    const WXE = new Array(p).fill(0);
    let SE = 0;
    for (const s of clStudies) {
      const wj = 1 / s.vi;
      const sj = Math.sqrt(wj);
      const xj = xVec(s);
      const ej = s.yi - xj.reduce((acc, v, j) => acc + v * beta[j], 0);
      SE += sj * ej;
      for (let r = 0; r < p; r++) WXE[r] += wj * xj[r] * ej;
    }
    // gᵢ = (WXEᵢ − ρ/cᵢ · SXᵢ·SEᵢ) / (1−ρ)
    const gi = WXE.map((v, r) => (v - rho * SX[r] * SE / ci) / rho1);
    for (let r = 0; r < p; r++)
      for (let c = 0; c < p; c++) Meat[r][c] += gi[r] * gi[c];
  }

  // --- Sandwich covariance: V̂(β̂) = m/(m−1) · B⁻¹ · Meat · B⁻¹ ---
  const scale = m / (m - 1);
  // BinvMeat = Binv · Meat (p×p)
  const BinvMeat = Binv.map(row =>
    new Array(p).fill(0).map((_, c) => row.reduce((acc, v, j) => acc + v * Meat[j][c], 0))
  );
  // Vhat = BinvMeat · Binv (p×p)
  const Vhat = BinvMeat.map(row =>
    new Array(p).fill(0).map((_, c) => row.reduce((acc, v, j) => acc + v * Binv[j][c], 0))
  );

  // --- Build per-coefficient results ---
  const crit       = tCritical(df, alpha);
  const coefNames  = ["intercept", ...moderators];
  const coefs      = coefNames.map((name, i) => {
    const est_i = beta[i];
    const se_i  = Math.sqrt(Math.max(0, scale * Vhat[i][i]));
    const t_i   = se_i > 0 ? est_i / se_i : NaN;
    const p_i   = isFinite(t_i) ? 2 * (1 - tCDF(Math.abs(t_i), df)) : NaN;
    return { name, est: est_i, se: se_i, ci: [est_i - crit * se_i, est_i + crit * se_i], t: t_i, p: p_i };
  });

  // Top-level fields mirror the intercept for backward compatibility.
  const { est, se, ci, t, p: pval } = coefs[0];
  return { est, se, ci, t, p: pval, df, coefs, rho, kCluster: m, k };
}

// =============================================================================
// THREE-LEVEL META-ANALYSIS
// =============================================================================
//
// Model: studies nested within clusters (e.g. multiple outcomes per paper).
// Three variance components:
//   σ²ₑ — within-study sampling variance (known: vᵢⱼ)
//   σ²ᵤ — between-study-within-cluster (unknown, tau2_within)
//   σ²ₜ — between-cluster (unknown, tau2_between)
//
// Marginal covariance for cluster i (kᵢ studies):
//   Σᵢ = diag(vᵢⱼ + σ²ᵤ) + σ²ₜ · 1·1'
//
// Efficient inversion via Sherman-Morrison (rank-1 update of diagonal):
//   |Σᵢ| = (∏ⱼ dᵢⱼ) · (1 + σ²ₜ·Sdᵢ)    where dᵢⱼ = vᵢⱼ+σ²ᵤ,  Sdᵢ = Σⱼ 1/dᵢⱼ
//   1'·Σᵢ⁻¹·1   = Sdᵢ / denomᵢ            where denomᵢ = 1 + σ²ₜ·Sdᵢ
//   1'·Σᵢ⁻¹·yᵢ  = (Σⱼ yᵢⱼ/dᵢⱼ) / denomᵢ
//   r'·Σᵢ⁻¹·r   = Σⱼ rᵢⱼ²/dᵢⱼ − σ²ₜ·(Σⱼ rᵢⱼ/dᵢⱼ)² / denomᵢ
//
// Estimation by REML (default) or ML via BFGS in log-τ² space.
// Pooled mean μ̂ = Σᵢ (1'·Σᵢ⁻¹·yᵢ) / Σᵢ (1'·Σᵢ⁻¹·1)
// Var(μ̂) = 1 / Σᵢ (1'·Σᵢ⁻¹·1)
//
// References:
//   Cheung (2014). Modeling Dependent Effect Sizes with Three-Level Meta-Analyses.
//   Psychological Methods, 19(2), 211–229.
//   Van den Noortgate et al. (2013). Three-level meta-analysis. Behav Res Methods.
//
// Returns: { mu, se, ci, z, p, tau2_within, tau2_between, I2_within, I2_between,
//            Q, df, k, kCluster, logLik, convergence }
//
export function meta3level(studies, opts = {}) {
  const method = opts.method ?? "REML";
  const alpha  = opts.alpha  ?? 0.05;

  if (method !== "REML" && method !== "ML")
    return { error: `method must be "REML" or "ML" (got "${method}")` };
  if (!Array.isArray(studies) || studies.length < 3)
    return { error: "Three-level meta-analysis requires at least 3 studies" };

  // Group studies by cluster; singletons get a unique synthetic key.
  const clusterMap = groupByCluster(studies);
  const clusters = [...clusterMap.values()];
  const m = clusters.length;
  const k = studies.length;

  if (m < 2) return { error: "Three-level meta-analysis requires at least 2 clusters" };

  // ------------------------------------------------------------------
  // Concentrated log-likelihood at (tau2u, tau2t).
  // We marginalise out μ analytically, then return log L(τ²ᵤ, τ²ₜ | data).
  // The constant −k/2·log(2π) is omitted (cancels in optimisation).
  // ------------------------------------------------------------------
  function evalLL(tau2u, tau2t) {
    let W = 0, Wmu = 0, ll = 0;

    for (const cl of clusters) {
      let logdetD = 0, Sd = 0, Wyi = 0;
      for (const s of cl) {
        const dj = s.vi + tau2u;
        logdetD += Math.log(dj);
        Sd      += 1 / dj;
        Wyi     += s.yi / dj;
      }
      const denom = 1 + tau2t * Sd;
      if (denom <= 0) return -Infinity;
      ll   -= 0.5 * (logdetD + Math.log(denom));
      W    += Sd / denom;
      Wmu  += Wyi / denom;
    }

    if (!isFinite(W) || W <= 0) return -Infinity;
    const mu = Wmu / W;

    // Quadratic form: Σᵢ rᵢ'·Σᵢ⁻¹·rᵢ
    for (const cl of clusters) {
      let Sd = 0, rD = 0, rDone = 0;
      for (const s of cl) {
        const dj = s.vi + tau2u;
        const rj = s.yi - mu;
        Sd    += 1 / dj;
        rD    += rj * rj / dj;
        rDone += rj / dj;
      }
      const denom = 1 + tau2t * Sd;
      ll -= 0.5 * (rD - tau2t * rDone * rDone / denom);
    }

    // REML correction: subtract ½ log(Σᵢ 1'·Σᵢ⁻¹·1) = ½ log(W)
    if (method === "REML") ll -= 0.5 * Math.log(W);

    return isFinite(ll) ? ll : -Infinity;
  }

  // ------------------------------------------------------------------
  // BFGS minimisation in log-τ² space: x = [log(τ²ᵤ), log(τ²ₜ)]
  // ------------------------------------------------------------------
  function negLL(x) {
    const ll = evalLL(Math.exp(x[0]), Math.exp(x[1]));
    return ll === -Infinity ? 1e10 : -ll;
  }

  // Starting values: simple DL τ² split equally between components
  let W0 = 0, W02 = 0, Wmu0 = 0;
  for (const s of studies) {
    const w = 1 / s.vi;
    W0 += w; W02 += w * w; Wmu0 += w * s.yi;
  }
  const muFE0  = Wmu0 / W0;
  const Q0     = studies.reduce((a, s) => a + (s.yi - muFE0) ** 2 / s.vi, 0);
  const c0     = W0 - W02 / W0;
  const tau2DL = Math.max(0.01, (Q0 - (k - 1)) / c0);
  const x0     = [Math.log(tau2DL / 2), Math.log(tau2DL / 2)];

  const res   = bfgs(negLL, x0, { maxIter: 400, gtol: 1e-6 });
  const tau2u = Math.max(0, Math.exp(res.x[0]));
  const tau2t = Math.max(0, Math.exp(res.x[1]));

  // ------------------------------------------------------------------
  // Final pooled estimates at optimum (τ²ᵤ, τ²ₜ)
  // ------------------------------------------------------------------
  let W = 0, Wmu = 0;
  for (const cl of clusters) {
    let Sd = 0, Wyi = 0;
    for (const s of cl) {
      const dj = s.vi + tau2u;
      Sd  += 1 / dj;
      Wyi += s.yi / dj;
    }
    const denom = 1 + tau2t * Sd;
    W   += Sd / denom;
    Wmu += Wyi / denom;
  }
  const mu    = Wmu / W;
  const se    = 1 / Math.sqrt(Math.max(MIN_VAR, W));
  const zcrit = normalQuantile(1 - alpha / 2);
  const ci    = [mu - zcrit * se, mu + zcrit * se];
  const zval  = se > 0 ? mu / se : NaN;
  const pval  = isFinite(zval) ? 2 * (1 - normalCDF(Math.abs(zval))) : NaN;

  // ------------------------------------------------------------------
  // Heterogeneity: Q (fixed-effects) and decomposed I²
  // I² follows metafor convention: vi_typical = 1 / Σ(1/vᵢ)
  //   I²_within  = τ²ᵤ / (τ²ᵤ + τ²ₜ + vi_typical)
  //   I²_between = τ²ₜ / (τ²ᵤ + τ²ₜ + vi_typical)
  // ------------------------------------------------------------------
  const Q      = studies.reduce((a, s) => a + (s.yi - muFE0) ** 2 / s.vi, 0);
  const vi_typ = 1 / W0;  // 1 / Σ(1/vi)
  const tot    = tau2u + tau2t + vi_typ;
  const I2_within  = tot > 0 ? 100 * tau2u / tot : 0;
  const I2_between = tot > 0 ? 100 * tau2t / tot : 0;

  return {
    mu, se, ci, z: zval, p: pval,
    tau2_within:  tau2u,
    tau2_between: tau2t,
    I2_within, I2_between,
    Q, df: k - 1,
    k, kCluster: m,
    logLik: -res.fval,
    convergence: res.converged,
  };
}
