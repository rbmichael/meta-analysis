// =============================================================================
// plots.js — D3 plot renderers
// =============================================================================
// Renders all SVG visualisations directly into named DOM elements.
// Each function is stateless: it clears its target SVG, then redraws from
// scratch using the data passed in.  No function in this file reads from the
// DOM beyond the named SVG containers; the tooltip element is injected via
// setTooltipElement() so no "#tooltip" ID is hard-coded in plot functions.
//
// Standard signature
// ------------------
//   draw*(primaryData, pooledResult, profile, options = {})
//
//   Documented deviations (justified):
//   • drawForest(studies, m, options)          — profile is inside options because
//     the forest options bag (pageSize, page, theme, ciMethod, …) is cached as a
//     single object and re-spread on every redraw; extracting profile would split
//     that cache.
//   • drawCumulativeForest(results, profile, options)  — no pooledResult positional arg.
//   • drawCumulativeFunnel(studies, results, profile, stepIdx) — stepIdx is a
//     scalar slider position, not optional config; kept positional for clarity.
//   • drawBubble / drawPartialResidualBubble(studies, reg, mod, container) —
//     multiple bubble plots coexist on the same page, each targeting a caller-
//     supplied DOM container rather than a fixed SVG ID.
//   • drawInfluencePlot / drawPCurve / drawPUniform / drawBaujatPlot /
//     drawRoBTrafficLight / drawRoBSummary — single-argument or specialised
//     data shapes; no meaningful profile or pooledResult parameter.
//
// Exports
// -------
//   drawForest(studies, m, options)
//     Forest plot with paginated study rows, FE/RE/Both pooled diamonds,
//     prediction interval, heterogeneity summary, and annotation columns.
//     options: { ciMethod, profile, pageSize, page, pooledDisplay }
//     Returns { totalPages }.
//
//   drawFunnel(studies, m, profile, options)
//     Funnel plot (effect vs. SE) with optional Egger regression line.
//     options: { egger, contours, petpeese }
//
//   drawInfluencePlot(influence)
//     Influence diagnostics plot (Cook's D, hat values, DFFITS per study).
//
//   drawCumulativeForest(results, profile, options)
//     Cumulative forest plot: one row per cumulative step, showing how the
//     pooled estimate evolves as studies are added in order.
//
//   drawCumulativeFunnel(cumulativeStudies, cumResults, profile, stepIdx)
//     Cumulative funnel plot: shows the funnel at one cumulative step at a
//     time.  Axes are globally fixed (all studies) so the view is stable as
//     the slider advances.  The newly added study is highlighted in accent.
//
//   drawBubble(studies, reg, mod, container)
//     Bubble plot for a single continuous moderator in a meta-regression.
//     Bubble radius ∝ √(RE weight); regression line is the marginal fit.
//
//   drawOrchardPlot(studies, m, profile)
//     Orchard plot (Nakagawa et al., 2021): precision-weighted jittered study
//     circles with pooled PI bar, CI bar, and RE diamond at the band centre.
//     One band per group when groups are present.
//
//   drawCaterpillarPlot(studies, m, profile, options)
//     Caterpillar plot: one horizontal CI segment per study, sorted by effect
//     size descending.  Vertical lines mark the null and RE estimate.
//     SVG height resizes dynamically (16 px/study × page size).  Paginated.
//     options: { pageSize, page }  Returns { totalPages }.
//
//   drawBlupPlot(result, profile, options)
//     Dual caterpillar: each row shows observed yi (gray) and BLUP (accent)
//     connected by a dashed shrinkage line.  Paginated; dynamic SVG height.
//     options: { page, pageSize }.  Returns { totalPages }.
//
//   drawBaujatPlot(result, profile)
//     Baujat diagnostic scatter (Baujat et al., 2002): x = contribution to Q,
//     y = influence on FE pooled estimate.  Quadrant guides at mean x/y.
//
//   drawLabbe(studies, m, profile, options)
//     L'Abbé plot for binary outcomes: x = control event rate c/(c+d),
//     y = treatment event rate a/(a+b).  Bubble radius ∝ √N.  Reference
//     diagonal y = x (no effect); dashed pooled-RE curve (OR/RR/RD).
//     options: { type }  where type = "OR" | "RR" | "RD".
//
//   drawBayesTauPosterior(result, options)
//     Marginal posterior density of τ from bayesMeta().  Shaded 95% credible
//     region; vertical dashed line at posterior mean.
//     SVG target: #bayesTauPlot (500 × 340 px).
//
//   drawBayesMuPosterior(result, options)
//     Marginal posterior density of μ from bayesMeta() (mixture of normals).
//     Shaded 95% credible region; dashed line at posterior mean; dotted line
//     at frequentist RE estimate (options.reMean) for comparison.
//     SVG target: #bayesMuPlot (500 × 340 px).
//
//   drawGoshPlot(result, profile, options)
//     GOSH scatter (Harbord & Higgins, 2008): x = I², y = FE pooled estimate
//     on the display scale.  Points coloured by subset size n (Viridis).
//     Rendering: SVG circles for count ≤ 5 000; ImageData-painted canvas
//     embedded as <image> for larger datasets (zero-copy, ~50 ms for 1 M pts).
//     Canvas mode shows a coordinate-readout tooltip; SVG mode shows per-point
//     details (n, I², μ̂).
//     options: { xAxis, forReport }
//
//   drawProfileLikTau2(result, options)
//     options: { xScale }  "tau2" (default) or "tau"
//
//   drawQQPlot(stdResiduals, labels, options)
//     options: { containerId }  default "#qqPlot"
//
//   drawRadialPlot(studies, m, profile, options)
//     options: { containerId }  default "#radialPlot"
//
// All plots use CSS custom properties (var(--fg), var(--accent), etc.) so
// they respond automatically to light/dark theme switches.
//
// Module-level helpers (not exported)
// ------------------------------------
//   GROUP_COLORS        — shared subgroup colour palette (orchard/caterpillar/baujat)
//   clearAndSelectSVG() — select + clear an SVG; used at the top of each function
//   styleAxis()         — apply stroke/fill/fontFamily to a D3 axis group
//   paginate()          — slice an array to one page + return pagination metadata
//   attachTooltip()     — wire mousemove/mouseout tooltip onto a D3 selection
//
// Dependencies: utils.js (chiSquareCDF), constants.js (Z_95), D3 (global)
// =============================================================================

import { chiSquareCDF, normalQuantile } from "./utils.js";
import { Z_95 } from "./constants.js";
import { FOREST_THEMES } from "./forestThemes.js";
import { rcsBasis } from "./analysis.js";

// ── Tooltip element (set once by ui.js on load) ───────────────────────────────
// Decouples plot functions from the specific DOM ID "#tooltip".
// All internal code calls selTooltip() instead of selTooltip().
// d3.select(null) returns an empty selection — method calls on it are no-ops,
// so plots degrade gracefully if setTooltipElement is never called.
let _tooltipEl = null;
export function setTooltipElement(el) { _tooltipEl = el; }
function selTooltip() { return d3.select(_tooltipEl); }

// ── Shared D3 helpers ─────────────────────────────────────────────────────────

// GROUP_COLORS — colour palette for subgroup-coded studies/points.
// Shared by drawOrchardPlot, drawCaterpillarPlot, and drawBaujatPlot.
const GROUP_COLORS = [
  "var(--accent)",
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-error)",
  "#9966cc",
  "#669966",
];

// clearAndSelectSVG(selector)
// Selects the SVG at `selector`, clears all child elements, and returns the
// D3 selection.  Call once at the top of every stateless plot function.
function clearAndSelectSVG(selector) {
  const svg = d3.select(selector);
  svg.selectAll("*").remove();
  return svg;
}

// setSvgSize(sel, w, h)
// Sets width, height, and viewBox on an SVG D3 selection so that the SVG
// scales proportionally when CSS sets max-width: 100%.
function setSvgSize(sel, w, h) {
  return sel.attr("width", w).attr("height", h).attr("viewBox", `0 0 ${w} ${h}`);
}

// styleAxis(axisG, strokeColor, fillColor [, fontSize [, fontFamily]])
// Applies consistent styling to a D3 axis group produced by d3.axis*().
//   strokeColor — .domain line and each .tick line stroke
//   fillColor   — .tick text fill
//   fontSize    — optional font-size string (e.g. "10px") for tick labels
//   fontFamily  — optional font-family string; used by themed forest plots
function styleAxis(axisG, strokeColor, fillColor, fontSize, fontFamily) {
  axisG.select(".domain").attr("stroke", strokeColor);
  axisG.selectAll(".tick line").attr("stroke", strokeColor);
  const tickText = axisG.selectAll(".tick text").attr("fill", fillColor);
  if (fontSize)   tickText.style("font-size",   fontSize);
  if (fontFamily) tickText.style("font-family", fontFamily);
}

// paginate(arr, options) → { page, pageSize, totalPages, items, isLastPage }
// Extracts pagination state and the current page's item slice from an array.
// Used by drawForest, drawCumulativeForest, and drawCaterpillarPlot.
//   options.pageSize — items per page; Infinity = single page; default 30
//   options.page     — 0-based page index; default 0
function paginate(arr, options = {}) {
  const rawPageSize = options.pageSize ?? 30;
  const pageSize    = rawPageSize === Infinity ? arr.length : rawPageSize;
  const page        = options.page ?? 0;
  const totalPages  = Math.max(1, Math.ceil(arr.length / pageSize));
  const items       = arr.slice(page * pageSize, (page + 1) * pageSize);
  return { page, pageSize, totalPages, items, isLastPage: page >= totalPages - 1 };
}

// attachTooltip(sel, htmlFn)
// Wires mousemove/mouseout D3 tooltip handlers onto a selection `sel`.
// htmlFn(d) — called with the datum; returns the tooltip HTML string.
// Returns `sel` for chaining.
function attachTooltip(sel, htmlFn) {
  const tt = selTooltip();
  return sel
    .on("mousemove", (event, d) => {
      tt.style("opacity", 1)
        .html(htmlFn(d))
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY - 28) + "px");
    })
    .on("mouseout", () => tt.style("opacity", 0));
}

// ─────────────────────────────────────────────────────────────────────────────

// ---- Nonlinear moderator basis evaluator ----
// Evaluates the design-matrix basis columns for one continuous moderator
// at a given x value.  The return length matches modColMap[modName].length.
//   linear  → [x]
//   poly2   → [x, x²]
//   poly3   → [x, x², x³]
//   rcs3/4/5→ [x, φ₁(x), …]  (rcsBasis prepends only nonlinear terms; we add x)
function evalModBasis(x, transform, knots) {
  if (transform === "poly2") return [x, x * x];
  if (transform === "poly3") return [x, x * x, x * x * x];
  if (transform === "rcs3" || transform === "rcs4" || transform === "rcs5") {
    return [x, ...rcsBasis(x, knots)];
  }
  return [x];  // linear (default)
}

// ================= BUBBLE PLOT =================
// One bubble chart per continuous moderator.
// Bubble radius ∝ √(RE weight).  Regression line is the marginal fit:
// ŷ(x) = β₀ + Σ_j β_{colIdxs[j]}·basis_j(x) + Σ_{other} β_i·wmean(X_i)
//
// mod: { name, type, transform }  (from ui.js moderators state)
export function drawBubble(studies, reg, mod, container) {
  const modName = mod.name;
  const transform = mod.transform || "linear";
  const W = 460, H = 340;
  const margin = { top: 34, right: 18, bottom: 52, left: 56 };
  const _bubbleLabel = `Bubble plot for ${modName}`;
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

  // ---- Nonlinear setup ----
  const colIdxs = (reg.modColMap && reg.modColMap[modName]) || [];
  const knots   = reg.modKnots && reg.modKnots[modName];
  const isLinear = transform === "linear" || colIdxs.length <= 1;

  // ---- Marginal line: hold every other predictor at its RE-weighted mean ----
  const { beta, colNames, vcov, crit, s2 } = reg;

  function colValues(col) {
    if (col.includes(':')) {
      const [key, level] = col.split(':');
      return valid.map(s => s[key] === level ? 1 : 0);
    }
    return valid.map(s => +s[col]);
  }

  // wmeans[i] = weighted mean of column i.
  // Skip intercept (always 1) and ALL focal moderator columns (set in seAt per x).
  const colIdxSet = new Set(colIdxs);
  const wmeans = new Array(colNames.length).fill(0);
  wmeans[0] = 1;

  let intercept0 = beta[0];
  for (let i = 1; i < colNames.length; i++) {
    if (colIdxSet.has(i)) continue;  // focal moderator columns — handled per x
    const vals = colValues(colNames[i]);
    const wm   = vals.reduce((s, v, k) => s + wArr[k] * v, 0) / wSum;
    wmeans[i]  = wm;
    intercept0 += beta[i] * wm;
  }

  // fitAt(x): fitted value of the marginal curve at x
  // = intercept0 + Σ_j beta[colIdxs[j]] · basis[j](x)
  function fitAt(x) {
    if (!isFinite(intercept0)) return NaN;
    const basis = evalModBasis(x, transform, knots);
    return colIdxs.reduce((acc, ci, j) => acc + beta[ci] * basis[j], intercept0);
  }

  // seAt(x): delta-method SE of the marginal fitted value at x.
  function seAt(x) {
    if (!vcov) return NaN;
    const l = wmeans.slice();
    const basis = evalModBasis(x, transform, knots);
    colIdxs.forEach((ci, j) => { l[ci] = basis[j]; });
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
  const svg = setSvgSize(d3.select(container).append("svg")
    .attr("role", "img")
    .attr("aria-label", _bubbleLabel), W, H);
  const g   = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Zero line
  const [yd0, yd1] = yScale.domain();
  if (yd0 < 0 && yd1 > 0) {
    g.append("line")
      .attr("x1", 0).attr("x2", iW)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "var(--border-hover)").attr("stroke-dasharray", "4,2");
  }

  // Prediction band + regression curve (band drawn first, behind curve)
  if (colIdxs.length > 0 && isFinite(intercept0)) {
    const [xl, xr] = xScale.domain();
    const nPts = 120;
    const step = (xr - xl) / (nPts - 1);
    const pts  = Array.from({ length: nPts }, (_, i) => xl + i * step);

    // Shaded band
    if (vcov && isFinite(crit)) {
      const area = d3.area()
        .x(x  => xScale(x))
        .y0(x => { const f = fitAt(x); return yScale(f - crit * seAt(x)); })
        .y1(x => { const f = fitAt(x); return yScale(f + crit * seAt(x)); });
      g.append("path")
        .datum(pts)
        .attr("fill", "var(--accent-glow)")
        .attr("stroke", "none")
        .attr("d", area);
    }

    if (isLinear) {
      // Straight line for linear moderators
      g.append("line")
        .attr("x1", xScale(xl)).attr("y1", yScale(fitAt(xl)))
        .attr("x2", xScale(xr)).attr("y2", yScale(fitAt(xr)))
        .attr("stroke", "var(--accent)").attr("stroke-width", 2);
    } else {
      // Smooth curve for nonlinear moderators
      const line = d3.line().x(x => xScale(x)).y(x => yScale(fitAt(x)));
      g.append("path")
        .datum(pts)
        .attr("fill", "none")
        .attr("stroke", "var(--accent)").attr("stroke-width", 2)
        .attr("d", line);
    }
  }

  // Bubbles
  const tooltip = selTooltip();
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
      const fitted = fitAt(s[modName]);
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

  // Title — for linear show β; for nonlinear show transform label
  const linearBeta = () => isFinite(beta[colIdxs[0]]) ? beta[colIdxs[0]].toFixed(3) : "NA";
  const titleSuffix = isLinear
    ? `β = ${colIdxs.length ? linearBeta() : "NA"}`
    : transform.startsWith("rcs") ? `RCS (${transform.slice(3)} knots)` : transform;
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 16)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)").style("font-size", "13px")
    .text(`${modName}  (${titleSuffix})`);
}

// ================= PARTIAL-RESIDUAL BUBBLE PLOT =================
// Shows the added-variable (partial residual) view for one continuous moderator
// in a multi-moderator regression.  Use instead of drawBubble when p > 2
// (i.e. the model has more than one moderator) because raw yi vs x is misleading
// when predictors are correlated.
//
// Partial residual for study i:
//   y*_i = e_i + β_j · x_{ij}
//        = y_i − β_0 − Σ_{l≠j, l≥1} β_l · X_{il}
//
// This removes every predictor's contribution except the focal moderator, so
// the slope of y* on x is exactly β_j — matching the coefficient in the table.
//
// Regression line: passes through the weighted centroid (x̄_w, ȳ*_w) with
// slope β_j.  Confidence band uses the same delta-method seAt(x) as drawBubble
// (SE of the marginal prediction at x with all other predictors at their
// weighted means) — the band width is identical regardless of the y-shift.
// For nonlinear moderators the straight line is replaced by a smooth curve.
//
// mod: { name, type, transform }  (from ui.js moderators state)
export function drawPartialResidualBubble(studies, reg, mod, container) {
  const modName = mod.name;
  const transform = mod.transform || "linear";
  const _partialLabel = `Partial-residual bubble plot for ${modName}`;
  const W = 460, H = 340;
  const margin = { top: 34, right: 18, bottom: 52, left: 56 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  const valid = studies.filter(s => isFinite(s[modName]) && isFinite(s.yi) && isFinite(s.vi));
  if (valid.length < 2) return;

  const tau2 = isFinite(reg.tau2) ? reg.tau2 : 0;
  const wArr = valid.map(s => 1 / (s.vi + tau2));
  const wSum = wArr.reduce((a, b) => a + b, 0);
  const wMax = Math.max(...wArr);
  const rMax = 15;

  // ---- Nonlinear setup ----
  const colIdxs = (reg.modColMap && reg.modColMap[modName]) || [];
  const knots   = reg.modKnots && reg.modKnots[modName];
  const isLinear = transform === "linear" || colIdxs.length <= 1;

  const { beta, colNames, vcov, crit, s2 } = reg;

  // wmeans: skip ALL focal moderator columns.
  const colIdxSet = new Set(colIdxs);
  const wmeans = new Array(colNames.length).fill(0);
  wmeans[0] = 1;
  for (let i = 1; i < colNames.length; i++) {
    if (colIdxSet.has(i)) continue;
    const col = colNames[i];
    let vals;
    if (col.includes(':')) {
      const [key, level] = col.split(':');
      vals = valid.map(s => s[key] === level ? 1 : 0);
    } else {
      vals = valid.map(s => +s[col]);
    }
    wmeans[i] = vals.reduce((s, v, k) => s + wArr[k] * v, 0) / wSum;
  }

  // seAt(x): delta-method SE at moderator value x.
  function seAt(x) {
    if (!vcov) return NaN;
    const l = wmeans.slice();
    const basis = evalModBasis(x, transform, knots);
    colIdxs.forEach((ci, j) => { l[ci] = basis[j]; });
    let q = 0;
    for (let r = 0; r < l.length; r++)
      for (let c = 0; c < l.length; c++)
        q += l[r] * vcov[r][c] * l[c];
    return Math.sqrt(Math.max(0, q) * s2);
  }

  // ---- Partial residuals ----
  // y*_i = residuals_i + focalContrib_i
  //      = (y_i - fitted_i) + Σ_j beta[colIdxs[j]] · basis_j(x_i)
  // This removes all other predictors' contributions, leaving only the
  // focal moderator's contribution plus the residual.
  // reg.residuals are the RE residuals (yi - Xf @ beta) for studiesUsed.
  const residualsMap = new Map((reg.studiesUsed || []).map((s, i) => [s, reg.residuals[i]]));

  function focalContrib(x) {
    const basis = evalModBasis(x, transform, knots);
    return colIdxs.reduce((acc, ci, j) => acc + beta[ci] * basis[j], 0);
  }

  const partialY = valid.map(s => {
    const resid = residualsMap.get(s);
    return (resid !== undefined ? resid : s.yi - beta[0]) + focalContrib(s[modName]);
  });

  // Curve through partial residuals: at each x, the curve value is
  // focalContrib(x) + yIntercept, where yIntercept shifts the curve to
  // pass through the weighted centroid of (x, y*).
  const xVals  = valid.map(s => s[modName]);
  const xWMean = xVals.reduce((s, v, i) => s + wArr[i] * v, 0) / wSum;
  const yWMean = partialY.reduce((s, v, i) => s + wArr[i] * v, 0) / wSum;
  const yIntercept = isFinite(yWMean) && isFinite(xWMean)
    ? yWMean - focalContrib(xWMean)
    : NaN;

  function partialFitAt(x) {
    return isFinite(yIntercept) ? yIntercept + focalContrib(x) : NaN;
  }

  // ---- Scales ----
  const [xMin, xMax] = d3.extent(xVals);
  const xPad = (xMax - xMin) * 0.12 || 0.5;
  const xScale = d3.scaleLinear().domain([xMin - xPad, xMax + xPad]).range([0, iW]);

  const [yMin, yMax] = d3.extent(partialY);
  const yPad = (yMax - yMin) * 0.15 || 0.2;
  const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).nice().range([iH, 0]);

  // ---- SVG ----
  const svg = setSvgSize(d3.select(container).append("svg")
    .attr("role", "img")
    .attr("aria-label", _partialLabel), W, H);
  const g   = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Zero line
  const [yd0, yd1] = yScale.domain();
  if (yd0 < 0 && yd1 > 0) {
    g.append("line")
      .attr("x1", 0).attr("x2", iW)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "var(--border-hover)").attr("stroke-dasharray", "4,2");
  }

  // Prediction band + regression curve
  if (isFinite(yIntercept) && colIdxs.length > 0) {
    const [xl, xr] = xScale.domain();
    const nPts = 120;
    const step = (xr - xl) / (nPts - 1);
    const pts  = Array.from({ length: nPts }, (_, i) => xl + i * step);

    if (vcov && isFinite(crit)) {
      const area = d3.area()
        .x(x  => xScale(x))
        .y0(x => { const f = partialFitAt(x); return yScale(f - crit * seAt(x)); })
        .y1(x => { const f = partialFitAt(x); return yScale(f + crit * seAt(x)); });
      g.append("path")
        .datum(pts)
        .attr("fill", "var(--accent-glow)")
        .attr("stroke", "none")
        .attr("d", area);
    }

    if (isLinear) {
      g.append("line")
        .attr("x1", xScale(xl)).attr("y1", yScale(partialFitAt(xl)))
        .attr("x2", xScale(xr)).attr("y2", yScale(partialFitAt(xr)))
        .attr("stroke", "var(--accent)").attr("stroke-width", 2);
    } else {
      const line = d3.line().x(x => xScale(x)).y(x => yScale(partialFitAt(x)));
      g.append("path")
        .datum(pts)
        .attr("fill", "none")
        .attr("stroke", "var(--accent)").attr("stroke-width", 2)
        .attr("d", line);
    }
  }

  // Bubbles
  const tooltip = selTooltip();
  g.selectAll("circle")
    .data(valid)
    .enter().append("circle")
    .attr("cx", s => xScale(s[modName]))
    .attr("cy", (_, i) => yScale(partialY[i]))
    .attr("r",  (_, i) => Math.max(3, rMax * Math.sqrt(wArr[i] / wMax)))
    .attr("fill",   "var(--bg-surface-hover)")
    .attr("stroke", "var(--fg-subtle)")
    .attr("stroke-width", 1.2)
    .on("mousemove", (event, s) => {
      const i      = valid.indexOf(s);
      const fitted = partialFitAt(s[modName]);
      tooltip.style("opacity", 1)
        .html(`<b>${s.label}</b><br>${modName}: ${s[modName]}<br>y*: ${partialY[i].toFixed(3)}<br>ŷ: ${fitted.toFixed(3)}`)
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
    .text("Partial residual");

  // Title
  const slope = isFinite(beta[colIdxs[0]]) ? beta[colIdxs[0]].toFixed(3) : "NA";
  const titleSuffix = isLinear
    ? `β = ${slope}, partial residual`
    : (transform.startsWith("rcs") ? `RCS (${transform.slice(3)} knots)` : transform) + ", partial residual";
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 16)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)").style("font-size", "13px")
    .text(`${modName}  (${titleSuffix})`);
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
// ── Forest plot sub-renderers ────────────────────────────────────────────────
// All accept a render context: ctx = { svg, x, L, T, profile }

function forestDrawStudyRows(ctx, pageStudies, studies, studyCrit, widthCiLabel, ciMethodLabel, yPos) {
  const { svg, x, L, T, profile } = ctx;
  const tooltip = selTooltip();
  const wMax    = d3.max(studies, d => d.w);

  svg.selectAll("line.ci")
    .data(pageStudies).enter().append("line")
    .attr("x1", d => x(d.yi - studyCrit * d.se))
    .attr("x2", d => x(d.yi + studyCrit * d.se))
    .attr("y1", d => yPos.get(d)).attr("y2", d => yPos.get(d))
    .attr("stroke", d => d.filled ? T.fgMuted : T.fgSubtle)
    .attr("stroke-width", T.ciStrokeWidth);

  // Weight boxes — wMax uses the full study array so sizes are comparable across pages.
  svg.selectAll("rect")
    .data(pageStudies).enter().append("rect")
    .attr("x", d => x(d.yi) - Math.sqrt(d.w / wMax) * L.boxHalf * 2)
    .attr("y", d => yPos.get(d) - L.boxHalf)
    .attr("width",  d => Math.sqrt(d.w / wMax) * L.boxHalf * 4)
    .attr("height", L.boxHalf * 2)
    .attr("fill",   d => d.filled ? "none"    : T.accent)
    .attr("stroke", d => d.filled ? T.fgMuted : T.accent)
    .on("mousemove", (e, d) => {
      const ef_disp = profile.transform(d.yi);
      const lo_disp = profile.transform(d.yi - studyCrit * d.se);
      const hi_disp = profile.transform(d.yi + studyCrit * d.se);
      tooltip.style("opacity", 1)
        .html(`${d.label}<br>Effect: ${isFinite(ef_disp) ? ef_disp.toFixed(3) : "NA"}<br>` +
              `${widthCiLabel} (${ciMethodLabel}): ${isFinite(lo_disp) ? lo_disp.toFixed(3) : "NA"} – ${isFinite(hi_disp) ? hi_disp.toFixed(3) : "NA"}`)
        .style("left", (e.pageX + 10) + "px").style("top", (e.pageY - 20) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));
}

function forestDrawStudyLabels(ctx, pageStudies, yPos, charW) {
  const { svg, L, T } = ctx;
  const maxChars = Math.floor((L.labelW - 8) / charW);
  pageStudies.forEach(d => {
    const lbl = d.label.length > maxChars ? d.label.slice(0, maxChars - 1) + "…" : d.label;
    svg.append("text")
      .attr("x", L.labelW - 8).attr("y", yPos.get(d) + 4)
      .attr("text-anchor", "end")
      .style("font-size", L.labelFontSize).style("font-family", T.fontFamily)
      .attr("fill", d.filled ? T.fgMuted : T.fg)
      .text(lbl);
  });
}

// forestDrawDiamond — module-level equivalent of the former drawDiamond() closure.
// Appends one pooled-estimate diamond to the forest SVG.
//   center/ciLow/ciHigh — point estimate and CI bounds on the analysis scale
//   yMid                — vertical centre pixel of the diamond row
//   fillColor           — CSS colour string
//   strokeDash          — stroke-dasharray string, or null for solid
//   labelText           — short label right-aligned in the study-name column
//   tooltipText         — SVG <title> shown on hover
//   diamondHH           — half-height of the diamond in pixels
function forestDrawDiamond(ctx, center, ciLow, ciHigh, yMid, fillColor, strokeDash, labelText, tooltipText, diamondHH) {
  const { svg, x, L, T } = ctx;
  const pts = [
    [x(ciLow),  yMid],
    [x(center), yMid - diamondHH],
    [x(ciHigh), yMid],
    [x(center), yMid + diamondHH],
  ];
  svg.append("polygon")
    .attr("points", pts.map(p => p.join(",")).join(" "))
    .attr("fill",   fillColor).attr("stroke", fillColor)
    .attr("stroke-width", strokeDash ? 2.5 : 1.5)
    .attr("stroke-dasharray", strokeDash || "0")
    .append("title").text(tooltipText);

  svg.append("text")
    .attr("x", L.labelW - 8).attr("y", yMid + 4)
    .attr("text-anchor", "end")
    .style("font-size", L.labelFontSize).style("font-family", T.fontFamily)
    .style("font-weight", "bold")
    .attr("fill", fillColor).text(labelText);
}

function forestDrawColumnHeaders(ctx, separators, hY) {
  const { svg, L, T } = ctx;

  svg.append("text")
    .attr("x", L.labelW - 8).attr("y", hY)
    .attr("text-anchor", "end")
    .style("font-size", L.labelFontSize).style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted).text("Study");

  svg.append("line")   // horizontal rule below header row
    .attr("x1", 0).attr("x2", L.totalW)
    .attr("y1", L.headerH).attr("y2", L.headerH)
    .attr("stroke", T.border).attr("stroke-width", T.headerRuleWidth);

  svg.append("line")   // vertical rule: label column | plot strip
    .attr("x1", L.labelW).attr("x2", L.labelW)
    .attr("y1", L.studyY0).attr("y2", L.studyY1 + 12)
    .attr("stroke", T.border);

  svg.append("line")   // vertical rule: plot strip | annotation column
    .attr("x1", L.annotX0).attr("x2", L.annotX0)
    .attr("y1", L.studyY0).attr("y2", L.studyY1 + 12)
    .attr("stroke", T.border);

  // Group separators — a full-width rule + bold group label per boundary
  separators.forEach(({ y: sepTop, group }) => {
    const ruleY = sepTop + L.sepH - 3;
    svg.append("line")
      .attr("x1", 0).attr("x2", L.totalW)
      .attr("y1", ruleY).attr("y2", ruleY)
      .attr("stroke", T.groupSepStroke);
    svg.append("text")
      .attr("x", L.labelW - 8).attr("y", ruleY - 3)
      .attr("text-anchor", "end")
      .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
      .style("font-weight", "bold")
      .attr("fill", T.groupLabelFill).text(group);
  });
}

function forestDrawAnnotations(ctx, pageStudies, yPos, studies, studyCrit, m,
                               showFE, showRE, showBoth, feCiLow, feCiHigh, hY, widthCiLabel) {
  const { svg, L, T, profile } = ctx;
  const efAnnotX     = L.annotX0 + 8;
  const wtAnnotX     = L.totalW - 6;
  const realStudies  = studies.filter(d => !d.filled);
  const totalW_annot = d3.sum(realStudies, d => d.w);

  // Column headers
  svg.append("text")
    .attr("x", efAnnotX).attr("y", hY)
    .style("font-size", L.labelFontSize).style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted).text(`Effect [${widthCiLabel ?? "95% CI"}]`);
  svg.append("text")
    .attr("x", wtAnnotX).attr("y", hY).attr("text-anchor", "end")
    .style("font-size", L.labelFontSize).style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted).text("Weight");

  // Per-study annotation rows (page slice only)
  pageStudies.forEach(d => {
    const rowMid = yPos.get(d) + 4;
    const ef  = profile.transform(d.yi);
    const lo  = profile.transform(d.yi - studyCrit * d.se);
    const hi  = profile.transform(d.yi + studyCrit * d.se);
    const efStr = isFinite(ef) ? ef.toFixed(3) : "NA";
    const ciStr = `[${isFinite(lo) ? lo.toFixed(3) : "NA"}, ${isFinite(hi) ? hi.toFixed(3) : "NA"}]`;
    const wPct  = d.filled
      ? "\u2014"
      : (isFinite(d.w) && totalW_annot > 0) ? (d.w / totalW_annot * 100).toFixed(1) + "%" : "NA";

    svg.append("text")
      .attr("x", efAnnotX).attr("y", rowMid)
      .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
      .attr("fill", d.filled ? T.fgMuted : T.fgSubtle)
      .text(`${efStr} ${ciStr}`);
    svg.append("text")
      .attr("x", wtAnnotX).attr("y", rowMid).attr("text-anchor", "end")
      .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
      .attr("fill", d.filled ? T.fgMuted : T.fgSubtle)
      .text(wPct);
  });

  // Pooled annotation rows — effect + CI and "100%" for each visible estimate
  function annotatePooled(ef, lo, hi, yMid, color) {
    const efT   = profile.transform(ef);
    const loT   = profile.transform(lo);
    const hiT   = profile.transform(hi);
    const efStr = isFinite(efT) ? efT.toFixed(3) : "NA";
    const ciStr = `[${isFinite(loT) ? loT.toFixed(3) : "NA"}, ${isFinite(hiT) ? hiT.toFixed(3) : "NA"}]`;
    svg.append("text")
      .attr("x", efAnnotX).attr("y", yMid + 4)
      .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
      .attr("fill", color).text(`${efStr} ${ciStr}`);
    svg.append("text")
      .attr("x", wtAnnotX).attr("y", yMid + 4).attr("text-anchor", "end")
      .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
      .attr("fill", color).text("100%");
  }

  if (showFE) annotatePooled(m.FE, feCiLow, feCiHigh, showBoth ? L.feDiamondY : L.diamondY, T.accentFE);
  if (showRE) annotatePooled(m.RE, m.ciLow, m.ciHigh, L.diamondY, T.accentREAnnot);
}

function forestDrawPredictionInterval(ctx, m, showRE) {
  const { svg, x, L, T, profile } = ctx;
  if (!showRE || !isFinite(m.predLow) || !isFinite(m.predHigh)) return;

  svg.append("line")
    .attr("x1", x(m.predLow)).attr("x2", x(m.predHigh))
    .attr("y1", L.piY).attr("y2", L.piY)
    .attr("stroke", T.pi).attr("stroke-width", 2).attr("stroke-dasharray", "6,3")
    .append("title").text("Prediction interval: expected range of true effects in future studies");

  svg.append("line")
    .attr("x1", x(m.predLow)).attr("x2", x(m.predLow))
    .attr("y1", L.piY - 5).attr("y2", L.piY + 5)
    .attr("stroke", T.pi).attr("stroke-width", 2);
  svg.append("line")
    .attr("x1", x(m.predHigh)).attr("x2", x(m.predHigh))
    .attr("y1", L.piY - 5).attr("y2", L.piY + 5)
    .attr("stroke", T.pi).attr("stroke-width", 2);

  const pi_disp = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  svg.append("text")
    .attr("x", x(m.RE)).attr("y", L.piY + 15).attr("text-anchor", "middle")
    .style("font-size", L.labelFontSize).style("font-family", T.fontFamily)
    .attr("fill", T.pi)
    .text(`Prediction interval: ${isFinite(pi_disp.lb) ? pi_disp.lb.toFixed(3) : "NA"} to ${isFinite(pi_disp.ub) ? pi_disp.ub.toFixed(3) : "NA"}`);
}

function forestDrawHetSummary(ctx, m) {
  const { svg, L, T } = ctx;
  const Qp = (isFinite(m.Q) && isFinite(m.df) && m.df > 0) ? 1 - chiSquareCDF(m.Q, m.df) : NaN;
  svg.append("text")
    .attr("x", L.labelW + L.plotW / 2).attr("y", L.hetY).attr("text-anchor", "middle")
    .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
    .attr("fill", T.fgMuted)
    .text(`Heterogeneity:  τ² = ${isFinite(m.tau2) ? m.tau2.toFixed(3) : "NA"},` +
          `  I² = ${isFinite(m.I2) ? m.I2.toFixed(1) + "%" : "NA"},` +
          `  Q(df=${isFinite(m.df) ? m.df : "NA"}) = ${isFinite(m.Q) ? m.Q.toFixed(2) : "NA"},` +
          `  p = ${isFinite(Qp) ? (Qp < 0.001 ? "< 0.001" : Qp.toFixed(3)) : "NA"}`);
}

export function drawForest(studies, m, options = {}) {
  const svg       = clearAndSelectSVG("#forestPlot");
  const ciMethod  = options.ciMethod || "normal";
  const profile   = options.profile  || { transform: x => x };
  const T         = FOREST_THEMES[options.theme] ?? FOREST_THEMES["default"];

  const pooledDisplay = options.pooledDisplay || "RE";
  const showFE   = pooledDisplay === "FE"   || pooledDisplay === "Both";
  const showRE   = pooledDisplay === "RE"   || pooledDisplay === "Both";
  const showBoth = showFE && showRE;

  const alpha        = options.alpha    ?? 0.05;
  const widthCiLabel = options.ciLabel  ?? "95% CI";
  const studyCrit    = normalQuantile(1 - alpha / 2);
  const feCiLow  = isFinite(m.FE) ? m.FE - studyCrit * m.seFE : NaN;
  const feCiHigh = isFinite(m.FE) ? m.FE + studyCrit * m.seFE : NaN;

  const ciMethodLabel = {
    normal: "Normal (z)", t: "t-distribution", KH: "Knapp-Hartung", PL: "Profile Likelihood"
  }[ciMethod] || ciMethod;

  const { page, totalPages, items: pageStudies, isLastPage } = paginate(studies, options);

  // ----------- LAYOUT -----------
  const k = studies.length;
  const L = k <= 20
    ? { rowH: 22, labelFontSize: "11px", annotFontSize: "10px", titleFontSize: "12px", boxHalf: 5, diamondHH: 8 }
    : k <= 40
    ? { rowH: 18, labelFontSize: "10px", annotFontSize: "9px",  titleFontSize: "11px", boxHalf: 4, diamondHH: 7 }
    : { rowH: 14, labelFontSize: "9px",  annotFontSize: "8px",  titleFontSize: "10px", boxHalf: 3, diamondHH: 6 };
  L.plotW = 440; L.annotW = 240; L.headerH = 28;

  const _charW          = parseFloat(L.labelFontSize) >= 11 ? 6.5 : parseFloat(L.labelFontSize) >= 10 ? 5.9 : 5.3;
  const _diamondLabelLen = showBoth ? 6 : 14;
  const _maxLen         = Math.min(Math.max(
    studies.reduce((a, d) => Math.max(a, (d.label || "").length), 0),
    studies.reduce((a, d) => Math.max(a, (d.group || "").length), 0),
    _diamondLabelLen
  ), 28);
  L.labelW  = Math.max(70, Math.min(180, Math.ceil(_maxLen * _charW) + 16));
  L.totalW  = L.labelW + L.plotW + L.annotW;
  L.summaryH = isLastPage ? (showBoth ? 152 : 132) : 52;
  L.studyY0  = L.headerH;
  L.sepH     = Math.max(14, L.rowH);

  // ----------- Y-POSITION MAP -----------
  // Keyed on study object identity (Map), not label string, so duplicate or
  // empty labels don't collide and overwrite each other.
  const hasGroups = studies.some(d => d.group && d.group.trim() !== "");
  const yPos       = new Map();
  const separators = [];
  let cursor = L.studyY0, prevGroup = null;
  pageStudies.forEach(d => {
    const group = (d.group || "").trim();
    if (hasGroups && prevGroup !== null && group !== prevGroup) {
      separators.push({ y: cursor, group });
      cursor += L.sepH;
    }
    yPos.set(d, cursor + L.rowH / 2);
    cursor += L.rowH;
    prevGroup = hasGroups ? group : null;
  });

  L.studyY1    = cursor;
  L.totalH     = L.studyY1 + L.summaryH;
  L.axisY      = L.totalH - 26;
  L.feDiamondY = L.studyY1 + 18;
  L.diamondY   = showBoth ? L.studyY1 + 36 : L.studyY1 + 18;
  L.piY        = showBoth ? L.studyY1 + 60 : L.studyY1 + 44;
  L.hetY       = showBoth ? L.studyY1 + 98 : L.studyY1 + 80;
  L.annotX0    = L.labelW + L.plotW;

  setSvgSize(svg, L.totalW, L.totalH);
  if (T.bg && T.bg !== "transparent") {
    svg.insert("rect", ":first-child")
      .attr("width", L.totalW).attr("height", L.totalH).attr("fill", T.bg);
  }

  // ----------- SCALE -----------
  const domainVals = studies.flatMap(d => [d.yi - studyCrit * d.se, d.yi + studyCrit * d.se]);
  if (showRE) {
    if (isFinite(m.ciLow))    domainVals.push(m.ciLow);
    if (isFinite(m.ciHigh))   domainVals.push(m.ciHigh);
    if (isFinite(m.predLow))  domainVals.push(m.predLow);
    if (isFinite(m.predHigh)) domainVals.push(m.predHigh);
  }
  if (showFE) {
    if (isFinite(feCiLow))  domainVals.push(feCiLow);
    if (isFinite(feCiHigh)) domainVals.push(feCiHigh);
  }
  const x = d3.scaleLinear().domain(d3.extent(domainVals)).nice().range([L.labelW, L.labelW + L.plotW]);

  const ctx = { svg, x, L, T, profile };

  // ----------- TITLE -----------
  svg.append("text")
    .attr("x", L.labelW + L.plotW / 2).attr("y", L.headerH / 2 + 5)
    .attr("text-anchor", "middle").attr("fill", T.fgMuted)
    .style("font-size", L.titleFontSize).style("font-family", T.fontFamily)
    .text(showBoth
      ? `Fixed-effect and Random-effects models (RE: ${ciMethodLabel})`
      : showFE ? "Fixed-effect model" : `Random-effects model (${ciMethodLabel})`);

  // ----------- NULL REFERENCE LINE -----------
  const nullX = x(0);
  if (nullX >= L.labelW && nullX <= L.labelW + L.plotW) {
    svg.append("line")
      .attr("x1", nullX).attr("x2", nullX)
      .attr("y1", L.studyY0).attr("y2", isLastPage ? L.diamondY + L.diamondHH : L.studyY1)
      .attr("stroke", T.border).attr("stroke-dasharray", T.nullLineDash);
  }

  forestDrawStudyRows(ctx, pageStudies, studies, studyCrit, widthCiLabel, ciMethodLabel, yPos);

  // ----------- AXIS -----------
  const axisG = svg.append("g")
    .attr("transform", `translate(0,${L.axisY})`)
    .call(d3.axisBottom(x).tickFormat(v => {
      const d = profile.transform(v);
      return isFinite(d) ? +d.toFixed(3) : "";
    }));
  styleAxis(axisG, T.border, T.fgMuted, null, T.fontFamily);
  if (profile.isLog) {
    svg.append("text")
      .attr("x", L.labelW + L.plotW / 2).attr("y", L.axisY + 22)
      .attr("text-anchor", "middle")
      .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
      .attr("fill", T.fgMuted).text("(log scale)");
  }

  forestDrawStudyLabels(ctx, pageStudies, yPos, _charW);

  if (!isLastPage) {
    svg.append("text")
      .attr("x", L.labelW + L.plotW / 2).attr("y", L.studyY1 + 18)
      .attr("text-anchor", "middle")
      .style("font-size", L.annotFontSize).style("font-family", T.fontFamily)
      .attr("fill", T.fgMuted)
      .text(`— page ${page + 1} of ${totalPages}, continued —`);
    svg.attr("height", L.totalH);
    return { totalPages };
  }

  // ----------- POOLED DIAMONDS (last page only) -----------
  if (showFE) {
    forestDrawDiamond(ctx, m.FE, feCiLow, feCiHigh,
      showBoth ? L.feDiamondY : L.diamondY,
      T.accentFE, null,
      showBoth ? "Fixed" : "Fixed-effect",
      "Fixed-effect model CI (Normal/Z)", L.diamondHH);
  }
  if (showRE) {
    const reDash    = ciMethod === "KH" ? "4,2" : null;
    const reTooltip = ciMethod === "KH" ? "Knapp-Hartung CI (adjusted variance)"
      : ciMethod === "t" ? "t-distribution CI" : "Normal (Wald) CI";
    forestDrawDiamond(ctx, m.RE, m.ciLow, m.ciHigh,
      L.diamondY, T.accent, reDash,
      showBoth ? "Random" : "Random-effects",
      reTooltip, L.diamondHH);
  }

  const hY = L.headerH / 2 + 5;
  forestDrawColumnHeaders(ctx, separators, hY);
  forestDrawAnnotations(ctx, pageStudies, yPos, studies, studyCrit, m, showFE, showRE, showBoth, feCiLow, feCiHigh, hY, widthCiLabel);
  forestDrawPredictionInterval(ctx, m, showRE);
  forestDrawHetSummary(ctx, m);

  return { totalPages };
}

// ---- Funnel sub-renderers ----

function funnelDrawContours(svg, bgColor, BANDS, bandPath, W, H) {
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

function funnelDrawFunnelArms(svg, x, y, seMax, xHalf, borderClr, m, contours, isDark) {
  const armRight = Math.min( 1.96 * seMax,  xHalf);
  const armLeft  = Math.max(-1.96 * seMax, -xHalf);
  svg.append("line")
    .attr("x1", x(0)).attr("y1", y(0))
    .attr("x2", x(armRight)).attr("y2", y(seMax))
    .attr("stroke", borderClr).attr("stroke-width", 1).attr("stroke-dasharray", "4,2");
  svg.append("line")
    .attr("x1", x(0)).attr("y1", y(0))
    .attr("x2", x(armLeft)).attr("y2", y(seMax))
    .attr("stroke", borderClr).attr("stroke-width", 1).attr("stroke-dasharray", "4,2");
  const reLineColor = contours ? (isDark ? "#5588cc" : "#2255aa") : "var(--accent)";
  svg.append("line")
    .attr("x1", x(m.RE)).attr("x2", x(m.RE))
    .attr("y1", y(0)).attr("y2", y(seMax))
    .attr("stroke", reLineColor)
    .attr("stroke-dasharray", "4");
}

function funnelDrawStudies(svg, studies, x, y, dotFill, dotStroke, dotFillImp, dotStrImp) {
  svg.selectAll("circle")
    .data(studies).enter().append("circle")
    .attr("cx", d => x(d.yi))
    .attr("cy", d => y(d.se))
    .attr("r", 4)
    .attr("fill",   d => d.filled ? dotFillImp : dotFill)
    .attr("stroke", d => d.filled ? dotStrImp  : dotStroke);
}

function funnelDrawEggerLine(svg, egger, studies, x, y, contours, isDark) {
  if (!egger || !isFinite(egger.slope)) return;
  const seMin = d3.min(studies, d => d.se);
  const seMax = d3.max(studies, d => d.se);
  if (seMin === seMax) return;
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

// Draw FAT-PET line and PEESE curve on funnel plot.
// FAT-PET is a straight line: yi = fat.intercept + fat.slope * se
// PEESE is a parabola:        yi = peese.intercept + peese.slope * vi = peese.intercept + peese.slope * se²
// The active estimate (usePeese → solid, inactive → dashed at lower opacity).
function funnelDrawPeeseLines(svg, petpeese, studies, x, y, contours, isDark) {
  const { fat, peese, usePeese } = petpeese;
  const seMin = d3.min(studies, d => d.se);
  const seMax = d3.max(studies, d => d.se);
  if (seMin === seMax) return;
  const pts = d3.range(0, 51).map(i => seMin + (i / 50) * (seMax - seMin));

  const petColor   = contours ? (isDark ? "#cc9944" : "#996600") : "var(--color-warning)";
  const peeseColor = contours ? (isDark ? "#44cc88" : "#007744") : "var(--color-success, #22aa66)";

  // FAT-PET line
  if (isFinite(fat.intercept) && isFinite(fat.slope)) {
    const lineData = pts.map(se => ({ yi_hat: fat.intercept + fat.slope * se, se }));
    svg.append("path")
      .datum(lineData)
      .attr("fill", "none")
      .attr("stroke", petColor)
      .attr("stroke-width", usePeese ? 1.5 : 2)
      .attr("stroke-dasharray", usePeese ? "3,3" : "none")
      .attr("opacity", usePeese ? 0.55 : 1)
      .attr("d", d3.line().x(d => x(d.yi_hat)).y(d => y(d.se)));
  }

  // PEESE curve (parabola in se, i.e. linear in vi)
  if (isFinite(peese.intercept) && isFinite(peese.slope)) {
    const curveData = pts.map(se => ({ yi_hat: peese.intercept + peese.slope * se * se, se }));
    svg.append("path")
      .datum(curveData)
      .attr("fill", "none")
      .attr("stroke", peeseColor)
      .attr("stroke-width", usePeese ? 2 : 1.5)
      .attr("stroke-dasharray", usePeese ? "none" : "3,3")
      .attr("opacity", usePeese ? 1 : 0.55)
      .attr("d", d3.line().x(d => x(d.yi_hat)).y(d => y(d.se)));
  }
}

function funnelDrawAxesAndLabels(svg, x, y, margin, W, H, iW, iH, profile, borderClr, fgColor) {
  const axisX = svg.append("g")
    .attr("transform", `translate(0,${H - margin.bottom})`)
    .call(d3.axisBottom(x).tickFormat(v => {
      const t = profile.transform(v);
      return isFinite(t) ? +t.toFixed(3) : "";
    }));
  styleAxis(axisX, borderClr, fgColor);
  const axisY = svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));
  styleAxis(axisY, borderClr, fgColor);
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

function funnelDrawLegend(svg, W, margin, BANDS, isDark) {
  const LW  = 120, LH  = 76;
  const PAD = 6,   ROW = 16, SW = 10;
  const legendX = W - margin.right - LW - 8;
  const legendY = margin.top + 8;
  const lg = svg.append("g").attr("transform", `translate(${legendX},${legendY})`);
  const legendBg     = isDark ? "#1e1e1e" : "#ffffff";
  const legendBorder = isDark ? "#444444" : "#cccccc";
  const legendFg     = isDark ? "#cccccc" : "#333333";
  const innermostFill = BANDS[BANDS.length - 1].fill;
  lg.append("rect")
    .attr("width", LW).attr("height", LH)
    .attr("fill", legendBg)
    .attr("stroke", legendBorder)
    .attr("stroke-width", 1)
    .attr("rx", 2);
  BANDS.forEach(({ fill, label }, i) => {
    const rowY      = PAD + i * ROW;
    const needBorder = fill === innermostFill;
    lg.append("rect")
      .attr("x", PAD).attr("y", rowY + (ROW - SW) / 2)
      .attr("width", SW).attr("height", SW)
      .attr("fill", fill)
      .attr("stroke", needBorder ? legendBorder : "none")
      .attr("stroke-width", 1);
    lg.append("text")
      .attr("x", PAD + SW + 5)
      .attr("y", rowY + ROW / 2 + 3)
      .attr("fill", legendFg)
      .style("font-size", "9px")
      .text(label);
  });
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
export function drawFunnel(studies, m, profile, options = {}) {
  const egger = options.egger ?? null;
  profile = profile || { transform: x => x };
  const svg = clearAndSelectSVG("#funnelPlot");

  if (!studies || studies.length === 0) return;

  // ---- Layout ----
  const margin = { top: 20, right: 20, bottom: 52, left: 60 };
  const W = 500, H = 400;
  const iW = W - margin.left - margin.right;   // 420
  const iH = H - margin.top  - margin.bottom;  // 328
  setSvgSize(svg, W, H);

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

  if (contours) funnelDrawContours(svg, bgColor, BANDS, bandPath, W, H);
  funnelDrawFunnelArms(svg, x, y, seMax, xHalf, borderClr, m, contours, isDark);
  funnelDrawStudies(svg, studies, x, y, dotFill, dotStroke, dotFillImp, dotStrImp);
  funnelDrawEggerLine(svg, egger, studies, x, y, contours, isDark);
  if (options.petpeese) funnelDrawPeeseLines(svg, options.petpeese, studies, x, y, contours, isDark);
  funnelDrawAxesAndLabels(svg, x, y, margin, W, H, iW, iH, profile, borderClr, fgColor);
  if (contours) funnelDrawLegend(svg, W, margin, BANDS, isDark);
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
  const svg = clearAndSelectSVG("#influencePlot");

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
  attachTooltip(
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
      .attr("opacity", 0.85),
    d => `${d.label}<br>Hat: ${d.hat.toFixed(4)}<br>Cook's D: ${d.cookD.toFixed(4)}`
  );

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
export function drawCumulativeForest(cumulativeResults, profile, options = {}) {
  const svg = clearAndSelectSVG("#cumulativePlot");

  if (!cumulativeResults || cumulativeResults.length === 0) return;

  const rowH   = 22;
  const margin = { top: 40, right: 90, bottom: 46, left: 200 };
  const plotW  = 580;
  const totalW = margin.left + plotW + margin.right;

  // Back-transform all results to the display scale before paginating so the
  // page slice works directly with display-scale values.
  const rows = cumulativeResults.map(r => {
    const re_disp = profile.transform(r.RE);
    const ci      = { lb: profile.transform(r.ciLow), ub: profile.transform(r.ciHigh) };
    return { ...r, re_disp, lo_disp: ci.lb, hi_disp: ci.ub };
  });

  // ---- Pagination ----
  const { page, pageSize, totalPages, items: pageRows } = paginate(rows, options);
  const pk = pageRows.length;
  const k  = rows.length;

  const totalH = margin.top + pk * rowH + margin.bottom;

  setSvgSize(svg, totalW, totalH);

  // X scale across all display-scale CI bounds (all rows, not just this page)
  const allX = rows.flatMap(r => [r.lo_disp, r.re_disp, r.hi_disp]).filter(isFinite);
  const [xMin, xMax] = d3.extent(allX);
  const xPad  = Math.max((xMax - xMin) * 0.05, 1e-6);
  const xScale = d3.scaleLinear()
    .domain([xMin - xPad, xMax + xPad])
    .nice()
    .range([0, plotW]);

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Title
  const pageNote = totalPages > 1 ? ` (page ${page + 1} of ${totalPages})` : "";
  svg.append("text")
    .attr("x", margin.left + plotW / 2).attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "12px")
    .text(`Cumulative meta-analysis${pageNote}`);

  // Null reference line (at the back-transformed 0 — e.g. 0 for MD, 1 for OR/RR)
  const nullDisp = profile.transform(0);
  if (isFinite(nullDisp)) {
    g.append("line")
      .attr("x1", xScale(nullDisp)).attr("x2", xScale(nullDisp))
      .attr("y1", 0).attr("y2", pk * rowH)
      .attr("stroke", "var(--border-hover)").attr("stroke-dasharray", "4,3").attr("opacity", 0.6);
  }

  // One row per cumulative step (current page only)
  pageRows.forEach((r, i) => {
    const cy          = (i + 0.5) * rowH;
    const globalIdx   = page * pageSize + i;
    const isLast      = globalIdx === k - 1;
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
    attachTooltip(
      g.append("rect")
        .attr("x", hitX1 - 4).attr("y", cy - rowH / 2)
        .attr("width", Math.max(hitX2 - hitX1 + 8, 20)).attr("height", rowH)
        .attr("fill", "transparent"),
      () => `<b>After: ${r.addedLabel}</b> (k = ${r.k})<br>` +
            `RE = ${isFinite(r.re_disp)  ? r.re_disp.toFixed(3)  : "NA"}&nbsp; ` +
            `${options.ciLabel ?? "95% CI"} [${isFinite(r.lo_disp) ? r.lo_disp.toFixed(3) : "NA"}, ` +
                `${isFinite(r.hi_disp) ? r.hi_disp.toFixed(3) : "NA"}]<br>` +
            `τ² = ${isFinite(r.tau2) ? r.tau2.toFixed(3) : "NA"}&nbsp; ` +
            `I² = ${isFinite(r.I2)   ? r.I2.toFixed(1)   : "NA"}%`
    );
  });

  // X axis
  const axisG = g.append("g")
    .attr("transform", `translate(0,${pk * rowH + 6})`)
    .call(d3.axisBottom(xScale).ticks(5));
  styleAxis(axisG, "var(--border-hover)", "var(--fg-muted)");

  // X axis label
  svg.append("text")
    .attr("x", margin.left + plotW / 2).attr("y", totalH - 6)
    .attr("text-anchor", "middle")
    .style("font-size", "11px").attr("fill", "var(--fg-muted)")
    .text(profile.label);

  return { totalPages };
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
  const svg = clearAndSelectSVG("#cumulativeFunnelPlot");

  if (!cumulativeStudies || cumulativeStudies.length === 0 || !cumResults) return;

  const k     = cumulativeStudies.length;
  const step  = Math.max(0, Math.min(stepIdx, k - 1));
  const cur   = cumResults[step];

  // ---- Layout — identical to drawFunnel ----
  const margin = { top: 30, right: 20, bottom: 52, left: 60 };
  const W = 500, H = 420;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;
  setSvgSize(svg, W, H);

  const tooltip = selTooltip();

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
  styleAxis(axisX, borderClr, fgColor);

  const axisY = svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));
  styleAxis(axisY, borderClr, fgColor);

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
  const svg = clearAndSelectSVG("#pCurvePlot");

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
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "11px");

  const axisY = g.append("g")
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickFormat(d => `${Math.round(d * 100)}%`)
    );
  styleAxis(axisY, "var(--border-hover)", "var(--fg-muted)");

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
  const svg = clearAndSelectSVG("#pUniformPlot");

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
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

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
  const svg = clearAndSelectSVG("#orchardPlot");

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

  const tooltip = selTooltip();

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
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  // ---- X axis label ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text(profile.label + (profile.isLog ? " (log scale)" : ""));

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
export function drawCaterpillarPlot(studies, m, profile, options = {}) {
  const svg = clearAndSelectSVG("#caterpillarPlot");

  if (!studies || studies.length === 0) return;

  profile = profile || { transform: x => x, label: "Effect" };

  // ---- Sorted study list (descending yi so largest effect is at top) ----
  const sorted = studies
    .filter(s => isFinite(s.yi) && isFinite(s.vi))
    .slice()
    .sort((a, b) => b.yi - a.yi);

  const k = sorted.length;
  if (k === 0) return;

  // ---- Pagination ----
  const { page, pageSize, totalPages, items: pageStudies } = paginate(sorted, options);
  const pk = pageStudies.length;

  const ROW_H   = 16;
  const W       = +svg.attr("width") || 520;
  // Dynamic left margin fitted to the longest study label (≈6.5px per char at 10px font)
  const maxStudyLen = sorted.reduce((m, s) => Math.max(m, (s.label || "").length), 0);
  const leftMargin  = Math.max(50, Math.min(160, Math.ceil(maxStudyLen * 6.5) + 14));
  const margin  = { top: 28, right: 20, bottom: 38, left: leftMargin };

  // Height fitted to the studies on this page (no cap needed with pagination)
  const H = margin.top + pk * ROW_H + margin.bottom;
  svg.attr("height", H);

  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- Group colour palette ----
  const allGroups = [...new Set(sorted.map(s => s.group || "").filter(Boolean))];
  const hasGroups = allGroups.length > 1;
  const groupColor = grp => {
    const idx = allGroups.indexOf(grp);
    return idx >= 0 ? GROUP_COLORS[idx % GROUP_COLORS.length] : "var(--fg-subtle)";
  };

  // ---- X scale — domain from ALL sorted studies for stability across pages ----
  // Individual study CI: yi ± Z_95 * se  (always normal, per forest plot convention)
  const allCiLows  = sorted.map(s => s.yi - Z_95 * (s.se || Math.sqrt(s.vi)));
  const allCiHighs = sorted.map(s => s.yi + Z_95 * (s.se || Math.sqrt(s.vi)));
  const refs    = [...allCiLows, ...allCiHighs, m.RE, 0].filter(isFinite);
  const xExtent = Math.max(...refs.map(Math.abs)) * 1.08 || 1;
  const x = d3.scaleLinear().domain([-xExtent, xExtent]).range([0, iW]);

  const tooltip = selTooltip();

  // ---- Null reference line (dashed) ----
  g.append("line")
    .attr("x1", x(0)).attr("x2", x(0))
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--border-hover)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3");

  // ---- RE line (solid, muted) ----
  if (isFinite(m.RE)) {
    g.append("line")
      .attr("x1", x(m.RE)).attr("x2", x(m.RE))
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--accent)")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.55);
  }

  // ---- Study rows (current page only) ----
  pageStudies.forEach((s, i) => {
    const cy    = i * ROW_H + ROW_H / 2;
    const lo    = s.yi - Z_95 * (s.se || Math.sqrt(s.vi));
    const hi    = s.yi + Z_95 * (s.se || Math.sqrt(s.vi));
    const color = hasGroups ? groupColor(s.group || "") : "var(--fg-subtle)";

    // CI line
    g.append("line")
      .attr("x1", x(lo)).attr("x2", x(hi))
      .attr("y1", cy).attr("y2", cy)
      .attr("stroke", color)
      .attr("stroke-width", s.filled ? 1 : 1.4)
      .attr("stroke-opacity", s.filled ? 0.45 : 0.80);

    // CI end ticks
    [lo, hi].forEach(v => {
      g.append("line")
        .attr("x1", x(v)).attr("x2", x(v))
        .attr("y1", cy - 3).attr("y2", cy + 3)
        .attr("stroke", color)
        .attr("stroke-width", s.filled ? 1 : 1.4)
        .attr("stroke-opacity", s.filled ? 0.45 : 0.80);
    });

    // Point estimate circle
    g.append("circle")
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
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  // ---- X axis label ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 4)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text(profile.label + (profile.isLog ? " (log scale)" : ""));

  // ---- Heterogeneity + k annotation (top margin, clear of study rows) ----
  const pageNote = totalPages > 1 ? `  ·  page ${page + 1} of ${totalPages}` : "";
  const hetParts = [`k = ${k}${pageNote}`];
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

  return { totalPages };
}

// ================= BLUP PLOT =================
// Dual caterpillar: each row shows observed yi (gray) and BLUP (accent)
// connected by a dashed shrinkage line. Vertical dashed null line; solid
// accent line at pooled μ̂_RE. Paginated; SVG height is dynamic.
// result  — blupMeta() return value
// profile — effect profile (transform, label, isTransformedScale)
// options — { page, pageSize }
// Returns { totalPages }.
export function drawBlupPlot(result, profile, options = {}) {
  const svg = clearAndSelectSVG("#blupPlot");
  if (!result || !result.studies || result.studies.length === 0) return { totalPages: 1 };

  profile = profile || { transform: x => x, label: "Effect" };

  // Sort by observed yi descending
  const sorted = result.studies.slice().sort((a, b) => b.yi - a.yi);

  const { page, pageSize, totalPages, items: pageStudies } = paginate(sorted, options);
  const pk = pageStudies.length;

  const ROW_H = 18;
  const W = +svg.attr("width") || 560;

  const maxLabelLen = sorted.reduce((mx, s) => Math.max(mx, (s.label || "").length), 0);
  const leftMargin  = Math.max(60, Math.min(180, Math.ceil(maxLabelLen * 6.5) + 14));
  const margin = { top: 30, right: 24, bottom: 46, left: leftMargin };

  const H = margin.top + pk * ROW_H + margin.bottom;
  svg.attr("height", H);

  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // X scale — covers observed CIs and BLUP CIs for all studies
  const allVals = sorted.flatMap(s => [
    s.yi - Z_95 * s.se_obs,
    s.yi + Z_95 * s.se_obs,
    s.ci_lb,
    s.ci_ub,
    result.mu,
    0,
  ]).filter(isFinite);
  const xExt = Math.max(...allVals.map(Math.abs)) * 1.1 || 1;
  const x = d3.scaleLinear().domain([-xExt, xExt]).range([0, iW]);

  const tooltip = selTooltip();

  // Null reference line
  g.append("line")
    .attr("x1", x(0)).attr("x2", x(0))
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--border-hover)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3");

  // Pooled RE line
  if (isFinite(result.mu)) {
    g.append("line")
      .attr("x1", x(result.mu)).attr("x2", x(result.mu))
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--accent)")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.55);
  }

  // Study rows
  pageStudies.forEach((s, i) => {
    const cy = i * ROW_H + ROW_H / 2;

    // Observed CI (gray)
    const obsLow  = s.yi - Z_95 * s.se_obs;
    const obsHigh = s.yi + Z_95 * s.se_obs;
    if (isFinite(obsLow) && isFinite(obsHigh)) {
      g.append("line")
        .attr("x1", x(obsLow)).attr("x2", x(obsHigh))
        .attr("y1", cy).attr("y2", cy)
        .attr("stroke", "var(--fg-subtle)")
        .attr("stroke-width", 1.5)
        .attr("opacity", 0.55);
      g.append("circle")
        .attr("cx", x(s.yi)).attr("cy", cy).attr("r", 3)
        .attr("fill", "var(--fg-subtle)").attr("opacity", 0.7);
    }

    // Shrinkage connector (dashed, muted)
    if (isFinite(s.blup) && isFinite(s.yi)) {
      g.append("line")
        .attr("x1", x(s.yi)).attr("x2", x(s.blup))
        .attr("y1", cy).attr("y2", cy)
        .attr("stroke", "var(--fg-muted)")
        .attr("stroke-width", 0.8)
        .attr("stroke-dasharray", "2,2")
        .attr("opacity", 0.5);
    }

    // BLUP CI (accent)
    if (isFinite(s.ci_lb) && isFinite(s.ci_ub)) {
      g.append("line")
        .attr("x1", x(s.ci_lb)).attr("x2", x(s.ci_ub))
        .attr("y1", cy).attr("y2", cy)
        .attr("stroke", "var(--accent)").attr("stroke-width", 2);
      // End-tick caps
      [s.ci_lb, s.ci_ub].forEach(v => {
        g.append("line")
          .attr("x1", x(v)).attr("x2", x(v))
          .attr("y1", cy - 3).attr("y2", cy + 3)
          .attr("stroke", "var(--accent)").attr("stroke-width", 1.5);
      });
    }

    // BLUP point (with tooltip)
    if (isFinite(s.blup)) {
      const effDisplay = profile.transform(s.blup);
      const obsDisplay = profile.transform(s.yi);
      g.append("circle")
        .attr("cx", x(s.blup)).attr("cy", cy).attr("r", 4)
        .attr("fill", "var(--accent)")
        .attr("stroke", "var(--bg-surface)").attr("stroke-width", 1)
        .on("mousemove", (event) => {
          tooltip.style("opacity", 1)
            .html(
              `<b>${s.label}</b>` +
              `<br>Observed: ${isFinite(obsDisplay) ? (+obsDisplay.toFixed(3)) : "NA"}` +
              `<br>BLUP: ${isFinite(effDisplay) ? (+effDisplay.toFixed(3)) : "NA"}` +
              `<br>Random effect (û): ${(+s.ranef.toFixed(4))}` +
              `<br>Shrinkage (λ): ${(+(s.lambda * 100).toFixed(1))}%`
            )
            .style("left", (event.pageX + 12) + "px")
            .style("top",  (event.pageY - 24) + "px");
        })
        .on("mouseout", () => tooltip.style("opacity", 0));
    }

    // Study label
    g.append("text")
      .attr("x", -6).attr("y", cy + 4)
      .attr("text-anchor", "end")
      .attr("fill", "var(--fg-muted)").style("font-size", "10px")
      .text((s.label || "").length > 18 ? (s.label || "").slice(0, 17) + "…" : (s.label || ""));
  });

  // X axis
  const isTransformed = profile.isTransformedScale;
  const xAxisG = g.append("g").attr("transform", `translate(0,${iH})`);
  if (isTransformed) {
    const ticks = x.ticks(6).filter(v => isFinite(profile.transform(v)));
    xAxisG.call(
      d3.axisBottom(x)
        .tickValues(ticks)
        .tickFormat(v => { const t = profile.transform(v); return isFinite(t) ? (+t.toFixed(2)).toString() : ""; })
    );
  } else {
    xAxisG.call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(".3~g")));
  }
  styleAxis(xAxisG, "var(--border-hover)", "var(--fg-muted)", "10px");

  // Axis label
  const xLabel = isTransformed
    ? `${profile.label || "Effect"} (log scale)`
    : (profile.label || "Effect size");
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", H - 4)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "11px")
    .text(xLabel);

  // Title annotation
  const tau2Str = isFinite(result.tau2) && result.tau2 > 0
    ? `τ² = ${result.tau2.toFixed(4)}`
    : "τ² = 0";
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 16)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "10px")
    .text(`BLUPs  k = ${result.k}   ${tau2Str}`);

  // Legend
  const legY = H - 28;
  const legX = margin.left + 4;
  svg.append("line").attr("x1", legX).attr("x2", legX + 16).attr("y1", legY + 5).attr("y2", legY + 5)
    .attr("stroke", "var(--fg-subtle)").attr("stroke-width", 1.5).attr("opacity", 0.7);
  svg.append("circle").attr("cx", legX + 8).attr("cy", legY + 5).attr("r", 3)
    .attr("fill", "var(--fg-subtle)").attr("opacity", 0.7);
  svg.append("text").attr("x", legX + 20).attr("y", legY + 9)
    .attr("fill", "var(--fg-muted)").style("font-size", "10px").text("Observed");

  svg.append("line").attr("x1", legX + 82).attr("x2", legX + 98).attr("y1", legY + 5).attr("y2", legY + 5)
    .attr("stroke", "var(--accent)").attr("stroke-width", 2);
  svg.append("circle").attr("cx", legX + 90).attr("cy", legY + 5).attr("r", 4)
    .attr("fill", "var(--accent)").attr("stroke", "var(--bg-surface)").attr("stroke-width", 1);
  svg.append("text").attr("x", legX + 102).attr("y", legY + 9)
    .attr("fill", "var(--fg-muted)").style("font-size", "10px").text("BLUP (shrunken)");

  return { totalPages };
}

// ================= BAUJAT PLOT =================
// Diagnostic scatter plot: x = each study's contribution to Cochran's Q,
// y = each study's influence on the FE pooled estimate.
// Dashed quadrant guides are drawn at the mean x and mean y across studies.
// Studies in the top-right quadrant are both highly heterogeneous AND highly
// influential — the primary targets for sensitivity investigation.
// Reference: Baujat et al. (2002) Statistics in Medicine 21:2442–2456.
export function drawBaujatPlot(result, profile) {
  const svg = clearAndSelectSVG("#baujatPlot");

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
  const tooltip = selTooltip();
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
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  const axisY = g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".3~g")));
  styleAxis(axisY, "var(--border-hover)", "var(--fg-muted)", "10px");

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

// ── drawLabbe ────────────────────────────────────────────────────────────────
// L'Abbé plot for binary outcomes (OR, RR, RD).
// X axis: control event rate   c/(c+d)
// Y axis: treatment event rate a/(a+b)
// Bubble radius ∝ √N.  Reference diagonal y = x (no effect).
// Pooled-estimate curve drawn for the RE estimate:
//   OR  →  y = (OR·x) / (1 − x + OR·x)
//   RR  →  y = RR·x   (capped at 1)
//   RD  →  y = x + RD (capped at [0,1])
// studies  — array of study objects with raw a, b, c, d and yi/vi
// m        — meta() result (for pooled RE estimate)
// profile  — effect profile (for transform())
// type     — "OR" | "RR" | "RD"
export function drawLabbe(studies, m, profile, options = {}) {
  const type = options.type ?? "OR";
  const svg = clearAndSelectSVG("#labbePlot");
  if (!studies || studies.length === 0) return;

  // Only meaningful for studies with a/b/c/d cell counts.
  const pts = studies
    .filter(s => isFinite(s.a) && isFinite(s.b) && isFinite(s.c) && isFinite(s.d)
                 && (s.a + s.b) > 0 && (s.c + s.d) > 0)
    .map(s => ({
      label: s.label,
      group: s.group || "",
      px: s.c / (s.c + s.d),            // control rate
      py: s.a / (s.a + s.b),            // treatment rate
      N:  s.a + s.b + s.c + s.d,
      yi: s.yi,
      vi: s.vi,
    }));

  if (pts.length === 0) return;

  const W = +svg.attr("width")  || 500;
  const H = +svg.attr("height") || 420;
  const margin = { top: 30, right: 24, bottom: 60, left: 64 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, 1]).range([0, iW]);
  const y = d3.scaleLinear().domain([0, 1]).range([iH, 0]);

  // Bubble radius proportional to √N, scaled so the largest bubble ≈ 14 px.
  const maxN    = Math.max(...pts.map(p => p.N));
  const rScale  = d3.scaleSqrt().domain([0, maxN]).range([0, 14]);

  // ---- Reference diagonal: y = x (no treatment effect) ----
  g.append("line")
    .attr("x1", x(0)).attr("y1", y(0))
    .attr("x2", x(1)).attr("y2", y(1))
    .attr("stroke", "var(--fg-muted)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3");

  // ---- Pooled-estimate curve ----
  const reMu = m && isFinite(m.RE) ? m.RE : null;
  if (reMu !== null && profile) {
    const reDisplay = profile.transform(reMu);
    const nCurve = 120;
    const curveData = [];

    if (type === "OR" && isFinite(reDisplay) && reDisplay > 0) {
      const OR = reDisplay;
      for (let i = 0; i <= nCurve; i++) {
        const cx = i / nCurve;
        const cy = (OR * cx) / (1 - cx + OR * cx);
        if (isFinite(cy) && cy >= 0 && cy <= 1) curveData.push([cx, cy]);
      }
    } else if (type === "RR" && isFinite(reDisplay) && reDisplay > 0) {
      const RR = reDisplay;
      for (let i = 0; i <= nCurve; i++) {
        const cx = i / nCurve;
        const cy = Math.min(RR * cx, 1);
        curveData.push([cx, cy]);
      }
    } else if (type === "RD") {
      const RD = reMu; // RD is already on display scale (no transform)
      for (let i = 0; i <= nCurve; i++) {
        const cx = i / nCurve;
        const cy = Math.max(0, Math.min(1, cx + RD));
        curveData.push([cx, cy]);
      }
    }

    if (curveData.length > 1) {
      const line = d3.line()
        .x(d => x(d[0]))
        .y(d => y(d[1]));
      g.append("path")
        .datum(curveData)
        .attr("d", line)
        .attr("fill", "none")
        .attr("stroke", "var(--accent)")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "6,3")
        .attr("opacity", 0.7);
    }
  }

  // ---- Group colours ----
  const allGroups  = [...new Set(pts.map(p => p.group).filter(Boolean))];
  const hasGroups  = allGroups.length > 1;
  const pointColor = p => {
    if (!hasGroups) return "var(--accent)";
    const idx = allGroups.indexOf(p.group);
    return idx >= 0 ? GROUP_COLORS[idx % GROUP_COLORS.length] : "var(--fg-subtle)";
  };

  // ---- Bubbles ----
  const tooltip   = selTooltip();
  const showLabels = pts.length <= 20;

  pts.forEach(p => {
    const cx = x(p.px);
    const cy = y(p.py);
    const r  = Math.max(rScale(p.N), 3);
    const color = pointColor(p);

    g.append("circle")
      .attr("cx", cx).attr("cy", cy)
      .attr("r", r)
      .attr("fill", color)
      .attr("fill-opacity", 0.65)
      .attr("stroke", "var(--bg-surface)")
      .attr("stroke-width", 1)
      .on("mousemove", (event) => {
        const effVal = profile ? profile.transform(p.yi) : p.yi;
        tooltip.style("opacity", 1)
          .html(
            `<b>${p.label}</b>` +
            `<br>Control rate: ${(p.px * 100).toFixed(1)}%` +
            `<br>Treatment rate: ${(p.py * 100).toFixed(1)}%` +
            `<br>N: ${p.N}` +
            (isFinite(effVal) ? `<br>Effect: ${(+effVal.toFixed(3))}` : "")
          )
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY - 24) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0));

    if (showLabels) {
      const abbr = p.label.length > 9 ? p.label.slice(0, 8) + "…" : p.label;
      g.append("text")
        .attr("x", cx + r + 2)
        .attr("y", cy + 4)
        .attr("fill", "var(--fg-muted)")
        .style("font-size", "9px")
        .style("pointer-events", "none")
        .text(abbr);
    }
  });

  // ---- Axes ----
  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  const axisY = g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  styleAxis(axisY, "var(--border-hover)", "var(--fg-muted)", "10px");

  // ---- Axis labels ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 10)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Control event rate");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2))
    .attr("y", 15)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Treatment event rate");

  // ---- Pooled-estimate label ----
  if (reMu !== null && profile) {
    const reDisplay = profile.transform(reMu);
    if (isFinite(reDisplay)) {
      const typeLabel = type === "OR" ? "OR" : type === "RR" ? "RR" : "RD";
      g.append("text")
        .attr("x", iW - 2).attr("y", 12)
        .attr("text-anchor", "end")
        .attr("fill", "var(--accent)")
        .style("font-size", "10px")
        .text(`RE ${typeLabel} = ${(+reDisplay.toFixed(3))}`);
    }
  }

  // ---- Legend (groups) ----
  if (hasGroups) {
    allGroups.forEach((grp, gi) => {
      const color = GROUP_COLORS[gi % GROUP_COLORS.length];
      const lx = iW - 4;
      const ly = gi * 16 + 26;
      g.append("circle")
        .attr("cx", lx - 80).attr("cy", ly + 5)
        .attr("r", 5).attr("fill", color).attr("fill-opacity", 0.65);
      g.append("text")
        .attr("x", lx - 72).attr("y", ly + 9)
        .attr("fill", "var(--fg-muted)")
        .style("font-size", "10px")
        .text(grp.length > 10 ? grp.slice(0, 9) + "…" : grp);
    });
  }

  // ---- Reference annotation ----
  g.append("text")
    .attr("x", x(0.95)).attr("y", y(0.95) - 6)
    .attr("text-anchor", "end")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "9px")
    .text("no effect");
}

// ── drawRoBTrafficLight ──────────────────────────────────────────────────────
// Traffic-light grid: studies (rows) × domains (columns), coloured circles.
// studies  — array of study objects (used for labels)
// domains  — string[]
// robData  — { [studyLabel]: { [domain]: string } }  ("Low"|"Some concerns"|"High"|"NI"|"")
export function drawRoBTrafficLight(studies, domains, robData) {
  const svg = clearAndSelectSVG("#robTrafficLight");
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

  setSvgSize(svg, svgW, svgH);

  const tooltip = selTooltip();

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
  const svg = clearAndSelectSVG("#robSummary");
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

  setSvgSize(svg, svgW, svgH);

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
          selTooltip().style("opacity", 1)
            .html(`<strong>${dom}</strong><br>${rating}: ${counts[rating]} / ${total} (${Math.round(prop * 100)}%)`);
        })
        .on("mousemove", (event) => {
          selTooltip()
            .style("left", (event.pageX + 12) + "px")
            .style("top",  (event.pageY - 28) + "px");
        })
        .on("mouseout", () => selTooltip().style("opacity", 0));

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
// ================= GOSH PLOT =================
// Graphical Display of Study Heterogeneity (Harbord & Higgins, 2008).
// x-axis : I² (0–100 %)
// y-axis : FE pooled estimate on the display scale (profile.transform applied)
// colour : subset size n, Viridis sequential scale (purple=small n, yellow=large n)
//
// Rendering strategy
// ------------------
//   count ≤ SVG_THRESHOLD (5 000) : D3 SVG circles — fully interactive, per-point
//                                   tooltips showing n, I², μ̂.
//   count >  SVG_THRESHOLD        : Raw-pixel ImageData written in O(count) time
//                                   (~50 ms for 1 M subsets), embedded as <image>.
//                                   Alpha compositing gives natural density shading.
//                                   Tooltip shows axis coordinates at the cursor.
//
// Parameters
//   result  — return value of goshCompute() from gosh.js
//   profile — effect-type profile: { transform, label }; defaults to identity
//
// Maximum SVG circle points when rendering for a report (keeps file size small
// and avoids embedding a rasterised PNG inside the exported HTML/SVG).
const GOSH_SVG_REPORT_MAX = 3000;

export function drawGoshPlot(result, profile, options = {}) {
  const svg = clearAndSelectSVG("#goshPlot");
  if (!result || result.error || !result.count) return;

  profile = profile || { transform: x => x, label: "Effect" };

  const { mu: muArr, I2: I2Arr, Q: QArr, n: nArr, count, k, sampled } = result;
  const xAxis     = options.xAxis     || "I2";    // "I2" | "Q" | "n"
  const forReport = options.forReport || false;   // true → SVG circles only (no canvas PNG embed)

  const W = +svg.attr("width")  || 520;
  const H = +svg.attr("height") || 420;
  const margin = { top: 34, right: 88, bottom: 56, left: 62 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- Apply profile transform; find finite range ----
  const muDisplay = new Float64Array(count);
  let muMin = Infinity, muMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const v = profile.transform(muArr[i]);
    muDisplay[i] = isFinite(v) ? v : NaN;
    if (isFinite(v)) {
      if (v < muMin) muMin = v;
      if (v > muMax) muMax = v;
    }
  }
  if (!isFinite(muMin)) return;
  const muPad = (muMax - muMin) * 0.08 || 0.5;

  // ---- Derive x-axis values from selected axis ----
  let xArr, xLabel;
  if (xAxis === "Q") {
    xArr   = QArr;
    xLabel = "Q (Cochran's Q)";
  } else if (xAxis === "n") {
    xArr   = nArr;
    xLabel = "n (subset size)";
  } else {
    xArr   = I2Arr;
    xLabel = "I² (%)";
  }

  // ---- Scales ----
  let xScale;
  if (xAxis === "I2") {
    // Fixed [-2, 102] so I²=0 points aren't clipped
    xScale = d3.scaleLinear().domain([-2, 102]).range([0, iW]);
  } else if (xAxis === "n") {
    xScale = d3.scaleLinear().domain([0.5, k + 0.5]).range([0, iW]);
  } else {
    // Q: auto-range from data
    let qMin = Infinity, qMax = -Infinity;
    for (let i = 0; i < count; i++) {
      if (xArr[i] < qMin) qMin = xArr[i];
      if (xArr[i] > qMax) qMax = xArr[i];
    }
    const qPad = (qMax - qMin) * 0.05 || 1;
    xScale = d3.scaleLinear().domain([qMin - qPad, qMax + qPad]).nice().range([0, iW]);
  }

  const yScale = d3.scaleLinear()
    .domain([muMin - muPad, muMax + muPad])
    .nice()
    .range([iH, 0]);

  // ---- Viridis colour scale: n = 1 (purple) … k (yellow) ----
  const colorScale = d3.scaleSequential(d3.interpolateViridis).domain([1, k]);

  // ---- Render points ----
  const SVG_THRESHOLD = 5000;
  // For reports: always SVG circles (no canvas PNG embed); stride-subsample if needed.
  const useCanvas = count > SVG_THRESHOLD && !forReport;

  if (useCanvas) {
    // ======================== CANVAS PATH ========================
    // Pre-compute n → [r, g, b] colour lookup (at most k ≤ 30 entries).
    const nColor = new Array(k + 1);
    for (let ni = 1; ni <= k; ni++) {
      const c = d3.color(colorScale(ni));
      nColor[ni] = [c.r, c.g, c.b];
    }

    // Adaptive per-point alpha: more points → lower alpha so overlapping
    // points reveal density rather than saturating to solid fill.
    const alphaInt = Math.max(12, Math.min(220, Math.round(4000 / Math.sqrt(count))));

    // Write pixels directly into ImageData — O(count), no per-call fillRect overhead.
    const canvas = document.createElement("canvas");
    canvas.width  = iW;
    canvas.height = iH;
    const ctx     = canvas.getContext("2d");
    const imgData = ctx.createImageData(iW, iH);
    const pb      = imgData.data;  // Uint8ClampedArray, zeroed (transparent)

    for (let i = 0; i < count; i++) {
      const cx = xScale(xArr[i])      | 0;
      const cy = yScale(muDisplay[i]) | 0;
      if (cx < 0 || cx >= iW || cy < 0 || cy >= iH || !isFinite(muDisplay[i])) continue;
      const off    = (cy * iW + cx) << 2;
      const [rc, gc, bc] = nColor[nArr[i]];
      const ia     = 255 - alphaInt;
      pb[off]     = ((pb[off]     * ia) >> 8) + ((rc * alphaInt) >> 8);
      pb[off + 1] = ((pb[off + 1] * ia) >> 8) + ((gc * alphaInt) >> 8);
      pb[off + 2] = ((pb[off + 2] * ia) >> 8) + ((bc * alphaInt) >> 8);
      pb[off + 3] = Math.min(255, pb[off + 3] + alphaInt);
    }
    ctx.putImageData(imgData, 0, 0);

    // Embed the rasterised cloud as an SVG <image>.
    const goshImg = g.append("image")
      .attr("x", 0).attr("y", 0)
      .attr("width", iW).attr("height", iH)
      .attr("href", canvas.toDataURL("image/png"))
      .attr("preserveAspectRatio", "none")
      .attr("role", "img")
      .attr("aria-label", `GOSH plot point cloud: ${count} subsets of ${k} studies`);
    goshImg.append("title").text(`GOSH plot point cloud: ${count} subsets of ${k} studies`);

    // Transparent overlay for coordinate-readout tooltip.
    const tt = selTooltip();
    g.append("rect")
      .attr("x", 0).attr("y", 0)
      .attr("width", iW).attr("height", iH)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .on("mousemove", (event) => {
        const [mx, my] = d3.pointer(event);
        const xval  = xScale.invert(mx);
        const muval = yScale.invert(my);
        const xStr  = xAxis === "I2"
          ? `I² = ${xval.toFixed(1)} %`
          : xAxis === "n"
            ? `n = ${Math.round(xval)}`
            : `Q = ${xval.toFixed(2)}`;
        tt.style("opacity", 1)
          .html(`${xStr}<br>${profile.label}: ${(+muval.toFixed(3))}`)
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY - 24) + "px");
      })
      .on("mouseout", () => tt.style("opacity", 0));

  } else {
    // ======================== SVG PATH ========================
    // Build index array; subsample for report renders to keep SVG file size small.
    let indices;
    if (forReport && count > GOSH_SVG_REPORT_MAX) {
      const stride = Math.ceil(count / GOSH_SVG_REPORT_MAX);
      indices = [];
      for (let i = 0; i < count; i += stride) indices.push(i);
    } else {
      indices = Array.from({ length: count }, (_, i) => i);
    }

    attachTooltip(
      g.selectAll("circle")
        .data(indices)
        .enter().append("circle")
        .attr("cx", i => xScale(xArr[i]))
        .attr("cy", i => yScale(muDisplay[i]))
        .attr("r", count <= 500 ? 4 : 3)
        .attr("fill", i => colorScale(nArr[i]))
        .attr("fill-opacity", 0.72)
        .attr("stroke", "none"),
      i => {
        const xStr = xAxis === "I2"
          ? `I² = ${I2Arr[i].toFixed(1)} %`
          : xAxis === "n"
            ? `n = ${nArr[i]}`
            : `Q = ${QArr[i].toFixed(2)}`;
        return `n = ${nArr[i]}<br>${xStr}<br>${profile.label}: ${(+muDisplay[i].toFixed(3))}`;
      }
    );
  }

  // ---- Axes ----
  let xAxisGen;
  if (xAxis === "I2") {
    xAxisGen = d3.axisBottom(xScale).tickValues([0, 25, 50, 75, 100]).tickFormat(d => d + "%");
  } else if (xAxis === "n") {
    xAxisGen = d3.axisBottom(xScale).ticks(Math.min(k, 10)).tickFormat(d3.format("d"));
  } else {
    xAxisGen = d3.axisBottom(xScale).ticks(5).tickFormat(d3.format(".3~g"));
  }
  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(xAxisGen);
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  const axisY = g.append("g")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".3~g")));
  styleAxis(axisY, "var(--border-hover)", "var(--fg-muted)", "10px");

  // ---- Axis labels ----
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", H - 8)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "11px")
    .text(xLabel);

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2)).attr("y", 14)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "11px")
    .text(profile.label);

  // ---- Title ----
  const subsetNote = sampled
    ? `${count.toLocaleString()} sampled of 2^${k}−1`
    : `all 2^${k}−1 = ${count.toLocaleString()}`;
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 18)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)").style("font-size", "12px")
    .text(`GOSH — k = ${k}  (${subsetNote} subsets)`);

  // ---- Colour legend: vertical Viridis bar for n ----
  const legH  = Math.min(iH * 0.65, 110);
  const legW  = 11;
  const legX  = iW + 20;
  const legY  = (iH - legH) / 2;

  const gradId = "gosh-n-grad";
  const defs   = svg.append("defs");
  const grad   = defs.append("linearGradient")
    .attr("id", gradId)
    .attr("x1", "0%").attr("y1", "100%")   // bottom = n=1 (purple)
    .attr("x2", "0%").attr("y2", "0%");    // top    = n=k (yellow)

  const stops = Math.min(k - 1, 8);
  for (let s = 0; s <= stops; s++) {
    const t = stops > 0 ? s / stops : 0;
    grad.append("stop")
      .attr("offset", (t * 100).toFixed(1) + "%")
      .attr("stop-color", colorScale(1 + t * (k - 1)));
  }

  const lg = g.append("g").attr("transform", `translate(${legX},${legY})`);

  lg.append("rect")
    .attr("width", legW).attr("height", legH)
    .attr("fill", `url(#${gradId})`)
    .attr("stroke", "var(--border-hover)").attr("stroke-width", 0.5);

  // Tick marks and labels: k (top), midpoint, 1 (bottom)
  [
    { y: 0,      label: k },
    { y: legH/2, label: Math.round((k + 1) / 2) },
    { y: legH,   label: 1 },
  ].forEach(({ y, label }) => {
    lg.append("line")
      .attr("x1", legW).attr("x2", legW + 3).attr("y1", y).attr("y2", y)
      .attr("stroke", "var(--fg-muted)").attr("stroke-width", 0.8);
    lg.append("text")
      .attr("x", legW + 5).attr("y", y)
      .attr("dominant-baseline", "middle").attr("fill", "var(--fg-muted)").style("font-size", "9px")
      .text(label);
  });

  // Rotated legend title
  svg.append("text")
    .attr("transform",
      `rotate(-90) translate(${-(margin.top + legY + legH / 2)},${margin.left + legX + legW + 30})`)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)").style("font-size", "9px")
    .text("n (subset size)");
}

// =============================================================================
// drawProfileLikTau2(result, options)
// =============================================================================
// Draws the profile log-likelihood curve for τ² produced by profileLikTau2().
//
// options.xScale: "tau2" (default) — x-axis shows τ²
//                 "tau"            — x-axis shows τ = √τ²
//
// SVG target: #profileLikTau2Plot (500 × 380 px by default).
// Elements (back-to-front):
//   CI shaded band → threshold line → τ²_hat line → CI bound lines →
//   profile curve → peak dot → axes → labels → title.
// =============================================================================
export function drawProfileLikTau2(result, options = {}) {
  const svg = clearAndSelectSVG("#profileLikTau2Plot");
  if (!result || result.error) return;

  const xScale = options.xScale || "tau2";
  const { grid, ll, tau2hat, lCritRel, ciLow, ciHigh, method, k } = result;

  const margin = { top: 34, right: 24, bottom: 56, left: 66 };
  const W  = +svg.attr("width")  || 500;
  const H  = +svg.attr("height") || 380;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  // ---- Clip path so the curve doesn't bleed into margins ----
  const clipId = "profileLikClip";
  svg.append("defs").append("clipPath").attr("id", clipId)
    .append("rect").attr("width", iW).attr("height", iH);

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- Transforms between τ²-space and display-space ----
  const toX = xScale === "tau" ? (t2 => Math.sqrt(t2)) : (t2 => t2);
  const gridMax = grid[grid.length - 1];
  const xDomainMax = toX(gridMax);

  // ---- Scales ----
  const x = d3.scaleLinear().domain([0, xDomainMax]).range([0, iW]);

  const llMin = d3.min(ll);
  const y = d3.scaleLinear()
    .domain([Math.min(llMin - 0.5, lCritRel - 0.5), 0.3])
    .range([iH, 0]);

  // ---- Gridlines ----
  g.append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-iW).tickFormat(""))
    .selectAll("line")
    .attr("stroke", "var(--border)")
    .attr("stroke-dasharray", "2,3");
  g.select(".grid .domain").remove();

  // ---- 1. CI shaded band ----
  const bandX1 = x(toX(ciLow));
  const bandX2 = x(toX(ciHigh));
  g.append("rect")
    .attr("x", bandX1).attr("y", 0)
    .attr("width",  Math.max(0, bandX2 - bandX1))
    .attr("height", iH)
    .attr("fill", "var(--accent)")
    .attr("fill-opacity", 0.10);

  // ---- 2. Horizontal threshold line (dashed) ----
  const yCrit = y(lCritRel);
  g.append("line")
    .attr("x1", 0).attr("x2", iW)
    .attr("y1", yCrit).attr("y2", yCrit)
    .attr("stroke", "var(--fg-subtle)")
    .attr("stroke-width", 1.2)
    .attr("stroke-dasharray", "5,3");
  g.append("text")
    .attr("x", iW - 2).attr("y", yCrit - 4)
    .attr("text-anchor", "end")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "9px")
    .text("95% CI cutoff");

  // ---- 3. Vertical τ²_hat line ----
  const xHat = x(toX(tau2hat));
  g.append("line")
    .attr("x1", xHat).attr("x2", xHat)
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--accent)")
    .attr("stroke-width", 1.2);
  g.append("text")
    .attr("x", xHat).attr("y", -6)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--accent)")
    .style("font-size", "9px")
    .text(xScale === "tau"
      ? `τ̂ = ${Math.sqrt(tau2hat).toPrecision(3)}`
      : `τ̂² = ${tau2hat.toPrecision(3)}`);

  // ---- 4. CI bound lines (dashed) ----
  function drawCIBound(tau2val, label) {
    const xb = x(toX(tau2val));
    g.append("line")
      .attr("x1", xb).attr("x2", xb)
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--fg-subtle)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,3");
    g.append("text")
      .attr("x", xb).attr("y", iH + 30)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--fg-muted)")
      .style("font-size", "8.5px")
      .text(label);
  }
  if (ciLow > 0) drawCIBound(ciLow, toX(ciLow).toPrecision(3));
  drawCIBound(ciHigh, toX(ciHigh).toPrecision(3));

  // ---- 5. Profile curve (clipped) ----
  const lineGen = d3.line()
    .x((_, i) => x(toX(grid[i])))
    .y((_, i) => y(ll[i]))
    .defined((_, i) => isFinite(ll[i]));

  g.append("g").attr("clip-path", `url(#${clipId})`)
    .append("path")
    .datum(ll)
    .attr("fill", "none")
    .attr("stroke", "var(--accent)")
    .attr("stroke-width", 2)
    .attr("d", lineGen);

  // ---- 6. Peak dot ----
  g.append("circle")
    .attr("cx", xHat)
    .attr("cy", y(0))
    .attr("r", 4)
    .attr("fill", "var(--accent)");

  // ---- 7. Axes ----
  const fmt = xScale === "tau"
    ? d3.format(".3~g")
    : d3.format(".3~g");

  const axisX = g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(fmt));
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  const axisY = g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".2f")));
  styleAxis(axisY, "var(--border-hover)", "var(--fg-muted)", "10px");

  // ---- 8. Axis labels ----
  const xLabel = xScale === "tau"
    ? "τ (between-study SD)"
    : "τ² (between-study variance)";
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", H - 8)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text(xLabel);

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2))
    .attr("y", 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Profile log-likelihood (relative)");

  // ---- 9. Title ----
  svg.append("text")
    .attr("x", margin.left + iW / 2)
    .attr("y", 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--fg)")
    .style("font-size", "11px")
    .style("font-weight", "600")
    .text(`Profile likelihood \u2014 \u03C4\u00B2 \u2014 ${method} \u2014 k\u202F=\u202F${k}`);
}

// =============================================================================
// drawBayesTauPosterior(result, options)
// =============================================================================
// Marginal posterior density of τ from bayesMeta().
// tauWeights are probability masses (sum to 1); dividing by Δτ gives density.
// SVG target: #bayesTauPlot (500 × 340 px by default).
// Elements (back-to-front):
//   gridlines → 95% CrI shaded area → full density area (faint) →
//   density curve → CI bound lines → posterior mean line → axes → labels → title
// =============================================================================
export function drawBayesTauPosterior(result, options = {}) {
  const svg = clearAndSelectSVG("#bayesTauPlot");
  if (!result || result.error) return;

  const { tauGrid, tauWeights, tauMean, tauCI, sigma_tau, k } = result;
  const nGrid = tauGrid.length;
  const dtau  = nGrid > 1 ? tauGrid[1] - tauGrid[0] : 1;

  const margin = { top: 34, right: 24, bottom: 56, left: 66 };
  const W  = +svg.attr("width")  || 500;
  const H  = +svg.attr("height") || 340;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Convert probability masses → density
  const density = new Float64Array(nGrid);
  for (let i = 0; i < nGrid; i++) density[i] = tauWeights[i] / dtau;

  const tauMax  = tauGrid[nGrid - 1];
  const densMax = d3.max(density);

  const x = d3.scaleLinear().domain([0, tauMax]).range([0, iW]);
  const y = d3.scaleLinear().domain([0, densMax * 1.1]).range([iH, 0]);

  // ---- Gridlines ----
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(4).tickSize(-iW).tickFormat(""))
    .selectAll("line").attr("stroke", "var(--border)").attr("stroke-dasharray", "2,3");
  g.select(".grid .domain").remove();

  // ---- Helper: linearly interpolate density at arbitrary τ ----
  const interpDens = (tau) => {
    if (dtau <= 0) return 0;
    const idx = Math.min(nGrid - 2, Math.max(0, Math.floor(tau / dtau)));
    const frac = (tau - tauGrid[idx]) / dtau;
    return density[idx] * (1 - frac) + density[idx + 1] * frac;
  };

  // ---- 1. 95% CrI shaded area ----
  const ciPts = [[tauCI[0], interpDens(tauCI[0])]];
  for (let i = 0; i < nGrid; i++) {
    if (tauGrid[i] > tauCI[0] && tauGrid[i] < tauCI[1]) ciPts.push([tauGrid[i], density[i]]);
  }
  ciPts.push([tauCI[1], interpDens(tauCI[1])]);

  g.append("path")
    .datum(ciPts)
    .attr("fill", "var(--accent)").attr("fill-opacity", 0.20).attr("stroke", "none")
    .attr("d", d3.area().x(d => x(d[0])).y0(iH).y1(d => y(d[1])));

  // ---- 2. Full density area (very light background fill) ----
  const allPts = Array.from({ length: nGrid }, (_, i) => [tauGrid[i], density[i]]);

  g.append("path")
    .datum(allPts)
    .attr("fill", "var(--accent)").attr("fill-opacity", 0.06).attr("stroke", "none")
    .attr("d", d3.area().x(d => x(d[0])).y0(iH).y1(d => y(d[1])));

  // ---- 3. Density curve ----
  g.append("path")
    .datum(allPts)
    .attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2)
    .attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1])));

  // ---- 4. CI bound tick lines ----
  [tauCI[0], tauCI[1]].forEach(t => {
    g.append("line")
      .attr("x1", x(t)).attr("x2", x(t))
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--accent)").attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3").attr("opacity", 0.7);
  });

  // ---- 5. Posterior mean line ----
  const meanX    = x(tauMean);
  const meanRight = meanX > iW * 0.6;
  g.append("line")
    .attr("x1", meanX).attr("x2", meanX)
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--accent)").attr("stroke-width", 2)
    .attr("stroke-dasharray", "6,3");

  g.append("text")
    .attr("x", meanX + (meanRight ? -4 : 4))
    .attr("y", 22)
    .attr("text-anchor", meanRight ? "end" : "start")
    .attr("fill", "var(--fg-muted)").style("font-size", "9px")
    .text(`mean\u202F=\u202F${tauMean.toFixed(3)}`);

  // ---- 6. Axes ----
  const axisX = g.append("g").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".2~g")));
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  const axisY = g.append("g")
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".2~g")));
  styleAxis(axisY, "var(--border-hover)", "var(--fg-muted)", "10px");

  // ---- 7. Axis labels ----
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", H - 8)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("\u03C4 (between-study SD)");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2)).attr("y", 14)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Posterior density");

  // ---- 8. Title ----
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 14)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)")
    .style("font-size", "11px").style("font-weight", "600")
    .text(`Posterior of \u03C4 \u2014 HalfNormal(\u03C3_\u03C4\u202F=\u202F${sigma_tau}) \u2014 k\u202F=\u202F${k}`);
}

// =============================================================================
// drawBayesMuPosterior(result, options)
// =============================================================================
// Marginal posterior density of μ from bayesMeta() — a mixture of Gaussians
// over the τ grid, pre-evaluated and stored in result.muDensity.
// SVG target: #bayesMuPlot (500 × 340 px by default).
// options.reMean: frequentist RE estimate (analysis scale) for comparison line.
// Elements (back-to-front):
//   gridlines → 95% CrI shaded area → full density area (faint) →
//   density curve → CI bound lines → posterior mean line →
//   RE comparison line (if options.reMean provided) → axes → labels → title
// =============================================================================
export function drawBayesMuPosterior(result, options = {}) {
  const svg = clearAndSelectSVG("#bayesMuPlot");
  if (!result || result.error) return;

  const { muGrid, muDensity, muMean, muCI, mu0, sigma_mu, k } = result;
  const nMu   = muGrid.length;
  const dMu   = nMu > 1 ? muGrid[1] - muGrid[0] : 1;
  const muMin = muGrid[0];
  const muMax = muGrid[nMu - 1];
  const reMean = options.reMean;

  const margin = { top: 34, right: 24, bottom: 56, left: 66 };
  const W  = +svg.attr("width")  || 500;
  const H  = +svg.attr("height") || 340;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const densMax = d3.max(muDensity);

  const x = d3.scaleLinear().domain([muMin, muMax]).range([0, iW]);
  const y = d3.scaleLinear().domain([0, densMax * 1.1]).range([iH, 0]);

  // ---- Gridlines ----
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(4).tickSize(-iW).tickFormat(""))
    .selectAll("line").attr("stroke", "var(--border)").attr("stroke-dasharray", "2,3");
  g.select(".grid .domain").remove();

  // ---- Helper: linearly interpolate muDensity at arbitrary μ ----
  const interpDens = (mu) => {
    if (dMu <= 0) return 0;
    const idx = Math.min(nMu - 2, Math.max(0, Math.floor((mu - muMin) / dMu)));
    const frac = (mu - muGrid[idx]) / dMu;
    return muDensity[idx] * (1 - frac) + muDensity[idx + 1] * frac;
  };

  // ---- 1. 95% CrI shaded area ----
  const ciPts = [[muCI[0], interpDens(muCI[0])]];
  for (let j = 0; j < nMu; j++) {
    if (muGrid[j] > muCI[0] && muGrid[j] < muCI[1]) ciPts.push([muGrid[j], muDensity[j]]);
  }
  ciPts.push([muCI[1], interpDens(muCI[1])]);

  g.append("path")
    .datum(ciPts)
    .attr("fill", "var(--accent)").attr("fill-opacity", 0.20).attr("stroke", "none")
    .attr("d", d3.area().x(d => x(d[0])).y0(iH).y1(d => y(d[1])));

  // ---- 2. Full density area (very light background fill) ----
  const allPts = Array.from({ length: nMu }, (_, j) => [muGrid[j], muDensity[j]]);

  g.append("path")
    .datum(allPts)
    .attr("fill", "var(--accent)").attr("fill-opacity", 0.06).attr("stroke", "none")
    .attr("d", d3.area().x(d => x(d[0])).y0(iH).y1(d => y(d[1])));

  // ---- 3. Density curve ----
  g.append("path")
    .datum(allPts)
    .attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2)
    .attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1])));

  // ---- 4. CI bound tick lines ----
  [muCI[0], muCI[1]].forEach(m => {
    g.append("line")
      .attr("x1", x(m)).attr("x2", x(m))
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--accent)").attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3").attr("opacity", 0.7);
  });

  // ---- 5. Posterior mean line ----
  const meanX     = x(muMean);
  const meanRight = meanX > iW * 0.6;
  g.append("line")
    .attr("x1", meanX).attr("x2", meanX)
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "var(--accent)").attr("stroke-width", 2)
    .attr("stroke-dasharray", "6,3");

  g.append("text")
    .attr("x", meanX + (meanRight ? -4 : 4))
    .attr("y", 22)
    .attr("text-anchor", meanRight ? "end" : "start")
    .attr("fill", "var(--fg-muted)").style("font-size", "9px")
    .text(`posterior mean\u202F=\u202F${muMean.toFixed(3)}`);

  // ---- 6. Frequentist RE comparison line (dotted) ----
  if (reMean !== undefined && isFinite(reMean) && reMean >= muMin && reMean <= muMax) {
    const reX     = x(reMean);
    const reRight = reX > iW * 0.6;
    g.append("line")
      .attr("x1", reX).attr("x2", reX)
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--fg-muted)").attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "3,2");

    g.append("text")
      .attr("x", reX + (reRight ? -4 : 4))
      .attr("y", 34)
      .attr("text-anchor", reRight ? "end" : "start")
      .attr("fill", "var(--fg-muted)").style("font-size", "9px")
      .text(`RE\u202F=\u202F${reMean.toFixed(3)}`);
  }

  // ---- 7. Axes ----
  const axisX = g.append("g").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".3~g")));
  styleAxis(axisX, "var(--border-hover)", "var(--fg-muted)", "10px");

  const axisY = g.append("g")
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".2~g")));
  styleAxis(axisY, "var(--border-hover)", "var(--fg-muted)", "10px");

  // ---- 8. Axis labels ----
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", H - 8)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("\u03BC (pooled effect, analysis scale)");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + iH / 2)).attr("y", 14)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Posterior density");

  // ---- 9. Title ----
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 14)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)")
    .style("font-size", "11px").style("font-weight", "600")
    .text(`Posterior of \u03BC \u2014 N(\u03BC\u2080\u202F=\u202F${mu0},\u202F\u03C3_\u03BC\u202F=\u202F${sigma_mu}) \u2014 k\u202F=\u202F${k}`);
}

// =============================================================================
// drawQQPlot — Normal Q-Q plot of standardised residuals
// =============================================================================
// stdResiduals : number[]  — internally standardised residuals  zᵢ = (yᵢ−μ̂)/√(vᵢ+τ²)
// labels       : string[]  — study labels (same order as stdResiduals)
// options      : { containerId? }   default containerId = "#qqPlot"
//
// Theoretical quantiles: Blom's formula  qᵢ = Φ⁻¹((i − 0.375) / (k + 0.25))
// Reference line: fitted through (Q₁_theory, Q₁_sample) and (Q₃_theory, Q₃_sample),
//   matching R's qqline() convention.
// =============================================================================
export function drawQQPlot(stdResiduals, labels, options = {}) {
  const containerId = options.containerId || "#qqPlot";
  const svg = clearAndSelectSVG(containerId);

  const k = stdResiduals.length;
  if (k < 3) return;

  const W = +svg.attr("width")  || 420;
  const H = +svg.attr("height") || 380;
  const margin = { top: 30, right: 24, bottom: 56, left: 62 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  // ---- 1. Compute theoretical quantiles (Blom's formula) ----
  // Sort indices by residual value to pair with quantiles.
  const order = Array.from({ length: k }, (_, i) => i)
    .sort((a, b) => stdResiduals[a] - stdResiduals[b]);

  const points = order.map((origIdx, rank) => {
    const p = (rank + 1 - 0.375) / (k + 0.25);
    return {
      label:    (labels && labels[origIdx]) || String(origIdx + 1),
      theory:   normalQuantile(p),
      observed: stdResiduals[origIdx],
    };
  });

  // ---- 2. Reference line: slope/intercept through Q1 and Q3 ----
  // Theoretical Q1/Q3
  const tQ1 = normalQuantile(0.25);
  const tQ3 = normalQuantile(0.75);

  // Sample Q1/Q3 from sorted residuals
  function quantile(sorted, p) {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }
  const sorted = points.map(p => p.observed);  // already sorted
  const sQ1 = quantile(sorted, 0.25);
  const sQ3 = quantile(sorted, 0.75);

  const slope     = (sQ3 - sQ1) / (tQ3 - tQ1);
  const intercept = sQ1 - slope * tQ1;

  // ---- 3. Scales ----
  const xPad = Math.max(0.3, (tQ3 - tQ1) * 0.2);
  const yPad = Math.max(0.3, (sQ3 - sQ1) * 0.2);
  const allTheory   = points.map(p => p.theory);
  const allObserved = points.map(p => p.observed);

  const xMin = Math.min(...allTheory)   - xPad;
  const xMax = Math.max(...allTheory)   + xPad;
  const yMin = Math.min(...allObserved, intercept + slope * xMin) - yPad;
  const yMax = Math.max(...allObserved, intercept + slope * xMax) + yPad;

  const x = d3.scaleLinear().domain([xMin, xMax]).range([0, iW]);
  const y = d3.scaleLinear().domain([yMin, yMax]).range([iH, 0]);

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- 4. Zero guidelines ----
  [[0, "x"], [0, "y"]].forEach(([val, axis]) => {
    const x1 = axis === "x" ? x(val) : 0;
    const x2 = axis === "x" ? x(val) : iW;
    const y1 = axis === "y" ? y(val) : 0;
    const y2 = axis === "y" ? y(val) : iH;
    if (x1 < 0 || x1 > iW || y1 < 0 || y1 > iH) return; // out of range
    g.append("line")
      .attr("x1", x1).attr("x2", x2).attr("y1", y1).attr("y2", y2)
      .attr("stroke", "var(--border)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3");
  });

  // ---- 5. Reference line ----
  const lineX1 = xMin, lineX2 = xMax;
  const lineY1 = intercept + slope * lineX1;
  const lineY2 = intercept + slope * lineX2;

  g.append("line")
    .attr("x1", x(lineX1)).attr("x2", x(lineX2))
    .attr("y1", y(lineY1)).attr("y2", y(lineY2))
    .attr("stroke", "var(--accent)")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "6,3");

  // ---- 6. Points ----
  const tooltip = selTooltip();

  points.forEach(pt => {
    const cx = x(pt.theory);
    const cy = y(pt.observed);
    const isOutlier = Math.abs(pt.observed) > 2;

    g.append("circle")
      .attr("cx", cx).attr("cy", cy)
      .attr("r", 5)
      .attr("fill", isOutlier ? "var(--color-warning)" : "var(--accent)")
      .attr("fill-opacity", 0.80)
      .attr("stroke", "var(--bg-surface)")
      .attr("stroke-width", 1)
      .on("mousemove", (event) => {
        tooltip.style("opacity", 1)
          .html(
            `<b>${pt.label}</b>` +
            `<br>Theoretical quantile: ${pt.theory.toFixed(3)}` +
            `<br>Std. residual: ${pt.observed.toFixed(3)}` +
            (isOutlier ? `<br><i>Potential outlier (|z| > 2)</i>` : "")
          )
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY - 24) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0));
  });

  // ---- 7. Axes ----
  const xAxis = d3.axisBottom(x).ticks(5).tickSize(4);
  const yAxis = d3.axisLeft(y).ticks(5).tickSize(4);

  const isDark = document.documentElement.classList.contains("dark");
  const strokeColor = isDark ? "#aaa" : "#555";
  const fillColor   = isDark ? "#ccc" : "#333";

  const xAxisG = g.append("g").attr("transform", `translate(0,${iH})`).call(xAxis);
  styleAxis(xAxisG, strokeColor, fillColor, 10, "sans-serif");
  const yAxisG = g.append("g").call(yAxis);
  styleAxis(yAxisG, strokeColor, fillColor, 10, "sans-serif");

  // ---- 8. Axis labels ----
  g.append("text")
    .attr("x", iW / 2).attr("y", iH + 42)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Theoretical quantiles");

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(iH / 2)).attr("y", -48)
    .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)")
    .style("font-size", "11px")
    .text("Standardised residuals");

  // ---- 9. Title ----
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 18)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)")
    .style("font-size", "11px").style("font-weight", "600")
    .text(`Normal Q-Q plot \u2014 k\u202F=\u202F${k}`);
}

// ================= RADIAL (GALBRAITH) PLOT =================
// Standardised effect (yᵢ/seᵢ) vs precision (1/seᵢ).
// Regression line through origin has slope = FE pooled estimate.
// Studies with |yᵢ/seᵢ − θ_FE·(1/seᵢ)| > 2 are highlighted as potential outliers.
// Right axis: effect-size scale (θ = y/x at the right edge).
//
// Parameters:
//   studies  — array with { yi, vi, label } (already filtered valid)
//   m        — meta() result; m.FE used as the slope of the reference line
//   profile  — effect profile (for back-transform labels on the right axis)
//   options  — { containerId: "#radialPlot" }
export function drawRadialPlot(studies, m, profile, options = {}) {
  const containerId = options.containerId || "#radialPlot";
  const svg = clearAndSelectSVG(containerId);

  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  if (k < 2) return;

  const W = +svg.attr("width")  || 500;
  const H = +svg.attr("height") || 400;
  const margin = { top: 30, right: 80, bottom: 54, left: 60 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  // ---- 1. Compute radial coordinates ----
  const pts = valid.map(s => {
    const se  = Math.sqrt(s.vi);
    const xi  = 1 / se;
    const yi  = s.yi / se;
    return { xi, yi, label: s.label || "", se, raw: s.yi };
  });

  const theta = m.FE;    // FE pooled estimate = slope of regression line through origin
  const isTransformed = profile && profile.isTransformedScale;
  const fmt4 = v => isFinite(v) ? v.toFixed(4) : "—";

  // Flag outliers: |yi − theta * xi| > 2  ↔  |standardised residual from line| > 2
  pts.forEach(p => { p.outlier = Math.abs(p.yi - theta * p.xi) > 2; });

  // ---- 2. Scales ----
  const xMax = d3.max(pts, d => d.xi);
  const xDom = [0, xMax * 1.08];

  const yVals = pts.map(d => d.yi);
  const lineYatXmax  = theta * xMax * 1.08;
  const band2YatXmax = lineYatXmax + 2;
  const band2YatXmin = theta * 0   + 2;   // at x=0, line=0, band=±2
  const yAllExtent   = [
    Math.min(...yVals, lineYatXmax - 2, -2.5),
    Math.max(...yVals, lineYatXmax + 2,  2.5),
  ];
  const yPad  = (yAllExtent[1] - yAllExtent[0]) * 0.10;
  const yDom  = [yAllExtent[0] - yPad, yAllExtent[1] + yPad];

  const xScale = d3.scaleLinear().domain(xDom).range([0, iW]);
  const yScale = d3.scaleLinear().domain(yDom).range([iH, 0]);

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // ---- 3. Zero line (y = 0) ----
  if (yDom[0] < 0 && yDom[1] > 0) {
    g.append("line")
      .attr("x1", 0).attr("x2", iW)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "var(--border)").attr("stroke-dasharray", "3,3").attr("stroke-width", 1);
  }

  // ---- 4. ±2 band lines (dashed) ----
  // y = theta*x ± 2; these are straight lines through (0, ±2)
  [+2, -2].forEach(offset => {
    const x0 = 0, y0 = theta * 0 + offset;
    const x1 = xDom[1], y1 = theta * xDom[1] + offset;
    // Clip to yDom
    const px0 = xScale(x0), py0 = yScale(y0);
    const px1 = xScale(x1), py1 = yScale(y1);
    g.append("line")
      .attr("x1", px0).attr("y1", py0)
      .attr("x2", px1).attr("y2", py1)
      .attr("stroke", "var(--border-hover)")
      .attr("stroke-dasharray", "5,3")
      .attr("stroke-width", 1.2);
    // Label: "±2" at right edge (if in view)
    const labelY = py1;
    if (labelY >= 0 && labelY <= iH) {
      g.append("text")
        .attr("x", px1 + 4).attr("y", labelY + 4)
        .attr("fill", "var(--fg-muted)").style("font-size", "10px")
        .text(offset > 0 ? "+2" : "−2");
    }
  });

  // ---- 5. FE reference line through origin ----
  if (isFinite(theta)) {
    const lx0 = 0,        ly0 = theta * 0;
    const lx1 = xDom[1],  ly1 = theta * xDom[1];
    g.append("line")
      .attr("x1", xScale(lx0)).attr("y1", yScale(ly0))
      .attr("x2", xScale(lx1)).attr("y2", yScale(ly1))
      .attr("stroke", "var(--accent)").attr("stroke-width", 1.5);
  }

  // ---- 6. Points ----
  attachTooltip(
    g.selectAll("circle.radial-pt")
      .data(pts)
      .enter().append("circle")
      .attr("class", "radial-pt")
      .attr("cx", d => xScale(d.xi))
      .attr("cy", d => yScale(d.yi))
      .attr("r", 5)
      .attr("fill", d => d.outlier ? "var(--color-warning)" : "var(--accent)")
      .attr("fill-opacity", 0.82)
      .attr("stroke", "var(--bg)")
      .attr("stroke-width", 0.8),
    d => {
      const thetaHat = d.yi / d.xi;   // study-specific estimate = yi
      const disp = isTransformed
        ? `${fmt4(profile.transform(d.raw))} (raw: ${fmt4(d.raw)})`
        : fmt4(d.raw);
      return `<strong>${d.label || "Study"}</strong><br>` +
        `y/SE = ${fmt4(d.yi)}<br>` +
        `1/SE = ${fmt4(d.xi)}<br>` +
        `Effect (yᵢ) = ${disp}<br>` +
        (d.outlier ? `<span style="color:var(--color-warning)">⚠ Potential outlier (|residual| > 2)</span>` : "");
    }
  );

  // ---- 7. Axes ----
  const xAxis = d3.axisBottom(xScale).ticks(6);
  const yAxis = d3.axisLeft(yScale).ticks(7);

  g.append("g").attr("transform", `translate(0,${iH})`).call(xAxis)
    .selectAll("text").style("font-size", "10px");
  g.append("g").call(yAxis)
    .selectAll("text").style("font-size", "10px");

  // X-axis label
  g.append("text")
    .attr("x", iW / 2).attr("y", iH + 42)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)")
    .style("font-size", "11px")
    .text("Precision (1/SE)");

  // Y-axis label
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -iH / 2).attr("y", -46)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)")
    .style("font-size", "11px")
    .text("Standardised effect (y/SE)");

  // ---- 8. Right axis: effect-size scale ----
  // At x = x_max (right edge), the effect size for a given y is θ = y / x_max.
  // Draw a secondary right axis with ticks at nice effect-size values.
  const xRight = xDom[1];   // x value at the right edge
  if (isFinite(xRight) && xRight > 0) {
    // Determine effect-size range visible at the right edge
    const thetaMin = yDom[0] / xRight;
    const thetaMax = yDom[1] / xRight;

    // Use D3 to pick nice tick values in [thetaMin, thetaMax]
    const thetaScale = d3.scaleLinear().domain([thetaMin, thetaMax]);
    const thetaTicks = thetaScale.ticks(6);

    // Draw right-axis line
    g.append("line")
      .attr("x1", iW).attr("x2", iW)
      .attr("y1", 0).attr("y2", iH)
      .attr("stroke", "var(--border)").attr("stroke-width", 1);

    thetaTicks.forEach(θ => {
      const yPx = yScale(θ * xRight);
      if (yPx < 0 || yPx > iH) return;
      const dispTheta = isTransformed ? profile.transform(θ) : θ;
      const label = isFinite(dispTheta) ? (+dispTheta.toFixed(3)).toString() : "";
      g.append("line")
        .attr("x1", iW).attr("x2", iW + 4)
        .attr("y1", yPx).attr("y2", yPx)
        .attr("stroke", "var(--border)").attr("stroke-width", 1);
      g.append("text")
        .attr("x", iW + 7).attr("y", yPx + 4)
        .attr("fill", "var(--fg-muted)").style("font-size", "9px")
        .text(label);
    });

    // Right-axis label
    const axisLabel = isTransformed ? (profile.label || "Effect") : "Effect size (θ)";
    g.append("text")
      .attr("transform", "rotate(90)")
      .attr("x", iH / 2).attr("y", -(iW + margin.right - 10))
      .attr("text-anchor", "middle").attr("fill", "var(--fg-muted)")
      .style("font-size", "10px")
      .text(axisLabel);
  }

  // ---- 9. Title ----
  const nOut = pts.filter(p => p.outlier).length;
  const outNote = nOut > 0 ? ` \u2014 ${nOut} outlier${nOut > 1 ? "s" : ""}` : "";
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 18)
    .attr("text-anchor", "middle").attr("fill", "var(--fg)")
    .style("font-size", "11px").style("font-weight", "600")
    .text(`Radial (Galbraith) plot \u2014 k\u202F=\u202F${k}${outNote}`);
}
