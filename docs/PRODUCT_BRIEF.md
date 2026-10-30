# Product brief — Northstar Curriculum Recovery v0.1

**Problem:** Teachers often plan units against the nominal school calendar rather than the actual class minutes remaining. Holidays, testing, professional development and unexpected cancellations change feasibility, and recovery tradeoffs can be difficult to inspect.

**Primary persona:** A fictional high-school career and technical education teacher with an M/W/F 50-minute studio section and a T/Th 75-minute lab section.

**Narrow promise:** Calculate time actually available and offer deterministic, teacher-reviewed replans after a lost period, with honest explanation of what moves, what is deferred, and what cannot fit.

**Demo assumptions:** A synthetic six-week term (2026-10-19 to 2026-11-29, America/New_York), three units, eighteen lessons, two holidays, a testing day, section-specific fixed assessment anchors, and intentionally sparse buffer. No student information, claims about actual school calendars, or production data integrations.

**Smallest complete workflow:** select a section → inspect instructional capacity → preview a whole/partial lost session → inspect retain-all vs optional-deferral proposals → accept or reject → observe persisted plan version and audit → export calendar.

**Primary technical risk:** Actual class time can be double-subtracted or moved across a school date by incorrect timezone arithmetic. Mitigation: pure local-date iteration, unioned exclusion intervals, minute-precise scheduling and targeted regression fixtures. The synthetic demo avoids needing any school calendar credentials.

## Scope versus status

| P0 behavior | Current implementation |
|---|---|
| Term, timezone, section, recurring/alternating pattern | Editable, stored locally |
| Extra classes, cancelled classes, holiday/testing/PD and partial closures | Teacher-created calendar events; full/partial intervals |
| Inspect instructional sessions, minutes, explanations | Full session table with allocation and incremental exclusions |
| Units and lessons, durations in minutes or sessions | Create units/lessons; edit requirements; session length follows first recurring pattern |
| Prerequisites, required/optional, split/merge permission, priority | Editable; split enforced; merge recorded but not executed |
| Fixed assessment dates | Section-specific editable anchors; changing one is an explicit teacher override |
| Baseline, shortage, cycle and constraint diagnostics | Deterministic scheduling; explicit failures, no invented minutes |
| Disruption and recovery strategies | Preview retain-all vs optional deferral; manual list of optional lessons to defer |
| Before/after comparison | Moved lesson list, dates, affected minutes, deferred content, remaining time |
| Teacher decisions | Draft / accepted / rejected; transactionally versioned + audit |
| Persistence, restore and export | Local SQLite, version restore, CSV and `.ics` floating times |
| Approval of arbitrary manually dragged placements | Not implemented; edit constraints and regenerate instead |

**Deliberate parking lot:** student personalization, IEP or grading data, SIS/LMS/Drive/Outlook API connectors, automated standards mapping, full lesson generation, multi-teacher roles, production identity and authorization, complex global optimization, real-time calendar sync, analytics of actual customer time savings.

## Exact isolated regression

Six available 50-minute meetings = 300 nominal minutes. Two closure records cancel the *same* session, leaving 250 usable (not 200). Required work = 240, optional = 40: 280 desired, a 30-minute shortage. Deferring only optional work yields 240 allocated and 10 unused; both required lessons retain 120 minutes. An independent prerequisite-cycle fixture is also tested. Dates across 2026-11-01 remain stable.

## Why this is not marketed as AI

A deterministic engine owns calendar math, prerequisite validation and eligibility; no generative model is used. The teacher's discretionary tradeoffs remain under teacher control. An eventual text-assistance component could summarize code-computed results but may not approve changes.

## Source and provenance

The user supplied a reference to the Pursuit Lookbook profile of Rida Khan: https://lookbook.pursuit.org/people/uft/rida-khan. The scenario and customer description are drawn from the user's handoff. The public link was not independently retrievable during this build. This is an original demonstration and does not reuse AtlasEDU implementation, branding, customer data, or performance claims. Northstar CTE is a fictitious demo organization. No customer interviews or market validation were conducted.
