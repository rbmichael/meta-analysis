// ================= HELP CONTENT =================
// Keyed plain-text descriptions used by the help popover.
// Each entry: { title, body }
// Keys must match the data-help attributes in index.html and the
// inline icons injected by ui.js.

export const HELP = {

  // ------------------------------------------------------------------ //
  // Effect types                                                         //
  // ------------------------------------------------------------------ //

  "effect.ROM": {
    title: "Ratio of Means (ROM)",
    body:  "The log ratio of two group means: yi = log(m₁/m₂), " +
           "with variance vi = sd₁²/(n₁·m₁²) + sd₂²/(n₂·m₂²) " +
           "from the delta method. Results are back-transformed to the ratio scale " +
           "(m₁/m₂) for display: a value of 1 indicates no difference, values above 1 " +
           "indicate a higher mean in group 1. " +
           "Both means must be strictly positive — the log is undefined at zero or below. " +
           "Widely used in ecology (plant biomass, population abundance) and increasingly " +
           "in psychology. Introduced by Hedges, Gurevitch & Curtis (1999). " +
           "The delta-method variance approximation becomes unreliable when the " +
           "coefficient of variation (SD/mean) exceeds 1.",
  },

  "effect.CVR": {
    title: "Coefficient of Variation Ratio (CVR)",
    body:  "The log ratio of two coefficients of variation: yi = log(CV₁ / CV₂), " +
           "where CV₁ = sd₁/m₁ and CV₂ = sd₂/m₂. " +
           "Results are back-transformed to the ratio scale (CV₁/CV₂) for display: " +
           "a value of 1 means equal relative variability across groups, " +
           "values above 1 indicate greater relative dispersion in group 1. " +
           "The variance formula is vi = 1/(2·(n₁−1)) + CV₁²/n₁ + 1/(2·(n₂−1)) + CV₂²/n₂, " +
           "which combines the sampling variance of each log-CV estimate. " +
           "Both means must be strictly positive (the CV is undefined at zero or below), " +
           "and both SDs must be positive; a minimum n of 2 per group is required. " +
           "The variance approximation degrades when CVs exceed 1 (highly skewed populations). " +
           "CVR is useful when you want to compare variability independently of the mean — " +
           "for example, to test whether an intervention homogenises or disperses outcomes " +
           "beyond any shift in the mean. " +
           "Corresponds to measure=\"CVR\" in metafor. " +
           "Reference: Nakagawa et al. (2015), Methods in Ecology and Evolution.",
  },

  "effect.VR": {
    title: "Variability Ratio (VR)",
    body:  "The log ratio of two standard deviations: yi = log(sd₁ / sd₂), " +
           "stored on the log scale and back-transformed to the ratio scale (sd₁/sd₂) for display. " +
           "A value of 1 indicates equal spread in both groups; values above 1 indicate " +
           "greater absolute variability in group 1. " +
           "The variance formula is vi = 1/(2·(n₁−1)) + 1/(2·(n₂−1)), " +
           "which depends only on sample sizes — not on the observed SDs themselves. " +
           "Only sd₁, sd₂, n₁, and n₂ are required; group means are not needed. " +
           "Both SDs must be strictly positive and n ≥ 2 per group. " +
           "VR measures absolute dispersion, in contrast to CVR (Coefficient of Variation Ratio) " +
           "which measures relative dispersion (SD/mean). Prefer VR when the outcome scale is " +
           "fixed and meaningful; prefer CVR when you want to control for mean-level differences. " +
           "Corresponds to measure=\"VR\" in metafor. " +
           "Reference: Nakagawa et al. (2015), Methods in Ecology and Evolution.",
  },

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

  "effect.SMDH": {
    title: "Standardized Mean Difference — heteroscedastic (SMDH)",
    body:  "A variant of Hedges' g that does not assume equal population variances. " +
           "Instead of the pooled SD, the standardizer is sdi = √((sd₁² + sd₂²) / 2) " +
           "— the square root of the average group variance. " +
           "The same Hedges J correction is applied, and the delta-method variance " +
           "is vi = (sd₁²/n₁ + sd₂²/n₂) / sdi² + d² / (2·df). " +
           "Prefer SMDH over SMD when the intervention is expected to change the " +
           "outcome variance (e.g. a treatment that both shifts and narrows the " +
           "distribution), making the homoscedasticity assumption of the pooled SD " +
           "implausible. When sd₁ ≈ sd₂ the two estimators agree closely and the " +
           "standard SMD is more widely understood. " +
           "Corresponds to measure=\"SMDH\" in metafor. " +
           "Reference: Bonett (2009), Psychological Methods.",
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

  "effect.MN": {
    title: "Mean — raw (MN)",
    body:  "Synthesises the raw sample mean across single-arm studies. " +
           "Effect size: yi = m̄; variance: vi = sd²/n. " +
           "Assumes the sampling distribution of the mean is approximately normal. " +
           "No back-transformation is applied — pooled estimate is on the original scale. " +
           "If means are strictly positive and right-skewed, consider MNLN instead.",
  },

  "effect.MNLN": {
    title: "Mean — log-transformed (MNLN)",
    body:  "Synthesises the log-transformed sample mean across single-arm studies. " +
           "Effect size: yi = log(m̄); variance: vi = sd²/(n·m̄²) via the delta method. " +
           "Requires m̄ > 0. Pooled estimate back-transforms to the original mean scale " +
           "via exp(). Preferable over MN when means span orders of magnitude or are " +
           "right-skewed. The delta-method approximation is less accurate when the " +
           "coefficient of variation (sd/m̄) exceeds 0.5.",
  },

  "effect.GOR": {
    title: "Generalised Odds Ratio — ordinal (GOR)",
    body:  "Effect size for ordinal outcomes (Agresti 1980). " +
           "GOR = P(Y₁ > Y₂) / P(Y₁ < Y₂): the odds that a randomly selected " +
           "participant from group 1 scores higher than one from group 2, relative " +
           "to the reverse. GOR > 1 means group 1 tends to score higher. " +
           "Stored on the log scale; displayed as the ratio (back-transformed). " +
           "Input: enter category counts from lowest to highest category, separated " +
           "by commas or spaces (e.g. \"15,28,22,10\"). Both groups must have the " +
           "same number of categories. Returns undefined (NaN) when one group has " +
           "zero probability of scoring strictly above or below the other (complete separation).",
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

  "tau.GENQ": {
    title: "Generalized Q (GENQ)",
    body:  "A generalisation of the DL estimator that allows arbitrary study weights aᵢ. " +
           "With aᵢ = 1/vᵢ it reduces exactly to DL. " +
           "Useful when custom weighting schemes are required; otherwise DL or REML is preferred.",
  },

  "tau.SQGENQ": {
    title: "Square-root weight GENQ (SQGENQ)",
    body:  "A GENQ variant using aᵢ = √(1/vᵢ) instead of the usual inverse-variance weights. " +
           "Down-weights large, precise studies relative to DL, producing larger τ² estimates " +
           "in heterogeneous sets. Included for sensitivity analysis.",
  },

  "tau.DLIT": {
    title: "DL with iteration (DLIT)",
    body:  "Applies the DL moment formula iteratively: after each estimate of τ², weights are " +
           "updated as 1/(vᵢ + τ²) and the formula is re-applied until convergence. " +
           "Seeds from the DL estimate and typically converges in 2–3 steps. " +
           "Can reduce the underestimation bias of plain DL.",
  },

  "tau.EBLUP": {
    title: "EBLUP (= REML)",
    body:  "In the univariate random-effects model, the Empirical Best Linear Unbiased Predictor " +
           "(EBLUP) of τ² is identical to REML (Harville 1977; Raudenbush 2009). " +
           "This option is provided for compatibility with metafor's naming convention.",
  },

  "tau.HSk": {
    title: "Hunter-Schmidt corrected (HSk)",
    body:  "The standard Hunter-Schmidt (HS) estimate multiplied by k/(k−1) to correct the " +
           "downward bias in small samples. Reduces to HS as k → ∞. " +
           "Recommended over plain HS when k is small.",
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

  "ci.PL": {
    title: "Profile Likelihood CI",
    body:  "Inverts the likelihood ratio test to find the set of μ values not rejected " +
           "at the 5% level: { μ : 2[L(μ̂,τ̂²) − L_p(μ)] ≤ 3.84 }, where L_p(μ) is " +
           "maximised over τ² for each fixed μ. Always uses ML internally regardless " +
           "of the selected τ² estimator. Produces asymmetric CIs that are better " +
           "calibrated than Wald CIs when k is small, at the cost of extra computation.",
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
