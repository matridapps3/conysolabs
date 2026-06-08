"""DPMO and process sigma level — every BB calculates these by hand. We do it
right and back-translate to long-term Cpk.

DPMO = (defects / (units × opportunities)) × 1,000,000
Sigma level (short-term) = NORM.S.INV(1 - DPMO/1e6) + 1.5
The "+1.5" is the classic 1.5σ shift Six Sigma uses to bridge ST→LT.
"""

from typing import Optional

import math
from scipy.stats import norm


def compute(
    *,
    defects: float,
    units: float,
    opportunities_per_unit: float = 1.0,
    apply_shift: bool = True,
):
    if units <= 0 or opportunities_per_unit <= 0:
        raise ValueError("units and opportunities_per_unit must be positive")
    if defects < 0:
        raise ValueError("defects must be ≥ 0")

    total_opps = units * opportunities_per_unit
    dpu = defects / units
    dpo = defects / total_opps
    dpmo = dpo * 1_000_000

    yield_pct = max(0.0, 1.0 - dpo) * 100.0
    rolled_throughput_yield = math.exp(-dpu) * 100.0  # for multi-step processes

    if dpmo >= 1_000_000:
        sigma_level = 0.0
    elif dpmo <= 0:
        sigma_level = 6.0
    else:
        z = norm.ppf(1.0 - dpo)
        sigma_level = z + (1.5 if apply_shift else 0.0)

    # Process sigma both with and without the classic 1.5σ shift, so the
    # calculator UI can show both. (sigma_level above is kept unchanged for
    # any existing consumer.)
    if dpmo >= 1_000_000:
        sigma_level_no_shift = 0.0
    elif dpmo <= 0:
        sigma_level_no_shift = 6.0
    else:
        sigma_level_no_shift = float(norm.ppf(1.0 - dpo))
    sigma_level_shifted = sigma_level_no_shift + 1.5

    band = (
        "world-class"   if sigma_level >= 6 else
        "excellent"     if sigma_level >= 5 else
        "above average" if sigma_level >= 4 else
        "average"       if sigma_level >= 3 else
        "below average" if sigma_level >= 2 else
        "poor"
    )

    return {
        "summary": {
            "defects": defects,
            "units": units,
            "opportunities_per_unit": opportunities_per_unit,
            "dpu": dpu,
            "dpo": dpo,
            "dpmo": dpmo,
            "yield_pct": yield_pct,
            "rolled_throughput_yield_pct": rolled_throughput_yield,
            "sigma_level": sigma_level,
            "sigma_level_no_shift": sigma_level_no_shift,
            "sigma_level_shifted": sigma_level_shifted,
            "applied_1_5_shift": apply_shift,
            "band": band,
        }
    }
