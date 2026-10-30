# Northstar — Curriculum Calendar Recovery and Pacing

Teacher-owned curriculum calendar recovery and pacing.

A **working local-only synthetic demo** for a fictional high-school CTE teacher. It calculates usable instructional minutes and proposes deterministic, reviewable recovery plans after unexpected schedule disruptions. Nothing connects to a real school system. No LLM, credentials, subscription, or paid service is necessary.

## Quick start

Prerequisite: **Node.js 22.13+** (tested on Node 22.16; the built-in `node:sqlite` API is experimental in this Node release).

### Run from a GitHub clone

```bash
git clone https://github.com/trukwava/cadence-curriculum-planner.git
cd cadence-curriculum-planner
npm install
npm run build
npm test
npm start
```

Open **http://127.0.0.1:4173**. On first launch, the application creates `./data/demo.sqlite` and seeds the fictional Northstar CTE organization. The repository tracks source files, not generated builds; run `npm run build` after cloning before using `npm start`.

### Run the separately packaged ZIP

The previously supplied downloadable demo ZIP includes precompiled server and browser JavaScript. From the extracted `curriculum-recovery` directory, run `node dist/server/src/server/server.js` without installing dependencies. If rebuilding in an offline environment, provide TypeScript 5.8+ and Node type definitions.

Optional environment variables are in `.env.example`. Example: `PORT=4180 DB_PATH=./data/my-demo.sqlite npm start`. **Keep HOST set to `127.0.0.1`.** There is no remote-user authentication; do not expose this demo to the public network.

## Primary workflow — 2 minutes

1. Open **Overview**; choose **CTE Lab · T/Th · 75 min** (default). The six-week baseline has 750 available minutes, 705 allocated minutes, and 45 minutes of buffer.
2. Preview a lost **November 24, 2026** class, **10:00–11:15** (the prefilled demo values).
3. Compare **Keep every lesson** (infeasible) with **Defer optional work** (feasible; retains all 640 required minutes). Expand the changed lessons to inspect date movements and available time.
4. Click **Accept plan** on the feasible proposal to create a new accepted version. Or click **Reject** to leave the baseline alone.
5. Inspect **Calendar & capacity** for all sessions, exclusions and allocations, **Plan history** to restore an earlier accepted plan, and download the accepted plan as CSV or `.ics`.
6. Open **Exact fixture** to inspect six 50-minute sessions, overlapping closure records, the 30-minute shortage, and the validated 240-minute required-content recovery.

Try editing a lesson duration under **Curriculum**. This increments the curriculum revision and marks the accepted plan stale rather than silently rewriting its allocations. Use **Regenerate baseline** to produce a new version. **Plan history → Reset synthetic demo** restores the original fictitious scenario.

## Project layout

- `src/shared/domain.ts` — typed domain objects and date/time validation.
- `src/server/calendar.ts` — recurring/alternating meeting generation; overlap-union exclusions; exact capacity.
- `src/server/schedule.ts` — prerequisite sorting, fixed anchors, minute allocations, optional deferral.
- `src/server/db.ts` — SQLite migration, synthetic fixtures, version/teacher-decision transactions, audit, scoped reset.
- `src/server/server.ts` — same-origin local HTTP API, validation, static app, CSV/ICS export.
- `src/client/app.ts` and `public/` — compiled browser interface and CSS; no external runtime dependencies.
- `tests/` — executable rule, persistence, state-transition, and HTTP/export tests.
- `sample-data/` — synthetic example input/output.
- `docs/` — product brief, constraints, pilot protocol, test results.

## Important engineering behavior

- Calendar days and allocation dates are **YYYY-MM-DD school-local dates**, never UTC instants; class start/end are explicit local HH:mm fields. Sessions crossing midnight are not supported.
- Two overlapping closures on the same time interval remove those minutes **once**, and the second record reports `0m` additional exclusion. Partial-day intervals are unioned accurately.
- Non-splittable lessons need a contiguous block in one meeting; splittable lessons may occupy multiple meeting segments. Session-count lessons use the original duration of the section's **first recurring meeting pattern**. They are not shortened by partial closures.
- A deterministic topological ordering detects missing and cyclic prerequisites. Fixed assessments reserve time on the specified local date. Required lesson durations are never compressed. If the greedy scheduler cannot fit a constraint, it explicitly reports infeasibility; this is **not a globally optimal mathematical scheduling solver**.
- Every preview is an unaccepted draft. Only teacher acceptance activates a disruption and creates a version. Rejection leaves accepted allocations unchanged. Changes to curriculum or calendar increment a revision and make previous versions stale; restoring historical versions with a different curriculum revision is blocked.
- CSV contains a local date and time and explicit school timezone. ICS uses **floating local wall-clock times** plus `X-WR-TIMEZONE`; some calendar clients interpret floating times in the importing device's timezone. Verify recipient calendar behavior before using exported `.ics` operationally.
- The local database persists edits between page reloads and server restarts. Demo reset deletes/reseeds only the demo organization. Back up `data/demo.sqlite` if you want to preserve edits. SQLite migration is automatic; database retention is until manual deletion or reset.

## Safety, trust and scope

- This is **not production-ready**. The API is restricted to a fixed fictional demo organization and loopback networking; it does not provide sign-in, multi-tenant identity controls, school records integration, student data processing, or regulatory compliance certification.
- Server-side validation enforces bounded inputs, required session intervals, approved HTTP(S) resource URLs and many scheduler invariants. HTML text is escaped when rendered. The browser never receives secrets and the app makes no external requests.
- User-supplied text is data only; it is never executed as a command or passed to a model. There is no LLM workflow.
- Explicit pilot data should be anonymized and require authorization before import. This demo intentionally has no private production connectors.

## Limitations / next iteration

- No drag-and-drop adjustment of individual lesson allocation intervals. Teachers can revise optional deferral choices, edit lesson requirements or anchors, and regenerate proposals.
- Merge permission is represented in lesson data but **automatic lesson merging is not implemented**. The scheduler supports split permission and explicit added buffer sessions.
- No direct Google/Outlook calendar synchronization or production SIS/LMS integration. ICS floating times may need an interoperable VTIMEZONE implementation for a real deployment.
- No user authentication, permissions, automated backups, or real-customer integration. No multi-pattern session-count disambiguation beyond the first recurring pattern.
- The included tests cover deterministic core and HTTP routes; a graphical end-to-end browser run was attempted but could not be completed reliably in this runtime. See `docs/TEST_RESULTS.md`.

See `docs/PRODUCT_BRIEF.md`, `docs/ARCHITECTURE.md`, `docs/PILOT_PLAN.md`, and `docs/TEST_RESULTS.md`.
