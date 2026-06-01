"""Hypothesis tests — the breadth of inferential statistics a Black Belt
expects. Bill ships every test on Minitab's "Stat → Basic Statistics"
and "Stat → ANOVA" menus that's actually used in real LSS work.

Each test returns {"summary": {...}}; numbers come straight from scipy /
statsmodels (no LLM-generated math). The Node analyst agent wraps
the summary with a calibrated narrative.

Tests in this module:
  Means / locations
    one_sample_t, two_sample_t (Welch by default), paired_t,
    one_way_anova (alias: anova), two_way_anova,
    mann_whitney, kruskal, wilcoxon_signed_rank, sign_test,
    mood_median
  Variances
    levene, bartlett, f_test_variances
  Proportions / counts
    one_proportion, two_proportions, chi_square, fisher_exact
  Normality
    anderson_darling_normality, ryan_joiner (proxy via Shapiro–Wilk),
    kolmogorov_smirnov_normal
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps


def _ci_mean(x: np.ndarray, alpha: float = 0.05) -> tuple[float, float]:
    """Two-sided CI for the mean. Used as the standard companion to t-tests
    so users see effect direction, not just a p-value."""
    n = x.size
    if n < 2:
        return (float("nan"), float("nan"))
    se = x.std(ddof=1) / np.sqrt(n)
    t = sps.t.ppf(1 - alpha / 2, df=n - 1)
    return (float(x.mean() - t * se), float(x.mean() + t * se))


# ─── Post-hoc power helpers ─────────────────────────────────────────────
#
# Every hypothesis test in Bench now ships post-hoc (achieved) power alongside
# the p-value. Without it the BB can't distinguish "no effect" from "test
# was underpowered to detect the effect that's there". All formulas below
# use scipy non-central distributions — no statsmodels.power dependency.

def _power_t_one(d: float, n: int, alpha: float = 0.05) -> float | None:
    """Achieved power for a 1-sample (or paired) t-test against d, two-sided."""
    if n < 2 or not np.isfinite(d):
        return None
    ncp = d * np.sqrt(n)
    df = n - 1
    t_crit = sps.t.ppf(1 - alpha / 2, df)
    # P(|T| > t_crit | ncp)
    return float(1 - sps.nct.cdf(t_crit, df, ncp) + sps.nct.cdf(-t_crit, df, ncp))


def _power_t_two(d: float, n1: int, n2: int, alpha: float = 0.05) -> float | None:
    """Achieved power for a 2-sample t-test, two-sided."""
    if n1 < 2 or n2 < 2 or not np.isfinite(d):
        return None
    ncp = d * np.sqrt((n1 * n2) / (n1 + n2))
    df = n1 + n2 - 2
    t_crit = sps.t.ppf(1 - alpha / 2, df)
    return float(1 - sps.nct.cdf(t_crit, df, ncp) + sps.nct.cdf(-t_crit, df, ncp))


def _power_anova(eta2: float, k: int, n_total: int, alpha: float = 0.05) -> float | None:
    """Achieved power for a one-way ANOVA from η² (or partial-η²)."""
    if eta2 is None or not np.isfinite(eta2) or eta2 < 0 or eta2 >= 1:
        return None
    if k < 2 or n_total < k + 1:
        return None
    f2 = eta2 / (1 - eta2)             # Cohen's f²
    ncp = f2 * n_total                 # non-centrality
    df1 = k - 1
    df2 = n_total - k
    F_crit = sps.f.ppf(1 - alpha, df1, df2)
    return float(1 - sps.ncf.cdf(F_crit, df1, df2, ncp))


def _power_label(power: float | None) -> str | None:
    """Human-readable label. >0.8 conventional threshold (Cohen 1988)."""
    if power is None:
        return None
    if power >= 0.95:  return "very high"
    if power >= 0.80:  return "adequate"
    if power >= 0.50:  return "marginal"
    return "underpowered"


def _cramers_v(chi2: float, n: int, rows: int, cols: int) -> float | None:
    """Cramér's V — effect size for a chi-square contingency test.
    Bounded [0,1]; interpret like a correlation."""
    k = min(rows, cols)
    if n <= 0 or k < 2:
        return None
    return float(np.sqrt(chi2 / (n * (k - 1))))


def _phi(chi2: float, n: int) -> float | None:
    """φ coefficient — effect size for a 2×2 contingency test. Equals
    Cramér's V when both dims are 2."""
    if n <= 0:
        return None
    return float(np.sqrt(chi2 / n))


def compute(df, test: str | None, column: str | None, group_col: str | None,
            **kwargs) -> dict:
    if not test:
        raise ValueError("test required")

    # ---------- Means / locations ----------

    if test == "one_sample_t":
        x = df[column].dropna().astype(float).to_numpy()
        mu0 = float(kwargs.get("mu0") or 0.0)
        r = sps.ttest_1samp(x, popmean=mu0)
        ci = _ci_mean(x)
        # Effect size + post-hoc power
        sd = float(x.std(ddof=1)) if x.size > 1 else float("nan")
        d = float((x.mean() - mu0) / sd) if sd and np.isfinite(sd) and sd > 0 else None
        power = _power_t_one(d if d is not None else 0.0, int(x.size))
        return {"summary": {"test": test, "mu0": mu0, "t": float(r.statistic),
                            "p": float(r.pvalue), "n": int(x.size),
                            "mean": float(x.mean()), "stdev": sd,
                            "ci_95": list(ci),
                            "cohens_d": d,
                            "power": power, "power_label": _power_label(power)}}

    if test == "two_sample_t":
        groups = list(df.groupby(group_col)[column])
        if len(groups) != 2:
            raise ValueError("two_sample_t requires exactly two groups")
        a, b = groups[0][1].dropna().astype(float), groups[1][1].dropna().astype(float)
        equal_var = bool(kwargs.get("equal_var", False))
        r = sps.ttest_ind(a, b, equal_var=equal_var)
        # Cohen's d (pooled)
        sp = np.sqrt(((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1)) / (a.size + b.size - 2))
        d = (a.mean() - b.mean()) / sp if sp else None
        # CI on mean difference (Welch by default)
        se_diff = np.sqrt(a.var(ddof=1) / a.size + b.var(ddof=1) / b.size)
        if equal_var:
            df_t = a.size + b.size - 2
        else:
            df_t = ((a.var(ddof=1) / a.size + b.var(ddof=1) / b.size) ** 2 /
                    (((a.var(ddof=1) / a.size) ** 2 / (a.size - 1)) +
                     ((b.var(ddof=1) / b.size) ** 2 / (b.size - 1))))
        t_crit = sps.t.ppf(0.975, df=df_t)
        mean_diff = float(a.mean() - b.mean())
        ci_diff = [mean_diff - float(t_crit * se_diff), mean_diff + float(t_crit * se_diff)]
        power = _power_t_two(d if d is not None else 0.0, int(a.size), int(b.size))
        return {"summary": {"test": test, "equal_var": equal_var,
                            "t": float(r.statistic), "p": float(r.pvalue),
                            "groups": {str(groups[0][0]): int(a.size), str(groups[1][0]): int(b.size)},
                            "cohens_d": float(d) if d is not None else None,
                            "mean_diff": mean_diff,
                            "ci_95_diff": ci_diff,
                            "power": power, "power_label": _power_label(power)}}

    if test == "paired_t":
        col2 = kwargs.get("column_b") or kwargs.get("paired_col")
        if not col2:
            raise ValueError("paired_t requires column_b")
        sub = df[[column, col2]].dropna().astype(float)
        r = sps.ttest_rel(sub[column], sub[col2])
        diff = (sub[column] - sub[col2]).to_numpy()
        sd_diff = float(diff.std(ddof=1)) if diff.size > 1 else float("nan")
        d_z = float(diff.mean() / sd_diff) if sd_diff and sd_diff > 0 else None
        power = _power_t_one(d_z if d_z is not None else 0.0, int(diff.size))
        return {"summary": {"test": test, "t": float(r.statistic), "p": float(r.pvalue),
                            "n": int(len(sub)), "mean_diff": float(diff.mean()),
                            "stdev_diff": sd_diff,
                            "ci_95_diff": list(_ci_mean(diff)),
                            "cohens_dz": d_z,
                            "power": power, "power_label": _power_label(power)}}

    if test in ("anova", "one_way_anova"):
        arrays = [g.dropna().astype(float) for _, g in df.groupby(group_col)[column]]
        r = sps.f_oneway(*arrays)
        # Effect sizes: eta², omega² (less biased for small samples)
        all_vals = np.concatenate(arrays)
        ss_between = sum(a.size * (a.mean() - all_vals.mean()) ** 2 for a in arrays)
        ss_total = float(((all_vals - all_vals.mean()) ** 2).sum())
        ss_within = ss_total - ss_between
        eta2 = ss_between / ss_total if ss_total else None
        k = len(arrays)
        N = int(all_vals.size)
        df_b = k - 1
        df_w = N - k
        ms_w = ss_within / df_w if df_w > 0 else None
        omega2 = ((ss_between - df_b * ms_w) / (ss_total + ms_w)
                  if (ms_w is not None and ss_total + ms_w > 0) else None)
        power = _power_anova(float(eta2) if eta2 is not None else 0.0, k, N)
        return {"summary": {"test": "one_way_anova", "F": float(r.statistic), "p": float(r.pvalue),
                            "k": k, "N": N,
                            "n_per_group": [int(a.size) for a in arrays],
                            "eta_squared": float(eta2) if eta2 is not None else None,
                            "omega_squared": float(omega2) if omega2 is not None else None,
                            "power": power, "power_label": _power_label(power)}}

    if test == "rm_anova":
        # Repeated-measures ANOVA — within-subjects factor (e.g. time, dose)
        # +/- a between-subjects factor (treatment group). Implementation via
        # statsmodels AnovaRM, the standard tool. Caller passes:
        #   column        — response
        #   subject_col   — id of each subject (the unit of repetition)
        #   within        — within-subjects factor (treated as categorical)
        #   factor_a      — optional between-subjects factor
        from statsmodels.stats.anova import AnovaRM
        subject_col = kwargs.get("subject_col") or kwargs.get("subject")
        within = kwargs.get("within") or group_col
        between = kwargs.get("factor_a")
        if not subject_col or not within:
            raise ValueError("rm_anova requires subject_col and within")
        sub = df[[column, subject_col, within] + ([between] if between else [])].dropna()
        # statsmodels requires every (subject, within-cell) be present exactly
        # once. Aggregate just in case the caller has replicates.
        agg_cols = [subject_col, within] + ([between] if between else [])
        sub = sub.groupby(agg_cols, as_index=False)[column].mean()
        # A between-subjects factor does NOT vary within a subject, so it
        # cannot be passed to AnovaRM as a within factor — doing so makes it
        # collinear with the subject id and statsmodels raises "Independent
        # variables are collinear". statsmodels' AnovaRM does not support
        # between-subjects factors at all. The statistically correct tool for
        # a mixed within×between design is a linear mixed-effects model, so we
        # point the caller there rather than silently producing a wrong table.
        if between:
            raise ValueError(
                "rm_anova does not support a between-subjects factor "
                f"('{between}'). For a mixed within×between design, use the "
                "Mixed-effects (LMM) analysis: fixed='" + column + " ~ " +
                within + " * " + between + "', group='" + subject_col + "'.")
        model = AnovaRM(data=sub, depvar=column, subject=subject_col,
                        within=[within]).fit()
        # Build a clean table of source / df_num / df_den / F / p / partial eta²
        table = model.anova_table.reset_index().rename(columns={"index": "source"})
        rows = []
        for _, row in table.iterrows():
            r = {
                "source":  str(row["source"]),
                "df_num":  float(row["Num DF"]),
                "df_den":  float(row["Den DF"]),
                "F":       float(row["F Value"]),
                "p":       float(row["Pr > F"]),
            }
            rows.append(r)
        # Sphericity flag — Mauchly's test. statsmodels doesn't bundle it,
        # so we mark a heuristic: if df_num >= 2 and the design is repeated,
        # advise Greenhouse-Geisser correction (we don't apply it here, but
        # we flag for the user).
        sphericity_warning = any(r["df_num"] >= 2 for r in rows)
        return {"summary": {"test": "rm_anova",
                            "subject_col": subject_col,
                            "within": within,
                            "between": between,
                            "n_subjects": int(sub[subject_col].nunique()),
                            "table": rows,
                            "sphericity_warning": sphericity_warning,
                            "sphericity_note": ("Within-factor has ≥ 3 levels — "
                                                "if the result is borderline, validate with "
                                                "Greenhouse-Geisser-corrected p-values."
                                                if sphericity_warning else None)}}

    if test == "cochrans_q":
        # Repeated dichotomous outcomes — k columns of 0/1 per subject.
        # Tests H0: marginal probabilities are equal across columns.
        # Caller passes `columns` (list of column names).
        cols = kwargs.get("columns") or []
        if len(cols) < 2:
            raise ValueError("cochrans_q requires columns: list of ≥ 2 binary columns")
        sub = df[cols].dropna()
        X = sub.astype(int).to_numpy()
        # Bench: every value must be 0/1.
        if not np.isin(X, [0, 1]).all():
            raise ValueError("cochrans_q: all values must be 0 or 1")
        k = X.shape[1]
        N = X.shape[0]
        col_sums = X.sum(axis=0)            # successes per column
        row_sums = X.sum(axis=1)            # successes per subject
        T = float(col_sums.sum())
        Q_num = (k - 1) * (k * (col_sums ** 2).sum() - T ** 2)
        Q_den = k * T - (row_sums ** 2).sum()
        Q = float(Q_num / Q_den) if Q_den != 0 else float("nan")
        df_chi = k - 1
        p = float(1 - sps.chi2.cdf(Q, df_chi)) if np.isfinite(Q) else float("nan")
        return {"summary": {"test": "cochrans_q",
                            "Q": Q, "df": df_chi, "p": p,
                            "k": k, "N": int(N),
                            "successes_per_column": [int(x) for x in col_sums]}}

    if test in ("mcnemar_bowker", "stuart_maxwell"):
        # Both work on a square contingency table of paired categorical
        # observations: row = before, column = after, cell = count.
        # Caller passes `column` (after) and `column_b` (before).
        col2 = kwargs.get("column_b")
        if not col2:
            raise ValueError(f"{test} requires column_b")
        ct = (pd.crosstab(df[col2], df[column])
                .astype(int).to_numpy())
        if ct.shape[0] != ct.shape[1]:
            # Pad asymmetric tables to a common set of categories.
            cats = sorted(set(df[column].dropna().astype(str).unique())
                          | set(df[col2].dropna().astype(str).unique()))
            ct = (pd.crosstab(df[col2].astype(str), df[column].astype(str))
                    .reindex(index=cats, columns=cats, fill_value=0)
                    .astype(int).to_numpy())
        k = ct.shape[0]
        if test == "mcnemar_bowker":
            # χ² = Σ_{i<j} (n_ij − n_ji)² / (n_ij + n_ji)
            chi2 = 0.0
            for i in range(k):
                for j in range(i + 1, k):
                    s = ct[i, j] + ct[j, i]
                    if s > 0:
                        chi2 += (ct[i, j] - ct[j, i]) ** 2 / s
            df_chi = k * (k - 1) // 2
            p = float(1 - sps.chi2.cdf(chi2, df_chi))
            return {"summary": {"test": "mcnemar_bowker",
                                "chi2": float(chi2), "df": df_chi, "p": p,
                                "k_categories": int(k), "n": int(ct.sum()),
                                "note": "Tests symmetry of paired categorical table."}}
        else:
            # Stuart-Maxwell — k-1 df test of marginal homogeneity.
            row_totals = ct.sum(axis=1)
            col_totals = ct.sum(axis=0)
            d = (row_totals - col_totals)[:-1]      # drop one (rank-deficient)
            # Covariance matrix of d
            S = np.zeros((k - 1, k - 1))
            for i in range(k - 1):
                S[i, i] = row_totals[i] + col_totals[i] - 2 * ct[i, i]
                for j in range(k - 1):
                    if i != j:
                        S[i, j] = -(ct[i, j] + ct[j, i])
            try:
                chi2 = float(d @ np.linalg.solve(S, d))
                df_chi = k - 1
                p = float(1 - sps.chi2.cdf(chi2, df_chi))
            except np.linalg.LinAlgError:
                chi2, p, df_chi = float("nan"), float("nan"), k - 1
            return {"summary": {"test": "stuart_maxwell",
                                "chi2": chi2, "df": df_chi, "p": p,
                                "k_categories": int(k), "n": int(ct.sum()),
                                "note": "Tests marginal homogeneity — whether row "
                                        "and column distributions match."}}

    if test in ("welch_anova", "brown_forsythe_anova"):
        # Heteroscedastic-friendly k-group ANOVA.
        # Welch (1951) uses inverse-variance weights and Satterthwaite df.
        # Brown-Forsythe (1974) F* uses Σ(1 − n_k/N) σ_k² as the denominator
        # — robust when both means and variances differ.
        arrays = [g.dropna().astype(float).to_numpy()
                  for _, g in df.groupby(group_col)[column]]
        k = len(arrays)
        if k < 2:
            raise ValueError(f"{test} requires ≥ 2 groups")
        n_k = np.array([a.size for a in arrays])
        mean_k = np.array([a.mean() for a in arrays])
        var_k = np.array([a.var(ddof=1) if a.size > 1 else 0.0 for a in arrays])
        N = int(n_k.sum())
        if test == "welch_anova":
            w_k = n_k / var_k                  # inverse-variance weights
            w_sum = w_k.sum()
            mean_w = (w_k * mean_k).sum() / w_sum
            f_num = ((w_k * (mean_k - mean_w) ** 2).sum() / (k - 1))
            tmp = (1 - w_k / w_sum) ** 2 / (n_k - 1)
            f_den = 1 + 2 * (k - 2) / (k * k - 1) * tmp.sum()
            F = float(f_num / f_den)
            df_den = float((k * k - 1) / (3 * tmp.sum()))
            p = float(1 - sps.f.cdf(F, k - 1, df_den))
            method_label = "welch_anova"
        else:
            # Brown-Forsythe F* (1974): F* = Σnᵢ(ȳᵢ−ȳ)² / Σ(1−nᵢ/N)sᵢ².
            # The denominator already carries the (k−1) scaling — under H0 with
            # equal variances E[Σ(1−nᵢ/N)sᵢ²] = (k−1)σ² — so the numerator is
            # the raw between-group SS, NOT divided by (k−1). (Dividing by k−1
            # made the test too conservative by a factor of k−1.)
            ss_b = (n_k * (mean_k - (n_k * mean_k).sum() / N) ** 2).sum()
            den_sum = ((1 - n_k / N) * var_k).sum()
            F = float(ss_b / den_sum) if den_sum > 0 else float("nan")
            # Satterthwaite-approximated df_den
            num = (den_sum) ** 2
            den_df = (((1 - n_k / N) * var_k) ** 2 / (n_k - 1)).sum()
            df_den = float(num / den_df) if den_df > 0 else float("nan")
            p = float(1 - sps.f.cdf(F, k - 1, df_den)) if np.isfinite(F) and np.isfinite(df_den) else float("nan")
            method_label = "brown_forsythe_anova"
        return {"summary": {"test": method_label,
                            "F": F, "p": p,
                            "df_num": k - 1, "df_den": df_den,
                            "k": k, "N": N,
                            "n_per_group": [int(x) for x in n_k],
                            "note": "Use when groups have unequal variances. "
                                    "Equivalent power to one-way ANOVA when variances are equal."}}

    if test == "two_way_anova":
        # Type I / II / III sum-of-squares decomposition. Default Type II,
        # which Minitab uses for unbalanced designs and which is correct
        # when interaction is absent. Type III is the SAS default; conservative.
        # Type I is order-dependent (the original Bench behavior — kept as
        # an option for backward-compatibility).
        from statsmodels.formula.api import ols
        from statsmodels.stats.anova import anova_lm
        a_col = kwargs.get("factor_a") or group_col
        b_col = kwargs.get("factor_b")
        ss_type = (kwargs.get("ss_type") or "II").upper()  # 'I' | 'II' | 'III'
        if ss_type not in ("I", "II", "III"):
            raise ValueError("ss_type must be 'I', 'II', or 'III'")
        if not a_col or not b_col:
            raise ValueError("two_way_anova requires factor_a and factor_b")
        sub = df[[column, a_col, b_col]].dropna().copy()
        sub[column] = sub[column].astype(float)
        # Treat both factors as categorical via C(...) so the design matrix
        # is correct even when the underlying dtype is numeric.
        #
        # With only one observation per (a, b) cell there is no residual df
        # left to estimate error once the interaction is in the model, so the
        # full interaction model has df_resid = 0 → NaN F-tests → crash. That
        # is a *valid* design (a randomized-block / no-replication two-way);
        # the correct response is to fit the ADDITIVE model and use the
        # interaction as the error term. Detect that case and drop the
        # interaction rather than crashing with a cryptic NaN error.
        cell_counts = sub.groupby([a_col, b_col]).size()
        has_replication = bool((cell_counts > 1).any())
        ss_type_int = {"I": 1, "II": 2, "III": 3}[ss_type]
        interaction_dropped = False
        if has_replication:
            formula = f"{column} ~ C({a_col}) * C({b_col})"
            model = ols(formula, data=sub).fit()
            anova_table = anova_lm(model, typ=ss_type_int)
        else:
            # Additive model — interaction becomes the residual/error term.
            formula = f"{column} ~ C({a_col}) + C({b_col})"
            model = ols(formula, data=sub).fit()
            anova_table = anova_lm(model, typ=ss_type_int)
            interaction_dropped = True
        # Compute SS_within for partial-η² + power.
        ss_within = float(anova_table.loc["Residual", "sum_sq"])
        df_within = int(anova_table.loc["Residual", "df"])
        ss_total = float(((sub[column] - sub[column].mean()) ** 2).sum())
        ms_within = ss_within / df_within if df_within > 0 else float("nan")
        # Pretty-print row labels (strip statsmodels' C(...) wrap).
        def _label(name: str) -> str:
            if name == "Residual":  return "within"
            return (name.replace("C(", "").replace(")", "")
                        .replace(":", " × "))

        rows = []
        for src in anova_table.index:
            ss = float(anova_table.loc[src, "sum_sq"])
            dfree = int(anova_table.loc[src, "df"])
            if src == "Residual":
                rows.append({"source": "within", "ss": ss, "df": dfree,
                             "ms": float(ms_within)})
                continue
            f = float(anova_table.loc[src, "F"]) if "F" in anova_table.columns else float("nan")
            p = float(anova_table.loc[src, "PR(>F)"]) if "PR(>F)" in anova_table.columns else float("nan")
            partial_eta2 = (ss / (ss + ss_within)) if (ss + ss_within) > 0 else None
            omega2 = (((ss - dfree * ms_within) / (ss_total + ms_within))
                      if (ss_total + ms_within) > 0 and not np.isnan(ms_within) else None)
            power = None
            if df_within > 0 and not np.isnan(f) and f > 0:
                ncp = float(f * dfree)
                f_crit = sps.f.ppf(0.95, dfree, df_within)
                power = float(1 - sps.ncf.cdf(f_crit, dfree, df_within, ncp))
            rows.append({"source": _label(src), "ss": ss, "df": dfree,
                         "ms": float(ss / dfree) if dfree > 0 else float("nan"),
                         "F": f, "p": p,
                         "partial_eta_squared": partial_eta2,
                         "omega_squared": omega2,
                         "power": power, "power_label": _power_label(power)})
        # Append a 'total' row for back-compat with consumers that expect
        # the classic Minitab-style decomposition layout.
        rows.append({"source": "total", "ss": float(ss_total),
                     "df": int(len(sub) - 1)})
        return {"summary": {"test": test, "ss_type": ss_type, "table": rows,
                            "n": int(len(sub)),
                            "interaction_dropped": interaction_dropped,
                            "interaction_note": (
                                "Only one observation per cell — fitted the additive "
                                "model (no interaction term estimable). Add replicates "
                                "to test the interaction."
                                if interaction_dropped else None)}}

    if test == "mann_whitney":
        groups = list(df.groupby(group_col)[column])
        if len(groups) != 2:
            raise ValueError("mann_whitney requires exactly two groups")
        a, b = groups[0][1].dropna().astype(float), groups[1][1].dropna().astype(float)
        r = sps.mannwhitneyu(a, b, alternative="two-sided")
        # Rank-biserial effect size — the non-parametric analogue to d.
        # r_rb = 1 - 2U/(n1·n2). Range [-1, 1]; |r_rb| > 0.3 conventionally
        # "medium", > 0.5 "large". This is what JMP shows.
        n1, n2 = int(a.size), int(b.size)
        r_rb = float(1 - (2 * r.statistic) / (n1 * n2)) if n1 and n2 else None
        return {"summary": {"test": test, "U": float(r.statistic), "p": float(r.pvalue),
                            "n_a": n1, "n_b": n2,
                            "median_a": float(a.median()), "median_b": float(b.median()),
                            "rank_biserial_r": r_rb}}

    if test == "kruskal":
        arrays = [g.dropna().astype(float) for _, g in df.groupby(group_col)[column]]
        r = sps.kruskal(*arrays)
        # ε² — non-parametric analogue to η². (H − k + 1) / (n − k).
        N = sum(a.size for a in arrays)
        k = len(arrays)
        eps2 = ((float(r.statistic) - k + 1) / (N - k)
                if N > k else None)
        return {"summary": {"test": test, "H": float(r.statistic), "p": float(r.pvalue),
                            "k": k, "N": N,
                            "n_per_group": [int(a.size) for a in arrays],
                            "epsilon_squared": eps2}}

    if test == "wilcoxon_signed_rank":
        # Paired non-parametric. Caller supplies column and column_b.
        col2 = kwargs.get("column_b") or kwargs.get("paired_col")
        if not col2:
            raise ValueError("wilcoxon_signed_rank requires column_b")
        sub = df[[column, col2]].dropna().astype(float)
        diff = sub[column] - sub[col2]
        # zero_method="wilcox" drops zero diffs (default)
        r = sps.wilcoxon(diff)
        # Rank-biserial r as effect size: r = W_+ / (n*(n+1)/2) * 2 - 1.
        # Cohen 1988 conventions on rank-biserial: small 0.1, med 0.3, large 0.5.
        n_eff = int(len(diff))
        max_W = n_eff * (n_eff + 1) / 2
        # Use derivative effect-size from the test statistic to stay robust to
        # scipy's W sign convention (which differs across versions).
        r_rb = float((r.statistic - max_W / 2) / (max_W / 2)) if max_W else None
        return {"summary": {"test": test, "W": float(r.statistic), "p": float(r.pvalue),
                            "n": n_eff, "median_diff": float(diff.median()),
                            "rank_biserial_r": r_rb}}

    if test == "sign_test":
        # One-sample sign test against a hypothesized median.
        # Or paired: provide column_b and we test median(diff) == 0.
        # Accept both `mu0` (consistent with the other one-sample tests
        # in this file) and `median0` (legacy). Previously only `median0`
        # was honoured, which silently defaulted to 0 and made every sign
        # test against a non-zero mu0 answer the wrong question.
        col2 = kwargs.get("column_b")
        if kwargs.get("mu0") is not None:
            median0 = float(kwargs["mu0"])
        else:
            median0 = float(kwargs.get("median0") or 0.0)
        if col2:
            sub = df[[column, col2]].dropna().astype(float)
            diff = (sub[column] - sub[col2]).to_numpy()
            data = diff
            label = "median_diff"
        else:
            data = df[column].dropna().astype(float).to_numpy() - median0
            label = "median_minus_h0"
        nonzero = data[data != 0]
        n = nonzero.size
        plus = int((nonzero > 0).sum())
        # Two-sided binomial test against p=0.5.
        result = sps.binomtest(plus, n, p=0.5, alternative="two-sided") if n else None
        return {"summary": {"test": test, "n": n, "plus": plus,
                            "p": float(result.pvalue) if result else float("nan"),
                            label: float(np.median(data)) if data.size else float("nan"),
                            "median0": median0 if not col2 else None}}

    if test == "mood_median":
        # Multi-group test for equal medians. scipy.stats.median_test.
        arrays = [g.dropna().astype(float).to_numpy() for _, g in df.groupby(group_col)[column]]
        stat, p, med, table = sps.median_test(*arrays)
        return {"summary": {"test": test, "chi2": float(stat), "p": float(p),
                            "grand_median": float(med),
                            "n_per_group": [int(a.size) for a in arrays]}}

    # ---------- Variances ----------

    if test == "levene":
        arrays = [g.dropna().astype(float) for _, g in df.groupby(group_col)[column]]
        center = kwargs.get("center", "median")  # Brown-Forsythe by default — robust.
        r = sps.levene(*arrays, center=center)
        # Ratio of largest:smallest variance — practical effect-size readout.
        # Big ratio (>4) → Welch's t-test / Games-Howell instead.
        vars_ = [float(a.var(ddof=1)) for a in arrays if a.size > 1]
        var_ratio = (max(vars_) / min(vars_)) if vars_ and min(vars_) > 0 else None
        return {"summary": {"test": test, "W": float(r.statistic), "p": float(r.pvalue),
                            "center": center, "k": len(arrays),
                            "n_per_group": [int(a.size) for a in arrays],
                            "variance_ratio": var_ratio,
                            "variances": vars_}}

    if test == "bartlett":
        # Sensitive to non-normality; Levene is the safer default. We expose
        # Bartlett because Minitab does and BBs sometimes prefer it when
        # data are known to be normal.
        arrays = [g.dropna().astype(float) for _, g in df.groupby(group_col)[column]]
        r = sps.bartlett(*arrays)
        vars_ = [float(a.var(ddof=1)) for a in arrays if a.size > 1]
        var_ratio = (max(vars_) / min(vars_)) if vars_ and min(vars_) > 0 else None
        return {"summary": {"test": test, "T": float(r.statistic), "p": float(r.pvalue),
                            "k": len(arrays),
                            "n_per_group": [int(a.size) for a in arrays],
                            "variance_ratio": var_ratio,
                            "variances": vars_}}

    if test == "f_test_variances":
        # Two-sample F test for equality of variances. Use only when both
        # samples are normal — Levene/Bartlett otherwise.
        groups = list(df.groupby(group_col)[column])
        if len(groups) != 2:
            raise ValueError("f_test_variances requires exactly two groups")
        a, b = groups[0][1].dropna().astype(float), groups[1][1].dropna().astype(float)
        va, vb = a.var(ddof=1), b.var(ddof=1)
        if va == 0 or vb == 0:
            raise ValueError("f_test_variances: zero variance in one or both groups")
        F = va / vb
        df1, df2 = a.size - 1, b.size - 1
        p_one = float(1 - sps.f.cdf(F, df1, df2)) if F > 1 else float(sps.f.cdf(F, df1, df2))
        p = 2 * min(p_one, 1 - p_one)
        return {"summary": {"test": test, "F": float(F), "p": float(p),
                            "df_num": int(df1), "df_den": int(df2),
                            "var_a": float(va), "var_b": float(vb)}}

    # ---------- Proportions / counts ----------

    if test == "chi_square":
        ct = df.pivot_table(index=group_col, columns=column, aggfunc="size", fill_value=0)
        chi2, p, dof, _ = sps.chi2_contingency(ct.values)
        n = int(ct.values.sum())
        rows, cols = ct.values.shape
        v = _cramers_v(float(chi2), n, rows, cols)
        return {"summary": {"test": test, "chi2": float(chi2), "p": float(p),
                            "dof": int(dof), "n": n,
                            "rows": rows, "cols": cols,
                            "cramers_v": v,
                            "phi": _phi(float(chi2), n) if rows == 2 and cols == 2 else None}}

    if test == "fisher_exact":
        # 2x2 only — used when expected counts are too small for chi-square.
        ct = df.pivot_table(index=group_col, columns=column, aggfunc="size", fill_value=0)
        if ct.shape != (2, 2):
            raise ValueError("fisher_exact requires a 2x2 contingency table")
        odds, p = sps.fisher_exact(ct.values, alternative="two-sided")
        n = int(ct.values.sum())
        return {"summary": {"test": test, "odds_ratio": float(odds), "p": float(p),
                            "table": ct.values.tolist(),
                            "n": n,
                            "log_odds_ratio": (float(np.log(odds)) if odds and odds > 0
                                               and np.isfinite(odds) else None)}}

    if test == "one_proportion":
        x = df[column].dropna().astype(int)
        successes = int(x.sum()); n = int(x.size)
        p0 = float(kwargs.get("p0") or 0.5)
        result = sps.binomtest(successes, n, p=p0, alternative="two-sided")
        p_hat = successes / n if n else None
        # Wilson 95% CI for the proportion — more accurate than normal-approx
        # near 0 / 1. Used by Minitab as the default.
        if n and p_hat is not None:
            z = 1.96
            denom = 1 + z**2 / n
            centre = (p_hat + z**2 / (2 * n)) / denom
            half = z * np.sqrt(p_hat * (1 - p_hat) / n + z**2 / (4 * n**2)) / denom
            ci = [float(max(0, centre - half)), float(min(1, centre + half))]
        else:
            ci = [None, None]
        # Cohen's h effect size: |2 arcsin(√p̂) − 2 arcsin(√p0)|.
        h = (float(abs(2 * np.arcsin(np.sqrt(p_hat)) - 2 * np.arcsin(np.sqrt(p0))))
             if p_hat is not None else None)
        # Post-hoc power for the one-proportion z-test.
        power = None
        if n and h is not None and h > 0:
            ncp = h * np.sqrt(n)
            z_crit = sps.norm.ppf(0.975)
            power = float(1 - sps.norm.cdf(z_crit - ncp) + sps.norm.cdf(-z_crit - ncp))
        return {"summary": {"test": test, "successes": successes, "n": n,
                            "p_hat": p_hat, "p0": p0, "p": float(result.pvalue),
                            "ci_95_wilson": ci,
                            "cohens_h": h,
                            "power": power, "power_label": _power_label(power)}}

    if test == "two_proportions":
        groups = list(df.groupby(group_col)[column])
        if len(groups) != 2:
            raise ValueError("two_proportions requires exactly two groups")
        (la, a), (lb, b) = groups
        a = a.dropna().astype(int); b = b.dropna().astype(int)
        s1, n1 = int(a.sum()), int(a.size)
        s2, n2 = int(b.sum()), int(b.size)
        p1, p2 = (s1 / n1 if n1 else 0), (s2 / n2 if n2 else 0)
        p_pool = (s1 + s2) / (n1 + n2) if (n1 + n2) else 0
        se = np.sqrt(p_pool * (1 - p_pool) * (1 / n1 + 1 / n2)) if (n1 and n2) else 0
        z = (p1 - p2) / se if se else 0.0
        p = 2 * (1 - sps.norm.cdf(abs(z)))
        # Cohen's h for two proportions
        h = float(abs(2 * np.arcsin(np.sqrt(p1)) - 2 * np.arcsin(np.sqrt(p2))))
        # Unpooled SE for CI on difference (Newcombe is exact-er but this is
        # what every Minitab user has been reading for 30 years).
        se_diff = (np.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
                   if n1 and n2 else 0)
        ci_diff = [float(p1 - p2 - 1.96 * se_diff), float(p1 - p2 + 1.96 * se_diff)]
        # Power for two-proportion z-test
        power = None
        if n1 and n2 and h > 0:
            ncp = h / np.sqrt(1 / n1 + 1 / n2)
            z_crit = sps.norm.ppf(0.975)
            power = float(1 - sps.norm.cdf(z_crit - ncp) + sps.norm.cdf(-z_crit - ncp))
        return {"summary": {"test": test,
                            "groups": {str(la): {"s": s1, "n": n1, "p": p1},
                                       str(lb): {"s": s2, "n": n2, "p": p2}},
                            "z": float(z), "p": float(p),
                            "diff": float(p1 - p2),
                            "ci_95_diff": ci_diff,
                            "cohens_h": h,
                            "power": power, "power_label": _power_label(power)}}

    # ---------- Normality ----------

    if test == "anderson_darling_normality":
        x = df[column].dropna().astype(float).to_numpy()
        r = sps.anderson(x, dist="norm")
        # Convert AD statistic to an approximate p-value using D'Agostino
        # & Stephens (1986) for normal distribution.
        # Adjusted A* per their formula.
        n = x.size
        ad = float(r.statistic)
        ad_adj = ad * (1 + 0.75 / n + 2.25 / (n * n))
        if ad_adj < 0.2:
            p = 1 - np.exp(-13.436 + 101.14 * ad_adj - 223.73 * ad_adj ** 2)
        elif ad_adj < 0.34:
            p = 1 - np.exp(-8.318 + 42.796 * ad_adj - 59.938 * ad_adj ** 2)
        elif ad_adj < 0.6:
            p = np.exp(0.9177 - 4.279 * ad_adj - 1.38 * ad_adj ** 2)
        else:
            p = np.exp(1.2937 - 5.709 * ad_adj + 0.0186 * ad_adj ** 2)
        return {"summary": {"test": test, "AD": ad, "AD_adjusted": float(ad_adj),
                            "p_approx": float(np.clip(p, 0.0, 1.0)),
                            "n": int(n),
                            "interpretation": "p < 0.05 → reject normality"}}

    if test == "ryan_joiner":
        # Ryan-Joiner is essentially Shapiro-Wilk-equivalent. Use Shapiro
        # (always available in scipy) and note the equivalence.
        x = df[column].dropna().astype(float).to_numpy()
        if x.size < 3 or x.size > 5000:
            raise ValueError("ryan_joiner: n must be between 3 and 5000")
        r = sps.shapiro(x)
        return {"summary": {"test": test, "W": float(r.statistic), "p": float(r.pvalue),
                            "n": int(x.size),
                            "note": "Bill uses Shapiro-Wilk as the Ryan-Joiner equivalent (statistically near-identical)."}}

    if test == "kolmogorov_smirnov_normal":
        x = df[column].dropna().astype(float).to_numpy()
        # Standardize, KS against N(0,1).
        mu, sd = x.mean(), x.std(ddof=1)
        if sd == 0:
            raise ValueError("ks_normal: zero variance")
        z = (x - mu) / sd
        D, p = sps.kstest(z, "norm")
        return {"summary": {"test": test, "D": float(D), "p": float(p),
                            "n": int(x.size), "mean": float(mu), "stdev": float(sd)}}

    # ---------- Equivalence tests (TOST) ----------
    if test == "tost_one_sample":
        # Two One-Sided Tests: prove |μ - μ0| < δ. column = sample, mu0,
        # delta = equivalence margin.
        x = df[column].dropna().astype(float).to_numpy()
        mu0 = float(kwargs.get("mu0") or 0.0)
        delta = float(kwargs.get("delta"))
        if delta <= 0:
            raise ValueError("tost requires delta > 0")
        n = x.size
        sd = float(np.std(x, ddof=1))
        se = sd / np.sqrt(n) if n > 0 else float("nan")
        t1 = (x.mean() - (mu0 - delta)) / se
        t2 = ((mu0 + delta) - x.mean()) / se
        p1 = float(1 - sps.t.cdf(t1, df=n - 1))
        p2 = float(1 - sps.t.cdf(t2, df=n - 1))
        p = float(max(p1, p2))
        return {"summary": {"test": test, "n": int(n), "mean": float(x.mean()),
                            "mu0": mu0, "delta": delta,
                            "p_lower": p1, "p_upper": p2, "p": p,
                            "equivalent": p < 0.05}}

    if test == "tost_two_sample":
        groups = list(df.groupby(group_col)[column])
        if len(groups) != 2:
            raise ValueError("tost_two_sample requires exactly two groups")
        a, b = groups[0][1].dropna().astype(float), groups[1][1].dropna().astype(float)
        delta = float(kwargs.get("delta"))
        if delta <= 0:
            raise ValueError("tost requires delta > 0")
        diff = float(a.mean() - b.mean())
        sp = np.sqrt(((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1)) / (a.size + b.size - 2))
        se = sp * np.sqrt(1 / a.size + 1 / b.size)
        df_pool = a.size + b.size - 2
        t1 = (diff - (-delta)) / se
        t2 = (delta - diff) / se
        p1 = float(1 - sps.t.cdf(t1, df=df_pool))
        p2 = float(1 - sps.t.cdf(t2, df=df_pool))
        return {"summary": {"test": test, "n_a": int(a.size), "n_b": int(b.size),
                            "mean_diff": diff, "delta": delta,
                            "p_lower": p1, "p_upper": p2, "p": max(p1, p2),
                            "equivalent": max(p1, p2) < 0.05}}

    # ---------- Friedman / Runs test ----------

    if test == "friedman":
        # Repeated-measures non-parametric. Caller passes a wide-format
        # data set: one row per subject, columns are the conditions.
        cols = kwargs.get("columns") or []
        if len(cols) < 2:
            raise ValueError("friedman requires kwargs.columns with ≥2 columns")
        sub = df[cols].dropna().astype(float)
        stat, p = sps.friedmanchisquare(*[sub[c].to_numpy() for c in cols])
        return {"summary": {"test": test, "chi2": float(stat), "p": float(p),
                            "n_subjects": int(len(sub)), "k_conditions": len(cols)}}

    if test == "runs":
        # Wald-Wolfowitz runs test for randomness about the median.
        x = df[column].dropna().astype(float).to_numpy()
        median = float(np.median(x))
        signs = (x > median).astype(int)
        signs = signs[(x != median)]   # drop ties at median
        runs = 1 + int((np.diff(signs) != 0).sum())
        n1 = int(signs.sum()); n2 = signs.size - n1
        if n1 == 0 or n2 == 0:
            return {"summary": {"test": test, "p": 1.0, "runs": runs,
                                "note": "all values on one side of median"}}
        mu = 2 * n1 * n2 / (n1 + n2) + 1
        var = 2 * n1 * n2 * (2 * n1 * n2 - n1 - n2) / ((n1 + n2) ** 2 * (n1 + n2 - 1))
        z = (runs - mu) / np.sqrt(var)
        p = float(2 * (1 - sps.norm.cdf(abs(z))))
        return {"summary": {"test": test, "runs": runs, "n_above": n1, "n_below": n2,
                            "z": float(z), "p": p,
                            "interpretation": "p<0.05 → non-random sequence"}}

    # ---------- Outlier tests ----------

    if test == "grubbs":
        # Grubbs' test for one outlier. Two-sided.
        x = df[column].dropna().astype(float).to_numpy()
        n = x.size
        if n < 3:
            raise ValueError("grubbs: need at least 3 observations")
        mean = x.mean(); sd = x.std(ddof=1)
        if sd == 0:
            raise ValueError("grubbs: zero variance")
        z = np.abs(x - mean) / sd
        idx = int(np.argmax(z))
        G = float(z[idx])
        # Critical value via t-distribution (Grubbs 1969).
        t_crit = sps.t.ppf(1 - 0.025 / n, df=n - 2)
        crit = ((n - 1) / np.sqrt(n)) * np.sqrt(t_crit ** 2 / (n - 2 + t_crit ** 2))
        return {"summary": {"test": test, "n": int(n),
                            "G": G, "critical_value": float(crit),
                            "outlier_index": idx,
                            "outlier_value": float(x[idx]),
                            "is_outlier_alpha_0_05": bool(G > crit)}}

    if test == "dixon_q":
        # Dixon's Q test for a single outlier in small samples (3 ≤ n ≤ 30).
        x = np.sort(df[column].dropna().astype(float).to_numpy())
        n = x.size
        if n < 3 or n > 30:
            raise ValueError("dixon_q: n must be in [3, 30]")
        # Q for the suspect (smallest or largest) value.
        gap_low = (x[1] - x[0]) / (x[-1] - x[0]) if x[-1] != x[0] else 0
        gap_high = (x[-1] - x[-2]) / (x[-1] - x[0]) if x[-1] != x[0] else 0
        # Approximate critical values from Rorabacher (1991) at α=0.05.
        Q_CRIT_05 = {3: 0.970, 4: 0.829, 5: 0.710, 6: 0.628, 7: 0.569,
                     8: 0.608, 9: 0.564, 10: 0.530, 12: 0.479, 15: 0.438,
                     20: 0.391, 25: 0.359, 30: 0.336}
        # Find nearest tabulated critical value.
        crit_n = min(Q_CRIT_05.keys(), key=lambda k: abs(k - n))
        crit = Q_CRIT_05[crit_n]
        Q = max(gap_low, gap_high)
        suspect = x[0] if gap_low > gap_high else x[-1]
        return {"summary": {"test": test, "n": int(n),
                            "Q": float(Q), "critical_value_alpha_0_05": float(crit),
                            "suspect_value": float(suspect),
                            "is_outlier_alpha_0_05": bool(Q > crit)}}

    if test == "mcnemar":
        # Paired binary outcomes — two columns or one column + group_col
        # encoding before/after as 0/1. Tests whether the marginal proportions
        # differ. b and c are the discordant counts (off-diagonals of the 2x2).
        # `column_b` arrives via **kwargs, not as a positional parameter —
        # previously referenced as a bare name, which NameError'd at runtime
        # whenever McNemar was actually called.
        column_b = kwargs.get("column_b")
        if column_b:
            a = df[column].astype(int).to_numpy()
            b_arr = df[column_b].astype(int).to_numpy()
        elif group_col:
            sub = df[[column, group_col]].dropna()
            levels = sorted(sub[group_col].astype(str).unique())
            if len(levels) != 2:
                raise ValueError("mcnemar requires exactly 2 paired levels in group_col")
            # Assumes the same subject id ordering across the two levels.
            a = sub[sub[group_col].astype(str) == levels[0]][column].astype(int).to_numpy()
            b_arr = sub[sub[group_col].astype(str) == levels[1]][column].astype(int).to_numpy()
        else:
            raise ValueError("mcnemar requires either column_b or group_col")
        if len(a) != len(b_arr):
            raise ValueError("mcnemar: pairs must have equal length")
        # 2x2 contingency on (a, b) with values in {0, 1}
        b = int(((a == 0) & (b_arr == 1)).sum())   # 0→1
        c = int(((a == 1) & (b_arr == 0)).sum())   # 1→0
        # Use the exact binomial form for small (b + c); chi-square for large.
        n_disc = b + c
        if n_disc == 0:
            return {"summary": {"test": "mcnemar", "n": int(len(a)),
                                "b_01": b, "c_10": c,
                                "statistic": 0.0, "p":1.0,
                                "method": "no discordant pairs"}}
        if n_disc < 25:
            # Exact two-sided binomial test on min(b, c).
            from scipy.stats import binomtest
            p = float(binomtest(min(b, c), n=n_disc, p=0.5).pvalue)
            return {"summary": {"test": "mcnemar", "n": int(len(a)),
                                "b_01": b, "c_10": c, "n_discordant": n_disc,
                                "statistic": float(min(b, c)),
                                "p":p, "method": "exact binomial"}}
        # Continuity-corrected chi-square.
        stat = ((abs(b - c) - 1.0) ** 2) / n_disc
        p = float(1 - sps.chi2.cdf(stat, df=1))
        return {"summary": {"test": "mcnemar", "n": int(len(a)),
                            "b_01": b, "c_10": c, "n_discordant": n_disc,
                            "statistic": float(stat), "df": 1,
                            "p":p, "method": "chi-square (continuity-corrected)"}}

    raise ValueError(f"unsupported test: {test}")


# Surface the supported test names for callers (UI dropdown, route validation).
SUPPORTED_TESTS = (
    "one_sample_t", "two_sample_t", "paired_t",
    "one_way_anova", "anova", "two_way_anova",
    "mann_whitney", "kruskal", "wilcoxon_signed_rank", "sign_test", "mood_median",
    "levene", "bartlett", "f_test_variances",
    "chi_square", "fisher_exact", "one_proportion", "two_proportions",
    "anderson_darling_normality", "ryan_joiner", "kolmogorov_smirnov_normal",
    "tost_one_sample", "tost_two_sample", "friedman", "runs", "rm_anova",
    "welch_anova", "brown_forsythe_anova",
    "cochrans_q", "mcnemar_bowker", "stuart_maxwell",
    "grubbs", "dixon_q",
)
