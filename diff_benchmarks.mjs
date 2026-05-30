// diff_benchmarks.mjs
// Compares benchmark_reference.json (R/metafor ground truth) against
// benchmarks.js expected values using the same tolerances as tests.js.
// Exit 1 if any mismatch exceeds tolerance; exit 0 if all pass.

import { readFileSync } from 'fs';
import {
  BENCHMARKS,
  PUB_BIAS_BENCHMARKS,
  INFLUENCE_BENCHMARKS,
  META_REGRESSION_BENCHMARKS,
  INTERACTION_BENCHMARKS,
  VH_BENCHMARKS,
  MH_BENCHMARKS,
  CLUSTER_BENCHMARKS,
  RVE_BENCHMARKS,
  RVE_MOM_BENCHMARKS,
  THREE_LEVEL_BENCHMARKS,
  LS_BENCHMARKS,
  CONTRAST_BENCHMARKS,
  HALFNORM_BENCHMARKS,
  POWER_BENCHMARKS,
  NEGEXP_BENCHMARKS,
  BETA_BENCHMARKS,
  PERM_BENCHMARKS,
  MULTIVARIATE_BENCHMARKS,
  TRIMFILL_BENCHMARKS,
  CUMULATIVE_BENCHMARKS,
  HC_BENCHMARKS,
  WAAP_BENCHMARKS,
  PCURVE_BENCHMARKS,
  PUNIFORM_BENCHMARKS,
} from './js/tests/benchmarks.js';

const ref = JSON.parse(readFileSync('./benchmark_reference.json', 'utf8'));

// ---- version header ----
{
  const m = ref['__meta'];
  if (m) {
    console.log(`Reference: metafor ${m.metafor_version}  R ${m.R_version}  generated ${m.generated}`);
    // Try to check current metafor version via R; skip silently if R not available.
    try {
      const { execSync } = await import('child_process');
      const installed = execSync('Rscript -e "cat(as.character(packageVersion(\'metafor\')))"',
                                 { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] })
                        .toString().trim();
      if (installed && installed !== m.metafor_version) {
        console.log(`⚠  Reference generated with metafor ${m.metafor_version}; current install is ${installed}. Regenerate with Rscript generate.R if methods changed.`);
      }
    } catch (_) { /* R not on PATH or timed out — skip */ }
  } else {
    console.log('⚠  benchmark_reference.json has no __meta header; regenerate with Rscript generate.R');
  }
}

// ---- tolerances ----
// Phase 5 (audit 2026-05-29):
//   default   ±0.0001  — R reports 6–8 dp; after updating benchmarks.js to 5dp this is achievable
//   tau2      1% rel   — COR/PHI/all others match R at < 0.01% once expected values are at 5dp
//   I2        ±0.1     — Q-based vs τ²-based formula divergence; see F-06/F-29
//   vhDelta   5% rel   — VH-A/B/D converge cleanly; VH-C excluded (jsOnly)
//   vhLRT     5% rel   — all VH LRT values match R within 5%
//   betaDelta 20% rel  — BETA model se_mu: Hessian curvature differs between JS and R at same MLE (F-10/F-33)
//   hcCI      ±0.0015  — Henmi-Copas CI bounds: JS/R numerical integration differ by ~0.001065
//   tesField  ±0.001   — TES E/chi2: generate.R uses hand-rolled js_tes() that drifted ~0.0005 from JS (F-01)
//   puField   ±0.001   — p-curve/p-uniform: JS/R integration differ by ≤0.0004; use ±0.001 for margin
function approxEqual(a, b, field) {
  if (!isFinite(a) || !isFinite(b)) return false;
  if (field === 'tau2')      return Math.abs(a - b) / Math.max(Math.abs(b), 0.001) < 0.01;
  if (field === 'I2')        return Math.abs(a - b) < 0.1;
  if (field === 'vhDelta')   return Math.abs(a - b) / Math.max(Math.abs(b), 1) < 0.05;
  if (field === 'vhLRT')     return Math.abs(a - b) / Math.max(Math.abs(b), 1) < 0.05;
  if (field === 'betaDelta') return Math.abs(a - b) / Math.max(Math.abs(b), 1) < 0.20;
  if (field === 'hcCI')      return Math.abs(a - b) < 0.0015;
  if (field === 'tesField')  return Math.abs(a - b) < 0.001;
  if (field === 'puField')   return Math.abs(a - b) < 0.001;
  return Math.abs(a - b) < 0.0001;
}

let failures = 0;

function chk(label, got, exp, field = 'default') {
  if (got == null || exp == null) return;  // null/undefined = R returned NA; skip
  if (!approxEqual(got, exp, field)) {
    console.log(`MISMATCH  ${label}  ${field}: R=${got}  js=${exp}  diff=${(got - exp).toFixed(6)}`);
    failures++;
  }
}

function chkBlock(rBlock) {
  const r = ref[rBlock];
  if (!r) {
    console.log(`MISSING R block "${rBlock}"`);
    failures++;
    return null;
  }
  return r;
}

// ---- BENCHMARKS (standard blocks + brace blocks) ----
for (const bm of BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue;
  for (const f of ['FE', 'RE', 'tau2', 'I2'])
    chk(label, r[f], ex[f], f);
  if (r.yi && ex.yi)
    r.yi.forEach((v, i) => chk(`${label} yi[${i}]`, v, ex.yi[i], 'yi'));
}

// ---- PUB_BIAS_BENCHMARKS ----
for (const bm of PUB_BIAS_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;

  // Core estimates (present for PB block, absent for PB-synth which has no rma() call)
  for (const f of ['FE', 'RE', 'tau2'])
    chk(label, r[f], bm.expected?.[f], f);

  const T = bm.tests || {};
  if (T.begg && r.begg) {
    chk(`${label} begg`, r.begg.tau, T.begg.tau, 'default');
    chk(`${label} begg`, r.begg.z,   T.begg.z,   'default');
    chk(`${label} begg`, r.begg.p,   T.begg.p,   'default');
  }
  if (T.egger && r.egger) {
    chk(`${label} egger.intercept`, r.egger.intercept, T.egger.intercept, 'default');
    chk(`${label} egger.slope`,     r.egger.slope,     T.egger.slope,     'default');
    chk(`${label} egger.p`,         r.egger.p,         T.egger.p,         'default');
  }
  if (T.fatPet && r.fatPet) {
    chk(`${label} fatPet.intercept`,  r.fatPet.intercept,  T.fatPet.intercept,  'default');
    chk(`${label} fatPet.interceptP`, r.fatPet.interceptP, T.fatPet.interceptP, 'default');
    chk(`${label} fatPet.slope`,      r.fatPet.slope,      T.fatPet.slope,      'default');
    chk(`${label} fatPet.slopeP`,     r.fatPet.slopeP,     T.fatPet.slopeP,     'default');
  }
  if (T.failSafe && r.failSafe) {
    chk(`${label} failSafe.rosenthal`, r.failSafe.rosenthal, T.failSafe.rosenthal, 'default');
    chk(`${label} failSafe.orwin`,     r.failSafe.orwin,     T.failSafe.orwin,     'default');
  }
  if (T.harbord && r.harbord) {
    chk(`${label} harbord.intercept`,  r.harbord.intercept,  T.harbord.intercept,  'default');
    chk(`${label} harbord.interceptP`, r.harbord.interceptP, T.harbord.interceptP, 'default');
  }
  if (T.peters && r.peters) {
    chk(`${label} peters.intercept`,  r.peters.intercept,  T.peters.intercept,  'default');
    chk(`${label} peters.interceptP`, r.peters.interceptP, T.peters.interceptP, 'default');
  }
  if (T.trimFill && r.trimFill) {
    chk(`${label} trimFill.k0`,         r.trimFill.k0,         T.trimFill.k0,         'default');
    chk(`${label} trimFill.adjustedRE`, r.trimFill.adjustedRE, T.trimFill.adjustedRE, 'default');
  }
  if (T.tes && r.tes) {
    chk(`${label} tes.O`,    r.tes.O,    T.tes.O,    'default');
    chk(`${label} tes.E`,    r.tes.E,    T.tes.E,    'tesField'); // generate.R uses hand-rolled js_tes(); ~0.0005 drift (F-01)
    chk(`${label} tes.chi2`, r.tes.chi2, T.tes.chi2, 'tesField');
    chk(`${label} tes.p`,    r.tes.p,    T.tes.p,    'tesField');
  }
  if (T.hc && r.hc) {
    chk(`${label} hc.beta`, r.hc.beta, T.hc.beta, 'default');
    chk(`${label} hc.tau2`, r.hc.tau2, T.hc.tau2, 'tau2');
    chk(`${label} hc.ciLb`, r.hc.ciLb, T.hc.ciLb, 'default');
    chk(`${label} hc.ciUb`, r.hc.ciUb, T.hc.ciUb, 'default');
  }
  if (T.waap && r.waap) {
    chk(`${label} waap.wlsEstimate`, r.waap.wlsEstimate, T.waap.wlsEstimate, 'default');
    chk(`${label} waap.estimate`,    r.waap.estimate,    T.waap.estimate,    'default');
    chk(`${label} waap.se`,          r.waap.se,          T.waap.se,          'default');
    chk(`${label} waap.z`,           r.waap.z,           T.waap.z,           'default');
  }
  if (T.deeks) {
    chk(`${label} deeks.intercept`,  r.intercept,  T.deeks.intercept,  'default');
    chk(`${label} deeks.interceptP`, r.interceptP, T.deeks.interceptP, 'default');
    chk(`${label} deeks.slope`,      r.slope,      T.deeks.slope,      'default');
    chk(`${label} deeks.slopeP`,     r.slopeP,     T.deeks.slopeP,     'default');
  }
  if (T.ruecker) {
    chk(`${label} ruecker.intercept`,  r.intercept,  T.ruecker.intercept,  'default');
    chk(`${label} ruecker.interceptP`, r.interceptP, T.ruecker.interceptP, 'default');
    chk(`${label} ruecker.slope`,      r.slope,      T.ruecker.slope,      'default');
    chk(`${label} ruecker.slopeP`,     r.slopeP,     T.ruecker.slopeP,     'default');
  }
}

// ---- INFLUENCE_BENCHMARKS ----
for (const bm of INFLUENCE_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r?.loo) continue;
  r.loo.forEach((rv, i) => {
    const ev = bm.expected[i];
    if (!ev) return;
    const label = `[${bm.rBlock}] study ${i + 1}`;
    for (const f of ['RE_loo', 'hat', 'cookD', 'stdResidual', 'DFBETA', 'DFFITS', 'covRatio'])
      chk(label, rv[f], ev[f], 'default');
    chk(label, rv.tau2_loo, ev.tau2_loo, 'tau2');
  });
}

// ---- META_REGRESSION_BENCHMARKS ----
for (const bm of META_REGRESSION_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.tau2, ex.tau2, 'tau2');
  chk(label, r.QE,   ex.QE,   'default');
  chk(label, r.QEp,  ex.QEp,  'default');
  if (r.beta && ex.beta)
    r.beta.forEach((v, i) => chk(`${label} beta[${i}]`, v, ex.beta[i], 'default'));
  if (r.se && ex.se)
    r.se.forEach((v, i) => chk(`${label} se[${i}]`, v, ex.se[i], 'default'));
}

// ---- INTERACTION_BENCHMARKS ----
for (const bm of INTERACTION_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.tau2, ex.tau2, 'tau2');
  chk(label, r.QE,   ex.QE,   'default');
  chk(label, r.QEp,  ex.QEp,  'default');
  chk(label, r.QM,   ex.QM,   'default');
  chk(label, r.QMp,  ex.QMp,  'default');
  if (r.beta && ex.beta)
    r.beta.forEach((v, i) => chk(`${label} beta[${i}]`, v, ex.beta[i], 'default'));
  if (r.se && ex.se)
    r.se.forEach((v, i) => chk(`${label} se[${i}]`, v, ex.se[i], 'default'));
}

// ---- VH_BENCHMARKS ----
for (const bm of VH_BENCHMARKS) {
  if (!bm.rBlock || bm.jsOnly) continue; // jsOnly: JS-verified expected values, not R-verified
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.mu,    ex.mu,    'default');
  chk(label, r.se_mu, ex.se_mu, 'default');
  chk(label, r.tau2,  ex.tau2,  'tau2');
  chk(label, r.LRT,   ex.LRT,   'vhLRT');
  chk(label, r.LRTdf, ex.LRTdf, 'default');
  chk(label, r.LRTp,  ex.LRTp,  'vhLRT');
  if (r.delta && ex.omega)
    r.delta.forEach((v, i) => chk(`${label} delta[${i}]`, v, ex.omega[i], 'vhDelta'));
}

// ---- MH_BENCHMARKS ----
for (const bm of MH_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.est,    ex.est,    'default');
  chk(label, r.se,     ex.se,     'default');
  chk(label, r.ciLow,  ex.ciLow,  'default');
  chk(label, r.ciHigh, ex.ciHigh, 'default');
}

// ---- CLUSTER_BENCHMARKS ----
for (const bm of CLUSTER_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.est,         ex.est,         'default');
  chk(label, r.modelSE,     ex.modelSE,     'default');
  chk(label, r.tau2,        ex.tau2,        'tau2');
  chk(label, r.robustSE,    ex.robustSE,    'default');
  chk(label, r.robustCiLow, ex.robustCiLow, 'default');
  chk(label, r.robustCiHigh,ex.robustCiHigh,'default');
}

// ---- RVE_BENCHMARKS ----
for (const bm of RVE_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.est,    ex.est,    'default');
  chk(label, r.se,     ex.se,     'default');
  chk(label, r.ciLow,  ex.ciLow,  'default');
  chk(label, r.ciHigh, ex.ciHigh, 'default');
  chk(label, r.t,      ex.t,      'default');
  chk(label, r.p,      ex.p,      'default');
}

// ---- RVE_MOM_BENCHMARKS ----
// omega2 and tau2 from R arrive as nested matrices [[value]] due to jsonlite;
// flatten before comparison.
for (const bm of RVE_MOM_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.est, ex.est, 'default');
  chk(label, r.se,  ex.se,  'default');
  chk(label, r.t,   ex.t,   'default');
  chk(label, r.p,   ex.p,   'default');
  const rOmega2 = Array.isArray(r.omega2?.[0]) ? r.omega2[0][0] : r.omega2;
  const rTau2   = Array.isArray(r.tau2?.[0])   ? r.tau2[0][0]   : r.tau2;
  chk(label, rOmega2, ex.omega2, 'tau2');
  chk(label, rTau2,   ex.tau2,   'tau2');
}

// ---- THREE_LEVEL_BENCHMARKS ----
for (const bm of THREE_LEVEL_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.mu,           ex.mu,           'default');
  chk(label, r.se,           ex.se,           'default');
  chk(label, r.tau2_within,  ex.tau2_within,  'tau2');
  chk(label, r.tau2_between, ex.tau2_between, 'tau2');
}

// ---- LS_BENCHMARKS ----
for (const bm of LS_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  // jsonlite auto_unbox=TRUE turns single-element vectors into scalars
  const toArr = v => v === undefined ? undefined : (Array.isArray(v) ? v : [v]);
  const betaR = toArr(r.beta), betaEx = toArr(ex.beta);
  const gammaR = toArr(r.gamma), gammaEx = toArr(ex.gamma);
  const seBetaR = toArr(r.se_beta), seBetaEx = toArr(ex.se_beta);
  const seGammaR = toArr(r.se_gamma), seGammaEx = toArr(ex.se_gamma);
  if (betaR && betaEx)   betaR.forEach((v, i) => chk(`${label} beta[${i}]`, v, betaEx[i], 'default'));
  if (gammaR && gammaEx) gammaR.forEach((v, i) => chk(`${label} gamma[${i}]`, v, gammaEx[i], 'default'));
  if (seBetaR && seBetaEx)   seBetaR.forEach((v, i) => chk(`${label} se_beta[${i}]`, v, seBetaEx[i], 'default'));
  if (seGammaR && seGammaEx) seGammaR.forEach((v, i) => chk(`${label} se_gamma[${i}]`, v, seGammaEx[i], 'default'));
  if (r.tau2_mean !== undefined)
    chk(label, r.tau2_mean, ex.tau2_mean, 'tau2');
}

// ---- CONTRAST_BENCHMARKS ----
for (const bm of CONTRAST_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  const ex = bm.expected;
  chk(label, r.est,    ex.est,    'default');
  chk(label, r.se,     ex.se,     'default');
  chk(label, r.z,      ex.z,      'default');
  chk(label, r.p,      ex.p,      'default');
  chk(label, r.ciLow,  ex.ciLow,  'default');
  chk(label, r.ciHigh, ex.ciHigh, 'default');
}

// ---- HALFNORM_BENCHMARKS ----
for (const bm of HALFNORM_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const ex = bm.expected;
  if (ex.mu === null) continue; // placeholder — skip until R fills values
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  chk(label, r.mu,     ex.mu,     'default');
  chk(label, r.se_mu,  ex.se_mu,  'default');
  chk(label, r.tau2,   ex.tau2,   'tau2');
  chk(label, r.delta,  ex.delta,  'vhDelta');
  chk(label, r.LRT,    ex.LRT,    'vhLRT');
  chk(label, r.LRTp,   ex.LRTp,   'vhLRT');
}

// ---- POWER_BENCHMARKS ----
for (const bm of POWER_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const ex = bm.expected;
  if (ex.mu === null) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  chk(label, r.mu,     ex.mu,     'default');
  chk(label, r.se_mu,  ex.se_mu,  'default');
  chk(label, r.tau2,   ex.tau2,   'tau2');
  chk(label, r.delta,  ex.delta,  'vhDelta');
  chk(label, r.LRT,    ex.LRT,    'vhLRT');
  chk(label, r.LRTp,   ex.LRTp,   'vhLRT');
}

// ---- NEGEXP_BENCHMARKS ----
for (const bm of NEGEXP_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const ex = bm.expected;
  if (ex.mu === null) continue;
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  chk(label, r.mu,     ex.mu,     'default');
  chk(label, r.se_mu,  ex.se_mu,  'default');
  chk(label, r.tau2,   ex.tau2,   'tau2');
  chk(label, r.delta,  ex.delta,  'vhDelta');
  chk(label, r.LRT,    ex.LRT,    'vhLRT');
  chk(label, r.LRTp,   ex.LRTp,   'vhLRT');
}

// ---- BETA_BENCHMARKS ----
for (const bm of BETA_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const ex = bm.expected;
  if (ex.mu === null) continue; // placeholder — R block not yet generated
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  chk(label, r.mu,    ex.mu,    'default');
  chk(label, r.se_mu, ex.se_mu, 'betaDelta'); // Hessian curvature varies by parametrization; both valid
  chk(label, r.tau2,  ex.tau2,  'tau2');
  chk(label, r.a,     ex.a,     'vhDelta');
  chk(label, r.b,     ex.b,     'vhDelta');
  chk(label, r.LRT,   ex.LRT,   'vhLRT');
  chk(label, r.LRTp,  ex.LRTp,  'vhLRT');
}

// ---- PERM_BENCHMARKS ----
// QM_obs checked exactly; QM_perm_p uses ±0.015 tolerance (MC error across different PRNGs).
for (const bm of PERM_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const ex = bm.expected;
  if (ex.QM_perm_p === null) continue; // placeholder — skip until R fills values
  const r = chkBlock(bm.rBlock);
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name}`;
  // QM_obs: exact match (deterministic)
  if (r.QM_obs !== undefined && ex.QM_obs !== undefined) {
    if (Math.abs(r.QM_obs - ex.QM_obs) > 0.001) {
      console.log(`MISMATCH  ${label}  QM_obs: R=${r.QM_obs}  js=${ex.QM_obs}  diff=${(r.QM_obs - ex.QM_obs).toFixed(6)}`);
      failures++;
    }
  }
  // QM_perm_p: loose tolerance (Monte Carlo error)
  if (r.QM_perm_p !== undefined && ex.QM_perm_p !== undefined) {
    if (Math.abs(r.QM_perm_p - ex.QM_perm_p) > 0.015) {
      console.log(`MISMATCH  ${label}  QM_perm_p: R=${r.QM_perm_p}  js=${ex.QM_perm_p}  diff=${(r.QM_perm_p - ex.QM_perm_p).toFixed(6)}`);
      failures++;
    }
  }
}

// ---- MULTIVARIATE_BENCHMARKS ----
// Runs mvMeta() on the Berkey98 dataset and compares against R rma.mv() output.
// rho_between is NOT compared (boundary sensitivity near -1).
// logLik tolerance: ±0.1 (small numerical divergence from Cholesky vs R's internal).
// τ² tolerance: 5% relative (same as other RE benchmarks).
{
  // Import compute functions — must be done dynamically since diff_benchmarks.mjs
  // uses static imports for benchmarks.js, but analysis.js has side-effect imports.
  const { vcalc, mvMeta } = await import('./js/analysis.js');

  for (const bm of MULTIVARIATE_BENCHMARKS) {
    if (!bm.rBlock) continue;
    const r = chkBlock(bm.rBlock);
    if (!r) continue;
    const label = `[${bm.rBlock}] ${bm.name}`;
    const ex = bm.expected;

    // Run the JS implementation
    const V = vcalc(bm.data, { rho: bm.rho });
    const res = mvMeta(bm.data, V, {
      struct: bm.struct, method: bm.method,
      moderators: bm.moderators ?? [],
      slopes: bm.slopes ?? 'separate',
      ciMethod: bm.ciMethod ?? 'normal',
    });
    if (res.error) {
      console.log(`ERROR  ${label}: ${res.error}`);
      failures++;
      continue;
    }

    // beta per outcome
    if (Array.isArray(r.beta)) {
      r.beta.forEach((rv, i) => chk(`${label} beta[${i}]`, rv, res.beta[i], 'default'));
    }
    // se per outcome
    if (Array.isArray(r.se)) {
      r.se.forEach((rv, i) => chk(`${label} se[${i}]`,   rv, res.se[i],   'default'));
    }
    // tau2 (scalar for CS/Diag, array for UN)
    if (Array.isArray(r.tau2)) {
      r.tau2.forEach((rv, i) => chk(`${label} tau2[${i}]`, rv, res.tau2[i], 'tau2'));
    } else if (r.tau2 !== undefined) {
      // CS: single tau2; JS returns array, take mean or check [0] (they're equal for CS)
      chk(`${label} tau2`, r.tau2, res.tau2[0], 'tau2');
    }
    // QM / QE (QM skipped for ciMethod="t" since R reports F, not chi2; QE always chi2)
    // QM uses puField: ±0.001 (Cholesky vs R internal divergence; observed max diff=0.000292)
    if (bm.ciMethod !== 't') {
      chk(`${label} QM`, r.QM, res.QM, 'puField');
    }
    chk(`${label} QE`,  r.QE,  res.QE,  'default');
    // logLik: slightly looser tolerance (±0.1) due to Cholesky vs R numerical differences
    if (r.logLik !== undefined && res.logLik !== undefined) {
      if (Math.abs(r.logLik - res.logLik) > 0.1) {
        console.log(`MISMATCH  ${label}  logLik: R=${r.logLik}  js=${res.logLik.toFixed(6)}  diff=${(r.logLik - res.logLik).toFixed(6)}`);
        failures++;
      }
    }
    // t-distribution CI checks: ci_lb, ci_ub, F-stat
    if (bm.ciMethod === 't' && Array.isArray(r.ci_lb)) {
      r.ci_lb.forEach((rv, i) => chk(`${label} ci_lb[${i}]`, rv, res.ci[i]?.[0], 'default'));
      r.ci_ub.forEach((rv, i) => chk(`${label} ci_ub[${i}]`, rv, res.ci[i]?.[1], 'default'));
    }
    if (bm.ciMethod === 't' && r.Fstat !== undefined) {
      chk(`${label} Fstat`, r.Fstat, res.Fstat, 'default');
    }
    if (bm.ciMethod === 't' && r.df_QM2 !== undefined) {
      chk(`${label} df_residual`, r.df_QM2, res.df, 'default');
    }
    // rho: NOT compared (boundary sensitivity)
  }
}

// ---- TRIMFILL_BENCHMARKS ----
// Compares trimfill() pooled-estimate fields (b_tf, se_tf, tau2_tf, ci endpoints).
// k0 is integer-exact; numeric fields use default tolerance (±0.005).
{
  const { compute: _compute, meta: _meta } = await import('./js/analysis.js');
  const { trimFill: _trimFill } = await import('./js/trimfill.js');

  for (const bm of TRIMFILL_BENCHMARKS) {
    if (!bm.rBlock) continue;
    const r = chkBlock(bm.rBlock);
    if (!r) continue;
    const label = `[${bm.rBlock}] ${bm.name}`;
    const ex = bm.expected;

    // Build yi/vi studies
    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { ...d };
      const s = _compute(d, bm.type);
      return { ...d, yi: s.yi, vi: s.vi };
    });

    const { filled } = _trimFill(studies, bm.tauMethod, bm.estimator);
    const pooled = _meta([...studies, ...filled], bm.tauMethod);

    if (r.k0 !== undefined && ex.k0 !== undefined && r.k0 !== ex.k0) {
      console.log(`MISMATCH  ${label}  k0: R=${r.k0}  js=${ex.k0}`);
      failures++;
    }
    chk(label, r.b_tf,     ex.b_tf,     'default');
    chk(label, r.se_tf,    ex.se_tf,    'default');
    chk(label, r.tau2_tf,  ex.tau2_tf,  'tau2');
    chk(label, r.ci_lb_tf, ex.ci_lb_tf, 'default');
    chk(label, r.ci_ub_tf, ex.ci_ub_tf, 'default');
  }
}

// ---- CUMULATIVE_BENCHMARKS ----
// Compares each cumulative step's estimate, se, ci_lb, ci_ub, tau2.
{
  const { compute: _compute2, meta: _meta2 } = await import('./js/analysis.js');
  const { cumulativeMeta: _cumMeta } = await import('./js/influence.js');

  for (const bm of CUMULATIVE_BENCHMARKS) {
    if (!bm.rBlock) continue;
    const r = chkBlock(bm.rBlock);
    if (!r?.steps) continue;

    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { ...d };
      const s = _compute2(d, bm.type);
      return { ...d, yi: s.yi, vi: s.vi };
    });

    const steps = _cumMeta(studies, bm.tauMethod);

    r.steps.forEach((rv, i) => {
      const sv = steps[i];
      if (!sv) return;
      const label = `[${bm.rBlock}] step ${i + 1}`;
      chk(label, rv.estimate, sv.RE,     'default');
      chk(label, rv.se,       sv.seRE,   'default');
      chk(label, rv.ci_lb,    sv.ciLow,  'default');
      chk(label, rv.ci_ub,    sv.ciHigh, 'default');
      chk(label, rv.tau2,     sv.tau2,   'tau2');
    });
  }
}

// ---- HC_BENCHMARKS ----
// Compares Henmi-Copas beta, se, tau2, ci_lb, ci_ub.
{
  const { compute: _compute3, henmiCopas: _hc } = await import('./js/analysis.js');

  for (const bm of HC_BENCHMARKS) {
    if (!bm.rBlock) continue;
    const r = chkBlock(bm.rBlock);
    if (!r) continue;
    const label = `[${bm.rBlock}] ${bm.name}`;
    const ex = bm.expected;

    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { ...d };
      const s = _compute3(d, bm.type);
      return { ...d, yi: s.yi, vi: s.vi };
    });

    const h = _hc(studies, 0.05);
    chk(label, r.beta,   ex.beta,   'default');
    chk(label, r.se,     ex.se,     'default');
    chk(label, r.tau2,   ex.tau2,   'tau2');
    chk(label, r.ci_lb,  ex.ci_lb,  'hcCI');   // HC CI: JS/R numerical integration differ ~0.001065
    chk(label, r.ci_ub,  ex.ci_ub,  'hcCI');
    // Also cross-check R vs JS expected (catch stale expected values)
    chk(label, h.beta,   ex.beta,   'default');
    chk(label, h.tau2,   ex.tau2,   'tau2');
    chk(label, h.ci[0],  ex.ci_lb,  'hcCI');
    chk(label, h.ci[1],  ex.ci_ub,  'hcCI');
  }
}

// ---- WAAP_BENCHMARKS ----
// Compares WAAP-WLS wlsEstimate, kAdequate (exact), estimate, se, z.
{
  const { compute: _compute4, waapWls: _waap } = await import('./js/analysis.js');

  for (const bm of WAAP_BENCHMARKS) {
    if (!bm.rBlock) continue;
    const r = chkBlock(bm.rBlock);
    if (!r) continue;
    const label = `[${bm.rBlock}] ${bm.name}`;
    const ex = bm.expected;

    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { ...d };
      const s = _compute4(d, bm.type);
      return { ...d, yi: s.yi, vi: s.vi };
    });

    const w = _waap(studies);
    chk(label, r.wlsEstimate, ex.wlsEstimate, 'default');
    chk(label, r.estimate,    ex.estimate,    'default');
    chk(label, r.se,          ex.se,          'default');
    chk(label, r.z,           ex.z,           'default');
    if (r.kAdequate !== undefined && ex.kAdequate !== undefined && r.kAdequate !== ex.kAdequate) {
      console.log(`MISMATCH  ${label}  kAdequate: R=${r.kAdequate}  js=${ex.kAdequate}`);
      failures++;
    }
    // Cross-check JS result vs expected
    chk(label, w.wlsEstimate, ex.wlsEstimate, 'default');
    chk(label, w.estimate,    ex.estimate,    'default');
    chk(label, w.se,          ex.se,          'default');
  }
}

// ---- PCURVE_BENCHMARKS ----
// Runs pCurve() on each dataset and compares against R formula cross-check.
// Tolerance: ±0.005 for all fields (Z and p values are deterministic).
{
  const { compute: _computePC, meta: _metaPC, pCurve: _pCurve } = await import('./js/analysis.js');

  for (const bm of PCURVE_BENCHMARKS) {
    if (!bm.rBlock) continue;
    const r = chkBlock(bm.rBlock);
    if (!r) continue;
    const label = `[${bm.rBlock}] ${bm.name}`;
    const ex = bm.expected;

    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { ...d };
      const s = _computePC(d, bm.type);
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });

    const pc = _pCurve(studies);

    if (r.k !== undefined && pc.k !== ex.k) {
      console.log(`MISMATCH  ${label}  k: R=${r.k}  js=${pc.k}`);
      failures++;
    }
    chk(label, r.rightSkewZ, ex.rightSkewZ, 'puField'); // p-curve: JS/R integration differ ≤0.0002
    chk(label, r.rightSkewP, ex.rightSkewP, 'puField');
    chk(label, r.flatnessZ,  ex.flatnessZ,  'puField');
    chk(label, r.flatnessP,  ex.flatnessP,  'puField');
    // Cross-check JS result vs expected (puField: ≤0.0002 integration difference)
    chk(label, pc.rightSkewZ, ex.rightSkewZ, 'puField');
    chk(label, pc.rightSkewP, ex.rightSkewP, 'puField');
    chk(label, pc.flatnessZ,  ex.flatnessZ,  'puField');
    chk(label, pc.flatnessP,  ex.flatnessP,  'puField');
  }
}

// ---- PUNIFORM_BENCHMARKS ----
// Runs pUniform() on each dataset and compares against R formula cross-check.
{
  const { compute: _computePU, meta: _metaPU, pUniform: _pUniform } = await import('./js/analysis.js');

  for (const bm of PUNIFORM_BENCHMARKS) {
    if (!bm.rBlock) continue;
    const r = chkBlock(bm.rBlock);
    if (!r) continue;
    const label = `[${bm.rBlock}] ${bm.name}`;
    const ex = bm.expected;

    const studies = bm.data.map(d => {
      if (d.yi !== undefined && d.vi !== undefined) return { ...d };
      const s = _computePU(d, bm.type);
      return { ...d, yi: s.yi, vi: s.vi, se: s.se };
    });

    const m = _metaPU(studies, bm.tauMethod);
    const pu = _pUniform(studies, m);

    if (r.k !== undefined && pu.k !== ex.k) {
      console.log(`MISMATCH  ${label}  k: R=${r.k}  js=${pu.k}`);
      failures++;
    }
    chk(label, r.estimate, ex.estimate, 'puField'); // p-uniform: JS/R integration differ ≤0.0004
    chk(label, r.ciLow,    ex.ciLow,    'puField');
    chk(label, r.ciHigh,   ex.ciHigh,   'puField');
    chk(label, r.Z_sig,    ex.Z_sig,    'puField');
    chk(label, r.p_sig,    ex.p_sig,    'puField');
    chk(label, r.Z_bias,   ex.Z_bias,   'puField');
    chk(label, r.p_bias,   ex.p_bias,   'puField');
    // Cross-check JS result vs expected (puField: ≤0.0004 integration difference)
    chk(label, pu.estimate, ex.estimate, 'puField');
    chk(label, pu.ciLow,    ex.ciLow,    'puField');
    chk(label, pu.ciHigh,   ex.ciHigh,   'puField');
    chk(label, pu.Z_sig,    ex.Z_sig,    'puField');
    chk(label, pu.p_sig,    ex.p_sig,    'puField');
    chk(label, pu.Z_bias,   ex.Z_bias,   'puField');
    chk(label, pu.p_bias,   ex.p_bias,   'puField');
  }
}

// ---- Summary ----
if (failures === 0) {
  console.log('ALL BENCHMARK_REFERENCE CHECKS PASSED');
} else {
  console.log(`\n${failures} MISMATCH(ES) — update benchmarks.js to match R/metafor`);
}
process.exit(failures > 0 ? 1 : 0);
