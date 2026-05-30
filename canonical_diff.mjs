// canonical_diff.mjs
// Informational drift reporter: compares benchmark_reference.json (pure metafor output)
// against js/benchmarks.js expected values with NO tolerances.
//
// Reports every numerical difference from canonical metafor, including intentional
// divergences (I² formula, TES power formula, etc.).  Always exits 0 — this is a
// reference tool, not a CI gate.  Run it periodically to keep the full drift picture
// visible without waiting for an audit.
//
// Usage:  node canonical_diff.mjs
//         node canonical_diff.mjs --fields FE,RE,tau2   (restrict output columns)
//         node canonical_diff.mjs --threshold 0.01      (hide diffs smaller than this)

import { readFileSync } from 'node:fs';
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
} from './js/benchmarks.js';

// ---- CLI args ----
const argv       = process.argv.slice(2);
const fieldIdx   = argv.indexOf('--fields');
const fieldFilter = fieldIdx >= 0 ? new Set(argv[fieldIdx + 1].split(',')) : null;
const thrIdx     = argv.indexOf('--threshold');
const threshold  = thrIdx >= 0 ? parseFloat(argv[thrIdx + 1]) : 0;

const ref = JSON.parse(readFileSync('./benchmark_reference.json', 'utf8'));

const meta = ref['__meta'];
console.log('canonical_diff.mjs — informational only; always exits 0');
console.log(`Reference: metafor ${meta?.metafor_version ?? '?'}  R ${meta?.R_version ?? '?'}  generated ${meta?.generated ?? '?'}`);
console.log(`Threshold: ${threshold}  Field filter: ${fieldFilter ? [...fieldFilter].join(',') : 'all'}\n`);

// ---- comparison machinery ----
const diffs = [];   // { label, field, rVal, jsVal, absDiff, relDiff }

function cmp(label, rVal, jsVal, field) {
  if (rVal == null || jsVal == null) return;
  if (!isFinite(rVal) || !isFinite(jsVal)) return;
  if (fieldFilter && !fieldFilter.has(field)) return;
  const abs = Math.abs(rVal - jsVal);
  if (abs <= threshold) return;
  const rel = abs / Math.max(Math.abs(jsVal), 1e-9);
  diffs.push({ label, field, rVal, jsVal, absDiff: abs, relDiff: rel });
}

// ---- standard BENCHMARKS ----
for (const bm of BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const ex = bm.expected;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue;
  const label = `[${bm.rBlock}] ${bm.type ?? bm.name ?? ''}`;
  for (const f of ['FE', 'RE', 'tau2', 'I2'])
    cmp(label, r[f], ex[f], f);
  if (r.yi && ex.yi)
    r.yi.forEach((v, i) => cmp(`${label} yi[${i}]`, v, ex.yi[i], 'yi'));
}

// ---- PUB_BIAS_BENCHMARKS ----
for (const bm of [...PUB_BIAS_BENCHMARKS, ...HC_BENCHMARKS, ...WAAP_BENCHMARKS]) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  for (const f of ['FE', 'RE', 'tau2'])
    cmp(label, r[f], bm.expected?.[f], f);
  const T = bm.tests || {};
  if (T.egger  && r.egger)  { cmp(`${label} egger.int`,  r.egger.intercept,  T.egger.intercept,  'egger.int');
                               cmp(`${label} egger.p`,    r.egger.p,          T.egger.p,          'egger.p'); }
  if (T.begg   && r.begg)   { cmp(`${label} begg.tau`,   r.begg.tau,         T.begg.tau,         'begg.tau');
                               cmp(`${label} begg.p`,     r.begg.p,           T.begg.p,           'begg.p'); }
  if (T.fatPet && r.fatPet) { cmp(`${label} fatPet.int`, r.fatPet.intercept, T.fatPet.intercept, 'fatPet'); }
  if (T.tes    && r.tes)    { cmp(`${label} tes.E`,      r.tes.E,            T.tes.E,            'tes.E');
                               cmp(`${label} tes.chi2`,   r.tes.chi2,         T.tes.chi2,         'tes.chi2'); }
  if (T.hc     && r.hc)     { cmp(`${label} hc.ciLb`,   r.hc.ciLb,          T.hc.ciLb,          'hc.ciLb');
                               cmp(`${label} hc.ciUb`,   r.hc.ciUb,          T.hc.ciUb,          'hc.ciUb'); }
  if (T.waap   && r.waap)   { cmp(`${label} waap.est`,  r.waap.estimate,     T.waap.estimate,    'waap'); }
  if (T.trimFill && r.trimFill) cmp(`${label} tf.adjRE`, r.trimFill.adjustedRE, T.trimFill.adjustedRE, 'trimFill');
}

// ---- INFLUENCE_BENCHMARKS ----
for (const bm of INFLUENCE_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  for (const f of ['RE', 'tau2']) cmp(label, r[f], bm.expected?.[f], f);
  if (r.loo && bm.expected?.loo)
    r.loo.forEach((lo, i) => cmp(`${label} loo[${i}].RE`, lo?.RE, bm.expected.loo[i]?.RE, 'loo'));
}

// ---- META_REGRESSION_BENCHMARKS + INTERACTION_BENCHMARKS ----
for (const bm of [...META_REGRESSION_BENCHMARKS, ...INTERACTION_BENCHMARKS, ...LS_BENCHMARKS,
                   ...CONTRAST_BENCHMARKS, ...PERM_BENCHMARKS]) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  for (const f of ['tau2', 'QM', 'QMp', 'QE', 'QEp'])
    cmp(label, r[f], bm.expected?.[f], f);
  if (r.beta != null && bm.expected?.beta != null) {
    const rb = Array.isArray(r.beta) ? r.beta : [r.beta];
    const eb = Array.isArray(bm.expected.beta) ? bm.expected.beta : [bm.expected.beta];
    rb.forEach((v, i) => cmp(`${label} beta[${i}]`, v, eb[i], 'beta'));
  }
  if (r.se != null && bm.expected?.se != null) {
    const rs = Array.isArray(r.se) ? r.se : [r.se];
    const es = Array.isArray(bm.expected.se) ? bm.expected.se : [bm.expected.se];
    rs.forEach((v, i) => cmp(`${label} se[${i}]`, v, es[i], 'se'));
  }
}

// ---- VH_BENCHMARKS + HALFNORM/POWER/NEGEXP/BETA ----
for (const bm of [...VH_BENCHMARKS, ...HALFNORM_BENCHMARKS, ...POWER_BENCHMARKS,
                   ...NEGEXP_BENCHMARKS, ...BETA_BENCHMARKS]) {
  if (!bm.rBlock || bm.jsOnly) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  cmp(label, r.mu,    bm.expected?.mu,    'mu');
  cmp(label, r.se,    bm.expected?.se,    'se');
  cmp(label, r.tau2,  bm.expected?.tau2,  'tau2');
  cmp(label, r.delta, bm.expected?.delta, 'delta');
  cmp(label, r.LRT,   bm.expected?.LRT,   'LRT');
}

// ---- MH/Peto + CLUSTER + RVE + RVE_MOM + THREE_LEVEL ----
for (const bm of [...MH_BENCHMARKS, ...CLUSTER_BENCHMARKS,
                   ...RVE_BENCHMARKS, ...RVE_MOM_BENCHMARKS, ...THREE_LEVEL_BENCHMARKS]) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  for (const f of ['FE', 'RE', 'tau2', 'est', 'se']) cmp(label, r[f], bm.expected?.[f], f);
}

// ---- MULTIVARIATE_BENCHMARKS ----
for (const bm of MULTIVARIATE_BENCHMARKS) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  for (const f of ['mu', 'QM']) cmp(label, r[f], bm.expected?.[f], f);
  if (r.tau2 != null && bm.expected?.tau2 != null) {
    const rt = Array.isArray(r.tau2) ? r.tau2 : [r.tau2];
    const et = Array.isArray(bm.expected.tau2) ? bm.expected.tau2 : [bm.expected.tau2];
    rt.forEach((v, i) => cmp(`${label} tau2[${i}]`, v, et[i], 'tau2'));
  }
}

// ---- TRIMFILL / CUMULATIVE ----
for (const bm of [...TRIMFILL_BENCHMARKS, ...CUMULATIVE_BENCHMARKS]) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  for (const f of ['FE', 'RE', 'tau2', 'k0', 'adjustedRE']) cmp(label, r[f], bm.expected?.[f], f);
}

// ---- PCURVE / PUNIFORM ----
for (const bm of [...PCURVE_BENCHMARKS, ...PUNIFORM_BENCHMARKS]) {
  if (!bm.rBlock) continue;
  const r = ref[bm.rBlock];
  if (!r) continue;
  const label = `[${bm.rBlock}] ${bm.name ?? ''}`;
  for (const f of ['estimate', 'ciLow', 'ciHigh', 'Z_sig', 'p_sig', 'Z_bias', 'p_bias',
                    'rightSkewZ', 'rightSkewP', 'flatnessZ', 'flatnessP'])
    cmp(label, r[f], bm.expected?.[f], f);
}

// ---- Report ----
if (diffs.length === 0) {
  console.log('No divergences from canonical metafor output above threshold.\n');
  process.exit(0);
}

// Group by field for summary
const byField = {};
for (const d of diffs) {
  (byField[d.field] ??= []).push(d);
}

console.log(`${'─'.repeat(100)}`);
console.log(`${'Label'.padEnd(60)} ${'Field'.padEnd(12)} ${'R value'.padEnd(14)} ${'JS expected'.padEnd(14)} ${'abs diff'.padEnd(12)} rel diff`);
console.log(`${'─'.repeat(100)}`);

for (const d of diffs) {
  const labelStr = d.label.length > 58 ? d.label.slice(0, 55) + '...' : d.label;
  console.log(
    `${labelStr.padEnd(60)} ${d.field.padEnd(12)} ${String(d.rVal.toFixed(6)).padEnd(14)} ${String(d.jsVal.toFixed(6)).padEnd(14)} ${d.absDiff.toFixed(6).padEnd(12)} ${(d.relDiff * 100).toFixed(2)}%`
  );
}

console.log(`${'─'.repeat(100)}`);
console.log(`\nTotal: ${diffs.length} divergence(s) across ${Object.keys(byField).length} field type(s)`);
console.log('\nBy field:');
for (const [f, ds] of Object.entries(byField).sort((a, b) => b[1].length - a[1].length)) {
  const maxAbs = Math.max(...ds.map(d => d.absDiff));
  console.log(`  ${f.padEnd(14)} ${ds.length} item(s)  max abs diff = ${maxAbs.toFixed(6)}`);
}
console.log('\n(All divergences above are informational. Run node diff_benchmarks.mjs for tolerance-gated CI check.)');
process.exit(0);
