# Meta-Analysis

A browser-based meta-analysis tool. No installation, no server, no dependencies beyond a modern browser. All computation runs locally in JavaScript.

---

## Features

### Effect types

31 effect measures across 9 categories, grouped in the UI:

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

- **τ² estimators:** REML (default), DerSimonian-Laird, Paule-Mandel, Maximum Likelihood, Hunter-Schmidt, Hedges, Sidik-Jonkman, Generalized Q
- **CI methods:** Normal/Wald, Knapp-Hartung, *t*-distribution, Profile Likelihood (requires REML or ML)
- **Heterogeneity statistics:** Cochran's *Q*, *I*², *H*², τ², 95% prediction interval (Higgins 2009, *t*\_{*k*−2})
- **Confidence intervals on heterogeneity:** Profile-likelihood CIs for τ², *I*², *H*²

### Publication bias

| Test | Appropriate for |
|---|---|
| Egger's regression | Continuous outcomes |
| Begg's rank correlation (τ_b, tie-corrected) | Any |
| FAT-PET | Any |
| Harbord's test | Binary outcomes (OR) |
| Peters' test | Binary outcomes |
| Deeks' test | Diagnostic accuracy |
| Rücker's test | Binary outcomes |

Trim-and-fill (L0 estimator) imputes missing studies and reports the adjusted pooled estimate. Rosenthal fail-safe N and Orwin fail-safe N are also available.

### Sensitivity and influence

- **Leave-one-out analysis** — flags studies whose omission would flip statistical significance
- **Influence diagnostics** — Cook's distance, DFFITS, DFBETAS, hat values (*h*ᵢ), standardised residuals
- **Estimator comparison** — runs all 8 τ² estimators side-by-side for a given dataset
- **Cumulative meta-analysis** — adds studies in user-selected order (input order, precision, effect size)

### Meta-regression

Continuous and categorical moderators. Multiple moderators may be added simultaneously. Results include coefficients, standard errors, *z*/*t* statistics, *p*-values, and *R*² (proportion of heterogeneity explained). Bubble plots are generated per continuous moderator.

### Subgroup analysis

Studies can be assigned to named groups. Pooled estimates are reported within each subgroup alongside the overall pooled estimate.

---

## Plots

| Plot | Description |
|---|---|
| Forest plot | Study CIs + pooled diamond. Toggle FE only, RE only, or both. Paginated for large datasets. |
| Funnel plot | Effect vs. SE with Egger regression line. |
| Influence plot | Leverage and influence diagnostics visualised per study. |
| Cumulative forest | Cumulative pooled estimate as studies are added in order. |
| Bubble plots | Meta-regression fit per continuous moderator, bubbles sized by weight. |

All plots export as SVG or PNG. Log-scale effect types annotate the axis accordingly.

---

## Data input

- **Manual entry** — inline editable table; rows validate on input with per-field error highlighting
- **CSV import** — auto-detects delimiter and effect type from column headers; shows a preview panel before committing
- **Session save / load** — full application state (data, settings, moderators) serialised to JSON
- **Auto-save** — drafts written to `localStorage`; a recovery banner appears on next load

CSV column names match the input fields for each effect type (e.g. `m1,sd1,n1,m2,sd2,n2` for MD; `a,b,c,d` for OR). A `label` column is optional but recommended.

---

## Output and export

- **HTML report** — self-contained document with all results tables and plots
- **PDF** — print-to-PDF via the browser
- **SVG / PNG** — individual plot export from the plot toolbar

---

## Usage

Open `index.html` in any modern browser. No build step, no package manager, no internet connection required after the page loads (fonts are fetched from Google Fonts on first load; all statistical computation is local).

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
- Viechtbauer W (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. *J Educ Behav Stat*, 30, 261–293.
- Viechtbauer W (2010). Conducting meta-analyses in R with the metafor package. *J Stat Softw*, 36(3), 1–48.

---

## License

MIT
