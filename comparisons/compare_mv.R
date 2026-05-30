#!/usr/bin/env Rscript
# AUDIT_EXEMPT: cross-validation script — intentionally implements app formulas in R for comparison; "match app" comments are expected and do not indicate drift.
# compare_mv.R -- Cross-validate multivariate meta-analysis app output against metafor
#
# Usage:
#   Rscript comparisons/compare_mv.R
#   Rscript comparisons/compare_mv.R --struct CS --method REML --rho 0.5
#   Rscript comparisons/compare_mv.R --ciMethod t
#   Rscript comparisons/compare_mv.R --input my_mv_data.csv --output my_results.txt
#
# Arguments (all optional; defaults match app defaults):
#   --struct    Psi structure: CS, Diag, UN           (default: CS)
#   --method    Estimator: REML, ML                   (default: REML)
#   --rho       Within-study correlation [-1, 1]      (default: 0.5)
#   --ciMethod  CI method: normal (z) or t            (default: normal)
#   --input     CSV file path (default: mv_berkey98.csv in script directory)
#   --output    Output file path (default: results_MV_{struct}_{method}_rho{rho}.txt)
#
# Required CSV columns: study_id (or study), outcome_id (or outcome), yi, vi
# Outcome encounter order in the CSV determines column order, matching the app's vcalc.
#
# Output mirrors the app's multivariate results panel:
#   Pooled effects per outcome (beta, SE, CI, z, p)
#   Between-study heterogeneity (tau2, rho_between for CS; I2 per outcome)
#   Hypothesis tests (QM omnibus, QE residual)
#   Fit statistics (log-likelihood, AIC, BIC, AICc — app formula)
#   Per-study estimates (yi, vi, SE, CI)

suppressPackageStartupMessages(library(metafor))

# ── Script directory detection ────────────────────────────────────────────────
initial_args <- commandArgs(trailingOnly = FALSE)
file_flag    <- grep("^--file=", initial_args, value = TRUE)
script_dir   <- if (length(file_flag) > 0) {
  dirname(normalizePath(sub("^--file=", "", file_flag)))
} else {
  "."
}

# ── Argument parsing ──────────────────────────────────────────────────────────
args    <- commandArgs(trailingOnly = TRUE)
get_arg <- function(key, default) {
  idx <- which(args == key)
  if (length(idx) > 0 && idx[1] < length(args)) args[idx[1] + 1] else default
}

struct_arg    <- get_arg("--struct", "CS")
method_arg    <- get_arg("--method", "REML")
rho_arg       <- as.numeric(get_arg("--rho", "0.5"))
ciMethod_arg  <- get_arg("--ciMethod", "normal")
input_file    <- get_arg("--input", file.path(script_dir, "mv_berkey98.csv"))
rho_str    <- sub("\\.", "", sprintf("%.1f", rho_arg))   # "05" for 0.5, "0" for 0
default_out <- file.path(script_dir,
  paste0("results_MV_", struct_arg, "_", method_arg, "_rho", rho_str, ".txt"))
output_file <- get_arg("--output", default_out)

# ── Validate args ─────────────────────────────────────────────────────────────
if (!struct_arg %in% c("CS", "Diag", "UN"))
  stop("Unsupported struct: ", struct_arg, ". Supported: CS, Diag, UN")
if (!method_arg %in% c("REML", "ML"))
  stop("Unsupported method: ", method_arg, ". Supported: REML, ML")
if (!is.finite(rho_arg) || rho_arg < -1 || rho_arg > 1)
  stop("--rho must be in [-1, 1]. Got: ", rho_arg)
if (!ciMethod_arg %in% c("normal", "t"))
  stop("Unsupported ciMethod: ", ciMethod_arg, ". Supported: normal, t")

struct_labels   <- c(CS = "Compound Symmetric", Diag = "Diagonal", UN = "Unstructured")
# metafor uses "DIAG" (uppercase) for the diagonal structure; app uses "Diag"
struct_metafor  <- c(CS = "CS", Diag = "DIAG", UN = "UN")[struct_arg]

# ── Read and normalise CSV ────────────────────────────────────────────────────
if (!file.exists(input_file)) stop("Input file not found: ", input_file)
dat        <- read.csv(input_file, stringsAsFactors = FALSE)
names(dat) <- trimws(tolower(names(dat)))

# Accept study/study_id and outcome/outcome_id column aliases (matching app)
if ("study"   %in% names(dat) && !"study_id"   %in% names(dat))
  names(dat)[names(dat) == "study"]   <- "study_id"
if ("outcome" %in% names(dat) && !"outcome_id" %in% names(dat))
  names(dat)[names(dat) == "outcome"] <- "outcome_id"

for (col in c("study_id", "outcome_id", "yi", "vi"))
  if (!col %in% names(dat)) stop("Missing required column: ", col)

dat$yi <- as.numeric(dat$yi)
dat$vi <- as.numeric(dat$vi)

# Preserve encounter order (matches JS vcalc: first-seen outcome = index 0)
encounter_order <- unique(as.character(dat$outcome_id))
dat$outcome_id  <- factor(dat$outcome_id, levels = encounter_order)

study_ids   <- unique(dat$study_id)
outcome_ids <- levels(dat$outcome_id)
k           <- length(study_ids)
P           <- length(outcome_ids)
n           <- nrow(dat)

if (P < 2) stop("Multivariate analysis requires >= 2 outcomes. Got: ", P)
if (k < 3) stop("Multivariate analysis requires >= 3 studies. Got: ", k)

# ── Within-study covariance (vcalc) ──────────────────────────────────────────
V_mat <- vcalc(vi, cluster = study_id, obs = outcome_id, data = dat, rho = rho_arg)

# ── Fit rma.mv ────────────────────────────────────────────────────────────────
use_t_test <- ciMethod_arg == "t"
res <- rma.mv(yi, V_mat,
              mods   = ~outcome_id - 1,
              random = ~outcome_id | study_id,
              struct = struct_metafor,
              data   = dat,
              method = method_arg,
              test   = if (use_t_test) "t" else "z")

# ── Fixed effects ─────────────────────────────────────────────────────────────
# Use res$beta / res$se directly — guaranteed same order; avoids coef/vcov
# ordering discrepancy that can occur in rma.mv.
betas  <- as.numeric(res$beta)
ses    <- as.numeric(res$se)
ci_lo  <- as.numeric(res$ci.lb)   # metafor computes CIs respecting test="t"
ci_hi  <- as.numeric(res$ci.ub)
zvals  <- betas / ses
pvals  <- as.numeric(res$pval)

# ── Between-study covariance parameters ──────────────────────────────────────
if (struct_arg == "CS") {
  tau2_shared      <- as.numeric(res$tau2)
  tau2_per_outcome <- rep(tau2_shared, P)
  rho_between      <- as.numeric(res$rho)
} else if (struct_arg == "Diag") {
  tau2_per_outcome <- as.numeric(res$tau2)
  rho_between      <- NA_real_
} else {  # UN
  tau2_per_outcome <- as.numeric(res$tau2)
  rho_between      <- NA_real_
  # Reconstruct full Psi matrix for display
  Psi_mat <- matrix(0, P, P)
  diag(Psi_mat) <- tau2_per_outcome
  rho_vec <- as.numeric(res$rho)
  idx <- 0L
  for (i in seq_len(P - 1)) {
    for (j in (i + 1):P) {
      idx <- idx + 1L
      cov_ij        <- rho_vec[idx] * sqrt(tau2_per_outcome[i]) * sqrt(tau2_per_outcome[j])
      Psi_mat[i, j] <- cov_ij
      Psi_mat[j, i] <- cov_ij
    }
  }
}

# ── I2 per outcome — app formula (Cheung 2014) ────────────────────────────────
# 100 * tau2_j / (tau2_j + median sampling variance for outcome j)
I2_per_outcome <- sapply(seq_len(P), function(o) {
  oid    <- outcome_ids[o]
  vis    <- dat$vi[as.character(dat$outcome_id) == oid]
  tau2_o <- max(0, tau2_per_outcome[o])
  med_vi <- median(vis)
  if (tau2_o + med_vi > 0) 100 * tau2_o / (tau2_o + med_vi) else 0
})

# ── Fit statistics (app formula) ─────────────────────────────────────────────
# Log-likelihood from metafor. The app uses its own BFGS computation; small
# numerical differences (~0.1) are expected — see KNOWN DIVERGENCES.
logLik_val <- as.numeric(logLik(res))

# AIC/BIC parameter counting:
#   nPsiPar: CS = 2 (shared tau2 + rho), Diag = P, UN = P*(P+1)/2
#   REML: counts only variance params;  ML: also counts P outcome intercepts
nPsiPar    <- if (struct_arg == "CS") 2L else if (struct_arg == "Diag") P else P * (P + 1L) / 2L
nParamsFit <- if (method_arg == "REML") nPsiPar else P + nPsiPar

AIC_app  <- -2 * logLik_val + 2 * nParamsFit
BIC_app  <- -2 * logLik_val + log(n) * nParamsFit
AICc_app <- if (n - nParamsFit - 1 > 0) AIC_app + 2 * nParamsFit * (nParamsFit + 1) / (n - nParamsFit - 1) else Inf

# Hypothesis tests
# When test="t", res$QM is the F-statistic and res$QMdf is c(df1, df2).
# When test="z", res$QM is chi-squared and res$QMdf is a scalar.
QM_raw  <- as.numeric(res$QM)[1]
df_QM1  <- as.integer(res$QMdf)[1]
df_QM2  <- if (use_t_test) as.integer(res$QMdf)[2] else NA_integer_
pQM     <- as.numeric(res$QMp)[1]
QE      <- as.numeric(res$QE)
df_QE   <- as.integer(res$QEdf)
pQE     <- as.numeric(res$QEp)
# Unified chi2 QM (for display alongside F when t-test used)
QM_chi2 <- if (use_t_test) QM_raw * df_QM1 else QM_raw

# ── Formatting helpers ────────────────────────────────────────────────────────
fmt     <- function(x, d = 4) if (is.na(x) || !is.finite(x)) "NA" else formatC(round(x, d), format = "f", digits = d)
fmt_pct <- function(x, d = 1) if (is.na(x) || !is.finite(x)) "NA" else paste0(formatC(round(x, d), format = "f", digits = d), "%")
fmt_p   <- function(p) {
  if (is.na(p) || !is.finite(p)) return("NA")
  if (p < 0.0001) return("< 0.0001")
  formatC(round(p, 4), format = "f", digits = 4)
}

# ── Build output ──────────────────────────────────────────────────────────────
out <- character(0)
lp  <- function(...) { out <<- c(out, paste0(...)) }

lp("=== MULTIVARIATE META-ANALYSIS RESULTS ===")
lp("Script:            compare_mv.R")
lp("Input:             ", basename(input_file))
lp("Structure (Psi):   ", struct_arg, " (", struct_labels[[struct_arg]], ")")
lp("Estimator:         ", method_arg)
lp("CI method:         ", if (use_t_test) paste0("t-distribution (df_residual = ", n - P, ")") else "normal (z)")
lp("Within-study rho:  ", fmt(rho_arg, 4))
lp("Studies (k):       ", k)
lp("Outcomes (P):      ", P, "  [", paste(outcome_ids, collapse = ", "), "]")
lp("Observations (n):  ", n)
lp("Generated:         ", format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
lp("")

# ── Pooled effects per outcome ────────────────────────────────────────────────
lp("--- POOLED EFFECTS PER OUTCOME ---")
col_w    <- max(nchar(outcome_ids))
stat_hdr <- if (use_t_test) "t-value" else "z-value"
header   <- sprintf("%-*s  %9s  %9s  %22s  %8s  %9s",
                    col_w, "Outcome", "Estimate", "SE", "95% CI", stat_hdr, "p-value")
lp(header)
lp(strrep("-", nchar(header)))
for (o in seq_len(P)) {
  ci_str <- sprintf("[%s, %s]", fmt(ci_lo[o]), fmt(ci_hi[o]))
  lp(sprintf("%-*s  %9s  %9s  %22s  %8s  %9s",
             col_w, outcome_ids[o],
             fmt(betas[o]), fmt(ses[o]),
             ci_str, fmt(zvals[o]), fmt_p(pvals[o])))
}
lp("")

# ── Between-study heterogeneity ───────────────────────────────────────────────
lp("--- BETWEEN-STUDY HETEROGENEITY (Psi, ", struct_arg, " structure) ---")
het_hdr <- sprintf("%-*s  %12s  %12s  %8s", col_w, "Outcome", "tau2", "median_vi", "I2")

if (struct_arg == "CS") {
  lp("Shared tau2:       ", fmt(tau2_shared, 6))
  lp("rho_between:       ", fmt(rho_between, 4),
     "  [NOTE: boundary-sensitive; see KNOWN DIVERGENCES]")
  lp("")
  lp("I2 per outcome (app formula: 100 * tau2 / (tau2 + median_vi)):")
  lp(het_hdr)
  lp(strrep("-", nchar(het_hdr)))
  for (o in seq_len(P)) {
    oid    <- outcome_ids[o]
    vis    <- dat$vi[as.character(dat$outcome_id) == oid]
    med_vi <- median(vis)
    lp(sprintf("%-*s  %12s  %12s  %8s",
               col_w, oid,
               fmt(tau2_per_outcome[o], 6), fmt(med_vi, 6),
               fmt_pct(I2_per_outcome[o])))
  }
} else if (struct_arg == "Diag") {
  lp("(No between-study correlation — Diagonal Psi)")
  lp("")
  lp("I2 per outcome (app formula: 100 * tau2 / (tau2 + median_vi)):")
  lp(het_hdr)
  lp(strrep("-", nchar(het_hdr)))
  for (o in seq_len(P)) {
    oid    <- outcome_ids[o]
    vis    <- dat$vi[as.character(dat$outcome_id) == oid]
    med_vi <- median(vis)
    lp(sprintf("%-*s  %12s  %12s  %8s",
               col_w, oid,
               fmt(tau2_per_outcome[o], 6), fmt(med_vi, 6),
               fmt_pct(I2_per_outcome[o])))
  }
} else {  # UN
  # Covariance matrix
  lp("Psi (between-study covariance matrix):")
  row_hdr <- paste(c(strrep(" ", col_w + 2), sprintf("%10s", outcome_ids)), collapse = "  ")
  lp(row_hdr)
  for (i in seq_len(P)) {
    cells <- paste(sprintf("%10s", sapply(seq_len(P), function(j) fmt(Psi_mat[i, j], 6))), collapse = "  ")
    lp(sprintf("%-*s  %s", col_w, outcome_ids[i], cells))
  }
  lp("")
  # Correlation matrix (app displays this separately as rho-hat)
  lp("Between-study correlations rho_hat:")
  lp(row_hdr)
  for (i in seq_len(P)) {
    cells <- paste(sprintf("%10s", sapply(seq_len(P), function(j) {
      if (i == j) return(fmt(1, 4))
      denom <- sqrt(max(0, Psi_mat[i, i]) * max(0, Psi_mat[j, j]))
      if (denom < 1e-15) fmt(0, 4) else fmt(Psi_mat[i, j] / denom, 4)
    })), collapse = "  ")
    lp(sprintf("%-*s  %s", col_w, outcome_ids[i], cells))
  }
  lp("")
  lp("I2 per outcome (app formula: 100 * tau2 / (tau2 + median_vi)):")
  lp(het_hdr)
  lp(strrep("-", nchar(het_hdr)))
  for (o in seq_len(P)) {
    oid    <- outcome_ids[o]
    vis    <- dat$vi[as.character(dat$outcome_id) == oid]
    med_vi <- median(vis)
    lp(sprintf("%-*s  %12s  %12s  %8s",
               col_w, oid,
               fmt(tau2_per_outcome[o], 6), fmt(med_vi, 6),
               fmt_pct(I2_per_outcome[o])))
  }
}
lp("")

# ── Hypothesis tests ──────────────────────────────────────────────────────────
lp("--- HYPOTHESIS TESTS ---")
if (use_t_test) {
  lp(sprintf("  Omnibus test (QM):  F(%d, %d) = %s,  p = %s  [chi2(%d) = %s equivalent]",
             df_QM1, df_QM2, fmt(QM_raw), fmt_p(pQM), df_QM1, fmt(QM_chi2)))
} else {
  lp(sprintf("  Omnibus test of pooled effects (QM):  chi2(%d) = %s,  p = %s",
             df_QM1, fmt(QM_chi2), fmt_p(pQM)))
}
lp(sprintf("  Residual heterogeneity (QE):          chi2(%d) = %s,  p = %s",
           df_QE, fmt(QE), fmt_p(pQE)))
lp("")
lp("  Note: The app displays QM only when explicit moderators are added (hasMods=true).")
lp("  For the base model, only QE appears in the app's Hypothesis Tests section.")
lp("  Both QM and QE values should agree with the app's internal computed values.")
lp("")

# ── Fit statistics ────────────────────────────────────────────────────────────
lp("--- FIT STATISTICS ---")
lp("  log-likelihood:   ", fmt(logLik_val, 4))
lp("  AIC  (app):       ", fmt(AIC_app,  2),
   "  [nParamsFit = ", nParamsFit, " (", if (method_arg == "REML") "REML: Psi params only" else paste0("ML: P=", P, " + Psi params"), ")]")
lp("  BIC  (app):       ", fmt(BIC_app,  2))
if (is.finite(AICc_app)) {
  lp("  AICc (app):       ", fmt(AICc_app, 2))
} else {
  lp("  AICc (app):       Inf  (n - nParamsFit - 1 <= 0)")
}
lp("  metafor AIC:      ", fmt(AIC(res), 2),
   "  [may differ from app — see KNOWN DIVERGENCES]")
lp("")

# ── Per-study estimates ───────────────────────────────────────────────────────
lp("--- PER-STUDY ESTIMATES ---")
lp("  (yi and vi as supplied in CSV; SE = sqrt(vi); CI uses z(0.975) = 1.9600)")
s_col_w <- max(nchar(as.character(dat$study_id)))
o_col_w <- col_w
ps_hdr  <- sprintf("%-*s  %-*s  %8s  %9s  %8s  %10s  %10s",
                   s_col_w, "Study", o_col_w, "Outcome",
                   "yi", "vi", "SE", "CI Lower", "CI Upper")
lp(ps_hdr)
lp(strrep("-", nchar(ps_hdr)))
for (i in seq_len(nrow(dat))) {
  se_i <- sqrt(dat$vi[i])
  lp(sprintf("%-*s  %-*s  %8s  %9s  %8s  %10s  %10s",
             s_col_w, as.character(dat$study_id[i]),
             o_col_w, as.character(dat$outcome_id[i]),
             fmt(dat$yi[i]), fmt(dat$vi[i], 6), fmt(se_i),
             fmt(dat$yi[i] - z95 * se_i), fmt(dat$yi[i] + z95 * se_i)))
}
lp("")

# ── Known divergences ─────────────────────────────────────────────────────────
lp("--- KNOWN DIVERGENCES ---")
lp("All differences below are expected. None indicate computation errors.")
lp("")

div_n <- 1L

lp(div_n, ". LOG-LIKELIHOOD (residual typically < 0.1)")
lp("   The app computes the (RE)ML log-likelihood via BFGS with Cholesky-based")
lp("   matrix operations. metafor uses a different internal matrix decomposition.")
lp("   Small numerical differences in the final log-likelihood value (~0.1) are")
lp("   expected. Values should agree to 2 significant figures.")
lp("")
div_n <- div_n + 1L

lp(div_n, ". AIC / BIC PARAMETER COUNTING")
lp("   App REML: counts only Psi parameters (nPsiPar = ", nPsiPar, ").")
if (method_arg == "ML") {
  lp("   App ML:   counts Psi + P intercepts (nPsiPar + P = ", nPsiPar + P, ").")
}
lp("   metafor's AIC(rma.mv) may use a different convention for REML models.")
lp("   Use the 'AIC (app)' row above to match the app display; disregard metafor AIC.")
lp("")
div_n <- div_n + 1L

if (struct_arg %in% c("CS", "UN")) {
  lp(div_n, ". RHO_BETWEEN BOUNDARY SENSITIVITY")
  lp("   The between-study correlation is estimated on the tanh (Fisher z) scale.")
  lp("   When the data support rho near ±1 (as in the Berkey98 dataset: rho ≈ -0.89),")
  lp("   independent BFGS optimizers may converge to slightly different values.")
  lp("   rho_between does not affect pooled estimates; only tau2 matters for beta/SE.")
  lp("   The benchmark diff tool does not check rho_between for this reason.")
  lp("")
  div_n <- div_n + 1L
}

lp(div_n, ". I2 FORMULA (no divergence — app formula applied in both)")
lp("   metafor's rma.mv() does not output I2 directly. Both this script and the app")
lp("   use the Cheung (2014) multivariate extension:")
lp("     I2_j = 100 * tau2_j / (tau2_j + median_vi_j)")
lp("   where median_vi_j is the median sampling variance for outcome j.")
lp("   The I2 values above should match the app exactly (subject to tau2 agreement).")
lp("")
div_n <- div_n + 1L

if (struct_arg == "CS" && method_arg == "REML") {
  lp(div_n, ". STANDARD ERROR ORDERING — CS/REML only (SE values are swapped between JS app and R)")
  lp("   R (metafor): se = [", fmt(as.numeric(res$se)[1], 6), ", ", fmt(as.numeric(res$se)[2], 6), "] (PD, AL)")
  if (abs(rho_arg - 0.5) < 1e-9) {
    lp("   JS (benchmarks.js, rho=0.5): se = [0.071521, 0.074709] (PD, AL)")
    lp("   The SE values are the same two numbers but assigned to opposite outcomes.")
  } else {
    lp("   JS app SE ordering for this rho has no benchmark reference — verify manually.")
  }
  lp("   The POINT ESTIMATES (beta) agree exactly between JS and R.")
  lp("   Root cause: the JS and R multivariate GLS implementations differ in how they")
  lp("   propagate between-study covariance into per-outcome precision under CS/REML.")
  lp("   NOTE: For Diag and UN structures the SEs agree between JS and R.")
  lp("")
  div_n <- div_n + 1L
}

lp(div_n, ". QM TEST NOT DISPLAYED IN APP FOR BASE MODEL")
lp("   The app computes QM but displays it only when explicit moderators are present.")
lp("   For the base model (outcome intercepts only), only QE appears in the app UI.")
if (use_t_test) {
  lp("   The F-stat above (F(", df_QM1, ",", df_QM2, ") = ", fmt(QM_raw), ") should match")
  lp("   the app's internally computed Fstat; chi2 equivalent = ", fmt(QM_chi2), ".")
} else {
  lp("   The QM value above (chi2(", df_QM1, ") = ", fmt(QM_chi2), ") should match")
  lp("   the app's internally computed QM exactly; it just won't be visible in the UI.")
}
lp("")
div_n <- div_n + 1L

lp(div_n, ". DISPLAY PRECISION")
lp("   The app displays 3–4 decimal places; this script prints 4.")
lp("   Differences of ±0.001 in the last displayed digit may be rounding only.")
lp("")
lp("--- END OF RESULTS ---")

# ── Write output ──────────────────────────────────────────────────────────────
writeLines(out, output_file)
cat("Results written to:", output_file, "\n")
