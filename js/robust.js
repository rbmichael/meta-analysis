// =============================================================================
// robust.js — Cluster-robust (sandwich) variance estimation
// =============================================================================
// Exports
// -------
//   sandwichVar(X, w, residuals, clusterIds)
//     CR1 sandwich variance matrix for a WLS estimator.
//     Returns { V_rob, SE_rob, df, C, B, allSingletons } or { error }.
//
//   robustWlsResult(X, w, y, beta, clusterIds)
//     Post-processes a WLS fit with cluster-robust SEs via sandwichVar.
//     Returns { robustSE, robustZ, robustP, robustCi, df, C, allSingletons } or { error }.
//
//   robustMeta(studies, method, ciMethod, alpha)
//     Wraps meta() and appends cluster-robust pooled-estimate SE/CI.
//     Returns meta() result extended with robustSE, robustCiLow, robustCiHigh,
//     robustStat, robustPval, robustDf, clustersUsed, isClustered, allSingletons.
//     Falls back to plain meta() when no cluster IDs present.
//
// Dependencies
// ------------
//   linalg.js  — matInverse
//   utils.js   — tCritical, tCDF, normalCDF, normalQuantile
//   constants.js — MIN_VAR, Z_95
//   analysis.js  — meta  (circular import: robust → analysis → robust via re-export;
//                  safe because meta is only called inside robustMeta's function body,
//                  never at module initialisation time)
// =============================================================================

import { matInverse } from "./linalg.js";
import { tCritical, tCDF, normalCDF, normalQuantile } from "./utils.js";
import { MIN_VAR, Z_95 } from "./constants.js";
// Circular import — safe: meta() only called inside robustMeta function body.
import { meta } from "./analysis.js";


// ================= SANDWICH (CLUSTER-ROBUST) VARIANCE ESTIMATOR =================
// Computes the cluster-robust (sandwich) variance matrix for a WLS estimator.
//
// Parameters
// ----------
//   X          — k×p design matrix (array of k p-vectors)
//   w          — k-vector of weights w_i
//   residuals  — k-vector of residuals ê_i = y_i − x_i'β̂
//   clusterIds — k-vector of cluster identifiers (strings/numbers).
//                Rows with null/undefined/empty string are treated as singletons.
//
// Returns
// -------
//   { V_rob, SE_rob, df, C, B, allSingletons }  on success
//   { error }  when C < 2 or C ≤ p
//
//   V_rob       — p×p robust variance matrix (array of p p-vectors)
//   SE_rob      — p-vector of robust SEs (sqrt of diagonal of V_rob)
//   df          — C − p  (degrees of freedom for small-sample t CI)
//   C           — number of clusters
//   B           — p×p meat matrix
//   allSingletons — true if every cluster contains exactly one study
//
// Small-sample correction: V_rob is multiplied by C/(C−p), consistent with
// the CR1 correction in R's clubSandwich package.
export function sandwichVar(X, w, residuals, clusterIds) {
  const k = residuals.length;
  const p = X[0].length;

  // Assign a cluster label to every row; missing/blank → unique singleton key
  const ids = Array.from({ length: k }, (_, i) => {
    const id = clusterIds ? clusterIds[i] : null;
    return (id !== null && id !== undefined && String(id).trim() !== "")
      ? String(id).trim()
      : `__s_${i}`;
  });

  // Group row indices by cluster
  const clusterMap = new Map();
  for (let i = 0; i < k; i++) {
    const id = ids[i];
    if (!clusterMap.has(id)) clusterMap.set(id, []);
    clusterMap.get(id).push(i);
  }
  const C = clusterMap.size;
  const allSingletons = [...clusterMap.values()].every(rows => rows.length === 1);

  if (C < 2)  return { error: "Need at least 2 clusters for robust SE." };
  if (C <= p) return { error: `Fewer clusters (C=${C}) than parameters (p=${p}); robust SE not available.` };

  // A = (X'WX)^{-1}
  const XtWX = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < k; i++) {
    const wi = w[i];
    for (let j = 0; j < p; j++) {
      for (let l = j; l < p; l++) {
        const v = wi * X[i][j] * X[i][l];
        XtWX[j][l] += v;
        if (l !== j) XtWX[l][j] += v;
      }
    }
  }
  const A = matInverse(XtWX);
  if (A === null) return { error: "Design matrix is singular; robust SE not available." };

  // Small-sample CR1 correction: C / (C − p)
  const cr1 = C / (C - p);

  // Meat B = Σ_c g_c g_c'   where g_c = Σ_{i∈c} w_i X[i] ê_i   (p-vector)
  const B = Array.from({ length: p }, () => Array(p).fill(0));
  for (const clRows of clusterMap.values()) {
    const g = Array(p).fill(0);
    for (const i of clRows) {
      const wiei = w[i] * residuals[i];
      for (let j = 0; j < p; j++) g[j] += X[i][j] * wiei;
    }
    for (let j = 0; j < p; j++) {
      for (let l = 0; l < p; l++) B[j][l] += g[j] * g[l];
    }
  }

  // V_rob = cr1 · A B A   (A is symmetric)
  // First compute AB, then V_rob[j][l] = cr1 · Σ_m AB[j][m] · A[l][m]
  const AB = Array.from({ length: p }, () => Array(p).fill(0));
  for (let j = 0; j < p; j++)
    for (let l = 0; l < p; l++)
      for (let m = 0; m < p; m++) AB[j][l] += A[j][m] * B[m][l];

  const V_rob = Array.from({ length: p }, () => Array(p).fill(0));
  for (let j = 0; j < p; j++)
    for (let l = 0; l < p; l++) {
      let v = 0;
      for (let m = 0; m < p; m++) v += AB[j][m] * A[l][m];
      V_rob[j][l] = cr1 * v;
    }

  const SE_rob = Array.from({ length: p }, (_, j) => Math.sqrt(Math.max(0, V_rob[j][j])));

  return { V_rob, SE_rob, df: C - p, C, B, allSingletons };
}

// ================= CLUSTER-ROBUST WLS POST-PROCESSOR =================
// Given a WLS fit (X, w, y, beta), computes cluster-robust SEs and returns
// robust inference alongside the model-based fit.
//
// Parameters
// ----------
//   X          — k×p design matrix (same as passed to wls())
//   w          — k-vector of weights (same as passed to wls())
//   y          — k-vector of response values
//   beta       — p-vector of fitted coefficients from wls()
//   clusterIds — k-vector of cluster IDs; rows with null/empty are singletons
//
// Returns
// -------
//   { robustSE, robustZ, robustP, robustCi, df, C, allSingletons }  on success
//   { error }  if sandwichVar returns an error
export function robustWlsResult(X, w, y, beta, clusterIds) {
  const k = y.length;
  const residuals = y.map((yi, i) => yi - X[i].reduce((acc, xij, j) => acc + xij * beta[j], 0));

  const rob = sandwichVar(X, w, residuals, clusterIds);
  if (rob.error) return { error: rob.error };

  const useT = rob.df < 30;
  const crit = useT ? tCritical(rob.df) : Z_95;

  const robustSE = rob.SE_rob;
  const robustZ  = beta.map((b, j) => b / robustSE[j]);
  const robustP  = robustZ.map(z =>
    useT
      ? 2 * (1 - tCDF(Math.abs(z), rob.df))
      : 2 * (1 - normalCDF(Math.abs(z)))
  );
  const robustCi = beta.map((b, j) => [b - crit * robustSE[j], b + crit * robustSE[j]]);

  return {
    robustSE, robustZ, robustP, robustCi,
    df: rob.df, C: rob.C, allSingletons: rob.allSingletons,
  };
}

// ================= CLUSTER-ROBUST POOLED-ESTIMATE WRAPPER =================
// Wraps meta() and appends a cluster-robust SE and CI for the pooled estimate.
// Cluster IDs are read from study.cluster on each study object.
//
// Parameters
// ----------
//   studies   — array of study objects (must have yi, vi, and optionally cluster)
//   method    — τ² estimator string, forwarded to meta()
//   ciMethod  — CI method string, forwarded to meta()
//
// Returns
// -------
//   meta() result extended with:
//     robustSE, robustCiLow, robustCiHigh, robustStat, robustPval,
//     robustDf, clustersUsed, isClustered, allSingletons
//   Falls back to plain meta() result when no studies carry a cluster ID.
//   Adds robustError when sandwichVar fails (robust fields are then absent).
export function robustMeta(studies, method, ciMethod, alpha = 0.05) {
  const m = meta(studies, method, ciMethod, alpha);

  const clusterIds = studies.map(s => s.cluster?.trim() || null);
  if (clusterIds.every(id => !id)) return m;

  const k = studies.length;
  const X = Array.from({ length: k }, () => [1]);
  const w = studies.map(s => 1 / Math.max(s.vi + m.tau2, MIN_VAR));
  const residuals = studies.map(s => s.yi - m.RE);

  const rob = sandwichVar(X, w, residuals, clusterIds);
  if (rob.error) return { ...m, robustError: rob.error };

  const robSE = rob.SE_rob[0];
  const useT  = rob.df < 30;
  const crit  = useT ? tCritical(rob.df, alpha) : normalQuantile(1 - alpha / 2);
  const robStat = m.RE / robSE;
  const robPval = useT
    ? 2 * (1 - tCDF(Math.abs(robStat), rob.df))
    : 2 * (1 - normalCDF(Math.abs(robStat)));

  return {
    ...m,
    robustSE:     robSE,
    robustCiLow:  m.RE - crit * robSE,
    robustCiHigh: m.RE + crit * robSE,
    robustStat:   robStat,
    robustPval:   robPval,
    robustDf:     rob.df,
    clustersUsed: rob.C,
    isClustered:  true,
    allSingletons: rob.allSingletons,
  };
}
