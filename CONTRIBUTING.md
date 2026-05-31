# Contributing to FOSMA

Bug reports, cross-validation discrepancies, and pull requests are welcome.

---

## Dev setup

The app has no build step. Clone the repo and start a local server:

```bash
git clone https://github.com/rbmichael/meta-analysis.git
cd meta-analysis
python -m http.server 8080
# open http://localhost:8080
```

Node.js alternative: `npx serve .`

> Browsers block ES module imports over `file://`, so opening `index.html` directly will not work — a local server is required.

---

## Running the tests

Install dev dependencies once (jsdom + d3, used by the plot smoke tests):

```bash
npm ci
```

Run the full test suite:

```bash
node scripts/run_tests.mjs
```

This runs in order: benchmark tests, unit tests, export-parity fixtures, and plot smoke tests. Must exit 0 before any commit that touches computation files.

Run the benchmark diff against R ground truth:

```bash
node scripts/diff_benchmarks.mjs
```

Exit 0 means all `benchmark_reference.json` blocks match `js/tests/benchmarks.js` within documented tolerances. MISMATCH lines are explained in `docs/benchmark-data.md`.

---

## Regenerating benchmark_reference.json

R and the `metafor` + `jsonlite` packages are required:

```bash
Rscript scripts/generate.R
```

Regenerate whenever you change a computation file (`js/core/profiles.js`, `js/stats/tau2.js`, `js/stats/analysis.js`, `js/core/linalg.js`, `js/stats/binary.js`, `js/stats/robust.js`, or related). Commit `benchmark_reference.json` and `js/tests/benchmarks.js` together.

---

## Cross-validation scripts

`comparisons/scripts/` contains six R scripts covering all major analysis paths. Run them to spot-check a new effect type, CI method, or analysis path against metafor:

```bash
Rscript comparisons/scripts/compare.R
Rscript comparisons/scripts/compare_regression.R
# etc.
```

See `comparisons/scripts/README.md` for the full coverage table.

---

## Adding a new effect type

1. Add an entry to `js/core/profiles.js` (`compute`, `validate`, `transform`, `inputs`, `exampleData`).
2. Add a named block to `scripts/generate.R` and regenerate `benchmark_reference.json`.
3. Add a corresponding entry to `js/tests/benchmarks.js` with an `rBlock` field matching the R block ID.
4. Run `node scripts/diff_benchmarks.mjs` — review any MISMATCH lines.
5. Run `node scripts/run_tests.mjs` — must exit 0.
6. Update `js/ui/guide.js`, `index.html#aboutSection`, and `README.md` per the conventions in `CLAUDE.md`.

---

## Reporting a computational discrepancy

If a result from FOSMA differs from metafor or another reference implementation, please open an issue with:

- Effect type and τ² estimator used.
- The dataset (or a minimal reproducible example).
- The FOSMA output and the reference output side by side.
- The R code that produces the reference value (ideally a `metafor::rma(...)` call).

Known divergences are documented in `docs/benchmark-data.md`. Check there first — some differences are intentional formula choices, not bugs.

---

## Code style

- No build step, no transpilation — plain ES2020 modules.
- No comments explaining *what* the code does; only add one when the *why* is non-obvious.
- No new dependencies in `index.html` without discussion; the no-CDN offline build must remain viable.
