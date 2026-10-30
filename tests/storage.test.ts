import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDb,initializeDemo,getState,previewDisruption,decide,restore,activeVersion,patchLesson,generateBaseline,resetDemo,addException,patchSection,addUnit,addLesson} from '../src/server/db.js';

function demo(){const folder=mkdtempSync(join(tmpdir(),'northstar-test-'));const path=join(folder,'demo.sqlite');const db=openDb(path);initializeDemo(db);return {db,path,done:()=>{db.close();rmSync(folder,{recursive:true,force:true});}};}
function lost(){return {sectionId:'cte-tt',date:'2026-11-24',start:'10:00',end:'11:15',reason:'Synthetic missed lab'};}
test('seed has two distinct sections, three units, eighteen lessons, holidays, test block, and DST',()=>{
 const d=demo();try{const s=getState(d.db);assert.equal(s.sections.length,2);assert.equal(s.lessons.length,18);assert.equal(s.units.length,3);assert.equal(s.anchors.length,2);assert.equal(s.exceptions.filter((e:any)=>e.kind==='holiday').length,2);assert.equal(s.exceptions.filter((e:any)=>e.kind==='testing').length,1);assert.equal(s.term.timezone,'America/New_York');assert.equal(s.sections[0]!.capacity.availableMinutes,850);assert.equal(s.sections[1]!.capacity.availableMinutes,750);assert.ok(s.sections.every((x:any)=>x.activePlan.snapshot.result.feasible));}finally{d.done();}
});
test('reject leaves accepted version and calendar unchanged',()=>{
 const d=demo();try{const before=activeVersion(d.db,'cte-tt')!;const ps=previewDisruption(d.db,lost());assert.equal(ps.length,2);assert.equal(ps.find(p=>p.strategy==='retain')!.result.feasible,false);assert.equal(ps.find(p=>p.strategy==='defer')!.result.feasible,true);
 decide(d.db,ps[1]!.id,'reject');const after=activeVersion(d.db,'cte-tt')!;assert.equal(after.id,before.id);assert.deepEqual(getState(d.db).sections.find((s:any)=>s.id==='cte-tt')!.disruptions,[]);
 assert.throws(()=>decide(d.db,ps[1]!.id,'accept'),/already decided/);
 }finally{d.done();}
});
test('accept writes version; reload preserves plan; restore reverts disruption',()=>{
 const d=demo();try{
 const first=activeVersion(d.db,'cte-tt')!;const ps=previewDisruption(d.db,lost());const chosen=ps.find(p=>p.strategy==='defer')!;assert.equal(chosen.result.feasible,true);
 assert.throws(()=>decide(d.db,ps.find(p=>p.strategy==='retain')!.id,'accept'),/Infeasible/);
 decide(d.db,chosen.id,'accept');const second=activeVersion(d.db,'cte-tt')!;assert.equal(second.versionNo,first.versionNo+1);assert.deepEqual(second.snapshot.result.deferredLessonIds,['lesson-18','lesson-17']);
 assert.equal(getState(d.db).sections.find((s:any)=>s.id==='cte-tt')!.disruptions.length,1);
 // A new SQLite handle simulates application restart / persistent reload.
 const reloaded=openDb(d.path);try{assert.equal(activeVersion(reloaded,'cte-tt')!.id,second.id);assert.equal(activeVersion(reloaded,'cte-tt')!.snapshot.result.usedMinutes,640);}finally{reloaded.close();}
 const restored=restore(d.db,'cte-tt',first.id);assert.equal(restored.versionNo,3);assert.equal(restored.snapshot.result.usedMinutes,first.snapshot.result.usedMinutes);assert.equal(getState(d.db).sections.find((s:any)=>s.id==='cte-tt')!.disruptions.length,0);
 }finally{d.done();}
});
test('curriculum edit makes plan stale and blocks old proposal approval and historical restoration',()=>{
 const d=demo();try{const old=activeVersion(d.db,'cte-tt')!;const draft=previewDisruption(d.db,lost())[1]!;patchLesson(d.db,'lesson-01',{durationMinutes:39});assert.equal(getState(d.db).term.revision,1);assert.throws(()=>decide(d.db,draft.id,'accept'),/stale/);
 assert.throws(()=>restore(d.db,'cte-tt',old.id),/curriculum revision/);
 const newPlan=generateBaseline(d.db,'cte-tt');assert.equal(newPlan.result.feasible,true);assert.equal(newPlan.version?.versionNo,2);
 }finally{d.done();}
});
test('teacher calendar event marks older plan stale and duplicate closure is not counted twice',()=>{
 const d=demo();try{
 const old=activeVersion(d.db,'cte-tt')!;
 addException(d.db,{sectionId:'cte-tt',date:'2026-11-05',kind:'partial',start:'10:00',end:'10:30',reason:'Testing window'});
 addException(d.db,{sectionId:'cte-tt',date:'2026-11-05',kind:'partial',start:'10:00',end:'10:30',reason:'Duplicate record'});
 const state=getState(d.db),day=state.sections.find((s:any)=>s.id==='cte-tt')!.sessions.find((s:any)=>s.date==='2026-11-05')!;
 assert.equal(day.availableMinutes,45);assert.deepEqual(day.exclusions.map((x:any)=>x.minutes),[30,0]);assert.notEqual(state.term.revision,old.curriculumRevision);
 }finally{d.done();}
});
test('reset restores only synthetic demo state and baseline',()=>{
 const d=demo();try{
 patchLesson(d.db,'lesson-01',{title:'Edited'});resetDemo(d.db);const x=getState(d.db);assert.equal(x.lessons[0]!.title,'Studio orientation');assert.equal(x.term.revision,0);assert.equal(x.sections[0]!.versions.length,1);
 }finally{d.done();}
});

test('teacher can add a unit and session-based lesson with section-dependent minutes',()=>{
 const d=demo();try{
 const u=addUnit(d.db,{title:'Optional lab extension'});
 const l=addLesson(d.db,{unitId:u.id,title:'Two full sessions',durationMinutes:40,durationSessions:2,required:false,splitAllowed:true,mergeAllowed:false,priority:19,prerequisites:[]});
 const seeded=getState(d.db).lessons.find((x:any)=>x.id===l.id)!;assert.equal(seeded.durationSessions,2);
 const mw=generateBaseline(d.db,'cte-mwf').result,tt=generateBaseline(d.db,'cte-tt').result;
 // The optional lesson consumes 100 MWF minutes vs. 150 T/Th minutes when feasible.
 const mwUsed=mw.allocations.filter(a=>a.lessonId===l.id).reduce((n,a)=>n+a.minutes,0);
 const ttUsed=tt.allocations.filter(a=>a.lessonId===l.id).reduce((n,a)=>n+a.minutes,0);
 assert.equal(mwUsed,100);assert.equal(ttUsed,0);assert.ok(!tt.feasible);assert.ok(tt.shortageMinutes>=105);
 }finally{d.done();}
});
