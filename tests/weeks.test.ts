import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeWeeks} from '../src/client/weeks.js';
test('multi-week capacity accounts for exclusions only in available sessions and DST labels',()=>{
 const sessions=[{date:'2026-10-30',availableMinutes:50,excludedMinutes:0},{date:'2026-11-02',availableMinutes:0,excludedMinutes:50},{date:'2026-11-04',availableMinutes:50,excludedMinutes:0}];
 const allocations=[{date:'2026-10-30',minutes:30},{date:'2026-11-04',minutes:40}];
 const weeks=summarizeWeeks('2026-10-30','2026-11-05',sessions,allocations);
 assert.deepEqual(weeks.map(w=>w.monday),['2026-10-26','2026-11-02']);
 assert.deepEqual(weeks.map(w=>[w.capacity,w.allocated,w.buffer,w.closures,w.excluded]),[[50,30,20,0,0],[50,40,10,1,50]]);
});
test('weeks with zero teaching time appear, and over-allocation is made visible',()=>{
 const weeks=summarizeWeeks('2026-11-02','2026-11-20',[{date:'2026-11-16',availableMinutes:30}], [{date:'2026-11-16',minutes:50}]);
 assert.equal(weeks.length,3);
 assert.equal(weeks[0]?.capacity,0);
 assert.equal(weeks[1]?.capacity,0);
 assert.equal(weeks[2]?.buffer,-20);
});
