# Meta-Analysis

A browser-based meta-analysis tool. No installation, no server, no dependencies beyond a modern browser. All computation runs locally in JavaScript.

---

## Features

### Effect types

31 effect measures across 9 categories:

| Category | Measures |
|---|---|
| Continuous (two groups) | Mean Difference (MD), Standardized Mean Difference — Hedges' *g* (SMD), SMD heteroscedastic (SMDH), Ratio of Means (ROM) |
| Continuous (paired) | Mean Difference Paired (MD_paired), Standardized Mean Change — pre-SD (SMD_paired), Standardized Mean Change — change-score SD (SMCC) |
| Continuous (single group) | Mean raw (MN), Mean log (MNLN) |
| Variability | Coefficient of Variation Ratio (CVR), Variability Ratio (VR) |
| Binary outcomes | Odds Ratio (OR), Risk Ratio (RR), Risk Difference (RD), Generalised Odds Ratio — ordinal (GOR) |
| Correlations | Pearson *r* (COR), Fisher's *z* (ZCOR), Partial *r* (PCOR), Partial Fisher's *z* (ZPCOR), Phi (PHI), Tetrachoric (RTET) |
| Proportions | Raw (PR), Log (PLN), Logit (PLO), Arcsine (PAS), Freeman-Tukey double arcsine (PFT) |
| Time-to-event / Rates | Hazard Ratio (HR), Incidence Rate Ratio (IRR), Incidence Rate log (IR) |
| Generic | Pre-computed *yᵢ* / *vᵢ* (GENERIC) |

### Heterogeneity

- **τ² estimators:** REML (default), DerSimonian-Laird, Paule-Mandel, Maximum Likelihood, Hunter-Schmidt, Hedges, Sidik-Jonkman
- **Pooling methods:** Inverse-variance (default; RE and FE); **Mantel-Haenszel** (OR, RR, RD) and **Peto one-step** (OR only) — fixed-effects pooling that operates directly on cell counts and handles single-zero cells without a continuity correction
- **CI methods:** Normal/Wald, Knapp-Hartung, *t*-distribution, Profile Likelihood (requires REML or ML)
- **Heterogeneity statistics:** Cochran's *Q*, *I*², *H*², τ², 95% prediction interval (Higgins 2009, *t*\_{*k*−2})
- **Confidence intervals on heterogeneity:** Profile-likelihood CIs for τ², *I*², *H*²
- **Profile likelihood plot for τ²** — full likelihood surface with LRT-based 95% CI; x-axis toggles between τ² and τ; available for ML and REML only

### Publication bias

- **Egger's regression** — intercept test for funnel plot asymmetry
- **Begg's rank correlation** — Kendall's τ_b with tie correction
- **FAT-PET** — funnel asymmetry test and precision-effect test
- **Fail-safe N** — Rosenthal and Orwin estimators
- **Trim-and-fill** (L0 estimator) — imputes missing studies and reports the adjusted pooled estimate
- **Funnel plot** — standard or contour-enhanced (p-value regions at α = .10, .05, .01)
- **Selection model (Vevea-Hedges)** — ω-weighted likelihood model for publication bias; MLE mode (k ≥ 8) estimates selection weights jointly with μ and τ²; fixed-ω sensitivity presets (Mild / Moderate / Severe, Vevea & Woods 2005) available from k ≥ 3

### P-value analyses

- **P-curve** — distribution of significant p-values; tests for evidential value and right-skew
- **P-uniform*** — effect size estimate corrected for publication bias using the p-value distribution

### Sensitivity and influence

- **Leave-one-out analysis** — flags studies whose omission would flip statistical significance
- **Influence diagnostics table** — Cook's distance, DFBETA, hat values (*h*ᵢ), standardised residuals, Δτ²
- **Influence plot** — per-study leverage and influence visualised
- **Baujat plot** — heterogeneity contribution vs. overall influence; identifies problematic studies
- **GOSH plot** — fixed-effects pooled estimate and I² for every non-empty subset of studies; exact enumeration for k ≤ 15, random-sampled for k ≤ 30 (default 50 000 subsets)
- **Estimator comparison** — runs all 7 τ² estimators side-by-side for a given dataset
- **Cumulative meta-analysis** — adds studies in user-selected order (input order, precision ascending/descending, effect size ascending/descending)

### Meta-regression

Continuous and categorical moderators. Multiple moderators may be added simultaneously. Results include coefficients, standard errors, *z*/*t* statistics, *p*-values, and *R*² (proportion of heterogeneity explained). Bubble plots are generated per continuous moderator.

### Subgroup analysis

Studies can be assigned to named groups via the Group column. Pooled estimates are reported within each subgroup alongside Q_between, degrees of freedom, and the between-group p-value.

### Risk of bias

A built-in RoB assessment panel accepts user-defined domains and Low / Some concerns / High / Not reported ratings per study. Results are visualised as a traffic light plot (per-study) and a summary bar chart (per-domain).

### Bayesian meta-analysis

Conjugate normal-normal random-effects model fit via grid approximation (300 points over τ) — no MCMC, no external libraries. Prior on μ: N(μ₀, σ_μ²); prior on τ: HalfNormal(σ_τ). Because the prior on μ is conjugate given τ, the marginal posterior of μ is an analytic mixture of normals. Reports posterior mean and 95% credible interval for μ (overall effect) and τ (heterogeneity SD), plus posterior density plots for both parameters. Diffuse priors recover the REML random-effects estimate.

---

## Plots

All plots export as SVG, PNG, or TIFF. Log-scale effect types label the axis in the display scale (e.g. OR, RR).

| Plot | Description |
|---|---|
| Forest plot | Study CIs + pooled diamond(s). Toggle FE only, RE only, or both. Four visual themes (default, Cochrane, JAMA, black & white). Paginated for large datasets. |
| Funnel plot | Effect vs. SE with Egger regression line. Toggle between standard and contour-enhanced modes. |
| Influence plot | Per-study leverage and Cook's distance visualised as a bubble chart. |
| Baujat plot | Scatter of heterogeneity contribution vs. overall influence; quadrant guides at the mean. |
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
- **Cluster ID column** — optional study identifier for dependent effect sizes (e.g. multiple outcomes or subgroups from the same trial); activates cluster-robust (sandwich) standard errors without changing the point estimate

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

Open `index.html` in any modern browser. No build step, no package manager, no internet connection required after the page loads (fonts are fetched from Google Fonts on first load; all computation is local).

```
git clone https://github.com/rbmichael/meta-analysis.git
cd meta-analysis
# open index.html in your browser
```

---

## Statistical references

- Borenstein M, Hedges LV, Higgins JPT, Rothstein HR (2009). *Introduction to Meta-Analysis*. Wiley.
- DerSimonian R, Laird N (1986). Meta-analysis in clinical trials. *Controlled Clinical Trials*, 7, 177–188.
- Gelman A, Carlin JB, Stern HS, Dunson DB, Vehtari A, Rubin DB (2013). *Bayesian Data Analysis* (3rd ed.). CRC Press.
- Hedges LV, Tipton E, Johnson MC (2010). Robust variance estimation in meta-regression with dependent effect size estimates. *Res Synth Methods*, 1, 39–65.
- Mantel N, Haenszel W (1959). Statistical aspects of the analysis of data from retrospective studies of disease. *J Natl Cancer Inst*, 22, 719–748.
- Peto R, Pike MC, Armitage P, et al. (1976). Design and analysis of randomized clinical trials requiring prolonged observation of each patient. *Br J Cancer*, 34, 585–612.
- Hedges LV, Olkin I (1985). *Statistical Methods for Meta-Analysis*. Academic Press.
- Higgins JPT, Thompson SG, Spiegelhalter DJ (2009). A re-evaluation of random-effects meta-analysis. *J R Stat Soc A*, 172, 137–159.
- Knapp G, Hartung J (2003). Improved tests for a random effects meta-regression with a single covariate. *Stat Med*, 22, 2693–2710.
- Morris SB (2008). Estimating effect sizes from pretest-posttest-control group designs. *Org Res Methods*, 11, 364–386.
- Paule RC, Mandel J (1982). Consensus values and weighting factors. *J Res Natl Bur Stand*, 87, 377–385.
- Olkin I, Dahabreh IJ, Trikalinos TA (2012). GOSH — a graphical display of study heterogeneity. *Res Synth Methods*, 3(3), 214–223.
- Simonsohn U, Nelson LD, Simmons JP (2014). P-curve: A key to the file-drawer. *J Exp Psychol Gen*, 143(2), 534–547.
- van Assen MALM, van Aert RCM, Wicherts JM (2015). Meta-analysis using effect size distributions of only statistically significant studies. *Psychol Methods*, 20(3), 293–309.
- Vevea JL, Hedges LV (1995). A general linear model for estimating effect size in the presence of publication bias. *Psychometrika*, 60(3), 419–435.
- Viechtbauer W (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. *J Educ Behav Stat*, 30, 261–293.
- Viechtbauer W (2010). Conducting meta-analyses in R with the metafor package. *J Stat Softw*, 36(3), 1–48.

---

## License

MIT
