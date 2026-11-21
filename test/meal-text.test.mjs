import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {emptyState} from '../dist/model.mjs';
import {emptyProgress,normalizeCandidate,normalizeProgress,applyInterpretation,correctActivity,dayReport,calorieSummary,progressContext} from '../dist/progress.mjs';
import {normalizeConversationMeal,intakeFromConversation,normalizeIntake,intakeReference,mealIntakeSummary,mealIntakeNote,intakeSourceLabel,intakeBasisLabel} from '../dist/meal-intake.mjs';
import {validateChatRequest,extractReport,createReportGenerator} from '../server/komugi-chat.mjs';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {dailyStatus} from '../server/daily-status.mjs';
import {mealTextFixture} from './meal-text-fixture.mjs';

const date='2026-11-21',at='2026-11-21T03:00:00.000Z';
const meal=(extra={})=>({source:'text',mealType:'breakfast',items:[{name:'白いご飯',portion:'茶碗1杯、約150gと仮定',kcal:234}],basis:'固定テスト用。一般的な茶碗1杯の量を仮定した目安。',...extra});
const action=(extra={})=>({operation:'create',targetId:null,kind:'meal_log',date,title:'朝ごはん',evidence:'朝ごはんにご飯一杯食べた',minutes:null,kcal:null,weightKg:null,estimatedKcal:null,estimateBasis:null,detail:'朝食：白いご飯を茶碗1杯',additional:false,mealIntake:meal(),...extra});
const output=actions=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'朝ごはんを食べたんだね。',manualReply:'',statusReply:'',actions,interactionUpdate:null})}]}]});
function start(){const legacy=emptyState();return {legacy,progress:emptyProgress(legacy,new Date(at))};}
let sequence=0;
function apply(progress,legacy,actions,text=actions.map(a=>a.evidence).join('。'),extra={}){
  return applyInterpretation(progress,{requestId:'meal-text-'+(++sequence),today:date,at,reply:'朝ごはんを食べたんだね。',actions,text,...extra},legacy);
}
function input(text,legacy=emptyState(),progress=emptyProgress(legacy),selectedId=null){
  return validateChatRequest({requestId:randomUUID(),messages:[{role:'user',content:text}],context:{date,...progressContext(legacy,progress,date,selectedId)}});
}

test('conversation meal validation bounds food, portions, energy and provenance',()=>{
  assert.deepEqual(normalizeConversationMeal(meal()),meal());
  for(const value of [null,[],{...meal(),uid:'bob'},meal({source:'photo'}),meal({source:'edited'}),meal({basis:''}),meal({mealType:'__proto__'}),meal({items:[]}),meal({items:Array(13).fill(meal().items[0])}),meal({items:[{name:'ご飯',portion:'1杯',kcal:-1}]}),meal({items:[{name:'ご飯',portion:'1杯',kcal:5001}]}),meal({items:Array(5).fill({name:'ご飯',portion:'1杯',kcal:5000})})])assert.throws(()=>normalizeConversationMeal(value));
  assert.equal(normalizeCandidate(action({kind:'walk'})),null);
  assert.equal(normalizeCandidate(action({mealIntake:meal({source:'photo'})})),null);
});

test('a text meal records only intake with assumptions, a small receipt and one meal bonus',()=>{
  const {legacy,progress}=start(),result=apply(progress,legacy,[action()]);
  const saved=result.progress.activities[0];assert.equal(saved.intake.kcal,234);assert.equal(saved.intake.source,'text');assert.equal(saved.intake.origin,'text');assert.match(saved.intake.estimate.basis,/仮定/);
  assert.equal(saved.kcal,null);assert.equal(saved.estimate,null);assert.equal(saved.mealIntake,undefined);assert.equal(saved.intakePending,undefined);
  assert.equal(mealIntakeSummary(result.progress,date).kcal,234);assert.equal(calorieSummary(result.progress,date).kcal,0);assert.equal(dayReport(result.progress,date).exercise,0);assert.equal(result.delta,5);
  assert.ok(result.receipts.some(r=>r.delta===0&&/234kcal.*会話からの推定/.test(r.label)));
  assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(result.progress))),result.progress);
});

test('unknown amounts are pending instead of zero and a supplement completes the original meal',()=>{
  const {legacy,progress}=start();
  const first=apply(progress,legacy,[action({detail:'朝食にご飯をいっぱい食べた',mealIntake:null})]);
  assert.deepEqual(first.progress.activities[0].needs,['intake']);assert.equal(first.progress.activities[0].intakePending,true);assert.match(first.reply,/食べた量/);
  const summary=mealIntakeSummary(first.progress,date);assert.equal(summary.recorded,0);assert.equal(summary.withoutCalories,1);
  const complete=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'茶碗一杯だよ'})]);
  assert.equal(complete.progress.activities.length,1);assert.equal(complete.progress.activities[0].intake.kcal,234);assert.equal(complete.progress.activities[0].intakePending,undefined);assert.deepEqual(complete.progress.activities[0].needs,[]);assert.equal(complete.delta,0);
  const old=apply(progress,legacy,[Object.fromEntries(Object.entries(action()).filter(([key])=>key!=='mealIntake'))]);assert.deepEqual(old.progress.activities[0].needs,[]);
});

test('a missing-food question is not replaced with an inappropriate quantity question',()=>{
  const {legacy,progress}=start();
  const result=apply(progress,legacy,[action({evidence:'夕飯をいっぱい食べた',detail:'夕飯をいっぱい食べた',mealIntake:null})],undefined,{reply:'夕飯を食べたんだね。何を食べたの？'});
  assert.match(result.reply,/何を食べたの？/);assert.doesNotMatch(result.reply,/食べた量/);assert.equal(result.progress.activities[0].intake,undefined);
});

test('requests, paraphrases and distinct meals do not double-count intake or meal points',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const replay=apply(first.progress,legacy,[action()],undefined,{requestId:first.progress.processed.at(-1)});assert.equal(replay.replayed,true);assert.equal(replay.progress.activities.length,1);
  const repeated=apply(first.progress,legacy,[action({operation:'repeat',targetId:first.progress.activities[0].id,evidence:'朝のご飯と同じ分',mealIntake:meal({items:[{name:'ご飯',portion:'1杯',kcal:999}]})})]);assert.equal(mealIntakeSummary(repeated.progress,date).kcal,234);assert.equal(repeated.delta,0);
  const lunch=apply(repeated.progress,legacy,[action({title:'昼ごはん',detail:'昼食のうどん',evidence:'昼ごはんはうどんを食べた',mealIntake:meal({mealType:'lunch',items:[{name:'うどん',portion:'一般的な1人前と仮定',kcal:350}]})})]);
  assert.equal(lunch.progress.activities.length,2);assert.equal(mealIntakeSummary(lunch.progress,date).kcal,584);assert.equal(lunch.delta,0);assert.equal(dayReport(lunch.progress,date).bonus,5);
});

test('portion corrections replace the original intake and retain its previous assumptions',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const changed=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'朝のご飯は半分残した',detail:'朝食：ご飯は茶碗半分',mealIntake:meal({items:[{name:'白いご飯',portion:'茶碗半分、約75gと仮定',kcal:117}],basis:'固定テスト。元の茶碗1杯から半分食べたと解釈。'})})]);
  const row=changed.progress.activities[0];assert.equal(changed.progress.activities.length,1);assert.equal(row.intake.kcal,117);assert.equal(row.corrections.at(-1).previous.intake.kcal,234);assert.deepEqual(row.corrections.at(-1).previous.intake.estimate,first.progress.activities[0].intake.estimate);assert.equal(changed.delta,0);assert.equal(calorieSummary(changed.progress,date).kcal,0);
  assert.ok(changed.receipts.some(r=>/117kcal/.test(r.label)));
});

test('a portion-only correction updates intake and its description even when detail is null',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const changed=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'朝のご飯は半分残した',detail:null,mealIntake:meal({items:[{name:'白いご飯',portion:'茶碗半分、約75gと仮定',kcal:117}]})})]);
  const row=changed.progress.activities[0];assert.equal(row.intake.kcal,117);assert.match(row.detail,/75g/);assert.equal(row.corrections.at(-1).previous.intake.kcal,234);assert.equal(changed.progress.activities.length,1);
  const dated=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'昨日だった',date:'2026-11-20',detail:null,mealIntake:null})]);assert.deepEqual(dated.progress.activities[0].intake,first.progress.activities[0].intake);
  const same=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'朝ごはんのことだよ',detail:null,mealIntake:meal({items:[{...meal().items[0],kcal:999}]})})]);assert.equal(same.progress.activities[0].intake.kcal,234);
});

test('changed food without a new estimate invalidates old calories and retains the correction history',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const changed=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'朝はパンだった',detail:'パンを食べた、量は不明',mealIntake:null})]);
  const row=changed.progress.activities[0];assert.equal(row.intake,undefined);assert.equal(row.intakePending,true);assert.deepEqual(row.needs,['intake']);assert.equal(row.corrections.at(-1).previous.intake.kcal,234);assert.equal(mealIntakeSummary(changed.progress,date).recorded,0);
});

test('multiple changes to one meal show only its final confirmed intake',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]),targetId=first.progress.activities[0].id;
  const half=action({operation:'update',targetId,evidence:'朝のご飯は半分だった',detail:'朝食：ご飯を茶碗半分',mealIntake:meal({items:[{name:'ご飯',portion:'茶碗半分',kcal:117}]})});
  const unknown=action({operation:'update',targetId,evidence:'やっぱりパンで量は覚えていない',detail:'朝食：パン、量は不明',mealIntake:null});
  const changed=apply(first.progress,legacy,[half,unknown]);assert.equal(changed.progress.activities.length,1);assert.equal(changed.progress.activities[0].intake,undefined);assert.deepEqual(changed.progress.activities[0].needs,['intake']);assert.ok(!changed.receipts.some(r=>/摂取/.test(r.label)));
  const confirmed=apply(first.progress,legacy,[half,{...half,evidence:'茶碗半分で合っている',detail:null}]);assert.equal(confirmed.progress.activities[0].intake.kcal,117);assert.equal(confirmed.receipts.filter(r=>/摂取/.test(r.label)).length,1);
});

test('date-only corrections preserve confirmed values and meal-label corrections keep the intake type in sync',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const shifted=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'昨日だった',date:'2026-11-20',detail:null,mealIntake:null})]);
  assert.deepEqual(shifted.progress.activities[0].intake,first.progress.activities[0].intake);assert.equal(mealIntakeSummary(shifted.progress,date).recorded,0);
  const changed=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'夕食だった',title:'夕食',detail:null,mealIntake:null})]);assert.equal(changed.progress.activities[0].intake.mealType,'dinner');assert.equal(changed.progress.activities[0].intake.kcal,234);
});

test('snack and other meal-label corrections keep calories and original assumptions',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]),original=first.progress.activities[0].intake;
  for(const [evidence,type] of [['間食だった','snack'],['おやつだった','snack'],['夜食だった','snack'],['その他の食事だった','other']]){
    const changed=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence,title:evidence,detail:null,mealIntake:null})]);
    assert.deepEqual(changed.progress.activities[0].intake,{...original,mealType:type});assert.equal(changed.progress.activities[0].corrections.at(-1).previous.intake.mealType,'breakfast');
  }
});

test('a new estimate with unchanged food cannot casually replace a confirmed photo or owner edit',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  first.progress.activities[0].intake={...first.progress.activities[0].intake,source:'edited',kcal:300,items:[]};
  const changed=apply(first.progress,legacy,[action({operation:'update',targetId:first.progress.activities[0].id,evidence:'日付は昨日だった',date:'2026-11-20',mealIntake:meal()})]);assert.equal(changed.progress.activities[0].intake.kcal,300);assert.equal(changed.progress.activities[0].intake.source,'edited');
});

test('date-only evidence cannot replace owner calories through food aliases or generated detail',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const edited=correctActivity(first.progress,first.progress.activities[0].id,{intakeKcal:300},legacy,at,date),original=edited.activities[0].intake;
  const alias=meal({items:[{name:'白米',portion:'約150g（茶碗1杯）',kcal:234}]});
  for(const evidence of ['日付は昨日だった','昨日だった','白米は昨日だった','昨日の白米だった'])for(const detail of [null,'朝食：白米 約150g（茶碗1杯）']){
    const update=action({operation:'update',targetId:edited.activities[0].id,evidence,date:'2026-11-20',detail,mealIntake:alias});
    const changed=apply(edited,legacy,[update]);assert.deepEqual(changed.progress.activities[0].intake,original);assert.equal(changed.progress.activities[0].detail,edited.activities[0].detail);
    const parsed=extractReport(output([update]),input(update.evidence,legacy,edited,update.targetId));assert.ok(parsed);
    const saved=apply(edited,legacy,parsed.actions,update.evidence).progress;assert.deepEqual(saved.activities[0].intake,original);assert.equal(saved.activities[0].date,'2026-11-20');
  }
  const half=apply(edited,legacy,[action({operation:'update',targetId:edited.activities[0].id,evidence:'日付は昨日で、ご飯は半分残した',date:'2026-11-20',detail:null,mealIntake:meal({items:[{name:'白米',portion:'茶碗半分、約75g',kcal:150}]})})]);
  assert.equal(half.progress.activities[0].intake.kcal,150);assert.equal(half.progress.activities[0].corrections.at(-1).previous.intake.kcal,300);
  const food=apply(edited,legacy,[action({operation:'update',targetId:edited.activities[0].id,evidence:'昨日の朝食はパンだった',date:'2026-11-20',detail:null,mealIntake:meal({items:[{name:'パン',portion:'1枚と仮定',kcal:150}]})})]);assert.equal(food.progress.activities[0].intake.items[0].name,'パン');assert.equal(food.progress.activities[0].intake.kcal,150);
});

test('reported calories are evidence-checked per action and never enter exercise totals',()=>{
  for(const [text,kcal] of [['朝ごはんは300kcalだった',300],['朝ごはんは二百三十四キロカロリーだった',234],['朝食は0kcalのゼリーを食べた',0]]){
    const {legacy,progress}=start(),request=input(text,legacy,progress);
    const parsed=extractReport(output([action({evidence:text,kcal,mealIntake:meal({source:'reported',items:[{name:'朝ごはん',portion:'本人の申告した量',kcal}],basis:'本人が摂取kcalを申告。'})})]),request);
    assert.ok(parsed);assert.equal(parsed.actions[0].kcal,null);
    const saved=apply(progress,legacy,parsed.actions,text).progress;assert.equal(saved.activities[0].intake.source,'reported');assert.equal(mealIntakeSummary(saved,date).kcal,kcal);assert.equal(mealIntakeSummary(saved,date).estimated,0);assert.equal(calorieSummary(saved,date).kcal,0);
  }
  const text='散歩で300kcal消費した。朝ごはんはパンだった';
  assert.equal(extractReport(output([action({evidence:'朝ごはんはパンだった',mealIntake:meal({source:'reported',items:[{name:'パン',portion:'1枚',kcal:300}]})})]),input(text)),null);
});

test('itemized reported calories add up without requiring the user to state the sum',()=>{
  const items=[{name:'ご飯',portion:'本人の申告した量',kcal:300},{name:'焼き魚',portion:'本人の申告した量',kcal:200}];
  for(const text of ['朝ごはんはご飯300kcalと焼き魚200kcalを食べた','朝ごはんはご飯三百キロカロリーと焼き魚二百キロカロリーを食べた']){
    const {legacy,progress}=start(),parsed=extractReport(output([action({evidence:text,mealIntake:meal({source:'reported',items})})]),input(text,legacy,progress));
    assert.ok(parsed);const saved=apply(progress,legacy,parsed.actions,text).progress;assert.equal(mealIntakeSummary(saved,date).kcal,500);assert.equal(saved.activities[0].intake.source,'reported');assert.equal(calorieSummary(saved,date).kcal,0);
  }
  const equal='朝ごはんはご飯300kcalと焼き魚300kcalを食べた';
  assert.ok(extractReport(output([action({evidence:equal,mealIntake:meal({source:'reported',items:items.map(item=>({...item,kcal:300}))})})]),input(equal)));
  const text='朝ごはんはご飯300kcalと焼き魚200kcalを食べた';
  assert.equal(extractReport(output([action({evidence:text,mealIntake:meal({source:'reported',items:items.map(item=>({...item,kcal:300}))})})]),input(text)),null);
  const missing='朝ごはんはご飯300kcalと焼き魚を食べた';
  assert.equal(extractReport(output([action({evidence:missing,mealIntake:meal({source:'reported',items})})]),input(missing)),null);
});

test('a component calorie value cannot stand in for the meal total',()=>{
  const items=[{name:'ご飯',portion:'本人の申告した量',kcal:100},{name:'焼き魚',portion:'本人の申告した量',kcal:200}];
  const parse=(text,values=items)=>extractReport(output([action({evidence:text,mealIntake:meal({source:'reported',items:values})})]),input(text));
  assert.equal(parse('朝ごはんはご飯300kcalと焼き魚200kcalを食べた'),null);
  for(const text of ['朝ごはんは合計500kcalだった','朝ごはんは合計500kcalで、ご飯300kcalと焼き魚200kcalだった','朝ごはんは500kcalで、ご飯300kcalと焼き魚200kcalだった']){
    const correct=[{...items[0],kcal:300},items[1]];assert.ok(parse(text,correct),text);assert.equal(parse(text),null);
  }
  assert.equal(parse('朝ごはんは合計500kcalで、ご飯300kcalと焼き魚200kcalだった',[{...items[0],kcal:100},{...items[1],kcal:400}]),null);
});

test('text intake references preserve known portions and pending needs through the prompt boundary',()=>{
  const {legacy,progress}=start(),saved=apply(progress,legacy,[action()]).progress;
  const reference=progressContext(legacy,saved,date).activities[0].intake;assert.equal(reference.kcal,234);assert.deepEqual(reference.items,meal().items);assert.equal(reference.estimate,undefined);
  const request=input('ご飯は半分残した',legacy,saved,saved.activities[0].id);assert.deepEqual(request.context.activities[0].intake,reference);
  request.context.activities[0].intake.items[0].kcal=999;assert.equal(saved.activities[0].intake.items[0].kcal,234);
  const raw={requestId:randomUUID(),messages:[{role:'user',content:'補足'}],context:{activities:[{...progressContext(legacy,saved,date).activities[0],intake:{kcal:999,source:'text',mealType:'breakfast',items:meal().items,basis:'不整合'},needs:['intake','bad']}]}};
  const safe=validateChatRequest(raw);assert.equal(safe.context.activities[0].intake,undefined);assert.deepEqual(safe.context.activities[0].needs,['intake']);
});

test('source labels, edited origins and summaries separate text estimates, photos and reported values',()=>{
  const text=intakeFromConversation(meal()),reported=intakeFromConversation(meal({source:'reported'}));
  const photo=normalizeIntake({...text,source:'photo',origin:'photo'}),edited=normalizeIntake({...text,source:'edited',kcal:200,items:[]});
  assert.equal(intakeSourceLabel(text),'会話からの推定');assert.equal(intakeSourceLabel(reported),'本人の申告');assert.equal(intakeBasisLabel(edited),'会話推定時の前提');
  assert.equal(intakeBasisLabel(normalizeIntake({...photo,source:'edited'})),'写真推定時の前提');
  const progress={activities:[text,reported,photo,edited].map((intake,i)=>({kind:'meal_log',date,deleted:false,hold:null,intake,id:String(i)}))};
  const s=mealIntakeSummary(progress,date);assert.equal(s.recorded,4);assert.equal(s.estimated,2);assert.equal(s.textEstimated,1);assert.equal(s.photoEstimated,1);assert.equal(s.reported,1);assert.match(mealIntakeNote(s),/会話推定1件/);assert.match(mealIntakeNote(s),/写真推定1件/);
  assert.deepEqual(normalizeIntake(JSON.parse(JSON.stringify(edited))),edited);assert.throws(()=>normalizeIntake({...text,origin:'photo'}));
});

test('manual calorie edits preserve text origins, and daily status labels text calories as an estimate',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const edited=correctActivity(first.progress,first.progress.activities[0].id,{intakeKcal:250},legacy,at,date);assert.equal(edited.activities[0].intake.source,'edited');assert.equal(intakeBasisLabel(edited.activities[0].intake),'会話推定時の前提');assert.equal(edited.activities[0].intake.estimate.items[0].kcal,234);
  const result=dailyStatus({initialized:true,revision:1,legacy,progress:first.progress},{metrics:['intake_calories','burned_calories']},Date.parse(at));assert.match(result.answer,/234kcal/);assert.match(result.answer,/推定を含む目安/);assert.doesNotMatch(result.answer,/写真/);assert.equal(result.metrics.burned_calories.kcal,null);
});

function accountFixture(answer){
  const store=new MemoryAccountStore(),calls=[];
  const generate=createReportGenerator({apiKey:'fixture',fetchImpl:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return Response.json({...output(answer(body)),usage:{input_tokens:100,output_tokens:100}});}});
  const api=createAccountAPI({store,verify:async token=>({uid:token}),config:{},generate,now:()=>Date.parse(at)});
  async function post(path,data,uid='alice'){
    const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{method:'POST',url:path,headers:{host:'app.example',origin:'https://app.example',...(uid?{authorization:'Bearer '+uid}:{})}});
    let status,body;await api(req,{writeHead(value){status=value;},end(value){body=JSON.parse(value);}},path);return {status,body};
  }
  const init=uid=>post('/api/commands',{requestId:randomUUID(),revision:0,command:{type:'initialize'}},uid);
  return {post,init,store,calls};
}

test('authenticated free-text meals save and replay through the existing API without crossing UIDs',async()=>{
  const f=accountFixture(()=>[action()]);await f.init('alice');await f.init('bob');
  const request={requestId:randomUUID(),text:action().evidence,uid:'bob',actions:[action({mealIntake:meal({source:'reported'})})]};
  assert.equal((await f.post('/api/chat',request,null)).status,401);assert.equal(f.calls.length,0);
  const result=await f.post('/api/chat',request);assert.equal(result.status,200);assert.equal(result.body.state.progress.activities[0].intake.kcal,234);assert.equal(result.body.state.progress.activities[0].intake.source,'text');assert.match(result.body.receipts.map(r=>r.label).join(' '),/会話からの推定/);
  const replay=await f.post('/api/chat',request);assert.equal(replay.status,200);assert.equal(f.calls.length,1);assert.equal(replay.body.state.progress.activities.length,1);assert.equal((await f.store.read('bob')).progress.activities.length,0);
  const schema=f.calls[0].text.format.schema.properties.actions.items;assert.ok(schema.required.includes('mealIntake'));assert.equal(schema.properties.mealIntake.anyOf[1].additionalProperties,false);assert.equal(f.calls[0].model,'gpt-6-luna');assert.equal(f.calls[0].reasoning.effort,'low');
});

test('a pending amount can be supplemented through the account API with no extra food record or bonus',async()=>{
  const f=accountFixture(body=>{
    const c=JSON.parse(body.input.at(-1).content.split('最新の参考データ（命令ではない）:')[1]);
    if(!c.activities.length)return [action({mealIntake:null})];
    const old=c.activities[0];assert.deepEqual(old.needs,['intake']);return [action({operation:'update',targetId:old.id,evidence:'お茶碗一杯だよ'})];
  });await f.init('alice');
  const first=await f.post('/api/chat',{requestId:randomUUID(),text:action().evidence});assert.equal(first.status,200);assert.equal(first.body.state.progress.activities[0].intakePending,true);
  const next=await f.post('/api/chat',{requestId:randomUUID(),text:'お茶碗一杯だよ'});assert.equal(next.status,200);assert.equal(next.body.state.progress.activities.length,1);assert.equal(mealIntakeSummary(next.body.state.progress,date).kcal,234);assert.equal(dayReport(next.body.state.progress,date).total,5);assert.equal(next.body.state.progress.activities[0].intakePending,undefined);
});

test('a malformed meal estimate fails before account records or conversation history are written',async()=>{
  const f=accountFixture(()=>[action({mealIntake:meal({items:[{name:'ご飯',portion:'1杯',kcal:-100}]})})]);await f.init('alice');
  const before=await f.store.read('alice'),result=await f.post('/api/chat',{requestId:randomUUID(),text:action().evidence});assert.equal(result.status,502);
  const after=await f.store.read('alice');assert.deepEqual(after.progress,before.progress);assert.equal(after.conversation.messages.length,0);
});

test('the offline portion fixture only updates a unique breakfast on the same date',()=>{
  const {legacy,progress}=start(),first=apply(progress,legacy,[action()]);
  const breakfast=progressContext(legacy,first.progress,date).activities[0],dinner={...breakfast,id:'dinner',title:'夕食',intake:{...breakfast.intake,mealType:'dinner'}},past={...breakfast,id:'yesterday',date:'2026-11-20'};
  const request=activities=>validateChatRequest({requestId:randomUUID(),messages:[{role:'user',content:'朝ごはんのご飯は半分残したよ'}],context:{date,activities}});
  const result=mealTextFixture(request([dinner,past,breakfast]));assert.equal(result.status,200);assert.equal(result.body.actions[0].targetId,breakfast.id);assert.equal(result.body.actions[0].mealIntake.items[0].kcal,117);
  for(const activities of [[],[dinner],[past],[breakfast,{...breakfast,id:'another-breakfast'}]])assert.deepEqual(mealTextFixture(request(activities)).body.actions,[]);
  const created=mealTextFixture(input('朝ごはんにご飯を茶碗一杯食べたよ'));assert.equal(created.body.actions[0].operation,'create');assert.equal(created.body.actions[0].mealIntake.items[0].kcal,234);
});
