#!/usr/bin/env Rscript
# AUDIT_EXEMPT: cross-validation script — intentionally implements app formulas in R for comparison; "match app" comments are expected and do not indicate drift.
# compare_regression.R -- Cross-validate meta-regression, subgroup, location-scale,
#                         and permutation output against the app (js/regression.js,
#                         js/perm.js).
#
# Usage:
#   Rscript comparisons/compare_regression.R
#   Rscript comparisons/compare_regression.R --method REML --ci normal
#   Rscript comparisons/compare_regression.R --input my_data.csv --output out.txt
#
# Arguments (all optional; defaults match app defaults):
#   --input   CSV with columns: study,yi,vi,ablat,year,region  (default: regression_data.csv)
#   --output  Output file path  (default: results_REG_METHOD_CI.txt in script directory)
#   --method  tau2 estimator: REML, DL, ML, ...  (default: REML)
#   --ci      CI method: normal, KH, t            (default: normal)
#   --perm    Permutation iterations               (default: 1000)
#   --seed    PRNG seed for permutation            (default: 42)
#
# Sections:
#   1. Meta-regression: year + ablat  (validates MR-A in js/benchmarks.js)
#   2. Meta-regression: ablat + region, ref="AS"  (validates MR-B / MR-C)
#   3. Subgroup analysis: region  (Q_between via FE Q decomposition)
#   4. Location-scale: intercept location + ablat scale  (validates LS-B)
#   5. Location-scale: ablat location + ablat scale  (validates LS-C)
#   6. Permutation test: ablat moderator

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

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
get_arg <- function(key, default) {
  idx <- which(args == key)
  if (length(idx) > 0 && idx[1] < length(args)) args[idx[1] + 1] else default
}

method_arg <- get_arg("--method", "REML")
ci_arg     <- get_arg("--ci",     "normal")
perm_arg   <- as.integer(get_arg("--perm", "1000"))
seed_arg   <- as.integer(get_arg("--seed", "42"))
input_file <- get_arg("--input",  file.path(script_dir, "regression_data.csv"))

default_out <- file.path(script_dir,
  paste0("results_REG_", method_arg, "_", ci_arg, ".txt"))
output_file <- get_arg("--output", default_out)

ci_configs <- list(
  normal = list(test = "z",    label = "Normal (z-distribution)"),
  KH     = list(test = "knha", label = "Knapp-Hartung"),
  t      = list(test = "t",    label = "t-distribution (df = k-1)")
)
if (!ci_arg %in% names(ci_configs)) stop("Unsupported CI method: ", ci_arg)
test_arg <- ci_configs[[ci_arg]]$test

# ---------------------------------------------------------------------------
# Read data
# "NA" region code must not be interpreted as R NA — use na.strings=""
# ---------------------------------------------------------------------------
if (!file.exists(input_file)) stop("Input file not found: ", input_file)
dat        <- read.csv(input_file, stringsAsFactors = FALSE, na.strings = "")
names(dat) <- trimws(tolower(names(dat)))
k          <- nrow(dat)

# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------
fmt <- function(x, d = 4) {
  x <- as.numeric(x)
  if (length(x) == 0 || is.na(x[1])) return("NA")
  formatC(round(x[1], d), format = "f", digits = d)
}
fmt_p <- function(p) {
  p <- as.numeric(p)
  if (length(p) == 0 || is.na(p[1])) return("NA")
  p <- p[1]
  if (p < 0.0001) return("< 0.0001")
  formatC(round(p, 4), format = "f", digits = 4)
}
fmt_pct <- function(x, d = 2) {
  x <- as.numeric(x)
  if (length(x) == 0 || is.na(x[1])) return("NA%")
  paste0(formatC(round(x[1], d), format = "f", digits = d), "%")
}

# scalar extractors: metafor sometimes stores QMdf as c(num_df, denom_df)
# where denom_df = NA for z-tests. Always take [1].
s1 <- function(x) { x <- as.numeric(x); if (length(x) == 0) NA_real_ else x[1] }
si <- function(x) { x <- suppressWarnings(as.integer(x)); if (length(x) == 0) NA_integer_ else x[1] }

out <- character(0)
lp  <- function(...) { out <<- c(out, paste0(...)) }

div_n <- 0L
note_div <- function(...) { div_n <<- div_n + 1L; lp(div_n, ". ", ...) }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# LRT between two ML-fitted rma models via logLik difference.
# For location-scale models, $p = location params and $q = scale params.
# Total params = p + q; use both to compute df.
safe_lrt <- function(full, reduced) {
  tryCatch({
    ll_f  <- as.numeric(logLik(full))[1]
    ll_r  <- as.numeric(logLik(reduced))[1]
    lrt   <- 2 * (ll_f - ll_r)
    q_f   <- if (!is.null(full$q))    si(full$q)    else 0L
    q_r   <- if (!is.null(reduced$q)) si(reduced$q) else 0L
    df    <- as.integer(si(full$p) + q_f - si(reduced$p) - q_r)
    if (is.na(df) || df < 1L) df <- 1L
    list(LRT = lrt, df = df, p = as.numeric(pchisq(lrt, df = df, lower.tail = FALSE))[1])
  }, error = function(e) list(LRT = NA_real_, df = NA_integer_, p = NA_real_))
}

# Per-term Wald test.
safe_wald <- function(res, btt) {
  tryCatch({
    a <- anova(res, btt = btt)
    list(QM = s1(a$QM), df = si(a$QMdf), p = s1(a$QMp))
  }, error = function(e) list(QM = NA_real_, df = NA_integer_, p = NA_real_))
}

# Extract common model stats as scalars.
# metafor does not always store $QEdf; compute from k and p.
mstats <- function(res) {
  list(
    QM   = s1(res$QM),
    QMdf = si(res$QMdf),
    QMp  = s1(res$QMp),
    QE   = s1(res$QE),
    QEdf = {
      v <- if (!is.null(res$QEdf) && length(res$QEdf) > 0) si(res$QEdf) else NA_integer_
      if (is.na(v)) si(res$k - res$p) else v
    },
    QEp  = s1(res$QEp)
  )
}

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
lp("=== META-REGRESSION CROSS-VALIDATION RESULTS ===")
lp("Script:        compare_regression.R")
lp("Input:         ", basename(input_file))
lp("Method:        ", method_arg)
lp("CI Method:     ", ci_arg, " (", ci_configs[[ci_arg]]$label, ")")
lp("Studies (k):   ", k)
lp("Generated:     ", format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
lp("")
lp("Dataset: BCG vaccine data (Colditz et al. 1994).")
lp("yi = log risk ratio; vi = sampling variance.")
lp("Moderators: ablat (absolute latitude), year, region (AS/EU/NA).")
lp("")

# ===========================================================================
# SECTION 1: Meta-regression — year + ablat  (MR-A)
# ===========================================================================
lp("=== SECTION 1: META-REGRESSION — year + ablat ===")
lp("(Cross-validates MR-A benchmark in js/benchmarks.js)")
lp("rma(yi, vi, mods = ~ year + ablat, method = \"", method_arg,
   "\", test = \"", test_arg, "\", data = dat)")
lp("")

res_mra <- rma(yi, vi, mods = ~ year + ablat, method = method_arg,
               test = test_arg, data = dat)
st_mra  <- mstats(res_mra)

# ML models for LRT (always ML, independent of method_arg)
ml_mra_full    <- rma(yi, vi, mods = ~ year + ablat, method = "ML", data = dat)
ml_mra_noyear  <- rma(yi, vi, mods = ~ ablat,        method = "ML", data = dat)
ml_mra_noablat <- rma(yi, vi, mods = ~ year,         method = "ML", data = dat)
lrt_mra_year   <- safe_lrt(ml_mra_full, ml_mra_noyear)
lrt_mra_ablat  <- safe_lrt(ml_mra_full, ml_mra_noablat)

# Per-term Wald tests: intercept=1, year=2, ablat=3
wa_mra_year  <- safe_wald(res_mra, btt = 2L)
wa_mra_ablat <- safe_wald(res_mra, btt = 3L)

beta_mra  <- as.numeric(coef(res_mra))
se_mra    <- as.numeric(res_mra$se)
ci_lb_mra <- as.numeric(res_mra$ci.lb)
ci_ub_mra <- as.numeric(res_mra$ci.ub)
zv_mra    <- as.numeric(res_mra$zval)
pv_mra    <- as.numeric(res_mra$pval)
cn_mra    <- c("intercept", "year", "ablat")

lp("--- COEFFICIENTS ---")
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "term", "beta", "SE", "CI Lower", "CI Upper", "z/t", "p"))
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "------------", "---------", "---------",
           "---------", "---------", "---------", "---------"))
for (i in seq_along(cn_mra)) {
  lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
             cn_mra[i], fmt(beta_mra[i]), fmt(se_mra[i]),
             fmt(ci_lb_mra[i]), fmt(ci_ub_mra[i]),
             fmt(zv_mra[i]), fmt_p(pv_mra[i])))
}
lp("")

lp("--- MODEL TESTS ---")
lp("QM (omnibus):  ", fmt(st_mra$QM), "  df = ", st_mra$QMdf, "  p = ", fmt_p(st_mra$QMp))
lp("  Wald per term:")
lp("  year:   QM = ", fmt(wa_mra_year$QM),  "  df = ", wa_mra_year$df,  "  p = ", fmt_p(wa_mra_year$p))
lp("  ablat:  QM = ", fmt(wa_mra_ablat$QM), "  df = ", wa_mra_ablat$df, "  p = ", fmt_p(wa_mra_ablat$p))
lp("")
lp("--- LRT PER TERM (always ML, independent of --method) ---")
lp("  year:   LRT = ", fmt(lrt_mra_year$LRT),  "  df = ", lrt_mra_year$df,  "  p = ", fmt_p(lrt_mra_year$p))
lp("  ablat:  LRT = ", fmt(lrt_mra_ablat$LRT), "  df = ", lrt_mra_ablat$df, "  p = ", fmt_p(lrt_mra_ablat$p))
lp("")

lp("--- RESIDUAL HETEROGENEITY ---")
lp("QE:  ", fmt(st_mra$QE), "  df = ", st_mra$QEdf, "  p = ", fmt_p(st_mra$QEp))
lp("")

lp("--- VARIANCE COMPONENTS ---")
lp("tau2:  ", fmt(s1(res_mra$tau2), 6))
lp("I2:    ", fmt_pct(s1(res_mra$I2), 2), "  (tau2/(tau2+v_typical), metafor convention)")
lp("R2:    ", fmt(s1(res_mra$R2), 2), "%")
lp("")

lp("--- AIC / BIC (REML unless --method ML) ---")
lp("LL:   ", fmt(as.numeric(logLik(res_mra))[1], 6))
lp("AIC:  ", fmt(AIC(res_mra), 6))
lp("BIC:  ", fmt(BIC(res_mra), 6))
lp("")

# ===========================================================================
# SECTION 2: Meta-regression — ablat + region (MR-B / MR-C)
# ===========================================================================
lp("=== SECTION 2: META-REGRESSION — ablat + region ===")
lp("(Cross-validates MR-B [normal CI] and MR-C [KH CI] in js/benchmarks.js)")
lp("Reference level for region: \"AS\" (alphabetically first, matching app buildDesignMatrix).")
lp("rma(yi, vi, mods = ~ ablat + region_f, method = \"", method_arg,
   "\", test = \"", test_arg, "\", data = dat)")
lp("")

dat$region_f <- relevel(factor(dat$region), ref = "AS")
res_mrb <- rma(yi, vi, mods = ~ ablat + region_f, method = method_arg,
               test = test_arg, data = dat)
st_mrb  <- mstats(res_mrb)

# ML models for LRT
ml_mrb_full     <- rma(yi, vi, mods = ~ ablat + region_f, method = "ML", data = dat)
ml_mrb_noablat  <- rma(yi, vi, mods = ~ region_f,         method = "ML", data = dat)
ml_mrb_noregion <- rma(yi, vi, mods = ~ ablat,            method = "ML", data = dat)
lrt_mrb_ablat   <- safe_lrt(ml_mrb_full, ml_mrb_noablat)
lrt_mrb_region  <- safe_lrt(ml_mrb_full, ml_mrb_noregion)

# Per-term Wald tests: intercept=1, ablat=2, region:EU=3, region:NA=4
wa_mrb_ablat  <- safe_wald(res_mrb, btt = 2L)
wa_mrb_region <- safe_wald(res_mrb, btt = 3L:4L)

beta_mrb  <- as.numeric(coef(res_mrb))
se_mrb    <- as.numeric(res_mrb$se)
ci_lb_mrb <- as.numeric(res_mrb$ci.lb)
ci_ub_mrb <- as.numeric(res_mrb$ci.ub)
zv_mrb    <- as.numeric(res_mrb$zval)
pv_mrb    <- as.numeric(res_mrb$pval)
cn_mrb    <- c("intercept", "ablat", "region:EU", "region:NA")

lp("--- COEFFICIENTS ---")
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "term", "beta", "SE", "CI Lower", "CI Upper", "z/t", "p"))
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "------------", "---------", "---------",
           "---------", "---------", "---------", "---------"))
for (i in seq_along(cn_mrb)) {
  lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
             cn_mrb[i], fmt(beta_mrb[i]), fmt(se_mrb[i]),
             fmt(ci_lb_mrb[i]), fmt(ci_ub_mrb[i]),
             fmt(zv_mrb[i]), fmt_p(pv_mrb[i])))
}
lp("")

lp("--- MODEL TESTS ---")
lp("QM (omnibus):  ", fmt(st_mrb$QM), "  df = ", st_mrb$QMdf, "  p = ", fmt_p(st_mrb$QMp))
lp("  Wald per term:")
lp("  ablat:   QM = ", fmt(wa_mrb_ablat$QM),  "  df = ", wa_mrb_ablat$df,  "  p = ", fmt_p(wa_mrb_ablat$p))
lp("  region:  QM = ", fmt(wa_mrb_region$QM), "  df = ", wa_mrb_region$df, "  p = ", fmt_p(wa_mrb_region$p),
   "  (joint test: EU + NA vs. AS)")
lp("")
lp("--- LRT PER TERM (always ML) ---")
lp("  ablat:   LRT = ", fmt(lrt_mrb_ablat$LRT),  "  df = ", lrt_mrb_ablat$df,  "  p = ", fmt_p(lrt_mrb_ablat$p))
lp("  region:  LRT = ", fmt(lrt_mrb_region$LRT), "  df = ", lrt_mrb_region$df, "  p = ", fmt_p(lrt_mrb_region$p))
lp("")

lp("--- RESIDUAL HETEROGENEITY ---")
lp("QE:  ", fmt(st_mrb$QE), "  df = ", st_mrb$QEdf, "  p = ", fmt_p(st_mrb$QEp))
lp("")

lp("--- VARIANCE COMPONENTS ---")
lp("tau2:  ", fmt(s1(res_mrb$tau2), 6))
lp("I2:    ", fmt_pct(s1(res_mrb$I2), 2), "  (tau2/(tau2+v_typical))")
lp("R2:    ", fmt(s1(res_mrb$R2), 2), "%")
lp("")

lp("--- AIC / BIC ---")
lp("LL:   ", fmt(as.numeric(logLik(res_mrb))[1], 6))
lp("AIC:  ", fmt(AIC(res_mrb), 6))
lp("BIC:  ", fmt(BIC(res_mrb), 6))
lp("")

# ===========================================================================
# SECTION 3: Subgroup analysis — region
# ===========================================================================
lp("=== SECTION 3: SUBGROUP ANALYSIS — region ===")
lp("Q_between = Q_total(FE full) - sum(Q_within per group FE).")
lp("Per-group estimates use method = \"", method_arg, "\", test = \"", test_arg, "\".")
lp("")

groups     <- sort(unique(dat$region))
Q_tot_fe   <- s1(rma(yi, vi, method = "FE", data = dat)$QE)
Q_within_fe <- sum(sapply(groups, function(g) {
  d <- dat[dat$region == g, ]
  if (nrow(d) >= 2) s1(rma(d$yi, d$vi, method = "FE")$QE) else 0
}))
Q_between  <- Q_tot_fe - Q_within_fe
df_between <- length(groups) - 1L
p_between  <- pchisq(Q_between, df = df_between, lower.tail = FALSE)

lp("--- Q DECOMPOSITION ---")
lp("Q_total (FE, k = ", k, "):  ", fmt(Q_tot_fe), "  df = ", k - 1L)
lp("Q_within (sum per group):   ", fmt(Q_within_fe))
lp("Q_between:                  ", fmt(Q_between), "  df = ", df_between,
   "  p = ", fmt_p(p_between))
lp("")

lp("--- PER-GROUP ESTIMATES ---")
lp(sprintf("  %-4s  %3s  %9s  %9s  %9s  %9s  %9s  %9s",
           "Grp", "k", "Estimate", "SE", "CI Lower", "CI Upper", "tau2", "I2"))
lp(sprintf("  %-4s  %3s  %9s  %9s  %9s  %9s  %9s  %9s",
           "----", "---", "---------", "---------",
           "---------", "---------", "---------", "---------"))
for (g in groups) {
  d  <- dat[dat$region == g, ]
  kg <- nrow(d)
  if (kg >= 2) {
    rg <- tryCatch(rma(d$yi, d$vi, method = method_arg, test = test_arg),
                   error = function(e) NULL)
    if (!is.null(rg)) {
      qe_g <- s1(rg$QE)
      i2g  <- if (!is.na(qe_g) && kg >= 2) max(0, (qe_g - (kg-1)) / qe_g) * 100 else 0
      lp(sprintf("  %-4s  %3d  %9s  %9s  %9s  %9s  %9s  %9s",
                 g, kg,
                 fmt(as.numeric(coef(rg))[1]), fmt(s1(rg$se)),
                 fmt(s1(rg$ci.lb)), fmt(s1(rg$ci.ub)),
                 fmt(s1(rg$tau2), 6), fmt_pct(i2g, 1)))
    }
  } else {
    lp(sprintf("  %-4s  %3d  (k < 2, skipped)", g, kg))
  }
}
lp("")

# ===========================================================================
# SECTION 4: Location-scale — intercept location + ablat scale  (LS-B)
# ===========================================================================
lp("=== SECTION 4: LOCATION-SCALE — intercept location + ablat scale ===")
lp("(Cross-validates LS-B benchmark in js/benchmarks.js)")
lp("Always uses method = \"ML\" — same as app's lsModel.")
lp("rma(yi, vi, scale = ~ ablat, method = \"ML\", data = dat)")
lp("")

res_ls_b <- rma(yi, vi, scale = ~ ablat, method = "ML", data = dat)

# SE from vcov diagonal; $b = location betas, $alpha = scale gammas
se_beta_b  <- sqrt(diag(as.matrix(res_ls_b$vb)))
se_gamma_b <- sqrt(diag(as.matrix(res_ls_b$va)))
beta_b     <- as.numeric(res_ls_b$b)
gamma_b    <- as.numeric(res_ls_b$alpha)
z95 <- qnorm(0.975)

ci_lb_beta_b  <- beta_b  - z95 * se_beta_b
ci_ub_beta_b  <- beta_b  + z95 * se_beta_b
ci_lb_gamma_b <- gamma_b - z95 * se_gamma_b
ci_ub_gamma_b <- gamma_b + z95 * se_gamma_b
zval_beta_b   <- beta_b  / se_beta_b
zval_gamma_b  <- gamma_b / se_gamma_b
pval_beta_b   <- 2 * pnorm(-abs(zval_beta_b))
pval_gamma_b  <- 2 * pnorm(-abs(zval_gamma_b))

lp("--- LOCATION COEFFICIENTS (beta) ---")
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "term", "beta", "SE", "CI Lower", "CI Upper", "z", "p"))
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "intercept",
           fmt(beta_b[1]), fmt(se_beta_b[1]),
           fmt(ci_lb_beta_b[1]), fmt(ci_ub_beta_b[1]),
           fmt(zval_beta_b[1]), fmt_p(pval_beta_b[1])))
lp("")

lp("--- SCALE COEFFICIENTS (gamma) ---")
scale_cn_b <- c("intercept", "ablat")
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "term", "gamma", "SE", "CI Lower", "CI Upper", "z", "p"))
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "------------", "---------", "---------",
           "---------", "---------", "---------", "---------"))
for (i in seq_along(scale_cn_b)) {
  lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
             scale_cn_b[i],
             fmt(gamma_b[i]), fmt(se_gamma_b[i]),
             fmt(ci_lb_gamma_b[i]), fmt(ci_ub_gamma_b[i]),
             fmt(zval_gamma_b[i]), fmt_p(pval_gamma_b[i])))
}
lp("")

lp("--- PER-STUDY tau2_i = exp(gamma0 + gamma1*ablat) ---")
tau2_i_b <- as.numeric(res_ls_b$tau2)
lp(sprintf("  %-30s  %6s  %9s", "Study", "ablat", "tau2_i"))
lp(sprintf("  %-30s  %6s  %9s", "------------------------------", "------", "---------"))
for (i in seq_len(k)) {
  lp(sprintf("  %-30s  %6d  %9s", dat$study[i], dat$ablat[i], fmt(tau2_i_b[i], 7)))
}
lp("")

lp("--- SCALE WALD TEST (QM_scale / QS) ---")
lp("QM_scale:  ", fmt(s1(res_ls_b$QS)), "  df = ", si(res_ls_b$QSdf),
   "  p = ", fmt_p(s1(res_ls_b$QSp)))
lp("")

# LRT: LS-B vs LS-A (intercept-only scale)
res_ls_a <- rma(yi, vi, scale = ~ 1, method = "ML", data = dat)
lrt_ls_b <- safe_lrt(res_ls_b, res_ls_a)
lp("--- LR TEST: ablat scale vs. intercept-only scale ---")
lp("(rma(scale=~ablat) vs. rma(scale=~1), both ML)")
lp("LRT:  ", fmt(lrt_ls_b$LRT), "  df = ", lrt_ls_b$df, "  p = ", fmt_p(lrt_ls_b$p))
lp("")

ll_b    <- as.numeric(logLik(res_ls_b))[1]
k_const <- k / 2 * log(2 * pi)
lp("--- LOG-LIKELIHOOD ---")
lp("LL (R convention):   ", fmt(ll_b, 7))
lp("  JS LL = R_LL + k/2*log(2*pi) = R_LL + ", fmt(k_const, 4))
lp("  JS LL ≈ ", fmt(ll_b + k_const, 7))
lp("")

# ===========================================================================
# SECTION 5: Location-scale — ablat location + ablat scale  (LS-C)
# ===========================================================================
lp("=== SECTION 5: LOCATION-SCALE — ablat location + ablat scale ===")
lp("(Cross-validates LS-C benchmark in js/benchmarks.js)")
lp("rma(yi, vi, mods = ~ ablat, scale = ~ ablat, method = \"ML\", data = dat)")
lp("")

res_ls_c <- rma(yi, vi, mods = ~ ablat, scale = ~ ablat, method = "ML", data = dat)
st_ls_c  <- mstats(res_ls_c)

se_beta_c  <- sqrt(diag(as.matrix(res_ls_c$vb)))
se_gamma_c <- sqrt(diag(as.matrix(res_ls_c$va)))
beta_c     <- as.numeric(res_ls_c$b)
gamma_c    <- as.numeric(res_ls_c$alpha)

ci_lb_beta_c  <- beta_c  - z95 * se_beta_c
ci_ub_beta_c  <- beta_c  + z95 * se_beta_c
ci_lb_gamma_c <- gamma_c - z95 * se_gamma_c
ci_ub_gamma_c <- gamma_c + z95 * se_gamma_c
zval_beta_c   <- beta_c  / se_beta_c
zval_gamma_c  <- gamma_c / se_gamma_c
pval_beta_c   <- 2 * pnorm(-abs(zval_beta_c))
pval_gamma_c  <- 2 * pnorm(-abs(zval_gamma_c))

loc_cn_c   <- c("intercept", "ablat")
scale_cn_c <- c("intercept", "ablat")

lp("--- LOCATION COEFFICIENTS (beta) ---")
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "term", "beta", "SE", "CI Lower", "CI Upper", "z", "p"))
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "------------", "---------", "---------",
           "---------", "---------", "---------", "---------"))
for (i in seq_along(loc_cn_c)) {
  lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
             loc_cn_c[i], fmt(beta_c[i]), fmt(se_beta_c[i]),
             fmt(ci_lb_beta_c[i]), fmt(ci_ub_beta_c[i]),
             fmt(zval_beta_c[i]), fmt_p(pval_beta_c[i])))
}
lp("")

lp("--- SCALE COEFFICIENTS (gamma) ---")
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "term", "gamma", "SE", "CI Lower", "CI Upper", "z", "p"))
lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
           "------------", "---------", "---------",
           "---------", "---------", "---------", "---------"))
for (i in seq_along(scale_cn_c)) {
  lp(sprintf("  %-12s  %9s  %9s  %9s  %9s  %9s  %9s",
             scale_cn_c[i], fmt(gamma_c[i]), fmt(se_gamma_c[i]),
             fmt(ci_lb_gamma_c[i]), fmt(ci_ub_gamma_c[i]),
             fmt(zval_gamma_c[i]), fmt_p(pval_gamma_c[i])))
}
lp("")

lp("--- PER-STUDY tau2_i = exp(gamma0 + gamma1*ablat) ---")
tau2_i_c <- as.numeric(res_ls_c$tau2)
lp(sprintf("  %-30s  %6s  %9s", "Study", "ablat", "tau2_i"))
lp(sprintf("  %-30s  %6s  %9s", "------------------------------", "------", "---------"))
for (i in seq_len(k)) {
  lp(sprintf("  %-30s  %6d  %9s", dat$study[i], dat$ablat[i], fmt(tau2_i_c[i], 7)))
}
lp("")

lp("--- QM_loc (Wald test for location moderators) ---")
lp("QM_loc:    ", fmt(st_ls_c$QM), "  df = ", st_ls_c$QMdf, "  p = ", fmt_p(st_ls_c$QMp))
lp("")

lp("--- QE (residual heterogeneity) ---")
lp("QE:        ", fmt(st_ls_c$QE), "  df = ", st_ls_c$QEdf, "  p = ", fmt_p(st_ls_c$QEp))
lp("")

lp("--- SCALE WALD TEST (QM_scale / QS) ---")
lp("QM_scale:  ", fmt(s1(res_ls_c$QS)), "  df = ", si(res_ls_c$QSdf),
   "  p = ", fmt_p(s1(res_ls_c$QSp)))
lp("")

# LRT: LS-C vs ablat-location + intercept-only scale  (validates app LRchi2 / "LR test scale mods")
res_ls_c_null <- rma(yi, vi, mods = ~ ablat, scale = ~ 1, method = "ML", data = dat)
lrt_ls_c_scale <- safe_lrt(res_ls_c, res_ls_c_null)
lp("--- LR TEST (scale mods): LS-C vs. ablat location + intercept-only scale ---")
lp("(rma(mods=~ablat, scale=~ablat) vs. rma(mods=~ablat, scale=~1), both ML)")
lp("(Cross-validates app 'LR test (scale mods)' for LS-C)")
lp("LRT:  ", fmt(lrt_ls_c_scale$LRT), "  df = ", lrt_ls_c_scale$df, "  p = ", fmt_p(lrt_ls_c_scale$p))
lp("")

# LRT: LS-C vs LS-B  (add ablat to location)
lrt_ls_c <- safe_lrt(res_ls_c, res_ls_b)
lp("--- LR TEST: LS-C vs. LS-B (add ablat to location) ---")
lp("(rma(mods=~ablat, scale=~ablat) vs. rma(scale=~ablat), both ML)")
lp("LRT:  ", fmt(lrt_ls_c$LRT), "  df = ", lrt_ls_c$df, "  p = ", fmt_p(lrt_ls_c$p))
lp("")

ll_c <- as.numeric(logLik(res_ls_c))[1]
lp("--- LOG-LIKELIHOOD ---")
lp("LL (R convention):   ", fmt(ll_c, 7))
lp("  JS LL = R_LL + k/2*log(2*pi) ≈ ", fmt(ll_c + k_const, 7))
lp("")

# ===========================================================================
# SECTION 6: Permutation test — ablat moderator
# ===========================================================================
lp("=== SECTION 6: PERMUTATION TEST — ablat moderator ===")
lp("(--perm iter = ", perm_arg, ", --seed = ", seed_arg, ")")
lp("rma(yi, vi, mods = ~ ablat, method = \"", method_arg, "\", data = dat)")
lp("")

res_perm_base <- rma(yi, vi, mods = ~ ablat, method = method_arg,
                     test = test_arg, data = dat)
st_perm <- mstats(res_perm_base)

lp("--- OBSERVED ---")
lp("QM (observed):  ", fmt(st_perm$QM), "  df = ", st_perm$QMdf)
lp("Wald p (ablat): ", fmt_p(st_perm$QMp))
lp("")

set.seed(seed_arg)
perm_out <- tryCatch(
  permutest(res_perm_base, iter = perm_arg, progbar = FALSE),
  error = function(e) NULL
)

if (!is.null(perm_out)) {
  perm_qm_p <- tryCatch({
    # Field name varies by metafor version
    p <- NULL
    for (nm in c("QMp.perm", "pval.perm", "QMp")) {
      v <- perm_out[[nm]]
      if (!is.null(v) && length(v) > 0) { p <- s1(v); break }
    }
    if (is.null(p)) NA_real_ else p
  }, error = function(e) NA_real_)
  lp("--- PERMUTED (R Mersenne-Twister, seed = ", seed_arg, ") ---")
  lp("QM permuted p:  ", fmt_p(perm_qm_p),
     "  (from ", perm_arg, " iterations)")
  lp("")
  lp("  Note: JS uses mulberry32 PRNG seeded with --seed; permuted p-values will")
  lp("  differ numerically but should be directionally consistent for iter >= 1000.")
  lp("  Compare observed QM for exact validation; permuted p is PRNG-dependent.")
} else {
  lp("  permutest() failed — skipped.")
}
lp("")

# ===========================================================================
# KNOWN DIVERGENCES
# ===========================================================================
lp("=== KNOWN DIVERGENCES ===")
lp("All differences below are expected. None indicate computation errors.")
lp("")

note_div("QE FORMULA (Sections 1-2)")
lp("   QE uses FE weights (1/vi) with FE-fitted beta for residual Q.")
lp("   Matches metafor convention (Thompson & Sharp 1999, Viechtbauer 2010).")
lp("   App and this script both use this formula — should match exactly.")
lp("")

note_div("CATEGORICAL REFERENCE LEVEL (Section 2)")
lp("   App buildDesignMatrix drops the alphabetically-first level.")
lp("   For region {AS, EU, NA}: reference = AS => dummies are region:EU and region:NA.")
lp("   R uses relevel(factor(region), ref='AS') to match.")
lp("")

note_div("KH s² DENOMINATOR (when --ci KH)")
lp("   With test='knha', QM becomes F(p-1, k-p) and SE/CI use t(k-p).")
lp("   R rma(test='knha') matches app exactly for both omnibus and per-term tests.")
lp("")

note_div("LRT ALWAYS ML (Sections 1-2)")
lp("   app modTests[*].lrt always refits with ML even if model method = REML.")
lp("   This script does the same: computes 2*(ll_full - ll_reduced) with ML models.")
lp("")

note_div("LOCATION-SCALE LOG-LIKELIHOOD CONSTANT (Sections 4-5)")
lp("   JS lsModel omits the -k/2*log(2*pi) normalisation constant from LL.")
lp("   JS_LL = R_logLik + k/2*log(2*pi) = R_logLik + ", fmt(k_const, 4))
lp("   R logLik() includes the constant. To compare with app: subtract ", fmt(k_const, 4))
lp("")

note_div("PERMUTATION PRNG DIVERGENCE (Section 6)")
lp("   JS perm.js uses mulberry32 seeded with --seed; R uses Mersenne-Twister via set.seed().")
lp("   Permuted p-values will differ numerically but be directionally consistent for iter >= 1000.")
lp("   Observed QM must match exactly (Wald-based, not random).")
lp("")

note_div("DISPLAY PRECISION")
lp("   This script prints 4 decimal places; app displays 3.")
lp("   Differences of 0.001 may be rounding only.")
lp("")

lp("=== END OF RESULTS ===")

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
writeLines(out, output_file)
message("Results written to: ", output_file)
