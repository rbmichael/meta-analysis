// =============================================================================
// gosh.js — GOSH plot computation (Graphical Display of Study Heterogeneity)
// =============================================================================
// Harbord & Higgins (2008): for every non-empty subset of the k studies,
// compute the FE pooled estimate and I²; scatter-plotting the results reveals
// influential studies and heterogeneity patterns invisible in leave-one-out.
//
// Exports
// -------
//   goshCompute(yi, vi, opts) → GoshResult | { error: string }
//
//     yi, vi — arrays of k effect sizes and variances (finite, vi > 0)
//     opts:
//       maxSubsets — max subsets when sampling (default GOSH_DEFAULT_MAX_SUBSETS)
//       seed       — integer PRNG seed for reproducible sampling (default 12345)
//
//     Returns {
//       mu:      Float32Array(count)  — FE pooled estimate per subset (analysis scale)
//       I2:      Float32Array(count)  — I² (%) per subset, in [0, 100]
//       Q:       Float64Array(count)  — Cochran's Q per subset (kept Float64 for accuracy)
//       n:       Uint8Array(count)    — subset size (number of studies)
//       count:   number               — total subsets computed
//       k:       number               — number of input studies
//       sampled: boolean              — true when count < 2^k − 1
//     }
//     or { error: string } for invalid input.
//
// Enumeration vs sampling
// -----------------------
//   k ≤ GOSH_MAX_ENUM_K (15):  enumerate all 2^k − 1 ≤ 32 767 subsets exactly.
//                               Enumerated results are stored at index mask−1,
//                               so the full-dataset entry is always the last.
//                               Threshold is conservative: k=16 (65 535 subsets,
//                               ~0.3 ms off-thread) could be enumerated, but 15
//                               keeps output arrays under ~600 KB and avoids the
//                               Set deduplication overhead in the sampling path.
//   k ≤ GOSH_MAX_K      (30):  random sample of min(maxSubsets, 2^k−1) subsets
//                               without replacement (Mulberry32 PRNG).
//   k >  GOSH_MAX_K         :  return { error }.
//
// Sampling coverage at high k (maxSubsets = 50 000 default):
//   k=16 : 50K / 65 535       ≈  76 %  (near-complete)
//   k=20 : 50K / 1 048 575    ≈   5 %  (sparse)
//   k=25 : 50K / 33 554 431   ≈ 0.15 % (very sparse)
//   k=30 : 50K / 1 073 741 823 ≈ 0.005% (point-sample; patterns visible but
//                                          not statistically representative)
// For k ≥ 20 consider raising maxSubsets (200 000+) via the UI control.
//
// Worker handoff
// --------------
//   The main thread always attempts to create a Web Worker and posts the job
//   there.  There is no "too small to bother" threshold: even for k=2 (one
//   subset) the Worker is preferred because it keeps the UI responsive.
//   Fallback to synchronous goshCompute() occurs only if the Worker fails to
//   load (e.g. file:// security restriction in Chrome).
//
// Q formula
// ---------
//   Single-pass: Q = Σ(wᵢyᵢ²) − (Σwᵢyᵢ)²/Σwᵢ
//   Equivalent to the standard Σwᵢ(yᵢ−μ̂)² but avoids a second loop.
//
// Dependencies: none — self-contained so it can be imported by a Web Worker.
// =============================================================================

export const GOSH_MAX_ENUM_K          = 15;   // 2^15−1 = 32 767 max enumerated subsets
export const GOSH_MAX_K               = 30;
export const GOSH_DEFAULT_MAX_SUBSETS = 50_000;

// ---------------------------------------------------------------------------
// Mulberry32 — fast seedable PRNG; returns doubles in [0, 1).
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
// goshCompute
// ---------------------------------------------------------------------------
export function goshCompute(yi, vi, opts = {}) {
  const k = yi.length;

  // ---- Input validation ----
  if (k !== vi.length)
    return { error: "yi and vi must have the same length" };
  if (k < 2)
    return { error: `GOSH requires at least 2 studies (got ${k})` };
  if (k > GOSH_MAX_K)
    return { error: `GOSH supports at most ${GOSH_MAX_K} studies (got ${k})` };

  const maxSubsets = opts.maxSubsets !== undefined ? opts.maxSubsets : GOSH_DEFAULT_MAX_SUBSETS;
  const seed       = opts.seed       !== undefined ? opts.seed       : 12345;

  // ---- Precompute per-study quantities (avoids recomputation per subset) ----
  const wi    = new Float64Array(k);  // wᵢ = 1/vᵢ
  const yiwi  = new Float64Array(k);  // yᵢwᵢ
  const yi2wi = new Float64Array(k);  // yᵢ²wᵢ  (for single-pass Q)
  for (let i = 0; i < k; i++) {
    const w  = vi[i] > 0 ? 1 / vi[i] : 0;
    wi[i]    = w;
    yiwi[i]  = yi[i] * w;
    yi2wi[i] = yi[i] * yi[i] * w;
  }

  // ---- Determine strategy ----
  // Use 2**k (floating-point) so N stays exact for k up to 53.
  const N       = 2 ** k - 1;           // total non-empty subsets
  const sampled = k > GOSH_MAX_ENUM_K;
  const count   = sampled ? Math.min(maxSubsets, N) : N;

  // ---- Output buffers ----
  // Float32 for mu and I2: 7 significant digits is more than enough for display,
  // and halves their memory vs Float64 (~4 MB vs ~8 MB at 1 M subsets each).
  // Q stays Float64 so downstream heterogeneity arithmetic stays accurate.
  const muArr = new Float32Array(count);
  const I2Arr = new Float32Array(count);
  const QArr  = new Float64Array(count);
  const nArr  = new Uint8Array(count);

  // ---- Inner computation for a single mask ----
  // mask: integer with bit i set iff study i is included (bits 0..k−1).
  // Bitwise ops are safe for k ≤ 30 (max bit index = 29 → no sign overflow).
  function processSubset(mask, idx) {
    let W = 0, Wmu = 0, Wmu2 = 0, n = 0;
    for (let i = 0; i < k; i++) {
      if ((mask >>> i) & 1) {
        W    += wi[i];
        Wmu  += yiwi[i];
        Wmu2 += yi2wi[i];
        n++;
      }
    }
    if (W === 0) return;
    const mu = Wmu / W;
    // n=1: no heterogeneity possible; guard against floating-point non-zero residual.
    const Q  = n > 1 ? Math.max(0, Wmu2 - Wmu * Wmu / W) : 0;
    const I2 = (n > 1 && Q > 0) ? Math.max(0, (Q - (n - 1)) / Q) * 100 : 0;
    muArr[idx] = mu;
    QArr[idx]  = Q;
    I2Arr[idx] = I2;
    nArr[idx]  = n;
  }

  if (!sampled) {
    // ---- Full enumeration: mask = 1 … 2^k − 1 ----
    // Index = mask − 1, so the full-dataset subset (mask = 2^k−1) is last.
    for (let mask = 1; mask <= N; mask++) {
      processSubset(mask, mask - 1);
    }
  } else {
    // ---- Random sampling without replacement ----
    // Generate k random bits per mask; retry if all-zero or already seen.
    // Expected collision rate is maxSubsets/N, which is small for k > 20.
    const rand = mulberry32(seed);
    const seen = new Set();
    let   idx  = 0;
    while (idx < count) {
      let mask = 0;
      for (let j = 0; j < k; j++) {
        if (rand() < 0.5) mask |= (1 << j);
      }
      if (mask === 0 || seen.has(mask)) continue;
      seen.add(mask);
      processSubset(mask, idx);
      idx++;
    }
  }

  return { mu: muArr, I2: I2Arr, Q: QArr, n: nArr, count, k, sampled };
}
