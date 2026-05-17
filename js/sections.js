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
    [profile.label + " — Fixed Effects (FE)", fmt(FE_disp)],
    ["FE " + widthCiLabel, fmtCI_APA(feCi.lb, feCi.ub)],
    ...(!isMHorPeto ? [[profile.label + " — Random Effects (RE)", fmt(RE_disp)]] : []),
    ...(!isMHorPeto ? [["RE " + widthCiLabel, fmtCI_APA(ci.lb, ci.ub)]] : []),
    ...(isMHorPeto  ? [[widthCiLabel, fmtCI_APA(ci.lb, ci.ub)]] : []),
    ...(cles        ? [["CLES (RE)", `${fmt(cles.estimate)} [${fmt(cles.ci[0])}, ${fmt(cles.ci[1])}]`]] : []),
    ...(RE_adj !== null ? [["RE (trim-and-fill adjusted)", fmt(RE_adj)]] : []),
    ...(!isMHorPeto ? [["95% Prediction interval (PI)", fmtCI_APA(pred.lb, pred.ub)]] : []),
    ...(!isMHorPeto ? [["τ²", `${fmt(m.tau2)} [${tauCI1}, ${tauCI2}]`]] : []),
    ["I²", `${fmt(m.I2)}% [${fmt(m.I2CI?.[0])}%, ${fmt(m.I2CI?.[1])}%]`],
    ...(!isMHorPeto ? [["H²-CI", `[${fmt(m.H2CI?.[0])}, ${H2hi}]`]] : []),
    [`Q (df = ${m.df})`, fmt(m.Q)],
    ...(m.dist ? [[`${m.dist}-statistic`, `${fmt(m.stat)}, p ${fmtP_APA(m.pval)}`]] : []),
    ...(m.isClustered ? [[
      `Robust CI (C = ${m.clustersUsed} clusters)`,
      `${fmtCI_APA(profile.transform(m.robustCiLow), profile.transform(m.robustCiHigh))}  ·  SE = ${fmt(m.robustSE)}  ·  z = ${fmt(m.robustStat)}, p ${fmtP_APA(m.robustPval)}`,
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
    reRowIdx: !isMHorPeto ? 2 : -1,
  };
}

// ---------------------------------------------------------------------------
// Publication bias
// ---------------------------------------------------------------------------

export function pubBiasData(args) {
  const { egger, begg, fatpet, fsn, tes, waap, harbord, peters, deeks, ruecker, hc,
          useTF, tf, profile } = args;

  const na  = v => isFinite(v) ? fmt(v) : "—";
  const naP = v => isFinite(v) ? fmtP_APA(v) : "NA";

  const petEff = isFinite(fatpet?.intercept) ? fmt(profile.transform(fatpet.intercept)) : "—";

  const rows = [
    ["Egger’s test (intercept)",              na(egger?.intercept),   naP(egger?.p)],
    ["Begg’s test (rank correlation τ)", na(begg?.tau),          naP(begg?.p)],
    ["FAT — β₁ (bias)",             na(fatpet?.slope),      naP(fatpet?.slopeP)],
    ["PET — effect at SE → 0",           petEff,                 naP(fatpet?.interceptP)],
    ["Harbord (intercept)",                         na(harbord?.intercept), naP(harbord?.interceptP)],
    ["Peters (intercept)",                          na(peters?.intercept),  naP(peters?.interceptP)],
    ["Deeks (intercept)",                           na(deeks?.intercept),   naP(deeks?.interceptP)],
    ["Rücker (intercept)",                    na(ruecker?.intercept), naP(ruecker?.interceptP)],
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

  const note = "FAT = funnel asymmetry test; PET = precision-effect test. "
    + "Harbord, Peters, Deeks, and Rücker are binary-outcome variants of the Egger test; "
    + "TES = test of excess significance; "
    + "WAAP-WLS = weighted average of adequately powered studies; statistic is bias-corrected effect estimate [95% CI]; "
    + "Henmi-Copas = bias-robust CI centred on FE estimate (DL τ²). "
    + "NA = fewer than 3 eligible studies or missing cell counts.";

  return { headers: ["Test", "Statistic", "p"], rows, note, fsnLine };
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
  const ciLo  = fmtDisp(sel.mu - 1.96 * sel.se_mu);
  const ciHi  = fmtDisp(sel.mu + 1.96 * sel.se_mu);

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
      [`LRT (H₀: no selection)`, `χ²(${sel.LRTdf}) = ${fmtV(sel.LRT)}, p ${fmtP_APA(sel.LRTp)}`],
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

  const rows = influence.map(d => [
    d.label,
    isFinite(d.RE_loo)      ? fmt(d.RE_loo)      : "—",
    isFinite(d.deltaTau2)   ? fmt(d.deltaTau2)   : "—",
    isFinite(d.stdResidual) ? fmt(d.stdResidual) : "—",
    isFinite(d.DFBETA)      ? fmt(d.DFBETA)      : "—",
    isFinite(d.hat)         ? d.hat.toFixed(3)   : "—",
    isFinite(d.cookD)       ? d.cookD.toFixed(3) : "—",
    [d.outlier ? "Outlier" : "", d.influential ? "Influential" : "",
     d.highLeverage ? "Hi-Lev" : "", d.highCookD ? "Hi-Cook" : ""].filter(Boolean).join(", "),
  ]);

  const flagged = influence.map(d => d.outlier || d.influential || d.highLeverage || d.highCookD);

  return {
    headers: ["Study", "RE (LOO)", "Δτ²", "Std. Residual", "DFBETA", "Hat", "Cook’s D", "Flag"],
    rows,
    flagged,
    note: `LOO = leave-one-out. Threshold: Hat > ${fmt(2 / k)} (= 2/k); Cook’s D > ${fmt(4 / k)} (= 4/k).`,
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
    headers:  ["Group", "k", "Effect size", "SE", widthCiLabel, "τ²", "I² (%)"],
    rows,
    note:     `CI = confidence interval. Q_between = ${subgroup.Qbetween.toFixed(3)}, df = ${subgroup.df}, p ${fmtP_APA(subgroup.p)}.`,
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
  const { reg, method, ciMethod, ciLevel = "95" } = args;
  if (!reg || reg.rankDeficient || !reg.colNames) return null;
  const widthCiLabel = ciLevel + "% CI";

  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";
  const statLabel = reg.dist === "t" ? `<em>t</em>(${reg.QEdf})` : "<em>z</em>";
  const QMlabel   = reg.QMdist === "F"
    ? `<em>F</em>(${reg.QMdf}, ${reg.QEdf})`
    : `χ²(${reg.QMdf})`;
  const hasVif    = Array.isArray(reg.vif) && reg.vif.some(v => isFinite(v));

  const coefHeaders = ["Predictor", "β", "SE", statLabel, "<em>p</em>", widthCiLabel];
  if (hasVif) coefHeaders.push("VIF");

  const coefRows = reg.colNames.map((name, j) => {
    const [lo, hi] = reg.ci[j];
    const cells = [
      name, fmt(reg.beta[j]), fmt(reg.se[j]),
      fmt(reg.zval[j]), fmtP_APA(reg.pval[j]), fmtCI_APA(lo, hi),
    ];
    if (hasVif) cells.push(j === 0 ? "—" : (isFinite(reg.vif?.[j]) ? fmt(reg.vif[j]) : "—"));
    return cells;
  });

  const R2str    = reg.p > 1 && isFinite(reg.R2) ? ` <em>R</em>² = ${fmt(reg.R2 * 100)}%.` : "";
  const coefNote = `β = unstandardised regression coefficient. SE = standard error. CI = confidence interval. `
    + `<em>Q</em>E(${reg.QEdf}) = ${fmt(reg.QE)}, <em>p</em> ${fmtP_APA(reg.QEp)}.`
    + (reg.p > 1 ? ` <em>Q</em>M ${QMlabel} = ${fmt(reg.QM)}, <em>p</em> ${fmtP_APA(reg.QMp)}.` : "")
    + R2str;

  const metaLine = `k = ${reg.k}  ·  ${method}  ·  ${ciLabel}  ·  τ² = ${fmt(reg.tau2)}  ·  I² = ${fmt(reg.I2)}%`;

  let modTests = null;
  if (reg.modTests && reg.modTests.length > 1) {
    const modQlabel = reg.QMdist === "F" ? "<em>F</em>" : "χ²";
    const hasLRT    = reg.modTests.some(mt => isFinite(mt.lrt));
    const modHeaders = [
      "Moderator", `${modQlabel} (Wald)`,
      ...(hasLRT ? ["LRT χ²"] : []),
      "df", "<em>p</em> (Wald)",
      ...(hasLRT ? ["<em>p</em> (LRT)"] : []),
    ];
    const modRows = reg.modTests.map(mt => [
      mt.name, fmt(mt.QM),
      ...(hasLRT ? [isFinite(mt.lrt) ? fmt(mt.lrt) : "NA"] : []),
      String(mt.QMdf), fmtP_APA(mt.QMp),
      ...(hasLRT ? [isFinite(mt.lrtP) ? fmtP_APA(mt.lrtP) : "NA"] : []),
    ]);
    modTests = {
      headers: modHeaders,
      rows:    modRows,
      note:    hasLRT ? "LRT = Likelihood Ratio Test; uses ML estimation internally regardless of τ² method." : "",
    };
  }

  return {
    metaLine,
    coef: { headers: coefHeaders, rows: coefRows, note: coefNote },
    modTests,
  };
}
