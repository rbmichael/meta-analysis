// ================= UI =================
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

 const m=meta(studies);
 const tf=trimFill(studies);
 const all=[...studies,...tf];

 document.getElementById("results").innerHTML=`
 <b>FE:</b> ${m.FE.toFixed(3)} |
 <b>RE:</b> ${m.RE.toFixed(3)}<br>
 τ²=${m.tau2.toFixed(3)} | I²=${m.I2.toFixed(1)}%<br>
 Prediction=[${m.predLow.toFixed(3)}, ${m.predHigh.toFixed(3)}]
 `;

 drawForest(all,m);
 drawFunnel(all,m);
}