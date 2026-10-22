import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountClient,localImport} from '../dist/account-client.mjs';
import {emptyAccount} from '../server/account-model.mjs';
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

async function accountHarness(t,{local=memory(),uid='alice',cloud={...emptyAccount(),initialized:true,datasetId:'fixture',revision:1},send}={}){
 const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location},elements=new Map(),requests=[];
 globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',handlers:new Map(),addEventListener(name,fn){this.handlers.set(name,fn);},showModal(){},close(){}});return elements.get(id);},addEventListener(){}};
 globalThis.window={addEventListener(){}};globalThis.location={hostname:'localhost',reload(){}};t.after(()=>Object.assign(globalThis,previous));
 const user={uid,getIdToken:async()=>uid+'-token'};
 const sdkLoader=async()=>[{initializeApp:()=>({})},{getAuth:()=>({currentUser:user,authStateReady:async()=>{}}),GoogleAuthProvider:class{},getRedirectResult:async()=>null,onAuthStateChanged(){}}];
 const fetchImpl=async(path,init)=>{
  if(path==='/api/account/config')return Response.json({mode:'required',firebase:{}});
  if(path.startsWith('/api/sync'))return Response.json({state:cloud});
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
