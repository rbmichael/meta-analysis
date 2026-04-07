// =============================================================================
// gosh.worker.js — Web Worker for GOSH plot computation
// =============================================================================
// Runs the GOSH subset enumeration/sampling on a background thread so the UI
// stays responsive.  Self-contained: no import/importScripts — all math is
// inlined from gosh.js so this file works as a classic Worker from file://.
//
// Protocol
// --------
// Main thread → Worker (one message to start):
//   postMessage({ yi, vi, maxSubsets?, seed? })
//     yi, vi      — plain Arrays or Float64Arrays of k values
//     maxSubsets  — max subsets when sampling k > 20  (default 50 000)
//     seed        — integer PRNG seed                  (default 12 345)
//
// Worker → Main thread (zero or more progress, then exactly one terminal):
//   { type: 'progress', done: number, total: number, pct: number }
//       Sent roughly every 1 % of total work.  pct is in [0, 1).
//   { type: 'done', mu, I2, Q, n, count, k, sampled }
//       Typed arrays are *transferred* (zero-copy); caller must not reuse them
//       after this message because the Worker's copies become detached.
//   { type: 'error', message: string }
//       Sent instead of 'done' when input is invalid.
//
// Cancellation
// ------------
// Terminate the Worker from the main thread via worker.terminate().  The Worker
// will stop mid-computation; no cleanup is necessary.
//
// file:// note
// ------------
// Chrome blocks Workers loaded from file:// unless launched with
// --allow-file-access-from-files.  The UI (ui.js) wraps Worker creation in
// try/catch and falls back to chunked setTimeout on the main thread when the
// Worker cannot be created.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Constants (mirrors gosh.js)
// ---------------------------------------------------------------------------
var GOSH_MAX_ENUM_K          = 15;   // 2^15−1 = 32 767 max enumerated subsets
var GOSH_MAX_K               = 30;
var GOSH_DEFAULT_MAX_SUBSETS = 50000;

// ---------------------------------------------------------------------------
// Mulberry32 PRNG — seedable, fast; returns doubles in [0, 1).
// (Identical to gosh.js — inlined to keep this file self-contained.)
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
// Message handler
// ---------------------------------------------------------------------------
self.onmessage = function (e) {
  var data       = e.data;
  var yi         = data.yi;
  var vi         = data.vi;
  var maxSubsets = data.maxSubsets !== undefined ? data.maxSubsets : GOSH_DEFAULT_MAX_SUBSETS;
  var seed       = data.seed       !== undefined ? data.seed       : 12345;

  var k = yi.length;

  // ---- Input validation ----
  if (k !== vi.length) {
    self.postMessage({ type: 'error', message: 'yi and vi must have the same length' });
    return;
  }
  if (k < 2) {
    self.postMessage({ type: 'error', message: 'GOSH requires at least 2 studies (got ' + k + ')' });
    return;
  }
  if (k > GOSH_MAX_K) {
    self.postMessage({ type: 'error', message: 'GOSH supports at most ' + GOSH_MAX_K + ' studies (got ' + k + ')' });
    return;
  }

  // ---- Precompute per-study quantities ----
  var wi    = new Float64Array(k);
  var yiwi  = new Float64Array(k);
  var yi2wi = new Float64Array(k);
  for (var i = 0; i < k; i++) {
    var w   = vi[i] > 0 ? 1 / vi[i] : 0;
    wi[i]   = w;
    yiwi[i] = yi[i] * w;
    yi2wi[i] = yi[i] * yi[i] * w;
  }

  // ---- Determine strategy ----
  var N       = Math.pow(2, k) - 1;      // total non-empty subsets
  var sampled = k > GOSH_MAX_ENUM_K;
  var count   = sampled ? Math.min(maxSubsets, N) : N;

  // ---- Output buffers ----
  // Float32 for mu/I2 (display precision), Float64 for Q (accuracy), Uint8 for n.
  var muArr = new Float32Array(count);
  var I2Arr = new Float32Array(count);
  var QArr  = new Float64Array(count);
  var nArr  = new Uint8Array(count);

  // ---- Adaptive progress chunk: aim for ~100 updates total ----
  var progressChunk = Math.max(1000, Math.floor(count / 100));

  // ---- Inner computation for one mask ----
  function processSubset(mask, idx) {
    var W = 0, Wmu = 0, Wmu2 = 0, n = 0;
    for (var i = 0; i < k; i++) {
      if ((mask >>> i) & 1) {
        W    += wi[i];
        Wmu  += yiwi[i];
        Wmu2 += yi2wi[i];
        n++;
      }
    }
    if (W === 0) return;
    var mu = Wmu / W;
    var Q  = n > 1 ? Math.max(0, Wmu2 - Wmu * Wmu / W) : 0;
    var I2 = (n > 1 && Q > 0) ? Math.max(0, (Q - (n - 1)) / Q) * 100 : 0;
    muArr[idx] = mu;
    QArr[idx]  = Q;
    I2Arr[idx] = I2;
    nArr[idx]  = n;
  }

  if (!sampled) {
    // ---- Full enumeration ----
    for (var mask = 1; mask <= N; mask++) {
      processSubset(mask, mask - 1);
      if (mask % progressChunk === 0) {
        self.postMessage({ type: 'progress', done: mask, total: count, pct: mask / count });
      }
    }
  } else {
    // ---- Random sampling without replacement ----
    var rand = mulberry32(seed);
    var seen = new Set();
    var idx  = 0;
    while (idx < count) {
      var mask = 0;
      for (var j = 0; j < k; j++) {
        if (rand() < 0.5) mask |= (1 << j);
      }
      if (mask === 0 || seen.has(mask)) continue;
      seen.add(mask);
      processSubset(mask, idx);
      idx++;
      if (idx % progressChunk === 0) {
        self.postMessage({ type: 'progress', done: idx, total: count, pct: idx / count });
      }
    }
  }

  // ---- Transfer results (zero-copy) ----
  self.postMessage(
    { type: 'done', mu: muArr, I2: I2Arr, Q: QArr, n: nArr, count: count, k: k, sampled: sampled },
    [muArr.buffer, I2Arr.buffer, QArr.buffer, nArr.buffer]
  );
};
