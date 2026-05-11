// =============================================================================
// ui-table.js — Input table CRUD, drag-reorder, undo deletion, CSV helpers,
//               and collectStudies() data extraction.
//
// Parallel to ui-render.js: this module owns all stateful DOM mutations on
// the #inputTable element.  ui.js imports these functions and calls them on
// DOM events; this module never imports from ui.js.
//
// Dependency injection: call initTable(callbacks) once from ui.js init()
// before any table operations are performed.
// =============================================================================

import { effectProfiles } from "./profiles.js";
import { validateRow, getSoftWarnings } from "./ui-state.js";
import { escapeHTML } from "./utils-html.js";
import { parseCSV, detectEffectType } from "./csv.js";
import { readTextFile } from "./io.js";

// ── Injected callbacks (set by initTable) ────────────────────────────────────
let _cb = {
  markStale:            () => {},
  scheduleSave:         () => {},
  renderRoBDataGrid:    () => {},
  deleteRobEntry:       (_key) => {},
  onModeratorChanged:   () => {},  // called after any moderator add/remove
};

/**
 * Inject dependencies that ui-table.js cannot import without creating a
 * circular dependency.  Call once from ui.js init() before any table use.
 *
 * @param {{ markStale: Function, scheduleSave: Function,
 *           renderRoBDataGrid: Function, deleteRobEntry: Function }} callbacks
 */
export function initTable(callbacks) {
  _cb = { ..._cb, ...callbacks };

  // Keyboard row reorder: Alt+Up / Alt+Down while any cell in a row is focused.
  document.getElementById("inputTable").addEventListener("keydown", e => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const row = e.target.closest("tr");
    if (!row || !row.draggable) return;   // only data rows have draggable=true
    e.preventDefault();
    if (e.key === "ArrowUp") {
      const prev = row.previousElementSibling;
      if (prev && prev.draggable) row.parentNode.insertBefore(row, prev);
    } else {
      const next = row.nextElementSibling;
      if (next && next.draggable) row.parentNode.insertBefore(next, row);
    }
    _cb.markStale();
    _cb.scheduleSave();
  });
}

// =============================================================================
// MODERATOR STATE
// Exported as a live array; callers mutate it in place.  Use clearModerators()
// to reset (splice-in-place so the same reference remains valid for importers).
// =============================================================================

/** @type {{ name: string, type: "continuous"|"categorical", transform: string }[]} */
export const moderators = [];

// ── Moderator DOM helpers ────────────────────────────────────────────────────

export function makeModTh(name) {
  const th = document.createElement("th");
  th.dataset.mod = name;
  th.innerHTML = `${escapeHTML(name)} <button class="remove-mod-btn" data-mod="${escapeHTML(name)}" title="Remove moderator">×</button>`;
  th.querySelector(".remove-mod-btn").addEventListener("click", () => removeModerator(name));
  return th;
}

export function makeModTd(name, type) {
  const td = document.createElement("td");
  td.dataset.mod = name;
  const input = document.createElement("input");
  input.dataset.mod = name;
  input.style.width = "70px";
  input.placeholder = type === "categorical" ? "A/B/…" : "0";
  input.addEventListener("input", () => { _cb.markStale(); _cb.scheduleSave(); });
  td.appendChild(input);
  return td;
}

// ── Moderator CRUD ───────────────────────────────────────────────────────────

/**
 * Low-level: add one moderator to state + DOM.
 * Does not read form inputs; does not call runAnalysis.
 */
export function doAddModerator(name, type, transform = "linear") {
  if (!name || moderators.some(m => m.name === name)) return;
  moderators.push({ name, type, transform });

  const table = document.getElementById("inputTable");
  const headerRow = table.rows[0];
  headerRow.insertBefore(makeModTh(name), headerRow.lastElementChild);

  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    row.insertBefore(makeModTd(name, type), row.lastElementChild);
  }
}

/** Remove a moderator from state and from every table row. */
export function removeModerator(name) {
  moderators.splice(0, moderators.length, ...moderators.filter(m => m.name !== name));
  // Remove any interaction terms that reference this moderator.
  interactions.splice(0, interactions.length, ...interactions.filter(ix => ix.termA !== name && ix.termB !== name));
  const table = document.getElementById("inputTable");
  for (let i = 0; i < table.rows.length; i++) {
    const cell = [...table.rows[i].cells].find(c => c.dataset.mod === name);
    if (cell) cell.remove();
  }
  _cb.onModeratorChanged();
  _cb.markStale();
}

/** Reset all moderators: clears state and removes all [data-mod] DOM elements. */
export function clearModerators() {
  moderators.splice(0);
  interactions.splice(0);
  document.querySelectorAll("[data-mod]").forEach(el => el.remove());
}

// =============================================================================
// INTERACTION TERM STATE
// Derived terms (A×B outer product) — no table column, computed at analysis time.
// =============================================================================

/** @type {{ name: string, termA: string, termB: string }[]} */
export const interactions = [];

/** Add an interaction between two existing moderators (no-op if already exists). */
export function doAddInteraction(termA, termB) {
  const name = `${termA}×${termB}`;
  if (!termA || !termB || termA === termB) return;
  if (interactions.some(ix => ix.name === name)) return;
  interactions.push({ name, termA, termB });
}

/** Remove a single interaction by its composite name. */
export function removeInteraction(name) {
  interactions.splice(0, interactions.length, ...interactions.filter(ix => ix.name !== name));
}

/** Reset all interactions. */
export function clearInteractions() {
  interactions.splice(0);
}

// =============================================================================
// TABLE HEADER
// =============================================================================

/** Rebuild the header row to match the currently selected effect type. */
export function updateTableHeaders() {
  const type = document.getElementById("effectType").value;
  const profile = effectProfiles[type];
  if (!profile) return;

  const table = document.getElementById("inputTable");
  const headerRow = table.rows[0];
  headerRow.innerHTML = "";

  // Study column
  const thStudy = document.createElement("th");
  thStudy.textContent = "Study";
  headerRow.appendChild(thStudy);

  // Effect columns
  profile.inputs.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });

  // Group column
  const thGroup = document.createElement("th");
  thGroup.textContent = "Group";
  headerRow.appendChild(thGroup);

  // Cluster column — inline help button (avoids importing hBtn from ui.js)
  const thCluster = document.createElement("th");
  thCluster.innerHTML = 'Cluster <button class="help-btn" data-help="cluster.id" aria-label="Help: Cluster ID" title="Help">?</button>';
  headerRow.appendChild(thCluster);

  // Moderator columns
  moderators.forEach(({ name }) => headerRow.appendChild(makeModTh(name)));

  // Actions column
  const thActions = document.createElement("th");
  thActions.textContent = "Actions";
  headerRow.appendChild(thActions);
}

// =============================================================================
// DRAG-TO-REORDER
// =============================================================================

let _dragRow        = null;
let _dragPointerSrc = null;

function _rowPointerDown(e) { _dragPointerSrc = e.target; }

function _rowDragStart(e) {
  if (_dragPointerSrc && _dragPointerSrc.matches("input, button, select, textarea")) {
    e.preventDefault();
    return;
  }
  _dragRow = this;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "");
  this.classList.add("row-dragging");
}

function _rowDragOver(e) {
  if (!_dragRow || _dragRow === this) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const rect = this.getBoundingClientRect();
  const aboveMid = e.clientY < rect.top + rect.height / 2;
  this.classList.toggle("drag-over-top",    aboveMid);
  this.classList.toggle("drag-over-bottom", !aboveMid);
}

function _rowDragLeave() {
  this.classList.remove("drag-over-top", "drag-over-bottom");
}

function _rowDrop(e) {
  e.preventDefault();
  if (!_dragRow || _dragRow === this) return;
  const rect = this.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;
  this.parentNode.insertBefore(_dragRow, insertBefore ? this : this.nextSibling);
  this.classList.remove("drag-over-top", "drag-over-bottom");
  _cb.markStale();
  _cb.scheduleSave();
}

function _rowDragEnd() {
  _dragRow?.classList.remove("row-dragging");
  document.querySelectorAll("#inputTable .drag-over-top, #inputTable .drag-over-bottom")
    .forEach(r => r.classList.remove("drag-over-top", "drag-over-bottom"));
  _dragRow = null;
}

// =============================================================================
// ADD ROW
// =============================================================================

/**
 * Append a new study row to #inputTable.
 * @param {string[]} [values]  Optional pre-filled values:
 *   [label, ...effectInputs, group, cluster, ...moderatorValues]
 */
export function addRow(values) {
  const type = document.getElementById("effectType").value;
  const profile = effectProfiles[type];
  if (!profile) return;

  const table = document.getElementById("inputTable");
  const row = table.insertRow();
  row.draggable = true;
  row.addEventListener("pointerdown", _rowPointerDown);
  row.addEventListener("dragstart",   _rowDragStart);
  row.addEventListener("dragover",    _rowDragOver);
  row.addEventListener("dragleave",   _rowDragLeave);
  row.addEventListener("drop",        _rowDrop);
  row.addEventListener("dragend",     _rowDragEnd);

  const v = values || ["", ...Array(profile.inputs.length).fill(""), "", ""];

  // Study column
  const cellStudy = row.insertCell();
  const inputStudy = document.createElement("input");
  inputStudy.value = v[0] || "";
  cellStudy.appendChild(inputStudy);

  // Effect columns
  profile.inputs.forEach((key, idx) => {
    const cell = row.insertCell();
    const input = document.createElement("input");
    input.value = v[idx + 1] || "";
    cell.appendChild(input);
  });

  // Group column
  const groupCell = row.insertCell();
  const groupInput = document.createElement("input");
  groupInput.className = "group";
  groupInput.placeholder = "e.g. A";
  groupInput.value = v[profile.inputs.length + 1] || "";
  groupCell.appendChild(groupInput);

  // Cluster column
  const clusterCell = row.insertCell();
  const clusterInput = document.createElement("input");
  clusterInput.className = "cluster";
  clusterInput.placeholder = "e.g. 1";
  clusterInput.value = v[profile.inputs.length + 2] || "";
  clusterCell.appendChild(clusterInput);

  // Moderator columns
  const modOffset = profile.inputs.length + 3;
  moderators.forEach(({ name, type: mtype }, modIdx) => {
    const td = makeModTd(name, mtype);
    const val = v[modOffset + modIdx];
    if (val !== undefined) td.querySelector("input").value = val;
    row.appendChild(td);
  });

  // Actions
  const actionCell = row.insertCell();
  actionCell.innerHTML = `<button class="remove-btn" aria-label="Remove study">✖</button> <button class="clear-btn" aria-label="Clear row">🧹</button>`;

  // Input listeners
  let _valTimer;
  row.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", () => {
      clearTimeout(_valTimer);
      _valTimer = setTimeout(() => {
        const type = document.getElementById("effectType").value;
        const { studies, excluded, softWarnings } = collectStudies(type);
        updateValidationWarnings(studies, excluded, softWarnings);
        _cb.markStale();
        _cb.scheduleSave();
      }, 150);
    });
  });

  row.querySelector(".remove-btn").addEventListener("click", () => removeRow(row.querySelector(".remove-btn")));
  row.querySelector(".clear-btn").addEventListener("click",  () => clearRow(row.querySelector(".clear-btn")));
}

// =============================================================================
// UNDO DELETION
// One pending deletion at a time.  The row stays in the DOM marked with
// .row-pending-delete (excluded from analysis + session state) until the
// 5-second window expires or the user clicks Undo.
// =============================================================================

const _undoState = { timer: null, row: null, robKey: null };
const _UNDO_MS   = 5000;

let _companionCommit = null;
export function registerDeleteCompanion(fn) { _companionCommit = fn; }

export function commitPendingDelete() {
  if (!_undoState.row) return;
  clearTimeout(_undoState.timer);
  if (_undoState.robKey) _cb.deleteRobEntry(_undoState.robKey);
  _undoState.row.remove();
  _undoState.row    = null;
  _undoState.robKey = null;
  _undoState.timer  = null;
  _cb.renderRoBDataGrid();
  hideUndoToast();
  _companionCommit?.();
}

function _cancelPendingDelete() {
  if (!_undoState.row) return;
  clearTimeout(_undoState.timer);
  _undoState.row.classList.remove("row-pending-delete");
  _undoState.row    = null;
  _undoState.robKey = null;
  _undoState.timer  = null;
  hideUndoToast();
  _cb.markStale();
  _cb.scheduleSave();
}

export function showUndoToast(label, undoFn) {
  const toast = document.getElementById("undoToast");
  const lbl   = document.getElementById("undoToastLabel");
  const btn   = document.getElementById("undoToastBtn");
  const bar   = toast?.querySelector(".undo-toast-bar");
  if (!toast) return;
  if (lbl) lbl.textContent = label ? `"${label}" removed` : "Study removed";
  if (bar) { const newBar = bar.cloneNode(true); bar.replaceWith(newBar); }
  btn.onclick = undoFn;
  toast.hidden = false;
}

export function hideUndoToast() {
  const toast = document.getElementById("undoToast");
  if (toast) toast.hidden = true;
}

// =============================================================================
// REMOVE & CLEAR
// =============================================================================

export function removeRow(btn) {
  const table = document.getElementById("inputTable");
  const nonPending = [...table.rows].filter(r => !r.classList.contains("row-pending-delete")).length;
  if (nonPending <= 2) return; // keep at least 1 data row

  commitPendingDelete();

  const row   = btn.closest("tr");
  const label = row.querySelector("input")?.value?.trim() || "";

  row.classList.add("row-pending-delete");
  _undoState.row    = row;
  _undoState.robKey = label || null;
  _undoState.timer  = setTimeout(commitPendingDelete, _UNDO_MS);

  showUndoToast(label, _cancelPendingDelete);
  _cb.markStale();
  _cb.scheduleSave();
}

export function clearRow(btn) {
  btn.closest("tr").querySelectorAll("input").forEach(input => { input.value = ""; });
  _cb.markStale();
}

// =============================================================================
// VALIDATION WARNINGS (below input table)
// =============================================================================

export function updateValidationWarnings(studies, excluded, softWarnings) {
  const table      = document.getElementById("inputTable");
  const warningDiv = document.getElementById("validationWarnings");
  const rows       = [...table.rows].slice(1);

  const messages    = [];
  const subgroupMap = {};

  // Input errors
  rows.forEach((row, idx) => {
    const label  = row.querySelector("input")?.value || `Row ${idx + 1}`;
    const errors = JSON.parse(row.dataset.validationErrors || "{}");
    Object.entries(errors).forEach(([, msg]) => messages.push(`❌ ${label}: ${msg}`));

    const groupName = row.querySelector(".group")?.value.trim();
    if (groupName) {
      if (!subgroupMap[groupName]) subgroupMap[groupName] = [];
      subgroupMap[groupName].push(label);
    }
  });

  // Subgroup warnings
  Object.entries(subgroupMap).forEach(([group, studiesInGroup]) => {
    if (studiesInGroup.length < 2)
      messages.push(`⚠️ Subgroup "${group}" has <2 studies (${studiesInGroup.join(", ")})`);
  });

  // Excluded studies
  excluded.forEach(e => messages.push(`⚠️ Excluded: ${e.label} (${e.reason})`));

  // Soft warnings
  softWarnings.forEach(w => messages.push(w));

  // Analysis-level warnings
  const k = studies.length;
  if (k === 0) {
    messages.push("❌ No valid studies available for analysis");
  } else {
    if (k < 2) messages.push("⚠️ Fewer than 2 studies: meta-analysis not meaningful");
    if (k < 3) messages.push("⚠️ Egger / Begg / FAT-PET tests require ≥ 3 studies");
    if (studies.some(s => s.vi < 1e-8))
      messages.push("⚠️ One or more studies have extremely small variance (may inflate weights)");
  }

  warningDiv.innerHTML = messages.length > 0
    ? messages.map(m => `• ${m}`).join("<br>")
    : "";
}

// =============================================================================
// COLLECT STUDIES
// Extracted from the top of runAnalysis() so it can be called independently
// and tested in isolation.  This is also the natural first extract for R-1.
// =============================================================================

/**
 * Parse the input table for the given effect type and return structured data.
 *
 * @param {string} type  Effect type key (e.g. "SMD", "OR").
 * @returns {{ studies: object[], excluded: object[], softWarnings: string[],
 *             missingCorrelation: boolean }}
 */
export function collectStudies(type) {
  const profile = effectProfiles[type];
  if (!profile) return { studies: [], excluded: [], softWarnings: [], missingCorrelation: false };

  const rows      = document.querySelectorAll("#inputTable tr");
  const modOffset = profile.inputs.length + 3; // label(1) + effects(p) + group(1) + cluster(1)

  const studies  = [];
  const excluded = [];
  const softWarnings = [];
  let missingCorrelation = false;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.classList.contains("row-pending-delete")) continue;
    const inputs = [...row.querySelectorAll("input")].map(x => x.value);

    const isValid = validateRow(row);

    const group   = row.querySelector(".group")?.value.trim() || "";
    const cluster = row.querySelector(".cluster")?.value.trim() || "";
    const label   = inputs[0] || `Row ${i}`;

    const studyInput = { label };
    profile.inputs.forEach((key, idx) => {
      studyInput[key] = profile.rawInputs?.has(key) ? inputs[idx + 1] : +inputs[idx + 1];
    });

    // Check for missing correlation in paired designs
    if ((type === "MD_paired" || type === "SMD_paired") && !isFinite(studyInput.r)) {
      missingCorrelation = true;
      studyInput.r = 0.5; // fallback assumption
    }

    softWarnings.push(...getSoftWarnings(studyInput, type, label));

    if (!isValid) {
      excluded.push({ label, reason: "Invalid input" });
      continue;
    }

    const study = profile.compute(studyInput);

    if (!isFinite(study.yi) || !isFinite(study.vi)) {
      excluded.push({ label, reason: "Computation failed (invalid effect size or variance)" });
      continue;
    }

    study.group   = group;
    study.cluster = cluster;

    moderators.forEach(({ name, type: mtype }, modIdx) => {
      const raw = (inputs[modOffset + modIdx] ?? "").trim();
      study[name] = mtype === "continuous" ? (raw === "" ? NaN : +raw) : raw;
    });

    studies.push(study);
  }

  return { studies, excluded, softWarnings, missingCorrelation };
}

// =============================================================================
// CSV IMPORT — preview helpers
// classifyColumns and refreshPreviewUI are used by the import preview dialog.
// The full previewCSV / commitImport / cancelImport orchestration lives in
// ui.js alongside detectEffectType and the effect-type selector event handler.
// =============================================================================

/**
 * Classify CSV headers against the chosen effect profile.
 * @returns {{ matched: string[], missing: string[], modCols: string[],
 *             structural: string[], confidence: "full"|"partial"|"none" }}
 */
export function classifyColumns(headers, type) {
  const profile    = effectProfiles[type];
  const required   = new Set(profile.inputs.map(i => i.toLowerCase()));
  const structural = new Set(["study", "group", "cluster"]);
  const lowerHdr   = new Set(headers.map(h => h.toLowerCase()));

  const matched    = profile.inputs.filter(i =>  lowerHdr.has(i.toLowerCase()));
  const missing    = profile.inputs.filter(i => !lowerHdr.has(i.toLowerCase()));
  const modCols    = headers.filter(h => !required.has(h.toLowerCase()) && !structural.has(h.toLowerCase()));
  const structCols = headers.filter(h =>  structural.has(h.toLowerCase()));

  const score      = profile.inputs.length > 0 ? matched.length / profile.inputs.length : 0;
  const confidence = score === 1 ? "full" : score > 0 ? "partial" : "none";

  return { matched, missing, modCols, structural: structCols, confidence };
}

// Cached parsed CSV waiting for user confirmation.
let _pendingImport = null;

export function getPendingImport() { return _pendingImport; }
export function clearPendingImport() { _pendingImport = null; }

/** Rebuild the mapping chips and preview table for the currently selected type. */
export function refreshPreviewUI(type) {
  if (!_pendingImport) return;
  const { headers, rows } = _pendingImport.parsed;
  const cls = classifyColumns(headers, type);

  const confEl = document.getElementById("previewConfidence");
  const isAutoDetected = _pendingImport.tied && type === _pendingImport.detectedType;
  const displayConf    = (isAutoDetected && cls.confidence === "full") ? "tied" : cls.confidence;
  const otherTypes     = (_pendingImport.tiedTypes ?? []).filter(t => t !== type);
  const tiedMsg        = otherTypes.length > 0
    ? `⚠ ambiguous — also matches: ${otherTypes.join(", ")}`
    : "⚠ ambiguous — multiple types match";
  const confText = {
    full:    "✓ all columns matched",
    tied:    tiedMsg,
    partial: "⚠ partial match",
    none:    "✗ no columns matched",
  };
  confEl.textContent = confText[displayConf];
  confEl.className   = `badge-pill conf-${displayConf}`;

  const lowerMatched    = new Set(cls.matched.map(c => c.toLowerCase()));
  const lowerStructural = new Set(cls.structural.map(c => c.toLowerCase()));

  function colClass(h) {
    const hl = h.toLowerCase();
    if (lowerStructural.has(hl)) return "";
    if (lowerMatched.has(hl))    return "col-matched";
    return "col-moderator";
  }

  let chips = "";
  cls.structural.forEach(c => chips += `<span class="badge-pill chip-ignored">${escapeHTML(c)}</span>`);
  cls.matched.forEach(c    => chips += `<span class="badge-pill chip-matched">✓ ${escapeHTML(c)}</span>`);
  cls.missing.forEach(c    => chips += `<span class="badge-pill chip-missing">✗ ${escapeHTML(c)}</span>`);
  cls.modCols.forEach(c    => chips += `<span class="badge-pill chip-moderator">~ ${escapeHTML(c)}</span>`);
  document.getElementById("previewMapping").innerHTML = chips;

  let tbl = '<table class="preview-table"><thead><tr>';
  headers.forEach(h => { tbl += `<th class="${colClass(h)}">${escapeHTML(h)}</th>`; });
  tbl += "</tr></thead><tbody>";
  rows.slice(0, 5).forEach(row => {
    tbl += "<tr>";
    row.forEach(cell => { tbl += `<td>${escapeHTML(cell)}</td>`; });
    tbl += "</tr>";
  });
  tbl += "</tbody></table>";
  document.getElementById("previewTable").innerHTML = tbl;

  const mvHint = document.getElementById("previewMvHint");
  if (mvHint) mvHint.style.display = _pendingImport.mvCandidate ? "" : "none";
}

/** Phase 1 — parse the file and show the preview panel without touching the table. */
export async function previewCSV(file) {
  const warningDiv = document.getElementById("csvWarning");
  warningDiv.style.display = "none";

  let text;
  try { text = await readTextFile(file); }
  catch {
    warningDiv.textContent = "Could not read the selected file.";
    warningDiv.style.display = "block";
    return;
  }

  const parsed = parseCSV(text);

  if (!parsed.headers.length) {
    warningDiv.textContent = "The selected file appears to be empty.";
    warningDiv.style.display = "block";
    return;
  }

  const currentType = document.getElementById("effectType").value;
  const detection   = detectEffectType(parsed.headers, currentType, effectProfiles);

  // Detect multivariate data: study_id/study + outcome_id/outcome + yi + vi
  const lowerHdrs   = new Set(parsed.headers.map(h => h.toLowerCase()));
  const hasStudyCol  = lowerHdrs.has("study_id") || lowerHdrs.has("study");
  const hasOutcomeCol = lowerHdrs.has("outcome_id") || lowerHdrs.has("outcome");
  const mvCandidate  = hasStudyCol && hasOutcomeCol && lowerHdrs.has("yi") && lowerHdrs.has("vi");
  const mvHeaders    = mvCandidate ? {
    studyCol:   parsed.headers.find(h => h.toLowerCase() === "study_id") ??
                parsed.headers.find(h => h.toLowerCase() === "study"),
    outcomeCol: parsed.headers.find(h => h.toLowerCase() === "outcome_id") ??
                parsed.headers.find(h => h.toLowerCase() === "outcome"),
    yiCol:      parsed.headers.find(h => h.toLowerCase() === "yi"),
    viCol:      parsed.headers.find(h => h.toLowerCase() === "vi"),
  } : null;

  _pendingImport = {
    parsed,
    detectedType: detection.type,
    tied:         detection.tied,
    tiedTypes:    detection.tiedTypes ?? [],
    mvCandidate,
    mvHeaders,
  };

  const delimNames = { ",": "comma", ";": "semicolon", "\t": "tab" };
  document.getElementById("previewDelimiter").textContent =
    `delimiter: ${delimNames[parsed.delimiter] ?? parsed.delimiter}`;

  document.getElementById("previewEffectType").value = detection.type;

  refreshPreviewUI(detection.type);
  document.getElementById("importPreview").style.display = "block";
}

/**
 * Phase 2 — commit the parsed CSV to the table.
 * Infers moderators, rebuilds the table, and dismisses the preview.
 * Returns the list of required columns absent from the CSV (may be empty).
 * @returns {string[]} missingCols
 */
export function commitImport() {
  if (!_pendingImport) return [];
  const { headers, rows } = _pendingImport.parsed;

  const type    = document.getElementById("previewEffectType").value;
  const profile = effectProfiles[type];

  const headerMap = {};
  headers.forEach((h, idx) => { headerMap[h.toLowerCase()] = idx; });

  const knownCols = new Set(["study", "group", "cluster", ...profile.inputs.map(c => c.toLowerCase())]);
  const modCols   = headers.filter(h => !knownCols.has(h.toLowerCase()));

  // Infer moderator types and register them
  clearModerators();
  modCols.forEach(col => {
    const ci    = headerMap[col.toLowerCase()];
    const vals  = rows.map(r => r[ci] ?? "").filter(v => v.trim() !== "");
    const mtype = vals.length > 0 && vals.every(v => !isNaN(v.trim())) ? "continuous" : "categorical";
    doAddModerator(col, mtype);
  });

  document.getElementById("effectType").value = type;
  updateTableHeaders();
  const table = document.getElementById("inputTable");
  while (table.rows.length > 1) table.deleteRow(1);

  rows.forEach(values => {
    const v = [];
    v.push(values[headerMap["study"]] ?? "");
    profile.inputs.forEach(col => v.push(values[headerMap[col.toLowerCase()]] ?? ""));
    v.push(values[headerMap["group"]]   ?? "");
    v.push(values[headerMap["cluster"]] ?? "");
    modCols.forEach(col => v.push(values[headerMap[col.toLowerCase()]] ?? ""));
    addRow(v);
  });

  cancelImport();

  return profile.inputs.filter(c => !(c.toLowerCase() in headerMap));
}

/** Dismiss the preview panel and reset the file input. */
export function cancelImport() {
  _pendingImport = null;
  document.getElementById("importPreview").style.display  = "none";
  document.getElementById("csvWarning").style.display     = "none";
  document.getElementById("csvFile").value                = "";
}
