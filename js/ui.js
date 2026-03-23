// ================= UI =================
import { compute, eggerTest, beggTest, fatPetTest, failSafeN, meta, influenceDiagnostics, subgroupAnalysis, metaRegression, cumulativeMeta } from "./analysis.js";
import { fmt, transformEffect, transformCI } from "./utils.js";
import { runTests } from "./tests.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel, drawBubble, drawInfluencePlot, drawCumulativeForest } from "./plots.js";

// ---------------- EFFECT PROFILES ----------------
const effectProfiles = {
  "MD": {
    label: "Mean Difference",
    inputs: ["m1", "sd1", "n1", "m2", "sd2", "n2"],
    compute: (data) => compute(data, "MD"),
    transform: (x) => transformEffect(x, "MD"),
    transformCI: (lb, ub) => transformCI(lb, ub, "MD")
  },
  
	"SMD": {
	  label: "Standardized Mean Difference",
	  inputs: ["m1","sd1","n1","m2","sd2","n2"],
	  compute: (data) => compute(data, "SMD", { hedgesCorrection: true }),
	  transform: (x) => transformEffect(x, "SMD"),
	  transformCI: (lb, ub) => transformCI(lb, ub, "SMD")
	},
	
	"MD_paired": {
	  label: "Mean Difference (Paired)",
	  inputs: ["m_pre", "sd_pre", "m_post", "sd_post", "n", "r"],
	  compute: (data) => compute(data, "MD_paired"),
	  transform: (x) => transformEffect(x, "MD"),
	  transformCI: (lb, ub) => transformCI(lb, ub, "MD")
	},

	"SMD_paired": {
	  label: "Standardized Mean Change",
	  inputs: ["m_pre", "sd_pre", "m_post", "sd_post", "n", "r"],
	  compute: (data) => compute(data, "SMD_paired"),
	  transform: (x) => transformEffect(x, "SMD"),
	  transformCI: (lb, ub) => transformCI(lb, ub, "SMD")
	},
	
  "OR": {
    label: "Odds Ratio",
    inputs: ["a", "b", "c", "d"],
    compute: (data) => compute(data, "OR"),
    transform: (x) => transformEffect(x, "OR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "OR")
  },
  
  "RR": {
    label: "Risk Ratio",
    inputs: ["a", "b", "c", "d"],
    compute: (data) => compute(data, "RR"),
    transform: (x) => transformEffect(x, "RR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "RR")
  },

	"RD": {
	  label: "Risk Difference",
	  inputs: ["a", "b", "c", "d"],  // a/b = events/non-events in treatment, c/d = control
	  compute: (data) => compute(data, "RD"),
	  transform: (x) => transformEffect(x, "RD"),
	  transformCI: (lb, ub) => transformCI(lb, ub, "RD")
	},

  "COR": {
    label: "Correlation (raw r)",
    inputs: ["r", "n"],
    compute: (data) => compute(data, "COR"),
    transform: (x) => transformEffect(x, "COR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "COR")
  },

  "ZCOR": {
    label: "Correlation (Fisher's z)",
    inputs: ["r", "n"],
    compute: (data) => compute(data, "ZCOR"),
    transform: (x) => transformEffect(x, "ZCOR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "ZCOR")
  },

  "PR": {
    label: "Proportion (raw)",
    inputs: ["x", "n"],
    compute: (data) => compute(data, "PR"),
    transform: (x) => transformEffect(x, "PR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "PR")
  },

  "PLN": {
    label: "Proportion (log)",
    inputs: ["x", "n"],
    compute: (data) => compute(data, "PLN"),
    transform: (x) => transformEffect(x, "PLN"),
    transformCI: (lb, ub) => transformCI(lb, ub, "PLN")
  },

  "PLO": {
    label: "Proportion (logit)",
    inputs: ["x", "n"],
    compute: (data) => compute(data, "PLO"),
    transform: (x) => transformEffect(x, "PLO"),
    transformCI: (lb, ub) => transformCI(lb, ub, "PLO")
  },

  "PAS": {
    label: "Proportion (arcsine)",
    inputs: ["x", "n"],
    compute: (data) => compute(data, "PAS"),
    transform: (x) => transformEffect(x, "PAS"),
    transformCI: (lb, ub) => transformCI(lb, ub, "PAS")
  },

  "PFT": {
    label: "Proportion (Freeman-Tukey)",
    inputs: ["x", "n"],
    compute: (data) => compute(data, "PFT"),
    transform: (x) => transformEffect(x, "PFT"),
    transformCI: (lb, ub) => transformCI(lb, ub, "PFT")
  },

  "GENERIC": {
    label: "Generic (yi / vi)",
    inputs: ["yi", "vi"],
    compute: (data) => compute(data, "GENERIC"),
    transform: (x) => x,
    transformCI: (lb, ub) => ({ lb, ub })
  },

  "HR": {
    label: "Hazard Ratio",
    inputs: ["hr", "ci_lo", "ci_hi"],
    compute: (data) => compute(data, "HR"),
    transform: (x) => transformEffect(x, "HR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "HR")
  },

  "IRR": {
    label: "Incidence Rate Ratio",
    inputs: ["x1", "t1", "x2", "t2"],
    compute: (data) => compute(data, "IRR"),
    transform: (x) => transformEffect(x, "IRR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "IRR")
  },

  "IR": {
    label: "Incidence Rate (log)",
    inputs: ["x", "t"],
    compute: (data) => compute(data, "IR"),
    transform: (x) => transformEffect(x, "IR"),
    transformCI: (lb, ub) => transformCI(lb, ub, "IR")
  }
};

// ---------------- MODERATOR STATE ----------------
let moderators = []; // { name: string, type: "continuous"|"categorical" }

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

// ---------------- INITIALIZE ----------------
document.getElementById("addStudy").addEventListener("click", () => addRow());
document.getElementById("run").addEventListener("click", runAnalysis);
document.getElementById("import").addEventListener("click", importCSV);
document.getElementById("export").addEventListener("click", exportCSV);
document.getElementById("addMod").addEventListener("click", addModerator);
document.getElementById("modName").addEventListener("keydown", e => { if (e.key === "Enter") addModerator(); });

// ---------------- EFFECT TYPE HANDLER ----------------
document.getElementById("effectType").addEventListener("change", () => {
  const type = document.getElementById("effectType").value;
  updateTableHeaders();

  // Populate example data for testing
  populateExampleData(type);

  runAnalysis();
});

document.getElementById("tauMethod").addEventListener("change", runAnalysis);
document.getElementById("ciMethod").addEventListener("change", runAnalysis);

const trimFillCheckbox = document.getElementById("useTrimFill");
const adjustedCheckbox = document.getElementById("useTFAdjusted");
adjustedCheckbox.disabled = !trimFillCheckbox.checked;
trimFillCheckbox.addEventListener("change", () => {
  adjustedCheckbox.disabled = !trimFillCheckbox.checked;
  if (!trimFillCheckbox.checked) adjustedCheckbox.checked = false;
  runAnalysis();
});
adjustedCheckbox.addEventListener("change", runAnalysis);

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
    });
  });

  row.querySelector(".remove-btn").addEventListener("click", () => removeRow(row.querySelector(".remove-btn")));
  row.querySelector(".clear-btn").addEventListener("click", () => clearRow(row.querySelector(".clear-btn")));
}

// ---------------- REMOVE & CLEAR ----------------
function removeRow(btn) {
  const table = document.getElementById("inputTable");
  if (table.rows.length <= 2) return;
  btn.closest("tr").remove();
  runAnalysis();
}

function clearRow(btn) {
  btn.closest("tr").querySelectorAll("input").forEach(input => input.value = "");
  runAnalysis();
}

// ---------------- VALIDATE ROW ----------------
function validateRow(row) {
  const type = document.getElementById("effectType").value;
  const profile = effectProfiles[type];
  const inputs = row.querySelectorAll("input");

  let valid = true;
  const errors = {};

  inputs.forEach((input, idx) => {
    input.classList.remove("input-error");

    // Skip Study (first), Group (.group class), and moderator (data-mod) inputs.
    // Only the p effect-input columns (indices 1..p) are validated here.
    if (idx === 0 || input.classList.contains("group") || "mod" in input.dataset) return;

    const key = profile.inputs[idx - 1];
    const val = input.value.trim();

    if (val === "" || isNaN(val)) {
      input.classList.add("input-error");
      errors[key] = `${key} is required`;
      valid = false;
      return;
    }

    const num = +val;

    // -------- RULES BY VARIABLE --------
    let inputValid = true;
    let errorMsg = null;
    if (key.includes("sd") && num <= 0) { inputValid = false; errorMsg = `${key} must be > 0`; }
    if (key === "vi" && num <= 0)        { inputValid = false; errorMsg = "vi must be > 0"; }
    if (key === "n") {
      const minN = type === "ZCOR" ? 4 : type === "COR" ? 3 : 2;
      if (num < minN) { inputValid = false; errorMsg = `n must be ≥ ${minN}${type === "ZCOR" ? " for Fisher's z" : ""}`; }
    }
    if (key === "x") {
      if (!Number.isInteger(num) || num < 0) { inputValid = false; errorMsg = "x must be a non-negative integer"; }
      else {
        // Check x ≤ n in the same row
        const nInput = Array.from(row.querySelectorAll("input")).find(
          (el, i) => i > 0 && profile.inputs[i - 1] === "n"
        );
        const nVal = nInput ? +nInput.value : NaN;
        if (isFinite(nVal) && num > nVal) { inputValid = false; errorMsg = "x cannot exceed n"; }
      }
    }
    // IRR event counts: non-negative integers
    if (key === "x1" || key === "x2") {
      if (!Number.isInteger(num) || num < 0) { inputValid = false; errorMsg = `${key} must be a non-negative integer`; }
    }
    // Person-time: strictly positive
    if (key === "t" || key === "t1" || key === "t2") {
      if (num <= 0) { inputValid = false; errorMsg = `${key} must be > 0`; }
    }
    // HR: hazard ratio and CI bounds must be strictly positive
    if (key === "hr" || key === "ci_lo" || key === "ci_hi") {
      if (num <= 0) { inputValid = false; errorMsg = `${key} must be > 0`; }
    }
    // HR: ci_lo must be less than ci_hi (cross-field check)
    if (key === "ci_lo") {
      const hiInput = Array.from(row.querySelectorAll("input")).find(
        (el, i) => i > 0 && profile.inputs[i - 1] === "ci_hi"
      );
      const hiVal = hiInput ? +hiInput.value : NaN;
      if (isFinite(hiVal) && num >= hiVal) { inputValid = false; errorMsg = "ci_lo must be < ci_hi"; }
    }
    // r as pre-post correlation (paired designs): allow [-1, 1]
    // r as Pearson correlation (COR/ZCOR): must be strictly within (-1, 1)
    if (key === "r" && (type === "COR" || type === "ZCOR")) {
      if (Math.abs(num) >= 1) { inputValid = false; errorMsg = "r must be strictly between -1 and 1"; }
    } else if (key === "r" && (num < -1 || num > 1)) {
      inputValid = false; errorMsg = "r must be between -1 and 1";
    }

    if (!inputValid) {
      input.classList.add("input-error");
      errors[key] = errorMsg;
      valid = false;
    }
  });

  row.dataset.validationErrors = JSON.stringify(errors);
  row.classList.toggle("row-error", !valid);
  return valid;
}

// ---------------- SOFT WARNINGS ----------------
function getSoftWarnings(studyInput, type, label) {
  const warnings = [];

  if (type === "MD" || type === "SMD") {
    const { n1, n2, sd1, sd2 } = studyInput;

    if (isFinite(n1) && n1 < 10) {
      warnings.push(`⚠️ ${label}: small sample size (n1 < 10)`);
    }
    if (isFinite(n2) && n2 < 10) {
      warnings.push(`⚠️ ${label}: small sample size (n2 < 10)`);
    }

    if (isFinite(n1) && isFinite(n2)) {
      const ratio = Math.max(n1, n2) / Math.min(n1, n2);
      if (ratio > 3) {
        warnings.push(`⚠️ ${label}: highly imbalanced group sizes`);
      }
    }

    if (isFinite(sd1) && isFinite(sd2)) {
      const ratio = Math.max(sd1, sd2) / Math.min(sd1, sd2);
      if (ratio > 3) {
        warnings.push(`⚠️ ${label}: large SD imbalance`);
      }
    }
  }

  else if (type === "OR" || type === "RR") {
    const { a, b, c, d } = studyInput;

    // Zero-event cells
    if ([a, b, c, d].some(v => v === 0)) {
      warnings.push(`⚠️ ${label}: zero cell detected (continuity correction applied)`);
    }

    // Rare events
    const total = (a + b + c + d);
    if (isFinite(total) && total > 0) {
      const minCell = Math.min(a, b, c, d);
      if (minCell / total < 0.05) {
        warnings.push(`⚠️ ${label}: rare events (unstable estimate)`);
      }
    }
  }

  else if (type === "COR" || type === "ZCOR") {
    const { r, n } = studyInput;
    if (isFinite(n) && n < 10) {
      warnings.push(`⚠️ ${label}: small sample size (n < 10) — correlation estimate unreliable`);
    }
    if (isFinite(r) && Math.abs(r) > 0.9) {
      warnings.push(`⚠️ ${label}: |r| > 0.90 — variance estimate near boundary, interpret cautiously`);
    }
  }

  else if (type === "PR" || type === "PLN" || type === "PLO" ||
           type === "PAS" || type === "PFT") {
    const { x, n } = studyInput;
    if (isFinite(n) && n < 20) {
      warnings.push(`⚠️ ${label}: small sample size (n < 20) — proportion estimate unreliable`);
    }
    if (isFinite(x) && isFinite(n) && n > 0) {
      const p = x / n;
      if (p === 0 || p === 1) {
        if (type === "PR") {
          warnings.push(`⚠️ ${label}: extreme proportion (0 or 1) — variance is zero, study has no weight`);
        }
        // PLN/PLO: continuity correction applied automatically
        // PAS/PFT: formula is well-defined at boundaries, no correction needed
      } else if (p < 0.05 || p > 0.95) {
        warnings.push(`⚠️ ${label}: extreme proportion (< 5% or > 95%) — consider log or logit transform`);
      }
    }
  }

  else if (type === "GENERIC") {
    const { vi } = studyInput;
    if (isFinite(vi) && vi > 1) {
      warnings.push(`⚠️ ${label}: large variance (low precision study)`);
    }
  }

  else if (type === "IRR") {
    const { x1, x2 } = studyInput;
    if (x1 === 0 || x2 === 0) {
      warnings.push(`⚠️ ${label}: zero events (continuity correction of 0.5 applied to both arms)`);
    }
  }

  else if (type === "IR") {
    const { x } = studyInput;
    if (x === 0) {
      warnings.push(`⚠️ ${label}: zero events (continuity correction: x set to 0.5)`);
    }
  }

  return warnings;
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

// ---------------- CSV (with column warning) ----------------
function importCSV() {
  const file = document.getElementById('csvFile').files[0];
  const warningDiv = document.getElementById("csvWarning");
  warningDiv.style.display = "none"; // reset warning

  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const allRows = e.target.result.split('\n').map(r => r.trim()).filter(r => r);
    if (allRows.length === 0) return;

    const headers = allRows[0].split(',').map(h => h.trim());
    const headerLower = headers.map(h => h.toLowerCase());

    // Detect effect type automatically
    let detectedType = Object.keys(effectProfiles).find(type => {
      const profile = effectProfiles[type];
      const profileLower = profile.inputs.map(i => i.toLowerCase());
      return profileLower.every(col => headerLower.includes(col));
    }) || document.getElementById("effectType").value;

    document.getElementById("effectType").value = detectedType;

    // Check required columns
    const profile = effectProfiles[detectedType];
    const missingCols = profile.inputs.filter(c => !headerLower.includes(c.toLowerCase()));
    if (missingCols.length > 0) {
      warningDiv.textContent = `Warning: CSV is missing required columns: ${missingCols.join(', ')}`;
      warningDiv.style.display = "block";
    }

    // Map headers to column indices
    const headerMap = {};
    headers.forEach((h, idx) => headerMap[h.toLowerCase()] = idx);

    // Detect moderator columns: anything that isn't Study, Group, or an effect input
    const knownCols = new Set(['study', 'group', ...profile.inputs.map(c => c.toLowerCase())]);
    const modCols = headers.filter(h => !knownCols.has(h.toLowerCase()));

    // Infer type: continuous if every non-empty value in the column parses as a number
    const dataRows = allRows.slice(1).map(r => r.split(',').map(s => s.trim()));
    clearModerators();
    modCols.forEach(col => {
      const ci = headerMap[col.toLowerCase()];
      const vals = dataRows.map(r => r[ci] ?? "").filter(v => v !== "");
      const type = vals.length > 0 && vals.every(v => !isNaN(v)) ? "continuous" : "categorical";
      moderators.push({ name: col, type });   // push to state only — no DOM yet
    });

    // Rebuild headers (effect type + detected moderators) then clear data rows
    updateTableHeaders();
    const table = document.getElementById("inputTable");
    while (table.rows.length > 1) table.deleteRow(1);

    dataRows.forEach(values => {
      const v = [];
      v.push(values[headerMap['study']] ?? "");                          // Study
      profile.inputs.forEach(col => v.push(values[headerMap[col.toLowerCase()]] ?? ""));  // Effects
      v.push(values[headerMap['group']] ?? "");                          // Group
      modCols.forEach(col => v.push(values[headerMap[col.toLowerCase()]] ?? ""));         // Moderators
      addRow(v);
    });

    runAnalysis();
  };

  reader.readAsText(file);
}

// ---------------- CSV EXPORT (updated) ----------------
function exportCSV() {
  const type = document.getElementById("effectType").value;
  const profile = effectProfiles[type];

  // Build headers dynamically (moderator names appended after Group)
  const headers = ["Study", ...profile.inputs, "Group", ...moderators.map(m => m.name)];
  const tableRows = [headers.join(',')];

  // Gather table rows
  document.querySelectorAll("#inputTable tr").forEach((r, i) => {
    if (i === 0) return; // skip header
    const vals = [...r.querySelectorAll("input")].map(x => x.value);
    // Only include rows with at least one non-empty input
    if (vals.some(v => v !== "")) tableRows.push(vals.join(','));
  });

  const blob = new Blob([tableRows.join('\n')], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = "meta_data.csv";
  a.click();
}

// ---------------- INIT ----------------
function init() {
  // Set default effect type
  const defaultType = document.getElementById("effectType").value;
  updateTableHeaders();

  // Populate example rows for default type
  populateExampleData(defaultType);

  // Validate all rows
  document.querySelectorAll("#inputTable tr").forEach((row, i) => {
    if (i === 0) return;
    validateRow(row);
  });

  runAnalysis();
  runTests();
}

window.onload = init;

// ---------------- POPULATE EXAMPLES ----------------
function populateExampleData(type) {
  const table = document.getElementById("inputTable");
  while (table.rows.length > 1) table.deleteRow(1); // clear existing rows

  const exampleData = {
    "MD": [
      ["Study1", 10, 2, 30, 8, 2, 28, "A"],
      ["Study2", 12, 3, 32, 9, 3, 30, "A"],
      ["Study3", 9, 2, 28, 7, 2, 25, "B"]
    ],
    "SMD": [
      ["Study1", 10, 2, 30, 8, 2, 28, "A"],
      ["Study2", 12, 3, 32, 9, 3, 30, "A"],
      ["Study3", 9, 2, 28, 7, 2, 25, "B"]
    ],
    "OR": [
      ["Study1", 12, 5, 8, 15, "A"],
      ["Study2", 20, 10, 5, 25, "B"],
      ["Study3", 10, 4, 6, 12, "B"]
    ],
    "RR": [
      ["Study1", 12, 5, 8, 15, "A"],
      ["Study2", 20, 10, 5, 25, "B"],
      ["Study3", 10, 4, 6, 12, "B"]
    ],
	"MD_paired": [
	  ["Study1", 10, 2, 8, 2, 30, 0.5, "A"],
	  ["Study2", 12, 3, 9, 3, 32, 0.6, "A"],
	  ["Study3", 9, 2, 7, 2, 28, 0.4, "B"]
	],
	"SMD_paired": [
	  ["Study1", 10, 2, 8, 2, 30, 0.5, "A"],
	  ["Study2", 12, 3, 9, 3, 32, 0.6, "A"],
	  ["Study3", 9, 2, 7, 2, 28, 0.4, "B"]
	],
	"RD": [
		["Study 1", 12, 8, 15, 10, "A"],
		["Study 2", 20, 10, 18, 12, "A"],
		["Study 3", 8, 7, 10, 9, "B"]
	],
    "COR": [
      ["Study 1", 0.45, 62, ""],
      ["Study 2", 0.56, 90, ""],
      ["Study 3", 0.38, 45, ""],
      ["Study 4", 0.61, 120, ""],
      ["Study 5", 0.42, 75, ""]
    ],
    "ZCOR": [
      ["Study 1", 0.45, 62, ""],
      ["Study 2", 0.56, 90, ""],
      ["Study 3", 0.38, 45, ""],
      ["Study 4", 0.61, 120, ""],
      ["Study 5", 0.42, 75, ""]
    ],
    "PR": [
      ["Study 1", 12, 80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3", 8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""]
    ],
    "PLN": [
      ["Study 1", 12, 80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3", 8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""]
    ],
    "PLO": [
      ["Study 1", 12, 80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3", 8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""]
    ],
    "PAS": [
      ["Study 1", 12, 80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3", 8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""]
    ],
    "PFT": [
      ["Study 1", 12, 80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3", 8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""]
    ],
    "GENERIC": [
      ["Study 1", -0.889, 0.326, ""],
      ["Study 2", -1.585, 0.255, ""],
      ["Study 3", -1.348, 0.214, ""],
      ["Study 4", -1.442, 0.045, ""],
      ["Study 5", -0.218, 0.031, ""]
    ],
    "HR": [
      ["Study 1", 0.72, 0.54, 0.96, ""],
      ["Study 2", 0.85, 0.62, 1.17, ""],
      ["Study 3", 0.61, 0.45, 0.83, ""],
      ["Study 4", 0.78, 0.58, 1.05, ""],
      ["Study 5", 0.69, 0.51, 0.93, ""]
    ],
    "IRR": [
      ["Study 1", 12, 1200, 20, 1000, ""],
      ["Study 2", 25, 2500, 35, 2000, ""],
      ["Study 3",  8,  800, 15,  900, ""],
      ["Study 4", 18, 1800, 28, 1500, ""],
      ["Study 5", 30, 3000, 42, 2800, ""]
    ],
    "IR": [
      ["Study 1", 15, 1000, ""],
      ["Study 2", 28, 2500, ""],
      ["Study 3",  9,  800, ""],
      ["Study 4", 22, 1500, ""],
      ["Study 5", 12,  900, ""]
    ]
  };

  const rows = exampleData[type] || [];
  rows.forEach(row => addRow(row));
}

// ---------------- META-REGRESSION RESULTS PANEL ----------------
function renderRegressionPanel(reg, method, ciMethod, kExcluded = 0) {
  const panel = document.getElementById("regressionPanel");

  if (!moderators.length) { panel.style.display = "none"; return; }
  panel.style.display = "block";

  if (reg.rankDeficient) {
    panel.innerHTML = `
      <div class="reg-header">
        <span class="reg-title">Meta-Regression</span>
      </div>
      <div class="reg-body"><i>Design matrix is rank-deficient — check moderator coding.</i></div>`;
    return;
  }

  const statLabel = reg.dist === "t" ? `t(${reg.QEdf})` : "z";
  const QMlabel   = reg.QMdist === "F"
    ? `F(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;
  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";

  function stars(p) {
    if (p < 0.001) return `<span class="reg-sig-3">***</span>`;
    if (p < 0.01)  return `<span class="reg-sig-2">**</span>`;
    if (p < 0.05)  return `<span class="reg-sig-1">*</span>`;
    if (p < 0.10)  return `<span style="color:#666">.</span>`;
    return "";
  }

  function fmtP(p) {
    if (!isFinite(p)) return "—";
    if (p < 0.0001) return `<span class="reg-sig-3">&lt;0.0001</span>`;
    const cls = p < 0.001 ? "reg-sig-3" : p < 0.01 ? "reg-sig-2" : p < 0.05 ? "reg-sig-1" : "";
    return cls ? `<span class="${cls}">${fmt(p)}</span>` : fmt(p);
  }

  const QMrow = reg.p > 1
    ? ` &nbsp;·&nbsp; QM ${QMlabel} = ${fmt(reg.QM)}, p = ${fmtP(reg.QMp)}`
    : "";

  let rows = "";
  reg.colNames.forEach((name, j) => {
    const [lo, hi] = reg.ci[j];
    rows += `<tr class="${j === 0 ? "reg-intercept" : ""}">
      <td>${name}</td>
      <td>${fmt(reg.beta[j])}</td>
      <td>${fmt(reg.se[j])}</td>
      <td>${fmt(reg.zval[j])}</td>
      <td>${fmtP(reg.pval[j])}</td>
      <td>[${fmt(lo)}, ${fmt(hi)}]</td>
      <td>${stars(reg.pval[j])}</td>
    </tr>`;
  });

  // ---- Fitted values table ----
  let fittedRows = "";
  if (reg.labels && reg.fitted) {
    reg.labels.forEach((lbl, i) => {
      const sr = reg.stdResiduals[i];
      const flag = Math.abs(sr) > 1.96 ? " style='color:#ff9f43'" : "";
      fittedRows += `<tr>
        <td>${lbl || i + 1}</td>
        <td>${fmt(reg.yi[i])}</td>
        <td>${fmt(reg.fitted[i])}</td>
        <td>${fmt(reg.residuals[i])}</td>
        <td${flag}>${fmt(sr)}</td>
      </tr>`;
    });
  }

  const lowDfWarning = reg.QEdf < 3
    ? `<div class="reg-note" style="color:#ff9f43">⚠ Very few residual df (k − p = ${reg.QEdf}) — estimates may be unreliable.</div>`
    : "";
  const excludedWarning = kExcluded > 0
    ? `<div class="reg-note" style="color:#ff9f43">⚠ ${kExcluded} ${kExcluded === 1 ? "study" : "studies"} excluded from regression (missing moderator value${kExcluded === 1 ? "" : "s"}).</div>`
    : "";

  panel.innerHTML = `
    <div class="reg-header">
      <span class="reg-title">Meta-Regression</span>
      <span class="reg-meta">k = ${reg.k} &nbsp;·&nbsp; ${method} &nbsp;·&nbsp; ${ciLabel}</span>
    </div>
    <div class="reg-het">
      τ² = ${fmt(reg.tau2)} (residual) &nbsp;·&nbsp; I² = ${fmt(reg.I2)}%
      ${reg.p > 1 ? `&nbsp;·&nbsp; R² = ${isFinite(reg.R2) ? fmt(reg.R2 * 100) + "%" : "N/A"}` : ""}
      &nbsp;·&nbsp; QE(${reg.QEdf}) = ${fmt(reg.QE)}, p = ${fmtP(reg.QEp)}
      ${QMrow}
    </div>
    <div class="reg-body">
      ${excludedWarning}${lowDfWarning}
      <table class="reg-table">
        <thead><tr>
          <th>Term</th><th>β</th><th>SE</th><th>${statLabel}</th>
          <th>p</th><th>95% CI</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="reg-note">*** p &lt; .001 &nbsp;·&nbsp; ** p &lt; .01 &nbsp;·&nbsp; * p &lt; .05 &nbsp;·&nbsp; · p &lt; .10</div>
      ${fittedRows ? `
      <details style="margin-top:10px">
        <summary style="cursor:pointer; color:#aaa; font-size:0.88em">Fitted values &amp; residuals (k = ${reg.k})</summary>
        <table class="reg-table" style="margin-top:6px">
          <thead><tr>
            <th>Study</th><th>yᵢ</th><th>ŷᵢ</th><th>eᵢ</th><th>std. eᵢ</th>
          </tr></thead>
          <tbody>${fittedRows}</tbody>
        </table>
        <div class="reg-note">Standardized residuals |std. e| &gt; 1.96 highlighted.</div>
      </details>` : ""}
    </div>`;
}

// ---------------- RUN ANALYSIS (modified for benchmarks) ----------------
function runAnalysis() {
  const type = document.getElementById("effectType").value;
  const profile = effectProfiles[type];
  if (!profile) return;

  const rows = document.querySelectorAll("#inputTable tr");

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
    profile.inputs.forEach((key, idx) => studyInput[key] = +inputs[idx + 1]);

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

    const study = profile.compute(studyInput, undefined, profile.computeOptions);

    if (!isFinite(study.yi) || !isFinite(study.vi)) {
      excluded.push({ label, reason: "Computation failed (invalid effect size or variance)" });
      continue;
    }

    study.group = group;

    // ---- Moderator values ----
    moderators.forEach(({ name, type }) => {
      const inp = row.querySelector(`input[data-mod="${name}"]`);
      const raw = inp ? inp.value.trim() : "";
      study[name] = type === "continuous" ? (raw === "" ? NaN : +raw) : raw;
    });

    studies.push(study);
  }

  if (!studies.length) return;

  const method = document.getElementById("tauMethod")?.value || "DL";
  const ciMethod = document.getElementById("ciMethod")?.value || "normal";
  const useTF = document.getElementById("useTrimFill")?.checked;
  const useTFAdjusted = document.getElementById("useTFAdjusted")?.checked;

  let tf = [], all = studies;
  if (useTF) { tf = trimFill(studies, method); all = [...studies, ...tf]; }

  let m = meta(studies, method, ciMethod);

  const egger  = eggerTest(studies);
  const begg   = beggTest(studies);
  const fatpet = fatPetTest(studies);
  const fsn    = failSafeN(studies);
  const influence = influenceDiagnostics(studies, method, ciMethod);
  const subgroup = subgroupAnalysis(studies, method, ciMethod);

  const k = influence.length;
  let influenceHTML = `<b>Influence diagnostics:</b><br>
    <table border="1">
      <tr><th>Study</th><th>RE (LOO)</th><th>Δτ²</th><th>Std Residual</th><th>DFBETA</th><th>Hat</th><th>Cook's D</th><th>Flag</th></tr>`;
  influence.forEach(d => {
    const anyFlag = d.outlier || d.influential || d.highLeverage || d.highCookD;
    const rowStyle = anyFlag ? "style='background:#ffe6e6;'" : "";
    const hatStyle  = d.highLeverage ? " style='color:orange;font-weight:bold;'" : "";
    const cookStyle = d.highCookD    ? " style='color:orange;font-weight:bold;'" : "";
    const flags = [
      d.outlier      ? "Outlier"    : "",
      d.influential  ? "Influential": "",
      d.highLeverage ? "Hi-Lev"     : "",
      d.highCookD    ? "Hi-Cook"    : ""
    ].filter(Boolean).join(", ");
    influenceHTML += `<tr ${rowStyle}>
      <td>${d.label}</td>
      <td>${isFinite(d.RE_loo)      ? fmt(d.RE_loo)      : "NA"}</td>
      <td>${isFinite(d.deltaTau2)   ? fmt(d.deltaTau2)   : "NA"}</td>
      <td>${isFinite(d.stdResidual) ? fmt(d.stdResidual) : "NA"}</td>
      <td>${isFinite(d.DFBETA)      ? fmt(d.DFBETA)      : "NA"}</td>
      <td${hatStyle}>${isFinite(d.hat)   ? d.hat.toFixed(3)   : "NA"}</td>
      <td${cookStyle}>${isFinite(d.cookD) ? d.cookD.toFixed(3) : "NA"}</td>
      <td>${flags}</td></tr>`;
  });
  influenceHTML += `</table>
    <small style="color:#aaa;">Thresholds: Hat &gt; ${fmt(2/k)} (= 2/k); Cook's D &gt; ${fmt(4/k)} (= 4/k)</small>`;

  // Subgroup table (unchanged)
  let subgroupHTML = "";
  if (subgroup && subgroup.G >= 2) {
    subgroupHTML += `<b>Subgroup analysis:</b><br><table border="1"><tr><th>Group</th><th>k</th><th>Effect</th><th>SE</th><th>CI</th><th>τ²</th><th>I² (%)</th></tr>`;
    Object.entries(subgroup.groups).forEach(([g,r])=>{
      const isSingle = r.k===1;
      const y_disp = profile.transform(r.y);
      const ci_disp = profile.transformCI(r.ci.lb,r.ci.ub);
      subgroupHTML += `<tr><td>${g}</td><td>${r.k}</td><td>${isFinite(y_disp)?fmt(y_disp):"NA"}</td>
        <td>${isSingle?"NA":isFinite(r.se)?fmt(r.se):"NA"}</td>
        <td>[${isSingle?"NA":fmt(ci_disp.lb)}, ${isSingle?"NA":fmt(ci_disp.ub)}]</td>
        <td>${isSingle?"NA":isFinite(r.tau2)?r.tau2.toFixed(3):"0"}</td>
        <td>${isSingle?"NA":isFinite(r.I2)?r.I2.toFixed(1):"0"}</td></tr>`;
    });
    subgroupHTML += `<tr style="font-weight:bold;"><td colspan="7">Q_between = ${subgroup.Qbetween.toFixed(3)}, df = ${subgroup.df}, p = ${subgroup.p.toFixed(4)}</td></tr></table>`;
  } else { subgroupHTML = "<i>Add at least 2 groups to see subgroup analysis</i><br>"; }

  // Adjusted RE
  let mAdjusted = null;
  if (useTF && useTFAdjusted && tf.length > 0) mAdjusted = meta([...studies,...tf], method, ciMethod);

  const FE_disp = profile.transform(m.FE);
  const RE_disp = profile.transform(m.RE);
  const ci_disp = profile.transformCI(m.ciLow,m.ciHigh);
  const pred_disp = profile.transformCI(m.predLow,m.predHigh);
  const RE_adj_disp = useTF && mAdjusted ? profile.transform(mAdjusted.RE) : null;

  // --- INSERT CORRELATION WARNING ---
  let warningHTML = "";
  if (missingCorrelation) {
    warningHTML = `<div style="color: orange; font-weight: bold;">
      ⚠️ Some paired studies are missing correlation (r). Assumed r = 0.5 for computation.
    </div>`;
  }

  document.getElementById("results").innerHTML = warningHTML + `
    <b>${profile.label} (FE):</b> ${fmt(FE_disp)} |
    <b>${profile.label} (RE):</b> ${fmt(RE_disp)}<br>
    ${useTF && mAdjusted ? `<b>RE (adjusted):</b> ${fmt(RE_adj_disp)}<br>` : ""}
    CI [${fmt(ci_disp.lb)}, ${fmt(ci_disp.ub)}]<br>
    τ²=${fmt(m.tau2)} [${fmt(m.tauCI[0])}, ${isFinite(m.tauCI[1])?fmt(m.tauCI[1]):"∞"}] | I²=${fmt(m.I2)}% [${fmt(m.I2CI[0])}%, ${fmt(m.I2CI[1])}%] | H²-CI=[${fmt(m.H2CI[0])}, ${isFinite(m.H2CI[1])?fmt(m.H2CI[1]):"∞"}]<br>
    ${m.dist}-stat=${fmt(m.stat)} | p=${fmt(m.pval)}<br>
    Prediction=[${fmt(pred_disp.lb)}, ${fmt(pred_disp.ub)}]<br>
    <b>Publication bias:</b><br>
    &nbsp;&nbsp;Egger: intercept=${isFinite(egger.intercept)?fmt(egger.intercept):"NA"} | p=${isFinite(egger.p)?fmt(egger.p):"NA (k<3)"}<br>
    &nbsp;&nbsp;Begg: τ=${isFinite(begg.tau)?fmt(begg.tau):"NA"} | p=${isFinite(begg.p)?fmt(begg.p):"NA (k<3)"}<br>
    &nbsp;&nbsp;FAT (bias): β₁=${isFinite(fatpet.slope)?fmt(fatpet.slope):"NA"} | p=${isFinite(fatpet.slopeP)?fmt(fatpet.slopeP):"NA (k<3)"} &nbsp;·&nbsp; PET (effect at SE→0): ${isFinite(fatpet.intercept)?fmt(profile.transform(fatpet.intercept)):"NA"} | p=${isFinite(fatpet.interceptP)?fmt(fatpet.interceptP):"NA (k<3)"}<br>
    &nbsp;&nbsp;Fail-safe N (Rosenthal): ${isFinite(fsn.rosenthal)?Math.round(fsn.rosenthal):"NA"} &nbsp;·&nbsp; Orwin (trivial=0.1): ${isFinite(fsn.orwin)?Math.round(fsn.orwin):"NA"}<br>
    <b>Trim & Fill:</b> ${useTF?"ON":"OFF"} (${tf.length} filled studies)
  `;
  document.getElementById("results").innerHTML += influenceHTML + subgroupHTML;

  // ---- Meta-regression ----
  // buildDesignMatrix expects { key, type }; ui state stores { name, type }.
  const modSpec = moderators.map(m => ({ key: m.name, type: m.type }));
  const reg = moderators.length > 0
    ? metaRegression(studies, modSpec, method, ciMethod)
    : null;
  const kExcluded = reg ? studies.length - reg.k : 0;
  renderRegressionPanel(reg ?? {}, method, ciMethod, kExcluded);

  // ---- Bubble plots (one per continuous moderator) ----
  const bubbleContainer = document.getElementById("bubblePlots");
  bubbleContainer.innerHTML = "";
  if (reg && !reg.rankDeficient) {
    moderators
      .filter(mod => mod.type === "continuous")
      .forEach(mod => {
        const idx = reg.colNames.indexOf(mod.name);
        if (idx >= 1) drawBubble(reg.studiesUsed, reg, mod.name, idx, bubbleContainer);
      });
  }

  drawForest(all, m, { ciMethod, profile });
  drawFunnel(all, m, egger, profile);
  drawInfluencePlot(influence);

  // ---- Cumulative meta-analysis ----
  const cumulativeOrder = document.getElementById("cumulativeOrder")?.value || "input";
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
  drawCumulativeForest(cumResults, profile);

  updateValidationWarnings(studies, excluded, softWarnings);
}