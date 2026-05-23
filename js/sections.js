// =============================================================================
// js/sections.js — shared row-data computation for report.js and docx.js
// =============================================================================
// Each function returns renderer-agnostic plain-string data.
// Headers may contain <em>…</em> — both HTML and OOXML renderers handle it.
// Notes use plain text or <em>…</em> only (no <sub>, no HTML entities).
// Rows are string[][] — renderers wrap cells in <td> or OOXML <w:r>.

import { fmt, fmtCI_APA, fmtP_APA } from "./format.js";
import { normalQuantile } from "./utils.js";
import { Z_95 } from "./constants.js";
import { leaveOneOut, estimatorComparison } from "./influence.js";

// ---------------------------------------------------------------------------
// cellRich — renderer-agnostic run parser
// ---------------------------------------------------------------------------
// Parse a string that may contain <em>…</em> spans into an array of runs.
// Returns Array<{text: string, italic?: true}>.
// Renderers (report.js, docx.js) convert each run to their output format.
export function cellRich(s) {
  const str = s == null ? "" : String(s);
  const runs = [];
  for (const part of str.split(/(<em>[^<]*<\/em>)/)) {
    if (part.startsWith("<em>")) runs.push({ text: part.slice(4, -5), italic: true });
    else if (part)               runs.push({ text: part });
  }
  return runs.length ? runs : [{ text: str }];
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function summaryData(args) {
  const { m, profile, method, ciMethod, useTF, tf, mAdjusted, studies,
          cles = null, ciLevel = "95" } = args;
  const widthCiLabel = ciLevel + "% CI";
  const k            = studies.filter(d => !d.filled).length;
  const isMHorPeto   = m.isMH || m.isPeto;
  const FE_disp      = profile.transform(m.FE);
  const RE_disp      = isMHorPeto ? null : profile.transform(m.RE);
  const ci           = { lb: profile.transform(m.ciLow),   ub: profile.transform(m.ciHigh) };
  const pred         = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  const RE_adj       = (!isMHorPeto && useTF && mAdjusted) ? profile.transform(mAdjusted.RE) : null;
  const feAlpha      = { "90": 0.10, "95": 0.05, "99": 0.01 }[ciLevel] ?? 0.05;
  const feZ          = normalQuantile(1 - feAlpha / 2);
  const feCi         = { lb: profile.transform(m.FE - feZ * m.seFE), ub: profile.transform(m.FE + feZ * m.seFE) };
  const tauCI1       = fmt(m.tauCI?.[0]);
  const tauCI2       = isFinite(m.tauCI?.[1]) ? fmt(m.tauCI[1]) : "∞";
  const H2hi         = isFinite(m.H2CI?.[1])  ? fmt(m.H2CI[1])  : "∞";
  const methodLabel  = m.isMH ? "Mantel-Haenszel" : m.isPeto ? "Peto" : method;
  const ciLabel      = ciMethod === "KH" ? "Knapp-Hartung"
                     : ciMethod === "t"  ? "t-distribution"
                     : ciMethod === "PL" ? "Profile Likelihood"
                     : "Normal (z)";

  const settings = `Effect type: ${profile.label}  ·  Pooling: ${methodLabel}  ·  CI method: ${ciLabel}  ·  k = ${k}${tf.length > 0 ? ` + ${tf.length} imputed (trim & fill)` : ""}`;

  const rows = [
    [profile.label + " — Fixed Effects (FE)", `${fmt(FE_disp)}, SE = ${fmt(m.seFE)}, ${widthCiLabel} ${fmtCI_APA(feCi.lb, feCi.ub)}`],
    ...(!isMHorPeto ? [[profile.label + " — Random Effects (RE)", `${fmt(RE_disp)}, SE = ${fmt(m.seRE)}, ${widthCiLabel} ${fmtCI_APA(ci.lb, ci.ub)}`]] : []),
    ...(isMHorPeto  ? [[widthCiLabel, `${fmtCI_APA(ci.lb, ci.ub)}  ·  SE = ${fmt(m.seFE)}`]] : []),
    ...(cles        ? [["CLES (RE)", `${fmt(cles.estimate)} [${fmt(cles.ci[0])}, ${fmt(cles.ci[1])}]`]] : []),
    ...(RE_adj !== null ? [["RE (trim-and-fill adjusted)", fmt(RE_adj)]] : []),
    ...(!isMHorPeto ? [["95% Prediction interval (PI)", fmtCI_APA(pred.lb, pred.ub)]] : []),
    ...(!isMHorPeto ? [["τ²", `${fmt(m.tau2)}, ${widthCiLabel} [${tauCI1}, ${tauCI2}]`]] : []),
    ["<em>I</em>²", `${fmt(m.I2)}%, ${widthCiLabel} [${fmt(m.I2CI?.[0])}%, ${fmt(m.I2CI?.[1])}%]`],
    ...(!isMHorPeto ? [["H²-CI", `[${fmt(m.H2CI?.[0])}, ${H2hi}]`]] : []),
    [`<em>Q</em> (<em>df</em> = ${m.df})`, fmt(m.Q)],
    ...(m.dist ? [[`${m.dist}-statistic`, `${fmt(m.stat)}, <em>p</em> ${fmtP_APA(m.pval)}`]] : []),
    ...(m.isClustered ? [[
      `Robust CI (C = ${m.clustersUsed} clusters)`,
      `${fmtCI_APA(profile.transform(m.robustCiLow), profile.transform(m.robustCiHigh))}  ·  SE = ${fmt(m.robustSE)}  ·  <em>z</em> = ${fmt(m.robustStat)}, <em>p</em> ${fmtP_APA(m.robustPval)}`,
    ]] : []),
  ];

  const note = isMHorPeto
    ? `Fixed-effect pooling (${methodLabel}) — RE estimate, τ², and prediction interval not applicable. FE = fixed effects; CI = confidence interval.`
    : `FE = fixed effects; RE = random effects; CI = confidence interval; PI = prediction interval.${cles ? " CLES = common language effect size = Φ(g/√2); probability that a randomly drawn score from group 1 exceeds group 2 (McGraw & Wong, 1992)." : ""}${m.isClustered ? " Robust CI uses cluster-robust (sandwich) standard errors." : ""}`;

  return {
    settings,
    subtitle: `Summary of Meta-Analysis Results (${profile.label})`,
    headers:  ["Statistic", "Value"],
    rows,
    note,
    reRowIdx: !isMHorPeto ? 1 : -1,
  };
}

// ---------------------------------------------------------------------------
// Publication bias
// ---------------------------------------------------------------------------

export function pubBiasData(args) {
  const { egger, begg, fatpet, petpeese, fsn, tes, waap, harbord, peters, deeks, ruecker, hc,
          useTF, tf, profile } = args;

  const na  = v => isFinite(v) ? fmt(v) : "—";
  const naP = v => isFinite(v) ? fmtP_APA(v) : "NA";

  const petEff = isFinite(fatpet?.intercept) ? fmt(profile.transform(fatpet.intercept)) : "—";

  const rows = [
    ["Egger’s test (intercept)",              na(egger?.intercept),   naP(egger?.p)],
    ["Begg’s test (rank correlation τ)", na(begg?.tau),          naP(begg?.p)],
    ["FAT — β₁ (bias)",             na(fatpet?.slope),      naP(fatpet?.slopeP)],
    ["PET — effect at SE → 0",           petEff,                 naP(fatpet?.interceptP)],
    isFinite(petpeese?.peese?.intercept)
      ? [`PEESE — effect at vᵢ → 0${petpeese.usePeese ? " ✓" : ""}`,
         fmt(profile.transform(petpeese.peese.intercept)),
         naP(petpeese.peese.interceptP)]
      : ["PEESE", "—", "NA"],
    ...([
      ["Harbord (intercept)", harbord],
      ["Peters (intercept)",  peters],
      ["Deeks (intercept)",   deeks],
      ["Rücker (intercept)", ruecker],
    ].map(([label, r]) => [label, na(r?.intercept), naP(r?.interceptP)])),
    tes && isFinite(tes.chi2)
      ? [`TES — χ² (O=${tes.O}, E=${fmt(tes.E)})`, fmt(tes.chi2), naP(tes.p)]
      : ["TES (test of excess significance)", "—", "NA"],
    waap && isFinite(waap.estimate)
      ? [`WAAP-WLS (k_adequate = ${waap.kAdequate} of ${waap.k}${waap.fallback ? "; WLS fallback" : ""})`,
         `${fmt(profile.transform(waap.estimate))} [${fmt(profile.transform(waap.ci[0]))}, ${fmt(profile.transform(waap.ci[1]))}]`,
         naP(waap.p)]
      : ["WAAP-WLS", "—", "NA"],
    hc && !hc.error
      ? ["Henmi-Copas CI",
         `${fmt(profile.transform(hc.beta))} [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}]`,
         "—"]
      : ["Henmi-Copas CI", "—", "NA (k < 3)"],
    hc && !hc.error && isFinite(hc.tau2)
      ? ["Henmi-Copas τ² (DL, bias-robust)", fmt(hc.tau2), "—"]
      : null,
  ].filter(Boolean);

  const fsnLine = [
    `Fail-safe N (Rosenthal): ${isFinite(fsn?.rosenthal) ? Math.round(fsn.rosenthal) : "—"}`,
    `Fail-safe N (Orwin): ${isFinite(fsn?.orwin) ? Math.round(fsn.orwin) : "—"}`,
    `Trim & Fill: ${useTF ? "ON" : "OFF"}${tf?.length > 0 ? ` (${tf.length} filled)` : ""}`,
  ].join("  ·  ");

  const note = "FAT = funnel asymmetry test; PET = precision-effect test; PEESE = precision-effect estimate with standard error (Stanley & Doucouliagos, 2014); ✓ = PEESE preferred (FAT p < .10). "
    + "Harbord, Peters, Deeks, and Rücker are binary-outcome variants of the Egger test; "
    + "TES = test of excess significance; "
    + "WAAP-WLS = weighted average of adequately powered studies; statistic is bias-corrected effect estimate [95% CI]; "
    + "Henmi-Copas = bias-robust CI centred on FE estimate (DL τ²). "
    + "NA = fewer than 3 eligible studies or missing cell counts.";

  return { headers: ["Test", "Statistic", "<em>p</em>"], rows, note, fsnLine };
}

// ---------------------------------------------------------------------------
// P-curve
// ---------------------------------------------------------------------------

export function pCurveData(pcurve) {
  if (!pcurve || pcurve.k < 3) return null;

  const verdictLabels = {
    "evidential":    "Evidential value",
    "no-evidential": "No evidential value",
    "inconclusive":  "Inconclusive",
    "insufficient":  "Insufficient data",
  };

  const fmtZ = z => isFinite(z) ? z.toFixed(3) : "—";

  const rows = [
    ["Right-skew test", fmtZ(pcurve.rightSkewZ), fmtP_APA(pcurve.rightSkewP)],
    ["Flatness test",   fmtZ(pcurve.flatnessZ),  fmtP_APA(pcurve.flatnessP)],
  ];

  const verdict = verdictLabels[pcurve.verdict] ?? pcurve.verdict ?? "—";

  return {
    kLine:   `${pcurve.k} significant result${pcurve.k !== 1 ? "s" : ""} (p < .05)`,
    headers: ["Test", "<em>Z</em>", "<em>p</em>"],
    rows,
    verdict,
    note: `Right-skew test H₀: p-curve is uniform or left-skewed (no evidential value). Flatness test H₀: p-curve has evidential value. Verdict: ${verdict}. Simonsohn et al. (2014).`,
  };
}

// ---------------------------------------------------------------------------
// P-uniform
// ---------------------------------------------------------------------------

export function puniformData(args) {
  const { puniform, m, profile, ciLevel = "95" } = args;
  if (!puniform || puniform.k < 3 || !isFinite(puniform.estimate)) return null;
  const widthCiLabel = ciLevel + "% CI";

  const tr = v => isFinite(v) ? profile.transform(v) : NaN;

  const noteExtra = [
    puniform.biasDetected      ? "Bias detected (p < .05)." : "",
    puniform.significantEffect ? "Significant effect after correction (p < .05)." : "",
  ].filter(Boolean).join(" ");

  const rows = [
    ["RE (uncorrected)",
     isFinite(m.RE)              ? fmt(tr(m.RE))              : "—",
     fmtCI_APA(tr(m.ciLow),     tr(m.ciHigh)),
     fmt(puniform.Z_bias),
     fmtP_APA(puniform.p_bias)],
    ["P-uniform (bias-corrected)",
     isFinite(puniform.estimate) ? fmt(tr(puniform.estimate)) : "—",
     fmtCI_APA(tr(puniform.ciLow), tr(puniform.ciHigh)),
     fmt(puniform.Z_sig),
     fmtP_APA(puniform.p_sig)],
  ];

  const note = "RE row: bias test (H₀: RE = true effect). P-uniform row: significance test (H₀: δ = 0). CI = confidence interval."
    + (noteExtra ? " " + noteExtra : "");

  return {
    kLine:   `${puniform.k} significant result${puniform.k !== 1 ? "s" : ""} (p < .05) used  ·  effect scale: ${profile.label}`,
    headers: ["Method", "Estimate", widthCiLabel, "<em>Z</em>", "<em>p</em>"],
    rows,
    note,
  };
}

// ---------------------------------------------------------------------------
// Selection model (Vevea-Hedges)
// ---------------------------------------------------------------------------

export function selModelData(args) {
  const { sel, profile, selMode, selLabel, ciLevel = "95" } = args;
  if (!sel || sel.error) return null;
  const widthCiLabel = ciLevel + "% CI";
  const isMLE = selMode === "mle";

  const fmtDisp = v => isFinite(v) ? fmt(profile.transform(v)) : "—";
  const fmtV    = v => isFinite(v) ? fmt(v) : "—";

  const cuts           = sel.cuts;
  const intervalLabels = cuts.map((c, j) => `(${j === 0 ? "0" : cuts[j - 1]}, ${c}]`);

  const muAdj = fmtDisp(sel.mu);
  const ciLo  = fmtDisp(sel.mu - Z_95 * sel.se_mu);
  const ciHi  = fmtDisp(sel.mu + Z_95 * sel.se_mu);

  const omegaRow = [
    "Selection weight ω",
    ...sel.omega.map((w, j) => {
      if (!isMLE || j === 0) return `${fmtV(w)} (fixed)`;
      const se = isFinite(sel.se_omega[j]) ? ` ± ${fmtV(sel.se_omega[j])}` : "";
      return `${fmtV(w)}${se}`;
    }),
  ];

  // Full rows: omega + nPerInterval (one cell per interval + label).
  // Spanning rows: muAdj, tau2, LRT (label + combined value cell; renderers handle colspan/padding).
  const rows = [
    omegaRow,
    ["Studies per interval", ...sel.nPerInterval.map(String)],
    [`Adjusted μ̂ [${widthCiLabel}]`, `${muAdj} [${ciLo}, ${ciHi}]  ·  unadjusted: ${fmtDisp(sel.RE_unsel)}`],
    [`Adjusted τ²`, `${fmtV(sel.tau2)}  ·  unadjusted: ${fmtV(sel.tau2_unsel)}`],
    ...(isMLE && isFinite(sel.LRT) ? [
      [`LRT (H₀: no selection)`, `χ²(${sel.LRTdf}) = ${fmtV(sel.LRT)}, <em>p</em> ${fmtP_APA(sel.LRTp)}`],
    ] : []),
  ];

  const modeLabel  = isMLE ? "MLE (estimated weights)" : `Sensitivity — ${selLabel}`;
  const sidesLabel = sel.sides === 2 ? "two-sided" : "one-sided";

  return {
    metaLine:     `Mode: ${modeLabel}  ·  p-values: ${sidesLabel}  ·  k = ${sel.k}`,
    subtitle:     "Selection Model Results",
    headers:      ["Quantity", ...intervalLabels],
    rows,
    note:         "ω = selection weight; μ̂ = bias-corrected pooled estimate; CI = confidence interval; LRT = likelihood ratio test.",
    nCols:        1 + cuts.length,
    nPerInterval: sel.nPerInterval,
    isMLE,
    converged:    sel.converged,
    LRTp:         sel.LRTp,
    muAdj, ciLo, ciHi,
    muUnadj:      fmtDisp(sel.RE_unsel),
  };
}

// ---------------------------------------------------------------------------
// Influence diagnostics
// ---------------------------------------------------------------------------

export function influenceData(args) {
  const { influence, studies } = args;
  if (!influence || !influence.length) return null;
  const k = studies.filter(d => !d.filled).length;
  const dffitsThresh   = 3 * Math.sqrt(1 / Math.max(k - 1, 1));
  const covRatioThresh = 1 + 1 / k;

  const em = "—";
  const rows = influence.map(d => [
    d.label,
    isFinite(d.RE_loo)      ? fmt(d.RE_loo)         : em,
    isFinite(d.deltaTau2)   ? fmt(d.deltaTau2)      : em,
    isFinite(d.stdResidual) ? fmt(d.stdResidual)    : em,
    isFinite(d.DFBETA)      ? fmt(d.DFBETA)         : em,
    isFinite(d.DFFITS)      ? fmt(d.DFFITS)         : em,
    isFinite(d.covRatio)    ? d.covRatio.toFixed(3) : em,
    isFinite(d.hat)         ? d.hat.toFixed(3)      : em,
    isFinite(d.cookD)       ? d.cookD.toFixed(3)    : em,
    [d.outlier      ? "Outlier"     : "",
     d.influential  ? "Influential" : "",
     d.highLeverage ? "Hi-Lev"     : "",
     d.highCookD    ? "Hi-Cook"    : "",
     d.highDffits   ? "Hi-DFFITS"  : "",
     d.highCovRatio ? "Hi-CovRatio": ""].filter(Boolean).join(", "),
  ]);

  const flagged = influence.map(d =>
    d.outlier || d.influential || d.highLeverage || d.highCookD || d.highDffits || d.highCovRatio);

  return {
    headers: ["Study", "RE (LOO)", "Δτ²", "Std. Residual", "DFBETA", "DFFITS", "CovRatio", "Hat", "Cook’s D", "Flag"],
    rows,
    flagged,
    note: `LOO = leave-one-out. Thresholds: Hat > ${fmt(2 / k)} (= 2/k); Cook’s D > ${fmt(4 / k)} (= 4/k); DFFITS > ${fmt(dffitsThresh)} (= 3·√(1/(k−1))); CovRatio > ${fmt(covRatioThresh)} (= 1+1/k).`,
  };
}

// ---------------------------------------------------------------------------
// Subgroup analysis
// ---------------------------------------------------------------------------

export function subgroupData(args) {
  const { subgroup, profile, ciLevel = "95" } = args;
  if (!subgroup || subgroup.G < 2) return null;
  const widthCiLabel = ciLevel + "% CI";

  const rows = Object.entries(subgroup.groups).map(([g, r]) => {
    const single = r.k === 1;
    const y_disp = profile.transform(r.y);
    const ci_lb  = profile.transform(r.ci.lb);
    const ci_ub  = profile.transform(r.ci.ub);
    return [
      g, String(r.k),
      isFinite(y_disp) ? fmt(y_disp)        : "—",
      single ? "—" : (isFinite(r.se)   ? fmt(r.se)        : "—"),
      single ? "—" : fmtCI_APA(ci_lb, ci_ub),
      single ? "—" : (isFinite(r.tau2) ? r.tau2.toFixed(3) : "0"),
      single ? "—" : (isFinite(r.I2)   ? r.I2.toFixed(1)   : "0"),
    ];
  });

  return {
    subtitle: `Subgroup Analysis Results (${profile.label})`,
    headers:  ["Group", "<em>k</em>", "Effect size", "SE", widthCiLabel, "τ²", "<em>I</em>² (%)"],
    rows,
    note:     `CI = confidence interval. <em>Q</em>_total(${subgroup.k - 1}) = ${subgroup.Qtotal.toFixed(3)}  ·  <em>Q</em>_within(${subgroup.k - subgroup.G}) = ${subgroup.Qwithin.toFixed(3)}  ·  <em>Q</em>_between(${subgroup.df}) = ${subgroup.Qbetween.toFixed(3)}, <em>p</em> ${fmtP_APA(subgroup.p)}.`,
    Qbetween: subgroup.Qbetween,
    df:       subgroup.df,
    p:        subgroup.p,
  };
}

// ---------------------------------------------------------------------------
// Study-level table
// ---------------------------------------------------------------------------

export function studyTableData(args) {
  const { studies, m, profile, ciLevel = "95" } = args;
  const widthCiLabel = ciLevel + "% CI";
  const tau2      = isFinite(m.tau2) ? m.tau2 : 0;
  const real      = studies.filter(d => !d.filled);
  const totalW    = real.reduce((s, d) => s + 1 / (d.vi + tau2), 0);
  const showFEcol = !m.isMH && !m.isPeto;
  const totalWfe  = showFEcol ? real.reduce((s, d) => s + 1 / d.vi, 0) : 0;

  const transformedScale = ["Ratio", "Hazard", "Rate", "log", "logit", "arcsine", "Freeman", "Fisher"]
    .some(t => profile.label.includes(t));
  const seLabel = transformedScale ? "SE (transformed)" : "SE";

  const fmtV   = v => isFinite(v) ? (+v).toFixed(3) : "—";
  const fmtPct = v => (v !== null && isFinite(v)) ? v.toFixed(1) + "%" : "—";

  const pooledEf = profile.transform(m.RE);
  const pooledLo = profile.transform(m.ciLow);
  const pooledHi = profile.transform(m.ciHigh);

  const headers = [`Study`, `Effect size (${profile.label})`, seLabel, widthCiLabel, "RE Weight (%)"];
  if (showFEcol) headers.push("FE Weight (%)");

  const rows = studies.map(d => {
    const wi    = 1 / (d.vi + tau2);
    const pct   = d.filled ? null : wi / totalW * 100;
    const pctFE = (showFEcol && !d.filled) ? (1 / d.vi) / totalWfe * 100 : null;
    const ef    = profile.transform(d.yi);
    const lo    = profile.transform(d.yi - Z_95 * d.se);
    const hi    = profile.transform(d.yi + Z_95 * d.se);
    const lbl   = d.label.length > 40 ? d.label.slice(0, 39) + "…" : d.label;
    const cells = [lbl, fmtV(ef), fmtV(d.se), fmtCI_APA(lo, hi), fmtPct(pct)];
    if (showFEcol) cells.push(fmtPct(pctFE));
    return cells;
  });

  const pooledRow = ["Pooled (RE)", fmtV(pooledEf), fmtV(m.seRE), fmtCI_APA(pooledLo, pooledHi), "100%"];
  if (showFEcol) pooledRow.push("100%");

  const weightNote = showFEcol ? "RE and FE weights shown." : "FE weights shown.";
  const note = `Effect size = ${profile.label}. SE = standard error. CI = confidence interval. ${weightNote}`
    + (studies.some(d => d.filled) ? " Trim-and-fill imputed rows are included." : "");

  const filled = studies.map(d => !!(d.filled));

  return { headers, rows, pooledRow, note, showFEcol, filled, seLabel };
}

// ---------------------------------------------------------------------------
// Meta-regression
// ---------------------------------------------------------------------------

export function regressionData(args) {
  const { reg, method, ciMethod, ciLevel = "95", adjPs = null, mccLabel = "" } = args;
  if (!reg || reg.rankDeficient || !reg.colNames) return null;
  const widthCiLabel = ciLevel + "% CI";

  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";
  const statLabel = reg.dist === "t" ? `<em>t</em>(${reg.QEdf})` : "<em>z</em>";
  const QMlabel   = reg.QMdist === "F"
    ? `<em>F</em>(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;
  const hasVif    = Array.isArray(reg.vif) && reg.vif.some(v => isFinite(v));
  const hasRobust = reg.isClustered && Array.isArray(reg.robustSE);

  const coefHeaders = ["Predictor", "β", "SE", statLabel, "<em>p</em>", widthCiLabel];
  if (hasVif) coefHeaders.push("VIF");
  if (hasRobust) coefHeaders.push("Rob. SE", "Rob. <em>t</em>", "Rob. <em>p</em>", "Rob. CI");

  const coefRows = reg.colNames.map((name, j) => {
    const [lo, hi] = reg.ci[j];
    const cells = [
      name, fmt(reg.beta[j]), fmt(reg.se[j]),
      fmt(reg.zval[j]), fmtP_APA(reg.pval[j]), fmtCI_APA(lo, hi),
    ];
    if (hasVif) cells.push(j === 0 ? "—" : (isFinite(reg.vif?.[j]) ? fmt(reg.vif[j]) : "—"));
    if (hasRobust) {
      const rci = Array.isArray(reg.robustCi?.[j]) ? reg.robustCi[j] : [NaN, NaN];
      cells.push(
        fmt(reg.robustSE[j]),
        isFinite(reg.robustZ?.[j]) ? fmt(reg.robustZ[j]) : "NA",
        fmtP_APA(reg.robustP?.[j]),
        fmtCI_APA(rci[0], rci[1]),
      );
    }
    return cells;
  });

  const R2str    = reg.p > 1 && isFinite(reg.R2) ? ` <em>R</em>² = ${fmt(reg.R2 * 100)}%.` : "";
  const clusterNote = hasRobust
    ? ` Cluster-robust SE (CR1): C = ${reg.clustersUsed} cluster${reg.clustersUsed === 1 ? "" : "s"}${reg.allSingletons ? "; all singletons (HC-robust)" : ""}.`
    : "";
  const coefNote = `β = unstandardised regression coefficient. SE = standard error. CI = confidence interval. `
    + `<em>Q</em>E(${reg.QEdf}) = ${fmt(reg.QE)}, <em>p</em> ${fmtP_APA(reg.QEp)}.`
    + (reg.p > 1 ? ` <em>Q</em>M ${QMlabel} = ${fmt(reg.QM)}, <em>p</em> ${fmtP_APA(reg.QMp)}.` : "")
    + R2str + clusterNote;

  const metaLine  = `k = ${reg.k}  ·  ${method}  ·  ${ciLabel}  ·  τ² = ${fmt(reg.tau2)}  ·  I² = ${fmt(reg.I2)}%`;
  const metaExtra = (reg.p > 1 && isFinite(reg.R2) ? ` · R² = ${fmt(reg.R2 * 100)}%` : "")
    + (isFinite(reg.AIC)
      ? ` · AIC = ${fmt(reg.AIC)} · BIC = ${fmt(reg.BIC)} · LL = ${fmt(reg.LL)}`
        + (ciMethod === "KH" && isFinite(reg.s2) ? ` · KH s² = ${fmt(reg.s2)}` : "")
      : "");

  let modTests = null;
  if (reg.modTests && reg.modTests.length > 1) {
    const modQlabel = reg.QMdist === "F" ? "<em>F</em>" : "χ²";
    const hasLRT    = reg.modTests.some(mt => isFinite(mt.lrt));
    const hasAdj    = Array.isArray(adjPs) && adjPs.length === reg.modTests.length;
    const modHeaders = [
      "Moderator", `${modQlabel} (Wald)`,
      ...(hasLRT ? ["LRT χ²"] : []),
      "<em>df</em>", "<em>p</em> (Wald)",
      ...(hasLRT ? ["<em>p</em> (LRT)"] : []),
      ...(hasAdj ? [`<em>p</em> (${mccLabel})`] : []),
    ];
    const modRows = reg.modTests.map((mt, mi) => [
      mt.name, fmt(mt.QM),
      ...(hasLRT ? [isFinite(mt.lrt) ? fmt(mt.lrt) : "NA"] : []),
      String(mt.QMdf), fmtP_APA(mt.QMp),
      ...(hasLRT ? [isFinite(mt.lrtP) ? fmtP_APA(mt.lrtP) : "NA"] : []),
      ...(hasAdj ? [fmtP_APA(adjPs[mi])] : []),
    ]);
    const lrtNote = hasLRT ? "LRT = Likelihood Ratio Test; uses ML estimation internally regardless of τ² method." : "";
    const adjNote = hasAdj ? ` ${mccLabel} correction applied across ${reg.modTests.length} moderator tests.` : "";
    modTests = {
      headers: modHeaders,
      rows:    modRows,
      note:    lrtNote + adjNote,
    };
  }

  return {
    metaLine,
    metaExtra,
    coef: { headers: coefHeaders, rows: coefRows, note: coefNote },
    modTests,
  };
}

// ---------------------------------------------------------------------------
// Location-scale model
// ---------------------------------------------------------------------------

export function locationScaleData(ls, ciLevel = "95") {
  if (!ls || ls.rankDeficient) return null;
  const widthCiLabel = ciLevel + "% CI";

  const tau2min = ls.tau2_i ? Math.min(...ls.tau2_i) : NaN;
  const tau2max = ls.tau2_i ? Math.max(...ls.tau2_i) : NaN;
  const tau2rng = ls.q > 1
    ? `τ² range: [${fmt(tau2min)}, ${fmt(tau2max)}]`
    : `τ² = ${fmt(ls.tau2_mean)}`;
  const metaLine = `k = ${ls.k}  ·  ML  ·  Normal CI  ·  ${tau2rng}  ·  I² = ${fmt(ls.I2)}%  ·  LL = ${fmt(ls.LL)}`;

  // Location coefficients (E[yᵢ] = Xᵢβ)
  const locHeaders = ["Term", "β", "SE", "<em>z</em>", "<em>p</em>", widthCiLabel];
  const locRows = ls.locColNames.map((name, j) => {
    const [lo, hi] = ls.ci_beta[j];
    return [name, fmt(ls.beta[j]), fmt(ls.se_beta[j]), fmt(ls.zval_beta[j]), fmtP_APA(ls.pval_beta[j]), fmtCI_APA(lo, hi)];
  });
  const QMlocStr = ls.p > 1 && isFinite(ls.QM_loc)
    ? ` <em>Q</em>M_loc χ²(${ls.QM_locDf}) = ${fmt(ls.QM_loc)}, <em>p</em> ${fmtP_APA(ls.QM_locP)}.`
    : "";
  const locNote = `β = location coefficient. <em>Q</em>E(${ls.QEdf}) = ${fmt(ls.QE)}, <em>p</em> ${fmtP_APA(ls.QEp)}.${QMlocStr}`;

  // Scale coefficients (log τ²ᵢ = Zᵢγ)
  const scaleHeaders = ["Term", "γ", "SE", "<em>z</em>", "<em>p</em>", widthCiLabel, "exp(γ)"];
  const scaleRows = ls.scaleColNames.map((name, j) => {
    const [lo, hi] = ls.ci_gamma[j];
    return [name, fmt(ls.gamma[j]), fmt(ls.se_gamma[j]), fmt(ls.zval_gamma[j]), fmtP_APA(ls.pval_gamma[j]), fmtCI_APA(lo, hi),
      j === 0 ? fmt(Math.exp(ls.gamma[j])) : ""];
  });
  const QMscaleStr = ls.q > 1 && isFinite(ls.QM_scale)
    ? ` <em>Q</em>M_scale χ²(${ls.QM_scaleDf}) = ${fmt(ls.QM_scale)}, <em>p</em> ${fmtP_APA(ls.QM_scaleP)}.`
    : "";
  const LRstr = ls.q > 1 && isFinite(ls.LRchi2)
    ? ` LR test (scale mods): χ²(${ls.LRdf}) = ${fmt(ls.LRchi2)}, <em>p</em> ${fmtP_APA(ls.LRp)}.`
    : "";
  const scaleNote = `γ = scale coefficient (log τ²ᵢ = Zᵢγ). exp(γ₀) = τ² when all scale predictors = 0.${QMscaleStr}${LRstr}`;

  // Fitted values + study-specific τ²ᵢ
  let fitted = null;
  if (ls.labels && ls.fitted) {
    fitted = {
      headers: ["Study", "<em>y</em>ᵢ", "<em>ŷ</em>ᵢ", "<em>e</em>ᵢ", "τ²ᵢ"],
      rows: ls.labels.map((lbl, i) => [
        lbl || String(i + 1), fmt(ls.yi[i]), fmt(ls.fitted[i]), fmt(ls.residuals[i]), fmt(ls.tau2_i[i]),
      ]),
      note: "τ²ᵢ = study-specific between-study variance from the scale model.",
    };
  }

  return { metaLine, locCoef: { headers: locHeaders, rows: locRows, note: locNote }, scaleCoef: { headers: scaleHeaders, rows: scaleRows, note: scaleNote }, fitted };
}

// ---------------------------------------------------------------------------
// Meta-regression fitted values & residuals
// ---------------------------------------------------------------------------

export function regressionFittedData(reg) {
  if (!reg || !reg.labels || !reg.fitted) return null;
  const headers = ["Study", "<em>y</em>ᵢ", "<em>ŷ</em>ᵢ", "<em>e</em>ᵢ", "Std. <em>e</em>ᵢ"];
  const rows = reg.labels.map((lbl, i) => {
    const sr    = reg.stdResiduals[i];
    const flag  = isFinite(sr) && Math.abs(sr) > Z_95;
    return { cells: [lbl || String(i + 1), fmt(reg.yi[i]), fmt(reg.fitted[i]), fmt(reg.residuals[i]), fmt(sr)], flag };
  });
  const note = "Std. <em>e</em>ᵢ = standardized residual. |Std. <em>e</em>ᵢ| > 1.96 may indicate outliers.";
  return { headers, rows, note };
}

// ---------------------------------------------------------------------------
// Permutation test
// ---------------------------------------------------------------------------

export function permPval(dist, observed) {
  if (!isFinite(observed)) return NaN;
  let exceeds = 0;
  for (let i = 0; i < dist.length; i++) { if (dist[i] >= observed) exceeds++; }
  return (1 + exceeds) / (dist.length + 1);
}

export function permutationData(permResult, reg) {
  if (!permResult || !reg) return null;
  const { QM_dist, modQM_dist, nPerm, nMods } = permResult;
  if (!QM_dist || !nPerm) return null;

  const omniLabel = reg.QMdist === "F"
    ? `<em>F</em>(${reg.QMdf}, ${reg.QEdf})`
    : `χ\xB2(${reg.QMdf})`;
  const omniP = permPval(QM_dist, reg.QM);

  const mods = [];
  if (nMods > 1 && Array.isArray(reg.modTests)) {
    for (let mi = 0; mi < reg.modTests.length; mi++) {
      const mt = reg.modTests[mi];
      if (mt.QMdf === 0 || !mt.colIdxs || mt.colIdxs.length === 0) {
        mods.push({ name: mt.name, label: "—", observed: NaN, p: NaN });
        continue;
      }
      const colDist = new Float64Array(nPerm);
      for (let r = 0; r < nPerm; r++) colDist[r] = modQM_dist[r * nMods + mi];
      const dfLabel = reg.QMdist === "F"
        ? `<em>F</em>(${mt.QMdf}, ${reg.QEdf})`
        : `χ\xB2(${mt.QMdf})`;
      mods.push({ name: mt.name, label: dfLabel, observed: mt.QM, p: permPval(colDist, mt.QM) });
    }
  }

  return { nPerm, omniLabel, omniObserved: reg.QM, omniP, mods };
}

// ---------------------------------------------------------------------------
// Robust Variance Estimation (RVE)
// ---------------------------------------------------------------------------

export function rveData(args) {
  const { rveResult, rveRho = 0.8, profile, ciLevel = "95" } = args;
  if (!rveResult || rveResult.error) return null;
  const widthCiLabel = ciLevel + "% CI";
  const est = profile.transform(rveResult.est);
  const lo  = profile.transform(rveResult.ci[0]);
  const hi  = profile.transform(rveResult.ci[1]);
  const rows = [
    ["Pooled estimate", `${fmt(est)}, ${widthCiLabel} [${fmt(lo)}, ${fmt(hi)}]`],
    ["SE", fmt(rveResult.se)],
    [`<em>t</em>(${rveResult.df})`, fmt(rveResult.t)],
    ["<em>p</em>", fmtP_APA(rveResult.p)],
    ["ρ (assumed within-cluster correlation)", fmt(rveRho)],
    ["m (clusters)", String(rveResult.kCluster)],
    ["<em>k</em> (studies)", String(rveResult.k)],
  ];
  const note = "RVE = robust variance estimation (Hedges, Tipton & Johnson, 2010). Working correlation model: ρ assumed constant within cluster.";
  return { headers: ["Parameter", "Value"], rows, note };
}

// ---------------------------------------------------------------------------
// Three-level meta-analysis
// ---------------------------------------------------------------------------

export function threeLevelData(args) {
  const { threeLevelResult, profile, ciLevel = "95" } = args;
  if (!threeLevelResult || threeLevelResult.error) return null;
  const tl = threeLevelResult;
  const widthCiLabel = ciLevel + "% CI";
  const mu = profile.transform(tl.mu);
  const lo = profile.transform(tl.ci[0]);
  const hi = profile.transform(tl.ci[1]);
  const rows = [
    ["Pooled estimate", `${fmt(mu)}, ${widthCiLabel} [${fmt(lo)}, ${fmt(hi)}]`],
    ["SE", fmt(tl.se)],
    ["<em>z</em>", fmt(tl.z)],
    ["<em>p</em>", fmtP_APA(tl.p)],
    ["σ²_within", fmt(tl.tau2_within)],
    ["σ²_between", fmt(tl.tau2_between)],
    ["<em>I</em>²_within", `${fmt(tl.I2_within)}%`],
    ["<em>I</em>²_between", `${fmt(tl.I2_between)}%`],
    [`<em>Q</em>(${tl.df})`, fmt(tl.Q)],
    ["m (clusters)", String(tl.kCluster)],
    ["<em>k</em> (studies)", String(tl.k)],
    ["Log-likelihood (REML)", fmt(tl.logLik)],
  ];
  const note = "Three-level model: studies nested within clusters. σ²_within = within-cluster, σ²_between = between-cluster between-study heterogeneity. REML estimation.";
  return { headers: ["Parameter", "Value"], rows, note };
}

// ---------------------------------------------------------------------------
// Sensitivity analysis (LOO + estimator comparison)
// ---------------------------------------------------------------------------

const TAU_LABELS = {
  DL: "DerSimonian-Laird (DL)", REML: "REML", PM: "Paule-Mandel (PM)",
  EB: "Empirical Bayes (EB)", PMM: "PM-Median (PMM)", GENQM: "GENQ-Median",
  ML: "Maximum Likelihood (ML)", HS: "Hunter-Schmidt (HS)", HE: "Hedges (HE)",
  SJ: "Sidik-Jonkman (SJ)", GENQ: "GENQ", SQGENQ: "SQGENQ",
  DLIT: "DLIT", EBLUP: "EBLUP", HSk: "HSk",
};

function sensFv(v)  { return isFinite(v) ? v.toFixed(3) : "—"; }
function sensFvp(v) { return isFinite(v) ? (v < 0.001 ? "< .001" : v.toFixed(3).replace(/^0\./, ".")) : "—"; }

export function sensitivityData(args) {
  const { studies, m, method, ciMethod, profile, ciLevel = "95", alpha = 0.05 } = args;
  if (!studies || studies.length < 2) return null;

  const widthCiLabel = ciLevel + "% CI";
  const realStudies = studies.filter(d => !d.filled);

  // ── Leave-one-out ──────────────────────────────────────────────────────────
  const loo     = leaveOneOut(realStudies, method, ciMethod, m, alpha);
  const fullSig = loo.full.pval < 0.05;
  const fullEst = profile.transform(loo.full.RE);

  const looHeaders = ["Study omitted", "Estimate", `${widthCiLabel} (low)`, `${widthCiLabel} (high)`, "<em>I</em>² (%)", "τ²", "<em>p</em>", "Δ estimate"];
  const looRows = loo.rows.map(row => {
    const est   = profile.transform(row.estimate);
    const lo    = profile.transform(row.lb);
    const hi    = profile.transform(row.ub);
    const delta = est - fullEst;
    return [
      row.label,
      sensFv(est),
      sensFv(lo),
      sensFv(hi),
      sensFv(row.i2),
      sensFv(row.tau2),
      sensFvp(row.pval),
      (delta >= 0 ? "+" : "") + sensFv(delta),
    ];
  });
  const sigChanges = loo.rows.map(row => row.significant !== fullSig);
  const looNote = "Rows marked * change statistical significance (<em>p</em> = .05 threshold) when that study is omitted. Δ estimate = LOO estimate minus full-set estimate.";

  // ── Estimator comparison ───────────────────────────────────────────────────
  const estData = estimatorComparison(realStudies, ciMethod);
  const estHeaders = ["τ² Estimator", "Estimate", `${widthCiLabel} (low)`, `${widthCiLabel} (high)`, "τ²", "<em>I</em>² (%)"];
  const estRows = estData.map(row => {
    const isCurrent = row.method === method;
    return [
      (TAU_LABELS[row.method] ?? row.method) + (isCurrent ? " ★" : ""),
      sensFv(profile.transform(row.estimate)),
      sensFv(profile.transform(row.lb)),
      sensFv(profile.transform(row.ub)),
      sensFv(row.tau2),
      sensFv(row.i2),
    ];
  });
  const estNote = "★ = currently selected estimator. Estimates on the same scale as the primary analysis.";

  return { loo: { headers: looHeaders, rows: looRows, sigChanges, note: looNote }, est: { headers: estHeaders, rows: estRows, note: estNote } };
}
