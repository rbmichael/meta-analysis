# Meta-Analysis

A browser-based meta-analysis tool. No installation, no server, no dependencies beyond a modern browser. All computation runs locally in JavaScript.

---

## Features

### Effect types

35 effect measures across 9 categories:

| Category | Measures |
|---|---|
| Continuous (two groups) | Mean Difference (MD), Standardized Mean Difference — Hedges' *g* (SMD), SMD heteroscedastic (SMDH), Ratio of Means (ROM) |
| Continuous (paired) | Mean Difference Paired (MD_paired), Standardized Mean Change — pre-SD (SMD_paired), Standardized Mean Change — change-score SD (SMCC) |
| Continuous (single group) | One-sample SMD (SMD1), One-sample SMD heteroscedastic (SMD1H), Mean raw (MN), Mean log (MNLN) |
| Variability | Coefficient of Variation Ratio (CVR), Variability Ratio (VR) |
| Binary outcomes | Odds Ratio (OR), Risk Ratio (RR), Risk Difference (RD), Arcsine-transformed Risk Difference (AS), Yule's Q (YUQ), Yule's Y (YUY), Generalised Odds Ratio — ordinal (GOR) |
| Correlations | Pearson *r* (COR), Bias-corrected *r* (UCOR), Fisher's *z* (ZCOR), Partial *r* (PCOR), Partial Fisher's *z* (ZPCOR), Point-biserial (RPB), Biserial (RBIS), R² (R2), Fisher-z R² (ZR2), Phi (PHI), Tetrachoric (RTET) |
| Proportions | Raw (PR), Log (PLN), Logit (PLO), Arcsine (PAS), Freeman-Tukey double arcsine (PFT) |
| Time-to-event / Rates | Hazard Ratio (HR), Incidence Rate Ratio (IRR), Incidence Rate Difference (IRD), Incidence Rate Difference sqrt (IRSD), Incidence Rate log (IR) |
| Generic | Pre-computed *yᵢ* / *vᵢ* (GENERIC) |

### Heterogeneity

- **τ² estimators:** REML (default), DerSimonian-Laird (DL), Paule-Mandel (PM), Empirical Bayes (EB), Paule-Mandel Median (PMM), Generalised Q Median (GENQM), Maximum Likelihood, Hunter-Schmidt, Hedges, Sidik-Jonkman, Generalized Q (GENQ), Iterated DL (DLIT), Hunter-Schmidt corrected (HSk), Square-root GENQ (SQGENQ), EBLUP (= REML) — 15 options
- **Pooling methods:** Inverse-variance (default; RE and FE); **Mantel-Haenszel** (OR, RR, RD) and **Peto one-step** (OR only) — fixed-effects pooling that operates directly on cell counts and handles single-zero cells without a continuity correction
- **CI methods:** Normal/Wald, Knapp-Hartung, *t*-distribution, Profile Likelihood (requires REML or ML)
- **Common Language Effect Size (CLES)** — shown for SMD-family types (SMD, SMDH, SMD_paired, SMD1, SMD1H, SMCC); CLES = Φ(d / √2) = probability that a randomly drawn score from group 1 exceeds group 2; 95% CI from the RE CI endpoints (McGraw & Wong 1992)
- **Heterogeneity statistics:** Cochran's *Q*, *I*², *H*², τ², 95% prediction interval (Higgins 2009, *t*\_{*k*−2})
- **Confidence intervals on heterogeneity:** Profile-likelihood CIs for τ², *I*², *H*²
- **Profile likelihood plot for τ²** — full likelihood surface with LRT-based 95% CI; x-axis toggles between τ² and τ; available for ML and REML only

### Publication bias

- **Egger's regression** — intercept test for funnel plot asymmetry
- **Begg's rank correlation** — Kendall's τ_b with tie correction
- **FAT-PET / PET-PEESE** — funnel asymmetry test, precision-effect test, and the two-stage PET-PEESE correction (Stanley & Doucouliagos 2014); when FAT detects bias (p < .10) the PEESE intercept is highlighted as the corrected effect estimate; the PEESE regression line is overlaid on the contour-enhanced funnel plot
- **Harbord's test** — score-based Egger variant for binary OR studies; avoids inflated Type I error when effect size and SE share cell-count information (Harbord et al. 2006)
- **Peters' test** — WLS regression on 1/*N*; works with any effect type where total *N* is available; preferred over Egger for OR/RR (Peters et al. 2006)
- **Deeks' test** — funnel-asymmetry test for diagnostic accuracy (DOR) studies using effective sample size as the precision surrogate (Deeks et al. 2005)
- **Rücker's test** — arcsine-transformation Egger variant for binary outcomes with better-controlled Type I error (Rücker et al. 2008)
- **Test of Excess Significance (TES)** — compares observed significant results (O) against expected given per-study power; χ² = (O−E)²/[E(1−E/k)]; p < .10 flags excess significance (Ioannidis & Trikalinos 2007)
- **WAAP-WLS** — Weighted Average of Adequately Powered studies; restricts pooling to studies with ≥ 80% power to detect the FE estimate; fallback to full WLS if none qualify; a WAAP near zero with a large RE estimate is a sign of publication bias (Stanley & Doucouliagos 2015)
- **Henmi-Copas bias-robust CI** — confidence interval robust to publication bias; always uses DL τ² and FE weights; centred on the FE estimate with CI width determined by numerical integration over the conditional distribution of Q; wider than the standard RE CI when small-study effects are present (Henmi & Copas 2010)
- **Fail-safe N** — Rosenthal and Orwin estimators
- **Trim-and-fill** (L0, R0, Q0 estimators) — imputes missing studies and reports the adjusted pooled estimate; estimator selectable in the UI
- **Funnel plot** — standard or contour-enhanced (p-value regions at α = .10, .05, .01)
- **Selection model (Vevea-Hedges)** — ω-weighted likelihood model for publication bias; MLE mode (k ≥ 8) estimates selection weights jointly with μ and τ²; fixed-ω sensitivity presets (Mild / Moderate / Severe, Vevea & Woods 2005) available from k ≥ 3

### P-value analyses

- **P-curve** — distribution of significant p-values; tests for evidential value and right-skew
- **P-uniform*** — effect size estimate corrected for publication bias using the p-value distribution

### Sensitivity and influence

- **Leave-one-out analysis** — flags studies whose omission would flip statistical significance
- **Influence diagnostics table** — Cook's distance, DFBETA, DFFITS, covariance ratio, hat values (*h*ᵢ), standardised residuals, Δτ²
- **Influence plot** — per-study leverage and influence visualised
- **BLUPs** — per-study Empirical Bayes shrunken estimates with CIs; visualises shrinkage toward μ̂ (shown when τ² > 0)
- **Baujat plot** — heterogeneity contribution vs. overall influence; identifies problematic studies
- **Normal Q-Q plot** — normal probability plot of internally standardised residuals; assesses the normality assumption of the RE distribution
- **Radial (Galbraith) plot** — precision (1/seᵢ) vs. standardised effect (yᵢ/seᵢ); regression line through origin has slope = FE pooled estimate; dashed ±2 band; orange outliers; right axis shows effect-size scale
- **L'Abbé plot** — treatment vs. control event rate per study (binary outcomes: OR, RR, RD); reveals treatment × baseline-risk interactions
- **GOSH plot** — fixed-effects pooled estimate and I² for every non-empty subset of studies; exact enumeration for k ≤ 15, random-sampled for k ≤ 30 (default 50 000 subsets)
- **Estimator comparison** — runs all τ² estimators side-by-side for a given dataset
- **Cumulative meta-analysis** — adds studies in user-selected order (input order, precision ascending/descending, effect size ascending/descending)

### Dependent effect sizes

When a primary study contributes multiple effect sizes (different outcomes, subgroups, or time points) three complementary approaches are available. All are activated automatically when a non-blank **Cluster ID** is entered for any row:

| Method | What changes | User parameter |
|---|---|---|
| **Cluster-robust SE** | SE only (point estimate unchanged); sandwich CR1 correction on the RE estimate | — |
| **RVE (Robust Variance Estimation)** | Separate WLS estimator using a working covariance model; CR1 sandwich SE | ρ — assumed within-cluster correlation (default 0.80) |
| **Three-Level Meta-Analysis** | Explicit variance decomposition: σ²_within (level-2) and σ²_between (level-3); REML via BFGS | — |

The three-level model fits the marginal covariance Σ<sub>i</sub> = diag(v<sub>ij</sub> + σ²<sub>within</sub>) + σ²<sub>between</sub>·**1**·**1**ᵀ per cluster and reports decomposed I²<sub>within</sub> and I²<sub>between</sub>.

### Meta-regression

Continuous and categorical moderators. Multiple moderators may be added simultaneously. Results include coefficients, standard errors, *z*/*t* statistics, *p*-values, *R*² (proportion of heterogeneity explained), and model-fit indices (AIC, BIC, log-likelihood) for comparing competing models. Bubble plots are generated per continuous moderator.

**Non-linear transforms** (Poly², Poly³, RCS 3–5 knots) are available via the moderator transform dropdown.

**Per-moderator tests** — when 2+ moderators are present, each moderator is tested individually via both a **Wald QM** statistic and a **Likelihood Ratio Test (LRT)**. LRT = 2·(LL_ML,full − LL_ML,reduced) ~ χ²(df); always uses ML internally regardless of the selected τ² method, since REML log-likelihoods cannot be compared across different fixed-effect structures. LRT is generally preferred over Wald in small samples.

**Multiple comparison correction** — Bonferroni or Holm adjustment of per-moderator omnibus QM p-values when m ≥ 2 moderators are tested simultaneously. Adjusted p-values displayed alongside raw values in the per-moderator tests table. Matches `p.adjust(method="bonferroni"/"holm")` in R (Holm, 1979).

**Location-scale model** — add scale moderators (log τ² = Zγ) to model heterogeneity simultaneously with the mean effect. Each study gets its own τ̂²ᵢ = exp(Zᵢγ̂). Estimated by ML via profile likelihood. Equivalent to `rma(..., scale = ~ ..., method = "ML")` in metafor (Viechtbauer, 2021).

### Subgroup analysis

Studies can be assigned to named groups via the Group column. Pooled estimates are reported within each subgroup alongside Q_between, degrees of freedom, and the between-group p-value.

### Risk of bias

A built-in RoB assessment panel accepts user-defined domains and Low / Some concerns / High / Not reported ratings per study. Results are visualised as a traffic light plot (per-study) and a summary bar chart (per-domain).

### Bayesian meta-analysis

Conjugate normal-normal random-effects model fit via grid approximation (300 points over τ) — no MCMC, no external libraries. Prior on μ: N(μ₀, σ_μ²); prior on τ: HalfNormal(σ_τ). Because the prior on μ is conjugate given τ, the marginal posterior of μ is an analytic mixture of normals. Reports posterior mean and 95% credible interval for μ (overall effect) and τ (heterogeneity SD), plus posterior density plots for both parameters. Diffuse priors recover the REML random-effects estimate.

- **Bayes Factor BF₁₀** — Savage-Dickey density ratio testing H₁: μ ≠ 0 vs H₀: μ = 0. BF₁₀ = prior density(0) / posterior density(0). Reported alongside log(BF₁₀) and a Jeffreys (1961) verbal interpretation (Anecdotal / Moderate / Strong / Very strong / Decisive for H₁ or H₀).
- **Prior sensitivity analysis** — loops the Bayesian model over a 3 × 3 grid of (σ_μ, σ_τ) pairs ({0.5, 1, 2} × {0.25, 0.5, 1}, nine combinations) and tabulates the posterior mean μ, credible interval, and BF₁₀ for each. Triggered by the *Prior Sensitivity* button. Robust conclusions are stable across the grid.

---

## Plots

All plots export as SVG, PNG, or TIFF. Log-scale effect types label the axis in the display scale (e.g. OR, RR).

| Plot | Description |
|---|---|
| Forest plot | Study CIs + pooled diamond(s). Toggle FE only, RE only, or both. Four visual themes (default, Cochrane, JAMA, black & white). Paginated for large datasets. |
| Funnel plot | Effect vs. SE with Egger regression line. Toggle between standard and contour-enhanced modes. |
| Influence plot | Per-study leverage and Cook's distance visualised as a bubble chart. |
| BLUPs | Dual caterpillar: observed yi (gray) vs. shrunken BLUP (accent) per study. Shrinkage lines, hover tooltips. Only when τ² > 0. |
| Baujat plot | Scatter of heterogeneity contribution vs. overall influence; quadrant guides at the mean. |
| Normal Q-Q plot | Normal probability plot of standardised residuals from the RE model. Reference line through Q1/Q3. Orange = potential outliers (|z| > 2). |
| Radial (Galbraith) plot | Precision (1/seᵢ) vs. standardised effect (yᵢ/seᵢ). Solid line through origin: slope = FE pooled estimate. Dashed ±2 band. Orange = outliers. Right axis: effect-size scale. |
| L'Abbé plot | Treatment vs. control event rate per study (binary outcomes). Reference diagonal = no effect; dashed curve = pooled RE estimate. |
| Cumulative forest plot | Cumulative pooled estimate as studies are added in sequence. Paginated. |
| Cumulative funnel plot | Funnel view at each cumulative step; slider-controlled. |
| Orchard plot | Effect estimates as dots sized by precision, with RE diamond and 95% prediction interval. |
| Caterpillar plot | Studies sorted by effect size with 95% CIs; group colour-coding. Paginated. |
| P-curve | Distribution of significant p-values with right-skew and flat tests. |
| P-uniform* | Publication-bias-corrected effect size estimate. |
| RoB traffic light | Per-study, per-domain risk-of-bias ratings as a colour-coded grid. |
| RoB summary | Stacked bar chart showing domain-level rating distributions. |
| GOSH plot | Fixed-effects μ̂ and I² for every non-empty subset of studies. Exact for k ≤ 15; sampled for k ≤ 30. |
| Profile likelihood (τ²) | Profile log-likelihood curve for τ² with LRT-based 95% CI. x-axis toggles between τ² and τ. ML/REML only. |
| Bubble plots | Meta-regression fit per continuous moderator, bubbles sized by weight. |

---

## Data input

- **Manual entry** — inline editable table; rows validate on input with per-field error highlighting
- **CSV import** — auto-detects delimiter and effect type from column headers; shows a preview panel with column-mapping controls before committing
- **Session save / load** — full application state (data, settings, moderators, RoB ratings) serialised to JSON
- **Auto-save** — drafts written to `localStorage`; a recovery banner appears on next load if unsaved changes exist
- **Cluster ID column** — optional study identifier for dependent effect sizes (e.g. multiple outcomes or subgroups from the same trial); activates cluster-robust SE, RVE, and three-level meta-analysis sections in the results panel

CSV column names match the input fields for each effect type (e.g. `m1,sd1,n1,m2,sd2,n2` for MD; `a,b,c,d` for OR). A `label` column is optional but recommended. A `group` column assigns studies to subgroups.

---

## Output and export

- **HTML report** — self-contained document with all results tables and plots embedded as inline SVG
- **Word (.docx)** — exports all results tables and plots to a Word document via OOXML/JSZip; no server required
- **PDF** — print-to-PDF via the browser print dialog
- **SVG / PNG / TIFF** — individual plot export from the plot toolbar
- **APA tables** — checkbox to format all tables to APA 7th edition style (no vertical lines, merged CI columns, *Note* paragraphs); applies to both HTML and Word exports

---

## Interface

- **Three-panel layout** — Input, Results, and Guide tabs
- **Collapsible "More settings"** — advanced Input options (moderators, RoB domains, cluster ID, Bayesian priors) tucked behind a disclosure element to keep the default view uncluttered
- **Collapsible results sections** — sections are collapsed by default; only core results and the forest plot are open on load, reducing visual overwhelm on large analyses
- **Light and dark themes** — follows system preference by default; toggle available in the settings bar
- **In-app methodology guide** — reference documentation for every statistical method in the tool, accessible from the Guide tab or via contextual help buttons (?) throughout the interface

---

## Usage

> **Note:** The app uses ES modules (`type="module"` scripts). Browsers block ES module imports over the `file://` protocol due to CORS restrictions, so **double-clicking `index.html` will not work**. You must serve the files from a local web server.

### Running locally

**Option 1 — Python (no install):**
```
python -m http.server 8080
# then open http://localhost:8080 in your browser
```

**Option 2 — Node.js:**
```
npx serve .
# then open http://localhost:3000
```

**Option 3 — esbuild bundle (single-file, works offline without a server):**
```
npm install --save-dev esbuild
npx esbuild js/ui.js --bundle --outfile=bundle.js --format=iife --global-name=App
```
Then replace the `<script type="module">` tags in `index.html` with `<script src="bundle.js"></script>`. The bundled file can be opened directly via `file://` because it contains no ES module imports.

### Getting started
```
git clone https://github.com/rbmichael/meta-analysis.git
cd meta-analysis
python -m http.server 8080
# open http://localhost:8080
```

---

## Statistical references

- Borenstein M, Hedges LV, Higgins JPT, Rothstein HR (2009). *Introduction to Meta-Analysis*. Wiley.
- DerSimonian R, Laird N (1986). Meta-analysis in clinical trials. *Controlled Clinical Trials*, 7, 177–188.
- Galbraith RF (1988). Graphical display of estimates having differing standard errors. *Technometrics*, 30(3), 271–281.
- Gelman A, Carlin JB, Stern HS, Dunson DB, Vehtari A, Rubin DB (2013). *Bayesian Data Analysis* (3rd ed.). CRC Press.
- Hedges LV, Tipton E, Johnson MC (2010). Robust variance estimation in meta-regression with dependent effect size estimates. *Res Synth Methods*, 1, 39–65.
- Mantel N, Haenszel W (1959). Statistical aspects of the analysis of data from retrospective studies of disease. *J Natl Cancer Inst*, 22, 719–748.
- McGraw KO, Wong SP (1992). A common language effect size statistic. *Psychol Bull*, 111(2), 361–365.
- Peto R, Pike MC, Armitage P, et al. (1976). Design and analysis of randomized clinical trials requiring prolonged observation of each patient. *Br J Cancer*, 34, 585–612.
- Harville DA (1977). Maximum likelihood approaches to variance component estimation and to related problems. *J Am Stat Assoc*, 72(358), 320–338.
- Harrell FE Jr (2015). *Regression Modeling Strategies* (2nd ed.). Springer.
- Henmi M, Copas JB (2010). Confidence intervals for random effects meta-analysis and robustness to publication bias. *Stat Med*, 29(29), 2969–2983.
- Hedges LV, Olkin I (1985). *Statistical Methods for Meta-Analysis*. Academic Press.
- Higgins JPT, Thompson SG, Spiegelhalter DJ (2009). A re-evaluation of random-effects meta-analysis. *J R Stat Soc A*, 172, 137–159.
- Holm S (1979). A simple sequentially rejective multiple test procedure. *Scand J Stat*, 6(2), 65–70.
- Ioannidis JPA, Trikalinos TA (2007). An exploratory test for an excess of significant findings. *Clin Trials*, 4(3), 245–253.
- Jeffreys H (1961). *Theory of Probability* (3rd ed.). Oxford University Press.
- Kraemer HC (1975). On estimation and hypothesis testing problems for correlation coefficients. *Psychometrika*, 40(4), 473–485.
- Knapp G, Hartung J (2003). Improved tests for a random effects meta-regression with a single covariate. *Stat Med*, 22, 2693–2710.
- Morris CN (1983). Parametric empirical Bayes inference: Theory and applications. *J Am Stat Assoc*, 78(381), 47–55.
- Morris SB (2008). Estimating effect sizes from pretest-posttest-control group designs. *Org Res Methods*, 11, 364–386.
- Paule RC, Mandel J (1982). Consensus values and weighting factors. *J Res Natl Bur Stand*, 87, 377–385.
- Olkin I, Pratt JW (1958). Unbiased estimation of certain correlation coefficients. *Ann Math Stat*, 29(1), 201–211.
- Olkin I, Dahabreh IJ, Trikalinos TA (2012). GOSH — a graphical display of study heterogeneity. *Res Synth Methods*, 3(3), 214–223.
- Deeks JJ, Macaskill P, Irwig L (2005). The performance of tests of publication bias and other sample size effects in systematic reviews of diagnostic test accuracy was assessed. *J Clin Epidemiol*, 58(9), 882–893.
- Harbord RM, Egger M, Sterne JAC (2006). A modified test for small-study effects in meta-analyses of controlled trials with binary endpoints. *Stat Med*, 25(20), 3443–3457.
- Peters JL, Sutton AJ, Jones DR, Abrams KR, Rushton L (2006). Comparison of two methods to detect publication bias in meta-analysis. *JAMA*, 295(6), 676–680.
- Rücker G, Schwarzer G, Carpenter J (2008). Arcsine test for publication bias in meta-analyses with binary outcomes. *Stat Med*, 27(19), 4450–4465.
- Simonsohn U, Nelson LD, Simmons JP (2014). P-curve: A key to the file-drawer. *J Exp Psychol Gen*, 143(2), 534–547.
- Stanley TD, Doucouliagos H (2014). Meta-regression approximations to reduce publication selection bias. *Res Synth Methods*, 5(1), 60–78.
- Stanley TD, Doucouliagos H (2015). Neither fixed nor random: Weighted least squares meta-regression. *Res Synth Methods*, 6(1), 67–87.
- Stone CJ, Koo C-Y (1985). Additive splines in statistics. *ASA Proceedings of the Statistical Computing Section*, 45–48.
- Van den Noortgate W, López-López JA, Marín-Martínez F, Sánchez-Meca J (2013). Three-level meta-analysis of dependent effect sizes. *Behav Res Methods*, 45(2), 576–594.
- van Assen MALM, van Aert RCM, Wicherts JM (2015). Meta-analysis using effect size distributions of only statistically significant studies. *Psychol Methods*, 20(3), 293–309.
- Vevea JL, Hedges LV (1995). A general linear model for estimating effect size in the presence of publication bias. *Psychometrika*, 60(3), 419–435.
- Viechtbauer W (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. *J Educ Behav Stat*, 30, 261–293.
- Viechtbauer W (2007). Confidence intervals for the amount of heterogeneity in meta-analysis. *Stat Med*, 26(1), 37–52.
- Viechtbauer W (2010). Conducting meta-analyses in R with the metafor package. *J Stat Softw*, 36(3), 1–48.
- Viechtbauer W (2021). Location-scale models for meta-analytic data. *Res Synth Methods*, 12(5), 567–583.
- Viechtbauer W, Cheung MWL (2010). Outlier and influence diagnostics for meta-analysis. *Res Synth Methods*, 1(2), 112–125.
- Wagenmakers EJ, Lodewyckx T, Kuriyal H, Grasman R (2010). Bayesian hypothesis testing for psychologists: A tutorial on the Savage-Dickey method. *Cogn Psychol*, 60(3), 158–189.
- Yule GU (1900). On the association of attributes in statistics. *Phil Trans R Soc Lond A*, 194, 257–319.
- Yule GU (1912). On the methods of measuring association between two attributes. *J R Stat Soc*, 75(6), 579–642.

---

## License

MIT
