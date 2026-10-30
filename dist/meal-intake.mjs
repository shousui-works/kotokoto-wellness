// Intake is separate from the exercise kcal/estimate fields and never earns energy-based points.
export const MEAL_TYPES={breakfast:'朝食',lunch:'昼食',dinner:'夕食',snack:'間食',other:'食事'};
const number=(n,max=20000)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=max;
const text=(s,max)=>typeof s==='string'&&!!s.trim()&&s.length<=max;
export function normalizeMealItems(items){
  if(!Array.isArray(items)||!items.length||items.length>12)throw Error('料理は1〜12品で入力してください。');
  const out=items.map(item=>{
    if(!text(item?.name,60)||!text(item.portion,80)||!number(item.kcal,5000))throw Error('料理名・食べた量・kcalを確認してください。');
    return {name:item.name.trim(),portion:item.portion.trim(),kcal:Math.round(item.kcal)};
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
  if(value.version!==1||!number(value.kcal)||!['photo','edited'].includes(value.source)||!Object.hasOwn(MEAL_TYPES,value.mealType))throw Error('Invalid meal intake');
  const estimate=normalizeMealEstimate(value.estimate);
  if(estimate.status!=='ok')throw Error('Invalid meal intake estimate');
  const items=value.items.length?normalizeMealItems(value.items):[];
  if(items.length&&Math.round(value.kcal)!==items.reduce((sum,item)=>sum+item.kcal,0))throw Error('Invalid meal intake total');
  return {version:1,kcal:Math.round(value.kcal),source:value.source,mealType:value.mealType,items,estimate};
}
export function mealIntakeSummary(progress,date){
  const meals=progress.activities.filter(a=>!a.deleted&&!a.hold&&a.kind==='meal_log'&&a.date&&(date===undefined||a.date===date));
  let kcal=0,recorded=0,estimated=0;
  for(const meal of meals)if(meal.intake){kcal+=meal.intake.kcal;recorded++;if(meal.intake.source==='photo')estimated++;}
  return {kcal,recorded,estimated,withoutCalories:meals.length-recorded};
}
