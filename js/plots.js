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

  // SE of the marginal fitted value at x: sqrt(l(x)' vcov l(x) * s2)
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
      .attr("stroke", "#444").attr("stroke-dasharray", "4,2");
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
        .attr("fill", "rgba(79, 195, 247, 0.12)")
        .attr("stroke", "none")
        .attr("d", area);
    }

    // Regression line
    g.append("line")
      .attr("x1", xScale(xl)).attr("y1", yScale(intercept0 + slope * xl))
      .attr("x2", xScale(xr)).attr("y2", yScale(intercept0 + slope * xr))
      .attr("stroke", "#4fc3f7").attr("stroke-width", 2);
  }

  // Bubbles
  const tooltip = d3.select("#tooltip");
  g.selectAll("circle")
    .data(valid)
    .enter().append("circle")
    .attr("cx", s => xScale(s[modName]))
    .attr("cy", s => yScale(s.yi))
    .attr("r",  (s, i) => Math.max(3, rMax * Math.sqrt(wArr[i] / wMax)))
    .attr("fill",   "rgba(255,255,255,0.12)")
    .attr("stroke", "white")
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
    .attr("text-anchor", "middle").attr("fill", "#ccc").style("font-size", "12px")
    .text(modName);

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -iH / 2).attr("y", -44)
    .attr("text-anchor", "middle").attr("fill", "#ccc").style("font-size", "12px")
    .text("Effect size (yi)");

  // Title
  svg.append("text")
    .attr("x", margin.left + iW / 2).attr("y", 16)
    .attr("text-anchor", "middle").attr("fill", "#eee").style("font-size", "13px")
    .text(`${modName}  (β = ${isFinite(slope) ? slope.toFixed(3) : "NA"})`);
}

// ================= FOREST =================
export function drawForest(studies, m, options = {}) {
  const svg = d3.select("#forestPlot");
  svg.selectAll("*").remove();

  const tooltip = d3.select("#tooltip");
  const ciMethod = options.ciMethod || "normal";

  // Use correct critical value
  const crit = m.crit || 1.96;

  // CI method label
  const ciLabel = {
    normal: "Normal (z)",
    t: "t-distribution",
    KH: "Knapp-Hartung"
  }[ciMethod] || ciMethod;

  // ----------- SCALES -----------
  const x = d3.scaleLinear()
    .domain(d3.extent(studies.flatMap(d => [
      d.yi - crit * d.se,
      d.yi + crit * d.se
    ])))
    .nice()
    .range([100, 800]);

  const y = d3.scaleBand()
    .domain(studies.map(d => d.label))
    .range([40, 300])
    .padding(0.4);

  // ----------- TITLE -----------
  svg.append("text")
    .attr("x", 450)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .text(`Random-effects model (${ciLabel})`);

  // ----------- ZERO LINE -----------
  svg.append("line")
    .attr("x1", x(0))
    .attr("x2", x(0))
    .attr("y1", 0)
    .attr("y2", 350)
    .attr("stroke", "white")
    .attr("stroke-dasharray", "4");

  // ----------- STUDY CIs -----------
  svg.selectAll("line.ci")
    .data(studies)
    .enter()
    .append("line")
    .attr("x1", d => x(d.yi - crit * d.se))
    .attr("x2", d => x(d.yi + crit * d.se))
    .attr("y1", d => y(d.label))
    .attr("y2", d => y(d.label))
    .attr("stroke", "white")
    .attr("stroke-width", ciMethod === "KH" ? 3 : 1.5)
    .attr("stroke-dasharray", ciMethod === "KH" ? "4,2" : "0");

  // ----------- WEIGHTS (BOXES) -----------
  const wMax = d3.max(studies, d => d.w);

  svg.selectAll("rect")
    .data(studies)
    .enter()
    .append("rect")
    .attr("x", d => x(d.yi) - Math.sqrt(d.w / wMax) * 10)
    .attr("y", d => y(d.label) - 5)
    .attr("width", d => Math.sqrt(d.w / wMax) * 20)
    .attr("height", 10)
    .attr("fill", d => d.filled ? "none" : "white")
    .attr("stroke", "white")
    .on("mousemove", (e, d) => {
      tooltip.style("opacity", 1)
        .html(`
          ${d.label}<br>
          Effect: ${d.yi.toFixed(2)}<br>
          CI (${ciLabel}): ${(d.yi - crit * d.se).toFixed(2)} – ${(d.yi + crit * d.se).toFixed(2)}
        `)
        .style("left", (e.pageX + 10) + "px")
        .style("top", (e.pageY - 20) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));

  // ----------- AXES -----------
  svg.append("g")
    .attr("transform", "translate(0,380)")
    .call(d3.axisBottom(x));

  svg.append("g")
    .attr("transform", "translate(100,0)")
    .call(d3.axisLeft(y));

  // ----------- POOLED EFFECT (DIAMOND) -----------
  const diamondY = 340;
  const diamondHalfHeight = 8;

  const ciLow = m.ciLow;
  const ciHigh = m.ciHigh;
  const center = m.RE;

  const diamond = [
    [x(ciLow), diamondY],
    [x(center), diamondY - diamondHalfHeight],
    [x(ciHigh), diamondY],
    [x(center), diamondY + diamondHalfHeight]
  ];

  svg.append("polygon")
    .attr("points", diamond.map(d => d.join(",")).join(" "))
    .attr("fill", "white")
    .attr("stroke", "white")
    .attr("stroke-width", ciMethod === "KH" ? 2.5 : 1.5)
    .attr("stroke-dasharray", ciMethod === "KH" ? "4,2" : "0")
    .append("title")
    .text(() => {
      if (ciMethod === "KH") return "Knapp-Hartung CI (adjusted variance)";
      if (ciMethod === "t") return "t-distribution CI";
      return "Normal (Wald) CI";
    });

	// ----------- PREDICTION INTERVAL -----------
	if (isFinite(m.predLow) && isFinite(m.predHigh)) {
	  const piY = 365; // slightly below diamond

	  // Line for PI
	  svg.append("line")
		.attr("x1", x(m.predLow))
		.attr("x2", x(m.predHigh))
		.attr("y1", piY)
		.attr("y2", piY)
		.attr("stroke", "cyan")
		.attr("stroke-width", 2)
		.attr("stroke-dasharray", "6,3")
		.append("title")
		.text("Prediction interval: expected range of true effects in future studies");

	  // End caps
	  svg.append("line")
		.attr("x1", x(m.predLow))
		.attr("x2", x(m.predLow))
		.attr("y1", piY - 5)
		.attr("y2", piY + 5)
		.attr("stroke", "cyan")
		.attr("stroke-width", 2);

	  svg.append("line")
		.attr("x1", x(m.predHigh))
		.attr("x2", x(m.predHigh))
		.attr("y1", piY - 5)
		.attr("y2", piY + 5)
		.attr("stroke", "cyan")
		.attr("stroke-width", 2);

	  // Label
	  svg.append("text")
		.attr("x", x(m.RE))
		.attr("y", piY + 15)
		.attr("text-anchor", "middle")
		.style("font-size", "11px")
		.attr("fill", "cyan")
		.text(`Prediction interval: ${m.predLow.toFixed(2)} to ${m.predHigh.toFixed(2)}`);
	}
}

// ================= FUNNEL =================
export function drawFunnel(studies,m,egger){
 const svg=d3.select("#funnelPlot"); svg.selectAll("*").remove();

 const x=d3.scaleLinear()
  .domain(d3.extent(studies,d=>d.yi)).nice()
  .range([50,450]);

 const y=d3.scaleLinear()
  .domain([d3.max(studies,d=>d.se),0])
  .range([350,50]);

 svg.selectAll("circle")
  .data(studies).enter().append("circle")
  .attr("cx",d=>x(d.yi))
  .attr("cy",d=>y(d.se))
  .attr("r",4)
  .attr("fill",d=>d.filled?"none":"white")
  .attr("stroke","white");

 svg.append("line")
  .attr("x1",x(m.RE)).attr("x2",x(m.RE))
  .attr("y1",50).attr("y2",350)
  .attr("stroke","cyan").attr("stroke-dasharray","4");

// ================= EGGER REGRESSION LINE =================
if(egger && isFinite(egger.slope)){

 const seMin = d3.min(studies, d => d.se);
 const seMax = d3.max(studies, d => d.se);
 if(seMin === seMax) return;

 const lineData = d3.range(seMin, seMax, (seMax-seMin)/50).map(se => {
  const yi_hat = egger.intercept * se + egger.slope;
  return { yi_hat, se };
 });

 const line = d3.line()
  .x(d => x(d.yi_hat))
  .y(d => y(d.se));

 svg.append("path")
  .datum(lineData)
  .attr("fill", "none")
  .attr("stroke", "red")
  .attr("stroke-width", 2)
  .attr("stroke-dasharray", "4,2")
  .attr("d", line);
}

 svg.append("g").attr("transform","translate(0,350)").call(d3.axisBottom(x));
 svg.append("g").attr("transform","translate(50,0)").call(d3.axisLeft(y));
}

// ================= CUMULATIVE FOREST =================
// Draws a cumulative meta-analysis plot: each row shows the pooled RE
// estimate and 95% CI after adding one more study in accumulation order.
// The final row uses a diamond marker; earlier rows use filled circles.
//
// Parameters:
//   cumulativeResults — array from cumulativeMeta(), already in order
//   profile           — effect-type profile with .label, .transform, .transformCI
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
    const ci      = profile.transformCI(r.ciLow, r.ciHigh);
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
    .style("font-size", "12px")
    .text("Cumulative meta-analysis");

  // Null reference line (at the back-transformed 0 — e.g. 0 for MD, 1 for OR/RR)
  const nullDisp = profile.transform(0);
  if (isFinite(nullDisp)) {
    g.append("line")
      .attr("x1", xScale(nullDisp)).attr("x2", xScale(nullDisp))
      .attr("y1", 0).attr("y2", k * rowH)
      .attr("stroke", "white").attr("stroke-dasharray", "4,3").attr("opacity", 0.45);
  }

  // One row per cumulative step
  rows.forEach((r, i) => {
    const cy     = (i + 0.5) * rowH;
    const isLast = i === k - 1;
    const colour = isLast ? "#ffd740" : "white";

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
    .style("font-size", "11px").attr("fill", "#ccc")
    .text(profile.label);
}