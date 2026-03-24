import { tCritical, normalCDF, tCDF, chiSquareCDF, chiSquareQuantile, fCDF, hedgesG } from "./utils.js";
import { MIN_VAR, REML_TOL, BISECTION_ITERS, Z_95 } from "./constants.js";
import { validateStudy } from "./profiles.js";

// ================= DYNAMIC COMPUTE =================
export function compute(s, type, options = {}) {
  if (!type) {
    if ("m1" in s && "m2" in s && "sd1" in s && "sd2" in s && "n1" in s && "n2" in s) {
      type = "MD"; // default numeric
    } else if ("a" in s && "b" in s && "c" in s && "d" in s) {
      type = "OR"; // default binary counts
    } else {
      console.warn("Unknown effect type in compute", s);
      return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
    }
  }

  const { valid } = validateStudy(s, type);
  if (!valid) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };

	// ================= BINARY DATA =================
	if (type === "OR" || type === "RR" || type === "RD") {
	  let { a, b, c, d } = s;

	  // optional continuity correction for OR/RR
	  if (type === "OR" || type === "RR") {
		if (a === 0 || b === 0 || c === 0 || d === 0) a += 0.5, b += 0.5, c += 0.5, d += 0.5;
	  }

	  let yi, vi;

	  if (type === "OR") { 
		yi = Math.log((a*d)/(b*c)); 
		vi = 1/a + 1/b + 1/c + 1/d; 
	  } else if (type === "RR") { 
		const risk1 = a/(a+b), risk2 = c/(c+d); 
		yi = Math.log(risk1/risk2); 
		vi = (1/a - 1/(a+b)) + (1/c - 1/(c+d)); 
	  } else if (type === "RD") {
		// Risk Difference
		const risk1 = a / (a + b);
		const risk2 = c / (c + d);
		yi = risk1 - risk2;
		vi = (risk1*(1-risk1)/ (a+b)) + (risk2*(1-risk2)/ (c+d));
	  }

	  const safeVi = Math.max(vi, MIN_VAR);
	  return {
		...s,
		yi,
		vi: safeVi,
		se: Math.sqrt(safeVi),
		w: 1/safeVi,
		md: yi,
		varMD: safeVi
	  };
	}

  // ================= CONTINUOUS DATA (SMD) =================
  if (type === "SMD") {
    const g = hedgesG(s, options);
    return { ...s, md: g.es, varMD: g.var, se: Math.sqrt(g.var), w: 1/g.var, yi: g.es, vi: g.var };
  }

  // ================= HETEROSCEDASTIC SMD (SMDH) =================
  // Standardizer: sdi = sqrt((sd1² + sd2²) / 2)  — average-variance approach.
  // Does not assume equal population variances (Bonett 2009).
  // Raw effect:  d   = (m1 - m2) / sdi
  // J correction: J  = 1 - 3 / (4·df - 1),  df = n1 + n2 - 2
  // Corrected:   g   = d · J
  // Variance:    vi  = (sd1²/n1 + sd2²/n2) / sdi²  +  d² / (2·df)
  //              vi_g = vi · J²
  if (type === "SMDH") {
    const { m1, sd1, n1, m2, sd2, n2 } = s;
    const df   = n1 + n2 - 2;
    const sdi2 = (sd1 ** 2 + sd2 ** 2) / 2;           // average variance
    const sdi  = Math.sqrt(sdi2);
    const d    = (m1 - m2) / sdi;
    const J    = 1 - 3 / (4 * df - 1);                // Hedges correction
    const g    = d * J;
    const vi_d = (sd1 ** 2 / n1 + sd2 ** 2 / n2) / sdi2 + d ** 2 / (2 * df);
    const vi_g = Math.max(vi_d * J ** 2, MIN_VAR);
    return { ...s, md: g, varMD: vi_g, yi: g, vi: vi_g, se: Math.sqrt(vi_g), w: 1 / vi_g };
  }

  // ================= COEFFICIENT OF VARIATION RATIO (CVR) =================
  // cv1 = sd1/m1,  cv2 = sd2/m2
  // yi  = log(cv1 / cv2)   — stored on log scale, back-transform with exp()
  // vi  = 1/(2*(n1-1)) + cv1²/n1 + 1/(2*(n2-1)) + cv2²/n2
  // Requires: m1 > 0, m2 > 0, sd1 > 0, sd2 > 0, n1 ≥ 2, n2 ≥ 2
  if (type === "CVR") {
    const { m1, sd1, n1, m2, sd2, n2 } = s;
    const cv1 = sd1 / m1;
    const cv2 = sd2 / m2;
    const yi  = Math.log(cv1 / cv2);
    const vi  = Math.max(
      1 / (2 * (n1 - 1)) + cv1 ** 2 / n1 + 1 / (2 * (n2 - 1)) + cv2 ** 2 / n2,
      MIN_VAR
    );
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= VARIABILITY RATIO (VR) =================
  // yi  = log(sd1 / sd2)   — stored on log scale, back-transform with exp()
  // vi  = 1/(2*(n1-1)) + 1/(2*(n2-1))
  // Requires: sd1 > 0, sd2 > 0, n1 ≥ 2, n2 ≥ 2  (means not needed)
  if (type === "VR") {
    const { sd1, n1, sd2, n2 } = s;
    const yi = Math.log(sd1 / sd2);
    const vi = Math.max(1 / (2 * (n1 - 1)) + 1 / (2 * (n2 - 1)), MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

	// ================ PAIRED MEAN DIFFERENCES ================
	if (type === "MD_paired") {
	  const { m_pre, m_post, sd_pre, sd_post, n, r } = s;
	  const corr = isFinite(r) ? r : 0.5; // fallback assumption

	  const md = m_post - m_pre;

	  const varMD = (sd_pre**2 + sd_post**2 - 2*corr*sd_pre*sd_post) / n;

	  return {
		...s,
		yi: md,
		vi: Math.max(varMD, MIN_VAR),
		se: Math.sqrt(Math.max(varMD, MIN_VAR)),
		w: 1 / Math.max(varMD, MIN_VAR),
		md,
		varMD
	  };
	}

	// =============== STANDARDIZED PAIRED MEAN DIFFERENCES =================
	if (type === "SMD_paired") {
	  const { m_pre, m_post, sd_pre, sd_post, n, r } = s;
	  const corr = isFinite(r) ? r : 0.5;

	  const mean_change = m_post - m_pre;

	  const sd_change = Math.sqrt(
		sd_pre**2 + sd_post**2 - 2*corr*sd_pre*sd_post
	  );

	  const d = mean_change / sd_change;

	  // Hedges correction
	  const df = n - 1;
	  const J = 1 - (3 / (4*df - 1));
	  const g = d * J;

	  const var_d = (1/n) + (d*d)/(2*n);

	  return {
		...s,
		yi: g,
		vi: Math.max(var_d, MIN_VAR),
		se: Math.sqrt(Math.max(var_d, MIN_VAR)),
		w: 1 / Math.max(var_d, MIN_VAR),
		md: g,
		varMD: var_d
	  };
	}

  // ================= CORRELATION =================
  if (type === "COR" || type === "ZCOR") {
    const { r, n } = s;

    if (type === "COR") {
      // Raw correlation: yi = r, vi = (1−r²)²/(n−1)
      const vi = Math.max((1 - r * r) ** 2 / (n - 1), MIN_VAR);
      return { ...s, yi: r, vi, se: Math.sqrt(vi), w: 1 / vi };
    }

    // ZCOR: Fisher's z-transform, vi = 1/(n−3)
    const yi = Math.atanh(r);           // 0.5 * ln((1+r)/(1−r))
    const vi = Math.max(1 / (n - 3), MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= PROPORTIONS =================
  // Input: { x, n }  where x = events, n = total (both non-negative integers).
  // PLN and PLO apply a continuity correction (x += 0.5, n += 1) when x = 0
  // or x = n, matching the OR/RR zero-cell convention.
  if (type === "PR" || type === "PLN" || type === "PLO" ||
      type === "PAS" || type === "PFT") {
    let { x, n } = s;

    // Continuity correction for boundary proportions on log/logit scale
    if ((type === "PLN" || type === "PLO") && (x === 0 || x === n)) {
      x += 0.5;
      n += 1;
    }

    const p = x / n;
    let yi, vi;

    if (type === "PR") {
      // Raw proportion: yi = p,  vi = p(1−p)/n
      yi = p;
      vi = p * (1 - p) / n;

    } else if (type === "PLN") {
      // Log proportion: yi = ln(p),  vi = (1−p)/(n·p)
      yi = Math.log(p);
      vi = (1 - p) / (n * p);

    } else if (type === "PLO") {
      // Logit: yi = ln(p/(1−p)),  vi = 1/(n·p·(1−p))
      yi = Math.log(p / (1 - p));
      vi = 1 / (n * p * (1 - p));

    } else if (type === "PAS") {
      // Arcsine (single): yi = arcsin(√p),  vi = 1/(4n)
      yi = Math.asin(Math.sqrt(p));
      vi = 1 / (4 * n);

    } else {
      // PFT — Freeman-Tukey double arcsine:
      // yi = arcsin(√(x/(n+1))) + arcsin(√((x+1)/(n+1))),  vi = 1/(n+0.5)
      yi = Math.asin(Math.sqrt(x / (n + 1))) +
           Math.asin(Math.sqrt((x + 1) / (n + 1)));
      vi = 1 / (n + 0.5);
    }

    const safeVi = Math.max(vi, MIN_VAR);
    return { ...s, yi, vi: safeVi, se: Math.sqrt(safeVi), w: 1 / safeVi };
  }

  // ================= HAZARD RATIO =================
  // Input: { hr, ci_lo, ci_hi } — published Cox model output on the original scale.
  // SE is recovered from the 95% CI width on the log scale.
  // All three inputs must be strictly positive and ci_lo < ci_hi.
  if (type === "HR") {
    const { hr, ci_lo, ci_hi } = s;
    const yi = Math.log(hr);
    const se = (Math.log(ci_hi) - Math.log(ci_lo)) / (2 * Z_95);
    const vi = Math.max(se * se, MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= INCIDENCE RATE RATIO =================
  // Input: { x1, t1, x2, t2 } — events and person-time per arm.
  // Continuity correction: if either event count is 0, add 0.5 to both.
  if (type === "IRR") {
    let { x1, t1, x2, t2 } = s;
    if (x1 === 0 || x2 === 0) { x1 += 0.5; x2 += 0.5; }
    const yi = Math.log(x1 / t1) - Math.log(x2 / t2);
    const vi = Math.max(1 / x1 + 1 / x2, MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= INCIDENCE RATE (single arm) =================
  // Input: { x, t } — events and person-time.
  // Continuity correction: if x = 0, use x = 0.5.
  if (type === "IR") {
    let { x, t } = s;
    if (x === 0) x = 0.5;
    const yi = Math.log(x / t);
    const vi = Math.max(1 / x, MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

	// ================ GENERIC ===============
	if (type === "GENERIC") {
	  return {
		...s,
		yi: s.yi,
		vi: Math.max(s.vi, MIN_VAR),
		se: Math.sqrt(Math.max(s.vi, MIN_VAR)),
		w: 1 / Math.max(s.vi, MIN_VAR),
		md: s.yi,
		varMD: s.vi
	  };
	}

  // ================= LOG RATIO OF MEANS (ROM) =================
  // yi = log(m1/m2);  vi = sd1²/(n1·m1²) + sd2²/(n2·m2²)
  // Both means must be strictly positive; non-positive inputs yield NaN.
  if (type === "ROM") {
    const { m1, sd1, n1, m2, sd2, n2 } = s;
    const yi = Math.log(m1 / m2);
    const vi = Math.max((sd1 ** 2) / (n1 * m1 ** 2) + (sd2 ** 2) / (n2 * m2 ** 2), MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= MD fallback =================
  const varMD = Math.max((s.sd1**2)/s.n1 + (s.sd2**2)/s.n2, MIN_VAR);
  return { ...s, md: s.m1 - s.m2, varMD, se: Math.sqrt(varMD), w: 1/varMD, yi: s.m1 - s.m2, vi: varMD };
}

// ================= HUNTER-SCHMIDT TAU² =================
// Method-of-moments. Identical to DL except the denominator is Σwᵢ
// rather than the bias-corrected c = Σwᵢ − Σwᵢ²/Σwᵢ.
// Generally produces larger τ² estimates than DL.
export function tau2_HS(studies) {
  const k = studies.length;
  if (k <= 1) return 0;
  const w = studies.map(d => 1 / d.vi);
  const W = w.reduce((a, b) => a + b, 0);
  const ybar = studies.reduce((s, d, i) => s + w[i] * d.yi, 0) / W;
  const Q = studies.reduce((s, d, i) => s + w[i] * (d.yi - ybar) ** 2, 0);
  return Math.max(0, (Q - (k - 1)) / W);
}

// ================= DL WITH ITERATION (DLIT) TAU² =================
// Fixed-point iteration of the DL formula using RE-updated weights.
// τ²_{new} = max(0, (Q(τ²) − (k−1)) / c(τ²))
// Converges to a self-consistent solution; usually 2-3 iterations suffice.
export function tau2_DLIT(studies, tol = REML_TOL, maxIter = 200) {
  const k = studies.length;
  if (k <= 1) return 0;

  let tau2 = tau2_GENQ(studies);  // seed from DL (GENQ with aᵢ=1/vᵢ is DL)

  for (let iter = 0; iter < maxIter; iter++) {
    const w  = studies.map(d => 1 / (d.vi + tau2));
    const W  = w.reduce((s, a) => s + a, 0);
    const W2 = w.reduce((s, a) => s + a ** 2, 0);
    const mu = studies.reduce((s, d, i) => s + w[i] * d.yi, 0) / W;
    const Q  = studies.reduce((s, d, i) => s + w[i] * (d.yi - mu) ** 2, 0);
    const c  = W - W2 / W;
    const newTau2 = Math.max(0, (Q - (k - 1)) / c);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }

  return tau2;
}

// ================= HUNTER-SCHMIDT (small-sample corrected) TAU² =================
// HSk applies a k/(k−1) correction factor to the HS estimate to reduce
// downward bias in small samples.
export function tau2_HSk(studies) {
  const k = studies.length;
  if (k <= 1) return 0;
  return tau2_HS(studies) * k / (k - 1);
}

// ================= HEDGES TAU² =================
// Unweighted method-of-moments (Hedges & Olkin 1985).
// τ²_HE = max(0, SSuw/(k−1) − mean(vᵢ))
// where SSuw = Σ(yᵢ − ȳ_uw)² is the unweighted sum of squared deviations.
// Does not depend on within-study variances for the residual term — useful
// when vᵢ are suspected to be unreliable.
export function tau2_HE(studies) {
  const k = studies.length;
  if (k <= 1) return 0;
  const ybar = studies.reduce((s, d) => s + d.yi, 0) / k;
  const SS   = studies.reduce((s, d) => s + (d.yi - ybar) ** 2, 0);
  const meanV = studies.reduce((s, d) => s + d.vi, 0) / k;
  return Math.max(0, SS / (k - 1) - meanV);
}

// ================= SIDIK-JONKMAN TAU² =================
// Iterative estimator (Sidik & Jonkman 2005) that seeds from the raw
// unweighted between-study variance instead of the Q statistic.
// More robust than DL when k is small or within-study variances are
// poorly estimated.
export function tau2_SJ(studies, tol = REML_TOL, maxIter = 200) {
  const k = studies.length;
  if (k <= 1) return 0;
  const ybar0 = studies.reduce((s, d) => s + d.yi, 0) / k;
  // Seed: raw between-study variance (always > 0 unless all yi identical)
  let tau2 = studies.reduce((s, d) => s + (d.yi - ybar0) ** 2, 0) / k;
  if (tau2 === 0) return 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const w   = studies.map(d => 1 / (d.vi + tau2));
    const W   = w.reduce((a, b) => a + b, 0);
    const mu  = studies.reduce((s, d, i) => s + w[i] * d.yi, 0) / W;
    const newTau2 = studies.reduce((s, d, i) => {
      return s + d.vi * (d.yi - mu) ** 2 / (d.vi + tau2);
    }, 0) / k;
    if (Math.abs(newTau2 - tau2) < tol) return Math.max(0, newTau2);
    tau2 = Math.max(0, newTau2);
  }
  return tau2;
}

// ================= ML TAU² =================
// Maximum Likelihood estimator via Fisher scoring. Same algorithm as REML
// but without the leverage correction in the score/information terms:
//   score = Σ [(yᵢ−μ)²/(vᵢ+τ²)² − 1/(vᵢ+τ²)]
//   info  = Σ [1/(vᵢ+τ²)²]
// ML is asymptotically unbiased but has greater downward bias than REML
// in small samples. Useful when comparing nested models via LRT.
export function tau2_ML(studies, tol = REML_TOL, maxIter = 100) {
  const k = studies.length;
  if (k <= 1) return 0;
  // Seed with DL estimate
  const w0 = studies.map(d => 1 / d.vi);
  const W0 = w0.reduce((a, b) => a + b, 0);
  const ybar0 = studies.reduce((s, d, i) => s + w0[i] * d.yi, 0) / W0;
  const Q0 = studies.reduce((s, d, i) => s + w0[i] * (d.yi - ybar0) ** 2, 0);
  const c0 = W0 - w0.reduce((s, wi) => s + wi * wi / W0, 0);
  let tau2 = Math.max(0, (Q0 - (k - 1)) / c0);

  for (let iter = 0; iter < maxIter; iter++) {
    const w  = studies.map(d => 1 / (d.vi + tau2));
    const W  = w.reduce((a, b) => a + b, 0);
    const mu = studies.reduce((s, d, i) => s + w[i] * d.yi, 0) / W;
    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const vi_tau = studies[i].vi + tau2;
      const r = studies[i].yi - mu;
      score += r * r / (vi_tau * vi_tau) - 1 / vi_tau;
      info  += 1 / (vi_tau * vi_tau);
    }
    if (info <= 0) break;
    let step = score / info;
    let newTau2 = tau2 + step;
    let sh = 0;
    while (newTau2 < 0 && sh++ < 20) { step /= 2; newTau2 = tau2 + step; }
    newTau2 = Math.max(0, newTau2);
    if (Math.abs(newTau2 - tau2) < tol) { tau2 = newTau2; break; }
    tau2 = newTau2;
  }
  return tau2;
}

// ================= REML TAU² =================
// General-purpose REML estimator. Works for any effect type — studies must
// already have yi and vi set (as produced by compute()). Uses the DL
// estimator as the starting value and refines via Fisher scoring.
export function tau2_REML(studies, tol = REML_TOL, maxIter = 100) {

  const k = studies.length;
  if (k <= 1) return 0;

  // --- 1️⃣ Initial tau² (DL / HE estimator) ---
  const w0 = studies.map(d => 1 / d.vi);
  const W0 = w0.reduce((a, b) => a + b, 0);
  const ybar = studies.reduce((sum, d, i) => sum + w0[i] * d.yi, 0) / W0;
  const Q = studies.reduce((sum, d, i) => sum + w0[i] * (d.yi - ybar) ** 2, 0);
  const c = W0 - w0.reduce((sum, wi) => sum + wi * wi / W0, 0);
  let tau2 = Math.max(0, (Q - (k - 1)) / c);

  // --- 2️⃣ Fisher scoring iteration ---
  for (let iter = 0; iter < maxIter; iter++) {
    const w = studies.map(d => 1 / (d.vi + tau2));
    const W = w.reduce((a, b) => a + b, 0);
    const mu = studies.reduce((sum, d, i) => sum + w[i] * d.yi, 0) / W;

    const h = w.map(wi => wi / W);

    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const vi_tau = studies[i].vi + tau2;
      const ri = studies[i].yi - mu;
      score += (ri * ri) / (vi_tau * vi_tau) - (1 - h[i]) / vi_tau;
      info  += (1 - h[i]) / (vi_tau * vi_tau);
    }

    let step = score / info;
    let newTau2 = tau2 + step;

    // Step-halving to keep tau² non-negative
    let halveIter = 0;
    while (newTau2 < 0 && halveIter < 20) {
      step /= 2;
      newTau2 = tau2 + step;
      halveIter++;
    }
    newTau2 = Math.max(0, newTau2);

    if (Math.abs(newTau2 - tau2) < tol) {
      tau2 = newTau2;
      break;
    }

    tau2 = newTau2;
  }

  return tau2;
}

// ================= TAU² PAULE-MANDEL =================
export function tau2_PM(studies, tol = REML_TOL, maxIter = 100) {
  const k = studies.length;
  if (k <= 1) return 0;

  let tau2 = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    const w = studies.map(d => 1 / (d.vi + tau2));
    const W = w.reduce((a, b) => a + b, 0);
    const mu = studies.reduce((sum, d, i) => sum + w[i] * d.yi, 0) / W;

    const Q = studies.reduce((sum, d, i) => {
      return sum + w[i] * Math.pow(d.yi - mu, 2);
    }, 0);

    const newTau2 = Math.max(0, tau2 + (Q - (k - 1)) / W);

    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }

  return tau2;
}

// GENQ core: generalized Q-statistic estimator with arbitrary weights aᵢ.
// DL is the special case aᵢ = 1/vᵢ; SQGENQ uses aᵢ = √(1/vᵢ).
function genqCore(studies, weights) {
  const k = studies.length;
  if (k <= 1) return 0;

  const A  = weights.reduce((s, a) => s + a, 0);
  const ya = studies.reduce((s, d, i) => s + weights[i] * d.yi, 0) / A;
  const Qa = studies.reduce((s, d, i) => s + weights[i] * (d.yi - ya) ** 2, 0);

  const sumAV  = studies.reduce((s, d, i) => s + weights[i] * d.vi, 0);
  const sumA2V = studies.reduce((s, d, i) => s + weights[i] ** 2 * d.vi, 0);
  const sumA2  = weights.reduce((s, a) => s + a ** 2, 0);

  const ba = sumAV - sumA2V / A;  // expected Q under homogeneity
  const ca = A    - sumA2  / A;   // slope

  return ca > 0 ? Math.max(0, (Qa - ba) / ca) : 0;
}

export function tau2_SQGENQ(studies) {
  const weights = studies.map(d => Math.sqrt(1 / d.vi));
  return genqCore(studies, weights);
}

export function tau2_GENQ(studies, weights) {
  const w = weights ?? studies.map(d => 1 / d.vi);
  return genqCore(studies, w);
}

// Compute RE mean given tau²
export function RE_mean(corrected, tau2) {
  const wRE = corrected.map(d => 1 / (d.vi + tau2));
  const WRE = wRE.reduce((a,b)=>a+b,0);
  return corrected.reduce((sum,d,i)=> sum + wRE[i]*d.yi,0)/WRE;
}

// -------------------------------
// Compute FE mean
export function FE_mean(corrected) {
  const wFE = corrected.map(d => 1 / d.vi);
  const WFE = wFE.reduce((a,b)=>a+b,0);
  return corrected.reduce((sum,d,i)=> sum + wFE[i]*d.yi,0)/WFE;
}

// -------------------------------
// Compute I² using fixed-effect weights (1/vi), matching metafor convention.
// tau2 is unused but kept for API compatibility.
export function I2(corrected, tau2) {
  const k = corrected.length;
  if (k <= 1) return 0;
  const wFE = corrected.map(d => 1 / d.vi);
  const W = wFE.reduce((a, b) => a + b, 0);
  const mu = corrected.reduce((sum, d, i) => sum + wFE[i] * d.yi, 0) / W;
  const Q = corrected.reduce((sum, d, i) => sum + wFE[i] * (d.yi - mu) ** 2, 0);
  return Math.max(0, Math.min(100, ((Q - (k - 1)) / Q) * 100));
}

// ================= EGGER TEST =================
export function eggerTest(studies){
  const k = studies.length;
  if(k < 3) return { intercept: NaN, slope: NaN, p: NaN };
  const Z = studies.map(d => d.yi / d.se);
  const X = studies.map(d => 1 / d.se);
  const meanX = d3.mean(X), meanZ = d3.mean(Z);
  let num=0, den=0;
  for(let i=0;i<k;i++){ num += (X[i]-meanX)*(Z[i]-meanZ); den += (X[i]-meanX)**2; }
  const slope = num/den;
  const intercept = meanZ - slope*meanX;
  let rss=0;
  for(let i=0;i<k;i++){ rss += (Z[i] - (intercept + slope*X[i]))**2; }
  const df = k-2;
  const seIntercept = Math.sqrt(rss/df) * Math.sqrt(1/k + (meanX*meanX)/den);
  const t = intercept/seIntercept;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  return { intercept, slope, p, t };
}

// ================= BEGG'S RANK CORRELATION TEST =================
// Kendall's τ between standardised effect (yᵢ − FE) and variance vᵢ.
// Begg & Mazumdar (1994). Tests funnel asymmetry non-parametrically.
//
// Returns: { tau, S, z, p }
//   tau — Kendall's τ_b (normalised S)
//   S   — raw concordance statistic
//   z   — continuity-corrected normal z
//   p   — two-tailed p-value
export function beggTest(studies) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  if (k < 3) return { tau: NaN, S: NaN, z: NaN, p: NaN };

  // Adjust effects for FE pooled estimate (Begg & Mazumdar 1994, eq. 2)
  const w0  = valid.map(s => 1 / s.vi);
  const W   = w0.reduce((a, b) => a + b, 0);
  const FE  = valid.reduce((s, d, i) => s + w0[i] * d.yi, 0) / W;
  // Rank on raw yi: the FE centering and any linear offset cancel in every
  // pairwise sign(adj_i − adj_j), so adj[i] = yi[i] is equivalent.
  const adj = valid.map(s => s.yi);

  // Kendall S = Σ_{i<j} sign(adj_i − adj_j) · sign(vi_i − vi_j)
  let S = 0;
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      S += Math.sign(adj[i] - adj[j]) * Math.sign(valid[i].vi - valid[j].vi);
    }
  }

  // Variance of S under H₀ (no ties formula)
  const varS = k * (k - 1) * (2 * k + 5) / 18;

  // Continuity correction
  const z = S === 0 ? 0 : (Math.abs(S) - 1) / Math.sqrt(varS) * Math.sign(S);
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  const tau = S / (k * (k - 1) / 2);

  return { tau, S, z, p };
}

// ================= FAT-PET =================
// Precision-Effect Test / Funnel Asymmetry Test (Stanley & Doucouliagos 2014).
// WLS regression of yᵢ on SEᵢ with weights wᵢ = 1/vᵢ:
//   yᵢ = β₀ + β₁·SEᵢ + εᵢ
//
// FAT: H₀: β₁ = 0  (no funnel asymmetry / no publication bias)
// PET: β₀ = effect estimate purged of bias (effect at SE → 0)
//
// Returns: { intercept, interceptSE, interceptT, interceptP,
//            slope,     slopeSE,     slopeT,     slopeP,     df }
export function fatPetTest(studies) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  if (k < 3) {
    return {
      intercept: NaN, interceptSE: NaN, interceptT: NaN, interceptP: NaN,
      slope:     NaN, slopeSE:     NaN, slopeT:     NaN, slopeP:     NaN,
      df: k - 2
    };
  }

  const yi = valid.map(s => s.yi);
  const se = valid.map(s => s.se ?? Math.sqrt(s.vi));
  const wi = valid.map(s => 1 / s.vi);

  // Design matrix: [1, SEᵢ]
  const X = valid.map((_, i) => [1, se[i]]);
  const { beta, vcov, rankDeficient } = wls(X, yi, wi);

  if (rankDeficient) {
    return {
      intercept: NaN, interceptSE: NaN, interceptT: NaN, interceptP: NaN,
      slope:     NaN, slopeSE:     NaN, slopeT:     NaN, slopeP:     NaN,
      df: k - 2
    };
  }

  // Residual variance (s²) for SE estimation
  const df  = k - 2;
  const rss = valid.reduce((s, _, i) => {
    const e = yi[i] - beta[0] - beta[1] * se[i];
    return s + wi[i] * e * e;
  }, 0);
  const s2 = df > 0 ? rss / df : NaN;

  const interceptSE = Math.sqrt(s2 * vcov[0][0]);
  const slopeSE     = Math.sqrt(s2 * vcov[1][1]);
  const interceptT  = beta[0] / interceptSE;
  const slopeT      = beta[1] / slopeSE;
  const interceptP  = 2 * (1 - tCDF(Math.abs(interceptT), df));
  const slopeP      = 2 * (1 - tCDF(Math.abs(slopeT),     df));

  return {
    intercept:  beta[0], interceptSE, interceptT, interceptP,
    slope:      beta[1], slopeSE,     slopeT,     slopeP,
    df
  };
}

// ================= FAIL-SAFE N =================
// Rosenthal's (1979) file-drawer number: how many null studies (effect = 0)
// would be needed to push the combined p-value above alpha.
//
//   Nfs = (Σzᵢ / z_α)² − k   where zᵢ = Φ⁻¹(1 − pᵢ/2)  ≥ 0
//
// Also computes Orwin's (1983) fail-safe N: studies needed to bring the
// pooled RE below a trivial threshold |effect_trivial|.
//
//   N_orwin = k · (|RE| − |trivial|) / |trivial|   (clamped to 0)
//
// Returns: { rosenthal, orwin, sumZ, z_crit, k }
export function failSafeN(studies, alpha = 0.05, trivial = 0.1) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  if (k < 1) return { rosenthal: NaN, orwin: NaN, sumZ: NaN, z_crit: NaN, k: 0 };

  // One-sided z for each study: z = |yi| / se  (using study-level statistic)
  const sumZ = valid.reduce((s, d) => {
    const z = Math.abs(d.yi) / Math.sqrt(d.vi);
    return s + z;
  }, 0);

  // Critical z for the chosen alpha (two-tailed → one-sided z_α/2... but
  // Rosenthal uses one-tailed z_α; for α=0.05, z_crit = 1.6449)
  // We derive it by inversion: z such that normalCDF(z) = 1 − alpha
  const z_crit = (() => {
    const target = 1 - alpha;
    let lo = 0, hi = 10;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      normalCDF(mid) < target ? lo = mid : hi = mid;
    }
    return (lo + hi) / 2;
  })();

  const rosenthal = Math.max(0, (sumZ / z_crit) ** 2 - k);

  // Orwin: uses FE pooled estimate (Orwin 1983 predates RE meta-analysis)
  const w0 = valid.map(s => 1 / s.vi);
  const W  = w0.reduce((a, b) => a + b, 0);
  const FE = valid.reduce((s, d, i) => s + w0[i] * d.yi, 0) / W;
  const orwin = Math.max(0, k * (Math.abs(FE) - Math.abs(trivial)) / Math.abs(trivial));

  return { rosenthal, orwin, sumZ, z_crit, k };
}

// ================= INFLUENCE DIAGNOSTICS =================
export function influenceDiagnostics(studies, method="DL", ciMethod="normal"){
  const n = studies.length;
  if(n < 2) return [];
  const full = meta(studies, method, ciMethod);

  // Total RE weight W = Σ 1/(vi + τ²_full).
  // Computed directly from studies rather than via 1/seRE² because seRE
  // may be the KH-adjusted value (not equal to sqrt(1/W)) when ciMethod="KH".
  const W = studies.reduce((s, d) => s + 1 / (d.vi + full.tau2), 0);

  return studies.map((study, idx) => {
    const loo = studies.filter((_, i) => i !== idx);
    const looMeta = meta(loo, method, ciMethod);
    const r = (study.yi - full.RE) / Math.sqrt(study.vi + full.tau2);
    const dfbeta = (full.RE - looMeta.RE) / looMeta.seRE;
    const deltaTau2 = full.tau2 - looMeta.tau2;
    const outlier = Math.abs(r) > 2;
    const influential = Math.abs(dfbeta) > 1;

    // Hat value: h_i = w_i / W  (fraction of total RE weight held by study i)
    const wi  = 1 / (study.vi + full.tau2);
    const hat = wi / W;

    // Cook's distance: D_i = (RE_full − RE_loo)² × W
    // Equivalent to (RE_full − RE_loo)² / Var(RE_full) where Var = 1/W.
    // Measures how far the pooled estimate moves (in SE units) on study removal.
    const cookD = (full.RE - looMeta.RE) ** 2 * W;

    // Conventional flags (regression-analogy thresholds)
    const highLeverage = hat  > 2 / n;   // h_i > 2/k
    const highCookD    = cookD > 4 / n;  // D_i > 4/k

    return {
      label: study.label,
      RE_loo: looMeta.RE,
      tau2_loo: looMeta.tau2,
      stdResidual: r,
      DFBETA: dfbeta,
      deltaTau2,
      outlier,
      influential,
      hat,
      cookD,
      highLeverage,
      highCookD
    };
  });
}

// ================= SUBGROUP =================
export function subgroupAnalysis(studies, method="REML", ciMethod="normal") {
  const valid = studies.filter(s => s && isFinite(s.yi) && isFinite(s.vi) && s.group != null && s.group !== "");
  if(valid.length < 2) return null;
  const groups = {};
  valid.forEach(s => { const g = String(s.group).trim(); if(!g) return; if(!groups[g]) groups[g]=[]; groups[g].push(s); });
  const groupNames = Object.keys(groups);
  if(groupNames.length < 2) return null;
  const overall = meta(valid, method, ciMethod);
  const results = {};
  let Qwithin_sum = 0;
  groupNames.forEach(g => {
    const groupStudies = groups[g];
    let res;
    if(groupStudies.length === 1){
      const s = groupStudies[0];
      res = {
        RE: s.yi,
        se: Math.sqrt(s.vi),
        ciLow: s.yi - Z_95 * Math.sqrt(s.vi),
        ciHigh: s.yi + Z_95 * Math.sqrt(s.vi),
        tau2: 0,
        I2: 0,
        Q: 0
      };
    } else {
      res = meta(groupStudies, method, ciMethod);
    }
    results[g] = {
      k: groupStudies.length,
      y: res.RE,
      se: res.se ?? Math.sqrt(res.vi ?? 0),
      ci: { lb: res.ciLow, ub: res.ciHigh },
      tau2: res.tau2 ?? 0,
      I2: res.I2 ?? 0
    };
    if(isFinite(res.Q)) Qwithin_sum += res.Q;
  });
  let Qbetween = overall.Q - Qwithin_sum;
  if(!isFinite(Qbetween) || Qbetween < 0) Qbetween = 0;
  const df = groupNames.length - 1;
  const p = 1 - chiSquareCDF(Qbetween, df);
  return { groups: results, Qbetween, df, p, k: valid.length, G: groupNames.length };
}

// ================= Q-PROFILE HETEROGENEITY CIs =================
// Weighted Q statistic as a function of τ². Monotone decreasing in τ²;
// equals Q_FE when τ² = 0.
function qProfile(tau2, studies) {
  const w  = studies.map(d => 1 / (d.vi + tau2));
  const W  = w.reduce((a, b) => a + b, 0);
  const mu = studies.reduce((s, d, i) => s + w[i] * d.yi, 0) / W;
  return studies.reduce((s, d, i) => s + w[i] * (d.yi - mu) ** 2, 0);
}

// Q-profile 95% CI for τ², I², H² (Viechtbauer 2007).
// Inverts the Q-profile statistic against chi-square quantiles.
//
// Returns: { tauCI: [lo, hi], I2CI: [lo, hi], H2CI: [lo, hi] }
//   tauCI  — 95% CI for τ² on the variance scale
//   I2CI   — corresponding I² (%) bounds
//   H2CI   — corresponding H² bounds
export function heterogeneityCIs(studies, tau2, alpha = 0.05) {
  const k = studies.length;
  if (k < 2) return { tauCI: [0, NaN], I2CI: [0, NaN], H2CI: [1, NaN] };

  const df    = k - 1;
  const chiLo = chiSquareQuantile(alpha / 2,       df);  // lower quantile (small x)
  const chiHi = chiSquareQuantile(1 - alpha / 2,   df);  // upper quantile (large x)

  const Q_FE = qProfile(0, studies);

  // --- Lower τ² bound: Q_τ(τ²_lo) = chiHi ---
  // Q is decreasing; if Q_FE ≤ chiHi, no positive solution → τ²_lo = 0.
  let tau2_lo;
  if (Q_FE <= chiHi) {
    tau2_lo = 0;
  } else {
    let lo = 0, hi = Math.max(tau2, 1);
    while (qProfile(hi, studies) > chiHi) hi *= 2;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      if (qProfile(mid, studies) > chiHi) lo = mid; else hi = mid;
    }
    tau2_lo = (lo + hi) / 2;
  }

  // --- Upper τ² bound: Q_τ(τ²_hi) = chiLo ---
  // Q → 0 as τ² → ∞, so a solution always exists when chiLo > 0.
  let tau2_hi;
  if (!isFinite(chiLo) || chiLo <= 0) {
    tau2_hi = Infinity;
  } else {
    let lo = tau2_lo, hi = Math.max(tau2, 1);
    while (qProfile(hi, studies) > chiLo) hi *= 2;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      if (qProfile(mid, studies) > chiLo) lo = mid; else hi = mid;
    }
    tau2_hi = (lo + hi) / 2;
  }

  // --- I² and H² CIs ---
  // σ²_typical = (k-1) / Σ(1/vi)  [FE-weight-based typical sampling variance]
  const sumWFE = studies.reduce((s, d) => s + 1 / d.vi, 0);
  const sigma2 = df / sumWFE;

  const toI2 = t => 100 * t / (t + sigma2);
  const toH2 = t => t / sigma2 + 1;

  return {
    tauCI: [tau2_lo, tau2_hi],
    I2CI:  [toI2(tau2_lo), isFinite(tau2_hi) ? toI2(tau2_hi) : 100],
    H2CI:  [toH2(tau2_lo), isFinite(tau2_hi) ? toH2(tau2_hi) : Infinity]
  };
}

// ================ META-ANALYSIS ===============
export function meta(studies, method="DL", ciMethod="normal") {
  const k = studies.length;
  if(k === 0){
    return { FE: NaN, seFE: NaN, RE: NaN, seRE: NaN, tau2:0, Q:NaN, df:0, I2:0, predLow:NaN, predHigh:NaN, ciLow:NaN, ciHigh:NaN, crit:NaN, stat:NaN, pval:NaN, dist:null };
  }

  // ---------- FIXED EFFECT ----------
  const wFE = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W = d3.sum(wFE);
  const FE = W > 0 ? d3.sum(studies.map((d,i)=>d.yi*wFE[i]))/W : NaN;
  const seFE = W > 0 ? Math.sqrt(1/W) : NaN;

  let Q = 0;
  for(let i=0;i<k;i++){ Q += wFE[i]*Math.pow(studies[i].yi - FE,2); }
  const dfQ = k-1;
  let I2 = 0;
  if(Q>dfQ && Q>0) I2 = ((Q-dfQ)/Q)*100;
  I2 = Math.max(0, Math.min(100,I2));

  let tau2 = 0;
	if      (method === "REML") tau2 = tau2_REML(studies, 1e-12, 500);
	else if (method === "PM")     tau2 = tau2_PM(studies);
	else if (method === "ML")     tau2 = tau2_ML(studies);
	else if (method === "HS")     tau2 = tau2_HS(studies);
	else if (method === "HE")     tau2 = tau2_HE(studies);
	else if (method === "SJ")     tau2 = tau2_SJ(studies);
	else if (method === "GENQ")   tau2 = tau2_GENQ(studies);
	else if (method === "SQGENQ") tau2 = tau2_SQGENQ(studies);
	else if (method === "DLIT")   tau2 = tau2_DLIT(studies);
	else if (method === "EBLUP")  tau2 = tau2_REML(studies, 1e-12, 500);
	else if (method === "HSk")    tau2 = tau2_HSk(studies);
	else { // DL fallback
		const sumW2 = d3.sum(wFE.map(w=>w*w));
		const C = W - (sumW2/W);
		tau2 = C>0 ? Math.max(0, (Q-dfQ)/C) : 0;
	}

  // ---------- RANDOM EFFECT ----------
  const wRE = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
  const WRE = d3.sum(wRE);
  const RE = WRE>0 ? d3.sum(studies.map((d,i)=>d.yi*wRE[i]))/WRE : NaN;
  const seRE_base = WRE>0 ? Math.sqrt(1/WRE) : NaN;  // used for prediction interval
  let seRE = seRE_base;

	let crit, stat, pval, dist;

	if (ciMethod === "KH" && k > 1) {
	  // --- Knapp-Hartung ---
	  const df = k - 1;

	  let sum = 0;
	  for (let i = 0; i < k; i++) {
		sum += wRE[i] * Math.pow(studies[i].yi - RE, 2);
	  }

	  const varKH = sum / (df * WRE);
	  seRE = Math.sqrt(Math.max(varKH, 0));

	  crit = tCritical(df);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

	} else if (ciMethod === "t" && k > 1) {
	  // --- t-distribution (no variance adjustment) ---
	  const df = k - 1;

	  crit = tCritical(df);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

	} else {
	  // --- Normal (Wald) ---
	  crit = Z_95;
	  stat = RE / seRE;
	  dist = "z";
	  pval = k <= 1 ? NaN : 2 * (1 - normalCDF(Math.abs(stat)));
	}

  // Prediction interval: Higgins et al. (2009), t_{k-2} quantile.
  // Requires k >= 3 (df = k-2 >= 1). Uses base seRE, not KH-adjusted.
  const predVar = seRE_base * seRE_base + tau2;
  const predCrit = k >= 3 ? tCritical(k - 2) : NaN;

  // Q-profile CIs for τ², I², H²
  const hetCI = heterogeneityCIs(studies, tau2);

  return {
    FE,
    seFE,
    RE,
    seRE,
    tau2,
    Q,
    df: dfQ,
    I2,
    tauCI:  hetCI.tauCI,
    I2CI:   hetCI.I2CI,
    H2CI:   hetCI.H2CI,
    predLow:  isFinite(predCrit) ? RE - predCrit * Math.sqrt(predVar) : NaN,
    predHigh: isFinite(predCrit) ? RE + predCrit * Math.sqrt(predVar) : NaN,
    ciLow: RE - crit*seRE,
    ciHigh: RE + crit*seRE,
    crit,
    stat,
    pval,
    dist
  };
}

// ================= META-REGRESSION DESIGN MATRIX =================
// Builds the k×p design matrix X for meta-regression.
//
// moderators: array of { key: string, type: "continuous" | "categorical" }
//   key  — property name on each study object
//   type — "continuous" (read as number) or "categorical" (dummy-coded)
//
// Returns:
//   X         — k×p row-major matrix (array of k rows, each a p-length array)
//   colNames  — p column labels; first is always "intercept"
//   refLevels — maps each categorical key to its (dropped) reference level
//   validMask — k booleans; true when all entries in that row are finite
//   k, p      — matrix dimensions
export function buildDesignMatrix(studies, moderators = []) {
  const k = studies.length;

  // Build column-by-column, then transpose to row-major at the end.
  const columns  = [Array(k).fill(1)];  // intercept
  const colNames = ["intercept"];
  const refLevels = {};

  for (const { key, type } of moderators) {
    const raw = studies.map(s => s[key]);

    if (type === "categorical") {
      // Unique non-null levels, sorted so the reference is deterministic.
      const levels = [...new Set(raw.filter(v => v != null && v !== ""))].sort();
      if (levels.length < 2) continue;  // degenerate — nothing to dummy-code

      refLevels[key] = levels[0];

      for (const level of levels.slice(1)) {
        // Missing values become NaN so validMask catches them.
        columns.push(raw.map(v => (v == null || v === "") ? NaN : (v === level ? 1 : 0)));
        colNames.push(`${key}:${level}`);
      }

    } else {
      // Continuous: coerce to number; non-numeric (including undefined) → NaN.
      columns.push(raw.map(v => +v));
      colNames.push(key);
    }
  }

  const p = columns.length;

  // Transpose: X[i][j] = study i, column j.
  const X = Array.from({ length: k }, (_, i) => columns.map(col => col[i]));

  // A row is valid only when every entry is finite (no NaN / ±Infinity).
  const validMask = X.map(row => row.every(isFinite));

  return { X, colNames, refLevels, validMask, k, p };
}

// ================= WEIGHTED LEAST SQUARES =================
// Fits y = X·beta by WLS with weights w = 1/(vi + tau²).
// Called at every tau² iteration inside metaRegression, so kept lean.
//
// X    — k×p row-major design matrix (from buildDesignMatrix)
// y    — k-length array of effect sizes
// w    — k-length array of weights
//
// Returns:
//   beta          — p-length coefficient vector
//   vcov          — p×p variance-covariance matrix = (X'WX)⁻¹
//   rankDeficient — true when X'WX is singular (results are NaN-filled)
export function wls(X, y, w) {
  const k = X.length;
  const p = X[0].length;

  // --- X'WX (p×p, symmetric) and X'Wy (p-vector) ---
  const XtWX = Array.from({ length: p }, () => Array(p).fill(0));
  const XtWy = Array(p).fill(0);

  for (let i = 0; i < k; i++) {
    const wi = w[i];
    for (let j = 0; j < p; j++) {
      XtWy[j] += wi * X[i][j] * y[i];
      for (let l = j; l < p; l++) {            // exploit symmetry
        const v = wi * X[i][j] * X[i][l];
        XtWX[j][l] += v;
        if (l !== j) XtWX[l][j] += v;
      }
    }
  }

  // --- Invert X'WX ---
  const inv = matInverse(XtWX);
  if (inv === null) {
    return {
      beta: Array(p).fill(NaN),
      vcov: Array.from({ length: p }, () => Array(p).fill(NaN)),
      rankDeficient: true
    };
  }

  // --- beta = (X'WX)⁻¹ · X'Wy ---
  const beta = inv.map(row => row.reduce((s, v, j) => s + v * XtWy[j], 0));

  return { beta, vcov: inv, rankDeficient: false };
}

// Gauss-Jordan elimination with partial pivoting.
// Returns the inverse of the p×p matrix A, or null if singular.
// Not exported — used only by wls.
function matInverse(A) {
  const p = A.length;

  // Augment A with the identity: M = [A | I]
  const M = A.map((row, i) => {
    const aug = row.slice();
    for (let j = 0; j < p; j++) aug.push(i === j ? 1 : 0);
    return aug;
  });

  for (let col = 0; col < p; col++) {
    // Partial pivoting: swap in the row with the largest absolute value
    let pivotRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-14) return null;   // singular or near-singular

    // Scale the pivot row so the leading entry becomes 1
    for (let j = col; j < 2 * p; j++) M[col][j] /= pivot;

    // Zero out every other row in this column
    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const f = M[row][col];
      if (f === 0) continue;
      for (let j = col; j < 2 * p; j++) M[row][j] -= f * M[col][j];
    }
  }

  // The right half of M is now A⁻¹
  return M.map(row => row.slice(p));
}

// ================= TAU² FOR META-REGRESSION =================

function dot(a, b) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function quadForm(A, x) {
  return dot(x, A.map(row => dot(row, x)));
}

function tau2Reg_DL(yi, vi, X) {
  const k = vi.length, p = X[0].length;
  const df = k - p;
  if (df <= 0) return 0;
  const w0 = vi.map(v => 1 / v);
  const { beta, vcov, rankDeficient } = wls(X, yi, w0);
  if (rankDeficient) return 0;
  const QE = yi.reduce((s, y, i) => {
    const e = y - dot(X[i], beta);
    return s + w0[i] * e * e;
  }, 0);
  const c = w0.reduce((s, wi, i) => s + wi * (1 - wi * quadForm(vcov, X[i])), 0);
  return c > 0 ? Math.max(0, (QE - df) / c) : 0;
}

function tau2Reg_REML(yi, vi, X, tol = REML_TOL, maxIter = 100) {
  const k = vi.length, p = X[0].length;
  if (k - p <= 0) return 0;
  let tau2 = tau2Reg_DL(yi, vi, X);
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, vcov, rankDeficient } = wls(X, yi, w);
    if (rankDeficient) break;
    const h = X.map((xi, i) => w[i] * quadForm(vcov, xi));
    const e = yi.map((y, i) => y - dot(X[i], beta));
    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const pi = w[i] * (1 - h[i]);
      score += w[i] * w[i] * e[i] * e[i] - pi;
      info  += w[i] * pi;
    }
    if (info <= 0) break;
    let step = score / info;
    let newTau2 = tau2 + step;
    let sh = 0;
    while (newTau2 < 0 && sh++ < 20) { step /= 2; newTau2 = tau2 + step; }
    newTau2 = Math.max(0, newTau2);
    if (Math.abs(newTau2 - tau2) < tol) { tau2 = newTau2; break; }
    tau2 = newTau2;
  }
  return tau2;
}

function tau2Reg_PM(yi, vi, X, tol = REML_TOL, maxIter = 100) {
  const k = vi.length, p = X[0].length;
  const df = k - p;
  if (df <= 0) return 0;
  let tau2 = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, rankDeficient } = wls(X, yi, w);
    if (rankDeficient) break;
    const QE = yi.reduce((s, y, i) => {
      const e = y - dot(X[i], beta);
      return s + w[i] * e * e;
    }, 0);
    const sumW = w.reduce((a, b) => a + b, 0);
    const newTau2 = Math.max(0, tau2 + (QE - df) / sumW);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }
  return tau2;
}

// HS regression: same as DL but denominator is Σwᵢ (FE weights)
function tau2Reg_HS(yi, vi, X) {
  const k = vi.length, p = X[0].length;
  const df = k - p;
  if (df <= 0) return 0;
  const w0 = vi.map(v => 1 / v);
  const { beta, rankDeficient } = wls(X, yi, w0);
  if (rankDeficient) return 0;
  const QE  = yi.reduce((s, y, i) => s + w0[i] * (y - dot(X[i], beta)) ** 2, 0);
  const sumW = w0.reduce((a, b) => a + b, 0);
  return sumW > 0 ? Math.max(0, (QE - df) / sumW) : 0;
}

// HE regression: unweighted — residuals from unweighted OLS fit
function tau2Reg_HE(yi, vi, X) {
  const k = vi.length, p = X[0].length;
  const df = k - p;
  if (df <= 0) return 0;
  // Unweighted OLS: wᵢ = 1 for all i
  const w1 = vi.map(() => 1);
  const { beta, rankDeficient } = wls(X, yi, w1);
  if (rankDeficient) return 0;
  const SS   = yi.reduce((s, y, i) => s + (y - dot(X[i], beta)) ** 2, 0);
  const meanV = vi.reduce((a, b) => a + b, 0) / k;
  return Math.max(0, SS / df - meanV);
}

// SJ regression: iterative, seeded from unweighted residual variance
function tau2Reg_SJ(yi, vi, X, tol = REML_TOL, maxIter = 200) {
  const k = vi.length, p = X[0].length;
  if (k - p <= 0) return 0;
  // Seed from unweighted OLS residuals
  const w1 = vi.map(() => 1);
  const { beta: beta0, rankDeficient } = wls(X, yi, w1);
  if (rankDeficient) return 0;
  let tau2 = yi.reduce((s, y, i) => s + (y - dot(X[i], beta0)) ** 2, 0) / k;
  if (tau2 === 0) return 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const w  = vi.map(v => 1 / (v + tau2));
    const { beta, rankDeficient: rd } = wls(X, yi, w);
    if (rd) break;
    const newTau2 = yi.reduce((s, y, i) => {
      return s + vi[i] * (y - dot(X[i], beta)) ** 2 / (vi[i] + tau2);
    }, 0) / k;
    if (Math.abs(newTau2 - tau2) < tol) return Math.max(0, newTau2);
    tau2 = Math.max(0, newTau2);
  }
  return tau2;
}

// ML regression: Fisher scoring without leverage correction
function tau2Reg_ML(yi, vi, X, tol = REML_TOL, maxIter = 100) {
  const k = vi.length, p = X[0].length;
  if (k - p <= 0) return 0;
  let tau2 = tau2Reg_DL(yi, vi, X);
  for (let iter = 0; iter < maxIter; iter++) {
    const w = vi.map(v => 1 / (v + tau2));
    const { beta, rankDeficient } = wls(X, yi, w);
    if (rankDeficient) break;
    const e = yi.map((y, i) => y - dot(X[i], beta));
    let score = 0, info = 0;
    for (let i = 0; i < k; i++) {
      const vi_tau = vi[i] + tau2;
      score += e[i] * e[i] / (vi_tau * vi_tau) - 1 / vi_tau;
      info  += 1 / (vi_tau * vi_tau);
    }
    if (info <= 0) break;
    let step = score / info;
    let newTau2 = tau2 + step;
    let sh = 0;
    while (newTau2 < 0 && sh++ < 20) { step /= 2; newTau2 = tau2 + step; }
    newTau2 = Math.max(0, newTau2);
    if (Math.abs(newTau2 - tau2) < tol) { tau2 = newTau2; break; }
    tau2 = newTau2;
  }
  return tau2;
}

export function tau2_metaReg(yi, vi, X, method = "REML", tol = REML_TOL, maxIter = 100) {
  if (method === "REML") return tau2Reg_REML(yi, vi, X, tol, maxIter);
  if (method === "PM")   return tau2Reg_PM  (yi, vi, X, tol, maxIter);
  if (method === "ML")   return tau2Reg_ML  (yi, vi, X, tol, maxIter);
  if (method === "HS")   return tau2Reg_HS  (yi, vi, X);
  if (method === "HE")   return tau2Reg_HE  (yi, vi, X);
  if (method === "SJ")   return tau2Reg_SJ  (yi, vi, X, tol, maxIter);
  return tau2Reg_DL(yi, vi, X);
}

// ================= META-REGRESSION =================
// Fits a weighted mixed-effects meta-regression model.
//
// Parameters:
//   studies    — array of study objects, each with { yi, vi, ... }
//   moderators — array of { key, type } passed to buildDesignMatrix
//   method     — tau² estimator: "REML" (default), "DL", "PM"
//   ciMethod   — "normal" (default) or "KH" (Knapp-Hartung)
//
// Returns:
//   beta       — p-vector of coefficients
//   se         — p-vector of standard errors
//   zval/tval  — test statistics (z for normal, t for KH)
//   pval       — two-tailed p-values
//   ci         — [ [lo,hi], ... ] per coefficient
//   tau2       — estimated between-study variance
//   QE         — residual heterogeneity statistic
//   QEdf       — df for QE (k − p)
//   QEp        — p-value for QE (chi-squared)
//   QM         — omnibus test for moderators (Wald chi-sq or F)
//   QMdf       — df for QM (p − 1, i.e. excluding intercept)
//   QMp        — p-value for QM
//   I2         — residual I² (%)
//   colNames   — column names matching beta
//   k          — number of studies used
//   p          — number of parameters
//   rankDeficient — true if design matrix was singular
export function metaRegression(studies, moderators = [], method = "REML", ciMethod = "normal") {
  // Filter to studies with finite yi and vi
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;

  const { X, colNames, validMask, p } = buildDesignMatrix(valid, moderators);

  // Further filter rows where all moderator values are finite
  const rows   = valid.filter((_, i) => validMask[i]);
  const Xf     = X.filter((_, i) => validMask[i]);
  const kf     = rows.length;
  const yi     = rows.map(s => s.yi);
  const vi     = rows.map(s => s.vi);

  const empty = {
    beta: Array(p).fill(NaN), se: Array(p).fill(NaN),
    zval: Array(p).fill(NaN), pval: Array(p).fill(NaN),
    ci: Array(p).fill([NaN, NaN]),
    tau2: NaN, QE: NaN, QEdf: kf - p, QEp: NaN,
    QM: NaN, QMdf: p - 1, QMp: NaN, I2: NaN,
    colNames, k: kf, p, rankDeficient: true
  };

  if (kf < p + 1) return empty;

  // ---- tau² ----
  const tau2 = tau2_metaReg(yi, vi, Xf, method);

  // ---- pseudo-R² (proportion of heterogeneity explained by moderators) ----
  // Only meaningful when there are actual moderators (p > 1).
  const X0   = Xf.map(() => [1]);  // intercept-only design matrix
  const tau2_0 = p > 1 ? tau2_metaReg(yi, vi, X0, method) : tau2;
  const R2 = p > 1 && tau2_0 > 0 ? Math.max(0, (tau2_0 - tau2) / tau2_0) : NaN;

  // ---- WLS with RE weights ----
  const w = vi.map(v => 1 / (v + tau2));
  const { beta, vcov, rankDeficient } = wls(Xf, yi, w);
  if (rankDeficient) return { ...empty, rankDeficient: true };

  // ---- residuals and QE ----
  const e   = yi.map((y, i) => y - dot(Xf[i], beta));
  const QE  = e.reduce((s, ei, i) => s + w[i] * ei * ei, 0);
  const QEdf = kf - p;
  const QEp  = QEdf > 0 ? 1 - chiSquareCDF(QE, QEdf) : NaN;

  // ---- I² (residual) ----
  // Use tau2/(tau2 + typical_vi) so I² is consistent with tau2 (avoids I²=0
  // when tau2>0, which happens with REML when QE≤QEdf).
  // typical_vi = QEdf/c where c = Σw0ᵢ(1−hᵢ) is the FE-leverage-adjusted
  // denominator (same as used in the DL estimator for regression).
  const w0 = vi.map(v => 1 / v);
  const { vcov: vcov0, rankDeficient: rd0 } = wls(Xf, yi, w0);
  let I2 = 0;
  if (!rd0 && QEdf > 0) {
    const c = w0.reduce((s, wi, i) => s + wi * (1 - wi * quadForm(vcov0, Xf[i])), 0);
    if (c > 0) I2 = Math.max(0, tau2 / (tau2 + QEdf / c) * 100);
  }

  // ---- SE and CIs for beta ----
  // s2: KH variance inflation factor (Knapp & Hartung 2003, eq. 8)
  const useKH = ciMethod === "KH" && kf > p && QEdf > 0;
  const s2 = useKH ? Math.max(1, QE / QEdf) : 1;

  let se, crit, zval, pval, ci, dist;

  if (useKH) {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j]) * s2));
    crit  = tCritical(QEdf);
    dist  = "t";
    zval  = beta.map((b, j) => b / se[j]);
    pval  = zval.map(t => 2 * (1 - tCDF(Math.abs(t), QEdf)));
    ci    = beta.map((b, j) => [b - crit * se[j], b + crit * se[j]]);
  } else {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j])));
    crit  = Z_95;
    dist  = "z";
    zval  = beta.map((b, j) => b / se[j]);
    pval  = zval.map(z => 2 * (1 - normalCDF(Math.abs(z))));
    ci    = beta.map((b, j) => [b - crit * se[j], b + crit * se[j]]);
  }

  // ---- Omnibus test for moderators (QM) ----
  // Normal: Wald chi-sq on beta[1..p-1] with p-1 df.
  // KH:     F = QM_chi / (s2 * (p-1))  with F(p-1, k-p) distribution.
  let QM = NaN, QMdf = p - 1, QMp = NaN;
  if (p > 1) {
    const idx = Array.from({ length: p - 1 }, (_, i) => i + 1);
    const betaMod = idx.map(j => beta[j]);
    const vcovMod = idx.map(r => idx.map(c => vcov[r][c]));
    const invMod  = matInverse(vcovMod);
    if (invMod !== null) {
      const QMchi = betaMod.reduce((s, bi, r) =>
        s + bi * invMod[r].reduce((ss, v, c) => ss + v * betaMod[c], 0), 0);
      if (useKH) {
        QM  = QMchi / (s2 * QMdf);   // F-statistic
        QMp = 1 - fCDF(QM, QMdf, QEdf);
      } else {
        QM  = QMchi;                   // chi-sq statistic
        QMp = 1 - chiSquareCDF(QM, QMdf);
      }
    }
  }

  const fitted      = Xf.map(xi => dot(xi, beta));
  const stdResiduals = e.map((ei, i) => ei / Math.sqrt(vi[i] + tau2));

  return {
    beta, se, zval, pval, ci, vcov, crit, s2,
    tau2, tau2_0, R2,
    QE, QEdf, QEp,
    QM, QMdf, QMp, QMdist: useKH ? "F" : "chi2",
    I2, colNames, k: kf, p, rankDeficient: false, dist,
    fitted, residuals: e, stdResiduals,
    labels: rows.map(s => s.label || ""),
    studiesUsed: rows,   // exact set used in the fit (for bubble plot)
    yi, vi    // pass through for display
  };
}

// ================= CUMULATIVE META-ANALYSIS =================
// Runs meta() on the first k studies for k = 1 … studies.length,
// returning a sequence of pooled estimates in the chosen accumulation order.
//
// Parameters:
//   studies   — array already sorted into the desired accumulation order;
//               each entry must have { yi, vi, label } set (post-compute)
//   method    — τ² estimator passed through to meta()
//   ciMethod  — CI method passed through to meta()
//
// Returns an array of k objects:
//   { k, addedLabel, RE, seRE, ciLow, ciHigh, tau2, I2 }
//
// Note: for k = 1, meta() returns τ² = 0 and uses a normal CI with
// crit = 1.96, matching the behaviour of a single-study analysis.
export function cumulativeMeta(studies, method = "DL", ciMethod = "normal") {
  return studies.map((s, idx) => {
    const prefix = studies.slice(0, idx + 1);
    const m = meta(prefix, method, ciMethod);
    return {
      k:          idx + 1,
      addedLabel: s.label ?? `Study ${idx + 1}`,
      RE:         m.RE,
      seRE:       m.seRE,
      ciLow:      m.ciLow,
      ciHigh:     m.ciHigh,
      tau2:       m.tau2,
      I2:         m.I2
    };
  });
}

// ================= LEAVE-ONE-OUT SENSITIVITY =================
// Removes each study in turn and re-runs the meta-analysis on the remaining
// k−1 studies.  Requires at least 3 studies (returns empty rows otherwise).
//
// Returns:
//   full — meta() result for the complete set
//   rows — one entry per study:
//     { label, estimate, lb, ub, tau2, i2, pval, significant }
//   where `significant` reflects whether the leave-one-out result is
//   statistically significant at p < 0.05.  The rendering layer can compare
//   this against `full.pval < 0.05` to flag significance changes.
export function leaveOneOut(studies, method = "DL", ciMethod = "normal", precomputedFull = null) {
  const full = precomputedFull ?? meta(studies, method, ciMethod);
  if (studies.length < 3) return { full, rows: [] };

  const rows = studies.map((omitted, omitIdx) => {
    const subset = studies.filter((_, i) => i !== omitIdx);
    const m = meta(subset, method, ciMethod);
    return {
      label:       omitted.label ?? `Study ${omitIdx + 1}`,
      estimate:    m.RE,
      lb:          m.ciLow,
      ub:          m.ciHigh,
      tau2:        m.tau2,
      i2:          m.I2,
      pval:        m.pval,
      significant: m.pval < 0.05,
    };
  });

  return { full, rows };
}

// ================= ESTIMATOR COMPARISON =================
// Runs the meta-analysis with every available τ² estimator and returns the
// results side-by-side so the analyst can judge estimator sensitivity.
//
// Returns an array of 7 entries (one per method):
//   { method, estimate, lb, ub, tau2, i2 }
export function estimatorComparison(studies, ciMethod = "normal") {
  const methods = ["DL", "REML", "PM", "ML", "HS", "HE", "SJ", "GENQ", "SQGENQ", "DLIT", "EBLUP", "HSk"];
  return methods.map(method => {
    const m = meta(studies, method, ciMethod);
    return {
      method,
      estimate: m.RE,
      lb:       m.ciLow,
      ub:       m.ciHigh,
      tau2:     m.tau2,
      i2:       m.I2,
    };
  });
}