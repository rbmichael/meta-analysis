// ================= FOREST =================
export function drawForest(studies,m){
 const svg=d3.select("#forestPlot"); svg.selectAll("*").remove();
 const tooltip=d3.select("#tooltip");

 const x=d3.scaleLinear()
  .domain(d3.extent(studies.flatMap(d=>[d.yi-1.96*d.se,d.yi+1.96*d.se])))
  .nice().range([100,800]);

 const y=d3.scaleBand()
  .domain(studies.map(d=>d.label))
  .range([20,300]).padding(0.4);

 svg.append("line")
  .attr("x1",x(0)).attr("x2",x(0))
  .attr("y1",0).attr("y2",350)
  .attr("stroke","white").attr("stroke-dasharray","4");

 svg.selectAll("line.ci")
  .data(studies).enter().append("line")
  .attr("x1",d=>x(d.yi-1.96*d.se))
  .attr("x2",d=>x(d.yi+1.96*d.se))
  .attr("y1",d=>y(d.label))
  .attr("y2",d=>y(d.label))
  .attr("stroke","white");

 const wMax=d3.max(studies,d=>d.w);

 svg.selectAll("rect")
  .data(studies).enter().append("rect")
  .attr("x",d=>x(d.yi)-Math.sqrt(d.w/wMax)*10)
  .attr("y",d=>y(d.label)-5)
  .attr("width",d=>Math.sqrt(d.w/wMax)*20)
  .attr("height",10)
  .attr("fill",d=>d.filled?"none":"white")
  .attr("stroke","white")
  .on("mousemove",(e,d)=>{
   tooltip.style("opacity",1)
    .html(`${d.label}<br>${d.yi.toFixed(2)}<br>CI: ${(d.yi-1.96*d.se).toFixed(2)}–${(d.yi+1.96*d.se).toFixed(2)}`)
    .style("left",(e.pageX+10)+"px")
    .style("top",(e.pageY-20)+"px");
  })
  .on("mouseout",()=>tooltip.style("opacity",0));

 svg.append("g").attr("transform","translate(0,350)").call(d3.axisBottom(x));
 svg.append("g").attr("transform","translate(100,0)").call(d3.axisLeft(y));
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