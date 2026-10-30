# Verification report — 2026-10-30 (v0.2)

**Environment:** Node.js v22.16.0; TypeScript 5.8.3; built-in Node `node:sqlite` (experimental); Linux container, no production data or external APIs.

**Command:** `npm run test` (builds strict TypeScript + Node built-in test runner).

**Result:** 25 tests passed, 0 failed. Modules covered: calendar/date calculations, schedule invariants, isolated overlapping-closure fixture, DST date stability, alternate-week and extra-session generation, cyclic and missing prerequisites, fixed anchors, unsplittable activities, capacity bounds, synthetic seed, teacher rejection/acceptance/restore, database reopen persistence, stale revision handling, duplicate partial closure, demo reset including existing proposal decisions, add-unit and session-count duration, validated manual allocation preview/accept/reject, preserved minutes, stale draft rejection, manual-version restore, HTTP static routes/API, preview and CSV/ICS export, cross-origin mutation blocking.

**Manual HTTP smoke check:** Started compiled server on loopback with isolated temp SQLite; received `200` for `/`, `/dist/app.js`, `/api/state`, `/api/export/cte-tt.csv`, `/api/export/cte-tt.ics`. Confirmed synthetic sections at 850/750 usable minutes and 705 assigned minutes per baseline. Preview of Nov 24 10:00–11:15 T/Th class returned infeasible retain-all and feasible optional deferral. The CSV contained named lesson rows and school-local times; ICS included timezone metadata and VEVENT entries.

**Graphical browser test:** Chromium is installed, but automated Playwright navigation to the local HTTP server returned `ERR_BLOCKED_BY_ADMINISTRATOR` in this execution environment. No graphical acceptance run succeeded. Responsive layout and focus styles were implemented in CSS, but no completed cross-browser GUI acceptance test or mobile-device inspection is claimed. Before an external pilot, test the full workflow manually in current Chrome, Firefox and Safari, including keyboard-only form navigation, page reload, exports and the below cases.

**Remaining verification obligations:** Cross-browser iCalendar import semantics (floating times); arbitrary multi-pattern heterogeneous session lengths; high-volume concurrent editing; pathological constraint sets and complete optimization claims; threat model for authentication and authorization; real school calendar reconciliation; automatic recovery from DB corruption; usability observation with teachers. These are intentionally not marked passed.


**v0.2 manual edit verification:** Move an optional 25-minute lesson from Nov 26, 10:35–11:00 to 10:40–11:05 within its session, preview it, and approve it. The accepted version increments and survives a SQLite reopen. CSV and iCalendar exports reflect 10:40–11:05; restoring the earlier and then the moved version preserves the exact accepted allocations. Invalid target sessions, overlapping blocks, changed fixed assessment dates, reversed prerequisites and stale proposals are rejected. A separate HTTP test exercises the preview/accept/export path.

## v0.3 regression — October 30, 2026

- 26 automated tests passed locally using Node 22.16 and TypeScript.
- New regression verifies bounded, read-only candidate suggestions; each returned option can be passed through the existing full-plan manual preview validator.
- Suggestion search checks five-minute increments and rejects stale accepted versions.
- Graphical browser layout and GitHub Actions status were not verified in this run.


## v0.4 regression extension (2026-10-30)

Added a 3-allocation two-overlap pure-engine fixture, a persistent seed-scenario occupied-slot rearrangement, approval/rejection/restore/reload checks, stale-curriculum and fixed-anchor constraints, plus a full HTTP preview-approval-export scenario. Run `npm test` to rebuild the app and execute the complete suite. This check is independent of CI and browser screenshot coverage.

## v0.5 verification — 2026-10-30

- 34 Node tests passed, including weekday labels over DST, invalid school dates, segment-aware drag placement and slot clamping.
- Compiled both browser and server TypeScript successfully.
- HTTP local server health returned `ok: true`, mode `synthetic-demo`.
- Offline Chromium (local state injection due sandbox blocking localhost page navigation) rendered desktop/mobile weekly views, selected lesson and destination with keyboard-friendly buttons, exercised drag into occupied slot, and displayed the teacher-reviewable two-block proposal with accepted/proposed toggle; zero uncaught JavaScript errors.
- Full HTTP browser interaction against a running server remains unverified due browser sandbox restrictions. The localhost HTTP API is tested independently in Node.
