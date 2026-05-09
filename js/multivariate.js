// =============================================================================
// multivariate.js — Multivariate meta-analysis
// =============================================================================
// Exports:
//   vcalc(rows, opts)         — Step 1: block-diagonal within-study covariance V
//   mvMeta(rows, V, opts)     — Step 2: REML/ML estimation of the multivariate model
// =============================================================================

import { MIN_VAR } from "./constants.js";
import { normalCDF, normalQuantile, chiSquareCDF } from "./utils.js";
// bfgs is imported from selection.js to avoid a circular dep through analysis.js.
// Safe: bfgs is only called inside mvMeta (a function body), never at module init.
import { bfgs } from "./selection.js";

// =============================================================================
// Low-level matrix helpers for small dense p×p matrices (p ≤ ~10 typical).
// Self-contained — no imports from analysis.js to keep the module free of
// circular dependency issues at initialisation time.
// =============================================================================

// Returns lower-triangular L such that m = LL', or null if m is not PD.
function _cholFactor(m) {
  const p = m.length;
  const L = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
      if (i === j) {
        const d = m[i][i] - s;
        if (d <= 0) return null;
        L[i][j] = Math.sqrt(d);
      } else {
        L[i][j] = (m[i][j] - s) / L[j][j];
      }
    }
  }
  return L;
}

// log|det(LL')| = 2 · Σⱼ log(Lⱼⱼ)
function _cholLogDet(L) {
  let s = 0;
  for (let j = 0; j < L.length; j++) s += Math.log(L[j][j]);
  return 2 * s;
}

// Solve Lx = b (L lower-triangular) via forward substitution.
function _forwardSolve(L, b) {
  const p = L.length;
  const x = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = b[i];
    for (let j = 0; j < i; j++) s -= L[i][j] * x[j];
    x[i] = s / L[i][i];
  }
  return x;
}

// Solve L'x = b (L lower-triangular, so L' upper-triangular) via back substitution.
function _backSolve(L, b) {
  const p = L.length;
  const x = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < p; j++) s -= L[j][i] * x[j];   // L'[i][j] = L[j][i]
    x[i] = s / L[i][i];
  }
  return x;
}

// Solve LL'x = b.
function _cholSolveVec(L, b) {
  return _backSolve(L, _forwardSolve(L, b));
}

// Compute full inverse Σ⁻¹ of Σ = LL' via column-by-column Cholesky solves.
// Returns a p×p array (row-major regular JS arrays).
function _cholInverse(L) {
  const p = L.length;
  const inv = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let j = 0; j < p; j++) {
    const ej = new Array(p).fill(0); ej[j] = 1;
    const col = _cholSolveVec(L, ej);
    for (let i = 0; i < p; i++) inv[i][j] = col[i];
  }
  return inv;
}

// Gauss-Jordan matrix inverse with partial pivoting.  Returns null if singular.
// Used for the P×P X'Ω⁻¹X information matrix (P = number of outcomes, typically 2–5).
function _matInverse(A) {
  const p = A.length;
  const M = A.map((row, i) => {
    const aug = row.slice();
    for (let j = 0; j < p; j++) aug.push(i === j ? 1 : 0);
    return aug;
  });
  for (let col = 0; col < p; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-14) return null;
    for (let j = col; j < 2 * p; j++) M[col][j] /= pivot;
    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const f = M[row][col];
      if (f === 0) continue;
      for (let j = col; j < 2 * p; j++) M[row][j] -= f * M[col][j];
    }
  }
  return M.map(row => row.slice(p));
}

// log|det(A)| via partial-pivoting Gaussian elimination.
function _logDet(A) {
  const n = A.length;
  const M = A.map(row => row.slice());
  let logd = 0;
  for (let i = 0; i < n; i++) {
    let maxVal = Math.abs(M[i][i]), maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxVal) { maxVal = Math.abs(M[k][i]); maxRow = k; }
    }
    if (maxRow !== i) [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-15) return -Infinity;
    logd += Math.log(Math.abs(M[i][i]));
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return logd;
}

// =============================================================================
// Ψ (between-study covariance) parameterization
// =============================================================================

// Number of free parameters in Ψ for each structure.
function _nPsiParams(struct, P) {
  if (struct === "CS")   return 2;                 // [log τ², atanh ρ]
  if (struct === "Diag") return P;                 // [log τ²₁, ..., log τ²_P]
  if (struct === "UN")   return P * (P + 1) / 2;  // Cholesky factor of Ψ
  return 0;
}

// Recover P×P Ψ matrix from unconstrained parameter vector θ.
//
//   CS:   θ = [log τ², atanh ρ]
//             Ψⱼₖ = τ² for j=k, ρτ² for j≠k
//   Diag: θ = [log τ²₁, ..., log τ²_P]
//             Ψ = diag(exp(θ))
//   UN:   θ = [log L₁₁, ..., log L_PP, L₂₁, L₃₁, L₃₂, ...]  (P log-diags + off-diags)
//             Ψ = LL'  (L lower-triangular, positive diagonal)
function _psiFromTheta(theta, struct, P) {
  if (struct === "CS") {
    const tau2 = Math.exp(theta[0]);
    const rho  = Math.tanh(theta[1]);
    return Array.from({ length: P }, (_, j) =>
      Array.from({ length: P }, (_, k) => j === k ? tau2 : rho * tau2)
    );
  }
  if (struct === "Diag") {
    return Array.from({ length: P }, (_, j) => {
      const row = new Array(P).fill(0);
      row[j] = Math.exp(theta[j]);
      return row;
    });
  }
  // UN: build lower-triangular L from θ, then Ψ = LL'
  const L = Array.from({ length: P }, () => new Array(P).fill(0));
  for (let j = 0; j < P; j++) L[j][j] = Math.exp(theta[j]);
  let t = P;
  for (let i = 1; i < P; i++)
    for (let j = 0; j < i; j++)
      L[i][j] = theta[t++];
  return Array.from({ length: P }, (_, i) =>
    Array.from({ length: P }, (_, j) => {
      let s = 0;
      for (let k = 0; k < P; k++) s += L[i][k] * L[j][k];
      return s;
    })
  );
}

// =============================================================================
// Starting value helpers
// =============================================================================

// Per-outcome DL-like τ² moment estimates (ignores cross-covariance).
// studyData: [{p, y, idx, Vmat}]  (internal format built in mvMeta)
function _initTau2(studyData, P) {
  const byOutcome = Array.from({ length: P }, () => []);
  for (const { y, idx, Vmat } of studyData) {
    for (let j = 0; j < idx.length; j++)
      byOutcome[idx[j]].push({ yi: y[j], vi: Vmat[j][j] });
  }
  return byOutcome.map(obs => {
    if (obs.length < 2) return 0.01;
    let W = 0, W2 = 0, Wmu = 0;
    for (const { vi } of obs) { const w = 1 / Math.max(vi, MIN_VAR); W += w; W2 += w * w; }
    for (const { yi, vi } of obs) Wmu += yi / Math.max(vi, MIN_VAR);
    const muFE = Wmu / W;
    const Q = obs.reduce((a, { yi, vi }) => a + (yi - muFE) ** 2 / Math.max(vi, MIN_VAR), 0);
    const c = W - W2 / W;
    const t = c > 0 ? Math.max(0, (Q - (obs.length - 1)) / c) : 0;
    return Math.max(MIN_VAR, t > 0 ? t : 0.01);
  });
}

// Build initial unconstrained θ from per-outcome τ² estimates.
function _initialTheta(struct, P, tau2_0) {
  if (struct === "CS") {
    const tau2_mean = tau2_0.reduce((a, v) => a + v, 0) / P;
    return [Math.log(Math.max(MIN_VAR, tau2_mean)), 0.0];   // atanh(0) = 0
  }
  if (struct === "Diag")
    return tau2_0.map(t => Math.log(Math.max(MIN_VAR, t)));
  // UN: diagonal L, off-diagonals = 0  →  L[j][j] = sqrt(τ²_j)
  const theta = tau2_0.map(t => 0.5 * Math.log(Math.max(MIN_VAR, t)));
  for (let i = 1; i < P; i++)
    for (let j = 0; j < i; j++)
      theta.push(0.0);
  return theta;
}

// =============================================================================
// vcalc — block-diagonal within-study sampling covariance matrix
// =============================================================================
/**
 * Build block-diagonal within-study sampling covariance matrix V.
 *
 * Each unique study_id forms one block.  Within a block, the covariance
 * between outcomes j and k is:
 *   V[j,k] = rho * sqrt(vi_j * vi_k)   (constant-rho model, type="constant")
 *   V[j,j] = vi_j
 *
 * This matches metafor::vcalc(vi, cluster=study_id, obs=outcome_id, rho=rho).
 *
 * @param {Array<Object>} rows  Flat array of study observations.
 *   Required per row: vi (sampling variance), study_id, outcome_id.
 * @param {Object} [opts]
 *   opts.rho   {number}  Within-study between-outcome correlation (default 0.5).
 *                        Must satisfy -1 < rho < 1.
 *   opts.type  {string}  Correlation structure; only "constant" supported now.
 * @returns {{
 *   blocks:     Array<{studyId, outcomeIds, rows, k, matrix}>,
 *   n:          number,
 *   studyIds:   string[],
 *   outcomeIds: string[],
 *   rho:        number,
 *   type:       string,
 *   warnings:   string[]
 * }}
 *
 * Return fields:
 *   blocks      — one entry per unique study_id, in encounter order.
 *                 block.matrix is a p_i × p_i array (row-major 2-D JS array).
 *                 block.rows   is the deduplicated, ordered row subset.
 *   n           — total number of observations (sum of block.k).
 *   studyIds    — unique study IDs in encounter order.
 *   outcomeIds  — all unique outcome IDs encountered across all studies.
 *   warnings    — non-fatal diagnostic messages (singular blocks, duplicates, etc.).
 */
export function vcalc(rows, { rho = 0.5, type = "constant" } = {}) {
  const warnings = [];

  if (!isFinite(rho) || rho <= -1 || rho >= 1)
    warnings.push(`rho=${rho} is outside the open interval (-1, 1); V blocks may be singular`);
  if (type !== "constant") {
    warnings.push(`type="${type}" is not supported; falling back to "constant"`);
    type = "constant";
  }

  const studyMap = new Map();
  rows.forEach((row, i) => {
    const sid = row.study_id != null ? String(row.study_id) : `__s${i}`;
    const oid = row.outcome_id != null ? String(row.outcome_id) : `__o${i}`;
    if (!studyMap.has(sid)) studyMap.set(sid, []);
    studyMap.get(sid).push({ ...row, _sid: sid, _oid: oid });
  });

  const blocks = [];
  const allOutcomeIdSet = new Set();
  let n = 0;

  for (const [studyId, studyRows] of studyMap) {
    const seen = new Set();
    const uniqRows = [];
    for (const r of studyRows) {
      if (seen.has(r._oid)) {
        warnings.push(`study_id="${studyId}": duplicate outcome_id="${r._oid}" — keeping first occurrence`);
      } else {
        seen.add(r._oid);
        allOutcomeIdSet.add(r._oid);
        uniqRows.push(r);
      }
    }

    const p = uniqRows.length;
    n += p;

    const matrix = Array.from({ length: p }, (_, j) =>
      Array.from({ length: p }, (_, k) => {
        const vj = Math.max(uniqRows[j].vi ?? 0, MIN_VAR);
        const vk = Math.max(uniqRows[k].vi ?? 0, MIN_VAR);
        if (j === k) return vj;
        return rho * Math.sqrt(vj * vk);
      })
    );

    if (p > 1 && _cholFactor(matrix) === null)
      warnings.push(`study_id="${studyId}": V block is not positive definite (check rho and vi values)`);

    blocks.push({ studyId, outcomeIds: uniqRows.map(r => r._oid), rows: uniqRows, k: p, matrix });
  }

  return { blocks, n, studyIds: [...studyMap.keys()], outcomeIds: [...allOutcomeIdSet], rho, type, warnings };
}

// =============================================================================
// mvMeta — multivariate random-effects meta-analysis (REML or ML)
// =============================================================================
/**
 * Fit the multivariate random-effects model:
 *
 *   yᵢ ~ N(Xᵢβ, Vᵢ + ZᵢΨZᵢ')
 *
 *   yᵢ  — pᵢ-vector of outcomes for study i
 *   Vᵢ  — known pᵢ×pᵢ sampling covariance block (from vcalc)
 *   Ψ   — P×P unknown between-study covariance matrix
 *   Xᵢ  — pᵢ×P design matrix (intercept-per-outcome in the base model)
 *   Zᵢ  — selection matrix linking study i's outcomes to the full P-vector
 *
 * Estimates Ψ by maximising the (RE)ML log-likelihood via BFGS.
 * Fixed effects β̂ are concentrated out analytically at each iteration.
 *
 * @param {Array}  rows  Flat array of study observations (same rows passed to vcalc).
 *                       Required fields: yi, vi, study_id, outcome_id.
 * @param {Object} V     vcalc() return object.
 * @param {Object} [opts]
 *   opts.struct  {"CS"|"Diag"|"UN"}  Ψ structure (default "CS").
 *   opts.method  {"REML"|"ML"}       Estimation method (default "REML").
 *   opts.alpha   {number}            Significance level for CIs (default 0.05).
 * @returns {Object}  See returns section in ROADMAP.md Step 2.
 */
export function mvMeta(rows, V, opts = {}) {
  const {
    struct    = "CS",
    method    = "REML",
    alpha     = 0.05,
    moderators = [],   // [{key, type}] — continuous moderators only for now
    slopes    = "separate",  // "separate" (one slope per outcome) | "common" (shared slope)
  } = opts;

  // ---- Validate inputs ----
  if (!V || !Array.isArray(V.blocks) || V.blocks.length === 0)
    return { error: 'V must be a vcalc() result with at least one block' };
  if (!["CS", "Diag", "UN"].includes(struct))
    return { error: `struct must be "CS", "Diag", or "UN" (got "${struct}")` };
  if (!["REML", "ML"].includes(method))
    return { error: `method must be "REML" or "ML" (got "${method}")` };

  const k = V.blocks.length;    // number of studies
  const P = V.outcomeIds.length; // number of unique outcomes
  const n = V.n;                 // total observations

  if (P < 2)
    return { error: 'mvMeta requires at least 2 outcomes; use meta() for univariate analysis' };
  if (k < 3)
    return { error: 'mvMeta requires at least 3 studies' };

  // Warn if model may be overparameterised
  const nPsiPar = _nPsiParams(struct, P);
  const warnings = [...V.warnings];
  if (k < P + nPsiPar)
    warnings.push(`Only ${k} studies for ${P} outcomes + ${nPsiPar} Ψ parameters — results may be unreliable`);

  // Validate all yi/vi
  for (const block of V.blocks) {
    for (const r of block.rows) {
      if (!isFinite(r.yi) || !isFinite(r.vi) || r.vi <= 0)
        return { error: `Invalid yi=${r.yi} or vi=${r.vi} in study "${block.studyId}", outcome "${r._oid}"` };
    }
  }

  // ---- Build per-study data objects ----
  const outcomeIdx = new Map(V.outcomeIds.map((id, i) => [id, i]));

  // q_total = number of fixed-effect columns in X
  //   no moderators: q_total = P (one intercept per outcome)
  //   separate slopes: P + P * q  (each outcome gets its own slope per moderator)
  //   common slopes:   P + q      (one shared slope per moderator)
  const q = moderators.length;
  const q_total = q === 0 ? P
                : slopes === "common" ? P + q
                : P + P * q;   // separate

  // Column names for beta
  const betaNames = V.outcomeIds.map(id => String(id));
  if (q > 0) {
    if (slopes === "common") {
      for (const m of moderators) betaNames.push(m.key);
    } else {
      for (const m of moderators)
        for (const id of V.outcomeIds) betaNames.push(`${id}:${m.key}`);
    }
  }

  // Build X row (q_total-vector) for one observation:
  //   j = global outcome index, row = raw data row with moderator fields
  function _xrow(j, row) {
    const xr = new Float64Array(q_total);
    xr[j] = 1;
    for (let m = 0; m < q; m++) {
      const val = Number(row[moderators[m].key]);
      if (slopes === "common") {
        xr[P + m] = val;
      } else {
        xr[P + m * P + j] = val;
      }
    }
    return xr;
  }

  const studyData = V.blocks.map(block => ({
    p:     block.k,
    y:     block.rows.map(r => r.yi),
    idx:   block.outcomeIds.map(oid => outcomeIdx.get(oid)),
    Vmat:  block.matrix,
    Xrows: block.rows.map(r => _xrow(outcomeIdx.get(r._oid), r)),
  }));

  // X'X — unweighted design matrix cross-product; constant w.r.t. θ.
  // Used in REML logLik normalizing constant: +q_total/2·log(2π) + ½·log|X'X|.
  const XtX = Array.from({ length: q_total }, () => new Array(q_total).fill(0));
  for (const { Xrows } of studyData)
    for (const xr of Xrows)
      for (let c1 = 0; c1 < q_total; c1++)
        for (let c2 = 0; c2 < q_total; c2++)
          XtX[c1][c2] += xr[c1] * xr[c2];
  const logDetXtX = _logDet(XtX);

  // ---- Starting values ----
  const tau2_0 = _initTau2(studyData, P);
  const theta0 = _initialTheta(struct, P, tau2_0);

  // ---- Concentrated (RE)ML log-likelihood ----
  // Returns negative log-likelihood (positive) for minimisation by BFGS.
  // Fixed effects β are concentrated out analytically at each θ.
  function negLogLik(theta) {
    const Psi = _psiFromTheta(theta, struct, P);

    let logDetSum = 0;
    let yOy = 0;
    const XOX = Array.from({ length: q_total }, () => new Array(q_total).fill(0));
    const XOy = new Array(q_total).fill(0);

    for (const { p, y, idx, Vmat, Xrows } of studyData) {
      // Σᵢ = Vᵢ + Ψᵢ  (Ψᵢ is the pᵢ×pᵢ submatrix of Ψ)
      const Sigma = Array.from({ length: p }, (_, j) =>
        Array.from({ length: p }, (_, k) => Vmat[j][k] + Psi[idx[j]][idx[k]])
      );

      const L = _cholFactor(Sigma);
      if (L === null) return 1e10;   // Σᵢ not PD — penalise

      logDetSum += _cholLogDet(L);

      const Oiy = _cholSolveVec(L, y);           // Σᵢ⁻¹yᵢ
      for (let j = 0; j < p; j++) yOy += y[j] * Oiy[j];

      // X'Ω⁻¹y += Xᵢ' (Σᵢ⁻¹yᵢ)
      for (let j = 0; j < p; j++) {
        const xrj = Xrows[j];
        for (let c = 0; c < q_total; c++) XOy[c] += xrj[c] * Oiy[j];
      }

      // X'Ω⁻¹X += Xᵢ' Σᵢ⁻¹ Xᵢ  (via Σᵢ⁻¹ Xᵢ intermediate)
      const Oi = _cholInverse(L);                // Σᵢ⁻¹  (full pᵢ×pᵢ)
      for (let j = 0; j < p; j++) {
        const OiXrow = new Float64Array(q_total);
        for (let kk = 0; kk < p; kk++) {
          const oijk = Oi[j][kk];
          const xrk = Xrows[kk];
          for (let c = 0; c < q_total; c++) OiXrow[c] += oijk * xrk[c];
        }
        const xrj = Xrows[j];
        for (let c1 = 0; c1 < q_total; c1++)
          for (let c2 = 0; c2 < q_total; c2++)
            XOX[c1][c2] += xrj[c1] * OiXrow[c2];
      }
    }

    const XOXinv = _matInverse(XOX);
    if (XOXinv === null) return 1e10;

    // Q = y'Ω⁻¹y − (X'Ω⁻¹y)'β̂  =  yOy − XOy'·XOXinv·XOy
    let crossTerm = 0;
    for (let j = 0; j < q_total; j++) {
      let s = 0;
      for (let kk = 0; kk < q_total; kk++) s += XOXinv[j][kk] * XOy[kk];
      crossTerm += XOy[j] * s;
    }
    const Q = Math.max(0, yOy - crossTerm);

    // Concentrated log L (without −n/2·log(2π) constant — omitted, cancels in optimisation)
    let logL = -0.5 * (logDetSum + Q);

    // REML correction: −½ log|X'Ω⁻¹X|
    if (method === "REML") {
      const ld = _logDet(XOX);
      if (!isFinite(ld)) return 1e10;
      logL -= 0.5 * ld;
    }

    return isFinite(logL) ? -logL : 1e10;
  }

  // ---- Optimise ----
  const res = bfgs(negLogLik, theta0, { maxIter: 500, gtol: 1e-6 });
  const thetaStar = res.x;
  const Psi = _psiFromTheta(thetaStar, struct, P);

  // ---- Final accumulation pass at θ* ----
  // Re-run the likelihood components to extract β̂, XOXinv, QE, logLik.
  let logDetSum = 0, yOy = 0;
  const XOX = Array.from({ length: q_total }, () => new Array(q_total).fill(0));
  const XOy = new Array(q_total).fill(0);

  for (const { p, y, idx, Vmat, Xrows } of studyData) {
    const Sigma = Array.from({ length: p }, (_, j) =>
      Array.from({ length: p }, (_, kk) => Vmat[j][kk] + Psi[idx[j]][idx[kk]])
    );
    const L = _cholFactor(Sigma);
    if (L === null) return { error: 'Cholesky factorisation failed at converged parameters' };
    logDetSum += _cholLogDet(L);
    const Oiy = _cholSolveVec(L, y);
    for (let j = 0; j < p; j++) yOy += y[j] * Oiy[j];
    for (let j = 0; j < p; j++) {
      const xrj = Xrows[j];
      for (let c = 0; c < q_total; c++) XOy[c] += xrj[c] * Oiy[j];
    }
    const Oi = _cholInverse(L);
    for (let j = 0; j < p; j++) {
      const OiXrow = new Float64Array(q_total);
      for (let kk = 0; kk < p; kk++) {
        const oijk = Oi[j][kk];
        const xrk = Xrows[kk];
        for (let c = 0; c < q_total; c++) OiXrow[c] += oijk * xrk[c];
      }
      const xrj = Xrows[j];
      for (let c1 = 0; c1 < q_total; c1++)
        for (let c2 = 0; c2 < q_total; c2++)
          XOX[c1][c2] += xrj[c1] * OiXrow[c2];
    }
  }

  const XOXinv = _matInverse(XOX);
  if (XOXinv === null) return { error: 'Singular information matrix X\'Ω⁻¹X at converged parameters' };

  // Fixed effects β̂ = (X'Ω⁻¹X)⁻¹ X'Ω⁻¹y
  const beta = XOXinv.map(row => row.reduce((s, v, j) => s + v * XOy[j], 0));
  const se   = XOXinv.map((row, j) => Math.sqrt(Math.max(0, row[j])));

  const zcrit = normalQuantile(1 - alpha / 2);
  const ci   = beta.map((b, j) => [b - zcrit * se[j], b + zcrit * se[j]]);
  const z    = beta.map((b, j) => se[j] > 0 ? b / se[j] : NaN);
  const pval = z.map(zi => isFinite(zi) ? 2 * (1 - normalCDF(Math.abs(zi))) : NaN);

  // QM — omnibus Wald test for β = 0, evaluated at Ω = V + ZΨ*Z'
  //   QM  = β̂'(X'Ω⁻¹X)β̂ = XOy'·XOXinv·XOy
  // logLik residual: y'Ω⁻¹y − QM  (used below for logL)
  let crossTerm = 0;
  for (let j = 0; j < q_total; j++) {
    let s = 0;
    for (let kk = 0; kk < q_total; kk++) s += XOXinv[j][kk] * XOy[kk];
    crossTerm += XOy[j] * s;
  }
  const QM          = Math.max(0, crossTerm);
  const df_QM       = q_total;
  const pQM         = 1 - chiSquareCDF(QM, q_total);
  const residOmega  = Math.max(0, yOy - QM);   // used only for logLik below

  // QE — Cochran residual heterogeneity test, evaluated at Ψ = 0 (V only).
  // Matches metafor rma.mv() QE definition:
  //   "test of (residual) heterogeneity ... random effects removed"
  //   QE = y'(V⁻¹ − V⁻¹X(X'V⁻¹X)⁻¹X'V⁻¹)y
  let yVy = 0;
  const XVX = Array.from({ length: q_total }, () => new Array(q_total).fill(0));
  const XVy = new Array(q_total).fill(0);
  for (const { p, y, Vmat, Xrows } of studyData) {
    const Lv = _cholFactor(Vmat);
    if (Lv === null) continue;                 // V validated at entry; shouldn't happen
    const Viy = _cholSolveVec(Lv, y);
    for (let j = 0; j < p; j++) yVy += y[j] * Viy[j];
    for (let j = 0; j < p; j++) {
      const xrj = Xrows[j];
      for (let c = 0; c < q_total; c++) XVy[c] += xrj[c] * Viy[j];
    }
    const Vi = _cholInverse(Lv);
    for (let j = 0; j < p; j++) {
      const ViXrow = new Float64Array(q_total);
      for (let kk = 0; kk < p; kk++) {
        const vik = Vi[j][kk];
        const xrk = Xrows[kk];
        for (let c = 0; c < q_total; c++) ViXrow[c] += vik * xrk[c];
      }
      const xrj = Xrows[j];
      for (let c1 = 0; c1 < q_total; c1++)
        for (let c2 = 0; c2 < q_total; c2++)
          XVX[c1][c2] += xrj[c1] * ViXrow[c2];
    }
  }
  const XVXinv = _matInverse(XVX);
  let crossTermV = 0;
  if (XVXinv) {
    for (let j = 0; j < q_total; j++) {
      let s = 0;
      for (let kk = 0; kk < q_total; kk++) s += XVXinv[j][kk] * XVy[kk];
      crossTermV += XVy[j] * s;
    }
  }
  const QE    = Math.max(0, yVy - crossTermV);
  const df_QE = n - q_total;
  const pQE   = df_QE > 0 ? 1 - chiSquareCDF(QE, df_QE) : NaN;

  // Between-study correlation matrix: corPsi[i][j] = Psi[i][j] / sqrt(Psi[i][i] * Psi[j][j])
  const corPsi = Array.from({ length: P }, (_, i) =>
    Array.from({ length: P }, (_, j) => {
      if (i === j) return 1;
      const denom = Math.sqrt(Math.max(0, Psi[i][i]) * Math.max(0, Psi[j][j]));
      if (denom < 1e-15) return 0;
      return Psi[i][j] / denom;
    })
  );

  // I² per outcome: 100 · τ²ⱼ / (τ²ⱼ + median vᵢⱼ)
  const I2 = V.outcomeIds.map((oid, o) => {
    const tau2_o = Math.max(0, Psi[o][o]);
    const vis = V.blocks
      .filter(b => b.outcomeIds.includes(oid))
      .map(b => {
        const li = b.outcomeIds.indexOf(oid);
        return b.matrix[li][li];   // sampling variance for this outcome in this study
      });
    if (vis.length === 0) return NaN;
    vis.sort((a, b) => a - b);
    const mid = Math.floor(vis.length / 2);
    const medVi = vis.length % 2 === 0 ? (vis[mid - 1] + vis[mid]) / 2 : vis[mid];
    return tau2_o + medVi > 0 ? 100 * tau2_o / (tau2_o + medVi) : 0;
  });

  // Full log-likelihood at (β̂, Ψ*):  −½[n·log(2π) + log|Ω| + y'Ω⁻¹y − QM]
  let logL = -0.5 * (n * Math.log(2 * Math.PI) + logDetSum + residOmega);
  if (method === "REML") {
    logL -= 0.5 * _logDet(XOX);
    // REML normalizing constant: +q_total/2·log(2π) + ½·log|X'X|
    // (X'X is the unweighted design cross-product, constant w.r.t. θ)
    logL += q_total / 2 * Math.log(2 * Math.PI) + 0.5 * logDetXtX;
  }

  // AIC / BIC
  // ML counts fixed effects + variance params; REML counts variance params only.
  const nParamsFit = method === "ML" ? q_total + nPsiPar : nPsiPar;
  const AIC  = -2 * logL + 2 * nParamsFit;
  const BIC  = -2 * logL + Math.log(n) * nParamsFit;
  const AICc = n - nParamsFit - 1 > 0
    ? AIC + 2 * nParamsFit * (nParamsFit + 1) / (n - nParamsFit - 1)
    : Infinity;

  // tau2 = diagonal of Ψ; rho_between = off-diagonal / τ² for CS
  const tau2 = V.outcomeIds.map((_, o) => Math.max(0, Psi[o][o]));
  const rho_between = struct === "CS" ? Math.tanh(thetaStar[1]) : undefined;

  return {
    // Fixed effects (one entry per outcome, same order as V.outcomeIds)
    beta,
    se,
    ci,
    z,
    pval,
    betaNames,
    outcomeIds: V.outcomeIds,

    // Between-study covariance
    Psi,
    corPsi,
    tau2,
    rho_between,

    // Omnibus Wald test (β = 0)
    QM, df_QM, pQM,

    // Residual heterogeneity
    QE, df_QE, pQE,

    // Per-outcome I²
    I2,

    // Fit
    logLik: logL,
    AIC, BIC, AICc,

    // Model metadata
    k, n, P,
    struct, method,
    convergence: res.converged,
    optimizer: { iters: res.iters, gnorm: res.gnorm },
    warnings,
  };
}
