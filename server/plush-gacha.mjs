import {randomInt} from 'node:crypto';
import {emptyCollection,normalizeCollection,collectionBalance} from '../dist/collection-model.mjs';
import {PLUSH_CATALOG,CATALOG_VERSION,DRAW_COST,EXCHANGE_COST,SHELF_SLOTS,plushById,isActivePlush} from '../dist/plush-catalog.mjs';
import {progressTotal} from '../dist/progress.mjs';
const bad=(message,code='invalid_plush',status=400)=>Object.assign(Error(message),{status,code});
export const drawCandidate=(choose=randomInt)=>PLUSH_CATALOG[choose(PLUSH_CATALOG.length)]?.id;
export function applyPlush(original,command,{id,now=Date.now(),candidate,enabled=true}={}){
 if(!original.initialized)throw bad('先にアカウントの設定を完了してね。');
 const state=structuredClone(original),c=normalizeCollection(state.collection),at=new Date(now).toISOString();state.collection=c;
 if(command.type==='plush_seen'){if(c.lastResult?.requestId===command.id)c.seenResult=command.id;state.revision++;return {state,transaction:null};}
 if(command.type==='plush_display'){
  if(!SHELF_SLOTS.includes(command.slot)||command.item!==null&&!isActivePlush(command.item))throw bad('置き場所を確認してね。');
  const shelf={...c.shelf};delete shelf[command.slot];
  if(command.item!==null){
   if(!c.owned[command.item])throw bad('そのぬいぐるみは、まだ持っていません。');
   const count=Object.values(shelf).filter(x=>x===command.item).length;
   if(count>=c.owned[command.item].count){const origin=Object.keys(shelf).find(key=>shelf[key]===command.item),old=c.shelf[command.slot];if(isActivePlush(old))shelf[origin]=old;else delete shelf[origin];}
   shelf[command.slot]=command.item;
  }
  c.shelf=shelf;state.revision++;return {state,transaction:null};
 }
 if(!enabled)throw bad('ガチャはただいまおやすみ中です。','gacha_disabled',409);
 let item,cost=0,buttonCost=0;
 if(command.type==='plush_draw'){if(collectionBalance(c,progressTotal(state.progress))<DRAW_COST)throw bad('ポイントがもう少したまったら、また開けてみよう。','insufficient_points');item=candidate;cost=DRAW_COST;}
 else if(command.type==='plush_exchange'){item=command.item;if(c.buttons<EXCHANGE_COST)throw bad('交換用のボタンが足りません。','insufficient_buttons');if(c.owned[item])throw bad('まだ持っていない子を選んでね。');buttonCost=EXCHANGE_COST;}
 else throw bad('この操作には対応していません。');
 if(!isActivePlush(item))throw bad('ぬいぐるみを確認してね。');
 const old=c.owned[item],isNew=!old;c.spent+=cost;c.buttons-=buttonCost;if(old&&cost)c.buttons++;
 c.owned[item]={count:(old?.count??0)+1,firstAt:old?.firstAt??at};
 const transaction={requestId:id,type:command.type,item,isNew,cost,buttonCost,buttonGain:old&&cost?1:0,catalogVersion:CATALOG_VERSION,at};
 c.lastResult=transaction;state.revision++;return {state,transaction};
}
