// Export-parity fixture: Bayesian meta-analysis.
// Dataset: BCG 13 studies (GENERIC, pre-computed log-ORs; transform = identity).
// Priors: μ ~ N(0, 1²), τ ~ HalfNormal(0.5).
// bayesResult.muMean and bayesResult.tauMean appear verbatim in bayesData rows.
// Catches: bayesData "Posterior mean μ" or "Posterior mean τ" row removed → absent.

export default {
  name: 'Bayesian MA — BCG 13 studies (GENERIC, REML)',

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
    selCuts: [0.025, 0.05, 1.0],
    bayesMu0: 0, bayesSigmaMu: 1, bayesSigmaTau: 0.5,
    fsnTrivial: 0.1, fsnDirection: 'auto',
  },

  reportSettings: { ciLevel: '95' },

  expected: [
    { section: 'bayes', path: 'bayesResult.muMean',  label: 'Bayes posterior mean μ' },
    { section: 'bayes', path: 'bayesResult.tauMean', label: 'Bayes posterior mean τ' },
  ],
};
