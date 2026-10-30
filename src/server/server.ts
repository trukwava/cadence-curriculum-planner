import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDb,initializeDemo,getState,generateBaseline,previewDisruption,decide,restore,resetDemo,activeVersion,ensureSection,term,lessons,addException,patchLesson,patchTerm,patchSection,patchAnchor,addLesson,addUnit} from './db.js';
import {exactFixture} from './fixtures.js';
const root=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const db=openDb(process.env.DB_PATH||resolve(root,'data/demo.sqlite'));initializeDemo(db);
const host=process.env.HOST||'127.0.0.1';const port=Number(process.env.PORT||4173);
function json(res:ServerResponse,status:number,body:unknown){const bytes=Buffer.from(JSON.stringify(body));res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);}
function csvCell(x:string):string{return /[",\r\n]/.test(x)?`"${x.replaceAll('"','""')}"`:x;}
function exportCSV(sectionId:string){ensureSection(db,sectionId);const p=activeVersion(db,sectionId);if(!p)throw new Error('No accepted plan');const names=new Map(lessons(db).map(l=>[l.id,l.title]));const lines=[['Date','Start (school local)','End (school local)','Timezone','Section','Lesson','Minutes','Version'],...p.snapshot.result.allocations.map(a=>[a.date,a.start,a.end,term(db).timezone,sectionId,names.get(a.lessonId)||a.lessonId,String(a.minutes),String(p.versionNo)])];return lines.map(line=>line.map(csvCell).join(',')).join('\r\n')+'\r\n';}
const icsEscape=(s:string)=>s.replaceAll('\\','\\\\').replaceAll(';','\\;').replaceAll(',','\\,').replaceAll('\n','\\n');
function exportICS(sectionId:string){ensureSection(db,sectionId);const p=activeVersion(db,sectionId);if(!p)throw new Error('No accepted plan');const names=new Map(lessons(db).map(l=>[l.id,l.title]));const compact=(s:string)=>s.replaceAll('-','').replaceAll(':','');const nowUTC=new Date().toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Curriculum Recovery//Synthetic Demo//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${icsEscape(sectionId+' curriculum plan')}`,`X-WR-TIMEZONE:${term(db).timezone}`];
 for(const a of p.snapshot.result.allocations)lines.push('BEGIN:VEVENT',`UID:${icsEscape(p.id+'-'+a.id)}@curriculum-recovery.local`,`DTSTAMP:${nowUTC}`,`DTSTART:${compact(a.date)}T${compact(a.start)}00`,`DTEND:${compact(a.date)}T${compact(a.end)}00`,`SUMMARY:${icsEscape(names.get(a.lessonId)||a.lessonId)}`,`DESCRIPTION:${icsEscape(`Synthetic demo; version ${p.versionNo}; school timezone ${term(db).timezone}. Times are floating local wall-clock times.`)}`,'END:VEVENT');
 lines.push('END:VCALENDAR');return lines.join('\r\n')+'\r\n';
}
async function body(req:IncomingMessage){if(!(req.headers['content-type']||'').startsWith('application/json'))throw new Error('Send application/json');let raw='';for await(const chunk of req){raw+=String(chunk);if(raw.length>32768)throw new Error('Request too large');}if(!raw)throw new Error('JSON body required');const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JSON object required');return value as Record<string,any>;}
function textResponse(res:ServerResponse,data:string,contentType:string,filename?:string){const bytes=Buffer.from(data);res.writeHead(200,{'Content-Type':contentType,'Content-Length':bytes.length,'Cache-Control':'no-store','Content-Disposition':filename?`attachment; filename="${filename}"`:'inline','X-Content-Type-Options':'nosniff'});res.end(bytes);}
async function handler(req:IncomingMessage,res:ServerResponse){try{
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
 res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 if(!['GET','HEAD'].includes(req.method||'')&&req.headers.origin&&req.headers.origin!==`http://${host}:${port}`)throw new Error('Cross-origin changes are blocked');
 const pathname=new URL(req.url||'/',`http://${host}:${port}`).pathname;
 if(req.method==='GET'&&pathname==='/api/state')return json(res,200,getState(db));
 if(req.method==='GET'&&pathname==='/api/fixture')return json(res,200,exactFixture());
 if(req.method==='GET'&&pathname==='/api/health')return json(res,200,{ok:true,database:'local SQLite',mode:'synthetic-demo'});
 if(req.method==='GET'&&pathname.startsWith('/api/export/')){
  const match=/^\/api\/export\/(cte-mwf|cte-tt)\.(csv|ics)$/.exec(pathname);if(!match)return json(res,404,{error:'Export not found'});
  const [,id,format]=match;return format==='csv'?textResponse(res,exportCSV(id!),'text/csv; charset=utf-8',`${id}-plan.csv`):textResponse(res,exportICS(id!),'text/calendar; charset=utf-8',`${id}-plan.ics`);
 }
 if(req.method==='POST'&&pathname==='/api/units'){const x=await body(req);return json(res,200,addUnit(db,x as any));}
 if(req.method==='POST'&&pathname==='/api/lessons'){const x=await body(req);return json(res,200,addLesson(db,x as any));}
 if(req.method==='POST'&&pathname==='/api/reset')return json(res,200,resetDemo(db));
 if(req.method==='POST'&&pathname==='/api/baseline'){const x=await body(req);return json(res,200,generateBaseline(db,String(x.sectionId||'')));}
 if(req.method==='POST'&&pathname==='/api/disruptions/preview'){const x=await body(req);return json(res,200,previewDisruption(db,x as any));}
 if(req.method==='POST'&&pathname==='/api/calendar/exception'){const x=await body(req);return json(res,200,addException(db,x as any));}
 if(req.method==='PATCH'&&/^\/api\/anchors\/[^/]+\/[^/]+$/.test(pathname)){const x=await body(req);return json(res,200,patchAnchor(db,pathname.split('/')[3]!,pathname.split('/')[4]!,String(x.date||'')));}
 if(req.method==='PATCH'&&pathname==='/api/term'){const x=await body(req);return json(res,200,patchTerm(db,x));}
 if(req.method==='PATCH'&&/^\/api\/sections\/[^/]+$/.test(pathname)){const x=await body(req);return json(res,200,patchSection(db,pathname.split('/').at(-1)!,x));}
 if(req.method==='PATCH'&&/^\/api\/lessons\/[^/]+$/.test(pathname)){const x=await body(req);return json(res,200,patchLesson(db,pathname.split('/').at(-1)!,x));}
 const match=pathname.match(/^\/api\/proposals\/([\w-]+)\/(accept|reject)$/);
 if(req.method==='POST'&&match)return json(res,200,decide(db,match[1]!,match[2] as 'accept'|'reject'));
 if(req.method==='POST'&&pathname==='/api/restore'){const x=await body(req);return json(res,200,restore(db,String(x.sectionId||''),String(x.versionId||'')));}
 if(req.method==='GET'){
  const file={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/dist/app.js':'dist/app.js'}[pathname];
  if(file){const ct=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html';return textResponse(res,readFileSync(resolve(root,'public',file)).toString('utf-8'),ct+'; charset=utf-8');}
 }
 json(res,404,{error:'Unknown endpoint'});
 }catch(e){const msg=e instanceof Error?e.message:'Unexpected failure';json(res,/unknown|not found|missing/i.test(msg)?404:400,{error:msg});}}
export const app=createServer((req,res)=>{void handler(req,res);});
if(process.env.NODE_ENV!=='test')app.listen(port,host,()=>console.log(`Curriculum Recovery demo: http://${host}:${port}`));
