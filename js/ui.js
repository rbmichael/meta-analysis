// ================= UI =================
import { compute, eggerTest, meta, influenceDiagnostics, subgroupAnalysis } from "./analysis.js";
import { fmt, transformEffect, transformCI } from "./utils.js";
import { runTests } from "./tests.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel } from "./plots.js";

document.getElementById("addStudy").addEventListener("click", addRow);
document.getElementById("run").addEventListener("click", runAnalysis);
document.getElementById("import").addEventListener("click", importCSV);
document.getElementById("export").addEventListener("click", exportCSV);

document.getElementById("effectType").addEventListener("change", runAnalysis);
document.getElementById("tauMethod").addEventListener("change", runAnalysis);
document.getElementById("ciMethod").addEventListener("change", runAnalysis);

const trimFillCheckbox = document.getElementById("useTrimFill");
const adjustedCheckbox = document.getElementById("useTFAdjusted");

// Initial state
adjustedCheckbox.disabled = !trimFillCheckbox.checked;

// Update on change
trimFillCheckbox.addEventListener("change", () => {
  adjustedCheckbox.disabled = !trimFillCheckbox.checked;
  // Optionally uncheck adjusted if disabled
  if(!trimFillCheckbox.checked) adjustedCheckbox.checked = false;

  runAnalysis();
});

adjustedCheckbox.addEventListener("change", runAnalysis);

function addRow(values){
 const row = document.getElementById("inputTable").insertRow();
 const v = values || ["","","","","","",""];

 row.innerHTML = `
 <td><input value="${v[0]||""}"></td>
 <td><input value="${v[1]||""}"></td>
 <td><input value="${v[2]||""}"></td>
 <td><input value="${v[3]||""}"></td>
 <td><input value="${v[4]||""}"></td>
 <td><input value="${v[5]||""}"></td>
 <td><input value="${v[6]||""}"></td>
 <td><input class="group" type="text" value="${v[7]||""}" placeholder="e.g. A"></td>
 <td>
   <button class="remove-btn">✖</button>
   <button class="clear-btn">🧹</button>
 </td>
 `;

 row.querySelectorAll("input").forEach(input => {
  input.addEventListener("input", () => {
    validateRow(row);
    runAnalysis();
  });
 });

 // attach listeners
 row.querySelector(".remove-btn").addEventListener("click", function(){
   removeRow(this);
 });

 row.querySelector(".clear-btn").addEventListener("click", function(){
   clearRow(this);
 });
}

function removeRow(btn){
 const table = document.getElementById("inputTable");
 if(table.rows.length <= 2) return; // keep at least 1 data row

 const row = btn.closest("tr");
 row.remove();
 runAnalysis();
}

function clearRow(btn){
 const row = btn.closest("tr");
 const inputs = row.querySelectorAll("input");

 inputs.forEach(input => input.value = "");

 runAnalysis();
}

function validateRow(row){

 const inputs = row.querySelectorAll("input");

 // column meanings:
 // 0 = label (ignore)
 // 1–6 = numeric

 let valid = true;

 inputs.forEach((input, idx) => {

  input.classList.remove("input-error");

  if(idx === 0 || idx === 7) return; // label

  const val = input.value.trim();

  if(val === "" || isNaN(val)){
    input.classList.add("input-error");
    valid = false;
    return;
  }

  const num = +val;

  // optional stricter rules
  if(idx === 3 || idx === 6){ // n1, n2
    if(num <= 0){
      input.classList.add("input-error");
      valid = false;
    }
  }

  if(idx === 2 || idx === 5){ // SDs
    if(num <= 0){
      input.classList.add("input-error");
      valid = false;
    }
  }

 });

 // row-level highlight
 if(!valid){
  row.classList.add("row-error");
 } else {
  row.classList.remove("row-error");
 }

 return valid;
}

function init(){
 addRow(["Study1",10,2,50,8,2,50,"A"]);
 addRow(["Study2",12,3,40,9,3,40,"A"]);
 addRow(["Study3",9,2,30,7,2,30,"B"]);

 document.querySelectorAll("#inputTable tr").forEach((row,i)=>{
  if(i === 0) return;
  validateRow(row);
 });
 
 runAnalysis();
 runTests();
}
window.onload=init;

function importCSV(){
 const file=document.getElementById('csvFile').files[0];
 if(!file) return;

 const reader=new FileReader();
 reader.onload=e=>{
  const rows=e.target.result.split('\n').slice(1);

  rows.forEach(r=>{
   const v=r.split(',');
   if(v.length>=7) addRow(v);
  });

  runAnalysis();
 };

 reader.readAsText(file);
}

function exportCSV(){
 let rows=["Study,Mean1,SD1,n1,Mean2,SD2,n2"];

 document.querySelectorAll("#inputTable tr").forEach((r,i)=>{
  if(i===0) return;

  const vals=[...r.querySelectorAll('input')].map(x=>x.value);
  if(vals.some(v=>v!=="")) rows.push(vals.join(','));
 });

 const blob=new Blob([rows.join('\n')]);
 const a=document.createElement('a');
 a.href=URL.createObjectURL(blob);
 a.download="meta_data.csv";
 a.click();
}

// ================= ANALYSIS =================
function runAnalysis(){
	const type=document.getElementById("effectType").value;
	const rows=document.querySelectorAll("#inputTable tr");

	let studies = [];

	for (let i = 1; i < rows.length; i++) {
	  const row = rows[i];
	  const inputs = [...row.querySelectorAll("input")];
	  const v = inputs.map(x => x.value);

	  const isValid = validateRow(row);
	  if (!isValid) continue;

	  // ✅ Get group safely via class
	  const group = row.querySelector(".group")?.value.trim() || "";

		// Compute effect size
		let study;

		if (type === "OR" || type === "RR") {

		  study = compute({
			label: v[0],
			a: +v[1],
			b: +v[2],
			c: +v[3],
			d: +v[4]
		  }, type);

		} else {

		  study = compute({
			label: v[0],
			m1: +v[1], sd1: +v[2], n1: +v[3],
			m2: +v[4], sd2: +v[5], n2: +v[6]
		  }, type);
		}

	  // ✅ Attach group
	  study.group = group;

	  studies.push(study);
	}

 if(!studies.length) return;

 const method = document.getElementById("tauMethod")?.value || "DL";
 const ciMethod = document.getElementById("ciMethod")?.value || "normal";
 const useTF = document.getElementById("useTrimFill")?.checked;
 const useTFAdjusted = document.getElementById("useTFAdjusted")?.checked;

 let tf = [];
 let all = studies;

 if(useTF){
   tf = trimFill(studies);
   all = [...studies, ...tf];
 }

	// meta-analysis
	const m = meta(studies, method, ciMethod);
	const egger = eggerTest(studies);
	const influence = influenceDiagnostics(studies, method, ciMethod);
	const subgroup = subgroupAnalysis(studies, method, ciMethod);

	let influenceHTML = `
	<b>Influence diagnostics:</b><br>
	<table border="1">
	  <tr>
		<th>Study</th>
		<th>RE (LOO)</th>
		<th>Δτ²</th>
		<th>Std Residual</th>
		<th>DFBETA</th>
		<th>Flag</th>
	  </tr>
	`;

	influence.forEach(d => {
	  const isFlagged = d.outlier || d.influential;

	  const rowClass = isFlagged
		? "style='background:#ffe6e6;'"
		: "";

	  let flagText = "";
	  if (d.outlier) flagText = "Outlier";
	  else if (d.influential) flagText = "Influential";

	  influenceHTML += `
		<tr ${rowClass}>
		  <td>${d.label}</td>
		  <td>${isFinite(d.RE_loo) ? d.RE_loo.toFixed(3) : "NA"}</td>
		  <td>${isFinite(d.deltaTau2) ? d.deltaTau2.toFixed(3) : "NA"}</td>
		  <td>${isFinite(d.stdResidual) ? d.stdResidual.toFixed(3) : "NA"}</td>
		  <td>${isFinite(d.DFBETA) ? d.DFBETA.toFixed(3) : "NA"}</td>
		  <td>${flagText}</td>
		</tr>
	  `;
	});

	influenceHTML += "</table>";
	 
	// ================= SUBGROUP TABLE =================
	let subgroupHTML = "";

	if (subgroup && subgroup.G >= 2) {
	  subgroupHTML += `
	  <b>Subgroup analysis:</b><br>
	  <table border="1">
		<tr>
		  <th>Group</th>
		  <th>k</th>
		  <th>Effect</th>
		  <th>SE</th>
		  <th>CI</th>
		  <th>τ²</th>
		  <th>I² (%)</th>
		</tr>
	  `;

	  Object.entries(subgroup.groups).forEach(([g, r]) => {
		// Detect single-study groups
		const isSingle = r.k === 1;
		
		const y_disp = transformEffect(r.y, type);
		const ci_disp = transformCI(r.ci.lb, r.ci.ub, type);

		subgroupHTML += `
		  <tr>
			<td>${g}</td>
			<td>${r.k}</td>
			<td>${isFinite(y_disp) ? fmt(y_disp) : "NA"}</td>
			<td>${isSingle ? "NA" : isFinite(r.se) ? fmt(r.se) : "NA"}</td>
			<td>[${isSingle ? "NA" : fmt(ci_disp.lb)}, ${isSingle ? "NA" : fmt(ci_disp.ub)}]</td>
			<td>${isSingle ? "NA" : isFinite(r.tau2) ? r.tau2.toFixed(3) : "0"}</td>
			<td>${isSingle ? "NA" : isFinite(r.I2) ? r.I2.toFixed(1) : "0"}</td>
		  </tr>
		`;
	  });

	  subgroupHTML += `
		<tr style="font-weight:bold;">
		  <td colspan="7">
			Q_between = ${subgroup.Qbetween.toFixed(3)}, 
			df = ${subgroup.df}, 
			p = ${subgroup.p.toFixed(4)}
		  </td>
		</tr>
	  </table>
	  `;
	} else {
	  subgroupHTML = "<i>Add at least 2 groups to see subgroup analysis</i><br>";
	}
 
	 // compute adjusted RE if requested
	 let mAdjusted = null;
	 if(useTF && useTFAdjusted && tf.length > 0){
	   mAdjusted = meta([...studies, ...tf]);
	 }

	// Transform helpers
	const FE_disp = transformEffect(m.FE, type);
	const RE_disp = transformEffect(m.RE, type);
	const ci_disp = transformCI(m.ciLow, m.ciHigh, type);
	const pred_disp = transformCI(m.predLow, m.predHigh, type);

	// Trim-fill adjusted
	let RE_adj_disp = null;
	if(useTF && mAdjusted){
	  RE_adj_disp = transformEffect(mAdjusted.RE, type);
	}

	let effectLabel = "Effect";

	if (type === "OR") effectLabel = "Odds Ratio";
	else if (type === "RR") effectLabel = "Risk Ratio";
	else if (type === "SMD") effectLabel = "SMD";
	else if (type === "MD") effectLabel = "Mean Difference";

	document.getElementById("results").innerHTML=`
	  <b>${effectLabel} (FE):</b> ${fmt(FE_disp)} |
	  <b>${effectLabel} (RE):</b> ${fmt(RE_disp)}<br>
	  ${useTF && mAdjusted ? `<b>RE (adjusted):</b> ${fmt(RE_adj_disp)}<br>` : ""}
	  CI [${fmt(ci_disp.lb)}, ${fmt(ci_disp.ub)}]<br>
	  τ²=${fmt(m.tau2)} | I²=${fmt(m.I2)}%<br>
	  ${m.dist}-stat=${fmt(m.stat)} | p=${fmt(m.pval)}<br>
	  Prediction=[${fmt(pred_disp.lb)}, ${fmt(pred_disp.ub)}]<br>
	  <b>Egger intercept:</b> ${fmt(egger.intercept)} | p=${fmt(egger.p)}<br>
	  <b>Trim & Fill:</b> ${useTF ? "ON" : "OFF"} (${tf.length} filled studies)
	`;
 
 document.getElementById("results").innerHTML += influenceHTML;
 document.getElementById("results").innerHTML += subgroupHTML;

 drawForest(all,m);
 drawFunnel(all,m);
}