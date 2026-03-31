"""
verify_benchmarks.py
Analytic verification of all 37 entries in js/benchmarks.js (BENCHMARKS),
2 entries in PUB_BIAS_BENCHMARKS (Phase 6), and 1 entry in INFLUENCE_BENCHMARKS
(Phase 7).

No external packages required (stdlib math only).
Implements the same formulas as js/profiles.js, js/analysis.js,
and js/utils.js (gorFromCounts, tetrachoricFromCounts).

Usage:  python verify_benchmarks.py
"""

import math
import sys

# ------------------------------------------------------------------ helpers --

MIN_VAR = 1e-12

def J_correction(df):
    """Hedges' J bias-correction factor."""
    return 1.0 - 3.0 / (4.0 * df - 1.0)

# ----------------------------------------------------------------- tau2 -----

def _dl_base(yi, vi):
    """Return (Q, k-1, c, W, FE, wi_list) for DL computation."""
    w  = [1.0 / v for v in vi]
    W  = sum(w)
    FE = sum(wi * y for wi, y in zip(w, yi)) / W
    Q  = sum(wi * (y - FE) ** 2 for wi, y in zip(w, yi))
    k  = len(yi)
    c  = W - sum(wi ** 2 for wi in w) / W
    return Q, k - 1, c, W, FE, w

def tau2_DL(yi, vi):
    Q, df, c, _, _, _ = _dl_base(yi, vi)
    return max(0.0, (Q - df) / c)

def tau2_HS(yi, vi):
    Q, df, _, W, _, _ = _dl_base(yi, vi)
    return max(0.0, (Q - df) / W)

def tau2_HE(yi, vi):
    """Hedges unweighted moments estimator."""
    k   = len(yi)
    mu  = sum(yi) / k
    ss  = sum((y - mu) ** 2 for y in yi)
    return max(0.0, ss / (k - 1) - sum(vi) / k)

def tau2_ML(yi, vi, tol=1e-10, max_iter=100):
    """
    ML estimator via Fisher scoring (mirrors analysis.js tau2_ML).
    score = sum[ri^2/vi_tau^2 - 1/vi_tau]
    info  = sum[1/vi_tau^2]
    """
    t = tau2_DL(yi, vi)
    for _ in range(max_iter):
        w  = [1.0 / (v + t) for v in vi]
        W  = sum(w)
        mu = sum(wi * y for wi, y in zip(w, yi)) / W
        score = 0.0
        info  = 0.0
        for wi, y, v in zip(w, yi, vi):
            vi_tau = v + t
            ri     = y - mu
            score += ri * ri / (vi_tau * vi_tau) - 1.0 / vi_tau
            info  += 1.0 / (vi_tau * vi_tau)
        if info <= 0:
            break
        step  = score / info
        t_new = t + step
        sh = 0
        while t_new < 0 and sh < 20:
            step /= 2; t_new = t + step; sh += 1
        t_new = max(0.0, t_new)
        if abs(t_new - t) < tol:
            return t_new
        t = t_new
    return max(0.0, t)

def tau2_SJ(yi, vi, tol=1e-10, max_iter=200):
    """
    Sidik-Jonkman estimator (mirrors analysis.js tau2_SJ).
    Seed: unweighted variance = sum((yi-ybar)^2)/k
    Update: t_new = (1/k) * sum[vi*(yi-mu_RE)^2 / (vi+t)]
    mu_RE uses RE weights at each step.
    """
    k    = len(yi)
    ybar = sum(yi) / k
    t    = sum((y - ybar) ** 2 for y in yi) / k   # seed: always > 0
    if t == 0:
        return 0.0
    for _ in range(max_iter):
        w  = [1.0 / (v + t) for v in vi]
        W  = sum(w)
        mu = sum(wi * y for wi, y in zip(w, yi)) / W
        t_new = sum(v * (y - mu) ** 2 / (v + t) for y, v in zip(yi, vi)) / k
        t_new = max(0.0, t_new)
        if abs(t_new - t) < tol:
            return t_new
        t = t_new
    return max(0.0, t)

def tau2_REML(yi, vi, tol=1e-10, max_iter=100):
    """
    REML estimator via Fisher scoring with leverage correction
    (mirrors analysis.js tau2_REML exactly).
    score = sum[ri^2/vi_tau^2 - (1 - h_i)/vi_tau]   where h_i = w_i/W
    info  = sum[(1 - h_i)/vi_tau^2]
    """
    t = tau2_DL(yi, vi)
    for _ in range(max_iter):
        w  = [1.0 / (v + t) for v in vi]
        W  = sum(w)
        mu = sum(wi * y for wi, y in zip(w, yi)) / W
        score = 0.0
        info  = 0.0
        for wi, y, v in zip(w, yi, vi):
            vi_tau = v + t
            ri     = y - mu
            hi     = wi / W
            score += ri * ri / (vi_tau * vi_tau) - (1.0 - hi) / vi_tau
            info  += (1.0 - hi) / (vi_tau * vi_tau)
        if info <= 0:
            break
        step  = score / info
        t_new = t + step
        sh = 0
        while t_new < 0 and sh < 20:
            step /= 2; t_new = t + step; sh += 1
        t_new = max(0.0, t_new)
        if abs(t_new - t) < tol:
            return t_new
        t = t_new
    return max(0.0, t)

def tau2_PM(yi, vi, tol=1e-10, max_iter=100):
    """
    Paule-Mandel iterative moment-matching estimator (mirrors analysis.js tau2_PM).
    Update rule: τ²_new = max(0, τ² + (Q − (k−1)) / W)
    Fixed point satisfies Q(τ*) = k−1.
    """
    k = len(yi)
    if k <= 1:
        return 0.0
    tau2 = 0.0
    for _ in range(max_iter):
        w = [1.0 / (v + tau2) for v in vi]
        W = sum(w)
        mu = sum(w[i] * yi[i] for i in range(k)) / W
        Q = sum(w[i] * (yi[i] - mu) ** 2 for i in range(k))
        new_tau2 = max(0.0, tau2 + (Q - (k - 1)) / W)
        if abs(new_tau2 - tau2) < tol:
            return new_tau2
        tau2 = new_tau2
    return tau2

TAU2_FN = {
    "DL":   tau2_DL,
    "REML": tau2_REML,
    "HS":   tau2_HS,
    "HE":   tau2_HE,
    "ML":   tau2_ML,
    "SJ":   tau2_SJ,
    "PM":   tau2_PM,
}

# ----------------------------------------------------------------- pooling --

def pool(yi, vi, method):
    """Return (FE, RE, tau2, I2)."""
    w_fe = [1.0 / v for v in vi]
    W_fe = sum(w_fe)
    FE   = sum(wi * y for wi, y in zip(w_fe, yi)) / W_fe
    Q    = sum(wi * (y - FE) ** 2 for wi, y in zip(w_fe, yi))
    df   = len(yi) - 1
    I2   = max(0.0, (Q - df) / Q * 100.0) if Q > 0 else 0.0

    t2   = TAU2_FN[method](yi, vi)

    w_re = [1.0 / (v + t2) for v in vi]
    W_re = sum(w_re)
    RE   = sum(wi * y for wi, y in zip(w_re, yi)) / W_re

    return FE, RE, t2, I2


def influence_diagnostics(yi, vi, method):
    """Per-study influence diagnostics mirroring js/analysis.js influenceDiagnostics()."""
    k = len(yi)
    t2_full = TAU2_FN[method](yi, vi)
    w_re = [1.0 / (v + t2_full) for v in vi]
    W = sum(w_re)
    RE_full = sum(w * y for w, y in zip(w_re, yi)) / W
    results = []
    for idx in range(k):
        yi_loo = [yi[i] for i in range(k) if i != idx]
        vi_loo = [vi[i] for i in range(k) if i != idx]
        t2_loo = TAU2_FN[method](yi_loo, vi_loo)
        w_loo = [1.0 / (v + t2_loo) for v in vi_loo]
        W_loo = sum(w_loo)
        RE_loo = sum(w * y for w, y in zip(w_loo, yi_loo)) / W_loo
        seRE_loo = math.sqrt(1.0 / W_loo)
        hat = w_re[idx] / W
        r = (yi[idx] - RE_full) / math.sqrt(vi[idx] + t2_full)
        dfbeta = (RE_full - RE_loo) / seRE_loo
        delta_tau2 = t2_full - t2_loo
        cook_d = (RE_full - RE_loo) ** 2 * W
        results.append(dict(
            RE_loo=RE_loo, tau2_loo=t2_loo, hat=hat, cookD=cook_d,
            stdResidual=r, DFBETA=dfbeta, deltaTau2=delta_tau2,
            outlier=abs(r) > 2, influential=abs(dfbeta) > 1,
            highLeverage=hat > 2 / k, highCookD=cook_d > 4 / k,
        ))
    return results

# ----------------------------------------------------------------- CI helpers -

def _log_gamma(x):
    """Lanczos approximation of log Γ(x)."""
    if x < 0.5:
        return math.log(math.pi) - math.log(math.sin(math.pi * x)) - _log_gamma(1 - x)
    x -= 1
    g  = 7
    cs = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
          771.32342877765313, -176.61502916214059, 12.507343278686905,
          -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
    a = cs[0]
    t = x + g + 0.5
    for i in range(1, g + 2):
        a += cs[i] / (x + i)
    return 0.5 * math.log(2 * math.pi) + (x + 0.5) * math.log(t) - t + math.log(a)

def _reg_inc_beta(x, a, b):
    """Regularised incomplete beta I_x(a,b) via Lentz continued fraction."""
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    if x > (a + 1) / (a + b + 2): return 1.0 - _reg_inc_beta(1 - x, b, a)
    lb = _log_gamma(a) + _log_gamma(b) - _log_gamma(a + b)
    fr = math.exp(a * math.log(x) + b * math.log(1 - x) - lb) / a
    TINY, EPS = 1e-30, 1e-14
    c = 1.0; d = 1 - (a + b) * x / (a + 1)
    if abs(d) < TINY: d = TINY
    d = 1 / d; f = d
    for m in range(1, 201):
        nm = 2 * m
        delta = m * (b - m) * x / ((a + nm - 1) * (a + nm))
        d = 1 + delta * d; c = 1 + delta / c
        if abs(c) < TINY: c = TINY
        if abs(d) < TINY: d = TINY
        d = 1 / d; f *= d * c
        delta = -(a + m) * (a + b + m) * x / ((a + nm) * (a + nm + 1))
        d = 1 + delta * d; c = 1 + delta / c
        if abs(c) < TINY: c = TINY
        if abs(d) < TINY: d = TINY
        d = 1 / d; dv = d * c; f *= dv
        if abs(dv - 1) < EPS: break
    return fr * f

def _t_cdf(t, df):
    """CDF of t-distribution with df degrees of freedom."""
    x = df / (df + t * t)
    p = _reg_inc_beta(x, df / 2.0, 0.5) / 2.0
    return p if t <= 0 else 1.0 - p

def _t_crit(df, alpha=0.975):
    """Quantile t_{df,alpha} via bisection."""
    lo, hi = 0.0, 20.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if _t_cdf(mid, df) < alpha: lo = mid
        else: hi = mid
    return (lo + hi) / 2

def _log_lik(yi, vi, mu, tau2):
    """Marginal log-likelihood L(μ, τ²) = −½ Σ[log(2π(vᵢ+τ²)) + (yᵢ−μ)²/(vᵢ+τ²)]."""
    return sum(-0.5 * (math.log(2 * math.pi * (v + tau2)) + (y - mu) ** 2 / (v + tau2))
               for y, v in zip(yi, vi))

def _profile_tau2(yi, vi, mu):
    """τ² maximising L(μ,τ²) at fixed μ: bisect Σ(yᵢ−μ)²/(vᵢ+τ²)² = Σ1/(vᵢ+τ²)."""
    def obj(t):
        return sum((y - mu) ** 2 / (v + t) ** 2 - 1.0 / (v + t) for y, v in zip(yi, vi))
    if obj(0.0) <= 0.0:
        return 0.0
    hi = 1.0
    while obj(hi) > 0 and hi < 1e6:
        hi *= 2
    if obj(hi) > 0:
        return 0.0
    lo = 0.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if obj(mid) > 0: lo = mid
        else: hi = mid
    return (lo + hi) / 2

def _profile_lik_ci(yi, vi, alpha=0.05):
    """Profile-likelihood CI via bisection (mirrors profileLikCI in analysis.js)."""
    # Step 1: ML tau² and maximum log-likelihood
    t2_ml = tau2_ML(yi, vi)
    w_ml  = [1.0 / (v + t2_ml) for v in vi]
    W_ml  = sum(w_ml)
    mu_hat = sum(w * y for w, y in zip(w_ml, yi)) / W_ml
    l_max  = _log_lik(yi, vi, mu_hat, t2_ml)
    cutoff = 3.8414588206941196 / 2   # χ²_{1,1−α}/2  (α=0.05 → 1.9207)

    def pl_obj(mu):
        return _log_lik(yi, vi, mu, _profile_tau2(yi, vi, mu)) - (l_max - cutoff)

    se_approx = math.sqrt(1.0 / W_ml)

    def find_bound(sign):
        delta = 2.0 * se_approx
        for _ in range(50):
            if pl_obj(mu_hat + sign * delta) > 0: delta *= 2
            else: break
        lo, hi = 0.0, delta
        for _ in range(64):
            mid = (lo + hi) / 2
            if pl_obj(mu_hat + sign * mid) > 0: lo = mid
            else: hi = mid
        return mu_hat + sign * (lo + hi) / 2

    return find_bound(-1), find_bound(+1)

def compute_ci(yi, vi, tau_method, ci_method):
    """Return (ciLow, ciHigh) for the given CI method (mirrors analysis.js meta())."""
    t2    = TAU2_FN[tau_method](yi, vi)
    w_re  = [1.0 / (v + t2) for v in vi]
    W_re  = sum(w_re)
    RE    = sum(w * y for w, y in zip(w_re, yi)) / W_re
    seRE  = math.sqrt(1.0 / W_re)
    k     = len(yi)

    if ci_method == "KH" and k > 1:
        var_kh = sum(w * (y - RE) ** 2 for w, y in zip(w_re, yi)) / ((k - 1) * W_re)
        seRE   = math.sqrt(max(var_kh, 0.0))
        crit   = _t_crit(k - 1)
    elif ci_method == "t" and k > 1:
        crit   = _t_crit(k - 1)
    else:
        crit   = 1.9599639845400536  # z_{0.975}

    if ci_method == "PL" and k > 1:
        return _profile_lik_ci(yi, vi)

    return RE - crit * seRE, RE + crit * seRE

# ============================================================ compute_yi ====

def compute_GENERIC(studies):
    return [(s["yi"], s["vi"]) for s in studies]

def compute_OR(studies):
    out = []
    for s in studies:
        a, b, c, d = s["a"], s["b"], s["c"], s["d"]
        yi = math.log((a * d) / (b * c))
        vi = max(1/a + 1/b + 1/c + 1/d, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_RR(studies):
    out = []
    for s in studies:
        a, b, c, d = s["a"], s["b"], s["c"], s["d"]
        n1, n2 = a + b, c + d
        p1, p2 = a / n1, c / n2
        yi = math.log(p1 / p2)
        vi = max(1/a - 1/n1 + 1/c - 1/n2, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_RD(studies):
    out = []
    for s in studies:
        a, b, c, d = s["a"], s["b"], s["c"], s["d"]
        n1, n2 = a + b, c + d
        p1, p2 = a / n1, c / n2
        yi = p1 - p2
        vi = max(p1*(1-p1)/n1 + p2*(1-p2)/n2, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_MD(studies):
    out = []
    for s in studies:
        n1, m1, sd1 = s["n1"], s["m1"], s["sd1"]
        n2, m2, sd2 = s["n2"], s["m2"], s["sd2"]
        yi = m1 - m2
        vi = max(sd1**2/n1 + sd2**2/n2, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_SMD(studies):
    """Hedges' g (pooled-SD standardiser)."""
    out = []
    for s in studies:
        n1, m1, sd1 = s["n1"], s["m1"], s["sd1"]
        n2, m2, sd2 = s["n2"], s["m2"], s["sd2"]
        df = n1 + n2 - 2
        sp = math.sqrt(((n1-1)*sd1**2 + (n2-1)*sd2**2) / df)
        d  = (m1 - m2) / sp
        Jv = J_correction(df)
        g  = d * Jv
        vi = max(Jv**2 * (1/n1 + 1/n2 + g**2 / (2*(n1+n2))), MIN_VAR)
        out.append((g, vi))
    return out

def compute_SMDH(studies):
    """Heteroscedastic g: sdi = sqrt((sd1^2+sd2^2)/2)."""
    out = []
    for s in studies:
        n1, m1, sd1 = s["n1"], s["m1"], s["sd1"]
        n2, m2, sd2 = s["n2"], s["m2"], s["sd2"]
        df   = n1 + n2 - 2
        sdi2 = (sd1**2 + sd2**2) / 2.0
        sdi  = math.sqrt(sdi2)
        d    = (m1 - m2) / sdi
        Jv   = J_correction(df)
        g    = d * Jv
        vi   = max(Jv**2 * ((sd1**2/n1 + sd2**2/n2)/sdi2 + d**2/(2*df)), MIN_VAR)
        out.append((g, vi))
    return out

def compute_ROM(studies):
    """Log ratio of means."""
    out = []
    for s in studies:
        n1, m1, sd1 = s["n1"], s["m1"], s["sd1"]
        n2, m2, sd2 = s["n2"], s["m2"], s["sd2"]
        yi = math.log(m1 / m2)
        vi = max(sd1**2/(n1*m1**2) + sd2**2/(n2*m2**2), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_MD_paired(studies):
    """yi = Δm,  vi = sd_change^2 / n."""
    out = []
    for s in studies:
        m_pre, m_post = s["m_pre"], s["m_post"]
        sd_pre, sd_post, n, r = s["sd_pre"], s["sd_post"], s["n"], s["r"]
        yi  = m_post - m_pre
        sd2 = sd_pre**2 + sd_post**2 - 2*r*sd_pre*sd_post
        vi  = max(sd2 / n, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_SMD_paired(studies):
    """SMCR: d = Δm / sd_pre (pre-test SD standardiser)."""
    out = []
    for s in studies:
        m_pre, m_post = s["m_pre"], s["m_post"]
        sd_pre, n, r  = s["sd_pre"], s["n"], s["r"]
        df   = n - 1
        d    = (m_post - m_pre) / sd_pre
        Jv   = J_correction(df)
        g    = d * Jv
        vi   = max(Jv**2 * (2*(1-r)/n + d**2/(2*df)), MIN_VAR)
        out.append((g, vi))
    return out

def compute_SMCC(studies):
    """SMCC: d = Δm / sd_change (change-score SD standardiser)."""
    out = []
    for s in studies:
        m_pre, m_post = s["m_pre"], s["m_post"]
        sd_pre, sd_post, n, r = s["sd_pre"], s["sd_post"], s["n"], s["r"]
        df     = n - 1
        sd_chg = math.sqrt(sd_pre**2 + sd_post**2 - 2*r*sd_pre*sd_post)
        d      = (m_post - m_pre) / sd_chg
        Jv     = J_correction(df)
        g      = d * Jv
        vi     = max(Jv**2 * (2*(1-r)/n + d**2/(2*df)), MIN_VAR)
        out.append((g, vi))
    return out

def compute_PR(studies):
    out = []
    for s in studies:
        p  = s["x"] / s["n"]
        vi = max(p*(1-p)/s["n"], MIN_VAR)
        out.append((p, vi))
    return out

def compute_PLO(studies):
    out = []
    for s in studies:
        x, n = s["x"], s["n"]
        p  = x / n
        yi = math.log(p / (1-p))
        vi = max(1.0 / (n*p*(1-p)), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_PAS(studies):
    out = []
    for s in studies:
        p  = s["x"] / s["n"]
        yi = math.asin(math.sqrt(p))
        vi = max(1.0 / (4*s["n"]), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_PFT(studies):
    out = []
    for s in studies:
        x, n = s["x"], s["n"]
        yi = math.asin(math.sqrt(x/(n+1))) + math.asin(math.sqrt((x+1)/(n+1)))
        vi = max(1.0 / (n + 0.5), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_PLN(studies):
    out = []
    for s in studies:
        x, n = s["x"], s["n"]
        p  = x / n
        yi = math.log(p)
        vi = max((1-p) / (n*p), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_ZCOR(studies):
    out = []
    for s in studies:
        r, n = s["r"], s["n"]
        yi = math.atanh(r)
        vi = max(1.0 / (n - 3), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_COR(studies):
    out = []
    for s in studies:
        r, n = s["r"], s["n"]
        yi = r
        vi = max((1 - r**2)**2 / (n - 1), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_HR(studies):
    """yi = log(hr),  vi = ((log(ci_hi)-log(ci_lo))/(2*1.96))^2."""
    out = []
    for s in studies:
        yi = math.log(s["hr"])
        vi = max(((math.log(s["ci_hi"]) - math.log(s["ci_lo"])) / (2*1.96))**2, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_IRR(studies):
    out = []
    for s in studies:
        x1, t1, x2, t2 = s["x1"], s["t1"], s["x2"], s["t2"]
        yi = math.log(x1/t1) - math.log(x2/t2)
        vi = max(1/x1 + 1/x2, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_IR(studies):
    out = []
    for s in studies:
        yi = math.log(s["x"] / s["t"])
        vi = max(1.0 / s["x"], MIN_VAR)
        out.append((yi, vi))
    return out

def compute_PHI(studies):
    out = []
    for s in studies:
        a, b, c, d = s["a"], s["b"], s["c"], s["d"]
        N   = a + b + c + d
        phi = (a*d - b*c) / math.sqrt((a+b)*(c+d)*(a+c)*(b+d))
        vi  = max((1 - phi**2)**2 / (N - 1), MIN_VAR)
        out.append((phi, vi))
    return out

def compute_MN(studies):
    """Raw mean: yi = m, vi = sd^2 / n."""
    out = []
    for s in studies:
        yi = s["m"]
        vi = max(s["sd"] ** 2 / s["n"], MIN_VAR)
        out.append((yi, vi))
    return out

def compute_MNLN(studies):
    """Log mean: yi = ln(m), vi = sd^2 / (n * m^2)."""
    out = []
    for s in studies:
        m, sd, n = s["m"], s["sd"], s["n"]
        yi = math.log(m)
        vi = max(sd ** 2 / (n * m ** 2), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_CVR(studies):
    """Log CV ratio: yi = ln(cv1/cv2), vi per delta-method."""
    out = []
    for s in studies:
        m1, sd1, n1 = s["m1"], s["sd1"], s["n1"]
        m2, sd2, n2 = s["m2"], s["sd2"], s["n2"]
        cv1 = sd1 / m1
        cv2 = sd2 / m2
        yi  = math.log(cv1 / cv2)
        vi  = max(1/(2*(n1-1)) + cv1**2/n1 + 1/(2*(n2-1)) + cv2**2/n2, MIN_VAR)
        out.append((yi, vi))
    return out

def compute_VR(studies):
    """Log SD ratio: yi = ln(sd1/sd2), vi = 1/(2(n1-1)) + 1/(2(n2-1))."""
    out = []
    for s in studies:
        sd1, n1 = s["sd1"], s["n1"]
        sd2, n2 = s["sd2"], s["n2"]
        yi = math.log(sd1 / sd2)
        vi = max(1/(2*(n1-1)) + 1/(2*(n2-1)), MIN_VAR)
        out.append((yi, vi))
    return out

def _parse_counts(s):
    """Parse comma-separated count string to list of ints."""
    return [int(x.strip()) for x in s.split(",")]

def _gor_from_counts(c1, c2):
    """Port of gorFromCounts from js/utils.js."""
    C  = len(c1)
    N1 = sum(c1)
    N2 = sum(c2)
    p1 = [v / N1 for v in c1]
    p2 = [v / N2 for v in c2]

    L2   = [0.0] * C
    H2   = [0.0] * C
    P1gt = [0.0] * C
    P1lt = [0.0] * C

    for j in range(1, C):
        L2[j] = L2[j-1] + p2[j-1]
    for j in range(C-2, -1, -1):
        H2[j] = H2[j+1] + p2[j+1]
    for k in range(C-2, -1, -1):
        P1gt[k] = P1gt[k+1] + p1[k+1]
    for k in range(1, C):
        P1lt[k] = P1lt[k-1] + p1[k-1]

    theta = sum(p1[j] * L2[j] for j in range(C))
    phi   = sum(p1[j] * H2[j] for j in range(C))

    # Delta-method variance
    V1t = V1p = Cov1 = 0.0
    for j in range(C):
        at = L2[j] - theta
        ap = H2[j] - phi
        V1t  += p1[j] * at * at
        V1p  += p1[j] * ap * ap
        Cov1 += p1[j] * at * ap
    V1t /= N1;  V1p /= N1;  Cov1 /= N1

    V2t = V2p = Cov2 = 0.0
    for k in range(C):
        bt = P1gt[k] - theta
        bp = P1lt[k] - phi
        V2t  += p2[k] * bt * bt
        V2p  += p2[k] * bp * bp
        Cov2 += p2[k] * bt * bp
    V2t /= N2;  V2p /= N2;  Cov2 /= N2

    varLog = ((V1t + V2t) / (theta * theta)
            + (V1p + V2p) / (phi   * phi)
            - 2 * (Cov1 + Cov2) / (theta * phi))
    return math.log(theta) - math.log(phi), max(varLog, MIN_VAR)

def compute_GOR(studies):
    out = []
    for s in studies:
        c1 = _parse_counts(s["counts1"])
        c2 = _parse_counts(s["counts2"])
        yi, vi = _gor_from_counts(c1, c2)
        out.append((yi, vi))
    return out

def compute_PCOR(studies):
    """Raw partial correlation: yi = r, vi = (1-r^2)^2 / (n-p-1)."""
    out = []
    for s in studies:
        r, n, p = s["r"], s["n"], s["p"]
        yi = r
        vi = max((1 - r**2)**2 / (n - p - 1), MIN_VAR)
        out.append((yi, vi))
    return out

def compute_ZPCOR(studies):
    """Fisher-z partial correlation: yi = atanh(r), vi = 1/(n-p-3)."""
    out = []
    for s in studies:
        r, n, p = s["r"], s["n"], s["p"]
        yi = math.atanh(r)
        vi = max(1.0 / (n - p - 3), MIN_VAR)
        out.append((yi, vi))
    return out

# ---- RTET helpers: port of normalCDF/normalQuantile/bivariateNormalCDF/
#      tetrachoricFromCounts from js/utils.js ----

def _normal_cdf_as(x):
    """Abramowitz-Stegun approximation (matches normalCDF in utils.js)."""
    t = 1.0 / (1.0 + 0.2316419 * abs(x))
    d = 0.3989423 * math.exp(-x * x / 2.0)
    prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    if x > 0:
        prob = 1.0 - prob
    return prob

_ACKLAM_A = [-3.969683028665376e+01,  2.209460984245205e+02,
             -2.759285104469687e+02,  1.383577518672690e+02,
             -3.066479806614716e+01,  2.506628277459239e+00]
_ACKLAM_B = [-5.447609879822406e+01,  1.615858368580409e+02,
             -1.556989798598866e+02,  6.680131188771972e+01,
             -1.328068155288572e+01]
_ACKLAM_C = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00,  2.938163982698783e+00]
_ACKLAM_D = [ 7.784695709041462e-03,  3.224671290700398e-01,
              2.445134137142996e+00,  3.754408661907416e+00]

def _normal_quantile(p):
    """Acklam rational approximation (matches normalQuantile in utils.js)."""
    if p <= 0:
        return float('-inf')
    if p >= 1:
        return float('inf')
    a, b, c, d = _ACKLAM_A, _ACKLAM_B, _ACKLAM_C, _ACKLAM_D
    p_lo, p_hi = 0.02425, 1 - 0.02425
    if p < p_lo:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p <= p_hi:
        q = p - 0.5
        r = q * q
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
               (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
    q = math.sqrt(-2 * math.log(1 - p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)

_GL20_X = [
    -0.9931285991850949, -0.9639719272779138, -0.9122344282513259, -0.8391169718222188,
    -0.7463064833401189, -0.6360536807265150, -0.5108670019508271, -0.3737060887154195,
    -0.2277858511416451, -0.0765265211334973,  0.0765265211334973,  0.2277858511416451,
     0.3737060887154195,  0.5108670019508271,  0.6360536807265150,  0.7463064833401189,
     0.8391169718222188,  0.9122344282513259,  0.9639719272779138,  0.9931285991850949,
]
_GL20_W = [
    0.0176140071391521, 0.0406014298003869, 0.0626720483341091, 0.0832767415767048,
    0.1019301198172404, 0.1181945319615184, 0.1316886384491766, 0.1420961093183820,
    0.1491729864726037, 0.1527533871307258, 0.1527533871307258, 0.1491729864726037,
    0.1420961093183820, 0.1316886384491766, 0.1181945319615184, 0.1019301198172404,
    0.0832767415767048, 0.0626720483341091, 0.0406014298003869, 0.0176140071391521,
]

def _bivariate_normal_cdf(h, k, rho):
    """20-point GL quadrature (matches bivariateNormalCDF in utils.js)."""
    EPS = 1e-10
    rho = max(-1 + EPS, min(1 - EPS, rho))
    if rho == 0:
        return _normal_cdf_as(h) * _normal_cdf_as(k)
    hh, kk, hk = h * h, k * k, h * k
    TWO_PI = 2 * math.pi
    s = 0.0
    for xi, wi in zip(_GL20_X, _GL20_W):
        t  = rho * (xi + 1) / 2
        r2 = 1 - t * t
        s += wi * math.exp(-(hh + kk - 2*t*hk) / (2*r2)) / (TWO_PI * math.sqrt(r2))
    return _normal_cdf_as(h) * _normal_cdf_as(k) + (rho / 2) * s

_BISECTION_ITERS = 64

def _tetrachoric_from_counts(a, b, c, d):
    """Bisection tetrachoric (matches tetrachoricFromCounts in utils.js)."""
    aa, bb, cc, dd = float(a), float(b), float(c), float(d)
    if aa == 0 or bb == 0 or cc == 0 or dd == 0:
        aa += 0.5; bb += 0.5; cc += 0.5; dd += 0.5
    N     = aa + bb + cc + dd
    p_row = (aa + bb) / N
    p_col = (aa + cc) / N
    p11   = aa / N
    if p_row <= 0 or p_row >= 1 or p_col <= 0 or p_col >= 1:
        return float('nan'), float('nan')
    h = _normal_quantile(p_row)
    k = _normal_quantile(p_col)
    EPS = 1e-10
    lo, hi = -1 + EPS, 1 - EPS
    if _bivariate_normal_cdf(h, k, lo) > p11 or _bivariate_normal_cdf(h, k, hi) < p11:
        return float('nan'), float('nan')
    for _ in range(_BISECTION_ITERS):
        mid = (lo + hi) / 2
        if _bivariate_normal_cdf(h, k, mid) < p11:
            lo = mid
        else:
            hi = mid
    rho = (lo + hi) / 2
    r2  = 1 - rho * rho
    bvd = math.exp(-(h*h + k*k - 2*rho*h*k) / (2*r2)) / (2 * math.pi * math.sqrt(r2))
    if not math.isfinite(bvd) or bvd == 0:
        return float('nan'), float('nan')
    v = p_row * (1 - p_row) * p_col * (1 - p_col) / (N * bvd * bvd)
    return rho, max(v, MIN_VAR)

def compute_RTET(studies):
    """Tetrachoric correlation from 2×2 table."""
    out = []
    for s in studies:
        rho, v = _tetrachoric_from_counts(s["a"], s["b"], s["c"], s["d"])
        out.append((rho, v))
    return out

COMPUTE_FN = {
    "GENERIC":    compute_GENERIC,
    "OR":         compute_OR,
    "RR":         compute_RR,
    "RD":         compute_RD,
    "MD":         compute_MD,
    "SMD":        compute_SMD,
    "SMDH":       compute_SMDH,
    "ROM":        compute_ROM,
    "MD_paired":  compute_MD_paired,
    "SMD_paired": compute_SMD_paired,
    "SMCC":       compute_SMCC,
    "PR":         compute_PR,
    "PLO":        compute_PLO,
    "PAS":        compute_PAS,
    "PFT":        compute_PFT,
    "PLN":        compute_PLN,
    "ZCOR":       compute_ZCOR,
    "COR":        compute_COR,
    "HR":         compute_HR,
    "IRR":        compute_IRR,
    "IR":         compute_IR,
    "PHI":        compute_PHI,
    "MN":         compute_MN,
    "MNLN":       compute_MNLN,
    "CVR":        compute_CVR,
    "VR":         compute_VR,
    "GOR":        compute_GOR,
    "PCOR":       compute_PCOR,
    "ZPCOR":      compute_ZPCOR,
    "RTET":       compute_RTET,
}

# ================================================================ benchmarks =

BCG = [
    {"label": "Aronson 1948",            "a":   4, "b":   119, "c":  11, "d":   128},
    {"label": "Ferguson & Simes 1949",   "a":   6, "b":   300, "c":  29, "d":   274},
    {"label": "Rosenthal 1960",          "a":   3, "b":   228, "c":  11, "d":   209},
    {"label": "Hart & Sutherland 1977",  "a":  62, "b": 13536, "c": 248, "d": 12619},
    {"label": "Frimodt-Moller 1973",     "a":  33, "b":  5036, "c":  47, "d":  5761},
    {"label": "Stein & Aronson 1953",    "a": 180, "b":  1361, "c": 372, "d":  1079},
    {"label": "Vandiviere 1973",         "a":   8, "b":  2537, "c":  10, "d":   619},
    {"label": "TPT Madras 1980",         "a": 505, "b": 87886, "c": 499, "d": 87892},
    {"label": "Coetzee & Berjak 1968",   "a":  29, "b":  7470, "c":  45, "d":  7232},
    {"label": "Rosenthal 1961",          "a":  17, "b":  1699, "c":  65, "d":  1600},
    {"label": "Comstock 1974",           "a": 186, "b": 50448, "c": 141, "d": 27197},
    {"label": "Comstock & Webster 1969", "a":   5, "b":  2493, "c":   3, "d":  2338},
    {"label": "Comstock 1976",           "a":  27, "b": 16886, "c":  29, "d": 17825},
]

# GENERIC uses pre-computed RR yi/vi (full precision from benchmarks.js)
BCG_GENERIC = [
    {"yi": -0.8893113339202054, "vi": 0.3255847650039614},
    {"yi": -1.5853886572014306, "vi": 0.19458112139814387},
    {"yi": -1.348073148299693,  "vi": 0.41536796536796533},
    {"yi": -1.4415511900213054, "vi": 0.020010031902247573},
    {"yi": -0.2175473222112957, "vi": 0.05121017216963086},
    {"yi": -0.786115585818864,  "vi": 0.0069056184559087574},
    {"yi": -1.6208982235983924, "vi": 0.22301724757231517},
    {"yi":  0.011952333523841173,"vi": 0.00396157929781773},
    {"yi": -0.4694176487381487, "vi": 0.056434210463248966},
    {"yi": -1.3713448034727846, "vi": 0.07302479361302891},
    {"yi": -0.33935882833839015,"vi": 0.01241221397155972},
    {"yi":  0.4459134005713783, "vi": 0.5325058452001528},
    {"yi": -0.017313948216879493,"vi": 0.0714046596839863},
]

NORMAND = [
    {"label": "Edinburgh",          "n1": 155, "m1":  55, "sd1": 47, "n2": 156, "m2":  75, "sd2": 64},
    {"label": "Orpington-Mild",     "n1":  31, "m1":  27, "sd1":  7, "n2":  32, "m2":  29, "sd2":  4},
    {"label": "Orpington-Moderate", "n1":  75, "m1":  64, "sd1": 17, "n2":  71, "m2": 119, "sd2": 29},
    {"label": "Orpington-Severe",   "n1":  18, "m1":  66, "sd1": 20, "n2":  18, "m2": 137, "sd2": 48},
    {"label": "Montreal-Home",      "n1":   8, "m1":  14, "sd1":  8, "n2":  13, "m2":  18, "sd2": 11},
    {"label": "Montreal-Transfer",  "n1":  57, "m1":  19, "sd1":  7, "n2":  52, "m2":  18, "sd2":  4},
    {"label": "Newcastle",          "n1":  34, "m1":  52, "sd1": 45, "n2":  33, "m2":  41, "sd2": 34},
    {"label": "Umea",               "n1": 110, "m1":  21, "sd1": 16, "n2": 183, "m2":  31, "sd2": 27},
    {"label": "Uppsala",            "n1":  60, "m1":  30, "sd1": 27, "n2":  52, "m2":  23, "sd2": 20},
]

MORRIS = [
    {"label": "Study 1", "m_pre": 30.6, "m_post": 38.5, "sd_pre": 15.0, "sd_post": 11.6, "n": 20, "r": 0.47},
    {"label": "Study 2", "m_pre": 23.5, "m_post": 26.8, "sd_pre":  3.1, "sd_post":  4.1, "n": 50, "r": 0.64},
    {"label": "Study 3", "m_pre":  0.5, "m_post":  0.7, "sd_pre":  0.1, "sd_post":  0.1, "n":  9, "r": 0.77},
    {"label": "Study 4", "m_pre": 53.4, "m_post": 75.9, "sd_pre": 14.5, "sd_post":  4.4, "n": 10, "r": 0.89},
    {"label": "Study 5", "m_pre": 35.6, "m_post": 36.0, "sd_pre":  4.7, "sd_post":  4.6, "n": 14, "r": 0.44},
]

PROP = [
    {"label": "Study 1", "x": 10, "n": 100},
    {"label": "Study 2", "x": 30, "n": 100},
    {"label": "Study 3", "x": 20, "n": 100},
    {"label": "Study 4", "x": 40, "n": 100},
]

COR_DATA = [
    {"label": "Study 1", "r": 0.50, "n":  53},
    {"label": "Study 2", "r": 0.30, "n": 103},
    {"label": "Study 3", "r": 0.60, "n":  43},
    {"label": "Study 4", "r": 0.40, "n":  78},
    {"label": "Study 5", "r": 0.25, "n": 123},
]

TAU2_TEST = [
    {"label": "Study 1", "yi": 0.0, "vi": 1.0},
    {"label": "Study 2", "yi": 1.0, "vi": 1.0},
    {"label": "Study 3", "yi": 3.0, "vi": 1.0},
]

# PM benchmark uses unequal vi so τ²_PM ≠ τ²_HE (for equal vi PM=HE analytically)
PM_TEST_DATA = [
    {"label": "Study 1", "yi": 0.0, "vi": 0.25},
    {"label": "Study 2", "yi": 1.0, "vi": 0.50},
    {"label": "Study 3", "yi": 3.0, "vi": 1.00},
]

HR_DATA = [
    {"label": "Study 1", "hr": 0.6065, "ci_lo": 0.3716, "ci_hi": 0.9900},
    {"label": "Study 2", "hr": 0.9048, "ci_lo": 0.5543, "ci_hi": 1.4770},
    {"label": "Study 3", "hr": 0.4066, "ci_lo": 0.2491, "ci_hi": 0.6637},
    {"label": "Study 4", "hr": 0.7408, "ci_lo": 0.4538, "ci_hi": 1.2092},
]

IRR_DATA = [
    {"label": "Study 1", "x1":  5, "t1": 100, "x2": 20, "t2": 100},
    {"label": "Study 2", "x1": 18, "t1": 100, "x2": 20, "t2": 100},
    {"label": "Study 3", "x1":  8, "t1": 100, "x2": 20, "t2": 100},
    {"label": "Study 4", "x1": 14, "t1": 100, "x2": 20, "t2": 100},
]

IR_DATA = [
    {"label": "Study 1", "x": 10, "t": 200},
    {"label": "Study 2", "x": 25, "t": 300},
    {"label": "Study 3", "x":  5, "t": 400},
    {"label": "Study 4", "x": 20, "t": 250},
]

# Normand 1999 specialist arm (m1i, sd1i, n1i) — used for MN and MNLN
NORMAND_SPECIALIST = [
    {"label": "Edinburgh",          "m":  55, "sd": 47, "n": 155},
    {"label": "Orpington-Mild",     "m":  27, "sd":  7, "n":  31},
    {"label": "Orpington-Moderate", "m":  64, "sd": 17, "n":  75},
    {"label": "Orpington-Severe",   "m":  66, "sd": 20, "n":  18},
    {"label": "Montreal-Home",      "m":  14, "sd":  8, "n":   8},
    {"label": "Montreal-Transfer",  "m":  19, "sd":  7, "n":  57},
    {"label": "Newcastle",          "m":  52, "sd": 45, "n":  34},
    {"label": "Umea",               "m":  21, "sd": 16, "n": 110},
    {"label": "Uppsala",            "m":  30, "sd": 27, "n":  60},
]

# profiles.js CVR exampleData
CVR_DATA = [
    {"label": "Study 1", "m1": 25.0, "sd1":  6.2, "n1": 40, "m2": 24.8, "sd2": 3.5, "n2": 38},
    {"label": "Study 2", "m1": 30.1, "sd1":  9.0, "n1": 55, "m2": 29.7, "sd2": 4.8, "n2": 52},
    {"label": "Study 3", "m1": 18.5, "sd1":  5.1, "n1": 30, "m2": 19.0, "sd2": 3.0, "n2": 28},
    {"label": "Study 4", "m1": 42.0, "sd1": 11.5, "n1": 70, "m2": 40.5, "sd2": 6.2, "n2": 68},
    {"label": "Study 5", "m1": 22.3, "sd1":  7.8, "n1": 45, "m2": 23.1, "sd2": 4.9, "n2": 43},
]

# profiles.js VR exampleData
VR_DATA = [
    {"label": "Study 1", "sd1": 4.2, "n1": 40, "sd2": 2.8, "n2": 38},
    {"label": "Study 2", "sd1": 5.5, "n1": 55, "sd2": 3.2, "n2": 52},
    {"label": "Study 3", "sd1": 3.8, "n1": 30, "sd2": 2.5, "n2": 28},
    {"label": "Study 4", "sd1": 6.1, "n1": 70, "sd2": 4.0, "n2": 68},
    {"label": "Study 5", "sd1": 4.9, "n1": 45, "sd2": 3.5, "n2": 43},
]

# Synthetic 4-study 3-category ordinal dataset
GOR_DATA = [
    {"label": "Study 1", "counts1": "15,20,35", "counts2": "30,25,15"},
    {"label": "Study 2", "counts1": "10,25,40", "counts2": "25,30,20"},
    {"label": "Study 3", "counts1": "20,30,30", "counts2": "35,30,15"},
    {"label": "Study 4", "counts1": "12,18,40", "counts2": "28,32,20"},
]

# Synthetic partial correlation dataset (PCOR / ZPCOR)
PCOR_DATA = [
    {"label": "Study 1", "r": 0.45, "n":  80, "p": 2},
    {"label": "Study 2", "r": 0.38, "n":  65, "p": 2},
    {"label": "Study 3", "r": 0.52, "n": 110, "p": 3},
    {"label": "Study 4", "r": 0.31, "n":  90, "p": 2},
    {"label": "Study 5", "r": 0.47, "n": 130, "p": 4},
]

# Synthetic tetrachoric correlation dataset (RTET)
RTET_DATA = [
    {"label": "Study 1", "a": 40, "b": 10, "c": 10, "d": 40},
    {"label": "Study 2", "a": 30, "b": 15, "c": 12, "d": 43},
    {"label": "Study 3", "a": 25, "b":  8, "c":  9, "d": 38},
    {"label": "Study 4", "a": 35, "b": 12, "c": 11, "d": 42},
]

# Synthetic 5-study log-RR dataset (CI method benchmarks, entries 35–37)
CI_DATASET = [
    {"label": "Study 1", "a": 15, "b": 85, "c": 30, "d": 70},
    {"label": "Study 2", "a": 20, "b": 80, "c": 25, "d": 75},
    {"label": "Study 3", "a": 10, "b": 90, "c": 35, "d": 65},
    {"label": "Study 4", "a": 25, "b": 75, "c": 20, "d": 80},
    {"label": "Study 5", "a": 12, "b": 88, "c": 28, "d": 72},
]

# Expected values sourced from js/benchmarks.js (copy key fields here).
# tau2 tolerance uses max(|exp|, 0.001) as scale → matches tests.js exactly.
BENCHMARKS = [
    {
        "name": "BCG – GENERIC (log-RR, REML)",
        "type": "GENERIC", "tau": "REML", "data": BCG_GENERIC,
        "expected": {"FE": -0.430, "RE": -0.714, "tau2": 0.313, "I2": 92.2},
    },
    {
        "name": "BCG – OR (DL)",
        "type": "OR", "tau": "DL", "data": BCG,
        "expected": {
            "yi": [-0.9389,-1.6658,-1.3863,-1.4564,-0.2189,-0.9581,
                   -1.6338, 0.0120,-0.4715,-1.4012,-0.3407, 0.4468,-0.0173],
            "FE": -0.436, "RE": -0.747, "tau2": 0.366, "I2": 92.65},
    },
    {
        "name": "BCG – RR (REML)",
        "type": "RR", "tau": "REML", "data": BCG,
        "expected": {
            "yi": [-0.8893,-1.5854,-1.3481,-1.4416,-0.2175,-0.7861,
                   -1.6209, 0.0120,-0.4694,-1.3713,-0.3394, 0.4459,-0.0173],
            "FE": -0.430, "RE": -0.715, "tau2": 0.313, "I2": 92.2},
    },
    {
        "name": "BCG – RD (DL)",
        "type": "RD", "tau": "DL", "data": BCG,
        "expected": {
            "yi": [-0.04662,-0.07610,-0.03701,-0.01471,-0.00158,-0.13957,
                   -0.01276, 0.00007,-0.00232,-0.02913,-0.00148, 0.00072,-0.00003],
            "FE": -0.0009, "RE": -0.0071, "tau2": 0.00002, "I2": 95.66},
    },
    {
        "name": "Normand – MD (REML)",
        "type": "MD", "tau": "REML", "data": NORMAND,
        "expected": {
            "yi": [-20, -2, -55, -71, -4, 1, 11, -10, 7],
            "FE": -3.464, "RE": -15.106, "tau2": 684.6, "I2": 96.65},
    },
    {
        "name": "Normand – SMD 4-study (REML)",
        "type": "SMD", "tau": "REML", "data": NORMAND[:4],
        "expected": {
            "yi": [-0.3552, -0.3479, -2.3176, -1.8880],
            "FE": -0.788, "RE": -1.207, "tau2": 1.009, "I2": 96.0},
    },
    {
        "name": "Morris – MD_paired (REML)",
        "type": "MD_paired", "tau": "REML", "data": MORRIS,
        "expected": {
            "yi": [7.9, 3.3, 0.2, 22.5, 0.4],
            "FE": 0.209, "RE": 6.416, "tau2": 73.57, "I2": 95.84},
    },
    {
        "name": "Morris – SMD_paired / SMCR (DL)",
        "type": "SMD_paired", "tau": "DL", "data": MORRIS,
        "expected": {
            "yi": [0.5056, 1.0481, 1.8065, 1.4187, 0.0801],
            "FE": 0.839, "RE": 0.892, "tau2": 0.2474, "I2": 78.1},
    },
    {
        "name": "Synthetic – PR (DL)",
        "type": "PR", "tau": "DL", "data": PROP,
        "expected": {
            "yi": [0.100, 0.300, 0.200, 0.400],
            "FE": 0.208, "RE": 0.246, "tau2": 0.01581, "I2": 90.7},
    },
    {
        "name": "Synthetic – PLO (DL)",
        "type": "PLO", "tau": "DL", "data": PROP,
        "expected": {
            "yi": [-2.197, -0.847, -1.386, -0.405],
            "FE": -0.993, "RE": -1.174, "tau2": 0.4197, "I2": 87.6},
    },
    {
        "name": "Synthetic – PAS (DL)",
        "type": "PAS", "tau": "DL", "data": PROP,
        "expected": {
            "yi": [0.322, 0.580, 0.464, 0.685],
            "FE": 0.513, "RE": 0.513, "tau2": 0.02186, "I2": 89.7},
    },
    {
        "name": "Synthetic – PFT (DL)",
        "type": "PFT", "tau": "DL", "data": PROP,
        "expected": {
            "yi": [0.656, 1.1636, 0.934, 1.371],
            "FE": 1.031, "RE": 1.031, "tau2": 0.08445, "I2": 89.5},
    },
    {
        "name": "Synthetic – ZCOR (DL)",
        "type": "ZCOR", "tau": "DL", "data": COR_DATA,
        "expected": {
            "yi": [0.54931, 0.30952, 0.69315, 0.42365, 0.25541],
            "FE": 0.3859, "RE": 0.4130, "tau2": 0.01298, "I2": 49.0},
    },
    {
        "name": "Synthetic – COR (DL)",
        "type": "COR", "tau": "DL", "data": COR_DATA,
        "expected": {
            "yi": [0.50, 0.30, 0.60, 0.40, 0.25],
            "FE": 0.394, "RE": 0.403, "tau2": 0.01145, "I2": 57.3},
    },
    {
        "name": "tau2 test – HS",
        "type": "GENERIC", "tau": "HS", "data": TAU2_TEST,
        "expected": {"FE": 1.333, "RE": 1.333, "tau2": 0.8889, "I2": 57.1},
    },
    {
        "name": "tau2 test – HE",
        "type": "GENERIC", "tau": "HE", "data": TAU2_TEST,
        "expected": {"FE": 1.333, "RE": 1.333, "tau2": 1.3333, "I2": 57.1},
    },
    {
        "name": "tau2 test – ML",
        "type": "GENERIC", "tau": "ML", "data": TAU2_TEST,
        "expected": {"FE": 1.333, "RE": 1.333, "tau2": 0.5556, "I2": 57.1},
    },
    {
        "name": "tau2 test – SJ",
        "type": "GENERIC", "tau": "SJ", "data": TAU2_TEST,
        "expected": {"FE": 1.333, "RE": 1.333, "tau2": 0.8437, "I2": 57.1},
    },
    {
        "name": "Synthetic τ² test – PM (k=3, unequal vi)",
        "type": "GENERIC", "tau": "PM", "data": PM_TEST_DATA,
        "expected": {"FE": 0.714, "RE": 1.167, "tau2": 1.648, "I2": 73.1},
    },
    {
        "name": "Synthetic – HR (DL)",
        "type": "HR", "tau": "DL", "data": HR_DATA,
        "expected": {
            "yi": [-0.500, -0.100, -0.900, -0.300],
            "FE": -0.450, "RE": -0.450, "tau2": 0.054, "I2": 46.4},
    },
    {
        "name": "Synthetic – IRR (DL)",
        "type": "IRR", "tau": "DL", "data": IRR_DATA,
        "expected": {
            "yi": [-1.386, -0.105, -0.916, -0.357],
            "FE": -0.537, "RE": -0.605, "tau2": 0.138, "I2": 47.7},
    },
    {
        "name": "Synthetic – IR (DL)",
        "type": "IR", "tau": "DL", "data": IR_DATA,
        "expected": {
            "yi": [-2.996, -2.485, -4.382, -2.526],
            "FE": -2.742, "RE": -2.997, "tau2": 0.335, "I2": 82.0},
    },
    {
        "name": "Normand – SMDH (REML)",
        "type": "SMDH", "tau": "REML", "data": NORMAND,
        "expected": {
            "yi": [-0.3553,-0.3465,-2.3018,-1.8880,-0.3993,
                    0.1742, 0.2726,-0.4494, 0.2926],
            "FE": -0.411, "RE": -0.538, "tau2": 0.782, "I2": 93.5},
    },
    {
        "name": "Normand – ROM (REML)",
        "type": "ROM", "tau": "REML", "data": NORMAND,
        "expected": {
            "yi": [-0.3102,-0.0715,-0.6202,-0.7303,-0.2513,
                    0.0541, 0.2377,-0.3895, 0.2657],
            "FE": -0.303, "RE": -0.218, "tau2": 0.108, "I2": 94.6},
    },
    {
        "name": "Morris – SMCC (DL)",
        "type": "SMCC", "tau": "DL", "data": MORRIS,
        "expected": {
            "yi": [0.5417, 1.0198, 2.6635, 1.9096, 0.0765],
            "FE": 0.839, "RE": 1.038, "tau2": 0.373, "I2": 82.7},
    },
    {
        "name": "Synthetic – PLN (DL)",
        "type": "PLN", "tau": "DL", "data": PROP,
        "expected": {
            "yi": [-2.3026, -1.2040, -1.6094, -0.9163],
            "FE": -1.226, "RE": -1.452, "tau2": 0.2051, "I2": 86.9},
    },
    {
        "name": "BCG – PHI (DL)",
        "type": "PHI", "tau": "DL", "data": BCG,
        "expected": {
            "yi": [-0.1001,-0.1635,-0.1067,-0.0684,-0.0092,-0.1798,
                   -0.0677, 0.0005,-0.0164,-0.0947,-0.0110, 0.0089,-0.0003],
            "FE": -0.012, "RE": -0.048, "tau2": 0.001, "I2": 95.5},
    },
    {
        "name": "Normand specialist – MN (REML)",
        "type": "MN", "tau": "REML", "data": NORMAND_SPECIALIST,
        "expected": {
            "yi": [55, 27, 64, 66, 14, 19, 52, 21, 30],
            "FE": 27.170, "RE": 38.325, "tau2": 408.928, "I2": 98.67},
    },
    {
        "name": "Normand specialist – MNLN (REML)",
        "type": "MNLN", "tau": "REML", "data": NORMAND_SPECIALIST,
        "expected": {
            "yi": [4.0073, 3.2958, 4.1589, 4.1897, 2.6391, 2.9444, 3.9512, 3.0445, 3.4012],
            "FE": 3.694, "RE": 3.523, "tau2": 0.316, "I2": 98.9},
    },
    {
        "name": "Synthetic variability – CVR (DL)",
        "type": "CVR", "tau": "DL", "data": CVR_DATA,
        "expected": {
            "yi": [0.5638, 0.6152, 0.5573, 0.5814, 0.5001],
            "FE": 0.569, "RE": 0.569, "tau2": 0.000, "I2": 0.0},
    },
    {
        "name": "Synthetic variability – VR (DL)",
        "type": "VR", "tau": "DL", "data": VR_DATA,
        "expected": {
            "yi": [0.4055, 0.5416, 0.4187, 0.4220, 0.3365],
            "FE": 0.430, "RE": 0.430, "tau2": 0.000, "I2": 0.0},
    },
    {
        "name": "Synthetic – GOR (DL)",
        "type": "GOR", "tau": "DL", "data": GOR_DATA,
        "expected": {
            "yi": [1.0316, 1.0385, 0.7985, 1.0822],
            "FE": 0.981, "RE": 0.981, "tau2": 0.000, "I2": 0.0},
    },
    {
        "name": "Synthetic – PCOR (raw partial correlation, DL)",
        "type": "PCOR", "tau": "DL", "data": PCOR_DATA,
        "expected": {
            "yi": [0.4500, 0.3800, 0.5200, 0.3100, 0.4700],
            "FE": 0.446, "RE": 0.446, "tau2": 0.000, "I2": 0.0},
    },
    {
        "name": "Synthetic – ZPCOR (Fisher-z partial correlation, DL)",
        "type": "ZPCOR", "tau": "DL", "data": PCOR_DATA,
        "expected": {
            "yi": [0.4847, 0.4001, 0.5763, 0.3205, 0.5101],
            "FE": 0.470, "RE": 0.470, "tau2": 0.000, "I2": 0.0},
    },
    {
        "name": "Synthetic – RTET (tetrachoric correlation, DL)",
        "type": "RTET", "tau": "DL", "data": RTET_DATA,
        "expected": {
            "yi": [0.8090, 0.6545, 0.7765, 0.7485],
            "FE": 0.756, "RE": 0.756, "tau2": 0.000, "I2": 0.0},
    },
    {
        "name": "Synthetic – log-RR ciMethod=KH (DL)",
        "type": "RR", "tau": "DL", "ci": "KH", "data": CI_DATASET,
        "expected": {
            "yi":    [-0.6931, -0.2231, -1.2528, 0.2231, -0.8473],
            "FE":    -0.476, "RE":   -0.536, "tau2": 0.239, "I2": 74.1,
            "ciLow": -1.245, "ciHigh": 0.172},
    },
    {
        "name": "Synthetic – log-RR ciMethod=t (DL)",
        "type": "RR", "tau": "DL", "ci": "t", "data": CI_DATASET,
        "expected": {
            "yi":    [-0.6931, -0.2231, -1.2528, 0.2231, -0.8473],
            "FE":    -0.476, "RE":   -0.536, "tau2": 0.239, "I2": 74.1,
            "ciLow": -1.242, "ciHigh": 0.170},
    },
    {
        "name": "Synthetic – log-RR ciMethod=PL (REML)",
        "type": "RR", "tau": "REML", "ci": "PL", "data": CI_DATASET,
        "expected": {
            "yi":    [-0.6931, -0.2231, -1.2528, 0.2231, -0.8473],
            "FE":    -0.476, "RE":   -0.537, "tau2": 0.241, "I2": 74.1,
            "ciLow": -1.095, "ciHigh": 0.003},
    },
]

# ============================================================= influence data =

# Synthetic 5-study log-RR dataset (matches benchmarks.js INFLUENCE_BENCHMARKS)
# Data: (a, b, c, d) for 2×2 tables; yi = log(RR) = log((a/(a+b))/(c/(c+d)))
_INF_DATA = [
    (15, 85, 30, 70),
    (20, 80, 25, 75),
    (10, 90, 35, 65),
    (25, 75, 20, 80),
    (12, 88, 28, 72),
]

def _compute_inf_studies():
    yi_list, vi_list = [], []
    for (a, b, c, d) in _INF_DATA:
        n1, n2 = a + b, c + d
        yi = math.log((a / n1) / (c / n2))
        vi = max(1/a - 1/n1 + 1/c - 1/n2, MIN_VAR)
        yi_list.append(yi)
        vi_list.append(vi)
    return yi_list, vi_list


INFLUENCE_BENCHMARKS = [
    {
        "name": "Synthetic – log-RR influence diagnostics (DL)",
        "method": "DL",
        "expected": [
            {
                "label": "Study 1",
                "RE_loo": -0.5027, "tau2_loo": 0.3298, "hat": 0.2030,
                "cookD": 0.0176, "stdResidual": -0.2778, "DFBETA": -0.1045,
                "deltaTau2": -0.0913,
                "outlier": False, "influential": False,
                "highLeverage": False, "highCookD": False,
            },
            {
                "label": "Study 2",
                "RE_loo": -0.6244, "tau2_loo": 0.3283, "hat": 0.2096,
                "cookD": 0.1199, "stdResidual": 0.5639, "DFBETA": 0.2727,
                "deltaTau2": -0.0898,
                "outlier": False, "influential": False,
                "highLeverage": False, "highCookD": False,
            },
            {
                "label": "Study 3",
                "RE_loo": -0.3679, "tau2_loo": 0.1542, "hat": 0.1863,
                "cookD": 0.4390, "stdResidual": -1.2159, "DFBETA": -0.6975,
                "deltaTau2": 0.0843,
                "outlier": False, "influential": False,
                "highLeverage": False, "highCookD": False,
            },
            {
                "label": "Study 4",
                "RE_loo": -0.7251, "tau2_loo": 0.0958, "hat": 0.2096,
                "cookD": 0.5507, "stdResidual": 1.3674, "DFBETA": 0.8799,
                "deltaTau2": 0.1427,
                "outlier": False, "influential": False,
                "highLeverage": False, "highCookD": False,
            },
            {
                "label": "Study 5",
                "RE_loo": -0.4658, "tau2_loo": 0.2881, "hat": 0.1915,
                "cookD": 0.0770, "stdResidual": -0.5351, "DFBETA": -0.2322,
                "deltaTau2": -0.0496,
                "outlier": False, "influential": False,
                "highLeverage": False, "highCookD": False,
            },
        ],
    },
]

# ============================================================= pub-bias fns =

def _wls_2(xs, ys, ws):
    """WLS for model y = b0 + b1*x, returning (b0, b1, vcov_2x2) or None if singular.
    vcov_2x2 = (X'WX)^-1 (unscaled; caller multiplies by s2 for standard errors)."""
    sw   = sum(ws)
    swx  = sum(w * x for w, x in zip(ws, xs))
    swx2 = sum(w * x * x for w, x in zip(ws, xs))
    swy  = sum(w * y for w, y in zip(ws, ys))
    swxy = sum(w * x * y for w, x, y in zip(ws, xs, ys))
    det  = sw * swx2 - swx * swx
    if abs(det) < 1e-15:
        return None
    # (X'WX)^-1 = [[swx2, -swx], [-swx, sw]] / det
    b0  = (swx2 * swy  - swx  * swxy) / det
    b1  = (sw   * swxy - swx  * swy ) / det
    v00 = swx2 / det
    v01 = -swx  / det
    v11 = sw    / det
    return b0, b1, v00, v01, v11


def _egger_test(yi_list, vi_list):
    """OLS regression of Z = yi/se on X = 1/se; returns (intercept, slope, se, t, df, p)."""
    k = len(yi_list)
    if k < 3:
        return dict(intercept=float("nan"), slope=float("nan"), se=float("nan"),
                    t=float("nan"), df=k - 2, p=float("nan"))
    se_list = [math.sqrt(v) for v in vi_list]
    Z = [y / s for y, s in zip(yi_list, se_list)]
    X = [1.0 / s for s in se_list]
    meanX = sum(X) / k
    meanZ = sum(Z) / k
    num = sum((X[i] - meanX) * (Z[i] - meanZ) for i in range(k))
    den = sum((X[i] - meanX) ** 2 for i in range(k))
    if den == 0:
        return dict(intercept=float("nan"), slope=float("nan"), se=float("nan"),
                    t=float("nan"), df=k - 2, p=float("nan"))
    slope     = num / den
    intercept = meanZ - slope * meanX
    rss = sum((Z[i] - intercept - slope * X[i]) ** 2 for i in range(k))
    df  = k - 2
    se  = math.sqrt(rss / df) * math.sqrt(1.0 / k + meanX * meanX / den)
    t   = intercept / se if se > 0 else float("nan")
    p   = 2.0 * (1.0 - _t_cdf(abs(t), df)) if math.isfinite(t) else float("nan")
    return dict(intercept=intercept, slope=slope, se=se, t=t, df=df, p=p)


def _begg_test(yi_list, vi_list):
    """Kendall τ_b between yi and vi, continuity-corrected z, two-tailed p."""
    k = len(yi_list)
    if k < 3:
        return dict(tau=float("nan"), S=float("nan"), z=float("nan"), p=float("nan"))
    # adj = yi (FE centering cancels in pairwise sign products)
    adj = list(yi_list)
    S = 0
    for i in range(k - 1):
        for j in range(i + 1, k):
            S += (1 if adj[i] > adj[j] else -1 if adj[i] < adj[j] else 0) * \
                 (1 if vi_list[i] > vi_list[j] else -1 if vi_list[i] < vi_list[j] else 0)

    def _tie_stats(vals):
        counts = {}
        for v in vals:
            counts[v] = counts.get(v, 0) + 1
        var_term = 0
        pairs    = 0
        for t in counts.values():
            if t > 1:
                var_term += t * (t - 1) * (2 * t + 5)
                pairs    += t * (t - 1) // 2
        return var_term, pairs

    varT_adj, pairsX = _tie_stats(adj)
    varT_vi,  pairsY = _tie_stats(vi_list)
    varS = (k * (k - 1) * (2 * k + 5) - varT_adj - varT_vi) / 18
    if S == 0 or varS <= 0:
        z = 0.0
    else:
        z = (abs(S) - 1) / math.sqrt(varS) * (1 if S > 0 else -1)
    p   = 2.0 * (1.0 - _normal_cdf_as(abs(z)))
    p0  = k * (k - 1) / 2
    denom = math.sqrt((p0 - pairsX) * (p0 - pairsY))
    tau = S / denom if denom > 0 else 0.0
    return dict(tau=tau, S=S, z=z, p=p)


def _fat_pet_test(yi_list, vi_list):
    """WLS regression of yi on [1, se]; w = 1/vi. Returns intercept/slope/p."""
    k = len(yi_list)
    if k < 3:
        return dict(intercept=float("nan"), interceptP=float("nan"),
                    slope=float("nan"), slopeP=float("nan"), df=k - 2)
    se_list = [math.sqrt(v) for v in vi_list]
    ws      = [1.0 / v for v in vi_list]
    res = _wls_2(se_list, yi_list, ws)
    if res is None:
        return dict(intercept=float("nan"), interceptP=float("nan"),
                    slope=float("nan"), slopeP=float("nan"), df=k - 2)
    b0, b1, v00, v01, v11 = res
    df  = k - 2
    rss = sum(ws[i] * (yi_list[i] - b0 - b1 * se_list[i]) ** 2 for i in range(k))
    s2  = rss / df
    se0 = math.sqrt(s2 * v00)
    se1 = math.sqrt(s2 * v11)
    t0  = b0 / se0
    t1  = b1 / se1
    p0  = 2.0 * (1.0 - _t_cdf(abs(t0), df))
    p1  = 2.0 * (1.0 - _t_cdf(abs(t1), df))
    return dict(intercept=b0, interceptP=p0, slope=b1, slopeP=p1, df=df)


def _fail_safe_n(yi_list, vi_list, alpha=0.05, trivial=0.1):
    """Rosenthal fail-safe N and Orwin fail-safe N."""
    k = len(yi_list)
    sumZ = sum(abs(y) / math.sqrt(v) for y, v in zip(yi_list, vi_list))
    # z_crit: normal quantile at 1-alpha (one-tailed, Rosenthal convention)
    z_crit = _normal_quantile(1.0 - alpha)
    rosenthal = max(0.0, (sumZ / z_crit) ** 2 - k)
    ws  = [1.0 / v for v in vi_list]
    W   = sum(ws)
    FE  = sum(w * y for w, y in zip(ws, yi_list)) / W
    orwin = max(0.0, k * (abs(FE) - abs(trivial)) / abs(trivial))
    return dict(rosenthal=rosenthal, orwin=orwin)


def _harbord_test(data):
    """OLS of (O−E)/√V on √V for 2×2 tables (Harbord 2006)."""
    ys, xs = [], []
    for s in data:
        a, b, c, d = s["a"], s["b"], s["c"], s["d"]
        N = a + b + c + d
        if N < 2:
            continue
        V = (a + b) * (c + d) * (a + c) * (b + d) / (N * N * (N - 1))
        if V <= 0:
            continue
        sqrtV = math.sqrt(V)
        E = (a + b) * (a + c) / N
        ys.append((a - E) / sqrtV)
        xs.append(sqrtV)
    k = len(ys)
    if k < 3:
        return dict(intercept=float("nan"), interceptP=float("nan"), df=k - 2)
    ws  = [1.0] * k   # OLS = uniform weights
    res = _wls_2(xs, ys, ws)
    if res is None:
        return dict(intercept=float("nan"), interceptP=float("nan"), df=k - 2)
    b0, b1, v00, v01, v11 = res
    df  = k - 2
    rss = sum((ys[i] - b0 - b1 * xs[i]) ** 2 for i in range(k))
    s2  = rss / df
    se0 = math.sqrt(s2 * v00)
    t0  = b0 / se0
    p0  = 2.0 * (1.0 - _t_cdf(abs(t0), df))
    return dict(intercept=b0, interceptP=p0, df=df)


def _peters_test(data, yi_list, vi_list):
    """WLS of yi on 1/N with 1/vi weights (Peters 2006)."""
    entries = []
    for s, y, v in zip(data, yi_list, vi_list):
        a, b, c, d = s.get("a"), s.get("b"), s.get("c"), s.get("d")
        if a is not None and b is not None and c is not None and d is not None:
            N = a + b + c + d
        elif s.get("n") is not None:
            N = s["n"]
        else:
            continue
        if N < 2:
            continue
        entries.append((y, v, N))
    k = len(entries)
    if k < 3:
        return dict(intercept=float("nan"), interceptP=float("nan"), df=k - 2)
    ys  = [e[0] for e in entries]
    ws  = [1.0 / e[1] for e in entries]
    xs  = [1.0 / e[2] for e in entries]
    res = _wls_2(xs, ys, ws)
    if res is None:
        return dict(intercept=float("nan"), interceptP=float("nan"), df=k - 2)
    b0, b1, v00, v01, v11 = res
    df  = k - 2
    rss = sum(ws[i] * (ys[i] - b0 - b1 * xs[i]) ** 2 for i in range(k))
    s2  = rss / df
    se0 = math.sqrt(s2 * v00)
    t0  = b0 / se0
    p0  = 2.0 * (1.0 - _t_cdf(abs(t0), df))
    return dict(intercept=b0, interceptP=p0, df=df)


def _trim_fill(yi_list, vi_list, method="DL", max_iter=100):
    """Duval-Tweedie L0 trim-and-fill; returns (k0, adjusted_RE)."""
    k = len(yi_list)
    if k < 3:
        return 0, pool(yi_list, vi_list, method)[1]

    studies = list(zip(yi_list, vi_list))

    def _re(yl, vl):
        return pool(yl, vl, method)[1]

    def _assign_ranks(devs):
        indexed = sorted(enumerate(devs), key=lambda iv: abs(iv[1]))
        ranks = [0] * len(devs)
        for ri, (i, _) in enumerate(indexed):
            ranks[i] = ri + 1
        return ranks

    def _estimate_k0(yl, vl, center):
        d = [y - center for y in yl]
        ranks = _assign_ranks(d)
        n_right = sum(1 for di in d if di > 0)
        n_left  = sum(1 for di in d if di < 0)
        larger_is_right = n_right >= n_left
        Tn = sum(ranks[i] for i, di in enumerate(d) if (di > 0) == larger_is_right)
        raw = (4 * Tn - k * (k + 1) / 2) / (2 * k - 1)
        return max(0, round(raw))

    center = _re(yi_list, vi_list)
    k0 = 0

    for _ in range(max_iter):
        k0_new = _estimate_k0(yi_list, vi_list, center)
        if k0_new == k0:
            break
        k0 = k0_new
        if k0 == 0:
            break
        d = [(s[0] - center, i) for i, s in enumerate(studies)]
        n_right = sum(1 for di, _ in d if di > 0)
        n_left  = sum(1 for di, _ in d if di < 0)
        larger_is_right = n_right >= n_left
        side = [(di, i) for di, i in d if (di > 0) == larger_is_right]
        side.sort(key=lambda x: -abs(x[0]))
        to_trim = {i for _, i in side[:k0]}
        trimmed = [(y, v) for i, (y, v) in enumerate(studies) if i not in to_trim]
        if len(trimmed) < 1:
            break
        center = _re([s[0] for s in trimmed], [s[1] for s in trimmed])

    if k0 == 0:
        return 0, _re(yi_list, vi_list)

    # Mirror imputation
    d = [(s[0] - center, i) for i, s in enumerate(studies)]
    n_right = sum(1 for di, _ in d if di > 0)
    n_left  = sum(1 for di, _ in d if di < 0)
    larger_is_right = n_right >= n_left
    side = [(di, i) for di, i in d if (di > 0) == larger_is_right]
    side.sort(key=lambda x: -abs(x[0]))
    to_mirror = side[:k0]

    filled_yl = list(yi_list)
    filled_vl = list(vi_list)
    for _, i in to_mirror:
        filled_yl.append(2 * center - studies[i][0])
        filled_vl.append(studies[i][1])

    adjusted_RE = _re(filled_yl, filled_vl)
    return k0, adjusted_RE


# ============================================================ pub-bias data =

PUB_BIAS_BENCHMARKS = [
    {
        "name": "BCG Vaccine – pub bias (log OR, DL, 13 studies)",
        "type": "OR",
        "tau": "DL",
        "data": [
            {"a":   4, "b":   119, "c":  11, "d":   128},
            {"a":   6, "b":   300, "c":  29, "d":   274},
            {"a":   3, "b":   228, "c":  11, "d":   209},
            {"a":  62, "b": 13536, "c": 248, "d": 12619},
            {"a":  33, "b":  5036, "c":  47, "d":  5761},
            {"a": 180, "b":  1361, "c": 372, "d":  1079},
            {"a":   8, "b":  2537, "c":  10, "d":   619},
            {"a": 505, "b": 87886, "c": 499, "d": 87892},
            {"a":  29, "b":  7470, "c":  45, "d":  7232},
            {"a":  17, "b":  1699, "c":  65, "d":  1600},
            {"a": 186, "b": 50448, "c": 141, "d": 27197},
            {"a":   5, "b":  2493, "c":   3, "d":  2338},
            {"a":  27, "b": 16886, "c":  29, "d": 17825},
        ],
        "tests": {
            "begg":     {"tau": -0.128, "S": -10, "z": -0.549, "p": 0.583},
            "egger":    {"intercept": -2.345, "slope": -0.157, "p": 0.160},
            "fatPet":   {"intercept": -0.157, "interceptP": 0.521,
                         "slope": -2.345, "slopeP": 0.160},
            "failSafe": {"rosenthal": 656, "orwin": 44},
            "harbord":  {"intercept": -2.093, "interceptP": 0.235},
            "peters":   {"intercept": -0.357, "interceptP": 0.045},
            "trimFill": {"k0": 10, "adjustedRE": 0.025},
        },
    },
    {
        "name": "Synthetic asymmetric funnel (k=6)",
        "type": "GENERIC",
        "tau": "DL",
        "data": [
            {"yi": -0.1, "vi": 0.0400},
            {"yi":  0.3, "vi": 0.0900},
            {"yi":  0.1, "vi": 0.0225},
            {"yi":  0.9, "vi": 0.3600},
            {"yi":  1.4, "vi": 0.6400},
            {"yi":  0.5, "vi": 0.1600},
        ],
        "tests": {
            "egger": {"intercept": 1.917, "slope": -0.286, "se": 0.504,
                      "t": 3.804, "df": 4, "p": 0.019},
        },
    },
]

# =================================================================== runner =

# Tolerances mirror tests.js approxEqual():
#   FE, RE : abs < 0.01
#   tau2   : |got-exp| / max(|exp|, 0.001) < 0.05
#   I2     : abs < 0.2 pp
#   yi     : abs < 0.001

def approx_equal(got, exp, field):
    if field == "tau2":
        scale = max(abs(exp), 0.001)
        return abs(got - exp) / scale < 0.05
    if field == "I2":
        return abs(got - exp) < 0.2
    if field == "yi":
        return abs(got - exp) < 0.001
    return abs(got - exp) < 0.01  # FE, RE

def run_all():
    passed = failed = 0
    for bm in BENCHMARKS:
        name      = bm["name"]
        typ       = bm["type"]
        method    = bm["tau"]
        ci_method = bm.get("ci", "normal")
        data      = bm["data"]
        exp       = bm["expected"]

        pairs   = COMPUTE_FN[typ](data)
        yi_list = [p[0] for p in pairs]
        vi_list = [p[1] for p in pairs]

        FE, RE, t2, I2 = pool(yi_list, vi_list, method)

        errors = []

        if "yi" in exp:
            for i, (got_y, exp_y) in enumerate(zip(yi_list, exp["yi"])):
                if not approx_equal(got_y, exp_y, "yi"):
                    errors.append(f"yi[{i}]: got {got_y:.4f}, exp {exp_y:.4f}")

        for key, got_val in [("FE", FE), ("RE", RE), ("tau2", t2), ("I2", I2)]:
            if key in exp:
                if not approx_equal(got_val, exp[key], key):
                    errors.append(
                        f"{key}: got {got_val:.4f}, exp {exp[key]:.4f}"
                    )

        if "ciLow" in exp or "ciHigh" in exp:
            ci_lo, ci_hi = compute_ci(yi_list, vi_list, method, ci_method)
            if "ciLow" in exp and not approx_equal(ci_lo, exp["ciLow"], "FE"):
                errors.append(f"ciLow: got {ci_lo:.4f}, exp {exp['ciLow']:.4f}")
            if "ciHigh" in exp and not approx_equal(ci_hi, exp["ciHigh"], "FE"):
                errors.append(f"ciHigh: got {ci_hi:.4f}, exp {exp['ciHigh']:.4f}")

        if errors:
            failed += 1
            print(f"FAIL  {name}")
            for e in errors:
                print(f"      {e}")
        else:
            passed += 1
            print(f"pass  {name}")

    # ---- influence benchmarks ----
    for bm in INFLUENCE_BENCHMARKS:
        bm_name = bm["name"]
        method  = bm["method"]
        yi_list, vi_list = _compute_inf_studies()
        diag = influence_diagnostics(yi_list, vi_list, method)
        k = len(diag)

        for i, (d, exp) in enumerate(zip(diag, bm["expected"])):
            label = exp.get("label", f"Study {i+1}")
            errs  = []

            # Continuous fields — abs tolerance 0.001 (tighter for tau2: 5% relative)
            for key in ("RE_loo", "hat", "cookD", "stdResidual", "DFBETA"):
                if key in exp:
                    tol = 0.005 if key == "cookD" else 0.001
                    if abs(d[key] - exp[key]) > tol:
                        errs.append(f"{key}: got {d[key]:.4f}, exp {exp[key]:.4f}")
            if "tau2_loo" in exp:
                scale = max(abs(exp["tau2_loo"]), 0.001)
                if abs(d["tau2_loo"] - exp["tau2_loo"]) / scale > 0.05:
                    errs.append(f"tau2_loo: got {d['tau2_loo']:.4f}, exp {exp['tau2_loo']:.4f}")
            if "deltaTau2" in exp:
                scale = max(abs(exp["deltaTau2"]), 0.001)
                if abs(d["deltaTau2"] - exp["deltaTau2"]) / scale > 0.05:
                    errs.append(f"deltaTau2: got {d['deltaTau2']:.4f}, exp {exp['deltaTau2']:.4f}")

            # Boolean flags — exact
            for key in ("outlier", "influential", "highLeverage", "highCookD"):
                if key in exp and d[key] != exp[key]:
                    errs.append(f"{key}: got {d[key]}, exp {exp[key]}")

            entry_name = f"{bm_name} | {label}"
            if errs:
                failed += 1
                print(f"FAIL  {entry_name}")
                for e in errs:
                    print(f"      {e}")
            else:
                passed += 1
                print(f"pass  {entry_name}")

    # ---- pub-bias benchmarks (Phase 6) ----
    for bm in PUB_BIAS_BENCHMARKS:
        bm_name = bm["name"]
        method  = bm["tau"]
        data    = bm["data"]
        tsts    = bm["tests"]

        pairs   = COMPUTE_FN[bm["type"]](data)
        yi_list = [p[0] for p in pairs]
        vi_list = [p[1] for p in pairs]

        def _chk(label, got, exp, tol=0.01):
            nonlocal passed, failed
            if not math.isfinite(got) or not math.isfinite(exp):
                ok = (not math.isfinite(got)) and (not math.isfinite(exp))
            else:
                ok = abs(got - exp) <= tol
            entry = f"{bm_name} | {label}"
            if ok:
                passed += 1
                print(f"pass  {entry}")
            else:
                failed += 1
                print(f"FAIL  {entry}")
                print(f"      got {got:.4f}, exp {exp:.4f}")

        if "egger" in tsts:
            r = _egger_test(yi_list, vi_list)
            exp = tsts["egger"]
            _chk("egger.intercept", r["intercept"], exp["intercept"])
            _chk("egger.slope",     r["slope"],     exp["slope"])
            if "se" in exp:
                _chk("egger.se",   r["se"],         exp["se"])
            if "t" in exp:
                _chk("egger.t",    r["t"],           exp["t"])
            if "df" in exp:
                _chk("egger.df",   float(r["df"]),   float(exp["df"]), tol=0)
            _chk("egger.p",        r["p"],           exp["p"])

        if "begg" in tsts:
            r = _begg_test(yi_list, vi_list)
            exp = tsts["begg"]
            _chk("begg.tau", r["tau"], exp["tau"])
            _chk("begg.S",   float(r["S"]), float(exp["S"]), tol=0)
            _chk("begg.z",   r["z"],   exp["z"])
            _chk("begg.p",   r["p"],   exp["p"])

        if "fatPet" in tsts:
            r = _fat_pet_test(yi_list, vi_list)
            exp = tsts["fatPet"]
            _chk("fatPet.intercept",  r["intercept"],  exp["intercept"])
            _chk("fatPet.interceptP", r["interceptP"], exp["interceptP"])
            _chk("fatPet.slope",      r["slope"],      exp["slope"])
            _chk("fatPet.slopeP",     r["slopeP"],     exp["slopeP"])

        if "failSafe" in tsts:
            r = _fail_safe_n(yi_list, vi_list)
            exp = tsts["failSafe"]
            _chk("failSafe.rosenthal", r["rosenthal"], exp["rosenthal"], tol=1.0)
            _chk("failSafe.orwin",     r["orwin"],     exp["orwin"],     tol=1.0)

        if "harbord" in tsts:
            r = _harbord_test(data)
            exp = tsts["harbord"]
            _chk("harbord.intercept",  r["intercept"],  exp["intercept"])
            _chk("harbord.interceptP", r["interceptP"], exp["interceptP"])

        if "peters" in tsts:
            r = _peters_test(data, yi_list, vi_list)
            exp = tsts["peters"]
            _chk("peters.intercept",  r["intercept"],  exp["intercept"])
            _chk("peters.interceptP", r["interceptP"], exp["interceptP"])

        if "trimFill" in tsts:
            k0, adj_RE = _trim_fill(yi_list, vi_list, method)
            exp = tsts["trimFill"]
            _chk("trimFill.k0",         float(k0),  float(exp["k0"]), tol=0)
            _chk("trimFill.adjustedRE", adj_RE,     exp["adjustedRE"])

    print(f"\n{passed + failed} benchmarks: {passed} passed, {failed} failed")
    return failed

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    n_failed = run_all()
    sys.exit(0 if n_failed == 0 else 1)
