import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {createMealPhotoEstimator,validateMealPhoto} from '../server/meal-photo.mjs';
import {normalizeMealEstimate,normalizeIntake,mealIntakeSummary} from '../dist/meal-intake.mjs';
import {normalizeProgress,calorieSummary,dayReport,correctActivity,recordManual,applyInterpretation} from '../dist/progress.mjs';

// Minimal marker fixture for boundary validation; real image decoding is exercised in the browser.
const photo='data:image/jpeg;base64,'+Buffer.from([255,216,255,192,0,11,8,0,16,0,16,3,1,17,0,255,217]).toString('base64');
const estimate={status:'ok',items:[{name:'ご飯',portion:'茶碗1杯、約150g',kcal:230},{name:'焼き魚',portion:'1切れ、約80g',kcal:160}],basis:'器の大きさから一般的な量を仮定。油や調味料は写真では確認できないため目安。',question:''};
function fixture({result={status:200,body:{estimate}},delay=null}={}){
  const store=new MemoryAccountStore();let calls=0,clock=Date.parse('2026-10-30T03:00:00Z');
  const api=createAccountAPI({store,now:()=>clock,config:{},verify:async token=>({uid:token}),generate:async()=>({status:200,body:{reply:'こんにちは',actions:[]}}),estimateMeal:async()=>{calls++;if(delay)await delay;return structuredClone(result);}});
  async function request(path,data,uid='alice',origin='https://app.example'){
    const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{method:'POST',url:path,headers:{host:'app.example',origin,...(uid?{authorization:'Bearer '+uid}:{})}});
    let status,body;await api(req,{writeHead(s){status=s;},end(s){body=JSON.parse(s);}},path);return {status,body};
  }
  async function init(uid='alice'){assert.equal((await request('/api/commands',{requestId:randomUUID(),revision:0,command:{type:'initialize'}},uid)).status,200);}
  const analyze=(id=randomUUID(),extra={},uid='alice')=>request('/api/meal-photo/estimate',{requestId:id,image:photo,note:'',...extra},uid);
  const confirm=(id,extra={},uid='alice')=>request('/api/meal-photo/confirm',{requestId:id,revision:1,date:'2026-10-30',mealType:'lunch',items:estimate.items,...extra},uid);
  return {store,request,init,analyze,confirm,get calls(){return calls;},advance(ms){clock+=ms;}};
}
test('photo boundaries reject external URLs, wrong types, oversized and huge-dimension images',()=>{
  assert.equal(validateMealPhoto(photo).hash.length,64);
  for(const value of ['https://example.com/a.jpg','data:image/svg+xml;base64,PHN2Zz4=',photo+'x','data:image/jpeg;base64,'+'A'.repeat(800000)])assert.throws(()=>validateMealPhoto(value));
  const bytes=Buffer.from(photo.split(',')[1],'base64');bytes.writeUInt16BE(64000,7);assert.throws(()=>validateMealPhoto('data:image/jpeg;base64,'+bytes.toString('base64')));
  assert.throws(()=>normalizeMealEstimate({...estimate,items:[{name:'料理',portion:'1人分',kcal:-1}]}));
  assert.throws(()=>normalizeIntake({version:1,kcal:99,source:'photo',mealType:'lunch',items:estimate.items,estimate}));
});
test('estimator sends only the prepared image and note through fixed Luna with structured outputs',async()=>{
  let sent,usage;
  const generate=createMealPhotoEstimator({apiKey:'test-placeholder',fetchImpl:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(init.body);return Response.json({id:'test-response',model:'gpt-6-luna',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(estimate)}]}],usage:{input_tokens:100,output_tokens:80}});},onUsage:(entry,meta)=>{usage={entry,meta};}});
  const result=await generate({image:photo,note:'ご飯は普通盛り'},'alice');assert.equal(result.status,200);assert.deepEqual(result.body.estimate,estimate);
  assert.equal(sent.model,'gpt-6-luna');assert.equal(sent.reasoning.effort,'low');assert.equal(sent.store,false);assert.equal(sent.input[1].content[1].type,'input_image');assert.equal(sent.input[1].content[1].image_url,photo);assert.equal(sent.text.format.strict,true);assert.equal(usage.meta.uid,'alice');assert.equal(usage.entry.purpose,'chat');assert.equal(JSON.stringify(usage).includes(photo),false);
  const bad=createMealPhotoEstimator({fetchImpl:async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...estimate,items:[{name:'料理',portion:'1皿',kcal:Infinity}]})}]}]})});assert.equal((await bad({image:photo,note:''},'alice')).status,502);
});
test('photo analysis requires identity, same origin, setup and a valid bounded request',async()=>{
  const f=fixture(),id=randomUUID();assert.equal((await f.analyze(id,{},null)).status,401);
  assert.equal((await f.request('/api/meal-photo/estimate',{requestId:id,image:photo,note:''},'alice','https://evil.example')).status,403);
  assert.equal((await f.analyze(id)).status,409);await f.init();assert.equal((await f.analyze(id,{image:'https://evil.example'})).status,400);assert.equal(f.calls,0);
});
test('analysis is idempotent, stores no image and never creates a meal before confirmation',async()=>{
  const f=fixture();await f.init();const id=randomUUID();assert.equal((await f.analyze(id)).status,200);assert.equal((await f.analyze(id)).status,200);assert.equal(f.calls,1);
  assert.equal((await f.store.read('alice')).progress.activities.length,0);assert.equal(JSON.stringify([...f.store.ops]).includes(photo),false);
  assert.equal((await f.analyze(id,{note:'ご飯は半分'})).status,409);
  await f.init('bob');assert.equal((await f.confirm(id,{},'bob')).status,409);
});
test('confirmation saves edited intake, preserves original estimate and replays without duplicate points',async()=>{
  const f=fixture();await f.init();const id=randomUUID();await f.analyze(id);
  const items=[{...estimate.items[0],portion:'半分、約75g',kcal:115},estimate.items[1]];
  const saved=await f.confirm(id,{items});assert.equal(saved.status,200);
  const progress=saved.body.state.progress,meal=progress.activities[0];assert.equal(meal.intake.kcal,275);assert.equal(meal.intake.source,'edited');assert.deepEqual(meal.intake.estimate,estimate);assert.equal(meal.kcal,null);assert.equal(meal.estimate,null);
  assert.equal(mealIntakeSummary(progress,'2026-10-30').kcal,275);assert.equal(calorieSummary(progress,'2026-10-30').kcal,0);assert.equal(dayReport(progress,'2026-10-30').total,5);
  assert.equal((await f.confirm(id,{items})).body.state.progress.activities.length,1);assert.equal((await f.confirm(id)).status,409);assert.equal(f.calls,1);
  const again=normalizeProgress(JSON.parse(JSON.stringify(progress)));assert.deepEqual(again.activities[0].intake,meal.intake);
  const corrected=correctActivity(again,meal.id,{intakeKcal:300,date:'2026-10-29'},saved.body.state.legacy,undefined,'2026-10-30');assert.equal(mealIntakeSummary(corrected,'2026-10-30').recorded,0);assert.equal(mealIntakeSummary(corrected,'2026-10-29').kcal,300);assert.equal(corrected.activities[0].intake.source,'edited');assert.deepEqual(corrected.activities[0].intake.estimate,estimate);
  const changed=applyInterpretation(again,{requestId:'changed-menu',today:'2026-10-30',text:'違った、麺を食べた',actions:[{operation:'update',targetId:meal.id,kind:'meal_log',date:'2026-10-30',title:'昼食',evidence:'麺を食べた',minutes:null,kcal:null,weightKg:null,detail:'麺',additional:false}]},saved.body.state.legacy).progress;
  assert.equal(changed.activities[0].intake,undefined);assert.equal(mealIntakeSummary(changed,'2026-10-30').withoutCalories,1);assert.deepEqual(changed.activities[0].corrections.at(-1).previous.intake,meal.intake);
});
test('attaching to an existing meal does not add another row or bonus; stale revisions are safe',async()=>{
  const f=fixture();await f.init();const state=await f.store.read('alice');state.progress=recordManual(state.progress,{id:'original-meal',kind:'meal_log',date:'2026-10-30',title:'お昼を食べた',detail:'ご飯と焼き魚'},state.legacy).progress;state.revision=2;f.store.accounts.set('alice',state);
  const id=randomUUID();await f.analyze(id);assert.equal((await f.confirm(id)).status,409);const targetId=state.progress.activities[0].id;
  const result=await f.confirm(id,{revision:2,targetId});assert.equal(result.status,200);assert.equal(result.body.state.progress.activities.length,1);assert.equal(result.body.state.progress.activities[0].id,targetId);assert.equal(dayReport(result.body.state.progress,'2026-10-30').total,5);
});
test('non-food and unclear photos cannot be confirmed and quota is shared with chat',async()=>{
  const f=fixture({result:{status:200,body:{estimate:{status:'not_food',items:[],basis:'食事は写っていません。',question:'食事が写った写真を選んでね。'}}}});await f.init();const id=randomUUID();await f.analyze(id);assert.equal((await f.confirm(id)).status,409);
  for(let i=0;i<5;i++)assert.equal((await f.analyze()).status,200);assert.equal((await f.analyze()).status,429);assert.equal(f.calls,6);assert.equal((await f.store.read('alice')).progress.activities.length,0);
});
test('concurrent analysis reserves one AI call and failure releases the lease',async()=>{
  let release;const delay=new Promise(resolve=>{release=resolve;}),f=fixture({delay});await f.init();const id=randomUUID(),pending=f.analyze(id);while(!f.calls)await new Promise(r=>setImmediate(r));assert.equal((await f.analyze(id)).status,409);assert.equal((await f.analyze()).status,409);release();assert.equal((await pending).status,200);assert.equal(f.calls,1);assert.equal((await f.store.read('alice')).chatLease,null);
  const failed=fixture({result:{status:502,body:{error:{code:'photo_failed',message:'failed',retryable:true}}}});await failed.init();const request=randomUUID();assert.equal((await failed.analyze(request)).status,502);assert.equal((await failed.analyze(request)).status,502);assert.equal(failed.calls,1);assert.equal((await failed.store.read('alice')).chatLease,null);
});
