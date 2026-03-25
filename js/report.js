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
//   { studies, m, profile, reg, tf, egger, begg, fatpet, fsn,
//     influence, subgroup, method, ciMethod, useTF, mAdjusted,
//     pcurve, puniform,
//     forestOptions }   ← forestOptions = { ciMethod, profile, pageSize, theme }
//
// Dependencies
// ------------
//   plots.js     drawForest()
//   io.js        downloadBlob()
//   constants.js Z_95
//   export.js    resolveThemeVars(), hasEmbeddedBackground()

import { drawForest } from "./plots.js";
import { downloadBlob } from "./io.js";
import { Z_95 } from "./constants.js";
import { resolveThemeVars, hasEmbeddedBackground } from "./export.js";

// ---------------------------------------------------------------------------
// SVG serialization
// ---------------------------------------------------------------------------

function serializeSVG(svgEl) {
  if (!svgEl) return "";
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const w = clone.getAttribute("width")  || String(svgEl.getBoundingClientRect().width);
  const h = clone.getAttribute("height") || String(svgEl.getBoundingClientRect().height);
  clone.setAttribute("width",  w);
  clone.setAttribute("height", h);

  // Resolve CSS custom properties so SVGs are self-contained in the report
  // document (which has its own CSS cascade that doesn't apply to serialised SVG).
  resolveThemeVars(clone);

  // Inject a background rect when the SVG has no embedded one.
  // Use the app's current --bg-base so the report matches the active theme.
  if (!hasEmbeddedBackground(clone)) {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width",  "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill",
      getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim() || "#121212"
    );
    clone.insertBefore(bg, clone.firstChild);
  }

  return new XMLSerializer().serializeToString(clone);
}

// Render every forest-plot page to SVG strings.
//
// We render directly into the live #forestPlot element rather than using a
// hidden temporary element.  Because this function runs synchronously inside
// a click handler the browser never repaints between renders, so the user
// sees no flicker.  The originally-displayed page is restored before the
// function returns.
function collectForestSVGs(studies, m, forestOptions) {
  const svgEl = document.getElementById("forestPlot");
  if (!svgEl) return [];

  const svgs = [];
  let totalPages = 1;

  // Render page 0 to discover totalPages; capture its SVG immediately.
  try {
    ({ totalPages } = drawForest(studies, m, { ...forestOptions, page: 0 }));
    svgs.push(serializeSVG(svgEl));
  } catch (e) {
    console.error("collectForestSVGs: failed to render page 0", e);
    return [];
  }

  for (let p = 1; p < totalPages; p++) {
    try {
      drawForest(studies, m, { ...forestOptions, page: p });
      svgs.push(serializeSVG(svgEl));
    } catch (e) {
      console.error(`collectForestSVGs: failed to render page ${p}`, e);
    }
  }

  // Restore the originally-displayed page.
  try {
    drawForest(studies, m, { ...forestOptions, page: forestOptions.currentPage ?? 0 });
  } catch (e) {
    console.error("collectForestSVGs: failed to restore page", e);
  }

  return svgs;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt(v, d = 3) { return isFinite(v) ? (+v).toFixed(d) : "—"; }

function fmtP(p) {
  if (!isFinite(p)) return "—";
  if (p < 0.0001)   return "&lt;0.0001";
  return (+p).toFixed(4);
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const { m, profile, method, ciMethod, useTF, tf, mAdjusted, studies } = args;

  const k        = studies.filter(d => !d.filled).length;
  const FE_disp  = profile.transform(m.FE);
  const RE_disp  = profile.transform(m.RE);
  const ci       = { lb: profile.transform(m.ciLow),   ub: profile.transform(m.ciHigh) };
  const pred     = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  const RE_adj   = (useTF && mAdjusted) ? profile.transform(mAdjusted.RE) : null;
  const ciLabel  = ciMethod === "KH" ? "Knapp-Hartung"
                 : ciMethod === "t"  ? "t-distribution"
                 : ciMethod === "PL" ? "Profile Likelihood"
                 : "Normal (z)";
  const tauCI1   = fmt(m.tauCI[0]);
  const tauCI2   = isFinite(m.tauCI[1]) ? fmt(m.tauCI[1]) : "∞";
  const H2hi     = isFinite(m.H2CI[1])  ? fmt(m.H2CI[1])  : "∞";

  return `
<section>
  <h2>Summary</h2>
  <table class="stat-table">
    <tr><th>Setting</th><th>Value</th></tr>
    <tr><td>Effect type</td><td>${esc(profile.label)}</td></tr>
    <tr><td>τ² estimator</td><td>${esc(method)}</td></tr>
    <tr><td>CI method</td><td>${esc(ciLabel)}</td></tr>
    <tr><td>Studies (k)</td><td>${k}${tf.length > 0 ? ` + ${tf.length} imputed (trim &amp; fill)` : ""}</td></tr>
  </table>
  <table class="stat-table" style="margin-top:14px">
    <tr><th>Statistic</th><th>Value</th></tr>
    <tr><td>${esc(profile.label)} — Fixed Effects</td><td>${fmt(FE_disp)}</td></tr>
    <tr><td>${esc(profile.label)} — Random Effects</td><td><strong>${fmt(RE_disp)}</strong></td></tr>
    ${RE_adj !== null ? `<tr><td>RE (trim-and-fill adjusted)</td><td>${fmt(RE_adj)}</td></tr>` : ""}
    <tr><td>95% CI</td><td>[${fmt(ci.lb)}, ${fmt(ci.ub)}]</td></tr>
    <tr><td>95% Prediction interval</td><td>[${fmt(pred.lb)}, ${fmt(pred.ub)}]</td></tr>
    <tr><td>τ²</td><td>${fmt(m.tau2)} [${tauCI1}, ${tauCI2}]</td></tr>
    <tr><td>I²</td><td>${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%]</td></tr>
    <tr><td>H²-CI</td><td>[${fmt(m.H2CI[0])}, ${H2hi}]</td></tr>
    <tr><td>Q (df = ${m.df})</td><td>${fmt(m.Q)}</td></tr>
    <tr><td>${esc(m.dist)}-statistic</td><td>${fmt(m.stat)}, p = ${fmtP(m.pval)}</td></tr>
  </table>
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
  const { egger, begg, fatpet, fsn, useTF, tf, profile } = args;
  const petEff = isFinite(fatpet.intercept)
    ? fmt(profile.transform(fatpet.intercept)) : "—";

  return `
<section>
  <h2>Publication Bias</h2>
  <table class="stat-table">
    <tr><th>Test</th><th>Statistic</th><th>p-value</th></tr>
    <tr>
      <td>Egger (intercept)</td>
      <td>${isFinite(egger.intercept) ? fmt(egger.intercept) : "—"}</td>
      <td>${isFinite(egger.p) ? fmtP(egger.p) : "NA (k &lt; 3)"}</td>
    </tr>
    <tr>
      <td>Begg (rank correlation τ)</td>
      <td>${isFinite(begg.tau) ? fmt(begg.tau) : "—"}</td>
      <td>${isFinite(begg.p)   ? fmtP(begg.p)  : "NA (k &lt; 3)"}</td>
    </tr>
    <tr>
      <td>FAT — β₁ (bias)</td>
      <td>${isFinite(fatpet.slope) ? fmt(fatpet.slope) : "—"}</td>
      <td>${isFinite(fatpet.slopeP) ? fmtP(fatpet.slopeP) : "NA (k &lt; 3)"}</td>
    </tr>
    <tr>
      <td>PET — effect at SE → 0</td>
      <td>${petEff}</td>
      <td>${isFinite(fatpet.interceptP) ? fmtP(fatpet.interceptP) : "NA (k &lt; 3)"}</td>
    </tr>
  </table>
  <p style="margin-top:10px">
    Fail-safe N (Rosenthal): <strong>${isFinite(fsn.rosenthal) ? Math.round(fsn.rosenthal) : "—"}</strong>
    &nbsp;·&nbsp;
    Fail-safe N (Orwin, trivial = 0.1): <strong>${isFinite(fsn.orwin) ? Math.round(fsn.orwin) : "—"}</strong>
  </p>
  <p>Trim &amp; Fill: <strong>${useTF ? "ON" : "OFF"}</strong>${tf.length > 0 ? ` (${tf.length} filled)` : ""}</p>
</section>`;
}

function sectionPUniform(puniform, m, profile) {
  if (!puniform || puniform.k < 3 || !isFinite(puniform.estimate)) return "";

  function fmtEst(v) { return isFinite(v) ? fmt(profile.transform(v)) : "—"; }

  const reEst  = fmtEst(m.RE);
  const reLo   = fmtEst(m.ciLow);
  const reHi   = fmtEst(m.ciHigh);
  const puEst  = fmtEst(puniform.estimate);
  const puLo   = fmtEst(puniform.ciLow);
  const puHi   = fmtEst(puniform.ciHigh);

  return `
<section>
  <h2>P-uniform (van Assen et al., 2015)</h2>
  <p class="meta-line">${puniform.k} significant result${puniform.k !== 1 ? "s" : ""} (p &lt; .05) used &nbsp;·&nbsp; effect scale: ${esc(profile.label)}</p>
  <table class="stat-table">
    <thead>
      <tr><th>Method</th><th>Estimate</th><th>95% CI</th><th>Z</th><th>p</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>RE (uncorrected)</td>
        <td>${reEst}</td>
        <td>[${reLo}, ${reHi}]</td>
        <td>${fmt(puniform.Z_bias)}</td>
        <td>${fmtP(puniform.p_bias)}</td>
      </tr>
      <tr>
        <td>P-uniform (bias-corrected)</td>
        <td>${puEst}</td>
        <td>[${puLo}, ${puHi}]</td>
        <td>${fmt(puniform.Z_sig)}</td>
        <td>${fmtP(puniform.p_sig)}</td>
      </tr>
    </tbody>
  </table>
  <p class="note" style="margin-top:8px">
    RE row: bias test (H₀: RE = true effect) — positive Z indicates overestimation.
    P-uniform row: significance test (H₀: δ = 0) — negative Z indicates true positive effect.
    ${puniform.biasDetected      ? "<strong>Bias detected</strong> (p &lt; .05)." : ""}
    ${puniform.significantEffect ? "<strong>Significant effect after correction</strong> (p &lt; .05)." : ""}
  </p>
</section>`;
}

function sectionInfluence(influence, k) {
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
  }).join("");

  return `
<section>
  <h2>Influence Diagnostics</h2>
  <table class="stat-table">
    <thead><tr>
      <th>Study</th><th>RE (LOO)</th><th>Δτ²</th><th>Std Residual</th>
      <th>DFBETA</th><th>Hat</th><th>Cook's D</th><th>Flags</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">Thresholds: Hat &gt; ${thresh2k} (= 2/k) · Cook's D &gt; ${thresh4k} (= 4/k)</p>
</section>`;
}

function sectionSubgroup(subgroup, profile) {
  if (!subgroup || subgroup.G < 2) return "";

  const rows = Object.entries(subgroup.groups).map(([g, r]) => {
    const single   = r.k === 1;
    const y_disp   = profile.transform(r.y);
    const ci_disp  = { lb: profile.transform(r.ci.lb), ub: profile.transform(r.ci.ub) };
    return `<tr>
      <td>${esc(g)}</td>
      <td>${r.k}</td>
      <td>${isFinite(y_disp) ? fmt(y_disp) : "—"}</td>
      <td>${single ? "—" : (isFinite(r.se)  ? fmt(r.se)  : "—")}</td>
      <td>${single ? "—" : `[${fmt(ci_disp.lb)}, ${fmt(ci_disp.ub)}]`}</td>
      <td>${single ? "—" : (isFinite(r.tau2) ? r.tau2.toFixed(3) : "0")}</td>
      <td>${single ? "—" : (isFinite(r.I2)   ? r.I2.toFixed(1)   : "0")}${single ? "" : "%"}</td>
    </tr>`;
  }).join("");

  return `
<section>
  <h2>Subgroup Analysis</h2>
  <table class="stat-table">
    <thead><tr>
      <th>Group</th><th>k</th><th>Effect</th><th>SE</th>
      <th>95% CI</th><th>τ²</th><th>I²</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">
    Q<sub>between</sub> = ${subgroup.Qbetween.toFixed(3)},
    df = ${subgroup.df},
    p = ${subgroup.p.toFixed(4)}
  </p>
</section>`;
}

function sectionStudyTable(args) {
  const { studies, m, profile } = args;

  const tau2   = isFinite(m.tau2) ? m.tau2 : 0;
  const real   = studies.filter(d => !d.filled);
  const totalW = real.reduce((s, d) => s + 1 / (d.vi + tau2), 0);

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

  const rows = studies.map(d => {
    const wi  = 1 / (d.vi + tau2);
    const pct = d.filled ? null : wi / totalW * 100;
    const ef  = profile.transform(d.yi);
    const lo  = profile.transform(d.yi - Z_95 * d.se);
    const hi  = profile.transform(d.yi + Z_95 * d.se);
    const lbl = d.label.length > 40 ? d.label.slice(0, 39) + "\u2026" : d.label;
    const cls = d.filled ? ' class="imputed"' : "";
    return `<tr${cls}>
      <td>${esc(lbl)}</td>
      <td>${fmtV(ef)}</td>
      <td>${fmtV(lo)}</td>
      <td>${fmtV(hi)}</td>
      <td>${fmtV(d.se)}</td>
      <td>${fmtPct(pct)}</td>
    </tr>`;
  }).join("");

  const pooledEf = profile.transform(m.RE);
  const pooledLo = profile.transform(m.ciLow);
  const pooledHi = profile.transform(m.ciHigh);

  return `
<section>
  <h2>Study-Level Results</h2>
  <table class="stat-table study-tbl">
    <thead><tr>
      <th>Study</th><th>Effect</th><th>95% CI (low)</th><th>95% CI (high)</th>
      <th>${esc(seLabel)}</th><th>RE Weight</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="pooled">
      <td>Pooled (RE)</td>
      <td>${fmtV(pooledEf)}</td>
      <td>${fmtV(pooledLo)}</td>
      <td>${fmtV(pooledHi)}</td>
      <td>${fmtV(m.seRE)}</td>
      <td>100%</td>
    </tr></tfoot>
  </table>
</section>`;
}

function sectionRegression(reg, method, ciMethod) {
  if (!reg || reg.rankDeficient || !reg.colNames) return "";

  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";
  const statLabel = reg.dist === "t" ? `t(${reg.QEdf})` : "z";
  const QMlabel   = reg.QMdist === "F"
    ? `F(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;
  const R2row = reg.p > 1 && isFinite(reg.R2)
    ? ` · R² = ${fmt(reg.R2 * 100)}%` : "";

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
    </tr>`;
  }).join("");

  return `
<section>
  <h2>Meta-Regression</h2>
  <p class="meta-line">
    k = ${reg.k} · ${esc(method)} · ${esc(ciLabel)}
    · τ² = ${fmt(reg.tau2)} · I² = ${fmt(reg.I2)}%${R2row}
    · QE(${reg.QEdf}) = ${fmt(reg.QE)}, p = ${fmtP(reg.QEp)}
    ${reg.p > 1 ? `· QM ${esc(QMlabel)} = ${fmt(reg.QM)}, p = ${fmtP(reg.QMp)}` : ""}
  </p>
  <table class="stat-table">
    <thead><tr>
      <th>Term</th><th>β</th><th>SE</th><th>${esc(statLabel)}</th>
      <th>p</th><th>95% CI</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">*** p &lt; .001 · ** p &lt; .01 · * p &lt; .05 · . p &lt; .10</p>
</section>`;
}

function sectionPlot(label, svgStrings) {
  const filled = svgStrings.filter(Boolean);
  if (!filled.length) return "";
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

export function buildReport(args) {
  const {
    studies, m, profile, reg, tf, influence, subgroup,
    method, ciMethod, useTF, forestOptions,
    pcurve, puniform,
  } = args;

  const date  = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });
  const k = studies.filter(d => !d.filled).length;
  const ciLabel = ciMethod === "KH" ? "Knapp-Hartung"
                : ciMethod === "t"  ? "t-dist CI"
                : ciMethod === "PL" ? "Profile Likelihood"
                : "Normal CI";

  // Collect forest SVGs for every page; other plots read directly from DOM.
  const forestSVGs   = forestOptions
    ? collectForestSVGs(studies, m, forestOptions)
    : [];

  function liveSVG(id) {
    const el = document.getElementById(id);
    return el ? serializeSVG(el) : "";
  }
  const bubbleSVGs = (() => {
    const c = document.getElementById("bubblePlots");
    return c ? Array.from(c.querySelectorAll("svg")).map(serializeSVG) : [];
  })();

  const body = [
    sectionSummary(args),
    sectionPubBias(args),
    sectionPUniform(puniform, m, profile),
    sectionInfluence(influence, k),
    sectionSubgroup(subgroup, profile),
    sectionStudyTable(args),
    sectionRegression(reg, method, ciMethod),
    sectionPlot("Forest Plot", forestSVGs),
    sectionPlot("Funnel Plot",            [liveSVG("funnelPlot")]),
    sectionPlot("Influence Plot",         [liveSVG("influencePlot")]),
    sectionPlot("Baujat Plot",            [liveSVG("baujatPlot")]),
    sectionPlot("Cumulative Forest Plot", [liveSVG("cumulativePlot")]),
    sectionPlot("Cumulative Funnel Plot", [liveSVG("cumulativeFunnelPlot")]),
    sectionPlot("P-curve",                [liveSVG("pCurvePlot")]),
    sectionPlot("P-uniform",              [liveSVG("pUniformPlot")]),
    sectionPlot("Orchard Plot",           [liveSVG("orchardPlot")]),
    sectionPlot("Caterpillar Plot",       [liveSVG("caterpillarPlot")]),
    sectionPlot("Risk-of-bias Traffic Light", [liveSVG("robTrafficLight")]),
    sectionPlot("Risk-of-bias Summary",   [liveSVG("robSummary")]),
    sectionPlot("Bubble Plots",           bubbleSVGs),
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
