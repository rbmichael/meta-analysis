// ================= UI =================
import { compute, meta } from "./analysis.js";
import { fmt } from "./utils.js";
import { runTests } from "./tests.js";
import { trimFill } from "./trimfill.js";
import { drawForest, drawFunnel } from "./plots.js";

document.getElementById("effectType").addEventListener("change", runAnalysis);
document.getElementById("addStudy").addEventListener("click", addRow);
document.getElementById("run").addEventListener("click", runAnalysis);
document.getElementById("import").addEventListener("click", importCSV);
document.getElementById("export").addEventListener("click", exportCSV);

function addRow(values){
 const row=document.getElementById("inputTable").insertRow();
 const v=values||["","","","","","",""];
 row.innerHTML=`<td><input value="${v[0]||""}"></td>
 <td><input value="${v[1]||""}"></td>
 <td><input value="${v[2]||""}"></td>
 <td><input value="${v[3]||""}"></td>
 <td><input value="${v[4]||""}"></td>
 <td><input value="${v[5]||""}"></td>
 <td><input value="${v[6]||""}"></td>`;
}

function init(){
 addRow(["A",10,2,50,8,2,50]);
 addRow(["B",12,3,40,9,3,40]);
 addRow(["C",9,2,30,7,2,30]);
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

  if(v.slice(1).some(x=>x===""||isNaN(x))) continue;

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
 const all=[...studies,...tf];

 document.getElementById("results").innerHTML=`
  <b>FE:</b> ${fmt(m.FE)} |
  <b>RE:</b> ${fmt(m.RE)}<br>
  CI [${fmt(m.ciLow)}, ${fmt(m.ciHigh)}]<br>
  τ²=${fmt(m.tau2)} | I²=${fmt(m.I2)}%<br>
  ${m.dist}-stat=${fmt(m.stat)} | p=${fmt(m.pval)}<br>
  Prediction=[${fmt(m.predLow)}, ${fmt(m.predHigh)}]
 `;

 drawForest(all,m);
 drawFunnel(all,m);
}