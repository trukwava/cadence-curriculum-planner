# Verification report — 2026-10-29

**Environment:** Node.js v22.16.0; TypeScript 5.8.3; built-in Node `node:sqlite` (experimental); Linux container, no production data or external APIs.

**Command:** `npm run test` (builds strict TypeScript + Node built-in test runner).

**Result:** 20 tests passed, 0 failed. Modules covered: calendar/date calculations, schedule invariants, isolated overlapping-closure fixture, DST date stability, alternate-week and extra-session generation, cyclic and missing prerequisites, fixed anchors, unsplittable activities, capacity bounds, synthetic seed, teacher rejection/acceptance/restore, database reopen persistence, stale revision handling, duplicate partial closure, demo reset, add-unit and session-count duration, HTTP static routes/API, preview and CSV/ICS export, cross-origin mutation blocking.

**Manual HTTP smoke check:** Started compiled server on loopback with isolated temp SQLite; received `200` for `/`, `/dist/app.js`, `/api/state`, `/api/export/cte-tt.csv`, `/api/export/cte-tt.ics`. Confirmed synthetic sections at 850/750 usable minutes and 705 assigned minutes per baseline. Preview of Nov 24 10:00–11:15 T/Th class returned infeasible retain-all and feasible optional deferral. The CSV contained named lesson rows and school-local times; ICS included timezone metadata and VEVENT entries.

**Graphical browser test:** Chromium is installed but a headless screenshot run timed out in this container. Responsive layout and focus styles were implemented in CSS, but no completed cross-browser GUI acceptance test or mobile-device inspection is claimed. Before an external pilot, test the full workflow manually in current Chrome, Firefox and Safari, including keyboard-only form navigation, page reload, exports and the below cases.

**Remaining verification obligations:** Cross-browser iCalendar import semantics (floating times); arbitrary multi-pattern heterogeneous session lengths; high-volume concurrent editing; pathological constraint sets and complete optimization claims; threat model for authentication and authorization; real school calendar reconciliation; automatic recovery from DB corruption; usability observation with teachers. These are intentionally not marked passed.
