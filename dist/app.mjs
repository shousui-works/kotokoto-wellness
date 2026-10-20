import {createPushSettings} from './push-settings.mjs?v=random-1';
import {createShelfPosition} from './shelf-position.mjs?v=1';
import {createPlushUI} from './plush-ui.mjs?v=daily-life-1';
import {createAccountClient} from './account-client.mjs?v=push-1';
const account=await createAccountClient();
const storage=account.storage;
import {createRoomMotion} from './companion-motion.mjs?v=stroke-pet-1';
import {bindCompanionPetting} from './companion-petting.mjs?v=1';
import {createCompanionBubble,speechPages} from './companion-bubble.mjs?v=keyboard-1';
import {createCompanionChat,CHAT_STORAGE,HABIT_PRAISE} from './companion-chat.mjs?v=idle-1';
import {createKomugiConversation} from './komugi-conversation.mjs?v=voice-auto-send-1';
import {createProgressUI} from './progress-ui.mjs?v=daily-life-1';
import {createRoomViewport} from './room-viewport.mjs?v=name-intro-1';
import {PROFILE_STORAGE,loadProfile,saveProfile,addressCompanionLine,createPetNameLabels} from './profile.mjs?v=names-2';
import {createNameIntro} from './name-intro.mjs?v=name-intro-1';
import {createIdleSpeech} from './companion-lines.mjs?v=idle-1';
import {createCompanionAffection} from './companion-affection.mjs?v=hearts-1';
import {createCompanionFaces} from './companion-face.mjs?v=face-1';
const updatePetLabels=createPetNameLabels();
let profile={version:1,nickname:'',petName:'こむぎ'};
const petName=()=>profile.petName||'こむぎ';
const petText=text=>text.replaceAll('こむぎ',()=>petName());
function readProfile(){try{profile=loadProfile(storage);}catch{profile={version:1,nickname:''};$('nickname-status').textContent='保存した名前を読み込めませんでした。元のデータは上書きしません。';}return profile;}
import {HABITS,ITEMS,MOODS,dateKey,emptyState,normalizeState,totals as baseTotals,recordHabit,buyItem,recentDays,GROWTH_STAGES,growthForXP,COMPANION_FEELINGS,affectionFor as baseAffectionFor,companionFeeling as baseCompanionFeeling,petCompanion} from './model.mjs?v=report-1';
let plushUI,roomMotion,roomFaces,roomAffection,companionChat,conversation,progress,nameIntro,activeNamePrompt=false,activeConversation=null,activeListening=false,activeChat=null,activePraise=null,praiseTimer;
const STORAGE='kotokoto-wellness-v1';const $=id=>document.getElementById(id);let state=emptyState(),loadFailed=false;try{const raw=storage.getItem(STORAGE);if(raw!==null){const parsed=JSON.parse(raw);if(parsed?.version!==1)throw new Error('Unknown data version');state=normalizeState(parsed);}}catch{loadFailed=true;$('storage-warning').hidden=false;$('storage-warning').textContent='保存済みのきろくを読み込めませんでした。元のデータは上書きしません。ブラウザの設定をご確認ください。';}let currentTab='room',lastDate=dateKey(),toastTimer;const today=()=>state.days[dateKey()]||{habits:[]};const dayForEdit=()=>state.days[dateKey()]??={habits:[]};
const totals=s=>{const t=baseTotals(s),xp=progress?.companion.xp??t.xp;return {...t,xp,level:Math.floor(xp/40)+1,progress:xp%40};};
const affectionFor=s=>baseAffectionFor(s,progress?.companion);
const companionFeeling=(s,now=new Date())=>baseCompanionFeeling(s,now,progress?.companion);
const idleSpeech=createIdleSpeech();
function persist(){if(account.enabled&&account.user)throw Error('クラウドの保存操作が必要です。');if(loadFailed)return;try{storage.setItem(STORAGE,JSON.stringify(state));$('storage-warning').hidden=true;}catch{$('storage-warning').textContent='このブラウザに保存できません。きろくは画面を閉じると消えるため、設定からバックアップしてください。';$('storage-warning').hidden=false;}}
async function cloudSave(command,revision){try{await account.command(command,revision===undefined?{}:{revision});return true;}catch(error){toast(error.message);return false;}}
function toast(message){const host=[...document.querySelectorAll('dialog[open]')].at(-1)||document.body;host.append($('toast'));$('toast').textContent=petText(message);$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3600);}
function formatDate(key,options={month:'numeric',day:'numeric'}){return new Intl.DateTimeFormat('ja-JP',options).format(new Date(key+'T12:00:00'));}
function roomDecor(){document.querySelectorAll('.room-items').forEach(el=>{el.replaceChildren(...state.decor.map(id=>{const item=ITEMS.find(i=>i.id===id);const span=document.createElement('span');span.className=id;span.textContent=item.icon;return span;}));});document.querySelectorAll('.room-scene').forEach(el=>el.setAttribute('aria-label',`ポメラニアンの${petName()}（${growthForXP(totals(state).xp).stage.name}）のお部屋。${state.decor.length?state.decor.map(id=>ITEMS.find(i=>i.id===id).name).join('、')+'を飾っています。':'小さなできたを集めて、好きなものを飾れます。'}`));}
function renderHabits(){const completed=today().habits;$('done-count').textContent=completed.length;$('dock-count').textContent=completed.length+'/4';$('habit-list').innerHTML=HABITS.map(h=>`<article class="habit ${completed.includes(h.id)?'is-done':''}"><span class="habit-emoji" aria-hidden="true">${h.icon}</span><div class="habit-text"><h3>${h.title}</h3><p>${h.detail}</p></div><button data-habit="${h.id}" ${completed.includes(h.id)?'disabled':''} aria-label="${h.title}：${completed.includes(h.id)?'記録済み':'できたを記録'}">${completed.includes(h.id)?'✓ できた':'できた ＋'}</button></article>`).join('');}
function renderWeek(){let count=0;$('week-dots').innerHTML=recentDays().map(key=>{const n=state.days[key]?.habits.length||0;count+=n;const isToday=key===dateKey();return `<div class="week-day ${isToday?'today':''}" aria-label="${formatDate(key)}、${n}個のできた${isToday?'、今日':''}"><span>${formatDate(key,{weekday:'short'})}</span><span class="day-flower ${n?'active':''}" aria-hidden="true" style="${n?'opacity:'+(.55+n*.1125):''}">${n?'✳':'·'}</span><span class="day-date">${formatDate(key)}</span><span class="day-score">${n?n+'こできた':isToday?'きょう':'—'}</span></div>`;}).join('');$('week-total').textContent=`${count}この「できた」`;}
function renderShop(){const balance=totals(state).seeds;$('shop-items').innerHTML=ITEMS.map(item=>{const owned=state.owned.includes(item.id),decorated=state.decor.includes(item.id);return `<article class="shop-item"><span aria-hidden="true">${item.icon}</span><h4>${item.name}</h4><button data-item="${item.id}" ${owned?'aria-pressed="'+decorated+'"':''} ${!owned&&balance<item.cost?'disabled':''} aria-label="${item.name}：${owned?(decorated?'しまう':'飾る'):item.cost+'たねで交換'}">${owned?(decorated?'✓ 飾っている':'おへやに飾る'):'✦ '+item.cost+' たね'}</button></article>`;}).join('');}
function renderWeights(){const weights=Object.entries(progress?.weights(state)??state.days).filter(([,day])=>Number.isFinite(day.weight)).sort(([a],[b])=>a.localeCompare(b));const latest=weights.at(-1);$('latest-weight').innerHTML=latest?`${latest[1].weight.toFixed(1)} <span>kg · ${formatDate(latest[0])}</span>`:'— <span>kg</span>';if(weights.length<2){$('weight-chart').innerHTML='<p>'+(weights.length?'はじめのきろくができました。<br>2日分たまると、変化が線で見られます。':'まだ、きろくはありません。<br>はじめたい日に、ひとつから。')+'</p>';return;}const values=weights.slice(-30);const W=400,H=150,left=45,right=17,top=18,bottom=30;const rawMin=Math.min(...values.map(([,d])=>d.weight)),rawMax=Math.max(...values.map(([,d])=>d.weight));const pad=Math.max((rawMax-rawMin)*.2,.5),min=rawMin-pad,max=rawMax+pad;const firstTime=new Date(values[0][0]+'T12:00:00').getTime(),lastTime=new Date(values.at(-1)[0]+'T12:00:00').getTime();const x=key=>left+(new Date(key+'T12:00:00').getTime()-firstTime)/(lastTime-firstTime)*(W-left-right),y=value=>top+(max-value)/(max-min)*(H-top-bottom);const points=values.map(([key,d])=>`${x(key)},${y(d.weight)}`).join(' ');const summary=values.map(([key,d])=>`${formatDate(key)} ${d.weight.toFixed(1)}kg`).join('、');$('weight-chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最近の体重の記録。${summary}"><line x1="${left}" y1="${top}" x2="${W-right}" y2="${top}" stroke="#e4e6dc"/><line x1="${left}" y1="${H-bottom}" x2="${W-right}" y2="${H-bottom}" stroke="#e4e6dc"/><text x="0" y="${top+4}" fill="#777b6c" font-size="12">${max.toFixed(1)}</text><text x="0" y="${H-bottom+4}" fill="#777b6c" font-size="12">${min.toFixed(1)}</text><polyline fill="none" stroke="#7f916c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}"/>${values.map(([key,d])=>`<circle cx="${x(key)}" cy="${y(d.weight)}" r="3" fill="#58714b"/>`).join('')}<text x="${left}" y="${H-5}" fill="#777b6c" font-size="12">${formatDate(values[0][0])}</text><text x="${W-right}" y="${H-5}" fill="#777b6c" font-size="12" text-anchor="end">${formatDate(values.at(-1)[0])}</text></svg><p class="privacy-note">${formatDate(values[0][0])}〜${formatDate(values.at(-1)[0])} · 最近${values.length}回のきろく</p>`;}
function renderHistory(){const entries=Object.entries(state.days).filter(([,day])=>day.habits.length||day.mood||Number.isFinite(day.weight)).sort(([a],[b])=>b.localeCompare(a)).slice(0,14);if(!entries.length){$('history-list').innerHTML='<p class="empty-history">これから、あなたの<br>「できた」がならびます。<br>今日の小さな一歩から。</p>';return;}$('history-list').innerHTML=entries.map(([key,d])=>`<article class="history-entry"><div><span>${formatDate(key,{month:'long',day:'numeric',weekday:'short'})}</span><span>${d.habits.length}この「できた」</span></div><p>${d.habits.length?d.habits.map(id=>HABITS.find(h=>h.id===id).icon).join(' '):'ゆっくり、わたしのペースで。'}${d.mood?' · '+MOODS[d.mood]:''}${Number.isFinite(d.weight)?' · '+d.weight.toFixed(1)+' kg':''}</p></article>`).join('');}
function renderGrowth(xp){
  $('scene-home').querySelector('.dog-pet-touch')?.setAttribute('aria-label',petName()+'をなでる');
  const g=growthForXP(xp);
  document.querySelectorAll('[data-companion]').forEach(el=>{el.classList.remove(...GROWTH_STAGES.map(stage=>'dog--'+stage.id));el.classList.add('dog--'+g.stage.id);el.dataset.stage=g.stage.id;});
  $('stage-name').textContent=g.stage.name;$('room-stage-name').textContent=g.stage.name;
  $('growth-label').textContent=g.next?petName()+'の成長':'次のレベルへ';
  $('growth-text').textContent=`${g.progress} / ${g.max}`;
  $('growth-progress').max=g.max;$('growth-progress').value=g.progress;
  $('growth-progress').setAttribute('aria-label',g.next?`${g.next.name}への成長の経験値`:'次のレベルまでの経験値');
  const message=g.next?`あと${g.max-g.progress}えらいポイントで、${g.next.name}に。`:'おとなになっても、いっしょに一歩ずつ。';
  $('growth-next').textContent=message;$('room-growth-next').textContent=message;
  document.querySelectorAll('[data-growth-stage]').forEach(el=>{const index=GROWTH_STAGES.findIndex(stage=>stage.id===el.dataset.growthStage);el.classList.toggle('is-current',index===g.index);el.querySelector('[data-stage-status]').textContent=index===g.index?'いまの'+petName():index<g.index?'ここまで育ったよ':'これからのお楽しみ';});
}
function applyFeeling(dog,feeling,bonded=false){
  dog.classList.remove(...Object.keys(COMPANION_FEELINGS).map(id=>'feeling-'+id));
  dog.classList.add('feeling-'+feeling.id);dog.classList.toggle('dog--attached',bonded);
}
function renderCompanionSpeech(feeling=companionFeeling(state)){
  const speech=activeConversation??(activeListening?{label:'お返事を考え中',text:'…'}:null)??(activeNamePrompt?{label:'はじめまして',text:'ぼくはこむぎ。きみのこと、なんて呼んだらいい？'}:null)??activePraise??activeChat;
  const idle=!speech?idleSpeech.line({feeling,score:affectionFor(state).score,rotate:!document.hidden&&!document.querySelector('dialog[open]')&&!conversation?.isInteracting&&(companionChat?.enabled??true)}):null;
  const label=speech?.label??feeling.label,rawMessage=speech?.text??idle?.text??feeling.lines[0];
  const message=activeConversation||activeListening?rawMessage:addressCompanionLine(petText(rawMessage),profile.nickname);
  const changed=$('companion-message').textContent!==message,bubble=document.querySelector('.companion-bubble');
  if($('companion-feeling').textContent!==label)$('companion-feeling').textContent=label;
  $('companion-feeling').dataset.feeling=feeling.id;
  if($('companion-message').textContent!==message)$('companion-message').textContent=message;
  bubble.classList.toggle('is-chatting',Boolean(speech));
  bubble.classList.toggle('is-conversation',Boolean(activeConversation||activeNamePrompt));
  bubble.disabled=activeListening;
  const hint=$('companion-speech-hint');hint.hidden=!activeConversation;
  if(activeConversation){
    const {pages,index}=activeConversation;
    hint.textContent=index<pages.length-1?`${index+1} / ${pages.length} · タップでつづき`:'タップで読み終わる';
    bubble.title=hint.textContent;bubble.removeAttribute('aria-haspopup');bubble.removeAttribute('aria-controls');bubble.removeAttribute('aria-expanded');
  }else{bubble.title=petName()+'のようすを見る';bubble.setAttribute('aria-haspopup','dialog');bubble.setAttribute('aria-controls','room-sheet');bubble.setAttribute('aria-expanded',String(currentTab==='companion'));}
  if(activeNamePrompt&&!activeConversation){bubble.title='呼ばれたい名前を教える';bubble.removeAttribute('aria-haspopup');bubble.removeAttribute('aria-expanded');bubble.setAttribute('aria-controls','name-intro-form');}
  if(changed){if(speech&&!activeListening)roomAffection?.speak(affectionFor(state).score);if(activeConversation||activeNamePrompt)roomFaces?.speak(message);bubble.classList.remove('speech-arriving');requestAnimationFrame(()=>bubble.classList.add('speech-arriving'));}
}
function showCompanionPraise(text){
  companionChat.interrupt();clearTimeout(praiseTimer);
  activePraise={label:'こむぎからの花まる',text};renderCompanionSpeech();
  praiseTimer=setTimeout(()=>{activePraise=null;renderCompanionSpeech();},12000);
}
function clearConversationSpeech(){
  roomAffection?.clear();
  activeListening=false;activeConversation=null;roomMotion?.setSpeaking(false);renderCompanionSpeech();companionChat?.refresh();
}
function approachForConversation(){
  roomAffection?.clear();
  roomFaces?.quiet();
  activeListening=true;activeConversation=null;clearTimeout(praiseTimer);activePraise=null;
  companionChat.interrupt();renderCompanionSpeech();return roomMotion?.approachConversation();
}
function showConversationReply(text){
  activeListening=false;clearTimeout(praiseTimer);activePraise=null;
  const pages=speechPages(text,$('scene-home').clientHeight<=600?60:100);
  activeConversation={label:'きみへのお返事',pages,index:0,text:pages[0]};
  roomMotion?.setSpeaking(true);companionChat.interrupt();renderCompanionSpeech();
}
function renderCompanionFeeling(){
  const feeling=companionFeeling(state),affection=affectionFor(state);
  renderCompanionSpeech(feeling);
  $('affection-score').textContent=affection.score;$('affection-label').textContent=affection.label;$('affection-progress').value=affection.score;
  document.querySelectorAll('[data-companion]').forEach(dog=>{
    applyFeeling(dog,feeling,affection.score>=50);
    const scene=dog.closest('.room-scene');
    const decor=state.decor.map(id=>ITEMS.find(item=>item.id===id).name).join('、');
    scene.setAttribute('aria-label',`ポメラニアンの${petName()}（${growthForXP(totals(state).xp).stage.name}）。${feeling.label}。${decor?decor+'を飾ったお部屋。':''}`);
  });
}
function greetDogs(){clearConversationSpeech();roomMotion?.greet();}
function previewReaction(id){
  const feeling=COMPANION_FEELINGS[id];if(!feeling)return;
  const dog=$('reaction-scene').querySelector('.dog'),stage=growthForXP(totals(state).xp).stage;
  dog.classList.remove(...GROWTH_STAGES.map(s=>'dog--'+s.id),'greet');dog.classList.add('dog--'+stage.id);
  applyFeeling(dog,feeling,id==='happy');
  $('reaction-status').textContent=feeling.label;$('reaction-message').textContent=feeling.lines.join('\n');
  $('reaction-scene').querySelector('.room-scene').setAttribute('aria-label',`${petName()}の反応のおためし。${feeling.label}。`);
  document.querySelectorAll('[data-reaction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.reaction===id)));
  if(id!=='lonely'){void dog.offsetWidth;dog.classList.add('greet');}
}
function renderMemory(){const memory=account.state?.memory;$('memory-details').hidden=!account.user||!account.state?.initialized;$('owner-memory').textContent=memory?.summary||'まだ記憶はありません。';$('memory-through').textContent=memory?.throughDate?memory.throughDate+'までのおはなしを覚えています。':'日付が変わった後の最初の会話で、前日までのおはなしをまとめます。';}
$('memory-reset').addEventListener('click',async()=>{if(!confirm('会話から覚えたことをリセットしますか？ 過去のおはなしから自動で覚え直すことはありません。行動の記録は残ります。'))return;if(await cloudSave({type:'reset_memory'}))toast('覚えていたことをリセットしたよ。');});
function render(){plushUI?.render();renderMemory();updatePetLabels(petName());const t=totals(state);$('balance').textContent=t.seeds;$('level').textContent=`Lv. ${t.level}`;renderGrowth(t.xp);$('date-label').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());renderHabits();renderWeek();renderShop();roomDecor();renderCompanionFeeling();renderWeights();renderHistory();document.querySelectorAll('[data-mood]').forEach(button=>button.setAttribute('aria-pressed',String(today().mood===button.dataset.mood)));progress?.render();roomMotion?.refresh();}
const PANEL_TITLES={plush:['LITTLE FRIENDS','ぬいぐるみ'],today:['LITTLE THINGS COUNT','今日のえらい'],decorate:['MAKE A LITTLE HOME','おへやのもようがえ'],records:['YOUR OWN RHYTHM','わたしのきろく'],companion:['MY LITTLE PARTNER','こむぎのようす']};
function syncPanelButtons(){document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-expanded',String($('room-sheet').open&&button.dataset.tab===currentTab)));}
function switchTab(tab,updateHash=true){
  if(tab==='talk')tab='room';
  const panel=Object.hasOwn(PANEL_TITLES,tab)?tab:'room';
  currentTab=panel;
  $('room-sheet').dataset.panel=panel;
  document.querySelectorAll('.tab-view').forEach(el=>el.hidden=el.id!==panel);
  if(panel==='room'){$('room-sheet').close();}
  else{[$('sheet-eyebrow').textContent,$('sheet-title').textContent]=PANEL_TITLES[panel].map(petText);if(!$('room-sheet').open)$('room-sheet').showModal();$('room-sheet').scrollTop=0;}
  if(updateHash)history.replaceState(null,'','#'+panel);
  syncPanelButtons();render();
}
$('room-sheet').addEventListener('close',()=>{currentTab='room';history.replaceState(null,'','#room');syncPanelButtons();renderCompanionSpeech();});
document.querySelector('.companion-bubble').addEventListener('click',()=>{
  if(activeNamePrompt&&!activeConversation){nameIntro.focus();return;}
  if(!activeConversation){switchTab('companion');return;}
  if(activeConversation.index+1===activeConversation.pages.length){clearConversationSpeech();return;}
  activeConversation.text=activeConversation.pages[++activeConversation.index];renderCompanionSpeech();
});
$('room-sheet').addEventListener('click',event=>{if(event.target!==$('room-sheet'))return;const r=$('room-sheet').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('room-sheet').close();});
const reactionScene=$('scene-home').querySelector('.room-scene').cloneNode(true);reactionScene.classList.remove('room-scene--world');reactionScene.classList.add('room-scene--preview');reactionScene.querySelector('[data-companion]').removeAttribute('data-companion');$('reaction-scene').append(reactionScene);
const speechBubble=createCompanionBubble(document.querySelector('.companion-bubble'));
roomMotion=createRoomMotion(document.querySelectorAll('[data-companion]'),{onPosition:point=>speechBubble.place({...point,viewportTop:$('scene-home').getBoundingClientRect().top}),getBottomInset:()=>Math.max(0,$('scene-home').getBoundingClientRect().bottom-$('room-console').getBoundingClientRect().top)});
roomFaces=createCompanionFaces(document.querySelectorAll('[data-companion]'));
roomAffection=createCompanionAffection(document.querySelectorAll('[data-companion]'));
$('room-play-tools').append($('scene-home').querySelector('.room-controls'));
const roomTools=$('room-tools');
roomTools.addEventListener('click',event=>{if(event.target.closest('button'))roomTools.open=false;});
roomTools.addEventListener('toggle',()=>companionChat?.refresh());
document.addEventListener('click',event=>{if(!roomTools.contains(event.target))roomTools.open=false;});
roomTools.addEventListener('keydown',event=>{if(event.key==='Escape'){roomTools.open=false;roomTools.querySelector('summary').focus();}});
companionChat=createCompanionChat({storage,getState:()=>state,canSpeak:()=>!activeNamePrompt&&!activeConversation&&!conversation?.isInteracting&&!roomTools.open&&!document.hidden&&!document.querySelector('dialog[open]'),onMessage:message=>{activeChat=message;renderCompanionSpeech();}});
$('companion-chat-toggle').checked=companionChat.enabled;
$('companion-chat-toggle').addEventListener('change',async event=>{if(account.enabled&&account.user){if(!await cloudSave({type:'chat_setting',enabled:event.target.checked})){event.target.checked=account.state?.chatEnabled!==false;return;}}companionChat.setEnabled(event.target.checked);});
const chatDialogObserver=new MutationObserver(()=>companionChat.refresh());
document.querySelectorAll('dialog').forEach(dialog=>chatDialogObserver.observe(dialog,{attributes:true,attributeFilter:['open']}));
const liveDog=$('scene-home').querySelector('[data-companion]');
liveDog.removeAttribute('aria-hidden');
const petTouch=document.createElement('button');
petTouch.type='button';petTouch.className='dog-pet-touch';
liveDog.append(petTouch);
function updatePetLabel(){petTouch.setAttribute('aria-label',petName()+'をなでる');}
updatePetLabel();
let petting=false;
async function strokeCompanion(direct=false){
  if(petting)return;
  petting=true;
  try{
    const wasLonely=companionFeeling(state).id==='lonely';
    if(account.enabled&&account.user){if(!await cloudSave({type:'pet'}))return;}
    else{petCompanion(state);persist();}
    render();updatePetLabel();
    // A touch must not dismiss an unread reply or interrupt the pending answer.
    if(direct&&(activeConversation||activeListening||activeNamePrompt)){
      roomAffection?.speak(affectionFor(state).score);
    }else{
      if(!direct)greetDogs();
      showCompanionPraise(wasLonely?'おかえり。会いに来てくれて、うれしいな。':'きみの手、やさしいね。なでてくれて、ありがとう。');
    }
    if(!direct)toast('こむぎが、うれしそうに寄ってきたよ。');
  }finally{petting=false;}
}
const petTrail=document.createElement('span');petTrail.className='petting-trail';petTrail.textContent='♡';petTrail.setAttribute('aria-hidden','true');petTouch.append(petTrail);
let lastPetHeart=0;
bindCompanionPetting(petTouch,{
  onHold:value=>roomMotion.setPetting(value),
  onMove:({x,y})=>{
    liveDog.classList.add('is-being-petted');
    liveDog.style.setProperty('--pet-tilt',((x-.5)*5).toFixed(2)+'deg');
    petTouch.style.setProperty('--pet-x',(x*100)+'%');petTouch.style.setProperty('--pet-y',(y*100)+'%');
    const now=performance.now();if(now-lastPetHeart>900){lastPetHeart=now;roomAffection?.speak(affectionFor(state).score);}
  },
  onEnd:()=>{liveDog.classList.remove('is-being-petted');liveDog.style.removeProperty('--pet-tilt');},
  onPet:()=>strokeCompanion(true),
});
$('pet-companion').addEventListener('click',()=>strokeCompanion());
$('reaction-open').addEventListener('click',()=>{previewReaction('happy');$('reaction-dialog').showModal();});
document.querySelector('.reaction-options').addEventListener('click',event=>{const button=event.target.closest('[data-reaction]');if(button)previewReaction(button.dataset.reaction);});

document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();switchTab('room');});window.addEventListener('hashchange',()=>switchTab(location.hash.slice(1),false));
$('habit-list').addEventListener('click',async event=>{const button=event.target.closest('[data-habit]');if(!button)return;const previous=totals(state);if(account.enabled&&account.user){if(!await cloudSave({type:'habit',habit:button.dataset.habit,date:dateKey()}))return;}else{if(!recordHabit(state,dateKey(),button.dataset.habit))return;persist();await progress?.manual(({stretch:'stretch',meal:'eating_habit',rest:'rest',walk:'walk'})[button.dataset.habit],dateKey(),HABITS.find(h=>h.id===button.dataset.habit).title);}switchTab('room');greetDogs();showCompanionPraise(HABIT_PRAISE[button.dataset.habit]);const next=totals(state),beforeGrowth=growthForXP(previous.xp),afterGrowth=growthForXP(next.xp);toast(afterGrowth.index>beforeGrowth.index?`こむぎが${afterGrowth.stage.name}に成長したよ！`:'小さな一歩に、花まる！');});
$('shop-items').addEventListener('click',async event=>{const button=event.target.closest('[data-item]');if(!button)return;const id=button.dataset.item,item=ITEMS.find(i=>i.id===id),owned=state.owned.includes(id),decorated=state.decor.includes(id);if(account.enabled&&account.user){if(!await cloudSave({type:'item',id}))return;}else if(owned){state.decor=decorated?state.decor.filter(x=>x!==id):[...state.decor,id];persist();}else if(buyItem(state,id))persist();else return;render();toast(owned?(decorated?'大切にしまっておいたよ。':`${item.name}を飾ったよ。`):`${item.name}が、おへやにやってきた！`);});
$('mood-options').addEventListener('click',async event=>{const button=event.target.closest('[data-mood]');if(!button)return;const mood=button.dataset.mood;if(account.enabled&&account.user){if(!await cloudSave({type:'mood',mood,date:dateKey()}))return;}else{dayForEdit().mood=mood;persist();await progress?.manual('mood_log',dateKey(),'気分を記録した',{detail:MOODS[mood]});}render();toast('今日の気持ちを、そっと残したよ。');});
$('weight-open').addEventListener('click',()=>{const weight=(progress?.weights(state)??state.days)[dateKey()]?.weight;$('weight-value').value=weight??'';$('weight-error').textContent='';$('delete-weight').hidden=!Number.isFinite(weight);$('weight-dialog').dataset.date=dateKey();$('weight-dialog').dataset.revision=account.state?.revision??'';$('weight-dialog').showModal();});
$('weight-form').addEventListener('submit',async event=>{event.preventDefault();if($('weight-dialog').dataset.date!==dateKey()){$('weight-dialog').close();render();toast('日付が変わったので、もう一度きろくを開いてね。');return;}const value=$('weight-value').valueAsNumber;if(!Number.isFinite(value)||value<1||value>500){$('weight-error').textContent='1〜500の範囲で、体重を入力してください。';return;}if(account.enabled&&account.user){if(!await cloudSave({type:'weight',date:dateKey(),value},Number($('weight-dialog').dataset.revision)))return;}else{dayForEdit().weight=Math.round(value*10)/10;persist();await progress?.manual('weight',dateKey(),'体重を記録した',{weightKg:dayForEdit().weight});}render();$('weight-dialog').close();toast('今日のきろくを残したよ。');});
$('delete-weight').addEventListener('click',async()=>{if($('weight-dialog').dataset.date!==dateKey())return;if(account.enabled&&account.user){if(!await cloudSave({type:'remove_weight',date:dateKey()},Number($('weight-dialog').dataset.revision)))return;}else{if(state.days[dateKey()])delete state.days[dateKey()].weight;persist();await progress?.removeWeights(dateKey());}render();$('weight-dialog').close();toast('今日の体重のきろくを削除したよ。');});
$('growth-open').addEventListener('click',()=>$('growth-dialog').showModal());
$('settings-open').addEventListener('click',()=>{$('nickname-value').value=readProfile().nickname;$('pet-name-value').value=petName();$('nickname-form').dataset.revision=account.state?.revision??'';$('settings-dialog').showModal();});document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('nickname-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{if(account.enabled&&account.user){await account.command({type:'profile',nickname:$('nickname-value').value,petName:$('pet-name-value').value,namesConfigured:true},{revision:Number($('nickname-form').dataset.revision)});profile=readProfile();$('nickname-form').dataset.revision=account.state.revision;}else profile=saveProfile(storage,$('nickname-value').value,$('pet-name-value').value);$('nickname-value').value=profile.nickname;$('nickname-status').textContent=profile.nickname?`「${profile.nickname}」で覚えたよ。`:'呼び方を「きみ」に戻したよ。';if(profile.nickname)nameIntro?.refresh();else nameIntro?.show();render();renderCompanionSpeech();}
  catch(error){$('nickname-status').textContent=['QuotaExceededError','SecurityError'].includes(error.name)?'このブラウザに名前を保存できませんでした。':error.message;}
});
readProfile();
window.addEventListener('storage',event=>{if(event.key===PROFILE_STORAGE||event.key===null){readProfile();if(profile.nickname)nameIntro?.refresh();else nameIntro?.show();renderCompanionSpeech();}});
$('export-data').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({...state,profile:readProfile(),progress:progress?.exportData()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`こつこつ日和-${dateKey()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('きろくのバックアップを保存したよ。');});
function refreshDate(){if(lastDate!==dateKey()){lastDate=dateKey();render();}else{renderCompanionFeeling();}companionChat.refresh();}window.addEventListener('focus',refreshDate);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDate();else companionChat.refresh();});setInterval(refreshDate,30000);
window.addEventListener('storage',event=>{if(event.key===CHAT_STORAGE||event.key===null){companionChat.sync();$('companion-chat-toggle').checked=companionChat.enabled;}});
window.addEventListener('storage',event=>{if(account.enabled&&account.user)return;if(event.key!==STORAGE)return;try{const parsed=event.newValue===null?emptyState():JSON.parse(event.newValue);if(parsed?.version!==1)throw new Error('Unknown data version');state=normalizeState(parsed);loadFailed=false;render();toast('別のタブのきろくを反映しました。');}catch{loadFailed=true;$('storage-warning').hidden=false;$('storage-warning').textContent='別のタブのきろくを読み込めませんでした。元のデータは上書きしません。';}});
plushUI=createPlushUI({account,openPanel:()=>switchTab('plush'),toast,getPetName:petName,getStage:()=>growthForXP(totals(state).xp).stage.id});
createShelfPosition({shelf:$('plush-shelf'),scene:$('scene-home'),backdrop:$('scene-home').querySelector('.room-backdrop')});
progress=createProgressUI({storage,account,getState:()=>state,onChange:()=>render(),onContinue:activity=>{switchTab('room');conversation?.focus(activity.title);},onError:message=>toast(message)});
conversation=createKomugiConversation({root:$('talk'),storage,fetchImpl:account.fetch,cloud:account.enabled&&!!account.user,getPetName:petName,pendingStore:account.pendingConversation,onClearHistory:()=>account.clearHistory?.(),getContext:()=>({date:dateKey(),hour:new Date().getHours(),stage:growthForXP(totals(state).xp).stage.id,nickname:readProfile().nickname,petName:petName(),...progress.context()}),onReply:showConversationReply,onSend:approachForConversation,onFailure:clearConversationSpeech,onResult:(result,text,context)=>account.enabled&&account.user?({reply:result.reply,receipts:result.receipts??[]}):progress.handleReport(result,text,context),onInteraction:active=>{if(active)companionChat.interrupt();else companionChat.refresh();},onClearTarget:()=>progress.clearTarget()});
new ResizeObserver(()=>roomMotion.refresh()).observe($('room-console'));
nameIntro=createNameIntro({form:$('name-intro-form'),chatForm:$('conversation-form'),input:$('name-intro-value'),later:$('name-intro-later'),status:$('name-intro-status'),getNickname:()=>readProfile().nickname,saveNickname:name=>account.enabled&&account.user?account.command({type:'profile',nickname:name}).then(()=>{profile=readProfile();}):(()=>{profile=saveProfile(storage,name);})(),onPrompt:()=>{activeNamePrompt=true;companionChat.interrupt();roomMotion.approachConversation();renderCompanionSpeech();},onComplete:name=>{activeNamePrompt=false;Promise.resolve(approachForConversation()).then(()=>showConversationReply(`${name}って呼ぶね。教えてくれてうれしいな。これからよろしくね！`));},onCancel:()=>{activeNamePrompt=false;roomMotion.setSpeaking(false);renderCompanionSpeech();companionChat.refresh();}});
createRoomViewport({input:$('conversation-input'),extraInputs:[$('name-intro-value')],onChange:({height})=>{
  if(height<=600&&activeConversation&&Array.from(activeConversation.text).length>60){
    const {pages,index}=activeConversation;
    pages.splice(index,pages.length-index,...speechPages(pages.slice(index).join(''),60));
    activeConversation.text=pages[index];renderCompanionSpeech();
  }
  requestAnimationFrame(()=>roomMotion.refresh());
}});
if(account.enabled)account.subscribe(()=>{if(account.user){state=account.state?normalizeState(account.state.legacy):emptyState();readProfile();progress.reload();conversation.reload();companionChat.sync();$('companion-chat-toggle').checked=account.state?.chatEnabled!==false;render();}});
conversation.open();
switchTab(account.needsSetup?'room':location.hash.slice(1),false);
if(!account.needsSetup)nameIntro.show();

// Discover access through the authenticated server; hiding a link is not authorization.
async function discoverAdmin(){const link=$('admin-open');if(!link)return;link.hidden=true;if(!account.user)return;try{const r=await account.fetch('/api/admin/session');const data=await r.json();link.hidden=!(r.ok&&data.admin===true);}catch{}}
void discoverAdmin();

createPushSettings({account});
