// Offline account UI fixture. Excluded from image/build; no credentials or external AI calls.
import {readFile} from 'node:fs/promises';
import {createAppServer} from '../server/index.mjs';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
const sdk=`export const initializeApp=x=>x;
const makeUser=()=>localStorage.getItem('fixture-user')?{uid:'fixture-alice',email:'alice@example.test',getIdToken:async()=>'fixture-token'}:null;
const auth={currentUser:makeUser(),authStateReady:async()=>{}};let listener;
export const getAuth=()=>auth;export class GoogleAuthProvider{setCustomParameters(){}}
export const getRedirectResult=async()=>null;
export const onAuthStateChanged=(_,fn)=>{listener=fn;fn(auth.currentUser);};
export const signInWithPopup=async()=>{localStorage.setItem('fixture-user','yes');auth.currentUser=makeUser();listener?.(auth.currentUser);};
export const signInWithRedirect=signInWithPopup;
export const signOut=async()=>{localStorage.removeItem('fixture-user');auth.currentUser=null;listener?.(null);};`;
// Browser-driven UI fixture; no real microphone or recognition service is used.
const voiceSDK=process.env.VOICE_FIXTURE==='unsupported'?'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;':`window.SpeechRecognition=class {
 start(){this.timers=[];this.onstart?.();if(${JSON.stringify(process.env.VOICE_FIXTURE)}==='denied'){this.onerror?.({error:'not-allowed'});return;}
 this.timers.push(setTimeout(()=>this.onresult?.({results:[Object.assign([{transcript:'こんにちは'}],{isFinal:false})]}),200));
 this.timers.push(setTimeout(()=>this.stop(),8000));}
 stop(){this.abort();this.onresult?.({results:[Object.assign([{transcript:'こんにちは、会いに来たよ'}],{isFinal:true})]});this.onend?.();}
 abort(){for(const t of this.timers??[])clearTimeout(t);}
};`;
const dailyLife={
 '洗濯したよ':['housework','洗濯できたんだね、えらいねー。きれいになって気持ちいいね。'],
 '小皿に分けたよ':['eating_habit','小皿に分けたんだね。自分に合う食べ方を工夫できて、えらいねー。'],
 '自炊したよ':['meal_care','自分のごはんを用意したんだね、よくできたね。'],
 '気分を日記に書いたよ':['mood_log','気持ちを言葉にできたんだね、えらいねー。よしよし。'],
 '後回しのメールを返したよ':['challenge','気になっていたことに一歩踏み出せたんだね、えらいねー。'],
 '休憩したよ':['rest','自分のためにひと休みできたね。よしよし。'],
};
async function generate(input){
 const delay=Math.min(15000,Math.max(0,Number(process.env.REPLY_DELAY_MS)||0));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
 const text=input.messages.at(-1).content,entries=process.env.DAILY_LIFE==='1'?Object.entries(dailyLife).filter(([evidence])=>text.includes(evidence)):[];
 const actions=entries.map(([evidence,[kind]])=>({operation:'create',targetId:null,kind,date:input.context.date,title:evidence,evidence,minutes:null,kcal:null,estimatedKcal:null,estimateBasis:null,weightKg:null,detail:null,additional:false}));
 return {status:200,body:{reply:entries[0]?.[1][1]??'会いに来てくれて、うれしいな。きみの一歩に花まる！',actions}};
}
let pushEnabled=false,pushFrequency=2;
const fakePush=process.env.PUSH_FIXTURE?{publicKey:'fixture-public-key',async handle(uid,method,input){if(method==='PUT'){pushEnabled=true;pushFrequency=input.frequency;}if(method==='DELETE')pushEnabled=false;return method==='POST'?{sent:true}:{enabled:pushEnabled,frequency:pushFrequency};}}:null;
const api=createAccountAPI({push:fakePush,store:new MemoryAccountStore(),config:{projectId:'fixture',authDomain:'localhost',apiKey:'fixture',appId:'fixture'},verify:async t=>{if(t!=='fixture-token')throw Error();return {uid:'fixture-alice'};},generate});
const server=createAppServer({accountHandler:async(req,res,path)=>{
 if(process.env.PUSH_FIXTURE&&path==='/fixture-push.mjs'){
 const source=`let sub=null;const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',toJSON:()=>({endpoint:subscription.endpoint,keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>{sub=null;return true;}};const reg={pushManager:{getSubscription:async()=>sub,subscribe:async()=>sub=subscription}};export const fixturePush={support:'supported',permission:()=> 'granted',nav:{serviceWorker:{register:async()=>reg,ready:Promise.resolve(reg),getRegistration:async()=>reg}},win:{Notification:{requestPermission:async()=> 'granted'}}};`;
 res.writeHead(200,{'Content-Type':'text/javascript'});res.end(source);return true;}
 if(process.env.PUSH_FIXTURE&&path==='/app.mjs'){let source=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');source="import {fixturePush} from '/fixture-push.mjs';\n"+source.replace('createPushSettings({account});','createPushSettings({...fixturePush,account});');res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(source);return true;}
 if(path==='/fixture-voice.mjs'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(voiceSDK);return true;}
 if(process.env.VOICE_FIXTURE&&['/','/index.html'].includes(path)){let html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');html=html.replace('</head>','<script src="/fixture-voice.mjs"></script></head>');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return true;}
 if(path==='/fixture-sdk.mjs'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(sdk);return true;}
 if(path==='/account-client.mjs'){let text=await readFile(new URL('../dist/account-client.mjs',import.meta.url),'utf8');text=text.replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js','/fixture-sdk.mjs').replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js','/fixture-sdk.mjs');res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(text);return true;}
 return api(req,res,path);
}});const port=Number(process.env.PORT??8083);server.listen(port,'127.0.0.1',()=>console.log('Offline account fixture on 127.0.0.1:'+port));
