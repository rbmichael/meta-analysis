# Benchmark Reference Data

Raw data and expected meta-analytic values sourced from the metafor R package
(wviechtb.github.io/metafor) and metadat package test files. Used to populate
benchmarks.js for testing each effect type.

---

## BCG Vaccine Dataset (dat.bcg)

Source: Colditz et al. (1994). Colditz GA, Brewer TF, Berkey CS, et al. Efficacy
of BCG vaccine in the prevention of tuberculosis. *JAMA*, **271**(9), 698–702.
Verified against metafor test files.

2x2 table columns:
- a = tpos (TB cases in BCG group)
- b = tneg (no TB in BCG group)
- c = cpos (TB cases in control group)
- d = cneg (no TB in control group)

| Label                    |    a |     b |   c |     d |
|--------------------------|------|-------|-----|-------|
| Aronson 1948             |    4 |   119 |  11 |   128 |
| Ferguson & Simes 1949    |    6 |   300 |  29 |   274 |
| Rosenthal et al 1960     |    3 |   228 |  11 |   209 |
| Hart & Sutherland 1977   |   62 | 13536 | 248 | 12619 |
| Frimodt-Moller 1973      |   33 |  5036 |  47 |  5761 |
| Stein & Aronson 1953     |  180 |  1361 | 372 |  1079 |
| Vandiviere et al 1973    |    8 |  2537 |  10 |   619 |
| TPT Madras 1980          |  505 | 87886 | 499 | 87892 |
| Coetzee & Berjak 1968    |   29 |  7470 |  45 |  7232 |
| Rosenthal et al 1961     |   17 |  1699 |  65 |  1600 |
| Comstock et al 1974      |  186 | 50448 | 141 | 27197 |
| Comstock & Webster 1969  |    5 |  2493 |   3 |  2338 |
| Comstock et al 1976      |   27 | 16886 |  29 | 17825 |

### BCG as OR (log odds ratio) — metafor rma(..., measure="OR")

- FE:   -0.4361  (SE=0.0423, z=-10.319)
- RE (DL):  -0.7474, tau²=0.3663, I²=92.65%
- RE (REML): -0.7452, tau²=0.3378, I²=92.65%
- Q(df=12) = 163.1649, p < .0001
- Note: REML tau² value not confirmed directly from metafor test file;
  DL and ML (tau²=0.3025) are confirmed. Use DL for OR benchmark.

### BCG as RR (log risk ratio) — metafor rma(..., measure="RR")

Confirmed directly from metadat HTML documentation.

- FE:   -0.4303  (SE=0.0405, z=-10.625)
- RE (REML): -0.7145, tau²=0.3132, I²=92.22%
- RE (DL):   -0.7141, tau²=0.3088, I²=92.12%
- Q(df=12) = 152.2330, p < .0001

### BCG as RD (risk difference) — metafor rma(..., measure="RD")

- FE:   -0.0009  (z=-4.0448)
- RE (DL): -0.0071, tau²≈0.000050, I²=95.66%
- Q(df=12) = 276.4737

Note: REML tau² for RD not confirmed from source; use DL for RD benchmark.

### BCG as PHI (phi coefficient) — app formula

App formula: phi = (a·d − b·c) / √((a+b)(c+d)(a+c)(b+d)),  vi = (1−φ²)² / (N−1),  N = a+b+c+d

Per-study phi values (computed analytically):

| Label                    |     phi |
|--------------------------|--------:|
| Aronson 1948             | -0.1001 |
| Ferguson & Simes 1949    | -0.1635 |
| Rosenthal et al 1960     | -0.1067 |
| Hart & Sutherland 1977   | -0.0684 |
| Frimodt-Moller 1973      | -0.0092 |
| Stein & Aronson 1953     | -0.1798 |
| Vandiviere et al 1973    | -0.0677 |
| TPT Madras 1980          | +0.0005 |
| Coetzee & Berjak 1968    | -0.0164 |
| Rosenthal et al 1961     | -0.0947 |
| Comstock et al 1974      | -0.0110 |
| Comstock & Webster 1969  | +0.0089 |
| Comstock et al 1976      | -0.0003 |

- FE:     -0.012
- RE (DL): -0.048, tau²=0.001, I²=95.5%

Note: tau² is small in absolute terms (~0.001) but I² is high because the large-N
studies produce very small vi, so between-study variance dominates. Relative error
tau²_computed/tau²_expected ≈ 1.9% < 5% tolerance.

### BCG as meta-regression moderator: absolute latitude (ablat)

Used in step-4 regression benchmark. Absolute latitude values from dat.bcg$ablat
(metadat package). Same study order as the table above.

| Label                    | ablat |
|--------------------------|------:|
| Aronson 1948             |    44 |
| Ferguson & Simes 1949    |    55 |
| Rosenthal et al 1960     |    42 |
| Hart & Sutherland 1977   |    52 |
| Frimodt-Moller 1973      |    13 |
| Stein & Aronson 1953     |    44 |
| Vandiviere et al 1973    |    19 |
| TPT Madras 1980          |    13 |
| Coetzee & Berjak 1968    |    27 |
| Rosenthal et al 1961     |    42 |
| Comstock et al 1974      |    18 |
| Comstock & Webster 1969  |    33 |
| Comstock et al 1976      |    33 |

Expected from metafor rma(yi, vi, mods=~ablat, data=dat.bcg, method="REML"):
- intrcpt = -0.5769 (se=0.2312)
- ablat   = -0.0291 (se=0.0073)
- tau²    =  0.1012 (residual, vs 0.313 unconditional)
- QE(df=11) = 49.2071, p < .0001
- QM(df=1)  = 15.9024, p < .0001

---

## Normand 1999 Dataset (dat.normand1999)

Source: Normand SL (1999). Meta-analysis: Formulating, evaluating, combining,
and reporting. *Statistics in Medicine*, **18**(3), 321–359.
Data: stroke rehabilitation (specialist vs routine care). m1=specialist, m2=routine.
yi = m1 - m2 (negative = specialist better).

| Label              | n1  | m1  | sd1 | n2  | m2  | sd2 |
|--------------------|-----|-----|-----|-----|-----|-----|
| Edinburgh          | 155 |  55 |  47 | 156 |  75 |  64 |
| Orpington-Mild     |  31 |  27 |   7 |  32 |  29 |   4 |
| Orpington-Moderate |  75 |  64 |  17 |  71 | 119 |  29 |
| Orpington-Severe   |  18 |  66 |  20 |  18 | 137 |  48 |
| Montreal-Home      |   8 |  14 |   8 |  13 |  18 |  11 |
| Montreal-Transfer  |  57 |  19 |   7 |  52 |  18 |   4 |
| Newcastle          |  34 |  52 |  45 |  33 |  41 |  34 |
| Umea               | 110 |  21 |  16 | 183 |  31 |  27 |
| Uppsala            |  60 |  30 |  27 |  52 |  23 |  20 |

App formula: vi = sd1²/n1 + sd2²/n2

### Normand 1999 as MD — metafor rma(..., measure="MD")

Using app formula vi = sd1²/n1 + sd2²/n2 (matches metadat HTML doc, Q=238.9158):

- FE:   -3.4636  (SE=0.7648, CI=[-4.9627, -1.9646])
- RE (REML): -15.1060, tau²=684.6462, I²=96.65%
- RE (DL):   -13.9817, tau²=205.4094
- Q(df=8) = 238.9158

Note: The pooled-SD formula (as in the original paper) gives slightly different
Q=241.0590 and tau²=685.1965 but is NOT what the app uses.

### Normand 1999 as SMD (Hedges' g) — metafor rma(..., measure="SMD")

Per-study g values (confirmed within tolerance from metafor):

| Label              |       g |
|--------------------|---------|
| Edinburgh          | -0.3552 |
| Orpington-Mild     | -0.3479 |
| Orpington-Moderate | -2.3176 |
| Orpington-Severe   | -1.8880 |
| Montreal-Home      | -0.3840 |
| Montreal-Transfer  | +0.1721 |
| Newcastle          | +0.2721 |
| Umea               | -0.4246 |
| Uppsala            | +0.2896 |

Full 9-study REML pooled SMD: not confirmed from a single metafor test.
Confirmed: first 4 studies REML tau²=1.0090 (from metafor test file).

### Normand 1999 as SMDH (heteroscedastic Hedges' g) — app formula

App formula: sdi = √((sd1²+sd2²)/2),  d = (m1−m2)/sdi,  g = d·J,  df = n1+n2−2,  J = 1−3/(4·df−1)
  vi = J²·[(sd1²/n1 + sd2²/n2)/sdi² + d²/(2·df)]

Per-study g values (computed analytically):

| Label              |       g |
|--------------------|--------:|
| Edinburgh          | -0.3553 |
| Orpington-Mild     | -0.3465 |
| Orpington-Moderate | -2.3018 |
| Orpington-Severe   | -1.8880 |
| Montreal-Home      | -0.3993 |
| Montreal-Transfer  | +0.1742 |
| Newcastle          | +0.2726 |
| Umea               | -0.4494 |
| Uppsala            | +0.2926 |

- FE:      -0.411
- RE (REML): -0.538, tau²=0.782, I²=93.5%

REML tau² derived via Fisher-scoring (analysis.js algorithm, verified against Brent's method).

### Normand 1999 as ROM (log ratio of means) — app formula

App formula: yi = log(m1/m2),  vi = sd1²/(n1·m1²) + sd2²/(n2·m2²)

Per-study log(m1/m2) values:

| Label              |      yi |
|--------------------|--------:|
| Edinburgh          | -0.3102 |
| Orpington-Mild     | -0.0715 |
| Orpington-Moderate | -0.6202 |
| Orpington-Severe   | -0.7303 |
| Montreal-Home      | -0.2513 |
| Montreal-Transfer  | +0.0541 |
| Newcastle          | +0.2377 |
| Umea               | -0.3895 |
| Uppsala            | +0.2657 |

- FE:      -0.303
- RE (REML): -0.218, tau²=0.108, I²=94.6%

REML tau² derived analytically (Python Fisher-scoring).

---

## Morris (2008) Paired Dataset

Source: Morris SB (2008). Estimating effect sizes from pretest-posttest-control
group designs. *Organizational Research Methods*, **11**(2), 364–386.
Treatment arm only. r = pre-post correlation within each study.

| Label   | m_pre | m_post | sd_pre | sd_post |  n |    r |
|---------|-------|--------|--------|---------|---:|------|
| Study 1 |  30.6 |   38.5 |   15.0 |    11.6 | 20 | 0.47 |
| Study 2 |  23.5 |   26.8 |    3.1 |     4.1 | 50 | 0.64 |
| Study 3 |   0.5 |    0.7 |    0.1 |     0.1 |  9 | 0.77 |
| Study 4 |  53.4 |   75.9 |   14.5 |     4.4 | 10 | 0.89 |
| Study 5 |  35.6 |   36.0 |    4.7 |     4.6 | 14 | 0.44 |

App formula for MD_paired: sd_change = sqrt(sd_pre²+sd_post²-2*r*sd_pre*sd_post), vi = sd_change²/n
App formula for SMD_paired (SMCR): d = (m_post−m_pre)/sd_pre,  g = d·J(df),  df = n−1,  J = 1−3/(4·df−1)
  vi = J²·[2(1−r)/n + d²/(2·df)]

### Morris (2008) as MD_paired

Per-study values:

| Label   |    yi | sd_change |      vi |
|---------|------:|----------:|--------:|
| Study 1 | 7.900 |   14.0000 |  9.8000 |
| Study 2 | 3.300 |    3.1861 |  0.2030 |
| Study 3 | 0.200 |    0.0678 |  0.0005 |
| Study 4 | 22.50 |   10.7725 | 11.6046 |
| Study 5 | 0.400 |    4.9218 |  1.7303 |

Pooled (REML): beta=6.4162, tau²=73.57, I²=95.84%
Pooled (FE):   beta=0.2092  (SE=0.0226, CI=[0.1650, 0.2535], Q=96.09)

### Morris (2008) as SMD_paired

Per-study values (SMCR — pre-test SD standardisation; verified against metafor `escalc("SMCR")`):

| Label   |      d  |       g |      vi |
|---------|--------:|--------:|--------:|
| Study 1 |  0.5267 |  0.5056 | 0.05557 |
| Study 2 |  1.0645 |  1.0481 | 0.02518 |
| Study 3 |  2.0000 |  1.8065 | 0.24566 |
| Study 4 |  1.5517 |  1.4187 | 0.13022 |
| Study 5 |  0.0851 |  0.0801 | 0.07112 |

Pooled (DL):
- FE:  0.839
- RE:  0.892,  tau² = 0.2474,  I² = 78.1%
- Q(df=4) = 18.22

metafor verification:
```r
esc <- escalc("SMCR", m1i=c(38.5,26.8,0.7,75.9,36.0), m2i=c(30.6,23.5,0.5,53.4,35.6),
              sd1i=c(15.0,3.1,0.1,14.5,4.7), ni=c(20,50,9,10,14),
              ri=c(0.47,0.64,0.77,0.89,0.44))
rma(yi, vi, data=esc, method="DL")
```

Note: SMCC (change-score SD standardisation) is a separate effect type in the app
and uses a different formula — see generate.R block 24.

### Morris (2008) as SMD_paired (SMCC)

App formula: sd_change = √(sd_pre²+sd_post²−2·r·sd_pre·sd_post),  d = (m_post−m_pre)/sd_change
  g = d·J,  df = n−1,  J = 1−3/(4·df−1),  vi = J²·[2(1−r)/n + d²/(2·df)]

Per-study values:

| Label   | sd_change |       d |       g |
|---------|----------:|--------:|--------:|
| Study 1 |  14.0000  |  0.5643 |  0.5417 |
| Study 2 |   3.1860  |  1.0358 |  1.0198 |
| Study 3 |   0.0678  |  2.9488 |  2.6635 |
| Study 4 |  10.7736  |  2.0884 |  1.9096 |
| Study 5 |   4.9182  |  0.0813 |  0.0765 |

Pooled (DL):
- FE:  0.839
- RE:  1.038, tau²=0.373, I²=82.7%

Note: SMCC yi values differ from SMD_paired (SMCR) because the standardiser is
sd_change rather than sd_pre. For Study 3 especially, sd_pre=sd_post=0.1 and
r=0.77 gives sd_change=0.068 << sd_pre, inflating d and g substantially.

---

## Synthetic Correlation Dataset (ZCOR and COR benchmarks)

Synthetic 5-study dataset used to benchmark Fisher's z (ZCOR) and raw
correlation (COR) effect types. All expected values computed analytically;
no external software required for verification.

| Label   |    r |   n |
|---------|-----:|----:|
| Study 1 | 0.50 |  53 |
| Study 2 | 0.30 | 103 |
| Study 3 | 0.60 |  43 |
| Study 4 | 0.40 |  78 |
| Study 5 | 0.25 | 123 |

### ZCOR — Fisher's z transform

App formula: yi = atanh(r),  vi = 1/(n−3),  wi = n−3

Per-study z values:

| Label   |      yi (z) |    vi |
|---------|------------:|------:|
| Study 1 |     0.54931 | 1/50  |
| Study 2 |     0.30952 | 1/100 |
| Study 3 |     0.69315 | 1/40  |
| Study 4 |     0.42365 | 1/75  |
| Study 5 |     0.25541 | 1/120 |

Pooled (DL, z scale):
- W = 385, Σwi·zi = 148.567 → FE_z = 0.3859
- Q = 7.847, df = 4, c = 296.36 → τ² = 0.01298
- I² = (Q−df)/Q × 100 = 49.0%
- RE_z = 0.4130

Back-transformed to r: FE_r = tanh(0.3859) ≈ 0.368, RE_r = tanh(0.4130) ≈ 0.392

### COR — Raw correlation

App formula: yi = r,  vi = (1−r²)²/(n−1)

Per-study values:

| Label   |   yi |       vi |
|---------|-----:|---------:|
| Study 1 | 0.50 | 0.010817 |
| Study 2 | 0.30 | 0.008119 |
| Study 3 | 0.60 | 0.009752 |
| Study 4 | 0.40 | 0.009164 |
| Study 5 | 0.25 | 0.007204 |

Pooled (DL):
- W = 566.10, FE_r = 0.394
- Q = 9.361, df = 4, c = 468.22 → τ² = 0.01145
- I² = 57.3%
- RE_r = 0.403

---

## Synthetic Proportion Dataset (PR, PLO, PAS, PFT, PLN)

Synthetic 4-study dataset used to benchmark all single-proportion effect types.
All expected values computed analytically; no external software required.

| Label   |  x |   n |    p |
|---------|---:|----:|-----:|
| Study 1 | 10 | 100 | 0.10 |
| Study 2 | 30 | 100 | 0.30 |
| Study 3 | 20 | 100 | 0.20 |
| Study 4 | 40 | 100 | 0.40 |

### PR — Raw proportion

App formula: yi = p = x/n,  vi = p(1−p)/n

| Label   |   yi |      vi |
|---------|-----:|--------:|
| Study 1 | 0.10 | 0.00090 |
| Study 2 | 0.30 | 0.00210 |
| Study 3 | 0.20 | 0.00160 |
| Study 4 | 0.40 | 0.00240 |

Pooled (DL): FE=0.208, RE=0.246, tau²=0.01581, I²=90.7%

### PLO — Logit proportion

App formula: yi = logit(p) = log(p/(1−p)),  vi = 1/(n·p·(1−p))

| Label   |      yi |      vi |
|---------|--------:|--------:|
| Study 1 | -2.1972 |  0.1111 |
| Study 2 | -0.8473 |  0.0476 |
| Study 3 | -1.3863 |  0.0625 |
| Study 4 | -0.4055 |  0.0417 |

Pooled (DL): FE=−0.993, RE=−1.174, tau²=0.4197, I²=87.6%

### PAS — Arcsine square-root

App formula: yi = arcsin(√p),  vi = 1/(4n)  (equal for equal n)

| Label   |    yi |     vi |
|---------|------:|-------:|
| Study 1 | 0.322 | 0.0025 |
| Study 2 | 0.580 | 0.0025 |
| Study 3 | 0.464 | 0.0025 |
| Study 4 | 0.685 | 0.0025 |

Equal vi → RE = FE = 0.513. Pooled (DL): tau²=0.02186, I²=89.7%

### PFT — Freeman-Tukey double-arcsine

App formula: yi = arcsin(√(x/(n+1))) + arcsin(√((x+1)/(n+1))),  vi = 1/(n+0.5)

| Label   |      yi |      vi |
|---------|--------:|--------:|
| Study 1 |  0.6566 | 0.00995 |
| Study 2 |  1.1636 | 0.00995 |
| Study 3 |  0.9342 | 0.00995 |
| Study 4 |  1.3714 | 0.00995 |

Equal vi → RE = FE = 1.031. Pooled (DL): tau²=0.08445, I²=89.5%

Note: benchmarks.js uses yi=[0.656, 1.1636, 0.934, 1.371] (rounded to 3–4 dp).

### PLN — Log proportion

App formula: yi = log(p) = log(x/n),  vi = (1−p)/(n·p)

| Label   |      yi |      vi |
|---------|--------:|--------:|
| Study 1 | -2.3026 | 0.09000 |
| Study 2 | -1.2040 | 0.02333 |
| Study 3 | -1.6094 | 0.04000 |
| Study 4 | -0.9163 | 0.01500 |

Pooled (DL): FE=−1.226, RE=−1.452, tau²=0.2051, I²=86.9%

---

## Synthetic τ² Estimator Test Dataset

Synthetic k=3 dataset with equal variances used to isolate each τ² estimator
formula. Because all vi are equal, RE = FE for any τ² value.

| Label   | yi | vi |
|---------|---:|---:|
| Study 1 |  0 |  1 |
| Study 2 |  1 |  1 |
| Study 3 |  3 |  1 |

Derived quantities (shared by all methods):
- FE = RE = (0+1+3)/3 = 4/3 ≈ 1.333
- Q = Σwi·(yi−4/3)² = (4/3)²+(1/3)²+(5/3)² = 42/9 ≈ 4.667
- df = k−1 = 2,  I² = (Q−df)/Q = 57.1%
- ΣW = 3,  c = ΣW − ΣW²/ΣW = 2  (DL denominator)

τ² per estimator (all derived analytically):

| Method | Formula                                        | τ²     |
|--------|------------------------------------------------|--------|
| DL     | (Q−df)/c = (4.667−2)/2                         | 1.333  |
| HS     | (Q−df)/ΣW = (4.667−2)/3                        | 0.8889 |
| HE     | SS_uw/(k−1) − mean(vi) = (42/9)/2 − 1         | 1.3333 |
| ML     | fixed pt: Q/(1+τ²)² = k/(1+τ²) → τ²=5/9      | 0.5556 |
| SJ     | fixed pt: τ²(1+τ²) = 14/9 → τ²=(√65−3)/6    | 0.8437 |
| REML   | Fisher scoring (analysis.js)                   | 1.333  |

Note: DL and REML give the same τ² for this equal-vi dataset.

**PM note**: For equal vi, the PM fixed-point condition Q(τ\*) = k−1 reduces to
τ\* = Σ(yi−ȳ)²/(k−1) − v = HE. A separate unequal-vi dataset is used for the PM benchmark.

---

## Synthetic τ² Test — PM (Paule-Mandel, unequal vi)

Dataset: yi=[0,1,3], vi=[0.25,0.50,1.00] (k=3, unequal vi so PM ≠ HE).

| Label   | yi | vi   |
|---------|---:|-----:|
| Study 1 |  0 | 0.25 |
| Study 2 |  1 | 0.50 |
| Study 3 |  3 | 1.00 |

Fixed-weight quantities:
- w\_FE = [4, 2, 1], W = 7
- FE = (0·4 + 1·2 + 3·1)/7 = 5/7 ≈ **0.714**
- Q = 4·(5/7)² + 2·(2/7)² + 1·(16/7)² = (100+8+256)/49 = 364/49 ≈ 7.429
- df = 2,  I² = (7.429−2)/7.429 × 100 ≈ **73.1%**

τ²\_PM — Paule-Mandel iterative estimator:

The algorithm starts at τ²=0 and updates:

> τ²\_new = max(0, τ² + (Q(τ²) − (k−1)) / W(τ²))

where weights w\_i = 1/(v\_i + τ²). The fixed point satisfies Q(τ\*) = k−1 = 2. With the unequal
variances above, this gives τ\* ≈ **1.648** (RE ≈ **1.167**). Convergence verified to tol=1e-10
in both Python and JS, and cross-checked against `metafor::rma(method="PM")`.

For the equal-vi dataset (vi=1), PM = HE = 4/3. Because that result is already covered by the
HE benchmark, a distinct dataset is required here to exercise the iterative convergence path.

---

## Synthetic Hazard Ratio Dataset (HR)

Synthetic 4-study dataset. yi = log(HR), derived from reported HR and 95% CI.
All studies have se=0.25 (vi=0.0625) by design, so RE = FE for any τ².

App formula: yi = log(hr),  vi = (log(ci_hi)−log(ci_lo))² / (2·1.96)²

| Label   |     hr | ci_lo  | ci_hi  |   yi (log) |     vi |
|---------|-------:|-------:|-------:|-----------:|-------:|
| Study 1 | 0.6065 | 0.3716 | 0.9900 |     -0.500 | 0.0625 |
| Study 2 | 0.9048 | 0.5543 | 1.4770 |     -0.100 | 0.0625 |
| Study 3 | 0.4066 | 0.2491 | 0.6637 |     -0.900 | 0.0625 |
| Study 4 | 0.7408 | 0.4538 | 1.2092 |     -0.300 | 0.0625 |

Design: yi = [−0.5, −0.1, −0.9, −0.3]; hr = exp(yi); ci_lo/hi = exp(yi ∓ 1.96·0.25)

Pooled (DL):
- FE = RE = (−0.5−0.1−0.9−0.3)/4 = −0.450  (equal vi → RE = FE)
- Q  = 16·(0.05²+0.35²+0.45²+0.15²) = 5.600
- c  = 64 − 16 = 48
- tau² = (5.6−3)/48 = 0.054,  I² = (5.6−3)/5.6 = 46.4%

---

## Synthetic Incidence Rate Datasets (IRR and IR)

### IRR — Incidence rate ratio

Synthetic 4-study dataset. t1=t2=100 for all studies so yi = log(x1/x2).

App formula: yi = log((x1/t1)/(x2/t2)),  vi = 1/x1 + 1/x2

| Label   |  x1 |  t1 |  x2 |  t2 |      yi |      vi |
|---------|----:|----:|----:|----:|--------:|--------:|
| Study 1 |   5 | 100 |  20 | 100 | -1.3863 | 0.25000 |
| Study 2 |  18 | 100 |  20 | 100 | -0.1054 | 0.10556 |
| Study 3 |   8 | 100 |  20 | 100 | -0.9163 | 0.17500 |
| Study 4 |  14 | 100 |  20 | 100 | -0.3567 | 0.12143 |

Pooled (DL): FE=−0.537, RE=−0.605, tau²=0.138, I²=47.7%

### IR — Incidence rate (log)

Synthetic 4-study dataset with varying exposure times.

App formula: yi = log(x/t),  vi = 1/x

| Label   |   x |   t |      yi |    vi |
|---------|----:|----:|--------:|------:|
| Study 1 |  10 | 200 | -2.9957 | 0.100 |
| Study 2 |  25 | 300 | -2.4849 | 0.040 |
| Study 3 |   5 | 400 | -4.3820 | 0.200 |
| Study 4 |  20 | 250 | -2.5257 | 0.050 |

Pooled (DL): FE=−2.742, RE=−2.997, tau²=0.335, I²=82.0%

---

## Normand 1999 Specialist Arm (MN and MNLN benchmarks)

Single-group data reused from the two-group Normand 1999 dataset above.
The specialist-arm columns (m1i, sd1i, n1i) are treated as a single-group
measurement to benchmark the MN (raw mean) and MNLN (log mean) effect types.

| Label              |  m  |  sd |   n |
|--------------------|----:|----:|----:|
| Edinburgh          |  55 |  47 | 155 |
| Orpington-Mild     |  27 |   7 |  31 |
| Orpington-Moderate |  64 |  17 |  75 |
| Orpington-Severe   |  66 |  20 |  18 |
| Montreal-Home      |  14 |   8 |   8 |
| Montreal-Transfer  |  19 |   7 |  57 |
| Newcastle          |  52 |  45 |  34 |
| Umea               |  21 |  16 | 110 |
| Uppsala            |  30 |  27 |  60 |

### Specialist arm as MN (raw mean)

App formula: yi = m,  vi = sd²/n

| Label              |    yi |      vi |
|--------------------|------:|--------:|
| Edinburgh          |  55.0 | 14.2516 |
| Orpington-Mild     |  27.0 |  1.5806 |
| Orpington-Moderate |  64.0 |  3.8533 |
| Orpington-Severe   |  66.0 | 22.2222 |
| Montreal-Home      |  14.0 |  8.0000 |
| Montreal-Transfer  |  19.0 |  0.8596 |
| Newcastle          |  52.0 | 59.5588 |
| Umea               |  21.0 |  2.3273 |
| Uppsala            |  30.0 | 12.1500 |

Pooled (REML): FE=27.170, RE=38.325, tau²=408.928, I²=98.67%

Note: The very large tau² reflects genuine heterogeneity in stroke severity and
patient mix across the nine specialist units, not a computation error.
Montreal-Home (n=8) has the smallest weight and triggers a soft warning (n < 10)
but is not excluded.

### Specialist arm as MNLN (log mean)

App formula: yi = log(m),  vi = sd²/(n·m²)   [delta method for log(μ)]

| Label              |      yi |      vi |
|--------------------|--------:|--------:|
| Edinburgh          |  4.0073 | 0.00471 |
| Orpington-Mild     |  3.2958 | 0.00217 |
| Orpington-Moderate |  4.1589 | 0.00094 |
| Orpington-Severe   |  4.1897 | 0.00510 |
| Montreal-Home      |  2.6391 | 0.04082 |
| Montreal-Transfer  |  2.9444 | 0.00238 |
| Newcastle          |  3.9512 | 0.02203 |
| Umea               |  3.0445 | 0.00528 |
| Uppsala            |  3.4012 | 0.01350 |

Pooled (REML): FE=3.694, RE=3.523, tau²=0.316, I²=98.90%

Back-transformed RE: exp(3.523) ≈ 33.9 days (geometric mean length of stay).

---

## Synthetic Variability Dataset (CVR and VR benchmarks)

Synthetic 5-study dataset matching the profiles.js exampleData for the CVR and
VR effect types. All studies satisfy the soft-warning thresholds (n ≥ 28, CV < 1,
SD ratio < 4, means > 0).

| Label   |   m1 |  sd1 |  n1 |   m2 |  sd2 |  n2 |
|---------|-----:|-----:|----:|-----:|-----:|----:|
| Study 1 | 25.0 |  6.2 |  40 | 24.8 |  3.5 |  38 |
| Study 2 | 30.1 |  9.0 |  55 | 29.7 |  4.8 |  52 |
| Study 3 | 18.5 |  5.1 |  30 | 19.0 |  3.0 |  28 |
| Study 4 | 42.0 | 11.5 |  70 | 40.5 |  6.2 |  68 |
| Study 5 | 22.3 |  7.8 |  45 | 23.1 |  4.9 |  43 |

### CVR — Coefficient of variation ratio (log scale)

App formula: cv1 = sd1/m1,  cv2 = sd2/m2
yi = log(cv1/cv2),  vi = 1/(2(n1−1)) + cv1²/n1 + 1/(2(n2−1)) + cv2²/n2

| Label   |  cv1   |  cv2   |      yi |      vi |
|---------|-------:|-------:|--------:|--------:|
| Study 1 | 0.2480 | 0.1411 |  0.5638 | 0.02840 |
| Study 2 | 0.2990 | 0.1616 |  0.6152 | 0.02119 |
| Study 3 | 0.2757 | 0.1579 |  0.5573 | 0.03918 |
| Study 4 | 0.2738 | 0.1531 |  0.5814 | 0.01613 |
| Study 5 | 0.3498 | 0.2121 |  0.5001 | 0.02703 |

Pooled (DL): FE=RE=0.569, tau²=0.000, I²=0.0%

Back-transformed: exp(0.569) ≈ 1.77 — group 1 has ~77% higher CV than group 2.
tau²=0 because all five log-CVR values cluster tightly around 0.57.

### VR — Variability ratio (log SD ratio)

The VR benchmark uses the separate profiles.js VR exampleData, which differs
from the CVR table above (only sd and n are needed; means are irrelevant for VR).

App formula: yi = log(sd1/sd2),  vi = 1/(2(n1−1)) + 1/(2(n2−1))

| Label   |  sd1 |  n1 |  sd2 |  n2 |      yi |      vi |
|---------|-----:|----:|-----:|----:|--------:|--------:|
| Study 1 |  4.2 |  40 |  2.8 |  38 |  0.4055 | 0.02633 |
| Study 2 |  5.5 |  55 |  3.2 |  52 |  0.5416 | 0.01906 |
| Study 3 |  3.8 |  30 |  2.5 |  28 |  0.4187 | 0.03576 |
| Study 4 |  6.1 |  70 |  4.0 |  68 |  0.4220 | 0.01471 |
| Study 5 |  4.9 |  45 |  3.5 |  43 |  0.3365 | 0.02327 |

Pooled (DL): FE=RE=0.430, tau²=0.000, I²=0.0%

Note: vi_VR = vi_CVR − cv1²/n1 − cv2²/n2; the CV² terms drop out when means
are not part of the formula. The n values (40/38, 55/52, 30/28, 70/68, 45/43)
are shared between the two exampleData tables.

---

## Synthetic Generalised Odds Ratio Dataset (GOR benchmark)

Synthetic 4-study dataset with 3 ordered categories per study.
Group 1 (treatment) skews toward higher categories; group 2 (control) skews
toward lower categories, producing a consistent positive log-GOR.

| Label   | counts1 (group 1) | counts2 (group 2) |
|---------|-------------------|-------------------|
| Study 1 | 15, 20, 35        | 30, 25, 15        |
| Study 2 | 10, 25, 40        | 25, 30, 20        |
| Study 3 | 20, 30, 30        | 35, 30, 15        |
| Study 4 | 12, 18, 40        | 28, 32, 20        |

### GOR algorithm (gorFromCounts in utils.js)

Let p1[j] = c1[j]/N1 and p2[j] = c2[j]/N2 where N1=Σc1, N2=Σc2.

Define:
- L2[j] = P(Y₂ < j) = Σ_{i<j} p2[i]   (strict left CDF of group 2)
- H2[j] = P(Y₂ > j) = Σ_{i>j} p2[i]   (strict right tail of group 2)

Concordant and discordant probabilities:
- θ = P(Y₁ > Y₂) = Σⱼ p1[j]·L2[j]
- φ = P(Y₁ < Y₂) = Σⱼ p1[j]·H2[j]

Effect size: yi = log(θ/φ)

Variance (delta method):
- Group 1 contribution: V1θ = Σⱼ p1[j]·(L2[j]−θ)²/N1 ;  V1φ, Cov1 similarly
- Group 2 contribution: V2θ = Σₖ p2[k]·(P1gt[k]−θ)²/N2 ;  V2φ, Cov2 similarly
  where P1gt[k] = P(Y₁ > k) = Σ_{i>k} p1[i]
- vi = (V1θ+V2θ)/θ² + (V1φ+V2φ)/φ² − 2(Cov1+Cov2)/(θ·φ)

### Per-study GOR values

| Label   |    θ    |    φ    |      yi |      vi |
|---------|--------:|--------:|--------:|--------:|
| Study 1 | 0.5153  | 0.1837  |  1.0316 | 0.08381 |
| Study 2 | 0.5022  | 0.1778  |  1.0385 | 0.08152 |
| Study 3 | 0.4688  | 0.2109  |  0.7985 | 0.07159 |
| Study 4 | 0.5186  | 0.1757  |  1.0822 | 0.08248 |

Pooled (DL): FE=RE=0.981, tau²=0.000, I²=0.0%

Back-transformed: exp(0.981) ≈ 2.67 — the treatment group has about 2.7× higher
odds of scoring in a higher category than the control group.
tau²=0 because the log-GOR values are highly consistent across the four studies.

---

## Synthetic Partial Correlation Dataset (PCOR and ZPCOR benchmarks)

Synthetic 5-study dataset matching the profiles.js exampleData for both PCOR
and ZPCOR (the two types share identical input rows). All studies satisfy the
minimum-n requirements (n ≥ p+3 for PCOR, n ≥ p+4 for ZPCOR).

| Label   |    r |   n | p |
|---------|-----:|----:|---|
| Study 1 | 0.45 |  80 | 2 |
| Study 2 | 0.38 |  65 | 2 |
| Study 3 | 0.52 | 110 | 3 |
| Study 4 | 0.31 |  90 | 2 |
| Study 5 | 0.47 | 130 | 4 |

### PCOR — Raw partial correlation

App formula: yi = r,  vi = (1−r²)² / (n−p−1)

The denominator n−p−1 generalises the COR formula (which uses n−1) by
subtracting the number of covariates p. When p=0 the two formulas are
identical up to a factor of (n−1) vs (n−1), so PCOR reduces to COR exactly.

| Label   |   yi   |      vi |
|---------|-------:|--------:|
| Study 1 | 0.4500 | 0.00826 |
| Study 2 | 0.3800 | 0.01181 |
| Study 3 | 0.5200 | 0.00502 |
| Study 4 | 0.3100 | 0.00939 |
| Study 5 | 0.4700 | 0.00486 |

Pooled (DL): FE=RE=0.446, tau²=0.000, I²=0.0%

Note: Q=3.55 < df=4 so DL τ² floors to zero. The studies are deliberately
homogeneous — all partial correlations cluster near 0.43–0.52.

### ZPCOR — Fisher-z partial correlation

App formula: yi = atanh(r),  vi = 1/(n−p−3)

The denominator n−p−3 generalises the ZCOR formula (which uses n−3). When
p=0, ZPCOR reduces to ZCOR exactly. Back-transform: tanh(yi) → r scale.

| Label   | yi (z) |      vi |
|---------|-------:|--------:|
| Study 1 | 0.4847 | 0.01333 |
| Study 2 | 0.4001 | 0.01667 |
| Study 3 | 0.5763 | 0.00962 |
| Study 4 | 0.3205 | 0.01176 |
| Study 5 | 0.5101 | 0.00813 |

Pooled (DL): FE=RE=0.4704, tau²=0.000, I²=0.0%

Back-transformed pooled RE: tanh(0.4704) ≈ 0.4385

Note: vi = 1/(n−p−3) values:
- Study 1: 1/(80−2−3) = 1/75
- Study 2: 1/(65−2−3) = 1/60
- Study 3: 1/(110−3−3) = 1/104
- Study 4: 1/(90−2−3) = 1/85
- Study 5: 1/(130−4−3) = 1/123

---

## Heterogeneous Partial Correlation Dataset (Blocks 40–41, PCOR/ZPCOR, τ²>0)

A second 5-study dataset designed to produce τ²>0 with clear separation between FE
and RE estimates. Large-n studies have small r (precise, low effect); small-n studies
have large r (imprecise, high effect). This anti-correlation between precision and
effect size is a common pattern in publication-biased literatures and ensures the two
estimators diverge.

| Label   |    r |   n | p |
|---------|-----:|----:|---|
| Study 1 | 0.10 | 300 | 2 |
| Study 2 | 0.15 | 250 | 1 |
| Study 3 | 0.70 |  50 | 3 |
| Study 4 | 0.75 |  40 | 2 |
| Study 5 | 0.65 |  45 | 3 |

### Block 40 — PCOR heterogeneous (REML)

yi = r,  vi = (1−r²)² / (n−p−1)

| Label   |     yi |       vi |
|---------|-------:|---------:|
| Study 1 | 0.1000 | 0.003300 |
| Study 2 | 0.1500 | 0.003853 |
| Study 3 | 0.7000 | 0.005654 |
| Study 4 | 0.7500 | 0.005173 |
| Study 5 | 0.6500 | 0.008134 |

Pooled (REML): FE=0.396, RE=0.467, τ²=0.0970, I²=95.6%

RE (0.467) > FE (0.396) because REML down-weights the large-n precise studies
(which drive FE toward small r) and up-weights the small-n imprecise studies (which
have large r). Both estimates remain on the raw r scale.

### Block 41 — ZPCOR heterogeneous (REML)

yi = atanh(r),  vi = 1/(n−p−3)

| Label   |   yi (z) |       vi |
|---------|---------:|---------:|
| Study 1 |   0.1003 | 0.003390 |
| Study 2 |   0.1511 | 0.004065 |
| Study 3 |   0.8673 | 0.022727 |
| Study 4 |   0.9730 | 0.028571 |
| Study 5 |   0.7753 | 0.025641 |

Pooled (REML): FE=0.257, RE=0.551, τ²=0.1624, I²=92.7%

The Fisher-z transformation amplifies the FE/RE gap relative to raw PCOR
(|RE−FE|=0.294 vs 0.071) because z-scale vi values grow rapidly with |r|,
giving the large-r small-n studies even less FE weight on the z scale.
Back-transform of RE: tanh(0.551) ≈ 0.503.

`generate.R` Blocks 40–41 reproduce these values via `rma(method="REML")` in metafor.

---

## Synthetic Tetrachoric Correlation Dataset (RTET benchmark)

Synthetic 4-study dataset matching the profiles.js RTET exampleData. Each
study contributes a 2×2 contingency table of binary traits. All four tables
show a strong positive latent correlation (rho ≈ 0.65–0.81) with no zero
cells, so no continuity correction is applied.

| Label   |  a |  b |  c |  d |   N |
|---------|----|----|----|----|----|
| Study 1 | 40 | 10 | 10 | 40 | 100 |
| Study 2 | 30 | 15 | 12 | 43 | 100 |
| Study 3 | 25 |  8 |  9 | 38 |  80 |
| Study 4 | 35 | 12 | 11 | 42 | 100 |

### Tetrachoric correlation algorithm (tetrachoricFromCounts in utils.js)

The tetrachoric correlation ρ is the latent Pearson correlation that would
produce the observed 2×2 table under a bivariate normal model.

**Step 1 — Marginal thresholds**

Let N = a+b+c+d, p_row = (a+b)/N, p_col = (a+c)/N, p11 = a/N.
Convert marginal proportions to normal quantiles:
h = Φ⁻¹(p_row),  k = Φ⁻¹(p_col)

**Step 2 — Bisect for ρ**

Find ρ ∈ (−1, 1) such that:  Φ₂(h, k; ρ) = p11

where Φ₂(h,k;ρ) is the standard bivariate normal CDF evaluated by 20-point
Gauss-Legendre quadrature (64 bisection iterations; converges to ~1e-19).

**Step 3 — Delta-method variance**

Let φ₂(h,k;ρ) = exp(−(h²−2ρhk+k²)/(2(1−ρ²))) / (2π√(1−ρ²)) be the
bivariate normal density at the threshold point. Then:

vi = p_row·(1−p_row) · p_col·(1−p_col) / (N · φ₂(h,k;ρ)²)

**Analytic spot-check**

For the symmetric table (a=b=c=d): p_row=p_col=0.5, h=k=0.
The bisection yields ρ = sin(π·φ/2) where φ is the phi coefficient.
For Study 1: φ = (40·40−10·10)/(50·50) = 0.6, so ρ = sin(0.3π) ≈ 0.8090.
Verified to 6 decimal places against the Python port.

### Per-study tetrachoric values

| Label   | p_row  | p_col  |      h |      k |    rho |      vi |
|---------|-------:|-------:|-------:|-------:|-------:|--------:|
| Study 1 | 0.5000 | 0.5000 |  0.000 |  0.000 | 0.8090 | 0.00853 |
| Study 2 | 0.4500 | 0.4200 | -0.126 | -0.202 | 0.6545 | 0.01417 |
| Study 3 | 0.4125 | 0.4250 | -0.221 | -0.189 | 0.7765 | 0.01219 |
| Study 4 | 0.4700 | 0.4600 | -0.075 | -0.100 | 0.7485 | 0.01085 |

Pooled (DL): FE=RE=0.756, tau²=0.000, I²=0.0%

Back-transformed: identity (RTET is already on the correlation scale).
tau²=0 because all four studies show consistent strong latent correlation.

---

## CI Method Benchmarks

Three alternative CI methods — Knapp-Hartung (KH), t-distribution (t), and
profile likelihood (PL) — are benchmarked against the same 5-study synthetic
log-RR dataset. The normal/Wald CI (the implicit default for all earlier
benchmarks) is shown for reference but is not a separate benchmark entry.

### Synthetic CI Benchmark Dataset (5 studies, log-RR)

2×2 table columns: a/b = events/non-events in group 1; c/d = events/non-events in group 2.

| Label   |  a |  b |  c |  d |
|---------|----|----|----|-----|
| Study 1 | 15 | 85 | 30 | 70 |
| Study 2 | 20 | 80 | 25 | 75 |
| Study 3 | 10 | 90 | 35 | 65 |
| Study 4 | 25 | 75 | 20 | 80 |
| Study 5 | 12 | 88 | 28 | 72 |

**Per-study log-RR** (yi = log(p₁/p₂), vi = 1/a − 1/n₁ + 1/c − 1/n₂)

| Label   |      yi |      vi |
|---------|--------:|--------:|
| Study 1 | −0.6931 |  0.0800 |
| Study 2 | −0.2231 |  0.0700 |
| Study 3 | −1.2528 |  0.1086 |
| Study 4 | +0.2231 |  0.0700 |
| Study 5 | −0.8473 |  0.0990 |

Fixed-effect pooled: FE = −0.476, Q = 15.39, df = 4, I² = 74.1%

---

### Benchmark 35 — KH (Knapp-Hartung, DL)

**Method**: DL tau², Knapp-Hartung variance adjustment, t_{k−1} critical value.

**Algorithm**
1. Compute DL tau²: c = W − Σwᵢ²/W, tau² = max(0, (Q−(k−1))/c)
2. RE weights: wᵢ = 1/(vᵢ + tau²), W = Σwᵢ, RE = Σwᵢyᵢ/W
3. KH variance: varKH = Σwᵢ(yᵢ−RE)² / ((k−1)·W)
4. seRE = √varKH (replaces the standard √(1/W))
5. crit = t_{k−1, 0.975} = t_{4, 0.975} = 2.7764
6. CI = RE ± crit · seRE

**Computed values**

| Quantity   | Value     |
|------------|----------:|
| tau² (DL)  |   0.2385  |
| RE         |  −0.5364  |
| seRE (KH)  |   0.2552  |
| seRE (base)|   0.2543  |
| crit       |   2.7764  |
| ciLow      |  −1.245   |
| ciHigh     |   0.172   |

R reference: `rma(yi, vi, data=esc, method="DL", test="knha")`

---

### Benchmark 36 — t (t-distribution, DL)

**Method**: DL tau², standard seRE = √(1/W), t_{k−1} critical value (no KH variance inflation).

**Algorithm**
Steps 1–2 identical to KH. Then:

3. seRE = √(1/W)  (standard, not KH-adjusted)
4. crit = t_{k−1, 0.975} = 2.7764
5. CI = RE ± crit · seRE

**Computed values**

| Quantity   | Value     |
|------------|----------:|
| tau² (DL)  |   0.2385  |
| RE         |  −0.5364  |
| seRE       |   0.2543  |
| crit       |   2.7764  |
| ciLow      |  −1.242   |
| ciHigh     |   0.170   |

**Contrast with KH**: seRE_KH = 0.2552 vs seRE_base = 0.2543 — nearly equal here
because this dataset's weighted residuals happen to be close to the standard error.
The KH adjustment will differ more when studies are highly discrepant.

R reference: `rma(yi, vi, data=esc, method="DL", test="t")`

---

### Benchmark 37 — PL (Profile Likelihood, REML)

**Method**: REML tau² for point estimate; CI bounds invert the profile log-likelihood
using ML internally (Wald seRE/stat/pval remain REML-based).

**Algorithm**
1. Compute REML tau² (Fisher scoring with leverage correction) → tau²_REML
2. RE point estimate uses REML weights (as normal)
3. For CI bounds, compute ML tau² and muHat_ML separately:
   - logLik(μ, τ²) = −½ Σ[log(2π(vᵢ+τ²)) + (yᵢ−μ)²/(vᵢ+τ²)]
   - lMax = logLik(muHat_ML, tau²_ML)
   - cutoff = χ²_{1, 0.95}/2 = 3.8415/2 = 1.9207
   - profileTau2(μ): bisect τ² satisfying Σ(yᵢ−μ)²/(vᵢ+τ²)² = Σ1/(vᵢ+τ²)
   - Bisect μ where logLik(μ, profileTau2(μ)) = lMax − cutoff

**Computed values**

| Quantity         | Value     |
|------------------|----------:|
| tau² (REML)      |   0.2405  |
| RE (REML)        |  −0.5365  |
| tau² (ML)        |   0.1751  |
| muHat (ML)       |  −0.5310  |
| lMax             |  −3.7343  |
| cutoff           |   1.9207  |
| ciLow  (PL)      |  −1.095   |
| ciHigh (PL)      |   0.003   |

**Contrast with t/KH**: PL bounds are asymmetric relative to RE (lower bound is
−0.558 from RE; upper bound is +0.540 from RE) compared to the symmetric ±0.706
of the t CI. This reflects the asymmetric likelihood surface when tau² is near zero
on one side of the mean.

R reference: `rma(yi, vi, data=esc, method="REML")` then `confint(res)`
(metafor's `confint` returns profile likelihood CIs for the overall mean).

---

### CI comparison across methods (same dataset)

| Method  | tauMethod | RE     | seRE   | crit  | ciLow  | ciHigh | Width  |
|---------|-----------|-------:|-------:|------:|-------:|-------:|-------:|
| normal  | DL        | −0.536 | 0.2543 | 1.960 | −1.035 | −0.038 | 0.997  |
| t       | DL        | −0.536 | 0.2543 | 2.776 | −1.242 |  0.170 | 1.412  |
| KH      | DL        | −0.536 | 0.2552 | 2.776 | −1.245 |  0.172 | 1.417  |
| PL      | REML      | −0.537 | 0.2551 | 1.960 | −1.095 |  0.003 | 1.098  |

The normal CI excludes zero (upper bound −0.038) while t, KH, and PL all include
zero. PL is narrower than t/KH because the profile likelihood accounts for
uncertainty in τ² directly rather than multiplying seRE by a larger critical value.

---

## Publication Bias Benchmarks (Phase 6)

One benchmark entry: BCG Vaccine, 13 studies, log OR (DL). All seven publication
bias / small-study-effects tests are exercised on this single dataset.

### Dataset: BCG Vaccine log OR (13 studies)

Source: Colditz et al. (1994) JAMA 271:698–702. `dat.bcg` in metafor.
Same 13 two-by-two tables used in the OR, RR, and RD benchmarks above.
Effect measure: log(OR) = ln(ad/bc),  vi = 1/a + 1/b + 1/c + 1/d.

| Study                    |   a |      b |   c |      d |      yi |      vi |
|--------------------------|----:|-------:|----:|-------:|--------:|--------:|
| Aronson 1948             |   4 |    119 |  11 |    128 | −0.9387 | 0.35713 |
| Ferguson & Simes 1949    |   6 |    300 |  29 |    274 | −1.6662 | 0.20813 |
| Rosenthal 1960           |   3 |    228 |  11 |    209 | −1.3863 | 0.43341 |
| Hart & Sutherland 1977   |  62 |  13536 | 248 |  12619 | −1.4564 | 0.02031 |
| Frimodt-Moller 1973      |  33 |   5036 |  47 |   5761 | −0.2191 | 0.05195 |
| Stein & Aronson 1953     | 180 |   1361 | 372 |   1079 | −0.9581 | 0.00991 |
| Vandiviere 1973          |   8 |   2537 |  10 |    619 | −1.6338 | 0.22701 |
| TPT Madras 1980          | 505 |  87886 | 499 |  87892 |  0.0120 | 0.00401 |
| Coetzee & Berjak 1968    |  29 |   7470 |  45 |   7232 | −0.4717 | 0.05698 |
| Rosenthal 1961           |  17 |   1699 |  65 |   1600 | −1.4012 | 0.07542 |
| Comstock 1974            | 186 |  50448 | 141 |  27197 | −0.3408 | 0.01253 |
| Comstock & Webster 1969  |   5 |   2493 |   3 |   2338 |  0.4466 | 0.53416 |
| Comstock 1976            |  27 |  16886 |  29 |  17825 | −0.0173 | 0.07164 |

Pooled (DL): FE = −0.436, RE = −0.436, τ² = 0.269, I² = 92.3%.

---

### Benchmark PB-1: Begg's rank correlation test

**Algorithm** (Begg & Mazumdar 1994):
1. Adjust each effect for FE pooled estimate (centering on FE; rank on raw yi
   is equivalent since the linear offset cancels in pairwise sign comparisons).
2. Compute Kendall's S: for each pair (i,j), i<j:
   S += sign(vi_i − vi_j) × sign(yi_i − yi_j)
3. τ_b = S / (k(k−1)/2)
4. Var(S) = k(k−1)(2k+5)/18 (no ties in this dataset)
5. z = (S − sign(S)) / √Var(S)  (continuity-corrected)
6. p = 2·Φ(−|z|)

**Derivation** (k=13, max possible |S|=78):

S = −10  →  τ_b = −10/78 = −0.1282

Var(S) = 13·12·31/18 = 269.33  →  √Var = 16.41

z = (−10 − (−1)) / 16.41 = −9/16.41 = −0.549

p = 2·Φ(−0.549) = 0.583

| Statistic | Value   |
|-----------|--------:|
| S         | −10     |
| τ_b       | −0.128  |
| z         | −0.549  |
| p         |  0.583  |

---

### Benchmark PB-2: Egger's test

**Algorithm** (Egger et al. 1997):
OLS regression of Zᵢ = yᵢ/SEᵢ on Xᵢ = 1/SEᵢ (precision).

- slope     = Cov(X,Z)/Var(X)
- intercept = mean(Z) − slope·mean(X)
- s² = RSS/(k−2),  SE(intercept) = s·√(1/k + mean(X)²/Σ(Xᵢ−mean(X))²)
- t = intercept / SE(intercept),  p = 2·t_{k−2}(−|t|)

**Derivation** (k=13, df=11):

mean(X) = 12.038,  mean(Z) = −2.475

Cov(X,Z) = −23.90 / 169.65 = −0.1409  (slope denominator Σ(Xᵢ−mean(X))²)

Wait — computed directly:
slope = −0.1571,  intercept = −2.3453

RSS = 56.33,  s = √(56.33/11) = 2.262
SE(intercept) = 2.262·√(1/13 + 12.038²/169.65) = 1.557
t = −2.3453/1.557 = −1.507,  p = 0.160  (df=11)

| Statistic | Value   |
|-----------|--------:|
| intercept | −2.345  |
| slope     | −0.157  |
| t         | −1.507  |
| p         |  0.160  |

The intercept (−2.345) measures funnel asymmetry; a non-zero intercept suggests
small-study effects. Here p=0.160 does not reach the conventional 0.10 threshold.

---

### Egger synthetic unit-test dataset (k=4)

A minimal hand-calculable dataset where **all OLS intermediate quantities are exact**
(no rounding at any step). Designed so that X = 1/SE and Z = yi/SE are small integers.

| Study | yi   | SE  | X = 1/SE | Z = yi/SE |
|-------|------|-----|----------|-----------|
| S1    | −1.0 | 0.5 | 2        | −2        |
| S2    | −1.0 | 1.0 | 1        | −1        |
| S3    | −0.5 | 0.5 | 2        | −1        |
| S4    |  1.0 | 1.0 | 1        |  1        |

**OLS derivation (exact):**

- mean(X) = 1.5,  mean(Z) = −0.75
- num = Σ(Xᵢ−1.5)(Zᵢ+0.75) = (0.5)(−1.25) + (−0.5)(−0.25) + (0.5)(−0.25) + (−0.5)(1.75) = **−1.5**
- den = Σ(Xᵢ−1.5)² = 0.25+0.25+0.25+0.25 = **1.0**
- **slope** = −1.5 / 1.0 = **−1.5** (exact)
- **intercept** = −0.75 − (−1.5)(1.5) = **1.5** (exact)
- Fitted values: [−1.5, 0, −1.5, 0] for X=[2,1,2,1]
- Residuals: [−0.5, −1, 0.5, 1]
- RSS = 0.25 + 1 + 0.25 + 1 = **2.5** (exact),  df = 2
- σ² = 2.5/2 = 1.25
- SE(intercept) = √(1.25 · (1/4 + 1.5²/1.0)) = √(1.25 · 2.5) = **√3.125** ≈ 1.76777
- **t** = 1.5 / √3.125 = 3/(2√3.125) ≈ **0.84853**,  df = 2
- **p** = 2·(1 − t₂(|t|)) ≈ **0.48550** (exact via closed form for df=2: p = 1 − |t|/√(t²+2))

All values confirmed against `eggerTest()` to floating-point precision (< 2×10⁻¹⁶).
Note: this dataset is **symmetric** (p≈0.49 ≫ 0.10) — it tests the regression mechanics,
not asymmetry detection. The BCG benchmark (p=0.160) remains the primary asymmetry test.

---

### Synthetic asymmetric funnel (k=6, PUB_BIAS_BENCHMARKS entry 2)

A second benchmark designed to exercise the **significant-asymmetry path** (p < 0.05).
Data follow a small-study-effect pattern: imprecise studies have disproportionately large
effects, as expected under publication bias.

| Study | yi   | vi     | SE   |
|-------|------|--------|------|
| S1    | −0.1 | 0.0400 | 0.20 |
| S2    |  0.3 | 0.0900 | 0.30 |
| S3    |  0.1 | 0.0225 | 0.15 |
| S4    |  0.9 | 0.3600 | 0.60 |
| S5    |  1.4 | 0.6400 | 0.80 |
| S6    |  0.5 | 0.1600 | 0.40 |

**Egger test output** (verified by `eggerTest()` to floating-point precision):

| Statistic | Value    |
|-----------|--------:|
| intercept |  1.917  |
| slope     | −0.286  |
| se        |  0.504  |
| t         |  3.804  |
| df        |  4      |
| p         |  0.019  |

The intercept (1.917) is substantially positive and statistically significant (p=0.019 < 0.05),
confirming asymmetry. The `generate.R` Block 39 (`regtest(rma(..., method="FE"), model="lm")`)
will reproduce these values when R/metafor is available.

---

### Benchmark PB-3: FAT-PET test

**Algorithm** (Stanley & Doucouliagos 2014 / Egger family):
WLS regression of yᵢ on SEᵢ with weights wᵢ = 1/vᵢ.

- PET (Precision Effect Test): intercept β₀ ≈ true effect size (at SE=0)
- FAT (Funnel Asymmetry Test): slope β₁ ≈ bias indicator

This is a re-parametrisation of Egger's regression:
FAT-PET intercept = Egger slope = −0.157 (PET estimate)
FAT-PET slope     = Egger intercept = −2.345 (FAT / bias)

**Derivation** (k=13, df=11):

WLS design: X = [1, SEᵢ], w = 1/vᵢ

intercept = −0.1571  (PET; p = 0.521 → effect not significant)
slope     = −2.3453  (FAT; p = 0.160 → asymmetry not significant)

| Statistic    | Value   |
|--------------|--------:|
| intercept    | −0.157  |
| interceptP   |  0.521  |
| slope        | −2.345  |
| slopeP       |  0.160  |

---

### Benchmark PB-4: Fail-safe N (Rosenthal & Orwin)

**Algorithm:**

*Rosenthal (1979)*: How many null studies (yᵢ = 0) are needed to push the
combined effect to non-significance?

  sumZ = Σ |yᵢ|/SEᵢ  (absolute z-statistics; all studies counted positive)
  N_fs = (sumZ / z_{α})² − k,  z_{α} = Φ⁻¹(0.95) = 1.6449

*Orwin (1983)*: How many null studies to reduce |RE_FE| below a trivial threshold?

  N_orwin = k · (|FE| − trivial) / trivial  (default trivial = 0.1)

**Derivation** (k=13):

sumZ = Σ|zᵢ| = 42.555
N_Rosenthal = (42.555/1.6449)² − 13 = (25.870)² − 13 = 669.3 − 13 = 656.3 ≈ 656

FE = −0.436
N_Orwin = 13 · (0.436 − 0.1) / 0.1 = 13 · 3.36 = 43.7 ≈ 44

| Statistic  | Value |
|------------|------:|
| rosenthal  |   656 |
| orwin      |    44 |

---

### Benchmark PB-5: Harbord test

**Algorithm** (Harbord et al. 2006, Stat Med):
Modified Egger test for OR studies. For each 2×2 table:

  Eᵢ = (aᵢ+bᵢ)(aᵢ+cᵢ)/Nᵢ  (expected events under H₀)
  Vᵢ = (aᵢ+bᵢ)(cᵢ+dᵢ)(aᵢ+cᵢ)(bᵢ+dᵢ) / (Nᵢ²(Nᵢ−1))
  zᵢ = (aᵢ − Eᵢ) / √Vᵢ

OLS regression of zᵢ on √Vᵢ; test H₀: intercept = 0.

Avoids the artefactual correlation between log(OR) and SE that inflates
Egger's test for odds ratio outcomes.

**Derivation** (k=13, df=11):

intercept = −2.093,  interceptP = 0.235
(p=0.235; not significant — no strong evidence of asymmetry by this test)

| Statistic    | Value   |
|--------------|--------:|
| intercept    | −2.093  |
| interceptP   |  0.235  |

---

### Benchmark PB-6: Peters test

**Algorithm** (Peters et al. 2006, JAMA):
WLS regression of yᵢ on 1/Nᵢ with weights wᵢ = 1/vᵢ.

  Nᵢ = aᵢ + bᵢ + cᵢ + dᵢ  (total sample size)

Intercept β₀ ≈ true effect at infinite N; tests H₀: β₁ = 0 (no N-dependent bias).

**Derivation** (k=13, df=11):

intercept = −0.357,  interceptP = 0.045
(p=0.045; marginally significant — larger studies show less protection)

| Statistic    | Value   |
|--------------|--------:|
| intercept    | −0.357  |
| interceptP   |  0.045  |

Note: Peters p=0.045 reaches the 5% threshold while Egger/Harbord do not.
The three tests disagree on borderline asymmetry; this is a known property of the
BCG dataset (directional but partly explained by latitude, not pure publication bias).

---

### Benchmark PB-7: Trim-and-fill (Duval & Tweedie L₀ estimator)

**Algorithm** (Duval & Tweedie 2000, Biometrics):

1. Pool RE to get initial center.
2. Compute L₀:
   - For each study: dᵢ = yᵢ − center; rank |dᵢ| (smallest = rank 1)
   - Determine larger side (more studies above or below center)
   - Tₙ = sum of ranks for studies on the larger side
   - L₀ = round(max(0, (4Tₙ − k(k+1)/2) / (2k−1)))
3. If L₀ changed, trim the L₀ most extreme studies from the larger side,
   re-pool the trimmed set, update center; repeat until convergence.
4. Mirror the L₀ trimmed studies around the converged center:
   yᵢ_filled = 2·center − yᵢ
5. Add filled studies to original set; re-pool for adjusted RE.

**Derivation** (k=13, tauMethod=DL):

Initial center (DL RE) ≈ −0.436. The BCG dataset has pronounced left-side
asymmetry (most studies show protection, but magnitudes differ strongly), so
the L₀ estimator detects a very large imbalance.

Convergence: center → 0.014  (after iterative trimming)
k0 = 10  (10 mirror studies imputed)

Augmented dataset: 13 original + 10 filled = 23 studies
Adjusted RE (DL, 23 studies) = 0.025

| Statistic   | Value  |
|-------------|-------:|
| k0          |     10 |
| adjustedRE  |  0.025 |

The extreme k0=10/13 reflects BCG's well-known directional asymmetry, which is
largely attributable to trial latitude (higher-latitude trials show stronger
protection) rather than pure publication bias. The adjusted RE near zero is a
statistical artefact of the L₀ estimator over-correcting; the trim-and-fill
result should be interpreted cautiously for this dataset.

---

## Future work: verify_benchmarks.py (Phase 6)

`verify_benchmarks.py` currently covers the 37 entries in `BENCHMARKS` (Phase 1–5).
It does **not** yet cover `PUB_BIAS_BENCHMARKS`. Extending it would require porting
the following algorithms into pure Python (stdlib only, matching the JS implementations):

| Function       | Algorithm to port                                                    |
|----------------|----------------------------------------------------------------------|
| `beggTest`     | Kendall S + continuity-corrected z, normal p-value                  |
| `eggerTest`    | OLS of Z=y/se on 1/se; t-distribution p-value (already have t-CDF) |
| `fatPetTest`   | WLS of y on se with 1/vi weights; t-distribution p-values           |
| `failSafeN`    | Rosenthal (absolute z) + Orwin; normal quantile (already have it)   |
| `harbordTest`  | OLS of (O−E)/√V on √V per 2×2 table; t-distribution p-value        |
| `petersTest`   | WLS of y on 1/N with 1/vi weights; t-distribution p-value           |
| `trimFill`     | Duval-Tweedie L₀ iterative trimming + mirror imputation + meta()    |

The t-distribution CDF (`_t_cdf`) and normal quantile are already implemented.
Most of the regressions are simple WLS; the main new piece is `trimFill`, which
calls `pool()` internally in each iteration.

**Pending user approval** before implementing.

---

## Influence / LOO Benchmarks (Phase 7)

One benchmark entry: 5-study synthetic log-RR dataset (same data as CI-method
benchmarks 35–37). `tauMethod = "DL"`.

### Algorithms

All statistics mirror the `influenceDiagnostics()` implementation in
`js/analysis.js`. Full-model quantities (RE, τ², W) are computed once; then for
each study i the leave-one-out (LOO) model is run on the remaining k−1 studies.

**Full-model RE weights**

  wᵢ = 1 / (vᵢ + τ²_full)
  W  = Σ wᵢ

**Hat value** (leverage; fraction of total RE weight held by study i)

  hᵢ = wᵢ / W

**Standardised residual**

  rᵢ = (yᵢ − RE_full) / √(vᵢ + τ²_full)

**LOO RE and seRE** — run `meta(studies \ {i}, tauMethod)`; yields RE_loo, τ²_loo, seRE_loo.

**DFBETA** (standardised shift in pooled estimate on study removal)

  DFBETAᵢ = (RE_full − RE_loo) / seRE_loo

**ΔTau²**

  Δτ²ᵢ = τ²_full − τ²_loo

**Cook's distance** (squared shift in RE relative to its variance)

  Dᵢ = (RE_full − RE_loo)² × W

**Flag thresholds** (regression-analogy conventions, k = number of studies)

| Flag           | Criterion         |
|----------------|-------------------|
| `outlier`      | \|rᵢ\| > 2       |
| `influential`  | \|DFBETAᵢ\| > 1  |
| `highLeverage` | hᵢ > 2/k         |
| `highCookD`    | Dᵢ > 4/k         |

---

### Dataset: 5-study synthetic log-RR

| Study   |  a |  b |  c |  d |      yᵢ |      vᵢ |
|---------|---:|---:|---:|---:|--------:|--------:|
| Study 1 | 15 | 85 | 30 | 70 | −0.6931 | 0.08000 |
| Study 2 | 20 | 80 | 25 | 75 | −0.2231 | 0.07000 |
| Study 3 | 10 | 90 | 35 | 65 | −1.2528 | 0.10857 |
| Study 4 | 25 | 75 | 20 | 80 |  0.2231 | 0.07000 |
| Study 5 | 12 | 88 | 28 | 72 | −0.8473 | 0.09905 |

Full DL meta: **FE = −0.476, RE = −0.536, τ² = 0.239, I² = 74.1%**

W = 15.4646, seRE = 0.2543

Flag thresholds (k=5): highLeverage > 0.400, highCookD > 0.800

---

### Derivation table

| Study   | RE\_loo | τ²\_loo |   hat  | Cook's D |    r    | DFBETA  |  Δτ²   |
|---------|--------:|--------:|-------:|---------:|--------:|--------:|-------:|
| Study 1 | −0.5027 |  0.3298 | 0.2030 |   0.0176 | −0.2778 | −0.1045 | −0.0913|
| Study 2 | −0.6244 |  0.3283 | 0.2096 |   0.1199 |  0.5639 |  0.2727 | −0.0898|
| Study 3 | −0.3679 |  0.1542 | 0.1863 |   0.4390 | −1.2159 | −0.6975 |  0.0843|
| Study 4 | −0.7251 |  0.0958 | 0.2096 |   0.5507 |  1.3674 |  0.8799 |  0.1427|
| Study 5 | −0.4658 |  0.2881 | 0.1915 |   0.0770 | −0.5351 | −0.2322 | −0.0496|

All boolean flags are **false** for every study on this dataset — no study
clears any threshold. This is by design: the flag logic is already exercised by
purpose-built unit tests in the Cook's D / hat value section of `tests.js`
(datasets C and D). The benchmark focuses on numerical accuracy of the
continuous statistics.

**Notable observations:**

- **Study 3** (most extreme negative effect, yi=−1.253): removing it raises RE
  from −0.536 to −0.368 and drops τ² by 0.084 — it pulls the pooled estimate
  negative and inflates heterogeneity.
- **Study 4** (sole positive effect, yi=+0.223): removing it drops RE to −0.725
  and reduces τ² by 0.143 (largest Δτ²). Cook's D=0.551 and DFBETA=0.880 are
  the highest in the set, approaching but not reaching the influential threshold.
- **Studies 2 & 4** share identical vi (0.070) and therefore identical hat values
  (0.2096) and identical RE weights.

---

### Tolerances

| Field          | Tolerance               | Rationale                                   |
|----------------|-------------------------|---------------------------------------------|
| `RE_loo`       | abs 0.001               | Pooled estimates on a stable log scale      |
| `tau2_loo`     | 5% relative             | Spans a wide range (0.096 – 0.330)          |
| `hat`          | abs 0.001               | Fractions summing to 1; stable              |
| `cookD`        | abs 0.001               | Squared shift; small values need abs tol    |
| `stdResidual`  | abs 0.001               | Dimensionless; stable                       |
| `DFBETA`       | abs 0.001               | Dimensionless; stable                       |
| `deltaTau2`    | abs 0.005               | Difference of two τ² estimates; noisier     |
| boolean flags  | exact equality          | Deterministic threshold comparisons         |

---

## Future work: verify_benchmarks.py effect-type coverage

`verify_benchmarks.py` currently verifies approximately 20 of the 38 effect types in
`BENCHMARKS` (the core binary, continuous, proportion, and a few specialist types). The
following 16 effect types have JS benchmark entries but **no Python-side formula
verification**:

| Effect type | Description                                      | Missing formula(s)                       |
|-------------|--------------------------------------------------|------------------------------------------|
| `GOR`       | Generalised odds ratio (ordered categories)      | `gorFromCounts()` Agresti formula        |
| `ROM`       | Ratio of means                                   | `log(m1/m2)`, vi from SD/N              |
| `CVR`       | Log coefficient-of-variation ratio               | `log(cv1/cv2)`, vi from SD/N            |
| `VR`        | Log variance ratio                               | `log(s1²/s2²)`, vi from N               |
| `RTET`      | Tetrachoric correlation                          | `tetrachoricFromCounts()` Newton solver  |
| `HR`        | Hazard ratio (log scale)                         | Back-computed from reported HR + 95% CI |
| `IRR`       | Incidence rate ratio                             | `log(r1/r2)`, vi = 1/a + 1/c           |
| `IR`        | Incidence rate (single-arm)                      | `log(a/t)`, vi = 1/a                    |
| `MN`        | Single mean (raw)                                | `yi = mean`, vi = sd²/n                 |
| `MNLN`      | Single mean (log-transformed)                    | `yi = log(mean)`, vi delta-method       |
| `SMCC`      | Change-score SD standardizer                     | Morris SMCR via pooled SD               |
| `PHI`       | Phi coefficient from 2×2 table                   | `phi = (ad−bc)/√(r1r2c1c2)`            |
| `MD_paired` | Paired mean difference                           | `yi = md`, vi from paired SE            |
| `SMD_paired`| Paired standardized MD (Morris)                  | Morris SMCR formula                     |
| `SMDH`      | Heteroscedastic SMD (Bonett 2009)                | Bonett vi formula                       |
| CI methods  | KH / t-dist / profile-likelihood CI variants     | CI construction formulas                |

Each entry would require porting the corresponding `compute()` branch from
`js/profiles.js` into Python (stdlib only), adding a test dataset in `BENCHMARKS`,
and extending `run_all()` with the appropriate expected-value checks.

The effect-type formulas themselves are already tested exhaustively in `js/tests.js`
(unit tests + benchmark runner). Porting to Python adds an independent cross-check
but is lower priority than the JS coverage.

### Note: PCOR and ZPCOR are already covered in verify_benchmarks.py

`PCOR` and `ZPCOR` were previously listed in this table but are **fully implemented**
in `verify_benchmarks.py`:

- `compute_PCOR()` — formula: `yi = r`, `vi = (1−r²)² / (n−p−1)`
- `compute_ZPCOR()` — formula: `yi = atanh(r)`, `vi = 1 / (n−p−3)`
- `PCOR_DATA` (5-study synthetic dataset, identical to `js/benchmarks.js`) is defined
- Both types have `BENCHMARKS` entries that check per-study yi, FE, RE, tau2, and I2

**Remaining Python gap**: both Python benchmarks use the homogeneous dataset (τ²=0,
RE=FE). A heterogeneous benchmark (τ²>0, RE≠FE) is not yet present on the Python
side. The JS side will gain heterogeneous PCOR/ZPCOR benchmarks as part of the
ongoing test-improvement work (Steps 4–5 of that plan); porting them to Python is
deferred pending user approval.

---

## Retained legacy τ² estimators (not in UI)

Four τ² estimators are implemented and exported in `analysis.js` but intentionally
excluded from the UI dropdown. They are preserved for programmatic access,
`estimatorComparison()`, and potential future re-exposure.

| Method    | Location in `analysis.js`  | What it does                                                                                       | Why retained                                                                                                                        |
|-----------|----------------------------|----------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `DLIT`    | `tau2_DLIT()` (~line 494)  | Fixed-point iteration of the DL moment formula: after each τ² estimate, weights are updated as 1/(vᵢ+τ²) and the formula is re-applied until convergence. Converges in ~10–20 iterations. | Occasionally cited as a robustness check on DL. Rarely preferred over REML in practice, but useful for replicating older software output that used iterated DL. |
| `HSk`     | `tau2_HSk()` (~line 521)   | Hunter-Schmidt estimate multiplied by k/(k−1) to reduce downward bias in small samples. Reduces to plain HS as k → ∞.                                               | Niche use in psychometric meta-analysis traditions. Retained so datasets analysed under HSk conventions can be replicated exactly.  |
| `SQGENQ`  | `tau2_SQGENQ()` (~line 815) | Generalised Q estimator with square-root weights aᵢ = √(1/vᵢ) instead of the standard inverse-variance weights aᵢ = 1/vᵢ used by DL. Down-weights large precise studies, producing larger τ² estimates. | Included in `estimatorComparison()` for completeness. Accessible via `meta(studies, "SQGENQ")`. Rarely preferred over DL or GENQ.  |
| `EBLUP`   | alias in `meta()` (~line 1517) | Empirical Best Linear Unbiased Predictor. In the univariate random-effects model, EBLUP is numerically identical to REML (Harville 1977; Raudenbush 2009). Dispatches to `tau2_REML()`. | Some software (e.g., older metafor output) reports τ² under the "EBLUP" label. The alias ensures datasets using that terminology can be dispatched and replicated without code changes. |

### How to re-expose a method

To add a method back to the UI dropdown:
1. Add its string key to the `TAU_METHODS` constant (or equivalent UI array in `ui.js`).
2. Verify `meta()` dispatches it correctly (all four are already handled in the
   `else if` chain at lines 1515–1518).
3. Add a benchmark entry in `benchmarks.js` and a corresponding Python check in
   `verify_benchmarks.py` (follow the pattern of the existing REML/DL/PM entries).

No formula changes are needed — the implementations are complete and tested via
`estimatorComparison()` smoke tests in `js/tests.js`.
**Pending user approval** before implementing.
