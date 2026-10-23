import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyState,recordHabit,affectionFor} from '../dist/model.mjs';
import {emptyProgress,normalizeProgress,applyInterpretation,dayReport,progressTotal,exercisePoints,recordManual,progressCompanion,validDate,correctActivity,measurementRecords,weightReference,progressContext,calorieSummary} from '../dist/progress.mjs';

const today='2026-10-18',at='2026-10-18T12:00:00.000Z';
function action(kind,extra={}){return {operation:'create',targetId:null,kind,date:today,title:'できたこと',evidence:'やった',minutes:null,kcal:null,weightKg:null,detail:null,additional:false,...extra};}
function start(){const legacy=emptyState();return {legacy,progress:emptyProgress(legacy,new Date(at))};}
let sequence=0;
function apply(progress,legacy,actions,text='やった',extra={}){return applyInterpretation(progress,{requestId:'request-'+(++sequence),actions,text,today,at,reply:'自分のための一歩、えらいねー。',...extra},legacy);}

test('different daily quests accumulate once, the same snack action cannot earn other categories',()=>{
  const {legacy,progress}=start();
  const result=apply(progress,legacy,[action('stretch'),action('snack'),action('meal_care'),action('care'),action('rest',{evidence:'休んだ'})],'やった。休んだ');
  const r=dayReport(result.progress,today);
  assert.equal(r.total,30); // stretch, snack, rest; one food/care action.
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

test('daily life rewards grant 5 or 10 points once per category per date without exercise calories',()=>{
  const {legacy,progress}=start();
  const entries=[['meal_care','自炊した'],['eating_habit','小皿に分けた'],['rest','休憩した'],['housework','洗濯した'],['mood_log','気分を書いた'],['challenge','後回しの連絡を返した']];
  const text=entries.map(([,s])=>s).join('。');
  const a=apply(progress,legacy,entries.map(([kind,evidence])=>action(kind,{evidence,title:evidence})),text);
  assert.equal(a.delta,45);assert.equal(dayReport(a.progress,today).kcal,0);assert.equal(dayReport(a.progress,today).exercise,0);
  assert.deepEqual(a.receipts.map(r=>r.delta).sort((a,b)=>a-b),[5,5,5,10,10,10]);
  const b=apply(a.progress,legacy,[action('housework',{evidence:'掃除もした',additional:true})],'掃除もした');assert.equal(b.delta,0);assert.equal(b.progress.activities.filter(x=>x.kind==='housework').length,2);
  const c=apply(b.progress,legacy,[action('challenge',{evidence:'掃除もした'})],'掃除もした');assert.equal(c.delta,0);assert.equal(c.progress.activities.filter(x=>x.kind==='challenge').length,1);
  const d=apply(c.progress,legacy,[action('housework',{date:'2026-10-17',evidence:'昨日も洗濯した'})],'昨日も洗濯した');assert.equal(d.delta,5);
  const retry=applyInterpretation(d.progress,{requestId:d.progress.processed.at(-1),actions:[],text:'昨日も洗濯した'},legacy);assert.equal(retry.delta,0);assert.equal(retry.replayed,true);
  assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(d.progress))),d.progress);
});

test('records without pointVersion retain old bonuses after reload, new reports, and date corrections',()=>{
  const {legacy,progress}=start();
  const entries=[['snack','間食を控えた'],['meal_care','自炊した'],['rest','休んだ'],['care','自分をいたわった'],['weight','測った'],['meal_log','食事を記録した']];
  const initial=apply(progress,legacy,entries.map(([kind,evidence])=>action(kind,{evidence,...(kind==='weight'?{weightKg:60}:{}),...(kind==='meal_log'?{detail:'ごはん'}:{})})),entries.map(([,s])=>s).join('。')).progress;
  initial.activities.forEach(a=>delete a.pointVersion);initial.peakPoints=45;
  const old=normalizeProgress(JSON.parse(JSON.stringify(initial)));assert.equal(progressTotal(old),45);
  const next=apply(old,legacy,[action('housework',{evidence:'洗濯した'})],'洗濯した');assert.equal(next.delta,5);assert.equal(progressTotal(next.progress),50);assert.equal(next.progress.peakPoints,50);
  assert.equal(dayReport(next.progress,today).quests.find(q=>q.id==='rest').bonus,10);
  const moved=correctActivity(next.progress,old.activities.find(a=>a.kind==='rest').id,{date:'2026-10-17'},legacy,at);assert.equal(progressTotal(moved),50);assert.equal(dayReport(moved,'2026-10-17').total,10);
  const fresh=apply(moved,legacy,[action('rest',{evidence:'今日は休憩した'})],'今日は休憩した');assert.equal(fresh.delta,10);assert.equal(dayReport(fresh.progress,today).quests.find(q=>q.id==='rest').bonus,10);
  assert.throws(()=>normalizeProgress({...fresh.progress,activities:fresh.progress.activities.map(a=>({...a,pointVersion:99}))}));
});

test('an uncompleted old weight or food report does not set the rate of a separate new record',()=>{
  for(const pointVersion of [1,2]){
    const {legacy,progress}=start();
    const pending=apply(progress,legacy,[action('weight'),action('meal_log')]).progress;
    pending.activities.forEach(a=>{a.pointVersion=pointVersion;});
    const saved=apply(pending,legacy,[action('weight',{weightKg:60,evidence:'測った',additional:true}),action('meal_log',{detail:'ごはん',evidence:'食べた',additional:true})],'測った。食べた');
    assert.equal(saved.delta,10);assert.equal(dayReport(saved.progress,today).quests.find(q=>q.id==='weight').bonus,5);assert.equal(dayReport(saved.progress,today).quests.find(q=>q.id==='meal_log').bonus,5);
  }
});

test('version 2 rewards retain their awarded points through reloads, repeats and corrections',()=>{
  const {legacy,progress}=start();
  const initial=apply(progress,legacy,[action('housework',{evidence:'洗濯した'}),action('rest',{evidence:'休んだ'})],'洗濯した。休んだ').progress;
  initial.activities.forEach(a=>{a.pointVersion=2;a.date='2026-10-17';});initial.peakPoints=3;
  const old=normalizeProgress(JSON.parse(JSON.stringify(initial)));
  assert.equal(progressTotal(old),3);assert.equal(old.peakPoints,3);
  const sameDay=apply(old,legacy,[action('housework',{date:'2026-10-17',evidence:'追加で掃除した',additional:true})],'追加で掃除した');
  assert.equal(sameDay.delta,0);assert.equal(dayReport(sameDay.progress,'2026-10-17').total,3);
  const nextDay=apply(sameDay.progress,legacy,[action('housework',{evidence:'洗濯した'}),action('rest',{evidence:'休んだ'})],'洗濯した。休んだ');
  assert.equal(nextDay.delta,15);assert.equal(progressTotal(nextDay.progress),18);
  const corrected=correctActivity(nextDay.progress,old.activities.find(a=>a.kind==='rest').id,{date:'2026-10-16'},legacy,at);
  assert.equal(dayReport(corrected,'2026-10-16').total,2);assert.equal(progressTotal(corrected),18);
  assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(corrected))),corrected);
});

test('missing inputs stay pending, then one activity receives the Luna estimate and its basis',()=>{
  const {legacy,progress}=start();
  let result=apply(progress,legacy,[action('walk')]);
  assert.equal(result.delta,0);assert.match(result.reply,/どのくらいの時間/);
  const id=result.progress.activities[0].id;
  result=apply(result.progress,legacy,[action('walk',{operation:'update',targetId:id,minutes:20,evidence:'20分'})],'20分');
  assert.equal(result.progress.activities.length,1);assert.match(result.reply,/体重/);assert.doesNotMatch(result.reply,/計算|推定|記録|保存/);
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
  assert.doesNotMatch(a.reply,/計算|推定|記録|保存|ぼくが考える/);
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


test('calorie records separate reported and estimated values and keep unestimated exercise pending',()=>{
 const {legacy,progress}=start();
 const r=apply(progress,legacy,[action('walk',{kcal:100,estimatedKcal:999,estimateBasis:'使わない推定'}),action('run',{estimatedKcal:120.4,estimateBasis:'架空の目安'}),action('stretch'),action('snack')]);
 assert.deepEqual(calorieSummary(r.progress,today),{kcal:220.4,reported:100,estimated:120.4,recorded:2,pending:1,estimatedCount:1,exerciseCount:3});
 assert.equal(calorieSummary(r.progress,today).kcal,dayReport(r.progress,today).kcal);
 assert.deepEqual(calorieSummary(normalizeProgress(JSON.parse(JSON.stringify(r.progress)))),calorieSummary(r.progress));
 const retry=apply(r.progress,legacy,[], 'やった',{requestId:r.progress.processed.at(-1)});assert.equal(calorieSummary(retry.progress).kcal,220.4);
});
test('calorie history follows corrections and excludes held duplicates, deleted and undated exercise',()=>{
 const {legacy,progress}=start();const r=apply(progress,legacy,[action('walk',{minutes:10,kcal:80})]);
 const duplicate=apply(r.progress,legacy,[action('walk',{minutes:20,estimatedKcal:100,estimateBasis:'仮',evidence:'別の日か不明の散歩'})],'別の日か不明の散歩');
 assert.equal(duplicate.progress.activities.at(-1).hold,'duplicate');assert.equal(calorieSummary(duplicate.progress).kcal,80);
 const corrected=correctActivity(duplicate.progress,r.progress.activities[0].id,{date:'2026-10-17',kcal:65},legacy,at);
 assert.equal(calorieSummary(corrected,today).kcal,0);assert.equal(calorieSummary(corrected,'2026-10-17').kcal,65);assert.equal(calorieSummary(corrected).kcal,65);
 const removed=structuredClone(corrected);removed.activities[0].deleted=true;assert.equal(calorieSummary(removed).kcal,0);removed.activities[0].deleted=false;removed.activities[0].date=null;assert.equal(calorieSummary(removed).kcal,0);
});
test('unknown consumption and an explicit zero are distinct without inventing calories',()=>{
 const {legacy,progress}=start();assert.equal(calorieSummary(progress).exerciseCount,0);
 const unknown=apply(progress,legacy,[action('exercise')]);assert.equal(calorieSummary(unknown.progress).pending,1);assert.equal(calorieSummary(unknown.progress).recorded,0);
 const zero=apply(progress,legacy,[action('exercise',{kcal:0})]);assert.equal(calorieSummary(zero.progress).recorded,1);assert.equal(calorieSummary(zero.progress).pending,0);
});

test('legacy meal categories require confirmation before a manual eating-habit reward',()=>{
  const {legacy,progress}=start();
  for(const evidence of ['ゆっくり食べた','自炊した']){
    const old=apply(progress,legacy,[action('meal_care',{evidence})],evidence).progress;
    delete old.activities[0].pointVersion;
    const marked=recordManual(old,{id:'meal',kind:'eating_habit',date:today,today,title:'食事をゆっくり楽しんだ'},legacy,at);
    assert.equal(marked.delta,0);assert.equal(progressTotal(marked.progress),10);
    const pending=marked.progress.activities.at(-1);
    assert.equal(pending.hold,'duplicate');assert.deepEqual(pending.needs,['duplicate']);
    const repeated=apply(marked.progress,legacy,[action('eating_habit',{operation:'repeat',targetId:pending.id,evidence:'同じ分だよ'})],'同じ分だよ');
    assert.equal(repeated.delta,0);assert.equal(progressTotal(repeated.progress),10);
    const separate=apply(marked.progress,legacy,[action('eating_habit',{operation:'update',targetId:pending.id,additional:true,evidence:'追加だよ'})],'追加だよ');
    assert.equal(separate.delta,5);assert.equal(progressTotal(separate.progress),15);
    assert.equal(separate.progress.activities[0].pointVersion,1);
  }
});

test('version 1 and unversioned daily categories retain their pre-upgrade rewards',()=>{
  for(const version of [undefined,1,2,3]){
    const {legacy,progress}=start();
    const kinds=['eating_habit','housework','mood_log','challenge'];
    const initial=apply(progress,legacy,kinds.map(kind=>action(kind,{evidence:kind})),kinds.join('。')).progress;
    for(const row of initial.activities){if(version===undefined)delete row.pointVersion;else row.pointVersion=version;}
    const saved=normalizeProgress(JSON.parse(JSON.stringify(initial)));
    const expected=version===3?25:5;
    assert.equal(progressTotal(saved),expected);
    assert.deepEqual(dayReport(saved,today).quests.filter(q=>kinds.includes(q.id)).map(q=>q.bonus),version===3?[5,5,5,10]:[1,1,1,2]);
    const corrected=correctActivity(saved,saved.activities[0].id,{date:'2026-10-17'},legacy,at);
    assert.equal(progressTotal(corrected),expected);
    assert.equal(dayReport(corrected,'2026-10-17').total,version===3?5:1);
  }
});

test('distinct dinner is recorded separately and clears an existing duplicate hold without another question',()=>{
  const {legacy,progress}=start();
  const lunch=apply(progress,legacy,[action('meal_log',{title:'昼ごはん',detail:'うどん',evidence:'昼ごはんはうどん'})],'昼ごはんはうどん');
  const dinner=apply(lunch.progress,legacy,[action('meal_log',{operation:'clarify',targetId:lunch.progress.activities[0].id,title:'晩ごはん',detail:'焼きそば',evidence:'晩ごはんは焼きそば'})],'晩ごはんは焼きそば');
  assert.equal(dinner.progress.activities.length,2);
  assert.equal(dinner.progress.activities[1].hold,null);
  assert.equal(dinner.delta,0);
  assert.doesNotMatch(dinner.reply,/前に聞いた/);
  const pending=apply(lunch.progress,legacy,[action('meal_log',{operation:'clarify',title:'焼きそば',detail:'焼きそば',evidence:'焼きそば'})],'焼きそば');
  assert.equal(pending.progress.activities.at(-1).hold,'duplicate');
  const id=pending.progress.activities.at(-1).id;
  const fixed=apply(pending.progress,legacy,[action('meal_log',{operation:'update',targetId:id,title:'晩御飯',evidence:'晩御飯だもん'})],'ちがうよ？晩御飯だもん');
  assert.equal(fixed.progress.activities.at(-1).hold,null);
  assert.deepEqual(fixed.progress.activities.at(-1).needs,[]);
  assert.equal(fixed.progress.activities[0].title,'昼ごはん');
  assert.doesNotMatch(fixed.reply,/前に聞いた/);
 });

test('unrelated dinner wording cannot release a meal duplicate and meal spellings remain distinct',()=>{
  const {legacy,progress}=start();
  const lunch=apply(progress,legacy,[action('meal_log',{title:'昼ごはん',detail:'うどん',evidence:'昼ごはんはうどん'})],'昼ごはんはうどん');
  const pending=apply(lunch.progress,legacy,[action('meal_log',{operation:'clarify',title:'うどん',detail:'うどん',evidence:'うどんを食べた'})],'晩ごはんはまだ。うどんを食べた');
  assert.equal(pending.progress.activities.at(-1).hold,'duplicate');
  for(const title of ['朝御飯','朝ごはん','朝食']){
    const breakfast=apply(progress,legacy,[action('meal_log',{title,detail:'パン',evidence:title+'はパン'})],title+'はパン');
    const result=apply(breakfast.progress,legacy,[action('meal_log',{title:'昼御飯',detail:'うどん',evidence:'昼御飯はうどん'})],'昼御飯はうどん');
    assert.equal(result.progress.activities.length,2);
    assert.equal(result.delta,0);
  }
});

test('meal corrections and repeat confirmations keep their original semantics',()=>{
  const {legacy,progress}=start();
  const lunch=apply(progress,legacy,[action('meal_log',{title:'昼食',detail:'うどん',evidence:'昼食はうどん'})],'昼食はうどん');
  const id=lunch.progress.activities[0].id;
  const corrected=apply(lunch.progress,legacy,[action('meal_log',{operation:'update',targetId:id,title:'夕食',detail:'うどん',evidence:'夕食だった'})],'夕食だった');
  assert.equal(corrected.progress.activities.length,1);
  assert.equal(corrected.progress.activities[0].id,id);
  assert.equal(corrected.progress.activities[0].title,'夕食');
  const repeated=apply(lunch.progress,legacy,[action('meal_log',{operation:'repeat',targetId:id,evidence:'昼食の分だよ'})],'昼食の分だよ');
  assert.equal(repeated.progress.activities.length,1);
  assert.equal(repeated.delta,0);
  const otherDay=apply(lunch.progress,legacy,[action('meal_log',{operation:'clarify',date:'2026-10-17',title:'夕食',detail:'焼きそば',evidence:'夕食は焼きそば'})],'夕食は焼きそば');
  assert.equal(otherDay.progress.activities.at(-1).hold,'duplicate');
});

test('meal shorthand and explicit saved title distinguish meals despite leftovers detail',()=>{
  const {legacy,progress}=start();
  for(const prior of [
    {title:'昼ごはん',detail:'晩ごはんの残り',evidence:'昼ごはんは晩ごはんの残り'},
    {title:'昼はうどん',detail:'うどん',evidence:'昼はうどん'},
    {title:'食事',detail:'昼ごはん：うどん',evidence:'うどん'},
    {title:'食事',detail:'昼ごはん：うどん',evidence:'晩ごはんの残りを食べた'},
  ]){
    const lunch=apply(progress,legacy,[action('meal_log',prior)],prior.evidence);
    const dinner=apply(lunch.progress,legacy,[action('meal_log',{title:'夕食',detail:'焼きそば',evidence:'夜は焼きそば'})],'夜は焼きそば');
    assert.equal(dinner.progress.activities.length,2);
    assert.equal(dinner.progress.activities.at(-1).hold,null);
    assert.equal(dinner.delta,0);
  }
});

test('explicit additional meal resolves a duplicate even without a named meal slot',()=>{
  const {legacy,progress}=start();
  const first=apply(progress,legacy,[action('meal_log',{detail:'おにぎり',evidence:'おにぎりを食べた'})],'おにぎりを食べた');
  const pending=apply(first.progress,legacy,[action('meal_log',{operation:'clarify',detail:'パン',evidence:'パンを食べた'})],'パンを食べた');
  const resolved=apply(pending.progress,legacy,[action('meal_log',{operation:'update',targetId:pending.progress.activities.at(-1).id,additional:true,evidence:'追加で食べた'})],'追加で食べた');
  assert.equal(resolved.progress.activities.length,2);
  assert.equal(resolved.progress.activities.at(-1).hold,null);
  assert.deepEqual(resolved.progress.activities.at(-1).needs,[]);
  assert.equal(resolved.delta,0);
});

test('dinner aliases and short evidence retain the explicitly reported meal',()=>{
  const {legacy,progress}=start();
  const lunch=apply(progress,legacy,[action('meal_log',{title:'昼食',detail:'うどん',evidence:'昼食はうどん'})],'昼食はうどん');
  for(const [text,evidence,title] of [['夕飯はカレーを食べた','夕飯はカレーを食べた','夕飯'],['晩ごはんは焼きそばを食べた','焼きそばを食べた','晩ごはん']]){
    const result=apply(lunch.progress,legacy,[action('meal_log',{title,detail:'食事内容',evidence})],text);
    assert.equal(result.progress.activities.length,2);
    assert.equal(result.delta,0);
  }
  const unrelated=apply(lunch.progress,legacy,[action('meal_log',{operation:'clarify',title:'晩ごはん',detail:'うどん',evidence:'うどんを食べた'})],'晩ごはんはまだ。うどんを食べた');
  assert.equal(unrelated.progress.activities.at(-1).hold,'duplicate');
});
