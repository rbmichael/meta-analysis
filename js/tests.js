import { round } from "./utils.js";
import { BENCHMARKS } from "./benchmarks.js";
import { compute, meta } from "./analysis.js";

// Tolerances vary by field:
//   FE, RE  — absolute 0.01   (pooled estimates are on a stable scale)
//   tau2    — 5% relative     (spans several orders of magnitude across benchmarks)
//   I2      — absolute 0.2    (percentage, small noise acceptable)
//   yi      — absolute 0.001  (per-study effect sizes, verified to high precision)
function approxEqual(a, b, field) {
  if (!isFinite(a) || !isFinite(b)) return false;
  if (field === "tau2") {
    const scale = Math.max(Math.abs(b), 0.001);
    return Math.abs(a - b) / scale < 0.05;
  }
  if (field === "I2")   return Math.abs(a - b) < 0.2;
  if (field === "yi")   return Math.abs(a - b) < 0.001;
  return Math.abs(a - b) < 0.01;
}

export function runTests() {
  console.log("===== RUNNING BENCHMARK TESTS =====\n");

  let allPass = true;

  BENCHMARKS.forEach(test => {
    const tauMethod = test.tauMethod || "REML";

    // Build studies array: use pre-computed yi/vi or derive via compute()
    const studies = test.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi) };
      const s = compute(d, test.type, { hedgesCorrection: test.correction === "hedges" });
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });

    const m = meta(studies, tauMethod);

    function check(name, val, expected, field) {
      const ok = approxEqual(val, expected, field);
      console.log(`  ${name}: ${round(val, 4)} vs ${round(expected, 4)} → ${ok ? "PASS" : "FAIL"}`);
      if (!ok) allPass = false;
    }

    console.log(`--- ${test.name} (${test.type}, ${tauMethod}) ---`);
    check("FE",   m.FE,   test.expected.FE,   "FE");
    check("RE",   m.RE,   test.expected.RE,   "RE");
    check("tau2", m.tau2, test.expected.tau2, "tau2");
    check("I2",   m.I2,   test.expected.I2,   "I2");

    // Per-study yi checks (exercises the compute() pipeline for raw-data effect types)
    if (test.expected.yi) {
      studies.forEach((s, i) => {
        const exp = test.expected.yi[i];
        if (exp === undefined) return;
        check(`  yi[${i}] (${test.data[i].label})`, s.yi, exp, "yi");
      });
    }
  });

  console.log(allPass ? "\n✅ ALL BENCHMARK TESTS PASSED" : "\n❌ SOME TESTS FAILED");
}
