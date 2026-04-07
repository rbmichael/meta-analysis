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
import { eggerTest, beggTest, fatPetTest, failSafeN, pCurve, pUniform, baujat, meta, influenceDiagnostics, subgroupAnalysis, metaRegression, cumulativeMeta, leaveOneOut, estimatorComparison, veveaHedges, SELECTION_PRESETS, profileLikTau2 } from "./analysis.js";
import { fmt } from "./utils.js";
import { effectProfiles, getProfile } from "./profiles.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel, drawBubble, drawPartialResidualBubble, drawInfluencePlot, drawCumulativeForest, drawCumulativeFunnel, drawPCurve, drawPUniform, drawOrchardPlot, drawCaterpillarPlot, drawBaujatPlot, drawRoBTrafficLight, drawRoBSummary, drawGoshPlot, drawProfileLikTau2 } from "./plots.js";
import { goshCompute, GOSH_MAX_K } from "./gosh.js";
import { exportSVG, exportPNG, exportTIFF } from "./export.js";
import { buildReport, downloadHTML, openPrintPreview } from "./report.js";
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
// actual save only fires once the user stops making changes. Also serves as the
// entry point that kicks off runAnalysis() — callers invoke scheduleSave()
// rather than runAnalysis() directly so that rapid consecutive edits (e.g.
// typing into a cell) coalesce into a single analysis run instead of
// re-running on every keystroke.
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveDraft(gatherSessionState()), 1200);
}

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
let moderators = []; // { name: string, type: "continuous"|"categorical" }

// ---- Risk-of-bias state ----
let _robDomains = [];  // string[] — ordered domain names
let _robData    = {};  // { [studyLabel]: { [domain]: "Low"|"Some concerns"|"High"|"NI"|"" } }

// Low-level: add one moderator to state + DOM (no form read, no runAnalysis call).
function doAddModerator(name, type) {
  if (!name || moderators.some(m => m.name === name)) return;
  moderators.push({ name, type });

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
  if (!name) return;
  doAddModerator(name, type);
  nameEl.value = "";
  runAnalysis();
}

function removeModerator(name) {
  moderators = moderators.filter(m => m.name !== name);
  const table = document.getElementById("inputTable");
  for (let i = 0; i < table.rows.length; i++) {
    const cell = [...table.rows[i].cells].find(c => c.dataset.mod === name);
    if (cell) cell.remove();
  }
  runAnalysis();
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
  input.addEventListener("input", runAnalysis);
  td.appendChild(input);
  return td;
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
    drawFunnel(...funnelPlot.args, { contours: true });
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

function showView(name) {
  _inputSection.style.display  = name === "input"   ? "" : "none";
  _outputSection.style.display = name === "results" ? "" : "none";
  _guideSection.style.display  = name === "guide"   ? "" : "none";
  _aboutSection.style.display  = name === "about"   ? "" : "none";
  _toggleInput.classList.toggle("active",   name === "input");
  _toggleResults.classList.toggle("active", name === "results");
  _toggleGuide.classList.toggle("active",   name === "guide");
  _toggleAbout.classList.toggle("active",   name === "about");
  window.scrollTo(0, 0);
  if (name === "guide") renderGuide(document.getElementById("guidePanel"));
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
document.getElementById("run").addEventListener("click", () => { if (runAnalysis()) showView("results"); });
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
document.getElementById("cumulativeOrder").addEventListener("change", runAnalysis);
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
  // Pass the live forestPlot.page so the restore inside collectForestSVGs lands on
  // the correct page rather than always page 0 (which was the value at cache time).
  const args = {
    ...appState.reportArgs,
    forestOptions: { ...appState.reportArgs.forestOptions, currentPage: forestPlot.page },
    // Use the live goshState so a re-run after the last analysis is captured.
    gosh:     goshState.result ?? appState.reportArgs.gosh,
    goshXAxis: document.getElementById("goshXAxis")?.value ?? appState.reportArgs.goshXAxis ?? "I2",
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

  // Populate example data for testing
  populateExampleData(type);

  runAnalysis();
});

document.getElementById("tauMethod").addEventListener("change", () => { syncPLAvailability(); runAnalysis(); });
document.getElementById("ciMethod").addEventListener("change", () => {
  const ciSel  = document.getElementById("ciMethod");
  const tauSel = document.getElementById("tauMethod");
  // If PL is chosen but τ² is not likelihood-based, auto-switch τ² to REML.
  if (ciSel.value === "PL" && tauSel.value !== "REML" && tauSel.value !== "ML") {
    tauSel.value = "REML";
  }
  syncPLAvailability();
  runAnalysis();
});

const trimFillCheckbox = document.getElementById("useTrimFill");
const adjustedCheckbox = document.getElementById("useTFAdjusted");
adjustedCheckbox.disabled = !trimFillCheckbox.checked;
trimFillCheckbox.addEventListener("change", () => {
  adjustedCheckbox.disabled = !trimFillCheckbox.checked;
  if (!trimFillCheckbox.checked) adjustedCheckbox.checked = false;
  runAnalysis();
});
adjustedCheckbox.addEventListener("change", runAnalysis);

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

document.getElementById("selMode").addEventListener("change", () => { syncSelControls(); runAnalysis(); });
document.getElementById("selPreset").addEventListener("change", () => { syncSelControls(); runAnalysis(); });
document.getElementById("selSides").addEventListener("change", runAnalysis);
document.getElementById("selCuts").addEventListener("change", runAnalysis);
syncSelControls();

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

  // Moderator columns
  moderators.forEach(({ name }) => headerRow.appendChild(makeModTh(name)));

  // Actions column
  const thActions = document.createElement("th");
  thActions.textContent = "Actions";
  headerRow.appendChild(thActions);
}

// ---------------- ADD ROW ----------------
function addRow(values) {
  const type = document.getElementById("effectType").value;
  const profile = effectProfiles[type];
  if (!profile) return;

  const table = document.getElementById("inputTable");
  const row = table.insertRow();
  const v = values || ["", ...Array(profile.inputs.length).fill(""), ""]; // Study + effects + group

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

  // ---- Moderator columns ---- (values at indices after Group)
  const modOffset = profile.inputs.length + 2;
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
      runAnalysis();
      scheduleSave();
    });
  });

  row.querySelector(".remove-btn").addEventListener("click", () => removeRow(row.querySelector(".remove-btn")));
  row.querySelector(".clear-btn").addEventListener("click", () => clearRow(row.querySelector(".clear-btn")));
}

// ---------------- REMOVE & CLEAR ----------------
function removeRow(btn) {
  const table = document.getElementById("inputTable");
  if (table.rows.length <= 2) return;
  const row = btn.closest("tr");
  const label = row.querySelector("input")?.value?.trim();
  if (label) delete _robData[label];
  row.remove();
  renderRoBDataGrid();
  runAnalysis();
  scheduleSave();
}

function clearRow(btn) {
  btn.closest("tr").querySelectorAll("input").forEach(input => input.value = "");
  runAnalysis();
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

  // Build a study object from the effect-column inputs (skip label, group, moderators).
  const studyObj = {};
  inputs.forEach((input, idx) => {
    if (idx === 0 || input.classList.contains("group") || "mod" in input.dataset) return;
    const key = profile.inputs[idx - 1];
    const val = input.value.trim();
    studyObj[key] = profile.rawInputs?.has(key) ? val : (val === "" || isNaN(val)) ? NaN : +val;
  });

  // Delegate to the profile's validate function.
  const { valid, errors } = profile.validate(studyObj);

  // Mark individual inputs whose key has an error.
  inputs.forEach((input, idx) => {
    if (idx === 0 || input.classList.contains("group") || "mod" in input.dataset) return;
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
  const structural = new Set(["study", "group"]);
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
  const knownCols = new Set(["study", "group", ...profile.inputs.map(c => c.toLowerCase())]);
  const modCols   = headers.filter(h => !knownCols.has(h.toLowerCase()));

  // Infer moderator types and register them
  clearModerators();
  modCols.forEach(col => {
    const ci     = headerMap[col.toLowerCase()];
    const vals   = rows.map(r => r[ci] ?? "").filter(v => v.trim() !== "");
    const mtype  = vals.length > 0 && vals.every(v => !isNaN(v.trim())) ? "continuous" : "categorical";
    moderators.push({ name: col, type: mtype });
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
    // Stay on the input view so the warning is visible.
    runAnalysis();
    return;
  }

  runAnalysis();
  showView("results");
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
    cumulativeOrder: document.getElementById("cumulativeOrder").value,
    useTrimFill:     document.getElementById("useTrimFill").checked,
    useTFAdjusted:   document.getElementById("useTFAdjusted").checked,
  };

  const savedModerators = moderators.map(m => ({ name: m.name, type: m.type }));

  const studies = [];
  document.querySelectorAll("#inputTable tr").forEach((r, i) => {
    if (i === 0) return; // skip header
    const inputs = [...r.querySelectorAll("input")];
    // inputs order: Study, ...profile.inputs, Group, ...moderators
    const study = inputs[0]?.value ?? "";
    const effectInputs = {};
    profile.inputs.forEach((col, idx) => {
      effectInputs[col] = inputs[idx + 1]?.value ?? "";
    });
    const group = inputs[profile.inputs.length + 1]?.value ?? "";
    const modValues = {};
    moderators.forEach((m, modIdx) => {
      modValues[m.name] = inputs[profile.inputs.length + 2 + modIdx]?.value ?? "";
    });

    // Skip completely empty rows
    const allVals = [study, ...Object.values(effectInputs), group, ...Object.values(modValues)];
    if (allVals.every(v => v === "")) return;

    studies.push({ study, inputs: effectInputs, group, moderators: modValues });
  });

  return buildSession(settings, savedModerators, studies, { domains: _robDomains, data: _robData });
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
  const { settings = {}, moderators: savedMods = [], studies: savedStudies = [], rob = {} } = session;

  // Apply settings
  const s = settings;
  if (s.effectType      && document.getElementById("effectType").querySelector(`option[value="${s.effectType}"]`))
    document.getElementById("effectType").value      = s.effectType;
  if (s.tauMethod       && document.getElementById("tauMethod").querySelector(`option[value="${s.tauMethod}"]`))
    document.getElementById("tauMethod").value       = s.tauMethod;
  if (s.ciMethod        && document.getElementById("ciMethod").querySelector(`option[value="${s.ciMethod}"]`))
    document.getElementById("ciMethod").value        = s.ciMethod;
  if (s.cumulativeOrder && document.getElementById("cumulativeOrder").querySelector(`option[value="${s.cumulativeOrder}"]`))
    document.getElementById("cumulativeOrder").value = s.cumulativeOrder;
  if (typeof s.useTrimFill   === "boolean") document.getElementById("useTrimFill").checked   = s.useTrimFill;
  if (typeof s.useTFAdjusted === "boolean") document.getElementById("useTFAdjusted").checked = s.useTFAdjusted;

  // Rebuild moderators
  clearModerators();
  savedMods.forEach(m => {
    if (m.name && (m.type === "continuous" || m.type === "categorical"))
      doAddModerator(m.name, m.type);
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

  // Warn about any effect-input columns absent from the saved data.
  const missingCols = missingInputCols(profile.inputs, savedStudies);
  if (missingCols.length > 0) {
    warningDiv.textContent = `Warning: session is missing data for: ${missingCols.join(", ")}`;
    warningDiv.style.display = "block";
    // Stay on the input view so the warning is visible.
    runAnalysis();
    return;
  }

  runAnalysis();
  showView("results");
}

// ---------------- CSV EXPORT ----------------

function exportCSV() {
  const type    = document.getElementById("effectType").value;
  const profile = effectProfiles[type];

  const headers = ["Study", ...profile.inputs, "Group", ...moderators.map(m => m.name)];
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

  // Initialise PL availability based on default/restored τ² estimator.
  syncPLAvailability();

  // Validate all rows
  document.querySelectorAll("#inputTable tr").forEach((row, i) => {
    if (i === 0) return;
    validateRow(row);
  });

  runAnalysis();
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

function buildRegCoeffRows(reg) {
  const hasVif   = Array.isArray(reg.vif) && reg.vif.length === reg.p;
  // Group header rows only when there are genuinely multiple moderators whose
  // column indices are tracked in modTests.
  const multiMod = moderators.length > 1
    && Array.isArray(reg.modTests) && reg.modTests.length > 0;
  const colCount = 8;  // Term + β + SE + stat + p + CI + VIF + stars

  function vifCell(j) {
    if (!hasVif || j === 0) return `<td class="reg-vif">—</td>`;
    const v = reg.vif[j];
    if (!isFinite(v)) return `<td class="reg-vif">—</td>`;
    const cls = v > 10 ? "vif-high" : v > 5 ? "vif-mid" : "vif-ok";
    return `<td class="reg-vif ${cls}">${v.toFixed(2)}</td>`;
  }

  function dataRow(j) {
    const [lo, hi] = reg.ci[j];
    return `<tr class="${j === 0 ? "reg-intercept" : ""}">
      <td>${reg.colNames[j]}</td>
      <td>${fmt(reg.beta[j])}</td>
      <td>${fmt(reg.se[j])}</td>
      <td>${fmt(reg.zval[j])}</td>
      <td>${regFmtP(reg.pval[j])}</td>
      <td>[${fmt(lo)}, ${fmt(hi)}]</td>
      ${vifCell(j)}
      <td>${regStars(reg.pval[j])}</td>
    </tr>`;
  }

  if (!multiMod) {
    return reg.colNames.map((_, j) => dataRow(j)).join("");
  }

  // Multi-moderator: intercept first, then one labelled group per moderator.
  let html = dataRow(0);
  for (const mt of reg.modTests) {
    if (mt.colIdxs.length === 0) continue;
    const QMlabel = reg.QMdist === "F"
      ? `F(${mt.QMdf},\u2009${reg.QEdf})`
      : `χ²(${mt.QMdf})`;
    const qmStr = isFinite(mt.QM)
      ? ` &nbsp;·&nbsp; QM ${QMlabel} = ${fmt(mt.QM)}, p = ${regFmtP(mt.QMp)}`
      : "";
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
        <span class="reg-title">Meta-Regression</span>
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

  const rows       = buildRegCoeffRows(reg);
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

  // Per-moderator test block — only rendered when there are 2+ moderators.
  const modTestsBlock = moderators.length >= 2
    && Array.isArray(reg.modTests) && reg.modTests.length > 0
    ? `<details>
        <summary>Per-moderator tests (${reg.modTests.length})</summary>
        <table class="reg-table">
          <thead><tr>
            <th>Moderator</th>
            <th>${reg.QMdist === "F" ? "F" : "QM"}</th>
            <th>df</th>
            <th>p</th>
          </tr></thead>
          <tbody>
            ${reg.modTests.map(mt => {
              if (mt.QMdf === 0) {
                return `<tr><td>${mt.name}</td><td colspan="3"><i>degenerate (≤ 1 level)</i></td></tr>`;
              }
              const dfLabel = reg.QMdist === "F"
                ? `F(${mt.QMdf},\u2009${reg.QEdf})`
                : `χ²(${mt.QMdf})`;
              return `<tr>
                <td>${mt.name}</td>
                <td>${fmt(mt.QM)}</td>
                <td>${dfLabel}</td>
                <td>${regFmtP(mt.QMp)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </details>`
    : "";

  panel.innerHTML = `
    <div class="reg-header">
      <span class="reg-title">Meta-Regression</span>
      <span class="reg-meta">k = ${reg.k} &nbsp;·&nbsp; ${method} &nbsp;·&nbsp; ${ciLabel}</span>
    </div>
    <div class="reg-het">
      τ² = ${fmt(reg.tau2)} (residual) &nbsp;·&nbsp; I² = ${fmt(reg.I2)}%
      ${reg.p > 1 ? `&nbsp;·&nbsp; R² = ${isFinite(reg.R2) ? fmt(reg.R2 * 100) + "%" : "N/A"}` : ""}
      &nbsp;·&nbsp; QE(${reg.QEdf}) = ${fmt(reg.QE)}, p = ${regFmtP(reg.QEp)}
      ${QMrow}
    </div>
    <div class="reg-body">
      ${excludedWarning}${lowDfWarning}${vifWarning}
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>β</th><th>SE</th><th>${statLabel}</th>
          <th>p</th><th>95% CI</th><th>VIF</th><th></th>
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
    drawFunnel(...funnelPlot.args, { contours: funnelPlot.contours });
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
      <th>95% CI (low)</th>
      <th>95% CI (high)</th>
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
          <th>95% CI (low)</th>
          <th>95% CI (high)</th>
          <th>τ²</th>
          <th>I² (%)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sens-note">★ = currently selected estimator.</div>`;
}
function renderSensitivityPanel(studies, m, method, ciMethod, profile) {
  const container = document.getElementById("sensitivityPanel");
  if (!container) return;

  // Preserve open/collapsed state of the two <details> blocks across re-renders.
  const blocks = container.querySelectorAll(".sens-block");
  const openState = [...blocks].map(b => b.open);
  const looOpen = openState[0] ?? true;
  const estOpen = openState[1] ?? true;

  // ---- Leave-one-out ----
  // Pass the already-computed meta result to avoid rerunning meta() for the full set.
  const loo     = leaveOneOut(studies, method, ciMethod, m);
  const fullSig = loo.full.pval < 0.05;
  const fullEst = profile.transform(loo.full.RE);
  const looBody = buildLooBody(loo, fullSig, fullEst, profile);

  // ---- Estimator comparison ----
  const estBody = buildEstimatorBody(estimatorComparison(studies, ciMethod), method, profile);

  container.innerHTML = `
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

  const tau2   = isFinite(m.tau2) ? m.tau2 : 0;
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

  // Pooled row values
  const pooledEf = profile.transform(m.RE);
  const pooledLo = profile.transform(m.ciLow);
  const pooledHi = profile.transform(m.ciHigh);

  function fmtVal(v) { return isFinite(v) ? v.toFixed(3) : "NA"; }
  function fmtPct(v) { return v !== null && isFinite(v) ? v.toFixed(1) + "%" : "\u2014"; }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; }

  // Resolve the effect type key by object identity for the help button.
  const effectTypeKey = Object.keys(effectProfiles).find(k => effectProfiles[k] === profile) ?? "";
  const effectHelpBtn = effectTypeKey ? hBtn("effect." + effectTypeKey) : "";

  const headerRow = `
    <tr>
      <th>Study</th>
      <th>Effect ${effectHelpBtn}</th>
      <th>95% CI (low)</th>
      <th>95% CI (high)</th>
      <th>${seLabel}</th>
      <th>RE Weight ${hBtn("het.tau2")}</th>
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

  const pooledRow = `
    <tr class="pooled-row">
      <td>Pooled (RE)</td>
      <td>${fmtVal(pooledEf)}</td>
      <td>${fmtVal(pooledLo)}</td>
      <td>${fmtVal(pooledHi)}</td>
      <td>${fmtVal(m.seRE)}</td>
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
    panel.innerHTML = `<p class="sel-note">Selection model not available when meta-regression is active.</p>`;
    return;
  }

  // Insufficient k
  if (r.error === "insufficient_k") {
    panel.innerHTML = `<p class="sel-note">Insufficient studies: need at least ${r.minK} for ${r.K} intervals (have ${r.k}).</p>`;
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
    ${emptyWarn}
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
  const rows = influence.map(d => {
    const anyFlag  = d.outlier || d.influential || d.highLeverage || d.highCookD;
    const rowStyle = anyFlag ? "class='results-row-flagged'" : "";
    const hatStyle  = d.highLeverage ? " style='color:orange;font-weight:bold;'" : "";
    const cookStyle = d.highCookD    ? " style='color:orange;font-weight:bold;'" : "";
    const flags = [
      d.outlier      ? "Outlier"     : "",
      d.influential  ? "Influential" : "",
      d.highLeverage ? "Hi-Lev"      : "",
      d.highCookD    ? "Hi-Cook"     : "",
    ].filter(Boolean).join(", ");
    return `<tr ${rowStyle}>
      <td>${d.label}</td>
      <td>${isFinite(d.RE_loo)      ? fmt(d.RE_loo)      : "NA"}</td>
      <td>${isFinite(d.deltaTau2)   ? fmt(d.deltaTau2)   : "NA"}</td>
      <td>${isFinite(d.stdResidual) ? fmt(d.stdResidual) : "NA"}</td>
      <td>${isFinite(d.DFBETA)      ? fmt(d.DFBETA)      : "NA"}</td>
      <td${hatStyle}>${isFinite(d.hat)   ? d.hat.toFixed(3)   : "NA"}</td>
      <td${cookStyle}>${isFinite(d.cookD) ? d.cookD.toFixed(3) : "NA"}</td>
      <td>${flags}</td></tr>`;
  }).join("");
  return `<b>Influence diagnostics:</b><br>
    <table border="1">
      <tr><th>Study</th><th>RE (LOO)</th><th>Δτ²</th><th>Std Residual</th><th>DFBETA</th><th>Hat</th><th>Cook's D</th><th>Flag</th></tr>
      ${rows}
    </table>
    <small style="color:#aaa;">Thresholds: Hat &gt; ${fmt(2/k)} (= 2/k); Cook's D &gt; ${fmt(4/k)} (= 4/k)</small>`;
}

function buildSubgroupHTML(subgroup, profile) {
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
  return `<b>Subgroup analysis:</b><br>
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

  // Show progress bar, hide old plot
  if (elProg)  { elProg.hidden  = false; }
  if (elPlot)  { elPlot.style.display = "none"; }
  if (elInfo)  { elInfo.innerHTML = ""; }
  if (elBar)   { elBar.value = 0; }
  if (elLabel) { elLabel.textContent = "Starting…"; }
  if (elRun)   { elRun.disabled = true; }

  function onDone(result) {
    goshState.result  = result;
    goshState.profile = profile;
    if (elProg)  { elProg.hidden = true; }
    if (elPlot)  { elPlot.style.display = ""; }
    if (elRun)   { elRun.disabled = false; }
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
    if (elProg)  { elProg.hidden = true; }
    if (elInfo)  { elInfo.innerHTML = `<p class="gosh-info" style="color:var(--danger,red)">Error: ${msg}</p>`; }
    if (elRun)   { elRun.disabled = false; }
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
      // Worker failed to load — most likely a file:// origin security restriction
      // in Chrome.  Fall back to synchronous computation on the main thread.
      // With GOSH_MAX_ENUM_K=15 the sync path handles ≤32 767 subsets in < 5 ms
      // and up to maxSubsets sampled subsets (default 50 K) in < 20 ms, so there
      // is no meaningful UI blocking.
      goshState.worker = null;
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
//   State — forestPlot.args, appState.reportArgs, appState.hasRunOnce, forestPlot.page ← 0
// -----------------------------------------------------------------------------
function runAnalysis() {
  scheduleSave();
  // Cancel any in-progress GOSH computation.
  if (goshState.worker) {
    goshState.worker.terminate();
    goshState.worker = null;
    const elRun = document.getElementById("goshRun");
    if (elRun) elRun.disabled = false;
    const elProg = document.getElementById("goshProgress");
    if (elProg) elProg.hidden = true;
  }
  // Reset accordion sections to their default open/closed states on each run.
  document.querySelectorAll(".results-section").forEach(d => d.removeAttribute("open"));
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
  const elUseTFAdjusted      = document.getElementById("useTFAdjusted");
  const elBubblePlots        = document.getElementById("bubblePlots");
  const elForestPageSize     = document.getElementById("forestPageSize");
  const elBaujatPlotBlock    = document.getElementById("baujatPlotBlock");
  const elCumulativeOrder    = document.getElementById("cumulativeOrder");
  const elCumForestPageSize  = document.getElementById("cumulativeForestPageSize");
  const elCumFunnelStep      = document.getElementById("cumulativeFunnelStep");
  const elCumFunnelBlock     = document.getElementById("cumulativeFunnelBlock");
  const elOrchardPlotBlock   = document.getElementById("orchardPlotBlock");
  const elCatPageSize        = document.getElementById("caterpillarPageSize");
  const elCaterpillarBlock   = document.getElementById("caterpillarPlotBlock");
  const elRobSection         = document.getElementById("robSection");

  const type = elEffectType.value;
  const profile = effectProfiles[type];
  if (!profile) return;

  const rows = document.querySelectorAll("#inputTable tr");

  // Row inputs are ordered: [label, ...profile.inputs, group, ...moderators].
  // Pre-compute the offset so moderator values can be read from the already-
  // collected inputs array rather than querying the DOM for each moderator
  // on every row.
  const modOffset = profile.inputs.length + 2;

  let studies = [];
  let excluded = [];
  let softWarnings = [];
  let missingCorrelation = false; // <-- NEW

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const inputs = [...row.querySelectorAll("input")].map(x => x.value);

    const isValid = validateRow(row);

    const group = row.querySelector(".group")?.value.trim() || "";
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

    study.group = group;

    // ---- Moderator values ----
    moderators.forEach(({ name, type }, modIdx) => {
      const raw = (inputs[modOffset + modIdx] ?? "").trim();
      study[name] = type === "continuous" ? (raw === "" ? NaN : +raw) : raw;
    });

    studies.push(study);
  }

  if (!studies.length) {
    if (outputPlaceholder) {
      outputPlaceholder.style.display = "";
      outputPlaceholder.textContent = "No valid studies to analyse. Check the input table for errors.";
    }
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
  const useTF = elUseTrimFill?.checked;
  const useTFAdjusted = elUseTFAdjusted?.checked;

  let tf = [], all = studies;
  if (useTF) { tf = trimFill(studies, method); all = [...studies, ...tf]; }

  let m = meta(studies, method, ciMethod);

  const profileLikResult =
    (method === "ML" || method === "REML") && studies.length >= 2
      ? profileLikTau2(studies, { method })
      : null;

  const elHetDiag = document.getElementById("hetDiagSection");
  if (profileLikResult && !profileLikResult.error) {
    elHetDiag.style.display = "";
    const xScale = document.getElementById("profileLikScale")?.value || "tau2";
    drawProfileLikTau2(profileLikResult, { xScale });
  } else {
    elHetDiag.style.display = "none";
  }

  const egger   = eggerTest(studies);
  const begg    = beggTest(studies);
  const fatpet  = fatPetTest(studies);
  const fsn     = failSafeN(studies);
  const pcurve   = pCurve(studies);
  const puniform = pUniform(studies, m);
  const influence = influenceDiagnostics(studies, method, ciMethod);
  const subgroup = subgroupAnalysis(studies, method, ciMethod);

  const influenceHTML = buildInfluenceHTML(influence);
  const hasSubgroup   = subgroup && subgroup.G >= 2;
  const subgroupHTML  = hasSubgroup ? buildSubgroupHTML(subgroup, profile) : "";

  // Adjusted RE
  let mAdjusted = null;
  if (useTF && useTFAdjusted && tf.length > 0) mAdjusted = meta([...studies,...tf], method, ciMethod);

  const FE_disp = profile.transform(m.FE);
  const RE_disp = profile.transform(m.RE);
  const ci_disp   = { lb: profile.transform(m.ciLow),   ub: profile.transform(m.ciHigh) };
  const pred_disp = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  const RE_adj_disp = useTF && mAdjusted ? profile.transform(mAdjusted.RE) : null;

  // --- INSERT CORRELATION WARNING ---
  let warningHTML = "";
  if (missingCorrelation) {
    warningHTML = `<div style="color: orange; font-weight: bold;">
      ⚠️ Some paired studies are missing correlation (r). Assumed r = 0.5 for computation.
    </div>`;
  }

  elResults.innerHTML = warningHTML + `
    <b>${profile.label} (FE):</b> ${fmt(FE_disp)} |
    <b>${profile.label} (RE):</b> ${fmt(RE_disp)}<br>
    ${useTF && mAdjusted ? `<b>RE (adjusted):</b> ${fmt(RE_adj_disp)}<br>` : ""}
    CI [${fmt(ci_disp.lb)}, ${fmt(ci_disp.ub)}]<br>
    ${hBtn("het.tau2")}τ²=${fmt(m.tau2)} [${fmt(m.tauCI[0])}, ${isFinite(m.tauCI[1])?fmt(m.tauCI[1]):"∞"}] | ${hBtn("het.I2")}I²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%] | ${hBtn("het.H2")}H²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]<br>
    ${hBtn("het.Q")}${m.dist}-stat=${fmt(m.stat)} | p=${fmt(m.pval)}<br>
    ${hBtn("het.pred")}Prediction interval (Higgins 2009, t<sub>${m.df > 0 ? m.df - 1 : "—"}</sub>): ${isFinite(pred_disp.lb) ? `[${fmt(pred_disp.lb)}, ${fmt(pred_disp.ub)}]` : "NA (k &lt; 3)"}
  `;

  elPubBiasStats.innerHTML = `
    &nbsp;&nbsp;${hBtn("bias.egger")}Egger: intercept=${isFinite(egger.intercept)?fmt(egger.intercept):"NA"} | p=${isFinite(egger.p)?fmt(egger.p):"NA (k<3)"}<br>
    &nbsp;&nbsp;${hBtn("bias.begg")}Begg: τ=${isFinite(begg.tau)?fmt(begg.tau):"NA"} | p=${isFinite(begg.p)?fmt(begg.p):"NA (k<3)"}<br>
    &nbsp;&nbsp;${hBtn("bias.fatpet")}FAT (bias): β₁=${isFinite(fatpet.slope)?fmt(fatpet.slope):"NA"} | p=${isFinite(fatpet.slopeP)?fmt(fatpet.slopeP):"NA (k<3)"} &nbsp;·&nbsp; PET (effect at SE→0): ${isFinite(fatpet.intercept)?fmt(profile.transform(fatpet.intercept)):"NA"} | p=${isFinite(fatpet.interceptP)?fmt(fatpet.interceptP):"NA (k<3)"}<br>
    &nbsp;&nbsp;${hBtn("bias.fsn")}Fail-safe N (Rosenthal): ${isFinite(fsn.rosenthal)?Math.round(fsn.rosenthal):"NA"} &nbsp;·&nbsp; Orwin (trivial=0.1): ${isFinite(fsn.orwin)?Math.round(fsn.orwin):"NA"}<br>
    <b>Trim &amp; Fill:</b>${hBtn("bias.trimfill")} ${useTF?"ON":"OFF"} (${tf.length} filled studies)
  `;
  elInfluenceDiagTable.innerHTML = influenceHTML;

  elSubgroupSection.style.display = hasSubgroup ? "" : "none";
  elSubgroupTable.innerHTML = subgroupHTML;

  renderStudyTable(all, m, profile);
  renderSensitivityPanel(studies, m, method, ciMethod, profile);
  renderPCurvePanel(pcurve);
  renderPUniformPanel(puniform, m, profile);

  // ---- Selection model (Vevea-Hedges) ----
  // Skip when meta-regression moderators are active.
  let selResult = null;
  const selModeVal = document.getElementById("selMode").value;
  if (moderators.length === 0) {
    const selPreset = document.getElementById("selPreset").value;
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

  // ---- Meta-regression ----
  // buildDesignMatrix expects { key, type }; ui state stores { name, type }.
  const modSpec = moderators.map(m => ({ key: m.name, type: m.type }));
  const reg = moderators.length > 0
    ? metaRegression(studies, modSpec, method, ciMethod)
    : null;
  const kExcluded = reg ? studies.length - reg.k : 0;
  renderRegressionPanel(reg ?? {}, method, ciMethod, kExcluded);

  // ---- Bubble plots (one per continuous moderator) ----
  // With a single moderator: raw yi vs x (drawBubble) and partial residuals are
  // identical, so drawBubble is used.  With 2+ moderators: drawPartialResidualBubble
  // removes other predictors' contributions, making each plot unambiguous.
  const bubbleContainer = elBubblePlots;
  bubbleContainer.innerHTML = "";
  const usePartialBubble = moderators.length > 1;
  if (reg && !reg.rankDeficient) {
    moderators
      .filter(mod => mod.type === "continuous")
      .forEach((mod, i) => {
        const idx = reg.colNames.indexOf(mod.name);
        if (idx < 1) return;

        // Wrap each bubble in a block-level div so export buttons sit above it.
        const wrap = document.createElement("div");
        bubbleContainer.appendChild(wrap);
        if (usePartialBubble) {
          drawPartialResidualBubble(reg.studiesUsed, reg, mod.name, idx, wrap);
        } else {
          drawBubble(reg.studiesUsed, reg, mod.name, idx, wrap);
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

  // Reset to page 0 on every fresh run and cache args for nav re-renders.
  forestPlot.page = 0;
  const rawPageSize  = elForestPageSize?.value ?? "30";
  const pageSize     = rawPageSize === "Infinity" ? Infinity : +rawPageSize;
  const forestOpts   = { ciMethod, profile, pageSize, pooledDisplay: forestPlot.poolDisplay, theme: forestPlot.theme };
  forestPlot.args        = { studies: all, m, options: forestOpts };
  const { totalPages } = drawForest(all, m, { ...forestOpts, page: forestPlot.page });
  renderForestNav(totalPages);

  // Cache state for report export buttons.
  const baujatResult = baujat(studies);

  // Resolve human-readable label for the report interpretation sentence.
  const _selPreset = document.getElementById("selPreset").value;
  const _selLabel  = selModeVal === "mle"
    ? "MLE"
    : _selPreset !== "custom"
      ? (SELECTION_PRESETS[_selPreset]?.label ?? _selPreset)
      : "Custom";

  appState.reportArgs = {
    studies: all, m, profile, reg,
    tf, egger, begg, fatpet, fsn, pcurve, puniform, baujatResult,
    influence, subgroup, method, ciMethod,
    useTF, mAdjusted,
    sel: selResult, selMode: selModeVal, selLabel: _selLabel,
    gosh: goshState.result,
    goshXAxis: document.getElementById("goshXAxis")?.value ?? "I2",
    profileLik: profileLikResult,
    profileLikXScale: document.getElementById("profileLikScale")?.value || "tau2",
    forestOptions: { ...forestOpts, currentPage: forestPlot.page },
  };
  funnelPlot.args = [all, m, egger, profile];
  drawFunnel(...funnelPlot.args, { contours: funnelPlot.contours });
  drawInfluencePlot(influence);
  drawBaujatPlot(baujatResult, profile);
  elBaujatPlotBlock.style.display = baujatResult ? "" : "none";

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
  const cumResults = cumulativeMeta(cumulativeStudies, method, ciMethod);
  cumForestPlot.page = 0;
  const rawCumPageSize = elCumForestPageSize?.value ?? "30";
  const cumForestPageSize = rawCumPageSize === "Infinity" ? Infinity : +rawCumPageSize;
  cumForestPlot.args = { results: cumResults, profile, pageSize: cumForestPageSize };
  const { totalPages: cumForestPages } = drawCumulativeForest(cumResults, profile, { pageSize: cumForestPageSize, page: 0 });
  renderCumulativeForestNav(cumForestPages);

  // ---- Cumulative funnel plot ----
  cumFunnelPlot.studies = cumulativeStudies;
  cumFunnelPlot.results = cumResults;
  cumFunnelPlot.profile = profile;
  elCumFunnelStep.max   = cumResults.length - 1;
  elCumFunnelStep.value = cumResults.length - 1;
  _updateCumFunnelLabel(cumResults.length - 1);
  drawCumulativeFunnel(cumulativeStudies, cumResults, profile, cumResults.length - 1);
  elCumFunnelBlock.style.display = "";

  // ---- Orchard + caterpillar plots ----
  drawOrchardPlot(all, m, profile);
  elOrchardPlotBlock.style.display = "";
  caterpillarPlot.page = 0;
  const rawCatPageSize = elCatPageSize?.value ?? "30";
  const catPageSize = rawCatPageSize === "Infinity" ? Infinity : +rawCatPageSize;
  caterpillarPlot.args = { studies: all, m, profile, pageSize: catPageSize };
  const { totalPages: catPages } = drawCaterpillarPlot(all, m, profile, { pageSize: catPageSize, page: 0 });
  renderCaterpillarNav(catPages);
  elCaterpillarBlock.style.display = "";

  // ---- Risk-of-bias plots ----
  const hasRoB = _robDomains.length > 0 && studies.length > 0;
  drawRoBTrafficLight(studies, _robDomains, _robData);
  drawRoBSummary(studies, _robDomains, _robData);
  elRobSection.style.display = hasRoB ? "" : "none";

  updateValidationWarnings(studies, excluded, softWarnings);
  return true;
}