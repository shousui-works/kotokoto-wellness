import {dateKey} from './model.mjs';

export const CHAT_STORAGE='kotokoto-companion-chat-v1';
export const CHAT_TIMING=Object.freeze({first:12000,duration:16000,reaction:30000,minGap:240000,maxGap:420000});
const PERIODS={
  morning:{label:'朝のひとこと',lines:[
    'おはよう。今日はどんな日にしようか？',
    '朝ののび〜、いっしょにしない？',
    '今日も、きみのペースでいこうね。'
  ]},
  noon:{label:'お昼のひとこと',lines:[
    'お昼だね。ごはん、ゆっくり食べられた？',
    'ちょっとひと息。ぼくも、となりで休もうかな。',
    '午後も、のんびりいっしょにいこう。'
  ]},
  afternoon:{label:'午後のひとこと',lines:[
    'そろそろ、ひと息つかない？ いっしょにのび〜。',
    'きみは今、なにしてるの？ ぼくはおさんぽ中。',
    'ちょっとだけ、ぼくとぼんやりしようよ。'
  ]},
  evening:{label:'夕方のひとこと',lines:[
    '今日もがんばった？ ここでひと息つこう。',
    'おかえり。今日、どんなことがあった？',
    'たくさん動いた日も、休んだ日も。会えてうれしいな。'
  ]},
  night:{label:'夜のひとこと',lines:[
    '今日もおつかれさま。そろそろ、のんびりしよう。',
    'もう遅いね。今日はゆっくり休もうね。',
    '今日のできたは、小さくても花まるだよ。'
  ]}
};

export function conversationPeriod(now=new Date()){
  const hour=now.getHours();
  if(hour<5||hour>=21)return 'night';
  if(hour<11)return 'morning';
  if(hour<14)return 'noon';
  if(hour<17)return 'afternoon';
  return 'evening';
}

export function companionChatLine(state,now=new Date(),previous={},random=Math.random){
  const period=conversationPeriod(now),key=dateKey(now)+':'+period,group=PERIODS[period];
  const lines=group.lines.map((text,index)=>({id:period+'-'+index,text}));
  const day=state.days?.[dateKey(now)];
  if(day?.habits?.length)lines.push({id:period+'-progress',text:'今日の「できた」、見つけたね。ぼくもうれしい！'});
  if(day?.mood==='slow')lines.push({id:period+'-slow',text:'今日はのんびりの日だね。ここで、いっしょに休もう。'});
  const candidates=lines.filter(line=>line.id!==previous.lastId);
  const index=Math.min(candidates.length-1,Math.max(0,Math.floor(random()*candidates.length)));
  const line=previous.lastPeriodKey===key?candidates[index]:lines[0];
  return {...line,label:group.label,periodKey:key};
}

function readMemory(storage,stamp){
  const memory={version:1,enabled:true};
  try{
    const value=JSON.parse(storage?.getItem(CHAT_STORAGE)??'null');
    if(value?.version!==1)return memory;
    memory.enabled=value.enabled!==false;
    if(typeof value.lastId==='string')memory.lastId=value.lastId;
    if(typeof value.lastPeriodKey==='string')memory.lastPeriodKey=value.lastPeriodKey;
    if(Number.isFinite(value.lastSpokenAt)&&value.lastSpokenAt<=stamp&&value.lastSpokenAt>0){
      memory.lastSpokenAt=value.lastSpokenAt;
      if(Number.isFinite(value.nextTalkAt)&&value.nextTalkAt>=value.lastSpokenAt+CHAT_TIMING.minGap&&value.nextTalkAt<=value.lastSpokenAt+CHAT_TIMING.maxGap)memory.nextTalkAt=value.nextTalkAt;
    }
  }catch{/* Chatter can stay in memory if browser storage is unavailable. */}
  return memory;
}

export function createCompanionChat({getState,canSpeak,onMessage,storage,random=Math.random,clock={now:()=>Date.now(),setTimeout:(callback,delay)=>setTimeout(callback,delay),clearTimeout:id=>clearTimeout(id)}}){
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  let memory=readMemory(storage,clock.now()),nextAt=Math.max(clock.now()+CHAT_TIMING.first,memory.nextTalkAt||0);
  let timer=0,expiry=0,active=false,destroyed=false;
  const cancel=()=>{clock.clearTimeout(timer);timer=0;};
  const save=()=>{try{storage?.setItem(CHAT_STORAGE,JSON.stringify(memory));}catch{}};
  const hide=()=>{
    clock.clearTimeout(expiry);expiry=0;
    if(active){active=false;onMessage(null);}
  };
  function refresh(){
    cancel();
    if(destroyed||!memory.enabled||!canSpeak()){hide();return;}
    timer=clock.setTimeout(speak,Math.max(0,nextAt-clock.now()));
  }
  function speak(){
    timer=0;
    if(destroyed||!memory.enabled||!canSpeak()){hide();return;}
    const stamp=clock.now(),shared=readMemory(storage,stamp);
    if(shared.nextTalkAt>stamp){nextAt=Math.max(nextAt,shared.nextTalkAt);refresh();return;}
    if(stamp<nextAt){refresh();return;}
    const line=companionChatLine(getState(),new Date(stamp),memory,random);
    nextAt=stamp+CHAT_TIMING.minGap+Math.floor(random()*(CHAT_TIMING.maxGap-CHAT_TIMING.minGap));
    memory={...memory,lastId:line.id,lastPeriodKey:line.periodKey,lastSpokenAt:stamp,nextTalkAt:nextAt};
    save();hide();active=true;onMessage(line);
    expiry=clock.setTimeout(hide,CHAT_TIMING.duration);
    refresh();
  }
  refresh();
  return {
    get enabled(){return memory.enabled;},
    refresh,
    interrupt(){hide();nextAt=Math.max(nextAt,clock.now()+CHAT_TIMING.reaction);refresh();},
    setEnabled(enabled){
      memory.enabled=Boolean(enabled);save();hide();
      if(memory.enabled)nextAt=Math.max(clock.now()+CHAT_TIMING.first,memory.nextTalkAt||0);
      refresh();
    },
    sync(){
      memory=readMemory(storage,clock.now());hide();
      nextAt=Math.max(clock.now()+CHAT_TIMING.first,memory.nextTalkAt||0);refresh();
    },
    destroy(){destroyed=true;cancel();hide();}
  };
}
