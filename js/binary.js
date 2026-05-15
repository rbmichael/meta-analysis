// =============================================================================
// binary.js — Binary-data pooled estimators
// =============================================================================
// Mantel-Haenszel (OR, RR, RD) and Peto OR for 2×2 table data.
// Both return an object shaped like meta() with RE/tau2 = NaN.
//
// Exports
// -------
//   metaMH(studies, type, alpha)   — Mantel-Haenszel fixed-effects pooling
//   metaPeto(studies, alpha)       — Peto one-step log-OR estimator
//
// Dependencies: utils.js, constants.js, regression.js (heterogeneityCIs).
// The regression.js import is circular (regression → analysis → binary → regression)
// but safe: heterogeneityCIs is only called inside function bodies, never at
// module initialisation time.
// =============================================================================

import { normalCDF, normalQuantile } from "./utils.js";
import { MIN_VAR } from "./constants.js";
// Circular import — safe: called inside function bodies only.
import { heterogeneityCIs } from "./regression.js";


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
