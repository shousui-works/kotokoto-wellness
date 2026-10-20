import {createGachaScene} from './plush-gacha-scene.mjs?v=1';
import {PLUSH_CATALOG,DRAW_COST,EXCHANGE_COST,SHELF_SLOTS,plushById,isActivePlush} from './plush-catalog.mjs';
import {emptyCollection,normalizeCollection,collectionBalance} from './collection-model.mjs';
import {progressTotal} from './progress.mjs?v=daily-life-1';
const $=id=>document.getElementById(id);
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function image(item,hidden=false){const wrap=node('span','plush-art'+(hidden?' undiscovered':'')),img=node('img');img.src=item.image;img.alt='';img.loading='lazy';img.addEventListener('error',()=>{img.hidden=true;wrap.append(node('span','plush-fallback','✳'));},{once:true});wrap.append(img);return wrap;}
function button(label,fn,cls='plush-button'){const b=node('button',cls,label);b.type='button';b.addEventListener('click',fn);return b;}
export function createPlushUI({account,openPanel,toast,getPetName=()=>'こむぎ',getStage=()=>'puppy',createScene=createGachaScene,onViewChange=()=>{}}){
 let identity=account.user?.uid??null,c=emptyCollection(),busy=false,tab='gacha',detail=null,slot=null,choice=null,exchange=null,lastAnimated=null,historyRows=[],cursor=null,historyLoaded=false,historyLoading=false,historyStamp=0,confirmExchange=null;
 let gachaScene=null,openedResultId=null,drawing=false;
 const root=$('plush'),shelf=$('plush-shelf');
 const heading=document.querySelector('#room-sheet .sheet-top');
 new ResizeObserver(()=>{const height=heading.getBoundingClientRect().height;if(height)root.style.setProperty('--plush-heading',height+'px');}).observe(heading);
 function resetScroll(){const sheet=$('room-sheet');if(sheet)sheet.scrollTop=0;}
 function select(next){if(!['gacha','book','shelf','history'].includes(next))return;tab=next;detail=null;slot=null;choice=null;exchange=null;confirmExchange=null;render();resetScroll();}
 async function command(value){if(busy)return null;busy=true;render();try{return await account.command(value);}catch(e){toast(e.message);return null;}finally{busy=false;render();}}
 function presentCapsule(result,resume=false){
  if(!result||result.requestId!==c.lastResult?.requestId||!isActivePlush(result.item))return;
  if(!gachaScene)gachaScene=createScene({getPetName,getStage,onOpened:id=>{openedResultId=id;render();},onClose:()=>render()});
  if(gachaScene.active)return;
  gachaScene.start(result,plushById(result.item),{resume});
 }
 function resultView(){const result=c.lastResult;if(!result||c.seenResult===result.requestId)return null;const item=plushById(result.item);if(!item||!isActivePlush(item.id))return null;
  if(result.type==='plush_draw'&&openedResultId!==result.requestId){
   const sealed=node('section','plush-reveal plush-sealed');sealed.append(node('p','plush-eyebrow','A LITTLE SURPRISE'),node('h2','','カプセルが届いているよ'),node('p','','タップして、中の仲間に会ってみよう。'));
   const open=button('カプセルを開く',()=>presentCapsule(result,true));open.disabled=busy||drawing;sealed.append(open);return sealed;
  }
  const box=node('section','plush-reveal');box.setAttribute('aria-label','開封結果');box.setAttribute('aria-live','polite');
  box.append(node('p','plush-eyebrow',result.isNew?'NEW FRIEND':'WELCOME AGAIN'),image(item),node('h2','',item.name),node('p','',result.isNew?'新しい仲間が図鑑に加わったよ。':`これで${c.owned[item.id]?.count??1}体目。交換用のボタンが1個ふえたよ。`),node('p','plush-trivia',item.trivia));
  if(lastAnimated!==result.requestId){box.classList.add('just-opened');lastAnimated=result.requestId;}
  box.append(button('演出をスキップ',()=>box.classList.remove('just-opened'),'plush-skip'));
  const actions=node('div','plush-actions');
  const seen=()=>command({type:'plush_seen',id:result.requestId});
  actions.append(button('図鑑を見る',async()=>{if(await seen()){showDetail(item.id);}}),button('棚に飾る',async()=>{if(await seen()){tab='shelf';choice=item.id;render();}}),button('とじる',seen,'plush-button secondary'));box.append(actions);return box;
 }
 function showDetail(id){if(!isActivePlush(id))return;detail=id;tab='book';openPanel();render();resetScroll();}
 function detailView(item){const wrap=node('section','plush-detail');wrap.append(button('← 図鑑にもどる',()=>{detail=null;render();},'plush-text-button'),image(item),node('p','plush-eyebrow',`No. ${String(item.number).padStart(3,'0')} · ${item.category==='dog'?'犬種図鑑':'ほかの動物'}`),node('h2','',item.name),node('p','plush-english',item.english),node('p','plush-tagline',item.tagline));
  const facts=node('dl','plush-facts');for(const[label,text]of [['原産国・起源',item.origin],['サイズ区分',item.size],['毛・見た目',item.coat]])facts.append(node('dt','',label),node('dd','',text));wrap.append(facts);
  for(const[title,text]of [['特徴',item.features],['歴史・役割',item.history],['ちょっと豆知識',item.trivia]])wrap.append(node('h3','',title),node('p','',text));
  wrap.append(node('p','subtle','体格や性格には個体差があります。ぬいぐるみは特徴をデフォルメしています。'),node('p','subtle',`初めての出会い：${new Date(c.owned[item.id].firstAt).toLocaleDateString('ja-JP')} · ${c.owned[item.id].count}体所持`),button('棚に飾る',()=>{tab='shelf';choice=item.id;detail=null;render();}));
  const sources=node('details','plush-sources');sources.append(node('summary','','参考にした資料'));for(const source of item.sources){const a=node('a','',source.title+' ↗');a.href=source.url;a.target='_blank';a.rel='noopener';sources.append(a,node('small','',source.checkedAt+' 確認'));}wrap.append(sources);return wrap;
 }
 function renderShelf(){shelf.replaceChildren();shelf.setAttribute('aria-label','ぬいぐるみの棚');for(const key of SHELF_SLOTS){const item=isActivePlush(c.shelf[key])?plushById(c.shelf[key]):null,b=button('',()=>{},'shelf-slot'); // handler assigned below
   b.onclick=()=>{if(item)showDetail(item.id);else{tab='shelf';openPanel();render();}};b.setAttribute('aria-label',item?item.name+'の図鑑を開く':'棚にぬいぐるみを飾る');if(item)b.append(image(item));shelf.append(b);
  }
 }
 async function loadHistory(append=false){if(historyLoading||!account.user)return;historyLoading=true;const stamp=++historyStamp;render();try{const r=await account.fetch('/api/plush/history'+(append&&cursor?'?cursor='+encodeURIComponent(cursor):'')),data=await r.json();if(!r.ok)throw Error(data.error?.message??'履歴を確認できませんでした。');if(stamp!==historyStamp||!account.state||account.user?.uid!==identity)return;historyRows=append?[...historyRows,...data.rows]:data.rows;cursor=data.nextCursor;historyLoaded=true;}catch(e){toast(e.message);}finally{historyLoading=false;render();}}
 function render(){
  onViewChange(tab);
  const uid=account.user?.uid??null;if(uid!==identity||!account.state){identity=uid;openedResultId=null;gachaScene?.close();historyStamp++;historyRows=[];cursor=null;historyLoaded=false;detail=null;choice=null;slot=null;}
  try{c=normalizeCollection(account.state?.collection);}catch(e){root.textContent=e.message;return;}
  if(gachaScene?.active&&(c.lastResult?.requestId!==gachaScene.requestId||c.seenResult===gachaScene.requestId))gachaScene.close();
  renderShelf();root.replaceChildren();const earned=account.state?.progress?progressTotal(account.state.progress):0,balance=collectionBalance(c,earned),writable=account.writable&&!busy;
  const tabs=node('div','plush-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','ぬいぐるみの表示');for(const[key,label]of [['gacha','ガチャ'],['book','図鑑'],['shelf','棚に飾る'],['history','履歴']]){const b=button(label,()=>{select(key);if(key==='history')void loadHistory();});b.setAttribute('aria-pressed',String(tab===key));tabs.append(b);}root.append(tabs);
  if(!account.user)root.append(node('p','plush-notice','Googleでログインすると、ガチャとコレクションを使えるよ。'));
  else if(!account.writable)root.append(node('p','plush-notice','接続・保存を確認しています。コレクションは閲覧できます。'));
  if(tab==='gacha'){
   const reveal=resultView();if(reveal)root.append(reveal);
   const hero=node('section','plush-gacha-card');hero.append(node('p','plush-eyebrow','A LITTLE FRIEND FOR YOU'),node('h2','','箱の中には、どんな子？'),node('p','',`集めた仲間 ${PLUSH_CATALOG.filter(p=>c.owned[p.id]).length} / ${PLUSH_CATALOG.length}`),node('div','plush-gift','✿'),node('p','plush-wallet',`使えるえらいポイント ${balance}`));
   const draw=button(busy?'カプセルを用意しています…':`${DRAW_COST}ポイントで1回`,async()=>{
    if(drawing||busy)return;drawing=true;const owner=account.user?.uid;
    try{const r=await command({type:'plush_draw'});if(r&&owner===account.user?.uid){historyLoaded=false;historyRows=[];render();root.scrollIntoView({block:'start'});presentCapsule(r.plushResult??r.state?.collection?.lastResult??account.state?.collection?.lastResult);}}
    catch(e){toast(e.message);}finally{drawing=false;render();}
   });draw.disabled=!writable||drawing||balance<DRAW_COST||!!reveal;hero.append(draw,node('p','subtle','使っても、なつき度や成長はそのまま。'));if(balance<DRAW_COST)hero.append(node('p','subtle',`あと${DRAW_COST-balance}ポイントで開けられるよ。`));root.append(hero);
   const odds=node('details','plush-odds');odds.append(node('summary','',`ラインアップと確率 · 全${PLUSH_CATALOG.length}種類 各1/${PLUSH_CATALOG.length}（約${(100/PLUSH_CATALOG.length).toFixed(2)}%）`));const list=node('div','plush-odds-grid');for(const p of PLUSH_CATALOG){const fig=node('figure');fig.append(image(p),node('figcaption','',p.name+` · 1/${PLUSH_CATALOG.length}（約${(100/PLUSH_CATALOG.length).toFixed(2)}%）`));list.append(fig);}odds.append(list,node('p','subtle','毎回独立した抽選です。同じ子が出たら所持数が増え、交換用ボタンを1個もらえます。'));root.append(odds);
   const missing=PLUSH_CATALOG.filter(p=>!c.owned[p.id]),exchangeBox=node('section','plush-exchange');exchangeBox.append(node('h3','',`交換用ボタン ${c.buttons}個`),node('p','subtle',`${EXCHANGE_COST}個で、まだ持っていない仲間を1体選べるよ。`));
   if(missing.length){const select=node('select');select.setAttribute('aria-label','交換するぬいぐるみ');for(const p of missing){const o=node('option','',p.name);o.value=p.id;select.append(o);}select.value=exchange??missing[0].id;select.onchange=()=>{exchange=select.value;render();};const target=select.value;exchangeBox.append(select);const b=button(`${plushById(target).name}と交換する`,()=>{confirmExchange=target;render();});b.disabled=!writable||c.buttons<EXCHANGE_COST||!!reveal;exchangeBox.append(b);
    if(confirmExchange===target){const confirmation=node('div','plush-notice');confirmation.setAttribute('role','group');confirmation.setAttribute('aria-label','交換の確認');confirmation.append(node('p','',`ボタン${EXCHANGE_COST}個で「${plushById(target).name}」をお迎えします。`));const yes=button('交換を確定する',async()=>{const r=await command({type:'plush_exchange',item:target});if(r){confirmExchange=null;historyLoaded=false;}});yes.disabled=!writable||c.buttons<EXCHANGE_COST||!!reveal;confirmation.append(yes,button('やめる',()=>{confirmExchange=null;render();},'plush-text-button'));exchangeBox.append(confirmation);}
}else exchangeBox.append(node('p','','全種類そろったね！ ボタンは次の出会いまで大切に。'));root.append(exchangeBox);
  }else if(tab==='book'){
   if(detail&&isActivePlush(detail)&&c.owned[detail])root.append(detailView(plushById(detail)));else{root.append(node('h2','',PLUSH_CATALOG.filter(p=>c.owned[p.id]).length===PLUSH_CATALOG.length?'図鑑がそろったね！':'ぬいぐるみ図鑑'),node('p','subtle',`発見 ${PLUSH_CATALOG.filter(p=>c.owned[p.id]).length} / ${PLUSH_CATALOG.length}`));for(const category of ['dog']){root.append(node('h3','',category==='dog'?'犬種図鑑':'ほかの動物'));const grid=node('div','plush-book-grid');for(const p of PLUSH_CATALOG.filter(p=>p.category===category)){const owned=c.owned[p.id],b=button('',()=>{if(owned)showDetail(p.id);});b.className='plush-book-item';b.disabled=!owned;b.append(node('small','',`No. ${String(p.number).padStart(3,'0')}`),image(p,!owned),node('strong','',owned?p.name:'？？？'),node('small','',owned?`${owned.count}体`:'まだ出会っていない'));grid.append(b);}root.append(grid);}}
  }else if(tab==='shelf'){
   root.append(node('h2','','お気に入りを並べよう'),node('p','subtle',choice?'置きたい棚の枠を選んでね。':'枠と置く子を選んでね。飾っている子は場所を入れ替えられるよ。'));
   const slots=node('div','plush-editor-shelf');for(const[key,index]of SHELF_SLOTS.map((s,i)=>[s,i])){const p=isActivePlush(c.shelf[key])?plushById(c.shelf[key]):null,b=button('',async()=>{slot=key;if(choice&&writable){const r=await command({type:'plush_display',slot:key,item:choice});if(r){choice=null;toast('棚に飾ったよ。');}}render();});b.className='plush-editor-slot';b.setAttribute('aria-pressed',String(slot===key));b.setAttribute('aria-label',`${index<3?'上':'下'}の段 ${index%3+1}番目`);b.append(p?image(p):node('span','','＋'));slots.append(b);}root.append(slots);
   if(slot){const clear=button('この枠の子をしまう',()=>command({type:'plush_display',slot,item:null}),'plush-text-button');clear.disabled=!writable||!c.shelf[slot];root.append(clear);}
   const grid=node('div','plush-book-grid');for(const p of PLUSH_CATALOG.filter(p=>c.owned[p.id])){const b=button('',async()=>{choice=p.id;if(slot&&writable){const r=await command({type:'plush_display',slot,item:p.id});if(r){choice=null;toast('棚に飾ったよ。');}}render();});b.className='plush-book-item';b.setAttribute('aria-pressed',String(choice===p.id));const placed=Object.values(c.shelf).filter(id=>id===p.id).length;b.append(image(p),node('strong','',p.name),node('small','',`${c.owned[p.id].count}体所持 · ${placed}体を飾っています`));grid.append(b);}root.append(grid);if(!PLUSH_CATALOG.filter(p=>c.owned[p.id]).length)root.append(node('p','subtle','最初の仲間をお迎えしたら、ここに並ぶよ。'));
  }else{
   root.append(node('h2','','お迎えの履歴'));if(!historyLoaded&&!historyLoading)root.append(button('履歴を読み込む',()=>loadHistory()));
   const list=node('ol','plush-history');for(const row of historyRows){const p=plushById(row.item);if(!p||!isActivePlush(p.id))continue;const li=node('li');li.append(image(p),node('span','',`${p.name}\n${new Date(row.at).toLocaleString('ja-JP')} · ${row.cost?row.cost+'ポイント':row.buttonCost+'ボタン'}`));list.append(li);}root.append(list);if(historyLoaded&&!historyRows.length)root.append(node('p','subtle','ここに出会いの記録が残るよ。'));if(cursor){const b=button(historyLoading?'読み込み中…':'もっと見る',()=>loadHistory(true));b.disabled=historyLoading;root.append(b);}
  }
  for(const b of root.querySelectorAll('button'))if(busy)b.disabled=true;
 }
 render();return {render,select,get tab(){return tab;}};
}
