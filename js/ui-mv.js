// =============================================================================
// ui-mv.js — Multivariate meta-analysis UI module
// =============================================================================
// All state, table management, analysis runner, forest plots, and report builder
// for the Multivariate mode. Extracted from ui.js (R6 refactor).
//
// Public API (all exported):
//   mvState           — { active: bool } — shared with ui.js
//   mvModerators      — string[] — mutated in place by applySession
//   mvForestState     — forest plot pagination/display state
//   initMV(deps)      — call once from init(); wires event listeners
//   gatherMVState()   — returns serialisable MV session object
//   runMVAnalysis()   — runs the MV pipeline; returns bool
//   populateMVExample()
//   commitImportMV(parsed, mvHeaders)
//   redrawAllMVForestPlots()
//   renderMVModTags()
//   rebuildMVTableHeaders()
//   addMVRow() → <tr>
//   buildMVReportHTML(res, rows, alpha, { reportCSS, buildTableAPA, buildFigureAPA })
//   mvDownloadHTML(html)
//   mvOpenPrintPreview(html)
// =============================================================================

import { vcalc, mvMeta } from "./multivariate.js";
import { normalQuantile, tCritical } from "./utils.js";
import { fmt } from "./format.js";
import { escapeHTML } from "./utils-html.js";
import { renderWarningBlocks, msgExcluded, msgNonNumericMod, analysisChecks } from "./ui-warnings.js";
import { cellRich, mvPooledData, mvHeterogeneityData, mvTestsData, mvModeratorData, mvFitLine, mvStudyData } from "./sections.js";
import { PLOT_THEMES } from "./plotThemes.js";
import { resolveThemeVars, hasEmbeddedBackground, currentBgColour } from "./export.js";
import { downloadBlob } from "./io.js";
import {
  commitPendingDelete, registerDeleteCompanion,
  showUndoToast, hideUndoToast,
} from "./ui-table.js";

// ── Injected deps (set by initMV) ─────────────────────────────────────────────
let _appState, _robPlotState, _markStale, _getCiAlpha, _onRunSuccess;

// ── Shared state (exported — mutated in place by ui.js / applySession) ────────
export const mvState = { active: false };
export const mvModerators = [];  // array of moderator name strings
export const mvForestState = {
  pageSize:     20,
  pages:        [],    // current page index per outcome (separate mode)
  combinedPage: 0,
  showPI:       false,
  lastRes:      null,
  lastRows:     [],
  alpha:        0.05,
  ciMethod:     "normal",
  viewMode:     "separate",  // "separate" | "combined"
};

// ── initMV(deps) ──────────────────────────────────────────────────────────────
// Must be called once from init() before any table or session operations.
// deps: { appState, robPlotState, markStale, getCiAlpha, onRunSuccess }
export function initMV(deps) {
  _appState     = deps.appState;
  _robPlotState = deps.robPlotState;
  _markStale    = deps.markStale;
  _getCiAlpha   = deps.getCiAlpha;
  _onRunSuccess = deps.onRunSuccess;

  registerDeleteCompanion(_mvCommitPendingDelete);

  // MV-specific event listeners
  document.getElementById("mvAddRow").addEventListener("click", () => { addMVRow(); _markStale(); });
  document.getElementById("mvTableBody").addEventListener("keydown", e => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const row = e.target.closest("tr");
    if (!row || !row.draggable) return;
    e.preventDefault();
    if (e.key === "ArrowUp") {
      const prev = row.previousElementSibling;
      if (prev && prev.draggable) row.parentNode.insertBefore(row, prev);
    } else {
      const next = row.nextElementSibling;
      if (next && next.draggable) row.parentNode.insertBefore(next, row);
    }
    _markStale();
  });
  document.getElementById("mvStruct").addEventListener("change", _updateMVValidationWarnings);
  document.getElementById("mvAddMod").addEventListener("click", _mvAddMod);
  document.getElementById("mvModName").addEventListener("keydown", e => { if (e.key === "Enter") _mvAddMod(); });
  document.getElementById("mvForestPageSize").addEventListener("change", e => {
    const raw = e.target.value;
    mvForestState.pageSize     = raw === "all" ? Infinity : +raw;
    mvForestState.pages        = mvForestState.pages.map(() => 0);
    mvForestState.combinedPage = 0;
    redrawAllMVForestPlots();
  });
  document.getElementById("mvForestView").addEventListener("change", e => {
    mvForestState.viewMode     = e.target.value;
    mvForestState.combinedPage = 0;
    redrawAllMVForestPlots();
  });
  document.getElementById("mvShowPI").addEventListener("change", e => {
    mvForestState.showPI = e.target.checked;
    redrawAllMVForestPlots();
  });
}

// ── MV moderator management ───────────────────────────────────────────────────

export function renderMVModTags() {
  const container = document.getElementById("mvModTags");
  container.innerHTML = mvModerators.map((name, i) =>
    `<span class="mod-tag">` +
    `<span>${escapeHTML(name)}</span>` +
    `<button data-mod-idx="${i}" title="Remove">×</button>` +
    `</span>`
  ).join("");
  container.querySelectorAll("button[data-mod-idx]").forEach(btn => {
    btn.addEventListener("click", () => _mvRemoveMod(Number(btn.dataset.modIdx)));
  });
}

function _mvRemoveMod(i) {
  mvModerators.splice(i, 1);
  renderMVModTags();
  rebuildMVTableHeaders();
  _markStale();
}

function _mvAddMod() {
  const input = document.getElementById("mvModName");
  const name = input.value.trim();
  if (!name || mvModerators.includes(name)) return;
  mvModerators.push(name);
  input.value = "";
  renderMVModTags();
  rebuildMVTableHeaders();
  _markStale();
}

// ── MV table management ───────────────────────────────────────────────────────

const _mvUndoState = { timer: null, row: null };
const _MV_UNDO_MS  = 5000;

function _mvCommitPendingDelete() {
  if (!_mvUndoState.row) return;
  clearTimeout(_mvUndoState.timer);
  _mvUndoState.row.remove();
  _mvUndoState.row   = null;
  _mvUndoState.timer = null;
  hideUndoToast();
}

function _mvCancelPendingDelete() {
  if (!_mvUndoState.row) return;
  clearTimeout(_mvUndoState.timer);
  _mvUndoState.row.classList.remove("row-pending-delete");
  _mvUndoState.row   = null;
  _mvUndoState.timer = null;
  hideUndoToast();
  _markStale();
}

export function rebuildMVTableHeaders() {
  const tr = document.getElementById("mvTableHead");
  tr.innerHTML = "";

  const fixedCols = [
    ["Study ID",                    "Study label or identifier"],
    ["Outcome ID",                  "Outcome label — groups rows within a study"],
    ["Effect (y<sub>i</sub>)",      "Observed effect size for this study–outcome"],
    ["Variance (v<sub>i</sub>)",    "Variance of the effect size estimate"],
  ];
  fixedCols.forEach(([label, tip]) => {
    const th = document.createElement("th");
    th.innerHTML = label;
    th.title = tip;
    tr.appendChild(th);
  });

  mvModerators.forEach((m, i) => {
    const th = document.createElement("th");
    th.title = `Moderator — ${m}`;
    th.innerHTML = `${escapeHTML(m)} <button class="remove-mod-btn" data-mod-idx="${i}" title="Remove moderator">×</button>`;
    tr.appendChild(th);
  });

  const thActions = document.createElement("th");
  thActions.className = "col-actions";
  thActions.textContent = "Actions";
  thActions.title = "Row controls: clear or delete the study";
  tr.appendChild(thActions);

  tr.querySelectorAll("button[data-mod-idx]").forEach(btn => {
    btn.addEventListener("click", () => _mvRemoveMod(Number(btn.dataset.modIdx)));
  });
  document.querySelectorAll("#mvTableBody tr").forEach(row => {
    _syncMVRowMods(row);
  });
}

function _wireMVInput(tr, inp) {
  inp.addEventListener("input", () => {
    clearTimeout(tr._valTimer);
    tr._valTimer = setTimeout(() => { _validateMVRow(tr); _updateMVValidationWarnings(); _markStale(); }, 150);
  });
}

function _syncMVRowMods(tr) {
  const cells = tr.querySelectorAll("td");
  const fixedCount = 4;
  const currentModCount = cells.length - fixedCount - 1;
  if (currentModCount === mvModerators.length) return;

  const actionsTd = tr.lastElementChild;
  while (tr.querySelectorAll("td").length - 1 > fixedCount + mvModerators.length) {
    const tds = tr.querySelectorAll("td");
    tr.removeChild(tds[tds.length - 2]);
  }
  while (tr.querySelectorAll("td").length - 1 < fixedCount + mvModerators.length) {
    const td = document.createElement("td");
    td.innerHTML = `<input type="text" class="mv-mod-cell" placeholder="0" style="width:90px">`;
    tr.insertBefore(td, actionsTd);
    _wireMVInput(tr, td.querySelector("input"));
  }
}

function _validateMVRow(tr) {
  const yiInput = tr.querySelector(".mv-yi");
  const viInput = tr.querySelector(".mv-vi");
  [yiInput, viInput].forEach(inp => inp?.classList.remove("input-error"));
  tr.querySelectorAll(".mv-mod-cell").forEach(inp => inp.classList.remove("input-error"));
  tr.classList.remove("row-error");

  const allInputs = [...tr.querySelectorAll("input")];
  if (allInputs.every(inp => inp.value.trim() === "")) return true;

  let valid = true;
  const yiVal = yiInput?.value.trim() ?? "";
  const viVal = viInput?.value.trim() ?? "";

  if (yiVal === "" || !isFinite(+yiVal)) {
    yiInput?.classList.add("input-error");
    valid = false;
  }
  const viNum = +viVal;
  if (viVal === "" || !isFinite(viNum) || viNum <= 0) {
    viInput?.classList.add("input-error");
    valid = false;
  }
  tr.classList.toggle("row-error", !valid);

  // MV moderator cells are always numeric — highlight non-numeric values visually.
  // Does not affect row inclusion; invalid mods are excluded from regression only.
  tr.querySelectorAll(".mv-mod-cell").forEach(inp => {
    const val = inp.value.trim();
    if (val !== "" && isNaN(+val)) inp.classList.add("input-error");
  });

  return valid;
}

export function addMVRow() {
  const tbody = document.getElementById("mvTableBody");
  const tr = document.createElement("tr");
  tr.draggable = true;
  const modCells = mvModerators.map(() =>
    `<td><input type="text" class="mv-mod-cell" placeholder="0" style="width:90px"></td>`
  ).join("");
  tr.innerHTML =
    `<td><input type="text" class="mv-study-id"  style="width:90px" placeholder="Study"></td>` +
    `<td><input type="text" class="mv-outcome-id" style="width:80px" placeholder="Outcome"></td>` +
    `<td><input type="text" class="mv-yi" style="width:90px"></td>` +
    `<td><input type="text" class="mv-vi" style="width:90px"></td>` +
    modCells +
    `<td class="col-actions"><button class="remove-btn" aria-label="Remove study">✖</button> <button class="clear-btn" aria-label="Clear row">🧹</button></td>`;
  tr.querySelector(".remove-btn").addEventListener("click", () => {
    commitPendingDelete();
    _mvCommitPendingDelete();
    const label = tr.querySelector(".mv-study-id")?.value.trim() || "";
    tr.classList.add("row-pending-delete");
    _mvUndoState.row   = tr;
    _mvUndoState.timer = setTimeout(_mvCommitPendingDelete, _MV_UNDO_MS);
    showUndoToast(label, _mvCancelPendingDelete);
    _markStale();
  });
  tr.querySelector(".clear-btn").addEventListener("click", () => {
    tr.querySelectorAll("input").forEach(inp => { inp.value = ""; });
    _validateMVRow(tr);
    _markStale();
  });
  tr.querySelectorAll("input").forEach(inp => _wireMVInput(tr, inp));
  tbody.appendChild(tr);
  return tr;
}

function _collectMVRows() {
  const rows = [];
  document.querySelectorAll("#mvTableBody tr").forEach(tr => {
    if (tr.classList.contains("row-pending-delete")) return;
    const study_id   = tr.querySelector(".mv-study-id")?.value.trim();
    const outcome_id = tr.querySelector(".mv-outcome-id")?.value.trim();
    const yiRaw = tr.querySelector(".mv-yi")?.value.trim() ?? "";
    const viRaw = tr.querySelector(".mv-vi")?.value.trim() ?? "";
    const yi = yiRaw === "" ? NaN : +yiRaw;
    const vi = viRaw === "" ? NaN : +viRaw;
    if (!study_id || !outcome_id || !isFinite(yi) || !isFinite(vi) || vi <= 0) return;
    const row = { study_id, outcome_id, yi, vi };
    const modInputs = tr.querySelectorAll(".mv-mod-cell");
    mvModerators.forEach((name, i) => {
      const raw = modInputs[i]?.value.trim() ?? "";
      row[name] = raw === "" ? NaN : +raw;
    });
    rows.push(row);
  });
  return rows;
}

export function gatherMVState() {
  const rows = [];
  document.querySelectorAll("#mvTableBody tr").forEach(tr => {
    if (tr.classList.contains("row-pending-delete")) return;
    const entry = {
      study_id:   tr.querySelector(".mv-study-id")?.value  ?? "",
      outcome_id: tr.querySelector(".mv-outcome-id")?.value ?? "",
      yi: tr.querySelector(".mv-yi")?.value ?? "",
      vi: tr.querySelector(".mv-vi")?.value ?? "",
    };
    mvModerators.forEach((name, i) => {
      const inputs = tr.querySelectorAll(".mv-mod-cell");
      entry[name] = inputs[i]?.value ?? "";
    });
    rows.push(entry);
  });
  return {
    struct:     document.getElementById("mvStruct").value,
    method:     document.getElementById("mvMethod").value,
    ciMethod:   document.getElementById("mvCiMethod").value,
    slopes:     document.getElementById("mvSlopes").value,
    rho:        parseFloat(document.getElementById("mvRho").value),
    moderators: [...mvModerators],
    rows,
  };
}

export function populateMVExample() {
  // Berkey 1998 — 5 trials, 2 dental outcomes (AL and PD)
  const exRows = [
    { study_id: "Pihlstrom", outcome_id: "AL", yi: -0.30, vi: 0.0075 },
    { study_id: "Pihlstrom", outcome_id: "PD", yi: -0.60, vi: 0.0057 },
    { study_id: "Zinney",    outcome_id: "AL", yi:  0.10, vi: 0.0058 },
    { study_id: "Zinney",    outcome_id: "PD", yi: -0.15, vi: 0.0048 },
    { study_id: "Morrison",  outcome_id: "AL", yi:  0.40, vi: 0.0147 },
    { study_id: "Morrison",  outcome_id: "PD", yi: -0.32, vi: 0.0091 },
    { study_id: "Knowles",   outcome_id: "AL", yi:  0.32, vi: 0.0141 },
    { study_id: "Knowles",   outcome_id: "PD", yi: -0.39, vi: 0.0069 },
    { study_id: "Ramfjord",  outcome_id: "AL", yi: -0.29, vi: 0.0091 },
    { study_id: "Ramfjord",  outcome_id: "PD", yi: -0.88, vi: 0.0062 },
  ];
  exRows.forEach(r => {
    const tr = addMVRow();
    tr.querySelector(".mv-study-id").value  = r.study_id;
    tr.querySelector(".mv-outcome-id").value = r.outcome_id;
    tr.querySelector(".mv-yi").value = r.yi;
    tr.querySelector(".mv-vi").value = r.vi;
  });
}

export function commitImportMV(parsed, mvHeaders) {
  const { headers, rows } = parsed;
  const headerMap = {};
  headers.forEach((h, idx) => { headerMap[h.toLowerCase()] = idx; });

  const { studyCol, outcomeCol, yiCol, viCol } = mvHeaders;
  const knownCols = new Set([studyCol, outcomeCol, yiCol, viCol].map(c => c.toLowerCase()));
  const modCols = headers.filter(h => !knownCols.has(h.toLowerCase()));

  mvModerators.length = 0;
  modCols.forEach(col => mvModerators.push(col));
  renderMVModTags();
  rebuildMVTableHeaders();

  document.getElementById("mvTableBody").innerHTML = "";
  rows.forEach(row => {
    const tr = addMVRow();
    tr.querySelector(".mv-study-id").value   = row[headerMap[studyCol.toLowerCase()]]  ?? "";
    tr.querySelector(".mv-outcome-id").value = row[headerMap[outcomeCol.toLowerCase()]] ?? "";
    tr.querySelector(".mv-yi").value         = row[headerMap[yiCol.toLowerCase()]]      ?? "";
    tr.querySelector(".mv-vi").value         = row[headerMap[viCol.toLowerCase()]]      ?? "";
    modCols.forEach((col, i) => {
      const inputs = tr.querySelectorAll(".mv-mod-cell");
      if (inputs[i]) inputs[i].value = row[headerMap[col.toLowerCase()]] ?? "";
    });
  });
  _markStale();
}

// ── MV analysis & rendering ───────────────────────────────────────────────────

// Shared analysis-level checks for MV rows (outcome count, study count,
// single-outcome studies, struct overparameterization). Called by both the
// live validation panel and runMVAnalysis so messages stay in sync.
function _mvAnalysisChecks(rows) {
  const errors = [], warnings = [];
  const outcomeIds = [...new Set(rows.map(r => r.outcome_id))];
  const studyIds   = [...new Set(rows.map(r => r.study_id))];

  if (outcomeIds.length < 2)
    errors.push("Requires ≥ 2 distinct outcome IDs. For a single outcome, use Standard mode.");
  if (studyIds.length < 3)
    errors.push("Requires ≥ 3 studies.");

  const studyOutcomeCounts = {};
  rows.forEach(r => {
    studyOutcomeCounts[r.study_id] = (studyOutcomeCounts[r.study_id] || new Set());
    studyOutcomeCounts[r.study_id].add(r.outcome_id);
  });
  const singleOutcomeStudies = Object.entries(studyOutcomeCounts)
    .filter(([, s]) => s.size === 1).map(([id]) => id);
  if (singleOutcomeStudies.length === studyIds.length)
    warnings.push("All studies contribute only one outcome — within-study correlations cannot be estimated. Consider using Standard mode or checking that Study IDs correctly group multiple outcomes per study.");
  else if (singleOutcomeStudies.length > 0)
    warnings.push(`Studies with only one outcome (contribute no covariance): ${singleOutcomeStudies.map(escapeHTML).join(", ")}.`);

  const struct  = document.getElementById("mvStruct").value;
  const nPsiPar = struct === "CS" ? 2 : struct === "Diag" ? outcomeIds.length : outcomeIds.length * (outcomeIds.length + 1) / 2;
  if (struct === "UN" && outcomeIds.length > 5)
    warnings.push(`UN structure with P = ${outcomeIds.length} outcomes requires ${nPsiPar} Ψ parameters — optimizer instability likely. Consider CS or Diag.`);
  if (nPsiPar > studyIds.length / 3)
    warnings.push(`Between-study covariance has ${nPsiPar} parameters but only ${studyIds.length} studies — model may be overparameterized.`);

  return { errors, warnings };
}

function _updateMVValidationWarnings() {
  const warningsEl = document.getElementById("mvValidationWarnings");
  const errors = [], warnings = [];
  document.querySelectorAll("#mvTableBody tr").forEach((tr, i) => {
    if (tr.classList.contains("row-pending-delete")) return;
    const allInputs = [...tr.querySelectorAll("input")];
    if (allInputs.every(inp => inp.value.trim() === "")) return;
    const studyId   = tr.querySelector(".mv-study-id")?.value.trim()  || `Row ${i + 1}`;
    const outcomeId = tr.querySelector(".mv-outcome-id")?.value.trim() || "";
    const label     = outcomeId ? `${studyId} / ${outcomeId}` : studyId;
    const yiRaw = tr.querySelector(".mv-yi")?.value.trim() ?? "";
    const viRaw = tr.querySelector(".mv-vi")?.value.trim() ?? "";
    const yi = yiRaw === "" ? NaN : +yiRaw;
    const vi = viRaw === "" ? NaN : +viRaw;
    if (!tr.querySelector(".mv-study-id")?.value.trim() ||
        !tr.querySelector(".mv-outcome-id")?.value.trim() ||
        !isFinite(yi) || !isFinite(vi) || vi <= 0)
      warnings.push(msgExcluded(label, "Invalid input"));

    tr.querySelectorAll(".mv-mod-cell").forEach((inp, modIdx) => {
      if (inp.classList.contains("input-error")) {
        const modName = mvModerators[modIdx] || `moderator ${modIdx + 1}`;
        warnings.push(msgNonNumericMod(label, inp.value.trim(), modName));
      }
    });
  });
  const rows = _collectMVRows();
  if (!rows.length) {
    errors.push("No valid rows — fill in Study ID, Outcome ID, y<sub>i</sub>, and v<sub>i</sub>.");
  } else {
    const checks   = analysisChecks({ studies: rows, biasTests: false });
    const mvChecks = _mvAnalysisChecks(rows);
    errors.push(...checks.errors,   ...mvChecks.errors);
    warnings.push(...checks.warnings, ...mvChecks.warnings);
  }
  renderWarningBlocks(warningsEl, { errors, warnings });
}

export function runMVAnalysis() {
  document.querySelectorAll("#mvTableBody tr").forEach(tr => {
    if (!tr.classList.contains("row-pending-delete")) _validateMVRow(tr);
  });
  _updateMVValidationWarnings();

  let rows = _collectMVRows();
  const warningsEl = document.getElementById("mvValidationWarnings");

  if (!rows.length) return false;

  const runErrors = [], runWarnings = [];
  const flush = () => renderWarningBlocks(warningsEl, { errors: runErrors, warnings: runWarnings });

  let activeModerators = [...mvModerators];
  if (activeModerators.length) {
    const before = rows.length;
    const filtered = rows.filter(r => activeModerators.every(name => isFinite(r[name])));
    const dropped = before - filtered.length;
    if (dropped === before) {
      runWarnings.push(`No rows have complete moderator values — running without moderators.`);
      activeModerators = [];
    } else {
      rows = filtered;
      if (dropped) runWarnings.push(`${dropped} row${dropped > 1 ? "s" : ""} excluded: missing or non-numeric moderator value${dropped > 1 ? "s" : ""}.`);
    }
  }
  const mvChecks = _mvAnalysisChecks(rows);
  runErrors.push(...mvChecks.errors);
  runWarnings.push(...mvChecks.warnings);

  if (runErrors.length) {
    flush();
    return false;
  }

  const struct   = document.getElementById("mvStruct").value;
  const method   = document.getElementById("mvMethod").value;
  const ciMethod = document.getElementById("mvCiMethod").value;
  const slopes   = document.getElementById("mvSlopes").value;
  const rho      = parseFloat(document.getElementById("mvRho").value);
  const alpha    = _getCiAlpha();
  const mods     = activeModerators.map(key => ({ key, type: "continuous" }));

  flush();

  let V, res;
  try {
    V   = vcalc(rows, { rho });
    res = mvMeta(rows, V, { struct, method, ciMethod, slopes, alpha, moderators: mods });
  } catch (e) {
    runErrors.push(`Error: ${escapeHTML(String(e))}`);
    flush();
    return false;
  }

  if (res.error) {
    runErrors.push(`Error: ${escapeHTML(res.error)}`);
    flush();
    return false;
  }

  document.querySelectorAll(".results-section").forEach(d => { d.removeAttribute("open"); d.style.display = "none"; });

  const _stdForestSection = document.getElementById("forestSection");
  const _mvForestSection  = document.getElementById("mvForestSection");
  if (_stdForestSection) _stdForestSection.style.display = "none";
  if (_mvForestSection)  _mvForestSection.style.display  = "";

  _renderMVResults(res, { alpha, rows });

  _appState.reportArgs = { mv: true, mvRes: res, mvRows: rows, mvAlpha: alpha, mvCiMethod: ciMethod };

  const _studyTableSection = document.getElementById("studyTableSection");
  const _studyTableEl      = document.getElementById("studyTable");
  if (_studyTableSection && _studyTableEl) {
    _studyTableSection.style.display = "";
    _studyTableEl.innerHTML = _buildMVStudyTable(rows, alpha);
  }

  document.getElementById("robSection")?.style.setProperty("display", "none");

  _onRunSuccess();
  return true;
}

function _buildMVStudyTable(rows, alpha = 0.05) {
  const z    = normalQuantile(1 - alpha / 2);
  const ciPct = Math.round((1 - alpha) * 100);
  function fv(v) { return isFinite(v) ? v.toFixed(4) : "—"; }

  const bodyRows = rows.map(r => {
    const se = Math.sqrt(r.vi);
    return `<tr>
      <td>${escapeHTML(String(r.study_id))}</td>
      <td>${escapeHTML(String(r.outcome_id))}</td>
      <td>${fv(r.yi)}</td>
      <td>${fv(r.vi)}</td>
      <td>${fv(se)}</td>
      <td>[${fv(r.yi - z * se)},&nbsp;${fv(r.yi + z * se)}]</td>
    </tr>`;
  }).join("");

  return `<table class="reg-table" style="width:100%">
    <thead><tr>
      <th>Study</th><th>Outcome</th>
      <th>y<sub>i</sub></th><th>v<sub>i</sub></th>
      <th>SE</th><th>${ciPct}% CI</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function _renderMVResults(res, { alpha, rows = [] } = {}) {
  const { beta, se, ci, z, pval, betaNames, tau2, rho_between, Psi, corPsi, outcomeIds,
          n, k, P, QM, df_QM, pQM, QE, df_QE, pQE, Fstat, pF, logLik, AIC, BIC, AICc,
          struct, method, ciMethod = "normal", dist = "z", df, I2,
          convergence, warnings: engineWarnings = [] } = res;

  alpha ??= 0.05;
  const ciPct  = Math.round((1 - alpha) * 100);
  const fmtP   = p => !isFinite(p) ? "—" : p < 0.001 ? "< .001" : p.toFixed(3).replace(/^0\./, ".");
  const stars  = p => p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "";
  const hasMods = beta.length > P;

  const warnHTML = (engineWarnings.length || convergence === false)
    ? (convergence === false
        ? `<p style="color:var(--color-warning);margin:2px 0">⚠ Optimizer did not fully converge — interpret results with caution.</p>`
        : "") +
      engineWarnings.map(w => `<p style="color:var(--color-warning);margin:2px 0">⚠ ${escapeHTML(w)}</p>`).join("")
    : "";

  const interceptRows = beta.slice(0, P).map((b, o) => {
    const [lo, hi] = ci[o];
    return `<tr>
      <td><strong>${escapeHTML(String(outcomeIds[o]))}</strong></td>
      <td>${fmt(b, 4)}</td><td>${fmt(se[o], 4)}</td>
      <td>[${fmt(lo, 4)}, ${fmt(hi, 4)}]</td>
      <td>${fmt(z[o], 3)}</td>
      <td>${fmtP(pval[o])}${stars(pval[o])}</td>
    </tr>`;
  }).join("");

  const interceptTable = `
    <h4 style="font-size:0.9em;margin:8px 0 4px">
      Pooled effect per outcome<button class="help-btn" data-help="mv.model" title="Help">?</button>
    </h4>
    <table class="reg-table" style="margin-bottom:12px">
      <thead><tr><th>Outcome</th><th>Estimate</th><th>SE</th>
        <th>${ciPct}% CI</th><th><em>${dist}</em></th><th><em>p</em></th></tr></thead>
      <tbody>${interceptRows}</tbody>
    </table>`;

  let modTable = "";
  if (hasMods) {
    const modRows = beta.slice(P).map((b, i) => {
      const j = P + i;
      const [lo, hi] = ci[j];
      return `<tr>
        <td>${escapeHTML(betaNames[j])}</td>
        <td>${fmt(b, 4)}</td><td>${fmt(se[j], 4)}</td>
        <td>[${fmt(lo, 4)}, ${fmt(hi, 4)}]</td>
        <td>${fmt(z[j], 3)}</td>
        <td>${fmtP(pval[j])}${stars(pval[j])}</td>
      </tr>`;
    }).join("");
    modTable = `
      <h4 style="font-size:0.9em;margin:8px 0 4px">Moderator effects</h4>
      <table class="reg-table" style="margin-bottom:12px">
        <thead><tr><th>Coefficient</th><th>Estimate</th><th>SE</th>
          <th>${ciPct}% CI</th><th><em>${dist}</em></th><th><em>p</em></th></tr></thead>
        <tbody>${modRows}</tbody>
      </table>`;
  }

  let psiBlock = "";
  if (struct === "CS") {
    const i2rows = outcomeIds.map((id, o) =>
      `<tr><td>${escapeHTML(String(id))}</td><td>${fmt(tau2[o], 5)}</td><td>${fmt(I2[o], 1)}%</td></tr>`
    ).join("");
    psiBlock = `<h4 style="font-size:0.9em;margin:8px 0 4px">Between-study heterogeneity (Ψ̂, CS)</h4>
      <p style="font-size:0.875em;margin:2px 0">
        Shared τ² = ${fmt(tau2[0], 5)},
        ρ<sub>between</sub> = ${fmt(rho_between ?? 0, 4)}
      </p>
      <table class="reg-table" style="margin-bottom:8px">
        <thead><tr><th>Outcome</th><th>τ²</th><th><em>I</em>²</th></tr></thead>
        <tbody>${i2rows}</tbody>
      </table>`;
  } else if (struct === "Diag") {
    const i2rows = outcomeIds.map((id, o) =>
      `<tr><td>${escapeHTML(String(id))}</td><td>${fmt(tau2[o], 5)}</td><td>${fmt(I2[o], 1)}%</td></tr>`
    ).join("");
    psiBlock = `<h4 style="font-size:0.9em;margin:8px 0 4px">Between-study heterogeneity (Ψ̂, Diagonal)</h4>
      <table class="reg-table" style="margin-bottom:8px">
        <thead><tr><th>Outcome</th><th>τ²</th><th><em>I</em>²</th></tr></thead>
        <tbody>${i2rows}</tbody>
      </table>`;
  } else {
    const hdr = outcomeIds.map(id => `<th>${escapeHTML(String(id))}</th>`).join("");
    const psiRows = Psi.map((row, i) =>
      `<tr><th>${escapeHTML(String(outcomeIds[i]))}</th>${row.map(v => `<td>${fmt(v, 5)}</td>`).join("")}</tr>`
    ).join("");
    const corRows = (corPsi || []).map((row, i) =>
      `<tr><th>${escapeHTML(String(outcomeIds[i]))}</th>${row.map((v, j) =>
        `<td ${i === j ? 'style="color:var(--fg-muted)"' : ""}>${fmt(v, 4)}</td>`
      ).join("")}</tr>`
    ).join("");
    const i2rows = outcomeIds.map((id, o) =>
      `<tr><td>${escapeHTML(String(id))}</td><td>${fmt(tau2[o], 5)}</td><td>${fmt(I2[o], 1)}%</td></tr>`
    ).join("");
    psiBlock = `<h4 style="font-size:0.9em;margin:8px 0 4px">Between-study covariance matrix Ψ̂ (Unstructured)</h4>
      <table class="reg-table" style="margin-bottom:6px">
        <thead><tr><th></th>${hdr}</tr></thead><tbody>${psiRows}</tbody>
      </table>
      <h4 style="font-size:0.9em;margin:6px 0 4px">Between-study correlations ρ̂</h4>
      <table class="reg-table" style="margin-bottom:6px">
        <thead><tr><th></th>${hdr}</tr></thead><tbody>${corRows}</tbody>
      </table>
      <table class="reg-table" style="margin-bottom:8px">
        <thead><tr><th>Outcome</th><th>τ²</th><th><em>I</em>²</th></tr></thead>
        <tbody>${i2rows}</tbody>
      </table>`;
  }

  const useFtest = dist === "t" && hasMods && isFinite(Fstat);
  const testsBlock = `
    <h4 style="font-size:0.9em;margin:8px 0 4px">Hypothesis tests</h4>
    <table class="reg-table" style="margin-bottom:12px">
      <thead><tr><th>Test</th><th>${useFtest ? "Statistic" : "χ²"}</th><th>df</th><th><em>p</em></th></tr></thead>
      <tbody>
        ${hasMods && isFinite(QM) ? `<tr><td>Omnibus test of moderators (Q<sub>M</sub>)</td>${
          useFtest
            ? `<td>F = ${fmt(Fstat, 3)}</td><td>${df_QM}, ${df}</td><td>${fmtP(pF)}</td>`
            : `<td>${fmt(QM, 3)}</td><td>${df_QM}</td><td>${fmtP(pQM)}</td>`
        }</tr>` : ""}
        <tr><td>Residual heterogeneity (Q<sub>E</sub>)</td>
          <td>${useFtest ? `χ² = ${fmt(QE, 3)}` : fmt(QE, 3)}</td>
          <td>${df_QE}</td><td>${fmtP(pQE)}</td></tr>
      </tbody>
    </table>`;

  const fitBlock = `<div style="font-size:0.82em;color:var(--fg-muted);margin:4px 0 14px;line-height:1.7">
    k = ${k} studies &nbsp;·&nbsp; n = ${n} obs &nbsp;·&nbsp; P = ${P} outcomes
    &nbsp;|&nbsp; log-lik = ${fmt(logLik, 4)}
    &nbsp;·&nbsp; AIC = ${fmt(AIC, 2)} &nbsp;·&nbsp; BIC = ${fmt(BIC, 2)}
    ${isFinite(AICc) ? `&nbsp;·&nbsp; AICc = ${fmt(AICc, 2)}` : ""}
    &nbsp;|&nbsp; ${method}, Ψ = ${struct}, CI = ${ciMethod === "t" ? "t-dist" : "normal"}
    ${convergence === false ? `&nbsp;·&nbsp; <span style="color:var(--color-warning)">convergence uncertain</span>` : ""}
  </div>`;

  const boundaryOutcomes = outcomeIds.filter((_, o) => tau2[o] < 1e-6).map(id => escapeHTML(String(id)));
  const boundaryNote = boundaryOutcomes.length
    ? `<p style="color:var(--fg-muted);font-size:0.8em;margin:0 0 6px">ℹ τ² ≈ 0 for ${boundaryOutcomes.join(", ")} — estimate is at the boundary; no detectable between-study heterogeneity for these outcomes.</p>`
    : "";

  document.getElementById("results").innerHTML =
    warnHTML + interceptTable + modTable + psiBlock + boundaryNote + testsBlock + fitBlock;

  mvForestState.lastRes      = res;
  mvForestState.lastRows     = rows;
  mvForestState.alpha        = alpha;
  mvForestState.ciMethod     = ciMethod;
  mvForestState.pages        = outcomeIds.map(() => 0);
  mvForestState.combinedPage = 0;

  const mvForestContainer = document.getElementById("mvForestContainer");
  if (!mvForestContainer) return;

  const combinedBlock =
    `<div id="mvForestCombinedBlock" style="display:none;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div class="plot-export">
          <button class="export-btn" data-target="mvForestPlotCombined" data-format="svg">SVG</button>
          <button class="export-btn" data-target="mvForestPlotCombined" data-format="png">PNG</button>
          <button class="export-btn" data-target="mvForestPlotCombined" data-format="tiff">TIFF</button>
        </div>
      </div>
      <svg id="mvForestPlotCombined" role="img" aria-label="Combined multivariate forest plot"
        width="620" height="20" style="display:block"></svg>
      <div id="mvForestNavCombined" class="forest-nav"></div>
    </div>`;

  const separateBlocks = outcomeIds.map((id, o) =>
    `<div style="margin-bottom:20px" id="mvForestBlock-${o}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <p class="plot-label" style="margin:0">${escapeHTML(String(id))}</p>
        <div class="plot-export">
          <button class="export-btn" data-target="mvForestPlot-${o}" data-format="svg">SVG</button>
          <button class="export-btn" data-target="mvForestPlot-${o}" data-format="png">PNG</button>
          <button class="export-btn" data-target="mvForestPlot-${o}" data-format="tiff">TIFF</button>
        </div>
      </div>
      <svg id="mvForestPlot-${o}" role="img"
        aria-label="Forest plot — ${escapeHTML(String(id))}"
        width="620" height="20" style="display:block"></svg>
      <div id="mvForestNav-${o}" class="forest-nav"></div>
    </div>`
  ).join("");

  mvForestContainer.innerHTML = combinedBlock + separateBlocks;

  redrawAllMVForestPlots();
}

export function redrawAllMVForestPlots() {
  const { lastRes: res, lastRows: rows, alpha, pages, pageSize, showPI, viewMode, combinedPage } = mvForestState;
  if (!res) return;
  const { beta, ci, se, tau2, outcomeIds, k, P } = res;

  const isCombined = viewMode === "combined";
  const combinedBlockEl = document.getElementById("mvForestCombinedBlock");
  if (combinedBlockEl) combinedBlockEl.style.display = isCombined ? "" : "none";
  outcomeIds.forEach((_, o) => {
    const block = document.getElementById(`mvForestBlock-${o}`);
    if (block) block.style.display = isCombined ? "none" : "";
  });

  if (isCombined) {
    const svgEl = document.getElementById("mvForestPlotCombined");
    const navEl = document.getElementById("mvForestNavCombined");
    if (!svgEl) return;
    const allStudyIds = [...new Set(rows.map(r => String(r.study_id)))];
    const { totalPages } = _drawMVForestCombined(svgEl, rows, res, alpha, {
      page: combinedPage, pageSize, showPI, theme: _appState.plotTheme ?? "default",
    });
    _renderMVForestNavCombined(navEl, totalPages, allStudyIds.length);
    return;
  }

  const dfPred = Math.max(k - P - 1, 1);
  outcomeIds.forEach((id, o) => {
    const svgEl = document.getElementById(`mvForestPlot-${o}`);
    const navEl = document.getElementById(`mvForestNav-${o}`);
    if (!svgEl) return;
    const outcomeRows = rows.filter(r => String(r.outcome_id) === String(id));
    if (!outcomeRows.length) return;
    const pooled = { est: beta[o], lo: ci[o][0], hi: ci[o][1] };
    const piOpts = showPI ? {
      lo: beta[o] - tCritical(dfPred, alpha) * Math.sqrt(tau2[o] + se[o] ** 2),
      hi: beta[o] + tCritical(dfPred, alpha) * Math.sqrt(tau2[o] + se[o] ** 2),
    } : null;
    const { totalPages } = _drawMVForestPlot(svgEl, outcomeRows, pooled, String(id), alpha, {
      page: pages[o] ?? 0, pageSize, pi: piOpts, theme: _appState.plotTheme ?? "default",
    });
    _renderMVForestNav(navEl, o, totalPages, outcomeRows.length);
  });
}

function _renderMVForestNav(navEl, outcomeIdx, totalPages, kAll) {
  if (!navEl) return;
  if (totalPages <= 1) { navEl.innerHTML = ""; return; }
  const page = mvForestState.pages[outcomeIdx] ?? 0;
  const prevId = `mvFPrev-${outcomeIdx}`;
  const nextId = `mvFNext-${outcomeIdx}`;
  navEl.innerHTML =
    `<button id="${prevId}" ${page === 0 ? "disabled" : ""}>‹ Prev</button>` +
    `<span>Page ${page + 1} of ${totalPages}</span>` +
    `<button id="${nextId}" ${page >= totalPages - 1 ? "disabled" : ""}>Next ›</button>` +
    `<span class="forest-nav-note">Pooled estimate includes all ${kAll} studies</span>`;
  document.getElementById(prevId)?.addEventListener("click", () => {
    if (mvForestState.pages[outcomeIdx] > 0) {
      mvForestState.pages[outcomeIdx]--;
      redrawAllMVForestPlots();
    }
  });
  document.getElementById(nextId)?.addEventListener("click", () => {
    if (mvForestState.pages[outcomeIdx] < totalPages - 1) {
      mvForestState.pages[outcomeIdx]++;
      redrawAllMVForestPlots();
    }
  });
}

function _drawMVForestPlot(svgEl, rows, pooled, label, alpha = 0.05, { page = 0, pageSize = Infinity, pi = null, theme = "default" } = {}) {
  if (typeof d3 === "undefined" || !rows.length) return { totalPages: 1 };

  const z = normalQuantile(1 - alpha / 2);
  const T = PLOT_THEMES[theme] ?? PLOT_THEMES["default"];

  const ps = pageSize === Infinity ? rows.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(rows.length / ps));
  const safePage   = Math.min(Math.max(0, page), totalPages - 1);
  const pageRows   = rows.slice(safePage * ps, safePage * ps + ps);

  const lW = 130, pW = 280, aW = 175;
  const rowH = 20, headerH = 24, axisH = 26;
  const ml = 6, mr = 6;
  const nS = pageRows.length;
  const piRows  = pi ? 1 : 0;
  const totalW  = ml + lW + pW + aW + mr;
  const totalH  = headerH + nS * rowH + 6 + rowH + (piRows ? rowH : 0) + axisH;

  const svg = d3.select(svgEl)
    .attr("width", totalW)
    .attr("height", totalH);
  svg.selectAll("*").remove();
  svg.style("background", (T.bg !== "transparent") ? T.bg : null);
  svg.style("font-family", T.fontFamily);
  if (T.bg !== "transparent") {
    svg.append("rect").attr("width", totalW).attr("height", totalH).attr("fill", T.bg);
  }

  const seAll = rows.map(r => Math.sqrt(r.vi));
  const xVals = rows.flatMap((r, i) => [r.yi - z * seAll[i], r.yi + z * seAll[i]])
    .concat([pooled.lo, pooled.hi]);
  if (pi) xVals.push(pi.lo, pi.hi);
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const pad  = Math.max((xMax - xMin) * 0.12, 0.05);
  const xScale = d3.scaleLinear()
    .domain([xMin - pad, xMax + pad])
    .range([0, pW]);

  const plotG = svg.append("g").attr("transform", `translate(${ml + lW},${headerH})`);

  const zeroLineH = nS * rowH + 6 + rowH + (piRows ? rowH : 0);
  if (xScale.domain()[0] <= 0 && xScale.domain()[1] >= 0) {
    plotG.append("line")
      .attr("x1", xScale(0)).attr("x2", xScale(0))
      .attr("y1", 0).attr("y2", zeroLineH)
      .attr("stroke", T.border).attr("stroke-dasharray", "3,3").attr("stroke-width", 1);
  }

  [
    [ml + lW / 2,           "Study"],
    [ml + lW + pW / 2,      label],
    [ml + lW + pW + aW / 2, `Effect [${Math.round((1 - alpha) * 100)}% CI]`],
  ].forEach(([x, text]) =>
    svg.append("text")
      .attr("x", x).attr("y", headerH - 6)
      .attr("text-anchor", "middle")
      .attr("fill", T.fgMuted).attr("font-size", "10px")
      .text(text)
  );

  const wtsAll  = rows.map(r => 1 / r.vi);
  const wMax    = Math.max(...wtsAll);
  const sePageArr = pageRows.map(r => Math.sqrt(r.vi));

  pageRows.forEach((row, i) => {
    const y  = i * rowH + rowH / 2;
    const se = sePageArr[i];
    const lo = row.yi - z * se;
    const hi = row.yi + z * se;
    const wi = 1 / row.vi;
    const bh = Math.max(2, Math.min(6, 5.5 * Math.sqrt(wi / wMax)));

    plotG.append("line")
      .attr("x1", xScale(Math.max(xScale.domain()[0], lo)))
      .attr("x2", xScale(Math.min(xScale.domain()[1], hi)))
      .attr("y1", y).attr("y2", y)
      .attr("stroke", T.fg).attr("stroke-width", 1);
    plotG.append("rect")
      .attr("x", xScale(row.yi) - bh).attr("y", y - bh)
      .attr("width", bh * 2).attr("height", bh * 2)
      .attr("fill", T.accent);

    svg.append("text")
      .attr("x", ml + lW - 4).attr("y", headerH + y + 4)
      .attr("text-anchor", "end")
      .attr("fill", T.fg).attr("font-size", "10px")
      .text(String(row.study_id));

    svg.append("text")
      .attr("x", ml + lW + pW + 5).attr("y", headerH + y + 4)
      .attr("text-anchor", "start")
      .attr("fill", T.fg).attr("font-size", "10px")
      .text(`${fmt(row.yi, 3)} [${fmt(lo, 3)}, ${fmt(hi, 3)}]`);
  });

  const sepY = nS * rowH + 4;
  plotG.append("line")
    .attr("x1", 0).attr("x2", pW)
    .attr("y1", sepY).attr("y2", sepY)
    .attr("stroke", T.border).attr("stroke-width", 1);

  const dY   = sepY + rowH / 2;
  const dLo  = xScale(Math.max(xScale.domain()[0], pooled.lo));
  const dHi  = xScale(Math.min(xScale.domain()[1], pooled.hi));
  const dMid = xScale(pooled.est);
  const dH   = 7;
  plotG.append("polygon")
    .attr("points", `${dMid},${dY - dH} ${dHi},${dY} ${dMid},${dY + dH} ${dLo},${dY}`)
    .attr("fill", T.accent);

  svg.append("text")
    .attr("x", ml + lW - 4).attr("y", headerH + dY + 4)
    .attr("text-anchor", "end")
    .attr("fill", T.fg).attr("font-size", "10px").attr("font-weight", "600")
    .text("Pooled (MV)");
  svg.append("text")
    .attr("x", ml + lW + pW + 5).attr("y", headerH + dY + 4)
    .attr("text-anchor", "start")
    .attr("fill", T.fg).attr("font-size", "10px").attr("font-weight", "600")
    .text(`${fmt(pooled.est, 3)} [${fmt(pooled.lo, 3)}, ${fmt(pooled.hi, 3)}]`);

  if (pi && isFinite(pi.lo) && isFinite(pi.hi)) {
    const piY   = dY + rowH;
    const piLoX = xScale(Math.max(xScale.domain()[0], pi.lo));
    const piHiX = xScale(Math.min(xScale.domain()[1], pi.hi));
    const piColor = T.pi;
    plotG.append("line")
      .attr("x1", piLoX).attr("x2", piHiX)
      .attr("y1", piY).attr("y2", piY)
      .attr("stroke", piColor).attr("stroke-width", 2).attr("stroke-dasharray", "6,3");
    plotG.append("line").attr("x1", piLoX).attr("x2", piLoX)
      .attr("y1", piY - 5).attr("y2", piY + 5)
      .attr("stroke", piColor).attr("stroke-width", 2);
    plotG.append("line").attr("x1", piHiX).attr("x2", piHiX)
      .attr("y1", piY - 5).attr("y2", piY + 5)
      .attr("stroke", piColor).attr("stroke-width", 2);
    svg.append("text")
      .attr("x", ml + lW - 4).attr("y", headerH + piY + 4)
      .attr("text-anchor", "end")
      .attr("fill", piColor).attr("font-size", "10px")
      .text("Pred. interval");
    svg.append("text")
      .attr("x", ml + lW + pW + 5).attr("y", headerH + piY + 4)
      .attr("text-anchor", "start")
      .attr("fill", piColor).attr("font-size", "10px")
      .text(`${fmt(pi.lo, 3)} to ${fmt(pi.hi, 3)}`);
  }

  const axisOffsetY = sepY + rowH + (piRows ? rowH : 0) + 2;
  plotG.append("g")
    .attr("transform", `translate(0,${axisOffsetY})`)
    .call(d3.axisBottom(xScale).ticks(5).tickSize(3))
    .call(g => g.select(".domain").attr("stroke", T.border))
    .call(g => g.selectAll(".tick line").attr("stroke", T.border))
    .call(g => g.selectAll(".tick text")
      .attr("fill", T.fgMuted).attr("font-size", "9px").attr("font-family", T.fontFamily));

  return { totalPages };
}

function _renderMVForestNavCombined(navEl, totalPages, nStudies) {
  if (!navEl) return;
  if (totalPages <= 1) { navEl.innerHTML = ""; return; }
  const page = mvForestState.combinedPage;
  navEl.innerHTML =
    `<button id="mvFCPrev" ${page === 0 ? "disabled" : ""}>‹ Prev</button>` +
    `<span>Page ${page + 1} of ${totalPages}</span>` +
    `<button id="mvFCNext" ${page >= totalPages - 1 ? "disabled" : ""}>Next ›</button>` +
    `<span class="forest-nav-note">Pooled estimates include all ${nStudies} studies</span>`;
  document.getElementById("mvFCPrev")?.addEventListener("click", () => {
    if (mvForestState.combinedPage > 0) { mvForestState.combinedPage--; redrawAllMVForestPlots(); }
  });
  document.getElementById("mvFCNext")?.addEventListener("click", () => {
    if (mvForestState.combinedPage < totalPages - 1) { mvForestState.combinedPage++; redrawAllMVForestPlots(); }
  });
}

function _drawMVForestCombined(svgEl, rows, res, alpha, { page = 0, pageSize = Infinity, showPI = false, theme = "default" } = {}) {
  if (typeof d3 === "undefined" || !rows.length || !res) return { totalPages: 1 };
  const T = PLOT_THEMES[theme] ?? PLOT_THEMES["default"];
  const { beta, ci, se, tau2, outcomeIds, k, P } = res;
  const z = normalQuantile(1 - alpha / 2);
  const dfPred = Math.max(k - P - 1, 1);

  const allStudyIds = [...new Set(rows.map(r => String(r.study_id)))];
  const ps = pageSize === Infinity ? allStudyIds.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(allStudyIds.length / ps));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const pageStudyIds = new Set(allStudyIds.slice(safePage * ps, safePage * ps + ps));

  const palette = T.useBwShapes
    ? ["#111111","#555555","#888888","#333333","#666666","#999999","#222222","#777777","#444444","#aaaaaa"]
    : ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac"];

  const seAll = rows.map(r => Math.sqrt(r.vi));
  const xVals = rows.flatMap((r, i) => [r.yi - z * seAll[i], r.yi + z * seAll[i]]);
  outcomeIds.forEach((_, o) => {
    xVals.push(ci[o][0], ci[o][1]);
    if (showPI) {
      const tc = tCritical(dfPred, alpha);
      xVals.push(beta[o] - tc * Math.sqrt(tau2[o] + se[o] ** 2),
                 beta[o] + tc * Math.sqrt(tau2[o] + se[o] ** 2));
    }
  });
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const pad = Math.max((xMax - xMin) * 0.12, 0.05);

  const lW = 130, pW = 280, aW = 175;
  const rowH = 20, headerH = 24, axisH = 26;
  const groupHdrH = 22, sepH = 6, spacerH = 10;
  const ml = 6, mr = 6;
  const totalW = ml + lW + pW + aW + mr;

  const perPageRows = outcomeIds.map(id =>
    rows.filter(r => String(r.outcome_id) === String(id) && pageStudyIds.has(String(r.study_id)))
  );
  const groupH = (nS) => groupHdrH + nS * rowH + sepH + rowH + (showPI ? rowH : 0) + spacerH;
  const totalGroupH = perPageRows.reduce((acc, pr) => acc + groupH(pr.length), 0);
  const totalH = headerH + totalGroupH + axisH;

  const svg = d3.select(svgEl).attr("width", totalW).attr("height", totalH);
  svg.selectAll("*").remove();
  svg.style("background", (T.bg !== "transparent") ? T.bg : null);
  svg.style("font-family", T.fontFamily);
  if (T.bg !== "transparent") {
    svg.append("rect").attr("width", totalW).attr("height", totalH).attr("fill", T.bg);
  }

  const xScale = d3.scaleLinear().domain([xMin - pad, xMax + pad]).range([0, pW]);
  const plotG = svg.append("g").attr("transform", `translate(${ml + lW},${headerH})`);

  if (xScale.domain()[0] <= 0 && xScale.domain()[1] >= 0) {
    plotG.append("line")
      .attr("x1", xScale(0)).attr("x2", xScale(0))
      .attr("y1", 0).attr("y2", totalGroupH)
      .attr("stroke", T.border).attr("stroke-dasharray", "3,3").attr("stroke-width", 1);
  }

  [
    [ml + lW / 2,           "Study"],
    [ml + lW + pW / 2,      "Effect"],
    [ml + lW + pW + aW / 2, `Effect [${Math.round((1 - alpha) * 100)}% CI]`],
  ].forEach(([x, text]) =>
    svg.append("text").attr("x", x).attr("y", headerH - 6)
      .attr("text-anchor", "middle").attr("fill", T.fgMuted).attr("font-size", "10px").text(text)
  );

  let gy = 0;

  outcomeIds.forEach((id, o) => {
    const color = palette[o % palette.length];
    const pageRows = perPageRows[o];
    const nS = pageRows.length;
    const allOutcomeRows = rows.filter(r => String(r.outcome_id) === String(id));
    const wMax = Math.max(...allOutcomeRows.map(r => 1 / r.vi), 1);

    svg.append("rect")
      .attr("x", 0).attr("y", headerH + gy)
      .attr("width", totalW).attr("height", groupHdrH)
      .attr("fill", color).attr("opacity", 0.1);
    svg.append("text")
      .attr("x", ml + 5).attr("y", headerH + gy + groupHdrH - 6)
      .attr("fill", color).attr("font-size", "10px").attr("font-weight", "700")
      .text(escapeHTML(String(id)));
    gy += groupHdrH;

    pageRows.forEach((row, i) => {
      const y = gy + i * rowH + rowH / 2;
      const seSt = Math.sqrt(row.vi);
      const lo = row.yi - z * seSt;
      const hi = row.yi + z * seSt;
      const wi = 1 / row.vi;
      const bh = Math.max(2, Math.min(6, 5.5 * Math.sqrt(wi / wMax)));

      plotG.append("line")
        .attr("x1", xScale(Math.max(xScale.domain()[0], lo)))
        .attr("x2", xScale(Math.min(xScale.domain()[1], hi)))
        .attr("y1", y).attr("y2", y)
        .attr("stroke", color).attr("stroke-width", 1);
      plotG.append("rect")
        .attr("x", xScale(row.yi) - bh).attr("y", y - bh)
        .attr("width", bh * 2).attr("height", bh * 2)
        .attr("fill", color);
      svg.append("text")
        .attr("x", ml + lW - 4).attr("y", headerH + y + 4)
        .attr("text-anchor", "end").attr("fill", T.fg).attr("font-size", "10px")
        .text(String(row.study_id));
      svg.append("text")
        .attr("x", ml + lW + pW + 5).attr("y", headerH + y + 4)
        .attr("text-anchor", "start").attr("fill", T.fg).attr("font-size", "10px")
        .text(`${fmt(row.yi, 3)} [${fmt(lo, 3)}, ${fmt(hi, 3)}]`);
    });
    gy += nS * rowH;

    plotG.append("line")
      .attr("x1", 0).attr("x2", pW)
      .attr("y1", gy + sepH / 2).attr("y2", gy + sepH / 2)
      .attr("stroke", T.border).attr("stroke-width", 1);
    gy += sepH;

    const pooled = { est: beta[o], lo: ci[o][0], hi: ci[o][1] };
    const dY = gy + rowH / 2;
    const dMid = xScale(pooled.est);
    const dLo  = xScale(Math.max(xScale.domain()[0], pooled.lo));
    const dHi  = xScale(Math.min(xScale.domain()[1], pooled.hi));
    const dH   = 7;
    plotG.append("polygon")
      .attr("points", `${dMid},${dY - dH} ${dHi},${dY} ${dMid},${dY + dH} ${dLo},${dY}`)
      .attr("fill", color);
    svg.append("text")
      .attr("x", ml + lW - 4).attr("y", headerH + dY + 4)
      .attr("text-anchor", "end").attr("fill", T.fg).attr("font-size", "10px").attr("font-weight", "600")
      .text("Pooled (MV)");
    svg.append("text")
      .attr("x", ml + lW + pW + 5).attr("y", headerH + dY + 4)
      .attr("text-anchor", "start").attr("fill", T.fg).attr("font-size", "10px").attr("font-weight", "600")
      .text(`${fmt(pooled.est, 3)} [${fmt(pooled.lo, 3)}, ${fmt(pooled.hi, 3)}]`);
    gy += rowH;

    if (showPI) {
      const tc = tCritical(dfPred, alpha);
      const piLo = beta[o] - tc * Math.sqrt(tau2[o] + se[o] ** 2);
      const piHi = beta[o] + tc * Math.sqrt(tau2[o] + se[o] ** 2);
      const piY = gy + rowH / 2;
      if (isFinite(piLo) && isFinite(piHi)) {
        const piLoX = xScale(Math.max(xScale.domain()[0], piLo));
        const piHiX = xScale(Math.min(xScale.domain()[1], piHi));
        plotG.append("line")
          .attr("x1", piLoX).attr("x2", piHiX).attr("y1", piY).attr("y2", piY)
          .attr("stroke", color).attr("stroke-width", 2).attr("stroke-dasharray", "6,3").attr("opacity", 0.65);
        plotG.append("line").attr("x1", piLoX).attr("x2", piLoX)
          .attr("y1", piY - 5).attr("y2", piY + 5).attr("stroke", color).attr("stroke-width", 2).attr("opacity", 0.65);
        plotG.append("line").attr("x1", piHiX).attr("x2", piHiX)
          .attr("y1", piY - 5).attr("y2", piY + 5).attr("stroke", color).attr("stroke-width", 2).attr("opacity", 0.65);
        svg.append("text")
          .attr("x", ml + lW - 4).attr("y", headerH + piY + 4)
          .attr("text-anchor", "end").attr("fill", T.pi).attr("font-size", "10px")
          .text("Pred. interval");
        svg.append("text")
          .attr("x", ml + lW + pW + 5).attr("y", headerH + piY + 4)
          .attr("text-anchor", "start").attr("fill", T.pi).attr("font-size", "10px")
          .text(`${fmt(piLo, 3)} to ${fmt(piHi, 3)}`);
      }
      gy += rowH;
    }

    gy += spacerH;
  });

  plotG.append("g")
    .attr("transform", `translate(0,${gy})`)
    .call(d3.axisBottom(xScale).ticks(5).tickSize(3))
    .call(g => g.select(".domain").attr("stroke", T.border))
    .call(g => g.selectAll(".tick line").attr("stroke", T.border))
    .call(g => g.selectAll(".tick text")
      .attr("fill", T.fgMuted).attr("font-size", "9px").attr("font-family", T.fontFamily));

  return { totalPages };
}

// ── MV report builder ─────────────────────────────────────────────────────────

function _mvSerializeSVG(svgEl) {
  if (!svgEl) return "";
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const w = clone.getAttribute("width")  || String(svgEl.getBoundingClientRect().width);
  const h = clone.getAttribute("height") || String(svgEl.getBoundingClientRect().height);
  clone.setAttribute("width", w);
  clone.setAttribute("height", h);
  resolveThemeVars(clone);
  if (!hasEmbeddedBackground(clone)) {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%");
    bg.setAttribute("fill", currentBgColour());
    clone.insertBefore(bg, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

function _renderRich(s) {
  return cellRich(s).map(r => r.italic ? `<em>${escapeHTML(r.text)}</em>` : escapeHTML(r.text)).join("");
}

export function buildMVReportHTML(res, rows = [], alpha = 0.05, { reportCSS, buildTableAPA, buildFigureAPA } = {}) {
  const { outcomeIds, k, P, method, struct, convergence, warnings: engineWarnings = [] } = res;
  const date = new Date().toLocaleDateString(undefined, { year:"numeric", month:"long", day:"numeric" });

  let _tblN = 0, _figN = 0;
  const nextTable  = () => ++_tblN;
  const nextFigure = () => ++_figN;

  const toHtmlRows = dataRows => dataRows.map(r =>
    `<tr>${r.map(c => `<td>${_renderRich(c)}</td>`).join("")}</tr>`);

  const pooledD = mvPooledData(res, alpha);
  const pooledSection = buildTableAPA(nextTable(), pooledD.title, pooledD.headers, toHtmlRows(pooledD.rows));

  const modD = mvModeratorData(res, alpha);
  const modSection = modD
    ? buildTableAPA(nextTable(), modD.title, modD.headers, toHtmlRows(modD.rows))
    : "";

  const hetD = mvHeterogeneityData(res);
  const hetSection = buildTableAPA(nextTable(), hetD.title, hetD.headers, toHtmlRows(hetD.rows));

  const testD = mvTestsData(res);
  const testSection = buildTableAPA(nextTable(), testD.title, testD.headers, toHtmlRows(testD.rows));

  const fitLine = escapeHTML(mvFitLine(res));

  const forestSVGs = (() => {
    const combined    = document.getElementById("mvForestPlotCombined");
    const combinedBlk = document.getElementById("mvForestCombinedBlock");
    if (combinedBlk && combinedBlk.style.display !== "none" && combined) {
      const s = _mvSerializeSVG(combined); return s ? [s] : [];
    }
    const out = [];
    for (let o = 0; o < outcomeIds.length; o++) {
      const el = document.getElementById(`mvForestPlot-${o}`);
      if (el) { const s = _mvSerializeSVG(el); if (s) out.push(s); }
    }
    return out;
  })();

  const warnHTML = [
    convergence === false ? `<p style="color:#c0392b"><strong>Warning:</strong> Optimizer did not fully converge — interpret results with caution.</p>` : "",
    ...engineWarnings.map(w => `<p style="color:#c0392b">${escapeHTML(w)}</p>`),
  ].filter(Boolean).join("");

  const forestSection = forestSVGs.length
    ? buildFigureAPA(nextFigure(), "Forest plot of multivariate meta-analysis results", forestSVGs)
    : "";

  const studyD = mvStudyData(rows, alpha);
  const studySection = studyD
    ? buildTableAPA(nextTable(), studyD.title, studyD.headers, toHtmlRows(studyD.rows))
    : "";

  let robSection = "";
  if (_robPlotState.domains.length > 0) {
    const robSVGs = [
      _mvSerializeSVG(document.getElementById("robTrafficLight")),
      _mvSerializeSVG(document.getElementById("robSummary")),
    ].filter(Boolean);
    if (robSVGs.length) robSection = buildFigureAPA(nextFigure(), "Risk of bias assessment", robSVGs);
  }

  const mvRefList = [
    "Berkey, C. S., Hoaglin, D. C., Antczak-Bouckoms, A., Mosteller, F., &amp; Colditz, G. A. (1998). Meta-analysis of multiple outcomes by regression with random effects. <em>Statistics in Medicine</em>, <em>17</em>(22), 2537–2550.",
    "Cheung, M. W.-L. (2014). Modeling dependent effect sizes with three-level meta-analyses: a structural equation modeling approach. <em>Psychological Methods</em>, <em>19</em>(2), 211–229.",
    "Cochran, W. G. (1954). The combination of estimates from different experiments. <em>Biometrics</em>, <em>10</em>(1), 101–129.",
    "Higgins, J. P. T., Thompson, S. G., Deeks, J. J., &amp; Altman, D. G. (2003). Measuring inconsistency in meta-analyses. <em>BMJ</em>, <em>327</em>(7414), 557–560. <a href=\"https://doi.org/10.1136/bmj.327.7414.557\">https://doi.org/10.1136/bmj.327.7414.557</a>",
    "Jackson, D., Riley, R., &amp; White, I. R. (2011). Multivariate meta-analysis: Potential and promise. <em>Statistics in Medicine</em>, <em>30</em>(20), 2481–2498.",
    "Riley, R. D., Abrams, K. R., Sutton, A. J., Lambert, P. C., &amp; Thompson, J. R. (2007). Bivariate random-effects meta-analysis and the estimation of between-study correlation. <em>BMC Medical Research Methodology</em>, <em>7</em>, 3.",
    "Viechtbauer, W. (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. <em>Journal of Educational and Behavioral Statistics</em>, <em>30</em>(3), 261–293.",
  ];
  const refSection = `<ul class="apa-references">${
    mvRefList.map(r => `<li>${r}</li>`).join("")
  }</ul>`;

  const wrapSec = html => html ? `<section>${html}</section>` : "";

  const body = [
    warnHTML,
    wrapSec(pooledSection),
    wrapSec(modSection),
    wrapSec(hetSection),
    wrapSec(testSection),
    `<p class="report-meta" style="margin-top:8px">${fitLine}</p>`,
    wrapSec(forestSection),
    wrapSec(studySection),
    wrapSec(robSection),
    refSection,
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
  <p class="report-meta">Generated ${escapeHTML(date)}
    &nbsp;·&nbsp; k = ${k} studies, P = ${P} outcomes
    &nbsp;·&nbsp; ${escapeHTML(method)}, Ψ = ${escapeHTML(struct)}</p>
  ${body}
</body>
</html>`;
}

export function mvDownloadHTML(html) {
  downloadBlob(html, "mv-meta-analysis-report.html", "text/html;charset=utf-8");
}

export function mvOpenPrintPreview(html) {
  const win = window.open("", "_blank");
  if (!win) { mvDownloadHTML(html); return; }
  win.document.open(); win.document.write(html); win.document.close();
  if (win.document.readyState === "complete") { win.print(); }
  else { win.addEventListener("load", () => win.print()); }
}
