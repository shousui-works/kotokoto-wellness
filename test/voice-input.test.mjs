import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceInput} from '../dist/voice-input.mjs';

function fixture(options={}){
  const instances=[],states=[],timers=new Map();let id=0,changes=0,completions=0;
  const input={value:'',selectionStart:0,selectionEnd:0,maxLength:600,focus(){this.focused=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},...options.input};
  class Recognition{
    constructor(){instances.push(this);this.starts=0;this.stops=0;this.aborts=0;}
    start(){this.starts++;if(options.startThrows)throw Error('denied');}
    stop(){this.stops++;}
    abort(){this.aborts++;}
  }
  const voice=createVoiceInput({input,Recognition:options.unsupported?null:Recognition,canStart:()=>options.allowed!==false,
    onState:s=>states.push(s),onInput:()=>changes++,onComplete:()=>{assert.equal(voice.active,false);completions++;},schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:key=>timers.delete(key)});
  const result=(...parts)=>({results:parts.map(text=>Object.assign([{transcript:text}],{isFinal:true}))});
  const advance=ms=>{const next=[...timers].find(([,t])=>t.ms===ms);assert.ok(next,'timer '+ms);timers.delete(next[0]);next[1].fn();};
  return {voice,input,instances,states,timers,result,advance,get changes(){return changes;},get completions(){return completions;}};
}
test('voice starts only on request, uses Japanese and fills a draft without duplicating partial results',()=>{
  const f=fixture({input:{value:'こむぎ、あとで',selectionStart:4,selectionEnd:7}});
  assert.equal(f.instances.length,0);f.voice.start();const rec=f.instances[0];assert.equal(rec.starts,1);assert.equal(rec.lang,'ja-JP');assert.equal(rec.continuous,false);assert.equal(rec.interimResults,true);
  rec.onstart();rec.onresult(f.result('こんにちは'));assert.equal(f.input.value,'こむぎ、こんにちは');
  rec.onresult(f.result('こんにちは、','会いに来たよ'));assert.equal(f.input.value,'こむぎ、こんにちは、会いに来たよ');
  assert.equal(f.completions,0);const lateEnd=rec.onend;rec.onend();lateEnd();assert.equal(f.voice.active,false);assert.equal(f.completions,1);assert.equal(f.voice.notice,'');assert.equal(f.timers.size,0);assert.equal(f.changes,2);
});
test('voice inserts at the cursor and preserves both sides of an existing draft',()=>{
  const f=fixture({input:{value:'今日は。おやすみ',selectionStart:3,selectionEnd:3}});f.voice.start();const rec=f.instances[0];rec.onstart();rec.onresult(f.result('洗濯した'));
  assert.equal(f.input.value,'今日は洗濯した。おやすみ');assert.equal(f.input.selectionStart,7);f.voice.cancel();assert.equal(f.input.value,'今日は洗濯した。おやすみ');
});
test('stop does not restart recognition and accepts the final result before ending',()=>{
  const f=fixture();f.voice.start();const rec=f.instances[0];rec.onstart();f.voice.start();f.voice.start();assert.equal(rec.stops,1);assert.equal(f.instances.length,1);
  rec.onresult(f.result('おかえり'));rec.onend();assert.equal(f.input.value,'おかえり');assert.equal(f.voice.active,false);assert.equal(f.timers.size,0);assert.equal(f.completions,1);
});
test('cancel and errors retain the draft, abort capture, and ignore stale callbacks',()=>{
  for(const reason of ['cancel','not-allowed','network','no-speech','audio-capture']){
    const f=fixture({input:{value:'入力済み',selectionStart:4,selectionEnd:4}});f.voice.start();const rec=f.instances[0];rec.onstart();const lateResult=rec.onresult;
    if(reason==='cancel')f.voice.cancel();else rec.onerror({error:reason});
    lateResult(f.result('遅れた結果'));assert.equal(f.input.value,'入力済み',reason);assert.equal(f.voice.active,false);assert.equal(rec.aborts,1);assert.equal(f.timers.size,0);assert.equal(f.completions,0);
  }
});
test('unsupported or disallowed recognition never requests microphone access',()=>{
  const unsupported=fixture({unsupported:true});unsupported.voice.start();assert.equal(unsupported.instances.length,0);assert.equal(unsupported.input.focused,true);assert.match(unsupported.voice.notice,/キーボード/);
  const blocked=fixture({allowed:false});blocked.voice.start();assert.equal(blocked.instances.length,0);assert.equal(blocked.voice.active,false);
  const throwing=fixture({startThrows:true});throwing.voice.start();assert.equal(throwing.voice.active,false);assert.equal(throwing.timers.size,0);assert.match(throwing.voice.notice,/許可/);
});
test('recognition enforces 600 UTF-16 characters without cutting an emoji or removing the suffix',()=>{
  const f=fixture({input:{value:'あ'.repeat(597)+'。',selectionStart:597,selectionEnd:597}});f.voice.start();const rec=f.instances[0];rec.onstart();rec.onresult(f.result('🐾あ'));
  assert.equal(f.input.value,'あ'.repeat(597)+'🐾。');assert.equal(f.input.value.length,600);assert.equal(rec.stops,1);rec.onend();assert.match(f.voice.notice,/600文字/);
  assert.equal(f.completions,0);
  const g=fixture({input:{value:'あ'.repeat(599),selectionStart:599,selectionEnd:599}});g.voice.start();const second=g.instances[0];second.onstart();second.onresult(g.result('🐾'));assert.equal(g.input.value,'あ'.repeat(599));second.onend();assert.equal(g.timers.size,0);
});
test('startup, listening, and stop timeouts are bounded and clear all timers',()=>{
  const f=fixture();f.voice.start();f.advance(15000);assert.equal(f.voice.active,false);assert.equal(f.instances[0].aborts,1);assert.equal(f.timers.size,0);
  f.voice.start();const rec=f.instances[1];rec.onstart();f.advance(30000);assert.equal(rec.stops,1);f.advance(3000);assert.equal(f.voice.active,false);assert.equal(rec.aborts,1);assert.equal(f.timers.size,0);
  assert.equal(f.completions,0);
});
test('empty speech and unfinished interim text never submit an existing draft',()=>{
  for(const text of ['', '途中の言葉']){
    const f=fixture({input:{value:'送らない下書き',selectionStart:7,selectionEnd:7}});f.voice.start();const rec=f.instances[0];rec.onstart();
    if(text){const partial=f.result(text);partial.results[0].isFinal=false;rec.onresult(partial);}
    rec.onend();assert.equal(f.completions,0);assert.ok(f.input.value.startsWith('送らない下書き'));
  }
});
test('an error or cancellation after a final result still keeps the text without completing',()=>{
  for(const reason of ['cancel','network','no-speech']){
    const f=fixture();f.voice.start();const rec=f.instances[0];rec.onstart();rec.onresult(f.result('まだ送らない'));const lateEnd=rec.onend;
    if(reason==='cancel')f.voice.cancel();else rec.onerror({error:reason});
    lateEnd();assert.equal(f.input.value,'まだ送らない');assert.equal(f.completions,0);assert.equal(f.timers.size,0);
  }
});
test('destroying capture detaches callbacks and retains recognized text',()=>{
  const f=fixture();f.voice.start();const rec=f.instances[0];rec.onstart();rec.onresult(f.result('こんにちは'));f.voice.destroy();assert.equal(rec.onresult,null);assert.equal(f.input.value,'こんにちは');assert.equal(f.timers.size,0);assert.equal(f.voice.notice,'');
});
