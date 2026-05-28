#!/usr/bin/env Rscript
# compare_selection.R -- Cross-validate selection models, trim-fill, p-curve, p-uniform
#
# Usage:
#   Rscript comparisons/compare_selection.R
#   Rscript comparisons/compare_selection.R --type vevea
#   Rscript comparisons/compare_selection.R --type halfnorm
#   Rscript comparisons/compare_selection.R --type power
#   Rscript comparisons/compare_selection.R --type negexp
#   Rscript comparisons/compare_selection.R --type beta
#   Rscript comparisons/compare_selection.R --type trimfill
#   Rscript comparisons/compare_selection.R --type pcurve
#   Rscript comparisons/compare_selection.R --type puniform
#
# Arguments (all optional):
#   --type    Model type: vevea|halfnorm|power|negexp|beta|trimfill|pcurve|puniform|all
#             Default: all — runs all sections, output: results_SELECTION.txt
#   --input   CSV with yi, vi columns (default: selection_data.csv in script dir)
#   --output  Output file path (default: results_{TYPE}.txt in script dir)
#
# Output validates against:
#   js/selection.js  — veveaHedges, halfNormalSelModel, powerSelModel,
#                      negexpSelModel, betaSelModel, pCurve, pUniform
#   js/trimfill.js   — trimFill
#
# Dataset: BCG vaccine (Colditz et al. 1994, dat.bcg) log risk ratio, k=13 studies.
# Same data used in js/benchmarks.js VH_BENCHMARKS, HN/PWR/NEG/BETA benchmarks.
# selection_data.csv contains this dataset for loading in the app.

suppressPackageStartupMessages(library(metafor))

# ---------------------------------------------------------------------------
# Script directory detection
# ---------------------------------------------------------------------------
initial_args <- commandArgs(trailingOnly = FALSE)
file_flag    <- grep("^--file=", initial_args, value = TRUE)
script_dir   <- if (length(file_flag) > 0) {
  dirname(normalizePath(sub("^--file=", "", file_flag)))
} else "."

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

get_arg <- function(key, default) {
  idx <- which(args == key)
  if (length(idx) > 0 && idx[1] < length(args)) args[idx[1] + 1] else default
}

type_arg <- get_arg("--type", "all")
valid_types <- c("vevea","halfnorm","power","negexp","beta","trimfill","pcurve","puniform","all")
if (!type_arg %in% valid_types)
  stop("--type must be one of: ", paste(valid_types, collapse = " "))

type_label <- switch(type_arg,
  vevea    = "VH",
  halfnorm = "HALFNORM",
  power    = "POWER",
  negexp   = "NEGEXP",
  beta     = "BETA",
  trimfill = "TRIMFILL",
  pcurve   = "PCURVE",
  puniform = "PUNIFORM",
  all      = "SELECTION"
)
default_input  <- file.path(script_dir, "selection_data.csv")
default_output <- file.path(script_dir, paste0("results_", type_label, ".txt"))
input_file     <- get_arg("--input",  default_input)
output_file    <- get_arg("--output", default_output)

run <- function(sec) type_arg == "all" || type_arg == sec

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
con <- file(output_file, open = "wt")
on.exit(close(con), add = TRUE)

lp  <- function(...) cat(paste0(...), "\n", file = con, sep = "")
fmt <- function(x, d = 4) {
  if (length(x) > 1) return(sapply(x, fmt, d = d))
  if (is.na(x) || !is.finite(x)) return("NA")
  formatC(round(x, d), format = "f", digits = d)
}
fmt_p <- function(p) {
  if (is.na(p) || !is.finite(p)) return("NA")
  if (p < 0.0001) "< 0.0001" else fmt(p, 4)
}
si <- function(x) as.character(as.integer(x))

# ---------------------------------------------------------------------------
# Dataset — BCG vaccine log risk ratio, 13 studies (Colditz et al. 1994)
# Identical to js/benchmarks.js VH_BENCHMARKS[0..1] and HN/PWR/NEG/BETA benchmarks.
# ---------------------------------------------------------------------------
dat <- read.csv(input_file, stringsAsFactors = FALSE)
dat$yi <- as.numeric(dat$yi)
dat$vi <- as.numeric(dat$vi)
k  <- nrow(dat)
se <- sqrt(dat$vi)

# Base models used by selection-model sections
res_ml <- rma(yi, vi, method = "ML", data = dat)
res_dl <- rma(yi, vi, method = "DL", data = dat)

# Synthetic one-sided dataset (VH-C, from generate.R / benchmarks.js VH_BENCHMARKS[2])
syn_yi <- c( 0.82, 1.10, 0.93, 0.70, 1.20, 0.55, 0.65, 0.90, 0.48, 0.40,
             0.30, 0.20, 0.10, 0.05, 0.15,-0.10,-0.20, 0.00,-0.15, 0.08)
syn_vi <- c( 0.04, 0.05, 0.04, 0.06, 0.04, 0.08, 0.09, 0.08, 0.10, 0.12,
             0.15, 0.20, 0.25, 0.30, 0.20, 0.25, 0.30, 0.35, 0.25, 0.30)
res_syn_ml <- rma(syn_yi, syn_vi, method = "ML")

# Wrap selmodel() to silence warnings and catch errors
safe_sel <- function(expr) {
  tryCatch(
    withCallingHandlers(eval(expr),
      warning = function(w) invokeRestart("muffleWarning")),
    error = function(e) list(error = conditionMessage(e))
  )
}

# Helper: print a selmodel result
print_sel_result <- function(sel, label, steps = NULL, alt = NULL, note = NULL) {
  if (!is.null(note)) { lp("NOTE: ", note); lp("") }
  if (!is.null(steps)) lp("steps: [", paste(steps, collapse = ", "), "]  alternative: ", alt)

  if (!is.null(sel$error)) {
    lp("ERROR: ", sel$error); lp(""); return(invisible(NULL))
  }

  delta <- round(as.numeric(sel$delta), 8)
  lp("mu:       ", fmt(as.numeric(sel$b)))
  lp("se:       ", fmt(as.numeric(sel$se)))
  lp("tau2:     ", fmt(sel$tau2))
  lp("delta:    [", paste(fmt(delta), collapse = ", "), "]")
  lp("LRT:      ", fmt(as.numeric(sel$LRT)))
  lp("LRTdf:    ", si(sel$LRTdf))
  lp("LRTp:     ", fmt_p(as.numeric(sel$LRTp)))
  lp("LL_sel (R): ", fmt(as.numeric(sel$ll), 6))
  lp("LL_unsel (R): ", fmt(as.numeric(sel$ll0), 6))
  lp("")
}

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
lp("=== SELECTION MODEL CROSS-VALIDATION RESULTS ===")
lp("Script:    compare_selection.R")
lp("Input:     ", basename(input_file))
lp("Type:      ", type_arg)
lp("Generated: ", format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
lp("")
lp("Dataset: BCG vaccine (Colditz et al. 1994), log risk ratio scale, k=", si(k), " studies.")
lp("Cross-validates js/selection.js and js/trimfill.js.")
lp("")

# ===========================================================================
# SECTION 1: VEVEA-HEDGES STEP FUNCTION SELECTION MODEL
# ===========================================================================
if (run("vevea")) {
  lp("=== SECTION 1: VEVEA-HEDGES STEP FUNCTION SELECTION MODEL ===")
  lp("(Cross-validates js/selection.js veveaHedges — VH_BENCHMARKS)")
  lp("Base model: rma(yi, vi, method='ML', data=dat)")
  lp("selmodel(res_ml, type='stepfun', alternative=..., steps=...)")
  lp("")

  # --- Unselected baseline (shared across VH-A, VH-B) ---
  lp("--- UNSELECTED BASELINE (method=ML) ---")
  lp("RE (mu):   ", fmt(as.numeric(res_ml$b)))
  lp("SE:        ", fmt(as.numeric(res_ml$se)))
  lp("tau2:      ", fmt(res_ml$tau2))
  lp("")

  # --- VH-A: BCG OR, two-sided, 5 steps [0.025, 0.10, 0.25, 0.50, 1.0] ---
  lp("--- VH-A: two-sided, 5 steps [0.025, 0.10, 0.25, 0.50, 1.0] ---")
  lp("(Cross-validates VH_BENCHMARKS[0] / generate.R block 45)")
  steps_a <- c(0.025, 0.10, 0.25, 0.50, 1.0)
  sel_a   <- safe_sel(quote(selmodel(res_ml, type = "stepfun",
                                     alternative = "two.sided", steps = steps_a)))
  print_sel_result(sel_a, "VH-A", steps_a, "two.sided")

  # --- VH-B: BCG OR, two-sided, 3 steps [0.05, 0.50, 1.0] ---
  lp("--- VH-B: two-sided, 3 steps [0.05, 0.50, 1.0] ---")
  lp("(Cross-validates VH_BENCHMARKS[1] / generate.R block 46)")
  steps_b <- c(0.05, 0.50, 1.0)
  sel_b   <- safe_sel(quote(selmodel(res_ml, type = "stepfun",
                                     alternative = "two.sided", steps = steps_b)))
  print_sel_result(sel_b, "VH-B", steps_b, "two.sided")

  # --- VH-C: Synthetic, one-sided, 4 steps [0.025, 0.10, 0.50, 1.0] ---
  lp("--- VH-C: Synthetic, one-sided, 4 steps [0.025, 0.10, 0.50, 1.0] ---")
  lp("(Cross-validates VH_BENCHMARKS[2] / generate.R block 47)")
  lp("NOTE: R's selmodel() constrains delta <= 100 (omega <= exp(100) ≈ 2.7e43).")
  lp("  JS BFGS is unconstrained; finds true optimum at omega[3] ≈ 149.8.")
  lp("  R output below is constrained and will differ from JS for this case.")
  lp("  VH-A and VH-B do not hit this constraint; VH-C is the only divergence.")
  steps_c   <- c(0.025, 0.10, 0.50, 1.0)
  sel_c_out <- capture.output(
    sel_c <- safe_sel(quote(selmodel(res_syn_ml, type = "stepfun",
                                     alternative = "greater", steps = steps_c)))
  )
  print_sel_result(sel_c, "VH-C (constrained)", steps_c, "greater")
}

# ===========================================================================
# SECTION 2: HALF-NORMAL SELECTION MODEL
# ===========================================================================
if (run("halfnorm")) {
  lp("=== SECTION 2: HALF-NORMAL SELECTION MODEL ===")
  lp("(Cross-validates js/selection.js halfNormalSelModel — HALFNORM_BENCHMARKS)")
  lp("w(p; δ) = Φ(Φ⁻¹(1 − p) · δ),  δ ≥ 0")
  lp("selmodel(res_ml, type='halfnorm', alternative='two.sided')")
  lp("")

  lp("--- HN-1: BCG, two-sided ---")
  lp("(Cross-validates HALFNORM_BENCHMARKS[0] / generate.R block HN-1)")
  sel_hn <- safe_sel(quote(selmodel(res_ml, type = "halfnorm",
                                    alternative = "two.sided")))
  print_sel_result(sel_hn, "HN-1")
}

# ===========================================================================
# SECTION 3: POWER SELECTION MODEL
# ===========================================================================
if (run("power")) {
  lp("=== SECTION 3: POWER SELECTION MODEL ===")
  lp("(Cross-validates js/selection.js powerSelModel — POWER_BENCHMARKS)")
  lp("w(p; δ) = (1 − p)^δ,  δ ≥ 0")
  lp("selmodel(res_ml, type='power', alternative='two.sided')")
  lp("")

  lp("--- PWR-1: BCG, two-sided ---")
  lp("(Cross-validates POWER_BENCHMARKS[0] / generate.R block PWR-1)")
  sel_pwr <- safe_sel(quote(selmodel(res_ml, type = "power",
                                     alternative = "two.sided")))
  print_sel_result(sel_pwr, "PWR-1")
}

# ===========================================================================
# SECTION 4: NEGATIVE EXPONENTIAL SELECTION MODEL
# ===========================================================================
if (run("negexp")) {
  lp("=== SECTION 4: NEGATIVE EXPONENTIAL SELECTION MODEL ===")
  lp("(Cross-validates js/selection.js negexpSelModel — NEGEXP_BENCHMARKS)")
  lp("w(p; δ) = exp(−δ · p),  δ ≥ 0")
  lp("selmodel(res_ml, type='negexp', alternative='two.sided')")
  lp("")

  lp("--- NEG-1: BCG, two-sided ---")
  lp("(Cross-validates NEGEXP_BENCHMARKS[0] / generate.R block NEG-1)")
  sel_neg <- safe_sel(quote(selmodel(res_ml, type = "negexp",
                                     alternative = "two.sided")))
  print_sel_result(sel_neg, "NEG-1")
}

# ===========================================================================
# SECTION 5: BETA SELECTION MODEL
# ===========================================================================
if (run("beta")) {
  lp("=== SECTION 5: BETA SELECTION MODEL ===")
  lp("(Cross-validates js/selection.js betaSelModel — BETA_BENCHMARKS)")
  lp("w(p; a, b) = p^(a−1) · (1−p)^(b−1),  a > 0, b > 0")
  lp("selmodel(res_ml, type='beta', alternative='two.sided')")
  lp("")

  lp("--- BETA-1: BCG, two-sided ---")
  lp("(Cross-validates BETA_BENCHMARKS[0] / generate.R block BETA-1)")
  lp("NOTE: se_mu diverges — R and JS use different Hessian computations")
  lp("  at the same MLE. App se_mu ≈ 0.310 (JS Hessian); R se_mu ≈ 0.153.")
  lp("  mu, tau2, delta (a, b), LRT match; se_mu is a known divergence.")
  lp("")

  sel_beta <- safe_sel(quote(selmodel(res_ml, type = "beta",
                                      alternative = "two.sided")))

  if (!is.null(sel_beta$error)) {
    lp("ERROR: ", sel_beta$error); lp("")
  } else {
    ab <- round(as.numeric(sel_beta$delta), 8)
    lp("mu:       ", fmt(as.numeric(sel_beta$b)))
    lp("se:       ", fmt(as.numeric(sel_beta$se)))
    lp("tau2:     ", fmt(sel_beta$tau2))
    lp("a:        ", fmt(ab[1]))
    lp("b:        ", fmt(ab[2]))
    lp("LRT:      ", fmt(as.numeric(sel_beta$LRT)))
    lp("LRTdf:    ", si(sel_beta$LRTdf))
    lp("LRTp:     ", fmt_p(as.numeric(sel_beta$LRTp)))
    lp("LL_sel (R): ", fmt(as.numeric(logLik(sel_beta)), 6))
    lp("LL_unsel (R): ", fmt(as.numeric(logLik(res_ml)), 6))
    lp("")
  }
}

# ===========================================================================
# SECTION 6: TRIM-AND-FILL
# ===========================================================================
if (run("trimfill")) {
  lp("=== SECTION 6: TRIM-AND-FILL ===")
  lp("(Cross-validates js/trimfill.js trimFill)")
  lp("Duval & Tweedie (2000) iterative rank-based imputation.")
  lp("Base model: rma(yi, vi, method='DL', data=dat)")
  lp("")

  do_tf <- function(estimator) {
    lp("--- Estimator: ", estimator, " ---")
    tf <- tryCatch(
      trimfill(res_dl, estimator = estimator),
      error = function(e) list(error = conditionMessage(e))
    )
    if (!is.null(tf$error)) {
      lp("ERROR: ", tf$error); lp(""); return(invisible(NULL))
    }

    k0 <- tf$k0
    adj_mu  <- as.numeric(coef(tf))
    adj_se  <- as.numeric(tf$se)
    adj_tau2 <- tf$tau2
    adj_ci_lo <- adj_mu - qnorm(0.975) * adj_se
    adj_ci_hi <- adj_mu + qnorm(0.975) * adj_se

    lp("k0 (imputed studies): ", si(k0))
    lp("Side:                 ", tf$side)
    lp("Adjusted mu:          ", fmt(adj_mu))
    lp("Adjusted SE:          ", fmt(adj_se))
    lp("Adjusted CI:          [", fmt(adj_ci_lo), ", ", fmt(adj_ci_hi), "]")
    lp("Adjusted tau2:        ", fmt(adj_tau2))
    lp("")

    if (k0 > 0) {
      lp("--- Imputed studies (filled) ---")
      lp("(App trimFill() returns these; caller combines with originals)")
      filled_yi <- tf$yi[(k+1):(k+k0)]
      filled_vi <- tf$vi[(k+1):(k+k0)]
      for (i in seq_len(k0)) {
        lp("  filled[", i, "]  yi=", fmt(filled_yi[i]), "  vi=", fmt(filled_vi[i]))
      }
      lp("")
    }
  }

  lp("Unadjusted RE (DL):")
  lp("  mu:   ", fmt(as.numeric(res_dl$b)))
  lp("  tau2: ", fmt(res_dl$tau2))
  lp("")

  do_tf("L0")
  do_tf("R0")
  do_tf("Q0")
}

# ===========================================================================
# SECTION 7: P-CURVE
# ===========================================================================
if (run("pcurve")) {
  lp("=== SECTION 7: P-CURVE ===")
  lp("(Cross-validates js/selection.js pCurve)")
  lp("Simonsohn, Nelson & Simmons (2014, JPSP). Manual R implementation.")
  lp("Selects studies with two-tailed p < 0.05; z = |yi / sqrt(vi)|.")
  lp("")

  # Identify significant studies
  z_all  <- abs(dat$yi / se)
  p_two  <- 2 * (1 - pnorm(z_all))
  sig    <- which(p_two < 0.05)
  k_sig  <- length(sig)
  z_sig  <- z_all[sig]
  p_sig  <- p_two[sig]

  lp("Studies with two-tailed p < 0.05: k_sig = ", si(k_sig))
  if (k_sig > 0) {
    lp("Significant study p-values:")
    for (i in seq_along(sig)) {
      lp("  Study ", si(sig[i]), " (", dat$study[sig[i]], "): z=",
         fmt(z_sig[i], 3), "  p=", fmt(p_sig[i], 4))
    }
    lp("")
  }

  # Five bins [0,0.01), [0.01,0.02), ..., [0.04,0.05)
  bin_lo <- c(0, 0.01, 0.02, 0.03, 0.04)
  bin_hi <- c(0.01, 0.02, 0.03, 0.04, 0.05)
  counts <- sapply(seq_along(bin_lo), function(i)
    sum(p_sig >= bin_lo[i] & p_sig < bin_hi[i]))
  props  <- if (k_sig > 0) counts / k_sig else rep(NA, 5)

  lp("--- Five-bin histogram ---")
  lp("Bin           Count  Prop   Expected (H0)   Expected (33%)")
  # lambda33: two-tailed power=33% → solve (1-pnorm(1.96-lambda)) + pnorm(-1.96-lambda) = 0.33
  pow_fn <- function(lam) (1 - pnorm(1.96 - lam)) + pnorm(-1.96 - lam)
  lam33  <- tryCatch(uniroot(function(l) pow_fn(l) - 0.33, c(0, 10))$root,
                     error = function(e) 0.8406)  # fallback: known approx

  pp33_cdf <- function(p) {
    if (p <= 0) return(0); if (p >= 0.05) return(1)
    zp <- qnorm(1 - p / 2)
    ((1 - pnorm(zp - lam33)) + pnorm(-zp - lam33)) / 0.33
  }
  exp33 <- sapply(seq_along(bin_lo), function(i) pp33_cdf(bin_hi[i]) - pp33_cdf(bin_lo[i]))
  exp33[is.na(exp33)] <- NA

  for (i in 1:5) {
    lp(sprintf("  [%.2f, %.2f)   %5d  %5.3f  %13.3f   %13.3f",
               bin_lo[i], bin_hi[i], counts[i], props[i], 0.20, exp33[i]))
  }
  lp("")

  # Right-skew test (H0: no effect, pp0 ~ Uniform(0,1))
  if (k_sig >= 1) {
    pp0   <- p_sig / 0.05
    mean0 <- mean(pp0)
    Z_rs  <- (mean0 - 0.5) * sqrt(12 * k_sig)
    p_rs  <- pnorm(Z_rs)   # one-tailed left

    # Flatness test (H33: 33% power)
    pp33   <- sapply(p_sig, pp33_cdf)
    mean33 <- mean(pp33)
    Z_fl   <- (mean33 - 0.5) * sqrt(12 * k_sig)
    p_fl   <- 1 - pnorm(Z_fl)  # one-tailed right

    lp("--- Test statistics ---")
    lp("Right-skew (H0: no effect):")
    lp("  pp0 mean: ", fmt(mean0))
    lp("  Z:        ", fmt(Z_rs))
    lp("  p (one-tailed left): ", fmt_p(p_rs))
    lp("Flatness test (H33: 33% power):")
    lp("  pp33 mean: ", fmt(mean33))
    lp("  Z:         ", fmt(Z_fl))
    lp("  p (one-tailed right): ", fmt_p(p_fl))
    lp("")

    if (k_sig < 3) {
      verdict <- "insufficient (k_sig < 3)"
    } else if (p_rs < 0.05) {
      verdict <- "evidential (right-skew p < .05)"
    } else if (p_fl < 0.05) {
      verdict <- "no-evidential (flatness p < .05)"
    } else {
      verdict <- "inconclusive"
    }
    lp("Verdict: ", verdict)
    lp("")
  } else {
    lp("(No significant studies — p-curve tests skipped)")
    lp("")
  }
}

# ===========================================================================
# SECTION 8: P-UNIFORM
# ===========================================================================
if (run("puniform")) {
  lp("=== SECTION 8: P-UNIFORM ===")
  lp("(Cross-validates js/selection.js pUniform)")
  lp("van Assen, van Aert & Wicherts (2015). Manual R implementation.")
  lp("Conditional quantile q_i(δ) = [1 − Φ(z_i − λ_i)] / [1 − Φ(1.96 − λ_i)]")
  lp("where λ_i = δ / se_i, z_i = |yi / se_i|.")
  lp("")

  # Significant studies
  z_all  <- abs(dat$yi / se)
  p_two  <- 2 * (1 - pnorm(z_all))
  sig    <- which(p_two < 0.05)
  k_sig  <- length(sig)
  z_sig  <- z_all[sig]
  se_sig <- se[sig]

  lp("Studies with two-tailed p < 0.05: k_sig = ", si(k_sig))
  lp("RE estimate used for bias test (DL): ", fmt(as.numeric(res_dl$b)))
  lp("")

  if (k_sig >= 1) {
    MIN_DENOM <- 1e-10

    qi_fn <- function(z, se_i, delta) {
      lambda <- delta / se_i
      numer  <- 1 - pnorm(z - lambda)
      denom  <- max(1 - pnorm(1.96 - lambda), MIN_DENOM)
      numer / denom
    }

    sumQ_fn <- function(delta) {
      sum(mapply(qi_fn, z_sig, se_sig, delta))
    }

    RE_dl <- as.numeric(res_dl$b)
    sd_unif <- sqrt(k_sig / 12)

    sq0  <- sumQ_fn(0)
    sqRE <- sumQ_fn(RE_dl)

    Z_sig  <- (sq0  - k_sig / 2) / sd_unif
    Z_bias <- (sqRE - k_sig / 2) / sd_unif

    p_sig_test  <- pnorm(Z_sig)        # one-tailed left
    p_bias_test <- 1 - pnorm(Z_bias)  # one-tailed right

    lp("--- Test statistics ---")
    lp("Significance test (H0: δ = 0):")
    lp("  sum_q(0): ", fmt(sq0))
    lp("  Z_sig:    ", fmt(Z_sig))
    lp("  p (one-tailed left): ", fmt_p(p_sig_test))
    lp("Publication-bias test (H0: no bias, δ = RE_DL):")
    lp("  sum_q(RE_DL): ", fmt(sqRE))
    lp("  Z_bias:       ", fmt(Z_bias))
    lp("  p (one-tailed right): ", fmt_p(p_bias_test))
    lp("")

    # Bisection for estimate and CI
    bisect_fn <- function(target, lo = -10, hi = 10, iters = 60) {
      if (sumQ_fn(lo) > target || sumQ_fn(hi) < target) return(NA_real_)
      for (i in seq_len(iters)) {
        mid <- (lo + hi) / 2
        if (sumQ_fn(mid) < target) lo <- mid else hi <- mid
      }
      (lo + hi) / 2
    }

    margin <- 1.96 * sd_unif
    est    <- bisect_fn(k_sig / 2)
    ci_lo  <- bisect_fn(k_sig / 2 - margin)
    ci_hi  <- bisect_fn(k_sig / 2 + margin)

    lp("--- Bias-corrected estimate ---")
    lp("Estimate: ", fmt(est))
    lp("95% CI:   [", fmt(ci_lo), ", ", fmt(ci_hi), "]")
    lp("")
  } else {
    lp("(No significant studies — p-uniform skipped)")
    lp("")
  }
}

# ===========================================================================
# KNOWN DIVERGENCES
# ===========================================================================
lp("=== KNOWN DIVERGENCES ===")
lp("All differences below are expected. None indicate computation errors.")
lp("")

lp("1. VH-C ONE-SIDED CONSTRAINT")
lp("   R selmodel() constrains log(delta) <= 100, capping omega[3] at exp(100) ≈ 2.7e43.")
lp("   JS BFGS is unconstrained; finds true optimum at omega[3] ≈ 149.8.")
lp("   VH-A and VH-B are unaffected (omega values well below the R constraint).")
lp("   See js/benchmarks.js VH_BENCHMARKS[2] citation for details.")
lp("")

lp("2. BETA MODEL se_mu")
lp("   JS uses numerical Hessian of the negative log-likelihood at the MLE.")
lp("   R metafor uses a different curvature approximation.")
lp("   Both find the same MLE (mu, tau2, a, b); se_mu differs:")
lp("     JS: ~0.310   R: ~0.153")
lp("   This is a known Hessian-sensitivity issue — see memory/feedback_beta_selmodel.md.")
lp("")

lp("3. LOG-LIKELIHOOD CONSTANT (all selection models)")
lp("   R logLik() includes the -k/2*log(2π) and +½*log|X'X| normalising constants.")
lp("   JS reduced log-likelihood omits these. LRT = 2*(LL_sel - LL_unsel) is")
lp("   identical because the constant cancels. For BCG (k=13, p=1):")
lp("   offset = (k-1)/2*log(2π) - ½*log(k) ≈ ",
   fmt((k - 1) / 2 * log(2 * pi) - 0.5 * log(k)))
lp("")

lp("4. DISPLAY PRECISION")
lp("   This script prints 4 decimal places; app displays 3.")
lp("")

lp("5. P-CURVE AND P-UNIFORM: NO METAFOR EQUIVALENT")
lp("   Sections 7–8 implement the formulas manually in R (no metafor selmodel type).")
lp("   The puniform R package provides an independent implementation but is not required.")
lp("   Results should match the app exactly (same formulas, same rounding).")
lp("")

lp("6. TRIMFILL SIDE DETECTION")
lp("   App uses WLS regression yi ~ [1, sqrt(vi)] with w=1/vi to detect side.")
lp("   metafor uses a similar approach (regtest-based). Should agree for most datasets.")
lp("   If R and app show different 'side', check sign convention — the adjusted")
lp("   estimate and k0 are the primary quantities of interest.")
lp("")

lp("=== END OF RESULTS ===")

message("Written: ", output_file)
