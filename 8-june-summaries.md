# Summaries — 8 June 2026

## Enforced workspace data isolation

**What was done**

Before this fix, anyone using the app could reach another person's data if they knew its id. They could open, change, or delete datasets, analyses, projects, and reports that were not theirs. This is now closed. Each item can only be opened, edited, or deleted by the workspace that created it. Everyone still sees and uses their own work exactly as before, but no one can reach across into someone else's data anymore.

**How it was done**

Every saved item already carried a label saying which workspace it belonged to, but the routes that fetch a single item by its id were not checking that label. They matched only on the item id, so any id could be used to reach any item. The fix reads the caller's workspace id, which the app already sends along with every request, and adds it to each of those lookups so an item only matches when it belongs to the caller. This was applied to the open, edit, delete, and related actions across analyses, projects, reports, and datasets. A user's own requests carry their id so their access is unchanged, and only other workspaces are blocked. The read only pages that open through plain browser links were left as they were to avoid breaking them.

**Files affected**

server/routes/analyses.js, the by-id routes for fetch, delete, lock, annotation, and recipe.

server/routes/projects.js, the by-id routes for fetch, edit, delete, attach, detach, and recommend.

server/routes/reports.js, the by-id routes for fetch, edit, delete, link, unlink, and duplicate.

server/routes/datasets.js, the by-id routes for fetch, preview, and rows.

---

## Fixed the broken analysis import and export

**What was done**

The feature that lets you export an analysis as a portable bundle and import it back was broken. Importing failed every single time, and the exported bundles were missing their verification information. Both are now fixed. You can import a bundle without it erroring, and the export now carries the correct provenance details so the round trip works properly.

**How it was done**

The import was trying to save into three database columns that do not exist in the table, so the save always threw an error and the whole import failed. The fix removes those three columns from the save and instead keeps the provenance details inside the existing results field where they belong. The export side had the matching problem, reading from those same missing columns, so it always returned empty verification values. That was changed to read the provenance from the results field as well. Together this makes the export and import line up, so a bundle made on one instance imports cleanly into another with its history intact.

**Files affected**

server/routes/analyses.js, the import handler around lines 397 to 415 and the bundle export handler around lines 439 to 470.

---

## Fixed the calculator card styling

**What was done**

The calculator cards on the tools page were showing their text as blue underlined links, which looked like raw web links and clashed with the clean look of the rest of the app. This is now fixed. The cards display as proper editorial tiles with the normal theme colours, the gold label, the dark title, and no stray underlines, and they look correct in both light and dark mode.

**How it was done**

Each calculator card is built as a link element, and a link by default carries the browser styling of blue text with an underline. The card styling never turned that off, so it leaked through onto everything inside the card. The fix adds two small style rules to the card so it stops using the default link colour and removes the underline. The colours that were already defined for the label, title, and description then show through as intended. The change is limited to the calculator cards only, so nothing else in the app is affected, and the click behaviour and layout stay exactly the same.

**Files affected**

server/public/styles.css, the calculator card rule around lines 2286 to 2297.
