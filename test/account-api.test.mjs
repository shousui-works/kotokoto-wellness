import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {emptyState} from '../dist/model.mjs';
const config={projectId:'example-project',authDomain:'app.example.com',appId:'test',apiKey:'public'};
function fixture({actions=[],firstFailure=null,interactionUpdate=null}={}){const store=new MemoryAccountStore();let calls=0,clock=Date.parse('2026-10-19T03:00:00Z'),resolve,lastInput;
 const generate=async input=>{calls++;lastInput=input;if(resolve)await resolve.promise;if(calls===1&&firstFailure)return firstFailure;return {status:200,body:{requestId:input.requestId,reply:'会いに来てくれてうれしいよ。',actions,interactionUpdate}};};
 const api=createAccountAPI({store,config,verify:async token=>{if(!['alice','bob'].includes(token))throw Error();return {uid:token};},generate,now:()=>clock});
 async function request(path,method='GET',data,token='alice',origin='https://app.example.com'){
  const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;req.url=path;req.headers={host:'app.example.com',origin,...(token?{authorization:`Bearer ${token}`}:{})};let status,headers,body;
  const res={writeHead(s,h){status=s;headers=h;},end(b){body=b?JSON.parse(b.toString()):null;}};
  assert.equal(await api(req,res,path),true);return {status,headers,body};
 }
 async function initialize(uid='alice'){return request('/api/commands','POST',{requestId:randomUUID(),revision:0,command:{type:'initialize'}},uid);}
 return {store,request,initialize,get calls(){return calls;},get input(){return lastInput;},advance(ms){clock+=ms;},hold(){let done;const promise=new Promise(r=>done=r);resolve={promise};return ()=>{done();resolve=null;};}};
}
test('config is public but every personal and AI route requires verified identity',async()=>{const f=fixture();assert.equal((await f.request('/api/account/config','GET',null,null)).status,200);for(const path of ['/api/sync','/api/export','/api/chat/session','/api/chat'])assert.equal((await f.request(path,path==='/api/chat'?'POST':'GET',{},null)).status,401);assert.equal((await f.request('/api/sync','GET',null,'forged')).status,401);assert.equal(f.calls,0);});
test('UID is derived from token; submitted IDs cannot read another account',async()=>{const f=fixture();await f.initialize();const write=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:1,uid:'bob',command:{type:'profile',nickname:'そら'}});assert.equal(write.status,200);assert.equal((await f.request('/api/sync','GET',null,'bob')).body.state.initialized,false);assert.equal((await f.request('/api/sync')).body.state.profile.nickname,'そら');assert.equal(write.headers['Cache-Control'],'no-store');});
test('commands reject cross-site writes, stale revisions, unknown fields and point injection',async()=>{const f=fixture();await f.initialize();const input={requestId:randomUUID(),revision:1,command:{type:'weight',value:60}};assert.equal((await f.request('/api/commands','POST',input,'alice','https://evil.example')).status,403);const saved=await f.request('/api/commands','POST',input);assert.equal(saved.status,200);assert.equal(saved.body.state.progress.activities.length,1);assert.equal((await f.request('/api/commands','POST',{...input,requestId:randomUUID()})).status,409);assert.equal((await f.request('/api/commands','POST',{requestId:randomUUID(),revision:2,command:{type:'set_points',value:9999}})).status,400);});
test('same ID replays once; changed content conflicts without overwriting a newer record',async()=>{const f=fixture();await f.initialize();const input={requestId:randomUUID(),revision:1,command:{type:'habit',habit:'stretch'}};const first=await f.request('/api/commands','POST',input);const again=await f.request('/api/commands','POST',input);assert.equal(first.body.state.revision,again.body.state.revision);assert.equal(again.body.state.progress.activities.length,1);assert.equal((await f.request('/api/commands','POST',{...input,command:{type:'weight',value:61}})).status,409);});
test('explicit import is idempotent, preserves original growth and cannot replace populated cloud data',async()=>{const f=fixture(),payload={requestId:randomUUID(),data:{legacy:{...emptyState(),days:{'2026-10-18':{habits:['stretch'],weight:60}}},profile:{nickname:'そら'}}};const r=await f.request('/api/import','POST',payload);assert.equal(r.status,200);assert.equal(r.body.state.legacy.days['2026-10-18'].weight,60);assert.equal((await f.request('/api/import','POST',payload)).status,200);assert.equal((await f.request('/api/import','POST',{...payload,requestId:randomUUID()})).status,409);assert.equal((await f.request('/api/sync','GET',null,'bob')).body.state.initialized,false);});
test('chat ignores browser supplied history, weight and points; persists response before replay',async()=>{const f=fixture();await f.initialize();const id=randomUUID(),input={requestId:id,messages:[{role:'user',content:'こんにちは'}],context:{weightKg:999,activities:[]}};const one=await f.request('/api/chat','POST',input);assert.equal(one.status,200);const two=await f.request('/api/chat','POST',input);assert.equal(two.status,200);assert.equal(f.calls,1);assert.equal(two.body.state.conversation.messages.length,2);});
test('persistent pending operation prevents duplicate upstream calls and detects concurrent edits',async()=>{const f=fixture();await f.initialize();const release=f.hold(),id=randomUUID(),input={requestId:id,text:'こんにちは'};const pending=f.request('/api/chat','POST',input);while(!f.calls)await new Promise(r=>setImmediate(r));assert.equal((await f.request('/api/chat','POST',input)).status,409);await f.request('/api/commands','POST',{requestId:randomUUID(),revision:1,command:{type:'profile',nickname:'そら'}});release();assert.equal((await pending).status,409);assert.equal(f.calls,1);assert.equal((await f.request('/api/sync')).body.state.conversation.messages.length,0);});
test('account switching does not reset persistent chat quotas',async()=>{const f=fixture();await f.initialize();for(let i=0;i<6;i++)assert.equal((await f.request('/api/chat','POST',{requestId:randomUUID(),text:'こんにちは'})).status,200);assert.equal((await f.request('/api/chat','POST',{requestId:randomUUID(),text:'こんにちは'})).status,429);assert.equal(f.calls,6);});

test('chat uses the saved weight and name and calculates achievements on the server exactly once',async()=>{
 const actions=[{operation:'create',targetId:null,kind:'walk',date:'2026-10-19',title:'ウォーキングした',evidence:'20分歩いた',minutes:20,kcal:null,weightKg:null,detail:null,additional:false,estimatedKcal:80,estimateBasis:'保存した体重60kgで通常の歩行20分の目安'}];
 const f=fixture({actions});await f.initialize();
 await f.request('/api/commands','POST',{requestId:randomUUID(),revision:1,command:{type:'weight',value:60}});
 await f.request('/api/commands','POST',{requestId:randomUUID(),revision:2,command:{type:'profile',nickname:'そら'}});
 const input={requestId:randomUUID(),text:'20分歩いた',context:{weightKg:999,nickname:'偽の名前'},points:999999};
 const one=await f.request('/api/chat','POST',input);assert.equal(one.status,200);assert.equal(f.input.context.weightKg,60);assert.equal(f.input.context.nickname,'そら');
 const walk=one.body.state.progress.activities.find(a=>a.kind==='walk');assert.equal(walk.estimate.kcal,80);assert.ok(one.body.receipts.some(r=>r.delta>0));
 const two=await f.request('/api/chat','POST',input);assert.equal(two.body.state.revision,one.body.state.revision);assert.equal(f.calls,1);
});

test('daily life conversation and mood recording share server-side once-daily bonuses',async()=>{
 const kinds=[['housework','洗濯した'],['eating_habit','小皿に分けた'],['mood_log','気分を日記に書いた'],['challenge','後回しの連絡を返した']];
 const f=fixture({actions:kinds.map(([kind,evidence])=>({operation:'create',targetId:null,kind,date:'2026-10-19',title:evidence,evidence,minutes:null,kcal:null,weightKg:null,detail:null,additional:false,estimatedKcal:null,estimateBasis:null}))});await f.initialize();
 const input={requestId:randomUUID(),text:kinds.map(([,s])=>s).join('。'),points:999};
 const one=await f.request('/api/chat','POST',input);assert.equal(one.status,200);assert.equal(one.body.receipts.reduce((n,r)=>n+r.delta,0),25);
 assert.ok(one.body.state.progress.activities.every(a=>a.pointVersion===3));
 const again=await f.request('/api/chat','POST',input);assert.equal(f.calls,1);assert.equal(again.body.state.progress.activities.length,4);
 const mood=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:one.body.state.revision,command:{type:'mood',mood:'good'}});assert.equal(mood.status,200);assert.equal(mood.body.state.progress.activities.filter(a=>a.kind==='mood_log').length,1);
 assert.equal(mood.body.state.legacy.days['2026-10-19'].mood,'good');
 const meal=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:mood.body.state.revision,command:{type:'habit',habit:'meal'}});assert.equal(meal.status,200);
 assert.equal(meal.body.state.progress.activities.filter(a=>a.kind==='eating_habit').length,1);assert.equal(meal.body.state.progress.activities.some(a=>a.kind==='meal_care'),false);
});
test('clearing conversation hides bodies and replay cannot resurrect the deleted reply or double score',async()=>{
 const f=fixture();await f.initialize();const input={requestId:randomUUID(),text:'こんにちは'};await f.request('/api/chat','POST',input);
 assert.equal((await f.request('/api/conversations','DELETE',{requestId:randomUUID(),revision:2})).status,200);
 assert.equal((await f.request('/api/sync')).body.state.conversation.messages.length,0);
 assert.equal((await f.request('/api/chat','POST',input)).status,409);assert.equal(f.calls,1);
});
test('auth helper only proxies its fixed Firebase host and never forwards Authorization or cookies',async()=>{
 let observed;const api=createAccountAPI({config,proxy:async(url,init)=>{observed={url,init};return new Response('helper',{headers:{'content-type':'text/html'}});}});
 const req=Readable.from([]);Object.assign(req,{method:'GET',url:'/__/auth/iframe?apiKey=public',headers:{authorization:'Bearer private',cookie:'private'}});
 let status,text;const res={writeHead(s){status=s;},end(b){text=b.toString();}};await api(req,res,'/__/auth/iframe');assert.equal(status,200);assert.equal(text,'helper');assert.equal(observed.url,'https://example-project.firebaseapp.com/__/auth/iframe?apiKey=public');assert.equal(observed.init.headers.Authorization,undefined);assert.equal(observed.init.headers.cookie,undefined);
 await api(req,res,'/__/auth/unapproved');assert.equal(status,404);
});

test('first setup stores both names; later changes keep records and the server supplies the chosen pet name',async()=>{
 const f=fixture();const profile={version:1,nickname:'そら',petName:'もち',namesConfigured:true};
 const started=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:0,command:{type:'initialize',profile}});assert.equal(started.status,200);assert.deepEqual(started.body.state.profile,profile);
 await f.request('/api/commands','POST',{requestId:randomUUID(),revision:1,command:{type:'weight',value:60}});
 await f.request('/api/commands','POST',{requestId:randomUUID(),revision:2,command:{type:'profile',nickname:'そらさん',petName:'ぽん',namesConfigured:true}});
 await f.request('/api/chat','POST',{requestId:randomUUID(),text:'こんにちは',context:{petName:'偽の犬'}});assert.equal(f.input.context.petName,'ぽん');assert.equal(f.input.context.nickname,'そらさん');assert.equal((await f.request('/api/sync')).body.state.progress.activities.length,1);
 assert.equal((await f.request('/api/commands','POST',{requestId:randomUUID(),revision:4,command:{type:'profile',nickname:'',petName:'ぽん',namesConfigured:true}})).status,400);
});
test('explicit migration retains the two names chosen at onboarding',async()=>{const f=fixture();const r=await f.request('/api/import','POST',{requestId:randomUUID(),data:{legacy:emptyState(),profile:{nickname:'そら',petName:'もち',namesConfigured:true}}});assert.equal(r.status,200);assert.equal(r.body.state.profile.petName,'もち');assert.equal(r.body.state.profile.namesConfigured,true);});

test('a finalized provider failure allows an explicit new attempt while retries of its request ID remain idempotent',async()=>{
 for(const status of [502,504]){
  const f=fixture({firstFailure:{status,body:{error:{code:'upstream_unavailable',message:'もう一度送ってね。'}}}});await f.initialize();
  const input={requestId:randomUUID(),text:'こんにちは'};
  const failed=await f.request('/api/chat','POST',input);assert.equal(failed.status,status);assert.equal(failed.body.error.retryable,true);
  assert.equal((await f.request('/api/chat','POST',input)).status,status);assert.equal(f.calls,1);
  const again=await f.request('/api/chat','POST',{...input,requestId:randomUUID()});assert.equal(again.status,200);assert.equal(f.calls,2);assert.equal(again.body.state.conversation.messages.length,2);
 }
});

test('manual records and corrections use the JST day even while the server is on the previous UTC day',async t=>{
 const previousTZ=process.env.TZ;process.env.TZ='UTC';
 t.after(()=>{if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;});
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-18T15:01:00Z')});
 const f=fixture();f.advance(-12*3600000+60000);await f.initialize();
 const weight=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:1,command:{type:'weight',value:60}});
 assert.equal(weight.status,200);assert.equal(weight.body.state.progress.activities[0].date,'2026-10-19');
 const habit=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:2,command:{type:'habit',habit:'stretch'}});
 assert.equal(habit.status,200);
 const corrected=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:3,command:{type:'correct_activity',id:weight.body.state.progress.activities[0].id,changes:{weightKg:61}}});
 assert.equal(corrected.status,200);assert.equal(corrected.body.state.progress.activities[0].weightKg,61);
 const future=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:4,command:{type:'correct_activity',id:weight.body.state.progress.activities[0].id,changes:{date:'2026-10-20'}}});
 assert.equal(future.status,400);
});


test('interaction preferences commit with chat, replay once, isolate accounts and clear with history',async()=>{
 const f=fixture({interactionUpdate:{style:'encourage',scope:'ongoing',certainty:'explicit',evidence:'応援してほしい',asked:false}});await f.initialize();
 const input={requestId:randomUUID(),text:'応援してほしい',context:{interactionPreferences:{preferred:'nurture'}}};
 const one=await f.request('/api/chat','POST',input);assert.equal(one.status,200);assert.equal(f.input.context.interactionPreferences.preferred,null);
 assert.equal(one.body.state.interactionPreferences.preferred,'encourage');
 const again=await f.request('/api/chat','POST',input);assert.equal(again.body.state.interactionPreferences.turns,1);
 await f.request('/api/chat','POST',{requestId:randomUUID(),text:'こんにちは'});assert.equal(f.input.context.interactionPreferences.preferred,'encourage');
 assert.equal((await f.request('/api/sync','GET',null,'bob')).body.state.interactionPreferences.preferred,null);
 const state=(await f.request('/api/sync')).body.state;
 await f.request('/api/conversations','DELETE',{requestId:randomUUID(),revision:state.revision});
 assert.equal((await f.request('/api/sync')).body.state.interactionPreferences.preferred,null);
});

test('failed and conflicted conversations never save preference candidates; reset forgets preferences',async()=>{
 const interactionUpdate={style:'listen',scope:'ongoing',certainty:'explicit',evidence:'聞いてほしい',asked:false};
 const failed=fixture({interactionUpdate,firstFailure:{status:502,body:{error:{code:'upstream'}}}});await failed.initialize();
 assert.equal((await failed.request('/api/chat','POST',{requestId:randomUUID(),text:'聞いてほしい'})).status,502);
 assert.equal((await failed.request('/api/sync')).body.state.interactionPreferences.preferred,null);
 const f=fixture({interactionUpdate});await f.initialize();const release=f.hold();const pending=f.request('/api/chat','POST',{requestId:randomUUID(),text:'聞いてほしい'});
 while(!f.calls)await new Promise(r=>setImmediate(r));
 await f.request('/api/commands','POST',{requestId:randomUUID(),revision:1,command:{type:'profile',nickname:'そら'}});release();assert.equal((await pending).status,409);
 assert.equal((await f.request('/api/sync')).body.state.interactionPreferences.preferred,null);
 const saved=await f.request('/api/chat','POST',{requestId:randomUUID(),text:'聞いてほしい'});
 const reset=await f.request('/api/commands','POST',{requestId:randomUUID(),revision:saved.body.state.revision,command:{type:'reset_memory'}});
 assert.equal(reset.status,200);assert.equal(reset.body.state.interactionPreferences.preferred,null);
});
