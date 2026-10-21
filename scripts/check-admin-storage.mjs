// Isolated synthetic collections only; cleaned up afterwards. No real usage or accounts.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';import {getFirestore} from 'firebase-admin/firestore';import {FirestoreUsageStore} from '../server/admin-usage.mjs';
if(process.argv[2]!=='--project=kotokoto-biyori')throw Error('Explicit project required');
const app=initializeApp({projectId:'kotokoto-biyori',credential:applicationDefault()}),db=getFirestore(app,'kotokoto-wellness'),prefix='admin-test-'+randomUUID()+'-';
const store=new FirestoreUsageStore({collection:name=>db.collection(prefix+name),runTransaction:(fn,options)=>db.runTransaction(fn,options)});
try{assert.equal(await store.isAdmin('synthetic'),false);await db.collection(prefix+'adminRoles').doc('synthetic').set({enabled:true});assert.equal(await store.isAdmin('synthetic'),true);
 const entry={purpose:'chat',inputTokens:4000,cachedTokens:3000,cacheWriteTokens:100,outputTokens:100,elapsedMs:1000},meta={responseId:'synthetic-response',model:'gpt-6-luna',serviceTier:'default',uid:'synthetic'};
 await Promise.all([store.record(entry,meta),store.record(entry,meta)]);const d=await store.dashboard(7);assert.equal(d.total.calls,1);assert.equal(d.total.inputTokens,4000);assert.equal(d.byPurpose.chat.calls,1);assert.equal(d.users.length,1);assert.equal(d.users[0].uid,'synthetic');assert.equal(d.userSummary.perUser.calls,1);
 console.log('PASS: real Firestore authorization, concurrent deduplication and dashboard query using isolated synthetic collections');
}finally{for(const name of ['adminRoles','aiUsageEvents','aiUsageDays','aiUsageUserDays'])await db.recursiveDelete(db.collection(prefix+name));await deleteApp(app);}
