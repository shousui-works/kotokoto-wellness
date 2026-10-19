// Affection is read from the existing model; this module never changes points or saves state.
export function affectionHearts(score,reduced=false){
 const value=Number.isFinite(score)?Math.min(100,Math.max(0,score)):0;
 const level=value>=100?4:value>=50?3:value>=20?2:value>=6?1:0;
 const count=reduced?Math.min(2,level+1):[1,2,3,5,7][level];
 return {level,animated:!reduced,duration:reduced?2200:3300+(count-1)*260,hearts:Array.from({length:count},(_,i)=>({
  x:i%2?77+(i%3)*2:19-(i%3)*2,y:56+(i%3)*9,size:12+level+(i%2)*2,
  delay:reduced?0:i*260,rise:30+level*4+(i%3)*5,drift:i%2?10+level*2:-10-level*2,
  filled:level>=3&&i%2===0,rotation:i%2?13:-15,
 }))};
}
export function createAffectionBurst({emit,erase,canShow=()=>true,reduced=()=>false,schedule=setTimeout,cancel=clearTimeout}){
 let timer=null;
 function clear(){if(timer!==null)cancel(timer);timer=null;erase();}
 return {speak(score){clear();if(!canShow())return;const plan=affectionHearts(score,reduced());emit(plan);timer=schedule(clear,plan.duration);},clear,destroy:clear};
}
export function createCompanionAffection(dogs){
 const preference=matchMedia('(prefers-reduced-motion: reduce)');
 const companions=[...dogs].map(dog=>{
  const layer=document.createElement('span');layer.className='companion-hearts';layer.setAttribute('aria-hidden','true');dog.append(layer);
  const burst=createAffectionBurst({canShow:()=>!document.hidden&&!document.querySelector('dialog[open]')&&(dog.dataset.motionPaused!=='true'||preference.matches),reduced:()=>preference.matches,
   erase(){layer.replaceChildren();delete dog.dataset.affectionBurst;},
   emit(plan){dog.dataset.affectionBurst=String(plan.level);layer.classList.toggle('is-still',!plan.animated);
    for(const heart of plan.hearts){const node=document.createElement('span');node.className='companion-heart';node.textContent=heart.filled?'♥':'♡';
     for(const [key,value]of Object.entries({x:heart.x+'%',y:heart.y+'%',size:heart.size+'px',delay:heart.delay+'ms',rise:-heart.rise+'px',drift:heart.drift+'px',rotation:heart.rotation+'deg'}))node.style.setProperty('--heart-'+key,value);
     layer.append(node);
    }
   }});
  const observer=new MutationObserver(()=>{if(dog.dataset.motionPaused==='true')burst.clear();});observer.observe(dog,{attributes:true,attributeFilter:['data-motion-paused']});
  return {burst,layer,observer,dog};
 });
 const clear=()=>companions.forEach(c=>c.burst.clear());
 const visibility=()=>{if(document.hidden)clear();};
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',clear);preference.addEventListener('change',clear);
 return {speak:score=>companions.forEach(c=>c.burst.speak(score)),clear,destroy(){clear();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',clear);preference.removeEventListener('change',clear);companions.forEach(c=>{c.observer.disconnect();c.layer.remove();});}};
}
