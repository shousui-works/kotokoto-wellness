export const IDLE_STORAGE='kotokoto-companion-idle-v1';
export const IDLE_INTERVAL=90000;
export const IDLE_LINES={
 curious:[
  'ぼくのとなり、空いてるよ。ちょこんと座っていかない？',
  'きみのこと、少しずつ知っていけたらうれしいな。',
  '目が合ったね。えへへ、なんだかうれしい。',
  '何も話さなくてもいいよ。ここにいるだけでも。',
  'きみの好きなもの、ぼくも見つけていきたいな。',
  'ねえ、ぼくのふわふわ、気になってる？',
  'きみのひとこと、いつでも聞けるようにしてるよ。',
  'いっしょにのんびりする練習、しよっか。',
 ],
 calm:[
  'ぼくの特等席は、きみのそば。',
  '何でもない時間も、いっしょだといい時間だね。',
  '話したくなったら呼んでね。ぼく、ここにいるよ。',
  'きみと目が合うと、ついしっぽが動いちゃう。',
  '今日は、のんびりする係をぼくがやるね。',
  'ふわふわのまま、きみのそばにいようかな。',
  'ここで、ひと息ついていってね。',
  'ぼくはね、こういう静かな時間も好き。',
 ],
 happy:[
  '今日の小さな一歩、ぼくも一緒に喜んでるよ。',
  '自分のためにできたこと、ちゃんとすてきだね。',
  'えらいねー。今度はゆっくり、ひと息つこう。',
  'きみの「できた」を聞くと、ぼくまでごきげん。',
  '小さな工夫にも、ふわふわの花まるをあげたいな。',
  'できたこと、今日はそっと大事にしておこうね。',
  'ぼくもきみの隣で、しっぽをふりたい気分。',
  '自分を大切にできたきみに、よしよし。',
 ],
 excited:[
  'きみの小さな「できた」が重なって、ぼくもうれしい！',
  'ひとつずつ自分を大切にできたね。よしよし。',
  'きみの一歩に、しっぽが追いつかないくらいうれしいな。',
  '今日のできたこと、ぼくと一緒に喜ぼうね。',
  'きみに花まる！ このあとはひと休みもいいね。',
  'うれしい気持ちで、ぴょんってしたくなるな。',
  '自分のためにできたこと、ひとつひとつすてきだね。',
  'ぼくのとなりで、できたことを味わっていこう。',
 ],
 lonely:[
  'きみがここにいると、ほっとするな。',
  'おかえり。今日はここで、ひと息ついていってね。',
  '話せる日も、静かにいたい日も。ここにおいで。',
  '今、会えたのがうれしいんだ。',
  '何も話さなくても、ぼくはそばにいるよ。',
  'ゆっくりで大丈夫。きみの場所、空いてるよ。',
  'ふわふわのとなりで、肩の力を抜いていこう。',
  'きみのペースでいいよ。ぼくものんびりするね。',
 ],
 soothed:[
  'さっきのなでなで、まだうれしいな。',
  'きみの手、やさしいね。もう少しそばにいようかな。',
  'なでてもらうと、なんだかほっとするんだ。',
  'よしよしのお返し、ぼくもしたいな。',
  'ふわふわ、気持ちよかった？ ぼくもうれしかった。',
  '手のそばに、鼻をちょこんと寄せたい気分。',
  'ありがとう。いま、とっても安心してる。',
  'このまま、となりでくつろいじゃおうかな。',
 ],
};
export const ROOM_LINES=[
 'このおへやの好きなところ、もうひとつ見つけたいな。',
 'お気に入りの場所って、いるだけでほっとするね。',
 'ねえ、ぼくって、雲をちょっと犬にしたみたい？',
 'きみが笑ってくれたら、ぼくもしっぽふりふり。',
 'ぼくのふわふわには、のんびりが詰まってるんだよ。',
 '用事がなくても、遊びに来ていいんだからね。',
 'きみのそばで、ちいさく丸くなっていたいな。',
 '特別なことがなくても、きみといるのはうれしいよ。',
 'しっぽの先まで、のんびりした気分。',
 '言葉がまとまらない時は、そのままでもいいよ。',
 'ぼく、きみの声を聞くのが好きなんだ。',
 '今日のおへやにも、きみの居場所があるよ。',
];
export const CLOSE_LINES=[
 'きみのそば、ぼくのいちばん好きな場所。',
 'ちょっとだけ、ぴとってくっついててもいい？',
 '目が合ったら、だいすきの合図だよ。',
 'きみとぼくの、何でもない時間が好き。',
 'となりにいると、つい甘えたくなっちゃう。',
 'ぼくの「だいすき」、しっぽで伝わってるかな。',
];
export function conversationPeriod(now=new Date()){
 const hour=now.getHours();if(hour<5||hour>=21)return 'night';if(hour<11)return 'morning';if(hour<14)return 'noon';if(hour<17)return 'afternoon';return 'evening';
}
export function pickVaried(lines,previous={},random=Math.random){
 const recent=new Set([...(previous.recentIds??[]),previous.lastId].filter(Boolean));
 let candidates=lines.filter(x=>!recent.has(x.id));if(!candidates.length)candidates=lines.filter(x=>x.id!==previous.lastId);if(!candidates.length)candidates=lines;
 const value=random(),fraction=Number.isFinite(value)?Math.max(0,Math.min(.999999,value)):0;
 return candidates[Math.floor(fraction*candidates.length)];
}
export function createIdleSpeech({storage,random=Math.random,now=Date.now}={}){
 if(storage===undefined)try{storage=globalThis.localStorage;}catch{}
 let recent=[];try{const raw=JSON.parse(storage?.getItem(IDLE_STORAGE)??'null');if(raw?.version===1&&Array.isArray(raw.recentIds))recent=raw.recentIds.filter(x=>typeof x==='string'&&x.length<=80).slice(-8);}catch{}
 let current=null,key='',chosenAt=0;
 return {line({feeling,score=0,rotate=true}={}){
  const stamp=now(),period=conversationPeriod(new Date(stamp)),nextKey=feeling.id+':'+period;
  if(current&&key===nextKey&&(!rotate||stamp>=chosenAt&&stamp-chosenAt<IDLE_INTERVAL))return current;
  const options=[...(feeling.lines??[]),...(IDLE_LINES[feeling.id]??[])].map((text,i)=>({id:feeling.id+'-'+i,text}));
  // Recovery/thanks keep their specific meaning; other states mix in relaxed room chatter.
  if(!['lonely','soothed'].includes(feeling.id))options.push(...ROOM_LINES.map((text,i)=>({id:'room-'+i,text})));
  if(score>=50)options.push(...CLOSE_LINES.map((text,i)=>({id:'close-'+i,text})));
  current=pickVaried(options,{lastId:current?.id??recent.at(-1),recentIds:recent},random);key=nextKey;chosenAt=stamp;recent=[...recent,current.id].slice(-8);
  try{storage?.setItem(IDLE_STORAGE,JSON.stringify({version:1,recentIds:recent}));}catch{}
  return current;
 }};
}
