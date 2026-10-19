// Read count-only telemetry from old app revisions; never reads chats or account records.
import {execFileSync} from 'node:child_process';
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {FirestoreUsageStore} from '../server/admin-usage.mjs';
if(process.argv[2]!=='--project=kotokoto-biyori')throw Error('Explicit project required');
const filter='resource.type="cloud_run_revision" AND resource.labels.service_name="kotokoto-biyori" AND jsonPayload.event="openai_prompt_cache" AND NOT jsonPayload.usageLedgerVersion:*';
let logs;try{logs=JSON.parse(execFileSync('gcloud',['logging','read',filter,'--project','kotokoto-biyori','--limit','5000','--format=json'],{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch{throw Error('Count-only log lookup failed');}
if(logs.length>=5000)throw Error('Log limit reached; split the import before continuing');
const app=initializeApp({projectId:'kotokoto-biyori',credential:applicationDefault()}),store=new FirestoreUsageStore(getFirestore(app,'kotokoto-wellness'));
try{let recorded=0;for(const log of logs){if(!log.insertId||!log.timestamp)continue;const e=log.jsonPayload;if(!['chat','memory'].includes(e.purpose))continue;
 await store.record({purpose:e.purpose,inputTokens:e.inputTokens,cachedTokens:e.cachedTokens,cacheWriteTokens:e.cacheWriteTokens,outputTokens:e.outputTokens,elapsedMs:e.elapsedMs},{responseId:'legacy-log:'+log.insertId,at:log.timestamp,model:'gpt-6-luna',serviceTier:'default',source:'cloud-log'});recorded++;}
 console.log(JSON.stringify({legacyLogEntries:recorded,pricingAssumption:'Standard gpt-6-luna',repeatSafe:true}));
}finally{await deleteApp(app);}
