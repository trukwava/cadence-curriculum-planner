# Technical design / state model

## Stack and rationale

Single Node 22 server with built-in SQLite (`node:sqlite`), strict TypeScript and an HTML/CSS/TypeScript browser client compiled to plain ES modules. This is purposefully small: no external runtime framework, no worker, no external service, and no LLM. SQLite enables transactional teacher decisions and durable local history. The database module is experimental in the tested Node version; pin it in any future deployment.

## Core entities

- **Term**: school-local date range, IANA timezone, monotonically increasing curriculum revision.
- **Section / MeetingPattern**: recurring weekdays, local start and duration, optional alternate-week parity; section-specific IDs.
- **CalendarException**: closure, holiday, testing, PD, cancellation, partial-day interval, or extra teacher-approved class; `source` indicates seeded or teacher-entered.
- **InstructionalSession**: deterministic ID (`section:date:pattern`), local date/start/end, original and available minutes, non-overlapping available segments, incremental exclusion explanations.
- **Unit / Lesson**: structured instructional content, required flag, minute or full-session length, priority, split/merge permission, prerequisites, source URL.
- **Prerequisite**: directed edges serialized by stable lesson ID. A cycle is a hard error.
- **Anchor**: section/lesson-specific fixed school date; assessment reserves time at the end of an eligible contiguous interval.
- **PlanVersion / Allocation**: immutable accepted snapshot and stable lesson/session identifiers, each allocation storing date, HH:mm and exact minute count. Versions are append-only.
- **Disruption**: unplanned section-local excluded interval and active flag.
- **ReplanProposal**: draft structure containing source version, curriculum revision, strategy, disruption, candidate allocations, moved lesson list, displaced/deferred minutes and feasibility explanations.
- **ManualProposal**: a full candidate snapshot for moving one existing allocation block into a named session/time, with the baseline version and teacher decision recorded. **TeacherDecision**: accept/reject record. **AuditEvent**: timestamped event without full raw payload.

Schema/migrations are implemented in `src/server/db.ts`; SQLite has foreign-key constraints, version uniqueness, constrained booleans and positive stored minute counts. Domain validation occurs again at the server boundary. Display-only records are derived from stored data. Every ID is scoped through the fixed synthetic demo term/section query paths, not accepted as an arbitrary organization.

## Exact scheduling rules

1. Iterate local date-only values by whole calendar days; never calculate sessions by advancing a local midnight timestamp across DST.
2. Generate recurring meeting intervals and explicitly added extra intervals. Reject overlapping multiple sessions on one day to avoid double-booking.
3. Intersect calendar events with session intervals; subtract each blocker from the *remaining* segments. Each blocker reports only newly excluded minutes. Thus duplicated full closures result in `[50, 0]` exclusions, not `[50, 50]`.
4. Topologically sort lesson prerequisites with a stable deterministic order (required lessons before optional when both are ready, then teacher priority and original order). Detect unknown prerequisites and cycles.
5. Reserve fixed assessments as one contiguous block on their specified date, then allocate eligible lessons only after prerequisites. Splittable lessons may span sessions; unsplittable lessons may not. Reject infeasible prerequisites or anchors instead of inventing time.
6. When a disruption is previewed, compute both retain-all and optional-deferral strategies without changing active calendar records. The latter drops optional leaf activities starting from lowest priority, preserving all required durations. A teacher may override the optional deferral set and recalculate.
7. On accept: check proposal source version and curriculum revision, insert active disruption, write new immutable plan snapshot and allocation rows, record decision and audit event **inside one SQLite transaction**. On reject: mark proposal rejected and record decision only.
8. On manual move preview: select a stable allocation ID from the currently accepted version, create a candidate with exactly the same minutes, and validate **all** allocations against current session segments, conflicts, each lesson's duration, dependencies, deferrals and fixed anchors. Persist a draft without modifying the accepted plan. An invalid move is rejected with an explanation.
9. On manual move accept: under an immediate SQLite write transaction, verify the source version and curriculum revision, revalidate the full candidate independently, append a new plan version and record a manual-decision audit. Rejecting only closes the draft. Editing lesson lengths and dropping mandatory blocks are not supported by this path.
10. On restore: reactivate only disruptions in the selected historical snapshot, **revalidate the exact stored allocations** against the reconstructed calendar and present curriculum (do not re-run greedy placement, which would erase teacher adjustments). If all constraints and curriculum revision still match, append a new accepted version. Otherwise roll back restoration.

**Important limit:** The scheduler is deterministic greedy, not complete constraint search. A failure can mean the chosen stable allocation order is infeasible rather than every conceivable rearrangement being impossible. It reports its unsatisfied constraints for review. There is no automatic shortening, merging, override of anchor or permission to ignore a hard requirement.

## API state transitions

- `GET /api/state` — full synthetic term, sessions, lessons, anchors, versions, proposals and audit.
- `POST /api/disruptions/preview` — draft alternatives; accepted state unchanged.
- `POST /api/proposals/:id/accept` — draft → accepted, new version.
- `POST /api/proposals/:id/reject` — draft → rejected, baseline unchanged.
- `POST /api/manual-moves/preview` and `POST /api/manual-moves/:id/accept|reject` — validated teacher-controlled single-block edits.
- `POST /api/restore` — new accepted version of validated historical state.
- `POST /api/baseline` — teacher-requested fresh accepted version only when feasible.
- `POST /api/calendar/exception`, `PATCH /api/term`, `PATCH /api/sections/:id`, `POST /api/units`, `POST /api/lessons`, `PATCH /api/lessons/:id`, `PATCH /api/anchors/:sectionId/:lessonId` — teacher-authored local changes, revision increment.
- `GET /api/export/:sectionId.csv` and `.ics` — accepted plan output only.
- `POST /api/reset` — reseed only demo organization.
- `GET /api/fixture`, `GET /api/health` — isolated fixture / health check.

## Operational boundaries

The demo accepts no imported school documents and makes no production service calls; synthetic content and entered URLs are treated as untrusted display data. Mutating requests require application/json and reject mismatched Origin headers. HTML rendering escapes text, and response headers include a restrictive script CSP and frame denial. Size limits and basic input validation are enforced server-side. This is *not* a substitute for authentication, session management, rate limits or production authorization; the intended interface is loopback only.

Data are retained in `data/demo.sqlite` until reset or manual deletion. No hidden telemetry, emails or background tasks. No automated backup; preserve the DB manually if necessary. Never place secret credentials in browser code.


## v0.4 bounded occupied-slot rearrangements

`src/server/rearrange.ts` performs a deterministic recursive displacement search over local classroom intervals. The teacher-selected placement is locked; up to three additional blocks may be moved. Anchor blocks are immutable and all candidate completed plans pass `validatePlan` before a proposal can be stored or accepted. The planner tests candidate starts on a five-minute grid, limits search to 5,000 nodes and a bounded candidate shortlist, and returns an explicit error if no valid candidate is discovered. This limit prevents claiming global optimality or exhaustive infeasibility.

`POST /api/manual-moves/rearrange` returns a `draft` with a complete `changes` array. The existing transactional `manual_proposals` decision API accepts or rejects the entire rearrangement as one versioned decision, with rollback protection and audit metadata. Re-approval checks the current accepted version, curriculum revision, and the full allocation validator.
