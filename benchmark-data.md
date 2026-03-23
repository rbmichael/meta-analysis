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
App formula for SMD_paired: d = (m_post-m_pre)/sd_change, g = d*J(n-1), vi = 1/n + d²/(2*n)

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

Per-study values (SMCC — change-score standardization, matches app formula):

| Label   |       d |       g |      vi |
|---------|--------:|--------:|--------:|
| Study 1 |  0.5643 |  0.5417 |  0.0580 |
| Study 2 |  1.0358 |  1.0198 |  0.0307 |
| Study 3 |  2.9488 |  2.6635 |  0.5942 |
| Study 4 |  2.0887 |  1.9096 |  0.3181 |
| Study 5 |  0.0813 |  0.0765 |  0.0717 |

Pooled (REML): beta=1.0622, tau²=0.6509, I²=79.73%
Pooled (FE):   beta=0.7887  (SE=0.1208, CI=[0.5520, 1.0254], Q=19.73)

Note: metafor's SMCR measure (raw-score standardization using sd_pre) gives
different yi=[0.5056, 1.0481, 1.8054, 1.4181, 0.0801]. The app uses SMCC.

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
