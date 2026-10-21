// Offline UI fixture only. Synthetic analytics and identity; no GCP or AI calls.
import {readFile} from 'node:fs/promises';
import {createAppServer} from '../server/index.mjs';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
import {MemoryUsageStore,usageDay} from '../server/admin-usage.mjs';
const admin=new MemoryUsageStore();admin.admins.add('fixture-owner');
for(let i=0;i<30;i++){const at=new Date();at.setDate(at.getDate()-i);for(let j=0;j<3+(i*7)%12;j++)await admin.record({purpose:j%5?'chat':'memory',inputTokens:3500+i*117,cachedTokens:i%3?3000:1000,cacheWriteTokens:200,outputTokens:100+i*4,elapsedMs:1200},{responseId:`fixture-${i}-${j}`,at:at.toISOString(),model:'gpt-6-luna',serviceTier:'default'});}
const sdk=`export const initializeApp=x=>x;const user={uid:'fixture-owner',getIdToken:async()=>'fixture-token'};const auth={currentUser:user,authStateReady:async()=>{}};export const getAuth=()=>auth;export class GoogleAuthProvider{setCustomParameters(){}}export const getRedirectResult=async()=>null;export const onAuthStateChanged=(_,fn)=>{fn(user);};export const signInWithPopup=async()=>{};export const signInWithRedirect=async()=>{};`;
const api=createAccountAPI({store:new MemoryAccountStore(),admin,apiAvailable:false,config:{projectId:'fixture',authDomain:'localhost',apiKey:'fixture',appId:'fixture'},verify:async t=>{if(t!=='fixture-token')throw Error();return {uid:'fixture-owner'};}});
createAppServer({accountHandler:async(req,res,path)=>{
 if(path==='/fixture-sdk.mjs'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(sdk);return true;}
 if(path==='/admin-auth.mjs'){let text=await readFile(new URL('../dist/admin-auth.mjs',import.meta.url),'utf8');text=text.replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js','/fixture-sdk.mjs').replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js','/fixture-sdk.mjs');res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(text);return true;}
 return api(req,res,path);
}}).listen(8084,'127.0.0.1',()=>console.log('Offline admin fixture on 127.0.0.1:8084; synthetic analytics only'));
