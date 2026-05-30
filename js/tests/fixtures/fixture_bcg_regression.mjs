// Export-parity fixture: meta-regression with two continuous moderators (year, ablat).
// Dataset: Colditz et al. (1994) BCG vaccine, 13 studies — same as META_REGRESSION_BENCHMARKS MR-A.
// Ground truth: R rma(yi~year+ablat, vi, method="REML"); QM ≈ 12.205, QE ≈ 28.325, tau2 ≈ 0.111.
// Type GENERIC: yi/vi are pre-computed log-ORs; transform = identity.
// Catches: regressionData coef section missing QM/QE from note → fields absent in HTML.

export default {
  name: 'Meta-regression — BCG year + ablat (REML, normal CI)',

  rawData: [
    { label: 'Aronson 1948',            yi: -0.8893113339202054, vi: 0.3255847650039614,   year: 1948, ablat: 44 },
    { label: 'Ferguson & Simes 1949',   yi: -1.5853886572014306, vi: 0.19458112139814387,  year: 1949, ablat: 55 },
    { label: 'Rosenthal 1960',          yi: -1.348073148299693,  vi: 0.41536796536796533,  year: 1960, ablat: 42 },
    { label: 'Hart & Sutherland 1977',  yi: -1.4415511900213054, vi: 0.020010031902247573, year: 1977, ablat: 52 },
    { label: 'Frimodt-Moller 1973',     yi: -0.2175473222112957, vi: 0.05121017216963086,  year: 1973, ablat: 13 },
    { label: 'Stein & Aronson 1953',    yi: -0.786115585818864,  vi: 0.0069056184559087574,year: 1953, ablat: 44 },
    { label: 'Vandiviere 1973',         yi: -1.6208982235983924, vi: 0.22301724757231517,  year: 1973, ablat: 19 },
    { label: 'TPT Madras 1980',         yi:  0.011952333523841173,vi: 0.00396157929781773, year: 1980, ablat: 13 },
    { label: 'Coetzee & Berjak 1968',   yi: -0.4694176487381487, vi: 0.056434210463248966, year: 1968, ablat: 27 },
    { label: 'Rosenthal 1961',          yi: -1.3713448034727846, vi: 0.07302479361302891,  year: 1961, ablat: 42 },
    { label: 'Comstock 1974',           yi: -0.33935882833839015,vi: 0.01241221397155972,  year: 1974, ablat: 18 },
    { label: 'Comstock & Webster 1969', yi:  0.4459134005713783, vi: 0.5325058452001528,   year: 1969, ablat: 33 },
    { label: 'Comstock 1976',           yi: -0.017313948216879493,vi: 0.0714046596839863,  year: 1976, ablat: 33 },
  ],

  type: 'GENERIC',

  opts: {
    method: 'REML', ciMethod: 'normal', alpha: 0.05,
    useTF: false, tfEstimator: 'L0', useTFAdjusted: false,
    isMHorPeto: false, hasClusters: false,
    rveRho: 0.8, rveMode: 'corr', threeLevelMethod: 'REML',
    modSpec: [
      { key: 'year',  type: 'continuous' },
      { key: 'ablat', type: 'continuous' },
    ],
    scaleModSpec: [], interactionSpec: [],
    cumulativeOrder: 'input',
    selModeVal: 'mle', selPreset: 'b5', selWeightFn: 'vevea-hedges', selSides: 2,
    selCuts: [0.025, 0.05, 1.0],
    bayesMu0: 0, bayesSigmaMu: 1, bayesSigmaTau: 0.5,
    fsnTrivial: 0.1, fsnDirection: 'auto',
  },

  reportSettings: { ciLevel: '95' },

  // reg.QM and reg.QE appear in the coef table note (built by regressionData).
  // Catching: regressionData coef.note missing QM/QE → test fails.
  expected: [
    { section: 'regression', path: 'reg.QM', label: 'Omnibus QM'   },
    { section: 'regression', path: 'reg.QE', label: 'Residual QE'  },
  ],
};
