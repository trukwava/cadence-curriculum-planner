import { mondayOf, shiftDate } from './week.js';
export interface WeekSummary { monday:string;end:string;sessions:number;capacity:number;allocated:number;buffer:number;excluded:number;closures:number; }
export function summarizeWeeks(startDate:string,endDate:string,sessions:ReadonlyArray<{date:string;availableMinutes:number;excludedMinutes?:number;exclusions?:unknown[]}>,allocations:ReadonlyArray<{date:string;minutes:number}>):WeekSummary[] {
 const first=mondayOf(startDate),last=mondayOf(endDate);
 const out:WeekSummary[]=[];
 for(let monday=first;monday<=last;monday=shiftDate(monday,7)) {
  const end=shiftDate(monday,6);
  const active=sessions.filter(s=>s.date>=monday&&s.date<=end);
  const capacity=active.reduce((n,s)=>n+s.availableMinutes,0);
  const allocated=allocations.filter(a=>a.date>=monday&&a.date<=end).reduce((n,a)=>n+a.minutes,0);
  out.push({monday,end,sessions:active.length,capacity,allocated,buffer:capacity-allocated,excluded:active.reduce((n,s)=>n+(s.excludedMinutes||0),0),closures:active.filter(s=>s.availableMinutes===0).length});
 }
 return out;
}
