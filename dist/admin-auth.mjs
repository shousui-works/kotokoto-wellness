export async function createAdminAuth({fetchImpl=fetch,sdkLoader=async()=>Promise.all([import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js')])}={}){
 const config=await(await fetchImpl('/api/account/config',{cache:'no-store'})).json();if(config.mode!=='required')throw Error('管理コンソールはログイン対応サーバーで利用できます。');
 const [{initializeApp},{getAuth,GoogleAuthProvider,onAuthStateChanged,signInWithPopup,signInWithRedirect,getRedirectResult}]=await sdkLoader();
 const auth=getAuth(initializeApp(config.firebase));await auth.authStateReady();await getRedirectResult(auth);let stamp=0;
 return {get user(){return auth.currentUser;},subscribe(fn){return onAuthStateChanged(auth,user=>{stamp++;fn(user);});},async login(){const p=new GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});try{await signInWithPopup(auth,p);}catch(e){if(e.code==='auth/popup-blocked')await signInWithRedirect(auth,p);else throw Error('ログインできませんでした。もう一度試してください。');}},async request(path){const user=auth.currentUser,generation=stamp;if(!user)throw Object.assign(Error('Googleでログインしてください。'),{status:401});
  const send=async refresh=>{
   let token;try{token=await user.getIdToken(refresh);}catch(error){if(['auth/user-token-expired','auth/invalid-user-token','auth/user-disabled'].includes(error.code))throw Object.assign(Error('Googleでログインし直してください。'),{status:401});throw error;}
   return fetchImpl(path,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(20000)});
  };
  let r=await send(false);if(r.status===401)r=await send(true);const data=await r.json();if(stamp!==generation||auth.currentUser?.uid!==user.uid)throw Object.assign(Error('アカウントが変わりました。'),{status:401});if(!r.ok)throw Object.assign(Error(data.error?.message??'利用状況を読み込めませんでした。'),{status:r.status});return data;}};
}
