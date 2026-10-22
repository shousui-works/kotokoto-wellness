import {emptyCollection} from '../dist/collection-model.mjs';
import {applyPlush} from './plush-gacha.mjs';
import {emptyMemory} from './owner-memory.mjs';
import {createHash} from 'node:crypto';
import {emptyState,normalizeState,recordHabit,buyItem,petCompanion,MOODS,HABITS} from '../dist/model.mjs';
import {emptyProgress,normalizeProgress,recordManual,correctActivity,progressTotal,validDate} from '../dist/progress.mjs';
import {normalizeNickname,normalizeNames} from '../dist/profile.mjs';
import {normalizeConversation} from '../dist/komugi-conversation.mjs';
export const problem=(status,code,message)=>Object.assign(new Error(message),{status,code});
export const uuid=id=>typeof id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function emptyAccount(){const legacy=emptyState();return {revision:0,initialized:false,datasetId:null,legacy,progress:emptyProgress(legacy),profile:{version:1,nickname:''},conversation:{version:1,messages:[]},chatEnabled:true,chatLease:null,historyEpoch:"0",messageCounter:0,memory:emptyMemory(),collection:emptyCollection()};}
export function publicAccount(state){const {chatLease,...copy}=state;return structuredClone(copy);}
export const dayKey=(now=Date.now())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export function requireRevision(state,revision){if(revision!==state.revision)throw problem(409,'revision_conflict','別の端末で更新されました。最新の内容を確認して、もう一度保存してね。');}
export function requireSetup(state){if(!state.initialized)throw problem(409,'setup_required','先にアカウントで使う記録を選んでね。');}
export function importAccount(payload){
  if(!payload||payload.legacy?.version!==1)throw problem(400,'invalid_import','バックアップの形式を確認してね。');
  const source=payload.legacy;
  if(!source.days||typeof source.days!=='object'||Array.isArray(source.days)||Object.entries(source.days).some(([date,d])=>!validDate(date)||!d||!Array.isArray(d.habits)||d.habits.some(id=>!HABITS.some(h=>h.id===id))||(d.weight!==undefined&&!(Number.isFinite(d.weight)&&d.weight>=1&&d.weight<=500))||(d.mood!==undefined&&!Object.hasOwn(MOODS,d.mood))))throw problem(400,'invalid_import','読み込めない日付や記録があるため、取り込んでいません。');
  try{
    const legacy=normalizeState(source),progress=payload.progress?normalizeProgress(payload.progress):emptyProgress(legacy,new Date(0));
    if(Object.keys(legacy.days).length+progress.activities.length>5000)throw Error('large');
    const conversation=payload.conversation?normalizeConversation(payload.conversation):{version:1,messages:[]};
    return {...emptyAccount(),initialized:true,messageCounter:conversation.messages.length/2,legacy,progress,profile:{version:1,nickname:normalizeNickname(payload.profile?.nickname??''),petName:normalizeNickname(payload.profile?.petName??'こむぎ')||'こむぎ',namesConfigured:payload.profile?.namesConfigured===true},conversation,chatEnabled:payload.chatEnabled!==false};
  }catch{throw problem(400,'invalid_import','記録の形式・件数を確認してね。元の記録は残しています。');}
}
export function applyCommand(original,command,now=Date.now()){
  requireSetup(original);if(command&&['plush_display','plush_seen'].includes(command.type))return applyPlush(original,command,{now}).state;if(!command||typeof command.type!=='string')throw problem(400,'invalid_command','操作を確認してね。');
  const state=structuredClone(original),today=dayKey(now),at=new Date(now).toISOString();
  const date=command.date??today;if(!validDate(date)||date>today)throw problem(400,'invalid_date','日付を確認してね。');
  const day=()=>state.legacy.days[date]??={habits:[]};
  const manual=(kind,title,values={})=>{state.progress=recordManual(state.progress,{id:`${date}:${kind}`,kind,date,title,today,...values},state.legacy,at).progress;};
  switch(command.type){
    case 'habit':{
      const habit=HABITS.find(h=>h.id===command.habit);if(!habit)throw problem(400,'invalid_habit','項目を確認してね。');
      if(recordHabit(state.legacy,date,habit.id))manual(({walk:'walk',meal:'meal_care',stretch:'stretch',rest:'rest'})[habit.id],habit.title);break;
    }
    case 'weight':{
      if(!Number.isFinite(command.value)||command.value<1||command.value>500)throw problem(400,'invalid_weight','体重は1〜500の範囲で入力してね。');
      day().weight=Math.round(command.value*10)/10;manual('weight','体重を記録した',{weightKg:day().weight});break;
    }
    case 'remove_weight':{
      if(state.legacy.days[date])delete state.legacy.days[date].weight;
      for(const a of state.progress.activities)if(a.kind==='weight'&&a.date===date)a.deleted=true;
      state.progress.revision++;break;
    }
    case 'mood':if(!Object.hasOwn(MOODS,command.mood))throw problem(400,'invalid_mood','気分を確認してね。');day().mood=command.mood;break;
    case 'pet':petCompanion(state.legacy,new Date(now));break;
    case 'item':if(state.legacy.owned.includes(command.id)){state.legacy.decor=state.legacy.decor.includes(command.id)?state.legacy.decor.filter(x=>x!==command.id):[...state.legacy.decor,command.id];}else if(!buyItem(state.legacy,command.id))throw problem(400,'item_unavailable','交換できるものを確認してね。');break;
    case 'profile':state.profile=command.namesConfigured?normalizeNames(command.nickname,command.petName):{...state.profile,version:1,nickname:normalizeNickname(command.nickname),petName:normalizeNickname(command.petName??state.profile.petName??'こむぎ')||'こむぎ'};break;
    case 'reset_memory':if(state.chatLease?.until>now)throw problem(409,'chat_busy','こむぎの返事を待ってからリセットしてね。');state.memory={...emptyMemory(),revision:(state.memory?.revision??0)+1,throughSequence:state.messageCounter*2+1,updatedAt:at};break;
    case 'chat_setting':if(typeof command.enabled!=='boolean')throw problem(400,'invalid_setting','設定を確認してね。');state.chatEnabled=command.enabled;break;
    case 'correct_activity':{
      const c=command.changes;if(!c||Object.keys(c).some(k=>!['date','minutes','kcal','weightKg','detail'].includes(k)))throw problem(400,'invalid_correction','訂正内容を確認してね。');
      state.progress=correctActivity(state.progress,command.id,c,state.legacy,at,today);break;
    }
    default:throw problem(400,'invalid_command','この操作には対応していません。');
  }
  state.progress.peakPoints=Math.max(state.progress.peakPoints,progressTotal(state.progress));state.revision++;
  return state;
}
