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

 const lineData = d3.range(seMin, seMax, (seMax-seMin)/50).map(se => {
  const x = se * (egger.intercept + egger.slope * (1/se));
  return { x, se };
 });

 const line = d3.line()
  .x(d => xScale(d.x))
  .y(d => yScale(d.se));

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