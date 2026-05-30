// Export-parity fixture: RVE pooled estimate + three-level model.
// Dataset: synthetic 3-cluster × 2-study (CLUSTER_BENCHMARKS CL-1 / RVE_BENCHMARKS RVE-1).
// Type GENERIC: pre-computed yi/vi; transform = identity.
// rveResult.est ≈ 0.331 (ρ = 0.80, CORR mode); threeLevelResult.mu is self-validated.
// Catches: rveData or threeLevelData row removed → formatted value absent from HTML.

export default {
  name: 'RVE + three-level — 3-cluster 6-study (REML, ρ = 0.80)',

  rawData: [
    { label: 'C1-S1', yi: 0.10, vi: 0.04, cluster: '1' },
    { label: 'C1-S2', yi: 0.30, vi: 0.05, cluster: '1' },
    { label: 'C2-S1', yi: 0.50, vi: 0.03, cluster: '2' },
    { label: 'C2-S2', yi: 0.70, vi: 0.06, cluster: '2' },
    { label: 'C3-S1', yi: 0.20, vi: 0.04, cluster: '3' },
    { label: 'C3-S2', yi: 0.80, vi: 0.05, cluster: '3' },
  ],

  type: 'GENERIC',

  opts: {
    method: 'REML', ciMethod: 'normal', alpha: 0.05,
    useTF: false, tfEstimator: 'L0', useTFAdjusted: false,
    isMHorPeto: false, hasClusters: true,
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
    { section: 'rve',        path: 'rveResult.est',      label: 'RVE pooled estimate'     },
    { section: 'threeLevel', path: 'threeLevelResult.mu', label: '3-level pooled estimate' },
  ],
};
