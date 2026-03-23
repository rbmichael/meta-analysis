// benchmarks.js
export const BENCHMARKS = [

  // ----------------------------------------------------------------
  // GENERIC — BCG Vaccine (dat.bcg, log RR, pre-computed yi/vi)
  // Source: Colditz et al. (1994). JAMA 271(9), 698–702.
  // Verified against metafor rma() at full precision.
  // ----------------------------------------------------------------
  {
    name: "BCG Vaccine – GENERIC (log RR, metafor exact)",
    type: "GENERIC",
    tauMethod: "REML",
    data: [
      { label: "Aronson 1948",          yi: -0.8893113339202054, vi: 0.3255847650039614   },
      { label: "Ferguson & Simes 1949", yi: -1.5853886572014306, vi: 0.19458112139814387  },
      { label: "Rosenthal 1960",        yi: -1.348073148299693,  vi: 0.41536796536796533  },
      { label: "Hart & Sutherland 1977",yi: -1.4415511900213054, vi: 0.020010031902247573 },
      { label: "Frimodt-Moller 1973",   yi: -0.2175473222112957, vi: 0.05121017216963086  },
      { label: "Stein & Aronson 1953",  yi: -0.786115585818864,  vi: 0.0069056184559087574},
      { label: "Vandiviere 1973",       yi: -1.6208982235983924, vi: 0.22301724757231517  },
      { label: "TPT Madras 1980",       yi:  0.011952333523841173,vi: 0.00396157929781773 },
      { label: "Coetzee & Berjak 1968", yi: -0.4694176487381487, vi: 0.056434210463248966 },
      { label: "Rosenthal 1961",        yi: -1.3713448034727846, vi: 0.07302479361302891  },
      { label: "Comstock 1974",         yi: -0.33935882833839015,vi: 0.01241221397155972  },
      { label: "Comstock & Webster 1969",yi: 0.4459134005713783, vi: 0.5325058452001528   },
      { label: "Comstock 1976",         yi: -0.017313948216879493,vi: 0.0714046596839863  }
    ],
    expected: {
      FE:   -0.430,
      RE:   -0.714,
      tau2:  0.313,
      I2:   92.2
    },
    citation: "Colditz et al. (1994) JAMA 271:698–702. dat.bcg in metafor."
  },

  // ----------------------------------------------------------------
  // OR — BCG Vaccine (dat.bcg, log odds ratio)
  // Same 13 studies as GENERIC benchmark above; raw 2x2 counts used here
  // to exercise the compute("OR") pipeline.
  // yi = ln(a*d / b*c),  vi = 1/a + 1/b + 1/c + 1/d
  // Per-study yi computed from raw counts (verified by hand).
  // Pooled FE/RE/τ²/I² confirmed from metafor test files (DL method;
  // REML not independently confirmed for OR in available test files).
  // ----------------------------------------------------------------
  {
    name: "BCG Vaccine – OR (dat.bcg, DL)",
    type: "OR",
    tauMethod: "DL",
    data: [
      { label: "Aronson 1948",           a:   4, b:   119, c:  11, d:   128 },
      { label: "Ferguson & Simes 1949",  a:   6, b:   300, c:  29, d:   274 },
      { label: "Rosenthal 1960",         a:   3, b:   228, c:  11, d:   209 },
      { label: "Hart & Sutherland 1977", a:  62, b: 13536, c: 248, d: 12619 },
      { label: "Frimodt-Moller 1973",    a:  33, b:  5036, c:  47, d:  5761 },
      { label: "Stein & Aronson 1953",   a: 180, b:  1361, c: 372, d:  1079 },
      { label: "Vandiviere 1973",        a:   8, b:  2537, c:  10, d:   619 },
      { label: "TPT Madras 1980",        a: 505, b: 87886, c: 499, d: 87892 },
      { label: "Coetzee & Berjak 1968",  a:  29, b:  7470, c:  45, d:  7232 },
      { label: "Rosenthal 1961",         a:  17, b:  1699, c:  65, d:  1600 },
      { label: "Comstock 1974",          a: 186, b: 50448, c: 141, d: 27197 },
      { label: "Comstock & Webster 1969",a:   5, b:  2493, c:   3, d:  2338 },
      { label: "Comstock 1976",          a:  27, b: 16886, c:  29, d: 17825 }
    ],
    expected: {
      // ln(a*d / b*c) per study, computed from raw counts
      yi:   [-0.9389, -1.6658, -1.3863, -1.4564, -0.2189, -0.9581,
             -1.6338,  0.0120, -0.4715, -1.4012, -0.3407,  0.4468, -0.0173],
      FE:   -0.436,
      RE:   -0.747,
      tau2:  0.366,
      I2:   92.65
    },
    citation: "Colditz et al. (1994) JAMA 271:698–702. dat.bcg in metafor. DL pooled values from metafor test suite."
  },

  // ----------------------------------------------------------------
  // RR — BCG Vaccine (dat.bcg, log risk ratio)
  // Same raw counts as OR benchmark above.
  // yi = ln((a/(a+b)) / (c/(c+d))),  vi = (1/a - 1/(a+b)) + (1/c - 1/(c+d))
  // Per-study yi rounded from full-precision metafor values in GENERIC benchmark.
  // Pooled FE/RE/τ²/I² confirmed from metadat HTML documentation (REML).
  // ----------------------------------------------------------------
  {
    name: "BCG Vaccine – RR (dat.bcg, REML)",
    type: "RR",
    tauMethod: "REML",
    data: [
      { label: "Aronson 1948",           a:   4, b:   119, c:  11, d:   128 },
      { label: "Ferguson & Simes 1949",  a:   6, b:   300, c:  29, d:   274 },
      { label: "Rosenthal 1960",         a:   3, b:   228, c:  11, d:   209 },
      { label: "Hart & Sutherland 1977", a:  62, b: 13536, c: 248, d: 12619 },
      { label: "Frimodt-Moller 1973",    a:  33, b:  5036, c:  47, d:  5761 },
      { label: "Stein & Aronson 1953",   a: 180, b:  1361, c: 372, d:  1079 },
      { label: "Vandiviere 1973",        a:   8, b:  2537, c:  10, d:   619 },
      { label: "TPT Madras 1980",        a: 505, b: 87886, c: 499, d: 87892 },
      { label: "Coetzee & Berjak 1968",  a:  29, b:  7470, c:  45, d:  7232 },
      { label: "Rosenthal 1961",         a:  17, b:  1699, c:  65, d:  1600 },
      { label: "Comstock 1974",          a: 186, b: 50448, c: 141, d: 27197 },
      { label: "Comstock & Webster 1969",a:   5, b:  2493, c:   3, d:  2338 },
      { label: "Comstock 1976",          a:  27, b: 16886, c:  29, d: 17825 }
    ],
    expected: {
      // Rounded from full-precision metafor values in the GENERIC benchmark above
      yi:   [-0.8893, -1.5854, -1.3481, -1.4416, -0.2175, -0.7861,
             -1.6209,  0.0120, -0.4694, -1.3713, -0.3394,  0.4459, -0.0173],
      FE:   -0.430,
      RE:   -0.715,
      tau2:  0.313,
      I2:   92.2
    },
    citation: "Colditz et al. (1994) JAMA 271:698–702. dat.bcg in metafor. REML pooled values from metadat HTML docs."
  },

  // ----------------------------------------------------------------
  // RD — BCG Vaccine (dat.bcg, risk difference)
  // Same raw counts as OR/RR benchmarks above.
  // yi = a/(a+b) - c/(c+d),  vi = risk1*(1-risk1)/(a+b) + risk2*(1-risk2)/(c+d)
  // Per-study yi computed from raw counts (verified by hand).
  // Pooled FE/RE/τ²/I² from agent research (DL; REML not confirmed for RD).
  // τ² is close to zero in absolute terms (~2e-5) but I² is high because
  // the per-study vi are also tiny for the large-n studies.
  // ----------------------------------------------------------------
  {
    name: "BCG Vaccine – RD (dat.bcg, DL)",
    type: "RD",
    tauMethod: "DL",
    data: [
      { label: "Aronson 1948",           a:   4, b:   119, c:  11, d:   128 },
      { label: "Ferguson & Simes 1949",  a:   6, b:   300, c:  29, d:   274 },
      { label: "Rosenthal 1960",         a:   3, b:   228, c:  11, d:   209 },
      { label: "Hart & Sutherland 1977", a:  62, b: 13536, c: 248, d: 12619 },
      { label: "Frimodt-Moller 1973",    a:  33, b:  5036, c:  47, d:  5761 },
      { label: "Stein & Aronson 1953",   a: 180, b:  1361, c: 372, d:  1079 },
      { label: "Vandiviere 1973",        a:   8, b:  2537, c:  10, d:   619 },
      { label: "TPT Madras 1980",        a: 505, b: 87886, c: 499, d: 87892 },
      { label: "Coetzee & Berjak 1968",  a:  29, b:  7470, c:  45, d:  7232 },
      { label: "Rosenthal 1961",         a:  17, b:  1699, c:  65, d:  1600 },
      { label: "Comstock 1974",          a: 186, b: 50448, c: 141, d: 27197 },
      { label: "Comstock & Webster 1969",a:   5, b:  2493, c:   3, d:  2338 },
      { label: "Comstock 1976",          a:  27, b: 16886, c:  29, d: 17825 }
    ],
    expected: {
      // risk1 - risk2 per study, computed from raw counts
      yi:   [-0.04662, -0.07610, -0.03701, -0.01471, -0.00158, -0.13957,
             -0.01276,  0.00007, -0.00232, -0.02913, -0.00148,  0.00072, -0.00003],
      FE:   -0.0009,
      RE:   -0.0071,
      tau2:  0.00002,
      I2:   95.66
    },
    citation: "Colditz et al. (1994) JAMA 271:698–702. dat.bcg in metafor. DL pooled values from agent research; Q=276.47 confirmed."
  },

  // ----------------------------------------------------------------
  // MD — Normand 1999 (dat.normand1999)
  // Source: Normand SLT (1999). Stat Med 18(3), 321–359.
  // Stroke rehabilitation: specialist (group 1) vs routine care (group 2).
  // yi = m1 - m2 (days); negative = specialist care shorter stay.
  // vi = sd1²/n1 + sd2²/n2  (app formula, matches metadat HTML docs).
  // Expected values confirmed from metafor rma(measure="MD", method="REML").
  // ----------------------------------------------------------------
  {
    name: "Normand 1999 – MD (dat.normand1999, REML)",
    type: "MD",
    tauMethod: "REML",
    data: [
      { label: "Edinburgh",          n1: 155, m1:  55, sd1: 47, n2: 156, m2:  75, sd2: 64 },
      { label: "Orpington-Mild",     n1:  31, m1:  27, sd1:  7, n2:  32, m2:  29, sd2:  4 },
      { label: "Orpington-Moderate", n1:  75, m1:  64, sd1: 17, n2:  71, m2: 119, sd2: 29 },
      { label: "Orpington-Severe",   n1:  18, m1:  66, sd1: 20, n2:  18, m2: 137, sd2: 48 },
      { label: "Montreal-Home",      n1:   8, m1:  14, sd1:  8, n2:  13, m2:  18, sd2: 11 },
      { label: "Montreal-Transfer",  n1:  57, m1:  19, sd1:  7, n2:  52, m2:  18, sd2:  4 },
      { label: "Newcastle",          n1:  34, m1:  52, sd1: 45, n2:  33, m2:  41, sd2: 34 },
      { label: "Umea",               n1: 110, m1:  21, sd1: 16, n2: 183, m2:  31, sd2: 27 },
      { label: "Uppsala",            n1:  60, m1:  30, sd1: 27, n2:  52, m2:  23, sd2: 20 }
    ],
    expected: {
      // yi = m1 - m2 (days); exact integer differences
      yi:   [-20, -2, -55, -71, -4, 1, 11, -10, 7],
      FE:   -3.464,
      RE:   -15.106,
      tau2:  684.6,
      I2:   96.65
    },
    citation: "Normand (1999) Stat Med 18:321–359. dat.normand1999 in metafor."
  },

  // ----------------------------------------------------------------
  // SMD (Hedges' g) — Normand 1999, first 4 studies
  // Same source as MD benchmark above; subset of 4 studies used because
  // REML τ²=1.009 is confirmed from a metafor test file for this subset.
  // Per-study g values confirmed against metafor escalc(measure="SMD") output.
  // ----------------------------------------------------------------
  {
    name: "Normand 1999 – SMD Hedges' g, 4 studies (REML)",
    type: "SMD",
    correction: "hedges",
    tauMethod: "REML",
    data: [
      { label: "Edinburgh",          n1: 155, m1:  55, sd1: 47, n2: 156, m2:  75, sd2: 64 },
      { label: "Orpington-Mild",     n1:  31, m1:  27, sd1:  7, n2:  32, m2:  29, sd2:  4 },
      { label: "Orpington-Moderate", n1:  75, m1:  64, sd1: 17, n2:  71, m2: 119, sd2: 29 },
      { label: "Orpington-Severe",   n1:  18, m1:  66, sd1: 20, n2:  18, m2: 137, sd2: 48 }
    ],
    expected: {
      // Hedges' g per study, confirmed from metafor escalc(measure="SMD")
      yi:   [-0.3552, -0.3479, -2.3176, -1.8880],
      FE:   -0.788,
      RE:   -1.207,
      tau2:  1.009,
      I2:   96.0
    },
    citation: "Normand (1999) Stat Med 18:321–359. dat.normand1999 in metafor. REML τ²=1.009 from metafor test suite."
  },

  // ----------------------------------------------------------------
  // MD_paired — Morris (2008), treatment arm (5 studies)
  // Source: Morris SB (2008). Org Res Methods 11(2), 364–386.
  // yi = m_post - m_pre
  // sd_change = sqrt(sd_pre² + sd_post² - 2·r·sd_pre·sd_post)
  // vi = sd_change² / n
  // Per-study yi/vi verified by hand. Pooled values from metafor test suite.
  // ----------------------------------------------------------------
  {
    name: "Morris 2008 – MD_paired (REML)",
    type: "MD_paired",
    tauMethod: "REML",
    data: [
      { label: "Study 1", m_pre: 30.6, m_post: 38.5, sd_pre: 15.0, sd_post: 11.6, n: 20, r: 0.47 },
      { label: "Study 2", m_pre: 23.5, m_post: 26.8, sd_pre:  3.1, sd_post:  4.1, n: 50, r: 0.64 },
      { label: "Study 3", m_pre:  0.5, m_post:  0.7, sd_pre:  0.1, sd_post:  0.1, n:  9, r: 0.77 },
      { label: "Study 4", m_pre: 53.4, m_post: 75.9, sd_pre: 14.5, sd_post:  4.4, n: 10, r: 0.89 },
      { label: "Study 5", m_pre: 35.6, m_post: 36.0, sd_pre:  4.7, sd_post:  4.6, n: 14, r: 0.44 }
    ],
    expected: {
      // yi = m_post - m_pre (exact); vi verified by hand
      yi:   [7.9, 3.3, 0.2, 22.5, 0.4],
      FE:    0.209,
      RE:    6.416,
      tau2: 73.57,
      I2:   95.84
    },
    citation: "Morris (2008) Org Res Methods 11:364–386. Pooled values from metafor test suite."
  },

  // ----------------------------------------------------------------
  // ZCOR — synthetic 5-study dataset (hand-computed, DL)
  // yi = atanh(r),  vi = 1/(n−3)
  // FE weights wi = n−3 (exact integers, so FE_z is a simple weighted mean).
  // τ²_DL, RE_z verified analytically; per-study zi verified by formula.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – ZCOR (Fisher's z, DL)",
    type: "ZCOR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", r: 0.50, n: 53  },
      { label: "Study 2", r: 0.30, n: 103 },
      { label: "Study 3", r: 0.60, n: 43  },
      { label: "Study 4", r: 0.40, n: 78  },
      { label: "Study 5", r: 0.25, n: 123 }
    ],
    expected: {
      // yi = atanh(r); verified to machine precision via Math.atanh
      yi:   [0.54931, 0.30952, 0.69315, 0.42365, 0.25541],
      // FE_z = Σ(wi·zi)/Σwi, wi=n-3; pooled on z scale (not back-transformed here)
      FE:    0.3859,
      RE:    0.4130,
      tau2:  0.01298,
      I2:   49.0
    },
    citation: "Synthetic dataset. Expected values computed analytically from Fisher z formulas."
  },

  // ----------------------------------------------------------------
  // COR — synthetic 5-study dataset (hand-computed, DL)
  // Same r/n as ZCOR benchmark; different vi formula: (1−r²)²/(n−1).
  // yi = r (raw correlation, no transform).
  // τ²_DL and pooled estimates verified analytically.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – COR (raw correlation, DL)",
    type: "COR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", r: 0.50, n: 53  },
      { label: "Study 2", r: 0.30, n: 103 },
      { label: "Study 3", r: 0.60, n: 43  },
      { label: "Study 4", r: 0.40, n: 78  },
      { label: "Study 5", r: 0.25, n: 123 }
    ],
    expected: {
      // yi = r exactly
      yi:   [0.500, 0.300, 0.600, 0.400, 0.250],
      // FE/RE on raw r scale; pooled values verified analytically via vi=(1-r²)²/(n-1)
      FE:    0.394,
      RE:    0.403,
      tau2:  0.01145,
      I2:   57.3
    },
    citation: "Synthetic dataset. Expected values computed analytically from raw-correlation formulas."
  },

  // ----------------------------------------------------------------
  // SMD_paired — Morris (2008), treatment arm (5 studies)
  // Same raw data as MD_paired benchmark above.
  // d = (m_post - m_pre) / sd_change,  g = d · J(n-1),  vi = 1/n + d²/(2n)
  // where J(df) = 1 - 3/(4·df - 1)  (Hedges' correction)
  // Per-study g/vi verified by hand. Pooled values from metafor test suite.
  // ----------------------------------------------------------------
  {
    name: "Morris 2008 – SMD_paired (REML)",
    type: "SMD_paired",
    tauMethod: "REML",
    data: [
      { label: "Study 1", m_pre: 30.6, m_post: 38.5, sd_pre: 15.0, sd_post: 11.6, n: 20, r: 0.47 },
      { label: "Study 2", m_pre: 23.5, m_post: 26.8, sd_pre:  3.1, sd_post:  4.1, n: 50, r: 0.64 },
      { label: "Study 3", m_pre:  0.5, m_post:  0.7, sd_pre:  0.1, sd_post:  0.1, n:  9, r: 0.77 },
      { label: "Study 4", m_pre: 53.4, m_post: 75.9, sd_pre: 14.5, sd_post:  4.4, n: 10, r: 0.89 },
      { label: "Study 5", m_pre: 35.6, m_post: 36.0, sd_pre:  4.7, sd_post:  4.6, n: 14, r: 0.44 }
    ],
    expected: {
      // Hedges' g per study, verified by hand against app formula
      yi:   [0.5417, 1.0201, 2.6639, 1.9093, 0.0765],
      FE:    0.789,
      RE:    1.062,
      tau2:  0.651,
      I2:   79.73
    },
    citation: "Morris (2008) Org Res Methods 11:364–386. Pooled values from metafor test suite."
  },

  // ----------------------------------------------------------------
  // PR — Synthetic proportion dataset (raw proportion)
  // 4 studies with x/n data, equal n=100.
  // yi = p = x/n,  vi = p(1-p)/n.
  // Per-study yi exact; FE/RE/tau2/I2 computed analytically (DL).
  // ----------------------------------------------------------------
  {
    name: "Synthetic Proportion – PR (DL)",
    type: "PR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", x: 10, n: 100 },
      { label: "Study 2", x: 30, n: 100 },
      { label: "Study 3", x: 20, n: 100 },
      { label: "Study 4", x: 40, n: 100 }
    ],
    expected: {
      yi:   [0.100, 0.300, 0.200, 0.400],
      FE:    0.208,
      RE:    0.246,
      tau2:  0.01581,
      I2:   90.7
    },
    citation: "Synthetic dataset. Expected values computed analytically from PR formulas."
  },

  // ----------------------------------------------------------------
  // PLO — Synthetic proportion dataset (logit)
  // Same 4 studies. yi = logit(p),  vi = 1 / (n·p·(1−p)).
  // Per-study logit yi verified by hand. FE/RE/tau2/I2 analytic (DL).
  // ----------------------------------------------------------------
  {
    name: "Synthetic Proportion – PLO (DL)",
    type: "PLO",
    tauMethod: "DL",
    data: [
      { label: "Study 1", x: 10, n: 100 },
      { label: "Study 2", x: 30, n: 100 },
      { label: "Study 3", x: 20, n: 100 },
      { label: "Study 4", x: 40, n: 100 }
    ],
    expected: {
      yi:   [-2.197, -0.847, -1.386, -0.405],
      FE:   -0.993,
      RE:   -1.174,
      tau2:  0.4197,
      I2:   87.6
    },
    citation: "Synthetic dataset. Expected values computed analytically from PLO (logit) formulas."
  },

  // ----------------------------------------------------------------
  // PAS — Synthetic proportion dataset (arcsine square root)
  // Same 4 studies. yi = arcsin(√p),  vi = 1/(4n).
  // All vi equal (n=100) => RE = FE. tau2/I2 analytic (DL).
  // ----------------------------------------------------------------
  {
    name: "Synthetic Proportion – PAS (DL)",
    type: "PAS",
    tauMethod: "DL",
    data: [
      { label: "Study 1", x: 10, n: 100 },
      { label: "Study 2", x: 30, n: 100 },
      { label: "Study 3", x: 20, n: 100 },
      { label: "Study 4", x: 40, n: 100 }
    ],
    expected: {
      yi:   [0.322, 0.580, 0.464, 0.685],
      FE:    0.513,
      RE:    0.513,
      tau2:  0.02186,
      I2:   89.7
    },
    citation: "Synthetic dataset. Expected values computed analytically from PAS (arcsine) formulas."
  },

  // ----------------------------------------------------------------
  // PFT — Synthetic proportion dataset (Freeman-Tukey double-arcsine)
  // Same 4 studies. yi = arcsin(√(x/(n+1))) + arcsin(√((x+1)/(n+1)))
  // vi = 1/(n+0.5). Equal vi => RE = FE. tau2/I2 analytic (DL).
  // ----------------------------------------------------------------
  {
    name: "Synthetic Proportion – PFT (DL)",
    type: "PFT",
    tauMethod: "DL",
    data: [
      { label: "Study 1", x: 10, n: 100 },
      { label: "Study 2", x: 30, n: 100 },
      { label: "Study 3", x: 20, n: 100 },
      { label: "Study 4", x: 40, n: 100 }
    ],
    expected: {
      yi:   [0.656, 1.162, 0.934, 1.371],
      FE:    1.031,
      RE:    1.031,
      tau2:  0.08445,
      I2:   89.5
    },
    citation: "Synthetic dataset. Expected values computed analytically from PFT (Freeman-Tukey) formulas."
  },

  // ================================================================
  // TAU² ESTIMATOR BENCHMARKS
  //
  // Dataset: yi=[0, 1, 3], vi=[1, 1, 1]  (k=3, equal variances)
  //
  // Because all vi are equal, the weighted mean equals the unweighted
  // mean for any τ² value, so FE = RE = (0+1+3)/3 = 4/3 ≈ 1.333 for
  // every method.  I² = (Q−df)/Q = (4.667−2)/4.667 = 57.1% (fixed).
  // Only τ² differs by method, making this ideal for isolating each
  // estimator formula.  All expected values derived analytically.
  //
  //   Q  = Σwᵢ(yᵢ−ȳ)²  =  42/9  ≈ 4.667
  //   df = k−1 = 2
  //   ΣW = Σwᵢ  = 3   (wᵢ=1/vᵢ=1)
  //   c  = ΣW − ΣW²/ΣW = 2   (DL denominator)
  // ================================================================

  // ----------------------------------------------------------------
  // HS — Hunter-Schmidt
  // τ²_HS = max(0, (Q−df) / ΣW) = (4.667−2)/3 = 8/9 ≈ 0.889
  // ----------------------------------------------------------------
  {
    name: "Synthetic τ² test – HS (k=3, equal vi)",
    type: "GENERIC",
    tauMethod: "HS",
    data: [
      { label: "Study 1", yi: 0, vi: 1 },
      { label: "Study 2", yi: 1, vi: 1 },
      { label: "Study 3", yi: 3, vi: 1 }
    ],
    expected: {
      FE:   1.333,
      RE:   1.333,
      tau2: 0.8889,   // 8/9
      I2:  57.1
    },
    citation: "Synthetic. τ²_HS = (Q−df)/ΣW = (42/9−2)/3 = 8/9. Derived analytically."
  },

  // ----------------------------------------------------------------
  // HE — Hedges (unweighted method of moments)
  // τ²_HE = SS_uw/(k−1) − mean(vᵢ)
  //       = (42/9)/2 − 1 = 7/3 − 1 = 4/3 ≈ 1.333
  // ----------------------------------------------------------------
  {
    name: "Synthetic τ² test – HE (k=3, equal vi)",
    type: "GENERIC",
    tauMethod: "HE",
    data: [
      { label: "Study 1", yi: 0, vi: 1 },
      { label: "Study 2", yi: 1, vi: 1 },
      { label: "Study 3", yi: 3, vi: 1 }
    ],
    expected: {
      FE:   1.333,
      RE:   1.333,
      tau2: 1.3333,   // 4/3
      I2:  57.1
    },
    citation: "Synthetic. τ²_HE = SS_uw/(k−1) − mean(v) = (42/9)/2 − 1 = 4/3. Derived analytically."
  },

  // ----------------------------------------------------------------
  // ML — Maximum Likelihood
  // Fixed point of score=0:  (42/9)/(1+τ²)² = 3/(1+τ²)
  // → 1+τ² = (42/9)/3 = 14/9  → τ² = 5/9 ≈ 0.556
  // ----------------------------------------------------------------
  {
    name: "Synthetic τ² test – ML (k=3, equal vi)",
    type: "GENERIC",
    tauMethod: "ML",
    data: [
      { label: "Study 1", yi: 0, vi: 1 },
      { label: "Study 2", yi: 1, vi: 1 },
      { label: "Study 3", yi: 3, vi: 1 }
    ],
    expected: {
      FE:   1.333,
      RE:   1.333,
      tau2: 0.5556,   // 5/9
      I2:  57.1
    },
    citation: "Synthetic. τ²_ML fixed point: (42/9)/(1+τ²) = 3 → τ² = 5/9. Derived analytically."
  },

  // ----------------------------------------------------------------
  // SJ — Sidik-Jonkman
  // Fixed point: τ²(1+τ²) = (1/k)·Σvᵢ(yᵢ−μ)²/(vᵢ+τ²)·(1+τ²)
  // With equal vᵢ=1: τ²(1+τ²) = (42/9)/3 = 14/9
  // → τ² = (√65−3)/6 ≈ 0.844
  // ----------------------------------------------------------------
  {
    name: "Synthetic τ² test – SJ (k=3, equal vi)",
    type: "GENERIC",
    tauMethod: "SJ",
    data: [
      { label: "Study 1", yi: 0, vi: 1 },
      { label: "Study 2", yi: 1, vi: 1 },
      { label: "Study 3", yi: 3, vi: 1 }
    ],
    expected: {
      FE:   1.333,
      RE:   1.333,
      tau2: 0.8437,   // (√65−3)/6
      I2:  57.1
    },
    citation: "Synthetic. τ²_SJ fixed point: τ²(1+τ²) = 14/9 → τ² = (√65−3)/6. Derived analytically."
  },

  // ----------------------------------------------------------------
  // HR — Synthetic hazard ratio dataset (hand-computed, DL)
  // yi = log(hr),  se = (log(ci_hi)−log(ci_lo)) / (2·1.96),  vi = se²
  // 4 studies, equal se=0.25 (vi=0.0625) on log scale.
  // Because all vi are equal, RE = FE regardless of τ².
  //   yi: [−0.5, −0.1, −0.9, −0.3]
  //   FE = (−0.5−0.1−0.9−0.3)/4 = −0.450
  //   Q  = Σwi·(yi−FE)² = 16·(0.05²+0.35²+0.45²+0.15²) = 16·0.35 = 5.6
  //   df = 3,  c = ΣW − ΣW²/ΣW = 64 − 16 = 48
  //   τ²_DL = (5.6−3)/48 = 0.054
  //   I²    = (5.6−3)/5.6 = 46.4%
  // ----------------------------------------------------------------
  {
    name: "Synthetic – HR (log hazard ratio, DL)",
    type: "HR",
    tauMethod: "DL",
    data: [
      // hr = exp(yi), ci_lo/ci_hi = exp(yi ∓ 0.49)  [0.49 = 1.96·0.25]
      { label: "Study 1", hr: 0.6065, ci_lo: 0.3716, ci_hi: 0.9900 },
      { label: "Study 2", hr: 0.9048, ci_lo: 0.5543, ci_hi: 1.4770 },
      { label: "Study 3", hr: 0.4066, ci_lo: 0.2491, ci_hi: 0.6637 },
      { label: "Study 4", hr: 0.7408, ci_lo: 0.4538, ci_hi: 1.2092 }
    ],
    expected: {
      // yi = log(hr), verified by formula
      yi:   [-0.500, -0.100, -0.900, -0.300],
      FE:   -0.450,
      RE:   -0.450,   // equal vi → RE = FE
      tau2:  0.054,
      I2:   46.4
    },
    citation: "Synthetic dataset. Expected values derived analytically from HR log-scale formulas."
  },

  // ----------------------------------------------------------------
  // IRR — Synthetic incidence rate ratio dataset (hand-computed, DL)
  // yi = log(x1/t1) − log(x2/t2),  vi = 1/x1 + 1/x2
  // 4 studies: x1=[5,18,8,14], x2=20 for all, t1=t2=100.
  //   yi: [ln(0.25), ln(0.9), ln(0.4), ln(0.7)]
  //       = [−1.3863, −0.1054, −0.9163, −0.3567]
  //   vi: [0.250, 0.1056, 0.175, 0.1214]
  //   FE = −0.537  (verified analytically)
  //   τ²_DL = 0.138,  I² = 47.7%,  RE = −0.605
  // ----------------------------------------------------------------
  {
    name: "Synthetic – IRR (incidence rate ratio, DL)",
    type: "IRR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", x1: 5,  t1: 100, x2: 20, t2: 100 },
      { label: "Study 2", x1: 18, t1: 100, x2: 20, t2: 100 },
      { label: "Study 3", x1: 8,  t1: 100, x2: 20, t2: 100 },
      { label: "Study 4", x1: 14, t1: 100, x2: 20, t2: 100 }
    ],
    expected: {
      // yi = log(x1/x2) since t1=t2
      yi:   [-1.386, -0.105, -0.916, -0.357],
      FE:   -0.537,
      RE:   -0.605,
      tau2:  0.138,
      I2:   47.7
    },
    citation: "Synthetic dataset. Expected values derived analytically from IRR Poisson formulas."
  },

  // ----------------------------------------------------------------
  // IR — Synthetic incidence rate dataset (hand-computed, DL)
  // yi = log(x/t),  vi = 1/x
  // 4 studies: x=[10,25,5,20], t=[200,300,400,250].
  //   yi: [ln(0.05), ln(25/300), ln(0.0125), ln(0.08)]
  //       = [−2.9957, −2.4849, −4.3820, −2.5257]
  //   vi: [0.1, 0.04, 0.2, 0.05]
  //   FE = −2.742  (verified analytically)
  //   τ²_DL = 0.335,  I² = 82.0%,  RE = −2.997
  // ----------------------------------------------------------------
  {
    name: "Synthetic – IR (incidence rate log, DL)",
    type: "IR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", x: 10, t: 200 },
      { label: "Study 2", x: 25, t: 300 },
      { label: "Study 3", x:  5, t: 400 },
      { label: "Study 4", x: 20, t: 250 }
    ],
    expected: {
      // yi = log(x/t), verified by formula
      yi:   [-2.996, -2.485, -4.382, -2.526],
      FE:   -2.742,
      RE:   -2.997,
      tau2:  0.335,
      I2:   82.0
    },
    citation: "Synthetic dataset. Expected values derived analytically from Poisson IR formulas."
  }

];
