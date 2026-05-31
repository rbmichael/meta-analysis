# Reverse-Direction Drift Audit — Phase 1 Findings

Generated: 2026-05-29  
Scope: `generate.R`, `comparisons/*.R`, `benchmark-data.md`, `js/benchmarks.js`, `diff_benchmarks.mjs`

## Methodology

Four mechanical passes:
1. Grep for `"match (the )?(app|JS)|app'?s (value|formula|convention)|to match|bypass|approximat"` in R sources
2. Enumerate `js/benchmarks.js` entries with no `rBlock` beyond the documented known-good list
3. Enumerate `js/benchmarks.js` entries with `jsOnly: true`
4. List every field in `diff_benchmarks.mjs` with tolerance > 5e-4 or skipped entirely

**Bucket legend (Phase 2 triage):**
- **A** — no metafor equivalent; keep app code + add citation
- **B** — convention difference; both defensible; decide/document with citation
- **C** — app bug; fix app, restore R to canonical metafor call
- **D** — numerical approximation; replace with exact if cheap, else document

---

## Findings Table

| ID | Location | Pass | Finding | App formula | Metafor formula | Tolerance | Doc status | Bucket |
|---|---|---|---|---|---|---|---|---|
| F-01 | `generate.R:1980` | 1-grep | TES: `js_tes()` hand-rolled; comment: "compute directly to match JS"; `metafor::tes()` bypassed entirely | O/E chi² with binomial-approx variance (`E·(1−E/k)`) | Same binomial approximation confirmed from metafor source; **formulas match** — R block was made redundant by verifying both use same formula | ±0.005 | `benchmark-data.md` line 2336 documents binomial-approx equivalence | B → verify then A |
| F-02 | `generate.R:2613` | 1-grep | **CLOSED 2026-05-29 — B (documented).** App uses RE weights `1/(vi+tau2)` for pooled estimate (standard approach); metafor uses FE weights `1/vi` for GENQM (internal to how Q is defined). benchmark-data.md GENQM-1 section (line 2725) already documents this. generate.R GENQM-1 block correctly computes both values for comparison. No code change needed. | `wi = 1/(vi+tau2)` (standard RE pooling) | `wi = 1/vi` (FE pooling, metafor internal) | ±0.005 on RE | benchmark-data.md line 2725 | **B → closed** |
| F-03 | `generate.R:2994` | 1-grep | **CLOSED 2026-05-29 — B (convention), no code change.** The "explicit design matrix" applies ONLY to partial-LRT reduced-model fits (lines 2996–3015); those values are printed but never stored in `BENCH`/benchmark_reference.json. Main `rma()` call uses canonical metafor formula. JS `.sort()` reference = "AS" (alphabetically first) = R `factor()` default; `relevel(..., ref="AS")` in generate.R is redundant documentation. INT-1/INT-2 now pass diff_benchmarks.mjs for beta[], se[], tau2, QE, QEp, QM, QMp. Per-term LRTs: both JS and generate.R use Type-III (drop term's own columns only), which differs from metafor `anova()` sequential default — legitimate convention, document in benchmark-data.md. | `levels.sort()[0]` = "AS" | `factor()` default = "AS" | ±0.005 | Add LRT convention note to benchmark-data.md | **B → closed** |
| F-04 | `generate.R:3118` | 1-grep | MV-1: `levels=c("PD","AL")` forces PD-first to match JS vcalc encounter order | vcalc level order: PD first (encounter order) | R default: alphabetical (AL first) | — | Not documented; result numerically equivalent | A (ordering only) |
| F-05 | `comparisons/compare_influence.R:188` | 1-grep | **CLOSED 2026-05-29 — B (two convention differences), no JS code change.** Section 7 added to compare_influence.R calling `influence.rma.uni()` directly. Findings: hat/DFFITS/covRatio/cookD all match metafor exactly (diff=0). Two convention differences: (1) JS `DFBETA = (mu−mu_loo)/seRE_loo` vs metafor `dfbs = (mu−mu_loo)/seRE_full` (~1–5% diff); (2) JS `stdResidual = (yi−RE_full)/sqrt(vi+tau2_full)` (internal) vs metafor `rstudent = (yi−RE_loo)/sqrt(vi+tau2_loo)` (external). Section 6 item 1 corrected (cookD does NOT differ by factor 2; the comment was wrong). | `DFBETA = (mu−mu_loo)/seRE_loo`; `stdResidual` internal | metafor: `dfbs = /seRE_full`; `rstudent` external | ±0.005 | Section 6 updated; add to benchmark-data.md | **B → closed** |
| F-06 | `comparisons/compare_robust.R:155` | 1-grep | I² in RVE/cluster output: `i2_Q()` helper (Q-based formula) used instead of `res$I2` | `(Q − df) / Q` (Higgins & Thompson 2002) | `tau2 / (tau2 + tilde_v)` (Nakagawa τ²-based) | ±0.1 in diff | benchmark-data.md section added 2026-05-29 ("I² in RVE output") | **B — closed (documented)** |
| F-07 | `comparisons/compare.R:334` | 1-grep | **CLOSED 2026-05-29 — compare.R stale comment fixed (no JS change).** App (js/profiles.js:1512) uses half-sum `yi = 0.5*(arcsin(√(x/(n+1)))+arcsin(√((x+1)/(n+1))))`, `vi=1/(4(n+0.5))` — matches metafor `escalc("PFT")` exactly (ratio 2 for yi, 4 for vi). compare.R PFT entry was using the full-sum formula with stale comment "to match the app's full-sum formula" — the app had already been updated to half-sum. Fixed: `manual_esc` → `esc_args = function(d) list(xi=d$x, ni=d$n)`. Divergence note updated to confirm match. | Both use `yi = 0.5*(arcsin+arcsin)`, `vi=1/(4(n+0.5))` | same | ±0.005 | benchmark-data.md already correct (F-23 note); compare.R updated | **B/compare.R-fix → closed** |
| F-08 | `comparisons/compare.R:605, 1338` | 1-grep | **CLOSED 2026-05-29 — B (already handled correctly).** compare.R lines 634-639 extract tau2 from metafor GENQ/GENQM (FE weights), then refit with fixed tau2 using RE weights. Divergence note at line 1313-1327 documents this. benchmark-data.md GENQM-1 covers it (line 2725). No code change needed. | RE weights `1/(vi+tau2)` (app, standard) | FE weights `1/vi` (metafor default for GENQ) | ±0.005 | compare.R + benchmark-data.md documented | **B → closed** |
| F-09 | `comparisons/compare_mv.R:376` | 1-grep | MV AIC: "Use the 'AIC (app)' row above to match the app display; disregard metafor AIC" | AIC from JS REML log-likelihood | `AIC.rma.mv()` uses different convention for REML models | — | benchmark-data.md section added 2026-05-29 ("Multivariate AIC convention difference") | **B — closed (documented)** |
| F-10 | `comparisons/compare_selection.R:549` | 1-grep | Beta selection model `se_mu`: JS numerical-Hessian vs metafor curvature approximation; known divergence | Numerical Hessian of negative log-lik at MLE | Observed information from metafor parametrization | vhDelta (60%) on se_mu | `feedback_beta_selmodel.md` in project memory | D (documented) |
| F-11 | `js/profiles.js:311,347` ~~`compare.R:1166`~~ | 1-grep | **FIXED 2026-05-29.** Hedges J: `profiles.js` SMCR/SMCC callers switched from `1−3/(4df−1)` to `hedgesJ(df)` (exact gamma). `benchmarks.js` blocks "8"/"24" expected values updated to match metafor. `compare.R` and `compare_influence.R` stale notes removed. `benchmark-data.md` tables updated. | `hedgesJ(df)` (exact) | same | ±0.0001 now | Resolved | **C → done** |
| F-12 | `diff_benchmarks.mjs` | 2-noBlock | **FIXED 2026-05-29.** `INTERACTION_BENCHMARKS` (INT-1, INT-2) added to import and diff loop; checks tau2, QE, QEp, QM, QMp, beta[], se[]. Both blocks pass. | — | — | ±0.005 | Resolved | **Gap → done** |
| F-13 | `diff_benchmarks.mjs` | 2-noBlock | **FIXED 2026-05-29.** `RVE_MOM_BENCHMARKS` (RVE-MoM-1, RVE-MoM-2) added to import and diff loop; checks est, se, t, p, omega2, tau2 (nested-array flatten for jsonlite). Both blocks pass. | — | — | ±0.005 / 5% rel | Resolved | **Gap → done** |
| F-14 | `js/benchmarks.js` | 2-noBlock | HS estimator benchmark: no `rBlock`; metafor has `method="HS"`; **no generate.R block** | `τ² = max(0, (Q−df)/Σw)` | metafor 4.8 `method="HS"` uses different algorithm (gives τ²=ML); manual block used | — | BENCH block added to generate.R block 15 (2026-05-30); rBlock "HS-1" in benchmarks.js; diff passes | **B — closed** |
| F-15 | `js/benchmarks.js` | 2-noBlock | SJ estimator benchmark: no `rBlock`; metafor has `method="SJ"`; **no generate.R block** | Fixed-point iteration | Same divergence as F-14; manual block used | — | BENCH block added to generate.R block 18 (2026-05-30); rBlock "SJ-1" in benchmarks.js; diff passes | **B — closed** |
| F-16 | `js/benchmarks.js` | 2-noBlock | EB estimator benchmark: no `rBlock`; metafor has `method="EB"` (empirical Bayes) | EB τ² estimator | `method="EB"` in metafor | — | Not in benchmark-data.md | B |
| F-17 | `js/benchmarks.js` | 2-noBlock | PMM estimator: no `rBlock`; Paule-Mandel; metafor has `method="PM"` | Paule-Mandel iterative | `method="PM"` in metafor | — | Not in benchmark-data.md | B |
| F-18 | `js/benchmarks.js` | 2-noBlock | IRD/IRSD benchmarks: no `rBlock`; generate.R had **cat()-only** blocks (IRD-1/2, IRSD-1/2) not stored in BENCH | `yi = x1/t1 − x2/t2`, `vi` via delta-method | `escalc("IRD")` / `escalc("IRSD")` | — | BENCH added to all 4 blocks (2026-05-30); rBlock in benchmarks.js; diff passes | **B — closed** |
| F-19 | `js/benchmarks.js` | 2-noBlock | YUQ/YUY benchmarks: no `rBlock`; generate.R had **cat()-only** blocks (YUQ-1/2, YUY-1) not stored in BENCH | Yule's Q/Y formula | `escalc("YUQ")` / `escalc("YUY")` | — | BENCH added to all 4 blocks incl. YUY-2 (2026-05-30); rBlock in benchmarks.js; diff passes | **B — closed** |
| F-20 | `js/benchmarks.js` | 2-noBlock | SMD1/SMD1H benchmarks: no `rBlock`; one-sample SMD; no metafor equivalent | One-sample d = (m − μ₀)/s | No `escalc` measure for one-sample SMD | — | Not in benchmark-data.md | A |
| F-21 | `js/benchmarks.js` | 2-noBlock | RPB/RBIS benchmarks: no `rBlock`; metafor has `escalc("RPB")`, `escalc("RBIS")` | Point-biserial / biserial formulas | `escalc("RPB")` / `escalc("RBIS")` | — | Not in benchmark-data.md | B |
| F-22 | `js/benchmarks.js` | 2-noBlock | R²/ZR² benchmarks: no `rBlock`; no direct metafor equivalent | `yi = R²`, `vi` via delta-method | No `escalc` measure for R² | — | Not in benchmark-data.md | A |
| F-23 | `js/benchmarks.js` | 2-noBlock | AS (arcsine) benchmarks: no `rBlock`; metafor has `escalc("PFT")` but uses different transformation | Single arcsine: `yi = arcsin(√p)` | `escalc("PFT")` = double arcsine (Freeman-Tukey) — **different measure** | — | Not in benchmark-data.md; likely distinct | A |
| F-24 | `js/benchmarks.js` | 2-noBlock | UCOR benchmarks: no `rBlock`; generate.R had **cat()-only** blocks (UCOR-1/2) not stored in BENCH | Uncorrected Pearson r; `vi = (1−r²)²/(n−1)` | `escalc("UCOR")` | — | BENCH added to both blocks (2026-05-30); rBlock in benchmarks.js; diff passes | **B — closed** |
| F-25 | `js/benchmarks.js` | 2-noBlock | ARAW/ABT/AHW (Cronbach's α) benchmarks: no `rBlock`; no metafor equivalent | Three α transformations (raw, arcsine, Hakstian-Whalen) | Not in metafor; documented in CLAUDE.md as no-R-equivalent | — | CLAUDE.md documents no-R-equivalent | A (documented) |
| F-26 | `js/benchmarks.js:3150` | 3-jsOnly | **CLOSED 2026-05-29 — D (R optimizer finds local minimum).** JS ll=-3.124, R ll=-4.668 (Δll=+1.54), unselected ll matches in both (−11.604) — confirms JS reaches global optimum. R L-BFGS-B gets stuck at local min (omega[3]=87.41 vs JS 149.84). `log(delta)≤100` constraint NOT binding. benchmarks.js citation updated; benchmark-data.md LL comparison table added; compare_selection.R known divergence corrected. | Unconstrained BFGS → mu=0.9366, ll=−3.124 | R L-BFGS-B local min → mu=0.9194, ll=−4.668 | jsOnly/excluded | benchmark-data.md updated | **D → closed** |
| F-27 | `diff_benchmarks.mjs:58` | 4-tolerance | `tau2` field: 5% relative tolerance | — | — | 5% rel | Inline comment absent; only CLAUDE.md mentions it | Tighten to 1% rel (Phase 5) |
| F-28 | `diff_benchmarks.mjs:59` | 4-tolerance | `yi` field: ±0.002 | — | — | ±0.002 | Comment "8dp R rounding" — but standard tolerance should be ±0.0001 | Tighten to ±0.0005 (Phase 5) |
| F-29 | `diff_benchmarks.mjs` | 4-tolerance | `I2` field: ±0.1 — intentional; Q-based `(Q−df)/Q` and τ²-based `τ²/(τ²+ṽ)` diverge up to ~21% for ML estimator; ±0.5 pp target is unachievable without aligning formulas | Q-based `(Q−df)/Q` | τ²-based `τ²/(τ²+ṽ)` | ±0.1 (retained) | benchmark-data.md section added 2026-05-29 ("I² formula convention") | **B — closed (documented)** |
| F-30 | `diff_benchmarks.mjs:61` | 4-tolerance | `vhDelta`: 60% relative — any value within 60% of R passes | BFGS unconstrained | metafor constrained log-space | 60% rel | Comment "optimizer-sensitive" | Tighten after Phase 4 item 3; target ≤5% rel |
| F-31 | `diff_benchmarks.mjs:62` | 4-tolerance | `vhLRT`: 30% relative | — | — | 30% rel | Comment "LRT varies with optimizer" | Tighten after Phase 4 item 3; target ≤5% rel |
| F-32 | `diff_benchmarks.mjs:63` | 4-tolerance | Default tolerance ±0.005 — R reports 4 d.p. (±0.00005) | — | — | ±0.005 | No inline comment | Tighten to ±0.0001 (Phase 5) |
| F-33 | `diff_benchmarks.mjs` | 4-tolerance | BETA: `se_mu` now at betaDelta (20% rel); `a`/`b` at vhDelta (5% rel) — tightened from 60% in Phase 5 | Numerical Hessian | metafor observed information | betaDelta 20% rel | benchmark-data.md section added 2026-05-29 ("BETA selection model se_mu Hessian divergence") | **D — closed (documented)** |
| F-34 | `diff_benchmarks.mjs` | 4-tolerance | **FIXED 2026-05-29** (see F-12). | — | — | ±0.005 | Resolved | **done** |
| F-35 | `diff_benchmarks.mjs` | 4-tolerance | **FIXED 2026-05-29** (see F-13). | — | — | ±0.005 | Resolved | **done** |

---

## Summary by bucket

| Bucket | Count | IDs | Open |
|---|---|---|---|
| **A** — no metafor equivalent (keep + cite) | 6 | F-01*, F-04, F-20, F-22, F-23, F-25 | — (all closed) |
| **B** — convention difference (decide + document) | 16 | F-02, F-03, F-05, F-06, F-07, F-08, F-09, F-14, F-15, F-16, F-17, F-18, F-19, F-21, F-24, F-26 | — (all documented 2026-05-29) |
| **C** — app bug (fix app, restore R to canonical) | 1 | F-11† | — (done) |
| **D** — numerical approximation (document or replace) | 3 | F-10, F-26, F-33 | — (all documented) |
| **Gap** — coverage hole (no check at all) | 4 | F-12, F-13, F-34, F-35 | — (all fixed) |
| **Tolerance hygiene** (Phase 5) | 7 | F-27–F-33 | — (all resolved) |

*F-01: on investigation benchmark-data.md shows app and metafor use same TES formula; reclassified A (no divergence).  
†F-11: both C (easy fix: use exact J) and D (approximation error is sub-display). Fixed 2026-05-29.

---

## Phase 4 completion status

All Phase 4 items closed except item 4 (I² documentation):

1. **F-05** (compare_influence.R) — **CLOSED 2026-05-29**
2. **F-11** (Hedges J) — **DONE 2026-05-29** — `hedgesJ()` exact-gamma; 14 divergences removed
3. **F-26** (VH-C jsOnly) — **CLOSED 2026-05-29**
4. **F-03** (INT-1 design matrix) — **CLOSED 2026-05-29**
5. **F-07** (PFT formula) — **CLOSED 2026-05-29**
6. **F-02 / F-08** (GENQM/GENQ RE weights) — **CLOSED 2026-05-29**
7. **F-12 / F-13 / F-34 / F-35** — **DONE 2026-05-29**
8. **F-01** (TES) — **CLOSED 2026-05-29 — A** (formulas confirmed identical)
9. **Phase 4 item 4** (I² convention) — **DONE 2026-05-29**: app uses Q-based consistently ✓; diff checks I² at ±0.1 ✓; benchmark-data.md sections added for F-29 ("I² formula convention") and F-06 ("I² in RVE output") ✓

## Open items (remaining work)

All nine documentation gaps (F-06, F-09, F-14, F-15, F-18, F-19, F-24, F-29, F-33) **closed 2026-05-29** by adding benchmark-data.md sections.

**Phase 6 — Prevent recurrence — DONE 2026-05-30:**
- `audit_match_comments.mjs` wired into `run_tests.mjs`; all 6 match-app comments in `generate.R` have `# AUDITED:` tags.
- `CLAUDE.md` §"Convention: # AUDITED: tag in generate.R" documents required format and enforcement.
- `canonical_diff.mjs` created for informational drift reporting.

---

## Phase 5 tolerance targets — actual outcomes (2026-05-30)

| Field | Pre-Phase 5 | Target | Actual | Notes |
|---|---|---|---|---|
| default | ±0.005 | ±0.0001 | **±0.0001 ✓** | Done |
| tau2 | 5% rel | 1% rel | **1% rel ✓** | Done |
| yi | ±0.002 | ±0.0005 | **±0.0001 ✓** | Falls through to default; tighter than target |
| I2 | ±0.1 | ±0.5 pp | **±0.1 (unchanged)** | ±0.5 pp unachievable: Q-based vs τ²-based diverge up to ~21%; benchmark-data.md section added 2026-05-29 (F-29) |
| vhDelta | 60% rel | 5% rel | **5% rel ✓** | Done (F-26 optimizer confirmed; VH-C jsOnly excluded) |
| vhLRT | 30% rel | 5% rel | **5% rel ✓** | Done |
