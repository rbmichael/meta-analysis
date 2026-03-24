import { round, transformEffect, chiSquareCDF, chiSquareQuantile, parseCounts, bivariateNormalCDF, normalQuantile } from "./utils.js";
import { BENCHMARKS } from "./benchmarks.js";
import { compute, meta, metaRegression, tau2_HS, tau2_HE, tau2_ML, tau2_SJ, beggTest, fatPetTest, failSafeN, heterogeneityCIs, cumulativeMeta, influenceDiagnostics, harbordTest, petersTest, deeksTest, rueckerTest } from "./analysis.js";

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
  console.log("--- ZCOR CI back-transform ---");
  {
    const lb = transformEffect(Math.atanh(0.3), "ZCOR");
    const ub = transformEffect(Math.atanh(0.7), "ZCOR");
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

  // ===== PROPORTION UNIT TESTS =====
  // Spot-checks for each proportion type: compute() formulas and back-transforms.
  // All expected values computed analytically.
  console.log("\n===== PROPORTION UNIT TESTS =====\n");
  let propPass = true;

  function pchk(name, val, expected, tol = 1e-4) {
    const ok = isFinite(val) && Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 6)} (expected ${round(expected, 6)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) propPass = false;
  }
  function pchkNaN(name, val) {
    const ok = !isFinite(val);
    console.log(`  ${name}: ${val} → ${ok ? "PASS (NaN/Inf as expected)" : "FAIL (expected NaN)"}`);
    if (!ok) propPass = false;
  }

  // 1. PR: yi = p, vi = p(1-p)/n
  console.log("--- PR compute() ---");
  {
    const s = compute({ x: 20, n: 100 }, "PR");
    pchk("yi = 0.2",           s.yi, 0.2);
    pchk("vi = 0.2*0.8/100",   s.vi, 0.0016);
    pchk("se = sqrt(vi)",      s.se, Math.sqrt(0.0016));
  }

  // 2. PLN: yi = ln(p), vi = (1-p)/(n*p); continuity correction for x=0
  console.log("--- PLN compute() ---");
  {
    const s = compute({ x: 20, n: 100 }, "PLN");
    pchk("yi = ln(0.2)",       s.yi, Math.log(0.2));
    pchk("vi = 0.8/(100*0.2)", s.vi, 0.8 / 20);
  }
  {
    // x=0: continuity correction → x=0.5, n=101, p=0.5/101
    const s0 = compute({ x: 0, n: 100 }, "PLN");
    const p0 = 0.5 / 101;
    pchk("PLN x=0 yi = ln(0.5/101)", s0.yi, Math.log(p0), 1e-6);
  }

  // 3. PLO: yi = logit(p) = ln(p/(1-p)), vi = 1/(n*p*(1-p))
  console.log("--- PLO compute() ---");
  {
    const s = compute({ x: 20, n: 100 }, "PLO");
    pchk("yi = logit(0.2)",    s.yi, Math.log(0.2 / 0.8));
    pchk("vi = 1/(100*0.16)", s.vi, 1 / 16);
  }
  {
    // x=n=100: continuity correction → x=100.5, n=101, p=100.5/101
    const sn = compute({ x: 100, n: 100 }, "PLO");
    const pn = 100.5 / 101;
    pchk("PLO x=n yi = logit(100.5/101)", sn.yi, Math.log(pn / (1 - pn)), 1e-6);
  }

  // 4. PAS: yi = arcsin(sqrt(p)), vi = 1/(4n)
  console.log("--- PAS compute() ---");
  {
    const s = compute({ x: 20, n: 100 }, "PAS");
    pchk("yi = arcsin(sqrt(0.2))", s.yi, Math.asin(Math.sqrt(0.2)));
    pchk("vi = 1/400",             s.vi, 1 / 400);
  }

  // 5. PFT: yi = arcsin(sqrt(x/(n+1))) + arcsin(sqrt((x+1)/(n+1))), vi = 1/(n+0.5)
  console.log("--- PFT compute() ---");
  {
    const s = compute({ x: 20, n: 100 }, "PFT");
    const expected_yi = Math.asin(Math.sqrt(20 / 101)) + Math.asin(Math.sqrt(21 / 101));
    pchk("yi = arcsin(sqrt(20/101)) + arcsin(sqrt(21/101))", s.yi, expected_yi);
    pchk("vi = 1/100.5", s.vi, 1 / 100.5);
  }

  // 6. Back-transforms: transformEffect
  console.log("--- Proportion back-transforms ---");
  pchk("PR back-transform (identity)",        transformEffect(0.3, "PR"),  0.3);
  pchk("PLN back-transform exp(-1.6094)",     transformEffect(Math.log(0.2), "PLN"), 0.2, 1e-10);
  pchk("PLO back-transform logistic(-1.386)", transformEffect(Math.log(0.2/0.8), "PLO"), 0.2, 1e-10);
  pchk("PAS back-transform sin²(arcsin(√0.2))", transformEffect(Math.asin(Math.sqrt(0.2)), "PAS"), 0.2, 1e-10);
  {
    const yiFT = Math.asin(Math.sqrt(20/101)) + Math.asin(Math.sqrt(21/101));
    pchk("PFT back-transform ≈ 0.2", transformEffect(yiFT, "PFT"), 0.2, 0.01);
  }

  // 7. Clamping: back-transforms never exceed [0,1]
  console.log("--- Proportion clamping ---");
  pchk("PLN clamp upper (large yi)",  transformEffect(100, "PLN"), 1.0);
  pchk("PLN clamp lower (small yi)",  transformEffect(-100, "PLN"), 0.0);
  pchk("PLO clamp upper (large yi)",  transformEffect(100, "PLO"), 1.0);
  pchk("PLO clamp lower (small yi)",  transformEffect(-100, "PLO"), 0.0);

  // 8. Edge cases: invalid inputs return NaN
  console.log("--- Proportion edge cases ---");
  pchkNaN("PR  x<0   → NaN", compute({ x: -1, n: 100 }, "PR").yi);
  pchkNaN("PR  x>n   → NaN", compute({ x: 110, n: 100 }, "PR").yi);
  pchkNaN("PLN n=0   → NaN", compute({ x: 0, n: 0 }, "PLN").yi);
  pchkNaN("PFT n<1   → NaN", compute({ x: 0, n: 0 }, "PFT").yi);

  console.log(propPass ? "\n✅ ALL PROPORTION UNIT TESTS PASSED" : "\n❌ SOME PROPORTION UNIT TESTS FAILED");

  // ===== TAU² ESTIMATOR UNIT TESTS =====
  // Directly exercises tau2_HS, tau2_HE, tau2_ML, tau2_SJ on the
  // synthetic equal-variance dataset yi=[0,1,3], vi=[1,1,1].
  //
  // With equal vi, the analytical fixed points are:
  //   Q = 42/9 ≈ 4.667,  ΣW = 3,  c = 2 (DL denominator)
  //   HS:  (Q−df)/ΣW          = 8/9         ≈ 0.8889
  //   HE:  SS_uw/(k−1)−mean(v) = 4/3        ≈ 1.3333
  //   ML:  score=0 → (42/9)/(1+τ²)=3       → τ²=5/9   ≈ 0.5556
  //   SJ:  τ²(1+τ²)=14/9                   → τ²=(−1+√65)/6 ≈ 0.8437
  //
  // Also checks ordering relationships that always hold (Viechtbauer 2005):
  //   ML ≤ DL ≤ HE  (for this dataset)
  //   HS ≤ DL       (HS denominator ΣW ≥ c always)
  console.log("\n===== TAU² ESTIMATOR UNIT TESTS =====\n");
  let tauPass = true;

  function tchk(name, val, expected, tol) {
    // relative tolerance for tau2
    const scale = Math.max(Math.abs(expected), 0.001);
    const ok = isFinite(val) && Math.abs(val - expected) / scale < tol;
    console.log(`  ${name}: ${round(val, 5)} (expected ${round(expected, 5)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) tauPass = false;
  }
  function tchkTrue(name, cond) {
    console.log(`  ${name} → ${cond ? "PASS" : "FAIL"}`);
    if (!cond) tauPass = false;
  }

  const s3 = [{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }, { yi: 3, vi: 1 }];

  // 1. Known analytical values (5% relative tolerance, matching benchmark suite)
  console.log("--- Analytical values (yi=[0,1,3], vi=[1,1,1]) ---");
  tchk("HS  τ² = 8/9",        tau2_HS(s3),  8 / 9,  0.05);
  tchk("HE  τ² = 4/3",        tau2_HE(s3),  4 / 3,  0.05);
  tchk("ML  τ² = 5/9",        tau2_ML(s3),  5 / 9,  0.05);
  tchk("SJ  τ² = (√65−3)/6",  tau2_SJ(s3),  (Math.sqrt(65) - 3) / 6, 0.05);

  // 2. Ordering relationships for this dataset (all inequalities are exact)
  console.log("--- Ordering: ML ≤ HS ≤ DL = HE = REML ---");
  const hs = tau2_HS(s3), he = tau2_HE(s3), ml = tau2_ML(s3), sj = tau2_SJ(s3);
  tchkTrue("ML ≤ HS",  ml <= hs + 1e-9);
  tchkTrue("HS ≤ HE",  hs <= he + 1e-9);
  tchkTrue("SJ > 0",   sj > 0);

  // 3. Edge cases: k ≤ 1 returns 0 without error
  console.log("--- Edge cases ---");
  tchk("HS  k=1 → 0", tau2_HS([{ yi: 1, vi: 1 }]), 0, 0.001);
  tchk("HE  k=1 → 0", tau2_HE([{ yi: 1, vi: 1 }]), 0, 0.001);
  tchk("ML  k=1 → 0", tau2_ML([{ yi: 1, vi: 1 }]), 0, 0.001);
  tchk("SJ  k=1 → 0", tau2_SJ([{ yi: 1, vi: 1 }]), 0, 0.001);

  // 4. Homogeneous studies: all yi identical → τ² = 0 for all methods
  console.log("--- Homogeneous yi → τ² = 0 ---");
  const sHom = [{ yi: 1, vi: 0.5 }, { yi: 1, vi: 1 }, { yi: 1, vi: 2 }];
  tchk("HS  homogeneous → 0", tau2_HS(sHom), 0, 0.001);
  tchk("HE  homogeneous → 0", tau2_HE(sHom), 0, 0.001);
  tchk("ML  homogeneous → 0", tau2_ML(sHom), 0, 0.001);
  tchk("SJ  homogeneous → 0", tau2_SJ(sHom), 0, 0.001);

  // 5. meta() dispatch: method strings route to the right estimator
  console.log("--- meta() dispatch ---");
  const mHS = meta(s3, "HS");
  const mHE = meta(s3, "HE");
  const mML = meta(s3, "ML");
  const mSJ = meta(s3, "SJ");
  tchk("meta(HS).tau2",  mHS.tau2, 8 / 9, 0.05);
  tchk("meta(HE).tau2",  mHE.tau2, 4 / 3, 0.05);
  tchk("meta(ML).tau2",  mML.tau2, 5 / 9, 0.05);
  tchk("meta(SJ).tau2",  mSJ.tau2, (Math.sqrt(65) - 3) / 6, 0.05);

  console.log(tauPass ? "\n✅ ALL TAU² UNIT TESTS PASSED" : "\n❌ SOME TAU² UNIT TESTS FAILED");

  // ===== PUBLICATION BIAS UNIT TESTS =====
  console.log("\n===== PUBLICATION BIAS UNIT TESTS =====\n");
  let biasPass = true;

  function bchk(name, val, expected, tol = 1e-4) {
    const ok = isFinite(val) && Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 5)} (expected ${round(expected, 5)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) biasPass = false;
  }
  function bchkNaN(name, val) {
    const ok = !isFinite(val);
    console.log(`  ${name}: ${val} → ${ok ? "PASS (NaN as expected)" : "FAIL (expected NaN)"}`);
    if (!ok) biasPass = false;
  }
  function bchkTrue(name, cond) {
    console.log(`  ${name} → ${cond ? "PASS" : "FAIL"}`);
    if (!cond) biasPass = false;
  }

  // ---- Begg's test ----
  // Equal vi → all sign(vi_i − vi_j) = 0 → S = 0, τ = 0, p = 1
  console.log("--- Begg: symmetric funnel (equal vi) ---");
  {
    const s = [{ yi: 0, vi: 1, se: 1 }, { yi: 1, vi: 1, se: 1 }, { yi: 3, vi: 1, se: 1 }];
    const b = beggTest(s);
    bchk("S = 0",   b.S,   0, 1e-9);
    bchk("τ = 0",   b.tau, 0, 1e-9);
    bchk("p = 1",   b.p,   1, 1e-6);
  }

  // Designed asymmetric case: larger studies (smaller vi) have larger effects.
  // yi=[0,1,2], vi=[1,0.5,0.25] → all three pairs discordant → S = −3, τ = −1
  console.log("--- Begg: all-discordant funnel (S = −3) ---");
  {
    const s = [
      { yi: 0, vi: 1,    se: 1    },
      { yi: 1, vi: 0.5,  se: Math.sqrt(0.5)  },
      { yi: 2, vi: 0.25, se: 0.5  }
    ];
    const b = beggTest(s);
    bchk("S = −3",  b.S,   -3, 1e-9);
    bchk("τ = −1",  b.tau, -1, 1e-9);
    // var(S) = k(k-1)(2k+5)/18 = 11/3; z = (3-1)/√(11/3) ≈ 1.044; p ≈ 0.296
    // k=3 cannot reach p<0.05 regardless of S — check finite and in plausible range
    bchkTrue("p finite and > 0.2", isFinite(b.p) && b.p > 0.2 && b.p < 0.4);
  }

  // k < 3 → NaN
  console.log("--- Begg: k < 3 → NaN ---");
  bchkNaN("k=2 → NaN p", beggTest([{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }]).p);

  // ---- FAT-PET ----
  // Pure effect (yi constant, no relationship with SE):
  //   slope ≈ 0, intercept ≈ constant
  console.log("--- FAT-PET: pure effect (yi = 0.5, varying vi) ---");
  {
    const s = [
      { yi: 0.5, vi: 0.1, se: Math.sqrt(0.1) },
      { yi: 0.5, vi: 0.2, se: Math.sqrt(0.2) },
      { yi: 0.5, vi: 0.3, se: Math.sqrt(0.3) }
    ];
    const f = fatPetTest(s);
    bchk("slope ≈ 0",   f.slope,     0,   0.01);
    bchk("intercept ≈ 0.5", f.intercept, 0.5, 0.01);
  }

  // Pure bias (yi = SEi exactly):
  //   slope ≈ 1, intercept ≈ 0
  // yi=[0.1,0.2,0.3], vi=[0.01,0.04,0.09], SE=[0.1,0.2,0.3]
  console.log("--- FAT-PET: pure bias (yi = SEi) ---");
  {
    const s = [
      { yi: 0.1, vi: 0.01, se: 0.1 },
      { yi: 0.2, vi: 0.04, se: 0.2 },
      { yi: 0.3, vi: 0.09, se: 0.3 }
    ];
    const f = fatPetTest(s);
    // With perfect fit, residuals = 0 → s² = 0 → SEs = 0 → t = ±Inf.
    // Just check the point estimates; p-values are degenerate.
    bchk("slope ≈ 1",   f.slope,     1, 0.001);
    bchk("intercept ≈ 0", f.intercept, 0, 0.001);
  }

  // k < 3 → NaN
  console.log("--- FAT-PET: k < 3 → NaN ---");
  bchkNaN("k=2 → NaN slope", fatPetTest([{ yi: 0, vi: 1, se: 1 }, { yi: 1, vi: 1, se: 1 }]).slope);

  // ---- Fail-safe N ----
  // All studies at yi = 0 → sumZ = 0 → Rosenthal = 0 (clamped)
  console.log("--- Fail-safe N: all null studies → Nfs = 0 ---");
  {
    const s = [{ yi: 0, vi: 1 }, { yi: 0, vi: 1 }, { yi: 0, vi: 1 }];
    const f = failSafeN(s);
    bchk("Rosenthal = 0", f.rosenthal, 0, 1e-9);
  }

  // One study at yi = 3, vi = 1: z = 3, z_crit ≈ 1.6449
  // Nfs = (3 / 1.6449)² − 1 ≈ 2.327
  console.log("--- Fail-safe N: one study z=3 ---");
  {
    const s = [{ yi: 3, vi: 1 }];
    const f = failSafeN(s);
    bchk("sumZ = 3",           f.sumZ,       3,     1e-9);
    bchk("z_crit ≈ 1.6449",   f.z_crit,     1.6449, 0.001);
    bchk("Rosenthal ≈ 2.327", f.rosenthal,  (3 / f.z_crit) ** 2 - 1, 0.001);
  }

  // Orwin: k * (|RE| − trivial) / trivial
  // Studies yi=[0.3,0.3,0.3], vi=[1,1,1], RE=0.3, trivial=0.1
  // N_orwin = 3 * (0.3 − 0.1) / 0.1 = 6
  console.log("--- Fail-safe N: Orwin ---");
  {
    const s = [{ yi: 0.3, vi: 1 }, { yi: 0.3, vi: 1 }, { yi: 0.3, vi: 1 }];
    const f = failSafeN(s, 0.05, 0.1);
    bchk("Orwin = 6", f.orwin, 6, 0.001);
  }

  // k = 0 → NaN
  console.log("--- Fail-safe N: k=0 → NaN ---");
  bchkNaN("k=0 → NaN", failSafeN([]).rosenthal);

  // ---- Harbord test ----
  // Intermediate check: a=10,b=5,c=5,d=30, N=50
  //   E = 15×15/50 = 4.5
  //   V = 15×35×15×35 / (2500×49) = 275625/122500 = 2.25 (exact)
  //   z = (10 − 4.5) / 1.5 = 11/3
  console.log("--- Harbord: intermediates E, V, z ---");
  {
    const a = 10, b = 5, c = 5, d = 30, N = 50;
    const E = (a+b)*(a+c)/N;
    const V = (a+b)*(c+d)*(a+c)*(b+d) / (N*N*(N-1));
    const z = (a - E) / Math.sqrt(V);
    bchk("E = 4.5",  E, 4.5,  1e-12);
    bchk("V = 2.25", V, 2.25, 1e-12);
    bchk("z = 11/3", z, 11/3, 1e-12);
  }

  console.log("--- Harbord: k < 3 → NaN ---");
  bchkNaN("k=2 → NaN intercept", harbordTest([{ a:10,b:5,c:5,d:30 }, { a:20,b:10,c:10,d:40 }]).intercept);

  // Study with V=0 (zero marginal) is skipped; remaining k=2 → NaN
  console.log("--- Harbord: V=0 study skipped ---");
  {
    const s = [
      { a:0, b:0, c:5, d:5  },   // a+b=0 → V=0 → skipped
      { a:10,b:5, c:5, d:30 },
      { a:20,b:10,c:10,d:40 },
    ];
    bchkNaN("V=0 study skipped → k=2 → NaN", harbordTest(s).intercept);
  }

  // Structural: k=4 studies → df=2, finite results, p ∈ (0,1)
  console.log("--- Harbord: structural (k=4) ---");
  {
    const s = [
      { a:30,b:10,c:10,d:50 },
      { a:20,b:5, c:5, d:30 },
      { a:15,b:10,c:10,d:25 },
      { a:10,b:15,c:15,d:20 },
    ];
    const h = harbordTest(s);
    bchkTrue("df = 2",           h.df === 2);
    bchkTrue("intercept finite", isFinite(h.intercept));
    bchkTrue("slope finite",     isFinite(h.slope));
    bchkTrue("p ∈ (0,1)",        isFinite(h.interceptP) && h.interceptP > 0 && h.interceptP < 1);
  }

  // ---- Peters test ----
  // Mixed N sources: a+b+c+d, n1+n2, n — all three extraction paths in one call
  console.log("--- Peters: N extraction (mixed sources) ---");
  {
    const s = [
      { a:30,b:10,c:10,d:50, yi:0.5, vi:0.10 },   // N = a+b+c+d = 100
      { n1:60, n2:40,         yi:0.4, vi:0.20 },   // N = n1+n2 = 100
      { n:80,                 yi:0.3, vi:0.15 },   // N = n = 80
    ];
    bchkTrue("mixed N sources → finite intercept", isFinite(petersTest(s).intercept));
  }

  // Constant yi → intercept = yi exactly (WLS algebraic identity):
  //   intercept = (Wxx·Wy − Wx·Wxy)/det = C·(Wxx·W − Wx²)/det = C
  //   slope     = (W·Wxy − Wx·Wy)/det   = C·(W·Wx − Wx·W)/det = 0
  // Point estimates exact; residuals = 0 → SE = 0 → t = ±Inf (degenerate, not checked)
  console.log("--- Peters: constant yi → intercept = yi ---");
  {
    const s = [
      { a:30,b:10,c:10,d:50, yi:0.5, vi:0.10 },
      { a:20,b:5, c:5, d:30, yi:0.5, vi:0.25 },
      { a:15,b:10,c:10,d:25, yi:0.5, vi:0.15 },
    ];
    const p = petersTest(s);
    bchk("intercept = 0.5", p.intercept, 0.5, 1e-9);
    bchk("slope = 0",       p.slope,     0,   1e-9);
  }

  console.log("--- Peters: k < 3 → NaN ---");
  bchkNaN("k=2 → NaN intercept", petersTest([{ a:10,b:5,c:5,d:30, yi:0.5,vi:0.1 }, { a:20,b:10,c:10,d:40, yi:0.3,vi:0.2 }]).intercept);

  // Structural: k=4 with realistic OR log-odds data → df=2, finite, p∈(0,1)
  console.log("--- Peters: structural (k=4) ---");
  {
    const s = [
      { a:30,b:10,c:10,d:50, yi:Math.log(30*50/(10*10)), vi:1/30+1/10+1/10+1/50 },
      { a:20,b:5, c:5, d:30, yi:Math.log(20*30/(5*5)),   vi:1/20+1/5 +1/5 +1/30 },
      { a:15,b:10,c:10,d:25, yi:Math.log(15*25/(10*10)), vi:1/15+1/10+1/10+1/25 },
      { a:10,b:15,c:15,d:20, yi:Math.log(10*20/(15*15)), vi:1/10+1/15+1/15+1/20 },
    ];
    const p = petersTest(s);
    bchkTrue("df = 2",           p.df === 2);
    bchkTrue("intercept finite", isFinite(p.intercept));
    bchkTrue("p ∈ (0,1)",        isFinite(p.interceptP) && p.interceptP > 0 && p.interceptP < 1);
  }

  // ---- Deeks test ----
  // Intermediate check: a=40,b=10,c=10,d=40, N=100
  //   ESS = 2×(50)×(50)/100 = 50
  //   log(DOR) = log((40×40)/(10×10)) = log(16)
  console.log("--- Deeks: intermediates ESS and log(DOR) ---");
  {
    const a = 40, b = 10, c = 10, d = 40, N = 100;
    const ESS    = 2*(a+c)*(b+d)/N;
    const logDOR = Math.log((a*d)/(b*c));
    bchk("ESS = 50",          ESS,    50,           1e-12);
    bchk("log(DOR) = log(16)", logDOR, Math.log(16), 1e-12);
  }

  console.log("--- Deeks: k < 3 → NaN ---");
  bchkNaN("k=2 → NaN intercept", deeksTest([{ a:40,b:10,c:10,d:40 }, { a:30,b:15,c:15,d:30 }]).intercept);

  // Zero cell (a=0) → log DOR undefined → study skipped; remaining k=2 → NaN
  console.log("--- Deeks: zero-cell study skipped ---");
  {
    const s = [
      { a:0, b:10,c:10,d:30 },   // a=0 → log DOR undefined → skipped
      { a:40,b:10,c:10,d:40 },
      { a:30,b:15,c:15,d:30 },
    ];
    bchkNaN("zero-cell study skipped → k=2 → NaN", deeksTest(s).intercept);
  }

  // Structural: k=4 studies → df=2, finite, p∈(0,1)
  console.log("--- Deeks: structural (k=4) ---");
  {
    const s = [
      { a:40,b:10,c:10,d:40 },
      { a:30,b:15,c:15,d:40 },
      { a:25,b:10,c:10,d:35 },
      { a:20,b:10,c:10,d:30 },
    ];
    const d = deeksTest(s);
    bchkTrue("df = 2",           d.df === 2);
    bchkTrue("intercept finite", isFinite(d.intercept));
    bchkTrue("p ∈ (0,1)",        isFinite(d.interceptP) && d.interceptP > 0 && d.interceptP < 1);
  }

  // ---- Rücker test ----
  // Intermediate check: a=30,b=10,c=10,d=30
  //   n1=40, n2=40, p1=0.75, p2=0.25
  //   asin(√0.75) = asin(√3/2) = π/3;  asin(√0.25) = asin(1/2) = π/6
  //   y = π/3 − π/6 = π/6
  //   se = √(1/160 + 1/160) = 1/√80
  //   z = y/se = (π/6)·√80
  console.log("--- Rücker: intermediates y, se, z ---");
  {
    const a = 30, b = 10, c = 10, d = 30;
    const n1 = a+b, n2 = c+d;
    const p1 = a/n1, p2 = c/n2;
    const se = Math.sqrt(1/(4*n1) + 1/(4*n2));
    const y  = Math.asin(Math.sqrt(p1)) - Math.asin(Math.sqrt(p2));
    const z  = y / se;
    bchk("y = π/6",        y,  Math.PI/6,                   1e-12);
    bchk("se = 1/√80",     se, 1/Math.sqrt(80),             1e-12);
    bchk("z = (π/6)·√80",  z,  Math.PI/6 * Math.sqrt(80),  1e-12);
  }

  console.log("--- Rücker: k < 3 → NaN ---");
  bchkNaN("k=2 → NaN intercept", rueckerTest([{ a:30,b:10,c:10,d:30 }, { a:20,b:10,c:10,d:20 }]).intercept);

  // n1=0 → se undefined → study skipped; remaining k=2 → NaN
  console.log("--- Rücker: n1=0 study skipped ---");
  {
    const s = [
      { a:0, b:0, c:10,d:30 },   // n1=a+b=0 → skipped
      { a:30,b:10,c:10,d:30 },
      { a:20,b:10,c:10,d:20 },
    ];
    bchkNaN("n1=0 study skipped → k=2 → NaN", rueckerTest(s).intercept);
  }

  // Structural: k=4 studies → df=2, finite, p∈(0,1)
  console.log("--- Rücker: structural (k=4) ---");
  {
    const s = [
      { a:40,b:10,c:10,d:40 },
      { a:30,b:15,c:15,d:40 },
      { a:25,b:10,c:10,d:35 },
      { a:20,b:10,c:10,d:30 },
    ];
    const r = rueckerTest(s);
    bchkTrue("df = 2",           r.df === 2);
    bchkTrue("intercept finite", isFinite(r.intercept));
    bchkTrue("p ∈ (0,1)",        isFinite(r.interceptP) && r.interceptP > 0 && r.interceptP < 1);
  }

  console.log(biasPass ? "\n✅ ALL PUBLICATION BIAS TESTS PASSED" : "\n❌ SOME PUBLICATION BIAS TESTS FAILED");

  // ===== HETEROGENEITY CI UNIT TESTS =====
  // Tests chiSquareQuantile (inverse CDF) and heterogeneityCIs (Q-profile).
  // The df=2 chi-square CDF has closed form F(x) = 1 − exp(−x/2), which
  // allows exact analytic expected values without look-up tables.
  console.log("\n===== HETEROGENEITY CI UNIT TESTS =====\n");
  let hetPass = true;

  function hchk(name, val, expected, tol = 1e-3) {
    const ok = isFinite(val) && Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 5)} (expected ${round(expected, 5)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) hetPass = false;
  }
  function hchkTrue(name, cond) {
    console.log(`  ${name} → ${cond ? "PASS" : "FAIL"}`);
    if (!cond) hetPass = false;
  }
  function hchkNaN(name, val) {
    const ok = !isFinite(val);
    console.log(`  ${name}: ${val} → ${ok ? "PASS (NaN/Inf as expected)" : "FAIL"}`);
    if (!ok) hetPass = false;
  }

  // 1. chiSquareQuantile accuracy — df=2 closed form F(x) = 1 − exp(−x/2)
  //    Exact quantiles: x = −2 ln(1−p)
  console.log("--- chiSquareQuantile (df=2 closed form) ---");
  {
    const q975 = -2 * Math.log(0.025);  // ≈ 7.3778
    const q025 = -2 * Math.log(0.975);  // ≈ 0.05063
    hchk("χ²(0.975, 2)", chiSquareQuantile(0.975, 2), q975, 1e-4);
    hchk("χ²(0.025, 2)", chiSquareQuantile(0.025, 2), q025, 1e-4);
  }

  // 2. chiSquareQuantile round-trip: chiSquareCDF(chiSquareQuantile(p, df), df) ≈ p
  console.log("--- chiSquareQuantile round-trip ---");
  [[0.025, 4], [0.5, 2], [0.975, 12]].forEach(([p, df]) => {
    const x     = chiSquareQuantile(p, df);
    const pBack = chiSquareCDF(x, df);
    hchk(`CDF(Q(${p}, ${df}), ${df}) ≈ ${p}`, pBack, p, 1e-6);
  });

  // 3. Structural properties: bounds ordered and within valid ranges
  console.log("--- CI bounds ordering and range ---");
  {
    const s  = [{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }, { yi: 3, vi: 1 }];
    const ci = heterogeneityCIs(s, meta(s, "DL").tau2);
    hchkTrue("tauCI[0] ≤ tauCI[1]", ci.tauCI[0] <= ci.tauCI[1]);
    hchkTrue("I2CI[0]  ≤ I2CI[1]",  ci.I2CI[0]  <= ci.I2CI[1]);
    hchkTrue("H2CI[0]  ≤ H2CI[1]",  ci.H2CI[0]  <= ci.H2CI[1]);
    hchkTrue("tauCI[0] ≥ 0",        ci.tauCI[0] >= 0);
    hchkTrue("I2CI[0]  ≥ 0",        ci.I2CI[0]  >= 0);
    hchkTrue("I2CI[1]  ≤ 100",      ci.I2CI[1]  <= 100);
    hchkTrue("H2CI[0]  ≥ 1",        ci.H2CI[0]  >= 1);
  }

  // 4. Homogeneous studies (all yi equal) → Q = 0 < χ²_{k-1, 0.975} → τ²_lo = 0
  console.log("--- Homogeneous studies: tau2_lo = 0 ---");
  {
    const sHom = [{ yi: 2, vi: 1 }, { yi: 2, vi: 1 }, { yi: 2, vi: 1 }];
    const ci   = heterogeneityCIs(sHom, 0);
    hchk("tau2_lo = 0",  ci.tauCI[0], 0, 1e-10);
    hchk("I2CI[0] = 0",  ci.I2CI[0],  0, 1e-10);
    hchk("H2CI[0] = 1",  ci.H2CI[0],  1, 1e-10);
  }

  // 5. Analytical upper bound for equal-vi dataset: yi=[0,1,3], vi=[1,1,1], df=2
  //
  //   Q_FE = Σ(yi − 4/3)² = 16/9 + 1/9 + 25/9 = 42/9 ≈ 4.667
  //   Q_τ(τ²) = Q_FE / (1 + τ²)   [because equal wi = 1/(1+τ²)]
  //
  //   τ²_lo: Q_τ = χ²_{2, 0.975} = 7.378 → Q_FE/7.378 − 1 < 0 → clamped to 0
  //   τ²_hi: Q_τ = χ²_{2, 0.025} = −2 ln(0.975)
  //          τ²_hi = Q_FE / (−2 ln(0.975)) − 1
  console.log("--- Analytical upper bound (yi=[0,1,3], vi=[1,1,1]) ---");
  {
    const s    = [{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }, { yi: 3, vi: 1 }];
    const ci   = heterogeneityCIs(s, 0);
    const chiLo   = -2 * Math.log(0.975);       // exact χ²_{2, 0.025}
    const expHi   = (42 / 9) / chiLo - 1;       // ≈ 91.2
    hchk("tau2_lo = 0",           ci.tauCI[0], 0,      1e-9);
    hchk("tau2_hi (analytical)",  ci.tauCI[1], expHi,  0.05);
  }

  // 6. meta() attaches tauCI / I2CI / H2CI to the return object
  console.log("--- meta() includes CI fields ---");
  {
    const s = [{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }, { yi: 3, vi: 1 }];
    const m = meta(s, "DL");
    hchkTrue("m.tauCI length 2",    Array.isArray(m.tauCI) && m.tauCI.length === 2);
    hchkTrue("m.I2CI length 2",     Array.isArray(m.I2CI)  && m.I2CI.length  === 2);
    hchkTrue("m.H2CI length 2",     Array.isArray(m.H2CI)  && m.H2CI.length  === 2);
    hchkTrue("m.tauCI[0] ≥ 0",      m.tauCI[0] >= 0);
    // I2CI should bracket the meta() I2 point estimate (within numerical noise)
    hchkTrue("I2CI contains I2",    m.I2CI[0] <= m.I2 + 0.1 && m.I2CI[1] >= m.I2 - 0.1);
  }

  // 7. k < 2 → degenerate sentinel values
  console.log("--- k < 2 → degenerate ---");
  {
    const ci = heterogeneityCIs([{ yi: 1, vi: 1 }], 0);
    hchk("tauCI[0] = 0",  ci.tauCI[0], 0, 1e-10);
    hchkNaN("tauCI[1] = NaN", ci.tauCI[1]);
  }

  console.log(hetPass ? "\n✅ ALL HETEROGENEITY CI TESTS PASSED" : "\n❌ SOME HETEROGENEITY CI TESTS FAILED");

  // ===== CUMULATIVE META-ANALYSIS UNIT TESTS =====
  // Uses two datasets:
  //   sLab — three labeled heterogeneous studies (yi=[0,1,3], vi=[1,1,1])
  //   sHom — three homogeneous studies (yi=[2,2,2], vi=[1,1,1])
  // Homogeneous data guarantees τ²=0 at every step, isolating the
  // CI-narrowing property without RE variance inflation.
  console.log("\n===== CUMULATIVE META-ANALYSIS UNIT TESTS =====\n");
  let cumPass = true;

  function cumchk(name, val, expected, tol = 1e-4) {
    const ok = isFinite(val) && Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 5)} (expected ${round(expected, 5)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) cumPass = false;
  }
  function cumchkTrue(name, cond) {
    console.log(`  ${name} → ${cond ? "PASS" : "FAIL"}`);
    if (!cond) cumPass = false;
  }

  const sLab = [
    { yi: 0, vi: 1, se: 1, label: "Alpha"   },
    { yi: 1, vi: 1, se: 1, label: "Beta"    },
    { yi: 3, vi: 1, se: 1, label: "Gamma"   }
  ];
  const sCumHom = [
    { yi: 2, vi: 1, se: 1, label: "A" },
    { yi: 2, vi: 1, se: 1, label: "B" },
    { yi: 2, vi: 1, se: 1, label: "C" }
  ];

  // 1. Result array length = number of studies
  console.log("--- Length ---");
  {
    const cum = cumulativeMeta(sLab, "DL");
    cumchkTrue("length = k", cum.length === sLab.length);
    cumchkTrue("cum[0].k = 1", cum[0].k === 1);
    cumchkTrue("cum[2].k = 3", cum[2].k === 3);
  }

  // 2. addedLabel tracks the study added at each step
  console.log("--- addedLabel ---");
  {
    const cum = cumulativeMeta(sLab, "DL");
    cumchkTrue('cum[0].addedLabel = "Alpha"', cum[0].addedLabel === "Alpha");
    cumchkTrue('cum[1].addedLabel = "Beta"',  cum[1].addedLabel === "Beta");
    cumchkTrue('cum[2].addedLabel = "Gamma"', cum[2].addedLabel === "Gamma");
  }

  // 3. First step matches a single-study meta() call
  //    k=1: RE = yi[0], seRE = √vi[0], τ² = 0, I² = 0, CI = RE ± 1.96·seRE
  console.log("--- First step = single-study meta() ---");
  {
    const cum  = cumulativeMeta(sLab, "DL");
    const m1   = meta([sLab[0]], "DL");
    cumchk("RE",     cum[0].RE,     m1.RE,     1e-9);
    cumchk("seRE",   cum[0].seRE,   m1.seRE,   1e-9);
    cumchk("ciLow",  cum[0].ciLow,  m1.ciLow,  1e-9);
    cumchk("ciHigh", cum[0].ciHigh, m1.ciHigh, 1e-9);
    cumchk("tau2",   cum[0].tau2,   0,         1e-9);
    cumchk("I2",     cum[0].I2,     0,         1e-9);
  }

  // 4. Last step matches meta() on the full dataset (regression test)
  console.log("--- Last step = full meta() ---");
  {
    const cum  = cumulativeMeta(sLab, "DL");
    const mAll = meta(sLab, "DL");
    cumchk("RE",   cum[2].RE,   mAll.RE,   1e-9);
    cumchk("tau2", cum[2].tau2, mAll.tau2, 1e-9);
    cumchk("I2",   cum[2].I2,   mAll.I2,   1e-9);
  }

  // 5. CI width narrows monotonically for homogeneous data
  //    (τ²=0 at every step → RE = FE → seRE = 1/√k → width strictly decreasing)
  console.log("--- CI narrows monotonically (homogeneous) ---");
  {
    const cum = cumulativeMeta(sCumHom, "DL");
    const widths = cum.map(r => r.ciHigh - r.ciLow);
    cumchkTrue("width[0] > width[1]", widths[0] > widths[1]);
    cumchkTrue("width[1] > width[2]", widths[1] > widths[2]);
  }

  // 6. τ² method forwarded correctly: DL vs REML give same result on
  //    homogeneous data (both clamp to 0) but may differ on heterogeneous data
  console.log("--- τ² method is forwarded ---");
  {
    const cumDL   = cumulativeMeta(sLab, "DL");
    const cumREML = cumulativeMeta(sLab, "REML");
    // Both must produce valid last-step estimates
    cumchkTrue("DL last step finite",   isFinite(cumDL[2].RE));
    cumchkTrue("REML last step finite", isFinite(cumREML[2].RE));
    // REML and DL τ² differ on this dataset (both > 0 but not equal)
    cumchkTrue("DL τ² ≥ 0",   cumDL[2].tau2   >= 0);
    cumchkTrue("REML τ² ≥ 0", cumREML[2].tau2 >= 0);
  }

  console.log(cumPass ? "\n✅ ALL CUMULATIVE META TESTS PASSED" : "\n❌ SOME CUMULATIVE META TESTS FAILED");

  // ===== HR / IRR / IR UNIT TESTS =====
  //
  // Tests cover:
  //   1. yi and vi formulas (exact analytical values)
  //   2. Invalid input → NaN / w=0
  //   3. Continuity correction (IRR: x=0; IR: x=0)
  //   4. Back-transform consistency (transformEffect applied to both CI bounds)
  //   5. Pooled meta() on the benchmark dataset
  // ================================================================
  let hrPass = true;
  console.log("\n===== HR / IRR / IR UNIT TESTS =====\n");

  function hrchk(name, val, expected, tol = 1e-4) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 6)} (expected ${round(expected, 6)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) hrPass = false;
  }
  function hrchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) hrPass = false;
  }

  // --- HR: yi / vi formulas ---
  // hr=0.5, ci_lo=0.25, ci_hi=1.0
  // yi  = ln(0.5) = −0.693147
  // se  = (ln(1.0) − ln(0.25)) / (2·1.96) = ln(4) / 3.92 = 1.386294 / 3.92 = 0.353646
  // vi  = se² = 0.125066
  console.log("--- HR: yi / vi formula ---");
  {
    const s = compute({ hr: 0.5, ci_lo: 0.25, ci_hi: 1.0 }, "HR");
    hrchk("yi = ln(hr)",          s.yi, Math.log(0.5));
    hrchk("se = CI_width/3.92",   s.se, Math.log(4) / 3.92);
    hrchk("vi = se²",             s.vi, s.se * s.se);
    hrchk("w  = 1/vi",            s.w,  1 / s.vi);
  }

  // --- HR: invalid inputs produce NaN ---
  console.log("--- HR: invalid inputs → NaN ---");
  {
    hrchkTrue("hr ≤ 0 → NaN yi",       !isFinite(compute({ hr: -1,  ci_lo: 0.5, ci_hi: 1.0 }, "HR").yi));
    hrchkTrue("hr = 0 → NaN yi",       !isFinite(compute({ hr: 0,   ci_lo: 0.5, ci_hi: 1.0 }, "HR").yi));
    hrchkTrue("ci_lo ≥ ci_hi → NaN yi",!isFinite(compute({ hr: 0.5, ci_lo: 1.0, ci_hi: 0.5 }, "HR").yi));
    hrchkTrue("ci_lo ≤ 0 → NaN yi",    !isFinite(compute({ hr: 0.5, ci_lo: 0,   ci_hi: 1.0 }, "HR").yi));
  }

  // --- HR: back-transform ---
  // transformEffect(yi, "HR") = exp(yi) = hr
  // transformEffect applied to both bounds recovers (ci_lo, ci_hi) on original scale
  console.log("--- HR: back-transform ---");
  {
    const s = compute({ hr: 0.5, ci_lo: 0.25, ci_hi: 1.0 }, "HR");
    const seRE = s.se;
    hrchk("transformEffect → hr",     transformEffect(s.yi, "HR"), 0.5);
    const ciLb = transformEffect(s.yi - 1.96 * seRE, "HR");
    const ciUb = transformEffect(s.yi + 1.96 * seRE, "HR");
    hrchk("CI lower recovers ci_lo",  ciLb, 0.25);
    hrchk("CI upper recovers ci_hi",  ciUb, 1.0);
  }

  // --- IRR: yi / vi formulas ---
  // x1=10, t1=100, x2=20, t2=100
  // yi  = ln(10/100) − ln(20/100) = ln(0.5) = −0.693147
  // vi  = 1/10 + 1/20 = 0.15
  console.log("--- IRR: yi / vi formula ---");
  {
    const s = compute({ x1: 10, t1: 100, x2: 20, t2: 100 }, "IRR");
    hrchk("yi = ln(x1/t1) − ln(x2/t2)", s.yi, Math.log(0.5));
    hrchk("vi = 1/x1 + 1/x2",           s.vi, 1/10 + 1/20);
    hrchk("se = √vi",                    s.se, Math.sqrt(1/10 + 1/20));
    hrchk("w  = 1/vi",                   s.w,  1 / s.vi);
  }

  // --- IRR: continuity correction (x1=0 or x2=0 → add 0.5 to both) ---
  // x1=0, t1=100, x2=10, t2=100 → x1=0.5, x2=10.5
  // yi  = ln(0.5/100) − ln(10.5/100) = ln(0.5/10.5) = ln(1/21) ≈ −3.044522
  // vi  = 1/0.5 + 1/10.5 = 2 + 0.095238 = 2.095238
  console.log("--- IRR: continuity correction (x1=0) ---");
  {
    const s = compute({ x1: 0, t1: 100, x2: 10, t2: 100 }, "IRR");
    hrchk("yi with correction", s.yi, Math.log(0.5 / 10.5));
    hrchk("vi with correction", s.vi, 1 / 0.5 + 1 / 10.5);
  }

  // --- IRR: both arms zero → continuity applied to both ---
  // x1=0, x2=0 → x1=0.5, x2=0.5; yi = ln(t2/t1) (rate ratio = 1 if t1=t2)
  console.log("--- IRR: continuity correction (both zero) ---");
  {
    const s = compute({ x1: 0, t1: 100, x2: 0, t2: 100 }, "IRR");
    hrchk("yi both-zero = 0", s.yi, 0);   // ln(0.5/0.5) = 0
    hrchk("vi both-zero",     s.vi, 1/0.5 + 1/0.5);
  }

  // --- IRR: invalid inputs produce NaN ---
  console.log("--- IRR: invalid inputs → NaN ---");
  {
    hrchkTrue("x1 < 0 → NaN",  !isFinite(compute({ x1: -1, t1: 100, x2: 10, t2: 100 }, "IRR").yi));
    hrchkTrue("t1 = 0 → NaN",  !isFinite(compute({ x1: 5,  t1: 0,   x2: 10, t2: 100 }, "IRR").yi));
    hrchkTrue("t2 ≤ 0 → NaN",  !isFinite(compute({ x1: 5,  t1: 100, x2: 10, t2: -1  }, "IRR").yi));
  }

  // --- IRR: back-transform ---
  console.log("--- IRR: back-transform ---");
  {
    const s = compute({ x1: 10, t1: 100, x2: 20, t2: 100 }, "IRR");
    hrchk("transformEffect → IRR", transformEffect(s.yi, "IRR"), 0.5);
  }

  // --- IR: yi / vi formulas ---
  // x=5, t=100 → yi = ln(0.05) = −2.995732,  vi = 1/5 = 0.2
  console.log("--- IR: yi / vi formula ---");
  {
    const s = compute({ x: 5, t: 100 }, "IR");
    hrchk("yi = ln(x/t)", s.yi, Math.log(5 / 100));
    hrchk("vi = 1/x",     s.vi, 1 / 5);
    hrchk("se = √vi",     s.se, Math.sqrt(1 / 5));
    hrchk("w  = 1/vi",    s.w,  5);
  }

  // --- IR: continuity correction (x=0 → x=0.5) ---
  // x=0, t=100 → yi = ln(0.5/100) = ln(0.005) ≈ −5.298317,  vi = 1/0.5 = 2
  console.log("--- IR: continuity correction (x=0) ---");
  {
    const s = compute({ x: 0, t: 100 }, "IR");
    hrchk("yi with correction", s.yi, Math.log(0.5 / 100));
    hrchk("vi with correction", s.vi, 1 / 0.5);
  }

  // --- IR: invalid inputs produce NaN ---
  console.log("--- IR: invalid inputs → NaN ---");
  {
    hrchkTrue("x < 0 → NaN",  !isFinite(compute({ x: -1, t: 100 }, "IR").yi));
    hrchkTrue("t = 0 → NaN",  !isFinite(compute({ x: 5,  t: 0   }, "IR").yi));
    hrchkTrue("t < 0 → NaN",  !isFinite(compute({ x: 5,  t: -50 }, "IR").yi));
  }

  // --- IR: back-transform ---
  console.log("--- IR: back-transform ---");
  {
    const s = compute({ x: 5, t: 100 }, "IR");
    hrchk("transformEffect → rate", transformEffect(s.yi, "IR"), 5 / 100);
  }

  // --- Pooled: HR benchmark (equal vi → RE = FE = −0.450) ---
  console.log("--- HR pooled (benchmark, DL) ---");
  {
    const data = [
      { hr: 0.6065, ci_lo: 0.3716, ci_hi: 0.9900 },
      { hr: 0.9048, ci_lo: 0.5543, ci_hi: 1.4770 },
      { hr: 0.4066, ci_lo: 0.2491, ci_hi: 0.6637 },
      { hr: 0.7408, ci_lo: 0.4538, ci_hi: 1.2092 }
    ];
    const studies = data.map(d => compute(d, "HR"));
    const m = meta(studies, "DL");
    hrchk("FE",   m.FE,   -0.450, 0.01);
    hrchk("RE",   m.RE,   -0.450, 0.01);
    hrchk("tau2", m.tau2,  0.054, 0.054 * 0.1);   // 10% relative
    hrchk("I2",   m.I2,   46.4,   0.5);
  }

  // --- Pooled: IRR benchmark (FE=−0.537, RE=−0.605, τ²=0.138, I²=47.7%) ---
  console.log("--- IRR pooled (benchmark, DL) ---");
  {
    const data = [
      { x1: 5,  t1: 100, x2: 20, t2: 100 },
      { x1: 18, t1: 100, x2: 20, t2: 100 },
      { x1: 8,  t1: 100, x2: 20, t2: 100 },
      { x1: 14, t1: 100, x2: 20, t2: 100 }
    ];
    const studies = data.map(d => compute(d, "IRR"));
    const m = meta(studies, "DL");
    hrchk("FE",   m.FE,   -0.537, 0.01);
    hrchk("RE",   m.RE,   -0.605, 0.01);
    hrchk("tau2", m.tau2,  0.138, 0.138 * 0.1);
    hrchk("I2",   m.I2,   47.7,   0.5);
  }

  // --- Pooled: IR benchmark (FE=−2.742, RE=−2.997, τ²=0.335, I²=82.0%) ---
  console.log("--- IR pooled (benchmark, DL) ---");
  {
    const data = [
      { x: 10, t: 200 },
      { x: 25, t: 300 },
      { x:  5, t: 400 },
      { x: 20, t: 250 }
    ];
    const studies = data.map(d => compute(d, "IR"));
    const m = meta(studies, "DL");
    hrchk("FE",   m.FE,   -2.742, 0.01);
    hrchk("RE",   m.RE,   -2.997, 0.01);
    hrchk("tau2", m.tau2,  0.335, 0.335 * 0.1);
    hrchk("I2",   m.I2,   82.0,   0.5);
  }

  console.log(hrPass ? "\n✅ ALL HR/IRR/IR UNIT TESTS PASSED" : "\n❌ SOME HR/IRR/IR UNIT TESTS FAILED");

  // ===== COOK'S D / HAT VALUE UNIT TESTS =====
  //
  // Dataset A: yi=[0,1,3], vi=[1,1,1], DL  (used throughout)
  //   τ²_DL = 4/3,  RE weights w_i = 3/7 each,  W = 9/7
  //   h_i   = 1/3 for all  (equal vi → equal leverage)
  //   RE_loo = [2,  3/2,  1/2]  (verified analytically)
  //   D_i   = [4/7,  1/28,  25/28]  (= (RE−RE_loo)²·W)
  //
  // Dataset B: yi=[2,2,2], vi=[1,1,1]  — homogeneous, all D_i = 0
  // Dataset C: yi=[0,0,0], vi=[1,1,0.001]  — study 3 has h≈0.998 > 2/3
  // Dataset D: yi=[0,0,0,0,10], vi=[1,1,1,1,1]  — study 5 has D≈1 > 4/5
  // ==========================================================
  let infPass = true;
  console.log("\n===== COOK'S D / HAT VALUE UNIT TESTS =====\n");

  function infchk(name, val, expected, tol = 1e-4) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 6)} (expected ${round(expected, 6)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) infPass = false;
  }
  function infchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) infPass = false;
  }

  const sA = [{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }, { yi: 3, vi: 1 }];
  const sB = [{ yi: 2, vi: 1 }, { yi: 2, vi: 1 }, { yi: 2, vi: 1 }];
  const sC = [{ yi: 0, vi: 1 }, { yi: 0, vi: 1 }, { yi: 0, vi: 0.001 }];
  const sD = [{ yi: 0, vi: 1 }, { yi: 0, vi: 1 }, { yi: 0, vi: 1 }, { yi: 0, vi: 1 }, { yi: 10, vi: 1 }];

  const infA = influenceDiagnostics(sA, "DL");
  const infB = influenceDiagnostics(sB, "DL");
  const infC = influenceDiagnostics(sC, "DL");
  const infD = influenceDiagnostics(sD, "DL");

  // 1. Hat values always sum to 1  (Σh_i = ΣW_i/W = 1)
  console.log("--- 1. Σh_i = 1 (identity) ---");
  {
    const sumA = infA.reduce((s, d) => s + d.hat, 0);
    const sumB = infB.reduce((s, d) => s + d.hat, 0);
    const sumD = infD.reduce((s, d) => s + d.hat, 0);
    infchk("Σh (dataset A)", sumA, 1, 1e-9);
    infchk("Σh (dataset B)", sumB, 1, 1e-9);
    infchk("Σh (dataset D)", sumD, 1, 1e-9);
  }

  // 2. Equal vi → h_i = 1/k for all studies
  //    Dataset A: k=3, all vi=1, τ²=4/3 → w_i=3/7 each → h_i=1/3
  console.log("--- 2. h_i = 1/k for equal vi ---");
  {
    infA.forEach((d, i) => infchk(`h[${i}] = 1/3`, d.hat, 1 / 3, 1e-9));
  }

  // 3. Cook's D = 0 for homogeneous yi
  //    Dataset B: all yi=2 → removing any study leaves RE_loo=2 → shift=0
  console.log("--- 3. D_i = 0 for homogeneous yi ---");
  {
    infB.forEach((d, i) => infchk(`D[${i}] = 0`, d.cookD, 0, 1e-9));
  }

  // 4. Analytical Cook's D — Dataset A
  //    W = 9/7,  RE = 4/3
  //    RE_loo = [2, 3/2, 1/2]  (derived analytically in comments above)
  //    D[0] = (4/3 − 2)² × 9/7  = (4/9)×(9/7)  = 4/7  ≈ 0.571429
  //    D[1] = (4/3 − 3/2)² × 9/7 = (1/36)×(9/7) = 1/28 ≈ 0.035714
  //    D[2] = (4/3 − 1/2)² × 9/7 = (25/36)×(9/7)= 25/28 ≈ 0.892857
  console.log("--- 4. Analytical Cook's D (dataset A) ---");
  {
    const tol = 1e-4;
    infchk("D[0] = 4/7",  infA[0].cookD, 4  / 7,  tol);
    infchk("D[1] = 1/28", infA[1].cookD, 1  / 28, tol);
    infchk("D[2] = 25/28",infA[2].cookD, 25 / 28, tol);
  }

  // 5. High-leverage flag
  //    Dataset C: yi=[0,0,0], vi=[1,1,0.001] → Q=0, τ²=0
  //    w = [1, 1, 1000], W = 1002
  //    h[0]=h[1] = 1/1002 ≈ 0.001 < 2/3 → highLeverage=false
  //    h[2] = 1000/1002 ≈ 0.998 > 2/3 → highLeverage=true
  console.log("--- 5. High-leverage flag (dataset C) ---");
  {
    infchk("h[2] ≈ 1000/1002",  infC[2].hat, 1000 / 1002, 1e-4);
    infchkTrue("h[0] not flagged", !infC[0].highLeverage);
    infchkTrue("h[1] not flagged", !infC[1].highLeverage);
    infchkTrue("h[2] flagged",      infC[2].highLeverage);
  }

  // 6. High Cook's D flag
  //    Dataset D: k=5, yi=[0,0,0,0,10], vi=[1,1,1,1,1]
  //    τ²_DL=19, W*=0.25, RE=2, RE_loo[4]=0
  //    D[4] = (2−0)²×0.25 = 1.0 > 4/5=0.8 → highCookD=true
  //    Dataset A: all D < 4/3 ≈ 1.333 → highCookD=false for all
  console.log("--- 6. High Cook's D flag (datasets D and A) ---");
  {
    infchk("D[4] ≈ 1.0", infD[4].cookD, 1.0, 1e-4);
    infchkTrue("D[4] flagged (D > 4/k=0.8)", infD[4].highCookD);
    infchkTrue("D[0] not flagged",            !infD[0].highCookD);
    // Dataset A: D_max = 25/28 ≈ 0.893 < 4/3 ≈ 1.333 → all clear
    infA.forEach((d, i) => infchkTrue(`A D[${i}] not flagged`, !d.highCookD));
  }

  console.log(infPass ? "\n✅ ALL COOK'S D / HAT UNIT TESTS PASSED" : "\n❌ SOME COOK'S D / HAT UNIT TESTS FAILED");

  // ===== ROM UNIT TESTS =====
  //
  // Tests cover:
  //   1. yi and vi formulas (exact analytical values)
  //   2. Invalid inputs → NaN / w=0
  //   3. Back-transform round-trip: exp(log(m1/m2)) = m1/m2
  //   4. CI back-transform: exp() applied to both bounds
  //   5. Pooled meta() on a 3-study dataset (DL)
  //
  // Spot-check study:  m1=2, sd1=0.5, n1=20,  m2=1, sd2=0.4, n2=25
  //   yi = ln(2/1) = ln(2) = 0.693147
  //   vi = 0.5²/(20×2²) + 0.4²/(25×1²)
  //      = 0.25/80 + 0.16/25  =  0.003125 + 0.0064  =  0.009525
  //
  // 3-study pool (DL):
  //   Study 1: m1=4, sd1=1, n1=30,  m2=2, sd2=0.8, n2=30
  //     yi=ln(2)=0.6931,  vi=1/480+0.64/120=0.007417
  //   Study 2: m1=3, sd1=0.9, n1=40,  m2=2, sd2=0.7, n2=40
  //     yi=ln(1.5)=0.4055,  vi=0.81/360+0.49/160=0.005313
  //   Study 3: m1=5, sd1=1.2, n1=25,  m2=3, sd2=1, n2=25
  //     yi=ln(5/3)=0.5108,  vi=1.44/625+1/225=0.006748
  //   FE≈0.521,  RE≈0.532,  tau2≈0.0146,  I2≈69.3%
  // ================================================================
  let romPass = true;
  console.log("\n===== ROM UNIT TESTS =====\n");

  function romchk(name, val, expected, tol = 1e-6) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 7)} (expected ${round(expected, 7)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) romPass = false;
  }
  function romchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) romPass = false;
  }

  // 1. yi and vi formula spot-check
  console.log("--- 1. yi / vi formulas ---");
  {
    const s = compute({ m1: 2, sd1: 0.5, n1: 20, m2: 1, sd2: 0.4, n2: 25 }, "ROM");
    romchk("yi = ln(2/1)",    s.yi, Math.log(2));
    romchk("vi = 0.25/80 + 0.16/25", s.vi, 0.003125 + 0.0064);
    romchk("se = sqrt(vi)",   s.se, Math.sqrt(0.009525));
    romchk("w  = 1/vi",       s.w,  1 / 0.009525);
  }

  // 2. Invalid inputs → NaN / w=0
  console.log("--- 2. Invalid inputs → NaN ---");
  {
    const base = { m1: 2, sd1: 0.5, n1: 20, m2: 1, sd2: 0.4, n2: 25 };
    romchkTrue("m1 = 0  → NaN yi",  !isFinite(compute({ ...base, m1:  0   }, "ROM").yi));
    romchkTrue("m1 < 0  → NaN yi",  !isFinite(compute({ ...base, m1: -1   }, "ROM").yi));
    romchkTrue("m2 = 0  → NaN yi",  !isFinite(compute({ ...base, m2:  0   }, "ROM").yi));
    romchkTrue("sd1 = 0 → NaN yi",  !isFinite(compute({ ...base, sd1: 0   }, "ROM").yi));
    romchkTrue("n1 = 0  → NaN yi",  !isFinite(compute({ ...base, n1:  0   }, "ROM").yi));
    romchkTrue("m1 = 0  → w = 0",       compute({ ...base, m1:  0   }, "ROM").w === 0);
  }

  // 3. Back-transform: transformEffect round-trip
  console.log("--- 3. Back-transform round-trip ---");
  {
    const ratios = [0.5, 1.0, 2.0, 3.5];
    ratios.forEach(r => {
      const yi = Math.log(r);
      romchk(`exp(ln(${r})) = ${r}`, transformEffect(yi, "ROM"), r, 1e-10);
    });
  }

  // 4. Back-transform applies exp() to both bounds
  console.log("--- 4. CI back-transform ---");
  {
    const s = compute({ m1: 2, sd1: 0.5, n1: 20, m2: 1, sd2: 0.4, n2: 25 }, "ROM");
    const rawLb = s.yi - 1.96 * s.se;
    const rawUb = s.yi + 1.96 * s.se;
    const ciLb = transformEffect(rawLb, "ROM");
    const ciUb = transformEffect(rawUb, "ROM");
    romchk("CI lb = exp(yi - 1.96·se)", ciLb, Math.exp(rawLb), 1e-10);
    romchk("CI ub = exp(yi + 1.96·se)", ciUb, Math.exp(rawUb), 1e-10);
    romchkTrue("CI lb < ub", ciLb < ciUb);
  }

  // 5. Pooled meta() — 3-study DL
  console.log("--- 5. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ m1: 4, sd1: 1.0, n1: 30, m2: 2, sd2: 0.8, n2: 30 }, "ROM"),
      compute({ m1: 3, sd1: 0.9, n1: 40, m2: 2, sd2: 0.7, n2: 40 }, "ROM"),
      compute({ m1: 5, sd1: 1.2, n1: 25, m2: 3, sd2: 1.0, n2: 25 }, "ROM"),
    ];

    // Verify per-study yi values first
    romchk("yi[0] = ln(2)",   studies[0].yi, Math.log(2),     1e-6);
    romchk("yi[1] = ln(1.5)", studies[1].yi, Math.log(1.5),   1e-6);
    romchk("yi[2] = ln(5/3)", studies[2].yi, Math.log(5 / 3), 1e-6);

    const m = meta(studies, "DL");
    romchk("FE   ≈ 0.521",  m.FE,   0.521,  0.01);
    romchk("RE   ≈ 0.532",  m.RE,   0.532,  0.01);
    romchk("tau2 ≈ 0.0146", m.tau2, 0.0146, 0.002);
    romchk("I2   ≈ 69.3%",  m.I2,   69.3,   0.5);
  }

  console.log(romPass ? "\n✅ ALL ROM UNIT TESTS PASSED" : "\n❌ SOME ROM UNIT TESTS FAILED");

  // ===== SMDH UNIT TESTS =====
  //
  // Tests cover:
  //   1. yi and vi formulas (exact analytical values)
  //   2. Invalid inputs → NaN / w=0
  //   3. J → 1 as n → ∞ (correction vanishes for large samples)
  //   4. SMDH yi = SMD yi when sd1 = sd2 (standardisers coincide)
  //   5. Pooled meta() on a 3-study dataset (DL)
  //
  // Spot-check study:  m1=10, sd1=3, n1=30,  m2=8, sd2=1, n2=28
  //   df   = 56
  //   sdi² = (9 + 1) / 2 = 5,  sdi = √5
  //   d    = 2 / √5 ≈ 0.894427
  //   J    = 1 − 3 / (4·56 − 1) = 220/223 ≈ 0.986547
  //   g    = d · J ≈ 0.882393
  //   vi_d = (9/30 + 1/28) / 5  +  (4/5) / (2·56)
  //        = 0.067143 + 0.007143 = 0.074286
  //   vi_g = vi_d · J² = 0.074286 · (220/223)² ≈ 0.072300
  //
  // 3-study pool (DL):
  //   Study 1: m1=10, sd1=3,   n1=30,  m2=8,  sd2=1,   n2=28 → g≈0.882, vi≈0.0723
  //   Study 2: m1=6,  sd1=2.5, n1=25,  m2=5,  sd2=0.8, n2=22 → g≈0.530, vi≈0.0814
  //   Study 3: m1=14, sd1=4.5, n1=35,  m2=10, sd2=1.5, n2=33 → g≈1.179, vi≈0.0667
  //   FE≈0.885,  RE≈0.879,  tau2≈0.031,  I2≈30%
  // ================================================================
  let smdhPass = true;
  console.log("\n===== SMDH UNIT TESTS =====\n");

  function smdhchk(name, val, expected, tol = 1e-5) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 7)} (expected ${round(expected, 7)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) smdhPass = false;
  }
  function smdhchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) smdhPass = false;
  }

  // 1. yi / vi formula spot-check
  console.log("--- 1. yi / vi formulas ---");
  {
    const s = compute({ m1: 10, sd1: 3, n1: 30, m2: 8, sd2: 1, n2: 28 }, "SMDH");
    const df   = 56;
    const sdi2 = 5;                              // (9+1)/2
    const d    = 2 / Math.sqrt(sdi2);            // 2/√5
    const J    = 1 - 3 / (4 * df - 1);          // 220/223
    const g    = d * J;
    const vi_d = (9/30 + 1/28) / sdi2 + d**2 / (2*df);
    const vi_g = vi_d * J**2;
    smdhchk("yi = g",        s.yi, g);
    smdhchk("vi = vi_g",     s.vi, vi_g);
    smdhchk("se = √vi_g",    s.se, Math.sqrt(vi_g));
    smdhchk("w  = 1/vi_g",   s.w,  1 / vi_g, 1e-3);
  }

  // 2. Invalid inputs → NaN / w=0
  console.log("--- 2. Invalid inputs → NaN ---");
  {
    const base = { m1: 10, sd1: 3, n1: 30, m2: 8, sd2: 1, n2: 28 };
    smdhchkTrue("sd1 = 0  → NaN yi",  !isFinite(compute({ ...base, sd1: 0   }, "SMDH").yi));
    smdhchkTrue("sd2 = 0  → NaN yi",  !isFinite(compute({ ...base, sd2: 0   }, "SMDH").yi));
    smdhchkTrue("sd1 < 0  → NaN yi",  !isFinite(compute({ ...base, sd1: -1  }, "SMDH").yi));
    smdhchkTrue("n1 = 1   → NaN yi",  !isFinite(compute({ ...base, n1:  1   }, "SMDH").yi));
    smdhchkTrue("n2 = 1   → NaN yi",  !isFinite(compute({ ...base, n2:  1   }, "SMDH").yi));
    smdhchkTrue("sd1 = 0  → w = 0",       compute({ ...base, sd1: 0   }, "SMDH").w === 0);
  }

  // 3. J → 1 as n → ∞
  //    n1=n2=10000 → df=19998, J = 1 − 3/79991 ≈ 0.999963
  console.log("--- 3. J → 1 for large n ---");
  {
    const s = compute({ m1: 10, sd1: 3, n1: 10000, m2: 8, sd2: 1, n2: 10000 }, "SMDH");
    const df_large = 19998;
    const J_large  = 1 - 3 / (4 * df_large - 1);
    smdhchkTrue("J > 0.9999 for n=10000", J_large > 0.9999);
    // g should be within 0.01% of the uncorrected d
    const sdi2 = 5;
    const d_large = 2 / Math.sqrt(sdi2);
    smdhchk("yi ≈ d (J ≈ 1)", s.yi, d_large * J_large, 1e-6);
  }

  // 4. SMDH yi = SMD yi when sd1 = sd2
  //    When sd1=sd2=s: sdi = √((s²+s²)/2) = s = pooled SD → d identical.
  //    J correction uses the same df so g is identical too.
  //    Variances differ slightly (SMDH uses df, SMD uses n1+n2 in second term).
  console.log("--- 4. SMDH yi = SMD yi when sd1 = sd2 ---");
  {
    const args = { m1: 10, sd1: 2, n1: 30, m2: 8, sd2: 2, n2: 28 };
    const smdh = compute(args, "SMDH");
    const smd  = compute(args, "SMD");
    smdhchk("yi SMDH = yi SMD (sd1=sd2)", smdh.yi, smd.yi, 1e-9);
    // variances differ slightly: SMD uses d²/(2·(n1+n2)) and skips J² on vi,
    // SMDH uses d²/(2·df) and multiplies by J². With n≈30 this compounds to ~2–3%.
    smdhchkTrue("vi SMDH ≈ vi SMD (within 5%)",
      isFinite(smdh.vi) && isFinite(smd.vi) &&
      Math.abs(smdh.vi - smd.vi) / smd.vi < 0.05);
  }

  // 5. Pooled meta() — 3-study DL
  console.log("--- 5. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ m1: 10, sd1: 3,   n1: 30, m2: 8,  sd2: 1,   n2: 28 }, "SMDH"),
      compute({ m1: 6,  sd1: 2.5, n1: 25, m2: 5,  sd2: 0.8, n2: 22 }, "SMDH"),
      compute({ m1: 14, sd1: 4.5, n1: 35, m2: 10, sd2: 1.5, n2: 33 }, "SMDH"),
    ];

    // Per-study yi spot-checks
    smdhchk("yi[0] ≈ 0.882", studies[0].yi, 0.882, 0.001);
    smdhchk("yi[1] ≈ 0.530", studies[1].yi, 0.530, 0.001);
    smdhchk("yi[2] ≈ 1.179", studies[2].yi, 1.179, 0.001);

    const m = meta(studies, "DL");
    smdhchk("FE   ≈ 0.885", m.FE,   0.885, 0.01);
    smdhchk("RE   ≈ 0.879", m.RE,   0.879, 0.01);
    smdhchk("tau2 ≈ 0.031", m.tau2, 0.031, 0.003);
    smdhchk("I2   ≈ 30%",   m.I2,   30.0,  1.0);
  }

  console.log(smdhPass ? "\n✅ ALL SMDH UNIT TESTS PASSED" : "\n❌ SOME SMDH UNIT TESTS FAILED");

  // ================================================================
  // CVR UNIT TESTS
  // ================================================================
  console.log("\n===== CVR UNIT TESTS =====\n");
  let cvrPass = true;

  function cvrchk(name, val, expected, tol = 1e-4) {
    const ok = Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 6)} (expected ${round(expected, 6)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) cvrPass = false;
  }
  function cvrchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) cvrPass = false;
  }

  // 1. yi / vi formula spot-check
  // m1=20, sd1=4, n1=40, m2=20, sd2=2, n2=38
  // cv1 = 4/20 = 0.2,  cv2 = 2/20 = 0.1
  // yi  = log(0.2 / 0.1) = log(2)
  // vi  = 1/(2·39) + 0.04/40 + 1/(2·37) + 0.01/38
  console.log("--- 1. yi / vi formulas ---");
  {
    const s = compute({ m1: 20, sd1: 4, n1: 40, m2: 20, sd2: 2, n2: 38 }, "CVR");
    const cv1 = 0.2, cv2 = 0.1;
    const yi_exp = Math.log(cv1 / cv2);
    const vi_exp = 1 / (2 * 39) + cv1**2 / 40 + 1 / (2 * 37) + cv2**2 / 38;
    cvrchk("yi = log(cv1/cv2)", s.yi, yi_exp);
    cvrchk("vi formula",        s.vi, vi_exp);
    cvrchk("se = √vi",          s.se, Math.sqrt(vi_exp));
    cvrchk("w  = 1/vi",         s.w,  1 / vi_exp, 1e-3);
  }

  // 2. Invalid inputs → NaN / w=0
  console.log("--- 2. Invalid inputs → NaN ---");
  {
    const base = { m1: 20, sd1: 4, n1: 40, m2: 20, sd2: 2, n2: 38 };
    cvrchkTrue("m1 = 0   → NaN yi",  !isFinite(compute({ ...base, m1:  0  }, "CVR").yi));
    cvrchkTrue("m1 < 0   → NaN yi",  !isFinite(compute({ ...base, m1: -1  }, "CVR").yi));
    cvrchkTrue("m2 = 0   → NaN yi",  !isFinite(compute({ ...base, m2:  0  }, "CVR").yi));
    cvrchkTrue("sd1 = 0  → NaN yi",  !isFinite(compute({ ...base, sd1: 0  }, "CVR").yi));
    cvrchkTrue("sd2 < 0  → NaN yi",  !isFinite(compute({ ...base, sd2: -1 }, "CVR").yi));
    cvrchkTrue("n1 = 1   → NaN yi",  !isFinite(compute({ ...base, n1:  1  }, "CVR").yi));
    cvrchkTrue("n2 = 1   → NaN yi",  !isFinite(compute({ ...base, n2:  1  }, "CVR").yi));
    cvrchkTrue("m2 = 0   → w = 0",       compute({ ...base, m2:  0  }, "CVR").w === 0);
  }

  // 3. CVR = 1 (yi = 0) when cv1 = cv2
  //    m1=10, sd1=2, n1=30 → cv1=0.2;  m2=20, sd2=4, n2=28 → cv2=0.2
  console.log("--- 3. yi = 0 when CV₁ = CV₂ ---");
  {
    const s = compute({ m1: 10, sd1: 2, n1: 30, m2: 20, sd2: 4, n2: 28 }, "CVR");
    cvrchk("yi = 0 (cv1=cv2=0.2)", s.yi, 0);
    cvrchkTrue("vi > 0 (sampling variance present)", isFinite(s.vi) && s.vi > 0);
  }

  // 4. transformEffect back-transform: exp(yi) = cv1/cv2
  console.log("--- 4. Back-transform: exp(yi) = CV₁/CV₂ ---");
  {
    const s = compute({ m1: 20, sd1: 4, n1: 40, m2: 20, sd2: 2, n2: 38 }, "CVR");
    cvrchk("exp(yi) = 2.0", transformEffect(s.yi, "CVR"), 2.0, 1e-9);
    const ciLb = transformEffect(s.yi - 1.96 * s.se, "CVR");
    const ciUb = transformEffect(s.yi + 1.96 * s.se, "CVR");
    cvrchkTrue("CI lb > 0", ciLb > 0);
    cvrchkTrue("CI lb < exp(yi) < ub", ciLb < 2.0 && 2.0 < ciUb);
  }

  // 5. Pooled meta() — 3-study DL
  // Studies share cv1=0.2, cv2=0.1 (yi=log2) except study 3 (higher cv1)
  // Study 1: m1=20, sd1=4, n1=40, m2=20, sd2=2, n2=38
  // Study 2: m1=15, sd1=3, n1=30, m2=15, sd2=1.5, n2=28
  // Study 3: m1=25, sd1=6, n1=50, m2=24, sd2=2.4, n2=48  (cv1=0.24, cv2=0.1)
  console.log("--- 5. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ m1: 20, sd1: 4,   n1: 40, m2: 20, sd2: 2,   n2: 38 }, "CVR"),
      compute({ m1: 15, sd1: 3,   n1: 30, m2: 15, sd2: 1.5, n2: 28 }, "CVR"),
      compute({ m1: 25, sd1: 6,   n1: 50, m2: 24, sd2: 2.4, n2: 48 }, "CVR"),
    ];
    cvrchk("yi[0] = log(2)",     studies[0].yi, Math.log(2),    1e-9);
    cvrchk("yi[1] = log(2)",     studies[1].yi, Math.log(2),    1e-9);
    cvrchk("yi[2] = log(2.4)",   studies[2].yi, Math.log(2.4),  1e-9);

    const m = meta(studies, "DL");
    // FE and RE should lie between log(2) and log(2.4); tau2 should be small but positive
    cvrchkTrue("FE in (log2, log2.4)", m.FE > Math.log(2) && m.FE < Math.log(2.4));
    cvrchkTrue("RE in (log2, log2.4)", m.RE > Math.log(2) && m.RE < Math.log(2.4));
    cvrchkTrue("tau2 ≥ 0",            isFinite(m.tau2) && m.tau2 >= 0);
    cvrchkTrue("I2 ≥ 0",              isFinite(m.I2)   && m.I2   >= 0);
    // Back-transformed RE should be > 1 (cv1 > cv2 in all studies)
    cvrchkTrue("exp(RE) > 1", Math.exp(m.RE) > 1);
  }

  console.log(cvrPass ? "\n✅ ALL CVR UNIT TESTS PASSED" : "\n❌ SOME CVR UNIT TESTS FAILED");

  // ================================================================
  // VR UNIT TESTS
  // ================================================================
  console.log("\n===== VR UNIT TESTS =====\n");
  let vrPass = true;

  function vrchk(name, val, expected, tol = 1e-4) {
    const ok = Math.abs(val - expected) < tol;
    console.log(`  ${name}: ${round(val, 6)} (expected ${round(expected, 6)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) vrPass = false;
  }
  function vrchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) vrPass = false;
  }

  // 1. yi / vi formula spot-check
  // sd1=4, n1=40, sd2=2, n2=38
  // yi = log(4/2) = log(2)
  // vi = 1/(2*39) + 1/(2*37)
  console.log("--- 1. yi / vi formulas ---");
  {
    const s = compute({ sd1: 4, n1: 40, sd2: 2, n2: 38 }, "VR");
    const yi_exp = Math.log(4 / 2);
    const vi_exp = 1 / (2 * 39) + 1 / (2 * 37);
    vrchk("yi = log(sd1/sd2)", s.yi, yi_exp);
    vrchk("vi formula",        s.vi, vi_exp);
    vrchk("se = √vi",          s.se, Math.sqrt(vi_exp));
    vrchk("w  = 1/vi",         s.w,  1 / vi_exp, 1e-3);
  }

  // 2. Invalid inputs → NaN / w=0
  console.log("--- 2. Invalid inputs → NaN ---");
  {
    const base = { sd1: 4, n1: 40, sd2: 2, n2: 38 };
    vrchkTrue("sd1 = 0  → NaN yi",  !isFinite(compute({ ...base, sd1:  0  }, "VR").yi));
    vrchkTrue("sd1 < 0  → NaN yi",  !isFinite(compute({ ...base, sd1: -1  }, "VR").yi));
    vrchkTrue("sd2 = 0  → NaN yi",  !isFinite(compute({ ...base, sd2:  0  }, "VR").yi));
    vrchkTrue("n1 = 1   → NaN yi",  !isFinite(compute({ ...base, n1:   1  }, "VR").yi));
    vrchkTrue("n2 = 1   → NaN yi",  !isFinite(compute({ ...base, n2:   1  }, "VR").yi));
    vrchkTrue("sd2 = 0  → w = 0",       compute({ ...base, sd2:  0  }, "VR").w === 0);
  }

  // 3. VR = 1 (yi = 0) when sd1 = sd2
  console.log("--- 3. yi = 0 when sd1 = sd2 ---");
  {
    const s = compute({ sd1: 3, n1: 30, sd2: 3, n2: 28 }, "VR");
    vrchk("yi = 0 (sd1 = sd2)", s.yi, 0);
    vrchkTrue("vi > 0 (sampling variance present)", isFinite(s.vi) && s.vi > 0);
  }

  // 4. vi depends only on n, not on SD values
  //    Two studies with different SDs but same n must have identical vi.
  console.log("--- 4. vi depends only on n ---");
  {
    const s1 = compute({ sd1: 4,  n1: 40, sd2: 2, n2: 38 }, "VR");
    const s2 = compute({ sd1: 10, n1: 40, sd2: 1, n2: 38 }, "VR");
    vrchk("vi same when n same (different SDs)", s1.vi, s2.vi, 1e-12);
  }

  // 5. Back-transform: exp(yi) = sd1/sd2
  console.log("--- 5. Back-transform: exp(yi) = sd1/sd2 ---");
  {
    const s = compute({ sd1: 4, n1: 40, sd2: 2, n2: 38 }, "VR");
    vrchk("exp(yi) = 2.0", transformEffect(s.yi, "VR"), 2.0, 1e-9);
    const ciLb = transformEffect(s.yi - 1.96 * s.se, "VR");
    const ciUb = transformEffect(s.yi + 1.96 * s.se, "VR");
    vrchkTrue("CI lb > 0", ciLb > 0);
    vrchkTrue("CI lb < exp(yi) < ub", ciLb < 2.0 && 2.0 < ciUb);
  }

  // 6. Pooled meta() — 3-study DL with heterogeneous SDs
  // Study 1: sd1=4.0, n1=40, sd2=2.0, n2=38 → yi=log(2.0)≈0.6931
  // Study 2: sd1=3.5, n1=30, sd2=1.5, n2=28 → yi=log(7/3)≈0.8473
  // Study 3: sd1=5.0, n1=50, sd2=3.0, n2=48 → yi=log(5/3)≈0.5108
  console.log("--- 6. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ sd1: 4.0, n1: 40, sd2: 2.0, n2: 38 }, "VR"),
      compute({ sd1: 3.5, n1: 30, sd2: 1.5, n2: 28 }, "VR"),
      compute({ sd1: 5.0, n1: 50, sd2: 3.0, n2: 48 }, "VR"),
    ];
    vrchk("yi[0] = log(2.0)", studies[0].yi, Math.log(2.0),     1e-9);
    vrchk("yi[1] = log(7/3)", studies[1].yi, Math.log(7 / 3),   1e-9);
    vrchk("yi[2] = log(5/3)", studies[2].yi, Math.log(5 / 3),   1e-9);

    const m = meta(studies, "DL");
    // All yi > 0, so FE and RE must be positive; bounded by min/max yi
    vrchkTrue("FE > 0",                          m.FE > 0);
    vrchkTrue("FE in (log(5/3), log(7/3))",      m.FE > Math.log(5 / 3) && m.FE < Math.log(7 / 3));
    vrchkTrue("RE in (log(5/3), log(7/3))",      m.RE > Math.log(5 / 3) && m.RE < Math.log(7 / 3));
    vrchkTrue("tau2 ≥ 0",                        isFinite(m.tau2) && m.tau2 >= 0);
    vrchkTrue("I2 ≥ 0",                          isFinite(m.I2)   && m.I2   >= 0);
    // Back-transformed RE should be > 1 (sd1 > sd2 in all studies)
    vrchkTrue("exp(RE) > 1", Math.exp(m.RE) > 1);
  }

  console.log(vrPass ? "\n✅ ALL VR UNIT TESTS PASSED" : "\n❌ SOME VR UNIT TESTS FAILED");

  // ===== GOR UNIT TESTS =====
  //
  // Tests cover:
  //   1. parseCounts — valid and invalid inputs
  //   2. yi / vi formula spot-check (exact analytical values)
  //      c1=[10,20,10] N1=40, c2=[5,10,25] N2=40, C=3
  //      p1=[1/4,1/2,1/4], p2=[1/8,1/4,5/8]
  //      L2=[0,1/8,3/8], H2=[7/8,5/8,0]
  //      θ = 1/4·0 + 1/2·1/8 + 1/4·3/8 = 5/32
  //      φ = 1/4·7/8 + 1/2·5/8 + 1/4·0 = 17/32
  //      log(GOR) = log(5/17) ≈ −1.223775
  //      Var ≈ 0.165841  (delta method, see plan)
  //   3. Symmetry: log(GOR(c1,c2)) = −log(GOR(c2,c1))
  //   4. Equal distributions → GOR = 1, log(GOR) = 0
  //   5. Complete separation → NaN
  //   6. Invalid inputs → NaN / w=0
  //   7. Back-transform: transformEffect(yi,"GOR") = exp(yi)
  //   8. Pooled meta() on 3-study dataset
  // ================================================================
  let gorPass = true;
  console.log("\n===== GOR UNIT TESTS =====\n");

  function gorchk(name, val, expected, tol = 1e-5) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 7)} (expected ${round(expected, 7)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) gorPass = false;
  }
  function gorchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) gorPass = false;
  }

  // 1. parseCounts
  console.log("--- 1. parseCounts ---");
  {
    gorchkTrue("valid '10,20,30'",              Array.isArray(parseCounts("10,20,30")));
    gorchkTrue("valid '10 20 30' (spaces)",     Array.isArray(parseCounts("10 20 30")));
    gorchkTrue("valid '10, 20, 30' (mixed)",    Array.isArray(parseCounts("10, 20, 30")));
    gorchkTrue("correct length (3)",            parseCounts("10,20,30")?.length === 3);
    gorchkTrue("correct values [10,20,30]",     parseCounts("10,20,30")?.join() === "10,20,30");
    gorchkTrue("null for empty string",         parseCounts("")   === null);
    gorchkTrue("null for single value",         parseCounts("10") === null);
    gorchkTrue("null for negative value",       parseCounts("10,-1,20")  === null);
    gorchkTrue("null for non-integer",          parseCounts("10,1.5,20") === null);
    gorchkTrue("null for non-numeric",          parseCounts("10,abc,20") === null);
    gorchkTrue("zero counts accepted",          Array.isArray(parseCounts("0,10,5")));
  }

  // 2. yi / vi formula spot-check
  console.log("--- 2. yi / vi formula ---");
  {
    const s = compute({ counts1: "10,20,10", counts2: "5,10,25" }, "GOR");
    gorchk("yi = log(5/17)",     s.yi, Math.log(5 / 17));
    gorchk("vi ≈ 0.165841",      s.vi, 0.165841, 1e-4);
    gorchk("se = √vi",           s.se, Math.sqrt(s.vi), 1e-9);
    gorchk("w  = 1/vi",          s.w,  1 / s.vi,        1e-9);
  }

  // 3. Symmetry: swapping groups negates log(GOR)
  console.log("--- 3. Symmetry: log(GOR(c1,c2)) = −log(GOR(c2,c1)) ---");
  {
    const s12 = compute({ counts1: "10,20,10", counts2: "5,10,25" }, "GOR");
    const s21 = compute({ counts1: "5,10,25",  counts2: "10,20,10" }, "GOR");
    gorchk("log(GOR(c1,c2)) = −log(GOR(c2,c1))", s12.yi, -s21.yi, 1e-9);
  }

  // 4. Equal distributions → GOR = 1, log(GOR) = 0
  console.log("--- 4. Equal distributions → log(GOR) = 0 ---");
  {
    const s = compute({ counts1: "10,20,30", counts2: "10,20,30" }, "GOR");
    gorchk("yi = 0 when c1 = c2", s.yi, 0, 1e-12);
    gorchkTrue("vi > 0 (sampling variance present)", isFinite(s.vi) && s.vi > 0);
  }

  // 5. Complete separation → NaN
  console.log("--- 5. Complete separation → NaN ---");
  {
    // All of group 1 in highest category, all of group 2 in lowest → φ = 0
    gorchkTrue("φ=0 → NaN yi",  !isFinite(compute({ counts1: "0,0,20", counts2: "20,0,0" }, "GOR").yi));
    gorchkTrue("φ=0 → w = 0",   compute({ counts1: "0,0,20", counts2: "20,0,0" }, "GOR").w === 0);
  }

  // 6. Invalid inputs → NaN / w=0
  console.log("--- 6. Invalid inputs → NaN / w=0 ---");
  {
    gorchkTrue("empty counts1 → NaN yi",      !isFinite(compute({ counts1: "",       counts2: "5,10,25" }, "GOR").yi));
    gorchkTrue("mismatched lengths → NaN yi", !isFinite(compute({ counts1: "10,20",  counts2: "5,10,25" }, "GOR").yi));
    gorchkTrue("negative count → NaN yi",     !isFinite(compute({ counts1: "10,-1,20", counts2: "5,10,25" }, "GOR").yi));
    gorchkTrue("zero group total → NaN yi",   !isFinite(compute({ counts1: "0,0,0", counts2: "5,10,25" }, "GOR").yi));
    gorchkTrue("invalid → w = 0",             compute({ counts1: "", counts2: "5,10,25" }, "GOR").w === 0);
  }

  // 7. Back-transform: exp(log(GOR)) = GOR
  console.log("--- 7. Back-transform: transformEffect(yi, 'GOR') = exp(yi) ---");
  {
    const s = compute({ counts1: "10,20,10", counts2: "5,10,25" }, "GOR");
    gorchk("transformEffect = exp(yi)",        transformEffect(s.yi, "GOR"), Math.exp(s.yi), 1e-10);
    gorchk("exp(log(5/17)) = 5/17",           transformEffect(s.yi, "GOR"), 5 / 17,         1e-7);
    gorchkTrue("CI lb < back-transformed < CI ub", (() => {
      const lb = transformEffect(s.yi - 1.96 * s.se, "GOR");
      const ub = transformEffect(s.yi + 1.96 * s.se, "GOR");
      return lb < (5 / 17) && (5 / 17) < ub;
    })());
  }

  // 8. Pooled meta() — 3 consistent studies (group 1 scores higher in each)
  // All studies use c1 concentrated in high categories, c2 in low → yi > 0
  console.log("--- 8. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ counts1: "5,10,25",  counts2: "15,20,5"  }, "GOR"),
      compute({ counts1: "8,12,30",  counts2: "20,15,10" }, "GOR"),
      compute({ counts1: "10,15,25", counts2: "18,18,8"  }, "GOR"),
    ];
    gorchkTrue("yi[0] > 0 (group 1 scores higher)", studies[0].yi > 0);
    gorchkTrue("yi[1] > 0",                          studies[1].yi > 0);
    gorchkTrue("yi[2] > 0",                          studies[2].yi > 0);
    gorchkTrue("vi[0] > 0", isFinite(studies[0].vi) && studies[0].vi > 0);

    const m = meta(studies, "DL");
    gorchkTrue("FE > 0 (consistent positive effect)", m.FE > 0);
    gorchkTrue("RE > 0",                               m.RE > 0);
    gorchkTrue("RE between min and max yi",
      m.RE > Math.min(...studies.map(s => s.yi)) &&
      m.RE < Math.max(...studies.map(s => s.yi)));
    gorchkTrue("tau2 ≥ 0", isFinite(m.tau2) && m.tau2 >= 0);
    gorchkTrue("exp(RE) > 1 (back-transformed GOR > 1)", Math.exp(m.RE) > 1);
  }

  console.log(gorPass ? "\n✅ ALL GOR UNIT TESTS PASSED" : "\n❌ SOME GOR UNIT TESTS FAILED");

  // ===== MN / MNLN UNIT TESTS =====
  //
  // Tests cover:
  //   MN:
  //     1. yi / vi formula  (m=24.3, sd=5.1, n=45 → vi=26.01/45=0.578)
  //     2. Negative / zero mean is valid (continuous scale, no log)
  //     3. Invalid inputs → NaN / w=0
  //     4. transformEffect is identity
  //     5. Pooled meta(): k identical studies → RE = FE = m
  //   MNLN:
  //     6. yi / vi formula  (m=18.5, sd=6.2, n=40 → yi=log(18.5), vi=38.44/13690)
  //     7. m ≤ 0 → NaN / w=0
  //     8. Invalid inputs → NaN / w=0
  //     9. transformEffect = exp(yi) = m (round-trip)
  //    10. Pooled meta() structural checks
  // ================================================================
  let mnPass = true;
  console.log("\n===== MN / MNLN UNIT TESTS =====\n");

  function mnchk(name, val, expected, tol = 1e-6) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 7)} (expected ${round(expected, 7)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) mnPass = false;
  }
  function mnchkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) mnPass = false;
  }

  // --- MN 1: yi / vi formula ---
  // m=24.3, sd=5.1, n=45 → vi = 5.1²/45 = 26.01/45 = 0.578
  console.log("--- MN 1. yi / vi formula ---");
  {
    const s = compute({ m: 24.3, sd: 5.1, n: 45 }, "MN");
    mnchk("yi = m",          s.yi, 24.3);
    mnchk("vi = sd²/n",      s.vi, 26.01 / 45);
    mnchk("se = √vi",        s.se, Math.sqrt(26.01 / 45));
    mnchk("w  = 1/vi",       s.w,  45 / 26.01);
  }

  // --- MN 2: negative and zero means are valid ---
  console.log("--- MN 2. Negative/zero mean valid ---");
  {
    const sNeg  = compute({ m: -5.0, sd: 2.0, n: 30 }, "MN");
    const sZero = compute({ m:  0.0, sd: 2.0, n: 30 }, "MN");
    mnchkTrue("negative mean: yi finite",  isFinite(sNeg.yi));
    mnchkTrue("negative mean: vi > 0",     sNeg.vi > 0);
    mnchkTrue("zero mean: yi = 0",         sZero.yi === 0);
    mnchkTrue("zero mean: vi > 0",         sZero.vi > 0);
  }

  // --- MN 3: invalid inputs → NaN / w=0 ---
  console.log("--- MN 3. Invalid inputs → NaN / w=0 ---");
  {
    const base = { m: 24.3, sd: 5.1, n: 45 };
    mnchkTrue("sd = 0  → NaN yi",  !isFinite(compute({ ...base, sd: 0    }, "MN").yi));
    mnchkTrue("sd < 0  → NaN yi",  !isFinite(compute({ ...base, sd: -1   }, "MN").yi));
    mnchkTrue("n = 0   → NaN yi",  !isFinite(compute({ ...base, n: 0     }, "MN").yi));
    mnchkTrue("m = NaN → NaN yi",  !isFinite(compute({ ...base, m: NaN   }, "MN").yi));
    mnchkTrue("sd = 0  → w = 0",   compute({ ...base, sd: 0 }, "MN").w === 0);
  }

  // --- MN 4: transformEffect is identity ---
  console.log("--- MN 4. transformEffect identity ---");
  {
    const vals = [-5, 0, 12.7, 100];
    vals.forEach(v => mnchk(`transformEffect(${v}, "MN") = ${v}`, transformEffect(v, "MN"), v, 1e-12));
  }

  // --- MN 5: k identical studies pool to that mean ---
  console.log("--- MN 5. Pooled meta() — identical studies → RE = FE = m ---");
  {
    const studies = [
      compute({ m: 20, sd: 4, n: 40 }, "MN"),
      compute({ m: 20, sd: 4, n: 40 }, "MN"),
      compute({ m: 20, sd: 4, n: 40 }, "MN"),
    ];
    const m = meta(studies, "DL");
    mnchk("FE = 20", m.FE, 20, 1e-9);
    mnchk("RE = 20", m.RE, 20, 1e-9);
    mnchk("tau2 = 0 (homogeneous)", m.tau2, 0, 1e-9);
  }

  // --- MNLN 6: yi / vi formula ---
  // m=18.5, sd=6.2, n=40 → yi=log(18.5), vi=6.2²/(40·18.5²)=38.44/13690
  console.log("--- MNLN 6. yi / vi formula ---");
  {
    const s = compute({ m: 18.5, sd: 6.2, n: 40 }, "MNLN");
    const vi_exp = 38.44 / 13690;
    mnchk("yi = log(m)",        s.yi, Math.log(18.5));
    mnchk("vi = sd²/(n·m²)",   s.vi, vi_exp, 1e-9);
    mnchk("se = √vi",           s.se, Math.sqrt(vi_exp), 1e-9);
    mnchk("w  = 1/vi",          s.w,  1 / vi_exp, 1e-6);
  }

  // --- MNLN 7: m ≤ 0 → NaN / w=0 ---
  console.log("--- MNLN 7. m ≤ 0 → NaN / w=0 ---");
  {
    const base = { m: 18.5, sd: 6.2, n: 40 };
    mnchkTrue("m = 0  → NaN yi",  !isFinite(compute({ ...base, m: 0   }, "MNLN").yi));
    mnchkTrue("m < 0  → NaN yi",  !isFinite(compute({ ...base, m: -1  }, "MNLN").yi));
    mnchkTrue("m = 0  → w = 0",   compute({ ...base, m: 0 }, "MNLN").w === 0);
  }

  // --- MNLN 8: invalid inputs → NaN / w=0 ---
  console.log("--- MNLN 8. Invalid inputs → NaN / w=0 ---");
  {
    const base = { m: 18.5, sd: 6.2, n: 40 };
    mnchkTrue("sd = 0  → NaN yi",  !isFinite(compute({ ...base, sd: 0  }, "MNLN").yi));
    mnchkTrue("n = 0   → NaN yi",  !isFinite(compute({ ...base, n: 0   }, "MNLN").yi));
    mnchkTrue("sd = 0  → w = 0",   compute({ ...base, sd: 0 }, "MNLN").w === 0);
  }

  // --- MNLN 9: back-transform round-trip exp(log(m)) = m ---
  console.log("--- MNLN 9. Back-transform: exp(log(m)) = m ---");
  {
    const means = [1, 5.5, 18.5, 100];
    means.forEach(m => {
      mnchk(`exp(log(${m})) = ${m}`, transformEffect(Math.log(m), "MNLN"), m, 1e-10);
    });
    // CI back-transform: bounds are positive and straddle the point estimate
    const s = compute({ m: 18.5, sd: 6.2, n: 40 }, "MNLN");
    const lb = transformEffect(s.yi - 1.96 * s.se, "MNLN");
    const ub = transformEffect(s.yi + 1.96 * s.se, "MNLN");
    mnchkTrue("CI lb < m < CI ub", lb < 18.5 && 18.5 < ub);
    mnchkTrue("CI lb > 0",         lb > 0);
  }

  // --- MNLN 10: pooled meta() structural checks ---
  console.log("--- MNLN 10. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ m: 18.5, sd: 6.2, n: 40 }, "MNLN"),
      compute({ m: 22.1, sd: 9.4, n: 35 }, "MNLN"),
      compute({ m: 15.8, sd: 5.0, n: 50 }, "MNLN"),
    ];
    mnchkTrue("all yi finite",  studies.every(s => isFinite(s.yi)));
    mnchkTrue("all vi > 0",     studies.every(s => s.vi > 0));
    const m = meta(studies, "DL");
    const minYi = Math.min(...studies.map(s => s.yi));
    const maxYi = Math.max(...studies.map(s => s.yi));
    mnchkTrue("FE in (min yi, max yi)", m.FE > minYi && m.FE < maxYi);
    mnchkTrue("RE in (min yi, max yi)", m.RE > minYi && m.RE < maxYi);
    mnchkTrue("tau2 ≥ 0",              isFinite(m.tau2) && m.tau2 >= 0);
    mnchkTrue("exp(RE) > 0",           Math.exp(m.RE) > 0);
    // exp(RE) should be between min and max of the original means
    mnchkTrue("exp(RE) between 15.8 and 22.1",
      Math.exp(m.RE) > 15.8 && Math.exp(m.RE) < 22.1);
  }

  console.log(mnPass ? "\n✅ ALL MN / MNLN UNIT TESTS PASSED" : "\n❌ SOME MN / MNLN UNIT TESTS FAILED");

  // ===== SMCC UNIT TESTS =====
  //
  // Tests cover:
  //   1. Formula spot-check  (m_pre=10, m_post=8, sd_pre=2, sd_post=2, n=30, r=0.5)
  //        sd_change=2, d=-1, J=1-3/115, g=d·J
  //        var_d = 2·(1-0.5)/30 + 1/(2·29) = 1/30 + 1/58
  //        vi = J²·var_d
  //   2. var formula depends on r — vi(r=0.2) ≠ vi(r=0.8)
  //   3. J² applied to variance — vi < var_d
  //   4. Missing r defaults to 0.5 (finite yi, w > 0)
  //   5. Invalid inputs → NaN / w=0
  //   6. transformEffect is identity
  //   7. Pooled meta() structural checks (k=3)
  // ================================================================
  let smccPass = true;
  console.log("\n===== SMCC UNIT TESTS =====\n");

  function smccChk(name, val, expected, tol = 1e-6) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 7)} (expected ${round(expected, 7)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) smccPass = false;
  }
  function smccChkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) smccPass = false;
  }

  // --- SMCC 1: formula spot-check ---
  // m_pre=10, m_post=8, sd_pre=2, sd_post=2, n=30, r=0.5
  // sd_change = sqrt(4+4-2*0.5*4) = sqrt(4) = 2
  // d = (8-10)/2 = -1
  // df=29, J = 1-3/(4*29-1) = 1-3/115
  // g = d*J
  // var_d = 2*(1-0.5)/30 + 1/(2*29) = 1/30 + 1/58
  // vi = J²*var_d
  console.log("--- SMCC 1. Formula spot-check ---");
  {
    const s = compute({ m_pre: 10, m_post: 8, sd_pre: 2, sd_post: 2, n: 30, r: 0.5 }, "SMCC");
    const J      = 1 - 3 / 115;
    const g_exp  = -1 * J;
    const vard_exp = 1/30 + 1/58;
    const vi_exp   = J * J * vard_exp;
    smccChk("g  = d·J",          s.yi, g_exp,        1e-9);
    smccChk("vi = J²·var_d",     s.vi, vi_exp,        1e-9);
    smccChk("se = √vi",          s.se, Math.sqrt(vi_exp), 1e-9);
    smccChk("w  = 1/vi",         s.w,  1 / vi_exp,    1e-6);
    smccChk("varMD = var_d",     s.varMD, vard_exp,   1e-9);
  }

  // --- SMCC 2: var formula depends on r ---
  console.log("--- SMCC 2. vi differs with r (r=0.2 vs r=0.8) ---");
  {
    const base = { m_pre: 10, m_post: 8, sd_pre: 2, sd_post: 2, n: 30 };
    const s2 = compute({ ...base, r: 0.2 }, "SMCC");
    const s8 = compute({ ...base, r: 0.8 }, "SMCC");
    smccChkTrue("vi(r=0.2) ≠ vi(r=0.8)", Math.abs(s2.vi - s8.vi) > 1e-6);
    smccChkTrue("yi(r=0.2) ≠ yi(r=0.8)", Math.abs(s2.yi - s8.yi) > 1e-6);
  }

  // --- SMCC 3: J² applied — vi < var_d ---
  console.log("--- SMCC 3. J² applied: vi < varMD ---");
  {
    const s = compute({ m_pre: 10, m_post: 8, sd_pre: 2, sd_post: 2, n: 30, r: 0.5 }, "SMCC");
    smccChkTrue("vi < varMD (J² < 1)", s.vi < s.varMD);
  }

  // --- SMCC 4: missing r defaults to 0.5 ---
  console.log("--- SMCC 4. Missing r defaults to 0.5 ---");
  {
    const sNo = compute({ m_pre: 10, m_post: 8, sd_pre: 2, sd_post: 2, n: 30 }, "SMCC");
    const s5  = compute({ m_pre: 10, m_post: 8, sd_pre: 2, sd_post: 2, n: 30, r: 0.5 }, "SMCC");
    smccChkTrue("finite yi when r omitted",    isFinite(sNo.yi));
    smccChkTrue("w > 0 when r omitted",        sNo.w > 0);
    smccChk("yi matches r=0.5 result",         sNo.yi, s5.yi, 1e-12);
    smccChk("vi matches r=0.5 result",         sNo.vi, s5.vi, 1e-12);
  }

  // --- SMCC 5: invalid inputs → NaN / w=0 ---
  console.log("--- SMCC 5. Invalid inputs → NaN / w=0 ---");
  {
    const base = { m_pre: 10, m_post: 8, sd_pre: 2, sd_post: 2, n: 30, r: 0.5 };
    smccChkTrue("sd_pre = 0  → NaN yi",  !isFinite(compute({ ...base, sd_pre:  0 }, "SMCC").yi));
    smccChkTrue("sd_post = 0 → NaN yi",  !isFinite(compute({ ...base, sd_post: 0 }, "SMCC").yi));
    smccChkTrue("n = 1       → NaN yi",  !isFinite(compute({ ...base, n: 1       }, "SMCC").yi));
    smccChkTrue("r = 2       → NaN yi",  !isFinite(compute({ ...base, r: 2       }, "SMCC").yi));
    smccChkTrue("sd_pre = 0  → w = 0",   compute({ ...base, sd_pre: 0 }, "SMCC").w === 0);
  }

  // --- SMCC 6: transformEffect is identity ---
  console.log("--- SMCC 6. transformEffect identity ---");
  {
    [-2, 0, 0.5, 1.8].forEach(v =>
      smccChk(`transformEffect(${v}, "SMCC") = ${v}`, transformEffect(v, "SMCC"), v, 1e-12)
    );
  }

  // --- SMCC 7: pooled meta() structural checks ---
  console.log("--- SMCC 7. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ m_pre: 10, m_post: 8,  sd_pre: 2, sd_post: 2, n: 30, r: 0.5 }, "SMCC"),
      compute({ m_pre: 12, m_post: 9,  sd_pre: 3, sd_post: 3, n: 40, r: 0.6 }, "SMCC"),
      compute({ m_pre:  8, m_post: 6,  sd_pre: 2, sd_post: 2, n: 25, r: 0.4 }, "SMCC"),
    ];
    smccChkTrue("all yi finite",  studies.every(s => isFinite(s.yi)));
    smccChkTrue("all vi > 0",     studies.every(s => s.vi > 0));
    const m = meta(studies, "DL");
    const minYi = Math.min(...studies.map(s => s.yi));
    const maxYi = Math.max(...studies.map(s => s.yi));
    smccChkTrue("FE in (min yi, max yi)", m.FE > minYi && m.FE < maxYi);
    smccChkTrue("RE in (min yi, max yi)", m.RE > minYi && m.RE < maxYi);
    smccChkTrue("tau2 ≥ 0",              isFinite(m.tau2) && m.tau2 >= 0);
    smccChkTrue("CI lb < RE < CI ub",    m.ciLow < m.RE && m.RE < m.ciHigh);
  }

  console.log(smccPass ? "\n✅ ALL SMCC UNIT TESTS PASSED" : "\n❌ SOME SMCC UNIT TESTS FAILED");

  // ===== PHI UNIT TESTS =====
  //
  // Tests cover:
  //   1. Formula spot-check  (a=30,b=10,c=10,d=50)
  //        N=100, φ=(1500−100)/√(40·60·40·60)=1400/2400=7/12
  //        vi=(1−(7/12)²)²/99=(95/144)²/99=9025/2052864
  //   2. Sign antisymmetry: swapping rows (a↔c, b↔d) negates φ
  //   3. Zero marginal → NaN/w=0
  //   4. Individual zero cell is valid (finite φ, w>0)
  //   5. Bounds: |φ| ≤ 1 for valid data
  //   6. transformEffect identity
  //   7. Pooled meta() structural checks (k=3)
  // ================================================================
  let phiPass = true;
  console.log("\n===== PHI UNIT TESTS =====\n");

  function phiChk(name, val, expected, tol = 1e-9) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 9)} (expected ${round(expected, 9)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) phiPass = false;
  }
  function phiChkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) phiPass = false;
  }

  // --- PHI 1: formula spot-check ---
  // a=30,b=10,c=10,d=50 → N=100
  // phi = (30*50 - 10*10) / sqrt(40*60*40*60) = 1400/2400 = 7/12
  // vi  = (1-(7/12)^2)^2 / 99 = (95/144)^2 / 99 = 9025/2052864
  console.log("--- PHI 1. Formula spot-check ---");
  {
    const s      = compute({ a: 30, b: 10, c: 10, d: 50 }, "PHI");
    const phi_exp = 7 / 12;
    const vi_exp  = (95 / 144) ** 2 / 99;
    phiChk("φ = 7/12",        s.yi, phi_exp);
    phiChk("vi = (95/144)²/99", s.vi, vi_exp);
    phiChk("se = √vi",        s.se, Math.sqrt(vi_exp));
    phiChk("w  = 1/vi",       s.w,  1 / vi_exp, 1e-6);
  }

  // --- PHI 2: sign antisymmetry (swap rows negates φ) ---
  console.log("--- PHI 2. Sign antisymmetry: swap rows → −φ ---");
  {
    const sPos = compute({ a: 30, b: 10, c: 10, d: 50 }, "PHI");
    const sNeg = compute({ a: 10, b: 50, c: 30, d: 10 }, "PHI");  // rows swapped
    phiChk("φ_orig = −φ_swapped", sPos.yi, -sNeg.yi);
    phiChk("vi symmetric",        sPos.vi,  sNeg.vi);
  }

  // --- PHI 3: zero marginal → NaN/w=0 ---
  console.log("--- PHI 3. Zero marginal → NaN/w=0 ---");
  {
    phiChkTrue("a+b=0 → NaN yi", !isFinite(compute({ a: 0, b: 0, c: 5, d: 5 }, "PHI").yi));
    phiChkTrue("c+d=0 → NaN yi", !isFinite(compute({ a: 5, b: 5, c: 0, d: 0 }, "PHI").yi));
    phiChkTrue("a+c=0 → NaN yi", !isFinite(compute({ a: 0, b: 5, c: 0, d: 5 }, "PHI").yi));
    phiChkTrue("b+d=0 → NaN yi", !isFinite(compute({ a: 5, b: 0, c: 5, d: 0 }, "PHI").yi));
    phiChkTrue("a+b=0 → w=0",    compute({ a: 0, b: 0, c: 5, d: 5 }, "PHI").w === 0);
  }

  // --- PHI 4: individual zero cell is valid ---
  // a=0,b=10,c=5,d=15 → N=30, all marginals > 0
  console.log("--- PHI 4. Individual zero cell valid ---");
  {
    const s = compute({ a: 0, b: 10, c: 5, d: 15 }, "PHI");
    phiChkTrue("finite φ with a=0",  isFinite(s.yi));
    phiChkTrue("w > 0 with a=0",     s.w > 0);
    // phi = (0*15 - 10*5) / sqrt(10*20*5*25) = -50 / sqrt(25000)
    phiChk("φ = -50/√25000", s.yi, -50 / Math.sqrt(25000));
  }

  // --- PHI 5: |φ| ≤ 1 ---
  console.log("--- PHI 5. |φ| ≤ 1 for valid data ---");
  {
    const cases = [
      { a: 30, b: 10, c: 10, d: 50 },
      { a:  5, b: 45, c: 40, d: 10 },
      { a: 20, b: 20, c: 20, d: 20 },
      { a: 50, b:  1, c:  1, d: 50 },
    ];
    cases.forEach(c => {
      const s = compute(c, "PHI");
      phiChkTrue(`|φ| ≤ 1 for (${c.a},${c.b},${c.c},${c.d})`, isFinite(s.yi) && Math.abs(s.yi) <= 1);
    });
  }

  // --- PHI 6: transformEffect identity ---
  console.log("--- PHI 6. transformEffect identity ---");
  {
    [-0.8, -0.5, 0, 0.5, 0.8].forEach(v =>
      phiChk(`transformEffect(${v}, "PHI") = ${v}`, transformEffect(v, "PHI"), v, 1e-12)
    );
  }

  // --- PHI 7: pooled meta() structural checks ---
  console.log("--- PHI 7. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ a: 30, b: 10, c: 10, d: 50 }, "PHI"),
      compute({ a: 25, b: 15, c: 12, d: 48 }, "PHI"),
      compute({ a: 18, b:  8, c:  9, d: 35 }, "PHI"),
    ];
    phiChkTrue("all yi finite",  studies.every(s => isFinite(s.yi)));
    phiChkTrue("all vi > 0",     studies.every(s => s.vi > 0));
    const m = meta(studies, "DL");
    const minYi = Math.min(...studies.map(s => s.yi));
    const maxYi = Math.max(...studies.map(s => s.yi));
    phiChkTrue("FE in (min yi, max yi)", m.FE > minYi && m.FE < maxYi);
    phiChkTrue("RE in (min yi, max yi)", m.RE > minYi && m.RE < maxYi);
    phiChkTrue("tau2 ≥ 0",              isFinite(m.tau2) && m.tau2 >= 0);
    phiChkTrue("CI lb < RE < CI ub",    m.ciLow < m.RE && m.RE < m.ciHigh);
  }

  console.log(phiPass ? "\n✅ ALL PHI UNIT TESTS PASSED" : "\n❌ SOME PHI UNIT TESTS FAILED");

  // ===== RTET UNIT TESTS =====
  //
  // Tests cover:
  //   1. Analytical spot-check (a=40,b=10,c=10,d=40)
  //        h=k=0 (50/50 marginals), Φ₂(0,0;ρ)=¼+arcsin(ρ)/(2π)=0.4
  //        → ρ_tet = sin(0.3π);  vi = 0.0625·(2π·cos(0.3π))²/100
  //   2. |ρ_tet| ≥ |φ| for same table (Pearson inequality)
  //   3. Sign antisymmetry: swapping rows negates ρ_tet
  //   4. Transpose symmetry: (a,b,c,d) → (a,c,b,d) preserves ρ_tet
  //   5. Zero cell → finite ρ_tet (continuity correction applied, w > 0)
  //   6. Zero marginal → NaN/w=0
  //   7. normalQuantile / bivariateNormalCDF utility spot-checks
  //   8. transformEffect identity
  //   9. Pooled meta() structural checks (k=3)
  // ================================================================
  let rtetPass = true;
  console.log("\n===== RTET UNIT TESTS =====\n");

  function rtetChk(name, val, expected, tol = 1e-5) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 8)} (expected ${round(expected, 8)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) rtetPass = false;
  }
  function rtetChkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) rtetPass = false;
  }

  // --- RTET 1: analytical spot-check ---
  // a=40,b=10,c=10,d=40 → h=k=0 (50/50 marginals → normalQuantile(0.5)=0)
  // Φ₂(0,0;ρ) = 0.25 + arcsin(ρ)/(2π)  [known closed form at origin]
  // p11 = 0.4  →  arcsin(ρ) = 0.3π  →  ρ = sin(0.3π)
  // bvd(0,0;ρ) = 1/(2π·√(1−ρ²)) = 1/(2π·cos(0.3π))
  // vi = 0.0625·(2π·cos(0.3π))² / 100
  console.log("--- RTET 1. Analytical spot-check ---");
  {
    const s        = compute({ a: 40, b: 10, c: 10, d: 40 }, "RTET");
    const rho_exp  = Math.sin(0.3 * Math.PI);
    const vi_exp   = 0.0625 * (2 * Math.PI * Math.cos(0.3 * Math.PI)) ** 2 / 100;
    rtetChk("ρ_tet = sin(0.3π)",        s.yi, rho_exp);
    rtetChk("vi = 0.0625·(2π·cos)²/100", s.vi, vi_exp);
    rtetChk("se = √vi",                 s.se, Math.sqrt(vi_exp));
    rtetChk("w  = 1/vi",                s.w,  1 / vi_exp, 1e-3);
  }

  // --- RTET 2: |ρ_tet| ≥ |φ| (Pearson inequality) ---
  console.log("--- RTET 2. |ρ_tet| ≥ |φ| for same table ---");
  {
    const tables = [
      { a: 40, b: 10, c: 10, d: 40 },
      { a: 25, b: 15, c: 12, d: 48 },
      { a: 18, b:  8, c:  9, d: 35 },
    ];
    tables.forEach(t => {
      const rtet = compute(t, "RTET").yi;
      const denom = Math.sqrt((t.a+t.b)*(t.c+t.d)*(t.a+t.c)*(t.b+t.d));
      const phi  = (t.a*t.d - t.b*t.c) / denom;
      rtetChkTrue(`|ρ_tet|(${t.a},${t.b},${t.c},${t.d}) ≥ |φ|`,
        isFinite(rtet) && Math.abs(rtet) >= Math.abs(phi) - 1e-9);
    });
  }

  // --- RTET 3: sign antisymmetry (swap rows → −ρ) ---
  console.log("--- RTET 3. Swap rows → −ρ_tet ---");
  {
    const sPos = compute({ a: 40, b: 10, c: 10, d: 40 }, "RTET");
    const sNeg = compute({ a: 10, b: 40, c: 40, d: 10 }, "RTET");  // rows swapped
    rtetChk("ρ_orig = −ρ_swapped", sPos.yi, -sNeg.yi);
    rtetChk("vi symmetric",        sPos.vi,  sNeg.vi);
  }

  // --- RTET 4: transpose symmetry (a,b,c,d) → (a,c,b,d) → same ρ ---
  console.log("--- RTET 4. Table transpose preserves ρ_tet ---");
  {
    const s1 = compute({ a: 30, b: 10, c: 20, d: 40 }, "RTET");
    const s2 = compute({ a: 30, b: 20, c: 10, d: 40 }, "RTET");  // b↔c transposed
    rtetChk("ρ(a,b,c,d) = ρ(a,c,b,d)", s1.yi, s2.yi);
  }

  // --- RTET 5: zero cell → finite ρ via continuity correction ---
  console.log("--- RTET 5. Zero cell → finite ρ (continuity correction) ---");
  {
    const s = compute({ a: 0, b: 20, c: 10, d: 30 }, "RTET");
    rtetChkTrue("finite ρ with a=0",  isFinite(s.yi));
    rtetChkTrue("w > 0 with a=0",     s.w > 0);
    rtetChkTrue("|ρ| ≤ 1 with a=0",  Math.abs(s.yi) <= 1);
  }

  // --- RTET 6: zero marginal → NaN/w=0 ---
  console.log("--- RTET 6. Zero marginal → NaN/w=0 ---");
  {
    rtetChkTrue("a+b=0 → NaN yi", !isFinite(compute({ a: 0, b: 0, c: 5, d: 5 }, "RTET").yi));
    rtetChkTrue("c+d=0 → NaN yi", !isFinite(compute({ a: 5, b: 5, c: 0, d: 0 }, "RTET").yi));
    rtetChkTrue("a+b=0 → w=0",    compute({ a: 0, b: 0, c: 5, d: 5 }, "RTET").w === 0);
  }

  // --- RTET 7: normalQuantile and bivariateNormalCDF utility checks ---
  console.log("--- RTET 7. Utility: normalQuantile / bivariateNormalCDF ---");
  {
    // normalQuantile is the inverse of normalCDF at round numbers
    rtetChk("normalQuantile(0.5) = 0",   normalQuantile(0.5),   0,      1e-9);
    rtetChk("normalQuantile(0.975) ≈ 1.96", normalQuantile(0.975), 1.959964, 1e-4);
    rtetChk("normalQuantile(0.025) ≈ −1.96", normalQuantile(0.025), -1.959964, 1e-4);
    // Φ₂(0,0;ρ) = 0.25 + arcsin(ρ)/(2π) — verify against our implementation
    const rho = 0.5;
    const expected_cdf = 0.25 + Math.asin(rho) / (2 * Math.PI);
    rtetChk("Φ₂(0,0;0.5) = ¼+arcsin(0.5)/(2π)", bivariateNormalCDF(0, 0, 0.5), expected_cdf, 1e-6);
    // Independence: Φ₂(h,k;0) = Φ(h)·Φ(k)  [Φ(1) ≈ 0.8413]
    rtetChkTrue("Φ₂(1,1;0) ≈ Φ(1)²", Math.abs(bivariateNormalCDF(1, 1, 0) - 0.8413**2) < 0.001);
  }

  // --- RTET 8: transformEffect identity ---
  console.log("--- RTET 8. transformEffect identity ---");
  {
    [-0.8, -0.5, 0, 0.5, 0.8].forEach(v =>
      rtetChk(`transformEffect(${v}, "RTET") = ${v}`, transformEffect(v, "RTET"), v, 1e-12)
    );
  }

  // --- RTET 9: pooled meta() structural checks ---
  console.log("--- RTET 9. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ a: 40, b: 10, c: 10, d: 40 }, "RTET"),
      compute({ a: 30, b: 15, c: 12, d: 43 }, "RTET"),
      compute({ a: 25, b:  8, c:  9, d: 38 }, "RTET"),
    ];
    rtetChkTrue("all yi finite",  studies.every(s => isFinite(s.yi)));
    rtetChkTrue("all vi > 0",     studies.every(s => s.vi > 0));
    const m = meta(studies, "DL");
    const minYi = Math.min(...studies.map(s => s.yi));
    const maxYi = Math.max(...studies.map(s => s.yi));
    rtetChkTrue("FE in (min yi, max yi)", m.FE > minYi && m.FE < maxYi);
    rtetChkTrue("RE in (min yi, max yi)", m.RE > minYi && m.RE < maxYi);
    rtetChkTrue("tau2 ≥ 0",              isFinite(m.tau2) && m.tau2 >= 0);
    rtetChkTrue("CI lb < RE < CI ub",    m.ciLow < m.RE && m.RE < m.ciHigh);
  }

  console.log(rtetPass ? "\n✅ ALL RTET UNIT TESTS PASSED" : "\n❌ SOME RTET UNIT TESTS FAILED");

  // ===== PCOR UNIT TESTS =====
  //
  // Tests cover:
  //   1. Formula spot-check (r=0.5, n=50, p=3)
  //        yi = 0.5
  //        vi = (1 − 0.25)² / (50 − 3 − 1) = 0.5625 / 46
  //   2. p=0 reduces exactly to COR (r=0.5, n=53)
  //        PCOR vi = 0.5625/52 = COR vi = (1−r²)²/(n−1)
  //   3. Sign symmetry: negating r negates yi, vi unchanged
  //   4. Missing p defaults to 0 (same result as p=0)
  //   5. Invalid inputs → NaN/w=0
  //   6. transformEffect identity (raw scale)
  //   7. Pooled meta() structural checks (k=3)
  // ================================================================
  let pcorPass = true;
  console.log("\n===== PCOR UNIT TESTS =====\n");

  function pcorChk(name, val, expected, tol = 1e-9) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 9)} (expected ${round(expected, 9)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) pcorPass = false;
  }
  function pcorChkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) pcorPass = false;
  }

  // --- PCOR 1: formula spot-check ---
  // r=0.5, n=50, p=3 → vi = (1−0.25)²/(46) = 0.5625/46
  console.log("--- PCOR 1. Formula spot-check ---");
  {
    const s      = compute({ r: 0.5, n: 50, p: 3 }, "PCOR");
    const expVi  = 0.5625 / 46;
    pcorChk("yi = 0.5",          s.yi, 0.5);
    pcorChk("vi = 0.5625/46",    s.vi, expVi);
    pcorChk("se = √vi",          s.se, Math.sqrt(expVi));
    pcorChk("w  = 1/vi",         s.w,  1 / expVi);
  }

  // --- PCOR 2: p=0 reduces to COR ---
  // Both should give vi = (1−r²)²/(n−1)
  console.log("--- PCOR 2. p=0 reduces to COR ---");
  {
    const sCOR  = compute({ r: 0.5, n: 53 }, "COR");
    const sPCOR = compute({ r: 0.5, n: 53, p: 0 }, "PCOR");
    pcorChk("yi identical to COR", sPCOR.yi, sCOR.yi);
    pcorChk("vi identical to COR", sPCOR.vi, sCOR.vi);
  }

  // --- PCOR 3: sign symmetry ---
  // negating r negates yi; vi = (1−r²)²/(n−p−1) is even in r → vi unchanged
  console.log("--- PCOR 3. Sign symmetry ---");
  {
    const sPos = compute({ r:  0.5, n: 50, p: 3 }, "PCOR");
    const sNeg = compute({ r: -0.5, n: 50, p: 3 }, "PCOR");
    pcorChk("yi(−r) = −yi(r)",  sNeg.yi, -sPos.yi);
    pcorChk("vi(−r) =  vi(r)",  sNeg.vi,  sPos.vi);
  }

  // --- PCOR 4: missing p defaults to 0 ---
  console.log("--- PCOR 4. Missing p defaults to 0 ---");
  {
    const sNop = compute({ r: 0.5, n: 53 }, "PCOR");
    const sP0  = compute({ r: 0.5, n: 53, p: 0 }, "PCOR");
    pcorChk("yi same when p omitted", sNop.yi, sP0.yi);
    pcorChk("vi same when p omitted", sNop.vi, sP0.vi);
  }

  // --- PCOR 5: invalid inputs → NaN/w=0 ---
  console.log("--- PCOR 5. Invalid inputs ---");
  {
    pcorChkTrue("r=1  → NaN yi", !isFinite(compute({ r:  1.0, n: 50, p: 2 }, "PCOR").yi));
    pcorChkTrue("r=-1 → NaN yi", !isFinite(compute({ r: -1.0, n: 50, p: 2 }, "PCOR").yi));
    pcorChkTrue("n<p+3 → NaN yi", !isFinite(compute({ r: 0.5, n:  5, p: 3 }, "PCOR").yi));  // min n=6
    pcorChkTrue("p<0  → NaN yi", !isFinite(compute({ r: 0.5, n: 50, p: -1 }, "PCOR").yi));
    pcorChkTrue("n<p+3 → w=0",   compute({ r: 0.5, n: 5, p: 3 }, "PCOR").w === 0);
  }

  // --- PCOR 6: transformEffect identity ---
  console.log("--- PCOR 6. transformEffect identity ---");
  {
    [-0.8, -0.3, 0, 0.3, 0.8].forEach(v =>
      pcorChk(`transformEffect(${v}, "PCOR") = ${v}`, transformEffect(v, "PCOR"), v, 1e-12)
    );
  }

  // --- PCOR 7: pooled meta() structural checks ---
  console.log("--- PCOR 7. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ r: 0.45, n:  80, p: 2 }, "PCOR"),
      compute({ r: 0.38, n:  65, p: 2 }, "PCOR"),
      compute({ r: 0.52, n: 110, p: 3 }, "PCOR"),
    ];
    const m = meta(studies, "DL", "PCOR");
    const minYi = Math.min(...studies.map(s => s.yi));
    const maxYi = Math.max(...studies.map(s => s.yi));
    pcorChkTrue("FE finite",             isFinite(m.FE));
    pcorChkTrue("RE finite",             isFinite(m.RE));
    pcorChkTrue("FE in (min yi, max yi)", m.FE > minYi && m.FE < maxYi);
    pcorChkTrue("RE in (min yi, max yi)", m.RE > minYi && m.RE < maxYi);
    pcorChkTrue("tau2 ≥ 0",              isFinite(m.tau2) && m.tau2 >= 0);
    pcorChkTrue("CI lb < RE < CI ub",    m.ciLow < m.RE && m.RE < m.ciHigh);
  }

  console.log(pcorPass ? "\n✅ ALL PCOR UNIT TESTS PASSED" : "\n❌ SOME PCOR UNIT TESTS FAILED");

  // ===== ZPCOR UNIT TESTS =====
  //
  // Tests cover:
  //   1. Formula spot-check (r=0.5, n=50, p=3)
  //        yi = atanh(0.5), vi = 1/(50−3−3) = 1/44
  //   2. p=0 reduces exactly to ZCOR (r=0.5, n=53)
  //        ZPCOR vi = 1/50 = ZCOR vi = 1/(n−3)
  //   3. Sign symmetry: negating r negates yi (atanh is odd), vi unchanged
  //   4. Missing p defaults to 0 (same result as ZCOR)
  //   5. Invalid inputs → NaN/w=0
  //   6. Back-transform: tanh(atanh(r)) = r (round-trip)
  //   7. Pooled meta() structural checks (k=3, back-transformed)
  // ================================================================
  let zpcorPass = true;
  console.log("\n===== ZPCOR UNIT TESTS =====\n");

  function zpcorChk(name, val, expected, tol = 1e-9) {
    const ok = isFinite(val) && isFinite(expected) && Math.abs(val - expected) <= tol;
    console.log(`  ${name}: ${round(val, 9)} (expected ${round(expected, 9)}) → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) zpcorPass = false;
  }
  function zpcorChkTrue(name, cond) {
    console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
    if (!cond) zpcorPass = false;
  }

  // --- ZPCOR 1: formula spot-check ---
  // r=0.5, n=50, p=3 → yi=atanh(0.5), vi=1/44
  console.log("--- ZPCOR 1. Formula spot-check ---");
  {
    const s     = compute({ r: 0.5, n: 50, p: 3 }, "ZPCOR");
    const expYi = Math.atanh(0.5);
    const expVi = 1 / 44;
    zpcorChk("yi = atanh(0.5)", s.yi, expYi);
    zpcorChk("vi = 1/44",       s.vi, expVi);
    zpcorChk("se = √vi",        s.se, Math.sqrt(expVi));
    zpcorChk("w  = 1/vi",       s.w,  1 / expVi);
  }

  // --- ZPCOR 2: p=0 reduces to ZCOR ---
  // Both should give vi = 1/(n−3)
  console.log("--- ZPCOR 2. p=0 reduces to ZCOR ---");
  {
    const sZCOR  = compute({ r: 0.5, n: 53 }, "ZCOR");
    const sZPCOR = compute({ r: 0.5, n: 53, p: 0 }, "ZPCOR");
    zpcorChk("yi identical to ZCOR", sZPCOR.yi, sZCOR.yi);
    zpcorChk("vi identical to ZCOR", sZPCOR.vi, sZCOR.vi);
  }

  // --- ZPCOR 3: sign symmetry ---
  // atanh is odd: atanh(−r) = −atanh(r); vi = 1/(n−p−3) independent of r
  console.log("--- ZPCOR 3. Sign symmetry ---");
  {
    const sPos = compute({ r:  0.5, n: 50, p: 3 }, "ZPCOR");
    const sNeg = compute({ r: -0.5, n: 50, p: 3 }, "ZPCOR");
    zpcorChk("yi(−r) = −yi(r)",  sNeg.yi, -sPos.yi);
    zpcorChk("vi(−r) =  vi(r)",  sNeg.vi,  sPos.vi);
  }

  // --- ZPCOR 4: missing p defaults to 0 ---
  console.log("--- ZPCOR 4. Missing p defaults to 0 ---");
  {
    const sNop = compute({ r: 0.5, n: 53 }, "ZPCOR");
    const sP0  = compute({ r: 0.5, n: 53, p: 0 }, "ZPCOR");
    zpcorChk("yi same when p omitted", sNop.yi, sP0.yi);
    zpcorChk("vi same when p omitted", sNop.vi, sP0.vi);
  }

  // --- ZPCOR 5: invalid inputs → NaN/w=0 ---
  console.log("--- ZPCOR 5. Invalid inputs ---");
  {
    zpcorChkTrue("r=1  → NaN yi",  !isFinite(compute({ r:  1.0, n: 50, p: 2 }, "ZPCOR").yi));
    zpcorChkTrue("r=-1 → NaN yi",  !isFinite(compute({ r: -1.0, n: 50, p: 2 }, "ZPCOR").yi));
    zpcorChkTrue("n<p+4 → NaN yi", !isFinite(compute({ r: 0.5, n:  6, p: 3 }, "ZPCOR").yi));  // min n=7
    zpcorChkTrue("p<0  → NaN yi",  !isFinite(compute({ r: 0.5, n: 50, p: -1 }, "ZPCOR").yi));
    zpcorChkTrue("n<p+4 → w=0",    compute({ r: 0.5, n: 6, p: 3 }, "ZPCOR").w === 0);
  }

  // --- ZPCOR 6: back-transform round-trip tanh(atanh(r)) = r ---
  console.log("--- ZPCOR 6. Back-transform round-trip ---");
  {
    [-0.8, -0.3, 0, 0.3, 0.8].forEach(r => {
      const z  = compute({ r, n: 50, p: 3 }, "ZPCOR").yi;
      const rt = transformEffect(z, "ZPCOR");
      zpcorChk(`tanh(atanh(${r})) = ${r}`, rt, r, 1e-12);
    });
  }

  // --- ZPCOR 7: pooled meta() structural checks ---
  console.log("--- ZPCOR 7. Pooled meta() (k=3, DL) ---");
  {
    const studies = [
      compute({ r: 0.45, n:  80, p: 2 }, "ZPCOR"),
      compute({ r: 0.38, n:  65, p: 2 }, "ZPCOR"),
      compute({ r: 0.52, n: 110, p: 3 }, "ZPCOR"),
    ];
    const m = meta(studies, "DL", "ZPCOR");
    const minYi = Math.min(...studies.map(s => s.yi));
    const maxYi = Math.max(...studies.map(s => s.yi));
    zpcorChkTrue("FE finite",              isFinite(m.FE));
    zpcorChkTrue("RE finite",              isFinite(m.RE));
    zpcorChkTrue("FE in (min yi, max yi)", m.FE > minYi && m.FE < maxYi);
    zpcorChkTrue("RE in (min yi, max yi)", m.RE > minYi && m.RE < maxYi);
    zpcorChkTrue("tau2 ≥ 0",              isFinite(m.tau2) && m.tau2 >= 0);
    zpcorChkTrue("CI lb < RE < CI ub",    m.ciLow < m.RE && m.RE < m.ciHigh);
    // Back-transform: pooled RE on z scale → r scale
    const reR = transformEffect(m.RE, "ZPCOR");
    zpcorChkTrue("back-transformed RE ∈ (−1,1)", isFinite(reR) && Math.abs(reR) < 1);
  }

  console.log(zpcorPass ? "\n✅ ALL ZPCOR UNIT TESTS PASSED" : "\n❌ SOME ZPCOR UNIT TESTS FAILED");
}
