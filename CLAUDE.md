# Better TSS

A Chrome extension (Manifest V3) that brings **WebReg-style manual schedule planning** back to
UCSD's new registration system, **TSS** (Triton Student System, SAP Fiori at `tss.ucsd.edu/fiori`).
Planning-focused: search courses, build a weekly schedule, catch conflicts. Booking stays in TSS.

## Background / vision
WebReg let you plan a schedule yourself, then click "enroll" when your window opened. TSS replaces
that with TritonGPT-driven planning and a separate booking step. This extension restores autonomous
planning by reading the same data TSS's own UI uses, and overlays a planner on the page.

## Status — working
Loads as an unpacked extension; `npm run build` is green (TypeScript strict, no runtime deps).
Not yet exhaustively tested against a live TSS session.

- **Data layer** — reverse-engineered TSS's custom OData v4 service (`yucsd_con_module_sb`). See
  [RECON.md](RECON.md). `TssClient` does the CSRF handshake + `$batch` reads for search and sections.
- **Search** — debounced full-text search; loose codes auto-normalize (`CHEM 7L` → `CHEM-007L`);
  a single result auto-loads its sections.
- **Sections browser** — seats / capacity dot / waitlist / meeting details; flags time conflicts
  with already-planned courses, naming the specific part (e.g. "Time conflict with CSE-103 Discussion").
- **Planner UI** — self-contained Shadow-DOM overlay (never depends on Fiori markup), opened via a
  floating 📅 button or the toolbar icon. Full-screen drawer; two-column layout. WebReg-style tabs:
  - **Calendar** — weekly grid with detailed blocks (time, course, part+location, instructor),
    per-block conflict highlighting, side-by-side lanes for overlaps, a per-course Drop (confirm),
    unit totals, a method legend, and an "Exams (not on grid)" note for dated one-offs (midterms).
  - **List** — WebReg-style table incl. exam rows (FI/MI/EX), per-course Drop.
  - **Finals** — full finals-week grid (Sat–Fri) plus a TBA list.
  - A shared conflict list ("Conflict: A & B") tops the Calendar and List tabs.
- **Saved plans** — multiple named plans (create/rename/delete/switch) persisted in
  `chrome.storage.local`.

## Architecture
```
src/api/       TssClient (tss.ts), normalized types (types.ts),
               Sched-string parser (sched.ts, strict day extraction),
               course-code normalizer (courseCode.ts)
src/model/     plan.ts (Plan/PlannedSection/PlanStore contract),
               schedule.ts (time/conflict utils), planOps.ts (grouping,
               dropCourse, finals/exam parsing, conflictPairs)
src/storage/   planStore.ts (chrome.storage-backed PlanStore),
               cache.ts (CachedTss — built, NOT yet wired in)
src/ui/        panel.ts (shell + tabs + AppContext + style injection),
               calendar.ts / list.ts / finals.ts / sections.ts / search.ts /
               term.ts / plans.ts / conflicts.ts, dom.ts, styles.ts, util.ts
src/content/   mounts the panel; toolbar-icon → toggle message listener
src/background/ service worker; action.onClicked forwards a toggle
public/manifest.json  MV3
```

Data flow: content script runs on `tss.ucsd.edu` with the user's session → `TssClient` makes
credentialed same-origin OData calls → normalized into `Course/Section/Meeting` → planner UI +
`PlanStore`. We never handle credentials; the browser's login cookies are reused automatically.

## Conventions
- **Vanilla TS + DOM only** — no framework, no runtime dependencies.
- **Frozen contracts**: `src/model/plan.ts` and `src/model/schedule.ts` are shared interfaces —
  change them deliberately (multiple consumers, some built by parallel agents).
- **Styling**: each view exports a `*_STYLES` string; `panel.ts` injects them all into the shadow
  root. Don't scatter styles into the page. CSS classes are `tsh-*`; storage keys are `tsshook:*`
  (internal names kept despite the Better TSS rename).
- `tsc` is strict with `verbatimModuleSyntax` + `noUnusedLocals` — use `import type` for types.

## Build & load
```
npm install
npm run build          # tsc --noEmit && vite build → dist/
```
Then: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`. Open a
`tss.ucsd.edu` tab; click the 📅 Planner button (bottom-right) or the toolbar icon. After code
changes, reload the extension AND refresh the TSS tab.

## Roadmap / known gaps
- **Booking** — not implemented (planning only, by design). The captured HAR only covers browsing;
  a second HAR of a real book/waitlist click is needed to map the write request. Until then,
  "assisted booking" = deep-link into TSS's own booking flow.
- **`CachedTss` is unwired** — the UI calls `TssClient` directly. Wiring needs a small
  `CourseSource` interface (the two aren't structurally interchangeable — `TssClient` has private
  fields).
- **Conflict list** covers weekly-vs-weekly and exam-vs-weekly, not exam-vs-exam.
- **Finals columns** are weekday-keyed; a true two-Saturday span would require date-based columns.
- **Live testing** — verify the `Sched` parser against more real formats (labs, multi-line, TBA).
- **Directory rename** to `Better-TSS` is pending (folder was locked; rename it with the IDE closed).
