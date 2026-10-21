import test from 'node:test';import assert from 'node:assert/strict';import {createAdminAuth} from '../dist/admin-auth.mjs';
test('admin client sends bearer auth only, refreshes expired tokens and rejects late data after account switch',async()=>{
 let listener,replies=0,hold,release;const refresh=[],auth={currentUser:{uid:'owner',async getIdToken(force){refresh.push(force);return force?'fresh-token':'old-token';}},authStateReady:async()=>{}};
 const client=await createAdminAuth({sdkLoader:async()=>[{initializeApp:()=>({})},{getAuth:()=>auth,GoogleAuthProvider:class{},onAuthStateChanged:(_,fn)=>{listener=fn;},getRedirectResult:async()=>null}],fetchImpl:async(path,init)=>{
  if(path==='/api/account/config')return Response.json({mode:'required',firebase:{}});
  assert.equal(init.cache,'no-store');assert.equal(path.includes('token'),false);assert.match(init.headers.Authorization,/^Bearer /);
  if(hold){await new Promise(resolve=>release=resolve);return Response.json({sensitive:'old-account-metrics'});}
  if(!replies++)return Response.json({error:{message:'expired'}},{status:401});return Response.json({total:{calls:1}});
 }});
 client.subscribe(()=>{});assert.equal((await client.request('/api/admin/dashboard')).total.calls,1);assert.deepEqual(refresh,[false,true]);
 hold=true;const pending=client.request('/api/admin/dashboard');while(!release)await Promise.resolve();auth.currentUser={uid:'other'};listener(auth.currentUser);release();await assert.rejects(pending,/アカウントが変わり/);
 auth.currentUser=null;listener(null);await assert.rejects(client.request('/api/admin/dashboard'),/ログイン/);
});

test('expired refresh credentials are reported as authentication failure so the UI clears prior metrics',async()=>{
 for(const code of ['auth/user-token-expired','auth/invalid-user-token','auth/user-disabled','auth/network-request-failed']){
  const auth={currentUser:{uid:'owner',async getIdToken(force){if(force)throw Object.assign(Error('refresh failed'),{code});return 'old-token';}},authStateReady:async()=>{}};
  const client=await createAdminAuth({sdkLoader:async()=>[{initializeApp:()=>({})},{getAuth:()=>auth,getRedirectResult:async()=>null}],fetchImpl:async path=>path==='/api/account/config'?Response.json({mode:'required',firebase:{}}):Response.json({error:{message:'expired'}},{status:401})});
  await assert.rejects(client.request('/api/admin/dashboard'),error=>code==='auth/network-request-failed'?error.code===code&&error.status!==401:error.status===401);
 }
});
