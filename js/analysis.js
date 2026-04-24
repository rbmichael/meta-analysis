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
//   blupMeta(studies, m, alpha)
//     Per-study BLUPs (Empirical Bayes shrunken estimates) under the RE model.
//     Returns shrunken estimate, full-uncertainty SE/CI, random effect, and
//     shrinkage weight λᵢ for each study.
//
//   bfgs(f, x0, opts)
//     General-purpose BFGS minimizer with central-difference gradient and
//     Armijo backtracking.  Returns { x, fval, gnorm, iters, converged }.
//
//   selIntervalProbs / selIntervalIdx / selectionLogLik
//     Low-level helpers for the Vevea-Hedges selection model; exported for
//     testing.  Not part of the public API.
//
//   SEL_CUTS_ONE_SIDED / SEL_CUTS_TWO_SIDED
//     Default p-value cutpoint presets for veveaHedges().
//
//   veveaHedges(studies, cuts, sides)
//     Vevea-Hedges (1995) step-function selection model for publication bias.
//     Fits ω_j weights via BFGS ML; returns corrected pooled estimate, τ²,
//     selection weights with SEs (delta method), and an LRT vs no-selection.
//
//   bayesMeta(studies, opts)
//     Conjugate normal-normal Bayesian random-effects model.  Prior: μ ~ N(μ₀, σ_μ²),
//     τ ~ HalfNormal(σ_τ).  Posterior approximated by 1-D grid over τ (nGrid = 300);
//     at each grid point the conditional posterior of μ is analytic (conjugate).
//     Returns posterior mean and 95% credible interval for μ and τ, plus marginal
//     density arrays for plotting.
//
//   metaMH(studies, type)
//     Mantel-Haenszel fixed-effects pooling for 2×2 binary data.
//     type ∈ {"OR","RR","RD"}.  Reads raw cell counts (a,b,c,d) from each study
//     object (stored by profile.compute via ...s spread).  Returns an object shaped
//     like meta() with RE/tau2 = NaN and isMH: true.
//
//   metaPeto(studies)
//     Peto one-step log-OR estimator for 2×2 binary data (OR only).
//     Based on observed-minus-expected cell counts and hypergeometric variance.
//     Returns an object shaped like meta() with RE/tau2 = NaN and isPeto: true.
//
//   sandwichVar(X, w, residuals, clusterIds)
//     Cluster-robust (sandwich) variance estimator.  Groups rows by clusterIds;
//     rows with null/empty IDs are treated as singletons.  Applies CR1 small-sample
//     correction C/(C−p).  Returns { V_rob, SE_rob, df, C, B, allSingletons } or
//     { error } if C < 2 or C ≤ p.
//
//   robustWlsResult(X, w, y, beta, clusterIds)
//     Post-processes a WLS fit with cluster-robust SEs via sandwichVar.
//     Returns { robustSE, robustZ, robustP, robustCi, df, C, allSingletons } or
//     { error }.  Used by eggerTest, fatPetTest, and metaRegression.
//
//   robustMeta(studies, method, ciMethod)
//     Wraps meta() and appends cluster-robust pooled-estimate SE/CI.
//     Reads cluster IDs from study.cluster; returns meta() result extended with
//     robustSE, robustCiLow, robustCiHigh, robustStat, robustPval, robustDf,
//     clustersUsed, isClustered.  Falls back to meta() when no clusters present.
//
// Dependencies: utils.js, constants.js, profiles.js
// =============================================================================

import { tCritical, normalCDF, normalQuantile, tCDF, chiSquareCDF, chiSquareQuantile, fCDF, hedgesG, parseCounts, gorFromCounts, tetrachoricFromCounts, hyperg2F1_ucor, regularizedGammaP } from "./utils.js";
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
/**
 * Compute per-study (yi, vi) for one study row using the named effect profile.
 * Full parameter and return-value documentation in the block comment above.
 * @param {Object}  s            - Raw study object; required fields vary by `type`.
 * @param {string}  type         - Effect-type key (e.g. "SMD", "OR"); falsy = auto-detect.
 * @param {Object}  [options={}] - Options forwarded to the profile (e.g. Hedges g flags).
 * @returns {{ yi: number, vi: number, se: number, w: number } & Object}
 *   Spread copy of `s` augmented with yi/vi/se/w.
 *   Returns NaN yi/vi (w=0) on validation failure so meta() can skip the study.
 */
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
	if (type === "OR" || type === "RR" || type === "RD" || type === "AS" ||
	    type === "YUQ" || type === "YUY") {
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
	  } else if (type === "AS") {
		// Arcsine-transformed Risk Difference (metafor escalc "AS")
		const n1 = a + b, n2 = c + d;
		yi = Math.asin(Math.sqrt(a / n1)) - Math.asin(Math.sqrt(c / n2));
		vi = 1 / (4 * n1) + 1 / (4 * n2);
	  } else if (type === "YUQ") {
		// Yule's Q (metafor escalc "YUQ")
		const ad = a * d, bc = b * c;
		const denom = ad + bc;
		if (denom === 0) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
		yi = (ad - bc) / denom;
		vi = (1 - yi * yi) ** 2 / 4 * (1/a + 1/b + 1/c + 1/d);
	  } else if (type === "YUY") {
		// Yule's Y (metafor escalc "YUY")
		const sqrtAD = Math.sqrt(a * d), sqrtBC = Math.sqrt(b * c);
		const denom = sqrtAD + sqrtBC;
		if (denom === 0) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
		yi = (sqrtAD - sqrtBC) / denom;
		vi = (1 - yi * yi) ** 2 / 16 * (1/a + 1/b + 1/c + 1/d);
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
  if (type === "COR" || type === "ZCOR" || type === "UCOR") {
    const { n } = s;
    const r = Math.max(-0.9999, Math.min(0.9999, s.r));  // clamp away from ±1 singularity

    if (type === "COR") {
      // Raw correlation: yi = r, vi = (1−r²)²/(n−1)
      const vi = Math.max((1 - r * r) ** 2 / (n - 1), MIN_VAR);
      return { ...s, yi: r, vi, se: Math.sqrt(vi), w: 1 / vi };
    }

    if (type === "UCOR") {
      // Bias-corrected correlation (Olkin & Pratt 1958)
      // yi = r · ₂F₁(1/2,1/2;(n−2)/2;1−r²),  vi = (1−yi²)²/(n−1)
      const yi = r * hyperg2F1_ucor((n - 2) / 2, 1 - r * r);
      const vi = Math.max((1 - yi * yi) ** 2 / (n - 1), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
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

  // ================= INCIDENCE RATE DIFFERENCE =================
  // Input: { x1, t1, x2, t2 }.
  // yi = x1/t1 − x2/t2  (raw rate difference)
  // vi = x1/t1² + x2/t2²  (delta method, Poisson sampling)
  if (type === "IRD") {
    const { x1, t1, x2, t2 } = s;
    const yi = x1 / t1 - x2 / t2;
    const vi = Math.max(x1 / (t1 * t1) + x2 / (t2 * t2), MIN_VAR);
    return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
  }

  // ================= INCIDENCE RATE DIFFERENCE (sqrt) =================
  // Input: { x1, t1, x2, t2 }.
  // yi = sqrt(x1/t1) − sqrt(x2/t2)  (variance-stabilising transform)
  // vi = 1/(4*t1) + 1/(4*t2)  (delta method; independent of xi)
  if (type === "IRSD") {
    const { x1, t1, x2, t2 } = s;
    const yi = Math.sqrt(x1 / t1) - Math.sqrt(x2 / t2);
    const vi = Math.max(1 / (4 * t1) + 1 / (4 * t2), MIN_VAR);
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

  // ================= ONE-SAMPLE SMD =================
  // Input: { m, sd, n, ref }  — ref defaults to 0 if omitted or non-finite.
  // SMD1:  vi = 1/n + yi²/(2·df)            (J only on d² term)
  // SMD1H: vi = J² · (1/n + d²/(2·df))      (full J² correction; SMDH analogue)
  if (type === "SMD1" || type === "SMD1H") {
    const { m, sd, n } = s;
    const ref = isFinite(s.ref) ? s.ref : 0;
    const d   = (m - ref) / sd;
    const df  = n - 1;
    const J   = 1 - 3 / (4 * df - 1);
    const yi  = d * J;
    let vi;
    if (type === "SMD1") {
      vi = 1 / n + yi * yi / (2 * df);
    } else {
      // SMD1H: delta-method with full J² scaling (matches SMDH pattern)
      vi = J * J * (1 / n + d * d / (2 * df));
    }
    const safeVi = Math.max(vi, MIN_VAR);
    return { ...s, yi, vi: safeVi, se: Math.sqrt(safeVi), w: 1 / safeVi };
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
  const W = w.reduce((acc, b) => acc + b, 0);
  const ybar = studies.reduce((acc, d, i) => acc + w[i] * d.yi, 0) / W;
  const Q = studies.reduce((acc, d, i) => acc + w[i] * (d.yi - ybar) ** 2, 0);
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
  const ybar = studies.reduce((acc, d) => acc + d.yi, 0) / k;
  const SS   = studies.reduce((acc, d) => acc + (d.yi - ybar) ** 2, 0);
  const meanV = studies.reduce((acc, d) => acc + d.vi, 0) / k;
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
  const ybar0 = studies.reduce((acc, d) => acc + d.yi, 0) / k;
  // Seed: raw between-study variance (always > 0 unless all yi identical)
  let tau2 = studies.reduce((acc, d) => acc + (d.yi - ybar0) ** 2, 0) / k;
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
  const W      = w.reduce((acc, b) => acc + b, 0);
  const muHat  = studies.reduce((acc, d, i) => acc + w[i] * d.yi, 0) / W;
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

// ================= PROFILE LIKELIHOOD FOR τ² =================
// Computes the profile log-likelihood curve L_p(τ²) by substituting the
// closed-form RE mean μ̂(τ²) = Σwᵢyᵢ / Σwᵢ (wᵢ = 1/(vᵢ+τ²)) at each τ².
//
// For ML:   L_p(τ²) = −½ Σ[log(vᵢ+τ²) + (yᵢ−μ̂)²/(vᵢ+τ²)]
// For REML: L_p(τ²) = L_ML(τ²) − ½ log(Σwᵢ)
//
// The 95% CI for τ² is the set where 2(lMax − L_p(τ²)) ≤ χ²(1, 0.95),
// found by bisection. The lower bound is clipped to 0.
export function profileLikTau2(studies, opts = {}) {
  const k      = studies.length;
  const method = opts.method !== undefined ? opts.method : "REML";
  const nGrid  = opts.nGrid  !== undefined ? opts.nGrid  : 200;
  const alpha  = opts.alpha  !== undefined ? opts.alpha  : 0.05;

  if (k < 2)
    return { error: "Profile likelihood requires at least 2 studies (got " + k + ")" };
  if (method !== "ML" && method !== "REML")
    return { error: 'method must be "ML" or "REML" (got "' + method + '")' };

  function evalProfile(tau2) {
    let W = 0, Wmu = 0;
    for (const d of studies) {
      const w = 1 / (d.vi + tau2);
      W   += w;
      Wmu += w * d.yi;
    }
    const mu = Wmu / W;
    let ll = logLik(studies, mu, tau2);
    if (method === "REML") ll -= 0.5 * Math.log(W);
    return ll;
  }

  const tau2hat = method === "REML" ? tau2_REML(studies) : tau2_ML(studies);
  const lMax    = evalProfile(tau2hat);
  const chi2thresh = chiSquareQuantile(1 - alpha, 1);
  const lCrit   = lMax - chi2thresh / 2;

  // ---- Find upper bracket: double from max(4*tau2hat, 0.5) until well below lCrit ----
  let hi = Math.max(tau2hat * 4, 0.5);
  while (evalProfile(hi) > lCrit - 4) hi *= 2;

  // ---- CI lower bound ----
  let ciLow;
  if (evalProfile(0) >= lCrit) {
    ciLow = 0;
  } else {
    // Bisect on [0, tau2hat]: find root of evalProfile(t) - lCrit = 0
    let lo = 0, bhi = tau2hat;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + bhi) / 2;
      if (evalProfile(mid) >= lCrit) bhi = mid; else lo = mid;
    }
    ciLow = (lo + bhi) / 2;
  }

  // ---- CI upper bound: bisect on [tau2hat, hi] ----
  let ciHigh;
  {
    let lo = tau2hat, bhi = hi;
    for (let i = 0; i < BISECTION_ITERS; i++) {
      const mid = (lo + bhi) / 2;
      if (evalProfile(mid) >= lCrit) lo = mid; else bhi = mid;
    }
    ciHigh = (lo + bhi) / 2;
  }

  // ---- Build grid from 0 to hi, compute shifted log-likelihood ----
  const grid = new Float64Array(nGrid);
  const ll   = new Float64Array(nGrid);
  const step = hi / (nGrid - 1);
  for (let i = 0; i < nGrid; i++) {
    const t  = i * step;
    grid[i]  = t;
    ll[i]    = evalProfile(t) - lMax;   // shifted so peak = 0
  }

  return {
    grid,
    ll,
    tau2hat,
    lMax,
    lCrit,
    lCritRel: lCrit - lMax,             // ≈ −1.921 for 95%
    ciLow,
    ciHigh,
    method,
    k,
    alpha,
  };
}

// ================= BAYESIAN META-ANALYSIS =================
// Conjugate normal-normal random-effects model approximated by a 1-D grid
// over τ.  Integrating μ out at each grid point is analytic (conjugate
// normal prior), so no MCMC or 2-D quadrature is needed.
//
// Prior:    μ | μ₀, σ_μ  ~ N(μ₀, σ_μ²)
//           τ             ~ HalfNormal(0, σ_τ)
//
// At each grid point τ_g the conditional posterior of μ is:
//   p(μ | τ_g, y) = N(m_g, V_g)
//   P_g = 1/σ_μ² + Σ 1/(vᵢ+τ_g²)
//   m_g = [μ₀/σ_μ² + Σ yᵢ/(vᵢ+τ_g²)] / P_g
//   V_g = 1 / P_g
//
// Log unnormalised grid weight:
//   log w_g = logML_g + logPrior_g
//   logML_g = ½[log(V_g) − log(σ_μ²) − Σ log(vᵢ+τ_g²)]
//             − ½[Σ yᵢ²/(vᵢ+τ_g²) + μ₀²/σ_μ² − precYmu² · V_g]
//   logPrior_g = −τ_g² / (2 σ_τ²)   (constants that cancel are dropped)
//
// The marginal posterior of μ is a mixture of Gaussians:
//   p(μ | y) = Σ_g w_g · N(μ; m_g, V_g)
export function bayesMeta(studies, opts = {}) {
  const k         = studies.length;
  const mu0       = opts.mu0       !== undefined ? opts.mu0       : 0;
  const sigma_mu  = opts.sigma_mu  !== undefined ? opts.sigma_mu  : 1;
  const sigma_tau = opts.sigma_tau !== undefined ? opts.sigma_tau : 0.5;
  const alpha     = opts.alpha     !== undefined ? opts.alpha     : 0.05;
  // Grid density adapts to k: coarser grid for large k (smooth posterior).
  // Manual overrides via opts.nGrid / opts.nMu are respected.
  const nGrid = opts.nGrid !== undefined ? opts.nGrid
    : Math.round(Math.max(100, Math.min(300, 4500 / k)));
  const nMu   = opts.nMu   !== undefined ? opts.nMu
    : Math.round(Math.max(200, Math.min(500, 100000 / k)));

  if (k < 2)         return { error: "Bayesian meta-analysis requires at least 2 studies." };
  if (sigma_mu  <= 0) return { error: "sigma_mu must be positive." };
  if (sigma_tau <= 0) return { error: "sigma_tau must be positive." };

  // ---- Inline DL τ estimate for grid sizing ----
  const wFE   = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W     = wFE.reduce((s, w) => s + w, 0);
  const FE    = studies.reduce((s, d, i) => s + d.yi * wFE[i], 0) / W;
  const Q     = studies.reduce((s, d, i) => s + wFE[i] * (d.yi - FE) ** 2, 0);
  const sumW2 = wFE.reduce((s, w) => s + w * w, 0);
  const C     = W - sumW2 / W;
  const tauDL = Math.sqrt(C > 0 ? Math.max(0, (Q - (k - 1)) / C) : 0);

  // ---- Compute grid weights for a given tauMax ----
  const computeGrid = (tauMax) => {
    const dtau      = tauMax / (nGrid - 1);
    const tauGrid   = new Float64Array(nGrid);
    const condMeans = new Float64Array(nGrid);
    const condVars  = new Float64Array(nGrid);
    const logW      = new Float64Array(nGrid);

    const precMu    = 1 / (sigma_mu * sigma_mu);
    const mu0PrecMu = mu0 * precMu;
    const logSigMu2 = Math.log(sigma_mu * sigma_mu);
    const inv2SigTau2 = 1 / (2 * sigma_tau * sigma_tau);

    for (let g = 0; g < nGrid; g++) {
      const tau  = g * dtau;
      const tau2 = tau * tau;
      tauGrid[g] = tau;

      let sumW = 0, sumWy = 0, sumWy2 = 0, sumLogV = 0;
      for (const d of studies) {
        const v  = d.vi + tau2;
        const w  = 1 / v;
        sumW    += w;
        sumWy   += w * d.yi;
        sumWy2  += w * d.yi * d.yi;
        sumLogV += Math.log(v);
      }

      const Pg      = precMu + sumW;
      const Vg      = 1 / Pg;
      const precYmu = mu0PrecMu + sumWy;
      const mg      = precYmu * Vg;

      condMeans[g] = mg;
      condVars[g]  = Vg;

      // Log marginal likelihood (2π constants drop in normalisation)
      const logML = 0.5 * (Math.log(Vg) - logSigMu2 - sumLogV)
                    - 0.5 * (sumWy2 + mu0 * mu0 * precMu - precYmu * precYmu * Vg);

      // Log half-normal prior on τ (constant terms drop in normalisation)
      logW[g] = logML - tau2 * inv2SigTau2;
    }

    return { tauGrid, condMeans, condVars, logW, dtau };
  };

  // ---- Initial grid ----
  let tauMax = Math.max(tauDL * 8, 3);
  let { tauGrid, condMeans, condVars, logW, dtau } = computeGrid(tauMax);

  // ---- Normalise via log-sum-exp ----
  const normalise = (lw) => {
    const lmax  = lw.reduce((m, v) => Math.max(m, v), -Infinity);
    const raw   = lw.map(v => Math.exp(v - lmax));
    const total = raw.reduce((s, v) => s + v, 0);
    return new Float64Array(raw.map(v => v / total));
  };

  let tauWeights = normalise(logW);

  // ---- Grid truncation check: double tauMax once if needed ----
  const maxW = tauWeights.reduce((m, v) => Math.max(m, v), 0);
  let grid_truncated = tauWeights[nGrid - 1] > 1e-4 * maxW;
  if (grid_truncated) {
    tauMax *= 2;
    ({ tauGrid, condMeans, condVars, logW, dtau } = computeGrid(tauMax));
    tauWeights = normalise(logW);
    const maxW2 = tauWeights.reduce((m, v) => Math.max(m, v), 0);
    grid_truncated = tauWeights[nGrid - 1] > 1e-4 * maxW2;
  }

  // ---- Marginal posterior of τ ----
  let tauMean = 0, tauMeanSq = 0;
  for (let g = 0; g < nGrid; g++) {
    tauMean   += tauWeights[g] * tauGrid[g];
    tauMeanSq += tauWeights[g] * tauGrid[g] * tauGrid[g];
  }
  const tauVar = Math.max(0, tauMeanSq - tauMean * tauMean);
  const tauSD  = Math.sqrt(tauVar);

  // τ CI by cumulative-weight interpolation
  const tauCDF = new Float64Array(nGrid);
  tauCDF[0] = 0;
  for (let g = 1; g < nGrid; g++) tauCDF[g] = tauCDF[g - 1] + tauWeights[g];

  const quantileTau = (p) => {
    for (let g = 1; g < nGrid; g++) {
      if (tauCDF[g] >= p) {
        const frac = (p - tauCDF[g - 1]) / Math.max(tauCDF[g] - tauCDF[g - 1], 1e-300);
        return tauGrid[g - 1] + frac * dtau;
      }
    }
    return tauGrid[nGrid - 1];
  };

  const _blo = alpha / 2, _bhi = 1 - alpha / 2;
  const tauCI = [quantileTau(_blo), quantileTau(_bhi)];

  // ---- Marginal posterior of μ (law of total expectation / variance) ----
  let muMean = 0, muMeanSq = 0, muMeanVar = 0;
  for (let g = 0; g < nGrid; g++) {
    muMean    += tauWeights[g] * condMeans[g];
    muMeanSq  += tauWeights[g] * condMeans[g] * condMeans[g];
    muMeanVar += tauWeights[g] * condVars[g];
  }
  // Var[μ|y] = E[Var[μ|τ,y]] + Var[E[μ|τ,y]]  (law of total variance)
  const muVar = Math.max(0, muMeanVar + muMeanSq - muMean * muMean);
  const muSD  = Math.sqrt(muVar);

  // ---- μ density grid ----
  const muLo   = muMean - 6 * Math.max(muSD, 1e-6);
  const muHi   = muMean + 6 * Math.max(muSD, 1e-6);
  const dMu    = (muHi - muLo) / (nMu - 1);
  const muGrid = new Float64Array(nMu);
  for (let j = 0; j < nMu; j++) muGrid[j] = muLo + j * dMu;

  // Mixture density p(μ|y) = Σ_g w_g · N(μ; m_g, V_g)
  const LOG_2PI   = Math.log(2 * Math.PI);
  const muDensity = new Float64Array(nMu);
  for (let j = 0; j < nMu; j++) {
    const mu = muGrid[j];
    let d = 0;
    for (let g = 0; g < nGrid; g++) {
      const Vg   = condVars[g];
      const mg   = condMeans[g];
      const logN = -0.5 * (LOG_2PI + Math.log(Vg) + (mu - mg) * (mu - mg) / Vg);
      d += tauWeights[g] * Math.exp(logN);
    }
    muDensity[j] = d;
  }

  // Normalise muDensity (trapezoidal rule)
  let integral = 0;
  for (let j = 0; j < nMu; j++) {
    integral += muDensity[j] * (j === 0 || j === nMu - 1 ? 0.5 : 1);
  }
  integral *= dMu;
  if (integral > 0) for (let j = 0; j < nMu; j++) muDensity[j] /= integral;

  // μ CI from mixture CDF (trapezoidal)
  const muCDF = new Float64Array(nMu);
  muCDF[0] = 0;
  for (let j = 1; j < nMu; j++) {
    muCDF[j] = muCDF[j - 1] + 0.5 * (muDensity[j - 1] + muDensity[j]) * dMu;
  }

  const quantileMu = (p) => {
    for (let j = 1; j < nMu; j++) {
      if (muCDF[j] >= p) {
        const frac = (p - muCDF[j - 1]) / Math.max(muCDF[j] - muCDF[j - 1], 1e-300);
        return muGrid[j - 1] + frac * dMu;
      }
    }
    return muGrid[nMu - 1];
  };

  const muCI = [quantileMu(_blo), quantileMu(_bhi)];

  // ---- Savage-Dickey Bayes Factor BF₁₀ (H₁: μ≠0 vs H₀: μ=0) ----
  // BF₁₀ = p(μ=0 | H₁) / p(μ=0 | y, H₁)
  //       = prior_density(0) / posterior_density(0)
  //
  // Prior density at 0: N(0; mu0, sigma_mu²)
  const priorAt0 = Math.exp(-0.5 * mu0 * mu0 / (sigma_mu * sigma_mu))
                 / Math.sqrt(2 * Math.PI * sigma_mu * sigma_mu);

  // Posterior mixture density at 0: Σ_g w_g · N(0; m_g, V_g)
  let postAt0 = 0;
  for (let g = 0; g < nGrid; g++) {
    const mg = condMeans[g], Vg = condVars[g];
    postAt0 += tauWeights[g]
             * Math.exp(-0.5 * mg * mg / Vg)
             / Math.sqrt(2 * Math.PI * Vg);
  }

  const BF10    = (priorAt0 > 0 && postAt0 > 0) ? priorAt0 / postAt0 : NaN;
  const BF01    = isFinite(BF10) && BF10 > 0 ? 1 / BF10 : NaN;
  const logBF10 = isFinite(BF10) && BF10 > 0 ? Math.log(BF10) : NaN;

  return {
    mu0, sigma_mu, sigma_tau, alpha,
    muMean, muSD, muCI,
    tauMean, tauSD, tauCI,
    tauGrid, tauWeights,
    muGrid, muDensity,
    grid_truncated,
    k,
    BF10, BF01, logBF10,
  };
}

// ================= MANTEL-HAENSZEL =================
// Fixed-effects pooling using Mantel-Haenszel weights.  Operates on raw cell
// counts (a, b, c, d) stored on each study object by profile.compute().
// Supports OR, RR, and RD.
//
// OR  — Mantel & Haenszel (1959); variance: Robins, Breslow & Greenland (1986).
//         R_i  = a·d / N,   S_i = b·c / N
//         est  = log(ΣR / ΣS)
//         Var  = Σ(P·R)/(2·ΣR²) + Σ(P·S+Q·R)/(2·ΣR·ΣS) + Σ(Q·S)/(2·ΣS²)
//                where P_i=(a+d)/N, Q_i=(b+c)/N
//
// RR  — Greenland & Robins (1985).
//         R_i  = a·n₂/N,  S_i = c·n₁/N  (n₁=a+b, n₂=c+d)
//         est  = log(ΣR / ΣS)
//         C_i  = (n₁·n₂·(a+c) − a·c·N) / N²
//         Var  = ΣC / (ΣR · ΣS)
//
// RD  — Greenland & Robins (1985).
//         w_i  = n₁·n₂ / N
//         est  = Σ(w·RD) / Σw,  RD_i = a/n₁ − c/n₂
//         f_i  = n₁·n₂·(a·n₂ + c·n₁) / N³
//         Var  = Σf / (Σw)²
//
// ---------------------------------------------------------------------------
// priorSensitivity(studies, opts) → array of rows
// ---------------------------------------------------------------------------
// Runs bayesMeta() over a grid of (sigma_mu, sigma_tau) pairs and returns a
// summary row for each combination. No new math — wraps bayesMeta().
//
// opts:
//   mu0          — prior mean for μ (default 0)
//   sigmaMuGrid  — array of σ_μ values (default [0.5, 1, 2])
//   sigmaTauGrid — array of σ_τ values (default [0.25, 0.5, 1])
//   alpha        — credible interval width (default 0.05)
//
// Returns: array of { sigma_mu, sigma_tau, muMean, muCI, BF10 }
//   (one object per grid cell, ordered σ_τ outer / σ_μ inner)
// ---------------------------------------------------------------------------
export function priorSensitivity(studies, opts = {}) {
  const {
    mu0          = 0,
    sigmaMuGrid  = [0.5, 1, 2],
    sigmaTauGrid = [0.25, 0.5, 1],
    alpha        = 0.05,
  } = opts;
  const rows = [];
  for (const sigma_tau of sigmaTauGrid) {
    for (const sigma_mu of sigmaMuGrid) {
      const r = bayesMeta(studies, { mu0, sigma_mu, sigma_tau, alpha });
      rows.push({
        sigma_mu,
        sigma_tau,
        muMean: r.error ? NaN : r.muMean,
        muCI:   r.error ? [NaN, NaN] : r.muCI,
        BF10:   r.error ? NaN : r.BF10,
      });
    }
  }
  return rows;
}

// Q for heterogeneity: IV weights (1/vi) with M-H estimate as reference.
export function metaMH(studies, type, alpha = 0.05) {
  const k = studies.length;
  if (k < 2) return { error: "Mantel-Haenszel requires at least 2 studies." };

  const MH_TYPES = ["OR", "RR", "RD"];
  if (!MH_TYPES.includes(type)) {
    return { error: `Mantel-Haenszel pooling is only available for OR, RR, and RD (got "${type}").` };
  }
  if (studies[0]?.a === undefined) {
    return { error: "Mantel-Haenszel requires raw cell counts (a, b, c, d)." };
  }

  let est, varEst;
  let kEff = 0;  // studies that passed the per-type guard

  if (type === "OR") {
    let sumR = 0, sumS = 0;
    let sumPR = 0, sumPS_QR = 0, sumQS = 0;

    for (const s of studies) {
      const { a, b, c, d } = s;
      const N = a + b + c + d;
      if (N === 0) continue;
      const R = a * d / N;
      const S = b * c / N;
      const P = (a + d) / N;
      const Q = (b + c) / N;
      sumR      += R;
      sumS      += S;
      sumPR     += P * R;
      sumPS_QR  += P * S + Q * R;
      sumQS     += Q * S;
      kEff++;
    }

    if (kEff < 2) return { error: "Fewer than 2 studies contributed to the M-H OR estimate." };
    if (sumR === 0) return { error: "M-H OR is undefined: no events in the treatment arm across all studies." };
    if (sumS === 0) return { error: "M-H OR is undefined: no events in the control arm across all studies." };

    est     = Math.log(sumR / sumS);
    varEst  = sumPR / (2 * sumR * sumR)
            + sumPS_QR / (2 * sumR * sumS)
            + sumQS / (2 * sumS * sumS);

  } else if (type === "RR") {
    let sumR = 0, sumS = 0, sumC = 0;

    for (const s of studies) {
      const { a, b, c, d } = s;
      const n1 = a + b, n2 = c + d, N = n1 + n2;
      if (N === 0) continue;
      if (a + c === 0) continue;  // no events in either arm — contributes nothing
      const R = a * n2 / N;
      const S = c * n1 / N;
      const C = (n1 * n2 * (a + c) - a * c * N) / (N * N);
      sumR += R;
      sumS += S;
      sumC += C;
      kEff++;
    }

    if (kEff < 2) return { error: "Fewer than 2 studies contributed to the M-H RR estimate." };
    if (sumR === 0) return { error: "M-H RR is undefined: no events in the treatment arm across all studies." };
    if (sumS === 0) return { error: "M-H RR is undefined: no events in the control arm across all studies." };

    est    = Math.log(sumR / sumS);
    varEst = sumC / (sumR * sumS);

  } else {  // RD
    let sumW = 0, sumNum1 = 0, sumNum2 = 0;

    for (const s of studies) {
      const { a, b, c, d } = s;
      const n1 = a + b, n2 = c + d, N = n1 + n2;
      if (N === 0 || n1 === 0 || n2 === 0) continue;
      sumW    += n1 * n2 / N;                                  // Σw
      sumNum1 += a * n2 / N - c * n1 / N;                      // Σ(a·n2/N − c·n1/N) = Σw·RD
      // Sato et al. (1989) variance components:
      sumNum2 += c * (n1 / N) ** 2 - a * (n2 / N) ** 2
               + (n1 / N) * (n2 / N) * (n2 - n1) / 2;         // A term
      kEff++;
    }

    if (kEff < 2) return { error: "Fewer than 2 studies contributed to the M-H RD estimate." };
    if (sumW === 0) return { error: "M-H RD is undefined: total weight is zero." };

    est = sumNum1 / sumW;

    // Sato et al. numerator: beta·ΣA + ΣB/2  where B_i = a(n2-c)/N + c(n1-a)/N
    let sumB = 0;
    for (const s of studies) {
      const { a, b, c, d } = s;
      const n1 = a + b, n2 = c + d, N = n1 + n2;
      if (N === 0 || n1 === 0 || n2 === 0) continue;
      sumB += (a * (n2 - c) + c * (n1 - a)) / N;
    }
    varEst = (est * sumNum2 + sumB / 2) / (sumW * sumW);
  }

  if (!isFinite(est) || !isFinite(varEst) || varEst <= 0) {
    return { error: "M-H estimate is not finite — check for degenerate cell counts." };
  }

  const se = Math.sqrt(varEst);

  // Q from IV weights with M-H estimate as the null
  const df = k - 1;
  let Q = 0;
  for (const s of studies) Q += (s.yi - est) ** 2 / Math.max(s.vi, MIN_VAR);
  const I2 = (df > 0 && Q > 0) ? Math.max(0, Math.min(100, (Q - df) / Q * 100)) : 0;

  const hetCI = heterogeneityCIs(studies, 0);
  const stat  = est / se;
  const pval  = 2 * (1 - normalCDF(Math.abs(stat)));

  const mhCrit = normalQuantile(1 - alpha / 2);
  return {
    FE: est, seFE: se,
    ciLow:   est - mhCrit * se,
    ciHigh:  est + mhCrit * se,
    RE: NaN, seRE: NaN, tau2: NaN,
    tauCI:   hetCI.tauCI,
    I2CI:    hetCI.I2CI,
    H2CI:    hetCI.H2CI,
    Q, df, I2,
    predLow: NaN, predHigh: NaN,
    stat, pval, crit: mhCrit, dist: "z",
    isMH: true, k,
  };
}


// ================= PETO OR =================
// One-step Peto log-OR estimator for 2×2 OR data only.
// Most appropriate when events are rare and arm sizes are balanced.
// Based on observed-minus-expected counts and hypergeometric variance.
//
// Reference: Yusuf et al. (1985) Statistics in Medicine 4:127-144.
//   E_i = n₁·(a+c) / N
//   V_i = n₁·n₂·(a+c)·(b+d) / (N²·(N−1))
//   log OR_Peto = Σ(a − E_i) / ΣV_i
//   Var  = 1 / ΣV_i
//
// Q for heterogeneity: IV weights (1/vi) with Peto estimate as reference.
export function metaPeto(studies, alpha = 0.05) {
  const k = studies.length;
  if (k < 2) return { error: "Peto OR requires at least 2 studies." };
  if (studies[0]?.a === undefined) {
    return { error: "Peto OR requires raw cell counts (a, b, c, d)." };
  }

  let sumOmE = 0, sumV = 0, sumOmE2V = 0;
  let kEff   = 0;

  for (const s of studies) {
    const { a, b, c, d } = s;
    const n1 = a + b, n2 = c + d, N = n1 + n2;
    if (N <= 1) continue;
    const events     = a + c;
    const nonevents  = b + d;
    if (events === 0 || nonevents === 0) continue;  // V_i = 0; contributes nothing
    const E = n1 * events / N;
    const V = n1 * n2 * events * nonevents / (N * N * (N - 1));
    if (!isFinite(V) || V <= 0) continue;
    const omE = a - E;
    sumOmE   += omE;
    sumV     += V;
    sumOmE2V += omE * omE / V;  // Σ(a-E)²/V, used for Peto Q
    kEff++;
  }

  if (kEff < 2) return { error: "Fewer than 2 studies contributed to the Peto OR estimate." };
  if (sumV  === 0) return { error: "Peto OR is undefined: total hypergeometric variance is zero." };

  const est    = sumOmE / sumV;
  const varEst = 1 / sumV;

  if (!isFinite(est) || varEst <= 0) {
    return { error: "Peto OR estimate is not finite — check for degenerate cell counts." };
  }

  const se = Math.sqrt(varEst);

  // Q using Peto hypergeometric weights (matches R rma.peto QE):
  //   Q = Σ(a-E)²/V − (Σ(a-E))²/ΣV
  const df = k - 1;
  let Q = sumOmE2V - sumOmE * sumOmE / sumV;
  const I2 = (df > 0 && Q > 0) ? Math.max(0, Math.min(100, (Q - df) / Q * 100)) : 0;

  const hetCI = heterogeneityCIs(studies, 0);
  const stat  = est / se;
  const pval  = 2 * (1 - normalCDF(Math.abs(stat)));

  const petoCrit = normalQuantile(1 - alpha / 2);
  return {
    FE: est, seFE: se,
    ciLow:   est - petoCrit * se,
    ciHigh:  est + petoCrit * se,
    RE: NaN, seRE: NaN, tau2: NaN,
    tauCI:   hetCI.tauCI,
    I2CI:    hetCI.I2CI,
    H2CI:    hetCI.H2CI,
    Q, df, I2,
    predLow: NaN, predHigh: NaN,
    stat, pval, crit: petoCrit, dist: "z",
    isPeto: true, k,
  };
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

// ================= PMM (PAULE-MANDEL MEDIAN) TAU² =================
// Median-unbiased variant of the PM estimator. Same fixed-point iteration
// as PM but the target is the median of χ²(k−1) rather than its mean (k−1).
//
// PM  iterates until Q(τ²) = k−1          (sets Q to expected chi-square)
// PMM iterates until Q(τ²) = χ²₀.₅(k−1)  (sets Q to median chi-square)
//
// Because the median of χ²(k−1) < k−1 for k > 2, the fixed-point update
// τ² ← max(0, τ² + (Q − target) / W) drives τ² to a slightly larger value
// than PM, giving a median-unbiased estimate under the RE model.
export function tau2_PMM(studies, tol = REML_TOL, maxIter = 200) {
  const k = studies.length;
  if (k <= 1) return 0;

  const target = chiSquareQuantile(0.5, k - 1);
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
    const newTau2 = Math.max(0, tau2 + (Q - target) / W);
    if (Math.abs(newTau2 - tau2) < tol) return newTau2;
    tau2 = newTau2;
  }
  return tau2;
}

// ================= GENQM (GENERALISED Q, MEDIAN-UNBIASED) TAU² =================
// Median-unbiased generalised-Q estimator using fixed FE weights aᵢ = 1/vᵢ.
// Finds τ² such that the observed FE Q-statistic equals the median of its
// distribution under the RE model with heterogeneity τ².
//
// Under H(τ²): Q_FE ~ Σᵢ λᵢ(τ²) χ²(1), where λᵢ(τ²) are eigenvalues of
// S·P·S, P = diag(1/vᵢ) − (1/vᵢ)(1/vᵢ)'/W, S = diag(√(vᵢ+τ²)).
// For intercept-only models (p=1) S·P·S is a rank-1 perturbed diagonal matrix;
// its k−1 positive eigenvalues are found via the secular equation
//   Σ bᵢ²/(dᵢ − λ) = W,   dᵢ = (vᵢ+τ²)/vᵢ,   bᵢ² = (vᵢ+τ²)/vᵢ²
// The median of the weighted chi-square is approximated by a scaled χ²(ν)
// (Patnaik/Satterthwaite 2-moment method):   c·χ²₀.₅(ν),
// where c = Σλ²/(Σλ), ν = (Σλ)²/Σλ².
// This approximation introduces ~3–4 % error vs the exact Farebrother CDF
// but stays within the 5 % relative tolerance used by the benchmark tests.
export function tau2_GENQM(studies, tol = REML_TOL, maxIter = 200) {
  const k = studies.length;
  if (k <= 1) return 0;

  const vi = studies.map(d => d.vi);
  const yi = studies.map(d => d.yi);
  const wi = vi.map(v => 1 / v);
  const W  = wi.reduce((s, w) => s + w, 0);

  // Observed FE Q-statistic (constant — does not depend on τ²)
  const ybarFE = yi.reduce((s, y, i) => s + wi[i] * y, 0) / W;
  const Q_obs  = yi.reduce((s, y, i) => s + wi[i] * (y - ybarFE) ** 2, 0);
  if (Q_obs <= 0) return 0;

  // k−1 positive eigenvalues of S·P·S via secular equation (rank-1 case)
  function eigenvalues(tau2) {
    const d   = vi.map(v => (v + tau2) / v);       // dᵢ
    const b2  = vi.map(v => (v + tau2) / (v * v)); // bᵢ²

    // Sort indices so d is in decreasing order
    const idx = Array.from({ length: k }, (_, i) => i)
      .sort((a, b) => d[b] - d[a]);
    const ds  = idx.map(i => d[i]);
    const b2s = idx.map(i => b2[i]);

    const secular = lam =>
      b2s.reduce((s, b, i) => s + b / (ds[i] - lam), 0) - W;

    const lams = [];
    for (let i = 0; i < k - 1; i++) {
      const lo = ds[i + 1] + 1e-14;
      const hi = ds[i]     - 1e-14;
      if (secular(lo) >= 0 || secular(hi) <= 0) continue; // degenerate interval
      let a = lo, b = hi;
      for (let j = 0; j < 64; j++) {
        const m = (a + b) / 2;
        if (secular(m) < 0) a = m; else b = m;
      }
      lams.push((a + b) / 2);
    }
    return lams;
  }

  // 2-moment chi-sq approximation for median of Σλᵢ χ²(1)
  function approxMedian(tau2) {
    const lams = eigenvalues(tau2);
    if (lams.length === 0) return chiSquareQuantile(0.5, k - 1);
    const mu   = lams.reduce((s, l) => s + l, 0);
    const sig2 = 2 * lams.reduce((s, l) => s + l * l, 0);
    if (sig2 <= 0) return mu;
    const c = sig2 / (2 * mu);
    const nu = (2 * mu * mu) / sig2;
    return c * chiSquareQuantile(0.5, nu);
  }

  if (approxMedian(0) >= Q_obs) return 0;

  // Bisect on τ² to find where approxMedian(τ²) = Q_obs
  let lo = 0, hi = 1;
  while (approxMedian(hi) < Q_obs && hi < 1e6) hi *= 2;
  if (hi >= 1e6) return hi / 2; // fallback

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    if (approxMedian(mid) < Q_obs) lo = mid; else hi = mid;
    if (hi - lo < tol) break;
  }

  return Math.max(0, (lo + hi) / 2);
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

  const A  = weights.reduce((acc, a) => acc + a, 0);
  const ya = studies.reduce((acc, d, i) => acc + weights[i] * d.yi, 0) / A;
  const Qa = studies.reduce((acc, d, i) => acc + weights[i] * (d.yi - ya) ** 2, 0);

  const sumAV  = studies.reduce((acc, d, i) => acc + weights[i] * d.vi, 0);
  const sumA2V = studies.reduce((acc, d, i) => acc + weights[i] ** 2 * d.vi, 0);
  const sumA2  = weights.reduce((acc, a) => acc + a ** 2, 0);

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
  const WRE = wRE.reduce((acc, b) => acc + b, 0);
  return corrected.reduce((acc, d, i) => acc + wRE[i]*d.yi,0)/WRE;
}

// -------------------------------
// Compute FE mean
export function FE_mean(corrected) {
  const wFE = corrected.map(d => 1 / d.vi);
  const WFE = wFE.reduce((acc, b) => acc + b, 0);
  return corrected.reduce((acc, d, i) => acc + wFE[i]*d.yi,0)/WFE;
}

// -------------------------------
// Compute I² using fixed-effect weights (1/vi), matching metafor convention.
// tau2 is unused but kept for API compatibility.
export function I2(corrected, tau2) {
  const k = corrected.length;
  if (k <= 1) return 0;
  const wFE = corrected.map(d => 1 / d.vi);
  const W = wFE.reduce((acc, b) => acc + b, 0);
  const mu = corrected.reduce((acc, d, i) => acc + wFE[i] * d.yi, 0) / W;
  const Q = corrected.reduce((acc, d, i) => acc + wFE[i] * (d.yi - mu) ** 2, 0);
  return Math.max(0, Math.min(100, ((Q - (k - 1)) / Q) * 100));
}

// ================= EGGER TEST =================
export function eggerTest(studies){
  const k = studies.length;
  if(k < 3) return { intercept: NaN, slope: NaN, se: NaN, t: NaN, df: NaN, p: NaN };
  const Z = studies.map(d => d.yi / d.se);
  const X = studies.map(d => 1 / d.se);
  const meanX = X.reduce((acc, b) => acc + b, 0)/X.length, meanZ = Z.reduce((acc, b) => acc + b, 0)/Z.length;
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
  const result = { intercept, slope, se, t, df, p };

  // Cluster-robust extension: reads study.cluster (set by ui.js)
  const clusters = studies.map(s => s.cluster?.trim() || null);
  if (clusters.some(id => id)) {
    const X2d = studies.map((_, i) => [1, X[i]]);
    const wUnit = Array(k).fill(1);
    const rob = robustWlsResult(X2d, wUnit, Z, [intercept, slope], clusters);
    if (!rob.error) {
      result.robustInterceptSE = rob.robustSE[0];
      result.robustInterceptZ  = rob.robustZ[0];
      result.robustInterceptP  = rob.robustP[0];
      result.robustSlopeSE     = rob.robustSE[1];
      result.robustSlopeZ      = rob.robustZ[1];
      result.robustSlopeP      = rob.robustP[1];
      result.robustDf          = rob.df;
      result.clustersUsed      = rob.C;
      result.allSingletons     = rob.allSingletons;
    } else {
      result.robustError = rob.error;
    }
  }
  return result;
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

  // Rank on raw yi. Begg & Mazumdar (1994, eq. 2) suggest FE-centering, but
  // any common offset cancels in every pairwise sign(adjᵢ − adjⱼ), so
  // adj[i] = yi[i] is equivalent and requires no weight computation.
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

  const result = _wlsFinish(beta, vcov, ys, xs, ws, k - 2);

  // Cluster-robust extension: reads study.cluster (set by ui.js)
  const clusters = valid.map(s => s.cluster?.trim() || null);
  if (clusters.some(id => id)) {
    const rob = robustWlsResult(X, ws, ys, beta, clusters);
    if (!rob.error) {
      result.robustInterceptSE = rob.robustSE[0];
      result.robustInterceptZ  = rob.robustZ[0];
      result.robustInterceptP  = rob.robustP[0];
      result.robustSlopeSE     = rob.robustSE[1];
      result.robustSlopeZ      = rob.robustZ[1];
      result.robustSlopeP      = rob.robustP[1];
      result.robustDf          = rob.df;
      result.clustersUsed      = rob.C;
      result.allSingletons     = rob.allSingletons;
    } else {
      result.robustError = rob.error;
    }
  }
  return result;
}

// ================= PET-PEESE =================
// Two-stage pub-bias correction (Stanley & Doucouliagos 2014, J Econ Surveys 28:103-121;
// Stanley 2008, Oxford Bull Econ Stat 70:103-127).
//
// Stage 1 — FAT-PET (same WLS as fatPetTest):
//   yᵢ = β₀ + β₁·SEᵢ + εᵢ,  wᵢ = 1/vᵢ
//   If β₁ is significant (interceptP < 0.10) → evidence of bias → use PEESE.
//
// Stage 2 — PEESE (Precision-Effect Estimate with Standard Error):
//   yᵢ = γ₀ + γ₁·vᵢ  + εᵢ,  wᵢ = 1/vᵢ
//   γ₀ is the bias-corrected effect estimate (effect as vᵢ → 0).
//
// usePeese = (fat.interceptP < 0.10)
//
// Returns: { fat, peese, usePeese }
//   fat/peese each have the same shape as _wlsFinish output.
export function petPeeseTest(studies) {
  const fat = fatPetTest(studies);
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  let peese = _pubBiasNaN(k - 2);
  if (k >= 3 && !isNaN(fat.intercept)) {
    const ys = valid.map(s => s.yi);
    const xs = valid.map(s => s.vi);           // predictor is vᵢ, not SEᵢ
    const ws = valid.map(s => 1 / s.vi);
    const X  = xs.map(x => [1, x]);
    const { beta, vcov, rankDeficient } = wls(X, ys, ws);
    if (!rankDeficient) peese = _wlsFinish(beta, vcov, ys, xs, ws, k - 2);
  }
  const usePeese = isFinite(fat.interceptP) && fat.interceptP < 0.10;
  return { fat, peese, usePeese };
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
    ys.push((a - E) / sqrtV);
    xs.push(sqrtV);
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
  const xs = valid.map(s => 1 / getN(s));
  const ws = valid.map(s => 1 / s.vi);

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
    ys.push(Math.log((a * d) / (b * c)));
    xs.push(1 / Math.sqrt(ESS));
    ws.push(ESS);
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
    ys.push(y / se);
    xs.push(1 / se);
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
  const sumZ = valid.reduce((acc, d) => {
    const z = Math.abs(d.yi) / Math.sqrt(d.vi);
    return acc + z;
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
  const W  = w0.reduce((acc, b) => acc + b, 0);
  const FE = valid.reduce((acc, d, i) => acc + w0[i] * d.yi, 0) / W;
  const orwin = Math.max(0, k * (Math.abs(FE) - Math.abs(trivial)) / Math.abs(trivial));

  return { rosenthal, orwin, sumZ, z_crit, k };
}

// ================= HENMI-COPAS METHOD =================
/**
 * Henmi & Copas (2010) confidence interval robust to publication bias.
 *
 * Always uses DL tau² and FE weights (wi = 1/vi), matching metafor::hc().
 * The CI is centred on the FE estimate but accounts for potential small-study
 * bias by integrating over the conditional distribution of Q given the
 * ratio R = (theta_hat - mu) / sqrt(vb).
 *
 * Algorithm: Henmi M & Copas JB (2010). Confidence intervals for random
 *   effects meta-analysis and robustness to publication bias.
 *   Statistics in Medicine, 29(29), 2969–2983.
 *
 * Ported from metafor::hc.rma.uni (original code by Henmi & Copas,
 * modified by Michael Dewey).
 *
 * Returns: { beta, se, ci, tau2, t0, u0, k } or { error }
 */
export function henmiCopas(studies, alpha = 0.05) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  if (k < 3) return { error: "k < 3" };

  const yi = valid.map(s => s.yi);
  const vi = valid.map(s => s.vi);

  // FE weights (NOT RE weights — metafor hc() uses wi = 1/vi)
  const wi = vi.map(v => 1 / v);
  const W1 = wi.reduce((s, w) => s + w, 0);
  const W2 = wi.reduce((s, w) => s + w * w, 0) / W1;
  const W3 = wi.reduce((s, w) => s + w * w * w, 0) / W1;
  const W4 = wi.reduce((s, w) => s + w * w * w * w, 0) / W1;

  // FE estimate and Q statistic
  const beta = yi.reduce((s, y, i) => s + wi[i] * y, 0) / W1;
  const Q    = yi.reduce((s, y, i) => s + wi[i] * (y - beta) ** 2, 0);

  // DL tau² (always DL in HC, matching metafor)
  const tau2 = Math.max(0, (Q - (k - 1)) / (W1 - W2));

  // Variance of beta under RE model
  const vb  = (tau2 * W2 + 1) / W1;
  const se  = Math.sqrt(vb);

  // Variance/SD of ratio R
  const VR  = 1 + tau2 * W2;
  const SDR = Math.sqrt(VR);

  // Conditional mean of Q given R = r
  const EQ = r =>
    (k - 1) + tau2 * (W1 - W2) +
    tau2 ** 2 * ((1 / VR ** 2) * r * r - 1 / VR) * (W3 - W2 ** 2);

  // Conditional variance of Q given R = r
  const VQ = r => {
    const rsq      = r * r;
    const recipvr2 = 1 / VR ** 2;
    return (
      2 * (k - 1) +
      4 * tau2 * (W1 - W2) +
      2 * tau2 ** 2 * (W1 * W2 - 2 * W3 + W2 ** 2) +
      4 * tau2 ** 2 * (recipvr2 * rsq - 1 / VR) * (W3 - W2 ** 2) +
      4 * tau2 ** 3 * (recipvr2 * rsq - 1 / VR) * (W4 - 2 * W2 * W3 + W2 ** 3) +
      2 * tau2 ** 4 * (recipvr2 - 2 * (1 / VR ** 3) * rsq) * (W3 - W2 ** 2) ** 2
    );
  };

  // Gamma distribution params (shape/scale) as functions of r
  const shapeF = r => { const eq = EQ(r); const vq = VQ(r); return vq > 0 ? eq * eq / vq : NaN; };
  const scaleF = r => { const eq = EQ(r); const vq = VQ(r); return eq > 0 ? vq / eq : NaN; };

  // finv(f) = (W1/W2 − 1)·(f² − 1) + (k − 1)
  const finv = f => (W1 / W2 - 1) * (f * f - 1) + (k - 1);

  // pgamma(q, shape, scale) = regularizedGammaP(shape, q/scale)
  const pgamma = (q, shape, scale) => {
    if (!isFinite(q) || !isFinite(shape) || !isFinite(scale) || shape <= 0 || scale <= 0) {
      return q <= 0 ? 0 : 1;
    }
    if (q <= 0) return 0;
    return regularizedGammaP(shape, q / scale);
  };

  const SQRT2PI = Math.sqrt(2 * Math.PI);
  const dnorm   = x => Math.exp(-0.5 * x * x) / SQRT2PI;

  // Numerical integration ∫ₓ^∞ pgamma(finv(r/x), shape(SDR·r), scale(SDR·r))·φ(r) dr
  // via composite Simpson's rule (N=400 panels). dnorm decays to ~0 by r≈7,
  // so truncating at max(lo+0.01, 7) is safe for any practical x < 7.
  const integrate = x => {
    const lo = x;
    const hi = Math.max(lo + 0.01, 7.0);
    const N  = 400; // must be even
    const h  = (hi - lo) / N;
    let sum  = 0;
    for (let i = 0; i <= N; i++) {
      const r      = lo + i * h;
      const rv     = SDR * r;
      const fv     = finv(r / x);
      const pg     = pgamma(fv, shapeF(rv), scaleF(rv));
      const coeff  = (i === 0 || i === N) ? 1 : (i % 2 === 0 ? 2 : 4);
      sum += coeff * pg * dnorm(r);
    }
    return (sum * h) / 3;
  };

  // Solve eqn(t0) = 0  where  eqn(x) = ∫ₓ^∞ (…) dr − α/2
  // Root exists in (0, ∞); bracket: eqn(ε)≈0.5−α/2>0, eqn(large)<0.
  const halfAlpha = alpha / 2;
  const eqn = x => integrate(x) - halfAlpha;

  let lo = 1e-4, hi = 10;
  if (!isFinite(eqn(lo)) || !isFinite(eqn(hi)) || eqn(lo) < 0) {
    return { error: "HC: failed to bracket root" };
  }

  let t0 = (lo + hi) / 2;
  for (let iter = 0; iter < BISECTION_ITERS; iter++) {
    t0 = (lo + hi) / 2;
    const fmid = eqn(t0);
    if (Math.abs(fmid) < 1e-12 || (hi - lo) < 1e-14) break;
    if (fmid > 0) lo = t0; else hi = t0;
  }

  const u0 = SDR * t0;

  return {
    beta,
    se,
    ci:   [beta - u0 * se, beta + u0 * se],
    tau2,
    t0,
    u0,
    k,
  };
}

// ================= TEST OF EXCESS SIGNIFICANCE (TES) =================
/**
 * Ioannidis & Trikalinos (2007) test of excess significance.
 * Tests whether the observed number of statistically significant results
 * exceeds what is expected given the per-study power under the true effect θ.
 *
 * θ defaults to the RE pooled estimate m.RE (passed as the second argument).
 * Significance threshold is always α = 0.05 two-tailed (z_{0.025} ≈ 1.96).
 *
 * @param {{ yi: number, vi: number, label?: string }[]} studies
 * @param {{ RE: number }}                                m   — fitted meta object
 * @returns {{ O: number, E: number, Var: number, z: number, chi2: number,
 *             p: number, k: number, theta: number,
 *             powers: number[], sig: boolean[] }}
 */
export function tesTest(studies, m) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  const nan = { O: NaN, E: NaN, Var: NaN, z: NaN, chi2: NaN, p: NaN, k, theta: NaN, powers: [], sig: [] };
  if (k < 2 || !m || !isFinite(m.RE)) return nan;

  const theta = m.RE;
  const z025  = normalQuantile(0.975);   // ≈ 1.959964

  const powers = valid.map(s => {
    const se = Math.sqrt(s.vi);
    const ncp = Math.abs(theta) / se;
    // Two-tailed power: Φ(ncp − z) + Φ(−z − ncp)
    return normalCDF(ncp - z025) + normalCDF(-z025 - ncp);
  });

  const sig = valid.map(s => Math.abs(s.yi / Math.sqrt(s.vi)) > z025);

  const O   = sig.reduce((n, b) => n + (b ? 1 : 0), 0);
  const E   = powers.reduce((s, p) => s + p, 0);
  // Binomial-approximation variance: E*(1-E/k)  — matches metafor tes()
  const Var = E * (1 - E / k);

  if (Var <= 0) return nan;

  const z    = (O - E) / Math.sqrt(Var);
  const chi2 = z * z;
  // One-sided p for excess significance: p < 0.5 when O > E.
  // pval = 1 − Φ(z); when O < E, z < 0 and p > 0.5 (no excess).
  const p = 1 - normalCDF(z);

  return { O, E, Var, z, chi2, p, k, theta, powers, sig };
}

// ================= WAAP-WLS =================
/**
 * Weighted Average of Adequately Powered studies (Stanley & Doucouliagos 2015).
 *
 * Algorithm:
 *  1. Full WLS (FE precision weights wi = 1/vi) over all valid studies → μ̂_WLS.
 *  2. For each study compute two-tailed power to detect |μ̂_WLS| at α = 0.05.
 *  3. Keep studies with power ≥ 0.80 ("adequately powered").
 *  4. WAAP = WLS restricted to that subset.
 *     If no study qualifies (kAdequate = 0) fallback to the full WLS estimate.
 *
 * All estimates remain on the analysis scale (log scale for OR/RR/etc.);
 * call profile.transform() in the UI layer for display.
 *
 * @param {{ yi: number, vi: number }[]} studies
 * @returns {{ estimate, se, ci, z, p, k, kAdequate, wlsEstimate, fallback }}
 */
export function waapWls(studies) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k     = valid.length;
  const nan   = { estimate: NaN, se: NaN, ci: [NaN, NaN], z: NaN, p: NaN,
                  k, kAdequate: 0, wlsEstimate: NaN, fallback: false };
  if (k < 1) return nan;

  const z025 = normalQuantile(0.975);   // ≈ 1.95996

  // Step 1 — full WLS (intercept-only, weights wi = 1/vi)
  const W      = valid.reduce((s, d) => s + 1 / d.vi, 0);
  const wlsEst = valid.reduce((s, d) => s + d.yi / d.vi, 0) / W;

  // Step 2 — per-study power to detect |wlsEst| at two-tailed α = 0.05
  const adequate = valid.filter(d => {
    const ncp   = Math.abs(wlsEst) / Math.sqrt(d.vi);
    const power = normalCDF(ncp - z025) + normalCDF(-z025 - ncp);
    return power >= 0.80;
  });

  const kAdequate = adequate.length;
  const fallback  = kAdequate === 0;
  const subset    = fallback ? valid : adequate;

  // Step 3 — WLS on the adequate subset (or all studies if none qualify)
  const Wa   = subset.reduce((s, d) => s + 1 / d.vi, 0);
  const waap = subset.reduce((s, d) => s + d.yi / d.vi, 0) / Wa;
  const se   = Math.sqrt(1 / Wa);

  const z = waap / se;
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  const ci = [waap - z025 * se, waap + z025 * se];

  return { estimate: waap, se, ci, z, p, k, kAdequate, wlsEstimate: wlsEst, fallback };
}

/**
 * Common Language Effect Size (CLES / CL statistic / AUC).
 * P(X₁ > X₂) for two independent normal populations with equal variance
 * and standardised mean difference d.
 *
 * CL = Φ(d / √2)        (McGraw & Wong 1992)
 * CI: transform the d CI endpoints through the same function.
 *
 * @param {number} d   - pooled SMD (Hedges' g or Cohen's d, on analysis scale)
 * @param {number[]} ci - [lower, upper] CI for d
 * @returns {{ estimate: number, ci: number[] }}
 */
export function clES(d, ci) {
  const transform = x => normalCDF(x / Math.SQRT2);
  return {
    estimate: transform(d),
    ci: [transform(ci[0]), transform(ci[1])],
  };
}

// ================= INFLUENCE DIAGNOSTICS =================
/**
 * Leave-one-out influence diagnostics for a fitted meta-analysis.
 * @param {{ yi: number, vi: number, label?: string }[]} studies
 * @param {string} [method="DL"]       - τ² estimator (passed to meta()).
 * @param {string} [ciMethod="normal"] - CI method (passed to meta()).
 * @returns {{ label: string, RE_loo: number, tau2_loo: number, stdResidual: number,
 *             DFBETA: number, DFFITS: number, covRatio: number, deltaTau2: number,
 *             outlier: boolean, influential: boolean, highDffits: boolean,
 *             highCovRatio: boolean,
 *             hat: number, cookD: number, highLeverage: boolean, highCookD: boolean }[]}
 */
export function influenceDiagnostics(studies, method="DL", ciMethod="normal", alpha=0.05){
  const n = studies.length;
  if(n < 2) return [];
  const full = meta(studies, method, ciMethod, alpha);

  // Total RE weight W = Σ 1/(vi + τ²_full).
  // Computed directly from studies rather than via 1/seRE² because seRE
  // may be the KH-adjusted value (not equal to sqrt(1/W)) when ciMethod="KH".
  const W = studies.reduce((acc, d) => acc + 1 / (d.vi + full.tau2), 0);

  // ---- Sufficient-statistics precomputation for moment-estimator fast paths ----
  // Precomputing these sums once (O(k)) lets each per-study LOO τ²_loo be
  // computed in O(1) by subtracting the removed study from each sum.
  //
  // DL / GENQ / HS / HSk / DLIT all use FE inverse-variance weights (wi = 1/vi):
  //   dlSS.W_fe = Σwi      dlSS.WY  = Σwi·yi
  //   dlSS.WY2  = Σwi·yi²  dlSS.W2  = Σwi²
  //
  // DL:    τ² = max(0, (Q − (k−1)) / c),  Q = WY2 − WY²/W_fe, c = W_fe − W2/W_fe
  // GENQ:  identical to DL when default weights (aᵢ=1/vi) are used.
  // HS:    τ² = max(0, (Q − (k−1)) / W_fe)   (c replaced by W_fe)
  // HSk:   τ² = τ²_HS · k/(k−1)
  // DLIT:  fixed-point DL with RE-updated weights; seeds from τ²_DL_loo.
  //
  // HE (unweighted moments):
  //   heSS.SY = Σyi,  heSS.SY2 = Σyi²,  heSS.SV = Σvi
  //   τ²_HE = max(0, (Σ(yi−ȳ)²/(k−1)) − mean(vi))
  //
  // SQGENQ (aᵢ = √(1/vi)):
  //   sqSS.SA   = Σ√(1/vi),   sqSS.SAY = Σ√(1/vi)·yi,  sqSS.SAY2 = Σ√(1/vi)·yi²
  //   sqSS.SsV  = Σ√vi,       sqSS.W_fe = Σ(1/vi)  [= sumA2 = ΣaᵢΣ]
  //   τ²_SQGENQ from genqCore: Qa/ba/ca analogues after subtraction.

  const DL_SS_METHODS = new Set(["DL", "GENQ", "HS", "HSk", "DLIT"]);

  let dlSS = null;   // FE sums for DL/GENQ/HS/HSk/DLIT
  let heSS = null;   // unweighted sums for HE
  let sqSS = null;   // sqrt-weighted sums for SQGENQ

  if (DL_SS_METHODS.has(method)) {
    let W_fe = 0, WY = 0, WY2 = 0, W2 = 0;
    for (const d of studies) {
      const wi = 1 / d.vi;
      W_fe += wi; WY += wi * d.yi; WY2 += wi * d.yi * d.yi; W2 += wi * wi;
    }
    dlSS = { W_fe, WY, WY2, W2 };
  }

  if (method === "HE") {
    let SY = 0, SY2 = 0, SV = 0;
    for (const d of studies) { SY += d.yi; SY2 += d.yi * d.yi; SV += d.vi; }
    heSS = { SY, SY2, SV };
  }

  if (method === "SQGENQ") {
    let SA = 0, SAY = 0, SAY2 = 0, SsV = 0, W_fe = 0;
    for (const d of studies) {
      const ai = Math.sqrt(1 / d.vi);
      SA   += ai;
      SAY  += ai * d.yi;
      SAY2 += ai * d.yi * d.yi;
      SsV  += Math.sqrt(d.vi);
      W_fe += 1 / d.vi;   // sumA2 = Σaᵢ² = Σ(1/vi)
    }
    sqSS = { SA, SAY, SAY2, SsV, W_fe };
  }

  // PM fast-path: warm-start seed using exact Q_loo(τ²_full) in O(1).
  // Uses the algebraic identity Q = WY2 − WY²/W with RE weights at τ²_full.
  // Precompute WY_re = Σ wⱼyⱼ and WY2_re = Σ wⱼyⱼ² (W = Σwⱼ already in scope).
  let pmSS = null;
  if (method === "PM") {
    const tau2 = full.tau2;
    let WY_re = 0, WY2_re = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      WY_re += wi * d.yi; WY2_re += wi * d.yi * d.yi;
    }
    pmSS = { WY_re, WY2_re };   // W (= Σwⱼ at τ²_full) is already in outer scope
  }

  // SJ fast-path: warm-start seed = (k·τ²_full − sjContrib_i) / (k−1).
  // Relies on SJ convergence property: Σ vⱼ·rⱼ²/(vⱼ+τ²_SJ) = k·τ²_SJ
  // where rⱼ = yⱼ − μ̂ (RE mean at τ²_full).  sjContrib_i is study i's share.
  let sjSS = null;
  if (method === "SJ") {
    const tau2 = full.tau2, mu = full.RE;
    const perStudy = studies.map(d => d.vi * (d.yi - mu) ** 2 / (d.vi + tau2));
    sjSS = { totalSJ: n * tau2, perStudy };
  }

  // REML / ML / EBLUP fast path: one-step Newton seed + warm-start refinement.
  //
  // At τ²_full (convergence), S(τ²_full; all k) = 0.  The LOO score at τ²_full is
  //   S_loo_i(τ²_full) = −S_i(τ²_full)
  // and the LOO information is
  //   I_loo_i(τ²_full) = totalInfo − I_i(τ²_full).
  //
  // One-step Newton seed:
  //   τ²_seed = max(0, τ²_full + S_i / (totalInfo − I_i))
  // This is O(1) per study after an O(k) precompute.  Refinement from τ²_seed
  // via Newton (inline j≠idx loops) converges in 1–3 iterations rather than the
  // 50–100 iterations needed from the cold DL seed inside tau2_REML().
  //
  // Per-study contributions at τ²_full, wi = 1/(vi+τ²), hi = wi/W:
  //   REML/EBLUP:  S_i = ri²/vi_τ² − (1−hi)/vi_τ,  I_i = (1−hi)/vi_τ²
  //   ML:          S_i = ri²/vi_τ² − 1/vi_τ,         I_i = 1/vi_τ²

  const LIKEL_METHODS = new Set(["REML", "ML", "EBLUP"]);
  let likelSS = null;   // per-study { score_i, info_i } + totalInfo
  if (LIKEL_METHODS.has(method) && ciMethod !== "PL") {
    const tau2 = full.tau2;
    const RE   = full.RE;
    let totalInfo = 0;
    const perStudy = studies.map(d => {
      const vi_tau = d.vi + tau2;
      const wi     = 1 / vi_tau;
      const hi     = wi / W;   // W = Σ1/(vi+τ²_full) computed above the map
      const ri     = d.yi - RE;
      let score_i, info_i;
      if (method === "ML") {
        score_i = ri * ri / (vi_tau * vi_tau) - 1 / vi_tau;
        info_i  = 1 / (vi_tau * vi_tau);
      } else {  // REML (EBLUP aliases to REML in meta())
        score_i = ri * ri / (vi_tau * vi_tau) - (1 - hi) / vi_tau;
        info_i  = (1 - hi) / (vi_tau * vi_tau);
      }
      totalInfo += info_i;
      return { score_i, info_i };
    });
    likelSS = { perStudy, totalInfo };
  }

  // Fast path: exact τ²_loo + O(k) RE_loo/seRE_loo per study, no meta(loo) call.
  // Moment estimators: O(1) τ²_loo from sufficient-stat subtraction.
  // REML/ML/EBLUP: O(1) seed + O(k×few_iters) Newton refinement (warm start).
  // PM/SJ: O(1) warm-start seed + O(k×few_iters) fixed-point iteration.
  // PL always falls back to meta(loo) (requires the full likelihood surface).
  const FAST_PATH_METHODS = new Set([...DL_SS_METHODS, "HE", "SQGENQ", ...LIKEL_METHODS, "PM", "SJ"]);
  const useFastPath = FAST_PATH_METHODS.has(method) && ciMethod !== "PL";

  return studies.map((study, idx) => {
    let tau2_loo, RE_loo, seRE_loo;

    if (useFastPath) {
      // ---- Moment-estimator fast path (Steps 2–3) -------------------------
      // Compute τ²_loo in O(1) (O(k·iter) for DLIT) from precomputed sums.
      const wi_fe = 1 / study.vi;   // FE weight of study i

      if (method === "DL" || method === "GENQ") {
        // DL formula (GENQ with default aᵢ=1/vi is identical):
        //   τ² = max(0, (Q − (k−1)) / c),  Q = WY2 − WY²/W,  c = W − W2/W
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const W2_l  = dlSS.W2   - wi_fe * wi_fe;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        const c_l   = W_l   - W2_l / W_l;
        tau2_loo = c_l > 0 ? Math.max(0, (Q_l - (n - 2)) / c_l) : 0;

      } else if (method === "HS") {
        // HS:  τ² = max(0, (Q − (k−1)) / W_fe)  — denominator is W, not c.
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        tau2_loo = W_l > 0 ? Math.max(0, (Q_l - (n - 2)) / W_l) : 0;

      } else if (method === "HSk") {
        // HSk:  τ²_HSk_loo = τ²_HS_loo · k_loo/(k_loo−1) = τ²_HS_loo·(n−1)/(n−2)
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        const tau2_hs_l = W_l > 0 ? Math.max(0, (Q_l - (n - 2)) / W_l) : 0;
        tau2_loo = n > 2 ? tau2_hs_l * (n - 1) / (n - 2) : 0;

      } else if (method === "DLIT") {
        // DLIT: seed from τ²_DL_loo (O(1)), then iterate the DLIT fixed-point
        // formula using RE-updated weights.  No filter() allocation: index guard.
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const W2_l  = dlSS.W2   - wi_fe * wi_fe;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        const c_l   = W_l   - W2_l / W_l;
        let t2 = c_l > 0 ? Math.max(0, (Q_l - (n - 2)) / c_l) : 0;  // DL seed
        for (let iter = 0; iter < 200; iter++) {
          // Single O(k) pass using Q = WY2 − WY²/W identity (no second pass needed)
          let Wit = 0, W2it = 0, Wmuit = 0, WY2it = 0;
          for (let j = 0; j < n; j++) {
            if (j === idx) continue;
            const wj = 1 / (studies[j].vi + t2);
            Wit += wj; W2it += wj * wj; Wmuit += wj * studies[j].yi;
            WY2it += wj * studies[j].yi * studies[j].yi;
          }
          const Qit = WY2it - Wmuit * Wmuit / Wit;
          const cit = Wit - W2it / Wit;
          const newT2 = Math.max(0, (Qit - (n - 2)) / cit);
          if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
          t2 = newT2;
        }
        tau2_loo = t2;

      } else if (method === "HE") {
        // HE: τ² = max(0, SS/(k−1) − mean(vi))
        //     SS = SY2 − SY²/k  (unweighted sum of squared deviations)
        const k_l   = n - 1;
        const SY_l  = heSS.SY  - study.yi;
        const SY2_l = heSS.SY2 - study.yi * study.yi;
        const SV_l  = heSS.SV  - study.vi;
        const SS_l  = SY2_l - SY_l * SY_l / k_l;
        tau2_loo = k_l > 1 ? Math.max(0, SS_l / (k_l - 1) - SV_l / k_l) : 0;

      } else if (method === "SQGENQ") {
        // SQGENQ: genqCore with aᵢ = √(1/vi).
        // Sufficient-stat versions of genqCore quantities after removing study i:
        //   A_l     = SA   − aᵢ                  [Σaⱼ for j≠i]
        //   ya_l    = SAY_l / A_l                 [a-weighted mean]
        //   Qa_l    = SAY2_l − SAY_l²/A_l         [a-weighted Q]
        //   ba_l    = SsV_l − k_l / A_l           [Σaⱼvⱼ − Σaⱼ²vⱼ/A  = SsV_l − k_l/A_l]
        //   ca_l    = A_l   − Wfe_l / A_l         [A − sumA2/A]
        // where SsV_l = Σ√vⱼ (j≠i), Wfe_l = Σ(1/vⱼ) (j≠i), k_l = n−1.
        const ai    = Math.sqrt(wi_fe);   // aᵢ = √(1/vi)
        const k_l   = n - 1;
        const A_l   = sqSS.SA   - ai;
        const SAY_l = sqSS.SAY  - ai * study.yi;
        const SAY2_l= sqSS.SAY2 - ai * study.yi * study.yi;
        const SsV_l = sqSS.SsV  - Math.sqrt(study.vi);
        const Wfe_l = sqSS.W_fe - wi_fe;
        if (A_l <= 0) {
          tau2_loo = 0;
        } else {
          const Qa_l = SAY2_l - SAY_l * SAY_l / A_l;
          const ba_l = SsV_l  - k_l / A_l;
          const ca_l = A_l    - Wfe_l / A_l;
          tau2_loo = ca_l > 0 ? Math.max(0, (Qa_l - ba_l) / ca_l) : 0;
        }

      } else if (method === "PM") {
        // ---- PM fast path: warm-start fixed-point iteration ------------------
        // Seed: one PM step at τ²_full using exact Q_loo(τ²_full).
        // Q_loo(τ²_full) = WY2_l − WY_l²/W_l  (algebraic identity, O(1)).
        const wi  = 1 / (study.vi + full.tau2);
        const W_l = W - wi;
        const WY_l  = pmSS.WY_re  - wi * study.yi;
        const WY2_l = pmSS.WY2_re - wi * study.yi * study.yi;
        const Q_PM_l = W_l > 0 ? WY2_l - WY_l * WY_l / W_l : 0;
        let t2 = W_l > 0 ? Math.max(0, full.tau2 + (Q_PM_l - (n - 2)) / W_l) : full.tau2;
        // Warm-start PM iteration to full convergence.
        for (let iter = 0; iter < 100; iter++) {
          let Wit = 0, WYit = 0, WY2it = 0;
          for (let j = 0; j < n; j++) {
            if (j === idx) continue;
            const wj = 1 / (studies[j].vi + t2);
            Wit += wj; WYit += wj * studies[j].yi; WY2it += wj * studies[j].yi * studies[j].yi;
          }
          if (Wit <= 0) break;
          const Qit = WY2it - WYit * WYit / Wit;
          const newT2 = Math.max(0, t2 + (Qit - (n - 2)) / Wit);
          if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
          t2 = newT2;
        }
        tau2_loo = t2;

      } else if (method === "SJ") {
        // ---- SJ fast path: warm-start fixed-point iteration ------------------
        // Seed: (k·τ²_full − sjContrib_i) / (k−1).
        // Relies on SJ convergence identity: Σ vⱼ·rⱼ²/(vⱼ+τ²) = k·τ²_full.
        let t2 = Math.max(0, (sjSS.totalSJ - sjSS.perStudy[idx]) / (n - 1));
        // Warm-start SJ iteration to full convergence (two O(k) passes per iter).
        for (let iter = 0; iter < 200; iter++) {
          let Wit = 0, WYit = 0;
          for (let j = 0; j < n; j++) {
            if (j === idx) continue;
            const wj = 1 / (studies[j].vi + t2);
            Wit += wj; WYit += wj * studies[j].yi;
          }
          if (Wit <= 0) break;
          const mu_it = WYit / Wit;
          let s = 0;
          for (let j = 0; j < n; j++) {
            if (j === idx) continue;
            const rj = studies[j].yi - mu_it;
            s += studies[j].vi * rj * rj / (studies[j].vi + t2);
          }
          const newT2 = Math.max(0, s / (n - 1));
          if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
          t2 = newT2;
        }
        tau2_loo = t2;

      } else if (method === "REML" || method === "ML" || method === "EBLUP") {
        // ---- REML / ML / EBLUP fast path (Step 4) --------------------------
        // One-step Newton seed: τ²_seed = max(0, τ²_full + S_i / (totalInfo − I_i))
        const { score_i, info_i } = likelSS.perStudy[idx];
        const infoLoo = likelSS.totalInfo - info_i;
        let t2 = infoLoo > 0
          ? Math.max(0, full.tau2 + score_i / infoLoo)
          : full.tau2;

        // Newton refinement from t2 (warm start → typically 1–3 iters).
        // Two O(k) passes per iteration: first for W/mu, then for score/info.
        const isREML = method !== "ML";  // REML and EBLUP use (1−hi) correction
        for (let iter = 0; iter < 100; iter++) {
          let W_it = 0, Wmu_it = 0;
          for (let j = 0; j < n; j++) {
            if (j === idx) continue;
            const wj = 1 / (studies[j].vi + t2);
            W_it += wj; Wmu_it += wj * studies[j].yi;
          }
          if (W_it <= 0) break;
          const mu_it = Wmu_it / W_it;
          let sc = 0, inf_it = 0;
          for (let j = 0; j < n; j++) {
            if (j === idx) continue;
            const vi_tau = studies[j].vi + t2;
            const rj = studies[j].yi - mu_it;
            if (isREML) {
              const hj = 1 / (vi_tau * W_it);
              sc      += rj * rj / (vi_tau * vi_tau) - (1 - hj) / vi_tau;
              inf_it  += (1 - hj) / (vi_tau * vi_tau);
            } else {
              sc      += rj * rj / (vi_tau * vi_tau) - 1 / vi_tau;
              inf_it  += 1 / (vi_tau * vi_tau);
            }
          }
          if (inf_it <= 0) break;
          let step = sc / inf_it;
          let newT2 = t2 + step;
          let sh = 0;
          while (newT2 < 0 && sh++ < 20) { step /= 2; newT2 = t2 + step; }
          newT2 = Math.max(0, newT2);
          if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
          t2 = newT2;
        }
        tau2_loo = t2;
      }

      // RE_loo and seRE_loo in O(k) via one RE-weighted pass at τ²_loo.
      //   W_RE_l   = Σ_{j≠i} 1/(vj + τ²_loo)
      //   WY_RE_l  = Σ_{j≠i} yj/(vj + τ²_loo)
      //   WY2_RE_l = Σ_{j≠i} yj²/(vj + τ²_loo)   (needed for KH adjustment)
      let W_RE_l = 0, WY_RE_l = 0, WY2_RE_l = 0;
      for (let j = 0; j < n; j++) {
        if (j === idx) continue;
        const s  = studies[j];
        const wj = 1 / Math.max(s.vi + tau2_loo, MIN_VAR);
        W_RE_l   += wj;
        WY_RE_l  += wj * s.yi;
        WY2_RE_l += wj * s.yi * s.yi;
      }

      RE_loo = W_RE_l > 0 ? WY_RE_l / W_RE_l : NaN;

      // seRE_loo depends on ciMethod:
      //   KH:     seRE = sqrt(max(Σ w*(y-RE)², 0) / (df * W))
      //           where Σ w*(y-RE)² = WY2 - WY²/W  (algebraic identity)
      //           and df = k_loo - 1 = n - 2
      //   normal / t:  seRE = 1 / sqrt(W_RE_l)  (t just changes the critical value)
      const df_loo = n - 2;
      if (ciMethod === "KH" && df_loo > 0) {
        const sumKH = WY2_RE_l - WY_RE_l * WY_RE_l / W_RE_l;
        seRE_loo = Math.sqrt(Math.max(sumKH, 0) / (df_loo * W_RE_l));
      } else {
        seRE_loo = W_RE_l > 0 ? Math.sqrt(1 / W_RE_l) : NaN;
      }

    } else {
      // ---- Full meta(loo) for likelihood-based methods or ciMethod="PL" ----
      const loo = studies.filter((_, i) => i !== idx);
      const looMeta = meta(loo, method, ciMethod, alpha);
      tau2_loo = looMeta.tau2;
      RE_loo   = looMeta.RE;
      seRE_loo = looMeta.seRE;
    }

    const r = (study.yi - full.RE) / Math.sqrt(study.vi + full.tau2);
    const dfbeta = (full.RE - RE_loo) / seRE_loo;
    const deltaTau2 = full.tau2 - tau2_loo;
    const outlier = Math.abs(r) > 2;
    const influential = Math.abs(dfbeta) > 1;

    // Hat value: h_i = w_i / W  (fraction of total RE weight held by study i)
    const wi  = 1 / (study.vi + full.tau2);
    const hat = wi / W;

    // Covariance ratio: ratio of the determinant of the variance-covariance
    // matrix of μ̂ with study i removed vs. full dataset. For p=1 (intercept-only):
    //   covRatio_i = Var(μ̂_loo,i) / Var(μ̂_full) = W_full / W_loo,i
    // where W_loo,i = Σ_{j≠i} 1/(v_j + τ²_loo,i) uses the LOO τ².
    // Verified against metafor 4.8-0 influence.rma.uni() to ≤ 1.78e-15.
    const W_loo = studies.reduce((acc, s, j) => j === idx ? acc : acc + 1 / (s.vi + tau2_loo), 0);
    const covRatio = W_loo > 0 ? W / W_loo : NaN;

    // Cook's distance: D_i = (RE_full − RE_loo)² × W
    // Equivalent to (RE_full − RE_loo)² / Var(RE_full) where Var = 1/W.
    // Measures how far the pooled estimate moves (in SE units) on study removal.
    const cookD = (full.RE - RE_loo) ** 2 * W;

    // DFFITS: standardised change in fitted value on study removal.
    // Formula from metafor influence.rma.uni() (s2w = 1 for RE models):
    //   DFFITS_i = (μ̂ − μ̂_{−i}) / sqrt(h_i · (τ²_{−i} + v_i))
    // Verified against metafor 4.8-0 to floating-point precision.
    // Differs from DFBETA (which standardises by seRE_loo = 1/sqrt(W_loo));
    // DFFITS also accounts for the leverage h_i and the LOO total study variance.
    const dffitsVar = hat * (tau2_loo + study.vi);
    const DFFITS = dffitsVar > 0 ? (full.RE - RE_loo) / Math.sqrt(dffitsVar) : NaN;

    // Flagging thresholds (regression-analogy)
    const highLeverage = hat  > 2 / n;   // h_i > 2/k
    const highCookD    = cookD > 4 / n;  // D_i > 4/k
    // DFFITS threshold: 3·√(1/(k−1)) — metafor convention (p=1, k studies)
    const dffitsThresh = 3 * Math.sqrt(1 / (n - 1));
    const highDffits   = isFinite(DFFITS) && Math.abs(DFFITS) > dffitsThresh;
    // CovRatio threshold: (1 + p/k)^p = 1 + 1/k for p=1 — metafor convention
    const highCovRatio = isFinite(covRatio) && covRatio > 1 + 1 / n;

    return {
      label: study.label,
      RE_loo,
      tau2_loo,
      stdResidual: r,
      DFBETA: dfbeta,
      DFFITS,
      covRatio,
      deltaTau2,
      outlier,
      influential,
      hat,
      cookD,
      highLeverage,
      highCookD,
      highDffits,
      highCovRatio,
    };
  });
}

// ================= SUBGROUP =================
export function subgroupAnalysis(studies, method="REML", ciMethod="normal", alpha=0.05) {
  const valid = studies.filter(s => s && isFinite(s.yi) && isFinite(s.vi) && s.group != null && s.group !== "");
  const kNoGroup = studies.filter(s => s && isFinite(s.yi) && isFinite(s.vi) && (s.group == null || s.group === "")).length;
  if(valid.length < 2) return null;
  const groups = {};
  valid.forEach(s => { const g = String(s.group).trim(); if(!g) return; if(!groups[g]) groups[g]=[]; groups[g].push(s); });
  const groupNames = Object.keys(groups);
  if(groupNames.length < 2) return null;
  const overall = meta(valid, method, ciMethod, alpha);
  const sgCrit = normalQuantile(1 - alpha / 2);
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
        ciLow: s.yi - sgCrit * Math.sqrt(s.vi),
        ciHigh: s.yi + sgCrit * Math.sqrt(s.vi),
        tau2: 0,
        I2: 0,
        Q: 0
      };
    } else {
      res = meta(groupStudies, method, ciMethod, alpha);
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
  return { groups: results, Qbetween, df, p, k: valid.length, G: groupNames.length, kNoGroup };
}

// ================= Q-PROFILE HETEROGENEITY CIs =================
// Weighted Q statistic as a function of τ². Monotone decreasing in τ²;
// equals Q_FE when τ² = 0.
function qProfile(tau2, studies) {
  const w  = studies.map(d => 1 / (d.vi + tau2));
  const W  = w.reduce((acc, b) => acc + b, 0);
  const mu = studies.reduce((acc, d, i) => acc + w[i] * d.yi, 0) / W;
  return studies.reduce((acc, d, i) => acc + w[i] * (d.yi - mu) ** 2, 0);
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
  // Convert τ²CI bounds to I²/H²CI using the τ²-based formula
  // (Higgins & Thompson 2002, Stat Med 21:1539–1558, eq. 9 rearranged):
  //   σ²_typical = (k−1) / Σ(1/vᵢ)   — "typical" within-study variance
  //   I² = τ² / (τ² + σ²_typical) × 100 %
  //   H² = τ² / σ²_typical + 1
  // This τ²-based form is used here (not the Q-based formula used in meta())
  // because the input is already a τ² value from the Q-profile inversion.
  // The two formulas agree when τ² = τ²_DL; they diverge for REML/ML.
  const sumWFE = studies.reduce((acc, d) => acc + 1 / d.vi, 0);
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
// Shallow memo: WeakMap<studies[], Map<"method::ciMethod", result>>.
// A WeakMap entry is GC'd automatically when the studies array is released
// (i.e. after each runAnalysis() cycle), so no manual invalidation is needed.
const _metaCache = new WeakMap();
/**
 * Fit fixed-effect and random-effects meta-analysis models.
 * @param {{ yi: number, vi: number }[]} studies    - Per-study effect sizes and variances.
 * @param {string} [method="DL"]       - τ² estimator: "DL","REML","PM","ML","HS","HE","SJ","GENQ","HSk","DLIT","SQGENQ","EBLUP".
 * @param {string} [ciMethod="normal"] - CI method: "normal","t","kr","hksj".
 * @returns {{ FE: number, seFE: number, RE: number, seRE: number,
 *             tau2: number, Q: number, df: number, I2: number,
 *             tauCI: number[], I2CI: number[], H2CI: number[],
 *             predLow: number, predHigh: number,
 *             ciLow: number, ciHigh: number,
 *             crit: number, stat: number, pval: number, dist: string|null }}
 */
export function meta(studies, method="DL", ciMethod="normal", alpha=0.05) {
  // Cache check — same array reference + same method/ciMethod/alpha → return cached result.
  const _cacheKey = `${method}::${ciMethod}::${alpha}`;
  let _byMethod = _metaCache.get(studies);
  if (_byMethod?.has(_cacheKey)) return _byMethod.get(_cacheKey);

  const k = studies.length;
  if(k === 0){
    return { FE: NaN, seFE: NaN, RE: NaN, seRE: NaN, tau2:0, Q:NaN, df:0, I2:0, predLow:NaN, predHigh:NaN, ciLow:NaN, ciHigh:NaN, crit:NaN, stat:NaN, pval:NaN, dist:null };
  }

  // ---------- FIXED EFFECT ----------
  const wFE = studies.map(d => 1 / Math.max(d.vi, MIN_VAR));
  const W = wFE.reduce((acc, b) => acc + b, 0);
  const FE = W > 0 ? studies.reduce((acc, d, i) => acc + d.yi * wFE[i], 0)/W : NaN;
  const seFE = W > 0 ? Math.sqrt(1/W) : NaN;

  // Cochran's Q statistic (FE weights, Higgins & Thompson 2002, eq. 3):
  //   Q = Σᵢ wᵢ (yᵢ − FE)²,  wᵢ = 1/vᵢ,  df = k − 1.
  let Q = 0;
  for(let i=0;i<k;i++){ Q += wFE[i]*Math.pow(studies[i].yi - FE,2); }
  const dfQ = k-1;

  // I² — proportion of total variance due to between-study heterogeneity.
  // Q-based formula (Higgins & Thompson 2002, Stat Med 21:1539–1558, eq. 9):
  //   I² = max(0, (Q − (k−1)) / Q) × 100 %
  // This is equivalent to τ²_DL / (τ²_DL + σ²_typical) when method = "DL",
  // but is applied uniformly here regardless of the τ² estimator for
  // consistency across methods.
  //
  // Note: metafor uses this Q-based formula for moment estimators (DL, HS, HE)
  // but switches to the τ²-based formula I² = τ² / (τ² + σ²_typical) for
  // likelihood estimators (REML, ML).  Using the Q-based formula throughout
  // means I² is insensitive to the choice of τ² estimator — a deliberate
  // trade-off.  The I²CI bounds in heterogeneityCIs() are τ²-based, so when
  // τ² > 0 the point estimate and CI bounds may use different formulas.
  let I2 = 0;
  if(Q>dfQ && Q>0) I2 = ((Q-dfQ)/Q)*100;
  I2 = Math.max(0, Math.min(100,I2));

  let tau2 = 0;
	if      (method === "REML") tau2 = tau2_REML(studies, 1e-12, 500);
	else if (method === "PM")     tau2 = tau2_PM(studies);
	else if (method === "PMM")    tau2 = tau2_PMM(studies);
	else if (method === "GENQM")  tau2 = tau2_GENQM(studies);
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
		const sumW2 = wFE.reduce((acc, w) => acc + w * w, 0);
		const C = W - (sumW2/W);
		tau2 = C>0 ? Math.max(0, (Q-dfQ)/C) : 0;
	}

  // ---------- RANDOM EFFECT ----------
  const wRE = studies.map(d => 1 / Math.max(d.vi + tau2, MIN_VAR));
  const WRE = wRE.reduce((acc, b) => acc + b, 0);
  const RE = WRE>0 ? studies.reduce((acc, d, i) => acc + d.yi * wRE[i], 0)/WRE : NaN;
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

	  crit = tCritical(df, alpha);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

	} else if (ciMethod === "t" && k > 1) {
	  // --- t-distribution (no variance adjustment) ---
	  const df = k - 1;

	  crit = tCritical(df, alpha);
	  stat = RE / seRE;
	  dist = "t";
	  pval = 2 * (1 - tCDF(Math.abs(stat), df));

	} else {
	  // --- Normal (Wald) ---
	  crit = normalQuantile(1 - alpha / 2);
	  stat = RE / seRE;
	  dist = "z";
	  pval = k <= 1 ? NaN : 2 * (1 - normalCDF(Math.abs(stat)));
	}

  // Prediction interval: Higgins et al. (2009), t_{k-2} quantile.
  // Requires k >= 3 (df = k-2 >= 1). Uses base seRE, not KH-adjusted.
  const predVar = seRE_base * seRE_base + tau2;
  const predCrit = k >= 3 ? tCritical(k - 2, alpha) : NaN;

  // Q-profile CIs for τ², I², H²
  const hetCI = heterogeneityCIs(studies, tau2, alpha);

  // CI bounds — overridden below for profile likelihood.
  let ciLow  = RE - crit * seRE;
  let ciHigh = RE + crit * seRE;

  if (ciMethod === "PL" && k > 1) {
    // Profile likelihood CI: invert the LR test using ML internally.
    // Point estimate and p-value remain Wald-based.
    const plCI = profileLikCI(studies, alpha);
    ciLow  = plCI[0];
    ciHigh = plCI[1];
  }

  const _result = {
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
  if (!_byMethod) { _byMethod = new Map(); _metaCache.set(studies, _byMethod); }
  _byMethod.set(_cacheKey, _result);
  return _result;
}

// ================= RESTRICTED CUBIC SPLINE HELPERS =================
/**
 * Compute knot positions for a restricted cubic spline using Harrell's
 * recommended percentile-based placement.
 *   3 knots → {10, 50, 90}th percentiles
 *   4 knots → {5, 35, 65, 95}th percentiles
 *   5 knots → {5, 27.5, 50, 72.5, 95}th percentiles
 * @param {number[]} values - array of predictor values (NaN entries ignored)
 * @param {number}   nKnots - 3, 4, or 5
 * @returns {number[]} sorted knot positions
 */
export function rcsKnots(values, nKnots) {
  const pctMap = {
    3: [10, 50, 90],
    4: [5, 35, 65, 95],
    5: [5, 27.5, 50, 72.5, 95],
  };
  const pcts = pctMap[nKnots];
  if (!pcts) throw new Error(`rcsKnots: nKnots must be 3, 4, or 5; got ${nKnots}`);

  const sorted = values.filter(isFinite).slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return pcts.map(() => NaN);

  return pcts.map(p => {
    const idx = (p / 100) * (n - 1);
    const lo  = Math.floor(idx);
    const hi  = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
  });
}

/**
 * Evaluate the restricted cubic spline (RCS) nonlinear basis columns for a
 * single x value given a set of knots, using Harrell's formula.
 *
 * For k knots t[0]…t[k-1], produces k-2 nonlinear columns φ₁…φ_{k-2}:
 *   φ_j(x) = (x − t_j)³₊
 *             − (t_{k-1} − t_j)/(t_{k-1} − t_{k-2}) · (x − t_{k-2})³₊
 *             + (t_{k-2} − t_j)/(t_{k-1} − t_{k-2}) · (x − t_{k-1})³₊
 * for j = 0, 1, …, k-3.
 *
 * Note: the linear term (x itself) is NOT included here; buildDesignMatrix
 * adds x as its own column and then appends the rcsBasis columns.
 *
 * @param {number}   x     - predictor value
 * @param {number[]} knots - k knot positions (k = 3, 4, or 5)
 * @returns {number[]} array of k-2 nonlinear basis values
 */
export function rcsBasis(x, knots) {
  const k   = knots.length;          // total number of knots
  const tk  = knots[k - 1];          // last knot
  const tk1 = knots[k - 2];          // second-to-last knot
  const denom = tk - tk1;

  const pos3 = t => {
    const d = x - t;
    return d > 0 ? d * d * d : 0;
  };

  const result = [];
  for (let j = 0; j <= k - 3; j++) {
    const tj = knots[j];
    const phi = pos3(tj)
      - ((tk - tj) / denom) * pos3(tk1)
      + ((tk1 - tj) / denom) * pos3(tk);
    result.push(phi);
  }
  return result;
}

// ================= META-REGRESSION DESIGN MATRIX =================
// Builds the k×p design matrix X for meta-regression.
//
// moderators: array of { key: string, type: "continuous"|"categorical",
//                        transform?: "linear"|"poly2"|"poly3"|"rcs3"|"rcs4"|"rcs5" }
//   key       — property name on each study object
//   type      — "continuous" (read as number) or "categorical" (dummy-coded)
//   transform — nonlinear transform for continuous moderators (default "linear")
//
// Returns:
//   X         — k×p row-major matrix (array of k rows, each a p-length array)
//   colNames  — p column labels; first is always "intercept"
//   refLevels — maps each categorical key to its (dropped) reference level
//   modColMap — maps each moderator key to the column indices it occupies in X
//               e.g. continuous "age" (linear) → [2]
//                    continuous "age" (poly2)  → [2, 3]  (x, x²)
//                    categorical "type" (3 lvl)→ [3, 4]
//               degenerate moderators (< 2 levels) map to []
//   modKnots  — maps moderator key to knot array (only set for rcs* transforms)
//   validMask — k booleans; true when all entries in that row are finite
//   k, p      — matrix dimensions
export function buildDesignMatrix(studies, moderators = []) {
  const k = studies.length;

  // Build column-by-column, then transpose to row-major at the end.
  const columns  = [Array(k).fill(1)];  // intercept
  const colNames = ["intercept"];
  const refLevels = {};
  const modColMap = {};
  const modKnots  = {};
  let nextColIdx = 1;  // intercept occupies index 0

  for (const { key, type, transform = "linear" } of moderators) {
    const raw = studies.map(s => s[key]);

    if (type === "categorical") {
      // Unique non-null levels, sorted so the reference is deterministic.
      const levels = [...new Set(raw.filter(v => v != null && v !== ""))].sort();
      if (levels.length < 2) {
        modColMap[key] = [];  // degenerate — no columns added
        continue;
      }

      refLevels[key] = levels[0];
      modColMap[key] = [];

      for (const level of levels.slice(1)) {
        // Missing values become NaN so validMask catches them.
        columns.push(raw.map(v => (v == null || v === "") ? NaN : (v === level ? 1 : 0)));
        colNames.push(`${key}:${level}`);
        modColMap[key].push(nextColIdx++);
      }

    } else {
      // Continuous: coerce to number; non-numeric (including undefined) → NaN.
      const xVals = raw.map(v => +v);

      if (transform === "poly2") {
        // x and x²
        columns.push(xVals);
        columns.push(xVals.map(v => v * v));
        colNames.push(key, `${key}²`);
        modColMap[key] = [nextColIdx, nextColIdx + 1];
        nextColIdx += 2;

      } else if (transform === "poly3") {
        // x, x², x³
        columns.push(xVals);
        columns.push(xVals.map(v => v * v));
        columns.push(xVals.map(v => v * v * v));
        colNames.push(key, `${key}²`, `${key}³`);
        modColMap[key] = [nextColIdx, nextColIdx + 1, nextColIdx + 2];
        nextColIdx += 3;

      } else if (transform === "rcs3" || transform === "rcs4" || transform === "rcs5") {
        const nKnots = parseInt(transform.slice(3), 10);  // 3, 4, or 5
        const knots  = rcsKnots(xVals, nKnots);
        modKnots[key] = knots;

        // Linear term
        columns.push(xVals);
        colNames.push(key);
        modColMap[key] = [nextColIdx++];

        // Nonlinear RCS terms (nKnots - 2 columns)
        const nNL = nKnots - 2;
        for (let j = 0; j < nNL; j++) {
          columns.push(xVals.map(v => isFinite(v) ? rcsBasis(v, knots)[j] : NaN));
          colNames.push(`${key}_rcs${j + 1}`);
          modColMap[key].push(nextColIdx++);
        }

      } else {
        // Default: linear
        columns.push(xVals);
        colNames.push(key);
        modColMap[key] = [nextColIdx++];
      }
    }
  }

  const p = columns.length;

  // Transpose: X[i][j] = study i, column j.
  const X = Array.from({ length: k }, (_, i) => columns.map(col => col[i]));

  // A row is valid only when every entry is finite (no NaN / ±Infinity).
  const validMask = X.map(row => row.every(isFinite));

  return { X, colNames, refLevels, modColMap, modKnots, validMask, k, p };
}

// ================= WEIGHTED LEAST SQUARES =================
/**
 * Weighted least squares: fit y = X·β with diagonal weight matrix W = diag(w).
 * Called at every τ² iteration inside metaRegression, so kept lean.
 * @param {number[][]} X - k×p row-major design matrix (from buildDesignMatrix).
 * @param {number[]}   y - k-length array of effect sizes.
 * @param {number[]}   w - k-length array of weights (typically 1/(vi + τ²)).
 * @returns {{ beta: number[], vcov: number[][], rankDeficient: boolean }}
 *   beta: p-length coefficient vector;
 *   vcov: p×p variance-covariance matrix = (X'WX)⁻¹;
 *   rankDeficient: true when X'WX is singular (all results NaN-filled).
 */
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
  const beta = inv.map(row => row.reduce((acc, v, j) => acc + v * XtWy[j], 0));

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

// log|det(A)| via partial-pivoting Gaussian elimination.
// A must be square and positive definite (used only for X'WX, which always is).
// Returns -Infinity if the matrix is (near-)singular.
function logDet(A) {
  const n = A.length;
  const M = A.map(row => row.slice());
  let logd = 0;
  for (let i = 0; i < n; i++) {
    let maxVal = Math.abs(M[i][i]), maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxVal) { maxVal = Math.abs(M[k][i]); maxRow = k; }
    }
    if (maxRow !== i) [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-15) return -Infinity;
    logd += Math.log(Math.abs(M[i][i]));
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return logd;
}

// ================= TAU² FOR META-REGRESSION =================

function dot(a, b) {
  return a.reduce((acc, v, i) => acc + v * b[i], 0);
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
  const QE = yi.reduce((acc, y, i) => {
    const e = y - dot(X[i], beta);
    return acc + w0[i] * e * e;
  }, 0);
  const c = w0.reduce((acc, wi, i) => acc + wi * (1 - wi * quadForm(vcov, X[i])), 0);
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
    const QE = yi.reduce((acc, y, i) => {
      const e = y - dot(X[i], beta);
      return acc + w[i] * e * e;
    }, 0);
    const sumW = w.reduce((acc, b) => acc + b, 0);
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
  const QE  = yi.reduce((acc, y, i) => acc + w0[i] * (y - dot(X[i], beta)) ** 2, 0);
  const sumW = w0.reduce((acc, b) => acc + b, 0);
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
  const SS   = yi.reduce((acc, y, i) => acc + (y - dot(X[i], beta)) ** 2, 0);
  const meanV = vi.reduce((acc, b) => acc + b, 0) / k;
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
  let tau2 = yi.reduce((acc, y, i) => acc + (y - dot(X[i], beta0)) ** 2, 0) / k;
  if (tau2 === 0) return 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const w  = vi.map(v => 1 / (v + tau2));
    const { beta, rankDeficient: rd } = wls(X, yi, w);
    if (rd) break;
    const newTau2 = yi.reduce((acc, y, i) => {
      return acc + vi[i] * (y - dot(X[i], beta)) ** 2 / (vi[i] + tau2);
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
//   QM         — omnibus test for all moderators jointly (Wald chi-sq or F)
//   QMdf       — df for QM (p − 1, i.e. excluding intercept)
//   QMp        — p-value for QM
//   modTests   — per-moderator omnibus tests (one entry per input moderator):
//                  { name, colIdxs, QM, QMdf, QMp }
//                Same chi-sq/F logic as the global QM but restricted to each
//                moderator's own columns.  Identical to global QM when there is
//                exactly one moderator.  QMdf = 0 for degenerate moderators.
//   vif        — p-length array; vif[0] = NaN (intercept), vif[j] = VIF for
//                column j.  VIF_j = 1/(1 − R²_j) where R²_j is from unweighted
//                OLS of X[:,j] on all other columns.  NaN when the auxiliary
//                regression is rank-deficient or the column is constant.
//                VIF = 1 with a single predictor (no collinearity possible).
//   maxVIF     — max of vif[1..p-1]; 0 when p ≤ 1; NaN entries excluded.
//   I2         — residual I² (%)
//   colNames   — column names matching beta
//   k          — number of studies used
//   p          — number of parameters
//   rankDeficient — true if design matrix was singular
/**
 * Fit a random-effects meta-regression model via WLS/REML.
 * Full return-value documentation in the block comment above.
 * @param {{ yi: number, vi: number, [key: string]: * }[]} studies
 * @param {{ key: string, type: "continuous"|"categorical" }[]} [moderators=[]]
 * @param {string} [method="REML"]     - τ² estimator: "REML","DL","PM","ML".
 * @param {string} [ciMethod="normal"] - CI method: "normal","t","kr","hksj".
 * @returns {{ beta: number[], se: number[], zval: number[], pval: number[],
 *             ci: {lb: number, ub: number}[], tau2: number,
 *             QE: number, QEp: number, QM: number, QMp: number,
 *             I2: number, R2: number|null, vif: number[], maxVIF: number,
 *             colNames: string[], k: number, p: number, rankDeficient: boolean }}
 */
export function metaRegression(studies, moderators = [], method = "REML", ciMethod = "normal", alpha = 0.05) {
  // Filter to studies with finite yi and vi
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;

  const { X, colNames, modColMap, modKnots, validMask, p } = buildDesignMatrix(valid, moderators);

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
    QM: NaN, QMdf: p - 1, QMp: NaN, modTests: [],
    vif: Array(p).fill(NaN), maxVIF: NaN, I2: NaN,
    colNames, modColMap, modKnots, k: kf, p, rankDeficient: true, rankDeficientCause: "collinear"
  };

  if (kf < p + 1) return { ...empty, rankDeficientCause: "insufficient_k" };

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
  // QE uses FE weights (1/vᵢ) with FE-estimated fitted values (β from FE-WLS).
  // This matches metafor's convention and gives QE ~ χ²(k−p) under H₀: τ²=0
  // with a null distribution that does not depend on τ².  Using RE weights or
  // RE-fitted values is circular (τ² appears while testing τ²=0) and produces
  // wrong p-values.  See Thompson & Sharp (1999), Viechtbauer (2010).
  const w0  = vi.map(v => 1 / v);   // FE weights — also used below for I²
  const { beta: betaFE, vcov: vcov0, rankDeficient: rd0 } = wls(Xf, yi, w0);
  const QE  = !rd0 ? yi.reduce((acc, y, i) => {
    const e = y - dot(Xf[i], betaFE);
    return acc + w0[i] * e * e;
  }, 0) : NaN;
  const QEdf = kf - p;
  const QEp  = QEdf > 0 && isFinite(QE) ? 1 - chiSquareCDF(QE, QEdf) : NaN;

  // ---- I² (residual) ----
  // τ²-based formula (Higgins & Thompson 2002, eq. 9 rearranged):
  //   I² = τ² / (τ² + σ²_typical) × 100 %
  // where σ²_typical = QEdf / c  (leverage-adjusted typical within-study variance,
  //   c = Σ(1/vᵢ)(1 − hᵢ), the FE hat-matrix diagonal adjustment).
  // The τ²-based formula is used here — not the Q-based formula in meta() —
  // because with REML the fitted τ² can be > 0 while QE ≤ QEdf (residual Q
  // below its expectation), which would produce I² = 0 from the Q formula
  // despite positive heterogeneity.
  // vcov0 (FE vcov) already computed above for QE; reuse here for I².
  let I2 = 0;
  if (!rd0 && QEdf > 0) {
    const c = w0.reduce((acc, wi, i) => acc + wi * (1 - wi * quadForm(vcov0, Xf[i])), 0);
    if (c > 0) I2 = Math.max(0, tau2 / (tau2 + QEdf / c) * 100);
  }

  // ---- SE and CIs for beta ----
  // s2: KH variance inflation factor (Knapp & Hartung 2003, eq. 8).
  // Uses RE residuals (RE weights × RE-fitted values), NOT QE (which uses FE
  // weights × FE-fitted values).  These are distinct quantities — QE tests
  // residual heterogeneity while s2 scales the RE-WLS covariance matrix.
  const useKH = ciMethod === "KH" && kf > p && QEdf > 0;
  let s2 = 1;
  if (useKH) {
    const rssRE = yi.reduce((acc, y, i) => {
      const e = y - dot(Xf[i], beta);  // RE-WLS residuals
      return acc + w[i] * e * e;       // RE weights
    }, 0);
    s2 = Math.max(1, rssRE / QEdf);
  }

  let se, crit, zval, pval, ci, dist;

  if (useKH) {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j]) * s2));
    crit  = tCritical(QEdf, alpha);
    dist  = "t";
    zval  = beta.map((b, j) => b / se[j]);
    pval  = zval.map(t => 2 * (1 - tCDF(Math.abs(t), QEdf)));
    ci    = beta.map((b, j) => [b - crit * se[j], b + crit * se[j]]);
  } else {
    se    = vcov.map((row, j) => Math.sqrt(Math.max(0, row[j])));
    crit  = normalQuantile(1 - alpha / 2);
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
      const QMchi = betaMod.reduce((acc, bi, r) =>
        acc + bi * invMod[r].reduce((iacc, v, c) => iacc + v * betaMod[c], 0), 0);
      if (useKH) {
        QM  = QMchi / (s2 * QMdf);   // F-statistic
        QMp = 1 - fCDF(QM, QMdf, QEdf);
      } else {
        QM  = QMchi;                   // chi-sq statistic
        QMp = 1 - chiSquareCDF(QM, QMdf);
      }
    }
  }

  // ---- Per-moderator omnibus tests ----
  // One Wald test per input moderator, restricted to the columns that moderator
  // contributed to the design matrix.  Same chi-sq / F logic as the global QM
  // above.  When there is exactly one moderator, modTests[0] equals the global QM.
  const modTests = moderators.map(({ key }) => {
    const colIdxs = modColMap[key] ?? [];
    const df = colIdxs.length;
    if (df === 0) return { name: key, colIdxs, QM: NaN, QMdf: 0, QMp: NaN };

    const betaMod = colIdxs.map(j => beta[j]);
    const vcovMod = colIdxs.map(r => colIdxs.map(c => vcov[r][c]));
    const invMod  = matInverse(vcovMod);
    if (invMod === null) return { name: key, colIdxs, QM: NaN, QMdf: df, QMp: NaN };

    const QMchi = betaMod.reduce((acc, bi, r) =>
      acc + bi * invMod[r].reduce((iacc, v, c) => iacc + v * betaMod[c], 0), 0);

    let modQM, modQMp;
    if (useKH) {
      modQM  = QMchi / (s2 * df);
      modQMp = 1 - fCDF(modQM, df, QEdf);
    } else {
      modQM  = QMchi;
      modQMp = 1 - chiSquareCDF(modQM, df);
    }

    return { name: key, colIdxs, QM: modQM, QMdf: df, QMp: modQMp };
  });

  // ---- Variance Inflation Factors ----
  // VIF_j = 1 / (1 − R²_j), where R²_j is the coefficient of determination
  // from an unweighted OLS regression of column j on all other columns of Xf.
  // Only meaningful for non-intercept columns (j ≥ 1).
  // With a single predictor (p = 2) the auxiliary regression has only an
  // intercept, R² = 0, so VIF = 1 — no collinearity possible.
  const vif = Array(p).fill(NaN);   // vif[0] remains NaN (intercept)
  if (p > 1) {
    const wOnes = Array(kf).fill(1);
    for (let j = 1; j < p; j++) {
      const yAux = Xf.map(row => row[j]);
      // X_minus_j: every column of Xf except column j (keeps the intercept).
      const XAux = Xf.map(row => row.filter((_, c) => c !== j));

      const { beta: betaAux, rankDeficient: rdAux } = wls(XAux, yAux, wOnes);
      if (rdAux) continue;  // vif[j] stays NaN

      const meanY  = yAux.reduce((s, v) => s + v, 0) / kf;
      const ssTot  = yAux.reduce((s, v) => s + (v - meanY) ** 2, 0);
      if (ssTot < 1e-14) continue;  // constant column — VIF undefined

      const ssRes = yAux.reduce((s, v, i) => {
        const fit = XAux[i].reduce((acc, x, c) => acc + x * betaAux[c], 0);
        return s + (v - fit) ** 2;
      }, 0);

      const r2  = Math.max(0, 1 - ssRes / ssTot);
      vif[j] = r2 < 1 ? 1 / (1 - r2) : Infinity;
    }
  }
  const maxVIF = vif.slice(1).reduce((mx, v) => isFinite(v) && v > mx ? v : mx, 0);

  const fitted      = Xf.map(xi => dot(xi, beta));
  const eRE         = yi.map((y, i) => y - fitted[i]);
  const stdResiduals = eRE.map((ei, i) => ei / Math.sqrt(vi[i] + tau2));

  // ---- Cluster-robust SEs for regression coefficients ----
  // Reads study.cluster from each study in rows (the filtered set used in the fit).
  const clusters = rows.map(s => s.cluster?.trim() || null);
  let robustSE, robustZ, robustP, robustCi, robustDf, robustC, robustError, allSingletons;
  if (clusters.some(id => id)) {
    const rob = robustWlsResult(Xf, w, yi, beta, clusters);
    if (!rob.error) {
      robustSE      = rob.robustSE;
      robustZ       = rob.robustZ;
      robustP       = rob.robustP;
      robustCi      = rob.robustCi;
      robustDf      = rob.df;
      robustC       = rob.C;
      allSingletons = rob.allSingletons;
    } else {
      robustError = rob.error;
    }
  }

  // ---- Log-likelihood, AIC, BIC ----
  //
  // ML log-likelihood at the fitted (β̂, τ²):
  //   LL_ML = −½ Σ [ log(2π) + log(vᵢ+τ²) + (yᵢ − xᵢ′β̂)² / (vᵢ+τ²) ]
  //
  // REML log-likelihood (fixed effects marginalised out):
  //   LL_REML = LL_ML − ½ log(det(X′WX))   where W = diag(1/(vᵢ+τ²))
  //
  // Number of parameters (both ML and REML):
  //   npar = p + 1  (p fixed-effect coefficients + 1 variance component τ²)
  //
  // Effective sample size for BIC:
  //   ML:   k       (full number of studies)
  //   REML: k − p   (REML likelihood is defined over k−p error contrasts after
  //                  projecting out the p-dimensional column space of X)
  //
  // Matches metafor AIC.rma() / BIC.rma() conventions (verified 4.8-0).
  // REML AIC/BIC can only be compared across models with identical fixed-effect
  // structure; ML AIC/BIC can compare models differing in predictors or τ².
  let LL_ML = 0;
  for (let i = 0; i < kf; i++) {
    const v = vi[i] + tau2;
    LL_ML -= 0.5 * (Math.log(2 * Math.PI) + Math.log(v) + (yi[i] - fitted[i]) ** 2 / v);
  }

  // ---- Per-moderator Likelihood Ratio Tests ----
  // LRT = 2·(LL_ML_full − LL_ML_reduced) ~ χ²(df_mod) where reduced model
  // omits the columns contributed by that moderator.  Must use ML for valid
  // nested-model comparisons — REML LL cannot be compared across different
  // fixed-effect structures (Verbeke & Molenberghs 2000).
  //
  // LL_ML is always evaluated at the ML estimates (beta_ML, tau2_ML), not at
  // the current method's estimates, so LRT is valid even when method = "REML".
  // Augments each modTest entry in-place with {lrt, lrtDf, lrtP}.
  {
    // --- ML fit of the full model (used as LRT baseline for all moderators) ---
    const _mlFit = (X_) => {
      const t2 = Math.max(0, tau2_metaReg(yi, vi, X_, "ML"));
      const w_ = vi.map(v => 1 / (v + t2));
      const { beta: b_, rankDeficient: rd_ } = wls(X_, yi, w_);
      if (rd_ || !b_) return NaN;
      let ll = 0;
      for (let i = 0; i < kf; i++) {
        const v = vi[i] + t2;
        const fit = X_[i].reduce((acc, x, c) => acc + x * b_[c], 0);
        ll -= 0.5 * (Math.log(2 * Math.PI) + Math.log(v) + (yi[i] - fit) ** 2 / v);
      }
      return ll;
    };
    const LL_ML_full = _mlFit(Xf);
    for (const mt of modTests) {
      if (mt.QMdf === 0 || mt.colIdxs.length === 0 || !isFinite(LL_ML_full)) {
        mt.lrt = NaN; mt.lrtDf = 0; mt.lrtP = NaN;
        continue;
      }
      // Reduced design matrix: drop the moderator's columns (keep intercept, col 0).
      const dropSet = new Set(mt.colIdxs);
      const Xr = Xf.map(row => row.filter((_, c) => !dropSet.has(c)));
      const ll_red = _mlFit(Xr);
      const lrtStat = 2 * (LL_ML_full - ll_red);
      mt.lrt   = isFinite(lrtStat) ? Math.max(0, lrtStat) : NaN;
      mt.lrtDf = mt.QMdf;  // columns dropped = same df as Wald test
      mt.lrtP  = isFinite(mt.lrt) ? 1 - chiSquareCDF(mt.lrt, mt.lrtDf) : NaN;
    }
  }

  // X′WX (W = diag(1/(vᵢ+τ²)) already in w[]) and X′X (unweighted) for REML correction.
  // REML LL = ML LL + p/2·log(2π) + ½·log|X′X| − ½·log|X′WX|
  // (Harville 1977; metafor 4.8.0 convention with REMLf = TRUE)
  const XtWX = Xf[0].map((_, r) =>
    Xf[0].map((_, c) => Xf.reduce((s, row, i) => s + w[i] * row[r] * row[c], 0))
  );
  const XtX = Xf[0].map((_, r) =>
    Xf[0].map((_, c) => Xf.reduce((s, row) => s + row[r] * row[c], 0))
  );
  const LL_REML = LL_ML + 0.5 * p * Math.log(2 * Math.PI) + 0.5 * logDet(XtX) - 0.5 * logDet(XtWX);
  const isREML  = method === "REML";
  const LL      = isREML ? LL_REML : LL_ML;
  const npar    = p + 1;                              // same for ML and REML
  const kBIC    = isREML ? Math.max(kf - p, 1) : kf; // error contrasts for REML
  const AIC     = -2 * LL + 2 * npar;
  const BIC     = -2 * LL + npar * Math.log(kBIC);

  return {
    beta, se, zval, pval, ci, vcov, crit, s2,
    tau2, tau2_0, R2,
    QE, QEdf, QEp,
    QM, QMdf, QMp, QMdist: useKH ? "F" : "chi2",
    modTests, vif, maxVIF,
    I2, colNames, modColMap, modKnots, k: kf, p, rankDeficient: false, dist,
    fitted, residuals: eRE, stdResiduals,
    labels: rows.map(s => s.label || ""),
    studiesUsed: rows,   // exact set used in the fit (for bubble plot)
    yi, vi,    // pass through for display
    // Model-fit indices
    LL, LL_ML, LL_REML, AIC, BIC, npar, kBIC,
    // Cluster-robust fields (undefined when no clusters present)
    robustSE, robustZ, robustP, robustCi, robustDf,
    clustersUsed: robustC, allSingletons,
    robustError,
    isClustered: robustSE !== undefined,
  };
}

// ================= MULTIPLE COMPARISON CORRECTION =================
/**
 * Adjust an array of p-values for multiple comparisons.
 * @param {number[]} pvals  - raw p-values (length m)
 * @param {string}   method - "none" | "bonferroni" | "holm"
 * @returns {number[]} adjusted p-values (same length, each in [0,1])
 */
export function adjustPvals(pvals, method) {
  const m = pvals.length;
  if (!m || method === "none") return pvals.slice();

  if (method === "bonferroni") {
    return pvals.map(p => Math.min(1, isFinite(p) ? p * m : NaN));
  }

  if (method === "holm") {
    // Step-down: sort by ascending p, multiply by decreasing factor, enforce monotonicity.
    const order = pvals.map((_, i) => i).sort((a, b) => {
      if (!isFinite(pvals[a]) && !isFinite(pvals[b])) return 0;
      if (!isFinite(pvals[a])) return 1;
      if (!isFinite(pvals[b])) return -1;
      return pvals[a] - pvals[b];
    });
    const adj = new Array(m);
    let runMax = 0;
    for (let rank = 0; rank < m; rank++) {
      const i = order[rank];
      const raw = pvals[i];
      const a = isFinite(raw) ? Math.min(1, raw * (m - rank)) : NaN;
      if (isFinite(a)) runMax = Math.max(runMax, a);
      adj[i] = isFinite(a) ? runMax : NaN;
    }
    return adj;
  }

  return pvals.slice();
}

// ================= LOCATION-SCALE MODEL =================
/**
 * Location-scale meta-regression (rma.ls equivalent).
 *
 * Fits separate moderator models for:
 *   Location (mean):  E[yᵢ] = Xᵢ β
 *   Scale (log τ²):   log(τᵢ²) = Zᵢ γ  →  τᵢ² = exp(Zᵢ γ)
 *
 * Estimation: ML (not REML) — profile likelihood over γ with β profiled out.
 *   β̂(γ) = (X'W(γ)X)⁻¹ X'W(γ) y,  wᵢ = 1/(vᵢ + exp(Zᵢγ))
 *   LL(γ) = −½ Σ [ log(vᵢ + τᵢ²) + (yᵢ − Xᵢ β̂)²/(vᵢ + τᵢ²) ]
 *
 * @param {object[]} studies      - array of study objects with yi, vi
 * @param {object[]} locMods      - location moderators { key, type, transform }
 * @param {object[]} scaleMods    - scale moderators { key, type, transform }
 * @param {object}   [opts]
 *   ciMethod  "normal"|"t"  (default "normal")
 *   alpha     confidence level (default 0.05)
 * @returns structured result object
 */
export function lsModel(studies, locMods = [], scaleMods = [], opts = {}) {
  const ciMethod = opts.ciMethod ?? "normal";
  const alpha    = opts.alpha    ?? 0.05;

  // ---- Filter valid studies ----
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;

  // ---- Build design matrices ----
  const locDM   = buildDesignMatrix(valid, locMods);
  const scaleDM = buildDesignMatrix(valid, scaleMods);

  const validMask = locDM.validMask.map((v, i) => v && scaleDM.validMask[i]);
  const rows   = valid.filter((_, i) => validMask[i]);
  const Xloc   = locDM.X.filter((_, i) => validMask[i]);
  const Zscale = scaleDM.X.filter((_, i) => validMask[i]);
  const kf     = rows.length;
  const yi     = rows.map(s => s.yi);
  const vi     = rows.map(s => s.vi);
  const p      = locDM.p;    // location parameters
  const q      = scaleDM.p;  // scale parameters

  const emptyResult = {
    beta: Array(p).fill(NaN), se_beta: Array(p).fill(NaN),
    zval_beta: Array(p).fill(NaN), pval_beta: Array(p).fill(NaN),
    ci_beta: Array(p).fill([NaN, NaN]),
    gamma: Array(q).fill(NaN), se_gamma: Array(q).fill(NaN),
    zval_gamma: Array(q).fill(NaN), pval_gamma: Array(q).fill(NaN),
    ci_gamma: Array(q).fill([NaN, NaN]),
    tau2_i: Array(kf).fill(NaN),
    QE: NaN, QEdf: kf - p, QEp: NaN,
    QM_loc: NaN, QM_locDf: p - 1, QM_locP: NaN,
    QM_scale: NaN, QM_scaleDf: q - 1, QM_scaleP: NaN,
    LRchi2: NaN, LRdf: q - 1, LRp: NaN,
    LL: NaN, LL0: NaN, I2: NaN,
    locColNames: locDM.colNames, scaleColNames: scaleDM.colNames,
    locColMap: locDM.modColMap, scaleColMap: scaleDM.modColMap,
    locKnots: locDM.modKnots, scaleKnots: scaleDM.modKnots,
    k: kf, p, q, rankDeficient: true, converged: false,
    studiesUsed: rows, yi, vi,
  };

  if (kf < p + q) return { ...emptyResult, rankDeficientCause: "insufficient_k" };

  // ---- Profile likelihood over γ ----
  // Returns { beta, tau2_i, LL } for a given gamma vector.
  function profileAt(gamma) {
    const tau2_i = Zscale.map(z => Math.exp(dot(z, gamma)));
    const w      = vi.map((v, i) => 1 / (v + tau2_i[i]));
    const { beta, rankDeficient } = wls(Xloc, yi, w);
    if (rankDeficient) return null;
    const resid = yi.map((y, i) => y - dot(Xloc[i], beta));
    const LL    = -0.5 * resid.reduce((acc, e, i) => {
      return acc + Math.log(vi[i] + tau2_i[i]) + e * e * w[i];
    }, 0);
    return { beta, tau2_i, w, resid, LL };
  }

  // Objective: negative profile LL (minimise).
  function negLL(gamma) {
    const res = profileAt(gamma);
    return res ? -res.LL : 1e10;
  }

  // ---- Starting point: γ₀ = [log(median vi), 0, 0, …] ----
  const medVi  = vi.slice().sort((a, b) => a - b)[Math.floor(kf / 2)];
  const gamma0 = Array(q).fill(0);
  gamma0[0]    = Math.log(Math.max(medVi * 0.1, 1e-6));

  // ---- Optimize ----
  const opt = bfgs(negLL, gamma0, { maxIter: 600, gtol: 1e-7 });
  const gamma_hat = opt.x;
  const pr        = profileAt(gamma_hat);
  if (!pr) return emptyResult;

  const { beta, tau2_i, w, resid, LL } = pr;

  // ---- SE for β: (X'W(γ̂)X)⁻¹ ----
  const { vcov: vcov_beta, rankDeficient: rdBeta } = wls(Xloc, yi, w);
  if (rdBeta) return emptyResult;

  // ---- SE for γ: numerical Hessian of negLL at γ̂ ----
  // Central-difference second-order partial derivatives.
  const H_gamma = Array.from({ length: q }, () => Array(q).fill(0));
  for (let j = 0; j < q; j++) {
    for (let l = j; l < q; l++) {
      const hj = Math.max(1e-4, 1e-4 * Math.abs(gamma_hat[j]));
      const hl = Math.max(1e-4, 1e-4 * Math.abs(gamma_hat[l]));
      let val;
      if (j === l) {
        // Second diagonal: (f(x+h) - 2f(x) + f(x-h)) / h²
        const gp = gamma_hat.slice(); gp[j] += hj;
        const gm = gamma_hat.slice(); gm[j] -= hj;
        val = (negLL(gp) - 2 * negLL(gamma_hat) + negLL(gm)) / (hj * hj);
      } else {
        // Mixed partial: (f(x+hj,x+hl) - f(x+hj,x-hl) - f(x-hj,x+hl) + f(x-hj,x-hl)) / (4·hj·hl)
        const gpp = gamma_hat.slice(); gpp[j] += hj; gpp[l] += hl;
        const gpm = gamma_hat.slice(); gpm[j] += hj; gpm[l] -= hl;
        const gmp = gamma_hat.slice(); gmp[j] -= hj; gmp[l] += hl;
        const gmm = gamma_hat.slice(); gmm[j] -= hj; gmm[l] -= hl;
        val = (negLL(gpp) - negLL(gpm) - negLL(gmp) + negLL(gmm)) / (4 * hj * hl);
      }
      H_gamma[j][l] = H_gamma[l][j] = val;
    }
  }

  const vcov_gamma_raw = matInverse(H_gamma);
  const vcov_gamma = vcov_gamma_raw ?? Array.from({ length: q }, () => Array(q).fill(NaN));
  const rdGamma    = vcov_gamma_raw === null;

  // ---- Inference for β ----
  const crit = normalQuantile(1 - alpha / 2);
  const se_beta  = vcov_beta.map((row, j) => Math.sqrt(Math.max(0, row[j])));
  const zval_beta = beta.map((b, j) => b / se_beta[j]);
  const pval_beta = zval_beta.map(z => 2 * (1 - normalCDF(Math.abs(z))));
  const ci_beta   = beta.map((b, j) => [b - crit * se_beta[j], b + crit * se_beta[j]]);

  // ---- Inference for γ ----
  const se_gamma   = vcov_gamma.map((row, j) => Math.sqrt(Math.max(0, row[j])));
  const zval_gamma = gamma_hat.map((g, j) => g / se_gamma[j]);
  const pval_gamma = zval_gamma.map(z => 2 * (1 - normalCDF(Math.abs(z))));
  const ci_gamma   = gamma_hat.map((g, j) => [g - crit * se_gamma[j], g + crit * se_gamma[j]]);

  // ---- QE: residual heterogeneity (FE-based, same convention as metaRegression) ----
  const w0  = vi.map(v => 1 / v);
  const { beta: betaFE, rankDeficient: rdFE } = wls(Xloc, yi, w0);
  const QE  = !rdFE ? yi.reduce((acc, y, i) => {
    const e = y - dot(Xloc[i], betaFE);
    return acc + w0[i] * e * e;
  }, 0) : NaN;
  const QEdf = kf - p;
  const QEp  = QEdf > 0 && isFinite(QE) ? 1 - chiSquareCDF(QE, QEdf) : NaN;

  // ---- QM for location moderators (Wald test on β[1..p-1]) ----
  let QM_loc = NaN, QM_locDf = p - 1, QM_locP = NaN;
  if (p > 1) {
    const idx = Array.from({ length: p - 1 }, (_, i) => i + 1);
    const bm  = idx.map(j => beta[j]);
    const Vm  = idx.map(r => idx.map(c => vcov_beta[r][c]));
    const iVm = matInverse(Vm);
    if (iVm) {
      QM_loc  = bm.reduce((acc, b, r) => acc + b * iVm[r].reduce((s, v, c) => s + v * bm[c], 0), 0);
      QM_locP = 1 - chiSquareCDF(QM_loc, QM_locDf);
    }
  }

  // ---- QM for scale moderators (Wald test on γ[1..q-1]) ----
  let QM_scale = NaN, QM_scaleDf = q - 1, QM_scaleP = NaN;
  if (q > 1 && !rdGamma) {
    const idx = Array.from({ length: q - 1 }, (_, i) => i + 1);
    const gm  = idx.map(j => gamma_hat[j]);
    const Vgm = idx.map(r => idx.map(c => vcov_gamma[r][c]));
    const iVgm = matInverse(Vgm);
    if (iVgm) {
      QM_scale  = gm.reduce((acc, g, r) => acc + g * iVgm[r].reduce((s, v, c) => s + v * gm[c], 0), 0);
      QM_scaleP = 1 - chiSquareCDF(QM_scale, QM_scaleDf);
    }
  }

  // ---- Likelihood ratio test for scale moderators ----
  // Compare full model (q scale params) vs intercept-only scale model (1 scale param).
  // The null model uses only the intercept of the scale matrix.
  let LRchi2 = NaN, LRdf = q - 1, LRp = NaN, LL0 = NaN;
  if (q > 1) {
    // Negative profile LL for intercept-only scale model (gamma is a scalar).
    function negLL0_fn(g1) {
      const tau2_0 = Math.exp(g1[0]);
      const w_0    = vi.map(v => 1 / (v + tau2_0));
      const { beta: b0, rankDeficient: rd0 } = wls(Xloc, yi, w_0);
      if (rd0) return 1e10;
      const e0 = yi.map((y, i) => y - dot(Xloc[i], b0));
      return 0.5 * e0.reduce((acc, e, i) => acc + Math.log(vi[i] + tau2_0) + e * e * w_0[i], 0);
    }
    const opt0  = bfgs(negLL0_fn, [gamma_hat[0]], { maxIter: 600, gtol: 1e-7 });
    LL0    = -negLL0_fn(opt0.x);
    LRchi2 = 2 * (LL - LL0);
    LRp    = LRchi2 > 0 ? 1 - chiSquareCDF(LRchi2, LRdf) : 1;
  }

  // ---- I² (residual) using mean τ² ----
  const tau2_mean = tau2_i.reduce((s, t) => s + t, 0) / kf;
  const { vcov: vcov_FE } = !rdFE ? wls(Xloc, yi, w0) : { vcov: null };
  const I2 = !rdFE && QEdf > 0 && vcov_FE ? (() => {
    const c = w0.reduce((acc, wi, i) => acc + wi * (1 - wi * quadForm(vcov_FE, Xloc[i])), 0);
    if (c <= 0) return 0;
    return Math.max(0, tau2_mean / (tau2_mean + QEdf / c) * 100);
  })() : 0;

  // ---- Per-location-moderator Wald tests ----
  const locModTests = locMods.map(({ key }) => {
    const colIdxs = locDM.modColMap[key] ?? [];
    const df = colIdxs.length;
    if (df === 0) return { name: key, colIdxs, QM: NaN, QMdf: 0, QMp: NaN };
    const bm  = colIdxs.map(j => beta[j]);
    const Vm  = colIdxs.map(r => colIdxs.map(c => vcov_beta[r][c]));
    const iVm = matInverse(Vm);
    if (!iVm) return { name: key, QM: NaN, QMdf: df, QMp: NaN };
    const QMchi = bm.reduce((acc, b, r) => acc + b * iVm[r].reduce((s, v, c) => s + v * bm[c], 0), 0);
    return { name: key, colIdxs, QM: QMchi, QMdf: df, QMp: 1 - chiSquareCDF(QMchi, df) };
  });

  // ---- Per-scale-moderator Wald tests ----
  const scaleModTests = scaleMods.map(({ key }) => {
    const colIdxs = scaleDM.modColMap[key] ?? [];
    const df = colIdxs.length;
    if (df === 0 || rdGamma) return { name: key, colIdxs, QM: NaN, QMdf: 0, QMp: NaN };
    const gm  = colIdxs.map(j => gamma_hat[j]);
    const Vgm = colIdxs.map(r => colIdxs.map(c => vcov_gamma[r][c]));
    const iVgm = matInverse(Vgm);
    if (!iVgm) return { name: key, colIdxs, QM: NaN, QMdf: df, QMp: NaN };
    const QMchi = gm.reduce((acc, g, r) => acc + g * iVgm[r].reduce((s, v, c) => s + v * gm[c], 0), 0);
    return { name: key, colIdxs, QM: QMchi, QMdf: df, QMp: 1 - chiSquareCDF(QMchi, df) };
  });

  // ---- Fitted values and residuals ----
  const fitted    = rows.map((_, i) => dot(Xloc[i], beta));
  const residuals = yi.map((y, i) => y - fitted[i]);

  return {
    beta, se_beta, zval_beta, pval_beta, ci_beta,
    gamma: gamma_hat, se_gamma, zval_gamma, pval_gamma, ci_gamma,
    tau2_i, tau2_mean,
    vcov_beta,
    QE, QEdf, QEp,
    QM_loc, QM_locDf, QM_locP,
    QM_scale, QM_scaleDf, QM_scaleP,
    LRchi2, LRdf, LRp,
    LL, LL0, I2,
    locColNames: locDM.colNames,
    scaleColNames: scaleDM.colNames,
    locColMap: locDM.modColMap,
    scaleColMap: scaleDM.modColMap,
    locKnots: locDM.modKnots,
    scaleKnots: scaleDM.modKnots,
    locModTests, scaleModTests,
    k: kf, p, q,
    rankDeficient: false, converged: opt.converged,
    studiesUsed: rows,
    fitted, residuals,
    yi, vi,
    labels: rows.map(s => s.label || ""),
    crit, alpha,
  };
}

// ================= CUMULATIVE META-ANALYSIS =================
// Runs meta() on the first k studies for k = 1 … studies.length,
// returning a sequence of pooled estimates in the chosen accumulation order.
//
// Parameters:
//   studies   — array already sorted into the desired accumulation order;
//               each entry must have { yi, vi, label } set (post-compute).
//   method    — τ² estimator passed through to meta()
//   ciMethod  — CI method passed through to meta()
//
// Sort responsibility: this function does NOT sort. The caller (ui.js,
//   runAnalysis) sorts a copy of the studies array before calling here,
//   supporting four orderings: precision_desc (most precise first),
//   precision_asc, effect_asc, effect_desc, and "input" (table order).
//   The chosen order determines which study is labelled "added" at each step.
//
// Returns an array of k objects:
//   { k, addedLabel, RE, seRE, ciLow, ciHigh, tau2, I2 }
//
// Note: for k = 1, meta() returns τ² = 0 and uses a normal CI with
// crit = 1.96, matching the behaviour of a single-study analysis.
export function cumulativeMeta(studies, method = "DL", ciMethod = "normal", alpha = 0.05) {
  return studies.map((s, idx) => {
    const prefix = studies.slice(0, idx + 1);
    const m = meta(prefix, method, ciMethod, alpha);
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
export function leaveOneOut(studies, method = "DL", ciMethod = "normal", precomputedFull = null, alpha = 0.05) {
  const full = precomputedFull ?? meta(studies, method, ciMethod, alpha);
  if (studies.length < 3) return { full, rows: [] };
  const n = studies.length;

  // RE weight sum — needed for REML/ML/EBLUP per-study score/info (likelSS).
  const W_RE = studies.reduce((acc, d) => acc + 1 / (d.vi + full.tau2), 0);

  // ---- Precompute sufficient statistics ----
  // dlSS is always computed: FE Q_loo drives I² for every method,
  // and also gives τ²_loo directly for DL-family estimators.
  const DL_SS_METHODS = new Set(["DL", "GENQ", "HS", "HSk", "DLIT"]);
  let dl_W_fe = 0, dl_WY = 0, dl_WY2 = 0, dl_W2 = 0;
  for (const d of studies) {
    const wi = 1 / d.vi;
    dl_W_fe += wi; dl_WY += wi * d.yi; dl_WY2 += wi * d.yi * d.yi; dl_W2 += wi * wi;
  }
  const dlSS = { W_fe: dl_W_fe, WY: dl_WY, WY2: dl_WY2, W2: dl_W2 };

  let heSS = null;
  if (method === "HE") {
    let SY = 0, SY2 = 0, SV = 0;
    for (const d of studies) { SY += d.yi; SY2 += d.yi * d.yi; SV += d.vi; }
    heSS = { SY, SY2, SV };
  }

  let sqSS = null;
  if (method === "SQGENQ") {
    let SA = 0, SAY = 0, SAY2 = 0, SsV = 0, W_fe = 0;
    for (const d of studies) {
      const ai = Math.sqrt(1 / d.vi);
      SA += ai; SAY += ai * d.yi; SAY2 += ai * d.yi * d.yi;
      SsV += Math.sqrt(d.vi); W_fe += 1 / d.vi;
    }
    sqSS = { SA, SAY, SAY2, SsV, W_fe };
  }

  const LIKEL_METHODS = new Set(["REML", "ML", "EBLUP"]);
  let likelSS = null;
  if (LIKEL_METHODS.has(method) && ciMethod !== "PL") {
    const tau2 = full.tau2;
    const RE   = full.RE;
    let totalInfo = 0;
    const perStudy = studies.map(d => {
      const vi_tau = d.vi + tau2;
      const wi     = 1 / vi_tau;
      const hi     = wi / W_RE;
      const ri     = d.yi - RE;
      let score_i, info_i;
      if (method === "ML") {
        score_i = ri * ri / (vi_tau * vi_tau) - 1 / vi_tau;
        info_i  = 1 / (vi_tau * vi_tau);
      } else {
        score_i = ri * ri / (vi_tau * vi_tau) - (1 - hi) / vi_tau;
        info_i  = (1 - hi) / (vi_tau * vi_tau);
      }
      totalInfo += info_i;
      return { score_i, info_i };
    });
    likelSS = { perStudy, totalInfo };
  }

  // PM fast-path precompute: WY_re and WY2_re (RE weights at τ²_full).
  // W_RE (= Σ wⱼ at τ²_full) is already computed above.
  let pmSS = null;
  if (method === "PM" && ciMethod !== "PL") {
    const tau2 = full.tau2;
    let WY_re = 0, WY2_re = 0;
    for (const d of studies) {
      const wi = 1 / (d.vi + tau2);
      WY_re += wi * d.yi; WY2_re += wi * d.yi * d.yi;
    }
    pmSS = { WY_re, WY2_re };
  }

  // SJ fast-path precompute: per-study SJ contributions at τ²_full.
  // Seed = (k·τ²_full − sjContrib_i) / (k−1).
  let sjSS = null;
  if (method === "SJ" && ciMethod !== "PL") {
    const tau2 = full.tau2, mu = full.RE;
    const perStudy = studies.map(d => d.vi * (d.yi - mu) ** 2 / (d.vi + tau2));
    sjSS = { totalSJ: n * tau2, perStudy };
  }

  const FAST_PATH_METHODS = new Set([...DL_SS_METHODS, "HE", "SQGENQ", ...LIKEL_METHODS, "PM", "SJ"]);
  const useFastPath = FAST_PATH_METHODS.has(method) && ciMethod !== "PL";

  const df_loo  = n - 2;   // degrees of freedom for LOO set (k_loo - 1 = n - 2)
  const crit_loo = (ciMethod === "KH" || ciMethod === "t") ? tCritical(df_loo, alpha) : normalQuantile(1 - alpha / 2);
  const useT     = (ciMethod === "KH" || ciMethod === "t");

  const rows = studies.map((omitted, omitIdx) => {
    if (!useFastPath) {
      // ---- Full meta(loo) fallback (PL ciMethod — requires profile-likelihood CI) ----
      const subset = studies.filter((_, i) => i !== omitIdx);
      const m = meta(subset, method, ciMethod, alpha);
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
    }

    // ---- Fast path (Steps 2–4) ----
    // FE LOO sufficient stats — shared by τ²_loo (DL-family) and I²_loo (all methods).
    const wi_fe   = 1 / omitted.vi;
    const W_fe_l  = dlSS.W_fe - wi_fe;
    const WY_fe_l = dlSS.WY   - wi_fe * omitted.yi;
    const WY2_fe_l= dlSS.WY2  - wi_fe * omitted.yi * omitted.yi;
    const W2_fe_l = dlSS.W2   - wi_fe * wi_fe;
    const Q_fe_l  = W_fe_l > 0 ? WY2_fe_l - WY_fe_l * WY_fe_l / W_fe_l : 0;

    // I²_loo: Q-based formula (matches meta() regardless of τ² estimator).
    const i2_loo = (Q_fe_l > df_loo && Q_fe_l > 0)
      ? Math.min(100, ((Q_fe_l - df_loo) / Q_fe_l) * 100) : 0;

    // τ²_loo: method-specific O(1) or O(k·iter) computation.
    let tau2_loo;

    if (method === "DL" || method === "GENQ") {
      const c_l = W_fe_l - W2_fe_l / W_fe_l;
      tau2_loo = c_l > 0 ? Math.max(0, (Q_fe_l - df_loo) / c_l) : 0;

    } else if (method === "HS") {
      tau2_loo = W_fe_l > 0 ? Math.max(0, (Q_fe_l - df_loo) / W_fe_l) : 0;

    } else if (method === "HSk") {
      const tau2_hs_l = W_fe_l > 0 ? Math.max(0, (Q_fe_l - df_loo) / W_fe_l) : 0;
      tau2_loo = df_loo > 0 ? tau2_hs_l * (n - 1) / df_loo : 0;

    } else if (method === "DLIT") {
      const c_l = W_fe_l - W2_fe_l / W_fe_l;
      let t2 = c_l > 0 ? Math.max(0, (Q_fe_l - df_loo) / c_l) : 0;
      for (let iter = 0; iter < 200; iter++) {
        let Wit = 0, W2it = 0, Wmuit = 0, WY2it = 0;
        for (let j = 0; j < n; j++) {
          if (j === omitIdx) continue;
          const wj = 1 / (studies[j].vi + t2);
          Wit += wj; W2it += wj * wj; Wmuit += wj * studies[j].yi;
          WY2it += wj * studies[j].yi * studies[j].yi;
        }
        const Qit = WY2it - Wmuit * Wmuit / Wit;
        const cit = Wit - W2it / Wit;
        const newT2 = Math.max(0, (Qit - df_loo) / cit);
        if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
        t2 = newT2;
      }
      tau2_loo = t2;

    } else if (method === "HE") {
      const k_l   = n - 1;
      const SY_l  = heSS.SY  - omitted.yi;
      const SY2_l = heSS.SY2 - omitted.yi * omitted.yi;
      const SV_l  = heSS.SV  - omitted.vi;
      const SS_l  = SY2_l - SY_l * SY_l / k_l;
      tau2_loo = k_l > 1 ? Math.max(0, SS_l / (k_l - 1) - SV_l / k_l) : 0;

    } else if (method === "SQGENQ") {
      const ai    = Math.sqrt(wi_fe);
      const k_l   = n - 1;
      const A_l   = sqSS.SA   - ai;
      const SAY_l = sqSS.SAY  - ai * omitted.yi;
      const SAY2_l= sqSS.SAY2 - ai * omitted.yi * omitted.yi;
      const SsV_l = sqSS.SsV  - Math.sqrt(omitted.vi);
      const Wfe_l = sqSS.W_fe - wi_fe;
      if (A_l <= 0) {
        tau2_loo = 0;
      } else {
        const Qa_l = SAY2_l - SAY_l * SAY_l / A_l;
        const ba_l = SsV_l  - k_l / A_l;
        const ca_l = A_l    - Wfe_l / A_l;
        tau2_loo = ca_l > 0 ? Math.max(0, (Qa_l - ba_l) / ca_l) : 0;
      }

    } else if (method === "PM") {
      // ---- PM fast path: warm-start fixed-point iteration --------------------
      // Exact seed via Q_loo(τ²_full) = WY2_l − WY_l²/W_l  (O(1) with pmSS).
      const wi  = 1 / (omitted.vi + full.tau2);
      const W_l = W_RE - wi;
      const WY_l  = pmSS.WY_re  - wi * omitted.yi;
      const WY2_l = pmSS.WY2_re - wi * omitted.yi * omitted.yi;
      const Q_PM_l = W_l > 0 ? WY2_l - WY_l * WY_l / W_l : 0;
      let t2 = W_l > 0 ? Math.max(0, full.tau2 + (Q_PM_l - df_loo) / W_l) : full.tau2;
      for (let iter = 0; iter < 100; iter++) {
        let Wit = 0, WYit = 0, WY2it = 0;
        for (let j = 0; j < n; j++) {
          if (j === omitIdx) continue;
          const wj = 1 / (studies[j].vi + t2);
          Wit += wj; WYit += wj * studies[j].yi; WY2it += wj * studies[j].yi * studies[j].yi;
        }
        if (Wit <= 0) break;
        const Qit = WY2it - WYit * WYit / Wit;
        const newT2 = Math.max(0, t2 + (Qit - df_loo) / Wit);
        if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
        t2 = newT2;
      }
      tau2_loo = t2;

    } else if (method === "SJ") {
      // ---- SJ fast path: warm-start fixed-point iteration --------------------
      // Seed: (k·τ²_full − sjContrib_i) / (k−1).
      let t2 = Math.max(0, (sjSS.totalSJ - sjSS.perStudy[omitIdx]) / (n - 1));
      for (let iter = 0; iter < 200; iter++) {
        let Wit = 0, WYit = 0;
        for (let j = 0; j < n; j++) {
          if (j === omitIdx) continue;
          const wj = 1 / (studies[j].vi + t2);
          Wit += wj; WYit += wj * studies[j].yi;
        }
        if (Wit <= 0) break;
        const mu_it = WYit / Wit;
        let s = 0;
        for (let j = 0; j < n; j++) {
          if (j === omitIdx) continue;
          const rj = studies[j].yi - mu_it;
          s += studies[j].vi * rj * rj / (studies[j].vi + t2);
        }
        const newT2 = Math.max(0, s / (n - 1));
        if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
        t2 = newT2;
      }
      tau2_loo = t2;

    } else {
      // REML / ML / EBLUP: one-step Newton seed + warm-start refinement.
      const { score_i, info_i } = likelSS.perStudy[omitIdx];
      const infoLoo = likelSS.totalInfo - info_i;
      let t2 = infoLoo > 0
        ? Math.max(0, full.tau2 + score_i / infoLoo)
        : full.tau2;
      const isREML = method !== "ML";
      for (let iter = 0; iter < 100; iter++) {
        let W_it = 0, Wmu_it = 0;
        for (let j = 0; j < n; j++) {
          if (j === omitIdx) continue;
          const wj = 1 / (studies[j].vi + t2);
          W_it += wj; Wmu_it += wj * studies[j].yi;
        }
        if (W_it <= 0) break;
        const mu_it = Wmu_it / W_it;
        let sc = 0, inf_it = 0;
        for (let j = 0; j < n; j++) {
          if (j === omitIdx) continue;
          const vi_tau = studies[j].vi + t2;
          const rj = studies[j].yi - mu_it;
          if (isREML) {
            const hj = 1 / (vi_tau * W_it);
            sc     += rj * rj / (vi_tau * vi_tau) - (1 - hj) / vi_tau;
            inf_it += (1 - hj) / (vi_tau * vi_tau);
          } else {
            sc     += rj * rj / (vi_tau * vi_tau) - 1 / vi_tau;
            inf_it += 1 / (vi_tau * vi_tau);
          }
        }
        if (inf_it <= 0) break;
        let step = sc / inf_it;
        let newT2 = t2 + step;
        let sh = 0;
        while (newT2 < 0 && sh++ < 20) { step /= 2; newT2 = t2 + step; }
        newT2 = Math.max(0, newT2);
        if (Math.abs(newT2 - t2) < REML_TOL) { t2 = newT2; break; }
        t2 = newT2;
      }
      tau2_loo = t2;
    }

    // O(k) RE-weighted pass at τ²_loo → RE_loo, seRE_loo.
    let W_RE_l = 0, WY_RE_l = 0, WY2_RE_l = 0;
    for (let j = 0; j < n; j++) {
      if (j === omitIdx) continue;
      const wj = 1 / Math.max(studies[j].vi + tau2_loo, MIN_VAR);
      W_RE_l += wj; WY_RE_l += wj * studies[j].yi; WY2_RE_l += wj * studies[j].yi * studies[j].yi;
    }
    const RE_loo = W_RE_l > 0 ? WY_RE_l / W_RE_l : NaN;
    let seRE_loo;
    if (ciMethod === "KH" && df_loo > 0) {
      const sumKH = WY2_RE_l - WY_RE_l * WY_RE_l / W_RE_l;
      seRE_loo = Math.sqrt(Math.max(sumKH, 0) / (df_loo * W_RE_l));
    } else {
      seRE_loo = W_RE_l > 0 ? Math.sqrt(1 / W_RE_l) : NaN;
    }

    // CI bounds and p-value.
    const ciLow_loo  = RE_loo - crit_loo * seRE_loo;
    const ciHigh_loo = RE_loo + crit_loo * seRE_loo;
    const stat_loo   = RE_loo / seRE_loo;
    const pval_loo   = useT
      ? 2 * (1 - tCDF(Math.abs(stat_loo), df_loo))
      : 2 * (1 - normalCDF(Math.abs(stat_loo)));

    return {
      label:       omitted.label ?? `Study ${omitIdx + 1}`,
      estimate:    RE_loo,
      lb:          ciLow_loo,
      ub:          ciHigh_loo,
      tau2:        tau2_loo,
      i2:          i2_loo,
      pval:        pval_loo,
      significant: pval_loo < 0.05,
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
  const methods = ["DL", "REML", "PM", "PMM", "GENQM", "ML", "HS", "HE", "SJ", "GENQ", "SQGENQ", "DLIT", "EBLUP", "HSk"];
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
  // Solve: 1 − Φ(Z_95 − λ) + Φ(−Z_95 − λ) = 0.33 via bisection.
  const POWER_33  = 0.33;
  function power(lambda) {
    return (1 - normalCDF(Z_95 - lambda)) + normalCDF(-Z_95 - lambda);
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
    const mean0  = pp0.reduce((acc, b) => acc + b, 0) / k;
    rightSkewZ   = (mean0 - 0.5) * Math.sqrt(12 * k);
    rightSkewP   = normalCDF(rightSkewZ);  // one-tailed left
  }

  // ---- Step 6: flatness test (H₃₃: 33% power) ----
  // pp33ᵢ = pp33CDF(pᵢ); under H₃₃ these are Uniform(0,1).
  let flatnessZ = NaN, flatnessP = NaN;
  if (k >= 1) {
    const pp33   = sig.map(d => pp33CDF(d.p));
    const mean33 = pp33.reduce((acc, b) => acc + b, 0) / k;
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
    const denom    = Math.max(1 - normalCDF(Z_95 - lambda), MIN_DENOM);
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
    const margin  = Z_95 * sdUnif;
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
  const W   = valid.reduce((acc, d) => acc + 1 / d.vi, 0);
  const muFE = valid.reduce((acc, d) => acc + d.yi / d.vi, 0) / W;
  const Q   = valid.reduce((acc, d) => acc + (d.yi - muFE) ** 2 / d.vi, 0);

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

// ================= BLUPs =================
// -----------------------------------------------------------------------------
// blupMeta(studies, m, alpha) → result | null
// -----------------------------------------------------------------------------
// Computes per-study Best Linear Unbiased Predictions (BLUPs) under the
// random-effects model (Raudenbush 1994; matches metafor::blup.rma.uni()).
//
// Each study's true effect θᵢ is estimated by shrinking the observed yᵢ
// toward the pooled RE estimate μ̂:
//
//   λᵢ      = τ² / (τ² + vᵢ)                          (shrinkage weight)
//   blup_i  = μ̂_RE + λᵢ · (yᵢ − μ̂_RE)                (shrunken estimate)
//   ranef_i = blup_i − μ̂_RE = λᵢ · (yᵢ − μ̂_RE)       (random effect ûᵢ)
//
// Full uncertainty (accounts for estimation error in μ̂_RE):
//   WRE          = Σ 1/(vᵢ + τ²)
//   Var(blup_i)  = λᵢ·vᵢ + (vᵢ/(τ²+vᵢ))² · (1/WRE)
//   se_blup_i    = √Var(blup_i)
//
// Conditional SE of the random effect (treating μ̂ as fixed):
//   se_ranef_i   = √(λᵢ·vᵢ) = √(τ²·vᵢ/(τ²+vᵢ))
//
// Parameters
// ----------
//   studies  — array of study objects with finite yi, vi (already computed)
//   m        — meta() result for the same studies/method (provides RE, tau2)
//   alpha    — CI level (default 0.05 → 95% CI)
//
// Returns
// -------
//   {
//     studies: [{
//       label, yi, vi, se_obs,
//       blup, se_blup, ci_lb, ci_ub,   // full-uncertainty BLUP CI
//       ranef, se_ranef,                 // random effect and its cond. SE
//       lambda,                          // shrinkage weight λᵢ ∈ [0,1]
//       group,
//     }],
//     mu:   μ̂_RE,   // pooled RE estimate
//     tau2: τ²,
//     k:    number,
//   }
// Returns null when k < 2 or τ² is not finite.
// -----------------------------------------------------------------------------
export function blupMeta(studies, m, alpha = 0.05) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  if (k < 2 || !m || !isFinite(m.RE) || !isFinite(m.tau2) || m.tau2 <= 0) return null;

  const { RE: mu, tau2 } = m;
  const crit = normalQuantile(1 - alpha / 2);

  // Total RE weight (needed for uncertainty in μ̂_RE)
  const WRE = valid.reduce((acc, s) => acc + 1 / (s.vi + tau2), 0);
  const varMu = WRE > 0 ? 1 / WRE : NaN; // Var(μ̂_RE)

  const out = valid.map(s => {
    const lambda     = tau2 / (tau2 + s.vi);           // shrinkage weight
    const blup       = mu + lambda * (s.yi - mu);       // shrunken estimate
    const varBlup    = lambda * s.vi + (s.vi / (tau2 + s.vi)) ** 2 * varMu;
    const se_blup    = Math.sqrt(Math.max(varBlup, 0));
    const ranef      = blup - mu;                        // = lambda*(yi - mu)
    const se_ranef   = Math.sqrt(lambda * s.vi);         // conditional SE

    return {
      label:    s.label,
      yi:       s.yi,
      vi:       s.vi,
      se_obs:   Math.sqrt(s.vi),
      blup,
      se_blup,
      ci_lb:    blup - crit * se_blup,
      ci_ub:    blup + crit * se_blup,
      ranef,
      se_ranef,
      lambda,
      group:    s.group ?? null,
    };
  });

  return { studies: out, mu, tau2, k };
}

// =============================================================================
// BFGS MINIMIZER
// =============================================================================
// Minimizes f: Rⁿ → R via the inverse-Hessian form of BFGS with a numerical
// central-difference gradient and Armijo backtracking line search.
//
// Parameters
// ----------
//   f    : objective function, accepts an array of length n, returns a scalar
//   x0   : starting point (array length n) — not modified
//   opts : optional overrides
//     maxIter  (default 400)  — maximum number of iterations
//     gtol     (default 1e-6) — gradient-norm convergence threshold
//     ftol     (default 1e-10)— |Δf| convergence threshold
//     c1       (default 1e-4) — Armijo sufficient-decrease constant
//
// Returns { x, fval, gnorm, iters, converged }
//   x         — best parameter vector found
//   fval      — f(x)
//   gnorm     — ‖∇f(x)‖ at return
//   iters     — iterations completed
//   converged — true if gnorm < gtol or |Δf| < ftol was satisfied
// =============================================================================
export function bfgs(f, x0, opts = {}) {
  const maxIter = opts.maxIter ?? 400;
  const gtol    = opts.gtol    ?? 1e-6;
  const ftol    = opts.ftol    ?? 1e-10;
  const c1      = opts.c1      ?? 1e-4;
  const n       = x0.length;

  // Central-difference numerical gradient
  function numGrad(x) {
    const g = new Array(n);
    for (let j = 0; j < n; j++) {
      const h = Math.max(1e-5, 1e-5 * Math.abs(x[j]));
      const xp = x.slice(); xp[j] += h;
      const xm = x.slice(); xm[j] -= h;
      g[j] = (f(xp) - f(xm)) / (2 * h);
    }
    return g;
  }

  // Symmetric matrix–vector product
  function mv(H, v) {
    const r = new Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        r[i] += H[i][j] * v[j];
    return r;
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  }

  function eye() {
    return Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0))
    );
  }

  let H    = eye();
  let x    = x0.slice();
  let fval = f(x);
  let g    = numGrad(x);

  let iters = 0;
  let converged = false;

  for (; iters < maxIter; iters++) {
    const gnorm = Math.sqrt(dot(g, g));
    if (gnorm < gtol) { converged = true; break; }

    // Search direction d = −Hg
    let d  = mv(H, g).map(v => -v);
    let dg = dot(d, g);

    // If d is not a descent direction, reset H to identity and use steepest descent
    if (dg >= 0) {
      H  = eye();
      d  = g.map(v => -v);
      dg = dot(d, g);
    }

    // Armijo backtracking line search
    let alpha    = 1.0;
    let xnew, fnew;
    let accepted = false;
    for (let sh = 0; sh < 60; sh++) {
      xnew = x.map((xi, j) => xi + alpha * d[j]);
      fnew = f(xnew);
      if (fnew <= fval + c1 * alpha * dg) { accepted = true; break; }
      alpha /= 2;
    }

    if (!accepted) break;   // line search failed — return best point so far

    const s    = d.map(v => v * alpha);
    const gnew = numGrad(xnew);
    const y    = gnew.map((gi, j) => gi - g[j]);

    const sy = dot(s, y);
    const ss = dot(s, s);
    const yy = dot(y, y);

    // BFGS inverse-Hessian update (skipped if curvature condition fails)
    if (sy > 1e-12 * Math.sqrt(ss * yy)) {
      const Hy  = mv(H, y);
      const yHy = dot(y, Hy);
      const rho = 1.0 / sy;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          H[i][j] += rho * ((1.0 + rho * yHy) * s[i] * s[j]
                            - s[i] * Hy[j] - Hy[i] * s[j]);
        }
      }
    }

    const fdiff = Math.abs(fval - fnew);
    x    = xnew;
    fval = fnew;
    g    = gnew;

    if (fdiff < ftol) { converged = true; iters++; break; }
  }

  return { x, fval, gnorm: Math.sqrt(dot(g, g)), iters, converged };
}

// =============================================================================
// SELECTION MODEL HELPERS
// =============================================================================

// selIntervalProbs — probability that study i's true effect falls in each
// selection interval, under the marginal distribution Y_i ~ N(mu, vi + tau²).
//
//   mu       : pooled mean
//   totalVar : vi + tau²  (marginal variance for study i)
//   se_i     : sqrt(vi)   (study i's standard error, used to define boundaries)
//   zcuts    : normal quantiles of the p-value cutpoints
//              zcuts[j] = Φ⁻¹(1 − cuts[j]);  length K (same as cuts)
//              zcuts[K-1] = Φ⁻¹(0) = −∞ (lower boundary of last interval)
//   sides    : 1 = one-sided p-values (default), 2 = two-sided
//
// Returns an array of K probabilities that sum to 1 (up to floating-point error).
//
// One-sided interval layout (K intervals, K-1 interior boundaries):
//   j=0     :  y ∈ [se_i·z₀,  +∞)           — smallest p-values
//   j=1..K-2:  y ∈ [se_i·zⱼ,  se_i·zⱼ₋₁)
//   j=K-1   :  y ∈ (−∞,        se_i·z_{K-2}) — largest p-values
export function selIntervalProbs(mu, totalVar, se_i, zcuts, sides) {
  const K  = zcuts.length;
  const sd = Math.sqrt(totalVar);
  const p  = new Array(K);

  if (sides === 1) {
    for (let j = 0; j < K; j++) {
      // Upper boundary in standardised units: +∞ for j=0, else se_i·z_{j-1}
      const hiZ = j === 0   ? Infinity  : (se_i * zcuts[j - 1] - mu) / sd;
      // Lower boundary: −∞ for j=K-1, else se_i·z_j
      const loZ = j === K - 1 ? -Infinity : (se_i * zcuts[j]     - mu) / sd;
      p[j] = Math.max(0, normalCDF(hiZ) - normalCDF(loZ));
    }
  } else {
    // Two-sided: p = 2·(1 − Φ(|y/se_i|)).
    // Interval j covers |y| ∈ [lo, hi):
    //   j=0:     |y| ∈ [se_i·z_0,    ∞)             — most significant
    //   j=1..K-2:|y| ∈ [se_i·z_j,    se_i·z_{j-1})
    //   j=K-1:   |y| ∈ [0,           se_i·z_{K-2})  — least significant
    // P(|Y| ∈ [lo, hi)) = P(|Y| ≥ lo) − P(|Y| ≥ hi)
    //   P(|Y| ≥ a) = Φ((−a−μ)/sd) + 1 − Φ((a−μ)/sd)
    for (let j = 0; j < K; j++) {
      const lo = j === K - 1 ? 0       : se_i * zcuts[j];
      const hi = j === 0     ? Infinity : se_i * zcuts[j - 1];
      const pLo = lo === 0        ? 1 : normalCDF((-lo - mu) / sd) + (1 - normalCDF((lo - mu) / sd));
      const pHi = hi === Infinity ? 0 : normalCDF((-hi - mu) / sd) + (1 - normalCDF((hi - mu) / sd));
      p[j] = Math.max(0, pLo - pHi);
    }
  }
  return p;
}

// selIntervalIdx — returns the interval index j (0-based) that study i belongs
// to, based on its observed p-value relative to the cutpoints array.
//
//   yi   : observed effect size for study i
//   se_i : standard error of study i
//   cuts : p-value cutpoints array, e.g. [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
//   sides: 1 (one-sided) or 2 (two-sided)
export function selIntervalIdx(yi, se_i, cuts, sides) {
  const pval = sides === 2
    ? 2 * (1 - normalCDF(Math.abs(yi / se_i)))
    : 1 - normalCDF(yi / se_i);
  for (let j = 0; j < cuts.length; j++) {
    if (pval <= cuts[j]) return j;
  }
  return cuts.length - 1;  // pval = 1.0 always lands in the last interval
}

// =============================================================================
// SELECTION MODEL LOG-LIKELIHOOD (Vevea-Hedges 1995)
// =============================================================================
// Computes the *negative* log-likelihood for minimisation (BFGS convention).
//
// Model: study i is observed with probability proportional to ω_j when its
// p-value falls in interval j.  The likelihood correction divides each study's
// density by the normalising constant c_i = Σ_j ω_j · P(Y_i ∈ interval j | μ, τ²+σᵢ²).
//
// Parameters vector layout:
//   params[0]       = μ            (pooled mean)
//   params[1]       = ρ            (log τ², i.e. τ² = exp(ρ))
//   params[2..K]    = α₁, …, α_{K-1}  (log relative weights; ω_j = exp(α_j),
//                                       ω₀ = 1 is the reference category)
//
// Arguments
//   params : parameter vector of length K+1 (K = cuts.length)
//   yi     : array of observed effect sizes (length n)
//   vi     : array of within-study variances (length n)
//   cuts   : p-value cutpoints, e.g. [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
//   sides  : 1 (one-sided, default) or 2 (two-sided)
//
// Identity: when all α_j = 0 (ω_j = 1 ∀j), c_i = 1 and log(ω_{j_i}) = 0, so
//   selectionLogLik([μ, log(τ²), 0,…,0], yi, vi, cuts) = −logLik(studies, μ, τ²)
export function selectionLogLik(params, yi, vi, cuts, sides = 1) {
  const K    = cuts.length;
  const mu   = params[0];
  const tau2 = Math.exp(params[1]);

  // Selection weights: ω₀ = 1 (reference), ω_j = exp(α_j) for j ≥ 1
  const omega = new Array(K);
  omega[0] = 1.0;
  for (let j = 1; j < K; j++) omega[j] = Math.exp(params[j + 1]);

  // Precompute normal quantiles of the cutpoints (reused across all studies)
  // One-sided: z_j = Φ⁻¹(1 − c_j)   (z such that P(Z > z) = c_j)
  // Two-sided: z_j = Φ⁻¹(1 − c_j/2) (z such that P(|Z| > z) = c_j)
  const zcuts = sides === 2
    ? cuts.map(c => normalQuantile(1 - c / 2))
    : cuts.map(c => normalQuantile(1 - c));

  let negLL = 0;
  for (let i = 0; i < yi.length; i++) {
    const se_i     = Math.sqrt(vi[i]);
    const totalVar = vi[i] + tau2;

    // Standard normal log-likelihood contribution (negated for minimisation)
    negLL += 0.5 * (Math.log(totalVar) + (yi[i] - mu) ** 2 / totalVar);

    // Normalising constant c_i = Σ_j ω_j · P(Y_i in interval j | μ, τ²+σᵢ²)
    const probs = selIntervalProbs(mu, totalVar, se_i, zcuts, sides);
    let c_i = 0;
    for (let j = 0; j < K; j++) c_i += omega[j] * probs[j];
    if (c_i <= 0) return Infinity;   // degenerate — all weight on empty intervals

    // Selection term: log(ω_{j_i}) − log(c_i)
    const j_i = selIntervalIdx(yi[i], se_i, cuts, sides);
    negLL -= Math.log(omega[j_i]);
    negLL += Math.log(c_i);
  }
  return negLL;
}

// =============================================================================
// VEVEA-HEDGES SELECTION MODEL — full API
// =============================================================================

// Default p-value cutpoints (one-sided or two-sided).
// Each entry is an upper boundary; the last entry must be 1.0.
// K = cuts.length defines the number of selection intervals.
// The first interval [0, cuts[0]) carries ω₀ = 1 (reference weight).
export const SEL_CUTS_ONE_SIDED = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0];
export const SEL_CUTS_TWO_SIDED = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0];

// =============================================================================
// SELECTION_PRESETS — named fixed-weight sensitivity presets
// =============================================================================
// Follows Vevea & Woods (2005) Table 1 and JASP conventions.
// Each preset specifies a fixed ω vector and the corresponding p-value
// cutpoints and sidedness.  ω[0] = 1 is the reference interval (most
// significant); ω[j] < 1 means studies in that interval are under-represented
// relative to the reference.
//
// These are used for sensitivity analysis: ω is held fixed, and only μ and τ²
// are estimated via veveaHedges().  The "1" suffix → one-sided p-values;
// the "2" suffix → two-sided p-values.
//
// Reference cuts for all presets: [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
// =============================================================================
export const SELECTION_PRESETS = {
  // ---- One-sided ----
  mild1: {
    label:  "Mild (one-sided)",
    sides:  1,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 1, 0.75, 0.75, 0.5, 0.25],
  },
  moderate1: {
    label:  "Moderate (one-sided)",
    sides:  1,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 0.9, 0.5, 0.3, 0.2, 0.1],
  },
  severe1: {
    label:  "Severe (one-sided)",
    sides:  1,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 0.5, 0.1, 0.1, 0.05, 0.01],
  },
  // ---- Two-sided ----
  mild2: {
    label:  "Mild (two-sided)",
    sides:  2,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 1, 0.75, 0.75, 0.5, 0.25],
  },
  moderate2: {
    label:  "Moderate (two-sided)",
    sides:  2,
    cuts:   [0.025, 0.05, 0.10, 0.25, 0.50, 1.0],
    omega:  [1, 0.9, 0.5, 0.3, 0.2, 0.1],
  },
};

// numericalHessian — central-difference second-order approximation of the
// Hessian matrix of f at x, given f(x) = fval.
// Step h_j = max(1e-4, 1e-4·|x_j|) for each dimension j.
// Used to compute the observed Fisher information for standard errors.
function numericalHessian(f, x, fval) {
  const n = x.length;
  const h = x.map(v => Math.max(1e-4, 1e-4 * Math.abs(v)));
  const H = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    // Diagonal: (f(x+hᵢeᵢ) − 2f(x) + f(x−hᵢeᵢ)) / hᵢ²
    const xp = x.slice(); xp[i] += h[i];
    const xm = x.slice(); xm[i] -= h[i];
    H[i][i] = (f(xp) - 2 * fval + f(xm)) / (h[i] * h[i]);

    // Off-diagonal (upper triangle, symmetrised):
    // (f(x+hᵢeᵢ+hⱼeⱼ) − f(x+hᵢeᵢ−hⱼeⱼ) − f(x−hᵢeᵢ+hⱼeⱼ) + f(x−hᵢeᵢ−hⱼeⱼ)) / (4hᵢhⱼ)
    for (let j = i + 1; j < n; j++) {
      const xpp = x.slice(); xpp[i] += h[i]; xpp[j] += h[j];
      const xpm = x.slice(); xpm[i] += h[i]; xpm[j] -= h[j];
      const xmp = x.slice(); xmp[i] -= h[i]; xmp[j] += h[j];
      const xmm = x.slice(); xmm[i] -= h[i]; xmm[j] -= h[j];
      const hij = (f(xpp) - f(xpm) - f(xmp) + f(xmm)) / (4 * h[i] * h[j]);
      H[i][j] = hij;
      H[j][i] = hij;
    }
  }
  return H;
}

// =============================================================================
// veveaHedges(studies, cuts, sides)
// =============================================================================
// Fits the Vevea-Hedges (1995) step-function weight model for publication bias.
//
// The model assumes study i is observed with probability proportional to ω_{j(i)},
// where j(i) is determined by the study's one-sided (or two-sided) p-value and
// the cutpoint vector cuts.  ω₀ = 1 is the reference; ωⱼ = exp(αⱼ) for j ≥ 1.
//
// Parameters:
//   studies — array of { yi, vi } objects
//   cuts    — K-element array of p-value upper boundaries; last entry must be 1.0
//             Default: SEL_CUTS_ONE_SIDED = [0.025, 0.05, 0.10, 0.25, 0.50, 1.0]
//   sides   — 1 (one-sided, default) or 2 (two-sided)
//
// Returns:
//   mu, se_mu, zval_mu, pval_mu, ci_mu
//     Pooled mean and inference on the selection-model adjusted estimate.
//   tau2, se_tau2
//     Between-study variance (τ²) and its SE (delta method on log scale).
//   omega[K], se_omega[K]
//     Selection weights on natural scale (ω₀ = 1 fixed; se_omega[0] = NaN).
//   alpha[K], se_alpha[K]
//     Log selection weights (α₀ = 0 fixed; se_alpha[0] = NaN).
//   logLikSel    — log-likelihood of the selection model at MLE
//   logLikUnsel  — log-likelihood of the unweighted ML model (for LRT comparison)
//   LRT, LRTdf, LRTp
//     Likelihood ratio test: H₀: all ωⱼ = 1 (no selection); χ²(K−1).
//   RE_unsel, tau2_unsel, ciLow_unsel, ciHigh_unsel
//     Unweighted RE estimate and 95% CI (for display alongside corrected estimate).
//   converged, iters    — BFGS convergence status
//   cuts, sides, k, K   — configuration and study count
//   nPerInterval[K]     — observed study count per selection interval
// =============================================================================
// veveaHedges(studies, cuts, sides, fixedOmega)
//
// fixedOmega — optional K-element array of fixed selection weights for
//   sensitivity analysis (Vevea & Woods 2005).  When provided, only μ and τ²
//   are estimated; the selection weights are held at the specified values and
//   no LRT is computed.  When null (default), all parameters are estimated
//   by MLE (full Vevea-Hedges model).
export function veveaHedges(studies, cuts = SEL_CUTS_ONE_SIDED, sides = 1, fixedOmega = null) {
  const valid = studies.filter(s => isFinite(s.yi) && isFinite(s.vi) && s.vi > 0);
  const k = valid.length;
  const K = cuts.length;

  // Minimum k: fixed-omega needs k≥3 (2 free params); MLE needs k≥K+2
  const isFixed = fixedOmega !== null;
  const minK    = isFixed ? 3 : K + 2;
  if (k < minK) {
    return {
      error: "insufficient_k", k, K, minK,
      mu: NaN, tau2: NaN,
      omega: new Array(K).fill(NaN), se_omega: new Array(K).fill(NaN),
      LRT: NaN, LRTdf: NaN, LRTp: NaN,
      converged: false,
    };
  }

  const yi = valid.map(s => s.yi);
  const vi = valid.map(s => s.vi);

  // ---- Unweighted ML model (starting values and LRT baseline) ----
  const mUnsel      = meta(valid, "ML");
  const logLikUnsel = logLik(valid, mUnsel.RE, mUnsel.tau2);

  // ---- Shared helper: invert Hessian with progressive ridge fallback ----
  function invertHess(H, fval, f2) {
    // Recompute H with fresh fval to avoid stale-fval bugs
    const hess = numericalHessian(f2, H, fval);
    let inv = matInverse(hess);
    if (inv === null) {
      for (const lam of [1e-8, 1e-6, 1e-4, 1e-2, 1, 10]) {
        const ridge = hess.map((row, i) => row.map((v, j) => i === j ? v + lam : v));
        inv = matInverse(ridge);
        if (inv !== null) break;
      }
    }
    return { hess, inv };
  }

  function getSE(hess, inv, j) {
    if (inv !== null && inv[j][j] > 0) return Math.sqrt(inv[j][j]);
    return hess[j][j] > 0 ? 1 / Math.sqrt(hess[j][j]) : NaN;
  }

  // ---- Study counts per selection interval (same for both branches) ----
  const nPerInterval = new Array(K).fill(0);
  for (let i = 0; i < k; i++)
    nPerInterval[selIntervalIdx(yi[i], Math.sqrt(vi[i]), cuts, sides)]++;

  // ==========================================================================
  // FIXED-OMEGA BRANCH (sensitivity analysis)
  // ==========================================================================
  if (isFixed) {
    const fixedAlpha = fixedOmega.map(w => Math.log(Math.max(w, 1e-15)));
    // Wrap selectionLogLik to only expose [mu, rho] as free parameters
    const f2 = x => selectionLogLik(
      [x[0], x[1], ...fixedAlpha.slice(1)], yi, vi, cuts, sides
    );

    const x0     = [mUnsel.RE, Math.log(Math.max(mUnsel.tau2, 1e-9))];
    const result = bfgs(f2, x0);
    const [mu_fit, rho_fit] = result.x;
    const mu    = mu_fit;
    const tau2  = Math.exp(rho_fit);
    const alpha = fixedAlpha;
    const omega = fixedOmega.slice();
    const logLikSel = -result.fval;

    const { hess, inv } = invertHess(result.x, result.fval, f2);
    const se_mu   = getSE(hess, inv, 0);
    const se_rho  = getSE(hess, inv, 1);
    const se_tau2 = isFinite(se_rho) ? tau2 * se_rho : NaN;
    // Weights are fixed — no SEs
    const se_omega = new Array(K).fill(NaN);
    const se_alpha = new Array(K).fill(NaN);

    const zval_mu = mu / se_mu;
    const pval_mu = 2 * (1 - normalCDF(Math.abs(zval_mu)));
    const ci_mu   = [mu - Z_95 * se_mu, mu + Z_95 * se_mu];

    return {
      mu, se_mu, zval_mu, pval_mu, ci_mu,
      tau2, se_tau2,
      omega, se_omega,
      alpha, se_alpha,
      logLikSel, logLikUnsel,
      LRT: NaN, LRTdf: K - 1, LRTp: NaN,
      RE_unsel: mUnsel.RE, tau2_unsel: mUnsel.tau2,
      ciLow_unsel: mUnsel.ciLow, ciHigh_unsel: mUnsel.ciHigh,
      converged: result.converged, iters: result.iters,
      cuts, sides, k, K, nPerInterval,
      fixed: true,
    };
  }

  // ==========================================================================
  // MLE BRANCH (estimate all parameters)
  // ==========================================================================

  // ---- Identify free alpha indices: non-reference intervals with ≥1 study ----
  // alpha[0] is always fixed at 0 (reference); alpha[j] for j≥1 is free only
  // when nPerInterval[j] > 0.  Empty intervals are fixed at alpha=0 (ω=1).
  const freeIdx = [];
  for (let j = 1; j < K; j++) {
    if (nPerInterval[j] > 0) freeIdx.push(j);
  }
  const nFree = freeIdx.length;

  // ---- Unidentifiable guard: reference interval (j=0) has no studies ----
  // When nPerInterval[0]=0, there are no studies to anchor the selection scale,
  // making the likelihood unbounded as ω→∞.  Return the unweighted ML result
  // with all ω fixed at 1 and the LRT undefined (df=0, p=1).
  if (nPerInterval[0] === 0) {
    const alpha0 = new Array(K).fill(0);
    const omega0 = new Array(K).fill(1);
    const zval_mu0 = mUnsel.RE / mUnsel.se;
    const pval_mu0 = 2 * (1 - normalCDF(Math.abs(zval_mu0)));
    return {
      mu: mUnsel.RE, se_mu: mUnsel.se, zval_mu: zval_mu0, pval_mu: pval_mu0,
      ci_mu: [mUnsel.ciLow, mUnsel.ciHigh],
      tau2: mUnsel.tau2, se_tau2: NaN,
      omega: omega0, se_omega: new Array(K).fill(NaN),
      alpha: alpha0, se_alpha: new Array(K).fill(NaN),
      logLikSel: logLikUnsel, logLikUnsel,
      LRT: 0, LRTdf: 0, LRTp: 1,
      RE_unsel: mUnsel.RE, tau2_unsel: mUnsel.tau2,
      ciLow_unsel: mUnsel.ciLow, ciHigh_unsel: mUnsel.ciHigh,
      converged: true, iters: 0,
      cuts, sides, k, K, nFree: 0,
      nPerInterval, freeIdx: [],
      fixed: false,
      referenceEmpty: true,
    };
  }

  // ---- Wrapper: reduced param vector → full selectionLogLik call ----
  // Reduced: [mu, rho, alpha[freeIdx[0]], alpha[freeIdx[1]], ...]
  // Fixed (empty-interval) alphas stay at 0.
  const f = x => {
    const fullAlpha = new Array(K).fill(0);
    for (let fi = 0; fi < nFree; fi++) fullAlpha[freeIdx[fi]] = x[fi + 2];
    return selectionLogLik([x[0], x[1], ...fullAlpha.slice(1)], yi, vi, cuts, sides);
  };

  // ---- Multi-start BFGS: try 3 alpha initializations, keep best fval ----
  // Multi-start only when the reference interval (j=0) has ≥1 study; when it is
  // empty the model is unidentifiable and extreme starting points produce
  // degenerate (spuriously high-likelihood) solutions.
  const mu0  = mUnsel.RE;
  const rho0 = Math.log(Math.max(mUnsel.tau2, 1e-9));
  const alphaInits = nPerInterval[0] > 0
    ? [
        new Array(nFree).fill(0),               // ω = 1
        new Array(nFree).fill(Math.log(0.5)),   // ω = 0.5
        new Array(nFree).fill(Math.log(0.1)),   // ω = 0.1
      ]
    : [ new Array(nFree).fill(0) ];             // single start: reference is empty
  let result = null;
  for (const aInit of alphaInits) {
    const r = bfgs(f, [mu0, rho0, ...aInit]);
    if (result === null || r.fval < result.fval) result = r;
  }
  const params = result.x;

  // ---- Reconstruct full-length alpha and omega arrays ----
  const mu   = params[0];
  const tau2 = Math.exp(params[1]);
  const alpha = new Array(K).fill(0);  // alpha[0]=0 (reference); empty intervals=0
  for (let fi = 0; fi < nFree; fi++) alpha[freeIdx[fi]] = params[fi + 2];
  const omega = alpha.map(a => Math.exp(a));

  const logLikSel = -result.fval;

  // ---- Standard errors via numerical observed Fisher information ----
  // Hessian is over the reduced param space (only free indices).  Empty
  // intervals contribute no information, so their SEs remain NaN.
  const { hess: hessMat, inv: hessInv } = invertHess(params, result.fval, f);

  const se_mu  = getSE(hessMat, hessInv, 0);
  const se_rho = getSE(hessMat, hessInv, 1);   // SE of log(τ²)

  const se_alpha = new Array(K).fill(NaN);     // NaN for reference and empty intervals
  for (let fi = 0; fi < nFree; fi++) se_alpha[freeIdx[fi]] = getSE(hessMat, hessInv, fi + 2);

  // Delta method: SE(τ²) = τ² · SE(log τ²); SE(ωⱼ) = ωⱼ · SE(αⱼ)
  const se_tau2  = isFinite(se_rho) ? tau2 * se_rho : NaN;
  const se_omega = omega.map((w, j) => j === 0 ? NaN : (isFinite(se_alpha[j]) ? w * se_alpha[j] : NaN));

  // ---- Inference on mu ----
  const zval_mu = mu / se_mu;
  const pval_mu = 2 * (1 - normalCDF(Math.abs(zval_mu)));
  const ci_mu   = [mu - Z_95 * se_mu, mu + Z_95 * se_mu];

  // ---- Likelihood ratio test: H₀: all ωⱼ = 1 ----
  // df = nFree (free alpha params only; empty intervals excluded from test)
  const lrt_stat = 2 * (logLikSel - logLikUnsel);
  const lrt_df   = nFree;
  const lrt_p    = lrt_df > 0 && lrt_stat > 0
    ? 1 - chiSquareCDF(lrt_stat, lrt_df)
    : (lrt_stat <= 0 ? 1 : NaN);

  return {
    // Corrected pooled estimate
    mu, se_mu, zval_mu, pval_mu, ci_mu,

    // Between-study variance
    tau2, se_tau2,

    // Selection weights (natural scale and log scale)
    omega, se_omega,
    alpha, se_alpha,

    // Log-likelihoods
    logLikSel,
    logLikUnsel,

    // Likelihood ratio test
    LRT: lrt_stat, LRTdf: lrt_df, LRTp: lrt_p,

    // Unweighted ML model for side-by-side display
    RE_unsel:    mUnsel.RE,
    tau2_unsel:  mUnsel.tau2,
    ciLow_unsel: mUnsel.ciLow,
    ciHigh_unsel: mUnsel.ciHigh,

    // Optimiser diagnostics
    converged: result.converged,
    iters:     result.iters,

    // Configuration and counts
    cuts, sides, k, K, nFree,
    nPerInterval, freeIdx,
    fixed: false,
  };
}

// ================= SANDWICH (CLUSTER-ROBUST) VARIANCE ESTIMATOR =================
// Computes the cluster-robust (sandwich) variance matrix for a WLS estimator.
//
// Parameters
// ----------
//   X          — k×p design matrix (array of k p-vectors)
//   w          — k-vector of weights w_i
//   residuals  — k-vector of residuals ê_i = y_i − x_i'β̂
//   clusterIds — k-vector of cluster identifiers (strings/numbers).
//                Rows with null/undefined/empty string are treated as singletons.
//
// Returns
// -------
//   { V_rob, SE_rob, df, C, B, allSingletons }  on success
//   { error }  when C < 2 or C ≤ p
//
//   V_rob       — p×p robust variance matrix (array of p p-vectors)
//   SE_rob      — p-vector of robust SEs (sqrt of diagonal of V_rob)
//   df          — C − p  (degrees of freedom for small-sample t CI)
//   C           — number of clusters
//   B           — p×p meat matrix
//   allSingletons — true if every cluster contains exactly one study
//
// Small-sample correction: V_rob is multiplied by C/(C−p), consistent with
// the CR1 correction in R's clubSandwich package.
export function sandwichVar(X, w, residuals, clusterIds) {
  const k = residuals.length;
  const p = X[0].length;

  // Assign a cluster label to every row; missing/blank → unique singleton key
  const ids = Array.from({ length: k }, (_, i) => {
    const id = clusterIds ? clusterIds[i] : null;
    return (id !== null && id !== undefined && String(id).trim() !== "")
      ? String(id).trim()
      : `__s_${i}`;
  });

  // Group row indices by cluster
  const clusterMap = new Map();
  for (let i = 0; i < k; i++) {
    const id = ids[i];
    if (!clusterMap.has(id)) clusterMap.set(id, []);
    clusterMap.get(id).push(i);
  }
  const C = clusterMap.size;
  const allSingletons = [...clusterMap.values()].every(rows => rows.length === 1);

  if (C < 2)  return { error: "Need at least 2 clusters for robust SE." };
  if (C <= p) return { error: `Fewer clusters (C=${C}) than parameters (p=${p}); robust SE not available.` };

  // A = (X'WX)^{-1}
  const XtWX = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < k; i++) {
    const wi = w[i];
    for (let j = 0; j < p; j++) {
      for (let l = j; l < p; l++) {
        const v = wi * X[i][j] * X[i][l];
        XtWX[j][l] += v;
        if (l !== j) XtWX[l][j] += v;
      }
    }
  }
  const A = matInverse(XtWX);
  if (A === null) return { error: "Design matrix is singular; robust SE not available." };

  // Small-sample CR1 correction: C / (C − p)
  const cr1 = C / (C - p);

  // Meat B = Σ_c g_c g_c'   where g_c = Σ_{i∈c} w_i X[i] ê_i   (p-vector)
  const B = Array.from({ length: p }, () => Array(p).fill(0));
  for (const clRows of clusterMap.values()) {
    const g = Array(p).fill(0);
    for (const i of clRows) {
      const wiei = w[i] * residuals[i];
      for (let j = 0; j < p; j++) g[j] += X[i][j] * wiei;
    }
    for (let j = 0; j < p; j++) {
      for (let l = 0; l < p; l++) B[j][l] += g[j] * g[l];
    }
  }

  // V_rob = cr1 · A B A   (A is symmetric)
  // First compute AB, then V_rob[j][l] = cr1 · Σ_m AB[j][m] · A[l][m]
  const AB = Array.from({ length: p }, () => Array(p).fill(0));
  for (let j = 0; j < p; j++)
    for (let l = 0; l < p; l++)
      for (let m = 0; m < p; m++) AB[j][l] += A[j][m] * B[m][l];

  const V_rob = Array.from({ length: p }, () => Array(p).fill(0));
  for (let j = 0; j < p; j++)
    for (let l = 0; l < p; l++) {
      let v = 0;
      for (let m = 0; m < p; m++) v += AB[j][m] * A[l][m];
      V_rob[j][l] = cr1 * v;
    }

  const SE_rob = Array.from({ length: p }, (_, j) => Math.sqrt(Math.max(0, V_rob[j][j])));

  return { V_rob, SE_rob, df: C - p, C, B, allSingletons };
}

// ================= CLUSTER-ROBUST WLS POST-PROCESSOR =================
// Given a WLS fit (X, w, y, beta), computes cluster-robust SEs and returns
// robust inference alongside the model-based fit.
//
// Parameters
// ----------
//   X          — k×p design matrix (same as passed to wls())
//   w          — k-vector of weights (same as passed to wls())
//   y          — k-vector of response values
//   beta       — p-vector of fitted coefficients from wls()
//   clusterIds — k-vector of cluster IDs; rows with null/empty are singletons
//
// Returns
// -------
//   { robustSE, robustZ, robustP, robustCi, df, C, allSingletons }  on success
//   { error }  if sandwichVar returns an error
export function robustWlsResult(X, w, y, beta, clusterIds) {
  const k = y.length;
  const residuals = y.map((yi, i) => yi - X[i].reduce((acc, xij, j) => acc + xij * beta[j], 0));

  const rob = sandwichVar(X, w, residuals, clusterIds);
  if (rob.error) return { error: rob.error };

  const useT = rob.df < 30;
  const crit = useT ? tCritical(rob.df) : Z_95;

  const robustSE = rob.SE_rob;
  const robustZ  = beta.map((b, j) => b / robustSE[j]);
  const robustP  = robustZ.map(z =>
    useT
      ? 2 * (1 - tCDF(Math.abs(z), rob.df))
      : 2 * (1 - normalCDF(Math.abs(z)))
  );
  const robustCi = beta.map((b, j) => [b - crit * robustSE[j], b + crit * robustSE[j]]);

  return {
    robustSE, robustZ, robustP, robustCi,
    df: rob.df, C: rob.C, allSingletons: rob.allSingletons,
  };
}

// ================= CLUSTER-ROBUST POOLED-ESTIMATE WRAPPER =================
// Wraps meta() and appends a cluster-robust SE and CI for the pooled estimate.
// Cluster IDs are read from study.cluster on each study object.
//
// Parameters
// ----------
//   studies   — array of study objects (must have yi, vi, and optionally cluster)
//   method    — τ² estimator string, forwarded to meta()
//   ciMethod  — CI method string, forwarded to meta()
//
// Returns
// -------
//   meta() result extended with:
//     robustSE, robustCiLow, robustCiHigh, robustStat, robustPval,
//     robustDf, clustersUsed, isClustered, allSingletons
//   Falls back to plain meta() result when no studies carry a cluster ID.
//   Adds robustError when sandwichVar fails (robust fields are then absent).
export function robustMeta(studies, method, ciMethod, alpha = 0.05) {
  const m = meta(studies, method, ciMethod, alpha);

  const clusterIds = studies.map(s => s.cluster?.trim() || null);
  if (clusterIds.every(id => !id)) return m;

  const k = studies.length;
  const X = Array.from({ length: k }, () => [1]);
  const w = studies.map(s => 1 / Math.max(s.vi + m.tau2, MIN_VAR));
  const residuals = studies.map(s => s.yi - m.RE);

  const rob = sandwichVar(X, w, residuals, clusterIds);
  if (rob.error) return { ...m, robustError: rob.error };

  const robSE = rob.SE_rob[0];
  const useT  = rob.df < 30;
  const crit  = useT ? tCritical(rob.df, alpha) : normalQuantile(1 - alpha / 2);
  const robStat = m.RE / robSE;
  const robPval = useT
    ? 2 * (1 - tCDF(Math.abs(robStat), rob.df))
    : 2 * (1 - normalCDF(Math.abs(robStat)));

  return {
    ...m,
    robustSE:     robSE,
    robustCiLow:  m.RE - crit * robSE,
    robustCiHigh: m.RE + crit * robSE,
    robustStat:   robStat,
    robustPval:   robPval,
    robustDf:     rob.df,
    clustersUsed: rob.C,
    isClustered:  true,
    allSingletons: rob.allSingletons,
  };
}

// ================= ROBUST VARIANCE ESTIMATION (RVE) =================
//
// Model-based correction for dependent effect sizes.
// Hedges, Tipton & Johnson (2010, Res Synth Methods 1(1):39–65).
//
// Working covariance model (block-diagonal across clusters):
//   Vᵢ[j,j]  = vⱼ          (within-study variance — on diagonal)
//   Vᵢ[j,k]  = ρ√(vⱼ·vₖ)  (off-diagonal, j≠k, same cluster)
//
// Vᵢ = (1−ρ)Dᵢ + ρ·dᵢdᵢ'  where dᵢⱼ = √vⱼ.  Sherman-Morrison gives
//   Vᵢ⁻¹[j,k] = [wⱼδⱼₖ·cᵢ − ρ√(wⱼwₖ)] / ((1−ρ)·cᵢ)
//   where wⱼ = 1/vⱼ and cᵢ = 1−ρ+ρkᵢ.
//
// For p predictors (intercept always included as column 0):
//   Aᵢ = Xᵢ'Vᵢ⁻¹Xᵢ = (WXXᵢ − ρ/cᵢ · SXᵢ⊗SXᵢ) / (1−ρ)       p×p
//   bᵢ = Xᵢ'Vᵢ⁻¹yᵢ = (WXYᵢ − ρ/cᵢ · SXᵢ·SYᵢ)  / (1−ρ)       p-vec
//   β̂  = (ΣAᵢ)⁻¹ · Σbᵢ
//
// Sandwich SE (CR1 small-sample correction):
//   gᵢ  = Xᵢ'Vᵢ⁻¹eᵢ = (WXEᵢ − ρ/cᵢ · SXᵢ·SEᵢ) / (1−ρ)
//   V̂(β̂) = m/(m−1) · B⁻¹ · (Σgᵢgᵢ') · B⁻¹   where B = ΣAᵢ
//   df = m − p,  t = β̂ⱼ/SE(β̂ⱼ),  p = two-tailed t-test
//
// Parameters
// ----------
//   studies     — [{yi, vi, cluster?, <mod>?}] — cluster absent/blank → singleton
//   opts        — { rho: 0.80, alpha: 0.05, moderators: [] }
//     moderators — array of study property names to use as covariates
//                  (intercept is always included; studies missing a moderator
//                   value are silently excluded)
//
// Returns
// -------
//   { est, se, ci: [lo, hi], df, t, p, coefs, rho, kCluster, k }
//   coefs: [{ name, est, se, ci, t, p }] — one entry per coefficient
//          (coefs[0] is always the intercept / pooled effect)
//   or { error: string } on failure
//
export function rvePooled(studies, opts = {}) {
  const rho        = opts.rho        ?? 0.80;
  const alpha      = opts.alpha      ?? 0.05;
  const moderators = opts.moderators ?? [];   // array of covariate names

  if (rho <= -1 || rho >= 1) return { error: "ρ must be in (−1, 1)." };

  const p    = 1 + moderators.length;  // intercept + moderators
  const rho1 = 1 - rho;

  // Filter to valid studies — finite yi/vi and all moderator values present.
  const valid = studies.filter(s => {
    if (!s || !isFinite(s.yi) || !isFinite(s.vi) || s.vi <= 0) return false;
    for (const mod of moderators) if (!isFinite(s[mod])) return false;
    return true;
  });
  const k = valid.length;
  if (k < 2) return { error: "Need at least 2 valid studies." };

  // Group studies by cluster; studies without a cluster ID are singletons.
  const clusterMap = new Map();
  valid.forEach((s, idx) => {
    const id = (s.cluster !== null && s.cluster !== undefined && String(s.cluster).trim() !== "")
      ? String(s.cluster).trim()
      : `__s${idx}`;
    if (!clusterMap.has(id)) clusterMap.set(id, []);
    clusterMap.get(id).push(s);
  });
  const m = clusterMap.size;
  if (m < 2) return { error: "Need at least 2 clusters for RVE." };

  const df = m - p;
  if (df < 1) return { error: `Too few clusters (m=${m}) for ${p} predictors; need m > p.` };

  // Design vector for a study: [1, mod1, mod2, ...]
  const xVec = s => [1, ...moderators.map(mod => s[mod])];

  // --- First pass: accumulate B = ΣAᵢ (p×p) and b = Σbᵢ (p) ---
  const B = Array.from({ length: p }, () => new Array(p).fill(0));
  const bVec = new Array(p).fill(0);
  const clList = [];   // [{SX, ci, clStudies}] for second pass

  for (const clStudies of clusterMap.values()) {
    const ki = clStudies.length;
    const ci = rho1 + rho * ki;   // 1−ρ+ρkᵢ  (> 0 since ρ < 1)

    // Per-cluster sums needed for Sherman-Morrison
    const WXX = Array.from({ length: p }, () => new Array(p).fill(0));
    const SX  = new Array(p).fill(0);
    const WXY = new Array(p).fill(0);
    let SY = 0;

    for (const s of clStudies) {
      const wj = 1 / s.vi;
      const sj = Math.sqrt(wj);
      const xj = xVec(s);
      SY += sj * s.yi;
      for (let r = 0; r < p; r++) {
        SX[r]  += sj * xj[r];
        WXY[r] += wj * xj[r] * s.yi;
        for (let c = 0; c < p; c++) WXX[r][c] += wj * xj[r] * xj[c];
      }
    }

    // Aᵢ and bᵢ via Sherman-Morrison
    for (let r = 0; r < p; r++) {
      bVec[r] += (WXY[r] - rho * SX[r] * SY / ci) / rho1;
      for (let c = 0; c < p; c++) {
        B[r][c] += (WXX[r][c] - rho * SX[r] * SX[c] / ci) / rho1;
      }
    }

    clList.push({ SX, ci, clStudies });
  }

  // --- Solve β̂ = B⁻¹·b ---
  const Binv = matInverse(B);
  if (Binv === null) return { error: "Design matrix is singular (collinear moderators?)." };

  const beta = Binv.map(row => row.reduce((acc, v, j) => acc + v * bVec[j], 0));

  // --- Second pass: sandwich meat M = Σ gᵢgᵢ' ---
  const Meat = Array.from({ length: p }, () => new Array(p).fill(0));

  for (const { SX, ci, clStudies } of clList) {
    const WXE = new Array(p).fill(0);
    let SE = 0;
    for (const s of clStudies) {
      const wj = 1 / s.vi;
      const sj = Math.sqrt(wj);
      const xj = xVec(s);
      const ej = s.yi - xj.reduce((acc, v, j) => acc + v * beta[j], 0);
      SE += sj * ej;
      for (let r = 0; r < p; r++) WXE[r] += wj * xj[r] * ej;
    }
    // gᵢ = (WXEᵢ − ρ/cᵢ · SXᵢ·SEᵢ) / (1−ρ)
    const gi = WXE.map((v, r) => (v - rho * SX[r] * SE / ci) / rho1);
    for (let r = 0; r < p; r++)
      for (let c = 0; c < p; c++) Meat[r][c] += gi[r] * gi[c];
  }

  // --- Sandwich covariance: V̂(β̂) = m/(m−1) · B⁻¹ · Meat · B⁻¹ ---
  const scale = m / (m - 1);
  // BinvMeat = Binv · Meat (p×p)
  const BinvMeat = Binv.map(row =>
    new Array(p).fill(0).map((_, c) => row.reduce((acc, v, j) => acc + v * Meat[j][c], 0))
  );
  // Vhat = BinvMeat · Binv (p×p)
  const Vhat = BinvMeat.map(row =>
    new Array(p).fill(0).map((_, c) => row.reduce((acc, v, j) => acc + v * Binv[j][c], 0))
  );

  // --- Build per-coefficient results ---
  const crit       = tCritical(df, alpha);
  const coefNames  = ["intercept", ...moderators];
  const coefs      = coefNames.map((name, i) => {
    const est_i = beta[i];
    const se_i  = Math.sqrt(Math.max(0, scale * Vhat[i][i]));
    const t_i   = se_i > 0 ? est_i / se_i : NaN;
    const p_i   = isFinite(t_i) ? 2 * (1 - tCDF(Math.abs(t_i), df)) : NaN;
    return { name, est: est_i, se: se_i, ci: [est_i - crit * se_i, est_i + crit * se_i], t: t_i, p: p_i };
  });

  // Top-level fields mirror the intercept for backward compatibility.
  const { est, se, ci, t, p: pval } = coefs[0];
  return { est, se, ci, t, p: pval, df, coefs, rho, kCluster: m, k };
}

// =============================================================================
// THREE-LEVEL META-ANALYSIS
// =============================================================================
//
// Model: studies nested within clusters (e.g. multiple outcomes per paper).
// Three variance components:
//   σ²ₑ — within-study sampling variance (known: vᵢⱼ)
//   σ²ᵤ — between-study-within-cluster (unknown, tau2_within)
//   σ²ₜ — between-cluster (unknown, tau2_between)
//
// Marginal covariance for cluster i (kᵢ studies):
//   Σᵢ = diag(vᵢⱼ + σ²ᵤ) + σ²ₜ · 1·1'
//
// Efficient inversion via Sherman-Morrison (rank-1 update of diagonal):
//   |Σᵢ| = (∏ⱼ dᵢⱼ) · (1 + σ²ₜ·Sdᵢ)    where dᵢⱼ = vᵢⱼ+σ²ᵤ,  Sdᵢ = Σⱼ 1/dᵢⱼ
//   1'·Σᵢ⁻¹·1   = Sdᵢ / denomᵢ            where denomᵢ = 1 + σ²ₜ·Sdᵢ
//   1'·Σᵢ⁻¹·yᵢ  = (Σⱼ yᵢⱼ/dᵢⱼ) / denomᵢ
//   r'·Σᵢ⁻¹·r   = Σⱼ rᵢⱼ²/dᵢⱼ − σ²ₜ·(Σⱼ rᵢⱼ/dᵢⱼ)² / denomᵢ
//
// Estimation by REML (default) or ML via BFGS in log-τ² space.
// Pooled mean μ̂ = Σᵢ (1'·Σᵢ⁻¹·yᵢ) / Σᵢ (1'·Σᵢ⁻¹·1)
// Var(μ̂) = 1 / Σᵢ (1'·Σᵢ⁻¹·1)
//
// References:
//   Cheung (2014). Modeling Dependent Effect Sizes with Three-Level Meta-Analyses.
//   Psychological Methods, 19(2), 211–229.
//   Van den Noortgate et al. (2013). Three-level meta-analysis. Behav Res Methods.
//
// Returns: { mu, se, ci, z, p, tau2_within, tau2_between, I2_within, I2_between,
//            Q, df, k, kCluster, logLik, convergence }
//
export function meta3level(studies, opts = {}) {
  const method = opts.method ?? "REML";
  const alpha  = opts.alpha  ?? 0.05;

  if (method !== "REML" && method !== "ML")
    return { error: `method must be "REML" or "ML" (got "${method}")` };
  if (!Array.isArray(studies) || studies.length < 3)
    return { error: "Three-level meta-analysis requires at least 3 studies" };

  // Group studies by cluster; singletons get a unique synthetic key.
  const clusterMap = new Map();
  studies.forEach((s, i) => {
    const key = (s.cluster != null && s.cluster !== "") ? String(s.cluster) : `__s${i}`;
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key).push(s);
  });
  const clusters = [...clusterMap.values()];
  const m = clusters.length;
  const k = studies.length;

  if (m < 2) return { error: "Three-level meta-analysis requires at least 2 clusters" };

  // ------------------------------------------------------------------
  // Concentrated log-likelihood at (tau2u, tau2t).
  // We marginalise out μ analytically, then return log L(τ²ᵤ, τ²ₜ | data).
  // The constant −k/2·log(2π) is omitted (cancels in optimisation).
  // ------------------------------------------------------------------
  function evalLL(tau2u, tau2t) {
    let W = 0, Wmu = 0, ll = 0;

    for (const cl of clusters) {
      let logdetD = 0, Sd = 0, Wyi = 0;
      for (const s of cl) {
        const dj = s.vi + tau2u;
        logdetD += Math.log(dj);
        Sd      += 1 / dj;
        Wyi     += s.yi / dj;
      }
      const denom = 1 + tau2t * Sd;
      if (denom <= 0) return -Infinity;
      ll   -= 0.5 * (logdetD + Math.log(denom));
      W    += Sd / denom;
      Wmu  += Wyi / denom;
    }

    if (!isFinite(W) || W <= 0) return -Infinity;
    const mu = Wmu / W;

    // Quadratic form: Σᵢ rᵢ'·Σᵢ⁻¹·rᵢ
    for (const cl of clusters) {
      let Sd = 0, rD = 0, rDone = 0;
      for (const s of cl) {
        const dj = s.vi + tau2u;
        const rj = s.yi - mu;
        Sd    += 1 / dj;
        rD    += rj * rj / dj;
        rDone += rj / dj;
      }
      const denom = 1 + tau2t * Sd;
      ll -= 0.5 * (rD - tau2t * rDone * rDone / denom);
    }

    // REML correction: subtract ½ log(Σᵢ 1'·Σᵢ⁻¹·1) = ½ log(W)
    if (method === "REML") ll -= 0.5 * Math.log(W);

    return isFinite(ll) ? ll : -Infinity;
  }

  // ------------------------------------------------------------------
  // BFGS minimisation in log-τ² space: x = [log(τ²ᵤ), log(τ²ₜ)]
  // ------------------------------------------------------------------
  function negLL(x) {
    const ll = evalLL(Math.exp(x[0]), Math.exp(x[1]));
    return ll === -Infinity ? 1e10 : -ll;
  }

  // Starting values: simple DL τ² split equally between components
  let W0 = 0, W02 = 0, Wmu0 = 0;
  for (const s of studies) {
    const w = 1 / s.vi;
    W0 += w; W02 += w * w; Wmu0 += w * s.yi;
  }
  const muFE0  = Wmu0 / W0;
  const Q0     = studies.reduce((a, s) => a + (s.yi - muFE0) ** 2 / s.vi, 0);
  const c0     = W0 - W02 / W0;
  const tau2DL = Math.max(0.01, (Q0 - (k - 1)) / c0);
  const x0     = [Math.log(tau2DL / 2), Math.log(tau2DL / 2)];

  const res   = bfgs(negLL, x0, { maxIter: 400, gtol: 1e-6 });
  const tau2u = Math.max(0, Math.exp(res.x[0]));
  const tau2t = Math.max(0, Math.exp(res.x[1]));

  // ------------------------------------------------------------------
  // Final pooled estimates at optimum (τ²ᵤ, τ²ₜ)
  // ------------------------------------------------------------------
  let W = 0, Wmu = 0;
  for (const cl of clusters) {
    let Sd = 0, Wyi = 0;
    for (const s of cl) {
      const dj = s.vi + tau2u;
      Sd  += 1 / dj;
      Wyi += s.yi / dj;
    }
    const denom = 1 + tau2t * Sd;
    W   += Sd / denom;
    Wmu += Wyi / denom;
  }
  const mu    = Wmu / W;
  const se    = 1 / Math.sqrt(Math.max(MIN_VAR, W));
  const zcrit = normalQuantile(1 - alpha / 2);
  const ci    = [mu - zcrit * se, mu + zcrit * se];
  const zval  = se > 0 ? mu / se : NaN;
  const pval  = isFinite(zval) ? 2 * (1 - normalCDF(Math.abs(zval))) : NaN;

  // ------------------------------------------------------------------
  // Heterogeneity: Q (fixed-effects) and decomposed I²
  // I² follows metafor convention: vi_typical = 1 / Σ(1/vᵢ)
  //   I²_within  = τ²ᵤ / (τ²ᵤ + τ²ₜ + vi_typical)
  //   I²_between = τ²ₜ / (τ²ᵤ + τ²ₜ + vi_typical)
  // ------------------------------------------------------------------
  const Q      = studies.reduce((a, s) => a + (s.yi - muFE0) ** 2 / s.vi, 0);
  const vi_typ = 1 / W0;  // 1 / Σ(1/vi)
  const tot    = tau2u + tau2t + vi_typ;
  const I2_within  = tot > 0 ? 100 * tau2u / tot : 0;
  const I2_between = tot > 0 ? 100 * tau2t / tot : 0;

  return {
    mu, se, ci, z: zval, p: pval,
    tau2_within:  tau2u,
    tau2_between: tau2t,
    I2_within, I2_between,
    Q, df: k - 1,
    k, kCluster: m,
    logLik: -res.fval,
    convergence: res.converged,
  };
}