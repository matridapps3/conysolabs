# Conyso Bench — minimal MVC restructure (design)

Date: 2026-05-31 · Status: approved (pure code-move, behavior-preserving)

## Goal
Divide the codebase into a clear MVC structure. The front-end SPA is the only
true monolith (`app.js`, 10.5k lines); the Node server and Python sidecar are
already layered, so they get a documented mapping rather than risky renames.

## Hard constraints
- **No build step.** Front-end loads as plain `<script>` tags sharing top-level
  `const` globals by load order. Keep it that way (load-bearing for the
  single-container deploy). No ES modules, no bundler.
- **Zero behavior change.** Strict relocation of code; identical runtime.
- **No front-end tests exist** → verification is `node --check` per file +
  concatenated-bundle `node --check` + a real browser boot/click-through +
  re-running all backend suites (must stay 383 sidecar / 69 node / 6 monitor).

## Front-end target (`server/public/js/`)
Ordered `<script>` load: model → view → controller → boot (boot last; it is the
only file with top-level side effects).

```
model/
  state.js     state object, localStorage persistence, workspace bootstrap, seedDemo
  api.js       api.get/post/patch/delete, refreshData, download helpers
  kinds.js     ANALYSIS_KINDS, ANALYSIS_FAMILIES, TOOLS_INDEX, KIND_LABEL,
               KIND_TO_GUIDE, KIND_TO_METHOD_ANCHOR, FAMILY_BLURB,
               CATALOG_PLATFORM, INSIGHTS_LIST
  content.js   GUIDES, ARTICLES, FAQ_GROUPS, RESOURCES, LEARNING_PATHS,
               TOUR_ALL, METHODS registry, KIND_TO_GUIDE-style content maps
view/
  dom.js       $, h(), icon(), ICON_PATHS, humanize, skeleton, toast
  shell.js     renderHeader, renderSidebar (two-rail)
  result.js    renderAnalysisCard, renderSummaryFallback
  views-analyze.js   AnalyzeView/Form/List
  views-data.js      data, worksheet, graph builder, pipelines, recipes, insights, dashboard
  views-tools.js     ToolsView + all calculators
  views-projects.js  projects, project, copilot, reports
  views-learn.js     catalog, learning paths, guides, articles, faq, resources, validation, methods, feedback
  stats-ux.js  (renamed from stats_engine_ux.js — interpreters, charts, helpers)
controller/
  router.js    VIEW_REGISTRY, render(), navigate(), scroll preservation, ⌘K palette
  tour.js      tour state machine
  boot.js      init + global event listeners + first render  ← LOADS LAST
```

### Why this is safe
Nearly all cross-file references live *inside function bodies* (resolved at
call-time, after every script has loaded). `VIEW_REGISTRY` already wraps views
in arrows (`data: () => DataView()`). The only ordering hazards are top-level
`const X = <expr using another top-level const>`; those co-dependent
declarations are kept in the same file / correct order. Function declarations
are hoisted and order-independent.

### Method
Carve `app.js` top-to-bottom at top-level declaration boundaries into the files
above (exact bytes preserved), then order the `<script>` tags model→view→
controller→boot. Detect and respect any eager top-level cross-references.

## Server (`server/`) — documented mapping only
`routes/*` = controllers, `lib/*` = models/services, `public/*` = view. Add
`server/ARCHITECTURE.md` + brief header comments. No directory renames (would
break imports across 8 routes + 69 tests for cosmetic gain).

## Sidecar (`sidecar/`) — documented mapping only
`app.py` = controller (HTTP routing + (de)serialization view boundary),
`stats/*` = models/services. Add a mapping note. No churn to the 383 tested
modules.

## Verification gates (run after each front-end stage)
1. `node --check` each new file.
2. Concatenate all FE scripts in load order → `node --check` the bundle.
3. Boot the SPA in the browser; click Analyze (run one), Tools, Projects,
   Learn, Catalog, ⌘K, the tour. Confirm no console errors.
4. `pytest` (383) · `npm test` (69) · monitor `node --test` (6) stay green.

## Out of scope
ES modules, bundler, server/sidecar physical renames, behavior changes, dead-code
removal (the 6 stale stats-ux functions stay; separate task).

(Note: repo has no git, so the spec is saved but not committed.)
