// Export-parity fixture: Vevea-Hedges step-function selection model (MLE mode).
// Dataset: BCG 13 studies — same as VH_BENCHMARKS VH-A (two-sided, 5 steps).
// Type GENERIC: pre-computed log-ORs; transform = identity so selResult.mu appears verbatim.
// selResult.tau2 and selResult.LRT appear in selModelData rows without transform.
// Catches: selModelData "Adjusted τ²" or LRT row removed → formatted value absent.

export default {
  name: 'VH selection model — BCG (GENERIC, 2-sided, 5 steps)',

  rawData: [
    { label: 'Aronson 1948',            yi: -0.8893113339202054,  vi: 0.3255847650039614   },
    { label: 'Ferguson & Simes 1949',   yi: -1.5853886572014306,  vi: 0.19458112139814387  },
    { label: 'Rosenthal 1960',          yi: -1.348073148299693,   vi: 0.41536796536796533  },
    { label: 'Hart & Sutherland 1977',  yi: -1.4415511900213054,  vi: 0.020010031902247573 },
    { label: 'Frimodt-Moller 1973',     yi: -0.2175473222112957,  vi: 0.05121017216963086  },
    { label: 'Stein & Aronson 1953',    yi: -0.786115585818864,   vi: 0.0069056184559087574},
    { label: 'Vandiviere 1973',         yi: -1.6208982235983924,  vi: 0.22301724757231517  },
    { label: 'TPT Madras 1980',         yi:  0.011952333523841173, vi: 0.00396157929781773 },
    { label: 'Coetzee & Berjak 1968',   yi: -0.4694176487381487,  vi: 0.056434210463248966 },
    { label: 'Rosenthal 1961',          yi: -1.3713448034727846,  vi: 0.07302479361302891  },
    { label: 'Comstock 1974',           yi: -0.33935882833839015, vi: 0.01241221397155972  },
    { label: 'Comstock & Webster 1969', yi:  0.4459134005713783,  vi: 0.5325058452001528   },
    { label: 'Comstock 1976',           yi: -0.017313948216879493, vi: 0.0714046596839863  },
  ],

  type: 'GENERIC',

  opts: {
    method: 'REML', ciMethod: 'normal', alpha: 0.05,
    useTF: false, tfEstimator: 'L0', useTFAdjusted: false,
    isMHorPeto: false, hasClusters: false,
    rveRho: 0.8, rveMode: 'corr', threeLevelMethod: 'REML',
    modSpec: [], scaleModSpec: [], interactionSpec: [],
    cumulativeOrder: 'input',
    selModeVal: 'mle', selPreset: 'b5', selWeightFn: 'vevea-hedges', selSides: 2,
    selCuts: [0.025, 0.10, 0.25, 0.50, 1.0],
    bayesMu0: 0, bayesSigmaMu: 1, bayesSigmaTau: 0.5,
    fsnTrivial: 0.1, fsnDirection: 'auto',
  },

  reportSettings: { ciLevel: '95' },

  // selResult.tau2 → "Adjusted τ²" row; selResult.LRT → LRT row.
  // Both formatted with fmtV() = fmt() (no transform) in selModelData.
  expected: [
    { section: 'selModel', path: 'selResult.tau2', label: 'VH adjusted tau²' },
    { section: 'selModel', path: 'selResult.LRT',  label: 'VH LRT'           },
  ],
};
