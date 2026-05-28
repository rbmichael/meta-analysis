// =============================================================================
// run-plot-tests.mjs — Plot rendering smoke tests
// =============================================================================
// Headless smoke suite: for every exported plot function in plots.js, render
// against a real fixture and assert:
//   (a) no exception is thrown
//   (b) the resulting SVG contains at least one path/line/rect/circle/polygon
//
// Usage (standalone):  node js/test-harness/run-plot-tests.mjs
//                      npm run test:plots
// Usage (from run_tests.mjs): import { runPlotTests } from '...'
// =============================================================================

import { setup, makeSvg, makeContainer } from "./plot-test-env.mjs";
import { computeStudies, runAnalysisHeadless } from "../analysis-headless.js";
import { meta, influenceDiagnostics, baujat, blupMeta, pCurve, pUniform,
         metaRegression, profileLikTau2, bayesMeta, cumulativeMeta } from "../analysis.js";
import { goshCompute } from "../gosh.js";
import {
  drawForest, drawFunnel,
  drawBubble, drawPartialResidualBubble,
  drawInfluencePlot, drawCumulativeForest, drawCumulativeFunnel,
  drawOrchardPlot, drawCaterpillarPlot,
  drawBlupPlot, drawBaujatPlot, drawLabbe,
  drawRoBTrafficLight, drawRoBSummary,
  drawGoshPlot, drawProfileLikTau2,
  drawBayesTauPosterior, drawBayesMuPosterior,
  drawQQPlot, drawRadialPlot,
  drawPCurve, drawPUniform,
} from "../plots.js";

// ── Fixture data (module-level constants, no DOM needed) ──────────────────────

// Normand 1999 — 4-study SMD dataset.
const NORMAND_RAW = [
  { label: 'Edinburgh',          n1: 155, m1:  55, sd1: 47, n2: 156, m2:  75, sd2: 64 },
  { label: 'Orpington-Mild',     n1:  31, m1:  27, sd1:  7, n2:  32, m2:  29, sd2:  4 },
  { label: 'Orpington-Moderate', n1:  75, m1:  64, sd1: 17, n2:  71, m2: 119, sd2: 29 },
  { label: 'Orpington-Severe',   n1:  18, m1:  66, sd1: 20, n2:  18, m2: 137, sd2: 48 },
];

// BCG vaccine: a/b/c/d cell counts for L'Abbé plot.
const BCG_BINARY = [
  { label: 'Aronson 1948',            a:  4, b:  119, c:  11, d:  128 },
  { label: 'Ferguson & Simes 1949',   a:  6, b:  300, c:  29, d:  274 },
  { label: 'Rosenthal 1960',          a:  3, b:  228, c:  11, d:  209 },
  { label: 'Hart & Sutherland 1977',  a: 62, b:13536, c: 248, d:12619 },
  { label: 'Frimodt-Moller 1973',     a: 33, b: 5036, c:  47, d: 5761 },
  { label: 'Stein & Aronson 1953',    a:180, b: 1361, c: 372, d: 1079 },
  { label: 'Vandiviere 1973',         a:  8, b: 2537, c:  10, d:  619 },
  { label: 'TPT Madras 1980',         a:505, b:87886, c: 499, d:87892 },
  { label: 'Coetzee & Berjak 1968',   a: 29, b: 7470, c:  45, d: 7232 },
  { label: 'Rosenthal 1961',          a: 17, b: 1699, c:  65, d: 1600 },
  { label: 'Comstock 1974',           a:186, b:50448, c: 141, d:27197 },
  { label: 'Comstock & Webster 1969', a:  5, b: 2493, c:   3, d: 2338 },
  { label: 'Comstock 1976',           a: 27, b:16886, c:  29, d:17825 },
];

// BCG vaccine: pre-computed log-OR (yi/vi) with year moderator for bubble/regression.
const BCG_GENERIC_RAW = [
  { label: 'Aronson 1948',            yi: -0.8893, vi: 0.3256, year: 1948 },
  { label: 'Ferguson & Simes 1949',   yi: -1.5854, vi: 0.1946, year: 1949 },
  { label: 'Rosenthal 1960',          yi: -1.3481, vi: 0.4154, year: 1960 },
  { label: 'Hart & Sutherland 1977',  yi: -1.4416, vi: 0.0200, year: 1977 },
  { label: 'Frimodt-Moller 1973',     yi: -0.2175, vi: 0.0512, year: 1973 },
  { label: 'Stein & Aronson 1953',    yi: -0.7861, vi: 0.0069, year: 1953 },
  { label: 'Vandiviere 1973',         yi: -1.6209, vi: 0.2230, year: 1973 },
  { label: 'TPT Madras 1980',         yi:  0.0120, vi: 0.0040, year: 1980 },
  { label: 'Coetzee & Berjak 1968',   yi: -0.4694, vi: 0.0564, year: 1968 },
  { label: 'Rosenthal 1961',          yi: -1.3713, vi: 0.0730, year: 1961 },
  { label: 'Comstock 1974',           yi: -0.3394, vi: 0.0124, year: 1974 },
  { label: 'Comstock & Webster 1969', yi:  0.4459, vi: 0.5325, year: 1969 },
  { label: 'Comstock 1976',           yi: -0.0173, vi: 0.0714, year: 1976 },
];

const BASE_OPTS = {
  method: 'REML', ciMethod: 'normal', alpha: 0.05,
  useTF: false, tfEstimator: 'L0', useTFAdjusted: false,
  isMHorPeto: false, hasClusters: false,
  rveRho: 0.8, rveMode: 'corr', threeLevelMethod: 'REML',
  modSpec: [], scaleModSpec: [], interactionSpec: [],
  cumulativeOrder: 'input',
  selModeVal: 'mle', selPreset: 'b5', selWeightFn: 'vevea-hedges', selSides: 2,
  selCuts: [0.025, 0.05, 1.0],
  bayesMu0: 0, bayesSigmaMu: 1, bayesSigmaTau: 0.5,
  fsnTrivial: 0.1, fsnDirection: 'auto',
};

// ── Exported test entry point ─────────────────────────────────────────────────

export function runPlotTests() {
  // Set up jsdom + D3 globals.  Safe to call multiple times (each call replaces
  // globalThis.document with a fresh jsdom instance, clearing prior SVG state).
  setup();

  // ── Compute fixtures ──────────────────────────────────────────────────────
  const normStudies = computeStudies(NORMAND_RAW, 'SMD');
  const normResult  = runAnalysisHeadless(normStudies, 'SMD', BASE_OPTS);
  const { m, profile,
          influence: normInfluence, baujatResult,
          cumResults, cumulativeStudies,
          bayesResult, qqResiduals, qqLabels,
          profileLik, pcurve, puniform } = normResult;

  const bcgStudies = computeStudies(BCG_GENERIC_RAW, 'GENERIC');
  const bcgM       = meta(bcgStudies, 'REML', 'normal', 0.05);
  const bcgProfile = { transform: x => x, label: 'log-OR' };
  const bcgReg     = metaRegression(bcgStudies,
    [{ key: 'year', type: 'continuous' }], 'REML', 'normal', { alpha: 0.05 });

  const profLik    = profileLik  ?? profileLikTau2(normStudies, { method: 'REML' });
  const bayesRes   = bayesResult ?? bayesMeta(normStudies,
    { mu0: 0, sigma_mu: 1, sigma_tau: 0.5, alpha: 0.05 });
  const blupRes    = blupMeta(normStudies, m);
  const pcurveRes  = pcurve   ?? pCurve(normStudies);
  const puniformRes = puniform ?? pUniform(normStudies, m);
  const cumRes     = cumResults     ?? cumulativeMeta(normStudies, 'REML', 'normal', 0.05);
  const cumSt      = cumulativeStudies ?? normStudies.slice();
  const inf        = normInfluence ?? influenceDiagnostics(normStudies);
  const baujatRes  = baujatResult  ?? baujat(normStudies);

  const goshRes = goshCompute(
    normStudies.map(d => d.yi),
    normStudies.map(d => d.vi),
    { method: 'REML', maxSubsets: 200, k: normStudies.length },
  );

  const labbeBinaryStudies = BCG_BINARY.map(({ label, a, b, c, d }) => {
    const yi = Math.log((a * d) / (b * c));
    const vi = 1/a + 1/b + 1/c + 1/d;
    return { label, a, b, c, d, yi, vi, se: Math.sqrt(vi), w: 1/vi };
  });

  const robStudies = normStudies.map(s => ({ label: s.label }));
  const robDomains = ['D1: Randomization', 'D2: Blinding', 'D3: Attrition'];
  const robData    = Object.fromEntries(normStudies.map((s, i) => [
    s.label,
    Object.fromEntries(robDomains.map((dom, j) =>
      [dom, ['Low', 'Some concerns', 'High'][(i + j) % 3]])),
  ]));

  // ── Create SVG elements ───────────────────────────────────────────────────
  const SVG_IDS = [
    'forestPlot', 'funnelPlot', 'influencePlot', 'cumulativePlot',
    'cumulativeFunnelPlot', 'pCurvePlot', 'pUniformPlot', 'orchardPlot',
    'caterpillarPlot', 'blupPlot', 'baujatPlot', 'labbePlot',
    'robTrafficLight', 'robSummary', 'goshPlot', 'profileLikTau2Plot',
    'bayesTauPlot', 'bayesMuPlot', 'qqPlot', 'radialPlot',
  ];
  SVG_IDS.forEach(id => makeSvg(id, 600, 450));
  const bubbleContainer1 = makeContainer('bubble-year');
  const bubbleContainer2 = makeContainer('bubble-partial');

  // ── Test runner ───────────────────────────────────────────────────────────
  let pass = 0;
  let fail = 0;

  /**
   * Base smoke test: assert no throw and SVG contains at least one drawable primitive.
   * Prints PASS/FAIL and returns the resolved SVG element (or null on failure) so
   * callers can attach extra assertions via chk().
   */
  function smoke(name, svgId, renderFn, containerEl) {
    try {
      renderFn();
    } catch (err) {
      console.log(`  ${name}: → FAIL (threw: ${err.message})`);
      fail++;
      return null;
    }
    const svg = svgId
      ? document.getElementById(svgId)
      : containerEl?.querySelector('svg');
    if (!svg) {
      console.log(`  ${name}: → FAIL (no SVG element found)`);
      fail++;
      return null;
    }
    const n = svg.querySelectorAll('path, line, rect, circle, polygon, polyline').length;
    if (n === 0) {
      console.log(`  ${name}: → FAIL (SVG has no drawable primitives)`);
      fail++;
      return null;
    }
    console.log(`  ${name}: PASS (${n} primitives)`);
    pass++;
    return svg;
  }

  /**
   * Additional assertion chained after smoke().
   * `gotFn` receives the SVG element and must return a number >= `min`.
   * Does NOT log on success — the parent smoke() PASS already covers it.
   * Only logs on failure so extra assertions appear as separate FAIL lines.
   */
  function chk(name, svgEl, gotFn, min, label) {
    if (!svgEl) return;  // upstream smoke already failed — skip silently
    const got = gotFn(svgEl);
    if (got < min) {
      console.log(`  ${name}: → FAIL (${label}: got ${got}, need ≥ ${min})`);
      fail++;
    }
    // Success: pass already counted by smoke(); no additional log needed.
  }

  const k = normStudies.length;  // 4 — used for data-layer floor assertions

  // ── Tests ─────────────────────────────────────────────────────────────────
  console.log('--- Forest ---');
  // AC1: assert rect count ≥ k (study squares) and polygon ≥ 1 (pooled diamond).
  // These catch data-layer regressions that axis elements would mask in a plain n > 0 check:
  //   • Removing the study-rect render loop: rects drop from k to 0 → chk fails.
  //   • Removing forestDrawDiamond(): polygons drop to 0 → chk fails.
  {
    const svg = smoke('drawForest RE-only', 'forestPlot', () =>
      drawForest(normStudies, m, { profile, ciMethod: 'normal', pooledDisplay: 'RE', theme: 'default' }));
    chk('drawForest RE-only rects', svg, el => el.querySelectorAll('rect').length,
      k, `rect ≥ ${k} study squares`);
    chk('drawForest RE-only diamond', svg, el => el.querySelectorAll('polygon').length,
      1, 'polygon ≥ 1 (pooled diamond)');
  }
  {
    const svg = smoke('drawForest FE-only', 'forestPlot', () =>
      drawForest(normStudies, m, { profile, ciMethod: 'normal', pooledDisplay: 'FE', theme: 'default' }));
    chk('drawForest FE-only rects', svg, el => el.querySelectorAll('rect').length,
      k, `rect ≥ ${k} study squares`);
    chk('drawForest FE-only diamond', svg, el => el.querySelectorAll('polygon').length,
      1, 'polygon ≥ 1 (pooled diamond)');
  }
  smoke('drawForest Both', 'forestPlot', () =>
    drawForest(normStudies, m, { profile, ciMethod: 'normal', pooledDisplay: 'Both', theme: 'cochrane' }));

  console.log('--- Funnel ---');
  smoke('drawFunnel standard', 'funnelPlot', () =>
    drawFunnel(normStudies, m, profile, { theme: 'default' }));
  smoke('drawFunnel contour', 'funnelPlot', () =>
    drawFunnel(normStudies, m, profile, { contours: true, theme: 'cochrane' }));

  console.log('--- Bubble ---');
  smoke('drawBubble year', null, () =>
    drawBubble(bcgStudies, bcgReg, { name: 'year', transform: 'linear' },
      '#bubble-year', { theme: 'default' }),
    bubbleContainer1);
  smoke('drawPartialResidualBubble year', null, () =>
    drawPartialResidualBubble(bcgStudies, bcgReg, { name: 'year', transform: 'linear' },
      '#bubble-partial', { theme: 'default' }),
    bubbleContainer2);

  console.log('--- Influence / Diagnostics ---');
  smoke('drawInfluencePlot', 'influencePlot', () =>
    drawInfluencePlot(inf, { theme: 'default' }));
  smoke('drawBaujatPlot', 'baujatPlot', () =>
    drawBaujatPlot(baujatRes, profile, { theme: 'default' }));
  smoke('drawBlupPlot', 'blupPlot', () =>
    drawBlupPlot(blupRes, profile, { theme: 'default' }));
  smoke('drawQQPlot', 'qqPlot', () =>
    drawQQPlot(qqResiduals, qqLabels, { containerId: '#qqPlot', theme: 'default' }));

  console.log('--- Cumulative ---');
  smoke('drawCumulativeForest', 'cumulativePlot', () =>
    drawCumulativeForest(cumRes, profile, { theme: 'default' }));
  smoke('drawCumulativeFunnel stepIdx=0', 'cumulativeFunnelPlot', () =>
    drawCumulativeFunnel(cumSt, cumRes, profile, 0, { theme: 'default' }));
  smoke('drawCumulativeFunnel stepIdx=last', 'cumulativeFunnelPlot', () =>
    drawCumulativeFunnel(cumSt, cumRes, profile, cumSt.length - 1, { theme: 'default' }));

  console.log('--- Orchard / Caterpillar ---');
  smoke('drawOrchardPlot', 'orchardPlot', () =>
    drawOrchardPlot(normStudies, m, profile, { theme: 'default' }));
  smoke('drawCaterpillarPlot', 'caterpillarPlot', () =>
    drawCaterpillarPlot(normStudies, m, profile, { theme: 'default' }));

  console.log('--- Radial ---');
  smoke('drawRadialPlot', 'radialPlot', () =>
    drawRadialPlot(normStudies, m, profile, { containerId: '#radialPlot', theme: 'default' }));

  console.log('--- p-curve / p-uniform ---');
  smoke('drawPCurve', 'pCurvePlot', () =>
    drawPCurve(pcurveRes, { theme: 'default' }));
  smoke('drawPUniform', 'pUniformPlot', () =>
    drawPUniform(puniformRes, m, profile, { theme: 'default' }));

  console.log('--- Binary ---');
  smoke("drawLabbe (OR)", 'labbePlot', () =>
    drawLabbe(labbeBinaryStudies, bcgM, bcgProfile, { type: 'OR', theme: 'default' }));

  console.log('--- RoB ---');
  smoke('drawRoBTrafficLight', 'robTrafficLight', () =>
    drawRoBTrafficLight(robStudies, robDomains, robData, { theme: 'default' }));
  smoke('drawRoBSummary', 'robSummary', () =>
    drawRoBSummary(robStudies, robDomains, robData, { theme: 'default' }));

  console.log('--- GOSH ---');
  smoke('drawGoshPlot', 'goshPlot', () =>
    drawGoshPlot(goshRes, profile, { forReport: true, theme: 'default' }));

  console.log('--- Likelihood / Bayes ---');
  smoke('drawProfileLikTau2', 'profileLikTau2Plot', () =>
    drawProfileLikTau2(profLik, { xScale: 'tau2', theme: 'default' }));
  smoke('drawBayesTauPosterior', 'bayesTauPlot', () =>
    drawBayesTauPosterior(bayesRes, { theme: 'default' }));
  smoke('drawBayesMuPosterior', 'bayesMuPlot', () =>
    drawBayesMuPosterior(bayesRes, { reMean: m.RE, theme: 'default' }));

  console.log('--- Theme coverage (forest) ---');
  for (const theme of ['default', 'cochrane', 'jama', 'bw']) {
    smoke(`drawForest theme=${theme}`, 'forestPlot', () =>
      drawForest(normStudies, m, { profile, ciMethod: 'normal', pooledDisplay: 'RE', theme }));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = pass + fail;
  console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'} ${pass}/${total} plot smoke tests`);

  return { pass, fail };
}

// ── Standalone entry point ────────────────────────────────────────────────────
// When invoked directly (node run-plot-tests.mjs), print the section header and
// exit non-zero on failure.
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  console.log('\n===== PLOT SMOKE TESTS =====\n');
  const { fail } = runPlotTests();
  if (fail > 0) process.exit(1);
}
