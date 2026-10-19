import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyState,recordHabit,affectionFor} from '../dist/model.mjs';
import {emptyProgress,normalizeProgress,applyInterpretation,dayReport,progressTotal,exercisePoints,recordManual,progressCompanion,validDate,correctActivity,measurementRecords,weightReference,progressContext} from '../dist/progress.mjs';

const today='2026-10-18',at='2026-10-18T12:00:00.000Z';
function action(kind,extra={}){return {operation:'create',targetId:null,kind,date:today,title:'できたこと',evidence:'やった',minutes:null,kcal:null,weightKg:null,detail:null,additional:false,...extra};}
function start(){const legacy=emptyState();return {legacy,progress:emptyProgress(legacy,new Date(at))};}
let sequence=0;
function apply(progress,legacy,actions,text='やった',extra={}){return applyInterpretation(progress,{requestId:'request-'+(++sequence),actions,text,today,at,reply:'自分のための一歩、えらいねー。',...extra},legacy);}

test('different daily quests accumulate once, the same snack action cannot earn other categories',()=>{
  const {legacy,progress}=start();
  const result=apply(progress,legacy,[action('stretch'),action('snack'),action('meal_care'),action('care'),action('rest')]);
  const r=dayReport(result.progress,today);
  assert.equal(r.total,30); // stretch, snack, rest; the same evidence is one food/care action.
  assert.equal(r.quests.filter(q=>q.done).length,3);
  const again=apply(result.progress,legacy,[action('stretch'),action('snack')]);
  assert.equal(again.delta,0);
  assert.equal(progressTotal(again.progress),30);
});

test('exercise points follow the daily nonlinear formula and have only the first 20kcal quest',()=>{
  assert.deepEqual([0,10,20,50,100,200,300,500].map(exercisePoints),[0,1,2,5,10,21,33,59]);
  const {legacy,progress}=start();
  const a=apply(progress,legacy,[action('walk',{kcal:10})]);
  assert.equal(dayReport(a.progress,today).total,1);
  const b=apply(a.progress,legacy,[action('run',{kcal:90,evidence:'追加で走った',additional:true})],'追加で走った');
  const c=apply(b.progress,legacy,[action('strength',{kcal:200,evidence:'さらに筋トレした'})],'さらに筋トレした');
  assert.equal(dayReport(c.progress,today).total,43);
  assert.equal(dayReport(c.progress,today).quests.filter(q=>q.id==='exercise'&&q.done).length,1);
  assert.equal(c.delta,23);
});

test('missing inputs stay pending, then one activity receives the Luna estimate and its basis',()=>{
  const {legacy,progress}=start();
  let result=apply(progress,legacy,[action('walk')]);
  assert.equal(result.delta,0);assert.match(result.reply,/どのくらいの時間/);
  const id=result.progress.activities[0].id;
  result=apply(result.progress,legacy,[action('walk',{operation:'update',targetId:id,minutes:20,evidence:'20分'})],'20分');
  assert.equal(result.progress.activities.length,1);assert.match(result.reply,/体重/);
  result=apply(result.progress,legacy,[action('walk',{operation:'update',targetId:id,weightKg:60,estimatedKcal:80,estimateBasis:'体重60kg・20分の通常の歩行を前提とした目安',evidence:'60kg'})],'60kg');
  assert.equal(result.progress.activities.length,1);
  assert.equal(dayReport(result.progress,today).kcal,80);
  assert.equal(result.progress.activities[0].estimate.source,'luna');
  assert.match(result.progress.activities[0].estimate.basis,/60kg/);
  assert.equal(dayReport(result.progress,today).quests.find(q=>q.id==='weight').done,false);
  assert.equal(dayReport(result.progress,today).total,18);
  assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(result.progress))),result.progress);
});

test('the app does not invent calories even with enough inputs; unknown information can stay pending',()=>{
  const {legacy,progress}=start();legacy.days[today]={habits:[],weight:60};
  const a=apply(progress,legacy,[action('run',{minutes:10})]);
  assert.equal(a.progress.activities[0].estimate,null);
  assert.equal(dayReport(a.progress,today).kcal,0);
  assert.deepEqual(a.progress.activities[0].needs,['kcal']);
  assert.doesNotMatch(a.reply,/体重/);
  const b=apply(a.progress,legacy,[action('walk')]);
  const id=b.progress.activities.at(-1).id;
  const c=apply(b.progress,legacy,[action('walk',{operation:'update',targetId:id,evidence:'わからない'})],'わからない');
  assert.doesNotMatch(c.reply,/どのくらい/);
  assert.ok(c.progress.activities.at(-1).needs.includes('minutes'));
});

test('the weight shown in records takes priority over a newer weight mentioned during exercise',()=>{
  const {legacy,progress}=start();legacy.days['2026-10-17']={habits:[],weight:64.2};
  const a=apply(progress,legacy,[action('walk',{minutes:20,weightKg:60})]);
  const context=progressContext(legacy,a.progress,today);
  assert.equal(context.weightKg,64.2);assert.equal(context.weightDate,'2026-10-17');assert.equal(context.weightSource,'record');
  assert.equal(context.activities.find(a=>a.kind==='walk').weightKg,64.2);
  assert.equal(measurementRecords(legacy,a.progress).at(-1).value,context.weightKg);
  assert.doesNotMatch(a.reply,/体重（kg）を教えて/);
  assert.equal(dayReport(a.progress,today).quests.find(q=>q.id==='weight').done,false);
  assert.equal(a.progress.activities[0].weightKg,60); // Historical input remains intact.
});

test('new and corrected weight records reach the next context, independently of the activity limit',()=>{
  const {legacy,progress}=start();legacy.days[today]={habits:[],weight:66};
  const a=recordManual(progress,{id:'weight-record',kind:'weight',date:today,title:'体重記録',weightKg:64.2},legacy,at);
  const id=a.progress.activities[0].id;
  const b=correctActivity(a.progress,id,{weightKg:63.8},legacy,at);
  const snapshot=JSON.parse(JSON.stringify(b));
  for(let i=0;i<20;i++)snapshot.activities.push({...snapshot.activities[0],id:'recent-'+i,kind:'rest',weightKg:null,updatedAt:'2026-10-18T13:00:00.000Z'});
  const context=progressContext(legacy,normalizeProgress(snapshot),today);
  assert.equal(context.activities.length,18);assert.equal(context.activities.some(a=>a.kind==='weight'),false);
  assert.equal(context.weightKg,63.8);assert.equal(context.weightSource,'record');
  assert.equal(measurementRecords(legacy,b).at(-1).value,63.8);
  assert.equal(progressContext(legacy,a.progress,today).weightKg,64.2);
});

test('only an available record or previously reported weight is used, never a future or fabricated value',()=>{
  const {legacy,progress}=start();legacy.days['2026-10-19']={habits:[],weight:70};
  assert.equal(weightReference(legacy,progress,today),null);
  const context=progressContext(legacy,progress,today);
  assert.equal(context.weightKg,null);assert.equal(context.weightDate,null);assert.equal(context.hasWeight,false);
  const a=apply(progress,legacy,[action('walk',{minutes:20,weightKg:60})]);
  assert.deepEqual(weightReference(legacy,a.progress,today),{value:60,date:today,source:'conversation'});
});

test('Luna estimates survive date corrections and retries; changed conditions await a new estimate',()=>{
  const {legacy,progress}=start();
  const a=apply(progress,legacy,[action('exercise',{minutes:25,weightKg:60,detail:'水泳をゆっくり',estimatedKcal:140,estimateBasis:'60kg・25分のゆっくりした水泳の概算'})]);
  const id=a.progress.activities[0].id;
  const differentKind=apply(a.progress,legacy,[action('run',{operation:'update',targetId:id,evidence:'ランニングだった'})],'ランニングだった');
  assert.equal(differentKind.progress.activities[0].estimate,null);
  assert.equal(dayReport(differentKind.progress,today).kcal,0);
  const b=apply(a.progress,legacy,[action('exercise',{operation:'update',targetId:id,date:'2026-10-17',evidence:'昨日だった'})],'昨日だった');
  assert.equal(dayReport(b.progress,'2026-10-17').kcal,140);
  const c=correctActivity(b.progress,id,{minutes:40},legacy,at);
  assert.equal(c.activities[0].estimate,null);
  assert.deepEqual(c.activities[0].needs,['kcal']);
  assert.equal(dayReport(c,'2026-10-17').kcal,0);
  const d=apply(c,legacy,[action('exercise',{operation:'update',targetId:id,date:'2026-10-17',minutes:40,estimatedKcal:225,estimateBasis:'60kg・40分のゆっくりした水泳の概算',evidence:'40分に訂正'})],'40分に訂正');
  assert.equal(d.progress.activities.length,1);
  assert.equal(dayReport(d.progress,'2026-10-17').kcal,225);
  const repeated=apply(d.progress,legacy,[action('exercise',{operation:'repeat',targetId:id})]);
  assert.equal(repeated.delta,0);
  assert.equal(progressTotal(repeated.progress),progressTotal(d.progress));
});

test('retries and repeated reports do not double count, ambiguous additional exercise waits for confirmation',()=>{
  const {legacy,progress}=start();
  const a=apply(progress,legacy,[action('walk',{kcal:100})],'やった',{requestId:'same-request'});
  const retry=apply(a.progress,legacy,[action('walk',{kcal:100})],'やった',{requestId:'same-request'});
  assert.equal(retry.replayed,true);assert.equal(retry.delta,0);
  const b=apply(a.progress,legacy,[action('walk',{kcal:50,evidence:'歩いて50kcalだった'})],'歩いて50kcalだった');
  assert.equal(dayReport(b.progress,today).kcal,100);
  assert.match(b.reply,/追加/);
  const pending=b.progress.activities.at(-1);
  const c=apply(b.progress,legacy,[action('walk',{operation:'update',targetId:pending.id,kcal:50,evidence:'追加だよ',additional:true})],'追加だよ');
  assert.equal(dayReport(c.progress,today).kcal,150);
});

test('corrections move the original action between dates and recalculate reports without penalty resets',()=>{
  const {legacy,progress}=start();
  const a=apply(progress,legacy,[action('walk',{kcal:300})]);
  const id=a.progress.activities[0].id;
  const b=apply(a.progress,legacy,[action('walk',{operation:'update',targetId:id,date:'2026-10-17',kcal:100,evidence:'昨日の100kcalだった'})],'昨日の100kcalだった');
  assert.equal(dayReport(b.progress,today).recorded,false);
  assert.equal(dayReport(b.progress,'2026-10-17').total,20);
  assert.equal(b.progress.activities.length,1);
  assert.equal(b.progress.activities[0].corrections.length,1);
  assert.ok(progressCompanion(b.progress,legacy).score>=progressCompanion(a.progress,legacy).score);
});

test('manual weight and food records earn fixed bonuses only after actual content is saved',()=>{
  const {legacy,progress}=start();
  let a=apply(progress,legacy,[action('weight')]);assert.equal(a.delta,0);
  a=recordManual(a.progress,{id:'manual-weight',kind:'weight',date:today,title:'体重記録',weightKg:60},legacy,at);
  assert.equal(dayReport(a.progress,today).total,5);
  const b=apply(a.progress,legacy,[action('meal_log',{detail:'ごはんと焼き魚'})]);
  assert.equal(dayReport(b.progress,today).total,10);
  const c=recordManual(b.progress,{id:'manual-weight',kind:'weight',date:today,title:'体重記録',weightKg:61},legacy,at);
  assert.equal(dayReport(c.progress,today).total,10);
  assert.equal(c.progress.activities.filter(x=>x.kind==='weight').length,1);
});

test('migration preserves legacy affection, records and inventory without retroactive point conversion',()=>{
  const legacy=emptyState();recordHabit(legacy,'2026-10-17','walk');legacy.owned=['flower'];legacy.decor=['flower'];
  const snapshot=structuredClone(legacy),progress=emptyProgress(legacy,new Date(at));
  assert.equal(progressTotal(progress),0);
  assert.equal(progressCompanion(progress,legacy).score,affectionFor(legacy).score);
  assert.deepEqual(legacy,snapshot);
  assert.deepEqual(normalizeProgress(progress),progress);
});

test('invalid and future results fail atomically and unknown storage versions are rejected',()=>{
  const {legacy,progress}=start(),snapshot=structuredClone(progress);
  for(const a of [action('walk',{date:'2026-10-19'}),action('stretch',{evidence:'not in message'}),action('weight',{weightKg:NaN})])assert.throws(()=>apply(progress,legacy,[a]));
  assert.deepEqual(progress,snapshot);
  assert.throws(()=>normalizeProgress({...progress,version:2}));
  assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-99-99'),false);
});

test('a tiny stretch still earns its first bonus and a saved weight need not be asked again',()=>{
  const {legacy,progress}=start();legacy.days[today]={habits:[],weight:60};
  const a=apply(progress,legacy,[action('stretch',{minutes:1/60}),action('weight',{evidence:'体重を記録した'})],'やった。体重を記録した');
  assert.equal(dayReport(a.progress,today).total,15);
  assert.equal(a.progress.activities.find(x=>x.kind==='weight').needs.length,0);
  assert.ok(progressCompanion(a.progress,legacy).xp>=15);
});
