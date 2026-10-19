import {SHELF_SLOTS,plushById} from './plush-catalog.mjs';
export const emptyCollection=()=>({version:1,spent:0,buttons:0,owned:{},shelf:{},lastResult:null,seenResult:null});
export function normalizeCollection(value){
 if(value==null)return emptyCollection();const c=structuredClone(value);
 if(c.version!==1||!Number.isSafeInteger(c.spent)||c.spent<0||!Number.isSafeInteger(c.buttons)||c.buttons<0||!c.owned||!c.shelf)throw Error('ぬいぐるみの保存形式を確認できません。');
 for(const [id,item]of Object.entries(c.owned))if(!plushById(id)||!Number.isSafeInteger(item.count)||item.count<1||!Number.isFinite(Date.parse(item.firstAt)))throw Error('ぬいぐるみの所持数を確認できません。');
 const placed={};for(const [slot,id]of Object.entries(c.shelf)){if(!SHELF_SLOTS.includes(slot)||!c.owned[id]||((placed[id]=(placed[id]??0)+1)>(c.owned[id]?.count??0)))throw Error('棚の配置を確認できません。');}
 return {...c,seenResult:c.seenResult??null};
}
export const collectionBalance=(collection,earned)=>Math.max(0,earned-collection.spent);
