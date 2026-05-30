// Export-parity fixture: SMD (Hedges' g), REML, Knapp-Hartung CI
// Dataset: Normand (1999) 4-study subset — same as fixture_smd_reml_normal.
// KH CI changes the CI width but not point estimates (RE, seRE, tau2, Q identical).

export default {
  name: 'SMD REML KH CI — Normand 1999',

  rawData: [
    { label: 'Edinburgh',          n1: 155, m1:  55, sd1: 47, n2: 156, m2:  75, sd2: 64 },
    { label: 'Orpington-Mild',     n1:  31, m1:  27, sd1:  7, n2:  32, m2:  29, sd2:  4 },
    { label: 'Orpington-Moderate', n1:  75, m1:  64, sd1: 17, n2:  71, m2: 119, sd2: 29 },
    { label: 'Orpington-Severe',   n1:  18, m1:  66, sd1: 20, n2:  18, m2: 137, sd2: 48 },
  ],

  type: 'SMD',

  opts: {
    method: 'REML', ciMethod: 'KH', alpha: 0.05,
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
    { section: 'summary', path: 'm.RE',   label: 'RE estimate' },
    { section: 'summary', path: 'm.seRE', label: 'RE SE'       },
    { section: 'summary', path: 'm.tau2', label: 'tau²'        },
    { section: 'summary', path: 'm.Q',    label: 'Q statistic' },
  ],
};
