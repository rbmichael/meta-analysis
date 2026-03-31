// =============================================================================
// analysis.js — Core statistical engine
// =============================================================================
// Responsible for all numerical computation that sits above the per-study
// effect-size level.  profiles.js computes each study's yi/vi; this module
// takes those values and produces pooled estimates, heterogeneity statistics,
// confidence intervals, and diagnostic tests.
//
// Main exports
// ------------
//   compute(studies, type)
//     Dispatches per-study effect-size computation by effect type.
//     Returns the studies array with yi, vi, se, w appended to each row.
//
//   meta(studies, method, ciMethod)
//     Fits a random-effects (and fixed-effect) model.
//     Returns { FE, seFE, RE, seRE, tau2, Q, df, I2, ciLow, ciHigh,
//               predLow, predHigh, crit, stat, pval, dist, tauCI, I2CI, H2CI }.
//
//   tau2_DL / tau2_REML / tau2_ML / tau2_PM / tau2_HS / tau2_HE /
//   tau2_SJ / tau2_GENQ
//     Standalone τ² estimators; each accepts studies[] and returns a scalar.
//     Four additional estimators (DLIT, HSk, SQGENQ, EBLUP) are retained in
//     the codebase but removed from the UI — see individual comments.
//
//   eggerTest / beggTest / fatPetTest / harbordTest / petersTest /
//   deeksTest / rueckerTest
//     Publication-bias tests.  Each accepts studies[] (and m where needed)
//     and returns an object with slope, intercept, z/t, and p-value fields.
//
//   failSafeN(studies, alpha, target)
//     Rosenthal and Orwin fail-safe N.
//
//   heterogeneityCIs(studies, method)
//     Profile-likelihood CIs for τ², I², and H².
//
//   trimFill (re-exported from trimfill.js via analysis pipeline)
//
//   influenceDiagnostics / leaveOneOut / cumulativeMeta /
//   subgroupAnalysis / metaRegression / estimatorComparison
//     Sensitivity, influence, and moderator-analysis functions.
//
//   baujat(studies)
//     Baujat diagnostic: per-study contribution to Cochran's Q (x) and
//     influence on the FE pooled estimate (y).  All quantities are analytical
//     (no iterative leave-one-out meta() calls required).
//
// Dependencies: utils.js, constants.js, profiles.js
// =============================================================================

import { tCritical, normalCDF, normalQuantile, tCDF, chiSquareCDF, chiSquareQuantile, fCDF, hedgesG, parseCounts, gorFromCounts, tetrachoricFromCounts } from "./utils.js";
import { MIN_VAR, REML_TOL, BISECTION_ITERS, Z_95 } from "./constants.js";
import { validateStudy } from "./profiles.js";

// ================= DYNAMIC COMPUTE =================
// -----------------------------------------------------------------------------
// compute(s, type, options) → study object
// -----------------------------------------------------------------------------
// Converts one study's raw input fields into the canonical (yi, vi) pair used
// by every downstream statistical function.
//
// Parameters
// ----------
//   s       — raw study object; required fields vary by effect type (see below)
//   type    — effect-type string (e.g. "SMD", "OR", "HR"); if falsy, auto-
//             detected from the fields present in s (MD for continuous inputs,
//             OR for 2×2 count inputs, otherwise a warning + NaN return)
//   options — passed through to hedgesG() for SMD (e.g. { correct: false } to
//             skip the small-sample J correction)
//
// Return value
// ------------
//   A spread copy of s augmented with:
//     yi   — effect size on the analysis scale (log for OR/RR/HR/IRR/CVR/VR/
//             ROM/IR/MNLN/ZCOR/ZPCOR; Fisher-z for ZCOR/ZPCOR; raw otherwise)
//     vi   — sampling variance (floored at MIN_VAR = 1e-10 to prevent division
//             by zero in downstream weighting)
//     se   — √vi
//     w    — 1/vi (inverse-variance weight)
//   Plus type-specific aliases used by back-transform / display code:
//     md, varMD — raw effect and its variance (set for MD, SMD, SMDH, paired,
//                 SMCC, GENERIC)
//
//   If validation fails or inputs yield non-finite results the function returns
//   { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 } so that meta() can safely skip
//   the study without crashing.
//
// Effect types handled (in dispatch order)
// -----------------------------------------
//   Binary 2×2      OR, RR, RD       (0.5 continuity correction for OR/RR)
//   Generalised OR  GOR              (ordered-category counts via gorFromCounts)
//   Single mean     MN               yi = m
//   Single mean log MNLN             yi = log(m), delta-method vi
//   Continuous 2-grp SMD             Hedges g via hedgesG()
//                   SMDH             Heteroscedastic SMD (Bonett 2009)
//   Variability     CVR, VR          log scale
//   Paired          MD_paired        corr-adjusted variance (r fallback = 0.5)
//                   SMD_paired       SMCR (Morris 2008), Hedges correction
//                   SMCC             Change-score SD standardiser
//   Correlations    COR              raw r, vi = (1−r²)²/(n−1)
//                   ZCOR             Fisher z, vi = 1/(n−3)
//                   PCOR, ZPCOR      partial correlations (p covariates)
//                   PHI              2×2 phi coefficient
//                   RTET             tetrachoric r via tetrachoricFromCounts()
//   Proportions     PR, PLN, PLO, PAS, PFT
//   Time-to-event   HR               log scale; SE back-calculated from CI
//                   IRR              log scale; 0.5 correction for zero events
//                   IR               single-arm log rate
//   Generic         GENERIC          pass-through (yi, vi already on input)
//   Ratio of means  ROM              yi = log(m1/m2), delta-method vi
//   MD fallback     (anything else)  Welch-style vi = sd1²/n1 + sd2²/n2
// -----------------------------------------------------------------------------
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
		if (a === 0 && b === 0 && c === 0 && d === 0) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
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

  // ================= GENERALISED ODDS RATIO (GOR) =================
  if (type === "GOR") {
    const { es, var: v } = gorFromCounts(parseCounts(s.counts1), parseCounts(s.counts2));
    if (!isFinite(es) || !isFinite(v)) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
    const vi = Math.max(v, MIN_VAR);
    return { ...s, yi: es, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= SINGLE-GROUP MEAN (MN) =================
  if (type === "MN") {
    const vi = Math.max(s.sd ** 2 / s.n, MIN_VAR);
    return { ...s, yi: s.m, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= SINGLE-GROUP MEAN LOG-TRANSFORMED (MNLN) =================
  // yi = log(m);  vi = sd²/(n·m²)  — delta method for log(μ)
  if (type === "MNLN") {
    const vi = Math.max(s.sd ** 2 / (s.n * s.m ** 2), MIN_VAR);
    return { ...s, yi: Math.log(s.m), vi, se: Math.sqrt(vi), w: 1 / vi };
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

	  // Standardise by pre-test SD (SMCR per Morris 2008 / metafor).
	  const d = mean_change / sd_pre;

	  // Hedges correction
	  const df = n - 1;
	  const J = 1 - (3 / (4*df - 1));
	  const g = d * J;

	  // Variance: var(d) = 2(1−r)/n + d²/(2·df),  vi = J²·var(d)
	  const var_d = 2 * (1 - corr) / n + (d * d) / (2 * df);
	  const vi    = Math.max(J * J * var_d, MIN_VAR);

	  return {
		...s,
		yi: g,
		vi,
		se: Math.sqrt(vi),
		w: 1 / vi,
		md: g,
		varMD: var_d
	  };
	}

  // ================= SMCC — STANDARDIZED MEAN CHANGE (CHANGE-SCORE SD) =================
  // Variance: var(d) = 2(1−r)/n + d²/(2·df),  vi = J²·var(d)
  if (type === "SMCC") {
    const { m_pre, m_post, sd_pre, sd_post, n, r } = s;
    const corr     = isFinite(r) ? r : 0.5;
    const sd_change = Math.sqrt(sd_pre**2 + sd_post**2 - 2*corr*sd_pre*sd_post);
    const d        = (m_post - m_pre) / sd_change;
    const df       = n - 1;
    const J        = 1 - (3 / (4*df - 1));
    const g        = d * J;
    const var_d    = 2 * (1 - corr) / n + (d * d) / (2 * df);
    const vi       = Math.max(J * J * var_d, MIN_VAR);
    return { ...s, yi: g, vi, se: Math.sqrt(vi), w: 1 / vi, md: g, varMD: var_d };
  }

  // ================= CORRELATION =================
  if (type === "COR" || type === "ZCOR") {
    const { n } = s;
    const r = Math.max(-0.9999, Math.min(0.9999, s.r));  // clamp away from ±1 singularity

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

  // ================= PARTIAL CORRELATION =================
  // Inputs: r, n, p (number of covariates; default 0 reduces to COR/ZCOR)
  // PCOR:  yi = r,        vi = (1−r²)² / (n−p−1)
  // ZPCOR: yi = atanh(r), vi = 1 / (n−p−3)
  if (type === "PCOR" || type === "ZPCOR") {
    const { n } = s;
    const r = Math.max(-0.9999, Math.min(0.9999, s.r));  // clamp away from ±1 singularity
    const p = isFinite(s.p) ? s.p : 0;

    if (type === "PCOR") {
      const vi = Math.max((1 - r * r) ** 2 / (n - p - 1), MIN_VAR);
      return { ...s, yi: r, vi, se: Math.sqrt(vi), w: 1 / vi };
    }

    // ZPCOR
    const yi = Math.atanh(r);
    const vi = Math.max(1 / (n - p - 3), MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= PHI COEFFICIENT =================
  // yi = (ad−bc) / √((a+b)(c+d)(a+c)(b+d));  vi = (1−φ²)²/(N−1)
  if (type === "PHI") {
    const { a, b, c, d } = s;
    const N   = a + b + c + d;
    const phi = (a*d - b*c) / Math.sqrt((a+b)*(c+d)*(a+c)*(b+d));
    const vi  = Math.max((1 - phi*phi)**2 / (N - 1), MIN_VAR);
    return { ...s, yi: phi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= TETRACHORIC CORRELATION =================
  if (type === "RTET") {
    const { rho, var: v } = tetrachoricFromCounts(s.a, s.b, s.c, s.d);
    if (!isFinite(rho) || !isFinite(v)) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
    return { ...s, yi: rho, vi: v, se: Math.sqrt(v), w: 1 / v };
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
//
// NOTE: Removed from the UI dropdown (rarely used in practice; inflates the
// options list). Preserved here so it can be re-exposed if needed.
export function tau2_DLIT(studies, tol = REML_TOL, maxIter = 200) {
  const k = studies.length;
  if (k <= 1) return 0;

  let tau2 = tau2_GENQ(studies);  // seed from DL (GENQ with aᵢ=1/vᵢ is DL)

  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, W2 = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; W2 += wi * wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let Q = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      Q += r * r / (d.vi + tau2);
    }
    const c = W - W2 / W;
    const newTau2 = Math.max(0, (Q - (k - 1)) / c);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }

  return tau2;
}

// ================= HUNTER-SCHMIDT (small-sample corrected) TAU² =================
// HSk applies a k/(k−1) correction factor to the HS estimate to reduce
// downward bias in small samples.
//
// NOTE: Removed from the UI dropdown (niche use; standard HS is already
// available). Preserved here so it can be re-exposed if needed.
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
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let s = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      s += d.vi * r * r / (d.vi + tau2);
    }
    const newTau2 = s / k;
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
  let W0 = 0, W02 = 0, W0mu = 0;
  for (const d of studies) {
    const wi = 1 / d.vi;
    W0 += wi; W02 += wi * wi; W0mu += wi * d.yi;
  }
  const ybar0 = W0mu / W0;
  let Q0 = 0;
  for (const d of studies) Q0 += (d.yi - ybar0) ** 2 / d.vi;
  const c0 = W0 - W02 / W0;
  let tau2 = Math.max(0, (Q0 - (k - 1)) / c0);

  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let score = 0, info = 0;
    for (const d of studies) {
      const vi_tau = d.vi + tau2;
      const r = d.yi - mu;
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

// ================= LOG-LIKELIHOOD =================
// Full normal log-likelihood for the random-effects model:
//   L(μ, τ²) = −½ Σ [log(vᵢ + τ²) + (yᵢ − μ)² / (vᵢ + τ²)]
export function logLik(studies, mu, tau2) {
  let ll = 0;
  for (const d of studies) {
    const v = d.vi + tau2;
    ll -= 0.5 * (Math.log(v) + (d.yi - mu) ** 2 / v);
  }
  return ll;
}

// ================= PROFILE TAU² =================
// For a fixed pooled mean μ, find τ² ≥ 0 that maximises L(μ, τ²).
// Solves the 1-D score equation via bisection:
//   score(τ²) = ½ Σ [(yᵢ−μ)²/(vᵢ+τ²)² − 1/(vᵢ+τ²)] = 0
// The score is monotonically decreasing in τ², so bisection is reliable.
function profileTau2(studies, mu, tol = REML_TOL) {
  function score(t2) {
    let s = 0;
    for (const d of studies) {
      const v = d.vi + t2;
      s += (d.yi - mu) ** 2 / (v * v) - 1 / v;
    }
    return s;
  }

  // If score at boundary ≤ 0, the maximum is at τ² = 0.
  if (score(0) <= 0) return 0;

  // Find an upper bound where the score is negative.
  let hi = 1;
  while (score(hi) > 0) hi *= 2;

  // Bisect.
  let lo = 0;
  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (score(mid) > 0) lo = mid; else hi = mid;
    if (hi - lo < tol) break;
  }
  return (lo + hi) / 2;
}

// ================= PROFILE LIKELIHOOD CI =================
// CI for the pooled mean μ by inverting the likelihood ratio test:
//   { μ : 2[L(μ̂,τ̂²) − L_p(μ)] ≤ χ²_{1,1−α} }
// where L_p(μ) = L(μ, profileTau2(μ)).
// Always uses ML internally regardless of the selected τ² estimator.
// Returns [lower, upper].
export function profileLikCI(studies, alpha = 0.05) {
  const k = studies.length;
  if (k <= 1) return [NaN, NaN];

  const tau2ml = tau2_ML(studies);
  const w      = studies.map(d => 1 / (d.vi + tau2ml));
  const W      = w.reduce((a, b) => a + b, 0);
  const muHat  = studies.reduce((s, d, i) => s + w[i] * d.yi, 0) / W;
  const lMax   = logLik(studies, muHat, tau2ml);
  const cutoff = chiSquareQuantile(1 - alpha, 1) / 2;  // ½ χ²_{1,1−α}

  // plObj(mu) > 0 inside the CI, < 0 outside.
  function plObj(mu) {
    return logLik(studies, mu, profileTau2(studies, mu)) - (lMax - cutoff);
  }

  // Half-width of the search bracket: start at the Wald SE and expand if needed.
  const seApprox = Math.sqrt(1 / W);
  function findBound(sign) {
    let delta = 2 * seApprox;
    while (plObj(muHat + sign * delta) > 0) delta *= 2;
    let lo = 0, hi = delta;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      if (plObj(muHat + sign * mid) > 0) lo = mid; else hi = mid;
    }
    return muHat + sign * (lo + hi) / 2;
  }

  return [findBound(-1), findBound(+1)];
}

// ================= REML TAU² =================
// General-purpose REML estimator. Works for any effect type — studies must
// already have yi and vi set (as produced by compute()). Uses the DL
// estimator as the starting value and refines via Fisher scoring.
export function tau2_REML(studies, tol = REML_TOL, maxIter = 100) {

  const k = studies.length;
  if (k <= 1) return 0;

  // --- 1️⃣ Initial tau² (DL / HE estimator) ---
  let W0 = 0, W02 = 0, W0mu = 0;
  for (const d of studies) {
    const wi = 1 / d.vi;
    W0 += wi; W02 += wi * wi; W0mu += wi * d.yi;
  }
  const ybar = W0mu / W0;
  let Qseed = 0;
  for (const d of studies) Qseed += (d.yi - ybar) ** 2 / d.vi;
  const c = W0 - W02 / W0;
  let tau2 = Math.max(0, (Qseed - (k - 1)) / c);

  // --- 2️⃣ Fisher scoring iteration ---
  for (let iter = 0; iter < maxIter; iter++) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;

    let score = 0, info = 0;
    for (const d of studies) {
      const vi_tau = d.vi + tau2;
      const hi = 1 / (vi_tau * W);  // h[i] = w[i]/W = 1/(vi_tau·W)
      const ri = d.yi - mu;
      score += ri * ri / (vi_tau * vi_tau) - (1 - hi) / vi_tau;
      info  += (1 - hi) / (vi_tau * vi_tau);
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
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      W += wi; Wmu += wi * d.yi;
    }
    const mu = Wmu / W;
    let Q = 0;
    for (const d of studies) {
      const r = d.yi - mu;
      Q += r * r / (d.vi + tau2);
    }
    const newTau2 = Math.max(0, tau2 + (Q - (k - 1)) / W);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }

  return tau2;
}

// genqCore(studies, weights) → τ² estimate (≥ 0)
// -------------------------------------------------
// Generalised Q-statistic τ² estimator with caller-supplied weights aᵢ.
// Computes the weighted pooled mean yā, the weighted sum of squared deviations
// Qₐ, and the expected value of Qₐ under homogeneity (bₐ), then solves for τ²:
//
//   yā  = Σ(aᵢ yᵢ) / Σaᵢ
//   Qₐ  = Σ aᵢ(yᵢ − yā)²
//   bₐ  = ΣaᵢvᵢΣaᵢ − Σaᵢ²vᵢ) / Σaᵢ   (expected Qₐ under τ²=0)
//   cₐ  = Σaᵢ − Σaᵢ²/Σaᵢ
//   τ²  = max(0, (Qₐ − bₐ) / cₐ)
//
// Special cases (called via thin wrappers):
//   DL       — aᵢ = 1/vᵢ   (standard inverse-variance weights)
//   SQGENQ   — aᵢ = √(1/vᵢ) (square-root weights; rarely used, not in UI)
//
// Returns 0 when k ≤ 1 or cₐ ≤ 0 (degenerate design matrix).
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

// ================= SQUARE-ROOT GENQ (SQGENQ) TAU² =================
// Generalised Q-statistic estimator using square-root weights aᵢ = √(1/vᵢ)
// instead of the standard inverse-variance weights aᵢ = 1/vᵢ used by DL.
// Down-weights high-precision studies more aggressively than DL and is
// less sensitive to outlying within-study variances.
//
// NOTE: Removed from the UI dropdown (rarely preferred over DL or standard
// GENQ in practice). Available programmatically via meta("SQGENQ", ...) and
// included in estimatorComparison(). Preserved for completeness.
export function tau2_SQGENQ(studies) {
  const weights = studies.map(d => Math.sqrt(1 / d.vi));
  return genqCore(studies, weights);
}

// ================= EBLUP (no separate function — aliases REML) =================
// Empirical Bayes Linear Unbiased Predictor (EBLUP) produces the same τ²
// as REML when estimated by Fisher scoring in the standard normal-normal
// random-effects model.  The "EBLUP" label comes from the mixed-model
// framing (per-study effects uᵢ are treated as random deviates); "REML"
// refers to the estimation criterion on the marginal likelihood.  Both labels
// converge to the same numerical estimate, so the dispatch in meta() simply
// aliases "EBLUP" → tau2_REML.
//
// NOTE: Removed from the UI dropdown (redundant with REML; the EBLUP label
// appears in some multilevel / longitudinal software output and is retained
// here so that datasets using that terminology can still be dispatched
// correctly). Included in estimatorComparison() alongside the other methods.

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
  if(k < 3) return { intercept: NaN, slope: NaN, se: NaN, t: NaN, df: NaN, p: NaN };
  const Z = studies.map(d => d.yi / d.se);
  const X = studies.map(d => 1 / d.se);
  const meanX = X.reduce((a,b)=>a+b,0)/X.length, meanZ = Z.reduce((a,b)=>a+b,0)/Z.length;
  let num=0, den=0;
  for(let i=0;i<k;i++){ num += (X[i]-meanX)*(Z[i]-meanZ); den += (X[i]-meanX)**2; }
  const slope = num/den;
  const intercept = meanZ - slope*meanX;
  let rss=0;
  for(let i=0;i<k;i++){ rss += (Z[i] - (intercept + slope*X[i]))**2; }
  const df = k-2;
  const se = Math.sqrt(rss/df) * Math.sqrt(1/k + (meanX*meanX)/den);
  const t = intercept/se;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  return { intercept, slope, se, t, df, p };
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

  // Variance of S under H₀ with Kendall-Gibbons tie correction
  // (Kendall & Gibbons 1990 §3.3).
  // Var(S) = [k(k−1)(2k+5) − tieTermX − tieTermY] / 18
  // where tieTermZ = Σ t(t−1)(2t+5) over tie groups of size t in Z.
  const tieStats = vals => {
    const counts = new Map();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    let varTerm = 0, pairs = 0;
    for (const t of counts.values()) {
      if (t > 1) { varTerm += t * (t - 1) * (2 * t + 5); pairs += t * (t - 1) / 2; }
    }
    return { varTerm, pairs };
  };
  const tsX  = tieStats(adj);
  const tsY  = tieStats(valid.map(s => s.vi));
  const varS = (k * (k - 1) * (2 * k + 5) - tsX.varTerm - tsY.varTerm) / 18;

  // Continuity-corrected z; guard degenerate varS (all values tied)
  const z = (S === 0 || varS <= 0) ? 0 : (Math.abs(S) - 1) / Math.sqrt(varS) * Math.sign(S);
  const p = 2 * (1 - normalCDF(Math.abs(z)));

  // Kendall τ_b with tie-corrected denominator
  const p0    = k * (k - 1) / 2;
  const denom = Math.sqrt((p0 - tsX.pairs) * (p0 - tsY.pairs));
  const tau   = denom > 0 ? S / denom : 0;

  return { tau, S, z, p };
}

// ================= SHARED WLS HELPERS (pub-bias tests) =================
// Used by fatPetTest, harbordTest, petersTest, deeksTest, rueckerTest.

// NaN result object for when a pub-bias regression cannot be computed.
function _pubBiasNaN(df) {
  return {
    intercept: NaN, interceptSE: NaN, interceptT: NaN, interceptP: NaN,
    slope:     NaN, slopeSE:     NaN, slopeT:     NaN, slopeP:     NaN,
    df
  };
}

// Compute RSS, s², SE/t/p for intercept and slope from WLS output.
// ys, xs, ws must be parallel arrays of length k; df = k − 2.
function _wlsFinish(beta, vcov, ys, xs, ws, df) {
  let rss = 0;
  for (let i = 0; i < ys.length; i++) {
    const e = ys[i] - beta[0] - beta[1] * xs[i];
    rss += ws[i] * e * e;
  }
  const s2          = df > 0 ? rss / df : NaN;
  const interceptSE = Math.sqrt(s2 * vcov[0][0]);
  const slopeSE     = Math.sqrt(s2 * vcov[1][1]);
  const interceptT  = beta[0] / interceptSE;
  const slopeT      = beta[1] / slopeSE;
  const interceptP  = 2 * (1 - tCDF(Math.abs(interceptT), df));
  const slopeP      = 2 * (1 - tCDF(Math.abs(slopeT),     df));
  return {
    intercept: beta[0], interceptSE, interceptT, interceptP,
    slope:     beta[1], slopeSE,     slopeT,     slopeP,
    df
  };
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
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = valid.map(s => s.yi);
  const xs = valid.map(s => s.se ?? Math.sqrt(s.vi));
  const ws = valid.map(s => 1 / s.vi);

  const X = xs.map(x => [1, x]);
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= HARBORD TEST =================
// Harbord et al. (2006, Stat Med 25:3443-3457): modified Egger test for OR
// studies that avoids the artefactual correlation between log(OR) and its SE.
//
// For each 2×2 table (a,b,c,d), N = a+b+c+d:
//   E_i   = (a+b)(a+c)/N               (expected events under H₀)
//   V_i   = (a+b)(c+d)(a+c)(b+d) / (N²(N−1))   (hypergeometric variance)
//   z_i   = (a − E_i) / √V_i           (standardized score)
//
// OLS regression of z_i on √V_i; test H₀: intercept = 0.
// Studies with V_i ≤ 0 (zero marginal or N < 2) are skipped.
export function harbordTest(studies) {
  const valid = studies.filter(s => {
    const { a, b, c, d } = s;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false;
    if (a < 0 || b < 0 || c < 0 || d < 0) return false;
    const N = a + b + c + d;
    if (N < 2) return false;
    const V = (a+b) * (c+d) * (a+c) * (b+d) / (N * N * (N - 1));
    return V > 0;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = [], xs = [];
  for (const s of valid) {
    const { a, b, c, d } = s;
    const N     = a + b + c + d;
    const E     = (a + b) * (a + c) / N;
    const V     = (a + b) * (c + d) * (a + c) * (b + d) / (N * N * (N - 1));
    const sqrtV = Math.sqrt(V);
    ys.push((a - E) / sqrtV);   // z_i = (O − E) / √V
    xs.push(sqrtV);              // x_i = √V
  }

  const X  = xs.map(x => [1, x]);
  const ws = xs.map(() => 1);   // OLS — uniform weights
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= PETERS TEST =================
// Peters et al. (2006, JAMA 295:676-680): WLS regression of yi on 1/N.
// Uses inverse-variance weights (same as the meta-analysis model), which
// avoids the Egger test's artefactual SE/yi correlation for binary outcomes.
//
// N is extracted in priority order: a+b+c+d → n1+n2 → n.
// Studies where N cannot be determined or N < 2 are skipped.
export function petersTest(studies) {
  // Resolve total N from whatever count fields are present
  function getN(s) {
    if (isFinite(s.a) && isFinite(s.b) && isFinite(s.c) && isFinite(s.d))
      return s.a + s.b + s.c + s.d;
    if (isFinite(s.n1) && isFinite(s.n2))
      return s.n1 + s.n2;
    if (isFinite(s.n))
      return s.n;
    return NaN;
  }

  const valid = studies.filter(s => {
    if (!isFinite(s.yi) || !isFinite(s.vi) || s.vi <= 0) return false;
    const N = getN(s);
    return isFinite(N) && N >= 2;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = valid.map(s => s.yi);
  const xs = valid.map(s => 1 / getN(s));   // x_i = 1/N_i
  const ws = valid.map(s => 1 / s.vi);      // w_i = 1/vi (inverse-variance)

  const X = xs.map(x => [1, x]);
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= DEEKS TEST =================
// Deeks et al. (2005, J Clin Epidemiol 58:882-893): funnel-plot asymmetry
// test for meta-analyses of diagnostic test accuracy (DOR studies).
//
// For each 2×2 table (a,b,c,d), N = a+b+c+d:
//   ESS_i = 2(a+c)(b+d)/N   (effective sample size: harmonic mean of row totals × 2)
//   DOR_i = (a·d)/(b·c)     (diagnostic odds ratio)
//
// WLS regression of log(DOR_i) on 1/√ESS_i with weights ESS_i;
// test H₀: intercept = 0.
// Studies with any zero cell (log DOR undefined) or ESS ≤ 0 are skipped.
export function deeksTest(studies) {
  const valid = studies.filter(s => {
    const { a, b, c, d } = s;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false;
    if (a <= 0 || b <= 0 || c <= 0 || d <= 0) return false;   // log DOR requires all > 0
    const N = a + b + c + d;
    const ESS = 2 * (a + c) * (b + d) / N;
    return ESS > 0;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = [], xs = [], ws = [];
  for (const s of valid) {
    const { a, b, c, d } = s;
    const N   = a + b + c + d;
    const ESS = 2 * (a + c) * (b + d) / N;
    ys.push(Math.log((a * d) / (b * c)));   // log(DOR)
    xs.push(1 / Math.sqrt(ESS));            // 1/√ESS
    ws.push(ESS);                           // weight = ESS
  }

  const X = xs.map(x => [1, x]);
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
}

// ================= RÜCKER TEST =================
// Rücker et al. (2008, Stat Med 27:4450-4465): arcsine-based Egger test for
// binary outcomes. Applies the variance-stabilising arcsine transformation so
// that the effect size and its precision are less correlated than for log-OR,
// reducing the artefactual bias inflated type-I error of the standard Egger test.
//
// For each 2×2 table (a,b,c,d):
//   n1 = a+b,  n2 = c+d
//   p1 = a/n1, p2 = c/n2
//   y_i  = asin(√p1) − asin(√p2)          (arcsine risk difference)
//   se_i = √(1/(4n1) + 1/(4n2))
//   z_i  = y_i / se_i                      (standardised statistic)
//
// OLS regression (weights = 1) of z_i on 1/se_i (precision);
// test H₀: intercept = 0.
// Studies with n1 = 0 or n2 = 0 are skipped (se undefined).
export function rueckerTest(studies) {
  const valid = studies.filter(s => {
    const { a, b, c, d } = s;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false;
    if (a < 0 || b < 0 || c < 0 || d < 0) return false;
    return (a + b) > 0 && (c + d) > 0;
  });

  const k = valid.length;
  if (k < 3) return _pubBiasNaN(k - 2);

  const ys = [], xs = [];
  for (const s of valid) {
    const { a, b, c, d } = s;
    const n1  = a + b;
    const n2  = c + d;
    const p1  = a / n1;
    const p2  = c / n2;
    const se  = Math.sqrt(1 / (4 * n1) + 1 / (4 * n2));
    const y   = Math.asin(Math.sqrt(p1)) - Math.asin(Math.sqrt(p2));
    ys.push(y / se);      // z_i = y_i / se_i
    xs.push(1 / se);      // precision = 1/se_i
  }

  const X  = xs.map(x => [1, x]);
  const ws = xs.map(() => 1);   // OLS — uniform weights
  const { beta, vcov, rankDeficient } = wls(X, ys, ws);
  if (rankDeficient) return _pubBiasNaN(k - 2);

  return _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
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
  const MAX_BOUND = 1e12;  // guard against unbounded doubling on pathological input
  let tau2_lo;
  if (Q_FE <= chiHi) {
    tau2_lo = 0;
  } else {
    let lo = 0, hi = Math.max(tau2, 1);
    while (qProfile(hi, studies) > chiHi && hi < MAX_BOUND) hi *= 2;
    if (qProfile(hi, studies) > chiHi) {
      tau2_lo = NaN;  // bracket not found within MAX_BOUND
    } else {
      for (let i = 0; i < BISECTION_ITERS; i++) {
        const mid = (lo + hi) / 2;
        if (qProfile(mid, studies) > chiHi) lo = mid; else hi = mid;
      }
      tau2_lo = (lo + hi) / 2;
    }
  }

  // --- Upper τ² bound: Q_τ(τ²_hi) = chiLo ---
  // Q → 0 as τ² → ∞, so a solution always exists when chiLo > 0.
  let tau2_hi;
  if (!isFinite(chiLo) || chiLo <= 0) {
    tau2_hi = Infinity;
  } else {
    let lo = isFinite(tau2_lo) ? tau2_lo : 0, hi = Math.max(tau2, 1);
    while (qProfile(hi, studies) > chiLo && hi < MAX_BOUND) hi *= 2;
    if (qProfile(hi, studies) > chiLo) {
      tau2_hi = NaN;  // bracket not found within MAX_BOUND
    } else {
      for (let i = 0; i < BISECTION_ITERS; i++) {
        const mid = (lo + hi) / 2;
        if (qProfile(mid, studies) > chiLo) lo = mid; else hi = mid;
      }
      tau2_hi = (lo + hi) / 2;
    }
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
  const W = wFE.reduce((a,b)=>a+b,0);
  const FE = W > 0 ? studies.reduce((a,d,i)=>a+d.yi*wFE[i],0)/W : NaN;
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
	// ---- Non-UI estimators: not in the dropdown but reachable via meta() and estimatorComparison() ----
	else if (method === "SQGENQ") tau2 = tau2_SQGENQ(studies);              // see tau2_SQGENQ
	else if (method === "DLIT")   tau2 = tau2_DLIT(studies);                // see tau2_DLIT
	else if (method === "EBLUP")  tau2 = tau2_REML(studies, 1e-12, 500);   // alias: EBLUP = REML — see EBLUP block above tau2_GENQ
	else if (method === "HSk")    tau2 = tau2_HSk(studies);                 // see tau2_HSk
	else { // DL fallback
		const sumW2 = wFE.reduce((a,w)=>a+w*w,0);
		const C = W - (sumW2/W);
		tau2 = C>0 ? Math.max(0, (Q-dfQ)/C) : 0;
	}

  // ---------- RANDOM EFFECT ----------
  const wRE = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
  const WRE = wRE.reduce((a,b)=>a+b,0);
  const RE = WRE>0 ? studies.reduce((a,d,i)=>a+d.yi*wRE[i],0)/WRE : NaN;
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

  // CI bounds — overridden below for profile likelihood.
  let ciLow  = RE - crit * seRE;
  let ciHigh = RE + crit * seRE;

  if (ciMethod === "PL" && k > 1) {
    // Profile likelihood CI: invert the LR test using ML internally.
    // Point estimate and p-value remain Wald-based.
    const plCI = profileLikCI(studies);
    ciLow  = plCI[0];
    ciHigh = plCI[1];
  }

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
    ciLow,
    ciHigh,
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
// Returns an array of 12 entries (one per method):
//   { method, estimate, lb, ub, tau2, i2 }
// The first 8 ("DL" … "GENQ") are the standard UI-exposed methods.
// The remaining 4 ("SQGENQ", "DLIT", "EBLUP", "HSk") are the non-UI
// estimators documented above; they are included here so the comparison
// panel can display a complete picture when all estimators are of interest.
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

// ================ P-CURVE ANALYSIS ================
// pCurve(studies)
//
// Assesses the evidential value of a set of studies by examining the
// distribution of their significant p-values (Simonsohn, Nelson & Simmons,
// 2014, JPSP).
//
// Only studies with a two-tailed p-value < .05 are used; the p-values are
// derived from each study's z-statistic (z = |yi / se|).
//
// Two continuous tests are performed using pp-values — quantile
// transformations that should be Uniform(0,1) under each respective null:
//
//   Right-skew test (H₀: no effect, p-values uniform on [0,.05])
//     pp0ᵢ  = pᵢ / 0.05
//     Z     = (mean(pp0) − 0.5) × √(12k)
//     p     = Φ(Z)   [one-tailed left; evidence → small pp0s → negative Z]
//
//   Flatness test (H₃₃: studies powered at only 33% — insufficient evidence)
//     For a two-tailed z-test at power 33%, the noncentrality λ₃₃ satisfies
//       1 − Φ(1.96 − λ) + Φ(−1.96 − λ) = 0.33  →  λ₃₃ ≈ 0.8406
//     pp33ᵢ = P(p ≤ pᵢ | power = 33%) / 0.33
//           = ([1 − Φ(zᵢ − λ₃₃)] + Φ(−zᵢ − λ₃₃)) / 0.33
//     Z     = (mean(pp33) − 0.5) × √(12k)
//     p     = 1 − Φ(Z)  [one-tailed right; flatness → large pp33s → positive Z]
//
// Returns
// -------
//   k             — number of significant studies used
//   bins          — array of 5 objects { lo, hi, count, prop }
//                   boundaries: .00, .01, .02, .03, .04, .05
//   expected0     — expected proportion under H₀ (uniform): always 0.20
//   expected33    — array of 5 expected proportions under 33% power
//   rightSkewZ    — Z statistic for right-skew test
//   rightSkewP    — one-tailed p for right-skew test
//   flatnessZ     — Z statistic for flatness test
//   flatnessP     — one-tailed p for flatness test
//   verdict       — "evidential" | "no-evidential" | "inconclusive" | "insufficient"
export function pCurve(studies) {
  // ---- Step 1: derive p-values and keep only significant ones ----
  const sig = studies
    .filter(d => isFinite(d.yi) && isFinite(d.se) && d.se > 0)
    .map(d => {
      const z = Math.abs(d.yi / d.se);
      const p = 2 * (1 - normalCDF(z));
      return { z, p };
    })
    .filter(d => d.p < 0.05);

  const k = sig.length;

  // ---- Step 2: five-bin histogram ----
  const BIN_EDGES = [0, 0.01, 0.02, 0.03, 0.04, 0.05];
  const bins = BIN_EDGES.slice(0, 5).map((lo, i) => {
    const hi    = BIN_EDGES[i + 1];
    const count = sig.filter(d => d.p >= lo && d.p < hi).length;
    return { lo, hi, count, prop: k > 0 ? count / k : 0 };
  });

  // ---- Step 3: find λ₃₃ (noncentrality for 33% power, two-tailed z-test) ----
  // Solve: 1 − Φ(1.96 − λ) + Φ(−1.96 − λ) = 0.33 via bisection.
  const POWER_33  = 0.33;
  const Z_CRIT    = 1.96;
  function power(lambda) {
    return (1 - normalCDF(Z_CRIT - lambda)) + normalCDF(-Z_CRIT - lambda);
  }
  let lo33 = 0, hi33 = 10;
  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo33 + hi33) / 2;
    power(mid) < POWER_33 ? (lo33 = mid) : (hi33 = mid);
  }
  const lambda33 = (lo33 + hi33) / 2;  // ≈ 0.8406

  // pp33 CDF: probability that p-value ≤ p, conditional on p < .05, under 33% power.
  // pp33(p) = ([1 − Φ(z_p − λ₃₃)] + Φ(−z_p − λ₃₃)) / POWER_33
  // where z_p = Φ⁻¹(1 − p/2)  (the z corresponding to a two-tailed p-value)
  function pp33CDF(p) {
    if (p <= 0) return 0;
    if (p >= 0.05) return 1;
    const zp = normalQuantile(1 - p / 2);
    return ((1 - normalCDF(zp - lambda33)) + normalCDF(-zp - lambda33)) / POWER_33;
  }

  // ---- Step 4: expected proportions under 33% power (for plot overlay) ----
  const expected33 = BIN_EDGES.slice(0, 5).map((lo, i) => {
    const hi = BIN_EDGES[i + 1];
    return pp33CDF(hi) - pp33CDF(lo);
  });

  // ---- Step 5: right-skew test (H₀: no effect) ----
  // pp0ᵢ = pᵢ / 0.05; under H₀ these are Uniform(0,1).
  let rightSkewZ = NaN, rightSkewP = NaN;
  if (k >= 1) {
    const pp0    = sig.map(d => d.p / 0.05);
    const mean0  = pp0.reduce((a, b) => a + b, 0) / k;
    rightSkewZ   = (mean0 - 0.5) * Math.sqrt(12 * k);
    rightSkewP   = normalCDF(rightSkewZ);  // one-tailed left
  }

  // ---- Step 6: flatness test (H₃₃: 33% power) ----
  // pp33ᵢ = pp33CDF(pᵢ); under H₃₃ these are Uniform(0,1).
  let flatnessZ = NaN, flatnessP = NaN;
  if (k >= 1) {
    const pp33   = sig.map(d => pp33CDF(d.p));
    const mean33 = pp33.reduce((a, b) => a + b, 0) / k;
    flatnessZ    = (mean33 - 0.5) * Math.sqrt(12 * k);
    flatnessP    = 1 - normalCDF(flatnessZ);  // one-tailed right
  }

  // ---- Step 7: verdict ----
  let verdict;
  if (k < 3) {
    verdict = "insufficient";
  } else if (rightSkewP < 0.05) {
    verdict = "evidential";
  } else if (flatnessP < 0.05) {
    verdict = "no-evidential";
  } else {
    verdict = "inconclusive";
  }

  return {
    k,
    bins,
    expected0:  0.20,
    expected33,
    rightSkewZ,
    rightSkewP,
    flatnessZ,
    flatnessP,
    verdict,
  };
}

// ================ P-UNIFORM (van Assen, van Aert & Wicherts, 2015) ================
// pUniform(studies, m)
//
// Bias-corrected effect estimate and two hypothesis tests using the conditional
// uniformity of p-values under the true effect size.
//
// Method overview
// ---------------
// For each significant study (two-tailed p < .05), the absolute z-statistic
// z_i = |yi / se_i| is computed, and the conditional quantile under a
// hypothesised effect δ is:
//
//   q_i(δ) = [1 − Φ(z_i − δ/se_i)] / [1 − Φ(1.96 − δ/se_i)]
//
// Interpretation: q_i is the probability that a study with the same SE would
// yield a p-value as small or smaller than p_i, given that it was significant
// and the true effect is δ.  Under the true δ, q_i ~ Uniform(0, 1).
//
// The denominator is the power of study i at effect δ; it is clamped at
// MIN_DENOM = 1e-10 to avoid division by zero at extreme negative δ.
//
// Because Σq_i(δ) is strictly increasing in δ, bisection solves for:
//   · effect estimate δ* : Σq_i(δ*) = k/2
//   · 95% CI lower bound  : Σq_i(δ_lo) = k/2 − 1.96 × √(k/12)
//   · 95% CI upper bound  : Σq_i(δ_hi) = k/2 + 1.96 × √(k/12)
//
// Two tests
// ---------
//   Significance test  (H₀: δ = 0)
//     Z_sig  = [Σq_i(0) − k/2] / √(k/12)
//     p_sig  = Φ(Z_sig)           [one-tailed left; evidence → Z < 0]
//
//   Publication-bias test  (H₀: no bias — RE estimate equals true effect)
//     Z_bias = [Σq_i(δ_RE) − k/2] / √(k/12)
//     p_bias = 1 − Φ(Z_bias)      [one-tailed right; bias → Z > 0]
//
// Parameters
// ----------
//   studies — full studies array (filtering to significant is done internally)
//   m       — meta() result object, used for m.RE (the RE estimate)
//
// Returns
// -------
//   k                — number of significant studies used
//   estimate         — bias-corrected point estimate δ* (NaN if not solvable)
//   ciLow, ciHigh    — 95% CI bounds (NaN if not solvable)
//   Z_sig, p_sig     — significance test
//   Z_bias, p_bias   — publication-bias test
//   significantEffect — p_sig  < .05
//   biasDetected      — p_bias < .05
export function pUniform(studies, m) {
  const MIN_DENOM  = 1e-10;  // clamp denominator to avoid division by near-zero power
  const SEARCH_LO  = -10;    // bisection search range for δ (covers any practical effect)
  const SEARCH_HI  =  10;

  // ---- Step 1: significant studies ----
  const sig = studies
    .filter(d => isFinite(d.yi) && isFinite(d.se) && d.se > 0)
    .map(d => ({
      z:  Math.abs(d.yi / d.se),   // fold to upper tail
      se: d.se,
    }))
    .filter(d => 2 * (1 - normalCDF(d.z)) < 0.05);

  const k = sig.length;

  // ---- Step 2: conditional quantile q_i(δ) for one study ----
  function qi(z, se, delta) {
    const lambda   = delta / se;
    const numer    = 1 - normalCDF(z    - lambda);
    const denom    = Math.max(1 - normalCDF(1.96 - lambda), MIN_DENOM);
    return numer / denom;
  }

  // Σq_i(δ) — the aggregate target function, strictly increasing in δ.
  function sumQ(delta) {
    return sig.reduce((acc, d) => acc + qi(d.z, d.se, delta), 0);
  }

  // ---- Step 3: test statistics (computed regardless of k for completeness) ----
  const sdUnif = k > 0 ? Math.sqrt(k / 12) : NaN;

  const sq0   = k > 0 ? sumQ(0)    : NaN;
  const sqRE  = k > 0 ? sumQ(isFinite(m?.RE) ? m.RE : 0) : NaN;

  const Z_sig  = k > 0 ? (sq0  - k / 2) / sdUnif : NaN;
  const Z_bias = k > 0 ? (sqRE - k / 2) / sdUnif : NaN;

  const p_sig  = isFinite(Z_sig)  ? normalCDF(Z_sig)       : NaN;  // one-tailed left
  const p_bias = isFinite(Z_bias) ? 1 - normalCDF(Z_bias)  : NaN;  // one-tailed right

  // ---- Step 4: bisection helper ----
  // Finds δ such that sumQ(δ) = target.
  // Returns NaN if the target lies outside [sumQ(SEARCH_LO), sumQ(SEARCH_HI)].
  function bisectDelta(target) {
    const lo0 = sumQ(SEARCH_LO);
    const hi0 = sumQ(SEARCH_HI);
    if (target < lo0 || target > hi0) return NaN;
    let lo = SEARCH_LO, hi = SEARCH_HI;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + hi) / 2;
      sumQ(mid) < target ? (lo = mid) : (hi = mid);
    }
    return (lo + hi) / 2;
  }

  // ---- Step 5: effect estimate and 95% CI ----
  let estimate = NaN, ciLow = NaN, ciHigh = NaN;
  if (k >= 1) {
    const half    = k / 2;
    const margin  = 1.96 * sdUnif;
    estimate = bisectDelta(half);
    ciLow    = bisectDelta(half - margin);
    ciHigh   = bisectDelta(half + margin);
  }

  return {
    k,
    estimate,
    ciLow,
    ciHigh,
    Z_sig,
    p_sig,
    Z_bias,
    p_bias,
    significantEffect: k >= 3 && isFinite(p_sig)  && p_sig  < 0.05,
    biasDetected:      k >= 3 && isFinite(p_bias) && p_bias < 0.05,
  };
}

// ================= BAUJAT PLOT =================
// -----------------------------------------------------------------------------
// baujat(studies) → result | null
// -----------------------------------------------------------------------------
// Computes per-study coordinates for the Baujat diagnostic scatter plot
// (Baujat et al., 2002, Statistics in Medicine).
//
// Both axes are derived analytically from fixed-effects quantities:
//   w_i    = 1 / v_i                       (FE weight)
//   W      = Σ w_i                          (total FE weight)
//   μ̂_FE  = Σ(w_i · y_i) / W              (FE pooled estimate)
//
//   x_i    = w_i · (y_i − μ̂_FE)²          (contribution to Cochran's Q)
//   infl_i = w_i² · (y_i − μ̂_FE)² / (W − w_i)
//          = w_i · x_i / (W − w_i)         (influence on FE estimate)
//
// Returns
// -------
//   {
//     points : [{ label, x, influence, yi, vi, group }],
//     muFE   : number,   // overall FE pooled estimate
//     Q      : number,   // Cochran's Q = Σ x_i
//     k      : number,   // number of studies used
//   }
// Returns null when fewer than 2 studies have finite yi / vi.
// -----------------------------------------------------------------------------
export function baujat(studies) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  if (valid.length < 2) return null;

  // ---- FE quantities ----
  const W   = valid.reduce((s, d) => s + 1 / d.vi, 0);
  const muFE = valid.reduce((s, d) => s + d.yi / d.vi, 0) / W;
  const Q   = valid.reduce((s, d) => s + (d.yi - muFE) ** 2 / d.vi, 0);

  // ---- Per-study coordinates ----
  const points = valid.map(s => {
    const wi        = 1 / s.vi;
    const dev       = s.yi - muFE;
    const x         = wi * dev ** 2;           // contribution to Q
    const influence = wi * x / (W - wi);       // influence on FE estimate

    return {
      label:     s.label,
      x,
      influence,
      yi:        s.yi,
      vi:        s.vi,
      group:     s.group ?? null,
    };
  });

  return { points, muFE, Q, k: valid.length };
}