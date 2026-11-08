import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountClient,localImport} from '../dist/account-client.mjs';
import {emptyAccount} from '../server/account-model.mjs';
import {Readable} from 'node:stream';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {dayReport} from '../dist/progress.mjs';
function memory(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('client keeps an editor revision, restores connectivity with an unchanged cloud revision, and isolates canonical storage',async t=>{
 const elements=new Map(),events=new Map();const old={document:globalThis.document,window:globalThis.window,location:globalThis.location};
 globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,addEventListener(){},showModal(){}});return elements.get(id);},addEventListener(){}};
 globalThis.window={addEventListener:(name,fn)=>events.set(name,fn)};globalThis.location={hostname:'localhost',reload(){}};
 t.after(()=>Object.assign(globalThis,old));
 let cloud={...emptyAccount(),initialized:true,datasetId:'fixture',revision:10},disconnected=false,captured,delaySync=false,releaseSync,rejectIdentity=false;
 const local=memory();local.setItem('kotokoto-wellness-v1',JSON.stringify({version:1,days:{'2026-01-01':{habits:[]}},owned:[],decor:[]}));
 const sdkLoader=async()=>[{initializeApp:()=>({})},{getAuth:()=>({currentUser:{uid:'alice',email:'alice@example.test',getIdToken:async()=>'alice-token'},authStateReady:async()=>{}}),GoogleAuthProvider:class {},getRedirectResult:async()=>null,onAuthStateChanged(){},signOut:async()=>{},signInWithPopup:async()=>{},signInWithRedirect:async()=>{}}];
 const fetchImpl=async(path,init)=>{
  if(path==='/api/account/config')return Response.json({mode:'required',firebase:{}});
  if(disconnected)throw new TypeError('offline');
  assert.equal(init.headers.Authorization,'Bearer alice-token');
  if(rejectIdentity)return Response.json({error:{code:'login_expired',message:'ログインし直してね。'}},{status:401});
  if(path.startsWith('/api/sync')){
   if(delaySync){delaySync=false;const old=structuredClone(cloud);return new Promise(resolve=>{releaseSync=()=>resolve(Response.json({state:old}));});}
   return Response.json(path.includes('revision='+cloud.revision)?{unchanged:true}:{state:cloud});
  }
  if(path==='/api/commands'){captured=JSON.parse(init.body);return Response.json({error:{code:'revision_conflict',message:'最新を確認してね。'}},{status:409});}
  throw Error('unexpected route');
 };
 const client=await createAccountClient({local,sdkLoader,fetchImpl,schedule(){}});
 assert.equal(client.writable,true);assert.equal(JSON.parse(client.storage.getItem('kotokoto-wellness-v1')).days['2026-01-01'],undefined);
 await assert.rejects(client.command({type:'profile',nickname:'そら'},{revision:8}),/最新/);assert.equal(captured.revision,8);
 delaySync=true;const slowSync=events.get('online')();while(!releaseSync)await new Promise(resolve=>setImmediate(resolve));
 cloud={...cloud,revision:11,profile:{version:1,nickname:'新しい名前'}};
 await events.get('online')();assert.equal(client.state.revision,11);
 releaseSync();await slowSync;assert.equal(client.state.revision,11);assert.equal(client.state.profile.nickname,'新しい名前');
 assert.equal(JSON.parse(local.getItem('kotokoto-cloud-cache-v1:alice')).revision,11);
 disconnected=true;await events.get('online')();assert.equal(client.writable,false);
 disconnected=false;await events.get('online')();assert.equal(client.writable,true);
 assert.equal(JSON.parse(local.getItem('kotokoto-wellness-v1')).days['2026-01-01'].habits.length,0);
 delaySync=true;releaseSync=null;const oldAuthorizedSync=events.get('online')();while(!releaseSync)await new Promise(resolve=>setImmediate(resolve));
 rejectIdentity=true;await events.get('online')();assert.equal(client.state,null);assert.equal(client.writable,false);
 releaseSync();await oldAuthorizedSync;assert.equal(client.state,null);assert.equal(client.writable,false);assert.equal(local.getItem('kotokoto-cloud-cache-v1:alice'),null);
});
test('migration preview never rewrites corrupt or future local records',()=>{const local=memory();local.setItem('kotokoto-wellness-v1','{"version":2}');assert.throws(()=>localImport(local));assert.equal(local.getItem('kotokoto-wellness-v1'),'{"version":2}');});

test('welcome waits for restored auth, prompts guests once and lets initialized users enter directly',async t=>{
 const old={document:globalThis.document,window:globalThis.window,location:globalThis.location};t.after(()=>Object.assign(globalThis,old));
 for(const signedIn of [false,true]){
  const elements=new Map();globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,open:false,shows:0,listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},showModal(){this.open=true;this.shows++;}});return elements.get(id);},addEventListener(){}};
  globalThis.window={addEventListener(){}};globalThis.location={hostname:'localhost',reload(){}};
  let release,started,popups=0;const ready=new Promise(r=>release=r),waiting=new Promise(r=>started=r);
  const user={uid:'fixture',email:'fixture@example.test',getIdToken:async()=>'fixture-token'},auth={currentUser:null,async authStateReady(){started();await ready;}};
  const cloud={...emptyAccount(),initialized:true,datasetId:'fixture',profile:{version:1,nickname:'そら',petName:'こむぎ',namesConfigured:true}};
  const clientPromise=createAccountClient({local:memory(),schedule(){},fetchImpl:async path=>path==='/api/account/config'?Response.json({mode:'required',firebase:{}}):Response.json({state:cloud}),sdkLoader:async()=>[{initializeApp:x=>x},{getAuth:()=>auth,GoogleAuthProvider:class{setCustomParameters(){}},getRedirectResult:async()=>null,onAuthStateChanged(){},signInWithPopup:async()=>{popups++;},signInWithRedirect:async()=>{},signOut:async()=>{}}]});
  await waiting;assert.equal(elements.get('account-dialog')?.shows??0,0);
  auth.currentUser=signedIn?user:null;release();const client=await clientPromise;
  assert.equal(elements.get('account-dialog')?.shows??0,signedIn?0:1);assert.equal(client.needsSetup,!signedIn);assert.equal(popups,0);
  if(!signedIn){assert.equal(elements.get('account-title').textContent,'ログインしてはじめよう');assert.equal(elements.get('account-login').hidden,false);assert.equal(elements.get('account-logout-help').hidden,true);await elements.get('account-login').listeners.get('click')();assert.equal(popups,1);}
 }
});

async function accountHarness(t,{local=memory(),uid='alice',cloud={...emptyAccount(),initialized:true,datasetId:'fixture',revision:1},send}={}){
 const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location},elements=new Map(),requests=[];
 globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',handlers:new Map(),addEventListener(name,fn){this.handlers.set(name,fn);},showModal(){},close(){}});return elements.get(id);},addEventListener(){}};
 globalThis.window={addEventListener(){}};globalThis.location={hostname:'localhost',reload(){}};t.after(()=>Object.assign(globalThis,previous));
 const user={uid,getIdToken:async()=>uid+'-token'};
 const sdkLoader=async()=>[{initializeApp:()=>({})},{getAuth:()=>({currentUser:user,authStateReady:async()=>{}}),GoogleAuthProvider:class{},getRedirectResult:async()=>null,onAuthStateChanged(){}}];
 const fetchImpl=async(path,init)=>{
  if(path==='/api/account/config')return Response.json({mode:'required',firebase:{}});
  if(path.startsWith('/api/sync'))return Response.json({state:typeof cloud==='function'?await cloud():cloud});
  const body=JSON.parse(init.body);requests.push({path,body});return send(path,body);
 };
 const client=await createAccountClient({local,sdkLoader,fetchImpl,schedule(){}});
 return {client,local,elements,requests,click:id=>elements.get(id).handlers.get('click')()};
}

test('401 preserves a pending save across reauthentication for the same UID, without leaking it to another UID',async t=>{
 const local=memory(),command={type:'weight',value:60};
 const expired=await accountHarness(t,{local,send:async()=>Response.json({error:{code:'login_expired',message:'ログインし直してね。'}},{status:401})});
 await assert.rejects(expired.client.command(command),/ログイン/);
 const pending=JSON.parse(local.getItem('kotokoto-cloud-pending-v1:alice'));assert.deepEqual(pending.command,command);assert.equal(pending.revision,1);assert.equal(expired.client.writable,false);
 const restored=await accountHarness(t,{local,send:async()=>Response.json({state:{...emptyAccount(),initialized:true,datasetId:'fixture',revision:2}})});
 await restored.click('account-retry');assert.equal(restored.requests.length,1);assert.deepEqual(restored.requests[0].body,pending);assert.equal(local.getItem('kotokoto-cloud-pending-v1:alice'),null);
 local.setItem('kotokoto-cloud-pending-v1:alice',JSON.stringify(pending));
 const other=await accountHarness(t,{local,uid:'bob',send:async()=>Response.json({state:{...emptyAccount(),initialized:true,revision:2}})});
 await other.client.command({type:'mood',mood:'good'});assert.notEqual(other.requests[0].body.requestId,pending.requestId);assert.equal(local.getItem('kotokoto-cloud-pending-v1:alice'),JSON.stringify(pending));
});

test('import retains its ID for unknown outcomes and busy responses, but can recover from a changed-payload conflict',async t=>{
 const local=memory(),original=JSON.stringify({version:1,days:{'2026-10-18':{habits:['stretch']}},owned:[],decor:[]});
 local.setItem('kotokoto-wellness-v1',original);local.setItem('kotokoto-names-draft:alice',JSON.stringify({version:1,nickname:'そら',petName:'もち',namesConfigured:true}));
 let attempts=0;
 const f=await accountHarness(t,{local,cloud:emptyAccount(),send:async()=>{
  attempts++;const code=['storage_unavailable','import_busy','request_conflict'][attempts-1];
  return code?Response.json({error:{code,message:code}},{status:attempts===1?503:409}):Response.json({state:{...emptyAccount(),initialized:true,revision:1}});
 }});
 await f.click('account-import');const oldID=f.requests[0].body.requestId;
 await f.click('account-import');assert.equal(local.getItem('kotokoto-import-request:alice'),oldID);
 f.elements.get('account-own-name').value='新しい名前';f.elements.get('account-pet-name').value='もち';await f.elements.get('account-names-form').handlers.get('submit')({preventDefault(){}});
 await f.click('account-import');assert.equal(local.getItem('kotokoto-import-request:alice'),null);
 await f.click('account-import');assert.equal(f.requests[1].body.requestId,oldID);assert.equal(f.requests[2].body.requestId,oldID);assert.notEqual(f.requests[3].body.requestId,oldID);assert.equal(f.requests[3].body.data.profile.nickname,'新しい名前');assert.equal(local.getItem('kotokoto-wellness-v1'),original);
});


test('pending plush draw is recovered with the original request on initial sync',async t=>{
 const local=memory(),pending={requestId:'00000000-0000-4000-8000-000000000001',revision:9,command:{type:'plush_draw'}};
 local.setItem('kotokoto-cloud-pending-v1:alice',JSON.stringify(pending));
 const f=await accountHarness(t,{local,send:async(path,body)=>{
  assert.equal(path,'/api/commands');assert.deepEqual(body,pending);
  return Response.json({state:{...emptyAccount(),initialized:true,datasetId:'fixture',revision:11},plushResult:{requestId:body.requestId,item:'pomeranian'}});
 }});
 assert.equal(f.requests.length,1);assert.equal(local.getItem('kotokoto-cloud-pending-v1:alice'),null);assert.equal(f.client.state.revision,11);
});

test('lost meal confirmation survives reload without a photo or a new request ID',async t=>{
 const local=memory(),id='00000000-0000-4000-8000-000000000037';
 const store=new MemoryAccountStore(),estimate={status:'ok',items:[{name:'ご飯',portion:'1杯',kcal:230}],basis:'架空のテスト用推定。',question:''};
 const api=createAccountAPI({store,config:{},verify:async()=>({uid:'alice'}),now:()=>Date.parse('2026-10-30T03:00:00Z'),estimateMeal:async()=>({status:200,body:{estimate}})});
 async function sendAPI(path,data){
  const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{method:'POST',url:path,headers:{host:'app.example',origin:'https://app.example',authorization:'Bearer fixture-token'}});
  let status,result;assert.equal(await api(req,{writeHead(value){status=value;},end(value){result=JSON.parse(value);}},path),true);
  return Response.json(result,{status});
 }
 assert.equal((await sendAPI('/api/commands',{requestId:crypto.randomUUID(),revision:0,command:{type:'initialize'}})).status,200);
 const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,192,0,11,8,0,16,0,16,3,1,17,0,255,217]).toString('base64');
 assert.equal((await sendAPI('/api/meal-photo/estimate',{requestId:id,image,note:''})).status,200);
 const cloud=()=>store.read('alice');
 const command={type:'confirm_meal_photo',estimateId:id,date:'2026-10-30',mealType:'lunch',targetId:null,items:[{name:'ご飯',portion:'半分',kcal:115}]};
 const lost=await accountHarness(t,{local,cloud,send:async(path,body)=>{
  const response=await sendAPI(path,body);assert.equal(response.status,200);assert.equal((await response.json()).recorded,true);
  // The real API commits the meal; only its response to the client is discarded.
  throw new TypeError('response lost');
 }});
 await assert.rejects(lost.client.command(command,{requestId:id,revision:1}),/response lost/);
 const saved=await cloud();assert.equal(saved.revision,2);assert.equal(saved.progress.activities.length,1);assert.equal(saved.progress.activities[0].intake.kcal,115);assert.equal(dayReport(saved.progress,'2026-10-30').total,5);
 assert.equal(lost.client.state.revision,1);
 const pending=JSON.parse(local.getItem('kotokoto-cloud-pending-v1:alice'));
 assert.deepEqual(pending,{requestId:id,revision:1,command});assert.equal(JSON.stringify(pending).includes('image'),false);
 await assert.rejects(lost.client.command({...command,estimateId:'another-photo'}),/未確認/);
 const other=await accountHarness(t,{local,uid:'bob',send:async()=>{throw Error('must not replay another user');}});
 assert.equal(other.requests.length,0);assert.equal(local.getItem('kotokoto-cloud-pending-v1:alice'),JSON.stringify(pending));
 const restored=await accountHarness(t,{local,cloud,send:async(path,body)=>{
  assert.equal(path,'/api/commands');assert.deepEqual(body,pending);
  return sendAPI(path,body);
 }});
 assert.equal(restored.requests.length,1);assert.equal(local.getItem('kotokoto-cloud-pending-v1:alice'),null);
 assert.deepEqual(await cloud(),saved);assert.deepEqual(restored.client.state.progress,saved.progress);assert.equal(dayReport(restored.client.state.progress,'2026-10-30').total,5);
});

test('automatic greeting preserves its mode and the user draft',async t=>{
 const local=memory();local.setItem('kotokoto-cloud-draft:alice','書きかけ');
 const f=await accountHarness(t,{local,send:async()=>Response.json({skipped:true})});
 const response=await f.client.fetch('/api/chat',{method:'POST',body:JSON.stringify({requestId:'greeting',mode:'welcome'})});
 assert.equal(response.status,200);assert.deepEqual(f.requests[0].body,{requestId:'greeting',mode:'welcome'});
 assert.equal(local.getItem('kotokoto-cloud-draft:alice'),'書きかけ');
});
