import test from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE_STORAGE,normalizeNickname,loadProfile,saveProfile,addressCompanionLine} from '../dist/profile.mjs';
const storage=()=>{const data=new Map([['kotokoto-wellness-v1','original']]);return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
test('nickname saves separately, survives reload, can be changed and cleared',()=>{
  const s=storage();assert.equal(loadProfile(s).nickname,'');
  saveProfile(s,'  そら  ');assert.equal(loadProfile(s).nickname,'そら');
  saveProfile(s,'そらちゃん');assert.equal(loadProfile(s).nickname,'そらちゃん');
  saveProfile(s,'');assert.equal(loadProfile(s).nickname,'');assert.equal(s.getItem('kotokoto-wellness-v1'),'original');
});
test('names support Unicode, remain literal in local speech and reject long or control-filled values',()=>{
  assert.equal(normalizeNickname('🐾'.repeat(20)),'🐾'.repeat(20));
  for(const name of ['あ'.repeat(21),'そ\nら','そ\u202eら',12])assert.throws(()=>normalizeNickname(name));
  assert.equal(addressCompanionLine('きみと、きみのペースで。','$&'),'$&と、$&のペースで。');
  assert.equal(addressCompanionLine('きみのペースで。',''),'きみのペースで。');
});
test('corrupt and newer profiles are never silently overwritten',()=>{
  for(const raw of ['{broken','{"version":2,"nickname":"そら"}']){
    const s=storage();s.setItem(PROFILE_STORAGE,raw);assert.throws(()=>saveProfile(s,'テスト'));assert.equal(s.getItem(PROFILE_STORAGE),raw);
  }
});

test('pet names preserve existing owner names and literal characters across reloads',()=>{
 const s=storage();saveProfile(s,'そら','もち');assert.equal(loadProfile(s).petName,'もち');saveProfile(s,'そらちゃん');assert.equal(loadProfile(s).petName,'もち');
 saveProfile(s,'そら','$&<犬>');assert.equal(loadProfile(s).petName,'$&<犬>');
 s.setItem(PROFILE_STORAGE,JSON.stringify({version:1,nickname:'以前の名前'}));assert.equal(loadProfile(s).petName,'こむぎ');assert.equal(loadProfile(s).namesConfigured,false);
});
