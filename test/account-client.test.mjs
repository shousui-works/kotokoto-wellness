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
