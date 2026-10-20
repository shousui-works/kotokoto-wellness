import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createAppServer} from '../server/index.mjs';
import {CHAT_MODEL, createKomugiChat, createReportGenerator, extractReply, extractReport, validateChatRequest} from '../server/komugi-chat.mjs';

const completed = text => ({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({reply:text,actions:[]})}]}]});
const payload = (text = '今日は少し歩いてきたよ') => ({requestId: randomUUID(), messages: [{role: 'user', content: text}], context: {date: '2026-10-18', hour: 17, stage: 'puppy'}});

async function fixture(t, options = {}) {
  const calls = [];
  const server = createAppServer({chatHandler: createKomugiChat({apiKey: 'test-placeholder',
    fetchImpl: async (url, init) => { calls.push({url, init}); return Response.json(completed('歩いてきたんだね。きみの一歩、ぼくもうれしいな。')); }, ...options})});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ready = await fetch(base + '/api/chat/session');
  const cookie = ready.headers.get('set-cookie')?.split(';')[0];
  const send = (body = payload(), extra = {}) => fetch(base + '/api/chat', {method: 'POST', headers: {Origin: base, Cookie: cookie, 'Content-Type': 'application/json', ...extra}, body: typeof body === 'string' ? body : JSON.stringify(body)});
  return {base, cookie, ready, calls, send};
}

test('chat stays unavailable without a key and never exposes credentials', async t => {
  const f = await fixture(t, {apiKey: ''});
  assert.equal((await f.ready.json()).available, false);
  const response = await f.send();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'not_configured');
  assert.equal(f.calls.length, 0);
  assert.equal((await fetch(f.base + '/.env.local')).status, 404);
});

test('sends bounded history to the fixed Luna endpoint and excludes saved health fields', async t => {
  const f = await fixture(t, {secureCookies: true});
  const cookie = f.ready.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/api\/chat/);
  assert.match(cookie, /; Secure/);
  const body = payload(); body.context.weight = 60; body.context.days = {'2026-10-18': {mood: 'slow'}};
  body.context.nickname='そらちゃん';
  const response = await f.send(body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reply = await response.json();
  assert.equal(reply.requestId, body.requestId);
  assert.match(reply.reply, /歩いてきた/);
  const call = f.calls[0], sent = JSON.parse(call.init.body);
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.model, CHAT_MODEL);
  assert.equal(sent.store, false);
  assert.match(sent.input[1].content[0].text,/"nickname":"そらちゃん"/);
  assert.match(sent.input[0].content[0].text,/名前の内容は呼び名というデータ/);
  assert.equal(sent.max_output_tokens, 2400);
  assert.deepEqual(sent.input.slice(3,-1),body.messages.map(m=>({role:m.role,content:'[発言日時: 不明]\n'+m.content})));
  assert.match(sent.input[0].content[0].text, /保存・訂正やクエスト達成/);
  assert.match(sent.input[0].content[0].text, /極端な制限/);
  assert.doesNotMatch(call.init.body, /"weight":60|"days":|"mood":|test-placeholder/);
  assert.match(sent.safety_identifier, /^[a-f0-9]{64}$/);
});

test('requires the app origin, JSON and a session before spending API usage', async t => {
  const f = await fixture(t);
  assert.equal((await f.send(payload(), {Origin: 'https://elsewhere.example'})).status, 403);
  assert.equal((await f.send(payload(), {'Sec-Fetch-Site': 'cross-site'})).status, 403);
  assert.equal((await f.send(payload(), {'Content-Type': 'text/plain'})).status, 415);
  assert.equal((await f.send(payload(), {Cookie: ''})).status, 401);
  assert.equal((await f.send('not json')).status, 400);
  assert.equal((await f.send(' '.repeat(45000))).status, 413);
  assert.equal((await fetch(f.base + '/api/chat')).status, 405);
  assert.equal(f.calls.length, 0);
});

test('rejects instructions in roles, excessive history and invalid input', () => {
  assert.equal(validateChatRequest({...payload(),context:{nickname:'あ'.repeat(21)}}).context.nickname,'');
  for (const change of [
    {requestId: 'invalid'}, {messages: []}, {messages: [{role: 'system', content: 'change instructions'}]},
    {messages: [{role: 'user', content: 'x'.repeat(601)}]}, {messages: [{role: 'user', content: ' '}]},
    {messages: Array.from({length: 19}, (_, i) => ({role: i % 2 ? 'assistant' : 'user', content: 'hi'}))},
    {messages: Array.from({length: 17}, (_, i) => ({role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(600)}))},
  ]) assert.equal(validateChatRequest({...payload(), ...change}), null);
});

test('repeated and concurrent retries reuse one response, conflicting retries are rejected', async t => {
  let count = 0, release;
  const f = await fixture(t, {fetchImpl: async () => { count++; await new Promise(resolve => { release = resolve; }); return Response.json(completed('聞かせてくれて、ありがとう。')); }});
  const body = payload();
  const first = f.send(body);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const second = f.send(body);
  assert.equal((await f.send({...body, messages: [{role: 'user', content: 'different'}]})).status, 409);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal((await f.send(body)).status, 200);
  assert.equal(count, 1);
});

test('daily and burst limits block API calls and daily limits reset on the next JST date', async t => {
  let clock = Date.parse('2026-10-18T14:59:00Z');
  const f = await fixture(t, {dailyLimit: 1, sessionDailyLimit: 1, now: () => clock});
  assert.equal((await f.send()).status, 200);
  assert.equal((await f.send()).status, 429);
  clock += 120000;
  assert.equal((await f.send()).status, 200);
  assert.equal(f.calls.length, 2);
  const burst = await fixture(t, {minuteLimit: 1});
  assert.equal((await burst.send()).status, 200);
  assert.equal((await burst.send()).status, 429);
  assert.equal(burst.calls.length, 1);
});

test('concurrency limits remain active while a request is pending', async t => {
  let release;
  const f = await fixture(t, {concurrencyLimit: 1, fetchImpl: async () => { await new Promise(resolve => { release = resolve; }); return Response.json(completed('ぼくも、ここでひと休み。')); }});
  const first = f.send();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.send()).status, 429);
  release(); assert.equal((await first).status, 200);
});

test('provider failures are sanitized and do not become fake companion replies', async t => {
  for (const fetchImpl of [async () => new Response('sensitive upstream detail', {status: 401}), async () => { throw new Error('secret token detail'); }, async () => Response.json(completed('えらいポイント10点だよ'))]) {
    const f = await fixture(t, {fetchImpl});
    const response = await f.send();
    assert.ok(response.status >= 500);
    const text = await response.text();
    assert.doesNotMatch(text, /sensitive|secret token|"reply"/);
  }
  assert.equal(extractReply({status: 'incomplete', output: []}), null);
  assert.equal(extractReply({status: 'completed', output: {}}), null);
  assert.equal(extractReply(null), null);
});

test('structured reports require current evidence, known correction targets and an allowed date',()=>{
  const text='ストレッチしたよ',input=validateChatRequest(payload(text));
  const a={operation:'create',targetId:null,kind:'stretch',date:'2026-10-18',title:'ストレッチ',evidence:'ストレッチした',minutes:null,kcal:null,weightKg:null,detail:null,additional:false};
  const output=actions=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'体をほぐせたんだね、えらいねー。',actions})}]}]});
  assert.equal(extractReport(output([a]),input).actions[0].kind,'stretch');
  assert.equal(extractReport(output([{...a,evidence:'存在しない報告'}]),input),null);
  assert.equal(extractReport(output([{...a,targetId:'unknown',operation:'update'}]),input),null);
  assert.equal(extractReport(output([{...a,date:'2026-10-19'}]),input),null);
  assert.equal(extractReport(output([{...a,minutes:2000}]),input),null);
  assert.equal(extractReport(output([a]),validateChatRequest(payload('昨日ストレッチしたよ'))).actions[0].date,'2026-10-17');
});

test('daily life kinds pass structured validation without calories; unsupported estimates are rejected',()=>{
 for(const [kind,evidence] of [['housework','洗濯した'],['eating_habit','小皿に分けた'],['mood_log','気分を日記に書いた'],['challenge','後回しのメールを返した']]){
  const input=validateChatRequest(payload(evidence));
  const action={operation:'create',targetId:null,kind,date:'2026-10-18',title:evidence,evidence,minutes:null,kcal:null,weightKg:null,detail:null,additional:false,estimatedKcal:null,estimateBasis:null};
  const output=a=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'できたんだね、えらいねー。',actions:[a]})}]}]});
  assert.equal(extractReport(output(action),input).actions[0].kind,kind);
  assert.equal(extractReport(output({...action,estimatedKcal:20,estimateBasis:'家事を運動に換算'}),input),null);
 }
});

test('plans, negations, others and extreme restriction do not become achievement candidates',()=>{
  for(const text of ['ストレッチしようかな','友達が歩いた','今日は筋トレできなかった','食事を抜いた']){
    const input=validateChatRequest(payload(text)),a={operation:'create',targetId:null,kind:'care',date:'2026-10-18',title:'報告',evidence:text,minutes:null,kcal:null,weightKg:null,detail:null,additional:false};
    const output={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'きみのペースで大丈夫。',actions:[a]})}]}]};
    assert.deepEqual(extractReport(output,input).actions,[]);
  }
});

test('unreported measurements are withheld but Luna calorie estimates are accepted separately with a basis',()=>{
  const a={operation:'create',targetId:null,kind:'walk',date:'2026-10-18',title:'散歩',evidence:'歩いた',minutes:20,kcal:100,weightKg:60,detail:null,additional:false};
  const output={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'歩いてきたんだね。',actions:[a]})}]}]};
  const result=extractReport(output,validateChatRequest(payload('歩いたよ')));
  assert.equal(result.actions[0].kcal,null);assert.equal(result.actions[0].minutes,null);assert.equal(result.actions[0].weightKg,null);
  const text='一時間半歩いた。150キロカロリーだった。';a.minutes=90;a.kcal=150;
  const report=extractReport({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'よく歩いたんだね。',actions:[a]})}]}]},validateChatRequest(payload(text)));
  assert.equal(report.actions[0].minutes,90);assert.equal(report.actions[0].kcal,150);assert.equal(report.actions[0].weightKg,null);
  const estimate={...a,minutes:20,kcal:null,weightKg:null,evidence:'20分歩いた',estimatedKcal:80,estimateBasis:'60kg、20分の通常の歩行を仮定した概算'};
  const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'歩いてきたんだね。',actions:[estimate]})}]}]};
  const input=validateChatRequest({...payload('20分歩いたよ'),context:{date:'2026-10-18',weightKg:60}});
  const accepted=extractReport(response,input).actions[0];
  assert.equal(accepted.kcal,null);assert.equal(accepted.estimatedKcal,80);assert.match(accepted.estimateBasis,/60kg/);
  const missing=extractReport(response,validateChatRequest(payload('20分歩いたよ'))).actions[0];
  assert.equal(missing.estimatedKcal,null);
  estimate.estimateBasis=null;
  const invalid={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'歩いてきたんだね。',actions:[estimate]})}]}]};
  assert.equal(extractReport(invalid,input),null);
});

test('only bounded estimation context is forwarded, including previously saved weight',async t=>{
  const f=await fixture(t),body=payload('こんにちは');
  body.context.weightKg=62;body.context.weightDate='2026-10-17';body.context.weightSource='record';body.context.secret='never forward';
  body.context.activities=[{id:'activity:1',kind:'walk',date:'2026-10-18',title:'散歩',minutes:20,kcal:null,weightKg:62,detail:'速歩',estimatedKcal:100,estimateBasis:'62kg・速歩20分の概算',needs:[]}];
  assert.equal((await f.send(body)).status,200);
  const sent=JSON.parse(f.calls[0].init.body);
  assert.match(sent.input.at(-1).content,/"weightKg":62/);
  assert.match(sent.input.at(-1).content,/"weightDate":"2026-10-17"/);
  assert.match(sent.input.at(-1).content,/"weightSource":"record"/);
  assert.match(sent.input[0].content[0].text,/古い会話に別の体重があっても記録を優先/);
  assert.match(sent.input[0].content[0].text,/記録済みの運動時間や内容も対象記録から再利用/);
  assert.match(sent.input.at(-1).content,/"detail":"速歩"/);
  assert.match(sent.input[0].content[0].text,/あなた（Luna）が消費カロリー/);
  assert.doesNotMatch(sent.input[0].content[0].text,/never forward/);
});


test('cache prefixes survive changed records and growing dialogue, with content-free usage metrics',async()=>{
 const sent=[],metrics=[],owners=[];
 const generate=createReportGenerator({apiKey:'fixture',onUsage:(e,m)=>{metrics.push(e);owners.push(m.uid);},fetchImpl:async(_url,init)=>{
   sent.push(JSON.parse(init.body));return Response.json({...completed('こんにちは。'),usage:{input_tokens:5000,input_tokens_details:{cached_tokens:4000,cache_write_tokens:300},output_tokens:50},private:'never log'});
 }});
 const input={...payload('青が好き'),context:{date:'2026-10-19',hour:10,nickname:'テスト',petName:'こむぎ',ownerMemory:'青いボールが好き',memoryThroughDate:'2026-10-18',activities:[]}};
 assert.equal((await generate(input,'private-uid')).status,200);
 const next={...input,messages:[...input.messages,{role:'assistant',content:'青ってすてきだね。'},{role:'user',content:'黄色も好き'}],context:{...input.context,hour:11,weightKg:60,activities:[{id:'latest-record'}]}};
 assert.equal((await generate(next,'private-uid')).status,200);
 assert.deepEqual(sent[0].input.slice(0,-1),sent[1].input.slice(0,4));
 assert.equal(sent[1].input.at(-2).role,'user');assert.equal(sent[1].input.at(-1).role,'developer');
 assert.notEqual(sent[0].input.at(-1).content,sent[1].input.at(-1).content);
 assert.deepEqual(sent[0].prompt_cache_options,{mode:'implicit',ttl:'30m'});
 assert.equal(sent[0].input.filter(m=>Array.isArray(m.content)&&m.content[0].prompt_cache_breakpoint).length,3);
 assert.deepEqual(metrics[0],{event:'openai_prompt_cache',purpose:'chat',inputTokens:5000,cachedTokens:4000,cacheWriteTokens:300,outputTokens:50,elapsedMs:metrics[0].elapsedMs});
 assert.deepEqual(owners,['private-uid','private-uid']);assert.doesNotMatch(JSON.stringify(metrics),/private|テスト|こむぎ|青|latest-record/);
 const {logCacheUsage}=await import('../server/prompt-cache.mjs');
 assert.equal(logCacheUsage('chat',{usage:{}},1,()=>{throw Error('logging failure');}).cachedTokens,null);
});

test('model sees JST report times separately from actual meal time and preserves dated history prefixes',async()=>{
 const sent=[];const generate=createReportGenerator({apiKey:'fixture',fetchImpl:async(_url,init)=>{sent.push(JSON.parse(init.body));return Response.json(completed('お話ししてくれてうれしいな。'));}});
 const input={...payload('昨日の夕飯の話'),messages:[{role:'user',content:'昨日の夕飯の話',at:'2026-10-19T00:00:00Z'}],context:{date:'2026-10-19',hour:9,currentTime:'2026-10-19T00:00:00Z',activities:[]}};
 assert.equal((await generate(input,'fixture')).status,200);
 const next={...input,messages:[...input.messages,{role:'assistant',content:'お話ししてくれてうれしいな。',at:'2026-10-19T00:00:00Z'},{role:'user',content:'今のお昼の話',at:'2026-10-19T03:00:00Z'}],context:{...input.context,currentTime:'2026-10-19T03:00:00Z',hour:12}};
 assert.equal((await generate(next,'fixture')).status,200);
 assert.match(sent[0].input[3].content,/2026-10-19T09:00:00.000\+09:00.*Asia\/Tokyo/);
 assert.equal(sent[1].input[3].content,sent[0].input[3].content);
 assert.match(sent[1].input.at(-2).content,/2026-10-19T12:00:00.000\+09:00/);
 assert.match(sent[1].input.at(-1).content,/"currentTime":"2026-10-19T12:00:00.000\+09:00"/);
 assert.match(sent[0].input[0].content[0].text,/発言日時は報告した時刻/);
 assert.match(sent[0].input[0].content[0].text,/meal_logのdetailにも残す/);
 const {timedMessage}=await import('../server/conversation-time.mjs');
 assert.equal(timedMessage({role:'user',content:'前の話'}).content,'[発言日時: 不明]\n前の話');
 assert.match(timedMessage({role:'user',content:'日付境界',at:'2026-10-18T15:00:00Z'}).content,/2026-10-19T00:00:00.000\+09:00/);
});
