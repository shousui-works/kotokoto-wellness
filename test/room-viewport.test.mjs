import test from 'node:test';
import assert from 'node:assert/strict';
import {viewportGeometry,createRoomViewport} from '../dist/room-viewport.mjs';

function fixture(){
  const target=values=>Object.assign({events:new Map(),addEventListener(k,fn){this.events.set(k,fn);},removeEventListener(k){this.events.delete(k);}},values);
  const frames=new Map();let id=0;
  const view=target({height:844,offsetTop:0,scale:1});
  const win=target({innerWidth:390,innerHeight:844,visualViewport:view,requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);}});
  const classes=new Set(),styles=new Map();const root={style:{setProperty:(k,v)=>styles.set(k,v)},classList:{toggle(k,on){if(on)classes.add(k);else classes.delete(k);}}};
  const doc={activeElement:null},input=target({ownerDocument:doc});let changes=0;
  const viewport=createRoomViewport({win,root,input,onChange:()=>changes++});
  const event=(object,key)=>{object.events.get(key)?.();};
  const flush=()=>{for(const [key,fn]of [...frames]){frames.delete(key);fn();}};
  return {view,win,classes,styles,doc,input,viewport,frames,event,flush,get changes(){return changes;}};
}

test('iOS keyboard shrink and focus panning share visible height, top and bottom coordinates',()=>{
  const f=fixture();f.doc.activeElement=f.input;f.event(f.input,'focus');
  f.view.height=460;f.view.offsetTop=38;f.event(f.view,'resize');f.event(f.view,'scroll');
  assert.equal(f.frames.size,1);f.flush();
  assert.equal(f.styles.get('--room-height'),'460px');assert.equal(f.styles.get('--room-top'),'38px');assert.equal(f.styles.get('--room-bottom'),'346px');
  assert.ok(f.classes.has('keyboard-open'));assert.ok(f.classes.has('room-compact'));assert.equal(f.changes,2);
});

test('blur or disabling the input does not drop the keyboard offset before the keyboard closes',()=>{
  const f=fixture();f.doc.activeElement=f.input;f.view.height=460;f.event(f.view,'resize');f.flush();
  f.doc.activeElement=null;f.event(f.input,'blur');f.flush();
  assert.ok(f.classes.has('keyboard-open'));assert.equal(f.styles.get('--room-bottom'),'384px');
  f.view.height=844;f.event(f.view,'resize');f.flush();
  assert.equal(f.classes.has('keyboard-open'),false);assert.equal(f.styles.get('--room-bottom'),'0px');assert.equal(f.classes.has('room-compact'),false);
});

test('Android layout resizing does not apply the keyboard height twice',()=>{
  const f=fixture();f.doc.activeElement=f.input;f.win.innerHeight=460;f.view.height=460;f.event(f.win,'resize');f.flush();
  assert.ok(f.classes.has('keyboard-open'));assert.equal(f.styles.get('--room-height'),'460px');assert.equal(f.styles.get('--room-bottom'),'0px');
  f.win.innerHeight=844;f.view.height=844;f.event(f.win,'resize');f.flush();assert.equal(f.classes.has('keyboard-open'),false);
});

test('orientation resets the keyboard baseline, pinch zoom is not mistaken for a keyboard',()=>{
  const f=fixture();f.doc.activeElement=f.input;f.win.innerWidth=844;f.win.innerHeight=390;f.view.height=390;f.event(f.win,'resize');f.flush();
  assert.equal(f.classes.has('keyboard-open'),false);assert.ok(f.classes.has('room-landscape'));
  f.view.scale=2;f.view.height=195;f.view.offsetTop=50;f.event(f.view,'resize');f.flush();
  assert.equal(f.classes.has('keyboard-open'),false);assert.equal(f.styles.get('--room-height'),'390px');assert.equal(f.styles.get('--room-top'),'0px');
});

test('without visualViewport uses layout height, and cleanup removes listeners and queued frames',()=>{
  assert.deepEqual(viewportGeometry({innerHeight:600}),{height:600,top:0,bottom:0,zoomed:false});
  const f=fixture();f.event(f.win,'resize');f.viewport.destroy();
  assert.equal(f.frames.size,0);assert.equal(f.win.events.size,0);assert.equal(f.view.events.size,0);assert.equal(f.input.events.size,0);
});
