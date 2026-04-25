// =============================================================================
// influence.js — influence diagnostics, leave-one-out, cumulative meta,
//                baujat, BLUP, estimator comparison
//
// Extracted from analysis.js (item 4.1.4 of TECHNICAL IMPROVEMENT ROADMAP).
// =============================================================================

// Circular imports — safe: these are only called inside function bodies.
import { meta, tau2_REML } from "./analysis.js";
import { normalCDF, normalQuantile, tCDF, tCritical } from "./utils.js";
import { MIN_VAR, REML_TOL } from "./constants.js";

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
        // formula using RE-updated weights.  The DL_loo seed (FE weights) is an
        // upper bound on τ²_DLIT_loo, which means the iteration always descends
        // monotonically toward the positive fixed point.  Seeding from τ²_full
        // or a one-step RE estimate is NOT safe: it can place the start below
        // the fixed point and cause convergence to τ²=0 for influential studies.
        // No filter() allocation: index guard.
        const W_l   = dlSS.W_fe - wi_fe;
        const WY_l  = dlSS.WY   - wi_fe * study.yi;
        const WY2_l = dlSS.WY2  - wi_fe * study.yi * study.yi;
        const W2_l  = dlSS.W2   - wi_fe * wi_fe;
        const Q_l   = WY2_l - WY_l * WY_l / W_l;
        const c_l   = W_l   - W2_l / W_l;
        let t2 = c_l > 0 ? Math.max(0, (Q_l - (n - 2)) / c_l) : 0;  // DL seed (upper bound)
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

