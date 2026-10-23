import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPreferences,applyPreferences,preferenceContext,normalizePreferences} from '../server/interaction-preferences.mjs';
const update=(style,scope='ongoing',certainty='explicit')=>({style,scope,certainty,evidence:'応援',asked:false});
test('explicit preference persists; daily override expires without replacing it',()=>{
 let p=applyPreferences(null,update('praise'),'応援','2026-10-23');
 p=applyPreferences(p,update('listen','today'),'応援','2026-10-23');
 assert.deepEqual(preferenceContext(p,'2026-10-23'),{preferred:'praise',today:'listen',canAsk:true});
 assert.equal(preferenceContext(p,'2026-10-24').today,null);
 p=applyPreferences(p,update('encourage'),'応援','2026-10-23');assert.equal(p.preferred,'encourage');assert.deepEqual(p.today,{style:'listen',date:'2026-10-23'});
});
test('inference requires three distinct days and cannot replace an established choice',()=>{
 let p=emptyPreferences();for(let i=0;i<8;i++)p=applyPreferences(p,update('encourage','ongoing','inferred'),'応援','2026-10-23');
 assert.equal(p.preferred,null);assert.equal(p.candidate.count,1);
 p=applyPreferences(p,update('encourage','ongoing','inferred'),'応援','2026-10-24');assert.equal(p.preferred,null);
 p=applyPreferences(p,update('encourage','ongoing','inferred'),'応援','2026-10-25');assert.equal(p.preferred,'encourage');
 p=applyPreferences(p,update('nurture','ongoing','inferred'),'応援','2026-10-26');assert.equal(p.preferred,'encourage');
});
test('invalid and ungrounded candidates are ignored; questions have a ten-turn cooldown',()=>{
 for(const u of [update('instructions'),{...update('listen'),evidence:''},update('listen')])assert.equal(applyPreferences(null,u,'こんにちは','2026-10-23').preferred,null);
 let p=applyPreferences(null,{asked:true},'こんにちは','2026-10-23');assert.equal(preferenceContext(p,'2026-10-23').canAsk,false);
 for(let i=0;i<10;i++)p=applyPreferences(p,null,'こんにちは','2026-10-23');assert.equal(preferenceContext(p,'2026-10-23').canAsk,true);
 assert.throws(()=>normalizePreferences({version:99}));
});

test('generator sends saved preferences and extracts the update in the same response',async()=>{
 const {createReportGenerator}=await import('../server/komugi-chat.mjs');let sent;
 const interactionUpdate=update('encourage');
 const generate=createReportGenerator({apiKey:'offline-fixture',fetchImpl:async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'一緒に一歩ずついこうね。',actions:[],interactionUpdate})}]}]});}});
 const result=await generate({requestId:'fixture',messages:[{role:'user',content:'応援してほしい'}],context:{date:'2026-10-23',interactionPreferences:{preferred:'listen',today:null,canAsk:false}}},'fake-user');
 assert.equal(result.status,200);assert.deepEqual(result.body.interactionUpdate,interactionUpdate);
 assert.ok(sent.input.at(-1).content.includes('"preferred":"listen"'));assert.ok(sent.input.at(-1).content.includes('"canAsk":false'));
 assert.ok(sent.text.format.schema.required.includes('interactionUpdate'));
});

test('Firestore writer persists preferences even when names and chat settings did not change',async()=>{
 const {FirestoreAccountStore}=await import('../server/account-store.mjs');const {emptyAccount}=await import('../server/account-model.mjs');
 const ref=path=>({path,collection:name=>ref(path+'/'+name),doc:name=>ref(path+'/'+name)});
 const store=new FirestoreAccountStore({collection:name=>ref(name)}),writes=[];
 const before={...emptyAccount(),initialized:true,datasetId:'fixture'},after=structuredClone(before);
 after.interactionPreferences=applyPreferences(null,update('encourage'),'応援','2026-10-23');
 store.writeState({set:(r,v)=>writes.push([r.path,v])},'alice',before,after);
 const saved=writes.find(([path])=>path.endsWith('/settings/profile'));
 assert.equal(saved[0],'users/alice/datasets/fixture/settings/profile');assert.deepEqual(normalizePreferences(saved[1].interactionPreferences),after.interactionPreferences);
 assert.equal(normalizePreferences(undefined).preferred,null);
});

test('account backup import preserves preferences and rejects invalid versions',async()=>{
 const {emptyAccount,importAccount}=await import('../server/account-model.mjs');
 const source=emptyAccount();source.interactionPreferences=applyPreferences(null,update('encourage'),'応援','2026-10-23');
 assert.deepEqual(importAccount(source).interactionPreferences,source.interactionPreferences);
 assert.throws(()=>importAccount({...source,interactionPreferences:{version:99}}));
 const legacy=emptyAccount();delete legacy.interactionPreferences;assert.deepEqual(importAccount(legacy).interactionPreferences,emptyPreferences());
});
