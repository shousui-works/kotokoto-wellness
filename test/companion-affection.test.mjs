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

test('identical consecutive reply pages replay once each, while ordinary rerenders do not replay',async()=>{
 const {readFile}=await import('node:fs/promises'),{default:vm}=await import('node:vm');
 const source=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
 const render=source.slice(source.indexOf('function renderCompanionSpeech('),source.indexOf('function showCompanionPraise('));
 const element=()=>({textContent:'',dataset:{},classList:{toggle(){},remove(){},add(){}},setAttribute(){},removeAttribute(){}}),nodes=new Map(),bubble=element();let bursts=0;
 const context={activeConversation:{label:'reply',pages:['同じ文。','同じ文。'],index:0,text:'同じ文。'},activeListening:false,activeNamePrompt:false,activePraise:null,activeChat:null,speechConversation:null,speechPage:-1,state:{},profile:{nickname:''},petName:()=>'',petText:x=>x,addressCompanionLine:x=>x,affectionFor:()=>({score:100}),companionFeeling:()=>({id:'normal',label:'normal',lines:['usual']}),$:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},document:{querySelector:()=>bubble},roomAffection:{speak(){bursts++;}},roomFaces:{speak(){}},requestAnimationFrame:fn=>fn()};
 vm.createContext(context);vm.runInContext(render+';renderCompanionSpeech();',context);assert.equal(bursts,1);
 context.activeConversation.index=1;vm.runInContext('renderCompanionSpeech();',context);assert.equal(bursts,2);
 vm.runInContext('renderCompanionSpeech();',context);assert.equal(bursts,2);
 context.activeConversation={...context.activeConversation,index:0};vm.runInContext('renderCompanionSpeech();',context);assert.equal(bursts,3);
});

test('reduced-motion static hearts respect manual pause and its observer even when combined pause stays true',async()=>{
 const {createCompanionAffection}=await import('../dist/companion-affection.mjs');
 const names=['document','window','matchMedia','MutationObserver','setTimeout','clearTimeout'],saved=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const timers=new Map();let observer,id=0,control;
 const element=()=>({children:[],dataset:{},classList:{toggle(){}},style:{setProperty(){}},setAttribute(){},append(child){this.children.push(child);},replaceChildren(){this.children=[];},remove(){}});
 const env={document:{hidden:false,querySelector:()=>null,createElement:element,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)};
 try{
  for(const [key,value]of Object.entries(env))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const dog=element();dog.dataset.motionPaused='true';dog.dataset.motionManuallyPaused='false';control=createCompanionAffection([dog]);
  control.speak(100);assert.equal(dog.children[0].children.length,2);assert.equal(timers.size,1);
  dog.dataset.motionManuallyPaused='true';observer();assert.equal(dog.children[0].children.length,0);assert.equal(timers.size,0);
  control.speak(100);assert.equal(dog.children[0].children.length,0);assert.equal(timers.size,0);
  dog.dataset.motionManuallyPaused='false';observer();control.speak(100);assert.equal(dog.children[0].children.length,2);
 }finally{control?.destroy();for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
