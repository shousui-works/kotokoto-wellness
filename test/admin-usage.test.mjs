import test from 'node:test';import assert from 'node:assert/strict';
import {usageEvent,buildDashboard,MemoryUsageStore,FirestoreUsageStore} from '../server/admin-usage.mjs';
import {createAccountAPI} from '../server/account-api.mjs';import {MemoryAccountStore} from '../server/account-store.mjs';import {Readable} from 'node:stream';
import {captureCacheUsage} from '../server/prompt-cache.mjs';
const entry={purpose:'chat',inputTokens:10000,cachedTokens:4000,cacheWriteTokens:2000,outputTokens:1000,elapsedMs:100};
const meta={responseId:'response-1',at:'2026-10-18T15:01:00Z',model:'gpt-6-luna',serviceTier:'default'};
test('pricing partitions input without double counting cache writes or output reasoning; unknowns stay unpriced',()=>{
 const e=usageEvent(entry,meta);assert.equal(e.date,'2026-10-19');assert.equal(e.costNanos,1190000);
 assert.equal(usageEvent({...entry,inputTokens:300000},meta).costNanos,60130000);
 for(const change of [{cachedTokens:null},{cacheWriteTokens:null},{outputTokens:null},{cachedTokens:11000}])assert.equal(usageEvent({...entry,...change},meta).costNanos,null);
 assert.equal(usageEvent(entry,{...meta,model:'unrecognized'}).costNanos,null);assert.equal(usageEvent(entry,{...meta,serviceTier:'fast'}).costNanos,null);
 assert.equal(JSON.stringify(e).includes('response-1'),false);
});
test('daily metrics are idempotent, distinguish chat/memory and use JST calendar periods',async()=>{
 const store=new MemoryUsageStore();await store.record(entry,meta);await store.record(entry,meta);await store.record({...entry,purpose:'memory'},{...meta,responseId:'response-2',at:'2026-10-18T14:59:00Z'});
 const d=await store.dashboard(7,Date.parse('2026-10-19T00:00:00Z'));assert.equal(d.daily.length,7);assert.equal(d.total.calls,2);assert.equal(d.total.costNanos,2380000);assert.equal(d.byPurpose.chat.calls,1);assert.equal(d.byPurpose.memory.calls,1);assert.equal(d.daily.at(-1).calls,1);
 assert.throws(()=>buildDashboard([],365),/期間/);
});
async function apiCall(api,path,token,method='GET',payload={}){const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(payload))]);Object.assign(req,{url:path,method,headers:{host:'app.test',origin:'https://app.test',...(token?{authorization:'Bearer '+token}:{})}});let status,headers,text;const res={writeHead(s,h){status=s;headers=h;},end(t){text=t;}};await api(req,res,path.split('?')[0]);return {status,headers,body:JSON.parse(text)};}
test('admin routes reject anonymous, forged and normal users; role revocation takes immediate effect',async()=>{
 const admin=new MemoryUsageStore();admin.admins.add('owner');await admin.record(entry,meta);
 const api=createAccountAPI({store:new MemoryAccountStore(),config:{},admin,verify:async token=>{if(!['owner','normal'].includes(token))throw Error();return {uid:token};},now:()=>Date.parse('2026-10-19T00:00:00Z')});
 for(const token of [null,'forged'])assert.equal((await apiCall(api,'/api/admin/dashboard',token)).status,401);
 assert.equal((await apiCall(api,'/api/admin/dashboard','normal')).status,403);assert.equal((await apiCall(api,'/api/admin/session','normal')).body.admin,false);
 const ok=await apiCall(api,'/api/admin/dashboard?days=7','owner');assert.equal(ok.status,200);assert.equal(ok.headers['Cache-Control'],'no-store');assert.equal(ok.body.total.calls,1);assert.equal(JSON.stringify(ok.body).includes('owner'),false);
 assert.equal((await apiCall(api,'/api/admin/dashboard?days=9999','owner')).status,400);
 assert.equal((await apiCall(api,'/api/admin/dashboard','owner','POST',{admin:true})).status,404);
 admin.admins.delete('owner');assert.equal((await apiCall(api,'/api/admin/dashboard','owner')).status,403);
});
test('accounting is awaited and a write failure does not turn a paid response into a retry',async()=>{
 let saved=false;await captureCacheUsage('chat',{id:'response-test',model:'gpt-6-luna',service_tier:'default',usage:{input_tokens:3,output_tokens:1,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}},1,async(e,m)=>{await Promise.resolve();saved=m.responseId==='response-test'&&e.inputTokens===3;});assert.equal(saved,true);
 await captureCacheUsage('chat',{usage:{}},1,async()=>{throw Error('storage');});
});
// Exercise real transaction structure with a Firestore-shaped repository, including duplicate writes.
test('Firestore accounting writes minimal events and one daily aggregate atomically',async()=>{
 const docs=new Map(),ref=path=>({path,doc:id=>ref(path+'/'+id),get:async()=>({data:()=>docs.get(path)})}),db={collection:name=>ref(name),async runTransaction(fn){await fn({get:async r=>({exists:docs.has(r.path),data:()=>docs.get(r.path)}),set:(r,v)=>docs.set(r.path,structuredClone(v))});}};
 const store=new FirestoreUsageStore(db);await store.record(entry,meta);await store.record(entry,meta);assert.equal(docs.size,2);assert.equal(docs.get('aiUsageDays/2026-10-19').calls,1);assert.equal([...docs.keys()].filter(k=>k.startsWith('aiUsageEvents/')).length,1);
 assert.equal(await store.isAdmin('normal'),false);docs.set('adminRoles/owner',{enabled:true});assert.equal(await store.isAdmin('owner'),true);
});

test('user totals deduplicate responses, combine days, and exclude unattributed legacy usage from averages',async()=>{
 const store=new MemoryUsageStore(),now=Date.parse('2026-10-19T01:00:00Z');
 await store.record(entry,{...meta,uid:'alice'});await store.record(entry,{...meta,uid:'bob'}); // same response must not move users
 await store.record({...entry,purpose:'memory'},{...meta,responseId:'a-2',uid:'alice',at:'2026-10-17T15:01:00Z'});
 await store.record(entry,{...meta,responseId:'b-1',uid:'bob'});
 await store.record(entry,{...meta,responseId:'legacy'});
 await store.record(entry,{...meta,responseId:'outside',uid:'other',at:'2026-09-01T00:00:00Z'});
 const d=await store.dashboard(7,now);assert.equal(d.total.calls,4);assert.equal(d.userSummary.activeUsers,2);assert.equal(d.userSummary.unattributedCalls,1);assert.equal(d.userSummary.perUser.calls,1.5);assert.equal(d.userSummary.perUser.costNanos,1785000);assert.equal(d.userSummary.perCall.costNanos,1190000);
 assert.equal(d.users[0].uid,'alice');assert.equal(d.users[0].calls,2);assert.equal(d.users[0].activeDays,2);assert.equal(d.users[1].calls,1);
 assert.equal(store.events.get('response-1').uid,undefined);assert.equal(store.events.get('response-1').userKey.length,64);
 const empty=await store.dashboard(7,Date.parse('2026-01-01'));assert.equal(empty.userSummary.perUser,null);assert.equal(empty.userSummary.perCall,null);
});
test('Firestore user aggregates are atomic with global aggregates and cannot double-count retries',async()=>{
 const docs=new Map(),ref=path=>({path,doc:id=>ref(path+'/'+id)}),db={collection:name=>ref(name),async runTransaction(fn){let writing=false;await fn({get:async r=>{assert.equal(writing,false);return {exists:docs.has(r.path),data:()=>docs.get(r.path)};},set:(r,v)=>{writing=true;docs.set(r.path,structuredClone(v));}});}};
 const store=new FirestoreUsageStore(db);await store.record(entry,{...meta,uid:'alice'});await store.record(entry,{...meta,uid:'bob'});
 assert.equal(docs.size,3);const u=[...docs].find(([k])=>k.startsWith('aiUsageUserDays/'))[1];assert.equal(u.uid,'alice');assert.equal(u.calls,1);assert.equal(u.byPurpose.chat.calls,1);
});

test('a stalled accounting store cannot indefinitely hold a completed paid response',async()=>{
 let deadline;
 try{
  const outcome=await Promise.race([
   captureCacheUsage('chat',{id:'response-stalled',usage:{}},1,()=>new Promise(()=>{}),{timeoutMs:10}).then(()=>'returned'),
   new Promise(resolve=>{deadline=setTimeout(()=>resolve('stalled'),100);})
  ]);
  assert.equal(outcome,'returned');
 }finally{clearTimeout(deadline);}
});

test('unpriced attributed usage never becomes a zero or understated cost average',async()=>{
 const store=new MemoryUsageStore(),now=Date.parse('2026-10-19T01:00:00Z');
 await store.record(entry,{...meta,uid:'unknown',serviceTier:'unknown'});
 let d=await store.dashboard(7,now);assert.equal(d.userSummary.perUser.costNanos,null);assert.equal(d.userSummary.perCall.costNanos,null);
 await store.record(entry,{...meta,responseId:'known',uid:'known'});
 d=await store.dashboard(7,now);assert.equal(d.userSummary.activeUsers,2);assert.equal(d.userSummary.perUser.calls,1);assert.equal(d.userSummary.perCall.inputTokens,10000);assert.equal(d.userSummary.attributed.costNanos,1190000);assert.equal(d.userSummary.perUser.costNanos,null);assert.equal(d.userSummary.perCall.costNanos,null);
});
test('admin renders unknown cost averages as unavailable, including per-user rows',async()=>{
 const {readFile}=await import('node:fs/promises'),{default:vm}=await import('node:vm');
 const source=await readFile(new URL('../dist/admin.mjs',import.meta.url),'utf8');
 const store=new MemoryUsageStore();await store.record(entry,{...meta,uid:'unknown',serviceTier:'unknown'});await store.record(entry,{...meta,responseId:'known',uid:'known'});
 const data=await store.dashboard(7,Date.parse('2026-10-19T01:00:00Z')),nodes=new Map(),tables={};
 const context={data,$:id=>{if(!nodes.has(id))nodes.set(id,{style:{}});return nodes.get(id);},number:String,money:n=>'$'+(n/1e9).toFixed(6),percent:()=>'',rows:(id,values)=>tables[id]=values,chart(){},Intl,Date};
 vm.runInNewContext(source.slice(source.indexOf('function render(){'),source.indexOf('async function load(){'))+'render();',context);
 assert.equal(nodes.get('average-cost').textContent,'—');assert.equal(nodes.get('call-cost').textContent,'—');
 assert.equal(tables['user-rows'].find(r=>r[0]==='unknown').at(-2),'—');assert.equal(tables['user-rows'].find(r=>r[0]==='unknown').at(-1),'—');assert.equal(tables['user-rows'].find(r=>r[0]==='known').at(-1),'$0.001190');
});

test('dashboard uses one read-only snapshot while usage changes between queries',async()=>{
 let calls=1,transactions=0;const reads=[];
 const snapshot=(name,count)=>({size:1,docs:[{data:()=>({date:'2026-10-19',calls:count,...(name==='aiUsageUserDays'?{uid:'alice'}:{})})}]});
 const db={collection(name){const q={name,where(){return q;},orderBy(){return q;},limit(n){assert.equal(n,10001);return q;},async get(){const result=snapshot(name,calls);calls++;return result;}};return q;},async runTransaction(fn,options){assert.deepEqual(options,{readOnly:true});transactions++;const captured=calls;return fn({get:async q=>{reads.push(q.name);const result=snapshot(q.name,captured);calls++;return result;}});}};
 const d=await new FirestoreUsageStore(db).dashboard(7,Date.parse('2026-10-19T01:00:00Z'));
 assert.equal(d.total.calls,d.userSummary.attributed.calls);assert.equal(d.userSummary.unattributedCalls,0);assert.equal(transactions,1);assert.deepEqual(reads,['aiUsageDays','aiUsageUserDays']);
});
test('consistent dashboard reads retain the user-day result limit',async()=>{
 const db={collection(name){const q={name,where(){return q;},orderBy(){return q;},limit(n){assert.equal(n,10001);return q;}};return q;},async runTransaction(fn,options){assert.deepEqual(options,{readOnly:true});return fn({get:async q=>({size:q.name==='aiUsageUserDays'?10001:0,docs:[]})});}};
 await assert.rejects(new FirestoreUsageStore(db).dashboard(7),e=>e.status===413&&e.code==='usage_range_too_large');
});
