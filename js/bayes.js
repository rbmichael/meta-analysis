// =============================================================================
// bayes.js — Profile likelihood and Bayesian meta-analysis
// =============================================================================
// Extracted from analysis.js.  analysis.js re-exports everything via:
//   export * from "./bayes.js";
//
// Exports
// -------
//   profileLikCI(studies, alpha)
//   profileLikTau2(studies, opts)
//   bayesMeta(studies, opts)
//   priorSensitivity(studies, opts)
//
// Dependencies
// ------------
//   tau2.js      logLik(), tau2_REML(), tau2_ML()  [no circular dep]
//   utils.js     chiSquareQuantile
//   constants.js REML_TOL, BISECTION_ITERS, MIN_VAR

import { logLik, tau2_REML, tau2_ML } from "./tau2.js";
import { chiSquareQuantile } from "./utils.js";
import { REML_TOL, BISECTION_ITERS, MIN_VAR } from "./constants.js";

// ================= PROFILE TAU² =================
// For a fixed pooled mean μ, find τ² ≥ 0 that maximises L(μ, τ²).
// Solves the 1-D score equation via bisection:
//   score(τ²) = ½ Σ [(yᵢ−μ)²/(vᵢ+τ²)² − 1/(vᵢ+τ²)] = 0
// The score is monotonically decreasing in τ², so bisection is reliable.
function profileTau2(studies, mu, tol = REML_TOL) {
  function score(t2) {
    let s = 0;
    for (const d of studies) {
      const v = d.vi + t2;
      s += (d.yi - mu) ** 2 / (v * v) - 1 / v;
    }
    return s;
  }

  // If score at boundary ≤ 0, the maximum is at τ² = 0.
  if (score(0) <= 0) return 0;

  // Find an upper bound where the score is negative.
  let hi = 1;
  while (score(hi) > 0) hi *= 2;

  // Bisect.
  let lo = 0;
  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (score(mid) > 0) lo = mid; else hi = mid;
    if (hi - lo < tol) break;
  }
  return (lo + hi) / 2;
}

// ================= PROFILE LIKELIHOOD CI =================
// CI for the pooled mean μ by inverting the likelihood ratio test:
//   { μ : 2[L(μ̂,τ̂²) − L_p(μ)] ≤ χ²_{1,1−α} }
// where L_p(μ) = L(μ, profileTau2(μ)).
// Always uses ML internally regardless of the selected τ² estimator.
// Returns [lower, upper].
export function profileLikCI(studies, alpha = 0.05) {
  const k = studies.length;
  if (k <= 1) return [NaN, NaN];

  const tau2ml = tau2_ML(studies);
  const w      = studies.map(d => 1 / (d.vi + tau2ml));
  const W      = w.reduce((acc, b) => acc + b, 0);
  const muHat  = studies.reduce((acc, d, i) => acc + w[i] * d.yi, 0) / W;
  const lMax   = logLik(studies, muHat, tau2ml);
  const cutoff = chiSquareQuantile(1 - alpha, 1) / 2;  // ½ χ²_{1,1−α}

  // plObj(mu) > 0 inside the CI, < 0 outside.
  function plObj(mu) {
    return logLik(studies, mu, profileTau2(studies, mu)) - (lMax - cutoff);
  }

  // Half-width of the search bracket: start at the Wald SE and expand if needed.
  const seApprox = Math.sqrt(1 / W);
  function findBound(sign) {
    let delta = 2 * seApprox;
    while (plObj(muHat + sign * delta) > 0) delta *= 2;
    let lo = 0, hi = delta;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      if (plObj(muHat + sign * mid) > 0) lo = mid; else hi = mid;
    }
    return muHat + sign * (lo + hi) / 2;
  }

  return [findBound(-1), findBound(+1)];
}

// ================= PROFILE LIKELIHOOD FOR τ² =================
// Computes the profile log-likelihood curve L_p(τ²) by substituting the
// closed-form RE mean μ̂(τ²) = Σwᵢyᵢ / Σwᵢ (wᵢ = 1/(vᵢ+τ²)) at each τ².
//
// For ML:   L_p(τ²) = −½ Σ[log(vᵢ+τ²) + (yᵢ−μ̂)²/(vᵢ+τ²)]
// For REML: L_p(τ²) = L_ML(τ²) − ½ log(Σwᵢ)
//
// The 95% CI for τ² is the set where 2(lMax − L_p(τ²)) ≤ χ²(1, 0.95),
// found by bisection. The lower bound is clipped to 0.
export function profileLikTau2(studies, opts = {}) {
  const k      = studies.length;
  const method = opts.method !== undefined ? opts.method : "REML";
  const nGrid  = opts.nGrid  !== undefined ? opts.nGrid  : 200;
  const alpha  = opts.alpha  !== undefined ? opts.alpha  : 0.05;

  if (k < 2)
    return { error: "Profile likelihood requires at least 2 studies (got " + k + ")" };
  if (method !== "ML" && method !== "REML")
    return { error: 'method must be "ML" or "REML" (got "' + method + '")' };

  function evalProfile(tau2) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const w = 1 / (d.vi + tau2);
      W   += w;
      Wmu += w * d.yi;
    }
    const mu = Wmu / W;
    let ll = logLik(studies, mu, tau2);
    if (method === "REML") ll -= 0.5 * Math.log(W);
    return ll;
  }

  const tau2hat = method === "REML" ? tau2_REML(studies) : tau2_ML(studies);
  const lMax    = evalProfile(tau2hat);
  const chi2thresh = chiSquareQuantile(1 - alpha, 1);
  const lCrit   = lMax - chi2thresh / 2;

  // ---- Find upper bracket: double from max(4*tau2hat, 0.5) until well below lCrit ----
  let hi = Math.max(tau2hat * 4, 0.5);
  while (evalProfile(hi) > lCrit - 4) hi *= 2;

  // ---- CI lower bound ----
  let ciLow;
  if (evalProfile(0) >= lCrit) {
    ciLow = 0;
  } else {
    // Bisect on [0, tau2hat]: find root of evalProfile(t) - lCrit = 0
    let lo = 0, bhi = tau2hat;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + bhi) / 2;
      if (evalProfile(mid) >= lCrit) bhi = mid; else lo = mid;
    }
    ciLow = (lo + bhi) / 2;
  }

  // ---- CI upper bound: bisect on [tau2hat, hi] ----
  let ciHigh;
  {
    let lo = tau2hat, bhi = hi;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + bhi) / 2;
      if (evalProfile(mid) >= lCrit) lo = mid; else bhi = mid;
    }
    ciHigh = (lo + bhi) / 2;
  }

  // ---- Build grid from 0 to hi, compute shifted log-likelihood ----
  const grid = new Float64Array(nGrid);
  const ll   = new Float64Array(nGrid);
  const step = hi / (nGrid - 1);
  for (let i = 0; i < nGrid; i++) {
    const t  = i * step;
    grid[i]  = t;
    ll[i]    = evalProfile(t) - lMax;   // shifted so peak = 0
  }

  return {
    grid,
    ll,
    tau2hat,
    lMax,
    lCrit,
    lCritRel: lCrit - lMax,             // ≈ −1.921 for 95%
    ciLow,
    ciHigh,
    method,
    k,
    alpha,
  };
}

// ================= BAYESIAN META-ANALYSIS =================
// Conjugate normal-normal random-effects model approximated by a 1-D grid
// over τ.  Integrating μ out at each grid point is analytic (conjugate
// normal prior), so no MCMC or 2-D quadrature is needed.
//
// Prior:    μ | μ₀, σ_μ  ~ N(μ₀, σ_μ²)
//           τ             ~ HalfNormal(0, σ_τ)
//
// At each grid point τ_g the conditional posterior of μ is:
//   p(μ | τ_g, y) = N(m_g, V_g)
//   P_g = 1/σ_μ² + Σ 1/(vᵢ+τ_g²)
//   m_g = [μ₀/σ_μ² + Σ yᵢ/(vᵢ+τ_g²)] / P_g
//   V_g = 1 / P_g
//
// Log unnormalised grid weight:
//   log w_g = logML_g + logPrior_g
//   logML_g = ½[log(V_g) − log(σ_μ²) − Σ log(vᵢ+τ_g²)]
//             − ½[Σ yᵢ²/(vᵢ+τ_g²) + μ₀²/σ_μ² − precYmu² · V_g]
//   logPrior_g = −τ_g² / (2 σ_τ²)   (constants that cancel are dropped)
//
// The marginal posterior of μ is a mixture of Gaussians:
//   p(μ | y) = Σ_g w_g · N(μ; m_g, V_g)
export function bayesMeta(studies, opts = {}) {
  const k         = studies.length;
  const mu0       = opts.mu0       !== undefined ? opts.mu0       : 0;
  const sigma_mu  = opts.sigma_mu  !== undefined ? opts.sigma_mu  : 1;
  const sigma_tau = opts.sigma_tau !== undefined ? opts.sigma_tau : 0.5;
  const alpha     = opts.alpha     !== undefined ? opts.alpha     : 0.05;
  // Grid density adapts to k: coarser grid for large k (smooth posterior).
  // Manual overrides via opts.nGrid / opts.nMu are respected.
  const nGrid = opts.nGrid !== undefined ? opts.nGrid
    : Math.round(Math.max(100, Math.min(300, 4500 / k)));
  const nMu   = opts.nMu   !== undefined ? opts.nMu
    : Math.round(Math.max(200, Math.min(500, 100000 / k)));

  if (k < 2)         return { error: "Bayesian meta-analysis requires at least 2 studies." };
  if (sigma_mu  <= 0) return { error: "sigma_mu must be positive." };
  if (sigma_tau <= 0) return { error: "sigma_tau must be positive." };

  // ---- Inline DL τ estimate for grid sizing ----
  const wFE   = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W     = wFE.reduce((s, w) => s + w, 0);
  const FE    = studies.reduce((s, d, i) => s + d.yi * wFE[i], 0) / W;
  const Q     = studies.reduce((s, d, i) => s + wFE[i] * (d.yi - FE) ** 2, 0);
  const sumW2 = wFE.reduce((s, w) => s + w * w, 0);
  const C     = W - sumW2 / W;
  const tauDL = Math.sqrt(C > 0 ? Math.max(0, (Q - (k - 1)) / C) : 0);

  // ---- Compute grid weights for a given tauMax ----
  const computeGrid = (tauMax) => {
    const dtau      = tauMax / (nGrid - 1);
    const tauGrid   = new Float64Array(nGrid);
    const condMeans = new Float64Array(nGrid);
    const condVars  = new Float64Array(nGrid);
    const logW      = new Float64Array(nGrid);

    const precMu    = 1 / (sigma_mu * sigma_mu);
    const mu0PrecMu = mu0 * precMu;
    const logSigMu2 = Math.log(sigma_mu * sigma_mu);
    const inv2SigTau2 = 1 / (2 * sigma_tau * sigma_tau);

    for (let g = 0; g < nGrid; g++) {
      const tau  = g * dtau;
      const tau2 = tau * tau;
      tauGrid[g] = tau;

      let sumW = 0, sumWy = 0, sumWy2 = 0, sumLogV = 0;
      for (const d of studies) {
        const v  = d.vi + tau2;
        const w  = 1 / v;
        sumW    += w;
        sumWy   += w * d.yi;
        sumWy2  += w * d.yi * d.yi;
        sumLogV += Math.log(v);
      }

      const Pg      = precMu + sumW;
      const Vg      = 1 / Pg;
      const precYmu = mu0PrecMu + sumWy;
      const mg      = precYmu * Vg;

      condMeans[g] = mg;
      condVars[g]  = Vg;

      // Log marginal likelihood (2π constants drop in normalisation)
      const logML = 0.5 * (Math.log(Vg) - logSigMu2 - sumLogV)
                    - 0.5 * (sumWy2 + mu0 * mu0 * precMu - precYmu * precYmu * Vg);

      // Log half-normal prior on τ (constant terms drop in normalisation)
      logW[g] = logML - tau2 * inv2SigTau2;
    }

    return { tauGrid, condMeans, condVars, logW, dtau };
  };

  // ---- Initial grid ----
  let tauMax = Math.max(tauDL * 8, 3);
  let { tauGrid, condMeans, condVars, logW, dtau } = computeGrid(tauMax);

  // ---- Normalise via log-sum-exp ----
  const normalise = (lw) => {
    const lmax  = lw.reduce((m, v) => Math.max(m, v), -Infinity);
    const raw   = lw.map(v => Math.exp(v - lmax));
    const total = raw.reduce((s, v) => s + v, 0);
    return new Float64Array(raw.map(v => v / total));
  };

  let tauWeights = normalise(logW);

  // ---- Grid truncation check: double tauMax once if needed ----
  const maxW = tauWeights.reduce((m, v) => Math.max(m, v), 0);
  let grid_truncated = tauWeights[nGrid - 1] > 1e-4 * maxW;
  if (grid_truncated) {
    tauMax *= 2;
    ({ tauGrid, condMeans, condVars, logW, dtau } = computeGrid(tauMax));
    tauWeights = normalise(logW);
    const maxW2 = tauWeights.reduce((m, v) => Math.max(m, v), 0);
    grid_truncated = tauWeights[nGrid - 1] > 1e-4 * maxW2;
  }

  // ---- Marginal posterior of τ ----
  let tauMean = 0, tauMeanSq = 0;
  for (let g = 0; g < nGrid; g++) {
    tauMean   += tauWeights[g] * tauGrid[g];
    tauMeanSq += tauWeights[g] * tauGrid[g] * tauGrid[g];
  }
  const tauVar = Math.max(0, tauMeanSq - tauMean * tauMean);
  const tauSD  = Math.sqrt(tauVar);

  // τ CI by cumulative-weight interpolation
  const tauCDF = new Float64Array(nGrid);
  tauCDF[0] = 0;
  for (let g = 1; g < nGrid; g++) tauCDF[g] = tauCDF[g - 1] + tauWeights[g];

  const quantileTau = (p) => {
    for (let g = 1; g < nGrid; g++) {
      if (tauCDF[g] >= p) {
        const frac = (p - tauCDF[g - 1]) / Math.max(tauCDF[g] - tauCDF[g - 1], 1e-300);
        return tauGrid[g - 1] + frac * dtau;
      }
    }
    return tauGrid[nGrid - 1];
  };

  const _blo = alpha / 2, _bhi = 1 - alpha / 2;
  const tauCI = [quantileTau(_blo), quantileTau(_bhi)];

  // ---- Marginal posterior of μ (law of total expectation / variance) ----
  let muMean = 0, muMeanSq = 0, muMeanVar = 0;
  for (let g = 0; g < nGrid; g++) {
    muMean    += tauWeights[g] * condMeans[g];
    muMeanSq  += tauWeights[g] * condMeans[g] * condMeans[g];
    muMeanVar += tauWeights[g] * condVars[g];
  }
  // Var[μ|y] = E[Var[μ|τ,y]] + Var[E[μ|τ,y]]  (law of total variance)
  const muVar = Math.max(0, muMeanVar + muMeanSq - muMean * muMean);
  const muSD  = Math.sqrt(muVar);

  // ---- μ density grid ----
  const muLo   = muMean - 6 * Math.max(muSD, 1e-6);
  const muHi   = muMean + 6 * Math.max(muSD, 1e-6);
  const dMu    = (muHi - muLo) / (nMu - 1);
  const muGrid = new Float64Array(nMu);
  for (let j = 0; j < nMu; j++) muGrid[j] = muLo + j * dMu;

  // Mixture density p(μ|y) = Σ_g w_g · N(μ; m_g, V_g)
  const LOG_2PI   = Math.log(2 * Math.PI);
  const muDensity = new Float64Array(nMu);
  for (let j = 0; j < nMu; j++) {
    const mu = muGrid[j];
    let d = 0;
    for (let g = 0; g < nGrid; g++) {
      const Vg   = condVars[g];
      const mg   = condMeans[g];
      const logN = -0.5 * (LOG_2PI + Math.log(Vg) + (mu - mg) * (mu - mg) / Vg);
      d += tauWeights[g] * Math.exp(logN);
    }
    muDensity[j] = d;
  }

  // Normalise muDensity (trapezoidal rule)
  let integral = 0;
  for (let j = 0; j < nMu; j++) {
    integral += muDensity[j] * (j === 0 || j === nMu - 1 ? 0.5 : 1);
  }
  integral *= dMu;
  if (integral > 0) for (let j = 0; j < nMu; j++) muDensity[j] /= integral;

  // μ CI from mixture CDF (trapezoidal)
  const muCDF = new Float64Array(nMu);
  muCDF[0] = 0;
  for (let j = 1; j < nMu; j++) {
    muCDF[j] = muCDF[j - 1] + 0.5 * (muDensity[j - 1] + muDensity[j]) * dMu;
  }

  const quantileMu = (p) => {
    for (let j = 1; j < nMu; j++) {
      if (muCDF[j] >= p) {
        const frac = (p - muCDF[j - 1]) / Math.max(muCDF[j] - muCDF[j - 1], 1e-300);
        return muGrid[j - 1] + frac * dMu;
      }
    }
    return muGrid[nMu - 1];
  };

  const muCI = [quantileMu(_blo), quantileMu(_bhi)];

  // ---- Savage-Dickey Bayes Factor BF₁₀ (H₁: μ≠0 vs H₀: μ=0) ----
  // BF₁₀ = p(μ=0 | H₁) / p(μ=0 | y, H₁)
  //       = prior_density(0) / posterior_density(0)
  //
  // Prior density at 0: N(0; mu0, sigma_mu²)
  const priorAt0 = Math.exp(-0.5 * mu0 * mu0 / (sigma_mu * sigma_mu))
                 / Math.sqrt(2 * Math.PI * sigma_mu * sigma_mu);

  // Posterior mixture density at 0: Σ_g w_g · N(0; m_g, V_g)
  let postAt0 = 0;
  for (let g = 0; g < nGrid; g++) {
    const mg = condMeans[g], Vg = condVars[g];
    postAt0 += tauWeights[g]
             * Math.exp(-0.5 * mg * mg / Vg)
             / Math.sqrt(2 * Math.PI * Vg);
  }

  const BF10    = (priorAt0 > 0 && postAt0 > 0) ? priorAt0 / postAt0 : NaN;
  const BF01    = isFinite(BF10) && BF10 > 0 ? 1 / BF10 : NaN;
  const logBF10 = isFinite(BF10) && BF10 > 0 ? Math.log(BF10) : NaN;

  return {
    mu0, sigma_mu, sigma_tau, alpha,
    muMean, muSD, muCI,
    tauMean, tauSD, tauCI,
    tauGrid, tauWeights,
    muGrid, muDensity,
    grid_truncated,
    k,
    BF10, BF01, logBF10,
  };
}

// ---------------------------------------------------------------------------
// priorSensitivity(studies, opts) → array of rows
// ---------------------------------------------------------------------------
// Runs bayesMeta() over a grid of (sigma_mu, sigma_tau) pairs and returns a
// summary row for each combination. No new math — wraps bayesMeta().
//
// opts:
//   mu0          — prior mean for μ (default 0)
//   sigmaMuGrid  — array of σ_μ values (default [0.5, 1, 2])
//   sigmaTauGrid — array of σ_τ values (default [0.25, 0.5, 1])
//   alpha        — credible interval width (default 0.05)
//
// Returns: array of { sigma_mu, sigma_tau, muMean, muCI, BF10 }
//   (one object per grid cell, ordered σ_τ outer / σ_μ inner)
// ---------------------------------------------------------------------------
export function priorSensitivity(studies, opts = {}) {
  const {
    mu0          = 0,
    sigmaMuGrid  = [0.5, 1, 2],
    sigmaTauGrid = [0.25, 0.5, 1],
    alpha        = 0.05,
  } = opts;
  const rows = [];
  for (const sigma_tau of sigmaTauGrid) {
    for (const sigma_mu of sigmaMuGrid) {
      const r = bayesMeta(studies, { mu0, sigma_mu, sigma_tau, alpha });
      rows.push({
        sigma_mu,
        sigma_tau,
        muMean: r.error ? NaN : r.muMean,
        muCI:   r.error ? [NaN, NaN] : r.muCI,
        BF10:   r.error ? NaN : r.BF10,
      });
    }
  }
  return rows;
}
