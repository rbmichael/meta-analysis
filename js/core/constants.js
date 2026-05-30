// ================= SHARED NUMERIC CONSTANTS =================

// Minimum variance floor applied to all yi/vi computations.
// Prevents 1/vi singularity for studies with effectively zero variance.
export const MIN_VAR = 1e-8;

// Convergence tolerance for iterative τ² estimators (SJ, ML, REML, PM)
// and meta-regression variance-component solvers.
// Referenced in Viechtbauer (2010), "Conducting meta-analyses in R with the
// metafor package", Journal of Statistical Software, 36(3).
export const REML_TOL = 1e-10;

// Iteration budget for bisection-based quantile functions (tCritical,
// chiSquareQuantile, failSafeN, heterogeneityCIs). 64 halvings achieve
// ~10⁻¹⁹ precision on the search ranges used here, which is well within
// double-precision limits.
export const BISECTION_ITERS = 64;

// Standard normal critical value for two-tailed 95% confidence intervals.
// Used in study-level CI display, HR variance back-recovery from published
// CIs, plot rendering, and standardised-residual outlier flagging.
export const Z_95 = 1.96;
