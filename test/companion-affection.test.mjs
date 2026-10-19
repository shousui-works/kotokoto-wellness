import test from 'node:test';import assert from 'node:assert/strict';
import {affectionHearts,createAffectionBurst} from '../dist/companion-affection.mjs';
test('existing affection stages gently increase hearts, including a welcoming heart at zero',()=>{
 assert.deepEqual([0,6,20,50,100].map(n=>affectionHearts(n).hearts.length),[1,2,3,5,7]);
 assert.equal(affectionHearts(49).level,2);assert.equal(affectionHearts(50).level,3);assert.equal(affectionHearts(NaN).level,0);assert.equal(affectionHearts(10000).hearts.length,7);
 assert.equal(affectionHearts(0).hearts[0].filled,false);assert.equal(affectionHearts(100).hearts[0].filled,true);
});
test('reduced motion shows a small static response and cannot create an endless animation',()=>{
 for(const score of [0,6,20,50,100]){const p=affectionHearts(score,true);assert.equal(p.animated,false);assert.ok(p.hearts.length<=2);assert.ok(p.duration<=2500);assert.ok(p.hearts.every(h=>h.delay===0));}
});
test('each page replaces the previous bounded burst and clearing leaves no timer behind',()=>{
 let id=0,visible=0,erased=0,allowed=true;const timers=new Map();const burst=createAffectionBurst({emit:p=>visible=p.hearts.length,erase:()=>{visible=0;erased++;},canShow:()=>allowed,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:key=>timers.delete(key)});
 burst.speak(100);assert.equal(visible,7);assert.equal(timers.size,1);burst.speak(20);assert.equal(visible,3);assert.equal(timers.size,1);assert.ok([...timers.values()][0].ms<5000);
 const timeout=[...timers.values()][0].fn;timeout();assert.equal(visible,0);assert.equal(timers.size,0);
 burst.speak(50);burst.clear();assert.equal(visible,0);assert.equal(timers.size,0);allowed=false;burst.speak(100);assert.equal(visible,0);assert.equal(timers.size,0);burst.destroy();assert.ok(erased>0);
});
