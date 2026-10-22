import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {emptyAccount,applyCommand,importAccount} from '../server/account-model.mjs';import {MemoryAccountStore} from '../server/account-store.mjs';import {createAccountAPI} from '../server/account-api.mjs';
import {applyPlush,drawCandidate} from '../server/plush-gacha.mjs';import {progressTotal,recordManual} from '../dist/progress.mjs';import {normalizeCollection,collectionBalance} from '../dist/collection-model.mjs';import {PLUSH_CATALOG,SHELF_SLOTS} from '../dist/plush-catalog.mjs';
function funded(){let s={...emptyAccount(),initialized:true,datasetId:'fixture',profile:{version:1,nickname:'そら',petName:'こむぎ',namesConfigured:true}};for(let i=1;i<=30;i++){const date='2026-09-'+String(i).padStart(2,'0');s.progress=recordManual(s.progress,{id:date+':stretch',kind:'stretch',date,title:'fixture stretch'},s.legacy,'2026-10-19T00:00:00Z').progress;}return s;}
function draw(s,item='pomeranian'){return applyPlush(s,{type:'plush_draw'},{candidate:item,id:randomUUID(),now:Date.parse('2026-10-19T00:00:00Z')});}
test('draw debits only spendable points, keeps earned/growth, duplicates yield buttons and exchange selects unowned',()=>{
 const start=funded(),earned=progressTotal(start.progress),one=draw(start),two=draw(one.state);assert.equal(one.transaction.cost,50);assert.equal(one.transaction.isNew,true);assert.equal(two.state.collection.owned.pomeranian.count,2);assert.equal(two.state.collection.buttons,1);assert.deepEqual(two.state.progress,start.progress);assert.deepEqual(two.state.legacy,start.legacy);assert.equal(collectionBalance(two.state.collection,earned),earned-100);
 let state=start;for(let i=0;i<6;i++)state=draw(state).state;assert.equal(state.collection.buttons,5);const x=applyPlush(state,{type:'plush_exchange',item:'husky'},{id:randomUUID()});assert.equal(x.state.collection.buttons,0);assert.equal(x.state.collection.owned.husky.count,1);assert.equal(x.state.collection.spent,300);assert.throws(()=>draw(x.state),/ポイント/);assert.throws(()=>applyPlush(x.state,{type:'plush_exchange',item:'shiba'}),/ボタン/);
 const corrected=structuredClone(one.state);corrected.progress.activities=[];assert.equal(collectionBalance(corrected.collection,progressTotal(corrected.progress)),0);assert.throws(()=>draw(corrected),/ポイント/);corrected.progress=start.progress;assert.equal(collectionBalance(corrected.collection,progressTotal(corrected.progress)),earned-50);
});
test('shelf placements respect counts, replace atomically, persist on unrelated commands and ignore import claims',()=>{
 let s=draw(funded()).state;s=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[0],item:'pomeranian'});const moved=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[1],item:'pomeranian'});assert.equal(moved.collection.shelf[SHELF_SLOTS[0]],undefined);assert.equal(moved.collection.shelf[SHELF_SLOTS[1]],'pomeranian');assert.throws(()=>applyCommand(s,{type:'plush_display',slot:'invalid',item:null}),/置き場所/);
 s=draw(s,'shiba').state;s=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[0],item:'shiba'});s=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[1],item:'pomeranian'});s=applyCommand(s,{type:'mood',mood:'good'});assert.equal(Object.keys(s.collection.shelf).length,2);assert.deepEqual(normalizeCollection(s.collection),s.collection);
 const bad=structuredClone(s.collection);bad.shelf[SHELF_SLOTS[2]]='pomeranian';assert.throws(()=>normalizeCollection(bad));assert.equal(Object.keys(importAccount({...s}).collection.owned).length,0);
});
async function fixture(){const store=new MemoryAccountStore();store.accounts.set('alice',funded());let picks=0;const api=createAccountAPI({store,config:{},apiAvailable:false,verify:async token=>{if(!['alice','bob'].includes(token))throw Error();return {uid:token};},choosePlush:()=>{picks++;return 'pomeranian';}});return {store,get picks(){return picks;},async request(path,payload,token='alice'){const req=Readable.from(payload?[Buffer.from(JSON.stringify(payload))]:[]);Object.assign(req,{url:path,method:payload?'POST':'GET',headers:{host:'fixture.test',origin:'https://fixture.test',...(token?{authorization:'Bearer '+token}:{})}});let status,body;await api(req,{writeHead(s){status=s;},end(v){body=JSON.parse(v);}},path.split('?')[0]);return {status,body};}};}
test('authenticated draws persist once across concurrent requests, stale revisions, cleared transient operations and disabled switch',async()=>{
 const f=await fixture(),payload={requestId:randomUUID(),revision:0,command:{type:'plush_draw',item:'husky',cost:0}};
 const both=await Promise.all([f.request('/api/commands',payload),f.request('/api/commands',payload)]);assert.ok(both.every(r=>r.status===200));assert.equal(both[0].body.plushResult.item,'pomeranian');assert.equal((await f.store.read('alice')).collection.spent,50);assert.equal(f.store.plushTransactions.size,1);
 await f.store.clearHistoryBodies('alice');f.store.gachaEnabled=false;const replay=await f.request('/api/commands',payload);assert.equal(replay.body.plushResult.requestId,payload.requestId);assert.equal(replay.body.state.collection.spent,50);
 assert.equal((await f.request('/api/commands',{...payload,command:{type:'plush_exchange',item:'shiba'}})).status,409);
 assert.equal((await f.request('/api/commands',{...payload,requestId:randomUUID(),revision:1})).status,409);
 assert.equal((await f.request('/api/commands',{...payload,revision:1,command:{type:'mood',mood:'good'}})).status,409);assert.equal((await f.request('/api/commands',payload,null)).status,401);assert.equal((await f.request('/api/plush/history',null,'bob')).body.rows.length,0);
 const h=await f.request('/api/plush/history');assert.equal(h.body.rows.length,1);assert.equal(h.body.rows[0].fingerprint,undefined);assert.equal(h.body.rows[0].item,'pomeranian');
});
test('concurrent distinct draws cannot overspend and history pages are bounded',async()=>{
 const f=await fixture();const s=funded();s.collection.spent=250;f.store.accounts.set('alice',s);
 const r=await Promise.all(Array.from({length:2},()=>f.request('/api/commands',{requestId:randomUUID(),revision:0,command:{type:'plush_draw'}})));assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);assert.equal((await f.store.read('alice')).collection.spent,300);
 for(let i=0;i<24;i++){const id=randomUUID();f.store.plushTransactions.set('alice/'+id,{requestId:id,item:'shiba',at:new Date(Date.parse('2026-09-01')+i*1000).toISOString(),fingerprint:'private'});}const a=await f.store.plushHistory('alice'),b=await f.store.plushHistory('alice',a.nextCursor);assert.equal(a.rows.length,20);assert.equal(b.rows.length,5);assert.equal(b.nextCursor,null);assert.equal(new Set([...a.rows,...b.rows].map(x=>x.requestId)).size,25);
});
test('uniform selection covers every catalog entry and content includes real source links',()=>{
 for(let i=0;i<PLUSH_CATALOG.length;i++){assert.equal(drawCandidate(n=>{assert.equal(n,8);return i;}),PLUSH_CATALOG[i].id);const p=PLUSH_CATALOG[i];assert.ok(p.name&&p.trivia&&p.features&&p.sources.every(s=>s.url.startsWith('https://')));}
 assert.equal(PLUSH_CATALOG.find(p=>p.id==='calico').category,'other');assert.equal(PLUSH_CATALOG.find(p=>p.id==='shiba').name,'柴');
});

test('draw cannot reuse an earlier normal command ID',async()=>{const f=await fixture(),id=randomUUID();assert.equal((await f.request('/api/commands',{requestId:id,revision:0,command:{type:'mood',mood:'good'}})).status,200);assert.equal((await f.request('/api/commands',{requestId:id,revision:1,command:{type:'plush_draw'}})).status,409);assert.equal((await f.store.read('alice')).collection.spent,0);});

test('collection UI confirms exchange inline, opens the book and swaps shelf toys through server commands',async t=>{
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.listeners={};this.className='';this.style={setProperty(){}};this.classList={add:name=>{this.className+=' '+name;},remove:name=>{this.className=this.className.split(' ').filter(c=>c!==name).join(' ');}};}
  set textContent(value){this.text=String(value);this.children=[];}get textContent(){return (this.text??'')+this.children.map(c=>c.textContent).join('');}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.text='';this.children=[...items];}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}setAttribute(k,v){this.attrs[k]=v;}
  get value(){return this.selected??this.children.find(c=>c.tag==='option')?.value??'';}set value(v){this.selected=this.tag==='select'&&!this.children.some(c=>c.tag==='option'&&c.value===v)?'':v;}
  querySelectorAll(tag){return this.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...c.querySelectorAll(tag)]);}
  getBoundingClientRect(){return {height:100};}scrollIntoView(){}
  async click(){if(this.disabled)throw Error('disabled button');if(this.onclick)await this.onclick();for(const fn of this.listeners.click??[])await fn();}
 }
 const old={document:globalThis.document,ResizeObserver:globalThis.ResizeObserver};t.after(()=>Object.assign(globalThis,old));
 const root=new Element('section'),shelf=new Element('div'),header=new Element('div');globalThis.document={createElement:tag=>new Element(tag),getElementById:id=>id==='plush'?root:shelf,querySelector:()=>header};globalThis.ResizeObserver=class{observe(){}};
 let ui;const account={user:{uid:'fictional'},writable:true,state:funded(),async command(command){this.state=command.type==='plush_exchange'?applyPlush(this.state,command,{id:randomUUID()}).state:applyCommand(this.state,command);ui.render();return {state:this.state};}};
 account.state.collection.buttons=5;for(let i=0;i<6;i++){const id=PLUSH_CATALOG[i].id;account.state.collection.owned[id]={count:1,firstAt:'2026-10-19T00:00:00Z'};account.state.collection.shelf[SHELF_SLOTS[i]]=id;}
 const {createPlushUI}=await import('../dist/plush-ui.mjs');const messages=[];ui=createPlushUI({account,openPanel(){},toast:x=>messages.push(x)});
 const b=text=>root.querySelectorAll('button').find(n=>n.textContent===text);
 const selection=root.querySelectorAll('select')[0];selection.value='calico';selection.onchange();
 await b('イエネコ（三毛）と交換する').click();assert.ok(b('交換を確定する'));assert.equal(account.state.collection.buttons,5);
 await b('交換を確定する').click();assert.equal(account.state.collection.buttons,0);assert.equal(account.state.collection.owned.calico.count,1);assert.match(root.textContent,/新しい仲間/);assert.equal(root.querySelectorAll('select')[0].value,'rabbit');assert.ok(b('カイウサギと交換する'));assert.match(root.querySelectorAll('section').find(n=>n.attrs['aria-label']==='開封結果').className,/just-opened/);
 await b('図鑑を見る').click();assert.match(root.textContent,/三毛は品種名ではなく/);assert.match(root.textContent,/CFA/);
 await root.querySelectorAll('button').filter(n=>n.textContent==='棚に飾る').at(-1).click();await root.querySelectorAll('button').find(n=>n.attrs['aria-label']==='上の段 1番目').click();assert.equal(account.state.collection.shelf[SHELF_SLOTS[0]],'calico');
 const shiba=root.querySelectorAll('button').find(n=>n.className==='plush-book-item'&&n.children.some(c=>c.tag==='strong'&&c.textContent==='柴'));await shiba.click();assert.equal(account.state.collection.shelf[SHELF_SLOTS[0]],'shiba');assert.equal(account.state.collection.shelf[SHELF_SLOTS[1]],'calico');assert.equal(messages.length,2);
});

test('corrupt collection containers and inherited shelf items are rejected before spending',()=>{
 for(const patch of [{owned:[]},{owned:'invalid'},{shelf:[]},{shelf:'invalid'},{owned:{pomeranian:null}},{shelf:{[SHELF_SLOTS[0]]:'toString'}},{shelf:{[SHELF_SLOTS[0]]:['pomeranian']}}]){
  const state=draw(funded()).state;Object.assign(state.collection,patch);const before=structuredClone(state);
  assert.throws(()=>normalizeCollection(state.collection));assert.throws(()=>draw(state));assert.deepEqual(state,before);
 }
 const state=draw(funded()).state;assert.deepEqual(normalizeCollection(JSON.parse(JSON.stringify(state.collection))),state.collection);
});
