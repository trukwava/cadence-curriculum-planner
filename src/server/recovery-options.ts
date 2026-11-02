import {type Anchor,type InstructionalSession,type Lesson,type PlanResult} from '../shared/domain.js';
import {schedule} from './schedule.js';
import {validatePlan} from './validate-plan.js';

export interface RecoveryOption {
 deferredLessonIds:string[];result:PlanResult;movedLessonIds:string[];
 movedMinutes:number;deferredMinutes:number;priorityPenalty:number;score:number;
}
export interface RecoveryAnalysis {
 options:RecoveryOption[];explored:number;totalCandidates:number;
 exhaustive:boolean;requiredFailure:string[];note:string;
}
/** Enumerate optional-deferral subsets, independently validate feasible outcomes.
 * Above twelve eligible choices, the search is intentionally bounded, not exhaustive.
 */
export function rankRecoveryOptions(lessons:Lesson[],sessions:InstructionalSession[],anchors:Anchor[],sectionId:string,accepted:PlanResult,maxOptions=5):RecoveryAnalysis {
 const all=new Map(lessons.map(l=>[l.id,l]));
 const requiredDependencies=new Set<string>();
 const visit=(id:string):void=>{if(requiredDependencies.has(id))return;requiredDependencies.add(id);for(const p of all.get(id)?.prerequisites??[])visit(p);};
 for(const l of lessons.filter(l=>l.required))visit(l.id);
 const optional=lessons.filter(l=>!l.required&&!requiredDependencies.has(l.id));
 const ordered=[...optional].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
 const searchable=ordered.slice(0,12);
 const exhaustive=ordered.length<=12;
 const candidates=2**searchable.length;
 const options:RecoveryOption[]=[];
 const original=new Map<string,string>();
 for(const l of lessons)original.set(l.id,accepted.allocations.filter(a=>a.lessonId===l.id).map(a=>`${a.date}/${a.start}-${a.end}`).join('|'));
 const blockers:string[]=[];
 for(let mask=0;mask<candidates;mask++){
  const ids=searchable.filter((_,i)=>(mask&(1<<i))!==0).map(l=>l.id);
  if(lessons.some(l=>!ids.includes(l.id)&&l.prerequisites.some(id=>ids.includes(id))))continue;
  const result=schedule(lessons,sessions,anchors,sectionId,ids);
  if(!result.feasible){if(mask===0)blockers.push(...result.errors,...result.unsatisfied.map(x=>`${x.lessonId}: ${x.reason} (${x.missingMinutes} min)`));continue;}
  if(validatePlan(lessons,sessions,anchors,sectionId,result).length)continue;
  const movedLessonIds=lessons.filter(l=>!ids.includes(l.id)).filter(l=>original.get(l.id)!==result.allocations.filter(a=>a.lessonId===l.id).map(a=>`${a.date}/${a.start}-${a.end}`).join('|')).map(l=>l.id);
  const movedMinutes=result.allocations.filter(a=>movedLessonIds.includes(a.lessonId)).reduce((n,a)=>n+a.minutes,0);
  const nominal=sessions.find(s=>!s.extra)?.originalMinutes||0;
  const deferredMinutes=ids.reduce((n,id)=>{const l=all.get(id);return n+(l?.durationSessions?l.durationSessions*nominal:l?.durationMinutes??0);},0);
  const priorityPenalty=ids.reduce((n,id)=>n+Math.max(1,100-(all.get(id)?.priority??100)),0);
  const score=priorityPenalty*100000+ids.length*10000+movedMinutes;
  options.push({deferredLessonIds:ids,result,movedLessonIds,movedMinutes,deferredMinutes,priorityPenalty,score});
 }
 options.sort((a,b)=>a.score-b.score||a.deferredLessonIds.join(',').localeCompare(b.deferredLessonIds.join(',')));
 return {options:options.slice(0,Math.max(1,Math.min(10,maxOptions))),explored:candidates,totalCandidates:2**ordered.length,exhaustive,
 requiredFailure:options.length?[]:blockers,
 note:exhaustive?'All eligible optional-deferral subsets evaluated; results independently validated. The greedy allocator may miss feasible timetables.':'Only twelve eligible optional lessons searched; other deferrals may exist. No global infeasibility proof.'};
}
