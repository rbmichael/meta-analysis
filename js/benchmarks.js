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
  // SMCR formula: d = (m_post - m_pre) / sd_pre  (pre-test SD standardiser)
  // g = d · J(df),  J = 1 − 3/(4·df − 1),  df = n − 1
  // vi = J² · [2(1−r)/n + d²/(2·df)]
  // Per-study g verified by hand; pooled values computed analytically (DL).
  // ----------------------------------------------------------------
  {
    name: "Morris 2008 – SMD_paired (DL)",
    type: "SMD_paired",
    tauMethod: "DL",
    data: [
      { label: "Study 1", m_pre: 30.6, m_post: 38.5, sd_pre: 15.0, sd_post: 11.6, n: 20, r: 0.47 },
      { label: "Study 2", m_pre: 23.5, m_post: 26.8, sd_pre:  3.1, sd_post:  4.1, n: 50, r: 0.64 },
      { label: "Study 3", m_pre:  0.5, m_post:  0.7, sd_pre:  0.1, sd_post:  0.1, n:  9, r: 0.77 },
      { label: "Study 4", m_pre: 53.4, m_post: 75.9, sd_pre: 14.5, sd_post:  4.4, n: 10, r: 0.89 },
      { label: "Study 5", m_pre: 35.6, m_post: 36.0, sd_pre:  4.7, sd_post:  4.6, n: 14, r: 0.44 }
    ],
    expected: {
      // Hedges' g per study: d = Δm/sd_pre, g = d·J, verified by hand
      yi:   [0.5056, 1.0481, 1.8065, 1.4187, 0.0801],
      FE:    0.839,
      RE:    0.892,
      tau2:  0.2474,
      I2:   78.0
    },
    citation: "Morris (2008) Org Res Methods 11:364–386. Per-study g and pooled values computed analytically from SMCR formula."
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
      yi:   [0.656, 1.1636, 0.934, 1.371],
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
  // PM — Paule-Mandel iterative moment-matching
  // Uses UNEQUAL vi=[0.25,0.50,1.00] to produce a value distinct from DL/HE.
  // (For equal vi, PM = HE analytically.)
  //
  // Dataset: yi=[0,1,3], vi=[0.25,0.50,1.00]
  //
  // Fixed-weight quantities (τ²-independent):
  //   w_FE = [4,2,1], W_FE = 7
  //   FE   = (0·4+1·2+3·1)/7 = 5/7 ≈ 0.714
  //   Q_FE = 4·(5/7)²+2·(2/7)²+1·(16/7)² = (100+8+256)/49 = 364/49 ≈ 7.429
  //   I²   = (Q−df)/Q = 266/364 ≈ 73.1%
  //
  // τ²_PM: iterative solution of Q(τ*)=k−1=2
  //   Update: τ²_new = τ² + (Q(τ²)−2)/W(τ²)  [start τ²=0, converge ~1e−10]
  //   Converges to τ² ≈ 1.648, RE ≈ 1.167
  //   Verified against metafor: rma(c(0,1,3), c(0.25,0.50,1.00), method="PM")
  // ----------------------------------------------------------------
  {
    name: "Synthetic τ² test – PM (k=3, unequal vi)",
    type: "GENERIC",
    tauMethod: "PM",
    data: [
      { label: "Study 1", yi: 0, vi: 0.25 },
      { label: "Study 2", yi: 1, vi: 0.50 },
      { label: "Study 3", yi: 3, vi: 1.00 }
    ],
    expected: {
      FE:   0.714,
      RE:   1.167,
      tau2: 1.648,
      I2:  73.1
    },
    citation: "Synthetic. τ²_PM iterative fixed-point (unequal vi so PM≠HE). Verified against metafor rma(method='PM')."
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
  },

  // ----------------------------------------------------------------
  // SMDH — Normand 1999 (dat.normand1999, all 9 studies)
  // Same raw data as the MD benchmark above.
  // Standardiser: sdi = √((sd1²+sd2²)/2)  (average, not pooled).
  // d = (m1−m2)/sdi,  g = d·J,  J = 1−3/(4·df−1),  df = n1+n2−2
  // vi = [(sd1²/n1 + sd2²/n2)/sdi² + d²/(2·df)] · J²
  // Pooled FE analytically derived; RE/τ²/I² via REML (Python script).
  // ----------------------------------------------------------------
  {
    name: "Normand 1999 – SMDH (heteroscedastic g, REML)",
    type: "SMDH",
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
      // g per study (sdi = avg-SD standardiser); verified by formula
      yi:   [-0.3553, -0.3465, -2.3018, -1.8880, -0.3993, 0.1742, 0.2726, -0.4494, 0.2926],
      FE:   -0.411,
      RE:   -0.538,
      tau2:  0.782,
      I2:   93.5
    },
    citation: "Normand (1999) Stat Med 18:321–359. dat.normand1999 in metafor. REML values computed analytically (Python)."
  },

  // ----------------------------------------------------------------
  // ROM — Normand 1999 (dat.normand1999, all 9 studies)
  // Same raw data as the MD / SMDH benchmarks above.
  // yi = ln(m1/m2),  vi = sd1²/(n1·m1²) + sd2²/(n2·m2²)
  // All 9 means are strictly positive; Montreal-Home (n1=8) triggers a
  // soft warning but is not excluded.
  // Pooled FE analytically derived; RE/τ²/I² via REML (Python script).
  // ----------------------------------------------------------------
  {
    name: "Normand 1999 – ROM (log ratio of means, REML)",
    type: "ROM",
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
      // yi = ln(m1/m2) per study, verified by formula
      yi:   [-0.3102, -0.0715, -0.6202, -0.7303, -0.2513, 0.0541, 0.2377, -0.3895, 0.2657],
      FE:   -0.303,
      RE:   -0.218,
      tau2:  0.108,
      I2:   94.6
    },
    citation: "Normand (1999) Stat Med 18:321–359. dat.normand1999 in metafor. REML values computed analytically (Python)."
  },

  // ----------------------------------------------------------------
  // SMCC — Morris (2008), treatment arm (5 studies)
  // Same raw data as the MD_paired / SMD_paired benchmarks above.
  // Standardiser: sd_change (change-score SD), not sd_pre.
  // sd_change = √(sd_pre²+sd_post²−2·r·sd_pre·sd_post)
  // d = Δm/sd_change,  g = d·J,  J = 1−3/(4·(n−1)−1)
  // vi = J²·[2(1−r)/n + d²/(2(n−1))]
  // All values computed analytically (DL).
  // ----------------------------------------------------------------
  {
    name: "Morris 2008 – SMCC (change-score SD, DL)",
    type: "SMCC",
    tauMethod: "DL",
    data: [
      { label: "Study 1", m_pre: 30.6, m_post: 38.5, sd_pre: 15.0, sd_post: 11.6, n: 20, r: 0.47 },
      { label: "Study 2", m_pre: 23.5, m_post: 26.8, sd_pre:  3.1, sd_post:  4.1, n: 50, r: 0.64 },
      { label: "Study 3", m_pre:  0.5, m_post:  0.7, sd_pre:  0.1, sd_post:  0.1, n:  9, r: 0.77 },
      { label: "Study 4", m_pre: 53.4, m_post: 75.9, sd_pre: 14.5, sd_post:  4.4, n: 10, r: 0.89 },
      { label: "Study 5", m_pre: 35.6, m_post: 36.0, sd_pre:  4.7, sd_post:  4.6, n: 14, r: 0.44 }
    ],
    expected: {
      // g per study (sd_change standardiser), verified by formula
      yi:   [0.5417, 1.0198, 2.6635, 1.9096, 0.0765],
      FE:    0.839,
      RE:    1.038,
      tau2:  0.373,
      I2:   82.7
    },
    citation: "Morris (2008) Org Res Methods 11:364–386. SMCC formula: Borenstein et al. (2009). DL values computed analytically (Python)."
  },

  // ----------------------------------------------------------------
  // PLN — Synthetic proportion dataset (log proportion)
  // Same 4 studies as the PR/PLO/PAS/PFT benchmarks above.
  // yi = ln(p),  vi = (1−p)/(n·p)  (no zero cells → no correction)
  // All values computed analytically (DL).
  // ----------------------------------------------------------------
  {
    name: "Synthetic Proportion – PLN (log, DL)",
    type: "PLN",
    tauMethod: "DL",
    data: [
      { label: "Study 1", x: 10, n: 100 },
      { label: "Study 2", x: 30, n: 100 },
      { label: "Study 3", x: 20, n: 100 },
      { label: "Study 4", x: 40, n: 100 }
    ],
    expected: {
      // yi = ln(x/n) per study, exact
      yi:   [-2.3026, -1.2040, -1.6094, -0.9163],
      FE:   -1.226,
      RE:   -1.452,
      tau2:  0.2051,
      I2:   86.9
    },
    citation: "Synthetic dataset. Expected values computed analytically from PLN (log proportion) formulas."
  },

  // ----------------------------------------------------------------
  // PHI — BCG Vaccine (dat.bcg, phi coefficient)
  // Same 13 studies as the OR/RR/RD benchmarks above.
  // phi = (a·d−b·c)/√((a+b)(c+d)(a+c)(b+d)),  vi = (1−φ²)²/(N−1)
  // Large N per study → small vi; phi values are small negative
  // (BCG reduces TB → negative association in vaccinated/unvaccinated
  // × TB+ / TB− table). τ² is small in absolute terms but I² is high
  // because the per-study vi are also tiny for the large-n studies.
  // All values computed analytically (DL).
  // ----------------------------------------------------------------
  {
    name: "BCG Vaccine – PHI (phi coefficient, DL)",
    type: "PHI",
    tauMethod: "DL",
    data: [
      { label: "Aronson 1948",            a:   4, b:   119, c:  11, d:   128 },
      { label: "Ferguson & Simes 1949",   a:   6, b:   300, c:  29, d:   274 },
      { label: "Rosenthal 1960",          a:   3, b:   228, c:  11, d:   209 },
      { label: "Hart & Sutherland 1977",  a:  62, b: 13536, c: 248, d: 12619 },
      { label: "Frimodt-Moller 1973",     a:  33, b:  5036, c:  47, d:  5761 },
      { label: "Stein & Aronson 1953",    a: 180, b:  1361, c: 372, d:  1079 },
      { label: "Vandiviere 1973",         a:   8, b:  2537, c:  10, d:   619 },
      { label: "TPT Madras 1980",         a: 505, b: 87886, c: 499, d: 87892 },
      { label: "Coetzee & Berjak 1968",   a:  29, b:  7470, c:  45, d:  7232 },
      { label: "Rosenthal 1961",          a:  17, b:  1699, c:  65, d:  1600 },
      { label: "Comstock 1974",           a: 186, b: 50448, c: 141, d: 27197 },
      { label: "Comstock & Webster 1969", a:   5, b:  2493, c:   3, d:  2338 },
      { label: "Comstock 1976",           a:  27, b: 16886, c:  29, d: 17825 }
    ],
    expected: {
      // phi per study, verified by formula
      yi:   [-0.1001, -0.1635, -0.1067, -0.0684, -0.0092, -0.1798,
             -0.0677,  0.0005, -0.0164, -0.0947, -0.0110,  0.0089, -0.0003],
      FE:   -0.012,
      RE:   -0.048,
      tau2:  0.001,
      I2:   95.5
    },
    citation: "Colditz et al. (1994) JAMA 271:698–702. dat.bcg in metafor. DL values computed analytically (Python)."
  },

  // ----------------------------------------------------------------
  // MN — Normand 1999, specialist arm (single-group raw mean, REML)
  // Uses the 9 specialist-arm entries (m1i, sd1i, n1i) from dat.normand1999.
  // yi = m,  vi = sd²/n   (direct SEM² formula)
  // FE analytically derived; RE/τ²/I² via REML (Python script).
  // Montreal-Home (n=8) is included — n<10 triggers a soft warning
  // but is not excluded (same as in the MD benchmark).
  // ----------------------------------------------------------------
  {
    name: "Normand 1999 – MN (raw mean, specialist arm, REML)",
    type: "MN",
    tauMethod: "REML",
    data: [
      { label: "Edinburgh",          m:  55, sd: 47, n: 155 },
      { label: "Orpington-Mild",     m:  27, sd:  7, n:  31 },
      { label: "Orpington-Moderate", m:  64, sd: 17, n:  75 },
      { label: "Orpington-Severe",   m:  66, sd: 20, n:  18 },
      { label: "Montreal-Home",      m:  14, sd:  8, n:   8 },
      { label: "Montreal-Transfer",  m:  19, sd:  7, n:  57 },
      { label: "Newcastle",          m:  52, sd: 45, n:  34 },
      { label: "Umea",               m:  21, sd: 16, n: 110 },
      { label: "Uppsala",            m:  30, sd: 27, n:  60 }
    ],
    expected: {
      // yi = m per study (raw mean), exact
      yi:   [55, 27, 64, 66, 14, 19, 52, 21, 30],
      FE:   27.170,
      RE:   38.325,
      tau2: 408.928,
      I2:   98.67
    },
    citation: "Normand (1999) Stat Med 18:321–359. dat.normand1999 specialist arm. REML values computed analytically (Python)."
  },

  // ----------------------------------------------------------------
  // MNLN — Normand 1999, specialist arm (log mean, REML)
  // Same specialist-arm data as MN above.
  // yi = ln(m),  vi = sd²/(n·m²)   (delta-method variance of log)
  // FE analytically derived; RE/τ²/I² via REML (Python script).
  // ----------------------------------------------------------------
  {
    name: "Normand 1999 – MNLN (log mean, specialist arm, REML)",
    type: "MNLN",
    tauMethod: "REML",
    data: [
      { label: "Edinburgh",          m:  55, sd: 47, n: 155 },
      { label: "Orpington-Mild",     m:  27, sd:  7, n:  31 },
      { label: "Orpington-Moderate", m:  64, sd: 17, n:  75 },
      { label: "Orpington-Severe",   m:  66, sd: 20, n:  18 },
      { label: "Montreal-Home",      m:  14, sd:  8, n:   8 },
      { label: "Montreal-Transfer",  m:  19, sd:  7, n:  57 },
      { label: "Newcastle",          m:  52, sd: 45, n:  34 },
      { label: "Umea",               m:  21, sd: 16, n: 110 },
      { label: "Uppsala",            m:  30, sd: 27, n:  60 }
    ],
    expected: {
      // yi = ln(m) per study, verified by formula
      yi:   [4.0073, 3.2958, 4.1589, 4.1897, 2.6391, 2.9444, 3.9512, 3.0445, 3.4012],
      FE:    3.694,
      RE:    3.523,
      tau2:  0.316,
      I2:   98.9
    },
    citation: "Normand (1999) Stat Med 18:321–359. dat.normand1999 specialist arm. REML values computed analytically (Python)."
  },

  // ----------------------------------------------------------------
  // CVR — Synthetic variability dataset (profiles.js CVR exampleData, DL)
  // 5 studies with n≥28, m>0, CV<1, SD ratio<4 — all soft-warning
  // thresholds satisfied.
  // yi = ln(cv1/cv2),  vi = 1/(2(n1−1)) + cv1²/n1 + 1/(2(n2−1)) + cv2²/n2
  // τ²=0 reflects homogeneous CVR across these studies (all ≈ 0.56).
  // ----------------------------------------------------------------
  {
    name: "Synthetic Variability – CVR (log CV ratio, DL)",
    type: "CVR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", m1: 25.0, sd1:  6.2, n1: 40, m2: 24.8, sd2: 3.5, n2: 38 },
      { label: "Study 2", m1: 30.1, sd1:  9.0, n1: 55, m2: 29.7, sd2: 4.8, n2: 52 },
      { label: "Study 3", m1: 18.5, sd1:  5.1, n1: 30, m2: 19.0, sd2: 3.0, n2: 28 },
      { label: "Study 4", m1: 42.0, sd1: 11.5, n1: 70, m2: 40.5, sd2: 6.2, n2: 68 },
      { label: "Study 5", m1: 22.3, sd1:  7.8, n1: 45, m2: 23.1, sd2: 4.9, n2: 43 }
    ],
    expected: {
      // yi = ln(cv1/cv2) per study, verified by formula
      yi:   [0.5638, 0.6152, 0.5573, 0.5814, 0.5001],
      FE:    0.569,
      RE:    0.569,
      tau2:  0.000,
      I2:    0.0
    },
    citation: "Synthetic dataset (profiles.js CVR exampleData). τ²=0 reflects homogeneous CVR across studies."
  },

  // ----------------------------------------------------------------
  // VR — Synthetic variability dataset (profiles.js VR exampleData, DL)
  // 5 studies with n≥28, SD ratio<4 — all soft-warning thresholds
  // satisfied.
  // yi = ln(sd1/sd2),  vi = 1/(2(n1−1)) + 1/(2(n2−1))
  // τ²=0 reflects homogeneous VR across these studies (all ≈ 0.56).
  // ----------------------------------------------------------------
  {
    name: "Synthetic Variability – VR (log SD ratio, DL)",
    type: "VR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", sd1: 4.2, n1: 40, sd2: 2.8, n2: 38 },
      { label: "Study 2", sd1: 5.5, n1: 55, sd2: 3.2, n2: 52 },
      { label: "Study 3", sd1: 3.8, n1: 30, sd2: 2.5, n2: 28 },
      { label: "Study 4", sd1: 6.1, n1: 70, sd2: 4.0, n2: 68 },
      { label: "Study 5", sd1: 4.9, n1: 45, sd2: 3.5, n2: 43 }
    ],
    expected: {
      // yi = ln(sd1/sd2) per study, verified by formula
      yi:   [0.4055, 0.5416, 0.4187, 0.4220, 0.3365],
      FE:    0.430,
      RE:    0.430,
      tau2:  0.000,
      I2:    0.0
    },
    citation: "Synthetic dataset (profiles.js VR exampleData). τ²=0 reflects homogeneous SD ratio across studies."
  },

  // ----------------------------------------------------------------
  // GOR — Synthetic 4-study 3-category ordinal dataset (DL)
  // Group 1 (treatment) skews toward higher categories;
  // Group 2 (control) skews toward lower categories.
  // yi = ln(θ/φ),  θ=P(Y1>Y2),  φ=P(Y1<Y2)  (concordance probability
  // ratio); variance via delta method (gorFromCounts in utils.js).
  // τ²=0 reflects consistent ordering effect across studies.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – GOR (generalised odds ratio, DL)",
    type: "GOR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", counts1: "15,20,35", counts2: "30,25,15" },
      { label: "Study 2", counts1: "10,25,40", counts2: "25,30,20" },
      { label: "Study 3", counts1: "20,30,30", counts2: "35,30,15" },
      { label: "Study 4", counts1: "12,18,40", counts2: "28,32,20" }
    ],
    expected: {
      // yi = ln(theta/phi) per study, verified by gorFromCounts (Python)
      yi:   [1.0316, 1.0385, 0.7985, 1.0822],
      FE:    0.981,
      RE:    0.981,
      tau2:  0.000,
      I2:    0.0
    },
    citation: "Synthetic dataset. GOR via concordance/discordance probability sums (gorFromCounts in utils.js). τ²=0 reflects homogeneous effect."
  },

  // ----------------------------------------------------------------
  // PCOR — Synthetic partial correlation dataset (DL)
  // Same 5 studies as the ZPCOR benchmark below.
  // yi = r  (raw partial correlation, not transformed)
  // vi = (1−r²)² / (n−p−1)   [Olkin & Siotani 1976 formula]
  // The denominator adjusts for p covariates beyond the COR formula
  // (which uses n−1). τ²=0: Q=3.55 < df=4, so DL floors to zero.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – PCOR (raw partial correlation, DL)",
    type: "PCOR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", r: 0.45, n:  80, p: 2 },
      { label: "Study 2", r: 0.38, n:  65, p: 2 },
      { label: "Study 3", r: 0.52, n: 110, p: 3 },
      { label: "Study 4", r: 0.31, n:  90, p: 2 },
      { label: "Study 5", r: 0.47, n: 130, p: 4 }
    ],
    expected: {
      // yi = r per study (identity transform), vi = (1−r²)²/(n−p−1)
      yi:   [0.4500, 0.3800, 0.5200, 0.3100, 0.4700],
      FE:    0.446,
      RE:    0.446,
      tau2:  0.000,
      I2:    0.0
    },
    citation: "Synthetic dataset (profiles.js PCOR exampleData). τ²=0 because Q < df for this dataset."
  },

  // ----------------------------------------------------------------
  // ZPCOR — Synthetic partial correlation dataset (Fisher z, DL)
  // Same 5 studies as the PCOR benchmark above.
  // yi = atanh(r)  (Fisher's z of the partial correlation)
  // vi = 1 / (n−p−3)   [standard partial-r to z formula]
  // Back-transform: tanh(yi) → r scale; pooled RE tanh(0.4704)=0.4385.
  // τ²=0 reflects homogeneous partial-r across studies.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – ZPCOR (Fisher-z partial correlation, DL)",
    type: "ZPCOR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", r: 0.45, n:  80, p: 2 },
      { label: "Study 2", r: 0.38, n:  65, p: 2 },
      { label: "Study 3", r: 0.52, n: 110, p: 3 },
      { label: "Study 4", r: 0.31, n:  90, p: 2 },
      { label: "Study 5", r: 0.47, n: 130, p: 4 }
    ],
    expected: {
      // yi = atanh(r) per study; vi = 1/(n−p−3)
      yi:   [0.4847, 0.4001, 0.5763, 0.3205, 0.5101],
      FE:    0.470,
      RE:    0.470,
      tau2:  0.000,
      I2:    0.0
    },
    citation: "Synthetic dataset (profiles.js ZPCOR exampleData). τ²=0 reflects homogeneous partial-r."
  },

  // ----------------------------------------------------------------
  // PCOR — Heterogeneous partial correlation dataset (REML, τ²>0)
  // Large-n studies (precise) have small r; small-n studies (imprecise)
  // have large r. This anti-correlation between precision and effect size
  // creates clear separation between FE and RE estimates (|RE−FE|=0.071).
  //
  // yi = r per study (identity transform).
  // vi = (1−r²)² / (n−p−1)
  //
  // τ²=0.097 (REML), I2=95.6%: strongly heterogeneous.
  // RE (0.467) > FE (0.396) because large RE weight assigned to the
  // imprecise small-n studies, which happen to have large r.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – PCOR heterogeneous (REML, τ²>0)",
    type: "PCOR",
    tauMethod: "REML",
    data: [
      { label: "Study 1", r: 0.10, n: 300, p: 2 },
      { label: "Study 2", r: 0.15, n: 250, p: 1 },
      { label: "Study 3", r: 0.70, n:  50, p: 3 },
      { label: "Study 4", r: 0.75, n:  40, p: 2 },
      { label: "Study 5", r: 0.65, n:  45, p: 3 },
    ],
    expected: {
      // yi = r (identity); vi = (1−r²)²/(n−p−1)
      yi:   [0.1000, 0.1500, 0.7000, 0.7500, 0.6500],
      FE:    0.396,
      RE:    0.467,
      tau2:  0.0970,
      I2:   95.6,
    },
    citation: "Synthetic. Designed to give τ²>0 with RE≠FE for PCOR. Verified via meta() (REML). Block 40 in generate.R will reproduce via metafor rma(method='REML')."
  },

  // ----------------------------------------------------------------
  // ZPCOR — Heterogeneous partial correlation dataset (REML, τ²>0)
  // Same 5 studies as the PCOR heterogeneous benchmark above.
  // yi = atanh(r); vi = 1/(n−p−3).
  //
  // The Fisher-z transformation amplifies heterogeneity relative to raw r:
  // τ²=0.162 vs 0.097, and |RE−FE|=0.294 vs 0.071.
  // Back-transform: tanh(RE) = tanh(0.5507) ≈ 0.503.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – ZPCOR heterogeneous (REML, τ²>0)",
    type: "ZPCOR",
    tauMethod: "REML",
    data: [
      { label: "Study 1", r: 0.10, n: 300, p: 2 },
      { label: "Study 2", r: 0.15, n: 250, p: 1 },
      { label: "Study 3", r: 0.70, n:  50, p: 3 },
      { label: "Study 4", r: 0.75, n:  40, p: 2 },
      { label: "Study 5", r: 0.65, n:  45, p: 3 },
    ],
    expected: {
      // yi = atanh(r); vi = 1/(n−p−3)
      yi:   [0.1003, 0.1511, 0.8673, 0.9730, 0.7753],
      FE:    0.257,
      RE:    0.551,
      tau2:  0.1624,
      I2:   92.7,
    },
    citation: "Synthetic. Same studies as PCOR heterogeneous; Fisher-z scale amplifies RE−FE separation. Verified via meta() (REML). Block 41 in generate.R will reproduce via metafor rma(method='REML')."
  },

  // ----------------------------------------------------------------
  // RTET — Synthetic tetrachoric correlation dataset (DL)
  // 4 studies with 2×2 contingency tables; all show positive latent
  // correlation between the two binary traits.
  // yi = rho_tet: bisect Φ₂(h,k;ρ) = a/N over 64 iterations.
  //   h = Φ⁻¹(p_row),  k = Φ⁻¹(p_col),  p11 = a/N
  // vi = p_row(1−p_row)·p_col(1−p_col) / (N·φ₂(h,k;ρ)²)
  //   φ₂ = bivariate normal density at (h,k;ρ)  (delta method)
  // Spot-check: rho(40,10,10,40) = sin(0.3π) ≈ 0.8090 exactly.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – RTET (tetrachoric correlation, DL)",
    type: "RTET",
    tauMethod: "DL",
    data: [
      { label: "Study 1", a: 40, b: 10, c: 10, d: 40 },
      { label: "Study 2", a: 30, b: 15, c: 12, d: 43 },
      { label: "Study 3", a: 25, b:  8, c:  9, d: 38 },
      { label: "Study 4", a: 35, b: 12, c: 11, d: 42 }
    ],
    expected: {
      // yi = rho_tet per study, verified by bisection + analytic spot-check
      yi:   [0.8090, 0.6545, 0.7765, 0.7485],
      FE:    0.756,
      RE:    0.756,
      tau2:  0.000,
      I2:    0.0
    },
    citation: "Synthetic dataset (profiles.js RTET exampleData). Bisection via bivariateNormalCDF (utils.js). τ²=0 reflects consistent latent correlation."
  },

  // ----------------------------------------------------------------
  // CI method benchmarks — Phase 5
  // All three use the same 5-study synthetic log-RR dataset.
  // FE/RE/tau2/I2 are identical to the DL normal-CI result; only
  // ciLow/ciHigh change with the CI method.
  // ----------------------------------------------------------------

  // ----------------------------------------------------------------
  // KH — Knapp-Hartung adjusted CI (DL tau², t_{k-1} critical value,
  // seRE² = Σ wᵢ(yᵢ−RE)² / ((k−1)·W))
  // ----------------------------------------------------------------
  {
    name: "Synthetic – log-RR ciMethod=KH (DL)",
    type: "RR",
    tauMethod: "DL",
    ciMethod: "KH",
    data: [
      { label: "Study 1", a: 15, b: 85, c: 30, d: 70 },
      { label: "Study 2", a: 20, b: 80, c: 25, d: 75 },
      { label: "Study 3", a: 10, b: 90, c: 35, d: 65 },
      { label: "Study 4", a: 25, b: 75, c: 20, d: 80 },
      { label: "Study 5", a: 12, b: 88, c: 28, d: 72 }
    ],
    expected: {
      yi:    [-0.6931, -0.2231, -1.2528, 0.2231, -0.8473],
      FE:    -0.476,
      RE:    -0.536,
      tau2:   0.239,
      I2:    74.1,
      ciLow:  -1.245,
      ciHigh:  0.172
    },
    citation: "Synthetic 5-study log-RR dataset. KH: seRE² = Σwᵢ(yᵢ−RE)²/((k−1)·W), crit = t_{4,0.975} = 2.776."
  },

  // ----------------------------------------------------------------
  // t — t-distribution CI without KH variance adjustment
  // (same seRE as normal/Wald, but crit = t_{k-1,0.975})
  // ----------------------------------------------------------------
  {
    name: "Synthetic – log-RR ciMethod=t (DL)",
    type: "RR",
    tauMethod: "DL",
    ciMethod: "t",
    data: [
      { label: "Study 1", a: 15, b: 85, c: 30, d: 70 },
      { label: "Study 2", a: 20, b: 80, c: 25, d: 75 },
      { label: "Study 3", a: 10, b: 90, c: 35, d: 65 },
      { label: "Study 4", a: 25, b: 75, c: 20, d: 80 },
      { label: "Study 5", a: 12, b: 88, c: 28, d: 72 }
    ],
    expected: {
      yi:    [-0.6931, -0.2231, -1.2528, 0.2231, -0.8473],
      FE:    -0.476,
      RE:    -0.536,
      tau2:   0.239,
      I2:    74.1,
      ciLow:  -1.242,
      ciHigh:  0.170
    },
    citation: "Synthetic 5-study log-RR dataset. t CI: seRE = √(1/W), crit = t_{4,0.975} = 2.776 (no KH variance inflation)."
  },

  // ----------------------------------------------------------------
  // PL — Profile-likelihood CI (REML point estimate; CI bounds invert
  // the profile log-likelihood using ML internally)
  // ----------------------------------------------------------------
  {
    name: "Synthetic – log-RR ciMethod=PL (REML)",
    type: "RR",
    tauMethod: "REML",
    ciMethod: "PL",
    data: [
      { label: "Study 1", a: 15, b: 85, c: 30, d: 70 },
      { label: "Study 2", a: 20, b: 80, c: 25, d: 75 },
      { label: "Study 3", a: 10, b: 90, c: 35, d: 65 },
      { label: "Study 4", a: 25, b: 75, c: 20, d: 80 },
      { label: "Study 5", a: 12, b: 88, c: 28, d: 72 }
    ],
    expected: {
      yi:    [-0.6931, -0.2231, -1.2528, 0.2231, -0.8473],
      FE:    -0.476,
      RE:    -0.537,
      tau2:   0.241,
      I2:    74.1,
      ciLow:  -1.095,
      ciHigh:  0.003
    },
    citation: "Synthetic 5-study log-RR dataset. PL CI: bounds from profile log-likelihood inversion (ML internally, cutoff = χ²_{1,0.95}/2 = 1.921)."
  }

];

// ----------------------------------------------------------------
// Publication bias + trim-and-fill benchmarks
// Each entry has a `tests` object with named sub-objects per function.
// Expected values derived in _derive_pubias.py and verified below.
// ----------------------------------------------------------------
export const PUB_BIAS_BENCHMARKS = [

  // ----------------------------------------------------------------
  // BCG Vaccine — publication bias (log OR, 13 studies)
  // Source: Colditz et al. (1994). dat.bcg in metafor.
  // Same 13 2×2 tables as the OR benchmarks above.
  // Expected values derived analytically in _derive_pubias.py:
  //   Begg:     τ_b = −0.128, S = −10, z = −0.549, p = 0.583
  //   Egger:    intercept = −2.345 (bias), slope = −0.157, p = 0.160
  //   FAT-PET:  intercept = −0.157 (PET), slope = −2.345 (FAT), interceptP = 0.521, slopeP = 0.160
  //   Rosenthal fail-safe N ≈ 656, Orwin ≈ 44
  //   Harbord:  intercept = −2.093, interceptP = 0.235
  //   Peters:   intercept = −0.357, interceptP = 0.045
  //   TrimFill (L₀, DL): k0 = 10, adjustedRE = 0.025
  // ----------------------------------------------------------------
  {
    name: "BCG Vaccine – pub bias (log OR, DL, 13 studies)",
    type: "OR",
    tauMethod: "DL",
    data: [
      { label: "Aronson 1948",            a:   4, b:   119, c:  11, d:   128 },
      { label: "Ferguson & Simes 1949",   a:   6, b:   300, c:  29, d:   274 },
      { label: "Rosenthal 1960",          a:   3, b:   228, c:  11, d:   209 },
      { label: "Hart & Sutherland 1977",  a:  62, b: 13536, c: 248, d: 12619 },
      { label: "Frimodt-Moller 1973",     a:  33, b:  5036, c:  47, d:  5761 },
      { label: "Stein & Aronson 1953",    a: 180, b:  1361, c: 372, d:  1079 },
      { label: "Vandiviere 1973",         a:   8, b:  2537, c:  10, d:   619 },
      { label: "TPT Madras 1980",         a: 505, b: 87886, c: 499, d: 87892 },
      { label: "Coetzee & Berjak 1968",   a:  29, b:  7470, c:  45, d:  7232 },
      { label: "Rosenthal 1961",          a:  17, b:  1699, c:  65, d:  1600 },
      { label: "Comstock 1974",           a: 186, b: 50448, c: 141, d: 27197 },
      { label: "Comstock & Webster 1969", a:   5, b:  2493, c:   3, d:  2338 },
      { label: "Comstock 1976",           a:  27, b: 16886, c:  29, d: 17825 }
    ],
    tests: {
      begg:     { tau: -0.128, S: -10, z: -0.549, p: 0.583 },
      egger:    { intercept: -2.345, slope: -0.157, p: 0.160 },
      fatPet:   { intercept: -0.157, interceptP: 0.521, slope: -2.345, slopeP: 0.160 },
      failSafe: { rosenthal: 656, orwin: 44 },
      harbord:  { intercept: -2.093, interceptP: 0.235 },
      peters:   { intercept: -0.357, interceptP: 0.045 },
      trimFill: { k0: 10, adjustedRE: 0.025 }
    },
    citation: "Colditz et al. (1994) JAMA 271:698–702. dat.bcg in metafor. Expected values derived analytically (_derive_pubias.py)."
  },

  // ----------------------------------------------------------------
  // Synthetic asymmetric funnel (k=6, clearly significant Egger test)
  // Designed to show a publication-bias pattern: small studies (large SE)
  // have disproportionately large effects.  Data are on a log scale
  // (e.g. log OR) so negative yi is also plausible.
  //
  // yi  = [-0.1,  0.3,  0.1,  0.9,  1.4,  0.5]
  // se  = [ 0.2,  0.3, 0.15,  0.6,  0.8,  0.4]
  //
  // Egger: intercept=1.917, slope=-0.286, se=0.504, t=3.804, df=4, p=0.019
  // Verified by running eggerTest() directly; see benchmark-data.md
  // "Synthetic asymmetric funnel" section.
  // ----------------------------------------------------------------
  {
    name: "Synthetic asymmetric funnel (k=6)",
    type: "GENERIC",
    data: [
      { label: "S1", yi: -0.1, vi: 0.0400 },
      { label: "S2", yi:  0.3, vi: 0.0900 },
      { label: "S3", yi:  0.1, vi: 0.0225 },
      { label: "S4", yi:  0.9, vi: 0.3600 },
      { label: "S5", yi:  1.4, vi: 0.6400 },
      { label: "S6", yi:  0.5, vi: 0.1600 },
    ],
    tests: {
      egger: { intercept: 1.917, slope: -0.286, se: 0.504, t: 3.804, df: 4, p: 0.019 },
    },
    citation: "Synthetic. Designed to produce a clearly significant Egger test (p=0.019). Verified against eggerTest() to floating-point precision."
  }

];

// ----------------------------------------------------------------
// Influence / LOO benchmarks (Phase 7)
// Each entry's `expected` is a k-length array of per-study objects
// matching the fields returned by influenceDiagnostics().
// Expected values derived in _derive_influence.py (DL tau method).
// ----------------------------------------------------------------
export const INFLUENCE_BENCHMARKS = [

  // ----------------------------------------------------------------
  // 5-study synthetic log-RR dataset (same data as benchmarks 35–37)
  // Full DL meta: RE=−0.536, tau2=0.239, I2=74.1%
  // No study clears any flag threshold on this dataset:
  //   highLeverage > 0.40, highCookD > 0.80, |stdResidual| > 2, |DFBETA| > 1
  // Study 4 (the sole positive effect) has the largest Cook's D (0.551)
  // and DFBETA (0.880), nearest to but below the influential threshold.
  // ----------------------------------------------------------------
  {
    name: "Synthetic – log-RR influence diagnostics (DL)",
    type: "RR",
    tauMethod: "DL",
    data: [
      { label: "Study 1", a: 15, b: 85, c: 30, d: 70 },
      { label: "Study 2", a: 20, b: 80, c: 25, d: 75 },
      { label: "Study 3", a: 10, b: 90, c: 35, d: 65 },
      { label: "Study 4", a: 25, b: 75, c: 20, d: 80 },
      { label: "Study 5", a: 12, b: 88, c: 28, d: 72 }
    ],
    expected: [
      {
        label:       "Study 1",
        RE_loo:      -0.5027,
        tau2_loo:     0.3298,
        hat:          0.2030,
        cookD:        0.0176,
        stdResidual: -0.2778,
        DFBETA:      -0.1045,
        deltaTau2:   -0.0913,
        outlier:      false,
        influential:  false,
        highLeverage: false,
        highCookD:    false
      },
      {
        label:       "Study 2",
        RE_loo:      -0.6244,
        tau2_loo:     0.3283,
        hat:          0.2096,
        cookD:        0.1199,
        stdResidual:  0.5639,
        DFBETA:       0.2727,
        deltaTau2:   -0.0898,
        outlier:      false,
        influential:  false,
        highLeverage: false,
        highCookD:    false
      },
      {
        label:       "Study 3",
        RE_loo:      -0.3679,
        tau2_loo:     0.1542,
        hat:          0.1863,
        cookD:        0.4390,
        stdResidual: -1.2159,
        DFBETA:      -0.6975,
        deltaTau2:    0.0843,
        outlier:      false,
        influential:  false,
        highLeverage: false,
        highCookD:    false
      },
      {
        label:       "Study 4",
        RE_loo:      -0.7251,
        tau2_loo:     0.0958,
        hat:          0.2096,
        cookD:        0.5507,
        stdResidual:  1.3674,
        DFBETA:       0.8799,
        deltaTau2:    0.1427,
        outlier:      false,
        influential:  false,
        highLeverage: false,
        highCookD:    false
      },
      {
        label:       "Study 5",
        RE_loo:      -0.4658,
        tau2_loo:     0.2881,
        hat:          0.1915,
        cookD:        0.0770,
        stdResidual: -0.5351,
        DFBETA:      -0.2322,
        deltaTau2:   -0.0496,
        outlier:      false,
        influential:  false,
        highLeverage: false,
        highCookD:    false
      }
    ],
    citation: "Synthetic 5-study log-RR dataset (same as benchmarks 35–37). Expected values derived analytically (_derive_influence.py)."
  }

];
