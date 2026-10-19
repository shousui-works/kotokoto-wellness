import test from 'node:test';
import assert from 'node:assert/strict';
import {createFaceMotion} from '../dist/companion-face.mjs';
function fixture(){
  let time=0,id=0,frame=0;const timers=new Map(),frames=[];
  const motion=createFaceMotion({now:()=>time,random:()=>0,paint:value=>{frame=value;frames.push(value);},schedule:(fn,delay)=>{timers.set(++id,{fn,time:time+delay});return id;},cancel:key=>timers.delete(key)});
  return {motion,timers,frames,get frame(){return frame;},advance(ms){const end=time+ms;let count=0;while(true){const next=[...timers].filter(([,t])=>t.time<=end).sort((a,b)=>a[1].time-b[1].time)[0];if(!next)break;if(++count>1000)throw Error('timer loop');time=next[1].time;timers.delete(next[0]);next[1].fn();}time=end;}};
}
test('a reply uses real mouth frames for a finite burst, then returns to rest',()=>{
  const f=fixture();f.motion.speak('やあ');assert.equal(f.timers.size,0);f.motion.start();
  assert.equal(f.frame,1);f.advance(1000);assert.ok(f.frames.includes(2));
  f.advance(1200);assert.equal(f.frame,0);assert.ok(f.frames.includes(3));
});
test('idle waiting blinks briefly, without moving the mouth continually',()=>{
  const f=fixture();f.motion.start();assert.equal(f.frame,0);f.advance(1800);assert.equal(f.frame,3);f.advance(110);assert.equal(f.frame,0);
  assert.equal(f.frames.some(frame=>frame===1||frame===2),false);
});
test('pausing or leaving closeup cancels all timers and resets the expression',()=>{
  const f=fixture();f.motion.start();f.motion.speak('お話ししよう');f.advance(300);f.motion.stop();
  assert.equal(f.frame,0);assert.equal(f.timers.size,0);const n=f.frames.length;f.advance(10000);assert.equal(f.frames.length,n);
  f.motion.start();assert.equal(f.frame,0);
});
test('waiting for a reply closes the mouth, while a new page restarts a bounded burst',()=>{
  const f=fixture();f.motion.start();f.motion.speak('こんにちは');f.advance(200);f.motion.quiet();assert.equal(f.frame,0);
  f.motion.speak('つづきだよ');assert.equal(f.frame,1);f.advance(2200);assert.equal(f.frame,0);
});
