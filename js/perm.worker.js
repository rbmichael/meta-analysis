// =============================================================================
// perm.worker.js — Web Worker for permutation test computation
// =============================================================================
// Permutes rows of the design matrix X (moderator values) while keeping yi and
// vi fixed, then re-estimates tau2 for each permutation.  Builds the null
// distribution of the omnibus QM statistic (and per-moderator QM statistics)
// for non-parametric inference in meta-regression.
//
// This matches metafor's permutest.rma.uni() behaviour:
//   - Permutes X[sample(k), ] (moderator assignment), not yi
//   - Re-estimates tau2 using the same method as the original model
//   - Inserts QM_obs at position 0 of the distribution
//   - p-value = mean(QM_dist >= QM_obs)  [observed always counts once]
//
// Protocol
// --------
// Main thread → Worker (one message to start):
//   postMessage({
//     yi:       Float64Array(k),
//     vi:       Float64Array(k),
//     X:        Float64Array(k*p),   // row-major, includes intercept col
//     QM_obs:   number,              // observed omnibus QM
//     nPerm:    number,              // default 999 (includes observed at [0])
//     seed:     number,              // default 12345
//     p:        number,              // columns in X (includes intercept)
//     k:        number,
//     method:   string,              // "REML" | "DL" | "PM" | "ML" | "HS" | "HE"
//     nMods:    number,
//     modColIdxs: Int32Array,
//     modColLens:  Int32Array
//   })
//
// Worker → Main thread:
//   { type: 'progress', done, total, pct }
//   { type: 'done', QM_dist, modQM_dist, nPerm, nMods }
//       Typed arrays are *transferred* (zero-copy).
//   { type: 'error', message: string }
//
// Self-contained: no import/importScripts.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Mulberry32 PRNG (identical to gosh.worker.js)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Gauss-Jordan matrix inverse for a p×p matrix stored flat (row-major).
// Returns a new Float64Array of length p*p, or null if singular.
// ---------------------------------------------------------------------------
function matInv(A, p) {
  var i, j, col, row, pivot, f, tmp;
  var w = 2 * p;
  var M = new Float64Array(p * w);
  for (i = 0; i < p; i++) {
    for (j = 0; j < p; j++) M[i * w + j] = A[i * p + j];
    M[i * w + p + i] = 1.0;
  }
  for (col = 0; col < p; col++) {
    var pivotRow = col;
    var maxVal = Math.abs(M[col * w + col]);
    for (row = col + 1; row < p; row++) {
      var v = Math.abs(M[row * w + col]);
      if (v > maxVal) { maxVal = v; pivotRow = row; }
    }
    if (pivotRow !== col) {
      for (j = 0; j < w; j++) {
        tmp = M[col * w + j]; M[col * w + j] = M[pivotRow * w + j]; M[pivotRow * w + j] = tmp;
      }
    }
    pivot = M[col * w + col];
    if (Math.abs(pivot) < 1e-14) return null;
    var invP = 1.0 / pivot;
    for (j = 0; j < w; j++) M[col * w + j] *= invP;
    for (row = 0; row < p; row++) {
      if (row === col) continue;
      f = M[row * w + col];
      if (f === 0) continue;
      for (j = 0; j < w; j++) M[row * w + j] -= f * M[col * w + j];
    }
  }
  var inv = new Float64Array(p * p);
  for (i = 0; i < p; i++) for (j = 0; j < p; j++) inv[i * p + j] = M[i * w + p + j];
  return inv;
}

// ---------------------------------------------------------------------------
// Extract square sub-block of flat p×p matrix for given row/col indices.
// Returns Float64Array(n*n).
// ---------------------------------------------------------------------------
function subMatrix(V, p, idxs, n) {
  var sub = new Float64Array(n * n);
  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      sub[r * n + c] = V[idxs[r] * p + idxs[c]];
    }
  }
  return sub;
}

// ---------------------------------------------------------------------------
// Quadratic form: v' A v  for n×n flat matrix A and n-vector v.
// ---------------------------------------------------------------------------
function quadForm(A, n, v) {
  var result = 0.0;
  for (var r = 0; r < n; r++) {
    var Avr = 0.0;
    for (var c = 0; c < n; c++) Avr += A[r * n + c] * v[c];
    result += v[r] * Avr;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Quadratic form for a single row of X: X_i' A X_i
// X_flat is k*p row-major, row_i is the i-th row (0-indexed).
// ---------------------------------------------------------------------------
function quadFormRow(A, p, X_flat, i) {
  var result = 0.0;
  var base = i * p;
  for (var r = 0; r < p; r++) {
    var Avr = 0.0;
    for (var c = 0; c < p; c++) Avr += A[r * p + c] * X_flat[base + c];
    result += X_flat[base + r] * Avr;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle of an Int32Array of length k (in-place).
// ---------------------------------------------------------------------------
function fisherYates(arr, k, rand) {
  for (var i = k - 1; i > 0; i--) {
    var j = (rand() * (i + 1)) | 0;
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

// ---------------------------------------------------------------------------
// Cholesky factorization of flat p×p SPD matrix. Returns L (flat p×p) or null.
// ---------------------------------------------------------------------------
function cholFactor(A, p) {
  var L = new Float64Array(p * p);
  for (var i = 0; i < p; i++) {
    for (var j = 0; j <= i; j++) {
      var s = 0;
      for (var kk = 0; kk < j; kk++) s += L[i*p+kk] * L[j*p+kk];
      if (i === j) {
        var d = A[i*p+i] - s;
        if (d <= 0) return null;
        L[i*p+i] = Math.sqrt(d);
      } else {
        L[i*p+j] = (A[i*p+j] - s) / L[j*p+j];
      }
    }
  }
  return L;
}

// ---------------------------------------------------------------------------
// Inverse of LL' via column-by-column forward+back substitution.
// Returns flat p×p inverse (Float64Array).
// ---------------------------------------------------------------------------
function cholInverse(L, p) {
  var inv = new Float64Array(p * p);
  var x = new Float64Array(p);
  for (var j = 0; j < p; j++) {
    // Forward solve: Lx = e_j
    for (var i = 0; i < p; i++) {
      var s = (i === j) ? 1.0 : 0.0;
      for (var kk = 0; kk < i; kk++) s -= L[i*p+kk] * x[kk];
      x[i] = s / L[i*p+i];
    }
    // Back solve: L'x = fwd (overwrites x)
    for (var i = p-1; i >= 0; i--) {
      var s = x[i];
      for (var kk = i+1; kk < p; kk++) s -= L[kk*p+i] * x[kk];
      x[i] = s / L[i*p+i];
    }
    for (var i = 0; i < p; i++) inv[i*p+j] = x[i];
  }
  return inv;
}

// ---------------------------------------------------------------------------
// WLS: build XtWX + XtWy, try Cholesky, fall back to Gauss-Jordan.
// X is a FLAT k*p row-major array (or slice from permuted X).
// Returns { V, beta } or null if singular.
// ---------------------------------------------------------------------------
function wlsSolve(X_flat, yi, w, k, p) {
  var r, c, i, s;
  var XtWX = new Float64Array(p * p);
  var XtWy = new Float64Array(p);
  for (i = 0; i < k; i++) {
    var wi = w[i], wyi = wi * yi[i], base = i * p;
    for (r = 0; r < p; r++) {
      var xir = X_flat[base + r];
      XtWy[r] += xir * wyi;
      for (c = r; c < p; c++) {
        var val = wi * xir * X_flat[base + c];
        XtWX[r*p+c] += val;
        if (c !== r) XtWX[c*p+r] += val;
      }
    }
  }
  var L = cholFactor(XtWX, p);
  var V = L !== null ? cholInverse(L, p) : matInv(XtWX, p);
  if (V === null) return null;
  var beta = new Float64Array(p);
  for (r = 0; r < p; r++) {
    s = 0.0;
    for (c = 0; c < p; c++) s += V[r*p+c] * XtWy[c];
    beta[r] = s;
  }
  return { V: V, beta: beta };
}

// ---------------------------------------------------------------------------
// Dot product X_i . beta  (single row of X_flat × p-vector beta).
// ---------------------------------------------------------------------------
function rowDot(X_flat, i, beta, p) {
  var s = 0.0, base = i * p;
  for (var j = 0; j < p; j++) s += X_flat[base + j] * beta[j];
  return s;
}

// ---------------------------------------------------------------------------
// DL tau2 seed for meta-regression.
// ---------------------------------------------------------------------------
function tau2DL(X_flat, yi, vi, k, p) {
  var df = k - p;
  if (df <= 0) return 0.0;
  var w0 = new Float64Array(k);
  for (var i = 0; i < k; i++) w0[i] = 1.0 / vi[i];
  var res0 = wlsSolve(X_flat, yi, w0, k, p);
  if (res0 === null) return 0.0;
  var beta0 = res0.beta, V0 = res0.V;
  // QE (FE residual chi-square)
  var QE = 0.0;
  for (var i = 0; i < k; i++) {
    var e = yi[i] - rowDot(X_flat, i, beta0, p);
    QE += w0[i] * e * e;
  }
  // c = sum_i w0_i * (1 - w0_i * X_i' V0 X_i)
  var c = 0.0;
  for (var i = 0; i < k; i++) {
    c += w0[i] * (1.0 - w0[i] * quadFormRow(V0, p, X_flat, i));
  }
  return c > 0 ? Math.max(0, (QE - df) / c) : 0.0;
}

// ---------------------------------------------------------------------------
// REML tau2 via Fisher scoring (matches regression.js tau2Reg_REML).
// ---------------------------------------------------------------------------
function tau2REML(X_flat, yi, vi, k, p, tol, maxIter) {
  var tau2 = tau2DL(X_flat, yi, vi, k, p);
  for (var iter = 0; iter < maxIter; iter++) {
    var w = new Float64Array(k);
    for (var i = 0; i < k; i++) w[i] = 1.0 / (vi[i] + tau2);
    var res = wlsSolve(X_flat, yi, w, k, p);
    if (res === null) break;
    var beta = res.beta, V = res.V;
    var score = 0.0, info = 0.0;
    for (var i = 0; i < k; i++) {
      var h = w[i] * quadFormRow(V, p, X_flat, i);
      var e = yi[i] - rowDot(X_flat, i, beta, p);
      var pi = w[i] * (1.0 - h);
      score += w[i] * w[i] * e * e - pi;
      info  += w[i] * pi;
    }
    if (info <= 0) break;
    var step = score / info;
    var newTau2 = tau2 + step;
    var sh = 0;
    while (newTau2 < 0 && sh++ < 20) { step /= 2; newTau2 = tau2 + step; }
    newTau2 = Math.max(0, newTau2);
    if (Math.abs(newTau2 - tau2) < tol) { tau2 = newTau2; break; }
    tau2 = newTau2;
  }
  return tau2;
}

// ---------------------------------------------------------------------------
// ML tau2 via Fisher scoring (matches regression.js tau2Reg_ML).
// ---------------------------------------------------------------------------
function tau2ML(X_flat, yi, vi, k, p, tol, maxIter) {
  var tau2 = tau2DL(X_flat, yi, vi, k, p);
  for (var iter = 0; iter < maxIter; iter++) {
    var w = new Float64Array(k);
    for (var i = 0; i < k; i++) w[i] = 1.0 / (vi[i] + tau2);
    var res = wlsSolve(X_flat, yi, w, k, p);
    if (res === null) break;
    var beta = res.beta;
    var score = 0.0, info = 0.0;
    for (var i = 0; i < k; i++) {
      var vi_tau = vi[i] + tau2;
      var e = yi[i] - rowDot(X_flat, i, beta, p);
      score += e * e / (vi_tau * vi_tau) - 1.0 / vi_tau;
      info  += 1.0 / (vi_tau * vi_tau);
    }
    if (info <= 0) break;
    var step = score / info;
    var newTau2 = tau2 + step;
    var sh = 0;
    while (newTau2 < 0 && sh++ < 20) { step /= 2; newTau2 = tau2 + step; }
    newTau2 = Math.max(0, newTau2);
    if (Math.abs(newTau2 - tau2) < tol) { tau2 = newTau2; break; }
    tau2 = newTau2;
  }
  return tau2;
}

// ---------------------------------------------------------------------------
// PM (Paule-Mandel) tau2 for meta-regression.
// ---------------------------------------------------------------------------
function tau2PM(X_flat, yi, vi, k, p, tol, maxIter) {
  var df = k - p;
  if (df <= 0) return 0.0;
  var tau2 = 0.0;
  for (var iter = 0; iter < maxIter; iter++) {
    var w = new Float64Array(k);
    for (var i = 0; i < k; i++) w[i] = 1.0 / (vi[i] + tau2);
    var res = wlsSolve(X_flat, yi, w, k, p);
    if (res === null) break;
    var beta = res.beta;
    var QE = 0.0;
    for (var i = 0; i < k; i++) {
      var e = yi[i] - rowDot(X_flat, i, beta, p);
      QE += w[i] * e * e;
    }
    var sumW = 0.0;
    for (var i = 0; i < k; i++) sumW += w[i];
    var newTau2 = Math.max(0, tau2 + (QE - df) / sumW);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }
  return tau2;
}

// ---------------------------------------------------------------------------
// HS tau2 (method-of-moments with FE denominator sum(w_FE)).
// ---------------------------------------------------------------------------
function tau2HS(X_flat, yi, vi, k, p) {
  var df = k - p;
  if (df <= 0) return 0.0;
  var w0 = new Float64Array(k);
  for (var i = 0; i < k; i++) w0[i] = 1.0 / vi[i];
  var res0 = wlsSolve(X_flat, yi, w0, k, p);
  if (res0 === null) return 0.0;
  var beta0 = res0.beta;
  var QE = 0.0, sumW = 0.0;
  for (var i = 0; i < k; i++) {
    var e = yi[i] - rowDot(X_flat, i, beta0, p);
    QE += w0[i] * e * e;
    sumW += w0[i];
  }
  return sumW > 0 ? Math.max(0, (QE - df) / sumW) : 0.0;
}

// ---------------------------------------------------------------------------
// HE tau2 (unweighted OLS residuals).
// ---------------------------------------------------------------------------
function tau2HE(X_flat, yi, vi, k, p) {
  var df = k - p;
  if (df <= 0) return 0.0;
  var w1 = new Float64Array(k);
  for (var i = 0; i < k; i++) w1[i] = 1.0;
  var res1 = wlsSolve(X_flat, yi, w1, k, p);
  if (res1 === null) return 0.0;
  var beta1 = res1.beta;
  var SS = 0.0, sumV = 0.0;
  for (var i = 0; i < k; i++) {
    var e = yi[i] - rowDot(X_flat, i, beta1, p);
    SS += e * e;
    sumV += vi[i];
  }
  return Math.max(0, SS / df - sumV / k);
}

// ---------------------------------------------------------------------------
// Dispatch tau2 estimation by method name.
// ---------------------------------------------------------------------------
function estimateTau2(X_flat, yi, vi, k, p, method) {
  var TOL = 1e-10, MAX_ITER = 100;
  if (method === 'REML') return tau2REML(X_flat, yi, vi, k, p, TOL, MAX_ITER);
  if (method === 'ML')   return tau2ML  (X_flat, yi, vi, k, p, TOL, MAX_ITER);
  if (method === 'PM')   return tau2PM  (X_flat, yi, vi, k, p, TOL, MAX_ITER);
  if (method === 'HS')   return tau2HS  (X_flat, yi, vi, k, p);
  if (method === 'HE')   return tau2HE  (X_flat, yi, vi, k, p);
  return tau2DL(X_flat, yi, vi, k, p);  // DL and all others
}

// ---------------------------------------------------------------------------
// Compute QM from V (flat p*p) and beta for given column-index subsets.
// Returns { QM_omni, QM_mods_arr }.
// ---------------------------------------------------------------------------
function computeQMs(V, beta, p, pm1, omniIdxs, modIdxArrays, modVinvs, nMods) {
  var betaMod = new Float64Array(pm1);
  var QM_omni = NaN;
  if (pm1 > 0) {
    var V22 = subMatrix(V, p, omniIdxs, pm1);
    var V22inv = matInv(V22, pm1);
    if (V22inv !== null) {
      for (var j = 0; j < pm1; j++) betaMod[j] = beta[j + 1];
      QM_omni = quadForm(V22inv, pm1, betaMod);
    }
  }
  var QM_mods = new Float64Array(nMods);
  for (var m = 0; m < nMods; m++) {
    var mIdxs = modIdxArrays[m];
    var mLen  = mIdxs.length;
    var mVinv = modVinvs[m];
    if (mVinv === null || mLen === 0) { QM_mods[m] = NaN; continue; }
    var bm = new Float64Array(mLen);
    for (var jj = 0; jj < mLen; jj++) bm[jj] = beta[mIdxs[jj]];
    QM_mods[m] = quadForm(mVinv, mLen, bm);
  }
  return { QM_omni: QM_omni, QM_mods: QM_mods };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
self.onmessage = function (e) {
  var data       = e.data;
  var yi         = data.yi;
  var vi         = data.vi;
  var X          = data.X;        // flat k*p, original design matrix
  var QM_obs     = data.QM_obs;   // observed QM (inserted at position 0)
  var nPerm      = data.nPerm  !== undefined ? data.nPerm  : 999;
  var seed       = data.seed   !== undefined ? data.seed   : 12345;
  var p          = data.p;
  var k          = data.k;
  var method     = data.method  || 'REML';
  var nMods      = data.nMods   || 0;
  var modColIdxs = data.modColIdxs || new Int32Array(0);
  var modColLens = data.modColLens  || new Int32Array(0);

  if (!yi || !vi || !X || k < 2 || p < 2) {
    self.postMessage({ type: 'error', message: 'Invalid permutation inputs (k=' + k + ', p=' + p + ')' });
    return;
  }

  var pm1 = p - 1;

  // ---- Precompute per-moderator V_mm_inv from observed V ----
  // (for computing QM_mods in each permutation — they use the permuted V)
  var modIdxArrays = new Array(nMods);
  var offset = 0;
  for (var m = 0; m < nMods; m++) {
    var len  = modColLens[m];
    var idxs = new Int32Array(len);
    for (var jj = 0; jj < len; jj++) idxs[jj] = modColIdxs[offset + jj];
    offset += len;
    modIdxArrays[m] = idxs;
  }

  // ---- omniIdxs: columns 1..p-1 (all non-intercept) ----
  var omniIdxs = new Int32Array(pm1);
  for (var j = 0; j < pm1; j++) omniIdxs[j] = j + 1;

  // ---- Output buffers ----
  var QM_dist    = new Float64Array(nPerm);
  var modQM_dist = (nMods > 0) ? new Float64Array(nPerm * nMods) : new Float64Array(0);

  // ---- Position 0: observed data ----
  QM_dist[0] = QM_obs;
  // For per-moderator: compute observed per-mod QM
  // We need to re-derive V from the original X to get modVinvs
  {
    var tau2_obs = estimateTau2(X, yi, vi, k, p, method);
    var w_obs = new Float64Array(k);
    for (var i = 0; i < k; i++) w_obs[i] = 1.0 / (vi[i] + tau2_obs);
    var res_obs = wlsSolve(X, yi, w_obs, k, p);
    if (res_obs !== null && nMods > 0) {
      var modVinvs_obs = new Array(nMods);
      for (var m = 0; m < nMods; m++) {
        var idxs = modIdxArrays[m];
        if (idxs.length === 0) { modVinvs_obs[m] = null; continue; }
        var Vmm = subMatrix(res_obs.V, p, idxs, idxs.length);
        modVinvs_obs[m] = matInv(Vmm, idxs.length);
      }
      var q0 = computeQMs(res_obs.V, res_obs.beta, p, pm1, omniIdxs, modIdxArrays, modVinvs_obs, nMods);
      // QM_obs might differ slightly from q0.QM_omni due to rounding; keep data.QM_obs
      for (var m = 0; m < nMods; m++) modQM_dist[0 * nMods + m] = q0.QM_mods[m];
    }
  }

  if (nPerm <= 1) {
    self.postMessage(
      { type: 'done', QM_dist: QM_dist, modQM_dist: modQM_dist, nPerm: nPerm, nMods: nMods },
      [QM_dist.buffer, modQM_dist.buffer]
    );
    return;
  }

  // ---- PRNG ----
  var rand = mulberry32(seed);

  // ---- Permutation index array ----
  var permIdx = new Int32Array(k);
  for (var i = 0; i < k; i++) permIdx[i] = i;

  // ---- X_perm buffer (flat k*p, reused each iteration) ----
  var X_perm = new Float64Array(k * p);

  // ---- Adaptive progress chunk ----
  var progressChunk = Math.max(1, Math.floor((nPerm - 1) / 100));

  for (var perm = 1; perm < nPerm; perm++) {
    // Fisher-Yates shuffle of permIdx
    fisherYates(permIdx, k, rand);

    // Build permuted design matrix:
    // intercept column stays 1; non-intercept columns come from row permIdx[i]
    for (var i = 0; i < k; i++) {
      X_perm[i * p] = 1.0;  // intercept (always 1)
      var srcRow = permIdx[i] * p;
      for (var j = 1; j < p; j++) {
        X_perm[i * p + j] = X[srcRow + j];
      }
    }

    // Re-estimate tau2 for permuted X (yi and vi fixed)
    var tau2_perm = estimateTau2(X_perm, yi, vi, k, p, method);

    // WLS with permuted X and re-estimated tau2
    var w_perm = new Float64Array(k);
    for (var i = 0; i < k; i++) w_perm[i] = 1.0 / (vi[i] + tau2_perm);
    var res = wlsSolve(X_perm, yi, w_perm, k, p);

    if (res === null) {
      QM_dist[perm] = NaN;
      for (var m = 0; m < nMods; m++) modQM_dist[perm * nMods + m] = NaN;
    } else {
      // Per-moderator V_mm_inv for this permutation
      var modVinvs = new Array(nMods);
      for (var m = 0; m < nMods; m++) {
        var idxs = modIdxArrays[m];
        if (idxs.length === 0) { modVinvs[m] = null; continue; }
        var Vmm = subMatrix(res.V, p, idxs, idxs.length);
        modVinvs[m] = matInv(Vmm, idxs.length);
      }
      var q = computeQMs(res.V, res.beta, p, pm1, omniIdxs, modIdxArrays, modVinvs, nMods);
      QM_dist[perm] = q.QM_omni;
      for (var m = 0; m < nMods; m++) modQM_dist[perm * nMods + m] = q.QM_mods[m];
    }

    // Progress
    if ((perm) % progressChunk === 0) {
      self.postMessage({ type: 'progress', done: perm, total: nPerm - 1, pct: perm / (nPerm - 1) });
    }
  }

  // ---- Transfer results (zero-copy) ----
  self.postMessage(
    { type: 'done', QM_dist: QM_dist, modQM_dist: modQM_dist, nPerm: nPerm, nMods: nMods },
    [QM_dist.buffer, modQM_dist.buffer]
  );
};
