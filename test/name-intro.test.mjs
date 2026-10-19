import test from 'node:test';
import assert from 'node:assert/strict';
import {createNameIntro} from '../dist/name-intro.mjs';
function fixture(initial='',fail=false){
  const field=()=>({hidden:false,value:'',textContent:'',events:new Map(),addEventListener(k,fn){this.events.set(k,fn);},focus(){this.focused=true;}});
  const form=field(),chatForm=field(),input=field(),later=field(),status=field();form.hidden=true;
  let nickname=initial,prompts=0,cancels=0;const completed=[],saved=[];
  const intro=createNameIntro({form,chatForm,input,later,status,getNickname:()=>nickname,saveNickname:name=>{if(fail)throw Error('save failed');nickname=name;saved.push(name);},onPrompt:()=>prompts++,onComplete:name=>completed.push(name),onCancel:()=>cancels++});
  return {intro,form,chatForm,input,status,saved,completed,get prompts(){return prompts;},get cancels(){return cancels;},setNickname:name=>nickname=name,submit(){form.events.get('submit')({preventDefault(){}});},skip(){later.events.get('click')();}};
}
test('only unregistered users are asked once, and their answer is saved before ordinary chat resumes',()=>{
  const known=fixture('そら');known.intro.show();assert.equal(known.prompts,0);assert.equal(known.form.hidden,true);
  const f=fixture();f.intro.show();f.intro.show();assert.equal(f.prompts,1);assert.equal(f.chatForm.hidden,true);
  f.intro.focus();assert.equal(f.input.focused,true);f.input.value='  そら  ';f.submit();
  assert.deepEqual(f.saved,['そら']);assert.deepEqual(f.completed,['そら']);assert.equal(f.chatForm.hidden,false);assert.equal(f.form.hidden,true);
});
test('later allows normal conversation without inventing or saving a name',()=>{
  const f=fixture();f.intro.show();f.skip();assert.equal(f.intro.active,false);assert.equal(f.chatForm.hidden,false);assert.deepEqual(f.saved,[]);assert.equal(f.cancels,1);
});
test('empty, excessive or unsaved names keep the answer field and do not confirm success',()=>{
  for(const [value,fail]of [['',false],['あ'.repeat(21),false],['そら',true]]){
    const f=fixture('',fail);f.intro.show();f.input.value=value;f.submit();assert.equal(f.intro.active,true);assert.equal(f.input.value,value);assert.ok(f.status.textContent);assert.deepEqual(f.completed,[]);
  }
});
test('a name saved from settings or another tab closes the introduction',()=>{
  const f=fixture();f.intro.show();f.setNickname('そら');f.intro.refresh();assert.equal(f.intro.active,false);assert.equal(f.chatForm.hidden,false);assert.deepEqual(f.saved,[]);
});
