// Baked-in LSS sample datasets. Each one is small, realistic, and lands
// cleanly on one canonical analysis so a new user can click "Load sample"
// → "Run Cpk" and immediately see what Bench does. Used by:
//   - the empty-state CTA in DataView
//   - the first-visit tour
//   - the in-app Guides (each guide can point at a matching sample)
//
// Data was hand-built or generated with a fixed RNG seed and re-checked
// against the analysis kind it teaches — not random noise.

export const SAMPLE_DATASETS = [
  // ───────── Capability (continuous, mildly off-center) ─────────
  {
    id: 'capability_cycle_time',
    name: 'Cycle time (capability example)',
    blurb: 'Cycle times in minutes for a 5-shift production run. LSL=4.5, USL=6.5, target=5.5. Slightly off-target, mildly drifting — a textbook "marginally capable" process.',
    suggested_analysis: 'capability',
    rows: [
      { batch: 1,  cycle_time_minutes: 5.2, line: 'A', shift: 'morning' },
      { batch: 2,  cycle_time_minutes: 5.1, line: 'A', shift: 'morning' },
      { batch: 3,  cycle_time_minutes: 4.9, line: 'A', shift: 'morning' },
      { batch: 4,  cycle_time_minutes: 5.3, line: 'A', shift: 'morning' },
      { batch: 5,  cycle_time_minutes: 5.0, line: 'A', shift: 'afternoon' },
      { batch: 6,  cycle_time_minutes: 5.4, line: 'B', shift: 'afternoon' },
      { batch: 7,  cycle_time_minutes: 5.5, line: 'B', shift: 'afternoon' },
      { batch: 8,  cycle_time_minutes: 5.6, line: 'B', shift: 'afternoon' },
      { batch: 9,  cycle_time_minutes: 5.3, line: 'B', shift: 'afternoon' },
      { batch: 10, cycle_time_minutes: 5.4, line: 'B', shift: 'night' },
      { batch: 11, cycle_time_minutes: 5.1, line: 'A', shift: 'night' },
      { batch: 12, cycle_time_minutes: 5.0, line: 'A', shift: 'night' },
      { batch: 13, cycle_time_minutes: 4.8, line: 'A', shift: 'night' },
      { batch: 14, cycle_time_minutes: 5.2, line: 'A', shift: 'morning' },
      { batch: 15, cycle_time_minutes: 5.5, line: 'B', shift: 'morning' },
      { batch: 16, cycle_time_minutes: 5.3, line: 'B', shift: 'morning' },
      { batch: 17, cycle_time_minutes: 5.2, line: 'B', shift: 'afternoon' },
      { batch: 18, cycle_time_minutes: 5.4, line: 'B', shift: 'afternoon' },
      { batch: 19, cycle_time_minutes: 5.0, line: 'A', shift: 'night' },
      { batch: 20, cycle_time_minutes: 5.1, line: 'A', shift: 'night' },
      { batch: 21, cycle_time_minutes: 5.3, line: 'A', shift: 'morning' },
      { batch: 22, cycle_time_minutes: 5.0, line: 'A', shift: 'morning' },
      { batch: 23, cycle_time_minutes: 5.4, line: 'B', shift: 'afternoon' },
      { batch: 24, cycle_time_minutes: 5.6, line: 'B', shift: 'afternoon' },
      { batch: 25, cycle_time_minutes: 5.5, line: 'B', shift: 'afternoon' },
      { batch: 26, cycle_time_minutes: 5.2, line: 'A', shift: 'night' },
      { batch: 27, cycle_time_minutes: 4.9, line: 'A', shift: 'night' },
      { batch: 28, cycle_time_minutes: 5.1, line: 'A', shift: 'night' },
      { batch: 29, cycle_time_minutes: 5.4, line: 'B', shift: 'morning' },
      { batch: 30, cycle_time_minutes: 5.3, line: 'B', shift: 'morning' },
    ],
  },

  // ───────── Gauge R&R (crossed, 10 parts × 3 operators × 2 trials) ─────────
  {
    id: 'msa_gauge_rr',
    name: 'Gauge R&R study (10 parts × 3 ops × 2 trials)',
    blurb: 'AIAG MSA-style crossed study. Three operators measure ten parts twice each. %R&R should land in the acceptable range.',
    suggested_analysis: 'msa',
    rows: (() => {
      const out = [];
      // Part true values
      const partTrue = [9.85, 10.12, 10.05, 9.97, 10.08, 9.93, 10.15, 10.03, 9.98, 10.07];
      const opBias   = { A: 0.00, B: 0.02, C: -0.01 };
      // Deterministic small "noise" so the dataset is reproducible
      let seed = 11;
      const r = () => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280 - 0.5) * 0.06; };
      for (let p = 0; p < 10; p++) {
        for (const op of ['A', 'B', 'C']) {
          for (let trial = 1; trial <= 2; trial++) {
            out.push({
              part: p + 1, operator: op, trial,
              measurement: Number((partTrue[p] + opBias[op] + r()).toFixed(4)),
            });
          }
        }
      }
      return out;
    })(),
  },

  // ───────── ANOVA (compare 4 machines) ─────────
  {
    id: 'anova_machine_compare',
    name: 'Machine throughput comparison (ANOVA)',
    blurb: 'Throughput from four parallel machines. One machine is clearly underperforming. ANOVA + Tukey HSD will isolate it.',
    suggested_analysis: 'hypothesis_test',
    rows: (() => {
      const out = [];
      const machines = {
        M1: [102, 99, 101, 100, 103, 98, 101, 102, 100, 99, 101, 100],
        M2: [101, 102, 100, 103, 101, 99, 100, 102, 101, 100, 102, 101],
        M3: [89, 91, 90, 88, 92, 87, 90, 89, 91, 88, 90, 91],   // the offender
        M4: [100, 102, 99, 101, 100, 102, 99, 101, 100, 99, 102, 101],
      };
      for (const [m, vals] of Object.entries(machines))
        for (const v of vals) out.push({ machine: m, units_per_hour: v });
      return out;
    })(),
  },

  // ───────── Pareto (defect Pareto) ─────────
  {
    id: 'pareto_defects',
    name: 'Defect Pareto (assembly line)',
    blurb: 'A week of recorded defects from an assembly line. Two defect types account for ~80% — classic Pareto / vital few.',
    suggested_analysis: 'pareto',
    rows: (() => {
      const counts = { Scratch: 47, Misalignment: 32, 'Missing screw': 12, Discoloration: 6, Crack: 3 };
      const out = [];
      let id = 1;
      for (const [type, n] of Object.entries(counts))
        for (let i = 0; i < n; i++) out.push({ defect_id: id++, defect_type: type });
      return out;
    })(),
  },

  // ───────── Reliability (Weibull β > 1, wear-out) ─────────
  {
    id: 'reliability_weibull',
    name: 'Time-to-failure (Weibull, wear-out)',
    blurb: 'Time-to-failure (hours) for a sample of 30 components. Weibull β > 1 → wear-out — plan preventive replacement before B10 life.',
    suggested_analysis: 'reliability',
    rows: [
      { unit: 1,  hours_to_failure: 412 }, { unit: 2,  hours_to_failure: 538 },
      { unit: 3,  hours_to_failure: 489 }, { unit: 4,  hours_to_failure: 612 },
      { unit: 5,  hours_to_failure: 387 }, { unit: 6,  hours_to_failure: 720 },
      { unit: 7,  hours_to_failure: 502 }, { unit: 8,  hours_to_failure: 458 },
      { unit: 9,  hours_to_failure: 594 }, { unit: 10, hours_to_failure: 367 },
      { unit: 11, hours_to_failure: 681 }, { unit: 12, hours_to_failure: 425 },
      { unit: 13, hours_to_failure: 543 }, { unit: 14, hours_to_failure: 478 },
      { unit: 15, hours_to_failure: 619 }, { unit: 16, hours_to_failure: 395 },
      { unit: 17, hours_to_failure: 551 }, { unit: 18, hours_to_failure: 503 },
      { unit: 19, hours_to_failure: 442 }, { unit: 20, hours_to_failure: 587 },
      { unit: 21, hours_to_failure: 631 }, { unit: 22, hours_to_failure: 372 },
      { unit: 23, hours_to_failure: 559 }, { unit: 24, hours_to_failure: 491 },
      { unit: 25, hours_to_failure: 625 }, { unit: 26, hours_to_failure: 416 },
      { unit: 27, hours_to_failure: 528 }, { unit: 28, hours_to_failure: 472 },
      { unit: 29, hours_to_failure: 645 }, { unit: 30, hours_to_failure: 403 },
    ],
  },

  // ───────── Control chart (I-MR, with a deliberate shift) ─────────
  {
    id: 'control_chart_imr',
    name: 'I-MR chart (process shift)',
    blurb: 'Sequence of individual measurements with a clear upward shift halfway through. Western Electric rules should flag it.',
    suggested_analysis: 'control_chart',
    rows: (() => {
      const out = [];
      let seed = 7;
      const r = () => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280 - 0.5) * 1.2; };
      for (let i = 1; i <= 40; i++) {
        const center = i <= 20 ? 50 : 53;  // shift at obs 21
        out.push({ obs: i, measurement: Number((center + r()).toFixed(2)) });
      }
      return out;
    })(),
  },

  // ───────── Survival (Kaplan-Meier + log-rank) ─────────
  {
    id: 'survival_two_arms',
    name: 'Survival (two treatments)',
    blurb: 'Time-to-event data for two treatment arms with light censoring. KM curves separate; log-rank should flag the difference.',
    suggested_analysis: 'survival',
    rows: (() => {
      // Deterministic LCG so the sample is reproducible.
      let seed = 11;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      // Arm A: median ≈ 30; Arm B: median ≈ 60.
      for (let i = 0; i < 50; i++) {
        const t = -30 * Math.log(1 - rnd());          // exponential, mean 30
        const e = rnd() > 0.10 ? 1 : 0;               // 10 % censored
        out.push({ id: `A${i}`, arm: 'A',
                   time_days: Number(t.toFixed(1)), event: e });
      }
      for (let i = 0; i < 50; i++) {
        const t = -60 * Math.log(1 - rnd());
        const e = rnd() > 0.15 ? 1 : 0;
        out.push({ id: `B${i}`, arm: 'B',
                   time_days: Number(t.toFixed(1)), event: e });
      }
      return out;
    })(),
  },

  // ───────── Linear mixed-effects (repeated measures) ─────────
  {
    id: 'lmm_repeated_dose',
    name: 'Repeated-measures dose study (LMM)',
    blurb: '20 subjects each measured at 5 doses. Linear dose effect + subject-to-subject intercept variability — the canonical case for a random-intercept LMM.',
    suggested_analysis: 'mixed_effects',
    rows: (() => {
      let seed = 23;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      for (let s = 0; s < 20; s++) {
        const subj_offset = (rnd() - 0.5) * 6;       // ±3 between-subject
        for (let d = 0; d < 5; d++) {
          out.push({
            subject: `S${s}`,
            dose: d,
            response: Number((10 + 1.5 * d + subj_offset + (rnd() - 0.5) * 1.5).toFixed(2)),
          });
        }
      }
      return out;
    })(),
  },

  // ───────── Mixture-design ternary (3 components → 1 response) ─────────
  {
    id: 'mixture_ternary',
    name: 'Mixture experiment (3 components)',
    blurb: 'Simplex-centroid design for a 3-component formulation. Response peaks at a specific binary blend — perfect for the ternary contour.',
    suggested_analysis: 'ternary',
    rows: [
      { run:  1, A: 1.00, B: 0.00, C: 0.00, viscosity: 12 },
      { run:  2, A: 0.00, B: 1.00, C: 0.00, viscosity: 22 },
      { run:  3, A: 0.00, B: 0.00, C: 1.00, viscosity: 15 },
      { run:  4, A: 0.50, B: 0.50, C: 0.00, viscosity: 24 },
      { run:  5, A: 0.50, B: 0.00, C: 0.50, viscosity: 17 },
      { run:  6, A: 0.00, B: 0.50, C: 0.50, viscosity: 23 },
      { run:  7, A: 0.33, B: 0.33, C: 0.34, viscosity: 20 },
      { run:  8, A: 0.67, B: 0.17, C: 0.16, viscosity: 16 },
      { run:  9, A: 0.17, B: 0.67, C: 0.16, viscosity: 25 },
      { run: 10, A: 0.17, B: 0.16, C: 0.67, viscosity: 18 },
    ],
  },

  // ───────── Cost-weighted Pareto (frequency leader ≠ cost leader) ─────────
  {
    id: 'cost_pareto_defects',
    name: 'Cost-weighted defects (the Pareto trap)',
    blurb: 'Defect log where the most-frequent defect is NOT the most expensive. The classic case the cost-weighted Pareto exists to flag.',
    suggested_analysis: 'cost_pareto',
    rows: [
      ...Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, defect: 'scratch', unit_cost: 1.0 })),
      ...Array.from({ length: 5 },  (_, i) => ({ id: `l${i}`, defect: 'leak',    unit_cost: 250.0 })),
      ...Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, defect: 'misalign', unit_cost: 25.0 })),
      ...Array.from({ length: 8 },  (_, i) => ({ id: `d${i}`, defect: 'dent',    unit_cost: 8.0 })),
      ...Array.from({ length: 25 }, (_, i) => ({ id: `o${i}`, defect: 'other',   unit_cost: 3.5 })),
    ],
  },

  // ───────── Gage Linearity & Bias (bias varies by reference) ─────────
  {
    id: 'gage_linearity_bias',
    name: 'Gage Linearity & Bias study',
    blurb: '5 reference parts spanning the operating range × 12 repeats each, with a small bias that grows with reference value. Should flag significant linearity.',
    suggested_analysis: 'gage_linearity',
    rows: (() => {
      let seed = 37;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      let row = 0;
      for (const ref of [2, 5, 10, 15, 20]) {
        for (let trial = 0; trial < 12; trial++) {
          // Bias = 0.03 · reference (grows with value)
          const meas = ref + 0.03 * ref + (rnd() - 0.5) * 0.2;
          out.push({ row: ++row, part: `P${ref}`, reference: ref,
                     measurement: Number(meas.toFixed(3)) });
        }
      }
      return out;
    })(),
  },

  // ───────── Attribute Agreement (3 appraisers × 20 parts × 2 trials) ─────────
  {
    id: 'attribute_agreement_kappa',
    name: 'Attribute Agreement (Pass/Fail)',
    blurb: '3 inspectors classify 20 parts twice each, with a known standard. Substantial — but not perfect — agreement; great for showing the kappa interpretation.',
    suggested_analysis: 'agreement',
    rows: (() => {
      let seed = 53;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      const truth = Array.from({ length: 20 }, () => (rnd() > 0.4 ? 'P' : 'F'));
      let row = 0;
      for (const app of ['A', 'B', 'C']) {
        const acc = app === 'A' ? 0.95 : app === 'B' ? 0.85 : 0.80;
        for (let p = 0; p < 20; p++) {
          for (let trial = 1; trial <= 2; trial++) {
            const correct = rnd() < acc;
            const rating = correct ? truth[p] : (truth[p] === 'P' ? 'F' : 'P');
            out.push({ row: ++row, appraiser: app, part: `P${p}`,
                       trial, rating, standard: truth[p] });
          }
        }
      }
      return out;
    })(),
  },

  // ───────── Correlation matrix (multiple numeric vars, with collinearity) ─────────
  {
    id: 'correlation_multi_kpi',
    name: 'Multi-KPI correlation matrix',
    blurb: 'Five process variables — two are deliberately collinear (|r| > 0.9). Designed to show how the correlation analysis flags multicollinearity before regression.',
    suggested_analysis: 'correlation',
    rows: (() => {
      let seed = 71;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => {
        // Box-Muller
        const u1 = Math.max(1e-9, rnd()), u2 = rnd();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      };
      const out = [];
      for (let i = 0; i < 80; i++) {
        const temp = 70 + 5 * norm();
        const pressure = 100 + 8 * norm();
        const flow = 0.85 * temp + 5 * norm();          // collinear with temp
        const speed = 30 + 4 * norm();
        const yieldPct = 80 + 0.3 * temp - 0.5 * pressure + 0.2 * speed + 2 * norm();
        out.push({ run: i + 1,
                   temperature: Number(temp.toFixed(2)),
                   pressure:    Number(pressure.toFixed(2)),
                   flow:        Number(flow.toFixed(2)),
                   speed:       Number(speed.toFixed(2)),
                   yield_pct:   Number(yieldPct.toFixed(2)) });
      }
      return out;
    })(),
  },

  // ───────── Regression (multiple predictors → response) ─────────
  {
    id: 'regression_yield_drivers',
    name: 'Process yield drivers (regression)',
    blurb: 'Yield vs three controllable inputs (temperature, pressure, catalyst). Temperature and catalyst are real drivers; pressure is mostly noise — a clean multiple-regression teaching case.',
    suggested_analysis: 'regression',
    rows: (() => {
      let seed = 91;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const out = [];
      for (let i = 0; i < 50; i++) {
        const temperature = 60 + 20 * rnd();
        const pressure = 90 + 20 * rnd();
        const catalyst = 0.5 + 2.5 * rnd();
        const yield_pct = 40 + 0.4 * temperature + 6 * catalyst + 0.02 * pressure + 2.5 * norm();
        out.push({ run: i + 1,
          temperature: Number(temperature.toFixed(2)),
          pressure: Number(pressure.toFixed(2)),
          catalyst_pct: Number(catalyst.toFixed(2)),
          yield_pct: Number(yield_pct.toFixed(2)) });
      }
      return out;
    })(),
  },

  // ───────── DOE (2^3 full factorial, replicated) ─────────
  {
    id: 'doe_factorial_2k',
    name: 'Full factorial DOE (2³, replicated)',
    blurb: 'Three factors at ±1 (temp, time, concentration), each combination run twice. A and C have real main effects with an AC interaction — ideal for a factorial analysis.',
    suggested_analysis: 'doe',
    rows: (() => {
      let seed = 13;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      let run = 0;
      for (const A of [-1, 1]) for (const B of [-1, 1]) for (const C of [-1, 1])
        for (let rep = 1; rep <= 2; rep++) {
          const resp = 50 + 6 * A + 1 * B + 4 * C + 3 * A * C + (rnd() - 0.5) * 2;
          out.push({ run: ++run, temp: A, time: B, concentration: C,
            replicate: rep, strength: Number(resp.toFixed(2)) });
        }
      return out;
    })(),
  },

  // ───────── Desirability (multi-response optimization) ─────────
  {
    id: 'desirability_multi_response',
    name: 'Multi-response optimization (desirability)',
    blurb: 'A DOE with two competing responses — maximize yield while minimizing cost. The desirability optimizer finds the settings that best satisfy both.',
    suggested_analysis: 'desirability',
    rows: (() => {
      let seed = 29;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      let run = 0;
      for (const A of [-1, 0, 1]) for (const B of [-1, 0, 1]) {
        const yield_pct = 70 + 8 * A + 4 * B - 2 * A * A + (rnd() - 0.5);
        const cost = 30 + 5 * A - 3 * B + 2 * B * B + (rnd() - 0.5);
        out.push({ run: ++run, factor_a: A, factor_b: B,
          yield_pct: Number(yield_pct.toFixed(2)), cost_per_unit: Number(cost.toFixed(2)) });
      }
      return out;
    })(),
  },

  // ───────── Multivariate (PCA / clustering, 4 features + group) ─────────
  {
    id: 'multivariate_features',
    name: 'Multivariate measurements (PCA / clustering)',
    blurb: 'Four correlated measurements across three latent product grades. PCA collapses them to ~2 components; clustering recovers the grades.',
    suggested_analysis: 'multivariate',
    rows: (() => {
      let seed = 41;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const centers = { low: [10, 5, 2, 50], mid: [14, 7, 3, 60], high: [18, 9, 4, 72] };
      const out = [];
      let id = 0;
      for (const [grade, c] of Object.entries(centers))
        for (let i = 0; i < 15; i++) {
          out.push({ id: ++id, grade,
            length: Number((c[0] + norm()).toFixed(2)),
            width: Number((c[1] + 0.6 * norm()).toFixed(2)),
            depth: Number((c[2] + 0.4 * norm()).toFixed(2)),
            weight: Number((c[3] + 2 * norm()).toFixed(2)) });
        }
      return out;
    })(),
  },

  // ───────── Time series (trend + seasonality, monthly) ─────────
  {
    id: 'time_series_monthly_demand',
    name: 'Monthly demand (trend + seasonality)',
    blurb: '48 months of demand with an upward trend and a 12-month seasonal cycle — a clean case for decomposition and ARIMA forecasting.',
    suggested_analysis: 'time_series',
    rows: (() => {
      let seed = 59;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      for (let m = 0; m < 48; m++) {
        const trend = 200 + 3 * m;
        const season = 25 * Math.sin((2 * Math.PI * m) / 12);
        const demand = trend + season + (rnd() - 0.5) * 12;
        out.push({ period: m + 1, month: (m % 12) + 1, demand: Number(demand.toFixed(1)) });
      }
      return out;
    })(),
  },

  // ───────── Survey / Likert (Cronbach's alpha) ─────────
  {
    id: 'survey_likert_scale',
    name: 'Customer survey (Likert, 5 items)',
    blurb: '40 respondents answer five 1–5 Likert items on one construct. Internally consistent (α ≈ 0.8) with one weaker item — perfect for Cronbach’s alpha + alpha-if-deleted.',
    suggested_analysis: 'survey',
    rows: (() => {
      let seed = 67;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));
      const out = [];
      for (let i = 0; i < 40; i++) {
        const latent = 1 + 4 * rnd();          // respondent's true satisfaction
        out.push({ respondent: i + 1,
          Q1_quality:   clamp(latent + (rnd() - 0.5)),
          Q2_value:     clamp(latent + (rnd() - 0.5)),
          Q3_support:   clamp(latent + (rnd() - 0.5)),
          Q4_speed:     clamp(latent + (rnd() - 0.5) * 1.4),
          Q5_recommend: clamp(latent + (rnd() - 0.5) * 2.2) });  // weaker item
      }
      return out;
    })(),
  },

  // ───────── Text auto-Pareto (VOC free text) ─────────
  {
    id: 'voc_comments',
    name: 'Voice-of-customer comments (text Pareto)',
    blurb: '75 free-text complaint comments. The deterministic text-Pareto extracts themes (shipping, billing, quality…) and ranks the vital few — no AI.',
    suggested_analysis: 'text_pareto',
    rows: (() => {
      const templates = {
        'shipping delay': ['Package arrived three days late', 'Shipping took way too long', 'My order was delayed again', 'Late delivery, missed the deadline', 'Slow shipping, very frustrating'],
        'billing error':  ['I was charged twice for one order', 'The invoice amount is wrong', 'Billing overcharged my card', 'Wrong price on my receipt', 'Double billed this month'],
        'product quality':['The item broke after one use', 'Poor build quality', 'Product arrived damaged', 'Cheap materials, fell apart', 'Defective unit out of the box'],
        'support':        ['Support never replied to my email', 'Long hold time on the phone', 'Customer service was unhelpful', 'Could not reach anyone for help'],
        'packaging':      ['Box was crushed on arrival', 'Packaging was inadequate'],
      };
      const out = [];
      let id = 0;
      const reps = { 'shipping delay': 5, 'billing error': 4, 'product quality': 4, 'support': 2, 'packaging': 1 };
      for (const [theme, n] of Object.entries(reps)) {
        const list = templates[theme];
        for (let r = 0; r < n; r++)
          for (const c of list) out.push({ ticket: ++id, comment: c });
      }
      return out;
    })(),
  },

  // ───────── Variance budget (variation decomposition by source) ─────────
  {
    id: 'variance_budget_sources',
    name: 'Variation by source (variance budget)',
    blurb: 'A measured output crossed with three named sources — machine, operator, and material lot. The variance budget attributes total variation to each as a stacked bar.',
    suggested_analysis: 'variance_budget',
    rows: (() => {
      let seed = 83;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const machineEff = { M1: 0.0, M2: 1.8 };
      const opEff = { Ann: 0.0, Ben: 0.6, Cara: -0.4 };
      const lotEff = { L1: 0.0, L2: 1.1, L3: -0.7 };
      const out = [];
      let row = 0;
      for (const m of Object.keys(machineEff))
        for (const op of Object.keys(opEff))
          for (const lot of Object.keys(lotEff))
            for (let rep = 0; rep < 2; rep++) {
              const y = 50 + machineEff[m] + opEff[op] + lotEff[lot] + (rnd() - 0.5) * 1.2;
              out.push({ row: ++row, machine: m, operator: op, material_lot: lot,
                output: Number(y.toFixed(3)) });
            }
      return out;
    })(),
  },

  // ───────── Cycle time (transactional durations) ─────────
  {
    id: 'cycle_time_tickets',
    name: 'Ticket cycle times (flow)',
    blurb: 'Resolution time (hours) for 60 support tickets — right-skewed, as service times usually are. Use for cycle-time distribution, percentiles, and stability.',
    suggested_analysis: 'cycle_time',
    rows: (() => {
      let seed = 97;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      for (let i = 0; i < 60; i++) {
        const hours = -8 * Math.log(1 - rnd());       // exponential, mean 8h (skewed)
        out.push({ ticket: i + 1, priority: rnd() > 0.7 ? 'high' : 'normal',
          cycle_time_hours: Number(hours.toFixed(2)) });
      }
      return out;
    })(),
  },

  // ───────── Delivery forecast (Monte-Carlo throughput) ─────────
  {
    id: 'delivery_throughput',
    name: 'Weekly throughput (delivery forecast)',
    blurb: '26 weeks of items-completed-per-week for an Agile team. Feed it to the Monte-Carlo delivery forecast to answer “when will the backlog be done?”.',
    suggested_analysis: 'delivery_forecast',
    rows: (() => {
      let seed = 103;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      for (let w = 0; w < 26; w++) {
        const done = Math.max(0, Math.round(7 + (rnd() - 0.5) * 8));  // ~7/wk, variable
        out.push({ week: w + 1, items_completed: done });
      }
      return out;
    })(),
  },

  // ───────── Post-hoc (≥3 groups for Tukey/Games-Howell) ─────────
  {
    id: 'posthoc_supplier_compare',
    name: 'Supplier comparison (post-hoc)',
    blurb: 'Tensile strength from four suppliers. ANOVA is significant; the post-hoc isolates which specific supplier pairs differ (controlling family-wise error).',
    suggested_analysis: 'posthoc',
    rows: (() => {
      let seed = 109;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const means = { Acme: 100, Borealis: 101, Cyclon: 92, Delta: 100.5 };
      const out = [];
      for (const [sup, mu] of Object.entries(means))
        for (let i = 0; i < 12; i++)
          out.push({ supplier: sup, tensile_mpa: Number((mu + (rnd() - 0.5) * 5).toFixed(2)) });
      return out;
    })(),
  },

  // ───────── Graph explorer (generic mixed columns) ─────────
  {
    id: 'graph_explorer',
    name: 'Exploratory dataset (graph builder)',
    blurb: 'A small mixed dataset — two numerics, a category, and a date-like index — for trying histograms, scatter, boxplots, and run charts in the Graph Builder.',
    suggested_analysis: 'graph',
    rows: (() => {
      let seed = 127;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      for (let i = 0; i < 40; i++) {
        const x = 10 + 20 * rnd();
        out.push({ index: i + 1,
          region: ['North', 'South', 'East', 'West'][Math.floor(rnd() * 4)],
          input_x: Number(x.toFixed(2)),
          output_y: Number((2 * x + 5 + (rnd() - 0.5) * 8).toFixed(2)) });
      }
      return out;
    })(),
  },

  // ───────── ANOM (analysis of means) ─────────
  {
    id: 'anom_lines',
    name: 'Line means vs grand mean (ANOM)',
    blurb: 'Output from five production lines. ANOM shows which line means fall outside the decision limits around the overall mean — a graphical alternative to ANOVA.',
    suggested_analysis: 'anom',
    rows: (() => {
      let seed = 131;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const means = { L1: 50, L2: 50.5, L3: 53.5, L4: 49.8, L5: 50.2 };  // L3 stands out
      const out = [];
      for (const [line, mu] of Object.entries(means))
        for (let i = 0; i < 10; i++)
          out.push({ line, output: Number((mu + (rnd() - 0.5) * 2.5).toFixed(2)) });
      return out;
    })(),
  },

  // ───────── Bootstrap CI (single skewed column) ─────────
  {
    id: 'bootstrap_mean_ci',
    name: 'Skewed sample (bootstrap CI)',
    blurb: 'A right-skewed sample of 45 values where a normal CI on the mean is questionable — the bootstrap gives a distribution-free confidence interval.',
    suggested_analysis: 'bootstrap',
    rows: (() => {
      let seed = 137;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      for (let i = 0; i < 45; i++)
        out.push({ id: i + 1, value: Number((-12 * Math.log(1 - rnd())).toFixed(2)) });
      return out;
    })(),
  },

  // ───────── Bootstrap effect size (two groups) ─────────
  {
    id: 'bootstrap_effect_two_groups',
    name: 'Before vs after (bootstrap effect size)',
    blurb: 'Two groups (before/after a change) with a moderate shift. Bootstraps a confidence interval for the effect size (Cohen’s d), not just a p-value.',
    suggested_analysis: 'bootstrap_effect',
    rows: (() => {
      let seed = 149;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const out = [];
      for (let i = 0; i < 30; i++) out.push({ phase: 'before', score: Number((100 + 8 * norm()).toFixed(2)) });
      for (let i = 0; i < 30; i++) out.push({ phase: 'after',  score: Number((106 + 8 * norm()).toFixed(2)) });
      return out;
    })(),
  },

  // ───────── Variability gauge (multi-vari: part × operator × trial) ─────────
  {
    id: 'variability_gauge_multivari',
    name: 'Multi-vari study (variability gauge)',
    blurb: '6 parts × 3 operators × 3 trials. The variability/multi-vari chart breaks total variation down by part, operator, and within-trial repeatability.',
    suggested_analysis: 'variability_gauge',
    rows: (() => {
      let seed = 151;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const partTrue = [9.9, 10.1, 10.0, 9.95, 10.08, 9.92];
      const opBias = { A: 0.0, B: 0.05, C: -0.03 };
      const out = [];
      let row = 0;
      for (let p = 0; p < 6; p++)
        for (const op of ['A', 'B', 'C'])
          for (let trial = 1; trial <= 3; trial++)
            out.push({ row: ++row, part: p + 1, operator: op, trial,
              measurement: Number((partTrue[p] + opBias[op] + (rnd() - 0.5) * 0.05).toFixed(4)) });
      return out;
    })(),
  },

  // ───────── Bayesian (binary outcomes by variant) ─────────
  {
    id: 'bayesian_conversion',
    name: 'A/B conversions (Bayesian)',
    blurb: 'Binary conversion outcomes for two variants (A vs B), B slightly better. Bayesian estimation gives the posterior probability that B beats A.',
    suggested_analysis: 'bayesian',
    rows: (() => {
      let seed = 157;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      let id = 0;
      for (let i = 0; i < 120; i++) out.push({ id: ++id, variant: 'A', converted: rnd() < 0.18 ? 1 : 0 });
      for (let i = 0; i < 120; i++) out.push({ id: ++id, variant: 'B', converted: rnd() < 0.25 ? 1 : 0 });
      return out;
    })(),
  },

  // ───────── Distribution identification (right-skewed) ─────────
  {
    id: 'distribution_id_skewed',
    name: 'Non-normal measurements (distribution ID)',
    blurb: 'A clearly right-skewed sample (lognormal-ish). Distribution identification should reject normal and favour lognormal/Weibull — the right model for later capability work.',
    suggested_analysis: 'distribution_id',
    rows: (() => {
      let seed = 163;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const out = [];
      for (let i = 0; i < 60; i++)
        out.push({ id: i + 1, measurement: Number(Math.exp(1.6 + 0.45 * norm()).toFixed(3)) });
      return out;
    })(),
  },

  // ───────── Tolerance interval (continuous) ─────────
  {
    id: 'tolerance_fill_volume',
    name: 'Fill volume (tolerance interval)',
    blurb: 'Bottle fill volumes (mL) for 50 units. Build a tolerance interval that contains, say, 99% of the population with 95% confidence — distinct from a CI on the mean.',
    suggested_analysis: 'tolerance',
    rows: (() => {
      let seed = 167;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const out = [];
      for (let i = 0; i < 50; i++)
        out.push({ unit: i + 1, fill_ml: Number((500 + 2.5 * norm()).toFixed(2)) });
      return out;
    })(),
  },

  // ───────── Capability six-pack (subgrouped continuous) ─────────
  {
    id: 'sixpack_subgroups',
    name: 'Subgrouped process (capability six-pack)',
    blurb: '25 subgroups of 5 measurements. Drives the full capability six-pack — control charts, capability histogram, normal plot, and indices at once. LSL=46, USL=54.',
    suggested_analysis: 'sixpack',
    rows: (() => {
      let seed = 173;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const out = [];
      let row = 0;
      for (let sg = 1; sg <= 25; sg++)
        for (let i = 0; i < 5; i++)
          out.push({ row: ++row, subgroup: sg, measurement: Number((50 + 1.3 * norm()).toFixed(3)) });
      return out;
    })(),
  },

  // ───────── Predictive Cpk (time-ordered with drift) ─────────
  {
    id: 'predictive_cpk_drift',
    name: 'Drifting process (predictive Cpk)',
    blurb: 'A capability measurement that slowly drifts upward over 60 ordered observations. Predictive Cpk projects where capability is heading, not just where it is. LSL=46, USL=54.',
    suggested_analysis: 'predictive_cpk',
    rows: (() => {
      let seed = 179;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const norm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const out = [];
      for (let i = 0; i < 60; i++)
        out.push({ obs: i + 1, measurement: Number((49.5 + 0.03 * i + 1.0 * norm()).toFixed(3)) });
      return out;
    })(),
  },

  // ───────── Attribute capability (pass/fail by lot) ─────────
  {
    id: 'attribute_capability_defectives',
    name: 'Inspection lots (attribute capability)',
    blurb: '25 inspection lots of 100 units each with the number of defectives. Estimates defect rate, DPMO, and process sigma level for pass/fail data.',
    suggested_analysis: 'attribute_capability',
    rows: (() => {
      let seed = 181;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const out = [];
      for (let lot = 1; lot <= 25; lot++) {
        const n = 100;
        let defectives = 0;
        for (let u = 0; u < n; u++) if (rnd() < 0.03) defectives++;   // ~3% defective
        out.push({ lot, sample_size: n, defectives });
      }
      return out;
    })(),
  },
];
