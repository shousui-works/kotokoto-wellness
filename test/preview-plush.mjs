// Offline fixture with synthetic points, collection, identity. No Google, Firestore or AI calls.
import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {createAppServer} from '../server/index.mjs';import {MemoryAccountStore} from '../server/account-store.mjs';import {emptyAccount} from '../server/account-model.mjs';import {createAccountAPI} from '../server/account-api.mjs';import {dateKey,recentDays} from '../dist/model.mjs';import {recordManual,applyInterpretation} from '../dist/progress.mjs';import {applyPlush} from '../server/plush-gacha.mjs';import {PLUSH_CATALOG,SHELF_SLOTS} from '../dist/plush-catalog.mjs';
const store=new MemoryAccountStore();let state={...emptyAccount(),initialized:true,datasetId:'fixture',revision:1,profile:{version:1,nickname:'そら',petName:'こむぎ',namesConfigured:true}};
for(const month of ['07','08','09'])for(let i=1;i<=30;i++)for(const kind of ['rest','stretch'])state.progress=recordManual(state.progress,{id:`2026-${month}-${String(i).padStart(2,'0')}:${kind}`,kind,date:`2026-${month}-${String(i).padStart(2,'0')}`,title:'架空のテスト記録'},state.legacy,'2026-10-19T00:00:00Z').progress;
// Leave the last breed unowned so the exchange flow can be previewed.
for(const item of PLUSH_CATALOG.slice(0,30)){state=applyPlush(state,{type:'plush_draw'},{id:randomUUID(),candidate:item.id}).state;state=applyPlush(state,{type:'plush_seen',id:state.collection.lastResult.requestId}).state;}
// The remaining ownership is synthetic fixture data; no real points or account are involved.
for(const item of PLUSH_CATALOG.slice(30,-1))state.collection.owned[item.id]={count:1,firstAt:'2026-10-20T00:00:00Z'};
for(let i=0;i<SHELF_SLOTS.length;i++)state=applyPlush(state,{type:'plush_display',slot:SHELF_SLOTS[i],item:PLUSH_CATALOG[i+30].id}).state;
state.collection.buttons=5;state.collection.seenResult=state.collection.lastResult.requestId;if(process.argv.includes('--calories')){
 for(const [i,date] of recentDays(14).entries()){
  const action=(kind,values={})=>({operation:'create',targetId:null,kind,date,title:kind==='walk'?'検証用のおさんぽ':'検証用の運動',evidence:'架空の運動',minutes:20,kcal:null,weightKg:null,detail:null,additional:false,...values});
  state.progress=applyInterpretation(state.progress,{requestId:'calorie-fixture-'+date,today:dateKey(),text:'架空の運動',reply:'自分のためのひと歩き、えらいね。',actions:[action('walk',{kcal:60+i*3}),action('run',{estimatedKcal:80+i*5,estimateBasis:'画面確認用の架空の推定値'}),...(date===dateKey()?[action('exercise',{minutes:null})]:[])]},state.legacy).progress;
 }
}
store.accounts.set('plush-fixture',state);let next=30;
const sdk=`export const initializeApp=x=>x;const user={uid:'plush-fixture',email:'fixture@example.test',getIdToken:async()=>'fixture-token'};const auth={currentUser:user,authStateReady:async()=>{}};export const getAuth=()=>auth;export class GoogleAuthProvider{setCustomParameters(){}}export const getRedirectResult=async()=>null;export const onAuthStateChanged=(_,fn)=>{fn(user);};export const signInWithPopup=async()=>{};export const signInWithRedirect=async()=>{};export const signOut=async()=>{};`;
const api=createAccountAPI({store,apiAvailable:false,config:{projectId:'fixture',authDomain:'localhost',apiKey:'fixture',appId:'fixture'},verify:async t=>{if(t!=='fixture-token')throw Error();return {uid:'plush-fixture'};},choosePlush:()=>PLUSH_CATALOG[next++%PLUSH_CATALOG.length].id});
createAppServer({accountHandler:async(req,res,path)=>{
 if(path==='/fixture-sdk.mjs'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(sdk);return true;}
 if(path==='/account-client.mjs'){let source=await readFile(new URL('../dist/account-client.mjs',import.meta.url),'utf8');source=source.replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js','/fixture-sdk.mjs').replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js','/fixture-sdk.mjs');res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(source);return true;}
 return api(req,res,path);
}}).listen(process.argv.includes('--hundred')?8088:process.argv.includes('--calories')?8087:8086,'127.0.0.1',()=>console.log('Offline collection/calorie fixture ready'));
