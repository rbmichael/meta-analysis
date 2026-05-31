# Tutorial: Running and verifying a meta-analysis in FOSMA

This walkthrough takes approximately 10 minutes. It uses the 12-study binary dataset bundled in
`comparisons/data/binary_data.csv` and ends with a concrete check: the values FOSMA displays
should match the metafor output in `comparisons/results/results_OR_REML_normal.txt`.

---

## 1. Open the app

Visit **https://rbmichael.github.io/meta-analysis/** or run a local server:

```bash
python -m http.server 8080
# open http://localhost:8080
```

---

## 2. Set the effect type

In the **Settings** bar at the top of the Input tab, open the **Effect type** dropdown and
select **OR — Odds Ratio**. The input table columns update to `label, a, b, c, d` (2×2 cell
counts: events and non-events in the treatment and control groups).

Leave **τ² estimator** as **REML** and **CI method** as **Normal (z)**.

---

## 3. Enter the data

Enter the 12 studies below, one row per study. The `label` column is optional but helps when
reading the forest plot.

| Label    |  a |   b |  c |   d |
|----------|----|-----|----|-----|
| Study 01 | 25 |  75 | 10 |  90 |
| Study 02 | 14 |  36 |  8 |  42 |
| Study 03 | 18 |  82 | 22 |  78 |
| Study 04 | 10 |  40 |  6 |  44 |
| Study 05 | 35 |  45 | 25 |  55 |
| Study 06 |  8 |  72 |  5 |  75 |
| Study 07 | 20 |  30 | 12 |  38 |
| Study 08 | 45 | 155 | 30 | 170 |
| Study 09 |  7 |  63 |  4 |  66 |
| Study 10 | 22 |  58 | 15 |  65 |
| Study 11 | 30 |  70 | 35 |  65 |
| Study 12 | 50 | 150 | 40 | 160 |

**Shortcut:** copy the CSV file directly via **Import CSV** → choose
`comparisons/data/binary_data.csv`. FOSMA auto-detects the OR column layout.

---

## 4. Run the analysis

Click **Run analysis** (or press **Ctrl+Enter**). The Results tab opens with the Summary panel
expanded and the forest plot rendered below it.

---

## 5. Check the results

The values you see should match `comparisons/results/results_OR_REML_normal.txt`.

> **Note:** the reference file stores statistics on the **log scale** (log-OR). FOSMA displays
> back-transformed odds ratios. To compare, exponentiate the reference values: `exp(log-OR)`.

### Pooled estimate

| Statistic | Reference file (log scale) | App display (OR scale) |
|---|---|---|
| Pooled RE estimate | 0.3954 | **1.485** |
| 95% CI lower | 0.1571 | **1.170** |
| 95% CI upper | 0.6336 | **1.884** |
| z-value | 3.2528 | 3.253 |
| p-value | 0.0011 | .001 |

### Heterogeneity

| Statistic | Expected value |
|---|---|
| Q (df = 11) | 12.489 |
| p for Q | .328 |
| τ² | 0.0350 |
| τ | 0.187 |
| I² | 11.9% |

### Prediction interval (OR scale)

The 95% prediction interval on the log scale is [−0.042, 0.833], which back-transforms to
approximately **[0.959, 2.299]**.

Displayed values rounded to 3 decimal places may differ from the reference file (4 d.p.) by
±0.001 — this is display rounding only and not a computation error.

---

## 6. Cross-check with R (optional)

If you have R and metafor installed, run the reference script to reproduce the ground-truth
values yourself:

```bash
Rscript comparisons/scripts/compare.R --effect OR --method REML --ci normal
```

Output is written to `comparisons/results/results_OR_REML_normal.txt` and printed to the
console. The `=== KNOWN DIVERGENCES ===` section at the end of that file lists all expected
differences between FOSMA and metafor — there are none for this dataset and configuration.

---

## 7. Explore further

From here you can:

- **Publication bias** — scroll to the *Publication bias* section to see Egger's test, the
  funnel plot, and trim-and-fill results.
- **Influence diagnostics** — the *Sensitivity / influence* section shows leave-one-out
  estimates, Cook's distance, and the influence plot.
- **Export** — click *Download HTML report* or *Download Word (.docx)* to get a
  journal-ready document with all tables and plots embedded.
- **Session save** — click *Save session* to export the full application state as a JSON
  file that can be reloaded later.

---

## Further reading

- `comparisons/scripts/README.md` — full coverage table for all six cross-validation scripts.
- `docs/benchmark-data.md` — documented divergences between FOSMA and metafor, with bounded
  tolerances and rationale for each.
- `README.md` — full feature list, statistical references, and citation instructions.
