// Export-parity fixture: multivariate MA (MV pipeline) with Berkey 1998 periodontal data.
// Dataset: Berkey et al. (1998) Stat Med 17:2537 — 5 studies × 2 outcomes (PD, AL).
// Ground truth: R rma.mv(yi~outcome-1, V, struct="CS", rho=0.5, method="REML");
//   beta ≈ [0.3005, −0.0837], tau2 ≈ 0.0210, QE ≈ 45.427.
// Mode 'mv': runner uses vcalc() + mvMeta() instead of runAnalysisHeadless().
// Catches: mvPooledData or mvTestsData removed → formatted values absent in HTML/DOCX.

export default {
  name: 'Multivariate MA — Berkey98 (CS, REML, rho=0.5)',
  mode: 'mv',

  rawData: [
    { yi:  0.470,  vi: 0.0275, study_id: 1, outcome_id: 'PD' },
    { yi: -0.320,  vi: 0.0135, study_id: 1, outcome_id: 'AL' },
    { yi:  0.397,  vi: 0.0162, study_id: 2, outcome_id: 'PD' },
    { yi: -0.240,  vi: 0.0119, study_id: 2, outcome_id: 'AL' },
    { yi:  0.133,  vi: 0.0033, study_id: 3, outcome_id: 'PD' },
    { yi: -0.050,  vi: 0.0040, study_id: 3, outcome_id: 'AL' },
    { yi:  0.165,  vi: 0.0030, study_id: 4, outcome_id: 'PD' },
    { yi:  0.068,  vi: 0.0015, study_id: 4, outcome_id: 'AL' },
    { yi:  0.349,  vi: 0.0051, study_id: 5, outcome_id: 'PD' },
    { yi:  0.016,  vi: 0.0019, study_id: 5, outcome_id: 'AL' },
  ],

  mvOpts: { struct: 'CS', method: 'REML', rho: 0.5 },

  // d:4 because mvPooledData formats beta/se at 4 decimal places.
  // d:3 for QE because mvTestsData formats QE at 3 decimal places.
  expected: [
    { section: 'mvPooled', path: 'beta.0', label: 'PD pooled beta',  d: 4 },
    { section: 'mvPooled', path: 'beta.1', label: 'AL pooled beta',  d: 4 },
    { section: 'mvTests',  path: 'QE',     label: 'QE residual',     d: 3 },
  ],
};
