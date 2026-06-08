"""Multivariate analysis — PCA, k-means clustering, and LDA discriminant.

Implemented directly on numpy/scipy (no sklearn dependency) to keep the
deployment surface small. Closes the multivariate gap with Minitab for
the three procedures BBs actually run:

  - PCA: dimensionality reduction, scree plot, loadings, scores
  - K-means: cluster assignment with auto-k via silhouette score
  - LDA: classify into two-or-more known classes
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import linalg, stats as sps


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


# ───────── PCA ─────────

def pca(df: pd.DataFrame, columns: list[str], n_components: int | None = None,
        standardize: bool = True) -> dict:
    """Principal Components Analysis. Returns eigenvalues, variance-explained,
    cumulative variance, loadings (rotation matrix), and per-row scores. The
    scree plot is the standard visual.

    standardize=True (default) is correlation-PCA — columns scaled to mean 0,
    sd 1 before decomposition. Use False for covariance-PCA (when columns
    are in commensurate units already).
    """
    X = df[columns].dropna().astype(float).to_numpy()
    n, p = X.shape
    if n < 3 or p < 2:
        raise ValueError("pca: need at least 3 rows and 2 columns")

    mu = X.mean(axis=0)
    Xc = X - mu
    sd = X.std(axis=0, ddof=1)
    if standardize:
        sd_safe = np.where(sd > 0, sd, 1.0)
        Xc = Xc / sd_safe

    # SVD-based — numerically stable.
    U, s, Vt = linalg.svd(Xc, full_matrices=False)
    # Eigenvalues of the (correlation or covariance) matrix.
    eig = (s ** 2) / (n - 1)
    total = float(eig.sum())
    var_ratio = (eig / total).tolist() if total > 0 else [0.0] * len(eig)
    cum = np.cumsum(var_ratio).tolist()
    k = int(n_components) if n_components else len(eig)
    k = min(k, len(eig))

    # Loadings — Vt rows scaled by sqrt(eigenvalue) for "principal coordinates."
    loadings = (Vt[:k] * np.sqrt(eig[:k])[:, None]).tolist()
    scores = (U[:, :k] * s[:k]).tolist()

    fig, ax = plt.subplots(figsize=(6.5, 3.5))
    xs = np.arange(1, len(eig) + 1)
    ax.plot(xs, eig, marker="o", linestyle="-")
    ax.set_xlabel("Component")
    ax.set_ylabel("Eigenvalue")
    ax.set_title("Scree Plot")
    ax.axhline(1.0, linestyle=":")  # Kaiser cutoff for correlation PCA
    return {
        "summary": {
            "n": int(n), "p": int(p), "n_components_returned": int(k),
            "eigenvalues": eig.tolist(),
            "variance_ratio": var_ratio,
            "cumulative_variance_ratio": cum,
            "loadings": loadings,
            "scores": scores[:200],          # cap returned scores for response size
            "columns": list(columns),
            "standardized": bool(standardize),
            "mean": mu.tolist(),
            "stdev": sd.tolist(),
        },
        "chart_png": _png(fig),
    }


# ───────── K-means clustering ─────────

def _kmeans_pp(X: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    """k-means++ seeding — picks initial centroids that are spread out."""
    n = X.shape[0]
    centroids = np.empty((k, X.shape[1]))
    centroids[0] = X[rng.integers(0, n)]
    for i in range(1, k):
        # Squared distance from each point to its nearest existing centroid.
        d2 = np.min(np.sum((X[:, None, :] - centroids[None, :i, :]) ** 2, axis=2), axis=1)
        probs = d2 / d2.sum() if d2.sum() > 0 else np.full(n, 1.0 / n)
        centroids[i] = X[rng.choice(n, p=probs)]
    return centroids


def _kmeans_fit(X: np.ndarray, k: int, max_iter: int = 100, seed: int = 1) -> tuple:
    """Lloyd's algorithm with k-means++ init. Returns labels, centroids,
    inertia (within-cluster sum of squares)."""
    rng = np.random.default_rng(seed)
    centroids = _kmeans_pp(X, k, rng)
    labels = np.zeros(X.shape[0], dtype=int)
    for _ in range(max_iter):
        # E step
        d = np.sum((X[:, None, :] - centroids[None, :, :]) ** 2, axis=2)
        new_labels = np.argmin(d, axis=1)
        if np.all(new_labels == labels):
            labels = new_labels
            break
        labels = new_labels
        # M step
        for j in range(k):
            mask = labels == j
            if mask.any():
                centroids[j] = X[mask].mean(axis=0)
    inertia = float(np.sum(np.min(np.sum((X[:, None, :] - centroids[None, :, :]) ** 2, axis=2), axis=1)))
    return labels, centroids, inertia


def _silhouette(X: np.ndarray, labels: np.ndarray) -> float:
    """Mean silhouette score in [-1, 1]. Higher is better."""
    n = X.shape[0]
    if n < 3:
        return 0.0
    unique = np.unique(labels)
    if len(unique) < 2:
        return 0.0
    s = np.zeros(n)
    for i in range(n):
        same = labels == labels[i]
        same[i] = False
        if not same.any():
            s[i] = 0.0
            continue
        a = float(np.mean(np.linalg.norm(X[same] - X[i], axis=1)))
        b_vals = []
        for c in unique:
            if c == labels[i]:
                continue
            mask = labels == c
            if mask.any():
                b_vals.append(float(np.mean(np.linalg.norm(X[mask] - X[i], axis=1))))
        b = min(b_vals) if b_vals else 0.0
        s[i] = (b - a) / max(a, b) if max(a, b) > 0 else 0.0
    return float(np.mean(s))


def kmeans(df: pd.DataFrame, columns: list[str], k: int | None = None,
           k_max: int = 8, standardize: bool = True) -> dict:
    """K-means with optional automatic k. When k is None, scans 2..k_max
    and picks the k that maximizes mean silhouette score."""
    X = df[columns].dropna().astype(float).to_numpy()
    if X.shape[0] < 4:
        raise ValueError("kmeans: need at least 4 rows")
    if standardize:
        sd = X.std(axis=0, ddof=1)
        sd_safe = np.where(sd > 0, sd, 1.0)
        X = (X - X.mean(axis=0)) / sd_safe

    if k is None:
        scores = []
        for kk in range(2, min(k_max, X.shape[0] - 1) + 1):
            labels, _, _ = _kmeans_fit(X, kk)
            s = _silhouette(X, labels)
            scores.append((kk, s))
        k_best = max(scores, key=lambda t: t[1])[0]
    else:
        scores = None
        k_best = int(k)

    labels, centroids, inertia = _kmeans_fit(X, k_best)
    sil = _silhouette(X, labels)

    fig, ax = plt.subplots(figsize=(6.5, 4.0))
    if X.shape[1] >= 2:
        for j in range(k_best):
            mask = labels == j
            ax.scatter(X[mask, 0], X[mask, 1], label=f"cluster {j}", alpha=0.7)
        ax.scatter(centroids[:, 0], centroids[:, 1], marker="x", s=120)
        ax.set_xlabel(columns[0])
        ax.set_ylabel(columns[1])
        ax.set_title(f"K-means (k={k_best}, silhouette={sil:.2f})")
        ax.legend(loc="best", fontsize=8)
    return {
        "summary": {
            "k": int(k_best), "auto_k": k is None,
            "silhouette": sil,
            "inertia": inertia,
            "n": int(X.shape[0]),
            "cluster_sizes": [int(np.sum(labels == j)) for j in range(k_best)],
            "centroids": centroids.tolist(),
            "labels_preview": labels[:50].tolist(),
            "k_search": [{"k": kk, "silhouette": s} for kk, s in (scores or [])],
        },
        "chart_png": _png(fig),
    }


# ───────── LDA (Linear Discriminant Analysis) ─────────

def hierarchical_cluster(df: pd.DataFrame, columns: list[str],
                         method: str = "ward", n_clusters: int | None = None,
                         standardize: bool = True) -> dict:
    """Agglomerative hierarchical clustering. method ∈ {'single','complete',
    'average','ward'}. Returns the merge order (linkage matrix), per-row
    cluster labels at the requested cut, and a dendrogram PNG."""
    from scipy.cluster.hierarchy import linkage, fcluster, dendrogram
    from scipy.spatial.distance import pdist
    X = df[columns].dropna().astype(float).to_numpy()
    if X.shape[0] < 3:
        raise ValueError("hierarchical_cluster: need at least 3 rows")
    if standardize:
        sd = X.std(axis=0, ddof=1)
        sd_safe = np.where(sd > 0, sd, 1.0)
        X = (X - X.mean(axis=0)) / sd_safe
    Z = linkage(X, method=method)
    labels = None
    if n_clusters is not None:
        labels = fcluster(Z, t=n_clusters, criterion="maxclust").tolist()
    fig, ax = plt.subplots(figsize=(8.5, 4.5))
    dendrogram(Z, ax=ax, no_labels=X.shape[0] > 30)
    ax.set_title(f"Dendrogram — {method}")
    return {
        "summary": {
            "method": "hierarchical_cluster",
            "linkage_method": method,
            "n": int(X.shape[0]),
            "n_clusters": n_clusters,
            "labels": labels,
            "linkage_preview": Z[:20].tolist(),
        },
        "chart_png": _png(fig),
    }


def hotelling_t2(df: pd.DataFrame, columns: list[str],
                 mu0: list[float] | None = None) -> dict:
    """One-sample Hotelling's T² test — multivariate generalization of the
    one-sample t-test. Tests whether the mean vector equals mu0
    (defaults to the zero vector)."""
    X = df[columns].dropna().astype(float).to_numpy()
    n, p = X.shape
    if n <= p:
        raise ValueError("hotelling_t2: need n > p")
    mu0 = np.zeros(p) if mu0 is None else np.array(mu0, dtype=float)
    mean = X.mean(axis=0)
    S = np.cov(X, rowvar=False, ddof=1)
    diff = (mean - mu0).reshape(-1, 1)
    try:
        S_inv = linalg.inv(S)
    except Exception:
        raise ValueError(
            "hotelling_t2: the covariance matrix is singular — this happens when two "
            "columns are perfectly correlated or a column is constant. Remove "
            "redundant or constant columns and try again.")
    T2 = float(n * (diff.T @ S_inv @ diff))
    F_stat = T2 * (n - p) / ((n - 1) * p)
    p_val = float(1 - sps.f.cdf(F_stat, p, n - p))
    return {"summary": {
        "method": "hotelling_t2",
        "n": int(n), "p": int(p),
        "T2": T2, "F": float(F_stat), "p": p_val,
        "df1": int(p), "df2": int(n - p),
        "mean_vector": mean.tolist(), "mu0": mu0.tolist(),
    }}


def lda(df: pd.DataFrame, predictors: list[str], class_col: str) -> dict:
    """Fisher's LDA. Computes class means, pooled within-class covariance,
    discriminant coefficients (one direction per pair when k=2; k-1 axes
    for k classes), and produces a classification table for the training
    set (resubstitution error). Useful for separating known categories
    by quality dimensions or operational characteristics."""
    sub = df[predictors + [class_col]].dropna()
    classes = sub[class_col].unique()
    k = len(classes)
    if k < 2:
        raise ValueError("lda: need at least 2 classes")
    X = sub[predictors].astype(float).to_numpy()
    y = sub[class_col].to_numpy()
    n, p = X.shape

    # Class means
    means = {c: X[y == c].mean(axis=0) for c in classes}
    overall = X.mean(axis=0)

    # Within-class scatter Sw and between-class scatter Sb
    Sw = np.zeros((p, p))
    Sb = np.zeros((p, p))
    for c in classes:
        Xi = X[y == c]
        mu_i = means[c]
        Sw += (Xi - mu_i).T @ (Xi - mu_i)
        diff = (mu_i - overall).reshape(-1, 1)
        Sb += Xi.shape[0] * (diff @ diff.T)

    # Solve generalized eigenproblem: Sb v = λ Sw v
    try:
        eigvals, eigvecs = linalg.eigh(Sb, Sw)
    except linalg.LinAlgError:
        # Pseudo-inverse fallback if Sw is singular.
        Sw_inv = linalg.pinv(Sw)
        eigvals, eigvecs = np.linalg.eig(Sw_inv @ Sb)
        eigvals = np.real(eigvals)
        eigvecs = np.real(eigvecs)

    # Sort descending
    order = np.argsort(-eigvals)
    eigvals = eigvals[order]
    eigvecs = eigvecs[:, order]
    n_axes = min(k - 1, p)
    proj = X @ eigvecs[:, :n_axes]

    # Resubstitution classification — assign each row to nearest class
    # centroid in the projected space.
    centroids = {c: means[c] @ eigvecs[:, :n_axes] for c in classes}
    preds = []
    for row in proj:
        best_c, best_d = None, float("inf")
        for c, mu_c in centroids.items():
            d = float(np.linalg.norm(row - mu_c))
            if d < best_d:
                best_d, best_c = d, c
        preds.append(best_c)
    preds = np.array(preds)

    confusion = {}
    for c_true in classes:
        confusion[str(c_true)] = {str(c_pred): int(np.sum((y == c_true) & (preds == c_pred)))
                                  for c_pred in classes}
    accuracy = float(np.mean(preds == y))

    return {
        "summary": {
            "n": int(n), "n_predictors": int(p), "n_classes": int(k),
            "classes": [str(c) for c in classes],
            "class_means": {str(c): m.tolist() for c, m in means.items()},
            "eigenvalues": eigvals[:n_axes].tolist(),
            "discriminant_axes": eigvecs[:, :n_axes].tolist(),
            "training_accuracy": accuracy,
            "confusion_matrix": confusion,
            "predictors": list(predictors),
        }
    }


def manova(df, responses: list, factor: str):
    """MANOVA — tests whether a grouping factor moves a *vector* of responses
    jointly, controlling the family-wise error you'd inflate by running one
    ANOVA per response. Reports the four standard multivariate test statistics
    (Wilks' Λ, Pillai's trace, Hotelling-Lawley, Roy's largest root) with their
    F-approximations and p-values."""
    from statsmodels.multivariate.manova import MANOVA
    if not responses or len(responses) < 2:
        raise ValueError("MANOVA needs at least 2 response columns")
    cols = list(responses) + [factor]
    sub = df[cols].dropna().copy()
    for r in responses:
        sub[r] = pd.to_numeric(sub[r], errors="coerce")
    sub = sub.dropna()
    if sub[factor].nunique() < 2:
        raise ValueError("grouping factor needs at least 2 levels")
    # Build safe placeholder names (statsmodels formula can't take odd chars).
    rmap = {r: f"y{i}" for i, r in enumerate(responses)}
    data = sub.rename(columns=rmap).copy()
    data["_grp"] = sub[factor].astype("category").values
    lhs = " + ".join(rmap.values())
    mod = MANOVA.from_formula(f"{lhs} ~ C(_grp)", data=data)
    test = mod.mv_test()
    # Pull the factor's results table (skip the Intercept row).
    key = [k for k in test.results.keys() if k != "Intercept"][0]
    tbl = test.results[key]["stat"]
    stats_out = {}
    for name in ["Wilks' lambda", "Pillai's trace",
                 "Hotelling-Lawley trace", "Roy's greatest root"]:
        if name in tbl.index:
            row = tbl.loc[name]
            stats_out[name] = {
                "value": float(row["Value"]),
                "F": float(row["F Value"]),
                "num_df": float(row["Num DF"]),
                "den_df": float(row["Den DF"]),
                "p_value": float(row["Pr > F"]),
            }
    pillai_p = stats_out.get("Pillai's trace", {}).get("p_value")
    return {"summary": {
        "method": "manova",
        "responses": list(responses), "factor": factor,
        "n": int(len(sub)), "n_groups": int(sub[factor].nunique()),
        "groups": [str(g) for g in sub[factor].unique().tolist()],
        "tests": stats_out,
        "significant": (pillai_p is not None and pillai_p < 0.05),
        "headline": ("Groups differ on the response vector (Pillai p < 0.05)."
                     if (pillai_p is not None and pillai_p < 0.05)
                     else "No multivariate group difference detected (Pillai p ≥ 0.05)."),
    }}


def _varimax(loadings: np.ndarray, gamma: float = 1.0, max_iter: int = 100, tol: float = 1e-6):
    """Kaiser varimax rotation — rotates factor loadings to a simpler, more
    interpretable structure (each variable loads heavily on as few factors as
    possible)."""
    p, k = loadings.shape
    if k < 2:
        return loadings, np.eye(k)
    R = np.eye(k)
    d_old = 0.0
    for _ in range(max_iter):
        L = loadings @ R
        u, s, vt = np.linalg.svd(
            loadings.T @ (L ** 3 - (gamma / p) * L @ np.diag(np.sum(L ** 2, axis=0)))
        )
        R = u @ vt
        d = float(np.sum(s))
        if d_old != 0 and d / d_old < 1 + tol:
            break
        d_old = d
    return loadings @ R, R


def factor_analysis(df, columns: list, n_factors=None, rotation: str = "varimax"):
    """Exploratory factor analysis — finds latent factors behind correlated
    measured variables (the survey/measurement-system staple Minitab and SPSS
    ship). Maximum-likelihood extraction (sklearn) + optional varimax rotation,
    with loadings, communalities, uniquenesses, and variance explained."""
    from sklearn.decomposition import FactorAnalysis
    if not columns or len(columns) < 2:
        raise ValueError("factor analysis needs at least 2 variables")
    sub = df[columns].apply(pd.to_numeric, errors="coerce").dropna()
    n, p = sub.shape
    if n < p + 2:
        raise ValueError(f"need ≥ {p + 2} complete rows; got {n}")
    X = sub.to_numpy(dtype=float)
    Xs = (X - X.mean(axis=0)) / X.std(axis=0, ddof=0)
    if n_factors is None:
        # Kaiser rule: number of correlation-matrix eigenvalues > 1.
        eig = np.linalg.eigvalsh(np.corrcoef(Xs, rowvar=False))
        n_factors = max(1, int(np.sum(eig > 1.0)))
    n_factors = min(n_factors, p - 1) if p > 1 else 1

    fa = FactorAnalysis(n_components=n_factors, rotation=None,
                        svd_method="lapack", random_state=0)
    fa.fit(Xs)
    load = fa.components_.T            # (p, n_factors)
    rot_matrix = None
    if rotation == "varimax" and n_factors >= 2:
        load, R = _varimax(load)
        rot_matrix = R.tolist()

    communalities = np.sum(load ** 2, axis=1)
    uniquenesses = 1.0 - communalities
    var_explained = np.sum(load ** 2, axis=0)
    prop_var = var_explained / p

    loadings = [{
        "variable": columns[i],
        "loadings": [float(load[i, f]) for f in range(n_factors)],
        "communality": float(communalities[i]),
        "uniqueness": float(uniquenesses[i]),
    } for i in range(p)]

    # Loadings heatmap.
    fig, ax = plt.subplots(figsize=(max(4, 1.2 * n_factors + 2), max(2.6, 0.4 * p + 1)))
    im = ax.imshow(load, cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")
    ax.set_xticks(range(n_factors)); ax.set_xticklabels([f"F{f+1}" for f in range(n_factors)])
    ax.set_yticks(range(p)); ax.set_yticklabels(columns, fontsize=8)
    for i in range(p):
        for f in range(n_factors):
            ax.text(f, i, f"{load[i, f]:.2f}", ha="center", va="center",
                    fontsize=7, color="#222")
    ax.set_title(f"Factor loadings ({rotation if n_factors >= 2 else 'unrotated'})")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    return {"summary": {
        "method": "factor_analysis",
        "n": int(n), "n_variables": int(p), "n_factors": int(n_factors),
        "rotation": rotation if n_factors >= 2 else "none",
        "loadings": loadings,
        "variance_explained": var_explained.tolist(),
        "proportion_variance": prop_var.tolist(),
        "total_variance_explained": float(np.sum(prop_var)),
        "rotation_matrix": rot_matrix,
    }, "chart_png": buf.getvalue()}
