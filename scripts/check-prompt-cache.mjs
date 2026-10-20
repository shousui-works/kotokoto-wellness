// Synthetic non-health dialogue only. No user account, Firestore or local records.
// The existing Secret Manager key is held in memory and is never printed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createReportGenerator} from '../server/komugi-chat.mjs';
let apiKey;
try{apiKey=execFileSync('gcloud',['secrets','versions','access','1','--secret','kotokoto-biyori-openai-api-key','--project','kotokoto-biyori'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{throw Error('Secret Manager key could not be loaded; secret output suppressed');}
const metrics=[];
const generate=createReportGenerator({apiKey,timeoutMs:30000,onUsage:e=>{metrics.push(e);console.log(JSON.stringify(e));}});
const input={requestId:randomUUID(),context:{date:'2026-10-19',hour:10,stage:'puppy',nickname:'テストの人',petName:'テストの犬',ownerMemory:'架空のテスト人物は青いボールが好き。',memoryThroughDate:'2026-10-18',hasWeight:false,weightKg:null,weightDate:null,weightSource:null,activities:[]},messages:[{role:'user',content:'これは架空の会話テストです。青いボールってかわいいね。'}]};
const first=await generate(input,'synthetic-cache-check');assert.equal(first.status,200);
// Same prefix, different transient time; then append a full exchange and new user message.
assert.equal((await generate({...input,requestId:randomUUID(),context:{...input.context,hour:11}},'synthetic-cache-check')).status,200);
assert.equal((await generate({...input,requestId:randomUUID(),context:{...input.context,hour:12},messages:[...input.messages,{role:'assistant',content:first.body.reply},{role:'user',content:'黄色いボールもかわいいね。'}]},'synthetic-cache-check')).status,200);
assert.ok(metrics.slice(1).some(m=>m.cachedTokens>0),'No cache reuse observed');
console.log('PASS: real Luna responses and prompt cache reuse with synthetic dialogue');
