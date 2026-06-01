"""Process capability: Cp, Cpk, Pp, Ppk, Cpm, Z-bench + histogram with spec lines.
Supports an optional Box-Cox transform path for non-normal data — the BB
gets capability indices computed in the transformed space (where the
distribution is approximately normal) and the spec limits are mapped
through the same transform so the indices remain interpretable.
"""
from __future__ import annotations

import io
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats as sps


def _box_cox_transform(x: np.ndarray, lsl, usl):
    """Transform x → y = (x^λ − 1) / λ (or ln(x) at λ=0). Returns the
    transformed sample and λ, plus mapped LSL/USL where applicable.
    Skipped if any non-positive observations exist."""
    if (x <= 0).any():
        return x, None, lsl, usl
    y, lam = sps.boxcox(x)
    def _map(v):
        if v is None: return None
        if v <= 0:    return None
        return (v ** lam - 1) / lam if abs(lam) > 1e-9 else float(np.log(v))
    return y, float(lam), _map(lsl), _map(usl)


def _johnson_transform(x: np.ndarray, lsl, usl):
    """Try Johnson SU / SB / SL families and pick the best by Anderson-Darling
    on the transformed data. Returns (y, family, params, lsl_t, usl_t) or
    (x, None, None, lsl, usl) if no family normalises better than the raw data.

    Johnson is the standard alternative to Box-Cox when:
      - data have negative values (Box-Cox can't handle)
      - skew is severe enough that a single λ won't normalise

    ISO 22514-7 lists Johnson as the recommended path for capability on
    non-normal data when Box-Cox fails.
    """
    if x.size < 8:
        return x, None, None, lsl, usl

    candidates = []

    # ── SU (unbounded): z = γ + δ · sinh⁻¹((x − ξ) / λ) ──
    # Fit by matching moments — Slifker & Shapiro (1980) simplified estimator.
    try:
        # Use scipy.stats.johnsonsu fit
        params = sps.johnsonsu.fit(x)
        a, b, loc, scale = params
        # Transform: z = a + b · sinh⁻¹((x − loc) / scale)
        y = a + b * np.arcsinh((x - loc) / scale)
        ad = sps.anderson(y, dist="norm").statistic
        def _map_su(v):
            if v is None: return None
            return float(a + b * np.arcsinh((v - loc) / scale))
        candidates.append({"family": "SU", "y": y, "ad": float(ad),
                           "params": {"gamma": float(a), "delta": float(b),
                                      "xi": float(loc), "lambda": float(scale)},
                           "lsl_t": _map_su(lsl), "usl_t": _map_su(usl)})
    except Exception:
        pass

    # ── SB (bounded): z = γ + δ · ln((x − ξ) / (ξ + λ − x)) ──
    # Requires all x in (ξ, ξ + λ). Use a shifted-fit approach.
    try:
        params = sps.johnsonsb.fit(x)
        a, b, loc, scale = params
        # Mask values inside (loc, loc+scale) — both are required for log.
        denom = (loc + scale - x)
        mask = (x > loc) & (denom > 0)
        if mask.sum() >= 8:
            y = np.full_like(x, np.nan, dtype=float)
            y[mask] = a + b * np.log((x[mask] - loc) / denom[mask])
            y_clean = y[~np.isnan(y)]
            ad = sps.anderson(y_clean, dist="norm").statistic
            def _map_sb(v):
                if v is None or v <= loc or (loc + scale - v) <= 0: return None
                return float(a + b * np.log((v - loc) / (loc + scale - v)))
            candidates.append({"family": "SB", "y": y_clean, "ad": float(ad),
                               "params": {"gamma": float(a), "delta": float(b),
                                          "xi": float(loc), "lambda": float(scale)},
                               "lsl_t": _map_sb(lsl), "usl_t": _map_sb(usl)})
    except Exception:
        pass

    # ── SL (log-normal family): z = γ + δ · ln(x − ξ) ──
    # Best when data has a clear lower bound; reduces to log-normal when γ=0.
    if (x > 0).all():
        try:
            params = sps.lognorm.fit(x, floc=0)
            shape, _, scale = params
            # Equivalent SL: z = (ln(x) − ln(scale)) / shape
            y = (np.log(x) - np.log(scale)) / shape
            ad = sps.anderson(y, dist="norm").statistic
            def _map_sl(v):
                if v is None or v <= 0: return None
                return float((np.log(v) - np.log(scale)) / shape)
            candidates.append({"family": "SL", "y": y, "ad": float(ad),
                               "params": {"shape": float(shape), "scale": float(scale)},
                               "lsl_t": _map_sl(lsl), "usl_t": _map_sl(usl)})
        except Exception:
            pass

    if not candidates:
        return x, None, None, lsl, usl

    # Best = lowest AD statistic.
    best = min(candidates, key=lambda c: c["ad"])
    return (np.asarray(best["y"]), best["family"], best["params"],
            best["lsl_t"], best["usl_t"])


# d2 control-chart constants (subgroup-size → unbiasing constant for R̄).
# AIAG SPC Reference Manual, 2nd ed., Table II. Index by subgroup size n.
_D2 = {
    2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326,
    6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078,
}


def _sigma_within(x: np.ndarray, subgroups: pd.Series | None = None) -> float:
    """Within-subgroup sigma per AIAG SPC.

    - With subgroups: σ̂_within = R̄ / d₂(n) where R̄ is the mean of subgroup
      ranges and n is the subgroup size. Cp/Cpk reflect short-term capability.
    - Without subgroups (individuals): σ̂_within = MR̄ / 1.128 where MR̄ is
      the mean moving range — d₂(2) = 1.128. This is the standard I-MR estimate.

    Falls back to the overall sample standard deviation if neither path is
    workable (e.g. all values identical, mismatched subgroup sizes).
    """
    if subgroups is not None and len(subgroups) == len(x):
        ranges = []
        size = None
        for _, g in pd.DataFrame({"x": x, "g": subgroups.values}).groupby("g"):
            vals = g["x"].to_numpy()
            if size is None:
                size = vals.size
            if vals.size != size or vals.size < 2:
                ranges = []  # mismatched subgroup sizes — bail to MR
                break
            ranges.append(float(vals.max() - vals.min()))
        if ranges and size in _D2:
            return float(np.mean(ranges) / _D2[size])
    # Individuals path: MR-based estimate.
    if x.size >= 2:
        mr = np.abs(np.diff(x))
        if mr.size and float(np.mean(mr)) > 0:
            return float(np.mean(mr) / _D2[2])
    # Last-resort fallback.
    return float(np.std(x, ddof=1))


def compute(df, column: str | None, lsl: float | None, usl: float | None,
            target: float | None = None,
            transform: str | None = None,
            subgroup_col: str | None = None) -> dict:
    """If transform == 'box-cox', re-fit capability in the transformed space
    and report both raw and transformed indices. target enables Cpm.
    subgroup_col enables true within-subgroup σ via R̄/d₂; otherwise the
    moving-range method (individuals) is used.
    """
    if not column or column not in df.columns:
        raise ValueError(f"column {column!r} not in dataset")
    sub = df[[column] + ([subgroup_col] if subgroup_col and subgroup_col in df.columns else [])].dropna()
    x = sub[column].astype(float).to_numpy()
    sg = sub[subgroup_col] if (subgroup_col and subgroup_col in sub.columns) else None
    if x.size < 2:
        raise ValueError("need at least 2 observations")

    mu = float(np.mean(x))
    s_overall = float(np.std(x, ddof=1))
    sigma_within = _sigma_within(x, sg)

    def _pair(mean_, sigma_, lsl_, usl_):
        """Return (capability, centred_capability) for a given sigma. Used
        twice — once with sigma_within (→ Cp, Cpk) and once with sigma_overall
        (→ Pp, Ppk). AIAG / Montgomery convention."""
        if sigma_ == 0 or lsl_ is None or usl_ is None:
            return None, None
        cap = (usl_ - lsl_) / (6 * sigma_)
        capk = min((usl_ - mean_) / (3 * sigma_), (mean_ - lsl_) / (3 * sigma_))
        return float(cap), float(capk)

    def _indices(mean_, sigma_w, sigma_o, lsl_, usl_, target_):
        if sigma_w == 0 and sigma_o == 0:
            return {"cp": None, "cpk": None, "pp": None, "ppk": None, "cpm": None, "z_bench": None}
        cp,  cpk  = _pair(mean_, sigma_w, lsl_, usl_)
        pp,  ppk  = _pair(mean_, sigma_o, lsl_, usl_)
        # Cpm — Taguchi capability against a target value (uses overall σ).
        cpm = None
        if target_ is not None and lsl_ is not None and usl_ is not None and sigma_o > 0:
            den = np.sqrt(sigma_o ** 2 + (mean_ - target_) ** 2)
            cpm = float((usl_ - lsl_) / (6 * den)) if den > 0 else None
        # Z-bench — sigma level corresponding to the predicted defect rate
        # under the short-term (within) sigma.
        z_bench = None
        if cpk is not None and sigma_w > 0:
            ppm_lower = float(sps.norm.cdf((lsl_ - mean_) / sigma_w)) * 1_000_000 if lsl_ is not None else 0
            ppm_upper = float(sps.norm.sf((usl_ - mean_) / sigma_w)) * 1_000_000 if usl_ is not None else 0
            total_ppm = ppm_lower + ppm_upper
            if 0 < total_ppm < 1_000_000:
                z_bench = float(sps.norm.isf(total_ppm / 1_000_000))
        return {"cp": cp, "cpk": cpk, "pp": pp, "ppk": ppk, "cpm": cpm,
                "z_bench": z_bench,
                "sigma_within": float(sigma_w),
                "sigma_overall": float(sigma_o)}

    raw = _indices(mu, sigma_within, s_overall, lsl, usl, target)

    transformed = None
    lam = None
    if transform == "box-cox":
        y, lam, lsl_t, usl_t = _box_cox_transform(x, lsl, usl)
        if lam is not None and lsl_t is not None and usl_t is not None:
            sg_y = sg  # subgroup assignment doesn't change under monotone transform
            sigma_w_y = _sigma_within(y, sg_y)
            sigma_o_y = float(np.std(y, ddof=1))
            transformed = _indices(float(np.mean(y)), sigma_w_y, sigma_o_y,
                                   lsl_t, usl_t,
                                   None if target is None else (
                                       (target ** lam - 1) / lam if abs(lam) > 1e-9 else float(np.log(target))
                                   ))
            transformed["lambda"] = lam
            transformed["transformed_lsl"] = lsl_t
            transformed["transformed_usl"] = usl_t
            transformed["family"] = "box-cox"
    elif transform == "johnson":
        y, family, params, lsl_t, usl_t = _johnson_transform(x, lsl, usl)
        if family is not None and lsl_t is not None and usl_t is not None:
            sigma_w_y = _sigma_within(y, None)
            sigma_o_y = float(np.std(y, ddof=1))
            # Target transformation is family-specific; if user supplies one
            # we just pass it through the same map family used for spec limits.
            if target is not None:
                if family == "SU":
                    a, b, loc, scale = (params["gamma"], params["delta"],
                                        params["xi"], params["lambda"])
                    tgt_t = float(a + b * np.arcsinh((target - loc) / scale))
                elif family == "SB":
                    a, b, loc, scale = (params["gamma"], params["delta"],
                                        params["xi"], params["lambda"])
                    if target > loc and (loc + scale - target) > 0:
                        tgt_t = float(a + b * np.log((target - loc) / (loc + scale - target)))
                    else:
                        tgt_t = None
                elif family == "SL":
                    shape, scale = params["shape"], params["scale"]
                    tgt_t = float((np.log(target) - np.log(scale)) / shape) if target > 0 else None
                else:
                    tgt_t = None
            else:
                tgt_t = None
            transformed = _indices(float(np.mean(y)), sigma_w_y, sigma_o_y,
                                   lsl_t, usl_t, tgt_t)
            transformed["family"] = f"johnson_{family.lower()}"
            transformed["params"] = params
            transformed["transformed_lsl"] = lsl_t
            transformed["transformed_usl"] = usl_t

    nshap = sps.shapiro(x) if 3 <= x.size <= 5000 else None

    from stats._theme import DANGER, ACCENT
    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.hist(x, bins="auto")
    if lsl is not None: ax.axvline(lsl, linestyle="--", color=DANGER, label=f"LSL={lsl}")
    if usl is not None: ax.axvline(usl, linestyle="--", color=DANGER, label=f"USL={usl}")
    if target is not None: ax.axvline(target, linestyle=":", color=ACCENT, label=f"Target={target}")
    ax.set_title(f"Capability — {column}")
    ax.legend()
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    # 95% confidence intervals on Cpk / Ppk (Bissell 1990 large-sample SE):
    #   SE(index) ≈ sqrt( 1/(9n) + index²/(2(n−1)) ).
    # Minitab prints these on every capability report; they tell you how much
    # to trust the point estimate (a Cpk of 1.0 from n=20 is barely different
    # from 0.7). Omitting them was a real gap vs every commercial tool.
    def _index_ci(idx, n, z=1.959963984540054):
        if idx is None or n is None or n < 2:
            return None
        se = float(np.sqrt(1.0 / (9.0 * n) + (idx * idx) / (2.0 * (n - 1))))
        return {"lo": float(idx - z * se), "hi": float(idx + z * se), "se": se, "conf": 0.95}

    n_ = int(x.size)
    summary = {
        "n": n_, "mean": mu, "stdev": s_overall,
        "cp": raw["cp"], "cpk": raw["cpk"], "pp": raw["pp"], "ppk": raw["ppk"],
        "cpk_ci": _index_ci(raw["cpk"], n_), "ppk_ci": _index_ci(raw["ppk"], n_),
        "cpm": raw["cpm"], "z_bench": raw["z_bench"],
        "shapiro": {"W": float(nshap.statistic), "p": float(nshap.pvalue)} if nshap else None,
        "lsl": lsl, "usl": usl, "target": target,
    }
    if transformed is not None:
        # Preserve the legacy `box_cox` key when that family was used so
        # downstream consumers keep working. New `transformed` key is the
        # canonical home for all families (box-cox, johnson_su/sb/sl).
        if transformed.get("family") == "box-cox":
            summary["box_cox"] = transformed
        summary["transformed"] = transformed
    return {"summary": summary, "chart_png": buf.getvalue()}
