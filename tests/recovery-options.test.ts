import test from 'node:test';
import assert from 'node:assert/strict';
import {exactFixture} from '../src/server/fixtures.js';
import {rankRecoveryOptions} from '../src/server/recovery-options.js';
import {schedule} from '../src/server/schedule.js';
import {validatePlan} from '../src/server/validate-plan.js';
import {openDb,initializeDemo,activeVersion,analyzeRecovery} from '../src/server/db.js';

test('ranked alternatives preserve required content in the 250-minute fixture',()=>{
 const f=exactFixture(),r=rankRecoveryOptions(f.lessons,f.sessions,[],f.section.id,f.baseline);
 assert.equal(r.exhaustive,true);assert.equal(r.explored,2);assert.equal(r.options.length,1);
 assert.deepEqual(r.options[0]!.deferredLessonIds,['optional']);
 assert.equal(r.options[0]!.result.usedMinutes,240);
 assert.deepEqual(validatePlan(f.lessons,f.sessions,[],f.section.id,r.options[0]!.result),[]);
});
test('optional prerequisites of required lessons cannot be deferred',()=>{
 const f=exactFixture();
 const ls=f.lessons.map(l=>l.id==='req-a'?{...l,prerequisites:['optional']}:l);
 const r=rankRecoveryOptions(ls,f.sessions,[],f.section.id,schedule(ls,f.sessions,[],f.section.id));
 assert.equal(r.explored,1);assert.equal(r.options.length,0);
 assert.ok(r.requiredFailure.length>0);
});
test('analysis leaves the accepted SQLite plan untouched',()=>{
 const db=openDb(':memory:');try{
 initializeDemo(db);const before=activeVersion(db,'cte-tt')!;
 const r=analyzeRecovery(db,{sectionId:'cte-tt',date:'2026-11-24',start:'10:00',end:'11:15',reason:'Lost lab'});
 assert.equal(r.sourceVersionId,before.id);assert.ok(r.explored>=1);
 assert.equal(activeVersion(db,'cte-tt')!.id,before.id);
 assert.ok(r.options.every(o=>o.result.feasible));
 assert.throws(()=>analyzeRecovery(db,{sectionId:'cte-tt',date:'2026-11-24',start:'11:20',end:'11:35',reason:'No class'}),/does not remove available/);
 }finally{db.close();}
});
