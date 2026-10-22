// Offline account UI fixture. Excluded from image/build; no credentials or external AI calls.
import {readFile} from 'node:fs/promises';
import {createAppServer} from '../server/index.mjs';
import {createAccountAPI} from '../server/account-api.mjs';
import {MemoryAccountStore} from '../server/account-store.mjs';
const sdk=`export const initializeApp=x=>x;
const makeUser=()=>localStorage.getItem('fixture-user')?{uid:'fixture-alice',email:'alice@example.test',getIdToken:async()=>'fixture-token'}:null;
const auth={currentUser:makeUser(),authStateReady:async()=>{}};let listener;
export const getAuth=()=>auth;export class GoogleAuthProvider{setCustomParameters(){}}
export const getRedirectResult=async()=>null;
export const onAuthStateChanged=(_,fn)=>{listener=fn;fn(auth.currentUser);};
export const signInWithPopup=async()=>{localStorage.setItem('fixture-user','yes');auth.currentUser=makeUser();listener?.(auth.currentUser);};
export const signInWithRedirect=signInWithPopup;
export const signOut=async()=>{localStorage.removeItem('fixture-user');auth.currentUser=null;listener?.(null);};`;
const api=createAccountAPI({store:new MemoryAccountStore(),config:{projectId:'fixture',authDomain:'localhost',apiKey:'fixture',appId:'fixture'},verify:async t=>{if(t!=='fixture-token')throw Error();return {uid:'fixture-alice'};},generate:async input=>({status:200,body:{reply:'会いに来てくれて、うれしいな。きみの一歩に花まる！',actions:[]}})});
const server=createAppServer({accountHandler:async(req,res,path)=>{
 if(path==='/fixture-sdk.mjs'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(sdk);return true;}
 if(path==='/account-client.mjs'){let text=await readFile(new URL('../dist/account-client.mjs',import.meta.url),'utf8');text=text.replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js','/fixture-sdk.mjs').replaceAll('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js','/fixture-sdk.mjs');res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(text);return true;}
 return api(req,res,path);
}});const port=Number(process.env.PORT??8083);server.listen(port,'127.0.0.1',()=>console.log('Offline account fixture on 127.0.0.1:'+server.address().port));
