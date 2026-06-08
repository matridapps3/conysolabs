const VIEW_REGISTRY = {
  data: () => DataView(),
  analyze: () => AnalyzeView(),
  tools: () => ToolsView(),
  recipes: () => RecipesView(),
  methods: () => MethodsView(),
  projects: () => ProjectsView(),
  project: () => ProjectView(),
  reports: () => ReportsView(),
  report: () => ReportEditorView(),
  explore: () => ExploreView(),
  insights: () => InsightsView(),
  dashboard: () => DashboardView(),
  pipelines: () => PipelinesView(),
  worksheet: () => WorksheetView(),
  graph_builder: () => GraphBuilderView(),
  catalog: () => CatalogView(),
  validation: () => ValidationView(),
  learn_paths: () => LearningPathsView(),
  guides: () => GuidesView(),
  articles: () => ArticlesView(),
  faq: () => FaqView(),
  resources: () => ResourcesView(),
  feedback: () => FeedbackView(),
  feedback_item: () => FeedbackDetailView(),
};

function renderWorkspace() {
  const sec = h('section', { className: 'workspace' });
  // Subtle fade/slide-in, but only when the main view (tab) actually changes,
  // so it doesn't replay on every minor re-render within the same view.
  if (renderWorkspace._lastView !== state.view) {
    sec.classList.add('view-enter');
    renderWorkspace._lastView = state.view;
  }
  if (state._demoMode) sec.append(renderDemoBanner());
  const viewFn = VIEW_REGISTRY[state.view];
  if (!viewFn) {
    // Unknown route → recover gracefully to Data view rather than blank screen.
    sec.append(h('div', { className: 'card' },
      h('h3', {}, 'Unknown view'),
      h('p', { className: 'muted' }, `No view named "${state.view}". Reset to Data.`),
      h('button', { className: 'secondary', onclick: () => { state.view = 'data'; render(); } }, 'Go to Data')));
    return sec;
  }
  try {
    sec.append(viewFn());
  } catch (e) {
    // One thrown view function used to white-screen the entire SPA. Now it
    // surfaces as an inline error card so the sidebar / header still work
    // and the user can navigate elsewhere.
    console.error(`[view:${state.view}] render failed`, e);
    sec.append(h('div', { className: 'card', style: 'border-left:3px solid var(--danger)' },
      h('h3', {}, 'This view hit an error'),
      h('p', { className: 'muted' }, `${e.message || e}`),
      h('p', { className: 'muted', style: 'font-size:11px;font-family:var(--font-mono, monospace)' },
        (e.stack || '').split('\n').slice(0, 3).join(' · ')),
      h('div', { className: 'row', style: 'gap:8px;margin-top:8px' },
        h('button', { className: 'secondary', onclick: () => { state.view = 'data'; render(); } }, '← Data'),
        h('button', { className: 'ghost', onclick: () => render() }, 'Retry'),
      )));
  }
  return sec;
}

function ArticlesView() {
  const root = h('div');
  root.append(h('div', { className: 'breadcrumb' }, 'Learn · Articles'));
  if (!state._articleId) {
    root.append(
      h('h2', {}, 'Articles',
        h('span', { className: 'muted' }, ' · essays, case studies, opinion from Conyso Labs')),
      h('p', { className: 'guide-deck', style: 'margin-top:6px' },
        'Editorial pieces — longer than guides, sharper voice. New posts arrive as the product evolves.'),
    );
    const grid = h('div', { className: 'tool-index', style: 'margin-top:18px' });
    for (const a of ARTICLES) {
      const card = h('a', { className: 'tool-card', href: '#',
        onclick: (e) => { e.preventDefault(); state._articleId = a.id; render(); window.scrollTo(0,0); } },
        h('div', { className: 'tool-eyebrow' },
          (a.tags || []).join(' · ') || 'Article'),
        h('div', { className: 'tool-title' }, a.title),
        h('div', { className: 'tool-desc' }, a.blurb),
        h('div', { className: 'tool-go article-meta' },
          a.date, ' · ', a.byline || 'Conyso Labs'),
      );
      grid.append(card);
    }
    root.append(grid);
    return root;
  }
  const art = ARTICLES.find(x => x.id === state._articleId);
  if (!art) { state._articleId = null; render(); return root; }
  const i = ARTICLES.findIndex(x => x.id === art.id);
  const prev = i > 0 ? ARTICLES[i - 1] : null;
  const next = i < ARTICLES.length - 1 ? ARTICLES[i + 1] : null;
  const related = (art.related || [])
    .map(id => ARTICLES.find(x => x.id === id) || GUIDES.find(x => x.id === id))
    .filter(Boolean);
  root.append(
    h('div', { className: 'breadcrumb' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); state._articleId = null; render(); },
        style: 'color:var(--muted);text-decoration:none' }, 'Articles'),
      ' · ', art.title),
    h('div', { className: 'article-meta-line' },
      h('span', {}, art.date),
      h('span', {}, '·'),
      h('span', {}, art.byline || 'Conyso Labs'),
      ...(art.tags || []).map(t => h('span', { className: 'article-tag' }, t)),
    ),
    h('h2', { className: 'article-title' }, art.title),
    h('div', { className: 'guide-deck' }, art.blurb),
    h('article', { className: 'guide-body article-body', innerHTML: art.html }),
    related.length ? h('div', { className: 'guide-related' },
      h('div', { className: 'section-label' }, 'Related'),
      h('div', { className: 'guide-related-list' },
        ...related.map(r => {
          // r could be an article or a guide — disambiguate by checking ARTICLES.
          const isArt = ARTICLES.includes(r);
          return h('a', { href: '#',
            ...(isArt ? { onclick: (e) => { e.preventDefault(); state._articleId = r.id; render(); window.scrollTo(0,0); } }
                      : { 'data-nav-guide': r.id }) },
            h('span', { className: 'guide-related-title' }, r.title),
            h('span', { className: 'guide-related-blurb' }, r.blurb),
          );
        }),
      ),
    ) : null,
    h('div', { className: 'guide-nav' },
      prev ? h('a', { href: '#', className: 'guide-nav-prev',
        onclick: (e) => { e.preventDefault(); state._articleId = prev.id; render(); window.scrollTo(0,0); } },
        h('span', { className: 'guide-nav-label' }, '← Previous'),
        h('span', { className: 'guide-nav-title' }, prev.title),
      ) : h('span'),
      next ? h('a', { href: '#', className: 'guide-nav-next',
        onclick: (e) => { e.preventDefault(); state._articleId = next.id; render(); window.scrollTo(0,0); } },
        h('span', { className: 'guide-nav-label' }, 'Next →'),
        h('span', { className: 'guide-nav-title' }, next.title),
      ) : h('span'),
    ),
  );
  return root;
}

function FaqView() {
  const root = h('div');
  root.append(
    h('div', { className: 'breadcrumb' }, 'Learn · FAQ'),
    h('h2', {}, 'FAQ',
      h('span', { className: 'muted' }, ' · answers to the questions we hear most often')),
    h('p', { className: 'guide-deck', style: 'margin-top:6px' },
      'Organised by category. Click any question to expand. Missing answer? Email ',
      h('a', { href: 'mailto:hello@conyso.com', style: 'color:var(--accent)' }, 'hello@conyso.com'),
      '.'),
  );
  for (const grp of FAQ_GROUPS) {
    const block = h('div', { className: 'faq-group' });
    block.append(h('div', { className: 'methods-cat-head' },
      h('span', { className: 'methods-cat-title' }, grp.category),
      h('span', { className: 'methods-cat-count' }, `${grp.items.length}`),
    ));
    for (const item of grp.items) {
      block.append(h('details', { className: 'faq-item' },
        h('summary', {}, item.q),
        h('div', { className: 'faq-answer', innerHTML: item.a }),
      ));
    }
    root.append(block);
  }
  return root;
}

function ResourcesView() {
  const root = h('div');
  root.append(
    h('div', { className: 'breadcrumb' }, 'Learn · Resources'),
    h('h2', {}, 'Resources',
      h('span', { className: 'muted' }, ' · the references behind every method')),
    h('p', { className: 'guide-deck', style: 'margin-top:6px' },
      'Bench stands on standard scientific Python plus 50 years of statistical-quality scholarship. Here\'s where to dig deeper.'),
  );
  for (const grp of RESOURCES) {
    const block = h('div', { className: 'resource-group' });
    block.append(h('div', { className: 'methods-cat-head' },
      h('span', { className: 'methods-cat-title' }, grp.category),
      h('span', { className: 'methods-cat-count' }, `${grp.items.length}`),
    ));
    const list = h('div', { className: 'resource-list' });
    for (const r of grp.items) {
      list.append(h('a', { className: 'resource-row',
        href: r.url, target: '_blank', rel: 'noopener noreferrer' },
        h('div', { className: 'resource-name' }, r.name),
        h('div', { className: 'resource-desc' }, r.desc),
        h('div', { className: 'resource-open' }, 'Visit ↗'),
      ));
    }
    block.append(list);
    root.append(block);
  }
  return root;
}

// ────────────────── GUIDES ──────────────────

const GUIDES = [
  {
    id: 'getting-started', title: 'Getting started', blurb: 'Upload → analyse → read the result in three minutes.',
    related: ['pick-test', 'capability', 'control-charts'],
    html: `
<p>Bench is a workbench, not a wizard. The whole flow is three steps.</p>
<h3>1. Bring in data</h3>
<p>Open <strong>Datasets</strong> in the left rail and upload a CSV, Excel file, or PDF.
Bench auto-detects column types and previews the schema. Files stay on the server you're
running Bench on — nothing leaves the host, no telemetry, no LLM.</p>
<h3>2. Pick the analysis</h3>
<p>Two ways:</p>
<ul>
  <li><strong>Plain English query bar</strong> at the top of the Analyses page —
      try <em>"capability on cycle_time"</em> or <em>"compare yield by line"</em>.
      Bench parses the intent, picks the right analysis kind, and fills the form.</li>
  <li><strong>Left rail</strong> — click an analysis family (Hypothesis tests,
      Control charts, Capability, …). The family expands to show its sub-kinds;
      click one to open its form pre-filled.</li>
</ul>
<p>Unsure? Read <a data-nav-guide="pick-test">Choosing the right test</a> or
launch the wizard from any analyse form. Jump straight to a worked example:
<a data-nav-kind="capability">Capability analysis</a> ·
<a data-nav-kind="control_chart" data-nav-inner="I-MR" data-nav-inner-param="kind">I-MR chart</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="one_way_anova" data-nav-inner-param="test">One-way ANOVA</a>.</p>
<h3>3. Read the result</h3>
<p>Every result card has the same shape:</p>
<ul>
  <li><strong>Metric strip</strong> — headline numerics (e.g. Cp, Cpk, p-value), colour-coded by threshold.</li>
  <li><strong>Interpretation</strong> — plain-English "what this means" paragraph.</li>
  <li><strong>Chart</strong> — sidecar-rendered or inline SVG.</li>
  <li><strong>Action plan</strong> — rule-based next steps.</li>
  <li><strong>Reproducibility</strong> — the audit-trail hash quartet (open the collapsed block).</li>
</ul>
<p>Pin (★) the results you care about to compare side-by-side later. Save analyses as
<strong>recipes</strong> for one-click re-runs on new data.</p>
`},
  {
    id: 'pick-test', title: 'Choosing the right test', blurb: 'A decision tree, demystified.',
    related: ['capability', 'control-charts', 'dmaic'],
    html: `
<p>The most common mistake in hypothesis testing isn't running the wrong test —
it's running the right test on data that doesn't meet its assumptions. Bench
checks assumptions for you before the test runs.</p>
<h3>The four-question decision</h3>
<ol>
  <li><strong>What are you comparing?</strong> One sample to a target → 1-sample t.
      Two samples → 2-sample t. Three or more → ANOVA. Same subjects measured twice → paired.</li>
  <li><strong>Is the response continuous or categorical?</strong> Categorical →
      Chi-square (independence), Fisher's exact (small cells), proportion test.</li>
  <li><strong>Is the data approximately normal?</strong> Bench runs Anderson-Darling
      automatically. If <em>p &lt; 0.05</em>, the parametric test's p-value may be unreliable.
      Fall back to the non-parametric equivalent — Mann-Whitney for 2-sample, Kruskal-Wallis for k-sample.</li>
  <li><strong>Are the group variances equal?</strong> Levene checks this. If they're
      not, swap the standard 2-sample t for Welch's t (Bench's default) or use Games-Howell post-hoc.</li>
</ol>
<h3>Use the Test Chooser</h3>
<p>The <strong>Pick the right test</strong> button on the Analyse form answers
these in plain language. It always names the fallback so you don't get stuck.</p>
<h3>The pre-flight traffic lights</h3>
<p>Before you click Run, Bench shows green/amber/red dots for the assumptions
that matter for your chosen test. Amber doesn't always mean bail out — it means
you're now in a region where you should know what you're doing.</p>
<p style="margin-top:18px">Common tests:
<a data-nav-kind="hypothesis_test" data-nav-inner="one_sample_t"     data-nav-inner-param="test">1-sample t</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="two_sample_t"     data-nav-inner-param="test">2-sample t</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="one_way_anova"    data-nav-inner-param="test">ANOVA</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="mann_whitney"     data-nav-inner-param="test">Mann-Whitney</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="chi_square"       data-nav-inner-param="test">Chi-square</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="mcnemar"          data-nav-inner-param="test">McNemar</a> ·
<a data-nav-kind="posthoc"         data-nav-inner="tukey_hsd"        data-nav-inner-param="test">Tukey HSD</a>.</p>
`},
  {
    id: 'capability', title: 'Reading a capability result', blurb: 'Cp, Cpk, Pp, Ppk — what each number means and what to do.',
    html: `
<p>Process capability tells you whether your process can hit specification. Bench
reports six numbers; here's how to read them.</p>
<h3>Cp — potential capability (spread)</h3>
<p>How wide is your distribution relative to the spec? Cp ≥ 1.33 is standard;
≥ 1.67 for critical-to-quality. <strong>Cp ignores centring.</strong></p>
<h3>Cpk — actual capability (spread + centring)</h3>
<p>Cp adjusted for how off-centre the process is. If Cpk &lt; Cp, you're off the
target. Cpk &lt; 1.0 means defects are happening; Cpk between 1.0 and 1.33 is
marginal.</p>
<h3>Pp / Ppk — long-term equivalents</h3>
<p>Use the overall (long-term) standard deviation instead of the within-subgroup
σ. If Cp and Pp disagree significantly, you have drift or shift between
subgroups — investigate.</p>
<h3>The action plan</h3>
<p>Bench picks one of three diagnoses automatically:</p>
<ul>
  <li><strong>Cpk &lt; Cp by &gt;15%</strong> — process is off-centre. Centre first, before chasing variance.</li>
  <li><strong>Cp &lt; 1</strong> — variance is too high for spec. Tighten the process or widen the spec.</li>
  <li><strong>Cp / Pp gap</strong> — between-subgroup drift. Look upstream of the
      sampling boundary.</li>
</ul>
<p>If everything is bad at once, the recommendation defaults to <strong>Gauge R&amp;R first</strong> —
sometimes the noise you're chasing is in the measurement, not the process.</p>
<p style="margin-top:18px">Run it now:
<a data-nav-kind="capability">Capability (Cpk)</a> ·
<a data-nav-kind="sixpack">Capability Sixpack</a> ·
<a data-nav-kind="msa">Gauge R&amp;R</a> ·
<a data-nav-kind="predictive_cpk">Predictive Cpk</a>.</p>
`,
    related: ['pick-test', 'control-charts', 'dmaic']},
  {
    id: 'control-charts', title: 'Building a control chart', blurb: 'Which chart for which data.',
    html: `
<p>The chart family you pick depends on your data shape.</p>
<table style="margin: 14px 0; border-collapse: collapse; width: 100%">
<tr><th style="text-align: left; padding: 8px 0; border-bottom: 1px solid var(--line)">Your data</th>
    <th style="text-align: left; padding: 8px 0; border-bottom: 1px solid var(--line)">Use</th></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Individual readings, no subgroups</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">I-MR</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Subgroups of n=2..10</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">X-bar/R</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Subgroups of n &gt; 10</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">X-bar/S</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Defective proportion (varying n)</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">p</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Defect count per unit</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">c (constant n) or u (varying n)</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Looking for small persistent shifts</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">CUSUM or EWMA</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Multivariate (correlated outputs)</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Hotelling T² or MEWMA</td></tr>
<tr><td style="padding: 8px 0">Short runs / many part numbers</td>
    <td style="padding: 8px 0">Z-MR or DNOM</td></tr>
</table>
<h3>Out-of-control rules</h3>
<p>Bench applies the Western Electric + Nelson rules automatically. Violations
are flagged in red on the chart and listed in the result summary. The rule set:</p>
<ul>
  <li>One point beyond 3σ</li>
  <li>Nine points on one side of the centre line</li>
  <li>Six points in a row trending up or down</li>
  <li>Two of three points beyond 2σ on the same side</li>
  <li>Fourteen points alternating up and down</li>
</ul>
<p>If you're getting too many false-positives, narrow the rule set in the form.</p>
<p style="margin-top:18px">Run a chart:
<a data-nav-kind="control_chart" data-nav-inner="I-MR"    data-nav-inner-param="kind">I-MR</a> ·
<a data-nav-kind="control_chart" data-nav-inner="X-bar/R" data-nav-inner-param="kind">X-bar/R</a> ·
<a data-nav-kind="control_chart" data-nav-inner="EWMA"    data-nav-inner-param="kind">EWMA</a> ·
<a data-nav-kind="control_chart" data-nav-inner="CUSUM"   data-nav-inner-param="kind">CUSUM</a> ·
<a data-nav-kind="control_chart" data-nav-inner="T2"      data-nav-inner-param="kind">Hotelling T²</a> ·
<a data-nav-kind="control_chart" data-nav-inner="MEWMA"   data-nav-inner-param="kind">MEWMA</a>.</p>
`,
    related: ['capability', 'doe', 'dmaic']},
  {
    id: 'doe', title: 'DOE and multi-response optimisation', blurb: 'Pick a design, fit a surface, optimise — the short version.',
    html: `
<p>DOE is three steps in Bench: choose a design, run the experiment, then either
fit a model or optimise.</p>
<h3>Choose a design</h3>
<p>Under <strong>Tools › DOE Design Generator</strong>:</p>
<ul>
  <li><strong>Full factorial</strong> — 2 to 5 factors, full coverage. Becomes expensive past 4 factors.</li>
  <li><strong>Fractional factorial</strong> — half (or quarter, eighth) of full. Pick the resolution that matches your budget.</li>
  <li><strong>Plackett-Burman</strong> — screen 7+ factors in 8/12/16/20 runs. Main effects only.</li>
  <li><strong>Definitive Screening (Jones-Nachtsheim, 2011)</strong> — screen and detect curvature in one shot.</li>
  <li><strong>CCD / Box-Behnken</strong> — response-surface designs for fitting curvature.</li>
  <li><strong>Mixture (simplex)</strong> — when factors are proportions summing to 1.</li>
</ul>
<h3>Fit a surface</h3>
<p>After running the experiment, upload the results and run
<strong>DOE → Factorial fit</strong> or the <strong>Response surface</strong> kind.
Bench reports coefficients, p-values per term, R², adjusted R², and the
predicted single-response optimum (vertex of the quadratic).</p>
<h3>Optimise across multiple responses</h3>
<p>If you care about more than one Y (yield AND cost AND purity), use
<strong>DOE → Multi-response (desirability)</strong>. Paste a JSON spec like:</p>
<pre style="background: var(--surface); padding: 14px; font-size: 12px; font-family: var(--font-mono); border: 1px solid var(--line); border-radius: 3px">[
  {"name": "yield",  "kind": "max", "low": 70, "high": 95, "importance": 5},
  {"name": "cost",   "kind": "min", "low": 8,  "high": 20, "importance": 3},
  {"name": "purity", "kind": "target", "low": 95, "high": 99.5, "target": 98.5, "importance": 5}
]</pre>
<p>Bench fits a quadratic surface per response, then maximises the overall
desirability D (Derringer-Suich, 1980) via multi-start L-BFGS-B over the
coded factor box. The result is the factor settings that best satisfy all
constraints simultaneously, with each response's individual desirability score.</p>
<p style="margin-top:18px">Tools and analyses:
<a data-nav-tool="doe_design">DOE Design Generator</a> ·
<a data-nav-kind="doe">DOE factorial fit</a> ·
<a data-nav-kind="desirability">Multi-response desirability</a>.</p>
`,
    related: ['capability', 'dmaic', 'pick-test']},
  {
    id: 'dmaic', title: 'DMAIC workflow with Bench', blurb: 'Five phases, one project view.',
    html: `
<p>A DMAIC project in Bench bundles a phase checklist with the analyses you ran
to support each phase. Open <strong>Projects</strong> in the sidebar and click
<strong>New project</strong>.</p>
<h3>Define</h3>
<p>Default checklist: charter, SIPOC, voice of the customer, scope. Use this
phase as a notepad — Bench doesn't author the charter for you, but it tracks
what's done.</p>
<h3>Measure</h3>
<p>Run <strong>Gauge R&amp;R</strong> first; if the measurement system fails (% R&amp;R &gt; 30%),
nothing else in the project is reliable. Then run a baseline
<strong>Capability</strong> analysis on the response. Attach both to the Measure
phase.</p>
<h3>Analyze</h3>
<p>Pareto on the defect categories, then hypothesis tests on the suspected X's
(or a regression / DOE if you have many candidates). Pin the analyses that
confirmed each cause. Use <strong>Post-hoc → Hsu MCB</strong> if you have many
groups and want to identify which are the best/worst.</p>
<h3>Improve</h3>
<p>If the cause-effect is well-understood, jump to a solution. Otherwise run a
<strong>DOE</strong> (factorial fit for screening, RSM for optimisation). Use
<strong>Multi-response desirability</strong> when you have competing Ys.</p>
<h3>Control</h3>
<p>Set up a control chart on the improved process. Document a control plan
(checklist item). Re-run capability to confirm sustained gains. Hand over to
the process owner.</p>
<p><strong>What Bench doesn't do (yet):</strong> authoring SIPOC diagrams, fishbone
trees, or value-stream maps. Pair with your project tool of choice.</p>
<p style="margin-top:18px">Start a project:
<a data-nav-guide="capability">Capability primer</a> ·
<a data-nav-guide="doe">DOE primer</a> ·
<a data-nav-guide="reproducibility">Reproducibility</a>.
Or open the <a href="#" onclick="event.preventDefault(); navigate({view:'projects'})">Projects view</a> and start one now.</p>
`,
    related: ['getting-started', 'capability', 'doe']},
  {
    id: 'reproducibility', title: 'Reproducibility & dossiers', blurb: "The audit-trail story Minitab can't tell.",
    html: `
<p>Every Bench result is bound to a four-part hash:</p>
<ul>
  <li><code>software_version</code> — the build of Bench that ran it.</li>
  <li><code>data_hash</code> — SHA-256 of the input data (storage key).</li>
  <li><code>params_hash</code> — SHA-256 of the canonical params JSON.</li>
  <li><code>result_hash</code> — SHA-256 of the canonical result JSON (volatile fields stripped).</li>
</ul>
<p>Re-run the same recipe on the same data and you get bit-identical hashes.
This is impossible to prove with closed-source software — it's why
reproducibility is suddenly Bench's biggest defensive advantage.</p>
<h3>Method dossier (printable)</h3>
<p>Every result has a <strong>Dossier</strong> button. It opens a printable
one-page HTML page listing:</p>
<ul>
  <li>Algorithm name + plain-English description</li>
  <li>The exact library function (e.g. <code>scipy.stats.f_oneway</code>)</li>
  <li>The peer-reviewed citation (e.g. <em>Fisher (1925)</em>)</li>
  <li>Software version + the four hashes</li>
  <li>Every input parameter</li>
  <li>Every output value</li>
</ul>
<p>Print to PDF for your validation package. For regulated industries that need
sealed IQ/OQ/PQ paperwork, Conyso Labs offers commercial authoring — contact
<code>hello@conyso.com</code>.</p>
<h3>When hashes disagree across runs</h3>
<p>If you re-run today and the result_hash differs from yesterday, three
things to check: did the software version change? did the dataset change?
did any default parameter shift? Bench's dossier surfaces all three so the
diff is one-click.</p>
`},
  {
    id: 'migrate', title: 'Migrating from Minitab', blurb: "What comes over, what doesn't, and how to bridge the gaps.",
    html: `
<p>Most teams that try Bench come with years of Minitab muscle memory. Here's
how to move efficiently.</p>
<h3>What comes over</h3>
<ul>
  <li><strong>Your CSVs.</strong> Bench reads CSV, Excel, and even PDF tables.</li>
  <li><strong>Your mental model.</strong> Capability is still Cpk; ANOVA is still ANOVA. Bench's
      Test Chooser uses the same decision tree a Minitab Assistant user would expect.</li>
  <li><strong>Your training.</strong> Every method in Bench cites the original publication
      — see the <strong>Methods</strong> page.</li>
</ul>
<h3>What doesn't come over</h3>
<ul>
  <li><strong>Minitab macros (.MTB / .Exec)</strong> — Bench has no macro language.
      The equivalent is <strong>Recipes</strong> (saved analyses with their params)
      plus the REST API. If you live in macros today, the migration is real work —
      port the most-used 5–10 macros first.</li>
  <li><strong>.mpj project files</strong> — closed format, can't be imported directly.
      Re-run from the source CSV.</li>
  <li><strong>Companion / Workspace project tracking</strong> — Bench's
      <strong>Projects</strong> view covers DMAIC phase + checklist + linked analyses.
      It does <em>not</em> author SIPOC / VSM / fishbone diagrams; pair with another tool.</li>
</ul>
<h3>Validation-equivalence checklist</h3>
<p>Before swapping Bench in for a Minitab-validated workflow:</p>
<ol>
  <li>Re-run 5–10 representative past analyses in both tools. Hashes won't
      match (different software), but the headline numerics should agree to 4
      decimal places.</li>
  <li>For each analysis kind you use, open the Bench source for the relevant
      algorithm (the Methods page links each).</li>
  <li>Decide whether your validation framework accepts open-source provenance.
      Many do today; some still require a sealed kit. For the latter, the
      Conyso Labs commercial validation engagement is the bridge.</li>
</ol>
`},

  // ───────── deeper-dive practitioner guides ─────────

  { id: 'msa-deep', title: 'Gauge R&R: how much measurement noise is too much?',
    blurb: 'Crossed vs nested vs expanded, AIAG criteria, ndc, and when to stop arguing.',
    related: ['capability', 'dmaic', 'pick-test'],
    html: `
<p>If your measurement system is bad, every analysis downstream is contaminated.
Gauge R&amp;R quantifies <em>how much</em> of the variation you see is the gauge,
not the part. Run this <strong>before</strong> any capability study or DOE.</p>

<h3>Pick the design</h3>
<ul>
  <li><strong>Crossed</strong> — every operator measures every part, multiple
      times. The default. Use whenever the measurement is non-destructive.</li>
  <li><strong>Nested</strong> — each operator measures different parts.
      Use for destructive tests (tensile strength, single-shot chemistries).
      You lose the operator×part interaction term — that's the trade-off.</li>
  <li><strong>Expanded</strong> — like crossed but you add variance sources
      (environment, day, gauge serial). Use when the gauge is one of several
      that the team rotates through, or when day-to-day drift is suspected.</li>
</ul>

<h3>Read the result</h3>
<table style="margin:14px 0;border-collapse:collapse;width:100%">
<tr><th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">% GR&amp;R (of study variation)</th>
    <th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Verdict</th></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">&lt; 10%</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Excellent. Trust the gauge.</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">10–30%</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Acceptable for non-critical applications; problematic for tight specs.</td></tr>
<tr><td style="padding:8px 0">&gt; 30%</td>
    <td style="padding:8px 0">Unacceptable. Fix the gauge before continuing the project.</td></tr>
</table>

<h3>ndc — number of distinct categories</h3>
<p>If <strong>ndc &lt; 5</strong>, your gauge can't reliably distinguish the parts
in your range. Even a study with low % GR&amp;R can fail this if the parts
themselves are too similar. AIAG MSA target is ndc ≥ 5.</p>

<h3>Common mistakes</h3>
<ol>
  <li><strong>Treating ndc as advisory.</strong> It isn't. ndc &lt; 5 means
      you cannot do meaningful SPC with this gauge on these parts.</li>
  <li><strong>Running too few parts.</strong> 10 parts spanning the full
      tolerance is the AIAG minimum.</li>
  <li><strong>Operators all measure the same way.</strong> Defeats the point —
      you want them to use their normal technique.</li>
  <li><strong>Ignoring repeatability (EV) vs reproducibility (AV).</strong>
      High EV = the gauge itself is noisy → fix the gauge. High AV = operators
      disagree → fix the procedure / training.</li>
</ol>

<p style="margin-top:18px">Run it now:
<a data-nav-kind="msa" data-nav-inner="crossed"  data-nav-inner-param="design">Crossed GR&amp;R</a> ·
<a data-nav-kind="msa" data-nav-inner="nested"   data-nav-inner-param="design">Nested GR&amp;R</a> ·
<a data-nav-kind="msa" data-nav-inner="expanded" data-nav-inner-param="design">Expanded GR&amp;R</a>.</p>
`},

  { id: 'sample-size', title: 'Sample size & power without the hand-waving',
    blurb: 'How big does n need to be — and why "big enough" depends on three things you have to specify.',
    related: ['pick-test', 'capability', 'doe'],
    html: `
<p>"How many samples do we need?" is the most asked, least-understood question
in Lean Six Sigma. You need three inputs before a calculator can answer:</p>
<ol>
  <li><strong>α</strong> — false-positive rate you accept. Convention: 0.05.</li>
  <li><strong>β / power</strong> — false-negative rate you accept. Power = 1−β.
      Convention: power = 0.80 (so β = 0.20).</li>
  <li><strong>Effect size</strong> — the smallest difference worth detecting.
      <em>This is the one most people skip.</em> "Detect anything" requires
      infinite samples.</li>
</ol>

<h3>Effect-size conventions</h3>
<table style="margin:14px 0;border-collapse:collapse;width:100%">
<tr><th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Family</th>
    <th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Effect-size metric</th>
    <th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Small / Medium / Large</th></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">t-test</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">δ / σ (Cohen's d)</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.2 / 0.5 / 0.8</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">ANOVA</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Cohen's f</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.10 / 0.25 / 0.40</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">Regression</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Cohen's f² = R²/(1−R²)</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.02 / 0.15 / 0.35</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">Chi-square</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Cohen's w</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.10 / 0.30 / 0.50</td></tr>
<tr><td style="padding:8px 0">Correlation</td>
    <td style="padding:8px 0">r</td>
    <td style="padding:8px 0">0.10 / 0.30 / 0.50</td></tr>
</table>

<p>For a Cpk validation study, the analogy is reversed — you specify the
<em>Cpk margin</em> you need the lower confidence bound to clear, not an
effect size.</p>

<h3>Special cases Bench covers</h3>
<ul>
  <li><strong>TOST equivalence</strong> — to <em>demonstrate</em> two means are
      within a margin. Larger n than the corresponding superiority test.</li>
  <li><strong>Log-rank (survival)</strong> — Schoenfeld's formula via hazard
      ratio and event probability.</li>
  <li><strong>Cluster-randomized</strong> — applies design effect
      <code>DEFF = 1 + (m−1)·ρ</code> to the standard formula.</li>
  <li><strong>Finite population correction</strong> — when sampling &gt; 5% of
      a known population, the required n shrinks via Cochran's FPC.</li>
</ul>

<h3>The bias to fight</h3>
<p>People want to specify <em>what they hope to find</em> (a tiny difference)
but accept the n needed to find a <em>practically important</em> difference.
Pick the smallest difference that would change a decision. Anything smaller
isn't worth detecting.</p>

<p style="margin-top:18px">Open the calculator:
<a data-nav-tool="sample_size">Sample size &amp; power</a>.</p>
`},

  { id: 'hypothesis-deep', title: 'Hypothesis tests in practice',
    blurb: 'p-values, effect sizes, multiple comparisons, and the four mistakes that wreck most projects.',
    related: ['pick-test', 'sample-size', 'capability'],
    html: `
<p>A statistically significant result is not the same as a meaningful result.
This guide is the short version of where that distinction matters.</p>

<h3>p-value ≠ effect size</h3>
<p>With enough samples, every trivially small effect becomes statistically
significant. The fix is to <strong>report both</strong> — the test statistic + p
AND the effect size (Cohen's d, η², r). Bench surfaces both on every result.</p>

<h3>The four mistakes</h3>
<ol>
  <li><strong>Reading the p-value before checking assumptions.</strong> The
      pre-flight traffic lights exist for this. A t-test with non-normal data and
      n=15 can produce an utterly wrong p. Bench falls back to the non-parametric
      equivalent automatically when assumptions fail — let it.</li>
  <li><strong>Running many comparisons, reporting one p-value.</strong> If you
      ran an ANOVA across 8 levels and then ran 28 pairwise tests at α=0.05
      <em>without correction</em>, your familywise error rate balloons to ~76%
      (1 − 0.95²⁸). Use Tukey HSD or Hsu MCB — both control familywise α to your
      target. Bench's post-hoc tests do this for you.</li>
  <li><strong>Confusing "p &gt; 0.05" with "no effect".</strong> Failing to
      reject H₀ is not evidence of equivalence. For that, run a TOST equivalence
      test with a margin you specify.</li>
  <li><strong>Ignoring confidence intervals.</strong> The CI tells you the
      range of effects compatible with your data. A "significant" result with a
      wide CI that crosses zero in practical terms is barely actionable.</li>
</ol>

<h3>When to use which test</h3>
<p>The flowchart (see <a data-nav-guide="pick-test">Choosing the right test</a>):</p>
<ul>
  <li>One group vs target → 1-sample t (parametric) or sign test (non-parametric)</li>
  <li>Two independent groups → Welch's t or Mann-Whitney U</li>
  <li>Two paired measurements → paired t or Wilcoxon signed-rank</li>
  <li>Three or more groups → one-way ANOVA (then Tukey HSD), or Kruskal-Wallis (then Dunn's)</li>
  <li>Categorical → Chi-square (large cells) or Fisher's exact (small)</li>
  <li>Paired binary → McNemar</li>
  <li>Equivalence (not difference) → TOST</li>
</ul>

<h3>Reporting the result</h3>
<p>Standard format: <em>"A Welch's two-sample t-test on n₁=42, n₂=38 found a
significant difference (t = 3.42, df = 73.8, p &lt; 0.001; Cohen's d = 0.78,
95% CI on the mean difference [1.4, 3.9] units)."</em></p>

<p>Bench produces this paragraph automatically in the <strong>Interpretation</strong>
block on every hypothesis-test result.</p>

<p style="margin-top:18px">Quick links:
<a data-nav-kind="hypothesis_test" data-nav-inner="two_sample_t" data-nav-inner-param="test">2-sample t</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="one_way_anova" data-nav-inner-param="test">ANOVA</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="mann_whitney"  data-nav-inner-param="test">Mann-Whitney</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="tost_two_sample" data-nav-inner-param="test">TOST</a> ·
<a data-nav-kind="posthoc"         data-nav-inner="tukey_hsd"    data-nav-inner-param="test">Tukey HSD</a>.</p>
`},

  { id: 'reliability-primer', title: 'Reliability primer',
    blurb: 'Weibull intuition, censoring, MTBF vs B10, and which distribution to fit.',
    related: ['capability', 'control-charts'],
    html: `
<p>Reliability analysis answers two questions: <em>how long until failure?</em>
and <em>what fraction will survive past time t?</em> The math handles a
peculiarity of failure data that most analyses don't: <strong>right-censoring</strong>.</p>

<h3>What censoring means</h3>
<p>You ran a 1000-hour test. Three units failed at 220, 540, 880 hours. Two
units were still running when the test stopped. Those two are <em>censored
at 1000</em> — you know they survived past 1000 hours but not how long they
would have ultimately lasted. Discarding them biases the estimate downward.
Bench's Weibull and exponential fitters handle censoring via MLE.</p>

<h3>Pick the distribution</h3>
<ul>
  <li><strong>Weibull (2-parameter)</strong> — the workhorse. The shape parameter
      β tells you the failure mode: β &lt; 1 = infant mortality (decreasing
      hazard); β = 1 = random failures (constant hazard, = exponential);
      β &gt; 1 = wear-out (increasing hazard).</li>
  <li><strong>Exponential</strong> — special case of Weibull with β = 1. Use
      when failure rate is constant (electronic components in their useful-life
      window).</li>
  <li><strong>Lognormal</strong> — common for repair times, metal fatigue.</li>
  <li><strong>Gamma</strong> — flexible alternative to lognormal.</li>
  <li><strong>Log-logistic</strong> — when hazard rises then falls.</li>
  <li><strong>Smallest extreme value</strong> — weakest-link failures (rope
      strands, chain links). Mathematically Gumbel for minima.</li>
  <li><strong>Largest extreme value</strong> / <strong>GEV</strong> — peak
      loads, peak temperatures, return-period analysis.</li>
  <li><strong>Arrhenius accelerated-life</strong> — when you test at high
      temperatures and need to extrapolate to nominal operating temperature.</li>
</ul>

<p>If you're unsure, run the <a data-nav-kind="distribution_id">Distribution
identifier</a> first — it ranks candidates by Anderson-Darling fit.</p>

<h3>MTBF vs B10</h3>
<p><strong>MTBF</strong> (mean time between failures) is the <em>mean</em> of the
distribution. It includes the long right tail. Half your units fail much
sooner than MTBF.</p>
<p><strong>B10</strong> is the time at which 10% have failed (the 10th
percentile). For warranty design, B10 is usually the right number — it
guarantees a specified survival fraction.</p>

<h3>Common mistakes</h3>
<ol>
  <li><strong>Reporting only mean failure time.</strong> Always report a
      percentile (B10, B50) plus the survival curve.</li>
  <li><strong>Dropping censored data.</strong> Bias downward by exactly the
      fraction censored.</li>
  <li><strong>Fitting normal to failure times.</strong> Failure times are
      almost never symmetric. Use Weibull, lognormal, or gamma.</li>
  <li><strong>Extrapolating Arrhenius too far.</strong> The Arrhenius model
      assumes one failure mechanism. At very high stress, new mechanisms
      activate; the extrapolation breaks.</li>
</ol>

<p style="margin-top:18px">Try it:
<a data-nav-kind="reliability" data-nav-inner="weibull"     data-nav-inner-param="distribution">Weibull</a> ·
<a data-nav-kind="reliability" data-nav-inner="exponential" data-nav-inner-param="distribution">Exponential</a> ·
<a data-nav-kind="reliability" data-nav-inner="lognormal"   data-nav-inner-param="distribution">Lognormal</a> ·
<a data-nav-kind="reliability" data-nav-inner="arrhenius"   data-nav-inner-param="distribution">Arrhenius</a>.</p>
`},

  { id: 'multivariate-primer', title: 'Multivariate primer',
    blurb: 'PCA, clustering, LDA, and Hotelling — when correlated variables actually need it.',
    related: ['control-charts', 'doe'],
    html: `
<p>Multivariate methods exist because most processes have <em>many correlated
outputs</em>. Treating each output independently misses the joint structure
and inflates false-alarm rates on control charts.</p>

<h3>PCA — reduce dimensionality</h3>
<p>Project your high-dimensional data onto a few orthogonal axes that capture
most of the variance. Use cases:</p>
<ul>
  <li>Pre-regression: replace 30 correlated predictors with 5 principal
      components.</li>
  <li>Visualisation: plot 12-dimensional process data on PC1 vs PC2 — clusters
      and outliers pop out.</li>
  <li>Compression: keep PCs explaining 95% of variance; drop the rest.</li>
</ul>
<p><strong>Standardise first.</strong> PCA is variance-driven; without
standardisation the largest-scale variable dominates.</p>

<h3>K-means / Hierarchical — find unknown groups</h3>
<p>K-means: tell it k (number of clusters) and it finds the best k-cluster
partition. Hierarchical: builds a dendrogram showing similarity at every cut.
Use hierarchical when you don't know k; pick k by inspecting the dendrogram.</p>

<h3>LDA — classify into known groups</h3>
<p>Linear Discriminant Analysis is supervised: you tell it which observations
belong to which group, and it finds the directions that best separate them.
The output is a classification rule. If you only want dimensionality
reduction, use PCA; if you want classification with known labels, use LDA.</p>

<h3>Hotelling T² — multivariate SPC</h3>
<p>When you have multiple correlated outputs (length, width, weight, density…),
running separate X-charts for each is wrong — joint behaviour matters. Hotelling
T² collapses the multivariate state into a single distance from the in-control
mean. Use it when:</p>
<ul>
  <li>Outputs are correlated (r &gt; 0.3 between most pairs).</li>
  <li>You can afford to investigate joint signals (T² doesn't tell you which
      variable shifted — that's where MEWMA + decomposition helps).</li>
</ul>

<h3>When NOT to go multivariate</h3>
<p>If outputs are independent (correlations all &lt; 0.2), univariate charts
are usually fine and easier to investigate when they alarm. Multivariate
adds power AND interpretation cost.</p>

<p style="margin-top:18px">Try it:
<a data-nav-kind="multivariate"  data-nav-inner="pca"          data-nav-inner-param="method">PCA</a> ·
<a data-nav-kind="multivariate"  data-nav-inner="kmeans"       data-nav-inner-param="method">K-means</a> ·
<a data-nav-kind="multivariate"  data-nav-inner="lda"          data-nav-inner-param="method">LDA</a> ·
<a data-nav-kind="multivariate"  data-nav-inner="hierarchical" data-nav-inner-param="method">Hierarchical</a> ·
<a data-nav-kind="control_chart" data-nav-inner="T2"           data-nav-inner-param="kind">Hotelling T² chart</a> ·
<a data-nav-kind="control_chart" data-nav-inner="MEWMA"        data-nav-inner-param="kind">MEWMA chart</a>.</p>
`},

  { id: 'time-series', title: 'Time series and forecasting',
    blurb: 'ARIMA without tears: stationarity, differencing, seasonal decomposition.',
    related: ['control-charts', 'getting-started'],
    html: `
<p>Time series methods answer two related questions: <em>is there structure
beyond noise?</em> and <em>what's the next value likely to be?</em></p>

<h3>Stationarity — the precondition</h3>
<p>Most parametric methods (ARIMA, exponential smoothing) assume the series is
<strong>stationary</strong>: mean and variance constant over time, no trend, no
seasonal cycle. Non-stationary data must be transformed first:</p>
<ul>
  <li><strong>Differencing</strong> (d ≥ 1 in ARIMA) — removes linear trend.</li>
  <li><strong>Seasonal differencing</strong> — removes seasonal cycles.</li>
  <li><strong>Log transform</strong> — stabilises variance when amplitude grows
      with level.</li>
</ul>
<p>Use Bench's <strong>Decompose</strong> first to visually separate trend +
seasonal + residual components. The residual should look like noise; if it
doesn't, you've missed something.</p>

<h3>Pick the model</h3>
<ul>
  <li><strong>Exponential smoothing (Holt-Winters)</strong> — fast, robust,
      handles trend + seasonality. The default for short business series.</li>
  <li><strong>ARIMA(p, d, q)</strong> — explicit autoregressive (p) and
      moving-average (q) terms, with d levels of differencing. More flexible.</li>
  <li><strong>Auto-ARIMA</strong> — Bench searches (p, d, q) by AIC for you.
      Start here; tune manually only if auto's choice is unreasonable.</li>
</ul>

<h3>ACF / PACF for diagnosis</h3>
<p>The autocorrelation function (ACF) shows how correlated each point is with
its k-step lag. The partial ACF (PACF) does the same after controlling for
intermediate lags.</p>
<ul>
  <li>ACF decays slowly + PACF cuts off at lag p → AR(p)</li>
  <li>ACF cuts off at lag q + PACF decays slowly → MA(q)</li>
  <li>Both decay → ARMA</li>
</ul>

<h3>How far to forecast</h3>
<p>The honest answer: not far. ARIMA confidence intervals widen rapidly with
horizon. A 12-month forecast on a monthly series usually has CI half-widths
larger than the mean. Forecast no further than 25% of your history length
unless you have a specific reason.</p>

<p style="margin-top:18px">Try it:
<a data-nav-kind="time_series" data-nav-inner="exp_smoothing" data-nav-inner-param="method">Exp. smoothing</a> ·
<a data-nav-kind="time_series" data-nav-inner="arima"         data-nav-inner-param="method">ARIMA</a> ·
<a data-nav-kind="time_series" data-nav-inner="auto_arima"    data-nav-inner-param="method">Auto-ARIMA</a> ·
<a data-nav-kind="time_series" data-nav-inner="decompose"     data-nav-inner-param="method">Decompose</a> ·
<a data-nav-kind="time_series" data-nav-inner="acf_pacf"      data-nav-inner-param="method">ACF / PACF</a>.</p>
`},

  // ─── Leap-ahead batch guides ───
  { id: 'survival', title: 'Kaplan-Meier + log-rank: time-to-event in plain English',
    blurb: 'Survival curves without the medical-journal jargon.',
    related: ['reliability-primer', 'hypothesis-deep'],
    html: `
<p>Survival analysis isn't just medicine. It's any "time until an event" question:
time until a machine fails, until a customer churns, until a part wears out, until a
service ticket gets resolved.</p>
<h3>When to use it</h3>
<ul>
  <li>You have a <strong>time-to-event</strong> column.</li>
  <li>Some observations are <strong>censored</strong> — the event hasn't happened yet
      when the study ended (the customer is still around; the machine is still running).</li>
  <li>You want to compare two or more groups.</li>
</ul>
<p>Bench's Kaplan-Meier estimator handles censoring correctly. A simple mean of
event times would discard the censored cases and bias your answer.</p>
<h3>Reading the output</h3>
<p><strong>S(t)</strong> = probability of surviving past time t. Starts at 1.0,
steps down at each event. <strong>Median survival</strong> = the t where S(t) crosses 0.5.
<strong>RMST</strong> (restricted mean survival time) = area under the curve up to the
last observed event — robust when the median is never reached.</p>
<h3>The log-rank test</h3>
<p>k-sample test for "do these survival curves differ?". <strong>p &lt; 0.05</strong>
means at least two curves are significantly different. It does <em>not</em> tell you
which pair — for that, run pairwise log-rank with Bonferroni adjustment.</p>
<p>Try it: <a data-nav-kind="survival">Kaplan-Meier + log-rank</a>.</p>
`},

  { id: 'mixed-effects', title: 'Linear mixed-effects (LMM): when subjects vary',
    blurb: 'Repeated measures, nested data, ICC — the model GR&R secretly wants.',
    related: ['msa-deep'],
    html: `
<p>Whenever the same unit (person, machine, batch) is measured multiple times, the
observations are <strong>not independent</strong>. A plain ANOVA assumes they are. LMM
fixes this by adding a <strong>random intercept</strong> per subject — each subject gets
their own baseline.</p>
<h3>When to use it</h3>
<ul>
  <li>Repeated measures (same subject, multiple time points or conditions).</li>
  <li>Nested data (students within classes within schools).</li>
  <li>Crossed designs (operator × part, with repeats).</li>
  <li>You want the variance share from each level (the <strong>ICC</strong>).</li>
</ul>
<h3>The formula</h3>
<p>Bench uses statsmodels syntax: <code>y ~ x1 + x2</code> for fixed effects, then a
separate <strong>group</strong> column for the random-intercept variable. Add a random
slope on x with <code>random = '1 + x'</code>.</p>
<h3>What to read</h3>
<p><strong>Fixed-effect coefficients</strong>: same interpretation as OLS. <strong>ICC</strong>: ratio of
between-subject variance to total — tells you how much of the variation is "who you
are" vs "what we did to you". An ICC near 0 means subjects barely differ; near 1 means
the within-subject error is tiny.</p>
<p>Try it: <a data-nav-kind="mixed_effects">Mixed-effects (LMM)</a>.</p>
`},

  { id: 'random-forest', title: 'Random Forest + permutation importance: which X matters?',
    blurb: 'Non-linear, no-assumption variable ranking before you commit to a parametric model.',
    related: ['hypothesis-deep'],
    html: `
<p>Random Forest doesn't assume linearity, doesn't need scaling, handles missing data,
and produces a <strong>defensible importance ranking</strong> for every predictor. It's
not the model you'd ship for prediction — it's the model you run first to see which
inputs are doing real work.</p>
<h3>Two importances</h3>
<ul>
  <li><strong>Impurity importance</strong>: how much each predictor reduces tree-impurity
      when it's used as a split. Fast but biased toward high-cardinality features.</li>
  <li><strong>Permutation importance</strong>: shuffle one predictor at a time and measure
      the drop in OOB performance. Slower but honest. <strong>Use this one</strong>.</li>
</ul>
<h3>When to use it</h3>
<ul>
  <li>You have many candidate X's and want to rank them before regression.</li>
  <li>You suspect interactions or non-linear effects.</li>
  <li>You want a defensible feature-importance story.</li>
</ul>
<h3>The OOB metric</h3>
<p><strong>OOB R²</strong> (for regression) or <strong>OOB accuracy</strong> (for classification) is
out-of-bag — each tree is scored on the rows it didn't train on. Equivalent to
cross-validation, but free. Higher = better.</p>
<p>Try it: <a data-nav-kind="regression" data-nav-inner="random_forest" data-nav-inner-param="method">Random Forest</a>.</p>
`},

  { id: 'agreement', title: 'Attribute Agreement Analysis (Kappa)',
    blurb: 'MSA for pass/fail gages. The κ value tells you whether your inspectors can agree.',
    related: ['msa-deep'],
    html: `
<p>GR&R is for continuous measurements. When inspectors classify (Pass/Fail, OK/Marginal/Bad),
you need <strong>Attribute Agreement Analysis</strong>. Three questions:</p>
<ol>
  <li><strong>Within-appraiser repeatability</strong> — does each inspector agree with themselves on a re-look?</li>
  <li><strong>Between-appraiser agreement</strong> — do inspectors agree with each other?</li>
  <li><strong>Vs standard</strong> — do they agree with the known-good answer (when you have one)?</li>
</ol>
<h3>Kappa (κ)</h3>
<p>Cohen's κ for 2 appraisers, Fleiss' κ for ≥ 3. Both correct for agreement-by-chance.
Read with the <strong>Landis-Koch table</strong>:</p>
<ul>
  <li>&lt; 0.2: slight — the gage is essentially random.</li>
  <li>0.2 – 0.4: fair — needs work.</li>
  <li>0.4 – 0.6: moderate — usable for screening.</li>
  <li>0.6 – 0.8: substantial — production-ready for most uses.</li>
  <li>&gt; 0.8: almost perfect — gold standard.</li>
</ul>
<p>Try it: <a data-nav-kind="agreement">Attribute Agreement Analysis</a>.</p>
`},

  { id: 'cost-pareto', title: 'Cost-weighted Pareto: the 80/20 trap',
    blurb: 'Why the most-frequent defect is rarely the most expensive one.',
    related: [],
    html: `
<p>Standard Pareto charts rank defects by count. <strong>Cost-weighted Pareto</strong> ranks them
by total dollars (count × unit cost), then shows both views side by side.</p>
<p>The trap: a "scratch" might be the most common defect but cost $1 to rework. A "leak" might
appear 5 times in a thousand units but cost $250 each. If you chase the frequency leader, you
fix the cheap problem and leave $1,250 on the table.</p>
<p>Bench flags the disagreement at the top of the chart so you don't miss it.</p>
<p>Try it: <a data-nav-kind="cost_pareto">Cost-weighted Pareto</a>.</p>
`},

  { id: 'pre-flight', title: 'Pre-flight: catch the wrong-test mistake before you run it',
    blurb: 'Bench checks Shapiro, Levene, sample size, and Cochran rules — then recommends.',
    related: ['pick-test', 'hypothesis-deep'],
    html: `
<p>Click <strong>✓ Check assumptions</strong> on the analyse form before <strong>Run</strong>.
Pre-flight runs all the checks your test silently assumes and gives you a traffic-light
verdict + a recommended switch when something fails.</p>
<h3>What it checks per test</h3>
<ul>
  <li><strong>One-sample t</strong>: n ≥ 8, normality, outliers.</li>
  <li><strong>Two-sample t</strong>: per-group normality, Levene's equal-variance test. Fails normality → Mann-Whitney; fails Levene → Welch.</li>
  <li><strong>Paired t</strong>: normality of differences.</li>
  <li><strong>One-way ANOVA</strong>: per-group normality, equal variances.</li>
  <li><strong>Chi-square</strong>: Cochran's rule (expected counts ≥ 5). Violation → Fisher's exact.</li>
  <li><strong>Capability</strong>: AIAG sample size ≥ 30, normality. Non-normal → Box-Cox or Johnson.</li>
  <li><strong>MSA</strong>: AIAG ≥ 10 parts × 3 ops × 2 trials.</li>
  <li><strong>Regression</strong>: n ≥ 10·p, pairwise collinearity ≤ 0.7.</li>
</ul>
<p>If the engine recommends a switch, click "Use recommended" and the form flips
in place with the right params pre-filled.</p>
`},

  { id: 'reproducibility-bundle', title: 'Reproducibility bundles: ship the math, not just the screenshot',
    blurb: 'Export an analysis as a single JSON file that any other Bench instance can re-run byte-for-byte.',
    related: ['reproducibility'],
    html: `
<p>Every analysis card has a <strong>📦 Bundle</strong> button. Click it and Bench downloads a JSON
file containing the dataset (up to 50k rows), the analysis params, the full result, and the
provenance hash quartet (data, params, result, computed_at).</p>
<h3>What it solves</h3>
<p>The hardest question in any quality audit is "can you reproduce this exact number?". Minitab
forces you to also ship the .mpj file <em>and</em> hope the receiver has the same Minitab version.
Bench bundles include everything and are versioned JSON — readable in any text editor for the
next twenty years.</p>
<h3>Re-importing</h3>
<p>POST a bundle to <code>/api/analyses/import</code> on another Bench instance. It re-materialises
the dataset, re-runs the analysis on the receiving sidecar, and reports whether the result
hashes match the bundled ones. Hashes match → the math is reproducible; the chain of custody
is unbroken.</p>
`},
];

// ────────────────── FAQ ──────────────────
//
// Practical Q&A organised by category. Rendered as accordion <details>
// blocks so the page stays scannable.

const FAQ_GROUPS = [
  { category: 'Math & methods', items: [
    { q: 'Why does Bench give a slightly different p-value than Minitab?',
      a: `Both tools implement the same published algorithms, but rounding
          accumulates differently across implementations. Bench typically
          agrees with Minitab to 4–6 decimal places on the standard reference
          datasets. Where they disagree, Bench's source is open — read the
          line and compare to the original publication.` },
    { q: 'Where does the within-subgroup sigma in Cpk come from?',
      a: `For individual observations (no subgroup column), Bench uses the
          AIAG-standard moving-range estimator: σ̂_within = MR̄ / 1.128.
          When you supply a subgroup column, it uses R̄ / d₂(n) instead.
          The overall σ for Pp/Ppk is the ordinary sample standard deviation.
          Both are reported on the result.` },
    { q: 'What\'s the difference between Cp and Pp?',
      a: `Both use the same formula: (USL − LSL) / (6·σ). The difference is
          which σ. Cp uses the within-subgroup σ — short-term, ignoring drift.
          Pp uses the overall σ — long-term, including drift between subgroups.
          A big Cp / Pp gap means the process is drifting between sampling
          windows even if each window looks tight.` },
    { q: 'Why does Cpk differ from Ppk on the same data?',
      a: `Same reason as above — Cpk uses within-subgroup σ, Ppk uses overall σ.
          When they agree closely, your process is stable. When Ppk &lt;&lt; Cpk,
          you have between-subgroup drift even if within-subgroup behaviour is
          fine.` },
    { q: 'How does Bench handle non-normal data for capability?',
      a: `Apply the Box-Cox transform (set transform="box-cox" on the form).
          Bench picks λ automatically by maximum likelihood, reports both raw
          and transformed indices, and translates the spec limits into the
          transformed space.` },
    { q: 'What if my data violates equal variance for a t-test?',
      a: `Bench's 2-sample t default is Welch's t-test (unequal variances).
          For ANOVA, switch to Games-Howell post-hoc when Levene's test flags
          unequal variances. The pre-flight traffic lights show the Levene
          result before you click Run.` },
  ]},
  { category: 'Validation & regulated use', items: [
    { q: 'Is Bench validated for FDA submissions?',
      a: `Bench is not pre-validated as a sealed kit. Methods are open-source
          and citable; per-result method dossiers print algorithm + library
          + citation + reproducibility hashes. Many validation frameworks
          accept this when paired with an internal qualification protocol.
          For pre-authored IQ/OQ/PQ paperwork, contact hello@conyso.com about
          a commercial validation engagement.` },
    { q: 'Can I prove that two runs produced the same result?',
      a: `Yes — every result is bound to a SHA-256 hash quartet (software,
          data, params, result). Re-running the same recipe on the same data
          produces identical hashes. The Dossier button prints them on a one-
          page validation document.` },
    { q: 'How do I diff two runs?',
      a: `Pin both, then click Compare. The comparator highlights any field
          that changed. If software_version differs, you've upgraded; if
          data_hash differs, the data changed; if only result_hash differs,
          you've found a bug — report it.` },
    { q: 'Can Bench run air-gapped?',
      a: `Yes. Docker compose into a closed network. There are no outbound
          license check-ins, telemetry, analytics, or LLM calls. Web fonts
          (Inter / Playfair / Montserrat) are loaded from Google Fonts by
          default but can be replaced with self-hosted woff2 files —
          one-line change in styles.css.` },
  ]},
  { category: 'Deployment & ops', items: [
    { q: 'How do I self-host Bench?',
      a: `<code>docker compose up</code> in the repo root. SQLite + filesystem
          — no Postgres, Redis, or S3 needed. The README has the full setup.
          For Railway / Render / Fly, the single-container Dockerfile at the
          repo root is the supported path.` },
    { q: 'Can I run Bench on Windows?',
      a: `Yes — via Docker Desktop or WSL. Native Windows install isn't
          supported (the sidecar's matplotlib + scipy stack assumes a POSIX
          file layout). For Windows-native users, the hosted version at
          bench.conyso.com requires no install.` },
    { q: "What's the resource footprint?",
      a: `A small Hobby instance handles 10–50 concurrent users. The hot path
          is matplotlib chart rendering (~50ms per analysis). SQLite + WAL
          handles writes for thousands of analyses per workspace before any
          tuning is needed.` },
    { q: 'How do I back up my data?',
      a: `Copy <code>server/data/engine.db</code>. The whole workspace is one
          SQLite file. Charts are PNGs in <code>server/data/</code> alongside
          it. For automated daily backups, schedule a script that tars these
          two paths and ships to your storage of choice.` },
    { q: 'Can my team share a Bench instance?',
      a: `Yes — anyone on the same URL is in the same workspace. There's no
          login (a workspace id is stored in the browser). For multi-tenant
          deployments, put Cloudflare Access or basic-auth in front. For
          team workspaces with per-user attribution, talk to us about the
          enterprise tier.` },
  ]},
  { category: 'Integrations & exports', items: [
    { q: 'Can I import a Minitab .mpj or .mtw file?',
      a: `Not directly — those formats are closed. Export to CSV from Minitab
          (File → Save Worksheet As → CSV). Bench reads CSV, Excel, and PDF
          tables natively.` },
    { q: 'How do I export a result to PowerPoint?',
      a: `Two paths: (1) copy the plain-English interpretation paragraph and
          paste into your deck; (2) click any chart to zoom, then right-click
          → save image. The Dossier (print-to-PDF) is the cleanest single-page
          export.` },
    { q: 'Does Bench have a REST API?',
      a: `Yes — every analysis the UI runs is also a POST. <code>POST
          /api/analyses/run</code> with <code>{kind, datasetId, params}</code>.
          The dispatch table is in <code>server/routes/analyses.js</code>.
          Workspace id goes in the <code>X-Workspace-Id</code> header.` },
    { q: 'Can Bench call a Slack / Teams webhook on a violation?',
      a: `Not built in. You can run an analysis from a cron, parse the result,
          and post to a webhook in ~20 lines of any language. The recipe
          system + REST API are designed for exactly this.` },
  ]},
  { category: 'Comparison & migration', items: [
    { q: 'Should I move my whole team off Minitab?',
      a: `Not necessarily. Bench covers what most Black Belts use ~95% of the
          time. Keep Minitab for any analyses that require validated paperwork
          or for the 5% Bench doesn't cover (e.g. some specialty designs).
          The tools coexist fine.` },
    { q: 'What\'s in Minitab that Bench doesn\'t have?',
      a: `Companion / Workspace (project management with charters, SIPOC,
          VSM, fishbone authoring); a 30-year ecosystem of macros (.MTB / Exec);
          official certification paths; pre-authored validation kits for
          regulated industries. See <a data-nav-guide="migrate">Migrating from
          Minitab</a> for the full map.` },
    { q: 'What\'s in Bench that Minitab doesn\'t have?',
      a: `Per-result reproducibility hashes; printable method dossiers; a
          plain-English query bar; rule-based "what this means" interpretations;
          rule-based action plans; a command palette (⌘K); proper dark mode;
          a REST API; open-source auditable math; air-gapped friendly
          deployment.` },
  ]},
];

// ────────────────── External + internal resources ──────────────────

const RESOURCES = [
  { category: 'Conyso', items: [
    { name: 'Conyso Academy', desc: 'Free Lean Six Sigma curriculum from Conyso. Teaches with Bench from day one.', url: 'https://conyso.com/academy.html' },
    { name: 'Conyso Consulting', desc: 'The Boardroom — premium Lean Six Sigma consulting. Validation packaging, custom deployments, on-call hours.', url: 'https://conyso.com/consulting.html' },
    { name: 'Bill — AI Green Belt', desc: 'Conyso\'s AI assistant for LSS practitioners. Calls Bench under the hood for deterministic math.', url: 'https://conyso.com' },
    { name: 'Bench source code', desc: 'AGPL-3.0. Read the algorithms, fork, contribute. Every method in the Methods page links here.', url: 'https://github.com/conyso/bench' },
  ]},
  { category: 'Standards & authoritative references', items: [
    { name: 'NIST/SEMATECH e-Handbook of Statistical Methods', desc: 'The single best free online reference. Comprehensive, authoritative, no nonsense.', url: 'https://www.itl.nist.gov/div898/handbook/' },
    { name: 'AIAG SPC Reference Manual (2nd ed.)', desc: 'The standard for control charts and capability in automotive and adjacent manufacturing.', url: 'https://www.aiag.org/store/publications/details?ProductCode=SPC-3' },
    { name: 'AIAG MSA Reference Manual (4th ed.)', desc: 'Gauge R&R, bias, linearity, stability — the AIAG framework Bench implements.', url: 'https://www.aiag.org/store/publications/details?ProductCode=MSA-4' },
    { name: 'ISO 16269-6', desc: 'International standard for statistical tolerance intervals.', url: 'https://www.iso.org/standard/57191.html' },
    { name: 'AIAG PPAP (4th ed.)', desc: 'Production Part Approval Process. Bench\'s capability outputs map directly to PPAP submissions.', url: 'https://www.aiag.org/store/publications/details?ProductCode=PPAP' },
  ]},
  { category: 'Books that earn their shelf space', items: [
    { name: 'Douglas C. Montgomery — Introduction to Statistical Quality Control (7e)', desc: 'The textbook for SPC and capability. If you read one book, this is it.', url: 'https://www.wiley.com/en-us/Introduction+to+Statistical+Quality+Control%2C+7th+Edition-p-9781118146811' },
    { name: 'Box, Hunter & Hunter — Statistics for Experimenters (2e)', desc: 'The bible of DOE. Still the clearest explanation of factorial design.', url: 'https://www.wiley.com/en-us/Statistics+for+Experimenters%3A+Design%2C+Innovation%2C+and+Discovery%2C+2nd+Edition-p-9780471718130' },
    { name: 'Meeker & Escobar — Statistical Methods for Reliability Data', desc: 'The standard reference for Weibull, censoring, accelerated life testing.', url: 'https://www.wiley.com/en-us/Statistical+Methods+for+Reliability+Data%2C+2nd+Edition-p-9781118115459' },
    { name: 'Hyndman & Athanasopoulos — Forecasting: Principles and Practice', desc: 'Free online. Best modern intro to time-series forecasting.', url: 'https://otexts.com/fpp3/' },
    { name: 'Jacob Cohen — Statistical Power Analysis for the Behavioral Sciences', desc: 'Where the effect-size conventions (small/medium/large) come from.', url: 'https://www.routledge.com/Statistical-Power-Analysis-for-the-Behavioral-Sciences/Cohen/p/book/9780805802832' },
  ]},
  { category: 'Open-source libraries Bench is built on', items: [
    { name: 'SciPy', desc: 'scipy.stats — the hypothesis tests, distributions, and statistical primitives.', url: 'https://docs.scipy.org/doc/scipy/reference/stats.html' },
    { name: 'statsmodels', desc: 'ANOVA, GLM, ARIMA, mixed models — most of Bench\'s heavyweight stats.', url: 'https://www.statsmodels.org/' },
    { name: 'NumPy', desc: 'Array ops + linear algebra. Powers everything underneath.', url: 'https://numpy.org/' },
    { name: 'pandas', desc: 'Dataframe layer. CSV / Excel parsing, group-by, schemas.', url: 'https://pandas.pydata.org/' },
    { name: 'matplotlib', desc: 'Chart rendering on the sidecar (PNG output).', url: 'https://matplotlib.org/' },
  ]},
];

// ────────────────── Articles ──────────────────
//
// Editorial / opinion / case-study content. Distinct from Guides (which are
// task-oriented walkthroughs). Articles have a date + byline and read like
// essays — longer, sharper voice, no toolbar of runnable links at the bottom.

const ARTICLES = [
  {
    id: 'reproducibility-is-the-new-validation',
    title: 'Reproducibility is the new validation',
    blurb: 'Why a hash quartet on every result is more defensible than a sealed IQ/OQ/PQ kit nobody can re-derive.',
    date: '2026-05-22', byline: 'Conyso Labs',
    tags: ['Regulated', 'Methodology'],
    related: ['reproducibility', 'migrate', 'method-dossier-vs-validation-kit'],
    html: `
<p>Statistical software validation in regulated industries has, for thirty
years, meant the same thing: a vendor publishes an IQ/OQ/PQ paperwork kit,
your firm hires QA, runs the kit against installed software, signs the
forms, and files them. The expectation is that the next auditor accepts
this paperwork at face value. The expectation is that nobody re-derives.</p>

<p>This contract is showing its age.</p>

<p>The contract was viable when statistical tools changed every five years.
It is dangerously stale in a world where every patch may quietly reshape a
p-value. The honest question is: <em>can you prove that the result on your
desk was produced by the algorithm in the paperwork?</em></p>

<h3>What we shipped instead</h3>

<p>Bench binds every result to a four-part SHA-256 hash. Software version.
Data hash. Params hash. Result hash. The hashes are written next to the
numerics on the result card and on the printable dossier. Re-run the same
recipe on the same data and they are bit-identical.</p>

<p>This is a different kind of evidence than the IQ/OQ/PQ kit. The kit
asserts "this version of the software has been qualified." The hash
asserts "this <em>specific run</em> produced this <em>specific output</em>,
and we can prove it." The first is paperwork. The second is mathematics.</p>

<h3>Why this matters in 2026</h3>

<p>Regulators are moving. FDA's 2023 guidance on AI/ML-based Software as a
Medical Device introduced the concept of a <em>predetermined change control
plan</em> — a framework where software is allowed to evolve provided the
evolution itself is auditable. The same instinct will reach traditional
statistical software within the decade. When it does, the differentiator
will not be who has the prettiest IQ kit. It will be who can show their
software's source, version, and per-result hash.</p>

<p>For now, the practical posture: pair Bench's per-result dossiers with
your firm's existing qualification protocol. The dossier replaces the
"output capture" step many protocols already do informally. The reproducibility
hash makes that capture machine-verifiable.</p>

<p>A sealed kit can be a useful artefact for your auditor today. It is not
a substitute for proof.</p>
`,
  },
  {
    id: 'why-cpk-was-broken',
    title: 'Why most Cpk numbers you\'ve been reading are wrong',
    blurb: 'A subtle implementation choice in nearly every spreadsheet template equates Cp and Pp. The fix is one line of code.',
    date: '2026-05-21', byline: 'Conyso Labs',
    tags: ['Capability', 'Methodology'],
    related: ['capability', 'msa-deep'],
    html: `
<p>Open ten Cpk spreadsheets from ten different manufacturers. In nine of
them, the formula for σ in Cpk is the same as the formula for σ in Ppk —
the sample standard deviation of all observations. AIAG SPC, Chapter 4,
explicitly disagrees. So does Montgomery. So does the Cpk you would
have gotten if you'd run it in Minitab against subgrouped data.</p>

<p>This is not exotic. It is the most-pasted capability template error in
quality engineering.</p>

<h3>The right number</h3>

<p>Cpk uses <em>within-subgroup</em> σ. The intuition: Cpk is the capability
you have <em>between bouts of drift</em>. It tells you whether the process,
during a single stable run, can hit spec. Ppk uses <em>overall</em> σ — total
variability including drift between subgroups. The gap between Cpk and Ppk
is the cost of your drift.</p>

<p>The AIAG-standard estimators:</p>
<ul>
  <li>With subgroups of size n: σ̂_within = R̄ / d₂(n), where R̄ is the mean
      of subgroup ranges and d₂ is a tabulated constant.</li>
  <li>With individuals (no subgroups): σ̂_within = MR̄ / 1.128, where MR̄
      is the mean moving range and 1.128 is d₂(2).</li>
</ul>

<p>Sample σ is used for Pp, Ppk. Never for Cp, Cpk.</p>

<h3>Why the wrong number ships</h3>

<p>The wrong number ships because it is <em>easier</em>. <code>STDEV()</code>
exists in every spreadsheet. The moving-range estimator does not. Quality
engineers paste a template, validate the totals look reasonable, and the
error propagates for years.</p>

<p>The consequence is that organisations chase variance reduction
projects when their problem is centring, or vice versa. A Cpk that equals
Ppk is a Cpk that has been quietly miscalculated. It tells you nothing
about drift — by construction.</p>

<h3>What Bench does now</h3>

<p>As of this commit Bench separates the two estimators. The capability
analysis surfaces both σ_within and σ_overall on every result. The metric
strip shows Cp, Cpk, Pp, Ppk — and they differ when there is drift, as they
should.</p>

<p>If you are migrating from a spreadsheet that gave you a single number,
expect to see a gap appear. The gap was always there. You can finally
see it.</p>
`,
  },
  {
    id: 'method-dossier-vs-validation-kit',
    title: 'The method dossier vs. the validation kit',
    blurb: 'A printable one-page audit trail per result is more useful than a 200-page sealed binder for one version.',
    date: '2026-05-19', byline: 'Conyso Labs',
    tags: ['Regulated', 'Audit'],
    related: ['reproducibility-is-the-new-validation', 'migrate'],
    html: `
<p>Click <em>Dossier</em> on any Bench result. You get one page. Algorithm
name. Library function (<code>scipy.stats.ttest_ind</code> with arguments).
Reference (Welch, 1947). Software version. Data hash, params hash, result
hash. Every parameter that went in. Every numeric that came out.</p>

<p>Print it. File it next to the run. The next auditor reads one page and
can re-derive the result in any environment that has the same SciPy
version.</p>

<h3>What this replaces</h3>

<p>It replaces the "we keep the Minitab outputs in a SharePoint folder"
practice that most regulated firms quietly run. Not the validation kit
itself — but the per-run record-keeping that the kit assumes you have.</p>

<p>The validation kit still has a role. It certifies that the installed
software matches the qualified version. The dossier certifies that this
specific run was produced by that software with those parameters. Both
matter; one is a binder, the other is a hash.</p>

<h3>What we don't pretend</h3>

<p>The dossier is not a regulatory submission. It is a defensible audit
artifact. For a sealed IQ/OQ/PQ submission, Conyso Labs offers commercial
validation authoring — that is a paid engagement, sized for one company,
scoped to one regulatory framework. Most teams will find the dossier
sufficient. The ones that don't will know quickly.</p>
`,
  },
  {
    id: 'open-source-in-regulated-industries',
    title: 'The case for open-source statistical tooling in regulated industries',
    blurb: 'Closed-source statistical software was a defensible default in 1995. In 2026 it is an audit liability.',
    date: '2026-05-15', byline: 'Conyso Labs',
    tags: ['Regulated', 'Open source'],
    related: ['reproducibility-is-the-new-validation', 'migrate'],
    html: `
<p>The orthodoxy says regulated industries need closed-source software
because closed-source can be validated. The orthodoxy is wrong about which
direction validation flows.</p>

<p>An auditor's job is to confirm that the software did what it claimed.
With closed source, "what it did" is asserted by the vendor and accepted on
trust plus paperwork. With open source, "what it did" is a property
inspectable directly. Both can be validated. Only one can be re-derived.</p>

<h3>Three concrete cases where open beats closed</h3>

<ol>
  <li><strong>A regulator asks how an outlier-flagging algorithm works.</strong>
      With Bench, the algorithm is 50 lines of NumPy and a citation. With a
      closed tool, the answer is "vendor documentation" — which may or may
      not match the binary.</li>
  <li><strong>A customer asks for a custom test variant.</strong> With
      Bench, fork the function. With a closed tool, file a feature request
      with the vendor's product team and wait two years.</li>
  <li><strong>A bug is found.</strong> With Bench, patch it and file a PR.
      With a closed tool, hope the vendor agrees it's a bug and schedules
      a hotfix.</li>
</ol>

<p>None of these are theoretical. All three happen in pharma, automotive,
and aerospace every quarter.</p>

<h3>The remaining argument</h3>

<p>The strongest argument for closed-source in regulated industries is:
"we want one throat to choke if something goes wrong." This is real, and
it is what Conyso Labs sells: commercial support, validation authoring,
on-call hours, SLAs. The throat is available. The code is also available.
You don't have to pick.</p>
`,
  },
  {
    id: 'when-desirability-is-wrong',
    title: 'When multi-response desirability is the wrong tool',
    blurb: 'Derringer-Suich is the default. It is not always the answer.',
    date: '2026-05-11', byline: 'Conyso Labs',
    tags: ['DOE', 'Methodology'],
    related: ['doe', 'capability'],
    html: `
<p>Derringer-Suich desirability is what most DOE tools reach for when you
have multiple responses to optimise. It is convenient, well-published, and
the default in Minitab and Bench. It is also a specific philosophical
choice, and worth knowing the alternatives.</p>

<h3>What desirability assumes</h3>

<p>Desirability collapses every response into a [0, 1] score, then takes
the geometric mean weighted by importance. The geometric mean penalises
zeros heavily — if one response misses its constraint, overall D is zero
regardless of how good the others are. This is desirability's main feature:
all constraints must be (somewhat) met.</p>

<p>Three assumptions hide in this:</p>
<ol>
  <li><strong>The shape of d_i is right.</strong> Linear by default. You can
      crank the weight to make d_i drop faster near a bound — but the choice
      is a knob, not a number that comes from the physics.</li>
  <li><strong>Importance weights are commensurable.</strong> Saying yield is
      "5" and cost is "3" is a judgment call that the optimiser then treats
      as a mathematical fact.</li>
  <li><strong>Zero on one response = zero overall.</strong> Hard constraints
      are encoded by setting that response's low bound. There is no
      "we'd really like this but could live without" register.</li>
</ol>

<h3>When to reach for something else</h3>

<ul>
  <li><strong>Pareto fronts.</strong> If you cannot pre-rank responses,
      enumerate the trade-off curve and let a human pick. Bench doesn't
      ship this yet; the desirability optimum is one point on the front.</li>
  <li><strong>Goal programming.</strong> When you have a hard target and a
      cost function for deviation in either direction. Closer to engineering
      tolerance reasoning than desirability.</li>
  <li><strong>Constrained optimisation.</strong> When some responses are
      hard constraints and only one is to be maximised. Don't pretend the
      hard constraints are soft via desirability — use a real solver.</li>
</ul>

<p>Desirability is a good default. It is not the only path.</p>
`,
  },
  {
    id: 'hsu-mcb-vs-tukey',
    title: 'Hsu MCB vs. Tukey HSD: pick what you actually need',
    blurb: 'Tukey tells you who differs. Hsu MCB tells you who could be best. These are different questions.',
    date: '2026-05-06', byline: 'Conyso Labs',
    tags: ['Methodology', 'Hypothesis testing'],
    related: ['hypothesis-deep', 'pick-test'],
    html: `
<p>You ran a one-way ANOVA across k groups. The p-value is small. Now you
want a follow-up. Tukey HSD is what every textbook reaches for. It tells
you which pairs of groups have statistically distinguishable means.</p>

<p>That is rarely the question you actually need to answer.</p>

<h3>What you usually want</h3>

<p>"Which supplier is the best?" "Which machine produces the highest yield?"
"Which combination is the lowest cost?" These are <em>identify the
extremum</em> questions. Tukey HSD answers them only indirectly: it gives
you a matrix of pairwise differences and you eyeball which group has the
highest mean that isn't statistically beaten.</p>

<p>Hsu's Multiple Comparisons with the Best (MCB, 1984) answers the question
directly. For each group it computes a one-sided simultaneous confidence
interval on the difference from "the best of the others." Groups whose CI
contains zero are still candidates for "the best." Groups whose CI excludes
zero are not.</p>

<p>The output is short: a list of groups that remain candidates for being
the best. That list might have one element (clear winner). It might have
three (a tie). Either way, it is the answer.</p>

<h3>When Tukey still wins</h3>

<ul>
  <li>You care about the full pairwise structure, not just the extremum.</li>
  <li>The grouping variable isn't ordinal and "best" doesn't apply
      (different colours of a paint, different days of the week).</li>
  <li>You're publishing a paper and a reviewer is going to ask for the
      pairwise matrix anyway.</li>
</ul>

<h3>How to think about it</h3>

<p>Ask yourself: <em>am I trying to find the best one</em> (Hsu MCB) <em>or
the full structure of who differs from whom</em> (Tukey)? Most industrial
decisions are the first. Most published papers report the second. Bench
ships both; the decision is yours.</p>
`,
  },
];

function GuidesView() {
  const root = h('div');
  root.append(h('div', { className: 'breadcrumb' }, 'Learn · Guides'));
  if (!state._guideId) {
    root.append(h('h2', {}, 'Guides',
      h('span', { className: 'muted' }, ' · short walkthroughs for the common workflows')));
    const grid = h('div', { className: 'tool-index', style: 'margin-top:18px' });
    for (const g of GUIDES) {
      grid.append(h('a', {
        className: 'tool-card', href: '#',
        onclick: (e) => { e.preventDefault(); state._guideId = g.id; render(); },
      },
        h('div', { className: 'tool-eyebrow' }, 'Guide'),
        h('div', { className: 'tool-title' }, g.title),
        h('div', { className: 'tool-desc' }, g.blurb),
        h('div', { className: 'tool-go' }, 'Read →'),
      ));
    }
    root.append(grid);
    return root;
  }
  const g = GUIDES.find(x => x.id === state._guideId);
  if (!g) {
    state._guideId = null; render(); return root;
  }
  // Build a previous/next pair so reading order is natural.
  const i = GUIDES.findIndex(x => x.id === g.id);
  const prev = i > 0 ? GUIDES[i - 1] : null;
  const next = i < GUIDES.length - 1 ? GUIDES[i + 1] : null;
  // "Related" rail derived from the article's `related` field.
  const relatedGuides = (g.related || [])
    .map(id => GUIDES.find(x => x.id === id))
    .filter(Boolean);
  const relatedSection = relatedGuides.length ? h('div', { className: 'guide-related' },
    h('div', { className: 'section-label' }, 'Related'),
    h('div', { className: 'guide-related-list' },
      ...relatedGuides.map(rg => h('a', { href: '#', 'data-nav-guide': rg.id },
        h('span', { className: 'guide-related-title' }, rg.title),
        h('span', { className: 'guide-related-blurb' }, rg.blurb),
      )),
    ),
  ) : null;

  root.append(
    h('div', { className: 'breadcrumb' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); state._guideId = null; render(); },
        style: 'color:var(--muted);text-decoration:none' }, 'Guides'),
      ' · ', g.title),
    h('h2', {}, g.title),
    h('div', { className: 'guide-deck' }, g.blurb),
    h('article', { className: 'guide-body', innerHTML: g.html }),
    relatedSection,
    h('div', { className: 'guide-nav' },
      prev ? h('a', { href: '#', className: 'guide-nav-prev',
        onclick: (e) => { e.preventDefault(); state._guideId = prev.id; render(); window.scrollTo(0, 0); } },
        h('span', { className: 'guide-nav-label' }, '← Previous'),
        h('span', { className: 'guide-nav-title' }, prev.title),
      ) : h('span'),
      next ? h('a', { href: '#', className: 'guide-nav-next',
        onclick: (e) => { e.preventDefault(); state._guideId = next.id; render(); window.scrollTo(0, 0); } },
        h('span', { className: 'guide-nav-label' }, 'Next →'),
        h('span', { className: 'guide-nav-title' }, next.title),
      ) : h('span'),
    ),
  );
  return root;
}

// ────────────────── DMAIC PROJECTS ──────────────────

