import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertLocalDate,assertTime,minute,type Term,type Section,type CalendarException,type Disruption,type Unit,type Lesson,type Anchor,type PlanVersion,type Proposal,type PlanResult,type ManualProposal,type Allocation,time} from '../shared/domain.js';
import {generateSessions,capacitySummary,validatePattern} from './calendar.js';
import {schedule,optionalRecovery} from './schedule.js';
import {validatePlan} from './validate-plan.js';

const j=(x:unknown)=>JSON.stringify(x);
const parse=<T>(v:unknown):T=>JSON.parse(String(v)) as T;
const rows=<T>(db:DatabaseSync,sql:string,...args:any[]):T[]=>db.prepare(sql).all(...args) as T[];
const row=<T>(db:DatabaseSync,sql:string,...args:any[]):T|undefined=>db.prepare(sql).get(...args) as T|undefined;
const now=()=>new Date().toISOString();
const uid=()=>randomUUID();
export function openDb(file:string){
  if(file!==':memory:')mkdirSync(dirname(resolve(file)),{recursive:true});
  const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');migrate(db);return db;
}
function migrate(db:DatabaseSync){db.exec(`
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,demo INTEGER NOT NULL CHECK(demo IN(0,1)));
CREATE TABLE IF NOT EXISTS terms(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,name TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,timezone TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY,term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,name TEXT NOT NULL,patterns_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_exceptions(id TEXT PRIMARY KEY,term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,date TEXT NOT NULL,start TEXT,end TEXT,kind TEXT NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY,term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,title TEXT NOT NULL,ordinal INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,title TEXT NOT NULL,duration_minutes INTEGER NOT NULL CHECK(duration_minutes>0 AND duration_minutes<=10000),required INTEGER NOT NULL CHECK(required IN(0,1)),split_allowed INTEGER NOT NULL CHECK(split_allowed IN(0,1)),merge_allowed INTEGER NOT NULL CHECK(merge_allowed IN(0,1)),priority INTEGER NOT NULL,prerequisites_json TEXT NOT NULL,resource_url TEXT,duration_sessions INTEGER CHECK(duration_sessions IS NULL OR duration_sessions>0));
CREATE TABLE IF NOT EXISTS anchors(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,date TEXT NOT NULL,UNIQUE(section_id,lesson_id));
CREATE TABLE IF NOT EXISTS disruptions(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,reason TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)));
CREATE TABLE IF NOT EXISTS plan_versions(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,version_no INTEGER NOT NULL,created_at TEXT NOT NULL,source_version_id TEXT,reason TEXT NOT NULL,curriculum_revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,UNIQUE(section_id,version_no));
CREATE TABLE IF NOT EXISTS allocations(id TEXT PRIMARY KEY,plan_version_id TEXT NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,lesson_id TEXT NOT NULL,session_id TEXT NOT NULL,date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,minutes INTEGER NOT NULL CHECK(minutes>0),UNIQUE(plan_version_id,id));
CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,source_version_id TEXT NOT NULL REFERENCES plan_versions(id),curriculum_revision INTEGER NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','accepted','rejected')),strategy TEXT NOT NULL,payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manual_proposals(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,source_version_id TEXT NOT NULL REFERENCES plan_versions(id),curriculum_revision INTEGER NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','accepted','rejected')),payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manual_decisions(id TEXT PRIMARY KEY,manual_proposal_id TEXT NOT NULL REFERENCES manual_proposals(id),decision TEXT NOT NULL CHECK(decision IN('accept','reject')),at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS teacher_decisions(id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL REFERENCES proposals(id),decision TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,kind TEXT NOT NULL,entity_id TEXT NOT NULL,at TEXT NOT NULL,detail TEXT NOT NULL);
`);
if(!rows<any>(db,'PRAGMA table_info(lessons)').some(r=>r.name==='duration_sessions'))db.exec('ALTER TABLE lessons ADD COLUMN duration_sessions INTEGER CHECK(duration_sessions IS NULL OR duration_sessions>0)');
}
function transact<T>(db:DatabaseSync,f:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const x=f();db.exec('COMMIT');return x;}catch(err){db.exec('ROLLBACK');throw err;}}
function audit(db:DatabaseSync,kind:string,entityId:string,detail:string){db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?)').run(uid(),'demo',kind,entityId,now(),detail.slice(0,400));}
export function term(db:DatabaseSync):Term {const t=row<any>(db,"SELECT * FROM terms WHERE org_id='demo' LIMIT 1");if(!t)throw new Error('Demo term missing');return {id:t.id,orgId:t.org_id,name:t.name,startDate:t.start_date,endDate:t.end_date,timezone:t.timezone,revision:t.revision};}
export function sections(db:DatabaseSync):Section[]{return rows<any>(db,'SELECT * FROM sections WHERE term_id=? ORDER BY id',term(db).id).map(r=>({id:r.id,termId:r.term_id,name:r.name,patterns:parse(r.patterns_json)}));}
export function exceptions(db:DatabaseSync):CalendarException[]{return rows<any>(db,'SELECT * FROM calendar_exceptions WHERE term_id=? ORDER BY date,id',term(db).id).map(r=>({id:r.id,sectionId:r.section_id,date:r.date,start:r.start||undefined,end:r.end||undefined,kind:r.kind,reason:r.reason,source:r.source}));}
export function disruptions(db:DatabaseSync,sectionId:string,activeOnly=false):Disruption[]{return rows<any>(db,`SELECT * FROM disruptions WHERE section_id=? ${activeOnly?'AND active=1':''} ORDER BY date,id`,sectionId).map(r=>({...r,active:!!r.active}));}
export function units(db:DatabaseSync):Unit[]{return rows<any>(db,'SELECT * FROM units WHERE term_id=? ORDER BY ordinal',term(db).id);}
export function lessons(db:DatabaseSync):Lesson[]{return rows<any>(db,'SELECT * FROM lessons WHERE term_id=? ORDER BY priority,id',term(db).id).map(r=>({id:r.id,unitId:r.unit_id,title:r.title,durationMinutes:r.duration_minutes,durationSessions:r.duration_sessions||undefined,required:!!r.required,splitAllowed:!!r.split_allowed,mergeAllowed:!!r.merge_allowed,priority:r.priority,prerequisites:parse(r.prerequisites_json),resourceUrl:r.resource_url||undefined}));}
export function anchors(db:DatabaseSync):Anchor[]{return rows<any>(db,'SELECT * FROM anchors').map(r=>({id:r.id,sectionId:r.section_id,lessonId:r.lesson_id,date:r.date}));}
export function ensureSection(db:DatabaseSync,id:string):Section{const s=sections(db).find(s=>s.id===id);if(!s)throw new Error('Unknown demo section');return s;}
export function sessionsFor(db:DatabaseSync,sectionId:string,additional:Disruption[]=[]){const s=ensureSection(db,sectionId);return generateSessions(term(db),s,exceptions(db),[...disruptions(db,sectionId,true),...additional]);}
export function activeVersion(db:DatabaseSync,sectionId:string):PlanVersion|undefined{
 const r=row<any>(db,'SELECT * FROM plan_versions WHERE section_id=? ORDER BY version_no DESC LIMIT 1',sectionId);return r?fromVersion(r):undefined;
}
function fromVersion(r:any):PlanVersion{return {id:r.id,sectionId:r.section_id,versionNo:r.version_no,createdAt:r.created_at,sourceVersionId:r.source_version_id,reason:r.reason,curriculumRevision:r.curriculum_revision,snapshot:parse(r.snapshot_json)};}
export function versions(db:DatabaseSync,sectionId:string){return rows<any>(db,'SELECT * FROM plan_versions WHERE section_id=? ORDER BY version_no DESC',sectionId).map(fromVersion);}
function writeVersion(db:DatabaseSync,sectionId:string,result:PlanResult,reason:string,sourceId:string|null,activeDisruptionIds:string[]):PlanVersion{
 if(!result.feasible)throw new Error('Cannot accept an infeasible plan');
 const next=(row<{max:number|null}>(db,'SELECT MAX(version_no) AS max FROM plan_versions WHERE section_id=?',sectionId)?.max||0)+1;
 const version:PlanVersion={id:uid(),sectionId,versionNo:next,createdAt:now(),sourceVersionId:sourceId,reason,curriculumRevision:term(db).revision,snapshot:{result,disruptions:activeDisruptionIds}};
 db.prepare('INSERT INTO plan_versions VALUES (?,?,?,?,?,?,?,?)').run(version.id,sectionId,next,version.createdAt,sourceId,reason,version.curriculumRevision,j(version.snapshot));
 const stmt=db.prepare('INSERT INTO allocations VALUES (?,?,?,?,?,?,?,?)');for(const a of result.allocations)stmt.run(`${version.id}:${a.id}`,version.id,a.lessonId,a.sessionId,a.date,a.start,a.end,a.minutes);
 audit(db,'plan.version',version.id,`v${next}: ${reason}`);return version;
}
export function generateBaseline(db:DatabaseSync,sectionId:string){ensureSection(db,sectionId);
 return transact(db,()=>{const result=schedule(lessons(db),sessionsFor(db,sectionId),anchors(db),sectionId);if(!result.feasible)return {result,version:null};const prior=activeVersion(db,sectionId);const ver=writeVersion(db,sectionId,result,'Teacher-generated baseline',prior?.id||null,disruptions(db,sectionId,true).map(d=>d.id));return {result,version:ver};});
}
export function getState(db:DatabaseSync){const t=term(db),ss=sections(db);return {organization:{name:'Northstar CTE — synthetic demo',demo:true},term:t,sections:ss.map(s=>{const ses=sessionsFor(db,s.id);return {...s,sessions:ses,capacity:capacitySummary(ses),activePlan:activeVersion(db,s.id),versions:versions(db,s.id),proposals:proposals(db,s.id),manualProposals:manualProposals(db,s.id),disruptions:disruptions(db,s.id,true)};}),exceptions:exceptions(db),units:units(db),lessons:lessons(db),anchors:anchors(db),audit:rows<any>(db,'SELECT * FROM audit_events ORDER BY at DESC LIMIT 30').map(r=>({id:r.id,kind:r.kind,entityId:r.entity_id,at:r.at,detail:r.detail}))};}
export function proposals(db:DatabaseSync,sectionId:string):Proposal[]{return rows<any>(db,'SELECT * FROM proposals WHERE section_id=? ORDER BY created_at DESC,id DESC',sectionId).map(r=>({...parse<Proposal>(r.payload_json),status:r.status}));}

export function manualProposals(db:DatabaseSync,sectionId:string):ManualProposal[]{
 return rows<any>(db,'SELECT * FROM manual_proposals WHERE section_id=? ORDER BY created_at DESC,id DESC',sectionId).map(r=>({...parse<ManualProposal>(r.payload_json),status:r.status}));
}
/** Read-only candidate search: all suggestions pass full-plan validation. */
export function suggestManualMoves(db:DatabaseSync,sectionId:string,allocationId:string){
 const sec=ensureSection(db,sectionId),current=activeVersion(db,sec.id),t=term(db);
 if(!current||current.curriculumRevision!==t.revision)throw new Error('Current plan is missing or stale; regenerate baseline');
 const base=current.snapshot.result,original=base.allocations.find(a=>a.id===allocationId);
 if(!original)throw new Error('Allocation not found in accepted plan');
 const allSessions=sessionsFor(db,sec.id),allLessons=lessons(db),allAnchors=anchors(db);
 const candidates:{sessionId:string;date:string;start:string;end:string;minutes:number;dayShift:number}[]=[];
 const toOrdinal=(date:string)=>Math.trunc(Date.parse(date+'T12:00:00Z')/86400000);
 for(const session of allSessions){
  for(const segment of session.segments){
   const occupied=base.allocations.filter(a=>a.id!==original.id&&a.sessionId===session.id)
    .map(a=>({start:minute(a.start),end:minute(a.end)})).sort((a,b)=>a.start-b.start);
   let cursor=minute(segment.start);
   for(const block of [...occupied,{start:minute(segment.end),end:minute(segment.end)}]){
    if(block.start-cursor>=original.minutes){
     for(let startMinute=cursor;startMinute+original.minutes<=block.start;startMinute+=5){
      const start=time(startMinute),end=time(startMinute+original.minutes);
      if(session.id!==original.sessionId||start!==original.start){
       const replacement={...original,sessionId:session.id,date:session.date,start,end};
       const result={...base,allocations:base.allocations.map(a=>a.id===original.id?replacement:a)};
       if(!validatePlan(allLessons,allSessions,allAnchors,sec.id,result).length){
        candidates.push({sessionId:session.id,date:session.date,start,end,minutes:original.minutes,dayShift:toOrdinal(session.date)-toOrdinal(original.date)});
       }
      }
     }
    }
    cursor=Math.max(cursor,block.end);
   }
  }
 }
 candidates.sort((a,b)=>Math.abs(a.dayShift)-Math.abs(b.dayShift)||a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
 return {sourceVersionId:current.id,allocationId,original:{date:original.date,start:original.start,end:original.end},suggestions:candidates.slice(0,12),checkedSessions:allSessions.length};
}

export function previewManualMove(db:DatabaseSync,request:{sectionId:string;allocationId:string;targetSessionId:string;start:string}):ManualProposal{
 const s=ensureSection(db,request.sectionId),t=term(db),current=activeVersion(db,s.id);
 if(!current)throw new Error('Generate a baseline before adjusting allocations');
 if(current.curriculumRevision!==t.revision)throw new Error('Accepted plan is stale; regenerate before making a manual adjustment');
 if(typeof request.allocationId!=='string'||typeof request.targetSessionId!=='string')throw new Error('Select a valid allocation and session');
 assertTime(request.start);
 const original=current.snapshot.result.allocations.find(a=>a.id===request.allocationId);
 if(!original)throw new Error('Allocation not found in current accepted plan');
 const sessions=sessionsFor(db,s.id),target=sessions.find(x=>x.id===request.targetSessionId);
 if(!target)throw new Error('Destination session does not exist for this section');
 const until=minute(request.start)+original.minutes;
 if(until>=1440)throw new Error('Allocation cannot extend beyond the school day');
 const replacement:Allocation={...original,sessionId:target.id,date:target.date,start:request.start,end:time(until)};
 if(original.sessionId===replacement.sessionId&&original.start===replacement.start)throw new Error('Choose a different time or session for this move');
 const before=current.snapshot.result;
 const result:PlanResult={...before,allocations:before.allocations.map(a=>a.id===original.id?replacement:a).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.lessonId.localeCompare(b.lessonId))};
 const failures=validatePlan(lessons(db),sessions,anchors(db),s.id,result);
 if(failures.length)throw new Error(`Move is not feasible: ${failures.join('; ')}`);
 return transact(db,()=>{
  // Re-check the head while holding a write transaction so the draft has a stable parent.
  if(activeVersion(db,s.id)?.id!==current.id||term(db).revision!==t.revision)throw new Error('Plan changed during preview; retry');
  const proposal:ManualProposal={id:uid(),sectionId:s.id,sourceVersionId:current.id,curriculumRevision:t.revision,createdAt:now(),status:'draft',allocationId:original.id,targetSessionId:target.id,start:request.start,result,before:original,after:replacement};
  db.prepare('INSERT INTO manual_proposals VALUES (?,?,?,?,?,?,?)').run(proposal.id,s.id,current.id,t.revision,proposal.createdAt,'draft',j(proposal));
  audit(db,'manual.preview',proposal.id,`Proposed moving ${original.lessonId} to ${target.date} ${request.start}`);
  return proposal;
 });
}
export function decideManualMove(db:DatabaseSync,proposalId:string,decision:'accept'|'reject'){
 return transact(db,()=>{
  const record=row<any>(db,'SELECT * FROM manual_proposals WHERE id=?',proposalId);
  if(!record)throw new Error('Manual proposal not found');
  if(record.status!=='draft')throw new Error('Manual proposal already decided');
  const p=parse<ManualProposal>(record.payload_json),current=activeVersion(db,p.sectionId);
  if(!current||current.id!==p.sourceVersionId||term(db).revision!==p.curriculumRevision)throw new Error('Manual proposal is stale; create a new preview');
  let version:PlanVersion|null=null;
  if(decision==='accept'){
   const failures=validatePlan(lessons(db),sessionsFor(db,p.sectionId),anchors(db),p.sectionId,p.result);
   if(failures.length)throw new Error(`Manual proposal invalid: ${failures.join('; ')}`);
   version=writeVersion(db,p.sectionId,p.result,`Teacher moved ${p.before.lessonId} to ${p.after.date} ${p.after.start}`,current.id,current.snapshot.disruptions);
  }
  db.prepare('UPDATE manual_proposals SET status=? WHERE id=?').run(decision==='accept'?'accepted':'rejected',proposalId);
  db.prepare('INSERT INTO manual_decisions VALUES (?,?,?,?)').run(uid(),proposalId,decision,now());
  audit(db,`manual.${decision}`,proposalId,`${p.before.lessonId} ${p.before.date} to ${p.after.date}`);
  return {decision,version};
 });
}

function compare(before:PlanResult,after:PlanResult){
 const per=(r:PlanResult,id:string)=>r.allocations.filter(a=>a.lessonId===id).map(a=>`${a.date}/${a.start}-${a.end}`).join('|');
 const ids=new Set([...before.allocations.map(a=>a.lessonId),...after.allocations.map(a=>a.lessonId)]);
 const movedLessonIds=[...ids].filter(id=>per(before,id)!==per(after,id));
 return {movedLessonIds,affectedMinutes:after.allocations.filter(a=>movedLessonIds.includes(a.lessonId)).reduce((n,a)=>n+a.minutes,0),deferredLessonIds:after.deferredLessonIds};
}
export function previewDisruption(db:DatabaseSync,request:{sectionId:string;date:string;start:string;end:string;reason:string;deferredLessonIds?:string[]}){
 const s=ensureSection(db,request.sectionId),t=term(db);assertLocalDate(request.date);assertTime(request.start);assertTime(request.end);
 if(request.date<t.startDate||request.date>t.endDate||minute(request.start)>=minute(request.end))throw new Error('Disruption must be within term and have positive duration');
 if(!request.reason?.trim()||request.reason.length>160)throw new Error('Provide a reason (1–160 characters)');
 const active=activeVersion(db,s.id);if(!active)throw new Error('Generate a baseline before previewing a disruption');
 if(active.curriculumRevision!==t.revision)throw new Error('Baseline is stale. Regenerate it after curriculum or calendar changes.');
 const relevant=sessionsFor(db,s.id).some(se=>se.date===request.date&&se.segments.some(seg=>Math.min(minute(seg.end),minute(request.end))>Math.max(minute(seg.start),minute(request.start))));
 if(!relevant)throw new Error('Disruption has no remaining instructional minutes on this section/date');
 const d:Disruption={id:uid(),sectionId:s.id,date:request.date,start:request.start,end:request.end,reason:request.reason.trim(),active:true};
 const proposedSessions=sessionsFor(db,s.id,[d]);
 const allLessons=lessons(db),allAnchors=anchors(db),base=active.snapshot.result;
 const retain=schedule(allLessons,proposedSessions,allAnchors,s.id);
 const recovery=request.deferredLessonIds?schedule(allLessons,proposedSessions,allAnchors,s.id,request.deferredLessonIds):optionalRecovery(allLessons,proposedSessions,allAnchors,s.id);
 return transact(db,()=>{
  const results:[Proposal['strategy'],PlanResult][]=[['retain',retain],['defer',recovery]];
  const out=results.map(([strategy,result])=>{
   const p:Proposal={id:uid(),sectionId:s.id,sourceVersionId:active.id,curriculumRevision:t.revision,createdAt:now(),status:'draft',strategy,disruption:d,result,changes:compare(base,result)};
   db.prepare('INSERT INTO proposals VALUES (?,?,?,?,?,?,?,?)').run(p.id,p.sectionId,p.sourceVersionId,p.curriculumRevision,p.createdAt,p.status,strategy,j(p));
   return p;
  });audit(db,'proposal.created',out[0]!.id,`Disruption preview: ${d.date}`);return out;
 });
}
export function decide(db:DatabaseSync,proposalId:string,decision:'accept'|'reject'){
 return transact(db,()=>{
 const r=row<any>(db,'SELECT * FROM proposals WHERE id=?',proposalId);if(!r)throw new Error('Proposal not found');if(r.status!=='draft')throw new Error('Proposal already decided');
 const p=parse<Proposal>(r.payload_json),cur=activeVersion(db,p.sectionId);
 if(!cur||cur.id!==p.sourceVersionId||term(db).revision!==p.curriculumRevision)throw new Error('Proposal is stale; create a new preview');
 if(decision==='accept'&&!p.result.feasible)throw new Error('Infeasible proposals cannot be accepted');
 let ver:PlanVersion|null=null;
 if(decision==='accept'){
   db.prepare('INSERT INTO disruptions VALUES (?,?,?,?,?,?,?)').run(p.disruption.id,p.sectionId,p.disruption.date,p.disruption.start,p.disruption.end,p.disruption.reason,1);
   ver=writeVersion(db,p.sectionId,p.result,`Accepted ${p.strategy==='defer'?'optional deferral':'retained content'} after ${p.disruption.date} disruption`,cur.id,[...cur.snapshot.disruptions,p.disruption.id]);
 }
 db.prepare('UPDATE proposals SET status=? WHERE id=?').run(decision==='accept'?'accepted':'rejected',proposalId);
 db.prepare('INSERT INTO teacher_decisions VALUES (?,?,?,?)').run(uid(),proposalId,decision,now());
 audit(db,`teacher.${decision}`,proposalId,`${p.sectionId} ${p.disruption.date}`);
 return {decision,version:ver};
 });
}
export function restore(db:DatabaseSync,sectionId:string,versionId:string){ensureSection(db,sectionId);
 return transact(db,()=>{const candidate=versions(db,sectionId).find(v=>v.id===versionId),current=activeVersion(db,sectionId);if(!candidate||!current)throw new Error('Unknown version');if(candidate.curriculumRevision!==term(db).revision)throw new Error('Historical curriculum differs; restoration requires matching curriculum revision');
 const keep=new Set(candidate.snapshot.disruptions);
 for(const d of disruptions(db,sectionId))db.prepare('UPDATE disruptions SET active=? WHERE id=?').run(keep.has(d.id)?1:0,d.id);
 // Revalidate the historical allocations against the restored calendar and present curriculum.
 const refreshed=sessionsFor(db,sectionId);const validation=validatePlan(lessons(db),refreshed,anchors(db),sectionId,candidate.snapshot.result);
 if(validation.length)throw new Error('Historical plan cannot be restored faithfully: '+validation.join('; '));
 return writeVersion(db,sectionId,candidate.snapshot.result,`Restored version ${candidate.versionNo}`,current.id,candidate.snapshot.disruptions);
 });
}
export function addException(db:DatabaseSync,x:{sectionId?:string|null;date:string;start?:string;end?:string;kind:string;reason:string}){
 return transact(db,()=>{const t=term(db);assertLocalDate(x.date);if(x.date<t.startDate||x.date>t.endDate)throw new Error('Exception outside term');if(x.sectionId)ensureSection(db,x.sectionId);
 if(!['holiday','testing','pd','closure','partial','cancelled','extra'].includes(x.kind))throw new Error('Invalid exception kind');
 if(!x.reason?.trim()||x.reason.length>160)throw new Error('Reason required (max 160 chars)');
 if((x.start&&!x.end)||(!x.start&&x.end))throw new Error('Both times required');
 if(x.start&&x.end){assertTime(x.start);assertTime(x.end);if(minute(x.start)>=minute(x.end))throw new Error('Start must precede end');}
 if((x.kind==='partial'||x.kind==='extra')&&(!x.start||!x.end))throw new Error('Start and end times required');
 if(x.kind==='extra'&&!x.sectionId)throw new Error('Extra sessions must specify a section');
 const id=uid();db.prepare('INSERT INTO calendar_exceptions VALUES (?,?,?,?,?,?,?,?,?)').run(id,t.id,x.sectionId||null,x.date,x.start||null,x.end||null,x.kind,x.reason.trim(),'teacher');
 if(x.sectionId)generateSessions(t,ensureSection(db,x.sectionId),exceptions(db),disruptions(db,x.sectionId,true));
 else for(const s of sections(db))generateSessions(t,s,exceptions(db),disruptions(db,s.id,true));
 db.prepare('UPDATE terms SET revision=revision+1 WHERE id=?').run(t.id);audit(db,'calendar.edit',id,`${x.kind} ${x.date}`);return {id};
 });
}
export function patchLesson(db:DatabaseSync,id:string,changes:Partial<Lesson>){return transact(db,()=>{
 const old=lessons(db).find(l=>l.id===id);if(!old)throw new Error('Lesson missing');const next={...old,...changes};
 if(!next.title?.trim()||next.title.length>140||!Number.isInteger(next.durationMinutes)||next.durationMinutes<1||next.durationMinutes>10000||(next.durationSessions!==undefined&&(!Number.isInteger(next.durationSessions)||next.durationSessions<1||next.durationSessions>100))||!Number.isInteger(next.priority)||next.priority<1||next.priority>10000)throw new Error('Invalid lesson title, duration, or priority');
 if(next.resourceUrl){try{const u=new URL(next.resourceUrl);if(!['https:','http:'].includes(u.protocol))throw new Error();}catch{throw new Error('Resource URL must begin with https:// or http://');}}
 if(!Array.isArray(next.prerequisites)||next.prerequisites.some(p=>typeof p!=='string'))throw new Error('Invalid prerequisite IDs');
 db.prepare('UPDATE lessons SET title=?,duration_minutes=?,required=?,split_allowed=?,merge_allowed=?,priority=?,prerequisites_json=?,resource_url=?,duration_sessions=? WHERE id=?').run(next.title.trim(),next.durationMinutes,Number(next.required),Number(next.splitAllowed),Number(next.mergeAllowed),next.priority,j(next.prerequisites),next.resourceUrl||null,next.durationSessions||null,id);
 db.prepare('UPDATE terms SET revision=revision+1 WHERE id=?').run(term(db).id);audit(db,'lesson.edit',id,`Edited ${next.title}`);return next;
 });}
export function patchTerm(db:DatabaseSync,changes:{name?:string;timezone?:string;startDate?:string;endDate?:string}){return transact(db,()=>{
 const t=term(db),next={...t,...changes};assertLocalDate(next.startDate);assertLocalDate(next.endDate);if(next.endDate<next.startDate||next.endDate>new Date(Date.parse(`${next.startDate}T12:00:00Z`)+730*86400000).toISOString().slice(0,10))throw new Error('Term range must be 1–731 days');
 if(!next.name.trim()||next.name.length>120)throw new Error('Invalid term name');try{new Intl.DateTimeFormat('en-US',{timeZone:next.timezone});}catch{throw new Error('Invalid IANA timezone');}
 db.prepare('UPDATE terms SET name=?,timezone=?,start_date=?,end_date=?,revision=revision+1 WHERE id=?').run(next.name,next.timezone,next.startDate,next.endDate,t.id);audit(db,'term.edit',t.id,`Updated term`);return term(db);
 });}
export function patchSection(db:DatabaseSync,id:string,changes:{name?:string;patterns?:Section['patterns']}){return transact(db,()=>{
 const s=ensureSection(db,id),next={...s,...changes};if(!next.name.trim()||next.name.length>120||!Array.isArray(next.patterns)||next.patterns.length<1||next.patterns.length>7)throw new Error('Invalid section');
 next.patterns.forEach(validatePattern);
 db.prepare('UPDATE sections SET name=?,patterns_json=? WHERE id=?').run(next.name,j(next.patterns),id);
 generateSessions(term(db),next,exceptions(db),disruptions(db,id,true));
 db.prepare('UPDATE terms SET revision=revision+1 WHERE id=?').run(term(db).id);audit(db,'section.edit',id,`Updated meeting pattern`);return next;
 });}
export function addUnit(db:DatabaseSync,x:{title:string}){return transact(db,()=>{
 if(typeof x.title!=='string'||!x.title.trim()||x.title.length>140)throw new Error('Unit title required (max 140 chars)');
 const t=term(db),id=uid(),ordinal=units(db).length+1;
 db.prepare('INSERT INTO units VALUES (?,?,?,?)').run(id,t.id,x.title.trim(),ordinal);
 db.prepare('UPDATE terms SET revision=revision+1 WHERE id=?').run(t.id);audit(db,'unit.create',id,x.title.trim());return {id,title:x.title.trim(),ordinal};
 });}
export function addLesson(db:DatabaseSync,x:{unitId:string;title:string;durationMinutes:number;durationSessions?:number;required:boolean;splitAllowed:boolean;mergeAllowed:boolean;priority:number;prerequisites:string[];resourceUrl?:string}){return transact(db,()=>{
 const t=term(db);if(!units(db).some(u=>u.id===x.unitId))throw new Error('Unknown unit');
 if(typeof x.title!=='string'||!x.title.trim()||x.title.length>140||!Number.isInteger(x.durationMinutes)||x.durationMinutes<1||x.durationMinutes>10000||!Number.isInteger(x.priority)||x.priority<1||x.priority>10000)throw new Error('Invalid lesson fields');
 if(x.durationSessions!==undefined&&(!Number.isInteger(x.durationSessions)||x.durationSessions<1||x.durationSessions>100))throw new Error('Invalid session duration');
 if(!Array.isArray(x.prerequisites)||x.prerequisites.some(p=>typeof p!=='string'||!lessons(db).some(l=>l.id===p)))throw new Error('Unknown lesson prerequisite');
 if(x.resourceUrl){try{const u=new URL(x.resourceUrl);if(!['https:','http:'].includes(u.protocol))throw new Error();}catch{throw new Error('Invalid resource URL');}}
 const id=uid();db.prepare('INSERT INTO lessons VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,t.id,x.unitId,x.title.trim(),x.durationMinutes,Number(x.required),Number(x.splitAllowed),Number(x.mergeAllowed),x.priority,j(x.prerequisites),x.resourceUrl||null,x.durationSessions||null);
 db.prepare('UPDATE terms SET revision=revision+1 WHERE id=?').run(t.id);audit(db,'lesson.create',id,x.title.trim());return {id};
 });}
export function patchAnchor(db:DatabaseSync,sectionId:string,lessonId:string,date:string){return transact(db,()=>{
 ensureSection(db,sectionId);const t=term(db);assertLocalDate(date);
 if(date<t.startDate||date>t.endDate)throw new Error('Assessment date outside term');
 if(!lessons(db).some(l=>l.id===lessonId))throw new Error('Unknown lesson');
 const existing=row<any>(db,'SELECT * FROM anchors WHERE section_id=? AND lesson_id=?',sectionId,lessonId);
 if(existing)db.prepare('UPDATE anchors SET date=? WHERE id=?').run(date,existing.id);
 else db.prepare('INSERT INTO anchors VALUES (?,?,?,?)').run(uid(),sectionId,lessonId,date);
 db.prepare('UPDATE terms SET revision=revision+1 WHERE id=?').run(t.id);
 audit(db,'anchor.override',lessonId,`Teacher set fixed assessment date ${date} for ${sectionId}`);
 return {sectionId,lessonId,date};
 });}
export function resetDemo(db:DatabaseSync){return transact(db,()=>{
 // Hard scope boundary: only synthetic demo organization may be reset.
 const org=row<any>(db,"SELECT * FROM organizations WHERE id='demo'");if(org&&!org.demo)throw new Error('Reset denied for non-demo organization');
 // SQLite FKs for proposal source versions intentionally retain history across normal plan changes.
 // A scoped demo reset must remove dependent decisions/drafts before deleting plan versions.
 const demoSection="section_id IN (SELECT sections.id FROM sections JOIN terms ON sections.term_id=terms.id WHERE terms.org_id='demo')";
 db.exec(`DELETE FROM manual_decisions WHERE manual_proposal_id IN (SELECT id FROM manual_proposals WHERE ${demoSection});`);
 db.exec(`DELETE FROM teacher_decisions WHERE proposal_id IN (SELECT id FROM proposals WHERE ${demoSection});`);
 db.exec(`DELETE FROM manual_proposals WHERE ${demoSection};`);
 db.exec(`DELETE FROM proposals WHERE ${demoSection};`);
 db.prepare("DELETE FROM organizations WHERE id='demo'").run();
 db.prepare('INSERT INTO organizations VALUES (?,?,?)').run('demo','Northstar CTE — synthetic demo',1);
 const t:Term={id:'term-fall',orgId:'demo',name:'Fall CTE Skills — six-week demo',startDate:'2026-10-19',endDate:'2026-11-29',timezone:'America/New_York',revision:0};
 db.prepare('INSERT INTO terms VALUES (?,?,?,?,?,?,?)').run(t.id,t.orgId,t.name,t.startDate,t.endDate,t.timezone,0);
 const sec:Section[]=[{id:'cte-mwf',termId:t.id,name:'CTE Studio · M/W/F · 50 min',patterns:[{id:'regular',days:[1,3,5],start:'09:00',durationMinutes:50,parity:'all'}]},{id:'cte-tt',termId:t.id,name:'CTE Lab · T/Th · 75 min',patterns:[{id:'regular',days:[2,4],start:'10:00',durationMinutes:75,parity:'all'}]}];
 for(const s of sec)db.prepare('INSERT INTO sections VALUES (?,?,?,?)').run(s.id,s.termId,s.name,j(s.patterns));
 const initial:CalendarException[]=[
  {id:'holiday-1',sectionId:null,date:'2026-10-26',kind:'holiday',reason:'Synthetic fall holiday',source:'seed'},
  {id:'holiday-2',sectionId:null,date:'2026-11-03',kind:'holiday',reason:'Synthetic school closure',source:'seed'},
  {id:'testing-1',sectionId:null,date:'2026-11-12',kind:'testing',reason:'Synthetic assessment block',source:'seed'}];
 for(const e of initial)db.prepare('INSERT INTO calendar_exceptions VALUES (?,?,?,?,?,?,?,?,?)').run(e.id,t.id,e.sectionId,e.date,null,null,e.kind,e.reason,e.source);
 const uu:Unit[]=[{id:'unit-a',title:'Foundations and routines',ordinal:1},{id:'unit-b',title:'Applied systems',ordinal:2},{id:'unit-c',title:'Capstone and assessment',ordinal:3}];
 for(const u of uu)db.prepare('INSERT INTO units VALUES (?,?,?,?)').run(u.id,t.id,u.title,u.ordinal);
 const names=['Studio orientation','Safety workflows','Design constraints','Systems sketch','Structured data','Data validation','Workflow mapping','Prototype planning','Iteration and feedback','Testing assumptions','Documentation','Communicating findings','Project rehearsal','Fixed practical assessment','Capstone refinement','Presentation and retrospective','Optional portfolio polish','Optional peer showcase'];
 const ll:Lesson[]=names.map((name,i)=>({id:`lesson-${String(i+1).padStart(2,'0')}`,unitId:i<6?'unit-a':i<12?'unit-b':'unit-c',title:name,durationMinutes:i===13?50:i===14||i===15?35:i===16?40:i===17?25:40,required:i<16,splitAllowed:i!==13,mergeAllowed:false,priority:i+1,prerequisites:i===0?[]:[`lesson-${String(i).padStart(2,'0')}`]}));
 // Optional lessons can be independently deferred after all required work.
 ll[16]!.prerequisites=['lesson-16'];ll[17]!.prerequisites=['lesson-16'];
 for(const l of ll)db.prepare('INSERT INTO lessons VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(l.id,t.id,l.unitId,l.title,l.durationMinutes,Number(l.required),Number(l.splitAllowed),Number(l.mergeAllowed),l.priority,j(l.prerequisites),null,null);
 for(const a of [{id:'anchor-mwf',sectionId:'cte-mwf',lessonId:'lesson-14',date:'2026-11-18'},{id:'anchor-tt',sectionId:'cte-tt',lessonId:'lesson-14',date:'2026-11-19'}])db.prepare('INSERT INTO anchors VALUES (?,?,?,?)').run(a.id,a.sectionId,a.lessonId,a.date);
 for(const s of sec){const result=schedule(ll,generateSessions(t,s,initial),anchors(db),s.id);if(!result.feasible)throw new Error(`Seed baseline infeasible for ${s.id}: ${j(result.unsatisfied)}`);writeVersion(db,s.id,result,'Synthetic seed baseline',null,[]);}
 audit(db,'demo.reset','demo','Reset synthetic school scenario');
 return {ok:true};
 });}
export function initializeDemo(db:DatabaseSync){if(!row(db,"SELECT id FROM organizations WHERE id='demo'"))resetDemo(db);}
