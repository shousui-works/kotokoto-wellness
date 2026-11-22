// Intake is separate from the exercise kcal/estimate fields and never earns energy-based points.
export const MEAL_TYPES={breakfast:'朝食',lunch:'昼食',dinner:'夕食',snack:'間食',other:'食事'};
const number=(n,max=20000)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=max;
const text=(s,max)=>typeof s==='string'&&!!s.trim()&&s.length<=max;
export function normalizeMealPortions(items){
  if(!Array.isArray(items)||!items.length||items.length>12)throw Error('料理は1〜12品で入力してください。');
  return items.map(item=>{
    if(!text(item?.name,60)||!text(item.portion,80))throw Error('料理名・食べた量を確認してください。');
    return {name:item.name.trim(),portion:item.portion.trim()};
  });
}
export function normalizeMealItems(items){
  const portions=normalizeMealPortions(items);
  const out=items.map((item,index)=>{
    if(!number(item.kcal,5000))throw Error('料理ごとのkcalを確認してください。');
    return {...portions[index],kcal:Math.round(item.kcal)};
  });
  if(out.reduce((sum,item)=>sum+item.kcal,0)>20000)throw Error('合計カロリーを確認してください。');
  return out;
}
export function normalizeMealEstimate(value){
  if(!['ok','unclear','not_food'].includes(value?.status)||typeof value.basis!=='string'||value.basis.length>600||typeof value.question!=='string'||value.question.length>200)throw Error('写真の推定結果を読み取れませんでした。');
  if(value.status!=='ok'){
    if(!Array.isArray(value.items)||value.items.length||!value.question.trim())throw Error('写真の推定結果を読み取れませんでした。');
    return {status:value.status,items:[],basis:value.basis.trim(),question:value.question.trim()};
  }
  const items=normalizeMealItems(value.items);
  if(!value.basis.trim())throw Error('推定の前提がありません。');
  return {status:'ok',items,basis:value.basis.trim(),question:value.question.trim()};
}
export function normalizeIntake(value){
  if(value==null)return null;
  if(value.version!==1||!number(value.kcal)||!['photo','text','reported','edited'].includes(value.source)||!Object.hasOwn(MEAL_TYPES,value.mealType))throw Error('Invalid meal intake');
  const origin=value.origin??(['text','reported'].includes(value.source)?value.source:null);
  if(origin!==null&&(!['photo','text','reported'].includes(origin)||value.source!=='edited'&&origin!==value.source))throw Error('Invalid intake origin');
  const estimate=normalizeMealEstimate(value.estimate);
  if(estimate.status!=='ok')throw Error('Invalid meal intake estimate');
  if(!Array.isArray(value.items))throw Error('Invalid meal intake items');
  const items=value.items.length?normalizeMealItems(value.items):[];
  if(items.length&&Math.round(value.kcal)!==items.reduce((sum,item)=>sum+item.kcal,0))throw Error('Invalid meal intake total');
  return {version:1,kcal:Math.round(value.kcal),source:value.source,...(origin?{origin}:{}),mealType:value.mealType,items,estimate};
}

// Conversation candidates contain no storage IDs or photo-confirmation fields.
export function normalizeConversationMeal(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4
      ||!['source','mealType','items','basis'].every(key=>Object.hasOwn(value,key))
      ||!['text','reported'].includes(value.source)||!Object.hasOwn(MEAL_TYPES,value.mealType)||!text(value.basis,600))throw Error('Invalid conversation meal');
  return {source:value.source,mealType:value.mealType,items:normalizeMealItems(value.items),basis:value.basis.trim()};
}

export function intakeFromConversation(value){
  const meal=normalizeConversationMeal(value);
  return normalizeIntake({version:1,kcal:meal.items.reduce((sum,item)=>sum+item.kcal,0),source:meal.source,origin:meal.source,
    mealType:meal.mealType,items:meal.items,estimate:{status:'ok',items:meal.items,basis:meal.basis,question:''}});
}

// A bounded reference lets Luna reuse confirmed portions instead of guessing anew.
export function intakeReference(value){
  if(value==null)return null;
  const basis=value.basis??value.estimate?.basis;
  if(!number(value.kcal)||!['photo','text','reported','edited'].includes(value.source)||!Object.hasOwn(MEAL_TYPES,value.mealType)
      ||!text(basis,600)||!Array.isArray(value.items))throw Error('Invalid intake reference');
  const items=value.items.length?normalizeMealItems(value.items):[];
  if(items.length&&items.reduce((sum,item)=>sum+item.kcal,0)!==Math.round(value.kcal))throw Error('Invalid intake reference total');
  return {kcal:Math.round(value.kcal),source:value.source,mealType:value.mealType,items,basis:basis.trim()};
}

export const intakeSourceLabel=intake=>({photo:'写真からの推定',text:'会話からの推定',reported:'本人の申告',edited:'本人の修正'})[intake.source];
export const intakeBasisLabel=intake=>({photo:'写真推定時の前提',text:'会話推定時の前提',reported:'申告時のメモ'})[intake.origin??(intake.source==='edited'?'photo':intake.source)];

export function mealIntakeNote(summary){
  if(!summary.recorded)return '摂取カロリーの記録はまだありません。';
  return [`${summary.recorded}件の食事を集計`,summary.photoEstimated?`写真推定${summary.photoEstimated}件`:'',summary.textEstimated?`会話推定${summary.textEstimated}件`:'',summary.reported?`本人申告${summary.reported}件`:'',summary.withoutCalories?`カロリー未記録${summary.withoutCalories}件`:''].filter(Boolean).join(' · ');
}
export function mealIntakeSummary(progress,date){
  const meals=progress.activities.filter(a=>!a.deleted&&!a.hold&&a.kind==='meal_log'&&a.date&&(date===undefined||a.date===date));
  let kcal=0,recorded=0,photoEstimated=0,textEstimated=0,reported=0;
  for(const meal of meals)if(meal.intake){kcal+=meal.intake.kcal;recorded++;if(meal.intake.source==='photo')photoEstimated++;if(meal.intake.source==='text')textEstimated++;if(meal.intake.source==='reported')reported++;}
  return {kcal,recorded,estimated:photoEstimated+textEstimated,photoEstimated,textEstimated,reported,withoutCalories:meals.length-recorded};
}
