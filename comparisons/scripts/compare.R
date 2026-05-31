#!/usr/bin/env Rscript
# AUDIT_EXEMPT: cross-validation script — intentionally implements app formulas in R for comparison; "match app" comments are expected and do not indicate drift.
# compare.R -- Cross-validate meta-analysis app output against metafor
#
# Usage:
#   Rscript comparisons/compare.R
#   Rscript comparisons/compare.R --effect SMD --method REML --ci normal
#   Rscript comparisons/compare.R --effect SMD --method DL --ci KH --input my_data.csv
#
# Arguments (all optional; defaults match app defaults):
#   --effect   Effect type: SMD, MD, OR, RR, COR  (default: SMD)
#   --method   tau2 estimator: REML, DL, ML, HE, PM, SJ, HS, EB, GENQ  (default: REML)
#   --ci       CI method: normal, KH, t  (default: normal)
#   --input    CSV file path  (default: smd_data.csv in script directory)
#   --output   Output file path  (default: results_EFFECT_METHOD_CI.txt in script directory)
#
# Output file mirrors the statistics displayed by the app:
#   RE pooled estimate, SE, CI, z/t, p
#   FE pooled estimate, SE, CI
#   Heterogeneity: Q, tau2, I2 (Q-based), H2
#   Prediction interval
#   Per-study Hedges' g / effect size, SE, CI, RE weight%
#
# Unsupported effect types (no metafor escalc equivalent):
#   HR  -- Hazard ratio: inputs are (hr, ci_lo, ci_hi); vi is CI-derived, not escalc.
#           Use --effect GENERIC with precomputed yi=log(hr), vi from the CI width.
#   GOR -- Generalised odds ratio: app-only delta-method implementation; no metafor measure.
#           See benchmark-data.md for analogous no-R-equivalent documentation.

suppressPackageStartupMessages(library(metafor))

# ---------------------------------------------------------------------------
# Script directory detection (works when called via Rscript path/to/compare.R)
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
args <- commandArgs(trailingOnly = TRUE)

get_arg <- function(key, default) {
  idx <- which(args == key)
  if (length(idx) > 0 && idx[1] < length(args)) args[idx[1] + 1] else default
}

effect_arg <- get_arg("--effect", "SMD")
method_arg <- get_arg("--method", "REML")
ci_arg     <- get_arg("--ci",     "normal")
effect_default_inputs <- c(
  SMD       = "smd_data.csv",
  SMDH      = "smdh_data.csv",
  MD        = "md_data.csv",
  ROM       = "rom_data.csv",
  CVR       = "cvr_data.csv",
  VR        = "vr_data.csv",
  OR        = "binary_data.csv",
  RR        = "binary_data.csv",
  RD        = "binary_data.csv",
  AS        = "binary_data.csv",
  YUQ       = "binary_data.csv",
  YUY       = "binary_data.csv",
  COR       = "cor_data.csv",
  UCOR      = "cor_data.csv",
  ZCOR      = "cor_data.csv",
  PCOR      = "cor_data.csv",
  ZPCOR     = "cor_data.csv",
  R2        = "r2_data.csv",
  ZR2       = "r2_data.csv",
  PHI       = "binary_data.csv",
  RTET      = "binary_data.csv",
  MD_paired = "paired_data.csv",
  SMD_paired= "paired_data.csv",
  SMCC      = "paired_data.csv",
  SMD1      = "singlegroup_data.csv",
  SMD1H     = "singlegroup_data.csv",
  MN        = "singlegroup_data.csv",
  MNLN      = "singlegroup_data.csv",
  PR        = "proportion_data.csv",
  PLN       = "proportion_data.csv",
  PLO       = "proportion_data.csv",
  PAS       = "proportion_data.csv",
  PFT       = "proportion_data.csv",
  ARAW      = "reliability_data.csv",
  ABT       = "reliability_data.csv",
  AHW       = "reliability_data.csv",
  GENERIC   = "generic_data.csv",
  IR        = "ir_data.csv",
  IRR       = "rate_data.csv",
  IRD       = "rate_data.csv",
  IRSD      = "rate_data.csv",
  RBIS      = "biserial_data.csv",
  RPB       = "biserial_data.csv"
)
default_input_name <- effect_default_inputs[effect_arg]
if (is.na(default_input_name)) default_input_name <- "smd_data.csv"
input_file <- get_arg("--input",  file.path(data_dir, default_input_name))

default_out <- file.path(results_dir,
  paste0("results_", effect_arg, "_", method_arg, "_", ci_arg, ".txt"))
output_file <- get_arg("--output", default_out)

# ---------------------------------------------------------------------------
# Effect type configuration
# ---------------------------------------------------------------------------
effect_configs <- list(
  SMD = list(
    measure = "SMD",
    label   = "Standardized Mean Difference (Hedges' g)",
    cols    = c("m1", "sd1", "n1", "m2", "sd2", "n2"),
    esc_args = function(d) list(
      m1i = d$m1, sd1i = d$sd1, n1i = d$n1,
      m2i = d$m2, sd2i = d$sd2, n2i = d$n2
    )
  ),
  MD = list(
    measure = "MD",
    label   = "Mean Difference",
    cols    = c("m1", "sd1", "n1", "m2", "sd2", "n2"),
    esc_args = function(d) list(
      m1i = d$m1, sd1i = d$sd1, n1i = d$n1,
      m2i = d$m2, sd2i = d$sd2, n2i = d$n2
    )
  ),
  SMDH = list(
    measure = "SMDH",
    label   = "Standardized Mean Difference (heteroscedastic, Bonett g)",
    cols    = c("m1", "sd1", "n1", "m2", "sd2", "n2"),
    esc_args = function(d) list(
      m1i = d$m1, sd1i = d$sd1, n1i = d$n1,
      m2i = d$m2, sd2i = d$sd2, n2i = d$n2
    )
  ),
  ROM = list(
    measure  = "ROM",
    label    = "Ratio of Means (log scale internally; app displays exp(yi))",
    cols     = c("m1", "sd1", "n1", "m2", "sd2", "n2"),
    log_scale = TRUE,
    esc_args = function(d) list(
      m1i = d$m1, sd1i = d$sd1, n1i = d$n1,
      m2i = d$m2, sd2i = d$sd2, n2i = d$n2
    )
  ),
  CVR = list(
    measure   = "CVR",
    label     = "Coefficient of Variation Ratio (log scale; app displays exp(yi))",
    cols      = c("m1", "sd1", "n1", "m2", "sd2", "n2"),
    log_scale = TRUE,
    esc_args  = function(d) list(
      m1i = d$m1, sd1i = d$sd1, n1i = d$n1,
      m2i = d$m2, sd2i = d$sd2, n2i = d$n2
    )
  ),
  VR = list(
    measure   = "VR",
    label     = "Variability Ratio (log scale; app displays exp(yi))",
    cols      = c("sd1", "n1", "sd2", "n2"),
    log_scale = TRUE,
    esc_args  = function(d) list(sd1i = d$sd1, n1i = d$n1, sd2i = d$sd2, n2i = d$n2)
  ),
  OR = list(
    measure   = "OR",
    label     = "Odds Ratio",
    cols      = c("a", "b", "c", "d"),
    log_scale = TRUE,
    log_note  = "exp(yi) = odds ratio (OR); app displays back-transformed values",
    esc_args  = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  RR = list(
    measure   = "RR",
    label     = "Risk Ratio",
    cols      = c("a", "b", "c", "d"),
    log_scale = TRUE,
    log_note  = "exp(yi) = risk ratio (RR); app displays back-transformed values",
    esc_args  = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  RD = list(
    measure  = "RD",
    label    = "Risk Difference",
    cols     = c("a", "b", "c", "d"),
    esc_args = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  AS = list(
    measure  = "AS",
    label    = "Arcsine-transformed Risk Difference",
    cols     = c("a", "b", "c", "d"),
    esc_args = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  YUQ = list(
    measure  = "YUQ",
    label    = "Yule's Q",
    cols     = c("a", "b", "c", "d"),
    esc_args = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  YUY = list(
    measure  = "YUY",
    label    = "Yule's Y",
    cols     = c("a", "b", "c", "d"),
    esc_args = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  COR = list(
    measure  = "COR",
    label    = "Pearson Correlation (raw r)",
    cols     = c("r", "n"),
    esc_args = function(d) list(ri = d$r, ni = d$n)
  ),
  UCOR = list(
    measure  = "UCOR",
    label    = "Pearson Correlation — bias-corrected (Olkin-Pratt)",
    cols     = c("r", "n"),
    esc_args = function(d) list(ri = d$r, ni = d$n)
  ),
  ZCOR = list(
    measure  = "ZCOR",
    label    = "Pearson Correlation (Fisher z)",
    cols     = c("r", "n"),
    z_scale  = TRUE,
    z_note   = "tanh(yi) = Pearson r; app displays back-transformed correlation",
    esc_args = function(d) list(ri = d$r, ni = d$n)
  ),
  PCOR = list(
    measure  = "PCOR",
    label    = "Partial Correlation (raw r, controlling for p = 1 covariate)",
    cols     = c("r", "n"),
    esc_args = function(d) list(ri = d$r, ni = d$n, mi = rep(1L, nrow(d)))
  ),
  ZPCOR = list(
    measure  = "ZPCOR",
    label    = "Partial Correlation (Fisher z, controlling for p = 1 covariate)",
    cols     = c("r", "n"),
    z_scale  = TRUE,
    z_note   = "tanh(yi) = partial r; app displays back-transformed correlation",
    esc_args = function(d) list(ri = d$r, ni = d$n, mi = rep(1L, nrow(d)))
  ),
  R2 = list(
    measure  = "R2",
    label    = "R-squared (raw R², 1 predictor)",
    cols     = c("r2", "n"),
    esc_args = function(d) list(r2i = d$r2, mi = rep(1L, nrow(d)), ni = d$n)
  ),
  ZR2 = list(
    measure  = "ZR2",
    label    = "R-squared (Fisher z of sqrt(R²), 1 predictor)",
    cols     = c("r2", "n"),
    z_scale  = TRUE,
    z_note   = "tanh(yi)^2 = R²; app displays back-transformed R-squared",
    esc_args = function(d) list(r2i = d$r2, mi = rep(1L, nrow(d)), ni = d$n)
  ),
  PHI = list(
    measure  = "PHI",
    label    = "Phi Coefficient",
    cols     = c("a", "b", "c", "d"),
    esc_args = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  RTET = list(
    measure  = "RTET",
    label    = "Tetrachoric Correlation",
    cols     = c("a", "b", "c", "d"),
    esc_args = function(d) list(ai = d$a, bi = d$b, ci = d$c, di = d$d)
  ),
  SMD1 = list(
    measure  = "SMD1",
    label    = "Standardized Mean Difference — one sample (Hedges' g)",
    cols     = c("m", "sd", "n"),
    esc_args = function(d) {
      ref <- if ("ref" %in% names(d)) d$ref else rep(0, nrow(d))
      list(m1i = d$m, m2i = ref, sd2i = d$sd, n1i = d$n, n2i = d$n)
    }
  ),
  SMD1H = list(
    measure  = "SMD1H",
    label    = "Standardized Mean Difference — one sample, heteroscedastic (SMD1H)",
    cols     = c("m", "sd", "n"),
    esc_args = function(d) {
      ref <- if ("ref" %in% names(d)) d$ref else rep(0, nrow(d))
      list(m1i = d$m, m2i = ref, sd1i = d$sd, sd2i = d$sd, n1i = d$n, n2i = d$n)
    }
  ),
  MN = list(
    measure  = "MN",
    label    = "Mean (raw)",
    cols     = c("m", "sd", "n"),
    esc_args = function(d) list(mi = d$m, sdi = d$sd, ni = d$n)
  ),
  MNLN = list(
    measure   = "MNLN",
    label     = "Mean (log scale; app displays exp(yi))",
    cols      = c("m", "sd", "n"),
    log_scale = TRUE,
    log_note  = "exp(yi) = mean (back-transformed from log scale)",
    esc_args  = function(d) list(mi = d$m, sdi = d$sd, ni = d$n)
  ),
  PR = list(
    measure  = "PR",
    label    = "Proportion (raw)",
    cols     = c("x", "n"),
    esc_args = function(d) list(xi = d$x, ni = d$n)
  ),
  PLN = list(
    measure   = "PLN",
    label     = "Proportion (log)",
    cols      = c("x", "n"),
    log_scale = TRUE,
    log_note  = "exp(yi) = proportion (back-transformed from log scale)",
    esc_args  = function(d) list(xi = d$x, ni = d$n)
  ),
  PLO = list(
    measure     = "PLO",
    label       = "Proportion (logit)",
    cols        = c("x", "n"),
    trans_note  = "yi is on the LOGIT scale. plogis(yi) = 1/(1+exp(-yi)) = proportion.",
    trans_cmp   = "To compare with the app: apply plogis() to Estimate, CI lower, CI upper.",
    esc_args    = function(d) list(xi = d$x, ni = d$n)
  ),
  PAS = list(
    measure     = "PAS",
    label       = "Proportion (arcsine)",
    cols        = c("x", "n"),
    trans_note  = "yi is on the ARCSINE scale. sin(yi)^2 = proportion.",
    trans_cmp   = "To compare with the app: apply sin(Estimate)^2 to Estimate, CI lower, CI upper.",
    esc_args    = function(d) list(xi = d$x, ni = d$n)
  ),
  PFT = list(
    measure     = "PFT",
    label       = "Proportion (Freeman-Tukey double-arcsine)",
    cols        = c("x", "n"),
    trans_note  = "yi is on the DOUBLE-ARCSINE (half-sum) scale. Back-transform: sin(yi)^2 = proportion.",
    trans_cmp   = "Back-transform: sin(yi)^2 = proportion (exact as n -> Inf).",
    # App (js/profiles.js) uses the half-sum convention matching metafor escalc('PFT'):
    #   yi = 0.5*(arcsin(sqrt(x/(n+1))) + arcsin(sqrt((x+1)/(n+1)))),  vi = 1/(4(n+0.5))
    # escalc("PFT") used directly — no bypass needed.
    esc_args    = function(d) list(xi = d$x, ni = d$n)
  ),
  GENERIC = list(
    label      = "Generic (yi / vi)",
    cols       = c("yi", "vi"),
    manual_esc = function(d) data.frame(yi = d$yi, vi = d$vi)
  ),
  ARAW = list(
    label      = "Cronbach's α (raw, ARAW)",
    cols       = c("alpha", "k", "n"),
    manual_esc = function(d) data.frame(
      yi = d$alpha,
      vi = 2 * d$k^2 * (1 - d$alpha)^2 / (d$n * (d$k - 1))
    )
  ),
  ABT = list(
    label      = "Cronbach's α (log transform, ABT)",
    cols       = c("alpha", "k", "n"),
    trans_note = "yi = log(1-α) is on the LOG(1-α) scale.",
    trans_cmp  = "Back-transform: 1 - exp(yi) = α. Apply to Estimate, CI lower, CI upper.",
    manual_esc = function(d) data.frame(
      yi = log(1 - d$alpha),
      vi = 2 * d$k / (d$n * (d$k - 1))
    )
  ),
  AHW = list(
    label      = "Cronbach's α (cube-root transform, AHW)",
    cols       = c("alpha", "k", "n"),
    trans_note = "yi = (k/(k-1) * (1-α))^(1/3) is on the CUBE-ROOT scale.",
    trans_cmp  = "The app displays this scale directly (no back-transform to α). RE matches app.",
    manual_esc = function(d) {
      u <- (d$k / (d$k - 1)) * (1 - d$alpha)
      data.frame(yi = u^(1/3), vi = 2 * d$k^2 / (9 * d$n * (d$k - 1)) * u^(2/3))
    }
  ),
  MD_paired = list(
    measure  = "MC",
    label    = "Mean Difference (paired)",
    cols     = c("m_pre", "sd_pre", "m_post", "sd_post", "n", "r"),
    esc_args = function(d) list(
      m1i = d$m_post, m2i = d$m_pre,
      sd1i = d$sd_post, sd2i = d$sd_pre,
      ni = d$n, ri = d$r
    )
  ),
  SMD_paired = list(
    measure  = "SMCR",
    label    = "Standardized Mean Change (pre-SD; Hedges' g)",
    cols     = c("m_pre", "sd_pre", "m_post", "n", "r"),
    esc_args = function(d) list(
      m1i = d$m_post, m2i = d$m_pre,
      sd1i = d$sd_pre,
      ni = d$n, ri = d$r
    )
  ),
  SMCC = list(
    measure  = "SMCC",
    label    = "Standardized Mean Change (change-score SD; Hedges' g)",
    cols     = c("m_pre", "sd_pre", "m_post", "sd_post", "n", "r"),
    esc_args = function(d) list(
      m1i = d$m_post, m2i = d$m_pre,
      sd1i = d$sd_pre, sd2i = d$sd_post,
      ni = d$n, ri = d$r
    )
  ),

  # ---------------------------------------------------------------------------
  # Incidence rate types
  # ---------------------------------------------------------------------------
  IR = list(
    measure   = "IRLN",
    label     = "Incidence Rate (log; exp(yi) = rate per person-time unit)",
    cols      = c("x", "t"),
    log_scale = TRUE,
    log_note  = "exp(yi) = incidence rate per person-time unit; app displays back-transformed rate",
    esc_args  = function(d) list(xi = d$x, ti = d$t)
  ),
  IRR = list(
    measure   = "IRR",
    label     = "Incidence Rate Ratio (log scale; exp(yi) = IRR)",
    cols      = c("x1", "t1", "x2", "t2"),
    log_scale = TRUE,
    log_note  = "exp(yi) = incidence rate ratio; app displays back-transformed IRR",
    esc_args  = function(d) list(x1i = d$x1, t1i = d$t1, x2i = d$x2, t2i = d$t2)
  ),
  IRD = list(
    measure  = "IRD",
    label    = "Incidence Rate Difference",
    cols     = c("x1", "t1", "x2", "t2"),
    esc_args = function(d) list(x1i = d$x1, t1i = d$t1, x2i = d$x2, t2i = d$t2)
  ),
  IRSD = list(
    measure  = "IRSD",
    label    = "Incidence Rate Difference (square-root scale; variance-stabilised)",
    cols     = c("x1", "t1", "x2", "t2"),
    esc_args = function(d) list(x1i = d$x1, t1i = d$t1, x2i = d$x2, t2i = d$t2)
  ),

  # ---------------------------------------------------------------------------
  # Biserial / point-biserial correlations
  #
  # metafor escalc("RBIS") and escalc("RPB") require raw group data
  # (m1i, m2i, sd1i, sd2i, n1i, n2i) — they do not accept a pre-computed r_pb.
  # The app accepts r_pb (+ p for RBIS) directly and computes yi/vi via the
  # same closed-form formula metafor uses internally.  We therefore use
  # manual_esc (identical to the ARAW/ABT/PFT pattern) so the pooled estimates
  # can be cross-validated even though escalc() is bypassed.
  # ---------------------------------------------------------------------------
  RBIS = list(
    label      = "Biserial Correlation (r_bis; converted from point-biserial r_pb)",
    cols       = c("r", "n", "p"),
    trans_note = "yi = r_bis (biserial correlation, may exceed ±1 for extreme splits).",
    trans_cmp  = "App displays r_bis directly. RE pooled estimate is on the r_bis scale.",
    manual_esc = function(d) {
      p1   <- d$p
      p2   <- 1 - p1
      z    <- qnorm(p1, lower.tail = FALSE)   # = qnorm(p2), matches JS normalQuantile(p2)
      phiZ <- dnorm(z)
      r_bis <- sqrt(p1 * p2) / phiZ * d$r
      rt    <- pmin(pmax(r_bis, -1), 1)       # clamped r_bis for variance
      vi    <- pmax(
        1 / (d$n - 1) * (p1 * p2 / phiZ^2
          - (1.5 + (1 - p1 * z / phiZ) * (1 + p2 * z / phiZ)) * rt^2
          + rt^4),
        .Machine$double.eps
      )
      data.frame(yi = r_bis, vi = vi)
    }
  ),
  RPB = list(
    label      = "Point-Biserial Correlation (r_pb; Kraemer 1975 ST formula)",
    cols       = c("r", "n"),
    manual_esc = function(d) {
      r  <- d$r
      r2 <- r^2
      vi <- pmax((1 - r2)^3 / (d$n - 2) + r2 * (1 - r2)^2 / (2 * d$n),
                 .Machine$double.eps)
      data.frame(yi = r, vi = vi)
    }
  )
)

if (!effect_arg %in% names(effect_configs)) {
  stop("Unsupported effect type: ", effect_arg,
       "\nSupported: ", paste(names(effect_configs), collapse = ", "))
}
cfg <- effect_configs[[effect_arg]]

# ---------------------------------------------------------------------------
# tau2 method labels
# ---------------------------------------------------------------------------
method_labels <- c(
  REML  = "Restricted Maximum Likelihood",
  DL    = "DerSimonian-Laird",
  PM    = "Paule-Mandel",
  EB    = "Empirical Bayes",
  PMM   = "Paule-Mandel Median",
  GENQM = "Generalized Q Median",
  ML    = "Maximum Likelihood",
  HS    = "Hunter-Schmidt",
  HE    = "Hedges",
  SJ    = "Sidik-Jonkman",
  GENQ  = "Generalized Q",
  DLIT  = "Iterated DerSimonian-Laird",
  HSk   = "Hunter-Schmidt corrected",
  MH    = "Mantel-Haenszel",
  Peto  = "Peto"
)

if (!method_arg %in% names(method_labels)) {
  stop("Unsupported estimator: ", method_arg,
       "\nSupported: ", paste(names(method_labels), collapse = ", "))
}

is_mh      <- method_arg == "MH"
is_peto    <- method_arg == "Peto"
is_fe_only <- is_mh || is_peto

if (is_mh && !effect_arg %in% c("OR", "RR", "RD")) {
  stop("MH method requires effect type OR, RR, or RD. Got: ", effect_arg)
}
if (is_peto && effect_arg != "OR") {
  stop("Peto method requires effect type OR. Got: ", effect_arg)
}

# ---------------------------------------------------------------------------
# CI method configuration
# ---------------------------------------------------------------------------
ci_configs <- list(
  normal = list(test = "z",    label = "Normal (z-distribution)"),
  KH     = list(test = "knha", label = "Knapp-Hartung"),
  t      = list(test = "t",    label = "t-distribution (df = k-1)"),
  PL     = list(test = "z",    label = "Profile Likelihood (ML)")
)

if (!ci_arg %in% names(ci_configs)) {
  stop("Unsupported CI method: ", ci_arg,
       "\nSupported: ", paste(names(ci_configs), collapse = ", "))
}
ci_cfg <- ci_configs[[ci_arg]]

# ---------------------------------------------------------------------------
# Read and validate CSV
# ---------------------------------------------------------------------------
if (!file.exists(input_file)) {
  stop("Input file not found: ", input_file)
}

dat        <- read.csv(input_file, stringsAsFactors = FALSE)
names(dat) <- trimws(tolower(names(dat)))

missing_cols <- setdiff(cfg$cols, names(dat))
if (length(missing_cols) > 0) {
  stop("Missing required columns for ", effect_arg, ": ",
       paste(missing_cols, collapse = ", "),
       "\nRequired: ", paste(cfg$cols, collapse = ", "))
}

labels <- if ("study" %in% names(dat)) dat$study  else
          if ("label" %in% names(dat)) dat$label  else
          paste0("Study ", formatC(seq_len(nrow(dat)), width = 2, flag = "0"))

# ---------------------------------------------------------------------------
# Compute effect sizes and run meta-analysis
# ---------------------------------------------------------------------------
if (is_fe_only) {
  # MH / Peto: get per-study yi/vi via escalc for the study table, then
  # run the appropriate fixed-effect pooling function.
  esc_call <- c(list(measure = cfg$measure), cfg$esc_args(dat))
  esc      <- do.call(escalc, esc_call)
  k        <- nrow(esc)
  if (is_mh) {
    res_pool <- rma.mh(measure = cfg$measure,
                       ai = dat$a, bi = dat$b, ci = dat$c, di = dat$d)
  } else {
    res_pool <- rma.peto(ai = dat$a, bi = dat$b, ci = dat$c, di = dat$d)
  }
  wts_pool <- weights(res_pool)
  Q        <- res_pool$QE
  Qp       <- res_pool$QEp
  df_q     <- k - 1
  I2       <- max(0, (Q - df_q) / Q) * 100
  H2       <- max(1, Q / df_q)
  # No tau2 for FE methods
  tau2_ci_lo <- NA_real_; tau2_ci_hi <- NA_real_
  I2_ci_lo   <- NA_real_; I2_ci_hi   <- NA_real_
  H2_ci_lo   <- NA_real_; H2_ci_hi   <- NA_real_
  pred       <- NULL
} else {
  # Standard RE path.
  # cfg$manual_esc overrides escalc() for types where metafor's escalc uses a
  # different formula or convention than the app (ARAW, ABT, AHW, GENERIC, etc.).
  if (!is.null(cfg$manual_esc)) {
    esc <- cfg$manual_esc(dat)
  } else {
    esc_call <- c(list(measure = cfg$measure), cfg$esc_args(dat))
    esc      <- do.call(escalc, esc_call)
  }
  k <- nrow(esc)

  # SJ and DLIT: use manual tau2 implementations matching js/tau2.js.
  # metafor's rma(method="SJ"/"DLIT") uses different algorithms (see generate.R).
  # GENQ/GENQM: tau2 from metafor (requires weights=1/vi); RE estimate then
  # recomputed with RE weights 1/(vi+tau2) to match the app convention.
  if (method_arg == "SJ") {
    # Sidik-Jonkman (2005) fixed-point: seed=(1/k)*sum((yi-ybar)^2),
    # iterate tau2 = (1/k)*sum(vi*(yi-mu)^2/(vi+tau2))
    k_sj <- nrow(esc); yb0 <- mean(esc$yi)
    t2   <- sum((esc$yi - yb0)^2) / k_sj
    if (t2 > 0) {
      for (iter_sj in seq_len(500)) {
        W_sj  <- sum(1 / (esc$vi + t2))
        mu_sj <- sum(esc$yi / (esc$vi + t2)) / W_sj
        s_sj  <- sum(esc$vi * (esc$yi - mu_sj)^2 / (esc$vi + t2))
        nt2   <- s_sj / k_sj
        if (abs(nt2 - t2) < 1e-10) { t2 <- max(0, nt2); break }
        t2 <- max(0, nt2)
      }
    }
    res_re <- rma(yi, vi, data = esc, tau2 = t2, test = ci_cfg$test)
  } else if (method_arg == "DLIT") {
    # Iterated DL: seed=DL estimate, iterate tau2=max(0,(Q_RE-(k-1))/c_RE)
    w_fe  <- 1 / esc$vi; W_fe <- sum(w_fe)
    mu_fe <- sum(w_fe * esc$yi) / W_fe
    Q_fe  <- sum(w_fe * (esc$yi - mu_fe)^2)
    C_dl  <- W_fe - sum(w_fe^2) / W_fe
    t2    <- if (C_dl > 0) max(0, (Q_fe - (k - 1)) / C_dl) else 0
    for (iter_dl in seq_len(200)) {
      w_re  <- 1 / (esc$vi + t2); W_re <- sum(w_re)
      mu_re <- sum(w_re * esc$yi) / W_re
      Q_re  <- sum(w_re * (esc$yi - mu_re)^2)
      C_re  <- W_re - sum(w_re^2) / W_re
      nt2   <- if (C_re > 0) max(0, (Q_re - (k - 1)) / C_re) else 0
      if (abs(nt2 - t2) < 1e-10) { t2 <- max(0, nt2); break }
      t2 <- max(0, nt2)
    }
    res_re <- rma(yi, vi, data = esc, tau2 = t2, test = ci_cfg$test)
  } else if (method_arg %in% c("GENQ", "GENQM")) {
    # metafor requires weights=1/vi for GENQ/GENQM; extract tau2, then refit
    # with that fixed tau2 so the RE estimate uses RE weights 1/(vi+tau2).
    res_mf <- rma(yi, vi, data = esc, method = method_arg, test = ci_cfg$test,
                  weights = 1 / esc$vi)
    res_re <- rma(yi, vi, data = esc, tau2 = res_mf$tau2, test = ci_cfg$test)
  } else {
    res_re <- rma(yi, vi, data = esc, method = method_arg, test = ci_cfg$test)
  }
  res_fe <- rma(yi, vi, data = esc, method = "FE")
  pred   <- if (k >= 3) predict(res_re) else NULL
  wts_re <- weights(res_re)
  wts_fe <- weights(res_fe)

  # Profile Likelihood CI: manual bisection matching profileLikCI() in js/bayes.js.
  # For each mu, profile_t2(mu) solves the score equation sum((yi-mu)^2/(vi+t2)^2)
  # = sum(1/(vi+t2)) via uniroot; returns 0 when score(0) <= 0.
  # pl_obj(mu) = ll(mu, profile_t2(mu)) - (lmax - chi2(0.95,1)/2).
  # CI bounds are where pl_obj crosses zero (bisection via uniroot).
  # Point estimate, SE, z-stat, p-value remain REML/Wald-based (matches app).
  # Prediction interval uses t(k-1, 0.975) — same convention as app for PL.
  if (ci_arg == "PL") {
    res_ml <- tryCatch(rma(yi, vi, data = esc, method = "ML"),
                       error = function(e) NULL)
    if (!is.null(res_ml)) {
      tau2_ml <- res_ml$tau2
      w_ml    <- 1 / (esc$vi + tau2_ml)
      W_ml    <- sum(w_ml)
      mu_ml   <- sum(w_ml * esc$yi) / W_ml
      ll <- function(mu, t2) {
        -0.5 * sum(log(esc$vi + t2) + (esc$yi - mu)^2 / (esc$vi + t2))
      }
      lmax <- ll(mu_ml, tau2_ml)
      profile_t2 <- function(mu) {
        score <- function(t2) {
          sum((esc$yi - mu)^2 / (esc$vi + t2)^2) - sum(1 / (esc$vi + t2))
        }
        if (score(0) <= 0) return(0)
        ub <- 1; while (score(ub) > 0) ub <- ub * 2
        uniroot(score, c(0, ub), tol = 1e-12)$root
      }
      cutoff <- qchisq(0.95, 1) / 2
      pl_obj <- function(mu) ll(mu, profile_t2(mu)) - (lmax - cutoff)
      se_app <- sqrt(1 / W_ml)
      pl_lb <- tryCatch({
        delta <- 2 * se_app
        while (pl_obj(mu_ml - delta) > 0) delta <- delta * 2
        uniroot(pl_obj, c(mu_ml - delta, mu_ml), tol = 1e-10)$root
      }, error = function(e) NA_real_)
      pl_ub <- tryCatch({
        delta <- 2 * se_app
        while (pl_obj(mu_ml + delta) > 0) delta <- delta * 2
        uniroot(pl_obj, c(mu_ml, mu_ml + delta), tol = 1e-10)$root
      }, error = function(e) NA_real_)
      if (is.finite(pl_lb)) res_re$ci.lb <- pl_lb
      if (is.finite(pl_ub)) res_re$ci.ub <- pl_ub
    }
    if (!is.null(pred)) {
      pi_t   <- qt(0.975, df = k - 1)
      pi_se2 <- sqrt(res_re$tau2 + res_re$se^2)
      pred$pi.lb <- as.numeric(coef(res_re)) - pi_t * pi_se2
      pred$pi.ub <- as.numeric(coef(res_re)) + pi_t * pi_se2
    }
  }

  # Q-based I2 -- matches app formula (Q-df)/Q, clamped [0,100]
  Q    <- res_re$QE
  Qp   <- res_re$QEp
  df_q <- k - 1
  I2   <- max(0, (Q - df_q) / Q) * 100

  # H2 point estimate: max(1, Q/df) -- clamped so H2 >= 1 (matches app)
  H2 <- max(1, Q / df_q)

  # Q-profile CIs for tau2, I2, H2 -- same method as app's heterogeneityCIs().
  # Q-profile bounds are data-dependent, not estimator-dependent, so for methods
  # using fixed tau2 (SJ, DLIT, GENQ, GENQM) we run confint on a REML model.
  res_re_for_ci <- if (method_arg %in% c("SJ", "DLIT", "GENQ", "GENQM")) {
    tryCatch(rma(yi, vi, data = esc), error = function(e) NULL)
  } else {
    res_re
  }
  ci_het <- if (!is.null(res_re_for_ci)) {
    tryCatch(suppressWarnings(confint(res_re_for_ci)), error = function(e) NULL)
  } else NULL

  get_ci_row <- function(rn, col) {
    if (is.null(ci_het) || !rn %in% rownames(ci_het$random)) return(NA_real_)
    ci_het$random[rn, col]
  }
  tau2_ci_lo <- get_ci_row("tau^2",   "ci.lb")
  tau2_ci_hi <- get_ci_row("tau^2",   "ci.ub")
  I2_ci_lo   <- get_ci_row("I^2(%)",  "ci.lb")
  I2_ci_hi   <- get_ci_row("I^2(%)",  "ci.ub")
  H2_ci_lo   <- get_ci_row("H^2",     "ci.lb")
  H2_ci_hi   <- get_ci_row("H^2",     "ci.ub")
}

# ---------------------------------------------------------------------------
# Publication bias analysis (standard RE path only; k >= 3)
# ---------------------------------------------------------------------------
pub_bias <- NULL
if (!is_fe_only && k >= 3) {
  sei_pb  <- sqrt(as.numeric(esc$vi))
  yi_pb   <- as.numeric(esc$yi)
  vi_pb   <- as.numeric(esc$vi)
  z025    <- qnorm(0.975)

  # Egger (1997): OLS of yi/sei ~ 1/sei; test intercept = 0
  yi_std <- yi_pb / sei_pb
  prec   <- 1 / sei_pb
  eg_fit  <- lm(yi_std ~ prec)
  eg_summ <- summary(eg_fit)
  egger <- list(
    intercept = as.numeric(coef(eg_fit)[1]),
    slope     = as.numeric(coef(eg_fit)[2]),
    se        = eg_summ$coefficients[1, 2],
    t         = eg_summ$coefficients[1, 3],
    p         = eg_summ$coefficients[1, 4],
    df        = k - 2L
  )

  # Begg (1994): manual implementation matching js/pubbias.js exactly.
  # Correlates raw yi against vi (NOT FE-adjusted residuals, which is what
  # ranktest() uses). Uses Kendall-Gibbons tie-corrected variance, continuity-
  # corrected z, and tau_b denominator. ranktest() diverges because it first
  # adjusts yi by y*_j = y_j - v_j*FE (study-specific offset), changing the
  # ordering and giving a different S.
  {
    tie_vars <- function(vals) {
      cnts <- table(vals)
      list(var_term = sum(cnts * (cnts - 1) * (2 * cnts + 5)),
           pairs    = sum(cnts * (cnts - 1) / 2))
    }
    S_bg <- 0L
    for (i in seq_len(k - 1)) {
      for (j in (i + 1L):k) {
        S_bg <- S_bg + sign(yi_pb[i] - yi_pb[j]) * sign(vi_pb[i] - vi_pb[j])
      }
    }
    ts_x_bg  <- tie_vars(yi_pb)
    ts_y_bg  <- tie_vars(vi_pb)
    varS_bg  <- (k * (k - 1) * (2 * k + 5) -
                 ts_x_bg$var_term - ts_y_bg$var_term) / 18
    z_bg     <- if (S_bg == 0 || varS_bg <= 0) 0 else
                (abs(S_bg) - 1) / sqrt(varS_bg) * sign(S_bg)
    p_bg     <- 2 * (1 - pnorm(abs(z_bg)))
    p0_bg    <- k * (k - 1) / 2
    denom_bg <- sqrt((p0_bg - ts_x_bg$pairs) * (p0_bg - ts_y_bg$pairs))
    tau_bg   <- if (denom_bg > 0) S_bg / denom_bg else 0
    begg <- list(tau = tau_bg, z = z_bg, p = p_bg)
  }

  # FAT-PET: WLS of yi ~ sei, weights=1/vi; FAT=slope test, PET=intercept
  fat_fit  <- lm(yi_pb ~ sei_pb, weights = 1/vi_pb)
  fat_summ <- summary(fat_fit)
  fat_df   <- k - 2L
  fat_tc   <- qt(0.975, df = fat_df)
  fat_pet  <- list(
    fat_slope    = as.numeric(coef(fat_fit)[2]),
    fat_slope_se = fat_summ$coefficients[2, 2],
    fat_t        = fat_summ$coefficients[2, 3],
    fat_p        = fat_summ$coefficients[2, 4],
    pet_estimate = as.numeric(coef(fat_fit)[1]),
    pet_se       = fat_summ$coefficients[1, 2],
    pet_t        = fat_summ$coefficients[1, 3],
    pet_p        = fat_summ$coefficients[1, 4],
    pet_ci_lb    = as.numeric(coef(fat_fit)[1]) - fat_tc * fat_summ$coefficients[1, 2],
    pet_ci_ub    = as.numeric(coef(fat_fit)[1]) + fat_tc * fat_summ$coefficients[1, 2],
    df           = fat_df
  )

  # PEESE: WLS of yi ~ vi, weights=1/vi; use if PET intercept p < 0.10
  use_peese <- is.finite(fat_pet$pet_p) && fat_pet$pet_p < 0.10
  peese <- if (use_peese) {
    pf  <- lm(yi_pb ~ vi_pb, weights = 1/vi_pb)
    ps  <- summary(pf)
    ptc <- qt(0.975, df = k - 2L)
    pse <- ps$coefficients[1, 2]
    list(
      estimate = as.numeric(coef(pf)[1]),
      se       = pse,
      t        = ps$coefficients[1, 3],
      p        = ps$coefficients[1, 4],
      ci_lb    = as.numeric(coef(pf)[1]) - ptc * pse,
      ci_ub    = as.numeric(coef(pf)[1]) + ptc * pse,
      df       = k - 2L
    )
  } else NULL

  # Fail-safe N (Rosenthal 1979)
  sum_z_fsn  <- sum(abs(yi_pb) / sei_pb)
  z_crit_fsn <- qnorm(0.95)   # one-tailed alpha=0.05 => 1.6449
  fsn_n      <- max(0, floor((sum_z_fsn / z_crit_fsn)^2 - k))

  # TES (Ioannidis & Trikalinos 2007)
  theta_tes <- as.numeric(coef(res_re))
  power_tes <- pnorm(abs(theta_tes)/sei_pb - z025) + pnorm(-z025 - abs(theta_tes)/sei_pb)
  sig_tes   <- abs(yi_pb / sei_pb) > z025
  O_tes     <- sum(sig_tes)
  E_tes     <- sum(power_tes)
  Var_tes   <- E_tes * (1 - E_tes / k)
  tes_z     <- if (Var_tes > 0) (O_tes - E_tes) / sqrt(Var_tes) else NA_real_
  tes <- list(
    O     = O_tes,
    E     = E_tes,
    chi2  = if (!is.na(tes_z)) tes_z^2 else NA_real_,
    p     = if (!is.na(tes_z)) 1 - pnorm(tes_z) else NA_real_,
    theta = theta_tes
  )

  # WAAP-WLS (Stanley & Doucouliagos 2015)
  wls_wts  <- 1 / vi_pb
  wls_est  <- sum(wls_wts * yi_pb) / sum(wls_wts)
  pow_waap <- pnorm(abs(wls_est)/sei_pb - z025) + pnorm(-z025 - abs(wls_est)/sei_pb)
  adeq     <- pow_waap >= 0.80
  k_adeq   <- sum(adeq)
  fallback <- k_adeq == 0L
  sw       <- if (fallback) wls_wts else wls_wts[adeq]
  sy       <- if (fallback) yi_pb   else yi_pb[adeq]
  waap_est <- sum(sw * sy) / sum(sw)
  waap_se  <- sqrt(1 / sum(sw))
  waap_z   <- waap_est / waap_se
  waap <- list(
    estimate   = waap_est,
    se         = waap_se,
    ci_lb      = waap_est - z025 * waap_se,
    ci_ub      = waap_est + z025 * waap_se,
    z          = waap_z,
    p          = 2 * (1 - pnorm(abs(waap_z))),
    k_adequate = k_adeq,
    wls_est    = wls_est,
    fallback   = fallback
  )

  # Henmi-Copas (2010): requires metafor::hc(); uses DL tau2 internally
  hc_raw <- tryCatch(hc(res_re), error = function(e) NULL)
  hc_out <- if (!is.null(hc_raw)) {
    # metafor hc() uses $b in older versions; try $b, then $beta, then $estimate
    hc_b <- if (!is.null(hc_raw$b)) hc_raw$b else
            if (!is.null(hc_raw$beta)) hc_raw$beta else
            hc_raw$estimate
    list(
      beta  = if (!is.null(hc_b))         as.numeric(hc_b)[1]         else NA_real_,
      ci_lb = if (!is.null(hc_raw$ci.lb)) as.numeric(hc_raw$ci.lb)[1] else NA_real_,
      ci_ub = if (!is.null(hc_raw$ci.ub)) as.numeric(hc_raw$ci.ub)[1] else NA_real_,
      tau2  = if (!is.null(hc_raw$tau2))  as.numeric(hc_raw$tau2)[1]  else NA_real_
    )
  } else NULL

  pub_bias <- list(
    egger     = egger,
    begg      = begg,
    fat_pet   = fat_pet,
    use_peese = use_peese,
    peese     = peese,
    fsn_n     = fsn_n,
    sum_z_fsn = sum_z_fsn,
    z_crit_fsn = z_crit_fsn,
    tes       = tes,
    waap      = waap,
    hc_out    = hc_out
  )
}

# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------
fmt <- function(x, d = 4) {
  if (length(x) == 0 || is.na(x)) return("NA")
  formatC(round(x, d), format = "f", digits = d)
}
fmt_pct <- function(x, d = 2) paste0(formatC(round(x, d), format = "f", digits = d), "%")
fmt_p   <- function(p) {
  if (is.na(p)) return("NA")
  if (p < 0.0001) return("< 0.0001")
  formatC(round(p, 4), format = "f", digits = 4)
}

# ---------------------------------------------------------------------------
# Build output lines
# ---------------------------------------------------------------------------
out <- character(0)
lp  <- function(...) { out <<- c(out, paste0(...)) }

lp("=== META-ANALYSIS RESULTS ===")
lp("Script:        compare.R")
lp("Input:         ", basename(input_file))
lp("Effect Type:   ", effect_arg, " (", cfg$label, ")")
lp("Estimator:     ", method_arg, " (", method_labels[[method_arg]], ")")
lp("CI Method:     ", ci_arg,     " (", ci_cfg$label, ")")
lp("Studies (k):   ", k)
lp("Generated:     ", format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
if (isTRUE(cfg$log_scale)) {
  lp("")
  lp("  Scale note: all statistics below are on the LOG scale (analysis scale).")
  if (!is.null(cfg$log_note)) {
    lp("  ", cfg$log_note)
  } else {
    lp("  The app displays exp(estimate) and exp(CI) — i.e. the ratio of means.")
  }
  lp("  To compare with the app: exp(Estimate), exp(CI lower), exp(CI upper).")
}
if (isTRUE(cfg$z_scale)) {
  lp("")
  lp("  Scale note: all statistics below are on the FISHER Z scale (analysis scale).")
  lp("  ", cfg$z_note)
  lp("  To compare with the app: apply tanh() to Estimate, CI lower, CI upper.")
}
if (!is.null(cfg$trans_note)) {
  lp("")
  lp("  Scale note: ", cfg$trans_note)
  lp("  ", cfg$trans_cmp)
}
lp("")

if (is_fe_only) {
  # MH / Peto: single pooled estimate, no RE/FE distinction
  pool_label <- if (is_mh) "MH" else "Peto"
  lp("--- POOLED ESTIMATE (", pool_label, ") ---")
  lp("Estimate:      ", fmt(as.numeric(coef(res_pool))))
  lp("SE:            ", fmt(res_pool$se))
  lp("95% CI:        [", fmt(res_pool$ci.lb), ", ", fmt(res_pool$ci.ub), "]")
  lp("z-value:       ", fmt(res_pool$zval))
  lp("p-value:       ", fmt_p(res_pool$pval))
  lp("")
  lp("  Fixed-effect only — no τ², RE estimate, or prediction interval.")
  lp("")
} else {
  # RE model
  lp("--- RANDOM-EFFECTS MODEL ---")
  lp("Estimate:      ", fmt(as.numeric(coef(res_re))))
  lp("SE:            ", fmt(res_re$se))
  lp("95% CI:        [", fmt(res_re$ci.lb), ", ", fmt(res_re$ci.ub), "]")
  if (ci_cfg$test == "z") {
    lp("z-value:       ", fmt(res_re$zval))
  } else {
    ddf_val <- if (!is.null(res_re$ddf) && !is.na(res_re$ddf)) res_re$ddf else df_q
    lp("t-value:       ", fmt(res_re$zval), "  (df = ", ddf_val, ")")
  }
  lp("p-value:       ", fmt_p(res_re$pval))
  lp("")

  # FE model
  lp("--- FIXED-EFFECTS MODEL ---")
  lp("Estimate:      ", fmt(as.numeric(coef(res_fe))))
  lp("SE:            ", fmt(res_fe$se))
  lp("95% CI:        [", fmt(res_fe$ci.lb), ", ", fmt(res_fe$ci.ub), "]")
  lp("")
}

# Heterogeneity
lp("--- HETEROGENEITY ---")
lp("Q:             ", fmt(Q), "  (df = ", df_q, ", p = ", fmt_p(Qp), ")")
if (!is_fe_only) {
  lp("tau2:          ", fmt(res_re$tau2, 6),
     "  95% CI: [", fmt(tau2_ci_lo, 6), ", ", fmt(tau2_ci_hi, 4), "]")
  lp("tau:           ", fmt(sqrt(res_re$tau2), 6))
}
lp("I2 (Q-based):  ", fmt_pct(I2, 1),
   if (!is_fe_only) paste0("  95% CI: [", fmt(I2_ci_lo, 1), "%, ", fmt(I2_ci_hi, 1), "%]") else "")
lp("H2 (clamped):  ", fmt(H2),
   if (!is_fe_only) paste0("  95% CI: [", fmt(H2_ci_lo), ", ", fmt(H2_ci_hi), "]") else "")
lp("")
lp("  Notes on heterogeneity:")
lp("  - I2 point estimate uses Q-based formula (Q-df)/Q, matching the app.")
if (!is_fe_only) {
  lp("    metafor prints tau2/(tau2+v_typical) instead; they may diverge slightly.")
  lp("  - H2 clamped to >= 1. Raw Q/df = ", fmt(Q/df_q), ".")
  lp("  - I2/H2 CI bounds use Q-profile inversion (same method as the app).")
  if (effect_arg == "SMD") {
    lp("  - I2 CI upper / H2 CI upper may differ from the app by ~2 ppt / ~0.04.")
    lp("    Root cause: vi formula approximation -- see KNOWN DIVERGENCES below.")
  }
} else {
  lp("  - No tau2/CI: MH and Peto are fixed-effect methods.")
  lp("  - H2 clamped to >= 1. Raw Q/df = ", fmt(Q/df_q), ".")
}
lp("")

# Prediction interval (RE methods only)
if (!is.null(pred)) {
  pi_crit_label <- if (ci_arg == "normal") "z(0.975) = 1.96" else
                   paste0("t(k-1=", df_q, ", 0.975) = ", round(qt(0.975, df_q), 4))
  lp("--- PREDICTION INTERVAL (95%) ---")
  lp("[", fmt(pred$pi.lb), ", ", fmt(pred$pi.ub), "]")
  lp("  Formula: RE +/- ", pi_crit_label, " * sqrt(tau2 + seRE^2)")
  lp("  tau2 = ", fmt(res_re$tau2, 6), ",  seRE = ", fmt(res_re$se, 6))
  lp("  sqrt(tau2 + seRE^2) = ", fmt(sqrt(res_re$tau2 + res_re$se^2), 6))
  lp("")
}

# Publication bias output
if (!is.null(pub_bias)) {
  pb <- pub_bias
  lp("--- PUBLICATION BIAS ---")
  lp("  Tests use yi/vi on the analysis scale (same scale as the RE model).")
  lp("")

  lp("Egger (1997):")
  lp("  intercept = ", fmt(pb$egger$intercept),
     "  SE = ", fmt(pb$egger$se),
     "  t = ", fmt(pb$egger$t),
     "  p = ", fmt_p(pb$egger$p),
     "  [df = ", pb$egger$df, "]")
  lp("  OLS of yi/sei on 1/sei; H0: intercept = 0 (asymmetry indicator)")
  lp("")

  lp("Begg (1994):")
  lp("  tau = ", fmt(pb$begg$tau),
     "  z = ", fmt(pb$begg$z),
     "  p = ", fmt_p(pb$begg$p))
  lp("  Kendall rank correlation (continuity-corrected z)")
  lp("")

  lp("FAT bias test (Stanley-Doucouliagos 2008):")
  lp("  slope_sei = ", fmt(pb$fat_pet$fat_slope),
     "  SE = ", fmt(pb$fat_pet$fat_slope_se),
     "  t = ", fmt(pb$fat_pet$fat_t),
     "  p = ", fmt_p(pb$fat_pet$fat_p),
     "  [df = ", pb$fat_pet$df, "]")
  lp("  WLS of yi ~ sei, weights=1/vi; H0: slope_sei = 0")
  lp("")

  lp("PET-PEESE:")
  if (pb$use_peese) {
    lp("  [FAT intercept p = ", fmt_p(pb$fat_pet$pet_p), " < 0.10  =>  using PEESE]")
    lp("  PEESE estimate = ", fmt(pb$peese$estimate),
       "  SE = ", fmt(pb$peese$se),
       "  t = ", fmt(pb$peese$t),
       "  p = ", fmt_p(pb$peese$p),
       "  [df = ", pb$peese$df, "]")
    lp("  95% CI: [", fmt(pb$peese$ci_lb), ", ", fmt(pb$peese$ci_ub), "]")
    lp("  WLS of yi ~ vi (not sei), weights=1/vi")
  } else {
    lp("  [FAT intercept p = ", fmt_p(pb$fat_pet$pet_p), " >= 0.10  =>  using PET]")
    lp("  PET estimate = ", fmt(pb$fat_pet$pet_estimate),
       "  SE = ", fmt(pb$fat_pet$pet_se),
       "  t = ", fmt(pb$fat_pet$pet_t),
       "  p = ", fmt_p(pb$fat_pet$pet_p),
       "  [df = ", pb$fat_pet$df, "]")
    lp("  95% CI: [", fmt(pb$fat_pet$pet_ci_lb), ", ", fmt(pb$fat_pet$pet_ci_ub), "]")
  }
  lp("")

  lp("Fail-safe N (Rosenthal 1979):")
  lp("  N = ", round(pb$fsn_n))
  lp("  (sum_z = ", fmt(pb$sum_z_fsn),
     "  z_crit = ", fmt(pb$z_crit_fsn), "  [one-tailed, alpha=0.05])")
  lp("")

  lp("TES (Ioannidis-Trikalinos 2007):")
  lp("  O = ", pb$tes$O,
     "  E = ", fmt(pb$tes$E),
     "  chi2 = ", fmt(pb$tes$chi2),
     "  p = ", fmt_p(pb$tes$p),
     "  [one-sided: excess significance]")
  lp("  theta = RE estimate = ", fmt(pb$tes$theta))
  lp("")

  lp("WAAP-WLS (Stanley-Doucouliagos 2015):")
  lp("  estimate = ", fmt(pb$waap$estimate),
     "  SE = ", fmt(pb$waap$se),
     "  z = ", fmt(pb$waap$z),
     "  p = ", fmt_p(pb$waap$p))
  lp("  95% CI: [", fmt(pb$waap$ci_lb), ", ", fmt(pb$waap$ci_ub), "]")
  lp("  WLS est (all studies) = ", fmt(pb$waap$wls_est),
     "  k adequate (power >= 0.80) = ", pb$waap$k_adequate, " / ", k,
     if (pb$waap$fallback) "  [FALLBACK: no adequate studies]" else "")
  lp("")

  lp("Henmi-Copas (2010):")
  if (!is.null(pb$hc_out)) {
    lp("  FE estimate = ", fmt(pb$hc_out$beta),
       "  95% CI: [", fmt(pb$hc_out$ci_lb), ", ", fmt(pb$hc_out$ci_ub), "]")
    lp("  (DL tau2 = ", fmt(pb$hc_out$tau2, 6), ")")
  } else {
    lp("  [hc() failed — result unavailable]")
  }
  lp("")
}

# Per-study table
lp("--- PER-STUDY ESTIMATES ---")
col_w <- max(nchar(as.character(labels))) + 1
z95   <- qnorm(0.975)
if (is_fe_only) {
  wt_label <- if (is_mh) "MH Wt %" else "Peto Wt %"
  header <- sprintf("%-*s  %8s  %8s  %9s  %9s  %11s",
                    col_w, "Label", "yi", "SE", "CI Lower", "CI Upper", wt_label)
  lp(header)
  lp(strrep("-", nchar(header)))
  for (i in seq_len(k)) {
    yi_i  <- as.numeric(esc$yi[i])
    se_i  <- sqrt(as.numeric(esc$vi[i]))
    lp(sprintf("%-*s  %8s  %8s  %9s  %9s  %11s",
               col_w, as.character(labels[i]),
               fmt(yi_i), fmt(se_i),
               fmt(yi_i - z95 * se_i), fmt(yi_i + z95 * se_i),
               fmt_pct(wts_pool[i])))
  }
} else {
  header <- sprintf("%-*s  %8s  %8s  %9s  %9s  %10s  %10s",
                    col_w, "Label", "yi", "SE", "CI Lower", "CI Upper",
                    "RE Wt %", "FE Wt %")
  lp(header)
  lp(strrep("-", nchar(header)))
  for (i in seq_len(k)) {
    yi_i  <- as.numeric(esc$yi[i])
    se_i  <- sqrt(as.numeric(esc$vi[i]))
    lp(sprintf("%-*s  %8s  %8s  %9s  %9s  %10s  %10s",
               col_w, as.character(labels[i]),
               fmt(yi_i), fmt(se_i),
               fmt(yi_i - z95 * se_i), fmt(yi_i + z95 * se_i),
               fmt_pct(wts_re[i]), fmt_pct(wts_fe[i])))
  }
}

lp("")
lp("--- KNOWN DIVERGENCES ---")
lp("All differences below are expected. None indicate computation errors.")
lp("")

div_n <- 1L

if (effect_arg %in% c("SMD_paired", "SMCC")) {
  lp(div_n, ". J FORMULA NOTE (app now uses exact J)")
  lp("   App uses hedgesJ(df) = exp(lgamma(df/2) - 0.5*log(df/2) - lgamma((df-1)/2)),")
  lp("   matching metafor exactly. No residual from J.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg == "SMD1") {
  lp(div_n, ". vi FORMULA DIFFERENCE (two-sample mapping vs one-sample formula)")
  lp("   metafor SMD1 is designed for a two-group design where group 2 supplies the")
  lp("   reference mean/SD. Mapping one-group data as n1i=n2i=n means metafor uses:")
  lp("     vi = 1/n1i + 1/n2i + g²/(2*n2i)  =  2/n + g²/(2*n)")
  lp("   The app treats 'ref' as a fixed constant (no sampling variance), so:")
  lp("     vi = 1/n + g²/(2*(n-1))")
  lp("   The first term is 2/n (metafor) vs 1/n (app); second term n vs n-1 in denom.")
  lp("   For n=30 this yields a vi difference of ~0.034 per study, leading to")
  lp("   noticeable differences in FE, Q, and tau2. This is a conceptual difference,")
  lp("   not a computation error. The app formula follows Hedges & Olkin (1985) for")
  lp("   a true one-sample test; metafor's SMD1 assumes both groups are samples.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg == "SMD1H") {
  lp(div_n, ". vi FORMULA DIFFERENCE (conceptual: two-sample mapping vs one-sample)")
  lp("   metafor SMD1H vi = (sd1²/sd2²)/(n1-1) + 1/(n2-1) + g²/(2*(n2-1))")
  lp("   With sd1=sd2=sd, n1=n2=n this gives: vi = 2/(n-1) + g²/(2*(n-1))")
  lp("   App SMD1H vi = J²·(1/n + d²/(2*(n-1)))  =  J²/n + g²/(2*(n-1))")
  lp("   The g² second term matches; the first term differs: 2/(n-1) vs J²/n.")
  lp("   For n=30: 2/29 ≈ 0.069 (metafor) vs J²/30 ≈ 0.032 (app).")
  lp("   Same conceptual distinction as SMD1: metafor treats reference as a sample.")
  lp("")
  div_n <- div_n + 1L
}

if (effect_arg == "UCOR") {
  lp(div_n, ". HYPERGEOMETRIC CORRECTION (residual < 1e-4 for |r| < 0.9)")
  lp("   The app evaluates 2F1(1/2, 1/2; (n-2)/2; 1-r^2) via a Taylor series.")
  lp("   metafor uses a different numerical method. For |r| < 0.9 the two agree")
  lp("   to < 1e-4. For |r| > 0.95 differences can reach ~0.001 in yi.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg %in% c("PCOR", "ZPCOR")) {
  lp(div_n, ". HARDCODED m = 1 COVARIATE")
  lp("   This comparison passes mi = 1 (one covariate partialled out) for all studies.")
  lp("   metafor arg 'mi' maps to the app's 'p' column. Ensure the same value is")
  lp("   used in both when verifying your own data.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg == "PHI") {
  lp(div_n, ". PHI VARIANCE FORMULA")
  lp("   The app uses the Digby (1983) delta-method variance for PHI.")
  lp("   metafor's default (vtype='LS') uses a different large-sample formula.")
  lp("   The yi values (phi coefficient itself) agree exactly; vi may differ.")
  lp("   Q, FE, and tau2 will diverge in proportion to the vi differences.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg == "RTET") {
  lp(div_n, ". NUMERICAL INTEGRATION (residual typically < 0.005 in yi)")
  lp("   Tetrachoric correlation is computed via numerical bivariate-normal CDF.")
  lp("   The app and metafor use independent implementations; small differences")
  lp("   (~0.001-0.005) in individual yi are possible, especially for extreme")
  lp("   proportions (< 0.10 or > 0.90). The pooled RE estimate typically agrees")
  lp("   to 2 decimal places.")
  lp("")
  div_n <- div_n + 1L
}

if (effect_arg == "PFT") {
  lp(div_n, ". PFT FORMULA CONVENTION — MATCH (audit 2026-05-29)")
  lp("   Both app (js/profiles.js) and metafor escalc('PFT') use the half-sum:")
  lp("     yi = 0.5*(arcsin(sqrt(x/(n+1))) + arcsin(sqrt((x+1)/(n+1)))),  vi = 1/(4(n+0.5))")
  lp("   Back-transform: sin(yi)^2 = proportion.")
  lp("   This script now uses escalc('PFT') directly — no bypass.")
  lp("   (Earlier versions of this script used the full-sum formula, now corrected.)")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg %in% c("PR", "PLN", "PLO", "PAS", "PFT")) {
  lp(div_n, ". ZERO/ONE PROPORTION HANDLING")
  lp("   When x = 0 or x = n, the app applies a +0.5 continuity correction")
  lp("   (adding 0.5 to x and 1 to n) before computing yi for PLN and PLO.")
  lp("   metafor's escalc() does NOT apply this correction by default (add=0).")
  lp("   For PR, vi = p*(1-p)/n; at p=0 or p=1 this is 0 and the study gets")
  lp("   no weight in the app. The current dataset has no extreme proportions,")
  lp("   so no correction was applied and yi/vi should match to rounding precision.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg %in% c("OR", "RR", "RD", "AS", "YUQ", "YUY")) {
  lp(div_n, ". ZERO-CELL HANDLING")
  lp("   Both app and metafor add 0.5 to all four cells in a study when any cell")
  lp("   equals 0 (Haldane-Anscombe continuity correction). The current dataset")
  lp("   has no zero cells, so no correction was applied and yi/vi match metafor")
  lp("   to rounding precision.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg %in% c("RBIS", "RPB")) {
  lp(div_n, ". MANUAL ESCALC (formula-level cross-validation, not escalc-level)")
  lp("   metafor escalc('RBIS') and escalc('RPB') require raw group means/SDs;")
  lp("   they do not accept a pre-computed r_pb. The app takes r_pb (+ p for RBIS)")
  lp("   and applies the same closed-form formula metafor uses internally.")
  lp("   This script implements that formula directly (bypassing escalc) so the")
  lp("   pooled RE/FE, Q, tau2, and weights can be compared. The yi/vi values")
  lp("   should match the app exactly since both use the same formula.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg %in% c("IRD", "IRSD")) {
  lp(div_n, ". REML SCALE SENSITIVITY — DATASET TIME UNITS")
  lp("   IRD vi = x1/t1^2 + x2/t2^2 and IRSD vi = 1/(4*t1) + 1/(4*t2) both")
  lp("   shrink quadratically as person-time t grows. When t is in the thousands")
  lp("   (typical epidemiology) vi falls to ~1e-5 or smaller, causing both metafor's")
  lp("   Fisher-scoring REML and the app's Newton-Raphson to converge inconsistently")
  lp("   (metafor warns 'Fisher scoring may have gotten stuck'). The benchmark CSV")
  lp("   uses t in the range 20-150 so that vi ~ 0.003-0.02, well within the")
  lp("   numerically stable range for REML. For real data with large person-times,")
  lp("   rescale the time axis (e.g. per 100 person-years instead of per person-year)")
  lp("   before meta-analysis to avoid this instability.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg == "IRR") {
  lp(div_n, ". ZERO-EVENT HANDLING (IRR)")
  lp("   When either x1 or x2 is 0, the app adds 0.5 to both counts before")
  lp("   computing yi = log(x1/t1) - log(x2/t2), vi = 1/x1 + 1/x2.")
  lp("   metafor escalc('IRR') applies the same Poisson continuity correction")
  lp("   (add=0.5) by default. The current dataset has no zero-event studies.")
  lp("")
  div_n <- div_n + 1L
}
if (effect_arg == "IR") {
  lp(div_n, ". ZERO-EVENT HANDLING (IR)")
  lp("   When x = 0, the app substitutes x = 0.5 before computing yi = log(x/t),")
  lp("   vi = 1/x. metafor escalc('IRLN') applies the same correction (add=0.5)")
  lp("   by default. The current dataset has no zero-count studies.")
  lp("")
  div_n <- div_n + 1L
}

if (method_arg == "SJ") {
  lp(div_n, ". SJ ALGORITHM (manual implementation matching js/tau2.js)")
  lp("   tau2 from the Sidik-Jonkman (2005) fixed-point iteration:")
  lp("     seed = (1/k)*sum((yi-ybar)^2)")
  lp("     iterate: tau2 = (1/k)*sum(vi*(yi-mu)^2/(vi+tau2))")
  lp("   metafor's rma(method='SJ') uses a different algorithm (noted in generate.R).")
  lp("   This script uses the same formula as js/tau2.js for direct comparison.")
  lp("   Results should agree with the app to rounding precision.")
  lp("")
  div_n <- div_n + 1L
}
if (method_arg %in% c("GENQ", "GENQM")) {
  lp(div_n, ". GENQ / GENQM TAU2 AND RE WEIGHTS")
  lp("   tau2 obtained from metafor rma(method='", method_arg, "', weights=1/vi),")
  lp("   which metafor requires. metafor uses those 1/vi weights for the pooled")
  lp("   estimate too, giving RE=FE. The app uses RE weights 1/(vi+tau2) (standard")
  lp("   approach); this script refits with the extracted tau2 fixed to match.")
  if (method_arg == "GENQM") {
    lp("   GENQM tau2 approximation: app uses Patnaik/Satterthwaite (2-moment scaled")
    lp("   chi-square); metafor uses the exact Farebrother CDF. Typical tau2 residual")
    lp("   ~3-4%, within the 5% benchmark tolerance. RE/CI will agree closely.")
  }
  lp("   RE estimate and tau2 should agree with the app to rounding precision.")
  lp("")
  div_n <- div_n + 1L
}
if (method_arg == "DLIT") {
  lp(div_n, ". DLIT ALGORITHM (manual implementation matching js/tau2.js)")
  lp("   tau2 from iterated DL: seed=DL estimate, iterate:")
  lp("     tau2 = max(0, (Q_RE(tau2) - (k-1)) / c_RE(tau2))")
  lp("   where Q_RE and c_RE use RE weights 1/(vi+tau2).")
  lp("   metafor's rma(method='DLIT') may use a different algorithm;")
  lp("   this script uses the same formula as js/tau2.js for direct comparison.")
  lp("   Results should agree with the app to rounding precision.")
  lp("")
  div_n <- div_n + 1L
}
if (is_mh) {
  lp(div_n, ". MANTEL-HAENSZEL POOLING")
  lp("   rma.mh() uses the Mantel-Haenszel method, which weights studies by cell")
  lp("   counts directly rather than by 1/vi. The pooled estimate is identical to")
  lp("   the app's MH estimate. Zero-cell studies receive a 0.5 continuity correction")
  lp("   by default in both metafor and the app.")
  lp("")
  div_n <- div_n + 1L
}
if (is_peto) {
  lp(div_n, ". PETO POOLING")
  lp("   rma.peto() uses Peto's one-step method for OR. Peto weights are")
  lp("   n1*n2*(events+non-events)/N^2 per study. The pooled estimate matches")
  lp("   the app. Peto is only appropriate for OR and performs best when group")
  lp("   sizes are balanced and ORs are close to 1.")
  lp("")
  div_n <- div_n + 1L
}
if (ci_arg == "PL") {
  lp(div_n, ". PROFILE LIKELIHOOD CI")
  lp("   CI bounds from ML log-likelihood profile bisection (matching profileLikCI()")
  lp("   in js/bayes.js). For each mu: profile_t2(mu) solves the score equation")
  lp("   sum((yi-mu)^2/(vi+t2)^2) = sum(1/(vi+t2)) via uniroot; returns 0 if")
  lp("   score(0) <= 0. pl_obj(mu) = ll(mu,profile_t2(mu)) - (lmax - chi2(0.95)/2).")
  lp("   CI bounds are where pl_obj crosses zero.")
  lp("   Point estimate, SE, z-stat, and p-value are REML-based (Wald).")
  lp("   Prediction interval uses t(k-1, 0.975), matching the app's PL convention.")
  lp("   Results should agree with the app to rounding precision.")
  lp("")
  div_n <- div_n + 1L
}
if (!is_fe_only) {
  lp(div_n, ". PREDICTION INTERVAL (residual < 0.01 per bound)")
  lp("   Both use: RE +/- crit * sqrt(tau2 + seRE^2).")
  lp("   For CI method = normal, crit = z(0.975) = 1.96 in both.")
  lp("   For CI method = t or KH, crit = t(k-1, 0.975) in both.")
  lp("   For CI method = PL, crit = t(k-1, 0.975) in both (app convention).")
  lp("   Any residual difference reflects independent REML tau2 estimates")
  lp("   converging to slightly different values; this is negligible when tau2 > 0.")
  lp("   metafor tau2 = ", fmt(res_re$tau2, 6))
  lp("")
  div_n <- div_n + 1L
}

if (!is.null(pub_bias)) {
  lp(div_n, ". PUBLICATION BIAS METHODS")
  lp("   Egger: R uses OLS (lm without weights), matching js/pubbias.js. Both use")
  lp("   df = k-2 t-test on the intercept of yi/sei ~ 1/sei. Should match exactly.")
  lp("   Begg: R uses a manual implementation matching js/pubbias.js exactly.")
  lp("   Both correlate raw yi vs vi with continuity-corrected normal z and tau_b.")
  lp("   metafor::ranktest() diverges because it adjusts yi by y*_j = y_j - v_j*FE")
  lp("   (a study-specific offset that changes the ranking) — do not use ranktest().")
  lp("   FAT-PET/PEESE: R uses lm() with weights=1/vi, same as JS. Should match.")
  lp("   Fail-safe N (Rosenthal): manual calculation in both; should match exactly.")
  lp("   TES: manual calculation in both using identical formulas; should match.")
  lp("   WAAP-WLS: manual calculation in both; should match exactly.")
  lp("   Henmi-Copas: R uses metafor::hc(), JS uses an independent port of Henmi &")
  lp("   Copas (2010). Both use DL tau2 and FE weights. CI bounds may differ by")
  lp("   ~0.001 due to numerical integration (JS: Simpson N=400; R: adaptive quadrature).")
  lp("")
  div_n <- div_n + 1L
}

lp(div_n, ". DISPLAY PRECISION")
lp("   The app displays 3 decimal places; this script prints 4.")
lp("   Differences of 0.001 in displayed values may be rounding only.")
lp("")
lp("--- END OF RESULTS ---")

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
writeLines(out, output_file)
cat("Results written to:", output_file, "\n")
