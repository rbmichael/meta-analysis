// =============================================================================
// ui-render.js — Pure HTML builders and results panel renderers
//
// All functions are stateless: they receive computed data as parameters and
// return HTML strings or write to a specific DOM element passed by caller.
// No imports from ui.js — avoids circular dependency.
//
// Extracted from ui.js (item 4.2.1 of TECHNICAL IMPROVEMENT ROADMAP).
// =============================================================================

import { fmt, fmtPval } from "./utils.js";
import { effectProfiles } from "./profiles.js";
import { Z_95 } from "./constants.js";
import { leaveOneOut, estimatorComparison } from "./influence.js";
import { adjustPvals } from "./regression.js";
import { drawPCurve, drawPUniform } from "./plots.js";
import { escapeHTML } from "./utils-html.js";
// Keep in sync with HELP_LABELS in ui.js.
const _RENDER_HELP_LABELS = {
  "diag.locationscale":  "Location-scale model",
  "diag.metaregression": "Meta-regression",
  "mreg.lrt":            "Likelihood ratio test",
  "reg.aic":             "Model fit statistics (AIC/BIC/LL)",
  "sens.loo":            "Leave-one-out analysis",
  "sens.estimator":      "Estimator comparison",
  "het.tau2":            "τ² between-study variance",
  "het.Q":               "Q heterogeneity statistic",
  "het.I2":              "I² heterogeneity",
  "het.H2":              "H² heterogeneity",
  "sel.model":           "Selection model",
  "sel.halfnorm":        "Half-normal selection model",
  "sel.power":           "Power selection model",
  "sel.negexp":          "Negative exponential selection model",
  "sel.beta":            "Beta selection model",
  "diag.influence":      "Influence diagnostics",
  "diag.dffits":         "DFFITS influence statistic",
  "diag.covratio":       "CovRatio influence statistic",
  "diag.subgroup":       "Subgroup analysis",
  "bayes.sensitivity":   "Bayesian prior sensitivity",
  "pool.cles":           "Common language effect size",
  "cluster.robust":      "Robust confidence interval",
};
function hBtn(key) {
  const base  = key.replace(/\.$/, "").split(".")[0];
  const label = _RENDER_HELP_LABELS[key] ?? _RENDER_HELP_LABELS[base] ?? key;
  const aria  = label === key ? "Help" : `Help: ${label}`;
  return `<button class="help-btn" data-help="${key}" aria-label="${aria}" title="Help">?</button>`;
}
function getCiLabel() {
  return (document.getElementById("ciLevel")?.value ?? "95") + "% CI";
}

// ---------------- META-REGRESSION RESULTS PANEL ----------------

/**
 * formatContrastResult(result, reg)
 * Returns an HTML string for the contrast test result row.
 * @param {{ est, se, stat, p, ci }} result  from testContrast()
 * @param {{ dist: string, QEdf: number }} reg  the regression result object
 */
export function formatContrastResult(result, reg) {
  const { est, se, stat, p, ci } = result;
  const statLabel = reg.dist === "t" ? `<em>t</em>(${reg.QEdf})` : "<em>z</em>";
  const ciLabel   = getCiLabel();
  if (!isFinite(est)) {
    return `<div class="reg-note reg-warn" style="margin-top:6px">
      ⚠ Contrast SE is zero — all weights may be zero or the contrast is not estimable.
    </div>`;
  }
  return `
    <table class="reg-table" style="margin-top:8px">
      <thead><tr>
        <th>Estimate</th><th>SE</th><th>${statLabel}</th><th><em>p</em></th><th>${ciLabel}</th>
      </tr></thead>
      <tbody><tr>
        <td>${fmt(est)}</td>
        <td>${fmt(se)}</td>
        <td>${fmt(stat)}</td>
        <td>${regFmtP(p)}</td>
        <td>[${fmt(ci[0])}, ${fmt(ci[1])}]</td>
      </tr></tbody>
    </table>`;
}

export function regStars(p) {
  if (p < 0.001) return `<span class="reg-sig-3">***</span>`;
  if (p < 0.01)  return `<span class="reg-sig-2">**</span>`;
  if (p < 0.05)  return `<span class="reg-sig-1">*</span>`;
  if (p < 0.10)  return `<span style="color:var(--fg-muted)">.</span>`;
  return "";
}

export function regFmtP(p) {
  if (!isFinite(p)) return "—";
  if (p < 0.001) return `<span class="reg-sig-3">&lt; .001</span>`;
  const s   = p.toFixed(3).replace(/^0\./, ".");
  const cls = p < 0.01 ? "reg-sig-2" : p < 0.05 ? "reg-sig-1" : "";
  return cls ? `<span class="${cls}">${s}</span>` : s;
}

export function buildRegCoeffRows(reg, adjPs = null, mods = []) {
  const hasVif    = Array.isArray(reg.vif) && reg.vif.length === reg.p;
  const hasRobust = reg.isClustered && Array.isArray(reg.robustSE);
  // Group header rows only when there are genuinely multiple moderators whose
  // column indices are tracked in modTests.
  const multiMod = mods.length > 1
    && Array.isArray(reg.modTests) && reg.modTests.length > 0;
  const colCount = 8 + (hasRobust ? 4 : 0);  // Term + β + SE + stat + p + CI + VIF + stars [+ Rob.SE + Rob.t + Rob.p + Rob.CI]

  function vifCell(j) {
    if (!hasVif || j === 0) return `<td class="reg-vif">—</td>`;
    const v = reg.vif[j];
    if (!isFinite(v)) return `<td class="reg-vif">—</td>`;
    const cls = v > 10 ? "vif-high" : v > 5 ? "vif-mid" : "vif-ok";
    return `<td class="reg-vif ${cls}">${v.toFixed(2)}</td>`;
  }

  function dataRow(j) {
    const [lo, hi] = reg.ci[j];
    const robustCells = hasRobust ? (() => {
      const rci = Array.isArray(reg.robustCi?.[j]) ? reg.robustCi[j] : [NaN, NaN];
      const rt  = isFinite(reg.robustZ?.[j]) ? fmt(reg.robustZ[j]) : "NA";
      return `<td>${fmt(reg.robustSE[j])}</td>`
           + `<td>${rt}</td>`
           + `<td>${regFmtP(reg.robustP[j])}</td>`
           + `<td>[${fmt(rci[0])}, ${fmt(rci[1])}]</td>`;
    })() : "";
    return `<tr class="${j === 0 ? "reg-intercept" : ""}">
      <td>${reg.colNames[j]}</td>
      <td>${fmt(reg.beta[j])}</td>
      <td>${fmt(reg.se[j])}</td>
      <td>${fmt(reg.zval[j])}</td>
      <td>${regFmtP(reg.pval[j])}</td>
      <td>[${fmt(lo)}, ${fmt(hi)}]</td>
      ${vifCell(j)}
      <td>${regStars(reg.pval[j])}</td>
      ${robustCells}
    </tr>`;
  }

  if (!multiMod) {
    return reg.colNames.map((_, j) => dataRow(j)).join("");
  }

  // Multi-moderator: intercept first, then one labelled group per moderator.
  let html = dataRow(0);
  for (let mi = 0; mi < reg.modTests.length; mi++) {
    const mt = reg.modTests[mi];
    if (mt.colIdxs.length === 0) continue;
    const QMlabel = reg.QMdist === "F"
      ? `F(${mt.QMdf},\u2009${reg.QEdf})`
      : `χ²(${mt.QMdf})`;
    let qmStr = isFinite(mt.QM)
      ? ` &nbsp;·&nbsp; <em>Q</em>M ${QMlabel} = ${fmt(mt.QM)}, <em>p</em> = ${regFmtP(mt.QMp)}`
      : "";
    if (adjPs && adjPs[mi] !== undefined && isFinite(adjPs[mi]) && adjPs[mi] !== mt.QMp) {
      qmStr += `, <em>p</em> (adj) = ${regFmtP(adjPs[mi])}`;
    }
    html += `<tr class="reg-mod-group">
      <td colspan="${colCount}"><span class="reg-mod-name">${escapeHTML(mt.name)}</span>${qmStr}</td>
    </tr>`;
    for (const j of mt.colIdxs) html += dataRow(j);
  }
  return html;
}

export function buildRegFittedRows(reg) {
  if (!reg.labels || !reg.fitted) return "";
  return reg.labels.map((lbl, i) => {
    const sr   = reg.stdResiduals[i];
    const flag = Math.abs(sr) > Z_95 ? " style='color:var(--color-warning)'" : "";
    return `<tr>
      <td>${lbl ? escapeHTML(lbl) : i + 1}</td>
      <td>${fmt(reg.yi[i])}</td>
      <td>${fmt(reg.fitted[i])}</td>
      <td>${fmt(reg.residuals[i])}</td>
      <td${flag}>${fmt(sr)}</td>
    </tr>`;
  }).join("");
}

// ---- Location-scale model panel ----
export function renderLocationScalePanel(ls, ciMethod, kExcluded = 0) {
  const panel   = document.getElementById("regressionPanel");
  const section = document.getElementById("regressionSection");
  section.style.display = "";

  if (ls.rankDeficient) {
    const need = ls.p + ls.q + 1;
    const have = ls.k ?? 0;
    const msg  = ls.rankDeficientCause === "insufficient_k"
      ? `Location-scale model needs more complete data: ${have} row${have === 1 ? "" : "s"} ` +
        `ha${have === 1 ? "s" : "ve"} all values filled in, but at least ${need} are required.`
      : `Design matrix is rank-deficient — moderators appear perfectly collinear.`;
    panel.innerHTML = `
      <div class="reg-header">
        <span class="reg-title">Location-Scale Model${hBtn("diag.locationscale")}</span>
      </div>
      <div class="reg-body"><i>${msg}</i></div>`;
    return;
  }

  const crit   = ls.crit;
  const ciLbl  = getCiLabel();
  const tau2min = Math.min(...ls.tau2_i);
  const tau2max = Math.max(...ls.tau2_i);
  const tau2rng = ls.q > 1
    ? `τ²ᵢ range: [${fmt(tau2min)}, ${fmt(tau2max)}]`
    : `τ² = ${fmt(ls.tau2_mean)}`;

  // Location coefficient rows
  function locRows() {
    const multiMod = ls.p > 1 && Array.isArray(ls.locModTests) && ls.locModTests.length > 0;
    function dataRow(j) {
      const [lo, hi] = ls.ci_beta[j];
      return `<tr class="${j === 0 ? "reg-intercept" : ""}">
        <td>${ls.locColNames[j]}</td>
        <td>${fmt(ls.beta[j])}</td>
        <td>${fmt(ls.se_beta[j])}</td>
        <td>${fmt(ls.zval_beta[j])}</td>
        <td>${regFmtP(ls.pval_beta[j])}</td>
        <td>[${fmt(lo)}, ${fmt(hi)}]</td>
        <td>${regStars(ls.pval_beta[j])}</td>
      </tr>`;
    }
    if (!multiMod) return ls.locColNames.map((_, j) => dataRow(j)).join("");
    let html = dataRow(0);
    for (const mt of ls.locModTests) {
      if (!mt.colIdxs || mt.colIdxs.length === 0) continue;
      const qmStr = isFinite(mt.QM)
        ? ` &nbsp;·&nbsp; <em>Q</em>M χ²(${mt.QMdf}) = ${fmt(mt.QM)}, <em>p</em> = ${regFmtP(mt.QMp)}`
        : "";
      html += `<tr class="reg-mod-group"><td colspan="7"><span class="reg-mod-name">${escapeHTML(mt.name)}</span>${qmStr}</td></tr>`;
      for (const j of mt.colIdxs) html += dataRow(j);
    }
    return html;
  }

  // Scale coefficient rows (log τ² = Zγ)
  function scaleRows() {
    const multiMod = ls.q > 1 && Array.isArray(ls.scaleModTests) && ls.scaleModTests.length > 0;
    function dataRow(j) {
      const [lo, hi] = ls.ci_gamma[j];
      const tau2val  = fmt(Math.exp(ls.gamma[j]));
      return `<tr class="${j === 0 ? "reg-intercept" : ""}">
        <td>${ls.scaleColNames[j]}</td>
        <td>${fmt(ls.gamma[j])}</td>
        <td>${fmt(ls.se_gamma[j])}</td>
        <td>${fmt(ls.zval_gamma[j])}</td>
        <td>${regFmtP(ls.pval_gamma[j])}</td>
        <td>[${fmt(lo)}, ${fmt(hi)}]</td>
        <td>${j === 0 ? `<span title="exp(γ₀) = τ²">eˣ=${tau2val}</span>` : regStars(ls.pval_gamma[j])}</td>
      </tr>`;
    }
    if (!multiMod) return ls.scaleColNames.map((_, j) => dataRow(j)).join("");
    let html = dataRow(0);
    for (const mt of ls.scaleModTests) {
      if (!mt.colIdxs || mt.colIdxs.length === 0) continue;
      const qmStr = isFinite(mt.QM)
        ? ` &nbsp;·&nbsp; <em>Q</em>M χ²(${mt.QMdf}) = ${fmt(mt.QM)}, <em>p</em> = ${regFmtP(mt.QMp)}`
        : "";
      html += `<tr class="reg-mod-group"><td colspan="7"><span class="reg-mod-name">${escapeHTML(mt.name)}</span>${qmStr}</td></tr>`;
      for (const j of mt.colIdxs) html += dataRow(j);
    }
    return html;
  }

  // Fitted values table with study-specific τ²ᵢ
  function fittedRows() {
    if (!ls.labels || !ls.fitted) return "";
    return ls.labels.map((lbl, i) => `<tr>
      <td>${lbl ? escapeHTML(lbl) : i + 1}</td>
      <td>${fmt(ls.yi[i])}</td>
      <td>${fmt(ls.fitted[i])}</td>
      <td>${fmt(ls.residuals[i])}</td>
      <td>${fmt(ls.tau2_i[i])}</td>
    </tr>`).join("");
  }

  const excWarn = kExcluded > 0
    ? `<div class="reg-note reg-warn">⚠ ${kExcluded} ${kExcluded === 1 ? "study" : "studies"} excluded (missing moderator value${kExcluded === 1 ? "" : "s"}).</div>`
    : "";

  const QM_locRow = ls.p > 1 && isFinite(ls.QM_loc)
    ? ` &nbsp;·&nbsp; <em>Q</em>M<sub>loc</sub> χ²(${ls.QM_locDf}) = ${fmt(ls.QM_loc)}, <em>p</em> = ${regFmtP(ls.QM_locP)}`
    : "";
  const QM_scaleRow = ls.q > 1 && isFinite(ls.QM_scale)
    ? ` &nbsp;·&nbsp; <em>Q</em>M<sub>scale</sub> χ²(${ls.QM_scaleDf}) = ${fmt(ls.QM_scale)}, <em>p</em> = ${regFmtP(ls.QM_scaleP)}`
    : "";
  const lrRow = ls.q > 1 && isFinite(ls.LRchi2)
    ? `<br><span style="color:var(--fg-muted);font-size:0.93em">LR test (scale mods): χ²(${ls.LRdf}) = ${fmt(ls.LRchi2)}, <em>p</em> = ${regFmtP(ls.LRp)}</span>`
    : "";

  const fRows = fittedRows();

  panel.innerHTML = `
    <div class="reg-header">
      <span class="reg-title">Location-Scale Model${hBtn("diag.locationscale")}</span>
      <span class="reg-meta">k = ${ls.k} &nbsp;·&nbsp; ML &nbsp;·&nbsp; Normal CI</span>
    </div>
    <div class="reg-het">
      ${tau2rng} &nbsp;·&nbsp; I² = ${fmt(ls.I2)}%
      &nbsp;·&nbsp; <em>Q</em>E(${ls.QEdf}) = ${fmt(ls.QE)}, <em>p</em> = ${regFmtP(ls.QEp)}
      ${QM_locRow}${QM_scaleRow}
      ${lrRow}
      <br><span style="color:var(--fg-muted);font-size:0.93em">LL = ${fmt(ls.LL)} (ML; log τ²ᵢ = Zᵢγ)</span>
    </div>
    <div class="reg-body">
      ${excWarn}
      <p style="margin:4px 0 2px;font-weight:600;font-size:0.95em">Location model — E[yᵢ] = Xᵢβ</p>
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>β</th><th>SE</th><th><em>z</em></th>
          <th><em>p</em></th><th>${ciLbl}</th><th></th>
        </tr></thead>
        <tbody>${locRows()}</tbody>
      </table>
      <p style="margin:10px 0 2px;font-weight:600;font-size:0.95em">Scale model — log τ²ᵢ = Zᵢγ</p>
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>γ</th><th>SE</th><th><em>z</em></th>
          <th><em>p</em></th><th>${ciLbl}</th><th></th>
        </tr></thead>
        <tbody>${scaleRows()}</tbody>
      </table>
      <div class="reg-note">*** <em>p</em> &lt; .001 &nbsp;·&nbsp; ** <em>p</em> &lt; .01 &nbsp;·&nbsp; * <em>p</em> &lt; .05 &nbsp;·&nbsp; · <em>p</em> &lt; .10 &nbsp;·&nbsp; eˣ: exponentiated intercept = τ² when all scale predictors = 0</div>
      ${fRows ? `
      <details>
        <summary>Fitted values &amp; study-specific τ²ᵢ (k = ${ls.k})</summary>
        <table class="reg-table">
          <thead><tr>
            <th>Study</th><th>yᵢ</th><th>ŷᵢ</th><th>eᵢ</th><th>τ²ᵢ</th>
          </tr></thead>
          <tbody>${fRows}</tbody>
        </table>
      </details>` : ""}
    </div>`;
}

export function renderRegressionPanel(reg, method, ciMethod, kExcluded = 0, mods = []) {
  const panel = document.getElementById("regressionPanel");
  const section = document.getElementById("regressionSection");

  if (!mods.length) { section.style.display = "none"; return; }
  section.style.display = "";

  if (reg.rankDeficient) {
    let msg;
    if (reg.rankDeficientCause === "insufficient_k") {
      const need = (reg.p ?? 2) + 1;
      const have = reg.k ?? 0;
      msg = `Regression needs more complete data: ${have} row${have === 1 ? "" : "s"} ` +
            `ha${have === 1 ? "s" : "ve"} all moderator values filled in, ` +
            `but at least ${need} ${need === 1 ? "is" : "are"} required (one per model parameter). ` +
            `Rows with any blank moderator cell are excluded — fill in the missing values.` +
            (kExcluded > 0 ? ` (${kExcluded} ${kExcluded === 1 ? "row" : "rows"} currently excluded)` : "");
    } else {
      msg = `Design matrix is rank-deficient — moderators appear perfectly collinear ` +
            `(e.g. two continuous columns with proportional values, or two categorical columns with identical groupings).`;
    }
    panel.innerHTML = `
      <div class="reg-header">
        <span class="reg-title">Meta-Regression${hBtn("diag.metaregression")}</span>
      </div>
      <div class="reg-body"><i>${msg}</i></div>`;
    return;
  }

  const statLabel = reg.dist === "t" ? `<em>t</em>(${reg.QEdf})` : "<em>z</em>";
  const QMlabel   = reg.QMdist === "F"
    ? `<em>F</em>(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;
  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";

  const QMrow = reg.p > 1
    ? ` &nbsp;·&nbsp; <em>Q</em>M ${QMlabel} = ${fmt(reg.QM)}, <em>p</em> = ${regFmtP(reg.QMp)}`
    : "";

  const mccMethod = document.getElementById("mccMethod")?.value ?? "none";
  const rawModPs  = Array.isArray(reg.modTests) ? reg.modTests.map(mt => mt.QMp) : [];
  const adjModPs  = mccMethod !== "none" && rawModPs.length > 1
    ? adjustPvals(rawModPs, mccMethod) : null;

  const rows       = buildRegCoeffRows(reg, adjModPs, mods);
  const fittedRows = buildRegFittedRows(reg);

  const lowDfWarning = reg.QEdf < 3
    ? `<div class="reg-note reg-warn">⚠ Very few residual df (k − p = ${reg.QEdf}) — estimates may be unreliable.</div>`
    : "";
  const excludedWarning = kExcluded > 0
    ? `<div class="reg-note reg-warn">⚠ ${kExcluded} ${kExcluded === 1 ? "study" : "studies"} excluded from regression (missing moderator value${kExcluded === 1 ? "" : "s"}).</div>`
    : "";
  const vifWarning = isFinite(reg.maxVIF) && reg.maxVIF > 10
    ? `<div class="reg-note reg-warn">⚠ High collinearity detected (max VIF = ${reg.maxVIF.toFixed(1)}) — coefficient estimates may be unstable.</div>`
    : "";
  const clusterRegNote = reg.isClustered
    ? `<div class="reg-note" style="margin:2px 0 6px">Cluster-robust SEs active (C&nbsp;=&nbsp;${reg.clustersUsed} cluster${reg.clustersUsed === 1 ? "" : "s"}${reg.allSingletons ? " — all singletons (HC-robust)" : ""}).</div>`
    : (reg.robustError
      ? `<div class="reg-note reg-warn">⚠ Cluster-robust SE: ${reg.robustError}</div>`
      : "");

  // Per-moderator test block — only rendered when there are 2+ moderators.
  const mccLabel = mccMethod === "bonferroni" ? "Bonferroni"
                 : mccMethod === "holm"       ? "Holm"
                 : "";
  const hasAdjPs = adjModPs !== null && adjModPs.length > 0;
  const hasLRT = Array.isArray(reg.modTests) && reg.modTests.some(mt => isFinite(mt.lrt));
  const modTestsBlock = mods.length >= 2
    && Array.isArray(reg.modTests) && reg.modTests.length > 0
    ? `<details>
        <summary>Per-moderator tests (${reg.modTests.length}${hasAdjPs ? `, ${mccLabel} adj.` : ""})</summary>
        <table class="reg-table">
          <thead><tr>
            <th>Moderator</th>
            <th>${reg.QMdist === "F" ? "<em>F</em>" : "<em>Q</em>M"} (Wald)</th>
            ${hasLRT ? `<th>LRT χ²${hBtn("mreg.lrt")}</th>` : ""}
            <th>df</th>
            <th><em>p</em> (Wald)</th>
            ${hasLRT ? `<th><em>p</em> (LRT)</th>` : ""}
            ${hasAdjPs ? `<th><em>p</em> (${mccLabel})</th>` : ""}
          </tr></thead>
          <tbody>
            ${reg.modTests.map((mt, mi) => {
              if (mt.QMdf === 0) {
                return `<tr><td>${mt.name}</td><td colspan="${(hasAdjPs ? 1 : 0) + (hasLRT ? 2 : 0) + 3}"><i>degenerate (≤ 1 level)</i></td></tr>`;
              }
              const dfLabel = reg.QMdist === "F"
                ? `F(${mt.QMdf},\u2009${reg.QEdf})`
                : `χ²(${mt.QMdf})`;
              const lrtStatCell = hasLRT
                ? `<td>${isFinite(mt.lrt) ? fmt(mt.lrt) : "NA"}</td>`
                : "";
              const lrtPCell = hasLRT
                ? `<td>${isFinite(mt.lrtP) ? regFmtP(mt.lrtP) : "NA"}</td>`
                : "";
              const adjCell = hasAdjPs
                ? `<td>${regFmtP(adjModPs[mi])}</td>` : "";
              return `<tr>
                <td>${mt.name}</td>
                <td>${fmt(mt.QM)}</td>
                ${lrtStatCell}
                <td>${dfLabel}</td>
                <td>${regFmtP(mt.QMp)}</td>
                ${lrtPCell}
                ${adjCell}
              </tr>`;
            }).join("")}
          </tbody>
        </table>
        ${hasLRT ? `<div class="reg-note">LRT\u202F=\u202FLikelihood Ratio Test; uses ML estimation internally regardless of τ² method selected.</div>` : ""}
        ${hasAdjPs ? `<div class="reg-note">${mccLabel} correction applied across m\u2009=\u2009${rawModPs.length} moderator tests.</div>` : ""}
      </details>`
    : "";

  const robustHeaders = reg.isClustered
    ? `<th>Rob.SE</th><th>Rob.<em>t</em></th><th>Rob.<em>p</em></th><th>Rob.CI</th>`
    : "";

  panel.innerHTML = `
    <div class="reg-header">
      <span class="reg-title">Meta-Regression${hBtn("diag.metaregression")}</span>
      <span class="reg-meta">k = ${reg.k} &nbsp;·&nbsp; ${method} &nbsp;·&nbsp; ${ciLabel}</span>
    </div>
    <div class="reg-het">
      τ² = ${fmt(reg.tau2)} (residual) &nbsp;·&nbsp; I² = ${fmt(reg.I2)}%
      ${reg.p > 1 ? `&nbsp;·&nbsp; R² = ${isFinite(reg.R2) ? fmt(reg.R2 * 100) + "%" : "N/A"}` : ""}
      &nbsp;·&nbsp; <em>Q</em>E(${reg.QEdf}) = ${fmt(reg.QE)}, <em>p</em> = ${regFmtP(reg.QEp)}
      ${QMrow}
      <br><span style="color:var(--fg-muted);font-size:0.93em">${hBtn("reg.aic")}AIC&nbsp;=&nbsp;${fmt(reg.AIC)} &nbsp;·&nbsp; BIC&nbsp;=&nbsp;${fmt(reg.BIC)} &nbsp;·&nbsp; LL&nbsp;=&nbsp;${fmt(reg.LL)}${ciMethod === "KH" && isFinite(reg.s2) ? ` &nbsp;·&nbsp; KH&nbsp;<em>s</em>²&nbsp;=&nbsp;${fmt(reg.s2)}` : ""}&nbsp;&nbsp;<span style="font-size:0.9em;opacity:0.75">(${method}; compare ${method === "REML" ? "models with same predictors only" : "any nested models"})</span></span>
    </div>
    <div class="reg-body">
      ${clusterRegNote}${excludedWarning}${lowDfWarning}${vifWarning}
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>β</th><th>SE</th><th>${statLabel}</th>
          <th><em>p</em></th><th>${getCiLabel()}</th><th>VIF</th><th></th>
          ${robustHeaders}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="reg-note">*** <em>p</em> &lt; .001 &nbsp;·&nbsp; ** <em>p</em> &lt; .01 &nbsp;·&nbsp; * <em>p</em> &lt; .05 &nbsp;·&nbsp; · <em>p</em> &lt; .10</div>
      ${modTestsBlock}
      <details class="contrast-section">
        <summary>Custom contrasts${hBtn("mreg.contrasts")}</summary>
        <div class="reg-note" style="margin:4px 0 8px">
          Enter a weight for each term, then click <em>Test</em>.
          The test evaluates whether the linear combination L·β differs from zero.
          Example: to compare two categorical levels, set their weights to 1 and −1.
        </div>
        <table class="reg-table">
          <thead><tr><th>Term</th><th style="width:6em">Weight</th></tr></thead>
          <tbody>
            ${reg.colNames.map((name, i) => `
              <tr>
                <td>${name}</td>
                <td><input type="number" class="contrast-weight" data-idx="${i}"
                     value="0" step="any" style="width:5em"></td>
              </tr>`).join("")}
          </tbody>
        </table>
        <button class="btn-sm contrast-test-btn" type="button" style="margin-top:6px">
          Test contrast
        </button>
        <div class="contrast-result"></div>
      </details>
      ${fittedRows ? `
      <details>
        <summary>Fitted values &amp; residuals (k = ${reg.k})</summary>
        <table class="reg-table">
          <thead><tr>
            <th>Study</th><th>yᵢ</th><th>ŷᵢ</th><th>eᵢ</th><th>std. eᵢ</th>
          </tr></thead>
          <tbody>${fittedRows}</tbody>
        </table>
        <div class="reg-note">Standardized residuals |std. e| &gt; 1.96 highlighted.</div>
      </details>` : ""}
      ${reg.vcov && reg.p >= 2 ? `
      <details>
        <summary>Coefficient covariance matrix (vcov)</summary>
        <div class="reg-note" style="margin:4px 0 8px">
          The ${reg.p}&times;${reg.p} variance-covariance matrix of regression coefficients.
          Useful for computing SEs of linear combinations not available in the contrasts panel.
          ${reg.isClustered ? "Note: this is the model-based vcov, not the cluster-robust sandwich estimator." : ""}
        </div>
        <button class="btn-sm vcov-download-btn" type="button">Download vcov as CSV</button>
      </details>` : ""}
    </div>`;
}

// ---------------- SENSITIVITY ANALYSIS PANEL ----------------

export const TAU_METHOD_LABELS = {
  DL:   "DerSimonian-Laird (DL)",
  REML: "REML",
  PM:   "Paule-Mandel (PM)",
  ML:   "Maximum Likelihood (ML)",
  HS:   "Hunter-Schmidt (HS)",
  HE:   "Hedges (HE)",
  SJ:   "Sidik-Jonkman (SJ)",
};

function sensFv(v)  { return isFinite(v) ? v.toFixed(3) : "—"; }
function sensFvp(v) { return isFinite(v) ? (v < 0.001 ? "< .001" : v.toFixed(3).replace(/^0\./, ".")) : "—"; }
function sensTrunc(s, n) { const e = escapeHTML(s); return e.length > n ? e.slice(0, n - 1) + "\u2026" : e; }

function buildLooBody(loo, fullSig, fullEst, profile) {
  if (loo.rows.length === 0) {
    return `<p class="sens-placeholder">Need at least 3 studies for leave-one-out analysis.</p>`;
  }
  const headerRow = `
    <tr>
      <th>Study omitted</th>
      <th>Estimate</th>
      <th>${getCiLabel()} (low)</th>
      <th>${getCiLabel()} (high)</th>
      <th>I² (%)</th>
      <th>τ²</th>
      <th><em>p</em></th>
      <th>Δ estimate</th>
    </tr>`;
  const dataRows = loo.rows.map(row => {
    const est       = profile.transform(row.estimate);
    const ci        = { lb: profile.transform(row.lb), ub: profile.transform(row.ub) };
    const delta     = est - fullEst;
    const sigChange = row.significant !== fullSig;
    const cls       = sigChange ? " class=\"sens-sigchange\"" : "";
    const deltaStr  = (delta >= 0 ? "+" : "") + sensFv(delta);
    return `
      <tr${cls}>
        <td>${sensTrunc(row.label, 40)}</td>
        <td>${sensFv(est)}</td>
        <td>${sensFv(ci.lb)}</td>
        <td>${sensFv(ci.ub)}</td>
        <td>${sensFv(row.i2)}</td>
        <td>${sensFv(row.tau2)}</td>
        <td>${sensFvp(row.pval)}</td>
        <td class="sens-delta">${deltaStr}</td>
      </tr>`;
  }).join("");
  return `
    <table class="study-table sens-table">
      <thead>${headerRow}</thead>
      <tbody>${dataRows}</tbody>
    </table>
    <div class="sens-note">
      Rows highlighted amber: removing that study changes statistical significance (p = .05 threshold).
      Δ estimate = back-transformed leave-one-out estimate minus full-set estimate.
    </div>`;
}

function buildEstimatorBody(estData, method, profile) {
  const rows = estData.map(row => {
    const est       = profile.transform(row.estimate);
    const ci        = { lb: profile.transform(row.lb), ub: profile.transform(row.ub) };
    const isCurrent = row.method === method;
    const cls       = isCurrent ? " class=\"sens-current\"" : "";
    return `
      <tr${cls}>
        <td>${TAU_METHOD_LABELS[row.method] ?? row.method}${isCurrent ? " ★" : ""}</td>
        <td>${sensFv(est)}</td>
        <td>${sensFv(ci.lb)}</td>
        <td>${sensFv(ci.ub)}</td>
        <td>${sensFv(row.tau2)}</td>
        <td>${sensFv(row.i2)}</td>
      </tr>`;
  }).join("");
  return `
    <table class="study-table sens-table">
      <thead>
        <tr>
          <th>τ² estimator</th>
          <th>Estimate</th>
          <th>${getCiLabel()} (low)</th>
          <th>${getCiLabel()} (high)</th>
          <th>τ²</th>
          <th>I² (%)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sens-note">★ = currently selected estimator.</div>`;
}
export function renderSensitivityPanel(studies, m, method, ciMethod, profile, { isMHFallback = false } = {}, alpha = 0.05) {
  const container = document.getElementById("sensitivityPanel");
  if (!container) return;

  // Preserve open/collapsed state of the two <details> blocks across re-renders.
  const blocks = container.querySelectorAll(".sens-block");
  const openState = [...blocks].map(b => b.open);
  const looOpen = openState[0] ?? true;
  const estOpen = openState[1] ?? true;

  // ---- Leave-one-out ----
  // Pass the already-computed meta result to avoid rerunning meta() for the full set.
  const loo     = leaveOneOut(studies, method, ciMethod, m, alpha);
  const fullSig = loo.full.pval < 0.05;
  const fullEst = profile.transform(loo.full.RE);
  const looBody = buildLooBody(loo, fullSig, fullEst, profile);

  // ---- Estimator comparison ----
  const estBody = buildEstimatorBody(estimatorComparison(studies, ciMethod), method, profile);

  const ivNote = isMHFallback
    ? `<p class="reg-note" style="margin:4px 0 8px">⚠ Leave-one-out and estimator comparison use inverse-variance (DL) weights — M-H/Peto per-fold pooling is not yet supported.</p>`
    : "";

  container.innerHTML = `
    ${ivNote}
    <details class="sens-block"${looOpen ? " open" : ""}>
      <summary class="sens-summary">
        Leave-one-out analysis ${hBtn("sens.loo")}
      </summary>
      ${looBody}
    </details>
    <details class="sens-block"${estOpen ? " open" : ""}>
      <summary class="sens-summary">
        τ² estimator comparison ${hBtn("sens.estimator")}
      </summary>
      ${estBody}
    </details>`;

  // Prevent <summary> from toggling <details> when a help button inside it is
  // clicked. stopPropagation() at the button level would also block the
  // document-level help listener, so we use preventDefault() on the summary
  // instead — this cancels the toggle while still letting the event bubble.
  container.querySelectorAll(".sens-summary").forEach(summary => {
    summary.addEventListener("click", e => {
      if (e.target.closest(".help-btn")) e.preventDefault();
    });
  });
}

// ---------------- STUDY-LEVEL RESULTS TABLE ----------------
export function renderStudyTable(studies, m, profile) {
  const container = document.getElementById("studyTable");
  if (!container) return;

  // For MH/Peto use FE (τ²=0) weights; for RE use τ²-inflated weights.
  const tau2      = (m.isMH || m.isPeto || !isFinite(m.tau2)) ? 0 : m.tau2;
  const real      = studies.filter(d => !d.filled);
  const totalW    = real.reduce((s, d) => s + 1 / (d.vi + tau2), 0);
  // Show a separate FE weight column only for RE models (MH/Peto already uses FE weights).
  const showFEcol = !m.isMH && !m.isPeto;
  const totalWfe  = showFEcol ? real.reduce((s, d) => s + 1 / d.vi, 0) : 0;

  // SE column header: label the scale when yi is stored on a transformed scale.
  const seLabel = profile.isTransformedScale ? "SE (transformed)" : "SE";

  // Build one row object per study
  const rows = studies.map(d => {
    const wi    = 1 / (d.vi + tau2);
    const pct   = d.filled ? null : wi / totalW * 100;
    const pctFE = (showFEcol && !d.filled) ? (1 / d.vi) / totalWfe * 100 : null;
    const ef    = profile.transform(d.yi);
    const lo    = profile.transform(d.yi - Z_95 * d.se);
    const hi    = profile.transform(d.yi + Z_95 * d.se);
    return { label: escapeHTML(d.label), ef, lo, hi, se: d.se, pct, pctFE, filled: !!d.filled };
  });

  // Pooled row values — use FE for MH/Peto (RE is NaN)
  const pooledEf = profile.transform(isFinite(m.RE) ? m.RE : m.FE);
  const pooledLo = profile.transform(m.ciLow);
  const pooledHi = profile.transform(m.ciHigh);

  function fmtVal(v) { return isFinite(v) ? v.toFixed(3) : "NA"; }
  function fmtPct(v) { return v !== null && isFinite(v) ? v.toFixed(1) + "%" : "\u2014"; }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; }

  // Resolve the effect type key by object identity for the help button.
  const effectTypeKey = Object.keys(effectProfiles).find(k => effectProfiles[k] === profile) ?? "";
  const effectHelpBtn = effectTypeKey ? hBtn("effect." + effectTypeKey) : "";

  const weightLabel = (m.isMH || m.isPeto) ? "FE Weight" : `RE Weight ${hBtn("het.tau2")}`;
  const headerRow = `
    <tr>
      <th>Study</th>
      <th>Effect ${effectHelpBtn}</th>
      <th>${getCiLabel()} (low)</th>
      <th>${getCiLabel()} (high)</th>
      <th>${seLabel}</th>
      <th>${weightLabel}</th>
      ${showFEcol ? "<th>FE Weight</th>" : ""}
    </tr>`;

  const studyRows = rows.map(r => `
    <tr class="${r.filled ? "imputed-row" : ""}">
      <td>${truncate(r.label, 40)}</td>
      <td>${fmtVal(r.ef)}</td>
      <td>${fmtVal(r.lo)}</td>
      <td>${fmtVal(r.hi)}</td>
      <td>${fmtVal(r.se)}</td>
      <td>${fmtPct(r.pct)}</td>
      ${showFEcol ? `<td>${fmtPct(r.pctFE)}</td>` : ""}
    </tr>`).join("");

  const pooledLabel = m.isMH ? "Pooled (MH)" : m.isPeto ? "Pooled (Peto)" : "Pooled (RE)";
  const pooledSE    = isFinite(m.seRE) ? m.seRE : m.seFE;
  const pooledRow = `
    <tr class="pooled-row">
      <td>${pooledLabel}</td>
      <td>${fmtVal(pooledEf)}</td>
      <td>${fmtVal(pooledLo)}</td>
      <td>${fmtVal(pooledHi)}</td>
      <td>${fmtVal(pooledSE)}</td>
      <td>100%</td>
      ${showFEcol ? "<td>100%</td>" : ""}
    </tr>`;

  container.innerHTML = `<table class="study-table">${headerRow}${studyRows}${pooledRow}</table>`;
}

// ---------------- P-CURVE PANEL ----------------
export function renderPCurvePanel(pcurve) {
  const panel     = document.getElementById("pCurvePanel");
  const plotBlock = document.getElementById("pCurvePlotBlock");
  if (!panel || !plotBlock) return;

  const hasData = pcurve && pcurve.k > 0;
  plotBlock.style.display = hasData ? "" : "none";

  if (!hasData) {
    panel.innerHTML = "";
    return;
  }

  function fmtZ(z) { return isFinite(z) ? z.toFixed(3) : "—"; }
  function fmtP(p) { return fmtPval(p); }

  const verdictLabels = {
    "evidential":     "Evidential value",
    "no-evidential":  "No evidential value",
    "inconclusive":   "Inconclusive",
    "insufficient":   "Insufficient data",
  };

  panel.innerHTML = `
    <div class="pcurve-summary">
      <span>P-curve &nbsp;·&nbsp; <strong>${pcurve.k}</strong> significant result${pcurve.k !== 1 ? "s" : ""} (p &lt; .05)</span>
      <span>Right-skew test: <em>Z</em> = <strong>${fmtZ(pcurve.rightSkewZ)}</strong>, <em>p</em> <strong>${fmtP(pcurve.rightSkewP)}</strong></span>
      <span>Flatness test: <em>Z</em> = <strong>${fmtZ(pcurve.flatnessZ)}</strong>, <em>p</em> <strong>${fmtP(pcurve.flatnessP)}</strong></span>
      <span class="status-pill ${pcurve.verdict}">${verdictLabels[pcurve.verdict] ?? pcurve.verdict}</span>
    </div>`;

  drawPCurve(pcurve);
}

// ---------------- P-UNIFORM PANEL ----------------
export function renderPUniformPanel(puniform, m, profile) {
  const panel     = document.getElementById("pUniformPanel");
  const plotBlock = document.getElementById("pUniformPlotBlock");
  if (!panel || !plotBlock) return;

  const hasData = puniform && puniform.k > 0 && isFinite(puniform.estimate);
  plotBlock.style.display = hasData ? "" : "none";

  if (!hasData) {
    panel.innerHTML = "";
    return;
  }

  function fmtZ(z) { return isFinite(z) ? z.toFixed(3) : "—"; }
  function fmtP(p) { return fmtPval(p); }
  function fmtEst(v) { return isFinite(v) ? fmt(profile.transform(v)) : "—"; }

  const est = fmtEst(puniform.estimate);
  const lo  = fmtEst(puniform.ciLow);
  const hi  = fmtEst(puniform.ciHigh);

  const flags = [];
  if (puniform.k < 3) {
    flags.push(`<span class="status-pill insufficient">Insufficient data (k &lt; 3)</span>`);
  } else {
    if (puniform.significantEffect) flags.push(`<span class="status-pill significant">Significant effect</span>`);
    if (puniform.biasDetected)      flags.push(`<span class="status-pill biased">Bias detected</span>`);
  }

  panel.innerHTML = `
    <div class="puniform-summary">
      <span>P-uniform &nbsp;·&nbsp; <strong>${puniform.k}</strong> significant result${puniform.k !== 1 ? "s" : ""} (p &lt; .05)</span>
      <span>Estimate: <strong>${est}</strong> [${lo}, ${hi}]</span>
      <span>Significance test: <em>Z</em> = <strong>${fmtZ(puniform.Z_sig)}</strong>, <em>p</em> <strong>${fmtP(puniform.p_sig)}</strong></span>
      <span>Bias test: <em>Z</em> = <strong>${fmtZ(puniform.Z_bias)}</strong>, <em>p</em> <strong>${fmtP(puniform.p_bias)}</strong></span>
      ${flags.join(" ")}
    </div>`;

  drawPUniform(puniform, m, profile);
}

// ---------------- SELECTION MODEL PANEL ----------------
export function renderSelectionModelPanel(r, mode, weightFn, profile) {
  const panel = document.getElementById("selectionModelPanel");
  if (!panel) return;

  function fmtV(v) { return isFinite(v) ? fmt(v) : "—"; }
  function fmtP(p) { return fmtPval(p); }
  function fmtDisp(v) { return isFinite(v) ? fmt(profile.transform(v)) : "—"; }

  // Not run (meta-regression active)
  if (r === null) {
    panel.innerHTML = `${hBtn("sel.model")}<p class="sel-note">Selection model not available when meta-regression is active.</p>`;
    return;
  }

  // Insufficient k (both step-function and continuous models)
  if (r.error === "insufficient_k") {
    const need = r.minK ?? r.K + 2;
    panel.innerHTML = `${hBtn("sel.model")}<p class="sel-note">Insufficient studies: need at least ${need} (have ${r.k}).</p>`;
    return;
  }

  // ── Half-normal (and future continuous models) branch ──
  if (r.weightFn === "halfnorm") {
    const muAdj  = fmtDisp(r.mu);
    const ciLo   = fmtDisp(r.ci_mu[0]);
    const ciHi   = fmtDisp(r.ci_mu[1]);
    const muUnadj = fmtDisp(r.RE_unsel);
    const convNote = !r.converged
      ? `<p class="sel-warn">⚠ Optimizer did not fully converge. Results may be unreliable.</p>`
      : "";
    const tau2Warn = (r.tau2_unsel !== undefined && r.tau2_unsel < 0.01)
      ? `<p class="sel-note">Note: Heterogeneity near zero (τ² ≈ 0). Selection model may be underidentified.</p>`
      : "";
    const sidesLabel = r.sides === 2 ? "two-sided" : "one-sided";
    panel.innerHTML = `
      ${hBtn("sel.halfnorm")}${tau2Warn}
      <p class="sel-note">Half-normal weight function · w(p; δ) = Φ(Φ⁻¹(1−p) · δ) · ${sidesLabel} p-values</p>
      <table class="sel-table">
        <thead><tr><th>Quantity</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Selection parameter δ̂</td>
              <td>${fmtV(r.delta)}${isFinite(r.se_delta) ? ` ± ${fmtV(r.se_delta)}` : ""}</td></tr>
          <tr><td>Adjusted μ̂ [95% CI]</td>
              <td>${muAdj} [${ciLo}, ${ciHi}] &nbsp;·&nbsp; unadjusted: ${muUnadj}</td></tr>
          <tr><td>Adjusted τ²</td>
              <td>${fmtV(r.tau2)} &nbsp;·&nbsp; unadjusted: ${fmtV(r.tau2_unsel)}</td></tr>
          <tr><td>LRT (H₀: δ = 0)</td>
              <td>χ²(1) = ${fmtV(r.LRT)}, <em>p</em> ${fmtP(r.LRTp)}</td></tr>
          <tr><td>Log-likelihood</td>
              <td>sel: ${fmtV(r.logLikSel)} · unsel: ${fmtV(r.logLikUnsel)}<span class="sel-note"> (ML; omits normalising constants)</span></td></tr>
        </tbody>
      </table>
      ${convNote}`;
    return;
  }

  // ── Power branch ──
  if (r.weightFn === "power") {
    const muAdj  = fmtDisp(r.mu);
    const ciLo   = fmtDisp(r.ci_mu[0]);
    const ciHi   = fmtDisp(r.ci_mu[1]);
    const muUnadj = fmtDisp(r.RE_unsel);
    const convNote = !r.converged
      ? `<p class="sel-warn">⚠ Optimizer did not fully converge. Results may be unreliable.</p>`
      : "";
    const tau2Warn = (r.tau2_unsel !== undefined && r.tau2_unsel < 0.01)
      ? `<p class="sel-note">Note: Heterogeneity near zero (τ² ≈ 0). Selection model may be underidentified.</p>`
      : "";
    const sidesLabel = r.sides === 2 ? "two-sided" : "one-sided";
    panel.innerHTML = `
      ${hBtn("sel.power")}${tau2Warn}
      <p class="sel-note">Power weight function · w(p; δ) = (1 − p)<sup>δ</sup> · ${sidesLabel} p-values</p>
      <table class="sel-table">
        <thead><tr><th>Quantity</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Selection parameter δ̂</td>
              <td>${fmtV(r.delta)}${isFinite(r.se_delta) ? ` ± ${fmtV(r.se_delta)}` : ""}</td></tr>
          <tr><td>Adjusted μ̂ [95% CI]</td>
              <td>${muAdj} [${ciLo}, ${ciHi}] &nbsp;·&nbsp; unadjusted: ${muUnadj}</td></tr>
          <tr><td>Adjusted τ²</td>
              <td>${fmtV(r.tau2)} &nbsp;·&nbsp; unadjusted: ${fmtV(r.tau2_unsel)}</td></tr>
          <tr><td>LRT (H₀: δ = 0)</td>
              <td>χ²(1) = ${fmtV(r.LRT)}, <em>p</em> ${fmtP(r.LRTp)}</td></tr>
          <tr><td>Log-likelihood</td>
              <td>sel: ${fmtV(r.logLikSel)} · unsel: ${fmtV(r.logLikUnsel)}<span class="sel-note"> (ML; omits normalising constants)</span></td></tr>
        </tbody>
      </table>
      ${convNote}`;
    return;
  }

  // ── Negative exponential branch ──
  if (r.weightFn === "negexp") {
    const muAdj  = fmtDisp(r.mu);
    const ciLo   = fmtDisp(r.ci_mu[0]);
    const ciHi   = fmtDisp(r.ci_mu[1]);
    const muUnadj = fmtDisp(r.RE_unsel);
    const convNote = !r.converged
      ? `<p class="sel-warn">⚠ Optimizer did not fully converge. Results may be unreliable.</p>`
      : "";
    const tau2Warn = (r.tau2_unsel !== undefined && r.tau2_unsel < 0.01)
      ? `<p class="sel-note">Note: Heterogeneity near zero (τ² ≈ 0). Selection model may be underidentified.</p>`
      : "";
    const sidesLabel = r.sides === 2 ? "two-sided" : "one-sided";
    panel.innerHTML = `
      ${hBtn("sel.negexp")}${tau2Warn}
      <p class="sel-note">Negative exponential weight function · w(p; δ) = e<sup>−δp</sup> · ${sidesLabel} p-values</p>
      <table class="sel-table">
        <thead><tr><th>Quantity</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Selection parameter δ̂</td>
              <td>${fmtV(r.delta)}${isFinite(r.se_delta) ? ` ± ${fmtV(r.se_delta)}` : ""}</td></tr>
          <tr><td>Adjusted μ̂ [95% CI]</td>
              <td>${muAdj} [${ciLo}, ${ciHi}] &nbsp;·&nbsp; unadjusted: ${muUnadj}</td></tr>
          <tr><td>Adjusted τ²</td>
              <td>${fmtV(r.tau2)} &nbsp;·&nbsp; unadjusted: ${fmtV(r.tau2_unsel)}</td></tr>
          <tr><td>LRT (H₀: δ = 0)</td>
              <td>χ²(1) = ${fmtV(r.LRT)}, <em>p</em> ${fmtP(r.LRTp)}</td></tr>
          <tr><td>Log-likelihood</td>
              <td>sel: ${fmtV(r.logLikSel)} · unsel: ${fmtV(r.logLikUnsel)}<span class="sel-note"> (ML; omits normalising constants)</span></td></tr>
        </tbody>
      </table>
      ${convNote}`;
    return;
  }

  // ── Beta branch ──
  if (r.weightFn === "beta") {
    const muAdj   = fmtDisp(r.mu);
    const ciLo    = fmtDisp(r.ci_mu[0]);
    const ciHi    = fmtDisp(r.ci_mu[1]);
    const muUnadj = fmtDisp(r.RE_unsel);
    const convNote = !r.converged
      ? `<p class="sel-warn">⚠ Optimizer did not fully converge. Results may be unreliable.</p>`
      : "";
    const tau2Warn = (r.tau2_unsel !== undefined && r.tau2_unsel < 0.01)
      ? `<p class="sel-note">Note: Heterogeneity near zero (τ² ≈ 0). Selection model may be underidentified.</p>`
      : "";
    const sidesLabel = r.sides === 2 ? "two-sided" : "one-sided";
    panel.innerHTML = `
      ${hBtn("sel.beta")}${tau2Warn}
      <p class="sel-note">Beta weight function · w(p; a, b) = p<sup>a−1</sup>(1−p)<sup>b−1</sup> · ${sidesLabel} p-values</p>
      <table class="sel-table">
        <thead><tr><th>Quantity</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Shape â</td>
              <td>${fmtV(r.a)}${isFinite(r.se_a) ? ` ± ${fmtV(r.se_a)}` : ""}</td></tr>
          <tr><td>Shape b̂</td>
              <td>${fmtV(r.b)}${isFinite(r.se_b) ? ` ± ${fmtV(r.se_b)}` : ""}</td></tr>
          <tr><td>Adjusted μ̂ [95% CI]</td>
              <td>${muAdj} [${ciLo}, ${ciHi}] &nbsp;·&nbsp; unadjusted: ${muUnadj}</td></tr>
          <tr><td>Adjusted τ²</td>
              <td>${fmtV(r.tau2)} &nbsp;·&nbsp; unadjusted: ${fmtV(r.tau2_unsel)}</td></tr>
          <tr><td>LRT (H₀: a = b = 1)</td>
              <td>χ²(2) = ${fmtV(r.LRT)}, <em>p</em> ${fmtP(r.LRTp)}</td></tr>
          <tr><td>Log-likelihood</td>
              <td>sel: ${fmtV(r.logLikSel)} · unsel: ${fmtV(r.logLikUnsel)}<span class="sel-note"> (ML; omits normalising constants)</span></td></tr>
        </tbody>
      </table>
      ${convNote}`;
    return;
  }

  const K    = r.K;
  const isMLE = mode === "mle";

  // Warn if any interval is empty
  const emptyIntervals = r.nPerInterval
    .map((n, j) => n === 0 ? j : -1)
    .filter(j => j >= 0);
  const emptyWarn = emptyIntervals.length > 0
    ? `<p class="sel-warn">⚠ Interval${emptyIntervals.length > 1 ? "s" : ""} ${emptyIntervals.map(j => j + 1).join(", ")} ha${emptyIntervals.length > 1 ? "ve" : "s"} 0 studies — weight fixed at ω = 1${isMLE ? " and excluded from optimisation" : ""}.</p>`
    : "";

  // Build cutpoint labels for column headers: (0, c₁], (c₁, c₂], …
  const cuts = r.cuts;
  const intervalLabels = cuts.map((c, j) => {
    const lo = j === 0 ? "0" : cuts[j - 1];
    return `(${lo},&nbsp;${c}]`;
  });

  // ---- ω rows ----
  const omegaCells = r.omega.map((w, j) => {
    const se  = isMLE && j > 0 && isFinite(r.se_omega[j]) ? ` ± ${fmtV(r.se_omega[j])}` : "";
    const fix = !isMLE || j === 0 ? " (fixed)" : "";
    return `<td>${fmtV(w)}${se}${fix}</td>`;
  }).join("");

  // ---- Studies per interval ----
  const kCells = r.nPerInterval.map((n, j) => {
    const warn = n === 0 ? ` class="sel-zero"` : "";
    return `<td${warn}>${n}</td>`;
  }).join("");

  // ---- Adjusted vs unadjusted μ ----
  const muAdj   = fmtDisp(r.mu);
  const ciLo    = fmtDisp(r.mu - 1.96 * r.se_mu);
  const ciHi    = fmtDisp(r.mu + 1.96 * r.se_mu);
  const muUnadj = fmtDisp(r.RE_unsel);

  // ---- LRT + LL rows (MLE only) ----
  const lrtRow = isMLE
    ? `<tr><td>LRT (H₀: no selection)</td><td colspan="${K}">χ²(${r.LRTdf}) = ${fmtV(r.LRT)}, <em>p</em> ${fmtP(r.LRTp)}</td></tr>
       <tr><td>Log-likelihood</td><td colspan="${K}">sel: ${fmtV(r.logLikSel)} · unsel: ${fmtV(r.logLikUnsel)}<span class="sel-note"> (ML; omits normalising constants)</span></td></tr>`
    : "";

  // ---- Convergence note (MLE only) ----
  const convNote = isMLE && !r.converged
    ? `<p class="sel-warn">⚠ Optimizer did not fully converge (gradient norm may be elevated). Results may be unreliable.</p>`
    : "";

  // ---- τ² ≈ 0 warning: selection model underidentified when heterogeneity is near zero ----
  const tau2Warn = (r.tau2_unsel !== undefined && r.tau2_unsel < 0.01)
    ? `<p class="sel-note">Note: Heterogeneity is near zero (τ² ≈ 0). The selection model may be underidentified and results unreliable.</p>`
    : "";

  const headerCells = intervalLabels.map(l => `<th>${l}</th>`).join("");

  panel.innerHTML = `
    ${hBtn("sel.model")}${emptyWarn}
    ${tau2Warn}
    <table class="sel-table">
      <thead>
        <tr>
          <th>Quantity</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Selection weight ω</td>
          ${omegaCells}
        </tr>
        <tr>
          <td>Studies per interval k</td>
          ${kCells}
        </tr>
        <tr>
          <td>Adjusted μ̂</td>
          <td colspan="${K}">${muAdj} [${ciLo}, ${ciHi}] &nbsp;·&nbsp; unadjusted: ${muUnadj}</td>
        </tr>
        <tr>
          <td>Adjusted τ²</td>
          <td colspan="${K}">${fmtV(r.tau2)} &nbsp;·&nbsp; unadjusted: ${fmtV(r.tau2_unsel)}</td>
        </tr>
        ${lrtRow}
      </tbody>
    </table>
    ${convNote}`;
}

export function buildInfluenceHTML(influence) {
  const k    = influence.length;
  const dffitsThresh   = 3 * Math.sqrt(1 / Math.max(k - 1, 1));
  const covRatioThresh = 1 + 1 / k;
  const rows = influence.map(d => {
    const anyFlag  = d.outlier || d.influential || d.highLeverage || d.highCookD || d.highDffits || d.highCovRatio;
    const rowStyle = anyFlag ? "class='results-row-flagged'" : "";
    const hatStyle      = d.highLeverage  ? " style='color:var(--color-warning);font-weight:bold;'" : "";
    const cookStyle     = d.highCookD     ? " style='color:var(--color-warning);font-weight:bold;'" : "";
    const dffitsStyle   = d.highDffits    ? " style='color:var(--color-warning);font-weight:bold;'" : "";
    const covRatioStyle = d.highCovRatio  ? " style='color:var(--color-warning);font-weight:bold;'" : "";
    const flags = [
      d.outlier      ? "Outlier"      : "",
      d.influential  ? "Influential"  : "",
      d.highLeverage ? "Hi-Lev"       : "",
      d.highCookD    ? "Hi-Cook"      : "",
      d.highDffits   ? "Hi-DFFITS"    : "",
      d.highCovRatio ? "Hi-CovRatio"  : "",
    ].filter(Boolean).join(", ");
    return `<tr ${rowStyle}>
      <td>${escapeHTML(d.label)}</td>
      <td>${isFinite(d.RE_loo)      ? fmt(d.RE_loo)      : "NA"}</td>
      <td>${isFinite(d.deltaTau2)   ? fmt(d.deltaTau2)   : "NA"}</td>
      <td>${isFinite(d.stdResidual) ? fmt(d.stdResidual) : "NA"}</td>
      <td>${isFinite(d.DFBETA)      ? fmt(d.DFBETA)      : "NA"}</td>
      <td${dffitsStyle}>${isFinite(d.DFFITS)     ? fmt(d.DFFITS)         : "NA"}</td>
      <td${covRatioStyle}>${isFinite(d.covRatio) ? d.covRatio.toFixed(3) : "NA"}</td>
      <td${hatStyle}>${isFinite(d.hat)   ? d.hat.toFixed(3)   : "NA"}</td>
      <td${cookStyle}>${isFinite(d.cookD) ? d.cookD.toFixed(3) : "NA"}</td>
      <td>${flags}</td></tr>`;
  }).join("");
  return `<b>Influence diagnostics:${hBtn("diag.influence")}</b><br>
    <table border="1">
      <tr><th>Study</th><th>RE (LOO)</th><th>Δτ²</th><th>Std Residual</th><th>DFBETA</th><th>DFFITS${hBtn("diag.dffits")}</th><th>CovRatio${hBtn("diag.covratio")}</th><th>Hat</th><th>Cook's D</th><th>Flag</th></tr>
      ${rows}
    </table>
    <small style="color:var(--fg-muted);">Thresholds: Hat &gt; ${fmt(2/k)} (= 2/k); Cook's D &gt; ${fmt(4/k)} (= 4/k); DFFITS &gt; ${fmt(dffitsThresh)} (= 3·√(1/(k−1))); CovRatio &gt; ${fmt(covRatioThresh)} (= 1+1/k)</small>`;
}

// Jeffreys (1961) interpretation scale for BF₁₀
export function bayesInterpretation(BF10) {
  if (!isFinite(BF10) || BF10 <= 0) return "";
  const bf = BF10 >= 1 ? BF10 : 1 / BF10;
  const dir = BF10 >= 1 ? "H\u2081" : "H\u2080";
  let label;
  if      (bf > 100) label = "Decisive";
  else if (bf > 30)  label = "Very strong";
  else if (bf > 10)  label = "Strong";
  else if (bf > 3)   label = "Moderate";
  else if (bf > 1)   label = "Anecdotal";
  else               label = "No evidence";
  return `${label} for ${dir}`;
}

export function buildBayesSummaryHTML(result, profile, reMean) {
  const muDisp   = profile.transform(result.muMean);
  const muCIDisp = result.muCI.map(v => profile.transform(v));
  const muSDNote = profile.isTransformedScale ? " (log)" : "";
  const crLabel  = getCiLabel().replace("CI", "CrI");
  const fmtBF    = bf => !isFinite(bf) ? "NA" : bf >= 1000 || bf < 0.001 ? bf.toExponential(2) : bf.toFixed(3);
  return `
    <table class="stats-table" style="margin-bottom:8px">
      <tr>
        <td>Posterior mean μ</td>
        <td>${fmt(muDisp)}</td>
        <td>${crLabel} [${fmt(muCIDisp[0])}, ${fmt(muCIDisp[1])}] · SD${muSDNote} = ${fmt(result.muSD)}</td>
      </tr>
      <tr>
        <td>Posterior mean τ</td>
        <td>${fmt(result.tauMean)}</td>
        <td>${crLabel} [${fmt(result.tauCI[0])}, ${fmt(result.tauCI[1])}] · SD = ${fmt(result.tauSD)}</td>
      </tr>
      ${isFinite(reMean) ? `<tr>
        <td>Frequentist RE (comparison)</td>
        <td>${fmt(profile.transform(reMean))}</td>
        <td></td>
      </tr>` : ""}
      ${isFinite(result.BF10) ? `<tr>
        <td>Bayes Factor BF\u2081\u2080 (H\u2081: \u03BC\u22600)</td>
        <td>${fmtBF(result.BF10)}</td>
        <td>${bayesInterpretation(result.BF10)}</td>
      </tr>
      ${result.BF10 < 1 && isFinite(result.BF01) ? `<tr>
        <td>BF\u2080\u2081 = 1/BF\u2081\u2080 (H\u2080: \u03BC\u202F=\u202F0)</td>
        <td>${fmtBF(result.BF01)}</td>
        <td>${bayesInterpretation(result.BF10)}</td>
      </tr>` : ""}
      <tr>
        <td>log(BF\u2081\u2080)</td>
        <td>${result.logBF10.toFixed(3)}</td>
        <td></td>
      </tr>` : ""}
    </table>
    <p style="font-size:0.82em;color:var(--fg-muted);margin:0 0 8px">
      Prior: μ\u202F~\u202FN(${result.mu0},\u202F${result.sigma_mu}\u00B2)\u2003
      τ\u202F~\u202FHalfNormal(${result.sigma_tau}).
      Posterior via 1-D grid over τ (${result.k} studies).
    </p>`;
}

export function buildSensitivityHTML(rows, profile, ciLevel, currentSigmaMu, currentSigmaTau) {
  const crLabel = (ciLevel ?? "95") + "% CrI";
  const header = `<tr>
    <th>σ_μ</th><th>σ_τ</th><th>Post. μ</th><th>${crLabel}</th><th>BF₁₀</th>
  </tr>`;
  const dataRows = rows.map(row => {
    const isCurrent = row.sigma_mu === currentSigmaMu && row.sigma_tau === currentSigmaTau;
    const muDisp   = profile.transform(row.muMean);
    const muCIDisp = row.muCI.map(v => profile.transform(v));
    const bf = row.BF10;
    const bfStr = !isFinite(bf) ? "NA"
      : bf >= 1000 ? bf.toExponential(2)
      : bf < 0.001 ? bf.toExponential(2)
      : bf.toFixed(3);
    const style = isCurrent ? " style=\"font-weight:bold;background:var(--accent-subtle)\"" : "";
    return `<tr${style}>
      <td>${row.sigma_mu}</td>
      <td>${row.sigma_tau}</td>
      <td>${isFinite(muDisp) ? fmt(muDisp) : "NA"}</td>
      <td>[${isFinite(muCIDisp[0]) ? fmt(muCIDisp[0]) : "NA"}, ${isFinite(muCIDisp[1]) ? fmt(muCIDisp[1]) : "NA"}]</td>
      <td>${bfStr}</td>
    </tr>`;
  }).join("");
  return `<b>Prior sensitivity analysis${hBtn("bayes.sensitivity")}</b>
  <table border="1" style="margin:4px 0 8px">${header}${dataRows}</table>
  <p style="font-size:0.82em;color:var(--fg-muted);margin:0 0 8px">
    Grid: σ_μ ∈ {0.5, 1, 2}, σ_τ ∈ {0.25, 0.5, 1}. <strong>Bold row</strong> = current prior.
    Diffuse priors (large σ_μ, σ_τ) approach the frequentist RE estimate.
  </p>`;
}

export function buildSubgroupHTML(subgroup, profile, hasClusters) {
  const noGroupWarn = subgroup.kNoGroup > 0
    ? `<div class="reg-note reg-warn">⚠ ${subgroup.kNoGroup} ${subgroup.kNoGroup === 1 ? "study" : "studies"} excluded from subgroup analysis (no group label assigned).</div>`
    : "";
  const clusterNote = hasClusters
    ? `<div class="reg-note" style="color:var(--muted);margin:2px 0 6px">ℹ Cluster-robust SE is not applied within subgroups.</div>`
    : "";
  const rows = Object.entries(subgroup.groups).map(([g, r]) => {
    const isSingle = r.k === 1;
    const y_disp   = profile.transform(r.y);
    const ci_disp  = { lb: profile.transform(r.ci.lb), ub: profile.transform(r.ci.ub) };
    return `<tr>
      <td>${escapeHTML(g)}</td>
      <td>${r.k}</td>
      <td>${isFinite(y_disp) ? fmt(y_disp) : "NA"}</td>
      <td>${isSingle ? "NA" : isFinite(r.se)   ? fmt(r.se)         : "NA"}</td>
      <td>[${isSingle ? "NA" : fmt(ci_disp.lb)}, ${isSingle ? "NA" : fmt(ci_disp.ub)}]</td>
      <td>${isSingle ? "NA" : isFinite(r.tau2) ? r.tau2.toFixed(3) : "0"}</td>
      <td>${isSingle ? "NA" : isFinite(r.I2)   ? r.I2.toFixed(1)   : "0"}</td>
    </tr>`;
  }).join("");
  return `${clusterNote}${noGroupWarn}<b>Subgroup analysis:${hBtn("diag.subgroup")}</b><br>
    <table border="1">
      <tr><th>Group</th><th>k</th><th>Effect</th><th>SE</th><th>CI</th><th>τ²</th><th>I² (%)</th></tr>
      ${rows}
      <tr>
        <td colspan="7" style="font-size:0.92em;color:var(--muted)">
          <em>Q</em><sub>total</sub>(${subgroup.k - 1}) = ${subgroup.Qtotal.toFixed(3)}
          &ensp;·&ensp;
          <em>Q</em><sub>within</sub>(${subgroup.k - subgroup.G}) = ${subgroup.Qwithin.toFixed(3)}
        </td>
      </tr>
      <tr style="font-weight:bold;">
        <td colspan="7"><em>Q</em><sub>between</sub>(${subgroup.df}) = ${subgroup.Qbetween.toFixed(3)}, <em>p</em> ${fmtPval(subgroup.p)}</td>
      </tr>
    </table>`;
}

// -----------------------------------------------------------------------------
// renderGoshInfo(result, profile)
// -----------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// renderPermResults — render permutation test p-values into #permResults.
// ---------------------------------------------------------------------------
export function renderPermResults(permResult, reg) {
  const el = document.getElementById("permResults");
  if (!el) return;

  const { QM_dist, modQM_dist, nPerm, nMods } = permResult;

  function permPval(dist, observed) {
    if (!isFinite(observed)) return NaN;
    let exceeds = 0;
    for (let i = 0; i < dist.length; i++) { if (dist[i] >= observed) exceeds++; }
    return (1 + exceeds) / (dist.length + 1);
  }
  function fmtP(p) {
    if (!isFinite(p)) return "NA";
    if (p < 0.001) return "< .001";
    return p.toFixed(3).replace(/^0\./, ".");
  }

  const omniP   = permPval(QM_dist, reg.QM);
  const omniLabel = reg.QMdist === "F"
    ? `F(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;

  let modRows = "";
  if (nMods > 0 && Array.isArray(reg.modTests)) {
    modRows = reg.modTests.map((mt, mi) => {
      if (mt.QMdf === 0 || !mt.colIdxs || mt.colIdxs.length === 0)
        return `<tr><td>${escapeHTML(mt.name)}</td><td colspan="2"><i>degenerate</i></td></tr>`;
      const modDist = modQM_dist.subarray(mi, nPerm * nMods + mi).filter((_, idx) => idx % nMods === 0);
      // Extract column mi from the nPerm×nMods matrix
      const colDist = new Float64Array(nPerm);
      for (let r = 0; r < nPerm; r++) colDist[r] = modQM_dist[r * nMods + mi];
      const mp = permPval(colDist, mt.QM);
      const dfLabel = reg.QMdist === "F"
        ? `F(${mt.QMdf}, ${reg.QEdf})`
        : `χ²(${mt.QMdf})`;
      return `<tr>
        <td>${escapeHTML(mt.name)}</td>
        <td>${fmt(mt.QM)} (${dfLabel})</td>
        <td><strong>${fmtP(mp)}</strong></td>
      </tr>`;
    }).join("");
  }

  const modTable = nMods > 1 && modRows
    ? `<details style="margin-top:6px">
        <summary style="cursor:pointer;color:var(--fg-muted)">Per-moderator permutation <em>p</em>-values</summary>
        <table class="reg-table" style="margin-top:4px">
          <thead><tr><th>Moderator</th><th><em>Q</em>M (${reg.QMdist ?? "χ²"})</th><th>Perm <em>p</em></th></tr></thead>
          <tbody>${modRows}</tbody>
        </table>
      </details>`
    : "";

  el.innerHTML = `
    <div class="perm-results-block">
      <strong>Permutation <em>Q</em>M ${omniLabel} = ${fmt(reg.QM)}</strong>
      &nbsp;&mdash;&nbsp;
      permutation <em>p</em> = <strong>${fmtP(omniP)}</strong>
      <span class="reg-note" style="display:inline;margin-left:8px">(${nPerm} permutations, τ² re-estimated per permutation)</span>
    </div>
    ${modTable}`;
}

export function renderGoshInfo(result, profile) {
  const el = document.getElementById("goshInfo");
  if (!el) return;
  const { count, k, sampled } = result;
  const sampleNote = sampled
    ? ` (random sample of ${count.toLocaleString()} of ${(Math.pow(2, k) - 1).toLocaleString()} possible subsets)`
    : ` (all ${count.toLocaleString()} non-empty subsets)`;
  el.innerHTML = `<p class="gosh-info">GOSH plot: ${k} studies, fixed-effects model${sampleNote}.</p>`;
}

