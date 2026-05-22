// =============================================================================
// trimfill.js — Trim-and-Fill publication bias correction
// =============================================================================
// Implements the Duval & Tweedie (2000) Trim and Fill method using three
// rank-based estimators for the number of missing studies (k0):
//
//   L0 — Rank sum: k0 = (4·Sr − k(k+1)) / (2k−1)
//   R0 — Run test: k0 = (k − max_rank_on_smaller_side) − 1
//   Q0 — Chi-square: k0 = k − ½ − √(2k² − 4·Sr + ¼)
//
// Algorithm matches metafor 4.8-0 trimfill.rma.uni() exactly.
// Cross-validated on BCG (RR, DL) and a mixed k=12 dataset.
//
// Exports
// -------
//   trimFill(studies, method, estimator, maxIter) → study[]
//     studies   — array of { yi, vi, label } objects
//     method    — τ² estimator passed to meta() (default "DL")
//     estimator — "L0" | "R0" | "Q0" (default "L0")
//     maxIter   — convergence iteration cap (default 100)
//     Returns only the imputed (filled) studies; caller combines
//     them with the originals to form the augmented dataset.
//
// Dependencies
// ------------
//   analysis.js  meta()
//   linalg.js    wls()

import { meta } from "./analysis.js";
import { wls } from "./linalg.js";

// ---------------------------------------------------------------------------
// Internal helper: stable argsort (ascending yi)
// ---------------------------------------------------------------------------
function argsort(arr) {
  return arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
}

// ---------------------------------------------------------------------------
// Internal helper: rank absolute values, ties broken by first occurrence
// (matches R's rank(ties.method="first"))
// ---------------------------------------------------------------------------
function rankAbs(absVals) {
  const k = absVals.length;
  const order = absVals.map((v, i) => i).sort((a, b) => absVals[a] - absVals[b]);
  const ranks = new Array(k);
  order.forEach((origIdx, ri) => { ranks[origIdx] = ri + 1; });
  return ranks;
}

// ---------------------------------------------------------------------------
// Internal helper: determine which side to fill.
// Fits a WLS regression yi ~ 1 + sqrt(vi) with weights 1/vi.
// If the slope (β₁) < 0 → side = "right" (negate yi).
// If all vi are equal sqrt(vi) is constant → regression fails → fall back
// to counting: if right side has more studies, side = "left" (no flip).
// ---------------------------------------------------------------------------
function detectSide(studies, center) {
  const k = studies.length;
  // Try WLS regression yi ~ [1, sqrt(vi)] with w = 1/vi
  try {
    const X = studies.map(s => [1, Math.sqrt(s.vi)]);
    const y = studies.map(s => s.yi);
    const w = studies.map(s => 1 / s.vi);
    const beta = wls(X, y, w);
    if (isFinite(beta[1])) return beta[1] < 0 ? "right" : "left";
  } catch (_) { /* fall through */ }
  // Fallback: count which side of the current center has more studies.
  // "left" means right-side excess → fill on left; "right" means left excess → fill right.
  const nRight = studies.filter(s => s.yi > center).length;
  const nLeft  = studies.filter(s => s.yi < center).length;
  return nRight >= nLeft ? "left" : "right";
}

// ---------------------------------------------------------------------------
// Duval & Tweedie (2000) Trim and Fill — L0, R0, Q0 estimators.
// Algorithm matches metafor 4.8-0 trimfill.rma.uni().
// ---------------------------------------------------------------------------
export function trimFill(studies, method = "DL", estimator = "L0", maxIter = 100) {
  if (studies.length < 3) return [];

  const k = studies.length;

  // ---- Initial center for side detection ----
  const initCenter = meta(studies, method).RE;
  if (!isFinite(initCenter)) return [];

  // ---- Side detection ----
  const side = detectSide(studies, initCenter);
  const flip = side === "right" ? -1 : 1;   // negate if side="right"

  // ---- Work in flipped scale; sort ascending ----
  const flippedYi = studies.map(s => flip * s.yi);
  const sortedIdx = argsort(flippedYi);
  const yiSorted  = sortedIdx.map(i => flippedYi[i]);
  const viSorted  = sortedIdx.map(i => studies[i].vi);
  const stSorted  = sortedIdx.map(i => studies[i]);

  // ---- Iterative k0 estimation ----
  let k0       = 0;
  let center   = 0;   // center in the flipped scale
  let tau2Warm = null; // warm-start seed: previous iteration's converged τ²

  for (let iter = 0; iter < maxIter; iter++) {
    const k0Prev = k0;

    // Trim k0 from the right end (largest values in flipped scale).
    const yiTrim = yiSorted.slice(0, k - k0);
    const viTrim = viSorted.slice(0, k - k0);
    const trimStudies = yiTrim.map((yi, i) => ({ yi, vi: viTrim[i] }));

    // tau2Warm passes the previous iteration's converged τ² as the starting
    // seed.  Between iterations only one study is removed/added, so the
    // solution barely moves — typically 1–3 Newton/fixed-point steps suffice
    // instead of the 50–100 cold-start iterations for REML/ML/PM/SJ.
    const m = meta(trimStudies, method, "normal", 0.05, tau2Warm);
    if (!isFinite(m.RE)) break;
    tau2Warm = m.tau2;   // capture for next iteration
    center = m.RE;

    // Signed ranks of ALL k studies from the converged center.
    const deviations  = yiSorted.map(y => y - center);
    const absDevs     = deviations.map(d => Math.abs(d));
    const ranks       = rankAbs(absDevs);
    const signedRanks = deviations.map((d, i) => Math.sign(d) * ranks[i]);

    // Estimate k0 from signed ranks.
    let k0Raw;
    if (estimator === "L0") {
      const Sr = signedRanks.reduce((acc, r) => r > 0 ? acc + r : acc, 0);
      k0Raw = (4 * Sr - k * (k + 1)) / (2 * k - 1);
    } else if (estimator === "R0") {
      // Find the largest rank among the smaller (negative-deviation) side.
      // k0 = (k − that_rank) − 1.
      const negRanks = signedRanks.filter(r => r < 0).map(r => -r);
      if (negRanks.length === 0) {
        k0Raw = k - 1;   // all studies on one side
      } else {
        k0Raw = (k - Math.max(...negRanks)) - 1;
      }
    } else {  // Q0
      const Sr = signedRanks.reduce((acc, r) => r > 0 ? acc + r : acc, 0);
      const disc = 2 * k * k - 4 * Sr + 0.25;
      k0Raw = disc >= 0 ? k - 0.5 - Math.sqrt(disc) : 0;
    }

    k0 = Math.max(0, Math.round(k0Raw));
    if (k0 === k0Prev) break;
  }

  if (k0 === 0) return [];

  // ---- Build filled (mirror-image) studies ----
  // The k0 rightmost in the sorted-flipped scale are the trimmed excess.
  // Their mirrors are: filled_yi_flipped = 2·center − orig_yi_flipped.
  // Un-flip: filled_yi = flip * filled_yi_flipped.
  const toFill = stSorted.slice(k - k0);
  return toFill.map(orig => {
    const origFlipped   = flip * orig.yi;
    const filledFlipped = 2 * center - origFlipped;
    const yi = flip * filledFlipped;
    return { ...orig, yi, md: yi, label: orig.label + " (filled)", filled: true };
  });
}
