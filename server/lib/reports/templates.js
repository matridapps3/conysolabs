// Conyso Bench — LSS report templates.
//
// Each template is data: a list of sections, each with a kind that drives
// both the editor UI and the renderer.
//
// Section kinds:
//   kv         — list of labeled fields rendered as a 2-column table
//   longtext   — single multi-line text block (supports basic markdown)
//   table      — fixed-column grid; rows are user-editable
//   chart      — embeds the chart from a linked analysis
//   metrics    — pulls a metric strip from a linked analysis summary
//   summary    — pulls plain-English interpretation from a linked analysis
//   signoff    — block of name/title/date approval rows
//   analyses_list — auto-renders every linked analysis with chart + metrics
//
// Field kinds: text, longtext, number, currency, percent, date, select.
//
// Each template optionally exposes defaults(project, analyses, opts) →
// returns a {title, subtitle, data, analyses} skeleton used when the user
// creates a fresh report.

export const TEMPLATES = [
  // ───────────────────────── Project Charter ─────────────────────────
  {
    id: 'charter',
    name: 'Project Charter',
    blurb: 'Define-phase foundation: problem, goal, scope, team, financial benefit.',
    phase: 'define',
    icon: 'recipes',
    sections: [
      { id: 'header', kind: 'kv', label: 'Project header', fields: [
        { name: 'project_name', label: 'Project name', kind: 'text' },
        { name: 'project_id',   label: 'Project ID',   kind: 'text' },
        { name: 'sponsor',      label: 'Executive sponsor', kind: 'text' },
        { name: 'champion',     label: 'Champion', kind: 'text' },
        { name: 'belt',         label: 'Black/Green Belt', kind: 'text' },
        { name: 'start_date',   label: 'Start date', kind: 'date' },
        { name: 'target_close', label: 'Target close', kind: 'date' },
      ]},
      { id: 'problem',  kind: 'longtext', label: 'Problem statement',
        hint: 'What is wrong, where, when, how big, who is affected. No causes, no solutions.' },
      { id: 'goal',     kind: 'longtext', label: 'Goal statement (SMART)',
        hint: 'Specific · Measurable · Achievable · Relevant · Time-bound. e.g. "Reduce X from Y to Z by [date]."' },
      { id: 'business_case', kind: 'longtext', label: 'Business case',
        hint: 'Why now? What happens if we do nothing? Strategic linkage.' },
      { id: 'scope', kind: 'kv', label: 'Scope', fields: [
        { name: 'in_scope',  label: 'In scope',     kind: 'longtext' },
        { name: 'out_scope', label: 'Out of scope', kind: 'longtext' },
        { name: 'process_start', label: 'Process starts at', kind: 'text' },
        { name: 'process_end',   label: 'Process ends at',   kind: 'text' },
      ]},
      { id: 'team', kind: 'table', label: 'Team',
        columns: ['Name', 'Role', 'Allocation %'], rows: 4 },
      { id: 'timeline', kind: 'table', label: 'DMAIC timeline',
        columns: ['Phase', 'Start', 'Tollgate date', 'Status'],
        defaultRows: [
          ['Define',   '', '', ''],
          ['Measure',  '', '', ''],
          ['Analyze',  '', '', ''],
          ['Improve',  '', '', ''],
          ['Control',  '', '', ''],
        ]},
      { id: 'benefit', kind: 'kv', label: 'Financial benefit (annualized)', fields: [
        { name: 'hard_benefit', label: 'Hard savings $/yr', kind: 'currency' },
        { name: 'soft_benefit', label: 'Soft savings $/yr', kind: 'currency' },
        { name: 'investment',   label: 'One-time investment', kind: 'currency' },
        { name: 'payback',      label: 'Payback period (months)', kind: 'number' },
      ]},
      { id: 'risks', kind: 'table', label: 'Risks & assumptions',
        columns: ['Risk', 'Likelihood (L/M/H)', 'Impact (L/M/H)', 'Mitigation'], rows: 3 },
      { id: 'signoff', kind: 'signoff', label: 'Approvals',
        roles: ['Sponsor', 'Champion', 'Belt'] },
    ],
    defaults: ({ project }) => ({
      title: 'Project Charter',
      subtitle: project?.name || '',
      data: {
        header: {
          project_name: project?.name || '',
          start_date: project?.created_at ? new Date(project.created_at * 1000).toISOString().slice(0, 10) : '',
        },
      },
    }),
  },

  // ───────────────────────── SIPOC ─────────────────────────
  {
    id: 'sipoc',
    name: 'SIPOC',
    blurb: 'Suppliers · Inputs · Process · Outputs · Customers. Process scoping in one page.',
    phase: 'define',
    icon: 'doe',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Process', fields: [
        { name: 'process_name', label: 'Process name', kind: 'text' },
        { name: 'owner',        label: 'Process owner', kind: 'text' },
        { name: 'date',         label: 'Date', kind: 'date' },
      ]},
      { id: 'process_steps', kind: 'table', label: 'Process (high-level steps)',
        columns: ['#', 'Step'], rows: 6 },
      { id: 'suppliers', kind: 'table', label: 'Suppliers',     columns: ['Supplier'], rows: 5 },
      { id: 'inputs',    kind: 'table', label: 'Inputs',        columns: ['Input', 'Requirement (CTQ)'], rows: 5 },
      { id: 'outputs',   kind: 'table', label: 'Outputs',       columns: ['Output', 'Requirement (CTQ)'], rows: 5 },
      { id: 'customers', kind: 'table', label: 'Customers',     columns: ['Customer', 'Voice of Customer'], rows: 5 },
    ],
    defaults: ({ project }) => ({
      title: 'SIPOC',
      subtitle: project?.name || '',
      data: {},
    }),
  },

  // ───────────────────────── A3 Report ─────────────────────────
  {
    id: 'a3',
    name: 'A3 Report',
    blurb: 'Toyota one-page problem-solving format. Background → root cause → countermeasure → follow-up.',
    phase: 'all',
    icon: 'recipes',
    sections: [
      { id: 'header', kind: 'kv', label: 'A3 header', fields: [
        { name: 'theme', label: 'Theme / title', kind: 'text' },
        { name: 'owner', label: 'Owner', kind: 'text' },
        { name: 'date',  label: 'Date',  kind: 'date' },
      ]},
      { id: 'background',    kind: 'longtext', label: '1 · Background',
        hint: 'Why is this problem worth solving? Strategic context, customer impact.' },
      { id: 'current_state', kind: 'longtext', label: '2 · Current state',
        hint: 'What is happening now? Numbers, baseline metric, gap from standard.' },
      { id: 'target_state',  kind: 'longtext', label: '3 · Target state',
        hint: 'Where do we want to be? Quantified, time-bound goal.' },
      { id: 'root_cause',    kind: 'longtext', label: '4 · Root-cause analysis',
        hint: '5 Whys, fishbone, or hypothesis-test results. Anchor to data.' },
      { id: 'countermeasures', kind: 'table', label: '5 · Countermeasures',
        columns: ['Action', 'Owner', 'Due', 'Status'], rows: 5 },
      { id: 'implementation_plan', kind: 'longtext', label: '6 · Implementation plan',
        hint: 'Sequence, dependencies, pilot, rollout.' },
      { id: 'follow_up', kind: 'table', label: '7 · Follow-up',
        columns: ['Check date', 'Metric', 'Target', 'Actual', 'Action'], rows: 3 },
    ],
    defaults: ({ project }) => ({
      title: 'A3 Report',
      subtitle: project?.name || '',
      data: { header: { date: new Date().toISOString().slice(0, 10) } },
    }),
  },

  // ───────────────────────── FMEA ─────────────────────────
  {
    id: 'fmea',
    name: 'FMEA',
    blurb: 'Failure Mode & Effects Analysis. RPN = Severity × Occurrence × Detection.',
    phase: 'analyze',
    icon: 'reliability',
    sections: [
      { id: 'meta', kind: 'kv', label: 'FMEA header', fields: [
        { name: 'kind',         label: 'FMEA kind', kind: 'select',
          options: ['Design', 'Process', 'System', 'Service'] },
        { name: 'process_name', label: 'Process / item', kind: 'text' },
        { name: 'team',         label: 'Team', kind: 'text' },
        { name: 'fmea_date',    label: 'Date',  kind: 'date' },
        { name: 'revision',     label: 'Revision', kind: 'text' },
      ]},
      { id: 'scale_legend', kind: 'longtext', label: 'Rating scale (1–10)',
        hint: 'Default AIAG scale. S = Severity (impact), O = Occurrence (frequency), D = Detection (ease of catching before harm). RPN = S × O × D. Investigate RPN ≥ 100 or any S ≥ 9.' },
      { id: 'fmea_table', kind: 'table', label: 'Failure modes',
        columns: ['Function/Step', 'Failure Mode', 'Effect', 'S', 'Cause', 'O', 'Current Control', 'D', 'RPN', 'Recommended Action', 'Owner'],
        rpnCols: { s: 3, o: 5, d: 7, rpn: 8 },
        rows: 8 },
      { id: 'action_plan', kind: 'longtext', label: 'Action plan',
        hint: 'Prioritized list of countermeasures for the highest-RPN rows. Re-rate after action.' },
    ],
    defaults: ({ project }) => ({
      title: 'FMEA',
      subtitle: project?.name || '',
      data: { meta: { kind: 'Process', fmea_date: new Date().toISOString().slice(0, 10) } },
    }),
  },

  // ───────────────────────── Control Plan ─────────────────────────
  {
    id: 'control_plan',
    name: 'Control Plan',
    blurb: 'AIAG-style control plan: per-CTQ spec, MSA, sample size, reaction plan.',
    phase: 'control',
    icon: 'control',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Control plan header', fields: [
        { name: 'part_name',    label: 'Part / process name', kind: 'text' },
        { name: 'part_number',  label: 'Part / process number', kind: 'text' },
        { name: 'owner',        label: 'Owner', kind: 'text' },
        { name: 'phase',        label: 'Phase',
          kind: 'select', options: ['Prototype', 'Pre-launch', 'Production'] },
        { name: 'effective_date', label: 'Effective date', kind: 'date' },
        { name: 'revision',     label: 'Revision', kind: 'text' },
      ]},
      { id: 'table', kind: 'table', label: 'Critical-to-quality controls',
        columns: ['Step', 'CTQ Characteristic', 'Spec / Tolerance', 'Method (gauge / inspection)', 'MSA Status', 'Sample Size', 'Frequency', 'Control Method (chart/check)', 'Reaction Plan', 'Owner'],
        rows: 8 },
      { id: 'reaction_legend', kind: 'longtext', label: 'Reaction-plan key',
        hint: 'Define standard reactions (e.g. A = stop and contain, B = flag and investigate, C = re-train) so the table can stay short.' },
      { id: 'signoff', kind: 'signoff', label: 'Approvals',
        roles: ['Process Owner', 'Quality', 'Engineering'] },
    ],
    defaults: ({ project }) => ({
      title: 'Control Plan',
      subtitle: project?.name || '',
      data: { meta: { effective_date: new Date().toISOString().slice(0, 10), phase: 'Production' } },
    }),
  },

  // ───────────────────────── 8D Report ─────────────────────────
  {
    id: 'eight_d',
    name: '8D Report',
    blurb: 'Eight Disciplines problem-solving — automotive / customer-complaint standard.',
    phase: 'analyze',
    icon: 'other',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Header', fields: [
        { name: 'problem_id', label: 'Problem / complaint ID', kind: 'text' },
        { name: 'customer',   label: 'Customer', kind: 'text' },
        { name: 'opened',     label: 'Date opened', kind: 'date' },
        { name: 'leader',     label: '8D leader', kind: 'text' },
      ]},
      { id: 'd1_team',         kind: 'table', label: 'D1 · Team',
        columns: ['Name', 'Role', 'Function'], rows: 4 },
      { id: 'd2_problem',      kind: 'longtext', label: 'D2 · Problem description (5W2H)',
        hint: 'Who · What · When · Where · Why · How · How many.' },
      { id: 'd3_containment',  kind: 'longtext', label: 'D3 · Containment (interim action)',
        hint: 'Protect the customer NOW. Sort, hold, 100% inspect, etc.' },
      { id: 'd4_root_cause',   kind: 'longtext', label: 'D4 · Root cause(s)',
        hint: 'Verified — not suspected. Anchor to data (Pareto, hypothesis test).' },
      { id: 'd5_corrective',   kind: 'table', label: 'D5 · Chosen permanent corrective actions',
        columns: ['Action', 'Owner', 'Effectiveness check', 'Due'], rows: 3 },
      { id: 'd6_implemented',  kind: 'longtext', label: 'D6 · Implemented + verified',
        hint: 'Evidence corrective actions are in place and work (re-measure).' },
      { id: 'd7_preventive',   kind: 'longtext', label: 'D7 · Preventive actions (system change)',
        hint: 'Update FMEA, control plan, training, standard work, procedures.' },
      { id: 'd8_close',        kind: 'longtext', label: 'D8 · Close + recognize team',
        hint: 'Lessons learned. Recognition.' },
    ],
    defaults: () => ({ title: '8D Report', subtitle: '', data: {} }),
  },

  // ──────────────────── Capability Study Report (auto) ────────────────────
  {
    id: 'capability_report',
    name: 'Capability Study Report',
    blurb: 'Auto-populated from a Capability analysis. Cp/Cpk, histogram, interpretation, action plan.',
    phase: 'measure',
    icon: 'capability',
    requires_analysis: 'capability',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Study header', fields: [
        { name: 'characteristic', label: 'Characteristic / CTQ', kind: 'text' },
        { name: 'process_name',   label: 'Process', kind: 'text' },
        { name: 'study_date',     label: 'Study date', kind: 'date' },
        { name: 'analyst',        label: 'Analyst', kind: 'text' },
      ]},
      { id: 'purpose',  kind: 'longtext', label: 'Purpose of the study',
        hint: 'Why was this study done? Customer complaint, baseline, post-improvement verification.' },
      { id: 'data_summary',  kind: 'longtext', label: 'Data collection',
        hint: 'Sampling plan, period, sample size, measurement system.' },
      { id: 'capability_metrics', kind: 'metrics', label: 'Capability metrics' },
      { id: 'capability_chart',   kind: 'chart',   label: 'Histogram with spec limits' },
      { id: 'capability_interp',  kind: 'summary', label: 'Interpretation' },
      { id: 'normality',       kind: 'longtext', label: 'Normality + transform',
        hint: 'Was a Box-Cox transform needed? AD test result?' },
      { id: 'control_status',  kind: 'longtext', label: 'Process control status',
        hint: 'Is the process in statistical control? Capability is only meaningful if yes.' },
      { id: 'conclusions',     kind: 'longtext', label: 'Conclusions & recommendations',
        hint: 'Capable, marginally capable, not capable. What is the next step?' },
      { id: 'reproducibility', kind: 'hashes', label: 'Reproducibility' },
    ],
    defaults: ({ project, analyses }) => {
      const cap = (analyses || []).find(a => a.kind === 'capability');
      return {
        title: 'Process Capability Study',
        subtitle: project?.name || (cap ? cap.kind : ''),
        data: {
          meta: { study_date: new Date().toISOString().slice(0, 10), characteristic: cap?.params_json?.column || '' },
        },
        analyses: cap ? [cap.id] : [],
      };
    },
  },

  // ──────────────────── Gauge R&R Report (auto) ────────────────────
  {
    id: 'msa_report',
    name: 'Gauge R&R Report',
    blurb: 'AIAG-style MSA write-up. %R&R, ndc, repeatability vs reproducibility.',
    phase: 'measure',
    icon: 'msa',
    requires_analysis: 'msa',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Study header', fields: [
        { name: 'gauge_name',     label: 'Gauge', kind: 'text' },
        { name: 'characteristic', label: 'Characteristic', kind: 'text' },
        { name: 'study_date',     label: 'Study date', kind: 'date' },
        { name: 'parts',          label: '# Parts', kind: 'number' },
        { name: 'operators',      label: '# Operators', kind: 'number' },
        { name: 'trials',         label: '# Trials', kind: 'number' },
        { name: 'design',         label: 'Design', kind: 'select', options: ['Crossed', 'Nested', 'Expanded'] },
      ]},
      { id: 'study_design', kind: 'longtext', label: 'Study design',
        hint: 'Sample selection, randomization, blinding, conditions.' },
      { id: 'msa_metrics', kind: 'metrics', label: 'Variance-component summary' },
      { id: 'msa_chart',   kind: 'chart',   label: 'Components / R chart / X-bar / interaction' },
      { id: 'msa_interp',  kind: 'summary', label: 'Interpretation' },
      { id: 'acceptance',  kind: 'longtext', label: 'Acceptance decision',
        hint: '%R&R < 10% acceptable · 10–30% marginal · > 30% unfit. ndc ≥ 5 needed to discriminate parts.' },
      { id: 'actions',     kind: 'longtext', label: 'Corrective actions',
        hint: 'Re-calibration, operator re-training, fixture redesign, gauge replacement.' },
      { id: 'reproducibility', kind: 'hashes', label: 'Reproducibility' },
    ],
    defaults: ({ project, analyses }) => {
      const msa = (analyses || []).find(a => a.kind === 'msa');
      return {
        title: 'Gauge R&R Report',
        subtitle: project?.name || '',
        data: { meta: { study_date: new Date().toISOString().slice(0, 10), design: 'Crossed' } },
        analyses: msa ? [msa.id] : [],
      };
    },
  },

  // ──────────────────── DMAIC Tollgate Review (auto) ────────────────────
  {
    id: 'tollgate',
    name: 'DMAIC Tollgate Review',
    blurb: 'Auto-pulls every analysis linked to a project phase. One per tollgate.',
    phase: 'all',
    icon: 'doe',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Tollgate', fields: [
        { name: 'project_name', label: 'Project', kind: 'text' },
        { name: 'phase',        label: 'Phase', kind: 'select',
          options: ['Define', 'Measure', 'Analyze', 'Improve', 'Control'] },
        { name: 'review_date',  label: 'Review date', kind: 'date' },
        { name: 'reviewers',    label: 'Reviewers', kind: 'text' },
      ]},
      { id: 'exec_summary', kind: 'longtext', label: 'Executive summary',
        hint: 'Top three findings + status against goal. Two sentences each.' },
      { id: 'phase_checklist', kind: 'table', label: 'Phase deliverables',
        columns: ['Deliverable', 'Status', 'Owner', 'Notes'], rows: 5 },
      { id: 'analyses_block', kind: 'analyses_list', label: 'Analyses run this phase' },
      { id: 'decisions', kind: 'table', label: 'Decisions & action items',
        columns: ['Decision / Action', 'Owner', 'Due', 'Status'], rows: 5 },
      { id: 'next_phase', kind: 'longtext', label: 'Next-phase plan',
        hint: 'What needs to be true to pass this tollgate? What is the focus next?' },
      { id: 'signoff', kind: 'signoff', label: 'Tollgate approval',
        roles: ['Champion', 'Sponsor', 'Belt'] },
    ],
    defaults: ({ project, analyses }) => {
      const phase = project?.current_phase || 'measure';
      const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);
      const linkedIds = project?.phase_data?.[phase]?.analysis_ids || [];
      return {
        title: `${phaseLabel} Tollgate Review`,
        subtitle: project?.name || '',
        data: {
          meta: {
            project_name: project?.name || '',
            phase: phaseLabel,
            review_date: new Date().toISOString().slice(0, 10),
          },
        },
        analyses: linkedIds,
      };
    },
  },

  // ──────────────────── Final Project Closure ────────────────────
  {
    id: 'closure',
    name: 'Final Project Report',
    blurb: 'Project closure: financial benefit realized, before/after metrics, lessons learned, handoff.',
    phase: 'control',
    icon: 'doe',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Closure header', fields: [
        { name: 'project_name', label: 'Project', kind: 'text' },
        { name: 'sponsor',      label: 'Sponsor', kind: 'text' },
        { name: 'belt',         label: 'Belt', kind: 'text' },
        { name: 'start_date',   label: 'Start date', kind: 'date' },
        { name: 'close_date',   label: 'Close date', kind: 'date' },
      ]},
      { id: 'problem_recap', kind: 'longtext', label: 'Problem recap' },
      { id: 'approach',      kind: 'longtext', label: 'Approach summary (DMAIC story)' },
      { id: 'before_after', kind: 'table', label: 'Before vs after',
        columns: ['Metric', 'Baseline', 'Target', 'Actual', 'Delta'], rows: 4 },
      { id: 'financial', kind: 'kv', label: 'Financial benefit (realized)', fields: [
        { name: 'hard_realized', label: 'Hard $/yr realized', kind: 'currency' },
        { name: 'soft_realized', label: 'Soft $/yr realized', kind: 'currency' },
        { name: 'investment',    label: 'Investment',         kind: 'currency' },
        { name: 'roi',           label: 'ROI / payback',      kind: 'text' },
      ]},
      { id: 'analyses_block', kind: 'analyses_list', label: 'Supporting analyses' },
      { id: 'control_handoff', kind: 'longtext', label: 'Control plan + handoff',
        hint: 'Process owner, SPC monitor, audit cadence, escalation contact.' },
      { id: 'lessons', kind: 'longtext', label: 'Lessons learned',
        hint: 'What went well, what was hard, what would you do differently.' },
      { id: 'signoff', kind: 'signoff', label: 'Closure approvals',
        roles: ['Sponsor', 'Champion', 'Process Owner', 'Finance'] },
    ],
    defaults: ({ project, analyses }) => {
      const allIds = (analyses || []).map(a => a.id);
      return {
        title: 'Final Project Report',
        subtitle: project?.name || '',
        data: {
          meta: {
            project_name: project?.name || '',
            close_date: new Date().toISOString().slice(0, 10),
          },
        },
        analyses: allIds.slice(0, 10),
      };
    },
  },
  // ───────────────────────── VOC / CTQ Tree ─────────────────────────
  {
    id: 'voc_ctq',
    name: 'VOC / CTQ Tree',
    blurb: 'Translate Voice-of-Customer needs into measurable Critical-to-Quality requirements.',
    phase: 'define',
    icon: 'recipes',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Header', fields: [
        { name: 'product',  label: 'Product / service', kind: 'text' },
        { name: 'segment',  label: 'Customer segment',  kind: 'text' },
        { name: 'sources',  label: 'VOC sources (survey, NPS, complaints…)', kind: 'longtext' },
        { name: 'date',     label: 'Date', kind: 'date' },
      ]},
      { id: 'voc_table', kind: 'table', label: 'Voice of Customer → Need → CTQ',
        columns: ['Verbatim quote', 'Customer Need', 'Driver', 'CTQ (measurable)', 'Spec / Target', 'Unit'], rows: 8 },
      { id: 'priority', kind: 'table', label: 'CTQ priority',
        columns: ['CTQ', 'Importance (1-5)', 'Current performance', 'Gap', 'Priority rank'], rows: 5 },
      { id: 'notes', kind: 'longtext', label: 'Notes',
        hint: 'Affinity-diagram clusters, Kano classification (must-be / one-dimensional / delighter), conflicts to resolve.' },
    ],
    defaults: ({ project }) => ({
      title: 'VOC / CTQ Tree',
      subtitle: project?.name || '',
      data: { meta: { date: new Date().toISOString().slice(0, 10) } },
    }),
  },

  // ───────────────────────── Pugh / Decision Matrix ─────────────────────────
  {
    id: 'pugh',
    name: 'Pugh Decision Matrix',
    blurb: 'Improve-phase concept selection: score solutions against a datum on weighted criteria.',
    phase: 'improve',
    icon: 'doe',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Decision', fields: [
        { name: 'decision',    label: 'Decision being made', kind: 'text' },
        { name: 'team',        label: 'Team', kind: 'text' },
        { name: 'date',        label: 'Date', kind: 'date' },
        { name: 'datum',       label: 'Datum (baseline / current solution)', kind: 'text' },
      ]},
      { id: 'criteria', kind: 'table', label: 'Criteria + weights',
        columns: ['Criterion', 'Weight (1-5)', 'Rationale'], rows: 6,
        hint: 'Standard Pugh uses unweighted +/-/0; this template adds optional weights for weighted-Pugh scoring.' },
      { id: 'scoring', kind: 'table', label: 'Concept scoring (+ / – / 0 vs datum, or 1–5 weighted)',
        columns: ['Criterion', 'Concept A', 'Concept B', 'Concept C', 'Concept D'], rows: 6 },
      { id: 'totals', kind: 'table', label: 'Totals',
        columns: ['Metric', 'Concept A', 'Concept B', 'Concept C', 'Concept D'],
        defaultRows: [
          ['Sum of +',          '', '', '', ''],
          ['Sum of –',          '', '', '', ''],
          ['Net (weighted)',    '', '', '', ''],
          ['Rank',              '', '', '', ''],
        ]},
      { id: 'decision_rationale', kind: 'longtext', label: 'Selection rationale',
        hint: 'Chosen concept, why, what risks remain. If the leader is barely ahead, run a hybrid round.' },
    ],
    defaults: ({ project }) => ({
      title: 'Pugh Decision Matrix',
      subtitle: project?.name || '',
      data: { meta: { date: new Date().toISOString().slice(0, 10) } },
    }),
  },

  // ───────────────────────── 5S Audit ─────────────────────────
  {
    id: 'five_s',
    name: '5S Audit',
    blurb: 'Workplace organization audit: Sort · Set in order · Shine · Standardize · Sustain.',
    phase: 'all',
    icon: 'control',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Audit header', fields: [
        { name: 'area',     label: 'Area / cell', kind: 'text' },
        { name: 'auditor',  label: 'Auditor', kind: 'text' },
        { name: 'audit_date', label: 'Audit date', kind: 'date' },
        { name: 'prior_score', label: 'Prior score (if any)', kind: 'number' },
      ]},
      { id: 'scoring', kind: 'longtext', label: 'Scoring scale',
        hint: '0 = no evidence · 1 = poor · 2 = below average · 3 = average · 4 = good · 5 = excellent. Score every line; total/100 indicates maturity.' },
      { id: 'sort', kind: 'table', label: '1S · Sort (seiri)',
        columns: ['Check item', 'Score (0-5)', 'Notes'],
        defaultRows: [
          ['Only items needed for the work are in the area', '', ''],
          ['Red-tag log of removed items maintained',       '', ''],
          ['Aisles + floor clear of clutter',                '', ''],
          ['Obsolete tools / WIP removed',                   '', ''],
        ]},
      { id: 'set_in_order', kind: 'table', label: '2S · Set in order (seiton)',
        columns: ['Check item', 'Score (0-5)', 'Notes'],
        defaultRows: [
          ['Each item has a marked location ("a place for everything")', '', ''],
          ['High-use items closest to point-of-use',                     '', ''],
          ['Shadow boards / floor markings clear',                       '', ''],
          ['Min/max levels visible',                                     '', ''],
        ]},
      { id: 'shine', kind: 'table', label: '3S · Shine (seiso)',
        columns: ['Check item', 'Score (0-5)', 'Notes'],
        defaultRows: [
          ['Equipment + floor clean',                          '', ''],
          ['Cleaning schedule posted + signed off',            '', ''],
          ['No leaks, dust accumulation, or wear unaddressed', '', ''],
        ]},
      { id: 'standardize', kind: 'table', label: '4S · Standardize (seiketsu)',
        columns: ['Check item', 'Score (0-5)', 'Notes'],
        defaultRows: [
          ['Standard work / visual SOPs at workstation', '', ''],
          ['Checklists in use',                          '', ''],
          ['Color coding consistent across areas',       '', ''],
        ]},
      { id: 'sustain', kind: 'table', label: '5S · Sustain (shitsuke)',
        columns: ['Check item', 'Score (0-5)', 'Notes'],
        defaultRows: [
          ['5S audits at agreed cadence', '', ''],
          ['Audit scores trended on board', '', ''],
          ['Leadership engagement visible', '', ''],
        ]},
      { id: 'actions', kind: 'table', label: 'Action items',
        columns: ['Finding', 'Action', 'Owner', 'Due'], rows: 5 },
      { id: 'summary', kind: 'kv', label: 'Totals', fields: [
        { name: 'total_score',   label: 'Total / 100', kind: 'number' },
        { name: 'delta_prior',   label: 'Δ vs prior', kind: 'number' },
        { name: 'next_audit',    label: 'Next audit date', kind: 'date' },
      ]},
    ],
    defaults: () => ({
      title: '5S Audit',
      subtitle: '',
      data: { meta: { audit_date: new Date().toISOString().slice(0, 10) } },
    }),
  },

  // ───────────────────────── Kaizen Event Report ─────────────────────────
  {
    id: 'kaizen',
    name: 'Kaizen Event Report',
    blurb: 'Rapid-improvement workshop summary — before/after, root cause, countermeasures, ROI.',
    phase: 'improve',
    icon: 'doe',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Event header', fields: [
        { name: 'event_name', label: 'Event name', kind: 'text' },
        { name: 'area',       label: 'Area / process', kind: 'text' },
        { name: 'sponsor',    label: 'Sponsor', kind: 'text' },
        { name: 'facilitator', label: 'Facilitator', kind: 'text' },
        { name: 'start_date', label: 'Start date', kind: 'date' },
        { name: 'end_date',   label: 'End date',   kind: 'date' },
      ]},
      { id: 'team', kind: 'table', label: 'Team',
        columns: ['Name', 'Role', 'Function'], rows: 5 },
      { id: 'problem', kind: 'longtext', label: 'Problem statement' },
      { id: 'goals',   kind: 'longtext', label: 'Goals (quantified, time-bound)' },
      { id: 'scope',   kind: 'kv', label: 'Scope', fields: [
        { name: 'in_scope',  label: 'In scope', kind: 'longtext' },
        { name: 'out_scope', label: 'Out of scope', kind: 'longtext' },
      ]},
      { id: 'baseline', kind: 'table', label: 'Baseline metrics',
        columns: ['Metric', 'Value', 'Unit', 'Source'], rows: 4 },
      { id: 'observations', kind: 'longtext', label: 'Observations (waste, gemba, time study)' },
      { id: 'root_causes',  kind: 'longtext', label: 'Root cause analysis (5 Why / fishbone)' },
      { id: 'experiments', kind: 'table', label: 'Experiments / countermeasures tried',
        columns: ['Idea', 'Result', 'Adopt / Adapt / Abandon'], rows: 5 },
      { id: 'results', kind: 'table', label: 'Results — before vs after',
        columns: ['Metric', 'Before', 'After', 'Δ', '%Δ'], rows: 4 },
      { id: 'wastes', kind: 'longtext', label: 'Wastes (TIMWOODS) reduced',
        hint: 'Transport · Inventory · Motion · Waiting · Over-production · Over-processing · Defects · Skills.' },
      { id: 'sustain', kind: 'longtext', label: 'Sustainment plan',
        hint: 'Standard work updated · audit cadence · process owner.' },
      { id: 'roi', kind: 'kv', label: 'Estimated ROI', fields: [
        { name: 'savings', label: 'Annual savings ($)', kind: 'currency' },
        { name: 'invest',  label: 'Investment ($)',     kind: 'currency' },
        { name: 'payback', label: 'Payback (months)',   kind: 'number' },
      ]},
      { id: 'signoff', kind: 'signoff', label: 'Sign-off',
        roles: ['Sponsor', 'Facilitator', 'Process Owner'] },
    ],
    defaults: ({ project }) => ({
      title: 'Kaizen Event Report',
      subtitle: project?.name || '',
      data: { meta: { start_date: new Date().toISOString().slice(0, 10) } },
    }),
  },

  // ───────────────────────── RACI Matrix ─────────────────────────
  {
    id: 'raci',
    name: 'RACI Matrix',
    blurb: 'Responsible · Accountable · Consulted · Informed. Activity-by-person ownership grid.',
    phase: 'define',
    icon: 'msa',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Header', fields: [
        { name: 'project_name', label: 'Project / process', kind: 'text' },
        { name: 'owner',        label: 'Owner', kind: 'text' },
        { name: 'date',         label: 'Date',  kind: 'date' },
      ]},
      { id: 'legend', kind: 'longtext', label: 'Legend',
        hint: 'R = Responsible (does the work) · A = Accountable (single owner, signs off) · C = Consulted (two-way) · I = Informed (one-way). Exactly one A per row.' },
      { id: 'matrix', kind: 'table', label: 'RACI grid',
        columns: ['Activity / Deliverable', 'Sponsor', 'Champion', 'Belt', 'Process Owner', 'Team Member', 'Finance'],
        rows: 10,
        hint: 'Edit the role columns to match your team. Fill cells with R / A / C / I (single letter or combinations like RA).' },
      { id: 'notes', kind: 'longtext', label: 'Notes / escalation path' },
    ],
    defaults: ({ project }) => ({
      title: 'RACI Matrix',
      subtitle: project?.name || '',
      data: { meta: { date: new Date().toISOString().slice(0, 10) } },
    }),
  },

  // ───────────────────────── Validation Kit Stub (IQ/OQ/PQ) ─────────────────────────
  {
    id: 'validation_kit',
    name: 'Validation Kit (IQ/OQ/PQ stub)',
    blurb: 'Stub IQ/OQ/PQ documentation for regulated industries. Method dossiers + reproducibility hashes pre-filled from your analyses; protocol acceptance criteria you sign off.',
    phase: 'control',
    icon: 'recipes',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Validation header', fields: [
        { name: 'system_name',    label: 'System / process', kind: 'text' },
        { name: 'system_id',      label: 'System ID',        kind: 'text' },
        { name: 'standard',       label: 'Regulatory standard',
          kind: 'select', options: ['FDA 21 CFR Part 11', 'EU GMP Annex 11', 'GAMP 5', 'ISO 13485', 'IEC 62304', 'Other'] },
        { name: 'risk_class',     label: 'Risk classification (GAMP)', kind: 'select',
          options: ['Cat 1 (infrastructure)', 'Cat 3 (non-configured COTS)', 'Cat 4 (configured)', 'Cat 5 (custom)'] },
        { name: 'validation_lead', label: 'Validation lead', kind: 'text' },
        { name: 'qa_owner',       label: 'QA owner', kind: 'text' },
        { name: 'effective_date', label: 'Effective date', kind: 'date' },
        { name: 'revision',       label: 'Revision', kind: 'text' },
      ]},
      { id: 'scope', kind: 'longtext', label: 'Scope & purpose',
        hint: 'Boundaries of what is being validated. In-scope modules, processes, decisions; out-of-scope items explicitly listed.' },
      { id: 'iq', kind: 'longtext', label: 'IQ · Installation Qualification',
        hint: 'Software version, host OS, container image, dependency manifest, network architecture, install steps, install-verification checklist.' },
      { id: 'iq_evidence', kind: 'table', label: 'IQ evidence',
        columns: ['Item', 'Expected', 'Observed', 'Pass / Fail', 'Evidence ref'], rows: 5 },
      { id: 'oq', kind: 'longtext', label: 'OQ · Operational Qualification',
        hint: 'Each function operates within specified limits. List of test cases; for each: precondition, action, expected output, observed output, pass/fail. Conyso Bench: reference the per-method dossiers (algorithm + library + hashes) and the sidecar pytest run output.' },
      { id: 'oq_evidence', kind: 'table', label: 'OQ evidence (per analysis kind)',
        columns: ['Analysis kind', 'Test case', 'Expected', 'Observed', 'Pass / Fail', 'Dossier link'], rows: 6 },
      { id: 'pq', kind: 'longtext', label: 'PQ · Performance Qualification',
        hint: 'System performs as intended in the production environment over time. Real-data runs, statistical-control monitoring of the system itself, deviation log.' },
      { id: 'pq_evidence', kind: 'analyses_list', label: 'PQ evidence — linked production analyses' },
      { id: 'reproducibility', kind: 'longtext', label: 'Reproducibility statement',
        hint: 'Every Conyso Bench analysis carries a SHA-256 quartet (software_version · data_hash · params_hash · result_hash). Re-running on the same inputs reproduces the same hashes; discrepancies pinpoint a software upgrade or data change.' },
      { id: 'change_control', kind: 'table', label: 'Change control log',
        columns: ['Date', 'Change', 'Impact assessment', 'Re-validation required?', 'Approver'], rows: 4 },
      { id: 'deviations', kind: 'table', label: 'Deviations / non-conformances',
        columns: ['Date', 'Deviation', 'Severity', 'Root cause', 'CAPA', 'Closed'], rows: 3 },
      { id: 'acceptance', kind: 'longtext', label: 'Acceptance criteria',
        hint: 'Quantified pass criteria for each of IQ / OQ / PQ. State who signs off and when re-qualification is triggered.' },
      { id: 'open_items', kind: 'longtext', label: 'Open items / known limitations',
        hint: 'Honest list. Bench-specific note: no formal IQ/OQ/PQ packaging is shipped with the product itself — this kit wraps your own use of Bench with the reproducibility hashes + method dossiers as evidence.' },
      { id: 'signoff', kind: 'signoff', label: 'Approvals',
        roles: ['Validation Lead', 'QA', 'System Owner', 'Regulatory'] },
    ],
    defaults: ({ project, analyses }) => ({
      title: 'Validation Kit (IQ/OQ/PQ stub)',
      subtitle: project?.name || 'System validation',
      data: { meta: { effective_date: new Date().toISOString().slice(0, 10) } },
      analyses: (analyses || []).slice(0, 8).map(a => a.id),
    }),
  },

  // ───────────────────────── Stakeholder Analysis ─────────────────────────
  {
    id: 'stakeholder',
    name: 'Stakeholder Analysis',
    blurb: 'Map stakeholder influence vs support; plan engagement strategy per group.',
    phase: 'define',
    icon: 'multivariate',
    sections: [
      { id: 'meta', kind: 'kv', label: 'Header', fields: [
        { name: 'project_name', label: 'Project', kind: 'text' },
        { name: 'belt',         label: 'Belt', kind: 'text' },
        { name: 'date',         label: 'Date',  kind: 'date' },
      ]},
      { id: 'analysis', kind: 'table', label: 'Stakeholder analysis',
        columns: [
          'Stakeholder',
          'Role / interest',
          'Influence (L/M/H)',
          'Current stance (Champion / Supporter / Neutral / Skeptic / Blocker)',
          'Desired stance',
          'Engagement strategy',
          'Owner',
        ],
        rows: 8 },
      { id: 'comm_plan', kind: 'table', label: 'Communication plan',
        columns: ['Audience', 'Message', 'Channel', 'Cadence', 'Owner'], rows: 5 },
      { id: 'risks', kind: 'longtext', label: 'Resistance + risk mitigation',
        hint: 'Anticipated objections, planned responses, escalation thresholds.' },
    ],
    defaults: ({ project }) => ({
      title: 'Stakeholder Analysis',
      subtitle: project?.name || '',
      data: { meta: { date: new Date().toISOString().slice(0, 10) } },
    }),
  },
];

export const TEMPLATES_BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));

// Suggest the best template for a given analysis kind.
export function suggestTemplateForAnalysis(kind) {
  if (kind === 'capability' || kind === 'sixpack') return 'capability_report';
  if (kind === 'msa') return 'msa_report';
  if (kind === 'control_chart') return 'tollgate';
  return null;
}
