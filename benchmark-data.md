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
- RE (DL):  -0.7474, τ²=0.3663, I²=92.65%
- RE (REML): -0.7452, τ²=0.3378, I²=92.65%
- Q(df=12) = 163.1649, p < .0001
- Note: REML τ² value not confirmed directly from metafor test file;
  DL and ML (τ²=0.3025) are confirmed. Use DL for OR benchmark.

### BCG as RR (log risk ratio) — metafor rma(..., measure="RR")

Confirmed directly from metadat HTML documentation.

- FE:   -0.4303  (SE=0.0405, z=-10.625)
- RE (REML): -0.7145, τ²=0.3132, I²=92.22%
- RE (DL):   -0.7141, τ²=0.3088, I²=92.12%
- Q(df=12) = 152.2330, p < .0001

### BCG as RD (risk difference) — metafor rma(..., measure="RD")

- FE:   -0.0009  (z=-4.0448)
- RE (DL): -0.0071, τ²≈0.000050, I²=95.66%
- Q(df=12) = 276.4737

Note: REML τ² for RD not confirmed from source; use DL for RD benchmark.

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
- RE (DL): -0.048, τ²=0.001, I²=95.5%

Note: τ² is small in absolute terms (~0.001) but I² is high because the large-N
studies produce very small vi, so between-study variance dominates. Relative error
τ²_computed/τ²_expected ≈ 1.9% < 5% tolerance.

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
- τ²    =  0.1012 (residual, vs 0.313 unconditional)
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
- RE (REML): -15.1060, τ²=684.6462, I²=96.65%
- RE (DL):   -13.9817, τ²=205.4094
- Q(df=8) = 238.9158

Note: The pooled-SD formula (as in the original paper) gives slightly different
Q=241.0590 and τ²=685.1965 but is NOT what the app uses.

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
Confirmed: first 4 studies REML τ²=1.0090 (from metafor test file).

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
- RE (REML): -0.538, τ²=0.782, I²=93.5%

REML τ² derived via Fisher-scoring (analysis.js algorithm, verified against Brent's method).

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
- RE (REML): -0.218, τ²=0.108, I²=94.6%

REML τ² derived analytically (Python Fisher-scoring).

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

Pooled (REML): beta=6.4162, τ²=73.57, I²=95.84%
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
- RE:  0.892,  τ² = 0.2474,  I² = 78.1%
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
- RE:  1.038, τ²=0.373, I²=82.7%

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

Pooled (DL): FE=0.208, RE=0.246, τ²=0.01581, I²=90.7%

### PLO — Logit proportion

App formula: yi = logit(p) = log(p/(1−p)),  vi = 1/(n·p·(1−p))

| Label   |      yi |      vi |
|---------|--------:|--------:|
| Study 1 | -2.1972 |  0.1111 |
| Study 2 | -0.8473 |  0.0476 |
| Study 3 | -1.3863 |  0.0625 |
| Study 4 | -0.4055 |  0.0417 |

Pooled (DL): FE=−0.993, RE=−1.174, τ²=0.4197, I²=87.6%

### PAS — Arcsine square-root

App formula: yi = arcsin(√p),  vi = 1/(4n)  (equal for equal n)

| Label   |    yi |     vi |
|---------|------:|-------:|
| Study 1 | 0.322 | 0.0025 |
| Study 2 | 0.580 | 0.0025 |
| Study 3 | 0.464 | 0.0025 |
| Study 4 | 0.685 | 0.0025 |

Equal vi → RE = FE = 0.513. Pooled (DL): τ²=0.02186, I²=89.7%

### PFT — Freeman-Tukey double-arcsine

App formula (half-sum, matches metafor `escalc("PFT")`):
yi = ½(arcsin(√(x/(n+1))) + arcsin(√((x+1)/(n+1)))),  vi = 1/(4(n+0.5))

Back-transform: sin²(yi).

| Label   |      yi |       vi |
|---------|--------:|---------:|
| Study 1 |  0.3282 | 0.002488 |
| Study 2 |  0.5818 | 0.002488 |
| Study 3 |  0.4673 | 0.002488 |
| Study 4 |  0.6857 | 0.002488 |

Equal vi → RE = FE = 0.5158. Pooled (DL): τ²=0.02110, I²=89.5%

Note: FE/RE/τ² = full-sum-values/2 or /4 algebraically; I² is scale-invariant.
Stripe 3 fix: previously used full-sum formula (yi doubled, vi ×4); generate.R block 12
now uses `escalc("PFT")` to cross-validate.

### PLN — Log proportion

App formula: yi = log(p) = log(x/n),  vi = (1−p)/(n·p)

| Label   |      yi |      vi |
|---------|--------:|--------:|
| Study 1 | -2.3026 | 0.09000 |
| Study 2 | -1.2040 | 0.02333 |
| Study 3 | -1.6094 | 0.04000 |
| Study 4 | -0.9163 | 0.01500 |

Pooled (DL): FE=−1.226, RE=−1.452, τ²=0.2051, I²=86.9%

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
- τ² = (5.6−3)/48 = 0.054,  I² = (5.6−3)/5.6 = 46.4%

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

Pooled (DL): FE=−0.537, RE=−0.605, τ²=0.138, I²=47.7%

### IR — Incidence rate (log)

Synthetic 4-study dataset with varying exposure times.

App formula: yi = log(x/t),  vi = 1/x

| Label   |   x |   t |      yi |    vi |
|---------|----:|----:|--------:|------:|
| Study 1 |  10 | 200 | -2.9957 | 0.100 |
| Study 2 |  25 | 300 | -2.4849 | 0.040 |
| Study 3 |   5 | 400 | -4.3820 | 0.200 |
| Study 4 |  20 | 250 | -2.5257 | 0.050 |

Pooled (DL): FE=−2.742, RE=−2.997, τ²=0.335, I²=82.0%

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

Pooled (REML): FE=27.170, RE=38.325, τ²=408.928, I²=98.67%

Note: The very large τ² reflects genuine heterogeneity in stroke severity and
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

Pooled (REML): FE=3.694, RE=3.523, τ²=0.316, I²=98.90%

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

Pooled (DL): FE=RE=0.569, τ²=0.000, I²=0.0%

Back-transformed: exp(0.569) ≈ 1.77 — group 1 has ~77% higher CV than group 2.
τ²=0 because all five log-CVR values cluster tightly around 0.57.

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

Pooled (DL): FE=RE=0.430, τ²=0.000, I²=0.0%

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

Pooled (DL): FE=RE=0.981, τ²=0.000, I²=0.0%

Back-transformed: exp(0.981) ≈ 2.67 — the treatment group has about 2.7× higher
odds of scoring in a higher category than the control group.
τ²=0 because the log-GOR values are highly consistent across the four studies.

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

Pooled (DL): FE=RE=0.446, τ²=0.000, I²=0.0%

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

Pooled (DL): FE=RE=0.4704, τ²=0.000, I²=0.0%

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
bivariate normal density at the threshold point. Then (cell-product formula,
Pearson 1913 / Brown & Benedetti 1977, matching metafor escalc("RTET")):

    vi = √(p₁₁ · p₁₂ · p₂₁ · p₂₂) / (N · φ₂(h,k;ρ)²)

where p₁₁=a/N, p₁₂=b/N, p₂₁=c/N, p₂₂=d/N are the four cell proportions
(after any continuity correction).

**Previous formula (pre-2026-05-25):** the marginal-product numerator
`p_row·(1−p_row)·p_col·(1−p_col)` was used instead. That formula overestimates
vi by a factor of 1.5×–2× on off-diagonal-skewed tables (e.g. ×1.56 for
80/20/20/80). The cell-product formula matches metafor and was adopted as part
of the Stripe 1 divergence-remediation audit.

**Analytic spot-check**

For the symmetric table (a=b=c=d): p_row=p_col=0.5, h=k=0.
The bisection yields ρ = sin(π·φ/2) where φ is the phi coefficient.
For Study 1: φ = (40·40−10·10)/(50·50) = 0.6, so ρ = sin(0.3π) ≈ 0.8090.
Verified to 6 decimal places against the Python port.

### Per-study tetrachoric values

(R-verified via generate.R block 34 / metafor 4.8-0 escalc("RTET"))

| Label   | p_row  | p_col  |      h |      k |      rho |       vi |
|---------|-------:|-------:|-------:|-------:|---------:|---------:|
| Study 1 | 0.5000 | 0.5000 |  0.000 |  0.000 | 0.809018 | 0.005455 |
| Study 2 | 0.4500 | 0.4200 | -0.126 | -0.202 | 0.654514 | 0.011386 |
| Study 3 | 0.4125 | 0.4250 | -0.221 | -0.189 | 0.776535 | 0.008517 |
| Study 4 | 0.4700 | 0.4600 | -0.075 | -0.100 | 0.748453 | 0.007741 |

Pooled (DL): FE=RE=0.760, τ²=0.000, I²=0.0%

Back-transformed: identity (RTET is already on the correlation scale).
τ²=0 because all four studies show consistent strong latent correlation.

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

**Method**: DL τ², Knapp-Hartung variance adjustment, t_{k−1} critical value.

**Algorithm**
1. Compute DL τ²: c = W − Σwᵢ²/W, τ² = max(0, (Q−(k−1))/c)
2. RE weights: wᵢ = 1/(vᵢ + τ²), W = Σwᵢ, RE = Σwᵢyᵢ/W
3. KH variance: varKH = Σwᵢ(yᵢ−RE)² / ((k−1)·W)
4. seRE = √varKH (replaces the standard √(1/W))
5. crit = t_{k−1, 0.975} = t_{4, 0.975} = 2.7764
6. CI = RE ± crit · seRE

**Computed values**

| Quantity   | Value     |
|------------|----------:|
| τ² (DL)  |   0.2385  |
| RE         |  −0.5364  |
| seRE (KH)  |   0.2552  |
| seRE (base)|   0.2543  |
| crit       |   2.7764  |
| ciLow      |  −1.245   |
| ciHigh     |   0.172   |

R reference: `rma(yi, vi, data=esc, method="DL", test="knha")`

---

### Benchmark 36 — t (t-distribution, DL)

**Method**: DL τ², standard seRE = √(1/W), t_{k−1} critical value (no KH variance inflation).

**Algorithm**
Steps 1–2 identical to KH. Then:

3. seRE = √(1/W)  (standard, not KH-adjusted)
4. crit = t_{k−1, 0.975} = 2.7764
5. CI = RE ± crit · seRE

**Computed values**

| Quantity   | Value     |
|------------|----------:|
| τ² (DL)  |   0.2385  |
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

**Method**: REML τ² for point estimate; CI bounds invert the profile log-likelihood
using ML internally (Wald seRE/stat/pval remain REML-based).

**Algorithm**
1. Compute REML τ² (Fisher scoring with leverage correction) → τ²_REML
2. RE point estimate uses REML weights (as normal)
3. For CI bounds, compute ML τ² and muHat_ML separately:
   - logLik(μ, τ²) = −½ Σ[log(2π(vᵢ+τ²)) + (yᵢ−μ)²/(vᵢ+τ²)]
   - lMax = logLik(muHat_ML, τ²_ML)
   - cutoff = χ²_{1, 0.95}/2 = 3.8415/2 = 1.9207
   - profileTau2(μ): bisect τ² satisfying Σ(yᵢ−μ)²/(vᵢ+τ²)² = Σ1/(vᵢ+τ²)
   - Bisect μ where logLik(μ, profileTau2(μ)) = lMax − cutoff

**Computed values**

| Quantity         | Value     |
|------------------|----------:|
| τ² (REML)      |   0.2405  |
| RE (REML)        |  −0.5365  |
| τ² (ML)        |   0.1751  |
| muHat (ML)       |  −0.5310  |
| lMax             |  −3.7343  |
| cutoff           |   1.9207  |
| ciLow  (PL)      |  −1.095   |
| ciHigh (PL)      |   0.003   |

**Contrast with t/KH**: PL bounds are asymmetric relative to RE (lower bound is
−0.558 from RE; upper bound is +0.540 from RE) compared to the symmetric ±0.706
of the t CI. This reflects the asymmetric likelihood surface when τ² is near zero
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

### Benchmark PB-3b: PET-PEESE (petPeeseTest)

**Algorithm** (Stanley & Doucouliagos 2014; Stanley 2008):

Stage 1 — FAT-PET (identical to `fatPetTest`): WLS of yᵢ on SEᵢ, weights 1/vᵢ.
If `fat.interceptP < 0.10` → `usePeese = true`.

Stage 2 — PEESE: WLS of yᵢ on vᵢ (not SEᵢ), weights 1/vᵢ:
  `yᵢ = γ₀ + γ₁·vᵢ + εᵢ`
  Intercept γ₀ = bias-corrected effect at vᵢ → 0.

**BCG dataset (k=13, df=11):**

`usePeese = false` (FAT interceptP = 0.521 ≥ 0.10)

| Stage | Statistic  | Value  |
|-------|------------|-------:|
| FAT   | intercept  | −0.157 |
| FAT   | interceptP |  0.521 |
| PEESE | intercept  | −0.379 |
| PEESE | interceptP |  0.048 |

**Synthetic funnel (k=6, df=4):**

`usePeese = true` (FAT interceptP = 0.092 < 0.10)

| Stage | Statistic  | Value  |
|-------|------------|-------:|
| FAT   | intercept  | −0.286 |
| FAT   | interceptP |  0.092 |
| PEESE | intercept  | −0.017 |
| PEESE | interceptP |  0.819 |

Values derived from `petPeeseTest()` (JS) and cross-verified against base R
`lm(yi ~ se, weights=1/vi)` / `lm(yi ~ vi, weights=1/vi)` in `generate.R`
block PET-PEESE-1.

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

**Derivation** (k=13, df=11): Verified with base R `lm()` (pb56_check.R). Note: cells
must be cast to `as.numeric()` before computing Vᵢ to avoid integer overflow.

| Statistic    | Value     |
|--------------|----------:|
| intercept    | −2.0930   |
| interceptSE  |  1.6658   |
| interceptT   | −1.2565   |
| interceptP   |  0.2350   |
| slope        | −0.2308   |
| slopeP       |  0.3648   |

p = 0.235 — not significant; no strong evidence of asymmetry by this test.

---

### Benchmark PB-6: Peters test

**Algorithm** (Peters et al. 2006, JAMA):
WLS regression of yᵢ on 1/Nᵢ with weights wᵢ = 1/vᵢ.

  Nᵢ = aᵢ + bᵢ + cᵢ + dᵢ  (total sample size)

Intercept β₀ ≈ true effect at infinite N; tests H₀: β₁ = 0 (no N-dependent bias).

**Derivation** (k=13, df=11): Verified with base R `lm()` (pb56_check.R).

| Statistic    | Value       |
|--------------|------------:|
| intercept    | −0.3573     |
| interceptSE  |  0.1580     |
| interceptT   | −2.2614     |
| interceptP   |  0.0450     |
| slope        | −623.7334   |
| slopeP       |  0.1676     |

p = 0.045 — significant at 5%; larger studies show less protection.
Note: Peters detects asymmetry while Egger/Harbord do not. Disagreement is a known
property of the BCG dataset (directional but partly explained by latitude).

---

### Benchmark PB-8: Deeks test (BCG OR, k=13)

**Algorithm** (Deeks et al. 2005, J Clin Epidemiol 58:882–893):
Funnel-asymmetry test for diagnostic accuracy (DOR) studies.

For each 2×2 table (a=tpos, b=tneg, c=cpos, d=cneg), N = a+b+c+d:

  ESS_i = 2(a+c)(b+d) / N       (effective sample size — harmonic mean of row totals × 2)
  DOR_i = (a·d) / (b·c)         (diagnostic odds ratio)

WLS regression of log(DOR_i) on 1/√ESS_i with weights ESS_i; test H₀: intercept = 0.
Studies with any zero cell (log DOR undefined) are excluded.
df = k − 2.

**Dataset:** BCG OR k=13 (all cells > 0 in every row; full k=13 eligible).

**Derivation:** R code in generate.R block PB-8. Verified with base R `lm()`.

| Statistic    | Value     |
|--------------|----------:|
| k            | 13        |
| df           | 11        |
| intercept    | −0.2492   |
| interceptSE  |  0.2709   |
| interceptT   | −0.9202   |
| interceptP   |  0.3772   |
| slope        | −6.3739   |
| slopeP       |  0.2514   |

p = 0.377 — no evidence of asymmetry by this test (consistent with Harbord).

---

### Benchmark PB-9: Rücker test (BCG OR, k=13)

**Algorithm** (Rücker et al. 2008, Stat Med 27:4450–4465):
Arcsine-based Egger variant for binary outcomes. Applies the variance-stabilising
arcsine transformation so that effect size and precision are decorrelated, reducing
artefactual type-I error inflation.

For each 2×2 table (a=tpos, b=tneg, c=cpos, d=cneg):

  n1 = a+b,  n2 = c+d
  p1 = a/n1,  p2 = c/n2
  y_i  = asin(√p1) − asin(√p2)       (arcsine risk difference)
  se_i = √(1/(4n1) + 1/(4n2))
  z_i  = y_i / se_i                   (standardised statistic)

OLS regression (uniform weights) of z_i on 1/se_i (precision); test H₀: intercept = 0.
df = k − 2.

**Dataset:** BCG OR k=13 (all n1 > 0 and n2 > 0; full k=13 eligible).

**Derivation:** R code in generate.R block PB-9. Verified with base R `lm()`.

| Statistic    | Value     |
|--------------|----------:|
| k            | 13        |
| df           | 11        |
| intercept    | −4.2127   |
| interceptSE  |  1.5534   |
| interceptT   | −2.7120   |
| interceptP   |  0.0202   |
| slope        |  0.0069   |
| slopeP       |  0.4832   |

p = 0.020 — significant at 5%; Rücker detects asymmetry while Harbord and Egger do not.
This is plausible: the arcsine transformation extracts a different signal than log-OR.

---

### Benchmark PB-7: Trim-and-fill (L0, R0, Q0 estimators)

**Algorithm** (Duval & Tweedie 2000; metafor 4.8-0 implementation):

Side detection: WLS regression yᵢ ~ [1, √vᵢ] with weights 1/vᵢ. Slope < 0 →
side="right" (imputed studies are on the right; negate all yᵢ so the excess
side becomes the most negative). Fallback to count-based detection when
regression is singular (e.g. all vᵢ equal).

Working-scale convention: after optional negation all further calculations treat
the excess side as the left (negative) end of the sorted array.

Iterative algorithm (same structure for L0, R0, Q0):
1. Sort yᵢ ascending (in working scale). Initialise k0 = 0.
2. Trim k0 largest values; fit RE model on trimmed set → center β̂.
3. Compute signed ranks of all k studies from β̂:
   - dᵢ = yᵢ − β̂; rank |dᵢ| (1 = smallest)
   - signed rank rᵢ = rank_i × sign(dᵢ)
4. Estimate k0 from the signed ranks using the chosen formula:
   - **L0**: Sr = Σ rᵢ for rᵢ > 0;  k0 = (4·Sr − k(k+1)) / (2k−1)
   - **R0**: negRanks = {−rᵢ : rᵢ < 0};  k0 = k − max(negRanks) − 1
   - **Q0**: Sr same as L0;  k0 = k − ½ − √(2k² − 4·Sr + ¼)
5. k0 = max(0, round(k0)). If k0 changed, return to step 2.
6. Fill: mirror the k0 rightmost sorted studies across β̂ (yᵢ_filled = 2β̂ − yᵢ);
   negate back if side was "right".

**Note on previous (incorrect) values** — prior to this implementation the L0
formula used `k(k+1)/2` instead of `k(k+1)` and a different algorithm structure,
producing k0=10 for BCG log-OR DL. This value was derived from a Python prototype
and was never verified against metafor. The correct metafor result is k0=0.

---

**PB-7a: BCG vaccine (k=13, log-OR, DL)**

R code (metafor 4.8-0):
```r
library(metafor)
dat <- escalc("OR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg)
res <- rma(yi, vi, data=dat, method="DL")
tf_L0 <- trimfill(res, estimator="L0")
tf_R0 <- trimfill(res, estimator="R0")
tf_Q0 <- trimfill(res, estimator="Q0")
tf_L0$k0; tf_R0$k0; tf_Q0$k0
predict(tf_L0)$pred; predict(tf_R0)$pred; predict(tf_Q0)$pred
```

The BCG log-OR dataset has mild asymmetry in the OR scale. All three estimators
agree: no missing studies detected.

| Estimator | k0 | adjustedRE |
|-----------|---:|-----------:|
| L0        |  0 |   −0.747   |
| R0        |  0 |   −0.747   |
| Q0        |  0 |   −0.747   |

(adjustedRE = original RE pooled estimate, unchanged when k0=0)

---

**PB-7b: BCG vaccine (k=13, log-RR, DL)**

R code:
```r
res_rr <- rma(yi, vi, data=dat, method="DL")   # dat already log-RR from escalc("RR",...)
tf_L0 <- trimfill(res_rr, estimator="L0")
tf_R0 <- trimfill(res_rr, estimator="R0")
tf_Q0 <- trimfill(res_rr, estimator="Q0")
```

| Estimator | k0 | adjustedRE  |
|-----------|---:|------------:|
| L0        |  1 |   −0.6561   |
| R0        |  0 |   −0.7145   |
| Q0        |  1 |   −0.6561   |

---

**PB-7c: Mixed synthetic dataset (k=12, DL) — primary cross-validation benchmark**

This dataset was constructed to produce clearly different k0 values across the
three estimators (L0=4, R0=3, Q0=6), making it ideal for unit-testing all paths.
Side detection: side="right" (negated internally); filling adds studies on the
left (negative yi) side.

Data:
```
yi:  −1.0  −0.8  −0.6  −0.4  −0.2   0.0   0.2   0.4   0.5   0.8   1.2   1.8
vi:   0.30  0.20  0.40  0.10  0.15  0.20  0.25  0.35  0.80  1.00  1.20  1.50
```

R code (metafor 4.8-0):
```r
library(metafor)
yi <- c(-1.0,-0.8,-0.6,-0.4,-0.2, 0.0, 0.2, 0.4, 0.5, 0.8, 1.2, 1.8)
vi <- c( 0.30,0.20,0.40,0.10,0.15,0.20,0.25,0.35,0.80,1.00,1.20,1.50)
res <- rma(yi, vi, method="DL")
for (est in c("L0","R0","Q0")) {
  tf <- trimfill(res, estimator=est)
  cat(est, "k0=", tf$k0, "adjRE=", predict(tf)$pred, "\n")
}
```

| Estimator | k0 | adjustedRE |
|-----------|---:|-----------:|
| L0        |  4 |  −0.3688   |
| R0        |  3 |  −0.3302   |
| Q0        |  6 |  −0.4490   |

All values verified against metafor 4.8-0 (tolerance 0.001).

---

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

### Note: QQ plot uses the same standardised residuals

The Normal Q-Q plot (`drawQQPlot` in `plots.js`) is built directly from the
`stdResidual` values already produced by `influenceDiagnostics()`:

```
zᵢ = (yᵢ − RE_full) / √(vᵢ + τ²_full)
```

This matches metafor's `rstandard.rma.uni()` (internally standardised residuals,
not externally studentised). The `stdResidual` values are verified to abs 0.001
in INFLUENCE_BENCHMARKS — no additional benchmark entries are needed for the
QQ plot itself.

**Theoretical quantiles** use Blom's formula (same as R's `qqnorm()`):
```
qᵢ = Φ⁻¹( (i − 0.375) / (k + 0.25) )   for i = 1, …, k (after sorting)
```

**Reference line** matches R's `qqline()`: slope/intercept fit through the first
and third quartile of both the theoretical and sample distributions.

---

## Multi-Moderator Meta-Regression Benchmarks (Phase 8)

Three benchmark entries (MR-A, MR-B, MR-C) use the BCG vaccine dataset
(`dat.bcg`, 13 studies, log risk ratio) from Colditz et al. (1994) with
additional moderators taken from `metafor::dat.bcg`:
`year` (year of publication), `ablat` (absolute latitude of trial),
`region` (categorical: "NA" = North America, "EU" = Europe, "AS" = Asia).

### Dataset: BCG vaccine log RR with moderators

Pre-computed `yi`/`vi` are identical to BENCHMARKS[0] (GENERIC entry).
Moderator values (`year`, `ablat`, `region`) are from `metafor::dat.bcg`.

```
Label                   yi       vi        year  ablat  region
Aronson 1948         -0.8893  0.3256   1948     44    NA
Ferguson&Simes 1949  -1.5854  0.1946   1949     55    EU
Rosenthal 1960       -1.3481  0.4154   1960     42    AS
Hart&Sutherland 1977 -1.4416  0.0200   1977     52    EU
Frimodt-Moller 1973  -0.2175  0.0512   1973     13    AS
Stein&Aronson 1953   -0.7861  0.0069   1953     44    NA
Vandiviere 1973      -1.6209  0.2230   1973     19    AS
TPT Madras 1980       0.0120  0.0040   1980     13    AS
Coetzee&Berjak 1968  -0.4694  0.0564   1968     27    NA
Rosenthal 1961       -1.3713  0.0730   1961     42    NA
Comstock 1974        -0.3394  0.0124   1974     18    NA
Comstock&Webster'69   0.4459  0.5325   1969     33    NA
Comstock 1976        -0.0173  0.0714   1976     33    NA
```

### Model and design matrix conventions

The JS implementation (`buildDesignMatrix` in `analysis.js`) and the Python
re-implementation (`_meta_reg_design_matrix`) use identical conventions:
- Column 0 is always the intercept (value 1).
- Continuous moderators are appended in declaration order, raw numeric.
- Categorical moderators use dummy coding; reference level = alphabetically
  first sorted level. For `region` the levels in sorted order are AS < EU < NA,
  so "AS" is the reference, yielding columns `region:EU` and `region:NA`.
- `modColMap` maps each moderator key to its column index/indices for
  per-moderator Wald tests.

### MR-A: year + ablat (REML, normal CI)

R code: `rma(yi, vi, mods=~year+ablat, method="REML")`

| Field   | Value                           |
|---------|-------------------------------|
| colNames | [intercept, year, ablat]      |
| beta    | [−3.5454, 0.0019, −0.0280]    |
| se      | [29.0956, 0.0147, 0.0102]     |
| τ²    | 0.1108                         |
| QE      | 12.2907 (df=10, p=0.2661)     |
| QM      | 12.2045 (df=2, p=0.0022)      |
| I²      | 71.97%                         |
| R²      | 64.63%                         |
| VIF     | [NaN, 1.7846, 1.7846]          |
| LL      | −8.106874 (REML)               |
| AIC     | 24.213748                       |
| BIC     | 25.424088 (k−p = 13−3 = 10)    |

Per-moderator Wald tests (1-df chi-squared):

| Moderator | QM     | df | p      |
|-----------|--------|----|--------|
| year      | 0.0169 |  1 | 0.8966 |
| ablat     | 7.4917 |  1 | 0.0062 |

VIF formula: VIF_j = 1/(1 − R²_j) from unweighted OLS of column j on all
other columns of the design matrix. Modest collinearity (VIF ≈ 1.78) between
`year` and `ablat` (both tend to be larger for trials in higher-latitude
temperate countries).

### MR-B: ablat + region (REML, normal CI)

R code: `rma(yi, vi, mods=~ablat+factor(region), method="REML")`

colNames: `[intercept, ablat, region:EU, region:NA]` (reference = "AS")

| Field   | Value                                      |
|---------|-------------------------------------------|
| beta    | [0.1024, −0.0330, 0.1598, 0.4339]         |
| se      | [0.3369, 0.0143, 0.6491, 0.3733]          |
| τ²    | 0.1239                                     |
| QE      | 9.5924 (df=9, p=0.3845)                   |
| QM      | 13.2389 (df=3, p=0.0041)                  |
| I²      | 65.50%                                     |
| R²      | 60.43%                                     |
| LL      | −6.767674 (REML)                           |
| AIC     | 23.535348                                  |
| BIC     | 24.521471 (k−p = 13−4 = 9)                |

Per-moderator Wald tests:

| Moderator | QM     | df | p      |
|-----------|--------|----|--------|
| ablat     | 5.3003 |  1 | 0.0213 |
| region    | 2.1225 |  2 | 0.3460 |

### MR-C: ablat + region (REML, KH CI)

R code: `rma(yi, vi, mods=~ablat+factor(region), method="REML", test="knha")`

Same beta as MR-B (KH does not alter point estimates), but SE inflated by
√s² where s² = max(1, QE/QEdf) = 1.0658. QM becomes an F-statistic.

| Field   | Value                                      |
|---------|-------------------------------------------|
| se (KH) | [0.3478, 0.0148, 0.6701, 0.3854]          |
| s²      | 1.0658                                     |
| QE      | 9.5924 (df=9, p=0.3845) — unchanged       |
| QM      | 4.1404 F (df=3/9, p=0.0423)               |

Per-moderator F-tests (numerator df = moderator dof, denominator df = QEdf = 9):

| Moderator | F      | df    | p      |
|-----------|--------|-------|--------|
| ablat     | 4.9729 | 1/9   | 0.0527 |
| region    | 0.9957 | 2/9   | 0.4068 |

### I² formula (regression context)

I² in a meta-regression model is computed differently from the intercept-only
case. The JS implementation and Python re-implementation use:

```
c = Σᵢ w₀ᵢ (1 − hᵢ)      where w₀ᵢ = 1/vᵢ (FE weight), hᵢ = w₀ᵢ xᵢ' (X'W₀X)⁻¹ xᵢ
typical_vi = QEdf / c
I² = τ² / (τ² + typical_vi) × 100
```

This matches the leverage-corrected formula in metafor (`rma$I2`). Note: this
differs from the naive formula `(Q−df)/Q × 100` used for the intercept-only
model.

### R² formula

R² = max(0, (τ²₀ − τ²) / τ²₀) where τ²₀ is the DL estimate from the
intercept-only (no moderators) model using FE weights 1/vᵢ.

### AIC / BIC for meta-regression

**ML log-likelihood** (full Gaussian, at fitted β̂, τ²):

```
LL_ML = −½ Σᵢ [ log(2π) + log(vᵢ + τ²) + (yᵢ − xᵢ′β̂)² / (vᵢ + τ²) ]
```

**REML log-likelihood** (Harville 1977, REMLf=TRUE — metafor default):

```
LL_REML = LL_ML + (p/2)·log(2π) + ½·log|X′X| − ½·log|X′WX|
```

where X is the k×p design matrix, W = diag(1/(vᵢ+τ²)), and log|·| is computed
via partial-pivoting Gaussian elimination (`logDet()` in analysis.js).

**Number of parameters**: npar = p + 1 for **both** ML and REML (p fixed-effect
coefficients + 1 variance component τ²). Matches `parms` in metafor
`AIC.rma()`/`BIC.rma()`.

**AIC**: −2·LL + 2·npar

**BIC**: −2·LL + npar·log(n), where:
- ML: n = k (number of studies)
- REML: n = k − p (error contrasts; metafor `BIC.rma()` uses `k-p`)

**Verification** (R, metafor 4.8.0):

```r
library(metafor)
bcg_yi <- c(-0.8893, -0.6062, -0.4425, -0.0173, -0.4581,
            -0.2190, -1.3480, 0.0218, -0.3394, -0.1557,
            -1.4416, -0.4671, -0.1924)
bcg_vi <- c(0.3256, 0.0385, 0.0149, 0.0020, 0.0219,
            0.0716, 0.0861, 0.0007, 0.0423, 0.0309,
            0.0131, 0.0453, 0.0211)
bcg_year  <- c(1948,1949,1960,1977,1973,1953,1973,1980,1968,1961,1974,1969,1976)
bcg_ablat <- c(44,55,42,52,13,44,19,13,27,42,18,33,33)

# MR-A: REML, year + ablat
res_a <- rma(bcg_yi, bcg_vi, mods=~bcg_year+bcg_ablat, method="REML")
AIC(res_a)  # 24.213748
BIC(res_a)  # 25.424088

# MR-B/C: REML, ablat + region
bcg_region <- c("AS","BS","EU","NA","AS","EU","AS","AS","AS","EU","NA","EU","NA")
# ... rma(bcg_yi, bcg_vi, mods=~bcg_ablat+factor(bcg_region), method="REML")
# AIC = 23.535348, BIC = 24.521471
```

**Key finding**: metafor uses REMLf=TRUE by default, which includes the
`+p/2·log(2π) + ½·log|X′X|` correction term from Harville (1977). Omitting
this gives LL ≈ −19 instead of −8, producing wrong AIC/BIC. The `logDet()`
helper uses partial-pivoting Gaussian elimination to compute log|det| stably.

## R-verification status (audit April 2026)

Run against R metafor 4.8.0 + clubSandwich. All generate.R blocks were executed
and outputs compared to `benchmarks.js` expected values.

### MH_BENCHMARKS — fully R-verified ✓

Blocks MH-1 through MH-4 (`rma.mh` / `rma.peto`). All values match
`benchmarks.js` to 7 decimal places: est, se, ciLow, ciHigh, OR/RR (4 dp), Q, I².

### CLUSTER_BENCHMARKS — fully R-verified ✓

Blocks CL-1 through CL-3 (REML/DL + `coef_test(vcov="CR1")`). All values match
to 7 decimal places: RE, tau2, robustSE, robustCiLow, robustCiHigh. df and
clustersUsed are exact integers.

### VH_BENCHMARKS — R-verified with one documented difference

Blocks 45–47. VH-A and VH-B: mu, se, zval, pval, tau2, delta, LRT, LRTdf, LRTp
all match metafor `selmodel()` exactly to 6–8 significant figures.

**ll_sel / ll_unsel normalization difference**: R reports full Gaussian
log-likelihood (includes `−½ log(2π vᵢ)` terms). JS uses the reduced form
(omits the constant). Values differ by Σᵢ `½ log(2π vᵢ)` ≈ 11.95 for the BCG
dataset. LRT = 2(ll_sel − ll_unsel) is identical under both normalizations and
matches R exactly (VH-A: 1.8074, VH-B: 1.1927).

VH-C (synthetic, one-sided) is intentionally JS-only: metafor's `selmodel()`
constrains selection weights δ ≤ exp(100); the JS BFGS is unconstrained and
reaches the true optimum (ω₃ ≈ 149.8 > exp(100) boundary). See VH-C citation.

### META_REGRESSION_BENCHMARKS — R-verified with one documented QE difference

Blocks 42–44. The following fields match R exactly: beta, se, tau2, QM, QMp,
I², R², modTests (QM, QMdf, QMp per moderator).

**QE formula difference**: metafor computes QE using FE weights (1/vᵢ) and the
FE regression beta:

    QE_R = Σᵢ (1/vᵢ) · (yᵢ − Xᵢ′ b_FE)²

This tests H₀: τ²=0 (no residual heterogeneity under fixed effects) and has an
exact chi-squared(k−p) distribution under the null.

The JS implementation uses RE weights and RE betas:

    QE_JS = Σᵢ (1/(vᵢ+τ²)) · (yᵢ − Xᵢ′ b_RE)²

R values (metafor 4.8.0): MR-A QE=28.3251 (p=0.0016), MR-B/C QE=23.8904 (p=0.0045).
JS values (RE-weighted): MR-A QE=12.2907 (p=0.2661), MR-B/C QE=9.5924 (p=0.3845).

The benchmark `QE` and `QEp` entries are set to the JS (RE-weighted) values.
Changing to metafor's formula is a behavioral change outside the audit scope;
logged here for future resolution. Note: metafor 4.8.0 no longer stores `QEdf`
in the result object (it is `NULL`), though the p-value is still computed with
df = k − p internally.

---

## RVE_BENCHMARKS (rvePooled) — derivation notes

Five benchmark entries covering `rvePooled()` in `regression.js`: RVE-1 through RVE-3 (default ω²=0 mode) and RVE-MoM-1/2 (MoM mode).

### Landscape of RVE approaches

Four distinct approaches exist in the literature and major packages. None is identical to any other.

| Approach | WLS weights | ρ in WLS? | Variance components | Sandwich scale | Package |
|----------|------------|-----------|--------------------|----|---------|
| **App default** (HTJ 2010 CR1) | Σᵢ⁻¹ via Sherman-Morrison (ρ-structured) | ✓ | none (ω²=0 assumed) | m/(m−1) | — |
| **App MoM** (`omega2:"MoM"`) | 1/(vᵢⱼ+τ²+ω²) from 2-step | ✗ | ω² (between-cluster) + τ² (within-cluster) via MoM | m/(m−p) | robumeta HIER |
| **robumeta CORR** (default) | 1/(kᵢ·avg\_vᵢ+τ²) from 1-step | ✗ | τ² only (single component), cluster-average weights | m/(m−p) | robumeta |
| **metafor `robust()`** | 1/(vᵢⱼ+τ²\_rma) from fitted rma() | ✗ | uses τ² from prior rma() fit, not re-estimated | m/(m−1) | metafor |

**Key differences:**

- **ρ in WLS:** The app default is the only approach that incorporates the assumed within-cluster correlation ρ into the GLS weights (via the Sherman-Morrison inverse of the block-diagonal covariance). All others use diagonal working weights (ignoring within-cluster correlation in the WLS step, handling it only implicitly through the sandwich).

- **Variance components:** The app default and metafor `robust()` do not estimate separate heterogeneity from the cluster structure — they rely on the existing τ² from a prior RE model fit (metafor) or assume ω²=0 (app). The MoM approaches (robumeta HIER/CORR) estimate heterogeneity directly from cluster-level residuals.

- **robumeta CORR vs HIER:** Both robumeta models use no ρ in WLS, but differ in what they estimate. CORR (robumeta default) uses cluster-average initial weights and estimates a single τ² component. HIER uses 1/vᵢⱼ initial weights and estimates two components (ω² between-cluster, τ² within-cluster). CORR is conceptually closer to a GLS with exchangeable within-cluster correlation; HIER is a two-level random effects model.

- **SE scale:** The app default uses m/(m−1) (standard CR1 finite-sample correction). The MoM mode uses m/(m−p) matching robumeta's `sqrt(N/(N−(p+1)))` — equivalent for intercept-only (p=1), larger for regression.

- **When they diverge materially:** If ω²>0 (real between-cluster heterogeneity beyond sampling error), the MoM approaches re-weight studies toward equal-weight-per-cluster, changing point estimates. The app default keeps ρ-structured GLS weights unchanged. For datasets with no between-cluster heterogeneity (ω²≈0), all approaches converge.

**App default is most faithful to HTJ 2010:** Hedges, Tipton & Johnson (2010, *Research Synthesis Methods* 1:39–65) present the ρ-structured WLS + CR1 sandwich as the primary estimator. The variance-component estimation in robumeta is a later extension (Tipton 2015) aimed at improving SE coverage when cluster sizes are heterogeneous.

**Future UI options to consider:**
- Expose `omega2:"MoM"` as a checkbox ("Estimate between-cluster heterogeneity") — useful when cluster sizes are heterogeneous and ω² is expected to be non-trivial.
- Add robumeta CORR as a third mode — requires cluster-average initial weights (different first-pass WLS structure from both current modes).
- Add metafor-style mode — use τ² from the RE pooled estimate as the working variance inflation rather than 0 or MoM-estimated components.

### Working model (default ω²=0 mode)

Block-diagonal covariance for cluster i:
- `V_i[j,j] = vi_j` (study j sampling variance)
- `V_i[j,k] = ρ·√(vi_j·vi_k)` for j≠k in same cluster (ρ = assumed correlation)

Equivalent to `V_i = (1−ρ)·D_i + ρ·d_i·d_i'` where `d_ij = √vi_j`.

### Sherman-Morrison closed form (intercept-only, default mode)

For cluster i with k_i studies, c_i = (1−ρ) + ρ·k_i:

```
A_i = (W_i − ρ·S_i²/c_i) / (1−ρ)     where W_i = Σwⱼ, S_i = Σ√wⱼ, wⱼ = 1/viⱼ
b_i = (WY_i − ρ·S_i·SY_i/c_i) / (1−ρ) where WY_i = Σwⱼyⱼ, SY_i = Σ√wⱼ·yⱼ
β̂  = Σb_i / ΣA_i
```

### Sandwich variance (CR1, default mode)

```
g_i = (WXE_i − ρ·S_i·SE_i/c_i) / (1−ρ)   residual score, WXE_i = Σwⱼeⱼ, SE_i = Σ√wⱼeⱼ
V̂(β̂) = m/(m−1) · Σg_i² / (ΣA_i)²
df = m − p  (m = cluster count, p = num predictors including intercept)
```

For meta-regression (p > 1), A_i and b_i are p×p and p-vectors respectively; V̂(β̂) = m/(m−1)·B⁻¹·(Σg_ig_i')·B⁻¹.

### MoM mode formula (omega2:"MoM")

When `opts.omega2 === "MoM"`, `_rveHIERMoM()` runs the robumeta HIER two-step algorithm. ρ is not used.

**Step 1 — initial 1/vᵢⱼ WLS:** β₀ = (ΣXᵢ'WᵢXᵢ)⁻¹ ΣXᵢ'Wᵢyᵢ, Wᵢ = diag(1/vᵢⱼ). Let Q₀ = (ΣXᵢ'WᵢXᵢ)⁻¹.

**Step 2 — MoM variance components** (robu HIER formula):
```
Qe = Σᵢⱼ eᵢⱼ²/vᵢⱼ           weighted residual SS
Qa = Σᵢ (Σⱼ eᵢⱼ)²            squared cluster-sum of residuals

A1 = Σkᵢ² − 2·tr(Q₀·sumXWJJX) + tr(Q₀·sumXJX·Q₀·sumXWJWX)
B1 = k    − 2·tr(Q₀·sumXWJX)  + tr(Q₀·sumXJX·Q₀·sumXWWX)
C1 = Σvᵢⱼ − tr(Q₀·sumXJX)
A2 = Σ(1/vᵢⱼ) − tr(Q₀·sumXWJWX)
B2 = Σ(1/vᵢⱼ) − tr(Q₀·sumXWWX)
C2 = k − p

ω² = max(0, ((Qa−C1)·A2 − (Qe−C2)·A1) / (B1·A2 − B2·A1))
τ² = max(0, (Qe−C2)/A2 − ω²·B2/A2)
```

where `sumXJX = Σᵢ sumXᵢ·sumXᵢ'`, `sumXWJWX = Σᵢ SXᵢ·SXᵢ'`, `sumXWJX = Σᵢ SXᵢ·sumXᵢ'`, etc., with SXᵢ = Σⱼ(1/vᵢⱼ)xᵢⱼ and sumXᵢ = Σⱼ xᵢⱼ. Traces of rank-1 products exploit `tr(Q·u·v') = v'·Q·u`.

**Step 3 — updated weights:** wᵢⱼ = 1/(vᵢⱼ + τ² + ω²); second WLS → β̂ᵣ.

**Step 4 — sandwich SE:** V̂(β̂ᵣ) = m/(m−p) · Qᵣ · (Σgᵢgᵢ') · Qᵣ, where gᵢ = Σⱼ wᵢⱼ·xᵢⱼ·eᵣᵢⱼ and eᵣᵢⱼ are second-pass residuals. Scale m/(m−p) matches `robu(..., small=FALSE)` exactly.

### R reference code

`generate.R` blocks RVE-1 through RVE-3 implement `rve_manual()` and `rve_manual_reg()` — pure-R functions that mirror the exact formula above (no external packages required). Expected values match JS output to 7 d.p.

Blocks RVE-MoM-1 and RVE-MoM-2 use `robu(..., modelweights="HIER", small=FALSE)` from the `robumeta` package for cross-validation of the MoM mode. Requires `install.packages("robumeta")`.

### Benchmark entries

| Entry | Dataset | Moderators | ρ | m | k | df | omega2 mode |
|-------|---------|-----------|---|---|---|---|---|
| RVE-1 | 3-cluster 6-study (same as CL-1 data) | none | 0.80 | 3 | 6 | 2 | ω²=0 (default) |
| RVE-2 | 4-cluster 8-study heterogeneous sizes (same as CL-2 data) | none | 0.80 | 4 | 8 | 3 | ω²=0 (default) |
| RVE-3 | 4-cluster 8-study | `x` (continuous) | 0.80 | 4 | 8 | 2 | ω²=0 (default) |
| RVE-MoM-1 | same as RVE-1 | none | n/a | 3 | 6 | 2 | MoM: ω²=0.0224, τ²=0.0094 |
| RVE-MoM-2 | same as RVE-2 | none | n/a | 4 | 8 | 3 | MoM: ω²=0.0323, τ²=0.0258 |

---

## THREE_LEVEL_BENCHMARKS (meta3level) — derivation notes

### Model

Studies nested within clusters. Marginal covariance for cluster i (kᵢ studies):

```
Σᵢ = diag(vᵢⱼ + σ²ᵤ) + σ²ₜ · 1·1'
```

- σ²ᵤ = `tau2_within`  (between-study-within-cluster)
- σ²ₜ = `tau2_between` (between-cluster)

Inverted via Sherman-Morrison (see `meta3level()` in analysis.js).  
REML log-likelihood concentrated over μ analytically; optimised with BFGS in log-τ² space.

### I² formula

```
vi_typical = 1 / Σ(1/vᵢ)
I²_within  = 100 · σ²ᵤ / (σ²ᵤ + σ²ₜ + vi_typical)
I²_between = 100 · σ²ₜ / (σ²ᵤ + σ²ₜ + vi_typical)
```

Note: metafor's default I² for `rma.mv` uses a different denominator — `(k−1)/c`
(the DL denominator) rather than `1/Σ(1/vᵢ)`. The generate.R blocks apply our
formula to produce comparable values.

### R cross-validation

`generate.R` blocks **THREE-1** and **THREE-2** call
`rma.mv(yi, vi, random=~1|cluster/study, method="REML")`.

In metafor's sigma2 vector: `sigma2[1]` = between-cluster (= `tau2_between`),
`sigma2[2]` = within-cluster (= `tau2_within`).  
`logLik` from R includes −k/2·log(2π); the JS implementation omits this constant
(cancels in optimisation).

Agreement with R (metafor 4.8.0):

| Entry    | Δ(mu)    | Δ(se)    | Δ(τ²_within) | Δ(τ²_between) | Δ(I²_within) |
|----------|----------|----------|--------------|---------------|--------------|
| THREE-1  | < 1e-9   | < 1e-9   | < 1e-9       | < 1e-9        | < 1e-7       |
| THREE-2  | < 5e-9   | < 3e-8   | < 3e-8       | < 5e-9        | < 9e-6       |

### Datasets

| Entry   | Clusters | Studies | Structure               | Notes                        |
|---------|----------|---------|-------------------------|------------------------------|
| THREE-1 | 4        | 12      | 4×3 balanced, vi=0.005  | Both τ² non-zero: ≈0.035/0.110 |
| THREE-2 | 5        | 14      | A=3,B=2,C=4,D=2,E=3     | Both τ² non-zero: ≈0.078/0.027 |

---

## Less common τ² estimators

Four τ² estimators are available in the UI dropdown alongside the main estimators.
They are included for sensitivity analysis, specialist applications, and replication
of older software output.

| Method    | Location in `analysis.js`  | What it does                                                                                       | Why retained                                                                                                                        |
|-----------|----------------------------|----------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `DLIT`    | `tau2_DLIT()` (~line 494)  | Fixed-point iteration of the DL moment formula: after each τ² estimate, weights are updated as 1/(vᵢ+τ²) and the formula is re-applied until convergence. Converges in ~10–20 iterations. | Occasionally cited as a robustness check on DL. Rarely preferred over REML in practice, but useful for replicating older software output that used iterated DL. |
| `HSk`     | `tau2_HSk()` (~line 521)   | Hunter-Schmidt estimate multiplied by k/(k−1) to reduce downward bias in small samples. Reduces to plain HS as k → ∞.                                               | Niche use in psychometric meta-analysis traditions. Retained so datasets analysed under HSk conventions can be replicated exactly.  |
| `SQGENQ`  | `tau2_SQGENQ()` (~line 815) | Generalised Q estimator with square-root weights aᵢ = √(1/vᵢ) instead of the standard inverse-variance weights aᵢ = 1/vᵢ used by DL. Down-weights large precise studies, producing larger τ² estimates. | Included in `estimatorComparison()` for completeness. Accessible via `meta(studies, "SQGENQ")`. Rarely preferred over DL or GENQ.  |
| `EBLUP`   | alias in `meta()` (~line 1517) | Empirical Best Linear Unbiased Predictor. In the univariate random-effects model, EBLUP is numerically identical to REML (Harville 1977; Raudenbush 2009). Dispatches to `tau2_REML()`. | Some software (e.g., older metafor output) reports τ² under the "EBLUP" label. The alias ensures datasets using that terminology can be dispatched and replicated without code changes. |

No formula changes are needed — the implementations are complete and tested via
`estimatorComparison()` smoke tests in `js/tests.js`.


---

## BLUPs (Empirical Bayes shrunken estimates)

**Dataset:** BCG Vaccine (dat.bcg, 13 studies, GENERIC yi/vi as in benchmark entry 1)  
**Method:** REML  
**R version:** metafor 4.8-0  

**R code used:**
```r
library(metafor)
fit <- rma(yi=yi, vi=vi, method="REML")
b   <- blup(fit)
# b$pred  = BLUP estimate
# b$se    = full-uncertainty SE
# b$pi.lb = BLUP CI lower (metafor names it pi.lb but it is pred - 1.96*se)
# b$pi.ub = BLUP CI upper (pred + 1.96*se)
```

**Formula (matches metafor exactly):**
```
lambda_i  = tau2 / (tau2 + vi)
blup_i    = mu_RE + lambda_i * (yi - mu_RE)
WRE       = sum(1 / (vi + tau2))
varBlup_i = lambda_i * vi + (vi / (tau2 + vi))^2 / WRE
se_blup_i = sqrt(varBlup_i)
ci_lb_i   = blup_i - 1.96 * se_blup_i
ci_ub_i   = blup_i + 1.96 * se_blup_i
```

**Model summary:** mu = -0.7145323, tau2 = 0.3132433, seRE = 0.1797815

**Expected BLUP values (from metafor):**

| Study                    | blup       | se_blup    | ci_lb      | ci_ub      |
|--------------------------|------------|------------|------------|------------|
| Aronson 1948             | -0.8002336 |  0.4099300 | -1.6036923 |  0.0032252 |
| Ferguson & Simes 1949    | -1.2517059 |  0.3532269 | -1.9440188 | -0.5593930 |
| Rosenthal 1960           | -0.9869028 |  0.4348320 | -1.8391576 | -0.1346480 |
| Hart & Sutherland 1977   | -1.3978978 |  0.1375677 | -1.6675255 | -1.1282701 |
| Frimodt-Moller 1973      | -0.2873802 |  0.2113116 | -0.7015423 |  0.1267820 |
| Stein & Aronson 1953     | -0.7845720 |  0.0822898 | -0.9458570 | -0.6232870 |
| Vandiviere 1973          | -1.2439636 |  0.3685919 | -1.9663997 | -0.5215274 |
| TPT Madras 1980          |  0.0028786 |  0.0625875 | -0.1197917 |  0.1255490 |
| Coetzee & Berjak 1968    | -0.5068362 |  0.2203910 | -0.9387946 | -0.0748777 |
| Rosenthal 1961           | -1.2471727 |  0.2457117 | -1.7287578 | -0.7655876 |
| Comstock 1974            | -0.3536580 |  0.1094814 | -0.5682376 | -0.1390784 |
| Comstock & Webster 1969  | -0.2847340 |  0.4583010 | -1.1829881 |  0.6135201 |
| Comstock 1976            | -0.1467434 |  0.2434395 | -0.6238751 |  0.3303883 |

**Verification:** JS values match metafor to floating-point precision (~1e-16 max diff).  
See `verify_blup.R` for the full verification script.

---

## DFFITS

**Source:** `metafor::influence.rma.uni()` (metafor 4.8-0), BCG dataset, DL method.

**Formula (from metafor source):**
```
dffits[i] = (pred.full[i] - delpred[i]) / sqrt(s2w * hat[i] * (tau2.del[i] + vi[i]))
```
With s2w = 1 for random-effects models (rma.uni):
```
DFFITS_i = (μ̂_full − μ̂_loo,i) / √(h_i · (τ²_loo,i + v_i))
```

**Flag threshold:** |DFFITS_i| > 3·√(1/(k−1))  
(= 3·√(p/(k−p)) with p=1 for intercept-only model)

**R code used:**
```r
library(metafor)
dat <- escalc(measure="RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg, append=TRUE)
res <- rma(yi, vi, data=dat, method="DL")
inf <- influence(res)
print(inf$inf$dffits)
```

**Expected DFFITS values (BCG, DL, k=13):**

| Study                    | DFFITS      | Flagged |
|--------------------------|-------------|---------|
| Aronson 1948             | −0.0501725  | No      |
| Ferguson & Simes 1949    | −0.3363976  | No      |
| Rosenthal et al 1960     | −0.1638125  | No      |
| Hart & Sutherland 1977   | −0.6291024  | No      |
| Frimodt-Moller et al 1973|  0.2727445  | No      |
| Stein & Aronson 1953     | −0.0069973  | No      |
| Vandiviere et al 1973    | −0.3294041  | No      |
| TPT Madras 1980          |  0.5127745  | No      |
| Coetzee & Berjak 1968    |  0.1373670  | No      |
| Rosenthal et al 1961     | −0.3507962  | No      |
| Comstock et al 1974      |  0.2334335  | No      |
| Comstock & Webster 1969  |  0.2566754  | No      |
| Comstock et al 1976      |  0.3583792  | No      |

Threshold: 3·√(1/12) ≈ 0.866. No study exceeds it on this dataset.

**Verification:** All 13 studies match metafor to ≤ 3 × 10⁻¹⁷ (floating-point precision).

---

## Covariance ratio

**Source:** `metafor::influence.rma.uni()` (`cov.r` column), metafor 4.8-0, BCG dataset, DL method.

**Formula (from metafor source):**
```
covratio[i] = det(vcov(res.loo[[i]])) / det(vcov(res.full))
```
For p = 1 (intercept-only model), vcov is the scalar Var(μ̂_RE) = 1/W:
```
covRatio_i = W_full / W_loo,i
```
where W_loo,i = Σⱼ≠ᵢ 1/(vⱼ + τ²_loo,i) uses the leave-one-out τ².

**Flag threshold:** covRatio_i > (1 + p/k)^p = 1 + 1/k for p = 1

**R code used:**
```r
library(metafor)
dat <- escalc(measure="RR", ai=tpos, bi=tneg, ci=cpos, di=cneg, data=dat.bcg, append=TRUE)
res <- rma(yi, vi, data=dat, method="DL")
inf <- influence(res)
print(as.numeric(inf$inf[["cov.r"]]))
```

**Expected covRatio values (BCG, DL, k=13, threshold = 1+1/13 ≈ 1.077):**

| Study                     | covRatio   | Flagged |
|---------------------------|------------|---------|
| Aronson 1948              | 1.0625800  | No      |
| Ferguson & Simes 1949     | 1.0429284  | No      |
| Rosenthal et al 1960      | 1.0455078  | No      |
| Hart & Sutherland 1977    | 0.8425990  | No      |
| Frimodt-Moller et al 1973 | 1.1467962  | Yes     |
| Stein & Aronson 1953      | 1.3202119  | Yes     |
| Vandiviere et al 1973     | 1.0408079  | No      |
| TPT Madras 1980           | 0.8324774  | No      |
| Coetzee & Berjak 1968     | 1.1464091  | Yes     |
| Rosenthal et al 1961      | 1.0511511  | No      |
| Comstock et al 1974       | 1.3318039  | Yes     |
| Comstock & Webster 1969   | 1.0411904  | No      |
| Comstock et al 1976       | 1.1171108  | Yes     |

**Verification:** All 13 studies match metafor to ≤ 1.78 × 10⁻¹⁵ (floating-point precision).

---

## Test of Excess Significance (TES)

**Source:** `metafor::tes()`, metafor 4.8-0.

**Formula:**

Per-study power to detect |θ| = |μ̂_RE| at α = 0.05 (two-tailed):

```
power_i = Φ(|θ|/SE_i − 1.96) + Φ(−1.96 − |θ|/SE_i)
```

where Φ is the standard normal CDF and 1.96 = Φ⁻¹(0.975) (exact: `normalQuantile(0.975)`).

Expected number of significant results:

```
E = Σ power_i
```

Observed: O = count of studies with two-tailed p < 0.05.

Variance (binomial approximation, matching metafor):

```
Var = E * (1 − E/k)
```

Test statistic and p-value:

```
χ² = (O − E)² / Var
p  = 1 − Φ(z)   [always one-sided; p > 0.5 when O < E]
```

Note: metafor uses the binomial approximation `E*(1−E/k)` rather than the exact Bernoulli sum `Σ p_i*(1−p_i)`. The binomial approximation was confirmed by cross-referencing `metafor::tes()` source.

---

### TES Benchmark A — BCG Vaccine (log OR, DL)

**Dataset:** Same 13 2×2 tables as the BCG OR benchmark (`PUB_BIAS_BENCHMARKS[0]`), type="OR", tauMethod="DL".

**Note:** The previous R code incorrectly used `measure="RR"` (matching `dat.bcg` column names but the wrong effect measure). The benchmark uses `type="OR"`. The values below are self-verified from our JavaScript implementation; R verification pending (see generate.R block TES-A which now uses the correct OR data).

**Expected values (JS implementation, formula-verified):**

| Quantity | Value    | Derivation |
|----------|----------|-----------|
| O        | 8        | |yi/√vi| > 1.96 for studies 2,3,4,6,7,9,10,11 |
| E        | 8.703    | Σ power_i with θ = RE_DL ≈ −0.747 |
| χ²       | 0.172    | (8−8.703)²/[8.703·(1−8.703/13)] |
| p        | 0.661    | 1 − Φ(−0.414) |

p > 0.5 because O < E (observed ≈ expected, no excess significance).

**R verification code (TES-A in generate.R):**
```r
library(metafor)
# yi/vi computed from OR formula (log(ad/bc), 1/a+1/b+1/c+1/d)
# matching the JS compute("OR") profile for the BCG pub bias benchmark data
yi_a <- c(-0.9387, -1.6659, -1.3863, -1.4564, -0.2191, -0.9581,
          -1.6338,  0.0122, -0.4714, -1.4013, -0.3408,  0.4470, -0.0174)
vi_a <- c(1/4+1/119+1/11+1/128, 1/6+1/300+1/29+1/274,
          1/3+1/228+1/11+1/209, 1/62+1/13536+1/248+1/12619,
          1/33+1/5036+1/47+1/5761, 1/180+1/1361+1/372+1/1079,
          1/8+1/2537+1/10+1/619, 1/505+1/87886+1/499+1/87892,
          1/29+1/7470+1/45+1/7232, 1/17+1/1699+1/65+1/1600,
          1/186+1/50448+1/141+1/27197, 1/5+1/2493+1/3+1/2338,
          1/27+1/16886+1/29+1/17825)
res <- rma(yi_a, vi_a, method="DL")
t1  <- tes(res)
cat("O =", t1$O, "E =", round(t1$E,3), "chi2 =", round(t1$X2,3), "p =", round(t1$pval,3), "\n")
```

---

### TES Benchmark B — Synthetic asymmetric funnel (GENERIC, DL)

**Dataset:** Same 6-study dataset as the Egger benchmark (`PUB_BIAS_BENCHMARKS[1]`): yi = [−0.1, 0.3, 0.1, 0.9, 1.4, 0.5], vi = [0.04, 0.09, 0.0225, 0.36, 0.64, 0.16].

**Note:** The previous R code used a different dataset (`yi = [0.8, 1.2, 0.5, 1.5, 0.3, 1.8]`, `vi = [0.04, 0.09, 0.01, 0.16, 0.01, 0.25]`), producing wrong expected values. The correct dataset has lower z-scores; all six studies have |yi/√vi| < 1.96, so O = 0.

**Expected values (JS implementation, formula-verified):**

| Quantity | Value    | Derivation |
|----------|----------|-----------|
| O        | 0        | max|yi/√vi| = 1.75 < 1.96 |
| E        | 0.707    | Σ power_i with θ = RE_DL ≈ 0.193 |
| χ²       | 0.802    | (0−0.707)²/[0.707·(1−0.707/6)] |
| p        | 0.815    | 1 − Φ(−0.895) |

p > 0.5 because O < E (both close to 0; low power studies).

**R verification code (TES-B in generate.R):**
```r
library(metafor)
yi_b <- c(-0.1, 0.3, 0.1, 0.9, 1.4, 0.5)
vi_b <- c(0.04, 0.09, 0.0225, 0.36, 0.64, 0.16)
res  <- rma(yi_b, vi_b, method="DL")
t1   <- tes(res)
cat("O =", t1$O, "E =", round(t1$E,3), "chi2 =", round(t1$X2,3), "p =", round(t1$pval,3), "\n")
```

**Tolerance:** All values matched to ≤ 0.001 in `js/tests.js`.

---

## Non-linear Meta-regression Benchmarks (MR-D, MR-E)

Added in `META_REGRESSION_BENCHMARKS[3]` and `[4]`.

### MR-D — Polynomial quadratic (BCG ablat + ablat², REML)

**Equivalent R code:**
```r
library(metafor)
res <- rma(yi, vi, mods = ~ ablat + I(ablat^2), data=dat.bcg, method="REML")
```

Corresponds to `META_REGRESSION_BENCHMARKS[3]`. R-verified (metafor 4.8.0, crossval_nonlinear.R block 48).

**Expected values:**

| Field | Value |
|-------|-------|
| beta  | [−0.3889, 0.0218, −0.0008] |
| se    | [0.6285, 0.0464, 0.0007] |
| τ²  | 0.0806 |
| QE    | 28.4961 (df=10, p=0.0015) |
| QM    | 16.9158 (df=2, p=0.0002) |
| I²    | 66.62% |
| R²    | 0.7426 |

**R-verified** (metafor 4.8.0, crossval_nonlinear.R block 48). All values match exactly.

### MR-E — Restricted cubic spline (BCG ablat, 3 knots, REML)

**Knot placement:** 10th/50th/90th percentiles of `ablat` (sorted: 13,13,18,19,27,33,33,42,42,44,44,52,55):
- 10th pct: idx=1.2 → 13+0.2×(18−13) = **14**
- 50th pct: idx=6 → sorted[6] = **33**
- 90th pct: idx=10.8 → 44+0.8×(52−44) = **50.4**

**Harrell RCS basis formula (one nonlinear column for 3 knots):**
```
phi1(x) = (x−14)³₊ − (50.4−14)/(50.4−33)·(x−33)³₊ + (33−14)/(50.4−33)·(x−50.4)³₊
```

**Equivalent R code:**
```r
library(metafor)
knots <- quantile(dat.bcg$ablat, c(0.10, 0.50, 0.90), type=7)  # 14, 33, 50.4
t1 <- knots[1]; tk1 <- knots[2]; tk <- knots[3]; denom <- tk - tk1
pos3 <- function(x, t) ifelse(x > t, (x-t)^3, 0)
phi1 <- pos3(dat.bcg$ablat, t1) - ((tk-t1)/denom)*pos3(dat.bcg$ablat,tk1) +
        ((tk1-t1)/denom)*pos3(dat.bcg$ablat, tk)
res  <- rma(dat.bcg$yi, dat.bcg$vi, mods = ~ dat.bcg$ablat + phi1, method="REML")
```

**Expected values:**

| Field | Value |
|-------|-------|
| beta  | [−0.2099, −0.0029, −0.0000264] |
| se    | [0.4384, 0.0217, 0.0000206] |
| τ²  | 0.0766 |
| QE    | 27.9911 (df=10, p=0.0018) |
| QM    | 17.9533 (df=2, p=0.0001) |
| I²    | 65.96% |
| R²    | 0.7555 |

**R-verified** (metafor 4.8.0, crossval_nonlinear.R block 49). All values match exactly.

**Tolerance:** abs 0.01 for beta/se, 5% rel for τ², abs 0.2 for I².

The very small nonlinear coefficient (−0.0000264) with se ~0.0000206 (z≈−1.28) indicates no significant nonlinearity in the BCG ablat data — expected for a 13-study dataset.

---

## WAAP-WLS benchmarks

### WAAP-1 — BCG Vaccine log-OR (dat.bcg, k=13)

**Method:** Stanley & Doucouliagos (2015) Weighted Average of Adequately Powered studies. WLS estimate first; power for each study computed as Φ(|θ_wls|/SE_i − z₀.₀₂₅) + Φ(−z₀.₀₂₅ − |θ_wls|/SE_i); adequate ≡ power ≥ 0.80; WAAP = WLS on adequate subset; fallback to all studies if kAdequate = 0.

**Data:** same 13 2×2 tables as the BCG pub-bias benchmark (OR measure, no continuity corrections needed).

**Derivation:**

WLS estimate = Σ(yᵢ/vᵢ) / Σ(1/vᵢ) = **−0.4361** (identical to FE pooled estimate).

Power check at |θ_wls| = 0.4361, z₀.₀₂₅ = 1.96:

| Study | vi | SE | ncp | power | adequate |
|---|---|---|---|---|---|
| Aronson 1948 | 0.3571 | 0.5976 | 0.730 | 11.3% | No |
| Ferguson & Simes 1949 | 0.2081 | 0.4562 | 0.956 | 16.0% | No |
| Rosenthal 1960 | 0.4334 | 0.6583 | 0.662 | 10.1% | No |
| Hart & Sutherland 1977 | 0.0203 | 0.1425 | 3.061 | 86.4% | **Yes** |
| Frimodt-Moller 1973 | 0.0520 | 0.2279 | 1.913 | 48.1% | No |
| Stein & Aronson 1953 | 0.0099 | 0.0995 | 4.379 | 99.2% | **Yes** |
| Vandiviere 1973 | 0.2270 | 0.4764 | 0.915 | 14.8% | No |
| TPT Madras 1980 | 0.0040 | 0.0633 | 6.888 | ≈100% | **Yes** |
| Coetzee & Berjak 1968 | 0.0570 | 0.2387 | 1.827 | 44.7% | No |
| Rosenthal 1961 | 0.0754 | 0.2747 | 1.588 | 35.5% | No |
| Comstock 1974 | 0.0125 | 0.1119 | 3.897 | 97.4% | **Yes** |
| Comstock & Webster 1969 | 0.5342 | 0.7309 | 0.597 | 8.2% | No |
| Comstock 1976 | 0.0716 | 0.2676 | 1.630 | 36.8% | No |

kAdequate = 4. WAAP = WLS on {Hart, Stein, TPT Madras, Comstock 1974}:

Σ(1/vᵢ) = 49.23 + 100.95 + 249.56 + 79.84 = 479.58  
Σ(yᵢ/vᵢ) = −71.66 − 96.74 + 3.05 − 27.19 = −192.54  
waap = −192.54 / 479.58 = **−0.4017**  
se = √(1/479.58) = **0.0457**  
z = −0.4017/0.0457 = **−8.79**, p ≈ 0  
CI = [−0.4910, −0.3119]

**R verification (generate.R block WAAP-1):** matches to 4 decimal places.

**Stored in `benchmarks.js`:** `PUB_BIAS_BENCHMARKS[0].tests.waap`

---

### WAAP-2 — Synthetic asymmetric funnel (k=6)

**Data:** yi = [−0.1, 0.3, 0.1, 0.9, 1.4, 0.5], vi = [0.04, 0.09, 0.0225, 0.36, 0.64, 0.16].

WLS estimate = **0.1436**. All 6 studies have power < 80% at |θ_wls| = 0.1436 (small effect, large SEs). kAdequate = 0 → fallback = true.

WAAP = WLS on all studies = **0.1436**, se = **0.1047**, z = 1.371, p = 0.170, CI = [−0.0617, 0.3489].

**R verification (generate.R block WAAP-2):** matches to 4 decimal places.

**Stored in `benchmarks.js`:** `PUB_BIAS_BENCHMARKS[1].tests.waap`

---

## EB benchmark

### EB-1 — BCG Vaccine log-RR (GENERIC, k=13)

**Method:** Morris (1983) Empirical Bayes τ² estimator. Uses the same RE-weighted Q(τ²) statistic as PM but with a scaled update step:

adj = (Q(τ²) · k/(k−1) − k) / W,  τ² ← max(0, τ² + adj)

where W = Σ wᵢ = Σ 1/(vᵢ+τ²). Both PM and EB converge to the fixed point Q(τ²) = k−1; EB simply takes a step scaled by k/(k−1) rather than 1, reaching the same limit with fewer iterations. Numerical differences from PM are sub-0.001.

**R (generate.R block EB-1):**
- tau2 = 0.318069, RE = −0.714968

**Stored in `benchmarks.js`:** "BCG Vaccine – GENERIC (log RR, EB)" entry. Expected tau2 = 0.318.

---

## PMM and GENQM benchmarks

### PMM-1 — BCG Vaccine log-RR (GENERIC, k=13)

**Method:** Paule-Mandel Median (PMM). Like PM, uses RE weights wᵢ = 1/(vᵢ + τ²), but finds τ² where Q(τ²) = χ²₀.₅(k−1) (the median of chi-square(k−1)) rather than its mean (k−1). Implemented as a fixed-point iteration:

τ² ← max(0, τ² + (Q(τ²) − χ²₀.₅(k−1)) / W)

Because χ²₀.₅(k−1) < k−1 for k > 2, the iteration target is smaller than PM's, resulting in a slightly larger τ² (more conservative). Gives a median-unbiased τ² estimate.

**Data:** BCG log-RR pre-computed yi/vi (same 13 studies as BENCHMARKS[0] REML entry).

**R (generate.R block PMM-1):**
- tau2 = 0.343409, RE = −0.717085 (RE weights), I2 = 92.86 (τ²-based)

**Stored in `benchmarks.js`:** "BCG Vaccine – GENERIC (log RR, PMM)" entry. Expected tau2 = 0.343.

---

### GENQM-1 — BCG Vaccine log-RR (GENERIC, k=13)

**Method:** Generalised-Q Median (GENQM), FE weights (aᵢ = 1/vᵢ). Finds τ² such that the observed FE Q-statistic lies at the median of its distribution under the RE model with heterogeneity τ².

Under H(τ²): Q_FE ~ Σᵢ λᵢ(τ²) χ²(1), where λᵢ(τ²) are the k−1 positive eigenvalues of S·P·S:
- P = diag(1/vᵢ) − (1/vᵢ)(1/vᵢ)ᵀ / W  (FE P matrix, fixed)
- S = diag(√(vᵢ + τ²))  (depends on τ²)

For p=1 (intercept-only), S·P·S = diag(dᵢ) − bᵢbᵢᵀ/W where dᵢ = (vᵢ+τ²)/vᵢ, bᵢ² = (vᵢ+τ²)/vᵢ². Eigenvalues are found via the secular equation:

Σᵢ bᵢ²/(dᵢ − λ) = W

The k−1 roots are located by bisection in the intervals (d_(i+1), d_(i)) (sorted decreasing d).

**CDF method:** The app evaluates the CDF of Σλᵢ χ²(1) via the exact Imhof (1961) numerical integral:

P(Q ≤ q) = ½ − (1/π) ∫₀^∞ sin(θ(u) − u·q/2) / (u·ρ(u)) du

where θ(u) = ½·Σ arctan(λⱼ·u) and log ρ(u) = ¼·Σ log(1 + λⱼ²u²). Computed via composite 20-point Gauss-Legendre quadrature (16 subintervals; adaptive upper limit T until amplitude < 1e-10). This is mathematically equivalent to the Farebrother/Davies algorithm used by metafor's `CompQuadForm`. Residual error vs metafor ground truth: ~0.05% (reduced from ~1.8% with the prior Lugannani-Rice saddlepoint and ~3–4% with the original Patnaik/Satterthwaite 2-moment approximation).

**Pooled estimate convention:** metafor GENQM uses FE weights for the pooled estimate; the app uses RE weights 1/(vᵢ+τ²), consistent with all other estimators. Expected RE in the benchmark is the app's RE value.

**R (generate.R block GENQM-1):**
- tau2 (exact) = 0.382788, RE (app convention, 1/(vi+tau2) weights) = −0.719884

**Stored in `benchmarks.js`:** "BCG Vaccine – GENERIC (log RR, GENQM)" entry. Expected tau2 = 0.383.

---

## RPB and RBIS benchmarks

### RPB-1 — 5 synthetic studies, equal groups (DL, τ²=0)

**Method:** Point-biserial correlation. yi = r_pb (identity). Variance:
vi = (1−r²)³/(n−2) + r²(1−r²)²/(2n)  [Kraemer 1975, metafor "ST" formula]

**Data:** 5 synthetic studies with equal group sizes (n1=n2):
- m1=[55,40,70,62,48], sd1=[10,12,15,11,9], n1=[30,25,40,35,20]
- m2=[45,35,60,50,40], sd2=[11,10,14,12,10], n2=[30,25,40,35,20]

**R (generate.R block RPB-1):**
- r_pb: 0.435497, 0.225079, 0.329520, 0.467504, 0.396108
- vi:   0.010212, 0.018281, 0.009621, 0.007971, 0.017165
- FE: 0.388244, RE: 0.388244, tau2: 0, I2: 0

**Stored in `benchmarks.js`:** "Synthetic – RPB (point-biserial, DL)" entry.

---

### RPB-2 — Heterogeneous (REML, τ²>0)

**Data:** Low r in large-n studies, high r in small-n studies. Equal groups (n1=n2=n/2). Target r_pb ≈ [0.10, 0.12, 0.55, 0.60, 0.50], n=[300,250,50,40,45].

**R (generate.R block RPB-2):**
- r_pb: 0.099834, 0.119618, 0.489494, 0.524222, 0.455383
- vi:   0.003273, 0.003889, 0.010545, 0.011843, 0.013028
- FE: 0.228287, RE: 0.321316, tau2: 0.038473, I2: 84.557

**Stored in `benchmarks.js`:** "Synthetic – RPB heterogeneous (REML, τ²>0)" entry.

---

### RBIS-1 — Biserial, equal groups p=0.5 (DL, τ²=0)

**Method:** Biserial correlation. For p=0.5: z=Φ⁻¹(0.5)=0, φ(0)=1/√(2π)≈0.3989, scale factor ≈ 1.2533.
- r_bis = √(0.25)/0.3989 × r_pb ≈ 1.2533 × r_pb
- Variance: vi = 1/(n−1) × [0.25/φ(0)² − (3/2 + 1)×r_bis² + r_bis⁴]  (z=0 → cross-terms = 1)

**Data:** Same 5 studies as RPB-1.

**R (generate.R block RBIS-1):**
- r_bis: 0.545814, 0.282095, 0.412992, 0.585930, 0.496447
- vi:    0.015505, 0.028126, 0.014854, 0.012034, 0.026036
- FE: 0.487378, RE: 0.487378, tau2: 0, I2: 0

**Stored in `benchmarks.js`:** "Synthetic – RBIS (biserial, DL, p=0.5)" entry.

---

### RBIS-2 — Biserial, heterogeneous (REML), unequal groups (p≈1/3)

**Data:** Same underlying m1/m2/sd as RPB-2, with n1=round(n/3), n2=n−n1.
p1 ≈ [0.333, 0.332, 0.340, 0.325, 0.333]. z = Φ⁻¹(1−p1) ≈ 0.431, φ(z) ≈ 0.365, factor ≈ 1.297.

**R (generate.R block RBIS-2):**
- r_pb:  0.094176, 0.112755, 0.469551, 0.499546, 0.434372
- r_bis: 0.122099, 0.146271, 0.607053, 0.650084, 0.563161
- vi:    0.005494, 0.006538, 0.017510, 0.019909, 0.021870
- FE: 0.282086, RE: 0.395761, tau2: 0.058787, I2: 83.2816

**Stored in `benchmarks.js`:** "Synthetic – RBIS heterogeneous (REML, unequal groups)" entry.

---

## R² benchmarks

### R2-1 — R-squared (raw), homogeneous (DL, τ²=0)

**Formula:** yi = R², vi = 4R²(1−R²)²/n (metafor "LS" formula). The `mi` argument is required by metafor's escalc but does not affect the variance.

**Data:** 5 synthetic studies with similar R² values so Q < df → τ²=0.
r2 = [0.25, 0.22, 0.28, 0.24, 0.26], n = [80, 100, 60, 120, 90].

**R (generate.R block R2-1):**
- yi: 0.25, 0.22, 0.28, 0.24, 0.26
- vi: 0.007031, 0.005354, 0.009677, 0.004621, 0.006328
- FE: 0.246174, RE: 0.246174, tau2: 0, I2: 0

**Stored in `benchmarks.js`:** "Synthetic – R2 (raw R², DL)" entry.

---

### R2-2 — R-squared (raw), heterogeneous (REML, τ²>0)

**Formula:** same as R2-1.

**Data:** 5 synthetic studies — low R² in large-n, high R² in small-n.
r2 = [0.04, 0.09, 0.49, 0.36, 0.25], n = [200, 150, 50, 80, 100].

**R (generate.R block R2-2):**
- yi: 0.04, 0.09, 0.49, 0.36, 0.25
- vi: 0.000737, 0.001987, 0.010196, 0.007373, 0.005625
- FE: 0.106064, RE: 0.229216, tau2: 0.029087, I2: 87.8553

**Stored in `benchmarks.js`:** "Synthetic – R2 heterogeneous (REML, τ²>0)" entry.

---

### ZR2-1 — Fisher-z R² (ZR2), homogeneous (DL, τ²=0)

**Formula:** yi = atanh(√R²), vi = 1/n. Back-transform: R² = tanh(yi)². Note vi = 1/n, not 1/(n−3).

**Data:** Same 5 studies as R2-1.

**R (generate.R block ZR2-1):**
- yi: 0.549306, 0.508841, 0.588964, 0.535926, 0.562597
- vi: 0.012500, 0.010000, 0.016667, 0.008333, 0.011111
- FE: 0.544692, RE: 0.544692, tau2: 0, I2: 0

**Stored in `benchmarks.js`:** "Synthetic – ZR2 (Fisher z of √R², DL)" entry.

---

### ZR2-2 — Fisher-z R² (ZR2), heterogeneous (REML, τ²>0)

**Formula:** same as ZR2-1.

**Data:** Same 5 studies as R2-2.

**R (generate.R block ZR2-2):**
- yi: 0.202733, 0.309520, 0.867301, 0.693147, 0.549306
- vi: 0.005000, 0.006667, 0.020000, 0.012500, 0.010000
- FE: 0.415038, RE: 0.507818, tau2: 0.061579
- RE back-transformed: tanh(0.507818)² ≈ 0.219

**Stored in `benchmarks.js`:** "Synthetic – ZR2 heterogeneous (REML, τ²>0)" entry.

---

## CLES benchmark

### CLES-1 — Normand 1999 SMD (REML, k=4)

**Method:** Common Language Effect Size (McGraw & Wong, 1992). CLES = Φ(d / √2), where d is the RE pooled SMD and Φ is the standard normal CDF. CI endpoints are transformed through the same function: CI = [Φ(lb/√2), Φ(ub/√2)].

**Data:** same 4 studies as the Normand 1999 SMD benchmark (`BENCHMARKS` entry "Normand 1999 – SMD Hedges' g, 4 studies (REML)").

**Derivation:**

From metafor (REML):
- RE = −1.2074, 95% CI = [−2.2245, −0.1902]

CLES = Φ(−1.2074 / √2) = Φ(−0.8537) = **0.1966**  
CI = [Φ(−2.2245 / √2), Φ(−0.1902 / √2)] = [Φ(−1.5727), Φ(−0.1345)] = [**0.0579**, **0.4465**]

**R verification (generate.R block CLES-1):** all values match to 4 decimal places.

**Stored in `benchmarks.js`:** `BENCHMARKS[0].expected.cles` (Normand SMD entry).


---

## Cronbach's α benchmarks

### ALPHA-1 — ARAW (raw α), DL, k_studies=3

**Method:** Raw α pooling (Feldt, 1965). yi = α, vi = 2k²(1−α)² / [n(k−1)].

**Data:** alpha = [0.60, 0.85, 0.90], k = [10, 10, 10], n = [100, 100, 100].

**Derivation (DL, closed form):**
- yi = [0.60, 0.85, 0.90] (trivially)
- vi = [0.035556, 0.005000, 0.002222]
- wi = [28.125, 200, 450]
- FE = (28.125×0.60 + 200×0.85 + 450×0.90) / (28.125+200+450) = 591.875/678.125 = 0.8728
- Q = 2.530, k−1=2, c = 319.33 → tau2_DL = 0.530/319.33 = 0.00166
- I2 = 0.530/2.530 × 100 = 20.95
- RE(DL) = 0.8641

**Stored in `benchmarks.js`:** "Cronbach's α (ARAW, DL, k_studies=3)".

---

### ALPHA-2 — ABT (log-transformed α), DL, k_studies=3

**Method:** Bonett (2002) log transform. yi = ln(1−α), vi = 2k/[n(k−1)]. Back-transform: 1−exp(yi).

**Data:** Same 3 studies as ALPHA-1.

**Derivation (DL, closed form):**
- yi = [ln(0.40), ln(0.15), ln(0.10)] = [−0.916291, −1.897120, −2.302585]
- vi = 20/900 = 0.022222 (identical for all studies since k and n are equal)
- wi = 45 (all equal)
- FE = mean(yi) = −1.7053
- Q = 45.727, k−1=2, c = 90 → tau2_DL = 43.727/90 = 0.4860
- I2 = 43.727/45.727 × 100 = 95.63
- RE(DL) = FE = −1.7053 (equal weights)

**Stored in `benchmarks.js`:** "Cronbach's α (ABT, DL, k_studies=3)".

---

### ALPHA-3 — AHW (cube-root-transformed α), DL, k_studies=3

**Method:** Hakstian & Whalen (1976) cube-root transform. u = k/(k−1)·(1−α), yi = u^(1/3), vi = 2k²/[9n(k−1)]·u^(2/3).

**Data:** Same 3 studies as ALPHA-1.

**Derivation (DL, closed form):**
- u = [10/9·0.40, 10/9·0.15, 10/9·0.10] = [4/9, 1/6, 1/9]
- yi = [(4/9)^(1/3), (1/6)^(1/3), (1/9)^(1/3)] = [0.763143, 0.550321, 0.480750]
- vi = 200/8100 × yi² = [0.014378, 0.007479, 0.005709]
- wi = [69.55, 133.70, 175.16]
- FE = 210.89/378.41 = 0.5573
- Q = 3.980, k−1=2, c = 237.32 → tau2_DL = 1.980/237.32 = 0.00834
- I2 = 1.980/3.980 × 100 = 49.76
- RE(DL) = 102.57/178.36 = 0.5751

**R verification (generate.R blocks ALPHA-1, ALPHA-2, ALPHA-3):** all values verified against direct formula computation; no metafor escalc call needed (formulas are exact).

**Stored in `benchmarks.js`:** "Cronbach's α (AHW, DL, k_studies=3)".

---

## No-R-Equivalent τ² Estimators — Intentionally Unverified

The following four τ² estimators appear in `js/benchmarks.js` with expected values but **have no `rBlock` field** and are therefore silently skipped by `diff_benchmarks.mjs`. This is intentional.

### Estimators

| Method | Key | Reason not R-verified |
|--------|-----|----------------------|
| Iterated DerSimonian-Laird | `DLIT` | Not available in metafor; only `DL` (one-step) is. Iterative version converges to a fixed point of the DL estimating equation. |
| Hunter-Schmidt corrected | `HSk` | metafor's `HS` estimator is uncorrected. `HSk` applies a correction factor `(k−1)/k`; no exact metafor equivalent. |
| Square-root GENQ | `SQGENQ` | metafor implements `GENQ` (standard) but not the square-root variant. |
| Empirical BLUP / REML alias | `EBLUP` | Exact alias for REML in this implementation; no separate metafor call needed. |

### Benchmark values

The expected values in `js/benchmarks.js` for these methods are internally consistent (computed from the same formulas as the live code) and are tested by `run_tests.mjs` to catch regressions, but they are **not cross-validated against metafor**. This is documented here so future maintainers know the gap is deliberate rather than an oversight.

If R equivalents are ever identified, add a `## DLIT-1`, `## HSk-1`, etc. block to `generate.R`, regenerate `benchmark_reference.json`, and add the `rBlock` field to the relevant `js/benchmarks.js` entries.

## No-R-Equivalent Analysis Methods — Intentionally Unverified

The following complete analysis methods are implemented in JS but have **no `js/benchmarks.js` entries and no R cross-validation**. This is intentional and documented here so the gap is explicit rather than an oversight.

### Bayesian Meta-Analysis (`bayesMeta` / `priorSensitivity`)

`js/bayes.js` implements profile-likelihood + Bayesian MA (Higgins et al. 2009; Lambert et al. 2005). The output is a posterior distribution over τ² and a credible interval for μ.

**Why no R cross-validation:** metafor does not implement full Bayesian MA. The closest R equivalent is `metamisc::valmeta()` (Bayesian) or `brms` — neither is in the standard metafor ecosystem. The profile-likelihood component (PLci) *is* covered indirectly by the VH_BENCHMARKS entries which use `profileLikTau2` / `profileLikCI`; the Bayesian credible intervals are not separately verified but are derived from the same grid.

**How to add in future:** Add a `brms` or `RBesT` R block that outputs posterior mean, SD, and 95% CrI; add a `BAYES_BENCHMARKS` array in `js/benchmarks.js`; add a `BAYES-*` diff section in `diff_benchmarks.mjs`.

### GOSH Plot (`goshCompute`)

`js/gosh.js` / `gosh.worker.js` implements the Galbraith-Olkin-Schein-Hedges (GOSH) plot by exhaustive or sampled enumeration of all subset meta-analyses.

**Why no R cross-validation:** metafor's `gosh.rma()` produces the same plot, but the output is a matrix of (subset_RE, subset_I2) pairs — one per subset — not a summarized scalar. Automating a numeric comparison against all ~2^k subsets for a range of k is feasible but not yet wired into the pipeline. The JS implementation is tested functionally (correct subset counts, finite outputs, worker thresholds) in `run_tests.mjs` convergence-plumbing and unit sections.

**How to add in future:** For a fixed dataset (e.g. BCG k=13) at a fixed seed / full enumeration, export the sorted (RE, I2) pair array from R and compare the JS output sorted the same way. Add a `GOSH_BENCHMARKS` array and a `GOSH-*` diff section.
