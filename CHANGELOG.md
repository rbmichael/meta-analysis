# Changelog

All notable changes to FOSMA are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.0] — 2026-05-31

First citable release. Milestones A (numerical hardening) and B (cross-validation coverage)
complete; CI badge live; Zenodo DOI minted.

### Added
- **Zenodo DOI** (`10.5281/zenodo.20470390`) and DOI badge in README.
- **`CITATION.cff`** — machine-readable citation metadata (author, ORCID, DOI, version).
- **`.zenodo.json`** — Zenodo deposit metadata (title, license, creator, ORCID).
- **`package.json` version field** set to `1.0.0`.
- **CI workflow** (`.github/workflows/test.yml`): runs `npm ci`, `node scripts/run_tests.mjs`,
  `node scripts/diff_benchmarks.mjs` on Node 20.x + 22.x matrix.
- **Plot smoke tests** (`js/tests/harness/run-plot-tests.mjs`): 30 headless jsdom + D3
  assertions covering all 24 exported plot functions.
- **Export-parity tests** (`js/tests/tests.js` EXPORT PARITY block): fixture-driven checks
  that every displayed value appears in both HTML and DOCX exports. Sections covered: summary,
  pubBias, regression, influence, selModel, rve, threeLevel, bayes, MV (pooled/heterogeneity/tests).
- **R cross-validation blocks** for: Henmi–Copas, WAAP-WLS, TES, trim-and-fill (L₀/R₀/Q₀ ×
  3 datasets), influence diagnostics (Cook's D, DFFITS, DFBETAS, covRatio, hatᵢ), selection-model
  edge cases, p-curve, p-uniform, multivariate UN structure.
- **Bayesian τ-grid auto-extension**: grid extends when REML τ̂ approaches boundary; post-hoc
  doubling up to 3× with `grid_truncated` flag.
- **Locale-aware CSV parsing**: auto-detects EU semicolon+comma format; warns on low-confidence
  detection; re-parse toggle in import dialog.
- **`MIN_VAR` audit trail**: soft warning emitted per study when vi is clamped to 1e-8.
- **Boundary τ²=0 disambiguation**: `tau2Boundary` flag propagated to heterogeneity panel
  ("0 (boundary)" display).
- **Singular-matrix guarding**: `matInverse` null-checks in subgroup-contrast, location-scale
  Hessian, three-level Qr, sandwich variance; flagged result instead of silent NaN.
- **CDF overflow guards**: `tCDF`/`fCDF` clamped against under/overflow at extreme df; floor
  at 1e-300.
- **Convergence badges**: `converged` flag surfaced in UI, HTML report, and DOCX for all
  iterative methods (selection models, mvMeta, three-level, location-scale, τ² estimators).
- **Multivariate t-CI method** for MV mode.
- **Unified validation panel** (`ui-warnings.js`): shared warning infrastructure for Standard
  and Multivariate modes.
- **`failSafeN` `trivial` and `direction` parameters**.
- **`mvMeta` `slopes: "common"` mode**.
- **`meta3level` ML estimation**.
- **`rvePooled` `omega2: "MoM"` mode** (robumeta HIER two-step).
- **Selection-model log-likelihood normalisation** (fixes scale inconsistency vs. metafor).
- **TF-Q0-SYNTH graceful failure**: Q₀ trim-and-fill returns `reason:'q0_disc_negative'` and
  k₀=0 when discriminant is negative (R errors; JS breaks cleanly).

### Changed
- Benchmark tolerances tightened (Phase 5 audit 2026-05-29).
- File and folder reorganisation (scripts, tests, docs moved to canonical locations).

---

## [Unreleased]

_Next items: CITATION.cff ORCID verify, CONTRIBUTING.md, README Reproducibility section,
About section author block, issue templates, tutorial._
