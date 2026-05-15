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
import { drawForest, drawGoshPlot, drawCumulativeForest, drawCaterpillarPlot } from "./plots.js";
import { downloadBlob } from "./io.js";
import { Z_95 } from "./constants.js";
import { normalQuantile } from "./utils.js";
import { serializeSVG, collectPagedSVGs } from "./export.js";
import { summaryData, pubBiasData, puniformData, selModelData,
         influenceData, subgroupData, studyTableData, regressionData } from "./sections.js";

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
// Escape < that is NOT part of <em> or </em> markup (safe for innerHTML notes).
function escNote(s) { return String(s).replace(/<(?!\/?em>)/g, "&lt;"); }

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
function buildTableAPA(tableNum, subtitle, headers, rows, note = "") {
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
function buildFigureAPA(figNum, title, svgStrings, note = "") {
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
  } = args;

  const keys = [];
  const seen = new Set();
  function add(key) {
    if (key && !seen.has(key)) { seen.add(key); keys.push(key); }
  }

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

  // Meta-regression
  if (reg && !reg.rankDeficient) add("MREG");

  // Influence diagnostics
  if (influence && influence.length) add("INFL");

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
  const { m, profile, method, ciMethod, useTF, tf, mAdjusted, studies,
          cles = null, apaFormat = false, nextTable, ciLevel } = args;
  const widthCiLabel = (ciLevel ?? "95") + "% CI";

  const k           = studies.filter(d => !d.filled).length;
  const isMHorPeto  = m.isMH || m.isPeto;
  const FE_disp     = profile.transform(m.FE);
  const RE_disp     = isMHorPeto ? null : profile.transform(m.RE);
  const ci          = { lb: profile.transform(m.ciLow),   ub: profile.transform(m.ciHigh) };
  const pred        = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  const RE_adj      = (!isMHorPeto && useTF && mAdjusted) ? profile.transform(mAdjusted.RE) : null;
  const feAlpha     = { "90": 0.10, "95": 0.05, "99": 0.01 }[ciLevel] ?? 0.05;
  const feZ         = normalQuantile(1 - feAlpha / 2);
  const feCi        = { lb: profile.transform(m.FE - feZ * m.seFE), ub: profile.transform(m.FE + feZ * m.seFE) };
  const methodLabel = m.isMH ? "Mantel-Haenszel" : m.isPeto ? "Peto" : method;
  const ciLabel     = ciMethod === "KH" ? "Knapp-Hartung"
                    : ciMethod === "t"  ? "t-distribution"
                    : ciMethod === "PL" ? "Profile Likelihood"
                    : "Normal (z)";
  const tauCI1      = fmt(m.tauCI[0]);
  const tauCI2      = isFinite(m.tauCI[1]) ? fmt(m.tauCI[1]) : "∞";
  const H2hi        = isFinite(m.H2CI[1])  ? fmt(m.H2CI[1])  : "∞";

  if (apaFormat) {
    const settingsProse = `<p class="meta-line">
      Effect type: ${esc(profile.label)} &nbsp;·&nbsp;
      Pooling: ${esc(methodLabel)} &nbsp;·&nbsp;
      CI method: ${esc(ciLabel)} &nbsp;·&nbsp;
      k = ${k}${tf.length > 0 ? ` + ${tf.length} imputed (trim &amp; fill)` : ""}
    </p>`;

    const d = summaryData(args);
    const statsRows = d.rows.map(([label, value], i) => {
      const valCell = i === d.reRowIdx ? `<strong>${esc(value)}</strong>` : esc(value);
      return `<tr><td>${esc(label)}</td><td>${valCell}</td></tr>`;
    });
    const statsTable = buildTableAPA(nextTable(), d.subtitle, d.headers, statsRows, escNote(d.note));

    return `
<section>
  <h2>Summary</h2>
  ${settingsProse}
  ${statsTable}
</section>`;
  }

  const settingsTable = buildTable(
    ["Setting", "Value"],
    [
      `<tr><td>Effect type</td><td>${esc(profile.label)}</td></tr>`,
      `<tr><td>Pooling</td><td>${esc(methodLabel)}</td></tr>`,
      `<tr><td>CI method</td><td>${esc(ciLabel)}</td></tr>`,
      `<tr><td>Studies (k)</td><td>${k}${tf.length > 0 ? ` + ${tf.length} imputed (trim &amp; fill)` : ""}</td></tr>`,
    ]
  );

  const statsTable = buildTable(
    ["Statistic", "Value"],
    [
      `<tr><td>${esc(profile.label)} — Fixed Effects</td><td>${fmt(FE_disp)}</td></tr>`,
      `<tr><td>FE ${widthCiLabel}</td><td>[${fmt(feCi.lb)}, ${fmt(feCi.ub)}]</td></tr>`,
      !isMHorPeto ? `<tr><td>${esc(profile.label)} — Random Effects</td><td><strong>${fmt(RE_disp)}</strong></td></tr>` : "",
      !isMHorPeto ? `<tr><td>RE ${widthCiLabel}</td><td>[${fmt(ci.lb)}, ${fmt(ci.ub)}]</td></tr>` : "",
      isMHorPeto  ? `<tr><td>${widthCiLabel}</td><td>[${fmt(ci.lb)}, ${fmt(ci.ub)}]</td></tr>` : "",
      cles        ? `<tr><td>CLES (RE)</td><td>${fmt(cles.estimate)} [${fmt(cles.ci[0])}, ${fmt(cles.ci[1])}]</td></tr>` : "",
      RE_adj !== null ? `<tr><td>RE (trim-and-fill adjusted)</td><td>${fmt(RE_adj)}</td></tr>` : "",
      !isMHorPeto ? `<tr><td>95% Prediction interval</td><td>[${fmt(pred.lb)}, ${fmt(pred.ub)}]</td></tr>` : "",
      !isMHorPeto ? `<tr><td>τ²</td><td>${fmt(m.tau2)} [${tauCI1}, ${tauCI2}]</td></tr>` : "",
      `<tr><td>I²</td><td>${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%]</td></tr>`,
      !isMHorPeto ? `<tr><td>H²-CI</td><td>[${fmt(m.H2CI[0])}, ${H2hi}]</td></tr>` : "",
      `<tr><td>Q (df = ${m.df})</td><td>${fmt(m.Q)}</td></tr>`,
      m.dist ? `<tr><td><em>${esc(m.dist)}</em>-statistic</td><td>${fmt(m.stat)}, <em>p</em> = ${fmtP(m.pval)}</td></tr>` : "",
      m.isClustered ? `<tr><td>Robust CI (C = ${m.clustersUsed} clusters)</td><td>[${fmt(profile.transform(m.robustCiLow))}, ${fmt(profile.transform(m.robustCiHigh))}] · SE = ${fmt(m.robustSE)} · <em>z</em> = ${fmt(m.robustStat)}, <em>p</em> = ${fmtP(m.robustPval)}</td></tr>` : "",
    ].filter(Boolean),
    { style: "margin-top:14px" }
  );

  return `
<section>
  <h2>Summary</h2>
  ${settingsTable}
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
  const { egger, begg, fatpet, fsn, tes, waap, harbord, peters, deeks, ruecker, hc,
          useTF, tf, profile, apaFormat = false, nextTable } = args;
  const petEff = isFinite(fatpet.intercept)
    ? fmt(profile.transform(fatpet.intercept)) : "—";

  const fsnProse = `
  <p style="margin-top:10px">
    Fail-safe N (Rosenthal): <strong>${isFinite(fsn.rosenthal) ? Math.round(fsn.rosenthal) : "—"}</strong>
    &nbsp;·&nbsp;
    Fail-safe N (Orwin, trivial = 0.1): <strong>${isFinite(fsn.orwin) ? Math.round(fsn.orwin) : "—"}</strong>
  </p>
  <p>Trim &amp; Fill: <strong>${useTF ? "ON" : "OFF"}</strong>${tf.length > 0 ? ` (${tf.length} filled)` : ""}</p>`;

  const naCell = (v, fmt2) => isFinite(v) ? fmt2(v) : "—";
  const naP    = (v, fmt2) => isFinite(v) ? fmt2(v) : "NA";

  const hcRow_apa = hc && !hc.error
    ? `<tr><td>Henmi-Copas CI</td><td>${fmt(profile.transform(hc.beta))} [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}]</td><td>—</td></tr>`
    : `<tr><td>Henmi-Copas CI</td><td>—</td><td>NA (k &lt; 3)</td></tr>`;
  const hcRow_std = hc && !hc.error
    ? `<tr><td>Henmi-Copas (bias-robust CI)</td><td>${fmt(profile.transform(hc.beta))} [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}]</td><td>—</td></tr>`
    : `<tr><td>Henmi-Copas (bias-robust CI)</td><td>—</td><td>NA</td></tr>`;

  if (apaFormat) {
    const d = pubBiasData(args);
    const rows = d.rows.map(([t, s, p]) =>
      `<tr><td>${esc(t)}</td><td>${esc(s)}</td><td>${esc(p)}</td></tr>`);
    const table = buildTableAPA(nextTable(), "Tests of Publication Bias",
      d.headers, rows, esc(d.note));
    return `
<section>
  <h2>Publication Bias</h2>
  ${table}
  ${fsnProse}
</section>`;
  }

  const table = buildTable(
    ["Test", "Statistic", "p-value"],
    [
      `<tr><td>Egger (intercept)</td><td>${naCell(egger.intercept, fmt)}</td><td>${naP(egger.p, fmtP)}</td></tr>`,
      `<tr><td>Begg (rank correlation τ)</td><td>${naCell(begg.tau, fmt)}</td><td>${naP(begg.p, fmtP)}</td></tr>`,
      `<tr><td>FAT — β₁ (bias)</td><td>${naCell(fatpet.slope, fmt)}</td><td>${naP(fatpet.slopeP, fmtP)}</td></tr>`,
      `<tr><td>PET — effect at SE → 0</td><td>${petEff}</td><td>${naP(fatpet.interceptP, fmtP)}</td></tr>`,
      `<tr><td>Harbord (binary OR/RR)</td><td>${naCell(harbord.intercept, fmt)}</td><td>${naP(harbord.interceptP, fmtP)}</td></tr>`,
      `<tr><td>Peters (binary/sample-size)</td><td>${naCell(peters.intercept, fmt)}</td><td>${naP(peters.interceptP, fmtP)}</td></tr>`,
      `<tr><td>Deeks (diagnostic DOR)</td><td>${naCell(deeks.intercept, fmt)}</td><td>${naP(peters.interceptP, fmtP)}</td></tr>`,
      `<tr><td>Rücker (arcsine)</td><td>${naCell(ruecker.intercept, fmt)}</td><td>${naP(ruecker.interceptP, fmtP)}</td></tr>`,
      tes && isFinite(tes.chi2)
        ? `<tr><td>TES — χ² (O=${tes.O}, E=${fmt(tes.E)})</td><td>${fmt(tes.chi2)}</td><td>${naP(tes.p, fmtP)}</td></tr>`
        : `<tr><td>TES (excess significance)</td><td>—</td><td>NA</td></tr>`,
      waap && isFinite(waap.estimate)
        ? `<tr><td>WAAP-WLS (k<sub>adequate</sub> = ${waap.kAdequate} of ${waap.k}${waap.fallback ? "; WLS fallback" : ""})</td><td>${fmt(profile.transform(waap.estimate))} [${fmt(profile.transform(waap.ci[0]))}, ${fmt(profile.transform(waap.ci[1]))}]</td><td>${naP(waap.p, fmtP)}</td></tr>`
        : `<tr><td>WAAP-WLS</td><td>—</td><td>NA</td></tr>`,
      hcRow_std,
    ]
  );

  return `
<section>
  <h2>Publication Bias</h2>
  ${table}
  ${fsnProse}
</section>`;
}

function sectionPUniform(puniform, m, profile, apaFormat = false, nextTable, widthCiLabel = "95% CI") {
  if (!puniform || puniform.k < 3 || !isFinite(puniform.estimate)) return "";

  function fmtEst(v) { return isFinite(v) ? fmt(profile.transform(v)) : "—"; }

  const reEst  = fmtEst(m.RE);
  const reLo   = fmtEst(m.ciLow);
  const reHi   = fmtEst(m.ciHigh);
  const puEst  = fmtEst(puniform.estimate);
  const puLo   = fmtEst(puniform.ciLow);
  const puHi   = fmtEst(puniform.ciHigh);

  const noteExtra = [
    puniform.biasDetected      ? "Bias detected (p &lt; .05)." : "",
    puniform.significantEffect ? "Significant effect after correction (p &lt; .05)." : "",
  ].filter(Boolean).join(" ");

  if (apaFormat) {
    const d = puniformData({ puniform, m, profile, ciLevel: widthCiLabel.replace("% CI", "") });
    const rows = d.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`);
    return `
<section>
  <h2>P-uniform (van Assen et al., 2015)</h2>
  <p class="meta-line">${escNote(d.kLine)}</p>
  ${buildTableAPA(nextTable(), "P-uniform Bias-Corrected Estimates", d.headers, rows, escNote(d.note))}
</section>`;
  }

  const table = buildTable(
    ["Method", "Estimate", widthCiLabel, "<em>Z</em>", "<em>p</em>"],
    [
      `<tr><td>RE (uncorrected)</td><td>${reEst}</td><td>[${reLo}, ${reHi}]</td><td>${fmt(puniform.Z_bias)}</td><td>${fmtP(puniform.p_bias)}</td></tr>`,
      `<tr><td>P-uniform (bias-corrected)</td><td>${puEst}</td><td>[${puLo}, ${puHi}]</td><td>${fmt(puniform.Z_sig)}</td><td>${fmtP(puniform.p_sig)}</td></tr>`,
    ]
  );

  return `
<section>
  <h2>P-uniform (van Assen et al., 2015)</h2>
  <p class="meta-line">${puniform.k} significant result${puniform.k !== 1 ? "s" : ""} (p &lt; .05) used &nbsp;·&nbsp; effect scale: ${esc(profile.label)}</p>
  ${table}
  <p class="note" style="margin-top:8px">
    RE row: bias test (H₀: RE = true effect) — positive Z indicates overestimation.
    P-uniform row: significance test (H₀: δ = 0) — negative Z indicates true positive effect.
    ${puniform.biasDetected      ? "<strong>Bias detected</strong> (p &lt; .05)." : ""}
    ${puniform.significantEffect ? "<strong>Significant effect after correction</strong> (p &lt; .05)." : ""}
  </p>
</section>`;
}

// sectionSelectionModel(sel, profile, selMode, selLabel, apaFormat, nextTable) → HTML string
// sel       — result object from veveaHedges() (or null if not run)
// profile   — effect profile (for back-transform and label)
// selMode   — "sensitivity" | "mle"
// selLabel  — human-readable preset name (e.g. "Moderate (1-sided)") or "Custom" / "MLE"
function sectionSelectionModel(sel, profile, selMode, selLabel, apaFormat = false, nextTable, widthCiLabel = "95% CI") {
  if (!sel || sel.error) return "";

  const K     = sel.K;
  const isMLE = selMode === "mle";

  function fmtDisp(v) { return isFinite(v) ? fmt(profile.transform(v)) : "—"; }
  function fmtV(v)    { return isFinite(v) ? fmt(v) : "—"; }

  // ---- Cutpoint interval labels: (0, c₁], (c₁, c₂], … ----
  const cuts = sel.cuts;
  const intervalLabels = cuts.map((c, j) => {
    const lo = j === 0 ? "0" : cuts[j - 1];
    return `(${lo}, ${c}]`;
  });

  // ---- ω row ----
  const omegaCells = sel.omega.map((w, j) => {
    if (!isMLE || j === 0) return `<td>${fmtV(w)} (fixed)</td>`;
    const se = isFinite(sel.se_omega[j]) ? ` ± ${fmtV(sel.se_omega[j])}` : "";
    return `<td>${fmtV(w)}${se}</td>`;
  }).join("");

  // ---- Studies per interval row ----
  const kCells = sel.nPerInterval.map((n, j) => {
    const warn = n === 0 ? " class=\"flagged\"" : "";
    return `<td${warn}>${n}</td>`;
  }).join("");

  // ---- Adjusted vs unadjusted μ ----
  const muAdj   = fmtDisp(sel.mu);
  const ciLo    = fmtDisp(sel.mu - 1.96 * sel.se_mu);
  const ciHi    = fmtDisp(sel.mu + 1.96 * sel.se_mu);
  const muUnadj = fmtDisp(sel.RE_unsel);

  // ---- Interpretation sentence ----
  const direction = sel.mu > sel.RE_unsel ? "higher" : "lower";
  const schemeText = isMLE ? "the estimated selection pattern" : `<em>${esc(selLabel)}</em> selection`;

  const modeLabel  = isMLE ? "MLE (estimated weights)" : `Sensitivity — ${esc(selLabel)}`;
  const sidesLabel = sel.sides === 2 ? "two-sided" : "one-sided";

  // ---- Shared table rows ----
  const lrtFmt = p => apaFormat ? fmtP_APA(p) : `= ${fmtP(p)}`;
  const lrtRow = isMLE && isFinite(sel.LRT)
    ? `<tr><td>LRT (H₀: no selection)</td><td colspan="${K}">χ²(${sel.LRTdf}) = ${fmtV(sel.LRT)}, <em>p</em> ${lrtFmt(sel.LRTp)}</td></tr>`
    : "";

  const tableRows = [
    `<tr><td>Selection weight ω</td>${omegaCells}</tr>`,
    `<tr><td>Studies per interval</td>${kCells}</tr>`,
    `<tr><td>Adjusted μ̂ [${widthCiLabel}]</td><td colspan="${K}">${muAdj} [${ciLo}, ${ciHi}] &nbsp;·&nbsp; unadjusted: ${muUnadj}</td></tr>`,
    `<tr><td>Adjusted τ²</td><td colspan="${K}">${fmtV(sel.tau2)} &nbsp;·&nbsp; unadjusted: ${fmtV(sel.tau2_unsel)}</td></tr>`,
    ...(lrtRow ? [lrtRow] : []),
  ];

  const interpNote = `Under ${schemeText} the bias-corrected estimate is ${muAdj} [${ciLo}, ${ciHi}]`
    + ` — ${direction} than the unadjusted RE estimate of ${muUnadj}.`
    + (isMLE && isFinite(sel.LRTp) && sel.LRTp < 0.05
        ? ` The LRT rejects the null of no selection (<em>p</em> ${lrtFmt(sel.LRTp)}).`
        : "");

  if (apaFormat) {
    const d = selModelData({ sel, profile, selMode, selLabel, ciLevel: widthCiLabel.replace("% CI", "") });
    const K = d.nCols - 1;
    const htmlRows = d.rows.map((r, ri) => {
      if (r.length === 2) {
        return `<tr><td>${esc(r[0])}</td><td colspan="${K}">${esc(r[1])}</td></tr>`;
      }
      return `<tr>${r.map((c, ci) => {
        if (ci > 0 && ri === 1 && c === "0") return `<td class="flagged">${c}</td>`;
        return `<td>${esc(c)}</td>`;
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
    const note = escNote(d.note) + " " + interpNote + emptyWarning + convWarning;
    return `
<section>
  <h2>Selection Model (Vevea-Hedges, 1995)</h2>
  <p class="meta-line">${escNote(d.metaLine)}</p>
  ${buildTableAPA(nextTable(), "Vevea-Hedges Selection Model Results", d.headers, htmlRows, note)}
</section>`;
  }

  const emptyNote = (() => {
    const empty = sel.nPerInterval.map((n, j) => n === 0 ? j + 1 : -1).filter(j => j > 0);
    return empty.length > 0
      ? `<p class="note"><strong>Warning:</strong> interval${empty.length > 1 ? "s" : ""} ${empty.join(", ")} ha${empty.length > 1 ? "ve" : "s"} 0 studies.</p>`
      : "";
  })();
  const convNote = isMLE && !sel.converged
    ? `<p class="note"><strong>Note:</strong> Optimizer did not fully converge; results may be approximate.</p>`
    : "";

  return `
<section>
  <h2>Selection Model (Vevea-Hedges, 1995)</h2>
  <p class="meta-line">Mode: ${modeLabel} &nbsp;·&nbsp; p-values: ${sidesLabel} &nbsp;·&nbsp; k = ${sel.k}</p>
  ${buildTable(["Quantity", ...intervalLabels], tableRows, { style: "width:100%" })}
  ${emptyNote}
  ${convNote}
  <p class="note" style="margin-top:8px">${interpNote}</p>
</section>`;
}

function sectionInfluence(influence, k, apaFormat = false, nextTable) {
  if (!influence || !influence.length) return "";

  const thresh2k = fmt(2 / k);
  const thresh4k = fmt(4 / k);

  const rows = influence.map(d => {
    const anyFlag = d.outlier || d.influential || d.highLeverage || d.highCookD;
    const flags   = [
      d.outlier      ? "Outlier"     : "",
      d.influential  ? "Influential" : "",
      d.highLeverage ? "Hi-Lev"      : "",
      d.highCookD    ? "Hi-Cook"     : "",
    ].filter(Boolean).join(", ");
    const cls = anyFlag ? ' class="flagged"' : "";
    return `<tr${cls}>
      <td>${esc(d.label)}</td>
      <td>${isFinite(d.RE_loo)      ? fmt(d.RE_loo)      : "—"}</td>
      <td>${isFinite(d.deltaTau2)   ? fmt(d.deltaTau2)   : "—"}</td>
      <td>${isFinite(d.stdResidual) ? fmt(d.stdResidual) : "—"}</td>
      <td>${isFinite(d.DFBETA)      ? fmt(d.DFBETA)      : "—"}</td>
      <td>${isFinite(d.hat)         ? d.hat.toFixed(3)   : "—"}</td>
      <td>${isFinite(d.cookD)       ? d.cookD.toFixed(3) : "—"}</td>
      <td>${flags}</td>
    </tr>`;
  });

  const headers = ["Study", "RE (LOO)", "Δτ²", "Std. Residual", "DFBETA", "Hat", "Cook's D", "Flag"];

  if (apaFormat) {
    const d = influenceData({ influence, studies: Array.from({ length: k }, () => ({ filled: false })) });
    const apaRows = d.rows.map((r, i) => {
      const cls = d.flagged[i] ? ' class="flagged"' : "";
      return `<tr${cls}>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`;
    });
    return `
<section>
  <h2>Influence Diagnostics</h2>
  ${buildTableAPA(nextTable(), "Leave-One-Out Influence Diagnostics", d.headers, apaRows, escNote(d.note))}
</section>`;
  }

  return `
<section>
  <h2>Influence Diagnostics</h2>
  ${buildTable(
    ["Study", "RE (LOO)", "Δτ²", "Std Residual", "DFBETA", "Hat", "Cook's D", "Flags"],
    rows
  )}
  <p class="note">Thresholds: Hat &gt; ${thresh2k} (= 2/k) · Cook's D &gt; ${thresh4k} (= 4/k)</p>
</section>`;
}

function sectionSubgroup(subgroup, profile, apaFormat = false, nextTable, widthCiLabel = "95% CI") {
  if (!subgroup || subgroup.G < 2) return "";

  const rows = Object.entries(subgroup.groups).map(([g, r]) => {
    const single   = r.k === 1;
    const y_disp   = profile.transform(r.y);
    const ci_lb    = profile.transform(r.ci.lb);
    const ci_ub    = profile.transform(r.ci.ub);
    const ciCell   = single ? "—"
      : apaFormat  ? fmtCI_APA(ci_lb, ci_ub)
      : `[${fmt(ci_lb)}, ${fmt(ci_ub)}]`;
    return `<tr>
      <td>${esc(g)}</td>
      <td>${r.k}</td>
      <td>${isFinite(y_disp) ? fmt(y_disp) : "—"}</td>
      <td>${single ? "—" : (isFinite(r.se)  ? fmt(r.se)  : "—")}</td>
      <td>${ciCell}</td>
      <td>${single ? "—" : (isFinite(r.tau2) ? r.tau2.toFixed(3) : "0")}</td>
      <td>${single ? "—" : (isFinite(r.I2)   ? r.I2.toFixed(1)   : "0")}${single ? "" : "%"}</td>
    </tr>`;
  });

  if (apaFormat) {
    const d = subgroupData({ subgroup, profile, ciLevel: widthCiLabel.replace("% CI", "") });
    const apaRows = d.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`);
    const note = escNote(d.note).replace("Q_between", "Q<sub>between</sub>");
    return `
<section>
  <h2>Subgroup Analysis</h2>
  ${buildTableAPA(nextTable(), d.subtitle, d.headers, apaRows, note)}
</section>`;
  }

  return `
<section>
  <h2>Subgroup Analysis</h2>
  ${buildTable(["Group", "k", "Effect", "SE", widthCiLabel, "τ²", "I²"], rows)}
  <p class="note">
    Q<sub>between</sub> = ${subgroup.Qbetween.toFixed(3)},
    df = ${subgroup.df},
    p = ${subgroup.p.toFixed(4)}
  </p>
</section>`;
}

function sectionStudyTable(args) {
  const { studies, m, profile, apaFormat = false, nextTable, ciLevel } = args;
  const widthCiLabel = (ciLevel ?? "95") + "% CI";

  const tau2      = isFinite(m.tau2) ? m.tau2 : 0;
  const real      = studies.filter(d => !d.filled);
  const totalW    = real.reduce((s, d) => s + 1 / (d.vi + tau2), 0);
  const showFEcol = !m.isMH && !m.isPeto;
  const totalWfe  = showFEcol ? real.reduce((s, d) => s + 1 / d.vi, 0) : 0;

  const transformedScale = (
    profile.label.includes("Ratio")   ||
    profile.label.includes("Hazard")  ||
    profile.label.includes("Rate")    ||
    profile.label.includes("log")     ||
    profile.label.includes("logit")   ||
    profile.label.includes("arcsine") ||
    profile.label.includes("Freeman") ||
    profile.label.includes("Fisher")
  );
  const seLabel = transformedScale ? "SE (transformed)" : "SE";

  function fmtV(v)   { return isFinite(v) ? (+v).toFixed(3) : "—"; }
  function fmtPct(v) { return (v !== null && isFinite(v)) ? v.toFixed(1) + "%" : "—"; }

  const pooledEf = profile.transform(m.RE);
  const pooledLo = profile.transform(m.ciLow);
  const pooledHi = profile.transform(m.ciHigh);

  if (apaFormat) {
    const d = studyTableData({ studies, m, profile, ciLevel: ciLevel ?? "95" });
    const bodyRows = d.rows.map((r, i) => {
      const cls = d.filled[i] ? ' class="imputed"' : "";
      return `<tr${cls}>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`;
    });
    const ncols = d.headers.length;
    const pooled = `<tr class="pooled">${d.pooledRow.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`;
    const head = `<thead><tr>${d.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${bodyRows.join("")}</tbody>`;
    const foot = `<tfoot>
      ${pooled}
      <tr><td colspan="${ncols}"><span class="apa-note"><em>Note.</em> ${escNote(d.note)}</span></td></tr>
    </tfoot>`;
    return `
<section>
  <h2>Study-Level Results</h2>
  <p class="apa-table-title">Table ${nextTable()}</p>
  <p class="apa-table-subtitle">Study-Level Effect Sizes and Weights</p>
  <table class="apa-table">${head}${body}${foot}</table>
</section>`;
  }

  const rows = studies.map(d => {
    const wi    = 1 / (d.vi + tau2);
    const pct   = d.filled ? null : wi / totalW * 100;
    const pctFE = (showFEcol && !d.filled) ? (1 / d.vi) / totalWfe * 100 : null;
    const ef    = profile.transform(d.yi);
    const lo    = profile.transform(d.yi - Z_95 * d.se);
    const hi    = profile.transform(d.yi + Z_95 * d.se);
    const lbl = d.label.length > 40 ? d.label.slice(0, 39) + "\u2026" : d.label;
    const cls = d.filled ? ' class="imputed"' : "";
    return `<tr${cls}>
      <td>${esc(lbl)}</td>
      <td>${fmtV(ef)}</td>
      <td>${fmtV(lo)}</td>
      <td>${fmtV(hi)}</td>
      <td>${fmtV(d.se)}</td>
      <td>${fmtPct(pct)}</td>
      ${showFEcol ? `<td>${fmtPct(pctFE)}</td>` : ""}
    </tr>`;
  });

  const tfoot = `<tr class="pooled">
      <td>Pooled (RE)</td>
      <td>${fmtV(pooledEf)}</td>
      <td>${fmtV(pooledLo)}</td>
      <td>${fmtV(pooledHi)}</td>
      <td>${fmtV(m.seRE)}</td>
      <td>100%</td>
      ${showFEcol ? "<td>100%</td>" : ""}
    </tr>`;

  const colHeaders = ["Study", "Effect", `${widthCiLabel} (low)`, `${widthCiLabel} (high)`, esc(seLabel), "RE Weight"];
  if (showFEcol) colHeaders.push("FE Weight");

  return `
<section>
  <h2>Study-Level Results</h2>
  ${buildTable(colHeaders, rows, { extraClass: "study-tbl", tfoot })}
</section>`;
}

function sectionRegression(reg, method, ciMethod, apaFormat = false, nextTable, widthCiLabel = "95% CI") {
  if (!reg || reg.rankDeficient || !reg.colNames) return "";

  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";
  const statLabel = reg.dist === "t" ? `t(${reg.QEdf})` : "z";
  const QMlabel   = reg.QMdist === "F"
    ? `F(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;
  const R2row  = reg.p > 1 && isFinite(reg.R2)
    ? ` · R² = ${fmt(reg.R2 * 100)}%` : "";
  const aicRow = isFinite(reg.AIC)
    ? ` · AIC = ${fmt(reg.AIC)} · BIC = ${fmt(reg.BIC)} · LL = ${fmt(reg.LL)}` : "";

  const hasVif = Array.isArray(reg.vif) && reg.vif.some(v => isFinite(v));
  const vifCell = j => {
    if (j === 0) return "<td>—</td>";
    const v = reg.vif?.[j];
    return `<td>${isFinite(v) ? fmt(v) : "—"}</td>`;
  };

  const modTestsQMlabel = reg.QMdist === "F" ? "<em>F</em>" : "χ²";

  if (apaFormat) {
    const d = regressionData({ reg, method, ciMethod, ciLevel: widthCiLabel.replace("% CI", "") });
    if (!d) return "";
    const coefRows = d.coef.rows.map((r, j) => {
      const cls = j === 0 ? ' class="intercept"' : "";
      return `<tr${cls}>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`;
    });
    const coefTable = buildTableAPA(nextTable(), "Meta-Regression Coefficients", d.coef.headers, coefRows, escNote(d.coef.note));
    const modTestsTable = d.modTests
      ? `<h3>Per-moderator omnibus tests</h3>
  ${buildTableAPA(nextTable(), "Per-Moderator Omnibus Tests",
    d.modTests.headers,
    d.modTests.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`),
    escNote(d.modTests.note))}`
      : "";
    return `
<section>
  <h2>Meta-Regression</h2>
  <p class="meta-line">${escNote(d.metaLine)}${R2row}${aicRow}</p>
  ${coefTable}
  ${modTestsTable}
</section>`;
  }

  function stars(p) {
    if (p < 0.001) return "***";
    if (p < 0.01)  return "**";
    if (p < 0.05)  return "*";
    if (p < 0.10)  return ".";
    return "";
  }

  const rows = reg.colNames.map((name, j) => {
    const [lo, hi] = reg.ci[j];
    const cls = j === 0 ? ' class="intercept"' : "";
    return `<tr${cls}>
      <td>${esc(name)}</td>
      <td>${fmt(reg.beta[j])}</td>
      <td>${fmt(reg.se[j])}</td>
      <td>${fmt(reg.zval[j])}</td>
      <td>${fmtP(reg.pval[j])}</td>
      <td>[${fmt(lo)}, ${fmt(hi)}]</td>
      <td>${stars(reg.pval[j])}</td>
      ${hasVif ? vifCell(j) : ""}
    </tr>`;
  });

  const coefHeaders = ["Term", "β", "SE", esc(statLabel), "p", widthCiLabel, ""];
  if (hasVif) coefHeaders.push("VIF");

  const hasLRT_std = reg.modTests && reg.modTests.some(mt => isFinite(mt.lrt));
  const modTestsTable = reg.modTests && reg.modTests.length > 1
    ? `<h3>Per-moderator omnibus tests</h3>
  ${buildTable(
    ["Moderator", `${esc(modTestsQMlabel)} (Wald)`, ...(hasLRT_std ? ["LRT χ²"] : []), "df", "<em>p</em> (Wald)", ...(hasLRT_std ? ["<em>p</em> (LRT)"] : [])],
    reg.modTests.map(mt => `<tr>
      <td>${esc(mt.name)}</td>
      <td>${fmt(mt.QM)}</td>
      ${hasLRT_std ? `<td>${isFinite(mt.lrt) ? fmt(mt.lrt) : "NA"}</td>` : ""}
      <td>${mt.QMdf}</td>
      <td>${fmtP(mt.QMp)}</td>
      ${hasLRT_std ? `<td>${isFinite(mt.lrtP) ? fmtP(mt.lrtP) : "NA"}</td>` : ""}
    </tr>`)
  )}${hasLRT_std ? `\n  <p class="note">LRT\u202F=\u202FLikelihood Ratio Test; uses ML estimation internally.</p>` : ""}`
    : "";

  return `
<section>
  <h2>Meta-Regression</h2>
  <p class="meta-line">
    k = ${reg.k} · ${esc(method)} · ${esc(ciLabel)}
    · τ² = ${fmt(reg.tau2)} · I² = ${fmt(reg.I2)}%${R2row}
    · <em>Q</em>E(${reg.QEdf}) = ${fmt(reg.QE)}, <em>p</em> = ${fmtP(reg.QEp)}
    ${reg.p > 1 ? `· <em>Q</em>M ${esc(QMlabel)} = ${fmt(reg.QM)}, <em>p</em> = ${fmtP(reg.QMp)}` : ""}
    ${aicRow ? `<br><span style="font-size:0.93em">${aicRow.slice(3)}</span>` : ""}
  </p>
  ${buildTable(coefHeaders, rows)}
  <p class="note">*** <em>p</em> &lt; .001 · ** <em>p</em> &lt; .01 · * <em>p</em> &lt; .05 · . <em>p</em> &lt; .10</p>
  ${modTestsTable}
</section>`;
}

function sectionPlot(label, svgStrings, apaFormat = false, nextFigure,
                     apaTitle = "", apaNote = "") {
  const filled = svgStrings.filter(Boolean);
  if (!filled.length) return "";

  if (apaFormat) {
    const title = apaTitle || label;
    return `
<section class="plot-section">
  <h2>${esc(label)}</h2>
  ${buildFigureAPA(nextFigure(), title, filled, apaNote)}
</section>`;
  }

  return `
<section class="plot-section">
  <h2>${esc(label)}</h2>
  ${filled.map(s => `<div class="svg-wrap">${s}</div>`).join("\n  ")}
</section>`;
}

// ---------------------------------------------------------------------------
// Embedded CSS
// ---------------------------------------------------------------------------

function reportCSS() {
  const isLight = document.documentElement.dataset.theme === "light";

  const v = isLight ? {
    bodyBg:       "#f5f5f8",
    bodyColor:    "#1a1a1a",
    metaColor:    "#888",
    h2Color:      "#555",
    h2Border:     "#d0d0d0",
    sectionBg:    "#ffffff",
    sectionBorder:"#ddd",
    thBg:         "#e8e8f0",
    thColor:      "#333",
    thBorder:     "#ddd",
    tdBorder:     "#e0e0e0",
    tdColor:      "#222",
    tdAltBg:      "#f5f5f8",
    imputedColor: "#999",
    pooledColor:  "#6a5000",
    pooledBg:     "#fffff0",
    pooledBorder: "#bbb",
    interceptColor:"#777",
    flaggedBg:    "#fff5f5",
    metaLine:     "#555",
    noteColor:    "#888",
  } : {
    bodyBg:       "#121212",
    bodyColor:    "#eee",
    metaColor:    "#666",
    h2Color:      "#888",
    h2Border:     "#2e2e2e",
    sectionBg:    "#1a1a1a",
    sectionBorder:"#333",
    thBg:         "#1e2840",
    thColor:      "#aac",
    thBorder:     "#333",
    tdBorder:     "#2a2a2a",
    tdColor:      "#ddd",
    tdAltBg:      "#171727",
    imputedColor: "#555",
    pooledColor:  "#ffd740",
    pooledBg:     "#1e1e10",
    pooledBorder: "#555",
    interceptColor:"#999",
    flaggedBg:    "#2a1a1a",
    metaLine:     "#aaa",
    noteColor:    "#666",
  };

  return `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      background: ${v.bodyBg};
      color: ${v.bodyColor};
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
      color: ${v.h2Color};
      margin: 0 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid ${v.h2Border};
    }
    .report-meta { font-size: 0.82em; color: ${v.metaColor}; margin-bottom: 28px; }
    section {
      background: ${v.sectionBg};
      border: 1px solid ${v.sectionBorder};
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
    }
    .stat-table {
      border-collapse: collapse;
      font-size: 0.88em;
      width: 100%;
      max-width: 900px;
    }
    .stat-table th {
      background: ${v.thBg};
      color: ${v.thColor};
      font-weight: normal;
      text-align: left;
      padding: 5px 10px;
      border: 1px solid ${v.thBorder};
    }
    .stat-table td {
      padding: 5px 10px;
      border: 1px solid ${v.tdBorder};
      color: ${v.tdColor};
    }
    .stat-table tbody tr:nth-child(even) td { background: ${v.tdAltBg}; }
    .study-tbl td:first-child { font-family: monospace; }
    .imputed td { color: ${v.imputedColor}; font-style: italic; }
    .pooled td {
      color: ${v.pooledColor};
      font-weight: bold;
      background: ${v.pooledBg} !important;
      border-top: 2px solid ${v.pooledBorder};
    }
    .intercept td { color: ${v.interceptColor}; font-style: italic; }
    .flagged td { background: ${v.flaggedBg} !important; }
    .meta-line { font-size: 0.84em; color: ${v.metaLine}; margin: 0 0 8px 0; }
    .note { font-size: 0.78em; color: ${v.noteColor}; margin-top: 6px; }
    p { margin: 4px 0; }
    .svg-wrap { margin-bottom: 12px; overflow-x: auto; }
    .svg-wrap svg { display: block; }

    /* ---- APA table styles ---- */
    .apa-table {
      border-collapse: collapse;
      font-size: 0.88em;
      width: 100%;
      max-width: 900px;
    }
    .apa-table thead th {
      border-top: 2px solid ${v.bodyColor};
      border-bottom: 1px solid ${v.bodyColor};
      background: none;
      color: ${v.tdColor};
      font-weight: bold;
      text-align: left;
      padding: 4px 8px;
    }
    .apa-table td {
      padding: 3px 8px;
      border: none;
      color: ${v.tdColor};
    }
    .apa-table tfoot td {
      border-top: 2px solid ${v.bodyColor};
      padding-top: 5px;
    }
    /* Rule 3 (closing rule) when no tfoot present */
    .apa-table:not(:has(tfoot)) > tbody > tr:last-child > td {
      border-bottom: 2px solid ${v.bodyColor};
    }
    .apa-table .imputed td { color: ${v.imputedColor}; font-style: italic; }
    .apa-table .pooled td  { font-weight: bold; background: none !important; border-top: none; color: ${v.tdColor}; }
    .apa-table .flagged td { font-style: italic; }
    .apa-table .intercept td { color: ${v.interceptColor}; font-style: italic; }
    .apa-table-title    { font-weight: bold; margin: 16px 0 2px 0; font-size: 0.88em; }
    .apa-table-subtitle { font-style: italic; margin: 0 0 4px 0; font-size: 0.88em; }
    .apa-note           { font-size: 0.82em; color: ${v.noteColor}; }
    .apa-note em        { font-style: italic; }
    .apa-figure-num     { font-weight: bold; font-size: 0.88em; margin: 16px 0 2px 0; }
    .apa-figure-title   { font-style: italic; font-size: 0.88em; margin: 0 0 4px 0; }
    .apa-figure-note    { font-size: 0.82em; color: ${v.noteColor}; margin-top: 4px; }
    .apa-figure-note em { font-style: italic; }
    .apa-references     { padding-left: 0; list-style: none; }
    .apa-references li  { font-size: 0.85em; color: ${v.tdColor}; margin-bottom: 6px;
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
function sectionGosh(goshResult, profile, xAxis, apaFormat = false, nextFigure) {
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

  // Re-render into the live SVG using SVG circles (no canvas PNG embed).
  drawGoshPlot(goshResult, profile, { xAxis, forReport: true });
  const svgEl  = document.getElementById("goshPlot");
  const svgStr = svgEl ? serializeSVG(svgEl) : "";
  // Restore screen render (avoids a visible change if the user has the section open).
  drawGoshPlot(goshResult, profile, { xAxis });

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
  ${apaFormat
    ? buildFigureAPA(nextFigure(),
        `Graphical Display of Study Heterogeneity (GOSH) plot, k\u202F=\u202F${k} studies`,
        [svgStr], goshNote)
    : `<div class="svg-wrap">${svgStr}</div>`}
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
    studies, m, profile, reg, tf, influence, subgroup,
    method, ciMethod, useTF, forestOptions,
    cumForestOptions, caterpillarOptions,
    pcurve, puniform,
    sel, selMode, selLabel,
    gosh, goshXAxis,
    bayesResult, bayesReMean,
    sensitivityRows,
    apaFormat = false,
    ciLevel,
  } = args;

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
    ? collectPagedSVGs("forestPlot", drawForest, [studies, m], forestOptions)
    : [];
  const cumForestSVGs     = cumForestOptions
    ? collectPagedSVGs("cumulativePlot", drawCumulativeForest,
        [cumForestOptions.results, cumForestOptions.profile ?? profile], cumForestOptions)
    : [];
  const caterpillarSVGs   = caterpillarOptions
    ? collectPagedSVGs("caterpillarPlot", drawCaterpillarPlot,
        [caterpillarOptions.studies ?? studies, caterpillarOptions.m ?? m, caterpillarOptions.profile ?? profile],
        caterpillarOptions)
    : [];

  function liveSVG(id) {
    const el = document.getElementById(id);
    return el ? serializeSVG(el) : "";
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

  // Augmented args passed to every section builder so they can read apaFormat
  // and call nextTable() / nextFigure() to get the next sequential APA number.
  const rArgs = { ...args, apaFormat, nextTable, nextFigure };

  const body = [
    sectionSummary(rArgs),
    sectionPubBias(rArgs),
    sectionPUniform(puniform, m, profile, apaFormat, nextTable, widthCiLabel),
    sectionSelectionModel(sel ?? null, profile, selMode ?? "mle", selLabel ?? "", apaFormat, nextTable, widthCiLabel),
    ((apaFormat, nextFigure) => {
      if (!bayesResult || bayesResult.error) return "";
      const svgMu  = liveSVG("bayesMuPlot");
      const svgTau = liveSVG("bayesTauPlot");
      if (!svgMu && !svgTau) return "";
      const muDisp   = profile.transform(bayesResult.muMean);
      const muCIDisp = bayesResult.muCI.map(v => profile.transform(v));
      const reDisp   = isFinite(bayesReMean) ? profile.transform(bayesReMean) : NaN;
      const priorLine = `Prior: \u03BC\u202F~\u202FN(${esc(bayesResult.mu0)},\u202F${esc(bayesResult.sigma_mu)}\u00B2)\u2003\u03C4\u202F~\u202FHalfNormal(${esc(bayesResult.sigma_tau)})\u2003k\u202F=\u202F${bayesResult.k} studies`;
      const statsTable = `
  <table class="stats-table">
    <tr><td>Posterior mean \u03BC</td><td>${fmt(muDisp)}</td><td>${widthCrLabel} [${fmt(muCIDisp[0])}, ${fmt(muCIDisp[1])}]</td></tr>
    <tr><td>Posterior mean \u03C4</td><td>${fmt(bayesResult.tauMean)}</td><td>${widthCrLabel} [${fmt(bayesResult.tauCI[0])}, ${fmt(bayesResult.tauCI[1])}]</td></tr>
    ${isFinite(reDisp) ? `<tr><td>Frequentist RE (comparison)</td><td>${fmt(reDisp)}</td><td></td></tr>` : ""}
  </table>`;
      const bayesPriorNote = `Prior: \u03BC\u202F~\u202FN(${esc(bayesResult.mu0)},\u202F${esc(bayesResult.sigma_mu)}\u00B2); \u03C4\u202F~\u202FHalfNormal(${esc(bayesResult.sigma_tau)}). Vertical line\u202F=\u202Fposterior mean; shaded region\u202F=\u202F95% credible interval.`;
      const plotsMu  = apaFormat && svgMu
        ? buildFigureAPA(nextFigure(),
            `Posterior distribution of pooled effect \u03BC (${esc(profile.label)})`,
            [svgMu], bayesPriorNote)
        : (svgMu  ? `<div class="svg-wrap">${svgMu}</div>`  : "");
      const plotsTau = apaFormat && svgTau
        ? buildFigureAPA(nextFigure(),
            `Posterior distribution of between-study standard deviation \u03C4`,
            [svgTau],
            `Prior: \u03C4\u202F~\u202FHalfNormal(${esc(bayesResult.sigma_tau)}).`)
        : (svgTau ? `<div class="svg-wrap">${svgTau}</div>` : "");
      const sensitivityTable = (() => {
        if (!sensitivityRows || !sensitivityRows.length) return "";
        const crLabel = widthCrLabel;
        const header = `<tr><th>σ_μ</th><th>σ_τ</th><th>Post. μ</th><th>${crLabel}</th><th>BF₁₀</th></tr>`;
        const rows2 = sensitivityRows.map(row => {
          const muDisp   = profile.transform(row.muMean);
          const muCIDisp = row.muCI.map(v => profile.transform(v));
          const bf = row.BF10;
          const bfStr = !isFinite(bf) ? "NA"
            : bf >= 1000 ? bf.toExponential(2)
            : bf < 0.001 ? bf.toExponential(2)
            : bf.toFixed(3);
          return `<tr><td>${row.sigma_mu}</td><td>${row.sigma_tau}</td><td>${isFinite(muDisp) ? fmt(muDisp) : "NA"}</td><td>[${isFinite(muCIDisp[0]) ? fmt(muCIDisp[0]) : "NA"}, ${isFinite(muCIDisp[1]) ? fmt(muCIDisp[1]) : "NA"}]</td><td>${bfStr}</td></tr>`;
        }).join("");
        return `<h3>Prior Sensitivity Analysis</h3>
  <table class="stats-table"><thead>${header}</thead><tbody>${rows2}</tbody></table>
  <p class="note">Grid: σ_μ ∈ {0.5, 1, 2}, σ_τ ∈ {0.25, 0.5, 1}. Diffuse priors approach the frequentist RE estimate.</p>`;
      })();
      return `
<section>
  <h2>Bayesian Meta-Analysis</h2>
  <p class="meta-line">${priorLine}</p>
  ${statsTable}
  ${sensitivityTable}
  ${plotsMu}
  ${plotsTau}
</section>`;
    })(apaFormat, nextFigure),
    sectionGosh(gosh ?? null, profile, goshXAxis ?? "I2", apaFormat, nextFigure),
    ((apaFormat, nextFigure) => {
      const svg = liveSVG("profileLikTau2Plot");
      if (!svg) return "";
      const note = `Shaded region\u202F=\u202F${widthCiLabel} from likelihood-ratio inversion (LRT). The \u03C4\u00B2 CI in the summary table uses the Q-profile method (moment-based) and may differ.`;
      return `
<section class="plot-section">
  <h2>Profile Likelihood for τ²</h2>
  ${apaFormat
    ? buildFigureAPA(nextFigure(), `Profile likelihood curve for \u03C4\u00B2`, [svg], note)
    : `<div class="svg-wrap">${svg}</div>
  <p class="note">${widthCiLabel} from likelihood-ratio inversion (LRT). Note: the \u03C4\u00B2 CI in the summary table uses the Q-profile method (moment-based) and will differ.</p>`}
</section>`;
    })(apaFormat, nextFigure),
    sectionInfluence(influence, k, apaFormat, nextTable),
    sectionSubgroup(subgroup, profile, apaFormat, nextTable, widthCiLabel),
    sectionStudyTable(rArgs),
    sectionRegression(reg, method, ciMethod, apaFormat, nextTable, widthCiLabel),
    sectionPlot("Forest Plot", forestSVGs, apaFormat, nextFigure,
      `Forest plot of ${esc(profile.label)}, k\u202F=\u202F${k} studies`,
      `RE\u202F=\u202Frandom effects. Error bars represent 95% ${esc(ciLabel)} CI. \u03C4\u00B2 estimated by ${esc(method)}. Diamond\u202F=\u202Fpooled estimate and ${widthCiLabel}.`),
    sectionPlot("Funnel Plot", [liveSVG("funnelPlot")], apaFormat, nextFigure,
      `Funnel plot of ${esc(profile.label)} against standard error`,
      `Each point\u202F=\u202Fone study. Asymmetry may indicate publication bias or between-study heterogeneity.`),
    sectionPlot("Influence Plot", [liveSVG("influencePlot")], apaFormat, nextFigure,
      `Influence diagnostics for k\u202F=\u202F${k} studies`,
      `Left panel: standardised residuals. Right panel: leave-one-out (LOO) random-effects estimates with ${widthCiLabel}.`),
    sectionPlot("Baujat Plot", [liveSVG("baujatPlot")], apaFormat, nextFigure,
      `Baujat plot of contribution to Q statistic against overall influence on the pooled estimate`,
      ``),
    sectionPlot("Normal Q-Q Plot", [liveSVG("qqPlot")], apaFormat, nextFigure,
      `Normal Q-Q plot of internally standardised residuals from the random-effects model`,
      `Points near the reference line support the normality assumption. Orange points have |z|\u202F>\u202F2.`),
    sectionPlot("Cumulative Forest Plot", cumForestSVGs.length ? cumForestSVGs : [liveSVG("cumulativePlot")], apaFormat, nextFigure,
      `Cumulative forest plot of ${esc(profile.label)}`,
      `Studies added in dataset order. Effect and ${widthCiLabel} shown at each cumulative step.`),
    sectionPlot("Cumulative Funnel Plot", [liveSVG("cumulativeFunnelPlot")], apaFormat, nextFigure,
      `Cumulative funnel plot of ${esc(profile.label)}`,
      ``),
    sectionPlot("P-curve", [liveSVG("pCurvePlot")], apaFormat, nextFigure,
      `P-curve of statistically significant results (p\u202F&lt;\u202F.05)`,
      `Simonsohn et al. (2014). Only studies with p\u202F&lt;\u202F.05 included.`),
    sectionPlot("P-uniform", [liveSVG("pUniformPlot")], apaFormat, nextFigure,
      `P-uniform plot (van Assen et al., 2015)`,
      ``),
    sectionPlot("Orchard Plot", [liveSVG("orchardPlot")], apaFormat, nextFigure,
      `Orchard plot of ${esc(profile.label)}`,
      `Points scaled by random-effects weight. Thick bar\u202F=\u202F${widthCiLabel}; thin bar\u202F=\u202F95% prediction interval.`),
    sectionPlot("Caterpillar Plot", caterpillarSVGs.length ? caterpillarSVGs : [liveSVG("caterpillarPlot")], apaFormat, nextFigure,
      `Caterpillar plot of study-level ${esc(profile.label)}, sorted by effect size`,
      `Error bars\u202F=\u202F${widthCiLabel}.`),
    sectionPlot("Risk-of-bias Traffic Light", [liveSVG("robTrafficLight")], apaFormat, nextFigure,
      `Risk-of-bias traffic-light plot`,
      ``),
    sectionPlot("Risk-of-bias Summary", [liveSVG("robSummary")], apaFormat, nextFigure,
      `Risk-of-bias summary plot`,
      ``),
    // Bubble plots: in APA mode one Figure per moderator; non-APA all in one section.
    ...(apaFormat
      ? bubbleSVGs.map(({ svg, moderator }) =>
          sectionPlot(
            moderator ? `Bubble Plot \u2014 ${esc(moderator)}` : "Bubble Plot",
            [svg], apaFormat, nextFigure,
            moderator
              ? `Bubble plot of ${esc(moderator)} against ${esc(profile.label)}`
              : `Bubble plot of meta-regression moderator against ${esc(profile.label)}`,
            `Line\u202F=\u202Fmeta-regression fit. Point area proportional to random-effects weight.`
          )
        )
      : [sectionPlot(
          "Bubble Plots",
          bubbleSVGs.map(b => b.svg),
          apaFormat, nextFigure,
          `Bubble plots of meta-regression moderators against ${esc(profile.label)}`,
          `Line\u202F=\u202Fmeta-regression fit. Point area proportional to random-effects weight. One panel per moderator.`
        )]
    ),
    // References section — APA mode only, always last.
    ...(apaFormat ? [sectionReferences(collectCitations(rArgs))] : []),
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
