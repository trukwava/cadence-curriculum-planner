import {minute,type Allocation,type Anchor,type InstructionalSession,type Lesson,type PlanResult} from '../shared/domain.js';

/** Independently checks an accepted allocation map; never trusts client-supplied feasibility. */
export function validatePlan(lessons:Lesson[],sessions:InstructionalSession[],anchors:Anchor[],sectionId:string,plan:PlanResult):string[]{
 const errors:string[]=[];
 const byLesson=new Map(lessons.map(l=>[l.id,l]));
 const bySession=new Map(sessions.map(s=>[s.id,s]));
 const byAllocation=new Set<string>();
 const byLessonAlloc=new Map<string,Allocation[]>();
 const occupied=new Map<string,Allocation[]>();
 const deferred=new Set(plan.deferredLessonIds);
 const nominal=sessions.find(s=>!s.extra)?.originalMinutes||0;
 const expected=(l:Lesson)=>l.durationSessions?l.durationSessions*nominal:l.durationMinutes;
 const stamp=(a:Allocation,side:'start'|'end')=>`${a.date}T${String(minute(a[side])).padStart(4,'0')}`;
 if(!plan.feasible)errors.push('Infeasible plans cannot be approved');
 if(deferred.size!==plan.deferredLessonIds.length)errors.push('Duplicate deferred lesson IDs');
 for(const id of deferred){const l=byLesson.get(id);if(!l||l.required)errors.push(`Unknown or required lesson cannot be deferred: ${id}`);}
 for(const a of plan.allocations){
  if(byAllocation.has(a.id))errors.push(`Duplicate allocation ID: ${a.id}`);
  byAllocation.add(a.id);
  if(!byLesson.has(a.lessonId)||deferred.has(a.lessonId))errors.push(`Allocation refers to unknown or deferred lesson: ${a.lessonId}`);
  const s=bySession.get(a.sessionId);
  if(!s||s.date!==a.date)errors.push(`Allocation is outside a valid session: ${a.id}`);
  try {
   const from=minute(a.start),to=minute(a.end);
   if(to<=from||to-from!==a.minutes)errors.push(`Allocation duration mismatch: ${a.id}`);
   if(s&&!s.segments.some(x=>minute(x.start)<=from&&to<=minute(x.end)))errors.push(`Allocation overlaps excluded instructional time: ${a.id}`);
  }catch{errors.push(`Invalid allocation time: ${a.id}`);}
  const xs=byLessonAlloc.get(a.lessonId)||[];xs.push(a);byLessonAlloc.set(a.lessonId,xs);
  const ys=occupied.get(a.sessionId)||[];ys.push(a);occupied.set(a.sessionId,ys);
 }
 for(const [id,xs] of occupied){
  xs.sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<xs.length;i++)if(xs[i-1]!.end>xs[i]!.start)errors.push(`Overlapping allocations in session ${id}`);
 }
 for(const l of lessons){
  const xs=byLessonAlloc.get(l.id)||[];
  if(deferred.has(l.id)){if(xs.length)errors.push(`Deferred lesson has allocations: ${l.title}`);continue;}
  if(xs.reduce((n,a)=>n+a.minutes,0)!==expected(l))errors.push(`Required duration not preserved: ${l.title}`);
  if(!l.splitAllowed&&xs.length!==1)errors.push(`Non-splittable lesson must occupy one block: ${l.title}`);
  const first=xs.length?xs.map(a=>stamp(a,'start')).sort()[0]:undefined;
  for(const id of l.prerequisites){
   const pre=byLesson.get(id);if(!pre){errors.push(`Unknown prerequisite ${id}`);continue;}
   const ps=byLessonAlloc.get(id)||[];
   if(!first||!ps.length||ps.some(a=>stamp(a,'end')>first))errors.push(`Prerequisite ${pre.title} is not complete before ${l.title}`);
  }
 }
 for(const a of anchors.filter(a=>a.sectionId===sectionId)){
  const xs=byLessonAlloc.get(a.lessonId)||[];
  if(xs.length!==1||xs[0]?.date!==a.date)errors.push(`Fixed assessment must stay on ${a.date}: ${a.lessonId}`);
 }
 const capacity=sessions.reduce((n,s)=>n+s.availableMinutes,0);
 const used=plan.allocations.reduce((n,a)=>n+a.minutes,0);
 const demand=lessons.filter(l=>!deferred.has(l.id)).reduce((n,l)=>n+expected(l),0);
 const required=lessons.filter(l=>l.required).reduce((n,l)=>n+expected(l),0);
 const optional=lessons.filter(l=>!l.required).reduce((n,l)=>n+expected(l),0);
 if(plan.capacityMinutes!==capacity||plan.usedMinutes!==used||plan.remainingMinutes!==capacity-used||plan.neededMinutes!==demand||plan.requiredMinutes!==required||plan.optionalMinutes!==optional||plan.shortageMinutes!==Math.max(0,demand-capacity))errors.push('Plan totals do not reconcile');
 return [...new Set(errors)];
}
