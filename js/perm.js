// =============================================================================
// perm.js — Permutation test for meta-regression
// =============================================================================
// Builds the null distribution of QM (omnibus moderator Wald statistic) by
// permuting design matrix rows (moderator assignment) with yi/vi fixed, then
// re-estimating tau2 for each permutation.  Matches metafor permutest.rma.uni().
//
// Exports
// -------
//   permTestSync(params) → PermResult | { error: string }
//
//   params: {
//     yi:       number[]   — effect sizes (k)
//     vi:       number[]   — variances (k)
//     Xf:       number[][] — design matrix k×p (includes intercept col)
//     QM_obs:   number     — observed omnibus QM (inserted at dist[0])
//     tau2:     number     — observed tau2 (unused; re-estimated per perm)
//     nPerm:    number     — permutations (default 999, includes observed)
//     seed:     number     — PRNG seed (default 12345)
//     method:   string     — tau2 method ("REML"|"DL"|"PM"|"ML"|"HS"|"HE")
//     modTests: { colIdxs: number[] }[]
//   }
//
//   PermResult: {
//     QM_dist:    Float64Array(nPerm)       — dist[0] = QM_obs
//     modQM_dist: Float64Array(nPerm*nMods)
//     nPerm:      number
//     nMods:      number
//   }
//
// p-value formula: mean(QM_dist >= QM_obs)  [observed at dist[0] always counts]
//
// Dependencies: matInverse, wls from analysis.js
// =============================================================================

import { matInverse, wls } from "./analysis.js";

// ---------------------------------------------------------------------------
// Mulberry32 PRNG (same as gosh.js / perm.worker.js)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle of an integer index array (in-place).
// ---------------------------------------------------------------------------
function fisherYates(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

// ---------------------------------------------------------------------------
// Helper: extract square sub-block for given row/col indices.
// ---------------------------------------------------------------------------
function subMatrix(A, idxs) {
  return idxs.map(r => idxs.map(c => A[r][c]));
}

// ---------------------------------------------------------------------------
// Helper: quadratic form v' A v for array-of-arrays A and array v.
// ---------------------------------------------------------------------------
function quadForm(A, v) {
  const n = v.length;
  let result = 0.0;
  for (let r = 0; r < n; r++) {
    let Avr = 0.0;
    for (let c = 0; c < n; c++) Avr += A[r][c] * v[c];
    result += v[r] * Avr;
  }
  return result;
}

// ---------------------------------------------------------------------------
// DL tau2 seed for meta-regression (array-of-arrays X).
// ---------------------------------------------------------------------------
function tau2DL(X, yi, vi) {
  const k = yi.length, p = X[0].length, df = k - p;
  if (df <= 0) return 0;
  const w0 = vi.map(v => 1 / v);
  const { beta: b0, vcov: V0, rankDeficient: rd0 } = wls(X, yi, w0);
  if (rd0) return 0;
  const QE = yi.reduce((s, y, i) => {
    const e = y - X[i].reduce((a, xi, j) => a + xi * b0[j], 0);
    return s + w0[i] * e * e;
  }, 0);
  const c = w0.reduce((s, wi, i) => s + wi * (1 - wi * quadForm(V0, X[i])), 0);
  return c > 0 ? Math.max(0, (QE - df) / c) : 0;
}

// ---------------------------------------------------------------------------
// REML tau2 via Fisher scoring (matches regression.js tau2Reg_REML).
// ---------------------------------------------------------------------------
function tau2REML(X, yi, vi, tol = 1e-10, maxIter = 100) {
  const k = yi.length, p = X[0].length;
  if (k - p <= 0) return 0;
  let tau2 = tau2DL(X, yi, vi);
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, vcov: V, rankDeficient: rd } = wls(X, yi, w);
    if (rd) break;
    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const h = w[i] * quadForm(V, X[i]);
      const e = yi[i] - X[i].reduce((a, xi, j) => a + xi * beta[j], 0);
      const pi = w[i] * (1 - h);
      score += w[i] * w[i] * e * e - pi;
      info  += w[i] * pi;
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

// ---------------------------------------------------------------------------
// ML tau2 via Fisher scoring.
// ---------------------------------------------------------------------------
function tau2ML(X, yi, vi, tol = 1e-10, maxIter = 100) {
  const k = yi.length, p = X[0].length;
  if (k - p <= 0) return 0;
  let tau2 = tau2DL(X, yi, vi);
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, rankDeficient: rd } = wls(X, yi, w);
    if (rd) break;
    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const vit = vi[i] + tau2;
      const e = yi[i] - X[i].reduce((a, xi, j) => a + xi * beta[j], 0);
      score += e * e / (vit * vit) - 1 / vit;
      info  += 1 / (vit * vit);
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

// ---------------------------------------------------------------------------
// PM tau2 for meta-regression.
// ---------------------------------------------------------------------------
function tau2PM(X, yi, vi, tol = 1e-10, maxIter = 100) {
  const k = yi.length, p = X[0].length, df = k - p;
  if (df <= 0) return 0;
  let tau2 = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, rankDeficient: rd } = wls(X, yi, w);
    if (rd) break;
    const QE = yi.reduce((s, y, i) => {
      const e = y - X[i].reduce((a, xi, j) => a + xi * beta[j], 0);
      return s + w[i] * e * e;
    }, 0);
    const sumW = w.reduce((a, b) => a + b, 0);
    const newTau2 = Math.max(0, tau2 + (QE - df) / sumW);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }
  return tau2;
}

// ---------------------------------------------------------------------------
// HS tau2 (FE-weight denominator).
// ---------------------------------------------------------------------------
function tau2HS(X, yi, vi) {
  const k = yi.length, p = X[0].length, df = k - p;
  if (df <= 0) return 0;
  const w0 = vi.map(v => 1 / v);
  const { beta, rankDeficient: rd } = wls(X, yi, w0);
  if (rd) return 0;
  let QE = 0, sumW = 0;
  for (let i = 0; i < k; i++) {
    const e = yi[i] - X[i].reduce((a, xi, j) => a + xi * beta[j], 0);
    QE += w0[i] * e * e;
    sumW += w0[i];
  }
  return sumW > 0 ? Math.max(0, (QE - df) / sumW) : 0;
}

// ---------------------------------------------------------------------------
// HE tau2 (unweighted OLS).
// ---------------------------------------------------------------------------
function tau2HE(X, yi, vi) {
  const k = yi.length, p = X[0].length, df = k - p;
  if (df <= 0) return 0;
  const w1 = vi.map(() => 1);
  const { beta, rankDeficient: rd } = wls(X, yi, w1);
  if (rd) return 0;
  let SS = 0;
  for (let i = 0; i < k; i++) {
    const e = yi[i] - X[i].reduce((a, xi, j) => a + xi * beta[j], 0);
    SS += e * e;
  }
  const meanV = vi.reduce((a, b) => a + b, 0) / k;
  return Math.max(0, SS / df - meanV);
}

// ---------------------------------------------------------------------------
// Dispatch tau2 estimation by method name.
// ---------------------------------------------------------------------------
function estimateTau2(X, yi, vi, method) {
  if (method === 'REML') return tau2REML(X, yi, vi);
  if (method === 'ML')   return tau2ML  (X, yi, vi);
  if (method === 'PM')   return tau2PM  (X, yi, vi);
  if (method === 'HS')   return tau2HS  (X, yi, vi);
  if (method === 'HE')   return tau2HE  (X, yi, vi);
  return tau2DL(X, yi, vi);  // DL and all others
}

// ---------------------------------------------------------------------------
// permTestSync — synchronous permutation test (Worker fallback).
// ---------------------------------------------------------------------------
export function permTestSync(params) {
  const {
    yi, vi, Xf: X,
    QM_obs,
    nPerm  = 999,
    seed   = 12345,
    method = 'REML',
    modTests = [],
  } = params;

  const k = yi.length;
  const p = X[0].length;
  const pm1 = p - 1;

  if (k < 2 || p < 2)
    return { error: `Permutation test requires k ≥ 2 and p ≥ 2 (got k=${k}, p=${p})` };
  if (!isFinite(QM_obs))
    return { error: 'Observed QM is not finite' };

  const omniIdxs = Array.from({ length: pm1 }, (_, j) => j + 1);
  const nMods = modTests.length;
  const QM_dist    = new Float64Array(nPerm);
  const modQM_dist = nMods > 0 ? new Float64Array(nPerm * nMods) : new Float64Array(0);

  // Position 0: observed
  QM_dist[0] = QM_obs;

  // Compute observed per-moderator QM from original X
  if (nMods > 0) {
    const tau2_obs = estimateTau2(X, yi, vi, method);
    const w_obs = vi.map(v => 1 / (v + tau2_obs));
    const { beta: b0, vcov: V0, rankDeficient: rd0 } = wls(X, yi, w_obs);
    if (!rd0) {
      for (let m = 0; m < nMods; m++) {
        const { colIdxs } = modTests[m];
        if (!colIdxs || colIdxs.length === 0) { modQM_dist[m] = NaN; continue; }
        const Vmm = subMatrix(V0, colIdxs);
        const Vinv = matInverse(Vmm);
        if (Vinv === null) { modQM_dist[m] = NaN; continue; }
        const bm = colIdxs.map(j => b0[j]);
        modQM_dist[m] = quadForm(Vinv, bm);
      }
    }
  }

  if (nPerm <= 1) return { QM_dist, modQM_dist, nPerm, nMods };

  const rand = mulberry32(seed);
  const permIdx = Array.from({ length: k }, (_, i) => i);

  for (let perm = 1; perm < nPerm; perm++) {
    // Shuffle row indices
    fisherYates(permIdx, rand);

    // Build permuted X: intercept fixed at 1, non-intercept columns permuted
    const X_perm = X.map((_, i) => {
      const srcRow = X[permIdx[i]];
      return [1, ...srcRow.slice(1)];
    });

    // Re-estimate tau2
    const tau2_p = estimateTau2(X_perm, yi, vi, method);
    const w_p = vi.map(v => 1 / (v + tau2_p));
    const { beta, vcov: V, rankDeficient: rd } = wls(X_perm, yi, w_p);

    if (rd) {
      QM_dist[perm] = NaN;
      for (let m = 0; m < nMods; m++) modQM_dist[perm * nMods + m] = NaN;
      continue;
    }

    // Omnibus QM
    if (pm1 > 0) {
      const V22 = subMatrix(V, omniIdxs);
      const V22inv = matInverse(V22);
      if (V22inv !== null) {
        const bMod = omniIdxs.map(j => beta[j]);
        QM_dist[perm] = quadForm(V22inv, bMod);
      } else {
        QM_dist[perm] = NaN;
      }
    }

    // Per-moderator QM
    for (let m = 0; m < nMods; m++) {
      const { colIdxs } = modTests[m];
      if (!colIdxs || colIdxs.length === 0) { modQM_dist[perm * nMods + m] = NaN; continue; }
      const Vmm = subMatrix(V, colIdxs);
      const Vinv = matInverse(Vmm);
      if (Vinv === null) { modQM_dist[perm * nMods + m] = NaN; continue; }
      const bm = colIdxs.map(j => beta[j]);
      modQM_dist[perm * nMods + m] = quadForm(Vinv, bm);
    }
  }

  return { QM_dist, modQM_dist, nPerm, nMods };
}

// ---------------------------------------------------------------------------
// permPval — compute permutation p-value.
// dist[0] is the observed QM (always counts as an exceedance).
// Formula: mean(dist >= observed) = #{dist >= observed} / dist.length
// ---------------------------------------------------------------------------
export function permPval(dist, observed) {
  if (!isFinite(observed)) return NaN;
  let exceeds = 0;
  for (let i = 0; i < dist.length; i++) {
    if (isFinite(dist[i]) && dist[i] >= observed) exceeds++;
  }
  return exceeds / dist.length;
}
