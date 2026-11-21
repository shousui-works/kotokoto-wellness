import {calorieSummary,dayReport,measurementRecords,normalizeProgress} from '../dist/progress.mjs';
import {mealIntakeSummary} from '../dist/meal-intake.mjs';
import {CONVERSATION_TIME_ZONE} from './conversation-time.mjs';

export const STATUS_METRICS=Object.freeze(['burned_calories','erai_points','weight','intake_calories']);
export const DAILY_STATUS_TOOL=Object.freeze({
  type:'function',
  name:'get_daily_status',
  description:'ログイン中の本人の、今日（日本時間）の保存済み記録を取得する読み取り専用ツール。今日の消費カロリー・えらいポイント・体重・摂取カロリーを尋ねられたら必ず使う。必要な項目をまとめて指定する。burned_calories=記録した運動の消費、erai_points=今日の獲得合計、weight=今日の日付の体重記録、intake_calories=食事の摂取。未記録や未推定も返す。ユーザー・日付・値の指定や書き込みはできない。',
  strict:true,
  parameters:{type:'object',properties:{metrics:{type:'array',items:{type:'string',enum:STATUS_METRICS},minItems:1,maxItems:4}},required:['metrics'],additionalProperties:false},
});

export function statusMetrics(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||!Object.hasOwn(args,'metrics')
      ||!Array.isArray(args.metrics)||!args.metrics.length||args.metrics.length>STATUS_METRICS.length
      ||args.metrics.some(metric=>!STATUS_METRICS.includes(metric))||new Set(args.metrics).size!==args.metrics.length)throw Error('Invalid status metrics');
  return [...args.metrics];
}

/** Use the same saved values and aggregates as the record UI; never estimate. */
export function dailyStatus(state,args,at=Date.now()){
  const requested=statusMetrics(args);
  if(!state?.initialized||!Number.isSafeInteger(state.revision)||state.revision<0||state.legacy?.version!==1
      ||!state.legacy.days||typeof state.legacy.days!=='object'||Array.isArray(state.legacy.days))throw Error('Status unavailable');
  const progress=normalizeProgress(state.progress);
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:CONVERSATION_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
  const metrics={};
  for(const metric of requested){
    if(metric==='burned_calories'){
      const summary=calorieSummary(progress,date);
      metrics[metric]={...summary,kcal:summary.recorded?summary.kcal:null,scope:'recorded_exercise_only'};
    }else if(metric==='erai_points'){
      const report=dayReport(progress,date);
      metrics[metric]={total:report.total,exercise:report.exercise,bonus:report.bonus,recordedActivities:report.activities.length,pendingActivities:report.pending.length,scope:'earned_on_this_date_not_gacha_balance'};
    }else if(metric==='weight'){
      const record=measurementRecords(state.legacy,progress).find(record=>record.date===date);
      metrics[metric]={kg:record?.value??null,recordedDate:record?.date??null};
    }else if(metric==='intake_calories'){
      const summary=mealIntakeSummary(progress,date);
      metrics[metric]={...summary,kcal:summary.recorded?summary.kcal:null};
    }
  }
  const result={date,timeZone:CONVERSATION_TIME_ZONE,asOf:new Date(at).toISOString(),revision:state.revision,metrics};
  return {...result,answer:formatDailyStatus(result)};
}

/** Render numeric readouts on the server so a model cannot alter saved values. */
export function formatDailyStatus(status){
  const number=value=>new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(value);
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:CONVERSATION_TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(status.asOf));
  const lines=[`${status.date} ${clock}時点の記録だよ。`];
  for(const [metric,value] of Object.entries(status.metrics)){
    if(metric==='burned_calories'){
      if(value.kcal===null)lines.push(value.pending?`消費カロリーは未推定が${number(value.pending)}件で、まだ合計が分からないよ。`:'今日の消費カロリーは、まだ記録がないよ。');
      else lines.push(`記録済みの消費カロリーは${number(value.kcal)}kcalだよ。`+(value.estimatedCount?`うち${number(value.estimated)}kcalは推定の目安だよ。`:'')+(value.pending?`ほかに未推定が${number(value.pending)}件あるよ。`:''));
      lines.push('記録した運動の分で、基礎代謝は含まないよ。');
    }else if(metric==='erai_points'){
      lines.push(`今日のえらいポイントの獲得合計は${number(value.total)}ポイントだよ。`+(value.pendingActivities?`情報待ちが${number(value.pendingActivities)}件あるよ。`:''));
    }else if(metric==='weight'){
      lines.push(value.kg===null?'今日の体重は、まだ記録がないよ。':`今日の体重は${value.kg.toFixed(1)}kgで記録されているよ。`);
    }else if(metric==='intake_calories'){
      lines.push(value.kcal===null?'今日の摂取カロリーは、まだ記録がないよ。':`記録済みの摂取カロリーは${number(value.kcal)}kcalだよ。`+(value.estimated?'写真からの推定を含む目安だよ。':''));
      if(value.withoutCalories)lines.push(`カロリー未入力の食事が${number(value.withoutCalories)}件あるよ。`);
    }
  }
  return lines.join('\n');
}

/** The caller supplies the verified UID; model arguments can only select metrics. */
export function createDailyStatusReader({store,now=Date.now}){
  return async(uid,args)=>{
    statusMetrics(args);
    if(typeof uid!=='string'||!uid||uid.length>128)throw Error('Status unavailable');
    const state=await store.read(uid);
    return dailyStatus(state,args,now());
  };
}

export const DAILY_STATUS_INSTRUCTIONS=`
本人が今日の消費カロリー・えらいポイント・体重・摂取カロリーなど、現在の数値を尋ねたときはget_daily_statusで必要な項目をまとめて取得する。現在値を記憶・古い会話・最新記録の一部から推測せず、ツールが返した日付と時点を基準にする。消費カロリーは記録された運動だけで、基礎代謝や1日の総消費を推定しない。推定値・未推定・未記録・明示的な0を区別し、今日の体重が未記録なら過去の体重で埋めない。
数値の確認だけなら実施の報告ではないのでactionsは空配列、interactionUpdateのstyleはnullにする。新しい実施報告と数値確認が混ざるときは、このツールを呼ばずにまず従来どおり実施報告の候補をactionsへ返し、replyで「今日の合計は、このあともう一度聞いてね」のように別送信での確認を案内する。まだ保存されていない行動を合計へ足さず、保存完了の約束や数字の推測をしない。読み取りを使った返答で新しい記録も作ることはできない。通常の報告や起動の挨拶ではこのツールを呼ばない。
取得できたらanswerを変更せずstatusReplyへ入れ、通常のreplyは空文字にする。statusReplyはサーバーが保存値から組み立てる確認専用の欄で、本人が尋ねたえらいポイントの数値もここなら答えられる。これは頑張りの採点や獲得通知ではない。manualReplyへ現在値を作って入れない。説明書の案内も必要ならそちらも取得してmanualReplyへ入れ、合計600文字以内にする。現在値を取得しなかった場合はstatusReplyを空文字にする。ツールが提供されていない場合は記録を取得できないと伝え、参考データの古い体重などで代用しない。`;
