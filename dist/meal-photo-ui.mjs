import {dateKey} from './model.mjs';
import {MEAL_TYPES,normalizeMealItems,normalizeMealPortions} from './meal-intake.mjs';

export async function prepareMealPhoto(file,{document=globalThis.document,Image=globalThis.Image,URL=globalThis.URL}={}){
  if(!file||file.size>20*1024*1024)throw Error('20MB以下の写真を選んでください。');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('この写真を開けませんでした。JPEGやPNGの写真で試してください。'));image.src=url;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>64000000)throw Error('写真のサイズを小さくして選び直してください。');
    const canvas=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(image.naturalWidth,image.naturalHeight));
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw Error('このブラウザでは写真を準備できませんでした。');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    // Re-encoding strips camera metadata; only this small JPEG leaves the device.
    for(const quality of [.8,.65,.5]){const data=canvas.toDataURL('image/jpeg',quality);if(data.startsWith('data:image/jpeg;base64,')&&(data.length-23)*3/4<=512*1024)return data;}
    throw Error('写真を圧縮できませんでした。範囲を絞った写真で試してください。');
  }finally{URL.revokeObjectURL(url);}
}

export function createMealPhotoUI({account,button,onSaved=()=>{},prepare=prepareMealPhoto}){
  if(!button)return null;
  const dialog=document.createElement('dialog');dialog.id='meal-photo-dialog';dialog.className='meal-photo-dialog';dialog.setAttribute('aria-labelledby','meal-photo-title');
  dialog.innerHTML=`<div class="dialog-top"><h2 id="meal-photo-title">食事の写真</h2><button type="button" class="icon-btn" id="meal-photo-close" aria-label="閉じる">×</button></div>
    <p class="subtle">食べた分のカロリーを、写真からおおまかに見積もります。保存する前に、料理や量を直せます。</p>
    <button type="button" class="secondary-btn meal-photo-pick" id="meal-photo-pick">写真を撮る・選ぶ</button><input id="meal-photo-file" type="file" accept="image/*" class="meal-photo-file" hidden>
    <img id="meal-photo-preview" alt="選んだ食事の写真" hidden>
    <label for="meal-photo-note">量や材料の補足（任意）</label><textarea id="meal-photo-note" rows="2" maxlength="400" placeholder="例：ご飯は小盛り、から揚げは2個だけ食べた"></textarea>
    <button type="button" class="primary-btn" id="meal-photo-analyze">写真から見積もる</button>
    <p id="meal-photo-status" role="status" aria-live="polite"></p><p id="meal-photo-error" class="error" role="alert"></p>
    <form id="meal-photo-confirm" hidden><h3>食べた内容を確認</h3><p class="subtle">写真では油や分量が分からないことがあります。料理名や量を変えたら、見積もり直すかkcalを入力してください。</p>
    <div id="meal-photo-items"></div><button type="button" class="text-btn" id="meal-photo-add">料理を追加</button>
    <p id="meal-photo-basis" class="subtle"></p><p class="meal-photo-total">摂取カロリーの目安 <strong id="meal-photo-total">0</strong> kcal</p>
    <label for="meal-photo-date">食べた日</label><input id="meal-photo-date" type="date" required>
    <label for="meal-photo-type">食事</label><select id="meal-photo-type"></select>
    <label for="meal-photo-target">保存先</label><select id="meal-photo-target"></select>
    <button class="primary-btn" id="meal-photo-save" type="submit">この内容で記録する</button></form>
    <p class="subtle meal-photo-privacy">写真は推定のために送信します。アプリの履歴には写真を残さず、確認した食事とカロリーを保存します。</p>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#meal-photo-'+id),status=$('status'),error=$('error'),form=$('confirm');
  const connectionMessage='今は接続できません。写真と入力は残してあるので、再接続してから保存してください。';
  let image=null,estimate=null,estimateId=null,request=null,confirmation=null,portionsDirty=false,busy=false,epoch=0,recorded=false;
  const eligible=()=>account?.enabled&&account.writable&&!document.getElementById('talk').classList.contains('is-sending')&&document.getElementById('conversation-voice').getAttribute('aria-pressed')!=='true';
  function availability(){button.disabled=busy||!eligible();}
  function lock(value){busy=value;for(const input of dialog.querySelectorAll('input,textarea,select,button'))if(input.id!=='meal-photo-close')input.disabled=value;$('analyze').disabled=value||!image;$('save').disabled=value||recorded;availability();}
  function message(text=''){error.textContent=text;}
  function targets(){
    const selected=$('target').value;$('target').replaceChildren(new Option('新しい食事として記録',''));
    for(const activity of account.state?.progress.activities??[])if(activity.kind==='meal_log'&&!activity.deleted&&!activity.hold&&activity.date===$('date').value)$('target').append(new Option((activity.intake?'上書き：':'反映：')+activity.title,activity.id));
    if([...$('target').options].some(option=>option.value===selected))$('target').value=selected;
  }
  function items(){return [...$('items').children].map(row=>({name:row.querySelector('[data-meal-name]').value,portion:row.querySelector('[data-meal-portion]').value,kcal:row.querySelector('[data-meal-kcal]').value.trim()===''?NaN:Number(row.querySelector('[data-meal-kcal]').value)}));}
  function total(){const values=items();$('total').textContent=values.every(item=>Number.isFinite(item.kcal))?values.reduce((sum,item)=>sum+Math.round(item.kcal),0).toLocaleString('ja-JP'):'—';confirmation=null;}
  function portionChanged(){portionsDirty=true;request=null;confirmation=null;$('analyze').textContent='変更した料理・量で見積もり直す';}
  function add(item={name:'',portion:'',kcal:''}){
    if($('items').children.length>=12){message('料理は12品までです。');return;}
    const row=document.createElement('fieldset');row.className='meal-photo-item';const legend=document.createElement('legend');legend.textContent='料理 '+($('items').children.length+1);row.append(legend);
    for(const [key,label,value,type] of [['name','料理名',item.name,'text'],['portion','食べた量',item.portion,'text'],['kcal','目安のkcal',item.kcal,'number']]){
      const wrap=document.createElement('label'),input=document.createElement('input');wrap.textContent=label;input.type=type;input.value=value;input.required=true;input.dataset['meal'+key[0].toUpperCase()+key.slice(1)]='';
      if(type==='number'){input.min='0';input.max='5000';input.step='1';input.inputMode='numeric';}else input.maxLength=key==='name'?60:80;
      input.addEventListener('input',()=>{if(key!=='kcal'){row.querySelector('[data-meal-kcal]').value='';portionChanged();status.textContent='料理や量を変更しました。見積もり直すか、変更後のkcalを入力してください。';}total();});wrap.append(input);row.append(wrap);
    }
    const remove=document.createElement('button');remove.type='button';remove.className='text-btn';remove.textContent='この料理を外す';remove.addEventListener('click',()=>{row.remove();portionChanged();total();});row.append(remove);$('items').append(row);total();
  }
  function reset(){epoch++;image=null;estimate=null;estimateId=null;request=null;confirmation=null;portionsDirty=false;recorded=false;form.hidden=true;$('file').value='';$('note').value='';$('preview').removeAttribute('src');$('preview').hidden=true;$('items').replaceChildren();$('analyze').textContent='写真から見積もる';status.textContent='';message();lock(false);}
  async function post(path,data){const response=await account.fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error?.message??'保存できませんでした。'),body.error??{});return body;}
  button.addEventListener('click',()=>{if(!eligible())return;reset();$('date').value=dateKey();$('date').max=dateKey();$('type').replaceChildren(...Object.entries(MEAL_TYPES).map(([id,label])=>new Option(label,id)));const hour=new Date().getHours();$('type').value=hour<11?'breakfast':hour<16?'lunch':'dinner';targets();dialog.showModal();});
  $('close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',reset);
  $('pick').addEventListener('click',()=>$('file').click());
  $('file').addEventListener('change',async()=>{
    const file=$('file').files[0];if(!file)return;const stamp=++epoch;lock(true);message();status.textContent='写真を準備しています…';estimate=null;estimateId=null;form.hidden=true;request=null;portionsDirty=false;$('analyze').textContent='写真から見積もる';
    try{const prepared=await prepare(file);if(stamp!==epoch)return;image=prepared;$('preview').src=prepared;$('preview').hidden=false;status.textContent='';}
    catch(failure){if(stamp===epoch){image=null;message(failure.message);}}
    finally{if(stamp===epoch)lock(false);}
  });
  $('note').addEventListener('input',()=>{estimate=null;estimateId=null;request=null;confirmation=null;form.hidden=true;});
  $('date').addEventListener('change',()=>{targets();confirmation=null;});$('type').addEventListener('change',()=>{confirmation=null;});$('target').addEventListener('change',()=>{confirmation=null;});
  $('add').addEventListener('click',()=>{add();portionChanged();});
  $('analyze').addEventListener('click',async()=>{
    if(busy||!image||!eligible())return;const stamp=epoch;lock(true);message();status.textContent='写真の料理と量を確認しています…';
    try{request??={requestId:crypto.randomUUID(),image,note:$('note').value,adjustments:portionsDirty?normalizeMealPortions(items()):null};
      const result=await post('/api/meal-photo/estimate',request);if(stamp!==epoch)return;estimate=result.estimate;estimateId=request.requestId;$('items').replaceChildren();
      portionsDirty=false;$('analyze').textContent='写真から見積もる';
      if(estimate.status!=='ok'){form.hidden=true;status.textContent=estimate.question;return;}
      estimate.items.forEach(add);$('basis').textContent='推定の前提：'+estimate.basis;form.hidden=false;status.textContent=estimate.question||'まだ保存していません。食べた内容を確認してください。';targets();
    }catch(failure){if(stamp===epoch){message(failure.message);status.textContent='';if(failure.retryable||failure.code==='outcome_unknown'||failure.code==='history_cleared')request=null;}}
    finally{if(stamp===epoch)lock(false);}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!estimate||!estimateId||recorded||!eligible())return;const stamp=epoch;message();
    try{const normalized=normalizeMealItems(items());confirmation??={requestId:estimateId,revision:account.state.revision,date:$('date').value,mealType:$('type').value,targetId:$('target').value||null,items:normalized};lock(true);
      const {requestId,revision,...meal}=confirmation;
      await account.command({type:'confirm_meal_photo',estimateId:requestId,...meal},{requestId,revision});if(stamp!==epoch)return;recorded=true;dialog.close();onSaved('摂取カロリーを記録しました。');
    }catch(failure){if(stamp===epoch){message(failure.message);if(failure.code==='revision_conflict'||failure.code==='meal_changed'){confirmation=null;await account.fetch('/api/sync');targets();}else if(failure.code==='estimate_missing'||failure.code==='history_cleared'){estimate=null;estimateId=null;request=null;confirmation=null;form.hidden=true;status.textContent='もう一度「写真から見積もる」を押して確認してください。';}else if(failure.code==='already_recorded'){recorded=true;await account.fetch('/api/sync');}}}
    finally{if(stamp===epoch)lock(false);}
  });
  account?.subscribe?.(()=>{availability();if(dialog.open&&!account.user)dialog.close();else if(dialog.open&&!account.writable)message(connectionMessage);else if(account.writable&&error.textContent===connectionMessage)message();});
  const availabilityObserver=new MutationObserver(availability);availabilityObserver.observe(document.getElementById('talk'),{attributes:true,attributeFilter:['class']});availabilityObserver.observe(document.getElementById('conversation-voice'),{attributes:true,attributeFilter:['aria-pressed']});
  lock(false);return {dialog,open:()=>button.click()};
}
