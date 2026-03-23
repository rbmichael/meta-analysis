// ================= HELP CONTENT =================
// Keyed plain-text descriptions used by the help popover.
// Each entry: { title, body }
// Keys must match the data-help attributes in index.html and the
// inline icons injected by ui.js.

export const HELP = {

  // ------------------------------------------------------------------ //
  // Effect types                                                         //
  // ------------------------------------------------------------------ //

  "effect.MD": {
    title: "Mean Difference (MD)",
    body:  "The raw arithmetic difference between two group means (μ₁ − μ₂). " +
           "Preserves the original measurement scale, so studies must share the " +
           "same unit. Use when all studies report the outcome on an identical scale.",
  },

  "effect.SMD": {
    title: "Standardized Mean Difference — Hedges' g",
    body:  "The mean difference divided by a pooled standard deviation, with " +
           "Hedges' small-sample correction (J factor) applied. " +
           "Use when studies measure the same construct on different scales or " +
           "instruments. Values of 0.2, 0.5, and 0.8 are conventionally labelled " +
           "small, medium, and large.",
  },

  "effect.MD_paired": {
    title: "Mean Difference — Paired (MD paired)",
    body:  "Raw mean difference for pre/post or matched-pairs designs. " +
           "Requires the pre-post correlation r to compute the correct within-person " +
           "variance. Using the independent-groups formula when data are paired " +
           "over-estimates the standard error.",
  },

  "effect.SMD_paired": {
    title: "Standardized Mean Change (SMD paired)",
    body:  "The paired mean difference standardised by the pre-measurement SD, " +
           "with correction for the pre-post correlation. " +
           "Suitable for pooling pre/post studies that use different outcome scales.",
  },

  "effect.OR": {
    title: "Odds Ratio (OR)",
    body:  "Ratio of the odds of an event in the treatment group to the odds in " +
           "the control group, computed from a 2×2 table (a, b, c, d). " +
           "Analysed on the log scale internally; back-transformed for display. " +
           "OR overestimates the relative risk when event rates are common (>10%).",
  },

  "effect.RR": {
    title: "Risk Ratio / Relative Risk (RR)",
    body:  "Ratio of event proportions between groups, computed from a 2×2 table. " +
           "More directly interpretable than OR but can only be estimated from " +
           "prospective or experimental studies. Analysed on the log scale.",
  },

  "effect.RD": {
    title: "Risk Difference (RD)",
    body:  "Absolute difference in event proportions (p₁ − p₂) from a 2×2 table. " +
           "Clinically interpretable: the number needed to treat is 1 / |RD|. " +
           "Tends to show greater heterogeneity than ratio measures and can be " +
           "bounded by the baseline risk.",
  },

  "effect.HR": {
    title: "Hazard Ratio (HR)",
    body:  "Ratio of instantaneous event rates between groups, typically from a " +
           "Cox proportional-hazards model. Requires the log HR and its 95% CI " +
           "directly (hr, ci_lo, ci_hi) — no 2×2 table. Analysed on the log scale.",
  },

  "effect.IRR": {
    title: "Incidence Rate Ratio (IRR)",
    body:  "Ratio of event counts per unit of person-time between two groups. " +
           "Requires event counts (x1, x2) and person-time denominators (t1, t2). " +
           "Analysed on the log scale. Assumes events follow a Poisson process.",
  },

  "effect.IR": {
    title: "Incidence Rate — log (IR)",
    body:  "Single-group incidence rate modelled on the log scale. " +
           "Requires an event count (x) and person-time denominator (t). " +
           "Use for single-arm studies or prevalence estimates expressed as rates.",
  },

  "effect.COR": {
    title: "Correlation — raw r (COR)",
    body:  "Pearson r pooled directly on the untransformed scale. " +
           "Not generally recommended because r is bounded (−1 to 1) and its " +
           "sampling variance depends on the true ρ, making standard weighting " +
           "suboptimal. Prefer Fisher's z (ZCOR) unless r values are all small.",
  },

  "effect.ZCOR": {
    title: "Correlation — Fisher's z (ZCOR)",
    body:  "Pearson r after Fisher's r-to-z transformation: z = 0.5 ln[(1+r)/(1−r)]. " +
           "The variance is approximately 1/(n−3), independent of the true ρ. " +
           "This is the preferred approach for pooling correlations. " +
           "Results are back-transformed to r for display.",
  },

  "effect.PR": {
    title: "Proportion — raw (PR)",
    body:  "Single-group event proportion pooled on the untransformed (0–1) scale. " +
           "Simple to interpret but the variance depends on the true proportion, " +
           "which causes problems near 0 or 1. Consider a transformation (PLO, PFT) " +
           "for sparse data.",
  },

  "effect.PLN": {
    title: "Proportion — log (PLN)",
    body:  "Proportion pooled after log transformation. Stabilises variance for " +
           "rare events but is undefined when p = 0. Back-transformed for display.",
  },

  "effect.PLO": {
    title: "Proportion — logit (PLO)",
    body:  "Proportion pooled on the logit (log-odds) scale: log[p/(1−p)]. " +
           "The most widely used transformation; back-transforms to a probability. " +
           "Undefined at p = 0 or p = 1 (continuity correction may be applied).",
  },

  "effect.PAS": {
    title: "Proportion — arcsine (PAS)",
    body:  "Proportion pooled after the arcsine square-root transformation: " +
           "arcsin(√p). Variance-stabilising across a wide range of p. " +
           "Recommended by some authors for sparse data, though the Freeman-Tukey " +
           "double arcsine (PFT) often performs better near the boundaries.",
  },

  "effect.PFT": {
    title: "Proportion — Freeman-Tukey double arcsine (PFT)",
    body:  "Applies the Freeman-Tukey double arcsine transformation for better " +
           "variance stabilisation near 0 and 1 than the plain arcsine (PAS). " +
           "Particularly useful for very rare or very common events. " +
           "Back-transformation uses the harmonic mean of sample sizes.",
  },

  "effect.GENERIC": {
    title: "Generic effect size (yi / vi)",
    body:  "Accepts any pre-computed effect size yi and its variance vi directly. " +
           "Use when your effect measure is not listed above, or when you have " +
           "already computed the estimates (e.g. from specialised software). " +
           "No transformation is applied.",
  },

  // ------------------------------------------------------------------ //
  // τ² estimators                                                        //
  // ------------------------------------------------------------------ //

  "tau.DL": {
    title: "DerSimonian-Laird (DL)",
    body:  "A closed-form moment estimator based on Cochran's Q statistic. " +
           "Fast and widely used, but tends to underestimate τ² when the number " +
           "of studies k is small, which can inflate the Type I error of the " +
           "pooled estimate. A reasonable default for large k.",
  },

  "tau.REML": {
    title: "Restricted Maximum Likelihood (REML)",
    body:  "An iterative estimator that maximises the restricted likelihood, " +
           "accounting for uncertainty in estimating the pooled mean. " +
           "Generally outperforms DL in simulation studies and is the current " +
           "methodological recommendation for most applications. " +
           "Pair with Knapp-Hartung CIs for small k.",
  },

  "tau.PM": {
    title: "Paule-Mandel (PM)",
    body:  "An iterative moment estimator that solves for τ² such that the " +
           "expected Q equals its degrees of freedom. Performs well when k is " +
           "small and the normality assumption may not hold. " +
           "A good alternative to REML when model assumptions are uncertain.",
  },

  "tau.ML": {
    title: "Maximum Likelihood (ML)",
    body:  "Similar to REML but does not apply a degrees-of-freedom correction " +
           "for estimating the pooled mean, producing a downward-biased τ² estimate. " +
           "Rarely preferred over REML in practice.",
  },

  "tau.HS": {
    title: "Hunter-Schmidt (HS)",
    body:  "A moment estimator from the Hunter-Schmidt meta-analytic tradition, " +
           "commonly used in industrial-organisational psychology. " +
           "Can produce negative estimates (clamped to 0). " +
           "Less efficient than REML for general use.",
  },

  "tau.HE": {
    title: "Hedges (HE)",
    body:  "One of the earliest moment estimators, derived from the expected value " +
           "of Q. Similar properties to DL but derived via a different route. " +
           "Rarely outperforms DL or REML and is included mainly for comparability.",
  },

  "tau.SJ": {
    title: "Sidik-Jonkman (SJ)",
    body:  "Starts from an initial non-zero τ² seed, reducing the downward bias " +
           "seen in DL and ML when true heterogeneity is large. " +
           "Can overestimate τ² when studies are homogeneous. " +
           "Useful as a sensitivity check against DL/REML.",
  },

  // ------------------------------------------------------------------ //
  // CI methods                                                           //
  // ------------------------------------------------------------------ //

  "ci.normal": {
    title: "Normal (Wald) CI",
    body:  "Computes the confidence interval as estimate ± z* × SE, where z* is " +
           "the standard normal critical value (1.96 for 95% CI). " +
           "Assumes the pooled estimate is approximately normally distributed. " +
           "Valid for large k; can be anti-conservative when k is small.",
  },

  "ci.KH": {
    title: "Knapp-Hartung (KH) CI",
    body:  "Replaces the standard normal critical value with a t critical value " +
           "(df = k − 1) and rescales the standard error using the mean squared " +
           "error of the weighted regression. Produces wider, better-calibrated " +
           "intervals when k is small. Recommended when using REML.",
  },

  "ci.t": {
    title: "t-distribution CI",
    body:  "Uses a t-distribution with k − 1 degrees of freedom for the critical " +
           "value without the Knapp-Hartung SE rescaling. An intermediate option " +
           "between Normal and full KH adjustment.",
  },

  // ------------------------------------------------------------------ //
  // Heterogeneity statistics                                             //
  // ------------------------------------------------------------------ //

  "het.Q": {
    title: "Cochran's Q",
    body:  "Weighted sum of squared deviations of individual study estimates from " +
           "the pooled mean. Under the null of homogeneity it follows a χ² " +
           "distribution with k − 1 degrees of freedom. " +
           "Has low power when k is small and is almost always significant for " +
           "large k regardless of the practical magnitude of heterogeneity.",
  },

  "het.I2": {
    title: "I²",
    body:  "Proportion of total variance attributable to between-study heterogeneity " +
           "rather than sampling error: I² = (Q − df) / Q. " +
           "Ranges from 0% to 100%. Common benchmarks are 25% (low), 50% " +
           "(moderate), and 75% (high), but these should not be applied " +
           "mechanically — τ² is often more informative.",
  },

  "het.tau2": {
    title: "τ² (tau-squared)",
    body:  "The estimated between-study variance on the effect-size scale. " +
           "Unlike I², τ² does not depend on the average within-study precision, " +
           "making it more useful for comparisons across meta-analyses. " +
           "√τ² (tau) can be used to construct a prediction interval for the " +
           "true effect in a new study.",
  },

  "het.H2": {
    title: "H²",
    body:  "Ratio of total variance to within-study variance. H² = 1 indicates " +
           "perfect homogeneity; H² = 1 / (1 − I²) otherwise. " +
           "Conveys the same information as I² on a ratio scale and is less " +
           "commonly reported.",
  },

  // ------------------------------------------------------------------ //
  // Publication bias                                                     //
  // ------------------------------------------------------------------ //

  "bias.egger": {
    title: "Egger's test",
    body:  "Regresses the standardised effect size on precision (1 / SE). " +
           "A significant non-zero intercept indicates funnel-plot asymmetry, " +
           "which may reflect publication bias. Has inflated Type I error for " +
           "ratio measures (OR, RR) and requires at least 10 studies for adequate power.",
  },

  "bias.begg": {
    title: "Begg's test",
    body:  "Rank correlation (Kendall's τ) between standardised effect sizes and " +
           "their variances. More conservative than Egger's test (lower power) but " +
           "less sensitive to outliers. Also requires at least 10 studies.",
  },

  "bias.trimfill": {
    title: "Trim-and-Fill",
    body:  "Iteratively removes ('trims') asymmetric outlier studies, estimates the " +
           "true effect centre, then imputes ('fills') the mirror-image missing studies. " +
           "Produces an adjusted pooled estimate. Assumes asymmetry is caused solely " +
           "by publication bias; may over-correct when asymmetry has other causes " +
           "(e.g. heterogeneous populations, outliers, or between-study design differences).",
  },

  "bias.fsn": {
    title: "Fail-Safe N (Rosenthal)",
    body:  "The number of unpublished null-result studies that would be needed to " +
           "reduce the pooled p-value to non-significance (p > .05). " +
           "Rosenthal's rule of thumb: FSN > 5k + 10 suggests robustness. " +
           "Widely criticised for being too lenient; trim-and-fill and selection " +
           "models are generally preferred.",
  },

  "bias.fatpet": {
    title: "FAT-PET Regression",
    body:  "The Funnel Asymmetry Test (FAT) regresses the effect size on its " +
           "standard error; a significant slope indicates asymmetry (potential bias). " +
           "The intercept from the Precision Effect Test (PET) estimates the effect " +
           "size corrected for small-study bias. Requires sufficient variation in " +
           "study precision to be informative.",
  },

  // ------------------------------------------------------------------ //
  // Cumulative order                                                     //
  // ------------------------------------------------------------------ //

  "cumorder.input": {
    title: "Cumulative order — Input order",
    body:  "Studies are added cumulatively in the order they appear in the table. " +
           "Useful when the table is arranged chronologically to show how the " +
           "evidence base evolved over time.",
  },

  "cumorder.precision_desc": {
    title: "Cumulative order — Most precise first",
    body:  "Studies are sorted from smallest to largest variance before cumulation. " +
           "Shows how the pooled estimate stabilises as high-quality evidence " +
           "accumulates, and makes it easy to spot whether later imprecise studies " +
           "shift the conclusion.",
  },

  "cumorder.precision_asc": {
    title: "Cumulative order — Least precise first",
    body:  "Studies sorted from largest to smallest variance. Useful for visualising " +
           "how a high-variance early study might skew the cumulative estimate " +
           "before more precise studies are added.",
  },

  "cumorder.effect_asc": {
    title: "Cumulative order — Effect ascending",
    body:  "Studies sorted from smallest to largest effect size before cumulation. " +
           "Helps detect whether the pooled estimate drifts systematically as " +
           "larger effects are added, which could indicate heterogeneity or bias.",
  },

  "cumorder.effect_desc": {
    title: "Cumulative order — Effect descending",
    body:  "Studies sorted from largest to smallest effect size. The mirror image " +
           "of effect-ascending; useful as a sensitivity check.",
  },

  // ------------------------------------------------------------------ //
  // Sensitivity analysis                                                 //
  // ------------------------------------------------------------------ //

  "sens.loo": {
    title: "Leave-one-out analysis",
    body:  "Re-runs the meta-analysis k times, each time omitting one study. " +
           "The pooled estimate, confidence interval, I², and τ² are shown for each " +
           "omission. Rows highlighted amber indicate that removing that study changes " +
           "statistical significance (p = .05 threshold), suggesting the overall " +
           "conclusion is sensitive to that study. Requires at least 3 studies.",
  },

  "sens.estimator": {
    title: "τ² estimator comparison",
    body:  "Runs the random-effects model with all seven available τ² estimators " +
           "(DL, REML, PM, ML, HS, HE, SJ) and displays their pooled estimates side " +
           "by side. If results differ substantially across estimators, the conclusion " +
           "is sensitive to the choice of heterogeneity estimation method. The " +
           "currently selected estimator is highlighted.",
  },

};
