import {emptyState} from './model.mjs';
import {emptyProgress,normalizeProgress} from './progress.mjs?v=daily-life-1';
import {normalizeConversation} from './komugi-conversation.mjs';
import {normalizeNickname,normalizeNames} from './profile.mjs';
const KEYS={legacy:'kotokoto-wellness-v1',progress:'kotokoto-progress-v1',profile:'kotokoto-profile-v1',conversation:'kotokoto-komugi-conversation-v1',voice:'kotokoto-companion-chat-v1'};
const ownerKey='kotokoto-import-owner-v1',cacheKey=uid=>'kotokoto-cloud-cache-v1:'+uid,pendingKey=uid=>'kotokoto-cloud-pending-v1:'+uid;
export function snapshotStorage(state){const map=new Map();if(state){map.set(KEYS.legacy,JSON.stringify(state.legacy));map.set(KEYS.progress,JSON.stringify(state.progress));map.set(KEYS.profile,JSON.stringify(state.profile));map.set(KEYS.conversation,JSON.stringify(state.conversation));}return map;}
export function localImport(storage){
  const read=key=>{const text=storage.getItem(key);return text===null?null:JSON.parse(text);};
  const legacy=read(KEYS.legacy)??emptyState(),progress=read(KEYS.progress),profile=read(KEYS.profile),conversation=read(KEYS.conversation),voice=read(KEYS.voice);
  if(legacy.version!==1)throw Error('新しい形式の記録は取り込めません。元の記録は残しています。');
  if(progress)normalizeProgress(progress);if(conversation)normalizeConversation(conversation);normalizeNickname(profile?.nickname??'');
  return {legacy,progress,profile,conversation,chatEnabled:voice?.enabled!==false};
}
async function bootstrapAccountClient({fetchImpl=globalThis.fetch,local=globalThis.localStorage,sdkLoader=null,schedule=globalThis.setInterval}={}){
  let config;
  try{const r=await fetchImpl('/api/account/config',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(r.status===404&&['localhost','127.0.0.1'].includes(location.hostname))return {enabled:false,storage:local,fetch:fetchImpl};if(!r.ok)throw Error();config=await r.json();}catch{throw Error('保存先につながりませんでした。記録を保護しています。画面を読み込み直してね。');}
  if(config.mode==='legacy')return {enabled:false,storage:local,fetch:fetchImpl};
  if(config.mode!=='required')throw Error('保存先の設定を確認できませんでした。');
  const [{initializeApp},{getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut}]=await (sdkLoader?sdkLoader():Promise.all([
    import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js'),
  ]));
  const auth=getAuth(initializeApp(config.firebase));await auth.authStateReady();
  let redirectError='';try{await getRedirectResult(auth);}catch{redirectError='ログインを完了できませんでした。SafariやChromeからもう一度試してね。';}
  let user=auth.currentUser,state=null,map=new Map(),offline=false,locked=false,busy=false,generation=0,pending=null,notice='',validImport=true,lastSync=null,namesDraft=null;
  try{if(user)namesDraft=JSON.parse(local.getItem('kotokoto-names-draft:'+user.uid)??'null');}catch{}
  if(namesDraft){try{namesDraft=normalizeNames(namesDraft.nickname,namesDraft.petName);}catch{namesDraft=null;}}
  const listeners=new Set(),$=id=>document.getElementById(id);
  const original=local.getItem(ownerKey)?{getItem:key=>local.getItem('kotokoto-guest-v2:'+key),setItem:(key,v)=>local.setItem('kotokoto-guest-v2:'+key,v),removeItem:key=>local.removeItem('kotokoto-guest-v2:'+key)}:local;
  if(user){try{pending=JSON.parse(local.getItem(pendingKey(user.uid))??'null');}catch{pending=null;}}
  function notify(){render();for(const listener of listeners)listener();}
  function install(next){if(!user||state&&next.revision<state.revision)return;state=next;map=snapshotStorage(next);try{local.setItem(cacheKey(user.uid),JSON.stringify(next));}catch{}offline=false;locked=false;lastSync=new Date();notify();}
  async function request(path,init={}){
    if(!user||locked)throw Error('Googleでログインし直してね。入力は残してあります。');
    const identity=user.uid,identityUser=user,stamp=generation;
    const send=async refresh=>fetchImpl(path,{...init,headers:{...init.headers,Authorization:`Bearer ${await identityUser.getIdToken(refresh)}`},cache:'no-store',signal:AbortSignal.timeout(path==='/api/chat'?55000:30000)});
    let response=await send(false);if(response.status===401)response=await send(true);
    const data=await response.json();
    if(generation!==stamp||user?.uid!==identity)throw Error('アカウントが変わったため、前の操作は表示していません。');
    if(locked)throw Error('Googleでログインし直してね。入力は残してあります。');
    if(response.status===401){locked=true;state=null;map.clear();local.removeItem(cacheKey(identity));notify();}
    if(!response.ok){const error=Object.assign(new Error(data.error?.message??'保存できませんでした。入力は残しています。'),{status:response.status,code:data.error?.code,retryable:data.error?.retryable===true});throw error;}
    if(data.state)install(data.state);if(path==='/api/chat'&&user)local.removeItem('kotokoto-cloud-draft:'+user.uid);return data;
  }
  async function sync(force=false){if(!user||(!force&&busy)||locked)return;try{await request('/api/sync'+(state&&!force?'?revision='+state.revision:''));offline=false;notice='';lastSync=new Date();notify();}catch(error){if(!state&&error.status!==401){try{const cached=JSON.parse(local.getItem(cacheKey(user.uid))??'null');if(cached){state=cached;map=snapshotStorage(cached);}}catch{}}
    offline=true;notify();}}
  const clearPending=()=>{pending=null;if(user)local.removeItem(pendingKey(user.uid));};
  const namesMissing=()=>!!user&&(!state?.initialized?!namesDraft:(!state.profile?.namesConfigured||!state.profile?.nickname||!state.profile?.petName));
  async function mutate(command,{revision}={}){
    if(!user)throw Error('ログインしてから記録してね。');if(offline||locked)throw Error('今は閲覧のみです。接続を確認してから保存してね。');if(busy)throw Error('保存を待ってから、もう一度試してね。');
    if(pending&&JSON.stringify(pending.command)!==JSON.stringify(command))throw Error('未確認の保存があります。「アカウント」から確認してね。');
    if(!pending){pending={requestId:crypto.randomUUID(),revision:revision??state.revision,command};local.setItem(pendingKey(user.uid),JSON.stringify(pending));}
    notice='';busy=true;render();try{const result=await request('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});clearPending();return result;}
    catch(error){if(error.status&&error.status<500&&error.status!==401){clearPending();await sync(true);}throw error;}finally{busy=false;notify();}
  }
  const storage={getItem:key=>{if(!user)return original.getItem(key);if(key===KEYS.voice){let voice={version:1};try{voice=JSON.parse(local.getItem('kotokoto-cloud-voice:'+user.uid)??'{"version":1}');}catch{}return JSON.stringify({...voice,enabled:state?.chatEnabled!==false});}return map.get(key)??null;},
    setItem(key,value){if(!user)return original.setItem(key,value);if(key===KEYS.voice){map.set(key,value);local.setItem('kotokoto-cloud-voice:'+user.uid,value);return;}throw Error('クラウドへの保存が完了していません。');},
    removeItem(key){if(!user)return original.removeItem(key);throw Error('クラウドの操作から削除してね。');}};
  function render(){if(!$('account-status'))return;
    $('account-status').textContent=notice||redirectError||(locked?'ログインし直してね。':!user?'Googleでログインして、こむぎとの暮らしをはじめよう。記録はアカウントに保存されるよ。':busy?'保存しています…':offline?'オフライン・閲覧のみ':namesMissing()?'ここから、いっしょにはじめよう。':!state?.initialized?'使う記録を選んでね。':'クラウドに保存済み');
    $('account-title').textContent=!user?'ログインしてはじめよう':namesMissing()?'はじめまして':'アカウント';$('account-logout-help').hidden=!user;$('account-email').textContent=user?.email??'';$('account-login').hidden=!!user&&!locked;$('account-logout').hidden=!user;$('account-setup').hidden=!user||!!state?.initialized||namesMissing()||offline||locked;
    $('account-names-form').hidden=!namesMissing()||offline||locked;$('account-names-save').disabled=busy;$('account-names-save').textContent=state?.initialized?'名前を保存':'つぎへ';
    $('account-retry').hidden=!user||(!pending&&!offline);$('account-export').hidden=!user||!state?.initialized;
    if(lastSync)$('account-sync-time').textContent='最終確認 '+lastSync.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
    else $('account-sync-time').textContent='';
    $('account-import').disabled=busy||!validImport;$('account-empty').disabled=busy;
  }
  async function login(){redirectError='';const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    try{const previous=user?.uid;await signInWithPopup(auth,provider);if(previous&&auth.currentUser?.uid===previous)location.reload();}catch(error){if(error.code==='auth/popup-blocked'||error.code==='auth/operation-not-supported-in-this-environment')await signInWithRedirect(auth,provider);else{$('account-status').textContent='ログインを完了できませんでした。SafariやChromeからもう一度試してね。';}}
  }
  function preview(){try{const data=localImport(original),days=Object.keys(data.legacy.days).length,activities=data.progress?.activities?.length??0;
    $('account-import-summary').textContent=`このブラウザの記録：${days}日分、行動${activities}件、会話${(data.conversation?.messages.length??0)/2}往復。呼び名・体重・気分・育成・部屋も取り込みます。`;
    validImport=true;$('account-import').disabled=false;
  }catch(error){validImport=false;$('account-import-summary').textContent=error.message;$('account-import').disabled=true;}}
  function setupUI(){
    let defaults=state?.profile??{};try{if(!state?.initialized)defaults=namesDraft??localImport(original).profile??{};}catch{}
    $('account-own-name').value=defaults.nickname??'';$('account-pet-name').value=defaults.petName||'こむぎ';
    $('account-names-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;try{
      const names=normalizeNames($('account-own-name').value,$('account-pet-name').value);notice='';
      if(state?.initialized){await mutate({type:'profile',...names});local.removeItem('kotokoto-names-draft:'+user.uid);$('account-dialog').close();}
      else{namesDraft=names;local.setItem('kotokoto-names-draft:'+user.uid,JSON.stringify(names));preview();render();}
    }catch(error){notice=error.message;render();}});

    $('account-open').hidden=false;$('account-open').addEventListener('click',()=>{preview();render();$('account-dialog').showModal();});
    $('account-login').addEventListener('click',()=>login());
    $('account-logout').addEventListener('click',async()=>{if(busy)return;$('conversation-input').value='';if(user){local.removeItem(cacheKey(user.uid));local.removeItem(pendingKey(user.uid));local.removeItem('kotokoto-cloud-draft:'+user.uid);local.removeItem('kotokoto-cloud-chat-pending:'+user.uid);local.removeItem('kotokoto-cloud-voice:'+user.uid);local.removeItem('kotokoto-names-draft:'+user.uid);}await signOut(auth);});
    $('account-empty').addEventListener('click',async()=>{try{await mutate({type:'initialize',profile:namesDraft});location.reload();}catch(error){notice=error.message;render();}});
    $('account-import').addEventListener('click',async()=>{if(busy||!user)return;
      const idKey='kotokoto-import-request:'+user.uid;let id=local.getItem(idKey);if(!id){id=crypto.randomUUID();local.setItem(idKey,id);}
      busy=true;render();try{await request('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id,data:{...localImport(original),profile:namesDraft}})});local.setItem(ownerKey,user.uid);local.removeItem(idKey);location.reload();}catch(error){if(error.code==='request_conflict')local.removeItem(idKey);notice=error.message;render();}finally{busy=false;render();}
    });
    $('account-retry').addEventListener('click',async()=>{try{if(pending)await mutate(pending.command);else{locked=false;await sync();}}catch(error){notice=error.message;render();}});
    $('account-export').addEventListener('click',async()=>{try{const data=await request('/api/export'),blob=new Blob([JSON.stringify(data.state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='こつこつ日和-クラウド.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){notice=error.message;render();}});
    render();
  }
  await sync();setupUI();
  // A lost response must replay the original draw ID, not charge for a new draw.
  if(user&&state?.initialized&&!offline&&pending&&['plush_draw','plush_exchange'].includes(pending.command?.type)){try{await mutate(pending.command);}catch(error){notice=error.message;render();}}

  const draftInput=$('conversation-input');if(user&&draftInput){draftInput.value=local.getItem('kotokoto-cloud-draft:'+user.uid)??'';draftInput.addEventListener('input',()=>{if(user)local.setItem('kotokoto-cloud-draft:'+user.uid,draftInput.value);});}
  let initialUID=user?.uid??null;onAuthStateChanged(auth,next=>{if((next?.uid??null)===initialUID)return;generation++;if(initialUID){local.removeItem(cacheKey(initialUID));local.removeItem(pendingKey(initialUID));local.removeItem('kotokoto-cloud-draft:'+initialUID);local.removeItem('kotokoto-cloud-chat-pending:'+initialUID);}user=next;state=null;map.clear();location.reload();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});window.addEventListener('focus',()=>sync());window.addEventListener('online',()=>sync());schedule(()=>{if(!document.hidden)sync();},30000);
  if(!user||(!offline&&(!state?.initialized||namesMissing()))){preview();$('account-dialog').showModal();}
  return {enabled:true,storage,get user(){return user;},get state(){return state;},get needsSetup(){return !user||!state?.initialized||namesMissing();},get writable(){return !!user&&!!state?.initialized&&!offline&&!locked;},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},command:mutate,install,pendingConversation:{read(){try{return user?JSON.parse(local.getItem('kotokoto-cloud-chat-pending:'+user.uid)??'null'):null;}catch{return null;}},write(value){if(!user)return;if(value)local.setItem('kotokoto-cloud-chat-pending:'+user.uid,JSON.stringify(value));else local.removeItem('kotokoto-cloud-chat-pending:'+user.uid);}},
    async fetch(path,init={}){
      if(path==='/api/chat/session'&&(!user||!state?.initialized||offline||locked))return Response.json({available:false,loginRequired:!user,setupRequired:!!user&&!state?.initialized});
      if(!path.startsWith('/api/'))return fetchImpl(path,init);
      let supplied=init;if(path==='/api/chat'&&init.body){const b=JSON.parse(init.body);supplied={...init,body:JSON.stringify({requestId:b.requestId,text:b.messages.at(-1).content,selectedId:b.context?.activities?.find(a=>a.selected)?.id??null})};}
      try{return Response.json(await request(path,supplied));}catch(error){return Response.json({error:{code:error.code,message:error.message,retryable:error.retryable===true}},{status:error.status??503});}
    },async clearHistory(){if(!user||!state)return;const data=await request('/api/conversations',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),revision:state.revision})});return data;},
  };
}

export async function createAccountClient(options){
  try{return await bootstrapAccountClient(options);}catch(error){
    const dialog=document.getElementById('account-dialog');
    document.getElementById('account-status').textContent=error.message||'ログインの準備ができませんでした。画面を読み込み直してね。';
    for(const id of ['account-names-form','account-setup','account-export','account-logout','account-retry'])document.getElementById(id).hidden=true;
    const button=document.getElementById('account-login');button.textContent='読み込み直す';button.addEventListener('click',()=>location.reload());dialog.showModal();
    await new Promise(()=>{});
  }
}
