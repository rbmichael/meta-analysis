// =============================================================================
// onboarding.js — First-visit inline tour (Steps: effect type → columns → Run)
// =============================================================================
// Leaf module: no imports from ui.js. Lazy-loaded by ui.js after first paint.
// Storage key: localStorage["fosma-onboarding-seen"] = "1"
//   Set on tour completion or dismissal. Cleared externally for replay.
//
// DOM elements (injected at runtime, all removed on teardown):
//   #onboardingBlock     — fixed inset-0 transparent div; blocks backdrop clicks
//   #onboardingSpotlight — fixed over target; box-shadow creates the dim veil;
//                          2px accent border rings the spotlight
//   .onboarding-tip      — fixed tip card adjacent to the spotlighted element
// =============================================================================

const SEEN_KEY  = "fosma-onboarding-seen";
const DRAFT_KEY = "meta-draft";
const PAD       = 4;    // px padding around the target element
const TIP_W     = 320;  // tip card width (matches CSS)
const MIN_TIP_H = 160;  // lower-bound estimate for placement; actual height wins
const GAP       = 12;   // gap between spotlight edge and tip card

// ---------------------------------------------------------------------------
// Tour steps
// ---------------------------------------------------------------------------

const STEPS = [
  {
    anchor: "#effectType",
    title:  "Pick an effect type",
    body:   "45 options grouped by data shape — means, binary outcomes, correlations, and more. Choose the one that matches how your studies report results.",
  },
  {
    anchor: "#inputTable tr",
    title:  "Fill the columns",
    body:   "The table adapts its columns to match the effect type. Hover any column header for a description of what goes there.",
  },
  {
    anchor: "#run",
    title:  "Run the analysis",
    body:   "Click Run — or press Ctrl+Enter — once the table is filled. Results appear in the Results tab.",
  },
];

// ---------------------------------------------------------------------------
// Module-level state (reset on teardown)
// ---------------------------------------------------------------------------

let _block     = null;   // click-blocking overlay
let _spot      = null;   // spotlight ring + box-shadow veil
let _tip       = null;   // tip card container
let _current   = null;   // current target element
let _rafId     = null;   // pending rAF for reposition
let _stepIdx   = 0;      // current step index
let _prevFocus = null;   // element focused before tour started; restored on exit

// Tip card inner elements (populated by _createDOM, updated by _goTo)
let _liveEl    = null;
let _titleEl   = null;
let _bodyEl    = null;
let _counterEl = null;
let _btnBack   = null;
let _btnNext   = null;
let _btnSkip   = null;

// ---------------------------------------------------------------------------
// DOM creation (idempotent — safe to call multiple times)
// ---------------------------------------------------------------------------

function _createDOM() {
  if (_block) return;

  _block = document.createElement("div");
  _block.id = "onboardingBlock";
  _block.setAttribute("aria-hidden", "true");
  _block.style.display = "none";

  _spot = document.createElement("div");
  _spot.id = "onboardingSpotlight";
  _spot.setAttribute("aria-hidden", "true");
  _spot.style.display = "none";

  _tip = document.createElement("div");
  _tip.className = "onboarding-tip";
  _tip.setAttribute("role", "dialog");
  _tip.setAttribute("aria-modal", "true");
  _tip.setAttribute("aria-labelledby", "onbTitle");
  _tip.style.display = "none";

  // Hidden aria-live region — text set on each step change so SRs re-announce.
  _liveEl = document.createElement("p");
  _liveEl.id = "onbLive";
  _liveEl.setAttribute("aria-live", "polite");
  _liveEl.className = "onb-live";

  _titleEl = document.createElement("h3");
  _titleEl.id = "onbTitle";
  _titleEl.className = "onb-title";

  _bodyEl = document.createElement("p");
  _bodyEl.className = "onb-body";

  _counterEl = document.createElement("span");
  _counterEl.className = "onb-counter";

  _btnBack = document.createElement("button");
  _btnBack.type = "button";
  _btnBack.className = "onb-btn onb-btn-back";
  _btnBack.textContent = "Back";
  _btnBack.setAttribute("aria-label", "Go to previous step");
  _btnBack.onclick = () => prev();

  _btnNext = document.createElement("button");
  _btnNext.type = "button";
  _btnNext.className = "onb-btn onb-btn-next";
  _btnNext.textContent = "Next";
  _btnNext.setAttribute("aria-label", "Go to next step");
  _btnNext.onclick = () => next();

  _btnSkip = document.createElement("button");
  _btnSkip.type = "button";
  _btnSkip.className = "onb-btn onb-btn-skip";
  _btnSkip.textContent = "Skip";
  _btnSkip.setAttribute("aria-label", "Skip the tour");
  _btnSkip.onclick = () => skip();

  const footer = document.createElement("div");
  footer.className = "onb-footer";

  const btns = document.createElement("div");
  btns.className = "onb-btns";
  btns.append(_btnBack, _btnNext, _btnSkip);

  footer.append(_counterEl, btns);
  _tip.append(_liveEl, _titleEl, _bodyEl, footer);

  document.body.append(_block, _spot, _tip);
}

// ---------------------------------------------------------------------------
// Spotlight geometry
// ---------------------------------------------------------------------------

function _spotlightRect(targetEl) {
  const r = targetEl.getBoundingClientRect();
  return {
    left:   r.left   - PAD,
    top:    r.top    - PAD,
    right:  r.right  + PAD,
    bottom: r.bottom + PAD,
    width:  r.width  + PAD * 2,
    height: r.height + PAD * 2,
  };
}

function _applySpotlight(sr) {
  Object.assign(_spot.style, {
    left:   `${sr.left}px`,
    top:    `${sr.top}px`,
    width:  `${sr.width}px`,
    height: `${sr.height}px`,
  });
}

// ---------------------------------------------------------------------------
// Tip placement — tries: below → above → right (fallback).
// ---------------------------------------------------------------------------

function _placeTip(sr) {
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;
  const tipH = Math.max(_tip.offsetHeight || 0, MIN_TIP_H);

  let top, left;

  if (sr.bottom + GAP + tipH <= vh) {
    top  = sr.bottom + GAP;
    left = Math.max(8, Math.min(sr.left, vw - TIP_W - 8));
  } else if (sr.top - GAP - tipH >= 0) {
    top  = sr.top - GAP - tipH;
    left = Math.max(8, Math.min(sr.left, vw - TIP_W - 8));
  } else {
    top  = Math.max(8, Math.min(sr.top, vh - tipH - 8));
    left = Math.max(8, Math.min(sr.right + GAP, vw - TIP_W - 8));
  }

  Object.assign(_tip.style, {
    top:  `${top}px`,
    left: `${left}px`,
  });
}

// ---------------------------------------------------------------------------
// Reposition (throttled via rAF)
// ---------------------------------------------------------------------------

function _doReposition() {
  if (!_current) return;
  const sr = _spotlightRect(_current);
  _applySpotlight(sr);
  _placeTip(sr);
}

function _scheduleReposition() {
  if (_rafId) return;
  _rafId = requestAnimationFrame(() => { _rafId = null; _doReposition(); });
}

function _onResize() { _scheduleReposition(); }
function _onScroll() { _scheduleReposition(); }

// ---------------------------------------------------------------------------
// Focus management (Step 5)
// ---------------------------------------------------------------------------

function _focusableBtns() {
  return [_btnBack, _btnNext, _btnSkip].filter(b => b && !b.disabled);
}

function _trapFocusKey(e) {
  if (!_tip || _tip.style.display === "none") return;

  if (e.key === "Escape") {
    e.preventDefault();
    skip();
    return;
  }

  if (e.key !== "Tab") return;

  const focusable = _focusableBtns();
  if (!focusable.length) return;

  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }
}

function _trapFocusFocusin(e) {
  // Guard: only redirect when the tip is visible and focus leaves it.
  if (!_tip || _tip.style.display === "none") return;
  if (!_tip.contains(e.target)) _btnNext.focus();
}

function _restoreFocus() {
  const el = _prevFocus;
  _prevFocus = null;
  if (el && typeof el.focus === "function") {
    try { el.focus(); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Listener management
// ---------------------------------------------------------------------------

function _attachListeners() {
  window.addEventListener("resize", _onResize, { passive: true });
  document.addEventListener("scroll", _onScroll, { passive: true, capture: true });
  document.addEventListener("keydown", _trapFocusKey);
  document.addEventListener("focusin", _trapFocusFocusin);
}

function _detachListeners() {
  window.removeEventListener("resize", _onResize);
  document.removeEventListener("scroll", _onScroll, { passive: true, capture: true });
  document.removeEventListener("keydown", _trapFocusKey);
  document.removeEventListener("focusin", _trapFocusFocusin);
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
}

// ---------------------------------------------------------------------------
// spotlight(targetEl) — positions all three DOM elements onto the target.
// ---------------------------------------------------------------------------

function spotlight(targetEl) {
  _current = targetEl;

  const r = targetEl.getBoundingClientRect();
  const offscreen = r.bottom < 0 || r.top > window.innerHeight;

  if (offscreen) {
    targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      const sr = _spotlightRect(targetEl);
      _applySpotlight(sr);
      _placeTip(sr);
      _setVisible(true);
    }, 400);
  } else {
    const sr = _spotlightRect(targetEl);
    _applySpotlight(sr);
    _placeTip(sr);
    _setVisible(true);
  }
}

function _setVisible(on) {
  const display = on ? "" : "none";
  _block.style.display = display;
  _spot.style.display  = display;
  _tip.style.display   = display;
}

// ---------------------------------------------------------------------------
// Step controller
// ---------------------------------------------------------------------------

function _markSeen() {
  localStorage.setItem(SEEN_KEY, "1");
}

function _goTo(idx) {
  // Past the end → finish the tour.
  if (idx >= STEPS.length) { finish(); return; }
  // Before the beginning → clamp.
  if (idx < 0) idx = 0;

  const step = STEPS[idx];

  // Resolve anchor; if element missing or hidden (display:none on self or ancestor), skip forward.
  const el = document.querySelector(step.anchor);
  if (!el || el.offsetParent === null) { _goTo(idx + 1); return; }

  _stepIdx = idx;
  const total = STEPS.length;
  const human = idx + 1;

  // Update tip content.
  _titleEl.textContent   = step.title;
  _bodyEl.textContent    = step.body;
  _counterEl.textContent = `${human} of ${total}`;

  // Announce to screen readers: clear then re-set so the live region fires.
  _liveEl.textContent = "";
  requestAnimationFrame(() => {
    if (_liveEl) _liveEl.textContent = `Step ${human} of ${total}: ${step.title}`;
  });

  // Back disabled on first step.
  _btnBack.disabled = (idx === 0);

  // Last step: "Done" label + updated aria-label.
  const isLast = (idx === total - 1);
  _btnNext.textContent = isLast ? "Done" : "Next";
  _btnNext.setAttribute("aria-label", isLast ? "Finish tour" : "Go to next step");

  spotlight(el);

  // Move focus to the primary action button after positioning.
  // rAF ensures the tip is visible and laid out before focus is set.
  requestAnimationFrame(() => { if (_btnNext) _btnNext.focus(); });
}

// ---------------------------------------------------------------------------
// Public navigation API
// ---------------------------------------------------------------------------

export function next() { _goTo(_stepIdx + 1); }
export function prev() { _goTo(_stepIdx - 1); }

export function skip() {
  _markSeen();
  _detachListeners();   // kill focusin trap before restoring focus outside the tip
  _restoreFocus();
  teardown();
}

export function finish() {
  _markSeen();
  _detachListeners();   // kill focusin trap before restoring focus outside the tip
  _restoreFocus();
  teardown();
}

// ---------------------------------------------------------------------------
// Teardown — removes all injected DOM and listeners.
// ---------------------------------------------------------------------------

export function teardown() {
  _detachListeners();
  _current   = null;
  _stepIdx   = 0;
  _prevFocus = null;
  _liveEl    = null;
  _titleEl   = null;
  _bodyEl    = null;
  _counterEl = null;
  _btnBack   = null;
  _btnNext   = null;
  _btnSkip   = null;
  if (_block) { _block.remove(); _block = null; }
  if (_spot)  { _spot.remove();  _spot  = null; }
  if (_tip)   { _tip.remove();   _tip   = null; }
}

// ---------------------------------------------------------------------------
// Gating + entry points
// ---------------------------------------------------------------------------

export function maybeStartTour() {
  if (localStorage.getItem(SEEN_KEY))  return;
  if (localStorage.getItem(DRAFT_KEY)) return;

  const params = new URLSearchParams(location.search);
  if (params.has("perf") || params.has("tests")) return;

  const importPreview = document.getElementById("importPreview");
  if (importPreview && importPreview.style.display !== "none") return;

  const inputSection = document.getElementById("inputSection");
  if (!inputSection || inputSection.offsetParent === null) return;

  startTour({ force: false });
}

export function startTour({ force = false } = {}) {
  if (!force && localStorage.getItem(SEEN_KEY)) return;

  _prevFocus = document.activeElement;  // save for restoration on exit

  _createDOM();
  _attachListeners();
  _goTo(0);
}
