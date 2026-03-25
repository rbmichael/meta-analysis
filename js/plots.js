// =============================================================================
// plots.js — D3 plot renderers
// =============================================================================
// Renders all SVG visualisations directly into named DOM elements.
// Each function is stateless: it clears its target SVG, then redraws from
// scratch using the data passed in.  No function in this file reads from the
// DOM beyond the SVG container and the shared #tooltip element.
//
// Exports
// -------
//   drawForest(studies, m, options)
//     Forest plot with paginated study rows, FE/RE/Both pooled diamonds,
//     prediction interval, heterogeneity summary, and annotation columns.
//     options: { ciMethod, profile, pageSize, page, pooledDisplay }
//     Returns { totalPages }.
//
//   drawFunnel(studies, m, egger, profile)
//     Funnel plot (effect vs. SE) with optional Egger regression line.
//
//   drawInfluencePlot(studies, influence)
//     Influence diagnostics plot (Cook's D, hat values, DFFITS per study).
//
//   drawCumulativeForest(steps, profile)
//     Cumulative forest plot: one row per cumulative step, showing how the
//     pooled estimate evolves as studies are added in order.
//
//   drawCumulativeFunnel(cumulativeStudies, cumResults, profile, stepIdx)
//     Cumulative funnel plot: shows the funnel at one cumulative step at a
//     time.  Axes are globally fixed (all studies) so the view is stable as
//     the slider advances.  The newly added study is highlighted in accent.
//
//   drawBubble(studies, reg, modName, modIdx, container)
//     Bubble plot for a single continuous moderator in a meta-regression.
//     Bubble radius ∝ √(RE weight); regression line is the marginal fit.
//
//   drawOrchardPlot(studies, m, profile)
//     Orchard plot (Nakagawa et al., 2021): precision-weighted jittered study
//     circles with pooled PI bar, CI bar, and RE diamond at the band centre.
//     One band per group when groups are present.
//
//   drawCaterpillarPlot(studies, m, profile)
//     Caterpillar plot: one horizontal CI segment per study, sorted by effect
//     size descending.  Vertical lines mark the null and RE estimate.
//     SVG height resizes dynamically (16 px/study, capped at 900 px).
//
//   drawBaujatPlot(result, profile)
//     Baujat diagnostic scatter (Baujat et al., 2002): x = contribution to Q,
//     y = influence on FE pooled estimate.  Quadrant guides at mean x/y.
//
// All plots use CSS custom properties (var(--fg), var(--accent), etc.) so
// they respond automatically to light/dark theme switches.
//
// Dependencies: utils.js (chiSquareCDF), constants.js (Z_95), D3 (global)
// =============================================================================

import { chiSquareCDF } from "./utils.js";
import { Z_95 } from "./constants.js";
import { FOREST_THEMES } from "./forestThemes.js";

// ================= BUBBLE PLOT =================
// One bubble chart per continuous moderator.
// Bubble radius ∝ √(RE weight).  Regression line is the marginal fit:
// ŷ(x) = β₀ + β_j·x + Σ_{i≠j} β_i · wmean(X_i)   (other predictors at their weighted means).
export function drawBubble(studies, reg, modName, modIdx, container) {
  const W = 460, H = 340;
  const margin = { top: 34, right: 18, bottom: 52, left: 56 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  // studies is already the regression's studiesUsed set (all moderators valid).
  // Guard against any residual edge cases.
  const valid = studies.filter(s => isFinite(s[modName]) && isFinite(s.yi) && isFinite(s.vi));
  if (valid.length < 2) return;

  const tau2  = isFinite(reg.tau2) ? reg.tau2 : 0;
  const wArr  = valid.map(s => 1 / (s.vi + tau2));
  const wSum  = wArr.reduce((a, b) => a + b, 0);
  const wMax  = Math.max(...wArr);
  const rMax  = 15;

  // ---- Marginal line: hold every other predictor at its RE-weighted mean ----
  const { beta, colNames, vcov, crit, s2 } = reg;

  function colValues(col) {
    if (col.includes(':')) {
      const [key, level] = col.split(':');
      return valid.map(s => s[key] === level ? 1 : 0);
    }
    return valid.map(s => +s[col]);
  }

  // wmeans[i] = weighted mean of column i (0 for intercept, 0 placeholder for modIdx).
  // The vector l(x) used for SE: l = wmeans with l[modIdx] = x, l[0] = 1.
  const wmeans = new Array(colNames.length).fill(0);
  wmeans[0] = 1;

  let intercept0 = beta[0];
  for (let i = 1; i < colNames.length; i++) {
    if (i === modIdx) continue;
    const vals = colValues(colNames[i]);
    const wm   = vals.reduce((s, v, k) => s + wArr[k] * v, 0) / wSum;
    wmeans[i]  = wm;
    intercept0 += beta[i] * wm;
  }
  const slope = beta[modIdx];

  // seAt(x) → number
  // Standard error of the regression line's fitted value at moderator value x.
  // Uses the delta method: SE = √(l(x)ᵀ · Vcov · l(x) · s²), where l(x) is
  // the predictor vector with all covariates held at their weighted means
  // except the focal moderator, which is set to x.  Used to draw the shaded
  // confidence band around the regression line in the bubble plot.
  // Returns NaN when the variance-covariance matrix is unavailable.
  function seAt(x) {
    if (!vcov) return NaN;
    const l = wmeans.slice();
    l[modIdx] = x;
    let q = 0;
    for (let r = 0; r < l.length; r++)
      for (let c = 0; c < l.length; c++)
        q += l[r] * vcov[r][c] * l[c];
    return Math.sqrt(Math.max(0, q) * s2);
  }

  // ---- Scales ----
  const xVals = valid.map(s => s[modName]);
  const [xMin, xMax] = d3.extent(xVals);
  const xPad = (xMax - xMin) * 0.12 || 0.5;
  const xScale = d3.scaleLinear().domain([xMin - xPad, xMax + xPad]).range([0, iW]);

  const yVals = valid.map(s => s.yi);
  const [yMin, yMax] = d3.extent(yVals);
  const yPad = (yMax - yMin) * 0.15 || 0.2;
  const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).nice().range([iH, 0]);

  // ---- SVG ----
  const svg = d3.select(container).append("svg").attr("width", W).attr("height", H);
  const g   = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Zero line
  const [yd0, yd1] = yScale.domain();
  if (yd0 < 0 && yd1 > 0) {
    g.append("line")
      .attr("x1", 0).attr("x2", iW)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "var(--border-hover)").attr("stroke-dasharray", "4,2");
  }

  // Prediction band + regression line (band drawn first, behind line)
  if (isFinite(slope) && isFinite(intercept0)) {
    const [xl, xr] = xScale.domain();
    const nPts = 80;
    const step = (xr - xl) / (nPts - 1);
    const pts  = Array.from({ length: nPts }, (_, i) => xl + i * step);

    // Shaded band
    if (vcov && isFinite(crit)) {
      const area = d3.area()
        .x(x  => xScale(x))
        .y0(x => yScale(intercept0 + slope * x - crit * seAt(x)))
        .y1(x => yScale(intercept0 + slope * x + crit * seAt(x)));
      g.append("path")
        .datum(pts)
        .attr("fill", "var(--accent-glow)")
        .attr("stroke", "none")
        .attr("d", area);
    }

    // Regression line
    g.append("line")
      .attr("x1", xScale(xl)).attr("y1", yScale(intercept0 + slope * xl))
      .attr("x2", xScale(xr)).attr("y2", yScale(intercept0 + slope * xr))
      .attr("stroke", "var(--accent)").attr("stroke-width", 2);
  }

  // Bubbles
  const tooltip = d3.select("#tooltip");
  g.selectAll("circle")
    .data(valid)
    .enter().append("circle")
    .attr("cx", s => xScale(s[modName]))
    .attr("cy", s => yScale(s.yi))
    .attr("r",  (s, i) => Math.max(3, rMax * Math.sqrt(wArr[i] / wMax)))
    .attr("fill",   "var(--bg-surface-hover)")
    .attr("stroke", "var(--fg-subtle)")
    .attr("stroke-width", 1.2)
    .on("mousemove", (event, s) => {
      const fitted = intercept0 + slope * s[modName];
      tooltip.style("opacity", 1)
        .html(`<b>${s.label}</b><br>${modName}: ${s[modName]}<br>yi: ${s.yi.toFixed(3)}<br>ŷ: ${fitted.toFixed(3)}`)
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY - 24) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));

  // Axes
  g.append("g").attr("transform", `translate(0,${iH})`).call(d3.axisBottom(xScale).ticks(5));
  g.append("g").call(d3.axisLeft(yScale).ticks(5));

  // Axis labels
  g.append("text")
    .attr("x", iW / 2).attr("y", iH + 42)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "12px")
    .text(modName);

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -iH / 2).attr("y", -44)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "12px")
    .text("Effect size (yi)");

  // Title
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 16)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)").style("font-size", "13px")
    .text(`${modName}  (β = ${isFinite(slope) ? slope.toFixed(3) : "NA"})`);
}

// -----------------------------------------------------------------------------
// drawForest(studies, m, options) → { totalPages }
// -----------------------------------------------------------------------------
// Renders the forest plot into the #forestPlot SVG element using D3.
// Handles pagination, adaptive row sizing, subgroup separators, weight boxes,
// and one or two pooled diamonds (FE / RE / Both).
//
// Parameters
// ----------
//   studies  — array of study objects produced by profile.compute(); each must
//              have: { yi, vi, se, w, label, group?, filled? }
//              May include trim-fill imputed studies (flagged by filled: true).
//   m        — output of meta(); must have: FE, seFE, RE, ciLow, ciHigh,
//              predLow, predHigh, tau2, I2, crit, dist, stat, pval, df
//   options  — optional configuration object:
//     ciMethod      — CI method string for title label ("normal" | "t" | "KH" |
//                     "PL"); default "normal"
//     profile       — effect profile with .transform(x) for back-transform;
//                     default identity
//     pooledDisplay — "FE" | "RE" | "Both"; controls which diamond(s) appear
//                     on the last page; default "RE"
//     pageSize      — studies per page; Infinity = single page; default 30
//     page          — 0-based page index; default 0
//
// Return value
// ------------
//   { totalPages }  — total number of pages at the current pageSize, so the
//                     caller can render navigation buttons
//
// Layout strategy
// ---------------
//   All coordinates derive from a single layout object L computed at render
//   time, keyed to the total study count k so that row heights and font sizes
//   adapt uniformly across all pages:
//     k ≤ 20  → rowH 22px, 11px labels
//     k ≤ 40  → rowH 18px, 10px labels
//     k > 40  → rowH 14px,  9px labels
//
//   Column layout (left → right):
//     [labelW 180px] [plotW 440px] [annotW 240px]  = 860px total
//
//   Subgroup separators are inserted when consecutive studies differ in their
//   .group field, pushing subsequent rows down by L.sepH.
//
//   The summary section (last page only) adds diamond(s), a PI bracket,
//   heterogeneity text, and the D3 axis with tick labels. summaryH is sized
//   to fit both diamonds when pooledDisplay = "Both".
//
// Rendering order
// ---------------
//   title → null reference line → study CI lines → weight boxes →
//   study labels → annotation column → group separators → axis →
//   (last page) diamond(s) → PI bracket → heterogeneity annotation
// -----------------------------------------------------------------------------
export function drawForest(studies, m, options = {}) {
  const svg = d3.select("#forestPlot");
  svg.selectAll("*").remove();

  const tooltip = d3.select("#tooltip");
  const ciMethod = options.ciMethod || "normal";
  // Identity profile as fallback (MD/SMD/etc. that don't need back-transform)
  const profile = options.profile || { transform: x => x };

  // Resolve visual theme — falls back to "default" (CSS vars) for unknown keys.
  const T = FOREST_THEMES[options.theme] ?? FOREST_THEMES["default"];

  // Which pooled estimates to show: "FE", "RE" (default), or "Both"
  const pooledDisplay = options.pooledDisplay || "RE";
  const showFE   = pooledDisplay === "FE"   || pooledDisplay === "Both";
  const showRE   = pooledDisplay === "RE"   || pooledDisplay === "Both";
  const showBoth = showFE && showRE;

  // FE CI bounds always use Z_95 (FE model is always normal)
  const feCiLow  = isFinite(m.FE) ? m.FE - Z_95 * m.seFE : NaN;
  const feCiHigh = isFinite(m.FE) ? m.FE + Z_95 * m.seFE : NaN;

  // crit: pooled-model critical value (used only for the RE diamond)
  const crit = m.crit || Z_95;
  // studyCrit: always Z_95 — individual study CIs are standard normal regardless of CI method
  const studyCrit = Z_95;

  // CI method label
  const ciLabel = {
    normal: "Normal (z)",
    t: "t-distribution",
    KH: "Knapp-Hartung",
    PL: "Profile Likelihood"
  }[ciMethod] || ciMethod;

  // ----------- PAGINATION -----------
  // pageSize === Infinity means "show all studies on one page".
  const rawPageSize  = options.pageSize ?? 30;
  const pageSize     = rawPageSize === Infinity ? studies.length : rawPageSize;
  const page         = options.page ?? 0;
  const totalPages   = Math.max(1, Math.ceil(studies.length / pageSize));
  const isLastPage   = page >= totalPages - 1;

  // Slice to the studies visible on this page.
  const pageStudies  = studies.slice(page * pageSize, (page + 1) * pageSize);

  // ----------- LAYOUT -----------
  // All coordinates are derived from this single object so that
  // adding/removing studies resizes the SVG automatically.
  // Row height and font sizes are chosen from the TOTAL study count so that
  // all pages share the same visual density regardless of how many rows
  // appear on each individual page.
  const k = studies.length;           // total — governs adaptive size breakpoints

  const L = k <= 20
    ? { rowH: 22, labelFontSize: "11px", annotFontSize: "10px", titleFontSize: "12px", boxHalf: 5, diamondHH: 8 }
    : k <= 40
    ? { rowH: 18, labelFontSize: "10px", annotFontSize: "9px",  titleFontSize: "11px", boxHalf: 4, diamondHH: 7 }
    : { rowH: 14, labelFontSize: "9px",  annotFontSize: "8px",  titleFontSize: "10px", boxHalf: 3, diamondHH: 6 };

  // Fixed dimensions (independent of k)
  L.plotW    = 440;
  L.annotW   = 240;
  L.headerH  = 28;
  L.summaryH = 106;

  // Dynamic label column: sized to the longest study or group label.
  // charW approximates the advance width of the chosen font size.
  const _charW   = parseFloat(L.labelFontSize) >= 11 ? 6.5 : parseFloat(L.labelFontSize) >= 10 ? 5.9 : 5.3;
  const _maxStudy = studies.reduce((m, d) => Math.max(m, (d.label || "").length), 0);
  const _maxGroup = studies.reduce((m, d) => Math.max(m, (d.group || "").length), 0);
  // Diamond row labels ("Random-effects", "Fixed-effect") are also right-aligned in the
  // label column, so they must be included in the width calculation.
  const _diamondLabelLen = showBoth ? 6 : 14; // "Random" vs "Random-effects"
  const _maxLen   = Math.min(Math.max(_maxStudy, _maxGroup, _diamondLabelLen), 28);
  L.labelW   = Math.max(70, Math.min(180, Math.ceil(_maxLen * _charW) + 16));

  // Derived total width and annotation offset
  L.totalW   = L.labelW + L.plotW + L.annotW;

  // summaryH must accommodate: separator, diamond row(s), PI, het text, axis + tick labels.
  // Axis tick labels need ~26px below the axis line to remain within the SVG.
  L.summaryH = isLastPage ? (showBoth ? 152 : 132) : 52;
  L.studyY0  = L.headerH;
  L.sepH     = Math.max(14, L.rowH);                    // separator row height for group boundaries

  // ----------- Y-POSITION MAP -----------
  // Compute the vertical centre of every study row, inserting a separator gap
  // whenever the group field changes.  When no study has a group, this
  // degenerates to a simple uniform grid identical to scaleBand(padding=0).
  const hasGroups = studies.some(d => d.group && d.group.trim() !== "");
  const yPos       = {};       // label → centre-y of that row
  const separators = [];       // { y: topY, group: name } — drawn between groups
  let cursor   = L.studyY0;
  let prevGroup = null;

  pageStudies.forEach(d => {
    const group = (d.group || "").trim();
    if (hasGroups && prevGroup !== null && group !== prevGroup) {
      separators.push({ y: cursor, group });
      cursor += L.sepH;
    }
    yPos[d.label] = cursor + L.rowH / 2;
    cursor += L.rowH;
    prevGroup = hasGroups ? group : null;
  });

  // Derived positions — studyY1 now reflects separator gaps
  L.studyY1    = cursor;
  L.totalH     = L.studyY1 + L.summaryH;
  // axisY: leave 26px below the axis for tick labels and optional "(log scale)" text.
  L.axisY      = L.totalH - 26;
  // Diamond rows sit below the study block; when showing both, FE is above RE.
  L.feDiamondY = L.studyY1 + 18;
  L.diamondY   = showBoth ? L.studyY1 + 36 : L.studyY1 + 18;   // RE (or sole) diamond
  L.piY        = showBoth ? L.studyY1 + 60 : L.studyY1 + 44;
  L.hetY       = showBoth ? L.studyY1 + 98 : L.studyY1 + 80;
  L.annotX0    = L.labelW  + L.plotW;

  // Resize SVG to fit the current study count
  svg.attr("width", L.totalW).attr("height", L.totalH);

  // Background rect — journal presets need an explicit white fill so that
  // exported SVGs are self-contained.  The default theme is transparent (the
  // page CSS provides the background colour).
  if (T.bg && T.bg !== "transparent") {
    svg.insert("rect", ":first-child")
      .attr("width", L.totalW)
      .attr("height", L.totalH)
      .attr("fill", T.bg);
  }

  // ----------- SCALES -----------
  // Collect all values that must fit inside the plot strip:
  //   study CIs (±1.96·se), pooled CI, and prediction interval.
  const domainVals = studies.flatMap(d => [
    d.yi - studyCrit * d.se,
    d.yi + studyCrit * d.se,
  ]);
  if (showRE) {
    if (isFinite(m.ciLow))    domainVals.push(m.ciLow);
    if (isFinite(m.ciHigh))   domainVals.push(m.ciHigh);
    if (isFinite(m.predLow))  domainVals.push(m.predLow);
    if (isFinite(m.predHigh)) domainVals.push(m.predHigh);
  }
  if (showFE) {
    if (isFinite(feCiLow))    domainVals.push(feCiLow);
    if (isFinite(feCiHigh))   domainVals.push(feCiHigh);
  }

  const x = d3.scaleLinear()
    .domain(d3.extent(domainVals))
    .nice()
    .range([L.labelW, L.labelW + L.plotW]);

  // ----------- TITLE -----------
  svg.append("text")
    .attr("x", L.labelW + L.plotW / 2)
    .attr("y", L.headerH / 2 + 5)
    .attr("text-anchor", "middle")
    .attr("fill", T.fgMuted)
    .style("font-size", L.titleFontSize)
    .style("font-family", T.fontFamily)
    .text(showBoth
      ? `Fixed-effect and Random-effects models (RE: ${ciLabel})`
      : showFE
        ? "Fixed-effect model"
        : `Random-effects model (${ciLabel})`);

  // ----------- NULL REFERENCE LINE -----------
  // Only draw if the null value (0 on the internal scale) falls inside the plot strip.
  const nullX = x(0);
  if (nullX >= L.labelW && nullX <= L.labelW + L.plotW) {
    svg.append("line")
      .attr("x1", nullX).attr("x2", nullX)
      .attr("y1", L.studyY0).attr("y2", isLastPage ? L.diamondY + L.diamondHH : L.studyY1)
      .attr("stroke", T.border)
      .attr("stroke-dasharray", T.nullLineDash);
  }

  // ----------- STUDY CIs -----------
  svg.selectAll("line.ci")
    .data(pageStudies)
    .enter()
    .append("line")
    .attr("x1", d => x(d.yi - studyCrit * d.se))
    .attr("x2", d => x(d.yi + studyCrit * d.se))
    .attr("y1", d => yPos[d.label])
    .attr("y2", d => yPos[d.label])
    .attr("stroke", d => d.filled ? T.fgMuted : T.fgSubtle)
    .attr("stroke-width", T.ciStrokeWidth);

  // ----------- WEIGHTS (BOXES) -----------
  // wMax from full studies so box sizes are comparable across pages.
  const wMax = d3.max(studies, d => d.w);

  svg.selectAll("rect")
    .data(pageStudies)
    .enter()
    .append("rect")
    .attr("x", d => x(d.yi) - Math.sqrt(d.w / wMax) * L.boxHalf * 2)
    .attr("y", d => yPos[d.label] - L.boxHalf)
    .attr("width", d => Math.sqrt(d.w / wMax) * L.boxHalf * 4)
    .attr("height", L.boxHalf * 2)
    .attr("fill", d => d.filled ? "none" : T.accent)
    .attr("stroke", d => d.filled ? T.fgMuted : T.accent)
    .on("mousemove", (e, d) => {
      const ef_disp = profile.transform(d.yi);
      const lo_disp = profile.transform(d.yi - studyCrit * d.se);
      const hi_disp = profile.transform(d.yi + studyCrit * d.se);
      tooltip.style("opacity", 1)
        .html(`
          ${d.label}<br>
          Effect: ${isFinite(ef_disp) ? ef_disp.toFixed(3) : "NA"}<br>
          CI (${ciLabel}): ${isFinite(lo_disp) ? lo_disp.toFixed(3) : "NA"} – ${isFinite(hi_disp) ? hi_disp.toFixed(3) : "NA"}
        `)
        .style("left", (e.pageX + 10) + "px")
        .style("top", (e.pageY - 20) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));

  // ----------- AXES -----------
  const axisG = svg.append("g")
    .attr("transform", `translate(0,${L.axisY})`)
    .call(d3.axisBottom(x).tickFormat(v => {
      const d = profile.transform(v);
      return isFinite(d) ? +d.toFixed(3) : "";
    }));

  // Apply theme colours to D3-generated axis elements (path, ticks, tick labels)
  axisG.select(".domain").attr("stroke", T.border);
  axisG.selectAll(".tick line").attr("stroke", T.border);
  axisG.selectAll(".tick text")
    .attr("fill", T.fgMuted)
    .style("font-family", T.fontFamily);

  if (profile.isLog) {
    svg.append("text")
      .attr("x", L.labelW + L.plotW / 2)
      .attr("y", L.axisY + 22)
      .attr("text-anchor", "middle")
      .style("font-size", L.annotFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", T.fgMuted)
      .text("(log scale)");
  }

  // Direct study labels (replaces d3.axisLeft — labels are drawn in the
  // label column, right-aligned just left of the plot strip)
  pageStudies.forEach(d => {
    const _maxChars = Math.floor((L.labelW - 8) / _charW);
    const lbl = d.label.length > _maxChars ? d.label.slice(0, _maxChars - 1) + "\u2026" : d.label;
    svg.append("text")
      .attr("x", L.labelW - 8)
      .attr("y", yPos[d.label] + 4)
      .attr("text-anchor", "end")
      .style("font-size", L.labelFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", d.filled ? T.fgMuted : T.fg)
      .text(lbl);
  });

  // ----------- CONTINUED LABEL (non-last pages only) -----------
  if (!isLastPage) {
    svg.append("text")
      .attr("x", L.labelW + L.plotW / 2)
      .attr("y", L.studyY1 + 18)
      .attr("text-anchor", "middle")
      .style("font-size", L.annotFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", T.fgMuted)
      .text(`— page ${page + 1} of ${totalPages}, continued —`);
  }

  // ----------- POOLED EFFECT (DIAMOND) — last page only -----------
  if (!isLastPage) {
    svg.attr("height", L.totalH);
    return { totalPages };
  }

  const diamondHalfHeight = L.diamondHH;

  // drawDiamond(center, ciLow, ciHigh, yMid, fillColor, strokeDash, labelText, tooltipText)
  // Appends one pooled-estimate diamond to the forest SVG.
  //   center      — point estimate on the analysis scale (maps to x-scale)
  //   ciLow/High  — CI bounds; define the left and right vertices of the diamond
  //   yMid        — vertical centre pixel of the diamond row
  //   fillColor   — CSS colour string (FE uses --fg-muted; RE uses --accent)
  //   strokeDash  — stroke-dasharray string, or null for a solid border
  //                 (KH CI uses "4,2" to visually distinguish adjusted CIs)
  //   labelText   — short label written right-aligned in the study-name column
  //   tooltipText — SVG <title> shown on hover
  // The diamond is a 4-point polygon with vertices at (ciLow, yMid),
  // (center, yMid−diamondHH), (ciHigh, yMid), (center, yMid+diamondHH).
  // Closes over: svg, x, L (layout), diamondHalfHeight.
  function drawDiamond(center, ciLow, ciHigh, yMid, fillColor, strokeDash, labelText, tooltipText) {
    const pts = [
      [x(ciLow),  yMid],
      [x(center), yMid - diamondHalfHeight],
      [x(ciHigh), yMid],
      [x(center), yMid + diamondHalfHeight],
    ];
    svg.append("polygon")
      .attr("points", pts.map(p => p.join(",")).join(" "))
      .attr("fill", fillColor)
      .attr("stroke", fillColor)
      .attr("stroke-width", strokeDash ? 2.5 : 1.5)
      .attr("stroke-dasharray", strokeDash || "0")
      .append("title").text(tooltipText);

    // Label in left (study) column
    svg.append("text")
      .attr("x", L.labelW - 8)
      .attr("y", yMid + 4)
      .attr("text-anchor", "end")
      .style("font-size", L.labelFontSize)
      .style("font-family", T.fontFamily)
      .style("font-weight", "bold")
      .attr("fill", fillColor)
      .text(labelText);
  }

  if (showFE) {
    drawDiamond(
      m.FE, feCiLow, feCiHigh,
      showBoth ? L.feDiamondY : L.diamondY,
      T.accentFE,
      null,
      showBoth ? "Fixed" : "Fixed-effect",
      "Fixed-effect model CI (Normal/Z)"
    );
  }

  if (showRE) {
    const reDash = ciMethod === "KH" ? "4,2" : null;
    const reTooltip = ciMethod === "KH" ? "Knapp-Hartung CI (adjusted variance)"
      : ciMethod === "t" ? "t-distribution CI"
      : "Normal (Wald) CI";
    drawDiamond(
      m.RE, m.ciLow, m.ciHigh,
      L.diamondY,
      T.accent,
      reDash,
      showBoth ? "Random" : "Random-effects",
      reTooltip
    );
  }

  // ----------- COLUMN HEADERS + SEPARATORS -----------
  const hY = L.headerH / 2 + 5;  // vertical centre of header band

  // "Study" header over the label column
  svg.append("text")
    .attr("x", L.labelW - 8)
    .attr("y", hY)
    .attr("text-anchor", "end")
    .style("font-size", L.labelFontSize)
    .style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted)
    .text("Study");

  // Horizontal rule below the header row
  svg.append("line")
    .attr("x1", 0).attr("x2", L.totalW)
    .attr("y1", L.headerH).attr("y2", L.headerH)
    .attr("stroke", T.border)
    .attr("stroke-width", T.headerRuleWidth);

  // Thin vertical rule between label column and plot strip
  svg.append("line")
    .attr("x1", L.labelW).attr("x2", L.labelW)
    .attr("y1", L.studyY0).attr("y2", L.studyY1 + 12)
    .attr("stroke", T.border);

  // Thin vertical rule between plot strip and annotation column
  svg.append("line")
    .attr("x1", L.annotX0).attr("x2", L.annotX0)
    .attr("y1", L.studyY0).attr("y2", L.studyY1 + 12)
    .attr("stroke", T.border);

  // ----------- GROUP SEPARATORS -----------
  // Drawn only when studies carry a group field. Each separator consists of
  // a full-width rule and a bold group-label centred in the label column.
  separators.forEach(({ y: sepTop, group }) => {
    // Horizontal rule near the bottom of the gap (just above the new group)
    const ruleY = sepTop + L.sepH - 3;
    svg.append("line")
      .attr("x1", 0).attr("x2", L.totalW)
      .attr("y1", ruleY).attr("y2", ruleY)
      .attr("stroke", T.groupSepStroke);

    // Group label right-aligned in the label column
    svg.append("text")
      .attr("x", L.labelW - 8)
      .attr("y", ruleY - 3)
      .attr("text-anchor", "end")
      .style("font-size", L.annotFontSize)
      .style("font-family", T.fontFamily)
      .style("font-weight", "bold")
      .attr("fill", T.groupLabelFill)
      .text(group);
  });

  // ----------- ANNOTATION COLUMNS (right panel) -----------
  // Sub-column x anchors within the annotW strip
  const efAnnotX = L.annotX0 + 8;    // left-aligned "Effect [95% CI]"
  const wtAnnotX = L.totalW - 6;     // right-aligned "Weight"

  // Weight percentages use the full studies array as the denominator so that
  // a study's share is its global RE weight, not its share within one page.
  const realStudies  = studies.filter(d => !d.filled);
  const totalW_annot = d3.sum(realStudies, d => d.w);

  // Column headers (inside the headerH band, aligned with the title)
  svg.append("text")
    .attr("x", efAnnotX)
    .attr("y", hY)
    .style("font-size", L.labelFontSize)
    .style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted)
    .text("Effect [95% CI]");

  svg.append("text")
    .attr("x", wtAnnotX)
    .attr("y", hY)
    .attr("text-anchor", "end")
    .style("font-size", L.labelFontSize)
    .style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted)
    .text("Weight");

  // Per-study rows (page slice only)
  pageStudies.forEach(d => {
    const rowMid = yPos[d.label] + 4;

    // Back-transformed effect and CI on display scale (study CIs always use z = 1.96)
    const ef  = profile.transform(d.yi);
    const lo  = profile.transform(d.yi - studyCrit * d.se);
    const hi  = profile.transform(d.yi + studyCrit * d.se);
    const efStr = isFinite(ef) ? ef.toFixed(3) : "NA";
    const ciStr = `[${isFinite(lo) ? lo.toFixed(3) : "NA"}, ${isFinite(hi) ? hi.toFixed(3) : "NA"}]`;

    // Weight % — imputed studies get "—" since they are phantom observations
    const wPct = d.filled
      ? "\u2014"
      : (isFinite(d.w) && totalW_annot > 0)
        ? (d.w / totalW_annot * 100).toFixed(1) + "%"
        : "NA";

    svg.append("text")
      .attr("x", efAnnotX)
      .attr("y", rowMid)
      .style("font-size", L.annotFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", d.filled ? T.fgMuted : T.fgSubtle)
      .text(`${efStr} ${ciStr}`);

    svg.append("text")
      .attr("x", wtAnnotX)
      .attr("y", rowMid)
      .attr("text-anchor", "end")
      .style("font-size", L.annotFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", d.filled ? T.fgMuted : T.fgSubtle)
      .text(wPct);
  });

  // Pooled annotation rows — one per visible estimate
  function annotatePooled(ef, lo, hi, yMid, color) {
    const efT  = profile.transform(ef);
    const loT  = profile.transform(lo);
    const hiT  = profile.transform(hi);
    const efStr = isFinite(efT) ? efT.toFixed(3) : "NA";
    const ciStr = `[${isFinite(loT) ? loT.toFixed(3) : "NA"}, ${isFinite(hiT) ? hiT.toFixed(3) : "NA"}]`;
    svg.append("text")
      .attr("x", efAnnotX).attr("y", yMid + 4)
      .style("font-size", L.annotFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", color)
      .text(`${efStr} ${ciStr}`);
    svg.append("text")
      .attr("x", wtAnnotX).attr("y", yMid + 4)
      .attr("text-anchor", "end")
      .style("font-size", L.annotFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", color)
      .text("100%");
  }

  if (showFE) {
    annotatePooled(m.FE, feCiLow, feCiHigh,
      showBoth ? L.feDiamondY : L.diamondY, T.accentFE);
  }
  if (showRE) {
    annotatePooled(m.RE, m.ciLow, m.ciHigh, L.diamondY, T.accentREAnnot);
  }

  // ----------- PREDICTION INTERVAL -----------
  if (showRE && isFinite(m.predLow) && isFinite(m.predHigh)) {
    // Line
    svg.append("line")
      .attr("x1", x(m.predLow))
      .attr("x2", x(m.predHigh))
      .attr("y1", L.piY)
      .attr("y2", L.piY)
      .attr("stroke", T.pi)
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "6,3")
      .append("title")
      .text("Prediction interval: expected range of true effects in future studies");

    // End caps
    svg.append("line")
      .attr("x1", x(m.predLow)).attr("x2", x(m.predLow))
      .attr("y1", L.piY - 5).attr("y2", L.piY + 5)
      .attr("stroke", T.pi).attr("stroke-width", 2);

    svg.append("line")
      .attr("x1", x(m.predHigh)).attr("x2", x(m.predHigh))
      .attr("y1", L.piY - 5).attr("y2", L.piY + 5)
      .attr("stroke", T.pi).attr("stroke-width", 2);

    // Label
    const pi_disp = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
    svg.append("text")
      .attr("x", x(m.RE))
      .attr("y", L.piY + 15)
      .attr("text-anchor", "middle")
      .style("font-size", L.labelFontSize)
      .style("font-family", T.fontFamily)
      .attr("fill", T.pi)
      .text(`Prediction interval: ${isFinite(pi_disp.lb) ? pi_disp.lb.toFixed(3) : "NA"} to ${isFinite(pi_disp.ub) ? pi_disp.ub.toFixed(3) : "NA"}`);
  }

  // ----------- HETEROGENEITY SUMMARY LINE -----------
  // Compute Q p-value from the chi-square distribution (df = k − 1)
  const Qp = (isFinite(m.Q) && isFinite(m.df) && m.df > 0)
    ? 1 - chiSquareCDF(m.Q, m.df)
    : NaN;

  const tau2Str = isFinite(m.tau2) ? m.tau2.toFixed(3) : "NA";
  const I2Str   = isFinite(m.I2)   ? m.I2.toFixed(1) + "%" : "NA";
  const QStr    = isFinite(m.Q)    ? m.Q.toFixed(2)  : "NA";
  const dfStr   = isFinite(m.df)   ? m.df            : "NA";
  const QpStr   = isFinite(Qp)     ? (Qp < 0.001 ? "< 0.001" : Qp.toFixed(3)) : "NA";

  svg.append("text")
    .attr("x", L.labelW + L.plotW / 2)
    .attr("y", L.hetY)
    .attr("text-anchor", "middle")
    .style("font-size", L.annotFontSize)
    .style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted)
    .text(`Heterogeneity:  τ² = ${tau2Str},  I² = ${I2Str},  Q(df=${dfStr}) = ${QStr},  p = ${QpStr}`);

  return { totalPages };
}

// ================= FUNNEL =================
// drawFunnel(studies, m, egger, profile, options)
//
// studies  — study objects with .yi (effect), .se (standard error), .filled flag
// m        — pooled result object; uses m.RE for the vertical reference line
// egger    — eggerTest() result { intercept, slope, p }; null to suppress line
// profile  — effect-type profile with .label, .transform, .isLog
// options  — { contours: false }
//              contours: true  draws four significance bands (Peters et al. 2008)
//                              and switches to a white publication-quality background.
//
// Layout
// ------
//   500 × 400 px SVG with margin { top:20, right:20, bottom:52, left:60 }.
//   x-axis: symmetric around null (yi = 0), domain [-xHalf, +xHalf].
//     xHalf = max(maxStudyEffect × 1.15, seMax × 2.8) — the 2.8 factor keeps
//     the ±1.96 funnel arms inside the plot at the widest SE value.
//   y-axis: SE from seMax (bottom) to 0 (top, inverted).
//
// Elements rendered (bottom to top)
// ----------------------------------
//   0. [contour mode] White background + four significance bands (outermost first)
//   1. Funnel triangle  — two dashed lines from null apex (yi=0, SE=0) to
//                         (±1.96×seMax, seMax), clipped to the x domain.
//   2. Pooled RE line   — vertical dashed accent line at m.RE.
//   3. Study circles    — filled for real studies, hollow for trim-and-fill imputed.
//   4. Egger line       — red dashed regression line when egger.slope is finite.
//   5. Axes + labels    — bottom x (effect measure) and left y ("Standard Error").
//   6. [contour mode] Legend — four colour swatches with p-value labels (Step 3).
export function drawFunnel(studies, m, egger, profile, options = {}) {
  profile = profile || { transform: x => x };
  const svg = d3.select("#funnelPlot");
  svg.selectAll("*").remove();

  if (!studies || studies.length === 0) return;

  // ---- Layout ----
  const margin = { top: 20, right: 20, bottom: 52, left: 60 };
  const W = 500, H = 400;
  const iW = W - margin.left - margin.right;   // 420
  const iH = H - margin.top  - margin.bottom;  // 328
  svg.attr("width", W).attr("height", H);

  const seMax = d3.max(studies, d => d.se);

  // Symmetric x domain centred on the null (yi = 0).
  const xHalf = Math.max(
    d3.max(studies, d => Math.abs(d.yi)) * 1.15,
    seMax * 2.8
  );

  const x = d3.scaleLinear()
    .domain([-xHalf, xHalf])
    .range([margin.left, W - margin.right]);

  const y = d3.scaleLinear()
    .domain([seMax, 0])
    .range([H - margin.bottom, margin.top]);

  // ---- Colour scheme — fixed values in contour mode, CSS vars otherwise ----
  const contours = !!options.contours;
  const isDark   = contours && document.documentElement.dataset.theme !== "light";

  const bgColor    = contours ? (isDark ? "#121212" : "#ffffff") : null;
  const fgColor    = contours ? (isDark ? "#cccccc" : "#333333") : "var(--fg-muted)";
  const borderClr  = contours ? (isDark ? "#666666" : "#888888") : "var(--border-hover)";
  const dotFill    = contours ? (isDark ? "#aaaaaa" : "#444444") : "var(--bg-surface-hover)";
  const dotStroke  = contours ? (isDark ? "#cccccc" : "#333333") : "var(--fg-subtle)";
  const dotFillImp = "none";
  const dotStrImp  = contours ? (isDark ? "#777777" : "#777777") : "var(--fg-muted)";

  // ---- Contour bands (Peters et al. 2008) ----
  // Rendered outermost-to-innermost; each polygon overwrites the inner region
  // of the previous band, producing a layered significance gradient.
  //
  // bandPath(z) returns the SVG path d-string for the region |yi| < z×se,
  // clipped to the inner plot rectangle.
  //   z = Infinity  → full plot rectangle (used for the outermost p<0.01 layer)
  //   Triangle case : z×seMax ≤ xHalf — arm fits within the x domain
  //   Trapezoid case: z×seMax > xHalf — arm is clipped by the x boundary at
  //                   se = xHalf/z, producing two extra corner vertices
  function bandPath(z) {
    const x0 = x(-xHalf), x1 = x(xHalf);
    const y0 = y(0),       y1 = y(seMax);
    if (!isFinite(z)) {
      return `M${x0},${y0} L${x1},${y0} L${x1},${y1} L${x0},${y1} Z`;
    }
    const seClip = xHalf / z;   // SE at which the arm reaches the x boundary
    if (seClip >= seMax) {
      // Triangle: arm stays inside the x domain across the full SE range
      return [
        `M${x(0)},${y(0)}`,
        `L${x( z * seMax)},${y(seMax)}`,
        `L${x(-z * seMax)},${y(seMax)}`,
        "Z",
      ].join(" ");
    }
    // Trapezoid: arm is clipped; two extra vertices where it hits the x boundary
    return [
      `M${x(0)},${y(0)}`,
      `L${x( xHalf)},${y(seClip)}`,
      `L${x( xHalf)},${y(seMax)}`,
      `L${x(-xHalf)},${y(seMax)}`,
      `L${x(-xHalf)},${y(seClip)}`,
      "Z",
    ].join(" ");
  }

  // Significance bands: { z-critical, fill colour, legend label }
  // z values are for a two-tailed test: Φ⁻¹(1 − p/2)
  //   p = 0.01 → z = 2.576,  p = 0.05 → z = 1.960,  p = 0.10 → z = 1.645
  // Light: bands progress white → dark-gray outward (high significance = darker).
  // Dark:  bands progress near-black → light-gray outward (high significance = lighter).
  const BANDS = isDark
    ? [
        { z: Infinity, fill: "#505050", label: "p < 0.01"        },
        { z: 2.576,    fill: "#383838", label: "0.01 ≤ p < 0.05" },
        { z: 1.960,    fill: "#252525", label: "0.05 ≤ p < 0.10" },
        { z: 1.645,    fill: "#161616", label: "p ≥ 0.10"         },
      ]
    : [
        { z: Infinity, fill: "#a0a0a0", label: "p < 0.01"        },
        { z: 2.576,    fill: "#c4c4c4", label: "0.01 ≤ p < 0.05" },
        { z: 1.960,    fill: "#e4e4e4", label: "0.05 ≤ p < 0.10" },
        { z: 1.645,    fill: "#ffffff", label: "p ≥ 0.10"         },
      ];

  if (contours) {
    // Solid background so axes and data read correctly against the band colours.
    svg.append("rect")
      .attr("width", W).attr("height", H)
      .attr("fill", bgColor);

    BANDS.forEach(({ z, fill }) => {
      svg.append("path")
        .attr("d", bandPath(z))
        .attr("fill", fill)
        .attr("stroke", "none");
    });
  }

  // ---- Funnel triangle (±1.96 × SE, centred on null) ----
  // Clip arm endpoints to the x domain so lines never extend beyond the axes.
  const armRight = Math.min( 1.96 * seMax,  xHalf);
  const armLeft  = Math.max(-1.96 * seMax, -xHalf);

  svg.append("line")
    .attr("x1", x(0)).attr("y1", y(0))
    .attr("x2", x(armRight)).attr("y2", y(seMax))
    .attr("stroke", borderClr)
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,2");

  svg.append("line")
    .attr("x1", x(0)).attr("y1", y(0))
    .attr("x2", x(armLeft)).attr("y2", y(seMax))
    .attr("stroke", borderClr)
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,2");

  // ---- Pooled RE vertical reference line ----
  const reLineColor = contours ? (isDark ? "#5588cc" : "#2255aa") : "var(--accent)";
  svg.append("line")
    .attr("x1", x(m.RE)).attr("x2", x(m.RE))
    .attr("y1", y(0)).attr("y2", y(seMax))
    .attr("stroke", reLineColor)
    .attr("stroke-dasharray", "4");

  // ---- Study circles ----
  svg.selectAll("circle")
    .data(studies).enter().append("circle")
    .attr("cx", d => x(d.yi))
    .attr("cy", d => y(d.se))
    .attr("r", 4)
    .attr("fill",   d => d.filled ? dotFillImp : dotFill)
    .attr("stroke", d => d.filled ? dotStrImp  : dotStroke);

  // ---- Egger regression line ----
  if (egger && isFinite(egger.slope)) {
    const seMin = d3.min(studies, d => d.se);
    if (seMin !== seMax) {
      const lineData = d3.range(seMin, seMax, (seMax - seMin) / 50).map(se => ({
        yi_hat: egger.intercept * se + egger.slope,
        se,
      }));
      const eggerColor = contours ? (isDark ? "#cc4444" : "#aa2222") : "var(--color-error)";
      svg.append("path")
        .datum(lineData)
        .attr("fill", "none")
        .attr("stroke", eggerColor)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4,2")
        .attr("d", d3.line().x(d => x(d.yi_hat)).y(d => y(d.se)));
    }
  }

  // ---- Axes ----
  const axisX = svg.append("g")
    .attr("transform", `translate(0,${H - margin.bottom})`)
    .call(d3.axisBottom(x).tickFormat(v => {
      const t = profile.transform(v);
      return isFinite(t) ? +t.toFixed(3) : "";
    }));
  axisX.select(".domain").attr("stroke", borderClr);
  axisX.selectAll(".tick line").attr("stroke", borderClr);
  axisX.selectAll(".tick text").attr("fill", fgColor);

  const axisY = svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));
  axisY.select(".domain").attr("stroke", borderClr);
  axisY.selectAll(".tick line").attr("stroke", borderClr);
  axisY.selectAll(".tick text").attr("fill", fgColor);

  // ---- Axis labels ----
  // x: effect measure name; "(log scale)" suffix for log-transformed types
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 4)
    .attr("text-anchor", "middle")
    .attr("fill", fgColor)
    .style("font-size", "10px")
    .text(profile.label + (profile.isLog ? " (log scale)" : ""));

  // y: "Standard Error" rotated 90° along the left margin
  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2))
    .attr("y", 12)
    .attr("text-anchor", "middle")
    .attr("fill", fgColor)
    .style("font-size", "11px")
    .text("Standard Error");

  // ---- Contour legend ----
  // Rendered last so it sits above all other elements.
  // One row per significance band: colour swatch + p-value label.
  // The white band (p ≥ 0.10) gets a grey swatch border so it is visible
  // against the white legend background.
  if (contours) {
    const LW  = 120, LH  = 76;   // legend box dimensions
    const PAD = 6;                // inner padding
    const ROW = 16;               // height per row
    const SW  = 10;               // swatch width and height

    // Anchor: 8 px inside the top-right corner of the inner plot area.
    const legendX = W - margin.right - LW - 8;
    const legendY = margin.top + 8;

    const lg = svg.append("g").attr("transform", `translate(${legendX},${legendY})`);

    const legendBg     = isDark ? "#1e1e1e" : "#ffffff";
    const legendBorder = isDark ? "#444444" : "#cccccc";
    const legendFg     = isDark ? "#cccccc" : "#333333";
    // The innermost band (last in BANDS) blends into the legend bg — give it a border.
    const innermostFill = BANDS[BANDS.length - 1].fill;

    // Background with subtle border
    lg.append("rect")
      .attr("width", LW).attr("height", LH)
      .attr("fill", legendBg)
      .attr("stroke", legendBorder)
      .attr("stroke-width", 1)
      .attr("rx", 2);

    BANDS.forEach(({ fill, label }, i) => {
      const rowY       = PAD + i * ROW;
      const needBorder = fill === innermostFill;

      // Colour swatch — innermost band swatch gets a border to remain visible
      lg.append("rect")
        .attr("x", PAD).attr("y", rowY + (ROW - SW) / 2)
        .attr("width", SW).attr("height", SW)
        .attr("fill", fill)
        .attr("stroke", needBorder ? legendBorder : "none")
        .attr("stroke-width", 1);

      // Label
      lg.append("text")
        .attr("x", PAD + SW + 5)
        .attr("y", rowY + ROW / 2 + 3)   // +3 aligns the text baseline visually
        .attr("fill", legendFg)
        .style("font-size", "9px")
        .text(label);
    });
  }

}

// ================= INFLUENCE PLOT (hat vs Cook's D) =================
// Scatter plot with one point per study.
//   x = hat value (leverage)
//   y = Cook's distance
// Dashed reference lines at x = 2/k and y = 4/k divide the plot into
// four quadrants; studies in the top-right quadrant are flagged in red.
//
// Parameters:
//   influence — array from influenceDiagnostics(), each entry has
//               { label, hat, cookD, highLeverage, highCookD }
export function drawInfluencePlot(influence) {
  const svg = d3.select("#influencePlot");
  svg.selectAll("*").remove();

  if (!influence || influence.length < 2) return;

  const k = influence.length;
  const hatThresh  = 2 / k;
  const cookThresh = 4 / k;

  const margin = { top: 30, right: 20, bottom: 50, left: 60 };
  const W = +svg.attr("width")  || 500;
  const H = +svg.attr("height") || 400;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const tooltip = d3.select("#tooltip");

  // Scales — pad 10% beyond the max on each axis so points aren't clipped
  const xMax = Math.max(d3.max(influence, d => d.hat),  hatThresh  * 1.5);
  const yMax = Math.max(d3.max(influence, d => d.cookD), cookThresh * 1.5);

  const x = d3.scaleLinear().domain([0, xMax * 1.1]).range([0, iW]);
  const y = d3.scaleLinear().domain([0, yMax * 1.1]).range([iH, 0]);

  // ----------- QUADRANT SHADING (top-right = both flags) -----------
  const x2 = x(hatThresh);
  const y2 = y(cookThresh);
  if (isFinite(x2) && isFinite(y2)) {
    g.append("rect")
      .attr("x", x2).attr("y", 0)
      .attr("width", iW - x2).attr("height", y2)
      .attr("fill", "rgba(224,96,96,0.08)");
  }

  // ----------- REFERENCE LINES -----------
  if (isFinite(x(hatThresh))) {
    g.append("line")
      .attr("x1", x(hatThresh)).attr("x2", x(hatThresh))
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--border-hover)").attr("stroke-dasharray", "4,3")
      .append("title").text(`Hat threshold = 2/k = ${hatThresh.toFixed(3)}`);
  }
  if (isFinite(y(cookThresh))) {
    g.append("line")
      .attr("x1", 0).attr("x2", iW)
      .attr("y1", y(cookThresh)).attr("y2", y(cookThresh))
      .attr("stroke", "var(--border-hover)").attr("stroke-dasharray", "4,3")
      .append("title").text(`Cook's D threshold = 4/k = ${cookThresh.toFixed(3)}`);
  }

  // ----------- POINTS -----------
  g.selectAll("circle")
    .data(influence)
    .enter().append("circle")
    .attr("cx", d => x(d.hat))
    .attr("cy", d => y(d.cookD))
    .attr("r", 5)
    .attr("fill", d => (d.highLeverage && d.highCookD) ? "var(--color-error)"
                      : (d.highLeverage || d.highCookD) ? "var(--color-warning)"
                      : "var(--bg-surface-hover)")
    .attr("stroke", d => (d.highLeverage && d.highCookD) ? "var(--color-error)"
                        : (d.highLeverage || d.highCookD) ? "var(--color-warning)"
                        : "var(--fg-muted)")
    .attr("opacity", 0.85)
    .on("mousemove", (e, d) => {
      tooltip.style("opacity", 1)
        .html(`${d.label}<br>Hat: ${d.hat.toFixed(4)}<br>Cook's D: ${d.cookD.toFixed(4)}`)
        .style("left", (e.pageX + 10) + "px")
        .style("top",  (e.pageY - 20) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));

  // ----------- LABELS (only flagged studies) -----------
  g.selectAll("text.pt-label")
    .data(influence.filter(d => d.highLeverage || d.highCookD))
    .enter().append("text")
    .attr("class", "pt-label")
    .attr("x", d => x(d.hat) + 7)
    .attr("y", d => y(d.cookD) + 4)
    .style("font-size", "10px")
    .attr("fill", d => (d.highLeverage && d.highCookD) ? "var(--color-error)" : "var(--color-warning)")
    .text(d => d.label);

  // ----------- AXES -----------
  g.append("g").attr("transform", `translate(0,${iH})`).call(d3.axisBottom(x).ticks(5));
  g.append("g").call(d3.axisLeft(y).ticks(5));

  // Axis labels
  g.append("text")
    .attr("x", iW / 2).attr("y", iH + 38)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "12px")
    .text("Hat value (leverage)");

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -iH / 2).attr("y", -46)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "12px")
    .text("Cook's distance");

  // Title
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 18)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "12px")
    .text("Influence plot  (red = both flags, orange = one flag)");
}

// ================= CUMULATIVE FOREST =================
// Draws a cumulative meta-analysis plot: each row shows the pooled RE
// estimate and 95% CI after adding one more study in accumulation order.
// The final row uses a diamond marker; earlier rows use filled circles.
//
// Parameters:
//   cumulativeResults — array from cumulativeMeta(), already in order
//   profile           — effect-type profile with .label, .transform
export function drawCumulativeForest(cumulativeResults, profile) {
  const svg = d3.select("#cumulativePlot");
  svg.selectAll("*").remove();

  if (!cumulativeResults || cumulativeResults.length === 0) return;

  const k      = cumulativeResults.length;
  const rowH   = 22;
  const margin = { top: 40, right: 90, bottom: 46, left: 200 };
  const plotW  = 580;
  const totalW = margin.left + plotW + margin.right;
  const totalH = margin.top + k * rowH + margin.bottom;

  svg.attr("width", totalW).attr("height", totalH);

  const tooltip = d3.select("#tooltip");

  // Back-transform all results to the display scale
  const rows = cumulativeResults.map(r => {
    const re_disp = profile.transform(r.RE);
    const ci      = { lb: profile.transform(r.ciLow), ub: profile.transform(r.ciHigh) };
    return { ...r, re_disp, lo_disp: ci.lb, hi_disp: ci.ub };
  });

  // X scale across all display-scale CI bounds
  const allX = rows.flatMap(r => [r.lo_disp, r.re_disp, r.hi_disp]).filter(isFinite);
  const [xMin, xMax] = d3.extent(allX);
  const xPad  = Math.max((xMax - xMin) * 0.05, 1e-6);
  const xScale = d3.scaleLinear()
    .domain([xMin - xPad, xMax + xPad])
    .nice()
    .range([0, plotW]);

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Title
  svg.append("text")
    .attr("x", margin.left + plotW / 2).attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "12px")
    .text("Cumulative meta-analysis");

  // Null reference line (at the back-transformed 0 — e.g. 0 for MD, 1 for OR/RR)
  const nullDisp = profile.transform(0);
  if (isFinite(nullDisp)) {
    g.append("line")
      .attr("x1", xScale(nullDisp)).attr("x2", xScale(nullDisp))
      .attr("y1", 0).attr("y2", k * rowH)
      .attr("stroke", "var(--border-hover)").attr("stroke-dasharray", "4,3").attr("opacity", 0.6);
  }

  // One row per cumulative step
  rows.forEach((r, i) => {
    const cy     = (i + 0.5) * rowH;
    const isLast = i === k - 1;
    const colour = isLast ? "var(--color-warning)" : "var(--fg-subtle)";

    // Label (left panel)
    svg.append("text")
      .attr("x", margin.left - 8).attr("y", margin.top + cy + 4)
      .attr("text-anchor", "end")
      .style("font-size", "11px")
      .attr("fill", colour)
      .text(r.addedLabel);

    const x1 = isFinite(r.lo_disp)  ? xScale(r.lo_disp)  : null;
    const x2 = isFinite(r.hi_disp)  ? xScale(r.hi_disp)  : null;
    const cx = isFinite(r.re_disp)  ? xScale(r.re_disp)  : null;

    // CI line
    if (x1 !== null && x2 !== null) {
      g.append("line")
        .attr("x1", x1).attr("x2", x2)
        .attr("y1", cy).attr("y2", cy)
        .attr("stroke", colour).attr("stroke-width", 1.5);
    }

    // Marker: diamond for final row, filled circle for others
    if (cx !== null) {
      if (isLast) {
        const dh  = 7;
        const pts = [[x1 ?? cx, cy], [cx, cy - dh], [x2 ?? cx, cy], [cx, cy + dh]]
          .map(p => p.join(",")).join(" ");
        g.append("polygon")
          .attr("points", pts)
          .attr("fill", colour).attr("stroke", colour);
      } else {
        g.append("circle")
          .attr("cx", cx).attr("cy", cy).attr("r", 4)
          .attr("fill", colour).attr("stroke", colour);
      }
    }

    // RE value text (right of plot)
    if (isFinite(r.re_disp)) {
      svg.append("text")
        .attr("x", margin.left + plotW + 6).attr("y", margin.top + cy + 4)
        .style("font-size", "10px")
        .attr("fill", colour)
        .text(r.re_disp.toFixed(3));
    }

    // Invisible hit rect for tooltip
    const hitX1 = Math.min(x1 ?? cx ?? 0, cx ?? 0);
    const hitX2 = Math.max(x2 ?? cx ?? plotW, cx ?? plotW);
    g.append("rect")
      .attr("x", hitX1 - 4).attr("y", cy - rowH / 2)
      .attr("width", Math.max(hitX2 - hitX1 + 8, 20)).attr("height", rowH)
      .attr("fill", "transparent")
      .on("mousemove", event => {
        tooltip.style("opacity", 1)
          .html(`<b>After: ${r.addedLabel}</b> (k = ${r.k})<br>` +
                `RE = ${isFinite(r.re_disp)  ? r.re_disp.toFixed(3)  : "NA"}&nbsp; ` +
                `CI [${isFinite(r.lo_disp) ? r.lo_disp.toFixed(3) : "NA"}, ` +
                    `${isFinite(r.hi_disp) ? r.hi_disp.toFixed(3) : "NA"}]<br>` +
                `τ² = ${isFinite(r.tau2) ? r.tau2.toFixed(3) : "NA"}&nbsp; ` +
                `I² = ${isFinite(r.I2)   ? r.I2.toFixed(1)   : "NA"}%`)
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY - 28) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0));
  });

  // X axis
  g.append("g")
    .attr("transform", `translate(0,${k * rowH + 6})`)
    .call(d3.axisBottom(xScale).ticks(5));

  // X axis label
  svg.append("text")
    .attr("x", margin.left + plotW / 2).attr("y", totalH - 6)
    .attr("text-anchor", "middle")
    .style("font-size", "11px").attr("fill", "var(--fg-muted)")
    .text(profile.label);
}

// ================= CUMULATIVE FUNNEL PLOT =================
//
// drawCumulativeFunnel(cumulativeStudies, cumResults, profile, stepIdx)
//
// cumulativeStudies — the full sorted study array (all k, same order as cumResults)
// cumResults        — array from cumulativeMeta(): { k, addedLabel, RE, … }
// profile           — effect-type profile with .label, .transform, .isLog
// stepIdx           — 0-based index; which step to render (0 = first study only,
//                     k-1 = all studies)
//
// Design
// ------
//   Axes are fixed globally (computed from all k studies) so the view is
//   stable as the slider advances — the funnel triangle never rescales.
//
//   x: symmetric around null (yi = 0), domain [-xHalf, +xHalf]
//      xHalf = max(maxAbsYi × 1.15, seMax × 2.8) over ALL studies.
//   y: SE from seMax_global (bottom) to 0 (top, inverted).
//
//   Funnel arms: ±1.96 × seMax_global, anchored at null, same as drawFunnel.
//   RE line:     vertical dashed line at cumResults[stepIdx].RE.
//   Dots:        studies 0..stepIdx-1 in standard grey; study stepIdx in accent.
//   Annotation:  "k = n / total · added: label" in top-right corner.
//
// No Egger line is drawn (per-step Egger is unreliable for small k and the
// purpose here is visual inspection of the evolving dot pattern).
export function drawCumulativeFunnel(cumulativeStudies, cumResults, profile, stepIdx) {
  profile = profile || { transform: x => x };
  const svg = d3.select("#cumulativeFunnelPlot");
  svg.selectAll("*").remove();

  if (!cumulativeStudies || cumulativeStudies.length === 0 || !cumResults) return;

  const k     = cumulativeStudies.length;
  const step  = Math.max(0, Math.min(stepIdx, k - 1));
  const cur   = cumResults[step];

  // ---- Layout — identical to drawFunnel ----
  const margin = { top: 30, right: 20, bottom: 52, left: 60 };
  const W = 500, H = 420;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;
  svg.attr("width", W).attr("height", H);

  const tooltip = d3.select("#tooltip");

  // ---- Global axes (all studies, fixed regardless of step) ----
  const seMax  = d3.max(cumulativeStudies, d => d.se);
  const xHalf  = Math.max(
    d3.max(cumulativeStudies, d => Math.abs(d.yi)) * 1.15,
    seMax * 2.8
  );

  const x = d3.scaleLinear()
    .domain([-xHalf, xHalf])
    .range([margin.left, W - margin.right]);

  const y = d3.scaleLinear()
    .domain([seMax, 0])
    .range([H - margin.bottom, margin.top]);

  const fgColor  = "var(--fg-muted)";
  const borderClr = "var(--border-hover)";

  // ---- Funnel triangle (anchored at null = 0, global seMax) ----
  const armRight = Math.min( 1.96 * seMax,  xHalf);
  const armLeft  = Math.max(-1.96 * seMax, -xHalf);

  svg.append("line")
    .attr("x1", x(0)).attr("y1", y(0))
    .attr("x2", x(armRight)).attr("y2", y(seMax))
    .attr("stroke", borderClr)
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,2");

  svg.append("line")
    .attr("x1", x(0)).attr("y1", y(0))
    .attr("x2", x(armLeft)).attr("y2", y(seMax))
    .attr("stroke", borderClr)
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,2");

  // ---- Pooled RE line for this step ----
  if (isFinite(cur.RE)) {
    svg.append("line")
      .attr("x1", x(cur.RE)).attr("x2", x(cur.RE))
      .attr("y1", y(0)).attr("y2", y(seMax))
      .attr("stroke", "var(--accent)")
      .attr("stroke-dasharray", "4");
  }

  // ---- Study dots ----
  // Previous studies (0 .. step-1): standard grey
  // Current step's study (step):    accent highlight
  const prevStudies = cumulativeStudies.slice(0, step);
  const newStudy    = cumulativeStudies[step];

  svg.selectAll(".dot-prev")
    .data(prevStudies).enter().append("circle")
    .attr("class", "dot-prev")
    .attr("cx", d => x(d.yi))
    .attr("cy", d => y(d.se))
    .attr("r", 4)
    .attr("fill",   "var(--bg-surface-hover)")
    .attr("stroke", "var(--fg-subtle)")
    .on("mousemove", (event, d) => {
      tooltip.style("opacity", 1)
        .html(`<b>${d.label ?? ""}</b><br>` +
              `yi = ${d.yi.toFixed(3)}&nbsp; SE = ${d.se.toFixed(3)}`)
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY - 28) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));

  if (newStudy) {
    svg.append("circle")
      .attr("cx", x(newStudy.yi))
      .attr("cy", y(newStudy.se))
      .attr("r", 5)
      .attr("fill",         "var(--accent-light)")
      .attr("stroke",       "var(--accent)")
      .attr("stroke-width", 1.5)
      .on("mousemove", (event) => {
        tooltip.style("opacity", 1)
          .html(`<b>${newStudy.label ?? ""}</b> ← added at this step<br>` +
                `yi = ${newStudy.yi.toFixed(3)}&nbsp; SE = ${newStudy.se.toFixed(3)}`)
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY - 28) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0));
  }

  // ---- Step annotation (top-right) ----
  const annotY = margin.top - 10;
  svg.append("text")
    .attr("x", W - margin.right)
    .attr("y", annotY)
    .attr("text-anchor", "end")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "10px")
    .text(`k = ${step + 1} / ${k}\u2003added: ${cur.addedLabel}`);

  // ---- RE estimate annotation (right of RE line, near top) ----
  if (isFinite(cur.RE)) {
    const reDisp = profile.transform(cur.RE);
    if (isFinite(reDisp)) {
      svg.append("text")
        .attr("x", x(cur.RE) + 4)
        .attr("y", y(0) + 12)
        .attr("fill", "var(--accent)")
        .style("font-size", "9px")
        .text(reDisp.toFixed(3));
    }
  }

  // ---- Axes ----
  const axisX = svg.append("g")
    .attr("transform", `translate(0,${H - margin.bottom})`)
    .call(d3.axisBottom(x).tickFormat(v => {
      const t = profile.transform(v);
      return isFinite(t) ? +t.toFixed(3) : "";
    }));
  axisX.select(".domain").attr("stroke", borderClr);
  axisX.selectAll(".tick line").attr("stroke", borderClr);
  axisX.selectAll(".tick text").attr("fill", fgColor);

  const axisY = svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));
  axisY.select(".domain").attr("stroke", borderClr);
  axisY.selectAll(".tick line").attr("stroke", borderClr);
  axisY.selectAll(".tick text").attr("fill", fgColor);

  // ---- Axis labels ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 4)
    .attr("text-anchor", "middle")
    .attr("fill", fgColor)
    .style("font-size", "10px")
    .text(profile.label + (profile.isLog ? " (log scale)" : ""));

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2))
    .attr("y", 12)
    .attr("text-anchor", "middle")
    .attr("fill", fgColor)
    .style("font-size", "11px")
    .text("Standard Error");
}

// ================= P-CURVE PLOT =================
// drawPCurve(result)
//
// Bar chart of observed p-value proportions across five bins (.00–.01 … .04–.05),
// with two reference lines:
//   · H₀ (no effect)  — dashed horizontal at 20%   (var(--fg-subtle))
//   · 33%-power curve — polyline of expected proportions (var(--color-warning))
//
// A legend identifies the two reference lines.
//
// Parameters:
//   result — object returned by pCurve() in analysis.js
export function drawPCurve(result) {
  const svg = d3.select("#pCurvePlot");
  svg.selectAll("*").remove();

  if (!result || result.k === 0) return;

  const { bins, expected0, expected33 } = result;

  const margin = { top: 24, right: 24, bottom: 52, left: 56 };
  const W = +svg.attr("width")  || 500;
  const H = +svg.attr("height") || 380;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- Scales ----
  // x: band scale for the 5 bins
  const binLabels = bins.map(b => `${b.lo.toFixed(2)}–${b.hi.toFixed(2)}`);
  const x = d3.scaleBand()
    .domain(binLabels)
    .range([0, iW])
    .padding(0.25);

  // y: proportion 0–1, ceiling at max(observed, expected33, 0.25) for headroom
  const yMax = Math.max(
    d3.max(bins, d => d.prop),
    d3.max(expected33),
    0.25
  ) * 1.15;
  const y = d3.scaleLinear().domain([0, yMax]).range([iH, 0]);

  // ---- Gridlines ----
  g.append("g")
    .attr("class", "grid")
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickSize(-iW)
        .tickFormat("")
    )
    .selectAll("line")
    .attr("stroke", "var(--border)")
    .attr("stroke-dasharray", "2,3");
  g.select(".grid .domain").remove();

  // ---- Bars (observed proportions) ----
  g.selectAll(".pcurve-bar")
    .data(bins)
    .enter().append("rect")
    .attr("class", "pcurve-bar")
    .attr("x",      (_, i) => x(binLabels[i]))
    .attr("y",      d => y(d.prop))
    .attr("width",  x.bandwidth())
    .attr("height", d => iH - y(d.prop))
    .attr("fill",   "var(--accent)")
    .attr("opacity", 0.8);

  // ---- Bar count labels ----
  g.selectAll(".pcurve-count")
    .data(bins)
    .enter().append("text")
    .attr("class", "pcurve-count")
    .attr("x", (_, i) => x(binLabels[i]) + x.bandwidth() / 2)
    .attr("y", d => y(d.prop) - 4)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "10px")
    .text(d => d.count > 0 ? `n=${d.count}` : "");

  // ---- H₀ reference line (20%, dashed) ----
  g.append("line")
    .attr("x1", 0).attr("x2", iW)
    .attr("y1", y(expected0)).attr("y2", y(expected0))
    .attr("stroke", "var(--fg-subtle)")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "5,3");

  // ---- 33%-power reference line (polyline through bin midpoints) ----
  const linePoints = bins.map((_, i) => [
    x(binLabels[i]) + x.bandwidth() / 2,
    y(expected33[i]),
  ]);
  g.append("polyline")
    .attr("points", linePoints.map(p => p.join(",")).join(" "))
    .attr("fill", "none")
    .attr("stroke", "var(--color-warning)")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "4,2");
  // Circle markers at each bin midpoint
  g.selectAll(".pcurve-33-dot")
    .data(expected33)
    .enter().append("circle")
    .attr("class", "pcurve-33-dot")
    .attr("cx", (_, i) => x(binLabels[i]) + x.bandwidth() / 2)
    .attr("cy", d => y(d))
    .attr("r", 3)
    .attr("fill", "var(--color-warning)");

  // ---- Axes ----
  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x));
  axisX.select(".domain").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick line").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick text")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px");

  const axisY = g.append("g")
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickFormat(d => `${Math.round(d * 100)}%`)
    );
  axisY.select(".domain").attr("stroke", "var(--border-hover)");
  axisY.selectAll(".tick line").attr("stroke", "var(--border-hover)");
  axisY.selectAll(".tick text").attr("fill", "var(--fg-muted)");

  // ---- Axis labels ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("p-value");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2))
    .attr("y", 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Proportion of studies");

  // ---- Legend ----
  const LW = 172, LH = 46, PAD = 8, ROW = 16;
  const legendX = iW - LW - 4;
  const legendY = 4;
  const lg = g.append("g").attr("transform", `translate(${legendX},${legendY})`);

  lg.append("rect")
    .attr("width", LW).attr("height", LH)
    .attr("fill", "var(--bg-surface)")
    .attr("stroke", "var(--border)")
    .attr("stroke-width", 1)
    .attr("rx", 3);

  // Row 0: H₀ dashed line
  lg.append("line")
    .attr("x1", PAD).attr("x2", PAD + 18)
    .attr("y1", PAD + ROW * 0 + ROW / 2).attr("y2", PAD + ROW * 0 + ROW / 2)
    .attr("stroke", "var(--fg-subtle)")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "5,3");
  lg.append("text")
    .attr("x", PAD + 22).attr("y", PAD + ROW * 0 + ROW / 2 + 4)
    .attr("fill", "var(--fg-muted)").style("font-size", "9px")
    .text("Expected (H₀, no effect)");

  // Row 1: 33%-power dashed line + dot
  lg.append("line")
    .attr("x1", PAD).attr("x2", PAD + 18)
    .attr("y1", PAD + ROW * 1 + ROW / 2).attr("y2", PAD + ROW * 1 + ROW / 2)
    .attr("stroke", "var(--color-warning)")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "4,2");
  lg.append("circle")
    .attr("cx", PAD + 9).attr("cy", PAD + ROW * 1 + ROW / 2)
    .attr("r", 3).attr("fill", "var(--color-warning)");
  lg.append("text")
    .attr("x", PAD + 22).attr("y", PAD + ROW * 1 + ROW / 2 + 4)
    .attr("fill", "var(--fg-muted)").style("font-size", "9px")
    .text("Expected (33% power)");
}

// ================= P-UNIFORM COMPARISON PLOT =================
// drawPUniform(result, m, profile)
//
// Side-by-side horizontal CI comparison of the RE estimate and the
// bias-corrected p-uniform estimate, sharing a common x-axis in the
// transformed effect scale.  Immediately shows how much the bias
// correction shifts the estimate and whether the CIs overlap.
//
// Layout: two labelled rows (RE / P-uniform), each with a CI line
// and a point-estimate marker (diamond for RE, circle for p-uniform).
// A vertical dashed reference line is drawn at x = 0 (null effect).
//
// Parameters:
//   result  — object returned by pUniform() in analysis.js
//   m       — meta() result, used for RE estimate and CI
//   profile — effect profile (provides .transform and .label)
export function drawPUniform(result, m, profile) {
  const svg = d3.select("#pUniformPlot");
  svg.selectAll("*").remove();

  if (!result || result.k === 0 || !isFinite(result.estimate)) return;

  profile = profile || { transform: x => x, label: "Effect" };

  // ---- Layout ----
  const margin = { top: 20, right: 24, bottom: 44, left: 100 };
  const W = +svg.attr("width")  || 500;
  const H = +svg.attr("height") || 170;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- Data rows ----
  // Stored in the internal (untransformed) scale; profile.transform is applied
  // only at the tick-formatter stage so the x scale stays linear and symmetric.
  const rows = [
    {
      label:    "RE",
      estimate: m.RE,
      lo:       m.ciLow,
      hi:       m.ciHigh,
      color:    "var(--accent)",
      shape:    "diamond",
    },
    {
      label:    "P-uniform",
      estimate: result.estimate,
      lo:       result.ciLow,
      hi:       result.ciHigh,
      color:    "var(--color-info)",
      shape:    "circle",
    },
  ].filter(r => isFinite(r.estimate) && isFinite(r.lo) && isFinite(r.hi));

  if (rows.length === 0) return;

  // ---- X scale (internal units, symmetric around null = 0) ----
  const allVals = rows.flatMap(r => [r.lo, r.estimate, r.hi, 0]);
  const xExtent = Math.max(...allVals.map(Math.abs)) * 1.15 || 1;
  const x = d3.scaleLinear().domain([-xExtent, xExtent]).range([0, iW]);

  // ---- Y positions — one per row, evenly spaced ----
  const rowH  = iH / rows.length;
  const rowMid = (i) => rowH * i + rowH / 2;

  // ---- Reference line at x = 0 ----
  g.append("line")
    .attr("x1", x(0)).attr("x2", x(0))
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--border-hover)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3");

  // ---- CI lines and markers ----
  rows.forEach((row, i) => {
    const cy = rowMid(i);

    // CI line with end ticks
    const TICK = 5;
    g.append("line")
      .attr("x1", x(row.lo)).attr("x2", x(row.hi))
      .attr("y1", cy).attr("y2", cy)
      .attr("stroke", row.color).attr("stroke-width", 2);
    [row.lo, row.hi].forEach(v => {
      g.append("line")
        .attr("x1", x(v)).attr("x2", x(v))
        .attr("y1", cy - TICK).attr("y2", cy + TICK)
        .attr("stroke", row.color).attr("stroke-width", 2);
    });

    // Point estimate marker
    if (row.shape === "diamond") {
      const S = 7;   // half-width of diamond
      const pts = [
        [x(row.estimate), cy - S],
        [x(row.estimate) + S, cy],
        [x(row.estimate), cy + S],
        [x(row.estimate) - S, cy],
      ].map(p => p.join(",")).join(" ");
      g.append("polygon")
        .attr("points", pts)
        .attr("fill", row.color);
    } else {
      g.append("circle")
        .attr("cx", x(row.estimate)).attr("cy", cy)
        .attr("r", 6)
        .attr("fill", row.color);
    }

    // Row label (left margin)
    g.append("text")
      .attr("x", -8).attr("y", cy + 4)
      .attr("text-anchor", "end")
      .attr("fill", "var(--fg-muted)")
      .style("font-size", "11px")
      .text(row.label);
  });

  // ---- X axis ----
  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(v => {
      const t = profile.transform(v);
      return isFinite(t) ? +t.toFixed(2) : "";
    }));
  axisX.select(".domain").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick line").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick text").attr("fill", "var(--fg-muted)").style("font-size", "10px");

  // ---- X axis label ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text(profile.label + (profile.isLog ? " (log scale)" : ""));
}

// ================= ORCHARD PLOT =================
// Precision-weighted jittered dot plot with pooled estimate overlaid.
// Reference: Nakagawa et al. (2021) BMC Biology.
//
// Layout
// ------
//   One horizontal band per group (or a single band if no groups).
//   Within each band:
//     • Wide, low-opacity rect  → prediction interval (PI)
//     • Narrower rect           → 95% CI
//     • Diamond                 → RE point estimate
//     • Jittered circles        → individual studies, r ∝ 1/SE
//   Imputed (trim-fill) studies rendered with reduced opacity.
export function drawOrchardPlot(studies, m, profile) {
  const svg = d3.select("#orchardPlot");
  svg.selectAll("*").remove();

  if (!studies || studies.length === 0) return;

  profile = profile || { transform: x => x, label: "Effect" };

  const W = +svg.attr("width")  || 520;
  const H = +svg.attr("height") || 340;

  // ---- Group layout (computed before margin so left can scale to label width) ----
  const allGroups = [...new Set(studies.map(s => s.group || "").filter(Boolean))];
  const hasGroups = allGroups.length > 1;
  const bands = hasGroups ? allGroups : ["All studies"];

  // Dynamic left margin: fits longest group label when groups exist; minimal otherwise
  const leftMargin = hasGroups
    ? Math.max(60, Math.min(150, Math.ceil(allGroups.reduce((m, g) => Math.max(m, g.length), 0) * 6.8) + 14))
    : 30;
  const margin = { top: 28, right: 20, bottom: 48, left: leftMargin };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const bandStudies = bands.map(band =>
    hasGroups ? studies.filter(s => s.group === band) : studies.slice()
  );

  const laneH = iH / bands.length;

  // Cap the drawing height within each lane (prevents giant bars in single-band plots)
  const DRAW_CAP = 80;
  const drawH    = Math.min(laneH, DRAW_CAP);

  // ---- X scale (internal / untransformed) ----
  const allYi = studies.map(s => s.yi).filter(isFinite);
  const piLow  = isFinite(m.predLow)  ? m.predLow  : null;
  const piHigh = isFinite(m.predHigh) ? m.predHigh : null;
  const refs   = [m.RE, m.ciLow, m.ciHigh, ...allYi, 0];
  if (piLow  != null) refs.push(piLow);
  if (piHigh != null) refs.push(piHigh);
  const xExtent = Math.max(...refs.filter(isFinite).map(Math.abs)) * 1.12 || 1;
  const x = d3.scaleLinear().domain([-xExtent, xExtent]).range([0, iW]);

  const tooltip = d3.select("#tooltip");

  const GROUP_COLORS = [
    "var(--accent)",
    "var(--color-info)",
    "var(--color-warning)",
    "var(--color-error)",
    "#9966cc",
    "#669966",
  ];

  // ---- Null reference line ----
  g.append("line")
    .attr("x1", x(0)).attr("x2", x(0))
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--border-hover)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3");

  // ---- Bands ----
  bands.forEach((band, bi) => {
    const cy     = laneH * bi + laneH / 2;   // lane centre
    const color  = GROUP_COLORS[bi % GROUP_COLORS.length];
    const bStudies = bandStudies[bi];

    const jitterRange = drawH * 0.40;

    // Precision weights for point sizing
    const invSE    = bStudies.map(s => 1 / Math.max(s.se || Math.sqrt(Math.max(s.vi, 0)), 1e-6));
    const maxInvSE = Math.max(...invSE) || 1;
    const R_MIN = 2, R_MAX = 7;

    // PI rect (very low opacity)
    if (piLow != null && piHigh != null) {
      const piW = Math.max(0, x(piHigh) - x(piLow));
      if (piW > 0) {
        g.append("rect")
          .attr("x", x(piLow))
          .attr("y", cy - drawH * 0.44)
          .attr("width",  piW)
          .attr("height", drawH * 0.88)
          .attr("fill", color)
          .attr("opacity", 0.10)
          .attr("rx", 3);
      }
    }

    // CI rect (moderate opacity)
    if (isFinite(m.ciLow) && isFinite(m.ciHigh)) {
      const ciW = Math.max(0, x(m.ciHigh) - x(m.ciLow));
      if (ciW > 0) {
        g.append("rect")
          .attr("x", x(m.ciLow))
          .attr("y", cy - drawH * 0.20)
          .attr("width",  ciW)
          .attr("height", drawH * 0.40)
          .attr("fill", color)
          .attr("opacity", 0.35)
          .attr("rx", 2);
      }
    }

    // RE diamond
    if (isFinite(m.RE)) {
      const S   = drawH * 0.18;
      const cx  = x(m.RE);
      const pts = [[cx, cy - S],[cx + S, cy],[cx, cy + S],[cx - S, cy]]
        .map(p => p.join(",")).join(" ");
      g.append("polygon")
        .attr("points", pts)
        .attr("fill", color);
    }

    // Jittered study circles (spread by index; deterministic)
    bStudies.forEach((s, i) => {
      if (!isFinite(s.yi)) return;
      const n      = bStudies.length;
      const jitter = n > 1 ? (i / (n - 1) - 0.5) * 2 * jitterRange : 0;
      const r      = R_MIN + (R_MAX - R_MIN) * (invSE[i] / maxInvSE);

      g.append("circle")
        .attr("cx", x(s.yi))
        .attr("cy", cy + jitter)
        .attr("r",  r)
        .attr("fill", color)
        .attr("fill-opacity", s.filled ? 0.25 : 0.60)
        .attr("stroke", "var(--bg-surface)")
        .attr("stroke-width", 0.8)
        .on("mousemove", (event) => {
          const seVal = (s.se || Math.sqrt(Math.max(s.vi, 0))).toFixed(3);
          const yi_t  = profile.transform(s.yi);
          tooltip.style("opacity", 1)
            .html(`<b>${s.label}</b><br>Effect: ${isFinite(yi_t) ? +yi_t.toFixed(3) : "NA"}<br>SE: ${seVal}${s.filled ? "<br><i>(imputed)</i>" : ""}`)
            .style("left", (event.pageX + 12) + "px")
            .style("top",  (event.pageY - 24) + "px");
        })
        .on("mouseout", () => tooltip.style("opacity", 0));
    });

    // Group label at lane centre (left margin)
    if (hasGroups) {
      const maxCharsGroup = Math.floor((margin.left - 8) / 6.8);
      const label = band.length > maxCharsGroup ? band.slice(0, maxCharsGroup - 1) + "…" : band;
      g.append("text")
        .attr("x", -8).attr("y", cy + 4)
        .attr("text-anchor", "end")
        .attr("fill", "var(--fg-muted)")
        .style("font-size", "11px")
        .text(label);
    }

    // Separator between bands
    if (bi < bands.length - 1) {
      g.append("line")
        .attr("x1", 0).attr("x2", iW)
        .attr("y1", laneH * (bi + 1)).attr("y2", laneH * (bi + 1))
        .attr("stroke", "var(--border)")
        .attr("stroke-width", 0.5)
        .attr("stroke-dasharray", "3,4");
    }
  });

  // ---- X axis ----
  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(v => {
      const t = profile.transform(v);
      return isFinite(t) ? +t.toFixed(2) : "";
    }));
  axisX.select(".domain").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick line").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick text").attr("fill", "var(--fg-muted)").style("font-size", "10px");

  // ---- X axis label ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text(profile.label);

  // ---- Heterogeneity annotation ----
  const hetParts = [];
  if (isFinite(m.I2))            hetParts.push(`I² = ${(m.I2 * 100).toFixed(1)}%`);
  if (isFinite(m.tau2) && m.tau2 > 0) hetParts.push(`τ² = ${m.tau2.toFixed(3)}`);
  if (hetParts.length) {
    g.append("text")
      .attr("x", 4).attr("y", iH - 4)
      .attr("fill", "var(--fg-muted)")
      .style("font-size", "10px")
      .text(hetParts.join("  "));
  }
}

// ================= CATERPILLAR PLOT =================
// One horizontal CI segment per study, sorted by effect size (descending).
// Purely study-level — no pooled diamond.  Vertical reference lines mark the
// null value (dashed) and the RE pooled estimate (solid).
//
// SVG height is set dynamically (16 px per study, capped at 900 px).
// Studies that don't fit are hidden via an SVG clipPath so the x-axis always
// remains visible.
export function drawCaterpillarPlot(studies, m, profile) {
  const svg = d3.select("#caterpillarPlot");
  svg.selectAll("*").remove();

  if (!studies || studies.length === 0) return;

  profile = profile || { transform: x => x, label: "Effect" };

  // ---- Sorted study list (descending yi so largest effect is at top) ----
  const sorted = studies
    .filter(s => isFinite(s.yi) && isFinite(s.vi))
    .slice()
    .sort((a, b) => b.yi - a.yi);

  const k = sorted.length;
  if (k === 0) return;

  const ROW_H   = 16;
  const W       = +svg.attr("width") || 520;
  // Dynamic left margin fitted to the longest study label (≈6.5px per char at 10px font)
  const maxStudyLen = sorted.reduce((m, s) => Math.max(m, (s.label || "").length), 0);
  const leftMargin  = Math.max(50, Math.min(160, Math.ceil(maxStudyLen * 6.5) + 14));
  const margin  = { top: 28, right: 20, bottom: 38, left: leftMargin };

  // Dynamic height, capped at 900 px
  const H = Math.min(900, margin.top + k * ROW_H + margin.bottom);
  svg.attr("height", H);

  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  // Visible rows that fit in iH
  const visibleK = Math.min(k, Math.floor(iH / ROW_H));

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- Group colour palette ----
  const allGroups = [...new Set(sorted.map(s => s.group || "").filter(Boolean))];
  const hasGroups = allGroups.length > 1;
  const GROUP_COLORS = [
    "var(--accent)",
    "var(--color-info)",
    "var(--color-warning)",
    "var(--color-error)",
    "#9966cc",
    "#669966",
  ];
  const groupColor = grp => {
    const idx = allGroups.indexOf(grp);
    return idx >= 0 ? GROUP_COLORS[idx % GROUP_COLORS.length] : "var(--fg-subtle)";
  };

  // ---- X scale (internal scale) ----
  // Individual study CI: yi ± Z_95 * se  (always normal, per forest plot convention)
  const ciLows  = sorted.map(s => s.yi - Z_95 * (s.se || Math.sqrt(s.vi)));
  const ciHighs = sorted.map(s => s.yi + Z_95 * (s.se || Math.sqrt(s.vi)));
  const refs    = [...ciLows, ...ciHighs, m.RE, 0].filter(isFinite);
  const xExtent = Math.max(...refs.map(Math.abs)) * 1.08 || 1;
  const x = d3.scaleLinear().domain([-xExtent, xExtent]).range([0, iW]);

  // ---- Clip path so rows beyond iH don't overdraw the axis ----
  const clipId = "caterpillar-clip";
  svg.append("defs").append("clipPath").attr("id", clipId)
    .append("rect").attr("width", iW).attr("height", iH);

  const gClipped = g.append("g").attr("clip-path", `url(#${clipId})`);

  const tooltip = d3.select("#tooltip");

  // ---- Null reference line (dashed) ----
  gClipped.append("line")
    .attr("x1", x(0)).attr("x2", x(0))
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--border-hover)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3");

  // ---- RE line (solid, muted) ----
  if (isFinite(m.RE)) {
    gClipped.append("line")
      .attr("x1", x(m.RE)).attr("x2", x(m.RE))
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--accent)")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.55);
  }

  // ---- Study rows ----
  sorted.slice(0, visibleK).forEach((s, i) => {
    const cy    = i * ROW_H + ROW_H / 2;
    const lo    = ciLows[i];
    const hi    = ciHighs[i];
    const color = hasGroups ? groupColor(s.group || "") : "var(--fg-subtle)";

    // CI line
    gClipped.append("line")
      .attr("x1", x(lo)).attr("x2", x(hi))
      .attr("y1", cy).attr("y2", cy)
      .attr("stroke", color)
      .attr("stroke-width", s.filled ? 1 : 1.4)
      .attr("stroke-opacity", s.filled ? 0.45 : 0.80);

    // CI end ticks
    [lo, hi].forEach(v => {
      gClipped.append("line")
        .attr("x1", x(v)).attr("x2", x(v))
        .attr("y1", cy - 3).attr("y2", cy + 3)
        .attr("stroke", color)
        .attr("stroke-width", s.filled ? 1 : 1.4)
        .attr("stroke-opacity", s.filled ? 0.45 : 0.80);
    });

    // Point estimate circle
    gClipped.append("circle")
      .attr("cx", x(s.yi)).attr("cy", cy)
      .attr("r", s.filled ? 2.5 : 3.2)
      .attr("fill", color)
      .attr("fill-opacity", s.filled ? 0.40 : 1)
      .on("mousemove", (event) => {
        const seVal  = (s.se || Math.sqrt(s.vi)).toFixed(3);
        const yi_t   = profile.transform(s.yi);
        const lo_t   = profile.transform(lo);
        const hi_t   = profile.transform(hi);
        const fmtCI  = v => isFinite(v) ? +v.toFixed(3) : "NA";
        tooltip.style("opacity", 1)
          .html(`<b>${s.label}</b><br>Effect: ${fmtCI(yi_t)} [${fmtCI(lo_t)}, ${fmtCI(hi_t)}]<br>SE: ${seVal}${s.filled ? "<br><i>(imputed)</i>" : ""}`)
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY - 24) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0));

    // Study label (left margin)
    const maxChars = Math.floor((margin.left - 12) / 6.5);
    const labelTxt = s.label.length > maxChars ? s.label.slice(0, maxChars - 1) + "…" : s.label;
    g.append("text")
      .attr("x", -8).attr("y", cy + 4)
      .attr("text-anchor", "end")
      .attr("fill", s.filled ? "var(--fg-muted)" : "var(--fg)")
      .style("font-size", "10px")
      .text(labelTxt);
  });

  // ---- X axis ----
  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(v => {
      const t = profile.transform(v);
      return isFinite(t) ? +t.toFixed(2) : "";
    }));
  axisX.select(".domain").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick line").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick text").attr("fill", "var(--fg-muted)").style("font-size", "10px");

  // ---- X axis label ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 4)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text(profile.label);

  // ---- Heterogeneity + k annotation (top margin, clear of study rows) ----
  const hetParts = [`k = ${k}`];
  if (isFinite(m.I2))                 hetParts.push(`I² = ${(m.I2 * 100).toFixed(1)}%`);
  if (isFinite(m.tau2) && m.tau2 > 0) hetParts.push(`τ² = ${m.tau2.toFixed(3)}`);
  svg.append("text")
    .attr("x", margin.left + 4)
    .attr("y", 16)
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "10px")
    .text(hetParts.join("  "));

  // ---- Legend (groups only) ----
  if (hasGroups) {
    allGroups.forEach((grp, gi) => {
      const color = GROUP_COLORS[gi % GROUP_COLORS.length];
      const lx = iW - 4;
      const ly = gi * 14;
      g.append("line")
        .attr("x1", lx - 20).attr("x2", lx - 6)
        .attr("y1", ly + 5).attr("y2", ly + 5)
        .attr("stroke", color).attr("stroke-width", 2);
      g.append("circle")
        .attr("cx", lx - 13).attr("cy", ly + 5)
        .attr("r", 3).attr("fill", color);
      g.append("text")
        .attr("x", lx - 24).attr("y", ly + 9)
        .attr("text-anchor", "end")
        .attr("fill", "var(--fg-muted)")
        .style("font-size", "10px")
        .text(grp.length > 14 ? grp.slice(0, 13) + "…" : grp);
    });
  }
}

// ================= BAUJAT PLOT =================
// Diagnostic scatter plot: x = each study's contribution to Cochran's Q,
// y = each study's influence on the FE pooled estimate.
// Dashed quadrant guides are drawn at the mean x and mean y across studies.
// Studies in the top-right quadrant are both highly heterogeneous AND highly
// influential — the primary targets for sensitivity investigation.
// Reference: Baujat et al. (2002) Statistics in Medicine 21:2442–2456.
export function drawBaujatPlot(result, profile) {
  const svg = d3.select("#baujatPlot");
  svg.selectAll("*").remove();

  if (!result || result.k < 2) return;

  profile = profile || { transform: x => x, label: "Effect" };

  const W = +svg.attr("width")  || 500;
  const H = +svg.attr("height") || 420;
  const margin = { top: 30, right: 24, bottom: 58, left: 62 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const { points } = result;

  // ---- Scales: both axes start at 0 (all values are non-negative) ----
  const xMax = Math.max(...points.map(p => p.x))         * 1.15 || 1;
  const yMax = Math.max(...points.map(p => p.influence)) * 1.15 || 1;
  const x = d3.scaleLinear().domain([0, xMax]).range([0, iW]);
  const y = d3.scaleLinear().domain([0, yMax]).range([iH, 0]);

  // ---- Group colour palette ----
  const allGroups = [...new Set(points.map(p => p.group || "").filter(Boolean))];
  const hasGroups = allGroups.length > 1;
  const GROUP_COLORS = [
    "var(--accent)",
    "var(--color-info)",
    "var(--color-warning)",
    "var(--color-error)",
    "#9966cc",
    "#669966",
  ];
  const pointColor = p => {
    if (!hasGroups) return "var(--accent)";
    const idx = allGroups.indexOf(p.group || "");
    return idx >= 0 ? GROUP_COLORS[idx % GROUP_COLORS.length] : "var(--fg-subtle)";
  };

  // ---- Quadrant guide lines at mean x and mean y ----
  const meanX = points.reduce((s, p) => s + p.x,         0) / points.length;
  const meanY = points.reduce((s, p) => s + p.influence, 0) / points.length;

  [{ val: meanX, axis: "x" }, { val: meanY, axis: "y" }].forEach(({ val, axis }) => {
    const x1 = axis === "x" ? x(val) : 0;
    const x2 = axis === "x" ? x(val) : iW;
    const y1 = axis === "y" ? y(val) : 0;
    const y2 = axis === "y" ? y(val) : iH;
    g.append("line")
      .attr("x1", x1).attr("x2", x2)
      .attr("y1", y1).attr("y2", y2)
      .attr("stroke", "var(--border-hover)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "5,3");
  });

  // ---- Points and labels ----
  const tooltip = d3.select("#tooltip");
  // Show inline labels only when k is small enough that they won't collide badly
  const showLabels = points.length <= 25;

  points.forEach(p => {
    const cx = x(p.x);
    const cy = y(p.influence);
    const color = pointColor(p);

    g.append("circle")
      .attr("cx", cx).attr("cy", cy)
      .attr("r", 5)
      .attr("fill", color)
      .attr("fill-opacity", 0.75)
      .attr("stroke", "var(--bg-surface)")
      .attr("stroke-width", 1)
      .on("mousemove", (event) => {
        const yi_t = profile.transform(p.yi);
        tooltip.style("opacity", 1)
          .html(
            `<b>${p.label}</b>` +
            `<br>Q contribution: ${p.x.toFixed(3)}` +
            `<br>Influence: ${p.influence.toFixed(4)}` +
            `<br>Effect (${profile.label}): ${isFinite(yi_t) ? +yi_t.toFixed(3) : "NA"}`
          )
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY - 24) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0));

    if (showLabels) {
      const abbr = p.label.length > 9 ? p.label.slice(0, 8) + "…" : p.label;
      g.append("text")
        .attr("x", cx + 7).attr("y", cy + 4)
        .attr("fill", "var(--fg-muted)")
        .style("font-size", "9px")
        .style("pointer-events", "none")
        .text(abbr);
    }
  });

  // ---- Axes ----
  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".3~g")));
  axisX.select(".domain").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick line").attr("stroke", "var(--border-hover)");
  axisX.selectAll(".tick text").attr("fill", "var(--fg-muted)").style("font-size", "10px");

  const axisY = g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".3~g")));
  axisY.select(".domain").attr("stroke", "var(--border-hover)");
  axisY.selectAll(".tick line").attr("stroke", "var(--border-hover)");
  axisY.selectAll(".tick text").attr("fill", "var(--fg-muted)").style("font-size", "10px");

  // ---- Axis labels ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 8)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Contribution to Cochran's Q");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2))
    .attr("y", 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Influence on pooled estimate");

  // ---- Summary annotation: Q and FE estimate ----
  const muFE_t = profile.transform(result.muFE);
  const annotParts = [`Q = ${result.Q.toFixed(2)}`];
  if (isFinite(muFE_t)) annotParts.push(`FE = ${(+muFE_t.toFixed(3))}`);
  g.append("text")
    .attr("x", iW - 2).attr("y", iH - 4)
    .attr("text-anchor", "end")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "10px")
    .text(annotParts.join("   "));

  // ---- Legend (groups only) ----
  if (hasGroups) {
    allGroups.forEach((grp, gi) => {
      const color = GROUP_COLORS[gi % GROUP_COLORS.length];
      const lx = iW - 4;
      const ly = gi * 16;
      g.append("circle")
        .attr("cx", lx - 80).attr("cy", ly + 5)
        .attr("r", 5).attr("fill", color).attr("fill-opacity", 0.75);
      g.append("text")
        .attr("x", lx - 72).attr("y", ly + 9)
        .attr("fill", "var(--fg-muted)")
        .style("font-size", "10px")
        .text(grp.length > 10 ? grp.slice(0, 9) + "…" : grp);
    });
  }
}

// ── drawRoBTrafficLight ──────────────────────────────────────────────────────
// Traffic-light grid: studies (rows) × domains (columns), coloured circles.
// studies  — array of study objects (used for labels)
// domains  — string[]
// robData  — { [studyLabel]: { [domain]: string } }  ("Low"|"Some concerns"|"High"|"NI"|"")
export function drawRoBTrafficLight(studies, domains, robData) {
  const svg = d3.select("#robTrafficLight");
  svg.selectAll("*").remove();
  if (!studies || !domains || domains.length === 0) return;

  const ROB_COLORS = {
    "Low":           "#4caf50",
    "Some concerns": "#ff9800",
    "High":          "#e53935",
    "NI":            "#9e9e9e",
  };

  const CELL_W   = 44;
  const CELL_H   = 22;
  const TOP      = 70;   // space for rotated domain labels
  const LEGEND_H = 30;

  const k        = studies.length;
  const d        = domains.length;

  // LEFT: sized to the longest study label (≈6.5px per char at 11px font), clamped [60, 160]
  const maxLabelLen = studies.reduce((m, s) => Math.max(m, (s.label ?? s.study ?? "").length), 0);
  const LEFT = Math.max(60, Math.min(160, Math.ceil(maxLabelLen * 6.5) + 14));

  // Legend needs LEFT + 290 + ~25px for "NI" text; content needs LEFT + d*CELL_W + 10
  const LEGEND_MIN_W = LEFT + 315;
  const svgW     = Math.max(LEGEND_MIN_W, LEFT + d * CELL_W + 10);
  const svgH     = TOP + k * CELL_H + LEGEND_H + 10;

  svg.attr("width", svgW).attr("height", svgH);

  const tooltip = d3.select("#tooltip");

  // ── Domain header labels (rotated −45°) ──
  domains.forEach((dom, di) => {
    const cx = LEFT + di * CELL_W + CELL_W / 2;
    svg.append("text")
      .attr("transform", `translate(${cx},${TOP - 4}) rotate(-45)`)
      .attr("text-anchor", "start")
      .attr("fill", "var(--fg)")
      .style("font-size", "11px")
      .text(dom.length > 14 ? dom.slice(0, 13) + "…" : dom);
  });

  // ── Rows ──
  studies.forEach((s, si) => {
    const label = s.label ?? s.study ?? "";
    const cy    = TOP + si * CELL_H + CELL_H / 2;

    // Study label
    svg.append("text")
      .attr("x", LEFT - 6)
      .attr("y", cy + 4)
      .attr("text-anchor", "end")
      .attr("fill", "var(--fg)")
      .style("font-size", "11px")
      .text(label.length > 18 ? label.slice(0, 17) + "…" : label);

    // Cells
    domains.forEach((dom, di) => {
      const rating = robData[label]?.[dom] ?? "";
      const cx     = LEFT + di * CELL_W + CELL_W / 2;

      if (rating && ROB_COLORS[rating]) {
        svg.append("circle")
          .attr("cx", cx).attr("cy", cy)
          .attr("r", 7)
          .attr("fill", ROB_COLORS[rating])
          .attr("fill-opacity", 0.85)
          .on("mouseover", (event) => {
            tooltip.style("opacity", 1)
              .html(`<strong>${label}</strong><br>${dom}<br>${rating}`);
          })
          .on("mousemove", (event) => {
            tooltip
              .style("left", (event.pageX + 12) + "px")
              .style("top",  (event.pageY - 28) + "px");
          })
          .on("mouseout", () => tooltip.style("opacity", 0));
      } else {
        // Unrated dash
        svg.append("line")
          .attr("x1", cx - 5).attr("x2", cx + 5)
          .attr("y1", cy).attr("y2", cy)
          .attr("stroke", "var(--fg-muted)")
          .attr("stroke-width", 1.5);
      }
    });
  });

  // ── Legend ──
  const legendY = TOP + k * CELL_H + 14;
  const items   = [["Low", "#4caf50"], ["Some concerns", "#ff9800"], ["High", "#e53935"], ["NI", "#9e9e9e"]];
  let lx = LEFT;
  items.forEach(([label, color]) => {
    svg.append("circle").attr("cx", lx + 6).attr("cy", legendY).attr("r", 6).attr("fill", color).attr("fill-opacity", 0.85);
    svg.append("text")
      .attr("x", lx + 15).attr("y", legendY + 4)
      .attr("fill", "var(--fg-muted)")
      .style("font-size", "10px")
      .text(label);
    lx += label === "Some concerns" ? 110 : 60;
  });
}

// ── drawRoBSummary ───────────────────────────────────────────────────────────
// Stacked horizontal bar chart: one bar per domain showing proportion of
// Low / Some concerns / High / NI ratings across all studies.
// studies  — array of study objects (for count)
// domains  — string[]
// robData  — { [studyLabel]: { [domain]: string } }
export function drawRoBSummary(studies, domains, robData) {
  const svg = d3.select("#robSummary");
  svg.selectAll("*").remove();
  if (!studies || !domains || domains.length === 0) return;

  const ROB_COLORS = {
    "Low":           "#4caf50",
    "Some concerns": "#ff9800",
    "High":          "#e53935",
    "NI":            "#9e9e9e",
  };
  const RATINGS   = ["Low", "Some concerns", "High", "NI"];

  const BAR_H    = 22;
  const BAR_GAP  = 6;
  const TOP      = 20;
  const LEGEND_H = 30;
  const RIGHT    = 20;

  const d   = domains.length;

  // LEFT: sized to the longest domain label (≈6.5px per char at 11px font), clamped [60, 160]
  const maxDomLen = domains.reduce((m, dom) => Math.max(m, dom.length), 0);
  const LEFT = Math.max(60, Math.min(160, Math.ceil(maxDomLen * 6.5) + 14));

  const svgW = Math.max(LEFT + 320, LEFT + 300 + RIGHT);
  const svgH = TOP + d * (BAR_H + BAR_GAP) + LEGEND_H + 10;

  svg.attr("width", svgW).attr("height", svgH);

  const barW = svgW - LEFT - RIGHT;
  const xScale = d3.scaleLinear().domain([0, 1]).range([0, barW]);

  domains.forEach((dom, di) => {
    const y    = TOP + di * (BAR_H + BAR_GAP);
    const counts = { "Low": 0, "Some concerns": 0, "High": 0, "NI": 0, "": 0 };
    studies.forEach(s => {
      const label  = s.label ?? s.study ?? "";
      const rating = robData[label]?.[dom] ?? "";
      if (rating in counts) counts[rating]++;
      else counts[""]++;
    });
    const total = studies.length || 1;

    // Domain label
    svg.append("text")
      .attr("x", LEFT - 6).attr("y", y + BAR_H / 2 + 4)
      .attr("text-anchor", "end")
      .attr("fill", "var(--fg)")
      .style("font-size", "11px")
      .text(dom.length > 18 ? dom.slice(0, 17) + "…" : dom);

    // Stacked bars
    let xOffset = 0;
    RATINGS.forEach(rating => {
      const prop = counts[rating] / total;
      if (prop === 0) return;
      const w = xScale(prop);
      svg.append("rect")
        .attr("x", LEFT + xOffset).attr("y", y)
        .attr("width", w).attr("height", BAR_H)
        .attr("fill", ROB_COLORS[rating])
        .attr("fill-opacity", 0.85)
        .on("mouseover", (event) => {
          d3.select("#tooltip").style("opacity", 1)
            .html(`<strong>${dom}</strong><br>${rating}: ${counts[rating]} / ${total} (${Math.round(prop * 100)}%)`);
        })
        .on("mousemove", (event) => {
          d3.select("#tooltip")
            .style("left", (event.pageX + 12) + "px")
            .style("top",  (event.pageY - 28) + "px");
        })
        .on("mouseout", () => d3.select("#tooltip").style("opacity", 0));

      // Percentage label inside bar (if wide enough)
      if (w >= 24) {
        svg.append("text")
          .attr("x", LEFT + xOffset + w / 2).attr("y", y + BAR_H / 2 + 4)
          .attr("text-anchor", "middle")
          .attr("fill", "#fff")
          .style("font-size", "10px")
          .style("pointer-events", "none")
          .text(`${Math.round(prop * 100)}%`);
      }
      xOffset += w;
    });

    // Unrated remainder
    const ratedProp = RATINGS.reduce((s, r) => s + counts[r] / total, 0);
    if (ratedProp < 1) {
      svg.append("rect")
        .attr("x", LEFT + xOffset).attr("y", y)
        .attr("width", xScale(1 - ratedProp)).attr("height", BAR_H)
        .attr("fill", "var(--border)")
        .attr("fill-opacity", 0.5);
    }
  });

  // ── Legend ──
  const legendY = TOP + d * (BAR_H + BAR_GAP) + 14;
  const items   = [["Low", "#4caf50"], ["Some concerns", "#ff9800"], ["High", "#e53935"], ["NI", "#9e9e9e"]];
  let lx = LEFT;
  items.forEach(([label, color]) => {
    svg.append("rect").attr("x", lx).attr("y", legendY - 8).attr("width", 12).attr("height", 12).attr("fill", color).attr("fill-opacity", 0.85);
    svg.append("text")
      .attr("x", lx + 15).attr("y", legendY + 2)
      .attr("fill", "var(--fg-muted)")
      .style("font-size", "10px")
      .text(label);
    lx += label === "Some concerns" ? 110 : 60;
  });
}