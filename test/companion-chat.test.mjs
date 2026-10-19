import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_STORAGE,CHAT_TIMING,conversationPeriod,companionChatLine,createCompanionChat} from '../dist/companion-chat.mjs';
import {dateKey,emptyState,normalizeState} from '../dist/model.mjs';

const at=hour=>new Date(2026,9,18,hour,0,0);
function setup({stamp=at(9).getTime(),storage=new Map(),available=true,random=()=>0,state=emptyState()}={}){
  let current=stamp,nextId=0;const timers=new Map(),messages=[];
  const clock={now:()=>current,setTimeout(callback,delay){const id=++nextId;timers.set(id,{callback,at:current+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const cache={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const chat=createCompanionChat({getState:()=>state,canSpeak:()=>available,onMessage:value=>messages.push(value),storage:cache,random,clock});
  function advance(ms){
    const end=current+ms;
    while(true){
      const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;
      current=next[1].at;timers.delete(next[0]);next[1].callback();
    }
    current=end;
  }
  return {chat,messages,storage,advance,clock,setAvailable(value){available=value;chat.refresh();}};
}

test('時間帯の境目と深夜を端末の時刻で区別する',()=>{
  for(const [hour,period] of [[0,'night'],[4,'night'],[5,'morning'],[10,'morning'],[11,'noon'],[13,'noon'],[14,'afternoon'],[16,'afternoon'],[17,'evening'],[20,'evening'],[21,'night'],[23,'night']]){
    assert.equal(conversationPeriod(at(hour)),period);
  }
  assert.equal(companionChatLine(emptyState(),at(18)).periodKey,dateKey(at(18))+':evening');
});

test('時間帯を切り替えても直前と同じ言葉や固定の第一声に戻らない',()=>{
  const state=emptyState(),first=companionChatLine(state,at(9));
  const second=companionChatLine(state,at(9),{lastId:first.id,lastPeriodKey:first.periodKey},()=>0);
  assert.notEqual(first.id,second.id);
  const evening=companionChatLine(state,at(18),{lastId:second.id,lastPeriodKey:second.periodKey});
  assert.equal(evening.periodKey,dateKey(at(18))+':evening');
  const nextDay=new Date(2026,9,19,9);
  assert.notEqual(companionChatLine(state,nextDay,{lastId:first.id,lastPeriodKey:first.periodKey},()=>0).id,first.id);
  assert.notEqual(companionChatLine(state,at(9),{},()=>0).id,companionChatLine(state,at(9),{},()=>.999).id);
});

test('記録と気分に寄り添うが、保存済みの記録を変更しない',()=>{
  const now=at(15),state=normalizeState({version:1,days:{[dateKey(now)]:{habits:['walk'],mood:'slow',weight:60}},owned:[],decor:[]});
  const before=structuredClone(state),previous={lastPeriodKey:dateKey(now)+':afternoon'};
  const line=companionChatLine(state,now,previous,()=>.999);
  assert.equal(line.id,'afternoon-slow');
  assert.deepEqual(state,before);
});

test('最初は少し待ち、短く話してから戻り、次は数分後に話す',()=>{
  const t=setup();
  t.advance(CHAT_TIMING.first-1);assert.equal(t.messages.length,0);
  t.advance(1);assert.match(t.messages[0].text,/おはよう/);
  const first=t.messages[0];
  t.advance(CHAT_TIMING.duration);assert.equal(t.messages.at(-1),null);
  t.advance(CHAT_TIMING.minGap-CHAT_TIMING.duration-1);assert.equal(t.messages.length,2);
  t.advance(1);assert.notEqual(t.messages.at(-1).id,first.id);
  t.chat.destroy();
});

test('最大間隔でも7分以内に次の声かけが届く',()=>{
  const t=setup({random:()=>.999});
  t.advance(CHAT_TIMING.first);
  t.advance(CHAT_TIMING.maxGap);
  assert.equal(t.messages.filter(Boolean).length,2);t.chat.destroy();
});

test('非表示や入力画面では話さず、戻ってもまとめて連発しない',()=>{
  const t=setup({available:false});
  t.advance(20*60000);assert.equal(t.messages.length,0);
  t.setAvailable(true);t.advance(0);assert.equal(t.messages.filter(Boolean).length,1);
  t.setAvailable(false);assert.equal(t.messages.at(-1),null);
  t.advance(20*60000);assert.equal(t.messages.filter(Boolean).length,1);
  t.setAvailable(true);t.advance(0);assert.equal(t.messages.filter(Boolean).length,2);
  t.advance(1000);assert.equal(t.messages.filter(Boolean).length,2);t.chat.destroy();
});

test('記録やなでる反応を声かけより優先する',()=>{
  const t=setup();t.advance(2000);t.chat.interrupt();
  t.advance(CHAT_TIMING.reaction-1);assert.equal(t.messages.length,0);
  t.advance(1);assert.ok(t.messages.at(-1));
  t.chat.interrupt();assert.equal(t.messages.at(-1),null);t.chat.destroy();
});

test('再読み込みしても直後に繰り返さず、オフ設定を引き継ぐ',()=>{
  const storage=new Map(),first=setup({storage});first.advance(CHAT_TIMING.first);
  const stamp=first.clock.now();first.chat.destroy();
  const reloaded=setup({storage,stamp});reloaded.advance(CHAT_TIMING.first);
  assert.equal(reloaded.messages.length,0);
  reloaded.chat.setEnabled(false);reloaded.chat.destroy();
  const disabled=setup({storage,stamp});disabled.advance(30*60000);
  assert.equal(disabled.chat.enabled,false);assert.equal(disabled.messages.length,0);
  assert.equal(JSON.parse(storage.get(CHAT_STORAGE)).enabled,false);
  disabled.chat.setEnabled(true);disabled.advance(CHAT_TIMING.first);assert.ok(disabled.messages.at(-1));disabled.chat.destroy();
});

test('別のタブの声かけ直後は、同じタイミングで重ねない',()=>{
  const storage=new Map(),one=setup({storage}),two=setup({storage});
  one.advance(CHAT_TIMING.first);two.advance(CHAT_TIMING.first);
  assert.equal(one.messages.filter(Boolean).length,1);assert.equal(two.messages.length,0);
  one.chat.setEnabled(false);two.chat.sync();assert.equal(two.chat.enabled,false);
  one.chat.destroy();two.chat.destroy();
});

test('壊れた設定や未来の時刻があっても、声かけが永久に止まらない',()=>{
  for(const raw of ['broken',JSON.stringify({version:1,lastSpokenAt:at(20).getTime(),nextTalkAt:at(21).getTime()})]){
    const t=setup({storage:new Map([[CHAT_STORAGE,raw]])});
    t.advance(CHAT_TIMING.first);assert.ok(t.messages.at(-1));t.chat.destroy();
  }
});


test('声かけの直近8件を避ける履歴は再読み込み後も引き継がれる',()=>{
 const t=setup();t.advance(CHAT_TIMING.first);t.advance(CHAT_TIMING.minGap*4);
 const ids=t.messages.filter(Boolean).map(x=>x.id);assert.equal(new Set(ids).size,ids.length);
 const saved=JSON.parse(t.storage.get(CHAT_STORAGE));assert.ok(saved.recentIds.length>=4);assert.ok(saved.recentIds.length<=8);t.chat.destroy();
});
