import {dateOrdinal,minute,time,type Allocation,type Anchor,type InstructionalSession,type Lesson,type PlanResult} from '../shared/domain.js';
import {validatePlan} from './validate-plan.js';

export interface Rearrangement { result:PlanResult; changes:{before:Allocation;after:Allocation}[]; explored:number; }

/** Bounded deterministic displacement search. A failed search is not proof of impossibility. */
export function findRearrangement(base:PlanResult, lessons:Lesson[], sessions:InstructionalSession[], anchors:Anchor[], sectionId:string, allocationId:string, targetSessionId:string, start:string, maxDisplaced=3, maxNodes=5000):Rearrangement|null {
 const original=base.allocations.find(a=>a.id===allocationId);
 const destination=sessions.find(s=>s.id===targetSessionId);
 if(!original)throw new Error('Allocation not found in current accepted plan');
 if(!destination)throw new Error('Destination session does not exist for this section');
 const from=minute(start),end=from+original.minutes;
 if(end>=1440||!destination.segments.some(s=>minute(s.start)<=from&&end<=minute(s.end)))throw new Error('Requested interval is outside available instructional time');
 if(original.sessionId===destination.id&&original.start===start)throw new Error('Choose a different time or session for this move');
 const pinned=new Set(anchors.filter(a=>a.sectionId===sectionId).map(a=>a.lessonId));
 if(pinned.has(original.lessonId)&&original.date!==destination.date)throw new Error('Fixed assessment date cannot change');
 const move=(a:Allocation,s:InstructionalSession,at:number):Allocation=>({...a,sessionId:s.id,date:s.date,start:time(at),end:time(at+a.minutes)});
 const forced=move(original,destination,from);
 const originals=new Map(base.allocations.map(a=>[a.id,a]));
 const blocked=(a:Allocation,b:Allocation)=>a.sessionId===b.sessionId&&minute(a.start)<minute(b.end)&&minute(b.start)<minute(a.end);
 const initial=new Map(originals);
 initial.delete(original.id);
 const initialDisplaced=[...initial.values()].filter(a=>blocked(a,forced));
 if(initialDisplaced.some(a=>pinned.has(a.lessonId))||initialDisplaced.length>maxDisplaced)return null;
 for(const a of initialDisplaced)initial.delete(a.id);
 initial.set(forced.id,forced);
 let explored=0;
 const visited=new Set<string>();
 const sessionsChronological=[...sessions].sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
 const options=(block:Allocation,current:Map<string,Allocation>,used:Set<string>)=>{
  const choices:{allocation:Allocation;conflicts:Allocation[];score:number}[]=[];
  for(const session of sessionsChronological){
   if(pinned.has(block.lessonId)&&session.date!==block.date)continue;
   for(const segment of session.segments){
    const low=minute(segment.start),high=minute(segment.end)-block.minutes;
    const offsets:number[]=[];
    for(let at=low;at<=high;at+=5)offsets.push(at);
    if(session.id===block.sessionId&&minute(block.start)>=low&&minute(block.start)<=high&&!offsets.includes(minute(block.start)))offsets.push(minute(block.start));
    for(const at of offsets){
     const next=move(block,session,at);
     if(next.sessionId===block.sessionId&&next.start===block.start)continue;
     const conflicts=[...current.values()].filter(a=>blocked(a,next));
     if(conflicts.some(a=>used.has(a.id)||pinned.has(a.lessonId)))continue;
     if(used.size+conflicts.length>maxDisplaced+1)continue;
     const days=Math.abs(dateOrdinal(next.date)-dateOrdinal(block.date));
     const oldHole=next.sessionId===original.sessionId&&next.start===original.start;
     const score=conflicts.length*100000+days*1500+Math.abs(at-minute(block.start))+(oldHole?-500:0);
     choices.push({allocation:next,conflicts,score});
    }
   }
  }
  choices.sort((a,b)=>a.score-b.score||a.allocation.date.localeCompare(b.allocation.date)||a.allocation.start.localeCompare(b.allocation.start)||a.allocation.sessionId.localeCompare(b.allocation.sessionId));
  return choices.slice(0,150);
 };
 const explore=(current:Map<string,Allocation>,waiting:Allocation[],used:Set<string>):Rearrangement|null=>{
  if(++explored>maxNodes)return null;
  if(waiting.length===0){
   const allocations=base.allocations.map(a=>current.get(a.id)!).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.lessonId.localeCompare(b.lessonId));
   if(allocations.some(a=>!a))return null;
   const result:PlanResult={...base,allocations};
   if(validatePlan(lessons,sessions,anchors,sectionId,result).length)return null;
   const changes=allocations.filter(a=>{const before=originals.get(a.id)!;return before.sessionId!==a.sessionId||before.start!==a.start;}).map(after=>({before:originals.get(after.id)!,after}));
   return changes.length>1?{result,changes,explored}:null;
  }
  const [block,...rest]=waiting;
  if(!block)return null;
  const key=`${block.id}/${[...current.values()].map(a=>a.id+'@'+a.sessionId+':'+a.start).sort().join('|')}/${rest.map(a=>a.id).join(',')}`;
  if(visited.has(key))return null;visited.add(key);
  for(const {allocation,conflicts} of options(block,current,used)){
   if(explored>maxNodes)break;
   const next=new Map(current);
   for(const displaced of conflicts)next.delete(displaced.id);
   next.set(allocation.id,allocation);
   const moved=new Set(used);moved.add(block.id);
   for(const displaced of conflicts)moved.add(displaced.id);
   const solved=explore(next,[...rest,...conflicts],moved);
   if(solved)return solved;
  }
  return null;
 };
 return explore(initial,initialDisplaced,new Set([original.id,...initialDisplaced.map(a=>a.id)]));
}
