import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {APP_MANUAL_TOOL,APP_MANUAL_SECTION_IDS,getAppManual} from '../server/app-manual.mjs';
import {CHAT_MODEL,createReportGenerator,extractReport,validateChatRequest} from '../server/komugi-chat.mjs';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {progressTotal} from '../dist/progress.mjs';
import {DRAW_COST,EXCHANGE_COST,PLUSH_CATALOG,SHELF_SLOTS} from '../dist/plush-catalog.mjs';

const input=(text='写真から食事を記録するにはどうするの？')=>({requestId:randomUUID(),messages:[{role:'user',content:text}],context:{date:'2026-11-21',petName:'こむぎ',activities:[]}});
const response=(output,tokens=40,id=randomUUID())=>({id,model:CHAT_MODEL,status:'completed',output,usage:{input_tokens:100,output_tokens:tokens}});
const answer=(text='下の写真ボタンから「写真を撮る・選ぶ」を押してね。',actions=[])=>({type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({reply:text,actions,interactionUpdate:null})}]});
const manualAnswer=(text,reply='',actions=[])=>({type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({reply,manualReply:text,actions,interactionUpdate:null})}]});
const call=(sections=['meal_photos'],id='manual-1')=>({type:'function_call',name:'get_app_manual',call_id:id,arguments:JSON.stringify({sections})});
function generator(results,options={}){
  const sent=[];
  const generate=createReportGenerator({apiKey:'fixture',...options,fetchImpl:async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');sent.push({body:JSON.parse(init.body),signal:init.signal});
    const result=results[sent.length-1];assert.ok(result,'Unexpected extra API request');
    if(result instanceof Error)throw result;
    return result instanceof Response?result:Response.json(result);
  }});
  return {generate,sent};
}

test('manual only accepts bounded public sections, never a path, URL or extra argument',()=>{
  assert.equal(APP_MANUAL_TOOL.strict,true);assert.equal(APP_MANUAL_TOOL.parameters.additionalProperties,false);
  for(const id of APP_MANUAL_SECTION_IDS){const value=getAppManual({sections:[id]});assert.equal(value.sections[0].id,id);assert.ok(value.sections[0].text);}
  for(const sections of [[],['account','chat','settings','records'],['chat','chat'],['../.env.local'],['https://example.com'],['__proto__'],['constructor'],[null]])assert.throws(()=>getAppManual({sections}));
  for(const args of [null,[],{sections:['chat'],path:'.env.local'},{},Object.assign(Object.create({sections:['chat']}),{other:true})])assert.throws(()=>getAppManual(args));
  const one=getAppManual({sections:['chat']});one.sections[0].text='changed';assert.notEqual(getAppManual({sections:['chat']}).sections[0].text,'changed');
  const plush=getAppManual({sections:['plush']}).sections[0].text;
  for(const text of [`${DRAW_COST}ポイント`,`${EXCHANGE_COST}ボタン`,`${PLUSH_CATALOG.length}種類`,`${SHELF_SLOTS.length}枠`])assert.ok(plush.includes(text));
});

test('manual calls retrieve just requested content and replay all reasoning/output before the final answer',async()=>{
  const reasoning={type:'reasoning',id:'reasoning-fixture',summary:[],encrypted_content:'opaque-fixture'};
  const tool=call(),draft=answer('これは表示しない途中の返事。');const metrics=[];
  const f=generator([response([reasoning,draft,tool],90,'response-first'),response([answer()],80,'response-final')],{onUsage:(entry,meta)=>metrics.push({entry,meta})});
  const result=await f.generate(input(),'fixture-owner');assert.equal(result.status,200);assert.match(result.body.reply,/写真を撮る・選ぶ/);assert.deepEqual(result.body.actions,[]);
  assert.equal(f.sent.length,2);const [first,second]=f.sent.map(c=>c.body);
  assert.deepEqual(first.tools,[APP_MANUAL_TOOL]);assert.equal(first.parallel_tool_calls,false);assert.equal(first.tool_choice,'auto');
  assert.doesNotMatch(JSON.stringify(first.input),/推定しただけでは保存されない/);
  assert.deepEqual(second.input.slice(0,first.input.length),first.input);
  assert.deepEqual(second.input.slice(first.input.length,-1),[reasoning,draft,tool]);
  const output=second.input.at(-1);assert.equal(output.type,'function_call_output');assert.equal(output.call_id,tool.call_id);
  assert.deepEqual(JSON.parse(output.output).sections.map(s=>s.id),['meal_photos']);assert.match(output.output,/推定しただけでは保存されない/);
  assert.equal(second.max_output_tokens,2310);assert.equal(second.store,false);assert.equal(second.model,CHAT_MODEL);assert.deepEqual(second.reasoning,{effort:'low'});
  assert.equal(f.sent[0].signal,f.sent[1].signal);
  assert.deepEqual(metrics.map(m=>m.meta.responseId),['response-first','response-final']);assert.ok(metrics.every(m=>m.meta.uid==='fixture-owner'));
  assert.doesNotMatch(JSON.stringify(result.body),/opaque-fixture|function_call|表示しない|sections/);
});

test('ordinary chat remains a single API request with no manual content fetched',async()=>{
  const f=generator([response([answer('おかえり。一緒にひと休みしよう。')])]);
  assert.equal((await f.generate(input('ただいま'),'owner')).status,200);assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].body.max_output_tokens,2400);
});

test('only manual-backed explanations may mention point UI, and ordinary praise stays restricted',async()=>{
  const text='「きろく」の「えらいポイント」でグラフを見られるよ。';
  const normal=generator([response([answer(text)])]);assert.equal((await normal.generate(input('ポイントのグラフはどこ？'),'owner')).status,502);
  const ungrounded=generator([response([manualAnswer(text)])]);assert.equal((await ungrounded.generate(input('ポイントのグラフはどこ？'),'owner')).status,502);
  const help=generator([response([call(['points'])]),response([manualAnswer(text)])]);assert.equal((await help.generate(input('ポイントのグラフはどこ？'),'owner')).status,200);
  const req=validateChatRequest(input('ストレッチしたよ'));
  const action={operation:'create',targetId:null,kind:'stretch',date:'2026-11-21',title:'ストレッチ',evidence:'ストレッチした',minutes:null,kcal:null,weightKg:null,detail:null,additional:false};
  assert.equal(extractReport(response([answer('10ポイントもらえたね。',[action])]),req,{allowManualReply:true}),null);
});

test('manual help does not discard a separately reported real action',async()=>{
  const text='洗濯したよ。ポイントのグラフはどこ？';
  const action={operation:'create',targetId:null,kind:'housework',date:'2026-11-21',title:'洗濯',evidence:'洗濯した',minutes:null,kcal:null,weightKg:null,detail:null,additional:false};
  const f=generator([response([call(['points'])]),response([manualAnswer('「きろく」の「えらいポイント」でグラフを見られるよ。','洗濯できたんだね。',[action])])]);
  const result=await f.generate(input(text),'owner');assert.equal(result.status,200);assert.equal(result.body.actions.length,1);assert.equal(result.body.actions[0].kind,'housework');assert.match(result.body.reply,/えらいポイント/);assert.equal(result.body.manualReply,undefined);
});

test('combined ordinary and manual reply still has one 600-character display limit',()=>{
  const req=validateChatRequest(input());
  assert.equal(extractReport(response([manualAnswer('あ'.repeat(300),'い'.repeat(300))]),req,{allowManualReply:true}),null);
  for(const text of [{invalid:true},null])assert.equal(extractReport(response([manualAnswer(text)]),req,{allowManualReply:true}),null);
});

test('invalid arguments return a bounded tool error and can be corrected without exposing values',async()=>{
  const invalid={...call(),arguments:JSON.stringify({sections:['../../.env.local'],path:'private-sentinel'})};
  const f=generator([response([invalid]),response([call(['account'],'manual-2')]),response([answer('右上の「…」から「アカウント」を開いてね。')])]);
  const result=await f.generate(input('ログインはどうするの？'),'owner');assert.equal(result.status,200);
  const error=f.sent[1].body.input.at(-1).output;assert.match(error,/invalid_manual_sections/);assert.doesNotMatch(error,/private-sentinel|\.env/);
  assert.equal(f.sent[2].body.tool_choice,'none');
});

test('unsupported, malformed, parallel and duplicate tool calls never start an unbounded loop',async()=>{
  for(const tool of [{...call(),name:'read_file'},{...call(),call_id:''},{...call(),arguments:'x'.repeat(2001)},{...call(),status:'in_progress'}]){
    const f=generator([response([tool])]);assert.equal((await f.generate(input(),'owner')).status,502);assert.equal(f.sent.length,1);
  }
  const parallel=generator([response([call(),call(['chat'],'manual-2')])]);assert.equal((await parallel.generate(input(),'owner')).status,502);assert.equal(parallel.sent.length,1);
  const duplicate=generator([response([call()]),response([call()])]);assert.equal((await duplicate.generate(input(),'owner')).status,502);assert.equal(duplicate.sent.length,2);
  const loop=generator([response([call()]),response([call(['chat'],'manual-2')]),response([call(['settings'],'manual-3')])]);
  assert.equal((await loop.generate(input(),'owner')).status,502);assert.equal(loop.sent.length,3);assert.equal(loop.sent[2].body.tool_choice,'none');
});

test('output budget includes all rounds and unknown intermediate usage fails closed',async()=>{
  for(const tokens of [undefined,2400,2401]){
    const result=response([call()],tokens);if(tokens===undefined)delete result.usage;
    const f=generator([result]);assert.equal((await f.generate(input(),'owner')).status,502);assert.equal(f.sent.length,1);
  }
  const f=generator([response([call()],2350),response([answer()],40)]);assert.equal((await f.generate(input(),'owner')).status,200);assert.equal(f.sent[1].body.max_output_tokens,50);
  const exceeded=generator([response([call()],2350),response([answer()],51)]);assert.equal((await exceeded.generate(input(),'owner')).status,502);
});

test('welcome cannot invoke the manual; failures after a tool call do not become visible tool replies',async()=>{
  const welcome=generator([response([answer('おかえり。')])]);assert.equal((await welcome.generate({...input(),context:{welcome:true}},'owner')).status,200);assert.deepEqual(welcome.sent[0].body.tools,[]);assert.equal(welcome.sent[0].body.tool_choice,'none');
  const unexpected=generator([response([call()])]);assert.equal((await unexpected.generate({...input(),context:{welcome:true}},'owner')).status,502);
  for(const failure of [new Response('private upstream detail',{status:429}),new Error('private timeout detail'),{status:'incomplete',output:[answer()]}]){
    const f=generator([response([call()]),failure]);const result=await f.generate(input(),'owner');assert.ok(result.status>=400);assert.doesNotMatch(JSON.stringify(result.body),/private|sections|function_call|"reply"/);
  }
});

test('one deadline covers the tool continuation instead of resetting for each response',async()=>{
  let calls=0;
  const generate=createReportGenerator({apiKey:'fixture',timeoutMs:1,fetchImpl:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,15));return Response.json(response([call()]));}});
  assert.equal((await generate(input(),'owner')).status,504);assert.equal(calls,1);
});

test('slow usage accounting cannot discard a completed final reply after the network deadline',async()=>{
  const f=generator([response([answer()])],{timeoutMs:5,onUsage:async()=>{await new Promise(resolve=>setTimeout(resolve,15));}});
  assert.equal((await f.generate(input(),'owner')).status,200);assert.equal(f.sent.length,1);
});

test('help through the real account API uses one quota slot, replays safely and creates no activity',async()=>{
  const store=new MemoryAccountStore(),f=generator([response([call(['records'])]),response([answer('「きろく」で対象の行動の「訂正」を選んでね。')])]);
  const api=createAccountAPI({store,config:{},verify:async()=>({uid:'manual-fixture'}),generate:f.generate,now:()=>Date.parse('2026-11-21T03:00:00Z')});
  async function post(path,data){
    const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{method:'POST',url:path,headers:{host:'app.example',origin:'https://app.example',authorization:'Bearer fixture'}});
    let status,body;assert.equal(await api(req,{writeHead(s){status=s;},end(value){body=JSON.parse(value);}},path),true);return {status,body};
  }
  assert.equal((await post('/api/commands',{requestId:randomUUID(),revision:0,command:{type:'initialize'}})).status,200);
  const before=await store.read('manual-fixture'),request={requestId:randomUUID(),text:'食事の記録を訂正するにはどうするの？'};
  const saved=await post('/api/chat',request);assert.equal(saved.status,200);assert.equal(f.sent.length,2);
  const state=await store.read('manual-fixture');assert.deepEqual(state.progress.activities,before.progress.activities);assert.equal(progressTotal(state.progress),progressTotal(before.progress));assert.deepEqual(state.interactionPreferences,{...before.interactionPreferences,turns:before.interactionPreferences.turns+1});
  assert.equal(state.conversation.messages.length,2);assert.doesNotMatch(JSON.stringify(state),/function_call|availableSections|manual-1/);
  assert.ok([...store.usages.values()].every(u=>u.count===1));
  const again=await post('/api/chat',request);assert.equal(again.status,200);assert.equal(f.sent.length,2);assert.equal((await store.read('manual-fixture')).revision,state.revision);
});
