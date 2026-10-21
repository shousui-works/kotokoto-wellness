// Read count-only telemetry from old app revisions; never reads chats or account records.
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FirestoreUsageStore} from '../server/admin-usage.mjs';
export function backfillArgs({project,from,to}){
 if(project!=='kotokoto-biyori')throw Error('Explicit --project=kotokoto-biyori required');
 const timestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))return false;
  return new Date(value).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z'));
 };
 if(!timestamp(from)||!timestamp(to)||Date.parse(from)>=Date.parse(to))throw Error('Explicit UTC --from and --to are required; from must precede to');
 const filter=`resource.type="cloud_run_revision" AND resource.labels.service_name="kotokoto-biyori" AND jsonPayload.event="openai_prompt_cache" AND NOT jsonPayload.usageLedgerVersion:* AND timestamp>="${from}" AND timestamp<"${to}"`;
 return ['logging','read',filter,'--project',project,'--limit','5000','--format=json'];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const {values}=parseArgs({options:{project:{type:'string'},from:{type:'string'},to:{type:'string'}}});
const args=backfillArgs(values);
let logs;try{logs=JSON.parse(execFileSync('gcloud',args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch{throw Error('Count-only log lookup failed');}
if(logs.length>=5000)throw Error('Log limit reached; split the import before continuing');
const {initializeApp,applicationDefault,deleteApp}=await import('firebase-admin/app');
const {getFirestore}=await import('firebase-admin/firestore');
const app=initializeApp({projectId:'kotokoto-biyori',credential:applicationDefault()}),store=new FirestoreUsageStore(getFirestore(app,'kotokoto-wellness'));
try{let recorded=0;for(const log of logs){if(!log.insertId||!log.timestamp)continue;const e=log.jsonPayload;if(!['chat','memory'].includes(e.purpose))continue;
 await store.record({purpose:e.purpose,inputTokens:e.inputTokens,cachedTokens:e.cachedTokens,cacheWriteTokens:e.cacheWriteTokens,outputTokens:e.outputTokens,elapsedMs:e.elapsedMs},{responseId:'legacy-log:'+log.insertId,at:log.timestamp,model:'gpt-6-luna',serviceTier:'default',source:'cloud-log'});recorded++;}
 console.log(JSON.stringify({legacyLogEntries:recorded,pricingAssumption:'Standard gpt-6-luna',repeatSafe:true}));
}finally{await deleteApp(app);}
}
