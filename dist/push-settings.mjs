export async function endpointId(endpoint){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint))),b=>b.toString(16).padStart(2,'0')).join('');}
export function pushSupport({secure=globalThis.isSecureContext,nav=globalThis.navigator,win=globalThis.window}={}){
  const ios=/iPad|iPhone|iPod/.test(nav.userAgent)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
  if(ios&&!nav.standalone&&!win.matchMedia('(display-mode: standalone)').matches)return 'install';
  return secure&&'serviceWorker'in nav&&'PushManager'in win&&'Notification'in win?'supported':'unsupported';
}
export function createPushSettings({account,root=document,nav=navigator,win=window,support=pushSupport(),permission=()=>Notification.permission}={}){
  const $=id=>root.getElementById(id),panel=$('push-settings');if(!panel)return;
  const status=$('push-status'),enable=$('push-enable'),disable=$('push-disable'),save=$('push-save'),test=$('push-test'),frequency=$('push-frequency');
  let registration=null,subscription=null,publicKey=null,enabled=false,busy=false,loadedUID=null;
  async function api(path,method='GET',data){const r=await account.fetch(path,{method,...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error?.message??'通知の設定につながりませんでした。');return value;}
  function render(){enable.hidden=enabled;disable.hidden=save.hidden=test.hidden=!enabled;for(const button of [enable,disable,save,test])button.disabled=busy||!account.user||support!=='supported'||!publicKey;frequency.disabled=busy||!account.user;}
  async function refresh(){
    if(busy)return;busy=true;render();
    try{
      if(!account.enabled||!account.user){status.textContent='Googleでログインすると通知を設定できるよ。';return;}
      if(support==='install'){status.textContent='iPhone・iPadでは、Safariの共有メニューから「ホーム画面に追加」して、追加したアイコンから開いてね。';return;}
      if(support!=='supported'){status.textContent='このブラウザは通知に対応していません。スマホのSafariやChromeで開いてね。';return;}
      publicKey=(await api('/api/push/config')).publicKey;if(!publicKey){status.textContent='通知は準備中です。';return;}
      registration=await nav.serviceWorker.register('/push-sw.js',{scope:'/'});
      subscription=await registration.pushManager.getSubscription();
      if(subscription){const result=await api('/api/push/subscription?id='+await endpointId(subscription.endpoint));enabled=result.enabled;frequency.value=String(result.frequency);}
      else enabled=false;
      status.textContent=permission()==='denied'?'通知がブロックされています。端末やブラウザの設定で許可してね。':enabled?'朝・昼・夜のどこかで、ふと話しかけるよ。':'通知はオフだよ。受け取りたいときにオンにしてね。';
    }catch(error){publicKey=null;status.textContent=error.message;}finally{busy=false;render();}
  }
  async function run(action){if(busy)return;busy=true;render();try{await action();}catch(error){status.textContent=error.message;}finally{busy=false;render();}}
  async function stop({logout=false}={}){
    const sub=subscription??await registration?.pushManager.getSubscription();if(!sub)return;
    let removed=false;try{await api('/api/push/subscription','DELETE',{id:await endpointId(sub.endpoint)});removed=true;}catch(error){if(!logout)throw error;}
    let unsubscribed=false;try{unsubscribed=await sub.unsubscribe();}catch{}
    if(!removed&&!unsubscribed)throw Error('通知を停止できませんでした。接続を確認してからログアウトしてね。');
    enabled=false;subscription=unsubscribed?null:sub;
  }
  enable.addEventListener('click',()=>run(async()=>{
    // Ask directly from the button gesture; never prompt on page load.
    const granted=await win.Notification.requestPermission();if(granted!=='granted')throw Error('通知を許可すると受け取れるよ。');
    registration=await nav.serviceWorker.ready;
    subscription=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))});
    await api('/api/push/subscription','PUT',{subscription:subscription.toJSON(),frequency:Number(frequency.value)});enabled=true;status.textContent='通知をオンにしたよ。朝・昼・夜の中で、気まぐれに会いにいくね。';
  }));
  disable.addEventListener('click',()=>run(async()=>{await stop();status.textContent='この端末の通知をオフにしたよ。';}));
  save.addEventListener('click',()=>run(async()=>{if(!subscription)throw Error('通知をオンにしてね。');await api('/api/push/subscription','PUT',{subscription:subscription.toJSON(),frequency:Number(frequency.value)});status.textContent='1日'+frequency.value+'回くらい、気まぐれに声をかけるね。';}));
  test.addEventListener('click',()=>run(async()=>{await api('/api/push/test','POST',{id:await endpointId(subscription.endpoint)});status.textContent='テスト通知を送ったよ。端末の通知を見てね。';}));
  $('settings-open')?.addEventListener('click',()=>refresh());
  account.beforeLogout?.(async()=>{if(support==='supported'){registration??=await nav.serviceWorker.getRegistration('/');await stop({logout:true});}});
  account.subscribe?.(()=>{const uid=account.user?.uid??null;if(uid!==loadedUID){loadedUID=uid;enabled=false;publicKey=null;render();}});
  loadedUID=account.user?.uid??null;const ready=refresh();return {refresh,ready};
}
