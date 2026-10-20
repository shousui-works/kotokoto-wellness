import {createPushRuntime} from './push-runtime.mjs';
import {FirestoreUsageStore} from './admin-usage.mjs';
import {createDailySummarizer} from './owner-memory.mjs';
import {createAccountAPI} from './account-api.mjs';
import {FirestoreAccountStore} from './account-store.mjs';
import {createReportGenerator} from './komugi-chat.mjs';
export async function createFirebaseRuntime(env=process.env){
  const mode=env.ACCOUNT_MODE??'legacy';if(!['legacy','required'].includes(mode))throw Error('Invalid ACCOUNT_MODE');
  if(mode==='legacy')return async(req,res,path)=>{if(path!=='/api/account/config')return false;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"mode":"legacy"}');return true;};
  for(const key of ['GOOGLE_CLOUD_PROJECT','FIRESTORE_DATABASE_ID','FIREBASE_WEB_APP_ID','FIREBASE_AUTH_DOMAIN','FIREBASE_PUBLIC_API_KEY'])if(!env[key])throw Error(`Missing ${key}`);
  const {initializeApp,applicationDefault}=await import('firebase-admin/app');
  const {getAuth}=await import('firebase-admin/auth');const {getFirestore}=await import('firebase-admin/firestore');
  const app=initializeApp({credential:applicationDefault(),projectId:env.GOOGLE_CLOUD_PROJECT});
  const db=getFirestore(app,env.FIRESTORE_DATABASE_ID),store=new FirestoreAccountStore(db),admin=new FirestoreUsageStore(db);
  const onUsage=(entry,meta)=>admin.record(entry,meta);
  return createAccountAPI({store,admin,push:createPushRuntime(db,env),verify:token=>getAuth(app).verifyIdToken(token,true),generate:createReportGenerator({timeoutMs:25000,onUsage}),summarize:createDailySummarizer({onUsage}),apiAvailable:!!env.OPENAI_API_KEY,config:{projectId:env.GOOGLE_CLOUD_PROJECT,appId:env.FIREBASE_WEB_APP_ID,authDomain:env.FIREBASE_AUTH_DOMAIN,apiKey:env.FIREBASE_PUBLIC_API_KEY}});
}
