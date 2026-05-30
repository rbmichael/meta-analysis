// Leaf module — no imports.
// Human-readable labels for help-button aria-labels.
// Keys match data-help values used in static HTML and hBtn() calls in
// ui.js and ui-render.js.  Both import from here; do not duplicate.
export const HELP_LABELS = {
  // Input panel
  "input.csv":             "CSV import and export",
  "input.session":         "Session save and load",
  "input.moderators":      "Moderators",
  "input.interactions":    "Interaction terms",
  "input.scaleModerators": "Location-scale model moderators",
  "input.rob":             "Risk of bias",
  "cluster.id":            "Cluster ID",
  "keyboard.shortcuts":    "Keyboard shortcuts",
  // Settings
  "ci.width":              "Confidence interval width",
  "reg.mcc":               "Multiple comparison correction",
  "bias.trimfill":         "Trim-and-fill",
  "bayes.model":           "Bayesian meta-analysis model",
  "bayes.tau":             "Bayesian τ posterior",
  "sel.model":             "Selection model",
  // Effect / method selects (data-help-select prefixes resolve here)
  "effect":                "Effect type",
  "tau":                   "τ² estimator",
  "ci":                    "CI method",
  "cumorder":              "Cumulative order",
  // Plots
  "plot.forest":           "Forest plot",
  "plot.funnel":           "Funnel plot",
  "plot.cumulative":       "Cumulative analysis",
  "plot.orchard":          "Orchard plot",
  "plot.caterpillar":      "Caterpillar plot",
  "plot.rob":              "Risk-of-bias plot",
  // Diagnostics
  "diag.profileLik":       "Profile likelihood",
  "diag.influence":        "Influence diagnostics",
  "diag.blup":             "BLUPs (shrunken estimates)",
  "diag.baujat":           "Baujat plot",
  "diag.qqplot":           "Normal Q-Q plot",
  "diag.radial":           "Radial (Galbraith) plot",
  "diag.labbe":            "L'Abbé plot",
  "diag.gosh":             "GOSH plot",
  "diag.locationscale":    "Location-scale model",
  "diag.metaregression":   "Meta-regression",
  "diag.dffits":           "DFFITS influence statistic",
  "diag.covratio":         "CovRatio influence statistic",
  "diag.subgroup":         "Subgroup analysis",
  // Heterogeneity
  "het.Q":                 "Q heterogeneity statistic",
  "het.I2":                "I² heterogeneity",
  "het.H2":                "H² heterogeneity",
  "het.tau2":              "τ² between-study variance",
  // Models
  "rve.model":             "Robust variance estimation",
  "cluster.robust":        "Robust confidence interval",
  "threelevel.model":      "Three-level model",
  "threelevel.tau2":       "Three-level variance components",
  "threelevel.I2":         "Three-level I²",
  "pool.cles":             "Common language effect size",
  // Publication bias
  "bias.pcurve":           "P-curve",
  "bias.puniform":         "P-uniform",
  "bayes.sensitivity":     "Bayesian prior sensitivity",
  // Regression
  "mreg.lrt":              "Likelihood ratio test",
  "reg.aic":               "Model fit statistics (AIC/BIC/LL)",
  "sens.loo":              "Leave-one-out analysis",
  "sens.estimator":        "Estimator comparison",
  // Selection models (used by ui-render.js hBtn)
  "sel.halfnorm":          "Half-normal selection model",
  "sel.power":             "Power selection model",
  "sel.negexp":            "Negative exponential selection model",
  "sel.beta":              "Beta selection model",
};
