function approxEqual(a, b, tol=0.05){
 return Math.abs(a - b) < tol;
}

function runTests(){
 console.log("===== RUNNING BENCHMARK TESTS =====");

 let allPass = true;

 BENCHMARKS.forEach(test => {

  const studies = test.data.map(d => compute(d, test.type));
  const m = meta(studies);

  console.log(`\n--- ${test.name} ---`);

  function check(name, val, expected){
   const ok = approxEqual(val, expected);
   console.log(`${name}: ${val.toFixed(3)} vs ${expected} → ${ok ? "PASS" : "FAIL"}`);
   if(!ok) allPass = false;
  }

  check("FE", m.FE, test.expected.FE);
  check("RE", m.RE, test.expected.RE);
  check("tau2", m.tau2, test.expected.tau2);
  check("I2", m.I2, test.expected.I2);

 });

 if(allPass){
  console.log("\n✅ ALL BENCHMARK TESTS PASSED");
 } else {
  console.error("\n❌ SOME TESTS FAILED");
 }
}