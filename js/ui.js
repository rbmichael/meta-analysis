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
import { eggerTest, beggTest, fatPetTest, petPeeseTest, failSafeN, tesTest, waapWls, clES, pCurve, pUniform, baujat, blupMeta, meta, metaMH, metaPeto, robustMeta, influenceDiagnostics, subgroupAnalysis, metaRegression, testContrast, cumulativeMeta, veveaHedges, SELECTION_PRESETS, halfNormalSelModel, powerSelModel, negexpSelModel, betaSelModel, profileLikTau2, bayesMeta, priorSensitivity, rvePooled, meta3level, harbordTest, petersTest, deeksTest, rueckerTest, lsModel, henmiCopas, isValidStudy } from "./analysis.js";
import { fmt, fmtPval, normalQuantile, normalCDF, chiSquareCDF, tCritical } from "./utils.js";
import { escapeHTML } from "./utils-html.js";
import { effectProfiles, getProfile } from "./profiles.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel, drawBubble, drawPartialResidualBubble, drawInfluencePlot, drawCumulativeForest, drawCumulativeFunnel, drawOrchardPlot, drawCaterpillarPlot, drawBlupPlot, drawBaujatPlot, drawLabbe, drawRoBTrafficLight, drawRoBSummary, drawGoshPlot, drawProfileLikTau2, drawBayesTauPosterior, drawBayesMuPosterior, drawQQPlot, drawRadialPlot, setTooltipElement } from "./plots.js";
import { goshCompute, GOSH_MAX_K } from "./gosh.js";
import { permTestSync, permPval } from "./perm.js";
import { vcalc, mvMeta } from "./multivariate.js";
import { exportSVG, exportPNG, exportTIFF, resolveThemeVars, hasEmbeddedBackground, currentBgColour } from "./export.js";
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
         formatContrastResult, renderPermResults }
  from "./ui-render.js";
import { validateRow, gatherSessionState } from "./ui-state.js";
import { initTable, moderators, doAddModerator, removeModerator, clearModerators,
         interactions, doAddInteraction, removeInteraction, clearInteractions,
         updateTableHeaders, addRow, commitPendingDelete, removeRow, clearRow,
         updateValidationWarnings, collectStudies,
         refreshPreviewUI, previewCSV, commitImport, cancelImport, getPendingImport,
         registerDeleteCompanion, showUndoToast, hideUndoToast }
  from "./ui-table.js";

const USE_EXAMPLES = new URLSearchParams(window.location.search).has("tests");

// ---------------- AUTOSAVE ----------------

let _saveTimer = null;

// Last successful metaRegression result — referenced by the contrast test handler.
let _lastReg = null;

// scheduleSave()
// Debounced autosave trigger. Resets the 1.2 s idle timer on every call; the
// actual save fires once the user pauses for 1.2 s. Does NOT call runAnalysis()
// — analysis is triggered separately by the callers.
// Build a complete session object for autosave, including MV state when active.
function _buildAutosaveSession() {
  const session = gatherSessionState(moderators, scaleModerators, interactions, { domains: _robDomains, data: _robData });
  if (_mvMode) session.mv = _gatherMVState();
  return session;
}

// Return true if the session has any data worth preserving.
// Prevents an effect-type change (which clears the standard table) from
// overwriting a valid draft with an empty one.
function _autosaveHasData(session) {
  if (session.studies.length > 0) return true;
  if (session.mv) return session.mv.rows.some(r => r.study_id || r.outcome_id || r.yi || r.vi);
  return false;
}

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const session = _buildAutosaveSession();
    if (_autosaveHasData(session)) saveDraft(session);
  }, 1200);
}

// ---------------- DEBOUNCED ANALYSIS ----------------

let _analysisRunning = false;

// Flush any pending debounced save immediately.
// Called on beforeunload and visibilitychange so changes made in the last
// 1.2 s before tab close/backgrounding are not lost.
function flushSave() {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  const session = _buildAutosaveSession();
  if (_autosaveHasData(session)) saveDraft(session);
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
  "input.interactions":    "Interaction terms",
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
  refreshInteractionUI();
  markStale();
}

// ---- Interaction term manager ----

function refreshInteractionUI() {
  const names = moderators.map(m => m.name);
  const mgr = document.getElementById("interactionManager");
  if (!mgr) return;
  mgr.style.display = names.length >= 2 ? "" : "none";

  const termA = document.getElementById("interactTermA");
  const termB = document.getElementById("interactTermB");
  if (!termA || !termB) return;

  const prevA = termA.value;
  const prevB = termB.value;
  const opts = names.map(n => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join("");
  termA.innerHTML = opts;
  termB.innerHTML = opts;
  if (names.includes(prevA)) termA.value = prevA;
  if (names.includes(prevB) && prevB !== termA.value) termB.value = prevB;
  // Ensure the two selects default to different moderators when possible.
  if (termA.value === termB.value && names.length >= 2) {
    termB.value = names.find(n => n !== termA.value) ?? names[0];
  }

  renderInteractionTags();
}

function renderInteractionTags() {
  const container = document.getElementById("interactionTags");
  if (!container) return;
  container.innerHTML = "";
  interactions.forEach(({ name, termA, termB }) => {
    const span = document.createElement("span");
    span.className = "mod-tag";
    span.innerHTML = `${escapeHTML(termA)} × ${escapeHTML(termB)} <button class="remove-mod-btn" title="Remove interaction">×</button>`;
    span.querySelector("button").addEventListener("click", () => {
      removeInteraction(name);
      renderInteractionTags();
      markStale();
    });
    container.appendChild(span);
  });
}

function addInteractionTerm() {
  const termA = document.getElementById("interactTermA")?.value ?? "";
  const termB = document.getElementById("interactTermB")?.value ?? "";
  if (!termA || !termB || termA === termB) return;
  doAddInteraction(termA, termB);
  renderInteractionTags();
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
    span.innerHTML = `${escapeHTML(name)} <button class="remove-mod-btn" title="Remove scale moderator">×</button>`;
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

// ---------------- MULTIVARIATE MODE ----------------

let _mvMode = false;

// Moderator list for multivariate mode (array of name strings).
const _mvModerators = [];

// Forest plot state for MV mode — persists across page/PI-toggle redraws.
const _mvForestState = {
  pageSize:     20,
  pages:        [],    // current page index per outcome (separate mode)
  combinedPage: 0,     // current page index (combined mode)
  showPI:       false,
  lastRes:      null,  // last mvMeta result
  lastRows:     [],    // last collected rows
  alpha:        0.05,
  viewMode:     "separate", // "separate" | "combined"
};

function _applyModeToggle() {
  const isMV = _mvMode;
  document.getElementById("modeStandard").classList.toggle("active", !isMV);
  document.getElementById("modeMultivariate").classList.toggle("active", isMV);
  document.getElementById("standardSettings").style.display        = isMV ? "none" : "";
  document.getElementById("advancedSettings").style.display        = isMV ? "none" : "";
  document.getElementById("mvSettings").style.display              = isMV ? ""     : "none";
  document.getElementById("inputTableWrap").style.display          = isMV ? "none" : "";
  document.getElementById("addStudy").style.display                = isMV ? "none" : "";
  document.getElementById("mvTableWrap").style.display             = isMV ? ""     : "none";
  document.getElementById("mvAddRow").style.display                = isMV ? ""     : "none";
}

// ── MV moderator management ───────────────────────────────────────────────────

function _renderMVModTags() {
  const container = document.getElementById("mvModTags");
  container.innerHTML = _mvModerators.map((name, i) =>
    `<span class="mod-tag">` +
    `<span>${escapeHTML(name)}</span>` +
    `<button onclick="_mvRemoveMod(${i})" title="Remove">×</button>` +
    `</span>`
  ).join("");
}

// Exposed to inline onclick (inside tag HTML)
window._mvRemoveMod = function(i) {
  _mvModerators.splice(i, 1);
  _renderMVModTags();
  _rebuildMVTableHeaders();
  markStale();
};

function _mvAddMod() {
  const input = document.getElementById("mvModName");
  const name = input.value.trim();
  if (!name || _mvModerators.includes(name)) return;
  _mvModerators.push(name);
  input.value = "";
  _renderMVModTags();
  _rebuildMVTableHeaders();
  markStale();
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
  markStale();
}

registerDeleteCompanion(_mvCommitPendingDelete);

function _rebuildMVTableHeaders() {
  const tr = document.getElementById("mvTableHead");
  // Fixed columns + moderator columns + actions
  tr.innerHTML =
    "<th>Study ID</th><th>Outcome ID</th><th>Effect (y<sub>i</sub>)</th><th>Variance (v<sub>i</sub>)</th>" +
    _mvModerators.map(m => `<th>${escapeHTML(m)}</th>`).join("") +
    '<th class="col-actions">Actions</th>';
  // Also rebuild each row's moderator cells if count changed
  document.querySelectorAll("#mvTableBody tr").forEach(row => {
    _syncMVRowMods(row);
  });
}

function _syncMVRowMods(tr) {
  // Ensure each row has exactly _mvModerators.length mod inputs after vi cell.
  // Fixed cells: study_id(0), outcome_id(1), yi(2), vi(3), ...mods, actions(last)
  const cells = tr.querySelectorAll("td");
  const fixedCount = 4;
  const currentModCount = cells.length - fixedCount - 1; // subtract actions td
  if (currentModCount === _mvModerators.length) return;

  const actionsTd = tr.lastElementChild;
  // Remove excess mod tds
  while (tr.querySelectorAll("td").length - 1 > fixedCount + _mvModerators.length) {
    const tds = tr.querySelectorAll("td");
    tr.removeChild(tds[tds.length - 2]); // remove last before actions
  }
  // Add missing mod tds
  while (tr.querySelectorAll("td").length - 1 < fixedCount + _mvModerators.length) {
    const td = document.createElement("td");
    td.innerHTML = `<input type="text" class="mv-mod-cell" style="width:90px">`;
    tr.insertBefore(td, actionsTd);
  }
}

function _validateMVRow(tr) {
  const yiInput = tr.querySelector(".mv-yi");
  const viInput = tr.querySelector(".mv-vi");
  [yiInput, viInput].forEach(inp => inp?.classList.remove("input-error"));
  tr.classList.remove("row-error");

  const allInputs = [...tr.querySelectorAll("input")];
  if (allInputs.every(inp => inp.value.trim() === "")) return true; // blank row — no errors

  let valid = true;
  const yiVal = yiInput?.value.trim() ?? "";
  const viVal = viInput?.value.trim() ?? "";

  if (yiVal === "" || !isFinite(parseFloat(yiVal))) {
    yiInput?.classList.add("input-error");
    valid = false;
  }
  const viNum = parseFloat(viVal);
  if (viVal === "" || !isFinite(viNum) || viNum <= 0) {
    viInput?.classList.add("input-error");
    valid = false;
  }
  tr.classList.toggle("row-error", !valid);
  return valid;
}

function _mvAddRow() {
  const tbody = document.getElementById("mvTableBody");
  const tr = document.createElement("tr");
  tr.draggable = true;
  const modCells = _mvModerators.map(() =>
    `<td><input type="text" class="mv-mod-cell" style="width:90px"></td>`
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
    markStale();
  });
  tr.querySelector(".clear-btn").addEventListener("click", () => {
    tr.querySelectorAll("input").forEach(inp => { inp.value = ""; });
    _validateMVRow(tr);
    markStale();
  });
  let _valTimer;
  tr.querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => {
    clearTimeout(_valTimer);
    _valTimer = setTimeout(() => { _validateMVRow(tr); _updateMVValidationWarnings(); markStale(); }, 150);
  }));
  tbody.appendChild(tr);
  return tr;
}

function _collectMVRows() {
  const rows = [];
  document.querySelectorAll("#mvTableBody tr").forEach(tr => {
    if (tr.classList.contains("row-pending-delete")) return;
    const study_id   = tr.querySelector(".mv-study-id")?.value.trim();
    const outcome_id = tr.querySelector(".mv-outcome-id")?.value.trim();
    const yi = parseFloat(tr.querySelector(".mv-yi")?.value);
    const vi = parseFloat(tr.querySelector(".mv-vi")?.value);
    if (!study_id || !outcome_id || !isFinite(yi) || !isFinite(vi) || vi <= 0) return;
    const row = { study_id, outcome_id, yi, vi };
    const modInputs = tr.querySelectorAll(".mv-mod-cell");
    _mvModerators.forEach((name, i) => {
      row[name] = parseFloat(modInputs[i]?.value);
    });
    rows.push(row);
  });
  return rows;
}

function _gatherMVState() {
  const rows = [];
  document.querySelectorAll("#mvTableBody tr").forEach(tr => {
    if (tr.classList.contains("row-pending-delete")) return;
    const entry = {
      study_id:   tr.querySelector(".mv-study-id")?.value  ?? "",
      outcome_id: tr.querySelector(".mv-outcome-id")?.value ?? "",
      yi: tr.querySelector(".mv-yi")?.value ?? "",
      vi: tr.querySelector(".mv-vi")?.value ?? "",
    };
    _mvModerators.forEach((name, i) => {
      const inputs = tr.querySelectorAll(".mv-mod");
      entry[name] = inputs[i]?.value ?? "";
    });
    rows.push(entry);
  });
  return {
    struct:     document.getElementById("mvStruct").value,
    method:     document.getElementById("mvMethod").value,
    rho:        parseFloat(document.getElementById("mvRho").value),
    moderators: [..._mvModerators],
    rows,
  };
}

function _populateMVExample() {
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
    const tr = _mvAddRow();
    tr.querySelector(".mv-study-id").value  = r.study_id;
    tr.querySelector(".mv-outcome-id").value = r.outcome_id;
    tr.querySelector(".mv-yi").value = r.yi;
    tr.querySelector(".mv-vi").value = r.vi;
  });
}

function _commitImportMV(parsed, mvHeaders) {
  const { headers, rows } = parsed;
  const headerMap = {};
  headers.forEach((h, idx) => { headerMap[h.toLowerCase()] = idx; });

  const { studyCol, outcomeCol, yiCol, viCol } = mvHeaders;
  const knownCols = new Set([studyCol, outcomeCol, yiCol, viCol].map(c => c.toLowerCase()));
  const modCols = headers.filter(h => !knownCols.has(h.toLowerCase()));

  // Register MV moderators
  _mvModerators.length = 0;
  modCols.forEach(col => _mvModerators.push(col));
  _renderMVModTags();
  _rebuildMVTableHeaders();

  // Clear and populate MV table
  document.getElementById("mvTableBody").innerHTML = "";
  rows.forEach(row => {
    const tr = _mvAddRow();
    tr.querySelector(".mv-study-id").value   = row[headerMap[studyCol.toLowerCase()]]  ?? "";
    tr.querySelector(".mv-outcome-id").value = row[headerMap[outcomeCol.toLowerCase()]] ?? "";
    tr.querySelector(".mv-yi").value         = row[headerMap[yiCol.toLowerCase()]]      ?? "";
    tr.querySelector(".mv-vi").value         = row[headerMap[viCol.toLowerCase()]]      ?? "";
    modCols.forEach((col, i) => {
      const inputs = tr.querySelectorAll(".mv-mod");
      if (inputs[i]) inputs[i].value = row[headerMap[col.toLowerCase()]] ?? "";
    });
  });
  markStale();
}

// ── MV analysis & rendering ───────────────────────────────────────────────────

function _updateMVValidationWarnings() {
  const warningsEl = document.getElementById("mvValidationWarnings");
  const msgs = [];
  document.querySelectorAll("#mvTableBody tr").forEach((tr, i) => {
    if (tr.classList.contains("row-pending-delete")) return;
    const allInputs = [...tr.querySelectorAll("input")];
    if (allInputs.every(inp => inp.value.trim() === "")) return;
    const studyId   = tr.querySelector(".mv-study-id")?.value.trim()  || `Row ${i + 1}`;
    const outcomeId = tr.querySelector(".mv-outcome-id")?.value.trim() || "";
    const label     = outcomeId ? `${studyId} / ${outcomeId}` : studyId;
    const yi = parseFloat(tr.querySelector(".mv-yi")?.value);
    const vi = parseFloat(tr.querySelector(".mv-vi")?.value);
    if (!tr.querySelector(".mv-study-id")?.value.trim() ||
        !tr.querySelector(".mv-outcome-id")?.value.trim() ||
        !isFinite(yi) || !isFinite(vi) || vi <= 0)
      msgs.push(`⚠️ Excluded: ${escapeHTML(label)} (Invalid input)`);
  });
  const rows = _collectMVRows();
  if (!rows.length) msgs.push("❌ No valid rows — fill in Study ID, Outcome ID, y<sub>i</sub>, and v<sub>i</sub>.");
  warningsEl.innerHTML = msgs.length > 0 ? msgs.map(m => `• ${m}`).join("<br>") : "";
}

function _runMVAnalysis() {
  // Validate all rows → CSS feedback
  document.querySelectorAll("#mvTableBody tr").forEach(tr => {
    if (!tr.classList.contains("row-pending-delete")) _validateMVRow(tr);
  });
  _updateMVValidationWarnings();

  const rows = _collectMVRows();
  const warningsEl = document.getElementById("mvValidationWarnings");

  if (!rows.length) return false;

  const msgs = [];
  const outcomeIds = [...new Set(rows.map(r => r.outcome_id))];
  const studyIds   = [...new Set(rows.map(r => r.study_id))];

  if (outcomeIds.length < 2) {
    msgs.push("❌ Requires ≥ 2 distinct outcome IDs. For a single outcome, use Standard mode.");
    warningsEl.innerHTML = msgs.map(m => `• ${m}`).join("<br>");
    return false;
  }
  if (studyIds.length < 3) {
    msgs.push("❌ Requires ≥ 3 studies.");
    warningsEl.innerHTML = msgs.map(m => `• ${m}`).join("<br>");
    return false;
  }

  // Warn: studies with only 1 outcome
  const studyOutcomeCounts = {};
  rows.forEach(r => { studyOutcomeCounts[r.study_id] = (studyOutcomeCounts[r.study_id] || new Set()); studyOutcomeCounts[r.study_id].add(r.outcome_id); });
  const singleOutcomeStudies = Object.entries(studyOutcomeCounts).filter(([,s]) => s.size === 1).map(([id]) => id);
  if (singleOutcomeStudies.length === studyIds.length)
    msgs.push("⚠️ All studies contribute only one outcome — within-study correlations cannot be estimated. Consider using Standard mode or checking that Study IDs correctly group multiple outcomes per study.");
  else if (singleOutcomeStudies.length > 0)
    msgs.push(`⚠️ Studies with only one outcome (contribute no covariance): ${singleOutcomeStudies.map(escapeHTML).join(", ")}.`);

  const struct = document.getElementById("mvStruct").value;
  const method = document.getElementById("mvMethod").value;
  const rho    = parseFloat(document.getElementById("mvRho").value);
  const alpha  = getCiAlpha();
  const mods   = _mvModerators.map(key => ({ key, type: "continuous" }));

  // Warn UN + many outcomes
  const nPsiPar = struct === "CS" ? 2 : struct === "Diag" ? outcomeIds.length : outcomeIds.length * (outcomeIds.length + 1) / 2;
  if (struct === "UN" && outcomeIds.length > 5)
    msgs.push(`⚠️ UN structure with P = ${outcomeIds.length} outcomes requires ${nPsiPar} Ψ parameters — optimizer instability likely. Consider CS or Diag.`);

  // Warn overparameterized
  if (nPsiPar > studyIds.length / 3)
    msgs.push(`⚠️ Between-study covariance has ${nPsiPar} parameters but only ${studyIds.length} studies — model may be overparameterized.`);

  warningsEl.innerHTML = msgs.length ? msgs.map(m => `• ${m}`).join("<br>") : "";

  let V, res;
  try {
    V   = vcalc(rows, { rho });
    res = mvMeta(rows, V, { struct, method, alpha, moderators: mods });
  } catch (e) {
    warningsEl.innerHTML += (warningsEl.innerHTML ? "<br>" : "") + `• ❌ Error: ${escapeHTML(String(e))}`;
    return false;
  }

  if (res.error) {
    warningsEl.innerHTML += (warningsEl.innerHTML ? "<br>" : "") + `• ❌ Error: ${escapeHTML(res.error)}`;
    return false;
  }

  // Hide all collapsible result sections (they belong to standard mode)
  document.querySelectorAll(".results-section").forEach(d => { d.removeAttribute("open"); d.style.display = "none"; });

  // Swap forest areas: hide standard forest plot, show MV forest section
  const _stdForestSection = document.getElementById("forestSection");
  const _mvForestSection  = document.getElementById("mvForestSection");
  if (_stdForestSection) _stdForestSection.style.display = "none";
  if (_mvForestSection)  _mvForestSection.style.display  = "";

  _renderMVResults(res, { alpha, rows });

  // Store for HTML/PDF/DOCX export
  appState.reportArgs = { mv: true, mvRes: res, mvRows: rows, mvAlpha: alpha };

  // ── Individual Studies table ───────────────────────────────────────────────
  const _studyTableSection = document.getElementById("studyTableSection");
  const _studyTableEl      = document.getElementById("studyTable");
  if (_studyTableSection && _studyTableEl) {
    _studyTableSection.style.display = "";
    _studyTableEl.innerHTML = _buildMVStudyTable(rows, alpha);
  }

  // ── RoB section (only when domains + data present) ────────────────────────
  const _robSectionEl = document.getElementById("robSection");
  if (_robSectionEl && _robDomains.length > 0 && rows.length > 0) {
    _robSectionEl.style.display = "";
    const robStudies = [...new Set(rows.map(r => r.study_id))].map(id => ({ label: id }));
    drawIfVisible("robSection", () => {
      drawRoBTrafficLight(robStudies, _robDomains, _robData);
      drawRoBSummary(robStudies, _robDomains, _robData);
    });
  }

  // Clear stale markers, unlock results panel
  if (outputPlaceholder) outputPlaceholder.style.display = "none";
  staleBanner.style.display = "none";
  _toggleResults.classList.remove("stale");
  if (inputStaleBadge) inputStaleBadge.hidden = true;
  if (!appState.hasRunOnce) {
    appState.hasRunOnce = true;
    _toggleResults.disabled = false;
  }
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
          n, k, P, QM, df_QM, pQM, QE, df_QE, pQE, logLik, AIC, BIC, AICc,
          struct, method, I2, convergence, warnings: engineWarnings = [] } = res;

  alpha ??= 0.05;
  const ciPct  = Math.round((1 - alpha) * 100);
  const fmtP   = p => !isFinite(p) ? "—" : p < 0.001 ? "< .001" : p.toFixed(3).replace(/^0\./, ".");
  const stars  = p => p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "";
  const hasMods = beta.length > P;

  // ── Engine warnings ────────────────────────────────────────────────────────
  const warnHTML = (engineWarnings.length || convergence === false)
    ? (convergence === false
        ? `<p style="color:var(--color-warning);margin:2px 0">⚠ Optimizer did not fully converge — interpret results with caution.</p>`
        : "") +
      engineWarnings.map(w => `<p style="color:var(--color-warning);margin:2px 0">⚠ ${escapeHTML(w)}</p>`).join("")
    : "";

  // ── Intercept table (one row per outcome) ──────────────────────────────────
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
        <th>${ciPct}% CI</th><th><em>z</em></th><th><em>p</em></th></tr></thead>
      <tbody>${interceptRows}</tbody>
    </table>`;

  // ── Moderator table ────────────────────────────────────────────────────────
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
          <th>${ciPct}% CI</th><th><em>z</em></th><th><em>p</em></th></tr></thead>
        <tbody>${modRows}</tbody>
      </table>`;
  }

  // ── Between-study Ψ̂ ───────────────────────────────────────────────────────
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
  } else { // UN
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

  // ── Hypothesis tests ───────────────────────────────────────────────────────
  const testsBlock = `
    <h4 style="font-size:0.9em;margin:8px 0 4px">Hypothesis tests</h4>
    <table class="reg-table" style="margin-bottom:12px">
      <thead><tr><th>Test</th><th>χ²</th><th>df</th><th><em>p</em></th></tr></thead>
      <tbody>
        ${hasMods && isFinite(QM)
          ? `<tr><td>Omnibus test of moderators (Q<sub>M</sub>)</td><td>${fmt(QM, 3)}</td><td>${df_QM}</td><td>${fmtP(pQM)}</td></tr>`
          : ""}
        <tr><td>Residual heterogeneity (Q<sub>E</sub>)</td><td>${fmt(QE, 3)}</td><td>${df_QE}</td><td>${fmtP(pQE)}</td></tr>
      </tbody>
    </table>`;

  // ── Fit stats ──────────────────────────────────────────────────────────────
  const fitBlock = `<div style="font-size:0.82em;color:var(--fg-muted);margin:4px 0 14px;line-height:1.7">
    k = ${k} studies &nbsp;·&nbsp; n = ${n} obs &nbsp;·&nbsp; P = ${P} outcomes
    &nbsp;|&nbsp; log-lik = ${fmt(logLik, 4)}
    &nbsp;·&nbsp; AIC = ${fmt(AIC, 2)} &nbsp;·&nbsp; BIC = ${fmt(BIC, 2)}
    ${isFinite(AICc) ? `&nbsp;·&nbsp; AICc = ${fmt(AICc, 2)}` : ""}
    &nbsp;|&nbsp; ${method}, Ψ = ${struct}
    ${convergence === false ? `&nbsp;·&nbsp; <span style="color:var(--color-warning)">convergence uncertain</span>` : ""}
  </div>`;

  // Near-zero τ² boundary note
  const boundaryOutcomes = outcomeIds.filter((_, o) => tau2[o] < 1e-6).map(id => escapeHTML(String(id)));
  const boundaryNote = boundaryOutcomes.length
    ? `<p style="color:var(--fg-muted);font-size:0.8em;margin:0 0 6px">ℹ τ² ≈ 0 for ${boundaryOutcomes.join(", ")} — estimate is at the boundary; no detectable between-study heterogeneity for these outcomes.</p>`
    : "";

  // Render summary into the shared #results div (same slot as standard analysis)
  document.getElementById("results").innerHTML =
    warnHTML + interceptTable + modTable + psiBlock + boundaryNote + testsBlock + fitBlock;

  // ── Persist state for re-draws (page nav, PI toggle, page size) ──────────
  _mvForestState.lastRes      = res;
  _mvForestState.lastRows     = rows;
  _mvForestState.alpha        = alpha;
  _mvForestState.pages        = outcomeIds.map(() => 0);
  _mvForestState.combinedPage = 0;

  // ── Forest plots → #mvForestContainer ────────────────────────────────────
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

  _redrawAllMVForestPlots();
}

function _redrawAllMVForestPlots() {
  const { lastRes: res, lastRows: rows, alpha, pages, pageSize, showPI, viewMode, combinedPage } = _mvForestState;
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
      page: combinedPage, pageSize, showPI,
    });
    _renderMVForestNavCombined(navEl, totalPages, allStudyIds.length);
    return;
  }

  // Separate mode
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
      page: pages[o] ?? 0, pageSize, pi: piOpts,
    });
    _renderMVForestNav(navEl, o, totalPages, outcomeRows.length);
  });
}

function _renderMVForestNav(navEl, outcomeIdx, totalPages, kAll) {
  if (!navEl) return;
  if (totalPages <= 1) { navEl.innerHTML = ""; return; }
  const page = _mvForestState.pages[outcomeIdx] ?? 0;
  const prevId = `mvFPrev-${outcomeIdx}`;
  const nextId = `mvFNext-${outcomeIdx}`;
  navEl.innerHTML =
    `<button id="${prevId}" ${page === 0 ? "disabled" : ""}>‹ Prev</button>` +
    `<span>Page ${page + 1} of ${totalPages}</span>` +
    `<button id="${nextId}" ${page >= totalPages - 1 ? "disabled" : ""}>Next ›</button>` +
    `<span class="forest-nav-note">Pooled estimate includes all ${kAll} studies</span>`;
  document.getElementById(prevId)?.addEventListener("click", () => {
    if (_mvForestState.pages[outcomeIdx] > 0) {
      _mvForestState.pages[outcomeIdx]--;
      _redrawAllMVForestPlots();
    }
  });
  document.getElementById(nextId)?.addEventListener("click", () => {
    if (_mvForestState.pages[outcomeIdx] < totalPages - 1) {
      _mvForestState.pages[outcomeIdx]++;
      _redrawAllMVForestPlots();
    }
  });
}

function _drawMVForestPlot(svgEl, rows, pooled, label, alpha = 0.05, { page = 0, pageSize = Infinity, pi = null } = {}) {
  if (typeof d3 === "undefined" || !rows.length) return;

  const z = normalQuantile(1 - alpha / 2);

  // Pagination
  const ps = pageSize === Infinity ? rows.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(rows.length / ps));
  const safePage   = Math.min(Math.max(0, page), totalPages - 1);
  const pageRows   = rows.slice(safePage * ps, safePage * ps + ps);

  // Layout — extra row when PI shown
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

  // X scale — use all rows (not just page) so domain stays stable across pages
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

  // Zero reference line
  const zeroLineH = nS * rowH + 6 + rowH + (piRows ? rowH : 0);
  if (xScale.domain()[0] <= 0 && xScale.domain()[1] >= 0) {
    plotG.append("line")
      .attr("x1", xScale(0)).attr("x2", xScale(0))
      .attr("y1", 0).attr("y2", zeroLineH)
      .attr("stroke", "var(--border)").attr("stroke-dasharray", "3,3").attr("stroke-width", 1);
  }

  // Column headers
  [
    [ml + lW / 2,           "Study"],
    [ml + lW + pW / 2,      label],
    [ml + lW + pW + aW / 2, `Effect [${Math.round((1 - alpha) * 100)}% CI]`],
  ].forEach(([x, text]) =>
    svg.append("text")
      .attr("x", x).attr("y", headerH - 6)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--fg-muted)").attr("font-size", "10px")
      .text(text)
  );

  // Study rows (current page only)
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
      .attr("stroke", "var(--fg)").attr("stroke-width", 1);
    plotG.append("rect")
      .attr("x", xScale(row.yi) - bh).attr("y", y - bh)
      .attr("width", bh * 2).attr("height", bh * 2)
      .attr("fill", "var(--accent)");

    svg.append("text")
      .attr("x", ml + lW - 4).attr("y", headerH + y + 4)
      .attr("text-anchor", "end")
      .attr("fill", "var(--fg)").attr("font-size", "10px")
      .text(String(row.study_id));

    svg.append("text")
      .attr("x", ml + lW + pW + 5).attr("y", headerH + y + 4)
      .attr("text-anchor", "start")
      .attr("fill", "var(--fg)").attr("font-size", "10px")
      .text(`${fmt(row.yi, 3)} [${fmt(lo, 3)}, ${fmt(hi, 3)}]`);
  });

  // Separator
  const sepY = nS * rowH + 4;
  plotG.append("line")
    .attr("x1", 0).attr("x2", pW)
    .attr("y1", sepY).attr("y2", sepY)
    .attr("stroke", "var(--border)").attr("stroke-width", 1);

  // Pooled diamond
  const dY   = sepY + rowH / 2;
  const dLo  = xScale(Math.max(xScale.domain()[0], pooled.lo));
  const dHi  = xScale(Math.min(xScale.domain()[1], pooled.hi));
  const dMid = xScale(pooled.est);
  const dH   = 7;
  plotG.append("polygon")
    .attr("points", `${dMid},${dY - dH} ${dHi},${dY} ${dMid},${dY + dH} ${dLo},${dY}`)
    .attr("fill", "var(--accent)");

  svg.append("text")
    .attr("x", ml + lW - 4).attr("y", headerH + dY + 4)
    .attr("text-anchor", "end")
    .attr("fill", "var(--fg)").attr("font-size", "10px").attr("font-weight", "600")
    .text("Pooled (MV)");
  svg.append("text")
    .attr("x", ml + lW + pW + 5).attr("y", headerH + dY + 4)
    .attr("text-anchor", "start")
    .attr("fill", "var(--fg)").attr("font-size", "10px").attr("font-weight", "600")
    .text(`${fmt(pooled.est, 3)} [${fmt(pooled.lo, 3)}, ${fmt(pooled.hi, 3)}]`);

  // Prediction interval row (below diamond, only when pi != null)
  if (pi && isFinite(pi.lo) && isFinite(pi.hi)) {
    const piY   = dY + rowH;
    const piLoX = xScale(Math.max(xScale.domain()[0], pi.lo));
    const piHiX = xScale(Math.min(xScale.domain()[1], pi.hi));
    const piMid = xScale(pooled.est);
    const piColor = "var(--fg-muted)";
    // Dashed line + endcap ticks
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
    // Label
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

  // X-axis
  const axisOffsetY = sepY + rowH + (piRows ? rowH : 0) + 2;
  plotG.append("g")
    .attr("transform", `translate(0,${axisOffsetY})`)
    .call(d3.axisBottom(xScale).ticks(5).tickSize(3))
    .call(g => g.select(".domain").attr("stroke", "var(--border)"))
    .call(g => g.selectAll(".tick line").attr("stroke", "var(--border)"))
    .call(g => g.selectAll(".tick text")
      .attr("fill", "var(--fg-muted)").attr("font-size", "9px").attr("font-family", "inherit"));

  return { totalPages };
}

function _renderMVForestNavCombined(navEl, totalPages, nStudies) {
  if (!navEl) return;
  if (totalPages <= 1) { navEl.innerHTML = ""; return; }
  const page = _mvForestState.combinedPage;
  navEl.innerHTML =
    `<button id="mvFCPrev" ${page === 0 ? "disabled" : ""}>‹ Prev</button>` +
    `<span>Page ${page + 1} of ${totalPages}</span>` +
    `<button id="mvFCNext" ${page >= totalPages - 1 ? "disabled" : ""}>Next ›</button>` +
    `<span class="forest-nav-note">Pooled estimates include all ${nStudies} studies</span>`;
  document.getElementById("mvFCPrev")?.addEventListener("click", () => {
    if (_mvForestState.combinedPage > 0) { _mvForestState.combinedPage--; _redrawAllMVForestPlots(); }
  });
  document.getElementById("mvFCNext")?.addEventListener("click", () => {
    if (_mvForestState.combinedPage < totalPages - 1) { _mvForestState.combinedPage++; _redrawAllMVForestPlots(); }
  });
}

function _drawMVForestCombined(svgEl, rows, res, alpha, { page = 0, pageSize = Infinity, showPI = false } = {}) {
  if (typeof d3 === "undefined" || !rows.length || !res) return { totalPages: 1 };
  const { beta, ci, se, tau2, outcomeIds, k, P } = res;
  const z = normalQuantile(1 - alpha / 2);
  const dfPred = Math.max(k - P - 1, 1);

  // Unique study IDs for pagination
  const allStudyIds = [...new Set(rows.map(r => String(r.study_id)))];
  const ps = pageSize === Infinity ? allStudyIds.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(allStudyIds.length / ps));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const pageStudyIds = new Set(allStudyIds.slice(safePage * ps, safePage * ps + ps));

  // Distinct colors per outcome (Tableau-10 palette, works on light + dark)
  const palette = ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac"];

  // X domain from all rows + all pooled CIs ± PI
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

  // Layout constants
  const lW = 130, pW = 280, aW = 175;
  const rowH = 20, headerH = 24, axisH = 26;
  const groupHdrH = 22, sepH = 6, spacerH = 10;
  const ml = 6, mr = 6;
  const totalW = ml + lW + pW + aW + mr;

  // Per-outcome page rows (pre-computed for height)
  const perPageRows = outcomeIds.map(id =>
    rows.filter(r => String(r.outcome_id) === String(id) && pageStudyIds.has(String(r.study_id)))
  );
  const groupH = (nS) => groupHdrH + nS * rowH + sepH + rowH + (showPI ? rowH : 0) + spacerH;
  const totalGroupH = perPageRows.reduce((acc, pr) => acc + groupH(pr.length), 0);
  const totalH = headerH + totalGroupH + axisH;

  const svg = d3.select(svgEl).attr("width", totalW).attr("height", totalH);
  svg.selectAll("*").remove();

  const xScale = d3.scaleLinear().domain([xMin - pad, xMax + pad]).range([0, pW]);
  const plotG = svg.append("g").attr("transform", `translate(${ml + lW},${headerH})`);

  // Full-height zero reference line
  if (xScale.domain()[0] <= 0 && xScale.domain()[1] >= 0) {
    plotG.append("line")
      .attr("x1", xScale(0)).attr("x2", xScale(0))
      .attr("y1", 0).attr("y2", totalGroupH)
      .attr("stroke", "var(--border)").attr("stroke-dasharray", "3,3").attr("stroke-width", 1);
  }

  // Column headers
  [
    [ml + lW / 2,           "Study"],
    [ml + lW + pW / 2,      "Effect"],
    [ml + lW + pW + aW / 2, `Effect [${Math.round((1 - alpha) * 100)}% CI]`],
  ].forEach(([x, text]) =>
    svg.append("text").attr("x", x).attr("y", headerH - 6)
      .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").attr("font-size", "10px").text(text)
  );

  let gy = 0; // y cursor in plotG coords

  outcomeIds.forEach((id, o) => {
    const color = palette[o % palette.length];
    const pageRows = perPageRows[o];
    const nS = pageRows.length;
    const allOutcomeRows = rows.filter(r => String(r.outcome_id) === String(id));
    const wMax = Math.max(...allOutcomeRows.map(r => 1 / r.vi), 1);

    // Shaded group header band
    svg.append("rect")
      .attr("x", 0).attr("y", headerH + gy)
      .attr("width", totalW).attr("height", groupHdrH)
      .attr("fill", color).attr("opacity", 0.1);
    svg.append("text")
      .attr("x", ml + 5).attr("y", headerH + gy + groupHdrH - 6)
      .attr("fill", color).attr("font-size", "10px").attr("font-weight", "700")
      .text(escapeHTML(String(id)));
    gy += groupHdrH;

    // Study rows
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
        .attr("text-anchor", "end").attr("fill", "var(--fg)").attr("font-size", "10px")
        .text(String(row.study_id));
      svg.append("text")
        .attr("x", ml + lW + pW + 5).attr("y", headerH + y + 4)
        .attr("text-anchor", "start").attr("fill", "var(--fg)").attr("font-size", "10px")
        .text(`${fmt(row.yi, 3)} [${fmt(lo, 3)}, ${fmt(hi, 3)}]`);
    });
    gy += nS * rowH;

    // Separator
    plotG.append("line")
      .attr("x1", 0).attr("x2", pW)
      .attr("y1", gy + sepH / 2).attr("y2", gy + sepH / 2)
      .attr("stroke", "var(--border)").attr("stroke-width", 1);
    gy += sepH;

    // Pooled diamond
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
      .attr("text-anchor", "end").attr("fill", "var(--fg)").attr("font-size", "10px").attr("font-weight", "600")
      .text("Pooled (MV)");
    svg.append("text")
      .attr("x", ml + lW + pW + 5).attr("y", headerH + dY + 4)
      .attr("text-anchor", "start").attr("fill", "var(--fg)").attr("font-size", "10px").attr("font-weight", "600")
      .text(`${fmt(pooled.est, 3)} [${fmt(pooled.lo, 3)}, ${fmt(pooled.hi, 3)}]`);
    gy += rowH;

    // Prediction interval
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
          .attr("text-anchor", "end").attr("fill", "var(--fg-muted)").attr("font-size", "10px")
          .text("Pred. interval");
        svg.append("text")
          .attr("x", ml + lW + pW + 5).attr("y", headerH + piY + 4)
          .attr("text-anchor", "start").attr("fill", "var(--fg-muted)").attr("font-size", "10px")
          .text(`${fmt(piLo, 3)} to ${fmt(piHi, 3)}`);
      }
      gy += rowH;
    }

    gy += spacerH;
  });

  // X-axis
  plotG.append("g")
    .attr("transform", `translate(0,${gy})`)
    .call(d3.axisBottom(xScale).ticks(5).tickSize(3))
    .call(g => g.select(".domain").attr("stroke", "var(--border)"))
    .call(g => g.selectAll(".tick line").attr("stroke", "var(--border)"))
    .call(g => g.selectAll(".tick text")
      .attr("fill", "var(--fg-muted)").attr("font-size", "9px").attr("font-family", "inherit"));

  return { totalPages };
}

// ---------------- INITIALIZE ----------------
document.getElementById("modeStandard").addEventListener("click",     () => { _mvMode = false; _applyModeToggle(); markStale(); });
document.getElementById("modeMultivariate").addEventListener("click", () => { _mvMode = true;  _applyModeToggle(); markStale(); });
document.getElementById("mvAddRow").addEventListener("click", () => { _mvAddRow(); markStale(); });
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
  markStale();
});
document.getElementById("mvAddMod").addEventListener("click", _mvAddMod);
document.getElementById("mvModName").addEventListener("keydown", e => { if (e.key === "Enter") _mvAddMod(); });
document.getElementById("mvForestPageSize").addEventListener("change", e => {
  const raw = e.target.value;
  _mvForestState.pageSize     = raw === "Infinity" ? Infinity : +raw;
  _mvForestState.pages        = _mvForestState.pages.map(() => 0);
  _mvForestState.combinedPage = 0;
  _redrawAllMVForestPlots();
});
document.getElementById("mvForestView").addEventListener("change", e => {
  _mvForestState.viewMode     = e.target.value;
  _mvForestState.combinedPage = 0;
  _redrawAllMVForestPlots();
});
document.getElementById("mvShowPI").addEventListener("change", e => {
  _mvForestState.showPI = e.target.checked;
  _redrawAllMVForestPlots();
});
document.getElementById("addStudy").addEventListener("click", () => { addRow(); renderRoBDataGrid(); markStale(); });
document.getElementById("run").addEventListener("click", async () => { if (await runAnalysis()) showView("results"); });
document.getElementById("import").addEventListener("click", () => document.getElementById("csvFile").click());
document.getElementById("csvFile").addEventListener("change", async e => {
  if (!e.target.files[0]) return;
  try {
    await previewCSV(e.target.files[0]);
  } catch (err) {
    const warn = document.getElementById("csvWarning");
    warn.textContent = `Could not read file: ${err?.message ?? err}`;
    warn.style.display = "block";
    return;
  }
  if (_mvMode) {
    const pending = getPendingImport();
    document.getElementById("previewImport").textContent =
      pending?.mvCandidate ? "Import to MV Table" : "Import";
  }
});
document.getElementById("previewImport").addEventListener("click", () => {
  document.getElementById("previewImport").textContent = "Import";
  const pending = getPendingImport();
  if (pending?.mvCandidate && _mvMode) {
    _commitImportMV(pending.parsed, pending.mvHeaders);
    cancelImport();
    return;
  }
  const missingCols = commitImport();
  syncMHOptions(document.getElementById("effectType").value);
  if (missingCols.length > 0) {
    const warningDiv = document.getElementById("csvWarning");
    warningDiv.textContent = `Warning: CSV is missing required columns: ${missingCols.join(", ")}`;
    warningDiv.style.display = "block";
  }
});
document.getElementById("previewCancel").addEventListener("click", () => {
  document.getElementById("previewImport").textContent = "Import";
  cancelImport();
});
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
document.getElementById("addInteraction").addEventListener("click", addInteractionTerm);
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
  resetSel("selMode");    resetSel("selPreset"); resetSel("selSides"); resetSel("selWeightFn");
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
// ---------------- MV REPORT BUILDER ----------------
// Defined here (not in lazy-loaded report.js) so it is always available even
// when the browser's ES-module registry holds a cached pre-buildMVReport version
// of report.js (which can happen if report.js was imported earlier in the session).

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

function _mvReportCSS() {
  const isLight = document.documentElement.dataset.theme === "light";
  const v = isLight ? {
    bodyBg:"#f5f5f8", bodyColor:"#1a1a1a", metaColor:"#888",
    h2Color:"#555", h2Border:"#d0d0d0", sectionBg:"#fff", sectionBorder:"#ddd",
    thBg:"#e8e8f0", thColor:"#333", thBorder:"#ddd", tdBorder:"#e0e0e0",
    tdColor:"#222", tdAltBg:"#f5f5f8",
  } : {
    bodyBg:"#121212", bodyColor:"#eee", metaColor:"#666",
    h2Color:"#888", h2Border:"#2e2e2e", sectionBg:"#1a1a1a", sectionBorder:"#333",
    thBg:"#1e2840", thColor:"#aac", thBorder:"#333", tdBorder:"#2a2a2a",
    tdColor:"#ddd", tdAltBg:"#171727",
  };
  return `*, *::before, *::after { box-sizing: border-box; }
body { font-family: Arial, sans-serif; background: ${v.bodyBg}; color: ${v.bodyColor};
  margin: 0; padding: 24px 32px; font-size: 14px; }
h1 { font-size: 1.4em; margin: 0 0 4px 0; }
h2 { font-size: 0.78em; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase;
  color: ${v.h2Color}; margin: 0 0 12px 0; padding-bottom: 6px;
  border-bottom: 1px solid ${v.h2Border}; }
.report-meta { font-size: 0.82em; color: ${v.metaColor}; margin-bottom: 20px; }
section { background: ${v.sectionBg}; border: 1px solid ${v.sectionBorder};
  border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
.stat-table { border-collapse: collapse; font-size: 0.88em; width: 100%; max-width: 900px; }
.stat-table th { background: ${v.thBg}; color: ${v.thColor}; font-weight: normal;
  text-align: left; padding: 5px 10px; border: 1px solid ${v.thBorder}; }
.stat-table td { padding: 5px 10px; border: 1px solid ${v.tdBorder}; color: ${v.tdColor}; }
.stat-table tbody tr:nth-child(even) td { background: ${v.tdAltBg}; }
.svg-wrap { margin: 12px 0; overflow-x: auto; }
.svg-wrap svg { display: block; max-width: 100%; height: auto; }`;
}

function _buildMVReportHTML(res, rows = [], alpha = 0.05) {
  const { beta, se, ci, z, pval, betaNames = [], tau2, rho_between,
          outcomeIds, n, k, P, QM, df_QM, pQM, QE, df_QE, pQE,
          logLik, AIC, BIC, AICc, struct, method, I2, convergence,
          warnings: engineWarnings = [] } = res;
  const hasMods = beta.length > P;
  const ciPct = Math.round((1 - alpha) * 100);
  const date  = new Date().toLocaleDateString(undefined, { year:"numeric", month:"long", day:"numeric" });
  const esc   = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const fmtN  = (v, d = 3) => isFinite(v) ? (+v).toFixed(d) : "—";
  const fmtP  = p => !isFinite(p) ? "—" : p < 0.001 ? "< .001" : (+p).toFixed(3).replace(/^0\./, ".");
  const th    = cols => `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
  const tbl   = (cols, bodyRows) => `<table class="stat-table">${th(cols)}<tbody>${bodyRows.join("")}</tbody></table>`;

  // Pooled estimates
  const pooledRows = outcomeIds.map((id, o) => {
    const [lo, hi] = ci[o];
    return `<tr><td><strong>${esc(String(id))}</strong></td><td>${fmtN(beta[o],4)}</td><td>${fmtN(se[o],4)}</td>
      <td>[${fmtN(lo,4)}, ${fmtN(hi,4)}]</td><td>${fmtN(z[o],3)}</td><td>${fmtP(pval[o])}</td></tr>`;
  });
  const pooledTbl = tbl(["Outcome","Estimate","SE",`${ciPct}% CI`,"z","p"], pooledRows);

  // Moderators
  let modSection = "";
  if (hasMods) {
    const modRows = beta.slice(P).map((b, i) => {
      const j = P + i;
      const [lo, hi] = ci[j];
      return `<tr><td>${esc(betaNames[j] ?? `β${j}`)}</td><td>${fmtN(b,4)}</td><td>${fmtN(se[j],4)}</td>
        <td>[${fmtN(lo,4)}, ${fmtN(hi,4)}]</td><td>${fmtN(z[j],3)}</td><td>${fmtP(pval[j])}</td></tr>`;
    });
    modSection = `<h2>Moderator Effects</h2>${tbl(["Coefficient","Estimate","SE",`${ciPct}% CI`,"z","p"], modRows)}`;
  }

  // Heterogeneity
  const hetCols = struct === "CS"
    ? ["Outcome","τ²","<em>I</em>²","ρ (between)"]
    : ["Outcome","τ²","<em>I</em>²"];
  const hetRows = outcomeIds.map((id, o) => {
    const rho = struct === "CS" ? `<td>${fmtN(rho_between ?? 0, 4)}</td>` : "";
    return `<tr><td>${esc(String(id))}</td><td>${fmtN(tau2[o],5)}</td>
      <td>${isFinite(I2[o]) ? (+I2[o]).toFixed(1)+"%" : "—"}</td>${rho}</tr>`;
  });
  const hetTbl = tbl(hetCols, hetRows);

  // Tests
  const testRows = [
    ...(hasMods && isFinite(QM)
      ? [`<tr><td>Omnibus test of moderators (Q<sub>M</sub>)</td><td>${fmtN(QM,3)}</td><td>${df_QM}</td><td>${fmtP(pQM)}</td></tr>`]
      : []),
    `<tr><td>Residual heterogeneity (Q<sub>E</sub>)</td><td>${fmtN(QE,3)}</td><td>${df_QE}</td><td>${fmtP(pQE)}</td></tr>`,
  ];
  const testTbl = tbl(["Test","χ²","df","p"], testRows);

  const fitLine = `k = ${k} · n = ${n} obs · P = ${P} outcomes`
    + ` │ log-lik = ${fmtN(logLik,4)} · AIC = ${fmtN(AIC,2)} · BIC = ${fmtN(BIC,2)}`
    + (isFinite(AICc) ? ` · AICc = ${fmtN(AICc,2)}` : "")
    + ` │ ${esc(method)}, Ψ = ${esc(struct)}`;

  // MV forest SVGs
  const forestSVGs = (() => {
    const combined     = document.getElementById("mvForestPlotCombined");
    const combinedBlk  = document.getElementById("mvForestCombinedBlock");
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
    ...engineWarnings.map(w => `<p style="color:#c0392b">${esc(w)}</p>`),
  ].filter(Boolean).join("");

  const forestSection = forestSVGs.length
    ? `<h2>Forest Plot</h2>${forestSVGs.map(s=>`<div class="svg-wrap">${s}</div>`).join("\n")}`
    : "";

  // Individual Studies
  const zVal = normalQuantile(1 - alpha / 2);
  const studyBodyRows = rows.map(r => {
    const se_r = Math.sqrt(r.vi);
    return `<tr><td>${esc(String(r.study_id))}</td><td>${esc(String(r.outcome_id))}</td>
      <td>${fmtN(r.yi,4)}</td><td>${fmtN(r.vi,4)}</td><td>${fmtN(se_r,4)}</td>
      <td>[${fmtN(r.yi - zVal*se_r,4)},&nbsp;${fmtN(r.yi + zVal*se_r,4)}]</td></tr>`;
  });
  const studySection = rows.length
    ? `<h2>Individual Studies</h2>${tbl(["Study","Outcome","y<sub>i</sub>","v<sub>i</sub>","SE",`${ciPct}% CI`], studyBodyRows)}`
    : "";

  // Risk of Bias (only if domains configured)
  let robSection = "";
  if (_robDomains.length > 0) {
    const robTL  = _mvSerializeSVG(document.getElementById("robTrafficLight"));
    const robSum = _mvSerializeSVG(document.getElementById("robSummary"));
    const parts  = [robTL, robSum].filter(Boolean).map(s => `<div class="svg-wrap">${s}</div>`);
    if (parts.length) robSection = `<h2>Risk of Bias</h2>${parts.join("\n")}`;
  }

  // References
  const mvRefList = [
    `Berkey, C. S., Hoaglin, D. C., Antczak-Bouckoms, A., Mosteller, F., &amp; Colditz, G. A. (1998). Meta-analysis of multiple outcomes by regression with random effects. <em>Statistics in Medicine</em>, <em>17</em>(22), 2537–2550.`,
    `Cheung, M. W.-L. (2014). Modeling dependent effect sizes with three-level meta-analyses: a structural equation modeling approach. <em>Psychological Methods</em>, <em>19</em>(2), 211–229.`,
    `Cochran, W. G. (1954). The combination of estimates from different experiments. <em>Biometrics</em>, <em>10</em>(1), 101–129.`,
    `Higgins, J. P. T., Thompson, S. G., Deeks, J. J., &amp; Altman, D. G. (2003). Measuring inconsistency in meta-analyses. <em>BMJ</em>, <em>327</em>(7414), 557–560.`,
    `Jackson, D., Riley, R., &amp; White, I. R. (2011). Multivariate meta-analysis: Potential and promise. <em>Statistics in Medicine</em>, <em>30</em>(20), 2481–2498.`,
    `Riley, R. D., Abrams, K. R., Sutton, A. J., Lambert, P. C., &amp; Thompson, J. R. (2007). Bivariate random-effects meta-analysis and the estimation of between-study correlation. <em>BMC Medical Research Methodology</em>, <em>7</em>, 3.`,
    `Viechtbauer, W. (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. <em>Journal of Educational and Behavioral Statistics</em>, <em>30</em>(3), 261–293.`,
  ];
  const refSection = `<h2>References</h2><ol style="padding-left:1.4em;font-size:0.88em;line-height:1.6">${
    mvRefList.map(r => `<li style="margin-bottom:6px">${r}</li>`).join("")
  }</ol>`;

  const body = [
    warnHTML,
    `<h2>Pooled Estimates</h2>${pooledTbl}`,
    modSection,
    `<h2>Between-Study Heterogeneity</h2>${hetTbl}`,
    `<h2>Hypothesis Tests</h2>${testTbl}`,
    `<p class="report-meta" style="margin-top:8px">${fitLine}</p>`,
    forestSection,
    studySection,
    robSection,
    refSection,
  ].filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Multivariate Meta-Analysis Report</title>
  <style>${_mvReportCSS()}</style>
</head>
<body>
  <h1>Multivariate Meta-Analysis Report</h1>
  <p class="report-meta">Generated ${esc(date)}
    &nbsp;·&nbsp; k = ${k} studies, P = ${P} outcomes
    &nbsp;·&nbsp; ${esc(method)}, Ψ = ${esc(struct)}</p>
  <section>${body}</section>
</body>
</html>`;
}

// Thin wrappers matching report.js downloadHTML / openPrintPreview signatures
// so the MV path doesn't need to lazy-load report.js at all.
function _mvDownloadHTML(html) {
  downloadBlob(html, "mv-meta-analysis-report.html", "text/html;charset=utf-8");
}
function _mvOpenPrintPreview(html) {
  const win = window.open("", "_blank");
  if (!win) { _mvDownloadHTML(html); return; }
  win.document.open(); win.document.write(html); win.document.close();
  if (win.document.readyState === "complete") { win.print(); }
  else { win.addEventListener("load", () => win.print()); }
}

// ---------------- REPORT EXPORT BUTTONS ----------------
// buildReport internally re-renders every forest page into a hidden element
// then restores the live view.  After it returns we re-render the live forest
// at the currently-viewed page and re-sync the nav, because buildReport has no
// access to renderForestNav.
async function buildReportAndResync() {
  if (!appState.reportArgs) return null;
  flushDeferredDraws();

  // MV mode: build fully inline — no lazy-loaded module needed.
  // (report.js is cached in the ES-module registry; a stale cached version
  //  would not export buildMVReport, causing "not a function" errors.)
  if (appState.reportArgs.mv) {
    const html = _buildMVReportHTML(
      appState.reportArgs.mvRes,
      appState.reportArgs.mvRows ?? [],
      appState.reportArgs.mvAlpha ?? 0.05,
    );
    return { html, downloadHTML: _mvDownloadHTML, openPrintPreview: _mvOpenPrintPreview };
  }

  const { buildReport, downloadHTML, openPrintPreview } = await getReport();

  // Pass the live forestPlot.page so the restore inside collectPagedSVGs lands on
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
  flushDeferredDraws();
  const btn  = document.getElementById("exportReportDOCX");
  const done = flashBtn(btn, "Building\u2026", "Saved \u2713");
  try {
    const { buildDocx, buildMVDocx } = await getDocx();
    let blob;
    if (appState.reportArgs.mv) {
      blob = await buildMVDocx({
        res:   appState.reportArgs.mvRes,
        rows:  appState.reportArgs.mvRows ?? [],
        alpha: appState.reportArgs.mvAlpha ?? 0.05,
      });
    } else {
      const args = {
        ...appState.reportArgs,
        forestOptions:      { ...appState.reportArgs.forestOptions, currentPage: forestPlot.page },
        cumForestOptions:   appState.reportArgs.cumForestOptions
          ? { ...appState.reportArgs.cumForestOptions,   currentPage: cumForestPlot.page }
          : undefined,
        caterpillarOptions: appState.reportArgs.caterpillarOptions
          ? { ...appState.reportArgs.caterpillarOptions, currentPage: caterpillarPlot.page }
          : undefined,
        gosh:      goshState.result ?? appState.reportArgs.gosh,
        goshXAxis: document.getElementById("goshXAxis")?.value ?? appState.reportArgs.goshXAxis ?? "I2",
        apaFormat: true,
      };
      blob = await buildDocx(args);
    }
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
  const mode     = document.getElementById("selMode").value;
  const preset   = document.getElementById("selPreset").value;
  const weightFn = document.getElementById("selWeightFn").value;
  const presetRow   = document.getElementById("selPresetRow");
  const customRow   = document.getElementById("selCustomRow");
  const weightFnRow = document.getElementById("selWeightFnRow");

  const isSensitivity = mode === "sensitivity";
  const showStepCtrls = !isSensitivity && weightFn === "stepfun";

  weightFnRow.style.display = isSensitivity ? "none" : "";
  presetRow.style.display   = isSensitivity ? "" : "none";
  // Show sides/cuts for: sensitivity custom preset, or MLE step function
  const showCustom = (isSensitivity && preset === "custom") || showStepCtrls;
  customRow.style.display   = showCustom ? "" : "none";

  // When a named preset is selected, mirror its sides into the (hidden) selSides field
  if (isSensitivity && preset !== "custom") {
    const p = SELECTION_PRESETS[preset];
    if (p) document.getElementById("selSides").value = String(p.sides);
  }
}

document.getElementById("selMode").addEventListener("change", () => { syncSelControls(); markStale(); });
document.getElementById("selPreset").addEventListener("change", () => { syncSelControls(); markStale(); });
document.getElementById("selWeightFn").addEventListener("change", () => { syncSelControls(); markStale(); });
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

// ---------------- PERMUTATION TEST ----------------
document.getElementById("permRunBtn").addEventListener("click", _startPermTest);
document.getElementById("permCancelBtn").addEventListener("click", () => {
  if (permState.worker) { permState.worker.terminate(); permState.worker = null; }
  const elProgress = document.getElementById("permProgress");
  const elRun      = document.getElementById("permRunBtn");
  const elCancel   = document.getElementById("permCancelBtn");
  if (elProgress) elProgress.style.display = "none";
  if (elRun)    elRun.style.display = "";
  if (elCancel) elCancel.style.display = "none";
});

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
  const session = gatherSessionState(moderators, scaleModerators, interactions, { domains: _robDomains, data: _robData });
  if (_mvMode) session.mv = _gatherMVState();
  downloadBlob(serializeSession(session), "session.json", "application/json;charset=utf-8;");
}

// ---------------- SESSION APPLY ----------------
// Shared logic for applying a parsed session object to the UI.
// Used by both loadSession() (file load) and draft restore (on-load autosave).
// Returns { profile, savedStudies } so callers can inspect missing columns etc.

function applySession(session) {
  const { settings = {}, moderators: savedMods = [], scaleModerators: savedScaleMods = [], interactions: savedInteractions = [], studies: savedStudies = [], rob = {} } = session;

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
  if (s.selWeightFn) {
    const el = document.getElementById("selWeightFn");
    if (el && el.querySelector(`option[value="${s.selWeightFn}"]`)) el.value = s.selWeightFn;
  }
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

  // Rebuild interaction terms (after moderators are restored)
  clearInteractions();
  savedInteractions.forEach(ix => {
    if (ix.termA && ix.termB && ix.termA !== ix.termB) doAddInteraction(ix.termA, ix.termB);
  });
  refreshInteractionUI();

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

  // Restore MV mode
  const mv = session.mv;
  if (mv && typeof mv === "object") {
    _mvMode = true;
    _applyModeToggle();
    if (mv.struct && document.getElementById("mvStruct").querySelector(`option[value="${mv.struct}"]`))
      document.getElementById("mvStruct").value = mv.struct;
    if (mv.method && document.getElementById("mvMethod").querySelector(`option[value="${mv.method}"]`))
      document.getElementById("mvMethod").value = mv.method;
    if (isFinite(mv.rho)) document.getElementById("mvRho").value = mv.rho;
    _mvModerators.length = 0;
    if (Array.isArray(mv.moderators)) mv.moderators.forEach(n => { if (n) _mvModerators.push(n); });
    _renderMVModTags();
    _rebuildMVTableHeaders();
    document.getElementById("mvTableBody").innerHTML = "";
    if (Array.isArray(mv.rows)) {
      mv.rows.forEach(r => {
        const tr = _mvAddRow();
        if (r.study_id   !== undefined) tr.querySelector(".mv-study-id").value   = r.study_id;
        if (r.outcome_id !== undefined) tr.querySelector(".mv-outcome-id").value = r.outcome_id;
        if (r.yi         !== undefined) tr.querySelector(".mv-yi").value = r.yi;
        if (r.vi         !== undefined) tr.querySelector(".mv-vi").value = r.vi;
        _mvModerators.forEach((name, i) => {
          const inputs = tr.querySelectorAll(".mv-mod");
          if (inputs[i] && r[name] !== undefined) inputs[i].value = r[name];
        });
      });
    }
  } else {
    _mvMode = false;
    _applyModeToggle();
  }

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
  if (_mvMode) {
    const headers = ["study_id", "outcome_id", "yi", "vi", ..._mvModerators.map(n => n)];
    const rows    = [];
    document.querySelectorAll("#mvTableBody tr").forEach(r => {
      const studyId   = r.querySelector(".mv-study-id")?.value  ?? "";
      const outcomeId = r.querySelector(".mv-outcome-id")?.value ?? "";
      const yi        = r.querySelector(".mv-yi")?.value         ?? "";
      const vi        = r.querySelector(".mv-vi")?.value         ?? "";
      const mods      = [...r.querySelectorAll(".mv-mod")].map(x => x.value);
      const vals      = [studyId, outcomeId, yi, vi, ...mods];
      if (vals.some(v => v !== "")) rows.push(vals);
    });
    downloadBlob(serializeCSV(headers, rows), "mv_meta_data.csv", "text/csv;charset=utf-8;");
    return;
  }

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
    onModeratorChanged: () => { refreshInteractionUI(); renderInteractionTags(); },
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

  // Populate MV example data (Berkey 1998: 5 trials, 2 outcomes)
  if (USE_EXAMPLES) _populateMVExample(); else _mvAddRow();

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
  if (USE_EXAMPLES) {
    (getProfile(type)?.exampleData ?? []).forEach(row => addRow(row));
  } else {
    addRow();
  }
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
    if (isValidStudy(s)) {
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
// Permutation test state and runner
// -----------------------------------------------------------------------------
const permState = { worker: null };

function _clearPermResults() {
  const el = document.getElementById("permResults");
  if (el) el.innerHTML = "";
  const prog = document.getElementById("permProgress");
  if (prog) prog.style.display = "none";
  const cancelBtn = document.getElementById("permCancelBtn");
  if (cancelBtn) cancelBtn.style.display = "none";
  const runBtn = document.getElementById("permRunBtn");
  if (runBtn) runBtn.style.display = "";
  if (permState.worker) { permState.worker.terminate(); permState.worker = null; }
}

function _startPermTest() {
  if (!_lastReg || _lastReg.rankDeficient) return;
  const reg = _lastReg;

  const nPerm = parseInt(document.getElementById("permIter")?.value ?? "999", 10);
  const seed  = 12345;

  const elProgress = document.getElementById("permProgress");
  const elBar      = document.getElementById("permProgressBar");
  const elText     = document.getElementById("permProgressText");
  const elRun      = document.getElementById("permRunBtn");
  const elCancel   = document.getElementById("permCancelBtn");
  const elResults  = document.getElementById("permResults");

  if (elResults) elResults.innerHTML = "";
  if (elProgress) elProgress.style.display = "";
  if (elBar) { elBar.value = 0; elBar.max = 100; }
  if (elText) elText.textContent = "0%";
  if (elRun) elRun.style.display = "none";
  if (elCancel) elCancel.style.display = "";

  // Flatten design matrix to Float64Array for worker transfer
  const k = reg.yi.length;
  const p = reg.p;
  const XTA = new Float64Array(k * p);
  for (let i = 0; i < k; i++) for (let j = 0; j < p; j++) XTA[i * p + j] = reg.Xf[i][j];

  // Per-moderator colIdxs
  const modTests = Array.isArray(reg.modTests) ? reg.modTests : [];
  const modColLens  = new Int32Array(modTests.map(mt => (mt.colIdxs ?? []).length));
  const totalIdxs   = modColLens.reduce((s, v) => s + v, 0);
  const modColIdxsTA = new Int32Array(totalIdxs);
  let off = 0;
  for (const mt of modTests) {
    for (const idx of (mt.colIdxs ?? [])) modColIdxsTA[off++] = idx;
  }

  const onProgress = (done, total) => {
    const pct = Math.round(done / total * 100);
    if (elBar)  elBar.value = pct;
    if (elText) elText.textContent = `${pct}%`;
  };

  const onDone = (result) => {
    permState.worker = null;
    if (elProgress) elProgress.style.display = "none";
    if (elRun)    elRun.style.display = "";
    if (elCancel) elCancel.style.display = "none";
    renderPermResults(result, reg);
  };

  const onError = (msg) => {
    permState.worker = null;
    if (elProgress) elProgress.style.display = "none";
    if (elRun)    elRun.style.display = "";
    if (elCancel) elCancel.style.display = "none";
    if (elResults) elResults.innerHTML = `<div class="reg-note reg-warn">⚠ Permutation error: ${escapeHTML(msg)}</div>`;
  };

  // Try Worker first
  const yiTA = new Float64Array(reg.yi);
  const viTA = new Float64Array(reg.vi);

  let workerOk = false;
  try {
    const workerUrl = new URL("./perm.worker.js", import.meta.url).href;
    const w = new Worker(workerUrl);
    permState.worker = w;
    workerOk = true;

    w.onmessage = function (e) {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress(msg.done, msg.total);
      } else if (msg.type === "done") {
        permState.worker = null;
        onDone(msg);
      } else if (msg.type === "error") {
        permState.worker = null;
        onError(msg.message);
      }
    };
    w.onerror = function (e) {
      permState.worker = null;
      if (e.lineno > 0) {
        onError(e.message || "Worker crashed");
        return;
      }
      // file:// load failure — synchronous fallback
      const result = permTestSync({ yi: reg.yi, vi: reg.vi, Xf: reg.Xf,
        QM_obs: reg.QM, nPerm, seed, method: reg.method || 'REML', modTests });
      if (result.error) { onError(result.error); return; }
      onDone(result);
    };
    w.postMessage(
      { yi: yiTA, vi: viTA, X: XTA, QM_obs: reg.QM, nPerm, seed, p, k,
        method: reg.method || 'REML',
        nMods: modTests.length, modColIdxs: modColIdxsTA, modColLens },
      [yiTA.buffer, viTA.buffer, XTA.buffer]
    );
  } catch (_) {
    workerOk = false;
  }

  if (!workerOk) {
    const result = permTestSync({ yi: reg.yi, vi: reg.vi, Xf: reg.Xf,
      QM_obs: reg.QM, nPerm, seed, method: reg.method || 'REML', modTests });
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
  const { alpha, selModeVal, selPreset, selWeightFn, selSides, selCuts } = opts;

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
    if (selModeVal === "sensitivity") {
      let selCutsEff, selSidesEff, selOmegaFixed;
      if (selPreset !== "custom") {
        const p    = SELECTION_PRESETS[selPreset];
        selCutsEff    = p.cuts;
        selSidesEff   = p.sides;
        selOmegaFixed = p.omega;
      } else {
        selCutsEff    = selCuts;
        selSidesEff   = selSides;
        selOmegaFixed = null;
      }
      selResult = veveaHedges(studies, selCutsEff, selSidesEff, selOmegaFixed);
    } else if (selWeightFn === "halfnorm") {
      selResult = halfNormalSelModel(studies, { sides: selSides });
    } else if (selWeightFn === "power") {
      selResult = powerSelModel(studies, { sides: selSides });
    } else if (selWeightFn === "negexp") {
      selResult = negexpSelModel(studies, { sides: selSides });
    } else if (selWeightFn === "beta") {
      selResult = betaSelModel(studies, { sides: selSides });
    } else {
      // Default MLE: Vevea-Hedges step function
      selResult = veveaHedges(studies, selCuts, selSides, null);
    }
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
  const { method, ciMethod, alpha, modSpec, scaleModSpec, interactionSpec } = opts;

  const subgroup = subgroupAnalysis(studies, method, ciMethod, alpha);
  let reg = null, ls = null;
  if (scaleModSpec.length > 0) {
    ls = lsModel(studies, modSpec, scaleModSpec, { ciMethod, alpha, locInteractions: interactionSpec });
  } else if (modSpec.length > 0 || interactionSpec.length > 0) {
    reg = metaRegression(studies, modSpec, method, ciMethod, alpha, interactionSpec);
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
          useTFAdjusted, bayesMu0, bayesSigmaMu, bayesSigmaTau, selModeVal, selWeightFn } = opts;

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
              CI [${fmt(rveLo)}, ${fmt(rveHi)}] | SE = ${fmt(rveResult.se)} | <em>t</em>(${rveResult.df}) = ${fmt(rveResult.t)} | <em>p</em> ${fmtPval(rveResult.p)}<br>
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
              ${Math.round((1 - alpha) * 100)}% CI [${fmt(ciLoDisp)}, ${fmt(ciHiDisp)}] | SE = ${fmt(tl.se)} | <em>z</em> = ${fmt(tl.z)} | <em>p</em> ${fmtPval(tl.p)}<br>
              m=${tl.kCluster} cluster${tl.kCluster === 1 ? "" : "s"} &nbsp;·&nbsp; k=${tl.k} studies &nbsp;·&nbsp; df=${tl.df}<br>
              ${hBtn("threelevel.tau2")}σ²<sub>within</sub>=${fmt(tl.tau2_within)} &nbsp;·&nbsp; σ²<sub>between</sub>=${fmt(tl.tau2_between)}<br>
              ${hBtn("threelevel.I2")}<em>I</em>²<sub>within</sub>=${fmt(tl.I2_within)}% &nbsp;·&nbsp; <em>I</em>²<sub>between</sub>=${fmt(tl.I2_between)}%<br>
              ${hBtn("het.Q")}<em>Q</em>(${tl.df}) = ${fmt(tl.Q)} | method=REML
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
    ? `Robust CI [${fmt(robust_ci_disp.lb)}, ${fmt(robust_ci_disp.ub)}] | SE = ${fmt(m.robustSE)} | <em>z</em> = ${fmt(m.robustStat)} | <em>p</em> ${fmtPval(m.robustPval)} (df = ${m.robustDf})${hBtn("cluster.robust")}<br>`
    : "";

  const SMD_TYPES = new Set(["SMD","SMDH","SMD_paired","SMD1","SMD1H","SMCC"]);
  const cles = SMD_TYPES.has(type) ? clES(m.RE, [m.ciLow, m.ciHigh]) : null;
  const clesLine = cles
    ? `CLES: ${fmt(cles.estimate)} [${fmt(cles.ci[0])}, ${fmt(cles.ci[1])}]${hBtn("pool.cles")}<br>`
    : "";

  const ciLbl = getCiLabel();
  const showLogScale = !!profile.isLog;
  const logScaleRELine = showLogScale
    ? `<div class="result-log-note">log scale: ${fmt(m.RE)} | SE = ${fmt(m.seRE)} | ${ciLbl} [${fmt(m.ciLow)}, ${fmt(m.ciHigh)}]</div>`
    : "";
  const logScaleFELine = showLogScale
    ? `<div class="result-log-note">log scale: ${fmt(m.FE)} | SE = ${fmt(m.seFE)} | ${ciLbl} [${fmt(m.FE - feZ * m.seFE)}, ${fmt(m.FE + feZ * m.seFE)}]</div>`
    : "";
  const analysisScaleLabel = profile.analysisScaleLabel ?? null;
  const analysisScaleRELine = analysisScaleLabel
    ? `<div class="result-log-note">${analysisScaleLabel}: ${fmt(m.RE)} | SE = ${fmt(m.seRE)} | ${ciLbl} [${fmt(m.ciLow)}, ${fmt(m.ciHigh)}]</div>`
    : "";
  const analysisScaleFELine = analysisScaleLabel
    ? `<div class="result-log-note">${analysisScaleLabel}: ${fmt(m.FE)} | SE = ${fmt(m.seFE)} | ${ciLbl} [${fmt(m.FE - feZ * m.seFE)}, ${fmt(m.FE + feZ * m.seFE)}]</div>`
    : "";
  elResults.innerHTML = warningHTML + clusterBanner + (isMHorPeto ? `
    <div class="result-re-primary">
      <span class="result-label">${profile.label} (${methodLabel})</span>
      <span class="result-re-value">${fmt(FE_disp)}</span>
      <span class="result-se">SE = ${fmt(m.seFE)}</span>
      <span class="result-ci">${ciLbl} [${fmt(feCi_disp.lb)}, ${fmt(feCi_disp.ub)}]</span>
    </div>
    ${logScaleFELine}${analysisScaleFELine}
    <div class="result-stat-row">
      <span class="result-row-label">Test of pooled effect</span>
      <span class="result-stat-value">${m.dist === "t" ? `<em>t</em>(${m.df})` : "<em>z</em>"} = ${fmt(m.stat)}, <em>p</em> ${fmtPval(m.pval)}</span>
    </div>
    <div class="result-method-note">Fixed-effect only — no τ², RE estimate, or prediction interval.</div>
    <div class="result-het-group">
      <div class="result-section-label">Heterogeneity</div>
      <div class="result-het-stats"><em>I</em>²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%]${hBtn("het.I2")} &nbsp;·&nbsp; <em>H</em>²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]${hBtn("het.H2")}</div>
      <div class="result-het-stats result-het-test"><em>Q</em>(${m.df}) = ${fmt(m.Q)}, <em>p</em> ${fmtPval(m.df > 0 ? 1 - chiSquareCDF(m.Q, m.df) : NaN)}${hBtn("het.Q")}</div>
    </div>
  ` : `
    <div class="result-re-primary">
      <span class="result-label">${profile.label} (RE)</span>
      <span class="result-re-value">${fmt(RE_disp)}</span>
      <span class="result-se">SE = ${fmt(m.seRE)}</span>
      <span class="result-ci">${ciLbl} [${fmt(ci_disp.lb)}, ${fmt(ci_disp.ub)}]</span>
    </div>
    ${logScaleRELine}${analysisScaleRELine}
    ${useTF && mAdjusted ? `<div class="result-re-adjusted">RE (adjusted): <b>${fmt(RE_adj_disp)}</b>${hasClusters ? ` <span class="result-note">(cluster-robust not applied to imputed studies)</span>` : ""}</div>` : ""}
    <div class="result-stat-row">
      <span class="result-row-label">Test of pooled effect</span>
      <span class="result-stat-value">${m.dist === "t" ? `<em>t</em>(${m.df})` : "<em>z</em>"} = ${fmt(m.stat)}, <em>p</em> ${fmtPval(m.pval)}</span>
    </div>
    <div class="result-stat-row">
      <span class="result-row-label">Prediction interval</span>
      <span class="result-stat-value">${isFinite(pred_disp.lb) ? `[${fmt(pred_disp.lb)}, ${fmt(pred_disp.ub)}]` : "NA (k &lt; 3)"}${hBtn("het.pred")}</span>
    </div>
    ${showLogScale && isFinite(m.predLow) ? `<div class="result-log-note">log scale: [${fmt(m.predLow)}, ${fmt(m.predHigh)}]</div>` : ""}
    ${analysisScaleLabel && isFinite(m.predLow) ? `<div class="result-log-note">${analysisScaleLabel}: [${fmt(m.predLow)}, ${fmt(m.predHigh)}]</div>` : ""}
    <div class="result-fe-secondary">
      <span class="result-label">${profile.label} (FE)</span>
      <span>${fmt(FE_disp)}</span>
      <span class="result-se">SE = ${fmt(m.seFE)}</span>
      <span class="result-ci">${ciLbl} [${fmt(feCi_disp.lb)}, ${fmt(feCi_disp.ub)}]</span>
    </div>
    ${logScaleFELine}${analysisScaleFELine}
    ${robustCILine}${clesLine}<div class="result-het-group">
      <div class="result-section-label">Heterogeneity</div>
      <div class="result-het-stats">τ²=${fmt(m.tau2)} [${fmt(m.tauCI[0])}, ${isFinite(m.tauCI[1])?fmt(m.tauCI[1]):"∞"}]${hBtn("het.tau2")} &nbsp;·&nbsp; <em>I</em>²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%]${hBtn("het.I2")} &nbsp;·&nbsp; <em>H</em>²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]${hBtn("het.H2")}</div>
      <div class="result-het-stats result-het-test"><em>Q</em>(${m.df}) = ${fmt(m.Q)}, <em>p</em> ${fmtPval(m.df > 0 ? 1 - chiSquareCDF(m.Q, m.df) : NaN)}${hBtn("het.Q")}</div>
    </div>
  `);

  // ── Publication bias panel ─────────────────────────────────────────────────
  const eggerRobustNote  = egger.clustersUsed  ? ` | <em>p</em><sub>robust</sub> ${isFinite(egger.robustInterceptP)  ? fmtPval(egger.robustInterceptP)  : "= —"}` : "";
  const fatpetRobustNote = fatpet.clustersUsed ? ` | <em>p</em><sub>FAT,rob</sub> ${isFinite(fatpet.robustSlopeP) ? fmtPval(fatpet.robustSlopeP) : "= —"} · <em>p</em><sub>PET,rob</sub> ${isFinite(fatpet.robustInterceptP) ? fmtPval(fatpet.robustInterceptP) : "= —"}` : "";

  const ciPct    = `${Math.round((1 - alpha) * 100)}% CI`;
  const eggerTC  = isFinite(egger.df)  ? tCritical(egger.df,  alpha) : NaN;
  const fatpetTC = isFinite(fatpet.df) ? tCritical(fatpet.df, alpha) : NaN;

  // Egger: intercept, SE, CI, t(df), p
  const eggerStats = isFinite(egger.intercept)
    ? `intercept = ${fmt(egger.intercept)}, SE = ${fmt(egger.se)}, ${ciPct} [${fmt(egger.intercept - eggerTC * egger.se)}, ${fmt(egger.intercept + eggerTC * egger.se)}], <em>t</em>(${egger.df}) = ${fmt(egger.t)}, <em>p</em> ${fmtPval(egger.p)}`
    : `intercept (k&lt;3)`;

  // Begg: τ, z, p
  const beggStats = isFinite(begg.tau)
    ? `τ = ${fmt(begg.tau)}, <em>z</em> = ${fmt(begg.z)}, <em>p</em> ${fmtPval(begg.p)}`
    : `τ (k&lt;3)`;

  // FAT slope: β₁, SE, t(df), p  (bias indicator — no CI)
  const fatStats = isFinite(fatpet.slope)
    ? `β₁ = ${fmt(fatpet.slope)}, SE = ${fmt(fatpet.slopeSE)}, <em>t</em>(${fatpet.df}) = ${fmt(fatpet.slopeT)}, <em>p</em> ${fmtPval(fatpet.slopeP)}`
    : `β₁ (k&lt;3)`;

  // PET intercept: estimate (display scale), SE, CI, t(df), p
  const petStats = (() => {
    if (!isFinite(fatpet.intercept)) return `(k&lt;3)`;
    if (!isFinite(fatpetTC)) return `${fmt(profile.transform(fatpet.intercept))}, <em>p</em> ${fmtPval(fatpet.interceptP)}`;
    const lo = fmt(profile.transform(fatpet.intercept - fatpetTC * fatpet.interceptSE));
    const hi = fmt(profile.transform(fatpet.intercept + fatpetTC * fatpet.interceptSE));
    return `${fmt(profile.transform(fatpet.intercept))}, SE = ${fmt(fatpet.interceptSE)}, ${ciPct} [${lo}, ${hi}], <em>t</em>(${fatpet.df}) = ${fmt(fatpet.interceptT)}, <em>p</em> ${fmtPval(fatpet.interceptP)}`;
  })();

  // PET-PEESE: active source (PET or PEESE), estimate (display scale), SE, CI, t(df), p
  const ppSrc   = petpeese.usePeese ? petpeese.peese : petpeese.fat;
  const ppTC    = isFinite(ppSrc.df) ? tCritical(ppSrc.df, alpha) : NaN;
  const ppLabel = petpeese.usePeese ? "PEESE" : "PET";
  const ppStats = (() => {
    if (!isFinite(ppSrc.intercept)) return `NA (k&lt;3)`;
    if (!isFinite(ppTC)) return `${fmt(profile.transform(ppSrc.intercept))}, <em>p</em> ${fmtPval(ppSrc.interceptP)} [${ppLabel}]`;
    const lo = fmt(profile.transform(ppSrc.intercept - ppTC * ppSrc.interceptSE));
    const hi = fmt(profile.transform(ppSrc.intercept + ppTC * ppSrc.interceptSE));
    return `${fmt(profile.transform(ppSrc.intercept))}, SE = ${fmt(ppSrc.interceptSE)}, ${ciPct} [${lo}, ${hi}], <em>t</em>(${ppSrc.df}) = ${fmt(ppSrc.interceptT)}, <em>p</em> ${fmtPval(ppSrc.interceptP)} [${ppLabel}]`;
  })();

  // WAAP-WLS: estimate (display scale), SE, CI, z, p, k_adequate
  const waapZ     = normalQuantile(1 - alpha / 2);
  const waapStats = (() => {
    if (!isFinite(waap.estimate)) return `NA (k&lt;1)`;
    const lo = fmt(profile.transform(waap.estimate - waapZ * waap.se));
    const hi = fmt(profile.transform(waap.estimate + waapZ * waap.se));
    const fb = waap.fallback ? ` <span style='color:var(--fg-muted)'>(fallback to WLS)</span>` : "";
    return `${fmt(profile.transform(waap.estimate))}, SE = ${fmt(waap.se)}, ${ciPct} [${lo}, ${hi}], <em>z</em> = ${fmt(waap.z)}, <em>p</em> ${fmtPval(waap.p)} | k<sub>adequate</sub> = ${waap.kAdequate}/${waap.k}${fb}`;
  })();

  // Henmi-Copas: estimate (display scale), SE, 95% CI (HC-computed, always 95%), DL τ²
  const hcStats = hc.error
    ? `NA (${escapeHTML(hc.error)})`
    : `${fmt(profile.transform(hc.beta))}, SE = ${fmt(hc.se)}, 95% CI [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}] (DL τ² = ${fmt(hc.tau2)})`;

  elPubBiasStats.innerHTML = `
    &nbsp;&nbsp;${hBtn("bias.egger")}Egger: ${eggerStats}${eggerRobustNote}<br>
    &nbsp;&nbsp;${hBtn("bias.begg")}Begg: ${beggStats}<br>
    &nbsp;&nbsp;${hBtn("bias.fatpet")}FAT (bias): ${fatStats} &nbsp;·&nbsp; PET (effect at SE→0): ${petStats}${fatpetRobustNote}<br>
    &nbsp;&nbsp;${hBtn("bias.petpeese")}${petpeese.usePeese?"<b>":""}PET-PEESE (corrected): ${ppStats}${petpeese.usePeese?"</b>":""}<br>
    &nbsp;&nbsp;${hBtn("bias.fsn")}Fail-safe N (Rosenthal): ${isFinite(fsn.rosenthal)?Math.round(fsn.rosenthal):"NA"} &nbsp;·&nbsp; Orwin (trivial=0.1): ${isFinite(fsn.orwin)?Math.round(fsn.orwin):"NA"}<br>
    &nbsp;&nbsp;${hBtn("bias.tes")}TES: O = ${isFinite(tes.O)?tes.O:"NA"} | E = ${isFinite(tes.E)?fmt(tes.E):"NA"} | χ²(k−1) = ${isFinite(tes.chi2)?fmt(tes.chi2):"NA (k<2)"} | ${isFinite(tes.p)?`<em>p</em> ${fmtPval(tes.p)}`:"<em>p</em> (k<2)"}${isFinite(tes.p)&&tes.p<0.1?" <span style='color:var(--color-warning)'>⚠ excess</span>":""}<br>
    &nbsp;&nbsp;${hBtn("bias.waap")}WAAP-WLS: ${waapStats}<br>
    &nbsp;&nbsp;${hBtn("bias.hc")}Henmi-Copas: ${hcStats}<br>
    <b>Trim &amp; Fill:</b>${hBtn("bias.trimfill")} ${useTF?"ON":"OFF"} (${useTF?tfEstimator+" estimator, ":""}${tf.length} filled studies)
    <details style="margin-top:4px">
      <summary style="cursor:pointer;color:var(--fg-muted);font-size:0.9em">Additional regression tests (binary outcomes)</summary>
      <div style="margin-top:4px">
        &nbsp;&nbsp;${hBtn("bias.harbord")}Harbord: intercept = ${isFinite(harbord.intercept)?fmt(harbord.intercept):"NA"} | <em>p</em> ${isFinite(harbord.interceptP)?fmtPval(harbord.interceptP):"NA (k&lt;3 or no 2×2 counts)"}<br>
        &nbsp;&nbsp;${hBtn("bias.peters")}Peters: intercept = ${isFinite(peters.intercept)?fmt(peters.intercept):"NA"} | <em>p</em> ${isFinite(peters.interceptP)?fmtPval(peters.interceptP):"NA (k&lt;3 or no sample sizes)"}<br>
        &nbsp;&nbsp;${hBtn("bias.deeks")}Deeks: intercept = ${isFinite(deeks.intercept)?fmt(deeks.intercept):"NA"} | <em>p</em> ${isFinite(deeks.interceptP)?fmtPval(deeks.interceptP):"NA (k&lt;3 or no 2×2 counts)"}<br>
        &nbsp;&nbsp;${hBtn("bias.ruecker")}Rücker: intercept = ${isFinite(ruecker.intercept)?fmt(ruecker.intercept):"NA"} | <em>p</em> ${isFinite(ruecker.interceptP)?fmtPval(ruecker.interceptP):"NA (k&lt;3 or no 2×2 counts)"}
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
  renderSelectionModelPanel(selResult, selModeVal, selWeightFn, profile);

  // ── Regression panel + bubble plots ───────────────────────────────────────
  const modSpec      = opts.modSpec;
  const scaleModSpec = opts.scaleModSpec;
  const kExcluded    = (reg ?? ls) ? studies.length - (reg ?? ls).k : 0;
  if (ls) {
    _lastReg = null;
    renderLocationScalePanel(ls, ciMethod, kExcluded);
  } else {
    _lastReg = (reg && !reg.rankDeficient) ? reg : null;
    // Pass moderators + interaction pseudo-entries so the panel sees the full term count.
    const _allTermMods = [...moderators, ...interactions.map(ix => ({ name: ix.name }))];
    renderRegressionPanel(reg ?? {}, method, ciMethod, kExcluded, _allTermMods);

    // Show permutation controls when a valid regression result exists
    const elPermSection = document.getElementById("permSection");
    if (elPermSection) {
      elPermSection.style.display = _lastReg ? "" : "none";
      _clearPermResults();
    }
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

    // Multivariate mode — separate pipeline
    if (_mvMode) {
      const ok = _runMVAnalysis();
      performance.measure("runAnalysis", "runAnalysis:start");
      return ok;
    }

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
    document.querySelectorAll(".results-section").forEach(d => { d.removeAttribute("open"); d.style.display = ""; });
    // Restore standard forest area (may have been hidden by a prior MV run)
    const _sf = document.getElementById("forestSection");
    const _mf = document.getElementById("mvForestSection");
    if (_sf) _sf.style.display = "";
    if (_mf) _mf.style.display = "none";
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
    const interactionSpec = interactions.map(ix => ({ name: ix.name, termA: ix.termA, termB: ix.termB }));
    const cumulativeOrder = document.getElementById("cumulativeOrder")?.value || "input";

    // Selection model settings (read up front so _runPubBiasBatch is pure)
    const selModeVal  = document.getElementById("selMode").value;
    const selPreset   = document.getElementById("selPreset").value;
    const selWeightFn = document.getElementById("selWeightFn").value;
    const selSides    = parseInt(document.getElementById("selSides").value, 10);
    const rawSelCuts  = document.getElementById("selCuts").value
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
      isMHorPeto, hasClusters, rveRho, modSpec, scaleModSpec, interactionSpec, cumulativeOrder,
      selModeVal, selPreset, selWeightFn, selSides, selCuts,
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