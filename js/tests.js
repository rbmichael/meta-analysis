import { round } from "./utils.js";
import { BENCHMARKS } from "./benchmarks.js";
import { compute, meta } from "./analysis.js";

function approxEqual(a, b, tol = 0.01) {
  return Math.abs(a - b) < tol;
}

export function runTests() {
  console.log("===== RUNNING BENCHMARK TESTS =====\n");

  let allPass = true;

  BENCHMARKS.forEach(test => {
    const tauMethod = test.tauMethod || "REML";

    // Build studies array: compute yi/vi from raw inputs if not already present
    const studies = test.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi) };
      const s = compute(d, test.type, { hedgesCorrection: test.correction === "hedges" });
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });

    const m = meta(studies, tauMethod);

    function check(name, val, expected) {
      const ok = approxEqual(val, expected);
      console.log(`  ${name}: ${round(val, 3)} vs ${round(expected, 3)} → ${ok ? "PASS" : "FAIL"}`);
      if (!ok) allPass = false;
    }

    console.log(`--- ${test.name} (${test.type}, ${tauMethod}) ---`);
    check("FE",   m.FE,   test.expected.FE);
    check("RE",   m.RE,   test.expected.RE);
    check("tau2", m.tau2, test.expected.tau2);
    check("I2",   m.I2,   test.expected.I2);
  });

  console.log(allPass ? "\n✅ ALL BENCHMARK TESTS PASSED" : "\n❌ SOME TESTS FAILED");
}
