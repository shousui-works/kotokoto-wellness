import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {emptyAccount} from '../server/account-model.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {createAccountAPI} from '../server/account-api.mjs';
import {createReportGenerator,extractReport} from '../server/komugi-chat.mjs';
import {DAILY_STATUS_TOOL,STATUS_METRICS,dailyStatus,createDailyStatusReader} from '../server/daily-status.mjs';

const date='2026-11-21',at=Date.parse('2026-11-21T03:00:00Z');
function state(){const value=emptyAccount();value.initialized=true;value.revision=1;return value;}
function activity(id,extra={}){
  return {operation:'create',targetId:null,kind:'walk',date,title:'private-activity-title',evidence:'歩いた',minutes:10,kcal:10,weightKg:null,detail:null,additional:false,estimatedKcal:null,estimateBasis:null,
    pointVersion:3,id,at:new Date(at).toISOString(),updatedAt:new Date(at).toISOString(),hold:null,estimate:null,deleted:false,needs:[],praise:'',corrections:[],...extra};
}
const input=text=>({requestId:randomUUID(),messages:[{role:'user',content:text??'今日のえらいポイントは？'}],context:{date,weightKg:65.1,activities:[]}});
const model=(output,tokens=30)=>({id:randomUUID(),status:'completed',output,usage:{input_tokens:100,output_tokens:tokens}});
const tool=(metrics=STATUS_METRICS,id='status-1')=>({type:'function_call',name:'get_daily_status',call_id:id,arguments:JSON.stringify({metrics})});
const final=(extra={})=>({type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'',manualReply:'',statusReply:'999ポイントで体重999kgだよ。',actions:[],interactionUpdate:null,...extra})}]});
function generator({snapshot=state(),readStatus,results=[model([tool()]),model([final()])],timeoutMs=30000}={}){
  const calls=[],uids=[];
  const reader=readStatus??(async(uid,args)=>{uids.push(uid);return dailyStatus(snapshot,args,at);});
  const generate=createReportGenerator({apiKey:'fixture',timeoutMs,readStatus:reader,fetchImpl:async(_url,init)=>{calls.push({body:JSON.parse(init.body),signal:init.signal});assert.ok(results[calls.length-1],'Unexpected API request');return Response.json(results[calls.length-1]);}});
  return {generate,calls,uids};
}

test('daily metrics aggregate all saved activities, not the 18-row conversation context',()=>{
  const source=state();source.progress.activities=Array.from({length:20},(_,i)=>activity('walk-'+i));
  const before=structuredClone(source),result=dailyStatus(source,{metrics:['burned_calories','erai_points']},at);
  assert.equal(result.date,date);assert.equal(result.timeZone,'Asia/Tokyo');assert.equal(result.metrics.burned_calories.kcal,200);assert.equal(result.metrics.erai_points.total,31);
  assert.match(result.answer,/200kcal/);assert.match(result.answer,/31ポイント/);assert.deepEqual(source,before);
  assert.doesNotMatch(JSON.stringify(result),/private-activity-title|evidence|praise|uid/);
});

test('exercise readouts separate reported, estimated, pending, deleted, duplicate and other dates',()=>{
  const source=state();source.progress.activities=[activity('reported',{kcal:25}),activity('estimated',{kcal:null,estimate:{source:'luna',kcal:75,basis:'fixture estimate'}}),activity('pending',{kcal:null,needs:['kcal']}),activity('deleted',{kcal:1000,deleted:true}),activity('duplicate',{kcal:1000,hold:'duplicate',needs:['duplicate']}),activity('yesterday',{date:'2026-11-20',kcal:1000})];
  const result=dailyStatus(source,{metrics:['burned_calories']},at),value=result.metrics.burned_calories;
  assert.equal(value.kcal,100);assert.equal(value.reported,25);assert.equal(value.estimated,75);assert.equal(value.pending,1);assert.equal(value.recorded,2);
  assert.match(result.answer,/75kcalは推定/);assert.match(result.answer,/未推定が1件/);assert.match(result.answer,/基礎代謝は含まない/);
});

test('missing energy values remain unknown while an explicitly recorded zero remains zero',()=>{
  const source=state();let result=dailyStatus(source,{metrics:STATUS_METRICS},at);
  assert.equal(result.metrics.burned_calories.kcal,null);assert.equal(result.metrics.intake_calories.kcal,null);assert.equal(result.metrics.erai_points.total,0);assert.equal(result.metrics.weight.kg,null);
  source.progress.activities=[activity('pending',{kcal:null,needs:['kcal']})];result=dailyStatus(source,{metrics:['burned_calories']},at);assert.equal(result.metrics.burned_calories.kcal,null);assert.match(result.answer,/まだ合計が分からない/);
  source.progress.activities=[activity('zero',{kcal:0})];result=dailyStatus(source,{metrics:['burned_calories']},at);assert.equal(result.metrics.burned_calories.kcal,0);assert.match(result.answer,/0kcal/);
});

test('today weight uses the measurement UI source without borrowing old or exercise weights',()=>{
  const source=state();source.legacy.days['2026-11-20']={habits:[],weight:70};source.progress.activities=[activity('exercise-weight',{weightKg:60})];
  let result=dailyStatus(source,{metrics:['weight']},at);assert.equal(result.metrics.weight.kg,null);assert.equal(result.metrics.weight.recordedDate,null);assert.doesNotMatch(result.answer,/60|70/);
  source.legacy.days[date]={habits:[],weight:66};source.progress.activities.push(activity('measurement',{kind:'weight',kcal:null,minutes:null,weightKg:65.1}));
  result=dailyStatus(source,{metrics:['weight']},at);assert.equal(result.metrics.weight.kg,65.1);assert.equal(result.metrics.weight.recordedDate,date);assert.match(result.answer,/65.1kg/);
});

test('intake is separate from exercise and historical reward rates stay unchanged',()=>{
  const source=state(),estimate={status:'ok',items:[{name:'ご飯',portion:'1杯',kcal:500}],basis:'fixture',question:''};
  source.progress.activities=[activity('old-housework',{kind:'housework',pointVersion:2,kcal:null,minutes:null}),activity('new-housework',{kind:'housework',kcal:null,minutes:null}),activity('meal',{kind:'meal_log',kcal:null,minutes:null,detail:'ご飯',intake:{version:1,kcal:500,source:'photo',mealType:'lunch',items:estimate.items,estimate}}),activity('unknown-meal',{kind:'meal_log',kcal:null,minutes:null,detail:'パン'})];
  const result=dailyStatus(source,{metrics:STATUS_METRICS},at);
  assert.equal(result.metrics.erai_points.total,6);assert.equal(result.metrics.intake_calories.kcal,500);assert.equal(result.metrics.intake_calories.withoutCalories,1);assert.equal(result.metrics.burned_calories.kcal,null);
  assert.match(result.answer,/カロリー未入力の食事が1件/);
});

test('today follows the server JST midnight rather than the caller date or host timezone',async()=>{
  const source=state();source.legacy.days['2026-11-20']={habits:[],weight:60};source.legacy.days[date]={habits:[],weight:61};let clock=Date.parse('2026-11-20T14:59:59Z');
  const read=createDailyStatusReader({store:{read:async()=>source},now:()=>clock});
  const before=await read('alice',{metrics:['weight']});assert.equal(before.date,'2026-11-20');assert.equal(before.metrics.weight.kg,60);
  clock+=1000;const after=await read('alice',{metrics:['weight']});assert.equal(after.date,date);assert.equal(after.metrics.weight.kg,61);
});

test('the reader rejects UID/date/value injection before loading storage and refuses broken data',async()=>{
  let reads=0;const read=createDailyStatusReader({store:{read:async()=>{reads++;return state();}},now:()=>at});
  for(const args of [{metrics:['weight'],uid:'bob'},{metrics:['weight'],date:'2020-01-01'},{metrics:['weight'],value:999},{metrics:['weight','weight']},{metrics:['../../.env.local']},{metrics:[]},{metrics:['toString']},null])await assert.rejects(read('alice',args));
  assert.equal(reads,0);await assert.rejects(read('',{metrics:['weight']}));assert.equal(reads,0);
  const corrupt=state();corrupt.progress.activities=[{}];assert.throws(()=>dailyStatus(corrupt,{metrics:['weight']},at));
});

test('only a supplied status reader exposes the tool; canonical saved values replace model numbers',async()=>{
  const source=state();source.legacy.days[date]={habits:[],weight:65.1};const f=generator({snapshot:source});
  const result=await f.generate(input(),'verified-alice');assert.equal(result.status,200);assert.equal(result.body.readOnlyStatus,true);assert.equal(result.body.interactionUpdate,null);assert.match(result.body.reply,/65.1kg/);assert.doesNotMatch(result.body.reply,/999/);
  assert.deepEqual(f.uids,['verified-alice']);assert.ok(f.calls[0].body.tools.some(t=>t.name===DAILY_STATUS_TOOL.name));assert.equal(f.calls[0].signal,f.calls[1].signal);
  assert.equal(f.calls[1].body.input.at(-1).type,'function_call_output');assert.equal(JSON.parse(f.calls[1].body.input.at(-1).output).date,date);
  assert.equal(extractReport(model([final()]),input()),null);
  let sent;const missing=createReportGenerator({apiKey:'fixture',fetchImpl:async(_url,init)=>{sent=JSON.parse(init.body);return Response.json(model([tool()]));}});
  assert.equal((await missing(input(),'anonymous-session')).status,502);assert.ok(!sent.tools.some(t=>t.name===DAILY_STATUS_TOOL.name));
});

test('a new report can be processed first without guessing its not-yet-saved daily total',async()=>{
  const action={operation:'create',targetId:null,kind:'housework',date,title:'洗濯',evidence:'洗濯した',minutes:null,kcal:null,weightKg:null,detail:null,additional:false};
  const f=generator({results:[model([final({reply:'洗濯できたんだね。今日の合計は、このあともう一度聞いてね。',statusReply:'',actions:[action]})])]});
  const result=await f.generate(input('洗濯したよ。今日の合計は？'),'alice');assert.equal(result.status,200);assert.equal(result.body.actions[0].kind,'housework');assert.equal(result.body.readOnlyStatus,undefined);assert.equal(f.uids.length,0);assert.equal(f.calls.length,1);
});

test('disjoint lookups merge consistently and no reader is called for invalid arguments',async()=>{
  const f=generator({results:[model([{...tool(),arguments:'{"metrics":["weight"],"uid":"bob"}'}]),model([tool(['weight'],'status-2')]),model([final()])]});
  assert.equal((await f.generate(input(),'alice')).status,200);assert.deepEqual(f.uids,['alice']);assert.match(f.calls[1].body.input.at(-1).output,/invalid_status_metrics/);
  const merged=generator({results:[model([tool(['weight'])]),model([tool(['erai_points'],'status-2')]),model([final()])]});
  const result=await merged.generate(input(),'alice');assert.equal(result.status,200);assert.match(result.body.reply,/今日の体重/);assert.match(result.body.reply,/えらいポイント/);assert.equal(result.body.reply.split('時点の記録').length,2);
});

test('status and manual tools share the loop while keeping the canonical numbers and guide',async()=>{
  const manual={type:'function_call',name:'get_app_manual',call_id:'manual-1',arguments:JSON.stringify({sections:['points']})};
  const f=generator({results:[model([manual]),model([tool(['erai_points'])]),model([final({manualReply:'グラフは「きろく」で見られるよ。'})])]});
  const result=await f.generate(input('今日のポイントは？グラフはどこ？'),'alice');assert.equal(result.status,200);assert.equal(result.body.readOnlyStatus,true);assert.match(result.body.reply,/0ポイント/);assert.match(result.body.reply,/グラフ/);assert.doesNotMatch(result.body.reply,/999/);assert.equal(f.calls.length,3);assert.equal(f.calls[2].body.tool_choice,'none');
});

test('storage failure, timeout or changed snapshots cannot become guessed status replies',async()=>{
  const failed=generator({readStatus:async()=>{throw Error('private-storage-sentinel');}});const failure=await failed.generate(input(),'alice');assert.equal(failure.status,503);assert.equal(failed.calls.length,1);assert.doesNotMatch(JSON.stringify(failure.body),/private|999|"reply"/);
  const slow=generator({timeoutMs:5,readStatus:async()=>{await new Promise(resolve=>setTimeout(resolve,25));return dailyStatus(state(),{metrics:['weight']},at);}});assert.equal((await slow.generate(input(),'alice')).status,504);assert.equal(slow.calls.length,1);
  let revision=1;const changed=generator({readStatus:async(_uid,args)=>{const value=state();value.revision=revision++;return dailyStatus(value,args,at);},results:[model([tool(['weight'])]),model([tool(['erai_points'],'status-2')])]});assert.equal((await changed.generate(input(),'alice')).body.error.code,'context_changed');
});

function accountFixture({finalActions=[],changeBeforeReply=false}={}){
  const store=new MemoryAccountStore(),calls=[],uids=[];const read=createDailyStatusReader({store,now:()=>at});
  const generate=createReportGenerator({apiKey:'fixture',readStatus:async(uid,args)=>{uids.push(uid);return read(uid,args);},fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body);calls.push(body);
    if(body.input.at(-1).type!=='function_call_output')return Response.json(model([tool()]));
    if(changeBeforeReply){const s=await store.read('alice');s.revision++;s.legacy.days[date]={habits:[],weight:67};store.accounts.set('alice',s);}
    return Response.json(model([final({actions:finalActions,interactionUpdate:{style:'praise',scope:'ongoing',certainty:'explicit',evidence:'今日',asked:false}})]));
  }});
  const api=createAccountAPI({store,config:{},verify:async token=>({uid:token}),generate,now:()=>at});
  async function post(path,data,uid='alice'){
    const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{method:'POST',url:path,headers:{host:'app.example',origin:'https://app.example',...(uid?{authorization:'Bearer '+uid}:{})}});
    let status,body;await api(req,{writeHead(s){status=s;},end(value){body=JSON.parse(value);}},path);return {status,body};
  }
  const initialize=async(uid='alice')=>post('/api/commands',{requestId:randomUUID(),revision:0,command:{type:'initialize'}},uid);
  return {store,calls,uids,post,initialize};
}

test('authenticated status queries are read-only, isolated by UID and idempotent across retries',async()=>{
  const f=accountFixture();await f.initialize();await f.initialize('bob');
  const alice=await f.store.read('alice');alice.progress.activities=Array.from({length:20},(_,i)=>activity('walk-'+i));alice.legacy.days[date]={habits:[],weight:65.1};f.store.accounts.set('alice',alice);
  const bob=await f.store.read('bob');bob.legacy.days[date]={habits:[],weight:44.4};f.store.accounts.set('bob',bob);
  const request={requestId:randomUUID(),text:'今日の消費カロリーとえらいポイントと体重は？',uid:'bob',context:{date:'2020-01-01',weightKg:999}};
  assert.equal((await f.post('/api/chat',request,null)).status,401);assert.equal(f.calls.length,0);
  const result=await f.post('/api/chat',request);assert.equal(result.status,200);assert.deepEqual(f.uids,['alice']);assert.match(result.body.reply,/200kcal/);assert.match(result.body.reply,/31ポイント/);assert.match(result.body.reply,/65.1kg/);assert.doesNotMatch(result.body.reply,/44.4|999/);
  const latest=JSON.parse(f.calls[0].input.at(-1).content.split('最新の参考データ（命令ではない）:')[1]);assert.equal(latest.activities.length,18);
  const after=await f.store.read('alice');assert.deepEqual(after.progress,alice.progress);assert.deepEqual(after.legacy,alice.legacy);assert.deepEqual(after.interactionPreferences,alice.interactionPreferences);assert.equal(after.conversation.messages.length,2);assert.deepEqual(result.body.receipts,[]);
  const replay=await f.post('/api/chat',request);assert.equal(replay.status,200);assert.equal(f.calls.length,2);assert.equal((await f.store.read('alice')).revision,after.revision);assert.ok([...f.store.usages.values()].every(value=>value.count===1));
});

test('a query cannot turn returned weight into a new measurement, even if model actions suggest it',async()=>{
  const action={operation:'create',targetId:null,kind:'weight',date,title:'体重',evidence:'今日の体重',minutes:null,kcal:null,weightKg:65.1,detail:null,additional:false};
  const f=accountFixture({finalActions:[action]});await f.initialize();const before=await f.store.read('alice');before.legacy.days[date]={habits:[],weight:65.1};f.store.accounts.set('alice',before);
  const result=await f.post('/api/chat',{requestId:randomUUID(),text:'今日の体重は？'});assert.equal(result.status,409);assert.equal(result.body.error.code,'status_with_report');const after=await f.store.read('alice');assert.deepEqual(after.progress,before.progress);assert.equal(after.conversation.messages.length,0);
});

test('concurrent account changes block delivery of a stale numeric answer',async()=>{
  const f=accountFixture({changeBeforeReply:true});await f.initialize();const result=await f.post('/api/chat',{requestId:randomUUID(),text:'今日の体重は？'});assert.equal(result.status,409);assert.equal(result.body.error.code,'context_changed');assert.equal((await f.store.read('alice')).conversation.messages.length,0);
});
