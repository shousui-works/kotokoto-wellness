import {createRoomMotion} from './companion-motion.mjs?v=play-1';
import {createCompanionBubble} from './companion-bubble.mjs?v=play-1';
import {createCompanionChat,CHAT_STORAGE,HABIT_PRAISE} from './companion-chat.mjs?v=praise-1';
import {HABITS,ITEMS,MOODS,dateKey,emptyState,normalizeState,totals,recordHabit,buyItem,recentDays,GROWTH_STAGES,growthForXP,COMPANION_FEELINGS,affectionFor,companionFeeling,petCompanion} from './model.mjs?v=praise-1';
let roomMotion,companionChat,activeChat=null,activePraise=null,praiseTimer;
const STORAGE='kotokoto-wellness-v1';const $=id=>document.getElementById(id);let state=emptyState(),loadFailed=false;try{const raw=localStorage.getItem(STORAGE);if(raw!==null){const parsed=JSON.parse(raw);if(parsed?.version!==1)throw new Error('Unknown data version');state=normalizeState(parsed);}}catch{loadFailed=true;$('storage-warning').hidden=false;$('storage-warning').textContent='保存済みのきろくを読み込めませんでした。元のデータは上書きしません。ブラウザの設定をご確認ください。';}let currentTab='room',lastDate=dateKey(),toastTimer;const today=()=>state.days[dateKey()]||{habits:[]};const dayForEdit=()=>state.days[dateKey()]??={habits:[]};
function persist(){if(loadFailed)return;try{localStorage.setItem(STORAGE,JSON.stringify(state));$('storage-warning').hidden=true;}catch{$('storage-warning').textContent='このブラウザに保存できません。きろくは画面を閉じると消えるため、設定からバックアップしてください。';$('storage-warning').hidden=false;}}
function toast(message){const host=[...document.querySelectorAll('dialog[open]')].at(-1)||document.body;host.append($('toast'));$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3600);}
function formatDate(key,options={month:'numeric',day:'numeric'}){return new Intl.DateTimeFormat('ja-JP',options).format(new Date(key+'T12:00:00'));}
function roomDecor(){document.querySelectorAll('.room-items').forEach(el=>{el.replaceChildren(...state.decor.map(id=>{const item=ITEMS.find(i=>i.id===id);const span=document.createElement('span');span.className=id;span.textContent=item.icon;return span;}));});document.querySelectorAll('.room-scene').forEach(el=>el.setAttribute('aria-label',`ポメラニアンのこむぎ（${growthForXP(totals(state).xp).stage.name}）のお部屋。${state.decor.length?state.decor.map(id=>ITEMS.find(i=>i.id===id).name).join('、')+'を飾っています。':'小さなできたを集めて、好きなものを飾れます。'}`));}
function renderHabits(){const completed=today().habits;$('done-count').textContent=completed.length;$('dock-count').textContent=completed.length+'/4';$('habit-list').innerHTML=HABITS.map(h=>`<article class="habit ${completed.includes(h.id)?'is-done':''}"><span class="habit-emoji" aria-hidden="true">${h.icon}</span><div class="habit-text"><h3>${h.title}</h3><p>${h.detail}</p></div><button data-habit="${h.id}" ${completed.includes(h.id)?'disabled':''} aria-label="${h.title}：${completed.includes(h.id)?'記録済み':'できたを記録'}">${completed.includes(h.id)?'✓ できた':'できた ＋'}</button></article>`).join('');}
function renderWeek(){let count=0;$('week-dots').innerHTML=recentDays().map(key=>{const n=state.days[key]?.habits.length||0;count+=n;const isToday=key===dateKey();return `<div class="week-day ${isToday?'today':''}" aria-label="${formatDate(key)}、${n}個のできた${isToday?'、今日':''}"><span>${formatDate(key,{weekday:'short'})}</span><span class="day-flower ${n?'active':''}" aria-hidden="true" style="${n?'opacity:'+(.55+n*.1125):''}">${n?'✳':'·'}</span><span class="day-date">${formatDate(key)}</span><span class="day-score">${n?n+'こできた':isToday?'きょう':'—'}</span></div>`;}).join('');$('week-total').textContent=`${count}この「できた」`;}
function renderShop(){const balance=totals(state).seeds;$('shop-items').innerHTML=ITEMS.map(item=>{const owned=state.owned.includes(item.id),decorated=state.decor.includes(item.id);return `<article class="shop-item"><span aria-hidden="true">${item.icon}</span><h4>${item.name}</h4><button data-item="${item.id}" ${owned?'aria-pressed="'+decorated+'"':''} ${!owned&&balance<item.cost?'disabled':''} aria-label="${item.name}：${owned?(decorated?'しまう':'飾る'):item.cost+'たねで交換'}">${owned?(decorated?'✓ 飾っている':'おへやに飾る'):'✦ '+item.cost+' たね'}</button></article>`;}).join('');}
function renderWeights(){const weights=Object.entries(state.days).filter(([,day])=>Number.isFinite(day.weight)).sort(([a],[b])=>a.localeCompare(b));const latest=weights.at(-1);$('latest-weight').innerHTML=latest?`${latest[1].weight.toFixed(1)} <span>kg · ${formatDate(latest[0])}</span>`:'— <span>kg</span>';if(weights.length<2){$('weight-chart').innerHTML='<p>'+(weights.length?'はじめのきろくができました。<br>2日分たまると、変化が線で見られます。':'まだ、きろくはありません。<br>はじめたい日に、ひとつから。')+'</p>';return;}const values=weights.slice(-30);const W=400,H=150,left=45,right=17,top=18,bottom=30;const rawMin=Math.min(...values.map(([,d])=>d.weight)),rawMax=Math.max(...values.map(([,d])=>d.weight));const pad=Math.max((rawMax-rawMin)*.2,.5),min=rawMin-pad,max=rawMax+pad;const firstTime=new Date(values[0][0]+'T12:00:00').getTime(),lastTime=new Date(values.at(-1)[0]+'T12:00:00').getTime();const x=key=>left+(new Date(key+'T12:00:00').getTime()-firstTime)/(lastTime-firstTime)*(W-left-right),y=value=>top+(max-value)/(max-min)*(H-top-bottom);const points=values.map(([key,d])=>`${x(key)},${y(d.weight)}`).join(' ');const summary=values.map(([key,d])=>`${formatDate(key)} ${d.weight.toFixed(1)}kg`).join('、');$('weight-chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最近の体重の記録。${summary}"><line x1="${left}" y1="${top}" x2="${W-right}" y2="${top}" stroke="#e4e6dc"/><line x1="${left}" y1="${H-bottom}" x2="${W-right}" y2="${H-bottom}" stroke="#e4e6dc"/><text x="0" y="${top+4}" fill="#777b6c" font-size="12">${max.toFixed(1)}</text><text x="0" y="${H-bottom+4}" fill="#777b6c" font-size="12">${min.toFixed(1)}</text><polyline fill="none" stroke="#7f916c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}"/>${values.map(([key,d])=>`<circle cx="${x(key)}" cy="${y(d.weight)}" r="3" fill="#58714b"/>`).join('')}<text x="${left}" y="${H-5}" fill="#777b6c" font-size="12">${formatDate(values[0][0])}</text><text x="${W-right}" y="${H-5}" fill="#777b6c" font-size="12" text-anchor="end">${formatDate(values.at(-1)[0])}</text></svg><p class="privacy-note">${formatDate(values[0][0])}〜${formatDate(values.at(-1)[0])} · 最近${values.length}回のきろく</p>`;}
function renderHistory(){const entries=Object.entries(state.days).filter(([,day])=>day.habits.length||day.mood||Number.isFinite(day.weight)).sort(([a],[b])=>b.localeCompare(a)).slice(0,14);if(!entries.length){$('history-list').innerHTML='<p class="empty-history">これから、あなたの<br>「できた」がならびます。<br>今日の小さな一歩から。</p>';return;}$('history-list').innerHTML=entries.map(([key,d])=>`<article class="history-entry"><div><span>${formatDate(key,{month:'long',day:'numeric',weekday:'short'})}</span><span>${d.habits.length}この「できた」</span></div><p>${d.habits.length?d.habits.map(id=>HABITS.find(h=>h.id===id).icon).join(' '):'ゆっくり、わたしのペースで。'}${d.mood?' · '+MOODS[d.mood]:''}${Number.isFinite(d.weight)?' · '+d.weight.toFixed(1)+' kg':''}</p></article>`).join('');}
function renderGrowth(xp){
  const g=growthForXP(xp);
  document.querySelectorAll('[data-companion]').forEach(el=>{el.classList.remove(...GROWTH_STAGES.map(stage=>'dog--'+stage.id));el.classList.add('dog--'+g.stage.id);el.dataset.stage=g.stage.id;});
  $('stage-name').textContent=g.stage.name;$('room-stage-name').textContent=g.stage.name;
  $('growth-label').textContent=g.next?'こむぎの成長':'次のレベルへ';
  $('growth-text').textContent=`${g.progress} / ${g.max}`;
  $('growth-progress').max=g.max;$('growth-progress').value=g.progress;
  $('growth-progress').setAttribute('aria-label',g.next?`${g.next.name}への成長の経験値`:'次のレベルまでの経験値');
  const message=g.next?`あと${g.remainingHabits}この「できた」で、${g.next.name}に。`:'おとなになっても、いっしょに一歩ずつ。';
  $('growth-next').textContent=message;$('room-growth-next').textContent=message;
  document.querySelectorAll('[data-growth-stage]').forEach(el=>{const index=GROWTH_STAGES.findIndex(stage=>stage.id===el.dataset.growthStage);el.classList.toggle('is-current',index===g.index);el.querySelector('[data-stage-status]').textContent=index===g.index?'いまのこむぎ':index<g.index?'ここまで育ったよ':'これからのお楽しみ';});
}
function applyFeeling(dog,feeling,bonded=false){
  dog.classList.remove(...Object.keys(COMPANION_FEELINGS).map(id=>'feeling-'+id));
  dog.classList.add('feeling-'+feeling.id);dog.classList.toggle('dog--attached',bonded);
}
function renderCompanionSpeech(feeling=companionFeeling(state)){
  const speech=activePraise??activeChat;
  const label=speech?.label??feeling.label,message=speech?.text??feeling.lines[0];
  const changed=$('companion-message').textContent!==message,bubble=document.querySelector('.companion-bubble');
  if($('companion-feeling').textContent!==label)$('companion-feeling').textContent=label;
  $('companion-feeling').dataset.feeling=feeling.id;
  if($('companion-message').textContent!==message)$('companion-message').textContent=message;
  bubble.classList.toggle('is-chatting',Boolean(speech));
  if(changed){bubble.classList.remove('speech-arriving');requestAnimationFrame(()=>bubble.classList.add('speech-arriving'));}
}
function showCompanionPraise(text){
  companionChat.interrupt();clearTimeout(praiseTimer);
  activePraise={label:'こむぎからの花まる',text};renderCompanionSpeech();
  praiseTimer=setTimeout(()=>{activePraise=null;renderCompanionSpeech();},12000);
}
function renderCompanionFeeling(){
  const feeling=companionFeeling(state),affection=affectionFor(state);
  renderCompanionSpeech(feeling);
  $('affection-score').textContent=affection.score;$('affection-label').textContent=affection.label;$('affection-progress').value=affection.score;
  document.querySelectorAll('[data-companion]').forEach(dog=>{
    applyFeeling(dog,feeling,affection.score>=50);
    const scene=dog.closest('.room-scene');
    const decor=state.decor.map(id=>ITEMS.find(item=>item.id===id).name).join('、');
    scene.setAttribute('aria-label',`ポメラニアンのこむぎ（${growthForXP(totals(state).xp).stage.name}）。${feeling.label}。${decor?decor+'を飾ったお部屋。':''}`);
  });
}
function greetDogs(){roomMotion?.greet();}
function previewReaction(id){
  const feeling=COMPANION_FEELINGS[id];if(!feeling)return;
  const dog=$('reaction-scene').querySelector('.dog'),stage=growthForXP(totals(state).xp).stage;
  dog.classList.remove(...GROWTH_STAGES.map(s=>'dog--'+s.id),'greet');dog.classList.add('dog--'+stage.id);
  applyFeeling(dog,feeling,id==='happy');
  $('reaction-status').textContent=feeling.label;$('reaction-message').textContent=feeling.lines.join('\n');
  $('reaction-scene').querySelector('.room-scene').setAttribute('aria-label',`こむぎの反応のおためし。${feeling.label}。`);
  document.querySelectorAll('[data-reaction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.reaction===id)));
  if(id!=='lonely'){void dog.offsetWidth;dog.classList.add('greet');}
}
function render(){const t=totals(state);$('balance').textContent=t.seeds;$('level').textContent=`Lv. ${t.level}`;renderGrowth(t.xp);$('date-label').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());renderHabits();renderWeek();renderShop();roomDecor();renderCompanionFeeling();renderWeights();renderHistory();document.querySelectorAll('[data-mood]').forEach(button=>button.setAttribute('aria-pressed',String(today().mood===button.dataset.mood)));roomMotion?.refresh();}
const PANEL_TITLES={today:['ONE LITTLE STEP','今日の「できた」'],decorate:['MAKE A LITTLE HOME','おへやのもようがえ'],records:['YOUR OWN RHYTHM','わたしのきろく'],companion:['MY LITTLE PARTNER','こむぎのようす']};
function syncPanelButtons(){document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-expanded',String($('room-sheet').open&&button.dataset.tab===currentTab)));}
function switchTab(tab,updateHash=true){
  const panel=Object.hasOwn(PANEL_TITLES,tab)?tab:'room';
  currentTab=panel;
  document.querySelectorAll('.tab-view').forEach(el=>el.hidden=el.id!==panel);
  if(panel==='room'){$('room-sheet').close();}
  else{[$('sheet-eyebrow').textContent,$('sheet-title').textContent]=PANEL_TITLES[panel];if(!$('room-sheet').open)$('room-sheet').showModal();$('room-sheet').scrollTop=0;}
  if(updateHash)history.replaceState(null,'','#'+panel);
  syncPanelButtons();render();
}
$('room-sheet').addEventListener('close',()=>{currentTab='room';history.replaceState(null,'','#room');syncPanelButtons();});
$('room-sheet').addEventListener('click',event=>{if(event.target!==$('room-sheet'))return;const r=$('room-sheet').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('room-sheet').close();});
const reactionScene=$('scene-home').querySelector('.room-scene').cloneNode(true);reactionScene.classList.remove('room-scene--world');reactionScene.classList.add('room-scene--preview');reactionScene.querySelector('[data-companion]').removeAttribute('data-companion');$('reaction-scene').append(reactionScene);
const speechBubble=createCompanionBubble(document.querySelector('.companion-bubble'));
roomMotion=createRoomMotion(document.querySelectorAll('[data-companion]'),{onPosition:point=>speechBubble.place(point)});
companionChat=createCompanionChat({getState:()=>state,canSpeak:()=>!document.hidden&&!document.querySelector('dialog[open]'),onMessage:message=>{activeChat=message;renderCompanionSpeech();}});
$('companion-chat-toggle').checked=companionChat.enabled;
$('companion-chat-toggle').addEventListener('change',event=>{companionChat.setEnabled(event.target.checked);});
const chatDialogObserver=new MutationObserver(()=>companionChat.refresh());
document.querySelectorAll('dialog').forEach(dialog=>chatDialogObserver.observe(dialog,{attributes:true,attributeFilter:['open']}));
$('pet-companion').addEventListener('click',()=>{const wasLonely=companionFeeling(state).id==='lonely';petCompanion(state);persist();render();greetDogs();showCompanionPraise(wasLonely?'おかえり。会いに来てくれて、うれしいな。':'きみの手、やさしいね。なでてくれて、ありがとう。');toast('こむぎが、うれしそうに寄ってきたよ。');});
$('reaction-open').addEventListener('click',()=>{previewReaction('happy');$('reaction-dialog').showModal();});
document.querySelector('.reaction-options').addEventListener('click',event=>{const button=event.target.closest('[data-reaction]');if(button)previewReaction(button.dataset.reaction);});

document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();switchTab('room');});window.addEventListener('hashchange',()=>switchTab(location.hash.slice(1),false));
$('habit-list').addEventListener('click',event=>{const button=event.target.closest('[data-habit]');if(!button)return;const previous=totals(state);if(!recordHabit(state,dateKey(),button.dataset.habit))return;persist();switchTab('room');greetDogs();showCompanionPraise(HABIT_PRAISE[button.dataset.habit]);const next=totals(state),beforeGrowth=growthForXP(previous.xp),afterGrowth=growthForXP(next.xp);if(afterGrowth.index>beforeGrowth.index){toast(`こむぎが${afterGrowth.stage.name}に成長したよ！いっしょに大きくなったね。`);}else{toast(next.level>previous.level?`こむぎが Lv. ${next.level} に育ったよ！ 10たねを集めたよ`:'10たねを集めたよ。小さな一歩に、花まる！');}});
$('shop-items').addEventListener('click',event=>{const button=event.target.closest('[data-item]');if(!button)return;const id=button.dataset.item,item=ITEMS.find(i=>i.id===id);if(state.owned.includes(id)){const decorated=state.decor.includes(id);state.decor=decorated?state.decor.filter(x=>x!==id):[...state.decor,id];persist();render();toast(decorated?'大切にしまっておいたよ。':`${item.name}を飾ったよ。`);}else if(buyItem(state,id)){persist();render();toast(`${item.name}が、おへやにやってきた！`);}});
$('mood-options').addEventListener('click',event=>{const button=event.target.closest('[data-mood]');if(!button)return;const mood=button.dataset.mood;dayForEdit().mood=mood;persist();render();toast('今日の気持ちを、そっと残したよ。');});
$('weight-open').addEventListener('click',()=>{const weight=today().weight;$('weight-value').value=weight??'';$('weight-error').textContent='';$('delete-weight').hidden=!Number.isFinite(weight);$('weight-dialog').dataset.date=dateKey();$('weight-dialog').showModal();});
$('weight-form').addEventListener('submit',event=>{event.preventDefault();if($('weight-dialog').dataset.date!==dateKey()){$('weight-dialog').close();render();toast('日付が変わったので、もう一度きろくを開いてね。');return;}const value=$('weight-value').valueAsNumber;if(!Number.isFinite(value)||value<1||value>500){$('weight-error').textContent='1〜500の範囲で、体重を入力してください。';return;}dayForEdit().weight=Math.round(value*10)/10;persist();render();$('weight-dialog').close();toast('今日のきろくを残したよ。');});
$('delete-weight').addEventListener('click',()=>{if($('weight-dialog').dataset.date===dateKey()&&state.days[dateKey()])delete state.days[dateKey()].weight;persist();render();$('weight-dialog').close();toast('今日の体重のきろくを削除したよ。');});
$('growth-open').addEventListener('click',()=>$('growth-dialog').showModal());
$('settings-open').addEventListener('click',()=>$('settings-dialog').showModal());document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('export-data').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`こつこつ日和-${dateKey()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('きろくのバックアップを保存したよ。');});
function refreshDate(){if(lastDate!==dateKey()){lastDate=dateKey();render();}else{renderCompanionFeeling();}companionChat.refresh();}window.addEventListener('focus',refreshDate);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDate();else companionChat.refresh();});setInterval(refreshDate,30000);
window.addEventListener('storage',event=>{if(event.key===CHAT_STORAGE||event.key===null){companionChat.sync();$('companion-chat-toggle').checked=companionChat.enabled;}});
window.addEventListener('storage',event=>{if(event.key!==STORAGE)return;try{const parsed=event.newValue===null?emptyState():JSON.parse(event.newValue);if(parsed?.version!==1)throw new Error('Unknown data version');state=normalizeState(parsed);loadFailed=false;render();toast('別のタブのきろくを反映しました。');}catch{loadFailed=true;$('storage-warning').hidden=false;$('storage-warning').textContent='別のタブのきろくを読み込めませんでした。元のデータは上書きしません。';}});
switchTab(location.hash.slice(1),false);
