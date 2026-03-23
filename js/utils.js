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
export function tCritical(df) {
  if (!isFinite(df) || df <= 0) return 1.96;

  const target = 0.975; // P(T <= t) = 0.975 for two-tailed 95%
  let lo = 0, hi = 20;  // t_{0.975,1} ≈ 12.706; 20 is a safe upper bound

  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < target) lo = mid;
    else hi = mid;
  }

  return (lo + hi) / 2;
}

// ================= NORMAL CDF =================
// Abramowitz-Stegun approximation
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
// Uses symmetry relation I_x(a,b) = 1 - I_{1-x}(b,a) for numerical stability.
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
// Exact CDF of Student's t with df degrees of freedom.
// Relation to incomplete beta: P(T <= x) = 1 - I_{df/(df+x²)}(df/2, 1/2) / 2
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
  for (let i = 0; i < 64; i++) {
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

// Natural log of gamma function using Lanczos approximation
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
  let x = z + 5.2421875;
  x = (z + 0.5) * Math.log(x) - x;
  let ser = 0.999999999999997092;
  for (let j = 0; j < coef.length; j++) {
    ser += coef[j] / (++z);
  }
  return x + Math.log(ser * Math.sqrt(2 * Math.PI));
}

// ================= EFFECT TRANSFORMS (PROFILE-AWARE) =================
export function transformEffect(x, type) {
  if (!isFinite(x)) return NaN;

  // Ratio measures — all stored on log scale, display as exp(yi)
  if (type === "OR" || type === "RR" || type === "HR" || type === "IRR" || type === "IR" || type === "ROM") {
    return Math.exp(x);
  }

	// Risk difference
	if (type === "RD") return x;  // continuous scale, no transformation

  // Continuous measures
  if (type === "MD" || type === "SMD" || type === "MD_paired" || type === "SMD_paired") {
    return x;
  }

  // Correlation: ZCOR back-transforms Fisher's z → r; COR is already on r scale
  if (type === "ZCOR") return Math.tanh(x);
  if (type === "COR")  return x;

  // Proportions — all back-transform to p ∈ [0, 1]
  if (type === "PR")  return Math.min(1, Math.max(0, x));
  if (type === "PLN") return Math.min(1, Math.max(0, Math.exp(x)));
  if (type === "PLO") return Math.min(1, Math.max(0, 1 / (1 + Math.exp(-x))));
  if (type === "PAS") return Math.min(1, Math.max(0, Math.sin(x) ** 2));
  if (type === "PFT") return Math.min(1, Math.max(0, Math.sin(x / 2) ** 2));

  // Fallback for unknown type
  console.warn("Unknown effect type in transformEffect:", type);
  return x;
}

export function transformCI(lb, ub, type) {
  if (!isFinite(lb) || !isFinite(ub)) {
    return { lb: NaN, ub: NaN };
  }

  if (type === "OR" || type === "RR" || type === "HR" || type === "IRR" || type === "IR" || type === "ROM") {
    return {
      lb: Math.exp(lb),
      ub: Math.exp(ub)
    };
  }

	if (type === "RD") return { lb, ub }; // raw difference

  if (type === "MD" || type === "SMD" || type === "MD_paired" || type === "SMD_paired") {
    return { lb, ub };
  }

  if (type === "ZCOR") return { lb: Math.tanh(lb), ub: Math.tanh(ub) };
  if (type === "COR")  return { lb, ub };

  // Proportions — apply same back-transform to both CI bounds
  if (type === "PR"  || type === "PLN" || type === "PLO" ||
      type === "PAS" || type === "PFT") {
    return {
      lb: transformEffect(lb, type),
      ub: transformEffect(ub, type)
    };
  }

  console.warn("Unknown effect type in transformCI:", type);
  return { lb, ub };
}