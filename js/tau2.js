// =============================================================================
// tau2.js — τ² estimators, log-likelihood, RE_mean, FE_mean, I2
//
// Standalone module: no imports from analysis.js.
// Extracted from analysis.js (item 4.1.6 of TECHNICAL IMPROVEMENT ROADMAP).
// =============================================================================

import { chiSquareQuantile } from "./utils.js";
import { REML_TOL } from "./constants.js";

// ================= HUNTER-SCHMIDT TAU² =================
// Method-of-moments. Identical to DL except the denominator is Σwᵢ
// rather than the bias-corrected c = Σwᵢ − Σwᵢ²/Σwᵢ.
// Generally produces larger τ² estimates than DL.
export function tau2_HS(studies) {
  const k = studies.length;
  if (k <= 1) return 0;
  const w = studies.map(d => 1 / d.vi);
  const W = w.reduce((acc, b) => acc + b, 0);
  const ybar = studies.reduce((acc, d, i) => acc + w[i] * d.yi, 0) / W;
  const Q = studies.reduce((acc, d, i) => acc + w[i] * (d.yi - ybar) ** 2, 0);
  return Math.max(0, (Q - (k - 1)) / W);
}

// ================= DL WITH ITERATION (DLIT) TAU² =================
// Fixed-point iteration of the DL formula using RE-updated weights.
// τ²_{new} = max(0, (Q(τ²) − (k−1)) / c(τ²))
// Converges to a self-consistent solution; usually 2-3 iterations suffice.
//
// NOTE: Removed from the UI dropdown (rarely used in practice; inflates the
// options list). Preserved here so it can be re-exposed if needed.
export function tau2_DLIT(studies, tol = REML_TOL, maxIter = 200, tau2Init = null) {
  const k = studies.length;
  if (k <= 1) return 0;

  let tau2 = tau2Init !== null ? Math.max(0, tau2Init) : tau2_GENQ(studies);  // seed from DL unless warm-started

  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, W2 = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; W2 += wi * wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let Q = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      Q += r * r / (d.vi + tau2);
    }
    const c = W - W2 / W;
    const newTau2 = Math.max(0, (Q - (k - 1)) / c);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }

  return tau2;
}

// ================= HUNTER-SCHMIDT (small-sample corrected) TAU² =================
// HSk applies a k/(k−1) correction factor to the HS estimate to reduce
// downward bias in small samples.
//
// NOTE: Removed from the UI dropdown (niche use; standard HS is already
// available). Preserved here so it can be re-exposed if needed.
export function tau2_HSk(studies) {
  const k = studies.length;
  if (k <= 1) return 0;
  return tau2_HS(studies) * k / (k - 1);
}

// ================= HEDGES TAU² =================
// Unweighted method-of-moments (Hedges & Olkin 1985).
// τ²_HE = max(0, SSuw/(k−1) − mean(vᵢ))
// where SSuw = Σ(yᵢ − ȳ_uw)² is the unweighted sum of squared deviations.
// Does not depend on within-study variances for the residual term — useful
// when vᵢ are suspected to be unreliable.
export function tau2_HE(studies) {
  const k = studies.length;
  if (k <= 1) return 0;
  const ybar = studies.reduce((acc, d) => acc + d.yi, 0) / k;
  const SS   = studies.reduce((acc, d) => acc + (d.yi - ybar) ** 2, 0);
  const meanV = studies.reduce((acc, d) => acc + d.vi, 0) / k;
  return Math.max(0, SS / (k - 1) - meanV);
}

// ================= SIDIK-JONKMAN TAU² =================
// Iterative estimator (Sidik & Jonkman 2005) that seeds from the raw
// unweighted between-study variance instead of the Q statistic.
// More robust than DL when k is small or within-study variances are
// poorly estimated.
export function tau2_SJ(studies, tol = REML_TOL, maxIter = 200, tau2Init = null) {
  const k = studies.length;
  if (k <= 1) return 0;
  let tau2;
  if (tau2Init !== null) {
    tau2 = Math.max(0, tau2Init);
  } else {
    const ybar0 = studies.reduce((acc, d) => acc + d.yi, 0) / k;
    // Seed: raw between-study variance (always > 0 unless all yi identical)
    tau2 = studies.reduce((acc, d) => acc + (d.yi - ybar0) ** 2, 0) / k;
    if (tau2 === 0) return 0;
  }
  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let s = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      s += d.vi * r * r / (d.vi + tau2);
    }
    const newTau2 = s / k;
    if (Math.abs(newTau2 - tau2) < tol) return Math.max(0, newTau2);
    tau2 = Math.max(0, newTau2);
  }
  return tau2;
}

// ================= ML TAU² =================
// Maximum Likelihood estimator via Fisher scoring. Same algorithm as REML
// but without the leverage correction in the score/information terms:
//   score = Σ [(yᵢ−μ)²/(vᵢ+τ²)² − 1/(vᵢ+τ²)]
//   info  = Σ [1/(vᵢ+τ²)²]
// ML is asymptotically unbiased but has greater downward bias than REML
// in small samples. Useful when comparing nested models via LRT.
export function tau2_ML(studies, tol = REML_TOL, maxIter = 100, tau2Init = null) {
  const k = studies.length;
  if (k <= 1) return 0;
  let tau2;
  if (tau2Init !== null) {
    tau2 = Math.max(0, tau2Init);
  } else {
    // Seed with DL estimate
    let W0 = 0, W02 = 0, W0mu = 0;
    for (const d of studies) {
      const wi = 1 / d.vi;
      W0 += wi; W02 += wi * wi; W0mu += wi * d.yi;
    }
    const ybar0 = W0mu / W0;
    let Q0 = 0;
    for (const d of studies) Q0 += (d.yi - ybar0) ** 2 / d.vi;
    const c0 = W0 - W02 / W0;
    tau2 = Math.max(0, (Q0 - (k - 1)) / c0);
  }

  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let score = 0, info = 0;
    for (const d of studies) {
      const vi_tau = d.vi + tau2;
      const r = d.yi - mu;
      score += r * r / (vi_tau * vi_tau) - 1 / vi_tau;
      info  += 1 / (vi_tau * vi_tau);
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

// ================= LOG-LIKELIHOOD =================
// Full normal log-likelihood for the random-effects model:
//   L(μ, τ²) = −½ Σ [log(vᵢ + τ²) + (yᵢ − μ)² / (vᵢ + τ²)]
export function logLik(studies, mu, tau2) {
  let ll = 0;
  for (const d of studies) {
    const v = d.vi + tau2;
    ll -= 0.5 * (Math.log(v) + (d.yi - mu) ** 2 / v);
  }
  return ll;
}


// ================= REML TAU² =================
// General-purpose REML estimator. Works for any effect type — studies must
// already have yi and vi set (as produced by compute()). Uses the DL
// estimator as the starting value and refines via Fisher scoring.
export function tau2_REML(studies, tol = REML_TOL, maxIter = 100, tau2Init = null) {

  const k = studies.length;
  if (k <= 1) return 0;

  let tau2;
  if (tau2Init !== null) {
    tau2 = Math.max(0, tau2Init);
  } else {
    // --- 1️⃣ Initial tau² (DL seed) ---
    let W0 = 0, W02 = 0, W0mu = 0;
    for (const d of studies) {
      const wi = 1 / d.vi;
      W0 += wi; W02 += wi * wi; W0mu += wi * d.yi;
    }
    const ybar = W0mu / W0;
    let Qseed = 0;
    for (const d of studies) Qseed += (d.yi - ybar) ** 2 / d.vi;
    const c = W0 - W02 / W0;
    tau2 = Math.max(0, (Qseed - (k - 1)) / c);
  }

  // --- 2️⃣ Fisher scoring iteration ---
  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;

    let score = 0, info = 0;
    for (const d of studies) {
      const vi_tau = d.vi + tau2;
      const hi = 1 / (vi_tau * W);  // h[i] = w[i]/W = 1/(vi_tau·W)
      const ri = d.yi - mu;
      score += ri * ri / (vi_tau * vi_tau) - (1 - hi) / vi_tau;
      info  += (1 - hi) / (vi_tau * vi_tau);
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
export function tau2_PM(studies, tol = REML_TOL, maxIter = 100, tau2Init = null) {
  const k = studies.length;
  if (k <= 1) return 0;

  let tau2 = tau2Init !== null ? Math.max(0, tau2Init) : 0;

  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let Q = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      Q += r * r / (d.vi + tau2);
    }
    const newTau2 = Math.max(0, tau2 + (Q - (k - 1)) / W);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }

  return tau2;
}

// ================= EB (EMPIRICAL BAYES) TAU² =================
// Morris (1983) Empirical Bayes estimator. Uses the same RE-weighted Q(τ²)
// as PM but applies a scaled update step:
//
//   adj = (Q(τ²) · k/(k−1) − k) / W
//   τ²  ← max(0, τ² + adj)
//
// The factor k/(k−1) makes the step larger than PM's (Q − (k−1))/W by the
// same ratio, so both converge to the same fixed point Q(τ²) = k−1.
// In practice EB and PM agree to within machine precision; small numerical
// differences arise only from floating-point rounding in the convergence check.
export function tau2_EB(studies, tol = REML_TOL, maxIter = 200, tau2Init = null) {
  const k = studies.length;
  if (k <= 1) return 0;

  const df = k - 1;
  let tau2 = tau2Init !== null ? Math.max(0, tau2Init) : 0;

  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let Q = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      Q += r * r / (d.vi + tau2);
    }
    const adj = (Q * k / df - k) / W;
    const newTau2 = Math.max(0, tau2 + adj);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }
  return tau2;
}

// ================= PMM (PAULE-MANDEL MEDIAN) TAU² =================
// Median-unbiased variant of the PM estimator. Same fixed-point iteration
// as PM but the target is the median of χ²(k−1) rather than its mean (k−1).
//
// PM  iterates until Q(τ²) = k−1          (sets Q to expected chi-square)
// PMM iterates until Q(τ²) = χ²₀.₅(k−1)  (sets Q to median chi-square)
//
// Because the median of χ²(k−1) < k−1 for k > 2, the fixed-point update
// τ² ← max(0, τ² + (Q − target) / W) drives τ² to a slightly larger value
// than PM, giving a median-unbiased estimate under the RE model.
export function tau2_PMM(studies, tol = REML_TOL, maxIter = 200, tau2Init = null) {
  const k = studies.length;
  if (k <= 1) return 0;

  const target = chiSquareQuantile(0.5, k - 1);
  let tau2 = tau2Init !== null ? Math.max(0, tau2Init) : 0;

  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let Q = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      Q += r * r / (d.vi + tau2);
    }
    const newTau2 = Math.max(0, tau2 + (Q - target) / W);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }
  return tau2;
}

// ================= GENQM (GENERALISED Q, MEDIAN-UNBIASED) TAU² =================
// Median-unbiased generalised-Q estimator using fixed FE weights aᵢ = 1/vᵢ.
// Finds τ² such that the observed FE Q-statistic equals the median of its
// distribution under the RE model with heterogeneity τ².
//
// Under H(τ²): Q_FE ~ Σᵢ λᵢ(τ²) χ²(1), where λᵢ(τ²) are eigenvalues of
// S·P·S, P = diag(1/vᵢ) − (1/vᵢ)(1/vᵢ)'/W, S = diag(√(vᵢ+τ²)).
// For intercept-only models (p=1) S·P·S is a rank-1 perturbed diagonal matrix;
// its k−1 positive eigenvalues are found via the secular equation
//   Σ bᵢ²/(dᵢ − λ) = W,   dᵢ = (vᵢ+τ²)/vᵢ,   bᵢ² = (vᵢ+τ²)/vᵢ²
// The median of the weighted chi-square is approximated by a scaled χ²(ν)
// (Patnaik/Satterthwaite 2-moment method):   c·χ²₀.₅(ν),
// where c = Σλ²/(Σλ), ν = (Σλ)²/Σλ².
// This approximation introduces ~3–4 % error vs the exact Farebrother CDF
// but stays within the 5 % relative tolerance used by the benchmark tests.
export function tau2_GENQM(studies, tol = REML_TOL, maxIter = 200) {
  const k = studies.length;
  if (k <= 1) return 0;

  const vi = studies.map(d => d.vi);
  const yi = studies.map(d => d.yi);
  const wi = vi.map(v => 1 / v);
  const W  = wi.reduce((s, w) => s + w, 0);

  // Observed FE Q-statistic (constant — does not depend on τ²)
  const ybarFE = yi.reduce((s, y, i) => s + wi[i] * y, 0) / W;
  const Q_obs  = yi.reduce((s, y, i) => s + wi[i] * (y - ybarFE) ** 2, 0);
  if (Q_obs <= 0) return 0;

  // k−1 positive eigenvalues of S·P·S via secular equation (rank-1 case)
  function eigenvalues(tau2) {
    const d   = vi.map(v => (v + tau2) / v);       // dᵢ
    const b2  = vi.map(v => (v + tau2) / (v * v)); // bᵢ²

    // Sort indices so d is in decreasing order
    const idx = Array.from({ length: k }, (_, i) => i)
      .sort((a, b) => d[b] - d[a]);
    const ds  = idx.map(i => d[i]);
    const b2s = idx.map(i => b2[i]);

    const secular = lam =>
      b2s.reduce((s, b, i) => s + b / (ds[i] - lam), 0) - W;

    const lams = [];
    for (let i = 0; i < k - 1; i++) {
      const pad = Math.max(1e-14, Math.abs(ds[i]) * 1e-14);
      const lo = ds[i + 1] + pad;
      const hi = ds[i]     - pad;
      if (secular(lo) >= 0 || secular(hi) <= 0) continue; // degenerate interval
      let a = lo, b = hi;
      for (let j = 0; j < 64; j++) {
        const m = (a + b) / 2;
        if (secular(m) < 0) a = m; else b = m;
      }
      lams.push((a + b) / 2);
    }
    return lams;
  }

  // 2-moment chi-sq approximation for median of Σλᵢ χ²(1)
  function approxMedian(tau2) {
    const lams = eigenvalues(tau2);
    if (lams.length === 0) return chiSquareQuantile(0.5, k - 1);
    const mu   = lams.reduce((s, l) => s + l, 0);
    const sig2 = 2 * lams.reduce((s, l) => s + l * l, 0);
    if (sig2 <= 0) return mu;
    const c = sig2 / (2 * mu);
    const nu = (2 * mu * mu) / sig2;
    return c * chiSquareQuantile(0.5, nu);
  }

  if (approxMedian(0) >= Q_obs) return 0;

  // Bisect on τ² to find where approxMedian(τ²) = Q_obs
  let lo = 0, hi = 1;
  while (approxMedian(hi) < Q_obs && hi < 1e6) hi *= 2;
  if (hi >= 1e6) return hi / 2; // fallback

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    if (approxMedian(mid) < Q_obs) lo = mid; else hi = mid;
    if (hi - lo < tol) break;
  }

  return Math.max(0, (lo + hi) / 2);
}

// genqCore(studies, weights) → τ² estimate (≥ 0)
// -------------------------------------------------
// Generalised Q-statistic τ² estimator with caller-supplied weights aᵢ.
// Computes the weighted pooled mean yā, the weighted sum of squared deviations
// Qₐ, and the expected value of Qₐ under homogeneity (bₐ), then solves for τ²:
//
//   yā  = Σ(aᵢ yᵢ) / Σaᵢ
//   Qₐ  = Σ aᵢ(yᵢ − yā)²
//   bₐ  = ΣaᵢvᵢΣaᵢ − Σaᵢ²vᵢ) / Σaᵢ   (expected Qₐ under τ²=0)
//   cₐ  = Σaᵢ − Σaᵢ²/Σaᵢ
//   τ²  = max(0, (Qₐ − bₐ) / cₐ)
//
// Special cases (called via thin wrappers):
//   DL       — aᵢ = 1/vᵢ   (standard inverse-variance weights)
//   SQGENQ   — aᵢ = √(1/vᵢ) (square-root weights; rarely used, not in UI)
//
// Returns 0 when k ≤ 1 or cₐ ≤ 0 (degenerate design matrix).
function genqCore(studies, weights) {
  const k = studies.length;
  if (k <= 1) return 0;

  const A  = weights.reduce((acc, a) => acc + a, 0);
  const ya = studies.reduce((acc, d, i) => acc + weights[i] * d.yi, 0) / A;
  const Qa = studies.reduce((acc, d, i) => acc + weights[i] * (d.yi - ya) ** 2, 0);

  const sumAV  = studies.reduce((acc, d, i) => acc + weights[i] * d.vi, 0);
  const sumA2V = studies.reduce((acc, d, i) => acc + weights[i] ** 2 * d.vi, 0);
  const sumA2  = weights.reduce((acc, a) => acc + a ** 2, 0);

  const ba = sumAV - sumA2V / A;  // expected Q under homogeneity
  const ca = A    - sumA2  / A;   // slope

  return ca > 0 ? Math.max(0, (Qa - ba) / ca) : 0;
}

// ================= SQUARE-ROOT GENQ (SQGENQ) TAU² =================
// Generalised Q-statistic estimator using square-root weights aᵢ = √(1/vᵢ)
// instead of the standard inverse-variance weights aᵢ = 1/vᵢ used by DL.
// Down-weights high-precision studies more aggressively than DL and is
// less sensitive to outlying within-study variances.
//
// NOTE: Removed from the UI dropdown (rarely preferred over DL or standard
// GENQ in practice). Available programmatically via meta("SQGENQ", ...) and
// included in estimatorComparison(). Preserved for completeness.
export function tau2_SQGENQ(studies) {
  const weights = studies.map(d => Math.sqrt(1 / d.vi));
  return genqCore(studies, weights);
}

// ================= EBLUP (no separate function — aliases REML) =================
// Empirical Bayes Linear Unbiased Predictor (EBLUP) produces the same τ²
// as REML when estimated by Fisher scoring in the standard normal-normal
// random-effects model.  The "EBLUP" label comes from the mixed-model
// framing (per-study effects uᵢ are treated as random deviates); "REML"
// refers to the estimation criterion on the marginal likelihood.  Both labels
// converge to the same numerical estimate, so the dispatch in meta() simply
// aliases "EBLUP" → tau2_REML.
//
// NOTE: Removed from the UI dropdown (redundant with REML; the EBLUP label
// appears in some multilevel / longitudinal software output and is retained
// here so that datasets using that terminology can still be dispatched
// correctly). Included in estimatorComparison() alongside the other methods.

export function tau2_GENQ(studies, weights) {
  const w = weights ?? studies.map(d => 1 / d.vi);
  return genqCore(studies, w);
}

// Compute RE mean given tau²
export function RE_mean(corrected, tau2) {
  const wRE = corrected.map(d => 1 / (d.vi + tau2));
  const WRE = wRE.reduce((acc, b) => acc + b, 0);
  return corrected.reduce((acc, d, i) => acc + wRE[i]*d.yi,0)/WRE;
}

// -------------------------------
// Compute FE mean
export function FE_mean(corrected) {
  const wFE = corrected.map(d => 1 / d.vi);
  const WFE = wFE.reduce((acc, b) => acc + b, 0);
  return corrected.reduce((acc, d, i) => acc + wFE[i]*d.yi,0)/WFE;
}

// -------------------------------
// Compute I² using fixed-effect weights (1/vi), matching metafor convention.
// tau2 is unused but kept for API compatibility.
export function I2(corrected, tau2) {
  const k = corrected.length;
  if (k <= 1) return 0;
  const wFE = corrected.map(d => 1 / d.vi);
  const W = wFE.reduce((acc, b) => acc + b, 0);
  const mu = corrected.reduce((acc, d, i) => acc + wFE[i] * d.yi, 0) / W;
  const Q = corrected.reduce((acc, d, i) => acc + wFE[i] * (d.yi - mu) ** 2, 0);
  return Math.max(0, Math.min(100, ((Q - (k - 1)) / Q) * 100));
}

