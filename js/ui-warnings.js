// =============================================================================
// ui-warnings.js — Shared validation-panel primitives (leaf module)
//
// No ui.js import — avoids circular dependency.
// Both Standard and Multivariate modes call renderWarningBlocks so styling
// and glyph conventions stay identical across modes.
// =============================================================================

import { escapeHTML } from "./utils-html.js";

/**
 * Render error + warning blocks into a DOM element.
 * @param {HTMLElement} targetEl
 * @param {{ errors?: string[], warnings?: string[] }} blocks — pre-escaped HTML strings
 */
export function renderWarningBlocks(targetEl, { errors = [], warnings = [] }) {
  let html = "";
  if (errors.length)
    html += `<div class="validation-block validation-block--error">${errors.map(m => `<div>❌ ${m}</div>`).join("")}</div>`;
  if (warnings.length)
    html += `<div class="validation-block validation-block--warning">${warnings.map(m => `<div>⚠ ${m}</div>`).join("")}</div>`;
  targetEl.innerHTML = html;
}

// ── Message builders (return pre-escaped HTML strings) ────────────────────────

export const msgExcluded = (label, reason) =>
  `Excluded: ${escapeHTML(label)} (${escapeHTML(reason)})`;

export const msgNonNumericMod = (label, value, modName) =>
  `${escapeHTML(label)}: "${escapeHTML(value)}" is not a valid number for moderator ${escapeHTML(modName)}`;

export const msgFewStudies = (k, minK, context) =>
  `Fewer than ${minK} studies — ${context}`;

export const msgTinyVariance = () =>
  "One or more studies have extremely small variance (may inflate weights)";

/**
 * Shared analysis-level pre-checks: no-studies, k<minK, k<3 bias-test, tiny vi.
 *
 * @param {{ studies: object[], excluded?: object[], minK?: number, biasTests?: boolean }} opts
 *   studies   — valid study/row objects, each with a .vi field
 *   excluded  — excluded study array (reserved for future use; not read here)
 *   minK      — minimum k for "not meaningful" warning (default 2)
 *   biasTests — when false, skips the Egger/Begg/FAT-PET k<3 warning (use for MV)
 * @returns {{ errors: string[], warnings: string[] }} pre-escaped HTML strings
 */
export function analysisChecks({ studies, excluded, minK = 2, biasTests = true }) {
  const errors = [], warnings = [];
  const k = studies.length;
  if (k === 0) {
    errors.push("No valid studies available for analysis");
  } else {
    if (k < minK) warnings.push(msgFewStudies(k, minK, "meta-analysis not meaningful"));
    if (biasTests && k < 3) warnings.push(msgFewStudies(k, 3, "Egger / Begg / FAT-PET tests require ≥ 3 studies"));
    if (studies.some(s => s.vi <= 1e-8)) warnings.push(msgTinyVariance());
  }
  return { errors, warnings };
}
