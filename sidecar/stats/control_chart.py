"""Control charts: I-MR, X-bar/R, p, np, c, u, EWMA.

Each variant returns:
  {"summary": {...metrics, control limits, n}, "chart_png": bytes}
The Node analyst agent uploads chart_png and writes an LLM narrative.

Western Electric run-rule violations (rule 1 only by default — beyond 3σ):
flagged in summary.violations as a list of indices.
"""
from __future__ import annotations

import io
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from ._constants import A2, A3, B3, B4, D3, D4, c4, d2, n_to_idx


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def _plot(values, center, ucl, lcl, title, ylabel):
    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    x = np.arange(1, len(values) + 1)
    ax.plot(x, values, marker="o")
    ax.axhline(center, linestyle="-")
    ax.axhline(ucl, linestyle="--")
    ax.axhline(lcl, linestyle="--")
    ax.set_title(title)
    ax.set_xlabel("Subgroup")
    ax.set_ylabel(ylabel)
    return fig


def _violations(values, ucl, lcl):
    return [int(i) for i, v in enumerate(values) if (v > ucl or v < lcl) and not (np.isnan(v))]


# Human-readable text per rule — Minitab pops this into the chart's session
# window for every flagged observation. Without it, "rule_5: [12, 13]" is
# meaningless to anyone who hasn't memorized Nelson's table.
RULE_TEXT = {
    "rule_1": "One point beyond 3σ from the centerline",
    "rule_2": "9 points in a row on the same side of the centerline",
    "rule_3": "6 points in a row, all increasing or all decreasing",
    "rule_4": "14 points in a row, alternating up and down",
    "rule_5": "2 of 3 consecutive points beyond 2σ on the same side",
    "rule_6": "4 of 5 consecutive points beyond 1σ on the same side",
    "rule_7": "15 points in a row within 1σ of the centerline (over-control / stratification)",
    "rule_8": "8 points in a row beyond 1σ on either side (bimodal pattern)",
}
RULE_CAUSE = {
    "rule_1": "Special-cause variation — investigate that specific observation.",
    "rule_2": "Process mean has shifted.",
    "rule_3": "Trend — wear, drift, gradual contamination, learning curve.",
    "rule_4": "Cyclical pattern — alternating shifts, materials, or operators.",
    "rule_5": "Increased process variation (large special cause).",
    "rule_6": "Smaller but persistent mean shift.",
    "rule_7": "Stratification or over-adjustment — chart limits may be too wide.",
    "rule_8": "Bimodal mixture — two distinct sub-populations being plotted together.",
}


def _annotated_rules(values, center, sigma):
    """Take _we_rules() output and return a richer list-of-violations the UI
    can render verbatim: which rule, which observation, the value at that
    observation, and human-readable text. Original index-lists kept for
    back-compat with anything already consuming them."""
    raw = _we_rules(values, center, sigma)
    annotated = []
    for rule_key, indices in raw.items():
        for i in indices:
            annotated.append({
                "rule": rule_key,
                "rule_number": int(rule_key.split("_")[1]),
                "observation": int(i + 1),     # 1-indexed for end users
                "index": int(i),               # 0-indexed for chart drawing
                "value": (float(values[i]) if not np.isnan(values[i]) else None),
                "text": RULE_TEXT[rule_key],
                "likely_cause": RULE_CAUSE[rule_key],
            })
    # Stable sort: by observation then rule number — reading order.
    annotated.sort(key=lambda r: (r["observation"], r["rule_number"]))
    return annotated


def _we_rules(values, center, sigma):
    """Western Electric + Nelson run-rule violations.

    Bill flags both rule sets in one pass — Minitab makes you toggle them
    in the dialog; here you always see them. Indexes mark the LAST point
    in the violating run.

    WE rules 1–4:
      1: any point beyond ±3σ
      2: 9 consecutive points on the same side of center
      3: 6 consecutive points steadily increasing or decreasing
      4: 14 consecutive points alternating up and down
    Nelson rules 5–8 (extras Minitab adds):
      5: 2 of 3 consecutive points beyond ±2σ on the same side
      6: 4 of 5 consecutive points beyond ±1σ on the same side
      7: 15 consecutive points within ±1σ of center (stratification / over-control)
      8: 8 consecutive points outside ±1σ on either side
    """
    out = {"rule_1": [], "rule_2": [], "rule_3": [], "rule_4": [],
           "rule_5": [], "rule_6": [], "rule_7": [], "rule_8": []}
    if center is None or sigma is None or sigma == 0:
        return out
    v = np.asarray(values, dtype=float)
    n = len(v)
    for i in range(n):
        if np.isnan(v[i]):
            continue
        if v[i] > center + 3 * sigma or v[i] < center - 3 * sigma:
            out["rule_1"].append(int(i))
    # rule 2: 9 same-side
    for i in range(8, n):
        seg = v[i - 8 : i + 1]
        if np.all(seg > center) or np.all(seg < center):
            out["rule_2"].append(int(i))
    # rule 3: 6 monotone
    for i in range(5, n):
        seg = v[i - 5 : i + 1]
        if np.all(np.diff(seg) > 0) or np.all(np.diff(seg) < 0):
            out["rule_3"].append(int(i))
    # rule 4: 14 alternating
    for i in range(13, n):
        seg = np.diff(v[i - 13 : i + 1])
        signs = np.sign(seg)
        if np.all(signs[:-1] * signs[1:] < 0):
            out["rule_4"].append(int(i))
    # rule 5: 2 of 3 beyond ±2σ same side
    for i in range(2, n):
        seg = v[i - 2 : i + 1]
        above = np.sum(seg > center + 2 * sigma)
        below = np.sum(seg < center - 2 * sigma)
        if above >= 2 or below >= 2:
            out["rule_5"].append(int(i))
    # rule 6: 4 of 5 beyond ±1σ same side
    for i in range(4, n):
        seg = v[i - 4 : i + 1]
        above = np.sum(seg > center + sigma)
        below = np.sum(seg < center - sigma)
        if above >= 4 or below >= 4:
            out["rule_6"].append(int(i))
    # rule 7: 15 in a row within ±1σ (suspiciously controlled)
    for i in range(14, n):
        seg = v[i - 14 : i + 1]
        if np.all(np.abs(seg - center) < sigma):
            out["rule_7"].append(int(i))
    # rule 8: 8 in a row outside ±1σ either side
    for i in range(7, n):
        seg = v[i - 7 : i + 1]
        if np.all(np.abs(seg - center) > sigma):
            out["rule_8"].append(int(i))
    return out


# ---- variables charts ------------------------------------------------------

def _imr(x):
    x = np.asarray(x, dtype=float)
    mr = np.abs(np.diff(x))
    mr_bar = float(np.mean(mr)) if mr.size else 0.0
    x_bar = float(np.mean(x))
    sigma = mr_bar / 1.128
    return {
        "x_bar": x_bar, "sigma_hat": sigma, "mr_bar": mr_bar,
        "ucl_i": x_bar + 3 * sigma, "lcl_i": x_bar - 3 * sigma,
        "ucl_mr": 3.267 * mr_bar, "lcl_mr": 0.0,
    }


def _imr_chart(df, column):
    x = df[column].dropna().astype(float).to_numpy()
    lim = _imr(x)
    fig = _plot(x, lim["x_bar"], lim["ucl_i"], lim["lcl_i"],
                f"I chart — {column}", column)
    return {
        "summary": {
            "kind": "I-MR", **lim, "n": int(x.size),
            "violations": _violations(x, lim["ucl_i"], lim["lcl_i"]),
            "we_rules": _we_rules(x, lim["x_bar"], lim["sigma_hat"]),
            "rule_violations": _annotated_rules(x, lim["x_bar"], lim["sigma_hat"]),
        },
        "chart_png": _png(fig),
    }


def _xbar_r_chart(df, column, subgroup_col):
    if not subgroup_col:
        raise ValueError("the X-bar/R chart needs a subgroup column (which rows form each subgroup).")
    g = df.groupby(subgroup_col)[column].agg(list)
    subs = [np.asarray(v, dtype=float) for v in g.tolist()]
    sizes = [len(s) for s in subs]
    if not subs:
        raise ValueError("no subgroups")
    n = sizes[0]
    if not all(sz == n for sz in sizes):
        raise ValueError(f"subgroup sizes must be equal; got {set(sizes)}")
    if n < 2 or n > 25:
        raise ValueError(f"subgroup size {n} not supported")
    idx = n_to_idx(n)

    means = np.array([np.mean(s) for s in subs])
    ranges = np.array([np.ptp(s) for s in subs])
    xbb = float(np.mean(means))
    rbar = float(np.mean(ranges))

    ucl_x, lcl_x = xbb + A2[idx] * rbar, xbb - A2[idx] * rbar
    ucl_r, lcl_r = D4[idx] * rbar, D3[idx] * rbar
    sigma_hat = rbar / d2[idx]

    fig, axes = plt.subplots(2, 1, figsize=(8, 5.4))
    for ax, vals, ctr, ucl, lcl, lab in [
        (axes[0], means, xbb, ucl_x, lcl_x, f"X̄ — {column}"),
        (axes[1], ranges, rbar, ucl_r, lcl_r, f"R — {column}"),
    ]:
        ax.plot(np.arange(1, len(vals) + 1), vals, marker="o")
        ax.axhline(ctr, linestyle="-"); ax.axhline(ucl, linestyle="--"); ax.axhline(lcl, linestyle="--")
        ax.set_title(lab)
    return {
        "summary": {
            "kind": "X-bar/R", "n_subgroups": len(subs), "subgroup_size": int(n),
            "x_double_bar": xbb, "r_bar": rbar, "sigma_hat": sigma_hat,
            "ucl_x": ucl_x, "lcl_x": lcl_x, "ucl_r": ucl_r, "lcl_r": lcl_r,
            "violations_x": _violations(means, ucl_x, lcl_x),
            "violations_r": _violations(ranges, ucl_r, lcl_r),
            "we_rules_x": _we_rules(means, xbb, sigma_hat / np.sqrt(n)),
            "rule_violations": _annotated_rules(means, xbb, sigma_hat / np.sqrt(n)),
        },
        "chart_png": _png(fig),
    }


def _xbar_s_chart(df, column, subgroup_col):
    """X̄-S chart — preferred over X̄-R when subgroup size n ≥ 10.

    Uses sample standard deviation (unbiased via c4) instead of range. More
    statistically efficient for larger subgroups; matches Minitab default
    for n ≥ 9.
    """
    if not subgroup_col:
        raise ValueError("the X-bar/S chart needs a subgroup column (which rows form each subgroup).")
    g = df.groupby(subgroup_col)[column].agg(list)
    subs = [np.asarray(v, dtype=float) for v in g.tolist()]
    sizes = [len(s) for s in subs]
    if not subs:
        raise ValueError("no subgroups")
    n = sizes[0]
    if not all(sz == n for sz in sizes):
        raise ValueError(f"subgroup sizes must be equal; got {set(sizes)}")
    if n < 2 or n > 25:
        raise ValueError(f"subgroup size {n} not supported")
    idx = n_to_idx(n)

    means = np.array([float(np.mean(s)) for s in subs])
    stds  = np.array([float(np.std(s, ddof=1)) for s in subs])
    xbb = float(np.mean(means))
    sbar = float(np.mean(stds))

    ucl_x, lcl_x = xbb + A3[idx] * sbar, xbb - A3[idx] * sbar
    ucl_s, lcl_s = B4[idx] * sbar, B3[idx] * sbar
    sigma_hat = sbar / c4[idx] if c4[idx] else 0.0

    fig, axes = plt.subplots(2, 1, figsize=(8, 5.4))
    for ax, vals, ctr, ucl, lcl, lab in [
        (axes[0], means, xbb,  ucl_x, lcl_x, f"X̄ — {column}"),
        (axes[1], stds,  sbar, ucl_s, lcl_s, f"S — {column}"),
    ]:
        ax.plot(np.arange(1, len(vals) + 1), vals, marker="o")
        ax.axhline(ctr, linestyle="-")
        ax.axhline(ucl, linestyle="--")
        ax.axhline(lcl, linestyle="--")
        ax.set_title(lab)
    return {
        "summary": {
            "kind": "X-bar/S", "n_subgroups": len(subs), "subgroup_size": int(n),
            "x_double_bar": xbb, "s_bar": sbar, "sigma_hat": sigma_hat,
            "ucl_x": ucl_x, "lcl_x": lcl_x, "ucl_s": ucl_s, "lcl_s": lcl_s,
            "violations_x": _violations(means, ucl_x, lcl_x),
            "violations_s": _violations(stds, ucl_s, lcl_s),
            "we_rules_x": _we_rules(means, xbb, sigma_hat / np.sqrt(n) if n > 0 else 1.0),
            "rule_violations": _annotated_rules(means, xbb, sigma_hat / np.sqrt(n) if n > 0 else 1.0),
        },
        "chart_png": _png(fig),
    }


def _laney_p_chart(df, defects_col, n_col):
    """Laney p′ chart — p chart with overdispersion correction.

    Standard p charts under-flag (or over-flag) when binomial variation is
    not the only noise source — common with large subgroup sizes where
    even tiny systematic effects produce 'rule violations'. Laney (2002)
    inflates the limits by σ_z, the std-dev of the standardized residuals,
    so the chart reflects total variation, not just sampling.
    """
    d = df[defects_col].dropna().astype(float).to_numpy()
    if n_col and n_col in df.columns:
        n = df[n_col].dropna().astype(float).to_numpy()
    else:
        n = np.full_like(d, fill_value=float(len(d)))
    if d.size < 2 or d.size != n.size:
        raise ValueError("Laney p' needs ≥2 paired subgroups")
    p = d / n
    p_bar = float(np.sum(d) / np.sum(n))
    # Standardized residuals z_i = (p_i - p̄) / sqrt(p̄ (1-p̄) / n_i)
    base = np.sqrt(p_bar * (1 - p_bar) / n)
    z = (p - p_bar) / np.where(base == 0, 1, base)
    # Moving-range estimate of σ_z (robust to outliers vs std).
    mr = np.abs(np.diff(z))
    sigma_z = float(np.mean(mr) / 1.128) if mr.size else 1.0
    ucl = p_bar + 3 * sigma_z * base
    lcl = np.maximum(0.0, p_bar - 3 * sigma_z * base)
    fig, ax = plt.subplots(figsize=(8, 3.6))
    x = np.arange(1, len(p) + 1)
    ax.plot(x, p, marker="o")
    ax.plot(x, ucl, linestyle="--")
    ax.plot(x, lcl, linestyle="--")
    ax.axhline(p_bar, linestyle="-")
    ax.set_title(f"Laney p' — {defects_col} (σ_z = {sigma_z:.3f})")
    return {
        "summary": {
            "kind": "Laney p'", "n": int(d.size),
            "p_bar": p_bar, "sigma_z": sigma_z,
            "ucl": [float(u) for u in ucl], "lcl": [float(l) for l in lcl],
            "overdispersed": bool(sigma_z > 1.2),
            "underdispersed": bool(sigma_z < 0.8),
            "note": ("Overdispersion detected — standard p chart would over-flag." if sigma_z > 1.2
                     else "Underdispersion detected — standard p chart would under-flag." if sigma_z < 0.8
                     else "σ_z ≈ 1.0 — close to pure binomial; standard p chart would give similar limits."),
        },
        "chart_png": _png(fig),
    }


def _ewma_chart(df, column, lam=0.2, L=3.0):
    x = df[column].dropna().astype(float).to_numpy()
    if x.size < 2:
        raise ValueError("EWMA needs >=2 points")
    mu0 = float(np.mean(x))
    sigma = float(np.std(x, ddof=1)) or 1e-9
    z = np.empty_like(x)
    z[0] = mu0
    for i in range(1, len(x)):
        z[i] = lam * x[i] + (1 - lam) * z[i - 1]
    i_arr = np.arange(1, len(x) + 1)
    var = sigma * sigma * (lam / (2 - lam)) * (1 - (1 - lam) ** (2 * i_arr))
    sd = np.sqrt(var)
    ucl = mu0 + L * sd
    lcl = mu0 - L * sd
    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    ax.plot(i_arr, z, marker="o", label="EWMA")
    ax.plot(i_arr, ucl, linestyle="--", label="UCL"); ax.plot(i_arr, lcl, linestyle="--", label="LCL")
    ax.axhline(mu0, linestyle="-")
    ax.set_title(f"EWMA — {column} (λ={lam}, L={L})"); ax.legend()
    return {
        "summary": {
            "kind": "EWMA", "lambda": lam, "L": L, "mu0": mu0, "sigma": sigma,
            "violations": [int(i) for i in range(len(z)) if z[i] > ucl[i] or z[i] < lcl[i]],
            "n": int(x.size),
        },
        "chart_png": _png(fig),
    }


# ---- attribute charts ------------------------------------------------------

def _p_chart(df, defects_col, n_col):
    d = df[defects_col].astype(float).to_numpy()
    n = df[n_col].astype(float).to_numpy()
    if (n <= 0).any():
        raise ValueError("n must be positive")
    p = d / n
    pbar = float(d.sum() / n.sum())
    se = np.sqrt(pbar * (1 - pbar) / n)
    ucl = np.minimum(1.0, pbar + 3 * se)
    lcl = np.maximum(0.0, pbar - 3 * se)
    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    x = np.arange(1, len(p) + 1)
    ax.plot(x, p, marker="o"); ax.plot(x, ucl, linestyle="--"); ax.plot(x, lcl, linestyle="--")
    ax.axhline(pbar, linestyle="-")
    ax.set_title(f"p chart — {defects_col}/{n_col}")
    return {
        "summary": {
            "kind": "p", "p_bar": pbar, "n_subgroups": int(len(p)),
            "violations": [int(i) for i in range(len(p)) if p[i] > ucl[i] or p[i] < lcl[i]],
        },
        "chart_png": _png(fig),
    }


def _np_chart(df, defects_col, n_const):
    if n_const is None:
        raise ValueError("the np chart needs a constant subgroup size (n).")
    d = df[defects_col].astype(float).to_numpy()
    n = float(n_const)
    pbar = float(d.sum() / (n * len(d)))
    npbar = n * pbar
    se = math.sqrt(n * pbar * (1 - pbar))
    ucl = npbar + 3 * se
    lcl = max(0.0, npbar - 3 * se)
    fig = _plot(d, npbar, ucl, lcl, f"np chart — {defects_col}", "defects")
    return {
        "summary": {
            "kind": "np", "n": n, "np_bar": npbar, "ucl": ucl, "lcl": lcl,
            "violations": _violations(d, ucl, lcl), "n_subgroups": int(len(d)),
        },
        "chart_png": _png(fig),
    }


def _c_chart(df, defects_col):
    c = df[defects_col].astype(float).to_numpy()
    cbar = float(np.mean(c))
    ucl = cbar + 3 * math.sqrt(cbar)
    lcl = max(0.0, cbar - 3 * math.sqrt(cbar))
    fig = _plot(c, cbar, ucl, lcl, f"c chart — {defects_col}", "defects/unit")
    return {
        "summary": {
            "kind": "c", "c_bar": cbar, "ucl": ucl, "lcl": lcl,
            "violations": _violations(c, ucl, lcl), "n_subgroups": int(len(c)),
        },
        "chart_png": _png(fig),
    }


def _u_chart(df, defects_col, n_col):
    c = df[defects_col].astype(float).to_numpy()
    n = df[n_col].astype(float).to_numpy()
    if (n <= 0).any():
        raise ValueError("n must be positive")
    u = c / n
    ubar = float(c.sum() / n.sum())
    se = np.sqrt(ubar / n)
    ucl = ubar + 3 * se; lcl = np.maximum(0.0, ubar - 3 * se)
    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    x = np.arange(1, len(u) + 1)
    ax.plot(x, u, marker="o"); ax.plot(x, ucl, linestyle="--"); ax.plot(x, lcl, linestyle="--")
    ax.axhline(ubar, linestyle="-")
    ax.set_title(f"u chart — {defects_col}/{n_col}")
    return {
        "summary": {
            "kind": "u", "u_bar": ubar, "n_subgroups": int(len(u)),
            "violations": [int(i) for i in range(len(u)) if u[i] > ucl[i] or u[i] < lcl[i]],
        },
        "chart_png": _png(fig),
    }


# ---- CUSUM and Moving Average ---------------------------------------------

def _cusum_chart(df, column, target=None, k=0.5, h=4.0):
    """Tabular CUSUM (V-mask alternative). Detects small persistent shifts
    that Shewhart I-MR misses. Defaults follow Minitab's convention: k = 0.5σ
    (allowance), h = 4σ (decision interval). Both expressed in σ units.

    Returns the upper / lower CUSUM series, the limits, and the indices
    where each side first crosses h."""
    x = df[column].dropna().astype(float).to_numpy()
    if x.size < 4:
        raise ValueError("CUSUM requires at least 4 observations")
    sigma = float(np.std(x, ddof=1))
    if sigma == 0:
        raise ValueError("CUSUM: zero variance")
    mu = float(np.mean(x)) if target is None else float(target)
    K = float(k) * sigma
    H = float(h) * sigma
    n = x.size
    Cp = np.zeros(n); Cm = np.zeros(n)
    for i in range(n):
        prev_p = Cp[i - 1] if i else 0.0
        prev_m = Cm[i - 1] if i else 0.0
        Cp[i] = max(0.0, x[i] - (mu + K) + prev_p)
        Cm[i] = max(0.0, (mu - K) - x[i] + prev_m)
    upper_violations = [int(i) for i in range(n) if Cp[i] > H]
    lower_violations = [int(i) for i in range(n) if Cm[i] > H]

    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    xs = np.arange(1, n + 1)
    ax.plot(xs, Cp, marker="o", label="C+")
    ax.plot(xs, -Cm, marker="o", label="C-")
    ax.axhline(H, linestyle="--")
    ax.axhline(-H, linestyle="--")
    ax.axhline(0, linestyle="-")
    ax.set_title(f"CUSUM — {column} (target {mu:.3f}, k={k}σ, h={h}σ)")
    ax.set_xlabel("Sample")
    ax.set_ylabel("Cumulative deviation")
    ax.legend(loc="best")
    return {
        "summary": {
            "kind": "CUSUM",
            "target": mu, "sigma": sigma, "k": k, "h": h,
            "n": int(n),
            "upper_violations": upper_violations,
            "lower_violations": lower_violations,
            "first_upper_violation": upper_violations[0] if upper_violations else None,
            "first_lower_violation": lower_violations[0] if lower_violations else None,
        },
        "chart_png": _png(fig),
    }


def _ma_chart(df, column, w=5):
    """Moving-average chart with span w. Like EWMA, smooths short-run noise
    but uses an unweighted window. Useful when small mean shifts matter
    and the underlying process is mostly stable."""
    x = df[column].dropna().astype(float).to_numpy()
    n = x.size
    if n < w + 1:
        raise ValueError(f"MA chart with w={w} requires at least {w + 1} points")
    sigma = float(np.std(x, ddof=1))
    mu = float(np.mean(x))
    ma = np.full(n, np.nan)
    for i in range(w - 1, n):
        ma[i] = np.mean(x[i - w + 1 : i + 1])
    ucl = mu + 3 * sigma / np.sqrt(w)
    lcl = mu - 3 * sigma / np.sqrt(w)
    violations = [int(i) for i in range(w - 1, n) if ma[i] > ucl or ma[i] < lcl]
    fig = _plot(np.where(np.isnan(ma), mu, ma), mu, ucl, lcl,
                f"Moving Average — {column} (w={w})", "MA")
    return {
        "summary": {
            "kind": "MA", "w": int(w), "center": mu, "ucl": float(ucl), "lcl": float(lcl),
            "sigma": sigma, "n": int(n), "violations": violations,
        },
        "chart_png": _png(fig),
    }


# ---- dispatcher -----------------------------------------------------------

def _phased(df, kind: str, params: dict) -> dict:
    """Phase analysis — split a chart at known process changes so each
    phase has its own center line and limits. params['phase_col'] names
    the column whose distinct values define the phases (in row order).
    For each phase we compute the limits on its own data and concatenate
    the points into one figure.
    """
    phase_col = params.get("phase_col")
    if not phase_col or phase_col not in df.columns:
        raise ValueError("phase analysis requires a phase_col")
    column = params.get("column")
    phases = df[phase_col].astype(str).tolist()
    # Group consecutive runs of the same phase value (preserves order).
    phase_segments = []
    cur = None
    cur_start = 0
    for i, p in enumerate(phases):
        if p != cur:
            if cur is not None:
                phase_segments.append((cur, cur_start, i))
            cur, cur_start = p, i
    if cur is not None:
        phase_segments.append((cur, cur_start, len(phases)))

    # Compute limits per phase using the requested chart kind, then
    # render a combined PNG with phase-coloured backgrounds.
    fig, ax = plt.subplots(figsize=(8.5, 3.8))
    summaries = []
    for phase, lo, hi in phase_segments:
        sub = df.iloc[lo:hi]
        if kind == "I-MR":
            r = _imr_chart(sub, column)
        elif kind == "X-bar/R":
            r = _xbar_r_chart(sub, column, params.get("subgroup_col") or params.get("group_col"))
        else:
            raise ValueError(f"phase analysis for {kind} not yet supported")
        s = r["summary"]
        s["phase"] = phase
        s["start_index"] = lo
        s["end_index"] = hi
        summaries.append(s)
        # Plot the phase segment.
        x = np.arange(lo + 1, hi + 1)
        ax.plot(x, sub[column].astype(float).to_numpy(), marker="o", markersize=4)
        if "ucl" in s and "lcl" in s and "center" in s:
            ax.hlines(s["center"], lo + 1, hi, linestyles="-")
            ax.hlines(s["ucl"], lo + 1, hi, linestyles="--")
            ax.hlines(s["lcl"], lo + 1, hi, linestyles="--")
        ax.axvspan(lo + 0.5, hi + 0.5, alpha=0.05)
        ax.text((lo + hi) / 2 + 0.5, ax.get_ylim()[1], f" {phase}", va="top")
    ax.set_title(f"{kind} — phased")
    return {"summary": {"kind": kind, "phased": True, "phases": summaries},
            "chart_png": _png(fig)}


def _g_chart(df, count_col):
    """G chart — rare-event control chart for the *number of opportunities
    between events* (e.g. units produced between two defectives, days between
    infections). Models the counts as geometric and uses probability-based
    control limits (Benneyan 2001), because the geometric distribution is too
    skewed for symmetric 3σ limits. Default tail probability 0.00135 matches
    the 3σ false-alarm rate of a Shewhart chart.
    """
    g = df[count_col].dropna().astype(float).to_numpy()
    if len(g) < 2:
        raise ValueError("G chart needs at least 2 between-event counts")
    if np.any(g < 0):
        raise ValueError("between-event counts must be ≥ 0")
    from scipy.stats import geom
    gbar = float(np.mean(g))
    # Geometric on support {0,1,2,…} (failures before the event): mean = (1-p)/p
    # ⇒ p̂ = 1/(ḡ + 1). scipy's geom is on {1,2,…}, so shift by 1.
    p_hat = 1.0 / (gbar + 1.0)
    alpha_tail = 0.00135
    ucl = float(geom.ppf(1 - alpha_tail, p_hat) - 1)
    lcl = max(0.0, float(geom.ppf(alpha_tail, p_hat) - 1))
    fig = _plot(g, gbar, ucl, lcl, f"G chart — {count_col}", "opportunities between events")
    return {
        "summary": {
            "kind": "G", "g_bar": gbar, "p_hat": p_hat, "ucl": ucl, "lcl": lcl,
            "center": gbar, "violations": _violations(g, ucl, lcl),
            "n_events": int(len(g)),
            "note": "Higher counts = longer gaps between events = better. A point above the UCL is good news (rare improvement); below the LCL flags a cluster of events.",
        },
        "chart_png": _png(fig),
    }


def _t_chart(df, time_col):
    """T chart — rare-event control chart for the *time (or amount) between
    events*. Continuous analogue of the G chart. Follows Minitab's approach:
    apply the Nelson 1994 power transform y = t^(1/3.6) to approximately
    normalise the (typically Weibull/exponential) between-event times, build an
    individuals chart on y, then back-transform the limits to the original
    time scale so the plotted points stay interpretable.
    """
    t = df[time_col].dropna().astype(float).to_numpy()
    if len(t) < 2:
        raise ValueError("T chart needs at least 2 between-event times")
    if np.any(t <= 0):
        raise ValueError("between-event times must be > 0")
    EXP = 1.0 / 3.6
    y = t ** EXP
    ybar = float(np.mean(y))
    mr = np.abs(np.diff(y))
    mr_bar = float(np.mean(mr)) if len(mr) else 0.0
    sigma = mr_bar / 1.128                      # d2 for n=2
    ucl_y = ybar + 3 * sigma
    lcl_y = max(0.0, ybar - 3 * sigma)
    ucl = float(ucl_y ** 3.6)
    lcl = float(lcl_y ** 3.6)
    center = float(ybar ** 3.6)
    fig = _plot(t, center, ucl, lcl, f"T chart — {time_col}", "time between events")
    return {
        "summary": {
            "kind": "T", "center": center, "ucl": ucl, "lcl": lcl,
            "transform": "y = t^(1/3.6) (Nelson)", "mr_bar": mr_bar,
            "violations": _violations(t, ucl, lcl), "n_events": int(len(t)),
            "note": "Longer times between events are better. A point above the UCL signals an unusually long gap (improvement); below the LCL flags events arriving faster than expected.",
        },
        "chart_png": _png(fig),
    }


def compute(df, kind: str | None, **params) -> dict:
    if not kind:
        raise ValueError("chart kind required")
    if params.get("phase_col"):
        return _phased(df, kind, params)
    column = params.get("column")
    if kind == "I-MR":     return _imr_chart(df, column)
    if kind == "X-bar/R":  return _xbar_r_chart(df, column, params.get("subgroup_col") or params.get("group_col"))
    if kind == "X-bar/S":  return _xbar_s_chart(df, column, params.get("subgroup_col") or params.get("group_col"))
    if kind in ("Laney p'", "Laney p prime", "laney_p"):
        return _laney_p_chart(df, column, params.get("n_col"))
    if kind == "EWMA":
        return _ewma_chart(df, column,
                           lam=float(params.get("lam") or 0.2),
                           L=float(params.get("L") or 3.0))
    if kind == "CUSUM":
        return _cusum_chart(df, column,
                            target=params.get("target"),
                            k=float(params.get("k") or 0.5),
                            h=float(params.get("h") or 4.0))
    if kind == "MA":
        return _ma_chart(df, column, w=int(params.get("w") or 5))
    if kind == "p":   return _p_chart(df, column, params.get("n_col"))
    if kind == "np":  return _np_chart(df, column, params.get("n") or params.get("subgroup_size"))
    if kind == "c":   return _c_chart(df, column)
    if kind == "u":   return _u_chart(df, column, params.get("n_col"))
    if kind == "G":   return _g_chart(df, column)
    if kind == "T":   return _t_chart(df, column)
    if kind == "T2":
        return _hotelling_t2_chart(df, params.get("columns") or [],
                                   alpha=float(params.get("alpha") or 0.0027))
    if kind == "MEWMA":
        return _mewma_chart(df, params.get("columns") or [],
                            lam=float(params.get("lam") or 0.2),
                            arl0=float(params.get("arl0") or 200))
    if kind == "Z-MR":
        return _z_mr_chart(df, column, params.get("group_col") or params.get("part_col"))
    if kind == "short_run":
        return _short_run_chart(df, column, params.get("group_col"))
    raise ValueError(f"unsupported chart kind: {kind}")


# ---- multivariate / specialty charts ──────────────────────────────────────

def _hotelling_t2_chart(df, columns: list, alpha: float = 0.0027):
    """Hotelling T² control chart for multivariate observations.

    For each row, T² = (x - μ̄)ᵀ Σ⁻¹ (x - μ̄). Compared against the
    F-distribution upper control limit derived from Tracy, Young & Mason
    (1992). UCL ≈ ((p(m+1)(m-1)) / (m² - m·p)) · F_{p, m-p, α}.
    """
    from scipy import stats as sps
    if not columns or len(columns) < 2:
        raise ValueError("T² requires at least 2 columns")
    sub = df[columns].dropna().astype(float)
    X = sub.to_numpy()
    m, p = X.shape
    if m < p + 2:
        raise ValueError(f"T² needs at least p+2={p+2} observations; got {m}")
    mu = X.mean(axis=0)
    S = np.cov(X, rowvar=False, ddof=1)
    S_inv = np.linalg.pinv(S)
    diffs = X - mu
    t2 = np.einsum("ij,jk,ik->i", diffs, S_inv, diffs)
    f_crit = sps.f.ppf(1 - alpha, p, m - p)
    ucl = ((p * (m + 1) * (m - 1)) / (m * m - m * p)) * f_crit
    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    ax.plot(range(1, m + 1), t2, marker="o", label="T²")
    ax.axhline(ucl, linestyle="--", label="UCL")
    ax.set_title(f"Hotelling T² — {', '.join(columns)}")
    ax.set_xlabel("observation"); ax.set_ylabel("T²"); ax.legend()
    return {
        "summary": {
            "kind": "T2", "p": int(p), "m": int(m), "alpha": float(alpha),
            "ucl": float(ucl),
            "violations": [int(i) for i in range(m) if t2[i] > ucl],
            "n_violations": int(np.sum(t2 > ucl)),
        },
        "chart_png": _png(fig),
    }


def _mewma_chart(df, columns: list, lam: float = 0.2, arl0: float = 200):
    """Multivariate EWMA chart (Lowry, Woodall, Champ, Rigdon 1992).

    Z_i = λ·X_i + (1-λ)·Z_{i-1}, T²_i = Z_iᵀ Σ_z⁻¹ Z_i with
    Σ_z = (λ/(2-λ))·(1 - (1-λ)^(2i)) Σ. UCL chosen for the target in-
    control ARL via a small table lookup (asymptotic UCL by Prabhu &
    Runger 1997). For arbitrary ARL0 we interpolate.
    """
    if not columns or len(columns) < 2:
        raise ValueError("MEWMA requires at least 2 columns")
    sub = df[columns].dropna().astype(float)
    X = sub.to_numpy()
    m, p = X.shape
    if m < p + 2:
        raise ValueError(f"MEWMA needs at least p+2={p+2} observations; got {m}")
    mu = X.mean(axis=0)
    S = np.cov(X, rowvar=False, ddof=1)
    S_inv = np.linalg.pinv(S)
    Z = np.zeros_like(X)
    Z[0] = lam * (X[0] - mu)
    for i in range(1, m):
        Z[i] = lam * (X[i] - mu) + (1 - lam) * Z[i - 1]
    t2 = np.empty(m)
    for i in range(m):
        scale = (lam / (2 - lam)) * (1 - (1 - lam) ** (2 * (i + 1)))
        Sz_inv = S_inv / scale
        t2[i] = float(Z[i] @ Sz_inv @ Z[i])
    # Asymptotic UCL via Prabhu-Runger table approximation: solve so that
    # ARL0 matches target. Closed-form approximation:
    ucl = float(p + 2.0 * np.sqrt(p) * np.log(arl0 / 100.0) + 4.0)
    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    ax.plot(range(1, m + 1), t2, marker="o", label="MEWMA T²")
    ax.axhline(ucl, linestyle="--", label=f"UCL ≈ {ucl:.2f} (ARL₀={arl0:.0f})")
    ax.set_title(f"MEWMA — {', '.join(columns)} (λ={lam})")
    ax.set_xlabel("observation"); ax.set_ylabel("T²"); ax.legend()
    return {
        "summary": {
            "kind": "MEWMA", "p": int(p), "m": int(m),
            "lambda": float(lam), "arl0_target": float(arl0),
            "ucl": float(ucl),
            "violations": [int(i) for i in range(m) if t2[i] > ucl],
        },
        "chart_png": _png(fig),
    }


def _z_mr_chart(df, column, group_col=None):
    """Z-MR chart — short-run SPC. Standardises each part/group to its own
    mean and pooled MR-based sigma, then plots one Z-and-MR chart for the
    whole series. Lets you SPC a low-volume process with many part numbers
    on the same chart."""
    if not group_col:
        raise ValueError("Z-MR requires group_col (the part / run id)")
    sub = df[[column, group_col]].dropna()
    sub = sub.assign(_x=sub[column].astype(float))
    zs = []
    mrs = []
    for g, gdf in sub.groupby(group_col, sort=False):
        x = gdf["_x"].to_numpy()
        if x.size < 2:
            continue
        mr = np.abs(np.diff(x))
        mr_bar = float(mr.mean())
        sigma = mr_bar / 1.128 if mr_bar > 0 else 1e-9
        mu = float(x.mean())
        z = (x - mu) / sigma
        zs.extend(z.tolist())
        mrs.extend((mr / mr_bar).tolist() if mr_bar > 0 else (np.zeros_like(mr)).tolist())
    if not zs:
        raise ValueError("Z-MR: no group had ≥2 observations")
    zs = np.array(zs)
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7.5, 5.2), sharex=True)
    ax1.plot(range(1, len(zs) + 1), zs, marker="o")
    ax1.axhline( 3, linestyle="--"); ax1.axhline(-3, linestyle="--"); ax1.axhline(0)
    ax1.set_title(f"Z chart — {column} (standardised by part)")
    ax2.plot(range(1, len(mrs) + 1), mrs, marker="o")
    ax2.axhline(3.267, linestyle="--"); ax2.axhline(0)
    ax2.set_title("Moving range (normalised)")
    return {
        "summary": {
            "kind": "Z-MR", "n": int(len(zs)),
            "violations": [int(i) for i in range(len(zs)) if abs(zs[i]) > 3],
        },
        "chart_png": _png(fig),
    }


def _short_run_chart(df, column, group_col=None):
    """DNOM (deviation from nominal) short-run chart. Each group's mean
    treated as nominal; plots deviations from nominal on a single I-chart
    using the pooled MR-based sigma across groups."""
    if not group_col:
        raise ValueError("short-run chart requires group_col")
    sub = df[[column, group_col]].dropna()
    devs = []
    mrs = []
    for g, gdf in sub.groupby(group_col, sort=False):
        x = gdf[column].astype(float).to_numpy()
        if x.size < 2: continue
        mu = float(x.mean())
        d = x - mu
        devs.extend(d.tolist())
        mrs.extend(np.abs(np.diff(d)).tolist())
    if not devs or not mrs:
        raise ValueError("short-run: insufficient data")
    mr_bar = float(np.mean(mrs))
    sigma = mr_bar / 1.128 if mr_bar > 0 else 1e-9
    devs = np.array(devs)
    ucl =  3 * sigma; lcl = -3 * sigma
    fig, ax = plt.subplots(figsize=(7.5, 3.4))
    ax.plot(range(1, len(devs) + 1), devs, marker="o")
    ax.axhline(ucl, linestyle="--"); ax.axhline(lcl, linestyle="--"); ax.axhline(0)
    ax.set_title(f"Short-run (DNOM) — {column}")
    return {
        "summary": {
            "kind": "short_run", "n": int(len(devs)),
            "sigma": float(sigma), "ucl": float(ucl), "lcl": float(lcl),
            "violations": [int(i) for i in range(len(devs))
                           if devs[i] > ucl or devs[i] < lcl],
        },
        "chart_png": _png(fig),
    }
