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
- **CI methods:** Normal/Wald, Knapp-Hartung, *t*-distribution, Profile Likelihood (requires REML or ML)
- **Heterogeneity statistics:** Cochran's *Q*, *I*², *H*², τ², 95% prediction interval (Higgins 2009, *t*\_{*k*−2})
- **Confidence intervals on heterogeneity:** Profile-likelihood CIs for τ², *I*², *H*²

### Publication bias

- **Egger's regression** — intercept test for funnel plot asymmetry
- **Begg's rank correlation** — Kendall's τ_b with tie correction
- **FAT-PET** — funnel asymmetry test and precision-effect test
- **Fail-safe N** — Rosenthal and Orwin estimators
- **Trim-and-fill** (L0 estimator) — imputes missing studies and reports the adjusted pooled estimate
- **Funnel plot** — standard or contour-enhanced (p-value regions at α = .10, .05, .01)

### P-value analyses

- **P-curve** — distribution of significant p-values; tests for evidential value and right-skew
- **P-uniform*** — effect size estimate corrected for publication bias using the p-value distribution

### Sensitivity and influence

- **Leave-one-out analysis** — flags studies whose omission would flip statistical significance
- **Influence diagnostics table** — Cook's distance, DFBETA, hat values (*h*ᵢ), standardised residuals, Δτ²
- **Influence plot** — per-study leverage and influence visualised
- **Baujat plot** — heterogeneity contribution vs. overall influence; identifies problematic studies
- **Estimator comparison** — runs all 7 τ² estimators side-by-side for a given dataset
- **Cumulative meta-analysis** — adds studies in user-selected order (input order, precision ascending/descending, effect size ascending/descending)

### Meta-regression

Continuous and categorical moderators. Multiple moderators may be added simultaneously. Results include coefficients, standard errors, *z*/*t* statistics, *p*-values, and *R*² (proportion of heterogeneity explained). Bubble plots are generated per continuous moderator.

### Subgroup analysis

Studies can be assigned to named groups via the Group column. Pooled estimates are reported within each subgroup alongside Q_between, degrees of freedom, and the between-group p-value.

### Risk of bias

A built-in RoB assessment panel accepts user-defined domains and Low / Some concerns / High / Not reported ratings per study. Results are visualised as a traffic light plot (per-study) and a summary bar chart (per-domain).

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
| Bubble plots | Meta-regression fit per continuous moderator, bubbles sized by weight. |

---

## Data input

- **Manual entry** — inline editable table; rows validate on input with per-field error highlighting
- **CSV import** — auto-detects delimiter and effect type from column headers; shows a preview panel with column-mapping controls before committing
- **Session save / load** — full application state (data, settings, moderators, RoB ratings) serialised to JSON
- **Auto-save** — drafts written to `localStorage`; a recovery banner appears on next load if unsaved changes exist

CSV column names match the input fields for each effect type (e.g. `m1,sd1,n1,m2,sd2,n2` for MD; `a,b,c,d` for OR). A `label` column is optional but recommended. A `group` column assigns studies to subgroups.

---

## Output and export

- **HTML report** — self-contained document with all results tables and plots embedded as inline SVG
- **PDF** — print-to-PDF via the browser print dialog
- **SVG / PNG / TIFF** — individual plot export from the plot toolbar

---

## Interface

- **Three-panel layout** — Input, Results, and Guide tabs
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
- Hedges LV, Olkin I (1985). *Statistical Methods for Meta-Analysis*. Academic Press.
- Higgins JPT, Thompson SG, Spiegelhalter DJ (2009). A re-evaluation of random-effects meta-analysis. *J R Stat Soc A*, 172, 137–159.
- Knapp G, Hartung J (2003). Improved tests for a random effects meta-regression with a single covariate. *Stat Med*, 22, 2693–2710.
- Morris SB (2008). Estimating effect sizes from pretest-posttest-control group designs. *Org Res Methods*, 11, 364–386.
- Paule RC, Mandel J (1982). Consensus values and weighting factors. *J Res Natl Bur Stand*, 87, 377–385.
- Simonsohn U, Nelson LD, Simmons JP (2014). P-curve: A key to the file-drawer. *J Exp Psychol Gen*, 143(2), 534–547.
- van Assen MALM, van Aert RCM, Wicherts JM (2015). Meta-analysis using effect size distributions of only statistically significant studies. *Psychol Methods*, 20(3), 293–309.
- Viechtbauer W (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. *J Educ Behav Stat*, 30, 261–293.
- Viechtbauer W (2010). Conducting meta-analyses in R with the metafor package. *J Stat Softw*, 36(3), 1–48.

---

## License

MIT
