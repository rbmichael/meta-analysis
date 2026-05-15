// =============================================================================
// linalg.js — Linear algebra primitives
// =============================================================================
// Leaf module (no JS-side imports). Used by analysis.js, regression.js,
// selection.js, pubbias.js, perm.js, and multivariate.js.
//
// Exports
// -------
//   wls(X, y, w)          — weighted least squares; returns { beta, vcov, rankDeficient }
//   matInverse(A)         — Gauss-Jordan inverse; returns null if singular
//   logDet(A)             — log|det(A)| via Gaussian elimination
//   inverseWithRidge(H)   — matInverse with progressive diagonal ridge fallback
//   numericalHessian(f,x) — central-difference n×n Hessian; fval and h optional
// =============================================================================

/**
 * Weighted least squares: fit y = X·β with diagonal weight matrix W = diag(w).
 * Called at every τ² iteration inside metaRegression, so kept lean.
 * @param {number[][]} X - k×p row-major design matrix (from buildDesignMatrix).
 * @param {number[]}   y - k-length array of effect sizes.
 * @param {number[]}   w - k-length array of weights (typically 1/(vi + τ²)).
 * @returns {{ beta: number[], vcov: number[][], rankDeficient: boolean }}
 *   beta: p-length coefficient vector;
 *   vcov: p×p variance-covariance matrix = (X'WX)⁻¹;
 *   rankDeficient: true when X'WX is singular (all results NaN-filled).
 */
export function wls(X, y, w) {
  const k = X.length;
  const p = X[0].length;

  // --- X'WX (p×p, symmetric) and X'Wy (p-vector) ---
  const XtWX = Array.from({ length: p }, () => Array(p).fill(0));
  const XtWy = Array(p).fill(0);

  for (let i = 0; i < k; i++) {
    const wi = w[i];
    for (let j = 0; j < p; j++) {
      XtWy[j] += wi * X[i][j] * y[i];
      for (let l = j; l < p; l++) {            // exploit symmetry
        const v = wi * X[i][j] * X[i][l];
        XtWX[j][l] += v;
        if (l !== j) XtWX[l][j] += v;
      }
    }
  }

  // --- Invert X'WX ---
  const inv = matInverse(XtWX);
  if (inv === null) {
    return {
      beta: Array(p).fill(NaN),
      vcov: Array.from({ length: p }, () => Array(p).fill(NaN)),
      rankDeficient: true
    };
  }

  // --- beta = (X'WX)⁻¹ · X'Wy ---
  const beta = inv.map(row => row.reduce((acc, v, j) => acc + v * XtWy[j], 0));

  return { beta, vcov: inv, rankDeficient: false };
}

// Gauss-Jordan elimination with partial pivoting.
// Returns the inverse of the p×p matrix A, or null if singular.
export function matInverse(A) {
  const p = A.length;

  // Augment A with the identity: M = [A | I]
  const M = A.map((row, i) => {
    const aug = row.slice();
    for (let j = 0; j < p; j++) aug.push(i === j ? 1 : 0);
    return aug;
  });

  // Scale singularity threshold by the largest entry in A so tiny-valued
  // matrices (e.g. scaled covariates) are not incorrectly flagged singular.
  const matScale = A.reduce((m, row) => Math.max(m, ...row.map(Math.abs)), 0);
  const singTol  = 1e-14 * Math.max(1, matScale);

  for (let col = 0; col < p; col++) {
    // Partial pivoting: swap in the row with the largest absolute value
    let pivotRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < singTol) return null;   // singular or near-singular

    // Scale the pivot row so the leading entry becomes 1
    for (let j = col; j < 2 * p; j++) M[col][j] /= pivot;

    // Zero out every other row in this column
    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const f = M[row][col];
      if (f === 0) continue;
      for (let j = col; j < 2 * p; j++) M[row][j] -= f * M[col][j];
    }
  }

  // The right half of M is now A⁻¹
  return M.map(row => row.slice(p));
}

// numericalHessian(f, x, fval?, h?) → n×n matrix
// Central-difference second-order approximation of the Hessian of f at x.
//   fval — f(x) if already computed; evaluated internally when omitted.
//   h    — step sizes: scalar, array, or omitted (default: max(1e-4, 1e-4·|xⱼ|)).
// Used for observed Fisher information and standard errors after optimisation.
export function numericalHessian(f, x, fval, h) {
  const n = x.length;
  const fv = fval !== undefined ? fval : f(x);
  const hs = h === undefined
    ? x.map(v => Math.max(1e-4, 1e-4 * Math.abs(v)))
    : (typeof h === "number" ? x.map(() => h) : h);
  const H = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const xp = x.slice(); xp[i] += hs[i];
    const xm = x.slice(); xm[i] -= hs[i];
    H[i][i] = (f(xp) - 2 * fv + f(xm)) / (hs[i] * hs[i]);
    for (let j = i + 1; j < n; j++) {
      const xpp = x.slice(); xpp[i] += hs[i]; xpp[j] += hs[j];
      const xpm = x.slice(); xpm[i] += hs[i]; xpm[j] -= hs[j];
      const xmp = x.slice(); xmp[i] -= hs[i]; xmp[j] += hs[j];
      const xmm = x.slice(); xmm[i] -= hs[i]; xmm[j] -= hs[j];
      const hij = (f(xpp) - f(xpm) - f(xmp) + f(xmm)) / (4 * hs[i] * hs[j]);
      H[i][j] = hij;
      H[j][i] = hij;
    }
  }
  return H;
}

// inverseWithRidge(H, schedule) → matrix | null
// Attempts matInverse(H); on failure retries with progressively larger diagonal
// ridge penalties until inversion succeeds or the schedule is exhausted.
// Returns null only when every ridge value fails.
export function inverseWithRidge(H, schedule = [1e-8, 1e-6, 1e-4, 1e-2, 1, 10]) {
  let inv = matInverse(H);
  if (inv !== null) return inv;
  for (const lam of schedule) {
    const ridge = H.map((row, i) => row.map((v, j) => i === j ? v + lam : v));
    inv = matInverse(ridge);
    if (inv !== null) return inv;
  }
  return null;
}

// log|det(A)| via partial-pivoting Gaussian elimination.
// A must be square and positive definite (used only for X'WX, which always is).
// Returns -Infinity if the matrix is (near-)singular.
export function logDet(A) {
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
