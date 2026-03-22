import { meta } from "./analysis.js";

// Duval & Tweedie (2000) Trim and Fill — L0 estimator
// Iterates until the number of imputed studies (k0) stabilises,
// then returns mirror-image filled studies reflected around the
// converged pooled estimate.
export function trimFill(studies, method = "DL", maxIter = 100) {
  if (studies.length < 3) return [];

  const k = studies.length;

  // ---- helpers ----
  function assignRanks(deviations) {
    // Rank by |d|, smallest = rank 1
    const sorted = [...deviations]
      .map((d, i) => ({ i, abs: Math.abs(d) }))
      .sort((a, b) => a.abs - b.abs);
    const ranks = new Array(k);
    sorted.forEach((item, ri) => { ranks[item.i] = ri + 1; });
    return ranks;
  }

  function estimateK0(studies, center) {
    const d = studies.map(s => s.yi - center);
    const ranks = assignRanks(d);

    // Sum of ranks for the right side (positive deviations)
    let Tn = 0;
    d.forEach((di, i) => { if (di > 0) Tn += ranks[i]; });

    // L0 formula (Duval & Tweedie 2000, eq. 5)
    const raw = (4 * Tn - k * (k + 1) / 2) / (2 * k - 1);
    return Math.max(0, Math.round(raw));
  }

  // ---- iterative L0 ----
  let center = meta(studies, method).RE;
  let k0 = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    const k0_new = estimateK0(studies, center);

    if (k0_new === k0) break;   // converged
    k0 = k0_new;

    if (k0 === 0) break;

    // Trim the k0 most extreme studies from the larger side,
    // then re-estimate the center from the trimmed set.
    const deviations = studies.map((s, i) => ({ i, d: s.yi - center }));
    const nRight = deviations.filter(s => s.d > 0).length;
    const nLeft  = deviations.filter(s => s.d < 0).length;
    const largerIsRight = nRight >= nLeft;

    const toTrim = new Set(
      deviations
        .filter(s => largerIsRight ? s.d > 0 : s.d < 0)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
        .slice(0, k0)
        .map(s => s.i)
    );

    const trimmed = studies.filter((_, i) => !toTrim.has(i));
    if (trimmed.length < 1) break;

    center = meta(trimmed, method).RE;
  }

  if (k0 === 0) return [];

  // ---- build filled (mirror-image) studies ----
  const deviations = studies.map((s, i) => ({ i, d: s.yi - center, s }));
  const nRight = deviations.filter(s => s.d > 0).length;
  const nLeft  = deviations.filter(s => s.d < 0).length;
  const largerIsRight = nRight >= nLeft;

  const toMirror = deviations
    .filter(s => largerIsRight ? s.d > 0 : s.d < 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, k0);

  return toMirror.map(({ s }) => {
    const yi = 2 * center - s.yi;
    return {
      ...s,
      yi,
      md: yi,
      label: s.label + " (filled)",
      filled: true
    };
  });
}
