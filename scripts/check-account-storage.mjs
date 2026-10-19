// Explicit opt-in integration check. Synthetic UID only; never reads real users or calls OpenAI.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {FirestoreAccountStore} from '../server/account-store.mjs';
import {emptyAccount,applyCommand,importAccount,fingerprint} from '../server/account-model.mjs';
if(process.argv[2]!=='--project=kotokoto-biyori')throw Error('Explicit project required');
const app=initializeApp({projectId:'kotokoto-biyori',credential:applicationDefault()}),db=getFirestore(app,'kotokoto-wellness');
const uid=`integration-${randomUUID()}`,store=new FirestoreAccountStore(db),id=randomUUID();
try{
  assert.equal((await store.read(uid)).initialized,false);
  await store.atomic(uid,id,state=>({state:{...emptyAccount(),initialized:true,datasetId:`data-${id}`,revision:1},operation:{status:'complete',at:Date.now()},value:true}));
  await store.atomic(uid,randomUUID(),state=>({state:applyCommand(state,{type:'weight',value:60},Date.now()),value:true}));
  let state=await store.read(uid);assert.equal(state.progress.activities.length,1);assert.equal(Object.values(state.legacy.days)[0].weight,60);
  await store.atomic(uid,randomUUID(),state=>({state:applyCommand(state,{type:'profile',nickname:'テスト'},Date.now()),value:true}));
  state=await store.read(uid);assert.equal(state.profile.nickname,'テスト');assert.equal(state.revision,3);
  assert.equal(await store.readIfChanged(uid,3),null);
  const chatId=randomUUID(),at=new Date().toISOString();
  await store.atomic(uid,chatId,state=>{state.messageCounter++;state.revision++;state.conversation.messages=[{role:'user',content:'テスト',at},{role:'assistant',content:'テストのお返事',at}];return {state,appendMessages:true,operation:{status:'complete',at:Date.now(),result:{reply:'テストのお返事'}},value:true};});
  state=await store.read(uid);assert.equal(state.conversation.messages.length,2);assert.equal(state.conversation.messages[1].content,'テストのお返事');
  const rows=await store.atomic(uid,randomUUID(),(current,op,usage,rows)=>({value:rows}),{memoryWindow:true});assert.equal(rows.length,2);assert.equal(rows[0].content,'テスト');
  await store.atomic(uid,randomUUID(),state=>{state.memory={...state.memory,revision:1,summary:'架空の確認用の記憶。',outputTokenUpperBound:10,throughSequence:rows.at(-1).sequence,throughDate:at.slice(0,10),updatedAt:at};state.revision++;return {state,value:true};});
  state=await store.read(uid);assert.equal(state.memory.summary,'架空の確認用の記憶。');
  assert.equal((await store.atomic(uid,randomUUID(),(current,op,usage,rows)=>({value:rows}),{memoryWindow:true})).length,0);
  const old=structuredClone(state);await store.atomic(uid,randomUUID(),state=>{state.conversation.messages=[];state.historyEpoch=randomUUID();state.revision++;return {state,clearConversation:true,value:true};});await store.clearHistoryBodies(uid,old);
  state=await store.read(uid);assert.equal(state.conversation.messages.length,0);
  const op=(await store.user(uid).collection('operations').doc(chatId).get()).data();assert.equal(op.bodyCleared,true);assert.equal(op.result,undefined);
  assert.equal((await store.read(uid+'-other')).initialized,false);
  await db.recursiveDelete(db.collection('users').doc(uid));
  const imported=importAccount({legacy:state.legacy,progress:state.progress,profile:state.profile,conversation:state.conversation});
  await store.import(uid,id,imported,fingerprint(imported));
  state=await store.read(uid);assert.equal(state.profile.nickname,'テスト');assert.equal(state.progress.activities.length,1);
  await store.atomic(uid,randomUUID(),state=>({state:applyCommand(state,{type:'profile',nickname:'更新後'},Date.now()),value:true}));
  assert.equal((await store.import(uid,id,imported,fingerprint(imported))).profile.nickname,'更新後');
  console.log('PASS: named Firestore initialization, canonical saves, isolation, import and retry');
}finally{await db.recursiveDelete(db.collection('users').doc(uid));await deleteApp(app);console.log('Synthetic integration records removed');}
