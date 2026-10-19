import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CONVERSATION_STORAGE, appendExchange, loadConversation, normalizeConversation, requestMessages,bindChatEnter} from '../dist/komugi-conversation.mjs';
import {speechPages} from '../dist/companion-bubble.mjs';

const at = '2026-10-18T12:00:00.000Z';
function enterFixture(){
  const listeners=new Map();let sent=0,time=1000;
  const input={addEventListener:(type,fn)=>listeners.set(type,fn)};
  bindChatEnter(input,{requestSubmit:()=>sent++},()=>time);
  return {get sent(){return sent;},advance:ms=>time+=ms,emit(type,values={}){const event={key:'Enter',shiftKey:false,isComposing:false,keyCode:13,repeat:false,prevented:false,preventDefault(){this.prevented=true;},...values};listeners.get(type)?.(event);return event;}};
}
test('Enter sends once, Shift+Enter inserts a newline, held Enter does not resend',()=>{
  const f=enterFixture();assert.equal(f.emit('keydown').prevented,true);assert.equal(f.sent,1);
  assert.equal(f.emit('keydown',{repeat:true}).prevented,true);assert.equal(f.sent,1);
  assert.equal(f.emit('keydown',{shiftKey:true}).prevented,false);
  assert.equal(f.emit('beforeinput',{inputType:'insertLineBreak'}).prevented,false);assert.equal(f.sent,1);
  f.emit('keyup');f.emit('keydown',{ctrlKey:true});assert.equal(f.sent,2);
});
test('Japanese IME confirmation never sends, including Safari compositionend before Enter',()=>{
  const f=enterFixture();f.emit('compositionstart');f.emit('keydown');assert.equal(f.sent,0);
  f.emit('compositionend');f.emit('keydown');f.emit('beforeinput',{inputType:'insertLineBreak'});assert.equal(f.sent,0);
  f.advance(100);f.emit('keydown',{isComposing:true});f.emit('keydown',{keyCode:229});assert.equal(f.sent,0);
  f.emit('keydown');assert.equal(f.sent,1);
});
test('phone keyboards can send through a line-break beforeinput without keydown',()=>{
  const f=enterFixture();assert.equal(f.emit('beforeinput',{inputType:'insertLineBreak'}).prevented,true);assert.equal(f.sent,1);
  f.emit('beforeinput',{inputType:'insertCompositionText'});assert.equal(f.sent,1);
  f.emit('compositionstart');f.emit('beforeinput',{inputType:'insertParagraph'});assert.equal(f.sent,1);
});
test('the head bubble retains a long reply and its followup without truncating or breaking emoji',()=>{
  const reply='よく頑張ったね。'+('歩けたこと、ぼくもうれしいな🐾。'.repeat(22))+'どのくらい歩いたの？';
  const pages=speechPages(reply);
  assert.ok(pages.length>1);
  assert.equal(pages.join(''),reply);
  assert.ok(pages.every(page=>Array.from(page).length<=100));
  assert.match(pages.at(-1),/どのくらい歩いたの？$/);
  assert.deepEqual(speechPages('おかえり。'),['おかえり。']);
});
test('conversation storage is separate and corrupt or future data is never overwritten', () => {
  for (const raw of ['{bad json', '{"version":2,"messages":[]}', '{"version":1,"messages":[{"role":"user"}]}']) {
    let writes = 0;
    const storage = {getItem: key => { assert.equal(key, CONVERSATION_STORAGE); return raw; }, setItem: () => writes++};
    assert.equal(loadConversation(storage).writable, false);
    assert.equal(writes, 0);
  }
  assert.notEqual(CONVERSATION_STORAGE, 'kotokoto-wellness-v1');
  assert.equal(loadConversation({getItem: () => { throw new Error('denied'); }}).writable, false);
});

test('only completed exchanges are retained and history has thirty pairs', () => {
  let data = {version: 1, messages: []};
  for (let i = 0; i < 40; i++) data = appendExchange(data, `hello ${i}`, `reply ${i}`, at);
  assert.equal(data.messages.length, 60);
  assert.equal(data.messages[0].content, 'hello 10');
  assert.equal(data.messages.at(-1).content, 'reply 39');
  assert.deepEqual(normalizeConversation(data), data);
  assert.throws(() => normalizeConversation({version: 1, messages: [{role: 'user', content: 'pending', at}]}));
});

test('API history contains bounded text only, without browser records or timestamps', () => {
  let data = {version: 1, messages: []};
  for (let i = 0; i < 20; i++) data = appendExchange(data, 'x'.repeat(600), 'y'.repeat(600), at);
  data.weight = 60;
  const messages = requestMessages(data, '今日も来たよ');
  assert.ok(messages.length <= 17);
  assert.ok(messages.reduce((sum, message) => sum + message.content.length, 0) <= 5000);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages.at(-1).content, '今日も来たよ');
  assert.ok(messages.every(message => Object.keys(message).join(',') === 'role,content'));
});
