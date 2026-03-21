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
// Approximate t critical (two-tailed, 95%)
export function tCritical(df){

 // Simple lookup for small df (accurate)
 const table = {
  1:12.706, 2:4.303, 3:3.182, 4:2.776, 5:2.571,
  6:2.447, 7:2.365, 8:2.306, 9:2.262, 10:2.228,
  12:2.179, 15:2.131, 20:2.086, 25:2.060, 30:2.042
 };

 if(df <= 30){
  const keys = Object.keys(table).map(Number);
  const closest = keys.reduce((a,b)=>Math.abs(b-df)<Math.abs(a-df)?b:a);
  return table[closest];
 }

 // large df → normal approx
 return 1.96;
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

// ================= T CDF (approx) =================
// Uses normal approx for simplicity (good for df > ~5)
export function tCDF(x, df){
 // For now: fallback to normal approximation
 // (we can upgrade later with full beta function if needed)
 return normalCDF(x);
}

export function chiSquareCDF(x, k) {
  if (x <= 0) return 0;

  // use the regularized gamma function approximation
  // P(x;k) = γ(k/2, x/2) / Γ(k/2)
  return regularizedGammaP(k / 2, x / 2);
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