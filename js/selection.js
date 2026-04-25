// =============================================================================
// selection.js — Selection models and p-value-based publication-bias methods
// =============================================================================
// Extracted from analysis.js.  analysis.js re-exports everything via:
//   export * from "./selection.js";
//
// Exports
// -------
//   pCurve(studies)
//   pUniform(studies, m)
//   bfgs(f, x0, opts)
//   selIntervalProbs(mu, totalVar, se_i, zcuts, sides)
//   selIntervalIdx(yi, se_i, cuts, sides)
//   selectionLogLik(params, yi, vi, cuts, sides)
//   SEL_CUTS_ONE_SIDED
//   SEL_CUTS_TWO_SIDED
//   SELECTION_PRESETS
//   veveaHedges(studies, cuts, sides, fixedOmega)
//
// Dependencies
// ------------
//   analysis.js  meta(), logLik(), matInverse()
//   utils.js     normalCDF, normalQuantile
//   constants.js Z_95, BISECTION_ITERS

import { meta, logLik, matInverse } from "./analysis.js";
import { normalCDF, normalQuantile, chiSquareCDF } from "./utils.js";
import { Z_95, BISECTION_ITERS } from "./constants.js";

// ================ P-CURVE ANALYSIS ================
// pCurve(studies)
//
// Assesses the evidential value of a set of studies by examining the
// distribution of their significant p-values (Simonsohn, Nelson & Simmons,
// 2014, JPSP).
//
// Only studies with a two-tailed p-value < .05 are used; the p-values are
// derived from each study's z-statistic (z = |yi / se|).
//
// Two continuous tests are performed using pp-values — quantile
// transformations that should be Uniform(0,1) under each respective null:
//
//   Right-skew test (H₀: no effect, p-values uniform on [0,.05])
//     pp0ᵢ  = pᵢ / 0.05
//     Z     = (mean(pp0) − 0.5) × √(12k)
//     p     = Φ(Z)   [one-tailed left; evidence → small pp0s → negative Z]
//
//   Flatness test (H₃₃: studies powered at only 33% — insufficient evidence)
//     For a two-tailed z-test at power 33%, the noncentrality λ₃₃ satisfies
//       1 − Φ(1.96 − λ) + Φ(−1.96 − λ) = 0.33  →  λ₃₃ ≈ 0.8406
//     pp33ᵢ = P(p ≤ pᵢ | power = 33%) / 0.33
//           = ([1 − Φ(zᵢ − λ₃₃)] + Φ(−zᵢ − λ₃₃)) / 0.33
//     Z     = (mean(pp33) − 0.5) × √(12k)
//     p     = 1 − Φ(Z)  [one-tailed right; flatness → large pp33s → positive Z]
//
// Returns
// -------
//   k             — number of significant studies used
//   bins          — array of 5 objects { lo, hi, count, prop }
//                   boundaries: .00, .01, .02, .03, .04, .05
//   expected0     — expected proportion under H₀ (uniform): always 0.20
//   expected33    — array of 5 expected proportions under 33% power
//   rightSkewZ    — Z statistic for right-skew test
//   rightSkewP    — one-tailed p for right-skew test
//   flatnessZ     — Z statistic for flatness test
//   flatnessP     — one-tailed p for flatness test
//   verdict       — "evidential" | "no-evidential" | "inconclusive" | "insufficient"
export function pCurve(studies) {
  // ---- Step 1: derive p-values and keep only significant ones ----
  const sig = studies
    .filter(d => isFinite(d.yi) && isFinite(d.se) && d.se > 0)
    .map(d => {
      const z = Math.abs(d.yi / d.se);
      const p = 2 * (1 - normalCDF(z));
      return { z, p };
    })
    .filter(d => d.p < 0.05);

  const k = sig.length;

  // ---- Step 2: five-bin histogram ----
  const BIN_EDGES = [0, 0.01, 0.02, 0.03, 0.04, 0.05];
  const bins = BIN_EDGES.slice(0, 5).map((lo, i) => {
    const hi    = BIN_EDGES[i + 1];
    const count = sig.filter(d => d.p >= lo && d.p < hi).length;
    return { lo, hi, count, prop: k > 0 ? count / k : 0 };
  });

  // ---- Step 3: find λ₃₃ (noncentrality for 33% power, two-tailed z-test) ----
  // Solve: 1 − Φ(Z_95 − λ) + Φ(−Z_95 − λ) = 0.33 via bisection.
  const POWER_33  = 0.33;
  function power(lambda) {
    return (1 - normalCDF(Z_95 - lambda)) + normalCDF(-Z_95 - lambda);
  }
  let lo33 = 0, hi33 = 10;
  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo33 + hi33) / 2;
    power(mid) < POWER_33 ? (lo33 = mid) : (hi33 = mid);
  }
  const lambda33 = (lo33 + hi33) / 2;  // ≈ 0.8406

  // pp33 CDF: probability that p-value ≤ p, conditional on p < .05, under 33% power.
  // pp33(p) = ([1 − Φ(z_p − λ₃₃)] + Φ(−z_p − λ₃₃)) / POWER_33
  // where z_p = Φ⁻¹(1 − p/2)  (the z corresponding to a two-tailed p-value)
  function pp33CDF(p) {
    if (p <= 0) return 0;
    if (p >= 0.05) return 1;
    const zp = normalQuantile(1 - p / 2);
    return ((1 - normalCDF(zp - lambda33)) + normalCDF(-zp - lambda33)) / POWER_33;
  }

  // ---- Step 4: expected proportions under 33% power (for plot overlay) ----
  const expected33 = BIN_EDGES.slice(0, 5).map((lo, i) => {
    const hi = BIN_EDGES[i + 1];
    return pp33CDF(hi) - pp33CDF(lo);
  });

  // ---- Step 5: right-skew test (H₀: no effect) ----
  // pp0ᵢ = pᵢ / 0.05; under H₀ these are Uniform(0,1).
  let rightSkewZ = NaN, rightSkewP = NaN;
  if (k >= 1) {
    const pp0    = sig.map(d => d.p / 0.05);
    const mean0  = pp0.reduce((acc, b) => acc + b, 0) / k;
    rightSkewZ   = (mean0 - 0.5) * Math.sqrt(12 * k);
    rightSkewP   = normalCDF(rightSkewZ);  // one-tailed left
  }

  // ---- Step 6: flatness test (H₃₃: 33% power) ----
  // pp33ᵢ = pp33CDF(pᵢ); under H₃₃ these are Uniform(0,1).
  let flatnessZ = NaN, flatnessP = NaN;
  if (k >= 1) {
    const pp33   = sig.map(d => pp33CDF(d.p));
    const mean33 = pp33.reduce((acc, b) => acc + b, 0) / k;
    flatnessZ    = (mean33 - 0.5) * Math.sqrt(12 * k);
    flatnessP    = 1 - normalCDF(flatnessZ);  // one-tailed right
  }

  // ---- Step 7: verdict ----
  let verdict;
  if (k < 3) {
    verdict = "insufficient";
  } else if (rightSkewP < 0.05) {
    verdict = "evidential";
  } else if (flatnessP < 0.05) {
    verdict = "no-evidential";
  } else {
    verdict = "inconclusive";
  }

  return {
    k,
    bins,
    expected0:  0.20,
    expected33,
    rightSkewZ,
    rightSkewP,
    flatnessZ,
    flatnessP,
    verdict,
  };
}

// ================ P-UNIFORM (van Assen, van Aert & Wicherts, 2015) ================
// pUniform(studies, m)
//
// Bias-corrected effect estimate and two hypothesis tests using the conditional
// uniformity of p-values under the true effect size.
//
// Method overview
// ---------------
// For each significant study (two-tailed p < .05), the absolute z-statistic
// z_i = |yi / se_i| is computed, and the conditional quantile under a
// hypothesised effect δ is:
//
//   q_i(δ) = [1 − Φ(z_i − δ/se_i)] / [1 − Φ(1.96 − δ/se_i)]
//
// Interpretation: q_i is the probability that a study with the same SE would
// yield a p-value as small or smaller than p_i, given that it was significant
// and the true effect is δ.  Under the true δ, q_i ~ Uniform(0, 1).
//
// The denominator is the power of study i at effect δ; it is clamped at
// MIN_DENOM = 1e-10 to avoid division by zero at extreme negative δ.
//
// Because Σq_i(δ) is strictly increasing in δ, bisection solves for:
//   · effect estimate δ* : Σq_i(δ*) = k/2
//   · 95% CI lower bound  : Σq_i(δ_lo) = k/2 − 1.96 × √(k/12)
//   · 95% CI upper bound  : Σq_i(δ_hi) = k/2 + 1.96 × √(k/12)
//
// Two tests
// ---------
//   Significance test  (H₀: δ = 0)
//     Z_sig  = [Σq_i(0) − k/2] / √(k/12)
//     p_sig  = Φ(Z_sig)           [one-tailed left; evidence → Z < 0]
//
//   Publication-bias test  (H₀: no bias — RE estimate equals true effect)
//     Z_bias = [Σq_i(δ_RE) − k/2] / √(k/12)
//     p_bias = 1 − Φ(Z_bias)      [one-tailed right; bias → Z > 0]
//
// Parameters
// ----------
//   studies — full studies array (filtering to significant is done internally)
//   m       — meta() result object, used for m.RE (the RE estimate)
//
// Returns
// -------
//   k                — number of significant studies used
//   estimate         — bias-corrected point estimate δ* (NaN if not solvable)
//   ciLow, ciHigh    — 95% CI bounds (NaN if not solvable)
//   Z_sig, p_sig     — significance test
//   Z_bias, p_bias   — publication-bias test
//   significantEffect — p_sig  < .05
//   biasDetected      — p_bias < .05
export function pUniform(studies, m) {
  const MIN_DENOM  = 1e-10;  // clamp denominator to avoid division by near-zero power
  const SEARCH_LO  = -10;    // bisection search range for δ (covers any practical effect)
  const SEARCH_HI  =  10;

  // ---- Step 1: significant studies ----
  const sig = studies
    .filter(d => isFinite(d.yi) && isFinite(d.se) && d.se > 0)
    .map(d => ({
      z:  Math.abs(d.yi / d.se),   // fold to upper tail
      se: d.se,
    }))
    .filter(d => 2 * (1 - normalCDF(d.z)) < 0.05);

  const k = sig.length;

  // ---- Step 2: conditional quantile q_i(δ) for one study ----
  function qi(z, se, delta) {
    const lambda   = delta / se;
    const numer    = 1 - normalCDF(z    - lambda);
    const denom    = Math.max(1 - normalCDF(Z_95 - lambda), MIN_DENOM);
    return numer / denom;
  }

  // Σq_i(δ) — the aggregate target function, strictly increasing in δ.
  function sumQ(delta) {
    return sig.reduce((acc, d) => acc + qi(d.z, d.se, delta), 0);
  }

  // ---- Step 3: test statistics (computed regardless of k for completeness) ----
  const sdUnif = k > 0 ? Math.sqrt(k / 12) : NaN;

  const sq0   = k > 0 ? sumQ(0)    : NaN;
  const sqRE  = k > 0 ? sumQ(isFinite(m?.RE) ? m.RE : 0) : NaN;

  const Z_sig  = k > 0 ? (sq0  - k / 2) / sdUnif : NaN;
  const Z_bias = k > 0 ? (sqRE - k / 2) / sdUnif : NaN;

  const p_sig  = isFinite(Z_sig)  ? normalCDF(Z_sig)       : NaN;  // one-tailed left
  const p_bias = isFinite(Z_bias) ? 1 - normalCDF(Z_bias)  : NaN;  // one-tailed right

  // ---- Step 4: bisection helper ----
  // Finds δ such that sumQ(δ) = target.
  // Returns NaN if the target lies outside [sumQ(SEARCH_LO), sumQ(SEARCH_HI)].
  function bisectDelta(target) {
    const lo0 = sumQ(SEARCH_LO);
    const hi0 = sumQ(SEARCH_HI);
    if (target < lo0 || target > hi0) return NaN;
    let lo = SEARCH_LO, hi = SEARCH_HI;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      sumQ(mid) < target ? (lo = mid) : (hi = mid);
    }
    return (lo + hi) / 2;
  }

  // ---- Step 5: effect estimate and 95% CI ----
  let estimate = NaN, ciLow = NaN, ciHigh = NaN;
  if (k >= 1) {
    const half    = k / 2;
    const margin  = Z_95 * sdUnif;
    estimate = bisectDelta(half);
    ciLow    = bisectDelta(half - margin);
    ciHigh   = bisectDelta(half + margin);
  }

  return {
    k,
    estimate,
    ciLow,
    ciHigh,
    Z_sig,
    p_sig,
    Z_bias,
    p_bias,
    significantEffect: k >= 3 && isFinite(p_sig)  && p_sig  < 0.05,
    biasDetected:      k >= 3 && isFinite(p_bias) && p_bias < 0.05,
  };
}

// =============================================================================
// BFGS MINIMIZER
// =============================================================================
// Minimizes f: Rⁿ → R via the inverse-Hessian form of BFGS with a numerical
// central-difference gradient and Armijo backtracking line search.
//
// Parameters
// ----------
//   f    : objective function, accepts an array of length n, returns a scalar
//   x0   : starting point (array length n) — not modified
//   opts : optional overrides
//     maxIter  (default 400)  — maximum number of iterations
//     gtol     (default 1e-6) — gradient-norm convergence threshold
//     ftol     (default 1e-10)— |Δf| convergence threshold
//     c1       (default 1e-4) — Armijo sufficient-decrease constant
//
// Returns { x, fval, gnorm, iters, converged }
//   x         — best parameter vector found
//   fval      — f(x)
//   gnorm     — ‖∇f(x)‖ at return
//   iters     — iterations completed
//   converged — true if gnorm < gtol or |Δf| < ftol was satisfied
// =============================================================================
export function bfgs(f, x0, opts = {}) {
  const maxIter = opts.maxIter ?? 400;
  const gtol    = opts.gtol    ?? 1e-6;
  const ftol    = opts.ftol    ?? 1e-10;
  const c1      = opts.c1      ?? 1e-4;
  const n       = x0.length;

  // Central-difference numerical gradient
  function numGrad(x) {
    const g = new Array(n);
    for (let j = 0; j < n; j++) {
      const h = Math.max(1e-5, 1e-5 * Math.abs(x[j]));
      const xp = x.slice(); xp[j] += h;
      const xm = x.slice(); xm[j] -= h;
      g[j] = (f(xp) - f(xm)) / (2 * h);
    }
    return g;
  }

  // Symmetric matrix–vector product
  function mv(H, v) {
    const r = new Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        r[i] += H[i][j] * v[j];
    return r;
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  }

  function eye() {
    return Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0))
    );
  }

  let H    = eye();
  let x    = x0.slice();
  let fval = f(x);
  let g    = numGrad(x);

  let iters = 0;
  let converged = false;

  for (; iters < maxIter; iters++) {
    const gnorm = Math.sqrt(dot(g, g));
    if (gnorm < gtol) { converged = true; break; }

    // Search direction d = −Hg
    let d  = mv(H, g).map(v => -v);
    let dg = dot(d, g);

    // If d is not a descent direction, reset H to identity and use steepest descent
    if (dg >= 0) {
      H  = eye();
      d  = g.map(v => -v);
      dg = dot(d, g);
    }

    // Armijo backtracking line search
    let alpha    = 1.0;
    let xnew, fnew;
    let accepted = false;
    for (let sh = 0; sh < 60; sh++) {
      xnew = x.map((xi, j) => xi + alpha * d[j]);
      fnew = f(xnew);
      if (fnew <= fval + c1 * alpha * dg) { accepted = true; break; }
      alpha /= 2;
    }

    if (!accepted) break;   // line search failed — return best point so far

    const s    = d.map(v => v * alpha);
    const gnew = numGrad(xnew);
    const y    = gnew.map((gi, j) => gi - g[j]);

    const sy = dot(s, y);
    const ss = dot(s, s);
    const yy = dot(y, y);

    // BFGS inverse-Hessian update (skipped if curvature condition fails)
    if (sy > 1e-12 * Math.sqrt(ss * yy)) {
      const Hy  = mv(H, y);
      const yHy = dot(y, Hy);
      const rho = 1.0 / sy;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          H[i][j] += rho * ((1.0 + rho * yHy) * s[i] * s[j]
                            - s[i] * Hy[j] - Hy[i] * s[j]);
        }
      }
    }

    const fdiff = Math.abs(fval - fnew);
    x    = xnew;
    fval = fnew;
    g    = gnew;

    if (fdiff < ftol) { converged = true; iters++; break; }
  }

  return { x, fval, gnorm: Math.sqrt(dot(g, g)), iters, converged };
}

// =============================================================================
// SELECTION MODEL HELPERS
// =============================================================================

// selIntervalProbs — probability that study i's true effect falls in each
// selection interval, under the marginal distribution Y_i ~ N(mu, vi + tau²).
//
//   mu       : pooled mean
//   totalVar : vi + tau²  (marginal variance for study i)
//   se_i     : sqrt(vi)   (study i's standard error, used to define boundaries)
//   zcuts    : normal quantiles of the p-value cutpoints
//              zcuts[j] = Φ⁻¹(1 − cuts[j]);  length K (same as cuts)
//              zcuts[K-1] = Φ⁻¹(0) = −∞ (lower boundary of last interval)
//   sides    : 1 = one-sided p-values (default), 2 = two-sided
//
// Returns an array of K probabilities that sum to 1 (up to floating-point error).
//
// One-sided interval layout (K intervals, K-1 interior boundaries):
//   j=0     :  y ∈ [se_i·z₀,  +∞)           — smallest p-values
//   j=1..K-2:  y ∈ [se_i·zⱼ,  se_i·zⱼ₋₁)
//   j=K-1   :  y ∈ (−∞,        se_i·z_{K-2}) — largest p-values
export function selIntervalProbs(mu, totalVar, se_i, zcuts, sides) {
  const K  = zcuts.length;
  const sd = Math.sqrt(totalVar);
  const p  = new Array(K);

  if (sides === 1) {
    for (let j = 0; j < K; j++) {
      // Upper boundary in standardised units: +∞ for j=0, else se_i·z_{j-1}
      const hiZ = j === 0   ? Infinity  : (se_i * zcuts[j - 1] - mu) / sd;
      // Lower boundary: −∞ for j=K-1, else se_i·z_j
      const loZ = j === K - 1 ? -Infinity : (se_i * zcuts[j]     - mu) / sd;
      p[j] = Math.max(0, normalCDF(hiZ) - normalCDF(loZ));
    }
  } else {
    // Two-sided: p = 2·(1 − Φ(|y/se_i|)).
    // Interval j covers |y| ∈ [lo, hi):
    //   j=0:     |y| ∈ [se_i·z_0,    ∞)             — most significant
    //   j=1..K-2:|y| ∈ [se_i·z_j,    se_i·z_{j-1})
    //   j=K-1:   |y| ∈ [0,           se_i·z_{K-2})  — least significant
    // P(|Y| ∈ [lo, hi)) = P(|Y| ≥ lo) − P(|Y| ≥ hi)
    //   P(|Y| ≥ a) = Φ((−a−μ)/sd) + 1 − Φ((a−μ)/sd)
    for (let j = 0; j < K; j++) {
      const lo = j === K - 1 ? 0       : se_i * zcuts[j];
      const hi = j === 0     ? Infinity : se_i * zcuts[j - 1];
      const pLo = lo === 0        ? 1 : normalCDF((-lo - mu) / sd) + (1 - normalCDF((lo - mu) / sd));
      const pHi = hi === Infinity ? 0 : normalCDF((-hi - mu) / sd) + (1 - normalCDF((hi - mu) / sd));
      p[j] = Math.max(0, pLo - pHi);
    }
  }
  return p;
}

// selIntervalIdx — returns the interval index j (0-based) that study i belongs
// to, based on its observed p-value relative to the cutpoints array.
//
//   yi   : observed effect size for study i
//   se_i : standard error of study i
//   cuts : p-value cutpoints array, e.g. [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
//   sides: 1 (one-sided) or 2 (two-sided)
export function selIntervalIdx(yi, se_i, cuts, sides) {
  const pval = sides === 2
    ? 2 * (1 - normalCDF(Math.abs(yi / se_i)))
    : 1 - normalCDF(yi / se_i);
  for (let j = 0; j < cuts.length; j++) {
    if (pval <= cuts[j]) return j;
  }
  return cuts.length - 1;  // pval = 1.0 always lands in the last interval
}

// =============================================================================
// SELECTION MODEL LOG-LIKELIHOOD (Vevea-Hedges 1995)
// =============================================================================
// Computes the *negative* log-likelihood for minimisation (BFGS convention).
//
// Model: study i is observed with probability proportional to ω_j when its
// p-value falls in interval j.  The likelihood correction divides each study's
// density by the normalising constant c_i = Σ_j ω_j · P(Y_i ∈ interval j | μ, τ²+σᵢ²).
//
// Parameters vector layout:
//   params[0]       = μ            (pooled mean)
//   params[1]       = ρ            (log τ², i.e. τ² = exp(ρ))
//   params[2..K]    = α₁, …, α_{K-1}  (log relative weights; ω_j = exp(α_j),
//                                       ω₀ = 1 is the reference category)
//
// Arguments
//   params : parameter vector of length K+1 (K = cuts.length)
//   yi     : array of observed effect sizes (length n)
//   vi     : array of within-study variances (length n)
//   cuts   : p-value cutpoints, e.g. [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
//   sides  : 1 (one-sided, default) or 2 (two-sided)
//
// Identity: when all α_j = 0 (ω_j = 1 ∀j), c_i = 1 and log(ω_{j_i}) = 0, so
//   selectionLogLik([μ, log(τ²), 0,…,0], yi, vi, cuts) = −logLik(studies, μ, τ²)
export function selectionLogLik(params, yi, vi, cuts, sides = 1) {
  const K    = cuts.length;
  const mu   = params[0];
  const tau2 = Math.exp(params[1]);

  // Selection weights: ω₀ = 1 (reference), ω_j = exp(α_j) for j ≥ 1
  const omega = new Array(K);
  omega[0] = 1.0;
  for (let j = 1; j < K; j++) omega[j] = Math.exp(params[j + 1]);

  // Precompute normal quantiles of the cutpoints (reused across all studies)
  // One-sided: z_j = Φ⁻¹(1 − c_j)   (z such that P(Z > z) = c_j)
  // Two-sided: z_j = Φ⁻¹(1 − c_j/2) (z such that P(|Z| > z) = c_j)
  const zcuts = sides === 2
    ? cuts.map(c => normalQuantile(1 - c / 2))
    : cuts.map(c => normalQuantile(1 - c));

  let negLL = 0;
  for (let i = 0; i < yi.length; i++) {
    const se_i     = Math.sqrt(vi[i]);
    const totalVar = vi[i] + tau2;

    // Standard normal log-likelihood contribution (negated for minimisation)
    negLL += 0.5 * (Math.log(totalVar) + (yi[i] - mu) ** 2 / totalVar);

    // Normalising constant c_i = Σ_j ω_j · P(Y_i in interval j | μ, τ²+σᵢ²)
    const probs = selIntervalProbs(mu, totalVar, se_i, zcuts, sides);
    let c_i = 0;
    for (let j = 0; j < K; j++) c_i += omega[j] * probs[j];
    if (c_i <= 0) return Infinity;   // degenerate — all weight on empty intervals

    // Selection term: log(ω_{j_i}) − log(c_i)
    const j_i = selIntervalIdx(yi[i], se_i, cuts, sides);
    negLL -= Math.log(omega[j_i]);
    negLL += Math.log(c_i);
  }
  return negLL;
}

// =============================================================================
// VEVEA-HEDGES SELECTION MODEL — full API
// =============================================================================

// Default p-value cutpoints (one-sided or two-sided).
// Each entry is an upper boundary; the last entry must be 1.0.
// K = cuts.length defines the number of selection intervals.
// The first interval [0, cuts[0]) carries ω₀ = 1 (reference weight).
export const SEL_CUTS_ONE_SIDED = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0];
export const SEL_CUTS_TWO_SIDED = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0];

// =============================================================================
// SELECTION_PRESETS — named fixed-weight sensitivity presets
// =============================================================================
// Follows Vevea & Woods (2005) Table 1 and JASP conventions.
// Each preset specifies a fixed ω vector and the corresponding p-value
// cutpoints and sidedness.  ω[0] = 1 is the reference interval (most
// significant); ω[j] < 1 means studies in that interval are under-represented
// relative to the reference.
//
// These are used for sensitivity analysis: ω is held fixed, and only μ and τ²
// are estimated via veveaHedges().  The "1" suffix → one-sided p-values;
// the "2" suffix → two-sided p-values.
//
// Reference cuts for all presets: [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
// =============================================================================
export const SELECTION_PRESETS = {
  // ---- One-sided ----
  mild1: {
    label:  "Mild (one-sided)",
    sides:  1,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 1, 0.75, 0.75, 0.5, 0.25],
  },
  moderate1: {
    label:  "Moderate (one-sided)",
    sides:  1,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 0.9, 0.5, 0.3, 0.2, 0.1],
  },
  severe1: {
    label:  "Severe (one-sided)",
    sides:  1,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 0.5, 0.1, 0.1, 0.05, 0.01],
  },
  // ---- Two-sided ----
  mild2: {
    label:  "Mild (two-sided)",
    sides:  2,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 1, 0.75, 0.75, 0.5, 0.25],
  },
  moderate2: {
    label:  "Moderate (two-sided)",
    sides:  2,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 0.9, 0.5, 0.3, 0.2, 0.1],
  },
};

// numericalHessian — central-difference second-order approximation of the
// Hessian matrix of f at x, given f(x) = fval.
// Step h_j = max(1e-4, 1e-4·|x_j|) for each dimension j.
// Used to compute the observed Fisher information for standard errors.
function numericalHessian(f, x, fval) {
  const n = x.length;
  const h = x.map(v => Math.max(1e-4, 1e-4 * Math.abs(v)));
  const H = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    // Diagonal: (f(x+hᵢeᵢ) − 2f(x) + f(x−hᵢeᵢ)) / hᵢ²
    const xp = x.slice(); xp[i] += h[i];
    const xm = x.slice(); xm[i] -= h[i];
    H[i][i] = (f(xp) - 2 * fval + f(xm)) / (h[i] * h[i]);

    // Off-diagonal (upper triangle, symmetrised):
    // (f(x+hᵢeᵢ+hⱼeⱼ) − f(x+hᵢeᵢ−hⱼeⱼ) − f(x−hᵢeᵢ+hⱼeⱼ) + f(x−hᵢeᵢ−hⱼeⱼ)) / (4hᵢhⱼ)
    for (let j = i + 1; j < n; j++) {
      const xpp = x.slice(); xpp[i] += h[i]; xpp[j] += h[j];
      const xpm = x.slice(); xpm[i] += h[i]; xpm[j] -= h[j];
      const xmp = x.slice(); xmp[i] -= h[i]; xmp[j] += h[j];
      const xmm = x.slice(); xmm[i] -= h[i]; xmm[j] -= h[j];
      const hij = (f(xpp) - f(xpm) - f(xmp) + f(xmm)) / (4 * h[i] * h[j]);
      H[i][j] = hij;
      H[j][i] = hij;
    }
  }
  return H;
}

// =============================================================================
// veveaHedges(studies, cuts, sides)
// =============================================================================
// Fits the Vevea-Hedges (1995) step-function weight model for publication bias.
//
// The model assumes study i is observed with probability proportional to ω_{j(i)},
// where j(i) is determined by the study's one-sided (or two-sided) p-value and
// the cutpoint vector cuts.  ω₀ = 1 is the reference; ωⱼ = exp(αⱼ) for j ≥ 1.
//
// Parameters:
//   studies — array of { yi, vi } objects
//   cuts    — K-element array of p-value upper boundaries; last entry must be 1.0
//             Default: SEL_CUTS_ONE_SIDED = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
//   sides   — 1 (one-sided, default) or 2 (two-sided)
//
// Returns:
//   mu, se_mu, zval_mu, pval_mu, ci_mu
//     Pooled mean and inference on the selection-model adjusted estimate.
//   tau2, se_tau2
//     Between-study variance (τ²) and its SE (delta method on log scale).
//   omega[K], se_omega[K]
//     Selection weights on natural scale (ω₀ = 1 fixed; se_omega[0] = NaN).
//   alpha[K], se_alpha[K]
//     Log selection weights (α₀ = 0 fixed; se_alpha[0] = NaN).
//   logLikSel    — log-likelihood of the selection model at MLE
//   logLikUnsel  — log-likelihood of the unweighted ML model (for LRT comparison)
//   LRT, LRTdf, LRTp
//     Likelihood ratio test: H₀: all ωⱼ = 1 (no selection); χ²(K−1).
//   RE_unsel, tau2_unsel, ciLow_unsel, ciHigh_unsel
//     Unweighted RE estimate and 95% CI (for display alongside corrected estimate).
//   converged, iters    — BFGS convergence status
//   cuts, sides, k, K   — configuration and study count
//   nPerInterval[K]     — observed study count per selection interval
// =============================================================================
// veveaHedges(studies, cuts, sides, fixedOmega)
//
// fixedOmega — optional K-element array of fixed selection weights for
//   sensitivity analysis (Vevea & Woods 2005).  When provided, only μ and τ²
//   are estimated; the selection weights are held at the specified values and
//   no LRT is computed.  When null (default), all parameters are estimated
//   by MLE (full Vevea-Hedges model).
export function veveaHedges(studies, cuts = SEL_CUTS_ONE_SIDED, sides = 1, fixedOmega = null) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  const K = cuts.length;

  // Minimum k: fixed-omega needs k≥3 (2 free params); MLE needs k≥K+2
  const isFixed = fixedOmega !== null;
  const minK    = isFixed ? 3 : K + 2;
  if (k < minK) {
    return {
      error: "insufficient_k", k, K, minK,
      mu: NaN, tau2: NaN,
      omega: new Array(K).fill(NaN), se_omega: new Array(K).fill(NaN),
      LRT: NaN, LRTdf: NaN, LRTp: NaN,
      converged: false,
    };
  }

  const yi = valid.map(s => s.yi);
  const vi = valid.map(s => s.vi);

  // ---- Unweighted ML model (starting values and LRT baseline) ----
  const mUnsel      = meta(valid, "ML");
  const logLikUnsel = logLik(valid, mUnsel.RE, mUnsel.tau2);

  // ---- Shared helper: invert Hessian with progressive ridge fallback ----
  function invertHess(H, fval, f2) {
    // Recompute H with fresh fval to avoid stale-fval bugs
    const hess = numericalHessian(f2, H, fval);
    let inv = matInverse(hess);
    if (inv === null) {
      for (const lam of [1e-8, 1e-6, 1e-4, 1e-2, 1, 10]) {
        const ridge = hess.map((row, i) => row.map((v, j) => i === j ? v + lam : v));
        inv = matInverse(ridge);
        if (inv !== null) break;
      }
    }
    return { hess, inv };
  }

  function getSE(hess, inv, j) {
    if (inv !== null && inv[j][j] > 0) return Math.sqrt(inv[j][j]);
    return hess[j][j] > 0 ? 1 / Math.sqrt(hess[j][j]) : NaN;
  }

  // ---- Study counts per selection interval (same for both branches) ----
  const nPerInterval = new Array(K).fill(0);
  for (let i = 0; i < k; i++)
    nPerInterval[selIntervalIdx(yi[i], Math.sqrt(vi[i]), cuts, sides)]++;

  // ==========================================================================
  // FIXED-OMEGA BRANCH (sensitivity analysis)
  // ==========================================================================
  if (isFixed) {
    const fixedAlpha = fixedOmega.map(w => Math.log(Math.max(w, 1e-15)));
    // Wrap selectionLogLik to only expose [mu, rho] as free parameters
    const f2 = x => selectionLogLik(
      [x[0], x[1], ...fixedAlpha.slice(1)], yi, vi, cuts, sides
    );

    const x0     = [mUnsel.RE, Math.log(Math.max(mUnsel.tau2, 1e-9))];
    const result = bfgs(f2, x0);
    const [mu_fit, rho_fit] = result.x;
    const mu    = mu_fit;
    const tau2  = Math.exp(rho_fit);
    const alpha = fixedAlpha;
    const omega = fixedOmega.slice();
    const logLikSel = -result.fval;

    const { hess, inv } = invertHess(result.x, result.fval, f2);
    const se_mu   = getSE(hess, inv, 0);
    const se_rho  = getSE(hess, inv, 1);
    const se_tau2 = isFinite(se_rho) ? tau2 * se_rho : NaN;
    // Weights are fixed — no SEs
    const se_omega = new Array(K).fill(NaN);
    const se_alpha = new Array(K).fill(NaN);

    const zval_mu = mu / se_mu;
    const pval_mu = 2 * (1 - normalCDF(Math.abs(zval_mu)));
    const ci_mu   = [mu - Z_95 * se_mu, mu + Z_95 * se_mu];

    return {
      mu, se_mu, zval_mu, pval_mu, ci_mu,
      tau2, se_tau2,
      omega, se_omega,
      alpha, se_alpha,
      logLikSel, logLikUnsel,
      LRT: NaN, LRTdf: K - 1, LRTp: NaN,
      RE_unsel: mUnsel.RE, tau2_unsel: mUnsel.tau2,
      ciLow_unsel: mUnsel.ciLow, ciHigh_unsel: mUnsel.ciHigh,
      converged: result.converged, iters: result.iters,
      cuts, sides, k, K, nPerInterval,
      fixed: true,
    };
  }

  // ==========================================================================
  // MLE BRANCH (estimate all parameters)
  // ==========================================================================

  // ---- Identify free alpha indices: non-reference intervals with ≥1 study ----
  // alpha[0] is always fixed at 0 (reference); alpha[j] for j≥1 is free only
  // when nPerInterval[j] > 0.  Empty intervals are fixed at alpha=0 (ω=1).
  const freeIdx = [];
  for (let j = 1; j < K; j++) {
    if (nPerInterval[j] > 0) freeIdx.push(j);
  }
  const nFree = freeIdx.length;

  // ---- Unidentifiable guard: reference interval (j=0) has no studies ----
  // When nPerInterval[0]=0, there are no studies to anchor the selection scale,
  // making the likelihood unbounded as ω→∞.  Return the unweighted ML result
  // with all ω fixed at 1 and the LRT undefined (df=0, p=1).
  if (nPerInterval[0] === 0) {
    const alpha0 = new Array(K).fill(0);
    const omega0 = new Array(K).fill(1);
    const zval_mu0 = mUnsel.RE / mUnsel.se;
    const pval_mu0 = 2 * (1 - normalCDF(Math.abs(zval_mu0)));
    return {
      mu: mUnsel.RE, se_mu: mUnsel.se, zval_mu: zval_mu0, pval_mu: pval_mu0,
      ci_mu: [mUnsel.ciLow, mUnsel.ciHigh],
      tau2: mUnsel.tau2, se_tau2: NaN,
      omega: omega0, se_omega: new Array(K).fill(NaN),
      alpha: alpha0, se_alpha: new Array(K).fill(NaN),
      logLikSel: logLikUnsel, logLikUnsel,
      LRT: 0, LRTdf: 0, LRTp: 1,
      RE_unsel: mUnsel.RE, tau2_unsel: mUnsel.tau2,
      ciLow_unsel: mUnsel.ciLow, ciHigh_unsel: mUnsel.ciHigh,
      converged: true, iters: 0,
      cuts, sides, k, K, nFree: 0,
      nPerInterval, freeIdx: [],
      fixed: false,
      referenceEmpty: true,
    };
  }

  // ---- Wrapper: reduced param vector → full selectionLogLik call ----
  // Reduced: [mu, rho, alpha[freeIdx[0]], alpha[freeIdx[1]], ...]
  // Fixed (empty-interval) alphas stay at 0.
  const f = x => {
    const fullAlpha = new Array(K).fill(0);
    for (let fi = 0; fi < nFree; fi++) fullAlpha[freeIdx[fi]] = x[fi + 2];
    return selectionLogLik([x[0], x[1], ...fullAlpha.slice(1)], yi, vi, cuts, sides);
  };

  // ---- Multi-start BFGS: try 3 alpha initializations, keep best fval ----
  // Multi-start only when the reference interval (j=0) has ≥1 study; when it is
  // empty the model is unidentifiable and extreme starting points produce
  // degenerate (spuriously high-likelihood) solutions.
  const mu0  = mUnsel.RE;
  const rho0 = Math.log(Math.max(mUnsel.tau2, 1e-9));
  const alphaInits = nPerInterval[0] > 0
    ? [
        new Array(nFree).fill(0),               // ω = 1
        new Array(nFree).fill(Math.log(0.5)),   // ω = 0.5
        new Array(nFree).fill(Math.log(0.1)),   // ω = 0.1
      ]
    : [ new Array(nFree).fill(0) ];             // single start: reference is empty
  let result = null;
  for (const aInit of alphaInits) {
    const r = bfgs(f, [mu0, rho0, ...aInit]);
    if (result === null || r.fval < result.fval) result = r;
  }
  const params = result.x;

  // ---- Reconstruct full-length alpha and omega arrays ----
  const mu   = params[0];
  const tau2 = Math.exp(params[1]);
  const alpha = new Array(K).fill(0);  // alpha[0]=0 (reference); empty intervals=0
  for (let fi = 0; fi < nFree; fi++) alpha[freeIdx[fi]] = params[fi + 2];
  const omega = alpha.map(a => Math.exp(a));

  const logLikSel = -result.fval;

  // ---- Standard errors via numerical observed Fisher information ----
  // Hessian is over the reduced param space (only free indices).  Empty
  // intervals contribute no information, so their SEs remain NaN.
  const { hess: hessMat, inv: hessInv } = invertHess(params, result.fval, f);

  const se_mu  = getSE(hessMat, hessInv, 0);
  const se_rho = getSE(hessMat, hessInv, 1);   // SE of log(τ²)

  const se_alpha = new Array(K).fill(NaN);     // NaN for reference and empty intervals
  for (let fi = 0; fi < nFree; fi++) se_alpha[freeIdx[fi]] = getSE(hessMat, hessInv, fi + 2);

  // Delta method: SE(τ²) = τ² · SE(log τ²); SE(ωⱼ) = ωⱼ · SE(αⱼ)
  const se_tau2  = isFinite(se_rho) ? tau2 * se_rho : NaN;
  const se_omega = omega.map((w, j) => j === 0 ? NaN : (isFinite(se_alpha[j]) ? w * se_alpha[j] : NaN));

  // ---- Inference on mu ----
  const zval_mu = mu / se_mu;
  const pval_mu = 2 * (1 - normalCDF(Math.abs(zval_mu)));
  const ci_mu   = [mu - Z_95 * se_mu, mu + Z_95 * se_mu];

  // ---- Likelihood ratio test: H₀: all ωⱼ = 1 ----
  // df = nFree (free alpha params only; empty intervals excluded from test)
  const lrt_stat = 2 * (logLikSel - logLikUnsel);
  const lrt_df   = nFree;
  const lrt_p    = lrt_df > 0 && lrt_stat > 0
    ? 1 - chiSquareCDF(lrt_stat, lrt_df)
    : (lrt_stat <= 0 ? 1 : NaN);

  return {
    // Corrected pooled estimate
    mu, se_mu, zval_mu, pval_mu, ci_mu,

    // Between-study variance
    tau2, se_tau2,

    // Selection weights (natural scale and log scale)
    omega, se_omega,
    alpha, se_alpha,

    // Log-likelihoods
    logLikSel,
    logLikUnsel,

    // Likelihood ratio test
    LRT: lrt_stat, LRTdf: lrt_df, LRTp: lrt_p,

    // Unweighted ML model for side-by-side display
    RE_unsel:    mUnsel.RE,
    tau2_unsel:  mUnsel.tau2,
    ciLow_unsel: mUnsel.ciLow,
    ciHigh_unsel: mUnsel.ciHigh,

    // Optimiser diagnostics
    converged: result.converged,
    iters:     result.iters,

    // Configuration and counts
    cuts, sides, k, K, nFree,
    nPerInterval, freeIdx,
    fixed: false,
  };
}
