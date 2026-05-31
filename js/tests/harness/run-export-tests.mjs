// =============================================================================
// run-export-tests.mjs — Headless buildReport integration tests
// =============================================================================
// Calls buildReport() in a jsdom environment and asserts that every text
// section heading appears in the output.  Catches: section function dropped
// from the body array, section function renamed without updating the call site,
// buildReport() throwing at runtime on fixture data.
//
// Text sections only — plot / Bayes sections are image-gated (liveSVG returns ""
// when getElementById returns null in jsdom) and are covered by the static
// wiring check in run_tests.mjs.
//
// Usage (standalone):  node js/tests/harness/run-export-tests.mjs
// Usage (orchestrated): import { runExportTests } from '...'
// =============================================================================

import { setup } from "./plot-test-env.mjs";
import { computeStudies, runAnalysisHeadless, buildReportArgs } from "../analysis-headless.js";
import { buildReport } from "../../io/report.js";
import { buildDocxBodyXML } from "../../io/docx.js";

// Concatenate all <w:t> text runs in an OOXML string.
// Long strings are split across runs; joining gives searchable plain text.
function extractWt(xml) {
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map(m => m[1])
    .join("");
}

// ── Fixture datasets ──────────────────────────────────────────────────────────

// BCG (Colditz 1994) — 13 studies, pre-computed log-OR / vi.
// Used for VH selection, publication-bias tests, and influence diagnostics.
const BCG_LOGRR = [
  { label: 'Aronson 1948',            yi: -0.8893113339202054,  vi: 0.3255847650039614   },
  { label: 'Ferguson & Simes 1949',   yi: -1.5853886572014306,  vi: 0.19458112139814387  },
  { label: 'Rosenthal 1960',          yi: -1.348073148299693,   vi: 0.41536796536796533  },
  { label: 'Hart & Sutherland 1977',  yi: -1.4415511900213054,  vi: 0.020010031902247573 },
  { label: 'Frimodt-Moller 1973',     yi: -0.2175473222112957,  vi: 0.05121017216963086  },
  { label: 'Stein & Aronson 1953',    yi: -0.786115585818864,   vi: 0.0069056184559087574},
  { label: 'Vandiviere 1973',         yi: -1.6208982235983924,  vi: 0.22301724757231517  },
  { label: 'TPT Madras 1980',         yi:  0.011952333523841173, vi: 0.00396157929781773 },
  { label: 'Coetzee & Berjak 1968',   yi: -0.4694176487381487,  vi: 0.056434210463248966 },
  { label: 'Rosenthal 1961',          yi: -1.3713448034727846,  vi: 0.07302479361302891  },
  { label: 'Comstock 1974',           yi: -0.33935882833839015, vi: 0.01241221397155972  },
  { label: 'Comstock & Webster 1969', yi:  0.4459134005713783,  vi: 0.5325058452001528   },
  { label: 'Comstock 1976',           yi: -0.017313948216879493, vi: 0.0714046596839863  },
];

// BCG with year moderator — for meta-regression section.
const BCG_WITH_YEAR = [
  { label: 'Aronson 1948',            yi: -0.8893113339202054,  vi: 0.3255847650039614,   year: 1948 },
  { label: 'Ferguson & Simes 1949',   yi: -1.5853886572014306,  vi: 0.19458112139814387,  year: 1949 },
  { label: 'Rosenthal 1960',          yi: -1.348073148299693,   vi: 0.41536796536796533,  year: 1960 },
  { label: 'Hart & Sutherland 1977',  yi: -1.4415511900213054,  vi: 0.020010031902247573, year: 1977 },
  { label: 'Frimodt-Moller 1973',     yi: -0.2175473222112957,  vi: 0.05121017216963086,  year: 1973 },
  { label: 'Stein & Aronson 1953',    yi: -0.786115585818864,   vi: 0.0069056184559087574,year: 1953 },
  { label: 'Vandiviere 1973',         yi: -1.6208982235983924,  vi: 0.22301724757231517,  year: 1973 },
  { label: 'TPT Madras 1980',         yi:  0.011952333523841173, vi: 0.00396157929781773, year: 1980 },
  { label: 'Coetzee & Berjak 1968',   yi: -0.4694176487381487,  vi: 0.056434210463248966, year: 1968 },
  { label: 'Rosenthal 1961',          yi: -1.3713448034727846,  vi: 0.07302479361302891,  year: 1961 },
  { label: 'Comstock 1974',           yi: -0.33935882833839015, vi: 0.01241221397155972,  year: 1974 },
  { label: 'Comstock & Webster 1969', yi:  0.4459134005713783,  vi: 0.5325058452001528,   year: 1969 },
  { label: 'Comstock 1976',           yi: -0.017313948216879493, vi: 0.0714046596839863,  year: 1976 },
];

// 3-cluster × 2-study — for RVE + three-level sections.
const CLUSTER_DATA = [
  { label: 'C1-S1', yi: 0.10, vi: 0.04, cluster: '1' },
  { label: 'C1-S2', yi: 0.30, vi: 0.05, cluster: '1' },
  { label: 'C2-S1', yi: 0.50, vi: 0.03, cluster: '2' },
  { label: 'C2-S2', yi: 0.70, vi: 0.06, cluster: '2' },
  { label: 'C3-S1', yi: 0.20, vi: 0.04, cluster: '3' },
  { label: 'C3-S2', yi: 0.80, vi: 0.05, cluster: '3' },
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

export function runExportTests() {
  // jsdom + D3 globals required by report.js (document.getElementById, plots.js).
  // collectPagedSVGs() returns [] early when getElementById returns null, so no
  // actual SVG rendering occurs — text sections produce their full HTML output.
  setup();

  let pass = 0;
  let fail = 0;

  function chk(label, ok) {
    if (ok) {
      console.log(`  ✅ ${label}`);
      pass++;
    } else {
      console.log(`  ❌ ${label}: → FAIL`);
      fail++;
    }
  }

  // ── Run 1: BCG (no mods) ──
  // Produces: sel (VH), pubBias tests, influence, summary.
  // Selection model runs because modSpec is empty.
  const bcgStudies = computeStudies(BCG_LOGRR, 'GENERIC');
  const r1 = runAnalysisHeadless(bcgStudies, 'GENERIC', BASE_OPTS);

  // ── Run 2: BCG with year moderator ──
  // Produces: reg (meta-regression).
  // Selection model is skipped (modSpec non-empty) — that's OK, we get it from r1.
  const bcgYearStudies = computeStudies(BCG_WITH_YEAR, 'GENERIC');
  const r2 = runAnalysisHeadless(bcgYearStudies, 'GENERIC', {
    ...BASE_OPTS,
    modSpec: [{ key: 'year', type: 'continuous' }],
  });

  // ── Run 3: cluster data ──
  // Produces: rveResult, threeLevelResult.
  const clStudies = computeStudies(CLUSTER_DATA, 'GENERIC');
  const r3 = runAnalysisHeadless(clStudies, 'GENERIC', {
    ...BASE_OPTS, hasClusters: true,
  });

  // ── Build combined reportArgs ──
  // Merge: summary/pubBias/influence/sel from r1,
  //        reg from r2, rveResult/threeLevelResult from r3.
  const args1 = buildReportArgs(r1);
  const args2 = buildReportArgs(r2);
  const args3 = buildReportArgs(r3);

  const fullArgs = {
    ...args1,
    reg: args2.reg,
    rveResult: args3.rveResult,
    threeLevelResult: args3.threeLevelResult,
    // forestOptions / cumForestOptions / caterpillarOptions stay from args1.
    // In jsdom without SVG elements, collectPagedSVGs() returns [] immediately —
    // no draw function is called, so D3 is not exercised here.
  };

  // ── Call buildReport ──────────────────────────────────────────────────────
  console.log('--- buildReport integration ---');
  let html;
  try {
    html = buildReport(fullArgs);
  } catch (err) {
    console.log(`  ❌ buildReport threw: ${err.message}`);
    fail++;
    const total = pass + fail;
    console.log(`\nFAILED ${pass}/${total} export integration tests`);
    return { pass, fail };
  }

  // ── HTML section-presence assertions ─────────────────────────────────────
  chk('full HTML document returned',         html.startsWith('<!DOCTYPE'));
  chk('sectionSummary — <h2>Summary</h2>',   html.includes('<h2>Summary</h2>'));
  chk('sectionPubBias — Publication Bias',   html.includes('<h2>Publication Bias</h2>'));
  chk('sectionRegression — Meta-Regression', html.includes('<h2>Meta-Regression</h2>'));
  chk('sectionInfluence — Influence Diagnostics',
      html.includes('<h2>Influence Diagnostics</h2>'));
  chk('sectionRve — Robust Variance',        html.includes('Robust Variance'));
  chk('sectionThreeLevel — Three-Level',     html.includes('Three-Level'));
  chk('sectionSelectionModel — Selection Model',
      html.includes('Selection Model'));

  // ── buildDocxBodyXML integration ──────────────────────────────────────────
  console.log('--- buildDocxBodyXML integration ---');
  let ooxml;
  try {
    ooxml = buildDocxBodyXML(fullArgs);
  } catch (err) {
    console.log(`  ❌ buildDocxBodyXML threw: ${err.message}`);
    fail++;
    const total = pass + fail;
    console.log(`\nFAILED ${pass}/${total} export integration tests`);
    return { pass, fail };
  }

  // Extract concatenated <w:t> runs so split strings are searchable.
  const wt = extractWt(ooxml);

  chk('DOCX body XML produced',               ooxml.length > 0);
  chk('docSummary — Summary',                 wt.includes('Summary'));
  chk('docPubBias — Publication Bias',        wt.includes('Publication Bias'));
  chk('docRegression — Meta-Regression',      wt.includes('Meta-Regression'));
  chk('docInfluence — Influence Diagnostics', wt.includes('Influence Diagnostics'));
  chk('docRve — Robust Variance',             wt.includes('Robust Variance'));
  chk('docThreeLevel — Three-Level',          wt.includes('Three-Level'));
  chk('docSelectionModel — Selection Model',  wt.includes('Selection Model'));

  const total = pass + fail;
  console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'} ${pass}/${total} export integration tests`);

  return { pass, fail };
}

// ── Standalone entry point ────────────────────────────────────────────────────
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  console.log('\n===== EXPORT INTEGRATION TESTS =====\n');
  const { fail } = runExportTests();
  if (fail > 0) process.exit(1);
}
