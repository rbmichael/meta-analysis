// =============================================================================
// utils.js — Mathematical and formatting utilities
// =============================================================================
// Self-contained numerical library used throughout the app.  Nothing in this
// file touches the DOM or imports application state.
//
// Sections
// --------
//   Formatting       round(), fmt()
//   Distributions    normalCDF(), normalQuantile(), tCDF(), tCritical(),
//                    chiSquareCDF(), chiSquareQuantile(), fCDF(),
//                    regularizedBeta(), regularizedGammaP(), logGamma()
//   Bivariate        bivariateNormalCDF()
//   Effect sizes     hedgesG(), tetrachoricFromCounts(), gorFromCounts()
//   Parsing          parseCounts()
//   Display          transformEffect()
//
// All numerical approximations cite their source algorithm in the function
// comment.  No function in this file has side effects.
//
// Dependencies: constants.js
// =============================================================================

import { MIN_VAR, BISECTION_ITERS, Z_95 } from "./constants.js";

// ================= ROUNDING =================

// Safe rounding to n decimal places
export function round(value, digits = 3) {
 if (!isFinite(value)) return value;

 const factor = Math.pow(10, digits);
 return Math.round((value + Number.EPSILON) * factor) / factor;
}

// Format for display (fixed decimals, keeps trailing zeros)
export function fmt(value, digits = 3) {
 if (!isFinite(value)) return "NA";
 return round(value, digits).toFixed(digits);
}

// ================= T CRITICAL =================
// Two-tailed 95% critical value via bisection on tCDF.
export function tCritical(df, alpha = 0.05) {
  const target = 1 - alpha / 2;
  if (!isFinite(df) || df <= 0) return normalQuantile(target);

  let lo = 0, hi = 20;  // t_{0.975,1} ≈ 12.706; 20 is a safe upper bound

  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < target) lo = mid;
    else hi = mid;
  }

  return (lo + hi) / 2;
}

// ================= NORMAL CDF =================
// Rational polynomial approximation for the standard normal CDF Φ(x).
// Source: Abramowitz, M. & Stegun, I.A. (1964). Handbook of Mathematical
//   Functions, §26.2.17 (five-term polynomial with p=0.2316419).
// Precision: A&S states |ε| < 7.5 × 10⁻⁸ for x > 0 in the survival probability.
//   With 7-significant-figure coefficients as stored here, the actual maximum
//   absolute error is ≈ 1.5 × 10⁻⁷ (observed at x = 0). This is well within
//   the 3–4 significant figures needed for p-value display in meta-analysis.
// Range: valid for all finite x. For |x| ≳ 38, exp(−x²/2) underflows to 0,
//   returning exactly 0 (x<0) or 1 (x>0) with absolute error < 10⁻³¹³.
export function normalCDF(x){
 const t = 1 / (1 + 0.2316419 * Math.abs(x));
 const d = 0.3989423 * Math.exp(-x*x/2);

 let prob = d * t * (
   0.3193815 +
   t * (-0.3565638 +
   t * (1.781478 +
   t * (-1.821256 +
   t * 1.330274)))
 );

 if(x > 0) prob = 1 - prob;
 return prob;
}

// ================= REGULARIZED INCOMPLETE BETA =================
// I_x(a, b) via Lentz continued-fraction algorithm.
// Source: Press, W.H. et al. (2007). Numerical Recipes, 3rd ed., §6.4 (betacf/betai).
// Convergence: EPS = 1e-14 → ~14 significant digits under typical conditions.
// Uses symmetry I_x(a,b) = 1 − I_{1-x}(b,a) to keep x in the faster-converging
//   half of the domain. MAX_ITER = 200 is sufficient for all (a, b, x) arising
//   from tCDF and fCDF in meta-analysis (df ≤ 10 000, |x| ≤ 1000).
function regularizedBeta(x, a, b) {
  if (x < 0 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use symmetry to keep x in the range that converges faster
  if (x > (a + 1) / (a + b + 2)) return 1 - regularizedBeta(1 - x, b, a);

  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

  // Lentz continued fraction for betaCF
  const TINY = 1e-30;
  const EPS  = 1e-14;
  const MAX_ITER = 200;

  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;

    // Even step
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;

    // Odd step
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < EPS) break;
  }

  return front * h;
}

// ================= T CDF =================
// Exact CDF of Student's t distribution via the regularized incomplete beta:
//   P(T ≤ x | df) = 1 − I_{df/(df+x²)}(df/2, 1/2) / 2   for x ≥ 0
//   P(T ≤ x | df) =     I_{df/(df+x²)}(df/2, 1/2) / 2   for x < 0
// Source: Abramowitz & Stegun (1964) §26.7.1; see also Numerical Recipes §6.4.
// Accuracy: ~14 significant digits (limited by regularizedBeta, EPS = 1e-14).
//   As df → ∞ the result converges to normalCDF(x).
// Non-finite x or df, or df ≤ 0: returns NaN.
export function tCDF(x, df) {
  if (!isFinite(x) || !isFinite(df) || df <= 0) return NaN;

  const t2  = x * x;
  const p_upper = regularizedBeta(df / (df + t2), df / 2, 0.5) / 2;

  return x >= 0 ? 1 - p_upper : p_upper;
}

export function chiSquareCDF(x, k) {
  if (x <= 0) return 0;

  // use the regularized gamma function approximation
  // P(x;k) = γ(k/2, x/2) / Γ(k/2)
  return regularizedGammaP(k / 2, x / 2);
}

// Chi-square quantile (inverse CDF) via bisection on chiSquareCDF.
// Returns x such that P(χ²_df ≤ x) = p.
export function chiSquareQuantile(p, df) {
  if (!isFinite(p) || p <= 0 || p >= 1 || !isFinite(df) || df <= 0) return NaN;
  let lo = 0, hi = Math.max(df * 4 + 100, 50);
  // Ensure hi is above the target quantile
  while (chiSquareCDF(hi, df) < p) hi *= 2;
  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquareCDF(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// CDF of the F distribution with d1 and d2 degrees of freedom.
// Uses the regularised incomplete beta: P(F_{d1,d2} ≤ f) = I_{x}(d1/2, d2/2)
// where x = d1·f / (d1·f + d2).
export function fCDF(f, d1, d2) {
  if (!isFinite(f) || f <= 0) return 0;
  if (!isFinite(d1) || d1 <= 0 || !isFinite(d2) || d2 <= 0) return NaN;
  const x = (d1 * f) / (d1 * f + d2);
  return regularizedBeta(x, d1 / 2, d2 / 2);
}

// Regularized lower incomplete gamma function P(a, x)
export function regularizedGammaP(a, x) {
  // Lanczos approximation for gamma function
  const EPS = 1e-14;
  const MAX_ITER = 100;

  if (x < 0 || a <= 0) return NaN;

  if (x === 0) return 0;

  // series representation for x < a + 1
  if (x < a + 1) {
    let sum = 1 / a;
    let term = 1 / a;
    for (let n = 1; n < MAX_ITER; n++) {
      term *= x / (a + n);
      sum += term;
      if (term < EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  } else {
    // continued fraction representation
    let b = x + 1 - a;
    let c = 1 / 1e-30;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < MAX_ITER; i++) {
      let an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < EPS) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  }
}

// Natural log of the gamma function via Lanczos approximation.
// Source: Press, W.H. et al. (2007). Numerical Recipes, 3rd ed., §6.1 (gammln).
//   Coefficients for g = 607/128 ≈ 5.2421875 with 14 terms.
// Relative error: < 5 × 10⁻¹⁶ for real z > 0.
// Not guarded for z ≤ 0 (pole/undefined); all callers guarantee z > 0.
export function logGamma(z) {
  const coef = [
    57.1562356658629235,
    -59.5979603554754912,
    14.1360979747417471,
    -0.491913816097620199,
    .339946499848118887e-4,
    .465236289270485756e-4,
    -.983744753048795646e-4,
    .158088703224912494e-3,
    -.210264441724104883e-3,
    .217439618115212643e-3,
    -.164318106536763890e-3,
    .844182239838527433e-4,
    -.261908384015814087e-4,
    .368991826595316234e-5
  ];
  const z0 = z;
  let x = z + 5.2421875;
  x = (z + 0.5) * Math.log(x) - x;
  let ser = 0.999999999999997092;
  for (let j = 0; j < coef.length; j++) {
    ser += coef[j] / (++z);
  }
  return x + Math.log(2.5066282746310005 * ser / z0);
}

// ================= COMPUTE HELPERS =================

// Hedges g (bias-corrected Cohen's d) for two independent groups.
// options.hedgesCorrection (default true) controls whether the J factor is applied.
//
// J approximation: J ≈ 1 − 3/(4·df − 1)  where df = n1 + n2 − 2.
// Source: Hedges (1981, J. Educational Statistics 6:107–128); exact J is the
// gamma ratio Γ(df/2) / (√(df/2) · Γ((df−1)/2)) — this approximation matches
// to < 0.1% for df ≥ 3. See also Hedges & Olkin (1985, pp. 80–81).
//
// Variance: Var(g) ≈ (n1+n2)/(n1·n2) + g²/(2·N)  where N = n1+n2.
// Uses g² (the bias-corrected estimator, not raw d²), matching metafor's
// escalc(measure="SMD"): vyi = 1/n1 + 1/n2 + yi^2 / (2*(n1+n2)).
export function hedgesG(s, options = {}) {
  const n1 = s.n1, n2 = s.n2;
  const df = n1 + n2 - 2;
  const sp = Math.sqrt(((n1 - 1) * s.sd1 ** 2 + (n2 - 1) * s.sd2 ** 2) / df);
  const d  = (s.m1 - s.m2) / sp;
  const applyHedges = options.hedgesCorrection ?? true;
  const J  = 1 - (3 / (4 * df - 1));
  const g  = applyHedges ? d * J : d;
  const varBase = (n1 + n2) / (n1 * n2) + (g * g) / (2 * (n1 + n2));
  return { es: g, var: Math.max(varBase, MIN_VAR) };
}

// ================= GENERALISED ODDS RATIO HELPERS =================

// Parse a space-or-comma separated string of non-negative integers.
// Returns an array of numbers, or null if any token is invalid.
export function parseCounts(str) {
  if (typeof str !== "string" || str.trim() === "") return null;
  const tokens = str.trim().split(/[\s,]+/);
  const counts = [];
  for (const tok of tokens) {
    const n = Number(tok);
    if (!Number.isInteger(n) || n < 0) return null;
    counts.push(n);
  }
  return counts.length >= 2 ? counts : null;
}

// Compute log(GOR) and its delta-method variance from two count arrays.
// GOR = P(Y₁ > Y₂) / P(Y₁ < Y₂)  (Agresti 1980).
// Returns { es: log(GOR), var } or { es: NaN, var: NaN } on complete separation.
export function gorFromCounts(c1, c2) {
  const nan = { es: NaN, var: NaN };
  if (!c1 || !c2 || c1.length !== c2.length || c1.length < 2) return nan;

  const C  = c1.length;
  const N1 = c1.reduce((s, v) => s + v, 0);
  const N2 = c2.reduce((s, v) => s + v, 0);
  if (N1 === 0 || N2 === 0) return nan;

  const p1 = c1.map(v => v / N1);
  const p2 = c2.map(v => v / N2);

  // Precompute strict left CDF and right tail for each group.
  // L2[j] = P(Y₂ < j),  H2[j] = P(Y₂ > j)
  // P1gt[k] = P(Y₁ > k), P1lt[k] = P(Y₁ < k)
  const L2   = new Array(C).fill(0);  // L2[0] = 0
  const H2   = new Array(C).fill(0);  // H2[C-1] = 0
  const P1gt = new Array(C).fill(0);  // P1gt[C-1] = 0
  const P1lt = new Array(C).fill(0);  // P1lt[0] = 0

  for (let j = 1; j < C; j++) L2[j]   = L2[j - 1]   + p2[j - 1];
  for (let j = C - 2; j >= 0; j--) H2[j]   = H2[j + 1]   + p2[j + 1];
  for (let k = C - 2; k >= 0; k--) P1gt[k] = P1gt[k + 1] + p1[k + 1];
  for (let k = 1; k < C; k++) P1lt[k]  = P1lt[k - 1]  + p1[k - 1];

  // Concordant and discordant probabilities.
  let theta = 0, phi = 0;
  for (let j = 0; j < C; j++) {
    theta += p1[j] * L2[j];
    phi   += p1[j] * H2[j];
  }
  if (theta <= 0 || phi <= 0) return nan;  // complete separation

  // Delta-method variance of log(theta/phi).
  // Group 1 contributions (iterate over j):
  let V1t = 0, V1p = 0, Cov1 = 0;
  for (let j = 0; j < C; j++) {
    const at = L2[j]   - theta;
    const ap = H2[j]   - phi;
    V1t  += p1[j] * at * at;
    V1p  += p1[j] * ap * ap;
    Cov1 += p1[j] * at * ap;
  }
  V1t /= N1;  V1p /= N1;  Cov1 /= N1;

  // Group 2 contributions (iterate over k):
  let V2t = 0, V2p = 0, Cov2 = 0;
  for (let k = 0; k < C; k++) {
    const bt = P1gt[k] - theta;
    const bp = P1lt[k] - phi;
    V2t  += p2[k] * bt * bt;
    V2p  += p2[k] * bp * bp;
    Cov2 += p2[k] * bt * bp;
  }
  V2t /= N2;  V2p /= N2;  Cov2 /= N2;

  const varLog = (V1t + V2t) / (theta * theta)
               + (V1p + V2p) / (phi   * phi)
               - 2 * (Cov1 + Cov2) / (theta * phi);

  return { es: Math.log(theta) - Math.log(phi), var: Math.max(varLog, MIN_VAR) };
}

// ================= NORMAL QUANTILE (INVERSE CDF) =================
// Acklam's rational approximation (2010) — max absolute error ~1.5e-9 over (0,1).
// Uses three-region piecewise rational polynomial; NO bisection, NOT governed by
// BISECTION_ITERS. Error bound 1.5e-9 in z translates to a CI half-width error
// of ~1.5e-9 × SE — negligible relative to τ² estimation uncertainty (REML_TOL).
// BISECTION_ITERS governs tCritical(), chiSquareQuantile(), and bivariateNormalCDF()
// bisection loops; those are separate functions that invert their respective CDFs
// numerically. normalQuantile() is the only quantile function here that is
// closed-form.
export function normalQuantile(p) {
  if (!isFinite(p) || p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;

  const a = [-3.969683028665376e+01,  2.209460984245205e+02,
             -2.759285104469687e+02,  1.383577518672690e+02,
             -3.066479806614716e+01,  2.506628277459239e+00];
  const b = [-5.447609879822406e+01,  1.615858368580409e+02,
             -1.556989798598866e+02,  6.680131188771972e+01,
             -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00,  2.938163982698783e+00];
  const d = [ 7.784695709041462e-03,  3.224671290700398e-01,
              2.445134137142996e+00,  3.754408661907416e+00];

  const p_lo = 0.02425, p_hi = 1 - p_lo;
  let q;

  if (p < p_lo) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= p_hi) {
    q = p - 0.5;
    const r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// ================= BIVARIATE NORMAL CDF =================
// Φ₂(h, k; ρ) via Pearson's formula:
//   Φ₂(h,k;ρ) = Φ(h)Φ(k) + ∫₀^ρ φ₂(h,k;t) dt
// where φ₂(h,k;t) = exp(−(h²−2thk+k²)/(2(1−t²))) / (2π√(1−t²))
// Integral evaluated by 20-point Gauss-Legendre on [0, ρ].
// Nodes and weights: Abramowitz & Stegun (1964) Table 25.4.
const _GL20_X = [
  -0.9931285991850949, -0.9639719272779138, -0.9122344282513259, -0.8391169718222188,
  -0.7463064833401189, -0.6360536807265150, -0.5108670019508271, -0.3737060887154195,
  -0.2277858511416451, -0.0765265211334973,  0.0765265211334973,  0.2277858511416451,
   0.3737060887154195,  0.5108670019508271,  0.6360536807265150,  0.7463064833401189,
   0.8391169718222188,  0.9122344282513259,  0.9639719272779138,  0.9931285991850949,
];
const _GL20_W = [
  0.0176140071391521, 0.0406014298003869, 0.0626720483341091, 0.0832767415767048,
  0.1019301198172404, 0.1181945319615184, 0.1316886384491766, 0.1420961093183820,
  0.1491729864726037, 0.1527533871307258, 0.1527533871307258, 0.1491729864726037,
  0.1420961093183820, 0.1316886384491766, 0.1181945319615184, 0.1019301198172404,
  0.0832767415767048, 0.0626720483341091, 0.0406014298003869, 0.0176140071391521,
];
export function bivariateNormalCDF(h, k, rho) {
  if (!isFinite(h) || !isFinite(k) || !isFinite(rho)) return NaN;
  rho = Math.max(-1 + 1e-10, Math.min(1 - 1e-10, rho));
  if (rho === 0) return normalCDF(h) * normalCDF(k);

  const hh = h * h, kk = k * k, hk = h * k;
  const TWO_PI = 2 * Math.PI;
  let sum = 0;
  for (let i = 0; i < 20; i++) {
    const t  = rho * (_GL20_X[i] + 1) / 2;
    const r2 = 1 - t * t;
    sum += _GL20_W[i] * Math.exp(-(hh + kk - 2*t*hk) / (2*r2)) / (TWO_PI * Math.sqrt(r2));
  }
  return normalCDF(h) * normalCDF(k) + (rho / 2) * sum;
}

// ================= TETRACHORIC CORRELATION =================
// Estimates the latent Pearson correlation from a 2×2 table (a,b,c,d).
// Finds ρ by bisecting bivariateNormalCDF(h, k; ρ) = a/N.
// Variance: p_r(1−p_r)·p_c(1−p_c) / (N · φ₂(h,k;ρ)²)  — delta method.
// Returns { rho, var } or { rho: NaN, var: NaN } when the model cannot fit.
export function tetrachoricFromCounts(a, b, c, d) {
  const nan = { rho: NaN, var: NaN };
  if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return nan;

  // Continuity correction when any cell is zero
  let aa = a, bb = b, cc = c, dd = d;
  if (aa === 0 || bb === 0 || cc === 0 || dd === 0) {
    aa += 0.5; bb += 0.5; cc += 0.5; dd += 0.5;
  }

  const N     = aa + bb + cc + dd;
  const p_row = (aa + bb) / N;
  const p_col = (aa + cc) / N;
  const p11   = aa / N;

  if (p_row <= 0 || p_row >= 1 || p_col <= 0 || p_col >= 1) return nan;

  const h = normalQuantile(p_row);
  const k = normalQuantile(p_col);

  // Bisect ρ so that Φ₂(h, k; ρ) = p11
  const EPS = 1e-10;
  let lo = -1 + EPS, hi = 1 - EPS;
  if (bivariateNormalCDF(h, k, lo) > p11 || bivariateNormalCDF(h, k, hi) < p11) return nan;

  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (bivariateNormalCDF(h, k, mid) < p11) lo = mid; else hi = mid;
  }
  const rho = (lo + hi) / 2;

  // Delta-method variance
  const r2  = 1 - rho * rho;
  const bvd = Math.exp(-(h*h + k*k - 2*rho*h*k) / (2*r2)) / (2 * Math.PI * Math.sqrt(r2));
  if (!isFinite(bvd) || bvd === 0) return nan;
  const v = p_row*(1 - p_row) * p_col*(1 - p_col) / (N * bvd * bvd);

  return { rho, var: Math.max(v, MIN_VAR) };
}

// ================= GAUSS HYPERGEOMETRIC (specialised for UCOR) =================
/**
 * Gauss hypergeometric function ₂F₁(1/2, 1/2; c; z) via convergent series.
 *
 * Used for the Olkin-Pratt bias-corrected correlation (UCOR):
 *   c = (n − 2) / 2,  z = 1 − r²
 *   r_uc = r · ₂F₁(1/2, 1/2; c; z)
 *
 * The series is:  Σ_{k≥0} [(1/2)_k]² / [(c)_k · k!] · z^k
 * with recurrence  term_k = term_{k-1} · (k − ½)² / [(c + k − 1) · k] · z
 *
 * Converges absolutely for |z| < 1 (all valid correlations |r| > 0).
 * Returns 1 when z = 0 (r = ±1).
 */
export function hyperg2F1_ucor(c, z) {
  if (z === 0) return 1;
  let sum = 1, term = 1;
  for (let k = 1; k <= 500; k++) {
    term *= (k - 0.5) * (k - 0.5) / ((c + k - 1) * k) * z;
    sum += term;
    if (Math.abs(term) < 1e-15 * Math.abs(sum)) break;
  }
  return sum;
}

// ================= EFFECT TRANSFORMS (PROFILE-AWARE) =================
const _clamp01 = v => Math.min(1, Math.max(0, v));
const _TRANSFORMS = {
  // Log-scale ratio measures → exp(yi)
  OR: Math.exp, RR: Math.exp, HR: Math.exp, IRR: Math.exp, IR: Math.exp,
  ROM: Math.exp, CVR: Math.exp, VR: Math.exp, GOR: Math.exp, MNLN: Math.exp,
  // Identity — already on display scale
  RD: x => x, MD: x => x, SMD: x => x, SMDH: x => x,
  MD_paired: x => x, SMD_paired: x => x, SMCC: x => x, MN: x => x,
  COR: x => x, UCOR: x => x, PCOR: x => x, PHI: x => x, RTET: x => x,
  AS: x => x,
  // Fisher's z → r
  ZCOR: Math.tanh, ZPCOR: Math.tanh,
  // Proportions → p ∈ [0, 1]
  PR:  x => _clamp01(x),
  PLN: x => _clamp01(Math.exp(x)),
  PLO: x => _clamp01(1 / (1 + Math.exp(-x))),
  PAS: x => _clamp01(Math.sin(x) ** 2),
  PFT: x => _clamp01(Math.sin(x / 2) ** 2),
};

export function transformEffect(x, type) {
  if (!isFinite(x)) return NaN;
  const fn = _TRANSFORMS[type];
  if (fn) return fn(x);
  console.warn("Unknown effect type in transformEffect:", type);
  return x;
}

