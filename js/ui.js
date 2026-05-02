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
//                     report.js, session.js, autosave.js,
//                     export.js, io.js, help.js, utils.js,
//                     ui-table.js, ui-render.js, ui-state.js
//   ui-table.js     → profiles.js, ui-state.js, utils-html.js, csv.js, io.js
//   ui-render.js    → analysis.js, plots.js, constants.js, utils-html.js
//   ui-state.js     → profiles.js, session.js
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
//   utils-html.js   (no imports — leaf module)
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
import { eggerTest, beggTest, fatPetTest, petPeeseTest, failSafeN, tesTest, waapWls, clES, pCurve, pUniform, baujat, blupMeta, meta, metaMH, metaPeto, robustMeta, influenceDiagnostics, subgroupAnalysis, metaRegression, testContrast, cumulativeMeta, veveaHedges, SELECTION_PRESETS, profileLikTau2, bayesMeta, priorSensitivity, rvePooled, meta3level, harbordTest, petersTest, deeksTest, rueckerTest, lsModel, henmiCopas } from "./analysis.js";
import { fmt, normalQuantile, chiSquareCDF } from "./utils.js";
import { escapeHTML } from "./utils-html.js";
import { effectProfiles, getProfile } from "./profiles.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel, drawBubble, drawPartialResidualBubble, drawInfluencePlot, drawCumulativeForest, drawCumulativeFunnel, drawOrchardPlot, drawCaterpillarPlot, drawBlupPlot, drawBaujatPlot, drawLabbe, drawRoBTrafficLight, drawRoBSummary, drawGoshPlot, drawProfileLikTau2, drawBayesTauPosterior, drawBayesMuPosterior, drawQQPlot, drawRadialPlot, setTooltipElement } from "./plots.js";
import { goshCompute, GOSH_MAX_K } from "./gosh.js";
import { exportSVG, exportPNG, exportTIFF } from "./export.js";
// report.js (81 KB) and docx.js (51 KB) are loaded on first export click.
// guide.js (166 KB) and help.js (76 KB) are loaded on first use so they don't
// block startup.
// Each getter caches the resolved promise. On rejection the cache is cleared so
// the next call retries the import rather than re-throwing the stale failure.
let _reportMod, _docxMod, _helpMod, _guideMod;
function getReport() { return (_reportMod ??= import("./report.js").catch(e => { _reportMod = null; throw e; })); }
function getDocx()   { return (_docxMod   ??= import("./docx.js"  ).catch(e => { _docxMod   = null; throw e; })); }
function getHelp()   { return (_helpMod   ??= import("./help.js"  ).catch(e => { _helpMod   = null; throw e; })); }
function getGuide()  { return (_guideMod  ??= import("./guide.js" ).catch(e => { _guideMod  = null; throw e; })); }
import { serializeSession, parseSession, missingInputCols } from "./session.js";
import { saveDraft, loadDraft, clearDraft } from "./autosave.js";
import { downloadBlob, readTextFile, serializeCSV } from "./io.js";
import { Z_95 } from "./constants.js";
import { regStars, regFmtP, buildRegCoeffRows, buildRegFittedRows,
         renderLocationScalePanel, renderRegressionPanel,
         TAU_METHOD_LABELS, renderSensitivityPanel, renderStudyTable,
         renderPCurvePanel, renderPUniformPanel, renderSelectionModelPanel,
         buildInfluenceHTML, bayesInterpretation, buildBayesSummaryHTML,
         buildSensitivityHTML, buildSubgroupHTML, renderGoshInfo,
         formatContrastResult }
  from "./ui-render.js";
import { validateRow, gatherSessionState } from "./ui-state.js";
import { initTable, moderators, doAddModerator, removeModerator, clearModerators,
         updateTableHeaders, addRow, commitPendingDelete, removeRow, clearRow,
         updateValidationWarnings, collectStudies,
         refreshPreviewUI, previewCSV, commitImport, cancelImport }
  from "./ui-table.js";

// ---------------- AUTOSAVE ----------------

let _saveTimer = null;

// Last successful metaRegression result — referenced by the contrast test handler.
let _lastReg = null;

// scheduleSave()
// Debounced autosave trigger. Resets the 1.2 s idle timer on every call; the
// actual save fires once the user pauses for 1.2 s. Does NOT call runAnalysis()
// — analysis is triggered separately by the callers.
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveDraft(gatherSessionState(moderators, scaleModerators, { domains: _robDomains, data: _robData })), 1200);
}

// ---------------- DEBOUNCED ANALYSIS ----------------

let _analysisRunning = false;

// Flush any pending debounced save immediately.
// Called on beforeunload and visibilitychange so changes made in the last
// 1.2 s before tab close/backgrounding are not lost.
function flushSave() {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  saveDraft(gatherSessionState(moderators, scaleModerators, { domains: _robDomains, data: _robData }));
}

window.addEventListener("beforeunload", flushSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
});



// ---------------- HELP POPOVER ----------------

const _helpPopover   = document.getElementById("helpPopover");
const _helpTitle     = document.getElementById("helpPopoverTitle");
const _helpBody      = document.getElementById("helpPopoverBody");
const _helpClose     = _helpPopover.querySelector(".help-popover-close");
const _helpGuideLink = document.getElementById("helpPopoverGuideLink");
let   _helpOpener    = null;  // element that opened the popover; focus returns here on close

_helpClose.addEventListener("click", () => {
  _helpPopover.dataset.activeKey = "";
  hideHelp();
});

// Focus trap: Tab/Shift+Tab cycles within the popover while it is open.
_helpPopover.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  // Collect currently visible focusable elements in DOM order.
  const focusable = [_helpClose, _helpGuideLink].filter(
    el => el && el.style.display !== "none"
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }
});

async function showHelp(anchorEl, key) {
  let HELP, HELP_TO_GUIDE;
  try {
    [{ HELP }, { HELP_TO_GUIDE }] = await Promise.all([getHelp(), getGuide()]);
  } catch (err) {
    console.error("showHelp: failed to load help/guide modules:", err);
    return;
  }
  const entry = HELP[key];
  if (!entry) {
    console.warn(`showHelp: no HELP entry for key "${key}"`);
    return;
  }

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

  _helpOpener = anchorEl;
  _helpPopover.style.display = "block";
  _helpClose.focus();

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
  _helpOpener?.focus();
  _helpOpener = null;
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
document.addEventListener("click", async e => {
  const btn = e.target.closest(".help-btn");
  if (!btn) return;
  e.stopPropagation();

  // Resolve the key synchronously (no await yet) so the toggle check runs
  // before the module loads, avoiding a double-open on slow connections.
  let key;
  if (btn.dataset.helpSelect) {
    const sel    = document.getElementById(btn.dataset.helpSelect);
    const prefix = btn.dataset.helpPrefix ?? "";
    const value  = sel ? sel.value : "";
    key = prefix + value;
  } else {
    key = btn.dataset.help;
  }

  // Toggle: clicking the same button again closes the popover.
  if (_helpPopover.style.display !== "none" &&
      _helpPopover.dataset.activeKey === key) {
    hideHelp();
    return;
  }

  _helpPopover.dataset.activeKey = key;
  await showHelp(btn, key);
});

// Human-readable labels for help button aria-labels.
// Keys match data-help values used in both static HTML and hBtn() calls.
const HELP_LABELS = {
  // Input panel
  "input.csv":             "CSV import and export",
  "input.session":         "Session save and load",
  "input.moderators":      "Moderators",
  "input.scaleModerators": "Location-scale model moderators",
  "input.rob":             "Risk of bias",
  "cluster.id":            "Cluster ID",
  "keyboard.shortcuts":    "Keyboard shortcuts",
  // Settings
  "ci.width":              "Confidence interval width",
  "reg.mcc":               "Multiple comparison correction",
  "bias.trimfill":         "Trim-and-fill",
  "bayes.model":           "Bayesian meta-analysis model",
  "bayes.tau":             "Bayesian τ posterior",
  "sel.model":             "Selection model",
  // Effect / method selects (data-help-select prefixes resolve here)
  "effect":                "Effect type",
  "tau":                   "τ² estimator",
  "ci":                    "CI method",
  "cumorder":              "Cumulative order",
  // Plots
  "plot.forest":           "Forest plot",
  "plot.funnel":           "Funnel plot",
  "plot.cumulative":       "Cumulative analysis",
  "plot.orchard":          "Orchard plot",
  "plot.caterpillar":      "Caterpillar plot",
  "plot.rob":              "Risk-of-bias plot",
  // Diagnostics
  "diag.profileLik":       "Profile likelihood",
  "diag.influence":        "Influence diagnostics",
  "diag.blup":             "BLUPs (shrunken estimates)",
  "diag.baujat":           "Baujat plot",
  "diag.qqplot":           "Normal Q-Q plot",
  "diag.radial":           "Radial (Galbraith) plot",
  "diag.labbe":            "L'Abbé plot",
  "diag.gosh":             "GOSH plot",
  "diag.locationscale":    "Location-scale model",
  "diag.metaregression":   "Meta-regression",
  "diag.dffits":           "DFFITS influence statistic",
  "diag.covratio":         "CovRatio influence statistic",
  "diag.subgroup":         "Subgroup analysis",
  // Heterogeneity
  "het.Q":                 "Q heterogeneity statistic",
  "het.I2":                "I² heterogeneity",
  "het.H2":                "H² heterogeneity",
  "het.tau2":              "τ² between-study variance",
  // Models
  "rve.model":             "Robust variance estimation",
  "cluster.robust":        "Robust confidence interval",
  "threelevel.model":      "Three-level model",
  "threelevel.tau2":       "Three-level variance components",
  "threelevel.I2":         "Three-level I²",
  "pool.cles":             "Common language effect size",
  // Publication bias
  "bias.pcurve":           "P-curve",
  "bias.puniform":         "P-uniform",
  "bayes.sensitivity":     "Bayesian prior sensitivity",
  // Regression
  "mreg.lrt":              "Likelihood ratio test",
  "reg.aic":               "Model fit statistics (AIC/BIC/LL)",
  "sens.loo":              "Leave-one-out analysis",
  "sens.estimator":        "Estimator comparison",
};

// Derive aria-label text from a help key.
// data-help-select buttons use a prefix (e.g. "effect.") — strip the dot.
function _helpAriaLabel(key) {
  const base = key.replace(/\.$/, "").split(".")[0];
  return HELP_LABELS[key] ?? HELP_LABELS[base] ?? key;
}

// Convenience: inline help button for injected HTML strings.
function hBtn(key) {
  const label = _helpAriaLabel(key);
  return `<button class="help-btn" data-help="${key}" aria-label="Help: ${label}" title="Help">?</button>`;
}

// One-time pass: assign aria-labels to all static .help-btn elements in the DOM.
document.querySelectorAll(".help-btn").forEach(btn => {
  if (btn.hasAttribute("aria-label")) return;
  const key  = btn.dataset.help ?? btn.dataset.helpPrefix?.replace(/\.$/, "") ?? "";
  const label = _helpAriaLabel(key);
  btn.setAttribute("aria-label", label === key ? "Help" : `Help: ${label}`);
});

// ---------------- MODERATOR STATE ----------------
// moderators[] is owned by ui-table.js (imported above) — a live array mutated
// in place by doAddModerator / removeModerator / clearModerators.
let scaleModerators = []; // { name: string, type: "continuous"|"categorical", transform: string }

// ---- Risk-of-bias state ----
let _robDomains = [];  // string[] — ordered domain names
let _robData    = {};  // { [studyLabel]: { [domain]: "Low"|"Some concerns"|"High"|"NI"|"" } }

// doAddModerator / clearModerators / removeModerator / makeModTh / makeModTd
// all live in ui-table.js (imported above).

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

const THEMES = ["light", "dark"]; // extend here to add future themes

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
  const current = document.documentElement.dataset.theme;
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  localStorage.setItem("theme", next);
  _applyTheme(next);
  if (funnelPlot.args && funnelPlot.contours) {
    drawFunnel(...funnelPlot.args, { egger: funnelPlot.egger, contours: true, petpeese: funnelPlot.petpeese });
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
  if (name === "guide") getGuide().then(({ renderGuide }) => renderGuide(document.getElementById("guidePanel")));
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
document.getElementById("previewImport").addEventListener("click", () => {
  const missingCols = commitImport();
  syncMHOptions(document.getElementById("effectType").value);
  if (missingCols.length > 0) {
    const warningDiv = document.getElementById("csvWarning");
    warningDiv.textContent = `Warning: CSV is missing required columns: ${missingCols.join(", ")}`;
    warningDiv.style.display = "block";
  }
});
document.getElementById("previewCancel").addEventListener("click", cancelImport);
document.getElementById("previewEffectType").addEventListener("change", e => refreshPreviewUI(e.target.value));
document.getElementById("export").addEventListener("click", e => {
  const done = flashBtn(e.currentTarget, null, "Saved \u2713");
  exportCSV();
  done();
});
document.getElementById("saveSession").addEventListener("click", e => {
  const done = flashBtn(e.currentTarget, null, "Saved \u2713");
  saveSession();
  done();
});
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
  _resetDiscardBtn();
}

document.getElementById("draftDismiss").addEventListener("click", hideDraftBanner);

// Two-step confirmation state for the destructive "Discard draft" button.
let _discardPending = false;

function _resetDiscardBtn() {
  const btn = document.getElementById("draftStartFresh");
  if (btn) btn.textContent = "Discard draft";
  _discardPending = false;
}

document.getElementById("draftStartFresh").addEventListener("click", () => {
  if (!_discardPending) {
    _discardPending = true;
    const btn = document.getElementById("draftStartFresh");
    btn.textContent = "Sure?";
    // Auto-cancel after 4 s if user doesn't confirm.
    setTimeout(_resetDiscardBtn, 4000);
    return;
  }
  _discardPending = false;

  // Reset all settings controls to their HTML-defined defaults.
  const resetSel = id => {
    const el = document.getElementById(id); if (!el) return;
    const i = [...el.options].findIndex(o => o.defaultSelected);
    el.selectedIndex = i >= 0 ? i : 0;
  };
  const resetNum = id => { const el = document.getElementById(id); if (el) el.value = el.defaultValue; };
  const resetChk = id => { const el = document.getElementById(id); if (el) el.checked = el.defaultChecked; };

  resetSel("effectType"); resetSel("tauMethod"); resetSel("ciMethod");
  resetSel("ciLevel");    resetSel("mccMethod"); resetSel("cumulativeOrder");
  resetSel("tfEstimator"); resetSel("forestTheme");
  resetSel("selMode");    resetSel("selPreset"); resetSel("selSides");
  resetChk("useTrimFill"); resetChk("useTFAdjusted");
  resetNum("bayesMu0"); resetNum("bayesSigmaMu"); resetNum("bayesSigmaTau");
  resetNum("selCuts");
  // RVE rho: reset value then fire input event so the block-scoped display updater runs.
  const rveRhoEl = document.getElementById("rveRho");
  if (rveRhoEl) { rveRhoEl.value = rveRhoEl.defaultValue; rveRhoEl.dispatchEvent(new Event("input")); }

  // Sync dependent UI state.
  adjustedCheckbox.disabled = !trimFillCheckbox.checked;
  tfEstimatorSelect.disabled = !trimFillCheckbox.checked;
  syncMHOptions(document.getElementById("effectType").value);
  syncPLAvailability();
  syncSelControls();

  // Reset table and moderators.
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

// ---------------- FLASH BUTTON HELPER ----------------
// Briefly shows a working label, then a done label, then restores the original.
// workingLabel: shown immediately + button disabled (pass null to skip)
// doneLabel:    shown after the async work completes for durationMs
// Returns a resolve function the caller invokes when the work is done.
function flashBtn(btn, workingLabel, doneLabel, durationMs = 1500) {
  const original = btn.textContent;
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  if (workingLabel) {
    btn.disabled = true;
    btn.textContent = workingLabel;
  }
  promise.then(() => {
    btn.disabled = false;
    btn.textContent = doneLabel;
    setTimeout(() => { btn.textContent = original; }, durationMs);
  });
  return resolve;
}

// ---------------- PLOT EXPORT ----------------
// ---------------- REPORT EXPORT BUTTONS ----------------
// buildReport internally re-renders every forest page into a hidden element
// then restores the live view.  After it returns we re-render the live forest
// at the currently-viewed page and re-sync the nav, because buildReport has no
// access to renderForestNav.
async function buildReportAndResync() {
  if (!appState.reportArgs) return null;
  // Ensure all lazily-deferred plots have been drawn before SVGs are serialised.
  flushDeferredDraws();
  const { buildReport, downloadHTML, openPrintPreview } = await getReport();
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
  return { html, downloadHTML, openPrintPreview };
}

document.getElementById("exportReportHTML").addEventListener("click", async e => {
  const btn  = e.currentTarget;
  const done = flashBtn(btn, "Building\u2026", "Saved \u2713");
  try {
    const result = await buildReportAndResync();
    if (result) { result.downloadHTML(result.html); done(); }
    else { btn.disabled = false; btn.textContent = "Export HTML"; }
  } catch (err) {
    console.error("Export HTML failed:", err);
    btn.disabled = false;
    btn.textContent = "Export failed";
    setTimeout(() => { btn.textContent = "Export HTML"; }, 3000);
  }
});

document.getElementById("exportReportPDF").addEventListener("click", async e => {
  const btn  = e.currentTarget;
  try {
    const result = await buildReportAndResync();
    if (result) result.openPrintPreview(result.html);
  } catch (err) {
    console.error("Export PDF failed:", err);
    btn.disabled = false;
    btn.textContent = "Export failed";
    setTimeout(() => { btn.textContent = "Export PDF"; }, 3000);
  }
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
  const done = flashBtn(btn, "Building\u2026", "Saved \u2713");
  try {
    const { buildDocx } = await getDocx();
    const blob = await buildDocx(args);
    downloadBlob(blob, "meta-analysis-report.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    done();
  } catch (e) {
    console.error("Export Word failed:", e);
    btn.disabled = false;
    btn.textContent = "Export failed";
    setTimeout(() => { btn.textContent = "Export Word"; }, 3000);
  }
});

// Delegated listener for custom contrast Test button (injected into results panel).
document.addEventListener("click", e => {
  const btn = e.target.closest(".contrast-test-btn");
  if (!btn) return;
  if (!_lastReg) return;
  const section = btn.closest(".contrast-section");
  if (!section) return;
  const inputs = section.querySelectorAll(".contrast-weight");
  const L = Array.from(inputs).map(inp => parseFloat(inp.value) || 0);
  const result = testContrast(_lastReg, L);
  section.querySelector(".contrast-result").innerHTML = formatContrastResult(result, _lastReg);
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
document.getElementById("ciLevel").addEventListener("change", () => { scheduleSave(); markStale(); });
document.getElementById("mccMethod").addEventListener("change", markStale);
document.getElementById("bayesMu0").addEventListener("input", markStale);
document.getElementById("bayesSigmaMu").addEventListener("input", markStale);
document.getElementById("bayesSigmaTau").addEventListener("input", markStale);

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

// updateTableHeaders, drag handlers, addRow, undo deletion, removeRow, clearRow,
// updateValidationWarnings: all moved to ui-table.js (R-5 refactor).

// classifyColumns, refreshPreviewUI, previewCSV, commitImport, cancelImport
// all moved to ui-table.js (R-5 refactor).
// commitImport returns missing column names; caller shows the warning.

// ---------------- SESSION SAVE ----------------

function saveSession() {
  downloadBlob(serializeSession(gatherSessionState(moderators, scaleModerators, { domains: _robDomains, data: _robData })), "session.json", "application/json;charset=utf-8;");
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
  "Variability",
  "Continuous (paired)",
  "Continuous (single group)",
  "Binary outcomes",
  "Correlations",
  "Proportions",
  "Time-to-event / Rates",
  "Reliability",
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
  // Inject callbacks into ui-table.js (required before any table operations)
  initTable({
    markStale,
    scheduleSave,
    renderRoBDataGrid,
    deleteRobEntry: key => { delete _robData[key]; },
  });

  // Wire the shared tooltip element into plots.js (removes "#tooltip" coupling)
  setTooltipElement(document.getElementById("tooltip"));

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

// ---------------- OUTPUT SECTION VISIBILITY ----------------
const staleBanner       = document.getElementById("staleBanner");
const inputStaleBadge   = document.getElementById("inputStaleBadge");
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
    drawFunnel(...funnelPlot.args, { egger: funnelPlot.egger, contours: funnelPlot.contours, petpeese: funnelPlot.petpeese });
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

    document.getElementById(cfg.prevId)?.addEventListener("click", () => {
      if (cfg.getPage() > 0) {
        cfg.setPage(cfg.getPage() - 1);
        const { totalPages: tp } = cfg.redraw(cfg.getPage());
        renderNav(tp);
      }
    });

    document.getElementById(cfg.nextId)?.addEventListener("click", () => {
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
  if (inputStaleBadge) inputStaleBadge.hidden = false;
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
  const elEmpty   = document.getElementById("goshEmptyState");

  if (k < 2) {
    if (elInfo) elInfo.innerHTML = '<p class="gosh-info">GOSH requires at least 2 valid studies.</p>';
    return;
  }
  if (k > GOSH_MAX_K) {
    if (elInfo) elInfo.innerHTML = `<p class="gosh-info">GOSH supports at most ${GOSH_MAX_K} studies (${k} present).</p>`;
    return;
  }
  if (elEmpty) elEmpty.hidden = true;

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

// =============================================================================
// R-1 REFACTOR: runAnalysis() decomposed into focused named helpers
// =============================================================================
// Each helper is a pure computation function (no DOM writes) that receives an
// `opts` bag and returns a results object.  runAnalysis() calls them in
// sequence, collects results, then delegates all DOM writes to _renderAllResults().
//
// _runCoreMeta(studies, opts)        → { m, tf, all, profileLikResult, mAdjusted,
//                                         rveResult, threeLevelResult }
// _runBayesBatch(studies, m, opts)   → { bayesResult, reMeanRef }
// _runPubBiasBatch(studies, m, opts) → { egger, begg, petpeese, fatpet, fsn, tes,
//                                         waap, pcurve, puniform, harbord, peters,
//                                         deeks, ruecker, hc, selResult }
// _runSensitivityBatch(studies, m, opts) → { influence, baujatResult, blupResult,
//                                             qqResiduals, qqLabels,
//                                             cumResults, cumulativeStudies }
// _runRegressionBatch(studies, m, opts)  → { subgroup, reg, ls }
// _renderAllResults(ctx)             — writes all DOM / draws all plots
// =============================================================================

// ── Helper: core meta-analysis ────────────────────────────────────────────────
function _runCoreMeta(studies, opts) {
  const { method, ciMethod, alpha, type, useTF, tfEstimator, useTFAdjusted,
          isMHorPeto, hasClusters, rveRho } = opts;

  let tf = [], all = studies;
  if (useTF && !isMHorPeto) {
    tf  = trimFill(studies, method, tfEstimator);
    all = [...studies, ...tf];
  }

  let m;
  if      (method === "MH"  ) m = metaMH(studies, type, alpha);
  else if (method === "Peto") m = metaPeto(studies, alpha);
  else if (hasClusters)       m = robustMeta(studies, method, ciMethod, alpha);
  else                        m = meta(studies, method, ciMethod, alpha);

  if (m.error) return { m, tf, all, profileLikResult: null, mAdjusted: null, rveResult: null, threeLevelResult: null };

  const profileLikResult =
    (method === "ML" || method === "REML") && studies.length >= 2
      ? profileLikTau2(studies, { method })
      : null;

  const mAdjusted = (useTF && useTFAdjusted && tf.length > 0)
    ? meta([...studies, ...tf], method, ciMethod, alpha)
    : null;

  const rveResult = (hasClusters && !isMHorPeto)
    ? rvePooled(studies, { rho: rveRho, alpha })
    : null;

  const threeLevelResult = (hasClusters && !isMHorPeto)
    ? meta3level(studies, { method: "REML", alpha })
    : null;

  return { m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult };
}

// ── Helper: Bayesian batch ────────────────────────────────────────────────────
function _runBayesBatch(studies, m, opts) {
  const { bayesMu0, bayesSigmaMu, bayesSigmaTau, alpha, isMHorPeto } = opts;
  if (studies.length < 2 || isMHorPeto) return { bayesResult: null, reMeanRef: NaN };
  const reMeanRef  = isFinite(m.RE) ? m.RE : m.FE;
  const bayesResult = bayesMeta(studies, { mu0: bayesMu0, sigma_mu: bayesSigmaMu, sigma_tau: bayesSigmaTau, alpha });
  return { bayesResult, reMeanRef };
}

// ── Helper: publication bias batch ───────────────────────────────────────────
function _runPubBiasBatch(studies, m, opts) {
  const { alpha, selModeVal, selPreset, selSides, selCuts } = opts;

  const egger    = eggerTest(studies);
  const begg     = beggTest(studies);
  const petpeese = petPeeseTest(studies);
  const fatpet   = petpeese.fat;
  const fsn      = failSafeN(studies);
  const tes      = tesTest(studies, m);
  const waap     = waapWls(studies);
  const pcurve   = pCurve(studies);
  const puniform = pUniform(studies, m);
  const harbord  = harbordTest(studies);
  const peters   = petersTest(studies);
  const deeks    = deeksTest(studies);
  const ruecker  = rueckerTest(studies);
  const hc       = henmiCopas(studies, alpha);

  // Selection model — skip when meta-regression moderators are active
  let selResult = null;
  if (moderators.length === 0) {
    let selCutsEff, selSidesEff, selOmegaFixed;
    if (selModeVal === "sensitivity" && selPreset !== "custom") {
      const p       = SELECTION_PRESETS[selPreset];
      selCutsEff    = p.cuts;
      selSidesEff   = p.sides;
      selOmegaFixed = p.omega;
    } else {
      selCutsEff    = selCuts;
      selSidesEff   = selSides;
      selOmegaFixed = null;
    }
    selResult = veveaHedges(studies, selCutsEff, selSidesEff, selOmegaFixed);
  }

  return { egger, begg, petpeese, fatpet, fsn, tes, waap, pcurve, puniform,
           harbord, peters, deeks, ruecker, hc, selResult };
}

// ── Helper: sensitivity / influence / cumulative batch ───────────────────────
function _runSensitivityBatch(studies, m, opts) {
  const { method, ciMethod, alpha, cumulativeOrder } = opts;

  const influence    = influenceDiagnostics(studies, method, ciMethod, alpha);
  const baujatResult = baujat(studies);
  const blupResult   = (m && isFinite(m.tau2) && m.tau2 > 0 && studies.length >= 2)
    ? blupMeta(studies, m) : null;
  const qqResiduals  = influence.map(d => d.stdResidual).filter(isFinite);
  const qqLabels     = influence.filter(d => isFinite(d.stdResidual)).map(d => d.label);

  const cumulativeStudies = studies.slice();
  if      (cumulativeOrder === "precision_desc") cumulativeStudies.sort((a, b) => a.vi - b.vi);
  else if (cumulativeOrder === "precision_asc")  cumulativeStudies.sort((a, b) => b.vi - a.vi);
  else if (cumulativeOrder === "effect_asc")     cumulativeStudies.sort((a, b) => a.yi - b.yi);
  else if (cumulativeOrder === "effect_desc")    cumulativeStudies.sort((a, b) => b.yi - a.yi);
  // "input" order: no sort

  const cumResults = cumulativeMeta(cumulativeStudies, method, ciMethod, alpha);

  return { influence, baujatResult, blupResult, qqResiduals, qqLabels, cumResults, cumulativeStudies };
}

// ── Helper: meta-regression / subgroup batch ─────────────────────────────────
function _runRegressionBatch(studies, m, opts) {
  const { method, ciMethod, alpha, modSpec, scaleModSpec } = opts;

  const subgroup = subgroupAnalysis(studies, method, ciMethod, alpha);
  let reg = null, ls = null;
  if (scaleModSpec.length > 0) {
    ls = lsModel(studies, modSpec, scaleModSpec, { ciMethod, alpha });
  } else if (modSpec.length > 0) {
    reg = metaRegression(studies, modSpec, method, ciMethod, alpha);
  }
  return { subgroup, reg, ls };
}

function _animateFresh(el) {
  if (!el) return;
  el.classList.remove("results-fresh");
  void el.offsetWidth;
  el.classList.add("results-fresh");
}

// ── All DOM writes: renders every output panel from computed results ──────────
function _renderAllResults(ctx) {
  const {
    type, profile, studies, excluded, softWarnings, missingCorrelation,
    m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult,
    bayesResult, reMeanRef,
    egger, begg, petpeese, fatpet, fsn, tes, waap, pcurve, puniform,
    harbord, peters, deeks, ruecker, hc, selResult,
    influence, baujatResult, blupResult, qqResiduals, qqLabels,
    cumResults, cumulativeStudies,
    subgroup, reg, ls,
    opts,
  } = ctx;

  const { method, ciMethod, alpha, isMHorPeto, hasClusters, useTF, tfEstimator,
          useTFAdjusted, bayesMu0, bayesSigmaMu, bayesSigmaTau, selModeVal } = opts;

  // ── DOM element refs ────────────────────────────────────────────────────────
  const elResults            = document.getElementById("results");
  const elPubBiasStats       = document.getElementById("pubBiasStats");
  const elInfluenceDiagTable = document.getElementById("influenceDiagTable");
  const elSubgroupSection    = document.getElementById("subgroupSection");
  const elSubgroupTable      = document.getElementById("subgroupTable");
  const elBubblePlots        = document.getElementById("bubblePlots");
  const elForestPageSize     = document.getElementById("forestPageSize");
  const elBaujatPlotBlock    = document.getElementById("baujatPlotBlock");
  const elQQPlotBlock        = document.getElementById("qqPlotBlock");
  const elRadialPlotBlock    = document.getElementById("radialPlotBlock");
  const elLabbeBlock         = document.getElementById("labbeBlock");
  const elBlupBlock          = document.getElementById("blupBlock");
  const elCumForestPageSize  = document.getElementById("cumulativeForestPageSize");
  const elCumFunnelStep      = document.getElementById("cumulativeFunnelStep");
  const elCumFunnelBlock     = document.getElementById("cumulativeFunnelBlock");
  const elOrchardPlotBlock   = document.getElementById("orchardPlotBlock");
  const elCatPageSize        = document.getElementById("caterpillarPageSize");
  const elCaterpillarBlock   = document.getElementById("caterpillarPlotBlock");
  const elRobSection         = document.getElementById("robSection");
  const elProfileLikScale    = document.getElementById("profileLikScale");
  const elSelPreset          = document.getElementById("selPreset");

  // ── Profile likelihood ─────────────────────────────────────────────────────
  const elHetDiag = document.getElementById("hetDiagSection");
  if (profileLikResult && !profileLikResult.error) {
    elHetDiag.style.display = "";
    drawProfileLikTau2(profileLikResult, { xScale: elProfileLikScale?.value || "tau2" });
  } else {
    elHetDiag.style.display = "none";
  }

  // ── Bayesian ───────────────────────────────────────────────────────────────
  const elBayes      = document.getElementById("bayesSection");
  if (bayesResult && !bayesResult.error) {
    bayesState.studies = studies;
    bayesState.reMean  = reMeanRef;
    bayesState.profile = profile;
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
    const ciLevel = document.getElementById("ciLevel")?.value ?? "95";
    renderSensitivity(bayesMu0, bayesSigmaMu, bayesSigmaTau, ciLevel);
  } else {
    bayesState.studies = null;
    elBayes.style.display = "none";
    const elSensSection = document.getElementById("bayesSensitivitySection");
    if (elSensSection) elSensSection.style.display = "none";
  }

  // ── RVE ────────────────────────────────────────────────────────────────────
  {
    const elRve         = document.getElementById("rveSection");
    const elRveSummary  = document.getElementById("rveSummary");
    const elRveSettings = document.getElementById("rveSettings");
    const showRve = hasClusters && !isMHorPeto;
    if (elRveSettings) elRveSettings.style.display = showRve ? "" : "none";
    if (elRve) {
      if (showRve && rveResult) {
        elRve.style.display = "";
        if (rveResult.error) {
          elRveSummary.innerHTML = `<p class="reg-note" style="color:var(--color-warning)">⚠ RVE: ${escapeHTML(rveResult.error)}</p>`;
        } else {
          const rveEst  = profile.transform(rveResult.est);
          const rveLo   = profile.transform(rveResult.ci[0]);
          const rveHi   = profile.transform(rveResult.ci[1]);
          const reDisp  = profile.transform(m.RE);
          const diffDir = rveResult.est > m.RE ? "higher" : rveResult.est < m.RE ? "lower" : "equal";
          const rveRho  = opts.rveRho;
          elRveSummary.innerHTML = `
            <div style="font-size:0.8125rem;line-height:1.9;margin-bottom:8px">
              ${hBtn("rve.model")}<b>RVE pooled estimate:</b> ${fmt(rveEst)}<br>
              CI [${fmt(rveLo)}, ${fmt(rveHi)}] | SE=${fmt(rveResult.se)} | t(${rveResult.df})=${fmt(rveResult.t)} | p=${fmt(rveResult.p)}<br>
              ρ=${rveRho.toFixed(2)} &nbsp;·&nbsp; m=${rveResult.kCluster} cluster${rveResult.kCluster === 1 ? "" : "s"} &nbsp;·&nbsp; k=${rveResult.k} studies<br>
              <span style="color:var(--fg-muted);font-size:0.93em">RE (cluster-robust): ${fmt(reDisp)} &nbsp;·&nbsp; RVE estimate is ${diffDir}.</span>
            </div>
          `;
        }
      } else {
        elRve.style.display = "none";
      }
    }
  }

  // ── Three-level ────────────────────────────────────────────────────────────
  {
    const elThree        = document.getElementById("threeLevelSection");
    const elThreeSummary = document.getElementById("threeLevelSummary");
    const showThree = hasClusters && !isMHorPeto;
    if (elThree) {
      if (showThree && threeLevelResult) {
        elThree.style.display = "";
        if (threeLevelResult.error) {
          elThreeSummary.innerHTML = `<p class="reg-note" style="color:var(--color-warning)">⚠ Three-level: ${escapeHTML(threeLevelResult.error)}</p>`;
        } else {
          const tl = threeLevelResult;
          const muDisp   = profile.transform(tl.mu);
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

  // ── Pooled estimate panel ─────────────────────────────────────────────────
  const FE_disp    = profile.transform(m.FE);
  const RE_disp    = profile.transform(m.RE);
  const ci_disp    = { lb: profile.transform(m.ciLow),   ub: profile.transform(m.ciHigh) };
  const feZ        = normalQuantile(1 - alpha / 2);
  const feCi_disp  = { lb: profile.transform(m.FE - feZ * m.seFE), ub: profile.transform(m.FE + feZ * m.seFE) };
  const pred_disp  = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  const RE_adj_disp = useTF && mAdjusted ? profile.transform(mAdjusted.RE) : null;

  const warningHTML = missingCorrelation
    ? `<div style="color:var(--color-warning);font-weight:bold;">
         ⚠️ Some paired studies are missing correlation (r). Assumed r = 0.5 for computation.
       </div>`
    : "";

  const methodLabel = m.isMH ? "MH" : m.isPeto ? "Peto" : "";
  const clusterBanner = hasClusters
    ? (isMHorPeto
      ? `<div class="reg-note" style="color:var(--muted);margin:2px 0 6px">ℹ Cluster-robust SE is not available for M-H/Peto methods.</div>`
      : (m.isClustered
        ? `<div class="reg-note" style="margin:2px 0 6px">Cluster-robust SEs active (C&nbsp;=&nbsp;${m.clustersUsed} cluster${m.clustersUsed === 1 ? "" : "s"}${m.allSingletons ? " — all singletons (HC-robust)" : ""}).</div>`
        : (m.robustError
          ? `<div class="reg-note" style="color:var(--color-warning);margin:2px 0 6px">⚠ Cluster-robust SE: ${escapeHTML(m.robustError)}</div>`
          : "")))
    : "";

  const robust_ci_disp = m.isClustered
    ? { lb: profile.transform(m.robustCiLow), ub: profile.transform(m.robustCiHigh) }
    : null;
  const robustCILine = m.isClustered
    ? `Robust CI [${fmt(robust_ci_disp.lb)}, ${fmt(robust_ci_disp.ub)}] | SE=${fmt(m.robustSE)} | z=${fmt(m.robustStat)} | p=${fmt(m.robustPval)} (df=${m.robustDf})${hBtn("cluster.robust")}<br>`
    : "";

  const SMD_TYPES = new Set(["SMD","SMDH","SMD_paired","SMD1","SMD1H","SMCC"]);
  const cles = SMD_TYPES.has(type) ? clES(m.RE, [m.ciLow, m.ciHigh]) : null;
  const clesLine = cles
    ? `CLES: ${fmt(cles.estimate)} [${fmt(cles.ci[0])}, ${fmt(cles.ci[1])}]${hBtn("pool.cles")}<br>`
    : "";

  const ciLbl = getCiLabel();
  elResults.innerHTML = warningHTML + clusterBanner + (isMHorPeto ? `
    <div class="result-re-primary">
      <span class="result-label">${profile.label} (${methodLabel})</span>
      <span class="result-re-value">${fmt(FE_disp)}</span>
      <span class="result-ci">${ciLbl} [${fmt(feCi_disp.lb)}, ${fmt(feCi_disp.ub)}]</span>
    </div>
    <div class="result-method-note">Fixed-effect only — no τ², RE estimate, or prediction interval.</div>
    <div class="result-het-group">
      <div class="result-section-label">Heterogeneity</div>
      <div class="result-het-stats">I²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%]${hBtn("het.I2")} &nbsp;·&nbsp; H²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]${hBtn("het.H2")}</div>
      <div class="result-het-stats result-het-test">Q(${m.df})=${fmt(m.stat)}, p=${fmt(m.pval)}${hBtn("het.Q")}</div>
    </div>
  ` : `
    <div class="result-re-primary">
      <span class="result-label">${profile.label} (RE)</span>
      <span class="result-re-value">${fmt(RE_disp)}</span>
      <span class="result-ci">${ciLbl} [${fmt(ci_disp.lb)}, ${fmt(ci_disp.ub)}]${m.isClustered ? ` &nbsp;<span class="result-se">SE (model) = ${fmt(m.seRE)}</span>` : ""}</span>
    </div>
    ${useTF && mAdjusted ? `<div class="result-re-adjusted">RE (adjusted): <b>${fmt(RE_adj_disp)}</b>${hasClusters ? ` <span class="result-note">(cluster-robust not applied to imputed studies)</span>` : ""}</div>` : ""}
    <div class="result-stat-row">
      <span class="result-row-label">Test of pooled effect</span>
      <span class="result-stat-value">${m.dist}-stat = ${fmt(m.stat)}, p = ${fmt(m.pval)}</span>
    </div>
    <div class="result-stat-row">
      <span class="result-row-label">Prediction interval</span>
      <span class="result-stat-value">${isFinite(pred_disp.lb) ? `[${fmt(pred_disp.lb)}, ${fmt(pred_disp.ub)}]` : "NA (k &lt; 3)"}${hBtn("het.pred")}</span>
    </div>
    <div class="result-fe-secondary">
      <span class="result-label">${profile.label} (FE)</span>
      <span>${fmt(FE_disp)}</span>
      <span class="result-ci">${ciLbl} [${fmt(feCi_disp.lb)}, ${fmt(feCi_disp.ub)}]</span>
    </div>
    ${robustCILine}${clesLine}<div class="result-het-group">
      <div class="result-section-label">Heterogeneity</div>
      <div class="result-het-stats">τ²=${fmt(m.tau2)} [${fmt(m.tauCI[0])}, ${isFinite(m.tauCI[1])?fmt(m.tauCI[1]):"∞"}]${hBtn("het.tau2")} &nbsp;·&nbsp; I²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%]${hBtn("het.I2")} &nbsp;·&nbsp; H²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]${hBtn("het.H2")}</div>
      <div class="result-het-stats result-het-test">Q(${m.df})=${fmt(m.Q)}, p=${fmt(m.df > 0 ? 1 - chiSquareCDF(m.Q, m.df) : NaN)}${hBtn("het.Q")}</div>
    </div>
  `);

  // ── Publication bias panel ─────────────────────────────────────────────────
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
    &nbsp;&nbsp;${hBtn("bias.hc")}Henmi-Copas: ${hc.error ? `NA (${escapeHTML(hc.error)})` : `${fmt(profile.transform(hc.beta))} [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}] (DL τ²=${fmt(hc.tau2)}, t₀=${fmt(hc.t0)})`}<br>
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
  _animateFresh(elResults);

  // ── Influence diagnostics + subgroup ──────────────────────────────────────
  const influenceHTML = buildInfluenceHTML(influence);
  const hasSubgroup   = subgroup && subgroup.G >= 2;
  const subgroupHTML  = hasSubgroup ? buildSubgroupHTML(subgroup, profile, hasClusters) : "";

  elInfluenceDiagTable.innerHTML = influenceHTML;
  elSubgroupSection.style.display = hasSubgroup ? "" : "none";
  elSubgroupTable.innerHTML = (hasSubgroup && isMHorPeto)
    ? `<p class="reg-note" style="margin:4px 0 8px">⚠ Subgroup pooling uses inverse-variance (DL) weights — switch to DL or REML for M-H subgroup analysis.</p>` + subgroupHTML
    : subgroupHTML;

  renderStudyTable(all, m, profile);
  _animateFresh(document.getElementById("studyTable"));

  // ── Sensitivity panel (LOO) ───────────────────────────────────────────────
  performance.mark("phase:loo:render:start");
  renderSensitivityPanel(studies, isMHorPeto ? null : m, isMHorPeto ? "DL" : method, ciMethod, profile, { isMHFallback: isMHorPeto }, alpha);
  performance.measure("phase:loo:render", "phase:loo:render:start");

  renderPCurvePanel(pcurve);
  renderPUniformPanel(puniform, m, profile);
  renderSelectionModelPanel(selResult, selModeVal, profile);

  // ── Regression panel + bubble plots ───────────────────────────────────────
  const modSpec      = opts.modSpec;
  const scaleModSpec = opts.scaleModSpec;
  const kExcluded    = (reg ?? ls) ? studies.length - (reg ?? ls).k : 0;
  if (ls) {
    _lastReg = null;
    renderLocationScalePanel(ls, ciMethod, kExcluded);
  } else {
    _lastReg = (reg && !reg.rankDeficient) ? reg : null;
    renderRegressionPanel(reg ?? {}, method, ciMethod, kExcluded, moderators);
  }

  const bubbleContainer = elBubblePlots;
  bubbleContainer.innerHTML = "";
  const bubbleResult = ls ? {
    tau2:        ls.tau2_mean,
    beta:        ls.beta,
    colNames:    ls.locColNames,
    modColMap:   ls.locColMap,
    modKnots:    ls.locKnots,
    vcov:        ls.vcov_beta,
    crit:        ls.crit,
    s2:          1,
    fitted:      ls.fitted,
    residuals:   ls.residuals,
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
        const wrap = document.createElement("div");
        wrap.dataset.moderator = mod.name;
        bubbleContainer.appendChild(wrap);
        if (usePartialBubble) {
          drawPartialResidualBubble(bubbleResult.studiesUsed, bubbleResult, mod, wrap);
        } else {
          drawBubble(bubbleResult.studiesUsed, bubbleResult, mod, wrap);
        }
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

  // ── Forest plot ───────────────────────────────────────────────────────────
  const rawPageSize = elForestPageSize?.value ?? "30";
  const pageSize    = rawPageSize === "Infinity" ? Infinity : +rawPageSize;
  const forestOpts  = { ciMethod, profile, pageSize, pooledDisplay: forestPlot.poolDisplay, theme: forestPlot.theme, alpha, ciLabel: getCiLabel() };
  const mForest     = isMHorPeto
    ? { ...m, RE: m.FE, seRE: m.seFE, tau2: 0, predLow: NaN, predHigh: NaN }
    : m;
  forestPlot.args = { studies: all, m: mForest, options: forestOpts };
  performance.mark("phase:plot:forest:start");
  const { totalPages } = drawForest(all, mForest, { ...forestOpts, page: forestPlot.page });
  performance.measure("phase:plot:forest", "phase:plot:forest:start");
  renderForestNav(totalPages);

  // ── Report args cache ─────────────────────────────────────────────────────
  const _selPreset = elSelPreset.value;
  const _selLabel  = selModeVal === "mle"
    ? "MLE"
    : _selPreset !== "custom"
      ? (SELECTION_PRESETS[_selPreset]?.label ?? _selPreset)
      : "Custom";

  appState.reportArgs = {
    studies: all, m, profile, reg,
    tf, egger, begg, fatpet, petpeese, fsn, tes, waap, cles, pcurve, puniform,
    harbord, peters, deeks, ruecker, hc, baujatResult,
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

  // ── Funnel plot ───────────────────────────────────────────────────────────
  funnelPlot.args = [all, m, profile];
  funnelPlot.egger = egger;
  funnelPlot.petpeese = petpeese;
  drawIfVisible("pubBiasSection", () => {
    performance.mark("phase:plot:funnel:start");
    drawFunnel(...funnelPlot.args, { egger: funnelPlot.egger, contours: funnelPlot.contours, petpeese: funnelPlot.petpeese });
    performance.measure("phase:plot:funnel", "phase:plot:funnel:start");
  });

  // ── BLUPs, Baujat, QQ, Radial, L'Abbé ─────────────────────────────────────
  const labbeTypes  = ["OR", "RR", "RD"];
  const showLabbe   = labbeTypes.includes(type);
  const showQQ      = qqResiduals.length >= 3;

  blupPlot.result  = blupResult;
  blupPlot.profile = profile;
  blupPlot.page    = 0;
  elBlupBlock.style.display      = blupResult ? "" : "none";
  elBaujatPlotBlock.style.display = baujatResult ? "" : "none";
  elQQPlotBlock.style.display     = showQQ ? "" : "none";
  elRadialPlotBlock.style.display = studies.length >= 2 && !isMHorPeto ? "" : "none";
  elLabbeBlock.style.display      = showLabbe ? "" : "none";

  drawIfVisible("diagnosticSection", () => {
    performance.mark("phase:plot:influence:start");
    drawInfluencePlot(influence);
    if (blupResult) {
      const { totalPages: blupPages } = drawBlupPlot(blupResult, profile, { pageSize: blupPlot.pageSize, page: 0 });
      renderBlupNav(blupPages);
    }
    drawBaujatPlot(baujatResult, profile);
    if (showQQ)  drawQQPlot(qqResiduals, qqLabels);
    if (studies.length >= 2 && !isMHorPeto) drawRadialPlot(studies, m, profile);
    if (showLabbe) drawLabbe(studies, m, profile, { type });
    performance.measure("phase:plot:influence", "phase:plot:influence:start");
  });

  // ── Cumulative meta-analysis ──────────────────────────────────────────────
  const rawCumPageSize    = elCumForestPageSize?.value ?? "30";
  const cumForestPageSize = rawCumPageSize === "Infinity" ? Infinity : +rawCumPageSize;
  cumForestPlot.args  = { results: cumResults, profile, pageSize: cumForestPageSize, alpha, ciLabel: getCiLabel() };
  appState.reportArgs.cumForestOptions = { results: cumResults, profile, pageSize: cumForestPageSize, currentPage: 0, alpha, ciLabel: getCiLabel() };

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

  // ── Orchard + caterpillar plots ───────────────────────────────────────────
  elOrchardPlotBlock.style.display = "";
  caterpillarPlot.page = 0;
  const rawCatPageSize = elCatPageSize?.value ?? "30";
  const catPageSize    = rawCatPageSize === "Infinity" ? Infinity : +rawCatPageSize;
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

  // ── Risk-of-bias plots ─────────────────────────────────────────────────────
  const hasRoB = _robDomains.length > 0 && studies.length > 0;
  elRobSection.style.display = hasRoB ? "" : "none";
  if (hasRoB) {
    drawIfVisible("robSection", () => {
      drawRoBTrafficLight(studies, _robDomains, _robData);
      drawRoBSummary(studies, _robDomains, _robData);
    });
  }

  // ── Validation warnings + run-state badges ────────────────────────────────
  updateValidationWarnings(studies, excluded, softWarnings);

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
}

// ── Thin coordinator ──────────────────────────────────────────────────────────
async function runAnalysis() {
  if (_analysisRunning) return false;
  _analysisRunning = true;
  const _runBtn      = document.getElementById("run");
  const _runProgress = document.getElementById("runProgress");
  if (_runBtn)      { _runBtn.disabled = true; _runBtn.innerHTML = "Running\u2026"; }
  if (_runProgress) _runProgress.hidden = false;
  // Double-rAF: first fires before paint, second fires after — guarantees the
  // progress bar has been painted before the synchronous computation blocks.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
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
    document.querySelectorAll(".results-section").forEach(d => d.removeAttribute("open"));
    forestPlot.page = 0;
    caterpillarPlot.page = 0;
    cumForestPlot.page = 0;

    const type    = document.getElementById("effectType").value;
    const profile = effectProfiles[type];
    if (!profile) return;

    // ── Phase 1: Parse input table ────────────────────────────────────────
    performance.mark("phase:parse:start");
    const { studies, excluded, softWarnings, missingCorrelation } = collectStudies(type);
    performance.measure("phase:parse", "phase:parse:start");

    if (!studies.length) {
      if (outputPlaceholder) {
        outputPlaceholder.style.display = "";
        outputPlaceholder.textContent = "No valid studies to analyse. Check the input table for errors.";
      }
      performance.measure("runAnalysis", "runAnalysis:start");
      return false;
    }

    // Clear stale indicators; unlock results panel on first successful run.
    if (outputPlaceholder) outputPlaceholder.style.display = "none";
    staleBanner.style.display = "none";
    _toggleResults.classList.remove("stale");
    if (inputStaleBadge) inputStaleBadge.hidden = true;
    if (!appState.hasRunOnce) {
      appState.hasRunOnce = true;
      _toggleResults.disabled = false;
    }

    // ── Shared settings ───────────────────────────────────────────────────
    const method        = document.getElementById("tauMethod")?.value   || "DL";
    const ciMethod      = document.getElementById("ciMethod")?.value    || "normal";
    const alpha         = getCiAlpha();
    const useTF         = document.getElementById("useTrimFill")?.checked;
    const tfEstimator   = document.getElementById("tfEstimator")?.value || "L0";
    const useTFAdjusted = document.getElementById("useTFAdjusted")?.checked;
    const isMHorPeto    = method === "MH" || method === "Peto";
    const hasClusters   = studies.some(s => s.cluster);
    const rveRho        = parseFloat(document.getElementById("rveRho")?.value ?? 0.8);
    const modSpec       = moderators.map(mod => ({ key: mod.name, type: mod.type, transform: mod.transform || "linear" }));
    const scaleModSpec  = scaleModerators.map(mod => ({ key: mod.name, type: mod.type, transform: mod.transform || "linear" }));
    const cumulativeOrder = document.getElementById("cumulativeOrder")?.value || "input";

    // Selection model settings (read up front so _runPubBiasBatch is pure)
    const selModeVal = document.getElementById("selMode").value;
    const selPreset  = document.getElementById("selPreset").value;
    const selSides   = parseInt(document.getElementById("selSides").value, 10);
    const rawSelCuts = document.getElementById("selCuts").value
      .split(",").map(s => parseFloat(s.trim())).filter(isFinite);
    const selCuts = rawSelCuts.length >= 2 && rawSelCuts[rawSelCuts.length - 1] === 1.0
      ? rawSelCuts
      : [...rawSelCuts.filter(c => c < 1), 1.0];

    // Bayesian prior settings
    const bayesMu0      = parseFloat(document.getElementById("bayesMu0")?.value)      || 0;
    const bayesSigmaMu  = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaMu")?.value)  || 1);
    const bayesSigmaTau = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaTau")?.value) || 0.5);

    const opts = {
      method, ciMethod, alpha, type, useTF, tfEstimator, useTFAdjusted,
      isMHorPeto, hasClusters, rveRho, modSpec, scaleModSpec, cumulativeOrder,
      selModeVal, selPreset, selSides, selCuts,
      bayesMu0, bayesSigmaMu, bayesSigmaTau,
    };

    // ── Phase 2: Core meta-analysis ───────────────────────────────────────
    performance.mark("phase:meta:start");
    const coreMeta = _runCoreMeta(studies, opts);
    performance.measure("phase:meta", "phase:meta:start");
    const { m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult } = coreMeta;

    if (m.error) {
      document.getElementById("results").innerHTML =
        `<b style="color:var(--color-warning)">Error: ${escapeHTML(m.error)}</b>`;
      performance.measure("runAnalysis", "runAnalysis:start");
      return false;
    }

    // ── Phase 3: Bayesian ─────────────────────────────────────────────────
    performance.mark("phase:bayes:start");
    const { bayesResult, reMeanRef } = _runBayesBatch(studies, m, opts);
    performance.measure("phase:bayes", "phase:bayes:start");

    // ── Phase 4: Publication bias ─────────────────────────────────────────
    performance.mark("phase:pubbias:start");
    const pubBias = _runPubBiasBatch(studies, m, opts);
    performance.measure("phase:pubbias", "phase:pubbias:start");

    // ── Phase 5: Sensitivity / influence / cumulative ─────────────────────
    performance.mark("phase:loo:start");
    const sensitivity = _runSensitivityBatch(studies, m, opts);
    performance.measure("phase:loo", "phase:loo:start");

    // ── Phase 6: Meta-regression / subgroup ───────────────────────────────
    performance.mark("phase:regression:start");
    const regression = _runRegressionBatch(studies, m, opts);
    performance.measure("phase:regression", "phase:regression:start");

    // ── Phase 7: Render all output panels ─────────────────────────────────
    _renderAllResults({
      type, profile, studies, excluded, softWarnings, missingCorrelation,
      m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult,
      bayesResult, reMeanRef,
      ...pubBias,
      ...sensitivity,
      ...regression,
      opts,
    });

    performance.measure("runAnalysis", "runAnalysis:start");
    if (PERF_LOG) {
      const entries = performance.getEntriesByType("measure")
        .filter(e => e.name.startsWith("phase:") || e.name === "runAnalysis");
      console.table(entries.map(e => ({ name: e.name, ms: +e.duration.toFixed(2) })));
    }
    return true;
  } finally {
    _analysisRunning = false;
    if (_runBtn)     { _runBtn.disabled = false; _runBtn.innerHTML = 'Run <kbd class="run-kbd">(Ctrl+Enter)</kbd>'; }
    if (_runProgress) _runProgress.hidden = true;
  }
}