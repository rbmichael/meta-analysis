// ================= EFFECT PROFILES =================
// Single source of truth for every effect type.
// Each profile contains:
//   label             — display name used in dropdowns
//   isTransformedScale— true when yi is on a transformed scale (log, logit, etc.)
//   inputs            — ordered column names expected in the data table
//   compute           — derives yi/vi from raw study data
//   transform         — back-transforms a single value for display
//   validate          — returns { valid, errors } for hard input validation
//   softWarnings      — returns string[] of advisory warnings
//   exampleData       — rows passed to addRow() when the type is first selected
//                       format: [label, ...inputs, group]
// To back-transform a CI pair use: { lb: profile.transform(lb), ub: profile.transform(ub) }

import { MIN_VAR, hedgesG } from "./utils.js";

export const effectProfiles = {

  // ------------------------------------------------------------------ //
  "MD": {
    label:  "Mean Difference",
    inputs: ["m1", "sd1", "n1", "m2", "sd2", "n2"],
    compute(s) {
      const varMD = Math.max(s.sd1**2/s.n1 + s.sd2**2/s.n2, MIN_VAR);
      return { ...s, md: s.m1 - s.m2, varMD, se: Math.sqrt(varMD), w: 1/varMD, yi: s.m1 - s.m2, vi: varMD };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      if (!isFinite(s.m1))              errors.m1  = "m1 must be numeric";
      if (!isFinite(s.sd1) || s.sd1 <= 0) errors.sd1 = "sd1 must be > 0";
      if (!isFinite(s.n1)  || s.n1  < 1)  errors.n1  = "n1 must be ≥ 1";
      if (!isFinite(s.m2))              errors.m2  = "m2 must be numeric";
      if (!isFinite(s.sd2) || s.sd2 <= 0) errors.sd2 = "sd2 must be > 0";
      if (!isFinite(s.n2)  || s.n2  < 1)  errors.n2  = "n2 must be ≥ 1";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n1) && s.n1 < 10) w.push(`⚠️ ${label}: small sample size (n1 < 10)`);
      if (isFinite(s.n2) && s.n2 < 10) w.push(`⚠️ ${label}: small sample size (n2 < 10)`);
      if (isFinite(s.n1) && isFinite(s.n2) && Math.max(s.n1, s.n2) / Math.min(s.n1, s.n2) > 3)
        w.push(`⚠️ ${label}: highly imbalanced group sizes`);
      if (isFinite(s.sd1) && isFinite(s.sd2) && Math.max(s.sd1, s.sd2) / Math.min(s.sd1, s.sd2) > 3)
        w.push(`⚠️ ${label}: large SD imbalance`);
      return w;
    },

    exampleData: [
      ["Study1", 10, 2, 30, 8, 2, 28, "A"],
      ["Study2", 12, 3, 32, 9, 3, 30, "A"],
      ["Study3",  9, 2, 28, 7, 2, 25, "B"],
    ],
  },

  // ------------------------------------------------------------------ //
  "SMD": {
    label:  "Standardized Mean Difference (Hedges g)",
    inputs: ["m1", "sd1", "n1", "m2", "sd2", "n2"],
    compute(s) {
      const g = hedgesG(s, { hedgesCorrection: true });
      return { ...s, md: g.es, varMD: g.var, se: Math.sqrt(g.var), w: 1/g.var, yi: g.es, vi: g.var };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      if (!isFinite(s.m1))              errors.m1  = "m1 must be numeric";
      if (!isFinite(s.sd1) || s.sd1 <= 0) errors.sd1 = "sd1 must be > 0";
      if (!isFinite(s.n1)  || s.n1  < 1)  errors.n1  = "n1 must be ≥ 1";
      if (!isFinite(s.m2))              errors.m2  = "m2 must be numeric";
      if (!isFinite(s.sd2) || s.sd2 <= 0) errors.sd2 = "sd2 must be > 0";
      if (!isFinite(s.n2)  || s.n2  < 1)  errors.n2  = "n2 must be ≥ 1";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n1) && s.n1 < 10) w.push(`⚠️ ${label}: small sample size (n1 < 10)`);
      if (isFinite(s.n2) && s.n2 < 10) w.push(`⚠️ ${label}: small sample size (n2 < 10)`);
      if (isFinite(s.n1) && isFinite(s.n2) && Math.max(s.n1, s.n2) / Math.min(s.n1, s.n2) > 3)
        w.push(`⚠️ ${label}: highly imbalanced group sizes`);
      if (isFinite(s.sd1) && isFinite(s.sd2) && Math.max(s.sd1, s.sd2) / Math.min(s.sd1, s.sd2) > 3)
        w.push(`⚠️ ${label}: large SD imbalance`);
      return w;
    },

    exampleData: [
      ["Study1", 10, 2, 30, 8, 2, 28, "A"],
      ["Study2", 12, 3, 32, 9, 3, 30, "A"],
      ["Study3",  9, 2, 28, 7, 2, 25, "B"],
    ],
  },

  // ------------------------------------------------------------------ //
  "SMDH": {
    label:  "Standardized Mean Difference (heteroscedastic)",
    inputs: ["m1", "sd1", "n1", "m2", "sd2", "n2"],
    compute(s) {
      const { m1, sd1, n1, m2, sd2, n2 } = s;
      if (!isFinite(m1) || !isFinite(sd1) || !isFinite(n1) ||
          !isFinite(m2) || !isFinite(sd2) || !isFinite(n2) ||
          sd1 <= 0 || sd2 <= 0 || n1 < 2 || n2 < 2)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const df   = n1 + n2 - 2;
      const sdi2 = (sd1 ** 2 + sd2 ** 2) / 2;
      const sdi  = Math.sqrt(sdi2);
      const d    = (m1 - m2) / sdi;
      const J    = 1 - 3 / (4 * df - 1);
      const g    = d * J;
      const vi_d = (sd1 ** 2 / n1 + sd2 ** 2 / n2) / sdi2 + d ** 2 / (2 * df);
      const vi_g = Math.max(vi_d * J ** 2, MIN_VAR);
      return { ...s, md: g, varMD: vi_g, yi: g, vi: vi_g, se: Math.sqrt(vi_g), w: 1 / vi_g };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      if (!isFinite(s.m1))                errors.m1  = "m1 must be numeric";
      if (!isFinite(s.sd1) || s.sd1 <= 0) errors.sd1 = "sd1 must be > 0";
      if (!isFinite(s.n1)  || s.n1  < 2)  errors.n1  = "n1 must be ≥ 2";
      if (!isFinite(s.m2))                errors.m2  = "m2 must be numeric";
      if (!isFinite(s.sd2) || s.sd2 <= 0) errors.sd2 = "sd2 must be > 0";
      if (!isFinite(s.n2)  || s.n2  < 2)  errors.n2  = "n2 must be ≥ 2";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n1) && s.n1 < 10) w.push(`⚠️ ${label}: small sample size (n1 < 10)`);
      if (isFinite(s.n2) && s.n2 < 10) w.push(`⚠️ ${label}: small sample size (n2 < 10)`);
      if (isFinite(s.n1) && isFinite(s.n2) && Math.max(s.n1, s.n2) / Math.min(s.n1, s.n2) > 3)
        w.push(`⚠️ ${label}: highly imbalanced group sizes`);
      if (isFinite(s.sd1) && isFinite(s.sd2) && Math.max(s.sd1, s.sd2) / Math.min(s.sd1, s.sd2) > 3)
        w.push(`⚠️ ${label}: large SD imbalance`);
      if (isFinite(s.sd1) && isFinite(s.sd2) && s.sd1 > 0 && s.sd2 > 0 &&
          Math.max(s.sd1, s.sd2) / Math.min(s.sd1, s.sd2) < 1.1)
        w.push(`⚠️ ${label}: sd1 ≈ sd2 — standard SMD (pooled SD) is equally valid and more widely reported`);
      return w;
    },

    exampleData: [
      ["Study1", 10, 3.5, 30,  8,   1.2, 28, "A"],
      ["Study2", 12, 4.1, 32,  9,   1.8, 30, "A"],
      ["Study3",  9, 2.8, 28,  7,   1.0, 25, "B"],
      ["Study4", 14, 5.0, 40, 10,   2.3, 38, "B"],
      ["Study5", 11, 3.2, 35,  8.5, 1.5, 33, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "MD_paired": {
    label:  "Mean Difference (Paired)",
    inputs: ["m_pre", "sd_pre", "m_post", "sd_post", "n", "r"],
    compute(s) {
      const { m_pre, m_post, sd_pre, sd_post, n, r } = s;
      if (![m_pre, m_post, sd_pre, sd_post, n].every(isFinite) || n < 2)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const corr = isFinite(r) ? r : 0.5;
      const md = m_post - m_pre;
      const varMD = (sd_pre**2 + sd_post**2 - 2*corr*sd_pre*sd_post) / n;
      return { ...s, yi: md, vi: Math.max(varMD, MIN_VAR), se: Math.sqrt(Math.max(varMD, MIN_VAR)), w: 1 / Math.max(varMD, MIN_VAR), md, varMD };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      if (!isFinite(s.m_pre))                  errors.m_pre  = "m_pre must be numeric";
      if (!isFinite(s.m_post))                 errors.m_post = "m_post must be numeric";
      if (!isFinite(s.sd_pre)  || s.sd_pre  <= 0) errors.sd_pre  = "sd_pre must be > 0";
      if (!isFinite(s.sd_post) || s.sd_post <= 0) errors.sd_post = "sd_post must be > 0";
      if (!isFinite(s.n) || s.n < 2)          errors.n = "n must be ≥ 2";
      if (isFinite(s.r) && (s.r < -1 || s.r > 1)) errors.r = "r must be between -1 and 1";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(_s, _label) { return []; },

    exampleData: [
      ["Study1", 10, 2, 8, 2, 30, 0.5, "A"],
      ["Study2", 12, 3, 9, 3, 32, 0.6, "A"],
      ["Study3",  9, 2, 7, 2, 28, 0.4, "B"],
    ],
  },

  // ------------------------------------------------------------------ //
  "SMD_paired": {
    label:  "Standardized Mean Change",
    inputs: ["m_pre", "sd_pre", "m_post", "sd_post", "n", "r"],
    compute(s) {
      const { m_pre, m_post, sd_pre, sd_post, n, r } = s;
      if (![m_pre, m_post, sd_pre, sd_post, n].every(isFinite) || n < 2)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const corr = isFinite(r) ? r : 0.5;
      const mean_change = m_post - m_pre;
      const sd_change = Math.sqrt(sd_pre**2 + sd_post**2 - 2*corr*sd_pre*sd_post);
      const d = mean_change / sd_change;
      const df = n - 1;
      const J = 1 - (3 / (4*df - 1));
      const g = d * J;
      const var_d = (1/n) + (d*d)/(2*n);
      return { ...s, yi: g, vi: Math.max(var_d, MIN_VAR), se: Math.sqrt(Math.max(var_d, MIN_VAR)), w: 1 / Math.max(var_d, MIN_VAR), md: g, varMD: var_d };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      if (!isFinite(s.m_pre))                  errors.m_pre  = "m_pre must be numeric";
      if (!isFinite(s.m_post))                 errors.m_post = "m_post must be numeric";
      if (!isFinite(s.sd_pre)  || s.sd_pre  <= 0) errors.sd_pre  = "sd_pre must be > 0";
      if (!isFinite(s.sd_post) || s.sd_post <= 0) errors.sd_post = "sd_post must be > 0";
      if (!isFinite(s.n) || s.n < 2)          errors.n = "n must be ≥ 2";
      if (isFinite(s.r) && (s.r < -1 || s.r > 1)) errors.r = "r must be between -1 and 1";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(_s, _label) { return []; },

    exampleData: [
      ["Study1", 10, 2, 8, 2, 30, 0.5, "A"],
      ["Study2", 12, 3, 9, 3, 32, 0.6, "A"],
      ["Study3",  9, 2, 7, 2, 28, 0.4, "B"],
    ],
  },

  // ------------------------------------------------------------------ //
  "ROM": {
    label:  "Ratio of Means (ROM)",
    isTransformedScale: true,
    inputs: ["m1", "sd1", "n1", "m2", "sd2", "n2"],
    compute(s) {
      const { m1, sd1, n1, m2, sd2, n2 } = s;
      if (!isFinite(m1) || !isFinite(sd1) || !isFinite(n1) ||
          !isFinite(m2) || !isFinite(sd2) || !isFinite(n2) ||
          m1 <= 0 || m2 <= 0 || sd1 <= 0 || sd2 <= 0 || n1 < 1 || n2 < 1)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const yi = Math.log(m1 / m2);
      const vi = Math.max((sd1 ** 2) / (n1 * m1 ** 2) + (sd2 ** 2) / (n2 * m2 ** 2), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      if (!isFinite(s.m1))                errors.m1  = "m1 must be numeric";
      if (isFinite(s.m1) && s.m1 <= 0)   errors.m1  = "m1 must be > 0";
      if (!isFinite(s.sd1) || s.sd1 <= 0) errors.sd1 = "sd1 must be > 0";
      if (!isFinite(s.n1)  || s.n1  < 1)  errors.n1  = "n1 must be ≥ 1";
      if (!isFinite(s.m2))                errors.m2  = "m2 must be numeric";
      if (isFinite(s.m2) && s.m2 <= 0)   errors.m2  = "m2 must be > 0";
      if (!isFinite(s.sd2) || s.sd2 <= 0) errors.sd2 = "sd2 must be > 0";
      if (!isFinite(s.n2)  || s.n2  < 1)  errors.n2  = "n2 must be ≥ 1";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.m1) && s.m1 <= 0)
        w.push(`⚠️ ${label}: m1 ≤ 0 — ROM requires strictly positive means (study excluded)`);
      if (isFinite(s.m2) && s.m2 <= 0)
        w.push(`⚠️ ${label}: m2 ≤ 0 — ROM requires strictly positive means (study excluded)`);
      if (isFinite(s.sd1) && s.sd1 <= 0)
        w.push(`⚠️ ${label}: sd1 ≤ 0 — standard deviation must be positive (study excluded)`);
      if (isFinite(s.sd2) && s.sd2 <= 0)
        w.push(`⚠️ ${label}: sd2 ≤ 0 — standard deviation must be positive (study excluded)`);
      if (isFinite(s.n1) && s.n1 < 10)
        w.push(`⚠️ ${label}: small sample size (n1 < 10) — delta-method variance may be unreliable`);
      if (isFinite(s.n2) && s.n2 < 10)
        w.push(`⚠️ ${label}: small sample size (n2 < 10) — delta-method variance may be unreliable`);
      if (isFinite(s.sd1) && isFinite(s.m1) && s.m1 > 0 && s.sd1 / s.m1 > 1)
        w.push(`⚠️ ${label}: CV₁ > 1 (sd1/m1 > 1) — high variability; delta-method approximation may be poor`);
      if (isFinite(s.sd2) && isFinite(s.m2) && s.m2 > 0 && s.sd2 / s.m2 > 1)
        w.push(`⚠️ ${label}: CV₂ > 1 (sd2/m2 > 1) — high variability; delta-method approximation may be poor`);
      return w;
    },

    exampleData: [
      ["Study 1", 28.5, 4.2, 45, 22.1, 3.8, 43, ""],
      ["Study 2", 35.2, 6.1, 60, 24.8, 5.2, 58, ""],
      ["Study 3", 19.8, 3.3, 32, 16.2, 2.9, 30, ""],
      ["Study 4", 42.1, 7.5, 80, 31.5, 6.8, 78, ""],
      ["Study 5", 25.6, 4.8, 50, 20.3, 4.1, 48, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "CVR": {
    label:  "Coefficient of Variation Ratio (CVR)",
    isTransformedScale: true,
    inputs: ["m1", "sd1", "n1", "m2", "sd2", "n2"],
    compute(s) {
      const { m1, sd1, n1, m2, sd2, n2 } = s;
      if (!isFinite(m1) || !isFinite(sd1) || !isFinite(n1) ||
          !isFinite(m2) || !isFinite(sd2) || !isFinite(n2) ||
          m1 <= 0 || m2 <= 0 || sd1 <= 0 || sd2 <= 0 || n1 < 2 || n2 < 2)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const cv1 = sd1 / m1;
      const cv2 = sd2 / m2;
      const yi  = Math.log(cv1 / cv2);
      const vi  = Math.max(1 / (2 * (n1 - 1)) + cv1 ** 2 / n1 + 1 / (2 * (n2 - 1)) + cv2 ** 2 / n2, MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      if (!isFinite(s.m1))                errors.m1  = "m1 must be numeric";
      if (isFinite(s.m1) && s.m1 <= 0)   errors.m1  = "m1 must be > 0";
      if (!isFinite(s.sd1) || s.sd1 <= 0) errors.sd1 = "sd1 must be > 0";
      if (!isFinite(s.n1)  || s.n1  < 2)  errors.n1  = "n1 must be ≥ 2";
      if (!isFinite(s.m2))                errors.m2  = "m2 must be numeric";
      if (isFinite(s.m2) && s.m2 <= 0)   errors.m2  = "m2 must be > 0";
      if (!isFinite(s.sd2) || s.sd2 <= 0) errors.sd2 = "sd2 must be > 0";
      if (!isFinite(s.n2)  || s.n2  < 2)  errors.n2  = "n2 must be ≥ 2";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.m1) && s.m1 <= 0)
        w.push(`⚠️ ${label}: m1 ≤ 0 — CVR requires strictly positive means (study excluded)`);
      if (isFinite(s.m2) && s.m2 <= 0)
        w.push(`⚠️ ${label}: m2 ≤ 0 — CVR requires strictly positive means (study excluded)`);
      if (isFinite(s.sd1) && s.sd1 <= 0)
        w.push(`⚠️ ${label}: sd1 ≤ 0 — standard deviation must be positive (study excluded)`);
      if (isFinite(s.sd2) && s.sd2 <= 0)
        w.push(`⚠️ ${label}: sd2 ≤ 0 — standard deviation must be positive (study excluded)`);
      if (isFinite(s.n1) && s.n1 < 10)
        w.push(`⚠️ ${label}: small sample size (n1 < 10) — CVR variance estimate unreliable`);
      if (isFinite(s.n2) && s.n2 < 10)
        w.push(`⚠️ ${label}: small sample size (n2 < 10) — CVR variance estimate unreliable`);
      if (isFinite(s.sd1) && isFinite(s.m1) && s.m1 > 0 && s.sd1 / s.m1 > 1)
        w.push(`⚠️ ${label}: CV₁ > 1 (sd1/m1 > 1) — large coefficient of variation; variance approximation may be poor`);
      if (isFinite(s.sd2) && isFinite(s.m2) && s.m2 > 0 && s.sd2 / s.m2 > 1)
        w.push(`⚠️ ${label}: CV₂ > 1 (sd2/m2 > 1) — large coefficient of variation; variance approximation may be poor`);
      return w;
    },

    exampleData: [
      ["Study 1", 25.0,  6.2, 40, 24.8, 3.5, 38, ""],
      ["Study 2", 30.1,  9.0, 55, 29.7, 4.8, 52, ""],
      ["Study 3", 18.5,  5.1, 30, 19.0, 3.0, 28, ""],
      ["Study 4", 42.0, 11.5, 70, 40.5, 6.2, 68, ""],
      ["Study 5", 22.3,  7.8, 45, 23.1, 4.9, 43, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "VR": {
    label:  "Variability Ratio (VR)",
    isTransformedScale: true,
    inputs: ["sd1", "n1", "sd2", "n2"],
    compute(s) {
      const { sd1, n1, sd2, n2 } = s;
      if (!isFinite(sd1) || !isFinite(n1) || !isFinite(sd2) || !isFinite(n2) ||
          sd1 <= 0 || sd2 <= 0 || n1 < 2 || n2 < 2)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const yi = Math.log(sd1 / sd2);
      const vi = Math.max(1 / (2 * (n1 - 1)) + 1 / (2 * (n2 - 1)), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      if (!isFinite(s.sd1) || s.sd1 <= 0) errors.sd1 = "sd1 must be > 0";
      if (!isFinite(s.n1)  || s.n1  < 2)  errors.n1  = "n1 must be ≥ 2";
      if (!isFinite(s.sd2) || s.sd2 <= 0) errors.sd2 = "sd2 must be > 0";
      if (!isFinite(s.n2)  || s.n2  < 2)  errors.n2  = "n2 must be ≥ 2";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.sd1) && s.sd1 <= 0)
        w.push(`⚠️ ${label}: sd1 ≤ 0 — standard deviation must be positive (study excluded)`);
      if (isFinite(s.sd2) && s.sd2 <= 0)
        w.push(`⚠️ ${label}: sd2 ≤ 0 — standard deviation must be positive (study excluded)`);
      if (isFinite(s.n1) && s.n1 < 10)
        w.push(`⚠️ ${label}: small sample size (n1 < 10) — VR variance estimate unreliable`);
      if (isFinite(s.n2) && s.n2 < 10)
        w.push(`⚠️ ${label}: small sample size (n2 < 10) — VR variance estimate unreliable`);
      if (isFinite(s.sd1) && isFinite(s.sd2) && s.sd1 > 0 && s.sd2 > 0 &&
          Math.max(s.sd1, s.sd2) / Math.min(s.sd1, s.sd2) > 4)
        w.push(`⚠️ ${label}: extreme SD ratio (> 4) — check units are consistent across studies`);
      return w;
    },

    exampleData: [
      ["Study 1", 4.2, 40, 2.8, 38, ""],
      ["Study 2", 5.5, 55, 3.2, 52, ""],
      ["Study 3", 3.8, 30, 2.5, 28, ""],
      ["Study 4", 6.1, 70, 4.0, 68, ""],
      ["Study 5", 4.9, 45, 3.5, 43, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "OR": {
    label:  "Odds Ratio",
    isTransformedScale: true,
    inputs: ["a", "b", "c", "d"],
    compute(s) {
      let { a, b, c, d } = s;
      if ([a, b, c, d].some(v => !isFinite(v) || v < 0))
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      if (a === 0 || b === 0 || c === 0 || d === 0) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
      const yi = Math.log((a*d)/(b*c));
      const vi = Math.max(1/a + 1/b + 1/c + 1/d, MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1/vi, md: yi, varMD: vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      ["a", "b", "c", "d"].forEach(k => {
        if (!isFinite(s[k]) || s[k] < 0) errors[k] = `${k} must be ≥ 0`;
      });
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if ([s.a, s.b, s.c, s.d].some(v => v === 0))
        w.push(`⚠️ ${label}: zero cell detected (continuity correction applied)`);
      const total = s.a + s.b + s.c + s.d;
      if (isFinite(total) && total > 0 && Math.min(s.a, s.b, s.c, s.d) / total < 0.05)
        w.push(`⚠️ ${label}: rare events (unstable estimate)`);
      return w;
    },

    exampleData: [
      ["Study1", 12,  5,  8, 15, "A"],
      ["Study2", 20, 10,  5, 25, "B"],
      ["Study3", 10,  4,  6, 12, "B"],
    ],
  },

  // ------------------------------------------------------------------ //
  "RR": {
    label:  "Risk Ratio",
    isTransformedScale: true,
    inputs: ["a", "b", "c", "d"],
    compute(s) {
      let { a, b, c, d } = s;
      if ([a, b, c, d].some(v => !isFinite(v) || v < 0))
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      if (a === 0 || b === 0 || c === 0 || d === 0) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
      const risk1 = a/(a+b), risk2 = c/(c+d);
      const yi = Math.log(risk1/risk2);
      const vi = Math.max((1/a - 1/(a+b)) + (1/c - 1/(c+d)), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1/vi, md: yi, varMD: vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      ["a", "b", "c", "d"].forEach(k => {
        if (!isFinite(s[k]) || s[k] < 0) errors[k] = `${k} must be ≥ 0`;
      });
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if ([s.a, s.b, s.c, s.d].some(v => v === 0))
        w.push(`⚠️ ${label}: zero cell detected (continuity correction applied)`);
      const total = s.a + s.b + s.c + s.d;
      if (isFinite(total) && total > 0 && Math.min(s.a, s.b, s.c, s.d) / total < 0.05)
        w.push(`⚠️ ${label}: rare events (unstable estimate)`);
      return w;
    },

    exampleData: [
      ["Study1", 12,  5,  8, 15, "A"],
      ["Study2", 20, 10,  5, 25, "B"],
      ["Study3", 10,  4,  6, 12, "B"],
    ],
  },

  // ------------------------------------------------------------------ //
  "RD": {
    label:  "Risk Difference",
    inputs: ["a", "b", "c", "d"],
    compute(s) {
      const { a, b, c, d } = s;
      if ([a, b, c, d].some(v => !isFinite(v) || v < 0))
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const risk1 = a / (a + b);
      const risk2 = c / (c + d);
      const yi = risk1 - risk2;
      const vi = Math.max((risk1*(1-risk1)/(a+b)) + (risk2*(1-risk2)/(c+d)), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1/vi, md: yi, varMD: vi };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      ["a", "b", "c", "d"].forEach(k => {
        if (!isFinite(s[k]) || s[k] < 0) errors[k] = `${k} must be ≥ 0`;
      });
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(_s, _label) { return []; },

    exampleData: [
      ["Study 1", 12,  8, 15, 10, "A"],
      ["Study 2", 20, 10, 18, 12, "A"],
      ["Study 3",  8,  7, 10,  9, "B"],
    ],
  },

  // ------------------------------------------------------------------ //
  "COR": {
    label:  "Correlation (raw r)",
    inputs: ["r", "n"],
    compute(s) {
      const { r, n } = s;
      if (!isFinite(r) || !isFinite(n) || Math.abs(r) >= 1 || n < 2)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const vi = Math.max((1 - r * r) ** 2 / (n - 1), MIN_VAR);
      return { ...s, yi: r, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      if (!isFinite(s.r) || Math.abs(s.r) >= 1) errors.r = "r must be strictly between -1 and 1";
      if (!isFinite(s.n) || s.n < 3)            errors.n = "n must be ≥ 3";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n) && s.n < 10)
        w.push(`⚠️ ${label}: small sample size (n < 10) — correlation estimate unreliable`);
      if (isFinite(s.r) && Math.abs(s.r) > 0.9)
        w.push(`⚠️ ${label}: |r| > 0.90 — variance estimate near boundary, interpret cautiously`);
      return w;
    },

    exampleData: [
      ["Study 1", 0.45,  62, ""],
      ["Study 2", 0.56,  90, ""],
      ["Study 3", 0.38,  45, ""],
      ["Study 4", 0.61, 120, ""],
      ["Study 5", 0.42,  75, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "ZCOR": {
    label:  "Correlation (Fisher's z)",
    isTransformedScale: true,
    inputs: ["r", "n"],
    compute(s) {
      const { r, n } = s;
      if (!isFinite(r) || !isFinite(n) || Math.abs(r) >= 1 || n < 4)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const yi = Math.atanh(r);
      const vi = Math.max(1 / (n - 3), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.tanh(x),

    validate(s) {
      const errors = {};
      if (!isFinite(s.r) || Math.abs(s.r) >= 1) errors.r = "r must be strictly between -1 and 1";
      if (!isFinite(s.n) || s.n < 4)            errors.n = "n must be ≥ 4";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n) && s.n < 10)
        w.push(`⚠️ ${label}: small sample size (n < 10) — correlation estimate unreliable`);
      if (isFinite(s.r) && Math.abs(s.r) > 0.9)
        w.push(`⚠️ ${label}: |r| > 0.90 — variance estimate near boundary, interpret cautiously`);
      return w;
    },

    exampleData: [
      ["Study 1", 0.45,  62, ""],
      ["Study 2", 0.56,  90, ""],
      ["Study 3", 0.38,  45, ""],
      ["Study 4", 0.61, 120, ""],
      ["Study 5", 0.42,  75, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "PR": {
    label:  "Proportion (raw)",
    inputs: ["x", "n"],
    compute(s) {
      const { x, n } = s;
      if (!isFinite(x) || !isFinite(n) || n < 1 || x < 0 || x > n)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const p = x / n;
      const yi = p;
      const vi = Math.max(p * (1 - p) / n, MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.min(1, Math.max(0, x)),

    validate(s) {
      const errors = {};
      if (!isFinite(s.x) || !Number.isInteger(s.x) || s.x < 0) errors.x = "x must be a non-negative integer";
      if (!isFinite(s.n) || s.n < 1)                           errors.n = "n must be ≥ 1";
      if (isFinite(s.x) && isFinite(s.n) && s.x > s.n)        errors.x = "x cannot exceed n";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n) && s.n < 20)
        w.push(`⚠️ ${label}: small sample size (n < 20) — proportion estimate unreliable`);
      if (isFinite(s.x) && isFinite(s.n) && s.n > 0) {
        const p = s.x / s.n;
        if (p === 0 || p === 1)
          w.push(`⚠️ ${label}: extreme proportion (0 or 1) — variance is zero, study has no weight`);
        else if (p < 0.05 || p > 0.95)
          w.push(`⚠️ ${label}: extreme proportion (< 5% or > 95%) — consider log or logit transform`);
      }
      return w;
    },

    exampleData: [
      ["Study 1", 12,  80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3",  8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "PLN": {
    label:  "Proportion (log)",
    isTransformedScale: true,
    inputs: ["x", "n"],
    compute(s) {
      let { x, n } = s;
      if (!isFinite(x) || !isFinite(n) || n < 1 || x < 0 || x > n)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      if (x === 0 || x === n) { x += 0.5; n += 1; }
      const p = x / n;
      if (p <= 0) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const yi = Math.log(p);
      const vi = Math.max((1 - p) / (n * p), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.min(1, Math.max(0, Math.exp(x))),

    validate(s) {
      const errors = {};
      if (!isFinite(s.x) || !Number.isInteger(s.x) || s.x < 0) errors.x = "x must be a non-negative integer";
      if (!isFinite(s.n) || s.n < 1)                           errors.n = "n must be ≥ 1";
      if (isFinite(s.x) && isFinite(s.n) && s.x > s.n)        errors.x = "x cannot exceed n";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n) && s.n < 20)
        w.push(`⚠️ ${label}: small sample size (n < 20) — proportion estimate unreliable`);
      if (isFinite(s.x) && isFinite(s.n) && s.n > 0) {
        const p = s.x / s.n;
        if (p < 0.05 || p > 0.95)
          w.push(`⚠️ ${label}: extreme proportion (< 5% or > 95%) — consider log or logit transform`);
      }
      return w;
    },

    exampleData: [
      ["Study 1", 12,  80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3",  8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "PLO": {
    label:  "Proportion (logit)",
    isTransformedScale: true,
    inputs: ["x", "n"],
    compute(s) {
      let { x, n } = s;
      if (!isFinite(x) || !isFinite(n) || n < 1 || x < 0 || x > n)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      if (x === 0 || x === n) { x += 0.5; n += 1; }
      const p = x / n;
      if (p <= 0 || p >= 1) return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const yi = Math.log(p / (1 - p));
      const vi = Math.max(1 / (n * p * (1 - p)), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.min(1, Math.max(0, 1 / (1 + Math.exp(-x)))),

    validate(s) {
      const errors = {};
      if (!isFinite(s.x) || !Number.isInteger(s.x) || s.x < 0) errors.x = "x must be a non-negative integer";
      if (!isFinite(s.n) || s.n < 1)                           errors.n = "n must be ≥ 1";
      if (isFinite(s.x) && isFinite(s.n) && s.x > s.n)        errors.x = "x cannot exceed n";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n) && s.n < 20)
        w.push(`⚠️ ${label}: small sample size (n < 20) — proportion estimate unreliable`);
      if (isFinite(s.x) && isFinite(s.n) && s.n > 0) {
        const p = s.x / s.n;
        if (p < 0.05 || p > 0.95)
          w.push(`⚠️ ${label}: extreme proportion (< 5% or > 95%) — consider log or logit transform`);
      }
      return w;
    },

    exampleData: [
      ["Study 1", 12,  80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3",  8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "PAS": {
    label:  "Proportion (arcsine)",
    isTransformedScale: true,
    inputs: ["x", "n"],
    compute(s) {
      const { x, n } = s;
      if (!isFinite(x) || !isFinite(n) || n < 1 || x < 0 || x > n)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const p = x / n;
      const yi = Math.asin(Math.sqrt(p));
      const vi = Math.max(1 / (4 * n), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.min(1, Math.max(0, Math.sin(x) ** 2)),

    validate(s) {
      const errors = {};
      if (!isFinite(s.x) || !Number.isInteger(s.x) || s.x < 0) errors.x = "x must be a non-negative integer";
      if (!isFinite(s.n) || s.n < 1)                           errors.n = "n must be ≥ 1";
      if (isFinite(s.x) && isFinite(s.n) && s.x > s.n)        errors.x = "x cannot exceed n";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n) && s.n < 20)
        w.push(`⚠️ ${label}: small sample size (n < 20) — proportion estimate unreliable`);
      if (isFinite(s.x) && isFinite(s.n) && s.n > 0) {
        const p = s.x / s.n;
        if (p < 0.05 || p > 0.95)
          w.push(`⚠️ ${label}: extreme proportion (< 5% or > 95%) — consider log or logit transform`);
      }
      return w;
    },

    exampleData: [
      ["Study 1", 12,  80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3",  8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "PFT": {
    label:  "Proportion (Freeman-Tukey)",
    isTransformedScale: true,
    inputs: ["x", "n"],
    compute(s) {
      const { x, n } = s;
      if (!isFinite(x) || !isFinite(n) || n < 1 || x < 0 || x > n)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const yi = Math.asin(Math.sqrt(x / (n + 1))) + Math.asin(Math.sqrt((x + 1) / (n + 1)));
      const vi = Math.max(1 / (n + 0.5), MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.min(1, Math.max(0, Math.sin(x / 2) ** 2)),

    validate(s) {
      const errors = {};
      if (!isFinite(s.x) || !Number.isInteger(s.x) || s.x < 0) errors.x = "x must be a non-negative integer";
      if (!isFinite(s.n) || s.n < 1)                           errors.n = "n must be ≥ 1";
      if (isFinite(s.x) && isFinite(s.n) && s.x > s.n)        errors.x = "x cannot exceed n";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.n) && s.n < 20)
        w.push(`⚠️ ${label}: small sample size (n < 20) — proportion estimate unreliable`);
      if (isFinite(s.x) && isFinite(s.n) && s.n > 0) {
        const p = s.x / s.n;
        if (p < 0.05 || p > 0.95)
          w.push(`⚠️ ${label}: extreme proportion (< 5% or > 95%) — consider log or logit transform`);
      }
      return w;
    },

    exampleData: [
      ["Study 1", 12,  80, ""],
      ["Study 2", 25, 120, ""],
      ["Study 3",  8,  60, ""],
      ["Study 4", 40, 200, ""],
      ["Study 5", 18, 100, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "GENERIC": {
    label:  "Generic (yi / vi)",
    inputs: ["yi", "vi"],
    compute(s) {
      const vi = Math.max(s.vi, MIN_VAR);
      return { ...s, yi: s.yi, vi, se: Math.sqrt(vi), w: 1 / vi, md: s.yi, varMD: s.vi };
    },
    transform:   (x) => x,

    validate(s) {
      const errors = {};
      if (!isFinite(s.yi))              errors.yi = "yi must be numeric";
      if (!isFinite(s.vi) || s.vi <= 0) errors.vi = "vi must be > 0";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (isFinite(s.vi) && s.vi > 1)
        w.push(`⚠️ ${label}: large variance (low precision study)`);
      return w;
    },

    exampleData: [
      ["Study 1", -0.889, 0.326, ""],
      ["Study 2", -1.585, 0.255, ""],
      ["Study 3", -1.348, 0.214, ""],
      ["Study 4", -1.442, 0.045, ""],
      ["Study 5", -0.218, 0.031, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "HR": {
    label:  "Hazard Ratio",
    isTransformedScale: true,
    inputs: ["hr", "ci_lo", "ci_hi"],
    compute(s) {
      const { hr, ci_lo, ci_hi } = s;
      if (!isFinite(hr)    || hr    <= 0 ||
          !isFinite(ci_lo) || ci_lo <= 0 ||
          !isFinite(ci_hi) || ci_hi <= 0 ||
          ci_lo >= ci_hi)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      const yi = Math.log(hr);
      const se = (Math.log(ci_hi) - Math.log(ci_lo)) / (2 * 1.96);
      const vi = Math.max(se * se, MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      if (!isFinite(s.hr)    || s.hr    <= 0) errors.hr    = "HR must be > 0";
      if (!isFinite(s.ci_lo) || s.ci_lo <= 0) errors.ci_lo = "CI lower must be > 0";
      if (!isFinite(s.ci_hi) || s.ci_hi <= 0) errors.ci_hi = "CI upper must be > 0";
      if (isFinite(s.ci_lo) && isFinite(s.ci_hi) && s.ci_lo >= s.ci_hi)
        errors.ci_lo = "CI lower must be < CI upper";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(_s, _label) { return []; },

    exampleData: [
      ["Study 1", 0.72, 0.54, 0.96, ""],
      ["Study 2", 0.85, 0.62, 1.17, ""],
      ["Study 3", 0.61, 0.45, 0.83, ""],
      ["Study 4", 0.78, 0.58, 1.05, ""],
      ["Study 5", 0.69, 0.51, 0.93, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "IRR": {
    label:  "Incidence Rate Ratio",
    isTransformedScale: true,
    inputs: ["x1", "t1", "x2", "t2"],
    compute(s) {
      let { x1, t1, x2, t2 } = s;
      if (!isFinite(x1) || x1 < 0 || !isFinite(x2) || x2 < 0 ||
          !isFinite(t1) || t1 <= 0 || !isFinite(t2) || t2 <= 0)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      if (x1 === 0 || x2 === 0) { x1 += 0.5; x2 += 0.5; }
      const yi = Math.log(x1 / t1) - Math.log(x2 / t2);
      const vi = Math.max(1 / x1 + 1 / x2, MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      if (!isFinite(s.x1) || s.x1 < 0) errors.x1 = "x1 must be ≥ 0";
      if (!isFinite(s.x2) || s.x2 < 0) errors.x2 = "x2 must be ≥ 0";
      if (!isFinite(s.t1) || s.t1 <= 0) errors.t1 = "t1 must be > 0";
      if (!isFinite(s.t2) || s.t2 <= 0) errors.t2 = "t2 must be > 0";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (s.x1 === 0 || s.x2 === 0)
        w.push(`⚠️ ${label}: zero events (continuity correction of 0.5 applied to both arms)`);
      return w;
    },

    exampleData: [
      ["Study 1", 12, 1200, 20, 1000, ""],
      ["Study 2", 25, 2500, 35, 2000, ""],
      ["Study 3",  8,  800, 15,  900, ""],
      ["Study 4", 18, 1800, 28, 1500, ""],
      ["Study 5", 30, 3000, 42, 2800, ""],
    ],
  },

  // ------------------------------------------------------------------ //
  "IR": {
    label:  "Incidence Rate (log)",
    isTransformedScale: true,
    inputs: ["x", "t"],
    compute(s) {
      let { x, t } = s;
      if (!isFinite(x) || x < 0 || !isFinite(t) || t <= 0)
        return { ...s, yi: NaN, vi: NaN, se: NaN, w: 0 };
      if (x === 0) x = 0.5;
      const yi = Math.log(x / t);
      const vi = Math.max(1 / x, MIN_VAR);
      return { ...s, yi, vi, se: Math.sqrt(vi), w: 1 / vi };
    },
    transform:   (x) => Math.exp(x),

    validate(s) {
      const errors = {};
      if (!isFinite(s.x) || s.x < 0) errors.x = "x must be ≥ 0";
      if (!isFinite(s.t) || s.t <= 0) errors.t = "t must be > 0";
      return { valid: Object.keys(errors).length === 0, errors };
    },

    softWarnings(s, label) {
      const w = [];
      if (s.x === 0)
        w.push(`⚠️ ${label}: zero events (continuity correction: x set to 0.5)`);
      return w;
    },

    exampleData: [
      ["Study 1", 15, 1000, ""],
      ["Study 2", 28, 2500, ""],
      ["Study 3",  9,  800, ""],
      ["Study 4", 22, 1500, ""],
      ["Study 5", 12,  900, ""],
    ],
  },

};

// Convenience accessor — returns null for unknown types rather than undefined.
export function getProfile(type) {
  return effectProfiles[type] ?? null;
}
