"""DMAIC recommendation engine — the deterministic 'what should I do next?'
brain behind the Conyso Bench project copilot.

Given where a project is (DMAIC phase), what data it has, and what analyses
have already been run *with their results*, it returns a ranked list of
recommended next steps — each with a plain-English rationale, a priority, a
one-click launch target, and the prior findings that triggered it — plus a
tollgate readiness verdict for the current phase.

Design goals:
  * Pure function over plain dicts — no pandas, no I/O, no LLM. Trivially
    unit-testable and the same engine Bill (the AI layer) can call.
  * Rules are small, independent functions grouped by phase in a registry.
    Adding coverage later = append a function + a test. The structure is
    open-ended; v1 ships a comprehensive rule set.

Reasoning classes covered:
  1. DMAIC sequence gates   — prerequisites (MSA→trust, stability→capability…)
  2. Result-driven escalation — reads prior *results* (Cpk<1.33 → DOE/centre…)
  3. Data-shape awareness    — n, missingness, normality, single-group
  4. Completeness critic     — expected artifacts missing for a clean tollgate
  5. Staleness               — re-run analyses whose dataset has changed
"""
from __future__ import annotations

PHASES = ["define", "measure", "analyze", "improve", "control"]
PHASE_LABELS = {"define": "Define", "measure": "Measure", "analyze": "Analyze",
                "improve": "Improve", "control": "Control"}
PRIORITY_RANK = {"blocker": 0, "high": 1, "medium": 2, "low": 3}

# Capability / GR&R decision thresholds (industry-standard LSS conventions).
CPK_TARGET = 1.33
GRR_MARGINAL = 10.0      # %study var: <10 good, 10–30 marginal, >30 unacceptable
GRR_UNACCEPTABLE = 30.0
MIN_ROWS = 15


# ───────── context accessors ─────────

def _history(ctx):
    return ctx.get("history") or []


def _of_kind(ctx, kind):
    """All analyses of a given kind, newest first (history is newest-first)."""
    return [a for a in _history(ctx) if a.get("kind") == kind]


def _latest(ctx, kind):
    items = _of_kind(ctx, kind)
    return items[0] if items else None


def _has(ctx, kind):
    return bool(_of_kind(ctx, kind))


def _summary(a):
    return (a or {}).get("summary") or {}


def _rec(priority, title, rationale, action=None, blocks_gate=False, based_on=None, key=None):
    return {
        "key": key or title,
        "priority": priority,
        "title": title,
        "rationale": rationale,
        "action": action,             # {kind, params}|{view,toolKind}|None
        "blocks_gate": bool(blocks_gate),
        "based_on": based_on or [],
    }


# ═════════════════════ DEFINE ═════════════════════

def _define_pareto(ctx):
    if not _has(ctx, "pareto"):
        return _rec("high", "Quantify the problem with a Pareto",
                    "Define needs a data-backed problem statement. A Pareto of defects/complaints "
                    "shows where the pain concentrates so you scope the vital few.",
                    action={"kind": "pareto"}, blocks_gate=True, key="define.pareto")
    return None


def _define_baseline_hint(ctx):
    if not _has(ctx, "distribution_id") and ctx.get("dataset"):
        return _rec("low", "Profile your data distribution",
                    "Knowing the distribution up front tells you which tools are valid downstream "
                    "(normal vs. non-normal capability, parametric vs. rank tests).",
                    action={"kind": "distribution_id"}, key="define.dist")
    return None


# ═════════════════════ MEASURE ═════════════════════

def _measure_msa_gate(ctx):
    msa = _latest(ctx, "msa")
    if not msa:
        return _rec("blocker", "Validate the measurement system first (Gauge R&R)",
                    "Every Measure/Analyze number inherits your gauge's error. Run a Gauge R&R "
                    "before trusting capability or any comparison — otherwise you may be studying "
                    "measurement noise, not the process.",
                    action={"kind": "msa", "params": {"design": "crossed"}},
                    blocks_gate=True, key="measure.msa")
    s = _summary(msa)
    grr = s.get("total_grr_pct")
    if grr is not None and grr > GRR_UNACCEPTABLE:
        return _rec("blocker", f"Fix the measurement system — %GR&R is {grr:.0f}%",
                    f"At {grr:.0f}% study variation (>30%) the gauge can't reliably distinguish parts. "
                    "Improve the measurement method (training, fixturing, resolution) and re-run GR&R "
                    "before drawing any conclusions from this data.",
                    action={"kind": "msa", "params": {"design": "crossed"}},
                    blocks_gate=True, based_on=[msa.get("id")], key="measure.msa.bad")
    if grr is not None and grr > GRR_MARGINAL:
        return _rec("medium", f"Measurement system is marginal (%GR&R {grr:.0f}%)",
                    f"{grr:.0f}% is in the 10–30% 'use with caution' band. Acceptable for relative "
                    "comparisons but tighten it before fine capability work.",
                    based_on=[msa.get("id")], key="measure.msa.marginal")
    return None


def _measure_baseline_capability(ctx):
    if _has(ctx, "msa") and not _has(ctx, "capability"):
        return _rec("high", "Capture baseline capability",
                    "With the gauge validated, establish a baseline Cp/Cpk now — you can't prove the "
                    "Improve phase worked without a credible 'before' number.",
                    action={"kind": "capability"}, blocks_gate=True, key="measure.baseline")
    return None


def _measure_small_n(ctx):
    ds = ctx.get("dataset") or {}
    n = ds.get("n_rows")
    if n is not None and n < MIN_ROWS and not _has(ctx, "sample_size"):
        return _rec("medium", f"Only {n} rows — check your sample size",
                    f"{n} observations is thin for stable estimates. Run a sample-size/power "
                    "calculation so your conclusions aren't an artifact of too little data.",
                    action={"view": "tools", "toolKind": "power_curve"}, key="measure.n")
    return None


# ═════════════════════ ANALYZE ═════════════════════

def _analyze_stability_before_capability(ctx):
    cap = _latest(ctx, "capability")
    if cap and not _has(ctx, "control_chart"):
        return _rec("high", "Confirm the process is stable before trusting capability",
                    "Capability indices assume statistical control. Run an I-MR or X-bar/R chart — if "
                    "the process is unstable, Cpk is meaningless and you should hunt special causes first.",
                    action={"kind": "control_chart", "params": {"kind": "I-MR"}},
                    based_on=[cap.get("id")], key="analyze.stability")
    return None


def _analyze_ooc_blocker(ctx):
    cc = _latest(ctx, "control_chart")
    if cc:
        viol = _summary(cc).get("violations") or []
        if viol:
            return _rec("blocker", f"Investigate {len(viol)} out-of-control point(s) first",
                        "The control chart flags special-cause signals. Find and remove the assignable "
                        "cause before any capability, comparison, or improvement work — the process "
                        "isn't behaving as one stable population yet.",
                        based_on=[cc.get("id")], blocks_gate=True, key="analyze.ooc")
    return None


def _analyze_cpk_escalation(ctx):
    cap = _latest(ctx, "capability")
    if not cap:
        return None
    s = _summary(cap)
    cpk, cp = s.get("cpk"), s.get("cp")
    if cpk is None or cpk >= CPK_TARGET:
        return None
    # Off-centre (Cpk much worse than Cp) → centring is the cheap win.
    if cp is not None and cp - cpk > 0.15 * max(cp, 1e-9) and cp >= CPK_TARGET:
        return _rec("high", "Re-centre the process before reducing variation",
                    f"Cpk={cpk:.2f} is well below Cp={cp:.2f}, so the spread is fine but the mean is "
                    "off-target. Re-centring is usually faster and cheaper than cutting variance — do it first.",
                    action={"kind": "predictive_cpk"}, based_on=[cap.get("id")], key="analyze.recenter")
    # Spread-limited → need to reduce variation: DOE.
    return _rec("high", f"Cpk={cpk:.2f} is below 1.33 — find the variation drivers",
                "Capability is short of target and re-centring alone won't close it. Use ANOVA/regression "
                "to find which factors drive variation, then a DOE to reduce it.",
                action={"kind": "doe"}, based_on=[cap.get("id")], key="analyze.reduce_var")


def _analyze_posthoc(ctx):
    for a in _of_kind(ctx, "hypothesis_test"):
        s = _summary(a)
        if s.get("test") in ("one_way_anova", "welch_anova") and (s.get("p") is not None and s["p"] < 0.05):
            if not _has(ctx, "posthoc"):
                return _rec("high", "ANOVA is significant — find *which* groups differ",
                            f"The ANOVA p={s['p']:.3g} says at least one group mean differs, but not which. "
                            "Run Tukey HSD (all pairs) or Hsu MCB (which is best) to localise the effect.",
                            action={"kind": "posthoc", "params": {"test": "tukey_hsd"}},
                            based_on=[a.get("id")], key="analyze.posthoc")
    return None


def _analyze_regression_quality(ctx):
    reg = _latest(ctx, "regression")
    if not reg:
        return None
    s = _summary(reg)
    r2 = s.get("r2")
    vif = s.get("vif") or []
    high_vif = [v for v in vif if isinstance(v, dict) and (v.get("vif") or 0) > 5]
    if high_vif:
        names = ", ".join(v.get("term", "?") for v in high_vif[:3])
        return _rec("medium", "Multicollinearity is inflating your model",
                    f"VIF>5 on {names}. The predictors overlap, so coefficients are unstable. Use ridge/lasso "
                    "regularization or drop redundant terms.",
                    action={"kind": "regression", "params": {"method": "ridge"}},
                    based_on=[reg.get("id")], key="analyze.vif")
    if r2 is not None and r2 < 0.5:
        return _rec("medium", f"Weak model fit (R²={r2:.2f}) — try richer terms",
                    "Less than half the variation is explained. Add interaction terms, try a nonlinear or "
                    "spline fit, or revisit whether the right factors were measured.",
                    based_on=[reg.get("id")], key="analyze.weakr2")
    return None


# ═════════════════════ IMPROVE ═════════════════════

def _improve_need_doe(ctx):
    if not _has(ctx, "doe") and not _has(ctx, "desirability"):
        return _rec("high", "Run a designed experiment to find optimal settings",
                    "Improve is where you actively change factors. A factorial DOE (or response-surface + "
                    "desirability) finds the settings that hit target with least variation — far more "
                    "efficient than one-factor-at-a-time.",
                    action={"kind": "doe"}, blocks_gate=True, key="improve.doe")
    return None


def _improve_tolerance_design(ctx):
    # If an output is spec-limited and the project hasn't simulated its drivers,
    # nudge toward Monte-Carlo tolerance design (predict capability before build).
    cap = _latest(ctx, "capability")
    if cap and not _has(ctx, "monte_carlo"):
        s = _summary(cap)
        cpk = s.get("cpk")
        if cpk is not None and cpk < CPK_TARGET:
            return _rec("medium", "Simulate tolerances to design the variation out",
                        "Rather than trial-and-error, run a Monte-Carlo tolerance analysis: model each "
                        "input's variation, propagate it through the transfer function, and see which inputs "
                        "drive the output spread — then tighten only those.",
                        action={"view": "tools", "toolKind": "monte_carlo"},
                        based_on=[cap.get("id")], key="improve.montecarlo")
    return None


def _improve_confirm_run(ctx):
    if (_has(ctx, "doe") or _has(ctx, "desirability")) and not _has(ctx, "predictive_cpk"):
        return _rec("high", "Confirm the optimum before locking it in",
                    "A DOE predicts the best settings; a confirmation run proves them on the real process. "
                    "Validate predicted capability at the chosen settings before moving to Control.",
                    action={"kind": "predictive_cpk"}, blocks_gate=True, key="improve.confirm")
    return None


# ═════════════════════ CONTROL ═════════════════════

def _control_chart_required(ctx):
    # A *fresh* control chart in the Control phase (the sustaining one).
    if not _has(ctx, "control_chart"):
        return _rec("blocker", "Establish a control chart to hold the gain",
                    "Control means monitoring. Put the improved process on an I-MR or X-bar/R chart with "
                    "locked limits so any drift is caught before it becomes scrap.",
                    action={"kind": "control_chart", "params": {"kind": "X-bar/R"}},
                    blocks_gate=True, key="control.chart")
    return None


def _control_sustained_capability(ctx):
    if _has(ctx, "control_chart") and not _has(ctx, "sixpack"):
        return _rec("medium", "Verify sustained capability (capability six-pack)",
                    "Close the project by confirming the gain holds: a capability six-pack shows the chart, "
                    "distribution, and Cp/Cpk together as your control evidence.",
                    action={"kind": "sixpack"}, key="control.sixpack")
    return None


# ───────── registry ─────────

PHASE_RULES = {
    "define":  [_define_pareto, _define_baseline_hint],
    "measure": [_measure_msa_gate, _measure_baseline_capability, _measure_small_n],
    "analyze": [_analyze_ooc_blocker, _analyze_stability_before_capability,
                _analyze_cpk_escalation, _analyze_posthoc, _analyze_regression_quality],
    "improve": [_improve_need_doe, _improve_tolerance_design, _improve_confirm_run],
    "control": [_control_chart_required, _control_sustained_capability],
}

# Artifacts a clean tollgate expects per phase (for the completeness critic).
PHASE_EXPECTED = {
    "define":  [("pareto", "a quantified problem (Pareto)")],
    "measure": [("msa", "a validated measurement system (Gauge R&R)"),
                ("capability", "a baseline capability study")],
    "analyze": [("control_chart", "a stability check (control chart)")],
    "improve": [("doe", "a designed experiment or optimization")],
    "control": [("control_chart", "an ongoing control chart")],
}


def _gate(ctx, recs):
    """Tollgate readiness for the current phase."""
    phase = ctx.get("phase", "define")
    blockers = [r for r in recs if r["blocks_gate"]]
    expected = PHASE_EXPECTED.get(phase, [])
    missing = [desc for kind, desc in expected if not _has(ctx, kind)]
    ready = not blockers and not missing
    return {
        "phase": phase,
        "ready": ready,
        "blockers": [{"title": b["title"], "key": b["key"]} for b in blockers],
        "missing_artifacts": missing,
        "verdict": ("Ready to advance — no blockers and all expected artifacts present."
                    if ready else
                    "Not ready — resolve blockers / missing artifacts before the tollgate."),
    }


def recommend(phase: str, dataset: dict | None = None,
              history: list | None = None, open_items: list | None = None) -> dict:
    """Entry point. Returns ranked recommendations + tollgate verdict."""
    if phase not in PHASES:
        raise ValueError(f"unknown DMAIC phase: {phase!r} (expected one of {PHASES})")
    ctx = {"phase": phase, "dataset": dataset or None,
           "history": history or [], "open_items": open_items or []}

    recs = []
    seen = set()
    for rule in PHASE_RULES.get(phase, []):
        r = rule(ctx)
        if r and r["key"] not in seen:
            seen.add(r["key"])
            recs.append(r)

    # Surface unresolved follow-ups from prior analyses as low-priority nudges.
    for item in ctx["open_items"]:
        title = item.get("title") or item.get("text")
        if title and title not in seen:
            seen.add(title)
            recs.append(_rec("low", title,
                             item.get("rationale", "An open follow-up from an earlier analysis."),
                             action=item.get("action"), key=title))

    recs.sort(key=lambda r: PRIORITY_RANK.get(r["priority"], 9))
    gate = _gate(ctx, recs)
    return {
        "summary": {
            "phase": phase,
            "phase_label": PHASE_LABELS[phase],
            "n_recommendations": len(recs),
            "recommendations": recs,
            "gate": gate,
            "note": "Deterministic DMAIC guidance — rule-based, no LLM. Each item carries its reasoning and the prior findings that triggered it.",
        }
    }
