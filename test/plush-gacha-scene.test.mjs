import test from 'node:test';import assert from 'node:assert/strict';
import {createGachaSequence,GACHA_DURATIONS} from '../dist/plush-gacha-scene.mjs';
function fixture(reduced=false){let id=0;const timers=new Map(),phases=[];const sequence=createGachaSequence({onPhase:p=>phases.push(p),reduced:()=>reduced,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:id=>timers.delete(id)});return {sequence,timers,phases,advance(){const [id,{fn,ms}]=timers.entries().next().value;timers.delete(id);fn();return ms;}};}
test('walk, lever, capsule delivery and touch-to-open are ordered and wait for the user',()=>{
 const f=fixture();f.sequence.start();assert.equal(f.sequence.phase,'walk');assert.equal(f.sequence.open(),false);
 assert.equal(f.advance(),GACHA_DURATIONS.walk);assert.equal(f.sequence.phase,'lever');
 assert.equal(f.advance(),GACHA_DURATIONS.lever);assert.equal(f.sequence.phase,'drop');
 assert.equal(f.advance(),GACHA_DURATIONS.drop);assert.equal(f.sequence.phase,'capsule');assert.equal(f.timers.size,0);
 assert.equal(f.sequence.open(),true);assert.equal(f.sequence.open(),false);assert.equal(f.sequence.phase,'opening');
 assert.equal(f.advance(),GACHA_DURATIONS.opening);assert.equal(f.sequence.phase,'reveal');assert.equal(f.timers.size,0);
 assert.deepEqual(f.phases,['walk','lever','drop','capsule','opening','reveal']);
});
test('resume and reduced motion go straight to a sealed capsule; reduced opening has no timed motion',()=>{
 const f=fixture(true);f.sequence.start();assert.equal(f.sequence.phase,'capsule');assert.equal(f.timers.size,0);f.sequence.open();assert.equal(f.sequence.phase,'reveal');assert.equal(f.timers.size,0);
 const resumed=fixture();resumed.sequence.start({resume:true});assert.equal(resumed.sequence.phase,'capsule');assert.equal(resumed.timers.size,0);
});
test('skip, hiding, close and replacement cancel stale timers without auto-opening a waiting capsule',()=>{
 const f=fixture();f.sequence.start();f.sequence.skip();f.sequence.skip();assert.equal(f.timers.size,0);assert.deepEqual(f.phases,['walk','reveal']);
 f.sequence.start();f.sequence.suspend();assert.equal(f.sequence.phase,'capsule');assert.equal(f.timers.size,0);f.sequence.suspend();assert.equal(f.sequence.phase,'capsule');
 f.sequence.open();f.sequence.suspend();assert.equal(f.sequence.phase,'reveal');assert.equal(f.timers.size,0);
 f.sequence.start();f.sequence.start();assert.equal(f.timers.size,1);f.sequence.stop();assert.equal(f.sequence.phase,'idle');assert.equal(f.sequence.skip(),false);assert.equal(f.timers.size,0);
});

test('opening announces the current breed in the live region, including after another capsule',async t=>{
 class Element{
  constructor(){this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classList={add(){}};}
  append(...children){this.children.push(...children);}get lastElementChild(){return this.children.at(-1);}
  setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}focus(){}showModal(){this.open=true;}close(){this.open=false;}remove(){}
 }
 const old={document:globalThis.document,matchMedia:globalThis.matchMedia};t.after(()=>Object.assign(globalThis,old));
 const body=new Element();globalThis.document={body,createElement:()=>new Element(),addEventListener(){},removeEventListener(){},hidden:false};
 globalThis.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 const {createGachaScene}=await import('../dist/plush-gacha-scene.mjs');const scene=createGachaScene();t.after(()=>scene.close());
 for(const name of ['柴','チワワ']){
  scene.start({requestId:name,isNew:true},{name,image:'/fixture.png'});
  const dialog=body.children.at(-1),status=dialog.children.find(n=>n.attrs.role==='status');
  assert.doesNotMatch(status.textContent,new RegExp(name));
  dialog.children.find(n=>n.className==='gacha-scene').children.find(n=>n.className==='gacha-capsule').listeners.click();
  assert.equal(status.attrs['aria-live'],'polite');assert.equal(status.textContent,`${name}のぬいぐるみが出てきたよ。`);
  scene.close();
 }
});
