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
