// One completed gesture saves once; movement feedback never writes records.
export function bindCompanionPetting(target,{onHold=()=>{},onMove=()=>{},onEnd=()=>{},onPet=()=>{}}={}){
  let gesture=null;
  function finish(cancelled=false){
    if(!gesture)return;
    const previous=gesture;gesture=null;
    if(target.hasPointerCapture?.(previous.id))target.releasePointerCapture(previous.id);
    onEnd();onHold(false);
    if(!cancelled&&previous.distance>=18)onPet();
  }
  function down(event){
    if(gesture||event.isPrimary===false||event.button!==0)return;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,distance:0,inside:true};
    target.setPointerCapture(event.pointerId);onHold(true);
  }
  function move(event){
    if(!gesture||event.pointerId!==gesture.id)return;
    const rect=target.getBoundingClientRect();
    const inside=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
    const distance=Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y);
    const wasInside=gesture.inside;
    gesture.x=event.clientX;gesture.y=event.clientY;gesture.inside=inside;
    if(!inside||!wasInside)return;
    gesture.distance+=distance;
    if(gesture.distance>=18)onMove({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height,distance:gesture.distance});
  }
  const up=event=>{if(event.pointerId===gesture?.id)finish();};
  const cancel=event=>{if(event.pointerId===gesture?.id)finish(true);};
  const click=event=>{if(event.detail===0)onPet();}; // Keyboard / assistive activation.
  const hidden=()=>{if(target.ownerDocument.hidden)finish(true);};
  const blur=()=>finish(true);
  const events={pointerdown:down,pointermove:move,pointerup:up,pointercancel:cancel,lostpointercapture:cancel,click};
  for(const [name,handler] of Object.entries(events))target.addEventListener(name,handler);
  target.ownerDocument.addEventListener('visibilitychange',hidden);
  target.ownerDocument.defaultView.addEventListener('blur',blur);
  return {destroy(){finish(true);for(const [name,handler] of Object.entries(events))target.removeEventListener(name,handler);target.ownerDocument.removeEventListener('visibilitychange',hidden);target.ownerDocument.defaultView.removeEventListener('blur',blur);}};
}
