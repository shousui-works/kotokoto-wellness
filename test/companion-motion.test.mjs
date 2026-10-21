import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomWalker,ACTIVITY_DURATION,chooseActivity,roomBounds,stepToward,conversationPose} from '../dist/companion-motion.mjs';

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

test('返事を読む間は正面のおすわりで待ち、読み終わっても手動のおやすみ設定を守る',()=>withWalker(({walker,dog,advance,timers,frames})=>{
  walker.startActivity('play');walker.setSpeaking(true);
  advance(30000);
  assert.equal(dog.dataset.activity,'resting');assert.equal(frames.size,0);assert.equal(timers.size,0);
  assert.equal(walker.canMove,false);assert.equal(walker.playButton.disabled,true);
  walker.setSpeaking(false);assert.equal(walker.canMove,true);assert.ok(timers.size);
  walker.paused=true;walker.setSpeaking(true);walker.setSpeaking(false);
  assert.equal(walker.paused,true);assert.equal(walker.canMove,false);assert.equal(timers.size,0);
}));

test('アップ中の絵の動きは、手動停止・非表示・動きを減らす設定に従う',()=>withWalker(({walker,dog,doc,setReduced})=>{
  walker.approachConversation();walker.conversationFinish?.();walker.updateControls();
  assert.equal(dog.dataset.conversation,'near');assert.equal(dog.dataset.motionPaused,'false');
  walker.onPause();assert.equal(dog.dataset.motionPaused,'true');assert.equal(walker.paused,true);
  walker.onPause();assert.equal(dog.dataset.motionPaused,'false');
  doc.hidden=true;walker.resume();assert.equal(dog.dataset.motionPaused,'true');
  doc.hidden=false;walker.resume();assert.equal(dog.dataset.motionPaused,'false');
  setReduced(true);assert.equal(dog.dataset.motionPaused,'true');assert.equal(walker.paused,false);
  setReduced(false);assert.equal(dog.dataset.motionPaused,'false');assert.equal(dog.dataset.motionManuallyPaused,'false');
  walker.onPause();setReduced(true);assert.equal(dog.dataset.motionPaused,'true');assert.equal(dog.dataset.motionManuallyPaused,'true');
  setReduced(false);assert.equal(dog.dataset.motionManuallyPaused,'true');
}));

test('話しかけると遊びを中断して手前へ大きく寄り、読み終わると元の距離へ戻る',()=>withWalker(({walker,dog,frames,timers})=>{
  const origin={...walker.position};walker.startActivity('play');
  walker.approachConversation();
  assert.equal(walker.activity,null);assert.equal(walker.ball.classList.contains('is-playing'),false);
  assert.equal(dog.dataset.conversation,'approaching');assert.equal(walker.canMove,false);
  const approaching=frames.get(walker.conversationFrame);frames.delete(walker.conversationFrame);approaching(performance.now()+2000);
  const target=conversationPose(375,812,160);
  assert.equal(dog.dataset.conversation,'near');assert.deepEqual(walker.position,{x:target.x,y:target.y});
  assert.ok(walker.conversationScale>1.8);assert.equal(dog.classList.contains('is-walking'),false);
  walker.setSpeaking(false);assert.equal(dog.dataset.conversation,'returning');
  const returning=frames.get(walker.conversationFrame);frames.delete(walker.conversationFrame);returning(performance.now()+2000);
  assert.deepEqual(walker.position,origin);assert.equal(walker.conversationScale,null);
  assert.equal(walker.conversationMode,null);assert.equal(walker.canMove,true);assert.ok(timers.size);
  approaching(performance.now()+4000);assert.deepEqual(walker.position,origin);
}));

test('寄ってくる途中の非表示・動きを減らす設定・手動停止でもアニメーションを残さない',()=>withWalker(({walker,doc,frames,timers,setReduced})=>{
  walker.approachConversation();doc.hidden=true;walker.resume();
  assert.equal(walker.conversationMode,'near');assert.equal(frames.size,0);
  doc.hidden=false;setReduced(true);walker.setSpeaking(false);
  assert.equal(walker.conversationMode,null);assert.equal(frames.size,0);assert.equal(timers.size,0);
  setReduced(false);walker.paused=true;walker.approachConversation();
  assert.equal(walker.conversationMode,'near');assert.equal(frames.size,0);
  walker.setSpeaking(false);assert.equal(walker.paused,true);assert.equal(walker.canMove,false);
}));

test('会話の寄り位置は入力欄の上に収まり、画面と成長に合わせて拡大率を抑える',()=>{
  for(const [w,h,inset]of[[320,740,160],[390,844,166],[844,390,120],[1280,720,160]])for(const size of [160,180,200,225]){
    const p=conversationPose(w,h,size,inset);
    assert.ok(p.x>0&&p.x<w);assert.ok(p.y>=inset+24&&p.y<h);
    assert.ok(p.scale>=.95&&p.scale<=2.25);assert.ok(p.scale*size<=w*.9);
  }
});

test('キーボードで特に狭い縦画面では横に吹き出しを置ける余白を残す',()=>{
  for(const w of [320,390])for(const size of [160,225]){
    const p=conversationPose(w,360,size,70);
    assert.ok(p.x<w*.4);assert.ok(p.scale*size<=w*.42);
    assert.ok(360-p.y-p.scale*size*.78>=95);assert.ok(p.y>=94);
  }
});

test('横向きのキーボードでも犬の頭を画面内に収める',()=>{
  for(const size of [160,225]){
    const p=conversationPose(844,210,size,70);
    assert.ok(210-p.y-p.scale*size*.78>=85);assert.ok(p.y>=94);
  }
});

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

test('常設チャットの上に足元とボールを収める',()=>withWalker(({walker})=>{
  walker.getBottomInset=()=>250;walker.measure();
  assert.ok(walker.bounds.front>=270);
  assert.ok(walker.position.y>=270);
  walker.ballPosition={x:100,y:100};walker.measure();
  assert.ok(walker.ballPosition.y>=270);
  assert.ok(walker.bounds.back<walker.roomSize.height);
}));
