// =============================================================================
// ui-state.js — DOM → data helpers: row validation, soft warnings, session gather
//
// Extracted from ui.js (item 4.2.2 of TECHNICAL IMPROVEMENT ROADMAP).
// No imports from ui.js — avoids circular dependency.
// =============================================================================

import { buildSession } from "./session.js";
import { effectProfiles, getProfile } from "./profiles.js";

// ---------------- VALIDATE ROW ----------------
export function validateRow(row) {
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
export function getSoftWarnings(studyInput, type, label) {
  return getProfile(type)?.softWarnings(studyInput, label) ?? [];
}

// ---------------- SESSION SCHEMA ----------------

// Gather the current UI state into a versioned session object.
// Schema is defined in session.js.
export function gatherSessionState(mods, scaleMods, robState) {
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

  const savedModerators = mods.map(m => ({ name: m.name, type: m.type, transform: m.transform || "linear" }));
  const savedScaleModerators = scaleMods.map(m => ({ name: m.name, type: m.type, transform: m.transform || "linear" }));

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
    mods.forEach((m, modIdx) => {
      modValues[m.name] = inputs[profile.inputs.length + 3 + modIdx]?.value ?? "";
    });

    // Skip completely empty rows
    const allVals = [study, ...Object.values(effectInputs), group, cluster, ...Object.values(modValues)];
    if (allVals.every(v => v === "")) return;

    studies.push({ study, inputs: effectInputs, group, cluster, moderators: modValues });
  });

  return buildSession(settings, savedModerators, studies, robState, savedScaleModerators);
}
