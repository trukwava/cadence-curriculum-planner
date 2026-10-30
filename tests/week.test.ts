import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftDate,mondayOf,snapDropStart} from '../src/client/week.js';

test('school-local week labels survive daylight saving and month/year changes',()=>{
 assert.equal(mondayOf('2026-11-01'),'2026-10-26');
 assert.equal(shiftDate('2026-10-30',3),'2026-11-02');
 assert.equal(mondayOf('2027-01-01'),'2026-12-28');
 assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
 assert.equal(shiftDate('2028-02-28',1),'2028-02-29');
});
test('week dates reject impossible calendar labels',()=>{
 assert.throws(()=>mondayOf('2026-02-30'),/Invalid school date/);
 assert.throws(()=>shiftDate('hello',1),/Invalid school date/);
});
test('drop slots snap within an available segment and never use closed interval',()=>{
 const day={start:'10:00',end:'11:15',segments:[{start:'10:00',end:'10:20'},{start:'10:35',end:'11:15'}]};
 assert.equal(snapDropStart(day,15,0),'10:00');
 assert.equal(snapDropStart(day,15,0.40),'10:35');
 assert.equal(snapDropStart(day,15,1),'11:00');
 assert.equal(snapDropStart(day,41,0.7),null);
});
test('drop clamps out-of-range positions and handles shortened final minutes',()=>{
 const day={start:'10:00',end:'10:37',segments:[{start:'10:00',end:'10:37'}]};
 assert.equal(snapDropStart(day,11,-20),'10:00');
 assert.equal(snapDropStart(day,11,99),'10:26');
 assert.equal(snapDropStart(day,37,0.5),'10:00');
 assert.equal(snapDropStart(day,38,0.5),null);
 assert.equal(snapDropStart(day,11,NaN),null);
});
