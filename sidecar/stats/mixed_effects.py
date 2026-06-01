"""Linear Mixed-Effects model (LMM / lmer) — the model every Black Belt
running a GR&R, nested DOE, or repeated-measures study secretly needs.

Fixed effects + one or more random effects. Built on statsmodels.MixedLM
which uses REML by default.

Use cases this enables that the rest of Bench can't:
  - Repeated measures with subjects as random intercepts.
  - Hierarchical: schools → classrooms → students.
  - Random slopes: each subject has their own dose-response.
  - Compute intraclass correlation (ICC) — share of variance from a
    grouping factor — natural extension of MSA reasoning.

Formula-based interface (statsmodels style). Examples:
  fixed='y ~ x + treatment'   group='subject'    random='1'       # random intercept
  fixed='y ~ x + treatment'   group='subject'    random='1 + x'   # random slope on x
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf


def compute(df: pd.DataFrame, fixed: str, group: str,
            random: str = "1", reml: bool = True) -> dict:
    """Fit a linear mixed-effects model.

    fixed:  e.g. 'response ~ x1 + x2'
    group:  column name to use as the grouping (random-effects) variable
    random: random-effects formula (default '1' = random intercept).
            Use '1 + x' to add a random slope on x.
    """
    if not fixed or "~" not in fixed:
        raise ValueError("fixed must be a formula like 'y ~ x1 + x2'")
    if group not in df.columns:
        raise ValueError(f"group column {group!r} not in dataset")

    sub = df.dropna(subset=[group])
    # Drop NA on the fixed-effects RHS too — statsmodels needs complete rows.
    response = fixed.split("~")[0].strip()
    rhs_tokens = [t.strip() for t in fixed.split("~")[1].replace("+", " ").split()
                  if t.strip() not in ("1", "0")]
    sub = sub.dropna(subset=[response] + [c for c in rhs_tokens if c in sub.columns])

    if random == "1":
        m = smf.mixedlm(fixed, sub, groups=sub[group])
    else:
        m = smf.mixedlm(fixed, sub, groups=sub[group], re_formula=random)
    res = m.fit(reml=reml, method=["lbfgs"])

    # Fixed effects
    fixed_rows = []
    for n, b, se, p, ci_lo, ci_hi in zip(
        res.fe_params.index, res.fe_params, res.bse_fe, res.pvalues[:len(res.fe_params)],
        res.conf_int().iloc[:len(res.fe_params), 0],
        res.conf_int().iloc[:len(res.fe_params), 1]):
        fixed_rows.append({"name": str(n), "coef": float(b),
                           "std_err": float(se), "p": float(p),
                           "ci_lo": float(ci_lo), "ci_hi": float(ci_hi)})

    # Random-effect variance components (statsmodels stores them per group)
    re_var = float(res.cov_re.iloc[0, 0]) if res.cov_re is not None and res.cov_re.size else None
    resid_var = float(res.scale)

    # ICC for random-intercept model
    icc = None
    if re_var is not None and random == "1":
        icc = re_var / (re_var + resid_var) if (re_var + resid_var) > 0 else None

    return {"summary": {
        "method": "linear_mixed_effects",
        "fitted_by": "REML" if reml else "ML",
        "fixed_formula": fixed,
        "group": group,
        "random_formula": random,
        "n": int(len(sub)),
        "n_groups": int(sub[group].nunique()),
        "log_likelihood": float(res.llf),
        "AIC": float(res.aic),
        "BIC": float(res.bic),
        "fixed_effects": fixed_rows,
        "random_effect_variance": re_var,
        "residual_variance": resid_var,
        "ICC": icc,
        "converged": bool(res.converged),
    }}


_GEE_FAMILIES = {"gaussian", "binomial", "poisson", "gamma"}
_GEE_COV = {"exchangeable", "independence", "ar1", "unstructured"}


def gee(df: pd.DataFrame, fixed: str, group: str,
        family: str = "gaussian", cov_struct: str = "exchangeable") -> dict:
    """Generalized Estimating Equations — population-averaged models for
    correlated / clustered / repeated-measures data when you care about the
    *marginal* effect (not subject-specific random effects). The standard tool
    for longitudinal binary or count outcomes; GEE coefficients stay consistent
    even if the working correlation structure is mis-specified, because the
    standard errors are robust (sandwich) estimators.

    family:     gaussian | binomial | poisson | gamma
    cov_struct: exchangeable | independence | ar1 | unstructured
    """
    import statsmodels.api as sm
    from statsmodels.genmod.generalized_estimating_equations import GEE
    if not fixed or "~" not in fixed:
        raise ValueError("fixed must be a formula like 'y ~ x1 + x2'")
    if group not in df.columns:
        raise ValueError(f"group column {group!r} not in dataset")
    fam = (family or "gaussian").lower()
    if fam not in _GEE_FAMILIES:
        raise ValueError(f"unknown family {family!r}")
    cs = (cov_struct or "exchangeable").lower()
    if cs not in _GEE_COV:
        raise ValueError(f"unknown cov_struct {cov_struct!r}")

    fam_obj = {"gaussian": sm.families.Gaussian(), "binomial": sm.families.Binomial(),
               "poisson": sm.families.Poisson(), "gamma": sm.families.Gamma()}[fam]
    cov_obj = {"exchangeable": sm.cov_struct.Exchangeable(),
               "independence": sm.cov_struct.Independence(),
               "ar1": sm.cov_struct.Autoregressive(),
               "unstructured": sm.cov_struct.Unstructured()}[cs]

    response = fixed.split("~")[0].strip()
    rhs = [t.strip() for t in fixed.split("~")[1].replace("+", " ").split()
           if t.strip() not in ("1", "0")]
    sub = df.dropna(subset=[group] + [response] + [c for c in rhs if c in df.columns])
    m = GEE.from_formula(fixed, groups=sub[group], data=sub,
                         family=fam_obj, cov_struct=cov_obj)
    res = m.fit()

    coefs = []
    ci = res.conf_int()
    for n in res.params.index:
        b = float(res.params[n])
        coefs.append({
            "name": str(n), "coef": b,
            "std_err": float(res.bse[n]), "p": float(res.pvalues[n]),
            "ci_lo": float(ci.loc[n, 0]), "ci_hi": float(ci.loc[n, 1]),
            # For non-identity links, the exponentiated coef is the odds/rate ratio.
            "effect_ratio": (float(np.exp(b)) if fam in ("binomial", "poisson") else None),
        })
    return {"summary": {
        "method": "gee",
        "family": fam, "link_effect": ("odds_ratio" if fam == "binomial"
                                       else "rate_ratio" if fam == "poisson" else "mean_diff"),
        "cov_struct": cs, "fixed_formula": fixed, "group": group,
        "n": int(len(sub)), "n_groups": int(sub[group].nunique()),
        "coefficients": coefs,
        "scale": float(res.scale),
        "note": "Population-averaged (marginal) effects with cluster-robust standard errors.",
    }}


def glmm(df: pd.DataFrame, fixed: str, group: str, family: str = "binomial") -> dict:
    """Generalized Linear Mixed Model — random-effects model for non-normal
    outcomes (the GLMM that classic LMM can't do: logistic or Poisson responses
    with a random intercept per group). Fitted by variational Bayes via
    statsmodels' Bayesian mixed GLM; reports posterior mean coefficients and the
    random-intercept variance.

    family: binomial | poisson
    """
    from statsmodels.genmod.bayes_mixed_glm import (
        BinomialBayesMixedGLM, PoissonBayesMixedGLM)
    if not fixed or "~" not in fixed:
        raise ValueError("fixed must be a formula like 'y ~ x1 + x2'")
    if group not in df.columns:
        raise ValueError(f"group column {group!r} not in dataset")
    fam = (family or "binomial").lower()
    if fam not in ("binomial", "poisson"):
        raise ValueError("GLMM family must be binomial or poisson")

    response = fixed.split("~")[0].strip()
    rhs = [t.strip() for t in fixed.split("~")[1].replace("+", " ").split()
           if t.strip() not in ("1", "0")]
    sub = df.dropna(subset=[group] + [response] + [c for c in rhs if c in df.columns]).copy()
    sub["_grp"] = sub[group].astype("category")
    # Random intercept per group as a variance component.
    vc = {"group": "0 + C(_grp)"}
    Model = BinomialBayesMixedGLM if fam == "binomial" else PoissonBayesMixedGLM
    m = Model.from_formula(fixed, vc, sub)
    res = m.fit_vb(verbose=False)

    # Fixed-effects posterior means are the first len(fe) entries.
    fe_names = list(res.model.exog_names)
    coefs = []
    for i, n in enumerate(fe_names):
        b = float(res.fe_mean[i])
        sd = float(res.fe_sd[i])
        coefs.append({
            "name": str(n), "coef": b, "posterior_sd": sd,
            "ci_lo": b - 1.96 * sd, "ci_hi": b + 1.96 * sd,
            "effect_ratio": float(np.exp(b)),
        })
    # Variance-component posterior (log-scale sd of the random intercept).
    vc_mean = float(res.vcp_mean[0]) if len(res.vcp_mean) else None
    return {"summary": {
        "method": "glmm",
        "family": fam, "fitted_by": "variational Bayes",
        "link_effect": "odds_ratio" if fam == "binomial" else "rate_ratio",
        "fixed_formula": fixed, "group": group,
        "n": int(len(sub)), "n_groups": int(sub[group].nunique()),
        "coefficients": coefs,
        "random_intercept_logsd_posterior_mean": vc_mean,
        "note": "Subject-specific (conditional) effects with a random intercept per group; fitted by variational Bayes.",
    }}
