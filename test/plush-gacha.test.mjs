import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {emptyAccount,applyCommand,importAccount} from '../server/account-model.mjs';import {MemoryAccountStore} from '../server/account-store.mjs';import {createAccountAPI} from '../server/account-api.mjs';
import {applyPlush,drawCandidate} from '../server/plush-gacha.mjs';import {progressTotal,recordManual} from '../dist/progress.mjs';import {normalizeCollection,collectionBalance} from '../dist/collection-model.mjs';import {PLUSH_CATALOG,SHELF_SLOTS,plushById} from '../dist/plush-catalog.mjs';
function funded(){let s={...emptyAccount(),initialized:true,datasetId:'fixture',profile:{version:1,nickname:'そら',petName:'こむぎ',namesConfigured:true}};for(let i=1;i<=30;i++){const date='2026-09-'+String(i).padStart(2,'0');s.progress=recordManual(s.progress,{id:date+':stretch',kind:'stretch',date,title:'fixture stretch'},s.legacy,'2026-10-19T00:00:00Z').progress;}return s;}
function seen(s){return applyPlush(s,{type:'plush_seen',id:s.collection.lastResult?.requestId}).state;}
function draw(s,item='pomeranian'){return applyPlush(s,{type:'plush_draw'},{candidate:item,id:randomUUID(),now:Date.parse('2026-10-19T00:00:00Z')});}
test('draw debits only spendable points, keeps earned/growth, duplicates yield buttons and exchange selects unowned',()=>{
 const start=funded(),earned=progressTotal(start.progress),one=draw(start),two=draw(seen(one.state));assert.equal(one.transaction.cost,50);assert.equal(one.transaction.isNew,true);assert.equal(two.state.collection.owned.pomeranian.count,2);assert.equal(two.state.collection.buttons,1);assert.deepEqual(two.state.progress,start.progress);assert.deepEqual(two.state.legacy,start.legacy);assert.equal(collectionBalance(two.state.collection,earned),earned-100);
 let state=start;for(let i=0;i<6;i++)state=seen(draw(state).state);assert.equal(state.collection.buttons,5);const x=applyPlush(state,{type:'plush_exchange',item:'husky'},{id:randomUUID()});assert.equal(x.state.collection.buttons,0);assert.equal(x.state.collection.owned.husky.count,1);assert.equal(x.state.collection.spent,300);assert.throws(()=>draw(seen(x.state)),/ポイント/);assert.throws(()=>applyPlush(seen(x.state),{type:'plush_exchange',item:'shiba'}),/ボタン/);
 const corrected=structuredClone(seen(one.state));corrected.progress.activities=[];assert.equal(collectionBalance(corrected.collection,progressTotal(corrected.progress)),0);assert.throws(()=>draw(corrected),/ポイント/);corrected.progress=start.progress;assert.equal(collectionBalance(corrected.collection,progressTotal(corrected.progress)),earned-50);
});
test('shelf placements respect counts, replace atomically, persist on unrelated commands and ignore import claims',()=>{
 let s=draw(funded()).state;s=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[0],item:'pomeranian'});const moved=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[1],item:'pomeranian'});assert.equal(moved.collection.shelf[SHELF_SLOTS[0]],undefined);assert.equal(moved.collection.shelf[SHELF_SLOTS[1]],'pomeranian');assert.throws(()=>applyCommand(s,{type:'plush_display',slot:'invalid',item:null}),/置き場所/);
 s=draw(seen(s),'shiba').state;s=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[0],item:'shiba'});s=applyCommand(s,{type:'plush_display',slot:SHELF_SLOTS[1],item:'pomeranian'});s=applyCommand(s,{type:'mood',mood:'good'});assert.equal(Object.keys(s.collection.shelf).length,2);assert.deepEqual(normalizeCollection(s.collection),s.collection);
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
 for(let i=0;i<PLUSH_CATALOG.length;i++){assert.equal(drawCandidate(n=>{assert.equal(n,30);return i;}),PLUSH_CATALOG[i].id);const p=PLUSH_CATALOG[i];assert.ok(p.name&&p.trivia&&p.features&&p.sources.every(s=>s.url.startsWith('https://')));}
 assert.equal(PLUSH_CATALOG.length,30);assert.ok(PLUSH_CATALOG.every(p=>p.category==='dog'));assert.equal(plushById('calico').category,'other');assert.equal(PLUSH_CATALOG.find(p=>p.id==='shiba').name,'柴');
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
 account.state.collection.buttons=5;for(let i=0;i<4;i++){const id=PLUSH_CATALOG[i].id;account.state.collection.owned[id]={count:1,firstAt:'2026-10-19T00:00:00Z'};account.state.collection.shelf[SHELF_SLOTS[i]]=id;}
 account.state.collection.owned.calico={count:1,firstAt:'2026-10-19T00:00:00Z'};account.state.collection.owned.rabbit={count:1,firstAt:'2026-10-19T00:00:00Z'};
 const {createPlushUI}=await import('../dist/plush-ui.mjs');const messages=[];ui=createPlushUI({account,openPanel(){},toast:x=>messages.push(x)});
 assert.doesNotMatch(root.textContent,/イエネコ|カイウサギ|ほかの動物/);assert.match(root.textContent,/集めた仲間 4 \/ 30/);
 const b=text=>root.querySelectorAll('button').find(n=>n.textContent===text);
 const selection=root.querySelectorAll('select')[0];selection.value='husky';selection.onchange();
 await b('シベリアン・ハスキーと交換する').click();assert.ok(b('交換を確定する'));assert.equal(account.state.collection.buttons,5);
 await b('交換を確定する').click();assert.equal(account.state.collection.buttons,0);assert.equal(account.state.collection.owned.husky.count,1);assert.match(root.textContent,/新しい仲間/);assert.match(root.textContent,/集めた仲間 5 \/ 30/);
 assert.equal(root.querySelectorAll('select')[0].value,'dachshund');assert.ok(b('ミニチュア・ダックスフンドと交換する'));assert.match(root.querySelectorAll('section').find(n=>n.attrs['aria-label']==='開封結果').className,/just-opened/);
 await b('図鑑を見る').click();assert.match(root.textContent,/原産国表記はアメリカ合衆国/);assert.match(root.textContent,/JKC/);
 await root.querySelectorAll('button').filter(n=>n.textContent==='棚に飾る').at(-1).click();await root.querySelectorAll('button').find(n=>n.attrs['aria-label']==='上の段 1番目').click();assert.equal(account.state.collection.shelf[SHELF_SLOTS[0]],'husky');
 const shiba=root.querySelectorAll('button').find(n=>n.className==='plush-book-item'&&n.children.some(c=>c.tag==='strong'&&c.textContent==='柴'));await shiba.click();assert.equal(account.state.collection.shelf[SHELF_SLOTS[0]],'shiba');assert.equal(account.state.collection.shelf[SHELF_SLOTS[1]],'husky');assert.equal(messages.length,2);
 const historyCalls=[];account.fetch=async path=>{historyCalls.push(path);return Response.json(historyCalls.length===1?{rows:[{item:'calico',at:'2026-10-19T00:00:00Z',cost:50}],nextCursor:'older-page'}:{rows:[{item:'shiba',at:'2026-10-18T00:00:00Z',cost:50}],nextCursor:null});};
 await b('履歴').click();await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(root.textContent,/イエネコ/);assert.match(root.textContent,/このページに表示できる犬のお迎え履歴はありません/);assert.ok(b('もっと見る'));
 await b('もっと見る').click();assert.match(root.textContent,/柴/);assert.doesNotMatch(root.textContent,/このページに表示できる犬のお迎え履歴はありません/);assert.deepEqual(historyCalls,['/api/plush/history','/api/plush/history?cursor=older-page']);
 // Closing and reopening the presentation must reuse the committed capsule.
 let draws=0,callbacks,scene;const starts=[];account.state=funded();
 account.command=async command=>{if(command.type==='plush_draw'){draws++;const result=applyPlush(account.state,command,{id:randomUUID(),candidate:'chihuahua'});account.state=result.state;return {state:result.state,plushResult:result.transaction};}account.state=applyCommand(account.state,command);return {state:account.state};};
 createPlushUI({account,openPanel(){},toast:x=>messages.push(x),createScene:opts=>{callbacks=opts;scene={active:false,requestId:null,start(receipt,item,options){this.active=true;this.requestId=receipt.requestId;starts.push({receipt,item,options});},close(){this.active=false;this.requestId=null;callbacks.onClose();}};return scene;}});
 await b('50ポイントで1回').click();assert.equal(draws,1);assert.equal(account.state.collection.spent,50);assert.equal(starts.length,1);assert.equal(starts[0].options.resume,false);assert.doesNotMatch(root.children.find(n=>n.className==='plush-reveal plush-sealed').textContent,/チワワ/);
 scene.close();await b('カプセルを開く').click();assert.equal(starts.length,2);assert.equal(starts[1].options.resume,true);assert.equal(starts[1].receipt.requestId,starts[0].receipt.requestId);assert.equal(draws,1);
 callbacks.onOpened(starts[1].receipt.requestId);scene.close();assert.match(root.children.find(n=>n.className==='plush-reveal').textContent,/チワワ/);await b('とじる').click();assert.equal(draws,1);assert.equal(account.state.collection.spent,50);assert.equal(account.state.collection.seenResult,starts[0].receipt.requestId);

});

test('retired animals remain readable but cannot be drawn, exchanged or placed again',()=>{const s=funded();s.collection.buttons=5;for(const id of ['calico','rabbit']){s.collection.owned[id]={count:1,firstAt:'2026-10-19T00:00:00Z'};s.collection.shelf[id==='calico'?'shelf-1-0':'shelf-1-1']=id;assert.throws(()=>draw(s,id),/ぬいぐるみ/);const fresh=funded();fresh.collection.buttons=5;assert.throws(()=>applyPlush(fresh,{type:'plush_exchange',item:id}),/ぬいぐるみ/);assert.throws(()=>applyCommand(s,{type:'plush_display',slot:'shelf-1-2',item:id}),/置き場所/);}assert.deepEqual(normalizeCollection(s.collection),s.collection);assert.deepEqual(applyCommand(s,{type:'mood',mood:'good'}).collection,s.collection);});

test('corrupt collection containers and inherited shelf items are rejected before spending',()=>{
 for(const patch of [{owned:[]},{owned:'invalid'},{shelf:[]},{shelf:'invalid'},{owned:{pomeranian:null}},{shelf:{[SHELF_SLOTS[0]]:'toString'}},{shelf:{[SHELF_SLOTS[0]]:['pomeranian']}}]){
  const state=draw(funded()).state;Object.assign(state.collection,patch);const before=structuredClone(state);
  assert.throws(()=>normalizeCollection(state.collection));assert.throws(()=>draw(state));assert.deepEqual(state,before);
 }
 const state=draw(funded()).state;assert.deepEqual(normalizeCollection(JSON.parse(JSON.stringify(state.collection))),state.collection);
});


test('moving a dog into a retired animal slot stores the animal without moving it to another slot',()=>{
 for(const retired of ['calico','rabbit']){
  const state=draw(funded(),'shiba').state;
  state.collection.owned[retired]={count:1,firstAt:'2026-10-19T00:00:00Z'};
  state.collection.shelf={[SHELF_SLOTS[0]]:'shiba',[SHELF_SLOTS[1]]:retired};
  const before=structuredClone(state);
  const next=applyCommand(state,{type:'plush_display',slot:SHELF_SLOTS[1],item:'shiba'});
  assert.deepEqual(next.collection.shelf,{[SHELF_SLOTS[1]]:'shiba'});
  assert.deepEqual(next.collection,{...before.collection,shelf:{[SHELF_SLOTS[1]]:'shiba'}});
  assert.deepEqual(next.progress,before.progress);
  assert.deepEqual(state,before);
  assert.deepEqual(normalizeCollection(next.collection),next.collection);
 }
});

test('four added breeds can be drawn, exchanged and displayed without altering existing ownership',()=>{
 for(const id of ['golden-retriever','dalmatian','papillon','samoyed']){
  const old=draw(funded()).state;const added=draw(seen(old),id).state;
  assert.deepEqual(added.collection.owned.pomeranian,old.collection.owned.pomeranian);
  assert.equal(added.collection.owned[id].count,1);
  const placed=applyCommand(added,{type:'plush_display',slot:SHELF_SLOTS[0],item:id});assert.equal(placed.collection.shelf[SHELF_SLOTS[0]],id);
  const s=funded();s.collection.buttons=5;const x=applyPlush(s,{type:'plush_exchange',item:id});assert.equal(x.state.collection.owned[id].count,1);assert.equal(x.state.collection.buttons,0);
 }
});


test('twenty added breeds have complete RGBA assets and support draw, exchange and saved shelf placement',async()=>{
 const {readFile}=await import('node:fs/promises');
 assert.equal(new Set(PLUSH_CATALOG.map(p=>p.id)).size,30);
 assert.deepEqual(PLUSH_CATALOG.map(p=>p.number),Array.from({length:30},(_,i)=>i+1));
 for(const p of PLUSH_CATALOG.slice(10)){
  const png=await readFile(new URL('../dist'+p.image,import.meta.url));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),384);assert.equal(png.readUInt32BE(20),384);assert.equal(png[25],6);
  assert.ok(p.origin&&p.history&&p.features&&p.trivia&&p.sources[0].checkedAt==='2026-10-20');
  const old=draw(funded()).state;const added=draw(seen(old),p.id).state;assert.deepEqual(added.collection.owned.pomeranian,old.collection.owned.pomeranian);
  const placed=applyCommand(added,{type:'plush_display',slot:SHELF_SLOTS[0],item:p.id});assert.equal(normalizeCollection(placed.collection).shelf[SHELF_SLOTS[0]],p.id);
  const s=funded();s.collection.buttons=5;assert.equal(applyPlush(s,{type:'plush_exchange',item:p.id}).state.collection.owned[p.id].count,1);
 }
});


test('unseen results block fresh draws and exchanges across clients without spending; retries and acknowledgement still work',async()=>{
 const f=await fixture(),requestId=randomUUID();
 const first=await f.request('/api/commands',{requestId,revision:0,command:{type:'plush_draw'}});assert.equal(first.status,200);
 const before=await f.store.read('alice');
 for(const command of [{type:'plush_draw'},{type:'plush_exchange',item:'shiba'}]){
  const result=await f.request('/api/commands',{requestId:randomUUID(),revision:before.revision,command});
  assert.equal(result.status,409);assert.deepEqual(await f.store.read('alice'),before);assert.equal(f.store.plushTransactions.size,1);
 }
 const replay=await f.request('/api/commands',{requestId,revision:0,command:{type:'plush_draw'}});assert.equal(replay.status,200);assert.equal(replay.body.plushResult.requestId,requestId);
 const ack=await f.request('/api/commands',{requestId:randomUUID(),revision:before.revision,command:{type:'plush_seen',id:requestId}});assert.equal(ack.status,200);
 const next=await f.request('/api/commands',{requestId:randomUUID(),revision:ack.body.state.revision,command:{type:'plush_draw'}});assert.equal(next.status,200);assert.equal(next.body.state.collection.spent,100);
});

test('hidden retired results do not trap users behind an acknowledgement they cannot perform',()=>{
 for(const item of ['calico','rabbit']){
  const s=draw(funded()).state;s.collection.lastResult.item=item;
  assert.equal(draw(s).state.collection.spent,100);
  s.collection.buttons=5;assert.equal(applyPlush(s,{type:'plush_exchange',item:'shiba'},{id:randomUUID()}).state.collection.buttons,0);
 }
});
