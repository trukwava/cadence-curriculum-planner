import test from 'node:test';
import assert from 'node:assert/strict';
import {exactFixture} from '../src/server/fixtures.js';
import {generateSessions,capacitySummary} from '../src/server/calendar.js';
import {schedule,topoSort,optionalRecovery} from '../src/server/schedule.js';
import {addDays,assertLocalDate,type Lesson,type Term,type Section,type CalendarException} from '../src/shared/domain.js';

test('exact isolated fixture: duplicate closure, 30-minute shortage, optional deferral',()=>{
 const f=exactFixture();assert.equal(f.sessions.length,6);assert.equal(f.capacity,250);assert.equal(f.baseline.neededMinutes,280);assert.equal(f.baseline.requiredMinutes,240);assert.equal(f.baseline.optionalMinutes,40);assert.equal(f.baseline.shortageMinutes,30);assert.equal(f.baseline.feasible,false);
 assert.equal(f.recovery.feasible,true);assert.deepEqual(f.recovery.deferredLessonIds,['optional']);assert.equal(f.recovery.usedMinutes,240);assert.equal(f.recovery.remainingMinutes,10);
 const excluded=f.sessions.find(s=>s.date==='2026-10-28')!;assert.deepEqual(excluded.exclusions.map(x=>x.minutes),[50,0]);assert.equal(excluded.availableMinutes,0);
 assert.equal(f.recovery.allocations.filter(a=>a.lessonId==='req-a').reduce((n,a)=>n+a.minutes,0),120);
 assert.equal(f.recovery.allocations.filter(a=>a.lessonId==='req-b').reduce((n,a)=>n+a.minutes,0),120);
});
test('daylight-saving crossing preserves school date-only values',()=>{
 assert.equal(addDays('2026-10-31',1),'2026-11-01');assert.equal(addDays('2026-11-01',1),'2026-11-02');
 const f=exactFixture();assert.ok(f.sessions.some(s=>s.date==='2026-10-30'));assert.ok(f.sessions.some(s=>s.date==='2026-11-02'));
 assert.ok(f.sessions.every(s=>s.id.includes(s.date)&&s.date>='2026-10-26'&&s.date<='2026-11-06'));
 assert.throws(()=>assertLocalDate('2026-02-30'),/Invalid/);
});
test('partial closures and duplicate overlaps are unioned, including on staggered intervals',()=>{
 const f=exactFixture(),t=f.term,s=f.section;
 const events:CalendarException[]=[{id:'a',date:'2026-10-28',sectionId:s.id,kind:'partial',start:'09:00',end:'09:20',reason:'Test A',source:'teacher'},{id:'b',date:'2026-10-28',sectionId:s.id,kind:'partial',start:'09:10',end:'09:30',reason:'Test B',source:'teacher'}];
 const day=generateSessions(t,s,events).find(x=>x.date==='2026-10-28')!;
 assert.equal(day.availableMinutes,20);assert.deepEqual(day.exclusions.map(x=>x.minutes),[20,10]);assert.deepEqual(day.segments.map(x=>[x.start,x.end]),[['09:30','09:50']]);
});
test('optional alternating weeks, extra sessions and calendar capacity',()=>{
 const f=exactFixture();const t=f.term,s:Section={...f.section,patterns:[{...f.section.patterns[0]!,parity:'odd'}]};
 const ex:CalendarException[]=[{id:'extra',sectionId:s.id,date:'2026-11-05',start:'13:00',end:'13:50',kind:'extra',reason:'Teacher-created buffer',source:'teacher'}];
 const ss=generateSessions(t,s,ex);assert.equal(ss.filter(x=>!x.extra).length,3);assert.equal(ss.filter(x=>x.extra).length,1);assert.equal(capacitySummary(ss).availableMinutes,200);
});
test('explicit prerequisite cycle fails instead of looping',()=>{
 const f=exactFixture();const broken=f.lessons.map(l=>({...l,prerequisites:[...l.prerequisites]}));broken[0]!.prerequisites=['req-b'];const r=schedule(broken,f.sessions,[],f.section.id);
 assert.equal(r.feasible,false);assert.match(r.errors.join(' '),/cycle/i);assert.deepEqual(r.allocations,[]);
});
test('unknown prerequisites and invalid deferral fail closed',()=>{
 const f=exactFixture(),ls=f.lessons.map(l=>({...l}));ls[0]!.prerequisites=['missing'];assert.match(schedule(ls,f.sessions,[],f.section.id).errors.join(' '),/Unknown prerequisite/);
 const r=schedule(f.lessons,f.sessions,[],f.section.id,['req-a']);assert.equal(r.feasible,false);assert.match(r.errors.join(' '),/Cannot defer/);
});
test('fixed exam anchor cannot move when the day is excluded',()=>{
 const f=exactFixture(),exam:Lesson={id:'exam',unitId:'fixture',title:'Fixed exam',durationMinutes:50,required:true,splitAllowed:false,mergeAllowed:false,priority:1,prerequisites:[]};
 const r=schedule([exam],f.sessions,[{id:'x',sectionId:f.section.id,lessonId:'exam',date:'2026-10-28'}],f.section.id);
 assert.equal(r.feasible,false);assert.match(r.unsatisfied[0]!.reason,/Fixed assessment/);
});
test('unsplittable content cannot be spread across two classes',()=>{
 const f=exactFixture(),lesson:Lesson={id:'long',unitId:'fixture',title:'80 min in one class',durationMinutes:80,required:true,splitAllowed:false,mergeAllowed:false,priority:1,prerequisites:[]};
 const r=schedule([lesson],f.sessions,[],f.section.id);assert.equal(r.feasible,false);assert.match(r.unsatisfied[0]!.reason,/contiguous/);
});
test('allocation minutes never exceed free session intervals',()=>{
 const f=exactFixture();for(const a of f.recovery.allocations){const session=f.sessions.find(s=>s.id===a.sessionId)!;assert.ok(session.segments.some(s=>a.start>=s.start&&a.end<=s.end));}
 const usedBySession=new Map<string,number>();for(const a of f.recovery.allocations)usedBySession.set(a.sessionId,(usedBySession.get(a.sessionId)||0)+a.minutes);
 for(const s of f.sessions)assert.ok((usedBySession.get(s.id)||0)<=s.availableMinutes);
});

test('bounded chain rearrangement relocates two overlaps without shortening required blocks',async()=>{
 const {findRearrangement}=await import('../src/server/rearrange.js');
 const lessons=['a','b','c'].map((id,i)=>({id,unitId:'u',title:id,durationMinutes:20,required:true,splitAllowed:false,mergeAllowed:false,priority:i+1,prerequisites:[]}));
 const sessions=['2026-11-02','2026-11-04'].map((date,i)=>({id:'s'+i,sectionId:'section',date,start:'09:00',end:'10:00',originalMinutes:60,availableMinutes:60,segments:[{start:'09:00',end:'10:00',minutes:60}],exclusions:[],extra:false}));
 const allocations=['a','b','c'].map((id,i)=>({id:'alloc-'+id,lessonId:id,sessionId:'s0',date:'2026-11-02',start:['09:00','09:20','09:40'][i]!,end:['09:20','09:40','10:00'][i]!,minutes:20}));
 const plan={feasible:true,allocations,deferredLessonIds:[],unsatisfied:[],errors:[],neededMinutes:60,capacityMinutes:120,requiredMinutes:60,optionalMinutes:0,shortageMinutes:0,usedMinutes:60,remainingMinutes:60};
 const r=findRearrangement(plan,lessons,sessions,[],'section','alloc-a','s0','09:30');
 assert.ok(r);assert.equal(r.changes.length,3);
 assert.equal(r.result.allocations.find(a=>a.id==='alloc-a')?.start,'09:30');
 assert.deepEqual(r.result.allocations.map(a=>a.id).sort(),allocations.map(a=>a.id).sort());
 const {validatePlan}=await import('../src/server/validate-plan.js');
 assert.deepEqual(validatePlan(lessons,sessions,[],'section',r.result),[]);
});

test('alternating week parity follows school weeks, not seven-day term offsets',()=>{
 const f=exactFixture();
 const term={...f.term,startDate:'2026-10-28',endDate:'2026-11-13'};
 const section:Section={...f.section,patterns:[{id:'mwf-odd',days:[1,3,5],start:'09:00',durationMinutes:50,parity:'odd'}]};
 const sessions=generateSessions(term,section,[]);
 assert.deepEqual(sessions.map(s=>s.date),['2026-10-28','2026-10-30','2026-11-09','2026-11-11','2026-11-13']);
 assert.equal(capacitySummary(sessions).availableMinutes,250);
});
test('hundred seeded overlapping closure sets reconcile to a minute-by-minute oracle',()=>{
 const f=exactFixture();
 let seed=2791;
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<100;trial++){
  const day='2026-10-28',blocked=new Set<number>();
  const events:CalendarException[]=[];
  for(let i=0;i<9;i++){
   const left=Math.floor(random()*50),right=left+1+Math.floor(random()*(50-left));
   for(let m=left;m<right;m++)blocked.add(m);
   const time=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
   events.push({id:`block-${i}`,date:day,sectionId:f.section.id,kind:'partial',start:time(540+left),end:time(540+right),reason:'Randomized test',source:'teacher'});
  }
  // A duplicate event must remove no additional instructional minute.
  events.push({...events[0]!,id:'duplicate'});
  const session=generateSessions(f.term,f.section,events).find(s=>s.date===day)!;
  assert.equal(session.availableMinutes,50-blocked.size);
  assert.equal(session.exclusions.reduce((n,x)=>n+x.minutes,0),blocked.size);
  assert.equal(session.exclusions.find(x=>x.id==='duplicate')?.minutes,0);
  assert.equal(session.segments.reduce((n,x)=>n+x.minutes,0),50-blocked.size);
 }
});
