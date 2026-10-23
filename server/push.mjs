import {createHash,createECDH,randomInt} from 'node:crypto';
import {problem} from './account-model.mjs';
export const subscriptionId=endpoint=>createHash('sha256').update(endpoint).digest('hex');
export function validateSubscription(input){
  let url;try{url=new URL(input?.endpoint);}catch{throw problem(400,'invalid_subscription','通知の登録をやり直してね。');}
  const allowed=url.hostname==='fcm.googleapis.com'||url.hostname==='web.push.apple.com'||url.hostname==='updates.push.services.mozilla.com'||url.hostname.endsWith('.push.services.mozilla.com');
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed||url.href.length>2048)throw problem(400,'invalid_endpoint','この端末の通知サービスには対応していません。');
  const keys=input?.keys;
  if(!keys||!/^[-\w]{87}$/.test(keys.p256dh??'')||!/^[-\w]{22}$/.test(keys.auth??''))throw problem(400,'invalid_keys','通知の登録をやり直してね。');
  try{const point=Buffer.from(keys.p256dh,'base64url');if(point.length!==65||point[0]!==4)throw Error();const ec=createECDH('prime256v1');ec.generateKeys();ec.computeSecret(point);}catch{throw problem(400,'invalid_keys','通知の登録をやり直してね。');}
  return {endpoint:url.href,keys:{p256dh:keys.p256dh,auth:keys.auth}};
}
export function validateFrequency(value=2){if(![1,2,3].includes(value))throw problem(400,'invalid_frequency','声かけの回数を選んでね。');return value;}
export const japanDay=now=>new Date(now+9*3600000).toISOString().slice(0,10);
export const PERIODS=[{id:'morning',start:7,end:10},{id:'afternoon',start:12,end:15},{id:'evening',start:18,end:21}];
export function dailyPlan(now,frequency,random=randomInt){
  validateFrequency(frequency);const day=japanDay(now),windows=[...PERIODS];
  for(let i=windows.length-1;i>0;i--){const j=random(0,i+1);[windows[i],windows[j]]=[windows[j],windows[i]];}
  return {day,frequency,slots:windows.slice(0,frequency).map(p=>({period:p.id,at:Date.parse(`${day}T${String(p.start).padStart(2,'0')}:00:00+09:00`)+random(0,(p.end-p.start)*12)*300000})).sort((a,b)=>a.at-b.at)};
}
export function nextRandomDelivery(now,frequency,old=null,random=randomInt){
  let plan=old?.day>=japanDay(now)&&old.frequency===frequency?old:dailyPlan(now,frequency,random);
  let slot=plan.slots.find(s=>s.at>now);
  if(!slot){plan=dailyPlan(now+86400000,frequency,random);slot=plan.slots[0];}
  return {plan,nextAt:slot.at,nextPeriod:slot.period};
}
export function periodEnd(at,period){const window=PERIODS.find(p=>p.id===period);return window?Date.parse(`${japanDay(at)}T${window.end}:00:00+09:00`):at;}
const lines={
 morning:['おはよう。きみの顔を見たくなっちゃった。🐾','おはよう、朝ごはんはもう食べた？ゆっくり朝を始めよ。','朝のひと息、一緒にしよ。今日も会えたらうれしいな。','おはよう。まだ眠たい朝も、ぼくがとなりにいるよ。'],
 afternoon:['お昼ごはんはもう食べた？ぼくも隣でひと休みしたいな。','午後も、きみのペースでね。ちょっと息抜きしよ。🐾','こんにちは。ひと息つけそう？おへやで待ってるよ。','お昼のきみに、しっぽをふりふり。少しだけ会いたいな。'],
 evening:['今日もおつかれさま。きみとゆっくり過ごしたいな。🐾','夜ごはんはもう食べた？ぼくも隣でのんびりしたいな。','がんばった日も、休んだ日も。きみに会えたらうれしいな。','そろそろひと休みしよ。今日のおはなし、気が向いたら聞かせて。'],
};
export function notification(petName='こむぎ',now=Date.now(),test=false,period='evening',random=randomInt){
  const name=typeof petName==='string'?Array.from(petName.replace(/[\u0000-\u001f\u007f]/g,'')).slice(0,20).join(''):'こむぎ';
  const options=lines[period]??lines.evening;
  return {title:`${name||'こむぎ'}から`,body:test?'通知が届いたよ！これからも、ここから会いにいくね。🐾':options[random(0,options.length)],tag:test?'kotokoto-test':`kotokoto-${japanDay(now)}-${period}`,url:'/#room'};
}
export class FirestorePushStore{
  constructor(db){this.db=db;}
  ref(id){return this.db.collection('pushSubscriptions').doc(id);}
  async get(uid,id){const row=(await this.ref(id).get()).data();return row?.uid===uid?row:null;}
  async save(uid,subscription,frequency,now){
    const id=subscriptionId(subscription.endpoint),ref=this.ref(id);
    await this.db.runTransaction(async tx=>{
      const old=(await tx.get(ref)).data(),rows=await tx.get(this.db.collection('pushSubscriptions').where('uid','==',uid));
      if(old&&old.uid!==uid)throw problem(409,'device_in_use','この端末の前のアカウントで通知をオフにしてから登録してね。');
      if(!old&&rows.size>=5)throw problem(409,'device_limit','通知は5台まで。使わない端末でオフにしてね。');
      const plan=old?.plan?.frequency===frequency?old.plan:null;
      tx.set(ref,{uid,subscription,frequency,...nextRandomDelivery(now,frequency,plan),updatedAt:now,lastSlot:old?.lastSlot??0,sentDay:old?.sentDay??null,sentPeriods:old?.sentPeriods??[],lastTestAt:old?.lastTestAt??0});
    });return id;
  }
  async remove(uid,id){await this.db.runTransaction(async tx=>{const ref=this.ref(id),old=(await tx.get(ref)).data();if(old?.uid===uid)tx.delete(ref);});}
  async claimTest(uid,id,now){return this.db.runTransaction(async tx=>{const ref=this.ref(id),row=(await tx.get(ref)).data();if(row?.uid!==uid)throw problem(404,'not_registered','先にこの端末の通知をオンにしてね。');if(now-row.lastTestAt<60000)throw problem(429,'test_limit','テスト通知は1分ほど待ってから試してね。');tx.update(ref,{lastTestAt:now});return row;});}
  async due(now){return (await this.db.collection('pushSubscriptions').where('nextAt','<=',now).limit(100).get()).docs.map(d=>({id:d.id,...d.data()}));}
  async claim(id,now){return this.db.runTransaction(async tx=>{
    const ref=this.ref(id),row=(await tx.get(ref)).data();if(!row||row.nextAt>now)return null;
    const frequency=validateFrequency(row.frequency??2),next=nextRandomDelivery(now,frequency,row.plan);
    // Missed periods are skipped, never delivered as an out-of-time greeting or caught up in a burst.
    const day=japanDay(now),sent=row.sentDay===day?row.sentPeriods??[]:[];
    const valid=row.plan&&row.nextAt>(row.lastSlot??0)&&now<periodEnd(row.nextAt,row.nextPeriod)&&!sent.includes(row.nextPeriod)&&sent.length<frequency;
    tx.update(ref,{frequency,...next,lastSlot:Math.max(row.lastSlot??0,row.nextAt),sentDay:day,sentPeriods:valid?[...sent,row.nextPeriod]:sent});return valid?row:null;
  });}
  async petName(uid){const user=this.db.collection('users').doc(uid),meta=(await user.get()).data();if(!meta?.initialized)return null;const data=(await user.collection('datasets').doc(meta.datasetId).collection('settings').doc('profile').get()).data();return data?.profile?.petName||'こむぎ';}
}
export function createPushService({store,send,publicKey,now=Date.now}){
  const available=!!publicKey&&typeof send==='function';
  async function deliver(id,row,test=false){
    const name=await store.petName(row.uid);if(name===null){await store.remove(row.uid,id);return 'removed';}
    try{await send(row.subscription,JSON.stringify(notification(name,now(),test,row.nextPeriod)),{TTL:test?3600:Math.max(1,Math.min(3600,Math.ceil((periodEnd(row.nextAt,row.nextPeriod)-now())/1000)))});return 'sent';}
    catch(error){if([404,410].includes(error.statusCode)){await store.remove(row.uid,id);return 'expired';}console.error(JSON.stringify({event:'push_send_failed',status:Number.isInteger(error.statusCode)&&error.statusCode>=100&&error.statusCode<=599?error.statusCode:null}));throw problem(503,'push_unavailable','今は通知を送れません。少し待ってから試してね。');}
  }
  return {publicKey:available?publicKey:null,
    async handle(uid,method,input={}){
      if(!available)throw problem(503,'push_not_ready','通知は準備中です。');
      if(method==='PUT'){const subscription=validateSubscription(input.subscription),frequency=validateFrequency(input.frequency);await store.save(uid,subscription,frequency,now());return {enabled:true,frequency};}
      const id=input.id;if(!/^[a-f0-9]{64}$/.test(id??''))throw problem(400,'invalid_device','この端末の通知を登録し直してね。');
      if(method==='GET'){const row=await store.get(uid,id);return {enabled:!!row,frequency:row?.frequency??2};}
      if(method==='DELETE'){await store.remove(uid,id);return {enabled:false};}
      if(method==='POST'){const row=await store.claimTest(uid,id,now());const result=await deliver(id,row,true);if(result!=='sent')throw problem(410,'push_expired','端末の通知登録が切れています。オフにしてから、もう一度オンにしてね。');return {sent:true};}
      throw problem(405,'method_not_allowed','この操作には対応していません。');
    },
    async dispatch(){if(!available)throw Error('Push not configured');const counts={sent:0,failed:0,expired:0,removed:0},deadline=Date.now()+240000;for(let page=0;page<5;page++){const rows=await store.due(now());if(!rows.length)break;for(const {id}of rows){if(Date.now()>deadline)return counts;try{const row=await store.claim(id,now());if(!row)continue;counts[await deliver(id,row)]++;}catch{counts.failed++;}}}return counts;},
  };
}
