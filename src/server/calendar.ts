import { addDays, dateOrdinal, minute, time, type CalendarException, type Disruption, type InstructionalSession, type MeetingPattern, type Section, type Term } from '../shared/domain.js';

type Interval = [number,number];
function overlap(a:Interval,b:Interval):number {return Math.max(0,Math.min(a[1],b[1])-Math.max(a[0],b[0]));}
function subtract(base:Interval, blocked:Interval[]):Interval[] {
  let available=[base];
  for(const [b0,b1] of blocked){const next:Interval[]=[];for(const [a0,a1] of available){if(b1<=a0||b0>=a1){next.push([a0,a1]);continue;}if(a0<b0)next.push([a0,b0]);if(b1<a1)next.push([b1,a1]);}available=next;}
  return available;
}
export function generateSessions(term:Term,section:Section,exceptions:CalendarException[],disruptions:Disruption[]=[]):InstructionalSession[] {
  const dayCount=dateOrdinal(term.endDate)-dateOrdinal(term.startDate);
  if(dayCount<0||dayCount>730)throw new Error('Term must be 1–731 days');
  const specs:{id:string;date:string;start:string;end:string;extra:boolean}[]=[];
  // Parity counts Monday–Sunday school weeks, even when a term begins midweek.
  const startWeekday=(new Date(`${term.startDate}T12:00:00Z`).getUTCDay()+6)%7;
  for(let offset=0;offset<=dayCount;offset++){
    const date=addDays(term.startDate,offset);
    const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
    const week=Math.floor((offset+startWeekday)/7);
    for(const p of section.patterns){
      if(!p.days.includes(weekday) || (p.parity!=='all'&&((week%2===0?'odd':'even')!==p.parity)))continue;
      const start=minute(p.start), end=start+p.durationMinutes;
      if(end>=1440)throw new Error('Sessions crossing midnight are unsupported');
      specs.push({id:`${section.id}:${date}:${p.id}`,date,start:p.start,end:time(end),extra:false});
    }
  }
  for(const e of exceptions){if(e.kind==='extra'&&(e.sectionId===section.id)&&e.start&&e.end){
    specs.push({id:`${section.id}:${e.date}:extra:${e.id}`,date:e.date,start:e.start,end:e.end,extra:true});
  }}
  specs.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
  for(let i=1;i<specs.length;i++){
    const a=specs[i-1]!,b=specs[i]!;
    if(a.date===b.date&&overlap([minute(a.start),minute(a.end)],[minute(b.start),minute(b.end)])>0)throw new Error('Overlapping sessions on the same day; adjust extra session times');
  }
  const activeDisruptions=disruptions.filter(d=>d.active&&d.sectionId===section.id);
  return specs.map(spec=>{
    const start=minute(spec.start),end=minute(spec.end);
    const blockers:{id:string;reason:string;range:Interval}[]=[];
    for(const e of exceptions){
      if(e.date!==spec.date||e.kind==='extra'||(e.sectionId!==null&&e.sectionId!==section.id))continue;
      blockers.push({id:e.id,reason:e.reason,range:e.start&&e.end?[minute(e.start),minute(e.end)]:[start,end]});
    }
    for(const d of activeDisruptions){if(d.date===spec.date)blockers.push({id:d.id,reason:d.reason,range:[minute(d.start),minute(d.end)]});}
    blockers.sort((a,b)=>a.range[0]-b.range[0]||a.id.localeCompare(b.id));
    let segments:Interval[]=[[start,end]];
    const exclusions:InstructionalSession['exclusions']=[];
    for(const blocker of blockers){const removed=segments.reduce((acc,s)=>acc+overlap(s,blocker.range),0);segments=subtractSegments(segments,blocker.range);exclusions.push({id:blocker.id,reason:blocker.reason,minutes:removed});}
    return {id:spec.id,sectionId:section.id,date:spec.date,start:spec.start,end:spec.end,originalMinutes:end-start,availableMinutes:segments.reduce((sum,[a,b])=>sum+b-a,0),segments:segments.map(([a,b])=>({start:time(a),end:time(b),minutes:b-a})),exclusions,extra:spec.extra};
  });
}
function subtractSegments(xs:Interval[],blocked:Interval):Interval[]{return xs.flatMap(x=>subtract(x,[blocked]));}
export function capacitySummary(sessions:InstructionalSession[]){return {originalMinutes:sessions.reduce((n,s)=>n+s.originalMinutes,0),availableMinutes:sessions.reduce((n,s)=>n+s.availableMinutes,0),excludedMinutes:sessions.reduce((n,s)=>n+s.originalMinutes-s.availableMinutes,0),sessionCount:sessions.length,usableSessionCount:sessions.filter(s=>s.availableMinutes>0).length};}
export function validatePattern(p:MeetingPattern):void{if(!p.id||!['all','odd','even'].includes(p.parity)||p.days.length<1||p.days.some(n=>!Number.isInteger(n)||n<0||n>6)||!Number.isInteger(p.durationMinutes)||p.durationMinutes<1||p.durationMinutes>480)throw new Error('Invalid meeting pattern');if(minute(p.start)+p.durationMinutes>=1440)throw new Error('Meeting exceeds local date');}
