/** School dates are local calendar labels, never instants in a user's timezone. */
export function shiftDate(date:string,days:number):string {
 const d=new Date(`${date}T12:00:00Z`);
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw new Error('Invalid school date');
 d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
export function mondayOf(date:string):string {
 const d=new Date(`${date}T12:00:00Z`);
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw new Error('Invalid school date');
 return shiftDate(date,-((d.getUTCDay()+6)%7));
}
export function asMinute(clock:string):number {
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))throw new Error('Invalid local time');
 const [h,m]=clock.split(':').map(Number);return (h||0)*60+(m||0);
}
export function asClock(minutes:number):string {
 if(!Number.isInteger(minutes)||minutes<0||minutes>=1440)throw new Error('Invalid local minute');
 return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}
/** Snap a timeline drop to a five-minute grid without crossing a closed interval. */
export function snapDropStart(session:{start:string;end:string;segments:{start:string;end:string}[]},duration:number,fraction:number):string|null {
 if(!Number.isFinite(fraction)||!Number.isInteger(duration)||duration<=0)return null;
 const min=asMinute(session.start),max=asMinute(session.end);
 const raw=min+Math.min(1,Math.max(0,fraction))*(max-min);
 const candidates:number[]=[];
 for(const segment of session.segments){
  const lo=asMinute(segment.start),hi=asMinute(segment.end)-duration;
  if(hi<lo)continue;
  for(let at=lo;at<=hi;at+=5)candidates.push(at);
  if(!candidates.includes(hi))candidates.push(hi);
 }
 candidates.sort((a,b)=>Math.abs(a-raw)-Math.abs(b-raw)||a-b);
 return candidates.length?asClock(candidates[0]!):null;
}
