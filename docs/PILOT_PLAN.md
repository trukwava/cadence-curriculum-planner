# Client pilot plan — hypothesis-driven, not a market claim

## Five targeted discovery questions

1. When a class is cancelled, what do you consult first to know what actually remains: school calendar, lesson plan, attendance, or a private spreadsheet?
2. Which constraints are truly immovable (assessment dates, prerequisite activities, lab equipment, safety requirements), and who may approve exceptions?
3. What does *optional* mean in practice? Which activities may be deferred, split, rescheduled or merged without violating instructional objectives?
4. What evidence would convince you that the replanned sequence is usable on a real class day, not merely arithmetically feasible?
5. How should approval, documentation and export fit into your existing planning workflow, and what would make you abandon the tool?

## Baseline task measurement

With teacher permission, replay one past semester *without student data*. Give the teacher ten real disruptions and their previous calendar/lesson sequence. Record time from identifying a lost session to a final, human-approved recovery; number of manual corrections; number of incorrect day/minute calculations; how often fixed assessments are moved unexpectedly; and an ordinal clarity score, defined before the trial.

## Shadow-mode trial

For two weeks, run this tool in parallel with existing teacher practices. Do not publish replans into a live schedule; a teacher checks each candidate against the known calendar and existing instructional commitments. Capture every rejected proposal, missing constraint, correction and reason. Have a second teacher review a subset for interpretability.

## Proposed success thresholds (to be validated)

- **Correctness gate:** 0 double-counted exclusions, 0 allocations into excluded intervals, 0 unexplained violations of required minutes, prerequisites or anchors in the sampled cases.
- **Usability gate:** At least 8/10 recovered plans assessed usable by the teacher with at most one manual edit each; all tradeoffs and infeasibility reasons understandable without implementation knowledge.
- **Efficiency hypothesis:** At least 20% reduction in median elapsed replanning time *against the teacher's own baseline*, with no increase in corrections. This is a target, not an established benefit.
- **Trust:** The teacher understands that no proposal is applied without explicit approval and can locate a previous accepted version.

## Failure / stop criteria

Stop pilot use if the system moves a fixed assessment without authorized override, compresses required work, materially disagrees with the official calendar, imports sensitive student data unexpectedly, or repeatedly proposes infeasible sequences as feasible. Pause feature expansion if greater than 2/10 cases require rebuilding the plan manually or teachers cannot explain what was deferred.

## Next scope decision

If correctness and usability gates pass, prioritize interoperable calendar exports (including timezone-aware VTIMEZONE), stronger manual drag/reorder adjustment, and replay tooling. If the main failure is incomplete calendar inputs, prioritize safe calendar-import review instead. Do not build student personalization, billing, or enterprise integrations until the core planner demonstrates value.
