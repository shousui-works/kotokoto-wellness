// Synthetic UID only. No actual account reads or AI calls. Delete only this generated test UID.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';import {getFirestore} from 'firebase-admin/firestore';import {FirestoreAccountStore} from '../server/account-store.mjs';import {emptyAccount,applyCommand} from '../server/account-model.mjs';import {recordManual} from '../dist/progress.mjs';import {applyPlush} from '../server/plush-gacha.mjs';
if(process.argv[2]!=='--project=kotokoto-biyori')throw Error('Explicit project required');
const app=initializeApp({projectId:'kotokoto-biyori',credential:applicationDefault()}),db=getFirestore(app,'kotokoto-wellness'),uid='plush-test-'+randomUUID(),store=new FirestoreAccountStore(db),id=randomUUID();
try{
 await store.atomic(uid,randomUUID(),()=>{let state={...emptyAccount(),initialized:true,datasetId:'synthetic',revision:1};for(let i=1;i<=7;i++)state.progress=recordManual(state.progress,{id:'fixture:'+i,kind:'rest',date:'2026-09-0'+i,title:'架空の休息記録'},state.legacy,'2026-10-19T00:00:00Z').progress;return {state,value:true};});
 const transact=()=>store.gacha(uid,id,(state,old,enabled)=>{if(old)return {value:old};const next=applyPlush(state,{type:'plush_draw'},{id,candidate:'pomeranian',enabled});return {...next,value:next.transaction};});
 const [a,b]=await Promise.all([transact(),transact()]);assert.equal(a.item,b.item);let state=await store.read(uid);assert.equal(state.collection.spent,50);assert.equal(state.collection.owned.pomeranian.count,1);
 await store.atomic(uid,randomUUID(),s=>({state:applyCommand(s,{type:'plush_display',slot:'shelf-1-0',item:'pomeranian'}),value:true}));
 state=await store.read(uid);assert.equal(state.collection.shelf['shelf-1-0'],'pomeranian');assert.equal((await store.plushHistory(uid)).rows.length,1);assert.equal((await store.read(uid+'-other')).collection.spent,0);
 await store.clearHistoryBodies(uid,state);assert.equal((await transact()).requestId,id);assert.equal((await store.read(uid)).collection.spent,50);
 console.log('PASS: real Firestore atomic spend, concurrent replay, shelf persistence, history query, cleared-operation replay and UID isolation');
}finally{await db.recursiveDelete(db.collection('users').doc(uid));await deleteApp(app);console.log('Synthetic plush records removed');}
