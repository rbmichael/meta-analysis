import { round, transformEffect, transformCI } from "./utils.js";
import { BENCHMARKS } from "./benchmarks.js";
import { compute, meta, metaRegression } from "./analysis.js";

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

  // ---- metaRegression smoke tests ----
  console.log("\n===== META-REGRESSION SMOKE TESTS =====\n");
  let regPass = true;

  function chk(name, val, expected, tol = 0.001) {
    const ok = Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 4)} (expected ${round(expected, 4)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) regPass = false;
  }

  // 1. Intercept-only: beta[0] and tau2 must match meta() RE and tau2.
  //    QE uses RE weights (1/(vi+tau2)), so QE < Q (which uses FE weights 1/vi).
  {
    const s = [{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }, { yi: 3, vi: 1 }];
    const m = meta(s, "DL");
    const r = metaRegression(s, [], "DL");
    console.log("--- Intercept-only (k=3, DL) vs meta() ---");
    chk("beta[0] = RE",   r.beta[0], m.RE);
    chk("tau2",           r.tau2,    m.tau2);
    chk("QE (RE-weighted)", r.QE,    2.0);   // = Σ(1/(vi+tau2))*(yi-RE)² ≠ FE Q
  }

  // 2. Continuous moderator: perfect linear fit => slope=1, intercept=0, QE≈0.
  {
    const s = [1,2,3,4,5].map(x => ({ yi: x, vi: 0.01, x }));
    const r = metaRegression(s, [{ key: "x", type: "continuous" }], "DL");
    console.log("--- Continuous moderator, perfect fit (k=5, DL) ---");
    chk("intercept ≈ 0", r.beta[0], 0, 0.01);
    chk("slope ≈ 1",     r.beta[1], 1, 0.01);
    chk("QE ≈ 0",        r.QE,      0, 0.01);
  }

  // 3. Categorical moderator: two groups, known group means.
  //    Group A: yi=1,1,1 (vi=0.1); Group B: yi=3,3,3 (vi=0.1)
  //    Intercept = mean(A) = 1; dummy_B = mean(B) - mean(A) = 2.
  {
    const s = [
      { yi: 1, vi: 0.1, grp: "A" }, { yi: 1, vi: 0.1, grp: "A" }, { yi: 1, vi: 0.1, grp: "A" },
      { yi: 3, vi: 0.1, grp: "B" }, { yi: 3, vi: 0.1, grp: "B" }, { yi: 3, vi: 0.1, grp: "B" }
    ];
    const r = metaRegression(s, [{ key: "grp", type: "categorical" }], "DL");
    console.log("--- Categorical moderator, 2 groups (k=6, DL) ---");
    chk("intercept (mean A) ≈ 1", r.beta[0], 1, 0.01);
    chk("dummy_B ≈ 2",            r.beta[1], 2, 0.01);
    chk("QE ≈ 0",                 r.QE,      0, 0.01);
  }

  console.log(regPass ? "\n✅ ALL META-REGRESSION TESTS PASSED" : "\n❌ SOME META-REGRESSION TESTS FAILED");

  // ===== INTEGRATION: intercept-only regression must match meta() exactly =====
  // For every existing benchmark, metaRegression([], method) must give
  // beta[0] ≈ RE and tau2 ≈ tau2 from meta(). This verifies end-to-end consistency
  // across all effect types and tau² estimators.
  console.log("\n===== INTERCEPT-ONLY REGRESSION vs META() =====\n");
  let intPass = true;

  function ichk(name, val, expected, field) {
    const ok = approxEqual(val, expected, field);
    console.log(`  ${name}: ${round(val, 4)} vs ${round(expected, 4)} → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) intPass = false;
  }

  BENCHMARKS.forEach(test => {
    const tauMethod = test.tauMethod || "REML";
    const studies = test.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi) };
      const s = compute(d, test.type, { hedgesCorrection: test.correction === "hedges" });
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    }).filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);

    const m   = meta(studies, tauMethod);
    const reg = metaRegression(studies, [], tauMethod);

    console.log(`--- ${test.name} ---`);
    ichk("beta[0] = RE", reg.beta[0], m.RE,   "FE");   // "FE" field = abs 0.01 tolerance
    ichk("tau2",         reg.tau2,    m.tau2,  "tau2");
  });

  console.log(intPass ? "\n✅ ALL INTEGRATION TESTS PASSED" : "\n❌ SOME INTEGRATION TESTS FAILED");

  // ===== REGRESSION BENCHMARK: BCG + absolute latitude (REML) =====
  // Source: Viechtbauer (2010), JSS; metafor rma(yi, vi, mods=~ablat, method="REML")
  // Expected values from metafor 4.x output for dat.bcg.
  console.log("\n===== REGRESSION BENCHMARK: BCG + ablat (REML) =====\n");
  let regBenchPass = true;

  function rbchk(name, val, expected, field) {
    const ok = approxEqual(val, expected, field);
    console.log(`  ${name}: ${round(val, 4)} vs ${round(expected, 4)} → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) regBenchPass = false;
  }

  {
    // Absolute latitude for the 13 BCG studies (same order as BENCHMARKS[0].data).
    // Source: dat.bcg$ablat from the metadat R package.
    const ablat = [44, 55, 42, 52, 13, 44, 19, 13, 27, 42, 18, 33, 33];
    const bcg = BENCHMARKS[0]; // BCG GENERIC (log RR, pre-computed yi/vi)
    const studies = bcg.data.map((d, i) => ({
      yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi), ablat: ablat[i]
    }));

    const reg = metaRegression(studies, [{ key: "ablat", type: "continuous" }], "REML");

    console.log("--- BCG log RR ~ ablat (k=13, REML) ---");
    // Slope independently verified from metafor / Viechtbauer (2010).
    // Intercept and residual tau² verified qualitatively only — exact numerical
    // comparison against metafor requires a live R session.
    rbchk("ablat slope", reg.beta[1], -0.0291, "FE");  // abs 0.01, matches metafor

    // Qualitative: higher latitude → more BCG protection; ablat explains heterogeneity
    const slopeNeg    = reg.beta[1] < 0;
    const QMsig       = reg.QMp < 0.01;
    const tau2reduced  = reg.tau2 < bcg.expected.tau2 * 0.7; // ablat explains >30% of heterogeneity
    const tau2positive = reg.tau2 > 0;
    const R2positive   = reg.R2 > 0 && reg.R2 < 1;          // pseudo-R² in (0,1)
    console.log(`  slope is negative: ${slopeNeg ? "PASS" : "FAIL"}`);
    console.log(`  QM significant (p<0.01): ${QMsig ? "PASS" : "FAIL"}`);
    console.log(`  tau2 reduced vs unconditional (${bcg.expected.tau2}): ${tau2reduced ? "PASS" : "FAIL"}`);
    console.log(`  residual tau2 > 0: ${tau2positive ? "PASS" : "FAIL"}`);
    console.log(`  R² in (0,1): ${R2positive ? "PASS" : "FAIL"} (R²=${round(reg.R2, 4)})`);
    if (!slopeNeg || !QMsig || !tau2reduced || !tau2positive || !R2positive) regBenchPass = false;
  }

  console.log(regBenchPass ? "\n✅ REGRESSION BENCHMARK PASSED" : "\n❌ REGRESSION BENCHMARK FAILED");

  // ===== COR / ZCOR UNIT TESTS =====
  // Tests that the generic benchmark loop cannot cover:
  //   1. ZCOR back-transform round-trip (atanh → tanh = identity)
  //   2. COR vi formula spot-check
  //   3. Edge-case guarding (|r|≥1, n too small)
  console.log("\n===== COR / ZCOR UNIT TESTS =====\n");
  let corPass = true;

  function cchk(name, val, expected, tol = 1e-6) {
    const ok = isFinite(val) && Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 6)} (expected ${round(expected, 6)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) corPass = false;
  }
  function cchkNaN(name, val) {
    const ok = !isFinite(val);
    console.log(`  ${name}: ${val} → ${ok ? "PASS (NaN/Inf as expected)" : "FAIL (expected NaN)"}`);
    if (!ok) corPass = false;
  }

  // 1. ZCOR compute(): yi = atanh(r), vi = 1/(n-3)
  console.log("--- ZCOR compute() ---");
  {
    const s = compute({ r: 0.5, n: 53 }, "ZCOR");
    cchk("yi = atanh(0.5)", s.yi, Math.atanh(0.5));
    cchk("vi = 1/50",       s.vi, 1 / 50);
    cchk("se = sqrt(vi)",   s.se, Math.sqrt(1 / 50));
  }

  // 2. COR compute(): yi = r, vi = (1-r²)²/(n-1)
  console.log("--- COR compute() ---");
  {
    const s = compute({ r: 0.5, n: 53 }, "COR");
    cchk("yi = r",                s.yi, 0.5);
    cchk("vi = (1-0.25)²/52",    s.vi, (0.75 * 0.75) / 52);
  }

  // 3. ZCOR back-transform: tanh(atanh(r)) = r (round-trip)
  console.log("--- ZCOR back-transform round-trip ---");
  {
    const rs = [0.1, 0.3, 0.5, 0.7, 0.9, -0.4];
    rs.forEach(r => {
      const z  = Math.atanh(r);
      const rt = transformEffect(z, "ZCOR");   // tanh(z)
      cchk(`tanh(atanh(${r})) = ${r}`, rt, r, 1e-10);
    });
  }

  // 4. ZCOR CI back-transform: both bounds transformed
  console.log("--- ZCOR transformCI ---");
  {
    const { lb, ub } = transformCI(Math.atanh(0.3), Math.atanh(0.7), "ZCOR");
    cchk("CI lb back-transformed to 0.3", lb, 0.3, 1e-10);
    cchk("CI ub back-transformed to 0.7", ub, 0.7, 1e-10);
  }

  // 5. Edge cases: invalid inputs return NaN yi
  console.log("--- Edge cases ---");
  cchkNaN("ZCOR r=1  → NaN",  compute({ r:  1.0, n: 50 }, "ZCOR").yi);
  cchkNaN("ZCOR r=-1 → NaN",  compute({ r: -1.0, n: 50 }, "ZCOR").yi);
  cchkNaN("ZCOR n=3  → NaN",  compute({ r:  0.5, n:  3 }, "ZCOR").yi);  // n-3=0
  cchkNaN("COR  r=1  → NaN",  compute({ r:  1.0, n: 50 }, "COR" ).yi);
  cchkNaN("COR  n=1  → NaN",  compute({ r:  0.5, n:  1 }, "COR" ).yi);

  console.log(corPass ? "\n✅ ALL COR/ZCOR UNIT TESTS PASSED" : "\n❌ SOME COR/ZCOR UNIT TESTS FAILED");
}
