const FACE_IMAGE=new URL('./assets/komugi-pomeranian-talk-v1.png',import.meta.url).href;
const MOUTH=[1,2,1,0,0,1,0,2,1,0];
const BEATS=[160,120,150,130,240,170,110,180,140,280];

// Finite speaking bursts, independent blinks, and no timer while paused or away.
export function createFaceMotion({paint,now=Date.now,random=Math.random,schedule=setTimeout,cancel=clearTimeout}){
  let active=false,timer=null,pending=0,speakingUntil=0,blinkAt=0,blinkUntil=0,step=0;
  function clear(){if(timer!==null)cancel(timer);timer=null;}
  function tick(){
    clear();if(!active)return;
    const time=now();
    if(blinkUntil&&time>=blinkUntil){blinkUntil=0;blinkAt=time+3000+random()*3500;}
    if(time>=blinkAt&&!blinkUntil)blinkUntil=time+110;
    let delay;
    if(blinkUntil){paint(3);delay=blinkUntil-time;}
    else if(time<speakingUntil){paint(MOUTH[step%MOUTH.length]);delay=Math.min(BEATS[step++%BEATS.length],speakingUntil-time,blinkAt-time);}
    else{paint(0);delay=blinkAt-time;}
    timer=schedule(tick,Math.max(16,delay));
  }
  return {
    start(){if(active)return;active=true;const time=now();blinkAt=time+1800+random()*2200;blinkUntil=0;if(pending){speakingUntil=time+pending;pending=0;step=0;}tick();},
    speak(text){const duration=Math.min(7000,Math.max(1800,Array.from(text).length*75));if(!active){pending=duration;return;}speakingUntil=now()+duration;step=0;tick();},
    quiet(){pending=0;speakingUntil=0;if(active)tick();},
    stop(keepPending=false){clear();active=false;speakingUntil=0;blinkUntil=0;if(!keepPending)pending=0;paint(0);},
  };
}

export function createCompanionFaces(dogs){
  let ready=false;
  const faces=[...dogs].map(dog=>{
    const art=document.createElement('span');art.className='dog-face-art';
    const base=document.createElement('span');base.className='dog-face-base';
    const face=document.createElement('span');face.className='dog-face-frame';
    art.append(base,face);dog.append(art);
    const motion=createFaceMotion({paint:frame=>dog.style.setProperty('--face-x',`${frame*100/3}%`)});
    function refresh(){
      const mode=dog.dataset.conversation,paused=dog.dataset.motionPaused==='true';
      if(ready&&mode==='near'&&!paused)motion.start();
      else motion.stop(!paused&&['near','approaching'].includes(mode));
    }
    const observer=new MutationObserver(refresh);
    observer.observe(dog,{attributes:true,attributeFilter:['data-conversation','data-motion-paused']});
    return {dog,motion,refresh,observer,art};
  });
  const image=new Image();
  image.onload=()=>{ready=true;faces.forEach(face=>{face.dog.classList.add('has-face-frames');face.refresh();});};
  image.onerror=()=>faces.forEach(face=>face.motion.stop());image.src=FACE_IMAGE;
  return {
    speak:text=>faces.forEach(face=>face.motion.speak(text)),
    quiet:()=>faces.forEach(face=>face.motion.quiet()),
    destroy(){image.onload=image.onerror=null;faces.forEach(face=>{face.observer.disconnect();face.motion.stop();face.art.remove();face.dog.classList.remove('has-face-frames');});}
  };
}
