import {dateKey,recentDays} from './model.mjs';
import {PROGRESS_STORAGE,emptyProgress,normalizeProgress,dayReport,progressTotal,progressCompanion,measurementRecords,progressContext,applyInterpretation,recordManual,correctActivity,followupFor,calorieSummary} from './progress.mjs?v=daily-life-1';

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const amount=n=>new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(n);
const calorieValue=(s,empty='0')=>s.recorded?amount(s.kcal):s.pending?'—':empty;
const calorieNote=s=>{
  const parts=[];
  if(s.recorded-s.estimatedCount)parts.push(`記録値 ${amount(s.reported)}kcal`);
  if(s.estimatedCount)parts.push(`推定 ${amount(s.estimated)}kcal`);
  if(s.pending)parts.push(`消費カロリー未推定 ${s.pending}件`);
  return parts.join(' · ')||'運動の記録はまだありません。';
};

export function createProgressUI({getState,onChange,onContinue,onError,storage=globalThis.localStorage,account=null}) {
  const $=id=>document.getElementById(id);
  let data,unavailable=false,selectedDate=dateKey(),selectedActivity=null,chartMode='points';
  function read(){
    if(account?.user)return structuredClone(account.state?.progress??emptyProgress(getState()));
    try{
      const raw=storage.getItem(PROGRESS_STORAGE);
      if(raw!==null)return normalizeProgress(JSON.parse(raw));
      const initial=emptyProgress(getState());storage.setItem(PROGRESS_STORAGE,JSON.stringify(initial));return initial;
    }catch{unavailable=true;return data??emptyProgress(getState());}
  }
  data=read();
  const lock=run=>navigator.locks?navigator.locks.request(PROGRESS_STORAGE,run):Promise.resolve().then(run);
  function write(next){
    if(unavailable)throw Error('えらいの記録を読み込めないため、元のデータは上書きしません。ブラウザの設定をご確認ください。');
    try{storage.setItem(PROGRESS_STORAGE,JSON.stringify(next));data=next;}
    catch{throw Error('えらいの記録を保存できませんでした。入力は残してあるので、もう一度送ってね。');}
    render();onChange?.();
  }
  async function handleReport(result,text,context={}){
    if(!result.actions?.length)return {reply:result.reply,receipts:[]};
    return lock(()=>{
      data=read();if(unavailable)throw Error('えらいの記録を読み込めません。元のデータを保護しているため、加算していません。');
      if(!data.processed.includes(result.requestId))for(const a of result.actions){
        if(!a.targetId)continue;
        const expected=context.activities?.find(x=>x.id===a.targetId),current=data.activities.find(x=>x.id===a.targetId&&!x.deleted);
        if(!expected||!current||expected.date!==current.date||expected.kind!==current.kind||expected.minutes!==current.minutes||expected.kcal!==current.kcal||expected.detail!==current.detail||expected.estimatedKcal!==(current.estimate?.kcal??null))throw Error('別の操作で記録が更新されました。いったんおはなしを開き直して、もう一度送ってね。');
      }
      const applied=applyInterpretation(data,{requestId:result.requestId,actions:result.actions,text,reply:result.reply},getState());
      write(applied.progress);
      if(selectedActivity&&!data.activities.find(a=>a.id===selectedActivity)?.needs.length)selectedActivity=null;
      return applied;
    });
  }
  async function manual(kind,date,title,values={}){
    return lock(()=>{data=read();const result=recordManual(data,{id:`${date}:${kind}`,kind,date,title,...values},getState());write(result.progress);return result;}).catch(error=>onError?.(error.message));
  }
  function context(){
    data=read();
    return progressContext(getState(),data,dateKey(),selectedActivity);
  }
  function edit(activity){
    const form=$('activity-edit-form');form.dataset.id=activity.id;form.dataset.revision=account?.state?.revision??'';
    $('activity-edit-title').textContent=activity.title;
    $('activity-edit-date').value=activity.date??dateKey();$('activity-edit-date').max=dateKey();
    $('activity-edit-minutes').value=activity.minutes??'';$('activity-edit-kcal').value=activity.kcal??'';
    $('activity-edit-weight').value=activity.weightKg??'';$('activity-edit-detail').value=activity.detail??'';
    $('activity-edit-exercise').hidden=!['walk','run','strength','stretch','exercise'].includes(activity.kind);
    $('activity-edit-weight-row').hidden=!['walk','run','strength','stretch','exercise','weight'].includes(activity.kind);
    $('activity-edit-meal-row').hidden=activity.kind!=='meal_log';
    $('activity-edit-error').textContent='';$('activity-edit-dialog').showModal();
  }
  function activityNode(activity){
    const row=el('article','daily-activity'),copy=el('div','daily-activity-copy'),title=el('strong',null,activity.title);
    copy.append(title);
    const details=[];
    if(activity.minutes!==null)details.push(activity.minutes<1?Math.round(activity.minutes*60)+'秒':amount(activity.minutes)+'分');
    if(activity.kcal!==null)details.push('本人の報告 '+amount(activity.kcal)+'kcal');
    else if(activity.estimate)details.push((activity.estimate.source==='luna'?'Lunaの推定 ':'推定 ')+amount(activity.estimate.kcal)+'kcal');
    if(['walk','run','strength','stretch','exercise'].includes(activity.kind)&&activity.kcal===null&&!activity.estimate&&!activity.hold)details.push('消費カロリーは未推定');
    if(activity.kind==='weight'&&activity.weightKg!==null)details.push(amount(activity.weightKg)+'kg');
    if(activity.detail)details.push(activity.detail);
    if(activity.estimate?.basis)details.push(activity.estimate.basis);
    if(activity.corrections.some(c=>c.type!=='supplement'))details.push('訂正済み');
    if(details.length)copy.append(el('p',null,details.join(' · ')));
    if(activity.needs.length){
      copy.append(el('span','pending-label','情報待ち'));
      const more=el('button','activity-continue','続きを話す');more.type='button';more.addEventListener('click',()=>{selectedActivity=activity.id;onContinue?.(activity,followupFor(activity));});copy.append(more);
    }
    const button=el('button','activity-edit','訂正');button.type='button';button.setAttribute('aria-label',activity.title+'を訂正する');button.addEventListener('click',()=>edit(activity));
    row.append(copy,button);return row;
  }
  function render(){
    const today=dateKey(),report=dayReport(data,today);
    const calories=calorieSummary(data,today);
    $('daily-calories').textContent=calorieValue(calories);$('daily-calorie-note').textContent=calorieNote(calories);$('daily-total-calories').textContent=calorieValue(calorieSummary(data));
    $('daily-points').textContent=report.total;$('daily-total-points').textContent=progressTotal(data);
    $('dock-count').textContent=report.total;
    $('daily-exercise-breakdown').textContent=`運動 ${report.exercise} ＋ クエスト ${report.bonus}`;
    $('daily-quests').replaceChildren(...report.quests.map(q=>{
      const row=el('div','daily-quest'+(q.done?' is-done':'')),mark=el('span','quest-mark',q.done?'✓':'○'),copy=el('div');
      copy.append(el('strong',null,q.label),el('small',null,q.id==='exercise'?`${amount(Math.min(report.kcal,20))} / 20kcal`:q.detail));
      row.append(mark,copy,el('b',null,'＋'+q.bonus));row.setAttribute('aria-label',q.label+'、'+(q.done?'達成済み':'まだこれから')+'、'+q.bonus);return row;
    }));
    const pending=data.activities.filter(a=>!a.deleted&&(a.date===today||a.date===null)&&a.needs.length);
    $('today-pending').replaceChildren(...pending.map(activityNode));$('today-pending-section').hidden=!pending.length;
    $('progress-storage-warning').hidden=!unavailable;
    $('report-date').value=selectedDate;$('report-date').max=today;
    const chosen=dayReport(data,selectedDate);
    const chosenCalories=calorieSummary(data,selectedDate);
    $('report-calories').textContent=calorieValue(chosenCalories,chosen.recorded?'0':'—');$('report-calorie-note').textContent=calorieNote(chosenCalories);
    $('report-score').textContent=chosen.recorded?chosen.total:'—';
    $('report-breakdown').textContent=chosen.recorded?`運動 ${chosen.exercise} ＋ クエスト ${chosen.bonus}`:'この日の記録はまだありません。';
    $('report-praise').textContent=chosen.praise||'小さなことから、きみのペースで。';
    $('report-quests').replaceChildren(...chosen.quests.filter(q=>q.done).map(q=>el('span','report-quest',q.label+' ＋'+q.bonus)));
    $('report-activities').replaceChildren(...chosen.activities.map(activityNode));
    if(!chosen.activities.length)$('report-activities').append(el('p','subtle','こむぎに話したことが、ここに残っていきます。'));
    const dates=recentDays(14),reports=dates.map(date=>({...dayReport(data,date),calories:calorieSummary(data,date)})),isCalories=chartMode==='calories';
    const max=Math.max(10,...reports.map(r=>isCalories?r.calories.kcal:r.total));
    $('chart-points').setAttribute('aria-pressed',String(!isCalories));$('chart-calories').setAttribute('aria-pressed',String(isCalories));
    $('points-chart').setAttribute('aria-label',isCalories?'最近14日間の消費カロリー（kcal）':'最近14日間のえらいポイント');
    $('progress-chart-legend').replaceChildren(el('span',null,isCalories?'● 記録値':'● 運動'),el('span',null,isCalories?'● 推定':'● クエスト'),el('span',null,' 棒を押すと、その日へ'));
    $('points-chart').replaceChildren(...reports.map(r=>{
      const button=el('button','points-day'+(r.date===selectedDate?' is-selected':'')),bar=el('span','points-bar');button.type='button';button.dataset.date=r.date;
      button.setAttribute('aria-label',r.date+'、'+(isCalories?calorieNote(r.calories)+(r.calories.recorded?'、合計'+amount(r.calories.kcal)+'kcal':''):r.recorded?r.total+'ポイント':'記録なし'));
      const exercise=el('span','points-exercise'),bonus=el('span','points-bonus');
      exercise.style.height=((isCalories?r.calories.reported:r.exercise)/max*94)+'px';bonus.style.height=((isCalories?r.calories.estimated:r.bonus)/max*94)+'px';bar.append(bonus,exercise);
      const value=isCalories?calorieValue(r.calories,'—'):r.recorded?String(r.total):'—';
      button.append(el('small','points-value',value),bar,el('span','points-date',r.date.slice(5).replace('-','/')));
      button.addEventListener('click',()=>{selectedDate=r.date;render();});return button;
    }));
    $('points-chart').scrollLeft=Math.max(0,reports.findIndex(r=>r.date===selectedDate)*23-$('points-chart').clientWidth/2);
  }
  for(const [id,mode] of [['chart-points','points'],['chart-calories','calories']])$(id).addEventListener('click',()=>{chartMode=mode;render();});
  $('report-date').addEventListener('change',event=>{if(event.target.value&&event.target.value<=dateKey()){selectedDate=event.target.value;render();}});
  $('activity-edit-form').addEventListener('submit',async event=>{
    event.preventDefault();const id=event.currentTarget.dataset.id;
    const number=id=>$(id).value.trim()?Number($(id).value):null;
    try{if(account?.user){await account.command({type:'correct_activity',id,changes:{date:$('activity-edit-date').value,minutes:number('activity-edit-minutes'),kcal:number('activity-edit-kcal'),weightKg:number('activity-edit-weight'),detail:$('activity-edit-detail').value||null}},{revision:Number($('activity-edit-form').dataset.revision)});data=read();render();}else await lock(()=>{
      data=read();const a=data.activities.find(a=>a.id===id&&!a.deleted);if(!a)throw Error('記録が見つかりません。開き直してください。');
      write(correctActivity(data,id,{date:$('activity-edit-date').value,minutes:number('activity-edit-minutes'),kcal:number('activity-edit-kcal'),weightKg:number('activity-edit-weight'),detail:$('activity-edit-detail').value||null},getState()));
    });$('activity-edit-dialog').close();}
    catch(error){$('activity-edit-error').textContent=error.message==='Invalid candidate'?'日付や数値を確認してください。':error.message;}
  });
  window.addEventListener('storage',event=>{if(event.key===PROGRESS_STORAGE){unavailable=false;data=read();render();onChange?.();}});
  render();
  return {reload(){data=read();render();},get data(){return data;},context,handleReport,manual,render,get companion(){return progressCompanion(data,getState());},
    exportData:()=>structuredClone(data),clearTarget:()=>{selectedActivity=null;},
    weights(legacy){const days=structuredClone(legacy.days);for(const record of measurementRecords(legacy,data)){days[record.date]??={habits:[]};days[record.date].weight=record.value;}return days;},
    removeWeights(date){return lock(()=>{data=read();const next=structuredClone(data);for(const a of next.activities)if(a.kind==='weight'&&a.date===date)a.deleted=true;next.revision++;write(next);}).catch(error=>onError?.(error.message));},
  };
}
