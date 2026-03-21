// ================= UI =================
import { compute, eggerTest, meta } from "./analysis.js";
import { fmt } from "./utils.js";
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

  if(idx === 0) return; // label

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
 addRow(["A",10,2,50,8,2,50]);
 addRow(["B",12,3,40,9,3,40]);
 addRow(["C",9,2,30,7,2,30]);

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

 let studies=[];

 for(let i=1;i<rows.length;i++){
  const v=[...rows[i].querySelectorAll('input')].map(x=>x.value);

  const row = rows[i];
  const isValid = validateRow(row);

  if(!isValid) continue;

  studies.push(compute({
   label:v[0],
   m1:+v[1],sd1:+v[2],n1:+v[3],
   m2:+v[4],sd2:+v[5],n2:+v[6]
  },type));
 }

 if(!studies.length) return;

 const method = document.getElementById("tauMethod")?.value || "DL";
 const ciMethod = document.getElementById("ciMethod")?.value || "normal";
 const m = meta(studies, method, ciMethod);
 const tf=trimFill(studies);
 const egger = eggerTest(studies);
 const all=[...studies,...tf];

 document.getElementById("results").innerHTML=`
  <b>FE:</b> ${fmt(m.FE)} |
  <b>RE:</b> ${fmt(m.RE)}<br>
  CI [${fmt(m.ciLow)}, ${fmt(m.ciHigh)}]<br>
  τ²=${fmt(m.tau2)} | I²=${fmt(m.I2)}%<br>
  ${m.dist}-stat=${fmt(m.stat)} | p=${fmt(m.pval)}<br>
  Prediction=[${fmt(m.predLow)}, ${fmt(m.predHigh)}]<br>
  <b>Egger intercept:</b> ${fmt(egger.intercept)} | p=${fmt(egger.p)}
 `;

 drawForest(all,m);
 drawFunnel(all,m);
}