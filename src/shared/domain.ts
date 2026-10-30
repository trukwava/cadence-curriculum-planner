export type LocalDate = string; // YYYY-MM-DD, NEVER a UTC timestamp
export type LocalTime = string; // HH:mm
export type Parity = 'all'|'odd'|'even';
export type ExceptionKind = 'holiday'|'testing'|'pd'|'closure'|'partial'|'cancelled'|'extra';
export interface Term {id:string; orgId:string; name:string; startDate:LocalDate; endDate:LocalDate; timezone:string; revision:number;}
export interface MeetingPattern {id:string; days:number[]; start:LocalTime; durationMinutes:number; parity:Parity;}
export interface Section {id:string; termId:string; name:string; patterns:MeetingPattern[];}
export interface CalendarException {id:string; sectionId:string|null; date:LocalDate; start?:LocalTime; end?:LocalTime; kind:ExceptionKind; reason:string; source:'seed'|'teacher';}
export interface Disruption {id:string; sectionId:string; date:LocalDate; start:LocalTime; end:LocalTime; reason:string; active:boolean;}
export interface Segment {start:LocalTime; end:LocalTime; minutes:number;}
export interface InstructionalSession {id:string; sectionId:string; date:LocalDate; start:LocalTime; end:LocalTime; originalMinutes:number; availableMinutes:number; segments:Segment[]; exclusions:{id:string;reason:string;minutes:number}[]; extra:boolean;}
export interface Unit {id:string; title:string; ordinal:number;}
export interface Lesson {id:string; unitId:string; title:string; durationMinutes:number; durationSessions?:number; required:boolean; splitAllowed:boolean; mergeAllowed:boolean; priority:number; prerequisites:string[]; resourceUrl?:string;}
export interface Anchor {id:string; sectionId:string; lessonId:string; date:LocalDate;}
export interface Allocation {id:string; lessonId:string; sessionId:string; date:LocalDate; start:LocalTime; end:LocalTime; minutes:number;}
export interface PlanResult {feasible:boolean; allocations:Allocation[]; deferredLessonIds:string[]; unsatisfied:{lessonId:string;missingMinutes:number;reason:string}[]; errors:string[]; neededMinutes:number; capacityMinutes:number; requiredMinutes:number; optionalMinutes:number; shortageMinutes:number; usedMinutes:number; remainingMinutes:number;}
export interface PlanVersion {id:string; sectionId:string; versionNo:number; createdAt:string; sourceVersionId:string|null; reason:string; curriculumRevision:number; snapshot:{result:PlanResult; disruptions:string[]};}
export interface Proposal {id:string; sectionId:string; sourceVersionId:string; curriculumRevision:number; createdAt:string; status:'draft'|'accepted'|'rejected'; strategy:'retain'|'defer'; disruption:Disruption; result:PlanResult; changes:{movedLessonIds:string[]; affectedMinutes:number; deferredLessonIds:string[]};}
export interface TeacherDecision {id:string; proposalId:string; decision:'accept'|'reject'; at:string;}
export interface AuditEvent {id:string; kind:string; entityId:string; at:string; detail:string;}
export function assertLocalDate(s:string):void { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Date must be YYYY-MM-DD'); const d=new Date(`${s}T12:00:00Z`); if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==s)throw new Error('Invalid school date'); }
export function assertTime(s:string):void {if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw new Error('Time must be HH:mm');}
export function minute(s:string):number {assertTime(s); const [h,m]=s.split(':').map(Number);return (h||0)*60+(m||0);}
export function time(n:number):string {if (!Number.isInteger(n)||n<0||n>=1440)throw new Error('Time outside local day');return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
export function dateOrdinal(s:string):number {assertLocalDate(s);return Math.floor(Date.parse(`${s}T12:00:00Z`)/86400000);}
export function addDays(s:string,n:number):string {return new Date(Date.parse(`${s}T12:00:00Z`)+n*86400000).toISOString().slice(0,10);}
