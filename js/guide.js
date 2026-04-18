// ================= IN-APP METHODOLOGY GUIDE =================
// GUIDE — array of sections, each with an id, heading, and topics array.
// Each topic: { id, title, body (HTML string), citations (string[]) }
//
// renderGuide(container) — lazy DOM builder; call once with the guide <div>.
// HELP_TO_GUIDE — maps help.js keys to guide topic ids for cross-linking.

export const GUIDE = [

  // ------------------------------------------------------------------ //
  // Effect Types                                                         //
  // ------------------------------------------------------------------ //
  {
    id: "effect-types",
    heading: "Effect Types",
    topics: [

      {
        id: "guide-smd",
        title: "Standardised Mean Difference — Hedges' g (SMD)",
        body: `<p>The mean difference between two groups divided by a pooled standard
deviation, with Hedges' small-sample correction (J factor) applied.
Use when studies measure the same construct on different scales or
instruments. Values of 0.2, 0.5, and 0.8 are conventionally labelled
small, medium, and large (Cohen 1988).</p>
<p><strong>Formula:</strong><br>
<code>d = (m₁ − m₂) / s_p</code><br>
where <code>s_p = √[((n₁−1)s₁² + (n₂−1)s₂²) / (n₁+n₂−2)]</code>
and the corrected <code>g = d · J</code>, with
<code>J = 1 − 3 / (4(n₁+n₂−2) − 1)</code>.<br>
Variance: <code>vi = (n₁+n₂)/(n₁·n₂) + g²/(2(n₁+n₂−2))</code>.</p>
<p><strong>When to use:</strong> Studies report means and SDs on different but
commensurable scales (e.g. different anxiety questionnaires). All studies
must share roughly equal population variances (homoscedasticity).</p>
<p><strong>When to avoid:</strong> When intervention is expected to change
outcome variance as well as the mean (consider SMDH); when all studies
use the same scale (use MD instead to preserve interpretability).</p>`,
        citations: [
          "Hedges, L. V., & Olkin, I. (1985). <em>Statistical methods for meta-analysis</em>. Academic Press.",
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
          "Cohen, J. (1988). <em>Statistical power analysis for the behavioral sciences</em> (2nd ed.). Lawrence Erlbaum.",
        ],
      },

      {
        id: "guide-smdh",
        title: "Standardised Mean Difference — heteroscedastic (SMDH)",
        body: `<p>A variant of Hedges' g that does not assume equal population variances.
Instead of the pooled SD, the standardiser is
<code>s_d = √((s₁² + s₂²) / 2)</code> — the square root of the average
group variance. The same Hedges J correction is applied.</p>
<p><strong>Formula:</strong><br>
<code>d = (m₁ − m₂) / s_d</code>,&ensp;
<code>g = d · J</code><br>
Variance: <code>vi = (s₁²/n₁ + s₂²/n₂) / s_d² + g² / (2·df)</code>,
where <code>df = n₁ + n₂ − 2</code>.</p>
<p><strong>When to use:</strong> When the intervention is expected to both
shift and narrow (or widen) the distribution, making the equal-variance
assumption of the pooled SD implausible.</p>
<p><strong>When to avoid:</strong> When <code>s₁ ≈ s₂</code>, in which case
SMDH and SMD agree closely and SMD is more widely understood.</p>`,
        citations: [
          "Bonett, D. G. (2009). Meta-analytic interval estimation for standardized and unstandardized mean differences. <em>Psychological Methods, 14</em>(3), 225–238.",
        ],
      },

      {
        id: "guide-md",
        title: "Mean Difference (MD)",
        body: `<p>The raw arithmetic difference between two group means (μ₁ − μ₂).
Preserves the original measurement scale and is the most directly
interpretable effect measure when all studies share the same unit.</p>
<p><strong>Formula:</strong><br>
<code>yi = m₁ − m₂</code><br>
<code>vi = s₁²/n₁ + s₂²/n₂</code></p>
<p><strong>When to use:</strong> All studies report the outcome on an identical
scale with a meaningful unit (e.g. blood pressure in mmHg, weight in kg).</p>
<p><strong>When to avoid:</strong> Studies use different instruments or scales;
use SMD instead.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-md-paired",
        title: "Mean Difference — Paired (MD paired)",
        body: `<p>Raw mean difference for pre/post or matched-pairs designs.
The within-person correlation <em>r</em> is needed to compute the correct
variance. Using the independent-groups formula for paired data
over-estimates the standard error.</p>
<p><strong>Formula:</strong><br>
<code>yi = m_post − m_pre</code><br>
<code>vi = (s_pre² + s_post² − 2r·s_pre·s_post) / n</code></p>
<p><strong>When to use:</strong> Studies report pre and post means with SDs
from the same participants (within-subjects design).</p>
<p><strong>When to avoid:</strong> Parallel-group (between-subjects) designs;
use MD or SMD instead.</p>`,
        citations: [
          "Morris, S. B., & DeShon, R. P. (2002). Combining effect size estimates in meta-analysis with repeated measures and independent-groups designs. <em>Psychological Methods, 7</em>(1), 105–125.",
        ],
      },

      {
        id: "guide-smd-paired",
        title: "Standardised Mean Change — pre-test SD (SMD paired / SMCR)",
        body: `<p>The pre-post mean difference standardised by the pre-measurement SD
(<code>s_pre</code>). Equivalent to metafor's SMCR (Morris 2008).
Hedges' g correction is applied.</p>
<p><strong>Formula:</strong><br>
<code>d = (m_post − m_pre) / s_pre</code>,&ensp;
<code>g = d · J</code><br>
<code>var(d) = 2(1−r)/n + d²/(2(n−1))</code>;
<code>vi = J²·var(d)</code></p>
<p><strong>When to use:</strong> Studies report <code>s_pre</code> but not
<code>s_post</code>. The pre-test SD is meaningful as a standardiser.</p>
<p><strong>When to avoid:</strong> When <code>s_post</code> is available and
the change-score SD is preferable; use SMCC instead.</p>`,
        citations: [
          "Morris, S. B. (2008). Estimating effect sizes from pretest-posttest-control group designs. <em>Organizational Research Methods, 11</em>(2), 364–386.",
        ],
      },

      {
        id: "guide-smcc",
        title: "Standardised Mean Change — change-score SD (SMCC)",
        body: `<p>The pre-post mean difference standardised by the SD of the change scores:
<code>s_change = √(s_pre² + s_post² − 2r·s_pre·s_post)</code>.
Hedges' g correction is applied.</p>
<p><strong>Formula:</strong><br>
<code>d = (m_post − m_pre) / s_change</code>,&ensp;
<code>g = d · J</code><br>
<code>var(d) = 2(1−r)/n + d²/(2(n−1))</code>;
<code>vi = J²·var(d)</code></p>
<p><strong>When to use:</strong> Studies report both <code>s_pre</code> and
<code>s_post</code> (and optionally <code>r</code>), and you want to
standardise by actual change variability rather than baseline.</p>
<p><strong>When to avoid:</strong> When <code>s_post</code> is unavailable;
use SMCR (SMD paired) instead.</p>`,
        citations: [
          "Morris, S. B. (2008). Estimating effect sizes from pretest-posttest-control group designs. <em>Organizational Research Methods, 11</em>(2), 364–386.",
        ],
      },

      {
        id: "guide-rom",
        title: "Ratio of Means (ROM)",
        body: `<p>The log ratio of two group means, back-transformed to the ratio scale
(m₁/m₂) for display. A value of 1 indicates no difference; values above 1
indicate a higher mean in group 1. Introduced by Hedges, Gurevitch &amp;
Curtis (1999) and widely used in ecology.</p>
<p><strong>Formula:</strong><br>
<code>yi = log(m₁ / m₂)</code><br>
<code>vi = s₁²/(n₁·m₁²) + s₂²/(n₂·m₂²)</code> (delta method)</p>
<p><strong>When to use:</strong> Both means are strictly positive (e.g. plant
biomass, population abundance). The ratio scale is more interpretable than
the raw difference.</p>
<p><strong>When to avoid:</strong> When either mean can be zero or negative;
when the coefficient of variation (SD/mean) exceeds 1, the delta-method
variance approximation becomes unreliable.</p>`,
        citations: [
          "Hedges, L. V., Gurevitch, J., & Curtis, P. S. (1999). The meta-analysis of response ratios in experimental ecology. <em>Ecology, 80</em>(4), 1150–1156.",
        ],
      },

      {
        id: "guide-cvr",
        title: "Coefficient of Variation Ratio (CVR)",
        body: `<p>The log ratio of two coefficients of variation (CV = SD/mean), useful
when you want to compare variability independently of the mean — e.g. to test
whether an intervention homogenises or disperses outcomes beyond any shift
in the mean.</p>
<p><strong>Formula:</strong><br>
<code>yi = log(CV₁ / CV₂)</code><br>
<code>vi = 1/(2(n₁−1)) + CV₁²/n₁ + 1/(2(n₂−1)) + CV₂²/n₂</code></p>
<p><strong>When to use:</strong> Both means are strictly positive; you are
specifically interested in dispersion differences after controlling for the
mean.</p>
<p><strong>When to avoid:</strong> CVs exceed 1 (highly skewed populations),
where the variance approximation degrades. For absolute spread, use VR.</p>`,
        citations: [
          "Nakagawa, S., Poulin, R., Mengersen, K., Reinhold, K., Engqvist, L., Lagisz, M., & Senior, A. M. (2015). Meta-analysis of variation: Ecological and evolutionary applications and beyond. <em>Methods in Ecology and Evolution, 6</em>(2), 143–152.",
        ],
      },

      {
        id: "guide-vr",
        title: "Variability Ratio (VR)",
        body: `<p>The log ratio of two standard deviations, back-transformed to the ratio
scale. Measures absolute dispersion rather than relative dispersion (CVR).
Unusually, the variance depends only on sample sizes, not on the SDs.</p>
<p><strong>Formula:</strong><br>
<code>yi = log(s₁ / s₂)</code><br>
<code>vi = 1/(2(n₁−1)) + 1/(2(n₂−1))</code></p>
<p><strong>When to use:</strong> The outcome scale is fixed and meaningful, and
you want to compare spread without reference to group means.</p>
<p><strong>When to avoid:</strong> When means differ substantially and you want
to control for that; use CVR instead.</p>`,
        citations: [
          "Nakagawa, S., Poulin, R., Mengersen, K., Reinhold, K., Engqvist, L., Lagisz, M., & Senior, A. M. (2015). Meta-analysis of variation. <em>Methods in Ecology and Evolution, 6</em>(2), 143–152.",
        ],
      },

      {
        id: "guide-or",
        title: "Odds Ratio (OR)",
        body: `<p>Ratio of the odds of an event in the treatment group to the odds in the
control group, computed from a 2×2 table (a, b, c, d). Analysed on the log
scale internally; back-transformed for display.</p>
<p><strong>Formula:</strong><br>
<code>OR = (a/b) / (c/d) = ad / bc</code><br>
<code>yi = log(OR)</code>,&ensp;
<code>vi = 1/a + 1/b + 1/c + 1/d</code></p>
<p><strong>When to use:</strong> Case-control studies where RR cannot be
estimated; when rare events make OR ≈ RR.</p>
<p><strong>When to avoid:</strong> When event rates are common (&gt;10%), OR
overestimates the relative risk. Prefer RR for prospective/experimental
studies.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-rr",
        title: "Risk Ratio / Relative Risk (RR)",
        body: `<p>Ratio of event proportions between groups. More directly interpretable than
the OR but requires prospective or experimental data where both groups are
followed forward in time.</p>
<p><strong>Formula:</strong><br>
<code>RR = (a/(a+b)) / (c/(c+d))</code><br>
<code>yi = log(RR)</code>,&ensp;
<code>vi = 1/a − 1/(a+b) + 1/c − 1/(c+d)</code></p>
<p><strong>When to use:</strong> Prospective or experimental studies where
absolute event rates are meaningful and common events make OR inappropriate.</p>
<p><strong>When to avoid:</strong> Retrospective case-control studies where
the sampling is conditioned on outcome status.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-rd",
        title: "Risk Difference (RD)",
        body: `<p>Absolute difference in event proportions (p₁ − p₂) from a 2×2 table.
The most clinically interpretable binary measure: the number needed to treat
(NNT) is 1 / |RD|.</p>
<p><strong>Formula:</strong><br>
<code>RD = a/(a+b) − c/(c+d)</code><br>
<code>vi = p₁(1−p₁)/(a+b) + p₂(1−p₂)/(c+d)</code></p>
<p><strong>When to use:</strong> When absolute risk differences are the
clinically relevant quantity (e.g. NNT calculations in systematic reviews
informing clinical guidelines).</p>
<p><strong>When to avoid:</strong> When baseline risk varies widely across
studies — RD is constrained by baseline risk and tends to show greater
heterogeneity than ratio measures.</p>`,
        citations: [
          "Sterne, J. A. C., & Egger, M. (2001). Funnel plots for detecting bias in meta-analysis. <em>Journal of Clinical Epidemiology, 54</em>(10), 1046–1055.",
        ],
      },

      {
        id: "guide-as",
        title: "Arcsine-transformed Risk Difference (AS)",
        body: `<p>A variance-stabilising transformation of the risk difference that makes
the sampling variance approximately constant across the full range of event
rates.</p>

<h4>Formula</h4>
<p>For a 2×2 table with cells a (events, group 1), b (non-events, group 1),
c (events, group 2), d (non-events, group 2):</p>
<pre>  p₁ = a / (a+b),  n₁ = a + b
  p₂ = c / (c+d),  n₂ = c + d

  yi = arcsin(√p₁) − arcsin(√p₂)
  vi = 1/(4·n₁) + 1/(4·n₂)</pre>
<p>Note: this is the single-angle version (metafor <code>escalc("AS")</code>). Some
textbooks define the transformation as <code>2·arcsin(√p)</code> with
variance 1/n; both are equivalent up to a scaling factor of 2.</p>

<h4>Why use the arcsine transformation?</h4>
<p>The variance of a raw proportion p depends on the true event rate:
var(p̂) = p(1−p)/n. Near 0 or 1 this approaches 0, making standard
inverse-variance weighting unstable. The arcsine transformation is the
variance-stabilising transformation for a binomial proportion: var(arcsin(√p̂)) ≈ 1/(4n),
which is independent of p.</p>

<h4>When to use</h4>
<ul>
  <li>Event rates vary widely across studies (some near 0 or 1) where the
  delta-method approximation for RD breaks down.</li>
  <li>You want a transformation with approximately equal variance regardless
  of baseline risk.</li>
</ul>

<h4>When to avoid</h4>
<ul>
  <li>Results are difficult to communicate to clinical audiences — the arcsine
  scale has no direct clinical interpretation.</li>
  <li>Studies have very low event rates (&lt; 1%) or zero cells; the
  Freeman-Tukey double-arcsine (PFT) may be preferred for single proportions
  in that setting.</li>
  <li>All event rates are moderate (10%–90%) and far from boundary — in that
  range the variance-stabilisation advantage is minimal and plain RD is
  preferable.</li>
</ul>

<h4>Back-transformation</h4>
<p>No simple closed-form back-transform exists for the difference of two
arcsine values. If clinical interpretation requires a risk difference, pooled
results are often converted approximately using
<code>sin²(μ̂_AS + arcsin(√p_ref)) − p_ref</code> for a specified reference
risk p_ref, but this depends on the choice of reference and should be
interpreted cautiously.</p>`,
        citations: [
          "Freeman, M. F., & Tukey, J. W. (1950). Transformations related to the angular and the square root. <em>Annals of Mathematical Statistics, 21</em>(4), 607–611.",
          "Viechtbauer, W. (2010). Conducting meta-analyses in R with the metafor package. <em>Journal of Statistical Software, 36</em>(3), 1–48.",
        ],
      },

      {
        id: "guide-hr",
        title: "Hazard Ratio (HR)",
        body: `<p>Ratio of instantaneous event rates between groups, typically from a Cox
proportional-hazards model. Requires the log HR and its 95% CI directly —
no 2×2 table is needed.</p>
<p><strong>Input:</strong> log(HR), CI lower, CI upper<br>
<code>vi = ((log(CI_hi) − log(CI_lo)) / (2·z*)²)</code> where z* = 1.96.</p>
<p><strong>When to use:</strong> Studies report time-to-event outcomes with
Cox model results. HR is the natural effect measure for survival data.</p>
<p><strong>When to avoid:</strong> When the proportional hazards assumption is
violated; the HR then averages over time and may be misleading.</p>`,
        citations: [
          "Tierney, J. F., Stewart, L. A., Ghersi, D., Burdett, S., & Sydes, M. R. (2007). Practical methods for incorporating summary time-to-event data into meta-analysis. <em>Trials, 8</em>, 16.",
        ],
      },

      {
        id: "guide-irr",
        title: "Incidence Rate Ratio (IRR)",
        body: `<p>Ratio of event counts per unit of person-time between two groups.
Assumes events follow a Poisson process.</p>
<p><strong>Formula:</strong><br>
<code>IRR = (x₁/t₁) / (x₂/t₂)</code><br>
<code>yi = log(IRR)</code>,&ensp;
<code>vi = 1/x₁ + 1/x₂</code></p>
<p><strong>When to use:</strong> Rates expressed as events per person-year or
per 1000 person-hours where person-time denominators differ across studies.</p>
<p><strong>When to avoid:</strong> When the Poisson assumption is violated by
overdispersion; consider negative-binomial models in that case.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-ir",
        title: "Incidence Rate — log (IR)",
        body: `<p>Single-group incidence rate modelled on the log scale.
Use for single-arm studies or prevalence estimates expressed as rates.</p>
<p><strong>Formula:</strong><br>
<code>yi = log(x/t)</code>,&ensp;
<code>vi = 1/x</code></p>
<p><strong>When to use:</strong> Single-arm designs with event count and
person-time denominator.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-mn",
        title: "Mean — raw (MN)",
        body: `<p>Synthesises the raw sample mean across single-arm studies on the original
scale. No back-transformation is applied.</p>
<p><strong>Formula:</strong><br>
<code>yi = m̄</code>,&ensp;<code>vi = s²/n</code></p>
<p><strong>When to use:</strong> Single-arm studies where the mean is the
quantity of interest and the sampling distribution is approximately normal.</p>
<p><strong>When to avoid:</strong> When means are strictly positive and
right-skewed — consider MNLN for better behaviour.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-mnln",
        title: "Mean — log-transformed (MNLN)",
        body: `<p>Synthesises the log-transformed sample mean across single-arm studies.
Pooled estimate back-transforms to the original mean scale via exp().
Preferable over MN when means span orders of magnitude or are right-skewed.</p>
<p><strong>Formula:</strong><br>
<code>yi = log(m̄)</code>,&ensp;
<code>vi = s²/(n·m̄²)</code> (delta method)</p>
<p><strong>When to use:</strong> Right-skewed positive outcomes (e.g. cytokine
concentrations, enzyme activity) measured in single-arm studies.</p>
<p><strong>When to avoid:</strong> When the coefficient of variation (s/m̄)
exceeds 0.5, the delta-method approximation is less accurate.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-ucor",
        title: "Bias-corrected correlation (UCOR)",
        body: `<p>The Pearson correlation r is a biased estimator of the true population
correlation ρ, with expected value E[r] &lt; ρ for small samples. UCOR applies
the exact Olkin-Pratt (1958) correction to remove this bias.</p>

<h4>Formula</h4>
<pre>  yi = r · ₂F₁(1/2, 1/2; (n−2)/2; 1−r²)
  vi = (1 − yi²)² / (n − 1)</pre>
<p>where ₂F₁ is the Gauss hypergeometric function. The variance is computed
from the bias-corrected r (yi), not the raw r. Requires n ≥ 4.</p>

<h4>How large is the bias?</h4>
<p>The first-order approximation of the correction is
<code>r_uc ≈ r · [1 + (1−r²) / (2(n−3))]</code>.
For large n (≥ 50) and moderate |r| (0.2–0.7) the correction is typically
&lt; 0.01; it becomes more important for small n or extreme ρ.</p>

<h4>When to use</h4>
<ul>
  <li>Small-sample studies (n &lt; 30) where bias in r is non-trivial.</li>
  <li>Sensitivity analysis alongside COR or ZCOR.</li>
</ul>

<h4>When to avoid</h4>
<ul>
  <li>When Fisher's z (ZCOR) is adequate — ZCOR is the standard for pooling
  correlations and implicitly reduces bias through the z-scale variance
  stabilisation. UCOR is appropriate when you specifically want results on
  the r scale with bias correction.</li>
  <li>Very large studies (n ≥ 200) where the correction is negligible.</li>
</ul>

<h4>Verification</h4>
<p>Per-study yi and vi match metafor <code>escalc("UCOR")</code> to 6 decimal
places (requires the gsl package in R). The exact hypergeometric series
converges to machine precision for all valid |r| &gt; 0.</p>`,
        citations: [
          "Olkin, I., & Pratt, J. W. (1958). Unbiased estimation of certain correlation coefficients. <em>Annals of Mathematical Statistics, 29</em>(1), 201–211.",
          "Viechtbauer, W. (2010). Conducting meta-analyses in R with the metafor package. <em>Journal of Statistical Software, 36</em>(3), 1–48.",
        ],
      },

      {
        id: "guide-zcor",
        title: "Correlation — Fisher's z (ZCOR)",
        body: `<p>Pearson r after Fisher's r-to-z transformation. The variance
1/(n−3) is nearly independent of the true ρ, making this the preferred
approach for pooling correlations. Results are back-transformed to r.</p>
<p><strong>Formula:</strong><br>
<code>yi = 0.5 · ln[(1+r)/(1−r)]</code>,&ensp;
<code>vi = 1/(n−3)</code></p>
<p><strong>When to use:</strong> Pooling Pearson correlations across studies.
Prefer ZCOR over raw COR in almost all situations.</p>
<p><strong>When to avoid:</strong> When r values are very small (&lt;0.1), raw
COR and ZCOR are nearly identical; either is acceptable.</p>`,
        citations: [
          "Fisher, R. A. (1921). On the probable error of a coefficient of correlation deduced from a small sample. <em>Metron, 1</em>, 3–32.",
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-proportions",
        title: "Proportion measures (PR, PLN, PLO, PAS, PFT)",
        body: `<p>Five transformations are available for single-group event proportions:</p>
<ul>
  <li><strong>PR</strong> — raw (0–1) scale; simple but variance depends on p,
  causing problems near 0 or 1.</li>
  <li><strong>PLN</strong> — log transformation; undefined when p = 0.</li>
  <li><strong>PLO</strong> — logit (log-odds); undefined at p = 0 or p = 1;
  most widely used.</li>
  <li><strong>PAS</strong> — arcsine √p; variance-stabilising across a wide
  range of p.</li>
  <li><strong>PFT</strong> — Freeman-Tukey double arcsine; best variance
  stabilisation near 0 and 1; back-transformation uses harmonic mean of n.</li>
</ul>
<p><strong>When to use:</strong> PLO is the standard choice. Use PFT for very
rare (&lt;1%) or very common (&gt;99%) events where PLO boundary issues arise.</p>`,
        citations: [
          "Freeman, M. F., & Tukey, J. W. (1950). Transformations related to the angular and the square root. <em>Annals of Mathematical Statistics, 21</em>(4), 607–611.",
          "Barendregt, J. J., Doi, S. A., Lee, Y. Y., Norman, R. E., & Vos, T. (2013). Meta-analysis of prevalence. <em>Journal of Epidemiology and Community Health, 67</em>(11), 974–978.",
        ],
      },

      {
        id: "guide-generic",
        title: "Generic effect size (yi / vi)",
        body: `<p>Accepts any pre-computed effect size yi and its variance vi directly.
No transformation is applied — pooling proceeds on the scale supplied.</p>
<p><strong>When to use:</strong> Your effect measure is not listed above, or
you have already computed the estimates (e.g. from specialised software such
as Comprehensive Meta-Analysis or R's metafor).</p>
<p><strong>When to avoid:</strong> When a dedicated effect-size type is
available — using a specific type enables correct variance estimation and
appropriate back-transformation.</p>`,
        citations: [],
      },
    ],
  },

  // ------------------------------------------------------------------ //
  // Heterogeneity                                                        //
  // ------------------------------------------------------------------ //
  {
    id: "heterogeneity",
    heading: "Heterogeneity",
    topics: [

      {
        id: "guide-het-overview",
        title: "Fixed-effects vs random-effects models",
        body: `<p>The <strong>fixed-effects</strong> (FE) model assumes all studies estimate
the same underlying true effect μ; differences between study estimates
are due solely to sampling error. The pooled estimate is the
precision-weighted mean.</p>
<p>The <strong>random-effects</strong> (RE) model assumes each study estimates
its own true effect θᵢ, drawn from a distribution with mean μ and
variance τ². The pooled estimate is the weighted average of the θᵢ
distribution's mean. This model is appropriate when studies differ in
populations, interventions, or outcome measurement.</p>
<p>In practice, the RE model is recommended for most meta-analyses in the
social and health sciences because true-effect heterogeneity is the norm
rather than the exception (Higgins et al. 2009).</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2010). A basic introduction to fixed-effect and random-effects models for meta-analysis. <em>Research Synthesis Methods, 1</em>(2), 97–111.",
          "Higgins, J. P. T., Thompson, S. G., & Spiegelhalter, D. J. (2009). A re-evaluation of random-effects meta-analysis. <em>Journal of the Royal Statistical Society A, 172</em>(1), 137–159.",
        ],
      },

      {
        id: "guide-cochran-q",
        title: "Cochran's Q",
        body: `<p>Weighted sum of squared deviations of individual study estimates from the
pooled mean. Under the null of homogeneity it follows a χ² distribution
with k − 1 degrees of freedom.</p>
<p><strong>Formula:</strong><br>
<code>Q = Σ wᵢ(yᵢ − ȳ)²</code> where <code>wᵢ = 1/vᵢ</code></p>
<p><strong>Interpretation:</strong> A significant Q (p &lt; .05) suggests
heterogeneity exceeding sampling error. However, Q has low power when k is
small (many true heterogeneous meta-analyses will not reach significance)
and is almost always significant for large k even when heterogeneity is
practically trivial. Use Q in conjunction with I² and τ².</p>`,
        citations: [
          "Cochran, W. G. (1954). The combination of estimates from different experiments. <em>Biometrics, 10</em>(1), 101–129.",
        ],
      },

      {
        id: "guide-i2",
        title: "I²",
        body: `<p>Proportion of total variance attributable to between-study heterogeneity
rather than sampling error.</p>
<p><strong>Formula:</strong><br>
<code>I² = (Q − df) / Q</code> (clamped to 0 if negative)</p>
<p><strong>Interpretation:</strong> Common benchmarks are 25% (low), 50%
(moderate), and 75% (high) — but these should not be applied mechanically.
I² depends on within-study precision: a meta-analysis of very large, precise
studies can show high I² even when τ² is small. τ² is more informative for
comparing heterogeneity across meta-analyses on the same scale.</p>`,
        citations: [
          "Higgins, J. P. T., & Thompson, S. G. (2002). Quantifying heterogeneity in a meta-analysis. <em>Statistics in Medicine, 21</em>(11), 1539–1558.",
          "Borenstein, M., Higgins, J. P. T., Hedges, L. V., & Rothstein, H. R. (2017). Basics of meta-analysis: I² is not an absolute measure of heterogeneity. <em>Research Synthesis Methods, 8</em>(1), 5–18.",
        ],
      },

      {
        id: "guide-tau2",
        title: "τ² (tau-squared)",
        body: `<p>The estimated between-study variance on the effect-size scale.
Unlike I², τ² does not depend on the average within-study precision,
making it more useful for comparisons across meta-analyses on the same
scale.</p>
<p>√τ² (tau) can be interpreted directly: ≈68% of true study effects lie
within μ ± τ (assuming normality), and it is used to construct the
prediction interval.</p>
<p>A τ of 0.2 for SMD data, for example, means that two-thirds of true
effects in the population lie within 0.2 SMD units of the pooled mean.</p>
<p>A profile likelihood plot for τ² — showing the full likelihood surface and
an LRT-based 95% CI — is available under <strong>Heterogeneity
Diagnostics</strong> when the τ² estimator is ML or REML. This CI differs
from the Q-profile CI shown in the summary table, which is moment-based; see
<a href="#guide-profile-lik-tau2">Profile likelihood for τ²</a> for
details.</p>`,
        citations: [
          "Viechtbauer, W. (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. <em>Journal of Educational and Behavioral Statistics, 30</em>(3), 261–293.",
        ],
      },

      {
        id: "guide-prediction-interval",
        title: "Prediction interval",
        body: `<p>Estimates the range within which the true effect of a new, comparable study
would fall with 95% probability. Unlike the confidence interval (uncertainty
about the pooled mean), the prediction interval also accounts for τ² and
therefore widens as studies differ more from one another.</p>
<p><strong>Formula (Higgins et al. 2009):</strong><br>
<code>PI = μ̂ ± t* · √(SE_RE² + τ̂²)</code><br>
where t* is the critical value from t(k − 2) and SE_RE is the base
random-effects standard error.</p>
<p>Requires k ≥ 3. If the PI includes the null value even when the CI does
not, this is an important signal that the evidence base is heterogeneous and
the effect may not replicate in all settings.</p>`,
        citations: [
          "Higgins, J. P. T., Thompson, S. G., & Spiegelhalter, D. J. (2009). A re-evaluation of random-effects meta-analysis. <em>Journal of the Royal Statistical Society A, 172</em>(1), 137–159.",
          "IntHout, J., Ioannidis, J. P. A., Rovers, M. M., & Goeman, J. J. (2016). Plea for routinely presenting prediction intervals in meta-analysis. <em>BMJ Open, 6</em>, e010247.",
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ //
  // τ² Estimators                                                        //
  // ------------------------------------------------------------------ //
  {
    id: "tau-estimators",
    heading: "τ² Estimators",
    topics: [

      {
        id: "guide-tau-overview",
        title: "Choosing a τ² estimator",
        body: `<p>Several methods exist to estimate the between-study variance τ².
The choice matters most when k is small (&lt;20 studies) — with large k,
most estimators converge to similar values.</p>
<ul>
  <li><strong>REML</strong> is the current methodological recommendation for
  general use (Veroniki et al. 2016). Pair with Knapp-Hartung CIs.</li>
  <li><strong>DL</strong> is fast and simple but tends to underestimate τ²
  when k is small, inflating Type I error.</li>
  <li><strong>PM (Paule-Mandel)</strong> performs well with small k and is
  robust to non-normality.</li>
  <li><strong>ML</strong> is downward-biased for τ² and is rarely preferred
  over REML.</li>
  <li><strong>SJ, HS, HE, GENQ, SQGENQ, DLIT, HSk, EBLUP</strong> are
  available for sensitivity analysis and specialist applications.</li>
</ul>
<p>Use the Sensitivity → τ² estimator comparison table to inspect how
sensitive the pooled estimate is to estimator choice.</p>`,
        citations: [
          "Veroniki, A. A., Jackson, D., Viechtbauer, W., Bender, R., Bowden, J., Knapp, G., Kuss, O., Higgins, J. P. T., Langan, D., & Salanti, G. (2016). Methods to estimate the between-study variance and its uncertainty in meta-analysis. <em>Research Synthesis Methods, 7</em>(1), 55–79.",
        ],
      },

      {
        id: "guide-reml",
        title: "Restricted Maximum Likelihood (REML)",
        body: `<p>An iterative estimator that maximises the restricted likelihood, accounting
for uncertainty in estimating the pooled mean. Generally outperforms DL in
simulation studies and is the current methodological recommendation.</p>
<p><strong>Key property:</strong> REML is unbiased for τ² because it
conditions out the fixed effects before estimation (hence "restricted"),
unlike ML which treats the fixed effects as known.</p>
<p>Pair with Knapp-Hartung CIs for small k to obtain well-calibrated
confidence intervals.</p>`,
        citations: [
          "Harville, D. A. (1977). Maximum likelihood approaches to variance component estimation and to related problems. <em>Journal of the American Statistical Association, 72</em>(358), 320–338.",
          "Veroniki, A. A., et al. (2016). Methods to estimate the between-study variance. <em>Research Synthesis Methods, 7</em>(1), 55–79.",
        ],
      },

      {
        id: "guide-dl",
        title: "DerSimonian-Laird (DL)",
        body: `<p>A closed-form moment estimator based on Cochran's Q statistic.
The most widely used estimator in published meta-analyses due to its
simplicity and speed.</p>
<p><strong>Formula:</strong><br>
<code>τ̂² = max(0, (Q − (k−1)) / (Σwᵢ − Σwᵢ²/Σwᵢ))</code></p>
<p><strong>Limitation:</strong> Tends to underestimate τ² when k is small,
which can inflate the Type I error of the pooled estimate. REML or PM is
preferred when k &lt; 20.</p>`,
        citations: [
          "DerSimonian, R., & Laird, N. (1986). Meta-analysis in clinical trials. <em>Controlled Clinical Trials, 7</em>(3), 177–188.",
        ],
      },

      {
        id: "guide-pm",
        title: "Paule-Mandel (PM)",
        body: `<p>An iterative moment estimator that solves for τ² such that the expected Q
equals its degrees of freedom. Performs well when k is small and the
normality assumption may not hold.</p>
<p>A good alternative to REML when model assumptions are uncertain or when
the data contain outliers that inflate Q.</p>`,
        citations: [
          "Paule, R. C., & Mandel, J. (1982). Consensus values and weighting factors. <em>Journal of Research of the National Bureau of Standards, 87</em>(5), 377–385.",
          "Veroniki, A. A., et al. (2016). Methods to estimate the between-study variance. <em>Research Synthesis Methods, 7</em>(1), 55–79.",
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ //
  // Pooling Methods                                                      //
  // ------------------------------------------------------------------ //
  {
    id: "pooling-methods",
    heading: "Pooling Methods",
    topics: [

      {
        id: "guide-mantel-haenszel",
        title: "Mantel-Haenszel and Peto pooling",
        body: `<p>For 2×2 binary data (OR, RR, RD) the Mantel-Haenszel (M-H) and Peto methods
are fixed-effects estimators that pool raw cell counts directly, without
first converting each study to a log-scale effect size. They are standard
in clinical and epidemiological meta-analysis and are routinely required
by medical journal reviewers.</p>

<p><strong>Key properties shared by both methods:</strong></p>
<ul>
  <li>Fixed-effects only — no between-study variance τ² is estimated.</li>
  <li>Operate on raw 2×2 cell counts (a, b, c, d) rather than on
      per-study log-OR / log-RR / RD.</li>
  <li>Handle single-zero cells without a continuity correction, unlike
      the standard log-scale profiles which add 0.5 to every cell.</li>
</ul>

<h4>Mantel-Haenszel pooling</h4>
<p>Applicable to OR, RR, and RD. Each study contributes to a weighted
numerator and denominator; the pooled estimate is their ratio (OR, RR)
or weighted average (RD).</p>
<p><strong>MH-OR</strong> (Mantel &amp; Haenszel 1959; variance: Robins et al. 1986):<br>
<code>R_i = a_i d_i / N_i</code>,&ensp;
<code>S_i = b_i c_i / N_i</code><br>
<code>OR_MH = ΣR / ΣS</code></p>
<p><strong>MH-RR</strong> (Greenland &amp; Robins 1985):<br>
<code>R_i = a_i n₂ᵢ / N_i</code>,&ensp;
<code>S_i = c_i n₁ᵢ / N_i</code><br>
<code>RR_MH = ΣR / ΣS</code></p>
<p><strong>MH-RD</strong> (Greenland &amp; Robins 1985; variance: Sato et al. 1989):<br>
<code>w_i = n₁ᵢ n₂ᵢ / N_i</code>,&ensp;
<code>RD_i = a_i/n₁ᵢ − c_i/n₂ᵢ</code><br>
<code>RD_MH = Σ(wᵢ RD_i) / Σwᵢ</code></p>
<p>Heterogeneity Q is computed from inverse-variance weights against the
M-H estimate; I² is derived from Q in the usual way.</p>

<h4>Peto OR</h4>
<p>Applicable to OR only. A one-step estimator based on the difference
between observed and expected cell counts under the null:</p>
<p><code>E_i = n₁ᵢ (a_i+c_i) / N_i</code><br>
<code>V_i = n₁ᵢ n₂ᵢ (a_i+c_i)(b_i+d_i) / [N_i²(N_i−1)]</code><br>
<code>log OR_Peto = Σ(a_i − E_i) / ΣV_i</code></p>
<p>Heterogeneity Q for Peto uses the hypergeometric weights V_i:
<code>Q = Σ(a_i−E_i)²/V_i − (Σ(a_i−E_i))²/ΣV_i</code>.</p>

<h4>When to prefer M-H or Peto over inverse-variance</h4>
<ul>
  <li><strong>Sparse data / rare events:</strong> M-H and Peto avoid the
      finite-sample bias introduced by adding a continuity correction to
      zero cells. Both give valid estimates even when some cells are zero.</li>
  <li><strong>Small number of studies:</strong> M-H weights are less sensitive
      to extreme studies than IV weights when τ² is near zero.</li>
  <li><strong>Peto:</strong> most accurate when events are rare (&lt;10%
      event rate) and arm sizes are balanced. Can be substantially biased
      when events are common (&gt;20%) or arms are very unbalanced (n₁/n₂ &gt; 3);
      in those cases prefer M-H or an IV random-effects model.</li>
  <li><strong>Common events / high τ²:</strong> Inverse-variance random-effects
      models (REML, DL, PM) are more efficient and model genuine
      between-study heterogeneity explicitly.</li>
</ul>

<p>Because M-H and Peto are fixed-effects methods, the results panel
omits the RE estimate, τ², and prediction interval when either is selected.
Sensitivity analyses (leave-one-out, estimator comparison) fall back to
DL inverse-variance weights and are labelled accordingly.</p>

<p><strong>Cochrane Handbook guidance:</strong> For binary outcomes, M-H is
the recommended default pooling method. Peto is reserved for rare-events
settings with balanced arms. Inverse-variance RE models are preferred when
τ² is substantial (I² &gt; 50%) regardless of event rate (Cochrane Handbook
§10.4, §16.3).</p>`,
        citations: [
          "Mantel, N., & Haenszel, W. (1959). Statistical aspects of the analysis of data from retrospective studies of disease. <em>Journal of the National Cancer Institute, 22</em>(4), 719–748.",
          "Greenland, S., & Robins, J. M. (1985). Estimation of a common effect parameter from sparse follow-up data. <em>Biometrics, 41</em>(1), 55–68.",
          "Robins, J. M., Breslow, N., & Greenland, S. (1986). Estimators of the Mantel-Haenszel variance consistent in both sparse data and large-strata limiting models. <em>Biometrics, 42</em>(2), 311–323.",
          "Yusuf, S., Peto, R., Lewis, J., Collins, R., & Sleight, P. (1985). Beta blockade during and after myocardial infarction: An overview of the randomized trials. <em>Progress in Cardiovascular Diseases, 27</em>(5), 335–371.",
          "Sato, T., Greenland, S., & Robins, J. M. (1989). On the variance estimator for the Mantel-Haenszel risk difference. <em>Biometrics, 45</em>(4), 1323–1324.",
          "Higgins, J. P. T., Thomas, J., Chandler, J., Cumpston, M., Li, T., Page, M. J., & Welch, V. A. (Eds.). (2023). <em>Cochrane Handbook for Systematic Reviews of Interventions</em> (version 6.4). Cochrane. §10.4 and §16.3.",
        ],
      },

      {
        id: "guide-cluster-robust",
        title: "Cluster-Robust Standard Errors",
        body: `<p>In education and psychology meta-analyses a single primary study often
contributes <em>multiple</em> effect sizes — for example, several outcomes,
subgroups, or follow-up time points. Treating those rows as independent
inflates the effective sample size and underestimates standard errors, because
within-study estimates share participants and thus share residual error.</p>

<p>The <strong>sandwich (cluster-robust) variance estimator</strong> corrects
for this dependency without requiring a full multivariate model. It replaces
the model-based SE with one that accumulates squared within-cluster weighted
residuals before combining them across clusters. The point estimate (pooled
effect μ̂) is unchanged; only the uncertainty estimate is affected.</p>

<h4>When clustering matters</h4>
<ul>
  <li>A single trial reports outcomes on multiple scales or subgroups and all
      rows appear in the same meta-analysis.</li>
  <li>Multiple papers from the same lab or cohort share participants.</li>
  <li>A dataset is constructed by selecting several contrasts from each study.</li>
</ul>
<p>If every row comes from a genuinely independent study, the cluster column
can be left blank and the usual model-based SE is used.</p>

<h4>How the sandwich estimator works</h4>
<p>Let <em>k</em> rows be grouped into <em>C</em> clusters. For a pooled-estimate
model (intercept only, design matrix <strong>X</strong> = <strong>1</strong><sub>k</sub>):</p>
<ol>
  <li>Fit the RE model as usual with weights w<sub>i</sub> = 1/(v<sub>i</sub> + τ²)
      to obtain μ̂ and residuals ê<sub>i</sub> = y<sub>i</sub> − μ̂.</li>
  <li>For each cluster c, compute the score contribution
      g<sub>c</sub> = Σ<sub>i∈c</sub> w<sub>i</sub> ê<sub>i</sub>.</li>
  <li>Meat: B = Σ<sub>c</sub> g<sub>c</sub>².</li>
  <li>Robust variance: V<sub>rob</sub> = B / W², where W = Σw<sub>i</sub>.</li>
  <li>Apply the CR1 small-sample correction: multiply by C / (C − 1).</li>
</ol>
<p>For meta-regression with a <em>p</em>-column design matrix, the formula
generalises to V<sub>rob</sub> = (X′WX)<sup>−1</sup> B (X′WX)<sup>−1</sup>
with g<sub>c</sub> a <em>p</em>-vector and B = Σ<sub>c</sub> g<sub>c</sub> g<sub>c</sub>′,
multiplied by the CR1 factor C / (C − p).</p>

<h4>Confidence intervals and degrees of freedom</h4>
<p>When the number of clusters C is small the t-distribution is used for the
robust CI with df = C − p degrees of freedom (p = 1 for the pooled estimate,
p = number of regression coefficients for meta-regression). For C ≥ 30 the
standard normal critical value is used instead.</p>
<p><strong>Recommendation:</strong> prefer at least C ≥ 10 clusters. With
fewer clusters the t-correction may still under-cover; consider a sensitivity
analysis using Satterthwaite-corrected df from the
<code>clubSandwich</code> R package.</p>

<h4>All-singletons (HC-robust) case</h4>
<p>If every row has a distinct cluster ID the sandwich reduces to the HC1
heteroscedasticity-robust variance estimator. This is still valid and
slightly larger than the model-based SE when τ² &gt; 0. The results panel
labels this case explicitly as "HC-robust, not cluster-robust."</p>

<h4>Comparison with multivariate meta-analysis</h4>
<p>The sandwich estimator is a <em>marginal</em> correction: it does not model
the within-study covariance structure, so the point estimate is the same as
the standard RE model. Multivariate meta-analysis models the covariance
explicitly and can improve efficiency, but requires knowledge (or estimation)
of the within-study correlation matrix, which is rarely reported. The sandwich
approach requires no additional data and is robust to misspecification of the
covariance structure — a useful default when within-study correlations are
unknown.</p>

<h4>Limitations</h4>
<ul>
  <li>The point estimate μ̂ is unchanged by clustering; only the SE is
      corrected. If the clustering structure also biases the estimate
      (e.g. severe imbalance in cluster sizes), a multivariate model is
      more appropriate.</li>
  <li>With very few clusters (C &lt; 10) the t-correction may not fully
      restore nominal coverage; bootstrap methods or clubSandwich's
      Satterthwaite df are preferable in that regime.</li>
  <li>Not applicable to M-H/Peto methods, which do not use a WLS regression
      model. A note is shown in the results panel when these methods are
      selected alongside a cluster column.</li>
  <li>Bayesian analysis uses the posterior distribution directly and does
      not incorporate the sandwich correction.</li>
</ul>`,
        citations: [
          "Hedges, L. V., Tipton, E., & Johnson, M. C. (2010). Robust variance estimation in meta-regression with dependent effect size estimates. <em>Research Synthesis Methods, 1</em>(1), 39–65.",
          "Tipton, E. (2015). Small sample adjustments for robust variance estimation with meta-regression. <em>Psychological Methods, 20</em>(3), 375–393.",
          "Pustejovsky, J. E. (2022). <em>clubSandwich: Cluster-robust (sandwich) variance estimators with small-sample corrections</em>. R package version 0.5.10. https://CRAN.R-project.org/package=clubSandwich",
          "White, H. (1980). A heteroskedasticity-consistent covariance matrix estimator and a direct test for heteroskedasticity. <em>Econometrica, 48</em>(4), 817–838.",
        ],
      },

      {
        id: "guide-rve",
        title: "RVE (Robust Variance Estimation)",
        body: `<p><strong>Robust Variance Estimation (RVE)</strong> is a stand-alone pooled-effect
estimator for dependent effect sizes, proposed by Hedges, Tipton & Johnson (2010).
Unlike the cluster-robust SE (which post-hoc adjusts the standard error of a
conventional RE estimate), RVE uses a different WLS estimator whose weights are
derived from a working covariance model that explicitly represents the assumed
within-cluster correlation.</p>

<h4>Working covariance model</h4>
<p>For cluster <em>i</em> containing studies <em>j</em>, the working variance-covariance
matrix <strong>V</strong><sub>i</sub> has:</p>
<ul>
  <li>Diagonal: V<sub>i</sub>[j,j] = v<sub>j</sub> (sampling variance of study j)</li>
  <li>Off-diagonal: V<sub>i</sub>[j,k] = ρ · √(v<sub>j</sub> · v<sub>k</sub>)</li>
</ul>
<p>where ρ is the assumed within-cluster correlation (default 0.80, adjustable in
the RVE settings row). This is the <em>correlated effects</em> working model of
Hedges et al. (2010). The estimator is consistent regardless of whether this
model is correctly specified — the sandwich variance corrects for misspecification.</p>

<h4>Point estimator</h4>
<p>The Sherman-Morrison matrix-inversion identity gives a closed-form expression
for V<sub>i</sub><sup>−1</sup>. For cluster <em>i</em> with <em>k</em><sub>i</sub>
studies, define c<sub>i</sub> = (1 − ρ) + ρk<sub>i</sub> and w<sub>j</sub> = 1/v<sub>j</sub>:</p>
<pre>A<sub>i</sub> = (W<sub>i</sub> − ρS<sub>i</sub>²/c<sub>i</sub>) / (1 − ρ)     W<sub>i</sub> = Σw<sub>j</sub>,  S<sub>i</sub> = Σ√w<sub>j</sub>
b<sub>i</sub> = (WY<sub>i</sub> − ρS<sub>i</sub>·SY<sub>i</sub>/c<sub>i</sub>) / (1 − ρ)  WY<sub>i</sub> = Σw<sub>j</sub>y<sub>j</sub>, SY<sub>i</sub> = Σ√w<sub>j</sub>·y<sub>j</sub>
β̂  = Σb<sub>i</sub> / ΣA<sub>i</sub></pre>
<p>For meta-regression with <em>p</em> predictors, A<sub>i</sub> and b<sub>i</sub>
generalise to a p×p matrix and p-vector respectively, solved by matrix inversion.</p>

<h4>Sandwich (CR1) standard error</h4>
<p>The residual score for cluster <em>i</em> is
g<sub>i</sub> = (WXE<sub>i</sub> − ρ · S<sub>i</sub> · SE<sub>i</sub> / c<sub>i</sub>) / (1 − ρ),
where e<sub>j</sub> = y<sub>j</sub> − β̂ are residuals. The CR1 sandwich variance is:</p>
<pre>V̂(β̂) = m/(m−1) · Σg<sub>i</sub>² / (ΣA<sub>i</sub>)²</pre>
<p>df = m − p; a t-distribution with these degrees of freedom is used for the CI.</p>

<h4>Comparison with cluster-robust SE</h4>
<table style="font-size:0.82rem;border-collapse:collapse;margin:8px 0">
  <tr><th style="text-align:left;padding:3px 10px 3px 0;border-bottom:1px solid var(--border)">Feature</th>
      <th style="padding:3px 10px;border-bottom:1px solid var(--border)">Cluster-robust SE</th>
      <th style="padding:3px 10px;border-bottom:1px solid var(--border)">RVE</th></tr>
  <tr><td style="padding:3px 10px 3px 0">Point estimate</td>
      <td style="padding:3px 10px">RE model (τ²-weighted)</td>
      <td style="padding:3px 10px">WLS with ρ-working weights</td></tr>
  <tr><td style="padding:3px 10px 3px 0">SE</td>
      <td style="padding:3px 10px">Post-hoc sandwich on RE</td>
      <td style="padding:3px 10px">Sandwich on RVE estimator</td></tr>
  <tr><td style="padding:3px 10px 3px 0">τ² required?</td>
      <td style="padding:3px 10px">Yes (REML/DL etc.)</td>
      <td style="padding:3px 10px">No</td></tr>
  <tr><td style="padding:3px 10px 3px 0">User parameter</td>
      <td style="padding:3px 10px">τ² method</td>
      <td style="padding:3px 10px">ρ (working correlation)</td></tr>
</table>

<h4>Sensitivity to ρ</h4>
<p>The point estimate and SE both depend on ρ. Hedges et al. (2010) recommend ρ = 0.80
as a conservative default. Run the analysis at several values (e.g. 0.20, 0.50, 0.80)
to assess sensitivity; if conclusions are stable across ρ, the choice is not critical.</p>

<h4>Meta-regression with RVE</h4>
<p>When moderator columns are present, RVE extends to meta-regression: the design
matrix X includes an intercept and all active moderators, and df = m − p where
p is the total number of coefficients. The results panel shows per-coefficient
estimates, SEs, t-statistics, and p-values under the RVE model.</p>`,
        citations: [
          "Hedges, L. V., Tipton, E., & Johnson, M. C. (2010). Robust variance estimation in meta-regression with dependent effect size estimates. <em>Research Synthesis Methods, 1</em>(1), 39–65.",
          "Tipton, E. (2015). Small sample adjustments for robust variance estimation with meta-regression. <em>Psychological Methods, 20</em>(3), 375–393.",
        ],
      },

      {
        id: "guide-three-level",
        title: "Three-Level Meta-Analysis",
        body: `<p>The standard two-level random-effects model assumes all effect sizes are
independent. When a single primary study contributes multiple effect sizes
(e.g. several outcomes, time points, or subgroups), this assumption is violated
and estimates of heterogeneity can be inflated. <strong>Three-level meta-analysis</strong>
extends the model with an explicit variance component for within-study clustering,
separating heterogeneity into two sources.</p>

<h4>The three-level model</h4>
<p>Let <em>y</em><sub>ij</sub> denote the <em>j</em>-th observed effect in cluster
(study) <em>i</em>, and let <em>v</em><sub>ij</sub> be its known sampling variance.
The model is:</p>
<pre>y<sub>ij</sub> = μ + u<sub>i</sub> + e<sub>ij</sub> + ε<sub>ij</sub></pre>
<ul>
  <li><strong>μ</strong> — overall mean (the pooled estimate)</li>
  <li><strong>u<sub>i</sub></strong> ~ N(0, σ²<sub>between</sub>) — cluster-level random effect
      (level-3 variance: how much cluster means vary)</li>
  <li><strong>e<sub>ij</sub></strong> ~ N(0, σ²<sub>within</sub>) — within-cluster random effect
      (level-2 variance: how much true effects vary within a cluster)</li>
  <li><strong>ε<sub>ij</sub></strong> ~ N(0, v<sub>ij</sub>) — sampling error (known)</li>
</ul>
<p>The marginal covariance matrix for cluster <em>i</em> with
<em>k</em><sub>i</sub> studies is:</p>
<pre>Σ<sub>i</sub> = diag(v<sub>ij</sub> + σ²<sub>within</sub>) + σ²<sub>between</sub> · 1·1ᵀ</pre>
<p>This is a diagonal matrix plus a rank-1 update. The Sherman-Morrison identity
gives a closed-form inverse, so no matrix operations are required.</p>

<h4>Estimation (REML)</h4>
<p>Both variance components (σ²<sub>within</sub>, σ²<sub>between</sub>) are
estimated simultaneously by Restricted Maximum Likelihood (REML). The pooled
mean μ is concentrated out analytically (REML concentrated likelihood), reducing
optimisation to a 2-dimensional problem over (log σ²<sub>within</sub>,
log σ²<sub>between</sub>). BFGS is used for optimisation.</p>
<p>The pooled estimate μ̂ and its standard error then follow from the
estimated components, and inference uses a standard normal (z) distribution.</p>

<h4>Variance components and decomposed I²</h4>
<p>Using a typical sampling variance v* = 1 / Σ(1/v<sub>ij</sub>):</p>
<pre>I²<sub>within</sub>  = 100 · σ²<sub>within</sub>  / (σ²<sub>within</sub> + σ²<sub>between</sub> + v*)
I²<sub>between</sub> = 100 · σ²<sub>between</sub> / (σ²<sub>within</sub> + σ²<sub>between</sub> + v*)</pre>
<p>The remainder (100 − I²<sub>within</sub> − I²<sub>between</sub>) reflects
sampling error. A dominant I²<sub>between</sub> means cluster-mean differences
drive most heterogeneity; a dominant I²<sub>within</sub> means heterogeneity
is mainly within clusters.</p>

<h4>When to use three-level vs two-level</h4>
<table style="font-size:0.82rem;border-collapse:collapse;margin:8px 0">
  <tr><th style="text-align:left;padding:3px 10px 3px 0;border-bottom:1px solid var(--border)">Situation</th>
      <th style="padding:3px 10px;border-bottom:1px solid var(--border)">Recommended model</th></tr>
  <tr><td style="padding:3px 10px 3px 0">All effect sizes from independent studies</td>
      <td style="padding:3px 10px">Two-level RE (standard)</td></tr>
  <tr><td style="padding:3px 10px 3px 0">Multiple outcomes / time points per study; within-study correlation unknown</td>
      <td style="padding:3px 10px">Three-level or RVE</td></tr>
  <tr><td style="padding:3px 10px 3px 0">Multiple outcomes; within-study correlation known or estimable</td>
      <td style="padding:3px 10px">Multivariate meta-analysis</td></tr>
  <tr><td style="padding:3px 10px 3px 0">Correcting standard error only; point estimate unchanged</td>
      <td style="padding:3px 10px">Cluster-robust SE</td></tr>
</table>
<p>Three-level and RVE both handle dependent effects without requiring knowledge
of within-study correlations. Three-level explicitly models variance structure and
decomposes heterogeneity; RVE uses a working covariance and a sandwich SE, and can
accommodate meta-regression. Use three-level when the decomposition of I² is of
substantive interest.</p>

<h4>How to specify clusters</h4>
<p>Enter a <strong>Cluster ID</strong> for each study row in the input table.
Studies sharing the same non-blank Cluster ID are grouped into one cluster.
Studies with blank Cluster IDs are treated as singletons (their own cluster).
At least 3 studies in at least 2 clusters are required.</p>
<p>The Three-Level section appears automatically in the Results panel when any
study has a non-blank Cluster ID and the pooling method is not M-H/Peto.</p>

<h4>Limitations</h4>
<ul>
  <li>Inference is based on the z-distribution; with few clusters (&lt; 10)
      the t-distribution (as in RVE) may provide better small-sample coverage.</li>
  <li>The model assumes equal within-cluster variance across all clusters
      (homogeneous σ²<sub>within</sub>). Cluster-specific variances are not
      estimated.</li>
  <li>Not applicable to M-H/Peto pooling methods.</li>
</ul>`,
        citations: [
          "Van den Noortgate, W., López-López, J. A., Marín-Martínez, F., & Sánchez-Meca, J. (2013). Three-level meta-analysis of dependent effect sizes. <em>Behavior Research Methods, 45</em>(2), 576–594.",
          "Cheung, M. W.-L. (2014). Modeling dependent effect sizes with three-level meta-analyses: A structural equation modeling approach. <em>Psychological Methods, 19</em>(2), 211–229.",
          "Konstantopoulos, S. (2011). Fixed effects and variance components estimation in three-level meta-analysis. <em>Research Synthesis Methods, 2</em>(1), 61–76.",
          "Viechtbauer, W. (2010). Conducting meta-analyses in R with the metafor package. <em>Journal of Statistical Software, 36</em>(3), 1–48.",
        ],
      },

    ],
  },

  // ------------------------------------------------------------------ //
  // CI Methods                                                           //
  // ------------------------------------------------------------------ //
  {
    id: "ci-methods",
    heading: "Confidence Interval Methods",
    topics: [

      {
        id: "guide-ci-normal",
        title: "Normal (Wald) CI",
        body: `<p>Computes the confidence interval as estimate ± z* × SE, where z* is the
standard normal critical value (1.96 for 95% CI). Assumes the pooled
estimate is approximately normally distributed.</p>
<p><strong>Formula:</strong><br>
<code>CI = μ̂ ± 1.96 · SE</code></p>
<p>Valid for large k; can be anti-conservative (too narrow) when k is small
because uncertainty in τ² is not fully reflected.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-ci-kh",
        title: "Knapp-Hartung (KH) CI",
        body: `<p>Replaces the standard normal critical value with a t critical value
(df = k − 1) and rescales the standard error using the mean squared error
of the weighted regression. Produces wider, better-calibrated intervals
when k is small.</p>
<p><strong>Recommendation:</strong> Use KH when using REML and k &lt; 40.
Simulations consistently show better nominal coverage than the Normal CI
for small k.</p>`,
        citations: [
          "Knapp, G., & Hartung, J. (2003). Improved tests for a random effects meta-regression with a single covariate. <em>Statistics in Medicine, 22</em>(17), 2693–2710.",
          "IntHout, J., Ioannidis, J. P. A., & Borm, G. F. (2014). The Hartung-Knapp-Sidik-Jonkman method for random effects meta-analysis is straightforward and considerably outperforms the standard DerSimonian-Laird method. <em>BMC Medical Research Methodology, 14</em>, 25.",
        ],
      },

      {
        id: "guide-ci-t",
        title: "t-distribution CI",
        body: `<p>Uses a t-distribution with k − 1 degrees of freedom for the critical value
without the Knapp-Hartung SE rescaling. An intermediate option between
Normal and full KH adjustment.</p>
<p>Produces wider intervals than Normal CI but narrower than KH.
Can be useful when you want to account for small-k degrees of freedom
without applying the full KH correction.</p>`,
        citations: [
          "Borenstein, M., Hedges, L. V., Higgins, J. P. T., & Rothstein, H. R. (2009). <em>Introduction to meta-analysis</em>. Wiley.",
        ],
      },

      {
        id: "guide-ci-pl",
        title: "Profile Likelihood CI",
        body: `<p>Inverts the likelihood ratio test to find the set of μ values not rejected
at the 5% level. Produces asymmetric CIs that are better calibrated than
Wald CIs when k is small.</p>
<p><strong>Formula:</strong><br>
<code>{ μ : 2[L(μ̂, τ̂²) − L_p(μ)] ≤ 3.84 }</code><br>
where L_p(μ) is maximised over τ² for each fixed μ. Always uses ML
internally regardless of the selected τ² estimator.</p>
<p>Computationally more demanding but theoretically well-justified.
Appropriate when k is small and asymmetric evidence is expected.</p>`,
        citations: [
          "Hardy, R. J., & Thompson, S. G. (1996). A likelihood approach to meta-analysis with random effects. <em>Statistics in Medicine, 15</em>(6), 619–629.",
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ //
  // Publication Bias                                                     //
  // ------------------------------------------------------------------ //
  {
    id: "pub-bias",
    heading: "Publication Bias",
    topics: [

      {
        id: "guide-funnel",
        title: "Funnel plot",
        body: `<p>A scatter plot of each study's effect size (x-axis) against a measure of
its precision (y-axis, typically SE or 1/SE). In the absence of bias,
studies should scatter symmetrically around the pooled estimate in an
inverted funnel shape — large, precise studies near the top and small,
imprecise studies forming the wide base.</p>
<p><strong>Interpreting asymmetry:</strong> A missing cluster of small studies
on one side suggests that small negative studies may be unpublished
(publication bias). However, funnel asymmetry can also arise from:</p>
<ul>
  <li>True heterogeneity (larger effects in smaller studies)</li>
  <li>Artefactual correlations between effect size and SE</li>
  <li>Selective reporting within studies</li>
  <li>Chance (especially for k &lt; 10)</li>
</ul>
<p>Formal tests (Egger, Begg, Harbord, Peters) supplement visual inspection.</p>`,
        citations: [
          "Sterne, J. A. C., Sutton, A. J., Ioannidis, J. P. A., Terrin, N., Jones, D. R., Lau, J., Carpenter, J., Rücker, G., Harbord, R. M., Schmid, C. H., Tetzlaff, J., Deeks, J. J., Peters, J., Macaskill, P., Schwarzer, G., Duval, S., Altman, D. G., Moher, D., & Higgins, J. P. T. (2011). Recommendations for examining and interpreting funnel plot asymmetry in meta-analyses of randomised controlled trials. <em>BMJ, 343</em>, d4002.",
        ],
      },

      {
        id: "guide-egger",
        title: "Egger's test",
        body: `<p>Regresses the standardised effect size (yᵢ/SEᵢ) on precision (1/SEᵢ).
A significant non-zero intercept indicates funnel-plot asymmetry.</p>
<p><strong>Formula:</strong><br>
<code>yᵢ/SEᵢ = a + b·(1/SEᵢ) + εᵢ</code><br>
The intercept a is tested against zero with a t-test (df = k − 2).</p>
<p><strong>Limitation:</strong> Has inflated Type I error for ratio measures
(OR, RR) because the effect size and SE share variance components. Use
Harbord's or Peters' test for binary outcomes.</p>
<p>Requires at least 10 studies for adequate power.</p>`,
        citations: [
          "Egger, M., Davey Smith, G., Schneider, M., & Minder, C. (1997). Bias in meta-analysis detected by a simple, graphical test. <em>BMJ, 315</em>(7109), 629–634.",
        ],
      },

      {
        id: "guide-binary-bias",
        title: "Binary-outcome regression tests (Harbord, Peters, Deeks, Rücker)",
        body: `<p>The standard Egger test has inflated Type I error for binary outcomes
(OR, RR) because the effect size and its standard error share variance
components — both depend on the same cell counts. Four specialised alternatives
address this.</p>

<h4>Harbord's test (Harbord et al., 2006)</h4>
<p>Score-based Egger variant for OR studies. For each 2×2 table (a, b, c, d),
computes the expected events E<sub>i</sub> = (a+b)(a+c)/N and the
hypergeometric variance V<sub>i</sub> = (a+b)(c+d)(a+c)(b+d) / (N²(N−1)),
then runs OLS regression:</p>
<p style="margin-left:1em"><code>z<sub>i</sub> = (a − E<sub>i</sub>) / √V<sub>i</sub> = α + β·√V<sub>i</sub> + ε<sub>i</sub></code></p>
<p>H₀: α = 0. A significant non-zero intercept indicates small-study effects.
Requires raw 2×2 cell counts.</p>

<h4>Peters' test (Peters et al., 2006)</h4>
<p>WLS regression of yᵢ on 1/N (inverse total sample size) with weights 1/vᵢ:</p>
<p style="margin-left:1em"><code>yᵢ = α + β·(1/N<sub>i</sub>) + ε<sub>i</sub></code></p>
<p>H₀: α = 0. Works with any effect type where N is available
(from a+b+c+d, n1+n2, or n). Preferred over Egger for OR and RR because
1/N is less correlated with yᵢ than 1/SE.</p>

<h4>Deeks' test (Deeks et al., 2005)</h4>
<p>Funnel-asymmetry test specifically for diagnostic accuracy (DOR) studies.
Uses the effective sample size ESS<sub>i</sub> = 2(a+c)(b+d)/N as the precision
surrogate, then runs weighted regression:</p>
<p style="margin-left:1em"><code>log(DOR<sub>i</sub>) = α + β·(1/√ESS<sub>i</sub>) + ε<sub>i</sub></code></p>
<p>with weights ESS<sub>i</sub>. H₀: α = 0. Requires all 2×2 cells > 0
(zero cells make log DOR undefined). Not appropriate for therapeutic OR/RR.</p>

<h4>Rücker's test (Rücker et al., 2008)</h4>
<p>Arcsine-based Egger variant. Applies the variance-stabilising arcsine
transformation to risk proportions, then runs OLS regression:</p>
<p style="margin-left:1em">
  y<sub>i</sub> = arcsin(√p<sub>1i</sub>) − arcsin(√p<sub>2i</sub>),&nbsp;
  se<sub>i</sub> = √(1/(4n<sub>1i</sub>) + 1/(4n<sub>2i</sub>))<br>
  <code>y<sub>i</sub>/se<sub>i</sub> = α + β·(1/se<sub>i</sub>) + ε<sub>i</sub></code>
</p>
<p>H₀: α = 0. Has better-controlled Type I error than Egger for binary outcomes
because the arcsine risk difference and its SE depend on different aspects
of the data than the log-OR. Requires raw 2×2 counts.</p>

<h4>Choosing a test</h4>
<ul>
  <li><strong>Therapeutic OR/RR studies:</strong> Harbord or Peters (both outperform Egger)</li>
  <li><strong>Diagnostic accuracy (DOR) studies:</strong> Deeks</li>
  <li><strong>General binary outcome, any scale:</strong> Rücker</li>
  <li><strong>Non-binary effect types:</strong> Egger or FAT-PET</li>
</ul>
<p>All tests require k ≥ 3 valid studies with the necessary cell or sample-size
data. The intercept p-value is the primary result; the slope estimates the
underlying effect size under the null of no bias.</p>`,
        citations: [
          "Harbord, R. M., Egger, M., & Sterne, J. A. C. (2006). A modified test for small-study effects in meta-analyses of controlled trials with binary endpoints. <em>Statistics in Medicine, 25</em>(20), 3443–3457.",
          "Peters, J. L., Sutton, A. J., Jones, D. R., Abrams, K. R., & Rushton, L. (2006). Comparison of two methods to detect publication bias in meta-analysis. <em>JAMA, 295</em>(6), 676–680.",
          "Deeks, J. J., Macaskill, P., & Irwig, L. (2005). The performance of tests of publication bias and other sample size effects in systematic reviews of diagnostic test accuracy was assessed. <em>Journal of Clinical Epidemiology, 58</em>(9), 882–893.",
          "Rücker, G., Schwarzer, G., & Carpenter, J. (2008). Arcsine test for publication bias in meta-analyses with binary outcomes. <em>Statistics in Medicine, 27</em>(19), 4450–4465.",
        ],
      },

      {
        id: "guide-begg",
        title: "Begg's test",
        body: `<p>Rank correlation (Kendall's τ) between standardised effect sizes and their
variances. Tests whether small-study effects are correlated with effect
direction.</p>
<p>More conservative than Egger's test (lower power) but less sensitive to
outliers. Also requires at least 10 studies.</p>`,
        citations: [
          "Begg, C. B., & Mazumdar, M. (1994). Operating characteristics of a rank correlation test for publication bias. <em>Biometrics, 50</em>(4), 1088–1101.",
        ],
      },

      {
        id: "guide-trimfill",
        title: "Trim-and-Fill",
        body: `<p>Iteratively removes ('trims') asymmetric outlier studies from the funnel,
estimates the true effect centre, then imputes ('fills') the mirror-image
missing studies. Produces an adjusted pooled estimate.</p>
<p><strong>Algorithm:</strong> The asymmetric side is detected by regressing yi on
√vᵢ (a weighted Egger-type slope). Studies are sorted and k₀ are trimmed from
the larger side each iteration until k₀ stabilises. Filled studies are
mirror-images of the trimmed studies reflected across the converged centre.</p>
<p><strong>Three estimators for k₀</strong> (number of missing studies):</p>
<ul>
  <li><strong>L0</strong> (default) — Rank sum statistic:<br>
  Sᵣ = Σ positive signed ranks; k₀ = (4Sᵣ − k(k+1)) / (2k−1)</li>
  <li><strong>R0</strong> — Run test / gap statistic:<br>
  k₀ = (k − max rank on the smaller side) − 1.<br>
  Conservative: detects asymmetry only when the top ranks are entirely on
  one side with no gaps; often gives the smallest k₀.</li>
  <li><strong>Q0</strong> — Chi-square approximation:<br>
  k₀ = k − ½ − √(2k² − 4Sᵣ + ¼).<br>
  Uses the same Sᵣ as L0 but a different inversion; tends to give larger k₀.</li>
</ul>
<p>L0 and Q0 typically agree when asymmetry is moderate; R0 is more conservative.
All three are cross-validated against <code>metafor::trimfill()</code> 4.8-0.</p>
<p><strong>Important caveat:</strong> Trim-and-fill assumes asymmetry is caused
solely by publication bias. It may over-correct when asymmetry has other
causes (heterogeneous populations, outliers, or between-study design
differences). The adjusted estimate should be treated as a sensitivity
analysis, not as the primary estimate.</p>`,
        citations: [
          "Duval, S., & Tweedie, R. (2000). Trim and fill: A simple funnel-plot-based method of testing and adjusting for publication bias in meta-analysis. <em>Biometrics, 56</em>(2), 455–463.",
          "Duval, S. (2005). The trim and fill method. In H. R. Rothstein, A. J. Sutton, & M. Borenstein (Eds.), <em>Publication Bias in Meta-Analysis: Prevention, Assessment and Adjustments</em>. Wiley.",
        ],
      },

      {
        id: "guide-fatpet",
        title: "FAT-PET Regression",
        body: `<p>The Funnel Asymmetry Test (FAT) regresses the effect size on its standard
error; a significant slope indicates asymmetry. The Precision Effect Test
(PET) intercept estimates the effect corrected for small-study bias.</p>
<p><strong>Formula:</strong><br>
<code>yᵢ = β₀ + β₁·SEᵢ + εᵢ</code> (WLS, weights = 1/vᵢ)<br>
FAT: H₀: β₁ = 0. PET: the intercept β₀ at SEᵢ = 0.</p>
<p>Requires sufficient variation in study precision to be informative.
Closely related to Egger's test but uses unstandardised effect sizes.</p>`,
        citations: [
          "Stanley, T. D., & Doucouliagos, H. (2014). Meta-regression approximations to reduce publication selection bias. <em>Research Synthesis Methods, 5</em>(1), 60–78.",
        ],
      },

      {
        id: "guide-petpeese",
        title: "PET-PEESE",
        body: `<p>PET-PEESE is a two-stage bias-correction procedure. Stage 1 runs FAT-PET
(WLS of effect on SE). If FAT is significant (p &lt; .10), Stage 2 — PEESE —
replaces the predictor with variance (vᵢ):</p>
<p><strong>PEESE formula:</strong><br>
<code>yᵢ = γ₀ + γ₁·vᵢ + εᵢ</code> (WLS, weights = 1/vᵢ)<br>
The intercept γ₀ is the bias-corrected effect at infinite precision (vᵢ → 0).</p>
<p>Regressing on variance rather than SE reduces over-correction in moderately
biased literatures. When FAT is non-significant (usePeese = false), the PET
intercept is reported instead. The funnel plot shows the FAT-PET line (orange)
and PEESE curve (green); the active estimate is highlighted.</p>`,
        citations: [
          "Stanley, T. D., & Doucouliagos, H. (2014). Meta-regression approximations to reduce publication selection bias. <em>Research Synthesis Methods, 5</em>(1), 60–78.",
          "Stanley, T. D. (2008). Meta-regression methods for detecting and estimating empirical effects in the presence of publication selection. <em>Oxford Bulletin of Economics and Statistics, 70</em>(1), 103–127.",
        ],
      },

      {
        id: "guide-fsn",
        title: "Fail-Safe N (Rosenthal)",
        body: `<p>The number of unpublished null-result studies that would be needed to
reduce the pooled p-value to non-significance (p &gt; .05). Rosenthal's
rule of thumb: FSN &gt; 5k + 10 suggests robustness.</p>
<p><strong>Limitation:</strong> Widely criticised for being too lenient —
FSN can be very large even when the evidence base is fragile. Trim-and-fill
and selection models are generally preferred as they also adjust the point
estimate.</p>`,
        citations: [
          "Rosenthal, R. (1979). The file drawer problem and tolerance for null results. <em>Psychological Bulletin, 86</em>(3), 638–641.",
          "Becker, B. J. (2005). Failsafe N or file-drawer number. In H. R. Rothstein, A. J. Sutton, & M. Borenstein (Eds.), <em>Publication bias in meta-analysis</em> (pp. 111–125). Wiley.",
        ],
      },

      {
        id: "guide-tes",
        title: "Test of Excess Significance (TES)",
        body: `<p>Ioannidis &amp; Trikalinos (2007) test whether the number of statistically
significant results observed across studies (O) exceeds the number expected (E)
given the per-study power to detect the pooled effect θ = μ̂<sub>RE</sub>.</p>

<h4>Per-study power</h4>
<p>For each study with standard error SEᵢ, the two-tailed power to detect |θ|
at α = 0.05 is:</p>
<p style="margin-left:1em">
  <code>powerᵢ = Φ(|θ|/SEᵢ − 1.96) + Φ(−1.96 − |θ|/SEᵢ)</code>
</p>
<p>where Φ is the standard normal CDF and 1.96 = Φ⁻¹(0.975).</p>

<h4>Test statistic</h4>
<p>E = Σ powerᵢ (expected significant results). O is counted from the
individual study p-values (two-tailed, α = 0.05).</p>
<p style="margin-left:1em">
  <code>χ² = (O − E)² / [E(1 − E/k)]</code>
</p>
<p>The denominator uses a binomial approximation for the variance of O.
p = 1 − Φ(z), always one-sided (O &gt; E is the direction of excess
significance). When O &lt; E, the test is uninformative and p &gt; 0.50.</p>

<h4>Interpretation</h4>
<ul>
  <li><strong>p &lt; 0.10:</strong> statistically significant excess — a warning
  sign of selective reporting, p-hacking, or inflated individual study estimates.</li>
  <li><strong>O &gt; E:</strong> more significant results than power predicts.</li>
  <li><strong>High power studies:</strong> if E ≈ k, the test has little
  discriminating ability.</li>
</ul>
<p>TES is a complement to funnel-plot methods: it focuses on the count of
significant results rather than effect-size asymmetry. It tends to be sensitive
when individual study samples are small (low power) and false-positivity is
high. Matched against <code>metafor::tes()</code> to ≤ 0.001.</p>`,
        citations: [
          "Ioannidis, J. P. A., & Trikalinos, T. A. (2007). An exploratory test for an excess of significant findings. <em>Clinical Trials, 4</em>(3), 245–253.",
        ],
      },

      {
        id: "guide-pcurve",
        title: "P-curve",
        body: `<p>P-curve (Simonsohn, Nelson &amp; Simmons, 2014) examines the distribution
of statistically significant p-values (p &lt; .05) across studies. When studies
test a true effect, significant p-values should be right-skewed — concentrated
near zero. A flat or left-skewed distribution is consistent with p-hacking or
the absence of a true effect.</p>
<p><strong>What is plotted:</strong> The proportion of significant studies falling
in each 0.01-wide bin (0–.01, .01–.02, …, .04–.05), with two reference lines:</p>
<ul>
  <li><strong>Null line (20%)</strong> — expected proportion under the null
  hypothesis of no true effect (each bin equally likely).</li>
  <li><strong>33%-power line</strong> — expected distribution if studies have 33%
  power, used as the "low evidential value" benchmark.</li>
</ul>
<p><strong>Two formal tests:</strong></p>
<ul>
  <li><strong>Right-skew test</strong> (H₀: no effect) — tests whether p-values
  cluster below their expected midpoint under the null. A significant result
  (p &lt; .05) indicates right-skew and suggests evidential value.</li>
  <li><strong>Flatness test</strong> (H₃₃: ≤33% power) — tests whether the
  distribution is no flatter than expected at 33% power. A significant result
  indicates the evidence base lacks evidential value.</li>
</ul>
<p><strong>Verdict logic:</strong> Evidential (right-skew p &lt; .05); No
evidential value (flatness p &lt; .05); Inconclusive (neither); Insufficient
(fewer than 3 significant studies).</p>
<p><strong>Important limitation:</strong> P-curve uses only significant studies;
studies with p ≥ .05 are excluded. If the literature is severely publication-biased,
the curve may still appear right-skewed even when the effect is inflated. Use
alongside other bias tests rather than in isolation.</p>`,
        citations: [
          "Simonsohn, U., Nelson, L. D., & Simmons, J. P. (2014). P-curve: A key to the file-drawer. <em>Journal of Experimental Psychology: General, 143</em>(2), 534–547.",
          "Simonsohn, U., Simmons, J. P., & Nelson, L. D. (2015). Better p-curves: Making p-curve analysis more robust to errors, fraud, and ambitious p-hacking, a reply to Ulrich and Miller (2015). <em>Journal of Experimental Psychology: General, 144</em>(6), 1146–1152.",
        ],
      },

      {
        id: "guide-puniform",
        title: "P-uniform*",
        body: `<p>P-uniform* (van Assen, van Aert &amp; Wicherts, 2015; van Aert &amp; van
Assen, 2021) estimates a publication-bias-corrected effect size by exploiting
the fact that, conditional on statistical significance, the distribution of
p-value quantiles should be uniform if the assumed effect equals the true
effect.</p>
<p><strong>Key quantities:</strong></p>
<ul>
  <li><strong>Estimate (δ*)</strong> — the effect size at which the mean conditional
  quantile equals 0.5 (solved by bisection). This is the bias-corrected point
  estimate.</li>
  <li><strong>95% CI</strong> — the range of δ for which the sum of conditional
  quantiles falls within the 95% normal interval around k/2.</li>
  <li><strong>Significance test</strong> (H₀: δ = 0) — tests whether the
  quantile distribution is consistent with a true effect of zero. Evidence
  against H₀: left-skewed quantiles at δ = 0.</li>
  <li><strong>Publication-bias test</strong> (H₀: no bias) — tests whether the
  conditional quantiles computed at the RE estimate are uniformly distributed.
  A significant result suggests the RE estimate is inflated by publication
  bias.</li>
</ul>
<p><strong>Comparison with p-curve:</strong> Both methods use only significant
studies and exploit the conditional distribution of p-values. P-uniform* also
produces a corrected point estimate and CI; p-curve only tests for evidential
value. P-uniform* is more sensitive to violations when study precision varies
across studies.</p>
<p><strong>Limitation:</strong> Like p-curve, it assumes publication bias
operates entirely through p-value selection. Requires at least 2 significant
studies.</p>`,
        citations: [
          "van Assen, M. A. L. M., van Aert, R. C. M., & Wicherts, J. M. (2015). Meta-analysis using effect size distributions of only statistically significant studies. <em>Psychological Methods, 20</em>(3), 293–309.",
          "van Aert, R. C. M., & van Assen, M. A. L. M. (2021). Correcting for publication bias in a meta-analysis with the p-uniform* method. <em>Research Synthesis Methods, 14</em>(6), 1–19.",
        ],
      },

      {
        id: "guide-selection-model",
        title: "Selection model (Vevea-Hedges)",
        body: `<p>Selection models (Vevea &amp; Hedges, 1995) directly model the publication
process by assuming studies are selected with probability proportional to a
weight function ω(p) that depends on the study's p-value. Studies in the most
significant interval (p ≤ .025 for one-sided) receive weight ω = 1; less
significant studies receive relative weights ω &lt; 1.</p>
<p><strong>Two modes:</strong></p>
<ul>
  <li><strong>MLE mode</strong> — the ω weights are estimated jointly with μ and
  τ² by maximum likelihood (BFGS optimisation). A likelihood-ratio test (LRT)
  compares the selection model to an unweighted RE model. Requires at least
  k ≥ K + 2 studies, where K = 6 is the number of p-value intervals.</li>
  <li><strong>Sensitivity / fixed-ω mode</strong> — ω is held fixed at a
  pre-specified severity pattern and only μ and τ² are estimated. Follows the
  Vevea &amp; Woods (2005) presets: Mild, Moderate, and Severe (both one-sided
  and two-sided). Requires k ≥ 3.</li>
</ul>
<p><strong>P-value intervals (one-sided):</strong><br>
p ≤ .025, .025–.05, .05–.10, .10–.25, .25–.50, .50–1.0</p>
<p><strong>Interpretation:</strong> A substantially lower μ under the selection
model than in the standard RE model is evidence of publication bias. The LRT
tests whether assuming ω &lt; 1 for non-significant results significantly
improves model fit over the unweighted RE model.</p>
<p><strong>Limitations:</strong> The model assumes the same selection function
operates across all studies and that p-values are the sole driver of publication
decisions. With small k the ω parameters may not be well-identified; the
fixed-ω sensitivity presets are more reliable in that case.</p>`,
        citations: [
          "Vevea, J. L., & Hedges, L. V. (1995). A general linear model for estimating effect size in the presence of publication bias. <em>Psychometrika, 60</em>(3), 419–435.",
          "Vevea, J. L., & Woods, C. M. (2005). Publication bias in research synthesis: Sensitivity analysis using a priori weight functions. <em>Psychological Methods, 10</em>(4), 428–443.",
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ //
  // Subgroup Analysis & Meta-regression                                  //
  // ------------------------------------------------------------------ //
  {
    id: "subgroup-regression",
    heading: "Subgroup Analysis & Meta-regression",
    topics: [

      {
        id: "guide-subgroup",
        title: "Subgroup analysis",
        body: `<p>Subgroup analysis partitions studies into named groups (entered in the
Group column of the data table) and fits a separate random-effects model
within each group. It addresses the question: does the average effect
differ across levels of a categorical study characteristic?</p>
<p><strong>Between-group test:</strong> Cochran's Q is decomposed into
within-group (Q<sub>within</sub>) and between-group (Q<sub>between</sub>)
components. Q<sub>between</sub> follows a χ² distribution with G − 1
degrees of freedom under the null of equal group means, where G is the
number of groups.</p>
<p><code>Q<sub>between</sub> = Q<sub>total</sub> − Σ Q<sub>g</sub></code><br>
(computed on the pooled study set, not re-pooling within groups)</p>
<p><strong>Interpretation:</strong> A significant Q<sub>between</sub>
(p &lt; .05) suggests the subgroup variable moderates the effect. However,
subgroup analyses are exploratory unless pre-registered; multiple comparisons
across many categorical variables inflate the Type I error rate.</p>
<p><strong>Limitation of assumed-common-τ² models:</strong> The
implementation fits separate τ² values per subgroup (separate RE models).
An alternative is to assume a common τ² across groups (as in
meta-regression with a categorical predictor), which has higher power but
requires the heterogeneity assumption to hold across groups.</p>`,
        citations: [
          "Borenstein, M., & Higgins, J. P. T. (2013). Meta-analysis and subgroups. <em>Prevention Science, 14</em>(2), 134–143.",
          "Higgins, J. P. T., & Thompson, S. G. (2004). Controlling the risk of spurious findings from meta-regression. <em>Statistics in Medicine, 23</em>(11), 1663–1682.",
        ],
      },

      {
        id: "guide-metaregression",
        title: "Meta-regression",
        body: `<p>Meta-regression extends the random-effects model by including study-level
covariates (moderators) as predictors of the true effect size. It addresses
the question: does the average effect vary with a measurable study
characteristic?</p>
<p><strong>Model:</strong><br>
<code>yᵢ = β₀ + β₁x₁ᵢ + … + βₚxₚᵢ + uᵢ + εᵢ</code><br>
where uᵢ ~ N(0, τ²) is the residual between-study heterogeneity after
accounting for moderators, and εᵢ ~ N(0, vᵢ) is within-study error.
Coefficients are estimated by weighted least squares (WLS) using RE weights
wᵢ = 1/(vᵢ + τ²), with τ² estimated by REML or the selected estimator.</p>
<p><strong>Moderator types:</strong></p>
<ul>
  <li><strong>Continuous</strong> — entered as numeric values. The slope
  β estimates the change in mean effect per unit increase in the moderator.
  A bubble plot shows the regression line with study bubbles sized by
  weight.</li>
  <li><strong>Categorical</strong> — dummy-coded automatically (first
  level = reference). Coefficients are mean differences from the reference
  group.</li>
</ul>
<p><strong>Key output:</strong></p>
<ul>
  <li><strong>Q<sub>M</sub></strong> — omnibus test for all moderators
  jointly (χ² with p − 1 df, where p is the number of predictors including
  the intercept).</li>
  <li><strong>Q<sub>E</sub></strong> — test of residual heterogeneity
  (χ² with k − p df). A significant Q<sub>E</sub> means the moderators do
  not fully explain the between-study variance.</li>
  <li><strong>R²</strong> — proportion of the original between-study
  variance explained by the moderators: (τ²₀ − τ²) / τ²₀. Negative values
  are set to 0 (NaN when τ²₀ = 0).</li>
  <li><strong>VIF</strong> — variance inflation factors; values &gt; 10
  indicate collinearity among predictors.</li>
</ul>
<p><strong>Cautionary notes:</strong></p>
<ul>
  <li>Meta-regression has low power unless k is large (≥ 10 studies per
  predictor is a common rule of thumb).</li>
  <li>Ecological fallacy: a moderator significant at the study level does
  not imply the same relationship within individual studies.</li>
  <li>Without pre-registration, meta-regression is exploratory; results
  should be clearly labelled as hypothesis-generating.</li>
</ul>`,
        citations: [
          "Knapp, G., & Hartung, J. (2003). Improved tests for a random effects meta-regression with a single covariate. <em>Statistics in Medicine, 22</em>(17), 2693–2710.",
          "Higgins, J. P. T., & Thompson, S. G. (2004). Controlling the risk of spurious findings from meta-regression. <em>Statistics in Medicine, 23</em>(11), 1663–1682.",
          "Thompson, S. G., & Higgins, J. P. T. (2002). How should meta-regression analyses be undertaken and interpreted? <em>Statistics in Medicine, 21</em>(11), 1559–1573.",
        ],
      },

      {
        id: "guide-nonlinear-reg",
        title: "Non-linear meta-regression",
        body: `<p>Standard meta-regression assumes a linear relationship between a
continuous moderator and the true effect. When the relationship may be curved,
<strong>polynomial</strong> or <strong>restricted cubic spline (RCS)</strong>
terms allow the fitted curve to flex while remaining fully estimable via the
same WLS framework.</p>

<p><strong>Polynomial terms</strong><br>
Adding x² and x³ to the design matrix captures quadratic or cubic curvature:
<code>ŷ = β₀ + β₁x + β₂x²</code> (quadratic) or
<code>ŷ = β₀ + β₁x + β₂x² + β₃x³</code> (cubic).
Select <em>Poly ²</em> or <em>Poly ³</em> from the transform menu when adding
the moderator. These are equivalent to metafor's <code>I(x^2)</code> syntax.
Because raw polynomial columns are correlated, VIF typically exceeds 5; this is
expected and does not affect estimates.</p>

<p><strong>Restricted cubic splines (RCS)</strong><br>
RCS, also called natural splines, are piecewise cubic polynomials that are:
(a) cubic between interior knots, (b) linear beyond the outermost knots
(reducing extrapolation risk), and (c) constrained to join smoothly at knots.
With <em>k</em> knots the model uses <em>k</em> − 1 total regression columns
(one linear term plus <em>k</em> − 2 nonlinear terms).</p>

<p><strong>RCS formula (Harrell, 2015, eq. 2.5):</strong><br>
For knots t₁ &lt; … &lt; t<sub>k</sub>, the j-th nonlinear basis term is:</p>
<pre>φⱼ(x) = (x − tⱼ)³₊ − [(t<sub>k</sub>−tⱼ)/(t<sub>k</sub>−t<sub>k-1</sub>)]·(x−t<sub>k-1</sub>)³₊
                     + [(t<sub>k-1</sub>−tⱼ)/(t<sub>k</sub>−t<sub>k-1</sub>)]·(x−t<sub>k</sub>)³₊</pre>
<p>where (u)₊ = max(u, 0)³.</p>

<p><strong>Knot placement</strong><br>
Knots are placed at Harrell's recommended percentiles of the observed moderator
values:</p>
<table style="font-size:0.9em;border-collapse:collapse">
<tr><th style="padding:2px 8px">Knots</th><th style="padding:2px 8px">Percentiles</th></tr>
<tr><td style="padding:2px 8px">3</td><td style="padding:2px 8px">10, 50, 90</td></tr>
<tr><td style="padding:2px 8px">4</td><td style="padding:2px 8px">5, 35, 65, 95</td></tr>
<tr><td style="padding:2px 8px">5</td><td style="padding:2px 8px">5, 27.5, 50, 72.5, 95</td></tr>
</table>

<p><strong>Interpreting the output</strong><br>
The per-moderator Wald test (Q<sub>M</sub> with k−1 df) tests whether the
moderator as a whole (linear + nonlinear terms combined) is significant.
Individual coefficients for the nonlinear terms are not interpretable in
isolation — examine the fitted curve in the bubble plot instead.</p>

<p><strong>Model selection</strong><br>
Compare the linear, quadratic, and spline models using AIC/BIC (lower = better)
or a likelihood ratio test (fitted models must be nested, same τ² method).</p>

<p><strong>Cautionary notes:</strong></p>
<ul>
  <li>Non-linear terms increase VIF (expected, not a bug).</li>
  <li>With small k (e.g. &lt; 15 studies), cubic splines with 4–5 knots may
  be near-collinear or poorly identified.</li>
  <li>3-knot RCS is the recommended starting point for most meta-analyses.</li>
  <li>Polynomial models of degree ≥ 3 can produce extreme extrapolation
  outside the data range; the bubble plot shaded region shows the uncertainty.</li>
</ul>`,
        citations: [
          "Harrell, F. E., Jr. (2015). <em>Regression Modeling Strategies</em> (2nd ed.). Springer. Chapter 2.",
          "Stone, C. J., & Koo, C.-Y. (1985). Additive splines in statistics. <em>ASA Proceedings of the Statistical Computing Section, 45</em>, 45–48.",
        ],
      },

      {
        id: "guide-location-scale",
        title: "Location-scale model",
        body: `<p>Standard meta-regression models only the <em>mean</em> effect
(location): E[yᵢ] = Xᵢβ. The <strong>location-scale (LS) model</strong> fits
separate moderators for both the mean <em>and</em> the between-study
heterogeneity τ² simultaneously — answering "does covariate X predict not only
the effect size but also its variability?"</p>

<p><strong>Model formulation:</strong></p>
<ul>
  <li><strong>Location:</strong> E[yᵢ] = Xᵢβ — design matrix X with intercept
  plus location moderators.</li>
  <li><strong>Scale:</strong> log(τᵢ²) = Zᵢγ — design matrix Z with intercept
  plus scale moderators. The log link guarantees τᵢ² = exp(Zᵢγ) > 0 for all
  parameter values.</li>
  <li><strong>Total variance:</strong> σᵢ² = vᵢ + τᵢ² (within-study + study-specific heterogeneity).</li>
</ul>

<p><strong>Estimation (ML):</strong><br>
β is profiled out via weighted least squares at each γ:
β̂(γ) = (X′W(γ)X)⁻¹ X′W(γ)y, where W(γ) = diag(1/σᵢ²). The profile
log-likelihood over γ alone is then maximized by BFGS. Standard errors for
γ come from the numerical Hessian of the profile log-likelihood; SEs for β
come from (X′Ŵβ̂X)⁻¹.</p>

<p><strong>Special cases:</strong></p>
<ul>
  <li>Intercept-only scale model (Z = [1]): τᵢ² = exp(γ₀) for all studies —
  equivalent to standard random-effects meta-analysis estimated by ML.</li>
  <li>Intercept-only scale + intercept-only location: equivalent to the classic
  RE model with a single τ².</li>
</ul>

<p><strong>Output panels:</strong></p>
<ul>
  <li><strong>Location table:</strong> β coefficients with SEs, z, p, and CIs.
  QM<sub>loc</sub> is the omnibus Wald test for location moderators (excluding
  intercept).</li>
  <li><strong>Scale table:</strong> γ coefficients with SEs, z, p, and CIs.
  The intercept column also shows eˣ = exp(γ₀), the τ² when all scale
  predictors are at zero. QM<sub>scale</sub> is the omnibus Wald test for scale
  moderators (excluding intercept).</li>
  <li><strong>LR test:</strong> Likelihood ratio test comparing the full scale
  model vs an intercept-only scale model. χ²(q−1) under H₀, where q is the
  number of scale parameters.</li>
  <li><strong>Fitted values table:</strong> Shows study-specific τ̂²ᵢ = exp(Zᵢγ̂).</li>
</ul>

<p><strong>Interpretation:</strong><br>
A significant scale coefficient γⱼ means moderator j predicts heterogeneity
magnitude (studies with higher z-values have systematically larger or smaller
τᵢ²). A non-significant γⱼ suggests the moderator doesn't explain between-study
variance, even if it explains mean effects (a significant β).</p>

<p><strong>How to use in the app:</strong></p>
<ol>
  <li>Add location moderators as usual in <em>Moderators</em>.</li>
  <li>Add one or more variable names in <em>Scale moderators (log τ²)</em>.
  The same column name is reused — no separate data entry needed.</li>
  <li>Click <em>Run Analysis</em>. The Location-Scale Model panel replaces the
  Meta-Regression panel.</li>
</ol>

<p><strong>Caution:</strong></p>
<ul>
  <li>The LS model uses ML (not REML) — comparable to metafor's <code>rma.ls()</code>.</li>
  <li>Scale coefficients can be poorly identified with small k; inspect SEs and
  check convergence before interpreting γ.</li>
  <li>Removing all scale moderators restores the standard meta-regression fit.</li>
</ul>`,
        citations: [
          "Viechtbauer, W. (2021). Location-scale models for meta-analytic data. <em>Research Synthesis Methods, 12</em>(5), 567–583.",
          "Viechtbauer, W. (2010). Conducting meta-analyses in R with the metafor package. <em>Journal of Statistical Software, 36</em>(3), 1–48.",
        ],
      },

      {
        id: "guide-aic-bic",
        title: "AIC / BIC for model comparison",
        body: `<p>AIC and BIC are information criteria used to compare competing
meta-regression models. Both reward fit (via the log-likelihood) and penalise
complexity (via the number of parameters), but with different penalties.</p>

<p><strong>Formulas:</strong></p>
<ul>
  <li><strong>AIC</strong> = −2·LL + 2·npar</li>
  <li><strong>BIC</strong> = −2·LL + npar·log(n)</li>
</ul>
<p>where LL is the log-likelihood at the fitted parameters, npar = p + 1
(p fixed-effect coefficients + 1 variance component τ²), and n is the
effective sample size.</p>

<p><strong>Effective sample size for BIC:</strong></p>
<ul>
  <li><strong>ML:</strong> n = k (number of studies). The ML likelihood
  uses all k observations.</li>
  <li><strong>REML:</strong> n = k − p (error contrasts). The REML
  likelihood is defined over the k − p residual degrees of freedom
  obtained after projecting out the p-dimensional column space of the
  design matrix X. Using k − p produces BIC values that penalise
  additional fixed-effect predictors more heavily when the sample is
  small — appropriate because adding a predictor simultaneously reduces
  the effective sample size for REML.</li>
</ul>
<p>This matches the convention in R's <code>metafor</code> package
(metafor 4.8.0, <code>AIC.rma()</code> / <code>BIC.rma()</code>).</p>

<p><strong>Log-likelihood (LL):</strong><br>
For ML: LL<sub>ML</sub> = −½ Σ[log(2π) + log(vᵢ+τ²) + (yᵢ−ŷᵢ)²/(vᵢ+τ²)]<br>
For REML: LL<sub>REML</sub> = LL<sub>ML</sub> + p/2·log(2π) + ½·log|X′X| − ½·log|X′WX|<br>
where W = diag(1/(vᵢ+τ²)) (Harville 1977).</p>

<p><strong>Interpreting differences:</strong></p>
<ul>
  <li>Lower AIC or BIC indicates a better balance of fit and parsimony.</li>
  <li>A commonly used rule of thumb (Burnham &amp; Anderson 2002):
    ΔAIC &lt; 2 = little evidence of difference; 4–7 = some evidence;
    &gt; 10 = decisive.</li>
  <li>BIC penalises complexity more than AIC when k &gt; 7 (since
    log(k) &gt; 2 for k ≥ 8), so BIC more often favours the simpler model.</li>
</ul>

<p><strong>Which estimator to use for model comparison?</strong></p>
<ul>
  <li><strong>REML AIC/BIC</strong> — can only compare models with
  <em>identical</em> fixed-effect predictors (same X matrix). Suitable
  for comparing τ² estimators or checking model diagnostics.</li>
  <li><strong>ML AIC/BIC</strong> — can compare models with different
  numbers or types of predictors. Switch to method = "ML" in the τ²
  estimator dropdown when performing formal model selection.</li>
</ul>`,
        citations: [
          "Akaike, H. (1974). A new look at the statistical model identification. <em>IEEE Transactions on Automatic Control, 19</em>(6), 716–723.",
          "Schwarz, G. (1978). Estimating the dimension of a model. <em>Annals of Statistics, 6</em>(2), 461–464.",
          "Burnham, K. P., & Anderson, D. R. (2002). <em>Model selection and multimodel inference: A practical information-theoretic approach</em> (2nd ed.). Springer.",
          "Harville, D. A. (1977). Maximum likelihood approaches to variance component estimation and to related problems. <em>Journal of the American Statistical Association, 72</em>(358), 320–338.",
          "Viechtbauer, W. (2010). Conducting meta-analyses in R with the metafor package. <em>Journal of Statistical Software, 36</em>(3), 1–48.",
        ],
      },
    ],
  },   // end "Subgroup Analysis & Meta-regression" section

  // ------------------------------------------------------------------ //
  // Plots & Diagnostics                                                  //
  // ------------------------------------------------------------------ //
  {
    id: "plots",
    heading: "Plots & Diagnostics",
    topics: [

      {
        id: "guide-forest",
        title: "Forest plot",
        body: `<p>The standard display for a meta-analysis. Each row shows one study's
effect estimate with its confidence interval (horizontal line) and a square
whose area is proportional to the study's weight. The pooled estimate is
shown as a diamond whose width spans the confidence interval.</p>
<p>In random-effects mode, a dashed line shows the prediction interval —
the range within which a new study's true effect is expected to fall with
95% probability. A wide prediction interval relative to the CI signals
substantial heterogeneity.</p>
<p>Studies can be grouped by a categorical moderator; within-group and
overall pooled estimates are shown separately.</p>`,
        citations: [
          "Lewis, S., & Clarke, M. (2001). Forest plots: Trying to see the wood and the trees. <em>BMJ, 322</em>(7300), 1479–1480.",
        ],
      },

      {
        id: "guide-influence",
        title: "Influence diagnostics",
        body: `<p>Quantitative per-study diagnostics that measure each study's impact on
the pooled estimate, heterogeneity, and model fit. Computed by re-running
the meta-analysis k times with one study removed each time (leave-one-out),
then comparing the leave-one-out result to the full-dataset result.</p>
<p><strong>Diagnostics reported:</strong></p>
<ul>
  <li><strong>RE (loo)</strong> — pooled estimate when the study is omitted.
  Large deviations flag studies that anchor the conclusion.</li>
  <li><strong>Standardised residual</strong> — (yᵢ − μ̂) / √(vᵢ + τ²).
  Values with |r| &gt; 2 are flagged as potential outliers.</li>
  <li><strong>DFBETA</strong> — standardised change in the RE estimate on
  study removal: (μ̂_full − μ̂_loo) / SE_loo. |DFBETA| &gt; 1 flags
  disproportionate influence on the point estimate.</li>
  <li><strong>Hat value</strong> — h<sub>i</sub> = w<sub>i</sub> / Σw<sub>j</sub>,
  the fraction of total RE weight held by the study. h<sub>i</sub> &gt; 2/k
  flags high leverage.</li>
  <li><strong>Cook's distance</strong> — D<sub>i</sub> = (μ̂_full − μ̂_loo)²
  × Σw<sub>j</sub>. Measures the total shift of the pooled estimate on
  removal, scaled by model precision. D<sub>i</sub> &gt; 4/k is a common
  flag threshold (regression analogy).</li>
  <li><strong>Δτ²</strong> — change in the between-study variance on study
  removal. Negative values indicate the study inflates heterogeneity.</li>
</ul>
<p><strong>Influence plot:</strong> A bubble chart of hat value (x) vs.
Cook's distance (y) per study, with bubble size proportional to weight.
Studies in the upper-right region are simultaneously high-leverage and
high-influence — the clearest candidates for sensitivity analysis.</p>
<p><strong>Baujat plot:</strong> See the separate Baujat entry for a
complementary visualisation of heterogeneity contribution vs. overall
influence.</p>`,
        citations: [
          "Viechtbauer, W., & Cheung, M. W.-L. (2010). Outlier and influence diagnostics for meta-analysis. <em>Research Synthesis Methods, 1</em>(2), 112–125.",
          "Cook, R. D. (1977). Detection of influential observation in linear regression. <em>Technometrics, 19</em>(1), 15–18.",
        ],
      },

      {
        id: "guide-covratio",
        title: "Covariance ratio",
        body: `<p>The covariance ratio for study <em>i</em> is the ratio of the determinant
of the variance-covariance matrix of the model coefficients when study <em>i</em>
is removed to the determinant for the full dataset:</p>
<pre>covRatio_i = det(Var(μ̂_loo,i)) / det(Var(μ̂_full))</pre>
<p>For an intercept-only random-effects model with one parameter (μ̂_RE),
the covariance matrix is the scalar Var(μ̂_RE) = 1/W, so this reduces to:</p>
<pre>covRatio_i = W_full / W_loo,i</pre>
<p>where W_full = Σⱼ 1/(vⱼ + τ²_full) and W_loo,i = Σⱼ≠ᵢ 1/(vⱼ + τ²_loo,i).
The LOO τ² is re-estimated without study <em>i</em>.</p>
<p><strong>Interpretation:</strong></p>
<ul>
  <li><strong>covRatio &lt; 1</strong> — study <em>i</em> contributes above-average
  precision; removing it reduces the total weight (widens the pooled CI). These
  studies are precision anchors.</li>
  <li><strong>covRatio = 1</strong> — the study contributes exactly average precision.</li>
  <li><strong>covRatio &gt; 1</strong> — the study contributes below-average precision;
  removing it increases the average per-study weight. High values are flagged.</li>
</ul>
<p><strong>Flag threshold</strong> (metafor convention):
covRatio<sub>i</sub> &gt; (1 + p/k)<sup>p</sup> = 1 + 1/k for p = 1</p>
<p>Note that covRatio differs from Cook's D and DFFITS: it measures changes in the
<em>precision</em> of the estimate rather than its location.</p>
<p>Formula cross-validated against <code>metafor::influence.rma.uni()</code>
version 4.8-0 (BCG dataset, DL method; all 13 studies match to ≤ 1.78 × 10⁻¹⁵).</p>`,
        citations: [
          "Viechtbauer, W., & Cheung, M. W.-L. (2010). Outlier and influence diagnostics for meta-analysis. <em>Research Synthesis Methods, 1</em>(2), 112–125.",
          "Belsley, D. A., Kuh, E., & Welsch, R. E. (1980). <em>Regression Diagnostics: Identifying Influential Data and Sources of Collinearity</em>. Wiley.",
        ],
      },

      {
        id: "guide-dffits",
        title: "DFFITS",
        body: `<p>DFFITS (difference in fitted values, standardised) measures the
standardised change in the pooled random-effects estimate when study <em>i</em>
is removed:</p>
<pre>DFFITS_i = (μ̂_full − μ̂_loo,i) / √(h_i · (τ²_loo,i + v_i))</pre>
<p>where h<sub>i</sub> = w<sub>i</sub> / Σw<sub>j</sub> is the hat value
(leverage), τ²<sub>loo,i</sub> is the between-study variance re-estimated
without study <em>i</em>, and v<sub>i</sub> is the within-study variance.
The denominator is the leave-one-out standard error of the fitted value,
so DFFITS is on the same scale as a standard normal deviate.</p>
<p><strong>Relationship to other diagnostics:</strong></p>
<ul>
  <li><strong>DFBETA</strong> divides by SE<sub>loo</sub> (precision of the LOO
  estimate) — sensitive to changes in the pooled estimate.</li>
  <li><strong>DFFITS</strong> divides by the LOO SE of the <em>fitted value</em>,
  incorporating leverage — more sensitive to high-leverage studies.</li>
  <li><strong>Cook's D</strong> uses the full-model variance and is not
  studentised — best for omnibus model-fit comparisons.</li>
</ul>
<p><strong>Flag threshold</strong> (metafor convention):
|DFFITS<sub>i</sub>| &gt; 3 · √(1 / (k − 1))</p>
<p>This equals the regression threshold 3√(p / (k − p)) with p = 1
(intercept-only model). For k = 13 this is ≈ 0.87; for k = 5 it is ≈ 1.50.</p>
<p>Formula cross-validated against <code>metafor::influence.rma.uni()</code>
version 4.8-0 (BCG dataset, DL method; all 13 studies match to ≤ 3 × 10⁻¹⁷).</p>`,
        citations: [
          "Viechtbauer, W., & Cheung, M. W.-L. (2010). Outlier and influence diagnostics for meta-analysis. <em>Research Synthesis Methods, 1</em>(2), 112–125.",
          "Belsley, D. A., Kuh, E., & Welsch, R. E. (1980). <em>Regression Diagnostics: Identifying Influential Data and Sources of Collinearity</em>. Wiley.",
        ],
      },

      {
        id: "guide-blup",
        title: "BLUPs (Empirical Bayes shrunken estimates)",
        body: `<p>In a random-effects model the <em>Best Linear Unbiased Prediction</em>
(BLUP) of the true effect in study <em>i</em> is:</p>
<pre>λᵢ = τ² / (τ² + vᵢ)
θ̂ᵢ = μ̂_RE + λᵢ · (yᵢ − μ̂_RE)</pre>
<p>where τ² is the between-study variance, vᵢ the within-study variance, and
μ̂_RE the pooled random-effects estimate.  λᵢ ∈ [0, 1] is the
<strong>shrinkage weight</strong>: λᵢ → 0 when the study is noisy relative to τ²
(full shrinkage to the mean); λᵢ → 1 when it is precise (stays near its
observed value).</p>
<p>The <strong>random effect</strong> ûᵢ = θ̂ᵢ − μ̂_RE = λᵢ(yᵢ − μ̂_RE) is the
study's estimated deviation from the grand mean.</p>
<p><strong>Uncertainty</strong> in the BLUP accounts for both the within-study sampling
error and the estimation error in μ̂_RE:</p>
<pre>Var(θ̂ᵢ) = λᵢ·vᵢ + (vᵢ/(τ²+vᵢ))² · Var(μ̂_RE)</pre>
<p>The CIs in the plot are based on this full variance.</p>
<p><strong>Reading the plot</strong></p>
<ul>
  <li>Gray segments: observed yi ± 1.96 · SE (unadjusted)</li>
  <li>Accent segments: BLUP ± 1.96 · SE<sub>BLUP</sub> (shrunken)</li>
  <li>Dashed lines connecting gray and accent points show the direction and
  magnitude of shrinkage</li>
  <li>All BLUP estimates are pulled toward the vertical accent line (μ̂_RE)</li>
  <li>Studies with wider gray CIs (higher vᵢ) are shrunk more</li>
</ul>
<p>BLUPs are only shown when τ² > 0 (a pure fixed-effect model has τ² = 0 and
all BLUPs collapse to μ̂_FE, which is uninformative).</p>`,
        citations: [
          "Raudenbush, S. W. (1994). Random effects models. In H. Cooper & L. V. Hedges (Eds.), <em>The Handbook of Research Synthesis</em>. Russell Sage Foundation.",
          "Robinson, G. K. (1991). That BLUP is a good thing: The estimation of random effects. <em>Statistical Science, 6</em>(1), 15–32.",
        ],
      },

      {
        id: "guide-qqplot",
        title: "Normal Q-Q plot of standardised residuals",
        body: `<p>The normal quantile-quantile (Q-Q) plot assesses whether the internally
standardised residuals from the random-effects model follow a standard normal
distribution — the key distributional assumption of the RE model.</p>

<h4>Standardised residuals</h4>
<p>For each study <em>i</em>:</p>
<pre>  zᵢ = (yᵢ − μ̂_RE) / √(vᵢ + τ²)</pre>
<p>Under the RE model, these should be approximately i.i.d. N(0, 1) if the
model is correctly specified. The same residuals are reported in the Influence
diagnostics table.</p>

<h4>Constructing the plot</h4>
<p>The residuals are sorted from smallest to largest. For the <em>i</em>-th
sorted value (out of <em>k</em>), the corresponding theoretical normal quantile
is computed using Blom's formula (the same formula used by R's
<code>qqnorm()</code>):</p>
<pre>  qᵢ = Φ⁻¹( (i − 0.375) / (k + 0.25) )</pre>
<p>Each study appears as a point at (qᵢ, z₍ᵢ₎). Points are coloured
orange when |z| > 2.</p>

<h4>Reference line</h4>
<p>The dashed reference line is fitted through the first and third quartile
of both the theoretical and sample distributions — matching R's
<code>qqline()</code> convention. Under perfect normality the line has slope 1
and intercept 0; departure of the slope from 1 indicates scale misspecification,
and a non-zero intercept indicates a location shift.</p>

<h4>Interpretation</h4>
<ul>
  <li><strong>Points near the line</strong> — normality assumption is
  plausible.</li>
  <li><strong>S-shaped curve</strong> — lighter tails than normal (platykurtic);
  common when studies are few or τ² is small.</li>
  <li><strong>Inverted-S / heavy tails</strong> — heavier tails than normal
  (leptokurtic); suggests outlying studies or model misspecification.</li>
  <li><strong>Single extreme point</strong> — a single outlying study;
  inspect the Influence table and consider a sensitivity analysis.</li>
</ul>
<p>With small <em>k</em> (< 10) even random samples from a normal distribution
can look non-linear; interpret with caution and focus on gross departures.</p>

<h4>Verification</h4>
<p>Equivalent to <code>qqnorm(rstandard(res))</code> in metafor, where
<code>res = rma(yi, vi, method = "REML")</code>. The standardised residuals
match <code>rstandard.rma.uni()</code> to floating-point precision (verified
in INFLUENCE_BENCHMARKS).</p>`,
        citations: [
          "Viechtbauer, W., & Cheung, M. W.-L. (2010). Outlier and influence diagnostics for meta-analysis. <em>Research Synthesis Methods, 1</em>(2), 112–125.",
          "Viechtbauer, W. (2010). Conducting meta-analyses in R with the metafor package. <em>Journal of Statistical Software, 36</em>(3), 1–48.",
          "Blom, G. (1958). <em>Statistical Estimates and Transformed Beta-Variables</em>. Wiley.",
        ],
      },

      {
        id: "guide-radial",
        title: "Radial (Galbraith) plot",
        body: `<p>The radial plot (also called the Galbraith plot) is a scatter plot designed to
display study-level precision and standardised effects simultaneously, making
outliers and heterogeneity visually apparent.</p>

<h4>Axes</h4>
<p>For each study <em>i</em> with effect estimate yᵢ and standard error seᵢ:</p>
<pre>  x-axis:  xᵢ = 1/seᵢ   (precision)
  y-axis:  yᵢ = yᵢ/seᵢ  (standardised effect, or z-score)</pre>
<p>Larger, more precise studies plot further to the right; all studies should
cluster near a line through the origin if the fixed-effect model is appropriate.</p>

<h4>Regression line and ±2 band</h4>
<p>Under the fixed-effect model the expected standardised effect is:</p>
<pre>  E[yᵢ/seᵢ] = θ_FE · (1/seᵢ)</pre>
<p>so the <strong>solid regression line</strong> through the origin has slope equal
to the fixed-effect pooled estimate θ_FE (= Σwᵢyᵢ / Σwᵢ with wᵢ = 1/seᵢ²).</p>
<p>The <strong>dashed ±2 lines</strong> are:</p>
<pre>  y = θ_FE · x ± 2</pre>
<p>A study outside this band has a standardised deviation from the FE line greater
than 2, which is approximately a 95% reference interval under homogeneity.</p>

<h4>Right-axis effect-size scale</h4>
<p>The secondary axis on the right converts y back to the original effect-size
scale. At the right edge of the plot (x = x_max), any y value corresponds to an
effect θ = y / x_max. The right axis tick labels therefore show the effect size
that each horizontal position represents for the most precise study in the
sample.</p>

<h4>Outlier highlighting</h4>
<p>Studies with |yᵢ/seᵢ − θ_FE · xᵢ| > 2 are highlighted in orange. These
studies deviate from the FE line by more than 2 standardised units and are
candidates for sensitivity analysis. The count of outliers appears in the plot
title.</p>

<h4>Interpretation</h4>
<ul>
  <li><strong>Points near the regression line</strong> — consistent with the
  fixed-effect model; little between-study heterogeneity.</li>
  <li><strong>Wide vertical scatter</strong> — substantial heterogeneity; the
  random-effects model is more appropriate.</li>
  <li><strong>Orange points (outliers)</strong> — studies whose effects are
  inconsistent with the overall FE estimate; investigate for methodological
  differences.</li>
  <li><strong>Funnel shape</strong> — expected: small studies (left) scatter
  more than large studies (right).</li>
</ul>
<p>The radial plot is most useful for identifying specific outlying studies and
for visualising the relationship between precision and effect size. It
complements the funnel plot but is less affected by asymmetry due to publication
bias (because both axes depend on seᵢ in the same direction).</p>

<h4>Note on the regression line</h4>
<p>The slope is the <em>fixed-effect</em> estimate regardless of which
heterogeneity estimator is selected for the main analysis. This is intentional:
the line serves as a reference for homogeneity, not as the primary pooled
estimate.</p>`,
        citations: [
          "Galbraith, R. F. (1988). Graphical display of estimates having differing standard errors. <em>Technometrics, 30</em>(3), 271–281.",
          "Galbraith, R. F. (1994). Some applications of radial plots. <em>Journal of the American Statistical Association, 89</em>(428), 1232–1242.",
        ],
      },

      {
        id: "guide-baujat",
        title: "Baujat plot",
        body: `<p>A scatter plot that simultaneously displays two per-study diagnostics:</p>
<ul>
  <li><strong>x-axis</strong> — each study's contribution to Cochran's Q statistic
  (heterogeneity influence)</li>
  <li><strong>y-axis</strong> — each study's overall influence on the pooled estimate,
  measured as the squared standardised change in the RE pooled estimate when that
  study is removed</li>
</ul>
<p>Dashed reference lines at the means of each axis divide the plot into four
quadrants. Studies in the upper-right quadrant simultaneously inflate heterogeneity
and shift the pooled estimate — the most important candidates for sensitivity
analysis.</p>
<p>The plot is a quick visual screen before formal leave-one-out or Cook's-distance
analysis. It does not replace quantitative influence diagnostics but is useful for
communicating patterns to a broad audience.</p>`,
        citations: [
          "Baujat, B., Mahé, C., Pignon, J.-P., & Hill, C. (2002). A graphical method for exploring heterogeneity in meta-analyses: Application to a meta-analysis of 65 trials. <em>Statistics in Medicine, 21</em>(18), 2641–2652.",
        ],
      },

      {
        id: "guide-labbe",
        title: "L'Abbé plot",
        body: `<p>Available for binary outcomes (OR, RR, RD). Each study is plotted as a
bubble with:</p>
<ul>
  <li><strong>x-axis</strong> — control-group event rate: c / (c + d)</li>
  <li><strong>y-axis</strong> — treatment-group event rate: a / (a + b)</li>
  <li><strong>bubble size</strong> — proportional to √N (total sample size)</li>
</ul>
<p>Two reference lines are drawn:</p>
<ul>
  <li>The <strong>solid diagonal</strong> y = x marks the line of no treatment effect
  (equal event rates in both groups).</li>
  <li>The <strong>dashed curve</strong> shows the pooled random-effects estimate:
  for OR the isoOR curve y = (OR·x)/(1 − x + OR·x); for RR the line y = RR·x;
  for RD the shift y = x + RD.</li>
</ul>
<p>Interpreting the plot:</p>
<ul>
  <li>Points above the diagonal indicate the treatment arm has a higher event rate
  than control; points below indicate a protective effect.</li>
  <li>If the cloud is curved rather than parallel to the pooled-estimate line,
  a <em>treatment × baseline-risk interaction</em> may be present: the treatment
  is more (or less) effective in higher-risk populations.</li>
  <li>Colour indicates subgroup (when a group column is populated).</li>
</ul>`,
        citations: [
          "L'Abbé, K. A., Detsky, A. S., & O'Rourke, K. (1987). Meta-analysis in clinical research. <em>Annals of Internal Medicine, 107</em>(2), 224–233.",
        ],
      },

      {
        id: "guide-gosh",
        title: "GOSH plot (Graphical Display of Study Heterogeneity)",
        body: `<p>For every non-empty subset of the k studies the GOSH plot computes the
fixed-effects pooled estimate μ̂ and I². Plotting μ̂ against I² (or Q, or subset
size n) for all subsets creates a fingerprint of how heterogeneity is structured
across the evidence base.</p>
<p><strong>What to look for:</strong></p>
<ul>
  <li><strong>Fan-shaped or bimodal clusters</strong> indicate one or more studies
  whose inclusion or exclusion fundamentally changes the pooled estimate or
  heterogeneity — strong candidates for sensitivity analysis.</li>
  <li><strong>A single compact cloud</strong> suggests the evidence base is consistent
  and no single study dominates.</li>
  <li><strong>Outlier subsets</strong> at extreme μ̂ or I² values usually trace back
  to a single influential study; colour-coding by subset size (n) helps identify
  which study is responsible.</li>
</ul>
<p><strong>Enumeration vs. sampling:</strong> For k ≤ 15 all 2<sup>k</sup> − 1
subsets are computed exactly (at most 32 767). For k ≤ 30 a random sample of
subsets is drawn (default 50 000); the sampling seed is fixed for reproducibility.
k &gt; 30 is not supported.</p>
<p><strong>Coverage warning for large k:</strong> At the default 50 000 subsets,
sampling coverage drops steeply with k — approximately 5% at k = 20 and under
0.01% at k = 30. Influential-study patterns remain visible in a random sample,
but the plot becomes a sparse point cloud rather than a complete fingerprint.
If k ≥ 20, consider raising "Max subsets" to 200 000 or more to improve
coverage; computation runs off the main thread so the UI stays responsive.</p>
<p><strong>Note:</strong> The GOSH plot uses fixed-effects pooling within each
subset regardless of the main analysis model, because the between-study variance
cannot be estimated reliably from small subsets.</p>`,
        citations: [
          "Olkin, I., Dahabreh, I. J., & Trikalinos, T. A. (2012). GOSH — a graphical display of study heterogeneity. <em>Research Synthesis Methods, 3</em>(3), 214–223.",
          "Harbord, R. M., & Higgins, J. P. T. (2008). Meta-regression in Stata. <em>Stata Journal, 8</em>(4), 493–519.",
        ],
      },

      {
        id: "guide-profile-lik-tau2",
        title: "Profile likelihood for τ²",
        body: `<p>The profile log-likelihood for τ² is obtained by substituting the
closed-form RE mean μ̂(τ²) = Σwᵢyᵢ / Σwᵢ (where wᵢ = 1/(vᵢ + τ²)) at each
value of τ², so the curve is computed in a single O(k) pass per grid point
with no inner optimisation required.</p>
<p><strong>ML profile:</strong><br>
<code>Lₚ(τ²) = −½ Σ[log(vᵢ+τ²) + wᵢ(yᵢ−μ̂)²]</code></p>
<p><strong>REML profile</strong> adds one term to account for estimating μ:<br>
<code>L_REML(τ²) = Lₚ(τ²) − ½ log(Σwᵢ)</code></p>
<p>The curve is shifted so its peak is at 0; τ̂² appears as a vertical line at
the maximum. The 95% confidence interval is the set of τ² values where the
shifted curve exceeds −χ²(1, 0.95)/2 ≈ −1.921 (likelihood-ratio inversion).
The lower CI bound is clipped to 0 when the profile at τ² = 0 lies above the
threshold, which is common for datasets with low heterogeneity.</p>
<p><strong>Difference from the Q-profile CI:</strong> The τ² CI in the summary
table uses the Q-profile method, which inverts a χ² pivot based on Cochran's Q —
a moment-based approach. The profile likelihood CI is derived from the full
likelihood function. The two methods agree for large k but can differ noticeably
when k is small. Neither uniformly dominates; the profile likelihood CI is
generally preferred when ML or REML is used.</p>
<p>Only available when the τ² estimator is ML or REML. The section is hidden for
moment estimators (DL, PM, HS, etc.) that have no associated likelihood.</p>`,
        citations: [
          "Hardy, R. J., & Thompson, S. G. (1996). A likelihood approach to meta-analysis with random effects. <em>Statistics in Medicine, 15</em>(6), 619–629.",
          "Viechtbauer, W. (2007). Confidence intervals for the amount of heterogeneity in meta-analysis. <em>Statistics in Medicine, 26</em>(1), 37–52.",
        ],
      },

      {
        id: "guide-funnel-plot",
        title: "Funnel plot (publication-bias diagnostic)",
        body: `<p>See the <strong>Publication Bias → Funnel plot</strong> section above for
a full description. The funnel plot is the primary graphical tool for
detecting small-study effects and publication bias. Toggle between standard and
contour-enhanced modes; contour-enhanced shades regions by significance level
(α = .10, .05, .01) to help distinguish bias from genuine heterogeneity.</p>`,
        citations: [
          "Sterne, J. A. C., & Egger, M. (2001). Funnel plots for detecting bias in meta-analysis: Guidelines on choice of axis. <em>Journal of Clinical Epidemiology, 54</em>(10), 1046–1055.",
        ],
      },

      {
        id: "guide-orchard",
        title: "Orchard plot",
        body: `<p>An enhanced forest plot that overlays the raw study estimates on a
beeswarm distribution, scaled by precision. Provides a richer visual sense
of the distribution of effect sizes than the standard forest plot,
especially for large k.</p>
<p>The central point and horizontal bar show the pooled estimate and its
confidence interval. Study points are jittered vertically to avoid overlap,
sized by weight.</p>`,
        citations: [
          "Nakagawa, S., Lagisz, M., O'Dea, R. E., Rutkowska, J., Yang, Y., Noble, D. W. A., & Senior, A. M. (2021). The orchard plot: Cultivating a forest plot for use in ecology, evolution, and beyond. <em>Research Synthesis Methods, 12</em>(1), 4–12.",
        ],
      },

      {
        id: "guide-caterpillar",
        title: "Caterpillar plot (ranked CI)",
        body: `<p>Studies sorted by effect size with their confidence intervals displayed
as horizontal lines. The ordering makes it easy to identify extreme studies
and to see whether the distribution of effects is approximately normal —
a key assumption of the random-effects model.</p>
<p>Studies are colour-coded by whether their CI excludes the null value.
Wide intervals relative to adjacent studies indicate low-precision studies.</p>`,
        citations: [
          "Anzures-Cabrera, J., & Higgins, J. P. T. (2010). Graphical displays for meta-analysis: An overview with suggestions for practice. <em>Research Synthesis Methods, 1</em>(1), 66–80.",
        ],
      },

      {
        id: "guide-cumulative",
        title: "Cumulative meta-analysis",
        body: `<p>Re-runs the meta-analysis after each successive study is added (in a
specified order). Useful for seeing how the pooled estimate and its
precision evolved over time, and for detecting whether the evidence base
had already converged before the most recent studies were conducted.</p>
<p>Available ordering options: input order, most/least precise first,
effect ascending/descending.</p>
<p>A <strong>cumulative funnel plot</strong> is also generated, showing the
funnel at each cumulative step. A slider controls which step is displayed,
making it possible to observe how the funnel shape and any apparent asymmetry
evolve as studies are added.</p>`,
        citations: [
          "Lau, J., Schmid, C. H., & Chalmers, T. C. (1995). Cumulative meta-analysis of clinical trials builds evidence for exemplary medical care. <em>Journal of Clinical Epidemiology, 48</em>(1), 45–57.",
        ],
      },

      {
        id: "guide-rob",
        title: "Risk-of-bias plots",
        body: `<p>Two complementary visualisations of risk-of-bias assessments entered in
the RoB panel:</p>
<ul>
  <li><strong>Traffic light plot:</strong> A study × domain grid showing each
  study's rating (Low / Some concerns / High / Not-informed) for each domain
  as a coloured symbol. Useful for identifying patterns: e.g. all studies
  have high RoB for a specific domain.</li>
  <li><strong>Summary bar chart:</strong> Stacked horizontal bars per domain
  showing the percentage of studies at each rating level. Provides a quick
  overall picture of where the evidence base is weakest.</li>
</ul>
<p>These plots follow the Cochrane RoB 2 visual conventions. The domains and
rating categories are user-defined.</p>`,
        citations: [
          "Sterne, J. A. C., Savović, J., Page, M. J., Elbers, R. G., Blencowe, N. S., Boutron, I., Cates, C. J., Cheng, H.-Y., Corbett, M. S., Eldridge, S. M., Emberson, J. R., Hernán, M. A., Hopewell, S., Hróbjartsson, A., Junqueira, D. R., Jüni, P., Kirkham, J. J., Lasserson, T., Li, T., McAleenan, A., … Higgins, J. P. T. (2019). RoB 2: A revised tool for assessing risk of bias in randomised trials. <em>BMJ, 366</em>, l4898.",
        ],
      },
    ],
  },

  {
    id: "bayes-meta",
    heading: "Bayesian Meta-Analysis",
    topics: [

      {
        id: "guide-bayes-meta",
        title: "Bayesian normal-normal model",
        body: `<p>The Bayesian meta-analysis fits a <strong>conjugate
normal-normal random-effects model</strong>:</p>
<ul>
  <li>Within-study: y<sub>i</sub> | θ<sub>i</sub> ~ N(θ<sub>i</sub>, v<sub>i</sub>)</li>
  <li>Between-study: θ<sub>i</sub> | μ, τ ~ N(μ, τ²)</li>
  <li>Prior on μ: N(μ₀, σ<sub>μ</sub>²) — conjugate, centred on <em>μ₀</em></li>
  <li>Prior on τ: HalfNormal(σ<sub>τ</sub>) — weakly informative, keeps τ ≥ 0</li>
</ul>
<p><strong>Grid approximation:</strong> Because the prior on μ is conjugate
given τ, the posterior of μ|τ is analytic — a normal distribution with
mean m(τ) and variance V(τ) obtainable in closed form. Only a 1-D grid over
τ (300 points) is required. Each grid weight is proportional to the marginal
likelihood p(y|τ) multiplied by the half-normal prior on τ.</p>
<p>The marginal posterior of μ is then a mixture of normals,
Σ<sub>g</sub> w<sub>g</sub> N(μ; m<sub>g</sub>, V<sub>g</sub>), giving
smooth posterior summaries without MCMC.</p>
<p><strong>Prior inputs:</strong></p>
<ul>
  <li><em>μ₀</em> — prior mean for the overall effect (default 0)</li>
  <li><em>σ<sub>μ</sub></em> — prior SD for the overall effect (default 1).
    Smaller values regularise more strongly toward μ₀.</li>
  <li><em>σ<sub>τ</sub></em> — scale of the HalfNormal prior on τ (default 0.5).
    Values around 0.3–1 are conventional for log-ratio scales;
    use a larger value for raw-mean-difference scales.</li>
</ul>
<p><strong>Outputs:</strong></p>
<ul>
  <li>Posterior mean and 95 % credible interval for μ (overall effect)</li>
  <li>Posterior mean and 95 % credible interval for τ (heterogeneity SD)</li>
  <li>Plots of the marginal posterior densities for μ and τ</li>
</ul>
<p><strong>Prior inputs</strong> are accessible in the
<em>Bayesian Meta-Analysis</em> section of the Results tab.</p>
<p><strong>Diffuse priors:</strong> Setting σ<sub>μ</sub> and σ<sub>τ</sub>
to large values (e.g., 100) yields results close to the frequentist
random-effects estimate. The posterior mean of μ will approach the REML
pooled estimate when the prior is uninformative.</p>
<p><strong>Prior sensitivity:</strong> Bayesian conclusions can depend on prior
choices, especially with few studies or high heterogeneity. Recommended
practice is to re-run the analysis with at least two prior specifications
(e.g., the default σ<sub>τ</sub> = 0.5 and a more diffuse σ<sub>τ</sub> = 1 or
2) and check whether the posterior mean and CrI change substantially. If
results are robust across plausible priors, conclusions are more credible.
Turner et al. (2012) provide empirically derived prior distributions for τ
in medical research settings that can inform σ<sub>τ</sub> choice.</p>
<p><strong>Interpretation:</strong> Credible intervals (CrI) have a direct
probability interpretation — there is a 95 % posterior probability that μ
lies within the reported interval, given the data and prior. This differs from
the frequentist confidence interval, which is a statement about the procedure
rather than the specific interval.</p>`,
        citations: [
          "Gelman, A., Carlin, J. B., Stern, H. S., Dunson, D. B., Vehtari, A., & Rubin, D. B. (2013). <em>Bayesian Data Analysis</em> (3rd ed.). CRC Press.",
          "Higgins, J. P. T., & Whitehead, A. (1996). Borrowing strength from external trials in a meta-analysis. <em>Statistics in Medicine, 15</em>(24), 2733–2749.",
          "Turner, R. M., Davey, J., Clarke, M. J., Thompson, S. G., & Higgins, J. P. T. (2012). Predicting the extent of heterogeneity in meta-analysis, using empirical data from the Cochrane Database of Systematic Reviews. <em>International Journal of Epidemiology, 41</em>(3), 818–827.",
        ],
      },

    ],
  },

];

// ------------------------------------------------------------------ //
// Cross-link map: help.js key → guide topic id                        //
// ------------------------------------------------------------------ //
export const HELP_TO_GUIDE = {
  "effect.SMD":       "guide-smd",
  "effect.SMDH":      "guide-smdh",
  "effect.MD":        "guide-md",
  "effect.MD_paired": "guide-md-paired",
  "effect.SMD_paired":"guide-smd-paired",
  "effect.SMCC":      "guide-smcc",
  "effect.ROM":       "guide-rom",
  "effect.CVR":       "guide-cvr",
  "effect.VR":        "guide-vr",
  "effect.OR":        "guide-or",
  "effect.RR":        "guide-rr",
  "effect.RD":        "guide-rd",
  "effect.AS":        "guide-as",
  "effect.HR":        "guide-hr",
  "effect.IRR":       "guide-irr",
  "effect.IR":        "guide-ir",
  "effect.MN":        "guide-mn",
  "effect.MNLN":      "guide-mnln",
  "effect.COR":       "guide-zcor",
  "effect.UCOR":      "guide-ucor",
  "effect.ZCOR":      "guide-zcor",
  "effect.PCOR":      "guide-zcor",
  "effect.ZPCOR":     "guide-zcor",
  "effect.PHI":       "guide-proportions",
  "effect.RTET":      "guide-proportions",
  "effect.PR":        "guide-proportions",
  "effect.PLN":       "guide-proportions",
  "effect.PLO":       "guide-proportions",
  "effect.PAS":       "guide-proportions",
  "effect.PFT":       "guide-proportions",
  "effect.GOR":       "guide-or",
  "effect.GENERIC":   "guide-generic",
  "tau.DL":           "guide-dl",
  "tau.REML":         "guide-reml",
  "tau.PM":           "guide-pm",
  "tau.ML":           "guide-reml",
  "tau.HS":           "guide-tau-overview",
  "tau.HE":           "guide-tau-overview",
  "tau.SJ":           "guide-tau-overview",
  "tau.GENQ":         "guide-tau-overview",
  "tau.SQGENQ":       "guide-tau-overview",
  "tau.DLIT":         "guide-dl",
  "tau.EBLUP":        "guide-reml",
  "tau.HSk":          "guide-tau-overview",
  "ci.normal":        "guide-ci-normal",
  "ci.KH":            "guide-ci-kh",
  "ci.t":             "guide-ci-t",
  "ci.PL":            "guide-ci-pl",
  "het.Q":            "guide-cochran-q",
  "het.I2":           "guide-i2",
  "het.tau2":         "guide-tau2",
  "het.H2":           "guide-i2",
  "het.pred":         "guide-prediction-interval",
  "bias.egger":       "guide-egger",
  "bias.begg":        "guide-begg",
  "bias.trimfill":    "guide-trimfill",
  "bias.fsn":         "guide-fsn",
  "bias.tes":         "guide-tes",
  "bias.fatpet":      "guide-fatpet",
  "bias.petpeese":    "guide-petpeese",
  "bias.harbord":     "guide-binary-bias",
  "bias.peters":      "guide-binary-bias",
  "bias.deeks":       "guide-binary-bias",
  "bias.ruecker":     "guide-binary-bias",
  "cumorder.input":           "guide-cumulative",
  "cumorder.precision_desc":  "guide-cumulative",
  "cumorder.precision_asc":   "guide-cumulative",
  "cumorder.effect_asc":      "guide-cumulative",
  "cumorder.effect_desc":     "guide-cumulative",
  "sens.loo":         "guide-forest",
  "sens.estimator":   "guide-tau-overview",
  "bias.pcurve":      "guide-pcurve",
  "bias.puniform":    "guide-puniform",
  "sel.model":        "guide-selection-model",
  "diag.blup":        "guide-blup",
  "diag.baujat":      "guide-baujat",
  "diag.labbe":       "guide-labbe",
  "diag.gosh":        "guide-gosh",
  "diag.profileLik":  "guide-profile-lik-tau2",
  "diag.influence":   "guide-influence",
  "diag.dffits":      "guide-dffits",
  "diag.covratio":    "guide-covratio",
  "diag.subgroup":       "guide-subgroup",
  "diag.metaregression": "guide-metaregression",
  "diag.nonlinear-reg":  "guide-nonlinear-reg",
  "diag.locationscale":  "guide-location-scale",
  "input.scaleModerators": "guide-location-scale",
  "diag.qqplot":         "guide-qqplot",
  "diag.radial":         "guide-radial",
  "reg.aic":             "guide-aic-bic",
  "input.moderators":    "guide-subgroup",
  "input.rob":           "guide-rob",
  "bayes.model":         "guide-bayes-meta",
  "bayes.tau":           "guide-bayes-meta",
  "plot.forest":         "guide-forest",
  "plot.funnel":         "guide-funnel-plot",
  "plot.cumulative":     "guide-cumulative",
  "plot.orchard":        "guide-orchard",
  "plot.caterpillar":    "guide-caterpillar",
  "plot.rob":            "guide-rob",
  "tau.MH":              "guide-mantel-haenszel",
  "tau.Peto":            "guide-mantel-haenszel",
  "cluster.id":          "guide-cluster-robust",
  "cluster.robust":      "guide-cluster-robust",
  "threelevel.model":    "guide-three-level",
  "threelevel.tau2":     "guide-three-level",
  "threelevel.I2":       "guide-three-level",
};

// ------------------------------------------------------------------ //
// DOM renderer                                                         //
// ------------------------------------------------------------------ //

let _rendered = false;

/**
 * Build the guide DOM inside `container` on first call; no-op thereafter.
 * Expected container structure after render:
 *
 *   <aside class="guide-sidebar">  (navigation links)
 *   <div class="guide-content">    (section + topic articles)
 *
 * Both children are expected to exist as the first two children of `container`.
 */
export function renderGuide(container) {
  if (_rendered) return;

  const sidebar = container.querySelector(".guide-sidebar");
  const content = container.querySelector(".guide-content");
  if (!sidebar || !content) return;

  _rendered = true;

  for (const section of GUIDE) {
    // --- Sidebar section heading ---
    const secLink = document.createElement("div");
    secLink.className = "guide-nav-section";
    secLink.textContent = section.heading;
    sidebar.appendChild(secLink);

    // --- Sidebar topic links ---
    for (const topic of section.topics) {
      const link = document.createElement("a");
      link.className = "guide-nav-link";
      link.href = `#${topic.id}`;
      link.textContent = topic.title;
      link.dataset.target = topic.id;
      sidebar.appendChild(link);
    }

    // --- Content section heading ---
    const secHeading = document.createElement("h2");
    secHeading.className = "guide-section-heading";
    secHeading.id = section.id;
    secHeading.textContent = section.heading;
    content.appendChild(secHeading);

    // --- Topic articles ---
    for (const topic of section.topics) {
      const article = document.createElement("article");
      article.className = "guide-topic";
      article.id = topic.id;

      const h3 = document.createElement("h3");
      h3.textContent = topic.title;
      article.appendChild(h3);

      const bodyDiv = document.createElement("div");
      bodyDiv.className = "guide-topic-body";
      bodyDiv.innerHTML = topic.body;
      article.appendChild(bodyDiv);

      if (topic.citations.length > 0) {
        const refHeading = document.createElement("p");
        refHeading.className = "guide-ref-heading";
        refHeading.textContent = "References";
        article.appendChild(refHeading);

        const ol = document.createElement("ol");
        ol.className = "guide-refs";
        for (const cite of topic.citations) {
          const li = document.createElement("li");
          li.innerHTML = cite;
          ol.appendChild(li);
        }
        article.appendChild(ol);
      }

      content.appendChild(article);
    }
  }

  // --- Active-link tracking via IntersectionObserver ---
  const navLinks = sidebar.querySelectorAll(".guide-nav-link");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(l => l.classList.toggle("active", l.dataset.target === id));
        }
      }
    },
    { root: content, rootMargin: "0px 0px -60% 0px", threshold: 0 }
  );
  content.querySelectorAll(".guide-topic").forEach(el => observer.observe(el));
}
