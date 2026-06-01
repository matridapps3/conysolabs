# Front-end structure (MVC)

The former 10.5k-line `app.js` is split into focused files. **No build step** —
these load as plain `<script>` tags (see `index.html`) sharing top-level `const`
globals by load order. The load order preserves the original sequence, so the
concatenation is byte-identical to the old `app.js` (behavior unchanged).

```
js/
  core.js              kernel: h()/$ DOM factory, api client, state + persistence,
                       workspace bootstrap, render(), ⌘K palette, toast   (model+controller+view kernel)
  model/
    kinds.js           ANALYSIS_KINDS, ANALYSIS_FAMILIES, METHODS_INDEX, family rail
  view/
    shell.js           renderHeader, renderSidebar (two-rail nav)
    views-home.js      VIEW_REGISTRY, Articles/FAQ/Resources/Guides + their content data
    views-projects.js  Projects, DMAIC Copilot, A3, Reports, report editor, Feedback
    views-explore.js   Explore, Dashboard, Pipelines, Insights, Methods, modals
    views-learn.js     Catalog, Learning Paths, Validation, Graph Builder, Worksheet, Data
    views-analyze.js   AnalyzeView/Form/List, result card, analyze-side calculators
    views-tools.js     Tools + calculators, Recipes, boot()  (loads last → init runs here)
    stats-ux.js        interpreters, SVG charts, helpers (was stats_engine_ux.js)
  controller/
    tour.js            guided-tour state machine
    routing.js         navigate(), icons, cross-link maps, humanize
```

This is a **regional** split (faithful, zero-risk): files are grouped by area
and the load order matches the original exactly. A few files mix layers (e.g.
view files carry their own content data) because the original interleaved them;
fully-pure model/view/controller layering would require reordering, deferred
until a front-end test harness exists.
