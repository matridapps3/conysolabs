"""Conyso Bench — matplotlib theme.

Imported for its side effect: setting global rcParams so every chart the
sidecar renders matches the editorial premium identity.

We render PNGs on a white background with a monochrome charcoal palette
(red for spec lines, bronze for targets/accents). Light-mode-first: white
PNGs read as 'paper inserts' in both the dark and light UI themes — this is
intentional, matching the printed-page editorial aesthetic of conyso.com.

Dark-mode PNGs are an enhancement for a future pass.
"""

from __future__ import annotations

import matplotlib as _mpl

# Headless backend. Matches what every stats module already calls; safe to
# repeat. Must happen before any `import matplotlib.pyplot` in the process.
_mpl.use("Agg")

# Token mirrors of styles.css `[data-theme="light"]` so what the user sees
# in browser-rendered charts matches what the sidecar renders server-side.
INK = "#14110b"          # warm near-black
INK_2 = "#3a3530"
MUTED = "#6f6960"
LINE = "#cbc6bb"         # ~ rgba(20,17,11,0.22) flattened on white
SURFACE = "#ffffff"
PAPER_BG = "#ffffff"     # explicit: PNGs render on white
ACCENT = "#6b5524"       # antique bronze — targets, accent lines
DANGER = "#8e3326"       # spec lines, violations
WARN = "#7a5618"
SUCCESS = "#2a5d34"
CHART_FILL = "#1a1813"   # solid charcoal — bars, monochrome fills

# Categorical cycle for grouped charts (boxplots by group, multi-line plots).
# All low-saturation, magazine-friendly; no pure primaries.
CATEGORICAL = [
    "#1a1813",   # ink charcoal
    "#6b5524",   # bronze
    "#8e3326",   # rust red
    "#2a5d34",   # forest green
    "#3a3530",   # dim ink
    "#7a5618",   # ochre
    "#4a4540",   # warm gray
    "#5a3a30",   # cocoa
]

_mpl.rcParams.update({
    # Surfaces
    "figure.facecolor":   PAPER_BG,
    "axes.facecolor":     PAPER_BG,
    "savefig.facecolor":  PAPER_BG,
    "savefig.edgecolor":  PAPER_BG,

    # Ink
    "axes.edgecolor":     LINE,
    "axes.labelcolor":    INK_2,
    "xtick.color":        MUTED,
    "ytick.color":        MUTED,
    "text.color":         INK,
    "axes.titlecolor":    INK,

    # Type
    "font.family":        ["Inter", "Helvetica Neue", "DejaVu Sans", "sans-serif"],
    "font.size":          10.0,
    "axes.titlesize":     12.0,
    "axes.titleweight":   "regular",
    "axes.labelsize":     10.0,
    "xtick.labelsize":    9.0,
    "ytick.labelsize":    9.0,
    "legend.fontsize":    9.0,
    "axes.labelweight":   "regular",

    # Hairline borders — drop the heavy default frame.
    "axes.linewidth":     0.6,
    "axes.spines.top":    False,
    "axes.spines.right":  False,
    "xtick.major.size":   3.0,
    "ytick.major.size":   3.0,
    "xtick.major.width":  0.5,
    "ytick.major.width":  0.5,

    # Grid — subtle horizontal only.
    "axes.grid":          True,
    "axes.grid.axis":     "y",
    "grid.color":         LINE,
    "grid.linewidth":     0.4,
    "grid.alpha":         0.6,

    # Legend — flat, hairline, no shadow.
    "legend.frameon":     True,
    "legend.framealpha":  1.0,
    "legend.edgecolor":   LINE,
    "legend.facecolor":   PAPER_BG,
    "legend.fancybox":    False,
    "legend.borderpad":   0.7,

    # Lines and markers — premium hairline.
    "lines.linewidth":    1.2,
    "lines.markersize":   4.0,
    "lines.solid_capstyle": "round",

    # Bar / patch defaults — solid charcoal, no edges.
    "patch.linewidth":    0.0,
    "patch.facecolor":    CHART_FILL,

    # Categorical color cycle — replaces matplotlib's default 10-color palette.
    "axes.prop_cycle":    _mpl.cycler(color=CATEGORICAL),

    # Output — PNGs at retina-ish density so they look crisp.
    "figure.dpi":         110,
    "savefig.dpi":        144,
    "savefig.bbox":       "tight",
    "savefig.pad_inches": 0.18,
})
