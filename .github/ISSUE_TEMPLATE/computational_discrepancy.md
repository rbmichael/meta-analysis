---
name: Computational discrepancy
about: A numerical result from FOSMA differs from metafor, JASP, or another reference
labels: numerical
---

**Method and settings**
- Effect type:
- τ² estimator:
- CI method:
- Any other relevant options (subgroup, moderators, selection model, etc.):

**Dataset**
<!-- Paste a minimal CSV or the study values (yi, vi, or raw inputs) that reproduce the discrepancy -->

**FOSMA result**

| Statistic | FOSMA value |
|---|---|
| Pooled estimate |  |
| 95% CI |  |
| τ² |  |
| Other |  |

**Reference result**
<!-- Include the R/JASP/other code that produces it -->

```r
# example
library(metafor)
dat <- ...
rma(yi, vi, data=dat, method="REML")
```

| Statistic | Reference value | Source |
|---|---|---|
| Pooled estimate |  |  |
| 95% CI |  |  |
| τ² |  |  |

**Is this divergence documented?**
<!-- Check docs/benchmark-data.md first — some differences are intentional formula choices -->
- [ ] I checked `docs/benchmark-data.md` and it is not listed there.

**FOSMA version**
<!-- About tab → version + DOI -->
