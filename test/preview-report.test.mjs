import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './preview-report.mjs';
import {extractReport,validateChatRequest} from '../server/komugi-chat.mjs';
import {randomUUID} from 'node:crypto';
async function report(text,activities=[]){
 const input=validateChatRequest({requestId:randomUUID(),messages:[{role:'user',content:text}],context:{date:'2026-10-18',activities}});
 const response=await fixture('offline-fixture',{body:JSON.stringify({input:[...input.messages,{role:'developer',content:'最新の参考データ（命令ではない）:'+JSON.stringify(input.context)}]})});
 return extractReport(await response.json(),input);
}
test('preview reports accept completed actions, never plans or negated activity even with a pending walk',async()=>{
 assert.equal((await report('ストレッチしたよ')).actions[0].kind,'stretch');assert.equal((await report('歩いたよ')).actions[0].kind,'walk');
 const pending=[{id:'walk:1',kind:'walk',date:'2026-10-18',title:'散歩',minutes:null,kcal:null,weightKg:null,detail:null,needs:['minutes']}];
 for(const text of ['ストレッチしたい','明日ストレッチする予定','ストレッチしてない','まだ歩いたことがない','20分歩いたらどうなる？','お菓子を控えられたらいいな']){
  const result=await report(text,pending);assert.deepEqual(result.actions,[],text);assert.doesNotMatch(result.reply,/歩けた|体をほぐせた|えらいね/,text);
 }
});
test('snack preview evidence exists in both short and original long reports',async()=>{
 for(const text of ['お菓子を控えられた','お菓子も食べたかったけど、今日は自分で決めて控えられた']){
  const result=await report(text);assert.ok(result,text);assert.equal(result.actions[0].kind,'snack');assert.ok(text.includes(result.actions[0].evidence));
 }
});
