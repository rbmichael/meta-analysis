// ================= HELP CONTENT =================
// Keyed plain-text descriptions used by the help popover.
// Each entry: { title, body }
// Keys must match the data-help attributes in index.html and the
// inline icons injected by ui.js.

export const HELP = {

  // ------------------------------------------------------------------ //
  // Input pane                                                           //
  // ------------------------------------------------------------------ //

  "input.csv": {
    title: "Import / Export CSV",
    body:  "Import CSV: load study data from a comma- or tab-separated file. " +
           "Column headers are matched automatically to the fields required by the selected effect type " +
           "(e.g. m1, sd1, n1, m2, sd2, n2 for MD; a, b, c, d for OR). " +
           "A label column is optional but recommended; a group column assigns studies to subgroups. " +
           "A preview panel lets you review and remap columns before committing. " +
           "Export CSV: download the current data table as a CSV file.",
  },

  "input.session": {
    title: "Save / Load Session",
    body:  "Save Session: serialises the full application state — data, effect type, " +
           "τ² estimator, CI method, moderators, and RoB ratings — to a JSON file. " +
           "Load Session: restores a previously saved session from that JSON file. " +
           "Sessions are also auto-saved to browser localStorage; a recovery banner " +
           "appears on next load if unsaved changes are detected.",
  },

  "input.moderators": {
    title: "Moderators",
    body:  "Study-level covariates used in meta-regression and subgroup analysis. " +
           "Continuous moderators produce a bubble plot and a slope estimate (β) per unit increase. " +
           "Categorical moderators are dummy-coded automatically (first level = reference). " +
           "Multiple moderators may be added simultaneously. " +
           "Enter a column name, select Continuous or Categorical, then click + Add. " +
           "Values are entered in the moderator columns of the data table.",
  },

  "input.rob": {
    title: "Risk-of-bias domains",
    body:  "User-defined assessment domains (e.g. Randomisation, Blinding, Attrition). " +
           "Each domain gets a Low / Some concerns / High / Not reported rating per study, " +
           "entered in the RoB grid that appears below the data table once domains are added. " +
           "Results are visualised as a per-study traffic light grid and a per-domain summary bar chart " +
           "in the Risk of Bias section of the Results pane.",
  },

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
    title: "Standardized Mean Change — pre-test SD (SMD paired / SMCR)",
    body:  "The pre-post mean difference standardised by the pre-measurement SD (sd_pre). " +
           "Equivalent to metafor's SMCR (Morris 2008). " +
           "Hedges g correction is applied: g = d·J, J = 1 − 3/(4(n−1)−1). " +
           "Variance: var(d) = 2(1−r)/n + d²/(2(n−1)); vi = J²·var(d). " +
           "Requires the pre-post correlation r; defaults to 0.5 if not provided. " +
           "Use this when studies report sd_pre but not sd_post.",
  },

  "effect.SMCC": {
    title: "Standardized Mean Change — change-score SD (SMCC)",
    body:  "The pre-post mean difference standardised by the SD of the change scores: " +
           "sd_change = √(sd_pre² + sd_post² − 2r·sd_pre·sd_post). " +
           "Hedges g correction is applied: g = d·J, J = 1 − 3/(4(n−1)−1). " +
           "Variance: var(d) = 2(1−r)/n + d²/(2(n−1)); vi = J²·var(d). " +
           "Requires both sd_pre and sd_post plus the pre-post correlation r. " +
           "If r is not provided it defaults to 0.5 with a soft warning. " +
           "Use this when studies report the change-score SD directly.",
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

  "effect.PCOR": {
    title: "Partial Correlation — raw r (PCOR)",
    body:  "Pearson partial correlation controlling for p covariates, pooled on the untransformed scale. " +
           "Inputs: r (partial correlation coefficient), n (sample size), p (number of covariates partialled out; default 0). " +
           "Variance: vi = (1 − r²)² / (n − p − 1). " +
           "When p = 0 this reduces exactly to COR: vi = (1 − r²)² / (n − 1). " +
           "Minimum sample size: n ≥ p + 3 (ensures the denominator is ≥ 2). " +
           "The same caveats as COR apply: r is bounded and its variance depends on the true ρ, " +
           "so ZPCOR is generally preferred when r values are not all small. " +
           "Pooled on the raw scale — no back-transformation.",
  },

  "effect.ZPCOR": {
    title: "Partial Correlation — Fisher's z (ZPCOR)",
    body:  "Partial correlation (controlling for p covariates) after Fisher's r-to-z transformation: " +
           "z = atanh(r) = 0.5 ln[(1+r)/(1−r)]. " +
           "Inputs: r (partial correlation), n (sample size), p (number of covariates; default 0). " +
           "Variance: vi = 1 / (n − p − 3). " +
           "When p = 0 this reduces exactly to ZCOR: vi = 1 / (n − 3). " +
           "Minimum sample size: n ≥ p + 4 (ensures the variance denominator is ≥ 1). " +
           "Because the Fisher z variance is nearly independent of the true ρ, ZPCOR is preferred " +
           "over PCOR in the same way ZCOR is preferred over COR. " +
           "Results are back-transformed to r for display.",
  },

  "effect.PHI": {
    title: "Phi Coefficient (PHI)",
    body:  "Pearson correlation for two binary variables, computed from a 2×2 table: " +
           "φ = (ad − bc) / √((a+b)(c+d)(a+c)(b+d)). " +
           "Ranges from −1 to +1; φ = 0 means no association. " +
           "Variance: vi = (1 − φ²)² / (N − 1), the same approximation used for raw Pearson r (COR). " +
           "Unlike OR or RR, phi captures symmetric association rather than a directional risk contrast. " +
           "Inputs are the four cells of a 2×2 table (a, b, c, d ≥ 0); all four marginal totals " +
           "(a+b, c+d, a+c, b+d) must be > 0. Individual zero cells are allowed but produce a warning. " +
           "No continuity correction is applied (contrast with OR/RR). " +
           "Pooled on the raw scale — no back-transformation.",
  },

  "effect.RTET": {
    title: "Tetrachoric Correlation (RTET)",
    body:  "Estimates the latent Pearson correlation between two underlying continuous, " +
           "bivariate-normal variables from their dichotomisation in a 2×2 table (Pearson 1900). " +
           "Algorithm: thresholds h = Φ⁻¹((a+b)/N) and k = Φ⁻¹((a+c)/N) are computed from " +
           "the marginal proportions; the tetrachoric ρ is then found by bisecting the bivariate " +
           "normal CDF Φ₂(h, k; ρ) = a/N. " +
           "Variance: p_r(1−p_r)·p_c(1−p_c) / (N · φ₂(h,k;ρ)²), where φ₂ is the bivariate " +
           "normal PDF evaluated at the thresholds — delta-method approximation. " +
           "A zero cell triggers a +0.5 continuity correction to all cells before estimation. " +
           "Key properties: |ρ_tet| ≥ |φ| for the same table; ρ_tet = φ only when marginals are 50/50. " +
           "Appropriate when the binary outcomes reflect an underlying continuous normal construct. " +
           "Contrast with PHI (distribution-free) and COR/ZCOR (continuous r input). " +
           "Same inputs as OR/RR/PHI: a, b, c, d ≥ 0 with all four marginal totals > 0.",
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

  "tau.MH": {
    title: "Mantel-Haenszel (MH)",
    body:  "Fixed-effects pooling using Mantel-Haenszel weights derived directly from raw 2×2 " +
           "cell counts (a, b, c, d). Available for OR, RR, and RD. " +
           "No between-study variance τ² is estimated; the result is a fixed-effect estimate only. " +
           "Unlike inverse-variance pooling, MH handles single-zero cells without a continuity " +
           "correction and is more robust to sparse data. " +
           "The Cochrane Handbook recommends MH as the default pooling method for binary outcomes. " +
           "Variance formulas: Robins et al. (1986) for OR; Greenland & Robins (1985) for RR " +
           "and RD (Sato et al. 1989 variance for RD).",
  },

  "tau.Peto": {
    title: "Peto OR",
    body:  "One-step fixed-effects log-OR estimator based on the sum of observed-minus-expected " +
           "cell counts, weighted by their hypergeometric variance. OR only. " +
           "No τ² is estimated. " +
           "Best suited when events are rare (<10% event rate) and arm sizes are balanced; " +
           "can be substantially biased when events are common (>20%) or arms are very " +
           "unbalanced (n₁/n₂ > 3) — in those cases prefer Mantel-Haenszel or an " +
           "inverse-variance random-effects model. " +
           "Formula: log OR = Σ(aᵢ − Eᵢ) / ΣVᵢ where " +
           "Eᵢ = n₁ᵢ(aᵢ+cᵢ)/Nᵢ and Vᵢ = n₁ᵢn₂ᵢ(aᵢ+cᵢ)(bᵢ+dᵢ) / [Nᵢ²(Nᵢ−1)]. " +
           "Reference: Yusuf et al. (1985).",
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

  "het.pred": {
    title: "Prediction interval",
    body:  "The prediction interval estimates the range within which the true " +
           "effect of a new, comparable study would fall with 95% probability. " +
           "Unlike the confidence interval (which quantifies uncertainty about " +
           "the pooled mean), the prediction interval also accounts for " +
           "between-study heterogeneity (τ²) and therefore widens as studies " +
           "differ more from one another.\n\n" +
           "Method: Higgins, Thompson & Spiegelhalter (2009, J R Stat Soc A " +
           "172:137-159). Critical value from the t-distribution with df = k − 2, " +
           "where k is the number of studies. Requires k ≥ 3; reported as NA " +
           "otherwise. The base random-effects standard error (seRE) is used — " +
           "not the Knapp-Hartung-adjusted value — consistent with metafor's " +
           "default behaviour.",
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

  "bias.harbord": {
    title: "Harbord's Test",
    body:  "Modified Egger test for meta-analyses of binary outcomes (OR studies) proposed by " +
           "Harbord et al. (2006, Stat Med 25:3443-3457). " +
           "The standard Egger test has inflated Type I error for log-ORs because the effect " +
           "size and its standard error share information (both depend on the same cell counts). " +
           "Harbord's test sidesteps this by working with the score statistic: for each 2×2 table " +
           "it computes E_i = (a+b)(a+c)/N (expected events) and " +
           "V_i = (a+b)(c+d)(a+c)(b+d) / (N²(N−1)) (hypergeometric variance), then " +
           "regresses z_i = (a − E_i)/√V_i on √V_i using OLS. " +
           "A significant non-zero intercept indicates small-study effects. " +
           "Requires raw 2×2 cell counts; not applicable to continuous or pre-computed effect sizes.",
  },

  "bias.peters": {
    title: "Peters' Test",
    body:  "Modified Egger test proposed by Peters et al. (2006, JAMA 295:676-680). " +
           "Rather than regressing on the standard error (which shares variance components with log-OR), " +
           "Peters regresses the effect size yi on 1/N (inverse total sample size) using " +
           "inverse-variance weighted regression (weights = 1/vi). " +
           "A significant non-zero intercept indicates small-study effects. " +
           "Works with any effect type where total N can be determined (from a+b+c+d, n1+n2, or n). " +
           "Preferred over Egger's test when the effect measure is an OR or RR.",
  },

  "bias.deeks": {
    title: "Deeks' Test",
    body:  "Funnel-plot asymmetry test for meta-analyses of diagnostic accuracy studies, " +
           "proposed by Deeks et al. (2005, J Clin Epidemiol 58:882-893). " +
           "Uses the effective sample size ESS_i = 2(a+c)(b+d)/N (harmonic mean of diseased " +
           "and non-diseased group sizes, scaled by 2) as the precision surrogate. " +
           "Regresses log(DOR_i) on 1/√ESS_i using weighted regression with weights ESS_i; " +
           "a significant non-zero intercept indicates asymmetry. " +
           "Requires raw 2×2 counts with all cells > 0 (zero cells make log DOR undefined; " +
           "no continuity correction is applied). " +
           "Designed specifically for diagnostic ORs — not appropriate for therapeutic OR/RR studies.",
  },

  "bias.ruecker": {
    title: "Rücker's Test",
    body:  "Arcsine-based Egger test for binary outcomes proposed by " +
           "Rücker et al. (2008, Stat Med 27:4450-4465). " +
           "Applies the variance-stabilising arcsine transformation: " +
           "y_i = asin(√p1) − asin(√p2) with se_i = √(1/(4n1) + 1/(4n2)), " +
           "then regresses the standardised statistic z_i = y_i/se_i on precision 1/se_i using OLS. " +
           "Because the arcsine risk difference and its SE depend on different aspects of the data " +
           "than the log-OR, this test has better-controlled Type I error than Egger for binary outcomes. " +
           "Studies with zero group sizes (n1 = 0 or n2 = 0) are skipped; " +
           "zero cells within a group (p = 0 or p = 1) are allowed. " +
           "Requires raw 2×2 cell counts.",
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

  // ------------------------------------------------------------------ //
  // P-value analyses                                                     //
  // ------------------------------------------------------------------ //

  "bias.pcurve": {
    title: "P-curve",
    body:  "Examines the distribution of significant p-values (p < .05) across studies. " +
           "A right-skewed distribution — most p-values near zero — indicates evidential value. " +
           "A flat or left-skewed distribution suggests p-hacking or absence of a true effect. " +
           "Two formal tests: right-skew test (H₀: no effect) and flatness test (H₃₃: ≤33% power). " +
           "Only studies with p < .05 are included. " +
           "Simonsohn, Nelson & Simmons (2014).",
  },

  "bias.puniform": {
    title: "P-uniform*",
    body:  "Estimates a publication-bias-corrected effect size by exploiting the uniformity " +
           "of conditional p-value quantiles under the true effect. " +
           "Reports a bias-corrected estimate with 95% CI, a significance test (H₀: δ = 0), " +
           "and a publication-bias test comparing the conditional quantiles at the RE estimate " +
           "to a uniform distribution. " +
           "Requires at least 2 significant studies. " +
           "van Assen, van Aert & Wicherts (2015); improved variant van Aert & van Assen (2021).",
  },

  // ------------------------------------------------------------------ //
  // Selection model                                                      //
  // ------------------------------------------------------------------ //

  "sel.model": {
    title: "Selection model (Vevea-Hedges)",
    body:  "Models the publication process by assigning relative selection weights ω " +
           "to studies based on their p-value interval. " +
           "MLE mode estimates ω jointly with μ and τ² (requires k ≥ 8); " +
           "fixed-ω sensitivity mode holds ω at Mild / Moderate / Severe presets " +
           "(requires k ≥ 3). " +
           "A μ substantially lower than the standard RE estimate indicates publication bias. " +
           "Vevea & Hedges (1995); presets from Vevea & Woods (2005).",
  },

  // ------------------------------------------------------------------ //
  // Diagnostics                                                          //
  // ------------------------------------------------------------------ //

  "diag.baujat": {
    title: "Baujat plot",
    body:  "Scatter plot of per-study heterogeneity contribution (x) versus overall " +
           "influence on the pooled estimate (y). Studies in the upper-right quadrant " +
           "simultaneously inflate Cochran's Q and shift the pooled estimate — the most " +
           "important candidates for sensitivity analysis. Reference lines are drawn at " +
           "the means of each axis. Introduced by Baujat et al. (2002).",
  },

  "diag.gosh": {
    title: "GOSH plot",
    body:  "Graphical Display of Study Heterogeneity (Olkin et al. 2012). " +
           "Plots the fixed-effects pooled estimate and I² (or Q, or n) for every " +
           "non-empty subset of the k studies. Fan-shaped or bimodal clusters reveal " +
           "influential studies invisible to leave-one-out analysis. " +
           "Enumerated exactly for k ≤ 15; random-sampled for k ≤ 30 (default 50 000 subsets). " +
           "Click Compute to run; large k may take a few seconds.",
  },

  "diag.profileLik": {
    title: "Profile likelihood for τ²",
    body:  "Shows the profile log-likelihood curve for τ² (ML or REML). " +
           "The 95% CI is the range where the curve exceeds the −1.921 threshold " +
           "(likelihood-ratio inversion). " +
           "This CI differs from the Q-profile CI in the summary table, which is " +
           "moment-based and uses Cochran's Q rather than the full likelihood. " +
           "The x-axis can be toggled between τ² (variance) and τ (SD). " +
           "Only available for ML and REML estimators.",
  },

  "diag.metaregression": {
    title: "Meta-regression",
    body:  "Regresses study effect sizes on one or more study-level moderators " +
           "(continuous or categorical) using weighted least squares with RE weights. " +
           "Reports β coefficients with SEs, z/t statistics, p-values, and 95% CIs; " +
           "Q_M (omnibus moderator test); Q_E (residual heterogeneity); " +
           "R² (proportion of variance explained); and VIFs (collinearity). " +
           "Bubble plots are generated per continuous moderator. " +
           "Rule of thumb: ≥ 10 studies per predictor for adequate power.",
  },

  "diag.subgroup": {
    title: "Subgroup analysis",
    body:  "Fits a separate RE model within each study group (defined by the Group column). " +
           "Reports the pooled estimate, τ², I², and 95% CI for each group. " +
           "Q_between tests whether the mean effect differs across groups " +
           "(χ² with G − 1 df, where G is the number of groups). " +
           "Subgroup analyses should be pre-registered to control Type I error.",
  },

  "diag.influence": {
    title: "Influence diagnostics",
    body:  "Per-study diagnostics computed by leave-one-out re-analysis: " +
           "standardised residual (|r| > 2 flags outliers), " +
           "DFBETA (|DFBETA| > 1 flags disproportionate influence on the pooled estimate), " +
           "hat value (leverage, h > 2/k), " +
           "Cook's distance (D > 4/k), and Δτ² (change in heterogeneity on removal). " +
           "The influence plot shows hat value vs. Cook's distance as a bubble chart. " +
           "Viechtbauer & Cheung (2010).",
  },

  // Cluster-robust SE                                                   //
  "cluster.id": {
    title: "Cluster ID",
    body:  "An optional study identifier used to form clusters of dependent effect sizes. " +
           "Studies sharing the same non-blank Cluster ID are assumed correlated — " +
           "for example, multiple outcomes or subgroups from the same primary study, " +
           "or multiple papers from the same cohort. " +
           "The Cluster ID does not affect the point estimate; it corrects the standard error " +
           "using the sandwich (cluster-robust) variance estimator. " +
           "Leave blank for independent studies. " +
           "At least 2 clusters are required; 10 or more is recommended for reliable inference.",
  },

  "cluster.robust": {
    title: "Cluster-robust SE",
    body:  "The cluster-robust (sandwich) standard error accounts for dependence among effect sizes " +
           "that share a Cluster ID. It replaces the model-based SE without changing the point estimate. " +
           "The CR1 small-sample correction (C / (C − p)) is applied, and a t-distribution with " +
           "df = C − p degrees of freedom is used for the confidence interval when C < 30. " +
           "When every row has a distinct cluster ID the result is the HC1 " +
           "heteroscedasticity-robust SE. " +
           "Not available for M-H/Peto methods. " +
           "Based on Hedges, Tipton & Johnson (2010).",
  },

  // Bayesian                                                            //
  "bayes.model": {
    title: "Bayesian meta-analysis",
    body:  "Fits a conjugate normal-normal random-effects model using a grid " +
           "approximation over τ (300 points). " +
           "Prior on μ: N(μ₀, σ_μ²); prior on τ: HalfNormal(σ_τ). " +
           "Because the prior on μ is conjugate given τ, the marginal " +
           "posterior of μ is an analytic mixture of normals — no MCMC required. " +
           "Outputs: posterior mean and 95% credible interval for μ (overall effect) " +
           "and τ (heterogeneity SD), plus posterior density plots. " +
           "With diffuse priors (σ_μ, σ_τ large) the posterior mean of μ " +
           "approaches the REML random-effects estimate.",
  },

};
