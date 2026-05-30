# generate.R
# Reproducible benchmark expected values using the metafor R package.
#
# Each numbered block (1–49) corresponds to one entry in js/benchmarks.js and
# produces the yi, FE, RE, tau2, I2, and (for blocks 35–37) ciLow/ciHigh
# values used in that benchmark.
# Blocks 27–30, 32–34 use metafor escalc; block 31 (GOR) uses a manual R helper.
# Blocks 35–37 are CI method benchmarks (KH, t, PL) on the same 5-study log-RR
# dataset; only the CI bounds differ from the default normal/Wald CI.
#
# Blocks MH-1 through MH-4 reproduce MH_BENCHMARKS (Mantel-Haenszel and Peto OR).
#
# Blocks CL-1 through CL-3 reproduce CLUSTER_BENCHMARKS (cluster-robust SEs).
# These require the clubSandwich package:
#   install.packages("clubSandwich")
#
# Blocks INT-1 and INT-2 reproduce INTERACTION_BENCHMARKS (interaction terms
# in meta-regression).
#
# Publication bias blocks (PB-1 through PB-7) reproduce the expected values for
# the BCG Vaccine log-OR pub bias benchmark in js/benchmarks.js PUB_BIAS_BENCHMARKS.
# Block 39 covers the synthetic asymmetric funnel (second PUB_BIAS_BENCHMARKS entry).
#
# Requirements:
#   install.packages(c("metafor", "metadat", "clubSandwich"))
#   R >= 4.0, metafor >= 4.0
#
# Usage:
#   Rscript generate.R          # command line
#   source("generate.R")        # interactive session

suppressPackageStartupMessages({
  library(metafor)
  library(metadat)
  library(jsonlite)
})

cat("metafor", as.character(packageVersion("metafor")),
    "/ metadat", as.character(packageVersion("metadat")), "\n\n")

# JSON accumulation state
BENCH   <- list()
.cur_id <- NULL

hdr <- function(n, label) {
  .cur_id <<- as.character(n)
  cat(sprintf("\n## %d. %s\n", n, label))
}
sho <- function(res) {
  cat(sprintf("   beta=%.4f  se=%.4f  tau2=%.4f  I2=%.2f%%\n",
              as.numeric(coef(res)), as.numeric(res$se), res$tau2, res$I2))
  if (!is.null(.cur_id)) {
    yi_v <- as.vector(res$yi); vi_v <- as.vector(res$vi)
    w_fe <- 1 / vi_v
    BENCH[[.cur_id]] <<- list(
      FE     = round(sum(yi_v * w_fe) / sum(w_fe), 8),
      RE     = round(as.numeric(coef(res)), 8),
      tau2   = round(res$tau2, 8),
      I2     = round(res$I2, 4),
      ciLow  = round(res$ci.lb, 8),
      ciHigh = round(res$ci.ub, 8)
    )
  }
}
yis <- function(esc) {
  cat("   yi:", paste(round(esc$yi, 4), collapse=", "), "\n")
  if (!is.null(.cur_id) && !is.null(BENCH[[.cur_id]]))
    BENCH[[.cur_id]]$yi <<- round(as.vector(esc$yi), 8)
}

# =================================================================
# Shared datasets
# =================================================================

# BCG Vaccine (dat.bcg) — 13 studies
# Columns: tpos(a), tneg(b), cpos(c), cneg(d), plus study info
data(dat.bcg, package = "metadat")

# Normand 1999 (dat.normand1999) — 9 studies
# m1/sd1/n1 = specialist arm; m2/sd2/n2 = routine care arm
data(dat.normand1999, package = "metadat")

# Morris (2008) — 5 studies (not in metadat; defined inline)
morris <- data.frame(
  m_pre  = c(30.6, 23.5,  0.5, 53.4, 35.6),
  m_post = c(38.5, 26.8,  0.7, 75.9, 36.0),
  sd_pre = c(15.0,  3.1,  0.1, 14.5,  4.7),
  sd_post= c(11.6,  4.1,  0.1,  4.4,  4.6),
  n      = c(  20,   50,    9,   10,   14),
  r      = c(0.47, 0.64, 0.77, 0.89, 0.44)
)

# Synthetic proportion (4 studies, n=100)
prop_dat <- data.frame(x = c(10, 30, 20, 40), n = 100)

# Synthetic correlation (5 studies)
cor_dat <- data.frame(r = c(0.50, 0.30, 0.60, 0.40, 0.25),
                      n = c(  53,  103,   43,   78,  123))

# tau2 estimator test (k=3, equal vi=1)
tau_dat <- data.frame(yi = c(0, 1, 3), vi = c(1, 1, 1))

# =================================================================
# Block 1 — GENERIC  (BCG log-RR as pre-computed yi/vi, REML)
# The app accepts arbitrary yi/vi; we verify using escalc("RR").
# =================================================================
hdr(1, "GENERIC — BCG log-RR as pre-computed yi/vi (REML)")
esc <- escalc("RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 2 — OR  (BCG, DL)
# =================================================================
hdr(2, "OR — BCG log odds ratio (DL)")
esc <- escalc("OR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 3 — RR  (BCG, REML)
# =================================================================
hdr(3, "RR — BCG log risk ratio (REML)")
esc <- escalc("RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 4 — RD  (BCG, DL)
# =================================================================
hdr(4, "RD — BCG risk difference (DL)")
esc <- escalc("RD", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 5 — MD  (Normand 1999, REML)
# vi = sd1^2/n1 + sd2^2/n2  (Welch / independent-groups formula)
# =================================================================
hdr(5, "MD — Normand 1999 mean difference (REML)")
esc <- escalc("MD",
              m1i=m1i, sd1i=sd1i, n1i=n1i,
              m2i=m2i, sd2i=sd2i, n2i=n2i,
              data=dat.normand1999)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 6 — SMD Hedges' g  (Normand first 4 studies, REML)
# Only Edinburgh, Orpington-Mild, Orpington-Moderate, Orpington-Severe
# are used so that tau2 is confirmed from a metafor test file.
# =================================================================
hdr(6, "SMD — Normand 1999 first 4 studies Hedges' g (REML)")
sub4 <- dat.normand1999[1:4, ]
esc  <- escalc("SMD",
               m1i=m1i, sd1i=sd1i, n1i=n1i,
               m2i=m2i, sd2i=sd2i, n2i=n2i,
               data=sub4)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 7 — MD_paired  (Morris 2008, REML)
# metafor measure="MC": yi = m_post - m_pre, vi = sd_change^2/n
# =================================================================
hdr(7, "MD_paired — Morris 2008 mean change (REML)")
esc <- escalc("MC",
              m1i=m_post, m2i=m_pre,
              sd1i=sd_post, sd2i=sd_pre,
              ni=n, ri=r, data=morris)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 8 — SMD_paired / SMCR  (Morris 2008, DL)
# d = (m_post - m_pre) / sd_pre  (pre-test SD standardiser)
# =================================================================
hdr(8, "SMD_paired (SMCR) — Morris 2008 pre-SD standardised (DL)")
esc <- escalc("SMCR",
              m1i=m_post, m2i=m_pre,
              sd1i=sd_pre, ni=n, ri=r, data=morris)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 9 — PR  (Synthetic proportion, DL)
# yi = p = x/n,  vi = p(1-p)/n
# =================================================================
hdr(9, "PR — Synthetic raw proportion (DL)")
esc <- escalc("PR", xi=x, ni=n, data=prop_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 10 — PLO  (Synthetic proportion, DL)
# yi = logit(p),  vi = 1/(n*p*(1-p))
# =================================================================
hdr(10, "PLO — Synthetic logit proportion (DL)")
esc <- escalc("PLO", xi=x, ni=n, data=prop_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 11 — PAS  (Synthetic proportion, DL)
# yi = arcsin(sqrt(p)),  vi = 1/(4n)
# =================================================================
hdr(11, "PAS — Synthetic arcsine proportion (DL)")
esc <- escalc("PAS", xi=x, ni=n, data=prop_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 12 — PFT  (Synthetic proportion, DL)
# Uses metafor escalc("PFT"): yi = ½(arcsin(√(x/(n+1))) + arcsin(√((x+1)/(n+1)))),
# vi = 1/(4(n+0.5)). JS app now uses the same half-sum convention.
# =================================================================
hdr(12, "PFT — Synthetic Freeman-Tukey proportion (DL)")
esc <- escalc("PFT", xi=prop_dat$x, ni=prop_dat$n, data=prop_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 13 — ZCOR  (Synthetic correlation, DL)
# yi = atanh(r),  vi = 1/(n-3)
# =================================================================
hdr(13, "ZCOR — Synthetic Fisher-z correlation (DL)")
esc <- escalc("ZCOR", ri=r, ni=n, data=cor_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)
cat(sprintf("   Back-transformed: FE r = %.4f,  RE r = %.4f\n",
            tanh(as.numeric(predict(res, transf=tanh)$pred)),
            tanh(coef(res))))
# Note: for DL, predict() gives RE; FE = sum(yi/vi)/sum(1/vi) back-transformed.
fe_z <- sum(esc$yi / esc$vi) / sum(1 / esc$vi)
cat(sprintf("   FE (z=%.4f) -> r=%.4f;  RE (z=%.4f) -> r=%.4f\n",
            fe_z, tanh(fe_z), coef(res), tanh(coef(res))))

# =================================================================
# Block 14 — COR  (Synthetic raw correlation, DL)
# yi = r,  vi = (1-r^2)^2 / (n-1)
# =================================================================
hdr(14, "COR — Synthetic raw correlation (DL)")
esc <- escalc("COR", ri=r, ni=n, data=cor_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Blocks 15–18 — tau2 estimator tests  (k=3, yi=[0,1,3], vi=[1,1,1])
# Block 38    — PM tau2 test (k=3, unequal vi=[0.25,0.50,1.00])
#
# NOTE: metafor 4.x "HS" and "SJ" use different algorithms than the JS app.
# Blocks 15 (HS) and 18 (SJ) compute tau2 manually matching tau2_HS / tau2_SJ
# in js/tau2.js; blocks 16 (HE) and 17 (ML) use metafor directly.
# =================================================================

# Block 15 — HS: tau2 = max(0, (Q-df)/ΣW)  (FE weights)
hdr(15, "tau2 estimator test — HS (k=3, vi=1)")
{
  k   <- nrow(tau_dat)
  w   <- 1 / tau_dat$vi
  W   <- sum(w)
  mu  <- sum(w * tau_dat$yi) / W
  Q   <- sum(w * (tau_dat$yi - mu)^2)
  t2  <- max(0, (Q - (k - 1)) / W)
  W2  <- sum(1 / (tau_dat$vi + t2))
  I2v <- 100 * max(0, (Q - (k - 1)) / Q)
  cat(sprintf("   beta=%.4f  se=%.4f  tau2=%.4f  I2=%.2f%%\n", mu, 1/sqrt(W2), t2, I2v))
  cat(sprintf("   [all yi=FE=RE=%.4f since equal vi; only tau2 differs by method]\n", mu))
  # τ²-based I2 matching JS formula τ²/(τ²+σ²) where σ²=(k-1)/c, c=W-Σw²/W
  # AUDITED: JS tau2.js uses this formula for all methods; HS/SJ I2 validated analytically (2026-05-30); see benchmark-data.md §F-14.
  c_hs    <- W - sum(w^2) / W
  sig2_hs <- (k - 1) / c_hs
  BENCH[["HS-1"]] <- list(
    FE   = round(mu, 7),
    RE   = round(mu, 7),
    tau2 = round(t2, 7),
    I2   = round(100 * t2 / (t2 + sig2_hs), 4)
  )
}

# Blocks 16–17 — HE and ML: metafor matches JS
for (blk_meth in list(c(16,"HE"), c(17,"ML"))) {
  blk  <- as.integer(blk_meth[1])
  meth <- blk_meth[2]
  hdr(blk, paste0("tau2 estimator test — ", meth, " (k=3, vi=1)"))
  res <- rma(yi, vi, data=tau_dat, method=meth)
  sho(res)
  cat(sprintf("   [all yi=FE=RE=%.4f since equal vi; only tau2 differs by method]\n",
              as.numeric(coef(res))))
}

# Block 18 — SJ: iterative fixed-point tau2*(1+tau2) = Q/k  (JS tau2_SJ algorithm)
hdr(18, "tau2 estimator test — SJ (k=3, vi=1)")
{
  k   <- nrow(tau_dat)
  # Seed: unweighted between-study variance
  yb0 <- mean(tau_dat$yi)
  t2  <- sum((tau_dat$yi - yb0)^2) / k
  for (iter in seq_len(500)) {
    W_   <- sum(1 / (tau_dat$vi + t2))
    mu_  <- sum(tau_dat$yi / (tau_dat$vi + t2)) / W_
    s_   <- sum(tau_dat$vi * (tau_dat$yi - mu_)^2 / (tau_dat$vi + t2))
    nt2  <- s_ / k
    if (abs(nt2 - t2) < 1e-10) { t2 <- max(0, nt2); break }
    t2   <- max(0, nt2)
  }
  w   <- 1 / tau_dat$vi
  W   <- sum(w)
  mu  <- sum(w * tau_dat$yi) / W
  Q   <- sum(w * (tau_dat$yi - mu)^2)
  W2  <- sum(1 / (tau_dat$vi + t2))
  I2v <- 100 * max(0, (Q - (k - 1)) / Q)
  cat(sprintf("   beta=%.4f  se=%.4f  tau2=%.4f  I2=%.2f%%\n", mu, 1/sqrt(W2), t2, I2v))
  cat(sprintf("   [all yi=FE=RE=%.4f since equal vi; only tau2 differs by method]\n", mu))
  # τ²-based I2 matching JS formula τ²/(τ²+σ²) where σ²=(k-1)/c, c=W-Σw²/W
  # AUDITED: JS tau2.js uses this formula for all methods; HS/SJ I2 validated analytically (2026-05-30); see benchmark-data.md §F-14.
  c_sj    <- W - sum(w^2) / W
  sig2_sj <- (k - 1) / c_sj
  BENCH[["SJ-1"]] <- list(
    FE   = round(mu, 7),
    RE   = round(mu, 7),
    tau2 = round(t2, 7),
    I2   = round(100 * t2 / (t2 + sig2_sj), 4)
  )
}

# =================================================================
# Block 19 — HR  (Synthetic hazard ratio, DL)
# No escalc measure; yi = log(hr),  vi = ((log(ci_hi)-log(ci_lo))/(2*1.96))^2
# =================================================================
hdr(19, "HR — Synthetic log hazard ratio from CI (DL)")
hr_dat <- data.frame(
  hr    = c(0.6065, 0.9048, 0.4066, 0.7408),
  ci_lo = c(0.3716, 0.5543, 0.2491, 0.4538),
  ci_hi = c(0.9900, 1.4770, 0.6637, 1.2092)
)
hr_dat$yi <- log(hr_dat$hr)
hr_dat$vi <- ((log(hr_dat$ci_hi) - log(hr_dat$ci_lo)) / (2 * 1.96))^2
res <- rma(yi, vi, data=hr_dat, method="DL")
sho(res); yis(hr_dat)

# =================================================================
# Block 20 — IRR  (Synthetic incidence rate ratio, DL)
# yi = log((x1/t1)/(x2/t2)),  vi = 1/x1 + 1/x2
# =================================================================
hdr(20, "IRR — Synthetic incidence rate ratio (DL)")
irr_dat <- data.frame(
  x1 = c(5, 18, 8, 14), t1 = 100,
  x2 = 20,              t2 = 100
)
esc <- escalc("IRR", x1i=x1, t1i=t1, x2i=x2, t2i=t2, data=irr_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 21 — IR  (Synthetic incidence rate log, DL)
# yi = log(x/t),  vi = 1/x
# =================================================================
hdr(21, "IR — Synthetic log incidence rate (DL)")
ir_dat <- data.frame(x = c(10, 25, 5, 20), t = c(200, 300, 400, 250))
esc <- escalc("IRLN", xi=x, ti=t, data=ir_dat)  # "IR" is raw rate; "IRLN" is log(x/t)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 22 — SMDH  (Normand 1999, REML)
# Heteroscedastic g: sdi = sqrt((sd1^2+sd2^2)/2)
# =================================================================
hdr(22, "SMDH — Normand 1999 heteroscedastic Hedges' g (REML)")
esc <- escalc("SMDH",
              m1i=m1i, sd1i=sd1i, n1i=n1i,
              m2i=m2i, sd2i=sd2i, n2i=n2i,
              data=dat.normand1999)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 23 — ROM  (Normand 1999, REML)
# yi = log(m1/m2),  vi = sd1^2/(n1*m1^2) + sd2^2/(n2*m2^2)
# =================================================================
hdr(23, "ROM — Normand 1999 log ratio of means (REML)")
esc <- escalc("ROM",
              m1i=m1i, sd1i=sd1i, n1i=n1i,
              m2i=m2i, sd2i=sd2i, n2i=n2i,
              data=dat.normand1999)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 24 — SMCC  (Morris 2008, DL)
# d = (m_post - m_pre) / sd_change  (change-score SD standardiser)
# =================================================================
hdr(24, "SMCC — Morris 2008 change-SD standardised (DL)")
esc <- escalc("SMCC",
              m1i=m_post, m2i=m_pre,
              sd1i=sd_post, sd2i=sd_pre,
              ni=n, ri=r, data=morris)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 25 — PLN  (Synthetic proportion, DL)
# yi = log(p) = log(x/n),  vi = (1-p)/(n*p)
# =================================================================
hdr(25, "PLN — Synthetic log proportion (DL)")
esc <- escalc("PLN", xi=x, ni=n, data=prop_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 26 — PHI  (BCG, DL)
# phi = (a*d - b*c) / sqrt((a+b)(c+d)(a+c)(b+d)),  vi = (1-phi^2)^2/(N-1)
# =================================================================
hdr(26, "PHI — BCG phi coefficient (DL)")
esc <- escalc("PHI", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 27 — MN  (Normand 1999 specialist arm, REML)
# yi = m1i,  vi = sd1i^2 / n1i
# =================================================================
hdr(27, "MN — Normand 1999 specialist arm raw mean (REML)")
esc <- escalc("MN", mi=m1i, sdi=sd1i, ni=n1i, data=dat.normand1999)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 28 — MNLN  (Normand 1999 specialist arm, REML)
# yi = log(m1i),  vi = sd1i^2 / (n1i * m1i^2)
# =================================================================
hdr(28, "MNLN — Normand 1999 specialist arm log mean (REML)")
esc <- escalc("MNLN", mi=m1i, sdi=sd1i, ni=n1i, data=dat.normand1999)
res <- rma(yi, vi, data=esc, method="REML")
sho(res); yis(esc)

# =================================================================
# Block 29 — CVR  (profiles.js CVR exampleData, DL)
# yi = log(cv1/cv2),  vi = 1/(2(n1-1)) + cv1^2/n1 + 1/(2(n2-1)) + cv2^2/n2
# =================================================================
hdr(29, "CVR — Synthetic log CV ratio (DL)")
cvr_dat <- data.frame(
  m1  = c(25.0, 30.1, 18.5, 42.0, 22.3),
  sd1 = c( 6.2,  9.0,  5.1, 11.5,  7.8),
  n1  = c(  40,   55,   30,   70,   45),
  m2  = c(24.8, 29.7, 19.0, 40.5, 23.1),
  sd2 = c( 3.5,  4.8,  3.0,  6.2,  4.9),
  n2  = c(  38,   52,   28,   68,   43)
)
esc <- escalc("CVR",
              m1i=m1, sd1i=sd1, n1i=n1,
              m2i=m2, sd2i=sd2, n2i=n2, data=cvr_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 30 — VR  (profiles.js VR exampleData, DL)
# yi = log(sd1/sd2),  vi = 1/(2(n1-1)) + 1/(2(n2-1))
# =================================================================
hdr(30, "VR — Synthetic log SD ratio (DL)")
vr_dat <- data.frame(
  sd1 = c(4.2, 5.5, 3.8, 6.1, 4.9),
  n1  = c( 40,  55,  30,  70,  45),
  sd2 = c(2.8, 3.2, 2.5, 4.0, 3.5),
  n2  = c( 38,  52,  28,  68,  43)
)
esc <- escalc("VR",
              sd1i=sd1, n1i=n1,
              sd2i=sd2, n2i=n2, data=vr_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 48 — VR heterogeneous  (6-study synthetic, REML, τ²>0)
# yi = log(sd1/sd2);  vi = 1/(2(n1-1)) + 1/(2(n2-1))
# Designed to exercise the heterogeneous-RE path (τ²≈0.91, I²≈97.4%).
# =================================================================
hdr(48, "VR heterogeneous — Synthetic log SD ratio (DL, tau2>0)")
vr_het <- data.frame(
  sd1 = c(2.0, 5.0, 3.0, 6.0, 1.5, 4.0),
  n1  = c( 50,  40,  60,  30,  45,  35),
  sd2 = c(4.0, 2.0, 3.0, 1.5, 4.5, 2.0),
  n2  = c( 50,  40,  60,  30,  45,  35)
)
esc <- escalc("VR", sd1i=sd1, n1i=n1, sd2i=sd2, n2i=n2, data=vr_het)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 49 — CVR heterogeneous  (6-study synthetic, DL, τ²>0)
# yi = log(cv1/cv2);  vi = 1/(2(n1-1)) + cv1^2/n1 + 1/(2(n2-1)) + cv2^2/n2
# Designed to exercise the heterogeneous-RE path (τ²≈1.04, I²≈97.7%).
# =================================================================
hdr(49, "CVR heterogeneous — Synthetic log CV ratio (DL, tau2>0)")
cvr_het <- data.frame(
  m1  = c(20.0, 15.0, 25.0, 10.0, 30.0, 18.0),
  sd1 = c( 2.0,  6.0,  5.0,  4.0,  3.0,  7.0),
  n1  = c(  50,   40,   60,   35,   45,   55),
  m2  = c(20.0, 15.0, 25.0, 10.0, 30.0, 18.0),
  sd2 = c( 6.0,  2.0,  5.0,  1.5,  9.0,  2.5),
  n2  = c(  50,   40,   60,   35,   45,   55)
)
esc <- escalc("CVR", m1i=m1, sd1i=sd1, n1i=n1, m2i=m2, sd2i=sd2, n2i=n2, data=cvr_het)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 31 — GOR  (Synthetic 4-study 3-category ordinal, DL)
# No metafor equivalent; computed via the gorFromCounts algorithm
# (concordance/discordance probability sums with delta-method variance).
# =================================================================
hdr(31, "GOR — Synthetic generalised odds ratio (DL)")

gor_from_counts <- function(c1, c2) {
  C  <- length(c1)
  N1 <- sum(c1); N2 <- sum(c2)
  p1 <- c1 / N1;  p2 <- c2 / N2

  L2   <- c(0, cumsum(p2[-C]))           # P(Y2 < j), j=0..C-1
  H2   <- c(rev(cumsum(rev(p2[-1]))), 0) # P(Y2 > j), j=0..C-1
  P1gt <- c(rev(cumsum(rev(p1[-1]))), 0) # P(Y1 > k), k=0..C-1
  P1lt <- c(0, cumsum(p1[-C]))           # P(Y1 < k), k=0..C-1

  theta <- sum(p1 * L2)
  phi   <- sum(p1 * H2)

  at <- L2   - theta;  ap <- H2   - phi
  bt <- P1gt - theta;  bp <- P1lt - phi

  V1t <- sum(p1 * at^2) / N1;  V1p <- sum(p1 * ap^2) / N1
  Cov1 <- sum(p1 * at * ap) / N1
  V2t <- sum(p2 * bt^2) / N2;  V2p <- sum(p2 * bp^2) / N2
  Cov2 <- sum(p2 * bt * bp) / N2

  varLog <- (V1t + V2t) / theta^2 +
            (V1p + V2p) / phi^2   -
            2 * (Cov1 + Cov2) / (theta * phi)
  list(es = log(theta) - log(phi), var = varLog)
}

gor_studies <- list(
  list(c1 = c(15, 20, 35), c2 = c(30, 25, 15)),
  list(c1 = c(10, 25, 40), c2 = c(25, 30, 20)),
  list(c1 = c(20, 30, 30), c2 = c(35, 30, 15)),
  list(c1 = c(12, 18, 40), c2 = c(28, 32, 20))
)
gor_yi <- sapply(gor_studies, function(s) gor_from_counts(s$c1, s$c2)$es)
gor_vi <- sapply(gor_studies, function(s) gor_from_counts(s$c1, s$c2)$var)
res <- rma(gor_yi, gor_vi, method="DL")
sho(res)
cat("   yi:", paste(round(gor_yi, 4), collapse=", "), "\n")

# =================================================================
# Block 32 — PCOR  (Synthetic partial correlation, DL)
# yi = ri,  vi = (1−ri²)² / (ni−mi−1)   [Olkin & Siotani 1976]
# mi = number of covariates (called p in the app)
# =================================================================
hdr(32, "PCOR — Synthetic raw partial correlation (DL)")
pcor_dat <- data.frame(
  r = c(0.45, 0.38, 0.52, 0.31, 0.47),
  n = c(  80,   65,  110,   90,  130),
  p = c(   2,    2,    3,    2,    4)
)
esc <- escalc("PCOR", ri=r, ni=n, mi=p, data=pcor_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)

# =================================================================
# Block 33 — ZPCOR  (Synthetic partial correlation, Fisher z, DL)
# yi = atanh(ri),  vi = 1 / (ni−mi−3)
# Back-transform: tanh(pooled z) → r scale
# =================================================================
hdr(33, "ZPCOR — Synthetic Fisher-z partial correlation (DL)")
esc <- escalc("ZPCOR", ri=r, ni=n, mi=p, data=pcor_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)
cat(sprintf("   Back-transformed RE: tanh(%.4f) = %.4f\n",
            as.numeric(coef(res)), tanh(as.numeric(coef(res)))))

# =================================================================
# Block 34 — RTET  (Synthetic tetrachoric correlation, DL)
# yi = rho_tet: bisect Phi2(h,k;rho) = a/N; vi via delta method.
# metafor escalc("RTET") implements the same algorithm.
# =================================================================
hdr(34, "RTET — Synthetic tetrachoric correlation (DL)")
rtet_dat <- data.frame(
  a = c(40, 30, 25, 35),
  b = c(10, 15,  8, 12),
  c = c(10, 12,  9, 11),
  d = c(40, 43, 38, 42)
)
esc <- escalc("RTET", ai=a, bi=b, ci=c, di=d, data=rtet_dat)
res <- rma(yi, vi, data=esc, method="DL")
sho(res); yis(esc)
cat(sprintf("   Spot-check Study 1: rho=%.6f  sin(0.3*pi)=%.6f\n",
            esc$yi[1], sin(0.3 * pi)))

# =================================================================
# Blocks 35–37 — CI method benchmarks
# Same 5-study synthetic log-RR dataset throughout.
# yi = log(p1/p2),  vi = 1/a − 1/n1 + 1/c − 1/n2
# =================================================================
ci_dat <- data.frame(
  ai = c(15, 20, 10, 25, 12),
  bi = c(85, 80, 90, 75, 88),
  ci = c(30, 25, 35, 20, 28),
  di = c(70, 75, 65, 80, 72)
)
ci_esc <- escalc("RR", ai=ai, bi=bi, ci=ci, di=di, data=ci_dat)

# Helper: print CI bounds alongside the standard summary
sho_ci <- function(res) {
  sho(res)
  ci <- confint(res)
  cat(sprintf("   ciLow=%.4f  ciHigh=%.4f\n", ci$fixed["mu", "ci.lb"], ci$fixed["mu", "ci.ub"]))
}

# =================================================================
# Block 35 — KH  (Knapp-Hartung adjusted CI, DL tau²)
# seRE² = Σwᵢ(yᵢ−RE)² / ((k−1)·W);  crit = t_{k−1, 0.975}
# metafor: test="knha"
# =================================================================
hdr(35, "log-RR CI method=KH (DL, Knapp-Hartung)")
res35 <- rma(yi, vi, data=ci_esc, method="DL", test="knha")
sho(res35)
cat(sprintf("   ciLow=%.4f  ciHigh=%.4f  (t_{%d} crit=%.4f)\n",
            res35$ci.lb, res35$ci.ub, res35$k - 1, qt(0.975, res35$k - 1)))

# =================================================================
# Block 36 — t  (t-distribution CI, no KH variance adjustment, DL)
# seRE = √(1/W) as normal;  crit = t_{k−1, 0.975}
# metafor: test="t"
# =================================================================
hdr(36, "log-RR CI method=t (DL, t-distribution no KH)")
res36 <- rma(yi, vi, data=ci_esc, method="DL", test="t")
sho(res36)
cat(sprintf("   ciLow=%.4f  ciHigh=%.4f  (t_{%d} crit=%.4f)\n",
            res36$ci.lb, res36$ci.ub, res36$k - 1, qt(0.975, res36$k - 1)))

# =================================================================
# Block 37 — PL  (Profile-likelihood CI, REML point estimate)
# CI bounds invert the profile log-likelihood (ML internally).
# metafor: rma(..., method="REML") then confint(..., type="PL")
# =================================================================
hdr(37, "log-RR CI method=PL (REML point estimate, PL CI bounds)")
res37 <- rma(yi, vi, data=ci_esc, method="REML")
sho(res37)
pl_ci <- confint(res37, type="PL")
cat(sprintf("   PL ciLow=%.4f  ciHigh=%.4f\n",
            pl_ci$fixed["mu", "ci.lb"], pl_ci$fixed["mu", "ci.ub"]))
cat(sprintf("   (tau2_ML used internally for profile; tau2_REML=%.4f for point estimate)\n",
            res37$tau2))

# =================================================================
# Block 38 — tau2_PM test (k=3, unequal vi; PM ≠ HE because vi differ)
# Dataset: yi=[0,1,3], vi=[0.25,0.50,1.00]
# Fixed-weight: FE=5/7=0.714, Q=364/49≈7.429, I²=73.1%
# τ²_PM: iterative fixed-point Q(τ*)=k−1=2
#   starts τ²=0, updates τ²_new = τ² + (Q(τ²)−2)/W(τ²) until |Δ|<1e-10
# =================================================================
hdr(38, "tau2 estimator test — PM (k=3, unequal vi)")
pm_dat <- data.frame(yi=c(0, 1, 3), vi=c(0.25, 0.50, 1.00))
res38 <- rma(yi, vi, data=pm_dat, method="PM")
sho(res38)
cat(sprintf("   tau2_PM=%.6f  RE=%.4f  I2=%.1f%%\n",
            res38$tau2, as.numeric(coef(res38)), res38$I2))
cat("   Note: equal-vi datasets give PM=HE; unequal vi produces PM≠HE (HE≈1.333 here)\n")

# =================================================================
# Publication Bias Benchmarks — BCG Vaccine log OR (13 studies)
# Source: dat.bcg (Colditz et al. 1994, JAMA 271:698-702)
# Blocks PB-1 through PB-7 correspond to PUB_BIAS_BENCHMARKS[0]
# in js/benchmarks.js.
# =================================================================

bcg <- dat.bcg
bcg_esc <- escalc("OR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=bcg)
res_bcg  <- rma(yi, vi, data=bcg_esc, method="DL")

cat("\n## PB-0. BCG log OR — pooled estimates (DL)\n")
fe_bcg_or <- as.numeric(coef(rma(yi, vi, data=bcg_esc, method="FE")))
cat(sprintf("   FE=%.4f  RE=%.4f  tau2=%.4f  I2=%.2f%%\n",
            fe_bcg_or, as.numeric(coef(res_bcg)), res_bcg$tau2, res_bcg$I2))
BENCH[["PB"]] <- list(
  FE   = round(fe_bcg_or, 8),
  RE   = round(as.numeric(coef(res_bcg)), 8),
  tau2 = round(res_bcg$tau2, 8),
  I2   = round(res_bcg$I2, 4)
)

# -----------------------------------------------------------------
# PB-1. Begg's rank correlation test
# JS beggTest(): Kendall tau_b between yi and vi (raw, not residuals).
# Any common FE offset cancels in pairwise sign comparisons, so
# tau(yi, vi) = tau(yi - mu_FE, vi).
# z: continuity-corrected normal approximation (Kendall & Gibbons 1990).
# Benchmark: tau=-0.128, S=-10, z=-0.549, p=0.583
# -----------------------------------------------------------------
cat("\n## PB-1. Begg's rank correlation test\n")
k_bcg   <- nrow(bcg_esc)
yi_b    <- bcg_esc$yi; vi_b <- bcg_esc$vi
S_begg  <- 0L
for (i in seq_len(k_bcg-1))
  for (j in seq(i+1, k_bcg))
    S_begg <- S_begg + sign(yi_b[i]-yi_b[j]) * sign(vi_b[i]-vi_b[j])
p0_begg  <- k_bcg*(k_bcg-1)/2
tau_begg <- S_begg / p0_begg          # no ties in this dataset
varS_begg <- k_bcg*(k_bcg-1)*(2*k_bcg+5)/18
z_begg   <- if (S_begg == 0) 0 else (abs(S_begg)-1)/sqrt(varS_begg)*sign(S_begg)
p_begg   <- 2*(1-pnorm(abs(z_begg)))
cat(sprintf("   tau=%.4f  S=%.0f  z=%.4f  p=%.4f\n",
            tau_begg, S_begg, z_begg, p_begg))
BENCH[["PB"]]$begg <- list(tau=round(tau_begg,4), S=as.integer(S_begg), z=round(z_begg,4), p=round(p_begg,4))

# -----------------------------------------------------------------
# PB-2. Egger's test
# JS eggerTest(): OLS of Z = yi/sei on X = 1/sei (precision).
#   Z_i = intercept + slope*(1/sei) + error
# Equivalent to regtest(model="lm", predictor="sei") which fits
#   yi = b0 + b1*sei + error  →  Xintrcpt=b0 (effect), Xsei=b1 (bias)
# Mapping: JS intercept = b1 = coef["Xsei"]   (bias, tested against H0)
#          JS slope     = b0 = coef["Xintrcpt"] (true effect)
# p from regtest is for the bias term (Xsei).
# Benchmark: intercept=-2.345, slope=-0.157, p=0.160
# -----------------------------------------------------------------
cat("\n## PB-2. Egger's test\n")
egger_res  <- regtest(res_bcg, model="lm", predictor="sei")
egger_coef <- coef(summary(egger_res$fit))
cat(sprintf("   intercept=%.4f  slope=%.4f  t=%.4f  p=%.4f  df=%d\n",
            egger_coef["Xsei",     "Estimate"],   # bias = JS intercept
            egger_coef["Xintrcpt", "Estimate"],   # effect = JS slope
            egger_coef["Xsei",     "t value"],    # t for bias test
            egger_res$pval,
            egger_res$ddf))
BENCH[["PB"]]$egger <- list(
  intercept = round(egger_coef["Xsei",     "Estimate"], 4),
  slope     = round(egger_coef["Xintrcpt", "Estimate"], 4),
  t         = round(egger_coef["Xsei",     "t value"],  4),
  p         = round(egger_res$pval, 4),
  df        = as.integer(egger_res$ddf)
)

# -----------------------------------------------------------------
# PB-3. FAT-PET test
# regtest() with predictor="sei" and model="rma" (WLS, weights=1/vi):
# WLS regression of yi on sei. Intercept = PET (true effect at SE=0),
# slope = FAT (bias). Note: intercept/slope are swapped vs Egger.
# -----------------------------------------------------------------
cat("\n## PB-3. FAT-PET test\n")
fatpet_res <- regtest(res_bcg, model="rma", predictor="sei")
cat(sprintf("   intercept(PET)=%.4f  interceptP=%.4f  slope(FAT)=%.4f  slopeP=%.4f  df=%d\n",
            fatpet_res$zval,   # z-stat for intercept
            fatpet_res$pval,
            fatpet_res$fit$beta["sei", ],
            NA,   # slope p not directly exposed; use regtest object manually
            fatpet_res$ddf))

# Manual FAT-PET via WLS for full output:
se_i   <- sqrt(bcg_esc$vi)
wi     <- 1 / bcg_esc$vi
X_fp   <- cbind(1, se_i)
XtWX   <- t(X_fp) %*% diag(wi) %*% X_fp
XtWy   <- t(X_fp) %*% (wi * bcg_esc$yi)
beta_fp <- solve(XtWX, XtWy)
rss_fp  <- sum(wi * (bcg_esc$yi - X_fp %*% beta_fp)^2)
df_fp   <- nrow(bcg_esc) - 2
s2_fp   <- rss_fp / df_fp
vcov_fp <- s2_fp * solve(XtWX)
se_b    <- sqrt(diag(vcov_fp))
t_b     <- beta_fp / se_b
p_b     <- 2 * pt(-abs(t_b), df=df_fp)
cat(sprintf("   [manual] intercept=%.4f  interceptP=%.4f  slope=%.4f  slopeP=%.4f\n",
            beta_fp[1], p_b[1], beta_fp[2], p_b[2]))
# JS fatPet: intercept=PET (beta_fp[1]), slope=FAT (beta_fp[2])
# JS petPeese will be added after PEESE block below
BENCH[["PB"]]$fatPet <- list(
  intercept  = round(beta_fp[1], 4),
  interceptP = round(p_b[1], 4),
  slope      = round(beta_fp[2], 4),
  slopeP     = round(p_b[2], 4)
)

# -----------------------------------------------------------------
# PB-4. Fail-safe N (Rosenthal and Orwin)
# JS default direction="positive": sumZ = Σ(yi/sei) (signed), matches metafor::fsn().
# Previous JS used Σ|yi/sei| which inflated Nfs for mixed-direction datasets.
# The BCG data has 2 studies with positive log-OR (opposite direction); signed
# formula correctly cancels them, giving a more conservative Nfs.
# -----------------------------------------------------------------
cat("\n## PB-4. Fail-safe N\n")
{
  zi_signed <- bcg_esc$yi / sqrt(bcg_esc$vi)   # signed, direction="positive"
  sumZ      <- sum(zi_signed)
  k_bcg     <- nrow(bcg_esc)
  z_crit    <- qnorm(1 - 0.05)                  # one-tailed 1.6449
  n_ros     <- max(0, (sumZ / z_crit)^2 - k_bcg)
  # Orwin: metafor's formula matches JS  (FE pooled, trivial threshold)
  fsn_orw <- fsn(yi, vi, data=bcg_esc, type="Orwin", target=0.1)
  cat(sprintf("   Rosenthal N_fs=%.1f\n", n_ros))
  cat(sprintf("   Orwin    N_fs=%.1f\n",  fsn_orw$fsnum))
  BENCH[["PB"]]$failSafe <- list(rosenthal=round(n_ros), orwin=as.integer(round(fsn_orw$fsnum)))
}

# -----------------------------------------------------------------
# FSN-2. Orwin fail-safe N with non-default trivial threshold (target=0.2)
# Same BCG dataset; tests that the UI trivial setting flows through correctly.
# R: fsn(yi, vi, data=bcg_esc, type="Orwin", target=0.2)
# -----------------------------------------------------------------
cat("\n## FSN-2. Orwin fail-safe N, trivial=0.2\n")
{
  fsn_orw2 <- fsn(yi, vi, data=bcg_esc, type="Orwin", target=0.2)
  cat(sprintf("   Orwin (target=0.2) N_fs=%.4f\n", fsn_orw2$fsnum))
  BENCH[["FSN-2"]] <- list(
    failSafe = list(
      rosenthal = BENCH[["PB"]]$failSafe$rosenthal,
      orwin     = as.integer(round(fsn_orw2$fsnum))
    )
  )
}

# -----------------------------------------------------------------
# PB-5. Harbord test
# Manual OLS regression: zi = (ai - Ei)/sqrt(Vi) on sqrt(Vi).
# Ei = (ai+bi)(ai+ci)/Ni; Vi = (ai+bi)(ci+di)(ai+ci)(bi+di)/(Ni^2*(Ni-1))
# Note: cells must be cast to numeric before computing Vi (integer overflow).
# Avoids OR-SE artefactual correlation that inflates Egger for log-OR.
# -----------------------------------------------------------------
cat("\n## PB-5. Harbord test\n")
a_h <- as.numeric(bcg$tpos); b_h <- as.numeric(bcg$tneg)
c_h <- as.numeric(bcg$cpos); d_h <- as.numeric(bcg$cneg)
N_h  <- a_h + b_h + c_h + d_h
E_h  <- (a_h + b_h) * (a_h + c_h) / N_h
V_h  <- (a_h + b_h) * (c_h + d_h) * (a_h + c_h) * (b_h + d_h) / (N_h^2 * (N_h - 1))
z_h  <- (a_h - E_h) / sqrt(V_h)
x_h  <- sqrt(V_h)
fit_h <- lm(z_h ~ x_h)
cf_h  <- summary(fit_h)$coefficients
cat(sprintf("   intercept=%.4f  interceptSE=%.4f  interceptT=%.4f  interceptP=%.4f  df=%d\n",
            cf_h["(Intercept)", "Estimate"],
            cf_h["(Intercept)", "Std. Error"],
            cf_h["(Intercept)", "t value"],
            cf_h["(Intercept)", "Pr(>|t|)"],
            fit_h$df.residual))
BENCH[["PB"]]$harbord <- list(
  intercept  = round(cf_h["(Intercept)", "Estimate"], 4),
  interceptP = round(cf_h["(Intercept)", "Pr(>|t|)"], 4)
)

# -----------------------------------------------------------------
# PB-6. Peters test
# regtest() with predictor="ni" (1/N): WLS regression of yi on 1/Ni.
# Uses total sample size Ni = ai+bi+ci+di.
# -----------------------------------------------------------------
cat("\n## PB-6. Peters test\n")
bcg_esc$ni <- bcg$tpos + bcg$tneg + bcg$cpos + bcg$cneg
peters_res  <- regtest(res_bcg, model="rma", predictor="ni")
cat(sprintf("   intercept=%.4f  interceptP=%.4f  df=%d\n",
            peters_res$zval,
            peters_res$pval,
            peters_res$ddf))

# Manual Peters for full output (WLS of yi on 1/Ni, w=1/vi):
Ni_vec <- bcg_esc$ni
x_pet  <- 1 / Ni_vec
w_pet  <- 1 / bcg_esc$vi
X_pet  <- cbind(1, x_pet)
XtWX_p <- t(X_pet) %*% diag(w_pet) %*% X_pet
XtWy_p <- t(X_pet) %*% (w_pet * bcg_esc$yi)
beta_p  <- solve(XtWX_p, XtWy_p)
rss_p   <- sum(w_pet * (bcg_esc$yi - X_pet %*% beta_p)^2)
s2_p    <- rss_p / df_fp
vcov_p  <- s2_p * solve(XtWX_p)
se_p    <- sqrt(diag(vcov_p))
t_p     <- beta_p / se_p
p_p     <- 2 * pt(-abs(t_p), df=df_fp)
cat(sprintf("   [manual] intercept=%.4f  interceptP=%.4f  slope=%.4f  slopeP=%.4f\n",
            beta_p[1], p_p[1], beta_p[2], p_p[2]))
BENCH[["PB"]]$peters <- list(
  intercept  = round(beta_p[1], 4),
  interceptP = round(p_p[1], 4)
)

# -----------------------------------------------------------------
# PB-8. Deeks test (BCG OR, k=13)
# Deeks et al. (2005, J Clin Epidemiol 58:882-893)
# WLS regression of log(DOR_i) on 1/sqrt(ESS_i) with weights ESS_i.
# ESS_i = 2*(a+c)*(b+d)/N;  DOR_i = (a*d)/(b*c)
# Studies with any zero cell are excluded (log DOR undefined).
# -----------------------------------------------------------------
cat("\n## PB-8. Deeks test (BCG OR, k=13)\n")
a_d <- bcg$tpos; b_d <- bcg$tneg; c_d <- bcg$cpos; d_d <- bcg$cneg
N_d   <- a_d + b_d + c_d + d_d
ESS_d <- 2 * (a_d + c_d) * (b_d + d_d) / N_d
logDOR <- log((a_d * d_d) / (b_d * c_d))
x_d    <- 1 / sqrt(ESS_d)
w_d    <- ESS_d
ok_d   <- a_d > 0 & b_d > 0 & c_d > 0 & d_d > 0
k_d    <- sum(ok_d)
fit_d  <- lm(logDOR[ok_d] ~ x_d[ok_d], weights = w_d[ok_d])
cf_d   <- summary(fit_d)$coefficients
cat(sprintf("   k=%d  df=%d\n", k_d, k_d - 2))
cat(sprintf("   intercept=%.4f  interceptSE=%.4f  interceptT=%.4f  interceptP=%.4f\n",
            cf_d["(Intercept)",  "Estimate"],
            cf_d["(Intercept)",  "Std. Error"],
            cf_d["(Intercept)",  "t value"],
            cf_d["(Intercept)",  "Pr(>|t|)"]))
cat(sprintf("   slope=%.4f  slopeP=%.4f\n",
            cf_d["x_d[ok_d]", "Estimate"],
            cf_d["x_d[ok_d]", "Pr(>|t|)"]))

# -----------------------------------------------------------------
# PB-9. Rücker test (BCG OR, k=13)
# Rücker et al. (2008, Stat Med 27:4450-4465)
# OLS regression (uniform weights) of z_i = y_i/se_i on 1/se_i.
# y_i = asin(sqrt(p1)) - asin(sqrt(p2)); se_i = sqrt(1/(4n1) + 1/(4n2))
# -----------------------------------------------------------------
cat("\n## PB-9. Rücker test (BCG OR, k=13)\n")
n1_r <- bcg$tpos + bcg$tneg
n2_r <- bcg$cpos + bcg$cneg
p1_r <- bcg$tpos / n1_r
p2_r <- bcg$cpos / n2_r
se_r <- sqrt(1 / (4 * n1_r) + 1 / (4 * n2_r))
y_r  <- asin(sqrt(p1_r)) - asin(sqrt(p2_r))
z_r  <- y_r / se_r
x_r  <- 1 / se_r
ok_r <- n1_r > 0 & n2_r > 0
k_r  <- sum(ok_r)
fit_r <- lm(z_r[ok_r] ~ x_r[ok_r])   # OLS — uniform weights
cf_r  <- summary(fit_r)$coefficients
cat(sprintf("   k=%d  df=%d\n", k_r, k_r - 2))
cat(sprintf("   intercept=%.4f  interceptSE=%.4f  interceptT=%.4f  interceptP=%.4f\n",
            cf_r["(Intercept)",  "Estimate"],
            cf_r["(Intercept)",  "Std. Error"],
            cf_r["(Intercept)",  "t value"],
            cf_r["(Intercept)",  "Pr(>|t|)"]))
cat(sprintf("   slope=%.4f  slopeP=%.4f\n",
            cf_r["x_r[ok_r]", "Estimate"],
            cf_r["x_r[ok_r]", "Pr(>|t|)"]))

# -----------------------------------------------------------------
# PB-7. Trim-and-fill (Duval & Tweedie L0 estimator, DL)
# trimfill() in metafor. estimator="L0", method="DL".
# k0 = number of imputed studies; adjusted RE from the filled model.
# -----------------------------------------------------------------
cat("\n## PB-7. Trim-and-fill (L0, DL)\n")
tf_res <- trimfill(res_bcg, estimator="L0")
cat(sprintf("   k0=%d  adjustedRE=%.4f  adjustedTau2=%.4f\n",
            tf_res$k0, as.numeric(coef(tf_res)), tf_res$tau2))
BENCH[["PB"]]$trimFill <- list(
  k0         = as.integer(tf_res$k0),
  adjustedRE = round(as.numeric(coef(tf_res)), 4)
)

# =================================================================
# Influence / LOO Benchmarks — 5-study synthetic log-RR (Phase 7)
# Same dataset as CI-method benchmarks 35–37.
# Blocks INF-1 and INF-2 correspond to INFLUENCE_BENCHMARKS[0]
# in js/benchmarks.js.
# =================================================================

inf_dat <- data.frame(
  ai = c(15, 20, 10, 25, 12),
  bi = c(85, 80, 90, 75, 88),
  ci = c(30, 25, 35, 20, 28),
  di = c(70, 75, 65, 80, 72)
)
inf_esc <- escalc("RR", ai=ai, bi=bi, ci=ci, di=di, data=inf_dat)
inf_esc$label <- paste0("Study ", 1:5)
res_inf <- rma(yi, vi, data=inf_esc, method="DL")

cat("\n## INF-0. Full DL meta (5-study log-RR)\n")
cat(sprintf("   RE=%.4f  tau2=%.4f  I2=%.2f%%  seRE=%.4f\n",
            as.numeric(coef(res_inf)), res_inf$tau2,
            res_inf$I2, res_inf$se))

# -----------------------------------------------------------------
# INF-1. Leave-one-out analysis
# leave1out() reruns rma() k times, each time omitting one study.
# Produces: estimate (RE_loo), tau2 (tau2_loo), se (seRE_loo) per study.
# -----------------------------------------------------------------
cat("\n## INF-1. Leave-one-out (DL)\n")
loo_res <- leave1out(res_inf)
cat(sprintf("   %-10s  %8s  %9s  %8s\n",
            "Study", "RE_loo", "tau2_loo", "seRE_loo"))
for (i in seq_len(length(loo_res$estimate))) {
  cat(sprintf("   %-10s  %8.4f  %9.4f  %8.4f\n",
              inf_esc$label[i],
              loo_res$estimate[i],
              loo_res$tau2[i],
              loo_res$se[i]))
}

# -----------------------------------------------------------------
# INF-2. Influence diagnostics
# influence() computes hat values, standardised residuals, DFFITS,
# Cook's distance, covariance ratio, and tau2-deleted per study.
#
# Mapping to JS influenceDiagnostics() fields:
#   metafor inf$hat      → hat
#   metafor inf$rstudent → stdResidual  (internally studentized; JS uses
#                          (yi - RE) / sqrt(vi + tau2), which is the
#                          non-studentized version — values will differ)
#   metafor inf$dffits   → related to DFBETA (metafor uses seRE_full
#                          in denominator; JS uses seRE_loo)
#   metafor inf$cook.d   → cookD  (metafor uses p+1 denominator for
#                          regression; JS uses W directly — values differ)
#   metafor inf$tau2.del → tau2_loo  (same concept; compare with leave1out)
#
# Because JS uses simpler definitions (no studentization, no p+1 scaling),
# leave1out() values are the primary cross-check. The influence() output
# below is shown for orientation only.
# -----------------------------------------------------------------
cat("\n## INF-2. Influence diagnostics (metafor)\n")
inf_diag <- influence(res_inf)$inf
cat(sprintf("   %-10s  %6s  %8s  %8s  %8s\n",
            "Study", "hat", "rstudent", "cook.d", "tau2.del"))
for (i in seq_len(length(inf_diag$hat))) {
  cat(sprintf("   %-10s  %6.4f  %8.4f  %8.4f  %8.4f\n",
              inf_esc$label[i],
              inf_diag$hat[i],
              inf_diag$rstudent[i],
              inf_diag$cook.d[i],
              inf_diag$tau2.del[i]))
}

# -----------------------------------------------------------------
# INF-3. Manual JS-equivalent statistics
# Reproduce the exact formulas from analysis.js for direct comparison
# with the benchmark expected values.
#   hat       = wi_re / W_re  (wi_re = 1/(vi + tau2_full))
#   stdResid  = (yi - RE) / sqrt(vi + tau2_full)
#   cookD     = (RE - RE_loo)^2 * W_re
#   DFBETA    = (RE - RE_loo) / seRE_loo
#   deltaTau2 = tau2_full - tau2_loo
# -----------------------------------------------------------------
cat("\n## INF-3. JS-equivalent manual statistics\n")
tau2_full <- res_inf$tau2
RE_full   <- as.numeric(coef(res_inf))
wi_re     <- 1 / (inf_esc$vi + tau2_full)
W_re      <- sum(wi_re)

hat       <- wi_re / W_re
stdResid  <- (inf_esc$yi - RE_full) / sqrt(inf_esc$vi + tau2_full)
RE_loo    <- loo_res$estimate
seRE_loo  <- loo_res$se
tau2_loo  <- loo_res$tau2
cookD     <- (RE_full - RE_loo)^2 * W_re
DFBETA    <- (RE_full - RE_loo) / seRE_loo
deltaTau2 <- tau2_full - tau2_loo
W_loo_inf      <- sapply(seq_len(nrow(inf_esc)), function(i) sum(1 / (inf_esc$vi[-i] + tau2_loo[i])))
dffits_var_inf <- hat * (tau2_loo + inf_esc$vi)
DFFITS_inf     <- ifelse(dffits_var_inf > 0, (RE_full - RE_loo) / sqrt(dffits_var_inf), NA)
covRatio_inf   <- W_re / W_loo_inf

cat(sprintf("   %-10s  %6s  %8s  %8s  %8s  %8s  %8s\n",
            "Study", "hat", "stdResid", "cookD", "DFBETA", "deltaTau2", "RE_loo"))
for (i in 1:5) {
  cat(sprintf("   %-10s  %6.4f  %8.4f  %8.4f  %8.4f  %8.4f  %8.4f\n",
              inf_esc$label[i],
              hat[i], stdResid[i], cookD[i], DFBETA[i], deltaTau2[i], RE_loo[i]))
}
BENCH[["INF-Normand"]] <- list(loo = lapply(seq_along(inf_esc$label), function(i) list(
  label       = inf_esc$label[i],
  RE_loo      = round(RE_loo[i],        6),
  tau2_loo    = round(tau2_loo[i],      6),
  hat         = round(hat[i],           6),
  cookD       = round(cookD[i],         6),
  stdResidual = round(stdResid[i],      6),
  DFBETA      = round(DFBETA[i],        6),
  DFFITS      = round(DFFITS_inf[i],    6),
  covRatio    = round(covRatio_inf[i],  6),
  deltaTau2   = round(deltaTau2[i],     6)
)))

# -----------------------------------------------------------------
# INF-4. BCG DFFITS benchmark (INFLUENCE_BENCHMARKS[1])
# dat.bcg log-RR, DL method, k=13.
# Reproduces influenceDiagnostics() DFFITS and covRatio fields.
# JS formula:
#   DFFITS_i  = (RE_full - RE_loo_i) / sqrt(hat_i * (tau2_loo_i + vi))
#   covRatio_i = W_full / W_loo_i  (W computed with LOO tau2)
# Threshold: 3 * sqrt(1/(k-1)) = 3*sqrt(1/12) ≈ 0.866; no study flagged.
# -----------------------------------------------------------------
cat("\n## INF-4. BCG DFFITS (dat.bcg log-RR, DL, k=13)\n")
bcg_rr   <- escalc("RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res_rr   <- rma(yi, vi, data=bcg_rr, method="DL")
k_rr     <- nrow(bcg_rr)
tau2_rr  <- res_rr$tau2
RE_rr    <- as.numeric(coef(res_rr))
wi_rr    <- 1 / (bcg_rr$vi + tau2_rr)
W_rr     <- sum(wi_rr)
dffits_thresh <- 3 * sqrt(1 / (k_rr - 1))
covr_thresh   <- 1 + 1 / k_rr

loo_rr <- lapply(seq_len(k_rr), function(i) {
  sub  <- bcg_rr[-i, ]
  fit  <- rma(yi, vi, data=sub, method="DL")
  list(RE=as.numeric(coef(fit)), tau2=fit$tau2)
})

cat(sprintf("   %-28s  %10s  %8s  %8s  %8s\n",
            "Study", "DFFITS", "highDF", "covRatio", "highCR"))
for (i in seq_len(k_rr)) {
  RE_loo_i   <- loo_rr[[i]]$RE
  tau2_loo_i <- loo_rr[[i]]$tau2
  hat_i      <- wi_rr[i] / W_rr
  dffits_var <- hat_i * (tau2_loo_i + bcg_rr$vi[i])
  dffits_i   <- if (dffits_var > 0) (RE_rr - RE_loo_i) / sqrt(dffits_var) else NA
  W_loo_i    <- sum(1 / (bcg_rr$vi[-i] + tau2_loo_i))
  covr_i     <- W_rr / W_loo_i
  cat(sprintf("   %-28s  %10.7f  %6s  %8.7f  %6s\n",
              dat.bcg$author[i],
              dffits_i, ifelse(abs(dffits_i) > dffits_thresh, "TRUE", "FALSE"),
              covr_i,   ifelse(covr_i > covr_thresh, "TRUE", "FALSE")))
}
{
  dffits_v <- covr_v <- numeric(k_rr)
  for (i in seq_len(k_rr)) {
    RE_loo_i   <- loo_rr[[i]]$RE; tau2_loo_i <- loo_rr[[i]]$tau2
    hat_i      <- wi_rr[i] / W_rr
    dffits_var <- hat_i * (tau2_loo_i + bcg_rr$vi[i])
    dffits_v[i] <- if (dffits_var > 0) (RE_rr - RE_loo_i) / sqrt(dffits_var) else NA
    W_loo_i    <- sum(1 / (bcg_rr$vi[-i] + tau2_loo_i))
    covr_v[i]  <- W_rr / W_loo_i
  }
  loo_rr_RE   <- sapply(loo_rr, `[[`, "RE")
  loo_rr_tau2 <- sapply(loo_rr, `[[`, "tau2")
  wi_rr_full  <- wi_rr
  tau2_rr_full <- rma(yi, vi, data=bcg_rr, method="DL")$tau2
  W_rr_re      <- 1 / (bcg_rr$vi + tau2_rr_full)
  W_rr_sum     <- sum(W_rr_re)
  RE_rr_mu     <- sum(W_rr_re * bcg_rr$yi) / W_rr_sum
  # JS-equivalent formulas (match influenceDiagnostics() in analysis.js):
  #   stdResidual = (yi - RE_full) / sqrt(vi + tau2_full)       — no (1-hi) correction
  #   DFBETA      = (RE_full - RE_loo_i) / seRE_loo_i           — LOO SE denominator
  #   cookD       = (RE_full - RE_loo_i)^2 * W_re               — W_re = sum(wi_re)
  loo_rr_se    <- sapply(seq_len(k_rr), function(i) sqrt(1 / sum(1 / (bcg_rr$vi[-i] + loo_rr_tau2[i]))))
  stdresid_js  <- (bcg_rr$yi - RE_rr_mu) / sqrt(bcg_rr$vi + tau2_rr_full)
  dfbeta_js    <- (RE_rr_mu - loo_rr_RE) / loo_rr_se
  cookd_js     <- (RE_rr_mu - loo_rr_RE)^2 * W_rr_sum
  deltatau2_js <- tau2_rr_full - loo_rr_tau2
  BENCH[["INF-BCG"]] <- list(loo = lapply(seq_len(k_rr), function(i) list(
    label       = dat.bcg$author[i],
    DFFITS      = round(dffits_v[i],            6),
    covRatio    = round(covr_v[i],              6),
    RE_loo      = round(loo_rr_RE[i],           6),
    tau2_loo    = round(loo_rr_tau2[i],         6),
    hat         = round(wi_rr_full[i] / W_rr,  6),
    cookD       = round(cookd_js[i],            6),
    DFBETA      = round(dfbeta_js[i],           6),
    stdResidual = round(stdresid_js[i],         6),
    deltaTau2   = round(deltatau2_js[i],        6)
  )))
}

# -----------------------------------------------------------------
# Block 39 — Synthetic asymmetric funnel, Egger's test
# Reproduces the second PUB_BIAS_BENCHMARKS entry.
# Expected: intercept=1.917, slope=-0.286, se=0.504, t=3.804, df=4, p=0.019
# -----------------------------------------------------------------
hdr(39, "Synthetic asymmetric funnel – Egger's test (k=6)")
asym_dat <- data.frame(
  yi = c(-0.1,  0.3,  0.1,  0.9,  1.4,  0.5),
  vi = c(0.04, 0.09, 0.0225, 0.36, 0.64, 0.16)
)
res39 <- rma(yi, vi, data=asym_dat, method="FE")
rt39  <- regtest(res39, model="lm")
cat(sprintf("   intercept = %.6f\n", rt39$est))
cat(sprintf("   slope     = %.6f\n", coef(rt39$fit)[2]))
cat(sprintf("   se(int)   = %.6f\n", sqrt(vcov(rt39$fit)[1,1])))
cat(sprintf("   t         = %.6f\n", rt39$zval))
cat(sprintf("   df        = %d\n",   rt39$dfs))
cat(sprintf("   p         = %.6f\n", rt39$pval))
# Block 39 corresponds to PUB_BIAS_BENCHMARKS[1] egger test only
BENCH[["PB-synth"]] <- list(
  egger = list(
    intercept = round(coef(rt39$fit)[2], 4),   # sei coef (Egger bias term)
    slope     = round(coef(rt39$fit)[1], 4),   # constant (precision effect)
    t         = round(rt39$zval, 4),
    p         = round(rt39$pval, 4),
    df        = as.integer(rt39$dfs)
  )
)

# -----------------------------------------------------------------
# Blocks 40–41 — Heterogeneous PCOR / ZPCOR benchmarks (REML, τ²>0)
# Same 5-study dataset for both types.  Studies 1–2 are large and precise
# with small r; studies 3–5 are small and imprecise with large r, creating
# clear FE vs RE separation.
# -----------------------------------------------------------------
hetero_dat <- data.frame(
  r = c(0.10, 0.15, 0.70, 0.75, 0.65),
  n = c(300L, 250L,  50L,  40L,  45L),
  p = c(2L,   1L,   3L,   2L,   3L)
)

hdr(40, "PCOR heterogeneous – raw partial correlation (REML, τ²>0)")
# PCOR: yi = r,  vi = (1-r^2)^2 / (n-p-1)
pcor_yi <- hetero_dat$r
pcor_vi <- (1 - hetero_dat$r^2)^2 / (hetero_dat$n - hetero_dat$p - 1)
res40 <- rma(yi=pcor_yi, vi=pcor_vi, method="REML")
sho(res40)
cat(sprintf("   yi   = [%s]\n",  paste(round(pcor_yi, 4), collapse=", ")))
cat(sprintf("   vi   = [%s]\n",  paste(round(pcor_vi, 6), collapse=", ")))
cat(sprintf("   FE   = %.4f\n",  rma(yi=pcor_yi, vi=pcor_vi, method="FE")$b[[1]]))
cat(sprintf("   RE   = %.4f\n",  as.numeric(coef(res40))))
cat(sprintf("   tau2 = %.4f\n",  res40$tau2))
cat(sprintf("   I2   = %.1f%%\n", res40$I2))

hdr(41, "ZPCOR heterogeneous – Fisher-z partial correlation (REML, τ²>0)")
# ZPCOR: yi = atanh(r),  vi = 1/(n-p-3)
zpcor_yi <- atanh(hetero_dat$r)
zpcor_vi <- 1 / (hetero_dat$n - hetero_dat$p - 3)
res41 <- rma(yi=zpcor_yi, vi=zpcor_vi, method="REML")
sho(res41)
cat(sprintf("   yi   = [%s]\n",  paste(round(zpcor_yi, 4), collapse=", ")))
cat(sprintf("   vi   = [%s]\n",  paste(round(zpcor_vi, 6), collapse=", ")))
cat(sprintf("   FE   = %.4f\n",  rma(yi=zpcor_yi, vi=zpcor_vi, method="FE")$b[[1]]))
cat(sprintf("   RE   = %.4f\n",  as.numeric(coef(res41))))
cat(sprintf("   tau2 = %.4f\n",  res41$tau2))
cat(sprintf("   I2   = %.1f%%\n", res41$I2))

cat("\n=== Meta-regression benchmarks (blocks 42–44) ===\n")

# Inline BCG yi/vi + moderators (identical to BENCHMARKS[0] data)
bcg_yi <- c(-0.8893113339202054, -1.5853886572014306, -1.348073148299693,
            -1.4415511900213054, -0.2175473222112957, -0.786115585818864,
            -1.6208982235983924,  0.011952333523841173, -0.4694176487381487,
            -1.3713448034727846, -0.33935882833839015,  0.4459134005713783,
            -0.017313948216879493)
bcg_vi <- c(0.3255847650039614, 0.19458112139814387, 0.41536796536796533,
            0.020010031902247573, 0.05121017216963086, 0.0069056184559087574,
            0.22301724757231517, 0.00396157929781773, 0.056434210463248966,
            0.07302479361302891, 0.01241221397155972, 0.5325058452001528,
            0.0714046596839863)
bcg_year  <- c(1948, 1949, 1960, 1977, 1973, 1953, 1973, 1980, 1968, 1961, 1974, 1969, 1976)
bcg_ablat <- c(44, 55, 42, 52, 13, 44, 19, 13, 27, 42, 18, 33, 33)
bcg_region <- c("NA","EU","AS","EU","AS","NA","AS","AS","NA","NA","NA","NA","NA")

# ---- Block 42: MR-A year + ablat (REML, normal CI) ----
hdr(42, "BCG meta-regression: year + ablat (REML, normal CI)")
res42 <- rma(yi=bcg_yi, vi=bcg_vi, mods=~year+ablat,
             data=data.frame(year=bcg_year, ablat=bcg_ablat),
             method="REML")
cat("   beta:  ", paste(round(coef(res42), 4), collapse=", "), "\n")
cat("   se:    ", paste(round(sqrt(diag(vcov(res42))), 4), collapse=", "), "\n")
cat("   tau2 = ", round(res42$tau2, 4), "\n")
cat("   QE =", round(res42$QE, 4), " df =", res42$QEdf, " p =", round(res42$QEp, 4), "\n")
cat("   QM =", round(res42$QM, 4), " df =", res42$QMdf, " p =", round(res42$QMp, 4), "\n")
cat("   I2 =", round(res42$I2, 2), "  R2 =", round(res42$R2, 4), "\n")
# Per-moderator Wald tests
cat("   anova(year):  "); print(anova(res42, btt=2))
cat("   anova(ablat): "); print(anova(res42, btt=3))
cat("   AIC =", round(AIC(res42), 6), "  BIC =", round(BIC(res42), 6),
    "  LL =", round(logLik(res42), 6), "\n")
BENCH[["MR-A"]] <- list(beta=round(as.vector(coef(res42)),6), se=round(sqrt(diag(vcov(res42))),6), tau2=round(res42$tau2,6), I2=round(res42$I2,4), QE=round(res42$QE,4), QEp=round(res42$QEp,4))

# ---- Block 43: MR-B ablat + region (REML, normal CI) ----
hdr(43, "BCG meta-regression: ablat + region (REML, normal CI)")
res43 <- rma(yi=bcg_yi, vi=bcg_vi, mods=~ablat+factor(region),
             data=data.frame(ablat=bcg_ablat, region=bcg_region),
             method="REML")
cat("   beta:  ", paste(round(coef(res43), 4), collapse=", "), "\n")
cat("   se:    ", paste(round(sqrt(diag(vcov(res43))), 4), collapse=", "), "\n")
cat("   tau2 = ", round(res43$tau2, 4), "\n")
cat("   QE =", round(res43$QE, 4), " df =", res43$QEdf, " p =", round(res43$QEp, 4), "\n")
cat("   QM =", round(res43$QM, 4), " df =", res43$QMdf, " p =", round(res43$QMp, 4), "\n")
cat("   I2 =", round(res43$I2, 2), "  R2 =", round(res43$R2, 4), "\n")
cat("   anova(ablat):  "); print(anova(res43, btt=2))
cat("   anova(region): "); print(anova(res43, btt=3:4))
cat("   AIC =", round(AIC(res43), 6), "  BIC =", round(BIC(res43), 6),
    "  LL =", round(logLik(res43), 6), "\n")
BENCH[["MR-B"]] <- list(beta=round(as.vector(coef(res43)),6), se=round(sqrt(diag(vcov(res43))),6), tau2=round(res43$tau2,6), I2=round(res43$I2,4), QE=round(res43$QE,4), QEp=round(res43$QEp,4))

# ---- Block 44: MR-C ablat + region (REML, KH CI) ----
hdr(44, "BCG meta-regression: ablat + region (REML, KH CI)")
res44 <- rma(yi=bcg_yi, vi=bcg_vi, mods=~ablat+factor(region),
             data=data.frame(ablat=bcg_ablat, region=bcg_region),
             method="REML", test="knha")
cat("   beta:  ", paste(round(coef(res44), 4), collapse=", "), "\n")
cat("   se:    ", paste(round(sqrt(diag(vcov(res44))), 4), collapse=", "), "\n")
cat("   tau2 = ", round(res44$tau2, 4), "\n")
cat("   QE =", round(res44$QE, 4), " df =", res44$QEdf, " p =", round(res44$QEp, 4), "\n")
cat("   QM =", round(res44$QM, 4), " df =", res44$QMdf, " p =", round(res44$QMp, 4), "\n")
cat("   I2 =", round(res44$I2, 2), "  R2 =", round(res44$R2, 4), "\n")
cat("   anova(ablat):  "); print(anova(res44, btt=2))
cat("   anova(region): "); print(anova(res44, btt=3:4))
cat("   AIC =", round(AIC(res44), 6), "  BIC =", round(BIC(res44), 6),
    "  LL =", round(logLik(res44), 6), "\n")
BENCH[["MR-C"]] <- list(beta=round(as.vector(coef(res44)),6), se=round(sqrt(diag(vcov(res44))),6), tau2=round(res44$tau2,6), I2=round(res44$I2,4), QE=round(res44$QE,4), QEp=round(res44$QEp,4))

cat("\n=== Selection model benchmarks (blocks 45–47) ===\n")
# Requirements: metafor >= 4.0 (selmodel() added in 3.x)
# These blocks use veveaHedges() / selmodel() from metafor to produce expected
# values for js/benchmarks.js VH_BENCHMARKS[0..2].

print_sel <- function(sel, res_ml, label) {
  cat(sprintf("\n[%s]\n", label))
  cat("   mu        =", round(as.numeric(sel$b),       8), "\n")
  cat("   se_mu     =", round(as.numeric(sel$se),      8), "\n")
  cat("   zval_mu   =", round(as.numeric(sel$zval),    6), "\n")
  cat("   pval_mu   =", round(as.numeric(sel$pval),    8), "\n")
  cat("   tau2      =", round(sel$tau2,                8), "\n")
  cat("   delta     =", paste(round(sel$delta, 8), collapse = ", "), "\n")
  if (!is.null(.cur_id))
    BENCH[[.cur_id]] <<- list(
      mu       = round(as.numeric(sel$b), 8),
      se_mu    = round(as.numeric(sel$se), 8),
      zval_mu  = round(as.numeric(sel$zval), 6),
      pval_mu  = round(as.numeric(sel$pval), 8),
      tau2     = round(sel$tau2, 8),
      delta    = round(as.vector(sel$delta), 8),
      LRT      = round(sel$LRT, 6),
      LRTdf    = as.integer(sel$LRTdf),
      LRTp     = round(sel$LRTp, 8)
    )
  cat("   LRT       =", round(sel$LRT,                 6), "\n")
  cat("   LRTdf     =", sel$LRTdf,                         "\n")
  cat("   LRTp      =", round(sel$LRTp,                8), "\n")
  cat("   ll_sel    =", round(sel$ll,                  8), "\n")
  cat("   ll_unsel  =", round(sel$ll0,                 8), "\n")
  cat("   RE_unsel  =", round(as.numeric(res_ml$b),    8), "\n")
  cat("   tau2_unsel=", round(res_ml$tau2,             8), "\n")
}

# Synthetic dataset (defined inline — not in metadat)
# 20 studies with positive effects spread across all 4 one-sided p-value intervals.
# Designed so that (0,0.025], (0.025,0.10], (0.10,0.50], (0.50,1.0] are all
# populated for 4-step one-sided testing.
syn_yi_sel <- c( 0.82, 1.10, 0.93, 0.70, 1.20, 0.55, 0.65, 0.90, 0.48, 0.40,
                 0.30, 0.20, 0.10, 0.05, 0.15, -0.10, -0.20, 0.00, -0.15, 0.08)
syn_vi_sel <- c( 0.04, 0.05, 0.04, 0.06, 0.04, 0.08, 0.09, 0.08, 0.10, 0.12,
                 0.15, 0.20, 0.25, 0.30, 0.20, 0.25, 0.30, 0.35, 0.25, 0.30)

res_bcg_ml <- rma(yi = bcg_yi, vi = bcg_vi, method = "ML")
res_syn_ml <- rma(yi = syn_yi_sel, vi = syn_vi_sel, method = "ML")

# ---- Block 45: BCG (OR), two-sided, 5 steps [0.025,0.10,0.25,0.50,1.0] ----
hdr(45, "Vevea-Hedges: BCG (OR), two-sided, steps=[0.025,0.10,0.25,0.50,1.0]")
# Two-sided p-values for BCG OR span all 5 intervals: [4,2,1,1,3] studies per interval.
withCallingHandlers({
  sel45 <- selmodel(res_bcg_ml, type = "stepfun", alternative = "two.sided",
                    steps = c(0.025, 0.10, 0.25, 0.50, 1.0))
  print_sel(sel45, res_bcg_ml, "BCG-OR 5-step two-sided")
}, warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") })

# ---- Block 46: BCG (OR), two-sided, 3 steps [0.05,0.50,1.0] ----
hdr(46, "Vevea-Hedges: BCG (OR), two-sided, steps=[0.05,0.50,1.0]")
withCallingHandlers({
  sel46 <- selmodel(res_bcg_ml, type = "stepfun", alternative = "two.sided",
                    steps = c(0.05, 0.50, 1.0))
  print_sel(sel46, res_bcg_ml, "BCG-OR 3-step two-sided")
}, warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") })

# ---- Block 47: Synthetic (positive effects), one-sided, 4 steps [0.025,0.10,0.50,1.0] ----
hdr(47, "Vevea-Hedges: Synthetic (positive effects), one-sided, steps=[0.025,0.10,0.50,1.0]")
# Interval counts: [7, 2, 8, 3]
withCallingHandlers({
  sel47 <- selmodel(res_syn_ml, type = "stepfun", alternative = "greater",
                    steps = c(0.025, 0.10, 0.50, 1.0))
  print_sel(sel47, res_syn_ml, "Synthetic 4-step one-sided")
}, warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") })

# =============================================================================
# Continuous selection model benchmarks (blocks HN-1 …)
# Requirements: metafor >= 4.0
# These blocks produce expected values for js/benchmarks.js HALFNORM_BENCHMARKS.
# =============================================================================

# ---- Block HN-1: BCG (OR), half-normal weight function, two-sided ----
.cur_id <- "HN-1"
cat("\n## HN-1. Half-normal selection model: BCG (OR), two-sided\n")
withCallingHandlers({
  sel_hn1 <- selmodel(res_bcg_ml, type = "halfnorm", alternative = "two.sided")
  print_sel(sel_hn1, res_bcg_ml, "BCG-OR half-normal two-sided")
}, warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") })
.cur_id <- NULL

# ---- Block PWR-1: BCG (OR), power weight function, two-sided ----
.cur_id <- "PWR-1"
cat("\n## PWR-1. Power selection model: BCG (OR), two-sided\n")
withCallingHandlers({
  sel_pwr1 <- selmodel(res_bcg_ml, type = "power", alternative = "two.sided")
  print_sel(sel_pwr1, res_bcg_ml, "BCG-OR power two-sided")
}, warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") })
.cur_id <- NULL

# ---- Block NEG-1: BCG (OR), negative exponential weight function, two-sided ----
.cur_id <- "NEG-1"
cat("\n## NEG-1. Negative exponential selection model: BCG (OR), two-sided\n")
withCallingHandlers({
  sel_neg1 <- selmodel(res_bcg_ml, type = "negexp", alternative = "two.sided")
  print_sel(sel_neg1, res_bcg_ml, "BCG-OR negexp two-sided")
}, warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") })
.cur_id <- NULL

# ---- Block BETA-1: BCG (OR), beta weight function, two-sided ----
# Beta model has two selection parameters (a, b); use custom print.
.cur_id <- "BETA-1"
cat("\n## BETA-1. Beta selection model: BCG (OR), two-sided\n")
withCallingHandlers({
  sel_beta1 <- selmodel(res_bcg_ml, type = "beta", alternative = "two.sided")
  delta_vals <- as.numeric(sel_beta1$delta)
  cat(sprintf("\n[BCG-OR beta two-sided]\n"))
  cat("   mu        =", round(as.numeric(sel_beta1$b),          8), "\n")
  cat("   se_mu     =", round(as.numeric(sel_beta1$se),         8), "\n")
  cat("   zval_mu   =", round(as.numeric(sel_beta1$zval),       8), "\n")
  cat("   pval_mu   =", round(as.numeric(sel_beta1$pval),       8), "\n")
  cat("   tau2      =", round(as.numeric(sel_beta1$tau2),       8), "\n")
  cat("   a         =", round(delta_vals[1],                    8), "\n")
  cat("   b         =", round(delta_vals[2],                    8), "\n")
  cat("   LRT       =", round(as.numeric(sel_beta1$LRT),        8), "\n")
  cat("   LRTdf     =", round(as.numeric(sel_beta1$LRTdf),      8), "\n")
  cat("   LRTp      =", round(as.numeric(sel_beta1$LRTp),       8), "\n")
  cat("   ll_sel    =", round(as.numeric(logLik(sel_beta1)),    8), "\n")
  cat("   ll_unsel  =", round(as.numeric(logLik(res_bcg_ml)),   8), "\n")
  cat("   RE_unsel  =", round(as.numeric(res_bcg_ml$b),         8), "\n")
  cat("   tau2_unsel=", round(as.numeric(res_bcg_ml$tau2),      8), "\n")
  BENCH[["BETA-1"]] <- list(
    mu       = round(as.numeric(sel_beta1$b),    8),
    se_mu    = round(as.numeric(sel_beta1$se),   8),
    zval_mu  = round(as.numeric(sel_beta1$zval), 6),
    pval_mu  = round(as.numeric(sel_beta1$pval), 8),
    tau2     = round(as.numeric(sel_beta1$tau2), 8),
    a        = round(delta_vals[1],              8),
    b        = round(delta_vals[2],              8),
    LRT      = round(as.numeric(sel_beta1$LRT),  6),
    LRTdf    = as.integer(sel_beta1$LRTdf),
    LRTp     = round(as.numeric(sel_beta1$LRTp), 8)
  )
}, warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") })
.cur_id <- NULL

# ---- Block MH-1: BCG Vaccine – OR (Mantel-Haenszel) ----
cat("\n## MH-1. Mantel-Haenszel: BCG Vaccine, OR\n")
data(dat.bcg)
res_mh_or <- rma.mh(ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg, measure="OR")
cat("est=",    sprintf("%.7f", res_mh_or$beta[[1]]), "\n")
cat("se=",     sprintf("%.7f", res_mh_or$se),       "\n")
cat("ciLow=",  sprintf("%.7f", res_mh_or$ci.lb),    "\n")
cat("ciHigh=", sprintf("%.7f", res_mh_or$ci.ub),    "\n")
cat("OR=",     sprintf("%.4f",  exp(res_mh_or$beta[[1]])), "\n")
cat("Q=",      sprintf("%.5f", res_mh_or$QE),       "\n")
cat("I2=",     sprintf("%.5f", res_mh_or$I2),       "\n")
BENCH[["MH-OR"]] <- list(est=round(res_mh_or$beta[[1]],7), se=round(res_mh_or$se,7), ciLow=round(res_mh_or$ci.lb,7), ciHigh=round(res_mh_or$ci.ub,7), I2=round(res_mh_or$I2,5))

# ---- Block MH-2: BCG Vaccine – RR (Mantel-Haenszel) ----
cat("\n## MH-2. Mantel-Haenszel: BCG Vaccine, RR\n")
res_mh_rr <- rma.mh(ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg, measure="RR")
cat("est=",    sprintf("%.7f", res_mh_rr$beta[[1]]), "\n")
cat("se=",     sprintf("%.7f", res_mh_rr$se),       "\n")
cat("ciLow=",  sprintf("%.7f", res_mh_rr$ci.lb),    "\n")
cat("ciHigh=", sprintf("%.7f", res_mh_rr$ci.ub),    "\n")
cat("RR=",     sprintf("%.4f",  exp(res_mh_rr$beta[[1]])), "\n")
cat("Q=",      sprintf("%.5f", res_mh_rr$QE),       "\n")
cat("I2=",     sprintf("%.5f", res_mh_rr$I2),       "\n")
BENCH[["MH-RR"]] <- list(est=round(res_mh_rr$beta[[1]],7), se=round(res_mh_rr$se,7), ciLow=round(res_mh_rr$ci.lb,7), ciHigh=round(res_mh_rr$ci.ub,7), I2=round(res_mh_rr$I2,5))

# ---- Block MH-3: BCG Vaccine – RD (Mantel-Haenszel) ----
cat("\n## MH-3. Mantel-Haenszel: BCG Vaccine, RD\n")
res_mh_rd <- rma.mh(ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg, measure="RD")
cat("est=",    sprintf("%.7f", res_mh_rd$beta[[1]]), "\n")
cat("se=",     sprintf("%.7f", res_mh_rd$se),       "\n")
cat("ciLow=",  sprintf("%.7f", res_mh_rd$ci.lb),    "\n")
cat("ciHigh=", sprintf("%.7f", res_mh_rd$ci.ub),    "\n")
cat("Q=",      sprintf("%.5f", res_mh_rd$QE),       "\n")
cat("I2=",     sprintf("%.5f", res_mh_rd$I2),       "\n")
BENCH[["MH-RD"]] <- list(est=round(res_mh_rd$beta[[1]],7), se=round(res_mh_rd$se,7), ciLow=round(res_mh_rd$ci.lb,7), ciHigh=round(res_mh_rd$ci.ub,7), I2=round(res_mh_rd$I2,5))

# ---- Block MH-4: BCG Vaccine – OR (Peto) ----
cat("\n## MH-4. Peto OR: BCG Vaccine\n")
res_peto <- rma.peto(ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
cat("est=",    sprintf("%.7f", res_peto$beta[[1]]), "\n")
cat("se=",     sprintf("%.7f", res_peto$se),       "\n")
cat("ciLow=",  sprintf("%.7f", res_peto$ci.lb),    "\n")
cat("ciHigh=", sprintf("%.7f", res_peto$ci.ub),    "\n")
cat("OR=",     sprintf("%.4f",  exp(res_peto$beta[[1]])), "\n")
cat("Q=",      sprintf("%.5f", res_peto$QE),       "\n")
cat("I2=",     sprintf("%.5f", res_peto$I2),       "\n")
BENCH[["MH-PETO"]] <- list(est=round(res_peto$beta[[1]],7), se=round(res_peto$se,7), ciLow=round(res_peto$ci.lb,7), ciHigh=round(res_peto$ci.ub,7), I2=round(res_peto$I2,5))

# =============================================================================
# Cluster-robust SE benchmarks (CLUSTER_BENCHMARKS in benchmarks.js)
# Requires: library(clubSandwich)
#
# CI formula matches analysis.js sandwichVar + robustMeta:
#   df = C - p  (C = number of clusters, p = 1 for intercept-only)
#   crit = qt(0.975, df) when df < 30, qnorm(0.975) otherwise
#   CI = [RE - crit * robustSE, RE + crit * robustSE]
# =============================================================================
userLib <- Sys.getenv("R_LIBS_USER")
.libPaths(c(userLib, .libPaths()))
library(clubSandwich)

robust_ci_js <- function(beta, rob_se, df) {
  crit <- if (df < 30) qt(0.975, df) else qnorm(0.975)
  list(lo = beta - crit * rob_se, hi = beta + crit * rob_se)
}

cat("\n## CL-1. Synthetic 3-cluster 6-study (REML)\n")
yi_cl1      <- c(0.10, 0.30, 0.50, 0.70, 0.20, 0.80)
vi_cl1      <- c(0.04, 0.05, 0.03, 0.06, 0.04, 0.05)
cluster_cl1 <- c(1,    1,    2,    2,    3,    3)
res_cl1 <- rma(yi_cl1, vi_cl1, method="REML")
ct_cl1  <- coef_test(res_cl1, vcov="CR1", cluster=cluster_cl1)
df_cl1  <- 3 - 1  # C - p
ci_cl1  <- robust_ci_js(as.numeric(res_cl1$beta), ct_cl1[1,"SE"], df_cl1)
cat("RE=",           sprintf("%.7f", as.numeric(res_cl1$beta)), "\n")
cat("modelSE=",      sprintf("%.7f", res_cl1$se),               "\n")
cat("tau2=",         sprintf("%.7f", res_cl1$tau2),             "\n")
cat("robustSE=",     sprintf("%.7f", ct_cl1[1,"SE"]),           "\n")
cat("robustCiLow=",  sprintf("%.7f", ci_cl1$lo),                "\n")
cat("robustCiHigh=", sprintf("%.7f", ci_cl1$hi),                "\n")
cat("clustersUsed=", 3,                                         "\n")
cat("df=",           df_cl1,                                    "\n")
BENCH[["CL-1"]] <- list(RE=round(as.numeric(res_cl1$beta),7), tau2=round(res_cl1$tau2,7), robustSE=round(ct_cl1[1,"SE"],7), robustCiLow=round(ci_cl1$lo,7), robustCiHigh=round(ci_cl1$hi,7), df=as.integer(df_cl1))

cat("\n## CL-2. 4-cluster 8-study heterogeneous sizes (DL)\n")
yi_cl2      <- c(0.20, 0.40, 0.60, -0.10, 0.30, 0.80, 0.50, 0.15)
vi_cl2      <- c(0.02, 0.03, 0.025, 0.04, 0.035, 0.02, 0.03, 0.05)
cluster_cl2 <- c(1,    1,    1,     2,    2,      3,    3,    4)
res_cl2 <- rma(yi_cl2, vi_cl2, method="DL")
ct_cl2  <- coef_test(res_cl2, vcov="CR1", cluster=cluster_cl2)
df_cl2  <- 4 - 1  # C - p
ci_cl2  <- robust_ci_js(as.numeric(res_cl2$beta), ct_cl2[1,"SE"], df_cl2)
cat("RE=",           sprintf("%.7f", as.numeric(res_cl2$beta)), "\n")
cat("modelSE=",      sprintf("%.7f", res_cl2$se),               "\n")
cat("tau2=",         sprintf("%.7f", res_cl2$tau2),             "\n")
cat("robustSE=",     sprintf("%.7f", ct_cl2[1,"SE"]),           "\n")
cat("robustCiLow=",  sprintf("%.7f", ci_cl2$lo),                "\n")
cat("robustCiHigh=", sprintf("%.7f", ci_cl2$hi),                "\n")
cat("clustersUsed=", 4,                                         "\n")
cat("df=",           df_cl2,                                    "\n")
BENCH[["CL-2"]] <- list(RE=round(as.numeric(res_cl2$beta),7), tau2=round(res_cl2$tau2,7), robustSE=round(ct_cl2[1,"SE"],7), robustCiLow=round(ci_cl2$lo,7), robustCiHigh=round(ci_cl2$hi,7), df=as.integer(df_cl2))

cat("\n## CL-3. All-singletons HC-robust (REML)\n")
yi_cl3      <- c(0.10, 0.30, 0.50, 0.70, 0.20)
vi_cl3      <- c(0.04, 0.05, 0.03, 0.06, 0.04)
cluster_cl3 <- c(1,    2,    3,    4,    5)
res_cl3 <- rma(yi_cl3, vi_cl3, method="REML")
ct_cl3  <- coef_test(res_cl3, vcov="CR1", cluster=cluster_cl3)
df_cl3  <- 5 - 1  # C - p
ci_cl3  <- robust_ci_js(as.numeric(res_cl3$beta), ct_cl3[1,"SE"], df_cl3)
cat("RE=",           sprintf("%.7f", as.numeric(res_cl3$beta)), "\n")
cat("modelSE=",      sprintf("%.7f", res_cl3$se),               "\n")
cat("tau2=",         sprintf("%.7f", res_cl3$tau2),             "\n")
cat("robustSE=",     sprintf("%.7f", ct_cl3[1,"SE"]),           "\n")
cat("robustCiLow=",  sprintf("%.7f", ci_cl3$lo),                "\n")
cat("robustCiHigh=", sprintf("%.7f", ci_cl3$hi),                "\n")
cat("clustersUsed=", 5,                                         "\n")
cat("df=",           df_cl3,                                    "\n")
BENCH[["CL-3"]] <- list(RE=round(as.numeric(res_cl3$beta),7), tau2=round(res_cl3$tau2,7), robustSE=round(ct_cl3[1,"SE"],7), robustCiLow=round(ci_cl3$lo,7), robustCiHigh=round(ci_cl3$hi,7), df=as.integer(df_cl3))

# =============================================================================
# Deeks & Rücker pub-bias test benchmarks (PUB_BIAS_BENCHMARKS in benchmarks.js)
#
# Both are pure WLS/OLS regressions; base R lm() used (no metafor dependency).
# Values match analysis.js deeksTest() / rueckerTest().
#
# Deeks (2005, J Clin Epidemiol 58:882-893):
#   WLS: log(DOR) ~ 1/sqrt(ESS),  weights = ESS
#   ESS_i = 2*(a+c)*(b+d)/(a+b+c+d)
#
# Rücker (2008, Stat Med 27:4450-4465):
#   OLS: z_i ~ 1/se_i,  weights = 1  (arcsine transformation)
#   z_i = (asin(sqrt(p1)) - asin(sqrt(p2))) / se_i
#   se_i = sqrt(1/(4*n1) + 1/(4*n2))
# =============================================================================

cat("\n## DEEKS-1. Synthetic k=4 (Deeks funnel asymmetry)\n")
a_d <- c(5, 20, 50, 80)
b_d <- c(15, 10, 30, 20)
c_d <- c(3, 15, 40, 60)
d_d <- c(7, 30, 80, 140)
N_d   <- a_d + b_d + c_d + d_d
ESS_d <- 2 * (a_d + c_d) * (b_d + d_d) / N_d
logDOR <- log(a_d * d_d / (b_d * c_d))
x_d    <- 1 / sqrt(ESS_d)
fit_d  <- lm(logDOR ~ x_d, weights = ESS_d)
sm_d   <- summary(fit_d)
cat("intercept =",  sprintf("%.7f", coef(fit_d)[1]),                "\n")
cat("interceptSE =",sprintf("%.7f", coef(sm_d)[1, "Std. Error"]),   "\n")
cat("interceptT =", sprintf("%.7f", coef(sm_d)[1, "t value"]),      "\n")
cat("interceptP =", sprintf("%.7f", coef(sm_d)[1, "Pr(>|t|)"]),     "\n")
cat("slope =",      sprintf("%.7f", coef(fit_d)[2]),                "\n")
cat("slopeSE =",    sprintf("%.7f", coef(sm_d)[2, "Std. Error"]),   "\n")
cat("slopeT =",     sprintf("%.7f", coef(sm_d)[2, "t value"]),      "\n")
cat("slopeP =",     sprintf("%.7f", coef(sm_d)[2, "Pr(>|t|)"]),     "\n")
cat("df =",         df.residual(fit_d),                             "\n")
BENCH[["DEEKS-1"]] <- list(
  intercept  = round(coef(fit_d)[1], 4),
  interceptP = round(coef(sm_d)[1, "Pr(>|t|)"], 4),
  slope      = round(coef(fit_d)[2], 4),
  slopeP     = round(coef(sm_d)[2, "Pr(>|t|)"], 4),
  df         = as.integer(df.residual(fit_d))
)

cat("\n## RUECKER-1. Synthetic k=4 (Rücker arcsine test)\n")
a_r <- c(2, 15, 40, 80)
b_r <- c(3, 10, 20, 20)
c_r <- c(4, 10, 30, 60)
d_r <- c(6, 20, 60, 140)
n1_r <- a_r + b_r
n2_r <- c_r + d_r
p1_r <- a_r / n1_r
p2_r <- c_r / n2_r
se_r   <- sqrt(1 / (4 * n1_r) + 1 / (4 * n2_r))
y_r    <- asin(sqrt(p1_r)) - asin(sqrt(p2_r))
z_r    <- y_r / se_r
prec_r <- 1 / se_r
fit_r  <- lm(z_r ~ prec_r)
sm_r   <- summary(fit_r)
cat("intercept =",  sprintf("%.7f", coef(fit_r)[1]),                "\n")
cat("interceptSE =",sprintf("%.7f", coef(sm_r)[1, "Std. Error"]),   "\n")
cat("interceptT =", sprintf("%.7f", coef(sm_r)[1, "t value"]),      "\n")
cat("interceptP =", sprintf("%.7f", coef(sm_r)[1, "Pr(>|t|)"]),     "\n")
cat("slope =",      sprintf("%.7f", coef(fit_r)[2]),                "\n")
cat("slopeSE =",    sprintf("%.7f", coef(sm_r)[2, "Std. Error"]),   "\n")
cat("slopeT =",     sprintf("%.7f", coef(sm_r)[2, "t value"]),      "\n")
cat("slopeP =",     sprintf("%.7f", coef(sm_r)[2, "Pr(>|t|)"]),     "\n")
cat("df =",         df.residual(fit_r),                             "\n")
BENCH[["RUECKER-1"]] <- list(
  intercept  = round(coef(fit_r)[1], 4),
  interceptP = round(coef(sm_r)[1, "Pr(>|t|)"], 4),
  slope      = round(coef(fit_r)[2], 4),
  slopeP     = round(coef(sm_r)[2, "Pr(>|t|)"], 4),
  df         = as.integer(df.residual(fit_r))
)

cat("\n## PET-PEESE-1. Synthetic asymmetric funnel (k=6)\n")
# Same data as synthetic asymmetric funnel in PUB_BIAS_BENCHMARKS.
# FAT-PET: WLS of yi on se, weights = 1/vi.
# PEESE:   WLS of yi on vi, weights = 1/vi.
yi_pp <- c(-0.1, 0.3, 0.1, 0.9, 1.4, 0.5)
vi_pp <- c(0.04, 0.09, 0.0225, 0.36, 0.64, 0.16)
se_pp <- sqrt(vi_pp)
wi_pp <- 1 / vi_pp

fit_fat  <- lm(yi_pp ~ se_pp,  weights = wi_pp)
sm_fat   <- summary(fit_fat)
cat("FAT-PET intercept =",  sprintf("%.7f", coef(fit_fat)[1]),              "\n")
cat("FAT-PET interceptSE =",sprintf("%.7f", coef(sm_fat)[1,"Std. Error"]), "\n")
cat("FAT-PET interceptP =", sprintf("%.7f", coef(sm_fat)[1,"Pr(>|t|)"]),  "\n")
cat("FAT-PET slope =",      sprintf("%.7f", coef(fit_fat)[2]),              "\n")
cat("FAT-PET slopeP =",     sprintf("%.7f", coef(sm_fat)[2,"Pr(>|t|)"]),  "\n")
cat("usePeese (FAT interceptP < 0.10):", coef(sm_fat)[1,"Pr(>|t|)"] < 0.10, "\n")

fit_peese <- lm(yi_pp ~ vi_pp, weights = wi_pp)
sm_peese  <- summary(fit_peese)
cat("PEESE intercept =",  sprintf("%.7f", coef(fit_peese)[1]),              "\n")
cat("PEESE interceptSE =",sprintf("%.7f", coef(sm_peese)[1,"Std. Error"]), "\n")
cat("PEESE interceptP =", sprintf("%.7f", coef(sm_peese)[1,"Pr(>|t|)"]),  "\n")
cat("PEESE slope =",      sprintf("%.7f", coef(fit_peese)[2]),              "\n")
cat("PEESE slopeP =",     sprintf("%.7f", coef(sm_peese)[2,"Pr(>|t|)"]),  "\n")

# =============================================================================
# RVE_BENCHMARKS — Robust Variance Estimation (rvePooled) benchmarks
#
# Implements the same closed-form Sherman-Morrison formula as rvePooled() in
# analysis.js.  Working model: V_i[j,j]=vi_j, V_i[j,k]=rho*sqrt(vi_j*vi_k).
# CR1 sandwich SE; df = m - p (p = number of predictors incl. intercept).
#
# Reference: Hedges, Tipton & Johnson (2010, Res Synth Methods 1:39-65).
# Note: robu() from robumeta additionally estimates omega^2; this manual
# implementation matches rvePooled() which uses vi directly (omega^2 = 0).
# =============================================================================

rve_manual <- function(yi, vi, cluster, rho = 0.80, alpha = 0.05) {
  rho1 <- 1 - rho
  cl_ids <- unique(as.character(cluster))
  m <- length(cl_ids)

  sumA <- 0; sumB <- 0
  clList <- list()
  for (id in cl_ids) {
    idx  <- which(as.character(cluster) == id)
    yi_i <- yi[idx]; vi_i <- vi[idx]
    ki   <- length(idx)
    ci   <- rho1 + rho * ki
    wi   <- 1/vi_i; si <- sqrt(wi)
    Wi   <- sum(wi); WYi <- sum(wi * yi_i)
    Si   <- sum(si); SYi <- sum(si * yi_i)
    Ai   <- (Wi - rho * Si^2 / ci) / rho1
    bi   <- (WYi - rho * Si * SYi / ci) / rho1
    sumA <- sumA + Ai; sumB <- sumB + bi
    clList[[id]] <- list(Ai=Ai, bi=bi, wi=wi, si=si, yi=yi_i, Si=Si, ci=ci)
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
  se  <- sqrt(varEst)
  df  <- m - 1
  crit <- qt(1 - alpha/2, df)
  t   <- est / se
  p   <- 2 * (1 - pt(abs(t), df))
  list(est=est, se=se, ciLow=est-crit*se, ciHigh=est+crit*se, t=t, p=p, df=df, kCluster=m)
}

rve_manual_reg <- function(yi, vi, cluster, x_mod, rho = 0.80, alpha = 0.05) {
  # Meta-regression: X = [1, x_mod]. Same Sherman-Morrison formulas, p=2.
  rho1 <- 1 - rho; p <- 2
  cl_ids <- unique(as.character(cluster))
  m <- length(cl_ids)

  B    <- matrix(0, p, p); bvec <- numeric(p)
  clList <- list()
  for (id in cl_ids) {
    idx  <- which(as.character(cluster) == id)
    yi_i <- yi[idx]; vi_i <- vi[idx]; xi <- x_mod[idx]
    ki   <- length(idx); ci <- rho1 + rho * ki
    wi   <- 1/vi_i; si <- sqrt(wi)
    X_i  <- cbind(1, xi)
    # WXX = sum_j w_j * x_j %o% x_j
    WXX  <- matrix(0, p, p)
    for (j in seq_along(yi_i)) WXX <- WXX + wi[j] * outer(X_i[j,], X_i[j,])
    SX   <- colSums(si * X_i)       # p-vector
    WXY  <- colSums(wi * yi_i * X_i) # p-vector
    SY   <- sum(si * yi_i)
    Ai   <- (WXX - rho/ci * outer(SX, SX)) / rho1
    bi   <- (WXY - rho/ci * SX * SY)       / rho1
    B    <- B + Ai; bvec <- bvec + bi
    clList[[id]] <- list(wi=wi, si=si, xi=xi, yi=yi_i, Si=SX, ci=ci, ki=ki)
  }
  beta <- solve(B, bvec)

  Meat <- matrix(0, p, p)
  for (cl in clList) {
    ei   <- cl$yi - (beta[1] + beta[2] * cl$xi)
    X_i  <- cbind(1, cl$xi)
    WXEi <- colSums(cl$wi * ei * X_i)
    SEi  <- sum(cl$si * ei)
    gi   <- (WXEi - rho * cl$Si * SEi / cl$ci) / rho1
    Meat <- Meat + outer(gi, gi)
  }

  df   <- m - p
  Binv <- solve(B)
  Vhat <- (m/(m-1)) * Binv %*% Meat %*% Binv
  crit <- qt(1 - alpha/2, df)
  se   <- sqrt(diag(Vhat))
  t    <- beta / se
  pv   <- 2*(1 - pt(abs(t), df))
  list(beta=beta, se=se, t=t, p=pv, df=df,
       ciLow=beta-crit*se, ciHigh=beta+crit*se, kCluster=m)
}

cat("\n## RVE-1. 3-cluster 6-study intercept-only (rho=0.80)\n")
yi1 <- c(0.10, 0.30, 0.50, 0.70, 0.20, 0.80)
vi1 <- c(0.04, 0.05, 0.03, 0.06, 0.04, 0.05)
cl1 <- c(  "1",  "1",  "2",  "2",  "3",  "3")
rv1 <- rve_manual(yi1, vi1, cl1, rho=0.80)
cat("est =",    sprintf("%.7f", rv1$est),     "\n")
cat("se =",     sprintf("%.7f", rv1$se),      "\n")
cat("ciLow =",  sprintf("%.7f", rv1$ciLow),   "\n")
cat("ciHigh =", sprintf("%.7f", rv1$ciHigh),  "\n")
cat("t =",      sprintf("%.7f", rv1$t),       "\n")
cat("p =",      sprintf("%.7f", rv1$p),       "\n")
cat("df =",     rv1$df,                       "\n")
cat("kCluster =", rv1$kCluster,               "\n")
BENCH[["RVE-1"]] <- list(est=round(rv1$est,7), se=round(rv1$se,7), ciLow=round(rv1$ciLow,7), ciHigh=round(rv1$ciHigh,7), t=round(rv1$t,7), p=round(rv1$p,7), df=as.integer(rv1$df), kCluster=as.integer(rv1$kCluster))

cat("\n## RVE-2. 4-cluster 8-study heterogeneous sizes (rho=0.80)\n")
yi2 <- c( 0.20,  0.40,  0.60, -0.10,  0.30,  0.80,  0.50,  0.15)
vi2 <- c(0.020, 0.030, 0.025, 0.040, 0.035, 0.020, 0.030, 0.050)
cl2 <- c(  "1",  "1",  "1",  "2",  "2",  "3",  "3",  "4")
rv2 <- rve_manual(yi2, vi2, cl2, rho=0.80)
cat("est =",    sprintf("%.7f", rv2$est),     "\n")
cat("se =",     sprintf("%.7f", rv2$se),      "\n")
cat("ciLow =",  sprintf("%.7f", rv2$ciLow),   "\n")
cat("ciHigh =", sprintf("%.7f", rv2$ciHigh),  "\n")
cat("t =",      sprintf("%.7f", rv2$t),       "\n")
cat("p =",      sprintf("%.7f", rv2$p),       "\n")
cat("df =",     rv2$df,                       "\n")
cat("kCluster =", rv2$kCluster,               "\n")
BENCH[["RVE-2"]] <- list(est=round(rv2$est,7), se=round(rv2$se,7), ciLow=round(rv2$ciLow,7), ciHigh=round(rv2$ciHigh,7), t=round(rv2$t,7), p=round(rv2$p,7), df=as.integer(rv2$df), kCluster=as.integer(rv2$kCluster))

cat("\n## RVE-3. 4-cluster 8-study meta-regression 1 moderator (rho=0.80)\n")
yi3 <- c(0.10, 0.30, 0.50, 0.70, 0.20, 0.80, 0.40, 0.60)
vi3 <- c(0.04, 0.05, 0.03, 0.06, 0.04, 0.05, 0.03, 0.04)
cl3 <- c( "1",  "1",  "2",  "2",  "3",  "3",  "4",  "4")
x3  <- c(   1,    2,    3,    4,    2,    5,    3,    6)
rv3 <- rve_manual_reg(yi3, vi3, cl3, x3, rho=0.80)
cat("intercept est =", sprintf("%.7f", rv3$beta[1]),   "\n")
cat("intercept se =",  sprintf("%.7f", rv3$se[1]),     "\n")
cat("intercept t =",   sprintf("%.7f", rv3$t[1]),      "\n")
cat("intercept p =",   sprintf("%.7f", rv3$p[1]),      "\n")
cat("slope est =",     sprintf("%.7f", rv3$beta[2]),   "\n")
cat("slope se =",      sprintf("%.7f", rv3$se[2]),     "\n")
cat("slope t =",       sprintf("%.7f", rv3$t[2]),      "\n")
cat("slope p =",       sprintf("%.7f", rv3$p[2]),      "\n")
cat("df =",            rv3$df,                         "\n")
cat("kCluster =",      rv3$kCluster,                   "\n")
BENCH[["RVE-3"]] <- list(beta=round(rv3$beta,7), se=round(rv3$se,7), t=round(rv3$t,7), p=round(rv3$p,7), df=as.integer(rv3$df), kCluster=as.integer(rv3$kCluster))

# =================================================================
# RVE-MoM BENCHMARKS — rvePooled(omega2:"MoM")
# Implements robumeta HIER two-step MoM via robu(..., modelweights="HIER", small=FALSE)
# Requires: robumeta package
#
# Algorithm: (1) initial 1/vi WLS, (2) MoM ω²+τ² estimation, (3) updated weights
#            1/(vi+τ²+ω²), (4) second WLS, (5) sandwich SE with scale m/(m-p).
# These blocks provide cross-validation of the _rveHIERMoM() function in regression.js.
# =================================================================
library(robumeta)

rve_mom <- function(d, formula, studynum, var_eff) {
  r <- robu(formula, data=d, studynum={{studynum}}, var.eff.size={{var_eff}},
            modelweights="HIER", rho=0.80, small=FALSE)
  list(est   = round(r$reg_table$b.r,  7),
       se    = round(r$reg_table$SE,    7),
       t     = round(r$reg_table$t,     7),
       p     = round(r$reg_table$prob,  7),
       df    = as.integer(r$reg_table$dfs[1]),
       kCluster = as.integer(max(d[[deparse(substitute(studynum))]])),
       omega2 = round(r$mod_info$omega.sq, 7),
       tau2   = round(r$mod_info$tau.sq,   7))
}

cat("\n## RVE-MoM-1. 3-cluster 6-study intercept-only (robu HIER small=FALSE)\n")
yi1 <- c(0.10, 0.30, 0.50, 0.70, 0.20, 0.80)
vi1 <- c(0.04, 0.05, 0.03, 0.06, 0.04, 0.05)
cl1 <- c(  "1",  "1",  "2",  "2",  "3",  "3")
d1  <- data.frame(yi=yi1, vi=vi1, cl=as.numeric(as.factor(cl1)))
rm1 <- robu(yi ~ 1, data=d1, studynum=cl, var.eff.size=vi, modelweights="HIER", rho=0.80, small=FALSE)
cat("est =",     sprintf("%.7f", rm1$reg_table$b.r),      "\n")
cat("se  =",     sprintf("%.7f", rm1$reg_table$SE),        "\n")
cat("t   =",     sprintf("%.7f", rm1$reg_table$t),         "\n")
cat("p   =",     sprintf("%.7f", rm1$reg_table$prob),      "\n")
cat("df  =",     rm1$reg_table$dfs,                        "\n")
cat("omega2 =",  sprintf("%.7f", rm1$mod_info$omega.sq),   "\n")
cat("tau2   =",  sprintf("%.7f", rm1$mod_info$tau.sq),     "\n")
BENCH[["RVE-MoM-1"]] <- list(
  est=round(rm1$reg_table$b.r,7), se=round(rm1$reg_table$SE,7),
  t=round(rm1$reg_table$t,7),     p=round(rm1$reg_table$prob,7),
  df=as.integer(rm1$reg_table$dfs),
  omega2=round(rm1$mod_info$omega.sq,7), tau2=round(rm1$mod_info$tau.sq,7))

cat("\n## RVE-MoM-2. 4-cluster 8-study heterogeneous sizes (robu HIER small=FALSE)\n")
yi2 <- c( 0.20,  0.40,  0.60, -0.10,  0.30,  0.80,  0.50,  0.15)
vi2 <- c(0.020, 0.030, 0.025, 0.040, 0.035, 0.020, 0.030, 0.050)
cl2 <- c(  "1",  "1",  "1",  "2",  "2",  "3",  "3",  "4")
d2  <- data.frame(yi=yi2, vi=vi2, cl=as.numeric(as.factor(cl2)))
rm2 <- robu(yi ~ 1, data=d2, studynum=cl, var.eff.size=vi, modelweights="HIER", rho=0.80, small=FALSE)
cat("est =",     sprintf("%.7f", rm2$reg_table$b.r),      "\n")
cat("se  =",     sprintf("%.7f", rm2$reg_table$SE),        "\n")
cat("t   =",     sprintf("%.7f", rm2$reg_table$t),         "\n")
cat("p   =",     sprintf("%.7f", rm2$reg_table$prob),      "\n")
cat("df  =",     rm2$reg_table$dfs,                        "\n")
cat("omega2 =",  sprintf("%.7f", rm2$mod_info$omega.sq),   "\n")
cat("tau2   =",  sprintf("%.7f", rm2$mod_info$tau.sq),     "\n")
BENCH[["RVE-MoM-2"]] <- list(
  est=round(rm2$reg_table$b.r,7), se=round(rm2$reg_table$SE,7),
  t=round(rm2$reg_table$t,7),     p=round(rm2$reg_table$prob,7),
  df=as.integer(rm2$reg_table$dfs),
  omega2=round(rm2$mod_info$omega.sq,7), tau2=round(rm2$mod_info$tau.sq,7))

# =================================================================
# THREE-LEVEL BENCHMARKS — meta3level()
# Requires: metafor (rma.mv with nested random effects)
#
# Model: rma.mv(yi, vi, random = ~1 | cluster/study, method = "REML")
#   sigma2[1] = between-cluster variance   (tau2_between in JS)
#   sigma2[2] = within-cluster variance    (tau2_within  in JS)
#
# I² uses the same formula as the JS implementation:
#   vi_typical = 1 / sum(1/vi)
#   I2_within  = 100 * sigma2[2] / (sigma2[2] + sigma2[1] + vi_typical)
#   I2_between = 100 * sigma2[1] / (sigma2[2] + sigma2[1] + vi_typical)
#
# Note: logLik from metafor includes the -k/2*log(2*pi) constant;
#   the JS implementation omits this constant (optimisation-equivalent).
# =================================================================

cat("\n## THREE-1. Synthetic 4-cluster x 3-study (12 studies, REML)\n")
yi_t1 <- c(0.00, 0.40, 0.20, 0.60, 1.00, 0.80, 0.10, 0.50, 0.30, 0.70, 1.10, 0.90)
vi_t1 <- rep(0.005, 12)
cl_t1 <- c("C1","C1","C1","C2","C2","C2","C3","C3","C3","C4","C4","C4")
st_t1 <- paste0(cl_t1, "_", c(1,2,3,1,2,3,1,2,3,1,2,3))
dat_t1 <- data.frame(yi=yi_t1, vi=vi_t1, cluster=cl_t1, study=st_t1)
res_t1 <- rma.mv(yi_t1, vi_t1, random=~1|cluster/study, data=dat_t1, method="REML")
W0_t1    <- sum(1/vi_t1)
vi_typ_t1 <- 1/W0_t1
s2w_t1   <- res_t1$sigma2[2]   # within-cluster (inner level)
s2b_t1   <- res_t1$sigma2[1]   # between-cluster (outer level)
tot_t1   <- s2w_t1 + s2b_t1 + vi_typ_t1
cat("mu           =", sprintf("%.10f", coef(res_t1)),              "\n")
cat("se           =", sprintf("%.10f", res_t1$se),                 "\n")
cat("ciLow        =", sprintf("%.10f", coef(res_t1) - qnorm(0.975)*res_t1$se), "\n")
cat("ciHigh       =", sprintf("%.10f", coef(res_t1) + qnorm(0.975)*res_t1$se), "\n")
cat("z            =", sprintf("%.10f", res_t1$zval),               "\n")
cat("p            =", sprintf("%.10f", res_t1$pval),               "\n")
cat("tau2_within  =", sprintf("%.10f", s2w_t1),                    "\n")
cat("tau2_between =", sprintf("%.10f", s2b_t1),                    "\n")
cat("I2_within    =", sprintf("%.8f",  100*s2w_t1/tot_t1),         "\n")
cat("I2_between   =", sprintf("%.8f",  100*s2b_t1/tot_t1),         "\n")
cat("Q            =", sprintf("%.10f", res_t1$QE),                 "\n")
cat("df           =", res_t1$k - 1,                                "\n")
cat("k            =", res_t1$k,                                    "\n")
cat("kCluster     =", length(unique(cl_t1)),                       "\n")
cat("logLik (R)   =", sprintf("%.10f", as.numeric(logLik(res_t1))), "(includes -k/2*log(2pi))\n")
BENCH[["THREE-1"]] <- list(mu=round(as.numeric(coef(res_t1)),8), se=round(res_t1$se,8), tau2_within=round(s2w_t1,8), tau2_between=round(s2b_t1,8), I2_within=round(100*s2w_t1/tot_t1,6), I2_between=round(100*s2b_t1/tot_t1,6))

cat("\n## THREE-2. Synthetic 5-cluster unequal sizes (14 studies, REML)\n")
yi_t2 <- c(0.10,0.70,0.40, 0.80,1.20, 0.05,0.45,0.25,0.90, 0.60,1.00, 0.35,0.75,0.55)
vi_t2 <- c(0.015,0.020,0.018, 0.012,0.015, 0.010,0.012,0.014,0.016, 0.020,0.025, 0.018,0.022,0.019)
cl_t2 <- c("A","A","A","B","B","C","C","C","C","D","D","E","E","E")
st_t2 <- paste0(cl_t2, "_", c(1,2,3,1,2,1,2,3,4,1,2,1,2,3))
dat_t2 <- data.frame(yi=yi_t2, vi=vi_t2, cluster=cl_t2, study=st_t2)
res_t2 <- rma.mv(yi_t2, vi_t2, random=~1|cluster/study, data=dat_t2, method="REML")
W0_t2    <- sum(1/vi_t2)
vi_typ_t2 <- 1/W0_t2
s2w_t2   <- res_t2$sigma2[2]
s2b_t2   <- res_t2$sigma2[1]
tot_t2   <- s2w_t2 + s2b_t2 + vi_typ_t2
cat("mu           =", sprintf("%.10f", coef(res_t2)),              "\n")
cat("se           =", sprintf("%.10f", res_t2$se),                 "\n")
cat("ciLow        =", sprintf("%.10f", coef(res_t2) - qnorm(0.975)*res_t2$se), "\n")
cat("ciHigh       =", sprintf("%.10f", coef(res_t2) + qnorm(0.975)*res_t2$se), "\n")
cat("z            =", sprintf("%.10f", res_t2$zval),               "\n")
cat("p            =", sprintf("%.10f", res_t2$pval),               "\n")
cat("tau2_within  =", sprintf("%.10f", s2w_t2),                    "\n")
cat("tau2_between =", sprintf("%.10f", s2b_t2),                    "\n")
cat("I2_within    =", sprintf("%.8f",  100*s2w_t2/tot_t2),         "\n")
cat("I2_between   =", sprintf("%.8f",  100*s2b_t2/tot_t2),         "\n")
cat("Q            =", sprintf("%.10f", res_t2$QE),                 "\n")
cat("df           =", res_t2$k - 1,                                "\n")
cat("k            =", res_t2$k,                                    "\n")
cat("kCluster     =", length(unique(cl_t2)),                       "\n")
cat("logLik (R)   =", sprintf("%.10f", as.numeric(logLik(res_t2))), "(includes -k/2*log(2pi))\n")
BENCH[["THREE-2"]] <- list(mu=round(as.numeric(coef(res_t2)),8), se=round(res_t2$se,8), tau2_within=round(s2w_t2,8), tau2_between=round(s2b_t2,8), I2_within=round(100*s2w_t2/tot_t2,6), I2_between=round(100*s2b_t2/tot_t2,6))

cat("\n## THREE-3. Synthetic 4-cluster x 3-study (12 studies, ML) — same data as THREE-1\n")
dat_t3 <- dat_t1
res_t3 <- rma.mv(yi_t1, vi_t1, random=~1|cluster/study, data=dat_t3, method="ML")
W0_t3    <- sum(1/vi_t1)
vi_typ_t3 <- 1/W0_t3
s2w_t3   <- res_t3$sigma2[2]
s2b_t3   <- res_t3$sigma2[1]
tot_t3   <- s2w_t3 + s2b_t3 + vi_typ_t3
cat("mu           =", sprintf("%.10f", coef(res_t3)),              "\n")
cat("se           =", sprintf("%.10f", res_t3$se),                 "\n")
cat("ciLow        =", sprintf("%.10f", coef(res_t3) - qnorm(0.975)*res_t3$se), "\n")
cat("ciHigh       =", sprintf("%.10f", coef(res_t3) + qnorm(0.975)*res_t3$se), "\n")
cat("z            =", sprintf("%.10f", res_t3$zval),               "\n")
cat("p            =", sprintf("%.10f", res_t3$pval),               "\n")
cat("tau2_within  =", sprintf("%.10f", s2w_t3),                    "\n")
cat("tau2_between =", sprintf("%.10f", s2b_t3),                    "\n")
cat("I2_within    =", sprintf("%.8f",  100*s2w_t3/tot_t3),         "\n")
cat("I2_between   =", sprintf("%.8f",  100*s2b_t3/tot_t3),         "\n")
cat("Q            =", sprintf("%.10f", res_t3$QE),                 "\n")
cat("df           =", res_t3$k - 1,                                "\n")
cat("k            =", res_t3$k,                                    "\n")
cat("kCluster     =", length(unique(cl_t1)),                       "\n")
cat("logLik (R)   =", sprintf("%.10f", as.numeric(logLik(res_t3))), "(includes -k/2*log(2pi))\n")
BENCH[["THREE-3"]] <- list(mu=round(as.numeric(coef(res_t3)),8), se=round(res_t3$se,8), tau2_within=round(s2w_t3,8), tau2_between=round(s2b_t3,8), I2_within=round(100*s2w_t3/tot_t3,6), I2_between=round(100*s2b_t3/tot_t3,6))

cat("\n## THREE-4. Synthetic 5-cluster unequal sizes (14 studies, ML) — same data as THREE-2\n")
dat_t4 <- dat_t2
res_t4 <- rma.mv(yi_t2, vi_t2, random=~1|cluster/study, data=dat_t4, method="ML")
W0_t4    <- sum(1/vi_t2)
vi_typ_t4 <- 1/W0_t4
s2w_t4   <- res_t4$sigma2[2]
s2b_t4   <- res_t4$sigma2[1]
tot_t4   <- s2w_t4 + s2b_t4 + vi_typ_t4
cat("mu           =", sprintf("%.10f", coef(res_t4)),              "\n")
cat("se           =", sprintf("%.10f", res_t4$se),                 "\n")
cat("ciLow        =", sprintf("%.10f", coef(res_t4) - qnorm(0.975)*res_t4$se), "\n")
cat("ciHigh       =", sprintf("%.10f", coef(res_t4) + qnorm(0.975)*res_t4$se), "\n")
cat("z            =", sprintf("%.10f", res_t4$zval),               "\n")
cat("p            =", sprintf("%.10f", res_t4$pval),               "\n")
cat("tau2_within  =", sprintf("%.10f", s2w_t4),                    "\n")
cat("tau2_between =", sprintf("%.10f", s2b_t4),                    "\n")
cat("I2_within    =", sprintf("%.8f",  100*s2w_t4/tot_t4),         "\n")
cat("I2_between   =", sprintf("%.8f",  100*s2b_t4/tot_t4),         "\n")
cat("Q            =", sprintf("%.10f", res_t4$QE),                 "\n")
cat("df           =", res_t4$k - 1,                                "\n")
cat("k            =", res_t4$k,                                    "\n")
cat("kCluster     =", length(unique(cl_t2)),                       "\n")
cat("logLik (R)   =", sprintf("%.10f", as.numeric(logLik(res_t4))), "(includes -k/2*log(2pi))\n")
BENCH[["THREE-4"]] <- list(mu=round(as.numeric(coef(res_t4)),8), se=round(res_t4$se,8), tau2_within=round(s2w_t4,8), tau2_between=round(s2b_t4,8), I2_within=round(100*s2w_t4/tot_t4,6), I2_between=round(100*s2b_t4/tot_t4,6))

cat("\n=== Done ===\n")

# ----------------------------------------------------------------
# TES-A. BCG Vaccine — Test of Excess Significance (OR, DL)
# Matches PUB_BIAS_BENCHMARKS[0]: type="OR", tauMethod="DL"
# Data: same 2x2 tables as the OR benchmark, using a/b/c/d notation.
# ----------------------------------------------------------------
# JS tesTest formula: power_i = Phi(|theta|/se_i - z) + Phi(-z - |theta|/se_i)
#                     E = sum(power_i), Var = E*(1-E/k), chi2 = ((O-E)/sqrt(Var))^2
# metafor tes() uses a different power / chi2 formula; compute directly to match JS.
# AUDITED: confirmed JS formula matches js_tes() helper (2026-05-30); R is canonical; see benchmark-data.md §"TES test".
js_tes <- function(yi, vi) {
  res  <- rma(yi, vi, method="DL")
  theta <- as.numeric(coef(res))
  z025  <- qnorm(0.975)
  k     <- length(yi)
  se_i  <- sqrt(vi)
  ncp   <- abs(theta) / se_i
  pow   <- pnorm(ncp - z025) + pnorm(-z025 - ncp)
  E     <- sum(pow)
  O     <- sum(abs(yi / se_i) > z025)
  Var   <- E * (1 - E / k)
  z_s   <- (O - E) / sqrt(Var)
  cat("O    =", O,                    "\n")
  cat("E    =", round(E,    6),       "\n")
  cat("chi2 =", round(z_s^2, 6),     "\n")
  cat("p    =", round(1 - pnorm(z_s), 6), "\n")
  invisible(list(O=as.integer(O), E=round(E,4), chi2=round(z_s^2,4), p=round(1-pnorm(z_s),4)))
}

cat("\n## TES-A. BCG Vaccine – tes() verification (OR, DL)\n")
yi_tes_a <- c(-0.9387, -1.6659, -1.3863, -1.4564, -0.2191, -0.9581,
              -1.6338,  0.0122, -0.4714, -1.4013, -0.3408,  0.4470, -0.0174)
vi_tes_a <- c(1/4+1/119+1/11+1/128,
              1/6+1/300+1/29+1/274,
              1/3+1/228+1/11+1/209,
              1/62+1/13536+1/248+1/12619,
              1/33+1/5036+1/47+1/5761,
              1/180+1/1361+1/372+1/1079,
              1/8+1/2537+1/10+1/619,
              1/505+1/87886+1/499+1/87892,
              1/29+1/7470+1/45+1/7232,
              1/17+1/1699+1/65+1/1600,
              1/186+1/50448+1/141+1/27197,
              1/5+1/2493+1/3+1/2338,
              1/27+1/16886+1/29+1/17825)
tes_a <- js_tes(yi_tes_a, vi_tes_a)
BENCH[["PB"]]$tes <- tes_a
# Expected (JS implementation): O=8, E≈8.703, chi2≈0.172, p≈0.661

# ----------------------------------------------------------------
# TES-B. Synthetic asymmetric funnel — tes() verification (DL)
# Matches PUB_BIAS_BENCHMARKS[1]: yi/vi as in benchmarks.js
# ----------------------------------------------------------------
cat("\n## TES-B. Synthetic asymmetric funnel – tes() verification (DL)\n")
yi_tes_b <- c(-0.1,  0.3,  0.1,  0.9,  1.4,  0.5)
vi_tes_b <- c(0.04, 0.09, 0.0225, 0.36, 0.64, 0.16)
js_tes(yi_tes_b, vi_tes_b)
# Expected (JS implementation): O=0, E≈0.707, chi2≈0.802, p≈0.815

# ----------------------------------------------------------------
# Block 48. MR-D: polynomial (quadratic) moderator — ablat + ablat²
# Matches META_REGRESSION_BENCHMARKS[3] (MR-D).
# ----------------------------------------------------------------
cat("\n## Block 48. MR-D: ablat + I(ablat^2), REML\n")
dat_mr <- escalc("RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res_poly2 <- rma(yi, vi,
                 mods = ~ ablat + I(ablat^2),
                 data = dat_mr,
                 method = "REML")
cat("beta  =", round(coef(res_poly2), 7), "\n")
cat("se    =", round(sqrt(diag(vcov(res_poly2))), 7), "\n")
cat("tau2  =", round(res_poly2$tau2, 7), "\n")
cat("QE    =", round(res_poly2$QE,   6), "df =", res_poly2$QEdf, "p =", round(res_poly2$QEp, 6), "\n")
cat("QM    =", round(res_poly2$QM,   6), "df =", res_poly2$QMdf, "p =", round(res_poly2$QMp, 6), "\n")
cat("I2    =", round(res_poly2$I2,   4), "\n")
cat("R2    =", round(res_poly2$R2,   4), "\n")

# ----------------------------------------------------------------
# Block 49. MR-E: restricted cubic spline (3 knots) — ablat
# Matches META_REGRESSION_BENCHMARKS[4] (MR-E).
# Uses Harrell's RCS formula with knots at 10th/50th/90th percentiles.
# ----------------------------------------------------------------
cat("\n## Block 49. MR-E: ablat RCS (3 knots), REML\n")
ablat_vals <- dat_mr$ablat
knots3 <- as.numeric(quantile(ablat_vals, c(0.10, 0.50, 0.90), type=7))
cat("Knots:", round(knots3, 6), "\n")

# Harrell RCS nonlinear term phi1 for 3-knot spline:
#   phi1(x) = (x-t1)^3_+ - (tk-t1)/(tk-tk1) * (x-tk1)^3_+ + (tk1-t1)/(tk-tk1) * (x-tk)^3_+
t1  <- knots3[1]; tk1 <- knots3[2]; tk <- knots3[3]
pos3 <- function(x, t) ifelse(x > t, (x - t)^3, 0)
denom <- tk - tk1
phi1 <- pos3(ablat_vals, t1) -
        ((tk - t1) / denom) * pos3(ablat_vals, tk1) +
        ((tk1 - t1) / denom) * pos3(ablat_vals, tk)

cat("phi1 values:", round(phi1, 4), "\n")

res_rcs3 <- rma(dat_mr$yi, dat_mr$vi,
                mods = ~ ablat_vals + phi1,
                method = "REML")
cat("beta  =", round(coef(res_rcs3), 10), "\n")
cat("se    =", round(sqrt(diag(vcov(res_rcs3))), 10), "\n")
cat("tau2  =", round(res_rcs3$tau2, 7), "\n")
cat("QE    =", round(res_rcs3$QE,   6), "df =", res_rcs3$QEdf, "p =", round(res_rcs3$QEp, 6), "\n")
cat("QM    =", round(res_rcs3$QM,   6), "df =", res_rcs3$QMdf, "p =", round(res_rcs3$QMp, 6), "\n")
cat("I2    =", round(res_rcs3$I2,   4), "\n")
cat("R2    =", round(res_rcs3$R2,   4), "\n")
cat("logLik=", round(as.numeric(logLik(res_rcs3)), 7), "\n")
cat("AIC   =", round(AIC(res_rcs3), 7), "\n")
cat("BIC   =", round(BIC(res_rcs3), 7), "\n")
# Expected (JS): beta≈[-0.2099,-0.0029,-0.0000264]; tau2≈0.0766; QE≈27.99; QM≈17.95

## LS-A: BCG data, intercept-only scale — rma(yi, vi, scale = ~ 1, method="ML")
cat("\n## LS-A: BCG data, intercept-only scale\n")
yi_bcg <- c(-0.8893113339202054,-1.5853886572014306,-1.348073148299693,
            -1.4415511900213054,-0.2175473222112957,-0.786115585818864,
            -1.6208982235983924,0.011952333523841173,-0.4694176487381487,
            -1.3713448034727846,-0.33935882833839015,0.4459134005713783,
            -0.017313948216879493)
vi_bcg <- c(0.3255847650039614,0.19458112139814387,0.41536796536796533,
            0.020010031902247573,0.05121017216963086,0.0069056184559087574,
            0.22301724757231517,0.00396157929781773,0.056434210463248966,
            0.07302479361302891,0.01241221397155972,0.5325058452001528,
            0.0714046596839863)
ablat <- c(44,55,42,52,13,44,19,13,27,42,18,33,33)
k <- length(yi_bcg)
res0 <- rma(yi_bcg, vi_bcg, scale = ~ 1, method="ML")
cat("beta =", round(res0$b, 7), "\n")
cat("alpha=", round(res0$alpha, 7), "\n")
cat("se_beta =", round(res0$se, 7), "\n")
cat("se_alpha=", round(res0$se.alpha, 7), "\n")
cat("tau2 =", round(mean(res0$tau2), 7), "\n")
cat("LL-const=", round(as.numeric(logLik(res0))+k/2*log(2*pi), 7), "\n")
BENCH[["LS-A"]] <- list(beta=round(as.vector(res0$b),7), gamma=round(as.vector(res0$alpha),7), se_beta=round(as.vector(res0$se),7), se_gamma=round(as.vector(res0$se.alpha),7), tau2_mean=round(mean(res0$tau2),7))

## LS-B: BCG data, ablat scale — rma(yi, vi, scale = ~ ablat, method="ML")
cat("\n## LS-B: BCG data, ablat scale\n")
res1 <- rma(yi_bcg, vi_bcg, scale = ~ ablat, method="ML")
cat("beta =", round(res1$b, 7), "\n")
cat("alpha=", round(res1$alpha, 7), "\n")
cat("se_beta =", round(res1$se, 7), "\n")
cat("se_alpha=", round(res1$se.alpha, 7), "\n")
cat("tau2_i =", round(res1$tau2, 6), "\n")
cat("QS =", round(res1$QS, 7), "df=", res1$QSdf, "p=", round(res1$QSp, 7), "\n")
cat("LL-const=", round(as.numeric(logLik(res1))+k/2*log(2*pi), 7), "\n")
BENCH[["LS-B"]] <- list(beta=round(as.vector(res1$b),7), gamma=round(as.vector(res1$alpha),7), se_beta=round(as.vector(res1$se),7), se_gamma=round(as.vector(res1$se.alpha),7))

## LS-C: BCG data, ablat location + ablat scale — rma(yi, vi, mods=~ablat, scale=~ablat, method="ML")
cat("\n## LS-C: BCG data, ablat location + ablat scale\n")
res2 <- rma(yi_bcg, vi_bcg, mods = ~ ablat, scale = ~ ablat, method="ML")
cat("beta =", round(res2$b, 7), "\n")
cat("alpha=", round(res2$alpha, 7), "\n")
cat("se_beta =", round(res2$se, 7), "\n")
cat("se_alpha=", round(res2$se.alpha, 7), "\n")
cat("tau2_i =", round(res2$tau2, 6), "\n")
cat("QE =", round(res2$QE, 6), "p=", round(res2$QEp, 6), "\n")
cat("QM =", round(res2$QM, 7), "df=", res2$QMdf, "p=", round(res2$QMp, 7), "\n")
cat("QS =", round(res2$QS, 7), "df=", res2$QSdf, "p=", round(res2$QSp, 7), "\n")
cat("LL-const=", round(as.numeric(logLik(res2))+k/2*log(2*pi), 7), "\n")
BENCH[["LS-C"]] <- list(beta=round(as.vector(res2$b),7), gamma=round(as.vector(res2$alpha),7), se_beta=round(as.vector(res2$se),7), se_gamma=round(as.vector(res2$se.alpha),7))

## AS-1 — BCG Vaccine (dat.bcg, DL)
{
  library(metafor)
  dat <- dat.bcg
  res <- escalc("AS", ai=dat$tpos, bi=dat$tneg, ci=dat$cpos, di=dat$cneg, data=dat)
  m_DL <- rma(yi, vi, data=res, method="DL")
  m_FE <- rma(yi, vi, data=res, method="FE")
  cat("=== AS-1 (DL) ===\n")
  cat("yi:", paste(round(res$yi, 5), collapse=", "), "\n")
  cat("vi:", paste(round(res$vi, 7), collapse=", "), "\n")
  cat("FE:", round(m_FE$b, 5), "\n")
  cat("RE:", round(m_DL$b, 5), "\n")
  cat("tau2:", round(m_DL$tau2, 6), "\n")
  cat("I2:", round(m_DL$I2, 2), "\n")
}

## AS-2 — BCG Vaccine (dat.bcg, REML)
{
  library(metafor)
  dat <- dat.bcg
  res <- escalc("AS", ai=dat$tpos, bi=dat$tneg, ci=dat$cpos, di=dat$cneg, data=dat)
  m_REML <- rma(yi, vi, data=res, method="REML")
  m_FE   <- rma(yi, vi, data=res, method="FE")
  cat("=== AS-2 (REML) ===\n")
  cat("FE:", round(m_FE$b,    5), "\n")
  cat("RE:", round(m_REML$b,  5), "\n")
  cat("tau2:", round(m_REML$tau2, 6), "\n")
  cat("I2 (tau2-based):", round(m_REML$I2, 2), "\n")
}

## UCOR-1 — Bias-corrected correlation (DL)
{
  library(metafor)
  dat <- data.frame(ri=c(0.45,0.56,0.38,0.61,0.42), ni=c(62,90,45,120,75))
  res  <- escalc("UCOR", ri=dat$ri, ni=dat$ni, data=dat)
  m_DL <- rma(yi, vi, data=res, method="DL")
  m_FE <- rma(yi, vi, data=res, method="FE")
  cat("=== UCOR-1 (DL) ===\n")
  cat("yi:", paste(round(res$yi,6), collapse=", "), "\n")
  cat("vi:", paste(round(res$vi,6), collapse=", "), "\n")
  cat("FE:", round(m_FE$b, 5), "\n")
  cat("RE:", round(m_DL$b, 5), "\n")
  cat("tau2:", round(m_DL$tau2, 6), "\n")
  cat("I2:", round(m_DL$I2, 2), "\n")
  BENCH[["UCOR-1"]] <- list(
    FE   = round(as.numeric(m_FE$b), 7),
    RE   = round(as.numeric(m_DL$b), 7),
    tau2 = round(m_DL$tau2,          7),
    I2   = round(m_DL$I2,            5),
    yi   = round(as.vector(res$yi),  7)
  )
}

## UCOR-2 — Bias-corrected correlation (REML)
{
  library(metafor)
  dat <- data.frame(ri=c(0.45,0.56,0.38,0.61,0.42), ni=c(62,90,45,120,75))
  res    <- escalc("UCOR", ri=dat$ri, ni=dat$ni, data=dat)
  m_REML <- rma(yi, vi, data=res, method="REML")
  m_FE   <- rma(yi, vi, data=res, method="FE")
  cat("=== UCOR-2 (REML) ===\n")
  cat("FE:", round(m_FE$b,    5), "\n")
  cat("RE:", round(m_REML$b,  5), "\n")
  cat("tau2:", round(m_REML$tau2, 6), "\n")
  cat("I2 (tau2-based):", round(m_REML$I2, 3), "\n")
  BENCH[["UCOR-2"]] <- list(
    FE   = round(as.numeric(m_FE$b),   7),
    RE   = round(as.numeric(m_REML$b), 7),
    tau2 = round(m_REML$tau2,          7),
    I2   = round(m_REML$I2,            5)
  )
}

## IRD-1 — Incidence Rate Difference (DL)
{
  library(metafor)
  x1 <- c(5, 40, 2, 60, 8, 100); t1 <- c(200, 1000, 100, 2000, 300, 5000)
  x2 <- c(20, 30, 15, 40, 3, 50); t2 <- c(200, 1000, 100, 2000, 300, 5000)
  res  <- escalc("IRD", x1i=x1, x2i=x2, t1i=t1, t2i=t2)
  m_FE <- rma(yi, vi, data=res, method="FE")
  m_DL <- rma(yi, vi, data=res, method="DL")
  cat("=== IRD-1 (DL) ===\n")
  cat("yi:", paste(round(res$yi, 7), collapse=", "), "\n")
  cat("vi:", paste(signif(res$vi, 10), collapse=", "), "\n")
  cat("FE:", round(m_FE$b, 8), "\n")
  cat("RE:", round(m_DL$b, 8), "\n")
  cat("tau2:", round(m_DL$tau2, 10), "\n")
  cat("I2:", round(m_DL$I2, 4), "\n")
  BENCH[["IRD-1"]] <- list(
    FE   = round(as.numeric(m_FE$b), 7),
    RE   = round(as.numeric(m_DL$b), 7),
    tau2 = round(m_DL$tau2,          7),
    I2   = round(m_DL$I2,            5),
    yi   = round(as.vector(res$yi),  7)
  )
}

## IRD-2 — Incidence Rate Difference (REML)
{
  library(metafor)
  x1 <- c(5, 40, 2, 60, 8, 100); t1 <- c(200, 1000, 100, 2000, 300, 5000)
  x2 <- c(20, 30, 15, 40, 3, 50); t2 <- c(200, 1000, 100, 2000, 300, 5000)
  res    <- escalc("IRD", x1i=x1, x2i=x2, t1i=t1, t2i=t2)
  m_REML <- rma(yi, vi, data=res, method="REML")
  m_FE   <- rma(yi, vi, data=res, method="FE")
  cat("=== IRD-2 (REML) ===\n")
  cat("RE:", round(m_REML$b, 8), "\n")
  cat("tau2:", round(m_REML$tau2, 10), "\n")
  cat("I2 (tau2-based):", round(m_REML$I2, 4), "\n")
  cat("I2 (Q-based, JS):", round(max(0,(m_REML$QE-(m_REML$k-1))/m_REML$QE)*100, 4), "\n")
  BENCH[["IRD-2"]] <- list(
    FE   = round(as.numeric(m_FE$b),   7),
    RE   = round(as.numeric(m_REML$b), 7),
    tau2 = round(m_REML$tau2,          7),
    I2   = round(m_REML$I2,            5)
  )
}

## IRSD-1 — Sqrt incidence rate difference (DL)
{
  library(metafor)
  x1 <- c(5, 40, 2, 60, 8, 100); t1 <- c(200, 1000, 100, 2000, 300, 5000)
  x2 <- c(20, 30, 15, 40, 3, 50); t2 <- c(200, 1000, 100, 2000, 300, 5000)
  res  <- escalc("IRSD", x1i=x1, x2i=x2, t1i=t1, t2i=t2)
  m_FE <- rma(yi, vi, data=res, method="FE")
  m_DL <- rma(yi, vi, data=res, method="DL")
  cat("=== IRSD-1 (DL) ===\n")
  cat("yi:", paste(round(res$yi, 7), collapse=", "), "\n")
  cat("vi:", paste(signif(res$vi, 10), collapse=", "), "\n")
  cat("FE:", round(m_FE$b, 8), "\n")
  cat("RE:", round(m_DL$b, 8), "\n")
  cat("tau2:", round(m_DL$tau2, 10), "\n")
  cat("I2:", round(m_DL$I2, 4), "\n")
  BENCH[["IRSD-1"]] <- list(
    FE   = round(as.numeric(m_FE$b), 7),
    RE   = round(as.numeric(m_DL$b), 7),
    tau2 = round(m_DL$tau2,          7),
    I2   = round(m_DL$I2,            5),
    yi   = round(as.vector(res$yi),  7)
  )
}

## IRSD-2 — Sqrt incidence rate difference (REML)
{
  library(metafor)
  x1 <- c(5, 40, 2, 60, 8, 100); t1 <- c(200, 1000, 100, 2000, 300, 5000)
  x2 <- c(20, 30, 15, 40, 3, 50); t2 <- c(200, 1000, 100, 2000, 300, 5000)
  res    <- escalc("IRSD", x1i=x1, x2i=x2, t1i=t1, t2i=t2)
  m_REML <- rma(yi, vi, data=res, method="REML")
  m_FE   <- rma(yi, vi, data=res, method="FE")
  cat("=== IRSD-2 (REML) ===\n")
  cat("RE:", round(m_REML$b, 8), "\n")
  cat("tau2:", round(m_REML$tau2, 8), "\n")
  cat("I2 (tau2-based):", round(m_REML$I2, 4), "\n")
  cat("I2 (Q-based, JS):", round(max(0,(m_REML$QE-(m_REML$k-1))/m_REML$QE)*100, 4), "\n")
  BENCH[["IRSD-2"]] <- list(
    FE   = round(as.numeric(m_FE$b),   7),
    RE   = round(as.numeric(m_REML$b), 7),
    tau2 = round(m_REML$tau2,          7),
    I2   = round(m_REML$I2,            5)
  )
}

## YUQ-1 — Yule's Q (DL)
{
  library(metafor)
  dat <- dat.bcg[1:5, ]
  res    <- escalc("YUQ", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat)
  m_FE   <- rma(yi, vi, data=res, method="FE")
  m_DL   <- rma(yi, vi, data=res, method="DL")
  cat("=== YUQ-1 (DL) ===\n")
  cat("yi:", round(res$yi, 8), "\n")
  cat("vi:", round(res$vi, 10), "\n")
  cat("FE:", round(m_FE$b, 6), "\n")
  cat("RE:", round(m_DL$b, 6), "\n")
  cat("tau2:", round(m_DL$tau2, 8), "\n")
  cat("I2:", round(m_DL$I2, 4), "\n")
  BENCH[["YUQ-1"]] <- list(
    FE   = round(as.numeric(m_FE$b), 7),
    RE   = round(as.numeric(m_DL$b), 7),
    tau2 = round(m_DL$tau2,          7),
    I2   = round(m_DL$I2,            5),
    yi   = round(as.vector(res$yi),  7)
  )
}

## YUQ-2 — Yule's Q (REML)
{
  library(metafor)
  dat <- dat.bcg[1:5, ]
  res    <- escalc("YUQ", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat)
  m_REML <- rma(yi, vi, data=res, method="REML")
  m_FE   <- rma(yi, vi, data=res, method="FE")
  cat("=== YUQ-2 (REML) ===\n")
  cat("RE:", round(m_REML$b, 8), "\n")
  cat("tau2:", round(m_REML$tau2, 8), "\n")
  cat("I2 (tau2-based):", round(m_REML$I2, 4), "\n")
  cat("I2 (Q-based, JS):", round(max(0,(m_REML$QE-(m_REML$k-1))/m_REML$QE)*100, 4), "\n")
  BENCH[["YUQ-2"]] <- list(
    FE   = round(as.numeric(m_FE$b),   7),
    RE   = round(as.numeric(m_REML$b), 7),
    tau2 = round(m_REML$tau2,          7),
    I2   = round(m_REML$I2,            5)
  )
}

## YUY-1 — Yule's Y (DL)
{
  library(metafor)
  dat <- dat.bcg[1:5, ]
  res    <- escalc("YUY", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat)
  m_FE   <- rma(yi, vi, data=res, method="FE")
  m_DL   <- rma(yi, vi, data=res, method="DL")
  cat("=== YUY-1 (DL) ===\n")
  cat("yi:", round(res$yi, 8), "\n")
  cat("vi:", round(res$vi, 10), "\n")
  cat("FE:", round(m_FE$b, 6), "\n")
  cat("RE:", round(m_DL$b, 6), "\n")
  cat("tau2:", round(m_DL$tau2, 8), "\n")
  cat("I2:", round(m_DL$I2, 4), "\n")
  BENCH[["YUY-1"]] <- list(
    FE   = round(as.numeric(m_FE$b), 7),
    RE   = round(as.numeric(m_DL$b), 7),
    tau2 = round(m_DL$tau2,          7),
    I2   = round(m_DL$I2,            5),
    yi   = round(as.vector(res$yi),  7)
  )
}

## YUY-2 — Yule's Y (REML)
{
  library(metafor)
  dat <- dat.bcg[1:5, ]
  res    <- escalc("YUY", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat)
  m_REML <- rma(yi, vi, data=res, method="REML")
  m_FE   <- rma(yi, vi, data=res, method="FE")
  cat("=== YUY-2 (REML) ===\n")
  cat("RE:", round(m_REML$b, 8), "\n")
  cat("tau2:", round(m_REML$tau2, 8), "\n")
  cat("I2 (tau2-based):", round(m_REML$I2, 4), "\n")
  cat("I2 (Q-based, JS):", round(max(0,(m_REML$QE-(m_REML$k-1))/m_REML$QE)*100, 4), "\n")
  BENCH[["YUY-2"]] <- list(
    FE   = round(as.numeric(m_FE$b),   7),
    RE   = round(as.numeric(m_REML$b), 7),
    tau2 = round(m_REML$tau2,          7),
    I2   = round(m_REML$I2,            5)
  )
}

## SMD1-1 — One-sample SMD (DL)
{
  library(metafor)
  m   <- c(2.0, 1.0, 3.5, 1.5, 4.0)
  sd  <- c(1.0, 1.5, 1.2, 2.0, 1.0)
  n   <- c(30, 25, 40, 35, 20)
  # escalc("SMD1") broken in newer metafor; compute directly (matches JS formula)
  df <- n - 1
  J  <- 1 - 3 / (4*df - 1)
  yi <- (m / sd) * J
  vi <- 1/n + yi^2 / (2*df)
  res    <- data.frame(yi=yi, vi=vi)
  m_FE   <- rma(yi, vi, data=res, method="FE")
  m_DL   <- rma(yi, vi, data=res, method="DL")
  cat("=== SMD1-1 (DL) ===\n")
  cat("yi:", round(res$yi, 6), "\n")
  cat("vi:", round(res$vi, 5), "\n")
  cat("FE:", round(m_FE$b, 3), "\n")
  cat("RE:", round(m_DL$b, 3), "\n")
  cat("tau2:", round(m_DL$tau2, 3), "\n")
  cat("I2:", round(m_DL$I2, 2), "\n")
}

## SMD1-2 — One-sample SMD (REML)
{
  library(metafor)
  m   <- c(2.0, 1.0, 3.5, 1.5, 4.0)
  sd  <- c(1.0, 1.5, 1.2, 2.0, 1.0)
  n   <- c(30, 25, 40, 35, 20)
  df <- n - 1
  J  <- 1 - 3 / (4*df - 1)
  yi <- (m / sd) * J
  vi <- 1/n + yi^2 / (2*df)
  res    <- data.frame(yi=yi, vi=vi)
  m_REML <- rma(yi, vi, data=res, method="REML")
  cat("=== SMD1-2 (REML) ===\n")
  cat("RE:", round(m_REML$b, 3), "\n")
  cat("tau2:", round(m_REML$tau2, 3), "\n")
  cat("I2:", round(m_REML$I2, 2), "\n")
}

## SMD1H-1 — One-sample SMD heteroscedastic (DL)
{
  library(metafor)
  m   <- c(2.0, 1.0, 3.5, 1.5, 4.0)
  sd  <- c(1.0, 1.5, 1.2, 2.0, 1.0)
  n   <- c(30, 25, 40, 35, 20)
  # escalc("SMD1H") broken in newer metafor; compute directly (matches JS formula)
  df <- n - 1
  J  <- 1 - 3 / (4*df - 1)
  d  <- m / sd
  yi <- d * J
  vi <- J^2 * (1/n + d^2 / (2*df))
  res    <- data.frame(yi=yi, vi=vi)
  m_FE   <- rma(yi, vi, data=res, method="FE")
  m_DL   <- rma(yi, vi, data=res, method="DL")
  cat("=== SMD1H-1 (DL) ===\n")
  cat("yi:", round(res$yi, 6), "\n")
  cat("vi:", round(res$vi, 5), "\n")
  cat("FE:", round(m_FE$b, 3), "\n")
  cat("RE:", round(m_DL$b, 3), "\n")
  cat("tau2:", round(m_DL$tau2, 3), "\n")
  cat("I2:", round(m_DL$I2, 2), "\n")
}

## SMD1H-2 — One-sample SMD heteroscedastic (REML)
{
  library(metafor)
  m   <- c(2.0, 1.0, 3.5, 1.5, 4.0)
  sd  <- c(1.0, 1.5, 1.2, 2.0, 1.0)
  n   <- c(30, 25, 40, 35, 20)
  df <- n - 1
  J  <- 1 - 3 / (4*df - 1)
  d  <- m / sd
  yi <- d * J
  vi <- J^2 * (1/n + d^2 / (2*df))
  res    <- data.frame(yi=yi, vi=vi)
  m_REML <- rma(yi, vi, data=res, method="REML")
  cat("=== SMD1H-2 (REML) ===\n")
  cat("RE:", round(m_REML$b, 3), "\n")
  cat("tau2:", round(m_REML$tau2, 3), "\n")
  cat("I2:", round(m_REML$I2, 2), "\n")
}

## MR-D — BCG year + ablat (ML) with LRT per moderator
{
  library(metafor)
  dat <- escalc("RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
  # Full model (ML)
  res_full  <- rma(yi ~ year + ablat, vi, data=dat, method="ML")
  # Reduced models for LRT
  res_red_year  <- rma(yi ~ ablat, vi, data=dat, method="ML")
  res_red_ablat <- rma(yi ~ year,  vi, data=dat, method="ML")
  cat("=== MR-D ML (year + ablat) ===\n")
  cat("beta:", round(coef(res_full), 4), "\n")
  cat("se:  ", round(sqrt(diag(vcov(res_full))), 4), "\n")
  cat("tau2:", round(res_full$tau2, 6), "\n")
  cat("QE:", round(res_full$QE, 4), "df:", res_full$QEdf, "p:", round(res_full$QEp, 4), "\n")
  cat("QM:", round(res_full$QM, 4), "df:", res_full$QMdf, "p:", round(res_full$QMp, 6), "\n")
  cat("I2:", round(res_full$I2, 4), "R2:", round(res_full$R2, 4), "\n")
  cat("LL:", round(logLik(res_full), 6), "AIC:", round(AIC(res_full), 6), "BIC:", round(BIC(res_full), 6), "\n")
  cat("Wald year: "); print(anova(res_full, btt=2))
  cat("Wald ablat:"); print(anova(res_full, btt=3))
  lrt_year_stat  <- as.numeric(-2 * (logLik(res_red_year)  - logLik(res_full)))
  lrt_ablat_stat <- as.numeric(-2 * (logLik(res_red_ablat) - logLik(res_full)))
  cat("LRT year:  LRT=", round(lrt_year_stat,  6), "df=", 1, "p=", round(pchisq(lrt_year_stat,  1, lower.tail=FALSE), 6), "\n")
  cat("LRT ablat: LRT=", round(lrt_ablat_stat, 6), "df=", 1, "p=", round(pchisq(lrt_ablat_stat, 1, lower.tail=FALSE), 6), "\n")
}

## HC-1 — Henmi-Copas CI: BCG Vaccine log-OR (dat.bcg, 13 studies)
## Verifies PUB_BIAS_BENCHMARKS entry: hc.beta, hc.tau2, hc.t0, hc.ci[0], hc.ci[1]
{
  library(metafor)
  dat <- dat.bcg
  res_or <- rma(ai=tpos, bi=tneg, ci=cpos, di=cneg, measure="OR",
                data=dat, method="DL")
  hc_res <- hc(res_or)
  cat("=== HC-1 (BCG OR, DL) ===\n")
  cat("beta:", round(hc_res$beta, 4), "\n")
  cat("se:  ", round(hc_res$se,   4), "\n")
  cat("ci.lb:", round(hc_res$ci.lb, 4), "\n")
  cat("ci.ub:", round(hc_res$ci.ub, 4), "\n")
  cat("tau2:", round(hc_res$tau2, 4), "\n")
  BENCH[["PB"]]$hc <- list(
    beta = round(as.numeric(hc_res$beta), 4),
    tau2 = round(hc_res$tau2, 4),
    ciLb = round(hc_res$ci.lb, 4),
    ciUb = round(hc_res$ci.ub, 4)
  )
}

## HC-2 — Henmi-Copas CI: Synthetic asymmetric funnel (k=6)
## Verifies second PUB_BIAS_BENCHMARKS entry hc fields
{
  library(metafor)
  yi <- c(-0.1, 0.3, 0.1, 0.9, 1.4, 0.5)
  vi <- c(0.04, 0.09, 0.0225, 0.36, 0.64, 0.16)
  res <- rma(yi, vi, method="DL")
  hc_res <- hc(res)
  cat("=== HC-2 (Synthetic asymmetric funnel) ===\n")
  cat("beta:", round(hc_res$beta, 4), "\n")
  cat("se:  ", round(hc_res$se,   4), "\n")
  cat("ci.lb:", round(hc_res$ci.lb, 4), "\n")
  cat("ci.ub:", round(hc_res$ci.ub, 4), "\n")
  cat("tau2:", round(hc_res$tau2, 4), "\n")
  BENCH[["PB-synth"]]$hc <- list(
    beta = round(as.numeric(hc_res$beta), 4),
    tau2 = round(hc_res$tau2, 4),
    ciLb = round(hc_res$ci.lb, 4),
    ciUb = round(hc_res$ci.ub, 4)
  )
}

## WAAP-1 — WAAP-WLS: BCG Vaccine log-OR (dat.bcg, 13 studies)
## Verifies PUB_BIAS_BENCHMARKS BCG entry: waap.wlsEstimate, waap.kAdequate, waap.estimate, waap.se, waap.z, waap.ci
## Stanley & Doucouliagos (2015): WLS on studies with power >= 80% vs |theta_wls|; fallback to full WLS if none qualify.
{
  library(metafor)
  dat <- dat.bcg
  # Compute log OR + variance for each study
  res_or <- rma(ai=tpos, bi=tneg, ci=cpos, di=cneg, measure="OR", data=dat, method="DL")
  yi <- res_or$yi
  vi <- res_or$vi
  k  <- length(yi)

  # WLS (= FE) estimate
  W       <- sum(1 / vi)
  wls_est <- sum(yi / vi) / W
  cat("=== WAAP-1 (BCG OR, DL) ===\n")
  cat("wlsEstimate:", round(wls_est, 4), "\n")

  # Power for each study at wls_est
  z975  <- qnorm(0.975)
  ncp   <- abs(wls_est) / sqrt(vi)
  power <- pnorm(ncp - z975) + pnorm(-z975 - ncp)
  adequate <- which(power >= 0.80)
  cat("kAdequate:", length(adequate), "\n")
  cat("Adequate studies:", paste(dat$author[adequate], collapse=", "), "\n")

  # WAAP on adequate subset (or full set if none qualify)
  subset <- if (length(adequate) > 0) adequate else seq_along(yi)
  fallback <- length(adequate) == 0
  Wa   <- sum(1 / vi[subset])
  waap <- sum(yi[subset] / vi[subset]) / Wa
  se   <- sqrt(1 / Wa)
  z    <- waap / se
  p    <- 2 * (1 - pnorm(abs(z)))
  ci_lb <- waap - z975 * se
  ci_ub <- waap + z975 * se
  cat("fallback:", fallback, "\n")
  cat("estimate:", round(waap, 4), "\n")
  cat("se:      ", round(se, 4), "\n")
  cat("z:       ", round(z, 4), "\n")
  cat("p:       ", round(p, 6), "\n")
  cat("ci.lb:   ", round(ci_lb, 4), "\n")
  cat("ci.ub:   ", round(ci_ub, 4), "\n")
  BENCH[["PB"]]$waap <- list(
    wlsEstimate = round(wls_est, 4),
    kAdequate   = as.integer(length(adequate)),
    estimate    = round(waap, 4),
    se          = round(se, 4),
    z           = round(z, 4),
    fallback    = fallback
  )
}

## WAAP-2 — WAAP-WLS: Synthetic asymmetric funnel (k=6)
## Verifies second PUB_BIAS_BENCHMARKS entry: waap fields. All studies underpowered → fallback.
{
  yi <- c(-0.1, 0.3, 0.1, 0.9, 1.4, 0.5)
  vi <- c(0.04, 0.09, 0.0225, 0.36, 0.64, 0.16)
  k  <- length(yi)

  z975    <- qnorm(0.975)
  W       <- sum(1 / vi)
  wls_est <- sum(yi / vi) / W
  ncp     <- abs(wls_est) / sqrt(vi)
  power   <- pnorm(ncp - z975) + pnorm(-z975 - ncp)
  adequate <- which(power >= 0.80)

  subset   <- if (length(adequate) > 0) adequate else seq_along(yi)
  fallback <- length(adequate) == 0
  Wa   <- sum(1 / vi[subset])
  waap <- sum(yi[subset] / vi[subset]) / Wa
  se   <- sqrt(1 / Wa)
  z    <- waap / se
  p    <- 2 * (1 - pnorm(abs(z)))
  ci_lb <- waap - z975 * se
  ci_ub <- waap + z975 * se

  cat("=== WAAP-2 (Synthetic asymmetric funnel) ===\n")
  cat("wlsEstimate:", round(wls_est, 4), "\n")
  cat("kAdequate:", length(adequate), "\n")
  cat("fallback:", fallback, "\n")
  cat("estimate:", round(waap, 4), "\n")
  cat("se:      ", round(se, 4), "\n")
  cat("z:       ", round(z, 4), "\n")
  cat("p:       ", round(p, 4), "\n")
  cat("ci.lb:   ", round(ci_lb, 4), "\n")
  cat("ci.ub:   ", round(ci_ub, 4), "\n")
  BENCH[["PB-synth"]]$waap <- list(
    wlsEstimate = round(wls_est, 4),
    kAdequate   = as.integer(length(adequate)),
    estimate    = round(waap, 4),
    se          = round(se, 4),
    z           = round(z, 4),
    fallback    = fallback
  )
}

## EB-1 — Empirical Bayes: BCG Vaccine log-RR (GENERIC benchmark data)
## Verifies tau2, RE for the EB tauMethod benchmark entry.
## EB update: adj = (Q_RE * k/(k-1) - k) / W; same fixed point as PM (Q = k-1).
## Morris (1983).
{
  library(metafor)
  yi <- c(-0.8893113339202054, -1.5853886572014306, -1.348073148299693,
          -1.4415511900213054, -0.2175473222112957, -0.786115585818864,
          -1.6208982235983924,  0.011952333523841173, -0.4694176487381487,
          -1.3713448034727846, -0.33935882833839015,  0.4459134005713783,
          -0.017313948216879493)
  vi <- c(0.3255847650039614, 0.19458112139814387, 0.41536796536796533,
          0.020010031902247573, 0.05121017216963086, 0.0069056184559087574,
          0.22301724757231517, 0.00396157929781773, 0.056434210463248966,
          0.07302479361302891, 0.01241221397155972, 0.5325058452001528,
          0.0714046596839863)
  res <- rma(yi, vi, method="EB")
  cat("=== EB-1 (BCG log RR, EB) ===\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  cat("RE:  ", round(res$b[1], 6), "\n")
}

## PMM-1 — Paule-Mandel Median: BCG Vaccine log-RR (GENERIC benchmark data)
## Verifies tau2, RE, for the PMM tauMethod benchmark entry.
## PMM finds tau2 where Q(tau2) = qchisq(0.5, k-1) via uniroot.
{
  library(metafor)
  yi <- c(-0.8893113339202054, -1.5853886572014306, -1.348073148299693,
          -1.4415511900213054, -0.2175473222112957, -0.786115585818864,
          -1.6208982235983924,  0.011952333523841173, -0.4694176487381487,
          -1.3713448034727846, -0.33935882833839015,  0.4459134005713783,
          -0.017313948216879493)
  vi <- c(0.3255847650039614, 0.19458112139814387, 0.41536796536796533,
          0.020010031902247573, 0.05121017216963086, 0.0069056184559087574,
          0.22301724757231517, 0.00396157929781773, 0.056434210463248966,
          0.07302479361302891, 0.01241221397155972, 0.5325058452001528,
          0.0714046596839863)
  res <- rma(yi, vi, method="PMM")
  cat("=== PMM-1 (BCG log RR, PMM) ===\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  cat("RE:  ", round(res$b[1], 6), "\n")
  cat("I2:  ", round(res$I2,   4), "(app uses FE-Q-based I2, not tau2-based)\n")
}

## GENQM-1 — Generalised Q Median: BCG Vaccine log-RR (GENERIC benchmark data)
## Verifies tau2 for the GENQM tauMethod benchmark entry.
## GENQM(w=1/vi) finds tau2 where P(Q_FE <= Q_FE_obs | tau2) = 0.5 using the
## exact Farebrother CDF; JS uses a 2-moment chi-sq approximation (~3% error).
## The expected tau2 = exact R value; JS result passes the 5%-relative tolerance.
## Note: metafor GENQM uses FE weights for the pooled estimate; the app uses
## RE weights (1/(vi+tau2)) — expected RE in the benchmark is the app's value.
## AUDITED: confirmed app uses RE weights for estimate; GENQM FE-pool is reference only (2026-05-30); see benchmark-data.md §"GENQM".
{
  library(metafor)
  yi <- c(-0.8893113339202054, -1.5853886572014306, -1.348073148299693,
          -1.4415511900213054, -0.2175473222112957, -0.786115585818864,
          -1.6208982235983924,  0.011952333523841173, -0.4694176487381487,
          -1.3713448034727846, -0.33935882833839015,  0.4459134005713783,
          -0.017313948216879493)
  vi <- c(0.3255847650039614, 0.19458112139814387, 0.41536796536796533,
          0.020010031902247573, 0.05121017216963086, 0.0069056184559087574,
          0.22301724757231517, 0.00396157929781773, 0.056434210463248966,
          0.07302479361302891, 0.01241221397155972, 0.5325058452001528,
          0.0714046596839863)
  res <- rma(yi, vi, method="GENQM", weights=1/vi)
  cat("=== GENQM-1 (BCG log RR, GENQM w=1/vi) ===\n")
  cat("tau2 (exact):", round(res$tau2, 6), "\n")
  # RE estimate using app convention: RE weights 1/(vi+tau2)
  wi_re <- 1/(vi + res$tau2)
  RE_app <- sum(wi_re * yi) / sum(wi_re)
  cat("RE (app conv, 1/(vi+tau2) weights):", round(RE_app, 6), "\n")
  cat("RE (metafor, FE weights):           ", round(res$b[1], 6), "\n")
}

## RPB-1 — Point-Biserial Correlation: 5 synthetic studies, equal groups (DL)
## Verifies yi = r_pb, vi = (1-r^2)^3/(n-2) + r^2*(1-r^2)^2/(2n)  [Kraemer 1975 "ST"]
## tau2=0 (Q < df for this dataset).
{
  library(metafor)
  m1 <- c(55, 40, 70, 62, 48); sd1 <- c(10, 12, 15, 11, 9); n1 <- c(30, 25, 40, 35, 20)
  m2 <- c(45, 35, 60, 50, 40); sd2 <- c(11, 10, 14, 12, 10); n2 <- c(30, 25, 40, 35, 20)
  esc <- escalc(measure="RPB", m1i=m1, sd1i=sd1, n1i=n1, m2i=m2, sd2i=sd2, n2i=n2)
  res <- rma(yi, vi, data=esc, method="DL")
  cat("=== RPB-1 (5 studies, equal groups, DL) ===\n")
  cat("r_pb:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:  ", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res$b[1], 6), "\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  Q <- res$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
}

## RPB-2 — Point-Biserial Correlation: heterogeneous (REML, tau2>0)
## Low r in large-n studies, high r in small-n; equal groups (n1=n2).
## tau2=0.038 (REML), I2≈84.6%.
{
  library(metafor)
  n <- c(300, 250, 50, 40, 45); sd_val <- 10; m2_val <- 50
  r_target <- c(0.10, 0.12, 0.55, 0.60, 0.50)
  m1 <- m2_val + 2*r_target*sd_val  # d = 2*r_pb for equal groups
  n1 <- n/2; n2 <- n/2
  esc <- escalc(measure="RPB", m1i=m1, sd1i=rep(sd_val,5), n1i=n1,
    m2i=rep(m2_val,5), sd2i=rep(sd_val,5), n2i=n2)
  res <- rma(yi, vi, data=esc, method="REML")
  cat("=== RPB-2 (heterogeneous, REML) ===\n")
  cat("r_pb:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:  ", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res$b[1], 6), "\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  Q <- res$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
}

## RBIS-1 — Biserial Correlation: 5 synthetic studies, equal groups p=0.5 (DL)
## Same data as RPB-1. For p=0.5: z=0, phi(0)=1/sqrt(2*pi)≈0.3989, factor≈1.2533.
## tau2=0.
{
  library(metafor)
  m1 <- c(55, 40, 70, 62, 48); sd1 <- c(10, 12, 15, 11, 9); n1 <- c(30, 25, 40, 35, 20)
  m2 <- c(45, 35, 60, 50, 40); sd2 <- c(11, 10, 14, 12, 10); n2 <- c(30, 25, 40, 35, 20)
  esc <- escalc(measure="RBIS", m1i=m1, sd1i=sd1, n1i=n1, m2i=m2, sd2i=sd2, n2i=n2)
  res <- rma(yi, vi, data=esc, method="DL")
  cat("=== RBIS-1 (5 studies, equal groups p=0.5, DL) ===\n")
  cat("r_bis:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:   ", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res$b[1], 6), "\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  Q <- res$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
}

## RBIS-2 — Biserial Correlation: heterogeneous (REML), unequal groups (~1:2 ratio)
## Same underlying effects as RPB-2 (m1, m2, sd) but n1≈n/3, n2≈2n/3.
## p1≈1/3 → z=qnorm(2/3)≈0.431, phi≈0.365, factor≈1.297.
## tau2≈0.059 (REML), I2≈83.3%.
{
  library(metafor)
  n <- c(300, 250, 50, 40, 45); sd_val <- 10; m2_val <- 50
  r_target <- c(0.10, 0.12, 0.55, 0.60, 0.50)
  m1_base <- m2_val + 2*r_target*sd_val
  n1 <- round(n/3); n2 <- n - n1
  esc <- escalc(measure="RBIS", m1i=m1_base, sd1i=rep(sd_val,5), n1i=n1,
    m2i=rep(m2_val,5), sd2i=rep(sd_val,5), n2i=n2)
  res <- rma(yi, vi, data=esc, method="REML")
  cat("=== RBIS-2 (heterogeneous, REML, unequal groups n1≈n/3) ===\n")
  cat("n1:", n1, "n2:", n2, "\n")
  cat("p1:", round(n1/n, 4), "\n")
  esc_rpb <- escalc(measure="RPB", m1i=m1_base, sd1i=rep(sd_val,5), n1i=n1,
    m2i=rep(m2_val,5), sd2i=rep(sd_val,5), n2i=n2)
  cat("r_pb: ", round(as.numeric(esc_rpb$yi), 6), "\n")
  cat("r_bis:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:   ", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res$b[1], 6), "\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  Q <- res$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
}

## R2-1 — R-squared (raw), homogeneous (DL, tau2=0)
## 5 synthetic studies with similar R² values; Q < df → tau2=0.
## yi = R², vi = 4R²(1-R²)²/n [metafor escalc("R2") LS formula].
{
  library(metafor)
  r2 <- c(0.25, 0.22, 0.28, 0.24, 0.26)
  n  <- c(80, 100, 60, 120, 90)
  esc <- escalc(measure="R2", r2i=r2, mi=rep(1,5), ni=n)
  res_dl <- rma(yi, vi, data=esc, method="DL")
  cat("=== R2-1 (homogeneous, DL) ===\n")
  cat("yi:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res_dl$b[1], 6), "\n")
  cat("tau2:", round(res_dl$tau2, 6), "\n")
  Q <- res_dl$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
}

## R2-2 — R-squared (raw), heterogeneous (REML, tau2>0)
## Low R² in large-n, high R² in small-n.
## tau2≈0.029 (REML), I2≈87.9%.
{
  library(metafor)
  r2 <- c(0.04, 0.09, 0.49, 0.36, 0.25)
  n  <- c(200, 150, 50, 80, 100)
  esc <- escalc(measure="R2", r2i=r2, mi=rep(1,5), ni=n)
  res <- rma(yi, vi, data=esc, method="REML")
  cat("=== R2-2 (heterogeneous, REML) ===\n")
  cat("yi:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res$b[1], 6), "\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  Q <- res$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
}

## ZR2-1 — R-squared (Fisher z of √R²), homogeneous (DL, tau2=0)
## Same 5 studies as R2-1.
## yi = atanh(√R²), vi = 1/n.
{
  library(metafor)
  r2 <- c(0.25, 0.22, 0.28, 0.24, 0.26)
  n  <- c(80, 100, 60, 120, 90)
  esc <- escalc(measure="ZR2", r2i=r2, mi=rep(1,5), ni=n)
  res_dl <- rma(yi, vi, data=esc, method="DL")
  cat("=== ZR2-1 (homogeneous, DL) ===\n")
  cat("yi:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res_dl$b[1], 6), "\n")
  cat("tau2:", round(res_dl$tau2, 6), "\n")
  Q <- res_dl$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
  # Back-transform pooled RE to R²
  cat("RE back-transformed R²:", round(tanh(res_dl$b[1])^2, 6), "\n")
}

## ZR2-2 — R-squared (Fisher z of √R²), heterogeneous (REML, tau2>0)
## Same 5 studies as R2-2.
## tau2≈0.062 (REML), I2≈86.2%.
{
  library(metafor)
  r2 <- c(0.04, 0.09, 0.49, 0.36, 0.25)
  n  <- c(200, 150, 50, 80, 100)
  esc <- escalc(measure="ZR2", r2i=r2, mi=rep(1,5), ni=n)
  res <- rma(yi, vi, data=esc, method="REML")
  cat("=== ZR2-2 (heterogeneous, REML) ===\n")
  cat("yi:", round(as.numeric(esc$yi), 6), "\n")
  cat("vi:", round(as.numeric(esc$vi), 6), "\n")
  cat("FE:", round(rma(yi, vi, data=esc, method="FE")$b[1], 6), "\n")
  cat("RE:", round(res$b[1], 6), "\n")
  cat("tau2:", round(res$tau2, 6), "\n")
  Q <- res$QE; k <- 5
  cat("I2:", round(max(0,(Q-(k-1))/Q)*100, 4), "\n")
  # Back-transform pooled RE to R²
  cat("RE back-transformed R²:", round(tanh(res$b[1])^2, 6), "\n")
}

## CLES-1 — Common Language Effect Size: Normand 1999 SMD (REML, k=4)
## Verifies BENCHMARKS entry expected.cles: estimate, ciLow, ciHigh
## CLES = Φ(RE / √2); CI endpoints transformed through the same function.
## McGraw & Wong (1992).
{
  library(metafor)
  dat <- escalc(measure="SMD",
    m1i  = c( 55,  27,  64,  66),
    sd1i = c( 47,   7,  17,  20),
    n1i  = c(155,  31,  75,  18),
    m2i  = c( 75,  29, 119, 137),
    sd2i = c( 64,   4,  29,  48),
    n2i  = c(156,  32,  71,  18))
  res  <- rma(yi, vi, data=dat, method="REML")
  d    <- as.numeric(res$beta)
  lb   <- res$ci.lb
  ub   <- res$ci.ub
  cat("=== CLES-1 (Normand SMD, REML, k=4) ===\n")
  cat("RE:       ", round(d,  4), "\n")
  cat("ciLow:    ", round(lb, 4), "\n")
  cat("ciHigh:   ", round(ub, 4), "\n")
  cat("estimate: ", round(pnorm(d  / sqrt(2)), 4), "\n")
  cat("ci.lb:    ", round(pnorm(lb / sqrt(2)), 4), "\n")
  cat("ci.ub:    ", round(pnorm(ub / sqrt(2)), 4), "\n")
}

## ALPHA-1 — Cronbach's α (raw, ARAW), DL, k_studies=3
## Synthetic dataset: alpha=[0.60,0.85,0.90], k=10 items, n=100 per study.
## yi=alpha, vi=2k^2*(1-alpha)^2/(n*(k-1)) (Feldt 1965).
## Verifies BENCHMARKS entries "Cronbach's α (ARAW, DL, k_studies=3)".
{
  library(metafor)
  alpha  <- c(0.60, 0.85, 0.90)
  k_i    <- c(10, 10, 10)
  n      <- c(100, 100, 100)

  yi <- alpha
  vi <- 2 * k_i^2 * (1 - alpha)^2 / (n * (k_i - 1))

  res_fe <- rma(yi, vi, method="FE")
  res_dl <- rma(yi, vi, method="DL")

  cat("=== ALPHA-1 (ARAW, DL, k_studies=3) ===\n")
  cat("yi:", round(yi, 6), "\n")
  cat("vi:", round(vi, 9), "\n")
  cat("FE:", round(as.numeric(res_fe$beta), 6), "\n")
  cat("RE:", round(as.numeric(res_dl$beta), 6), "\n")
  cat("tau2:", round(res_dl$tau2, 6), "\n")
  Q <- res_fe$QE; k_s <- length(yi)
  cat("I2:", round(max(0, (Q - (k_s - 1)) / Q) * 100, 4), "\n")
}

## ALPHA-2 — Cronbach's α (log transform, ABT), DL, k_studies=3
## Same dataset as ALPHA-1.
## yi=log(1-alpha), vi=2k/(n*(k-1)) (Bonett 2002).
## Back-transform: alpha = 1 - exp(yi).
## Verifies BENCHMARKS entries "Cronbach's α (ABT, DL, k_studies=3)".
{
  library(metafor)
  alpha  <- c(0.60, 0.85, 0.90)
  k_i    <- c(10, 10, 10)
  n      <- c(100, 100, 100)

  yi <- log(1 - alpha)
  vi <- 2 * k_i / (n * (k_i - 1))

  res_fe <- rma(yi, vi, method="FE")
  res_dl <- rma(yi, vi, method="DL")

  cat("=== ALPHA-2 (ABT, DL, k_studies=3) ===\n")
  cat("yi:", round(yi, 6), "\n")
  cat("vi:", round(vi, 9), "\n")
  cat("FE:", round(as.numeric(res_fe$beta), 6), "\n")
  cat("RE:", round(as.numeric(res_dl$beta), 6), "\n")
  cat("tau2:", round(res_dl$tau2, 6), "\n")
  Q <- res_fe$QE; k_s <- length(yi)
  cat("I2:", round(max(0, (Q - (k_s - 1)) / Q) * 100, 4), "\n")
  cat("RE back-transformed alpha: 1-exp(RE) =", round(1 - exp(as.numeric(res_dl$beta)), 4), "\n")
}

## ALPHA-3 — Cronbach's α (cube-root transform, AHW), DL, k_studies=3
## Same dataset as ALPHA-1.
## u=k/(k-1)*(1-alpha), yi=u^(1/3), vi=2k^2/(9*n*(k-1))*u^(2/3) (Hakstian & Whalen 1976).
## Verifies BENCHMARKS entries "Cronbach's α (AHW, DL, k_studies=3)".
{
  library(metafor)
  alpha  <- c(0.60, 0.85, 0.90)
  k_i    <- c(10, 10, 10)
  n      <- c(100, 100, 100)

  u  <- (k_i / (k_i - 1)) * (1 - alpha)
  yi <- u^(1/3)
  vi <- 2 * k_i^2 / (9 * n * (k_i - 1)) * u^(2/3)

  res_fe <- rma(yi, vi, method="FE")
  res_dl <- rma(yi, vi, method="DL")

  cat("=== ALPHA-3 (AHW, DL, k_studies=3) ===\n")
  cat("yi:", round(yi, 6), "\n")
  cat("vi:", round(vi, 9), "\n")
  cat("FE:", round(as.numeric(res_fe$beta), 6), "\n")
  cat("RE:", round(as.numeric(res_dl$beta), 6), "\n")
  cat("tau2:", round(res_dl$tau2, 6), "\n")
  Q <- res_fe$QE; k_s <- length(yi)
  cat("I2:", round(max(0, (Q - (k_s - 1)) / Q) * 100, 4), "\n")
}

## MR-CONTRAST-1 — linear combination test (custom contrast) on BCG data
## Uses MR-B setup: ablat + region (REML, normal CI). Reference = "AS".
## Contrast L = [0, 0, 1, -1]:  region:EU - region:NA
## Verifies CONTRAST_BENCHMARKS entry "BCG – region:EU vs region:NA".
{
  library(metafor)
  yi_b <- c(-0.8893113339202054, -1.5853886572014306, -1.348073148299693,
            -1.4415511900213054, -0.2175473222112957, -0.786115585818864,
            -1.6208982235983924,  0.011952333523841173, -0.4694176487381487,
            -1.3713448034727846, -0.33935882833839015,  0.4459134005713783,
            -0.017313948216879493)
  vi_b <- c(0.3255847650039614, 0.19458112139814387, 0.41536796536796533,
            0.020010031902247573, 0.05121017216963086, 0.0069056184559087574,
            0.22301724757231517, 0.00396157929781773, 0.056434210463248966,
            0.07302479361302891, 0.01241221397155972, 0.5325058452001528,
            0.0714046596839863)
  ablat_b <- c(44, 55, 42, 52, 13, 44, 19, 13, 27, 42, 18, 33, 33)
  region_b <- c("NA","EU","AS","EU","AS","NA","AS","AS","NA","NA","NA","NA","NA")

  res <- rma(yi_b, vi_b,
             mods = ~ ablat_b + relevel(factor(region_b), ref = "AS"),
             method = "REML")

  vc   <- vcov(res)
  L    <- c(0, 0, 1, -1)
  est  <- as.numeric(crossprod(L, coef(res)))
  varE <- as.numeric(t(L) %*% vc %*% L)
  se   <- sqrt(varE)
  zval <- est / se
  pval <- 2 * pnorm(-abs(zval))
  crit <- qnorm(0.975)
  ci   <- c(est - crit * se, est + crit * se)

  cat("=== MR-CONTRAST-1 (region:EU - region:NA) ===\n")
  cat("vcov[2,2]:", round(vc[3,3], 8), "\n")
  cat("vcov[3,3]:", round(vc[4,4], 8), "\n")
  cat("vcov[2,3]:", round(vc[3,4], 8), "\n")
  cat("est: ", round(est,  6), "\n")
  cat("se:  ", round(se,   6), "\n")
  cat("zval:", round(zval, 6), "\n")
  cat("pval:", round(pval, 6), "\n")
  cat("ci:  ", round(ci,   6), "\n")
  BENCH[["CONTRAST-1"]] <- list(est=round(est,6), se=round(se,6), z=round(zval,6), p=round(pval,6), ciLow=round(ci[1],6), ciHigh=round(ci[2],6))
}

## INT-1: BCG – ablat × region (continuous × categorical interaction), REML
## Tests interaction between continuous moderator (ablat) and categorical moderator
## (region, 3 levels: AS/EU/NA, reference = "AS").
## Model: yi ~ ablat + region + ablat:region
{
  yi_i <- c(-0.8893113339202054, -1.5853886572014306, -1.348073148299693,
             -1.4415511900213054, -0.2175473222112957, -0.786115585818864,
             -1.6208982235983924,  0.011952333523841173, -0.4694176487381487,
             -1.3713448034727846, -0.33935882833839015,  0.4459134005713783,
             -0.017313948216879493)
  vi_i <- c(0.3255847650039614, 0.19458112139814387, 0.41536796536796533,
             0.020010031902247573, 0.05121017216963086, 0.0069056184559087574,
             0.22301724757231517, 0.00396157929781773, 0.056434210463248966,
             0.07302479361302891, 0.01241221397155972, 0.5325058452001528,
             0.0714046596839863)
  ablat_i  <- c(44, 55, 42, 52, 13, 44, 19, 13, 27, 42, 18, 33, 33)
  region_i <- c("NA","EU","AS","EU","AS","NA","AS","AS","NA","NA","NA","NA","NA")

  res <- rma(yi_i, vi_i,
             mods = ~ ablat_i + relevel(factor(region_i), ref = "AS") +
                      ablat_i:relevel(factor(region_i), ref = "AS"),
             method = "REML")

  cat("=== INT-1 (ablat × region interaction) ===\n")
  cat("beta:", round(coef(res), 7), "\n")
  cat("se:  ", round(sqrt(diag(vcov(res))), 7), "\n")
  cat("tau2:", round(res$tau2, 7), "\n")
  cat("QE:  ", round(res$QE, 7), "\n")
  cat("QEdf:", res$QEdf, "\n")
  cat("QEp: ", round(res$QEp, 7), "\n")
  cat("QM:  ", round(res$QM, 7), "\n")
  cat("QMdf:", res$QMdf, "\n")
  cat("QMp: ", round(res$QMp, 7), "\n")
  cat("I2:  ", round(res$I2, 4), "\n")
  cat("R2:  ", round(res$R2, 6), "\n")
  cat("colnames:", names(coef(res)), "\n")

  # Per-term partial LRTs (Type-III-style: drop only the term's own columns).
  # Use explicit design matrix to match the JS implementation exactly.
  # AUDITED: JS and R use same 6-col design matrix; ordering confirmed identical (2026-05-30); see benchmark-data.md §"Interaction".
  # Full 6-col matrix: intercept, ablat, regionEU, regionNA, ablat:regionEU, ablat:regionNA
  reg_f_i    <- relevel(factor(region_i), ref = "AS")
  X_full_i   <- model.matrix(~ ablat_i + reg_f_i + ablat_i:reg_f_i)
  # Reduced: drop col 2 (ablat), keep intercept+regionEU+regionNA+ablat:EU+ablat:NA
  X_no_ablat_i  <- X_full_i[, -2, drop = FALSE]
  # Reduced: drop cols 3-4 (regionEU/NA), keep intercept+ablat+ablat:EU+ablat:NA
  X_no_region_i <- X_full_i[, -(3:4), drop = FALSE]
  # Reduced: drop cols 5-6 (ablat:EU/NA), keep intercept+ablat+regionEU+regionNA
  X_no_ixn_i    <- X_full_i[, -(5:6), drop = FALSE]

  res_full_ml_i    <- rma(yi_i, vi_i, mods = X_full_i[, -1],    method = "ML")
  res_no_ablat_i   <- rma(yi_i, vi_i, mods = X_no_ablat_i[, -1], method = "ML")
  res_no_region_i  <- rma(yi_i, vi_i, mods = X_no_region_i[, -1], method = "ML")
  res_no_ixn_i     <- rma(yi_i, vi_i, mods = X_no_ixn_i[, -1],   method = "ML")

  lrt_ablat_i  <- max(0, 2*(logLik(res_full_ml_i) - logLik(res_no_ablat_i)))
  lrt_region_i <- max(0, 2*(logLik(res_full_ml_i) - logLik(res_no_region_i)))
  lrt_ixn_i    <- max(0, 2*(logLik(res_full_ml_i) - logLik(res_no_ixn_i)))
  cat("LRT ablat: ", round(lrt_ablat_i,  6), " df=1 p=", round(1-pchisq(lrt_ablat_i,  1), 6), "\n")
  cat("LRT region:", round(lrt_region_i, 6), " df=2 p=", round(1-pchisq(lrt_region_i, 2), 6), "\n")
  cat("LRT ixn:   ", round(lrt_ixn_i,   6), " df=2 p=", round(1-pchisq(lrt_ixn_i,   2), 6), "\n")

  BENCH[["INT-1"]] <- list(
    beta   = round(coef(res), 8),
    se     = round(sqrt(diag(vcov(res))), 8),
    tau2   = round(res$tau2, 8),
    QE     = round(res$QE, 8),
    QEdf   = res$QEdf,
    QEp    = round(res$QEp, 8),
    QM     = round(res$QM, 8),
    QMdf   = res$QMdf,
    QMp    = round(res$QMp, 8),
    I2     = round(res$I2, 4),
    R2     = round(res$R2, 6)
  )
}

## INT-2: BCG – ablat × year (continuous × continuous interaction), REML
## Model: yi ~ ablat + year + ablat:year
{
  yi_i2   <- c(-0.8893113339202054, -1.5853886572014306, -1.348073148299693,
                -1.4415511900213054, -0.2175473222112957, -0.786115585818864,
                -1.6208982235983924,  0.011952333523841173, -0.4694176487381487,
                -1.3713448034727846, -0.33935882833839015,  0.4459134005713783,
                -0.017313948216879493)
  vi_i2   <- c(0.3255847650039614, 0.19458112139814387, 0.41536796536796533,
                0.020010031902247573, 0.05121017216963086, 0.0069056184559087574,
                0.22301724757231517, 0.00396157929781773, 0.056434210463248966,
                0.07302479361302891, 0.01241221397155972, 0.5325058452001528,
                0.0714046596839863)
  ablat_i2 <- c(44, 55, 42, 52, 13, 44, 19, 13, 27, 42, 18, 33, 33)
  year_i2  <- c(1948, 1949, 1960, 1977, 1973, 1953, 1973, 1980, 1968, 1961, 1974, 1969, 1976)

  res2 <- rma(yi_i2, vi_i2,
              mods = ~ ablat_i2 + year_i2 + ablat_i2:year_i2,
              method = "REML")

  cat("=== INT-2 (ablat × year interaction) ===\n")
  cat("beta:", round(coef(res2), 7), "\n")
  cat("se:  ", round(sqrt(diag(vcov(res2))), 7), "\n")
  cat("tau2:", round(res2$tau2, 7), "\n")
  cat("QE:  ", round(res2$QE, 7), "\n")
  cat("QEdf:", res2$QEdf, "\n")
  cat("QEp: ", round(res2$QEp, 7), "\n")
  cat("QM:  ", round(res2$QM, 7), "\n")
  cat("QMdf:", res2$QMdf, "\n")
  cat("QMp: ", round(res2$QMp, 7), "\n")
  cat("I2:  ", round(res2$I2, 4), "\n")
  cat("R2:  ", round(res2$R2, 6), "\n")
  cat("colnames:", names(coef(res2)), "\n")

  # Partial LRTs using explicit design matrices (matches JS Type-III approach).
  # Full 4-col matrix: intercept, ablat, year, ablat:year
  X2_full    <- model.matrix(~ ablat_i2 + year_i2 + ablat_i2:year_i2)
  X2_no_ablat <- X2_full[, -2, drop = FALSE]   # drop ablat (col 2)
  X2_no_year  <- X2_full[, -3, drop = FALSE]   # drop year  (col 3)
  X2_no_ixn   <- X2_full[, -4, drop = FALSE]   # drop ablat:year (col 4)

  res2_full_ml  <- rma(yi_i2, vi_i2, mods = X2_full[, -1],     method = "ML")
  res2_no_ablat <- rma(yi_i2, vi_i2, mods = X2_no_ablat[, -1], method = "ML")
  res2_no_year  <- rma(yi_i2, vi_i2, mods = X2_no_year[, -1],  method = "ML")
  res2_no_ixn   <- rma(yi_i2, vi_i2, mods = X2_no_ixn[, -1],   method = "ML")
  lrt2_ablat <- max(0, 2*(logLik(res2_full_ml) - logLik(res2_no_ablat)))
  lrt2_year  <- max(0, 2*(logLik(res2_full_ml) - logLik(res2_no_year)))
  lrt2_ixn   <- max(0, 2*(logLik(res2_full_ml) - logLik(res2_no_ixn)))
  cat("LRT ablat:", round(lrt2_ablat, 6), " df=1 p=", round(1-pchisq(lrt2_ablat, 1), 6), "\n")
  cat("LRT year: ", round(lrt2_year,  6), " df=1 p=", round(1-pchisq(lrt2_year,  1), 6), "\n")
  cat("LRT ixn:  ", round(lrt2_ixn,   6), " df=1 p=", round(1-pchisq(lrt2_ixn,   1), 6), "\n")

  BENCH[["INT-2"]] <- list(
    beta   = round(coef(res2), 8),
    se     = round(sqrt(diag(vcov(res2))), 8),
    tau2   = round(res2$tau2, 8),
    QE     = round(res2$QE, 8),
    QEdf   = res2$QEdf,
    QEp    = round(res2$QEp, 8),
    QM     = round(res2$QM, 8),
    QMdf   = res2$QMdf,
    QMp    = round(res2$QMp, 8),
    I2     = round(res2$I2, 4),
    R2     = round(res2$R2, 6)
  )
}

## PERM-1: BCG ablat permutation test (metafor permutest)
{
  res_perm <- rma(yi = bcg_yi, vi = bcg_vi, mods = ~bcg_ablat, method = "REML")
  set.seed(42)
  pt <- permutest(res_perm, progbar = FALSE, iter = 999, retperms = TRUE)
  cat("=== PERM-1 (BCG ablat permutation, seed=42, 999 iter) ===\n")
  cat("QM_obs   =", round(res_perm$QM, 8), "\n")
  cat("QM_perm_p=", round(pt$QMp, 6), "\n")
  BENCH[["PERM-1"]] <- list(
    QM_obs   = round(res_perm$QM, 8),
    QM_perm_p = round(pt$QMp, 6),
    QM_perm_dist = round(as.numeric(pt$QM.perm), 8)
  )
}

## MV data: Berkey et al. (1998) periodontal treatment — hardcoded to avoid
## package availability issues.  Source: metafor::dat.berkey98 / dat.berkey1998.
## 5 studies × 2 outcomes (PD = probing depth, AL = attachment level), rho_within=0.5.
{
  # levels=c("PD","AL") forces PD-first ordering to match JS vcalc encounter order.
  # AUDITED: factor ordering matches JS vcalc; PD-first confirmed in multivariate benchmarks (2026-05-30); see benchmark-data.md §"Multivariate".
  berkey98 <- data.frame(
    trial   = c(1, 1, 2, 2, 3, 3, 4, 4, 5, 5),
    outcome = factor(c("PD","AL","PD","AL","PD","AL","PD","AL","PD","AL"), levels=c("PD","AL")),
    yi      = c(0.47, -0.32, 0.397, -0.240, 0.133, -0.050, 0.165, 0.068, 0.349, 0.016),
    vi      = c(0.0275, 0.0135, 0.0162, 0.0119, 0.0033, 0.0040, 0.0030, 0.0015, 0.0051, 0.0019)
  )

  ## MV-1: CS structure, REML
  V1 <- vcalc(vi, cluster = trial, obs = outcome, data = berkey98, rho = 0.5)
  res1 <- rma.mv(yi, V1, mods = ~outcome - 1,
                 random = ~outcome | trial, struct = "CS",
                 data = berkey98, method = "REML")
  cat("=== MV-1 ===\n"); print(summary(res1))
  BENCH[["MV-1"]] <- list(
    beta   = round(as.numeric(coef(res1)), 8),
    se     = round(as.numeric(sqrt(diag(vcov(res1)))), 8),
    tau2   = round(res1$tau2, 8),
    rho    = round(res1$rho, 8),
    QM     = round(res1$QM, 8),
    QMdf   = res1$QMdf,
    QMp    = round(res1$QMp, 8),
    QE     = round(res1$QE, 8),
    QEdf   = res1$QEdf,
    QEp    = round(res1$QEp, 8),
    logLik = round(as.numeric(logLik(res1)), 8)
  )

  ## MV-2: CS structure, ML — same data, different method
  res2mv <- rma.mv(yi, V1, mods = ~outcome - 1,
                   random = ~outcome | trial, struct = "CS",
                   data = berkey98, method = "ML")
  cat("=== MV-2 ===\n"); print(summary(res2mv))
  BENCH[["MV-2"]] <- list(
    beta   = round(as.numeric(coef(res2mv)), 8),
    se     = round(as.numeric(sqrt(diag(vcov(res2mv)))), 8),
    tau2   = round(res2mv$tau2, 8),
    rho    = round(res2mv$rho, 8),
    QM     = round(res2mv$QM, 8),
    QMdf   = res2mv$QMdf,
    QMp    = round(res2mv$QMp, 8),
    QE     = round(res2mv$QE, 8),
    QEdf   = res2mv$QEdf,
    QEp    = round(res2mv$QEp, 8),
    logLik = round(as.numeric(logLik(res2mv)), 8)
  )

  ## MV-3: Unbalanced — drop study 5, outcome AL.  Tests JS unbalanced handling.
  mv3_dat <- berkey98[!(berkey98$trial == 5 & berkey98$outcome == "AL"), ]
  mv3_dat$outcome <- factor(as.character(mv3_dat$outcome), levels = c("PD","AL"))
  V3 <- vcalc(vi, cluster = trial, obs = outcome, data = mv3_dat, rho = 0.5)
  res3 <- rma.mv(yi, V3, mods = ~outcome - 1,
                 random = ~outcome | trial, struct = "CS",
                 data = mv3_dat, method = "REML")
  cat("=== MV-3 ===\n"); print(summary(res3))
  BENCH[["MV-3"]] <- list(
    beta   = round(as.numeric(coef(res3)), 8),
    se     = round(as.numeric(sqrt(diag(vcov(res3)))), 8),
    tau2   = round(res3$tau2, 8),
    rho    = round(res3$rho, 8),
    QM     = round(res3$QM, 8),
    QMdf   = res3$QMdf,
    QMp    = round(res3$QMp, 8),
    QE     = round(res3$QE, 8),
    QEdf   = res3$QEdf,
    QEp    = round(res3$QEp, 8),
    logLik = round(as.numeric(logLik(res3)), 8)
  )

  ## MV-UN-1: UN structure, REML — canonical Berkey98 example from metafor docs.
  ## Estimates separate tau2 per outcome plus a free between-study correlation.
  res_un1 <- rma.mv(yi, V1, mods = ~outcome - 1,
                    random = ~outcome | trial, struct = "UN",
                    data = berkey98, method = "REML")
  cat("=== MV-UN-1 ===\n"); print(summary(res_un1))
  BENCH[["MV-UN-1"]] <- list(
    beta   = round(as.numeric(coef(res_un1)), 8),
    se     = round(as.numeric(sqrt(diag(vcov(res_un1)))), 8),
    tau2   = round(res_un1$tau2, 8),
    rho    = round(res_un1$rho, 8),
    QM     = round(res_un1$QM, 8),
    QMdf   = res_un1$QMdf,
    QMp    = round(res_un1$QMp, 8),
    QE     = round(res_un1$QE, 8),
    QEdf   = res_un1$QEdf,
    QEp    = round(res_un1$QEp, 8),
    logLik = round(as.numeric(logLik(res_un1)), 8)
  )

  ## MV-4: CS structure, REML, common-slopes meta-regression.
  ## Adds a centred continuous moderator (study index 1-5, mean-centred to -2:2).
  ## mods = ~outcome + x - 1  gives 2 outcome intercepts + 1 shared slope.
  berkey98$x <- c(1, 1, 2, 2, 3, 3, 4, 4, 5, 5) - 3   # centred at study 3
  res4 <- rma.mv(yi, V1, mods = ~outcome + x - 1,
                 random = ~outcome | trial, struct = "CS",
                 data = berkey98, method = "REML")
  cat("=== MV-4 ===\n"); print(summary(res4))
  BENCH[["MV-4"]] <- list(
    beta   = round(as.numeric(coef(res4)), 8),
    se     = round(as.numeric(sqrt(diag(vcov(res4)))), 8),
    tau2   = round(res4$tau2, 8),
    rho    = round(res4$rho, 8),
    QM     = round(res4$QM, 8),
    QMdf   = res4$QMdf,
    QMp    = round(res4$QMp, 8),
    QE     = round(res4$QE, 8),
    QEdf   = res4$QEdf,
    QEp    = round(res4$QEp, 8),
    logLik = round(as.numeric(logLik(res4)), 8)
  )

  ## MV-1-t: CS structure, REML, t-distribution CIs/tests (metafor test="t").
  ## Same model as MV-1; adds test="t" to verify JS t-critical CI and F-test branches.
  ## With test="t": res$QM is the F-statistic (chi2/df_QM); res$QMdf is c(df1, df2).
  ## df_residual = n - q_total = 10 - 2 = 8.
  res1t <- rma.mv(yi, V1, mods = ~outcome - 1,
                  random = ~outcome | trial, struct = "CS",
                  data = berkey98, method = "REML", test = "t")
  cat("=== MV-1-t ===\n"); print(summary(res1t))
  BENCH[["MV-1-t"]] <- list(
    beta   = round(as.numeric(coef(res1t)), 8),
    se     = round(as.numeric(sqrt(diag(vcov(res1t)))), 8),
    ci_lb  = round(as.numeric(res1t$ci.lb), 8),
    ci_ub  = round(as.numeric(res1t$ci.ub), 8),
    Fstat  = round(res1t$QM, 8),
    df_QM1 = res1t$QMdf[1],
    df_QM2 = res1t$QMdf[2],
    QMp    = round(res1t$QMp, 8),
    QE     = round(res1t$QE, 8),
    QEdf   = res1t$QEdf,
    QEp    = round(res1t$QEp, 8)
  )
}

# =================================================================
# Plan B.1 — New cross-validation blocks
# Trim-fill, cumulative, half-normal edges, HC additional, WAAP-NORMAND, MV-UN-2
# =================================================================

# -----------------------------------------------------------------
# Standalone trim-and-fill blocks with per-estimator breakdown.
# TF-{L0,R0,Q0}-BCG:     BCG log-OR (dat.bcg, DL)
# TF-{L0,R0,Q0}-SYNTH:   Synthetic asymmetric funnel (k=6, DL)
# TF-{L0,R0,Q0}-NORMAND: Normand 1999 MD (DL)
# Fields: k0 (exact), b_tf, se_tf, tau2_tf, ci_lb_tf, ci_ub_tf
# -----------------------------------------------------------------
{
  .save_tf <- function(key, tf_obj) {
    BENCH[[key]] <<- list(
      k0       = as.integer(tf_obj$k0),
      b_tf     = round(as.numeric(coef(tf_obj)), 8),
      se_tf    = round(as.numeric(tf_obj$se),    8),
      tau2_tf  = round(tf_obj$tau2,              8),
      ci_lb_tf = round(tf_obj$ci.lb,             8),
      ci_ub_tf = round(tf_obj$ci.ub,             8)
    )
    cat(sprintf("   [%s] k0=%d  b=%.4f  se=%.4f  tau2=%.4f  ci=[%.4f, %.4f]\n",
                key, tf_obj$k0, as.numeric(coef(tf_obj)), tf_obj$se,
                tf_obj$tau2, tf_obj$ci.lb, tf_obj$ci.ub))
  }
  .try_tf <- function(key, res_obj, estimator) {
    withCallingHandlers(
      tryCatch(
        .save_tf(key, trimfill(res_obj, estimator = estimator)),
        error = function(e) cat(sprintf("   [%s] SKIP (error: %s)\n", key, conditionMessage(e)))
      ),
      warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") }
    )
  }

  # BCG log-OR (res_bcg defined in PB section, method="DL")
  cat("\n## TF-BCG: BCG log-OR trim-fill (DL, all estimators)\n")
  for (.est in c("L0", "R0", "Q0")) .try_tf(paste0("TF-", .est, "-BCG"), res_bcg, .est)

  # Synthetic asymmetric funnel (k=6; same data as PB-synth / HC-2 / WAAP-2)
  cat("\n## TF-SYNTH: Synthetic asymmetric funnel trim-fill (DL, all estimators)\n")
  .res_synth_dl <- rma(
    yi = c(-0.1, 0.3, 0.1, 0.9, 1.4, 0.5),
    vi = c(0.04, 0.09, 0.0225, 0.36, 0.64, 0.16),
    method = "DL"
  )
  for (.est in c("L0", "R0", "Q0")) .try_tf(paste0("TF-", .est, "-SYNTH"), .res_synth_dl, .est)

  # Normand 1999 MD (DL)
  cat("\n## TF-NORMAND: Normand 1999 MD trim-fill (DL, all estimators)\n")
  .normand_md <- escalc("MD",
                        m1i = m1i, sd1i = sd1i, n1i = n1i,
                        m2i = m2i, sd2i = sd2i, n2i = n2i,
                        data = dat.normand1999)
  .res_normand_dl <- rma(yi, vi, data = .normand_md, method = "DL")
  for (.est in c("L0", "R0", "Q0")) .try_tf(paste0("TF-", .est, "-NORMAND"), .res_normand_dl, .est)
}

# -----------------------------------------------------------------
# Cumulative meta-analysis benchmarks.
# CUM-BCG:     BCG log-OR (dat.bcg, DL), k=2..13 cumulative steps
# CUM-NORMAND: Normand 1999 MD (REML), k=2..9 cumulative steps
# Fields: array of {estimate, se, ci_lb, ci_ub, tau2} per step
# -----------------------------------------------------------------
{
  .save_cum <- function(key, cum_obj) {
    n <- length(cum_obj$estimate)
    BENCH[[key]] <<- list(
      steps = lapply(seq_len(n), function(i) list(
        estimate = round(as.numeric(cum_obj$estimate[i]), 8),
        se       = round(as.numeric(cum_obj$se[i]),       8),
        ci_lb    = round(as.numeric(cum_obj$ci.lb[i]),    8),
        ci_ub    = round(as.numeric(cum_obj$ci.ub[i]),    8),
        tau2     = round(as.numeric(cum_obj$tau2[i]),     8)
      ))
    )
    cat(sprintf("   [%s] %d steps; final est=%.4f  tau2=%.4f\n",
                key, n, cum_obj$estimate[n], cum_obj$tau2[n]))
  }

  cat("\n## CUM-BCG: BCG log-OR cumulative (DL)\n")
  .cum_bcg <- cumul(res_bcg, order = seq_len(nrow(bcg_esc)))
  .save_cum("CUM-BCG", .cum_bcg)

  cat("\n## CUM-NORMAND: Normand 1999 MD cumulative (REML)\n")
  .normand_md2 <- escalc("MD",
                         m1i = m1i, sd1i = sd1i, n1i = n1i,
                         m2i = m2i, sd2i = sd2i, n2i = n2i,
                         data = dat.normand1999)
  .res_normand_reml <- rma(yi, vi, data = .normand_md2, method = "REML")
  .cum_norm <- cumul(.res_normand_reml, order = seq_len(nrow(.normand_md2)))
  .save_cum("CUM-NORMAND", .cum_norm)
}

# -----------------------------------------------------------------
# Half-normal selection model edge cases (Plan B.1 HN-EDGE blocks).
# HN-EDGE-LOW:  near-null dataset — delta should converge to ~0
# HN-EDGE-HIGH: strongly-selected dataset — all effects large/significant
# Fields match print_sel output: mu, se_mu, tau2, delta, LRT, LRTdf, LRTp
# -----------------------------------------------------------------
{
  # Near-null: k=10, all p-values non-significant (effects ≈ 0, large vi)
  .hn_low_yi <- c( 0.05, -0.03,  0.08, -0.02,  0.06,
                   0.01, -0.04,  0.03,  0.07, -0.01)
  .hn_low_vi <- c( 0.16,  0.25,  0.09,  0.36,  0.16,
                   0.25,  0.09,  0.36,  0.16,  0.25)
  .res_hn_low_ml <- rma(.hn_low_yi, .hn_low_vi, method = "ML")
  cat("\n## HN-EDGE-LOW: Half-normal near-null dataset\n")
  .cur_id <- "HN-EDGE-LOW"
  withCallingHandlers(
    tryCatch(
      print_sel(selmodel(.res_hn_low_ml, type = "halfnorm",
                         alternative = "two.sided"), .res_hn_low_ml, "near-null HN"),
      error = function(e) {
        cat("ERROR:", conditionMessage(e), "\n")
        BENCH[["HN-EDGE-LOW"]] <<- list(mu=NA, se_mu=NA, tau2=NA, delta=NA, LRT=NA, LRTdf=1L, LRTp=NA)
      }
    ),
    warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") }
  )
  .cur_id <- NULL

  # Strong-selection: k=10, all effects large, all p < 0.001
  .hn_high_yi <- c(1.50, 1.80, 1.30, 2.00, 1.60,
                   1.40, 1.90, 1.70, 1.20, 2.10)
  .hn_high_vi <- c(0.01, 0.02, 0.01, 0.03, 0.02,
                   0.01, 0.02, 0.01, 0.03, 0.02)
  .res_hn_high_ml <- rma(.hn_high_yi, .hn_high_vi, method = "ML")
  cat("\n## HN-EDGE-HIGH: Half-normal strong-selection dataset\n")
  .cur_id <- "HN-EDGE-HIGH"
  withCallingHandlers(
    tryCatch(
      print_sel(selmodel(.res_hn_high_ml, type = "halfnorm",
                         alternative = "two.sided"), .res_hn_high_ml, "strong-selection HN"),
      error = function(e) {
        cat("ERROR:", conditionMessage(e), "\n")
        BENCH[["HN-EDGE-HIGH"]] <<- list(mu=NA, se_mu=NA, tau2=NA, delta=NA, LRT=NA, LRTdf=1L, LRTp=NA)
      }
    ),
    warning = function(w) { cat("WARN:", conditionMessage(w), "\n"); invokeRestart("muffleWarning") }
  )
  .cur_id <- NULL
}

# -----------------------------------------------------------------
# Additional Henmi-Copas CI benchmarks (standalone, with own rBlock IDs).
# HC-BCG-RR:    BCG log-RR (DL)
# HC-BCG-RD:    BCG RD (DL)
# HC-NORMAND-MD: Normand 1999 MD (DL)
# Fields: beta, se, tau2, ci_lb, ci_ub
# -----------------------------------------------------------------
{
  .save_hc <- function(key, hc_obj) {
    BENCH[[key]] <<- list(
      beta  = round(as.numeric(hc_obj$beta), 8),
      se    = round(as.numeric(hc_obj$se),   8),
      tau2  = round(hc_obj$tau2,             8),
      ci_lb = round(hc_obj$ci.lb,            8),
      ci_ub = round(hc_obj$ci.ub,            8)
    )
    cat(sprintf("   [%s] beta=%.4f  se=%.4f  tau2=%.4f  ci=[%.4f, %.4f]\n",
                key, as.numeric(hc_obj$beta), hc_obj$se, hc_obj$tau2,
                hc_obj$ci.lb, hc_obj$ci.ub))
  }

  cat("\n## HC-BCG-RR: BCG log-RR Henmi-Copas (DL)\n")
  .bcg_rr_esc <- escalc("RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
  .save_hc("HC-BCG-RR", hc(rma(yi, vi, data=.bcg_rr_esc, method="DL")))

  cat("\n## HC-BCG-RD: BCG RD Henmi-Copas (DL)\n")
  .bcg_rd_esc <- escalc("RD", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
  .save_hc("HC-BCG-RD", hc(rma(yi, vi, data=.bcg_rd_esc, method="DL")))

  cat("\n## HC-NORMAND-MD: Normand 1999 MD Henmi-Copas (DL)\n")
  .normand_hc <- escalc("MD",
                        m1i=m1i, sd1i=sd1i, n1i=n1i,
                        m2i=m2i, sd2i=sd2i, n2i=n2i,
                        data=dat.normand1999)
  .save_hc("HC-NORMAND-MD", hc(rma(yi, vi, data=.normand_hc, method="DL")))
}

# -----------------------------------------------------------------
# WAAP-NORMAND: WAAP-WLS for Normand 1999 MD (DL)
# Same algorithm as WAAP-1 / WAAP-2. Power versus the FE (WLS) estimate.
# -----------------------------------------------------------------
{
  cat("\n## WAAP-NORMAND: Normand 1999 MD WAAP-WLS\n")
  .normand_waap <- escalc("MD",
                          m1i=m1i, sd1i=sd1i, n1i=n1i,
                          m2i=m2i, sd2i=sd2i, n2i=n2i,
                          data=dat.normand1999)
  .yi_w <- as.vector(.normand_waap$yi)
  .vi_w <- as.vector(.normand_waap$vi)
  .z975     <- qnorm(0.975)
  .W_w      <- sum(1 / .vi_w)
  .wls_est  <- sum(.yi_w / .vi_w) / .W_w
  .ncp      <- abs(.wls_est) / sqrt(.vi_w)
  .power_w  <- pnorm(.ncp - .z975) + pnorm(-.z975 - .ncp)
  .adequate <- which(.power_w >= 0.80)
  .subset_w <- if (length(.adequate) > 0) .adequate else seq_along(.yi_w)
  .fallback <- length(.adequate) == 0
  .Wa       <- sum(1 / .vi_w[.subset_w])
  .waap     <- sum(.yi_w[.subset_w] / .vi_w[.subset_w]) / .Wa
  .se_w     <- sqrt(1 / .Wa)
  .z_w      <- .waap / .se_w
  cat(sprintf("   wlsEst=%.4f  kAdequate=%d  fallback=%s  estimate=%.4f  se=%.4f  z=%.4f\n",
              .wls_est, length(.adequate), .fallback, .waap, .se_w, .z_w))
  BENCH[["WAAP-NORMAND"]] <- list(
    wlsEstimate = round(.wls_est,          8),
    kAdequate   = as.integer(length(.adequate)),
    estimate    = round(.waap,             8),
    se          = round(.se_w,             8),
    z           = round(.z_w,             8),
    fallback    = .fallback
  )
}

# -----------------------------------------------------------------
# MV-UN-2: Multivariate UN structure, 3 outcomes, 15 studies.
# Synthetic dataset with heterogeneous tau2 per outcome.
# Extends MV-UN-1 (5 studies) to test the larger UN parameter space.
# -----------------------------------------------------------------
{
  cat("\n## MV-UN-2: Multivariate UN, 3 outcomes, 15 studies (REML)\n")

  .mv2_studies <- rep(1:15, each = 3)
  .mv2_outcome <- factor(rep(c("A","B","C"), 15), levels = c("A","B","C"))

  # Hand-crafted yi/vi: outcome A ~ 0.30, B ~ 0.50, C ~ 0.20
  .mv2_yi <- c(
    0.28, 0.51, 0.22,   0.15, 0.62, 0.18,   0.40, 0.44, 0.27,
    0.32, 0.71, 0.15,   0.25, 0.38, 0.24,   0.35, 0.55, 0.21,
    0.20, 0.48, 0.19,   0.42, 0.66, 0.25,   0.18, 0.42, 0.23,
    0.38, 0.59, 0.17,   0.29, 0.53, 0.20,   0.33, 0.47, 0.26,
    0.21, 0.68, 0.16,   0.44, 0.41, 0.28,   0.31, 0.57, 0.22
  )
  .mv2_vi <- c(
    0.020, 0.015, 0.025,   0.018, 0.012, 0.022,   0.025, 0.020, 0.030,
    0.012, 0.008, 0.015,   0.020, 0.015, 0.025,   0.015, 0.012, 0.018,
    0.022, 0.018, 0.028,   0.010, 0.008, 0.012,   0.024, 0.020, 0.030,
    0.018, 0.014, 0.022,   0.020, 0.016, 0.024,   0.019, 0.015, 0.023,
    0.021, 0.017, 0.027,   0.011, 0.009, 0.013,   0.017, 0.013, 0.020
  )

  .mv2_dat <- data.frame(study   = .mv2_studies,
                         outcome = .mv2_outcome,
                         yi      = .mv2_yi,
                         vi      = .mv2_vi)

  .V2 <- vcalc(vi, cluster = study, obs = outcome, data = .mv2_dat, rho = 0.5)
  .res_un2 <- rma.mv(yi, .V2, mods = ~ outcome - 1,
                     random = ~ outcome | study, struct = "UN",
                     data = .mv2_dat, method = "REML")
  cat("=== MV-UN-2 ===\n"); print(summary(.res_un2))
  BENCH[["MV-UN-2"]] <- list(
    beta   = round(as.numeric(coef(.res_un2)),                    8),
    se     = round(as.numeric(sqrt(diag(vcov(.res_un2)))),        8),
    tau2   = round(.res_un2$tau2,                                 8),
    rho    = round(.res_un2$rho,                                  8),
    QM     = round(.res_un2$QM,                                   8),
    QMdf   = .res_un2$QMdf,
    QMp    = round(.res_un2$QMp,                                  8),
    QE     = round(.res_un2$QE,                                   8),
    QEdf   = .res_un2$QEdf,
    QEp    = round(.res_un2$QEp,                                  8),
    logLik = round(as.numeric(logLik(.res_un2)),                  8)
  )
}

# =================================================================
# P-CURVE and P-UNIFORM benchmarks (JS formula round-trip)
# Implements Simonsohn, Nelson & Simmons (2014) p-curve and
# van Assen, van Aert & Wicherts (2015) p-uniform using the
# exact same algorithms as pCurve() / pUniform() in js/selection.js.
#
# Note: metafor::selmodel(type="pcurve") and selmodel(type="puni")
# use different model formulations (Kim & Viechtbauer 2022;
# van Aert & van Assen 2023) and are NOT equivalent to the
# distributional / conditional-uniformity tests here.
# -----------------------------------------------------------------
{
  .z95 <- qnorm(0.975)

  # JS-equivalent p-curve (Simonsohn et al. 2014, JPSP)
  .js_pcurve <- function(yi, vi) {
    se  <- sqrt(as.numeric(vi))
    z   <- abs(as.numeric(yi) / se)
    p   <- 2 * (1 - pnorm(z))
    sig <- p < 0.05
    z_s <- z[sig]; p_s <- p[sig]
    k <- sum(sig)
    if (k == 0) return(list(k=0L, rightSkewZ=NA_real_, rightSkewP=NA_real_,
                             flatnessZ=NA_real_, flatnessP=NA_real_))
    # lambda33: noncentrality for 33% power at two-tailed z-test (bisection on [0,10])
    pow33 <- function(lam) (1 - pnorm(.z95 - lam)) + pnorm(-.z95 - lam)
    lo33 <- 0; hi33 <- 10
    for (.i in seq_len(100)) {
      mid33 <- (lo33 + hi33) / 2
      if (pow33(mid33) < 0.33) lo33 <- mid33 else hi33 <- mid33
    }
    lam33 <- (lo33 + hi33) / 2
    pp33CDF <- function(p) {
      if (p <= 0) return(0)
      if (p >= 0.05) return(1)
      zp <- qnorm(1 - p / 2)
      ((1 - pnorm(zp - lam33)) + pnorm(-zp - lam33)) / 0.33
    }
    pp0       <- p_s / 0.05
    rightSkewZ <- (mean(pp0) - 0.5) * sqrt(12 * k)
    rightSkewP <- pnorm(rightSkewZ)
    pp33       <- sapply(p_s, pp33CDF)
    flatnessZ  <- (mean(pp33) - 0.5) * sqrt(12 * k)
    flatnessP  <- 1 - pnorm(flatnessZ)
    list(k=as.integer(k),
         rightSkewZ=round(rightSkewZ, 8), rightSkewP=round(rightSkewP, 8),
         flatnessZ =round(flatnessZ,  8), flatnessP =round(flatnessP,  8))
  }

  # JS-equivalent p-uniform (van Assen et al. 2015)
  .js_puniform <- function(yi, vi, RE) {
    se  <- sqrt(as.numeric(vi))
    z   <- abs(as.numeric(yi) / se)
    p   <- 2 * (1 - pnorm(z))
    sig <- p < 0.05
    z_s  <- z[sig]; se_s <- se[sig]
    k <- sum(sig)
    if (k == 0) return(list(k=0L, estimate=NA_real_, ciLow=NA_real_, ciHigh=NA_real_,
                             Z_sig=NA_real_, p_sig=NA_real_, Z_bias=NA_real_, p_bias=NA_real_))
    MIN_DENOM <- 1e-10
    qi_fn <- function(z_i, se_i, delta) {
      lambda <- delta / se_i
      numer  <- 1 - pnorm(z_i - lambda)
      denom  <- max(1 - pnorm(.z95 - lambda), MIN_DENOM)
      numer / denom
    }
    sumQ <- function(delta) sum(mapply(qi_fn, z_s, se_s, MoreArgs=list(delta=delta)))
    maxAbsYi  <- max(z_s * se_s)
    SEARCH_HI <- max(10, maxAbsYi * 2)
    SEARCH_LO <- -SEARCH_HI
    sdUnif <- sqrt(k / 12)
    Z_sig  <- (sumQ(0)  - k / 2) / sdUnif
    Z_bias <- (sumQ(RE) - k / 2) / sdUnif
    p_sig_v  <- pnorm(Z_sig)
    p_bias_v <- 1 - pnorm(Z_bias)
    bisect_d <- function(target) {
      lo0 <- sumQ(SEARCH_LO); hi0 <- sumQ(SEARCH_HI)
      if (target < lo0 || target > hi0) return(NA_real_)
      lo <- SEARCH_LO; hi <- SEARCH_HI
      for (.i in seq_len(100)) {
        mid <- (lo + hi) / 2
        if (sumQ(mid) < target) lo <- mid else hi <- mid
      }
      (lo + hi) / 2
    }
    half   <- k / 2
    margin <- .z95 * sdUnif
    estimate <- bisect_d(half)
    ciLow    <- bisect_d(half - margin)
    ciHigh   <- bisect_d(half + margin)
    list(k=as.integer(k),
         estimate=round(estimate, 8), ciLow=round(ciLow, 8), ciHigh=round(ciHigh, 8),
         Z_sig =round(Z_sig,     8), p_sig =round(p_sig_v,  8),
         Z_bias=round(Z_bias,    8), p_bias=round(p_bias_v, 8))
  }

  # --- PCURVE-BCG-OR: BCG log-OR (dat.bcg, DL, k=13) ---
  cat("\n## PCURVE-BCG-OR: p-curve (BCG log-OR, DL)\n")
  .pc_bcg <- .js_pcurve(bcg_esc$yi, bcg_esc$vi)
  cat(sprintf("   k_sig=%d  rightSkewZ=%.8f  rightSkewP=%.8f  flatnessZ=%.8f  flatnessP=%.8f\n",
              .pc_bcg$k, .pc_bcg$rightSkewZ, .pc_bcg$rightSkewP,
              .pc_bcg$flatnessZ, .pc_bcg$flatnessP))
  BENCH[["PCURVE-BCG-OR"]] <- .pc_bcg

  # --- PUNIFORM-BCG-OR: BCG log-OR (dat.bcg, DL, k=13) ---
  cat("\n## PUNIFORM-BCG-OR: p-uniform (BCG log-OR, DL)\n")
  .pu_bcg <- .js_puniform(bcg_esc$yi, bcg_esc$vi, as.numeric(coef(res_bcg)))
  cat(sprintf("   k_sig=%d  estimate=%.8f  ciLow=%.8f  ciHigh=%.8f  Z_sig=%.8f  Z_bias=%.8f\n",
              .pu_bcg$k, .pu_bcg$estimate, .pu_bcg$ciLow, .pu_bcg$ciHigh,
              .pu_bcg$Z_sig, .pu_bcg$Z_bias))
  BENCH[["PUNIFORM-BCG-OR"]] <- .pu_bcg

  # --- Normand 1999 MD (DL) ---
  .norm_md_pu <- escalc("MD", m1i=m1i, sd1i=sd1i, n1i=n1i,
                         m2i=m2i, sd2i=sd2i, n2i=n2i, data=dat.normand1999)
  .res_norm_pu <- rma(yi, vi, data=.norm_md_pu, method="DL")

  # --- PCURVE-NORMAND-MD: Normand 1999 MD (DL, k=9) ---
  cat("\n## PCURVE-NORMAND-MD: p-curve (Normand 1999 MD, DL)\n")
  .pc_norm <- .js_pcurve(.norm_md_pu$yi, .norm_md_pu$vi)
  cat(sprintf("   k_sig=%d  rightSkewZ=%.8f  rightSkewP=%.8f  flatnessZ=%.8f  flatnessP=%.8f\n",
              .pc_norm$k, .pc_norm$rightSkewZ, .pc_norm$rightSkewP,
              .pc_norm$flatnessZ, .pc_norm$flatnessP))
  BENCH[["PCURVE-NORMAND-MD"]] <- .pc_norm

  # --- PUNIFORM-NORMAND-MD: Normand 1999 MD (DL, k=9) ---
  cat("\n## PUNIFORM-NORMAND-MD: p-uniform (Normand 1999 MD, DL)\n")
  .pu_norm <- .js_puniform(.norm_md_pu$yi, .norm_md_pu$vi, as.numeric(coef(.res_norm_pu)))
  cat(sprintf("   k_sig=%d  estimate=%.8f  ciLow=%.8f  ciHigh=%.8f  Z_sig=%.8f  Z_bias=%.8f\n",
              .pu_norm$k, .pu_norm$estimate, .pu_norm$ciLow, .pu_norm$ciHigh,
              .pu_norm$Z_sig, .pu_norm$Z_bias))
  BENCH[["PUNIFORM-NORMAND-MD"]] <- .pu_norm
}

# =================================================================
# Write structured JSON reference for diff_benchmarks.mjs
# Run: Rscript generate.R   then commit benchmark_reference.json
# =================================================================
BENCH[["__meta"]] <- list(
  metafor_version = as.character(packageVersion("metafor")),
  R_version       = paste(R.version$major, R.version$minor, sep = "."),
  generated       = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  blocks          = length(BENCH)
)
jsonlite::write_json(BENCH, "benchmark_reference.json",
                     auto_unbox = TRUE, digits = 8, pretty = FALSE)
cat("\nWrote benchmark_reference.json  (", length(BENCH), "blocks)\n")
