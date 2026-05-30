// Export-parity fixture: SMD (Hedges' g), REML, normal CI
// Dataset: Normand (1999) 4-study subset — same as BENCHMARKS entry "Normand 1999 – SMD Hedges' g"
// Ground truth: metafor rma(yi, vi, method="REML") — RE ≈ −1.207, τ² ≈ 1.009, I² ≈ 95.6%

export default {
  name: 'SMD REML normal CI — Normand 1999',

  // Raw study inputs — processed by computeStudies(rawData, type) in the runner.
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

  // Extra display settings normally read from DOM at report-assembly time.
  reportSettings: { ciLevel: '95' },

  // Fields that must appear (formatted with fmt()) in the HTML table produced
  // by the corresponding sections.js data function + buildTableAPA().
  // 'section' selects the sections.js function: 'summary' | 'pubBias'
  // 'path'    is a dotted key path into the headless result object r.
  // The runner formats the actual computed value with fmt() and checks that
  // the formatted string appears somewhere in the HTML table string.
  // Catching: a field removed from sections.js rows → formatted value absent.
  expected: [
    // ── Summary table (sections.summaryData) ────────────────────────────────
    { section: 'summary', path: 'm.RE',   label: 'RE estimate'  },
    { section: 'summary', path: 'm.seRE', label: 'RE SE'        },
    { section: 'summary', path: 'm.FE',   label: 'FE estimate'  },
    { section: 'summary', path: 'm.tau2', label: 'tau²'         },
    { section: 'summary', path: 'm.I2',   label: 'I²'           },
    { section: 'summary', path: 'm.Q',    label: 'Q statistic'  },
    // ── Publication-bias table (sections.pubBiasData) ───────────────────────
    { section: 'pubBias', path: 'egger.intercept', label: 'Egger intercept' },
    { section: 'pubBias', path: 'hc.beta',         label: 'HC estimate'    },
    { section: 'pubBias', path: 'waap.estimate',   label: 'WAAP estimate'  },
  ],
};
