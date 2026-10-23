import {dateKey, affectionFor, totals} from './model.mjs';

export const PROGRESS_STORAGE = 'kotokoto-progress-v1';
export const QUESTS = Object.freeze([
  {id:'exercise',label:'運動する',detail:'合計20kcalから',bonus:10},
  {id:'stretch',label:'ストレッチする',detail:'少しほぐせたら',bonus:10},
  {id:'snack',label:'間食を控える',detail:'自分で決めた工夫',bonus:10},
  {id:'meal_care',label:'食事を工夫する',detail:'自炊や野菜を一品',bonus:10},
  {id:'eating_habit',label:'食べ方を工夫する',detail:'小皿に分ける・ゆっくり食べる',bonus:5},
  {id:'weight',label:'体重を記録する',detail:'測った数字を残す',bonus:5},
  {id:'meal_log',label:'食事を記録する',detail:'食べた内容を残す',bonus:5},
  {id:'rest',label:'休む時間をつくる',detail:'ひと休みや寝る準備',bonus:10},
  {id:'housework',label:'暮らしを整える',detail:'掃除・洗濯・片づけ',bonus:5},
  {id:'mood_log',label:'気持ちを大切にする',detail:'気分を残す・誰かに相談する',bonus:5},
  {id:'challenge',label:'小さな一歩を踏み出す',detail:'後回しにしていたことに着手',bonus:10},
  {id:'care',label:'自分なりのひと工夫',detail:'ほかにも、できたこと',bonus:5},
]);
export const ACTIVITY_KINDS = ['walk','run','strength','stretch','exercise','snack','meal_care','eating_habit','weight','meal_log','rest','housework','mood_log','challenge','care'];
export const EXERCISE_KINDS = ['walk','run','strength','stretch','exercise'];
const DAILY_LIFE_KINDS=['snack','meal_care','eating_habit','rest','housework','mood_log','challenge','care'];
const HISTORICAL_BONUSES={
  1:{snack:10,meal_care:10,weight:5,meal_log:5,rest:10,care:5,eating_habit:1,housework:1,mood_log:1,challenge:2},
  2:{snack:2,meal_care:2,eating_habit:1,weight:1,meal_log:1,rest:2,housework:1,mood_log:1,challenge:2,care:1},
};
const ID = /^[a-zA-Z0-9:_-]{1,100}$/;
const finite = (value,min,max) => typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export const validDate = value => {try{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}};
const round1 = n => Math.round(n*10)/10;
export const exercisePoints = kcal => kcal>0?Math.round(10*(kcal/100)**1.1):0;

export function normalizeCandidate(a) {
  if(!a||!ACTIVITY_KINDS.includes(a.kind)||!['create','update','repeat','clarify'].includes(a.operation))return null;
  if(a.date!==null&&!validDate(a.date))return null;
  if(a.targetId!==null&&(typeof a.targetId!=='string'||!ID.test(a.targetId)))return null;
  if(typeof a.title!=='string'||!a.title.trim()||a.title.length>100||typeof a.evidence!=='string'||!a.evidence.trim()||a.evidence.length>600)return null;
  for(const [field,min,max]of[['minutes',0.001,1440],['kcal',0,20000],['weightKg',1,500]])if(a[field]!==null&&!finite(a[field],min,max))return null;
  if(a.detail!==null&&(typeof a.detail!=='string'||a.detail.length>300))return null;
  if(typeof a.additional!=='boolean')return null;
  const estimatedKcal=a.estimatedKcal??null,estimateBasis=a.estimateBasis??null;
  if(estimatedKcal!==null&&(!EXERCISE_KINDS.includes(a.kind)||!finite(estimatedKcal,0,20000)||typeof estimateBasis!=='string'||!estimateBasis.trim()||estimateBasis.length>300))return null;
  return {operation:a.operation,targetId:a.targetId,kind:a.kind,date:a.date,title:a.title.trim(),evidence:a.evidence.trim(),minutes:a.minutes,kcal:a.kcal,weightKg:a.weightKg,detail:a.detail?.trim()||null,additional:a.additional,estimatedKcal,estimateBasis:estimatedKcal===null?null:estimateBasis.trim()};
}

export function emptyProgress(legacy,now=new Date()) {
  return {version:1,revision:0,createdAt:now.toISOString(),baselineAffection:affectionFor(legacy).score,baselineXP:totals(legacy).xp,peakPoints:0,activities:[],processed:[]};
}

export function normalizeProgress(raw) {
  if(raw?.version!==1||!Number.isSafeInteger(raw.revision)||raw.revision<0||!finite(raw.baselineAffection,0,100)||!finite(raw.peakPoints,0,1e12)
      ||typeof raw.createdAt!=='string'||Number.isNaN(Date.parse(raw.createdAt))||!Array.isArray(raw.activities)||!Array.isArray(raw.processed))throw Error('Invalid progress');
  const ids=new Set();
  const activities=raw.activities.map(a=>{
    const candidate=normalizeCandidate({...a,operation:'create',targetId:null,additional:false});
    if(a.pointVersion!==undefined&&![1,2,3].includes(a.pointVersion))throw Error('Invalid point version');
    if(!candidate||!ID.test(a.id)||ids.has(a.id)||typeof a.at!=='string'||Number.isNaN(Date.parse(a.at))
        ||!['duplicate',null].includes(a.hold)||typeof a.deleted!=='boolean'||!Array.isArray(a.corrections))throw Error('Invalid activity');
    if(a.estimate!==null&&(!finite(a.estimate?.kcal,0,20000)||(a.estimate.source==='luna'?typeof a.estimate.basis!=='string'||!a.estimate.basis.trim()||a.estimate.basis.length>300:!finite(a.estimate?.weightKg,1,500)||!finite(a.estimate?.mets,1,20))))throw Error('Invalid estimate');
    if(!Array.isArray(a.needs)||a.needs.some(n=>!['date','duplicate','minutes','weight','kcal','meal'].includes(n)))throw Error('Invalid pending activity');
    ids.add(a.id);
    return {...candidate,pointVersion:a.pointVersion??1,id:a.id,at:a.at,updatedAt:a.updatedAt??a.at,hold:a.hold,deleted:a.deleted,estimate:a.estimate,needs:[...a.needs],praise:typeof a.praise==='string'?a.praise.slice(0,600):'',corrections:a.corrections.slice(-50)};
  });
  if(raw.processed.some(id=>typeof id!=='string'||!ID.test(id)))throw Error('Invalid transaction');
  if(raw.baselineXP!==undefined&&!finite(raw.baselineXP,0,1e12))throw Error('Invalid growth baseline');
  return {version:1,revision:raw.revision,createdAt:raw.createdAt,baselineAffection:raw.baselineAffection,baselineXP:raw.baselineXP??0,peakPoints:raw.peakPoints,activities,processed:[...new Set(raw.processed)]};
}

export function measurementRecords(legacy,progress){
  const byDate=new Map(Object.entries(legacy.days).filter(([d,day])=>validDate(d)&&finite(day.weight,1,500)).map(([date,day])=>[date,{date,value:day.weight}]));
  for(const a of progress.activities.filter(a=>!a.deleted&&!a.hold&&a.kind==='weight'&&a.date&&finite(a.weightKg,1,500)).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)))byDate.set(a.date,{date:a.date,value:a.weightKg});
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export function weightReference(legacy,progress,date){
  const record=measurementRecords(legacy,progress).filter(r=>r.date<=date).at(-1);
  if(record)return {...record,source:'record'};
  const reported=progress.activities.filter(a=>!a.deleted&&!a.hold&&EXERCISE_KINDS.includes(a.kind)&&a.date&&a.date<=date&&finite(a.weightKg,1,500)).sort((a,b)=>a.date.localeCompare(b.date)||a.updatedAt.localeCompare(b.updatedAt)).at(-1);
  return reported?{value:reported.weightKg,date:reported.date,source:'conversation'}:null;
}

export const latestWeight=(legacy,progress,date)=>weightReference(legacy,progress,date)?.value??null;

function resolveActivity(a,legacy,progress) {
  const needs=[];
  if(a.kind==='weight'&&a.weightKg===null&&a.date&&finite(legacy.days[a.date]?.weight,1,500))a.weightKg=legacy.days[a.date].weight;
  if(!a.date)needs.push('date');
  if(a.hold)needs.push('duplicate');
  if(a.kind==='weight'&&!finite(a.weightKg,1,500))needs.push('weight');
  if(a.kind==='meal_log'&&!a.detail)needs.push('meal');
  if(EXERCISE_KINDS.includes(a.kind)&&a.kcal===null&&!a.estimate&&a.date&&!a.hold){
    const weight=a.weightKg??latestWeight(legacy,progress,a.date);
    if(a.kind!=='stretch'){
      if(a.minutes===null&&!a.detail)needs.push('minutes');
      else if(weight===null)needs.push('weight');
      else needs.push('kcal');
    }
  }
  a.needs=needs;return a;
}

export function dayReport(progress,date) {
  const activities=progress.activities.filter(a=>!a.deleted&&a.date===date);
  const eligible=activities.filter(a=>!a.hold);
  let kcal=0;
  const done=new Set(),pointVersions=new Map();
  for(const a of eligible){
    if(EXERCISE_KINDS.includes(a.kind))kcal+=a.kcal??a.estimate?.kcal??0;
    if(a.kind==='stretch')done.add('stretch');
    if(DAILY_LIFE_KINDS.includes(a.kind)||a.kind==='weight'&&a.weightKg!==null||a.kind==='meal_log'&&a.detail){
      done.add(a.kind);
      const version=a.pointVersion??1;
      pointVersions.set(a.kind,Math.min(pointVersions.get(a.kind)??version,version));
    }
  }
  kcal=round1(kcal);if(kcal>=20)done.add('exercise');
  // Old records retain their awarded rate, including after reloads and corrections.
  const quests=QUESTS.map(q=>({...q,bonus:HISTORICAL_BONUSES[pointVersions.get(q.id)]?.[q.id]??q.bonus,done:done.has(q.id)}));
  const exercise=exercisePoints(kcal),bonus=quests.reduce((s,q)=>s+(q.done?q.bonus:0),0);
  return {date,activities,kcal,exercise,bonus,total:exercise+bonus,quests,pending:activities.filter(a=>a.needs.length),recorded:activities.length>0,praise:eligible.at(-1)?.praise??''};
}

export const reportDates = progress => [...new Set(progress.activities.filter(a=>!a.deleted&&a.date).map(a=>a.date))].sort();
export const progressTotal = progress => reportDates(progress).reduce((sum,date)=>sum+dayReport(progress,date).total,0);
// Read the saved exercise values; never estimate missing calories or write another total.
export function calorieSummary(progress,date){
  const rows=progress.activities.filter(a=>!a.deleted&&!a.hold&&validDate(a.date)&&(date===undefined||a.date===date)&&EXERCISE_KINDS.includes(a.kind));
  let reported=0,estimated=0,recorded=0,pending=0,estimatedCount=0;
  for(const a of rows){
    if(a.kcal!==null&&a.kcal!==undefined){reported+=a.kcal;recorded++;}
    else if(a.estimate){estimated+=a.estimate.kcal;estimatedCount++;recorded++;}
    else pending++;
  }
  return {kcal:round1(reported+estimated),reported:round1(reported),estimated:round1(estimated),recorded,pending,estimatedCount,exerciseCount:rows.length};
}
export function progressCompanion(progress,legacy,now=new Date()) {
  const today=dateKey(now),records=progress.activities.filter(a=>!a.deleted&&!a.hold&&a.date&&a.date<=today);
  return {score:Math.min(100,progress.baselineAffection+Math.floor(progress.peakPoints/5)),xp:Math.max(totals(legacy).xp,progress.baselineXP+progress.peakPoints),todayCount:records.filter(a=>a.date===today).length,recordDates:records.map(a=>a.date)};
}

export function followupFor(a) {
  if(!a)return null;
  const need=a.needs[0];
  if(need==='date')return 'それは、いつやったことかな？';
  if(need==='duplicate')return '前に聞いた分と同じかな？ それとも、追加でやった分？';
  if(need==='minutes')return 'どのくらいの時間、やったの？';
  if(need==='weight')return a.kind==='weight'?'測った体重は、何kgだった？':'体重は、何kgくらいかな？';
  if(need==='kcal')return 'どんな運動を、どのくらいの強さでやったの？';
  if(need==='meal')return '食べたものを、もう少し聞かせてもらえる？';
  return null;
}

export function withFollowup(reply,question) {
  if(!question)return reply;
  const statement=reply.replace(/[^。！？!?]*[？?]/g,'').trim();
  return (statement||'聞かせてくれて、ありがとう。').slice(0,Math.max(0,599-question.length))+' '+question;
}

function mealSlot(value) {
  const slots=[['breakfast',/朝(?:ごはん|ご飯|御飯|飯|食|は)/],['lunch',/昼(?:ごはん|ご飯|御飯|飯|食|は)/],['dinner',/(?:晩|夜|夕)(?:ごはん|ご飯|御飯|飯|食|は)/]]
    .filter(([,pattern])=>pattern.test(value));
  return slots.length===1?slots[0][0]:null;
}

function reportedMealSlot(a,text) {
  const explicit=mealSlot(a.evidence);
  if(explicit)return explicit;
  // Only use the sentence containing this action's quote, not unrelated topics.
  const sentences=text.split(/[。！？!?、,;；\n]/).filter(part=>part.includes(a.evidence));
  const label=mealSlot(a.title)??mealSlot(a.detail??'');
  if(sentences.length!==1||/まだ|ない|なく|なかった|ません|じゃない/.test(sentences[0]))return null;
  return label&&mealSlot(sentences[0])===label?label:null;
}

function distinctMeal(progress,a,existing,text) {
  if(a.kind!=='meal_log'||a.operation==='update'&&existing?.hold!=='duplicate')return false;
  const slot=reportedMealSlot(a,text);
  if(!slot)return false;
  const others=progress.activities.filter(x=>!x.deleted&&(x.id!==existing?.id||a.operation==='clarify'&&!existing?.hold)&&x.kind==='meal_log'&&x.date===(a.date??existing?.date));
  return others.length>0&&others.every(x=>{
    // Prefer the meal label over descriptions such as yesterday's dinner leftovers.
    const previous=mealSlot(x.title)??mealSlot(x.detail??'')??mealSlot(x.evidence);
    return previous&&previous!==slot;
  });
}

export function applyInterpretation(original,{requestId,actions,text,reply='',today=dateKey(),at=new Date().toISOString()},legacy) {
  if(!ID.test(requestId)||!Array.isArray(actions)||actions.length>8)throw Error('Invalid result');
  if(original.processed.includes(requestId))return {progress:original,receipts:[],delta:0,reply,replayed:true};
  const progress=normalizeProgress(structuredClone(original)),before=new Map(reportDates(progress).map(d=>[d,dayReport(progress,d)]));
  const receipts=[],touched=[];
  for(const [i,raw]of actions.entries()){
    const a=normalizeCandidate(raw);
    if(!a||!text.includes(a.evidence)||a.date&&a.date>today)throw Error('Invalid candidate');
    let existing=a.targetId?progress.activities.find(x=>x.id===a.targetId&&!x.deleted):null;
    if(a.targetId&&!existing)throw Error('Unknown activity');
    const separateMeal=distinctMeal(progress,a,existing,text);
    if(separateMeal&&['create','clarify','update'].includes(a.operation)){
      if(existing?.hold!=='duplicate'&&a.operation==='clarify')existing=null;
      a.operation=existing?'update':'create';
      a.additional=true;
    }
    if(a.operation==='repeat'){
      if(existing?.hold==='duplicate'){existing.deleted=true;touched.push(existing);}
      receipts.push({label:'前に聞いた分として確認',delta:0,status:'duplicate'});continue;
    }
    if(a.operation==='clarify'&&existing&&!existing.hold)existing=null;
    if(!existing&&a.operation==='update')throw Error('Missing correction target');
    if(!existing&&a.operation==='create'){
      const same=progress.activities.filter(x=>!x.deleted&&x.kind===a.kind&&x.date===a.date&&!x.hold);
      if(DAILY_LIFE_KINDS.includes(a.kind)&&progress.activities.some(x=>!x.deleted&&!x.hold&&x.date===a.date&&DAILY_LIFE_KINDS.includes(x.kind)&&x.evidence===a.evidence)){
        receipts.push({label:'同じ行動として確認',delta:0,status:'duplicate'});continue;
      }
      // Legacy meal_care also covered eating habits. Different wording cannot establish a separate action.
      if(a.kind==='eating_habit'&&!a.additional&&progress.activities.some(x=>!x.deleted&&!x.hold&&x.date===a.date&&x.kind==='meal_care'&&x.pointVersion===1))a.operation='clarify';
      const exact=same.find(x=>x.evidence===a.evidence||(a.minutes!==null&&a.minutes===x.minutes&&a.kcal===x.kcal&&a.weightKg===x.weightKg));
      if(exact&&!a.additional){receipts.push({label:'同じ行動を確認',delta:0,status:'duplicate'});continue;}
      if(!EXERCISE_KINDS.includes(a.kind)&&same.length&&!a.additional){receipts.push({label:'今日の分は記録済み',delta:0,status:'duplicate'});continue;}
      if(same.length&&EXERCISE_KINDS.includes(a.kind)&&!(a.additional&&/追加|もう|また|別|回目|朝|昼|夕|夜|午前|午後/.test(a.evidence)))a.operation='clarify';
    }
    let hold=a.operation==='clarify'?'duplicate':null;
    if(existing?.hold==='duplicate'&&a.operation==='update'&&!separateMeal&&!(a.additional&&/追加|もう|また|別|回目/.test(a.evidence)))hold='duplicate';
    if(existing){
      existing.corrections.push({at,type:existing.needs.length?'supplement':'correction',previous:{date:existing.date,minutes:existing.minutes,kcal:existing.kcal,weightKg:existing.weightKg,title:existing.title,deleted:existing.deleted}});
      const changes=Object.fromEntries(Object.entries(a).filter(([,value])=>value!==null));
      const changed=['kind','minutes','weightKg','detail'].some(key=>a[key]!==null&&a[key]!==existing[key]);
      const estimate=a.estimatedKcal!==null?{source:'luna',kcal:round1(a.estimatedKcal),basis:a.estimateBasis}:changed?null:existing.estimate;
      Object.assign(existing,changes,{operation:'create',targetId:null,additional:false,hold,estimate,estimatedKcal:null,estimateBasis:null,updatedAt:at,praise:reply});
    }else{
      existing={...a,pointVersion:3,operation:'create',targetId:null,additional:false,id:`${requestId}:${i}`,at,updatedAt:at,hold,estimate:a.estimatedKcal===null?null:{source:'luna',kcal:round1(a.estimatedKcal),basis:a.estimateBasis},estimatedKcal:null,estimateBasis:null,deleted:false,needs:[],praise:reply,corrections:[]};
      progress.activities.push(existing);
    }
    touched.push(existing);
  }
  for(const a of progress.activities)if(!a.deleted)resolveActivity(a,legacy,progress);
  for(const date of reportDates(progress)){
    const after=dayReport(progress,date),prior=before.get(date);
    for(const q of after.quests)if(q.done&&!prior?.quests.find(old=>old.id===q.id)?.done)receipts.push({label:q.label+' 達成',delta:q.bonus,status:'achieved'});
    const exerciseDelta=after.exercise-(prior?.exercise??0);
    if(exerciseDelta>0)receipts.push({label:'運動のできた',delta:exerciseDelta,status:'earned'});
  }
  for(const a of touched)if(!a.deleted&&a.needs.length)receipts.push({label:a.title+' · '+({date:'日付',duplicate:'重複',minutes:'時間',weight:'体重',kcal:'推定の情報',meal:'食事内容'}[a.needs[0]])+'を確認中',delta:0,status:'pending'});
  if(actions.length&&!receipts.length)receipts.push({label:'行動を記録しました',delta:0,status:'recorded'});
  const afterTotal=progressTotal(progress),beforeTotal=[...before.values()].reduce((s,r)=>s+r.total,0);
  const delta=afterTotal-beforeTotal;
  if(actions.some(a=>a.operation==='update')&&(delta<=0||receipts.reduce((s,r)=>s+r.delta,0)!==delta)){
    const waiting=receipts.filter(r=>r.status==='pending');
    receipts.splice(0,receipts.length,{label:delta>0?'元の記録を更新':'元の記録に反映しました',delta:Math.max(0,delta),status:'corrected'},...waiting);
  }
  progress.peakPoints=Math.max(progress.peakPoints,afterTotal);
  progress.processed.push(requestId);progress.revision++;
  const pending=touched.find(a=>!a.deleted&&a.needs.length);
  return {progress,receipts,delta,reply:withFollowup(reply,/わから|わかん|覚えて|あとで|不明/.test(text)?null:followupFor(pending)),replayed:false};
}

export function recordManual(original,{id,kind,date,title,weightKg=null,detail=null,today=dateKey()},legacy,at=new Date().toISOString()) {
  const old=original.activities.find(a=>a.kind===kind&&a.date===date&&!a.deleted&&!a.hold);
  return applyInterpretation(original,{requestId:`manual:${original.revision+1}:${id}`,today,at,text:title,reply:'自分のためのひと手間、ちゃんとできたね。',actions:[{operation:old?'update':'create',targetId:old?.id??null,kind,date,title,evidence:title,minutes:null,kcal:null,weightKg,detail,additional:false}]},legacy);
}

export function correctActivity(original,id,changes,legacy,at=new Date().toISOString(),today=dateKey()) {
  const progress=normalizeProgress(structuredClone(original)),a=progress.activities.find(a=>a.id===id&&!a.deleted);
  if(!a)throw Error('記録が見つかりません。');
  const candidate=normalizeCandidate({...a,...changes,operation:'update',targetId:id});
  if(!candidate||candidate.date&&candidate.date>today)throw Error('日付や数値を確認してください。');
  a.corrections.push({at,previous:{date:a.date,minutes:a.minutes,kcal:a.kcal,weightKg:a.weightKg,detail:a.detail}});
  const changed=['minutes','weightKg','detail','kcal'].some(key=>candidate[key]!==a[key]);
  Object.assign(a,candidate,{operation:'create',targetId:null,additional:false,updatedAt:at,estimate:changed?null:a.estimate});
  resolveActivity(a,legacy,progress);
  progress.peakPoints=Math.max(progress.peakPoints,progressTotal(progress));progress.revision++;
  return progress;
}

export function activityContext(progress,today,selectedId=null) {
  return progress.activities.filter(a=>!a.deleted).sort((a,b)=>(b.id===selectedId)-(a.id===selectedId)||Number(b.needs.length>0)-Number(a.needs.length>0)||b.updatedAt.localeCompare(a.updatedAt)).slice(0,18)
    .map(a=>({id:a.id,kind:a.kind,date:a.date,reportedAt:a.at,updatedAt:a.updatedAt,title:a.title,minutes:a.minutes,kcal:a.kcal,weightKg:a.weightKg,estimatedKcal:a.estimate?.kcal??null,estimateBasis:a.estimate?.basis??null,detail:a.detail,needs:a.needs,selected:a.id===selectedId}));
}

export function progressContext(legacy,progress,today=dateKey(),selectedId=null){
  const reference=weightReference(legacy,progress,today);
  return {hasWeight:Boolean(reference),weightKg:reference?.value??null,weightDate:reference?.date??null,weightSource:reference?.source??null,
    activities:activityContext(progress,today,selectedId).map(a=>{
      const record=a.date?weightReference(legacy,progress,a.date):reference;
      const weight=EXERCISE_KINDS.includes(a.kind)&&record?.source==='record'?record.value:a.weightKg??record?.value??null;
      return {...a,title:a.kind==='weight'?'体重の記録':a.title,weightKg:weight,weightDate:record?.date??null,weightSource:record?.source??null};
    })};
}
