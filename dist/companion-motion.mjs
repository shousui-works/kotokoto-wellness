const WALK_IMAGE=new URL('./assets/komugi-pomeranian-walk-v1.png',import.meta.url).href;
const ACTION_IMAGE=new URL('./assets/komugi-pomeranian-actions-v1.png',import.meta.url).href;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export const ACTIVITY_DURATION=Object.freeze({sniff:4800,play:6500,nap:10000});

export function roomBounds(width,height,dogSize,bottomInset=0){
  const margin=Math.min(width/2,Math.max(dogSize*.34+18,width*.14));
  const front=bottomInset?Math.min(height*.62,Math.max(190,Math.min(210,height*.24),bottomInset+20)):Math.min(height*.4,Math.max(190,Math.min(210,height*.24)));
  const back=Math.max(front,height*.44);
  return {left:margin,right:Math.max(margin,width-margin),front,back};
}
export function stepToward(position,target,distance){
  const dx=target.x-position.x,dy=target.y-position.y,remaining=Math.hypot(dx,dy);
  if(remaining<=distance||remaining<.5)return {...target,arrived:true};
  return {x:position.x+dx/remaining*distance,y:position.y+dy/remaining*distance,arrived:false};
}
export function conversationPose(width,height,dogSize,bottomInset=0){
  const wide=width>=700&&width>height;
  const tight=width<600&&height<=400,side=wide||tight,ratio=tight?.42:wide?.46:.9;
  const y=Math.min(height*.6,Math.max(height*.16,bottomInset+24));
  const budget=(height-y-(side?100:height<=600?225:330))/.78;
  const floor=Math.min(dogSize*.95,width*ratio,height<=300?Math.max(36,budget):Infinity);
  const size=Math.max(floor,Math.min(dogSize*2.25,width*ratio,budget));
  return {x:width*(tight?.25:wide?.36:.5),y,scale:size/dogSize};
}
export function chooseActivity(previous,lonely=false,random=Math.random){
  const pool=(lonely?['walk','sniff','nap']:['walk','sniff','play','nap']).filter(id=>id!==previous);
  return pool[Math.min(pool.length-1,Math.max(0,Math.floor(random()*pool.length)))];
}

export function createRoomMotion(dogs,{onPosition,getBottomInset=()=>0}={}){
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const walkers=[...dogs].map(dog=>new RoomWalker(dog,()=>preference.matches,onPosition,getBottomInset));
  const walkImage=new Image(),actionImage=new Image();
  walkImage.onload=()=>walkers.forEach(walker=>{walker.ready=true;walker.updateControls();walker.resume();});
  walkImage.onerror=()=>walkers.forEach(walker=>walker.unavailable());
  actionImage.onload=()=>walkers.forEach(walker=>{walker.actionsReady=true;walker.ball.hidden=false;walker.updateControls();walker.resume();});
  actionImage.onerror=()=>walkers.forEach(walker=>{walker.actionsReady=false;walker.updateControls();});
  walkImage.src=WALK_IMAGE;actionImage.src=ACTION_IMAGE;
  const visibility=()=>walkers.forEach(walker=>walker.resume());
  const reduced=()=>walkers.forEach(walker=>walker.preferenceChanged());
  document.addEventListener('visibilitychange',visibility);
  preference.addEventListener('change',reduced);
  return {
    refresh:()=>walkers.forEach(walker=>walker.measure()),
    greet:()=>walkers.forEach(walker=>walker.comeHere(true)),
    setPetting:value=>walkers.forEach(walker=>walker.setPetting(value)),
    approachConversation:()=>Promise.all(walkers.map(walker=>walker.approachConversation())),
    setSpeaking:value=>walkers.forEach(walker=>walker.setSpeaking(value)),
    destroy(){
      document.removeEventListener('visibilitychange',visibility);
      preference.removeEventListener('change',reduced);
      walkImage.onload=walkImage.onerror=actionImage.onload=actionImage.onerror=null;
      walkers.forEach(walker=>walker.destroy());
    }
  };
}

export class RoomWalker{
  constructor(dog,reduced,onPosition,getBottomInset=()=>0){
    this.dog=dog;this.scene=dog.closest('.room-scene');
    this.scene.classList.add('is-roaming-room');
    this.world=this.scene.classList.contains('room-scene--world');
    this.reduced=reduced;this.onPosition=onPosition;this.getBottomInset=getBottomInset;
    this.position=null;this.target=null;this.ballPosition=null;
    this.visible=false;this.ready=false;this.actionsReady=false;this.paused=false;
    this.frame=0;this.timer=0;this.greetTimer=0;this.lastTime=0;
    this.arrival='rest';this.activity=null;this.lastActivity=null;
    dog.classList.add('can-roam');dog.dataset.activity='resting';
    this.walkArtwork=document.createElement('span');this.walkArtwork.className='dog-walk-art';
    this.actionArtwork=document.createElement('span');this.actionArtwork.className='dog-action-art';
    dog.append(this.walkArtwork,this.actionArtwork);
    this.scene.setAttribute('role','group');
    this.controls=document.createElement('div');this.controls.className='room-controls';
    this.pauseButton=document.createElement('button');this.pauseButton.type='button';this.pauseButton.className='roam-toggle';
    this.pauseButton.setAttribute('aria-pressed','false');
    this.callButton=document.createElement('button');this.callButton.type='button';this.callButton.className='call-companion';
    this.callButton.textContent=this.world?'おいで ♡':'こっちにおいで ♡';
    this.callButton.setAttribute('aria-label','こむぎを呼ぶ');
    this.playButton=document.createElement('button');this.playButton.type='button';this.playButton.className='play-companion';
    this.playButton.textContent='あそぼ ◯';this.playButton.setAttribute('aria-label','こむぎとボールで遊ぶ');
    this.controls.append(this.pauseButton,this.playButton,this.callButton);
    this.ball=document.createElement('span');this.ball.className='companion-ball';this.ball.hidden=true;
    this.ball.setAttribute('aria-hidden','true');
    const core=document.createElement('span');core.className='ball-core';this.ball.append(core);
    this.scene.append(this.controls,this.ball);
    this.note=document.createElement('p');this.note.className='room-roam-note';this.scene.after(this.note);
    this.onPause=()=>{this.paused=!this.paused;this.updateControls();if(this.paused){this.stop();this.conversationFinish?.();}else this.resume();};
    this.onCall=()=>this.comeHere();this.onPlay=()=>this.play();
    this.pauseButton.addEventListener('click',this.onPause);
    this.callButton.addEventListener('click',this.onCall);
    this.playButton.addEventListener('click',this.onPlay);
    this.resize=new ResizeObserver(()=>this.measure());this.resize.observe(this.scene);
    this.observer=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;this.resume();},{threshold:.1});
    this.observer.observe(this.scene);this.measure();this.updateControls();
  }
  get active(){return this.visible&&!document.hidden&&!this.scene.closest('[hidden]');}
  syncVisualMotion(){
    const paused=String(this.paused||this.reduced()||!this.active);
    if(this.dog.dataset.motionPaused!==paused)this.dog.dataset.motionPaused=paused;
  }
  get canMove(){return this.active&&this.ready&&!this.reduced()&&!this.paused&&!this.petting&&!this.speaking&&!this.conversationMode&&!this.failed;}
  measure(){
    const width=this.scene.clientWidth,height=this.scene.clientHeight;if(!width||!height)return;
    this.roomSize={width,height};this.dogSize=parseFloat(getComputedStyle(this.dog).getPropertyValue('--dog-size'))||260;
    this.bounds=roomBounds(width,height,this.dogSize,this.world?this.getBottomInset():0);
    if(!this.conversationMode)this.position=this.constrain(this.position||{x:width*.5,y:(this.bounds.front+this.bounds.back)*.5});
    if(this.conversationMode==='near'){const p=this.closeupPose();this.position={x:p.x,y:p.y};this.conversationScale=p.scale;}
    if(this.target)this.target=this.constrain(this.target);
    this.ballPosition=this.constrainBall(this.ballPosition||{x:width*.66,y:this.bounds.front+24});
    this.paint();
  }
  constrain(point){return this.bounds?{x:clamp(point.x,this.bounds.left,this.bounds.right),y:clamp(point.y,this.bounds.front,this.bounds.back)}:point;}
  constrainBall(point){return {x:clamp(point.x,24,this.roomSize.width-24),y:clamp(point.y,this.bounds.front,this.bounds.back)};}
  depthScale(y){return .98-(y-this.bounds.front)/Math.max(1,this.bounds.back-this.bounds.front)*.16;}
  paint(){
    if(!this.position||!this.bounds)return;
    const scale=this.conversationScale??this.depthScale(this.position.y);
    this.dog.style.left=(this.position.x+(scale-1)*this.dogSize*.5).toFixed(2)+'px';
    this.dog.style.bottom='calc('+this.position.y.toFixed(2)+'px - var(--dog-size) * var(--paw-inset))';
    this.dog.style.scale=scale.toFixed(3);
    this.dog.style.zIndex=this.conversationMode?'8':this.position.y<this.bounds.front+35?'6':'4';
    const walking=this.dog.classList.contains('is-walking');
    const facing=this.activity?this.actionFacing:(Number(this.dog.style.getPropertyValue('--walk-facing'))||1);
    const headHeight=this.activity==='sniff'?.24:this.activity==='play'?.4:this.activity==='nap'?.38:walking?.65:.78;
    this.onPosition?.({...this.roomSize,closeup:Boolean(this.conversationMode),dogWidth:this.dogSize*scale,facing:this.activity||walking?facing:0,x:this.position.x+this.dogSize*scale*(this.activity?.26*facing:walking?.2*facing:-.08),y:this.roomSize.height-this.position.y-this.dogSize*scale*headHeight});
    if(this.ballPosition){
      this.ball.style.left=this.ballPosition.x.toFixed(2)+'px';this.ball.style.bottom=this.ballPosition.y.toFixed(2)+'px';
      this.ball.style.scale=this.depthScale(this.ballPosition.y).toFixed(3);
      this.ball.style.zIndex=this.ballPosition.y<this.bounds.front+35?'7':'5';
    }
  }
  updateControls(){
    this.syncVisualMotion();
    const resting=this.paused||this.reduced();
    this.pauseButton.textContent=this.world?(resting?'▷':'Ⅱ'):(resting?'おやすみ中 ▷':'のんびり中 Ⅱ');
    this.pauseButton.setAttribute('aria-label',resting?'こむぎの動きを再開':'こむぎの動きをおやすみ');
    this.pauseButton.setAttribute('aria-pressed',String(resting));
    this.pauseButton.disabled=this.reduced()||Boolean(this.failed);
    this.playButton.disabled=this.speaking||Boolean(this.conversationMode)||resting||!this.ready||!this.actionsReady||Boolean(this.failed);
    this.callButton.disabled=Boolean(this.speaking||this.conversationMode);
    this.note.textContent=this.reduced()?'こむぎを呼ぶと、そばでひと休み。':'おさんぽしたり、遊んだり。こむぎのペースで。';
  }
  stop(){
    cancelAnimationFrame(this.frame);clearTimeout(this.timer);clearTimeout(this.greetTimer);
    this.frame=0;this.timer=0;this.greetTimer=0;this.target=null;this.activity=null;
    this.dog.classList.remove('is-walking','is-acting','is-sniffing','is-playing','is-napping','greet');
    this.ball.classList.remove('is-playing');this.dog.dataset.activity='resting';
    this.scene.classList.add('roam-resting');this.paint();
  }
  setPetting(value){
    this.petting=Boolean(value);
    if(this.petting){this.conversationFinish?.();this.stop();}
    else this.resume();
  }
  setSpeaking(value){
    if(!value&&this.conversationMode){this.returnFromConversation();return;}
    if(Boolean(this.speaking)===Boolean(value))return;
    this.speaking=Boolean(value);this.updateControls();
    if(this.speaking)this.stop();else this.resume();
  }
  closeupPose(){return conversationPose(this.roomSize.width,this.roomSize.height,this.dogSize,this.world?this.getBottomInset():0);}
  cancelConversationAnimation(){
    cancelAnimationFrame(this.conversationFrame);this.conversationFrame=0;
    const resolve=this.conversationResolve;this.conversationResolve=null;this.conversationFinish=null;resolve?.();
  }
  animateConversation(mode,getTarget,duration){
    this.cancelConversationAnimation();this.stop();
    this.conversationMode=mode;this.dog.dataset.conversation=mode;
    const origin={...this.position,scale:this.conversationScale??this.depthScale(this.position.y)},started=performance.now();
    this.updateControls();
    return new Promise(resolve=>{
      this.conversationResolve=resolve;
      const finish=()=>{
        if(this.conversationResolve!==resolve)return;
        cancelAnimationFrame(this.conversationFrame);this.conversationFrame=0;
        const target=getTarget();this.position={x:target.x,y:target.y};this.conversationScale=target.scale;
        this.dog.classList.remove('is-walking');this.conversationResolve=null;this.conversationFinish=null;
        if(mode==='approaching'){this.conversationMode='near';this.dog.dataset.conversation='near';this.dog.dataset.activity='listening';}
        else{this.conversationMode=null;this.conversationScale=null;this.returnPosition=null;this.speaking=false;delete this.dog.dataset.conversation;this.dog.dataset.activity='resting';}
        this.paint();this.updateControls();resolve();if(mode==='returning')this.resume();
      };
      this.conversationFinish=finish;
      if(this.reduced()||this.paused||!this.active||!this.ready){finish();return;}
      const target=getTarget();this.dog.style.setProperty('--walk-facing',target.x>=origin.x?'1':'-1');
      this.dog.classList.add('is-walking');this.dog.dataset.activity=mode;this.scene.classList.remove('roam-resting');
      const tick=now=>{
        if(this.conversationResolve!==resolve)return;
        if(!this.active||this.reduced()||this.paused){finish();return;}
        const t=clamp((now-started)/duration,0,1),ease=t*t*(3-2*t),target=getTarget();
        this.position={x:origin.x+(target.x-origin.x)*ease,y:origin.y+(target.y-origin.y)*ease};
        this.conversationScale=origin.scale+(target.scale-origin.scale)*ease;this.paint();
        if(t===1)finish();else this.conversationFrame=requestAnimationFrame(tick);
      };
      this.conversationFrame=requestAnimationFrame(tick);
    });
  }
  approachConversation(){
    this.measure();if(!this.position)return Promise.resolve();
    this.returnPosition??={...this.position};this.speaking=true;
    if(this.conversationMode==='near')return Promise.resolve();
    return this.animateConversation('approaching',()=>this.closeupPose(),1250);
  }
  returnFromConversation(animate=true){
    if(!this.conversationMode)return;
    this.speaking=false;
    const promise=this.animateConversation('returning',()=>{const p=this.constrain(this.returnPosition??{x:this.roomSize.width*.5,y:this.bounds.front});return {...p,scale:this.depthScale(p.y)};},900);
    if(!animate)this.conversationFinish?.();return promise;
  }
  resume(){
    this.syncVisualMotion();
    if(this.conversationMode){if(!this.active||this.reduced()||this.paused)this.conversationFinish?.();return;}
    if(!this.canMove){this.stop();return;}
    this.scene.classList.remove('roam-resting');
    if(this.frame||this.timer||this.activity)return;
    this.schedule(1200);
  }
  schedule(delay=2000+Math.random()*2200){
    clearTimeout(this.timer);if(!this.canMove)return;
    this.timer=setTimeout(()=>{
      this.timer=0;if(!this.canMove)return;
      this.measure();
      const activity=this.actionsReady?chooseActivity(this.lastActivity,this.dog.classList.contains('feeling-lonely')):'walk';
      if(activity==='play'){this.play();return;}
      if(activity!=='walk'){this.startActivity(activity);return;}
      const middle=(this.bounds.left+this.bounds.right)/2,span=this.bounds.right-this.bounds.left;
      const side=this.position.x<middle?this.bounds.right-span*Math.random()*.18:this.bounds.left+span*Math.random()*.18;
      this.walkTo({x:side,y:this.bounds.front+Math.random()*(this.bounds.back-this.bounds.front)});
    },delay);
  }
  walkTo(point,arrival='rest'){
    this.stop();this.measure();this.target=this.constrain(point);this.arrival=arrival;
    if(arrival==='rest')this.lastActivity='walk';
    if(!this.canMove){if(this.active){this.position=this.target;this.paint();}this.finish();return;}
    if(Math.hypot(this.target.x-this.position.x,this.target.y-this.position.y)<3){this.finish();return;}
    this.dog.style.setProperty('--walk-facing',this.target.x>=this.position.x?'1':'-1');
    this.dog.classList.add('is-walking');this.dog.dataset.activity=arrival==='greet'?'approaching':'walking';
    this.scene.classList.remove('roam-resting');this.lastTime=performance.now();
    const tick=now=>{
      if(!this.canMove){this.stop();return;}
      const dt=Math.min((now-this.lastTime)/1000,.06);this.lastTime=now;
      const pace=Math.min(76,Math.max(32,this.scene.clientWidth*.075));
      const speed=arrival==='greet'?pace*1.45:this.dog.classList.contains('feeling-lonely')?pace*.68:arrival==='play'?pace*1.2:pace;
      const next=stepToward(this.position,this.target,speed*dt);this.position={x:next.x,y:next.y};this.paint();
      if(next.arrived)this.finish();else this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);
  }
  finish(){
    cancelAnimationFrame(this.frame);this.frame=0;this.target=null;
    this.dog.classList.remove('is-walking');this.dog.dataset.activity='resting';this.paint();
    if(this.arrival==='play'&&this.canMove){this.startActivity('play');return;}
    if(this.arrival==='greet'&&this.active){
      this.dog.classList.remove('greet');void this.dog.offsetWidth;this.dog.classList.add('greet');
      this.greetTimer=setTimeout(()=>this.dog.classList.remove('greet'),1100);
    }
    this.schedule(this.arrival==='greet'?6500:undefined);
  }
  startActivity(kind){
    if(!this.canMove||!this.actionsReady||!Object.hasOwn(ACTIVITY_DURATION,kind))return;
    this.stop();this.activity=kind;this.lastActivity=kind;
    this.actionFacing=kind==='play'?(this.ballPosition.x>=this.position.x?1:-1):(Number(this.dog.style.getPropertyValue('--walk-facing'))||1);
    this.dog.style.setProperty('--action-facing',String(this.actionFacing));
    this.dog.classList.add('is-acting','is-'+({sniff:'sniffing',play:'playing',nap:'napping'}[kind]));
    this.dog.dataset.activity={sniff:'sniffing',play:'playing',nap:'napping'}[kind];
    this.scene.classList.remove('roam-resting');this.paint();
    const finish=()=>{this.stop();this.schedule();};
    if(kind!=='play'){this.timer=setTimeout(finish,ACTIVITY_DURATION[kind]);return;}
    this.ball.classList.add('is-playing');
    const origin={...this.ballPosition},started=performance.now();
    const tick=now=>{
      if(!this.canMove){this.stop();return;}
      const elapsed=now-started,phase=(elapsed%1500)/1500;
      this.ballPosition=this.constrainBall({x:origin.x+Math.sin(phase*Math.PI)**2*24*this.actionFacing,y:origin.y});
      this.paint();
      if(elapsed>=ACTIVITY_DURATION.play)finish();else this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);
  }
  play(){
    if(!this.canMove||!this.actionsReady)return;
    this.measure();const facing=this.ballPosition.x>=this.position.x?1:-1;
    this.walkTo({x:this.ballPosition.x-this.dogSize*.37*facing,y:this.ballPosition.y},'play');
  }
  comeHere(fromPet=false){
    if(this.conversationMode)this.returnFromConversation(false);
    this.measure();if(!this.bounds)return;
    const center=(this.bounds.left+this.bounds.right)/2;
    if(!this.active){if(fromPet){this.position=this.constrain({x:center,y:this.bounds.front});this.paint();}return;}
    this.walkTo({x:center,y:this.bounds.front},'greet');
  }
  preferenceChanged(){this.stop();this.conversationFinish?.();this.updateControls();this.resume();}
  unavailable(){this.failed=true;this.ready=false;this.stop();this.updateControls();this.pauseButton.textContent='ひと休み中';this.note.textContent='こむぎと、のんびりひと休み。';}
  destroy(){
    this.cancelConversationAnimation();this.conversationMode=null;this.conversationScale=null;
    this.stop();this.observer.disconnect();this.resize.disconnect();
    this.pauseButton.removeEventListener('click',this.onPause);this.callButton.removeEventListener('click',this.onCall);this.playButton.removeEventListener('click',this.onPlay);
    this.controls.remove();this.ball.remove();this.note.remove();this.walkArtwork.remove();this.actionArtwork.remove();this.dog.classList.remove('can-roam');
  }
}
