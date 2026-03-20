window.MIN_VAR=1e-8;

// ================= STATS =================
function hedgesG(s){
 const sp=Math.sqrt(((s.n1-1)*s.sd1**2+(s.n2-1)*s.sd2**2)/(s.n1+s.n2-2));
 const d=(s.m1-s.m2)/sp;
 const J=1-(3/(4*(s.n1+s.n2)-9));
 const g=J*d;
 const varg=(s.n1+s.n2)/(s.n1*s.n2)+(g*g)/(2*(s.n1+s.n2-2));
 return {es:g,var:Math.max(varg,MIN_VAR)};
}

function compute(s,type){
 if(type==="SMD"){
  const g=hedgesG(s);
  return {...s,md:g.es,varMD:g.var,se:Math.sqrt(g.var),w:1/g.var};
 }
 const varMD=Math.max((s.sd1**2)/s.n1+(s.sd2**2)/s.n2,MIN_VAR);
 return {...s,md:s.m1-s.m2,varMD,se:Math.sqrt(varMD),w:1/varMD};
}

function meta(studies){
 const W=d3.sum(studies,d=>d.w);
 const FE=d3.sum(studies,d=>d.md*d.w)/W;
 const seFE=Math.sqrt(1/W);

 const Q=d3.sum(studies,d=>d.w*(d.md-FE)**2);
 const df=studies.length-1;
 const I2=Q>df?((Q-df)/Q)*100:0;

 const sumW2=d3.sum(studies,d=>d.w*d.w);
 const C=W-(sumW2/W);
 const tau2=C>0?Math.max(0,(Q-df)/C):0;

 const wRE=studies.map(d=>1/(d.varMD+tau2));
 const WRE=d3.sum(wRE);
 const RE=d3.sum(studies.map((d,i)=>d.md*wRE[i]))/WRE;
 const seRE=Math.sqrt(1/WRE);

 return {FE,seFE,RE,seRE,tau2,Q,df,I2,
  predLow:RE-1.96*Math.sqrt(seRE*seRE+tau2),
  predHigh:RE+1.96*Math.sqrt(seRE*seRE+tau2)};
}