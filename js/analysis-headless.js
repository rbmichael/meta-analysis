// =============================================================================
// analysis-headless.js — Pure computation path, callable from Node
// =============================================================================
// Owns the six batch helpers that were previously private to ui.js and the
// runAnalysisHeadless() coordinator that wires them together.  Zero DOM
// references — every input arrives as a plain argument.
//
// Import chain:
//   analysis-headless.js  → analysis.js, profiles.js, trimfill.js
//   All three are pure JS with no browser API dependencies.
//
// Exports:
//   runAnalysisHeadless(studies, type, opts) → result object
//     Runs the full statistical pipeline and returns a result object that
//     mirrors the shape of appState.reportArgs.  ui.js passes the result
//     straight to _renderAllResults(); test harnesses pass it to buildReport()
//     and buildDocx() to verify export-pipeline parity.
//
// opts shape (all fields required unless noted):
//   method, ciMethod, alpha, useTF, tfEstimator, useTFAdjusted,
//   isMHorPeto, hasClusters, rveRho, rveMode, threeLevelMethod,
//   modSpec, scaleModSpec, interactionSpec, cumulativeOrder,
//   selModeVal, selPreset, selWeightFn, selSides, selCuts,
//   bayesMu0, bayesSigmaMu, bayesSigmaTau,
//   fsnTrivial, fsnDirection
// =============================================================================

import {
  eggerTest, beggTest, petPeeseTest, failSafeN, tesTest, waapWls,
  pCurve, pUniform, baujat, blupMeta, meta, metaMH, metaPeto, robustMeta,
  influenceDiagnostics, subgroupAnalysis, metaRegression, cumulativeMeta,
  veveaHedges, SELECTION_PRESETS, halfNormalSelModel, powerSelModel,
  negexpSelModel, betaSelModel, profileLikTau2, bayesMeta, rvePooled,
  meta3level, harbordTest, petersTest, deeksTest, rueckerTest, lsModel,
  henmiCopas, isValidStudy, compute, clES,
} from "./analysis.js";
import { effectProfiles } from "./profiles.js";
import { trimFill } from "./trimfill.js";

// ── Batch helpers ─────────────────────────────────────────────────────────────

function _runCoreMeta(studies, opts) {
  const { method, ciMethod, alpha, type, useTF, tfEstimator, useTFAdjusted,
          isMHorPeto, hasClusters, rveRho, rveMode, threeLevelMethod } = opts;

  let tf = [], all = studies;
  if (useTF && !isMHorPeto) {
    tf  = trimFill(studies, method, tfEstimator).filled;
    all = [...studies, ...tf];
  }

  let m;
  if      (method === "MH"  ) m = metaMH(studies, type, alpha);
  else if (method === "Peto") m = metaPeto(studies, alpha);
  else if (hasClusters)       m = robustMeta(studies, method, ciMethod, alpha);
  else                        m = meta(studies, method, ciMethod, alpha);

  if (m.error) return { m, tf, all, profileLikResult: null, mAdjusted: null, rveResult: null, threeLevelResult: null };

  const profileLikResult =
    (method === "ML" || method === "REML") && studies.length >= 2
      ? profileLikTau2(studies, { method })
      : null;

  const mAdjusted = (useTF && useTFAdjusted)
    ? (tf.length > 0 ? meta([...studies, ...tf], method, ciMethod, alpha) : m)
    : null;

  const rveResult = (hasClusters && !isMHorPeto)
    ? rvePooled(studies, { rho: rveRho, alpha, omega2: rveMode === "hier" ? "MoM" : 0 })
    : null;

  const threeLevelResult = (hasClusters && !isMHorPeto)
    ? meta3level(studies, { method: threeLevelMethod ?? "REML", alpha })
    : null;

  return { m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult };
}

function _runBayesBatch(studies, m, opts) {
  const { bayesMu0, bayesSigmaMu, bayesSigmaTau, alpha, isMHorPeto } = opts;
  if (studies.length < 2 || isMHorPeto) return { bayesResult: null, reMeanRef: NaN };
  const reMeanRef   = isFinite(m.RE) ? m.RE : m.FE;
  const bayesResult = bayesMeta(studies, { mu0: bayesMu0, sigma_mu: bayesSigmaMu, sigma_tau: bayesSigmaTau, alpha });
  return { bayesResult, reMeanRef };
}

function _runPubBiasBatch(studies, m, opts) {
  const { alpha, selModeVal, selPreset, selWeightFn, selSides, selCuts,
          fsnTrivial = 0.1, fsnDirection = "auto",
          modSpec = [], scaleModSpec = [] } = opts;

  const egger    = eggerTest(studies);
  const begg     = beggTest(studies);
  const petpeese = petPeeseTest(studies);
  const fatpet   = petpeese.fat;
  const fsn      = failSafeN(studies, alpha, fsnTrivial, fsnDirection);
  const tes      = tesTest(studies, m);
  const waap     = waapWls(studies);
  const pcurve   = pCurve(studies);
  const puniform = pUniform(studies, m);
  const harbord  = harbordTest(studies);
  const peters   = petersTest(studies);
  const deeks    = deeksTest(studies);
  const ruecker  = rueckerTest(studies);
  const hc       = henmiCopas(studies, alpha);

  // Selection model — skip when meta-regression moderators are active
  let selResult = null;
  if (modSpec.length === 0 && scaleModSpec.length === 0) {
    if (selModeVal === "sensitivity") {
      let selCutsEff, selSidesEff, selOmegaFixed;
      if (selPreset !== "custom") {
        const p       = SELECTION_PRESETS[selPreset];
        selCutsEff    = p.cuts;
        selSidesEff   = p.sides;
        selOmegaFixed = p.omega;
      } else {
        selCutsEff    = selCuts;
        selSidesEff   = selSides;
        selOmegaFixed = null;
      }
      selResult = veveaHedges(studies, selCutsEff, selSidesEff, selOmegaFixed);
    } else if (selWeightFn === "halfnorm") {
      selResult = halfNormalSelModel(studies, { sides: selSides });
    } else if (selWeightFn === "power") {
      selResult = powerSelModel(studies, { sides: selSides });
    } else if (selWeightFn === "negexp") {
      selResult = negexpSelModel(studies, { sides: selSides });
    } else if (selWeightFn === "beta") {
      selResult = betaSelModel(studies, { sides: selSides });
    } else {
      selResult = veveaHedges(studies, selCuts, selSides, null);
    }
  }

  return { egger, begg, petpeese, fatpet, fsn, tes, waap, pcurve, puniform,
           harbord, peters, deeks, ruecker, hc, selResult };
}

function _runSensitivityBatch(studies, m, opts) {
  const { method, ciMethod, alpha, cumulativeOrder } = opts;

  const influence    = influenceDiagnostics(studies, method, ciMethod, alpha);
  const baujatResult = baujat(studies);
  const blupResult   = (m && isFinite(m.tau2) && m.tau2 > 0 && studies.length >= 2)
    ? blupMeta(studies, m) : null;
  const qqResiduals  = influence.map(d => d.stdResidual).filter(isFinite);
  const qqLabels     = influence.filter(d => isFinite(d.stdResidual)).map(d => d.label);

  const cumulativeStudies = studies.slice();
  if      (cumulativeOrder === "precision_desc") cumulativeStudies.sort((a, b) => a.vi - b.vi);
  else if (cumulativeOrder === "precision_asc")  cumulativeStudies.sort((a, b) => b.vi - a.vi);
  else if (cumulativeOrder === "effect_asc")     cumulativeStudies.sort((a, b) => a.yi - b.yi);
  else if (cumulativeOrder === "effect_desc")    cumulativeStudies.sort((a, b) => b.yi - a.yi);

  const cumResults = cumulativeMeta(cumulativeStudies, method, ciMethod, alpha);

  return { influence, baujatResult, blupResult, qqResiduals, qqLabels, cumResults, cumulativeStudies };
}

function _runRegressionBatch(studies, m, opts) {
  const { method, ciMethod, alpha, modSpec, scaleModSpec, interactionSpec } = opts;

  const subgroup = subgroupAnalysis(studies, method, ciMethod, alpha);
  let reg = null, ls = null;
  if (scaleModSpec.length > 0) {
    ls = lsModel(studies, modSpec, scaleModSpec, { ciMethod, alpha, locInteractions: interactionSpec });
  } else if (modSpec.length > 0 || interactionSpec.length > 0) {
    reg = metaRegression(studies, modSpec, method, ciMethod, { alpha, interactions: interactionSpec });
  }
  return { subgroup, reg, ls };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full statistical pipeline without touching the DOM.
 *
 * @param {object[]} studies  Valid study objects from collectStudies() or a fixture.
 * @param {string}   type     Effect-type key (e.g. "SMD", "OR").
 * @param {object}   opts     Analysis configuration — see module header for shape.
 * @returns {object}  Flat result object consumed by _renderAllResults() and
 *                    the export-parity test harness.  Contains m, tf, all,
 *                    profileLikResult, mAdjusted, rveResult, threeLevelResult,
 *                    bayesResult, reMeanRef, plus all pub-bias, sensitivity, and
 *                    regression fields, plus profile and type for convenience.
 */
export function runAnalysisHeadless(studies, type, opts) {
  const profile = effectProfiles[type];

  const coreMeta = _runCoreMeta(studies, opts);
  const { m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult } = coreMeta;

  // Early exit on fatal error — return a partial result so the caller can
  // surface m.error without having to destructure before checking.
  if (m.error) {
    return { m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult,
             bayesResult: null, reMeanRef: NaN,
             egger: null, begg: null, petpeese: null, fatpet: null, fsn: null,
             tes: null, waap: null, pcurve: null, puniform: null,
             harbord: null, peters: null, deeks: null, ruecker: null, hc: null,
             selResult: null,
             influence: [], baujatResult: null, blupResult: null,
             qqResiduals: [], qqLabels: [], cumResults: [], cumulativeStudies: [],
             subgroup: null, reg: null, ls: null,
             profile, type, studies, opts };
  }

  const { bayesResult, reMeanRef } = _runBayesBatch(studies, m, opts);
  const pubBias    = _runPubBiasBatch(studies, m, opts);
  const sensitivity = _runSensitivityBatch(studies, m, opts);
  const regression  = _runRegressionBatch(studies, m, opts);

  return {
    m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult,
    bayesResult, reMeanRef,
    ...pubBias,
    ...sensitivity,
    ...regression,
    profile, type, studies, opts,
  };
}

/**
 * Convert raw fixture data (n1, m1, sd1 … or yi, vi) to the validated study
 * objects expected by runAnalysisHeadless.  Mirrors the collectStudies() path
 * in ui-table.js but without any DOM dependency.
 *
 * @param {object[]} rawData  Array of raw study rows (profile-specific inputs).
 * @param {string}   type     Effect-type key.
 * @returns {object[]}  Filtered array of valid study objects with yi, vi, se, w.
 */
export function computeStudies(rawData, type) {
  return rawData
    .map((d, i) => {
      const computed = compute(d, type);
      return { label: d.label ?? `Study ${i + 1}`, ...d, ...computed };
    })
    .filter(d => isValidStudy(d));
}

/**
 * Assemble a reportArgs object from a headless result and optional display
 * settings.  This is the DOM-free equivalent of the appState.reportArgs
 * assembly in _renderForestAndBubbles() in ui.js.
 *
 * The returned object can be passed directly to sections.js data functions
 * (summaryData, pubBiasData, …) and, once a DOM mock is available, to
 * buildReport() and buildDocx().
 *
 * @param {object} r         Return value of runAnalysisHeadless().
 * @param {object} settings  Display settings normally read from DOM.
 *   ciLevel          "90"|"95"|"99"   default "95"
 *   mccMethod        string           default "none"
 *   goshXAxis        string           default "I2"
 *   profileLikXScale string           default "tau2"
 * @returns {object}  reportArgs — see CLAUDE.md "Export parity" for field list.
 */
export function buildReportArgs(r, settings = {}) {
  const { ciLevel = "95", mccMethod = "none",
          goshXAxis = "I2", profileLikXScale = "tau2" } = settings;

  const { m, tf, all, profileLikResult, mAdjusted, rveResult, threeLevelResult,
          bayesResult, egger, begg, fatpet, petpeese, fsn, tes, waap, pcurve,
          puniform, harbord, peters, deeks, ruecker, hc, selResult,
          influence, baujatResult, qqResiduals, qqLabels, cumResults,
          subgroup, reg, ls, profile, type, studies, opts } = r;

  const { method, ciMethod, alpha, selModeVal, selPreset,
          rveRho, rveMode, threeLevelMethod,
          fsnTrivial, fsnDirection, useTF } = opts;

  const SMD_TYPES = new Set(["SMD", "SMDH", "SMD_paired", "SMD1", "SMD1H", "SMCC"]);
  const cles = SMD_TYPES.has(type) ? clES(m.RE, [m.ciLow, m.ciHigh]) : null;

  const _selLabel = selModeVal === "mle" ? "MLE"
    : selPreset !== "custom" ? (SELECTION_PRESETS[selPreset]?.label ?? selPreset)
    : "Custom";

  const ciPct = Math.round((1 - alpha) * 100);
  const ciLabel = `${ciPct}% CI`;
  const forestOptions = {
    ciMethod, profile, pageSize: 30, pooledDisplay: "both",
    theme: "default", alpha, ciLabel,
  };

  return {
    studies: all, m, profile, reg, ls,
    tf, egger, begg, fatpet, petpeese, fsn, tes, waap, cles, pcurve, puniform,
    harbord, peters, deeks, ruecker, hc, baujatResult,
    influence, subgroup, method, ciMethod,
    rveResult, threeLevelResult,
    rveRho, rveMode, threeLevelMethod,
    fsnTrivial, fsnDirection,
    permResult: null, ciLevel, mccMethod,
    useTF, mAdjusted,
    sel: selResult, selMode: selModeVal, selLabel: _selLabel,
    gosh: null, goshXAxis,
    profileLik: profileLikResult, profileLikXScale,
    bayesResult, bayesReMean: m.RE,
    sensitivityRows: null,
    forestOptions,
    cumForestOptions: { results: cumResults, profile, pageSize: 30, currentPage: 0, alpha, ciLabel },
    caterpillarOptions: { studies: all, m, profile, pageSize: 30, currentPage: 0 },
    qqResiduals, qqLabels,
  };
}
