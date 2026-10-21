import {createHash} from 'node:crypto';
// USD nanos per token; Standard Responses API, verified 2026-10-19.
export const PRICING={model:'gpt-6-luna',asOf:'2026-10-19',source:'https://developers.openai.com/api/docs/models/gpt-6-luna',short:{input:100,cached:10,write:125,output:500},long:{input:200,cached:20,write:250,output:750}};
const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export const usageDay=at=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
export const emptyUsage=()=>({calls:0,inputTokens:0,cachedTokens:0,cacheWriteTokens:0,outputTokens:0,elapsedMs:0,costNanos:0,unpricedCalls:0,incompleteUsageCalls:0});
export function usageEvent(entry,meta={}){
  if(!['chat','memory'].includes(entry.purpose))throw Error('Invalid usage purpose');
  const at=new Date(meta.at??Date.now()).toISOString(),input=count(entry.inputTokens),cached=count(entry.cachedTokens),write=count(entry.cacheWriteTokens),output=count(entry.outputTokens);
  const valid=[input,cached,write,output].every(x=>x!==null)&&cached+write<=input;
  const knownModel=meta.model==='gpt-6-luna'||/^gpt-6-luna-\d/.test(meta.model??'');
  const tier=meta.serviceTier??'unknown',rates=input>272000?PRICING.long:PRICING.short;
  const cost=valid&&knownModel&&tier==='default'?(input-cached-write)*rates.input+cached*rates.cached+write*rates.write+output*rates.output:null;
  return {version:1,at,date:usageDay(at),purpose:entry.purpose,model:knownModel?'gpt-6-luna':'unknown',serviceTier:['default','flex','fast','priority'].includes(tier)?tier:'unknown',inputTokens:input,cachedTokens:cached,cacheWriteTokens:write,outputTokens:output,elapsedMs:count(entry.elapsedMs),costNanos:cost,pricingDate:PRICING.asOf,source:meta.source==='cloud-log'?'cloud-log':'api'};
}
export function addUsage(total,event){
 const next={...emptyUsage(),...total};next.calls++;
 for(const key of ['inputTokens','cachedTokens','cacheWriteTokens','outputTokens','elapsedMs'])next[key]+=event[key]??0;
 if(event.costNanos===null)next.unpricedCalls++;else next.costNanos+=event.costNanos;
 if(['inputTokens','cachedTokens','cacheWriteTokens','outputTokens'].some(k=>event[k]===null))next.incompleteUsageCalls++;
 return next;
}
export function buildDashboard(rows,days=30,now=Date.now()){
 if(![7,30,90].includes(days))throw Object.assign(Error('期間は7・30・90日から選んでください。'),{status:400,code:'invalid_range'});
 const end=usageDay(now),start=new Date(end+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-days+1);const begin=start.toISOString().slice(0,10);
 const byDay=new Map(rows.filter(r=>r.date>=begin&&r.date<=end).map(r=>[r.date,r]));
 const daily=[];for(let i=0;i<days;i++){const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);const date=d.toISOString().slice(0,10);daily.push({date,...emptyUsage(),...byDay.get(date)});}
 const total=emptyUsage(),byPurpose={chat:emptyUsage(),memory:emptyUsage()};
 for(const day of daily){for(const k of Object.keys(total))total[k]+=day[k]??0;for(const p of ['chat','memory'])for(const k of Object.keys(total))byPurpose[p][k]+=day.byPurpose?.[p]?.[k]??0;}
 return {days,from:begin,to:end,timezone:'Asia/Tokyo',currency:'USD',generatedAt:new Date(now).toISOString(),pricing:PRICING,total,byPurpose,daily};
}
export class FirestoreUsageStore{
 constructor(db){this.db=db;}
 async isAdmin(uid){return (await this.db.collection('adminRoles').doc(uid).get()).data()?.enabled===true;}
 async record(entry,meta){
  if(typeof meta?.responseId!=='string'||!meta.responseId)throw Error('Usage ID required');
  const event=usageEvent(entry,meta),id=createHash('sha256').update(meta.responseId).digest('hex'),ref=this.db.collection('aiUsageEvents').doc(id),day=this.db.collection('aiUsageDays').doc(event.date);
  await this.db.runTransaction(async tx=>{
   if((await tx.get(ref)).exists)return;
   if(meta.source==='cloud-log'&&meta.legacyResponseId){
    const legacyId=createHash('sha256').update(meta.legacyResponseId).digest('hex'),legacyRef=this.db.collection('aiUsageEvents').doc(legacyId),legacy=(await tx.get(legacyRef)).data();
    const fields=['at','source','purpose','model','serviceTier','inputTokens','cachedTokens','cacheWriteTokens','outputTokens','elapsedMs'];
    if(legacy&&!legacy.canonicalEventId&&fields.every(key=>legacy[key]===event[key])){
     // Old events lost sub-millisecond precision. Never guess between matching source logs.
     if(meta.legacyMatchCount!==1)throw Error('Ambiguous legacy usage; reconcile the original log before importing');
     tx.set(legacyRef,{...legacy,canonicalEventId:id});tx.set(ref,{version:1,legacyEventId:legacyId});return;
    }
   }
   const current=(await tx.get(day)).data()??{date:event.date,...emptyUsage(),byPurpose:{}};
   const next=addUsage(current,event);next.date=event.date;next.byPurpose={...current.byPurpose,[event.purpose]:addUsage(current.byPurpose?.[event.purpose],event)};next.updatedAt=event.at;
   tx.set(ref,event);tx.set(day,next);
  });
 }
 async dashboard(days,now=Date.now()){
  const range=buildDashboard([],days,now);
  const data=await this.db.collection('aiUsageDays').where('date','>=',range.from).where('date','<=',range.to).orderBy('date').get();
  return buildDashboard(data.docs.map(d=>d.data()),days,now);
 }
}
export class MemoryUsageStore{
 constructor(){this.admins=new Set();this.events=new Map();this.days=new Map();}
 async isAdmin(uid){return this.admins.has(uid);}
 async record(entry,meta){if(this.events.has(meta.responseId))return;const e=usageEvent(entry,meta);this.events.set(meta.responseId,e);const old=this.days.get(e.date)??{date:e.date,...emptyUsage(),byPurpose:{}};this.days.set(e.date,{...addUsage(old,e),date:e.date,byPurpose:{...old.byPurpose,[e.purpose]:addUsage(old.byPurpose[e.purpose],e)}});}
 async dashboard(days,now=Date.now()){return buildDashboard([...this.days.values()],days,now);}
}
