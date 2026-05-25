// =============================================================================
// report.js — HTML report builder and export
// =============================================================================
// Assembles a self-contained, printable HTML report from the last completed
// analysis state and exposes helpers to download it or open a print preview.
//
// Exports
// -------
//   buildReport(args) → string
//     Serialises the current analysis into a full HTML document with embedded
//     styles, SVG plots, and statistics tables.
//
//   downloadHTML(args)
//     Calls buildReport(), wraps the result in a Blob, and triggers a download.
//
//   openPrintPreview(args)
//     Calls buildReport() and opens the result in a new browser tab ready for
//     window.print().
//
// args shape (set by _reportArgs in ui.js):
//   { studies, m, profile, reg, tf, egger, begg, fatpet, fsn, tes,
//     influence, subgroup, method, ciMethod, useTF, mAdjusted,
//     pcurve, puniform,
//     forestOptions }   ← forestOptions = { ciMethod, profile, pageSize, theme }
//
// Dependencies
// ------------
//   format.js    fmt, fmtP, fmtP_APA, fmtCI_APA, escHTML
//   plots.js     drawForest()
//   io.js        downloadBlob()
//   constants.js Z_95
//   export.js    serializeSVG(), collectPagedSVGs()

import { fmt, fmtCI_APA, escHTML, fmtP as _fmtP, fmtP_APA as _fmtP_APA } from "./format.js";
import { drawForest, drawCumulativeForest, drawCaterpillarPlot } from "./plots.js";
import { downloadBlob } from "./io.js";
import { Z_95 } from "./constants.js";
import { normalQuantile } from "./utils.js";
import { adjustPvals } from "./regression.js";
import { serializeSVG, collectPagedSVGs } from "./export.js";
import { summaryData, pubBiasData, pCurveData, puniformData, selModelData,
         influenceData, subgroupData, studyTableData, regressionData,
         regressionFittedData, locationScaleData, permutationData,
         rveData, threeLevelData, sensitivityData,
         bayesData, bayesSensitivityData, cellRich } from "./sections.js";

// serializeSVG and collectPagedSVGs are imported from export.js.

// ---------------------------------------------------------------------------
// Formatting helpers (plain-text core in format.js; wrappers add HTML escaping)
// ---------------------------------------------------------------------------
// fmtP / fmtP_APA wrap the shared versions with escHTML because their output
// may contain '<' (e.g. "<0.0001") and is placed directly into innerHTML.
// fmt and fmtCI_APA are used as-is (em-dash and brackets need no HTML encoding).
function fmtP(p)     { return escHTML(_fmtP(p)); }
function fmtP_APA(p) { return escHTML(_fmtP_APA(p)); }
const esc = escHTML;
// Render a string that may contain <em>…</em> spans as safe HTML.
// Uses cellRich() from sections.js so the parsing logic lives in one place.
function renderRich(s) {
  return cellRich(s).map(r => r.italic ? `<em>${esc(r.text)}</em>` : esc(r.text)).join("");
}

// buildTable(headers, rows, opts) → HTML string
// Shared helper for every stat-table in the report.
//   headers    string[]  — header cell text (HTML-safe strings passed by callers)
//   rows       string[]  — pre-built <tr>…</tr> strings
//   opts.extraClass string  — appended to class="stat-table …"
//   opts.style      string  — inline style on the <table> element
//   opts.tfoot      string  — raw inner HTML for a <tfoot> block (optional)
function buildTable(headers, rows, { extraClass = "", style = "", tfoot = "" } = {}) {
  const cls  = extraClass ? ` ${extraClass}` : "";
  const styl = style      ? ` style="${style}"` : "";
  const head = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.join("")}</tbody>`;
  const foot = tfoot ? `<tfoot>${tfoot}</tfoot>` : "";
  return `<table class="stat-table${cls}"${styl}>${head}${body}${foot}</table>`;
}

// buildTableAPA(tableNum, subtitle, headers, rows, note) → HTML string
// APA 7th edition table: numbered bold title, italic subtitle, three horizontal
// rules only (no vertical lines, no zebra), and a "Note." paragraph in tfoot.
//   tableNum  number   — sequential table number (from nextTable() in buildReport)
//   subtitle  string   — italic descriptor shown below the bold "Table N" line
//   headers   string[] — header cell text (HTML-safe)
//   rows      string[] — pre-built <tr>…</tr> strings (same format as buildTable)
//   note      string   — content after "Note." in tfoot; omit or pass "" to skip
export function buildTableAPA(tableNum, subtitle, headers, rows, note = "") {
  const head = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.join("")}</tbody>`;
  const foot = note
    ? `<tfoot><tr><td colspan="${headers.length}"><span class="apa-note"><em>Note.</em> ${note}</span></td></tr></tfoot>`
    : "";
  return `
<p class="apa-table-title">Table ${tableNum}</p>
<p class="apa-table-subtitle">${esc(subtitle)}</p>
<table class="apa-table">${head}${body}${foot}</table>`;
}

// buildFigureAPA(figNum, title, svgStrings, note) → HTML string
// APA 7th edition figure: bold "Figure N" label, italic title, one SVG div
// per page/panel, and an optional "Note." paragraph below the last panel.
//   figNum     number   — sequential figure number (from nextFigure() in buildReport)
//   title      string   — italic descriptive title (HTML-safe)
//   svgStrings string[] — one serialised SVG string per page/panel
//   note       string   — content after "Note."; omit or pass "" to skip
export function buildFigureAPA(figNum, title, svgStrings, note = "") {
  const panels = svgStrings.filter(Boolean);
  if (!panels.length) return "";
  const noteBlock = note
    ? `<p class="apa-figure-note"><em>Note.</em> ${note}</p>`
    : "";
  return `
<p class="apa-figure-num">Figure ${figNum}</p>
<p class="apa-figure-title">${esc(title)}</p>
${panels.map(s => `<div class="svg-wrap">${s}</div>`).join("\n")}
${noteBlock}`;
}

// ---------------------------------------------------------------------------
// APA citation database (Feature B)
// ---------------------------------------------------------------------------
// Keys are short method identifiers used by collectCitations() and
// sectionReferences().  Values are ready-to-insert HTML strings.

export const CITATIONS = {
  // ── Heterogeneity estimators ──────────────────────────────────────────────
  DL: `DerSimonian, R., &amp; Laird, N. (1986). Meta-analysis in clinical trials. <em>Controlled Clinical Trials</em>, <em>7</em>(3), 177–188. <a href="https://doi.org/10.1016/0197-2456(86)90046-2">https://doi.org/10.1016/0197-2456(86)90046-2</a>`,

  REML: `Viechtbauer, W. (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. <em>Journal of Educational and Behavioral Statistics</em>, <em>30</em>(3), 261–293. <a href="https://doi.org/10.3102/10769986030003261">https://doi.org/10.3102/10769986030003261</a>`,

  PM: `Paule, R. C., &amp; Mandel, J. (1982). Consensus values and weighting factors. <em>Journal of Research of the National Bureau of Standards</em>, <em>87</em>(5), 377–385.`,

  EB: `Morris, C. N. (1983). Parametric empirical Bayes inference: Theory and applications. <em>Journal of the American Statistical Association</em>, <em>78</em>(381), 47–55.`,

  // ML shares the Viechtbauer (2005) citation with REML
  ML: `Viechtbauer, W. (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. <em>Journal of Educational and Behavioral Statistics</em>, <em>30</em>(3), 261–293. <a href="https://doi.org/10.3102/10769986030003261">https://doi.org/10.3102/10769986030003261</a>`,

  HE: `Hedges, L. V. (1983). A random effects model for effect sizes. <em>Psychological Bulletin</em>, <em>93</em>(2), 388–395.`,

  SJ: `Sidik, K., &amp; Jonkman, J. N. (2005). Simple heterogeneity variance estimation for meta-analysis. <em>Journal of the Royal Statistical Society: Series C (Applied Statistics)</em>, <em>54</em>(2), 367–384.`,

  HS: `Hunter, J. E., &amp; Schmidt, F. L. (2004). <em>Methods of meta-analysis</em> (2nd ed.). SAGE.`,

  BM: `Biggerstaff, B. J., &amp; Tweedie, R. L. (1997). Incorporating variability in estimates of heterogeneity in the random effects model in meta-analysis. <em>Statistics in Medicine</em>, <em>16</em>(7), 753–768.`,

  // ── CI methods ────────────────────────────────────────────────────────────
  KH: `Knapp, G., &amp; Hartung, J. (2003). Improved tests for a random effects meta-regression with a single covariate. <em>Statistics in Medicine</em>, <em>22</em>(17), 2693–2710. <a href="https://doi.org/10.1002/sim.1482">https://doi.org/10.1002/sim.1482</a>`,

  PL: `Hardy, R. J., &amp; Thompson, S. G. (1996). A likelihood approach to meta-analysis with random effects. <em>Statistics in Medicine</em>, <em>15</em>(6), 619–629.`,

  // ── Heterogeneity statistics ──────────────────────────────────────────────
  Q: `Cochran, W. G. (1954). The combination of estimates from different experiments. <em>Biometrics</em>, <em>10</em>(1), 101–129.`,

  I2: `Higgins, J. P. T., Thompson, S. G., Deeks, J. J., &amp; Altman, D. G. (2003). Measuring inconsistency in meta-analyses. <em>BMJ</em>, <em>327</em>(7414), 557–560. <a href="https://doi.org/10.1136/bmj.327.7414.557">https://doi.org/10.1136/bmj.327.7414.557</a>`,

  // ── Publication bias ──────────────────────────────────────────────────────
  EGGER: `Egger, M., Smith, G. D., Schneider, M., &amp; Minder, C. (1997). Bias in meta-analysis detected by a simple, graphical test. <em>BMJ</em>, <em>315</em>(7109), 629–634. <a href="https://doi.org/10.1136/bmj.315.7109.629">https://doi.org/10.1136/bmj.315.7109.629</a>`,

  BEGG: `Begg, C. B., &amp; Mazumdar, M. (1994). Operating characteristics of a rank correlation test for publication bias. <em>Biometrics</em>, <em>50</em>(4), 1088–1101. <a href="https://doi.org/10.2307/2533446">https://doi.org/10.2307/2533446</a>`,

  FATPET: `Stanley, T. D. (2005). Beyond publication bias. <em>Journal of Economic Surveys</em>, <em>19</em>(3), 309–345. <a href="https://doi.org/10.1111/j.0950-0804.2005.00250.x">https://doi.org/10.1111/j.0950-0804.2005.00250.x</a>`,

  FSN_R: `Rosenthal, R. (1979). The file drawer problem and tolerance for null results. <em>Psychological Bulletin</em>, <em>86</em>(3), 638–641. <a href="https://doi.org/10.1037/0033-2909.86.3.638">https://doi.org/10.1037/0033-2909.86.3.638</a>`,

  FSN_O: `Orwin, R. G. (1983). A fail-safe N for effect size in meta-analysis. <em>Journal of Educational Statistics</em>, <em>8</em>(2), 157–159.`,

  TF: `Duval, S., &amp; Tweedie, R. (2000a). Trim and fill: A simple funnel-plot–based method of testing and adjusting for publication bias in meta-analysis. <em>Biometrics</em>, <em>56</em>(2), 455–463. <a href="https://doi.org/10.1111/j.0006-341X.2000.00455.x">https://doi.org/10.1111/j.0006-341X.2000.00455.x</a><br>Duval, S., &amp; Tweedie, R. (2000b). A nonparametric "trim and fill" method of accounting for publication bias in meta-analysis. <em>Journal of the American Statistical Association</em>, <em>95</em>(449), 89–98.`,

  TES: `Ioannidis, J. P. A., &amp; Trikalinos, T. A. (2007). An exploratory test for an excess of significant findings. <em>Clinical Trials</em>, <em>4</em>(3), 245–253. <a href="https://doi.org/10.1177/1740774507079441">https://doi.org/10.1177/1740774507079441</a>`,

  PCURVE: `Simonsohn, U., Nelson, L. D., &amp; Simmons, J. P. (2014). P-curve: A key to the file-drawer. <em>Journal of Experimental Psychology: General</em>, <em>143</em>(2), 534–547. <a href="https://doi.org/10.1037/a0033242">https://doi.org/10.1037/a0033242</a>`,

  PUNIF: `van Assen, M. A. L. M., van Aert, R. C. M., &amp; Wicherts, J. M. (2015). Meta-analysis using effect size distributions of only statistically significant studies. <em>Psychological Methods</em>, <em>20</em>(3), 293–309. <a href="https://doi.org/10.1037/met0000025">https://doi.org/10.1037/met0000025</a>`,

  VH: `Vevea, J. L., &amp; Hedges, L. V. (1995). A general linear model for estimating effect size in the presence of publication bias. <em>Psychometrika</em>, <em>60</em>(3), 419–435. <a href="https://doi.org/10.1007/BF02294384">https://doi.org/10.1007/BF02294384</a>`,

  HARBORD: `Harbord, R. M., Egger, M., &amp; Sterne, J. A. C. (2006). A modified test for small-study effects in meta-analyses of controlled trials with binary endpoints. <em>Statistics in Medicine</em>, <em>25</em>(20), 3443–3457. <a href="https://doi.org/10.1002/sim.2380">https://doi.org/10.1002/sim.2380</a>`,

  PETERS: `Peters, J. L., Sutton, A. J., Jones, D. R., Abrams, K. R., &amp; Rushton, L. (2006). Comparison of two methods to detect publication bias in meta-analysis. <em>JAMA</em>, <em>295</em>(6), 676–680. <a href="https://doi.org/10.1001/jama.295.6.676">https://doi.org/10.1001/jama.295.6.676</a>`,

  DEEKS: `Deeks, J. J., Macaskill, P., &amp; Irwig, L. (2005). The performance of tests of publication bias and other sample size effects in systematic reviews of diagnostic test accuracy was assessed. <em>Journal of Clinical Epidemiology</em>, <em>58</em>(9), 882–893. <a href="https://doi.org/10.1016/j.jclinepi.2005.01.016">https://doi.org/10.1016/j.jclinepi.2005.01.016</a>`,

  RUECKER: `Rücker, G., Schwarzer, G., &amp; Carpenter, J. (2008). Arcsine test for publication bias in meta-analyses with binary outcomes. <em>Statistics in Medicine</em>, <em>27</em>(19), 4450–4465. <a href="https://doi.org/10.1002/sim.3007">https://doi.org/10.1002/sim.3007</a>`,

  HC: `Henmi, M., &amp; Copas, J. B. (2010). Confidence intervals for random effects meta-analysis and robustness to publication bias. <em>Statistics in Medicine</em>, <em>29</em>(29), 2969–2983. <a href="https://doi.org/10.1002/sim.4029">https://doi.org/10.1002/sim.4029</a>`,

  // ── Meta-regression ───────────────────────────────────────────────────────
  MREG: `Thompson, S. G., &amp; Sharp, S. J. (1999). Explaining heterogeneity in meta-analysis: A comparison of methods. <em>Statistics in Medicine</em>, <em>18</em>(20), 2693–2708.`,

  // ── Location-scale model ──────────────────────────────────────────────────
  LS: `Viechtbauer, W., López-López, J. A., Sánchez-Meca, J., &amp; Marín-Martínez, F. (2015). A comparison of procedures to test for moderators in mixed-effects meta-regression models. <em>Psychological Methods</em>, <em>20</em>(3), 360–374. <a href="https://doi.org/10.1037/met0000023">https://doi.org/10.1037/met0000023</a>`,

  // ── Permutation test ──────────────────────────────────────────────────────
  PERM: `Viechtbauer, W., López-López, J. A., Sánchez-Meca, J., &amp; Marín-Martínez, F. (2015). A comparison of procedures to test for moderators in mixed-effects meta-regression models. <em>Psychological Methods</em>, <em>20</em>(3), 360–374. <a href="https://doi.org/10.1037/met0000023">https://doi.org/10.1037/met0000023</a>`,

  // ── Cluster-robust SE ─────────────────────────────────────────────────────
  CRSE: `Hedges, L. V., Tipton, E., &amp; Johnson, M. C. (2010). Robust variance estimation in meta-regression with dependent effect size estimates. <em>Research Synthesis Methods</em>, <em>1</em>(1), 39–65. <a href="https://doi.org/10.1002/jrsm.5">https://doi.org/10.1002/jrsm.5</a>`,

  // ── RVE ───────────────────────────────────────────────────────────────────
  RVE: `Hedges, L. V., Tipton, E., &amp; Johnson, M. C. (2010). Robust variance estimation in meta-regression with dependent effect size estimates. <em>Research Synthesis Methods</em>, <em>1</em>(1), 39–65. <a href="https://doi.org/10.1002/jrsm.5">https://doi.org/10.1002/jrsm.5</a>`,

  // ── Three-level MA ────────────────────────────────────────────────────────
  THREE: `Cheung, M. W.-L. (2014). Modeling dependent effect sizes with three-level meta-analyses: A structural equation modeling approach. <em>Psychological Methods</em>, <em>19</em>(2), 211–229. <a href="https://doi.org/10.1037/a0032968">https://doi.org/10.1037/a0032968</a>`,

  // ── WAAP-WLS ──────────────────────────────────────────────────────────────
  WAAP: `Stanley, T. D., &amp; Doucouliagos, H. (2014). Meta-regression approximations to reduce publication selection bias. <em>Research Synthesis Methods</em>, <em>5</em>(1), 60–78. <a href="https://doi.org/10.1002/jrsm.1095">https://doi.org/10.1002/jrsm.1095</a>`,

  // ── GOSH ─────────────────────────────────────────────────────────────────
  GOSH: `Olkin, I., Dahabreh, I. J., &amp; Trikalinos, T. A. (2012). GOSH — a graphical display of study heterogeneity. <em>Research Synthesis Methods</em>, <em>3</em>(3), 214–223. <a href="https://doi.org/10.1002/jrsm.1053">https://doi.org/10.1002/jrsm.1053</a>`,

  // ── MH / Peto ────────────────────────────────────────────────────────────
  MH: `Mantel, N., &amp; Haenszel, W. (1959). Statistical aspects of the analysis of data from retrospective studies of disease. <em>Journal of the National Cancer Institute</em>, <em>22</em>(4), 719–748.`,

  PETO: `Yusuf, S., Peto, R., Lewis, J., Collins, R., &amp; Sleight, P. (1985). Beta blockade during and after myocardial infarction: An overview of the randomized trials. <em>Progress in Cardiovascular Diseases</em>, <em>27</em>(5), 335–371. <a href="https://doi.org/10.1016/S0033-0620(85)80003-7">https://doi.org/10.1016/S0033-0620(85)80003-7</a>`,

  // ── Influence diagnostics ─────────────────────────────────────────────────
  INFL: `Viechtbauer, W., &amp; Cheung, M. W.-L. (2010). Outlier and influence diagnostics for meta-analysis. <em>Research Synthesis Methods</em>, <em>1</em>(2), 112–125. <a href="https://doi.org/10.1002/jrsm.11">https://doi.org/10.1002/jrsm.11</a>`,

  // ── Bayesian ──────────────────────────────────────────────────────────────
  BAYES: `Sutton, A. J., &amp; Abrams, K. R. (2001). Bayesian methods in meta-analysis and evidence synthesis. <em>Statistical Methods in Medical Research</em>, <em>10</em>(4), 277–303. <a href="https://doi.org/10.1177/096228020101000404">https://doi.org/10.1177/096228020101000404</a>`,
};

// collectCitations(args) → string[]
// Inspects the report args and returns an ordered, de-duplicated array of
// CITATIONS keys for every statistical method actually used in this analysis.
// The canonical key order matches the plan (estimator → CI → Q/I² →
// pub-bias → regression → influence → Bayesian).
export function collectCitations(args) {
  const {
    method, ciMethod,
    egger, begg, fatpet, fsn,
    harbord, peters, deeks, ruecker,
    useTF, tf,
    puniform, pcurve,
    sel,
    reg,
    influence,
    bayesResult,
    waap,
    rveResult,
    threeLevelResult,
    permResult,
  } = args;

  const keys = [];
  const seen = new Set();
  function add(key) {
    if (key && !seen.has(key)) { seen.add(key); keys.push(key); }
  }

  // Fixed-effects binary pooling
  if (args.m?.isMH)   add("MH");
  if (args.m?.isPeto) add("PETO");

  // τ² estimator
  const methodMap = {
    DL: "DL", REML: "REML", PM: "PM", EB: "EB", ML: "ML",
    HE: "HE", SJ: "SJ", HS: "HS", BM: "BM",
  };
  add(methodMap[method]);

  // CI method
  if (ciMethod === "KH") add("KH");
  if (ciMethod === "PL") add("PL");

  // Heterogeneity statistics — always present
  add("Q");
  add("I2");

  // Publication bias tests
  if (egger   && isFinite(egger.p))             add("EGGER");
  if (begg    && isFinite(begg.p))              add("BEGG");
  if (fatpet  && isFinite(fatpet.p))            add("FATPET");
  if (harbord && isFinite(harbord.interceptP))  add("HARBORD");
  if (peters  && isFinite(peters.interceptP))   add("PETERS");
  if (deeks   && isFinite(deeks.interceptP))    add("DEEKS");
  if (ruecker && isFinite(ruecker.interceptP))  add("RUECKER");
  if (fsn    && isFinite(fsn.rosenthal)) add("FSN_R");
  if (fsn    && isFinite(fsn.orwin))     add("FSN_O");
  if (args.tes && isFinite(args.tes.chi2)) add("TES");
  if (args.hc  && !args.hc.error)  add("HC");
  if (useTF  && tf && tf.length)    add("TF");
  if (pcurve && pcurve.k >= 3)      add("PCURVE");
  if (puniform && puniform.k >= 3)  add("PUNIF");
  if (sel    && !sel.error)         add("VH");
  if (waap   && isFinite(waap.estimate)) add("WAAP");

  // Cluster-robust SE / RVE / Three-level
  if (reg?.isClustered)                          add("CRSE");
  if (rveResult    && !rveResult.error)          add("RVE");
  if (threeLevelResult && !threeLevelResult.error) add("THREE");

  // Meta-regression
  if (reg && !reg.rankDeficient) add("MREG");

  // Location-scale / permutation
  if (args.ls && !args.ls.rankDeficient)         add("LS");
  if (permResult && permResult.nPerm > 0)        add("PERM");

  // Influence diagnostics
  if (influence && influence.length) add("INFL");

  // GOSH
  if (args.gosh && args.gosh.count > 0) add("GOSH");

  // Bayesian
  if (bayesResult && !bayesResult.error) add("BAYES");

  return keys;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

// sectionSummary(args) → HTML string
// Builds the "Summary" <section> of the exported report.
// Renders two tables: (1) analysis settings (effect type, τ² estimator,
// CI method, k), and (2) pooled statistics (FE/RE estimates, CI, prediction
// interval, τ², I², H²-CI, Q and dist-statistic).
// All estimates are back-transformed through profile.transform() before
// formatting, so OR/RR/HR are displayed on their natural (ratio) scale.
// Trim-fill adjusted RE is included as an extra row when useTF and mAdjusted
// are both truthy.
function sectionSummary(args) {
  const { m, profile, method, ciMethod, useTF, tf, studies, nextTable, ciLevel } = args;
  const k           = studies.filter(d => !d.filled).length;
  const methodLabel = m.isMH ? "Mantel-Haenszel" : m.isPeto ? "Peto" : method;
  const ciLabel     = ciMethod === "KH" ? "Knapp-Hartung"
                    : ciMethod === "t"  ? "t-distribution"
                    : ciMethod === "PL" ? "Profile Likelihood"
                    : "Normal (z)";

  const settingsProse = `<p class="meta-line">
    Effect type: ${esc(profile.label)} &nbsp;·&nbsp;
    Pooling: ${esc(methodLabel)} &nbsp;·&nbsp;
    CI method: ${esc(ciLabel)} &nbsp;·&nbsp;
    k = ${k}${tf.length > 0 ? ` + ${tf.length} imputed (trim &amp; fill)` : ""}
  </p>`;

  const d = summaryData(args);
  const statsRows = d.rows.map(([label, value], i) => {
    const valCell = i === d.reRowIdx ? `<strong>${renderRich(value)}</strong>` : renderRich(value);
    return `<tr><td>${renderRich(label)}</td><td>${valCell}</td></tr>`;
  });
  const statsTable = buildTableAPA(nextTable(), d.subtitle, d.headers, statsRows, renderRich(d.note));

  return `
<section>
  <h2>Summary</h2>
  ${settingsProse}
  ${statsTable}
</section>`;
}

// sectionPubBias(args) → HTML string
// Builds the "Publication Bias" <section> of the exported report.
// Renders a three-column table (test, statistic, p-value) covering:
//   Egger's test (intercept), Begg's test (rank correlation τ),
//   FAT (funnel asymmetry test β₁), PET (effect at SE → 0).
// Followed by fail-safe N paragraph (Rosenthal + Orwin) and trim-and-fill
// status. PET estimate is back-transformed through profile.transform().
// "NA (k < 3)" is shown for any test that requires at least 3 studies.
function sectionPubBias(args) {
  const { useTF, tf, nextTable, nextFigure, profile,
          fsnTrivial = 0.1, fsnDirection = "auto" } = args;

  const fsnProse = `
  <p style="margin-top:10px">
    Fail-safe N (Rosenthal): <strong>${isFinite(args.fsn.rosenthal) ? Math.round(args.fsn.rosenthal) : "—"}</strong>
    &nbsp;·&nbsp;
    Fail-safe N (Orwin, trivial = ${fsnTrivial}, dir = ${fsnDirection}): <strong>${isFinite(args.fsn.orwin) ? Math.round(args.fsn.orwin) : "—"}</strong>
  </p>
  <p>Trim &amp; Fill: <strong>${useTF ? "ON" : "OFF"}</strong>${tf.length > 0 ? ` (${tf.length} filled)` : ""}</p>`;

  const d = pubBiasData(args);
  const rows = d.rows.map(([t, s, p]) =>
    `<tr><td>${renderRich(t)}</td><td>${renderRich(s)}</td><td>${renderRich(p)}</td></tr>`);
  const table = buildTableAPA(nextTable(), "Tests of Publication Bias",
    d.headers, rows, renderRich(d.note));

  const { funnelSVG } = args;
  const funnelFig = funnelSVG
    ? buildFigureAPA(nextFigure(),
        `Funnel plot of ${esc(profile.label)} against standard error`,
        [funnelSVG],
        `Each point = one study. Asymmetry may indicate publication bias or between-study heterogeneity.`)
    : "";

  return `
<section>
  <h2>Publication Bias</h2>
  ${table}
  ${fsnProse}
  ${funnelFig}
</section>`;
}

function sectionPCurve(pcurve, nextTable) {
  const d = pCurveData(pcurve);
  if (!d) return "";
  const rows = d.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
  return `
<section>
  <h2>P-curve (Simonsohn et al., 2014)</h2>
  <p class="meta-line">${renderRich(d.kLine)}  ·  Verdict: <strong>${esc(d.verdict)}</strong></p>
  ${buildTableAPA(nextTable(), "P-curve Test Statistics", d.headers, rows, renderRich(d.note))}
</section>`;
}

function sectionPUniform(puniform, m, profile, nextTable, widthCiLabel = "95% CI") {
  if (!puniform || puniform.k < 3 || !isFinite(puniform.estimate)) return "";
  const d = puniformData({ puniform, m, profile, ciLevel: widthCiLabel.replace("% CI", "") });
  const rows = d.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
  return `
<section>
  <h2>P-uniform (van Assen et al., 2015)</h2>
  <p class="meta-line">${renderRich(d.kLine)}</p>
  ${buildTableAPA(nextTable(), "P-uniform Bias-Corrected Estimates", d.headers, rows, renderRich(d.note))}
</section>`;
}

// sectionSelectionModel(sel, profile, selMode, selLabel, nextTable) → HTML string
function sectionSelectionModel(sel, profile, selMode, selLabel, nextTable, widthCiLabel = "95% CI") {
  if (!sel || sel.error) return "";
  const d = selModelData({ sel, profile, selMode, selLabel, ciLevel: widthCiLabel.replace("% CI", "") });
  const K = d.nCols - 1;
  const htmlRows = d.rows.map((r, ri) => {
    if (r.length === 2) {
      return `<tr><td>${renderRich(r[0])}</td><td colspan="${K}">${renderRich(r[1])}</td></tr>`;
    }
    return `<tr>${r.map((c, ci) => {
      if (ci > 0 && ri === 1 && c === "0") return `<td class="flagged">${c}</td>`;
      return `<td>${renderRich(c)}</td>`;
    }).join("")}</tr>`;
  });
  const emptyWarning = (() => {
    const empty = d.nPerInterval.map((n, j) => n === 0 ? j + 1 : -1).filter(j => j > 0);
    return empty.length > 0
      ? ` Warning: interval${empty.length > 1 ? "s" : ""} ${empty.join(", ")} ha${empty.length > 1 ? "ve" : "s"} 0 studies.`
      : "";
  })();
  const convWarning = d.isMLE && !d.converged ? " Optimizer did not fully converge; results may be approximate." : "";
  const direction = sel.mu > sel.RE_unsel ? "higher" : "lower";
  const schemeText = d.isMLE ? "the estimated selection pattern" : `<em>${esc(selLabel)}</em> selection`;
  const interpNote = `Under ${schemeText} the bias-corrected estimate is ${d.muAdj} [${d.ciLo}, ${d.ciHi}]`
    + ` — ${direction} than the unadjusted RE estimate of ${d.muUnadj}.`
    + (d.isMLE && isFinite(d.LRTp) && d.LRTp < 0.05
        ? ` The LRT rejects the null of no selection (<em>p</em> ${fmtP_APA(d.LRTp)}).`
        : "");
  const note = renderRich(d.note) + " " + interpNote + emptyWarning + convWarning;
  return `
<section>
  <h2>Selection Model (Vevea-Hedges, 1995)</h2>
  <p class="meta-line">${renderRich(d.metaLine)}</p>
  ${buildTableAPA(nextTable(), "Vevea-Hedges Selection Model Results", d.headers, htmlRows, note)}
</section>`;
}

function sectionInfluence(influence, k, nextTable) {
  if (!influence || !influence.length) return "";
  const d = influenceData({ influence, studies: Array.from({ length: k }, () => ({ filled: false })) });
  const apaRows = d.rows.map((r, i) => {
    const cls = d.flagged[i] ? ' class="flagged"' : "";
    return `<tr${cls}>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
  });
  return `
<section>
  <h2>Influence Diagnostics</h2>
  ${buildTableAPA(nextTable(), "Leave-One-Out Influence Diagnostics", d.headers, apaRows, renderRich(d.note))}
</section>`;
}

function sectionSensitivity(args, nextTable) {
  const d = sensitivityData(args);
  if (!d) return "";
  const widthCiLabel = (args.ciLevel ?? "95") + "% CI";

  const looRows = d.loo.rows.map((r, i) => {
    const flag = d.loo.sigChanges[i] ? ` title="Removing this study changes statistical significance"` : "";
    const mark = d.loo.sigChanges[i] ? " *" : "";
    return `<tr${flag}><td>${renderRich(r[0])}${mark}</td>${r.slice(1).map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
  });
  const looSection = d.loo.rows.length > 0
    ? buildTableAPA(nextTable(), "Leave-one-out analysis", d.loo.headers, looRows, d.loo.note)
    : `<p class="table-note">Need at least 3 studies for leave-one-out analysis.</p>`;

  const estRows = d.est.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
  const estSection = buildTableAPA(nextTable(), `τ² estimator comparison (${widthCiLabel})`, d.est.headers, estRows, d.est.note);

  return `
<section>
  <h2>Sensitivity Analysis</h2>
  ${looSection}
  ${estSection}
</section>`;
}

function sectionSubgroup(subgroup, profile, nextTable, widthCiLabel = "95% CI") {
  if (!subgroup || subgroup.G < 2) return "";
  const d = subgroupData({ subgroup, profile, ciLevel: widthCiLabel.replace("% CI", "") });
  const apaRows = d.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
  const note = renderRich(d.note)
    .replace("<em>Q</em>_total",   "<em>Q</em><sub>total</sub>")
    .replace("<em>Q</em>_within",  "<em>Q</em><sub>within</sub>")
    .replace("<em>Q</em>_between", "<em>Q</em><sub>between</sub>");
  return `
<section>
  <h2>Subgroup Analysis</h2>
  ${buildTableAPA(nextTable(), d.subtitle, d.headers, apaRows, note)}
</section>`;
}

function sectionStudyTable(args) {
  const { studies, m, profile, nextTable, ciLevel } = args;
  const d = studyTableData({ studies, m, profile, ciLevel: ciLevel ?? "95" });
  const bodyRows = d.rows.map((r, i) => {
    const cls = d.filled[i] ? ' class="imputed"' : "";
    return `<tr${cls}>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
  });
  const ncols = d.headers.length;
  const pooled = `<tr class="pooled">${d.pooledRow.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
  const head = `<thead><tr>${d.headers.map(h => `<th>${renderRich(h)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${bodyRows.join("")}</tbody>`;
  const foot = `<tfoot>
    ${pooled}
    <tr><td colspan="${ncols}"><span class="apa-note"><em>Note.</em> ${renderRich(d.note)}</span></td></tr>
  </tfoot>`;
  return `
<section>
  <h2>Study-Level Results</h2>
  <p class="apa-table-title">Table ${nextTable()}</p>
  <p class="apa-table-subtitle">Study-Level Effect Sizes and Weights</p>
  <table class="apa-table">${head}${body}${foot}</table>
</section>`;
}

function sectionRegression(reg, method, ciMethod, nextTable, widthCiLabel = "95% CI", adjPs = null, mccLabel = "") {
  if (!reg || reg.rankDeficient || !reg.colNames) return "";

  const R2row  = reg.p > 1 && isFinite(reg.R2)
    ? ` · R² = ${fmt(reg.R2 * 100)}%` : "";
  const aicRow = isFinite(reg.AIC)
    ? ` · AIC = ${fmt(reg.AIC)} · BIC = ${fmt(reg.BIC)} · LL = ${fmt(reg.LL)}${ciMethod === "KH" && isFinite(reg.s2) ? ` · KH s² = ${fmt(reg.s2)}` : ""}` : "";

  const d = regressionData({ reg, method, ciMethod, ciLevel: widthCiLabel.replace("% CI", ""), adjPs, mccLabel });
  if (!d) return "";
  const coefRows = d.coef.rows.map((r, j) => {
    const cls = j === 0 ? ' class="intercept"' : "";
    return `<tr${cls}>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
  });
  const coefTable = buildTableAPA(nextTable(), "Meta-Regression Coefficients", d.coef.headers, coefRows, renderRich(d.coef.note));
  const modTestsTable = d.modTests
    ? `<h3>Per-moderator omnibus tests</h3>
  ${buildTableAPA(nextTable(), "Per-Moderator Omnibus Tests",
    d.modTests.headers,
    d.modTests.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`),
    renderRich(d.modTests.note))}`
    : "";

  const fd = regressionFittedData(reg);
  const fittedTable = fd
    ? `<h3>Fitted values &amp; residuals</h3>
  ${buildTableAPA(nextTable(), "Meta-Regression Fitted Values and Residuals",
    fd.headers,
    fd.rows.map(({ cells, flag }) => {
      const flagAttr = flag ? ' class="outlier"' : "";
      return `<tr${flagAttr}>${cells.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
    }),
    renderRich(fd.note))}`
    : "";

  return `
<section>
  <h2>Meta-Regression</h2>
  <p class="meta-line">${renderRich(d.metaLine)}${R2row}${aicRow}</p>
  ${coefTable}
  ${modTestsTable}
  ${fittedTable}
</section>`;
}

function sectionBayes(args) {
  const { nextTable, nextFigure, sensitivityRows, svgBayesMu, svgBayesTau } = args;
  const d = bayesData(args);
  if (!d) return "";
  if (!svgBayesMu && !svgBayesTau) return "";
  const bodyRows = d.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
  const sensD    = bayesSensitivityData(sensitivityRows, args.profile, args.ciLevel);
  const sensitivitySection = sensD ? (() => {
    const sensRows = sensD.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
    return `<h3>Prior Sensitivity Analysis</h3>
  ${buildTableAPA(nextTable(), sensD.tableName, sensD.headers, sensRows, renderRich(sensD.note))}`;
  })() : "";
  const plotMu = svgBayesMu
    ? buildFigureAPA(nextFigure(), `Posterior distribution of pooled effect μ (${esc(d.profileLabel)})`, [svgBayesMu], esc(d.muPriorNote))
    : "";
  const plotTau = svgBayesTau
    ? buildFigureAPA(nextFigure(), "Posterior distribution of between-study standard deviation τ", [svgBayesTau], esc(d.tauPriorNote))
    : "";
  return `
<section>
  <h2>Bayesian Meta-Analysis</h2>
  <p class="meta-line">${esc(d.priorLine)}</p>
  ${buildTableAPA(nextTable(), d.tableName, d.headers, bodyRows, renderRich(d.note))}
  ${sensitivitySection}
  ${plotMu}
  ${plotTau}
</section>`;
}

function sectionRve(args, nextTable) {
  const d = rveData(args);
  if (!d) return "";
  const bodyRows = d.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
  return `
<section>
  <h2>Robust Variance Estimation (RVE)</h2>
  ${buildTableAPA(nextTable(), "RVE Pooled Estimate", d.headers, bodyRows, esc(d.note))}
</section>`;
}

function sectionThreeLevel(args, nextTable) {
  const d = threeLevelData(args);
  if (!d) return "";
  const bodyRows = d.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`);
  return `
<section>
  <h2>Three-Level Meta-Analysis</h2>
  ${buildTableAPA(nextTable(), "Three-Level Model Estimates", d.headers, bodyRows, esc(d.note))}
</section>`;
}

function sectionLocationScale(ls, nextTable, widthCiLabel = "95% CI") {
  if (!ls || ls.rankDeficient) return "";
  const d = locationScaleData(ls, widthCiLabel.replace("% CI", ""));
  if (!d) return "";

  const locRows = d.locCoef.rows.map((r, j) => {
    const cls = j === 0 ? ' class="intercept"' : "";
    return `<tr${cls}>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
  });
  const scaleRows = d.scaleCoef.rows.map((r, j) => {
    const cls = j === 0 ? ' class="intercept"' : "";
    return `<tr${cls}>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`;
  });
  const locTable   = buildTableAPA(nextTable(), "Location Model Coefficients",   d.locCoef.headers,   locRows,   renderRich(d.locCoef.note));
  const scaleTable = buildTableAPA(nextTable(), "Scale Model Coefficients",       d.scaleCoef.headers, scaleRows, renderRich(d.scaleCoef.note));
  const fittedTable = d.fitted
    ? `<h3>Fitted values &amp; study-specific τ²ᵢ</h3>
  ${buildTableAPA(nextTable(), "Location-Scale Fitted Values", d.fitted.headers,
    d.fitted.rows.map(r => `<tr>${r.map(c => `<td>${renderRich(c)}</td>`).join("")}</tr>`),
    renderRich(d.fitted.note))}`
    : "";

  return `
<section>
  <h2>Location-Scale Model</h2>
  <p class="meta-line">${renderRich(d.metaLine)}</p>
  ${locTable}
  ${scaleTable}
  ${fittedTable}
</section>`;
}

function sectionPermutation(permResult, reg, nextTable) {
  if (!permResult || !reg) return "";
  const d = permutationData(permResult, reg);
  if (!d) return "";

  const headers = ["Test", "Statistic", "Observed", "<em>p</em> (perm.)"];
  const allRows = [
    `<tr><td>Omnibus <em>Q</em>M</td><td>${renderRich(d.omniLabel)}</td><td>${fmt(d.omniObserved)}</td><td>${fmtP_APA(d.omniP)}</td></tr>`,
    ...d.mods.map(m =>
      `<tr><td>${esc(m.name)}</td><td>${renderRich(m.label)}</td><td>${isFinite(m.observed) ? fmt(m.observed) : "—"}</td><td>${isFinite(m.p) ? fmtP_APA(m.p) : "—"}</td></tr>`
    ),
  ];
  const note = `${d.nPerm} permutations; τ² re-estimated per permutation. Permutation p = (1 + #≥observed) / (B + 1).`;
  const table = buildTableAPA(nextTable(), "Permutation Test Results", headers, allRows, esc(note));
  return `
<section>
  <h2>Permutation Test</h2>
  ${table}
</section>`;
}

function sectionPlot(label, svgStrings, nextFigure, apaTitle = "", apaNote = "") {
  const filled = svgStrings.filter(Boolean);
  if (!filled.length) return "";
  const title = apaTitle || label;
  return `
<section class="plot-section">
  <h2>${esc(label)}</h2>
  ${buildFigureAPA(nextFigure(), title, filled, apaNote)}
</section>`;
}

// ---------------------------------------------------------------------------
// Embedded CSS
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Report CSS helpers
// ---------------------------------------------------------------------------
// CSS variables resolved from the current app theme. Injected as a :root {}
// block ahead of _REPORT_STATIC_CSS so the structural rules can use var(--).
function _reportCSSVars(isLight) {
  const v = isLight ? {
    bodyBg:         "#f5f5f8",
    bodyColor:      "#1a1a1a",
    metaColor:      "#888",
    h2Color:        "#555",
    h2Border:       "#d0d0d0",
    sectionBg:      "#ffffff",
    sectionBorder:  "#ddd",
    thBg:           "#e8e8f0",
    thColor:        "#333",
    thBorder:       "#ddd",
    tdBorder:       "#e0e0e0",
    tdColor:        "#222",
    tdAltBg:        "#f5f5f8",
    imputedColor:   "#999",
    pooledColor:    "#6a5000",
    pooledBg:       "#fffff0",
    pooledBorder:   "#bbb",
    interceptColor: "#777",
    flaggedBg:      "#fff5f5",
    metaLine:       "#555",
    noteColor:      "#888",
  } : {
    bodyBg:         "#121212",
    bodyColor:      "#eee",
    metaColor:      "#666",
    h2Color:        "#888",
    h2Border:       "#2e2e2e",
    sectionBg:      "#1a1a1a",
    sectionBorder:  "#333",
    thBg:           "#1e2840",
    thColor:        "#aac",
    thBorder:       "#333",
    tdBorder:       "#2a2a2a",
    tdColor:        "#ddd",
    tdAltBg:        "#171727",
    imputedColor:   "#555",
    pooledColor:    "#ffd740",
    pooledBg:       "#1e1e10",
    pooledBorder:   "#555",
    interceptColor: "#999",
    flaggedBg:      "#2a1a1a",
    metaLine:       "#aaa",
    noteColor:      "#666",
  };
  return `:root {
    --report-body-bg:         ${v.bodyBg};
    --report-body-color:      ${v.bodyColor};
    --report-meta-color:      ${v.metaColor};
    --report-h2-color:        ${v.h2Color};
    --report-h2-border:       ${v.h2Border};
    --report-section-bg:      ${v.sectionBg};
    --report-section-border:  ${v.sectionBorder};
    --report-th-bg:           ${v.thBg};
    --report-th-color:        ${v.thColor};
    --report-th-border:       ${v.thBorder};
    --report-td-border:       ${v.tdBorder};
    --report-td-color:        ${v.tdColor};
    --report-td-alt-bg:       ${v.tdAltBg};
    --report-imputed-color:   ${v.imputedColor};
    --report-pooled-color:    ${v.pooledColor};
    --report-pooled-bg:       ${v.pooledBg};
    --report-pooled-border:   ${v.pooledBorder};
    --report-intercept-color: ${v.interceptColor};
    --report-flagged-bg:      ${v.flaggedBg};
    --report-meta-line:       ${v.metaLine};
    --report-note-color:      ${v.noteColor};
  }`;
}

// Structural CSS for the standalone HTML report.
// Keep in sync with css/report.css — that file is the canonical source;
// edit there first, then mirror changes here.
const _REPORT_STATIC_CSS = `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      background: var(--report-body-bg);
      color: var(--report-body-color);
      margin: 0;
      padding: 24px 32px;
      font-size: 14px;
    }
    h1 { font-size: 1.4em; margin: 0 0 4px 0; }
    h2 {
      font-size: 0.78em;
      font-weight: bold;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--report-h2-color);
      margin: 0 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--report-h2-border);
    }
    .report-meta { font-size: 0.82em; color: var(--report-meta-color); margin-bottom: 28px; }
    section {
      background: var(--report-section-bg);
      border: 1px solid var(--report-section-border);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
    }
    p { margin: 4px 0; }
    .meta-line { font-size: 0.84em; color: var(--report-meta-line); margin: 0 0 8px 0; }
    .note { font-size: 0.78em; color: var(--report-note-color); margin-top: 6px; }
    .svg-wrap { margin-bottom: 12px; overflow-x: auto; }
    .svg-wrap svg { display: block; }
    .stat-table {
      border-collapse: collapse;
      font-size: 0.88em;
      width: 100%;
      max-width: 900px;
    }
    .stat-table th {
      background: var(--report-th-bg);
      color: var(--report-th-color);
      font-weight: normal;
      text-align: left;
      padding: 5px 10px;
      border: 1px solid var(--report-th-border);
    }
    .stat-table td {
      padding: 5px 10px;
      border: 1px solid var(--report-td-border);
      color: var(--report-td-color);
    }
    .stat-table tbody tr:nth-child(even) td { background: var(--report-td-alt-bg); }
    .study-tbl td:first-child { font-family: monospace; }
    .imputed td   { color: var(--report-imputed-color); font-style: italic; }
    .pooled td    {
      color: var(--report-pooled-color);
      font-weight: bold;
      background: var(--report-pooled-bg) !important;
      border-top: 2px solid var(--report-pooled-border);
    }
    .intercept td { color: var(--report-intercept-color); font-style: italic; }
    .flagged td   { background: var(--report-flagged-bg) !important; }
    .apa-table {
      border-collapse: collapse;
      font-size: 0.88em;
      width: 100%;
      max-width: 900px;
    }
    .apa-table thead th {
      border-top: 2px solid var(--report-body-color);
      border-bottom: 1px solid var(--report-body-color);
      background: none;
      color: var(--report-td-color);
      font-weight: bold;
      text-align: left;
      padding: 4px 8px;
    }
    .apa-table td {
      padding: 3px 8px;
      border: none;
      color: var(--report-td-color);
    }
    .apa-table tfoot td {
      border-top: 2px solid var(--report-body-color);
      padding-top: 5px;
    }
    .apa-table:not(:has(tfoot)) > tbody > tr:last-child > td {
      border-bottom: 2px solid var(--report-body-color);
    }
    .apa-table .imputed td  { color: var(--report-imputed-color); font-style: italic; }
    .apa-table .pooled td   { font-weight: bold; background: none !important; border-top: none; color: var(--report-td-color); }
    .apa-table .flagged td  { font-style: italic; }
    .apa-table .intercept td { color: var(--report-intercept-color); font-style: italic; }
    .apa-table-title    { font-weight: bold; margin: 16px 0 2px 0; font-size: 0.88em; }
    .apa-table-subtitle { font-style: italic; margin: 0 0 4px 0; font-size: 0.88em; }
    .apa-note           { font-size: 0.82em; color: var(--report-note-color); }
    .apa-note em        { font-style: italic; }
    .apa-figure-num     { font-weight: bold; font-size: 0.88em; margin: 16px 0 2px 0; }
    .apa-figure-title   { font-style: italic; font-size: 0.88em; margin: 0 0 4px 0; }
    .apa-figure-note    { font-size: 0.82em; color: var(--report-note-color); margin-top: 4px; }
    .apa-figure-note em { font-style: italic; }
    .apa-references     { padding-left: 0; list-style: none; }
    .apa-references li  { font-size: 0.85em; color: var(--report-td-color); margin-bottom: 6px;
                          padding-left: 2em; text-indent: -2em; }
    .apa-references a   { color: inherit; }
    @media print {
      body { background: #fff; color: #000; padding: 12px 16px; }
      section { background: #fff; border-color: #ccc; page-break-inside: avoid; }
      h2 { color: #444; border-color: #ccc; }
      .stat-table th { background: #e8e8f0; color: #333; }
      .stat-table td { color: #222; }
      .stat-table tbody tr:nth-child(even) td { background: #f5f5f5; }
      .imputed td { color: #999; }
      .pooled td { color: #6a5000; background: #fffff0 !important; }
      .flagged td { background: #fff5f5 !important; }
      .meta-line { color: #555; }
      .note { color: #888; }
      .plot-section { page-break-before: always; }
      .svg-wrap svg { max-width: 100%; height: auto; }
      .apa-table thead th         { border-top-color: #000; border-bottom-color: #000; color: #000; }
      .apa-table tfoot td         { border-top-color: #000; color: #444; }
      .apa-table:not(:has(tfoot)) > tbody > tr:last-child > td { border-bottom-color: #000; }
      .apa-table td               { color: #000; }
      .apa-table .pooled td       { color: #000; font-weight: bold; background: none !important; border-top: none; }
      .apa-table .imputed td      { color: #666; }
      .apa-table-title            { font-weight: bold; color: #000; }
      .apa-table-subtitle         { font-style: italic; color: #000; }
      .apa-note                   { color: #444; }
      .apa-figure-num             { font-weight: bold; color: #000; }
      .apa-figure-title           { font-style: italic; color: #000; }
      .apa-figure-note            { color: #444; }
      .apa-references li          { color: #000; }
      .apa-references a           { color: #000; }
    }
  `;

export function reportCSS() {
  const isLight = document.documentElement.dataset.theme === "light";
  return _reportCSSVars(isLight) + _REPORT_STATIC_CSS;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

// Trigger a browser download of htmlString as a .html file.
// Uses the same Blob / anchor pattern as export.js to ensure Firefox and
// older Safari compatibility (detached-element clicks are silently ignored).
export function downloadHTML(htmlString, filename = "meta-analysis-report.html") {
  downloadBlob(htmlString, filename, "text/html;charset=utf-8");
}

// ---------------------------------------------------------------------------
// Print-preview helper (PDF export)
// ---------------------------------------------------------------------------

// Open the report in a new browser window and immediately invoke the print
// dialog so the user can "Save as PDF" via the browser's built-in PDF printer.
//
// Strategy:
//   1. Open a blank window synchronously (must happen in the same user-gesture
//      tick as the click, otherwise pop-up blockers will suppress it).
//   2. Write the HTML into the new document.
//   3. Wait for all resources (fonts, images embedded in SVGs) to finish
//      loading via the window's load event before calling print().  If the
//      window is already "complete" by the time the listener fires — which can
//      happen when the HTML has no external resources — we call print()
//      immediately.
export function openPrintPreview(htmlString) {
  const win = window.open("", "_blank");
  if (!win) {
    // Pop-up was blocked; fall back to a direct HTML download so the user
    // is not left with a silent failure.
    downloadHTML(htmlString, "meta-analysis-report.html");
    return;
  }

  win.document.open();
  win.document.write(htmlString);
  win.document.close();

  // Use the new window's load event so that inline SVG images (which the
  // browser may decode asynchronously) are fully rendered before printing.
  if (win.document.readyState === "complete") {
    win.print();
  } else {
    win.addEventListener("load", () => win.print(), { once: true });
  }
}

// ---------------------------------------------------------------------------
// sectionGosh(goshResult, profile, xAxis) → HTML string
// ---------------------------------------------------------------------------
// goshResult  — GoshResult object from gosh.js (or null / undefined)
// profile     — effect profile (for axis transform and label)
// xAxis       — "I2" | "Q" | "n"  (the selected x-axis at report-build time)
//
// Re-renders the GOSH plot using SVG circles (forReport:true) so the report
// contains clean vector output rather than an embedded canvas PNG.
// The live #goshPlot element is restored to its screen render after serialization,
// exactly as collectPagedSVGs does for the forest plot.
function sectionGosh(goshResult, profile, xAxis, nextFigure, theme = "default") {
  if (!goshResult || goshResult.error) {
    return `
<section>
  <h2>GOSH Plot</h2>
  <p class="note">GOSH plot not computed — click <em>Compute</em> before generating report.</p>
</section>`;
  }

  const { count, k, sampled } = goshResult;
  const totalPossible = Math.pow(2, k) - 1;
  const xAxisLabel = xAxis === "Q" ? "Q (Cochran's Q)" : xAxis === "n" ? "n (subset size)" : "I² (%)";

  const sampleLine = sampled
    ? `Random sample of ${count.toLocaleString()} subsets (of ${totalPossible.toLocaleString()} possible).`
    : `All ${count.toLocaleString()} non-empty subsets enumerated exactly.`;

  const svgEl  = document.getElementById("goshPlot");
  const svgStr = svgEl ? serializeSVG(svgEl) : "";

  if (!svgStr) {
    return `
<section>
  <h2>GOSH Plot (Graphical Display of Study Heterogeneity)</h2>
  <p class="meta-line">k = ${k} studies &nbsp;·&nbsp; Fixed-effects model &nbsp;·&nbsp; x-axis: ${esc(xAxisLabel)}</p>
  <p class="note">Plot image not available.</p>
</section>`;
  }

  const goshNote = `Each point represents one non-empty subset of studies. x-axis: ${esc(xAxisLabel)}. ${esc(sampleLine)} Fixed-effects model.`;

  return `
<section>
  <h2>GOSH Plot (Graphical Display of Study Heterogeneity)</h2>
  <p class="meta-line">k = ${k} studies &nbsp;·&nbsp; Fixed-effects model &nbsp;·&nbsp; x-axis: ${esc(xAxisLabel)}</p>
  <p class="note">${esc(sampleLine)}</p>
  ${buildFigureAPA(nextFigure(),
    `Graphical Display of Study Heterogeneity (GOSH) plot, k = ${k} studies`,
    [svgStr], goshNote)}
</section>`;
}

// sectionReferences(citationKeys) → HTML string
// Builds the APA References section from the keys returned by collectCitations().
// Entries are sorted alphabetically by their text content (first-author surname)
// as required by APA 7th edition, regardless of the order they were collected.
function sectionReferences(citationKeys) {
  if (!citationKeys.length) return "";
  const items = citationKeys
    .map(k => CITATIONS[k])
    .filter(Boolean)
    // De-duplicate by citation text (ML and REML share the same string).
    .filter((ref, i, arr) => arr.indexOf(ref) === i)
    // APA reference lists are sorted alphabetically by first-author surname.
    .sort((a, b) => {
      // Strip leading HTML tags to get the first plain-text character.
      const plain = s => s.replace(/<[^>]+>/g, "");
      return plain(a).localeCompare(plain(b));
    })
    .map(ref => `<li>${ref}</li>`)
    .join("\n    ");
  return `
<section>
  <h2>References</h2>
  <ol class="apa-references">
    ${items}
  </ol>
</section>`;
}

export function buildReport(args) {
  const {
    studies, m, profile, reg, ls, tf, influence, subgroup,
    rveResult, threeLevelResult, rveRho,
    method, ciMethod, useTF, forestOptions,
    cumForestOptions, caterpillarOptions,
    pcurve, puniform,
    sel, selMode, selLabel,
    gosh, goshXAxis,
    bayesResult, bayesReMean,
    sensitivityRows,
    ciLevel,
    plotTheme,
    mccMethod = "none",
    permResult = null,
  } = args;

  const theme = plotTheme ?? "default";

  const widthCiLabel = (ciLevel ?? "95") + "% CI";
  const widthCrLabel = (ciLevel ?? "95") + "% CrI";

  // Sequential APA counters — tables and figures are numbered independently
  // (APA 7th keeps separate Table N and Figure N sequences).
  // Pass nextTable / nextFigure into section builders so numbering is
  // automatic regardless of which sections are present.
  let _tblN = 0;
  function nextTable()  { return ++_tblN; }
  let _figN = 0;
  function nextFigure() { return ++_figN; }

  const date  = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });
  const k = studies.filter(d => !d.filled).length;
  const ciLabel = ciMethod === "KH" ? "Knapp-Hartung"
                : ciMethod === "t"  ? "t-dist CI"
                : ciMethod === "PL" ? "Profile Likelihood"
                : "Normal CI";

  // Collect forest SVGs for every page; other plots read directly from DOM.
  const forestSVGs        = forestOptions
    ? collectPagedSVGs("forestPlot", drawForest, [studies, m], { ...forestOptions, theme })
    : [];
  const cumForestSVGs     = cumForestOptions
    ? collectPagedSVGs("cumulativePlot", drawCumulativeForest,
        [cumForestOptions.results, cumForestOptions.profile ?? profile], { ...cumForestOptions, theme })
    : [];
  const caterpillarSVGs   = caterpillarOptions
    ? collectPagedSVGs("caterpillarPlot", drawCaterpillarPlot,
        [caterpillarOptions.studies ?? studies, caterpillarOptions.m ?? m, caterpillarOptions.profile ?? profile],
        { ...caterpillarOptions, theme })
    : [];

  function liveSVG(id) {
    const el = document.getElementById(id);
    return (el && el.childElementCount > 0) ? serializeSVG(el) : "";
  }
  // Collect bubble plot SVGs with their moderator names (set via data-moderator
  // on the wrapper div in ui.js).  Falls back to unnamed SVG scan when the
  // attribute is absent so older cached DOM states don't silently drop plots.
  const bubbleSVGs = (() => {
    const c = document.getElementById("bubblePlots");
    if (!c) return [];
    const named = Array.from(c.querySelectorAll("[data-moderator]"))
      .map(el => ({ svg: serializeSVG(el.querySelector("svg")), moderator: el.dataset.moderator }))
      .filter(b => b.svg);
    if (named.length) return named;
    return Array.from(c.querySelectorAll("svg"))
      .map(el => ({ svg: serializeSVG(el), moderator: "" }))
      .filter(b => b.svg);
  })();

  // Multiple comparison correction for per-moderator tests.
  const mccLabel  = mccMethod === "bonferroni" ? "Bonferroni" : mccMethod === "holm" ? "Holm" : "";
  const rawModPs  = Array.isArray(reg?.modTests) ? reg.modTests.map(mt => mt.QMp) : [];
  const adjRegPs  = mccMethod !== "none" && rawModPs.length > 1 ? adjustPvals(rawModPs, mccMethod) : null;

  // Augmented args passed to every section builder.
  const rArgs = { ...args, nextTable, nextFigure, funnelSVG: liveSVG("funnelPlot"),
                  svgBayesMu: liveSVG("bayesMuPlot"), svgBayesTau: liveSVG("bayesTauPlot") };

  const body = [
    sectionSummary(rArgs),
    sectionPlot("Forest Plot", forestSVGs, nextFigure,
      `Forest plot of ${esc(profile.label)}, k = ${k} studies`,
      `RE = random effects. Error bars represent 95% ${esc(ciLabel)} CI. τ² estimated by ${esc(method)}. Diamond = pooled estimate and ${widthCiLabel}.`),
    sectionStudyTable(rArgs),
    (() => {
      const svg = liveSVG("profileLikTau2Plot");
      if (!svg) return "";
      const note = `Shaded region = ${widthCiLabel} from likelihood-ratio inversion (LRT). The τ² CI in the summary table uses the Q-profile method (moment-based) and may differ.`;
      return `
<section class="plot-section">
  <h2>Profile Likelihood for τ²</h2>
  ${buildFigureAPA(nextFigure(), `Profile likelihood curve for τ²`, [svg], note)}
</section>`;
    })(),
    sectionBayes(rArgs),
    sectionRve({ ...rArgs, rveResult, rveRho }, nextTable),
    sectionThreeLevel({ ...rArgs, threeLevelResult }, nextTable),
    sectionPubBias(rArgs),
    sectionSensitivity(rArgs, nextTable),
    sectionSubgroup(subgroup, profile, nextTable, widthCiLabel),
    sectionInfluence(influence, k, nextTable),
    sectionPlot("Influence Plot", [liveSVG("influencePlot")], nextFigure,
      `Influence diagnostics for k = ${k} studies`,
      `Left panel: standardised residuals. Right panel: leave-one-out (LOO) random-effects estimates with ${widthCiLabel}.`),
    sectionPlot("BLUPs", [liveSVG("blupPlot")], nextFigure,
      `Best linear unbiased predictions (BLUPs) for k = ${k} studies`,
      `Shrunken study-level estimates sorted by effect size.`),
    sectionPlot("Baujat Plot", [liveSVG("baujatPlot")], nextFigure,
      `Baujat plot of contribution to Q statistic against overall influence on the pooled estimate`,
      ``),
    sectionPlot("Normal Q-Q Plot", [liveSVG("qqPlot")], nextFigure,
      `Normal Q-Q plot of internally standardised residuals from the random-effects model`,
      `Points near the reference line support the normality assumption. Orange points have |z| > 2.`),
    sectionPlot("Radial (Galbraith) Plot", [liveSVG("radialPlot")], nextFigure,
      `Radial (Galbraith) plot of standardised effect against reciprocal of standard error`,
      `Points near the reference line support homogeneity. Outliers may indicate heterogeneity.`),
    sectionPlot("L’Abbé Plot", [liveSVG("labbePlot")], nextFigure,
      `L’Abbé plot of event rates for ${esc(profile.label)}`,
      `Each point = one study. Point area proportional to study weight. Applicable to OR, RR, and RD only.`),
    sectionPlot("Cumulative Forest Plot", cumForestSVGs.length ? cumForestSVGs : [liveSVG("cumulativePlot")], nextFigure,
      `Cumulative forest plot of ${esc(profile.label)}`,
      `Studies added in dataset order. Effect and ${widthCiLabel} shown at each cumulative step.`),
    sectionPlot("Cumulative Funnel Plot", [liveSVG("cumulativeFunnelPlot")], nextFigure,
      `Cumulative funnel plot of ${esc(profile.label)}`,
      ``),
    sectionPlot("Orchard Plot", [liveSVG("orchardPlot")], nextFigure,
      `Orchard plot of ${esc(profile.label)}`,
      `Points scaled by random-effects weight. Thick bar = ${widthCiLabel}; thin bar = 95% prediction interval.`),
    sectionPlot("Caterpillar Plot", caterpillarSVGs.length ? caterpillarSVGs : [liveSVG("caterpillarPlot")], nextFigure,
      `Caterpillar plot of study-level ${esc(profile.label)}, sorted by effect size`,
      `Error bars = ${widthCiLabel}.`),
    sectionPCurve(pcurve, nextTable),
    sectionPlot("P-curve", [liveSVG("pCurvePlot")], nextFigure,
      `P-curve of statistically significant results (p &lt; .05)`,
      `Simonsohn et al. (2014). Only studies with p &lt; .05 included.`),
    sectionPUniform(puniform, m, profile, nextTable, widthCiLabel),
    sectionPlot("P-uniform", [liveSVG("pUniformPlot")], nextFigure,
      `P-uniform plot (van Assen et al., 2015)`,
      ``),
    sectionSelectionModel(sel ?? null, profile, selMode ?? "mle", selLabel ?? "", nextTable, widthCiLabel),
    sectionGosh(gosh ?? null, profile, goshXAxis ?? "I2", nextFigure, theme),
    sectionPlot("Risk-of-bias Traffic Light", [liveSVG("robTrafficLight")], nextFigure,
      `Risk-of-bias traffic-light plot`,
      ``),
    sectionPlot("Risk-of-bias Summary", [liveSVG("robSummary")], nextFigure,
      `Risk-of-bias summary plot`,
      ``),
    sectionLocationScale(ls, nextTable, widthCiLabel),
    sectionRegression(reg, method, ciMethod, nextTable, widthCiLabel, adjRegPs, mccLabel),
    sectionPermutation(permResult, reg, nextTable),
    ...bubbleSVGs.map(({ svg, moderator }) =>
      sectionPlot(
        moderator ? `Bubble Plot — ${esc(moderator)}` : "Bubble Plot",
        [svg], nextFigure,
        moderator
          ? `Bubble plot of ${esc(moderator)} against ${esc(profile.label)}`
          : `Bubble plot of meta-regression moderator against ${esc(profile.label)}`,
        `Line = meta-regression fit. Point area proportional to random-effects weight.`
      )
    ),
    sectionReferences(collectCitations(rArgs)),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Meta-Analysis Report</title>
  <style>${reportCSS()}</style>
</head>
<body>
  <h1>Meta-Analysis Report</h1>
  <p class="report-meta">
    Generated ${esc(date)}
    &nbsp;·&nbsp; k = ${k}${tf.length > 0 ? ` + ${tf.length} imputed` : ""}
    &nbsp;·&nbsp; ${esc(profile.label)}
    &nbsp;·&nbsp; ${esc(method)}
    &nbsp;·&nbsp; ${esc(ciLabel)}
  </p>
  ${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Multivariate report builder
// ---------------------------------------------------------------------------

// Collect MV forest SVGs from the DOM (either combined view or per-outcome panels).
function collectMVForestSVGs(outcomeIds) {
  const combined = document.getElementById("mvForestPlotCombined");
  const combinedBlock = document.getElementById("mvForestCombinedBlock");
  if (combinedBlock && combinedBlock.style.display !== "none" && combined) {
    const s = serializeSVG(combined);
    return s ? [s] : [];
  }
  const result = [];
  for (let o = 0; o < outcomeIds.length; o++) {
    const el = document.getElementById(`mvForestPlot-${o}`);
    if (el) { const s = serializeSVG(el); if (s) result.push(s); }
  }
  return result;
}

export function buildMVReport({ res, alpha = 0.05, apaFormat = false }) {
  const { beta, se, ci, z, pval, betaNames = [], tau2, rho_between,
          outcomeIds, n, k, P, QM, df_QM, pQM, QE, df_QE, pQE,
          logLik, AIC, BIC, AICc, struct, method, I2, convergence,
          warnings: engineWarnings = [] } = res;
  const hasMods = beta.length > P;
  const ciPct   = Math.round((1 - alpha) * 100);
  const date     = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  let _tblN = 0, _figN = 0;
  const nextTable  = () => ++_tblN;
  const nextFigure = () => ++_figN;

  const fP = p => !isFinite(p) ? "—" : p < 0.0001 ? p.toExponential(2) : (+p).toFixed(4);

  // Pooled estimates table
  const pooledHeaders = ["Outcome", "Estimate", "SE", `${ciPct}% CI`, "<em>z</em>", "<em>p</em>"];
  const pooledRows = outcomeIds.map((id, o) => {
    const [lo, hi] = ci[o];
    return `<tr><td>${esc(String(id))}</td><td>${fmt(beta[o], 4)}</td><td>${fmt(se[o], 4)}</td>
      <td>[${fmt(lo, 4)}, ${fmt(hi, 4)}]</td><td>${fmt(z[o], 3)}</td><td>${fP(pval[o])}</td></tr>`;
  });

  // Moderator table (if any)
  let modHTML = "";
  if (hasMods) {
    const modHeaders = ["Coefficient", "Estimate", "SE", `${ciPct}% CI`, "<em>z</em>", "<em>p</em>"];
    const modRows = beta.slice(P).map((b, i) => {
      const j = P + i;
      const [lo, hi] = ci[j];
      return `<tr><td>${esc(betaNames[j] ?? `β${j}`)}</td><td>${fmt(b, 4)}</td><td>${fmt(se[j], 4)}</td>
        <td>[${fmt(lo, 4)}, ${fmt(hi, 4)}]</td><td>${fmt(z[j], 3)}</td><td>${fP(pval[j])}</td></tr>`;
    });
    modHTML = apaFormat
      ? buildTableAPA(nextTable(), "Meta-regression coefficients", modHeaders, modRows)
      : `<h2>Moderator Effects</h2>${buildTable(modHeaders, modRows)}`;
  }

  // Heterogeneity table
  const hetHeaders = struct === "CS"
    ? ["Outcome", "τ²", "I²", "ρ (between)"]
    : ["Outcome", "τ²", "I²"];
  const hetRows = outcomeIds.map((id, o) => {
    const rho = struct === "CS" ? `<td>${fmt(rho_between ?? 0, 4)}</td>` : "";
    return `<tr><td>${esc(String(id))}</td><td>${fmt(tau2[o], 5)}</td>
      <td>${isFinite(I2[o]) ? (+I2[o]).toFixed(1) + "%" : "—"}</td>${rho}</tr>`;
  });

  // Hypothesis tests table
  const testHeaders = ["Test", "χ²", "df", "p"];
  const testRows = [
    ...(hasMods && isFinite(QM)
      ? [`<tr><td>Omnibus test of moderators (Q<sub>M</sub>)</td><td>${fmt(QM, 3)}</td><td>${df_QM}</td><td>${fP(pQM)}</td></tr>`]
      : []),
    `<tr><td>Residual heterogeneity (Q<sub>E</sub>)</td><td>${fmt(QE, 3)}</td><td>${df_QE}</td><td>${fP(pQE)}</td></tr>`,
  ];

  // Collect forest SVGs
  const forestSVGs = collectMVForestSVGs(outcomeIds);

  const pooledHTML = apaFormat
    ? buildTableAPA(nextTable(), `Pooled effect estimates per outcome (${method}, Ψ = ${struct})`, pooledHeaders, pooledRows)
    : `<h2>Pooled Estimates</h2>${buildTable(pooledHeaders, pooledRows)}`;
  const hetHTML = apaFormat
    ? buildTableAPA(nextTable(), "Between-study heterogeneity", hetHeaders, hetRows)
    : `<h2>Between-Study Heterogeneity</h2>${buildTable(hetHeaders, hetRows)}`;
  const testHTML = apaFormat
    ? buildTableAPA(nextTable(), "Hypothesis tests", testHeaders, testRows)
    : `<h2>Hypothesis Tests</h2>${buildTable(testHeaders, testRows)}`;
  const forestHTML = forestSVGs.length
    ? (apaFormat
        ? buildFigureAPA(nextFigure(), "Forest plot of multivariate meta-analysis results", forestSVGs)
        : `<h2>Forest Plot</h2>${forestSVGs.map(s => `<div class="svg-wrap">${s}</div>`).join("\n")}`)
    : "";

  const fitLine = `k = ${k} · n = ${n} obs · P = ${P} outcomes`
    + ` │ log-lik = ${fmt(logLik, 4)} · AIC = ${fmt(AIC, 2)} · BIC = ${fmt(BIC, 2)}`
    + (isFinite(AICc) ? ` · AICc = ${fmt(AICc, 2)}` : "")
    + ` │ ${esc(method)}, Ψ = ${esc(struct)}`;

  const warnHTML = [
    convergence === false ? `<p style="color:#c0392b"><strong>Warning:</strong> Optimizer did not fully converge — interpret results with caution.</p>` : "",
    ...engineWarnings.map(w => `<p style="color:#c0392b">${esc(w)}</p>`),
  ].filter(Boolean).join("");

  const body = [
    warnHTML, pooledHTML, modHTML, hetHTML, testHTML,
    `<p class="report-meta" style="margin-top:8px">${fitLine}</p>`,
    forestHTML,
  ].filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Multivariate Meta-Analysis Report</title>
  <style>${reportCSS()}</style>
</head>
<body>
  <h1>Multivariate Meta-Analysis Report</h1>
  <p class="report-meta">Generated ${esc(date)}
    &nbsp;·&nbsp; k = ${k} studies, P = ${P} outcomes
    &nbsp;·&nbsp; ${esc(method)}, Ψ = ${esc(struct)}
  </p>
  <section class="report-section">${body}</section>
</body>
</html>`;
}