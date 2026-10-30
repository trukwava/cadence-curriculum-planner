import {minute,time,type Allocation,type Anchor,type InstructionalSession,type Lesson,type PlanResult,type Segment} from '../shared/domain.js';
type Slot={sessionId:string;date:string;start:number;end:number;lessonId?:string};
const pos=(s:{date:string;start:number})=>`${s.date}T${String(s.start).padStart(4,'0')}`;
export function topoSort(lessons:Lesson[]):{ordered:Lesson[];errors:string[]} {
  const byId=new Map(lessons.map(l=>[l.id,l]));const done=new Set<string>();const ordered:Lesson[]=[];
  for(const l of lessons){if(!Number.isInteger(l.durationMinutes)||l.durationMinutes<1||l.durationMinutes>10000)throw new Error(`Invalid duration for ${l.title}`);for(const p of l.prerequisites){if(!byId.has(p))return {ordered:[],errors:[`Unknown prerequisite ${p} for ${l.title}`]};if(p===l.id)return {ordered:[],errors:[`Self prerequisite for ${l.title}`]};}}
  while(ordered.length<lessons.length){
    const ready=lessons.filter(l=>!done.has(l.id)&&l.prerequisites.every(p=>done.has(p)));
    if(!ready.length){const remaining=lessons.filter(l=>!done.has(l.id)).map(l=>l.title);return {ordered:[],errors:[`Prerequisite cycle: ${remaining.join(' → ')}`]};}
    ready.sort((a,b)=>Number(b.required)-Number(a.required)||a.priority-b.priority||lessons.indexOf(a)-lessons.indexOf(b));
    const l=ready[0]!;done.add(l.id);ordered.push(l);
  }
  return {ordered,errors:[]};
}
function slotsFrom(sessions:InstructionalSession[]):Slot[]{
  return sessions.flatMap(s=>s.segments.flatMap(seg=>Array.from({length:seg.minutes},(_,i)=>({sessionId:s.id,date:s.date,start:minute(seg.start)+i,end:minute(seg.start)+i+1}))));
}
function collect(slots:Slot[],lessonId:string):Allocation[]{
  const arr=slots.filter(s=>s.lessonId===lessonId).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
  const out:Allocation[]=[];
  for(const s of arr){const last=out.at(-1);if(last&&last.sessionId===s.sessionId&&minute(last.end)===s.start){last.end=time(s.end);last.minutes++;}
    else out.push({id:`${lessonId}@${s.sessionId}:${s.start}`,lessonId,sessionId:s.sessionId,date:s.date,start:time(s.start),end:time(s.end),minutes:1});}
  return out;
}
function place(lesson:Lesson,slots:Slot[],after:string|null,anchorDate?:string):boolean{
  const eligible=slots.filter(s=>!s.lessonId&&(!after||pos(s)>after)&&(!anchorDate||s.date===anchorDate));
  if(eligible.length<lesson.durationMinutes)return false;
  if(anchorDate){
    // Exam anchors occupy the latest suitable contiguous block on the specified day.
    const runs=freeRuns(eligible);
    const run=runs.filter(r=>r.length>=lesson.durationMinutes).at(-1);
    if(!run)return false;
    for(const s of run.slice(-lesson.durationMinutes))s.lessonId=lesson.id;
    return true;
  }
  if(!lesson.splitAllowed){
    const run=freeRuns(eligible).find(r=>r.length>=lesson.durationMinutes);
    if(!run)return false;
    for(const s of run.slice(0,lesson.durationMinutes))s.lessonId=lesson.id;
    return true;
  }
  for(const s of eligible.slice(0,lesson.durationMinutes))s.lessonId=lesson.id;
  return true;
}
function freeRuns(slots:Slot[]):Slot[][]{
  const runs:Slot[][]=[];
  for(const s of slots){const prev=runs.at(-1)?.at(-1);if(prev&&prev.sessionId===s.sessionId&&prev.end===s.start)runs.at(-1)!.push(s);else runs.push([s]);}
  return runs;
}
function scheduleMinutes(lessons:Lesson[],sessions:InstructionalSession[],anchors:Anchor[],sectionId:string,deferredIds:string[]=[]):PlanResult {
  const capacityMinutes=sessions.reduce((n,s)=>n+s.availableMinutes,0);
  const neededMinutes=lessons.filter(l=>!deferredIds.includes(l.id)).reduce((n,l)=>n+l.durationMinutes,0);
  const requiredMinutes=lessons.filter(l=>l.required).reduce((n,l)=>n+l.durationMinutes,0);
  const optionalMinutes=lessons.filter(l=>!l.required).reduce((n,l)=>n+l.durationMinutes,0);
  const base={neededMinutes,capacityMinutes,requiredMinutes,optionalMinutes,shortageMinutes:Math.max(0,neededMinutes-capacityMinutes)};
  const order=topoSort(lessons);
  if(order.errors.length)return {...base,feasible:false,allocations:[],deferredLessonIds:deferredIds,unsatisfied:[],errors:order.errors,usedMinutes:0,remainingMinutes:capacityMinutes};
  const lessonById=new Map(lessons.map(l=>[l.id,l]));const excluded=new Set(deferredIds);
  const errors:string[]=[];const unsatisfied:PlanResult['unsatisfied']=[];
  for(const id of excluded){const l=lessonById.get(id);if(!l||l.required)errors.push(`Cannot defer unknown or required lesson: ${id}`);}
  const perLesson=new Map<string,Allocation[]>();const slots=slotsFrom(sessions);
  const sectionAnchors=anchors.filter(a=>a.sectionId===sectionId);
  const anchored=new Map(sectionAnchors.map(a=>[a.lessonId,a.date]));
  // Pre-reserve assessment slots so flexible work cannot consume them.
  for(const l of order.ordered.filter(l=>anchored.has(l.id)&&!excluded.has(l.id))){
    if(!place(l,slots,null,anchored.get(l.id)))unsatisfied.push({lessonId:l.id,missingMinutes:l.durationMinutes,reason:`Fixed assessment cannot fit on ${anchored.get(l.id)} as one block`});
    else perLesson.set(l.id,collect(slots,l.id));
  }
  for(const l of order.ordered.filter(l=>!anchored.has(l.id)&&!excluded.has(l.id))){
    const missingPrereq=l.prerequisites.find(id=>excluded.has(id)||!perLesson.has(id));
    if(missingPrereq){unsatisfied.push({lessonId:l.id,missingMinutes:l.durationMinutes,reason:`Prerequisite unavailable: ${lessonById.get(missingPrereq)?.title||missingPrereq}`});continue;}
    let after:string|null=null;
    for(const pre of l.prerequisites){for(const a of perLesson.get(pre)||[]){const cutoff=pos({date:a.date,start:minute(a.end)-1});if(after===null||cutoff>after)after=cutoff;}}
    if(!place(l,slots,after)){
      const available=slots.filter(s=>!s.lessonId&&(!after||pos(s)>after)).length;
      unsatisfied.push({lessonId:l.id,missingMinutes:Math.max(1,l.durationMinutes-available),reason: !l.splitAllowed?'No contiguous meeting interval satisfies duration and prerequisites':'Not enough eligible minutes after prerequisites'});
    } else perLesson.set(l.id,collect(slots,l.id));
  }
  // Verify reserved anchors have their prerequisites completed strictly before assessment begins.
  for(const l of order.ordered.filter(l=>anchored.has(l.id)&&perLesson.has(l.id))){
    const first=perLesson.get(l.id)![0]!;const start=pos({date:first.date,start:minute(first.start)});
    const invalid=l.prerequisites.find(pre=>excluded.has(pre)||!perLesson.has(pre)||perLesson.get(pre)!.some(a=>pos({date:a.date,start:minute(a.end)-1})>=start));
    if(invalid){for(const s of slots){if(s.lessonId===l.id)delete s.lessonId;}perLesson.delete(l.id);unsatisfied.push({lessonId:l.id,missingMinutes:l.durationMinutes,reason:`Assessment prerequisite not complete before fixed date: ${lessonById.get(invalid)?.title}`});}
  }
  // If an anchor failed, its downstream lessons may now violate prerequisites: flag and remove them.
  for(const l of order.ordered){if(!perLesson.has(l.id))continue;if(l.prerequisites.some(id=>!perLesson.has(id))){for(const s of slots){if(s.lessonId===l.id)delete s.lessonId;}perLesson.delete(l.id);unsatisfied.push({lessonId:l.id,missingMinutes:l.durationMinutes,reason:'An upstream prerequisite could not be scheduled'});}}
  const allocations=order.ordered.flatMap(l=>perLesson.get(l.id)||[]).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.lessonId.localeCompare(b.lessonId));
  const usedMinutes=allocations.reduce((n,a)=>n+a.minutes,0);
  const feasible=errors.length===0&&unsatisfied.length===0;
  return {...base,feasible,allocations,deferredLessonIds:deferredIds,unsatisfied,errors,usedMinutes,remainingMinutes:capacityMinutes-usedMinutes};
}
export function schedule(lessons:Lesson[],sessions:InstructionalSession[],anchors:Anchor[],sectionId:string,deferredIds:string[]=[]):PlanResult {
 // Session-based durations refer to one full scheduled meeting (never a shortened partial session).
 // For a section with heterogeneous meeting lengths, the first recurring meeting is canonical.
 const nominal=sessions.find(s=>!s.extra)?.originalMinutes||0;
 const normalized=lessons.map(l=>({...l,durationMinutes:l.durationSessions?l.durationSessions*nominal:l.durationMinutes}));
 return scheduleMinutes(normalized,sessions,anchors,sectionId,deferredIds);
}
export function optionalRecovery(lessons:Lesson[],sessions:InstructionalSession[],anchors:Anchor[],sectionId:string):PlanResult{
  const all=schedule(lessons,sessions,anchors,sectionId);
  if(all.feasible)return all;
  // Defer optional leaves first; never drop a prerequisite of retained required content.
  const optional=lessons.filter(l=>!l.required).sort((a,b)=>b.priority-a.priority);
  const deferred:string[]=[];
  for(const l of optional){
    if(lessons.some(other=>other.required&&other.prerequisites.includes(l.id)))continue;
    deferred.push(l.id);
    const result=schedule(lessons,sessions,anchors,sectionId,deferred);
    if(result.feasible)return result;
  }
  return schedule(lessons,sessions,anchors,sectionId,deferred);
}
