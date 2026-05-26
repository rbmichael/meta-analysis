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
//                     ui-table.js, ui-render.js, ui-state.js,
//                     ui-mv.js, ui-nav.js
//   ui-mv.js        → multivariate.js, utils.js, format.js, utils-html.js,
//                     plotThemes.js, export.js, io.js, ui-table.js
//   ui-nav.js       (no imports — pure DOM factory)
//   ui-table.js     → profiles.js, ui-state.js, utils-html.js, csv.js, io.js
//   ui-render.js    → analysis.js, plots.js, constants.js, utils-html.js, help-labels.js
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
//   help-labels.js  (no imports — string lookup table)
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
//   localStorage["meta-draft"]     autosave.js  — survives tab/browser close
//   localStorage["theme"]          ui.js        — light/dark preference
//   localStorage["fosma-plot-theme"] ui.js       — plot theme preset (default/cochrane/jama/bw)
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
import { normalQuantile, normalCDF, chiSquareCDF, tCritical } from "./utils.js";
import { fmt, fmtP_APA as fmtPval } from "./format.js";
import { escapeHTML } from "./utils-html.js";
import { effectProfiles, getProfile } from "./profiles.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel, drawBubble, drawPartialResidualBubble, drawInfluencePlot, drawCumulativeForest, drawCumulativeFunnel, drawOrchardPlot, drawCaterpillarPlot, drawBlupPlot, drawBaujatPlot, drawLabbe, drawRoBTrafficLight, drawRoBSummary, drawGoshPlot, drawProfileLikTau2, drawBayesTauPosterior, drawBayesMuPosterior, drawQQPlot, drawRadialPlot, drawPCurve, drawPUniform, setTooltipElement } from "./plots.js";
import { goshCompute, GOSH_MAX_K } from "./gosh.js";
import { permTestSync, permPval } from "./perm.js";
import { makeNavRenderer } from "./ui-nav.js";
import {
  mvState, mvModerators, mvForestState,
  initMV, gatherMVState, runMVAnalysis,
  populateMVExample, commitImportMV, redrawAllMVForestPlots,
  renderMVModTags, rebuildMVTableHeaders, addMVRow,
  buildMVReportHTML, mvDownloadHTML, mvOpenPrintPreview, clearMV,
} from "./ui-mv.js";
import { exportSVG, exportPNG, exportTIFF } from "./export.js";
import { PLOT_THEMES } from "./plotThemes.js";
import { HELP_LABELS } from "./help-labels.js";
// report.js (81 KB) and docx.js (51 KB) are loaded on first export click.
// guide.js (166 KB) and help.js (76 KB) are loaded on first use so they don't
// block startup.
// Each getter caches the resolved promise. On rejection the cache is cleared so
// the next call retries the import rather than re-throwing the stale failure.
// The ?cb= suffix is a per-session cache-buster: ES module registries key by
// exact URL, so appending a timestamp forces a fresh fetch on every page load
// without re-fetching within the same session. Python's http.server strips
// query strings before translating paths, so static serving is unaffected.
const _cb = `?cb=${Date.now()}`;
let _reportMod, _docxMod, _helpMod, _guideMod, _onboardingMod;
function getReport()     { return (_reportMod     ??= import(`./report.js${_cb}`    ).catch(e => { _reportMod     = null; throw e; })); }
function getDocx()       { return (_docxMod       ??= import(`./docx.js${_cb}`      ).catch(e => { _docxMod       = null; throw e; })); }
function getHelp()       { return (_helpMod       ??= import(`./help.js${_cb}`      ).catch(e => { _helpMod       = null; throw e; })); }
function getGuide()      { return (_guideMod      ??= import(`./guide.js${_cb}`     ).catch(e => { _guideMod      = null; throw e; })); }
function getOnboarding() { return (_onboardingMod ??= import(`./onboarding.js${_cb}`).catch(e => { _onboardingMod = null; throw e; })); }
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
         formatContrastResult, renderPermResults, buildTag }
  from "./ui-render.js";
import { validateRow, gatherSessionState } from "./ui-state.js";
import { initTable, moderators, doAddModerator, removeModerator, clearModerators,
         interactions, doAddInteraction, removeInteraction, clearInteractions,
         updateTableHeaders, addRow, commitPendingDelete, removeRow, clearRow,
         updateValidationWarnings, collectStudies, ensureModColumn,
         refreshPreviewUI, previewCSV, commitImport, cancelImport, getPendingImport }
  from "./ui-table.js";

const USE_EXAMPLES = new URLSearchParams(window.location.search).has("tests");

// ---------------- AUTOSAVE ----------------

let _saveTimer = null;


// scheduleSave()
// Debounced autosave trigger. Resets the 1.2 s idle timer on every call; the
// actual save fires once the user pauses for 1.2 s. Does NOT call runAnalysis()
// — analysis is triggered separately by the callers.
// Build a complete session object for autosave, including MV state when active.
// MV data is preserved even in Standard mode (active:false) so switching back
// and forth between modes doesn't silently drop rows.
function _buildAutosaveSession() {
  const session = gatherSessionState(moderators, scaleModerators, interactions, { domains: robPlotState.domains, data: robPlotState.data });
  const mvData = gatherMVState();
  const mvHasData = mvData.rows.some(r => r.study_id || r.outcome_id || r.yi || r.vi);
  if (mvState.active || mvHasData) session.mv = { ...mvData, active: mvState.active };
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
  if (e.key === "Escape") { hideHelp(); return; }
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

// ---------------- FADE SHOW/HIDE UTILITY ----------------
// Fades el in or out using a CSS opacity transition (defined in layout.css).
// Cancels any in-progress hide timer so rapid toggling is safe.
function setVisible(el, show) {
  if (!el) return;
  el._hideTimer && clearTimeout(el._hideTimer);
  delete el._hideTimer;
  const isHidden = el.style.display === "none";
  // Skip animation during initial page setup (document not yet fully loaded).
  if (document.readyState !== "complete") {
    el.style.display = show ? "" : "none";
    return;
  }
  if (show) {
    if (!isHidden) return;
    el.style.opacity = "0";
    el.style.display = "";
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = ""; }));
  } else {
    if (isHidden) return;
    el.style.opacity = "0";
    el._hideTimer = setTimeout(() => {
      el.style.display = "none";
      el.style.opacity = "";
      delete el._hideTimer;
    }, 140);
  }
}

// ---------------- CUSTOMIZED BADGE ----------------
function _checkAdvancedBadge() {
  const selDiffers = id => {
    const el = document.getElementById(id); if (!el) return false;
    const def = [...el.options].findIndex(o => o.defaultSelected);
    return el.selectedIndex !== (def >= 0 ? def : 0);
  };
  const chkDiffers = id => { const el = document.getElementById(id); return el && el.checked !== el.defaultChecked; };
  const valDiffers = id => { const el = document.getElementById(id); return el && el.value !== el.defaultValue; };

  const custom =
    selDiffers("ciLevel") || selDiffers("mccMethod") ||
    selDiffers("tfEstimator") || chkDiffers("useTrimFill") || chkDiffers("useTFAdjusted") ||
    selDiffers("selMode") || selDiffers("selPreset") || selDiffers("selSides") || selDiffers("selWeightFn") ||
    valDiffers("bayesMu0") || valDiffers("bayesSigmaMu") || valDiffers("bayesSigmaTau") ||
    valDiffers("selCuts") || valDiffers("rveRho") || selDiffers("rveWeighting") || selDiffers("threeLevelMethod") ||
    valDiffers("fsnTrivial") || selDiffers("fsnDirection");

  const badge = document.getElementById("advancedBadge");
  if (badge) badge.style.display = custom ? "" : "none";
  document.getElementById("advancedSettings")?.classList.toggle("settings-modified", custom);
}

// ---------------- MODERATOR STATE ----------------
// moderators[] is owned by ui-table.js (imported above) — a live array mutated
// in place by doAddModerator / removeModerator / clearModerators.
let scaleModerators = []; // { name: string, type: "continuous"|"categorical", transform: string }


// doAddModerator / clearModerators / removeModerator / makeModTh / makeModTd
// all live in ui-table.js (imported above).

function _readModSpec(selectId) {
  const val = document.getElementById(selectId).value;
  return val === "categorical"
    ? { type: "categorical", transform: "linear" }
    : { type: "continuous", transform: val || "linear" };
}

function addModerator() {
  const nameEl = document.getElementById("modName");
  const name = nameEl.value.trim();
  const { type, transform } = _readModSpec("modType");
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
  setVisible(mgr, names.length >= 2);

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
    const span = buildTag(`${termA} × ${termB}`, () => {
      removeInteraction(name);
      renderInteractionTags();
      markStale();
    }, "Remove interaction");
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
    const span = buildTag(name, () => removeScaleModerator(name), "Remove scale moderator");
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
  const { type, transform } = _readModSpec("scaleModType");
  if (!name) return;
  doAddScaleModerator(name, type, transform);
  ensureModColumn(name, type);
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
  robPlotState.domains.forEach(name => {
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
  const btn       = document.getElementById("robGridBtn");
  container.innerHTML = "";

  const hide = () => {
    btn.style.display = "none";
    if (!container.hidden) _closeAllPopovers();
  };

  if (robPlotState.domains.length === 0) { hide(); return; }

  // Collect current (non-empty) study labels from the input table.
  const labels = [];
  document.querySelectorAll("#inputTable tr").forEach((row, i) => {
    if (i === 0) return;
    const label = row.querySelector("input")?.value?.trim();
    if (label) labels.push(label);
  });

  if (labels.length === 0) { hide(); return; }

  btn.style.display = "";

  const table = document.createElement("table");

  // Header
  const hrow = table.createTHead().insertRow();
  const th0 = document.createElement("th");
  th0.textContent = "Study";
  hrow.appendChild(th0);
  robPlotState.domains.forEach(domain => {
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

    robPlotState.domains.forEach(domain => {
      const td = row.insertCell();
      const sel = document.createElement("select");
      ["", "Low", "Some concerns", "High", "NI"].forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt || "—";
        sel.appendChild(o);
      });
      const current = robPlotState.data[label]?.[domain] ?? "";
      sel.value = current;
      _applyRoBClass(sel, current);

      sel.addEventListener("change", () => {
        if (!robPlotState.data[label]) robPlotState.data[label] = {};
        robPlotState.data[label][domain] = sel.value;
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
  if (!name || robPlotState.domains.includes(name)) return;
  robPlotState.domains.push(name);
  input.value = "";
  renderRoBDomainTags();
  renderRoBDataGrid();
  markStale();
  scheduleSave();
}

function removeRoBDomain(name) {
  robPlotState.domains = robPlotState.domains.filter(d => d !== name);
  Object.values(robPlotState.data).forEach(ratings => { delete ratings[name]; });
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
  _themeToggle.textContent  = isLight ? "☾" : "☀";
  _themeToggle.title        = isLight ? "Switch to dark mode" : "Switch to light mode";
  _themeToggle.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
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
  // "App default" plots embed var(--xxx) colour references that are resolved at
  // paint time.  Re-rendering after the page theme changes ensures computed fills
  // (contour regions, background clearing, etc.) use the new token values.
  // Journal presets use hardcoded colours and don't need a redraw here.
  if (appState.plotTheme === "default") redrawCachedPlots();
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
_toggleResults.setAttribute("aria-disabled", "true");

_toggleInput.addEventListener("click",   () => showView("input"));
_toggleResults.addEventListener("click", () => { if (!_toggleResults.disabled) showView("results"); });
_toggleGuide.addEventListener("click",   () => showView("guide"));
_toggleAbout.addEventListener("click",   () => showView("about"));

// Show input view by default; output hidden until first run switches to it.
showView("input");

// ── Settings-strip popovers ───────────────────────────────────────────────────

function _closeAllPopovers() {
  document.querySelectorAll(".settings-popover").forEach(p => { p.hidden = true; });
  document.querySelectorAll("[data-popover]").forEach(b => b.setAttribute("aria-expanded", "false"));
}

function _positionPopover(btn, panel) {
  const r = btn.getBoundingClientRect();
  const panelW = panel.offsetWidth || 340;
  let left = r.left;
  if (left + panelW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - panelW - 8);
  panel.style.top  = (r.bottom + 4) + "px";
  panel.style.left = left + "px";
}

function initSettingsPopovers() {
  document.querySelectorAll("[data-popover]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const panel  = document.getElementById(btn.dataset.popover);
      const isOpen = !panel.hidden;
      _closeAllPopovers();
      if (!isOpen) {
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        _positionPopover(btn, panel);
      }
    });
  });

  document.addEventListener("pointerdown", e => {
    if (!e.target.closest("[data-popover], .settings-popover, #helpPopover")) _closeAllPopovers();
  }, { capture: true });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && _helpPopover.style.display === "none") _closeAllPopovers();
  });
}

initSettingsPopovers();

function _applyModeToggle() {
  const isMV = mvState.active;
  document.getElementById("modeStandard").classList.toggle("active", !isMV);
  document.getElementById("modeMultivariate").classList.toggle("active", isMV);
  document.getElementById("standardSettings").style.display  = isMV ? "none" : "";
  document.getElementById("mvStripControls").style.display   = isMV ? ""     : "none";
  document.getElementById("inputTableWrap").style.display    = isMV ? "none" : "";
  document.getElementById("addStudy").style.display          = isMV ? "none" : "";
  document.getElementById("mvTableWrap").style.display       = isMV ? ""     : "none";
  document.getElementById("mvAddRow").style.display          = isMV ? ""     : "none";
  _closeAllPopovers();
}

// ---------------- INITIALIZE ----------------
document.getElementById("modeStandard").addEventListener("click",     () => { mvState.active = false; _applyModeToggle(); markStale(); });
document.getElementById("modeMultivariate").addEventListener("click", () => { mvState.active = true;  _applyModeToggle(); markStale(); });
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
  if (mvState.active) {
    const pending = getPendingImport();
    document.getElementById("previewImport").textContent =
      pending?.mvCandidate ? "Import to MV Table" : "Import";
  }
});
document.getElementById("previewImport").addEventListener("click", () => {
  document.getElementById("previewImport").textContent = "Import";
  const pending = getPendingImport();
  if (pending?.mvCandidate && mvState.active) {
    commitImportMV(pending.parsed, pending.mvHeaders);
    cancelImport();
    return;
  }
  const missingCols = commitImport();
  const importedType = document.getElementById("effectType").value;
  syncMHOptions(importedType);
  const { studies, excluded, softWarnings } = collectStudies(importedType);
  updateValidationWarnings(studies, excluded, softWarnings);
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

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("importPreview").style.display !== "none") {
    document.getElementById("previewImport").textContent = "Import";
    cancelImport();
  }
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
document.getElementById("cumulativeOrder").addEventListener("change", () => {
  if (!cumForestPlot.sourceStudies) return;
  const order = document.getElementById("cumulativeOrder").value;
  const sorted = cumForestPlot.sourceStudies.slice();
  if      (order === "precision_desc") sorted.sort((a, b) => a.vi - b.vi);
  else if (order === "precision_asc")  sorted.sort((a, b) => b.vi - a.vi);
  else if (order === "effect_asc")     sorted.sort((a, b) => a.yi - b.yi);
  else if (order === "effect_desc")    sorted.sort((a, b) => b.yi - a.yi);
  const cumResults = cumulativeMeta(sorted, cumForestPlot.method, cumForestPlot.ciMethod, cumForestPlot.alpha);
  cumForestPlot.args.results = cumResults;
  cumForestPlot.page = 0;
  cumFunnelPlot.studies = sorted;
  cumFunnelPlot.results = cumResults;
  const slider = document.getElementById("cumulativeFunnelStep");
  if (slider) { slider.max = cumResults.length - 1; slider.value = cumResults.length - 1; }
  _updateCumFunnelLabel(cumResults.length - 1);
  const { totalPages } = drawCumulativeForest(cumResults, cumForestPlot.args.profile,
    { pageSize: cumForestPlot.args.pageSize, page: 0, theme: appState.plotTheme });
  renderCumulativeForestNav(totalPages);
  drawCumulativeFunnel(sorted, cumResults, cumFunnelPlot.profile, cumResults.length - 1, { theme: appState.plotTheme });
  if (appState.reportArgs?.cumForestOptions) {
    appState.reportArgs = { ...appState.reportArgs,
      cumForestOptions: { ...appState.reportArgs.cumForestOptions, results: cumResults, currentPage: 0 } };
  }
});
document.getElementById("cumulativeFunnelStep").addEventListener("input", e => {
  if (!cumFunnelPlot.studies) return;
  const step = +e.target.value;
  _updateCumFunnelLabel(step);
  drawCumulativeFunnel(cumFunnelPlot.studies, cumFunnelPlot.results, cumFunnelPlot.profile, step, { theme: appState.plotTheme });
});
document.getElementById("caterpillarPageSize").addEventListener("change", () => {
  if (!caterpillarPlot.args) return;
  caterpillarPlot.page = 0;
  const raw = document.getElementById("caterpillarPageSize").value;
  caterpillarPlot.args.pageSize = raw === "all" ? Infinity : +raw;
  const { totalPages } = drawCaterpillarPlot(
    caterpillarPlot.args.studies, caterpillarPlot.args.m, caterpillarPlot.args.profile,
    { pageSize: caterpillarPlot.args.pageSize, page: caterpillarPlot.page }
  );
  renderCaterpillarNav(totalPages);
  if (appState.reportArgs?.caterpillarOptions) {
    appState.reportArgs = { ...appState.reportArgs, caterpillarOptions: { ...appState.reportArgs.caterpillarOptions, pageSize: caterpillarPlot.args.pageSize, currentPage: 0 } };
  }
});

document.getElementById("blupPageSize").addEventListener("change", () => {
  if (!blupPlot.result) return;
  blupPlot.page = 0;
  const raw = document.getElementById("blupPageSize").value;
  blupPlot.pageSize = raw === "all" ? Infinity : +raw;
  const { totalPages } = drawBlupPlot(blupPlot.result, blupPlot.profile, { pageSize: blupPlot.pageSize, page: 0, theme: appState.plotTheme });
  renderBlupNav(totalPages);
});

document.getElementById("cumulativeForestPageSize").addEventListener("change", () => {
  if (!cumForestPlot.args) return;
  cumForestPlot.page = 0;
  const raw = document.getElementById("cumulativeForestPageSize").value;
  cumForestPlot.args.pageSize = raw === "all" ? Infinity : +raw;
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
  const pageSize    = rawPageSize === "all" ? Infinity : +rawPageSize;
  forestPlot.args.options = { ...forestPlot.args.options, pageSize, theme: appState.plotTheme };
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
  resetSel("tfEstimator"); resetSel("plotTheme");
  resetSel("selMode");    resetSel("selPreset"); resetSel("selSides"); resetSel("selWeightFn");
  resetChk("useTrimFill"); resetChk("useTFAdjusted");
  resetNum("bayesMu0"); resetNum("bayesSigmaMu"); resetNum("bayesSigmaTau");
  resetSel("bayesPreset");
  resetNum("selCuts");
  resetNum("fsnTrivial"); resetSel("fsnDirection");
  // RVE: reset weighting select (fires change to show/hide ρ row), then reset ρ slider.
  const rveWeightingReset = document.getElementById("rveWeighting");
  if (rveWeightingReset) { rveWeightingReset.selectedIndex = 0; rveWeightingReset.dispatchEvent(new Event("change")); }
  const rveRhoEl = document.getElementById("rveRho");
  if (rveRhoEl) { rveRhoEl.value = rveRhoEl.defaultValue; rveRhoEl.dispatchEvent(new Event("input")); }
  resetSel("threeLevelMethod");

  // Sync dependent UI state.
  syncTrimFillState();
  syncMHOptions(document.getElementById("effectType").value);
  syncPLAvailability();
  syncSelControls();

  // Reset table and moderators.
  clearDraft();
  clearModerators();
  robPlotState.domains = [];
  robPlotState.data    = {};
  renderRoBDomainTags();
  renderRoBDataGrid();
  updateTableHeaders();
  const table = document.getElementById("inputTable");
  while (table.rows.length > 1) table.deleteRow(1);
  addRow();
  hideDraftBanner();

  // Reset Multivariate mode.
  resetMvSettings();
  clearMV();
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

// ---------------- REPORT EXPORT BUTTONS ----------------
// buildReport internally re-renders every forest page into a hidden element
// then restores the live view.  After it returns we re-render the live forest
// at the currently-viewed page and re-sync the nav, because buildReport has no
// access to renderForestNav.
async function buildReportAndResync() {
  if (!appState.reportArgs) return null;
  flushDeferredDraws();

  if (appState.reportArgs.mv) {
    const { reportCSS, buildTableAPA, buildFigureAPA } = await getReport();
    const html = buildMVReportHTML(
      appState.reportArgs.mvRes,
      appState.reportArgs.mvRows ?? [],
      appState.reportArgs.mvAlpha ?? 0.05,
      { reportCSS, buildTableAPA, buildFigureAPA },
    );
    return { html, downloadHTML: mvDownloadHTML, openPrintPreview: mvOpenPrintPreview };
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
    plotTheme: appState.plotTheme,
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
        res:         appState.reportArgs.mvRes,
        rows:        appState.reportArgs.mvRows ?? [],
        alpha:       appState.reportArgs.mvAlpha ?? 0.05,
        exportScale: appState.exportScale,
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
        plotTheme:   appState.plotTheme,
        apaFormat:   true,
        exportScale: appState.exportScale,
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
  const section = btn.closest(".ls-contrast-section") ?? btn.closest(".contrast-section");
  if (!section) return;
  const isLs = section.classList.contains("ls-contrast-section");
  const inputs = section.querySelectorAll(".contrast-weight");
  const L = Array.from(inputs).map(inp => parseFloat(inp.value) || 0);
  if (isLs) {
    if (!appState.results.ls) return;
    const regLike = { beta: appState.results.ls.beta, vcov: appState.results.ls.vcov_beta, crit: appState.results.ls.crit, dist: "z", QEdf: appState.results.ls.QEdf };
    section.querySelector(".contrast-result").innerHTML = formatContrastResult(testContrast(regLike, L), regLike, getCiAlpha());
  } else {
    if (!appState.results.reg) return;
    section.querySelector(".contrast-result").innerHTML = formatContrastResult(testContrast(appState.results.reg, L), appState.results.reg, getCiAlpha());
  }
});

// Delegated listener for vcov CSV download button (injected into regression panel).
document.addEventListener("click", e => {
  const btn = e.target.closest(".vcov-download-btn");
  if (!btn) return;
  const which = btn.dataset.which;
  let vcov, colNames, filename;
  if (which === "loc") {
    if (!appState.results.ls?.vcov_beta) return;
    vcov = appState.results.ls.vcov_beta; colNames = appState.results.ls.locColNames; filename = "vcov_beta.csv";
  } else if (which === "scale") {
    if (!appState.results.ls?.vcov_gamma) return;
    vcov = appState.results.ls.vcov_gamma; colNames = appState.results.ls.scaleColNames; filename = "vcov_gamma.csv";
  } else {
    if (!appState.results.reg?.vcov || !appState.results.reg?.colNames) return;
    vcov = appState.results.reg.vcov; colNames = appState.results.reg.colNames; filename = "vcov.csv";
  }
  const headers = ["", ...colNames];
  const rows = vcov.map((row, i) => [colNames[i], ...row.map(v => isFinite(v) ? v.toFixed(6) : "NA")]);
  downloadBlob(serializeCSV(headers, rows), filename, "text/csv;charset=utf-8;");
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
// ---------------- BAYESIAN PRESETS ----------------
const BAYES_PRESETS = {
  default:   { mu0: 0,   sigmaMu: 1,    sigmaTau: 0.5  },
  weakly:    { mu0: 0,   sigmaMu: 2,    sigmaTau: 1.0  },
  sceptical: { mu0: 0,   sigmaMu: 0.5,  sigmaTau: 0.25 },
};

function syncBayesPreset() {
  const mu0  = parseFloat(document.getElementById("bayesMu0").value);
  const smu  = parseFloat(document.getElementById("bayesSigmaMu").value);
  const stau = parseFloat(document.getElementById("bayesSigmaTau").value);
  const match = Object.entries(BAYES_PRESETS).find(([, p]) =>
    p.mu0 === mu0 && p.sigmaMu === smu && p.sigmaTau === stau
  );
  document.getElementById("bayesPreset").value = match ? match[0] : "custom";
}

document.getElementById("bayesPreset").addEventListener("change", () => {
  const preset = BAYES_PRESETS[document.getElementById("bayesPreset").value];
  if (!preset) return; // "custom" — leave inputs alone
  document.getElementById("bayesMu0").value      = preset.mu0;
  document.getElementById("bayesSigmaMu").value  = preset.sigmaMu;
  document.getElementById("bayesSigmaTau").value = preset.sigmaTau;
  // Clear any lingering validation warnings
  document.getElementById("bayesSigmaMuWarn").style.display  = "none";
  document.getElementById("bayesSigmaTauWarn").style.display = "none";
  markStale();
  _checkAdvancedBadge();
});

document.getElementById("bayesMu0").addEventListener("input", () => { syncBayesPreset(); markStale(); });
document.getElementById("bayesSigmaMu").addEventListener("input", () => { syncBayesPreset(); markStale(); });
document.getElementById("bayesSigmaTau").addEventListener("input", () => { syncBayesPreset(); markStale(); });

const trimFillCheckbox = document.getElementById("useTrimFill");
const adjustedCheckbox = document.getElementById("useTFAdjusted");
const tfEstimatorSelect = document.getElementById("tfEstimator");

function syncTrimFillState() {
  const enabled = trimFillCheckbox.checked;
  tfEstimatorSelect.disabled = !enabled;
  adjustedCheckbox.disabled  = !enabled;
  const tfLbl  = tfEstimatorSelect.closest("label");
  const adjLbl = adjustedCheckbox.closest("label");
  if (enabled) {
    tfLbl?.removeAttribute("aria-disabled");
    adjLbl?.removeAttribute("aria-disabled");
  } else {
    tfLbl?.setAttribute("aria-disabled", "true");
    adjLbl?.setAttribute("aria-disabled", "true");
  }
}

syncTrimFillState();
trimFillCheckbox.addEventListener("change", () => {
  if (!trimFillCheckbox.checked) adjustedCheckbox.checked = false;
  syncTrimFillState();
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

  setVisible(weightFnRow, !isSensitivity);
  setVisible(presetRow,   isSensitivity);
  // Show sides/cuts for: sensitivity custom preset, or MLE step function
  const showCustom = (isSensitivity && preset === "custom") || showStepCtrls;
  setVisible(customRow, showCustom);

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

// ---------------- ADVANCED SETTINGS: BADGE + RESET ----------------

// Delegated listeners so the badge updates whenever any advanced control changes.
document.getElementById("advancedSettings").addEventListener("change", _checkAdvancedBadge);
document.getElementById("advancedSettings").addEventListener("input",  _checkAdvancedBadge);
_checkAdvancedBadge();

function resetAdvancedSettings() {
  const resetSel = id => {
    const el = document.getElementById(id); if (!el) return;
    const i = [...el.options].findIndex(o => o.defaultSelected);
    el.selectedIndex = i >= 0 ? i : 0;
  };
  const resetNum = id => { const el = document.getElementById(id); if (el) el.value = el.defaultValue; };
  const resetChk = id => { const el = document.getElementById(id); if (el) el.checked = el.defaultChecked; };

  resetSel("ciLevel"); resetSel("mccMethod"); resetSel("cumulativeOrder");
  resetSel("tfEstimator");
  resetChk("useTrimFill"); resetChk("useTFAdjusted");
  resetSel("selMode"); resetSel("selPreset"); resetSel("selSides"); resetSel("selWeightFn");
  resetNum("bayesMu0"); resetNum("bayesSigmaMu"); resetNum("bayesSigmaTau");
  resetSel("bayesPreset");
  resetNum("selCuts");
  resetNum("fsnTrivial"); resetSel("fsnDirection");
  const rveWeightingReset2 = document.getElementById("rveWeighting");
  if (rveWeightingReset2) { rveWeightingReset2.selectedIndex = 0; rveWeightingReset2.dispatchEvent(new Event("change")); }
  const rveRhoEl = document.getElementById("rveRho");
  if (rveRhoEl) { rveRhoEl.value = rveRhoEl.defaultValue; rveRhoEl.dispatchEvent(new Event("input")); }
  resetSel("threeLevelMethod");

  syncTrimFillState();
  syncSelControls();
  markStale();
  _checkAdvancedBadge();
}

document.getElementById("resetAdvanced").addEventListener("click", resetAdvancedSettings);

function _checkMvBadge() {
  const selDiffers = id => {
    const el = document.getElementById(id); if (!el) return false;
    const def = [...el.options].findIndex(o => o.defaultSelected);
    return el.selectedIndex !== (def >= 0 ? def : 0);
  };
  const valDiffers = id => { const el = document.getElementById(id); return el && el.value !== el.defaultValue; };

  const custom = selDiffers("mvSlopes") || valDiffers("mvRho") || selDiffers("mvCiLevel");

  const badge = document.getElementById("mvBadge");
  if (badge) badge.style.display = custom ? "" : "none";
  document.getElementById("mvSettings")?.classList.toggle("settings-modified", custom);
}

document.getElementById("mvSettings").addEventListener("change", () => { _checkMvBadge(); scheduleSave(); markStale(); });
document.getElementById("mvSettings").addEventListener("input",  () => { _checkMvBadge(); scheduleSave(); markStale(); });
_checkMvBadge();

// Strip selects: mark stale + save on change (mirrors Standard effectType/tauMethod behavior)
document.getElementById("mvStruct").addEventListener("change",    () => { scheduleSave(); markStale(); });
document.getElementById("mvMethod").addEventListener("change",    () => { scheduleSave(); markStale(); });
document.getElementById("mvCiMethod").addEventListener("change",  () => { scheduleSave(); markStale(); });

// CI width two-way sync: mvCiLevel ↔ ciLevel
document.getElementById("mvCiLevel").addEventListener("change", e => {
  document.getElementById("ciLevel").value = e.target.value;
  _checkAdvancedBadge();
  scheduleSave(); markStale();
});
document.getElementById("ciLevel").addEventListener("change", () => {
  const mvEl = document.getElementById("mvCiLevel");
  if (mvEl) { mvEl.value = document.getElementById("ciLevel").value; _checkMvBadge(); }
});

function resetMvSettings() {
  const resetSel = id => {
    const el = document.getElementById(id); if (!el) return;
    const i = [...el.options].findIndex(o => o.defaultSelected);
    el.selectedIndex = i >= 0 ? i : 0;
  };
  resetSel("mvStruct");
  resetSel("mvMethod");
  resetSel("mvCiMethod");
  resetSel("mvSlopes");
  resetSel("mvCiLevel");
  document.getElementById("ciLevel").value = "95";
  const rho = document.getElementById("mvRho");
  if (rho) rho.value = rho.defaultValue;
  markStale();
  _checkMvBadge();
  _checkAdvancedBadge();
}

document.getElementById("resetMv").addEventListener("click", resetMvSettings);


// ---------------- BAYESIAN PRIOR VALIDATION ----------------
{
  const clampPos = (inputId, warnId, min = 0.01) => {
    const input = document.getElementById(inputId);
    const warn  = document.getElementById(warnId);
    if (!input || !warn) return;
    const validate = () => {
      const v = parseFloat(input.value);
      if (!isFinite(v) || v < min) {
        input.value = min;
        warn.textContent = `Must be ≥ ${min}`;
        warn.style.display = "";
        markStale();
      } else {
        warn.style.display = "none";
      }
    };
    input.addEventListener("blur",   validate);
    input.addEventListener("change", validate);
  };
  clampPos("bayesSigmaMu",  "bayesSigmaMuWarn");
  clampPos("bayesSigmaTau", "bayesSigmaTauWarn");
}

// ---------------- RVE ρ SLIDER + WEIGHTING SELECT ----------------
{
  const rveRhoSlider    = document.getElementById("rveRho");
  const rveRhoDisplay   = document.getElementById("rveRhoDisplay");
  const rveWeightingEl  = document.getElementById("rveWeighting");
  const rveRhoRow       = document.getElementById("rveRhoRow");
  const rveRhoHint      = document.getElementById("rveRhoHint");
  const rveHierHint     = document.getElementById("rveHierHint");

  const syncRhoDisplay = () => {
    rveRhoDisplay.textContent = parseFloat(rveRhoSlider.value).toFixed(2);
  };
  const syncWeighting = () => {
    const isHier = rveWeightingEl?.value === "hier";
    if (rveRhoRow)   rveRhoRow.style.display   = isHier ? "none" : "";
    if (rveRhoHint)  rveRhoHint.style.display  = isHier ? "none" : "";
    if (rveHierHint) rveHierHint.style.display = isHier ? ""     : "none";
  };

  syncRhoDisplay();
  syncWeighting();
  rveRhoSlider.addEventListener("input",  syncRhoDisplay);
  rveRhoSlider.addEventListener("change", markStale);
  rveWeightingEl?.addEventListener("change", () => { syncWeighting(); markStale(); });
  document.getElementById("threeLevelMethod")?.addEventListener("change", markStale);
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
    drawProfileLikTau2(appState.reportArgs.profileLik, { xScale, theme: appState.plotTheme });
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
  const session = gatherSessionState(moderators, scaleModerators, interactions, { domains: robPlotState.domains, data: robPlotState.data });
  const mvData = gatherMVState();
  const mvHasData = mvData.rows.some(r => r.study_id || r.outcome_id || r.yi || r.vi);
  if (mvState.active || mvHasData) session.mv = { ...mvData, active: mvState.active };
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
  if (s.ciLevel         && document.getElementById("ciLevel").querySelector(`option[value="${s.ciLevel}"]`)) {
    document.getElementById("ciLevel").value         = s.ciLevel;
    const mvCiEl = document.getElementById("mvCiLevel");
    if (mvCiEl) mvCiEl.value = s.ciLevel;
  }
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

  // Display / reporting settings
  if (s.mccMethod) {
    const el = document.getElementById("mccMethod");
    if (el && el.querySelector(`option[value="${s.mccMethod}"]`)) el.value = s.mccMethod;
  }
  if (s.rveMode === "hier") {
    const el = document.getElementById("rveWeighting");
    if (el) { el.value = "hier"; el.dispatchEvent(new Event("change")); }
  }
  if (s.threeLevelMethod === "ML") {
    const el = document.getElementById("threeLevelMethod");
    if (el) el.value = "ML";
  }
  if (isFinite(s.rveRho) && s.rveRho >= 0 && s.rveRho < 1) {
    const el = document.getElementById("rveRho");
    if (el) { el.value = s.rveRho; el.dispatchEvent(new Event("input")); }
  }
  if (isFinite(s.fsnTrivial) && s.fsnTrivial > 0) {
    const el = document.getElementById("fsnTrivial");
    if (el) el.value = s.fsnTrivial;
  }
  if (s.fsnDirection) {
    const el = document.getElementById("fsnDirection");
    if (el && el.querySelector(`option[value="${s.fsnDirection}"]`)) el.value = s.fsnDirection;
  }

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
  robPlotState.domains = Array.isArray(rob.domains) ? [...rob.domains] : [];
  robPlotState.data    = (rob.data && typeof rob.data === "object") ? rob.data : {};
  renderRoBDomainTags();
  renderRoBDataGrid();

  // Restore MV mode
  const mv = session.mv;
  if (mv && typeof mv === "object") {
    // mv.active is false when user was in Standard mode but had MV data.
    // Absent in old sessions — treat as true for backward compat.
    mvState.active = mv.active !== false;
    _applyModeToggle();
    if (mv.struct && document.getElementById("mvStruct").querySelector(`option[value="${mv.struct}"]`))
      document.getElementById("mvStruct").value = mv.struct;
    if (mv.method && document.getElementById("mvMethod").querySelector(`option[value="${mv.method}"]`))
      document.getElementById("mvMethod").value = mv.method;
    if (mv.ciMethod && document.getElementById("mvCiMethod").querySelector(`option[value="${mv.ciMethod}"]`))
      document.getElementById("mvCiMethod").value = mv.ciMethod;
    if (mv.slopes && document.getElementById("mvSlopes").querySelector(`option[value="${mv.slopes}"]`))
      document.getElementById("mvSlopes").value = mv.slopes;
    if (isFinite(mv.rho)) document.getElementById("mvRho").value = mv.rho;
    mvModerators.length = 0;
    if (Array.isArray(mv.moderators)) mv.moderators.forEach(n => { if (n) mvModerators.push(n); });
    renderMVModTags();
    rebuildMVTableHeaders();
    document.getElementById("mvTableBody").innerHTML = "";
    if (Array.isArray(mv.rows)) {
      mv.rows.forEach(r => {
        const tr = addMVRow();
        if (r.study_id   !== undefined) tr.querySelector(".mv-study-id").value   = r.study_id;
        if (r.outcome_id !== undefined) tr.querySelector(".mv-outcome-id").value = r.outcome_id;
        if (r.yi         !== undefined) tr.querySelector(".mv-yi").value = r.yi;
        if (r.vi         !== undefined) tr.querySelector(".mv-vi").value = r.vi;
        mvModerators.forEach((name, i) => {
          const inputs = tr.querySelectorAll(".mv-mod-cell");
          if (inputs[i] && r[name] !== undefined) inputs[i].value = r[name];
        });
      });
    }
  } else {
    mvState.active = false;
    _applyModeToggle();
  }

  syncTrimFillState();
  syncBayesPreset();
  syncRveVisibility();
  _checkAdvancedBadge();
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
  const _sessionType = document.getElementById("effectType").value;
  syncMHOptions(_sessionType);
  { const { studies, excluded, softWarnings } = collectStudies(_sessionType); updateValidationWarnings(studies, excluded, softWarnings); }

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
  if (mvState.active) {
    const headers = ["study_id", "outcome_id", "yi", "vi", ...mvModerators.map(n => n)];
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
// Show #rveSettings whenever the table has any non-empty cluster cell and the
// current method is not MH/Peto.  Called eagerly on table edits, CSV import,
// session restore, and method change — not gated on a Run.
function syncRveVisibility() {
  const method = document.getElementById("tauMethod")?.value ?? "";
  const isMHorPeto = method === "MH" || method === "Peto";
  const hasClusters = [...document.querySelectorAll("#inputTable .cluster")]
    .some(el => el.value.trim() !== "");
  setVisible(document.getElementById("rveSettings"), hasClusters && !isMHorPeto);
}

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

  syncRveVisibility();
  syncPLAvailability();
}

function init() {
  // Inject callbacks into ui-table.js (required before any table operations)
  initTable({
    markStale,
    scheduleSave,
    renderRoBDataGrid,
    deleteRobEntry: key => { delete robPlotState.data[key]; },
    onModeratorChanged: () => { refreshInteractionUI(); renderInteractionTags(); },
  });

  // Inject callbacks into ui-mv.js (required before MV table or session operations)
  initMV({
    appState,
    robPlotState,
    markStale,
    getCiAlpha,
    onRunSuccess: () => {
      if (outputPlaceholder) outputPlaceholder.style.display = "none";
      staleBanner.style.display = "none";
      _toggleResults.classList.remove("stale");
      if (inputStaleBadge) inputStaleBadge.hidden = true;
      if (!appState.hasRunOnce) {
        appState.hasRunOnce = true;
        _toggleResults.disabled = false;
        _toggleResults.removeAttribute("aria-disabled");
        _toggleResults.removeAttribute("title");
      }
    },
  });

  // Wire the shared tooltip element into plots.js (removes "#tooltip" coupling)
  setTooltipElement(document.getElementById("tooltip"));

  // Populate effect type dropdowns from profiles
  populateEffectTypeDropdowns();

  // Restore autosaved draft if one exists, otherwise populate example data.
  const draft = loadDraft();
  const _draftHasData = draft && (
    draft.studies?.length > 0 ||
    draft.mv?.rows?.some(r => r.study_id || r.outcome_id || r.yi || r.vi)
  );
  if (_draftHasData) {
    applySession(draft);
    showDraftBanner(draft._savedAt);
  } else {
    // Default effect type: SMD (scale-free, broadly applicable)
    document.getElementById("effectType").value = "SMD";
    updateTableHeaders();
    populateExampleData("SMD");
  }
  // Run validation after table is populated (draft restore or example data).
  {
    const type = document.getElementById("effectType").value;
    const { studies, excluded, softWarnings } = collectStudies(type);
    updateValidationWarnings(studies, excluded, softWarnings);
  }

  // Initialise MH/Peto and PL availability based on default/restored settings.
  syncMHOptions(document.getElementById("effectType").value);

  // Update RVE visibility whenever a cluster cell changes (no Run required).
  document.getElementById("inputTable").addEventListener("input", e => {
    if (e.target.classList.contains("cluster")) syncRveVisibility();
  });

  // Populate MV example data (Berkey 1998: 5 trials, 2 outcomes).
  // Skip if applySession already restored MV rows from a draft.
  if (document.getElementById("mvTableBody").children.length === 0) {
    if (USE_EXAMPLES) populateMVExample(); else addMVRow();
  }

  // Label all export button groups for accessibility
  document.querySelectorAll(".plot-export").forEach(div => {
    const plotBlock = div.closest(".plot-block, .plot-block-inline");
    const labelEl   = plotBlock?.querySelector(".plot-label");
    if (labelEl) {
      const text = Array.from(labelEl.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join(" ")
        .trim();
      if (text) {
        div.setAttribute("role", "group");
        div.setAttribute("aria-label", `Export ${text}`);
      }
    }
  });

  // Validate all rows
  document.querySelectorAll("#inputTable tr").forEach((row, i) => {
    if (i === 0) return;
    validateRow(row);
  });

  if (new URLSearchParams(window.location.search).has("tests")) {
    import("./tests.js").then(({ runTests }) => runTests());
  }

  // Fire the onboarding tour after idle — never blocks initial render.
  const _ric = window.requestIdleCallback ?? (cb => setTimeout(cb, 200));
  _ric(() => getOnboarding().then(m => m.maybeStartTour()).catch(() => {}));

  // Replay link in the About tab: switch to Input view first so tour anchors
  // are visible (all Input elements have zero dimensions while hidden).
  document.getElementById("replayTourLink")?.addEventListener("click", e => {
    e.preventDefault();
    showView("input");
    mvState.active = false;
    _applyModeToggle();
    getOnboarding().then(m => m.startTour({ force: true })).catch(() => {});
  });
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
  plotTheme:   "default",
  results: { reg: null, ls: null }, // last successful metaRegression / lsModel result
};

// Restore plot theme from localStorage so the user's visual preference survives reload.
{
  const saved = localStorage.getItem("fosma-plot-theme");
  const sel   = document.getElementById("plotTheme");
  if (saved && sel && sel.querySelector(`option[value="${saved}"]`)) {
    sel.value          = saved;
    appState.plotTheme = saved;
  }
}

const forestPlot = {
  page:        0,
  args:        null,        // { studies, m, options } — cached for page-nav re-renders
  poolDisplay: "RE",        // "FE" | "RE" | "Both"
  theme:       "default",   // visual style preset key (see plotThemes.js)
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
  sourceStudies: null,      // original unsorted studies for live re-sort
  method:   null,
  ciMethod: null,
  alpha:    null,
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
  result:  null,   // cached for theme redraw
};

const pCurvePlot  = { result: null };
const pUniformPlot = { result: null, m: null, profile: null };

const diagnosticsState = {
  influence: null, baujatResult: null, profile: null,
  qqResiduals: null, qqLabels: null,
  studies: null, m: null, type: null,
  showQQ: false, showLabbe: false, isMHorPeto: false,
};
const bubblePlotState = { bubbleResult: null, moderators: null, usePartialBubble: false };
const robPlotState    = {
  studies: null,
  domains: [],  // string[] — ordered domain names
  data:    {},  // { [studyLabel]: { [domain]: "Low"|"Some concerns"|"High"|"NI"|"" } }
};

document.getElementById("exportScale").addEventListener("change", e => {
  appState.exportScale = +e.target.value;
});

document.querySelectorAll(".forest-pool-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!forestPlot.args) return;
    forestPlot.poolDisplay = btn.dataset.display;
    document.querySelectorAll(".forest-pool-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-pressed", String(b === btn));
    });
    forestPlot.page = 0;
    forestPlot.args.options = { ...forestPlot.args.options, pooledDisplay: forestPlot.poolDisplay };
    const { totalPages } = drawForest(forestPlot.args.studies, forestPlot.args.m, { ...forestPlot.args.options, page: forestPlot.page });
    renderForestNav(totalPages);
  });
});

document.getElementById("plotTheme").addEventListener("change", e => {
  appState.plotTheme = e.target.value;
  localStorage.setItem("fosma-plot-theme", e.target.value);
  if (appState.reportArgs) {
    appState.reportArgs = { ...appState.reportArgs, plotTheme: appState.plotTheme };
  }
  redrawCachedPlots();
});

function redrawCachedPlots() {
  const theme = appState.plotTheme;
  if (mvForestState?.lastRes) redrawAllMVForestPlots();
  if (forestPlot.args) {
    forestPlot.args.options = { ...forestPlot.args.options, theme };
    const { totalPages } = drawForest(forestPlot.args.studies, forestPlot.args.m, { ...forestPlot.args.options, page: forestPlot.page });
    renderForestNav(totalPages);
  }
  if (funnelPlot.args) {
    drawFunnel(...funnelPlot.args, { egger: funnelPlot.egger, contours: funnelPlot.contours, petpeese: funnelPlot.petpeese, theme });
  }
  if (cumForestPlot.args) {
    const { totalPages } = drawCumulativeForest(
      cumForestPlot.args.results, cumForestPlot.args.profile,
      { pageSize: cumForestPlot.args.pageSize, page: cumForestPlot.page, theme }
    );
    renderCumulativeForestNav(totalPages);
  }
  if (cumFunnelPlot.studies) {
    const slider = document.getElementById("cumulativeFunnelStep");
    const step = slider ? +slider.value : (cumFunnelPlot.results?.length ?? 1) - 1;
    drawCumulativeFunnel(cumFunnelPlot.studies, cumFunnelPlot.results, cumFunnelPlot.profile, step, { theme });
  }
  if (caterpillarPlot.args) {
    const { totalPages } = drawCaterpillarPlot(
      caterpillarPlot.args.studies, caterpillarPlot.args.m, caterpillarPlot.args.profile,
      { pageSize: caterpillarPlot.args.pageSize, page: caterpillarPlot.page, theme }
    );
    renderCaterpillarNav(totalPages);
  }
  if (blupPlot.result) {
    const { totalPages } = drawBlupPlot(blupPlot.result, blupPlot.profile, { pageSize: blupPlot.pageSize, page: blupPlot.page, theme });
    renderBlupNav(totalPages);
  }
  if (goshState.result) {
    const xAxis = document.getElementById("goshXAxis")?.value || "I2";
    drawGoshPlot(goshState.result, goshState.profile, { xAxis, theme });
  }
  if (bayesState.result) {
    drawBayesMuPosterior(bayesState.result, { reMean: bayesState.reMean, theme });
    drawBayesTauPosterior(bayesState.result, { theme });
  }
  if (appState.reportArgs?.profileLik) {
    const xScale = document.getElementById("profileLikScale")?.value || appState.reportArgs.profileLikXScale || "tau2";
    drawProfileLikTau2(appState.reportArgs.profileLik, { xScale, theme });
  }
  if (pCurvePlot.result) {
    drawPCurve(pCurvePlot.result, { theme });
  }
  if (pUniformPlot.result) {
    drawPUniform(pUniformPlot.result, pUniformPlot.m, pUniformPlot.profile, { theme });
  }
  if (diagnosticsState.influence) {
    drawInfluencePlot(diagnosticsState.influence, { theme });
    drawBaujatPlot(diagnosticsState.baujatResult, diagnosticsState.profile, { theme });
    if (diagnosticsState.showQQ)
      drawQQPlot(diagnosticsState.qqResiduals, diagnosticsState.qqLabels, { theme });
    if (!diagnosticsState.isMHorPeto && diagnosticsState.studies?.length >= 2)
      drawRadialPlot(diagnosticsState.studies, diagnosticsState.m, diagnosticsState.profile, { theme });
    if (diagnosticsState.showLabbe)
      drawLabbe(diagnosticsState.studies, diagnosticsState.m, diagnosticsState.profile, { type: diagnosticsState.type, theme });
  }
  if (caterpillarPlot.args) {
    drawOrchardPlot(caterpillarPlot.args.studies, caterpillarPlot.args.m, caterpillarPlot.args.profile, { theme });
  }
  if (bubblePlotState.bubbleResult) {
    const bc = document.getElementById("bubblePlots");
    if (bc) {
      bc.innerHTML = "";
      bubblePlotState.moderators.forEach((mod, i) => {
        const colIdxs = bubblePlotState.bubbleResult.modColMap && bubblePlotState.bubbleResult.modColMap[mod.name];
        if (!colIdxs || colIdxs.length === 0) return;
        const wrap = document.createElement("div");
        wrap.dataset.moderator = mod.name;
        bc.appendChild(wrap);
        if (bubblePlotState.usePartialBubble) {
          drawPartialResidualBubble(bubblePlotState.bubbleResult.studiesUsed, bubblePlotState.bubbleResult, mod, wrap, { theme });
        } else {
          drawBubble(bubblePlotState.bubbleResult.studiesUsed, bubblePlotState.bubbleResult, mod, wrap, { theme });
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
        if (bubblePlotState.usePartialBubble) {
          const note = document.createElement("p");
          note.className = "reg-note";
          note.textContent = "Partial residual plot — other predictors held at zero (residuals).";
          wrap.appendChild(note);
        }
      });
    }
  }
  if (robPlotState.studies && robPlotState.domains.length > 0) {
    drawRoBTrafficLight(robPlotState.studies, robPlotState.domains, robPlotState.data, { theme });
    drawRoBSummary(robPlotState.studies, robPlotState.domains, robPlotState.data, { theme });
  }
}

document.querySelectorAll(".funnel-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!funnelPlot.args) return;
    funnelPlot.contours = btn.dataset.mode === "contour";
    document.querySelectorAll(".funnel-mode-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-pressed", String(b === btn));
    });
    drawFunnel(...funnelPlot.args, { egger: funnelPlot.egger, contours: funnelPlot.contours, petpeese: funnelPlot.petpeese, theme: appState.plotTheme });
  });
});

function _updateCumFunnelLabel(stepIdx) {
  const r = cumFunnelPlot.results[stepIdx];
  document.getElementById("cumulativeFunnelLabel").textContent =
    `Step ${stepIdx + 1} of ${cumFunnelPlot.results.length}\u2003added: ${r.addedLabel}`;
}

const renderForestNav = makeNavRenderer({
  navId:   "forestNav",
  prevId:  "forestPrev",
  nextId:  "forestNext",
  note:    k => `Pooled estimate includes all ${k} studies`,
  getKAll: () => forestPlot.args?.studies?.length ?? "?",
  getPage: () => forestPlot.page,
  setPage: p  => { forestPlot.page = p; },
  redraw:  p  => drawForest(forestPlot.args.studies, forestPlot.args.m, { ...forestPlot.args.options, page: p, theme: appState.plotTheme }),
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
    { pageSize: caterpillarPlot.args.pageSize, page: p, theme: appState.plotTheme }
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
  redraw:  p  => drawBlupPlot(blupPlot.result, blupPlot.profile, { pageSize: blupPlot.pageSize, page: p, theme: appState.plotTheme }),
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
    { pageSize: cumForestPlot.args.pageSize, page: p, theme: appState.plotTheme }
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
    drawGoshPlot(result, profile, { xAxis, theme: appState.plotTheme });
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
const permState = { worker: null, lastResult: null, lastReg: null };

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
  permState.lastResult = null;
  permState.lastReg    = null;
}

function _startPermTest() {
  if (!appState.results.reg || appState.results.reg.rankDeficient) return;
  const reg = appState.results.reg;

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
    permState.lastResult = result;
    permState.lastReg    = reg;
    if (appState.reportArgs) {
      appState.reportArgs = { ...appState.reportArgs, permResult: result };
    }
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
          isMHorPeto, hasClusters, rveRho, rveMode, threeLevelMethod } = opts;

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

  const mAdjusted = (useTF && useTFAdjusted)
    ? (tf.length > 0 ? meta([...studies, ...tf], method, ciMethod, alpha) : m)
    : null;

  const rveResult = (hasClusters && !isMHorPeto)
    ? rvePooled(studies, { rho: rveRho, alpha, omega2: rveMode === "hier" ? "MoM" : 0 })
    : null;

  const threeLevelResult = (hasClusters && !isMHorPeto)
    ? meta3level(studies, { method: threeLevelMethod ?? "REML", alpha })
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
  const { alpha, selModeVal, selPreset, selWeightFn, selSides, selCuts,
          fsnTrivial = 0.1, fsnDirection = "auto" } = opts;

  const egger    = eggerTest(studies);
  const begg     = beggTest(studies);
  const petpeese = petPeeseTest(studies);
  const fatpet   = petpeese.fat;
  const fsn      = failSafeN(studies, alpha, fsnTrivial, fsnDirection);
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
    reg = metaRegression(studies, modSpec, method, ciMethod, { alpha, interactions: interactionSpec });
  }
  return { subgroup, reg, ls };
}

function _animateFresh(el) {
  if (!el) return;
  el.classList.remove("results-fresh");
  void el.offsetWidth;
  el.classList.add("results-fresh");
}

// ── Pooled-panel sub-functions (called from _renderAllResults) ────────────────

function _renderRveThreeLevel(ctx) {
  const { profile, m, rveResult, threeLevelResult } = ctx;
  const { alpha, hasClusters, isMHorPeto } = ctx.opts;

  // RVE section
  {
    const elRve         = document.getElementById("rveSection");
    const elRveSummary  = document.getElementById("rveSummary");
    const elRveEmpty    = document.getElementById("rveEmptyState");
    const elRveSettings = document.getElementById("rveSettings");
    const showRve = hasClusters && !isMHorPeto;
    if (elRveSettings) setVisible(elRveSettings, showRve);
    if (elRve) {
      if (showRve && rveResult) {
        if (elRveEmpty) elRveEmpty.style.display = "none";
        if (rveResult.error) {
          elRveSummary.innerHTML = `<p class="reg-note" style="color:var(--color-warning)">⚠ RVE: ${escapeHTML(rveResult.error)}</p>`;
        } else {
          const rveEst  = profile.transform(rveResult.est);
          const rveLo   = profile.transform(rveResult.ci[0]);
          const rveHi   = profile.transform(rveResult.ci[1]);
          const reDisp  = profile.transform(m.RE);
          const diffDir = rveResult.est > m.RE ? "higher" : rveResult.est < m.RE ? "lower" : "equal";
          const rveMode = ctx.opts.rveMode;
          const rveRho  = ctx.opts.rveRho;
          const rveLine3 = rveMode === "hier"
            ? `HIER MoM &nbsp;·&nbsp; ω²=${fmt(rveResult.omega2)} &nbsp;·&nbsp; τ²=${fmt(rveResult.tau2)} &nbsp;·&nbsp; m=${rveResult.kCluster} cluster${rveResult.kCluster === 1 ? "" : "s"} &nbsp;·&nbsp; k=${rveResult.k} studies`
            : `ρ=${rveRho.toFixed(2)} &nbsp;·&nbsp; m=${rveResult.kCluster} cluster${rveResult.kCluster === 1 ? "" : "s"} &nbsp;·&nbsp; k=${rveResult.k} studies`;
          elRveSummary.innerHTML = `
            <div style="font-size:0.8125rem;line-height:1.9;margin-bottom:8px">
              ${hBtn("rve.model")}<b>RVE pooled estimate:</b> ${fmt(rveEst)}<br>
              CI [${fmt(rveLo)}, ${fmt(rveHi)}] | SE = ${fmt(rveResult.se)} | <em>t</em>(${rveResult.df}) = ${fmt(rveResult.t)} | <em>p</em> ${fmtPval(rveResult.p)}<br>
              ${rveLine3}<br>
              <span style="color:var(--fg-muted);font-size:0.93em">RE (cluster-robust): ${fmt(reDisp)} &nbsp;·&nbsp; RVE estimate is ${diffDir}.</span>
            </div>
          `;
        }
      } else {
        if (elRveEmpty) elRveEmpty.style.display = "";
        elRveSummary.innerHTML = "";
      }
    }
  }

  // Three-level section
  {
    const elThree        = document.getElementById("threeLevelSection");
    const elThreeSummary = document.getElementById("threeLevelSummary");
    const elThreeEmpty   = document.getElementById("threeLevelEmptyState");
    const showThree = hasClusters && !isMHorPeto;
    if (elThree) {
      if (showThree && threeLevelResult) {
        if (elThreeEmpty) elThreeEmpty.style.display = "none";
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
              ${hBtn("het.Q")}<em>Q</em>(${tl.df}) = ${fmt(tl.Q)} | method=${ctx.opts.threeLevelMethod ?? "REML"}<br>
              LL = ${fmt(tl.logLikFull ?? tl.logLik)} (${ctx.opts.threeLevelMethod ?? "REML"})
            </div>
          `;
        }
      } else {
        if (elThreeEmpty) elThreeEmpty.style.display = "";
        elThreeSummary.innerHTML = "";
      }
    }
  }
}

function _renderPooledPanel(ctx) {
  const { profile, m, studies, bayesResult, profileLikResult, reMeanRef,
          missingCorrelation, type, mAdjusted, tf } = ctx;
  const { alpha, isMHorPeto, hasClusters, bayesMu0, bayesSigmaMu, bayesSigmaTau,
          tfEstimator, useTF } = ctx.opts;

  // ── Profile likelihood ───────────────────────────────────────────────────────
  const elHetDiag        = document.getElementById("hetDiagSection");
  const elProfileLikScale = document.getElementById("profileLikScale");
  if (profileLikResult && !profileLikResult.error) {
    elHetDiag.style.display = "";
    drawProfileLikTau2(profileLikResult, { xScale: elProfileLikScale?.value || "tau2", theme: appState.plotTheme });
  } else {
    elHetDiag.style.display = "none";
  }

  // ── Bayesian ─────────────────────────────────────────────────────────────────
  const elBayes = document.getElementById("bayesSection");
  if (bayesResult && !bayesResult.error) {
    bayesState.studies = studies;
    bayesState.result  = bayesResult;
    bayesState.reMean  = reMeanRef;
    bayesState.profile = profile;
    elBayes.style.display = "";
    const bayesClusterNote = hasClusters
      ? `<p class="reg-note" style="color:var(--muted);margin:0 0 6px">ℹ Bayesian analysis does not incorporate cluster-robust adjustment.</p>`
      : "";
    document.getElementById("bayesSummary").innerHTML =
      bayesClusterNote + buildBayesSummaryHTML(bayesResult, profile, reMeanRef, alpha);
    drawBayesMuPosterior(bayesResult, { reMean: reMeanRef, theme: appState.plotTheme });
    drawBayesTauPosterior(bayesResult, { theme: appState.plotTheme });
    document.getElementById("bayesGridWarning").style.display =
      bayesResult.grid_truncated ? "" : "none";
    const ciLevel = document.getElementById("ciLevel")?.value ?? "95";
    renderSensitivity(bayesMu0, bayesSigmaMu, bayesSigmaTau, ciLevel);
  } else {
    bayesState.studies = null;
    bayesState.result  = null;
    elBayes.style.display = "none";
    const elSensSection = document.getElementById("bayesSensitivitySection");
    if (elSensSection) elSensSection.style.display = "none";
  }

  // ── RVE + three-level ────────────────────────────────────────────────────────
  _renderRveThreeLevel(ctx);

  // ── Pooled estimate panel ────────────────────────────────────────────────────
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

  const ciLbl = Math.round((1 - alpha) * 100) + "% CI";
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
  document.getElementById("results").innerHTML = warningHTML + clusterBanner + (isMHorPeto ? `
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
      <div class="result-het-stats">τ²=${fmt(m.tau2)} [${fmt(m.tauCI[0])}, ${isFinite(m.tauCI[1])?fmt(m.tauCI[1]):"∞"}]${hBtn("het.tau2")}${m.tau2Converged === false ? ' <span class="badge-warn" title="τ² estimator did not converge within the iteration limit">(did not converge)</span>' : ""} &nbsp;·&nbsp; <em>I</em>²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%]${hBtn("het.I2")} &nbsp;·&nbsp; <em>H</em>²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]${hBtn("het.H2")}</div>
      <div class="result-het-stats result-het-test"><em>Q</em>(${m.df}) = ${fmt(m.Q)}, <em>p</em> ${fmtPval(m.df > 0 ? 1 - chiSquareCDF(m.Q, m.df) : NaN)}${hBtn("het.Q")}</div>
    </div>
  `);
}

function _renderPubBiasPanel(ctx) {
  const { profile, m, egger, begg, fatpet, petpeese, fsn, tes, waap, hc,
          harbord, peters, deeks, ruecker, mAdjusted, tf } = ctx;
  const { alpha, tfEstimator, useTF, fsnTrivial = 0.1, fsnDirection = "auto" } = ctx.opts;

  const eggerRobustNote  = egger.clustersUsed  ? ` | <em>p</em><sub>robust</sub> ${isFinite(egger.robustInterceptP)  ? fmtPval(egger.robustInterceptP)  : "= —"}` : "";
  const fatpetRobustNote = fatpet.clustersUsed ? ` | <em>p</em><sub>FAT,rob</sub> ${isFinite(fatpet.robustSlopeP) ? fmtPval(fatpet.robustSlopeP) : "= —"} · <em>p</em><sub>PET,rob</sub> ${isFinite(fatpet.robustInterceptP) ? fmtPval(fatpet.robustInterceptP) : "= —"}` : "";

  const ciPct    = `${Math.round((1 - alpha) * 100)}% CI`;
  const eggerTC  = isFinite(egger.df)  ? tCritical(egger.df,  alpha) : NaN;
  const fatpetTC = isFinite(fatpet.df) ? tCritical(fatpet.df, alpha) : NaN;

  const eggerStats = isFinite(egger.intercept)
    ? `intercept = ${fmt(egger.intercept)}, SE = ${fmt(egger.se)}, ${ciPct} [${fmt(egger.intercept - eggerTC * egger.se)}, ${fmt(egger.intercept + eggerTC * egger.se)}], <em>t</em>(${egger.df}) = ${fmt(egger.t)}, <em>p</em> ${fmtPval(egger.p)}`
    : `intercept (k&lt;3)`;

  const beggStats = isFinite(begg.tau)
    ? `τ = ${fmt(begg.tau)}, <em>z</em> = ${fmt(begg.z)}, <em>p</em> ${fmtPval(begg.p)}`
    : `τ (k&lt;3)`;

  const fatStats = isFinite(fatpet.slope)
    ? `β₁ = ${fmt(fatpet.slope)}, SE = ${fmt(fatpet.slopeSE)}, <em>t</em>(${fatpet.df}) = ${fmt(fatpet.slopeT)}, <em>p</em> ${fmtPval(fatpet.slopeP)}`
    : `β₁ (k&lt;3)`;

  const petStats = (() => {
    if (!isFinite(fatpet.intercept)) return `(k&lt;3)`;
    if (!isFinite(fatpetTC)) return `${fmt(profile.transform(fatpet.intercept))}, <em>p</em> ${fmtPval(fatpet.interceptP)}`;
    const lo = fmt(profile.transform(fatpet.intercept - fatpetTC * fatpet.interceptSE));
    const hi = fmt(profile.transform(fatpet.intercept + fatpetTC * fatpet.interceptSE));
    return `${fmt(profile.transform(fatpet.intercept))}, SE = ${fmt(fatpet.interceptSE)}, ${ciPct} [${lo}, ${hi}], <em>t</em>(${fatpet.df}) = ${fmt(fatpet.interceptT)}, <em>p</em> ${fmtPval(fatpet.interceptP)}`;
  })();

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

  const waapZ     = normalQuantile(1 - alpha / 2);
  const waapStats = (() => {
    if (!isFinite(waap.estimate)) return `NA (k&lt;1)`;
    const lo = fmt(profile.transform(waap.estimate - waapZ * waap.se));
    const hi = fmt(profile.transform(waap.estimate + waapZ * waap.se));
    const fb = waap.fallback ? ` <span style='color:var(--fg-muted)'>(fallback to WLS)</span>` : "";
    return `${fmt(profile.transform(waap.estimate))}, SE = ${fmt(waap.se)}, ${ciPct} [${lo}, ${hi}], <em>z</em> = ${fmt(waap.z)}, <em>p</em> ${fmtPval(waap.p)} | k<sub>adequate</sub> = ${waap.kAdequate}/${waap.k}${fb}`;
  })();

  const hcStats = hc.error
    ? `NA (${escapeHTML(hc.error)})`
    : `${fmt(profile.transform(hc.beta))}, SE = ${fmt(hc.se)}, 95% CI [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}] (DL τ² = ${fmt(hc.tau2)})`;

  document.getElementById("pubBiasStats").innerHTML = `
    &nbsp;&nbsp;${hBtn("bias.egger")}Egger: ${eggerStats}${eggerRobustNote}<br>
    &nbsp;&nbsp;${hBtn("bias.begg")}Begg: ${beggStats}<br>
    &nbsp;&nbsp;${hBtn("bias.fatpet")}FAT (bias): ${fatStats} &nbsp;·&nbsp; PET (effect at SE→0): ${petStats}${fatpetRobustNote}<br>
    &nbsp;&nbsp;${hBtn("bias.petpeese")}${petpeese.usePeese?"<b>":""}PET-PEESE (corrected): ${ppStats}${petpeese.usePeese?"</b>":""}<br>
    &nbsp;&nbsp;${hBtn("bias.fsn")}Fail-safe N (Rosenthal): ${isFinite(fsn.rosenthal)?Math.round(fsn.rosenthal):"NA"} &nbsp;·&nbsp; Orwin (trivial=${fsnTrivial}, dir=${fsnDirection}): ${isFinite(fsn.orwin)?Math.round(fsn.orwin):"NA"}<br>
    &nbsp;&nbsp;${hBtn("bias.tes")}TES: O = ${isFinite(tes.O)?tes.O:"NA"} | E = ${isFinite(tes.E)?fmt(tes.E):"NA"} | χ²(k−1) = ${isFinite(tes.chi2)?fmt(tes.chi2):"NA (k<2)"} | ${isFinite(tes.p)?`<em>p</em> ${fmtPval(tes.p)}`:"<em>p</em> (k<2)"}${isFinite(tes.p)&&tes.p<0.1?" <span style='color:var(--color-warning)'>⚠ excess</span>":""}<br>
    &nbsp;&nbsp;${hBtn("bias.waap")}WAAP-WLS: ${waapStats}<br>
    &nbsp;&nbsp;${hBtn("bias.hc")}Henmi-Copas: ${hcStats}<br>
    <b>Trim &amp; Fill:</b>${hBtn("bias.trimfill")} ${useTF ? (() => {
      const k0Line = `k₀ = ${tf.length} (${tfEstimator} estimator)`;
      const adjLine = mAdjusted
        ? `, adjusted RE = ${fmt(profile.transform(mAdjusted.RE))}, SE = ${fmt(mAdjusted.seRE)}, τ² = ${fmt(mAdjusted.tau2)}, 95% CI [${fmt(profile.transform(mAdjusted.ciLow))}, ${fmt(profile.transform(mAdjusted.ciHigh))}]`
        : "";
      return k0Line + adjLine;
    })() : "OFF"}
    <details style="margin-top:4px">
      <summary style="cursor:pointer;color:var(--fg-muted);font-size:0.9em">Additional regression tests (binary outcomes)</summary>
      <div style="margin-top:4px">
        ${[
          ["bias.harbord", "Harbord",  harbord,  "k&lt;3 or no 2×2 counts"],
          ["bias.peters",  "Peters",   peters,   "k&lt;3 or no sample sizes"],
          ["bias.deeks",   "Deeks",    deeks,    "k&lt;3 or no 2×2 counts"],
          ["bias.ruecker", "Rücker", ruecker,  "k&lt;3 or no 2×2 counts"],
        ].map(([key, name, r, naMsg]) =>
          `&nbsp;&nbsp;${hBtn(key)}${name}: intercept = ${isFinite(r.intercept)?fmt(r.intercept):"NA"} | <em>p</em> ${isFinite(r.interceptP)?fmtPval(r.interceptP):`NA (${naMsg})`}`
        ).join("<br>\n        ")}
      </div>
    </details>
  `;
  _animateFresh(document.getElementById("results"));
}

function _renderForestAndBubbles(ctx) {
  const { profile, m, studies, all, type, reg, ls, egger, petpeese,
          influence, baujatResult, blupResult, qqResiduals, qqLabels,
          cumResults, cumulativeStudies, excluded, softWarnings,
          tf, begg, fatpet, fsn, tes, waap, hc,
          harbord, peters, deeks, ruecker, selResult,
          rveResult, threeLevelResult, bayesResult, profileLikResult,
          pcurve, puniform, subgroup } = ctx;
  const { mAdjusted } = ctx;
  const { method, ciMethod, alpha, isMHorPeto, hasClusters, useTF,
          selModeVal, selWeightFn } = ctx.opts;

  // ── Bubble plots ─────────────────────────────────────────────────────────────
  const bubbleContainer = document.getElementById("bubblePlots");
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
  bubblePlotState.bubbleResult     = (bubbleResult && !bubbleResult.rankDeficient) ? bubbleResult : null;
  bubblePlotState.moderators       = moderators.filter(mod => mod.type === "continuous");
  bubblePlotState.usePartialBubble = usePartialBubble;

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
          drawPartialResidualBubble(bubbleResult.studiesUsed, bubbleResult, mod, wrap, { theme: appState.plotTheme });
        } else {
          drawBubble(bubbleResult.studiesUsed, bubbleResult, mod, wrap, { theme: appState.plotTheme });
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

  // ── Forest plot ───────────────────────────────────────────────────────────────
  const elForestPageSize = document.getElementById("forestPageSize");
  const rawPageSize = elForestPageSize?.value ?? "30";
  const pageSize    = rawPageSize === "all" ? Infinity : +rawPageSize;
  const forestOpts  = { ciMethod, profile, pageSize, pooledDisplay: forestPlot.poolDisplay, theme: appState.plotTheme, alpha, ciLabel: Math.round((1 - alpha) * 100) + "% CI" };
  const mForest     = isMHorPeto
    ? { ...m, RE: m.FE, seRE: m.seFE, tau2: 0, predLow: NaN, predHigh: NaN }
    : m;
  forestPlot.args = { studies: all, m: mForest, options: forestOpts };
  performance.mark("phase:plot:forest:start");
  const { totalPages } = drawForest(all, mForest, { ...forestOpts, page: forestPlot.page });
  performance.measure("phase:plot:forest", "phase:plot:forest:start");
  renderForestNav(totalPages);

  // ── Report args cache ─────────────────────────────────────────────────────────
  const elSelPreset       = document.getElementById("selPreset");
  const elProfileLikScale = document.getElementById("profileLikScale");
  const SMD_TYPES_REP = new Set(["SMD","SMDH","SMD_paired","SMD1","SMD1H","SMCC"]);
  const cles = SMD_TYPES_REP.has(type) ? clES(m.RE, [m.ciLow, m.ciHigh]) : null;
  const _selPreset = elSelPreset.value;
  const _selLabel  = selModeVal === "mle"
    ? "MLE"
    : _selPreset !== "custom"
      ? (SELECTION_PRESETS[_selPreset]?.label ?? _selPreset)
      : "Custom";

  appState.reportArgs = {
    studies: all, m, profile, reg, ls,
    tf, egger, begg, fatpet, petpeese, fsn, tes, waap, cles, pcurve, puniform,
    harbord, peters, deeks, ruecker, hc, baujatResult,
    influence, subgroup, method, ciMethod,
    rveResult, threeLevelResult,
    rveRho:           parseFloat(document.getElementById("rveRho")?.value ?? 0.8),
    rveMode:          document.getElementById("rveWeighting")?.value ?? "corr",
    threeLevelMethod: document.getElementById("threeLevelMethod")?.value ?? "REML",
    fsnTrivial, fsnDirection,
    permResult: permState.lastResult ?? null,
    ciLevel:   document.getElementById("ciLevel")?.value   ?? "95",
    mccMethod: document.getElementById("mccMethod")?.value ?? "none",
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

  // ── Funnel plot ───────────────────────────────────────────────────────────────
  funnelPlot.args = [all, m, profile];
  funnelPlot.egger = egger;
  funnelPlot.petpeese = petpeese;
  drawIfVisible("pubBiasSection", () => {
    performance.mark("phase:plot:funnel:start");
    drawFunnel(...funnelPlot.args, { egger: funnelPlot.egger, contours: funnelPlot.contours, petpeese: funnelPlot.petpeese, theme: appState.plotTheme });
    performance.measure("phase:plot:funnel", "phase:plot:funnel:start");
  });

  // ── BLUPs, Baujat, QQ, Radial, L'Abbé ────────────────────────────────────────
  const labbeTypes  = ["OR", "RR", "RD"];
  const showLabbe   = labbeTypes.includes(type);
  const showQQ      = qqResiduals.length >= 3;

  blupPlot.result   = blupResult;
  blupPlot.profile  = profile;
  blupPlot.page     = 0;
  const elBlupPageSize  = document.getElementById("blupPageSize");
  const rawBlupPageSize = elBlupPageSize?.value ?? "30";
  blupPlot.pageSize = rawBlupPageSize === "all" ? Infinity : +rawBlupPageSize;
  document.getElementById("blupBlock").style.display       = blupResult ? "" : "none";
  document.getElementById("baujatPlotBlock").style.display = baujatResult ? "" : "none";
  document.getElementById("qqPlotBlock").style.display     = showQQ ? "" : "none";
  document.getElementById("radialPlotBlock").style.display = studies.length >= 2 && !isMHorPeto ? "" : "none";
  document.getElementById("labbeBlock").style.display      = showLabbe ? "" : "none";

  Object.assign(diagnosticsState, {
    influence, baujatResult, profile,
    qqResiduals, qqLabels,
    studies, m, type,
    showQQ, showLabbe, isMHorPeto,
  });

  drawIfVisible("diagnosticSection", () => {
    performance.mark("phase:plot:influence:start");
    drawInfluencePlot(influence, { theme: appState.plotTheme });
    if (blupResult) {
      const { totalPages: blupPages } = drawBlupPlot(blupResult, profile, { pageSize: blupPlot.pageSize, page: 0, theme: appState.plotTheme });
      renderBlupNav(blupPages);
    }
    drawBaujatPlot(baujatResult, profile, { theme: appState.plotTheme });
    if (showQQ)  drawQQPlot(qqResiduals, qqLabels, { theme: appState.plotTheme });
    if (studies.length >= 2 && !isMHorPeto) drawRadialPlot(studies, m, profile, { theme: appState.plotTheme });
    if (showLabbe) drawLabbe(studies, m, profile, { type, theme: appState.plotTheme });
    performance.measure("phase:plot:influence", "phase:plot:influence:start");
  });

  // ── Cumulative meta-analysis ──────────────────────────────────────────────────
  const elCumForestPageSize = document.getElementById("cumulativeForestPageSize");
  const elCumFunnelStep     = document.getElementById("cumulativeFunnelStep");
  const elCumFunnelBlock    = document.getElementById("cumulativeFunnelBlock");
  const rawCumPageSize    = elCumForestPageSize?.value ?? "30";
  const cumForestPageSize = rawCumPageSize === "all" ? Infinity : +rawCumPageSize;
  const ciLabel = Math.round((1 - alpha) * 100) + "% CI";
  cumForestPlot.args          = { results: cumResults, profile, pageSize: cumForestPageSize, alpha, ciLabel };
  cumForestPlot.sourceStudies = studies.slice();
  cumForestPlot.method        = method;
  cumForestPlot.ciMethod      = ciMethod;
  cumForestPlot.alpha         = alpha;
  appState.reportArgs.cumForestOptions = { results: cumResults, profile, pageSize: cumForestPageSize, currentPage: 0, alpha, ciLabel };

  cumFunnelPlot.studies = cumulativeStudies;
  cumFunnelPlot.results = cumResults;
  cumFunnelPlot.profile = profile;
  elCumFunnelStep.max   = cumResults.length - 1;
  elCumFunnelStep.value = cumResults.length - 1;
  _updateCumFunnelLabel(cumResults.length - 1);
  elCumFunnelBlock.style.display = "";

  drawIfVisible("cumulativeSection", () => {
    performance.mark("phase:plot:cumulative:start");
    const { totalPages: cumForestPages } = drawCumulativeForest(cumResults, profile, { pageSize: cumForestPageSize, page: 0, theme: appState.plotTheme });
    renderCumulativeForestNav(cumForestPages);
    drawCumulativeFunnel(cumulativeStudies, cumResults, profile, cumResults.length - 1, { theme: appState.plotTheme });
    performance.measure("phase:plot:cumulative", "phase:plot:cumulative:start");
  });

  // ── Orchard + caterpillar plots ───────────────────────────────────────────────
  const elCatPageSize      = document.getElementById("caterpillarPageSize");
  const elCaterpillarBlock = document.getElementById("caterpillarPlotBlock");
  document.getElementById("orchardPlotBlock").style.display = "";
  caterpillarPlot.page = 0;
  const rawCatPageSize = elCatPageSize?.value ?? "30";
  const catPageSize    = rawCatPageSize === "all" ? Infinity : +rawCatPageSize;
  caterpillarPlot.args = { studies: all, m, profile, pageSize: catPageSize };
  elCaterpillarBlock.style.display = "";
  appState.reportArgs.caterpillarOptions = { studies: all, m, profile, pageSize: catPageSize, currentPage: 0 };

  drawIfVisible("altVizSection", () => {
    performance.mark("phase:plot:orchard:start");
    drawOrchardPlot(all, m, profile, { theme: appState.plotTheme });
    const { totalPages: catPages } = drawCaterpillarPlot(all, m, profile, { pageSize: catPageSize, page: 0, theme: appState.plotTheme });
    renderCaterpillarNav(catPages);
    performance.measure("phase:plot:orchard", "phase:plot:orchard:start");
  });

  // ── Risk-of-bias plots ────────────────────────────────────────────────────────
  const elRobSection = document.getElementById("robSection");
  const hasRoB = robPlotState.domains.length > 0 && studies.length > 0;
  elRobSection.style.display = hasRoB ? "" : "none";
  if (hasRoB) {
    robPlotState.studies = studies;
    drawIfVisible("robSection", () => {
      drawRoBTrafficLight(studies, robPlotState.domains, robPlotState.data, { theme: appState.plotTheme });
      drawRoBSummary(studies, robPlotState.domains, robPlotState.data, { theme: appState.plotTheme });
    });
  }

  // ── Validation warnings + run-state badges ────────────────────────────────────
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

// ── All DOM writes: renders every output panel from computed results ──────────
function _renderAllResults(ctx) {
  const { type, profile, studies, all, m,
          influence, subgroup, reg, ls,
          pcurve, puniform, selResult } = ctx;
  const { method, ciMethod, alpha, isMHorPeto, hasClusters,
          selModeVal, selWeightFn } = ctx.opts;

  _renderPooledPanel(ctx);
  _renderPubBiasPanel(ctx);

  // ── Influence diagnostics + subgroup ─────────────────────────────────────────
  const elInfluenceDiagTable = document.getElementById("influenceDiagTable");
  const elSubgroupSection    = document.getElementById("subgroupSection");
  const elSubgroupTable      = document.getElementById("subgroupTable");
  const influenceOpen = elInfluenceDiagTable.querySelector(".sens-block")?.open ?? true;
  const influenceHTML = buildInfluenceHTML(influence, influenceOpen);
  const hasSubgroup   = subgroup && subgroup.G >= 2;
  const subgroupHTML  = hasSubgroup ? buildSubgroupHTML(subgroup, profile, hasClusters) : "";
  elInfluenceDiagTable.innerHTML = influenceHTML;
  elInfluenceDiagTable.querySelectorAll(".sens-summary").forEach(summary => {
    summary.addEventListener("click", e => { if (e.target.closest(".help-btn")) e.preventDefault(); });
  });
  elSubgroupSection.style.display = hasSubgroup ? "" : "none";
  elSubgroupTable.innerHTML = (hasSubgroup && isMHorPeto)
    ? `<p class="reg-note" style="margin:4px 0 8px">⚠ Subgroup pooling uses inverse-variance (DL) weights — switch to DL or REML for M-H subgroup analysis.</p>` + subgroupHTML
    : subgroupHTML;
  renderStudyTable(all, m, profile, alpha);
  _animateFresh(document.getElementById("studyTable"));

  // ── Sensitivity panel (LOO) + p-curve + selection model ─────────────────────
  performance.mark("phase:loo:render:start");
  renderSensitivityPanel(studies, isMHorPeto ? null : m, isMHorPeto ? "DL" : method, ciMethod, profile, alpha, { isMHFallback: isMHorPeto });
  performance.measure("phase:loo:render", "phase:loo:render:start");
  pCurvePlot.result = pcurve;
  pUniformPlot.result = puniform; pUniformPlot.m = m; pUniformPlot.profile = profile;
  renderPCurvePanel(pcurve, { theme: appState.plotTheme });
  renderPUniformPanel(puniform, m, profile, { theme: appState.plotTheme });
  renderSelectionModelPanel(selResult, selModeVal, selWeightFn, profile);

  // ── Regression panel ─────────────────────────────────────────────────────────
  const kExcluded = (reg ?? ls) ? studies.length - (reg ?? ls).k : 0;
  if (ls) {
    appState.results.reg = null;
    appState.results.ls  = ls.rankDeficient ? null : ls;
    renderLocationScalePanel(ls, ciMethod, kExcluded, alpha);
  } else {
    appState.results.ls  = null;
    appState.results.reg = (reg && !reg.rankDeficient) ? reg : null;
    const _allTermMods = [...moderators, ...interactions.map(ix => ({ name: ix.name }))];
    renderRegressionPanel(reg ?? {}, method, ciMethod, kExcluded, _allTermMods, alpha);
    const elPermSection = document.getElementById("permSection");
    if (elPermSection) {
      elPermSection.style.display = appState.results.reg ? "" : "none";
      _clearPermResults();
    }
  }

  _renderForestAndBubbles(ctx);
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
    if (mvState.active) {
      const ok = runMVAnalysis();
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
    const { studies, excluded, softWarnings, missingCorrelation } = collectStudies(type, scaleModerators);
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
      _toggleResults.removeAttribute("aria-disabled");
      _toggleResults.removeAttribute("title");
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
    const rveRho             = parseFloat(document.getElementById("rveRho")?.value) || 0.8;
    const rveMode            = document.getElementById("rveWeighting")?.value ?? "corr";
    const threeLevelMethod   = document.getElementById("threeLevelMethod")?.value ?? "REML";
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
    const selCuts = rawSelCuts.length >= 2 && Math.abs(rawSelCuts[rawSelCuts.length - 1] - 1) < 1e-9
      ? rawSelCuts
      : [...rawSelCuts.filter(c => c < 1), 1.0];

    // Bayesian prior settings
    const bayesMu0      = parseFloat(document.getElementById("bayesMu0")?.value)      || 0;
    const bayesSigmaMu  = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaMu")?.value)  || 1);
    const bayesSigmaTau = Math.max(0.01, parseFloat(document.getElementById("bayesSigmaTau")?.value) || 0.5);

    // Fail-safe N settings
    const fsnTrivial   = Math.max(0.001, parseFloat(document.getElementById("fsnTrivial")?.value) || 0.1);
    const fsnDirection = document.getElementById("fsnDirection")?.value ?? "auto";

    const opts = {
      method, ciMethod, alpha, type, useTF, tfEstimator, useTFAdjusted,
      isMHorPeto, hasClusters, rveRho, rveMode, threeLevelMethod, modSpec, scaleModSpec, interactionSpec, cumulativeOrder,
      selModeVal, selPreset, selWeightFn, selSides, selCuts,
      bayesMu0, bayesSigmaMu, bayesSigmaTau,
      fsnTrivial, fsnDirection,
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
    if (_runBtn)     { _runBtn.disabled = false; _runBtn.textContent = 'Run'; }
    if (_runProgress) _runProgress.hidden = true;
  }
}
