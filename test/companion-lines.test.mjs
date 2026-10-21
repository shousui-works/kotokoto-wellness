import test from 'node:test';import assert from 'node:assert/strict';
import {createIdleSpeech,IDLE_INTERVAL,IDLE_STORAGE} from '../dist/companion-lines.mjs';import {COMPANION_FEELINGS} from '../dist/model.mjs';
function fixture(){let time=new Date(2026,9,19,9).getTime();const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},create=()=>createIdleSpeech({storage,random:()=>0,now:()=>time});return {storage,map,create,advance(ms){time+=ms;}};}
test('idle render is stable between rotations, excludes eight recent lines, and survives reload',()=>{
 const f=fixture(),idle=f.create(),arg={feeling:COMPANION_FEELINGS.calm},seen=[];
 for(let i=0;i<9;i++){const line=idle.line(arg);seen.push(line.id);assert.equal(idle.line(arg),line);f.advance(IDLE_INTERVAL);}
 assert.equal(new Set(seen).size,9);const stored=JSON.parse(f.map.get(IDLE_STORAGE));assert.equal(stored.recentIds.length,8);assert.equal('text' in stored,false);
 const next=f.create().line(arg);assert.equal(stored.recentIds.includes(next.id),false);
});
test('busy/hidden/off rotation keeps the same line, and a real feeling change is reflected',()=>{
 const f=fixture(),idle=f.create(),arg={feeling:COMPANION_FEELINGS.calm},first=idle.line(arg);f.advance(IDLE_INTERVAL*20);
 assert.equal(idle.line({...arg,rotate:false}),first);assert.notEqual(idle.line(arg).id,first.id);
 const sad=idle.line({feeling:COMPANION_FEELINGS.lonely});assert.match(sad.id,/^lonely-/);
});
test('broken storage and clock changes cannot freeze idle speech or alter the habit data',()=>{
 let time=0;const idle=createIdleSpeech({storage:{getItem:()=>'{bad',setItem(){throw Error();}},now:()=>time,random:()=>0}),feeling=COMPANION_FEELINGS.curious,before=structuredClone(feeling);
 const first=idle.line({feeling});time=-1000;assert.notEqual(idle.line({feeling}).id,first.id);assert.deepEqual(feeling,before);
});
test('period changes do not rotate speech while input, dialogs or chatter-off suppress rotation',()=>{
 const f=fixture(),idle=f.create(),arg={feeling:COMPANION_FEELINGS.calm},first=idle.line(arg);
 f.advance(2*60*60*1000);
 assert.equal(idle.line({...arg,rotate:false}),first);
 assert.notEqual(idle.line(arg).id,first.id);
 assert.match(idle.line({feeling:COMPANION_FEELINGS.lonely,rotate:false}).id,/^lonely-/);
});
test('unknown or malformed idle history stays intact while in-memory variation works',()=>{
 for(const raw of ['{bad',JSON.stringify({version:2,recentIds:['future']}),JSON.stringify({version:1,recentIds:'invalid'})]){
  const f=fixture();f.map.set(IDLE_STORAGE,raw);const idle=f.create(),arg={feeling:COMPANION_FEELINGS.calm},first=idle.line(arg);
  f.advance(IDLE_INTERVAL);assert.notEqual(idle.line(arg).id,first.id);
  assert.equal(f.map.get(IDLE_STORAGE),raw);
 }
});
