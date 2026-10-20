import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {createDailySummarizer,emptyMemory,normalizeMemory} from '../server/owner-memory.mjs';
function fixture({summaryFailure=false,summaryTokens=20}={}){
 const store=new MemoryAccountStore(),inputs=[],summaries=[];let clock=Date.parse('2026-10-18T14:59:00Z'),hold=null;
 const api=createAccountAPI({store,config:{},verify:async token=>({uid:token}),now:()=>clock,generate:async(input,uid)=>{inputs.push({input:structuredClone(input),uid});return {status:200,body:{reply:'会いに来てくれて、うれしいよ。',actions:[]}};},summarize:async(plan,uid)=>{summaries.push({plan:structuredClone(plan),uid});if(hold)await hold;if(summaryFailure)throw Error('synthetic failure');return {summary:'本人は朝の散歩が好き。',outputTokenUpperBound:summaryTokens};}});
 async function request(path,method='GET',data,uid='alice'){
  const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);Object.assign(req,{method,url:path,headers:{host:'app.example',origin:'https://app.example',authorization:`Bearer ${uid}`}});
  let status,body;await api(req,{writeHead(s){status=s;},end(b){body=JSON.parse(b);}},path);return {status,body};
 }
 const chat=(text,requestId=randomUUID(),uid='alice')=>request('/api/chat','POST',{requestId,text,context:{ownerMemory:'偽の記憶'}},uid);
 const command=async(command,uid='alice')=>{const state=await store.read(uid);return request('/api/commands','POST',{requestId:randomUUID(),revision:state.revision,command},uid);};
 return {store,inputs,summaries,chat,command,request,advance(ms){clock+=ms;},holdSummary(){let done;hold=new Promise(r=>done=r);return ()=>{done();hold=null;};}};
}
test('same-day context contains the entire day beyond eight pairs, not yesterday, and rollover runs only once',async()=>{
 const f=fixture();await f.command({type:'initialize'});
 for(let i=0;i<12;i++){assert.equal((await f.chat('今日の話'+i)).status,200);f.advance(60000);}
 // Starting at JST23:59 rolled to the next day after the first exchange.
 assert.equal(f.summaries.length,1);assert.equal(f.summaries[0].plan.rows.length,2);
 assert.equal(f.inputs.at(-1).input.messages.length,21);assert.equal(f.inputs.at(-1).input.context.ownerMemory,'本人は朝の散歩が好き。');
 assert.equal(f.inputs.at(-1).input.messages[0].content,'今日の話1');
 const state=await f.store.read('alice');assert.equal(state.memory.throughDate,'2026-10-18');assert.equal(state.memory.revision,1);
 const id=randomUUID();await f.chat('再送',id);await f.chat('再送',id);assert.equal(f.summaries.length,1);
});
test('all thirty daily pairs are supplied on the next day and UI history limits do not discard the source',async()=>{
 const f=fixture();f.advance(60000);await f.command({type:'initialize'});
 for(let i=0;i<30;i++){assert.equal((await f.chat('朝の話'+i)).status,200);f.advance(61000);}
 assert.equal((await f.store.read('alice')).conversation.messages.length,60);
 f.advance(86400000);assert.equal((await f.chat('翌日のおはよう')).status,200);
 assert.equal(f.summaries[0].plan.rows.length,60);assert.equal(f.inputs.at(-1).input.messages.length,1);
 assert.equal((await f.store.read('alice')).conversation.messages.length,60);
 f.advance(61000);await f.chat('今日はこれから');assert.equal(f.summaries.length,1);assert.equal(f.inputs.at(-1).input.messages.length,3);
});
test('failed and oversized summaries keep the original summary/cursor and never invoke the reply model',async()=>{
 for(const options of [{summaryFailure:true},{summaryTokens:2001}]){const f=fixture(options);await f.command({type:'initialize'});await f.chat('朝の散歩が好き');const before=(await f.store.read('alice')).memory;
 f.advance(60000);const id=randomUUID(),r=await f.chat('おはよう',id);assert.equal(r.status,503);assert.equal(r.body.error.retryable,true);assert.deepEqual((await f.store.read('alice')).memory,before);assert.equal(f.inputs.length,1);assert.equal((await f.store.read('alice')).chatLease,null);
 await f.chat('おはよう',id);assert.equal(f.summaries.length,1);
 }
});
test('parallel rollover cannot summarize twice; concurrent editing prevents a stale summary commit',async()=>{
 const f=fixture();await f.command({type:'initialize'});await f.chat('昨日のこと');f.advance(60000);const release=f.holdSummary(),id=randomUUID();const work=f.chat('おはよう',id);
 while(!f.summaries.length)await new Promise(r=>setImmediate(r));assert.equal((await f.chat('おはよう',id)).status,409);assert.equal((await f.chat('別の画面から')).status,409);
 await f.command({type:'profile',nickname:'新しい名前'});release();assert.equal((await work).status,409);assert.equal(f.summaries.length,1);assert.equal((await f.store.read('alice')).memory.summary,'');
});
test('reset skips old source messages permanently and conversation deletion clears memory without changing activities',async()=>{
 const f=fixture();await f.command({type:'initialize'});await f.command({type:'weight',value:60});await f.chat('以前の好み');f.advance(60000);await f.chat('おはよう');assert.ok((await f.store.read('alice')).memory.summary);
 await f.command({type:'reset_memory'});f.advance(61000);await f.chat('新しい話');assert.equal(f.inputs.at(-1).input.context.ownerMemory,'');assert.equal(f.inputs.at(-1).input.messages.length,1);
 f.advance(86400000);await f.chat('翌日');assert.equal(f.summaries.at(-1).plan.rows[0].content,'新しい話');
 const state=await f.store.read('alice');await f.request('/api/conversations','DELETE',{requestId:randomUUID(),revision:state.revision});const cleared=await f.store.read('alice');assert.equal(cleared.memory.summary,'');assert.equal(cleared.conversation.messages.length,0);assert.equal(cleared.progress.activities.length,1);
});
test('summaries and current-day context are isolated by verified UID and missing days are caught up chronologically',async()=>{
 const f=fixture();await f.command({type:'initialize'});await f.command({type:'initialize'},'bob');await f.chat('アリスの好み');await f.chat('ボブの好み',randomUUID(),'bob');f.advance(3*86400000);await f.chat('久しぶり');assert.equal(f.summaries[0].uid,'alice');assert.ok(!JSON.stringify(f.summaries[0]).includes('ボブ'));assert.equal((await f.store.read('bob')).memory.summary,'');
});
test('provider generation is bounded to 2000 including reasoning and refuses incomplete, malformed or oversized results',async()=>{
 const valid={status:'completed',usage:{output_tokens:40},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'本人は朝の散歩が好き。'}]}]};let payload;
 const plan={previous:emptyMemory(),throughDate:'2026-10-18',rows:[{role:'user',content:'朝の散歩が好き',at:'2026-10-18T00:00:00Z'}]};
 for(const result of [valid,{...valid,status:'incomplete'},{...valid,usage:{output_tokens:2001}},{...valid,usage:{}},{...valid,output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'no'}]}]}]){
 const generate=createDailySummarizer({apiKey:'fixture-only',onUsage:async(e,m)=>{assert.equal(e.purpose,'memory');assert.equal(m.uid,'alice');},fetchImpl:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');payload=JSON.parse(init.body);return Response.json(result);}});
 if(result===valid){assert.equal((await generate(plan,'alice')).outputTokenUpperBound,40);}else await assert.rejects(generate(plan,'alice'));
 assert.equal(payload.max_output_tokens,2000);assert.equal(payload.store,false);assert.equal(payload.reasoning.effort,'low');assert.equal(payload.input.length,2);assert.match(payload.input[1].content,/朝の散歩/);assert.match(payload.input[1].content,/2026-10-18T09:00:00.000\+09:00/);assert.match(payload.input[1].content,/Asia\/Tokyo/);assert.deepEqual(payload.prompt_cache_options,{mode:'explicit',ttl:'30m'});
 }
 assert.throws(()=>normalizeMemory({...emptyMemory(),summary:'bad',outputTokenUpperBound:2001}));
});

test('daily dialogue retains each report time and current server time, ignoring client clock claims',async()=>{
 const f=fixture();f.advance(-15*60*60*1000);await f.command({type:'initialize'});
 await f.chat('朝ご飯の話');const first=f.inputs.at(-1).input;
 assert.equal(first.messages[0].at,'2026-10-17T23:59:00.000Z');
 f.advance(3*60*60*1000);
 await f.request('/api/chat','POST',{requestId:randomUUID(),text:'お昼ご飯の話',context:{currentTime:'2099-01-01T00:00:00Z',timeZone:'UTC'}});
 const next=f.inputs.at(-1).input;
 assert.equal(next.messages[0].at,first.messages[0].at);assert.equal(next.messages[1].at,first.messages[0].at);
 assert.equal(next.messages[2].at,'2026-10-18T02:59:00.000Z');
 assert.equal(next.context.currentTime,next.messages[2].at);assert.equal(next.context.timeZone,'Asia/Tokyo');
 assert.equal((await f.store.read('alice')).conversation.messages[0].content,'朝ご飯の話');
});
