import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationTimestamp,timedMessage} from '../server/conversation-time.mjs';

test('invalid calendar dates remain unknown instead of rolling into another month',()=>{
 for(const at of ['2026-02-30T12:00:00Z','2025-02-29T12:00:00+09:00','1900-02-29T12:00:00Z','2026-04-31T12:00:00-07:00','2026-00-01T12:00:00Z','2026-13-01T12:00:00Z','2026-01-00T12:00:00Z']){
  assert.equal(conversationTimestamp(at),null,at);
  assert.equal(timedMessage({role:'user',content:'前の話',at}).content,'[発言日時: 不明]\n前の話');
 }
 assert.equal(conversationTimestamp('2024-02-29T23:00:00-07:00'),'2024-03-01T15:00:00.000+09:00');
 assert.equal(conversationTimestamp('2000-02-29T00:00:00+09:00'),'2000-02-29T00:00:00.000+09:00');
});

test('imported minute-precision times retain their explicit timezone',()=>{
 assert.equal(conversationTimestamp('2026-03-01T12:34+09:00'),'2026-03-01T12:34:00.000+09:00');
 assert.equal(conversationTimestamp('2026-03-01T23:34Z'),'2026-03-02T08:34:00.000+09:00');
 for(const at of ['2026-03-01','2026-03-01T12:34','2026-03-01T12:34:56','2026-02-30T12:34+09:00'])assert.equal(conversationTimestamp(at),null,at);
});
