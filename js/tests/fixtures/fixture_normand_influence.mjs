// Export-parity fixture: influence diagnostics (leave-one-out RE and standardised residual).
// Dataset: Normand (1999) 4-study SMD REML — same as fixture_smd_reml_normal.
// influence[0] = Edinburgh study (first in input order).
// Both RE_loo and stdResidual appear in influenceData rows formatted with fmt().
// Catches: influenceData row column removed → formatted value absent from HTML.

export default {
  name: 'Influence diagnostics — Normand 1999 SMD REML',

  rawData: [
    { label: 'Edinburgh',          n1: 155, m1:  55, sd1: 47, n2: 156, m2:  75, sd2: 64 },
    { label: 'Orpington-Mild',     n1:  31, m1:  27, sd1:  7, n2:  32, m2:  29, sd2:  4 },
    { label: 'Orpington-Moderate', n1:  75, m1:  64, sd1: 17, n2:  71, m2: 119, sd2: 29 },
    { label: 'Orpington-Severe',   n1:  18, m1:  66, sd1: 20, n2:  18, m2: 137, sd2: 48 },
  ],

  type: 'SMD',

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

  // Numeric array indices work: path "influence.0.RE_loo" resolves via
  // array["0"] === array[0] in JavaScript.
  expected: [
    { section: 'influence', path: 'influence.0.RE_loo',      label: 'LOO RE (Edinburgh)'        },
    { section: 'influence', path: 'influence.0.stdResidual',  label: 'Std. residual (Edinburgh)' },
  ],
};
