import test from 'node:test';
import assert from 'node:assert/strict';
import {createWelcomeConversation} from '../dist/welcome-conversation.mjs';
import {createSpeechTimer,speechDuration} from '../dist/speech-timer.mjs';
test('speech has bounded reading time and pauses without advancing hidden pages',()=>{
 let next=0,id=0;const tasks=new Map();
 const timer=createSpeechTimer({advance:()=>next++,setTimer:(fn,ms)=>{tasks.set(++id,{fn,ms});return id;},clearTimer:id=>tasks.delete(id)});
 assert.equal(speechDuration('短い'),5000);assert.equal(speechDuration('長'.repeat(200)),12000);
 timer.page('一枚目');timer.pause(true);assert.equal(tasks.size,0);
 timer.pause(false);assert.equal(tasks.size,1);timer.page('次のページ');assert.equal(tasks.size,1);
 const task=[...tasks.values()][0];tasks.clear();task.fn();assert.equal(next,1);
 timer.page('最後');timer.clear();assert.equal(tasks.size,0);
});
test('greeting waits for arrival and only attempts once',async()=>{
 let arrive,calls=0;const events=[];
 const controller=createWelcomeConversation({canStart:()=>true,request:async()=>{calls++;return {reply:'こんにちは'};},saved:()=>events.push('saved'),approach:()=>new Promise(r=>arrive=r),reply:x=>events.push(x),cancel:()=>events.push('cancel')});
 const pending=controller.start();await new Promise(r=>setImmediate(r));assert.deepEqual(events,['saved']);
 arrive();await pending;await controller.start();assert.deepEqual(events,['saved','こんにちは']);assert.equal(calls,1);
});
test('typing cancels pending presentation but retains saved history',async()=>{
 let resolve;const events=[];
 const controller=createWelcomeConversation({canStart:()=>true,request:()=>new Promise(r=>resolve=r),saved:()=>events.push('saved'),approach:()=>events.push('approach'),reply:()=>events.push('reply'),cancel:()=>events.push('cancel')});
 const pending=controller.start();controller.interrupt();resolve({reply:'hello'});await pending;assert.deepEqual(events,['saved']);
});
test('interruption while approaching releases the pose without showing a late greeting',async()=>{
 let arrive;const events=[];
 const c=createWelcomeConversation({canStart:()=>true,request:async()=>({reply:'hello'}),saved(){},approach:()=>new Promise(r=>arrive=r),reply:()=>events.push('reply'),cancel:()=>events.push('cancel')});
 const pending=c.start();await new Promise(r=>setImmediate(r));c.interrupt();arrive();await pending;assert.deepEqual(events,['cancel']);
});
test('Firestore persists the welcome cooldown without requiring other profile changes',async()=>{
 const {FirestoreAccountStore}=await import('../server/account-store.mjs');
 const {emptyAccount}=await import('../server/account-model.mjs');
 const ref=path=>({path,collection:name=>ref(path+'/'+name),doc:name=>ref(path+'/'+name)});
 const store=new FirestoreAccountStore({collection:name=>ref(name)}),writes=[];
 const before={...emptyAccount(),initialized:true,datasetId:'fixture'},after={...before,welcomeAt:123456789};
 store.writeState({set:(r,v)=>writes.push([r.path,v])},'alice',before,after);
 assert.equal(writes.find(([path])=>path.endsWith('/settings/profile'))[1].welcomeAt,123456789);
});
test('focus and empty IME composition pause replies, while successful send releases retained focus',async()=>{
 const {bindReplyEditing}=await import('../dist/speech-timer.mjs');
 const input=new EventTarget();let pending=null;
 const timer=createSpeechTimer({advance(){},setTimer:fn=>(pending=fn,1),clearTimer:()=>pending=null});
 const editing=bindReplyEditing(input,()=>timer.pause(editing.active));
 timer.page('hello');assert.ok(pending);
 input.dispatchEvent(new Event('focus'));assert.equal(editing.active,true);assert.equal(pending,null);
 input.dispatchEvent(new Event('compositionstart'));assert.equal(pending,null);
 input.dispatchEvent(new Event('compositionend'));assert.equal(pending,null);
 editing.sent();assert.equal(editing.active,false);assert.ok(pending);
 input.dispatchEvent(new Event('input'));assert.equal(editing.active,true);assert.equal(pending,null);
 editing.sent();assert.ok(pending);
 input.dispatchEvent(new Event('pointerdown'));assert.equal(pending,null);
 input.dispatchEvent(new Event('blur'));assert.ok(pending);
 timer.clear();
});
