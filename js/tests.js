// tests.js (updated runTests – metafor-exact SMD)
import { round } from "./utils.js";
import { BENCHMARKS } from "./benchmarks.js";
import { compute, tau2_REML, RE_mean, FE_mean, I2 } from "./analysis.js";

// Compare two numbers approximately
function approxEqual(a, b, tol = 0.01) {
  return Math.abs(a - b) < tol;
}

export function runTests() {
  console.log("===== RUNNING BENCHMARK TESTS =====\n");

  let allPass = true;

  BENCHMARKS.forEach(test => {

    let studies;

    console.log("Test type/correction:", test.type, test.correction);

    // ---------- SMD with Hedges correction ----------
    if(test.type === "SMD" && test.correction === "hedges") {

      // Always use raw study data to compute Hedges-corrected SMD
      studies = test.data.map(d => {
        console.log("Benchmark input:", d);

        const s = compute(d, "SMD", { hedgesCorrection: true });

        console.log("Computed yi/vi:", s.yi, s.vi);

        // Keep raw data + yi/vi for REML
        return { ...d, yi: s.yi, vi: s.vi };
      });

      console.log(">>> Entering SMD REML branch");
      console.log("Meta input yi/vi:", studies.map(d => ({ yi: d.yi, vi: d.vi })));

      // Compute tau² using metafor-exact REML
      const tau2 = tau2_REML(studies, 1e-10, 100);

      console.log(">>> tau2_REML returned:", tau2);

      // Compute RE and FE using helper functions
      const REval = RE_mean(studies, tau2);
      const FEval = FE_mean(studies);
      const I2val = I2(studies, tau2);

      console.log(`--- ${test.name} (${test.type}) ---`);
      console.table(studies);

      // Check results against benchmark
      function check(name, val, expected) {
        const ok = approxEqual(val, expected);
        console.log(`${name}: ${round(val,3)} vs ${round(expected,3)} → ${ok ? "PASS" : "FAIL"}`);
        if(!ok) allPass = false;
      }

      check("FE", FEval, test.expected.FE);
      check("RE", REval, test.expected.RE);
      check("tau2", tau2, test.expected.tau2);
      check("I2", I2val, test.expected.I2);

    } else {
      // ---------- Non-SMD types ----------
      studies = test.data.map(d => {
        if(d.yi !== undefined && d.vi !== undefined) return { yi: d.yi, vi: d.vi };
        return compute(d, test.type);
      });

      const FEval = FE_mean(studies);
      const REval = FEval; // Non-REML defaults to FE
      const tau2 = 0;
      const I2val = 0;

      console.log(`--- ${test.name} (${test.type}) ---`);
      console.table(studies);

      function check(name, val, expected) {
        const ok = approxEqual(val, expected);
        console.log(`${name}: ${round(val,3)} vs ${round(expected,3)} → ${ok ? "PASS" : "FAIL"}`);
        if(!ok) allPass = false;
      }

      check("FE", FEval, test.expected.FE);
      check("RE", REval, test.expected.RE);
      check("tau2", tau2, test.expected.tau2);
      check("I2", I2val, test.expected.I2);
    }
  });

  console.log(allPass ? "\n✅ ALL BENCHMARK TESTS PASSED" : "\n❌ SOME TESTS FAILED");
}