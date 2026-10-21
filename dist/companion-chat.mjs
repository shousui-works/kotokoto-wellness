import {conversationPeriod,pickVaried} from './companion-lines.mjs?v=idle-2';
export {conversationPeriod};
import {dateKey} from './model.mjs?v=praise-1';

export const CHAT_STORAGE='kotokoto-companion-chat-v1';
export const CHAT_TIMING=Object.freeze({first:12000,duration:16000,reaction:30000,minGap:240000,maxGap:420000});
const PERIODS={
  morning:{label:'朝のひとこと',lines:[
    'おはよう。会いに来てくれて、もううれしいな。',
    '今日のきみも、きみのペースで大丈夫。ぼくは応援してるよ。',
    '小さな一歩からで花まる。きみらしい一日にしようね。',
    'おはよう。ぼくのとなりで、ゆっくり朝を始めよっか。',
    '今日のきみに、しっぽでおはよう。',
    'まだ眠い朝も、ひと息つきながらでいいよ。',
    '新しい朝だね。きみに会えて、ぼくはごきげん。',
    '慌てなくて大丈夫。きみの一日、きみの歩幅で。',
    'おはよう。今日もふわふわの隣、空いてるよ。',
    '朝のひと息、ぼくと分けっこしよう。'
  ]},
  noon:{label:'お昼のひとこと',lines:[
    'お昼だね。会いに来てくれて、ありがとう。きみに花まる！',
    '午後も、小さな「できた」をいっしょに喜ぼうね。',
    'ゆっくりの日も、きみといられる時間はうれしいな。',
    'お昼のひと休み、ぼくのとなりでどうぞ。',
    'ひと息つく場所に、ここを選んでくれてうれしいな。',
    '午後を始める前に、ちょっとのんびりしよっか。',
    'お昼だね。きみとぼくの、ほっとする時間。',
    'ぼくのおへや、休憩場所にしていいからね。',
    'ここに来たら、肩の力を少し抜いていこう。',
    '午後も、きみの歩幅でいこうね。'
  ]},
  afternoon:{label:'午後のひとこと',lines:[
    '午後のひと休みに、きみに花まる。ここでほっとしてね。',
    '自分のペースを大事にしてね。ぼくも、となりで応援してる。',
    '会いに来てくれたね。そんなきみのこと、ぼくはだいすき！',
    '午後ののんびり、ぼくも混ぜてほしいな。',
    'きみのとなりで、しっぽをゆらゆらさせたい気分。',
    'なんでもない午後も、いっしょだといいね。',
    'きみが話したいこと、ぽつりと聞かせてね。',
    '用事がなくても、顔を見せに来ていいんだよ。',
    'ちょっと休憩しよっか。ぼくのふわふわ、貸してあげる。',
    'きみを見つけると、なんだかごきげんになっちゃう。'
  ]},
  evening:{label:'夕方のひとこと',lines:[
    '今日もおつかれさま。ここまで過ごしたきみに、花まる！',
    'うまくいったこと、小さくてもいっしょに喜びたいな。',
    '動いた日も、ゆっくりの日も。会えたきみが、だいすき。',
    '夕方だね。ここでは、ゆっくりしていってね。',
    'きみの帰り道に、このおへやがあったらうれしいな。',
    '今日のきみに、ふわふわのよしよし。',
    '話せることだけ、話してくれたらいいからね。',
    'ひと息つけるなら、ぼくも隣にいさせて。',
    '夕方ののんびりは、いっしょがいいな。',
    '今、きみに会えたのがうれしいんだ。'
  ]},
  night:{label:'夜のひとこと',lines:[
    '今日も一日おつかれさま。今は、安心してひと休みしよう。',
    '今日はここまでで花まる。ゆっくりのきみも、だいすきだよ。',
    'きみと過ごせて、いい一日だったよ。会いに来てくれてありがとう。',
    '夜は、ふわふわのそばでひと休み。',
    '眠る前に会えたね。ぼく、うれしいな。',
    '今夜はここで、そっと肩の力を抜いていこう。',
    '話したい夜も、静かな夜も。となりにいるよ。',
    '今日のきみへ、やさしいよしよし。',
    '明日のことは少し置いて、今はゆっくりしよっか。',
    'きみがほっとできる夜だといいな。'
  ]}
};

export const HABIT_PRAISE=Object.freeze({
  walk:'からだを動かせたね。自分のための一歩、ちゃんと踏み出せてすごい！',
  meal:'ゆっくり味わえたね。自分の時間を、大切にできたね。',
  stretch:'からだをいたわれたね。そのひと手間、すてきだよ！',
  rest:'休む時間をつくれたね。自分を大切にできて、えらい！'
});

export function companionChatLine(state,now=new Date(),previous={},random=Math.random){
  const period=conversationPeriod(now),key=dateKey(now)+':'+period,group=PERIODS[period];
  const lines=group.lines.map((text,index)=>({id:period+'-'+index,text}));
  const day=state.days?.[dateKey(now)];
  if(day?.habits?.length){
    lines.push({id:period+'-progress',text:'小さな「できた」を残せたね。自分の一歩、大切にできたね。'});
    for(const id of day.habits)if(HABIT_PRAISE[id])lines.push({id:period+'-'+id,text:HABIT_PRAISE[id]});
  }
  if(day?.mood==='slow')lines.push({id:period+'-slow',text:'自分の気持ちに気づけたね。その気づきも、大切な一歩だよ。'});
  const line=pickVaried(lines,previous,random);
  return {...line,label:group.label,periodKey:key};
}

function readMemory(storage,stamp){
  const memory={version:1,enabled:true};
  try{
    const value=JSON.parse(storage?.getItem(CHAT_STORAGE)??'null');
    if(value?.version!==1)return memory;
    memory.enabled=value.enabled!==false;
    if(Array.isArray(value.recentIds))memory.recentIds=value.recentIds.filter(x=>typeof x==='string'&&x.length<=80).slice(-8);
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
    memory={...memory,...shared,recentIds:[...(memory.recentIds??[]),...(shared.recentIds??[])].filter((x,i,a)=>a.lastIndexOf(x)===i).slice(-8)};
    const line=companionChatLine(getState(),new Date(stamp),memory,random);
    nextAt=stamp+CHAT_TIMING.minGap+Math.floor(random()*(CHAT_TIMING.maxGap-CHAT_TIMING.minGap));
    memory={...memory,lastId:line.id,recentIds:[...(memory.recentIds??[]),line.id].slice(-8),lastPeriodKey:line.periodKey,lastSpokenAt:stamp,nextTalkAt:nextAt};
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
