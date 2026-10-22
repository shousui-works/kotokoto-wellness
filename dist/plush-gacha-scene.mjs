// Presentation only. A server-confirmed receipt is required; this module never draws or spends.
export const GACHA_DURATIONS=Object.freeze({walk:1800,lever:900,drop:850,opening:650});
export function createGachaSequence({onPhase,reduced=()=>false,schedule=setTimeout,cancel=clearTimeout}){
 let phase='idle',timer=null;
 function clear(){if(timer!==null)cancel(timer);timer=null;}
 function set(next){clear();phase=next;onPhase(next);const after={walk:'lever',lever:'drop',drop:'capsule',opening:'reveal'}[next];if(after)timer=schedule(()=>{timer=null;set(after);},GACHA_DURATIONS[next]);}
 return {
  get phase(){return phase;},
  start({resume=false}={}){set(resume||reduced()?'capsule':'walk');},
  open(){if(phase!=='capsule')return false;set(reduced()?'reveal':'opening');return true;},
  skip(){if(phase==='idle')return false;if(phase!=='reveal')set('reveal');return true;},
  suspend(){if(phase==='opening')set('reveal');else if(['walk','lever','drop'].includes(phase))set('capsule');},
  stop(){clear();phase='idle';},
 };
}

function el(tag,cls,text){const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function btn(text,fn,cls){const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;}
export function createGachaScene({getPetName=()=> 'こむぎ',getStage=()=> 'puppy',onOpened=()=>{},onClose=()=>{}}={}){
 let dialog,scene,title,status,prize,reward,skip,receipt,itemName,opened=false,returnButton;
 const preference=matchMedia('(prefers-reduced-motion: reduce)');
 const sequence=createGachaSequence({reduced:()=>preference.matches,onPhase:paint});
 function paint(phase){
  if(!dialog)return;scene.dataset.phase=phase;
  const name=getPetName();
  status.textContent=({walk:`${name}がガチャを回してくれるよ。`,lever:'せーの……がちゃっ！',drop:'ころころ……何が入っているかな？',capsule:'カプセルをタップしてね。',opening:'ぱかっ！',reveal:`${itemName}のぬいぐるみが出てきたよ。`})[phase]??'';
  prize.hidden=!['drop','capsule','opening'].includes(phase);prize.disabled=phase!=='capsule';
  reward.hidden=phase!=='reveal';skip.hidden=phase==='reveal';returnButton.hidden=phase!=='reveal';
  if(phase==='capsule')prize.focus({preventScroll:true});
  if(phase==='reveal'){
   if(!opened){opened=true;onOpened(receipt.requestId);}
   returnButton.focus({preventScroll:true});
  }
 }
 function close(){
  if(!dialog)return;
  sequence.stop();document.removeEventListener('visibilitychange',visibility);preference.removeEventListener('change',motionChange);
  const old=dialog;dialog=null;if(old?.open)old.close();old?.remove();onClose();
 }
 function visibility(){if(!dialog)return;dialog.dataset.hidden=String(document.hidden);if(document.hidden)sequence.suspend();}
 function motionChange(){if(preference.matches)sequence.suspend();}
 function start(result,item,{resume=false}={}){
  if(!result?.requestId||!item)throw Error('保存済みのカプセルを確認できませんでした。');
  if(dialog)close();receipt=result;itemName=item.name;opened=false;
  dialog=el('dialog','gacha-dialog');dialog.setAttribute('aria-labelledby','gacha-scene-title');
  const header=el('header','gacha-header');title=el('h2','','ちいさな出会いのガチャ');title.id='gacha-scene-title';
  header.append(title,btn('×',close,'gacha-close'));header.lastElementChild.setAttribute('aria-label','演出を閉じる');
  scene=el('div','gacha-scene');scene.classList.add('gacha-stage--'+(['puppy','young','adult'].includes(getStage())?getStage():'puppy'));
  const scenery=el('div','gacha-scenery');scenery.setAttribute('aria-hidden','true');
  const machine=el('div','gacha-machine'),globe=el('div','gacha-globe');
  for(let i=0;i<9;i++)globe.append(el('i','gacha-mini-capsule gacha-mini-'+i));
  const body=el('div','gacha-machine-body'),badge=el('span','gacha-badge','♡'),hatch=el('span','gacha-hatch');
  const lever=el('span','gacha-lever'),arm=el('span','gacha-lever-arm');lever.append(arm);body.append(badge,hatch);machine.append(globe,body,lever);
  const dog=el('div','gacha-dog');dog.append(el('span','gacha-dog-walk'),el('span','gacha-dog-sit'),el('span','gacha-dog-paw'));scenery.append(machine,dog);
  prize=btn('',()=>sequence.open(),'gacha-capsule');prize.setAttribute('aria-label','カプセルを開ける');
  prize.append(el('span','gacha-capsule-top'),el('span','gacha-capsule-bottom'),el('span','gacha-capsule-band'));
  reward=el('section','gacha-reward');reward.setAttribute('aria-label','開封したぬいぐるみ');
  const img=el('img','gacha-toy');img.src=item.image;img.alt=item.name+'のぬいぐるみ';
  reward.append(el('p','gacha-new',result.isNew?'NEW FRIEND':'WELCOME AGAIN'),img,el('h3','',item.name),el('p','gacha-result-note',result.isNew?'新しい仲間がやってきたよ。':'また会えたね。交換用のボタンが1個ふえたよ。'));
  scene.append(scenery,prize,reward);status=el('p','gacha-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const footer=el('footer','gacha-footer');skip=btn('演出をスキップ',()=>sequence.skip(),'gacha-skip');returnButton=btn('受け取る',close,'plush-button');footer.append(skip,returnButton);
  dialog.append(header,scene,status,footer);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.body.append(dialog);dialog.showModal();sequence.start({resume});
  document.addEventListener('visibilitychange',visibility);preference.addEventListener('change',motionChange);
  visibility();
 }
 return {start,close,get active(){return !!dialog;},get requestId(){return dialog?receipt?.requestId:null;}};
}
