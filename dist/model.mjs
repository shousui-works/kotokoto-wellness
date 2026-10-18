export const HABITS=[{id:'walk',icon:'🌿',title:'少し、からだを動かした',detail:'お散歩も、階段も。自分なりでOK。'},{id:'meal',icon:'🍽️',title:'食事をゆっくり楽しんだ',detail:'味わうひとときも、わたしへのケア。'},{id:'stretch',icon:'🧘',title:'からだをほぐした',detail:'肩を回す、背伸びする。ちょっとでも。'},{id:'rest',icon:'🌙',title:'自分に休む時間をあげた',detail:'休息も、大切な「できた」。'}];
export const ITEMS=[{id:'flower',icon:'🌷',name:'窓辺のチューリップ',cost:10},{id:'plant',icon:'🪴',name:'小さな観葉植物',cost:20},{id:'cushion',icon:'🧶',name:'ふわふわ毛糸玉',cost:30},{id:'picture',icon:'🖼️',name:'お気に入りの絵',cost:40},{id:'books',icon:'📚',name:'午後の読みもの',cost:50},{id:'lamp',icon:'🕯️',name:'ひだまりの灯り',cost:60}];
export const MOODS={good:'いい感じ',okay:'ふつう',slow:'のんびり'};
export const dateKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const emptyState=()=>({version:1,days:{},owned:[],decor:[]});
export function normalizeState(value){const out=emptyState();if(!value||value.version!==1)return out;for(const [date,day] of Object.entries(value.days||{})){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!day||typeof day!=='object')continue;out.days[date]={habits:[...new Set(Array.isArray(day.habits)?day.habits:[])].filter(id=>HABITS.some(h=>h.id===id))};if(Object.hasOwn(MOODS,day.mood))out.days[date].mood=day.mood;if(typeof day.weight==='number'&&Number.isFinite(day.weight)&&day.weight>=1&&day.weight<=500)out.days[date].weight=Math.round(day.weight*10)/10;}const ids=ITEMS.map(i=>i.id);out.owned=[...new Set(Array.isArray(value.owned)?value.owned:[])].filter(id=>ids.includes(id));out.decor=[...new Set(Array.isArray(value.decor)?value.decor:[])].filter(id=>out.owned.includes(id));return out;}
export const totals=state=>{const xp=Object.values(state.days).reduce((sum,d)=>sum+d.habits.length*10,0);const spent=state.owned.reduce((sum,id)=>sum+(ITEMS.find(i=>i.id===id)?.cost||0),0);return {xp,seeds:Math.max(0,xp-spent),level:Math.floor(xp/40)+1,progress:xp%40};};
export function recordHabit(state,date,id){if(!HABITS.some(h=>h.id===id))return false;const day=state.days[date]??={habits:[]};if(day.habits.includes(id))return false;day.habits.push(id);return true;}
export function buyItem(state,id){const item=ITEMS.find(i=>i.id===id);if(!item||state.owned.includes(id)||totals(state).seeds<item.cost)return false;state.owned.push(id);state.decor.push(id);return true;}
export function recentDays(count=7,now=new Date()){return Array.from({length:count},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());d.setDate(d.getDate()-(count-1-i));return dateKey(d);});}

export const GROWTH_STAGES=[
  {id:'puppy',name:'ちいさな子犬',minXP:0,minLevel:1,description:'まるいお顔と、ちいさなあんよ。'},
  {id:'young',name:'育ちざかり',minXP:80,minLevel:3,description:'すこし背がのびて、首輪もお似合い。'},
  {id:'adult',name:'おとなの犬',minXP:200,minLevel:6,description:'大きなからだに、緑のバンダナ。'}
];
export function growthForXP(xp){
  const safeXP=Number.isFinite(xp)?Math.max(0,xp):0;
  const index=GROWTH_STAGES.findLastIndex(stage=>safeXP>=stage.minXP);
  const stage=GROWTH_STAGES[index],next=GROWTH_STAGES[index+1]??null;
  return {index,stage,next,progress:next?safeXP-stage.minXP:safeXP%40,max:next?next.minXP-stage.minXP:40,remainingHabits:next?Math.ceil((next.minXP-safeXP)/10):0};
}
