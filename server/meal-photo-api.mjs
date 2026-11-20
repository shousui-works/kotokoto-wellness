import {problem,uuid,fingerprint,dayKey,requireSetup,requireRevision,publicAccount} from './account-model.mjs';
import {validateMealPhoto} from './meal-photo.mjs';
import {MEAL_TYPES,normalizeMealItems,normalizeMealPortions,normalizeMealEstimate} from '../dist/meal-intake.mjs';
import {applyInterpretation,validDate} from '../dist/progress.mjs';

export function createMealPhotoAPI({store,estimate,now=Date.now,apiAvailable=true}){
  return async function mealPhoto(uid,path,raw){
    if(!uuid(raw?.requestId))throw problem(400,'invalid_id','写真の送信をやり直してください。');
    const id=raw.requestId;
    if(path==='/api/meal-photo/estimate'){
      if(!apiAvailable||!estimate)throw problem(503,'photo_unavailable','写真の確認は準備中です。');
      if(typeof raw.note!=='string'||raw.note.length>400)throw problem(400,'invalid_note','量や材料の補足は400文字以内で入力してください。');
      let adjustments;try{adjustments=raw.adjustments==null?null:normalizeMealPortions(raw.adjustments);}catch(error){throw problem(400,'invalid_meal',error.message);}
      let photo;try{photo=validateMealPhoto(raw.image);}catch(error){throw problem(400,'invalid_photo',error.message);}
      const hash=fingerprint({type:'meal_photo',imageHash:photo.hash,note:raw.note,adjustments}),time=now();
      function replay(op){
        if(op.fingerprint!==hash||op.type!=='meal_photo')throw problem(409,'request_conflict','同じ送信IDの内容が変わっています。写真を選び直してください。');
        if(op.bodyCleared)throw problem(409,'history_cleared','この推定は削除済みです。写真を選び直してください。');
        if(op.status==='pending')throw problem(409,op.until>now()?'request_pending':'outcome_unknown',op.until>now()?'写真を確認中です。少し待ってからもう一度確認してください。':'確認結果を取得できませんでした。もう一度「写真から見積もる」を押してください。');
        return {status:op.httpStatus,body:{requestId:id,...op.result}};
      }
      const reserved=await store.atomic(uid,id,(state,op,usage)=>{
        if(op)return {value:replay(op)};requireSetup(state);
        const global=usage.global,personal=usage.user;
        global.leases=global.leases.filter(lease=>lease.until>time);personal.recent=personal.recent.filter(at=>at>time-60000);
        if(state.chatLease?.until>time)throw problem(409,'chat_busy','こむぎの返事や写真の確認を待ってください。');
        if(global.count>=120||personal.count>=30||personal.recent.length>=6||global.leases.length>=2)throw problem(429,'rate_limited','少しひと息ついてから、また写真を見せてね。');
        const until=time+90000;global.count++;personal.count++;personal.recent.push(time);global.leases.push({key:`${uid}/${id}`,until});
        return {state:{...state,chatLease:{id,until}},operation:{id,type:'meal_photo',fingerprint:hash,status:'pending',until,at:time},usage,value:null};
      },{quota:true,now:time});
      if(reserved)return reserved;
      let outcome;try{outcome=await estimate({image:photo.dataUrl,note:raw.note,adjustments},uid);if(outcome.status===200)outcome={status:200,body:{estimate:normalizeMealEstimate(outcome.body.estimate)}};}
      catch{outcome={status:503,body:{error:{code:'photo_failed',message:'写真の確認に失敗しました。少し待って、もう一度試してください。',retryable:true}}};}
      return store.atomic(uid,id,(state,op,usage)=>{
        if(op?.status!=='pending')return {value:replay(op)};
        usage.global.leases=usage.global.leases.filter(lease=>lease.key!==`${uid}/${id}`);
        if(state.chatLease?.id===id)state.chatLease=null;
        return {state,usage,operation:{...op,status:'complete',httpStatus:outcome.status,result:outcome.body},value:{status:outcome.status,body:{requestId:id,...outcome.body}}};
      },{quota:true,now:time});
    }
    if(path!=='/api/meal-photo/confirm')throw problem(404,'not_found','見つかりませんでした。');
    let items;try{items=normalizeMealItems(raw.items);}catch(error){throw problem(400,'invalid_meal',error.message);}
    if(!validDate(raw.date)||raw.date>dayKey(now())||!Object.hasOwn(MEAL_TYPES,raw.mealType))throw problem(400,'invalid_meal','食べた日と食事の区分を確認してください。');
    const targetId=raw.targetId??null;
    if(targetId!==null&&(typeof targetId!=='string'||targetId.length>100))throw problem(400,'invalid_meal','追加先の記録を確認してください。');
    const confirmation=fingerprint({date:raw.date,mealType:raw.mealType,items,targetId});
    return store.atomic(uid,id,(state,op)=>{
      requireSetup(state);
      if(op?.type!=='meal_photo'||op.status!=='complete'||op.httpStatus!==200||op.result?.estimate?.status!=='ok'||op.bodyCleared)throw problem(409,'estimate_missing','写真を確認してから保存してください。');
      if(op.confirmation){
        if(op.confirmation!==confirmation)throw problem(409,'already_recorded','この写真は記録済みです。変更は記録画面の「訂正」から行えます。');
        return {value:{status:200,body:{requestId:id,recorded:true,state:publicAccount(state)}}};
      }
      requireRevision(state,raw.revision);
      const old=targetId?state.progress.activities.find(a=>a.id===targetId&&!a.deleted&&!a.hold):null;
      if(targetId&&(!old||old.kind!=='meal_log'||old.date!==raw.date))throw problem(409,'meal_changed','追加先の食事が変わりました。選び直してください。');
      const title=(MEAL_TYPES[raw.mealType]+'：'+items.map(item=>item.name).join('、')).slice(0,100),detail=items.map(item=>`${item.name}（${item.portion}）`).join('、').slice(0,300);
      const applied=applyInterpretation(state.progress,{requestId:'meal-photo:'+id,today:dayKey(now()),at:new Date(now()).toISOString(),text:title,reply:old?.praise??'',actions:[{operation:old?'update':'create',targetId:old?.id??null,kind:'meal_log',date:raw.date,title,evidence:title,minutes:null,kcal:null,weightKg:null,detail,additional:!old}]},state.legacy);
      const activity=applied.progress.activities.find(a=>a.id===(old?.id??`meal-photo:${id}:0`));
      if(!activity)throw problem(409,'meal_changed','食事を保存できませんでした。もう一度確認してください。');
      const original=normalizeMealEstimate(op.result.estimate);
      activity.intake={version:1,kcal:items.reduce((sum,item)=>sum+item.kcal,0),source:JSON.stringify(items)===JSON.stringify(original.items)?'photo':'edited',mealType:raw.mealType,items,estimate:original};
      state.progress=applied.progress;state.revision++;
      return {state,operation:{...op,confirmation,activityId:activity.id},value:{status:200,body:{requestId:id,recorded:true,receipts:applied.receipts,state:publicAccount(state)}}};
    });
  };
}
