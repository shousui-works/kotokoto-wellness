const clamp=(value,min,max)=>Math.min(Math.max(min,max),Math.max(min,value));

export function speechBubblePosition({x,y,width,height,facing=0},bubbleWidth,bubbleHeight){
  const edge=16,gap=17;
  if(height<=480&&width>=600){
    const rightFits=x+52+bubbleWidth<=width-edge,leftFits=x-52-bubbleWidth>=edge;
    const side=facing<0&&leftFits?'left':rightFits?'right':'left';
    const left=clamp(side==='right'?x+52:x-52-bubbleWidth,edge,width-bubbleWidth-edge);
    const top=clamp(y-24,112,height-bubbleHeight-80);
    return {left,top,side,tail:clamp(y-top,20,bubbleHeight-20)};
  }
  const left=clamp(x-bubbleWidth/2,edge,width-bubbleWidth-edge);
  const top=clamp(y-bubbleHeight-gap,width>=900?156:136,height-bubbleHeight-110);
  return {left,top,side:'above',tail:clamp(x-left,22,bubbleWidth-22)};
}

export function createCompanionBubble(button){
  let anchor=null,width=button.offsetWidth,height=button.offsetHeight;
  function paint(){
    if(!anchor)return;
    const p=speechBubblePosition(anchor,width,height);
    button.style.left=p.left.toFixed(2)+'px';
    button.style.top=p.top.toFixed(2)+'px';
    button.style.setProperty('--speech-tail',p.tail.toFixed(2)+'px');
    button.dataset.side=p.side;
    button.classList.add('is-anchored');
  }
  const resize=new ResizeObserver(()=>{width=button.offsetWidth;height=button.offsetHeight;paint();});
  resize.observe(button);
  return {
    place(point){anchor=point;paint();},
    destroy(){resize.disconnect();}
  };
}
