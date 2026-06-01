"""OLS linear regression + GLM + stepwise / best-subsets variable
selection + logistic / Poisson / nonlinear extensions. Returns
coefficients, p-values, R²/adj R², residual diagnostics, fitted-vs-actual
+ residual charts."""
from __future__ import annotations

import io
from itertools import combinations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import optimize, stats as sps


# ───────── Diagnostic helpers (VIF, influence, ROC) ─────────

def _vif(X: np.ndarray, names: list[str]) -> list[dict]:
    """Variance Inflation Factor per predictor. VIF > 5 flags potential
    multicollinearity; > 10 is the hard threshold every regression textbook
    cites. Computed as 1 / (1 − R²_j) where R²_j is from regressing each
    predictor on the others."""
    if X.shape[1] < 2:
        return [{"name": names[0] if names else "x", "vif": None,
                 "note": "single predictor — VIF not defined"}]
    out = []
    for j, name in enumerate(names):
        try:
            others = np.delete(X, j, axis=1)
            others_c = sm.add_constant(others, has_constant="add")
            m = sm.OLS(X[:, j], others_c).fit()
            r2 = float(m.rsquared)
            vif = float(1 / (1 - r2)) if r2 < 1 - 1e-12 else float("inf")
        except Exception:
            vif, r2 = float("nan"), float("nan")
        out.append({"name": name, "vif": vif, "r2_aux": r2,
                    "flag": ("severe" if vif > 10 else "moderate" if vif > 5 else "ok")})
    return out


def _influence(model) -> dict:
    """Cook's D, leverage (hat-diagonal), DFFITS, and standardized residuals
    for every observation. Returns indices flagged by each rule of thumb."""
    try:
        infl = model.get_influence()
        cooks_d = infl.cooks_distance[0]
        leverage = infl.hat_matrix_diag
        dffits_arr = infl.dffits[0]
        resid_std = infl.resid_studentized_internal
    except Exception:
        return {"available": False}
    n = len(cooks_d)
    p = int(model.df_model + 1)   # includes intercept
    # Cook's D > 4/n is the loosest rule; > 1 is the strict one.
    cook_thresh_loose = 4 / n if n else float("inf")
    leverage_thresh = 2 * p / n if n else float("inf")          # > 2p/n high
    dffits_thresh = 2 * np.sqrt(p / n) if n else float("inf")
    return {
        "available": True,
        "n": int(n),
        "high_cooks_d": [int(i) for i in np.where(cooks_d > cook_thresh_loose)[0]],
        "high_leverage": [int(i) for i in np.where(leverage > leverage_thresh)[0]],
        "high_dffits": [int(i) for i in np.where(np.abs(dffits_arr) > dffits_thresh)[0]],
        "outlier_studentized": [int(i) for i in np.where(np.abs(resid_std) > 3)[0]],
        "cooks_d_thresh": float(cook_thresh_loose),
        "leverage_thresh": float(leverage_thresh),
        "dffits_thresh": float(dffits_thresh),
        # Compact summary stats — full per-row arrays are too verbose for JSON.
        "max_cooks_d": float(np.max(cooks_d)) if n else None,
        "max_leverage": float(np.max(leverage)) if n else None,
    }


def _roc_auc(y_true: np.ndarray, y_score: np.ndarray) -> dict:
    """ROC curve points + AUC for a binary classifier. y_true must be 0/1,
    y_score is the predicted probability of class 1."""
    y_true = np.asarray(y_true).astype(int)
    y_score = np.asarray(y_score, dtype=float)
    # Sort by descending score; sweep threshold.
    order = np.argsort(-y_score)
    y = y_true[order]
    s = y_score[order]
    P = int(y.sum())
    N = int(len(y) - P)
    if P == 0 or N == 0:
        return {"available": False, "reason": "need both classes present"}
    tp = np.cumsum(y == 1)
    fp = np.cumsum(y == 0)
    tpr = tp / P
    fpr = fp / N
    # Trapezoidal AUC
    auc = float(np.trapezoid(tpr, fpr))
    # Youden's J — best threshold by max(TPR - FPR)
    j = tpr - fpr
    best_idx = int(np.argmax(j))
    # Down-sample to ~50 points for JSON sanity on large datasets.
    if len(s) > 50:
        idx = np.linspace(0, len(s) - 1, 50).astype(int)
        curve = [{"fpr": float(fpr[i]), "tpr": float(tpr[i]), "threshold": float(s[i])}
                 for i in idx]
    else:
        curve = [{"fpr": float(fpr[i]), "tpr": float(tpr[i]), "threshold": float(s[i])}
                 for i in range(len(s))]
    return {"available": True,
            "auc": auc,
            "curve": curve,
            "best_threshold": float(s[best_idx]),
            "best_tpr": float(tpr[best_idx]),
            "best_fpr": float(fpr[best_idx]),
            "interpretation": ("excellent" if auc >= 0.9
                              else "good" if auc >= 0.8
                              else "fair" if auc >= 0.7
                              else "poor")}


def _hosmer_lemeshow(y_true: np.ndarray, y_score: np.ndarray, g: int = 10) -> dict:
    """Hosmer-Lemeshow goodness-of-fit test for logistic regression. Bins
    predictions into g groups by predicted probability, compares observed
    vs expected positives per bin via χ². p > 0.05 means good fit (no
    significant lack-of-fit)."""
    y_true = np.asarray(y_true).astype(int)
    y_score = np.asarray(y_score, dtype=float)
    n = len(y_true)
    if n < g * 5:
        return {"available": False, "reason": f"need n ≥ {g * 5} for {g} groups"}
    # Bin by quantile of predicted probability
    order = np.argsort(y_score)
    bins = np.array_split(order, g)
    chi2 = 0.0
    table = []
    for k, idx in enumerate(bins):
        obs1 = int(y_true[idx].sum())
        obs0 = int(len(idx) - obs1)
        exp1 = float(y_score[idx].sum())
        exp0 = float(len(idx) - exp1)
        # Skip degenerate cells — Hosmer-Lemeshow can't divide by zero.
        if exp1 > 0:  chi2 += (obs1 - exp1) ** 2 / exp1
        if exp0 > 0:  chi2 += (obs0 - exp0) ** 2 / exp0
        table.append({"group": k + 1, "n": int(len(idx)),
                      "observed_1": obs1, "expected_1": exp1,
                      "observed_0": obs0, "expected_0": exp0})
    df_chi = g - 2
    p = float(1 - sps.chi2.cdf(chi2, df_chi)) if df_chi > 0 else None
    return {"available": True, "chi2": float(chi2), "df": df_chi,
            "p": p, "n_groups": g,
            "verdict": ("good fit" if p is not None and p > 0.05 else "lack of fit"),
            "table": table}


def compute(df: pd.DataFrame, response: str, predictors: list[str]) -> dict:
    if response not in df.columns:
        raise ValueError(f"response {response!r} not in dataset")
    bad = [p for p in predictors if p not in df.columns]
    if bad:
        raise ValueError(f"predictors not in dataset: {bad}")

    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    y = sub[response].to_numpy()
    X = sub[predictors].to_numpy()
    Xc = sm.add_constant(X, has_constant="add")
    model = sm.OLS(y, Xc).fit()

    coefs = []
    names = ["(Intercept)"] + predictors
    for name, b, se, p, ci_l, ci_h in zip(
        names, model.params, model.bse, model.pvalues,
        model.conf_int()[:, 0], model.conf_int()[:, 1],
    ):
        coefs.append({"name": name, "coef": float(b), "std_err": float(se),
                      "p": float(p), "ci_lo": float(ci_l), "ci_hi": float(ci_h)})

    fitted = model.fittedvalues
    resid = model.resid

    fig, axes = plt.subplots(1, 2, figsize=(10, 3.6))
    axes[0].scatter(fitted, y); lo, hi = float(np.min(y)), float(np.max(y))
    axes[0].plot([lo, hi], [lo, hi], linestyle="--")
    axes[0].set_xlabel("Fitted"); axes[0].set_ylabel("Actual"); axes[0].set_title("Fitted vs Actual")
    axes[1].scatter(fitted, resid); axes[1].axhline(0, linestyle="--")
    axes[1].set_xlabel("Fitted"); axes[1].set_ylabel("Residual"); axes[1].set_title("Residuals")

    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    # Diagnostics — VIF (multicollinearity) + influence (Cook's D, leverage,
    # DFFITS, outliers). Minitab/JMP always show these; we surface them
    # alongside the coefficient table.
    vif_table = _vif(X, predictors) if X.shape[1] >= 1 else []
    influence = _influence(model)
    # Durbin-Watson for residual autocorrelation (1.5 < DW < 2.5 ≈ no issue).
    try:
        from statsmodels.stats.stattools import durbin_watson
        dw = float(durbin_watson(resid))
    except Exception:
        dw = None
    # Breusch-Pagan for heteroscedasticity (p < 0.05 → variance changes
    # with fitted value → consider weighted least squares or a transform).
    try:
        from statsmodels.stats.diagnostic import het_breuschpagan
        bp_lm, bp_lm_p, _, _ = het_breuschpagan(resid, Xc)
        bp = {"statistic": float(bp_lm), "p": float(bp_lm_p)}
    except Exception:
        bp = None

    return {
        "summary": {
            "n": int(len(y)),
            "r2": float(model.rsquared),
            "adj_r2": float(model.rsquared_adj),
            "f_stat": float(model.fvalue) if model.fvalue is not None else None,
            "f_p": float(model.f_pvalue) if model.f_pvalue is not None else None,
            "rmse": float(np.sqrt(model.mse_resid)),
            "aic": float(model.aic), "bic": float(model.bic),
            "coefficients": coefs,
            "vif": vif_table,
            "influence": influence,
            "durbin_watson": dw,
            "breusch_pagan": bp,
        },
        "chart_png": buf.getvalue(),
    }


# ───────── Stepwise + best-subsets ─────────

def stepwise(df: pd.DataFrame, response: str, predictors: list[str],
             alpha_in: float = 0.05, alpha_out: float = 0.10,
             direction: str = "both") -> dict:
    """Stepwise regression — adds and removes predictors based on p-values.
    direction: 'forward' | 'backward' | 'both' (default).

    Reports the path (which variables entered/exited at each step) and
    the final fitted model. Use cautiously — stepwise inflates Type I
    error rates and biases coefficients."""
    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    y = sub[response].to_numpy()
    if direction not in ("forward", "backward", "both"):
        raise ValueError("direction must be forward / backward / both")

    in_model = [] if direction != "backward" else list(predictors)
    out_of_model = list(predictors) if direction != "backward" else []
    history = []
    while True:
        changed = False
        # Try adding each out-of-model predictor.
        if direction in ("forward", "both") and out_of_model:
            best_p = 1.0; best_var = None
            for v in out_of_model:
                trial = in_model + [v]
                X = sm.add_constant(sub[trial].to_numpy(), has_constant="add")
                m = sm.OLS(y, X).fit()
                p_v = m.pvalues[-1]
                if p_v < best_p:
                    best_p, best_var = p_v, v
            if best_var is not None and best_p < alpha_in:
                in_model.append(best_var)
                out_of_model.remove(best_var)
                history.append({"action": "enter", "variable": best_var, "p": float(best_p)})
                changed = True
        # Try removing the worst in-model predictor.
        if direction in ("backward", "both") and in_model:
            X = sm.add_constant(sub[in_model].to_numpy(), has_constant="add")
            m = sm.OLS(y, X).fit()
            ps = m.pvalues[1:]    # skip intercept
            worst_idx = int(np.argmax(ps))
            worst_p = float(ps[worst_idx])
            if worst_p > alpha_out:
                v = in_model.pop(worst_idx)
                out_of_model.append(v)
                history.append({"action": "exit", "variable": v, "p": worst_p})
                changed = True
        if not changed:
            break

    if not in_model:
        return {"summary": {"method": "stepwise", "selected": [], "history": history,
                            "note": "no predictors met entry criterion"}}
    X = sm.add_constant(sub[in_model].to_numpy(), has_constant="add")
    final = sm.OLS(y, X).fit()
    return {"summary": {
        "method": "stepwise", "direction": direction,
        "alpha_in": alpha_in, "alpha_out": alpha_out,
        "selected": list(in_model),
        "history": history,
        "n": int(len(y)),
        "r2": float(final.rsquared), "adj_r2": float(final.rsquared_adj),
        "coefficients": [
            {"name": n, "coef": float(b), "p": float(p)}
            for n, b, p in zip(["(Intercept)"] + in_model, final.params, final.pvalues)
        ],
    }}


def best_subsets(df: pd.DataFrame, response: str, predictors: list[str],
                 max_k: int | None = None) -> dict:
    """Best-subsets regression — exhaustive search over subsets, ranked
    by adjusted R². Reports the best subset of each size up to max_k."""
    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    y = sub[response].to_numpy()
    p = len(predictors)
    if max_k is None:
        max_k = min(p, 8)
    by_size = {}
    for k in range(1, max_k + 1):
        best = None
        for combo in combinations(predictors, k):
            X = sm.add_constant(sub[list(combo)].to_numpy(), has_constant="add")
            m = sm.OLS(y, X).fit()
            adj = float(m.rsquared_adj)
            if best is None or adj > best["adj_r2"]:
                best = {"size": k, "predictors": list(combo),
                        "adj_r2": adj,
                        "r2": float(m.rsquared),
                        "AIC": float(m.aic), "BIC": float(m.bic)}
        by_size[k] = best
    overall = max(by_size.values(), key=lambda r: r["adj_r2"])
    return {"summary": {
        "method": "best_subsets",
        "max_k_searched": max_k,
        "best_per_size": list(by_size.values()),
        "overall_best": overall,
    }}


# ───────── General Linear Model ─────────

def glm(df: pd.DataFrame, formula: str, family: str = "gaussian") -> dict:
    """General Linear Model via formula syntax. Supports gaussian (linear),
    binomial (logistic), poisson, gamma. The formula is statsmodels-style
    e.g. 'y ~ A + B + A:B + C + I(C**2)'.

    Categorical predictors should be wrapped in C() in the formula, e.g.
    'y ~ C(line) + C(shift)'."""
    fam_map = {
        "gaussian": sm.families.Gaussian(),
        "binomial": sm.families.Binomial(),
        "poisson":  sm.families.Poisson(),
        "gamma":    sm.families.Gamma(),
    }
    if family not in fam_map:
        raise ValueError(f"family must be one of {list(fam_map)}")
    model = smf.glm(formula=formula, data=df, family=fam_map[family]).fit()
    coefs = [
        {"name": n, "coef": float(b), "std_err": float(se),
         "p": float(p), "ci_lo": float(ci_l), "ci_hi": float(ci_h)}
        for n, b, se, p, ci_l, ci_h in zip(
            model.params.index, model.params, model.bse, model.pvalues,
            model.conf_int().iloc[:, 0], model.conf_int().iloc[:, 1],
        )
    ]
    return {"summary": {
        "method": "glm", "family": family, "formula": formula,
        "n": int(model.nobs),
        "log_likelihood": float(model.llf),
        "AIC": float(model.aic), "BIC": float(model.bic_llf),
        "deviance": float(model.deviance),
        "pseudo_r2_mcfadden": float(1 - model.llf / model.llnull) if model.llnull != 0 else None,
        "coefficients": coefs,
    }}


# ───────── Logistic / nominal / ordinal / Poisson regression ─────────

def logistic(df: pd.DataFrame, response: str, predictors: list[str]) -> dict:
    """Binary logistic regression. response should be 0/1 or two-valued."""
    sub = df[[response] + predictors].dropna()
    y = sub[response]
    if y.dtype == object:
        levels = sorted(y.unique())
        if len(levels) != 2:
            raise ValueError("logistic: response must be binary")
        y = (y == levels[1]).astype(int)
    X = sm.add_constant(sub[predictors].astype(float).to_numpy(), has_constant="add")
    m = sm.Logit(y.astype(int).to_numpy(), X).fit(disp=False)
    # Diagnostics: ROC/AUC, Hosmer-Lemeshow GOF, classification at 0.5,
    # and confusion matrix.
    probs = m.predict(X)
    y_arr = y.astype(int).to_numpy() if hasattr(y, "to_numpy") else np.asarray(y)
    roc = _roc_auc(y_arr, probs)
    hl = _hosmer_lemeshow(y_arr, probs, g=10)
    pred = (probs >= 0.5).astype(int)
    tn = int(((y_arr == 0) & (pred == 0)).sum())
    tp = int(((y_arr == 1) & (pred == 1)).sum())
    fn = int(((y_arr == 1) & (pred == 0)).sum())
    fp = int(((y_arr == 0) & (pred == 1)).sum())
    accuracy = float((tp + tn) / len(y_arr)) if len(y_arr) else None
    sensitivity = float(tp / (tp + fn)) if (tp + fn) else None
    specificity = float(tn / (tn + fp)) if (tn + fp) else None
    precision = float(tp / (tp + fp)) if (tp + fp) else None
    return {"summary": {
        "method": "logistic_regression",
        "n": int(len(y)),
        "log_likelihood": float(m.llf),
        "pseudo_r2_mcfadden": float(m.prsquared),
        "AIC": float(m.aic), "BIC": float(m.bic),
        "coefficients": [
            {"name": n, "coef": float(b), "odds_ratio": float(np.exp(b)),
             "p": float(p)}
            for n, b, p in zip(["(Intercept)"] + predictors, m.params, m.pvalues)
        ],
        "roc": roc,
        "hosmer_lemeshow": hl,
        "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "accuracy": accuracy,
        "sensitivity": sensitivity,
        "specificity": specificity,
        "precision": precision,
    }}


def poisson_regression(df: pd.DataFrame, response: str, predictors: list[str],
                       exposure_col: str | None = None) -> dict:
    """Poisson regression for count responses. Optional exposure_col
    (e.g. units inspected) is used as offset."""
    sub = df[[response] + predictors + ([exposure_col] if exposure_col else [])].dropna()
    y = sub[response].astype(int).to_numpy()
    X = sm.add_constant(sub[predictors].astype(float).to_numpy(), has_constant="add")
    offset = np.log(sub[exposure_col].astype(float).to_numpy()) if exposure_col else None
    m = sm.GLM(y, X, family=sm.families.Poisson(), offset=offset).fit()
    return {"summary": {
        "method": "poisson_regression",
        "n": int(len(y)),
        "log_likelihood": float(m.llf),
        "AIC": float(m.aic),
        "deviance": float(m.deviance),
        "exposure_col": exposure_col,
        "coefficients": [
            {"name": n, "coef": float(b), "rate_ratio": float(np.exp(b)),
             "p": float(p)}
            for n, b, p in zip(["(Intercept)"] + predictors, m.params, m.pvalues)
        ],
    }}


def pls(df: pd.DataFrame, response: str, predictors: list[str],
        n_components: int | None = None) -> dict:
    """Partial Least Squares regression — the chemometrics workhorse.

    Use when predictors are highly collinear (NIR spectra, formulation
    components, sensor arrays) or when p > n. PLS finds latent components
    that maximise covariance with the response rather than just variance
    in X (which is PCA's criterion).

    n_components defaults to min(p, 10) — most practical fits need ≤ 5."""
    from sklearn.cross_decomposition import PLSRegression
    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < max(10, len(predictors)):
        raise ValueError(f"PLS needs ≥ {max(10, len(predictors))} complete rows")
    y = sub[response].to_numpy().reshape(-1, 1)
    X = sub[predictors].to_numpy()
    if n_components is None:
        n_components = min(len(predictors), 10, len(sub) - 1)
    m = PLSRegression(n_components=n_components, scale=True)
    m.fit(X, y)
    y_pred = m.predict(X).ravel()
    ss_res = float(np.sum((y.ravel() - y_pred) ** 2))
    ss_tot = float(np.sum((y.ravel() - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None
    # VIP (Variable Importance in Projection) — standard PLS feature score.
    # VIP_j = sqrt(p · Σ_a w_aj² · SSY_a / SSY_total)  per Wold (1995).
    T = m.x_scores_         # (n, A)
    W = m.x_weights_        # (p, A)
    Q = m.y_loadings_       # (1, A) for univariate y
    # SSY per component = (T_a^T · T_a) · Q_a²; broadcast Q to a 1-D vector.
    q_flat = Q.ravel()                   # (A,)
    SSY = (T ** 2).sum(axis=0) * (q_flat ** 2)   # (A,)
    SSY_total = SSY.sum()
    p = X.shape[1]
    vip = (np.sqrt(p * (W ** 2 @ SSY) / SSY_total)
           if SSY_total > 0 else np.zeros(p))
    return {"summary": {
        "method": "pls",
        "n_components": int(n_components),
        "n": int(len(sub)),
        "r_squared": float(r2) if r2 is not None else None,
        "rmse": float(np.sqrt(ss_res / len(sub))),
        "coefficients": [
            {"name": name, "coef": float(c),
             "vip": float(vip[i]),
             "vip_flag": "important" if vip[i] > 1.0 else "low"}
            for i, (name, c) in enumerate(zip(predictors, m.coef_.ravel()))
        ],
        "explained_variance_per_component_x": m.x_scores_.var(axis=0).tolist(),
    }}


def beta_regression(df: pd.DataFrame, response: str, predictors: list[str]) -> dict:
    """Beta regression for responses bounded in (0, 1) — proportions, rates,
    yields expressed as fractions. Uses statsmodels GLM with the logit link
    + a Bernoulli quasi-likelihood as a practical approximation.

    Note: full beta-likelihood needs `statsmodels.othermod.betareg` (added
    in 0.14+); we fall back to the GLM approximation if not available."""
    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < max(10, len(predictors) + 1):
        raise ValueError(f"beta_regression needs ≥ {max(10, len(predictors) + 1)} rows")
    y = sub[response].to_numpy()
    if not ((y > 0) & (y < 1)).all():
        raise ValueError("beta_regression: all y must be strictly in (0, 1). "
                         "If your scale is 0–100, divide by 100; for 0/1 outcomes use logistic.")
    try:
        from statsmodels.othermod.betareg import BetaModel
        rhs = " + ".join(predictors) if predictors else "1"
        formula = f"{response} ~ {rhs}"
        m = BetaModel.from_formula(formula, sub).fit(disp=False)
        coefs = [
            {"name": str(n), "coef": float(b), "p": float(p)}
            for n, b, p in zip(m.params.index, m.params, m.pvalues)
        ]
        return {"summary": {"method": "beta_regression",
                            "n": int(len(sub)),
                            "log_likelihood": float(m.llf),
                            "AIC": float(m.aic),
                            "coefficients": coefs}}
    except Exception:
        # Fallback: logit-link GLM. Approximate but rarely off by much on
        # smooth beta data. Surface a note so the user knows.
        rhs = sub[predictors].to_numpy()
        X = sm.add_constant(rhs, has_constant="add")
        # Use logit transform of y as the working response in OLS — the
        # quick-and-dirty surrogate when the proper BetaModel is unavailable.
        y_logit = np.log(y / (1 - y))
        m = sm.OLS(y_logit, X).fit()
        return {"summary": {"method": "beta_regression",
                            "n": int(len(sub)),
                            "r_squared": float(m.rsquared),
                            "coefficients": [
                                {"name": n, "coef": float(b), "p": float(p)}
                                for n, b, p in zip(
                                    ["(Intercept)"] + predictors, m.params, m.pvalues)
                            ],
                            "note": "Fallback OLS on logit(y) — install statsmodels ≥ 0.14 "
                                    "for the proper beta likelihood."}}


def spline_regression(df: pd.DataFrame, response: str, predictor: str,
                      n_knots: int = 4, degree: int = 3) -> dict:
    """Restricted cubic spline regression on a single continuous predictor.

    Captures non-linear shapes (saturating curves, U-shapes, sigmoids)
    without forcing a parametric form. n_knots = 4 is the default Harrell
    recommends — captures most realistic shapes without over-fitting.
    """
    sub = df[[response, predictor]].apply(pd.to_numeric, errors="coerce").dropna()
    if n_knots < 3:
        raise ValueError("spline_regression needs n_knots ≥ 3 "
                         "(fewer reduces to a straight line — use OLS instead)")
    if len(sub) < max(20, n_knots * 5):
        raise ValueError(f"spline_regression needs ≥ {max(20, n_knots * 5)} rows")
    x = sub[predictor].to_numpy()
    y = sub[response].to_numpy()
    # Knot locations at evenly-spaced quantiles.
    knots = np.quantile(x, np.linspace(0.05, 0.95, n_knots))
    # Coincident knots (heavily tied data) make the basis denominator zero →
    # NaN columns. De-duplicate and require enough distinct knots to fit.
    knots = np.unique(knots)
    if len(knots) < 3:
        raise ValueError("predictor has too few distinct values for a spline "
                         "(knots collapsed) — use OLS or bin the predictor first")
    # Build natural cubic spline basis: x, x², x³, (x − k)³_+ for each knot.
    # Then drop two columns at the ends to make it "restricted" (linear tails).
    basis = [np.ones_like(x), x]
    for k in knots[:-2]:                  # drop the last two for natural constraint
        col = np.maximum(0, x - k) ** 3 - np.maximum(0, x - knots[-2]) ** 3 \
              * (knots[-1] - k) / (knots[-1] - knots[-2]) \
              + np.maximum(0, x - knots[-1]) ** 3 \
              * (knots[-2] - k) / (knots[-1] - knots[-2])
        basis.append(col)
    X = np.column_stack(basis)
    m = sm.OLS(y, X).fit()
    # Predicted curve on a dense grid for plotting downstream.
    x_grid = np.linspace(x.min(), x.max(), 100)
    basis_grid = [np.ones_like(x_grid), x_grid]
    for k in knots[:-2]:
        col = np.maximum(0, x_grid - k) ** 3 - np.maximum(0, x_grid - knots[-2]) ** 3 \
              * (knots[-1] - k) / (knots[-1] - knots[-2]) \
              + np.maximum(0, x_grid - knots[-1]) ** 3 \
              * (knots[-2] - k) / (knots[-1] - knots[-2])
        basis_grid.append(col)
    Xg = np.column_stack(basis_grid)
    y_grid = (Xg @ m.params).tolist()
    return {"summary": {
        "method": "spline_regression",
        "n": int(len(sub)),
        "n_knots": int(n_knots),
        "degree": int(degree),
        "r_squared": float(m.rsquared),
        "adj_r_squared": float(m.rsquared_adj),
        "knot_locations": [float(k) for k in knots],
        "fit_curve": [{"x": float(xx), "y": float(yy)} for xx, yy in zip(x_grid, y_grid)],
        "joint_p_nonlinear": float(m.f_pvalue),
    }}


def random_forest(df: pd.DataFrame, response: str, predictors: list[str],
                  task: str = "auto", n_estimators: int = 200,
                  max_depth: int | None = None,
                  random_state: int | None = 42) -> dict:
    """Random Forest + permutation importance — Bench's only non-linear, no-
    assumption model. Use when you suspect interactions or non-linear effects
    you don't want to spec by hand, or when you want a robust feature-importance
    ranking before picking which predictors deserve a parametric model.

    task: 'auto' picks classification if response has ≤10 unique values and
    integer-ish; otherwise regression.

    Returns OOB R² (or accuracy), feature importances (impurity-based) AND
    permutation importance with std. Permutation is the more defensible
    measure: it directly measures how much performance drops when a feature
    is shuffled.
    """
    from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
    from sklearn.inspection import permutation_importance

    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < max(20, len(predictors) * 5):
        raise ValueError(f"random_forest needs ≥ {max(20, len(predictors) * 5)} complete rows")
    y = sub[response].to_numpy()
    X = sub[predictors].to_numpy()

    # Decide task
    n_unique = int(pd.Series(y).nunique())
    if task == "auto":
        looks_class = n_unique <= 10 and np.all(np.equal(np.mod(y, 1), 0))
        task = "classification" if looks_class else "regression"

    if task == "classification":
        m = RandomForestClassifier(n_estimators=n_estimators,
                                   max_depth=max_depth,
                                   oob_score=True,
                                   n_jobs=1,
                                   random_state=random_state)
        m.fit(X, y.astype(int))
        oob_score = float(m.oob_score_)
        metric_label = "oob_accuracy"
    else:
        m = RandomForestRegressor(n_estimators=n_estimators,
                                  max_depth=max_depth,
                                  oob_score=True,
                                  n_jobs=1,
                                  random_state=random_state)
        m.fit(X, y)
        oob_score = float(m.oob_score_)
        metric_label = "oob_r2"

    # Impurity-based importance (fast but biased toward high-cardinality features)
    impurity_imp = m.feature_importances_

    # Permutation importance — the defensible one. n_repeats=10 default.
    perm = permutation_importance(m, X, y, n_repeats=10,
                                  random_state=random_state, n_jobs=1)

    rows = []
    for i, name in enumerate(predictors):
        rows.append({
            "name": name,
            "impurity_importance": float(impurity_imp[i]),
            "perm_importance_mean": float(perm.importances_mean[i]),
            "perm_importance_std": float(perm.importances_std[i]),
            "rank_impurity": int(np.argsort(-impurity_imp).tolist().index(i) + 1),
            "rank_perm": int(np.argsort(-perm.importances_mean).tolist().index(i) + 1),
        })
    # Rank table by permutation importance descending.
    rows.sort(key=lambda r: -r["perm_importance_mean"])

    out_summary = {
        "method": "random_forest",
        "task": task,
        "n": int(len(sub)),
        "n_trees": int(n_estimators),
        metric_label: oob_score,
        "feature_importance": rows,
    }

    # Classification: surface confusion matrix + per-class precision/recall.
    # OOB predictions = m.oob_decision_function_, take argmax per row.
    if task == "classification":
        try:
            oob_pred = np.argmax(m.oob_decision_function_, axis=1)
            classes = m.classes_
            y_int = y.astype(int)
            class_to_idx = {int(c): i for i, c in enumerate(classes)}
            y_idx = np.array([class_to_idx[v] for v in y_int])
            K = len(classes)
            cm = np.zeros((K, K), dtype=int)
            for true_i, pred_i in zip(y_idx, oob_pred):
                cm[true_i, pred_i] += 1
            per_class = []
            for i, c in enumerate(classes):
                tp = int(cm[i, i])
                fn = int(cm[i, :].sum() - tp)
                fp = int(cm[:, i].sum() - tp)
                prec = tp / (tp + fp) if (tp + fp) else None
                rec  = tp / (tp + fn) if (tp + fn) else None
                f1   = (2 * prec * rec / (prec + rec)
                        if prec and rec and (prec + rec) > 0 else None)
                per_class.append({
                    "class": int(c), "n": int(cm[i, :].sum()),
                    "precision": float(prec) if prec is not None else None,
                    "recall":    float(rec)  if rec  is not None else None,
                    "f1":        float(f1)   if f1   is not None else None,
                })
            out_summary["confusion_matrix"] = cm.tolist()
            out_summary["classes"] = [int(c) for c in classes]
            out_summary["per_class"] = per_class
            # Macro-averaged metrics — the standard summary for multiclass.
            macro_p = np.mean([c["precision"] for c in per_class if c["precision"] is not None])
            macro_r = np.mean([c["recall"]    for c in per_class if c["recall"]    is not None])
            macro_f = np.mean([c["f1"]        for c in per_class if c["f1"]        is not None])
            out_summary["macro_precision"] = float(macro_p) if np.isfinite(macro_p) else None
            out_summary["macro_recall"]    = float(macro_r) if np.isfinite(macro_r) else None
            out_summary["macro_f1"]        = float(macro_f) if np.isfinite(macro_f) else None
        except Exception:
            # OOB predictions can be undefined when a class is too rare; skip
            # silently rather than failing the whole fit.
            pass

    return {"summary": out_summary}


def robust(df: pd.DataFrame, response: str, predictors: list[str],
           m_estimator: str = "huber") -> dict:
    """Robust regression via M-estimators. Down-weights outlier influence
    rather than excluding observations outright.

    m_estimator:
        huber       — Huber's T (default; mild down-weighting)
        bisquare    — Tukey biweight (heavy outliers → zero weight)
        andrews     — Andrews' sine-wave

    Use when OLS is being dragged by a handful of leverage points and you
    want a defensible fit without manual outlier exclusion."""
    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    y = sub[response].to_numpy()
    X = sm.add_constant(sub[predictors].to_numpy(), has_constant="add")
    norms = {
        "huber":    sm.robust.norms.HuberT(),
        "bisquare": sm.robust.norms.TukeyBiweight(),
        "andrews":  sm.robust.norms.AndrewWave(),
    }
    if m_estimator not in norms:
        raise ValueError(f"m_estimator must be one of {list(norms)}")
    m = sm.RLM(y, X, M=norms[m_estimator]).fit()
    # RLM doesn't surface an R² — compute pseudo-R² from weighted residuals.
    fitted = m.fittedvalues
    ss_res = float(np.sum((y - fitted) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    pseudo_r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None
    coefs = [
        {"name": n, "coef": float(b), "std_err": float(se), "p": float(p),
         "ci_lo": float(ci_l), "ci_hi": float(ci_h)}
        for n, b, se, p, ci_l, ci_h in zip(
            ["(Intercept)"] + predictors, m.params, m.bse, m.pvalues,
            m.conf_int()[:, 0], m.conf_int()[:, 1])
    ]
    return {"summary": {
        "method": "robust_regression",
        "m_estimator": m_estimator,
        "n": int(len(y)),
        "pseudo_r2": pseudo_r2,
        "rmse": float(np.sqrt(ss_res / max(1, len(y) - X.shape[1]))),
        "coefficients": coefs,
        "n_down_weighted": int((m.weights < 0.95).sum()),
        "n_zero_weighted": int((m.weights < 0.05).sum()),
    }}


def quantile(df: pd.DataFrame, response: str, predictors: list[str],
             q: float = 0.5) -> dict:
    """Quantile regression — predict the q-th quantile of the response rather
    than the mean. q=0.5 is median regression (least absolute deviation);
    q=0.9 estimates the upper-tail conditional quantile.

    Use cases: conditional median for skewed responses; tail-risk modeling
    (P95 latency, worst-case cycle time); robust alternative to OLS."""
    if not (0 < q < 1):
        raise ValueError("q must be strictly between 0 and 1")
    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    y = sub[response].to_numpy()
    X = sm.add_constant(sub[predictors].to_numpy(), has_constant="add")
    m = sm.QuantReg(y, X).fit(q=q)
    coefs = [
        {"name": n, "coef": float(b), "std_err": float(se), "p": float(p),
         "ci_lo": float(ci_l), "ci_hi": float(ci_h)}
        for n, b, se, p, ci_l, ci_h in zip(
            ["(Intercept)"] + predictors, m.params, m.bse, m.pvalues,
            m.conf_int()[:, 0], m.conf_int()[:, 1])
    ]
    # Pseudo-R¹ (Koenker & Machado) — analogue to R² for quantile regression.
    return {"summary": {
        "method": "quantile_regression",
        "q": float(q),
        "n": int(len(y)),
        "pseudo_r1": float(m.prsquared),
        "coefficients": coefs,
    }}


def ordinal_logit(df: pd.DataFrame, response: str, predictors: list[str]) -> dict:
    """Ordinal logistic via cumulative-link / proportional-odds (built on
    statsmodels.miscmodels.ordinal_model). Requires statsmodels ≥ 0.12."""
    from statsmodels.miscmodels.ordinal_model import OrderedModel
    sub = df[[response] + predictors].dropna()
    y = sub[response].astype("category")
    X = sub[predictors].astype(float).to_numpy()
    m = OrderedModel(y.cat.codes.to_numpy(), X, distr="logit").fit(method="bfgs", disp=False)
    return {"summary": {
        "method": "ordinal_logit",
        "n": int(len(y)),
        "log_likelihood": float(m.llf),
        "AIC": float(m.aic),
        "coefficients": [
            {"name": n, "coef": float(b), "p": float(p)}
            for n, b, p in zip(predictors, m.params[: len(predictors)], m.pvalues[: len(predictors)])
        ],
    }}


def nonlinear_regression(df: pd.DataFrame, response: str, predictor: str,
                         model: str, p0: list[float] | None = None) -> dict:
    """Curve-fit a known nonlinear function. model is a name from a small
    catalog: 'exp_decay', 'logistic', 'power', 'asymptotic'.
    Caller supplies p0 (initial parameter guess) where appropriate."""
    sub = df[[response, predictor]].dropna().astype(float)
    x = sub[predictor].to_numpy()
    y = sub[response].to_numpy()

    funcs = {
        "exp_decay":   (lambda x, a, k, c: a * np.exp(-k * x) + c, [1, 1, 0]),
        "logistic":    (lambda x, L, k, x0: L / (1 + np.exp(-k * (x - x0))), [1, 1, 0]),
        "power":       (lambda x, a, b: a * np.power(np.where(x > 0, x, 1e-9), b), [1, 1]),
        "asymptotic":  (lambda x, a, b, c: a - b * np.exp(-c * x), [1, 1, 1]),
    }
    if model not in funcs:
        raise ValueError(f"unknown nonlinear model: {model}")
    fn, default_p0 = funcs[model]
    p0 = p0 or default_p0
    popt, pcov = optimize.curve_fit(fn, x, y, p0=p0, maxfev=10000)
    yhat = fn(x, *popt)
    ss_res = float(((y - yhat) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None
    return {"summary": {
        "method": "nonlinear_regression",
        "model": model, "n": int(len(y)),
        "params": popt.tolist(),
        "param_se": np.sqrt(np.diag(pcov)).tolist(),
        "r2_pseudo": float(r2) if r2 is not None else None,
        "rmse": float(np.sqrt(ss_res / len(y))),
    }}


def regularized(df: pd.DataFrame, response: str, predictors: list[str],
                method: str = "ridge", alpha: float | None = None,
                l1_ratio: float = 0.5):
    """Penalised linear regression — ridge (L2), lasso (L1), or elastic-net.

    Shrinks coefficients toward zero to tame multicollinearity (ridge) or do
    automatic variable selection (lasso drives weak coefficients to exactly 0).
    Predictors are standardised before fitting (so the penalty is scale-fair),
    then coefficients are back-transformed to the original units for reporting.
    When `alpha` (penalty strength) is omitted it is chosen by cross-validation.
    """
    from sklearn.linear_model import (
        Ridge, Lasso, ElasticNet, RidgeCV, LassoCV, ElasticNetCV,
    )
    if not predictors:
        raise ValueError("regularized regression needs at least one predictor")
    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < max(10, len(predictors) + 2):
        raise ValueError(f"need ≥ {max(10, len(predictors) + 2)} complete rows")
    y = sub[response].to_numpy(dtype=float)
    X = sub[predictors].to_numpy(dtype=float)
    # Standardise (z-score) so the penalty treats every predictor equally.
    x_mean, x_sd = X.mean(axis=0), X.std(axis=0, ddof=0)
    x_sd_safe = np.where(x_sd == 0, 1.0, x_sd)
    Xs = (X - x_mean) / x_sd_safe
    y_mean = float(y.mean())
    yc = y - y_mean

    cv = min(5, len(sub))
    cv_alpha = None
    if method == "ridge":
        if alpha is None:
            grid = np.logspace(-3, 3, 50)
            m = RidgeCV(alphas=grid, fit_intercept=False).fit(Xs, yc)
            alpha, cv_alpha = float(m.alpha_), float(m.alpha_)
        else:
            m = Ridge(alpha=alpha, fit_intercept=False).fit(Xs, yc)
    elif method == "lasso":
        if alpha is None:
            m = LassoCV(cv=cv, fit_intercept=False, max_iter=50000).fit(Xs, yc)
            alpha, cv_alpha = float(m.alpha_), float(m.alpha_)
        else:
            m = Lasso(alpha=alpha, fit_intercept=False, max_iter=50000).fit(Xs, yc)
    elif method == "elastic_net":
        if alpha is None:
            m = ElasticNetCV(l1_ratio=l1_ratio, cv=cv, fit_intercept=False,
                             max_iter=50000).fit(Xs, yc)
            alpha, cv_alpha = float(m.alpha_), float(m.alpha_)
        else:
            m = ElasticNet(alpha=alpha, l1_ratio=l1_ratio, fit_intercept=False,
                           max_iter=50000).fit(Xs, yc)
    else:
        raise ValueError(f"unknown regularization method: {method}")

    coef_std = m.coef_.ravel()
    # Back-transform standardised coefficients to original predictor units.
    coef_orig = coef_std / x_sd_safe
    intercept = y_mean - float(np.sum(coef_orig * x_mean))
    y_pred = X @ coef_orig + intercept
    ss_res = float(np.sum((y - y_pred) ** 2))
    ss_tot = float(np.sum((y - y_mean) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None
    k = len(predictors)
    n = len(sub)
    adj_r2 = (1 - (1 - r2) * (n - 1) / (n - k - 1)
              if (r2 is not None and n - k - 1 > 0) else None)
    n_nonzero = int(np.sum(np.abs(coef_std) > 1e-10))

    coefs = [{
        "term": p,
        "coef": float(coef_orig[i]),
        "coef_standardized": float(coef_std[i]),
        "shrunk_to_zero": bool(abs(coef_std[i]) <= 1e-10),
    } for i, p in enumerate(predictors)]

    # Coefficient bar chart (standardised, so magnitudes are comparable).
    order = np.argsort(np.abs(coef_std))[::-1]
    fig, ax = plt.subplots(figsize=(7.5, max(2.6, 0.4 * k + 1)))
    names = [predictors[i] for i in order]
    vals = [coef_std[i] for i in order]
    colors = ["#bbb" if abs(v) <= 1e-10 else "#3a7" if v > 0 else "#c55" for v in vals]
    ax.barh(range(len(names)), vals, color=colors)
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names, fontsize=8)
    ax.invert_yaxis()
    ax.axvline(0, color="#444", linewidth=0.8)
    ax.set_xlabel("Standardized coefficient")
    ax.set_title(f"{method.replace('_', '-')} coefficients (α={alpha:.4g})")
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    return {
        "summary": {
            "method": f"{method}_regression", "n": n, "n_predictors": k,
            "alpha": float(alpha), "alpha_selected_by_cv": cv_alpha,
            "l1_ratio": l1_ratio if method == "elastic_net" else None,
            "r2": float(r2) if r2 is not None else None,
            "adj_r2": float(adj_r2) if adj_r2 is not None else None,
            "rmse": float(np.sqrt(ss_res / n)),
            "intercept": intercept,
            "n_nonzero": n_nonzero,
            "n_shrunk_to_zero": k - n_nonzero,
            "coefficients": coefs,
        },
        "chart_png": buf.getvalue(),
    }
