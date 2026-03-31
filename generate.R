# generate.R
# Reproducible benchmark expected values using the metafor R package.
#
# Each numbered block (1–41) corresponds to one entry in js/benchmarks.js and
# produces the yi, FE, RE, tau2, I2, and (for blocks 35–37) ciLow/ciHigh
# values used in that benchmark.
# Blocks 27–30, 32–34 use metafor escalc; block 31 (GOR) uses a manual R helper.
# Blocks 35–37 are CI method benchmarks (KH, t, PL) on the same 5-study log-RR
# dataset; only the CI bounds differ from the default normal/Wald CI.
#
# Publication bias blocks (PB-1 through PB-7) reproduce the expected values for
# the BCG Vaccine log-OR pub bias benchmark in js/benchmarks.js PUB_BIAS_BENCHMARKS.
# Block 39 covers the synthetic asymmetric funnel (second PUB_BIAS_BENCHMARKS entry).
#
# Requirements:
#   install.packages(c("metafor", "metadat"))
#   R >= 4.0, metafor >= 4.0
#
# Usage:
#   Rscript generate.R          # command line
#   source("generate.R")        # interactive session

suppressPackageStartupMessages({
  library(metafor)
  library(metadat)
})

cat("metafor", as.character(packageVersion("metafor")),
    "/ metadat", as.character(packageVersion("metadat")), "\n\n")

hdr <- function(n, label) cat(sprintf("\n## %d. %s\n", n, label))
sho <- function(res) {
  cat(sprintf("   beta=%.4f  se=%.4f  tau2=%.4f  I2=%.2f%%\n",
              as.numeric(coef(res)), as.numeric(res$se), res$tau2, res$I2))
}
yis <- function(esc) cat("   yi:", paste(round(esc$yi, 4), collapse=", "), "\n")

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
# yi = arcsin(sqrt(x/(n+1))) + arcsin(sqrt((x+1)/(n+1))),  vi = 1/(n+0.5)
# =================================================================
hdr(12, "PFT — Synthetic Freeman-Tukey proportion (DL)")
esc <- escalc("PFT", xi=x, ni=n, data=prop_dat)
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
# =================================================================
for (blk_meth in list(c(15,"HS"), c(16,"HE"), c(17,"ML"), c(18,"SJ"))) {
  blk  <- as.integer(blk_meth[1])
  meth <- blk_meth[2]
  hdr(blk, paste0("tau2 estimator test — ", meth, " (k=3, vi=1)"))
  res <- rma(yi, vi, data=tau_dat, method=meth)
  sho(res)
  cat(sprintf("   [all yi=FE=RE=%.4f since equal vi; only tau2 differs by method]\n",
              as.numeric(coef(res))))
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
esc <- escalc("IR", xi=x, ti=t, data=ir_dat)
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
cat(sprintf("   FE=%.4f  RE=%.4f  tau2=%.4f  I2=%.2f%%\n",
            as.numeric(coef(rma(yi, vi, data=bcg_esc, method="FE"))),
            as.numeric(coef(res_bcg)), res_bcg$tau2, res_bcg$I2))

# -----------------------------------------------------------------
# PB-1. Begg's rank correlation test
# ranktest() in metafor: Kendall tau between standardised residuals
# and their sampling variances. Reports tau, z (continuity-corrected),
# and two-tailed p.
# -----------------------------------------------------------------
cat("\n## PB-1. Begg's rank correlation test\n")
begg_res <- ranktest(res_bcg)
cat(sprintf("   tau=%.4f  z=%.4f  p=%.4f\n",
            begg_res$tau, begg_res$zval, begg_res$pval))

# -----------------------------------------------------------------
# PB-2. Egger's test
# regtest() with predictor="sei" and model="lm": OLS regression of
# Z = yi/sei on 1/sei (precision). Intercept tests bias.
# -----------------------------------------------------------------
cat("\n## PB-2. Egger's test\n")
egger_res <- regtest(res_bcg, model="lm", predictor="sei")
cat(sprintf("   intercept=%.4f  slope=%.4f  t=%.4f  p=%.4f  df=%d\n",
            egger_res$fit$coefficients["intrcpt", "Estimate"],
            egger_res$fit$coefficients["sei",     "Estimate"],
            egger_res$fit$coefficients["intrcpt", "t value"],
            egger_res$fit$coefficients["intrcpt", "Pr(>|t|)"],
            egger_res$ddf))

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

# -----------------------------------------------------------------
# PB-4. Fail-safe N (Rosenthal and Orwin)
# fsn() in metafor. type="Rosenthal" uses |zi| (absolute z-statistics).
# type="Orwin" uses FE pooled estimate with trivial threshold.
# -----------------------------------------------------------------
cat("\n## PB-4. Fail-safe N\n")
fsn_ros  <- fsn(yi, vi, data=bcg_esc, type="Rosenthal", alpha=0.05)
fsn_orw  <- fsn(yi, vi, data=bcg_esc, type="Orwin",     target=0.1)
cat(sprintf("   Rosenthal N_fs=%.1f\n", fsn_ros$fsnum))
cat(sprintf("   Orwin    N_fs=%.1f\n",  fsn_orw$fsnum))

# -----------------------------------------------------------------
# PB-5. Harbord test
# regtest() with predictor="sqrtvi" and model="lm": OLS regression of
# zi = (Oi - Ei)/sqrt(Vi) on sqrt(Vi). Avoids OR-SE artefactual corr.
# -----------------------------------------------------------------
cat("\n## PB-5. Harbord test\n")
harbord_res <- regtest(res_bcg, model="lm", predictor="sqrtvi")
cat(sprintf("   intercept=%.4f  interceptP=%.4f  df=%d\n",
            harbord_res$fit$coefficients["intrcpt", "Estimate"],
            harbord_res$fit$coefficients["intrcpt", "Pr(>|t|)"],
            harbord_res$ddf))

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

# -----------------------------------------------------------------
# PB-7. Trim-and-fill (Duval & Tweedie L0 estimator, DL)
# trimfill() in metafor. estimator="L0", method="DL".
# k0 = number of imputed studies; adjusted RE from the filled model.
# -----------------------------------------------------------------
cat("\n## PB-7. Trim-and-fill (L0, DL)\n")
tf_res <- trimfill(res_bcg, estimator="L0")
cat(sprintf("   k0=%d  adjustedRE=%.4f  adjustedTau2=%.4f\n",
            tf_res$k0, as.numeric(coef(tf_res)), tf_res$tau2))

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
for (i in seq_len(nrow(loo_res))) {
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
for (i in seq_len(nrow(inf_diag))) {
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

cat(sprintf("   %-10s  %6s  %8s  %8s  %8s  %8s  %8s\n",
            "Study", "hat", "stdResid", "cookD", "DFBETA", "deltaTau2", "RE_loo"))
for (i in 1:5) {
  cat(sprintf("   %-10s  %6.4f  %8.4f  %8.4f  %8.4f  %8.4f  %8.4f\n",
              inf_esc$label[i],
              hat[i], stdResid[i], cookD[i], DFBETA[i], deltaTau2[i], RE_loo[i]))
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

cat("\n=== Done ===\n")
