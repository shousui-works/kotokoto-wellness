import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountClient,localImport} from '../dist/account-client.mjs';
import {emptyAccount} from '../server/account-model.mjs';
function memory(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('client keeps an editor revision, restores connectivity with an unchanged cloud revision, and isolates canonical storage',async t=>{
 const elements=new Map(),events=new Map();const old={document:globalThis.document,window:globalThis.window,location:globalThis.location};
 globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,addEventListener(){},showModal(){}});return elements.get(id);},addEventListener(){}};
 globalThis.window={addEventListener:(name,fn)=>events.set(name,fn)};globalThis.location={hostname:'localhost',reload(){}};
 t.after(()=>Object.assign(globalThis,old));
 let cloud={...emptyAccount(),initialized:true,datasetId:'fixture',revision:10},disconnected=false,captured,recover=false;
 const local=memory();local.setItem('kotokoto-wellness-v1',JSON.stringify({version:1,days:{'2026-01-01':{habits:[]}},owned:[],decor:[]}));
 const sdkLoader=async()=>[{initializeApp:()=>({})},{getAuth:()=>({currentUser:{uid:'alice',email:'alice@example.test',getIdToken:async()=>'alice-token'},authStateReady:async()=>{}}),GoogleAuthProvider:class {},getRedirectResult:async()=>null,onAuthStateChanged(){},signOut:async()=>{},signInWithPopup:async()=>{},signInWithRedirect:async()=>{}}];
 const fetchImpl=async(path,init)=>{
  if(path==='/api/account/config')return Response.json({mode:'required',firebase:{}});
  if(disconnected)throw new TypeError('offline');
  assert.equal(init.headers.Authorization,'Bearer alice-token');
  if(path.startsWith('/api/sync'))return Response.json(path.includes('revision=10')?{unchanged:true}:{state:cloud});
  if(path==='/api/commands'){captured=JSON.parse(init.body);if(recover)return Response.json({state:{...cloud,revision:11},plushResult:{requestId:captured.requestId,item:'pomeranian'}});return Response.json({error:{code:'revision_conflict',message:'最新を確認してね。'}},{status:409});}
  throw Error('unexpected route');
 };
 const client=await createAccountClient({local,sdkLoader,fetchImpl,schedule(){}});
 assert.equal(client.writable,true);assert.equal(JSON.parse(client.storage.getItem('kotokoto-wellness-v1')).days['2026-01-01'],undefined);
 await assert.rejects(client.command({type:'profile',nickname:'そら'},{revision:8}),/最新/);assert.equal(captured.revision,8);
 disconnected=true;await events.get('online')();assert.equal(client.writable,false);
 disconnected=false;await events.get('online')();assert.equal(client.writable,true);
 assert.equal(JSON.parse(local.getItem('kotokoto-wellness-v1')).days['2026-01-01'].habits.length,0);
 recover=true;const pending={requestId:'00000000-0000-4000-8000-000000000001',revision:9,command:{type:'plush_draw'}};local.setItem('kotokoto-cloud-pending-v1:alice',JSON.stringify(pending));
 const recovered=await createAccountClient({local,sdkLoader,fetchImpl,schedule(){}});assert.deepEqual(captured,pending);assert.equal(local.getItem('kotokoto-cloud-pending-v1:alice'),null);assert.equal(recovered.state.revision,11);
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
