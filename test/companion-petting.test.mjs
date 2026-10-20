import test from 'node:test';
import assert from 'node:assert/strict';
import {bindCompanionPetting} from '../dist/companion-petting.mjs';

function fixture(){
  const target=new EventTarget(),doc=new EventTarget(),win=new EventTarget();
  doc.defaultView=win;target.ownerDocument=doc;
  let captured=null,pets=0,ends=0;const holds=[],moves=[];
  target.setPointerCapture=id=>{captured=id;};target.hasPointerCapture=id=>captured===id;
  target.releasePointerCapture=()=>{captured=null;};
  target.getBoundingClientRect=()=>({left:0,right:100,top:0,bottom:100,width:100,height:100});
  const binding=bindCompanionPetting(target,{onHold:v=>holds.push(v),onMove:v=>moves.push(v),onEnd:()=>ends++,onPet:()=>pets++});
  const fire=(type,props={})=>{const e=new Event(type);Object.assign(e,{pointerId:1,clientX:30,clientY:30,button:0,isPrimary:true,...props});target.dispatchEvent(e);};
  return {fire,doc,win,binding,holds,moves,get pets(){return pets;},get ends(){return ends;},get captured(){return captured;}};
}
test('a tap does not pet; a back-and-forth stroke responds during movement and saves once on release',()=>{
  const f=fixture();f.fire('pointerdown');f.fire('pointerup');f.fire('click',{detail:1});assert.equal(f.pets,0);
  f.fire('pointerdown');f.fire('pointermove',{clientX:42});assert.equal(f.moves.length,0);
  f.fire('pointermove',{clientX:30});assert.equal(f.moves.length,1);assert.equal(f.pets,0);
  f.fire('pointermove',{clientX:60});assert.equal(f.moves.length,2);
  f.fire('pointerup');f.fire('lostpointercapture');f.fire('click',{detail:1});assert.equal(f.pets,1);assert.equal(f.captured,null);
  assert.deepEqual(f.holds,[true,false,true,false]);
});
test('outside movement and a second finger do not qualify a gesture',()=>{
  const f=fixture();f.fire('pointerdown');f.fire('pointerdown',{pointerId:2,isPrimary:false});
  f.fire('pointermove',{pointerId:2,clientX:80});f.fire('pointerup',{pointerId:2});assert.equal(f.captured,1);
  f.fire('pointermove',{clientX:130});f.fire('pointermove',{clientX:50});f.fire('pointerup');assert.equal(f.pets,0);assert.equal(f.moves.length,0);
});
test('cancel, lost capture, hidden tab, and blur release motion without saving',()=>{
  for(const type of ['pointercancel','lostpointercapture','hidden','blur']){
    const f=fixture();f.fire('pointerdown');f.fire('pointermove',{clientX:70});
    if(type==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}
    else if(type==='blur')f.win.dispatchEvent(new Event('blur'));
    else f.fire(type);
    f.fire('pointerup');assert.equal(f.pets,0,type);assert.equal(f.ends,1,type);assert.equal(f.captured,null,type);assert.deepEqual(f.holds,[true,false],type);
  }
});
test('keyboard activation remains available, and destroying removes listeners and releases a held gesture',()=>{
  const f=fixture();f.fire('click',{detail:0});assert.equal(f.pets,1);
  f.fire('pointerdown');f.fire('pointermove',{clientX:60});f.binding.destroy();assert.equal(f.pets,1);assert.equal(f.captured,null);
  f.fire('click',{detail:0});f.fire('pointerdown');assert.equal(f.pets,1);assert.deepEqual(f.holds,[true,false]);
});
