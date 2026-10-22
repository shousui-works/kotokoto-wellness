import test from 'node:test';
import assert from 'node:assert/strict';
import {backfillArgs,backfillRecords} from '../scripts/backfill-ai-usage.mjs';
import {FirestoreUsageStore} from '../server/admin-usage.mjs';
const range={project:'kotokoto-biyori',from:'2020-01-01T00:00:00Z',to:'2020-02-01T00:00:00Z'};

test('backfill requests the explicit historical range instead of the implicit last day',()=>{
 const args=backfillArgs(range),filter=args[2];
 assert.deepEqual(args.slice(0,2),['logging','read']);
 assert.ok(filter.includes('timestamp>="'+range.from+'"'));
 assert.ok(filter.includes('timestamp<"'+range.to+'"'));
 assert.ok(filter.includes('NOT jsonPayload.usageLedgerVersion:*'));
 assert.ok(filter.includes('jsonPayload.event="openai_prompt_cache"'));
 assert.deepEqual(args.slice(3),['--project','kotokoto-biyori','--limit','5000','--format=json']);
});

test('backfill rejects missing bounds, invalid dates and unexpected projects before any external work',()=>{
 for(const change of [{project:'other-project'},{from:undefined},{to:undefined},{from:range.to},{from:'2021-01-01T00:00:00Z'},{from:'2020-02-30T00:00:00Z'},{from:'2020-01-01'},{from:'2020-01-01T00:00:00Z" OR severity>=INFO'}]){
  assert.throws(()=>backfillArgs({...range,...change}),/required|Explicit/);
 }
});

test('backfill accepts precise UTC bounds without changing their half-open interval',()=>{
 const from='2020-01-01T00:00:00.123Z',to='2020-01-01T00:00:00.124Z';
 const filter=backfillArgs({...range,from,to})[2];
 assert.ok(filter.includes('timestamp>="'+from+'"'));
 assert.ok(filter.includes('timestamp<"'+to+'"'));
});

// Transactions are serialized and staged: a thrown error cannot leak partial writes.
function repository(){
 const docs=new Map();let tail=Promise.resolve();
 const ref=path=>({path,doc:id=>ref(path+'/'+id)});
 const db={collection:name=>ref(name),runTransaction(fn){
  const task=tail.then(async()=>{const writes=new Map();let writing=false;
   await fn({get:async r=>{assert.equal(writing,false,'Firestore requires reads before writes');return {exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))};},set:(r,value)=>{writing=true;writes.set(r.path,structuredClone(value));}});
   for(const [key,value]of writes)docs.set(key,value);
  });tail=task.catch(()=>{});return task;
 }};
 return {store:new FirestoreUsageStore(db),docs,calls:()=>[...docs.entries()].filter(([key])=>key.startsWith('aiUsageDays/')).reduce((sum,[,day])=>sum+day.calls,0)};
}
const log=(timestamp,insertId='same-id')=>({insertId,timestamp,jsonPayload:{purpose:'chat',inputTokens:100,cachedTokens:0,cacheWriteTokens:0,outputTokens:10,elapsedMs:1}});
async function importRows(store,logs){for(const row of backfillRecords(logs))await store.record(row.entry,row.meta);}
async function seedOld(store,row){const {entry,meta}=backfillRecords([row])[0];await store.record(entry,{...meta,responseId:meta.legacyResponseId,legacyResponseId:undefined});}

test('different nanosecond timestamps with the same insertId remain distinct; normalized replays do not add usage',async()=>{
 const r=repository(),logs=[log('2026-10-18T01:00:00.123456Z'),log('2026-10-18T01:00:00.123457Z')];
 await importRows(r.store,logs);assert.equal(r.calls(),2);
 await importRows(r.store,logs);await importRows(r.store,[log('2026-10-18T01:00:00.123456000Z')]);assert.equal(r.calls(),2);
 assert.notEqual(backfillRecords(logs)[0].meta.responseId,backfillRecords(logs)[1].meta.responseId);
});

test('an old imported event is aliased without incrementing aggregates, while another time is counted',async()=>{
 const r=repository(),old=log('2026-10-18T01:00:00.123456Z'),other=log('2026-10-18T02:00:00.123456Z');
 await seedOld(r.store,old);assert.equal(r.calls(),1);
 const dayBefore=structuredClone(r.docs.get('aiUsageDays/2026-10-18'));
 await importRows(r.store,[old]);assert.deepEqual(r.docs.get('aiUsageDays/2026-10-18'),dayBefore);
 assert.equal([...r.docs.values()].filter(e=>e.legacyEventId).length,1);
 await Promise.all([importRows(r.store,[other,old]),importRows(r.store,[old,other])]);assert.equal(r.calls(),2);
 await seedOld(r.store,old);assert.equal(r.calls(),2,'an old script still finds its original key');
});

test('ambiguous sub-millisecond matches to an old event stop without changing the ledger',async()=>{
 const r=repository(),first=log('2026-10-18T01:00:00.123456Z'),second=log('2026-10-18T01:00:00.123457Z');
 await seedOld(r.store,first);const before=structuredClone([...r.docs]);
 await assert.rejects(importRows(r.store,[first,second]),/Ambiguous legacy usage/);
 assert.deepEqual([...r.docs],before);
});

test('duplicate representations of the same timestamp do not make old-key compatibility ambiguous',async()=>{
 const r=repository(),old=log('2026-10-18T01:00:00Z');await seedOld(r.store,old);
 await importRows(r.store,[old,log('2026-10-18T01:00:00.000000000Z')]);assert.equal(r.calls(),1);
});
