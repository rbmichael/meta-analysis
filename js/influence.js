// =============================================================================
// influence.js — influence diagnostics, leave-one-out, cumulative meta,
//                baujat, BLUP, estimator comparison
//
// Extracted from analysis.js (item 4.1.4 of TECHNICAL IMPROVEMENT ROADMAP).
// =============================================================================

// Circular imports — safe: these are only called inside function bodies.
import { meta, tau2_REML, validStudies } from "./analysis.js";
import { normalCDF, normalQuantile, tCDF, tCritical } from "./utils.js";
import { MIN_VAR, REML_TOL } from "./constants.js";

// ================= LOO ENGINE =================
// looEngine(studies, full, method, ciMethod, alpha)
//   → Array<{tau2_loo, RE_loo, seRE_loo, hat}>
//
// Shared kernel for influenceDiagnostics and leaveOneOut.  Internalises all
// sufficient-stat caching and per-method τ² branches; returns one row per
// input study.
//
//   tau2_loo  — τ² estimated from the k−1 leave-one-out set.
//   RE_loo    — pooled RE estimate from the k−1 set.
//   seRE_loo  — RE standard error (KH-adjusted when ciMethod="KH").
//   hat       — leverage h_i = w_i/W (fraction of full-model RE weight).
//
// Fast paths (moment estimators, PM, SJ, REML/ML/EBLUP) avoid a full meta()
// call per study.  Falls back to meta(loo) only for ciMethod="PL".
// See influenceDiagnostics inline comments for derivation details.
function looEngine(studies, full, method, ciMethod, alpha = 0.05) {
  const n = studies.length;

  // W = Σ 1/(vi + τ²_full): needed for REML/ML/EBLUP leverage hi and hat.
  const W = studies.reduce((acc, d) => acc + 1 / (d.vi + full.tau2), 0);

  // ---- Sufficient-statistics precomputation for moment-estimator fast paths ----
  // (See influenceDiagnostics header for derivation of each estimator.)
  const DL_SS_METHODS = new Set(["DL", "GENQ", "HS", "HSk", "DLIT"]);

  let W_fe = 0, WY = 0, WY2 = 0, W2 = 0;
  for (const d of studies) {
    const wi = 1 / d.vi;
    W_fe += wi; WY += wi * d.yi; WY2 += wi * d.yi * d.yi; W2 += wi * wi;
  }
  const dlSS = { W_fe, WY, WY2, W2 };

  let heSS = null;
  if (method === "HE") {
    let SY = 0, SY2 = 0, SV = 0;
    for (const d of studies) { SY += d.yi; SY2 += d.yi * d.yi; SV += d.vi; }
    heSS = { SY, SY2, SV };
  }

  let sqSS = null;
  if (method === "SQGENQ") {
    let SA = 0, SAY = 0, SAY2 = 0, SsV = 0, Wfe = 0;
    for (const d of studies) {
      const ai = Math.sqrt(1 / d.vi);
      SA += ai; SAY += ai * d.yi; SAY2 += ai * d.yi * d.yi;
      SsV += Math.sqrt(d.vi); Wfe += 1 / d.vi;
    }
    sqSS = { SA, SAY, SAY2, SsV, W_fe: Wfe };
  }

  const LIKEL_METHODS = new Set(["REML", "ML", "EBLUP"]);
  let likelSS = null;
  if (LIKEL_METHODS.has(method) && ciMethod !== "PL") {
    const tau2 = full.tau2, RE = full.RE;
    let totalInfo = 0;
    const perStudy = studies.map(d => {
      const vi_tau = d.vi + tau2;
      const wi     = 1 / vi_tau;
      const hi     = wi / W;
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

  let sjSS = null;
  if (method === "SJ" && ciMethod !== "PL") {
    const tau2 = full.tau2, mu = full.RE;
    const perStudy = studies.map(d => d.vi * (d.yi - mu) ** 2 / (d.vi + tau2));
    sjSS = { totalSJ: n * tau2, perStudy };
  }

  const FAST_PATH_METHODS = new Set([...DL_SS_METHODS, "HE", "SQGENQ", ...LIKEL_METHODS, "PM", "SJ"]);
  const useFastPath = FAST_PATH_METHODS.has(method) && ciMethod !== "PL";
  const df_loo = n - 2;

  return studies.map((study, idx) => {
    let tau2_loo, RE_loo, seRE_loo;

    if (useFastPath) {
      const wi_fe = 1 / study.vi;

      if (method === "DL" || method === "GENQ") {
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const W2_l  = dlSS.W2   - wi_fe * wi_fe;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        const c_l   = W_l   - W2_l / W_l;
        tau2_loo = c_l > 0 ? Math.max(0, (Q_l - (n - 2)) / c_l) : 0;

      } else if (method === "HS") {
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        tau2_loo = W_l > 0 ? Math.max(0, (Q_l - (n - 2)) / W_l) : 0;

      } else if (method === "HSk") {
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        const tau2_hs_l = W_l > 0 ? Math.max(0, (Q_l - (n - 2)) / W_l) : 0;
        tau2_loo = n > 2 ? tau2_hs_l * (n - 1) / (n - 2) : 0;

      } else if (method === "DLIT") {
        // DL_loo seed (FE weights) is an upper bound; DLIT fixed-point descends
        // monotonically toward the positive fixed point from there.
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const W2_l  = dlSS.W2   - wi_fe * wi_fe;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        const c_l   = W_l   - W2_l / W_l;
        let t2 = c_l > 0 ? Math.max(0, (Q_l - (n - 2)) / c_l) : 0;
        for (let iter = 0; iter < 200; iter++) {
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
        const k_l   = n - 1;
        const SY_l  = heSS.SY  - study.yi;
        const SY2_l = heSS.SY2 - study.yi * study.yi;
        const SV_l  = heSS.SV  - study.vi;
        const SS_l  = SY2_l - SY_l * SY_l / k_l;
        tau2_loo = k_l > 1 ? Math.max(0, SS_l / (k_l - 1) - SV_l / k_l) : 0;

      } else if (method === "SQGENQ") {
        const ai     = Math.sqrt(wi_fe);
        const k_l    = n - 1;
        const A_l    = sqSS.SA   - ai;
        const SAY_l  = sqSS.SAY  - ai * study.yi;
        const SAY2_l = sqSS.SAY2 - ai * study.yi * study.yi;
        const SsV_l  = sqSS.SsV  - Math.sqrt(study.vi);
        const Wfe_l  = sqSS.W_fe - wi_fe;
        if (A_l <= 0) {
          tau2_loo = 0;
        } else {
          const Qa_l = SAY2_l - SAY_l * SAY_l / A_l;
          const ba_l = SsV_l  - k_l / A_l;
          const ca_l = A_l    - Wfe_l / A_l;
          tau2_loo = ca_l > 0 ? Math.max(0, (Qa_l - ba_l) / ca_l) : 0;
        }

      } else if (method === "PM") {
        // Seed via exact Q_loo(τ²_full) = WY2_l − WY_l²/W_l (O(1)).
        const wi    = 1 / (study.vi + full.tau2);
        const W_l   = W - wi;
        const WY_l  = pmSS.WY_re  - wi * study.yi;
        const WY2_l = pmSS.WY2_re - wi * study.yi * study.yi;
        const Q_PM_l = W_l > 0 ? WY2_l - WY_l * WY_l / W_l : 0;
        let t2 = W_l > 0 ? Math.max(0, full.tau2 + (Q_PM_l - (n - 2)) / W_l) : full.tau2;
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
        // Seed: (k·τ²_full − sjContrib_i) / (k−1).
        let t2 = Math.max(0, (sjSS.totalSJ - sjSS.perStudy[idx]) / (n - 1));
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

      } else {
        // REML / ML / EBLUP: one-step Newton seed + warm-start refinement.
        const { score_i, info_i } = likelSS.perStudy[idx];
        const infoLoo = likelSS.totalInfo - info_i;
        let t2 = infoLoo > 0 ? Math.max(0, full.tau2 + score_i / infoLoo) : full.tau2;
        const isREML = method !== "ML";
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
        if (j === idx) continue;
        const wj = 1 / Math.max(studies[j].vi + tau2_loo, MIN_VAR);
        W_RE_l += wj; WY_RE_l += wj * studies[j].yi; WY2_RE_l += wj * studies[j].yi * studies[j].yi;
      }
      RE_loo = W_RE_l > 0 ? WY_RE_l / W_RE_l : NaN;
      if (ciMethod === "KH" && df_loo > 0) {
        const sumKH = WY2_RE_l - WY_RE_l * WY_RE_l / W_RE_l;
        seRE_loo = Math.sqrt(Math.max(sumKH, 0) / (df_loo * W_RE_l));
      } else {
        seRE_loo = W_RE_l > 0 ? Math.sqrt(1 / W_RE_l) : NaN;
      }

    } else {
      // Full meta(loo) — only reached for ciMethod="PL" (requires the full likelihood surface).
      const loo = studies.filter((_, i) => i !== idx);
      const looMeta = meta(loo, method, ciMethod, alpha);
      tau2_loo = looMeta.tau2;
      RE_loo   = looMeta.RE;
      seRE_loo = looMeta.seRE;
    }

    const hat = (1 / (study.vi + full.tau2)) / W;
    return { tau2_loo, RE_loo, seRE_loo, hat };
  });
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

  const rows = looEngine(studies, full, method, ciMethod, alpha);

  return studies.map((study, idx) => {
    const { tau2_loo, RE_loo, seRE_loo, hat } = rows[idx];

    const r         = (study.yi - full.RE) / Math.sqrt(study.vi + full.tau2);
    const dfbeta    = (full.RE - RE_loo) / seRE_loo;
    const deltaTau2 = full.tau2 - tau2_loo;
    const outlier     = Math.abs(r) > 2;
    const influential = Math.abs(dfbeta) > 1;

    // Covariance ratio: ratio of the determinant of the variance-covariance
    // matrix of μ̂ with study i removed vs. full dataset. For p=1 (intercept-only):
    //   covRatio_i = Var(μ̂_loo,i) / Var(μ̂_full) = W_full / W_loo,i
    // where W_loo,i = Σ_{j≠i} 1/(v_j + τ²_loo,i) uses the LOO τ².
    // Verified against metafor 4.8-0 influence.rma.uni() to ≤ 1.78e-15.
    const W_loo    = studies.reduce((acc, s, j) => j === idx ? acc : acc + 1 / (s.vi + tau2_loo), 0);
    const covRatio = W_loo > 0 ? W / W_loo : NaN;

    // Cook's distance: D_i = (RE_full − RE_loo)² × W
    const cookD = (full.RE - RE_loo) ** 2 * W;

    // DFFITS: standardised change in fitted value on study removal.
    // Formula from metafor influence.rma.uni() (s2w = 1 for RE models):
    //   DFFITS_i = (μ̂ − μ̂_{−i}) / sqrt(h_i · (τ²_{−i} + v_i))
    // Verified against metafor 4.8-0 to floating-point precision.
    const dffitsVar = hat * (tau2_loo + study.vi);
    const DFFITS    = dffitsVar > 0 ? (full.RE - RE_loo) / Math.sqrt(dffitsVar) : NaN;

    // Flagging thresholds (regression-analogy)
    const highLeverage = hat   > 2 / n;
    const highCookD    = cookD > 4 / n;
    const dffitsThresh = 3 * Math.sqrt(1 / (n - 1));
    const highDffits   = isFinite(DFFITS) && Math.abs(DFFITS) > dffitsThresh;
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

  // dlSS always computed: FE Q_loo drives I²_loo for every τ² method.
  let dl_W_fe = 0, dl_WY = 0, dl_WY2 = 0, dl_W2 = 0;
  for (const d of studies) {
    const wi = 1 / d.vi;
    dl_W_fe += wi; dl_WY += wi * d.yi; dl_WY2 += wi * d.yi * d.yi; dl_W2 += wi * wi;
  }
  const dlSS = { W_fe: dl_W_fe, WY: dl_WY, WY2: dl_WY2, W2: dl_W2 };

  const df_loo  = n - 2;
  const crit_loo = (ciMethod === "KH" || ciMethod === "t") ? tCritical(df_loo, alpha) : normalQuantile(1 - alpha / 2);
  const useT     = (ciMethod === "KH" || ciMethod === "t");

  // Engine is called once for non-PL methods; PL is handled per-study below
  // because meta() returns asymmetric profile-likelihood CI bounds directly.
  const engineRows = ciMethod !== "PL" ? looEngine(studies, full, method, ciMethod, alpha) : null;

  const rows = studies.map((omitted, omitIdx) => {
    // FE LOO sufficient stats — used for i2_loo regardless of τ² method.
    const wi_fe    = 1 / omitted.vi;
    const W_fe_l   = dlSS.W_fe - wi_fe;
    const WY_fe_l  = dlSS.WY   - wi_fe * omitted.yi;
    const WY2_fe_l = dlSS.WY2  - wi_fe * omitted.yi * omitted.yi;
    const Q_fe_l   = W_fe_l > 0 ? WY2_fe_l - WY_fe_l * WY_fe_l / W_fe_l : 0;
    const i2_loo   = (Q_fe_l > df_loo && Q_fe_l > 0)
      ? Math.min(100, ((Q_fe_l - df_loo) / Q_fe_l) * 100) : 0;

    if (ciMethod === "PL") {
      // Profile-likelihood CIs are asymmetric; take bounds directly from meta().
      const subset = studies.filter((_, i) => i !== omitIdx);
      const m = meta(subset, method, ciMethod, alpha);
      return {
        label:       omitted.label ?? `Study ${omitIdx + 1}`,
        estimate:    m.RE,
        lb:          m.ciLow,
        ub:          m.ciHigh,
        tau2:        m.tau2,
        i2:          i2_loo,
        pval:        m.pval,
        significant: m.pval < 0.05,
      };
    }

    const { tau2_loo, RE_loo, seRE_loo } = engineRows[omitIdx];
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
  const methods = ["DL", "REML", "PM", "EB", "PMM", "GENQM", "ML", "HS", "HE", "SJ", "GENQ", "SQGENQ", "DLIT", "EBLUP", "HSk"];
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
  const valid = validStudies(studies);
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
  const valid = validStudies(studies);
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
