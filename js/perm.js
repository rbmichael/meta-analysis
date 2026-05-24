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

import { matInverse, wls, wlsCholesky } from "./linalg.js";
import { tau2Core_DL, tau2Core_HS, tau2Core_HE, tau2Core_REML, tau2Core_ML, tau2Core_PM } from "./tau2.js";

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
// Build FE fitFn0 for tau2Core_DL / tau2Core_HS: FE-weighted WLS residuals.
// ---------------------------------------------------------------------------
function buildFeFit0(X, yi, vi) {
  return function () {
    const w0 = vi.map(v => 1 / v);
    const { beta, vcov: V, rankDeficient: rd } = wlsCholesky(X, yi, w0);
    if (rd) return null;
    const e = yi.map((y, i) => y - X[i].reduce((a, xi, j) => a + xi * beta[j], 0));
    const h = vi.map((v, i) => (1 / v) * quadForm(V, X[i]));
    const W = w0.reduce((s, wi) => s + wi, 0);
    return { e, h, W };
  };
}

// ---------------------------------------------------------------------------
// Build RE fitFn for tau2Core_REML / tau2Core_ML / tau2Core_PM: RE-weighted WLS residuals.
// ---------------------------------------------------------------------------
function buildReFitFn(X, yi, vi) {
  return function (tau2) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, vcov: V, rankDeficient: rd } = wlsCholesky(X, yi, w);
    if (rd) return null;
    const e = yi.map((y, i) => y - X[i].reduce((a, xi, j) => a + xi * beta[j], 0));
    const h = w.map((wi, i) => wi * quadForm(V, X[i]));
    const W = w.reduce((s, wi) => s + wi, 0);
    return { e, h, W };
  };
}

// ---------------------------------------------------------------------------
// Dispatch tau2 estimation by method name.
// Delegates to tau2Core_* (tau2.js); fitFns built from the X matrix.
// ---------------------------------------------------------------------------
function estimateTau2(X, yi, vi, method) {
  const k = yi.length, p = X[0].length, df = k - p;
  if (df <= 0) return 0;
  const feFit0  = buildFeFit0(X, yi, vi);
  const reFitFn = buildReFitFn(X, yi, vi);
  if (method === 'REML') return tau2Core_REML(vi, reFitFn, tau2Core_DL(vi, feFit0, df));
  if (method === 'ML')   return tau2Core_ML  (vi, reFitFn, tau2Core_DL(vi, feFit0, df));
  if (method === 'PM')   return tau2Core_PM  (vi, reFitFn, df, 0);
  if (method === 'HS')   return tau2Core_HS  (vi, feFit0, df);
  if (method === 'HE') {
    const w1 = vi.map(() => 1);
    const { beta, rankDeficient: rd } = wls(X, yi, w1);
    if (rd) return 0;
    const e = yi.map((y, i) => y - X[i].reduce((a, xi, j) => a + xi * beta[j], 0));
    return tau2Core_HE(vi, () => ({ e }), df);
  }
  return tau2Core_DL(vi, feFit0, df);  // DL and all others
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
    const { beta: b0, vcov: V0, rankDeficient: rd0 } = wlsCholesky(X, yi, w_obs);
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
    const { beta, vcov: V, rankDeficient: rd } = wlsCholesky(X_perm, yi, w_p);

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
