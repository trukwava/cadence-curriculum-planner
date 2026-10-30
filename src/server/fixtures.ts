import {addDays,type Anchor,type CalendarException,type Lesson,type Section,type Term} from '../shared/domain.js';
import {generateSessions} from './calendar.js';
import {optionalRecovery,schedule} from './schedule.js';
export function exactFixture(){
 const t:Term={id:'fixture',orgId:'demo',name:'Overlapping closures',startDate:'2026-10-26',endDate:'2026-11-06',timezone:'America/New_York',revision:0};
 const s:Section={id:'fixture-mwf',termId:t.id,name:'Six 50-minute sessions',patterns:[{id:'p',days:[1,3,5],start:'09:00',durationMinutes:50,parity:'all'}]};
 const closures:CalendarException[]=[{id:'closure-one',sectionId:s.id,date:'2026-10-28',kind:'closure',reason:'Building closure',source:'seed'},{id:'closure-two',sectionId:s.id,date:'2026-10-28',kind:'closure',reason:'Duplicate staff-day closure',source:'seed'}];
 const ls:Lesson[]=[{id:'req-a',unitId:'fixture',title:'Required laboratory A',durationMinutes:120,required:true,splitAllowed:true,mergeAllowed:false,priority:1,prerequisites:[]},{id:'req-b',unitId:'fixture',title:'Required laboratory B',durationMinutes:120,required:true,splitAllowed:true,mergeAllowed:false,priority:2,prerequisites:['req-a']},{id:'optional',unitId:'fixture',title:'Optional extension',durationMinutes:40,required:false,splitAllowed:true,mergeAllowed:false,priority:3,prerequisites:['req-b']}];
 const sessions=generateSessions(t,s,closures),baseline=schedule(ls,sessions,[],s.id),recovery=optionalRecovery(ls,sessions,[],s.id);
 return {term:t,section:s,closures,lessons:ls,sessions,capacity:sessions.reduce((n,x)=>n+x.availableMinutes,0),baseline,recovery};
}
