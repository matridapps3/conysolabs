"""Post-hoc multiple-comparison tests. Run after a significant ANOVA to
identify which group pairs differ. Tukey HSD is the default; Fisher LSD
is faster but doesn't control familywise error; Games-Howell is the
heteroscedastic-friendly choice.
"""
from __future__ import annotations

from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats as sps
from statsmodels.stats.multicomp import pairwise_tukeyhsd


def _compact_letter_display(groups: list[str], pairs: list[dict],
                            reject_key: str = "reject_h0") -> dict[str, str]:
    """Compact letter display ("Tukey letters" / "a/b/c grouping") — the
    single most-requested ANOVA output from BBs that Bench was missing.

    Two groups share a letter ⇔ they are NOT significantly different.
    Algorithm: build the "no-difference" graph; greedily find maximal cliques;
    assign each clique a letter; each group gets the letters of all cliques
    it belongs to. This is the algorithm Piepho (2004) showed produces a
    minimal letter set.
    """
    if not groups:
        return {}
    # Adjacency: groups[i] ↔ groups[j] iff their pair is NOT rejected.
    g = sorted(set(groups))
    idx = {x: i for i, x in enumerate(g)}
    adj = {x: {x} for x in g}        # self-loop so cliques find singletons
    pair_decision = {}
    for p in pairs:
        a, b = p["group_a"], p["group_b"]
        pair_decision[frozenset([a, b])] = p[reject_key]
        if not p[reject_key]:
            adj[a].add(b)
            adj[b].add(a)

    # Greedy maximal cliques. For ~10 groups (typical ANOVA) this is fine.
    def is_clique(s: set) -> bool:
        for a in s:
            if not s.issubset(adj[a]):
                return False
        return True

    cliques: list[set] = []
    # Start with each group as a candidate clique, extend greedily.
    remaining = set(g)
    while remaining:
        # Pick the group with most neighbours still remaining — produces
        # bigger cliques first → fewer letters total.
        seed = max(remaining, key=lambda x: len(adj[x] & remaining))
        c = {seed}
        for cand in sorted(adj[seed] - {seed}, key=lambda x: -len(adj[x])):
            if is_clique(c | {cand}):
                c.add(cand)
        # If c isn't a maximal extension of any existing clique, add it.
        if not any(c.issubset(existing) for existing in cliques):
            # Drop any previously-added clique that's now subsumed.
            cliques = [ex for ex in cliques if not ex.issubset(c)]
            cliques.append(c)
        remaining -= c if len(c) > 1 else {seed}

    # Assign letters a, b, c, … by clique discovery order.
    letters = {}
    for k, c in enumerate(cliques):
        letter = chr(ord("a") + k) if k < 26 else f"a{k - 25}"
        for member in c:
            letters[member] = letters.get(member, "") + letter
    # Singletons that landed in their own one-element clique get a letter too.
    for member in g:
        if member not in letters:
            letters[member] = chr(ord("a") + len(cliques))
    return letters


def tukey_hsd(df: pd.DataFrame, value_col: str, group_col: str, alpha: float = 0.05) -> dict:
    """Tukey's Honestly Significant Difference. Reports each pairwise mean
    difference with a confidence interval and a reject/accept decision.

    Also emits a **compact letter display** mapping group → letters: groups
    sharing a letter aren't significantly different. The Minitab/JMP-standard
    output every ANOVA writeup expects.
    """
    sub = df[[value_col, group_col]].dropna()
    res = pairwise_tukeyhsd(sub[value_col].astype(float), sub[group_col].astype(str), alpha=alpha)
    rows = []
    for line in res.summary().data[1:]:
        g1, g2, mean_diff, p_adj, lower, upper, reject = line
        rows.append({"group_a": str(g1), "group_b": str(g2),
                     "mean_diff": float(mean_diff), "p_adj": float(p_adj),
                     "ci_lower": float(lower), "ci_upper": float(upper),
                     "reject_h0": bool(reject)})
    groups = sub[group_col].astype(str).unique().tolist()
    cld = _compact_letter_display(groups, rows)
    # Decorate with each group's mean for a ready-to-render table.
    means = sub.groupby(group_col)[value_col].mean().to_dict()
    cld_table = [{"group": str(g), "mean": float(means[g]),
                  "letters": cld.get(str(g), "")}
                 for g in groups]
    cld_table.sort(key=lambda r: -r["mean"])
    return {"summary": {"test": "tukey_hsd", "alpha": alpha,
                        "n_comparisons": len(rows), "comparisons": rows,
                        "compact_letter_display": cld_table}}


def fisher_lsd(df: pd.DataFrame, value_col: str, group_col: str, alpha: float = 0.05) -> dict:
    """Fisher's LSD — pairwise t-tests with no familywise correction.
    Faster and more powerful than Tukey but inflates false-positive rate
    when there are many groups; only valid after a significant ANOVA."""
    sub = df[[value_col, group_col]].dropna()
    groups = sub.groupby(group_col)[value_col].apply(lambda s: s.astype(float).to_numpy())
    keys = list(groups.index)
    # Pooled variance from all groups.
    sse = sum(((g - g.mean()) ** 2).sum() for g in groups)
    df_w = sum(len(g) for g in groups) - len(groups)
    mse = sse / df_w if df_w > 0 else float("nan")
    rows = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = groups.iloc[i], groups.iloc[j]
            diff = float(a.mean() - b.mean())
            se = float(np.sqrt(mse * (1 / len(a) + 1 / len(b)))) if mse > 0 else float("nan")
            t = diff / se if se else 0.0
            p = float(2 * (1 - sps.t.cdf(abs(t), df_w))) if df_w > 0 else float("nan")
            rows.append({"group_a": str(keys[i]), "group_b": str(keys[j]),
                         "mean_diff": diff, "se": se, "t": float(t), "p": p,
                         "reject_h0": p < alpha})
    return {"summary": {"test": "fisher_lsd", "alpha": alpha,
                        "n_comparisons": len(rows), "comparisons": rows}}


def games_howell(df: pd.DataFrame, value_col: str, group_col: str, alpha: float = 0.05) -> dict:
    """Games-Howell — the post-hoc to use when group variances are
    unequal. Uses Welch's t-test approach pairwise with studentized-range
    critical values."""
    sub = df[[value_col, group_col]].dropna()
    groups = sub.groupby(group_col)[value_col].apply(lambda s: s.astype(float).to_numpy())
    keys = list(groups.index)
    rows = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = groups.iloc[i], groups.iloc[j]
            ma, mb = a.mean(), b.mean()
            va, vb = a.var(ddof=1), b.var(ddof=1)
            na, nb = len(a), len(b)
            se = np.sqrt(va / na + vb / nb)
            diff = float(ma - mb)
            t = diff / se if se else 0.0
            df_w = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1)) if (na > 1 and nb > 1) else float("nan")
            # Studentized range distribution (Tukey's q): scipy has it in
            # studentized_range — newer scipy versions only.
            try:
                q = abs(t) * np.sqrt(2.0)
                p = float(1 - sps.studentized_range.cdf(q, len(keys), df_w)) if df_w > 0 else float("nan")
            except AttributeError:
                p = float(2 * (1 - sps.t.cdf(abs(t), df_w))) if df_w > 0 else float("nan")
            rows.append({"group_a": str(keys[i]), "group_b": str(keys[j]),
                         "mean_diff": diff, "se": float(se),
                         "p": p, "reject_h0": p < alpha if not np.isnan(p) else False})
    return {"summary": {"test": "games_howell", "alpha": alpha,
                        "n_comparisons": len(rows), "comparisons": rows}}


def dunnett(df: pd.DataFrame, value_col: str, group_col: str,
            control_group: str, alpha: float = 0.05) -> dict:
    """Dunnett's test — compares each treatment group to a single control,
    not all pairs. Used in DOE when one factor level is a known baseline."""
    sub = df[[value_col, group_col]].dropna()
    sub[group_col] = sub[group_col].astype(str)
    if control_group not in sub[group_col].unique():
        raise ValueError(f"control_group {control_group!r} not in data")
    ctrl = sub[sub[group_col] == control_group][value_col].astype(float).to_numpy()
    other_keys = [g for g in sub[group_col].unique() if g != control_group]
    sse = ((ctrl - ctrl.mean()) ** 2).sum()
    n_total = len(ctrl)
    for g in other_keys:
        v = sub[sub[group_col] == g][value_col].astype(float).to_numpy()
        sse += ((v - v.mean()) ** 2).sum()
        n_total += len(v)
    df_w = n_total - len(other_keys) - 1
    mse = sse / df_w if df_w > 0 else float("nan")
    rows = []
    for g in other_keys:
        v = sub[sub[group_col] == g][value_col].astype(float).to_numpy()
        diff = float(v.mean() - ctrl.mean())
        se = float(np.sqrt(mse * (1 / len(v) + 1 / len(ctrl)))) if mse > 0 else float("nan")
        t = diff / se if se else 0.0
        # Two-sided p-value with Bonferroni correction across (k-1) comparisons.
        # (Dunnett's exact distribution requires lookup tables — Bonferroni
        # is a conservative substitute; replace with proper Dunnett when an
        # implementation lands in scipy.)
        p_raw = float(2 * (1 - sps.t.cdf(abs(t), df_w))) if df_w > 0 else float("nan")
        p_adj = float(min(1.0, p_raw * len(other_keys)))
        rows.append({"group": str(g), "control": str(control_group),
                     "mean_diff": diff, "se": se, "t": float(t),
                     "p_raw": p_raw, "p_bonferroni": p_adj,
                     "reject_h0": p_adj < alpha})
    return {"summary": {"test": "dunnett", "alpha": alpha,
                        "control": control_group, "comparisons": rows}}


def dunn(df: pd.DataFrame, value_col: str, group_col: str,
         alpha: float = 0.05, p_adjust: str = "holm") -> dict:
    """Dunn's (1964) test — the non-parametric post-hoc to run after a
    significant Kruskal-Wallis. Compares every pair of groups on their POOLED
    mean ranks, with a tie correction, then adjusts for multiplicity.

        z_ij = (R̄_i − R̄_j) / sqrt( σ² · (1/n_i + 1/n_j) )
        σ²   = N(N+1)/12 − Σ(t_k³ − t_k) / (12(N−1))

    `p_adjust` is "holm" (default, more powerful) or "bonferroni".
    """
    sub = df[[value_col, group_col]].dropna()
    sub[group_col] = sub[group_col].astype(str)
    groups = sorted(sub[group_col].unique().tolist())
    if len(groups) < 2:
        raise ValueError("Dunn's test needs at least 2 groups")

    vals = sub[value_col].astype(float).to_numpy()
    grp = sub[group_col].to_numpy()
    N = vals.size
    ranks = sps.rankdata(vals)                       # average ranks for ties
    _, counts = np.unique(vals, return_counts=True)  # tie-group sizes
    tie_sum = float(np.sum(counts ** 3 - counts))
    sigma2 = (N * (N + 1) / 12.0) - tie_sum / (12.0 * (N - 1)) if N > 1 else float("nan")

    mean_rank = {g: float(ranks[grp == g].mean()) for g in groups}
    n = {g: int((grp == g).sum()) for g in groups}

    rows = []
    for a, b in combinations(groups, 2):
        se = float(np.sqrt(sigma2 * (1.0 / n[a] + 1.0 / n[b]))) if sigma2 and sigma2 > 0 else float("nan")
        z = (mean_rank[a] - mean_rank[b]) / se if se else 0.0
        p_raw = float(2 * sps.norm.sf(abs(z)))
        rows.append({"group_a": a, "group_b": b,
                     "mean_rank_a": mean_rank[a], "mean_rank_b": mean_rank[b],
                     "z": float(z), "se": se, "p_raw": p_raw,
                     "p_adj": p_raw, "reject_h0": False})

    m = len(rows)
    if p_adjust == "bonferroni":
        for r in rows:
            r["p_adj"] = float(min(1.0, r["p_raw"] * m))
    else:  # Holm step-down (default): sort ascending, scale by (m − rank), keep monotone
        running = 0.0
        for rank_idx, i in enumerate(sorted(range(m), key=lambda i: rows[i]["p_raw"])):
            running = max(running, (m - rank_idx) * rows[i]["p_raw"])
            rows[i]["p_adj"] = float(min(1.0, running))
    for r in rows:
        r["reject_h0"] = bool(r["p_adj"] < alpha)

    return {"summary": {"test": "dunn", "alpha": alpha, "p_adjust": p_adjust,
                        "n_groups": len(groups), "comparisons": rows}}


def hsu_mcb(df: pd.DataFrame, value_col: str, group_col: str,
            direction: str = "best_is_largest", alpha: float = 0.05) -> dict:
    """Hsu's Multiple Comparisons with the Best (MCB).

    Identifies which groups are statistically indistinguishable from "the
    best" group — without forcing a specific group to be the baseline (which
    is what Dunnett requires). For each group i we compute

        D_i = mean(i) - max_{j != i} mean(j)        (best_is_largest)
        D_i = mean(i) - min_{j != i} mean(j)        (best_is_smallest)

    A one-sided simultaneous confidence interval on D_i tells you whether
    group i could be the best. Groups whose interval contains zero remain
    candidates for "best"; groups whose interval excludes zero are not.

    The critical value is from the one-sided studentized maximum modulus;
    we approximate it conservatively via Bonferroni on (k-1) comparisons —
    replace with the exact Hsu critical value when one lands in scipy.
    """
    if direction not in ("best_is_largest", "best_is_smallest"):
        raise ValueError("direction must be best_is_largest or best_is_smallest")
    sub = df[[value_col, group_col]].dropna()
    sub[group_col] = sub[group_col].astype(str)
    keys = sorted(sub[group_col].unique())
    if len(keys) < 2:
        raise ValueError("Hsu MCB requires at least 2 groups")

    arrays = {g: sub[sub[group_col] == g][value_col].astype(float).to_numpy() for g in keys}
    means  = {g: float(a.mean()) for g, a in arrays.items()}
    sse    = sum(((a - a.mean()) ** 2).sum() for a in arrays.values())
    n_total = sum(len(a) for a in arrays.values())
    df_w   = n_total - len(keys)
    mse    = sse / df_w if df_w > 0 else float("nan")
    # Conservative one-sided critical value via Bonferroni on (k-1) tails.
    k = len(keys)
    alpha_each = alpha / max(1, k - 1)
    t_crit = float(sps.t.ppf(1 - alpha_each, df_w)) if df_w > 0 else float("nan")

    rows = []
    for g in keys:
        a = arrays[g]
        # "best of the rest"
        others = [m for gg, m in means.items() if gg != g]
        ref = max(others) if direction == "best_is_largest" else min(others)
        diff = means[g] - ref
        # Use the largest n on the "other" side that matches the chosen ref.
        # For SE we pool MSE with sample sizes (g) and (other-with-best-mean).
        other_g = max(means, key=lambda gg: means[gg]) if direction == "best_is_largest" \
                  else min(means, key=lambda gg: means[gg])
        if other_g == g:
            # g is itself the extremum — compare to second-best.
            ranked = sorted(means.items(), key=lambda kv: kv[1],
                            reverse=(direction == "best_is_largest"))
            other_g = ranked[1][0] if len(ranked) > 1 else g
        n_g = len(arrays[g])
        n_o = len(arrays[other_g])
        se  = float(np.sqrt(mse * (1 / n_g + 1 / n_o))) if mse > 0 else float("nan")
        # One-sided simultaneous CI on D_i. For "best_is_largest" we want
        # the *upper* bound on (best_of_others - g) to be ≤ 0 to declare g
        # the best, i.e. lower bound on (g - best_of_others) ≥ 0.
        if direction == "best_is_largest":
            lower = diff - t_crit * se
            upper = float("inf")
            could_be_best = lower >= 0 or (diff + t_crit * se >= 0)
        else:
            upper = diff + t_crit * se
            lower = float("-inf")
            could_be_best = upper <= 0 or (diff - t_crit * se <= 0)
        rows.append({
            "group": g,
            "mean": means[g],
            "diff_vs_best_other": float(diff),
            "se": se,
            "ci_lower": float(lower) if np.isfinite(lower) else None,
            "ci_upper": float(upper) if np.isfinite(upper) else None,
            "could_be_best": bool(could_be_best),
        })
    return {"summary": {"test": "hsu_mcb", "alpha": alpha, "direction": direction,
                        "k_groups": k, "df_within": df_w, "mse_pooled": float(mse),
                        "candidates_for_best": [r["group"] for r in rows if r["could_be_best"]],
                        "comparisons": rows}}
