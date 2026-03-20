function approxEqual(a, b, tol=0.01){
 return Math.abs(a - b) < tol;
}

function runTests(){
 console.log("Running tests...");

 const testData = [
  {label:"A", m1:10, sd1:2, n1:50, m2:8, sd2:2, n2:50},
  {label:"B", m1:12, sd1:3, n1:40, m2:9, sd2:3, n2:40},
  {label:"C", m1:9, sd1:2, n1:30, m2:7, sd2:2, n2:30}
 ];

 const studies = testData.map(d => compute(d,"MD"));
 const m = meta(studies);

 let pass = true;

 function check(name, val, expected){
  const ok = approxEqual(val, expected);
  console.log(`${name}: ${val.toFixed(3)} vs ${expected} → ${ok ? "PASS" : "FAIL"}`);
  if(!ok) pass = false;
 }

 const expected = {
  FE: 2.1823,
  RE: 2.1823,
  tau2: 0.0000,
  I2: 0.0000
 };

// Expected values (from R metafor)
 check("FE", m.FE, expected.FE);
 check("RE", m.RE, expected.RE);
 check("tau2", m.tau2, expected.tau2);
 check("I2", m.I2, expected.I2);

 if(pass){
  console.log("✅ ALL TESTS PASSED");
 } else {
  console.error("❌ TESTS FAILED");
 }

 const identical = [
  {label:"A", m1:10, sd1:2, n1:50, m2:8, sd2:2, n2:50},
  {label:"B", m1:10, sd1:2, n1:50, m2:8, sd2:2, n2:50}
 ];

 const m2 = meta(identical.map(d=>compute(d,"MD")));

 console.log("Identical studies τ²:", m2.tau2); // should be 0

 const extreme = [
  {label:"A", m1:10, sd1:0.0001, n1:50, m2:8, sd2:0.0001, n2:50}
 ];

 const m3 = meta(extreme.map(d=>compute(d,"MD")));

 console.log("Extreme SE handled:", m3.FE);
}