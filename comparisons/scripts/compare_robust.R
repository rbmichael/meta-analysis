#!/usr/bin/env Rscript
# AUDIT_EXEMPT: cross-validation script — intentionally implements app formulas in R for comparison; "match app" comments are expected and do not indicate drift.
# compare_robust.R -- Cross-validate cluster-robust SE (RVE/CR1) and three-level
#                    meta-analysis app output against metafor / clubSandwich.
#
# Usage:
#   Rscript comparisons/compare_robust.R
#   Rscript comparisons/compare_robust.R --mode 3l
#   Rscript comparisons/compare_robust.R --mode rve --method DL
#   Rscript comparisons/compare_robust.R --rho 0.5
#   Rscript comparisons/compare_robust.R --input my_data.csv --output out.txt
#
# Arguments (all optional; defaults match app defaults):
#   --mode    Analysis type: rve (cluster-robust, default) or 3l (three-level)
#   --method  tau2 estimator: REML (default), ML, DL, ...
#   --rho     Within-cluster correlation for RVE estimate (default: 0.80)
#   --input   CSV with columns: study, yi, vi, cluster, mod
#             (default: cluster_data.csv in script directory)
#   --output  Output file path (default: results_RVE_METHOD.txt or results_3L_METHOD.txt)
#
# Sections (--mode rve):
#   1. Pooled estimate + cluster-robust SE — intercept only (CR1 sandwich)
#      Validates: js/robust.js robustMeta (CLUSTER_BENCHMARKS CL-style)
#   2. Meta-regression + cluster-robust SEs — intercept + mod moderator
#      Validates: js/regression.js metaRegression with cluster IDs
#   3. RVE pooled estimate — Hedges-Tipton-Johnson (2010) working model, rho=0.80
#      Validates: js/regression.js rvePooled (RVE_BENCHMARKS style)
#
# Sections (--mode 3l):
#   1. Three-level rma.mv (random = ~1 | cluster/study)
#      Validates: js/regression.js meta3level (THREE_LEVEL_BENCHMARKS style)
#
# Requirements:
#   install.packages(c("metafor", "clubSandwich"))

suppressPackageStartupMessages(library(metafor))

# ---------------------------------------------------------------------------
# Script directory detection
# ---------------------------------------------------------------------------
initial_args <- commandArgs(trailingOnly = FALSE)
file_flag    <- grep("^--file=", initial_args, value = TRUE)
script_dir   <- if (length(file_flag) > 0) {
  dirname(normalizePath(sub("^--file=", "", file_flag)))
} else {
  "."
}
data_dir    <- file.path(script_dir, "..", "data")
results_dir <- file.path(script_dir, "..", "results")


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
args    <- commandArgs(trailingOnly = TRUE)
get_arg <- function(key, default) {
  idx <- which(args == key)
  if (length(idx) > 0 && idx[1] < length(args)) args[idx[1] + 1] else default
}

mode_arg   <- get_arg("--mode",   "rve")
method_arg <- get_arg("--method", "REML")
rho_arg    <- as.numeric(get_arg("--rho", "0.80"))
input_file <- get_arg("--input",  file.path(data_dir, "cluster_data.csv"))

mode_tag    <- toupper(mode_arg)
default_out <- file.path(results_dir,
  paste0("results_", mode_tag, "_", method_arg, ".txt"))
output_file <- get_arg("--output", default_out)

if (!mode_arg %in% c("rve", "3l"))
  stop("--mode must be 'rve' or '3l'. Got: ", mode_arg)

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
lines <- character(0)
lp <- function(...) lines <<- c(lines, paste0(...))

fmt   <- function(x, d = 4) formatC(as.numeric(x), format = "f", digits = d)
fmt_p <- function(p) {
  p <- as.numeric(p)
  if (length(p) == 0 || is.null(p) || is.na(p)) return("NA")
  if (p < 0.0001) "< 0.0001" else fmt(p)
}
s1 <- function(x) { x <- as.numeric(x); if (length(x) == 0) NA_real_ else x[1] }
si <- function(x) { x <- suppressWarnings(as.integer(x)); if (length(x) == 0) NA_integer_ else x[1] }

# ---------------------------------------------------------------------------
# Read CSV
# ---------------------------------------------------------------------------
if (!file.exists(input_file)) stop("Input file not found: ", input_file)
dat        <- read.csv(input_file, stringsAsFactors = FALSE, na.strings = "")
names(dat) <- trimws(tolower(names(dat)))

for (col in c("yi", "vi", "cluster"))
  if (!col %in% names(dat)) stop("Missing required column: ", col)

dat$yi <- as.numeric(dat$yi)
dat$vi <- as.numeric(dat$vi)
k      <- nrow(dat)
C      <- length(unique(dat$cluster))
# REML LL offset: evalLL_JS = R_logLik + (k-p)/2*log(2π) - ½*log|X'X|
# For intercept-only (p=1, X'X=k): offset = (k-1)/2*log(2π) - ½*log(k)
ll_offset <- (k - 1L) / 2 * log(2 * pi) - 0.5 * log(k)

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
lp("=== CLUSTER-ROBUST / THREE-LEVEL CROSS-VALIDATION RESULTS ===")
lp("Script:        compare_robust.R")
lp("Input:         ", basename(input_file))
lp("Mode:          ", mode_arg, " (",
   if (mode_arg == "rve") "Cluster-robust SE (CR1) + RVE" else "Three-level rma.mv", ")")
lp("Method:        ", method_arg)
if (mode_arg == "rve") lp("RVE rho:       ", rho_arg)
lp("Studies (k):   ", k)
lp("Clusters (C):  ", C)
lp("Generated:     ", format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
lp("")
lp("Dataset: Synthetic 4-cluster dataset (cluster_data.csv).")
lp("yi = effect size; vi = sampling variance; cluster = cluster ID; mod = continuous moderator.")
lp("")

# ===========================================================================
# MODE: RVE (cluster-robust SE)
# ===========================================================================
if (mode_arg == "rve") {

  suppressPackageStartupMessages({
    userLib <- Sys.getenv("R_LIBS_USER")
    .libPaths(c(userLib, .libPaths()))
    library(clubSandwich)
  })

  # JS CI formula: crit = qt(0.975, df) when df < 30, else qnorm(0.975)
  robust_ci <- function(beta, rob_se, df) {
    crit <- if (df < 30) qt(0.975, df) else qnorm(0.975)
    c(beta - crit * rob_se, beta + crit * rob_se)
  }

  # Q-based I² matching app formula: (Q - df) / Q
  i2_Q <- function(Q, df) max(0, 100 * (Q - df) / Q)

  # =========================================================================
  # SECTION 1: Intercept-only pooled estimate + cluster-robust SE
  # =========================================================================
  lp("=== SECTION 1: INTERCEPT-ONLY POOLED ESTIMATE + CLUSTER-ROBUST SE ===")
  lp("(Cross-validates js/robust.js robustMeta — CLUSTER_BENCHMARKS CL-style)")
  lp("rma(yi, vi, method = \"", method_arg, "\", data = dat)")
  lp("coef_test(res, vcov = \"CR1\", cluster = dat$cluster)")
  lp("")

  res1 <- rma(yi, vi, method = method_arg, data = dat)
  ct1  <- coef_test(res1, vcov = "CR1", cluster = dat$cluster)
  df1  <- C - 1L
  ci1  <- robust_ci(as.numeric(res1$beta), ct1[1, "SE"], df1)

  # I² — use Q-based formula to match app; report metafor's value for reference
  I2_app <- i2_Q(s1(res1$QE), k - 1L)

  lp("--- POOLED ESTIMATE ---")
  lp("RE (mu):        ", fmt(as.numeric(res1$beta)))
  lp("Model SE:       ", fmt(res1$se))
  lp("tau2:           ", fmt(res1$tau2))
  lp("I2 (Q-based):   ", fmt(I2_app), "%  [matches app formula (Q-df)/Q]")
  lp("I2 (tau2-based):", fmt(res1$I2), "%  [metafor res$I2; diverges from app]")
  lp("Q:              ", fmt(s1(res1$QE)), "  df = ", k - 1L,
     "  p = ", fmt_p(s1(res1$QEp)))
  lp("")
  lp("--- CLUSTER-ROBUST INFERENCE ---")
  lp("Robust SE:      ", fmt(ct1[1, "SE"]))
  lp("Robust CI:      [", fmt(ci1[1]), ", ", fmt(ci1[2]), "]")
  lp("df:             ", df1, "  (C - p = ", C, " - 1)")
  lp("Clusters (C):   ", C)
  lp("")

  # =========================================================================
  # SECTION 2: Meta-regression + cluster-robust SE per coefficient
  # =========================================================================
  lp("=== SECTION 2: META-REGRESSION + CLUSTER-ROBUST SE ===")
  lp("(Cross-validates js/regression.js metaRegression with cluster IDs)")

  if (!"mod" %in% names(dat)) {
    lp("WARNING: no 'mod' column in dataset — Section 2 skipped.")
    lp("")
  } else {
    lp("rma(yi, vi, mods = ~ mod, method = \"", method_arg, "\", data = dat)")
    lp("coef_test(res, vcov = \"CR1\", cluster = dat$cluster)")
    lp("")

    res2 <- rma(yi, vi, mods = ~ mod, method = method_arg, data = dat)
    ct2  <- coef_test(res2, vcov = "CR1", cluster = dat$cluster)
    df2  <- C - 2L

    lp("--- COEFFICIENTS (model-based SE) ---")
    lp(formatC("term",     width=-14), formatC("beta",    width=10),
       formatC("model SE", width=10))
    lp(paste(rep("-", 36), collapse=""))
    for (j in seq_len(nrow(res2$b))) {
      nm <- rownames(res2$b)[j]
      lp(formatC(nm, width=-14), formatC(fmt(res2$b[j,1]), width=10),
         formatC(fmt(res2$se[j]), width=10))
    }
    lp("")

    lp("--- COEFFICIENTS (cluster-robust SE, df = ", df2, ") ---")
    lp(formatC("term",      width=-14), formatC("beta",       width=10),
       formatC("rob SE",    width=10),  formatC("rob CI low",  width=12),
       formatC("rob CI hi", width=12),  formatC("t",           width=9),
       formatC("p",         width=9))
    lp(paste(rep("-", 74), collapse=""))
    for (j in seq_len(nrow(res2$b))) {
      nm   <- rownames(res2$b)[j]
      beta <- as.numeric(res2$b[j, 1])
      rse  <- ct2[j, "SE"]
      rci  <- robust_ci(beta, rse, df2)
      tval <- beta / rse
      pval <- 2 * pt(abs(tval), df = df2, lower.tail = FALSE)
      lp(formatC(nm,         width=-14), formatC(fmt(beta),    width=10),
         formatC(fmt(rse),   width=10),  formatC(fmt(rci[1]),  width=12),
         formatC(fmt(rci[2]),width=12),  formatC(fmt(tval),    width=9),
         formatC(fmt_p(pval),width=9))
    }
    lp("")

    lp("--- MODEL TESTS ---")
    lp("QM (omnibus, model-based):  ", fmt(s1(res2$QM)), "  df = ", si(res2$QMdf[1]),
       "  p = ", fmt_p(s1(res2$QMp)))
    lp("QE (residual):              ", fmt(s1(res2$QE)), "  df = ", si(k - 2L),
       "  p = ", fmt_p(s1(res2$QEp)))
    lp("tau2:                       ", fmt(res2$tau2))
    lp("R2:                         ", fmt(s1(res2$R2)), "%")
    lp("")
  }

  # =========================================================================
  # SECTION 3: RVE pooled estimate (Hedges-Tipton-Johnson 2010)
  # =========================================================================
  lp("=== SECTION 3: RVE POOLED ESTIMATE (Hedges-Tipton-Johnson 2010) ===")
  lp("(Cross-validates js/regression.js rvePooled — RVE_BENCHMARKS style)")
  lp("Working model: V_i[j,j]=vi_j, V_i[j,k]=rho*sqrt(vi_j*vi_k), rho=", rho_arg)
  lp("Manual implementation matching app rvePooled (omega^2=0, uses vi directly).")
  lp("Reference: Hedges, Tipton & Johnson (2010, Res Synth Methods 1:39-65).")
  lp("")

  # Replicated from generate.R rve_manual — same formula as js/regression.js rvePooled
  rve_pooled <- function(yi, vi, cluster, rho = 0.80, alpha = 0.05) {
    rho1   <- 1 - rho
    cl_ids <- unique(as.character(cluster))
    m      <- length(cl_ids)

    sumA <- 0; sumB <- 0; clList <- list()
    for (id in cl_ids) {
      idx  <- which(as.character(cluster) == id)
      yi_i <- yi[idx]; vi_i <- vi[idx]; ki <- length(idx)
      ci   <- rho1 + rho * ki
      wi   <- 1/vi_i; si <- sqrt(wi)
      Wi   <- sum(wi); WYi <- sum(wi * yi_i)
      Si   <- sum(si); SYi <- sum(si * yi_i)
      Ai   <- (Wi - rho * Si^2 / ci) / rho1
      bi   <- (WYi - rho * Si * SYi / ci) / rho1
      sumA <- sumA + Ai; sumB <- sumB + bi
      clList[[id]] <- list(Ai=Ai, wi=wi, si=si, yi=yi_i, Si=Si, ci=ci)
    }
    est <- sumB / sumA

    sumEps2 <- 0
    for (cl in clList) {
      ei   <- cl$yi - est
      WXEi <- sum(cl$wi * ei)
      SEi  <- sum(cl$si * ei)
      gi   <- (WXEi - rho * cl$Si * SEi / cl$ci) / rho1
      sumEps2 <- sumEps2 + gi^2
    }
    varEst <- (m / (m - 1)) * sumEps2 / sumA^2
    se   <- sqrt(varEst)
    df   <- m - 1
    crit <- qt(1 - alpha/2, df)
    tval <- est / se
    pval <- 2 * (1 - pt(abs(tval), df))
    list(est=est, se=se, df=df,
         ciLow=est-crit*se, ciHigh=est+crit*se,
         t=tval, p=pval, m=m)
  }

  rve <- rve_pooled(dat$yi, dat$vi, dat$cluster, rho = rho_arg)

  lp("--- RVE ESTIMATE ---")
  lp("RVE est:      ", fmt(rve$est))
  lp("SE:           ", fmt(rve$se))
  lp("CI:           [", fmt(rve$ciLow), ", ", fmt(rve$ciHigh), "]")
  lp("t:            ", fmt(rve$t))
  lp("df:           ", rve$df, "  (m - 1 = ", rve$m, " - 1)")
  lp("p:            ", fmt_p(rve$p))
  lp("Clusters (m): ", rve$m)
  lp("")

# ===========================================================================
# MODE: 3L (three-level)
# ===========================================================================
} else {

  if ("study" %in% names(dat)) {
    dat$study_id <- as.character(dat$study)
  } else {
    dat$study_id <- paste0(dat$cluster, "_", seq_len(k))
  }

  # =========================================================================
  # SECTION 1: Three-level rma.mv
  # =========================================================================
  lp("=== SECTION 1: THREE-LEVEL META-ANALYSIS ===")
  lp("(Cross-validates js/regression.js meta3level — THREE_LEVEL_BENCHMARKS style)")
  lp("rma.mv(yi, vi, random = ~ 1 | cluster/study_id, method = \"", method_arg, "\", data = dat)")
  lp("")
  lp("Note: metafor sigma2[1] = between-cluster (tau2_between in app);")
  lp("      metafor sigma2[2] = within-cluster  (tau2_within  in app).")
  lp("")

  res3 <- rma.mv(yi, vi, random = ~ 1 | cluster/study_id,
                 method = method_arg, data = dat)

  mu3    <- as.numeric(coef(res3))
  se3    <- res3$se
  ci3_lo <- res3$ci.lb
  ci3_hi <- res3$ci.ub
  z3     <- mu3 / se3
  p3     <- 2 * pnorm(abs(z3), lower.tail = FALSE)

  s2b <- res3$sigma2[1]   # between-cluster (tau2_between in app)
  s2w <- res3$sigma2[2]   # within-cluster  (tau2_within  in app)

  W0     <- sum(1 / dat$vi)
  vi_typ <- 1 / W0
  tot3   <- s2w + s2b + vi_typ
  I2w    <- if (tot3 > 0) 100 * s2w / tot3 else 0
  I2b    <- if (tot3 > 0) 100 * s2b / tot3 else 0

  ll_R  <- as.numeric(logLik(res3))[1]
  ll_JS <- ll_R + ll_offset

  lp("--- POOLED ESTIMATE ---")
  lp("mu:           ", fmt(mu3))
  lp("SE:           ", fmt(se3))
  lp("CI:           [", fmt(ci3_lo), ", ", fmt(ci3_hi), "]")
  lp("z:            ", fmt(z3))
  lp("p:            ", fmt_p(p3))
  lp("")

  lp("--- VARIANCE COMPONENTS ---")
  lp("tau2_between (sigma2[1]):  ", fmt(s2b, 7), "  (between-cluster)")
  lp("tau2_within  (sigma2[2]):  ", fmt(s2w, 7), "  (within-cluster)")
  lp("I2_between:               ", fmt(I2b))
  lp("I2_within:                ", fmt(I2w))
  lp("")

  lp("--- HETEROGENEITY ---")
  lp("Q (FE):  ", fmt(s1(res3$QE)), "  df = ", si(k - 1L),
     "  p = ", fmt_p(s1(res3$QEp)))
  lp("")

  lp("--- LOG-LIKELIHOOD ---")
  lp("LL (R convention):   ", fmt(ll_R, 7))
  lp("  JS LL = R_LL + (k-1)/2*log(2*pi) - (1/2)*log(k)")
  lp("       = R_LL + ", fmt(ll_offset, 4))
  lp("  JS LL ≈ ", fmt(ll_JS, 7))
  lp("")
}

# ===========================================================================
# KNOWN DIVERGENCES
# ===========================================================================
lp("=== KNOWN DIVERGENCES ===")
lp("All differences below are expected. None indicate computation errors.")
lp("")
if (mode_arg == "rve") {
  lp("1. I² FORMULA (Section 1)")
  lp("   App uses Q-based I²: (Q - df) / Q * 100.  R res$I2 uses tau2/(tau2+v_typ).")
  lp("   Compare 'I2 (Q-based)' line in Section 1 against app; ignore 'I2 (tau2-based)'.")
  lp("   Divergence is largest for ML estimator and near-zero tau2.")
  lp("")
  lp("2. TWO SEPARATE ROBUST METHODS (Sections 1/2 vs Section 3)")
  lp("   Sections 1-2: CR1 sandwich (clubSandwich) applied AFTER rma().")
  lp("     App: robustMeta / metaRegression with cluster IDs.")
  lp("     Working model: uses RE weights w_i = 1/(vi + tau2).")
  lp("   Section 3: HTJ RVE applied to a compound-symmetry working model.")
  lp("     App: rvePooled with rho=", rho_arg, ".")
  lp("     Working model: V_i[j,k] = rho*sqrt(vi_j*vi_k), no tau2 estimated.")
  lp("   These are INDEPENDENT estimates. App displays both; they need not agree.")
  lp("")
  lp("3. CLUBSANDWICH CR1 MATCHES APP sandwichVar EXACTLY")
  lp("   V_rob = (C/(C-p)) * A * B * A  (A=(X'WX)^-1, B=meat).")
  lp("   Verified in generate.R blocks CL-1 through CL-3.")
  lp("")
  lp("4. HTJ RVE FORMULA MATCHES APP rvePooled EXACTLY")
  lp("   rve_pooled() above replicates generate.R rve_manual() which is verified")
  lp("   against js/regression.js rvePooled in generate.R blocks RVE-1 through RVE-3.")
  lp("")
  lp("5. DF FORMULAS")
  lp("   CR1 sections: df = C - p  (C=clusters, p=params; p=1 S1, p=2 S2).")
  lp("   RVE section:  df = m - 1  (m=clusters, intercept-only).")
  lp("   t-distribution used when df < 30; normal otherwise.")
  lp("")
  lp("6. DISPLAY PRECISION")
  lp("   This script prints 4 decimal places; app displays 3.")
} else {
  lp("1. SIGMA2 ORDERING (metafor vs app)")
  lp("   metafor: sigma2[1] = between-cluster, sigma2[2] = within-cluster.")
  lp("   App (meta3level): tau2_between = sigma2[1], tau2_within = sigma2[2].")
  lp("")
  lp("2. LOG-LIKELIHOOD CONSTANT")
  lp("   JS meta3level evalLL omits normalising constants (valid for optimisation).")
  lp("   R logLik() uses full REML: -(k-p)/2*log(2π) - ½*log|Σ| - ½*QF - ½*log(X'Σ⁻¹X) + ½*log|X'X|")
  lp("   JS evalLL omits -(k-p)/2*log(2π) and +½*log|X'X| (both constant in θ).")
  lp("   For intercept-only (p=1, X'X=k):")
  lp("     JS_LL = R_LL + (k-1)/2*log(2π) - ½*log(k) = R_LL + ", fmt(ll_offset, 4))
  lp("   Use 'JS LL' line above to compare against app display.")
  lp("")
  lp("3. I² FORMULA")
  lp("   vi_typical = 1/sum(1/vi) (harmonic mean of sampling variances).")
  lp("   I2_between = tau2_between / (tau2_between + tau2_within + vi_typical).")
  lp("   I2_within  = tau2_within  / (tau2_between + tau2_within + vi_typical).")
  lp("   Matches generate.R THREE-1/THREE-2 formula exactly.")
  lp("")
  lp("4. DISPLAY PRECISION")
  lp("   This script prints 4 decimal places; app displays 3.")
}
lp("")
lp("=== END OF RESULTS ===")

writeLines(lines, output_file)
cat("Results written to:", output_file, "\n")
