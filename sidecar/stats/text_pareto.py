"""Text-comment auto-Pareto — turn a column of free-text VOC / complaint /
defect comments into a Pareto of themes, with zero LLM. Deterministic:
tokenize → drop stopwords → light stemming → count keywords + bigrams, or map
to caller-supplied themes. The Voice-of-the-Customer tool that usually means a
manual afternoon of tagging.
"""
from __future__ import annotations

import io
import re
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

_STOP = set("""
a an the and or but if then else of to in on at by for with from into over under again further
is are was were be been being have has had do does did i you he she it we they them this that these
those my your our their as not no so than too very can will just don dont it's im we're
""".split())

_WORD = re.compile(r"[a-z][a-z'\-]+")


def _stem(w: str) -> str:
    """Very light suffix stemmer — enough to merge plurals/gerunds for VOC."""
    for suf in ("ing", "ies", "ied", "es", "ed", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[: -len(suf)] + ("y" if suf == "ies" else "")
    return w


def _tokens(text: str):
    return [_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 2]


def _png(fig):
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)
    return buf.getvalue()


def analyze(df: pd.DataFrame, text_col: str, top_n: int = 10,
            themes: dict | None = None, use_bigrams: bool = True,
            threshold_pct: float = 80.0) -> dict:
    """text_col: free-text column. themes: optional {theme: [keywords]} mapping;
    when omitted, the top keywords/bigrams ARE the themes."""
    if text_col not in df.columns:
        raise ValueError(f"column '{text_col}' not in dataset")
    comments = [str(c) for c in df[text_col].dropna().tolist() if str(c).strip()]
    if len(comments) < 2:
        raise ValueError("need at least 2 non-empty comments")

    counts = Counter()
    matched = 0
    if themes:
        # Map each comment to every theme whose keyword appears (a comment can
        # hit multiple themes).
        norm = {t: [_stem(k.lower()) for k in kws] for t, kws in themes.items()}
        for c in comments:
            toks = set(_tokens(c))
            raw = c.lower()
            hit = False
            for t, kws in norm.items():
                if any(k in toks or k in raw for k in kws):
                    counts[t] += 1; hit = True
            if hit:
                matched += 1
        basis = "themes"
    else:
        for c in comments:
            toks = _tokens(c)
            counts.update(toks)
            if use_bigrams:
                counts.update([f"{toks[i]} {toks[i+1]}" for i in range(len(toks) - 1)])
        matched = len(comments)
        basis = "keywords"

    if not counts:
        raise ValueError("no themes/keywords extracted — comments may be all stopwords")

    items = counts.most_common(top_n)
    total = sum(counts.values())
    rows, cum = [], 0.0
    vital = []
    for label, cnt in items:
        pct = 100.0 * cnt / total
        cum += pct
        rows.append({"theme": label, "count": int(cnt), "pct": pct, "cum_pct": cum})
        if cum <= threshold_pct or not vital:
            vital.append(label)

    # Pareto chart (bars + cumulative line).
    labels = [r["theme"] for r in rows]
    vals = [r["count"] for r in rows]
    cums = [r["cum_pct"] for r in rows]
    fig, ax1 = plt.subplots(figsize=(9, 4.5))
    ax1.bar(range(len(labels)), vals, color="#c9a24b")
    ax1.set_xticks(range(len(labels)))
    ax1.set_xticklabels(labels, rotation=35, ha="right", fontsize=9)
    ax1.set_ylabel("mentions")
    ax2 = ax1.twinx()
    ax2.plot(range(len(labels)), cums, color="#c0504d", marker="o")
    ax2.axhline(threshold_pct, ls="--", color="#888")
    ax2.set_ylim(0, 105); ax2.set_ylabel("cumulative %")
    ax1.set_title(f"Comment Pareto — {text_col} ({basis})")

    return {"summary": {
        "method": "text_pareto",
        "text_col": text_col, "basis": basis,
        "n_comments": len(comments), "n_matched": matched,
        "themes": rows,
        "vital_few": vital,
        "note": "Themes extracted deterministically (tokenize → stopword removal → light stemming) — no LLM. Supply a {theme: keywords} map to force your own taxonomy.",
    }, "chart_png": _png(fig)}
