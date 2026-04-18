import { round, transformEffect, chiSquareCDF, chiSquareQuantile, parseCounts, bivariateNormalCDF, normalQuantile, tCritical, fCDF, normalCDF, tCDF } from "./utils.js";
import { validateStudy } from "./profiles.js";
import { BENCHMARKS, PUB_BIAS_BENCHMARKS, INFLUENCE_BENCHMARKS, META_REGRESSION_BENCHMARKS, VH_BENCHMARKS, MH_BENCHMARKS, CLUSTER_BENCHMARKS, RVE_BENCHMARKS, THREE_LEVEL_BENCHMARKS, LS_BENCHMARKS } from "./benchmarks.js";
import { compute, meta, metaMH, metaPeto, robustMeta, sandwichVar, robustWlsResult, metaRegression, tau2_HS, tau2_HE, tau2_ML, tau2_SJ, beggTest, eggerTest, fatPetTest, petPeeseTest, failSafeN, tesTest, heterogeneityCIs, cumulativeMeta, influenceDiagnostics, harbordTest, petersTest, deeksTest, rueckerTest, leaveOneOut, baujat, blupMeta, pCurve, pUniform, estimatorComparison, subgroupAnalysis, logLik, bfgs, selIntervalProbs, selIntervalIdx, selectionLogLik, SEL_CUTS_ONE_SIDED, SEL_CUTS_TWO_SIDED, veveaHedges, SELECTION_PRESETS, profileLikTau2, profileLikCI, bayesMeta, rvePooled, meta3level, lsModel } from "./analysis.js";
import { trimFill } from "./trimfill.js";
import { parseCSV } from "./csv.js";
import { goshCompute, GOSH_MAX_ENUM_K, GOSH_MAX_K, GOSH_DEFAULT_MAX_SUBSETS } from "./gosh.js";

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

// Factory that returns a bundle of check helpers all sharing the same pass variable.
// Each test section calls makeChk(() => { sectionPass = false; }, defaultTol) and
// destructures only the helpers it needs, renaming them to match existing call sites.
function makeChk(onFail, defaultTol = 0.001) {
  return {
    // Numeric check — absolute tolerance. |val−expected| < tol and val must be finite.
    chk(name, val, expected, tol = defaultTol) {
      const ok = isFinite(val) && Math.abs(val - expected) <= tol;
      console.log(`  ${name}: ${round(val, 5)} (expected ${round(expected, 5)}) → ${ok ? "PASS" : "FAIL"}`);
      if (!ok) onFail();
    },
    // Numeric check — relative tolerance. Always pass tol explicitly.
    chkRel(name, val, expected, tol) {
      const scale = Math.max(Math.abs(expected), 0.001);
      const ok = isFinite(val) && Math.abs(val - expected) / scale < tol;
      console.log(`  ${name}: ${round(val, 5)} (expected ${round(expected, 5)}) → ${ok ? "PASS" : "FAIL"}`);
      if (!ok) onFail();
    },
    // Expects NaN or Infinity.
    chkNaN(name, val) {
      const ok = !isFinite(val);
      console.log(`  ${name}: ${val} → ${ok ? "PASS (NaN/Inf as expected)" : "FAIL (expected NaN)"}`);
      if (!ok) onFail();
    },
    // Boolean / condition check.
    chkTrue(name, cond) {
      console.log(`  ${name}: ${cond ? "PASS" : "FAIL"}`);
      if (!cond) onFail();
    },
    // Numeric check using benchmark approxEqual tolerances (FE/RE/yi/tau2/I2 fields).
    chkField(name, val, expected, field) {
      const ok = approxEqual(val, expected, field);
      console.log(`  ${name}: ${round(val, 4)} vs ${round(expected, 4)} → ${ok ? "PASS" : "FAIL"}`);
      if (!ok) onFail();
    },
    // Strict-equality check — for counts, booleans, strings.
    chkExact(name, got, expected) {
      const ok = (got === expected);
      console.log(`  ${name}: ${got} (expected ${expected}) → ${ok ? "PASS" : "FAIL"}`);
      if (!ok) onFail();
    },
  };
}

export function runTests() {
  console.log("===== RUNNING BENCHMARK TESTS =====\n");

  let allPass = true;
  const { chkField: check } = makeChk(() => { allPass = false; });

  BENCHMARKS.forEach(test => {
    const tauMethod = test.tauMethod || "REML";
    const ciMethod  = test.ciMethod  || "normal";

    // Build studies array: use pre-computed yi/vi or derive via compute()
    const studies = test.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi) };
      const s = compute(d, test.type, { hedgesCorrection: test.correction === "hedges" });
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });

    const m = meta(studies, tauMethod, ciMethod);

    console.log(`--- ${test.name} (${test.type}, ${tauMethod}, CI=${ciMethod}) ---`);
    check("FE",   m.FE,   test.expected.FE,   "FE");
    check("RE",   m.RE,   test.expected.RE,   "RE");
    check("tau2", m.tau2, test.expected.tau2, "tau2");
    check("I2",   m.I2,   test.expected.I2,   "I2");

    if (test.expected.ciLow  !== undefined) check("ciLow",  m.ciLow,  test.expected.ciLow,  "FE");
    if (test.expected.ciHigh !== undefined) check("ciHigh", m.ciHigh, test.expected.ciHigh, "FE");

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
  const { chk } = makeChk(() => { regPass = false; });

  // 1. Intercept-only: beta[0] and tau2 must match meta() RE and tau2.
  //    QE uses FE weights (1/vi) with FE-fitted β — equals meta() Q statistic.
  {
    const s = [{ yi: 0, vi: 1 }, { yi: 1, vi: 1 }, { yi: 3, vi: 1 }];
    const m = meta(s, "DL");
    const r = metaRegression(s, [], "DL");
    console.log("--- Intercept-only (k=3, DL) vs meta() ---");
    chk("beta[0] = RE",   r.beta[0], m.RE);
    chk("tau2",           r.tau2,    m.tau2);
    chk("QE (FE-weighted) = meta Q", r.QE, m.Q);   // intercept-only: QE_FE = Q_FE
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
  const { chkField: ichk } = makeChk(() => { intPass = false; });

  // Methods supported by tau2_metaReg (analysis.js). Moment-only estimators
  // (DLIT, HSk, SQGENQ, EBLUP) and pooling-only methods (MH, Peto) have no
  // regression variant — skip them here to avoid false failures from fallback.
  const META_REG_METHODS = new Set(["DL","REML","PM","ML","HS","HE","SJ"]);

  BENCHMARKS.forEach(test => {
    const tauMethod = test.tauMethod || "REML";
    if (!META_REG_METHODS.has(tauMethod)) return;

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
  const { chkField: rbchk } = makeChk(() => { regBenchPass = false; });

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
  const { chk: cchk, chkNaN: cchkNaN } = makeChk(() => { corPass = false; }, 1e-6);

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
  const { chk: pchk, chkNaN: pchkNaN } = makeChk(() => { propPass = false; }, 1e-4);

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
  const { chkRel: tchk, chkTrue: tchkTrue } = makeChk(() => { tauPass = false; });

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

  // ===== META() EDGE CASE UNIT TESTS =====
  // Covers degenerate inputs that are not exercised by the benchmark suite:
  //   k=1  — single study; CI/p-value degrade to NaN without crash
  //   vi=0 — zero-variance study; MIN_VAR floor prevents division by zero
  console.log("\n===== META() EDGE CASE UNIT TESTS =====\n");
  let edgePass = true;
  const { chk: echk, chkNaN: echkNaN, chkTrue: echkTrue } = makeChk(() => { edgePass = false; }, 1e-6);

  // k=1: single study — point estimates defined, inference stats NaN
  console.log("--- k=1: single study ---");
  {
    const s1 = [{ yi: 0.5, vi: 0.04, se: 0.2 }];
    const m1 = meta(s1, "DL");
    echk("FE = yi",     m1.FE,   0.5);
    echk("RE = yi",     m1.RE,   0.5);
    echk("tau2 = 0",    m1.tau2, 0);
    echk("I2 = 0",      m1.I2,   0);
    echkNaN("pval NaN",    m1.pval);
    echkNaN("predLow NaN", m1.predLow);
    echkTrue("ciLow finite",  isFinite(m1.ciLow));
    echkTrue("ciHigh finite", isFinite(m1.ciHigh));
    // heterogeneityCIs early-return path
    echk("tauCI[0] = 0",  m1.tauCI[0], 0);
    echkTrue("tauCI[1] NaN", !isFinite(m1.tauCI[1]));
  }

  // k=2: two studies — estimates and pval finite; prediction interval NaN (requires k≥3)
  console.log("--- k=2: two-study meta-analysis ---");
  {
    // yi=[0.5,1.0], vi=[0.04,0.09]: DL τ²=0.06, FE≈0.654, RE≈0.700
    const s2 = [{ yi: 0.5, vi: 0.04 }, { yi: 1.0, vi: 0.09 }];
    const m2 = meta(s2, "DL");
    echkTrue("k=2 FE finite",    isFinite(m2.FE));
    echkTrue("k=2 RE finite",    isFinite(m2.RE));
    echkTrue("k=2 tau2 >= 0",    m2.tau2 >= 0);
    echkTrue("k=2 I2 >= 0",      m2.I2   >= 0);
    echkTrue("k=2 pval finite",  isFinite(m2.pval));
    echkTrue("k=2 ciLow finite", isFinite(m2.ciLow));
    echk("k=2 FE ≈ 0.6538",     m2.FE,   0.6538, 1e-3);
    echk("k=2 DL tau2 ≈ 0.060", m2.tau2, 0.060,  1e-3);
    echkNaN("k=2 predLow NaN",   m2.predLow);   // predCrit = NaN for k < 3
    echkNaN("k=2 predHigh NaN",  m2.predHigh);
    // Homogeneous pair: Q=0 → tau2=0
    const s2h = [{ yi: 0.5, vi: 0.04 }, { yi: 0.5, vi: 0.04 }];
    const m2h = meta(s2h, "DL");
    echk("k=2 hom tau2 = 0",    m2h.tau2, 0);
    echk("k=2 hom Q = 0",       m2h.Q,    0);
    echkTrue("k=2 hom pval finite", isFinite(m2h.pval));
  }

  // vi=0: validateStudy() must reject it; compute() must return NaN; meta() must not crash
  console.log("--- vi=0: validateStudy guard ---");
  {
    // validateStudy rejects GENERIC study with vi=0
    const badGeneric  = { yi: 1.0, vi: 0 };
    const goodGeneric = { yi: 1.0, vi: 0.1 };
    echkTrue("GENERIC vi=0 invalid",   !validateStudy(badGeneric,  "GENERIC").valid);
    echkTrue("GENERIC vi=0.1 valid",    validateStudy(goodGeneric, "GENERIC").valid);

    // compute() returns NaN for a GENERIC study with vi=0
    const c0 = compute(badGeneric, "GENERIC");
    echkTrue("compute GENERIC vi=0 → yi NaN", !isFinite(c0.yi));
    echkTrue("compute GENERIC vi=0 → vi NaN", !isFinite(c0.vi));
    echkTrue("compute GENERIC vi=0 → w = 0",  c0.w === 0);

    // meta() with vi=0 study in raw array: MIN_VAR floor prevents crash
    const s0 = [
      { yi: 0.3, vi: 0,    se: 0 },
      { yi: 0.5, vi: 0.04, se: 0.2 },
      { yi: 0.7, vi: 0.09, se: 0.3 }
    ];
    const m0 = meta(s0, "DL");
    echkTrue("meta vi=0 FE finite",   isFinite(m0.FE));
    echkTrue("meta vi=0 RE finite",   isFinite(m0.RE));
    echkTrue("meta vi=0 tau2 >= 0",   m0.tau2 >= 0);
    echkTrue("meta vi=0 pval finite", isFinite(m0.pval));
  }

  console.log(edgePass ? "\n✅ ALL META() EDGE CASE TESTS PASSED" : "\n❌ SOME META() EDGE CASE TESTS FAILED");

  // ===== PUBLICATION BIAS UNIT TESTS =====
  console.log("\n===== PUBLICATION BIAS UNIT TESTS =====\n");
  let biasPass = true;
  const { chk: bchk, chkNaN: bchkNaN, chkTrue: bchkTrue } = makeChk(() => { biasPass = false; }, 1e-4);

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

  // Structural: k=4 studies with distinct √V predictors → df=2, finite results, p ∈ (0,1)
  // √V values: 1.500 (N=50), 2.412 (N=100), 2.792 (N=150), 1.805 (N=100) — all distinct.
  console.log("--- Harbord: structural (k=4) ---");
  {
    const s = [
      { a:10, b:5,  c:5,  d:30 },
      { a:30, b:10, c:10, d:50 },
      { a:40, b:10, c:15, d:85 },
      { a:8,  b:20, c:12, d:60 },
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

  // Structural: k=4 studies with spread ESS values → df=2.
  // ESS: 11.7 (N=30), 37.3 (N=75), 99.0 (N=200), 149.3 (N=300).
  // R-verified via generate.R block DEEKS-1 (see PUB_BIAS_BENCHMARKS entry).
  console.log("--- Deeks: structural (k=4) ---");
  {
    const s = [
      { a:5,  b:15, c:3,   d:7   },
      { a:20, b:10, c:15,  d:30  },
      { a:50, b:30, c:40,  d:80  },
      { a:80, b:20, c:60,  d:140 },
    ];
    const d = deeksTest(s);
    bchkTrue("df = 2",               d.df === 2);
    bchk("intercept = 2.8191",       d.intercept,  2.8191,  0.0001);
    bchk("interceptP = 0.0565",      d.interceptP, 0.0565,  0.0001);
    bchk("slope = -10.6242",         d.slope,      -10.6242, 0.0001);
    bchk("slopeP = 0.2206",          d.slopeP,     0.2206,  0.0001);
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

  // Structural: k=4 studies with spread 1/se predictors → df=2.
  // 1/se values: 3.65 (n=5+10), 7.39 (n=25+30), 12.0 (n=60+90), 16.33 (n=100+200).
  // R-verified via generate.R block RUECKER-1 (see PUB_BIAS_BENCHMARKS entry).
  console.log("--- Rücker: structural (k=4) ---");
  {
    const s = [
      { a:2,  b:3,  c:4,   d:6   },
      { a:15, b:10, c:10,  d:20  },
      { a:40, b:20, c:30,  d:60  },
      { a:80, b:20, c:60,  d:140 },
    ];
    const r = rueckerTest(s);
    bchkTrue("df = 2",               r.df === 2);
    bchk("intercept = -2.7853",      r.intercept,  -2.7853, 0.0001);
    bchk("interceptP = 0.1156",      r.interceptP,  0.1156, 0.0001);
    bchk("slope = 0.6562",           r.slope,        0.6562, 0.0001);
    bchk("slopeP = 0.0203",          r.slopeP,       0.0203, 0.0001);
  }

  // ---- BCG OR k=13: cross-validation against PUB_BIAS_BENCHMARKS ----
  // harbordTest / petersTest / deeksTest / rueckerTest on the full BCG OR dataset.
  // Expected values cross-validated against metafor 4.8-0 (see benchmark-data.md).
  console.log("--- BCG OR k=13: Harbord / Peters / Deeks / Rücker ---");
  {
    const bm = PUB_BIAS_BENCHMARKS.find(b => b.name && b.name.includes("BCG") && b.name.includes("OR"));
    if (!bm) {
      console.warn("  SKIP: BCG OR benchmark not found");
    } else {
      const studies = bm.data.map(s => ({
        ...s,
        yi: Math.log((s.a * s.d) / (s.b * s.c)),
        vi: 1/s.a + 1/s.b + 1/s.c + 1/s.d,
      }));
      studies.forEach(s => { s.se = Math.sqrt(s.vi); });

      const h = harbordTest(studies);
      bchkTrue("Harbord BCG OR: df=11",            h.df === 11);
      bchkTrue("Harbord BCG OR: intercept finite",  isFinite(h.intercept));
      bchkTrue("Harbord BCG OR: p ∈ (0,1)",         isFinite(h.interceptP) && h.interceptP > 0 && h.interceptP < 1);

      // Peters needs yi/vi/se on each study — already added above
      const p = petersTest(studies);
      bchkTrue("Peters BCG OR: df=11",             p.df === 11);
      bchkTrue("Peters BCG OR: intercept finite",   isFinite(p.intercept));
      bchkTrue("Peters BCG OR: p ∈ (0,1)",          isFinite(p.interceptP) && p.interceptP > 0 && p.interceptP < 1);

      // Deeks: BCG OR has all cells > 0 → valid for all 13 studies
      const d = deeksTest(studies);
      bchkTrue("Deeks BCG OR: df=11",              d.df === 11);
      bchkTrue("Deeks BCG OR: intercept finite",    isFinite(d.intercept));
      bchkTrue("Deeks BCG OR: p ∈ (0,1)",           isFinite(d.interceptP) && d.interceptP > 0 && d.interceptP < 1);

      const r = rueckerTest(studies);
      bchkTrue("Rücker BCG OR: df=11",             r.df === 11);
      bchkTrue("Rücker BCG OR: intercept finite",   isFinite(r.intercept));
      bchkTrue("Rücker BCG OR: p ∈ (0,1)",          isFinite(r.interceptP) && r.interceptP > 0 && r.interceptP < 1);

      // NA behaviour: yi-only studies (no cell counts) → all NaN for Harbord/Deeks/Rücker
      const yiOnly = studies.map(({ yi, vi, se }) => ({ yi, vi, se }));
      bchkNaN("Harbord: yi-only → NaN",  harbordTest(yiOnly).intercept);
      bchkNaN("Deeks:   yi-only → NaN",  deeksTest(yiOnly).intercept);
      bchkNaN("Rücker:  yi-only → NaN",  rueckerTest(yiOnly).intercept);
      // Peters uses yi/vi/n — yi-only (no n) → NaN
      bchkNaN("Peters:  no N field → NaN", petersTest(yiOnly).intercept);
    }
  }

  console.log(biasPass ? "\n✅ ALL PUBLICATION BIAS TESTS PASSED" : "\n❌ SOME PUBLICATION BIAS TESTS FAILED");

  // ===== HETEROGENEITY CI UNIT TESTS =====
  // Tests chiSquareQuantile (inverse CDF) and heterogeneityCIs (Q-profile).
  // The df=2 chi-square CDF has closed form F(x) = 1 − exp(−x/2), which
  // allows exact analytic expected values without look-up tables.
  console.log("\n===== HETEROGENEITY CI UNIT TESTS =====\n");
  let hetPass = true;
  const { chk: hchk, chkNaN: hchkNaN, chkTrue: hchkTrue } = makeChk(() => { hetPass = false; }, 1e-3);

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
  const { chk: cumchk, chkTrue: cumchkTrue } = makeChk(() => { cumPass = false; }, 1e-4);

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
  const { chk: hrchk, chkTrue: hrchkTrue } = makeChk(() => { hrPass = false; }, 1e-4);

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
  const { chk: infchk, chkTrue: infchkTrue } = makeChk(() => { infPass = false; }, 1e-4);

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

  // ===== FAST-PATH REGRESSION TESTS (Steps 2–4 + PM/SJ warm-start) =====
  // Verify influenceDiagnostics() fast path matches meta(loo) directly, to
  // within 1e-8, across five datasets.
  // Covers moment estimators (DL, GENQ, HS, HSk, HE, SQGENQ, DLIT),
  // likelihood estimators (REML, ML, EBLUP) via warm-start Newton (Step 4),
  // and iterative estimators PM/SJ via warm-start fixed-point iteration.
  {
    let fastPass = true;
    const { chk: fchk }  = makeChk(() => { fastPass = false; }, 1e-8);
    const { chk: fchkD } = makeChk(() => { fastPass = false; }, 1e-8);
    console.log("\n===== FAST-PATH REGRESSION TESTS (Steps 2-4) =====\n");

    const bcg = [
      { yi: -0.8893113339202054, vi: 0.3255847650039614   },
      { yi: -1.5853886572014306, vi: 0.19458112139814387  },
      { yi: -1.348073148299693,  vi: 0.41536796536796533  },
      { yi: -1.4415511900213054, vi: 0.020010031902247573 },
      { yi: -0.2175473222112957, vi: 0.05121017216963086  },
      { yi: -0.786115585818864,  vi: 0.0069056184559087574},
      { yi: -1.6208982235983924, vi: 0.22301724757231517  },
      { yi:  0.011952333523841173,vi: 0.00396157929781773 },
      { yi: -0.4694176487381487, vi: 0.056434210463248966 },
      { yi: -1.3713448034727846, vi: 0.07302479361302891  },
      { yi: -0.33935882833839015,vi: 0.01241221397155972  },
      { yi:  0.4459134005713783, vi: 0.5325058452001528   },
      { yi: -0.017313948216879493,vi: 0.0714046596839863  },
    ];

    // Helper: run one method × dataset × ciMethod combination.
    // chkFn is fchk or fchkD (different tolerance).
    function checkMethod(methodName, ss, ciM, chkFn = fchk) {
      const full = meta(ss, methodName, ciM);
      const diag = influenceDiagnostics(ss, methodName, ciM);
      diag.forEach((d, i) => {
        const loo = ss.filter((_, j) => j !== i);
        const ref = meta(loo, methodName, ciM);
        chkFn(`[${i}] tau2_loo`, d.tau2_loo, ref.tau2);
        chkFn(`[${i}] RE_loo`,   d.RE_loo,   ref.RE);
        const dfbetaRef = (full.RE - ref.RE) / ref.seRE;
        if (!isFinite(d.DFBETA) && !isFinite(dfbetaRef) && (isNaN(d.DFBETA) === isNaN(dfbetaRef))) {
          console.log(`  [${i}] DFBETA: ${d.DFBETA}=${dfbetaRef} → PASS (non-finite match)`);
        } else {
          chkFn(`[${i}] DFBETA`, d.DFBETA, dfbetaRef);
        }
      });
    }

    const datasets = [
      { name: "A (heterogeneous)", studies: sA },
      { name: "B (homogeneous)",   studies: sB },
      { name: "C (one outlier)",   studies: sC },
      { name: "D (5-study)",       studies: sD },
      { name: "BCG (13-study)",    studies: bcg },
    ];

    // DL + GENQ (identical) + HS + HSk: three ciMethods
    for (const m of ["DL", "GENQ", "HS", "HSk"]) {
      for (const { name, studies: ss } of datasets) {
        for (const ciM of ["normal", "t", "KH"]) {
          console.log(`--- ${m} / ${name} / "${ciM}" ---`);
          checkMethod(m, ss, ciM);
        }
      }
    }

    // HE: normal only (KH degenerate on homogeneous data, same NaN handling)
    for (const { name, studies: ss } of datasets) {
      console.log(`--- HE / ${name} / "normal" ---`);
      checkMethod("HE", ss, "normal");
    }

    // SQGENQ: normal only
    for (const { name, studies: ss } of datasets) {
      console.log(`--- SQGENQ / ${name} / "normal" ---`);
      checkMethod("SQGENQ", ss, "normal");
    }

    // DLIT: normal only (iterative; tolerance same as DL since seeded from DL)
    for (const { name, studies: ss } of datasets) {
      console.log(`--- DLIT / ${name} / "normal" ---`);
      checkMethod("DLIT", ss, "normal", fchkD);
    }

    // REML / ML / EBLUP: normal + KH (Step 4: warm-start Newton, exact to REML_TOL)
    for (const m of ["REML", "ML", "EBLUP"]) {
      for (const { name, studies: ss } of datasets) {
        for (const ciM of ["normal", "KH"]) {
          console.log(`--- ${m} / ${name} / "${ciM}" ---`);
          checkMethod(m, ss, ciM);
        }
      }
    }

    // PM / SJ: now on the fast path (warm-start fixed-point iteration).
    for (const m of ["PM", "SJ"]) {
      for (const { name, studies: ss } of datasets) {
        for (const ciM of ["normal", "KH"]) {
          console.log(`--- ${m} / ${name} / "${ciM}" ---`);
          checkMethod(m, ss, ciM);
        }
      }
    }

    console.log(fastPass
      ? "\n✅ ALL MOMENT-ESTIMATOR FAST-PATH REGRESSION TESTS PASSED"
      : "\n❌ SOME MOMENT-ESTIMATOR FAST-PATH REGRESSION TESTS FAILED");
  }

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
  const { chk: romchk, chkTrue: romchkTrue } = makeChk(() => { romPass = false; }, 1e-6);

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
  const { chk: smdhchk, chkTrue: smdhchkTrue } = makeChk(() => { smdhPass = false; }, 1e-5);

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
  const { chk: cvrchk, chkTrue: cvrchkTrue } = makeChk(() => { cvrPass = false; }, 1e-4);

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
  const { chk: vrchk, chkTrue: vrchkTrue } = makeChk(() => { vrPass = false; }, 1e-4);

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
  const { chk: gorchk, chkTrue: gorchkTrue } = makeChk(() => { gorPass = false; }, 1e-5);

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
  const { chk: mnchk, chkTrue: mnchkTrue } = makeChk(() => { mnPass = false; }, 1e-6);

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
  const { chk: smccChk, chkTrue: smccChkTrue } = makeChk(() => { smccPass = false; }, 1e-6);

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
  const { chk: phiChk, chkTrue: phiChkTrue } = makeChk(() => { phiPass = false; }, 1e-9);

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
  const { chk: rtetChk, chkTrue: rtetChkTrue } = makeChk(() => { rtetPass = false; }, 1e-5);

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
  //   8. Additional r spot-checks (r=0.3 and r=0.7, exact vi)
  //   9. vi is even in r: vi(+r) = vi(−r) exactly
  //  10. Monotonicity in n: larger n → smaller vi (fixed r, p)
  //  11. Monotonicity in p: larger p → larger vi (fixed r, n)
  //  12. Boundary n = p+3 (minimum valid; n=p+2 → NaN)
  // ================================================================
  let pcorPass = true;
  console.log("\n===== PCOR UNIT TESTS =====\n");
  const { chk: pcorChk, chkTrue: pcorChkTrue } = makeChk(() => { pcorPass = false; }, 1e-9);

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

  // --- PCOR 8: additional r spot-checks ---
  // vi = (1−r²)² / (n−p−1). Vary r; n=50, p=2 → denominator=47.
  //   r=0.3: vi = (1−0.09)²/47 = 0.8281/47  (exact)
  //   r=0.7: vi = (1−0.49)²/47 = 0.2601/47  (exact)
  console.log("--- PCOR 8. Additional r spot-checks ---");
  {
    const s3 = compute({ r: 0.3, n: 50, p: 2 }, "PCOR");
    pcorChk("r=0.3: yi = 0.3",           s3.yi, 0.3);
    pcorChk("r=0.3: vi = 0.8281/47",     s3.vi, 0.8281 / 47);
    const s7 = compute({ r: 0.7, n: 50, p: 2 }, "PCOR");
    pcorChk("r=0.7: yi = 0.7",           s7.yi, 0.7);
    pcorChk("r=0.7: vi = 0.2601/47",     s7.vi, 0.2601 / 47);
  }

  // --- PCOR 9: vi is even in r ---
  // vi = (1−r²)²/(n−p−1) — (1−r²)² is identical for +r and −r.
  // This is distinct from sign symmetry (test 3): here we check exact equality
  // of vi values, not just that they are equal to each other.
  console.log("--- PCOR 9. vi is even in r ---");
  {
    for (const r of [0.3, 0.5, 0.7]) {
      const sp = compute({ r:  r, n: 60, p: 3 }, "PCOR");
      const sn = compute({ r: -r, n: 60, p: 3 }, "PCOR");
      const expVi = (1 - r*r)**2 / (60 - 3 - 1);
      pcorChk(`vi(r= ${r}) = (1−${r}²)²/56`, sp.vi, expVi);
      pcorChk(`vi(r=−${r}) = (1−${r}²)²/56`, sn.vi, expVi);
    }
  }

  // --- PCOR 10: monotonicity in n ---
  // Larger n → smaller vi (more data, smaller sampling variance).
  // vi = (1−r²)² / (n−p−1); fixed r=0.4, p=2.
  console.log("--- PCOR 10. Monotonicity in n ---");
  {
    const r = 0.4, p = 2, f = (1 - r*r)**2;
    const pairs = [[30, f/27], [50, f/47], [100, f/97], [200, f/197]];
    for (const [n, expVi] of pairs)
      pcorChk(`n=${n}: vi = (0.84)²/${n-p-1}`, compute({ r, n, p }, "PCOR").vi, expVi);
    // Structural: strictly decreasing
    const viArr = pairs.map(([n]) => compute({ r, n, p }, "PCOR").vi);
    pcorChkTrue("vi strictly decreasing as n grows",
      viArr.every((v, i) => i === 0 || viArr[i-1] > v));
  }

  // --- PCOR 11: monotonicity in p ---
  // Larger p → larger vi (each covariate consumes one df from the denominator).
  // vi = (1−r²)² / (n−p−1); fixed r=0.4, n=100.
  console.log("--- PCOR 11. Monotonicity in p ---");
  {
    const r = 0.4, n = 100, f = (1 - r*r)**2;
    const pairs = [[0, f/99], [2, f/97], [5, f/94], [10, f/89]];
    for (const [p, expVi] of pairs)
      pcorChk(`p=${p}: vi = (0.84)²/${n-p-1}`, compute({ r, n, p }, "PCOR").vi, expVi);
    // Structural: strictly increasing
    const viArr = pairs.map(([p]) => compute({ r, n, p }, "PCOR").vi);
    pcorChkTrue("vi strictly increasing as p grows",
      viArr.every((v, i) => i === 0 || viArr[i-1] < v));
  }

  // --- PCOR 12: boundary n = p+3 (minimum valid) ---
  // validate() requires n ≥ p+3.  At the boundary (n=p+3) the denominator
  // n−p−1 = 2, so vi = (1−r²)²/2.  One below (n=p+2) fails validation → NaN.
  console.log("--- PCOR 12. Boundary n = p+3 ---");
  {
    // r=0.4, p=3: minN=6; boundary vi = (1−0.16)²/2 = 0.7056/2 = 0.3528 (exact)
    const sBound = compute({ r: 0.4, n: 6, p: 3 }, "PCOR");
    pcorChk("n=p+3=6: yi = 0.4",          sBound.yi, 0.4);
    pcorChk("n=p+3=6: vi = 0.7056/2",     sBound.vi, 0.7056 / 2);
    pcorChkTrue("n=p+2=5 → NaN yi (below minN)",
      !isFinite(compute({ r: 0.4, n: 5, p: 3 }, "PCOR").yi));
    pcorChkTrue("n=p+2=5 → w=0",
      compute({ r: 0.4, n: 5, p: 3 }, "PCOR").w === 0);
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
  //   8. Additional yi spot-checks (r=0.3 and r=0.7, exact atanh values)
  //   9. vi is independent of r (key difference from PCOR)
  //  10. Monotonicity in n: larger n → smaller vi (fixed r, p)
  //  11. Monotonicity in p: larger p → larger vi (fixed r, n)
  //  12. Boundary n = p+4 (minimum valid; n=p+3 → NaN)
  // ================================================================
  let zpcorPass = true;
  console.log("\n===== ZPCOR UNIT TESTS =====\n");
  const { chk: zpcorChk, chkTrue: zpcorChkTrue } = makeChk(() => { zpcorPass = false; }, 1e-9);

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

  // --- ZPCOR 8: additional yi spot-checks ---
  // yi = atanh(r) (exact); vi = 1/(n−p−3) = 1/45 for n=50, p=2 (independent of r).
  //   r=0.3: yi = atanh(0.3) ≈ 0.30952, vi = 1/45  (exact)
  //   r=0.7: yi = atanh(0.7) ≈ 0.86730, vi = 1/45  (exact)
  console.log("--- ZPCOR 8. Additional yi spot-checks ---");
  {
    for (const r of [0.3, 0.7]) {
      const s = compute({ r, n: 50, p: 2 }, "ZPCOR");
      zpcorChk(`r=${r}: yi = atanh(${r})`, s.yi, Math.atanh(r));
      zpcorChk(`r=${r}: vi = 1/45`,        s.vi, 1 / 45);
    }
  }

  // --- ZPCOR 9: vi is independent of r ---
  // vi = 1/(n−p−3) does not involve r at all. This is a key structural
  // difference from PCOR (where vi = (1−r²)²/(n−p−1) does depend on r).
  // Five r values, all give the same vi = 1/45.
  console.log("--- ZPCOR 9. vi is independent of r ---");
  {
    const expVi = 1 / 45;   // n=50, p=2: n−p−3 = 45
    for (const r of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const s = compute({ r, n: 50, p: 2 }, "ZPCOR");
      zpcorChk(`r=${r}: vi = 1/45`, s.vi, expVi);
    }
  }

  // --- ZPCOR 10: monotonicity in n ---
  // Larger n → smaller vi (more data, smaller sampling variance).
  // vi = 1/(n−p−3); fixed r=0.4, p=2 → denominator = n−5.
  console.log("--- ZPCOR 10. Monotonicity in n ---");
  {
    const pairs = [[30, 1/25], [50, 1/45], [100, 1/95], [200, 1/195]];
    for (const [n, expVi] of pairs)
      zpcorChk(`n=${n}: vi = 1/${n-5}`, compute({ r: 0.4, n, p: 2 }, "ZPCOR").vi, expVi);
    const viArr = pairs.map(([n]) => compute({ r: 0.4, n, p: 2 }, "ZPCOR").vi);
    zpcorChkTrue("vi strictly decreasing as n grows",
      viArr.every((v, i) => i === 0 || viArr[i-1] > v));
  }

  // --- ZPCOR 11: monotonicity in p ---
  // Larger p → larger vi (each covariate reduces the effective df).
  // vi = 1/(n−p−3); fixed r=0.4, n=100 → denominator = 97−p.
  console.log("--- ZPCOR 11. Monotonicity in p ---");
  {
    const pairs = [[0, 1/97], [2, 1/95], [5, 1/92], [10, 1/87]];
    for (const [p, expVi] of pairs)
      zpcorChk(`p=${p}: vi = 1/${100-p-3}`, compute({ r: 0.4, n: 100, p }, "ZPCOR").vi, expVi);
    const viArr = pairs.map(([p]) => compute({ r: 0.4, n: 100, p }, "ZPCOR").vi);
    zpcorChkTrue("vi strictly increasing as p grows",
      viArr.every((v, i) => i === 0 || viArr[i-1] < v));
  }

  // --- ZPCOR 12: boundary n = p+4 (minimum valid) ---
  // validate() requires n ≥ p+4. At the boundary (n=p+4) the denominator
  // n−p−3 = 1, so vi = 1 exactly. One below (n=p+3) fails validation → NaN.
  console.log("--- ZPCOR 12. Boundary n = p+4 ---");
  {
    // r=0.4, p=3: minN=7; boundary vi = 1/(7−3−3) = 1/1 = 1 (exact)
    const sBound = compute({ r: 0.4, n: 7, p: 3 }, "ZPCOR");
    zpcorChk("n=p+4=7: yi = atanh(0.4)", sBound.yi, Math.atanh(0.4));
    zpcorChk("n=p+4=7: vi = 1 (exact)",  sBound.vi, 1);
    zpcorChkTrue("n=p+3=6 → NaN yi (below minN)",
      !isFinite(compute({ r: 0.4, n: 6, p: 3 }, "ZPCOR").yi));
    zpcorChkTrue("n=p+3=6 → w=0",
      compute({ r: 0.4, n: 6, p: 3 }, "ZPCOR").w === 0);
  }

  console.log(zpcorPass ? "\n✅ ALL ZPCOR UNIT TESTS PASSED" : "\n❌ SOME ZPCOR UNIT TESTS FAILED");

  // ===== PCOR / ZPCOR CONSISTENCY CROSS-CHECKS =====
  // tanh(ZPCOR_RE) ≈ PCOR_RE because both estimate the same underlying
  // partial-r population parameter.  The approximation is not exact because:
  //   (a) PCOR and ZPCOR use different vi formulas, so studies receive
  //       different weights under each model;
  //   (b) Jensen's inequality: E[tanh(Z)] ≠ tanh(E[Z]) when there is
  //       heterogeneity.
  // The gap is largest when tau2 is large (heterogeneous dataset) and
  // smallest when tau2 ≈ 0 (homogeneous dataset).
  //
  // FE is NOT tested here: on the z scale, large-r studies have large vi
  // (1/(n-p-3) with small n), so they get very low FE weight; on the r
  // scale those same studies have smaller vi and relatively more FE weight.
  // The resulting tanh(ZPCOR_FE) vs PCOR_FE gap is ~0.14 — not an
  // approximation failure but a reflection of genuinely different estimators.
  console.log("\n===== PCOR / ZPCOR CONSISTENCY CROSS-CHECKS =====\n");
  let crossPass = true;
  const crossChk = (label, got, expected, tol) => {
    const ok = Math.abs(got - expected) < tol;
    if (!ok) { console.error(`  FAIL ${label}: got ${got.toFixed(6)}, expected ≈${expected.toFixed(6)}, tol=${tol}`); crossPass = false; }
    else console.log(`  ok  ${label} (|diff|=${Math.abs(got-expected).toFixed(4)} < ${tol})`);
  };

  // Shared heterogeneous dataset (same as benchmarks.js Blocks 40–41)
  const crossRaw = [
    { label: "Study 1", r: 0.10, n: 300, p: 2 },
    { label: "Study 2", r: 0.15, n: 250, p: 1 },
    { label: "Study 3", r: 0.70, n:  50, p: 3 },
    { label: "Study 4", r: 0.75, n:  40, p: 2 },
    { label: "Study 5", r: 0.65, n:  45, p: 3 },
  ];
  const crossPCOR  = crossRaw.map(d => compute(d, "PCOR"));
  const crossZPCOR = crossRaw.map(d => compute(d, "ZPCOR"));

  // --- Heterogeneous dataset: REML RE ---
  // tau2_PCOR≈0.097, tau2_ZPCOR≈0.162 — strong heterogeneity.
  // Tolerance 0.05: approximation holds loosely (actual gap ≈ 0.034).
  console.log("--- Heterogeneous dataset (REML) ---");
  {
    const mP = meta(crossPCOR,  "REML");
    const mZ = meta(crossZPCOR, "REML");
    crossChk("tanh(ZPCOR RE) ≈ PCOR RE", Math.tanh(mZ.RE), mP.RE, 0.05);
  }

  // --- Heterogeneous dataset: DL RE ---
  // DL gives slightly different tau2 from REML but same consistency property.
  console.log("--- Heterogeneous dataset (DL) ---");
  {
    const mP = meta(crossPCOR,  "DL");
    const mZ = meta(crossZPCOR, "DL");
    crossChk("tanh(ZPCOR RE) ≈ PCOR RE", Math.tanh(mZ.RE), mP.RE, 0.05);
  }

  // --- Homogeneous dataset: REML RE ---
  // tau2≈0 for both types; Jensen's inequality bias vanishes and weights
  // are nearly identical.  Tight tolerance 0.02 (actual gap ≈ 0.008).
  console.log("--- Homogeneous dataset (DL, tau2=0) ---");
  {
    const homRaw = [
      { label: "Study 1", r: 0.45, n:  80, p: 2 },
      { label: "Study 2", r: 0.38, n:  65, p: 2 },
      { label: "Study 3", r: 0.52, n: 110, p: 3 },
      { label: "Study 4", r: 0.31, n:  90, p: 2 },
      { label: "Study 5", r: 0.47, n: 130, p: 4 },
    ];
    const mP = meta(homRaw.map(d => compute(d, "PCOR")),  "DL");
    const mZ = meta(homRaw.map(d => compute(d, "ZPCOR")), "DL");
    // Both have tau2=0, so RE=FE; check against PCOR RE
    crossChk("tanh(ZPCOR RE) ≈ PCOR RE (tau2=0)", Math.tanh(mZ.RE), mP.RE, 0.02);
  }

  // --- Sign consistency: all r negative → both RE estimates negative ---
  console.log("--- Sign consistency: negative r ---");
  {
    const negRaw = crossRaw.map(d => ({ ...d, r: -d.r }));
    const mP = meta(negRaw.map(d => compute(d, "PCOR")),  "REML");
    const mZ = meta(negRaw.map(d => compute(d, "ZPCOR")), "REML");
    const ok = mP.RE < 0 && mZ.RE < 0 && Math.tanh(mZ.RE) < 0;
    if (!ok) { console.error("  FAIL sign consistency"); crossPass = false; }
    else console.log("  ok  negated r → PCOR RE < 0, ZPCOR RE < 0, tanh(ZPCOR RE) < 0");
    // The gap magnitude should be the same as the positive case
    const mPPos = meta(crossPCOR,  "REML");
    const mZPos = meta(crossZPCOR, "REML");
    crossChk("gap symmetric under sign flip",
      Math.abs(Math.tanh(mZ.RE) - mP.RE),
      Math.abs(Math.tanh(mZPos.RE) - mPPos.RE),
      0.001);
  }

  console.log(crossPass ? "\n✅ ALL CROSS-CHECKS PASSED" : "\n❌ SOME CROSS-CHECKS FAILED");

  // ===== PUBLICATION BIAS BENCHMARKS =====
  // End-to-end tests against externally derived expected values.
  // Each entry has a `tests` object with sub-objects per function.
  // Tolerances: abs 0.001 for most statistics; abs 0.01 for p-values;
  //             integer equality for k0; abs 1 for rosenthal/orwin counts.
  console.log("\n===== PUBLICATION BIAS BENCHMARKS =====\n");
  let pubBiasPass = true;
  const { chk: pbchk, chkTrue: pbchkTrue } = makeChk(() => { pubBiasPass = false; });

  PUB_BIAS_BENCHMARKS.forEach(bm => {
    console.log(`--- ${bm.name} ---`);

    // Build studies array
    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) {
        return { ...d, se: Math.sqrt(d.vi) };
      }
      const s = compute(d, bm.type, { hedgesCorrection: bm.correction === "hedges" });
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });

    const exp = bm.tests;

    if (exp.begg) {
      const b = beggTest(studies);
      if (exp.begg.tau   !== undefined) pbchk("begg.tau",   b.tau,   exp.begg.tau);
      if (exp.begg.S     !== undefined) pbchk("begg.S",     b.S,     exp.begg.S, 0.5);
      if (exp.begg.z     !== undefined) pbchk("begg.z",     b.z,     exp.begg.z);
      if (exp.begg.p     !== undefined) pbchk("begg.p",     b.p,     exp.begg.p, 0.01);
    }

    if (exp.egger) {
      const e = eggerTest(studies);
      if (exp.egger.intercept !== undefined) pbchk("egger.intercept", e.intercept, exp.egger.intercept);
      if (exp.egger.slope     !== undefined) pbchk("egger.slope",     e.slope,     exp.egger.slope);
      if (exp.egger.se        !== undefined) pbchk("egger.se",        e.se,        exp.egger.se);
      if (exp.egger.t         !== undefined) pbchk("egger.t",         e.t,         exp.egger.t);
      if (exp.egger.df        !== undefined) pbchk("egger.df",        e.df,        exp.egger.df, 0);
      if (exp.egger.p         !== undefined) pbchk("egger.p",         e.p,         exp.egger.p, 0.01);
    }

    if (exp.fatPet) {
      const f = fatPetTest(studies);
      if (exp.fatPet.intercept  !== undefined) pbchk("fatPet.intercept",  f.intercept,  exp.fatPet.intercept);
      if (exp.fatPet.slope      !== undefined) pbchk("fatPet.slope",      f.slope,      exp.fatPet.slope);
      if (exp.fatPet.interceptP !== undefined) pbchk("fatPet.interceptP", f.interceptP, exp.fatPet.interceptP, 0.01);
      if (exp.fatPet.slopeP     !== undefined) pbchk("fatPet.slopeP",     f.slopeP,     exp.fatPet.slopeP,     0.01);
    }

    if (exp.petPeese) {
      const pp = petPeeseTest(studies);
      pbchkTrue("petPeese.usePeese", pp.usePeese === exp.petPeese.usePeese);
      if (exp.petPeese.fat) {
        const ef = exp.petPeese.fat;
        if (ef.intercept  !== undefined) pbchk("petPeese.fat.intercept",  pp.fat.intercept,  ef.intercept);
        if (ef.interceptP !== undefined) pbchk("petPeese.fat.interceptP", pp.fat.interceptP, ef.interceptP, 0.01);
        if (ef.slope      !== undefined) pbchk("petPeese.fat.slope",      pp.fat.slope,      ef.slope);
        if (ef.slopeP     !== undefined) pbchk("petPeese.fat.slopeP",     pp.fat.slopeP,     ef.slopeP,     0.01);
      }
      if (exp.petPeese.peese) {
        const ep = exp.petPeese.peese;
        if (ep.intercept  !== undefined) pbchk("petPeese.peese.intercept",  pp.peese.intercept,  ep.intercept);
        if (ep.interceptP !== undefined) pbchk("petPeese.peese.interceptP", pp.peese.interceptP, ep.interceptP, 0.01);
        if (ep.slope      !== undefined) pbchk("petPeese.peese.slope",      pp.peese.slope,      ep.slope);
        if (ep.slopeP     !== undefined) pbchk("petPeese.peese.slopeP",     pp.peese.slopeP,     ep.slopeP,     0.01);
      }
    }

    if (exp.failSafe) {
      const f = failSafeN(studies);
      if (exp.failSafe.rosenthal !== undefined) pbchk("failSafe.rosenthal", f.rosenthal, exp.failSafe.rosenthal, 1);
      if (exp.failSafe.orwin    !== undefined) pbchk("failSafe.orwin",    f.orwin,    exp.failSafe.orwin,    1);
    }

    if (exp.harbord) {
      const h = harbordTest(studies);
      if (exp.harbord.intercept  !== undefined) pbchk("harbord.intercept",  h.intercept,  exp.harbord.intercept);
      if (exp.harbord.interceptP !== undefined) pbchk("harbord.interceptP", h.interceptP, exp.harbord.interceptP, 0.01);
    }

    if (exp.peters) {
      const p = petersTest(studies);
      if (exp.peters.intercept  !== undefined) pbchk("peters.intercept",  p.intercept,  exp.peters.intercept);
      if (exp.peters.interceptP !== undefined) pbchk("peters.interceptP", p.interceptP, exp.peters.interceptP, 0.01);
    }

    if (exp.trimFill) {
      const tauM   = bm.tauMethod || "DL";
      const filled = trimFill(studies, tauM);
      const k0     = filled.length;
      const adjustedRE = meta([...studies, ...filled], tauM).RE;
      if (exp.trimFill.k0         !== undefined) pbchkTrue(`trimFill.k0 = ${exp.trimFill.k0}`, k0 === exp.trimFill.k0);
      if (exp.trimFill.adjustedRE !== undefined) pbchk("trimFill.adjustedRE", adjustedRE, exp.trimFill.adjustedRE, 0.01);
    }

    // Deeks and Rücker operate on raw {a,b,c,d} tables; studies has a/b/c/d
    // from bm.data spread in (compute() adds yi/vi but leaves a/b/c/d intact).
    if (exp.deeks) {
      const dd = deeksTest(studies);
      if (exp.deeks.intercept  !== undefined) pbchk("deeks.intercept",  dd.intercept,  exp.deeks.intercept,  0.001);
      if (exp.deeks.interceptP !== undefined) pbchk("deeks.interceptP", dd.interceptP, exp.deeks.interceptP, 0.001);
      if (exp.deeks.slope      !== undefined) pbchk("deeks.slope",      dd.slope,      exp.deeks.slope,      0.001);
      if (exp.deeks.slopeP     !== undefined) pbchk("deeks.slopeP",     dd.slopeP,     exp.deeks.slopeP,     0.001);
      if (exp.deeks.df         !== undefined) pbchkTrue(`deeks.df = ${exp.deeks.df}`, dd.df === exp.deeks.df);
    }
    if (exp.ruecker) {
      const rr = rueckerTest(studies);
      if (exp.ruecker.intercept  !== undefined) pbchk("ruecker.intercept",  rr.intercept,  exp.ruecker.intercept,  0.001);
      if (exp.ruecker.interceptP !== undefined) pbchk("ruecker.interceptP", rr.interceptP, exp.ruecker.interceptP, 0.001);
      if (exp.ruecker.slope      !== undefined) pbchk("ruecker.slope",      rr.slope,      exp.ruecker.slope,      0.001);
      if (exp.ruecker.slopeP     !== undefined) pbchk("ruecker.slopeP",     rr.slopeP,     exp.ruecker.slopeP,     0.001);
      if (exp.ruecker.df         !== undefined) pbchkTrue(`ruecker.df = ${exp.ruecker.df}`, rr.df === exp.ruecker.df);
    }
    if (exp.tes) {
      const tauM = bm.tauMethod || "DL";
      const m    = meta(studies, tauM);
      const t    = tesTest(studies, m);
      if (exp.tes.O    !== undefined) pbchkTrue(`tes.O = ${exp.tes.O}`, t.O === exp.tes.O);
      if (exp.tes.E    !== undefined) pbchk("tes.E",    t.E,    exp.tes.E,    0.001);
      if (exp.tes.chi2 !== undefined) pbchk("tes.chi2", t.chi2, exp.tes.chi2, 0.001);
      if (exp.tes.p    !== undefined) pbchk("tes.p",    t.p,    exp.tes.p,    0.001);
    }
  });

  console.log(pubBiasPass ? "\n✅ ALL PUB BIAS BENCHMARK TESTS PASSED" : "\n❌ SOME PUB BIAS BENCHMARK TESTS FAILED");

  // ===== INFLUENCE / LOO BENCHMARKS =====
  // Each entry's `expected` is an array of k objects, one per study, with the
  // per-study fields produced by influenceDiagnostics().
  // Numeric tolerances: abs 0.001 for continuous stats (RE_loo, hat, cookD,
  // stdResidual, DFBETA); 5% relative for tau2_loo; abs 0.005 for deltaTau2.
  // Boolean flags are checked for exact equality.
  console.log("\n===== INFLUENCE / LOO BENCHMARKS =====\n");
  let infBenchPass = true;
  const { chk: ibchk, chkRel: ibchkTau_, chkExact: ibchkBool } = makeChk(() => { infBenchPass = false; });
  const ibchkTau = (name, val, expected) => ibchkTau_(name, val, expected, 0.05);

  INFLUENCE_BENCHMARKS.forEach(bm => {
    console.log(`--- ${bm.name} (${bm.tauMethod || "DL"}) ---`);

    const tauMethod = bm.tauMethod || "DL";
    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { ...d, se: Math.sqrt(d.vi) };
      const s = compute(d, bm.type, { hedgesCorrection: bm.correction === "hedges" });
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });

    const diag = influenceDiagnostics(studies, tauMethod);

    bm.expected.forEach((exp, i) => {
      const d   = diag[i];
      const pfx = `  [${i}] ${exp.label || i}`;
      if (exp.RE_loo      !== undefined) ibchk(`${pfx} RE_loo`,       d.RE_loo,       exp.RE_loo);
      if (exp.tau2_loo    !== undefined) ibchkTau(`${pfx} tau2_loo`,   d.tau2_loo,     exp.tau2_loo);
      if (exp.hat         !== undefined) ibchk(`${pfx} hat`,           d.hat,          exp.hat);
      if (exp.cookD       !== undefined) ibchk(`${pfx} cookD`,         d.cookD,        exp.cookD);
      if (exp.stdResidual !== undefined) ibchk(`${pfx} stdResidual`,   d.stdResidual,  exp.stdResidual);
      if (exp.DFBETA      !== undefined) ibchk(`${pfx} DFBETA`,        d.DFBETA,       exp.DFBETA);
      if (exp.DFFITS      !== undefined) ibchk(`${pfx} DFFITS`,        d.DFFITS,       exp.DFFITS);
      if (exp.covRatio    !== undefined) ibchk(`${pfx} covRatio`,      d.covRatio,     exp.covRatio);
      if (exp.deltaTau2   !== undefined) ibchk(`${pfx} deltaTau2`,     d.deltaTau2,    exp.deltaTau2, 0.005);
      if (exp.outlier     !== undefined) ibchkBool(`${pfx} outlier`,   d.outlier,      exp.outlier);
      if (exp.influential !== undefined) ibchkBool(`${pfx} influential`, d.influential, exp.influential);
      if (exp.highLeverage !== undefined) ibchkBool(`${pfx} highLeverage`, d.highLeverage, exp.highLeverage);
      if (exp.highCookD   !== undefined) ibchkBool(`${pfx} highCookD`, d.highCookD,    exp.highCookD);
      if (exp.highDffits  !== undefined) ibchkBool(`${pfx} highDffits`,   d.highDffits,   exp.highDffits);
      if (exp.highCovRatio !== undefined) ibchkBool(`${pfx} highCovRatio`, d.highCovRatio, exp.highCovRatio);
    });
  });

  console.log(infBenchPass ? "\n✅ ALL INFLUENCE BENCHMARK TESTS PASSED" : "\n❌ SOME INFLUENCE BENCHMARK TESTS FAILED");

  // ===== leaveOneOut / baujat / pCurve / pUniform / estimatorComparison / subgroupAnalysis =====
  // Smoke tests: verify return shape, structural invariants, and basic numerical sanity.
  // Not exhaustive — benchmarks for these functions are a separate future phase.
  console.log("\n===== UTILITY FUNCTION SMOKE TESTS =====\n");
  let utilPass = true;
  const { chkExact: uchk, chk: uchkApprox } = makeChk(() => { utilPass = false; }, 0.01);

  // Shared dataset — all 5 studies significant (|yi/se| > 1.96), 2 named groups.
  // z-scores: A≈3.58, B=2.50, C≈3.79, D≈2.45, E≈3.18 — strongly right-skewed for pCurve.
  const smokeS = [
    { label: "A", yi: -0.8, vi: 0.05, se: Math.sqrt(0.05), group: "X" },
    { label: "B", yi: -0.5, vi: 0.04, se: Math.sqrt(0.04), group: "X" },
    { label: "C", yi: -1.2, vi: 0.10, se: Math.sqrt(0.10), group: "Y" },
    { label: "D", yi: -0.6, vi: 0.06, se: Math.sqrt(0.06), group: "Y" },
    { label: "E", yi: -0.9, vi: 0.08, se: Math.sqrt(0.08), group: "Y" },
  ];
  // Non-significant dataset — all |z| < 0.15 — for edge-case checks in pCurve/pUniform.
  const noSigS = [
    { label: "X", yi:  0.05, vi: 0.5, se: Math.sqrt(0.5) },
    { label: "Y", yi:  0.10, vi: 0.5, se: Math.sqrt(0.5) },
    { label: "Z", yi:  0.00, vi: 0.5, se: Math.sqrt(0.5) },
  ];

  // ---- leaveOneOut ----
  console.log("--- leaveOneOut ---");
  {
    // k < 3 → rows is empty; full is still populated
    const tiny = leaveOneOut(smokeS.slice(0, 2), "DL");
    uchk("k<3: rows.length=0", tiny.rows.length, 0);
    uchk("k<3: full.RE finite", isFinite(tiny.full.RE), true);

    const loo = leaveOneOut(smokeS, "DL");
    uchk("rows.length=k", loo.rows.length, smokeS.length);
    uchk("full.RE finite", isFinite(loo.full.RE), true);

    const r = loo.rows[0];
    uchk("row.label preserved", r.label, "A");
    uchk("row.lb < row.ub", r.lb < r.ub, true);
    uchk("row.estimate finite", isFinite(r.estimate), true);
    uchk("row.tau2 finite", isFinite(r.tau2), true);
    uchk("row.pval finite", isFinite(r.pval), true);
    uchk("row.significant is boolean", typeof r.significant === "boolean", true);

    // Omitting the most extreme study (C: yi=−1.2) shifts pooled estimate toward 0
    const looC = loo.rows.find(row => row.label === "C");
    uchk("omit extreme study shifts RE toward 0", looC.estimate > loo.full.RE, true);
  }

  // ---- leaveOneOut fast-path regression tests (Step 5) ----
  // Verify that the fast path (moment + likelihood estimators) exactly matches
  // calling meta(loo) directly for every output field: estimate, tau2, i2,
  // lb, ub, pval.  Tolerance 1e-8 across all methods.
  {
    let looFPPass = true;
    const { chk: lpchk } = makeChk(() => { looFPPass = false; }, 1e-8);
    console.log("--- leaveOneOut fast-path regression ---");

    const bcg13 = [
      { yi: -0.8893113339202054, vi: 0.3255847650039614    },
      { yi: -1.5853886572014306, vi: 0.19458112139814387   },
      { yi: -1.348073148299693,  vi: 0.41536796536796533   },
      { yi: -1.4415511900213054, vi: 0.020010031902247573  },
      { yi: -0.2175473222112957, vi: 0.05121017216963086   },
      { yi: -0.786115585818864,  vi: 0.0069056184559087574 },
      { yi: -1.6208982235983924, vi: 0.22301724757231517   },
      { yi:  0.011952333523841173, vi: 0.00396157929781773 },
      { yi: -0.4694176487381487, vi: 0.056434210463248966  },
      { yi: -1.3713448034727846, vi: 0.07302479361302891   },
      { yi: -0.33935882833839015, vi: 0.01241221397155972  },
      { yi:  0.4459134005713783, vi: 0.5325058452001528    },
      { yi: -0.017313948216879493, vi: 0.0714046596839863  },
    ];

    const looDatasets = [
      { name: "A",   ss: sA    },
      { name: "D",   ss: sD    },
      { name: "BCG", ss: bcg13 },
    ];

    // PM and SJ are now on the fast path (warm-start fixed-point iteration).
    const fastMethods = ["DL","GENQ","HS","HSk","HE","SQGENQ","DLIT","REML","ML","EBLUP","PM","SJ"];

    for (const { name, ss } of looDatasets) {
      for (const m of fastMethods) {
        for (const ciM of ["normal", "KH"]) {
          const result = leaveOneOut(ss, m, ciM);
          result.rows.forEach((row, i) => {
            const loo = ss.filter((_, j) => j !== i);
            const ref = meta(loo, m, ciM);
            lpchk(`${m}/${name}/${ciM}[${i}] estimate`, row.estimate, ref.RE);
            lpchk(`${m}/${name}/${ciM}[${i}] tau2`,     row.tau2,     ref.tau2);
            lpchk(`${m}/${name}/${ciM}[${i}] i2`,       row.i2,       ref.I2);
            lpchk(`${m}/${name}/${ciM}[${i}] lb`,       row.lb,       ref.ciLow);
            lpchk(`${m}/${name}/${ciM}[${i}] ub`,       row.ub,       ref.ciHigh);
            // pval: skip when both non-finite (degenerate KH/homogeneous case)
            if (!isFinite(row.pval) && !isFinite(ref.pval)) {
              /* both degenerate — pass */
            } else {
              lpchk(`${m}/${name}/${ciM}[${i}] pval`, row.pval, ref.pval);
            }
          });
        }
      }
    }

    if (!looFPPass) utilPass = false;
    console.log(looFPPass
      ? "  leaveOneOut fast-path: PASS"
      : "  leaveOneOut fast-path: FAIL");
  }

  // ---- baujat ----
  console.log("--- baujat ---");
  {
    // k < 2 → null
    uchk("k=1 → null", baujat(smokeS.slice(0, 1)), null);

    const bj = baujat(smokeS);
    uchk("k matches input", bj.k, smokeS.length);
    uchk("points.length=k", bj.points.length, smokeS.length);
    uchk("muFE finite", isFinite(bj.muFE), true);
    uchk("Q > 0", bj.Q > 0, true);
    uchk("all x ≥ 0", bj.points.every(p => p.x >= 0), true);
    uchk("all influence ≥ 0", bj.points.every(p => p.influence >= 0), true);

    // x_i = w_i·(y_i − μ_FE)², so Σx_i = Q exactly
    const sumX = bj.points.reduce((s, p) => s + p.x, 0);
    uchk("Σx = Q", Math.abs(sumX - bj.Q) < 1e-9, true);

    // muFE must equal FE from meta()
    uchkApprox("muFE = meta FE", bj.muFE, meta(smokeS, "DL").FE);
  }

  // ---- pCurve ----
  console.log("--- pCurve ---");
  {
    // No significant studies → k=0, verdict=insufficient
    const pcNone = pCurve(noSigS);
    uchk("no-sig k=0", pcNone.k, 0);
    uchk("no-sig verdict=insufficient", pcNone.verdict, "insufficient");

    const pc = pCurve(smokeS);
    uchk("k=5 significant", pc.k, smokeS.length);
    uchk("bins.length=5", pc.bins.length, 5);
    uchk("expected0=0.20", pc.expected0, 0.20);
    uchk("expected33.length=5", pc.expected33.length, 5);

    // Proportions sum to 1
    const propSum = pc.bins.reduce((s, b) => s + b.prop, 0);
    uchk("bin props sum to 1", Math.abs(propSum - 1) < 1e-9, true);

    uchk("rightSkewP in [0,1]", pc.rightSkewP >= 0 && pc.rightSkewP <= 1, true);
    uchk("flatnessP in [0,1]", pc.flatnessP >= 0 && pc.flatnessP <= 1, true);
    uchk("rightSkewZ finite", isFinite(pc.rightSkewZ), true);

    const validVerdicts = ["evidential", "no-evidential", "inconclusive", "insufficient"];
    uchk("verdict is valid string", validVerdicts.includes(pc.verdict), true);

    // All p-values are very small (most in [0,0.01)) → strongly right-skewed → evidential
    uchk("strongly right-skewed → evidential", pc.verdict, "evidential");
  }

  // ---- pUniform ----
  console.log("--- pUniform ---");
  {
    // No significant studies → k=0, estimate=NaN
    const puNone = pUniform(noSigS, null);
    uchk("no-sig k=0", puNone.k, 0);
    uchk("no-sig estimate=NaN", isNaN(puNone.estimate), true);

    const m = meta(smokeS, "DL");
    const pu = pUniform(smokeS, m);
    uchk("k=5 significant", pu.k, smokeS.length);
    uchk("estimate finite", isFinite(pu.estimate), true);
    uchk("ciLow finite", isFinite(pu.ciLow), true);
    uchk("ciHigh finite", isFinite(pu.ciHigh), true);
    uchk("ciLow < estimate", pu.ciLow < pu.estimate, true);
    uchk("estimate < ciHigh", pu.estimate < pu.ciHigh, true);
    uchk("Z_sig finite", isFinite(pu.Z_sig), true);
    uchk("Z_bias finite", isFinite(pu.Z_bias), true);
    uchk("significantEffect is boolean", typeof pu.significantEffect === "boolean", true);
    uchk("biasDetected is boolean", typeof pu.biasDetected === "boolean", true);

    // All studies are clearly significant → significantEffect=true
    uchk("all-sig data → significantEffect=true", pu.significantEffect, true);
  }

  // ---- estimatorComparison ----
  console.log("--- estimatorComparison ---");
  {
    const ec = estimatorComparison(smokeS);
    uchk("returns 12 entries", ec.length, 12);

    const names = ec.map(e => e.method);
    ["DL", "REML", "PM", "ML", "HS", "HE", "SJ"].forEach(n =>
      uchk(`method ${n} present`, names.includes(n), true)
    );

    uchk("all estimates finite", ec.every(e => isFinite(e.estimate)), true);
    uchk("all lb ≤ ub", ec.every(e => e.lb <= e.ub), true);
    uchk("all tau2 ≥ 0", ec.every(e => e.tau2 >= 0), true);

    // For this low-heterogeneity dataset all RE estimates cluster near the FE value
    const ests = ec.map(e => e.estimate);
    uchk("estimates cluster (range < 0.3)", Math.max(...ests) - Math.min(...ests) < 0.3, true);
  }

  // ---- subgroupAnalysis ----
  console.log("--- subgroupAnalysis ---");
  {
    // No group property → null
    uchk("no group → null", subgroupAnalysis(smokeS.map(s => ({ yi: s.yi, vi: s.vi }))), null);

    // All same group → only 1 group → null
    uchk("1 group → null", subgroupAnalysis(smokeS.map(s => ({ ...s, group: "all" }))), null);

    // 2 groups: X (k=2), Y (k=3)
    const sg = subgroupAnalysis(smokeS, "DL");
    uchk("G=2", sg.G, 2);
    uchk("df=G-1=1", sg.df, 1);
    uchk("k=5", sg.k, smokeS.length);
    uchk("Qbetween ≥ 0", sg.Qbetween >= 0, true);
    uchk("p in [0,1]", sg.p >= 0 && sg.p <= 1, true);

    const gX = sg.groups["X"], gY = sg.groups["Y"];
    uchk("group X exists", gX !== undefined, true);
    uchk("group Y exists", gY !== undefined, true);
    uchk("group X k=2", gX.k, 2);
    uchk("group Y k=3", gY.k, 3);
    uchk("group X ci.lb < ci.ub", gX.ci.lb < gX.ci.ub, true);
    uchk("group Y ci.lb < ci.ub", gY.ci.lb < gY.ci.ub, true);
    uchk("group X estimate finite", isFinite(gX.y), true);
    uchk("group Y estimate finite", isFinite(gY.y), true);
  }

  console.log(utilPass ? "\n✅ ALL UTILITY SMOKE TESTS PASSED" : "\n❌ SOME UTILITY SMOKE TESTS FAILED");

  // ===== TRIM-AND-FILL UNIT TESTS =====
  // Tests the Duval & Tweedie L0 estimator, mirror-image reflection, and edge cases.
  console.log("\n===== TRIM-AND-FILL UNIT TESTS =====\n");
  let tfPass = true;
  const { chkExact: tfchk, chk: tfchkApprox } = makeChk(() => { tfPass = false; });

  // ---- k < 3: immediate empty return ----
  // Code returns [] before any iteration when studies.length < 3.
  console.log("--- k < 3 edge cases ---");
  {
    tfchk("k=0 → []", trimFill([]).length, 0);
    tfchk("k=1 → []", trimFill([{ yi: 1, vi: 1 }]).length, 0);
    tfchk("k=2 → []", trimFill([{ yi: 1, vi: 1 }, { yi: 2, vi: 1 }]).length, 0);
  }

  // ---- k0=0: no asymmetry ----
  // With all deviations = 0, Tn = 0, L0 formula gives negative → max(0,·) = 0 → returns [].
  console.log("--- k0=0: all equal yi ---");
  {
    const flat3 = [{ yi: 1, vi: 0.1 }, { yi: 1, vi: 0.1 }, { yi: 1, vi: 0.1 }];
    tfchk("k=3, all yi=1 → k0=0, []", trimFill(flat3).length, 0);

    const flat5 = Array.from({ length: 5 }, () => ({ yi: 0, vi: 1, label: "s" }));
    tfchk("k=5, all yi=0 → k0=0, []", trimFill(flat5).length, 0);
  }

  // ---- maxIter=0: loop never runs, k0 stays 0 ----
  console.log("--- maxIter=0 ---");
  {
    // Even a strongly asymmetric dataset returns [] when maxIter=0.
    const asym = [
      { label: "S1", yi: 0.0, vi: 0.04 }, { label: "S2", yi: 0.1, vi: 0.04 },
      { label: "S3", yi: 1.5, vi: 0.04 }, { label: "S4", yi: 2.0, vi: 0.04 },
      { label: "S5", yi: 2.5, vi: 0.04 },
    ];
    tfchk("maxIter=0 → k0=0 regardless of data", trimFill(asym, "DL", 0).length, 0);
  }

  // ---- BCG log-OR DL: k0=0 (cross-validated against metafor 4.8-0) ----
  // All three estimators give k0=0; trim-and-fill detects no asymmetry.
  // Previous tests asserted k0=10, which was derived from an incorrect algorithm.
  console.log("--- BCG log-OR DL: k0=0 (all estimators) ---");
  {
    const bm = PUB_BIAS_BENCHMARKS[0];
    const studies = bm.data.map(d => {
      const s = compute(d, bm.type);
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });
    tfchk("BCG OR DL L0: k0=0", trimFill(studies, bm.tauMethod, "L0").length, 0);
    tfchk("BCG OR DL R0: k0=0", trimFill(studies, bm.tauMethod, "R0").length, 0);
    tfchk("BCG OR DL Q0: k0=0", trimFill(studies, bm.tauMethod, "Q0").length, 0);
  }

  // ---- BCG log-RR DL: L0=1, R0=0, Q0=1 (cross-validated against metafor 4.8-0) ----
  // yi/vi from dat.bcg escalc("RR"). L0 and Q0 impute 1 study; R0 detects no gap.
  console.log("--- BCG log-RR DL: L0=1, R0=0, Q0=1 ---");
  {
    const bcgRR = [
      {label:"Aronson 1948",           yi:-0.8893113339202054, vi:0.3255847650039613},
      {label:"Ferguson & Simes 1949",  yi:-1.5853886572014306, vi:0.1945811213981438},
      {label:"Rosenthal et al 1960",   yi:-1.3480731482996933, vi:0.4153679653679654},
      {label:"Hart & Sutherland 1977", yi:-1.4415511900213054, vi:0.0200100319022476},
      {label:"Frimodt-Moller 1973",    yi:-0.2175473222112956, vi:0.0512101721696309},
      {label:"Stein & Aronson 1953",   yi:-0.7861155858188640, vi:0.0069056184559088},
      {label:"Vandiviere 1973",        yi:-1.6208982235983918, vi:0.2230172475723152},
      {label:"TPT Madras 1980",        yi: 0.0119523335238405, vi:0.0039615792978177},
      {label:"Coetzee & Berjak 1968",  yi:-0.4694176487381494, vi:0.0564342104632490},
      {label:"Rosenthal et al 1961",   yi:-1.3713448034727844, vi:0.0730247936130289},
      {label:"Comstock et al 1974",    yi:-0.3393588283383906, vi:0.0124122139715597},
      {label:"Comstock & Webster 1969",yi: 0.4459134005713787, vi:0.5325058452001528},
      {label:"Comstock et al 1976",    yi:-0.0173139482168798, vi:0.0714046596839863},
    ];
    const filledL0 = trimFill(bcgRR, "DL", "L0");
    const filledR0 = trimFill(bcgRR, "DL", "R0");
    const filledQ0 = trimFill(bcgRR, "DL", "Q0");
    tfchk("BCG RR DL L0 k0=1", filledL0.length, 1);
    tfchk("BCG RR DL R0 k0=0", filledR0.length, 0);
    tfchk("BCG RR DL Q0 k0=1", filledQ0.length, 1);
    // Filled study has correct flags
    tfchk("L0 filled.filled=true", filledL0[0].filled, true);
    tfchk("L0 label ends with (filled)", filledL0[0].label.endsWith(" (filled)"), true);
    // Adjusted RE (L0, tol 0.001): metafor gives −0.656073
    const adjL0 = meta([...bcgRR, ...filledL0], "DL").RE;
    tfchkApprox("BCG RR DL L0 adjRE", adjL0, -0.6561, 0.001);
  }

  // ---- Mixed k=12 DL: L0=4, R0=3, Q0=6 (cross-validated against metafor 4.8-0) ----
  // This dataset has clearly different k0 across estimators — ideal for testing all three.
  // yi/vi from TrimFill_benchmarks in benchmarks.js; side="left" (right-excess).
  // Expected adjRE: L0=−0.3688, R0=−0.3302, Q0=−0.4490.
  console.log("--- mixed k=12 DL: L0=4, R0=3, Q0=6 ---");
  {
    const mixed = [
      {label:"S1",  yi:-1.0, vi:0.30}, {label:"S2",  yi:-0.8, vi:0.20},
      {label:"S3",  yi:-0.6, vi:0.40}, {label:"S4",  yi:-0.4, vi:0.10},
      {label:"S5",  yi:-0.2, vi:0.15}, {label:"S6",  yi: 0.0, vi:0.20},
      {label:"S7",  yi: 0.1, vi:0.50}, {label:"S8",  yi: 0.3, vi:0.60},
      {label:"S9",  yi: 0.5, vi:0.80}, {label:"S10", yi: 0.8, vi:1.00},
      {label:"S11", yi: 1.2, vi:1.20}, {label:"S12", yi: 1.8, vi:1.50},
    ];
    const fL0 = trimFill(mixed, "DL", "L0");
    const fR0 = trimFill(mixed, "DL", "R0");
    const fQ0 = trimFill(mixed, "DL", "Q0");
    tfchk("mixed DL L0 k0=4", fL0.length, 4);
    tfchk("mixed DL R0 k0=3", fR0.length, 3);
    tfchk("mixed DL Q0 k0=6", fQ0.length, 6);
    // Structural invariants on L0 fills
    tfchk("filled.filled=true", fL0.every(f => f.filled === true), true);
    tfchk("vi preserved", fL0.every(f => isFinite(f.vi) && f.vi > 0), true);
    tfchk("labels end with ' (filled)'", fL0.every(f => f.label.endsWith(" (filled)")), true);
    // Mirror invariant: filled_yi + orig_yi = 2·center → all same
    const centers = fL0.map(f => {
      const orig = mixed.find(s => s.label === f.label.replace(" (filled)", ""));
      return orig != null ? (f.yi + orig.yi) : null;
    });
    tfchk("every filled label maps to an original", centers.every(c => c !== null), true);
    tfchk("all pairs share the same center", centers.every(c => Math.abs(c - centers[0]) < 1e-9), true);
    // Adjusted RE (tol 0.001): metafor gives L0=−0.3688, R0=−0.3302, Q0=−0.4490
    const adjL0 = meta([...mixed, ...fL0], "DL").RE;
    const adjR0 = meta([...mixed, ...fR0], "DL").RE;
    const adjQ0 = meta([...mixed, ...fQ0], "DL").RE;
    tfchkApprox("mixed DL L0 adjRE", adjL0, -0.3688, 0.001);
    tfchkApprox("mixed DL R0 adjRE", adjR0, -0.3302, 0.001);
    tfchkApprox("mixed DL Q0 adjRE", adjQ0, -0.4490, 0.001);
    // Fill is on the negative side (adding studies with lower yi)
    const origRE = meta(mixed, "DL").RE;
    tfchk("L0 adjRE < origRE", adjL0 < origRE, true);
    tfchk("R0 adjRE < origRE", adjR0 < origRE, true);
    tfchk("Q0 adjRE < origRE", adjQ0 < origRE, true);
  }

  console.log(tfPass ? "\n✅ ALL TRIM-AND-FILL TESTS PASSED" : "\n❌ SOME TRIM-AND-FILL TESTS FAILED");

  // ===== fCDF UNIT TESTS =====
  // Tests the F-distribution CDF via analytically exact identities:
  //   F(2,2): I_x(1,1) = x, where x = d1·f/(d1·f+d2) = f/(f+1)  →  fCDF(f,2,2) = f/(f+1)
  //   F(1,2): I_x(1/2,1) = √x, where x = f/(f+2)                →  fCDF(f,1,2) = √(f/(f+2))
  console.log("\n===== fCDF UNIT TESTS =====\n");
  let fcdfPass = true;
  const fcdfchk = (label, got, expected) => {
    const ok = Math.abs(got - expected) < 1e-12;
    if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${expected}`); fcdfPass = false; }
    else console.log(`  ok  ${label}`);
  };

  // F(2,2): fCDF(f,2,2) = f/(f+1)  (exact)
  fcdfchk("fCDF(1,2,2) = 0.5",  fCDF(1, 2, 2), 1/2);
  fcdfchk("fCDF(3,2,2) = 0.75", fCDF(3, 2, 2), 3/4);
  fcdfchk("fCDF(9,2,2) = 0.9",  fCDF(9, 2, 2), 9/10);
  fcdfchk("fCDF(4,2,2) = 0.8",  fCDF(4, 2, 2), 4/5);

  // F(1,2): fCDF(f,1,2) = √(f/(f+2))  (exact)
  fcdfchk("fCDF(1,1,2) = 1/√3", fCDF(1, 1, 2), Math.sqrt(1/3));
  fcdfchk("fCDF(2,1,2) = 1/√2", fCDF(2, 1, 2), Math.sqrt(1/2));
  fcdfchk("fCDF(7,1,2) = √(7/9) = √(7)/3", fCDF(7, 1, 2), Math.sqrt(7/9));

  // Edge cases
  fcdfchk("fCDF(0,1,1) = 0 (f=0)",   fCDF(0,  1, 1), 0);
  fcdfchk("fCDF(-1,1,1) = 0 (f<0)",  fCDF(-1, 1, 1), 0);
  const nanCheck = (label, got) => {
    const ok = isNaN(got);
    if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected NaN`); fcdfPass = false; }
    else console.log(`  ok  ${label}`);
  };
  nanCheck("fCDF(1,0,1) = NaN (d1=0)",         fCDF(1, 0, 1));
  nanCheck("fCDF(1,1,0) = NaN (d2=0)",         fCDF(1, 1, 0));
  nanCheck("fCDF(1,Inf,1) = NaN (d1=Infinity)", fCDF(1, Infinity, 1));

  console.log(fcdfPass ? "\n✅ ALL fCDF TESTS PASSED" : "\n❌ SOME fCDF TESTS FAILED");

  // ===== EGGER TEST UNIT TESTS =====
  // Synthetic k=4 dataset where X=1/SE and Z=yi/SE are small integers,
  // making all OLS intermediate quantities exact. See benchmark-data.md
  // "Egger synthetic unit-test dataset" for the full derivation.
  //
  // Dataset:  yi=[-1,-1,-0.5,1], se=[0.5,1,0.5,1]
  //   X = [2,1,2,1], Z = [-2,-1,-1,1]
  //   meanX=1.5, meanZ=-0.75
  //   slope = -1.5  (exact)
  //   intercept = 1.5  (exact)
  //   rss = 2.5  (exact), df = 2
  //   se(intercept) = sqrt(3.125)  (exact)
  //   t = 1.5/sqrt(3.125)  (exact)
  //   p = 1 - |t|/sqrt(t^2+2)  (exact, closed form for df=2)
  console.log("\n===== EGGER TEST UNIT TESTS =====\n");
  let eggerPass = true;
  const egchk = (label, got, expected, tol=1e-10) => {
    const ok = Math.abs(got - expected) < tol;
    if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${expected}`); eggerPass = false; }
    else console.log(`  ok  ${label}`);
  };

  const egS = [
    { label: "S1", yi: -1.0, se: 0.5, vi: 0.25 },
    { label: "S2", yi: -1.0, se: 1.0, vi: 1.00 },
    { label: "S3", yi: -0.5, se: 0.5, vi: 0.25 },
    { label: "S4", yi:  1.0, se: 1.0, vi: 1.00 },
  ];
  const EG_SLOPE      = -1.5;
  const EG_INTERCEPT  =  1.5;
  const EG_SE         = Math.sqrt(3.125);            // sqrt(1.25 * 2.5)
  const EG_T          = 1.5 / Math.sqrt(3.125);      // intercept / se
  const EG_DF         = 2;
  const EG_P          = 1 - EG_T / Math.sqrt(EG_T**2 + EG_DF); // exact, df=2

  const eg = eggerTest(egS);

  egchk("slope     = -1.5 (exact)",          eg.slope,     EG_SLOPE);
  egchk("intercept =  1.5 (exact)",          eg.intercept, EG_INTERCEPT);
  egchk("se = sqrt(3.125) ≈ 1.76777",        eg.se,        EG_SE);
  egchk("t  = 1.5/sqrt(3.125) ≈ 0.84853",   eg.t,         EG_T);
  egchk("df = 2",                            eg.df,        EG_DF);
  egchk("p  ≈ 0.48550 (df=2 exact)",         eg.p,         EG_P);

  // Structural invariant: t = intercept / se
  egchk("t = intercept/se (identity)",       eg.t, eg.intercept / eg.se);

  // Edge cases
  const egNaN = eggerTest([egS[0], egS[1]]);         // k=2 < 3
  const egNaNOk = isNaN(egNaN.intercept) && isNaN(egNaN.slope) &&
                  isNaN(egNaN.se) && isNaN(egNaN.t) && isNaN(egNaN.df) && isNaN(egNaN.p);
  if (!egNaNOk) { console.error("  FAIL k<3 → all NaN"); eggerPass = false; }
  else console.log("  ok  k<3 → all NaN (intercept, slope, se, t, df, p)");

  const eg3 = eggerTest([egS[0], egS[1], egS[2]]);   // k=3, df=1, minimum valid
  const eg3ok = isFinite(eg3.intercept) && isFinite(eg3.slope) &&
                isFinite(eg3.se) && isFinite(eg3.t) && eg3.df === 1 && isFinite(eg3.p);
  if (!eg3ok) { console.error("  FAIL k=3 not all finite"); eggerPass = false; }
  else console.log("  ok  k=3 (df=1): all finite, df=1");

  // Degenerate: all se identical → Var(X)=0 → slope and se are NaN/Inf
  const egSameX = [
    { label: "A", yi:  1.0, se: 1.0, vi: 1.0 },
    { label: "B", yi: -1.0, se: 1.0, vi: 1.0 },
    { label: "C", yi:  0.5, se: 1.0, vi: 1.0 },
  ];
  const egDeg = eggerTest(egSameX);
  const egDegOk = !isFinite(egDeg.slope) || isNaN(egDeg.slope);
  if (!egDegOk) { console.error(`  FAIL all-equal SE: slope should be non-finite, got ${egDeg.slope}`); eggerPass = false; }
  else console.log("  ok  all-equal SE → slope non-finite (den=0)");

  // Sign invariant: negating all yi flips sign of intercept and t, leaves p unchanged
  const egNeg = eggerTest(egS.map(s => ({ ...s, yi: -s.yi })));
  egchk("negated yi: intercept flips sign", egNeg.intercept, -EG_INTERCEPT);
  egchk("negated yi: slope flips sign",     egNeg.slope,     -EG_SLOPE);
  egchk("negated yi: t flips sign",         egNeg.t,         -EG_T);
  egchk("negated yi: p unchanged",          egNeg.p,          EG_P);

  // Degenerate: all yi identical (yi = c, varying SE)
  // Z = yi/se = c/se = c·X  →  perfect collinearity with slope=c, intercept=0,
  // rss=0, se=0, t=0/0=NaN, p=NaN.
  // Reason: if all true effects are equal, the funnel is symmetric by construction;
  // the test correctly signals that asymmetry is unquantifiable (0/0), not absent.
  const egSameY = [
    { label: "A", yi: 0.5, se: 0.2, vi: 0.04 },
    { label: "B", yi: 0.5, se: 0.5, vi: 0.25 },
    { label: "C", yi: 0.5, se: 0.8, vi: 0.64 },
    { label: "D", yi: 0.5, se: 1.0, vi: 1.00 },
  ];
  const egSY = eggerTest(egSameY);
  egchk("all yi=c: slope = c = 0.5 (exact)",   egSY.slope,     0.5);
  egchk("all yi=c: intercept = 0 (exact)",      egSY.intercept, 0);
  egchk("all yi=c: se = 0 (rss=0)",            egSY.se,        0);
  egchk("all yi=c: df = k-2 = 2",              egSY.df,        2);
  if (!isNaN(egSY.t) || !isNaN(egSY.p)) {
    console.error(`  FAIL all yi=c: t and p should be NaN, got t=${egSY.t} p=${egSY.p}`);
    eggerPass = false;
  } else console.log("  ok  all yi=c: t=NaN, p=NaN (0/0, unquantifiable)");

  // Special sub-case: all yi = 0 → Z=0 for all, slope=0, intercept=0
  const egZeroY = [
    { label: "A", yi: 0, se: 0.2, vi: 0.04 },
    { label: "B", yi: 0, se: 0.5, vi: 0.25 },
    { label: "C", yi: 0, se: 1.0, vi: 1.00 },
  ];
  const egZY = eggerTest(egZeroY);
  egchk("all yi=0: slope = 0 (exact)",     egZY.slope,     0);
  egchk("all yi=0: intercept = 0 (exact)", egZY.intercept, 0);
  egchk("all yi=0: se = 0",               egZY.se,        0);

  console.log(eggerPass ? "\n✅ ALL EGGER TESTS PASSED" : "\n❌ SOME EGGER TESTS FAILED");

  // ===== META-REGRESSION BENCHMARKS =====
  // Three entries: MR-A (year+ablat, normal CI), MR-B (ablat+region, normal CI),
  // MR-C (ablat+region, KH CI).  Checks beta, se, tau2, QE, QM, I2, R2,
  // per-moderator Wald tests, and (for MR-A) VIF values.
  console.log("\n===== META-REGRESSION BENCHMARKS =====\n");
  let mrBenchPass = true;
  const { chk: mrchk, chkField: mrfield } = makeChk(() => { mrBenchPass = false; });

  META_REGRESSION_BENCHMARKS.forEach(bm => {
    const studies = bm.data.map(d => ({ ...d, se: Math.sqrt(d.vi) }));
    const r = metaRegression(studies, bm.moderators, bm.tauMethod, bm.ciMethod);
    const exp = bm.expected;

    console.log(`--- ${bm.name} ---`);

    // colNames
    if (exp.colNames) {
      const ok = exp.colNames.every((n, i) => r.colNames[i] === n);
      if (!ok) { console.error(`  FAIL colNames: got ${JSON.stringify(r.colNames)}, expected ${JSON.stringify(exp.colNames)}`); mrBenchPass = false; }
      else console.log(`  ok  colNames = ${JSON.stringify(r.colNames)}`);
    }

    // beta / se — abs 0.01 tolerance
    exp.beta.forEach((b, j) => mrchk(`beta[${j}] (${r.colNames[j]})`, r.beta[j], b, 0.01));
    exp.se.forEach((s, j) => mrchk(`se[${j}]   (${r.colNames[j]})`, r.se[j], s, 0.01));

    // heterogeneity
    mrfield("tau2", r.tau2, exp.tau2, "tau2");
    mrchk("QE",  r.QE,  exp.QE,  0.01);
    mrchk("QEp", r.QEp, exp.QEp, 0.01);
    mrchk("QM",  r.QM,  exp.QM,  0.01);
    mrchk("QMp", r.QMp, exp.QMp, 0.01);
    mrfield("I2", r.I2, exp.I2, "I2");
    mrchk("R2",  r.R2,  exp.R2,  0.01);

    // per-moderator Wald tests
    if (exp.modTests) {
      exp.modTests.forEach((mt, idx) => {
        const got = r.modTests[idx];
        if (!got) { console.error(`  FAIL modTests[${idx}] missing`); mrBenchPass = false; return; }
        mrchk(`modTests[${idx}] (${mt.name}) QM`,  got.QM,  mt.QM,  0.01);
        mrchk(`modTests[${idx}] (${mt.name}) QMp`, got.QMp, mt.QMp, 0.01);
        const dfOk = got.QMdf === mt.QMdf;
        if (!dfOk) { console.error(`  FAIL modTests[${idx}] QMdf: got ${got.QMdf}, expected ${mt.QMdf}`); mrBenchPass = false; }
        else console.log(`  ok  modTests[${idx}] (${mt.name}) QMdf = ${mt.QMdf}`);
      });
    }

    // VIF (only checked for MR-A where values were verified)
    if (exp.vif) {
      exp.vif.forEach((v, j) => {
        if (v === null) return; // intercept — VIF not defined
        mrchk(`vif[${j}] (${r.colNames[j]})`, r.vif[j], v, 0.01);
      });
    }

    // AIC / BIC (R-verified)
    if (exp.LL  !== undefined) mrchk("LL",  r.LL,  exp.LL,  0.001);
    if (exp.AIC !== undefined) mrchk("AIC", r.AIC, exp.AIC, 0.001);
    if (exp.BIC !== undefined) mrchk("BIC", r.BIC, exp.BIC, 0.001);
  });

  console.log(mrBenchPass ? "\n✅ ALL META-REGRESSION BENCHMARK TESTS PASSED" : "\n❌ SOME META-REGRESSION BENCHMARK TESTS FAILED");

  // ===== CSV IMPORT — MODERATOR DETECTION =====
  // Verifies that parseCSV + the column-classification heuristic used by
  // commitImport() (ui.js) produces the correct modSpec array when a CSV
  // contains extra columns beyond the known effect-type inputs.
  //
  // The heuristic (mirrored here):
  //   knownCols = { "study", "group", ...profile.inputs.map(toLower) }
  //   modCols   = headers not in knownCols
  //   type      = all non-empty values numeric → "continuous", else "categorical"
  console.log("\n===== CSV IMPORT — MODERATOR DETECTION =====\n");
  let csvPass = true;
  const csvchk = (label, got, expected) => {
    const ok = got === expected;
    if (!ok) { console.error(`  FAIL ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); csvPass = false; }
    else console.log(`  ok  ${label}`);
  };

  // Helper: classify columns to modSpec given headers, rows, and known inputs.
  function inferModSpec(headers, rows, profileInputs) {
    const knownCols = new Set(["study", "group", ...profileInputs.map(c => c.toLowerCase())]);
    const headerMap = {};
    headers.forEach((h, idx) => { headerMap[h.toLowerCase()] = idx; });
    return headers
      .filter(h => !knownCols.has(h.toLowerCase()))
      .map(col => {
        const ci   = headerMap[col.toLowerCase()];
        const vals = rows.map(r => r[ci] ?? "").filter(v => v.trim() !== "");
        const type = vals.length > 0 && vals.every(v => !isNaN(v.trim())) ? "continuous" : "categorical";
        return { key: col, type };
      });
  }

  // ---- 3-extra-column CSV: two continuous + one categorical ----
  // Profile inputs for GENERIC are ["yi", "vi"]; "study" and "group" are fixed.
  // Extra columns: "year" (all numeric), "ablat" (all numeric), "region" (strings).
  console.log("--- 3 extra columns: year (continuous), ablat (continuous), region (categorical) ---");
  {
    const csvText = [
      "Study,yi,vi,Group,year,ablat,region",
      "S1,-0.889,0.326,,1948,44,NA",
      "S2,-1.585,0.195,,1949,55,EU",
      "S3,-1.348,0.415,,1960,42,AS",
    ].join("\n");

    const { headers, rows } = parseCSV(csvText);
    const profileInputs = ["yi", "vi"]; // GENERIC profile

    csvchk("header count",  headers.length, 7);
    csvchk("headers[0]",    headers[0], "Study");
    csvchk("headers[4]",    headers[4], "year");
    csvchk("headers[5]",    headers[5], "ablat");
    csvchk("headers[6]",    headers[6], "region");
    csvchk("row count",     rows.length, 3);

    const modSpec = inferModSpec(headers, rows, profileInputs);

    csvchk("modSpec.length", modSpec.length, 3);
    csvchk("modSpec[0].key",  modSpec[0].key,  "year");
    csvchk("modSpec[0].type", modSpec[0].type, "continuous");
    csvchk("modSpec[1].key",  modSpec[1].key,  "ablat");
    csvchk("modSpec[1].type", modSpec[1].type, "continuous");
    csvchk("modSpec[2].key",  modSpec[2].key,  "region");
    csvchk("modSpec[2].type", modSpec[2].type, "categorical");
  }

  // ---- Blank cells in a continuous column are tolerated ----
  // Blank cells are filtered before the isNaN check, so a column with some
  // blanks but otherwise all numeric is still typed "continuous".
  console.log("--- continuous column with blank cells ---");
  {
    const csvText = [
      "Study,yi,vi,dose",
      "S1,0.1,0.01,10",
      "S2,0.2,0.02,",
      "S3,0.3,0.03,30",
    ].join("\n");

    const { headers, rows } = parseCSV(csvText);
    const modSpec = inferModSpec(headers, rows, ["yi", "vi"]);

    csvchk("blank-cell modSpec.length",       modSpec.length,    1);
    csvchk("blank-cell modSpec[0].key",        modSpec[0].key,   "dose");
    csvchk("blank-cell modSpec[0].type",       modSpec[0].type,  "continuous");
  }

  // ---- A column where every cell is blank → categorical (no numeric evidence) ----
  console.log("--- all-blank column → categorical ---");
  {
    const csvText = [
      "Study,yi,vi,notes",
      "S1,0.1,0.01,",
      "S2,0.2,0.02,",
    ].join("\n");

    const { headers, rows } = parseCSV(csvText);
    const modSpec = inferModSpec(headers, rows, ["yi", "vi"]);

    csvchk("all-blank modSpec[0].type", modSpec[0].type, "categorical");
  }

  // ---- Known columns (Study, Group, profile inputs) are excluded ----
  console.log("--- known columns excluded from modSpec ---");
  {
    const csvText = [
      "Study,yi,vi,Group,score",
      "S1,0.1,0.01,A,5",
      "S2,0.2,0.02,B,7",
    ].join("\n");

    const { headers, rows } = parseCSV(csvText);
    const modSpec = inferModSpec(headers, rows, ["yi", "vi"]);

    csvchk("known-cols excluded modSpec.length", modSpec.length, 1);
    csvchk("known-cols excluded modSpec[0].key", modSpec[0].key, "score");
  }

  // ---- No extra columns → empty modSpec ----
  console.log("--- no extra columns → empty modSpec ---");
  {
    const csvText = [
      "Study,yi,vi,Group",
      "S1,0.1,0.01,A",
    ].join("\n");

    const { headers, rows } = parseCSV(csvText);
    const modSpec = inferModSpec(headers, rows, ["yi", "vi"]);

    csvchk("no-extra modSpec.length", modSpec.length, 0);
  }

  // --- parseCSV edge cases ---
  {
    // 1. UTF-8 BOM (Excel default) — header must not begin with \uFEFF
    const bomText = "\uFEFFstudy,yi,vi\nS1,0.1,0.01\n";
    const { headers: bomH } = parseCSV(bomText);
    csvchk("BOM: header[0]", bomH[0], "study");
    csvchk("BOM: header[1]", bomH[1], "yi");

    // 2. Quoted field with embedded comma
    const commaText = 'study,label,yi,vi\nS1,"Smith, J.",0.1,0.01\nS2,"Doe, A.",0.2,0.02\n';
    const { headers: ch, rows: cr } = parseCSV(commaText);
    csvchk("embedded comma: header count", ch.length, 4);
    csvchk("embedded comma: row[0][1]", cr[0][1], "Smith, J.");
    csvchk("embedded comma: row[1][1]", cr[1][1], "Doe, A.");

    // 3. Quoted field with embedded newline
    const nlText = 'study,label,yi,vi\nS1,"line1\nline2",0.1,0.01\nS2,normal,0.2,0.02\n';
    const { headers: nh, rows: nr } = parseCSV(nlText);
    csvchk("embedded newline: header count", nh.length, 4);
    csvchk("embedded newline: row[0][1]", nr[0][1], "line1\nline2");
    csvchk("embedded newline: row count", nr.length, 2);
    csvchk("embedded newline: row[1][2]", nr[1][2], "0.2");

    // 4. Empty trailing rows (common in Excel exports)
    const trailText = "study,yi,vi\nS1,0.1,0.01\nS2,0.2,0.02\n\n\n";
    const { rows: tr } = parseCSV(trailText);
    csvchk("trailing empty rows: row count", tr.length, 2);

    // 5. CRLF line endings throughout (Windows)
    const crlfText = "study,yi,vi\r\nS1,0.1,0.01\r\nS2,0.2,0.02\r\n";
    const { headers: crlfH, rows: crlfR } = parseCSV(crlfText);
    csvchk("CRLF: header count", crlfH.length, 3);
    csvchk("CRLF: row count", crlfR.length, 2);
    csvchk("CRLF: row[0][0]", crlfR[0][0], "S1");

    // 6. Escaped double-quote inside quoted field ("")
    const dqText = 'study,label,yi\nS1,"He said ""yes""",0.5\n';
    const { rows: dqR } = parseCSV(dqText);
    csvchk("escaped quote: row[0][1]", dqR[0][1], 'He said "yes"');
  }

  console.log(csvPass ? "\n✅ ALL CSV IMPORT TESTS PASSED" : "\n❌ SOME CSV IMPORT TESTS FAILED");

  // ---- BFGS optimizer tests ----
  console.log("\n===== BFGS OPTIMIZER TESTS =====\n");
  let bfgsPass = true;
  const { chk: opchk, chkTrue: opchkTrue } = makeChk(() => { bfgsPass = false; });

  // 1-D quadratic: f(x) = (x - 3)²  →  min at x=3, fval=0
  {
    console.log("--- 1-D quadratic: f(x) = (x-3)² ---");
    const r = bfgs(x => (x[0] - 3) ** 2, [0]);
    opchk("x[0]",    r.x[0], 3,   0.001);
    opchk("fval",    r.fval, 0,   1e-8);
    opchkTrue("converged", r.converged);
  }

  // 2-D quadratic: f(x,y) = (x-1)² + 4·(y+2)²  →  min at [1, -2]
  {
    console.log("--- 2-D quadratic: f(x,y) = (x-1)² + 4·(y+2)² ---");
    const r = bfgs(x => (x[0] - 1) ** 2 + 4 * (x[1] + 2) ** 2, [0, 0]);
    opchk("x[0]",    r.x[0],  1,   0.001);
    opchk("x[1]",    r.x[1], -2,   0.001);
    opchk("fval",    r.fval,  0,   1e-8);
    opchkTrue("converged", r.converged);
  }

  // Rosenbrock: f(x,y) = (1-x)² + 100·(y-x²)²  →  min at [1, 1]
  {
    console.log("--- Rosenbrock: min at [1, 1] ---");
    const r = bfgs(x => (1 - x[0]) ** 2 + 100 * (x[1] - x[0] ** 2) ** 2, [0, 0]);
    opchk("x[0]",    r.x[0], 1,   0.001);
    opchk("x[1]",    r.x[1], 1,   0.001);
    opchk("fval",    r.fval, 0,   1e-6);
    opchkTrue("converged", r.converged);
  }

  console.log(bfgsPass ? "\n✅ ALL BFGS TESTS PASSED" : "\n❌ SOME BFGS TESTS FAILED");

  // ---- Selection model helper tests (Step 1-C) ----
  console.log("\n===== SELECTION MODEL TESTS (Step 1-C) =====\n");
  let selPass = true;
  const { chk: schk, chkTrue: schkTrue } = makeChk(() => { selPass = false; });

  const DEFAULT_CUTS = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0];
  const K = DEFAULT_CUTS.length;  // 6

  // selIntervalIdx: one-sided interval assignment
  {
    console.log("--- selIntervalIdx (one-sided) ---");
    // p = 1 - Φ(y/se); se=1
    // y=2.0: p ≈ 0.0228 → j=0 (≤0.025)
    schk("j for y=2.0", selIntervalIdx(2.0, 1, DEFAULT_CUTS, 1), 0, 0);
    // y=1.7: p ≈ 0.0446 → j=1 (≤0.05)
    schk("j for y=1.7", selIntervalIdx(1.7, 1, DEFAULT_CUTS, 1), 1, 0);
    // y=1.2: p ≈ 0.115  → j=2 (≤0.25, but first is ≤0.10 → j=2? let's compute)
    // 1-Φ(1.2) ≈ 0.115 → ≤0.25 yes, but ≤0.10? no. So j=2 (cuts[2]=0.10 → still no; cuts[3]=0.25 → yes → j=3)
    // Actually: p≈0.115 > 0.10 → j=3 (≤0.25)
    schk("j for y=1.2", selIntervalIdx(1.2, 1, DEFAULT_CUTS, 1), 3, 0);
    // y=0.1: p = 1−Φ(0.1) ≈ 0.460 → j=4 (≤0.50, but not ≤0.25)
    schk("j for y=0.1", selIntervalIdx(0.1, 1, DEFAULT_CUTS, 1), 4, 0);
    // y=-1.0: p ≈ 0.84 → j=5 (≤1.0)
    schk("j for y=-1.0", selIntervalIdx(-1.0, 1, DEFAULT_CUTS, 1), 5, 0);
  }

  // selIntervalProbs: probabilities sum to 1
  {
    console.log("--- selIntervalProbs sums to 1 ---");
    const { normalQuantile: nq } = { normalQuantile };
    const zcuts = DEFAULT_CUTS.map(c => normalQuantile(1 - c));
    const cases = [
      { mu: 0,   totalVar: 1,    se: 1,   label: "mu=0, v=1, se=1" },
      { mu: 0.5, totalVar: 0.5,  se: 0.2, label: "mu=0.5, v=0.5, se=0.2" },
      { mu: -1,  totalVar: 2,    se: 0.5, label: "mu=-1, v=2, se=0.5" },
    ];
    for (const { mu, totalVar, se, label } of cases) {
      const probs = selIntervalProbs(mu, totalVar, se, zcuts, 1);
      const total = probs.reduce((a, b) => a + b, 0);
      schk(`sum (${label})`, total, 1, 1e-10);
    }
  }

  // selectionLogLik identity: all-zero alpha → equals −logLik
  {
    console.log("--- selectionLogLik identity (all-zero alpha = unweighted ML) ---");

    // Small synthetic dataset: yi, vi
    const studies = [
      { yi:  0.5, vi: 0.04 },
      { yi:  1.2, vi: 0.09 },
      { yi: -0.3, vi: 0.16 },
      { yi:  0.8, vi: 0.25 },
      { yi:  0.2, vi: 0.01 },
    ];
    const yi = studies.map(s => s.yi);
    const vi = studies.map(s => s.vi);

    // Test at two (mu, tau2) pairs
    const testPoints = [
      { mu: 0.5, tau2: 0.1 },
      { mu: 0.0, tau2: 0.5 },
    ];
    for (const { mu, tau2 } of testPoints) {
      const ll       = logLik(studies, mu, tau2);  // standard ML log-likelihood
      const params   = [mu, Math.log(tau2), ...new Array(K - 1).fill(0)];
      const negLL_sel = selectionLogLik(params, yi, vi, DEFAULT_CUTS, 1);
      schk(`negLL_sel vs −logLik (mu=${mu}, τ²=${tau2})`, negLL_sel, -ll, 1e-8);
    }
  }

  // selectionLogLik: finite and well-behaved under ML-optimal (mu, tau2) from meta()
  {
    console.log("--- selectionLogLik at ML optimum is finite ---");
    const studies = [
      { yi:  0.5, vi: 0.04 },
      { yi:  1.2, vi: 0.09 },
      { yi: -0.3, vi: 0.16 },
      { yi:  0.8, vi: 0.25 },
      { yi:  0.2, vi: 0.01 },
    ];
    const yi = studies.map(s => s.yi);
    const vi = studies.map(s => s.vi);
    const m   = meta(studies, "ML");
    const params = [m.RE, Math.log(Math.max(m.tau2, 1e-9)), ...new Array(K - 1).fill(0)];
    const negLL  = selectionLogLik(params, yi, vi, DEFAULT_CUTS, 1);
    schkTrue("negLL is finite",      isFinite(negLL));
    schkTrue("negLL is a number",    typeof negLL === "number");
  }

  // BFGS on selectionLogLik: with all-one weights (null model), BFGS should
  // recover a negLL ≤ the starting value and the result should be finite.
  {
    console.log("--- BFGS on selectionLogLik (all-zero alpha, optimise mu+tau2 only) ---");
    const studies = [
      { yi:  0.5, vi: 0.04 },
      { yi:  1.2, vi: 0.09 },
      { yi: -0.3, vi: 0.16 },
      { yi:  0.8, vi: 0.25 },
      { yi:  0.2, vi: 0.01 },
    ];
    const yi = studies.map(s => s.yi);
    const vi = studies.map(s => s.vi);
    // Fix alpha at 0; optimise only mu (x[0]) and rho (x[1])
    // so wrap to 2-param function
    const f2 = x => selectionLogLik([x[0], x[1], ...new Array(K - 1).fill(0)], yi, vi, DEFAULT_CUTS, 1);
    const m   = meta(studies, "ML");
    const x0  = [m.RE, Math.log(Math.max(m.tau2, 1e-9))];
    const r   = bfgs(f2, x0);

    // ML estimate of mu should be close to RE (they are the same)
    schk("mu at optimum", r.x[0], m.RE, 0.01);
    schkTrue("fval is finite",  isFinite(r.fval));
    schkTrue("fval ≤ f(start)", r.fval <= f2(x0) + 1e-6);
  }

  console.log(selPass ? "\n✅ ALL SELECTION MODEL TESTS PASSED" : "\n❌ SOME SELECTION MODEL TESTS FAILED");

  // ---- veveaHedges API tests (Steps 1-E, 1-F, 1-G) ----
  console.log("\n===== VEVEA-HEDGES MODEL TESTS (Steps 1-E/F/G) =====\n");
  let vhPass = true;
  const { chk: vhchk, chkTrue: vhchkTrue, chkExact: vhchkExact } = makeChk(() => { vhPass = false; });

  // Shared synthetic dataset: k=10, genuine heterogeneity (tau2 > 0),
  // studies spread across several p-value intervals.
  const vhStudies = [
    { yi:  0.20, vi: 0.04 },  // z=1.00, p≈0.16  → j=3
    { yi:  1.30, vi: 0.09 },  // z=4.33, p≈0     → j=0
    { yi: -0.10, vi: 0.06 },  // z=−0.41, p≈0.66 → j=5
    { yi:  0.90, vi: 0.16 },  // z=2.25, p≈0.012 → j=0
    { yi:  0.50, vi: 0.05 },  // z=2.24, p≈0.013 → j=0
    { yi:  1.60, vi: 0.12 },  // z=4.62, p≈0     → j=0
    { yi:  0.10, vi: 0.08 },  // z=0.35, p≈0.36  → j=4
    { yi:  0.80, vi: 0.20 },  // z=1.79, p≈0.037 → j=1
    { yi: -0.20, vi: 0.07 },  // z=−0.76, p≈0.78 → j=5
    { yi:  1.10, vi: 0.10 },  // z=3.48, p≈0.000 → j=0
  ];
  // Wide spread of yi values ensures tau2 > 0 and good Hessian conditioning

  // ---- 1. Basic sanity: structure, finite values, convergence ----
  {
    console.log("--- basic sanity: structure, finite values, convergence ---");
    const r = veveaHedges(vhStudies);

    vhchkTrue("converged",            r.converged);
    vhchkTrue("mu finite",            isFinite(r.mu));
    vhchkTrue("tau2 >= 0",            isFinite(r.tau2) && r.tau2 >= 0);
    // se_mu: should be finite and positive when Hessian is well-conditioned
    vhchkTrue("se_mu finite & > 0",   isFinite(r.se_mu) && r.se_mu > 0);
    // se_tau2: may be NaN if tau2→0 (boundary), but should be non-negative when finite
    vhchkTrue("se_tau2 ok",           !isFinite(r.se_tau2) || r.se_tau2 >= 0);
    vhchkTrue("LRT finite",           isFinite(r.LRT));
    vhchkTrue("LRTp in [0,1]",        isFinite(r.LRTp) && r.LRTp >= 0 && r.LRTp <= 1);
    vhchkExact("K = 6",               r.K, 6);
    vhchkExact("k = 10",              r.k, 10);
    vhchkExact("nPerInterval.length", r.nPerInterval.length, 6);
    vhchkExact("omega.length",        r.omega.length, 6);
    vhchkTrue("omega[0] = 1 (reference)", Math.abs(r.omega[0] - 1) < 1e-12);
    vhchkTrue("alpha[0] = 0 (reference)", Math.abs(r.alpha[0]) < 1e-12);
    vhchkTrue("nPerInterval sums to k",
      r.nPerInterval.reduce((a, b) => a + b, 0) === r.k);
  }

  // ---- 2. Unweighted limit: if study p-values are uniformly distributed,
  //         selection model should recover mu close to RE ----
  {
    console.log("--- unweighted limit: mu vs RE_unsel ----");
    const r = veveaHedges(vhStudies);

    // LRT df = nFree = 4 (interval j=2 has 0 studies and is excluded)
    vhchkExact("LRTdf = 4", r.LRTdf, 4);

    // logLikSel >= logLikUnsel (selection model is at least as good as null)
    vhchkTrue("logLikSel >= logLikUnsel", r.logLikSel >= r.logLikUnsel - 1e-6);

    // RE_unsel and ciLow/ciHigh_unsel should be finite and match meta(ML)
    const mML = meta(vhStudies, "ML");
    vhchk("RE_unsel = meta ML RE",    r.RE_unsel,    mML.RE,    0.001);
    vhchk("tau2_unsel = meta ML tau2", r.tau2_unsel, mML.tau2,  0.001);
  }

  // ---- 3. Asymmetric data: strong funnel asymmetry should produce LRT p < 0.05
  //         (many studies in low-p intervals, none in high-p) ----
  {
    console.log("--- asymmetric data: LRT should detect selection ----");
    // All studies are highly significant (p < 0.025), so omega for other
    // intervals should be estimated as very small relative to omega[0].
    const asymStudies = [
      { yi: 2.5, vi: 0.04 },
      { yi: 2.2, vi: 0.06 },
      { yi: 2.8, vi: 0.05 },
      { yi: 3.0, vi: 0.03 },
      { yi: 2.6, vi: 0.04 },
      { yi: 2.4, vi: 0.07 },
      { yi: 2.9, vi: 0.05 },
      { yi: 2.7, vi: 0.04 },
      { yi: 2.3, vi: 0.06 },
      { yi: 2.5, vi: 0.05 },
    ];
    const r = veveaHedges(asymStudies);
    vhchkTrue("converged (asymmetric)",        r.converged);
    vhchkTrue("LRT finite (asymmetric)",       isFinite(r.LRT));
    // All studies fall in j=0 (most significant interval)
    vhchkExact("all in interval 0", r.nPerInterval[0], 10);
  }

  // ---- 4. Symmetric near-null data: LRT should not detect selection ----
  {
    console.log("--- symmetric null data: LRT should not flag selection ----");
    const symStudies = [
      { yi:  0.10, vi: 0.25 },
      { yi: -0.05, vi: 0.30 },
      { yi:  0.20, vi: 0.20 },
      { yi: -0.15, vi: 0.35 },
      { yi:  0.08, vi: 0.28 },
      { yi: -0.20, vi: 0.22 },
      { yi:  0.15, vi: 0.32 },
      { yi: -0.10, vi: 0.18 },
      { yi:  0.05, vi: 0.26 },
      { yi: -0.12, vi: 0.24 },
    ];
    const r = veveaHedges(symStudies);
    vhchkTrue("converged (null)", r.converged);
    // LRT p-value should be non-significant (no reason to expect selective reporting)
    vhchkTrue("LRTp > 0.05 (no selection expected)", r.LRTp > 0.05);
  }

  // ---- 5. Insufficient k: returns error object without crashing ----
  {
    console.log("--- insufficient k: error return ---");
    // K=6 intervals → need k >= 8; use only 5 studies
    const tooFew = vhStudies.slice(0, 5);
    const r = veveaHedges(tooFew);
    vhchkExact("error = insufficient_k", r.error, "insufficient_k");
    vhchkTrue("mu is NaN",  !isFinite(r.mu));
    vhchkTrue("no crash",   true);
  }

  console.log(vhPass ? "\n✅ ALL VEVEA-HEDGES TESTS PASSED" : "\n❌ SOME VEVEA-HEDGES TESTS FAILED");

  // ---- VH_BENCHMARKS: regression against metafor::selmodel() output ----
  console.log("\n===== VH BENCHMARK TESTS (R blocks 45–47) =====\n");
  let vhBenchPass = true;
  const { chk: vbchk, chkTrue: vbchkTrue } = makeChk(() => { vhBenchPass = false; });

  VH_BENCHMARKS.forEach(bm => {
    console.log(`--- ${bm.name} ---`);
    const r = veveaHedges(bm.data, bm.cuts, bm.sides);

    const exp = bm.expected;

    // Primary estimates
    vbchk("mu",    r.mu,    exp.mu,    0.01);
    vbchk("tau2",  r.tau2,  exp.tau2,  Math.max(0.01, 0.05 * Math.abs(exp.tau2)));

    // Selection weights (omega); skip omega[0]=1 (reference, always exact)
    for (let j = 1; j < exp.omega.length; j++) {
      // Large weights (>10) tolerate 10% relative; smaller weights tolerate abs 0.05
      const tol = exp.omega[j] > 10
        ? 0.15 * exp.omega[j]
        : 0.05;
      vbchk(`omega[${j}]`, r.omega[j], exp.omega[j], tol);
    }

    // LRT
    vbchk("LRT",   r.LRT,   exp.LRT,   0.1);
    vbchkTrue("LRTdf", r.LRTdf === exp.LRTdf);
    vbchk("LRTp",  r.LRTp,  exp.LRTp,  0.02);

    // Log-likelihoods
    vbchk("ll_sel",   r.logLikSel,   exp.ll_sel,   0.05);
    vbchk("ll_unsel", r.logLikUnsel, exp.ll_unsel, 0.05);

    // Unweighted model
    vbchk("RE_unsel",    r.RE_unsel,    exp.RE_unsel,    0.01);
    vbchk("tau2_unsel",  r.tau2_unsel,  exp.tau2_unsel,  Math.max(0.01, 0.05 * Math.abs(exp.tau2_unsel)));

    // Convergence
    vbchkTrue(`converged`, r.converged);
  });

  console.log(vhBenchPass ? "\n✅ ALL VH BENCHMARK TESTS PASSED" : "\n❌ SOME VH BENCHMARK TESTS FAILED");

  // ---- SELECTION_PRESETS structure ----
  console.log("\n===== SELECTION PRESETS TESTS =====\n");
  let presetPass = true;
  const { chk: prchk, chkTrue: prchkTrue } = makeChk(() => { presetPass = false; });

  const EXPECTED_KEYS   = ["mild1", "moderate1", "severe1", "mild2", "moderate2"];
  const EXPECTED_OMEGA  = {
    mild1:     [1, 1, 0.75, 0.75, 0.5, 0.25],
    moderate1: [1, 0.9, 0.5, 0.3, 0.2, 0.1],
    severe1:   [1, 0.5, 0.1, 0.1, 0.05, 0.01],
    mild2:     [1, 1, 0.75, 0.75, 0.5, 0.25],
    moderate2: [1, 0.9, 0.5, 0.3, 0.2, 0.1],
  };
  const EXPECTED_SIDES  = { mild1: 1, moderate1: 1, severe1: 1, mild2: 2, moderate2: 2 };
  const STD_CUTS = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0];

  prchkTrue("SELECTION_PRESETS is an object",
    typeof SELECTION_PRESETS === "object" && SELECTION_PRESETS !== null);
  prchkTrue("has exactly 5 keys",
    Object.keys(SELECTION_PRESETS).length === 5);

  for (const key of EXPECTED_KEYS) {
    const p = SELECTION_PRESETS[key];
    prchkTrue(`${key} exists`, p != null);
    if (!p) continue;

    prchkTrue(`${key}.label is non-empty string`,
      typeof p.label === "string" && p.label.length > 0);
    prchkTrue(`${key}.sides = ${EXPECTED_SIDES[key]}`, p.sides === EXPECTED_SIDES[key]);
    prchkTrue(`${key}.cuts has 6 entries`, Array.isArray(p.cuts) && p.cuts.length === 6);
    prchkTrue(`${key}.cuts last = 1.0`, p.cuts[p.cuts.length - 1] === 1.0);
    prchkTrue(`${key}.cuts matches standard`,
      p.cuts.every((c, i) => Math.abs(c - STD_CUTS[i]) < 1e-12));
    prchkTrue(`${key}.omega has 6 entries`, Array.isArray(p.omega) && p.omega.length === 6);
    prchkTrue(`${key}.omega[0] = 1 (reference)`, p.omega[0] === 1);
    prchkTrue(`${key}.omega matches expected`,
      p.omega.every((w, i) => Math.abs(w - EXPECTED_OMEGA[key][i]) < 1e-12));
    prchkTrue(`${key}.omega all positive`, p.omega.every(w => w > 0));
    prchkTrue(`${key}.omega[0] ≥ all others`,
      p.omega.slice(1).every(w => w <= p.omega[0] + 1e-12));
  }

  // Mild and moderate presets share the same omega across sides
  prchkTrue("mild1.omega equals mild2.omega",
    SELECTION_PRESETS.mild1.omega.every((w, i) => w === SELECTION_PRESETS.mild2.omega[i]));
  prchkTrue("moderate1.omega equals moderate2.omega",
    SELECTION_PRESETS.moderate1.omega.every((w, i) => w === SELECTION_PRESETS.moderate2.omega[i]));

  console.log(presetPass ? "\n✅ ALL SELECTION PRESET TESTS PASSED" : "\n❌ SOME SELECTION PRESET TESTS FAILED");

  // ---- GOSH computation tests ----
  console.log("\n===== GOSH COMPUTATION TESTS =====\n");
  let goshPass = true;
  const { chk: gchk, chkTrue: gchkTrue, chkExact: gchkExact } = makeChk(() => { goshPass = false; });

  // ---- 1. Error cases ----
  {
    console.log("--- error cases ---");
    const e1 = goshCompute([1], [1]);
    gchkTrue("k=1 returns error", typeof e1.error === "string");

    const e2 = goshCompute(new Array(31).fill(0), new Array(31).fill(1));
    gchkTrue("k=31 returns error", typeof e2.error === "string");

    const e3 = goshCompute([0, 1, 2], [1, 1]);
    gchkTrue("mismatched lengths returns error", typeof e3.error === "string");
  }

  // ---- 2. k=3 hand-verified: all 7 subsets ----
  // yi=[0, 1, 2], vi=[1, 1, 1], wi=[1,1,1]
  // Single-pass Q = Σwi*yi² − (Σwi*yi)²/Σwi
  //
  // mask 1 {0}:     mu=0,   Q=0,   n=1, I2=0
  // mask 2 {1}:     mu=1,   Q=0,   n=1, I2=0
  // mask 3 {0,1}:   mu=0.5, Q=0.5, n=2, I2=0   (Q<df=1: I2=0)
  // mask 4 {2}:     mu=2,   Q=0,   n=1, I2=0
  // mask 5 {0,2}:   mu=1,   Q=2,   n=2, I2=50
  // mask 6 {1,2}:   mu=1.5, Q=0.5, n=2, I2=0
  // mask 7 {0,1,2}: mu=1,   Q=2,   n=3, I2=0   (Q=df=2: I2=0)
  {
    console.log("--- k=3 exact values (all 7 subsets) ---");
    const r = goshCompute([0, 1, 2], [1, 1, 1]);
    gchkExact("count = 7",    r.count, 7);
    gchkTrue ("sampled=false", r.sampled === false);
    gchkExact("k = 3",        r.k, 3);

    // mu
    gchk("mu[0] {0}",     r.mu[0], 0,   1e-12);
    gchk("mu[1] {1}",     r.mu[1], 1,   1e-12);
    gchk("mu[2] {0,1}",   r.mu[2], 0.5, 1e-12);
    gchk("mu[3] {2}",     r.mu[3], 2,   1e-12);
    gchk("mu[4] {0,2}",   r.mu[4], 1,   1e-12);
    gchk("mu[5] {1,2}",   r.mu[5], 1.5, 1e-12);
    gchk("mu[6] {0,1,2}", r.mu[6], 1,   1e-12);

    // I²
    gchk("I2[0]", r.I2[0], 0,  1e-12);
    gchk("I2[1]", r.I2[1], 0,  1e-12);
    gchk("I2[2]", r.I2[2], 0,  1e-12);   // Q=0.5 < df=1 → 0
    gchk("I2[3]", r.I2[3], 0,  1e-12);
    gchk("I2[4]", r.I2[4], 50, 1e-10);   // (Q−df)/Q = (2−1)/2 = 50%
    gchk("I2[5]", r.I2[5], 0,  1e-12);
    gchk("I2[6]", r.I2[6], 0,  1e-12);   // Q=df=2 → exactly 0

    // Q
    gchk("Q[2] {0,1}",   r.Q[2], 0.5, 1e-12);
    gchk("Q[4] {0,2}",   r.Q[4], 2,   1e-12);
    gchk("Q[6] {0,1,2}", r.Q[6], 2,   1e-12);

    // n (subset sizes)
    gchkExact("n[0]", r.n[0], 1);
    gchkExact("n[1]", r.n[1], 1);
    gchkExact("n[2]", r.n[2], 2);
    gchkExact("n[3]", r.n[3], 1);
    gchkExact("n[4]", r.n[4], 2);
    gchkExact("n[5]", r.n[5], 2);
    gchkExact("n[6]", r.n[6], 3);
  }

  // ---- 3. n[mask−1] = popcount(mask) for k=4 (all 15 subsets) ----
  {
    console.log("--- n matches popcount for k=4 ---");
    const popcount = m => { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; };
    const r = goshCompute([0.1, 0.5, 0.9, 1.3], [0.04, 0.09, 0.04, 0.16]);
    gchkExact("count = 15", r.count, 15);
    let nOk = true;
    for (let mask = 1; mask <= 15; mask++) {
      if (r.n[mask - 1] !== popcount(mask)) { nOk = false; break; }
    }
    gchkTrue("n[mask−1] = popcount(mask) for all 15 subsets", nOk);
  }

  // ---- 4. Full-dataset entry matches meta("FE") ----
  {
    console.log("--- full-dataset entry consistent with meta() FE ---");
    const studies = [
      { yi: 0.2, vi: 0.04 },
      { yi: 0.6, vi: 0.09 },
      { yi: 1.0, vi: 0.16 },
      { yi: 0.4, vi: 0.01 },
      { yi: 0.8, vi: 0.25 },
    ];
    const yiArr = studies.map(s => s.yi);
    const viArr = studies.map(s => s.vi);
    const r   = goshCompute(yiArr, viArr);
    const mFE = meta(studies, "FE");
    // Full-dataset: last index = 2^k−2 (mask = 2^k−1)
    const last = r.count - 1;
    // mu is Float32Array: tolerance 1e-5 (Float32 unit of least precision ≈ 6e-8 × value,
    // so ~2.5e-8 for values near 0.44; 1e-5 gives comfortable margin).
    gchk("mu[last] ≈ FE",  r.mu[last], mFE.FE,  1e-5);
    gchk("Q[last] ≈ FE Q", r.Q[last],  mFE.Q,   1e-10);  // Q is Float64Array
    gchkExact("n[last] = k", r.n[last], studies.length);
  }

  // ---- 5. I² range and mu finiteness for k=6 (all 63 subsets) ----
  {
    console.log("--- I2 in [0,100] and mu finite for k=6 ---");
    const r = goshCompute(
      [0.1, 0.3, 0.6, 0.9, 1.2, 0.5],
      [0.04, 0.09, 0.04, 0.16, 0.09, 0.01]
    );
    gchkExact("count = 63", r.count, 63);
    gchkTrue("all I2 in [0,100]", Array.from(r.I2).every(v => v >= 0 && v <= 100));
    gchkTrue("all mu finite",     Array.from(r.mu).every(v => isFinite(v)));
    gchkTrue("all Q >= 0",        Array.from(r.Q).every(v => v >= 0));
    gchkTrue("all n in [1,6]",    Array.from(r.n).every(v => v >= 1 && v <= 6));
    // Single-study subsets (n=1) must have I2=0 and Q=0
    const singleIdx = [];
    for (let mask = 1; mask <= 63; mask++) {
      if ((mask & (mask - 1)) === 0) singleIdx.push(mask - 1);  // power of 2 → single study
    }
    gchkTrue("I2=0 for n=1 subsets", singleIdx.every(i => r.I2[i] === 0));
    gchkTrue("Q=0 for n=1 subsets",  singleIdx.every(i => r.Q[i]  === 0));
  }

  // ---- 6. I² formula: known high-heterogeneity pair ----
  // yi=[0, 2], vi=[1, 1]: W=2, Wmu=2, Wmu2=4, Q=4−4/2=2, I2=(2−1)/2·100=50%
  {
    console.log("--- I2 formula: high-heterogeneity pair ---");
    const r = goshCompute([0, 2], [1, 1]);
    // mask 3 = {0,1} = full set, stored at index 2 (mask−1=2)
    gchk("mu full pair", r.mu[2], 1,  1e-12);
    gchk("Q full pair",  r.Q[2],  2,  1e-12);
    gchk("I2 full pair", r.I2[2], 50, 1e-10);
  }

  // ---- 7a. min(2^k−1, maxSubsets): enumeration path ignores maxSubsets ----
  // For k ≤ 20 the sampled flag is false, so count = 2^k−1 regardless of maxSubsets.
  // This verifies the min() does not accidentally cap enumerated results.
  {
    console.log("--- min(2^k-1, maxSubsets): enum path ignores maxSubsets ---");
    const r = goshCompute([0, 1, 2], [1, 1, 1], { maxSubsets: 1000 });
    gchkExact("count = 7 (not 1000)",  r.count,   7);
    gchkTrue ("sampled=false",         r.sampled === false);
    // mu/I2 identical to the default run (seed/opts don't affect enumeration)
    gchk("mu[4] same as default run",  r.mu[4], 1,  1e-12);
    gchk("I2[4] same as default run",  r.I2[4], 50, 1e-10);
  }

  // ---- 7. Sampling boundary: k=15 enumerates, k=16 samples ----
  {
    console.log("--- sampling boundary: k=15 enumerates (2^15-1=32767), k=16 samples ---");
    const yi15 = Array.from({ length: 15 }, (_, i) => i * 0.05);
    const vi15 = Array.from({ length: 15 }, ()    => 0.04);
    const r15  = goshCompute(yi15, vi15);
    gchkExact("k=15 count = 32767",  r15.count,   32767);
    gchkTrue ("k=15 sampled=false",  r15.sampled === false);

    const yi16 = Array.from({ length: 16 }, (_, i) => i * 0.05);
    const vi16 = Array.from({ length: 16 }, ()    => 0.04);
    const r16  = goshCompute(yi16, vi16, { maxSubsets: 200, seed: 7 });
    gchkTrue ("k=16 sampled=true",   r16.sampled === true);
    gchkExact("k=16 count = 200",    r16.count,   200);
    gchkExact("k=16 k field",        r16.k,       16);
    gchkTrue ("k=16 all I2 ∈[0,100]", Array.from(r16.I2).every(v => v >= 0 && v <= 100));
  }

  // ---- 8 (was 7). Sampling: k=21, count=maxSubsets, sampled=true ----
  {
    console.log("--- sampling: k=21 ---");
    const k21 = 21;
    const yi21 = new Array(k21).fill(0).map((_, i) => i * 0.05);
    const vi21 = new Array(k21).fill(0).map(() => 0.04 + Math.random() * 0.06);
    const r = goshCompute(yi21, vi21, { maxSubsets: 500, seed: 42 });
    gchkTrue ("sampled=true",      r.sampled === true);
    gchkExact("count=500",         r.count, 500);
    gchkExact("k=21",              r.k, 21);
    gchkTrue ("all I2 in [0,100]", Array.from(r.I2).every(v => v >= 0 && v <= 100));
    gchkTrue ("all mu finite",     Array.from(r.mu).every(v => isFinite(v)));
    // Expected subset size ≈ k/2 = 10.5; check mean is in [8, 13]
    const meanN = Array.from(r.n).reduce((a, b) => a + b, 0) / r.count;
    gchkTrue("mean n ≈ k/2", meanN >= 8 && meanN <= 13);
  }

  // ---- 8. Sampling reproducibility (same seed → identical results) ----
  {
    console.log("--- sampling reproducibility ---");
    const yi8 = [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5,
                 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6,
                 0.15, 0.35, 0.55, 0.75, 0.95];
    const vi8 = yi8.map(() => 0.04);
    const r1 = goshCompute(yi8, vi8, { maxSubsets: 200, seed: 99 });
    const r2 = goshCompute(yi8, vi8, { maxSubsets: 200, seed: 99 });
    const r3 = goshCompute(yi8, vi8, { maxSubsets: 200, seed: 77 });
    gchkTrue("same seed → same mu[0]",       r1.mu[0] === r2.mu[0]);
    gchkTrue("same seed → same mu[99]",      r1.mu[99] === r2.mu[99]);
    gchkTrue("different seed → different mu[0]", r1.mu[0] !== r3.mu[0]);
  }

  // ---- 9. Constants are exported and sane ----
  {
    console.log("--- exported constants ---");
    gchkExact("GOSH_MAX_ENUM_K = 15",          GOSH_MAX_ENUM_K, 15);
    gchkExact("GOSH_MAX_K = 30",               GOSH_MAX_K, 30);
    gchkExact("GOSH_DEFAULT_MAX_SUBSETS = 50000", GOSH_DEFAULT_MAX_SUBSETS, 50_000);
    gchkTrue ("GOSH_MAX_ENUM_K < GOSH_MAX_K",  GOSH_MAX_ENUM_K < GOSH_MAX_K);
  }

  console.log(goshPass ? "\n✅ ALL GOSH TESTS PASSED" : "\n❌ SOME GOSH TESTS FAILED");

  // ===========================================================================
  // PROFILE LIKELIHOOD τ² TESTS
  // ===========================================================================
  console.log("\n===== PROFILE LIKELIHOOD τ² TESTS =====\n");
  let plPass = true;
  const { chk: plChk, chkTrue: plChkTrue, chkExact: plChkExact } = makeChk(() => { plPass = false; });

  // Shared datasets
  // studiesPL: heterogeneous, k=4
  const studiesPL = [
    { yi: 0.1, vi: 0.04 },
    { yi: 0.5, vi: 0.09 },
    { yi: 0.9, vi: 0.04 },
    { yi: 1.3, vi: 0.16 },
  ];
  // studiesHom: all yi equal → τ²_hat = 0
  const studiesHom = [
    { yi: 0.5, vi: 0.04 },
    { yi: 0.5, vi: 0.09 },
    { yi: 0.5, vi: 0.04 },
    { yi: 0.5, vi: 0.16 },
  ];
  // studiesK2: k=2 edge case
  const studiesK2 = [
    { yi: 0.2, vi: 0.05 },
    { yi: 0.8, vi: 0.10 },
  ];

  // ---- 1. Peak of shifted curve is at 0 ----
  {
    console.log("--- 1. peak at 0 ---");
    const r = profileLikTau2(studiesPL, { method: "ML", nGrid: 200 });
    plChkTrue("no error",             !r.error);
    plChkTrue("all ll ≤ 1e-9",        Array.from(r.ll).every(v => v <= 1e-9));
    plChkTrue("ll[0] ≤ 0",            r.ll[0] <= 0);
    // Grid point nearest tau2hat should be within ~1e-3 of 0 (grid step ≈ hi/199)
    const step = r.grid[1] - r.grid[0];
    const nearPeak = Math.round(r.tau2hat / step);
    const idx = Math.min(Math.max(nearPeak, 0), r.ll.length - 1);
    plChkTrue("ll near tau2hat ≈ 0",  Math.abs(r.ll[idx]) < 0.05);
  }

  // ---- 2. Curve is non-increasing away from peak (unimodal) ----
  {
    console.log("--- 2. unimodal ---");
    const r = profileLikTau2(studiesPL, { method: "REML", nGrid: 200 });
    // Find argmax on grid
    let peak = 0;
    for (let i = 1; i < r.ll.length; i++) if (r.ll[i] > r.ll[peak]) peak = i;
    // Left side: ll should be non-decreasing toward peak (allow 1e-10 float noise)
    let monoViolL = 0;
    for (let i = 1; i <= peak; i++) if (r.ll[i] < r.ll[i-1] - 1e-10) monoViolL++;
    // Right side: ll should be non-increasing from peak
    let monoViolR = 0;
    for (let i = peak+1; i < r.ll.length; i++) if (r.ll[i] > r.ll[i-1] + 1e-10) monoViolR++;
    plChkExact("no violations left of peak",  monoViolL, 0);
    plChkExact("no violations right of peak", monoViolR, 0);
  }

  // ---- 3. CI bounds satisfy LR criterion ----
  {
    console.log("--- 3. CI bounds satisfy LR criterion ---");
    // Use REML (ciLow > 0 for this dataset, so both bounds are interior)
    const r = profileLikTau2(studiesPL, { method: "REML", nGrid: 200 });
    plChkTrue("ciLow > 0 (REML, heterogeneous)", r.ciLow > 0);
    // Evaluate the REML profile at each bound; should equal lCritRel within 1e-9
    function evalREML(t) {
      let W = 0, Wmu = 0;
      for (const d of studiesPL) { const w = 1 / (d.vi + t); W += w; Wmu += w * d.yi; }
      const mu = Wmu / W;
      let ll = 0;
      for (const d of studiesPL) { const w = 1 / (d.vi + t); ll -= 0.5 * (Math.log(d.vi + t) + w * (d.yi - mu) ** 2); }
      ll -= 0.5 * Math.log(W);
      return ll - r.lMax;
    }
    plChkTrue("ll(ciLow)  ≈ lCritRel",  Math.abs(evalREML(r.ciLow)  - r.lCritRel) < 1e-9);
    plChkTrue("ll(ciHigh) ≈ lCritRel",  Math.abs(evalREML(r.ciHigh) - r.lCritRel) < 1e-9);
    // ciLow < tau2hat < ciHigh
    plChkTrue("ciLow < tau2hat",  r.ciLow  < r.tau2hat);
    plChkTrue("tau2hat < ciHigh", r.tau2hat < r.ciHigh);
  }

  // ---- 4. Homogeneous data: ciLow = 0, tau2hat = 0 ----
  {
    console.log("--- 4. homogeneous data ---");
    const r = profileLikTau2(studiesHom, { method: "REML", nGrid: 200 });
    plChkTrue("no error",       !r.error);
    plChkTrue("tau2hat = 0",    r.tau2hat === 0);
    plChkExact("ciLow = 0",     r.ciLow,  0);
    plChkTrue("ciHigh > 0",     r.ciHigh  > 0);
  }

  // ---- 5. Grid covers CI ----
  {
    console.log("--- 5. grid covers CI ---");
    const r = profileLikTau2(studiesPL, { method: "ML", nGrid: 200 });
    plChkExact("grid[0] = 0",         r.grid[0], 0);
    plChkTrue ("grid[last] > ciHigh", r.grid[r.grid.length - 1] > r.ciHigh);
    plChkExact("grid length = nGrid", r.ll.length, 200);
  }

  // ---- 6. Non-ML/REML method returns error ----
  {
    console.log("--- 6. unsupported method returns error ---");
    const eDL = profileLikTau2(studiesPL, { method: "DL" });
    plChkTrue("DL → error",  !!eDL.error);
    const ePM = profileLikTau2(studiesPL, { method: "PM" });
    plChkTrue("PM → error",  !!ePM.error);
    const eHS = profileLikTau2(studiesPL, { method: "HS" });
    plChkTrue("HS → error",  !!eHS.error);
  }

  // ---- 7. REML result differs from ML ----
  {
    console.log("--- 7. REML vs ML ---");
    const rML   = profileLikTau2(studiesPL, { method: "ML"   });
    const rREML = profileLikTau2(studiesPL, { method: "REML" });
    plChkTrue("REML tau2hat > ML tau2hat", rREML.tau2hat > rML.tau2hat);
    plChkExact("ML method field",   rML.method,   "ML");
    plChkExact("REML method field", rREML.method, "REML");
  }

  // ---- 8. k = 2 edge case ----
  {
    console.log("--- 8. k=2 ---");
    const r = profileLikTau2(studiesK2, { method: "REML", nGrid: 100 });
    plChkTrue ("no error",           !r.error);
    plChkExact("k = 2",              r.k, 2);
    plChkTrue ("tau2hat finite",     isFinite(r.tau2hat));
    plChkTrue ("ciHigh finite",      isFinite(r.ciHigh));
    plChkTrue ("grid length = 100",  r.ll.length === 100);
    plChkTrue ("all ll ≤ 1e-9",      Array.from(r.ll).every(v => v <= 1e-9));
  }

  // ---- 9. k < 2 returns error ----
  {
    console.log("--- 9. k<2 returns error ---");
    const e1 = profileLikTau2([{ yi: 0, vi: 1 }]);
    plChkTrue("k=1 → error", !!e1.error);
    const e0 = profileLikTau2([]);
    plChkTrue("k=0 → error", !!e0.error);
  }

  // ---- 10. Cross-check: tau2hat matches tau2_ML directly ----
  {
    console.log("--- 10. cross-check vs tau2_ML / profileLikCI ---");
    const rML = profileLikTau2(studiesPL, { method: "ML" });
    // tau2hat from profileLikTau2 should equal tau2_ML(studies) within float noise
    plChk("tau2hat = tau2_ML", rML.tau2hat, tau2_ML(studiesPL), 1e-10);
    // profileLikCI gives the mu CI; both functions use the same likelihood so
    // the mu CI should be finite for this dataset
    const muCI = profileLikCI(studiesPL);
    plChkTrue("profileLikCI lower finite", isFinite(muCI[0]));
    plChkTrue("profileLikCI upper finite", isFinite(muCI[1]));
    // tau2hat > 0 for clearly heterogeneous data
    plChkTrue("tau2hat > 0 (heterogeneous)", rML.tau2hat > 0);
    // lCritRel ≈ −χ²(0.95,1)/2 ≈ −1.9207
    plChk("lCritRel ≈ -1.9207", rML.lCritRel, -1.9207294103470494, 1e-10);
  }

  console.log(plPass ? "\n✅ ALL PROFILE LIKELIHOOD τ² TESTS PASSED" : "\n❌ SOME PROFILE LIKELIHOOD τ² TESTS FAILED");

  // ===========================================================================
  // BAYESIAN META-ANALYSIS TESTS
  // ===========================================================================
  console.log("\n===== BAYESIAN META-ANALYSIS TESTS =====\n");
  let bayPass = true;
  const { chk: bayChk, chkTrue: bayChkTrue, chkExact: bayChkExact } = makeChk(() => { bayPass = false; });

  // BCG vaccine data (BENCHMARKS[0]) — heterogeneous, k=13
  const studiesBCG = [
    { yi: -0.8893113339202054, vi: 0.3255847650039614  },
    { yi: -1.5853886572014306, vi: 0.19458112139814387 },
    { yi: -1.348073148299693,  vi: 0.41536796536796533 },
    { yi: -1.4415511900213054, vi: 0.020010031902247573 },
    { yi: -0.2175473222112957, vi: 0.05121017216963086 },
    { yi: -0.786115585818864,  vi: 0.0069056184559087574 },
    { yi: -1.6208982235983924, vi: 0.22301724757231517 },
    { yi:  0.011952333523841173, vi: 0.00396157929781773 },
    { yi: -0.4694176487381487, vi: 0.056434210463248966 },
    { yi: -1.3713448034727846, vi: 0.07302479361302891 },
    { yi: -0.33935882833839015, vi: 0.01241221397155972 },
    { yi:  0.4459134005713783, vi: 0.5325058452001528  },
    { yi: -0.017313948216879493, vi: 0.0714046596839863 },
  ];
  // Homogeneous data — all yi equal → posterior should concentrate τ near 0
  const studiesHom4 = [
    { yi: 0.5, vi: 0.04 },
    { yi: 0.5, vi: 0.04 },
    { yi: 0.5, vi: 0.04 },
    { yi: 0.5, vi: 0.04 },
  ];

  // ---- 1. Error guard: k < 2 ----
  {
    console.log("--- 1. error guard k < 2 ---");
    const r = bayesMeta([{ yi: 0, vi: 1 }]);
    bayChkTrue("returns error object", !!r.error);
  }

  // ---- 2. Error guard: sigma_mu ≤ 0 ----
  {
    console.log("--- 2. error guard sigma_mu ≤ 0 ---");
    const r = bayesMeta(studiesBCG, { sigma_mu: 0 });
    bayChkTrue("returns error object", !!r.error);
  }

  // ---- 3. Error guard: sigma_tau ≤ 0 ----
  {
    console.log("--- 3. error guard sigma_tau ≤ 0 ---");
    const r = bayesMeta(studiesBCG, { sigma_tau: -1 });
    bayChkTrue("returns error object", !!r.error);
  }

  // ---- 4. Return fields present and finite ----
  {
    console.log("--- 4. return fields present and finite ---");
    const r = bayesMeta(studiesBCG);
    bayChkTrue("no error",           !r.error);
    bayChkTrue("muMean finite",      isFinite(r.muMean));
    bayChkTrue("muSD finite",        isFinite(r.muSD));
    bayChkTrue("muCI[0] finite",     isFinite(r.muCI[0]));
    bayChkTrue("muCI[1] finite",     isFinite(r.muCI[1]));
    bayChkTrue("tauMean finite",     isFinite(r.tauMean));
    bayChkTrue("tauSD finite",       isFinite(r.tauSD));
    bayChkTrue("tauCI[0] finite",    isFinite(r.tauCI[0]));
    bayChkTrue("tauCI[1] finite",    isFinite(r.tauCI[1]));
    bayChkTrue("tauGrid present",    r.tauGrid instanceof Float64Array && r.tauGrid.length > 0);
    bayChkTrue("tauWeights present", r.tauWeights instanceof Float64Array && r.tauWeights.length > 0);
    bayChkTrue("muGrid present",     r.muGrid instanceof Float64Array && r.muGrid.length > 0);
    bayChkTrue("muDensity present",  r.muDensity instanceof Float64Array && r.muDensity.length > 0);
    bayChkExact("k correct",         r.k, 13);
  }

  // ---- 5. μ CI ordering: muCI[0] < muMean < muCI[1] ----
  {
    console.log("--- 5. muCI ordering ---");
    const r = bayesMeta(studiesBCG);
    bayChkTrue("muCI[0] < muMean", r.muCI[0] < r.muMean);
    bayChkTrue("muMean < muCI[1]", r.muMean < r.muCI[1]);
  }

  // ---- 6. τ CI ordering and non-negativity ----
  {
    console.log("--- 6. tauCI ordering and non-negativity ---");
    const r = bayesMeta(studiesBCG);
    bayChkTrue("tauCI[0] >= 0",            r.tauCI[0] >= 0);
    bayChkTrue("tauCI[0] <= tauMean",      r.tauCI[0] <= r.tauMean);
    bayChkTrue("tauMean <= tauCI[1]",      r.tauMean  <= r.tauCI[1]);
  }

  // ---- 7. Diffuse prior → muMean ≈ RE estimate (within 0.05) ----
  {
    console.log("--- 7. diffuse prior converges to RE ---");
    // REML RE for BCG ≈ -0.714 (from BENCHMARKS)
    const reDL = meta(studiesBCG, "REML").RE;
    const r    = bayesMeta(studiesBCG, { mu0: 0, sigma_mu: 100, sigma_tau: 100 });
    bayChkTrue("no error", !r.error);
    bayChk("muMean ≈ REML RE (diffuse prior)", r.muMean, reDL, 0.05);
  }

  // ---- 8. Tight prior pulls muMean toward μ₀ ----
  {
    console.log("--- 8. tight prior shrinks toward mu0 ---");
    // BCG muMean with default prior ≈ -0.688; with mu0=0, sigma_mu=0.01 it should be >> -0.688
    const rDefault = bayesMeta(studiesBCG);
    const rTight   = bayesMeta(studiesBCG, { mu0: 0, sigma_mu: 0.01, sigma_tau: 0.5 });
    bayChkTrue("tight prior pulls muMean closer to 0", Math.abs(rTight.muMean) < Math.abs(rDefault.muMean));
  }

  // ---- 9. Homogeneous data → tauMean < 0.3 ----
  {
    console.log("--- 9. homogeneous data: tauMean near 0 ---");
    const r = bayesMeta(studiesHom4);
    bayChkTrue("no error",         !r.error);
    bayChkTrue("tauMean < 0.3",    r.tauMean < 0.3);
    bayChkTrue("tauCI[0] < 0.1",   r.tauCI[0] < 0.1);
  }

  // ---- 10. muDensity integrates to ≈ 1 (trapezoidal rule) ----
  {
    console.log("--- 10. muDensity integrates to ≈ 1 ---");
    const r  = bayesMeta(studiesBCG);
    const nMu = r.muGrid.length;
    const dMu = r.muGrid[1] - r.muGrid[0];
    let integral = 0;
    for (let j = 0; j < nMu; j++) {
      integral += r.muDensity[j] * (j === 0 || j === nMu - 1 ? 0.5 : 1);
    }
    integral *= dMu;
    bayChk("muDensity integral ≈ 1", integral, 1, 0.01);
  }

  // ---- 11. tauWeights sum to ≈ 1 ----
  {
    console.log("--- 11. tauWeights sum to 1 ---");
    const r   = bayesMeta(studiesBCG);
    const sum = r.tauWeights.reduce((s, v) => s + v, 0);
    bayChk("sum of tauWeights", sum, 1, 1e-10);
  }

  // ---- 12. grid_truncated is false for BCG with default priors ----
  {
    console.log("--- 12. grid_truncated false for BCG default priors ---");
    const r = bayesMeta(studiesBCG);
    bayChkTrue("grid_truncated === false", r.grid_truncated === false);
  }

  // ---- 13. k=2 edge case runs without error ----
  {
    console.log("--- 13. k=2 edge case ---");
    const r = bayesMeta([{ yi: 0.2, vi: 0.05 }, { yi: 0.8, vi: 0.10 }]);
    bayChkTrue("no error",       !r.error);
    bayChkTrue("muMean finite",  isFinite(r.muMean));
    bayChkTrue("tauMean finite", isFinite(r.tauMean));
    bayChkTrue("muCI[0] < muCI[1]", r.muCI[0] < r.muCI[1]);
    bayChkTrue("tauCI[0] < tauCI[1]", r.tauCI[0] < r.tauCI[1]);
  }

  // ---- 14. Adaptive grid: minimum coarse grid (nGrid=100, nMu=200) vs fine
  //          grid (nGrid=300, nMu=500) on BCG data.
  //          muCI accurate to 0.005; tauCI accurate to 0.02
  //          (coarser τ step → larger interpolation error on spread posteriors). ----
  {
    console.log("--- 14. adaptive grid accuracy vs fine grid (BCG) ---");
    const rFine   = bayesMeta(studiesBCG, { nGrid: 300, nMu: 500 });
    const rCoarse = bayesMeta(studiesBCG, { nGrid: 100, nMu: 200 });
    bayChk("muCI[0]  coarse vs fine", rCoarse.muCI[0],  rFine.muCI[0],  0.005);
    bayChk("muCI[1]  coarse vs fine", rCoarse.muCI[1],  rFine.muCI[1],  0.005);
    bayChk("tauCI[0] coarse vs fine", rCoarse.tauCI[0], rFine.tauCI[0], 0.02);
    bayChk("tauCI[1] coarse vs fine", rCoarse.tauCI[1], rFine.tauCI[1], 0.02);
  }

  // ---- 15. Adaptive grid sizes are correct for different k ----
  {
    console.log("--- 15. adaptive grid sizes by k ---");
    // k=13 (BCG): 4500/13≈346 → clamped to 300; 100000/13≈7692 → clamped to 500
    const rBCG = bayesMeta(studiesBCG);
    bayChkExact("BCG (k=13) tauGrid.length = 300", rBCG.tauGrid.length, 300);
    bayChkExact("BCG (k=13) muGrid.length  = 500", rBCG.muGrid.length,  500);

    // k=50: 4500/50=90 → max(100,90)=100; 100000/50=2000 → min(500,2000)=500
    const studies50 = Array.from({ length: 50 }, (_, i) => ({
      yi: i % 2 === 0 ? 0.3 : -0.1,
      vi: 0.04 + (i % 5) * 0.01,
    }));
    const r50 = bayesMeta(studies50);
    bayChkExact("k=50 tauGrid.length = 100", r50.tauGrid.length, 100);
    bayChkExact("k=50 muGrid.length  = 500", r50.muGrid.length,  500);

    // Adaptive k=50 vs explicit fine grid: muCI and tauCI match within 0.005
    const r50fine = bayesMeta(studies50, { nGrid: 300, nMu: 500 });
    bayChk("k=50 adaptive muCI[0]  vs fine", r50.muCI[0],  r50fine.muCI[0],  0.005);
    bayChk("k=50 adaptive muCI[1]  vs fine", r50.muCI[1],  r50fine.muCI[1],  0.005);
    bayChk("k=50 adaptive tauCI[0] vs fine", r50.tauCI[0], r50fine.tauCI[0], 0.005);
    bayChk("k=50 adaptive tauCI[1] vs fine", r50.tauCI[1], r50fine.tauCI[1], 0.005);
  }

  // ---- 16. BF fields present and finite ----
  {
    console.log("--- 16. BF fields present and finite ---");
    const r = bayesMeta(studiesBCG);
    bayChkTrue("BF10 finite",    isFinite(r.BF10));
    bayChkTrue("BF01 finite",    isFinite(r.BF01));
    bayChkTrue("logBF10 finite", isFinite(r.logBF10));
    bayChkTrue("BF10 > 0",       r.BF10 > 0);
    bayChkTrue("BF01 > 0",       r.BF01 > 0);
  }

  // ---- 17. BF10 * BF01 ≈ 1 ----
  {
    console.log("--- 17. BF10 * BF01 ≈ 1 ---");
    const r = bayesMeta(studiesBCG);
    bayChk("BF10 * BF01", r.BF10 * r.BF01, 1, 1e-10);
  }

  // ---- 18. logBF10 = log(BF10) ----
  {
    console.log("--- 18. logBF10 = log(BF10) ---");
    const r = bayesMeta(studiesBCG);
    bayChk("logBF10 = log(BF10)", r.logBF10, Math.log(r.BF10), 1e-10);
  }

  // ---- 19. BCG data: clear negative effect → BF10 > 3 (moderate evidence) ----
  {
    console.log("--- 19. BCG clear effect → BF10 > 3 ---");
    // BCG data has strong negative effect (log OR ≈ -0.7); prior N(0,1)
    // Posterior concentrates away from 0 → BF10 should exceed 3
    const r = bayesMeta(studiesBCG, { mu0: 0, sigma_mu: 1, sigma_tau: 0.5 });
    bayChkTrue("no error",   !r.error);
    bayChkTrue("BF10 > 3",   r.BF10 > 3);
  }

  // ---- 20. Null data (yi ≈ 0) → BF10 < 1 (evidence for H0) ----
  {
    console.log("--- 20. null data: BF10 < 1 ---");
    // Studies centered exactly at 0: posterior stays near prior at 0 → BF10 near 1
    // With tight null data, posterior at 0 > prior at 0 → BF10 < 1
    const studiesNull = [
      { yi:  0.01, vi: 0.01 },
      { yi: -0.01, vi: 0.01 },
      { yi:  0.02, vi: 0.01 },
      { yi: -0.02, vi: 0.01 },
      { yi:  0.00, vi: 0.01 },
    ];
    const r = bayesMeta(studiesNull, { mu0: 0, sigma_mu: 1, sigma_tau: 0.5 });
    bayChkTrue("no error",   !r.error);
    bayChkTrue("BF10 < 1",   r.BF10 < 1);
  }

  // ---- 21. Wider prior → smaller BF10 (prior at 0 shrinks as sigma_mu grows) ----
  {
    console.log("--- 21. wider prior → smaller BF10 ---");
    // priorAt0 = 1 / (sqrt(2π) * sigma_mu) → shrinks as sigma_mu increases.
    // With strong BCG data (k=13, data dominates), postAt0 barely changes.
    // So BF10 = priorAt0 / postAt0 ∝ 1/sigma_mu: wider prior → smaller BF10.
    const rNarrow = bayesMeta(studiesBCG, { mu0: 0, sigma_mu: 0.5,  sigma_tau: 0.5 });
    const rWide   = bayesMeta(studiesBCG, { mu0: 0, sigma_mu: 2.0,  sigma_tau: 0.5 });
    bayChkTrue("wider prior → smaller BF10", rWide.BF10 < rNarrow.BF10);
  }

  console.log(bayPass ? "\n✅ ALL BAYESIAN META-ANALYSIS TESTS PASSED" : "\n❌ SOME BAYESIAN META-ANALYSIS TESTS FAILED");

  // =========================================================================
  // MANTEL-HAENSZEL AND PETO TESTS
  // =========================================================================
  console.log("\n===== MANTEL-HAENSZEL AND PETO TESTS =====\n");
  let mhPass = true;
  const { chk: mhchk, chkTrue: mhchkTrue, chkNaN: mhchkNaN } = makeChk(() => { mhPass = false; });

  // ---- Benchmark tests (R blocks MH-1 through MH-4) ----
  MH_BENCHMARKS.forEach(bm => {
    console.log(`--- ${bm.name} ---`);
    const studies = bm.data.map(d => compute(d, bm.type));
    const m = bm.method === "Peto" ? metaPeto(studies) : metaMH(studies, bm.type);

    mhchkTrue("no error", !m.error);
    mhchk("est",    m.FE,    bm.expected.est,    0.001);
    mhchk("se",     m.seFE,  bm.expected.se,     0.001);
    mhchk("ciLow",  m.ciLow, bm.expected.ciLow,  0.001);
    mhchk("ciHigh", m.ciHigh,bm.expected.ciHigh, 0.001);
    mhchk("Q",      m.Q,     bm.expected.Q,      0.01);
    mhchk("I2",     m.I2,    bm.expected.I2,     0.2);
    if (bm.method === "Peto") mhchkTrue("isPeto",  m.isPeto  === true);
    else                      mhchkTrue("isMH",    m.isMH    === true);
  });

  // ---- Unit test 1: k < 2 → error ----
  {
    console.log("--- Unit 1: k < 2 returns error ---");
    const r1 = metaMH([compute({ a: 4, b: 119, c: 11, d: 128 }, "OR")], "OR");
    mhchkTrue("metaMH k=1 → error",  !!r1.error);
    const r2 = metaPeto([compute({ a: 4, b: 119, c: 11, d: 128 }, "OR")]);
    mhchkTrue("metaPeto k=1 → error", !!r2.error);
  }

  // ---- Unit test 2: metaMH with unsupported type → error ----
  {
    console.log("--- Unit 2: metaMH type='SMD' → error ---");
    const smdStudies = [{ yi: 0.5, vi: 0.1 }, { yi: 0.3, vi: 0.2 }];
    const r = metaMH(smdStudies, "SMD");
    mhchkTrue("error returned",  !!r.error);
    mhchkTrue("error mentions OR/RR/RD", r.error.includes("OR") && r.error.includes("RR"));
  }

  // ---- Unit test 3: metaPeto on studies without a/b/c/d → error ----
  {
    console.log("--- Unit 3: metaPeto on studies without raw counts → error ---");
    const noCountStudies = [{ yi: 0.5, vi: 0.1 }, { yi: 0.3, vi: 0.2 }];
    const r = metaPeto(noCountStudies);
    mhchkTrue("error returned", !!r.error);
  }

  // ---- Unit test 4: OR MH with a=0 in one study — no NaN ----
  {
    console.log("--- Unit 4: OR MH with a=0 study handled (no NaN) ---");
    const data = [
      { a: 0, b: 100, c:  5, d:  95 },  // a=0 → R_i=0, still contributes to ΣS
      { a: 5, b: 100, c: 10, d:  90 },
      { a: 3, b:  50, c:  8, d:  42 },
    ];
    const studies = data.map(d => compute(d, "OR"));
    const m = metaMH(studies, "OR");
    mhchkTrue("no error",     !m.error);
    mhchkTrue("FE finite",    isFinite(m.FE));
    mhchkTrue("seFE finite",  isFinite(m.seFE));
    mhchkTrue("Q finite",     isFinite(m.Q));
  }

  // ---- Unit test 5: OR MH with double-zero study — study excluded, rest pooled ----
  {
    console.log("--- Unit 5: OR MH double-zero study excluded ---");
    const data = [
      { a: 0, b: 100, c: 0, d: 100 },   // both arms zero events → R=S=0, excluded
      { a: 5, b: 100, c: 10, d:  90 },
      { a: 3, b:  50, c:  8, d:  42 },
    ];
    const studies = data.map(d => compute(d, "OR"));
    const m = metaMH(studies, "OR");
    mhchkTrue("no error",    !m.error);
    mhchkTrue("FE finite",   isFinite(m.FE));
    // Result should match the 2-study pool without the zero-zero study
    const studies2 = data.slice(1).map(d => compute(d, "OR"));
    const m2 = metaMH(studies2, "OR");
    mhchkTrue("est matches 2-study pool", Math.abs(m.FE - m2.FE) < 1e-10);
  }

  // ---- Unit test 6: RR MH with all-zero-event study excluded ----
  {
    console.log("--- Unit 6: RR MH all-zero-event study excluded ---");
    const data = [
      { a: 0, b: 100, c: 0, d: 100 },   // a+c=0 → excluded for RR
      { a: 5, b: 100, c: 10, d:  90 },
      { a: 3, b:  50, c:  8, d:  42 },
    ];
    const studies = data.map(d => compute(d, "RR"));
    const m = metaMH(studies, "RR");
    mhchkTrue("no error",  !m.error);
    mhchkTrue("FE finite", isFinite(m.FE));
  }

  // ---- Unit test 7: RD MH — balanced 2-study, known RD = 0.10 ----
  {
    console.log("--- Unit 7: RD MH known result (balanced arms, RD=0.10) ---");
    // Study 1: n1=100, n2=100, a=20, b=80, c=10, d=90 → RD=0.10, w=50
    // Study 2: n1=100, n2=100, a=30, b=70, c=20, d=80 → RD=0.10, w=50
    // RD_MH = (50*0.10 + 50*0.10) / 100 = 0.10
    const data = [
      { a: 20, b: 80, c: 10, d: 90 },
      { a: 30, b: 70, c: 20, d: 80 },
    ];
    const studies = data.map(d => compute(d, "RD"));
    const m = metaMH(studies, "RD");
    mhchkTrue("no error", !m.error);
    mhchk("RD_MH = 0.10", m.FE, 0.10, 0.001);
  }

  // ---- Unit test 8: Peto OR on rare-events BCG data — est near IV log OR ----
  {
    console.log("--- Unit 8: Peto OR close to IV log OR for BCG data ---");
    const bcgData = MH_BENCHMARKS[0].data;  // 13 BCG studies
    const studies = bcgData.map(d => compute(d, "OR"));
    const mPeto = metaPeto(studies);
    const mIV   = meta(studies, "DL");
    mhchkTrue("no error", !mPeto.error);
    // Peto and IV log OR should be within 0.1 for this dataset
    mhchkTrue("Peto est within 0.1 of IV FE", Math.abs(mPeto.FE - mIV.FE) < 0.1);
  }

  // ---- Unit test 9: MH OR and IV OR close for large balanced studies ----
  {
    console.log("--- Unit 9: MH OR close to IV log OR for large balanced studies ---");
    // 5 large balanced studies, OR ≈ 0.5 (log OR ≈ -0.693)
    const data = [
      { a:  50, b:  950, c: 100, d:  900 },
      { a:  40, b: 1960, c:  80, d: 1920 },
      { a:  60, b: 2940, c: 120, d: 2880 },
      { a:  30, b: 1470, c:  60, d: 1440 },
      { a:  70, b: 3430, c: 140, d: 3360 },
    ];
    const studies = data.map(d => compute(d, "OR"));
    const mMH = metaMH(studies, "OR");
    const mIV = meta(studies, "DL");
    mhchkTrue("no error", !mMH.error);
    mhchkTrue("MH OR within 0.05 of IV FE", Math.abs(mMH.FE - mIV.FE) < 0.05);
  }

  // ---- Unit test 10: isMH flag ----
  {
    console.log("--- Unit 10: isMH flag on metaMH result ---");
    const studies = MH_BENCHMARKS[0].data.map(d => compute(d, "OR"));
    const m = metaMH(studies, "OR");
    mhchkTrue("isMH === true",        m.isMH    === true);
    mhchkTrue("isPeto === undefined",  m.isPeto  === undefined);
  }

  // ---- Unit test 11: isPeto flag ----
  {
    console.log("--- Unit 11: isPeto flag on metaPeto result ---");
    const studies = MH_BENCHMARKS[3].data.map(d => compute(d, "OR"));
    const m = metaPeto(studies);
    mhchkTrue("isPeto === true",      m.isPeto  === true);
    mhchkTrue("isMH === undefined",   m.isMH    === undefined);
  }

  // ---- Unit test 12: RE and tau2 are NaN ----
  {
    console.log("--- Unit 12: RE and tau2 are NaN for both methods ---");
    const studies = MH_BENCHMARKS[0].data.map(d => compute(d, "OR"));
    const mMH   = metaMH(studies, "OR");
    const mPeto = metaPeto(studies);
    mhchkNaN("metaMH RE",    mMH.RE);
    mhchkNaN("metaMH tau2",  mMH.tau2);
    mhchkNaN("metaPeto RE",  mPeto.RE);
    mhchkNaN("metaPeto tau2",mPeto.tau2);
  }

  // ---- Unit test 13: Q and I2 are finite and non-negative ----
  {
    console.log("--- Unit 13: Q and I2 are finite and non-negative ---");
    const studies = MH_BENCHMARKS[0].data.map(d => compute(d, "OR"));
    const mMH   = metaMH(studies, "OR");
    const mPeto = metaPeto(studies);
    mhchkTrue("metaMH Q finite",     isFinite(mMH.Q) && mMH.Q >= 0);
    mhchkTrue("metaMH I2 finite",    isFinite(mMH.I2) && mMH.I2 >= 0);
    mhchkTrue("metaPeto Q finite",   isFinite(mPeto.Q) && mPeto.Q >= 0);
    mhchkTrue("metaPeto I2 finite",  isFinite(mPeto.I2) && mPeto.I2 >= 0);
  }

  console.log(mhPass ? "\n✅ ALL MANTEL-HAENSZEL AND PETO TESTS PASSED" : "\n❌ SOME MANTEL-HAENSZEL AND PETO TESTS FAILED");

  // ===== CLUSTER-ROBUST SE TESTS =====
  console.log("\n===== CLUSTER-ROBUST SE TESTS =====\n");
  let clPass = true;
  const { chk: clchk, chkTrue: clchkTrue, chkExact: clchkExact } = makeChk(() => { clPass = false; });

  // ---- Benchmark tests (R blocks CL-1 through CL-3) ----
  CLUSTER_BENCHMARKS.forEach(bm => {
    console.log(`--- Benchmark: ${bm.name} ---`);
    const studies = bm.data.map(d => ({
      yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi), cluster: d.cluster
    }));
    const m = robustMeta(studies, bm.method, "normal");
    clchkTrue("no robustError",     !m.robustError);
    clchkTrue("isClustered",        m.isClustered === true);
    clchk("RE",           m.RE,           bm.expected.RE,           0.001);
    clchk("robustSE",     m.robustSE,     bm.expected.robustSE,     0.001);
    clchk("robustCiLow",  m.robustCiLow,  bm.expected.robustCiLow,  0.001);
    clchk("robustCiHigh", m.robustCiHigh, bm.expected.robustCiHigh, 0.001);
    clchkExact("clustersUsed", m.clustersUsed, bm.expected.clustersUsed);
    clchkExact("df",           m.robustDf,     bm.expected.df);
  });

  // ---- Unit 1: No cluster IDs → plain meta() result, no robust fields ----
  {
    console.log("--- Unit 1: No cluster IDs → no clustering ---");
    const studies = [
      { yi: 0.5, vi: 0.04, se: 0.2 },
      { yi: 0.3, vi: 0.05, se: Math.sqrt(0.05) },
      { yi: 0.7, vi: 0.03, se: Math.sqrt(0.03) },
    ];
    const m = robustMeta(studies, "DL", "normal");
    clchkTrue("isClustered not set",  m.isClustered === undefined);
    clchkTrue("robustSE undefined",   m.robustSE    === undefined);
    clchkTrue("RE is finite",         isFinite(m.RE));
  }

  // ---- Unit 2: All singletons → HC-robust, allSingletons = true ----
  {
    console.log("--- Unit 2: All singletons → allSingletons flag ---");
    const studies = [
      { yi: 0.5, vi: 0.04, se: 0.2,                cluster: "A" },
      { yi: 0.3, vi: 0.05, se: Math.sqrt(0.05),    cluster: "B" },
      { yi: 0.7, vi: 0.03, se: Math.sqrt(0.03),    cluster: "C" },
    ];
    const m = robustMeta(studies, "DL", "normal");
    clchkTrue("isClustered true",     m.isClustered    === true);
    clchkTrue("allSingletons true",   m.allSingletons  === true);
    clchkTrue("clustersUsed = 3",     m.clustersUsed   === 3);
    clchkTrue("robustSE > 0",         m.robustSE > 0 && isFinite(m.robustSE));
  }

  // ---- Unit 3: Manual scalar sandwich formula verification ----
  // Equal weights, singleton clusters, known residuals.
  // W=3, g_c = w_i*e_i, B = sum(g_c²), cr1 = C/(C-p) = 3/2
  // V_rob = 1.5 * 0.06 / 9 = 0.01  →  SE_rob = 0.1
  {
    console.log("--- Unit 3: Manual scalar sandwich verification ---");
    const X = [[1], [1], [1]];
    const w = [1, 1, 1];
    const residuals = [0.1, -0.2, 0.1];
    const clusterIds = ["A", "B", "C"];
    const rob = sandwichVar(X, w, residuals, clusterIds);
    // B = 0.1² + (-0.2)² + 0.1² = 0.06; W=3; cr1=1.5; V_rob = 1.5*0.06/9 = 0.01
    clchkTrue("no error",     !rob.error);
    clchk("SE_rob = 0.1",     rob.SE_rob[0], 0.1, 1e-10);
    clchkExact("df = 2",      rob.df, 2);
    clchkExact("C = 3",       rob.C,  3);
  }

  // ---- Unit 4: C < 2 → error ----
  {
    console.log("--- Unit 4: C < 2 → error ---");
    const X = [[1], [1], [1]];
    const w = [1, 1, 1];
    const res = [0.1, 0.2, 0.3];
    // All in same cluster → C = 1
    const rob = sandwichVar(X, w, res, ["A", "A", "A"]);
    clchkTrue("C=1 → error", !!rob.error);
    clchkTrue("error mentions clusters", typeof rob.error === "string");
  }

  // ---- Unit 5: C ≤ p → error ----
  // p=2 parameters, C=2 clusters → C ≤ p
  {
    console.log("--- Unit 5: C ≤ p → error ---");
    const X = [[1, 0.1], [1, 0.3], [1, 0.5], [1, 0.2]];
    const w = [1, 1, 1, 1];
    const res = [0.1, -0.1, 0.1, -0.1];
    const clIds = ["A", "A", "B", "B"];   // C=2, p=2 → C ≤ p
    const rob = sandwichVar(X, w, res, clIds);
    clchkTrue("C=p → error", !!rob.error);
  }

  // ---- Unit 6: RE point estimate unchanged by clustering ----
  {
    console.log("--- Unit 6: RE unchanged by cluster-robust adjustment ---");
    const bm = CLUSTER_BENCHMARKS[0];
    const studies = bm.data.map(d => ({
      yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi), cluster: d.cluster
    }));
    const mPlain  = meta(studies, bm.method, "normal");
    const mRobust = robustMeta(studies, bm.method, "normal");
    clchk("RE unchanged", mRobust.RE, mPlain.RE, 1e-12);
    clchk("tau2 unchanged", mRobust.tau2, mPlain.tau2, 1e-12);
  }

  // ---- Unit 7: robustSE > 0 and finite ----
  {
    console.log("--- Unit 7: robustSE positive and finite ---");
    CLUSTER_BENCHMARKS.forEach(bm => {
      const studies = bm.data.map(d => ({
        yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi), cluster: d.cluster
      }));
      const m = robustMeta(studies, bm.method, "normal");
      clchkTrue(`${bm.name}: robustSE > 0`, m.robustSE > 0 && isFinite(m.robustSE));
    });
  }

  // ---- Unit 8: df === C − p ----
  {
    console.log("--- Unit 8: df === C − p ---");
    CLUSTER_BENCHMARKS.forEach(bm => {
      const studies = bm.data.map(d => ({
        yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi), cluster: d.cluster
      }));
      const m = robustMeta(studies, bm.method, "normal");
      const expectedDf = bm.expected.clustersUsed - 1;  // p = 1 for pooled estimate
      clchkExact(`${bm.name}: df`, m.robustDf, expectedDf);
    });
  }

  // ---- Unit 9: robustCiLow < RE < robustCiHigh ----
  {
    console.log("--- Unit 9: robustCiLow < RE < robustCiHigh ---");
    CLUSTER_BENCHMARKS.forEach(bm => {
      const studies = bm.data.map(d => ({
        yi: d.yi, vi: d.vi, se: Math.sqrt(d.vi), cluster: d.cluster
      }));
      const m = robustMeta(studies, bm.method, "normal");
      clchkTrue(`${bm.name}: CI straddles RE`,
        m.robustCiLow < m.RE && m.RE < m.robustCiHigh);
    });
  }

  // ---- Unit 10: MH/Peto — cluster property on studies does not affect result ----
  {
    console.log("--- Unit 10: Cluster property on studies does not affect MH/Peto ---");
    const data = [
      { a: 4, b: 119, c: 11, d: 128 },
      { a: 6, b:  88, c: 29, d:  82 },
      { a: 3, b: 139, c: 11, d: 128 },
    ].map(d => compute(d, "OR"));
    // Add cluster IDs directly to computed studies
    const withCluster = data.map((s, i) => ({ ...s, cluster: String(i + 1) }));
    const withoutCluster = data;
    const mWith    = metaMH(withCluster,    "OR");
    const mWithout = metaMH(withoutCluster, "OR");
    clchkTrue("isMH unchanged",        mWith.isMH === true);
    clchkTrue("isClustered not set",   mWith.isClustered === undefined);
    clchk("FE unchanged",              mWith.FE, mWithout.FE, 1e-12);
  }

  // ---- Unit 11: robustWlsResult with p=3 returns SE array of length 3 ----
  // Use C=4 clusters so C > p=3 passes the guard.
  {
    console.log("--- Unit 11: robustWlsResult p=3 → robustSE.length = 3 ---");
    const X = [
      [1, 0.1, 0.2], [1, 0.3, 0.4], [1, 0.5, 0.1],
      [1, 0.2, 0.5], [1, 0.4, 0.3], [1, 0.1, 0.6],
      [1, 0.6, 0.3], [1, 0.2, 0.1],
    ];
    const w = [10, 8, 12, 9, 11, 7, 10, 8];
    const y = [0.5, 0.4, 0.6, 0.3, 0.5, 0.4, 0.7, 0.2];
    const beta = [0.1, 0.2, 0.3];
    const clIds = ["A", "A", "B", "B", "C", "C", "D", "D"];  // C=4 > p=3 ✓
    const rob = robustWlsResult(X, w, y, beta, clIds);
    clchkTrue("no error",             !rob.error);
    clchkTrue("robustSE length 3",    Array.isArray(rob.robustSE) && rob.robustSE.length === 3);
    clchkTrue("robustZ length 3",     Array.isArray(rob.robustZ)  && rob.robustZ.length  === 3);
    clchkTrue("robustP length 3",     Array.isArray(rob.robustP)  && rob.robustP.length  === 3);
    clchkTrue("robustCi length 3",    Array.isArray(rob.robustCi) && rob.robustCi.length === 3);
  }

  // ---- Unit 12: Residuals cancel within clusters → B ≈ 0 → SE ≈ 0 ----
  // Cluster A: w=4, e=0.5 and w=4, e=-0.5 → g_A = 4*0.5 + 4*(-0.5) = 0
  // Cluster B: w=5, e=0.4 and w=5, e=-0.4 → g_B = 5*0.4 + 5*(-0.4) = 0
  {
    console.log("--- Unit 12: Residuals cancel within clusters → SE ≈ 0 ---");
    const X = [[1], [1], [1], [1]];
    const w = [4, 4, 5, 5];
    const residuals = [0.5, -0.5, 0.4, -0.4];
    const clIds = ["A", "A", "B", "B"];
    const rob = sandwichVar(X, w, residuals, clIds);
    clchkTrue("no error",     !rob.error);
    clchkTrue("SE_rob ≈ 0",   rob.SE_rob[0] < 1e-10);
  }

  // ---- Unit 13: Single cluster for all rows → C=1 → error ----
  {
    console.log("--- Unit 13: C=1 (single cluster) → error ---");
    const X = [[1], [1], [1]];
    const w = [1, 1, 1];
    const res = [0.1, 0.2, 0.3];
    const rob = sandwichVar(X, w, res, ["X", "X", "X"]);
    clchkTrue("single cluster → error", !!rob.error);
  }

  console.log(clPass ? "\n✅ ALL CLUSTER-ROBUST SE TESTS PASSED" : "\n❌ SOME CLUSTER-ROBUST SE TESTS FAILED");

  // ===========================================================================
  // CI WIDTH (alpha) UNIT TESTS
  // Verifies that the alpha parameter propagates correctly through tCritical(),
  // meta(), metaRegression(), and bayesMeta().
  // ===========================================================================
  console.log("\n===== CI WIDTH (alpha) UNIT TESTS =====\n");
  let ciWidthPass = true;
  const ciw = (label, ok) => {
    if (!ok) { console.error(`  FAIL ${label}`); ciWidthPass = false; }
    else console.log(`  ok  ${label}`);
  };
  const ciwChk = (label, got, expected, tol = 1e-4) => {
    const ok = Math.abs(got - expected) < tol;
    if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${expected} (tol ${tol})`); ciWidthPass = false; }
    else console.log(`  ok  ${label}`);
  };

  // ---- a. tCritical spot-checks from t-table ----
  // df=10: t_{0.05, two-sided} = t_{0.95} ≈ 1.8125; t_{0.005, two-sided} ≈ 3.1693
  ciwChk("tCritical(10, 0.10) ≈ 1.8125", tCritical(10, 0.10), 1.8125, 5e-4);
  ciwChk("tCritical(10, 0.01) ≈ 3.1693", tCritical(10, 0.01), 3.1693, 5e-4);
  // df=∞ → normalQuantile; tCritical(1e6, 0.05) ≈ 1.96
  ciwChk("tCritical(1e6, 0.05) ≈ 1.96",  tCritical(1e6, 0.05), 1.96, 1e-3);
  // monotonicity: larger alpha → smaller critical value
  ciw("tCritical monotone in alpha (df=10)", tCritical(10, 0.01) > tCritical(10, 0.05) && tCritical(10, 0.05) > tCritical(10, 0.10));

  // ---- b. meta() CI width scales with alpha ----
  // BCG-like dataset from benchmark 1 (yi/vi pre-computed)
  const ciw_studies = [
    { yi: -0.8893, vi: 0.3240 }, { yi: -0.5390, vi: 0.0712 },
    { yi: -0.4474, vi: 0.0681 }, { yi: -0.7861, vi: 0.1137 },
    { yi: -0.9253, vi: 0.1123 }, { yi: -0.2098, vi: 0.1093 },
    { yi: -0.5500, vi: 0.0428 }, { yi: -0.5765, vi: 0.1282 },
    { yi: -0.5003, vi: 0.0590 }, { yi: -0.0880, vi: 0.0567 },
    { yi: -0.3370, vi: 0.0600 }, { yi: -0.4443, vi: 0.0609 },
    { yi: -0.7861, vi: 0.1137 },
  ].map(d => ({ ...d, se: Math.sqrt(d.vi), w: 1 / d.vi }));

  const m90 = meta(ciw_studies, "DL", "normal", 0.10);
  const m95 = meta(ciw_studies, "DL", "normal", 0.05);
  const m99 = meta(ciw_studies, "DL", "normal", 0.01);

  // All three should give the same point estimate
  ciwChk("meta RE identical across alpha", m90.RE, m95.RE, 1e-10);
  // CI widths: 90% < 95% < 99%
  const w90 = m90.ciHigh - m90.ciLow;
  const w95 = m95.ciHigh - m95.ciLow;
  const w99 = m99.ciHigh - m99.ciLow;
  ciw("CI width: 90% < 95%", w90 < w95);
  ciw("CI width: 95% < 99%", w95 < w99);
  // 99% CI contains the 95% CI (lb99 < lb95 and ub99 > ub95)
  ciw("99% CI lower < 95% CI lower", m99.ciLow < m95.ciLow);
  ciw("99% CI upper > 95% CI upper", m99.ciHigh > m95.ciHigh);
  // Exact width ratio: w99/w95 ≈ z_{0.005}/z_{0.025} = 2.576/1.960 ≈ 1.314
  const zRatio = normalQuantile(0.995) / normalQuantile(0.975);
  ciwChk("CI width ratio 99%/95% ≈ z_{0.005}/z_{0.025}", w99 / w95, zRatio, 1e-6);

  // ---- c. metaRegression CI width scales with alpha ----
  const ciw_reg_studies = ciw_studies.map((d, i) => ({ ...d, x: i + 1 }));
  const ciw_mods = [{ key: "x", type: "continuous" }];
  const reg90 = metaRegression(ciw_reg_studies, ciw_mods, "DL", "normal", 0.10);
  const reg95 = metaRegression(ciw_reg_studies, ciw_mods, "DL", "normal", 0.05);
  const reg99 = metaRegression(ciw_reg_studies, ciw_mods, "DL", "normal", 0.01);
  // Intercept CI (index 0): 90% narrower than 95%, 95% narrower than 99%
  // reg.ci is Array<[lo, hi]> per coefficient
  const rw = r => r.ci[0][1] - r.ci[0][0];
  ciw("regression CI width: 90% < 95%", rw(reg90) < rw(reg95));
  ciw("regression CI width: 95% < 99%", rw(reg95) < rw(reg99));

  // ---- d. bayesMeta credible interval width scales with alpha ----
  const bayes90 = bayesMeta(ciw_studies, { alpha: 0.10 });
  const bayes95 = bayesMeta(ciw_studies, { alpha: 0.05 });
  const bayes99 = bayesMeta(ciw_studies, { alpha: 0.01 });
  if (!bayes90.error && !bayes95.error && !bayes99.error) {
    const bw = r => r.tauCI[1] - r.tauCI[0];
    ciw("bayes tauCI width: 90% < 95%", bw(bayes90) < bw(bayes95));
    ciw("bayes tauCI width: 95% < 99%", bw(bayes95) < bw(bayes99));
    const muw = r => r.muCI[1] - r.muCI[0];
    ciw("bayes muCI width: 90% < 95%",  muw(bayes90) < muw(bayes95));
    ciw("bayes muCI width: 95% < 99%",  muw(bayes95) < muw(bayes99));
  } else {
    console.log("  (skip bayesMeta CI width tests — error in result)");
  }

  console.log(ciWidthPass ? "\n✅ ALL CI WIDTH TESTS PASSED" : "\n❌ SOME CI WIDTH TESTS FAILED");

  // ===== RVE BENCHMARK TESTS (R blocks RVE-1 through RVE-3) =====
  {
    console.log("\n===== RVE BENCHMARK TESTS =====\n");
    let rveBmPass = true;
    const bchk = (label, got, exp, tol) => {
      const ok = Math.abs(got - exp) <= tol;
      if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${exp} (tol ${tol})`); rveBmPass = false; }
      else console.log(`  ok  ${label}`);
    };
    const bchkExact = (label, got, exp) => {
      const ok = got === exp;
      if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${exp}`); rveBmPass = false; }
      else console.log(`  ok  ${label}`);
    };

    RVE_BENCHMARKS.forEach(bm => {
      console.log(`--- Benchmark: ${bm.name} ---`);
      const r = rvePooled(bm.data, { rho: bm.rho, moderators: bm.moderators });

      if (r.error) {
        console.error(`  FAIL: unexpected error — ${r.error}`);
        rveBmPass = false;
        return;
      }

      bchkExact("df",       r.df,       bm.expected.df);
      bchkExact("kCluster", r.kCluster, bm.expected.kCluster);
      bchkExact("k",        r.k,        bm.expected.k);

      if (bm.moderators.length === 0) {
        // Intercept-only: test top-level fields + coefs[0]
        bchk("est",    r.est,        bm.expected.est,    1e-6);
        bchk("se",     r.se,         bm.expected.se,     1e-6);
        bchk("ciLow",  r.ci[0],      bm.expected.ciLow,  1e-6);
        bchk("ciHigh", r.ci[1],      bm.expected.ciHigh, 1e-6);
        bchk("t",      r.t,          bm.expected.t,      1e-6);
        bchk("p",      r.p,          bm.expected.p,      1e-6);
      } else {
        // Meta-regression: test coefs array
        bchk("intercept est", r.coefs[0].est, bm.expected.interceptEst, 1e-6);
        bchk("intercept se",  r.coefs[0].se,  bm.expected.interceptSe,  1e-6);
        bchk("intercept t",   r.coefs[0].t,   bm.expected.interceptT,   1e-6);
        bchk("intercept p",   r.coefs[0].p,   bm.expected.interceptP,   1e-6);
        bchk("slope est",     r.coefs[1].est, bm.expected.slopeEst,     1e-6);
        bchk("slope se",      r.coefs[1].se,  bm.expected.slopeSe,      1e-6);
        bchk("slope t",       r.coefs[1].t,   bm.expected.slopeT,       1e-6);
        bchk("slope p",       r.coefs[1].p,   bm.expected.slopeP,       1e-6);
      }
    });

    console.log(rveBmPass ? "\n✅ ALL RVE BENCHMARK TESTS PASSED" : "\n❌ SOME RVE BENCHMARK TESTS FAILED");
  }

  // ===== RVE (rvePooled) UNIT TESTS =====
  // Covers: error cases, intercept-only pooling, coefs array, ρ=0 FE
  // equivalence, df = m−p, moderator regression, missing-value exclusion,
  // collinearity error, singleton clusters, CI width ordering.
  {
    console.log("\n===== RVE (rvePooled) UNIT TESTS =====\n");
    let rvePass = true;
    const rvechk = (label, ok) => {
      if (!ok) { console.error(`  FAIL ${label}`); rvePass = false; }
      else console.log(`  ok  ${label}`);
    };

    // Simple 6-study dataset spread across 3 clusters (2 per cluster).
    const s6 = [
      { yi: 0.2, vi: 0.04, cluster: "A", x: 1.0 },
      { yi: 0.4, vi: 0.09, cluster: "A", x: 2.0 },
      { yi: 0.6, vi: 0.05, cluster: "B", x: 3.0 },
      { yi: 0.3, vi: 0.06, cluster: "B", x: 4.0 },
      { yi: 0.5, vi: 0.07, cluster: "C", x: 5.0 },
      { yi: 0.1, vi: 0.10, cluster: "C", x: 6.0 },
    ];

    // --- Error cases ---
    rvechk("rho=1 returns error",  rvePooled(s6, { rho: 1  }).error !== undefined);
    rvechk("rho=-1 returns error", rvePooled(s6, { rho: -1 }).error !== undefined);
    rvechk("rho=1.5 returns error",rvePooled(s6, { rho: 1.5}).error !== undefined);
    rvechk("k<2 returns error",    rvePooled([s6[0]], {}).error !== undefined);
    rvechk("m<2 returns error",    rvePooled(
      [{ yi: 0.2, vi: 0.04, cluster: "X" }, { yi: 0.4, vi: 0.06, cluster: "X" }], {}
    ).error !== undefined);
    // Too many predictors for cluster count: 3 clusters, 3 predictors (intercept+2) → df=0
    rvechk("m<=p returns error",   rvePooled(s6, { rho: 0.5, moderators: ["x", "x"] }).error !== undefined);

    // --- Valid intercept-only result ---
    const r = rvePooled(s6, { rho: 0.80 });
    rvechk("no error on valid input", !r.error);
    if (!r.error) {
      rvechk("intercept-only: df = m−p = 2",  r.df === 2);
      rvechk("kCluster = 3",                  r.kCluster === 3);
      rvechk("k = 6",                          r.k === 6);
      rvechk("se > 0",                         r.se > 0);
      rvechk("ci is array[2]",  Array.isArray(r.ci) && r.ci.length === 2);
      rvechk("ci[0] < est",     r.ci[0] < r.est);
      rvechk("ci[1] > est",     r.ci[1] > r.est);
      rvechk("rho stored = 0.80", Math.abs(r.rho - 0.80) < 1e-12);
      rvechk("t = est/se",      Math.abs(r.t - r.est / r.se) < 1e-10);
      rvechk("p in [0,1]",      r.p >= 0 && r.p <= 1);
      rvechk("p finite",        isFinite(r.p));
      // coefs array
      rvechk("coefs length = 1",          Array.isArray(r.coefs) && r.coefs.length === 1);
      rvechk("coefs[0].name = intercept", r.coefs[0].name === "intercept");
      rvechk("coefs[0].est = r.est",      Math.abs(r.coefs[0].est - r.est) < 1e-12);
      rvechk("coefs[0].se = r.se",        Math.abs(r.coefs[0].se  - r.se)  < 1e-12);
    }

    // At ρ=0 each study is independent → est matches FE pooled mean.
    {
      const feNum = s6.reduce((s, x) => s + x.yi / x.vi, 0);
      const feDen = s6.reduce((s, x) => s + 1 / x.vi, 0);
      const feEst = feNum / feDen;
      const r0 = rvePooled(s6, { rho: 0 });
      rvechk("ρ=0 est matches FE pooled (tol 1e-10)",
        !r0.error && Math.abs(r0.est - feEst) < 1e-10);
    }

    // --- Singleton cluster fallback (no cluster property) ---
    const sNoCluster = [
      { yi: 0.1, vi: 0.04 },
      { yi: 0.3, vi: 0.05 },
      { yi: 0.5, vi: 0.06 },
      { yi: 0.2, vi: 0.07 },
    ];
    const rSing = rvePooled(sNoCluster, { rho: 0.50 });
    rvechk("no-cluster: no error",     !rSing.error);
    rvechk("no-cluster: kCluster = 4", !rSing.error && rSing.kCluster === 4);
    rvechk("no-cluster: df = 3",       !rSing.error && rSing.df === 3);

    // --- CI width ordering ---
    if (!r.error) {
      const r90 = rvePooled(s6, { rho: 0.80, alpha: 0.10 });
      const r99 = rvePooled(s6, { rho: 0.80, alpha: 0.01 });
      if (!r90.error && !r99.error) {
        const w = x => x.ci[1] - x.ci[0];
        rvechk("CI width: 90% < 95%", w(r90) < w(r));
        rvechk("CI width: 95% < 99%", w(r) < w(r99));
      }
    }

    // --- RVE meta-regression (1 moderator) ---
    const rMod = rvePooled(s6, { rho: 0.80, moderators: ["x"] });
    rvechk("mod: no error",           !rMod.error);
    if (!rMod.error) {
      // df = m − p = 3 − 2 = 1
      rvechk("mod: df = m−p = 1",     rMod.df === 1);
      rvechk("mod: coefs length = 2", rMod.coefs.length === 2);
      rvechk("mod: coefs[0].name = intercept", rMod.coefs[0].name === "intercept");
      rvechk("mod: coefs[1].name = x",         rMod.coefs[1].name === "x");
      rvechk("mod: coefs[1].se > 0",            rMod.coefs[1].se > 0);
      rvechk("mod: top-level est = intercept",
        Math.abs(rMod.est - rMod.coefs[0].est) < 1e-12);
      // intercept-only and regression intercepts differ when covariate is not zero-centered
      rvechk("mod: intercept differs from pooled-only est",
        Math.abs(rMod.est - r.est) > 0.001);
    }

    // --- Missing moderator value → study excluded, k decreases ---
    const s6missing = s6.map((s, i) => i === 2 ? { ...s, x: NaN } : s);
    const rMiss = rvePooled(s6missing, { rho: 0.80, moderators: ["x"] });
    rvechk("missing mod val: no error", !rMiss.error);
    rvechk("missing mod val: k = 5",    !rMiss.error && rMiss.k === 5);

    // --- Collinear moderators → singular error ---
    const rCollin = rvePooled(s6, { rho: 0.80, moderators: ["x", "x"] });
    rvechk("collinear moderators: returns error", rCollin.error !== undefined);

    console.log(rvePass ? "\n✅ ALL RVE TESTS PASSED" : "\n❌ SOME RVE TESTS FAILED");
  }

  // ===== THREE-LEVEL BENCHMARK TESTS (R blocks THREE-1 through THREE-2) =====
  {
    console.log("\n===== THREE-LEVEL BENCHMARK TESTS =====\n");
    let threeBmPass = true;
    const bchk3 = (label, got, exp, tol) => {
      const ok = Math.abs(got - exp) <= tol;
      if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${exp} (tol ${tol})`); threeBmPass = false; }
      else console.log(`  ok  ${label}`);
    };
    const bchkExact3 = (label, got, exp) => {
      const ok = got === exp;
      if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${exp}`); threeBmPass = false; }
      else console.log(`  ok  ${label}`);
    };

    THREE_LEVEL_BENCHMARKS.forEach(bm => {
      console.log(`--- Benchmark: ${bm.name} ---`);
      const r = meta3level(bm.data, { method: bm.method });

      if (r.error) {
        console.error(`  FAIL: unexpected error — ${r.error}`);
        threeBmPass = false;
        return;
      }

      bchkExact3("convergence",  r.convergence,    true);
      bchkExact3("k",            r.k,              bm.expected.k);
      bchkExact3("kCluster",     r.kCluster,       bm.expected.kCluster);
      bchkExact3("df",           r.df,             bm.expected.df);
      bchk3("mu",           r.mu,           bm.expected.mu,           1e-4);
      bchk3("se",           r.se,           bm.expected.se,           1e-4);
      bchk3("ciLow",        r.ci[0],        bm.expected.ciLow,        1e-4);
      bchk3("ciHigh",       r.ci[1],        bm.expected.ciHigh,       1e-4);
      bchk3("z",            r.z,            bm.expected.z,            1e-4);
      bchk3("p",            r.p,            bm.expected.p,            1e-6);
      bchk3("tau2_within",  r.tau2_within,  bm.expected.tau2_within,  1e-4);
      bchk3("tau2_between", r.tau2_between, bm.expected.tau2_between, 1e-4);
      bchk3("I2_within",    r.I2_within,    bm.expected.I2_within,    1e-2);
      bchk3("I2_between",   r.I2_between,   bm.expected.I2_between,   1e-2);
      bchk3("Q",            r.Q,            bm.expected.Q,            1e-4);
    });

    console.log(threeBmPass ? "\n✅ ALL THREE-LEVEL BENCHMARK TESTS PASSED" : "\n❌ SOME THREE-LEVEL BENCHMARK TESTS FAILED");
  }

  // ===== LOCATION-SCALE (lsModel) BENCHMARK TESTS =====
  {
    console.log("\n===== LOCATION-SCALE (lsModel) BENCHMARK TESTS =====\n");
    let lsBmPass = true;
    const bchkLS = (label, got, exp, tol) => {
      const ok = Math.abs(got - exp) <= tol;
      if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${exp} (tol ${tol})`); lsBmPass = false; }
      else console.log(`  ok  ${label}`);
    };
    const bchkLSExact = (label, got, exp) => {
      const ok = JSON.stringify(got) === JSON.stringify(exp);
      if (!ok) { console.error(`  FAIL ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); lsBmPass = false; }
      else console.log(`  ok  ${label}`);
    };

    LS_BENCHMARKS.forEach(bm => {
      console.log(`--- Benchmark: ${bm.name} ---`);
      const r = lsModel(bm.data, bm.locMods, bm.scaleMods, {});

      if (r.rankDeficient) {
        console.error("  FAIL: unexpected rankDeficient");
        lsBmPass = false;
        return;
      }

      const ex = bm.expected;

      // Location (beta)
      ex.beta.forEach((b, j) => bchkLS(`beta[${j}]`, r.beta[j], b, 1e-4));
      ex.se_beta.forEach((s, j) => bchkLS(`se_beta[${j}]`, r.se_beta[j], s, 1e-4));

      // Scale (gamma)
      ex.gamma.forEach((g, j) => bchkLS(`gamma[${j}]`, r.gamma[j], g, 1e-4));
      ex.se_gamma.forEach((s, j) => bchkLS(`se_gamma[${j}]`, r.se_gamma[j], s, 1e-2));

      // tau2
      if (ex.tau2_mean !== undefined) bchkLS("tau2_mean", r.tau2_mean, ex.tau2_mean, 1e-4);
      if (ex.tau2_i !== undefined)
        ex.tau2_i.forEach((t, i) => bchkLS(`tau2_i[${i}]`, r.tau2_i[i], t, 1e-4));

      // QE / QM
      if (ex.QE !== undefined)    bchkLS("QE", r.QE, ex.QE, 1e-3);
      if (ex.QM_loc !== undefined) bchkLS("QM_loc", r.QM_loc, ex.QM_loc, 1e-3);
      if (ex.QM_scale !== undefined) bchkLS("QM_scale", r.QM_scale, ex.QM_scale, 1e-4);

      // LL
      bchkLS("LL", r.LL, ex.LL, 1e-4);

      // Structural
      bchkLSExact("k", r.k, ex.k);
      bchkLSExact("p", r.p, ex.p);
      bchkLSExact("q", r.q, ex.q);
      if (ex.locColNames)   bchkLSExact("locColNames",   r.locColNames,   ex.locColNames);
      if (ex.scaleColNames) bchkLSExact("scaleColNames", r.scaleColNames, ex.scaleColNames);
    });

    console.log(lsBmPass ? "\n✅ ALL LOCATION-SCALE BENCHMARK TESTS PASSED" : "\n❌ SOME LOCATION-SCALE BENCHMARK TESTS FAILED");
  }

  // ===== THREE-LEVEL (meta3level) UNIT TESTS =====
  {
    console.log("\n===== THREE-LEVEL (meta3level) UNIT TESTS =====\n");
    let threePass = true;
    const t3chk = (label, ok) => {
      if (!ok) { console.error(`  FAIL ${label}`); threePass = false; }
      else console.log(`  ok  ${label}`);
    };

    // --- Error: too few studies ---
    const r2 = meta3level([
      { yi: 0.1, vi: 0.01, cluster: "A" },
      { yi: 0.2, vi: 0.01, cluster: "B" },
    ]);
    t3chk("k=2 → error", r2.error !== undefined);

    // --- Error: all studies in one cluster (m=1) ---
    const rOneCluster = meta3level([
      { yi: 0.1, vi: 0.01, cluster: "A" },
      { yi: 0.2, vi: 0.01, cluster: "A" },
      { yi: 0.3, vi: 0.01, cluster: "A" },
    ]);
    t3chk("m=1 → error", rOneCluster.error !== undefined);

    // --- Error: invalid method ---
    const rBadMethod = meta3level(
      [{ yi: 0.1, vi: 0.01, cluster: "A" }, { yi: 0.2, vi: 0.01, cluster: "B" },
       { yi: 0.3, vi: 0.01, cluster: "C" }],
      { method: "DL" }
    );
    t3chk("invalid method → error", rBadMethod.error !== undefined);

    // --- Singletons: each study in own cluster (m = k) ---
    // No cluster field → each gets synthetic key; m = k = 4 ≥ 2, k = 4 ≥ 3.
    const rSingletons = meta3level([
      { yi: 0.1, vi: 0.01 },
      { yi: 0.4, vi: 0.02 },
      { yi: 0.7, vi: 0.015 },
      { yi: 1.0, vi: 0.025 },
    ]);
    t3chk("singletons (no cluster field): no error", !rSingletons.error);
    t3chk("singletons: k = 4",        !rSingletons.error && rSingletons.k        === 4);
    t3chk("singletons: kCluster = 4", !rSingletons.error && rSingletons.kCluster === 4);
    t3chk("singletons: df = 3",       !rSingletons.error && rSingletons.df       === 3);
    t3chk("singletons: mu finite",    !rSingletons.error && isFinite(rSingletons.mu));
    t3chk("singletons: se > 0",       !rSingletons.error && rSingletons.se > 0);

    // --- Basic sanity: mu ≈ weighted mean, CI contains mu, p is in [0,1] ---
    const rBasic = meta3level([
      { yi: 0.3, vi: 0.01, cluster: "A" },
      { yi: 0.5, vi: 0.02, cluster: "A" },
      { yi: 0.8, vi: 0.015, cluster: "B" },
      { yi: 0.6, vi: 0.010, cluster: "B" },
      { yi: 1.0, vi: 0.020, cluster: "C" },
    ]);
    t3chk("basic: no error",          !rBasic.error);
    t3chk("basic: ci[0] < mu",        !rBasic.error && rBasic.ci[0] < rBasic.mu);
    t3chk("basic: ci[1] > mu",        !rBasic.error && rBasic.ci[1] > rBasic.mu);
    t3chk("basic: p in [0,1]",        !rBasic.error && rBasic.p >= 0 && rBasic.p <= 1);
    t3chk("basic: I2_within + I2_between ≤ 100",
      !rBasic.error && (rBasic.I2_within + rBasic.I2_between) <= 100 + 1e-9);
    t3chk("basic: tau2_within ≥ 0",   !rBasic.error && rBasic.tau2_within  >= 0);
    t3chk("basic: tau2_between ≥ 0",  !rBasic.error && rBasic.tau2_between >= 0);
    t3chk("basic: Q > 0",             !rBasic.error && rBasic.Q > 0);
    t3chk("basic: df = k-1 = 4",      !rBasic.error && rBasic.df === 4);

    // --- ML vs REML: both converge, estimates differ ---
    const data5 = THREE_LEVEL_BENCHMARKS[0].data;
    const rREML = meta3level(data5, { method: "REML" });
    const rML   = meta3level(data5, { method: "ML"   });
    t3chk("ML no error",       !rML.error);
    t3chk("REML convergence",  !rREML.error && rREML.convergence);
    t3chk("ML convergence",    !rML.error   && rML.convergence);
    // Both methods return finite, non-negative τ² components
    t3chk("REML tau2_within is finite non-negative",
      !rREML.error && isFinite(rREML.tau2_within) && rREML.tau2_within >= 0);
    t3chk("ML tau2_within is finite non-negative",
      !rML.error   && isFinite(rML.tau2_within)   && rML.tau2_within   >= 0);

    // --- CI width scales with alpha ---
    const data3 = THREE_LEVEL_BENCHMARKS[1].data;
    const r90 = meta3level(data3, { alpha: 0.10 });
    const r95 = meta3level(data3, { alpha: 0.05 });
    const r99 = meta3level(data3, { alpha: 0.01 });
    if (!r90.error && !r95.error && !r99.error) {
      const w = x => x.ci[1] - x.ci[0];
      t3chk("CI width: 90% < 95%", w(r90) < w(r95));
      t3chk("CI width: 95% < 99%", w(r95) < w(r99));
    }

    console.log(threePass ? "\n✅ ALL THREE-LEVEL TESTS PASSED" : "\n❌ SOME THREE-LEVEL TESTS FAILED");
  }
}

  // ===== normalCDF & tCDF UNIT TESTS =====
  // normalCDF: A&S §26.2.17 rational polynomial, |ε| < 7.5×10⁻⁸.
  // =========================================================================
  // BLUP BENCHMARK TESTS
  // =========================================================================
  // Expected values produced by metafor 4.8-0 blup.rma.uni() on the BCG
  // Vaccine dataset (dat.bcg, REML). R code:
  //   fit <- rma(yi=yi, vi=vi, method="REML")
  //   blup(fit)   # pred, se, pi.lb (=ci_lb), pi.ub (=ci_ub)
  //
  // Note: metafor calls the CI bounds "pi.lb/pi.ub" in blup() output, but
  // they are confidence intervals for the BLUP (pred ± 1.96*se), not
  // prediction intervals for future studies.
  //
  // Verified: JS formula matches metafor to floating-point precision (~1e-16).
  // See benchmark-data.md "BLUPs" section for derivation details.
  // =========================================================================
  console.log("\n===== BLUP BENCHMARK TESTS =====\n");
  {
    let blupPass = true;
    const blupChk = (label, got, exp, tol = 1e-5) => {
      const ok = Math.abs(got - exp) < tol;
      if (!ok) { console.error(`  FAIL ${label}: got ${got.toFixed(7)}, exp ${exp.toFixed(7)}`); blupPass = false; }
      else console.log(`  ok  ${label}`);
    };

    // BCG dataset (GENERIC, REML)
    const bcgStudies = [
      { label: "Aronson 1948",           yi: -0.8893113339202054,  vi: 0.3255847650039614    },
      { label: "Ferguson & Simes 1949",  yi: -1.5853886572014306,  vi: 0.19458112139814387   },
      { label: "Rosenthal 1960",         yi: -1.348073148299693,   vi: 0.41536796536796533   },
      { label: "Hart & Sutherland 1977", yi: -1.4415511900213054,  vi: 0.020010031902247573  },
      { label: "Frimodt-Moller 1973",    yi: -0.2175473222112957,  vi: 0.05121017216963086   },
      { label: "Stein & Aronson 1953",   yi: -0.786115585818864,   vi: 0.0069056184559087574 },
      { label: "Vandiviere 1973",        yi: -1.6208982235983924,  vi: 0.22301724757231517   },
      { label: "TPT Madras 1980",        yi:  0.011952333523841173, vi: 0.00396157929781773  },
      { label: "Coetzee & Berjak 1968",  yi: -0.4694176487381487,  vi: 0.056434210463248966  },
      { label: "Rosenthal 1961",         yi: -1.3713448034727846,  vi: 0.07302479361302891   },
      { label: "Comstock 1974",          yi: -0.33935882833839015, vi: 0.01241221397155972   },
      { label: "Comstock & Webster 1969",yi:  0.4459134005713783,  vi: 0.5325058452001528    },
      { label: "Comstock 1976",          yi: -0.017313948216879493,vi: 0.0714046596839863    },
    ];
    // Expected from metafor blup.rma.uni() — pred, se, pi.lb (ci_lb), pi.ub (ci_ub)
    const blupExpected = [
      { blup: -0.8002336, se: 0.4099300, ci_lb: -1.6036923, ci_ub:  0.0032252 },
      { blup: -1.2517059, se: 0.3532269, ci_lb: -1.9440188, ci_ub: -0.5593930 },
      { blup: -0.9869028, se: 0.4348320, ci_lb: -1.8391576, ci_ub: -0.1346480 },
      { blup: -1.3978978, se: 0.1375677, ci_lb: -1.6675255, ci_ub: -1.1282701 },
      { blup: -0.2873802, se: 0.2113116, ci_lb: -0.7015423, ci_ub:  0.1267820 },
      { blup: -0.7845720, se: 0.0822898, ci_lb: -0.9458570, ci_ub: -0.6232870 },
      { blup: -1.2439636, se: 0.3685919, ci_lb: -1.9663997, ci_ub: -0.5215274 },
      { blup:  0.0028786, se: 0.0625875, ci_lb: -0.1197917, ci_ub:  0.1255490 },
      { blup: -0.5068362, se: 0.2203910, ci_lb: -0.9387946, ci_ub: -0.0748777 },
      { blup: -1.2471727, se: 0.2457117, ci_lb: -1.7287578, ci_ub: -0.7655876 },
      { blup: -0.3536580, se: 0.1094814, ci_lb: -0.5682376, ci_ub: -0.1390784 },
      { blup: -0.2847340, se: 0.4583010, ci_lb: -1.1829881, ci_ub:  0.6135201 },
      { blup: -0.1467434, se: 0.2434395, ci_lb: -0.6238751, ci_ub:  0.3303883 },
    ];

    const bcgMeta = meta(bcgStudies, "REML", "normal");
    const blupResult = blupMeta(bcgStudies, bcgMeta);

    if (!blupResult || !blupResult.studies) {
      console.error("  FAIL blupMeta returned null or missing studies");
      blupPass = false;
    } else {
      blupChk("k = 13", blupResult.k, 13, 0.5);
      blupChk("mu ≈ -0.71453", blupResult.mu, -0.7145323, 1e-5);
      blupChk("tau2 ≈ 0.31324", blupResult.tau2, 0.3132433, 1e-4);

      blupResult.studies.forEach((s, i) => {
        const exp = blupExpected[i];
        blupChk(`${s.label}: blup`,  s.blup,   exp.blup,  1e-5);
        blupChk(`${s.label}: se`,    s.se_blup, exp.se,    1e-5);
        blupChk(`${s.label}: ci_lb`, s.ci_lb,   exp.ci_lb, 1e-5);
        blupChk(`${s.label}: ci_ub`, s.ci_ub,   exp.ci_ub, 1e-5);
      });
    }

    // --- guard: tau2=0 → returns null ---
    const zeroTauStudies = [
      { label: "A", yi: 0.5, vi: 0.1 },
      { label: "B", yi: 0.5, vi: 0.1 },
    ];
    const zeroMeta = meta(zeroTauStudies, "REML", "normal");
    const zeroBlup = blupMeta(zeroTauStudies, { ...zeroMeta, tau2: 0 });
    const guardOk = zeroBlup === null;
    if (!guardOk) { console.error("  FAIL tau2=0 should return null"); blupPass = false; }
    else console.log("  ok  tau2=0 returns null");

    console.log(blupPass ? "\n✅ ALL BLUP BENCHMARK TESTS PASSED" : "\n❌ SOME BLUP BENCHMARK TESTS FAILED");
  }

  // tCDF: exact regularized-beta relation; accuracy ~10⁻¹⁴.
  //
  // Exact tCDF values are derived from closed-form CDFs:
  //   df=1 (Cauchy):  P(T ≤ x) = 0.5 + arctan(x) / π
  //   df=2:           P(T ≤ x) = 0.5 + x / (2 · √(2 + x²))
  //
  // normalCDF reference values from scipy.stats.norm.cdf (15-digit precision).
  console.log("\n===== normalCDF & tCDF UNIT TESTS =====\n");
  let cdfPass = true;
  const cdfchk = (label, got, expected, tol) => {
    const ok = Math.abs(got - expected) < tol;
    if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected ${expected} (tol ${tol})`); cdfPass = false; }
    else console.log(`  ok  ${label}`);
  };
  const cdfNaN = (label, got) => {
    const ok = isNaN(got);
    if (!ok) { console.error(`  FAIL ${label}: got ${got}, expected NaN`); cdfPass = false; }
    else console.log(`  ok  ${label}`);
  };

  // ---- normalCDF: known values ----
  // Φ(0) = 0.5 by symmetry. A&S §26.2.17 with 7-sig-fig coefficients achieves
  // ~1.5×10⁻⁷ here (the A&S bound of 7.5×10⁻⁸ holds for x > 0 only).
  cdfchk("Φ(0) ≈ 0.5 (within 2e-7)", normalCDF(0),    0.5,           2e-7);
  // Φ(1.96) ≈ 0.9750021 (scipy: 0.9750021048517521)
  cdfchk("Φ(1.96) ≈ 0.975002",      normalCDF(1.96),   0.9750021,     2e-7);
  // Φ(-1.96): should equal 1 − Φ(1.96) by symmetry
  cdfchk("Φ(−1.96) ≈ 0.024998",     normalCDF(-1.96),  0.0249979,     2e-7);
  // Φ(1) ≈ 0.8413447 (scipy: 0.8413447460685429)
  cdfchk("Φ(1) ≈ 0.841345",         normalCDF(1),      0.8413447,     2e-7);
  // Φ(3) ≈ 0.9986501 (scipy: 0.9986501019683699)
  cdfchk("Φ(3) ≈ 0.998650",         normalCDF(3),      0.9986501,     2e-7);
  // Symmetry: Φ(x) + Φ(−x) = 1 for any finite x
  cdfchk("Φ(2)+Φ(−2) = 1",         normalCDF(2) + normalCDF(-2), 1.0, 4e-7);
  cdfchk("Φ(0.5)+Φ(−0.5) = 1",     normalCDF(0.5) + normalCDF(-0.5), 1.0, 4e-7);
  // Tail behaviour: large |x| must not return NaN or be outside [0,1]
  {
    const big = normalCDF(40);
    const ok = big >= 1 - 1e-10 && big <= 1;
    if (!ok) { console.error(`  FAIL Φ(40) out of range: ${big}`); cdfPass = false; }
    else console.log(`  ok  Φ(40) = 1 (underflow to 1)`);
  }
  {
    const small = normalCDF(-40);
    const ok = small >= 0 && small <= 1e-10;
    if (!ok) { console.error(`  FAIL Φ(−40) out of range: ${small}`); cdfPass = false; }
    else console.log(`  ok  Φ(−40) = 0 (underflow to 0)`);
  }

  // ---- tCDF: df=1 (Cauchy) closed-form P(T≤x) = 0.5 + atan(x)/π ----
  // tol 1e-10 because regularizedBeta converges to ~1e-14.
  cdfchk("tCDF(1, df=1) = 0.75 (Cauchy exact)",
    tCDF(1, 1), 0.75, 1e-10);
  cdfchk("tCDF(−1, df=1) = 0.25 (Cauchy exact)",
    tCDF(-1, 1), 0.25, 1e-10);
  cdfchk("tCDF(√3, df=1) = 5/6 (Cauchy exact)",
    tCDF(Math.sqrt(3), 1), 5/6, 1e-10);
  // tCDF(−x, df) = 1 − tCDF(x, df) — symmetry
  cdfchk("tCDF(−√3, df=1) = 1/6 (Cauchy exact)",
    tCDF(-Math.sqrt(3), 1), 1/6, 1e-10);

  // ---- tCDF: df=2 closed-form P(T≤x) = 0.5 + x/(2·√(2+x²)) ----
  const tcdf2 = x => 0.5 + x / (2 * Math.sqrt(2 + x * x));
  cdfchk("tCDF(1, df=2) = 0.5 + 1/(2√3) (exact)",
    tCDF(1, 2), tcdf2(1), 1e-10);
  cdfchk("tCDF(2, df=2) = 0.5 + 1/√6 (exact)",
    tCDF(2, 2), tcdf2(2), 1e-10);
  cdfchk("tCDF(0, df=2) = 0.5 (exact)",
    tCDF(0, 2), 0.5, 1e-10);
  cdfchk("tCDF(−2, df=2) = 0.5 − 1/√6 (exact)",
    tCDF(-2, 2), tcdf2(-2), 1e-10);

  // ---- tCDF: table values for df=30 ----
  // Standard t-table: t_{0.025, df=30} = 2.042 → tCDF(2.042, 30) ≈ 0.975.
  // Tighter tol not applicable here because 2.042 is 3-decimal-place table value.
  cdfchk("tCDF(2.042, df=30) ≈ 0.975 (t-table)",
    tCDF(2.042, 30), 0.975, 1e-4);

  // ---- tCDF: convergence to normalCDF as df → ∞ ----
  // At df=1e6 the difference from Φ(1.96) should be < 1e-6.
  cdfchk("tCDF(1.96, df=1e6) ≈ Φ(1.96) (large-df convergence)",
    tCDF(1.96, 1e6), normalCDF(1.96), 1e-6);

  // ---- tCDF: edge / degenerate inputs ----
  cdfchk("tCDF(0, df=5) = 0.5 (exact symmetry)", tCDF(0, 5), 0.5, 1e-10);
  cdfNaN("tCDF(NaN, 5) = NaN",       tCDF(NaN, 5));
  cdfNaN("tCDF(1, NaN) = NaN",       tCDF(1, NaN));
  cdfNaN("tCDF(1, 0) = NaN (df=0)",  tCDF(1, 0));
  cdfNaN("tCDF(1, −1) = NaN (df<0)", tCDF(1, -1));
  cdfNaN("tCDF(Inf, 5) = NaN",       tCDF(Infinity, 5));
  cdfNaN("tCDF(−Inf, 5) = NaN",      tCDF(-Infinity, 5));

  console.log(cdfPass ? "\n✅ ALL normalCDF & tCDF TESTS PASSED" : "\n❌ SOME normalCDF & tCDF TESTS FAILED");
