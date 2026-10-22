import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Readable} from 'node:stream';
import {createPushService,FirestorePushStore,validateSubscription,dailyPlan,nextRandomDelivery,PERIODS,periodEnd,japanDay,notification,subscriptionId} from '../server/push.mjs';
import {createAccountAPI} from '../server/account-api.mjs';
import {createPushSettings,pushSupport} from '../dist/push-settings.mjs';
const now=Date.parse('2026-10-20T20:00:00+09:00');
const ec=createECDH('prime256v1');ec.generateKeys();
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/example',keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
// Small transactional Firestore fake: exercise the actual repository, not a copied algorithm.
function database(){
 const rows=new Map();let tail=Promise.resolve();
 const snapshot=ref=>({exists:rows.has(ref.path),id:ref.path.split('/').at(-1),ref,data:()=>structuredClone(rows.get(ref.path))});
 function collection(path,filter=null,max=Infinity){return {path,doc:id=>doc(path+'/'+id),where:(key,op,value)=>collection(path,{key,op,value},max),limit:n=>collection(path,filter,n),async get(){const docs=[...rows.keys()].filter(key=>key.startsWith(path+'/')&&key.slice(path.length+1).indexOf('/')<0).map(key=>snapshot(doc(key))).filter(d=>!filter||(filter.op==='=='?d.data()[filter.key]===filter.value:d.data()[filter.key]<=filter.value)).slice(0,max);return {docs,size:docs.length};}};}
 function doc(path){return {path,collection:id=>collection(path+'/'+id),get:async()=>snapshot(doc(path))};}
 return {rows,collection,runTransaction(fn){const work=tail.then(()=>fn({get:ref=>ref.get(),set:(ref,value)=>rows.set(ref.path,structuredClone(value)),update:(ref,value)=>rows.set(ref.path,{...rows.get(ref.path),...structuredClone(value)}),delete:ref=>rows.delete(ref.path)}));tail=work.catch(()=>{});return work;}};
}
function fixture(){const db=database();db.rows.set('users/alice',{initialized:true,datasetId:'d'});db.rows.set('users/alice/datasets/d/settings/profile',{profile:{petName:'もち'}});const store=new FirestorePushStore(db),sent=[];let clock=now;const push=createPushService({store,publicKey:'public',now:()=>clock,send:async(s,p)=>sent.push({s,p:JSON.parse(p)})});return {db,store,push,sent,setNow:n=>clock=n};}
test('only valid vendor HTTPS subscriptions and P-256 keys are accepted',()=>{
 assert.deepEqual(validateSubscription(sub),sub);
 for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:123/a','https://web.push.apple.com/a#x'])assert.throws(()=>validateSubscription({...sub,endpoint}));
 assert.throws(()=>validateSubscription({...sub,keys:{...sub.keys,p256dh:'A'.repeat(87)}}));
 for(const endpoint of ['https://web.push.apple.com/Q/a','https://updates.push.services.mozilla.com/wpush/v2/a'])assert.equal(validateSubscription({...sub,endpoint}).endpoint,endpoint);
});
test('random plans use distinct daytime windows, bounded count and persist chosen times',()=>{
 for(const frequency of [1,2,3])for(let n=0;n<100;n++){
  const plan=dailyPlan(now,frequency);assert.equal(plan.slots.length,frequency);assert.equal(new Set(plan.slots.map(s=>s.period)).size,frequency);
  for(const s of plan.slots){const hour=new Date(s.at+9*3600000).getUTCHours(),p=PERIODS.find(p=>p.id===s.period);assert.ok(hour>=p.start&&hour<p.end);assert.equal(s.at%300000,0);}
 }
 const future=nextRandomDelivery(now,2);assert.ok(future.nextAt>now);assert.deepEqual(nextRandomDelivery(now+1,2,future.plan),future);
 assert.equal(japanDay(Date.parse('2026-10-20T15:00:00Z')),'2026-10-21');assert.throws(()=>dailyPlan(now,4));
});
test('registered device belongs to UID; another UID cannot read, delete or take over',async()=>{
 const f=fixture();await f.push.handle('alice','PUT',{subscription:sub,frequency:2});const id=subscriptionId(sub.endpoint);
 assert.equal((await f.push.handle('bob','GET',{id})).enabled,false);await f.push.handle('bob','DELETE',{id});assert.equal((await f.push.handle('alice','GET',{id})).enabled,true);
 await assert.rejects(f.push.handle('bob','PUT',{subscription:sub,frequency:2}),e=>e.status===409);await assert.rejects(f.push.handle('bob','POST',{id}),e=>e.status===404);
});
test('5 device limit and saving does not reset daily duplicate guard',async()=>{
 const f=fixture();for(let i=0;i<5;i++)await f.push.handle('alice','PUT',{subscription:{...sub,endpoint:sub.endpoint+i},frequency:2});
 await assert.rejects(f.push.handle('alice','PUT',{subscription:{...sub,endpoint:sub.endpoint+5},frequency:2}),e=>e.status===409);
 const id=subscriptionId(sub.endpoint+'0'),at=(await f.store.get('alice',id)).nextAt;await f.store.claim(id,at);const before=await f.store.get('alice',id);await f.store.save('alice',{...sub,endpoint:sub.endpoint+'0'},2,at+1);assert.deepEqual((await f.store.get('alice',id)).sentPeriods,before.sentPeriods);
});
test('concurrent scheduled runs send once per device/period and respect off',async()=>{
 const f=fixture();await f.push.handle('alice','PUT',{subscription:sub,frequency:2});f.setNow((await f.store.get('alice',subscriptionId(sub.endpoint))).nextAt);
 await Promise.all([f.push.dispatch(),f.push.dispatch()]);assert.equal(f.sent.length,1);assert.equal(f.sent[0].p.title,'もちから');
 await f.push.dispatch();assert.equal(f.sent.length,1);
 await f.push.handle('alice','DELETE',{id:subscriptionId(sub.endpoint)});f.setNow(now+2*86400000);await f.push.dispatch();assert.equal(f.sent.length,1);
});
test('test delivery cooldown and expired subscriptions removed; no raw errors or keys returned',async()=>{
 const f=fixture();await f.push.handle('alice','PUT',{subscription:sub,frequency:2});const id=subscriptionId(sub.endpoint);
 assert.deepEqual(await f.push.handle('alice','POST',{id}),{sent:true});await assert.rejects(f.push.handle('alice','POST',{id}),e=>e.status===429);
 const expired=createPushService({store:f.store,publicKey:'key',now:()=>now+61000,send:async()=>{throw {statusCode:410,body:sub.endpoint};}});
 await assert.rejects(expired.handle('alice','POST',{id}),e=>e.status===410&&!e.message.includes(sub.endpoint));assert.equal(await f.store.get('alice',id),null);
});
test('deleted/uninitialized account removed; failed scheduled delivery not duplicated',async()=>{
 const f=fixture();await f.push.handle('alice','PUT',{subscription:sub,frequency:2});f.db.rows.delete('users/alice');f.setNow((await f.store.get('alice',subscriptionId(sub.endpoint))).nextAt);assert.equal((await f.push.dispatch()).removed,1);assert.equal(f.sent.length,0);
 const g=fixture();await g.push.handle('alice','PUT',{subscription:sub,frequency:2});const at=(await g.store.get('alice',subscriptionId(sub.endpoint))).nextAt;let attempts=0;const fail=createPushService({store:g.store,publicKey:'key',now:()=>at,send:async()=>{attempts++;throw Error('secret endpoint');}});assert.equal((await fail.dispatch()).failed,1);await fail.dispatch();assert.equal(attempts,1);
});
test('payload contains only short pet greeting and safe room route',()=>{
 const payload=notification('もち',now,false,'morning',()=>0);assert.equal(payload.title,'もちから');assert.equal(payload.url,'/#room');assert.ok(!JSON.stringify(payload).includes('体重'));assert.match(payload.body,/おはよう/);assert.match(notification('もち',now,false,'afternoon',()=>0).body,/お昼/);assert.match(notification('もち',now,false,'evening',()=>0).body,/おつかれ/);
});
test('push API uses existing authentication, same-origin check, size bound and UID',async()=>{
 let identity=null;const api=createAccountAPI({store:{},config:{},verify:async token=>{if(token!=='valid')throw Error();return {uid:'alice'};},push:{publicKey:'public',handle:async(uid,method,input)=>{identity=uid;return {method,input};}}});
 async function call(path,method,headers={},value={}){const req=Readable.from([Buffer.from(JSON.stringify(value))]);Object.assign(req,{url:path,method,headers:{host:'app.test',...headers}});let status,data;await api(req,{writeHead:s=>status=s,end:b=>data=JSON.parse(b)},path.split('?')[0]);return {status,data};}
 assert.equal((await call('/api/push/config','GET')).status,401);
 assert.equal((await call('/api/push/subscription','PUT',{authorization:'Bearer valid',origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/push/subscription','PUT',{authorization:'Bearer valid',origin:'https://app.test'},{x:'a'.repeat(9000)})).status,413);
 assert.equal((await call('/api/push/test','POST',{authorization:'Bearer valid',origin:'https://app.test'},{id:'id'})).status,200);assert.equal(identity,'alice');
 assert.equal((await call('/api/push/config','GET',{authorization:'Bearer valid'})).data.publicKey,'public');
});
test('iPhone requires Home Screen; support detection never prompts',()=>{
 const nav={userAgent:'iPhone',standalone:false};assert.equal(pushSupport({secure:true,nav,win:{matchMedia:()=>({matches:false})}}),'install');
 assert.equal(pushSupport({secure:true,nav:{...nav,standalone:true,serviceWorker:{}},win:{Notification:{},PushManager:{}}}),'supported');
 assert.equal(pushSupport({secure:false,nav:{userAgent:''},win:{}}),'unsupported');
});
test('worker shows generic fallback, never opens external payload URL or intercepts fetch',async()=>{
 const handlers={},shown=[],opened=[];const self={location:{origin:'https://app.test'},addEventListener:(type,fn)=>handlers[type]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(await readFile(new URL('../dist/push-sw.js',import.meta.url),'utf8'),{self,URL});let done;
 handlers.push({data:{json:()=>({title:'もちから',body:'おつかれさま',url:'https://evil.test'})},waitUntil:p=>done=p});await done;assert.equal(shown[0][0],'もちから');assert.equal(shown[0][1].data.url,'/#room');
 handlers.notificationclick({notification:{close(){}},waitUntil:p=>done=p});await done;assert.deepEqual(opened,['https://app.test/#room']);assert.equal(handlers.fetch,undefined);
});

function settingsFixture(){
 const elements=new Map();for(const id of ['push-settings','push-status','push-enable','push-disable','push-save','push-test','push-frequency','settings-open'])elements.set(id,{hidden:false,disabled:false,value:id==='push-frequency'?'2':'',textContent:'',handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});
 let subscribed=null,stored=false,permissionCalls=0,logout,tests=0,puts=0;
 const subscription={endpoint:sub.endpoint,toJSON:()=>sub,unsubscribe:async()=>{subscribed=null;return true;}};
 const reg={pushManager:{getSubscription:async()=>subscribed,subscribe:async()=>{subscribed=subscription;return subscription;}}};
 const account={enabled:true,user:{uid:'alice'},beforeLogout:fn=>logout=fn,subscribe:()=>{},fetch:async(path,init)=>{
  if(path==='/api/push/config')return Response.json({publicKey:ec.getPublicKey().toString('base64url')});
  if(path==='/api/push/test'){tests++;return Response.json({sent:true});}
  if(init.method==='PUT'){stored=true;puts++;return Response.json({enabled:true});}
  if(init.method==='DELETE'){stored=false;return Response.json({enabled:false});}
  return Response.json({enabled:stored,frequency:2});
 }};
 const options={account,root:{getElementById:id=>elements.get(id)},support:'supported',permission:()=> 'granted',nav:{serviceWorker:{register:async()=>reg,ready:Promise.resolve(reg),getRegistration:async()=>reg}},win:{Notification:{requestPermission:async()=>{permissionCalls++;return 'granted';}}}};
 return {elements,options,click:id=>elements.get(id).handlers.click(),logout:()=>logout(),get state(){return {stored,permissionCalls,tests,puts,subscribed:!!subscribed};}};
}
test('settings prompts only on enable; frequency save/test/off and logout use the same device',async()=>{
 const f=settingsFixture(),ui=createPushSettings(f.options);await ui.ready;assert.equal(f.state.permissionCalls,0);assert.equal(f.elements.get('push-disable').hidden,true);
 await f.click('push-enable');assert.equal(f.state.permissionCalls,1);assert.equal(f.state.stored,true);assert.equal(f.elements.get('push-enable').hidden,true);
 await f.click('push-save');await f.click('push-test');assert.equal(f.state.puts,2);assert.equal(f.state.tests,1);
 await f.logout();assert.equal(f.state.stored,false);assert.equal(f.state.subscribed,false);
 await f.click('push-enable');await f.click('push-disable');assert.equal(f.state.stored,false);assert.equal(f.elements.get('push-enable').hidden,false);
});
test('denied permission leaves notification disabled and does not save device',async()=>{
 const f=settingsFixture();f.options.win.Notification.requestPermission=async()=> 'denied';const ui=createPushSettings(f.options);await ui.ready;await f.click('push-enable');assert.equal(f.state.puts,0);assert.match(f.elements.get('push-status').textContent,/許可/);
});


test('missed windows are skipped; frequency changes cannot duplicate same-period greetings',async()=>{
 const f=fixture(),id=subscriptionId(sub.endpoint);await f.push.handle('alice','PUT',{subscription:sub,frequency:3});
 let row=await f.store.get('alice',id);f.setNow(periodEnd(row.nextAt,row.nextPeriod)+1000);const skipped=await f.push.dispatch();assert.equal(skipped.sent,0);
 row=await f.store.get('alice',id);assert.ok(row.nextAt>periodEnd(now,'evening')||row.nextAt>now);
 f.setNow(row.nextAt);await f.push.dispatch();assert.equal(f.sent.length,1);const delivered=await f.store.get('alice',id);
 await f.push.handle('alice','PUT',{subscription:sub,frequency:1});assert.deepEqual((await f.store.get('alice',id)).sentPeriods,delivered.sentPeriods);
});

test('logout cannot race an in-flight notification registration',async()=>{
 const f=settingsFixture(),original=f.options.account.fetch;let release,started;
 const pending=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 f.options.account.fetch=async(path,init)=>{if(init.method==='PUT'){started();await pending;}return original(path,init);};
 const ui=createPushSettings(f.options);await ui.ready;
 const enabling=f.click('push-enable');await entered;
 try{await assert.rejects(f.logout(),/通知の設定中/);}finally{release();await enabling;}
 await f.logout();assert.equal(f.state.stored,false);assert.equal(f.state.subscribed,false);
});

test('notification click opens room when an existing client cannot navigate',async()=>{
 const handlers={},opened=[];let focused=false,done;
 const self={location:{origin:'https://app.test'},addEventListener:(type,fn)=>handlers[type]=fn,clients:{matchAll:async()=>[{url:'https://app.test/',navigate:async()=>{throw TypeError('uncontrolled');},focus:async()=>{focused=true;}}],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(await readFile(new URL('../dist/push-sw.js',import.meta.url),'utf8'),{self,URL});
 handlers.notificationclick({notification:{close(){}},waitUntil:p=>done=p});await done;
 assert.deepEqual(opened,['https://app.test/#room']);assert.equal(focused,false);
});
test('dispatch continues after one claim fails',async()=>{
 const f=fixture();await f.push.handle('alice','PUT',{subscription:sub,frequency:2});
 const id=subscriptionId(sub.endpoint),at=(await f.store.get('alice',id)).nextAt;let listed=false;
 const store={due:async()=>{if(listed)return [];listed=true;return [{id:'broken'},{id}];},claim:async(key,time)=>{if(key==='broken')throw Error('transaction failed');return f.store.claim(key,time);},petName:uid=>f.store.petName(uid)};
 const push=createPushService({store,publicKey:'key',now:()=>at,send:async()=>{}});
 assert.deepEqual(await push.dispatch(),{sent:1,failed:1,expired:0,removed:0});
});
test('delivery diagnostics contain only a bounded numeric HTTP status',async t=>{
 const f=fixture();await f.push.handle('alice','PUT',{subscription:sub,frequency:2});const id=subscriptionId(sub.endpoint),logs=[];
 t.mock.method(console,'error',line=>logs.push(JSON.parse(line)));
 for(const statusCode of [403,'private endpoint']){
 const push=createPushService({store:f.store,publicKey:'key',now:()=>now+logs.length*61000,send:async()=>{throw {statusCode,body:'private body',endpoint:sub.endpoint};}});
 await assert.rejects(push.handle('alice','POST',{id}),e=>e.status===503);
 }
 assert.deepEqual(logs,[{event:'push_send_failed',status:403},{event:'push_send_failed',status:null}]);
});
