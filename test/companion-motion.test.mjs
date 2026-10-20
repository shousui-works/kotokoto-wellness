import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomWalker,ACTIVITY_DURATION,chooseActivity,roomBounds,stepToward} from '../dist/companion-motion.mjs';

class Element{
  constructor(){
    this.classes=new Set();this.attrs={};this.dataset={};this.children=[];this.listeners=new Map();this.values=new Map();
    this.classList={add:(...names)=>names.forEach(n=>this.classes.add(n)),remove:(...names)=>names.forEach(n=>this.classes.delete(n)),contains:n=>this.classes.has(n)};
    this.style={setProperty:(k,v)=>this.values.set(k,v),getPropertyValue:k=>this.values.get(k)||''};
  }
  set className(value){this.classes=new Set(value.split(' '));}
  setAttribute(k,v){this.attrs[k]=v;}
  append(...children){this.children.push(...children);}
  after(){}
  remove(){this.removed=true;}
  addEventListener(k,fn){this.listeners.set(k,fn);}
  removeEventListener(k){this.listeners.delete(k);}
  closest(selector){return selector==='.room-scene'?this.scene:null;}
}
function withWalker(run){
  const names=['document','ResizeObserver','IntersectionObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'];
  const saved=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const timers=new Map(),frames=new Map();let id=0,time=0,reduced=false;
  const doc={hidden:false,createElement:()=>new Element()};
  const observer=class{observe(){}disconnect(){this.disconnected=true;}};
  const env={document:doc,ResizeObserver:observer,IntersectionObserver:observer,getComputedStyle:()=>({getPropertyValue:()=> '160px'}),requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;},clearTimeout:key=>timers.delete(key)};
  for(const [k,v] of Object.entries(env))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
  const scene=new Element();scene.clientWidth=375;scene.clientHeight=812;scene.classList.add('room-scene--world');
  const dog=new Element();dog.scene=scene;dog.classList.add('dog--puppy');
  const walker=new RoomWalker(dog,()=>reduced);
  walker.visible=true;walker.ready=true;walker.actionsReady=true;walker.ball.hidden=false;walker.updateControls();
  const advance=ms=>{
    const end=time+ms;
    while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}
    time=end;
  };
  try{run({walker,dog,scene,doc,timers,frames,advance,setReduced:value=>{reduced=value;walker.preferenceChanged();}});}
  finally{walker.destroy();for(const [k,d] of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
}

test('自動の動きは直前と同じものを続けず、さみしい時は穏やかな動きにする',()=>{
  assert.deepEqual(new Set(Array.from({length:100},(_,i)=>chooseActivity(null,false,()=>i/100))),new Set(['walk','sniff','play','nap']));
  for(const previous of ['walk','sniff','play','nap'])for(let i=0;i<100;i++){
    assert.notEqual(chooseActivity(previous,false,()=>i/100),previous);
    assert.notEqual(chooseActivity(previous,true,()=>i/100),'play');
  }
});

test('くんくんと伏せ寝は時間が来ると終わり、次の自動行動を待つ',()=>withWalker(({walker,dog,advance,timers})=>{
  for(const [kind,state] of [['sniff','sniffing'],['nap','napping']]){
    walker.startActivity(kind);assert.equal(dog.dataset.activity,state);assert.ok(dog.classList.contains('is-acting'));
    advance(ACTIVITY_DURATION[kind]);assert.equal(dog.dataset.activity,'resting');assert.equal(dog.classList.contains('is-acting'),false);assert.equal(timers.size,1);
  }
}));

test('ボールに近づいてから遊び、遊び終わると自動行動に戻る',()=>withWalker(({walker,dog,frames,timers})=>{
  walker.position={x:walker.ballPosition.x-walker.dogSize*.37,y:walker.ballPosition.y};
  walker.play();assert.equal(dog.dataset.activity,'playing');assert.ok(walker.ball.classList.contains('is-playing'));
  const tick=frames.get(walker.frame);frames.delete(walker.frame);tick(performance.now()+ACTIVITY_DURATION.play+1);
  assert.equal(dog.dataset.activity,'resting');assert.equal(walker.ball.classList.contains('is-playing'),false);assert.equal(timers.size,1);
  assert.ok(walker.ballPosition.x>=24&&walker.ballPosition.x<=351);
}));

test('おいでや一時停止が遊びを中断し、古いアニメーションが残らない',()=>withWalker(({walker,dog,frames,timers})=>{
  walker.startActivity('play');const oldFrame=walker.frame;
  walker.comeHere();assert.equal(dog.dataset.activity,'approaching');assert.equal(walker.activity,null);assert.equal(frames.has(oldFrame),false);
  walker.onPause();assert.equal(dog.dataset.activity,'resting');assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(walker.playButton.disabled,true);
  walker.play();assert.equal(dog.dataset.activity,'resting');
}));

test('非表示や動きを減らす設定では自動の遊びを停止する',()=>withWalker(({walker,dog,doc,frames,timers,setReduced})=>{
  walker.startActivity('play');doc.hidden=true;walker.resume();assert.equal(frames.size,0);assert.equal(timers.size,0);
  doc.hidden=false;walker.resume();assert.equal(timers.size,1);
  setReduced(true);assert.equal(dog.dataset.activity,'resting');assert.equal(timers.size,0);assert.equal(walker.playButton.disabled,true);
  walker.startActivity('sniff');assert.equal(dog.dataset.activity,'resting');
}));

test('床のタップには移動を結び付けない',()=>withWalker(({scene,walker})=>{
  assert.equal(scene.listeners.has('pointerup'),false);assert.equal(scene.listeners.has('click'),false);
  assert.equal(walker.controls.children.length,3);
}));

test('移動は目的地を飛び越えず、各画面の歩行範囲は収まる',()=>{
  assert.deepEqual(stepToward({x:0,y:0},{x:3,y:4},10),{x:3,y:4,arrived:true});
  for(const [w,h] of [[320,740],[375,812],[844,390],[1280,720]])for(const size of [160,180,200,225]){
    const b=roomBounds(w,h,size);assert.ok(b.left<=b.right&&b.left>=0&&b.right<=w);assert.ok(b.front<=b.back&&b.front>0&&b.back<h);
  }
});
