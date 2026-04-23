// =============================================================================
// ui.js — Application controller and DOM layer
// =============================================================================
// Owns all interaction between the user and the rest of the app.  This is the
// only module that reads from or writes to the DOM (aside from plots.js, which
// renders into named SVG elements).
//
// Responsibilities
// ----------------
//   Input table      Build and maintain the study data table; add/remove rows;
//                    validate cells on change; apply CSV imports.
//
//   Settings         Read effect type, τ² method, CI method, cumulative order,
//                    and trim-and-fill toggles from the settings row.
//
//   runAnalysis()    Central orchestration function.  Reads the input table,
//                    calls compute() → meta() → publication-bias tests →
//                    influence diagnostics → all plot renderers, and populates
//                    the results panels.  Returns true on success (used to gate
//                    the Results tab).
//
//   Results panels   Render pooled-estimate text, heterogeneity stats,
//                    subgroup table, leave-one-out table, estimator comparison,
//                    and meta-regression panel from the analysis output.
//
//   Forest nav       Pagination state and FE/RE/Both toggle for the forest plot.
//
//   Import / export  CSV import with preview dialog; CSV export; session
//                    save/load (JSON); HTML report; PDF; per-plot SVG/PNG.
//
//   Autosave         Debounced localStorage draft; recovery banner on reload.
//
//   Help system      Delegated click listener for all .help-btn elements;
//                    popover positioning with viewport clamping.
//
//   Theme            Light/dark toggle; persisted to localStorage.
//
// Architecture
// ============
//
// Module dependency graph  (A → B means A imports from B)
// --------------------------------------------------------
//   ui.js           → analysis.js, profiles.js, trimfill.js, plots.js,
//                     report.js, csv.js, session.js, autosave.js,
//                     export.js, io.js, help.js, utils.js
//   analysis.js     → utils.js, constants.js
//   profiles.js     → utils.js, constants.js
//   trimfill.js     → analysis.js
//   plots.js        → utils.js, constants.js
//   report.js       → plots.js, io.js, constants.js
//   session.js      → profiles.js
//   autosave.js     → session.js
//   export.js       → io.js
//   utils.js        → constants.js
//   csv.js          (no imports — pure functions)
//   io.js           (no imports — browser API wrappers)
//   help.js         (no imports — static content object)
//   constants.js    (no imports — numeric constants only)
//
// Analysis pipeline  (triggered by runAnalysis() on every input change)
// ----------------------------------------------------------------------
//   DOM table rows
//     │  profile.validate()              row-level hard validation
//     │  profile.compute()               raw inputs → { yi, vi, se, w, … }
//     ↓
//   studies[]   { label, yi, vi, se, w, group, moderators, filled? }
//     │  trimFill()  [optional]          appends imputed mirror studies
//     ↓
//   all[]   = studies ∪ imputed
//     │  meta(studies, method, ciMethod)
//     ↓
//   m   { FE, seFE, RE, seRE, ciLow, ciHigh, predLow, predHigh,
//          tau2, tauCI, I2, I2CI, H2CI, Q, stat, pval, df, crit, … }
//     ├─ eggerTest(studies)              → { intercept, se, p }
//     ├─ beggTest(studies)               → { tau, p }
//     ├─ fatPetTest(studies)             → { slope, intercept, … }
//     ├─ failSafeN(studies)              → { rosenthal, orwin }
//     ├─ influenceDiagnostics(…)         → influence[]
//     ├─ subgroupAnalysis(…)             → { groups, Qbetween, … }
//     ├─ metaRegression(…)               → reg{}
//     ├─ cumulativeMeta(…)               → cumResults[]
//     └─ draw*(studies/m/…)              → SVG elements written to DOM
//
//   forestPlot.args / appState.reportArgs are cached after each run so that forest
//   pagination, FE/RE toggle, and report export can re-use the last
//   analysis result without re-running the pipeline.
//
// Persistence layer
// -----------------
//   localStorage["meta-draft"]   autosave.js  — survives tab/browser close
//   localStorage["theme"]        ui.js        — light/dark preference
//   <input type="file"> (hidden) csv.js       — CSV import
//   Blob download                io.js        — CSV export, session JSON,
//                                               HTML report, SVG, PNG
//
// Entry point
// -----------
//   index.html loads ui.js as <script type="module">; no bundler.
//   All other modules are resolved by the browser via native ES imports.
//   ui.js calls init() on DOMContentLoaded, which populates dropdowns,
//   restores any autosave draft, and attaches all event listeners.
// =============================================================================
import { eggerTest, beggTest, fatPetTest, petPeeseTest, failSafeN, tesTest, waapWls, pCurve, pUniform, baujat, blupMeta, meta, metaMH, metaPeto, robustMeta, influenceDiagnostics, subgroupAnalysis, metaRegression, cumulativeMeta, leaveOneOut, estimatorComparison, veveaHedges, SELECTION_PRESETS, profileLikTau2, bayesMeta, priorSensitivity, rvePooled, meta3level, harbordTest, petersTest, deeksTest, rueckerTest, lsModel, adjustPvals, henmiCopas } from "./analysis.js";
import { fmt, normalQuantile } from "./utils.js";
import { effectProfiles, getProfile } from "./profiles.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel, drawBubble, drawPartialResidualBubble, drawInfluencePlot, drawCumulativeForest, drawCumulativeFunnel, drawPCurve, drawPUniform, drawOrchardPlot, drawCaterpillarPlot, drawBlupPlot, drawBaujatPlot, drawLabbe, drawRoBTrafficLight, drawRoBSummary, drawGoshPlot, drawProfileLikTau2, drawBayesTauPosterior, drawBayesMuPosterior, drawQQPlot, drawRadialPlot } from "./plots.js";
import { goshCompute, GOSH_MAX_K } from "./gosh.js";
import { exportSVG, exportPNG, exportTIFF } from "./export.js";
import { buildReport, downloadHTML, openPrintPreview } from "./report.js";
import { buildDocx } from "./docx.js";
import { parseCSV, detectEffectType } from "./csv.js";
import { buildSession, serializeSession, parseSession, missingInputCols } from "./session.js";
import { saveDraft, loadDraft, clearDraft } from "./autosave.js";
import { downloadBlob, readTextFile, serializeCSV } from "./io.js";
import { HELP } from "./help.js";
import { renderGuide, HELP_TO_GUIDE } from "./guide.js";
import { Z_95 } from "./constants.js";

// ---------------- AUTOSAVE ----------------

let _saveTimer = null;

// scheduleSave()
// Debounced autosave trigger. Resets the 1.2 s idle timer on every call; the
// actual save fires once the user pauses for 1.2 s. Does NOT call runAnalysis()
// — analysis is triggered separately by the callers.
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveDraft(gatherSessionState()), 1200);
}

// ---------------- DEBOUNCED ANALYSIS ----------------

let _analysisRunning = false;

// Flush any pending debounced save immediately.
// Called on beforeunload and visibilitychange so changes made in the last
// 1.2 s before tab close/backgrounding are not lost.
function flushSave() {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  saveDraft(gatherSessionState());
}

window.addEventListener("beforeunload", flushSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
});

// ---------------- SHARED HELPERS ----------------
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------- HELP POPOVER ----------------

const _helpPopover = document.getElementById("helpPopover");
const _helpTitle   = document.getElementById("helpPopoverTitle");
const _helpBody    = document.getElementById("helpPopoverBody");

const _helpGuideLink = document.getElementById("helpPopoverGuideLink");

function showHelp(anchorEl, key) {
  const entry = HELP[key];
  if (!entry) return;

  _helpTitle.textContent = entry.title;
  _helpBody.textContent  = entry.body;

  // Show/hide "More detail →" cross-link to guide
  const guideId = HELP_TO_GUIDE[key];
  if (guideId) {
    _helpGuideLink.style.display = "";
    _helpGuideLink.onclick = (e) => {
      e.preventDefault();
      hideHelp();
      showView("guide");
      // After guide renders, scroll to the target topic
      requestAnimationFrame(() => {
        const el = document.getElementById(guideId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
  } else {
    _helpGuideLink.style.display = "none";
  }

  _helpPopover.style.display = "block";

  // Position below the anchor, clamped to viewport.
  const rect     = anchorEl.getBoundingClientRect();
  const popW     = _helpPopover.offsetWidth  || 320;
  const popH     = _helpPopover.offsetHeight || 120;
  const margin   = 8;

  let top  = rect.bottom + margin;
  let left = rect.left;

  // Clamp horizontally so the popover doesn't overflow the right edge.
  if (left + popW > window.innerWidth - margin)
    left = window.innerWidth - popW - margin;
  if (left < margin) left = margin;

  // If it would overflow the bottom, flip above the anchor.
  if (top + popH > window.innerHeight - margin)
    top = rect.top - popH - margin;

  // position: fixed — coordinates are already viewport-relative, no scroll offset needed.
  _helpPopover.style.top  = `${top}px`;
  _helpPopover.style.left = `${left}px`;
}

function hideHelp() {
  _helpPopover.style.display = "none";
}

// Close on any click outside the popover, but not when clicking a help button
// (those are handled by the click toggle below).
document.addEventListener("pointerdown", e => {
  if (_helpPopover.style.display !== "none"
      && !_helpPopover.contains(e.target)
      && !e.target.closest(".help-btn"))
    hideHelp();
});

// Single delegated listener for all .help-btn clicks.
// Buttons may use either:
//   data-help="KEY"                          — fixed key
//   data-help-select="selectId"
//   data-help-prefix="prefix."              — key = prefix + select.value (resolved at click time)
document.addEventListener("click", e => {
  const btn = e.target.closest(".help-btn");
  if (!btn) return;
  e.stopPropagation();

  let key;
  if (btn.dataset.helpSelect) {
    const sel    = document.getElementById(btn.dataset.helpSelect);
    const prefix = btn.dataset.helpPrefix ?? "";
    const value  = sel ? sel.value : "";
    key = prefix + value;
    if (!HELP[key]) {
      console.warn(`help-btn: no HELP entry for key "${key}" (select="${btn.dataset.helpSelect}", prefix="${prefix}", value="${value}")`);
      return;
    }
  } else {
    key = btn.dataset.help;
    if (!HELP[key]) {
      console.warn(`help-btn: no HELP entry for key "${key}"`);
      return;
    }
  }

  // Toggle: clicking the same button again closes the popover.
  if (_helpPopover.style.display !== "none" &&
      _helpPopover.dataset.activeKey === key) {
    hideHelp();
  } else {
    _helpPopover.dataset.activeKey = key;
    showHelp(btn, key);
  }
});

// Convenience: inline help button for injected HTML strings.
function hBtn(key) {
  return `<button class="help-btn" data-help="${key}" title="Help">?</button>`;
}

// ---------------- MODERATOR STATE ----------------
let moderators = []; // { name: string, type: "continuous"|"categorical", transform: string }
let scaleModerators = []; // { name: string, type: "continuous"|"categorical", transform: string }

// ---- Risk-of-bias state ----
let _robDomains = [];  // string[] — ordered domain names
let _robData    = {};  // { [studyLabel]: { [domain]: "Low"|"Some concerns"|"High"|"NI"|"" } }

// Low-level: add one moderator to state + DOM (no form read, no runAnalysis call).
function doAddModerator(name, type, transform = "linear") {
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

// Reset all moderators — clears state and removes all data-mod DOM elements.
function clearModerators() {
  moderators = [];
  document.querySelectorAll("[data-mod]").forEach(el => el.remove());
}

function addModerator() {
  const nameEl = document.getElementById("modName");
  const name = nameEl.value.trim();
  const type = document.getElementById("modType").value;
  const transform = type === "continuous"
    ? (document.getElementById("modTransform")?.value ?? "linear")
    : "linear";
  if (!name) return;
  doAddModerator(name, type, transform);
  nameEl.value = "";
  markStale();
}

function removeModerator(name) {
  moderators = moderators.filter(m => m.name !== name);
  const table = document.getElementById("inputTable");
  for (let i = 0; i < table.rows.length; i++) {
    const cell = [...table.rows[i].cells].find(c => c.dataset.mod === name);
    if (cell) cell.remove();
  }
  markStale();
}

function makeModTh(name) {
  const th = document.createElement("th");
  th.dataset.mod = name;
  th.innerHTML = `${name} <button class="remove-mod-btn" data-mod="${name}" title="Remove moderator">×</button>`;
  th.querySelector(".remove-mod-btn").addEventListener("click", () => removeModerator(name));
  return th;
}

function makeModTd(name, type) {
  const td = document.createElement("td");
  td.dataset.mod = name;
  const input = document.createElement("input");
  input.dataset.mod = name;
  input.style.width = "70px";
  input.placeholder = type === "categorical" ? "A/B/…" : "0";
  input.addEventListener("input", () => { markStale(); scheduleSave(); });
  td.appendChild(input);
  return td;
}

// ---- Scale moderator manager (location-scale model) ----

function renderScaleModTags() {
  const container = document.getElementById("scaleModTags");
  if (!container) return;
  container.innerHTML = "";
  scaleModerators.forEach(({ name }) => {
    const span = document.createElement("span");
    span.className = "mod-tag";
    span.innerHTML = `${name} <button class="remove-mod-btn" title="Remove scale moderator">×</button>`;
    span.querySelector("button").addEventListener("click", () => removeScaleModerator(name));
    container.appendChild(span);
  });
}

function doAddScaleModerator(name, type, transform = "linear") {
  if (!name || scaleModerators.some(m => m.name === name)) return;
  scaleModerators.push({ name, type, transform });
  renderScaleModTags();
}

function removeScaleModerator(name) {
  scaleModerators = scaleModerators.filter(m => m.name !== name);
  renderScaleModTags();
  markStale();
}

function addScaleModerator() {
  const nameEl = document.getElementById("scaleModName");
  const name = nameEl.value.trim();
  const type = document.getElementById("scaleModType").value;
  const transform = type === "continuous"
    ? (document.getElementById("scaleModTransform")?.value ?? "linear")
    : "linear";
  if (!name) return;
  doAddScaleModerator(name, type, transform);
  nameEl.value = "";
  markStale();
}

// ---- Risk-of-bias domain manager ----

function _applyRoBClass(selectEl, value) {
  selectEl.className = "";
  if      (value === "Low")            selectEl.className = "rob-rating-low";
  else if (value === "Some concerns")  selectEl.className = "rob-rating-some";
  else if (value === "High")           selectEl.className = "rob-rating-high";
  else if (value === "NI")             selectEl.className = "rob-rating-ni";
}

function renderRoBDomainTags() {
  const container = document.getElementById("robDomainTags");
  container.innerHTML = "";
  _robDomains.forEach(name => {
    const tag = document.createElement("span");
    tag.className = "rob-domain-tag";
    tag.textContent = name + " ";
    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.setAttribute("aria-label", `Remove ${name}`);
    btn.addEventListener("click", () => removeRoBDomain(name));
    tag.appendChild(btn);
    container.appendChild(tag);
  });
}

function renderRoBDataGrid() {
  const container = document.getElementById("robDataGrid");
  container.innerHTML = "";

  if (_robDomains.length === 0) { container.style.display = "none"; return; }

  // Collect current (non-empty) study labels from the input table.
  const labels = [];
  document.querySelectorAll("#inputTable tr").forEach((row, i) => {
    if (i === 0) return;
    const label = row.querySelector("input")?.value?.trim();
    if (label) labels.push(label);
  });

  if (labels.length === 0) { container.style.display = "none"; return; }

  container.style.display = "";

  const table = document.createElement("table");

  // Header
  const hrow = table.createTHead().insertRow();
  const th0 = document.createElement("th");
  th0.textContent = "Study";
  hrow.appendChild(th0);
  _robDomains.forEach(domain => {
    const th = document.createElement("th");
    th.textContent = domain;
    hrow.appendChild(th);
  });

  // Study rows
  const tbody = table.createTBody();
  labels.forEach(label => {
    const row = tbody.insertRow();
    const td0 = row.insertCell();
    td0.textContent = label;
    td0.className = "rob-study-label";

    _robDomains.forEach(domain => {
      const td = row.insertCell();
      const sel = document.createElement("select");
      ["", "Low", "Some concerns", "High", "NI"].forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt || "—";
        sel.appendChild(o);
      });
      const current = _robData[label]?.[domain] ?? "";
      sel.value = current;
      _applyRoBClass(sel, current);

      sel.addEventListener("change", () => {
        if (!_robData[label]) _robData[label] = {};
        _robData[label][domain] = sel.value;
        _applyRoBClass(sel, sel.value);
        markStale();
        scheduleSave();
      });

      td.appendChild(sel);
    });
  });

  container.appendChild(table);
}

function addRoBDomain() {
  const input = document.getElementById("robDomainInput");
  const name  = input.value.trim();
  if (!name || _robDomains.includes(name)) return;
  _robDomains.push(name);
  input.value = "";
  renderRoBDomainTags();
  renderRoBDataGrid();
  markStale();
  scheduleSave();
}

function removeRoBDomain(name) {
  _robDomains = _robDomains.filter(d => d !== name);
  Object.values(_robData).forEach(ratings => { delete ratings[name]; });
  renderRoBDomainTags();
  renderRoBDataGrid();
  markStale();
  scheduleSave();
}

document.getElementById("addRobDomain").addEventListener("click", addRoBDomain);
document.getElementById("robDomainInput").addEventListener("keydown", e => {
  if (e.key === "Enter") addRoBDomain();
});

// ---------------- VIEW TOGGLE ----------------

// ---------------- THEME TOGGLE ----------------

const _themeToggle = document.getElementById("themeToggle");

function _applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isLight = theme === "light";
  _themeToggle.textContent = isLight ? "☾" : "☀";
  _themeToggle.title       = isLight ? "Switch to dark mode" : "Switch to light mode";
}

// On load: honour localStorage, fall back to OS preference.
_applyTheme(
  localStorage.getItem("theme") ??
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);

_themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("theme", next);
  _applyTheme(next);
  if (funnelPlot.args && funnelPlot.contours) {
    drawFunnel(...funnelPlot.args, { contours: true, petpeese: funnelPlot.petpeese });
  }
});

// ---------------- VIEW TOGGLE ----------------

const _inputSection  = document.getElementById("inputSection");
const _outputSection = document.getElementById("outputSection");
const _guideSection  = document.getElementById("guideSection");
const _aboutSection  = document.getElementById("aboutSection");
const _toggleInput   = document.getElementById("toggleInput");
const _toggleResults = document.getElementById("toggleResults");
const _toggleGuide   = document.getElementById("toggleGuide");
const _toggleAbout   = document.getElementById("toggleAbout");

const PERF_LOG = new URLSearchParams(location.search).has("perf");

function getCiAlpha() {
  const v = document.getElementById("ciLevel")?.value ?? "95";
  return { "90": 0.10, "95": 0.05, "99": 0.01 }[v] ?? 0.05;
}
function getCiLabel() {
  return (document.getElementById("ciLevel")?.value ?? "95") + "% CI";
}

function showView(name) {
  _inputSection.style.display  = name === "input"   ? "" : "none";
  _outputSection.style.display = name === "results" ? "" : "none";
  _guideSection.style.display  = name === "guide"   ? "" : "none";
  _aboutSection.style.display  = name === "about"   ? "" : "none";
  _toggleInput.classList.toggle("active",   name === "input");
  _toggleResults.classList.toggle("active", name === "results");
  _toggleGuide.classList.toggle("active",   name === "guide");
  _toggleAbout.classList.toggle("active",   name === "about");
  document.getElementById("appLayout").scrollTo(0, 0);
  if (name === "guide") renderGuide(document.getElementById("guidePanel"));
  // Hide jump pill when leaving results view (safe: getElementById avoids TDZ on module init)
  if (name !== "results") document.getElementById("jumpPill")?.classList.remove("visible");
}

_toggleResults.disabled = true;

_toggleInput.addEventListener("click",   () => showView("input"));
_toggleResults.addEventListener("click", () => { if (!_toggleResults.disabled) showView("results"); });
_toggleGuide.addEventListener("click",   () => showView("guide"));
_toggleAbout.addEventListener("click",   () => showView("about"));

// Show input view by default; output hidden until first run switches to it.
showView("input");

// ---------------- INITIALIZE ----------------
document.getElementById("addStudy").addEventListener("click", () => { addRow(); renderRoBDataGrid(); markStale(); });
document.getElementById("run").addEventListener("click", async () => { if (await runAnalysis()) showView("results"); });
document.getElementById("import").addEventListener("click", () => document.getElementById("csvFile").click());
document.getElementById("csvFile").addEventListener("change", e => { if (e.target.files[0]) previewCSV(e.target.files[0]); });
document.getElementById("previewImport").addEventListener("click", commitImport);
document.getElementById("previewCancel").addEventListener("click", cancelImport);
document.getElementById("previewEffectType").addEventListener("change", e => refreshPreviewUI(e.target.value));
document.getElementById("export").addEventListener("click", exportCSV);
document.getElementById("saveSession").addEventListener("click", saveSession);
document.getElementById("loadSession").addEventListener("click", () => document.getElementById("sessionFile").click());
document.getElementById("sessionFile").addEventListener("change", e => { if (e.target.files[0]) { loadSession(e.target.files[0]); e.target.value = ""; } });
document.getElementById("addMod").addEventListener("click", addModerator);
document.getElementById("modName").addEventListener("keydown", e => { if (e.key === "Enter") addModerator(); });
document.getElementById("addScaleMod").addEventListener("click", addScaleModerator);
document.getElementById("scaleModName").addEventListener("keydown", e => { if (e.key === "Enter") addScaleModerator(); });
document.getElementById("cumulativeOrder").addEventListener("change", markStale);
document.getElementById("cumulativeFunnelStep").addEventListener("input", e => {
  if (!cumFunnelPlot.studies) return;
  const step = +e.target.value;
  _updateCumFunnelLabel(step);
  drawCumulativeFunnel(cumFunnelPlot.studies, cumFunnelPlot.results, cumFunnelPlot.profile, step);
});
document.getElementById("caterpillarPageSize").addEventListener("change", () => {
  if (!caterpillarPlot.args) return;
  caterpillarPlot.page = 0;
  const raw = document.getElementById("caterpillarPageSize").value;
  caterpillarPlot.args.pageSize = raw === "Infinity" ? Infinity : +raw;
  const { totalPages } = drawCaterpillarPlot(
    caterpillarPlot.args.studies, caterpillarPlot.args.m, caterpillarPlot.args.profile,
    { pageSize: caterpillarPlot.args.pageSize, page: caterpillarPlot.page }
  );
  renderCaterpillarNav(totalPages);
  if (appState.reportArgs?.caterpillarOptions) {
    appState.reportArgs = { ...appState.reportArgs, caterpillarOptions: { ...appState.reportArgs.caterpillarOptions, pageSize: caterpillarPlot.args.pageSize, currentPage: 0 } };
  }
});

document.getElementById("cumulativeForestPageSize").addEventListener("change", () => {
  if (!cumForestPlot.args) return;
  cumForestPlot.page = 0;
  const raw = document.getElementById("cumulativeForestPageSize").value;
  cumForestPlot.args.pageSize = raw === "Infinity" ? Infinity : +raw;
  const { totalPages } = drawCumulativeForest(
    cumForestPlot.args.results, cumForestPlot.args.profile,
    { pageSize: cumForestPlot.args.pageSize, page: cumForestPlot.page }
  );
  renderCumulativeForestNav(totalPages);
  if (appState.reportArgs?.cumForestOptions) {
    appState.reportArgs = { ...appState.reportArgs, cumForestOptions: { ...appState.reportArgs.cumForestOptions, pageSize: cumForestPlot.args.pageSize, currentPage: 0 } };
  }
});

document.getElementById("forestPageSize").addEventListener("change", () => {
  if (!forestPlot.args) return;
  forestPlot.page = 0;
  const rawPageSize = document.getElementById("forestPageSize").value;
  const pageSize    = rawPageSize === "Infinity" ? Infinity : +rawPageSize;
  forestPlot.args.options = { ...forestPlot.args.options, pageSize, theme: forestPlot.theme };
  if (appState.reportArgs) {
    appState.reportArgs = { ...appState.reportArgs, forestOptions: { ...appState.reportArgs.forestOptions, pageSize, currentPage: 0 } };
  }
  const { totalPages } = drawForest(
    forestPlot.args.studies, forestPlot.args.m,
    { ...forestPlot.args.options, page: forestPlot.page }
  );
  renderForestNav(totalPages);
});

// ---------------- KEYBOARD SHORTCUTS ----------------
// Ctrl/Cmd+Enter       — run analysis, switch to results
// Ctrl/Cmd+Shift+C     — clear all study rows
// Escape               — close help popover
// ← / → (results view) — paginate forest plot
document.addEventListener("keydown", e => {
  const tag = (document.activeElement?.tagName ?? "").toUpperCase();
  const inEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    || document.activeElement?.isContentEditable;

  // Ctrl/Cmd+Enter — run and show results
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "Enter") {
    e.preventDefault();
    runAnalysis().then(ok => { if (ok) showView("results"); });
    return;
  }

  // Ctrl/Cmd+Shift+C — clear all study rows
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "c")) {
    e.preventDefault();
    const table = document.getElementById("inputTable");
    while (table.rows.length > 1) table.deleteRow(1);
    addRow();
    runAnalysis();
    scheduleSave();
    return;
  }

  // Escape — close help popover
  if (e.key === "Escape") {
    hideHelp();
    return;
  }

  // Arrow keys — paginate forest plot (results view only, not in text inputs)
  if (inEditable) return;
  if (_outputSection.style.display === "none") return;

  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    const btn = document.getElementById("forestNext");
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    const btn = document.getElementById("forestPrev");
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  }
});

// ---------------- JUMP PILL ----------------
// Compact floating nav (bottom-right) that lists visible results panels.
// Appears when the user scrolls the results view; auto-hides after 3 s.

const _jumpPill  = document.getElementById("jumpPill");
const _appLayout = document.getElementById("appLayout");
let   _jumpHideTimer = null;

function _buildJumpPill() {
  if (!_jumpPill) return;
  _jumpPill.innerHTML = "";
  const panels = document.querySelectorAll(".results-section");
  let count = 0;
  panels.forEach(panel => {
    if (panel.style.display === "none") return;
    const summary = panel.querySelector("summary");
    if (!summary) return;
    // Read label text (exclude the .panel-run-at badge and the ::after chevron)
    let label = "";
    summary.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) label += node.textContent;
      else if (node.nodeName !== "SPAN") label += node.textContent;  // skip badge
    });
    label = label.trim() || summary.textContent.trim();
    const btn = document.createElement("button");
    btn.className = "jump-pill-btn";
    btn.textContent = label;
    btn.title = label;
    btn.addEventListener("click", () => {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      _hidePillSoon(200);   // short delay so user sees the pill react
    });
    _jumpPill.appendChild(btn);
    count++;
  });
  if (count === 0) {
    _jumpPill.hidden = true;
  } else {
    _jumpPill.hidden = false;
    _jumpPill.classList.remove("visible");  // start hidden until scroll
  }
}

function _showPill() {
  if (!_jumpPill || _jumpPill.hidden) return;
  if (_outputSection.style.display === "none") return;
  _jumpPill.classList.add("visible");
  clearTimeout(_jumpHideTimer);
  _jumpHideTimer = setTimeout(_hidePill, 3000);
}

function _hidePill() {
  _jumpPill?.classList.remove("visible");
}

function _hidePillSoon(delay = 800) {
  clearTimeout(_jumpHideTimer);
  _jumpHideTimer = setTimeout(_hidePill, delay);
}

// Highlight the button for the panel nearest the top of the viewport
function _updateJumpActive() {
  if (!_jumpPill || !_jumpPill.classList.contains("visible")) return;
  const panels = [...document.querySelectorAll(".results-section")]
    .filter(p => p.style.display !== "none");
  const scrollTop = _appLayout.scrollTop;
  const layoutTop = _appLayout.getBoundingClientRect().top;
  let bestIdx = 0, bestDist = Infinity;
  panels.forEach((p, i) => {
    const rect = p.getBoundingClientRect();
    const dist = Math.abs(rect.top - layoutTop);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  });
  const btns = _jumpPill.querySelectorAll(".jump-pill-btn");
  btns.forEach((b, i) => b.classList.toggle("jump-active", i === bestIdx));
}

if (_appLayout) {
  _appLayout.addEventListener("scroll", () => {
    _showPill();
    _updateJumpActive();
  }, { passive: true });
}

// ---------------- DRAFT BANNER ----------------

function relativeTime(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function showDraftBanner(savedAt) {
  const banner = document.getElementById("draftBanner");
  const text   = document.getElementById("draftBannerText");
  text.textContent = "Draft restored" + (savedAt ? " · saved " + relativeTime(savedAt) : "");
  banner.style.display = "";
}

function hideDraftBanner() {
  document.getElementById("draftBanner").style.display = "none";
}

document.getElementById("draftDismiss").addEventListener("click", hideDraftBanner);

document.getElementById("draftStartFresh").addEventListener("click", () => {
  clearDraft();
  clearModerators();
  _robDomains = [];
  _robData    = {};
  renderRoBDomainTags();
  renderRoBDataGrid();
  updateTableHeaders();
  const table = document.getElementById("inputTable");
  while (table.rows.length > 1) table.deleteRow(1);
  addRow();
  hideDraftBanner();
});

// Draft restore is handled inside init() — see below.

// ---------------- PLOT EXPORT ----------------
// ---------------- REPORT EXPORT BUTTONS ----------------
// buildReport internally re-renders every forest page into a hidden element
// then restores the live view.  After it returns we re-render the live forest
// at the currently-viewed page and re-sync the nav, because buildReport has no
// access to renderForestNav.
function buildReportAndResync() {
  if (!appState.reportArgs) return null;
  // Ensure all lazily-deferred plots have been drawn before SVGs are serialised.
  flushDeferredDraws();
  // Pass the live forestPlot.page so the restore inside collectForestSVGs lands on
  // the correct page rather than always page 0 (which was the value at cache time).
  const args = {
    ...appState.reportArgs,
    forestOptions:     { ...appState.reportArgs.forestOptions, currentPage: forestPlot.page },
    cumForestOptions:  appState.reportArgs.cumForestOptions
      ? { ...appState.reportArgs.cumForestOptions, currentPage: cumForestPlot.page }
      : undefined,
    caterpillarOptions: appState.reportArgs.caterpillarOptions
      ? { ...appState.reportArgs.caterpillarOptions, currentPage: caterpillarPlot.page }
      : undefined,
    // Use the live goshState so a re-run after the last analysis is captured.
    gosh:     goshState.result ?? appState.reportArgs.gosh,
    goshXAxis: document.getElementById("goshXAxis")?.value ?? appState.reportArgs.goshXAxis ?? "I2",
    apaFormat: true,
  };
  const html = buildReport(args);
  // Re-render the live forest at the current page and re-sync nav buttons.
  if (forestPlot.args) {
    const { totalPages } = drawForest(
      forestPlot.args.studies, forestPlot.args.m,
      { ...forestPlot.args.options, page: forestPlot.page }
    );
    renderForestNav(totalPages);
  }
  return html;
}

document.getElementById("exportReportHTML").addEventListener("click", () => {
  const html = buildReportAndResync();
  if (html) downloadHTML(html);
});

document.getElementById("exportReportPDF").addEventListener("click", () => {
  const html = buildReportAndResync();
  if (html) openPrintPreview(html);
});

document.getElementById("exportReportDOCX").addEventListener("click", async () => {
  if (!appState.reportArgs) return;
  // Ensure all lazily-deferred plots have been drawn before SVGs are serialised.
  flushDeferredDraws();
  const args = {
    ...appState.reportArgs,
    forestOptions:      { ...appState.reportArgs.forestOptions, currentPage: forestPlot.page },
    cumForestOptions:   appState.reportArgs.cumForestOptions
      ? { ...appState.reportArgs.cumForestOptions,   currentPage: cumForestPlot.page }
      : undefined,
    caterpillarOptions: appState.reportArgs.caterpillarOptions
      ? { ...appState.reportArgs.caterpillarOptions, currentPage: caterpillarPlot.page }
      : undefined,
    gosh:     goshState.result ?? appState.reportArgs.gosh,
    goshXAxis: document.getElementById("goshXAxis")?.value ?? appState.reportArgs.goshXAxis ?? "I2",
    apaFormat: true,   // Word export is always APA
  };
  const btn = document.getElementById("exportReportDOCX");
  btn.disabled = true;
  btn.textContent = "Building\u2026";
  try {
    const blob = await buildDocx(args);
    downloadBlob(blob, "meta-analysis-report.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  } catch (e) {
    console.error("Export Word failed:", e);
    btn.textContent = "Export failed";
    setTimeout(() => { btn.textContent = "Export Word"; }, 3000);
    return;
  } finally {
    btn.disabled = false;
    if (btn.textContent === "Building\u2026") btn.textContent = "Export Word";
  }
});

// Single delegated listener covers all static plot-export buttons and any
// bubble-plot buttons injected dynamically during runAnalysis.
document.addEventListener("click", e => {
  const btn = e.target.closest(".export-btn");
  if (!btn) return;
  const svgEl = document.getElementById(btn.dataset.target);
  if (!svgEl) return;
  const name = btn.dataset.target;
  if      (btn.dataset.format === "svg")  exportSVG(svgEl,  name + ".svg");
  else if (btn.dataset.format === "png")  exportPNG(svgEl,  name + ".png",  appState.exportScale);
  else if (btn.dataset.format === "tiff") exportTIFF(svgEl, name + ".tif",  appState.exportScale);
});

// ---------------- EFFECT TYPE HANDLER ----------------
document.getElementById("effectType").addEventListener("change", () => {
  const type = document.getElementById("effectType").value;
  updateTableHeaders();
  syncMHOptions(type);

  // Populate example data for testing
  populateExampleData(type);

  markStale();
});

document.getElementById("tauMethod").addEventListener("change", () => {
  const type = document.getElementById("effectType").value;
  syncMHOptions(type);
  markStale();
});
document.getElementById("ciMethod").addEventListener("change", () => {
  const ciSel  = document.getElementById("ciMethod");
  const tauSel = document.getElementById("tauMethod");
  // If PL is chosen but τ² is not likelihood-based, auto-switch τ² to REML.
  if (ciSel.value === "PL" && tauSel.value !== "REML" && tauSel.value !== "ML") {
    tauSel.value = "REML";
  }
  syncPLAvailability();
  markStale();
});
document.getElementById("ciLevel").addEventListener("change", () => { scheduleAutosave(); markStale(); });

const trimFillCheckbox = document.getElementById("useTrimFill");
const adjustedCheckbox = document.getElementById("useTFAdjusted");
const tfEstimatorSelect = document.getElementById("tfEstimator");
adjustedCheckbox.disabled = !trimFillCheckbox.checked;
tfEstimatorSelect.disabled = !trimFillCheckbox.checked;
trimFillCheckbox.addEventListener("change", () => {
  adjustedCheckbox.disabled = !trimFillCheckbox.checked;
  tfEstimatorSelect.disabled = !trimFillCheckbox.checked;
  if (!trimFillCheckbox.checked) adjustedCheckbox.checked = false;
  markStale();
});
adjustedCheckbox.addEventListener("change", markStale);
document.getElementById("tfEstimator").addEventListener("change", markStale);

// ---------------- SELECTION MODEL CONTROLS ----------------
function syncSelControls() {
  const mode   = document.getElementById("selMode").value;
  const preset = document.getElementById("selPreset").value;
  const presetRow  = document.getElementById("selPresetRow");
  const customRow  = document.getElementById("selCustomRow");

  const isSensitivity = mode === "sensitivity";
  presetRow.style.display  = isSensitivity ? "" : "none";
  // Show sides/cuts when MLE, or when sensitivity with custom preset
  const showCustom = !isSensitivity || preset === "custom";
  customRow.style.display  = showCustom ? "" : "none";

  // When a named preset is selected, mirror its sides into the (hidden) selSides field
  if (isSensitivity && preset !== "custom") {
    const p = SELECTION_PRESETS[preset];
    if (p) document.getElementById("selSides").value = String(p.sides);
  }
}

document.getElementById("selMode").addEventListener("change", () => { syncSelControls(); markStale(); });
document.getElementById("selPreset").addEventListener("change", () => { syncSelControls(); markStale(); });
document.getElementById("selSides").addEventListener("change", markStale);
document.getElementById("selCuts").addEventListener("change", markStale);
syncSelControls();

// ---------------- RVE ρ SLIDER ----------------
{
  const rveRhoSlider  = document.getElementById("rveRho");
  const rveRhoDisplay = document.getElementById("rveRhoDisplay");
  const syncRhoDisplay = () => {
    rveRhoDisplay.textContent = parseFloat(rveRhoSlider.value).toFixed(2);
  };
  syncRhoDisplay();
  rveRhoSlider.addEventListener("input",  syncRhoDisplay);
  rveRhoSlider.addEventListener("change", markStale);
}

// ---------------- GOSH ----------------
document.getElementById("goshRun").addEventListener("click", runGosh);

// ---------------- PROFILE LIKELIHOOD SCALE TOGGLE ----------------
document.getElementById("profileLikScale").addEventListener("change", () => {
  if (appState.reportArgs?.profileLik) {
    const xScale = document.getElementById("profileLikScale").value;
    drawProfileLikTau2(appState.reportArgs.profileLik, { xScale });
    appState.reportArgs.profileLikXScale = xScale;
  }
});

// ---------------- TABLE HEADER ----------------
function updateTableHeaders() {
  const type = document.getElementById("effectType").value;
  const profile = effectProfiles[type];
  if (!profile) return;

  const table = document.getElementById("inputTable");
  const headerRow = table.rows[0];
  headerRow.innerHTML = "";

	// Add Study column first
	const thStudy = document.createElement("th");
	thStudy.textContent = "Study";
	headerRow.appendChild(thStudy);

  // Add effect columns
  profile.inputs.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });

  // Group column
  const thGroup = document.createElement("th");
  thGroup.textContent = "Group";
  headerRow.appendChild(thGroup);

  // Cluster column
  const thCluster = document.createElement("th");
  thCluster.innerHTML = `Cluster ${hBtn("cluster.id")}`;
  headerRow.appendChild(thCluster);

  // Moderator columns
  moderators.forEach(({ name }) => headerRow.appendChild(makeModTh(name)));

  // Actions column
  const thActions = document.createElement("th");
  thActions.textContent = "Actions";
  headerRow.appendChild(thActions);
}

// ---------------- DRAG-TO-REORDER ----------------
let _dragRow        = null;  // the row being dragged
let _dragPointerSrc = null;  // element where pointerdown fired (guard against input drags)

function _rowPointerDown(e) { _dragPointerSrc = e.target; }

function _rowDragStart(e) {
  // Don't start a drag when the user clicked inside an input / button / select
  if (_dragPointerSrc && _dragPointerSrc.matches("input, button, select, textarea")) {
    e.preventDefault();
    return;
  }
  _dragRow = this;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", ""); // required for Firefox
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
  markStale();
  scheduleSave();
}

function _rowDragEnd() {
  _dragRow?.classList.remove("row-dragging");
  document.querySelectorAll("#inputTable .drag-over-top, #inputTable .drag-over-bottom")
    .forEach(r => r.classList.remove("drag-over-top", "drag-over-bottom"));
  _dragRow = null;
}

// ---------------- ADD ROW ----------------
function addRow(values) {
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
  const v = values || ["", ...Array(profile.inputs.length).fill(""), "", ""]; // Study + effects + group + cluster

  // ---- Study column ----
  const cellStudy = row.insertCell();
  const inputStudy = document.createElement("input");
  inputStudy.value = v[0] || "";
  cellStudy.appendChild(inputStudy);

  // ---- Effect columns ----
  profile.inputs.forEach((key, idx) => {
    const cell = row.insertCell();
    const input = document.createElement("input");
    input.value = v[idx + 1] || "";
    cell.appendChild(input);
  });

  // ---- Group column ---- (fixed index: 1 Study + p effects + 1 Group)
  const groupCell = row.insertCell();
  const groupInput = document.createElement("input");
  groupInput.className = "group";
  groupInput.placeholder = "e.g. A";
  groupInput.value = v[profile.inputs.length + 1] || "";
  groupCell.appendChild(groupInput);

  // ---- Cluster column ---- (fixed index: 1 Study + p effects + 1 Group + 1 Cluster)
  const clusterCell = row.insertCell();
  const clusterInput = document.createElement("input");
  clusterInput.className = "cluster";
  clusterInput.placeholder = "e.g. 1";
  clusterInput.value = v[profile.inputs.length + 2] || "";
  clusterCell.appendChild(clusterInput);

  // ---- Moderator columns ---- (values at indices after Cluster)
  const modOffset = profile.inputs.length + 3;
  moderators.forEach(({ name, type }, modIdx) => {
    const td = makeModTd(name, type);
    const val = v[modOffset + modIdx];
    if (val !== undefined) td.querySelector("input").value = val;
    row.appendChild(td);
  });

  // ---- Actions ----
  const actionCell = row.insertCell();
  actionCell.innerHTML = `<button class="remove-btn">✖</button> <button class="clear-btn">🧹</button>`;

  // ---- Listeners ----
  row.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", () => {
      validateRow(row);
      markStale();
      scheduleSave();
    });
  });

  row.querySelector(".remove-btn").addEventListener("click", () => removeRow(row.querySelector(".remove-btn")));
  row.querySelector(".clear-btn").addEventListener("click", () => clearRow(row.querySelector(".clear-btn")));
}

// ---------------- UNDO DELETION ----------------
// One pending deletion at a time.  The row stays in the DOM marked with
// .row-pending-delete (excluded from analysis + session state) until the
// 5-second window expires or the user clicks Undo.

const _undoState = { timer: null, row: null, robKey: null };
const _UNDO_MS   = 5000;

function _commitPendingDelete() {
  if (!_undoState.row) return;
  clearTimeout(_undoState.timer);
  if (_undoState.robKey) delete _robData[_undoState.robKey];
  _undoState.row.remove();
  _undoState.row    = null;
  _undoState.robKey = null;
  _undoState.timer  = null;
  renderRoBDataGrid();
  _hideUndoToast();
}

function _cancelPendingDelete() {
  if (!_undoState.row) return;
  clearTimeout(_undoState.timer);
  _undoState.row.classList.remove("row-pending-delete");
  _undoState.row    = null;
  _undoState.robKey = null;
  _undoState.timer  = null;
  _hideUndoToast();
  markStale();
  scheduleSave();
}

function _showUndoToast(label) {
  const toast = document.getElementById("undoToast");
  const lbl   = document.getElementById("undoToastLabel");
  const btn   = document.getElementById("undoToastBtn");
  const bar   = toast?.querySelector(".undo-toast-bar");
  if (!toast) return;

  if (lbl) lbl.textContent = label ? `"${label}" removed` : "Study removed";

  // Restart bar animation by cloning and replacing
  if (bar) {
    const newBar = bar.cloneNode(true);
    bar.replaceWith(newBar);
  }

  btn.onclick = _cancelPendingDelete;
  toast.hidden = false;
}

function _hideUndoToast() {
  const toast = document.getElementById("undoToast");
  if (toast) toast.hidden = true;
}

// ---------------- REMOVE & CLEAR ----------------
function removeRow(btn) {
  const table = document.getElementById("inputTable");
  // Count non-pending rows (header counts as 1 non-data row).
  const nonPending = [...table.rows].filter(r => !r.classList.contains("row-pending-delete")).length;
  if (nonPending <= 2) return;  // keep at least 1 data row

  // Commit any in-progress pending deletion before starting a new one.
  _commitPendingDelete();

  const row   = btn.closest("tr");
  const label = row.querySelector("input")?.value?.trim() || "";

  // Mark row as pending; exclude from analysis immediately.
  row.classList.add("row-pending-delete");
  _undoState.row    = row;
  _undoState.robKey = label || null;
  _undoState.timer  = setTimeout(_commitPendingDelete, _UNDO_MS);

  _showUndoToast(label);
  markStale();
  scheduleSave();
}

function clearRow(btn) {
  btn.closest("tr").querySelectorAll("input").forEach(input => input.value = "");
  markStale();
}

// ---------------- VALIDATE ROW ----------------
function validateRow(row) {
  const type    = document.getElementById("effectType").value;
  const profile = getProfile(type);
  const inputs  = row.querySelectorAll("input");

  // Clear previous error state on all inputs.
  inputs.forEach(input => input.classList.remove("input-error"));

  if (!profile) {
    row.dataset.validationErrors = "{}";
    row.classList.remove("row-error");
    return true;
  }

  // Build a study object from the effect-column inputs (skip label, group, cluster, moderators).
  const studyObj = {};
  inputs.forEach((input, idx) => {
    if (idx === 0 || input.classList.contains("group") || input.classList.contains("cluster") || "mod" in input.dataset) return;
    const key = profile.inputs[idx - 1];
    const val = input.value.trim();
    studyObj[key] = profile.rawInputs?.has(key) ? val : (val === "" || isNaN(val)) ? NaN : +val;
  });

  // Delegate to the profile's validate function.
  const { valid, errors } = profile.validate(studyObj);

  // Mark individual inputs whose key has an error.
  inputs.forEach((input, idx) => {
    if (idx === 0 || input.classList.contains("group") || input.classList.contains("cluster") || "mod" in input.dataset) return;
    const key = profile.inputs[idx - 1];
    if (errors[key]) input.classList.add("input-error");
  });

  row.dataset.validationErrors = JSON.stringify(errors);
  row.classList.toggle("row-error", !valid);
  return valid;
}

// ---------------- SOFT WARNINGS ----------------
function getSoftWarnings(studyInput, type, label) {
  return getProfile(type)?.softWarnings(studyInput, label) ?? [];
}

// --------------- UPDATE VALIDATION WARNINGS (BELOW INPUT TABLE) -----------------
function updateValidationWarnings(studies, excluded, softWarnings) {
  const table = document.getElementById("inputTable");
  const warningDiv = document.getElementById("validationWarnings");
  const rows = [...table.rows].slice(1);

  const messages = [];
  const subgroupMap = {};

  // ---------------- INPUT ERRORS ----------------
  rows.forEach((row, idx) => {
    const label = row.querySelector("input")?.value || `Row ${idx+1}`;
    const errors = JSON.parse(row.dataset.validationErrors || "{}");

    Object.entries(errors).forEach(([field, msg]) => {
      messages.push(`❌ ${label}: ${msg}`);
    });

    const groupName = row.querySelector(".group")?.value.trim();
    if (groupName) {
      if (!subgroupMap[groupName]) subgroupMap[groupName] = [];
      subgroupMap[groupName].push(label);
    }
  });

  // ---------------- SUBGROUP WARNINGS ----------------
  Object.entries(subgroupMap).forEach(([group, studiesInGroup]) => {
    if (studiesInGroup.length < 2) {
      messages.push(`⚠️ Subgroup "${group}" has <2 studies (${studiesInGroup.join(", ")})`);
    }
  });

  // ---------------- EXCLUDED STUDIES ----------------
  if (excluded.length > 0) {
    excluded.forEach(e => {
      messages.push(`⚠️ Excluded: ${e.label} (${e.reason})`);
    });
  }
  
  // ---------------- SOFT WARNINGS --------------------
  softWarnings.forEach(w => messages.push(w));

  // ---------------- ANALYSIS WARNINGS ----------------
  const k = studies.length;

  if (k === 0) {
    messages.push("❌ No valid studies available for analysis");
  } else {
    if (k < 2) {
      messages.push("⚠️ Fewer than 2 studies: meta-analysis not meaningful");
    }
    if (k < 3) {
      messages.push("⚠️ Egger / Begg / FAT-PET tests require ≥ 3 studies");
    }

    // Check for extremely small variances (numerical instability)
    const tinyVar = studies.some(s => s.vi < 1e-8);
    if (tinyVar) {
      messages.push("⚠️ One or more studies have extremely small variance (may inflate weights)");
    }
  }

  // ---------------- RENDER ----------------
  if (messages.length > 0) {
    warningDiv.innerHTML = messages.map(m => `• ${m}`).join("<br>");
  } else {
    warningDiv.innerHTML = "";
  }
}

// ---------------- CSV IMPORT — TWO-PHASE PREVIEW / COMMIT ----------------

// Cached parsed CSV waiting for user confirmation.
let _pendingImport = null;  // { parsed: { delimiter, headers, rows } }

// Classify every CSV header against the chosen effect profile.
// Returns { matched, missing, modCols, structural, confidence }.
function classifyColumns(headers, type) {
  const profile   = effectProfiles[type];
  const required  = new Set(profile.inputs.map(i => i.toLowerCase()));
  const structural = new Set(["study", "group", "cluster"]);
  const lowerHdr  = new Set(headers.map(h => h.toLowerCase()));

  const matched    = profile.inputs.filter(i =>  lowerHdr.has(i.toLowerCase()));
  const missing    = profile.inputs.filter(i => !lowerHdr.has(i.toLowerCase()));
  const modCols    = headers.filter(h => !required.has(h.toLowerCase()) && !structural.has(h.toLowerCase()));
  const structCols = headers.filter(h =>  structural.has(h.toLowerCase()));

  const score = profile.inputs.length > 0 ? matched.length / profile.inputs.length : 0;
  const confidence = score === 1 ? "full" : score > 0 ? "partial" : "none";

  return { matched, missing, modCols, structural: structCols, confidence };
}

// Rebuild the mapping chips and preview table for the currently-selected type.
function refreshPreviewUI(type) {
  if (!_pendingImport) return;
  const { headers, rows } = _pendingImport.parsed;
  const cls = classifyColumns(headers, type);

  // Confidence pill — show "tied" when the auto-detected type is ambiguous and
  // the user hasn't manually overridden the dropdown.
  const confEl = document.getElementById("previewConfidence");
  const isAutoDetected = _pendingImport.tied && type === _pendingImport.detectedType;
  const displayConf = (isAutoDetected && cls.confidence === "full") ? "tied" : cls.confidence;
  const otherTypes = (_pendingImport.tiedTypes ?? []).filter(t => t !== type);
  const tiedMsg = otherTypes.length > 0
    ? `⚠ ambiguous — also matches: ${otherTypes.join(", ")}`
    : "⚠ ambiguous — multiple types match";
  const confText = {
    full:    "✓ all columns matched",
    tied:    tiedMsg,
    partial: "⚠ partial match",
    none:    "✗ no columns matched",
  };
  confEl.textContent = confText[displayConf];
  confEl.className = `badge-pill conf-${displayConf}`;

  // Column mapping chips
  const lowerMatched    = new Set(cls.matched.map(c => c.toLowerCase()));
  const lowerStructural = new Set(cls.structural.map(c => c.toLowerCase()));

  let chips = "";
  cls.structural.forEach(c =>
    chips += `<span class="badge-pill chip-ignored">${escapeHTML(c)}</span>`);
  cls.matched.forEach(c =>
    chips += `<span class="badge-pill chip-matched">✓ ${escapeHTML(c)}</span>`);
  cls.missing.forEach(c =>
    chips += `<span class="badge-pill chip-missing">✗ ${escapeHTML(c)}</span>`);
  cls.modCols.forEach(c =>
    chips += `<span class="badge-pill chip-moderator">~ ${escapeHTML(c)}</span>`);
  document.getElementById("previewMapping").innerHTML = chips;

  // Data preview table (first 5 rows)
  function colClass(h) {
    const hl = h.toLowerCase();
    if (lowerStructural.has(hl)) return "";
    if (lowerMatched.has(hl))    return "col-matched";
    return "col-moderator";
  }

  let tbl = '<table class="preview-table"><thead><tr>';
  headers.forEach(h => {
    tbl += `<th class="${colClass(h)}">${escapeHTML(h)}</th>`;
  });
  tbl += "</tr></thead><tbody>";
  rows.slice(0, 5).forEach(row => {
    tbl += "<tr>";
    row.forEach(cell => tbl += `<td>${escapeHTML(cell)}</td>`);
    tbl += "</tr>";
  });
  tbl += "</tbody></table>";
  document.getElementById("previewTable").innerHTML = tbl;
}

// Phase 1 — called when the user selects a file.
// Parses the file and populates the preview panel without touching the table.
async function previewCSV(file) {
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

  // Detect effect type before storing so detectedType is available to refreshPreviewUI.
  const currentType = document.getElementById("effectType").value;
  const detection   = detectEffectType(parsed.headers, currentType, effectProfiles);

  _pendingImport = { parsed, detectedType: detection.type, tied: detection.tied, tiedTypes: detection.tiedTypes ?? [] };

  // Delimiter badge
  const delimNames = { ",": "comma", ";": "semicolon", "\t": "tab" };
  document.getElementById("previewDelimiter").textContent =
    `delimiter: ${delimNames[parsed.delimiter] ?? parsed.delimiter}`;

  document.getElementById("previewEffectType").value = detection.type;

  refreshPreviewUI(detection.type);
  document.getElementById("importPreview").style.display = "block";
}

// Phase 2 — called when the user clicks "Import" in the preview panel.
// Commits the parsed data to the table and runs analysis.
function commitImport() {
  if (!_pendingImport) return;
  const { headers, rows } = _pendingImport.parsed;

  const type    = document.getElementById("previewEffectType").value;
  const profile = effectProfiles[type];

  // Build header → index map
  const headerMap = {};
  headers.forEach((h, idx) => { headerMap[h.toLowerCase()] = idx; });

  // Classify columns
  const knownCols = new Set(["study", "group", "cluster", ...profile.inputs.map(c => c.toLowerCase())]);
  const modCols   = headers.filter(h => !knownCols.has(h.toLowerCase()));

  // Infer moderator types and register them
  clearModerators();
  modCols.forEach(col => {
    const ci     = headerMap[col.toLowerCase()];
    const vals   = rows.map(r => r[ci] ?? "").filter(v => v.trim() !== "");
    const mtype  = vals.length > 0 && vals.every(v => !isNaN(v.trim())) ? "continuous" : "categorical";
    moderators.push({ name: col, type: mtype, transform: "linear" });
  });

  // Apply detected effect type and rebuild table headers
  document.getElementById("effectType").value = type;
  updateTableHeaders();
  const table = document.getElementById("inputTable");
  while (table.rows.length > 1) table.deleteRow(1);

  rows.forEach(values => {
    const v = [];
    v.push(values[headerMap["study"]] ?? "");
    profile.inputs.forEach(col => v.push(values[headerMap[col.toLowerCase()]] ?? ""));
    v.push(values[headerMap["group"]] ?? "");
    v.push(values[headerMap["cluster"]] ?? "");
    modCols.forEach(col => v.push(values[headerMap[col.toLowerCase()]] ?? ""));
    addRow(v);
  });

  // Dismiss the preview panel (also clears csvWarning).
  cancelImport();

  // Show a warning for any required column that was absent — must come after
  // cancelImport() so the warning is not immediately cleared by it.
  const warningDiv  = document.getElementById("csvWarning");
  const missingCols = profile.inputs.filter(c => !(c.toLowerCase() in headerMap));
  if (missingCols.length > 0) {
    warningDiv.textContent = `Warning: CSV is missing required columns: ${missingCols.join(", ")}`;
    warningDiv.style.display = "block";
    return;
  }
}

function cancelImport() {
  _pendingImport = null;
  document.getElementById("importPreview").style.display = "none";
  document.getElementById("csvWarning").style.display = "none";
  // Reset the file input so choosing the same file again fires the change event.
  document.getElementById("csvFile").value = "";
}

// ---------------- SESSION SCHEMA ----------------

// Gather the current UI state into a versioned session object.
// Schema is defined in session.js.
function gatherSessionState() {
  const type    = document.getElementById("effectType").value;
  const profile = effectProfiles[type];

  const settings = {
    effectType:      type,
    tauMethod:       document.getElementById("tauMethod").value,
    ciMethod:        document.getElementById("ciMethod").value,
    ciLevel:         document.getElementById("ciLevel").value,
    cumulativeOrder: document.getElementById("cumulativeOrder").value,
    useTrimFill:     document.getElementById("useTrimFill").checked,
    tfEstimator:     document.getElementById("tfEstimator").value,
    useTFAdjusted:   document.getElementById("useTFAdjusted").checked,
    // Bayesian priors
    bayesMu0:        parseFloat(document.getElementById("bayesMu0")?.value)     ?? 0,
    bayesSigmaMu:    parseFloat(document.getElementById("bayesSigmaMu")?.value) ?? 1,
    bayesSigmaTau:   parseFloat(document.getElementById("bayesSigmaTau")?.value) ?? 0.5,
    // Vevea-Hedges selection model
    selMode:         document.getElementById("selMode")?.value   ?? "sensitivity",
    selPreset:       document.getElementById("selPreset")?.value ?? "mild1",
    selSides:        document.getElementById("selSides")?.value  ?? "1",
    selCuts:         document.getElementById("selCuts")?.value   ?? "0.025, 0.05, 0.10, 0.25, 0.50, 1.0",
  };

  const savedModerators = moderators.map(m => ({ name: m.name, type: m.type, transform: m.transform || "linear" }));
  const savedScaleModerators = scaleModerators.map(m => ({ name: m.name, type: m.type, transform: m.transform || "linear" }));

  const studies = [];
  document.querySelectorAll("#inputTable tr").forEach((r, i) => {
    if (i === 0) return; // skip header
    if (r.classList.contains("row-pending-delete")) return; // skip pending deletions
    const inputs = [...r.querySelectorAll("input")];
    // inputs order: Study, ...profile.inputs, Group, Cluster, ...moderators
    const study = inputs[0]?.value ?? "";
    const effectInputs = {};
    profile.inputs.forEach((col, idx) => {
      effectInputs[col] = inputs[idx + 1]?.value ?? "";
    });
    const group   = inputs[profile.inputs.length + 1]?.value ?? "";
    const cluster = inputs[profile.inputs.length + 2]?.value ?? "";
    const modValues = {};
    moderators.forEach((m, modIdx) => {
      modValues[m.name] = inputs[profile.inputs.length + 3 + modIdx]?.value ?? "";
    });

    // Skip completely empty rows
    const allVals = [study, ...Object.values(effectInputs), group, cluster, ...Object.values(modValues)];
    if (allVals.every(v => v === "")) return;

    studies.push({ study, inputs: effectInputs, group, cluster, moderators: modValues });
  });

  return buildSession(settings, savedModerators, studies, { domains: _robDomains, data: _robData }, savedScaleModerators);
}

// ---------------- SESSION SAVE ----------------

function saveSession() {
  downloadBlob(serializeSession(gatherSessionState()), "session.json", "application/json;charset=utf-8;");
}

// ---------------- SESSION APPLY ----------------
// Shared logic for applying a parsed session object to the UI.
// Used by both loadSession() (file load) and draft restore (on-load autosave).
// Returns { profile, savedStudies } so callers can inspect missing columns etc.

function applySession(session) {
  const { settings = {}, moderators: savedMods = [], scaleModerators: savedScaleMods = [], studies: savedStudies = [], rob = {} } = session;

  // Apply settings
  const s = settings;
  if (s.effectType      && document.getElementById("effectType").querySelector(`option[value="${s.effectType}"]`))
    document.getElementById("effectType").value      = s.effectType;
  if (s.tauMethod       && document.getElementById("tauMethod").querySelector(`option[value="${s.tauMethod}"]`))
    document.getElementById("tauMethod").value       = s.tauMethod;
  if (s.ciMethod        && document.getElementById("ciMethod").querySelector(`option[value="${s.ciMethod}"]`))
    document.getElementById("ciMethod").value        = s.ciMethod;
  if (s.ciLevel         && document.getElementById("ciLevel").querySelector(`option[value="${s.ciLevel}"]`))
    document.getElementById("ciLevel").value         = s.ciLevel;
  if (s.cumulativeOrder && document.getElementById("cumulativeOrder").querySelector(`option[value="${s.cumulativeOrder}"]`))
    document.getElementById("cumulativeOrder").value = s.cumulativeOrder;
  if (typeof s.useTrimFill   === "boolean") document.getElementById("useTrimFill").checked   = s.useTrimFill;
  if (s.tfEstimator && document.getElementById("tfEstimator").querySelector(`option[value="${s.tfEstimator}"]`))
    document.getElementById("tfEstimator").value = s.tfEstimator;
  if (typeof s.useTFAdjusted === "boolean") document.getElementById("useTFAdjusted").checked = s.useTFAdjusted;

  // Bayesian priors
  if (isFinite(s.bayesMu0))    { const el = document.getElementById("bayesMu0");    if (el) el.value = s.bayesMu0; }
  if (isFinite(s.bayesSigmaMu) && s.bayesSigmaMu > 0)  { const el = document.getElementById("bayesSigmaMu");  if (el) el.value = s.bayesSigmaMu; }
  if (isFinite(s.bayesSigmaTau) && s.bayesSigmaTau > 0) { const el = document.getElementById("bayesSigmaTau"); if (el) el.value = s.bayesSigmaTau; }

  // Vevea-Hedges selection model
  if (s.selMode) {
    const el = document.getElementById("selMode");
    if (el && el.querySelector(`option[value="${s.selMode}"]`)) el.value = s.selMode;
  }
  if (s.selPreset) {
    const el = document.getElementById("selPreset");
    if (el && el.querySelector(`option[value="${s.selPreset}"]`)) el.value = s.selPreset;
  }
  if (s.selSides) {
    const el = document.getElementById("selSides");
    if (el && el.querySelector(`option[value="${s.selSides}"]`)) el.value = s.selSides;
  }
  if (s.selCuts) { const el = document.getElementById("selCuts"); if (el) el.value = s.selCuts; }
  syncSelControls();

  // Rebuild moderators
  clearModerators();
  savedMods.forEach(m => {
    if (m.name && (m.type === "continuous" || m.type === "categorical"))
      doAddModerator(m.name, m.type, m.transform || "linear");
  });

  // Rebuild scale moderators
  scaleModerators = [];
  savedScaleMods.forEach(m => {
    if (m.name && (m.type === "continuous" || m.type === "categorical"))
      doAddScaleModerator(m.name, m.type, m.transform || "linear");
  });

  // Rebuild table
  const type    = document.getElementById("effectType").value;
  const profile = effectProfiles[type];
  updateTableHeaders();
  const table = document.getElementById("inputTable");
  while (table.rows.length > 1) table.deleteRow(1);

  savedStudies.forEach(row => {
    const v = [];
    v.push(row.study ?? "");
    profile.inputs.forEach(col => v.push(row.inputs?.[col] ?? ""));
    v.push(row.group ?? "");
    v.push(row.cluster ?? "");
    moderators.forEach(m => v.push(row.moderators?.[m.name] ?? ""));
    addRow(v);
  });

  // Restore risk-of-bias state
  _robDomains = Array.isArray(rob.domains) ? [...rob.domains] : [];
  _robData    = (rob.data && typeof rob.data === "object") ? rob.data : {};
  renderRoBDomainTags();
  renderRoBDataGrid();

  return { profile, savedStudies };
}

// ---------------- SESSION LOAD ----------------

async function loadSession(file) {
  const warningDiv = document.getElementById("csvWarning");
  warningDiv.style.display = "none";

  // Dismiss any in-progress CSV import so the preview panel doesn't linger
  // over the freshly-loaded session data.
  cancelImport();

  let text;
  try { text = await readTextFile(file); }
  catch {
    warningDiv.textContent = "Could not read the selected session file.";
    warningDiv.style.display = "block";
    return;
  }

  const result = parseSession(text);
  if (!result.ok) {
    warningDiv.textContent = result.error;
    warningDiv.style.display = "block";
    return;
  }

  const { profile, savedStudies } = applySession(result.session);
  syncMHOptions(document.getElementById("effectType").value);

  // Warn about any effect-input columns absent from the saved data.
  const missingCols = missingInputCols(profile.inputs, savedStudies);
  if (missingCols.length > 0) {
    warningDiv.textContent = `Warning: session is missing data for: ${missingCols.join(", ")}`;
    warningDiv.style.display = "block";
    return;
  }
}

// ---------------- CSV EXPORT ----------------

function exportCSV() {
  const type    = document.getElementById("effectType").value;
  const profile = effectProfiles[type];

  const headers = ["Study", ...profile.inputs, "Group", "Cluster", ...moderators.map(m => m.name)];
  const rows    = [];

  document.querySelectorAll("#inputTable tr").forEach((r, i) => {
    if (i === 0) return; // skip header row
    const vals = [...r.querySelectorAll("input")].map(x => x.value);
    if (vals.some(v => v !== "")) rows.push(vals);
  });

  downloadBlob(serializeCSV(headers, rows), "meta_data.csv", "text/csv;charset=utf-8;");
}

// ---------------- INIT ----------------

// Group order for the effect type dropdown.
const EFFECT_GROUP_ORDER = [
  "Continuous (two groups)",
  "Continuous (paired)",
  "Continuous (single group)",
  "Variability",
  "Binary outcomes",
  "Correlations",
  "Proportions",
  "Time-to-event / Rates",
  "Generic",
];

function populateEffectTypeDropdowns() {
  // Build grouped <optgroup> HTML from profile group metadata.
  const grouped = {};
  for (const [val, p] of Object.entries(effectProfiles)) {
    const g = p.group ?? "Other";
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(`<option value="${val}">${p.label}</option>`);
  }
  const html = EFFECT_GROUP_ORDER
    .filter(g => grouped[g])
    .map(g => `<optgroup label="${g}">${grouped[g].join("")}</optgroup>`)
    .join("");
  document.getElementById("effectType").innerHTML = html;
  document.getElementById("previewEffectType").innerHTML = html;
}

// Profile Likelihood CI requires a likelihood-based τ² estimator (REML or ML).
// When a method-of-moments estimator is selected, disable the PL option.
// When PL is selected, auto-switch τ² to REML.
function syncPLAvailability() {
  const tauSel = document.getElementById("tauMethod");
  const ciSel  = document.getElementById("ciMethod");
  const plOpt  = ciSel.querySelector('option[value="PL"]');
  if (!plOpt) return;
  const likelihoodBased = tauSel.value === "REML" || tauSel.value === "ML";
  plOpt.disabled = !likelihoodBased;
  if (!likelihoodBased && ciSel.value === "PL") {
    ciSel.value = "normal";
  }
}

// MH is available for OR, RR, RD; Peto is available for OR only.
// When MH or Peto is selected: lock CI method to "normal" and disable trim-and-fill.
function syncMHOptions(type) {
  const tauSel  = document.getElementById("tauMethod");
  const ciSel   = document.getElementById("ciMethod");
  const tfCheck = document.getElementById("useTrimFill");
  const mhOpt   = tauSel.querySelector('option[value="MH"]');
  const petoOpt = tauSel.querySelector('option[value="Peto"]');
  if (!mhOpt || !petoOpt) return;

  const mhTypes   = ["OR", "RR", "RD"];
  const petoTypes = ["OR"];

  mhOpt.disabled   = !mhTypes.includes(type);
  petoOpt.disabled = !petoTypes.includes(type);

  // If selected method is no longer valid for this type, reset to REML.
  if (tauSel.value === "MH"   && mhOpt.disabled)   tauSel.value = "REML";
  if (tauSel.value === "Peto" && petoOpt.disabled)  tauSel.value = "REML";

  const isMHorPeto = tauSel.value === "MH" || tauSel.value === "Peto";

  // Lock CI method to normal when MH/Peto is active; re-enable otherwise.
  Array.from(ciSel.options).forEach(opt => {
    opt.disabled = isMHorPeto && opt.value !== "normal";
  });
  if (isMHorPeto) ciSel.value = "normal";

  // Disable trim-and-fill for MH/Peto (incompatible weighting).
  if (tfCheck) {
    tfCheck.disabled = isMHorPeto;
    if (isMHorPeto) tfCheck.checked = false;
    const tfEst = document.getElementById("tfEstimator");
    if (tfEst) tfEst.disabled = isMHorPeto || !tfCheck.checked;
  }

  syncPLAvailability();
}

function init() {
  // Populate effect type dropdowns from profiles
  populateEffectTypeDropdowns();

  // Restore autosaved draft if one exists, otherwise populate example data.
  const draft = loadDraft();
  if (draft && draft.studies?.length > 0) {
    applySession(draft);
    showDraftBanner(draft._savedAt);
  } else {
    // Default effect type: SMD (scale-free, broadly applicable)
    document.getElementById("effectType").value = "SMD";
    updateTableHeaders();
    populateExampleData("SMD");
  }

  // Initialise MH/Peto and PL availability based on default/restored settings.
  syncMHOptions(document.getElementById("effectType").value);

  // Validate all rows
  document.querySelectorAll("#inputTable tr").forEach((row, i) => {
    if (i === 0) return;
    validateRow(row);
  });

  if (new URLSearchParams(window.location.search).has("tests")) {
    import("./tests.js").then(({ runTests }) => runTests());
  }
}

window.onload = init;

// ---------------- POPULATE EXAMPLES ----------------
function populateExampleData(type) {
  const table = document.getElementById("inputTable");
  while (table.rows.length > 1) table.deleteRow(1);
  (getProfile(type)?.exampleData ?? []).forEach(row => addRow(row));
}

// ---------------- META-REGRESSION RESULTS PANEL ----------------

function regStars(p) {
  if (p < 0.001) return `<span class="reg-sig-3">***</span>`;
  if (p < 0.01)  return `<span class="reg-sig-2">**</span>`;
  if (p < 0.05)  return `<span class="reg-sig-1">*</span>`;
  if (p < 0.10)  return `<span style="color:#666">.</span>`;
  return "";
}

function regFmtP(p) {
  if (!isFinite(p)) return "—";
  if (p < 0.0001) return `<span class="reg-sig-3">&lt;0.0001</span>`;
  const cls = p < 0.001 ? "reg-sig-3" : p < 0.01 ? "reg-sig-2" : p < 0.05 ? "reg-sig-1" : "";
  return cls ? `<span class="${cls}">${fmt(p)}</span>` : fmt(p);
}

function buildRegCoeffRows(reg, adjPs = null) {
  const hasVif    = Array.isArray(reg.vif) && reg.vif.length === reg.p;
  const hasRobust = reg.isClustered && Array.isArray(reg.robustSE);
  // Group header rows only when there are genuinely multiple moderators whose
  // column indices are tracked in modTests.
  const multiMod = moderators.length > 1
    && Array.isArray(reg.modTests) && reg.modTests.length > 0;
  const colCount = 8 + (hasRobust ? 2 : 0);  // Term + β + SE + stat + p + CI + VIF + stars [+ Rob.SE + Rob.p]

  function vifCell(j) {
    if (!hasVif || j === 0) return `<td class="reg-vif">—</td>`;
    const v = reg.vif[j];
    if (!isFinite(v)) return `<td class="reg-vif">—</td>`;
    const cls = v > 10 ? "vif-high" : v > 5 ? "vif-mid" : "vif-ok";
    return `<td class="reg-vif ${cls}">${v.toFixed(2)}</td>`;
  }

  function dataRow(j) {
    const [lo, hi] = reg.ci[j];
    const robustCells = hasRobust
      ? `<td>${fmt(reg.robustSE[j])}</td><td>${regFmtP(reg.robustP[j])}</td>`
      : "";
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
      ? ` &nbsp;·&nbsp; QM ${QMlabel} = ${fmt(mt.QM)}, p = ${regFmtP(mt.QMp)}`
      : "";
    if (adjPs && adjPs[mi] !== undefined && isFinite(adjPs[mi]) && adjPs[mi] !== mt.QMp) {
      qmStr += `, p (adj) = ${regFmtP(adjPs[mi])}`;
    }
    html += `<tr class="reg-mod-group">
      <td colspan="${colCount}"><span class="reg-mod-name">${mt.name}</span>${qmStr}</td>
    </tr>`;
    for (const j of mt.colIdxs) html += dataRow(j);
  }
  return html;
}

function buildRegFittedRows(reg) {
  if (!reg.labels || !reg.fitted) return "";
  return reg.labels.map((lbl, i) => {
    const sr   = reg.stdResiduals[i];
    const flag = Math.abs(sr) > Z_95 ? " style='color:#ff9f43'" : "";
    return `<tr>
      <td>${lbl || i + 1}</td>
      <td>${fmt(reg.yi[i])}</td>
      <td>${fmt(reg.fitted[i])}</td>
      <td>${fmt(reg.residuals[i])}</td>
      <td${flag}>${fmt(sr)}</td>
    </tr>`;
  }).join("");
}

// ---- Location-scale model panel ----
function renderLocationScalePanel(ls, ciMethod, kExcluded = 0) {
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
        ? ` &nbsp;·&nbsp; QM χ²(${mt.QMdf}) = ${fmt(mt.QM)}, p = ${regFmtP(mt.QMp)}`
        : "";
      html += `<tr class="reg-mod-group"><td colspan="7"><span class="reg-mod-name">${mt.name}</span>${qmStr}</td></tr>`;
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
        ? ` &nbsp;·&nbsp; QM χ²(${mt.QMdf}) = ${fmt(mt.QM)}, p = ${regFmtP(mt.QMp)}`
        : "";
      html += `<tr class="reg-mod-group"><td colspan="7"><span class="reg-mod-name">${mt.name}</span>${qmStr}</td></tr>`;
      for (const j of mt.colIdxs) html += dataRow(j);
    }
    return html;
  }

  // Fitted values table with study-specific τ²ᵢ
  function fittedRows() {
    if (!ls.labels || !ls.fitted) return "";
    return ls.labels.map((lbl, i) => `<tr>
      <td>${lbl || i + 1}</td>
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
    ? ` &nbsp;·&nbsp; QM<sub>loc</sub> χ²(${ls.QM_locDf}) = ${fmt(ls.QM_loc)}, p = ${regFmtP(ls.QM_locP)}`
    : "";
  const QM_scaleRow = ls.q > 1 && isFinite(ls.QM_scale)
    ? ` &nbsp;·&nbsp; QM<sub>scale</sub> χ²(${ls.QM_scaleDf}) = ${fmt(ls.QM_scale)}, p = ${regFmtP(ls.QM_scaleP)}`
    : "";
  const lrRow = ls.q > 1 && isFinite(ls.LRchi2)
    ? `<br><span style="color:var(--fg-muted);font-size:0.93em">LR test (scale mods): χ²(${ls.LRdf}) = ${fmt(ls.LRchi2)}, p = ${regFmtP(ls.LRp)}</span>`
    : "";

  const fRows = fittedRows();

  panel.innerHTML = `
    <div class="reg-header">
      <span class="reg-title">Location-Scale Model${hBtn("diag.locationscale")}</span>
      <span class="reg-meta">k = ${ls.k} &nbsp;·&nbsp; ML &nbsp;·&nbsp; Normal CI</span>
    </div>
    <div class="reg-het">
      ${tau2rng} &nbsp;·&nbsp; I² = ${fmt(ls.I2)}%
      &nbsp;·&nbsp; QE(${ls.QEdf}) = ${fmt(ls.QE)}, p = ${regFmtP(ls.QEp)}
      ${QM_locRow}${QM_scaleRow}
      ${lrRow}
      <br><span style="color:var(--fg-muted);font-size:0.93em">LL = ${fmt(ls.LL)} (ML; log τ²ᵢ = Zᵢγ)</span>
    </div>
    <div class="reg-body">
      ${excWarn}
      <p style="margin:4px 0 2px;font-weight:600;font-size:0.95em">Location model — E[yᵢ] = Xᵢβ</p>
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>β</th><th>SE</th><th>z</th>
          <th>p</th><th>${ciLbl}</th><th></th>
        </tr></thead>
        <tbody>${locRows()}</tbody>
      </table>
      <p style="margin:10px 0 2px;font-weight:600;font-size:0.95em">Scale model — log τ²ᵢ = Zᵢγ</p>
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>γ</th><th>SE</th><th>z</th>
          <th>p</th><th>${ciLbl}</th><th></th>
        </tr></thead>
        <tbody>${scaleRows()}</tbody>
      </table>
      <div class="reg-note">*** p &lt; .001 &nbsp;·&nbsp; ** p &lt; .01 &nbsp;·&nbsp; * p &lt; .05 &nbsp;·&nbsp; · p &lt; .10 &nbsp;·&nbsp; eˣ: exponentiated intercept = τ² when all scale predictors = 0</div>
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

function renderRegressionPanel(reg, method, ciMethod, kExcluded = 0) {
  const panel = document.getElementById("regressionPanel");
  const section = document.getElementById("regressionSection");

  if (!moderators.length) { section.style.display = "none"; return; }
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

  const statLabel = reg.dist === "t" ? `t(${reg.QEdf})` : "z";
  const QMlabel   = reg.QMdist === "F"
    ? `F(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;
  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";

  const QMrow = reg.p > 1
    ? ` &nbsp;·&nbsp; QM ${QMlabel} = ${fmt(reg.QM)}, p = ${regFmtP(reg.QMp)}`
    : "";

  const mccMethod = document.getElementById("mccMethod")?.value ?? "none";
  const rawModPs  = Array.isArray(reg.modTests) ? reg.modTests.map(mt => mt.QMp) : [];
  const adjModPs  = mccMethod !== "none" && rawModPs.length > 1
    ? adjustPvals(rawModPs, mccMethod) : null;

  const rows       = buildRegCoeffRows(reg, adjModPs);
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
  const modTestsBlock = moderators.length >= 2
    && Array.isArray(reg.modTests) && reg.modTests.length > 0
    ? `<details>
        <summary>Per-moderator tests (${reg.modTests.length}${hasAdjPs ? `, ${mccLabel} adj.` : ""})</summary>
        <table class="reg-table">
          <thead><tr>
            <th>Moderator</th>
            <th>${reg.QMdist === "F" ? "F" : "QM"} (Wald)</th>
            ${hasLRT ? `<th>LRT χ²${hBtn("mreg.lrt")}</th>` : ""}
            <th>df</th>
            <th>p (Wald)</th>
            ${hasLRT ? `<th>p (LRT)</th>` : ""}
            ${hasAdjPs ? `<th>p (${mccLabel})</th>` : ""}
          </tr></thead>
          <tbody>
            ${reg.modTests.map((mt, mi) => {
              if (mt.QMdf === 0) {
                return `<tr><td>${mt.name}</td><td colspan="${(hasAdjPs ? 1 : 0) + (hasLRT ? 2 : 0) + 3}"><i>degenerate (≤ 1 level)</i></td></tr>`;
              }
              const dfLabel = reg.QMdist === "F"
                ? `F(${mt.QMdf},\u2009${reg.QEdf})`
                : `χ²(${mt.QMdf})`;
              const lrtCells = hasLRT
                ? `<td>${isFinite(mt.lrt) ? fmt(mt.lrt) : "NA"}</td>
                   <td>${isFinite(mt.lrtP) ? regFmtP(mt.lrtP) : "NA"}</td>`
                : "";
              const adjCell = hasAdjPs
                ? `<td>${regFmtP(adjModPs[mi])}</td>` : "";
              return `<tr>
                <td>${mt.name}</td>
                <td>${fmt(mt.QM)}</td>
                ${lrtCells}
                <td>${dfLabel}</td>
                <td>${regFmtP(mt.QMp)}</td>
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
    ? `<th>Rob.SE</th><th>Rob.p</th>`
    : "";

  panel.innerHTML = `
    <div class="reg-header">
      <span class="reg-title">Meta-Regression${hBtn("diag.metaregression")}</span>
      <span class="reg-meta">k = ${reg.k} &nbsp;·&nbsp; ${method} &nbsp;·&nbsp; ${ciLabel}</span>
    </div>
    <div class="reg-het">
      τ² = ${fmt(reg.tau2)} (residual) &nbsp;·&nbsp; I² = ${fmt(reg.I2)}%
      ${reg.p > 1 ? `&nbsp;·&nbsp; R² = ${isFinite(reg.R2) ? fmt(reg.R2 * 100) + "%" : "N/A"}` : ""}
      &nbsp;·&nbsp; QE(${reg.QEdf}) = ${fmt(reg.QE)}, p = ${regFmtP(reg.QEp)}
      ${QMrow}
      <br><span style="color:var(--fg-muted);font-size:0.93em">${hBtn("reg.aic")}AIC&nbsp;=&nbsp;${fmt(reg.AIC)} &nbsp;·&nbsp; BIC&nbsp;=&nbsp;${fmt(reg.BIC)} &nbsp;·&nbsp; LL&nbsp;=&nbsp;${fmt(reg.LL)}&nbsp;&nbsp;<span style="font-size:0.9em;opacity:0.75">(${method}; compare ${method === "REML" ? "models with same predictors only" : "any nested models"})</span></span>
    </div>
    <div class="reg-body">
      ${clusterRegNote}${excludedWarning}${lowDfWarning}${vifWarning}
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>β</th><th>SE</th><th>${statLabel}</th>
          <th>p</th><th>${getCiLabel()}</th><th>VIF</th><th></th>
          ${robustHeaders}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="reg-note">*** p &lt; .001 &nbsp;·&nbsp; ** p &lt; .01 &nbsp;·&nbsp; * p &lt; .05 &nbsp;·&nbsp; · p &lt; .10</div>
      ${modTestsBlock}
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
    </div>`;
}

// ---------------- OUTPUT SECTION VISIBILITY ----------------
const staleBanner       = document.getElementById("staleBanner");
const outputPlaceholder = document.getElementById("outputPlaceholder");

// ---- Structured plot/app state objects ----
// Grouping related variables prevents scattered module-level names and makes
// each subsystem's state self-documenting.

const appState = {
  hasRunOnce:  false,  // prevents stale banner before the first run
  exportScale: 3,      // matches <option selected> in #exportScale (3× ≈ 288 dpi)
  reportArgs:  null,   // cached after each run; consumed by export buttons
};

const forestPlot = {
  page:        0,
  args:        null,        // { studies, m, options } — cached for page-nav re-renders
  poolDisplay: "RE",        // "FE" | "RE" | "Both"
  theme:       "default",   // visual style preset key (see forestThemes.js)
};

const caterpillarPlot = {
  page: 0,
  args: null,               // { studies, m, profile, pageSize }
};

const blupPlot = {
  page:   0,
  result: null,             // blupMeta() return value
  profile: null,
  pageSize: 30,
};

const cumForestPlot = {
  page: 0,
  args: null,               // { results, profile, pageSize }
};

const funnelPlot = {
  args:     null,           // [studies, m, egger, profile] — cached for mode toggle
  contours: false,
};

const cumFunnelPlot = {
  studies: null,            // sorted study array for cumulative funnel
  results: null,            // cumResults array, same order
  profile: null,            // effect-type profile
};

const goshState = {
  worker:  null,   // active Worker instance (null when idle)
  result:  null,   // last GoshResult from worker 'done' message
  profile: null,   // profile used for last result (for axis transform)
};

const bayesState = {
  studies: null,   // study array from the last runAnalysis() call
  reMean:  NaN,    // RE pooled mean from the last runAnalysis() call
  profile: null,   // effect-type profile from the last runAnalysis() call
};

document.getElementById("exportScale").addEventListener("change", e => {
  appState.exportScale = +e.target.value;
});

document.querySelectorAll(".forest-pool-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!forestPlot.args) return;
    forestPlot.poolDisplay = btn.dataset.display;
    document.querySelectorAll(".forest-pool-btn").forEach(b => b.classList.toggle("active", b === btn));
    forestPlot.page = 0;
    forestPlot.args.options = { ...forestPlot.args.options, pooledDisplay: forestPlot.poolDisplay };
    const { totalPages } = drawForest(forestPlot.args.studies, forestPlot.args.m, { ...forestPlot.args.options, page: forestPlot.page });
    renderForestNav(totalPages);
  });
});

document.getElementById("forestTheme").addEventListener("change", e => {
  if (!forestPlot.args) return;
  forestPlot.theme = e.target.value;
  forestPlot.args.options = { ...forestPlot.args.options, theme: forestPlot.theme };
  if (appState.reportArgs) {
    appState.reportArgs = { ...appState.reportArgs, forestOptions: { ...appState.reportArgs.forestOptions, theme: forestPlot.theme } };
  }
  const { totalPages } = drawForest(forestPlot.args.studies, forestPlot.args.m, { ...forestPlot.args.options, page: forestPlot.page });
  renderForestNav(totalPages);
});

document.querySelectorAll(".funnel-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!funnelPlot.args) return;
    funnelPlot.contours = btn.dataset.mode === "contour";
    document.querySelectorAll(".funnel-mode-btn").forEach(b => b.classList.toggle("active", b === btn));
    drawFunnel(...funnelPlot.args, { contours: funnelPlot.contours, petpeese: funnelPlot.petpeese });
  });
});

function _updateCumFunnelLabel(stepIdx) {
  const r = cumFunnelPlot.results[stepIdx];
  document.getElementById("cumulativeFunnelLabel").textContent =
    `Step ${stepIdx + 1} of ${cumFunnelPlot.results.length}\u2003added: ${r.addedLabel}`;
}

// makeNavRenderer(cfg) — factory for paginated-plot navigation bars.
// cfg: { navId, prevId, nextId, note(k), getKAll(), getPage(), setPage(n), redraw(page) }
function makeNavRenderer(cfg) {
  return function renderNav(totalPages) {
    const nav = document.getElementById(cfg.navId);
    if (!nav) return;
    if (totalPages <= 1) { nav.innerHTML = ""; return; }

    const page = cfg.getPage();
    nav.innerHTML =
      `<button id="${cfg.prevId}" ${page === 0 ? "disabled" : ""}>&#8249; Prev</button>` +
      `<span>Page ${page + 1} of ${totalPages}</span>` +
      `<button id="${cfg.nextId}" ${page >= totalPages - 1 ? "disabled" : ""}>Next &#8250;</button>` +
      `<span class="forest-nav-note">${cfg.note(cfg.getKAll())}</span>`;

    document.getElementById(cfg.prevId).addEventListener("click", () => {
      if (cfg.getPage() > 0) {
        cfg.setPage(cfg.getPage() - 1);
        const { totalPages: tp } = cfg.redraw(cfg.getPage());
        renderNav(tp);
      }
    });

    document.getElementById(cfg.nextId).addEventListener("click", () => {
      if (cfg.getPage() < totalPages - 1) {
        cfg.setPage(cfg.getPage() + 1);
        const { totalPages: tp } = cfg.redraw(cfg.getPage());
        renderNav(tp);
      }
    });
  };
}

const renderForestNav = makeNavRenderer({
  navId:   "forestNav",
  prevId:  "forestPrev",
  nextId:  "forestNext",
  note:    k => `Pooled estimate includes all ${k} studies`,
  getKAll: () => forestPlot.args?.studies?.length ?? "?",
  getPage: () => forestPlot.page,
  setPage: p  => { forestPlot.page = p; },
  redraw:  p  => drawForest(forestPlot.args.studies, forestPlot.args.m, { ...forestPlot.args.options, page: p }),
});

const renderCaterpillarNav = makeNavRenderer({
  navId:   "caterpillarNav",
  prevId:  "caterpillarPrev",
  nextId:  "caterpillarNext",
  note:    k => `Sorted by effect size across all ${k} studies`,
  getKAll: () => caterpillarPlot.args?.studies?.length ?? "?",
  getPage: () => caterpillarPlot.page,
  setPage: p  => { caterpillarPlot.page = p; },
  redraw:  p  => drawCaterpillarPlot(
    caterpillarPlot.args.studies, caterpillarPlot.args.m, caterpillarPlot.args.profile,
    { pageSize: caterpillarPlot.args.pageSize, page: p }
  ),
});

const renderBlupNav = makeNavRenderer({
  navId:   "blupNav",
  prevId:  "blupPrev",
  nextId:  "blupNext",
  note:    k => `Sorted by observed effect across all ${k} studies`,
  getKAll: () => blupPlot.result?.k ?? "?",
  getPage: () => blupPlot.page,
  setPage: p  => { blupPlot.page = p; },
  redraw:  p  => drawBlupPlot(blupPlot.result, blupPlot.profile, { pageSize: blupPlot.pageSize, page: p }),
});

const renderCumulativeForestNav = makeNavRenderer({
  navId:   "cumulativeForestNav",
  prevId:  "cumForestPrev",
  nextId:  "cumForestNext",
  note:    k => `Cumulative steps across all ${k} studies`,
  getKAll: () => cumForestPlot.args?.results?.length ?? "?",
  getPage: () => cumForestPlot.page,
  setPage: p  => { cumForestPlot.page = p; },
  redraw:  p  => drawCumulativeForest(
    cumForestPlot.args.results, cumForestPlot.args.profile,
    { pageSize: cumForestPlot.args.pageSize, page: p }
  ),
});

// ---------------- LAZY / DEFERRED PLOT RENDERING ----------------
// Panels that start collapsed (all panels are reset to collapsed on every run)
// need not be drawn immediately. drawIfVisible() skips the draw and stores a
// deferred function instead.  When the user opens a panel, the stored function
// fires once, then is discarded.
//
// Panels deferred: pubBiasSection, diagnosticSection, cumulativeSection,
//                  altVizSection, robSection.
// Not deferred:    forestSection (always visible div), studyTableSection
//                  (HTML, not D3), sensitivitySection, regressionSection
//                  (conditionally shown — defer adds complexity for little gain).

const _deferredDraws = new Map();  // panel element → pending draw function

function drawIfVisible(sectionId, drawFn) {
  const panel = document.getElementById(sectionId);
  if (!panel) { drawFn(); return; }

  // <details>.open is true when open; non-details (div) should always draw.
  const isOpen      = panel.tagName === "DETAILS" ? panel.open : true;
  const isDisplayed = panel.style.display !== "none";

  if (isOpen && isDisplayed) {
    drawFn();
    _deferredDraws.delete(panel);
    delete panel.dataset.dirty;
  } else {
    _deferredDraws.set(panel, drawFn);
    panel.dataset.dirty = "1";
  }
}

// Wire one-time toggle listeners so deferred draws fire when a panel opens.
// toggle does not bubble, so each panel gets its own listener.
[
  "pubBiasSection", "diagnosticSection", "cumulativeSection",
  "altVizSection",  "robSection",
].forEach(id => {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.addEventListener("toggle", () => {
    if (panel.open && _deferredDraws.has(panel)) {
      _deferredDraws.get(panel)();
      _deferredDraws.delete(panel);
      delete panel.dataset.dirty;
    }
  });
});

// flushDeferredDraws()
// Force-executes every pending deferred draw function so that all plot SVGs are
// populated before report / export serialisation reads them from the DOM.
// Called by buildReportAndResync() and the DOCX export handler.
function flushDeferredDraws() {
  for (const [panel, drawFn] of _deferredDraws) {
    try { drawFn(); } catch (e) { console.error("flushDeferredDraws: error in draw for", panel?.id, e); }
    _deferredDraws.delete(panel);
    delete panel.dataset.dirty;
  }
}

// markStale()
// Signals that the displayed results are out of date with the current inputs.
// Shows the stale-results banner and adds the "stale" CSS class to the results
// toggle button so the user can see at a glance that a re-run is needed.
// No-ops until the first successful runAnalysis() call (appState.hasRunOnce = true),
// which prevents the banner from appearing before any results exist.
function markStale() {
  // Only show stale indicators after the first run has produced results.
  if (!appState.hasRunOnce) return;
  staleBanner.style.display = "block";
  _toggleResults.classList.add("stale");
}

// ---------------- SENSITIVITY ANALYSIS PANEL ----------------

const TAU_METHOD_LABELS = {
  DL:   "DerSimonian-Laird (DL)",
  REML: "REML",
  PM:   "Paule-Mandel (PM)",
  ML:   "Maximum Likelihood (ML)",
  HS:   "Hunter-Schmidt (HS)",
  HE:   "Hedges (HE)",
  SJ:   "Sidik-Jonkman (SJ)",
};

function sensFv(v)  { return isFinite(v) ? v.toFixed(3) : "—"; }
function sensFvp(v) { return isFinite(v) ? (v < 0.001 ? "<.001" : v.toFixed(3)) : "—"; }
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
      <th>p</th>
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
function renderSensitivityPanel(studies, m, method, ciMethod, profile, { isMHFallback = false } = {}, alpha = 0.05) {
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
function renderStudyTable(studies, m, profile) {
  const container = document.getElementById("studyTable");
  if (!container) return;

  // For MH/Peto use FE (τ²=0) weights; for RE use τ²-inflated weights.
  const tau2   = (m.isMH || m.isPeto || !isFinite(m.tau2)) ? 0 : m.tau2;
  const real   = studies.filter(d => !d.filled);
  const totalW = real.reduce((s, d) => s + 1 / (d.vi + tau2), 0);

  // SE column header: label the scale when yi is stored on a transformed scale.
  const seLabel = profile.isTransformedScale ? "SE (transformed)" : "SE";

  // Escape HTML to prevent injection from user-supplied study labels.
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Build one row object per study
  const rows = studies.map(d => {
    const wi    = 1 / (d.vi + tau2);
    const pct   = d.filled ? null : wi / totalW * 100;
    const ef    = profile.transform(d.yi);
    const lo    = profile.transform(d.yi - Z_95 * d.se);
    const hi    = profile.transform(d.yi + Z_95 * d.se);
    return { label: escapeHTML(d.label), ef, lo, hi, se: d.se, pct, filled: !!d.filled };
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
    </tr>`;

  const studyRows = rows.map(r => `
    <tr class="${r.filled ? "imputed-row" : ""}">
      <td>${truncate(r.label, 40)}</td>
      <td>${fmtVal(r.ef)}</td>
      <td>${fmtVal(r.lo)}</td>
      <td>${fmtVal(r.hi)}</td>
      <td>${fmtVal(r.se)}</td>
      <td>${fmtPct(r.pct)}</td>
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
    </tr>`;

  container.innerHTML = `<table class="study-table">${headerRow}${studyRows}${pooledRow}</table>`;
}

// ---------------- P-CURVE PANEL ----------------
function renderPCurvePanel(pcurve) {
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
  function fmtP(p) {
    if (!isFinite(p)) return "—";
    if (p < 0.001)  return "< 0.001";
    if (p < 0.01)   return "< 0.01";
    return p.toFixed(3);
  }

  const verdictLabels = {
    "evidential":     "Evidential value",
    "no-evidential":  "No evidential value",
    "inconclusive":   "Inconclusive",
    "insufficient":   "Insufficient data",
  };

  panel.innerHTML = `
    <div class="pcurve-summary">
      <span>P-curve &nbsp;·&nbsp; <strong>${pcurve.k}</strong> significant result${pcurve.k !== 1 ? "s" : ""} (p &lt; .05)</span>
      <span>Right-skew test: Z = <strong>${fmtZ(pcurve.rightSkewZ)}</strong>, p = <strong>${fmtP(pcurve.rightSkewP)}</strong></span>
      <span>Flatness test: Z = <strong>${fmtZ(pcurve.flatnessZ)}</strong>, p = <strong>${fmtP(pcurve.flatnessP)}</strong></span>
      <span class="status-pill ${pcurve.verdict}">${verdictLabels[pcurve.verdict] ?? pcurve.verdict}</span>
    </div>`;

  drawPCurve(pcurve);
}

// ---------------- P-UNIFORM PANEL ----------------
function renderPUniformPanel(puniform, m, profile) {
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
  function fmtP(p) {
    if (!isFinite(p)) return "—";
    if (p < 0.001) return "< 0.001";
    if (p < 0.01)  return "< 0.01";
    return p.toFixed(3);
  }
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
      <span>Significance test: Z = <strong>${fmtZ(puniform.Z_sig)}</strong>, p = <strong>${fmtP(puniform.p_sig)}</strong></span>
      <span>Bias test: Z = <strong>${fmtZ(puniform.Z_bias)}</strong>, p = <strong>${fmtP(puniform.p_bias)}</strong></span>
      ${flags.join(" ")}
    </div>`;

  drawPUniform(puniform, m, profile);
}

// ---------------- SELECTION MODEL PANEL ----------------
function renderSelectionModelPanel(r, mode, profile) {
  const panel = document.getElementById("selectionModelPanel");
  if (!panel) return;

  function fmtV(v) { return isFinite(v) ? fmt(v) : "—"; }
  function fmtP(p) {
    if (!isFinite(p)) return "—";
    if (p < 0.001) return "< 0.001";
    if (p < 0.01)  return "< 0.01";
    return p.toFixed(3);
  }
  function fmtDisp(v) { return isFinite(v) ? fmt(profile.transform(v)) : "—"; }

  // Not run (meta-regression active)
  if (r === null) {
    panel.innerHTML = `${hBtn("sel.model")}<p class="sel-note">Selection model not available when meta-regression is active.</p>`;
    return;
  }

  // Insufficient k
  if (r.error === "insufficient_k") {
    panel.innerHTML = `${hBtn("sel.model")}<p class="sel-note">Insufficient studies: need at least ${r.minK} for ${r.K} intervals (have ${r.k}).</p>`;
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

  // ---- LRT row (MLE only) ----
  const lrtRow = isMLE
    ? `<tr><td>LRT (H₀: no selection)</td><td colspan="${K}">χ²(${r.LRTdf}) = ${fmtV(r.LRT)}, p = ${fmtP(r.LRTp)}</td></tr>`
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

function buildInfluenceHTML(influence) {
  const k    = influence.length;
  const dffitsThresh   = 3 * Math.sqrt(1 / Math.max(k - 1, 1));
  const covRatioThresh = 1 + 1 / k;
  const rows = influence.map(d => {
    const anyFlag  = d.outlier || d.influential || d.highLeverage || d.highCookD || d.highDffits || d.highCovRatio;
    const rowStyle = anyFlag ? "class='results-row-flagged'" : "";
    const hatStyle      = d.highLeverage  ? " style='color:orange;font-weight:bold;'" : "";
    const cookStyle     = d.highCookD     ? " style='color:orange;font-weight:bold;'" : "";
    const dffitsStyle   = d.highDffits    ? " style='color:orange;font-weight:bold;'" : "";
    const covRatioStyle = d.highCovRatio  ? " style='color:orange;font-weight:bold;'" : "";
    const flags = [
      d.outlier      ? "Outlier"      : "",
      d.influential  ? "Influential"  : "",
      d.highLeverage ? "Hi-Lev"       : "",
      d.highCookD    ? "Hi-Cook"      : "",
      d.highDffits   ? "Hi-DFFITS"    : "",
      d.highCovRatio ? "Hi-CovRatio"  : "",
    ].filter(Boolean).join(", ");
    return `<tr ${rowStyle}>
      <td>${d.label}</td>
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
    <small style="color:#aaa;">Thresholds: Hat &gt; ${fmt(2/k)} (= 2/k); Cook's D &gt; ${fmt(4/k)} (= 4/k); DFFITS &gt; ${fmt(dffitsThresh)} (= 3·√(1/(k−1))); CovRatio &gt; ${fmt(covRatioThresh)} (= 1+1/k)</small>`;
}

// Jeffreys (1961) interpretation scale for BF₁₀
function bayesInterpretation(BF10) {
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

function buildBayesSummaryHTML(result, profile, reMean) {
  const muDisp   = profile.transform(result.muMean);
  const muCIDisp = result.muCI.map(v => profile.transform(v));
  return `
    <table class="stats-table" style="margin-bottom:8px">
      <tr>
        <td>Posterior mean μ</td>
        <td>${fmt(muDisp)}</td>
        <td>${getCiLabel().replace("CI","CrI")} [${fmt(muCIDisp[0])}, ${fmt(muCIDisp[1])}]</td>
      </tr>
      <tr>
        <td>Posterior mean τ</td>
        <td>${fmt(result.tauMean)}</td>
        <td>${getCiLabel().replace("CI","CrI")} [${fmt(result.tauCI[0])}, ${fmt(result.tauCI[1])}]</td>
      </tr>
      ${isFinite(reMean) ? `<tr>
        <td>Frequentist RE (comparison)</td>
        <td>${fmt(profile.transform(reMean))}</td>
        <td></td>
      </tr>` : ""}
      ${isFinite(result.BF10) ? `<tr>
        <td>Bayes Factor BF\u2081\u2080 (H\u2081: \u03BC\u22600)</td>
        <td>${result.BF10 >= 1000 ? result.BF10.toExponential(2) : result.BF10 < 0.001 ? result.BF10.toExponential(2) : result.BF10.toFixed(3)}</td>
        <td>${bayesInterpretation(result.BF10)}</td>
      </tr>
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

function buildSensitivityHTML(rows, profile, ciLevel, currentSigmaMu, currentSigmaTau) {
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

function buildSubgroupHTML(subgroup, profile, hasClusters) {
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
      <td>${g}</td>
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
      <tr style="font-weight:bold;">
        <td colspan="7">Q_between = ${subgroup.Qbetween.toFixed(3)}, df = ${subgroup.df}, p = ${subgroup.p.toFixed(4)}</td>
      </tr>
    </table>`;
}

// -----------------------------------------------------------------------------
// renderGoshInfo(result, profile)
// -----------------------------------------------------------------------------
function renderGoshInfo(result, profile) {
  const el = document.getElementById("goshInfo");
  if (!el) return;
  const { count, k, sampled } = result;
  const sampleNote = sampled
    ? ` (random sample of ${count.toLocaleString()} of ${(Math.pow(2, k) - 1).toLocaleString()} possible subsets)`
    : ` (all ${count.toLocaleString()} non-empty subsets)`;
  el.innerHTML = `<p class="gosh-info">GOSH plot: ${k} studies, fixed-effects model${sampleNote}.</p>`;
}

// -----------------------------------------------------------------------------
// runGosh()
// -----------------------------------------------------------------------------
// Spins up a gosh.worker.js Web Worker (with chunked-setTimeout fallback for
// file:// origins that block Workers) and renders the GOSH plot on completion.
// Cancels any previously running Worker before starting a new one.
// -----------------------------------------------------------------------------
function runGosh() {
  // ---- Read study data from current analysis state ----
  const effectType = document.getElementById("effectType").value;
  const profile    = getProfile(effectType);

  // Collect valid studies from the input table, mirroring runAnalysis().
  // Rows start at index 1 (index 0 is the header row).
  const rows = document.querySelectorAll("#inputTable tr");
  const studies = [];
  for (let i = 1; i < rows.length; i++) {
    const row    = rows[i];
    if (!validateRow(row)) continue;
    const inputs = [...row.querySelectorAll("input")].map(x => x.value);
    const studyInput = { label: inputs[0] || `Row ${i}` };
    profile.inputs.forEach((key, idx) => {
      studyInput[key] = profile.rawInputs?.has(key) ? inputs[idx + 1] : +inputs[idx + 1];
    });
    const s = profile.compute(studyInput);
    if (isFinite(s.yi) && isFinite(s.vi) && s.vi > 0) {
      studies.push(s);
    }
  }

  const k = studies.length;
  const elInfo    = document.getElementById("goshInfo");
  const elPlot    = document.getElementById("goshPlotBlock");
  const elProg    = document.getElementById("goshProgress");
  const elBar     = document.getElementById("goshProgressBar");
  const elLabel   = document.getElementById("goshProgressLabel");
  const elRun     = document.getElementById("goshRun");
  const elCancel  = document.getElementById("goshCancel");

  if (k < 2) {
    if (elInfo) elInfo.innerHTML = '<p class="gosh-info">GOSH requires at least 2 valid studies.</p>';
    return;
  }
  if (k > GOSH_MAX_K) {
    if (elInfo) elInfo.innerHTML = `<p class="gosh-info">GOSH supports at most ${GOSH_MAX_K} studies (${k} present).</p>`;
    return;
  }

  // Cancel any running Worker
  if (goshState.worker) {
    goshState.worker.terminate();
    goshState.worker = null;
  }

  const yi = studies.map(s => s.yi);
  const vi = studies.map(s => s.vi);
  const maxSubsets = parseInt(document.getElementById("goshMaxSubsets").value, 10);

  function resetControls() {
    if (elRun)    { elRun.disabled = false; }
    if (elCancel) { elCancel.disabled = true; }
  }

  // Show progress bar, hide old plot
  if (elProg)   { elProg.hidden  = false; }
  if (elPlot)   { elPlot.style.display = "none"; }
  if (elInfo)   { elInfo.innerHTML = ""; }
  if (elBar)    { elBar.value = 0; }
  if (elLabel)  { elLabel.textContent = "Starting…"; }
  if (elRun)    { elRun.disabled = true; }
  if (elCancel) { elCancel.disabled = false; }

  function onDone(result) {
    goshState.result  = result;
    goshState.profile = profile;
    if (elProg) { elProg.hidden = true; }
    if (elPlot) { elPlot.style.display = ""; }
    resetControls();
    const xAxis = document.getElementById("goshXAxis").value;
    drawGoshPlot(result, profile, { xAxis });
    renderGoshInfo(result, profile);
  }

  function onProgress(done, total) {
    const pct = Math.round(done / total * 100);
    if (elBar)   { elBar.value = pct; }
    if (elLabel) { elLabel.textContent = `${done.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`; }
  }

  function onError(msg) {
    if (elProg) { elProg.hidden = true; }
    if (elInfo) { elInfo.innerHTML = `<p class="gosh-info" style="color:var(--danger,red)">Error: ${msg}</p>`; }
    resetControls();
  }

  // Cancel button — terminates the Worker and resets the UI
  if (elCancel) {
    elCancel.onclick = () => {
      if (goshState.worker) {
        goshState.worker.terminate();
        goshState.worker = null;
      }
      if (elProg)  { elProg.hidden = true; }
      if (elInfo)  { elInfo.innerHTML = '<p class="gosh-info">Cancelled.</p>'; }
      resetControls();
    };
  }

  // ---- Try Worker first ----
  let workerOk = false;
  try {
    const workerUrl = new URL("./gosh.worker.js", import.meta.url).href;
    const w = new Worker(workerUrl);
    goshState.worker = w;
    workerOk = true;

    w.onmessage = function(e) {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress(msg.done, msg.total);
      } else if (msg.type === "done") {
        goshState.worker = null;
        onDone(msg);
      } else if (msg.type === "error") {
        goshState.worker = null;
        onError(msg.message);
      }
    };
    w.onerror = function(e) {
      // Worker.onerror fires for two distinct cases:
      //
      // 1. Load failure (e.g. file:// security restriction in Chrome):
      //    e.lineno === 0, e.filename === "".
      //    Safe to fall back to synchronous computation — the inputs are valid
      //    and the JS engine itself is fine.
      //
      // 2. Runtime exception inside the worker (uncaught throw, OOM when
      //    allocating Float32Array/Set for large k, unexpected JS error):
      //    e.lineno > 0, e.filename points to gosh.worker.js.
      //    Falling back to synchronous is NOT safe — the same allocation that
      //    crashed the worker will crash the main thread (and block the UI).
      //    Surface the error to the user instead.
      //
      // Distinguishing the two: e.lineno is 0 for network/security load errors
      // and non-zero for uncaught runtime exceptions.
      goshState.worker = null;

      if (e.lineno > 0) {
        // Runtime crash inside the worker — do not attempt synchronous fallback.
        const detail = e.message || "unknown error";
        onError(`GOSH worker crashed (${detail}). Try reducing the number of studies or max subsets.`);
        return;
      }

      // Load failure — fall back to synchronous computation on the main thread.
      // With GOSH_MAX_ENUM_K=15 the sync path handles ≤32 767 subsets in < 5 ms
      // and up to maxSubsets sampled subsets (default 50 K) in < 20 ms, so there
      // is no meaningful UI blocking.
      const result = goshCompute(yi, vi, { maxSubsets });
      if (result.error) { onError(result.error); return; }
      onDone(result);
    };
    w.postMessage({ yi, vi, maxSubsets });
  } catch (_) {
    workerOk = false;
  }

  if (!workerOk) {
    // ---- Fallback: synchronous computation on main thread ----
    const result = goshCompute(yi, vi, { maxSubsets });
    if (result.error) { onError(result.error); return; }
    onDone(result);
  }
}

// -----------------------------------------------------------------------------
// runBayesUpdate()
// -----------------------------------------------------------------------------
// Re-runs only the Bayesian meta-analysis using the current prior inputs and
// the studies / reMean cached in bayesState from the last runAnalysis() call.
// Called by the "Update" button inside the Bayesian section.
// -----------------------------------------------------------------------------
function runBayesUpdate() {
  if (!bayesState.studies || bayesState.studies.length < 2) return;
  const mu0      = parseFloat(document.getElementById("bayesMu0")?.value)      || 0;
  const sigmaMu  = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaMu")?.value)  || 1);
  const sigmaTau = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaTau")?.value) || 0.5);
  const result   = bayesMeta(bayesState.studies, { mu0, sigma_mu: sigmaMu, sigma_tau: sigmaTau });
  if (result.error) return;
  const bayesUpdateClusterNote = bayesState.studies.some(s => s.cluster)
    ? `<p class="reg-note" style="color:var(--muted);margin:0 0 6px">ℹ Bayesian analysis does not incorporate cluster-robust adjustment.</p>`
    : "";
  document.getElementById("bayesSummary").innerHTML =
    bayesUpdateClusterNote + buildBayesSummaryHTML(result, bayesState.profile, bayesState.reMean);
  drawBayesMuPosterior(result, { reMean: bayesState.reMean });
  drawBayesTauPosterior(result);
  document.getElementById("bayesGridWarning").style.display =
    result.grid_truncated ? "" : "none";
  if (appState.reportArgs) {
    appState.reportArgs = { ...appState.reportArgs, bayesResult: result };
  }
  const ciLevel = document.getElementById("ciLevel")?.value ?? "95";
  renderSensitivity(mu0, sigmaMu, sigmaTau, ciLevel);
}

document.getElementById("bayesUpdate").addEventListener("click", runBayesUpdate);

// -----------------------------------------------------------------------------
// renderSensitivity(mu0, sigmaMu, sigmaTau, ciLevel)
// -----------------------------------------------------------------------------
// Runs priorSensitivity() using the cached bayesState studies and renders the
// result into the #bayesSensitivity collapsible section. Called automatically
// from runBayesUpdate() and the Bayes block in runAnalysis().
// -----------------------------------------------------------------------------
function renderSensitivity(mu0, sigmaMu, sigmaTau, ciLevel) {
  if (!bayesState.studies || bayesState.studies.length < 2) return;
  const alpha = { "90": 0.10, "95": 0.05, "99": 0.01 }[ciLevel] ?? 0.05;
  const rows = priorSensitivity(bayesState.studies, { mu0, alpha });
  const el = document.getElementById("bayesSensitivity");
  if (el) el.innerHTML = buildSensitivityHTML(rows, bayesState.profile, ciLevel, sigmaMu, sigmaTau);
  const section = document.getElementById("bayesSensitivitySection");
  if (section) section.style.display = "";
  if (appState.reportArgs) {
    appState.reportArgs = { ...appState.reportArgs, sensitivityRows: rows };
  }
}

// -----------------------------------------------------------------------------
// runAnalysis() → boolean
// -----------------------------------------------------------------------------
// Master orchestration function. Reads the entire UI state, runs the full
// statistical pipeline, and updates every output panel. Called on every
// meaningful input change (via the debounced scheduleSave pathway).
//
// Parameters
// ----------
//   none — all inputs are read directly from the DOM
//
// Return value
// ------------
//   true  — analysis completed successfully (≥1 valid study)
//   false — bailed out early; no valid studies after row validation
//
// Pipeline (in execution order)
// ------------------------------
//   1. Read effectType → look up effectProfile
//   2. For each table row:
//        a. validate row (hard check — invalid rows are excluded)
//        b. parse raw inputs via profile.inputs field list
//        c. detect missing correlation in paired designs (r defaults to 0.5)
//        d. collect soft warnings (range / plausibility checks)
//        e. call profile.compute() → { yi, vi, se, w, … }
//        f. attach subgroup label and moderator values
//   3. Guard: if studies[] is empty, show placeholder and return false
//   4. Clear stale indicators; unlock results panel on first successful run
//   5. Read τ² method, CI method, trim-fill flags
//   6. Optionally run trimFill() → augmented `all` dataset
//   7. meta()                → pooled FE/RE estimates, heterogeneity
//   8. eggerTest()           → funnel asymmetry (regression-based)
//   9. beggTest()            → rank-correlation bias test
//  10. fatPetTest()          → FAT/PET regression
//  11. failSafeN()           → Rosenthal + Orwin fail-safe N
//  12. influenceDiagnostics()→ leave-one-out, DFBETA, hat, Cook's D
//  13. subgroupAnalysis()    → per-group pooling + Q_between
//  14. Back-transform estimates through profile.transform() for display
//  15. Write results panel HTML
//  16. renderStudyTable(), renderSensitivityPanel()
//  17. metaRegression() → renderRegressionPanel() + drawBubble() per moderator
//  18. drawForest()  (page 0) → renderForestNav()
//       ↳ caches args in forestPlot.args for page-navigation re-renders
//  19. Caches full state in appState.reportArgs for HTML-export buttons
//  20. drawFunnel(), drawInfluencePlot()
//  21. cumulativeMeta() → drawCumulativeForest()
//  22. updateValidationWarnings()
//  23. return true
//
// Side effects
// ------------
//   DOM   — rewrites #results, #forestPlot, #funnelPlot, #influencePlot,
//            #cumulativeForestPlot, #studyTable, #sensitivityPanel,
//            #regressionPanel, #bubblePlots, forest nav buttons, stale banner
//   State — forestPlot.args, appState.reportArgs, appState.hasRunOnce
//            forestPlot.page ← 0, caterpillarPlot.page ← 0, cumForestPlot.page ← 0
// -----------------------------------------------------------------------------
async function runAnalysis() {
  if (_analysisRunning) return false;
  _analysisRunning = true;
  const _runBtn = document.getElementById("run");
  if (_runBtn) { _runBtn.disabled = true; _runBtn.textContent = "Running…"; }
  await new Promise(r => setTimeout(r, 0)); // yield so browser paints button state
  try {
  performance.mark("runAnalysis:start");
  scheduleSave();
  // Cancel any in-progress GOSH computation.
  if (goshState.worker) {
    goshState.worker.terminate();
    goshState.worker = null;
    const elRun    = document.getElementById("goshRun");
    const elCancel = document.getElementById("goshCancel");
    const elProg   = document.getElementById("goshProgress");
    if (elRun)    elRun.disabled    = false;
    if (elCancel) elCancel.disabled = true;
    if (elProg)   elProg.hidden     = true;
  }
  // Reset accordion sections to their default open/closed states on each run.
  document.querySelectorAll(".results-section").forEach(d => d.removeAttribute("open"));
  // Reset all paginated plots to page 0 unconditionally (including on early
  // return paths below) so stale page state never outlives a run attempt.
  forestPlot.page = 0;
  caterpillarPlot.page = 0;
  cumForestPlot.page = 0;

  // ---- Cache DOM element references (avoids repeated getElementById lookups) ----
  const elEffectType         = document.getElementById("effectType");
  const elResults            = document.getElementById("results");
  const elPubBiasStats       = document.getElementById("pubBiasStats");
  const elInfluenceDiagTable = document.getElementById("influenceDiagTable");
  const elSubgroupSection    = document.getElementById("subgroupSection");
  const elSubgroupTable      = document.getElementById("subgroupTable");
  const elTauMethod          = document.getElementById("tauMethod");
  const elCiMethod           = document.getElementById("ciMethod");
  const elUseTrimFill        = document.getElementById("useTrimFill");
  const elTfEstimator        = document.getElementById("tfEstimator");
  const elUseTFAdjusted      = document.getElementById("useTFAdjusted");
  const elBubblePlots        = document.getElementById("bubblePlots");
  const elForestPageSize     = document.getElementById("forestPageSize");
  const elBaujatPlotBlock    = document.getElementById("baujatPlotBlock");
  const elQQPlotBlock        = document.getElementById("qqPlotBlock");
  const elRadialPlotBlock    = document.getElementById("radialPlotBlock");
  const elLabbeBlock         = document.getElementById("labbeBlock");
  const elBlupBlock          = document.getElementById("blupBlock");
  const elBlupNav            = document.getElementById("blupNav");
  const elCumulativeOrder    = document.getElementById("cumulativeOrder");
  const elCumForestPageSize  = document.getElementById("cumulativeForestPageSize");
  const elCumFunnelStep      = document.getElementById("cumulativeFunnelStep");
  const elCumFunnelBlock     = document.getElementById("cumulativeFunnelBlock");
  const elOrchardPlotBlock   = document.getElementById("orchardPlotBlock");
  const elCatPageSize        = document.getElementById("caterpillarPageSize");
  const elCaterpillarBlock   = document.getElementById("caterpillarPlotBlock");
  const elRobSection         = document.getElementById("robSection");
  const elProfileLikScale    = document.getElementById("profileLikScale");
  const elSelPreset          = document.getElementById("selPreset");

  const type = elEffectType.value;
  const profile = effectProfiles[type];
  if (!profile) return;

  const rows = document.querySelectorAll("#inputTable tr");

  // Row inputs are ordered: [label, ...profile.inputs, group, ...moderators].
  // Pre-compute the offset so moderator values can be read from the already-
  // collected inputs array rather than querying the DOM for each moderator
  // on every row.
  const modOffset = profile.inputs.length + 3; // label(1) + effects(p) + group(1) + cluster(1)

  let studies = [];
  let excluded = [];
  let softWarnings = [];
  let missingCorrelation = false; // <-- NEW

  performance.mark("phase:parse:start");
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.classList.contains("row-pending-delete")) continue;
    const inputs = [...row.querySelectorAll("input")].map(x => x.value);

    const isValid = validateRow(row);

    const group   = row.querySelector(".group")?.value.trim() || "";
    const cluster = row.querySelector(".cluster")?.value.trim() || "";
    const label = inputs[0] || `Row ${i}`;

    const studyInput = { label };
    profile.inputs.forEach((key, idx) => {
      studyInput[key] = profile.rawInputs?.has(key) ? inputs[idx + 1] : +inputs[idx + 1];
    });

    // --- NEW: check for missing correlation in paired designs ---
    if ((type === "MD_paired" || type === "SMD_paired") && !isFinite(studyInput.r)) {
      missingCorrelation = true;
      // Optionally, assume r = 0.5 for computation
      studyInput.r = 0.5;
    }

    // Collect soft warnings regardless of validity
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

    // ---- Moderator values ----
    moderators.forEach(({ name, type }, modIdx) => {
      const raw = (inputs[modOffset + modIdx] ?? "").trim();
      study[name] = type === "continuous" ? (raw === "" ? NaN : +raw) : raw;
    });

    studies.push(study);
  }
  performance.measure("phase:parse", "phase:parse:start");

  if (!studies.length) {
    if (outputPlaceholder) {
      outputPlaceholder.style.display = "";
      outputPlaceholder.textContent = "No valid studies to analyse. Check the input table for errors.";
    }
    performance.measure("runAnalysis", "runAnalysis:start");
    return false;
  }

  // Clear stale indicators and record first successful run.
  if (outputPlaceholder) outputPlaceholder.style.display = "none";
  staleBanner.style.display = "none";
  _toggleResults.classList.remove("stale");
  if (!appState.hasRunOnce) {
    appState.hasRunOnce = true;
    _toggleResults.disabled = false;
  }

  const method = elTauMethod?.value || "DL";
  const ciMethod = elCiMethod?.value || "normal";
  const alpha = getCiAlpha();
  const useTF = elUseTrimFill?.checked;
  const tfEstimator = elTfEstimator?.value || "L0";
  const useTFAdjusted = elUseTFAdjusted?.checked;

  const isMHorPeto  = method === "MH" || method === "Peto";
  const hasClusters = studies.some(s => s.cluster);
  const rveRho      = parseFloat(document.getElementById("rveRho")?.value ?? 0.8);

  performance.mark("phase:meta:start");
  let tf = [], all = studies;
  if (useTF && !isMHorPeto) { tf = trimFill(studies, method, tfEstimator); all = [...studies, ...tf]; }

  let m;
  if      (method === "MH"  ) m = metaMH(studies, type, alpha);
  else if (method === "Peto") m = metaPeto(studies, alpha);
  else if (hasClusters)       m = robustMeta(studies, method, ciMethod, alpha);
  else                        m = meta(studies, method, ciMethod, alpha);
  performance.measure("phase:meta", "phase:meta:start");

  if (m.error) {
    elResults.innerHTML = `<b style="color:var(--warn)">Error: ${m.error}</b>`;
    performance.measure("runAnalysis", "runAnalysis:start");
    return false;
  }

  const profileLikResult =
    (method === "ML" || method === "REML") && studies.length >= 2
      ? profileLikTau2(studies, { method })
      : null;

  const elHetDiag = document.getElementById("hetDiagSection");
  if (profileLikResult && !profileLikResult.error) {
    elHetDiag.style.display = "";
    const xScale = elProfileLikScale?.value || "tau2";
    drawProfileLikTau2(profileLikResult, { xScale });
  } else {
    elHetDiag.style.display = "none";
  }

  const elBayes      = document.getElementById("bayesSection");
  const bayesMu0     = parseFloat(document.getElementById("bayesMu0")?.value)     || 0;
  const bayesSigmaMu = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaMu")?.value)  || 1);
  const bayesSigmaTau = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaTau")?.value) || 0.5);
  let bayesResult = null;
  performance.mark("phase:bayes:start");
  if (studies.length >= 2 && !isMHorPeto) {
    const reMeanRef = isFinite(m.RE) ? m.RE : m.FE;
    bayesState.studies = studies;
    bayesState.reMean  = reMeanRef;
    bayesState.profile = profile;
    bayesResult = bayesMeta(studies, { mu0: bayesMu0, sigma_mu: bayesSigmaMu, sigma_tau: bayesSigmaTau, alpha });
    if (!bayesResult.error) {
      elBayes.style.display = "";
      const bayesClusterNote = hasClusters
        ? `<p class="reg-note" style="color:var(--muted);margin:0 0 6px">ℹ Bayesian analysis does not incorporate cluster-robust adjustment.</p>`
        : "";
      document.getElementById("bayesSummary").innerHTML =
        bayesClusterNote + buildBayesSummaryHTML(bayesResult, profile, reMeanRef);
      drawBayesMuPosterior(bayesResult, { reMean: reMeanRef });
      drawBayesTauPosterior(bayesResult);
      document.getElementById("bayesGridWarning").style.display =
        bayesResult.grid_truncated ? "" : "none";
      renderSensitivity(bayesMu0, bayesSigmaMu, bayesSigmaTau, document.getElementById("ciLevel")?.value ?? "95");
    } else {
      elBayes.style.display = "none";
      const elSensSection = document.getElementById("bayesSensitivitySection");
      if (elSensSection) elSensSection.style.display = "none";
    }
  } else {
    bayesState.studies = null;
    elBayes.style.display = "none";
    const elSensSection = document.getElementById("bayesSensitivitySection");
    if (elSensSection) elSensSection.style.display = "none";
  }
  performance.measure("phase:bayes", "phase:bayes:start");

  // ---- RVE (Robust Variance Estimation) ----
  {
    const elRve         = document.getElementById("rveSection");
    const elRveSummary  = document.getElementById("rveSummary");
    const elRveSettings = document.getElementById("rveSettings");
    const showRve = hasClusters && !isMHorPeto;
    if (elRveSettings) elRveSettings.style.display = showRve ? "" : "none";
    if (elRve) {
      if (showRve) {
        elRve.style.display = "";
        const rve = rvePooled(studies, { rho: rveRho, alpha });
        if (rve.error) {
          elRveSummary.innerHTML = `<p class="reg-note" style="color:var(--color-warning)">⚠ RVE: ${rve.error}</p>`;
        } else {
          const rveEst  = profile.transform(rve.est);
          const rveLo   = profile.transform(rve.ci[0]);
          const rveHi   = profile.transform(rve.ci[1]);
          const reDisp  = profile.transform(m.RE);
          const diffDir = rve.est > m.RE ? "higher" : rve.est < m.RE ? "lower" : "equal";
          elRveSummary.innerHTML = `
            <div style="font-size:0.8125rem;line-height:1.9;margin-bottom:8px">
              ${hBtn("rve.model")}<b>RVE pooled estimate:</b> ${fmt(rveEst)}<br>
              CI [${fmt(rveLo)}, ${fmt(rveHi)}] | SE=${fmt(rve.se)} | t(${rve.df})=${fmt(rve.t)} | p=${fmt(rve.p)}<br>
              ρ=${rveRho.toFixed(2)} &nbsp;·&nbsp; m=${rve.kCluster} cluster${rve.kCluster === 1 ? "" : "s"} &nbsp;·&nbsp; k=${rve.k} studies<br>
              <span style="color:var(--fg-muted);font-size:0.93em">RE (cluster-robust): ${fmt(reDisp)} &nbsp;·&nbsp; RVE estimate is ${diffDir}.</span>
            </div>
          `;
        }
      } else {
        elRve.style.display = "none";
      }
    }
  }

  // ---- Three-Level Meta-Analysis ----
  {
    const elThree        = document.getElementById("threeLevelSection");
    const elThreeSummary = document.getElementById("threeLevelSummary");
    const showThree = hasClusters && !isMHorPeto;
    if (elThree) {
      if (showThree) {
        elThree.style.display = "";
        const tl = meta3level(studies, { method: "REML", alpha });
        if (tl.error) {
          elThreeSummary.innerHTML = `<p class="reg-note" style="color:var(--color-warning)">⚠ Three-level: ${tl.error}</p>`;
        } else {
          const muDisp  = profile.transform(tl.mu);
          const ciLoDisp = profile.transform(tl.ci[0]);
          const ciHiDisp = profile.transform(tl.ci[1]);
          elThreeSummary.innerHTML = `
            <div style="font-size:0.8125rem;line-height:1.9;margin-bottom:8px">
              ${hBtn("threelevel.model")}<b>Three-level pooled estimate:</b> ${fmt(muDisp)}<br>
              ${Math.round((1 - alpha) * 100)}% CI [${fmt(ciLoDisp)}, ${fmt(ciHiDisp)}] | SE=${fmt(tl.se)} | z=${fmt(tl.z)} | p=${fmt(tl.p)}<br>
              m=${tl.kCluster} cluster${tl.kCluster === 1 ? "" : "s"} &nbsp;·&nbsp; k=${tl.k} studies &nbsp;·&nbsp; df=${tl.df}<br>
              ${hBtn("threelevel.tau2")}σ²<sub>within</sub>=${fmt(tl.tau2_within)} &nbsp;·&nbsp; σ²<sub>between</sub>=${fmt(tl.tau2_between)}<br>
              ${hBtn("threelevel.I2")}I²<sub>within</sub>=${fmt(tl.I2_within)}% &nbsp;·&nbsp; I²<sub>between</sub>=${fmt(tl.I2_between)}%<br>
              ${hBtn("het.Q")}Q(${tl.df})=${fmt(tl.Q)} | method=REML
            </div>
          `;
        }
      } else {
        elThree.style.display = "none";
      }
    }
  }

  performance.mark("phase:pubbias:start");
  const egger   = eggerTest(studies);
  const begg    = beggTest(studies);
  const petpeese = petPeeseTest(studies);
  const fatpet   = petpeese.fat;
  const fsn     = failSafeN(studies);
  const tes     = tesTest(studies, m);
  const waap    = waapWls(studies);
  const pcurve   = pCurve(studies);
  const puniform = pUniform(studies, m);
  const harbord  = harbordTest(studies);
  const peters   = petersTest(studies);
  const deeks    = deeksTest(studies);
  const ruecker  = rueckerTest(studies);
  const hc      = henmiCopas(studies, alpha);
  performance.measure("phase:pubbias", "phase:pubbias:start");

  performance.mark("phase:influence:start");
  const influence = influenceDiagnostics(studies, method, ciMethod, alpha);
  performance.measure("phase:influence", "phase:influence:start");

  performance.mark("phase:subgroup:start");
  const subgroup = subgroupAnalysis(studies, method, ciMethod, alpha);
  performance.measure("phase:subgroup", "phase:subgroup:start");

  const influenceHTML = buildInfluenceHTML(influence);
  const hasSubgroup   = subgroup && subgroup.G >= 2;
  const subgroupHTML  = hasSubgroup ? buildSubgroupHTML(subgroup, profile, hasClusters) : "";

  // Adjusted RE
  let mAdjusted = null;
  if (useTF && useTFAdjusted && tf.length > 0) mAdjusted = meta([...studies,...tf], method, ciMethod, alpha);

  const FE_disp = profile.transform(m.FE);
  const RE_disp = profile.transform(m.RE);
  const ci_disp   = { lb: profile.transform(m.ciLow),   ub: profile.transform(m.ciHigh) };
  const feZ = normalQuantile(1 - alpha / 2);
  const feCi_disp = {
    lb: profile.transform(m.FE - feZ * m.seFE),
    ub: profile.transform(m.FE + feZ * m.seFE),
  };
  const pred_disp = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  const RE_adj_disp = useTF && mAdjusted ? profile.transform(mAdjusted.RE) : null;

  // --- INSERT CORRELATION WARNING ---
  let warningHTML = "";
  if (missingCorrelation) {
    warningHTML = `<div style="color: orange; font-weight: bold;">
      ⚠️ Some paired studies are missing correlation (r). Assumed r = 0.5 for computation.
    </div>`;
  }

  const methodLabel = m.isMH ? "MH" : m.isPeto ? "Peto" : "";

  // Cluster-robust banner (shown at top of results when cluster IDs are present)
  const clusterBanner = hasClusters
    ? (isMHorPeto
      ? `<div class="reg-note" style="color:var(--muted);margin:2px 0 6px">ℹ Cluster-robust SE is not available for M-H/Peto methods.</div>`
      : (m.isClustered
        ? `<div class="reg-note" style="margin:2px 0 6px">Cluster-robust SEs active (C&nbsp;=&nbsp;${m.clustersUsed} cluster${m.clustersUsed === 1 ? "" : "s"}${m.allSingletons ? " — all singletons (HC-robust)" : ""}).</div>`
        : (m.robustError
          ? `<div class="reg-note" style="color:var(--warn);margin:2px 0 6px">⚠ Cluster-robust SE: ${m.robustError}</div>`
          : "")))
    : "";

  // Robust CI display (shown after regular CI when clustering succeeded)
  const robust_ci_disp = m.isClustered
    ? { lb: profile.transform(m.robustCiLow), ub: profile.transform(m.robustCiHigh) }
    : null;
  const robustCILine = m.isClustered
    ? `${hBtn("cluster.robust")}Robust CI [${fmt(robust_ci_disp.lb)}, ${fmt(robust_ci_disp.ub)}] | SE=${fmt(m.robustSE)} | z=${fmt(m.robustStat)} | p=${fmt(m.robustPval)} (df=${m.robustDf})<br>`
    : "";

  const ciLbl = getCiLabel();
  elResults.innerHTML = warningHTML + clusterBanner + (isMHorPeto ? `
    <b>${profile.label} (${methodLabel}):</b> ${fmt(FE_disp)}, ${ciLbl} [${fmt(feCi_disp.lb)}, ${fmt(feCi_disp.ub)}]<br>
    <small style="color:var(--muted)">Fixed-effect only — no τ², RE estimate, or prediction interval.</small><br>
    ${hBtn("het.Q")}Q(${m.df})=${fmt(m.stat)} | p=${fmt(m.pval)} | ${hBtn("het.I2")}I²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%] | ${hBtn("het.H2")}H²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]
  ` : `
    <b>${profile.label} (FE):</b> ${fmt(FE_disp)}, ${ciLbl} [${fmt(feCi_disp.lb)}, ${fmt(feCi_disp.ub)}] |
    <b>${profile.label} (RE):</b> ${fmt(RE_disp)}, ${ciLbl} [${fmt(ci_disp.lb)}, ${fmt(ci_disp.ub)}]${m.isClustered ? ` | SE (model)=${fmt(m.seRE)}` : ""}<br>
    ${useTF && mAdjusted ? `<b>RE (adjusted):</b> ${fmt(RE_adj_disp)}${hasClusters ? ` <span style="color:var(--muted);font-size:0.85em">(cluster-robust not applied to imputed studies)</span>` : ""}<br>` : ""}
    ${robustCILine}${hBtn("het.tau2")}τ²=${fmt(m.tau2)} [${fmt(m.tauCI[0])}, ${isFinite(m.tauCI[1])?fmt(m.tauCI[1]):"∞"}] | ${hBtn("het.I2")}I²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%] | ${hBtn("het.H2")}H²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]<br>
    ${hBtn("het.Q")}${m.dist}-stat=${fmt(m.stat)} | p=${fmt(m.pval)}<br>
    ${hBtn("het.pred")}Prediction interval (Higgins 2009, t<sub>${m.df > 0 ? m.df - 1 : "—"}</sub>): ${isFinite(pred_disp.lb) ? `[${fmt(pred_disp.lb)}, ${fmt(pred_disp.ub)}]` : "NA (k &lt; 3)"}
  `);

  const eggerRobustNote  = egger.clustersUsed  ? ` | p<sub>robust</sub>=${isFinite(egger.robustInterceptP)  ? fmt(egger.robustInterceptP)  : "—"}` : "";
  const fatpetRobustNote = fatpet.clustersUsed ? ` | p<sub>FAT,rob</sub>=${isFinite(fatpet.robustSlopeP) ? fmt(fatpet.robustSlopeP) : "—"} · p<sub>PET,rob</sub>=${isFinite(fatpet.robustInterceptP) ? fmt(fatpet.robustInterceptP) : "—"}` : "";

  elPubBiasStats.innerHTML = `
    &nbsp;&nbsp;${hBtn("bias.egger")}Egger: intercept=${isFinite(egger.intercept)?fmt(egger.intercept):"NA"} | p=${isFinite(egger.p)?fmt(egger.p):"NA (k<3)"}${eggerRobustNote}<br>
    &nbsp;&nbsp;${hBtn("bias.begg")}Begg: τ=${isFinite(begg.tau)?fmt(begg.tau):"NA"} | p=${isFinite(begg.p)?fmt(begg.p):"NA (k<3)"}<br>
    &nbsp;&nbsp;${hBtn("bias.fatpet")}FAT (bias): β₁=${isFinite(fatpet.slope)?fmt(fatpet.slope):"NA"} | p=${isFinite(fatpet.slopeP)?fmt(fatpet.slopeP):"NA (k<3)"} &nbsp;·&nbsp; PET (effect at SE→0): ${isFinite(fatpet.intercept)?fmt(profile.transform(fatpet.intercept)):"NA"} | p=${isFinite(fatpet.interceptP)?fmt(fatpet.interceptP):"NA (k<3)"}${fatpetRobustNote}<br>
    &nbsp;&nbsp;${hBtn("bias.petpeese")}${petpeese.usePeese?"<b>":""}PET-PEESE (corrected): ${(()=>{const src=petpeese.usePeese?petpeese.peese:petpeese.fat;return isFinite(src.intercept)?`${fmt(profile.transform(src.intercept))} [${petpeese.usePeese?"PEESE":"PET"}, p=${fmt(src.interceptP)}]`:"NA (k<3)";})()}${petpeese.usePeese?"</b>":""}<br>
    &nbsp;&nbsp;${hBtn("bias.fsn")}Fail-safe N (Rosenthal): ${isFinite(fsn.rosenthal)?Math.round(fsn.rosenthal):"NA"} &nbsp;·&nbsp; Orwin (trivial=0.1): ${isFinite(fsn.orwin)?Math.round(fsn.orwin):"NA"}<br>
    &nbsp;&nbsp;${hBtn("bias.tes")}TES: O=${isFinite(tes.O)?tes.O:"NA"} | E=${isFinite(tes.E)?fmt(tes.E):"NA"} | χ²=${isFinite(tes.chi2)?fmt(tes.chi2):"NA (k<2)"} | p=${isFinite(tes.p)?fmt(tes.p):"NA (k<2)"}${isFinite(tes.p)&&tes.p<0.1?" <span style='color:var(--color-warning)'>⚠ excess</span>":""}<br>
    &nbsp;&nbsp;${hBtn("bias.waap")}WAAP-WLS: ${isFinite(waap.estimate)?`${fmt(profile.transform(waap.estimate))} [${fmt(profile.transform(waap.ci[0]))}, ${fmt(profile.transform(waap.ci[1]))}] | p=${fmt(waap.p)} | k<sub>adequate</sub>=${waap.kAdequate}/${waap.k}${waap.fallback?" <span style='color:var(--fg-muted)'>(fallback to WLS)</span>":""}`:"NA (k<1)"}<br>
    &nbsp;&nbsp;${hBtn("bias.hc")}Henmi-Copas: ${hc.error ? `NA (${hc.error})` : `${fmt(profile.transform(hc.beta))} [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}] (DL τ²=${fmt(hc.tau2)}, t₀=${fmt(hc.t0)})`}<br>
    <b>Trim &amp; Fill:</b>${hBtn("bias.trimfill")} ${useTF?"ON":"OFF"} (${useTF?tfEstimator+" estimator, ":""}${tf.length} filled studies)
    <details style="margin-top:4px">
      <summary style="cursor:pointer;color:var(--fg-muted);font-size:0.9em">Additional regression tests (binary outcomes)</summary>
      <div style="margin-top:4px">
        &nbsp;&nbsp;${hBtn("bias.harbord")}Harbord: intercept=${isFinite(harbord.intercept)?fmt(harbord.intercept):"NA"} | p=${isFinite(harbord.interceptP)?fmt(harbord.interceptP):"NA (k&lt;3 or no 2×2 counts)"}<br>
        &nbsp;&nbsp;${hBtn("bias.peters")}Peters: intercept=${isFinite(peters.intercept)?fmt(peters.intercept):"NA"} | p=${isFinite(peters.interceptP)?fmt(peters.interceptP):"NA (k&lt;3 or no sample sizes)"}<br>
        &nbsp;&nbsp;${hBtn("bias.deeks")}Deeks: intercept=${isFinite(deeks.intercept)?fmt(deeks.intercept):"NA"} | p=${isFinite(deeks.interceptP)?fmt(deeks.interceptP):"NA (k&lt;3 or no 2×2 counts)"}<br>
        &nbsp;&nbsp;${hBtn("bias.ruecker")}Rücker: intercept=${isFinite(ruecker.intercept)?fmt(ruecker.intercept):"NA"} | p=${isFinite(ruecker.interceptP)?fmt(ruecker.interceptP):"NA (k&lt;3 or no 2×2 counts)"}
      </div>
    </details>
  `;
  elInfluenceDiagTable.innerHTML = influenceHTML;

  elSubgroupSection.style.display = hasSubgroup ? "" : "none";
  elSubgroupTable.innerHTML = (hasSubgroup && isMHorPeto)
    ? `<p class="reg-note" style="margin:4px 0 8px">⚠ Subgroup pooling uses inverse-variance (DL) weights — switch to DL or REML for M-H subgroup analysis.</p>` + subgroupHTML
    : subgroupHTML;

  renderStudyTable(all, m, profile);
  // MH/Peto can't run LOO; fall back to DL and don't pass MH/Peto m as precomputed.
  performance.mark("phase:loo:start");
  renderSensitivityPanel(studies, isMHorPeto ? null : m, isMHorPeto ? "DL" : method, ciMethod, profile, { isMHFallback: isMHorPeto }, alpha);
  performance.measure("phase:loo", "phase:loo:start");
  renderPCurvePanel(pcurve);
  renderPUniformPanel(puniform, m, profile);

  // ---- Selection model (Vevea-Hedges) ----
  // Skip when meta-regression moderators are active.
  let selResult = null;
  const selModeVal = document.getElementById("selMode").value;
  if (moderators.length === 0) {
    const selPreset = elSelPreset.value;
    const selSides  = parseInt(document.getElementById("selSides").value, 10);

    let selCuts, selSidesEff, selOmegaFixed;

    if (selModeVal === "sensitivity" && selPreset !== "custom") {
      // Named preset — cuts, sides, and omega all come from the preset
      const p      = SELECTION_PRESETS[selPreset];
      selCuts      = p.cuts;
      selSidesEff  = p.sides;
      selOmegaFixed = p.omega;
    } else {
      // MLE or custom sensitivity — parse the cutpoints text field
      const rawCuts = document.getElementById("selCuts").value
        .split(",").map(s => parseFloat(s.trim())).filter(isFinite);
      selCuts = rawCuts.length >= 2 && rawCuts[rawCuts.length - 1] === 1.0
        ? rawCuts
        : [...rawCuts.filter(c => c < 1), 1.0];
      selSidesEff  = selSides;
      selOmegaFixed = null;   // MLE: estimate weights; custom sensitivity: user must edit table
    }

    selResult = veveaHedges(studies, selCuts, selSidesEff, selOmegaFixed);
  }
  renderSelectionModelPanel(selResult, selModeVal, profile);

  // ---- Meta-regression / Location-scale model ----
  // buildDesignMatrix expects { key, type, transform }; ui state stores { name, type, transform }.
  const modSpec      = moderators.map(m => ({ key: m.name, type: m.type, transform: m.transform || "linear" }));
  const scaleModSpec = scaleModerators.map(m => ({ key: m.name, type: m.type, transform: m.transform || "linear" }));
  performance.mark("phase:regression:start");
  let reg = null, ls = null;
  if (scaleModerators.length > 0) {
    ls = lsModel(studies, modSpec, scaleModSpec, { ciMethod, alpha });
  } else if (moderators.length > 0) {
    reg = metaRegression(studies, modSpec, method, ciMethod, alpha);
  }
  performance.measure("phase:regression", "phase:regression:start");
  const kExcluded = (reg ?? ls) ? studies.length - (reg ?? ls).k : 0;
  if (ls) {
    renderLocationScalePanel(ls, ciMethod, kExcluded);
  } else {
    renderRegressionPanel(reg ?? {}, method, ciMethod, kExcluded);
  }

  // ---- Bubble plots (one per continuous location moderator) ----
  // With a single moderator: raw yi vs x (drawBubble) and partial residuals are
  // identical, so drawBubble is used.  With 2+ moderators: drawPartialResidualBubble
  // removes other predictors' contributions, making each plot unambiguous.
  // For the LS model, adapt ls to the shape drawBubble/drawPartialResidualBubble expect.
  const bubbleContainer = elBubblePlots;
  bubbleContainer.innerHTML = "";

  // Resolve the result object and moderator list to use for bubble plots.
  // For LS, build a shim using the location model; field names differ from reg.
  const bubbleResult = ls ? {
    tau2:     ls.tau2_mean,
    beta:     ls.beta,
    colNames: ls.locColNames,
    modColMap: ls.locColMap,
    modKnots:  ls.locKnots,
    vcov:     ls.vcov_beta,
    crit:     ls.crit,
    s2:       1,
    fitted:   ls.fitted,
    residuals: ls.residuals,
    studiesUsed: ls.studiesUsed,
    rankDeficient: ls.rankDeficient,
  } : reg;
  const usePartialBubble = moderators.length > 1;
  if (bubbleResult && !bubbleResult.rankDeficient) {
    moderators
      .filter(mod => mod.type === "continuous")
      .forEach((mod, i) => {
        const colIdxs = bubbleResult.modColMap && bubbleResult.modColMap[mod.name];
        if (!colIdxs || colIdxs.length === 0) return;

        // Wrap each bubble in a block-level div so export buttons sit above it.
        // data-moderator lets buildReport() attach per-moderator APA captions.
        const wrap = document.createElement("div");
        wrap.dataset.moderator = mod.name;
        bubbleContainer.appendChild(wrap);
        if (usePartialBubble) {
          drawPartialResidualBubble(bubbleResult.studiesUsed, bubbleResult, mod, wrap);
        } else {
          drawBubble(bubbleResult.studiesUsed, bubbleResult, mod, wrap);
        }

        // Assign a stable id to the SVG that was just appended, then add buttons.
        const bubbleSvg = wrap.querySelector("svg");
        if (bubbleSvg) {
          const svgId = `bubblePlot_${i}`;
          bubbleSvg.id = svgId;
          const exportDiv = document.createElement("div");
          exportDiv.className = "plot-export";
          exportDiv.innerHTML =
            `<button class="export-btn" data-target="${svgId}" data-format="svg">SVG</button>` +
            `<button class="export-btn" data-target="${svgId}" data-format="png">PNG</button>` +
            `<button class="export-btn" data-target="${svgId}" data-format="tiff">TIFF</button>`;
          wrap.insertBefore(exportDiv, bubbleSvg);
        }
        if (usePartialBubble) {
          const note = document.createElement("p");
          note.className = "reg-note";
          note.textContent = "Partial residual plot — other predictors held at zero (residuals).";
          wrap.appendChild(note);
        }
      });
  }

  // Cache args for nav re-renders (page already reset at top of runAnalysis).
  const rawPageSize  = elForestPageSize?.value ?? "30";
  const pageSize     = rawPageSize === "Infinity" ? Infinity : +rawPageSize;
  const forestOpts   = { ciMethod, profile, pageSize, pooledDisplay: forestPlot.poolDisplay, theme: forestPlot.theme, alpha, ciLabel: getCiLabel() };
  // For MH/Peto, substitute FE into RE slots so drawForest draws one diamond.
  const mForest = isMHorPeto
    ? { ...m, RE: m.FE, seRE: m.seFE, tau2: 0, predLow: NaN, predHigh: NaN }
    : m;
  forestPlot.args        = { studies: all, m: mForest, options: forestOpts };
  performance.mark("phase:plot:forest:start");
  const { totalPages } = drawForest(all, mForest, { ...forestOpts, page: forestPlot.page });
  performance.measure("phase:plot:forest", "phase:plot:forest:start");
  renderForestNav(totalPages);

  // Cache state for report export buttons.
  const baujatResult = baujat(studies);

  // Resolve human-readable label for the report interpretation sentence.
  const _selPreset = elSelPreset.value;
  const _selLabel  = selModeVal === "mle"
    ? "MLE"
    : _selPreset !== "custom"
      ? (SELECTION_PRESETS[_selPreset]?.label ?? _selPreset)
      : "Custom";

  const qqResiduals = influence.map(d => d.stdResidual).filter(isFinite);
  const qqLabels    = influence.filter(d => isFinite(d.stdResidual)).map(d => d.label);

  appState.reportArgs = {
    studies: all, m, profile, reg,
    tf, egger, begg, fatpet, petpeese, fsn, tes, waap, pcurve, puniform, harbord, peters, deeks, ruecker, hc, baujatResult,
    influence, subgroup, method, ciMethod,
    ciLevel: document.getElementById("ciLevel")?.value ?? "95",
    useTF, mAdjusted,
    sel: selResult, selMode: selModeVal, selLabel: _selLabel,
    gosh: goshState.result,
    goshXAxis: document.getElementById("goshXAxis")?.value ?? "I2",
    profileLik: profileLikResult,
    profileLikXScale: elProfileLikScale?.value || "tau2",
    bayesResult, bayesReMean: m.RE,
    sensitivityRows: null,
    forestOptions: { ...forestOpts, currentPage: forestPlot.page },
    qqResiduals, qqLabels,
  };
  funnelPlot.args = [all, m, egger, profile];
  funnelPlot.petpeese = petpeese;
  drawIfVisible("pubBiasSection", () => {
    performance.mark("phase:plot:funnel:start");
    drawFunnel(...funnelPlot.args, { contours: funnelPlot.contours, petpeese: funnelPlot.petpeese });
    performance.measure("phase:plot:funnel", "phase:plot:funnel:start");
  });
  const labbeTypes = ["OR", "RR", "RD"];
  const showLabbe  = labbeTypes.includes(type);

  // BLUPs — only meaningful when τ² > 0 and k ≥ 2
  const blupResult = (m && isFinite(m.tau2) && m.tau2 > 0 && studies.length >= 2)
    ? blupMeta(studies, m) : null;
  blupPlot.result  = blupResult;
  blupPlot.profile = profile;
  blupPlot.page    = 0;
  elBlupBlock.style.display       = blupResult ? "" : "none";

  const showQQ = qqResiduals.length >= 3;

  elBaujatPlotBlock.style.display  = baujatResult ? "" : "none";
  elQQPlotBlock.style.display      = showQQ ? "" : "none";
  elRadialPlotBlock.style.display  = studies.length >= 2 && !isMHorPeto ? "" : "none";
  elLabbeBlock.style.display       = showLabbe ? "" : "none";
  drawIfVisible("diagnosticSection", () => {
    performance.mark("phase:plot:influence:start");
    drawInfluencePlot(influence);
    if (blupResult) {
      const { totalPages } = drawBlupPlot(blupResult, profile, { pageSize: blupPlot.pageSize, page: 0 });
      renderBlupNav(totalPages);
    }
    drawBaujatPlot(baujatResult, profile);
    if (showQQ) drawQQPlot(qqResiduals, qqLabels);
    if (studies.length >= 2 && !isMHorPeto) drawRadialPlot(studies, m, profile);
    if (showLabbe) drawLabbe(studies, m, profile, type);
    performance.measure("phase:plot:influence", "phase:plot:influence:start");
  });

  // ---- Cumulative meta-analysis ----
  const cumulativeOrder = elCumulativeOrder?.value || "input";
  const cumulativeStudies = studies.slice(); // copy; studies already have yi/vi/label
  if (cumulativeOrder === "precision_desc") {
    cumulativeStudies.sort((a, b) => a.vi - b.vi);   // smallest vi (most precise) first
  } else if (cumulativeOrder === "precision_asc") {
    cumulativeStudies.sort((a, b) => b.vi - a.vi);   // largest vi (least precise) first
  } else if (cumulativeOrder === "effect_asc") {
    cumulativeStudies.sort((a, b) => a.yi - b.yi);
  } else if (cumulativeOrder === "effect_desc") {
    cumulativeStudies.sort((a, b) => b.yi - a.yi);
  }
  // "input" order: no sort — preserves table order
  performance.mark("phase:cumulative:start");
  const cumResults = cumulativeMeta(cumulativeStudies, method, ciMethod, alpha);
  performance.measure("phase:cumulative", "phase:cumulative:start");
  cumForestPlot.page = 0;
  const rawCumPageSize = elCumForestPageSize?.value ?? "30";
  const cumForestPageSize = rawCumPageSize === "Infinity" ? Infinity : +rawCumPageSize;
  cumForestPlot.args = { results: cumResults, profile, pageSize: cumForestPageSize, alpha, ciLabel: getCiLabel() };
  appState.reportArgs.cumForestOptions = { results: cumResults, profile, pageSize: cumForestPageSize, currentPage: 0, alpha, ciLabel: getCiLabel() };

  // ---- Cumulative funnel plot — state setup (eager) ----
  cumFunnelPlot.studies = cumulativeStudies;
  cumFunnelPlot.results = cumResults;
  cumFunnelPlot.profile = profile;
  elCumFunnelStep.max   = cumResults.length - 1;
  elCumFunnelStep.value = cumResults.length - 1;
  _updateCumFunnelLabel(cumResults.length - 1);
  elCumFunnelBlock.style.display = "";

  drawIfVisible("cumulativeSection", () => {
    performance.mark("phase:plot:cumulative:start");
    const { totalPages: cumForestPages } = drawCumulativeForest(cumResults, profile, { pageSize: cumForestPageSize, page: 0 });
    renderCumulativeForestNav(cumForestPages);
    drawCumulativeFunnel(cumulativeStudies, cumResults, profile, cumResults.length - 1);
    performance.measure("phase:plot:cumulative", "phase:plot:cumulative:start");
  });

  // ---- Orchard + caterpillar plots ----
  elOrchardPlotBlock.style.display = "";
  caterpillarPlot.page = 0;
  const rawCatPageSize = elCatPageSize?.value ?? "30";
  const catPageSize = rawCatPageSize === "Infinity" ? Infinity : +rawCatPageSize;
  caterpillarPlot.args = { studies: all, m, profile, pageSize: catPageSize };
  elCaterpillarBlock.style.display = "";
  appState.reportArgs.caterpillarOptions = { studies: all, m, profile, pageSize: catPageSize, currentPage: 0 };

  drawIfVisible("altVizSection", () => {
    performance.mark("phase:plot:orchard:start");
    drawOrchardPlot(all, m, profile);
    const { totalPages: catPages } = drawCaterpillarPlot(all, m, profile, { pageSize: catPageSize, page: 0 });
    renderCaterpillarNav(catPages);
    performance.measure("phase:plot:orchard", "phase:plot:orchard:start");
  });

  // ---- Risk-of-bias plots ----
  const hasRoB = _robDomains.length > 0 && studies.length > 0;
  elRobSection.style.display = hasRoB ? "" : "none";
  if (hasRoB) {
    drawIfVisible("robSection", () => {
      drawRoBTrafficLight(studies, _robDomains, _robData);
      drawRoBSummary(studies, _robDomains, _robData);
    });
  }

  updateValidationWarnings(studies, excluded, softWarnings);

  // ---- Run-state timestamp badge on every results section ----
  // Insert (or update) a <span class="panel-run-at"> inside each
  // <summary> so users can see when each panel was last updated.
  const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  document.querySelectorAll(".results-section > summary").forEach(summary => {
    let badge = summary.querySelector(".panel-run-at");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "panel-run-at";
      summary.appendChild(badge);
    }
    badge.textContent = ts;
  });

  _buildJumpPill();
  performance.measure("runAnalysis", "runAnalysis:start");
  if (PERF_LOG) {
    const entries = performance.getEntriesByType("measure")
      .filter(e => e.name.startsWith("phase:") || e.name === "runAnalysis");
    console.table(entries.map(e => ({ name: e.name, ms: +e.duration.toFixed(2) })));
  }
  return true;
  } finally {
    _analysisRunning = false;
    if (_runBtn) { _runBtn.disabled = false; _runBtn.textContent = "Run"; }
  }
}