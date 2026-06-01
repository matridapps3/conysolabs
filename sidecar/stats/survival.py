"""Kaplan-Meier survival estimator + log-rank test for group comparison.

Cox PH (in reliability.py) models survival as a function of covariates.
KM and log-rank are the *non-parametric* counterparts: estimate the survival
curve directly and compare two or more curves for equality. These are the
default tools for "is treatment A better than treatment B?" in any
time-to-event analysis.

No external `lifelines` dependency — KM is just cumulative product of
conditional survival, and log-rank is a closed-form Σ(O_j − E_j) / √Σ V_j
chi-square. The whole module is < 200 LOC.
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats as sps


def _km_estimate(times: np.ndarray, events: np.ndarray) -> dict:
    """Kaplan-Meier survival curve for one group.

    Returns the unique event times, the survival S(t), the at-risk count,
    and Greenwood-formula standard errors → 95% log-log CI."""
    order = np.argsort(times)
    t, e = times[order], events[order]
    n = len(t)
    if n == 0:
        return {"t": [], "S": [], "se": [], "ci_lo": [], "ci_hi": [],
                "at_risk": [], "events": [], "n_total": 0,
                "median_survival": None, "rmst": None}

    # Distinct event times only (censored points modify at-risk count only).
    unique_t = np.unique(t[e == 1])
    S = 1.0
    cum_var = 0.0
    rows_t, rows_S, rows_se, rows_lo, rows_hi, rows_n, rows_d = [], [], [], [], [], [], []
    n_at_risk = n
    cursor = 0  # how many subjects we've "passed" by time
    for tj in unique_t:
        # Anyone with time < tj has been censored or had their event already.
        while cursor < n and t[cursor] < tj:
            n_at_risk -= 1
            cursor += 1
        # Now count events and censored exactly at tj.
        d_j = 0; c_j = 0
        k = cursor
        while k < n and t[k] == tj:
            if e[k] == 1: d_j += 1
            else:          c_j += 1
            k += 1
        if n_at_risk <= 0 or d_j == 0:
            # Advance and continue.
            n_at_risk -= (d_j + c_j)
            cursor = k
            continue
        S *= (1 - d_j / n_at_risk)
        cum_var += d_j / (n_at_risk * (n_at_risk - d_j)) if n_at_risk > d_j else 0
        se = float(S * np.sqrt(cum_var)) if S > 0 else 0.0
        # Log-log CI — better behaved near 0 / 1 than the naive Wald.
        if 0 < S < 1 and cum_var > 0:
            logS = np.log(S)
            v = cum_var / (logS ** 2)
            half = 1.96 * np.sqrt(v)
            ci_lo = float(S ** np.exp(half))
            ci_hi = float(S ** np.exp(-half))
        else:
            ci_lo, ci_hi = float(S), float(S)
        rows_t.append(float(tj)); rows_S.append(float(S)); rows_se.append(se)
        rows_lo.append(ci_lo); rows_hi.append(ci_hi)
        rows_n.append(int(n_at_risk)); rows_d.append(int(d_j))
        n_at_risk -= (d_j + c_j)
        cursor = k

    # Median survival — smallest t where S(t) ≤ 0.5.
    median = None
    for tj, sj in zip(rows_t, rows_S):
        if sj <= 0.5:
            median = float(tj); break

    # Restricted mean survival time (RMST) up to the last observed event —
    # area under the KM curve. Robust summary that doesn't require S to drop
    # below 0.5.
    if rows_t:
        # Step function: between event times the area is S * (t_{j+1} - t_j).
        rmst = 0.0
        prev_t = 0.0; prev_S = 1.0
        for tj, sj in zip(rows_t, rows_S):
            rmst += prev_S * (tj - prev_t)
            prev_t = tj; prev_S = sj
        rmst = float(rmst)
    else:
        rmst = None

    return {"t": rows_t, "S": rows_S, "se": rows_se,
            "ci_lo": rows_lo, "ci_hi": rows_hi,
            "at_risk": rows_n, "events": rows_d,
            "n_total": int(n),
            "n_events": int(int(events.sum())),
            "n_censored": int(n - int(events.sum())),
            "median_survival": median,
            "rmst": rmst}


def _log_rank(groups: dict[str, tuple[np.ndarray, np.ndarray]]) -> dict:
    """k-sample log-rank test for equality of survival curves.

    At every distinct event time t_j, compute the observed events O_kj per
    group and the expected E_kj under H_0 (no difference). The test
    statistic is (Σ O_k − E_k)' V^{-1} (Σ O_k − E_k) ~ χ²(k-1).
    """
    keys = sorted(groups.keys())
    K = len(keys)
    if K < 2:
        return {"chi2": None, "df": 0, "p": None}
    all_t = np.concatenate([g[0] for g in groups.values()])
    all_e = np.concatenate([g[1] for g in groups.values()])
    event_times = np.unique(all_t[all_e == 1])

    O = np.zeros(K)
    E = np.zeros(K)
    V = np.zeros((K, K))

    for tj in event_times:
        n_k = np.array([(groups[k][0] >= tj).sum() for k in keys])
        d_k = np.array([((groups[k][0] == tj) & (groups[k][1] == 1)).sum()
                        for k in keys])
        N_j = int(n_k.sum())
        D_j = int(d_k.sum())
        if N_j <= 1 or D_j == 0 or D_j == N_j:
            continue
        # Expected events per group at this time: d_j · (n_k / N).
        E_kj = D_j * (n_k / N_j)
        O += d_k
        E += E_kj
        # Hypergeometric variance / covariance contribution.
        factor = D_j * (N_j - D_j) / (N_j - 1) / (N_j ** 2)
        for i in range(K):
            for j in range(K):
                if i == j:
                    V[i, j] += factor * n_k[i] * (N_j - n_k[i])
                else:
                    V[i, j] -= factor * n_k[i] * n_k[j]

    diff = (O - E)[:-1]              # drop one to avoid rank-deficiency
    Vsub = V[:-1, :-1]
    try:
        chi2 = float(diff @ np.linalg.solve(Vsub, diff))
        df = K - 1
        p = float(1 - sps.chi2.cdf(chi2, df))
    except np.linalg.LinAlgError:
        chi2, df, p = None, K - 1, None

    return {"chi2": chi2, "df": df, "p": p,
            "observed_per_group": {k: float(o) for k, o in zip(keys, O)},
            "expected_per_group": {k: float(e) for k, e in zip(keys, E)}}


def kaplan_meier(df: pd.DataFrame, time_col: str, event_col: str,
                 group_col: str | None = None,
                 alpha: float = 0.05) -> dict:
    """Public entry point. Single group → just KM curve. Multi group → KM
    per group + log-rank test."""
    sub = df[[time_col, event_col] + ([group_col] if group_col else [])].dropna()
    if len(sub) < 2:
        raise ValueError("kaplan_meier: need at least 2 observations")
    t_all = sub[time_col].astype(float).to_numpy()
    e_all = sub[event_col].astype(int).to_numpy()

    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    if group_col is None:
        km = _km_estimate(t_all, e_all)
        # Step plot
        if km["t"]:
            xs = [0] + km["t"]; ys = [1.0] + km["S"]
            ax.step(xs, ys, where="post")
            ax.fill_between(xs, [1.0] + km["ci_lo"], [1.0] + km["ci_hi"],
                            step="post", alpha=0.15)
        ax.set_xlabel(time_col); ax.set_ylabel("Survival S(t)")
        ax.set_ylim(0, 1.02)
        ax.set_title(f"Kaplan-Meier — {time_col}")
        buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)
        return {"summary": {"method": "kaplan_meier",
                            "curve": km,
                            "n": int(len(sub))},
                "chart_png": buf.getvalue()}

    # Grouped
    groups_data = {}
    groups_arrays = {}
    for g, sub_g in sub.groupby(group_col):
        tg = sub_g[time_col].astype(float).to_numpy()
        eg = sub_g[event_col].astype(int).to_numpy()
        groups_data[str(g)] = _km_estimate(tg, eg)
        groups_arrays[str(g)] = (tg, eg)
    lr = _log_rank(groups_arrays)
    for name, km in groups_data.items():
        if not km["t"]:
            continue
        xs = [0] + km["t"]; ys = [1.0] + km["S"]
        ax.step(xs, ys, where="post", label=f"{name} (n={km['n_total']})")
    ax.set_xlabel(time_col); ax.set_ylabel("Survival S(t)")
    ax.set_ylim(0, 1.02)
    lr_text = f"log-rank χ²={lr['chi2']:.2f}, p={lr['p']:.3f}" if lr["chi2"] is not None else "log-rank: undefined"
    ax.set_title(f"Kaplan-Meier by {group_col} — {lr_text}")
    ax.legend(loc="best", frameon=False)
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)
    return {"summary": {"method": "kaplan_meier",
                        "groups": groups_data,
                        "log_rank": lr,
                        "n": int(len(sub))},
            "chart_png": buf.getvalue()}
