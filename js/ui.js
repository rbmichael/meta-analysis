// ================= UI =================
import { compute, eggerTest, meta, influenceDiagnostics, subgroupAnalysis } from "./analysis.js";
import { fmt, transformEffect, transformCI } from "./utils.js";
import { runTests } from "./tests.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel } from "./plots.js";

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
	}
};

// ---------------- INITIALIZE ----------------
document.getElementById("addStudy").addEventListener("click", () => addRow());
document.getElementById("run").addEventListener("click", runAnalysis);
document.getElementById("import").addEventListener("click", importCSV);
document.getElementById("export").addEventListener("click", exportCSV);

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

  // ---- Group column ----
  const groupCell = row.insertCell();
  const groupInput = document.createElement("input");
  groupInput.className = "group";
  groupInput.placeholder = "e.g. A";
  groupInput.value = v[v.length - 1] || "";
  groupCell.appendChild(groupInput);

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

    // Skip Study + Group
    if (idx === 0 || idx === inputs.length - 1) return;

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
    if (key === "n" && num <= 1)         { inputValid = false; errorMsg = `${key} must be ≥ 2`; }
    if (key === "r" && (num < -1 || num > 1)) { inputValid = false; errorMsg = `${key} must be between -1 and 1`; }

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

  else if (type === "GENERIC") {
    const { vi } = studyInput;
    if (isFinite(vi) && vi > 1) {
      warnings.push(`⚠️ ${label}: large variance (low precision study)`);
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
      messages.push("⚠️ Egger test requires ≥ 3 studies");
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
    updateTableHeaders();

    // Check required columns
    const profile = effectProfiles[detectedType];
    const missingCols = profile.inputs.filter(c => !headerLower.includes(c.toLowerCase()));
    if (missingCols.length > 0) {
      warningDiv.textContent = `Warning: CSV is missing required columns: ${missingCols.join(', ')}`;
      warningDiv.style.display = "block";
    }

    // Map headers to indices
    const headerMap = {};
    headers.forEach((h, idx) => headerMap[h.toLowerCase()] = idx);

    // Clear table and add rows
    const table = document.getElementById("inputTable");
    while (table.rows.length > 1) table.deleteRow(1);

	const rowsData = allRows.slice(1);
	rowsData.forEach(r => {
	  const values = r.split(',').map(s => s.trim());
	  const v = [];

	  // ---- Study column first ----
	  const studyIdx = headerMap['study'];
	  v.push(studyIdx !== undefined ? values[studyIdx] : "");

	  // ---- Effect columns ----
	  profile.inputs.forEach(col => {
		const idx = headerMap[col.toLowerCase()];
		v.push(idx !== undefined ? values[idx] : "");
	  });

	  // ---- Group column ----
	  const groupIdx = headerMap['group'];
	  v.push(groupIdx !== undefined ? values[groupIdx] : "");

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

  // Build headers dynamically
  const headers = ["Study", ...profile.inputs, "Group"];
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
		["Study 1", 12, 8, 15, 10, "A"],  // a=12, b=8, c=15, d=10
		["Study 2", 20, 10, 18, 12, "A"],
		["Study 3", 8, 7, 10, 9, "B"]
	]
  };

  const rows = exampleData[type] || [];
  rows.forEach(row => addRow(row));
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

  const egger = eggerTest(studies);
  const influence = influenceDiagnostics(studies, method, ciMethod);
  const subgroup = subgroupAnalysis(studies, method, ciMethod);

  let influenceHTML = `<b>Influence diagnostics:</b><br>
    <table border="1">
      <tr><th>Study</th><th>RE (LOO)</th><th>Δτ²</th><th>Std Residual</th><th>DFBETA</th><th>Flag</th></tr>`;
  influence.forEach(d => {
    const rowClass = d.outlier || d.influential ? "style='background:#ffe6e6;'" : "";
    let flagText = d.outlier ? "Outlier" : d.influential ? "Influential" : "";
    influenceHTML += `<tr ${rowClass}><td>${d.label}</td><td>${isFinite(d.RE_loo)?fmt(d.RE_loo):"NA"}</td>
      <td>${isFinite(d.deltaTau2)?fmt(d.deltaTau2):"NA"}</td><td>${isFinite(d.stdResidual)?fmt(d.stdResidual):"NA"}</td>
      <td>${isFinite(d.DFBETA)?fmt(d.DFBETA):"NA"}</td><td>${flagText}</td></tr>`;
  });
  influenceHTML += "</table>";

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
    τ²=${fmt(m.tau2)} | I²=${fmt(m.I2)}%<br>
    ${m.dist}-stat=${fmt(m.stat)} | p=${fmt(m.pval)}<br>
    Prediction=[${fmt(pred_disp.lb)}, ${fmt(pred_disp.ub)}]<br>
    <b>Egger intercept:</b> ${fmt(egger.intercept)} | p=${fmt(egger.p)}<br>
    <b>Trim & Fill:</b> ${useTF?"ON":"OFF"} (${tf.length} filled studies)
  `;
  document.getElementById("results").innerHTML += influenceHTML + subgroupHTML;

  drawForest(all, m, { ciMethod });
  drawFunnel(all, m, egger);
  
  updateValidationWarnings(studies, excluded, softWarnings);
}