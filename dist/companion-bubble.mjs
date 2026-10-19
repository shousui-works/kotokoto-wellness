const clamp=(value,min,max)=>Math.min(Math.max(min,max),Math.max(min,value));

export function speechPages(text,limit=100){
  const pages=[];let rest=Array.from(text);
  while(rest.length>limit){
    const part=rest.slice(0,limit).join('');
    const stops=[...part.matchAll(/[。！？!?\n]/g)].map(m=>Array.from(part.slice(0,m.index+1)).length);
    const end=stops.filter(n=>n>=limit*.45).at(-1)??limit;
    pages.push(rest.splice(0,end).join(''));
  }
  if(rest.length)pages.push(rest.join(''));
  return pages;
}

export function speechBubblePosition({x,y,width,height,facing=0,closeup=false,dogWidth=0},bubbleWidth,bubbleHeight){
  const edge=16,gap=17;
  if(closeup&&(width>=700&&width>height||width<600&&height<=400)){
    const offset=dogWidth*.5+14;
    const side=x+offset+bubbleWidth<=width-edge||x-offset-bubbleWidth<edge?'right':'left';
    const left=clamp(side==='right'?x+offset:x-offset-bubbleWidth,edge,width-bubbleWidth-edge);
    const top=clamp(y-28,height<=300?54:width<600?64:height<=480?88:112,height-bubbleHeight-90);
    return {left,top,side,tail:clamp(y-top,20,bubbleHeight-20)};
  }
  if(height<=480&&width>=600){
    const rightFits=x+52+bubbleWidth<=width-edge,leftFits=x-52-bubbleWidth>=edge;
    const side=facing<0&&leftFits?'left':rightFits?'right':'left';
    const left=clamp(side==='right'?x+52:x-52-bubbleWidth,edge,width-bubbleWidth-edge);
    const top=clamp(y-24,112,height-bubbleHeight-80);
    return {left,top,side,tail:clamp(y-top,20,bubbleHeight-20)};
  }
  const left=clamp(x-bubbleWidth/2,edge,width-bubbleWidth-edge);
  const top=clamp(y-bubbleHeight-gap,height<=600&&width<600?64:closeup&&height<=600?86:width>=900?156:136,height-bubbleHeight-110);
  return {left,top,side:'above',tail:clamp(x-left,22,bubbleWidth-22)};
}

export function createCompanionBubble(button){
  let anchor=null,width=button.offsetWidth,height=button.offsetHeight;
  function paint(){
    if(!anchor)return;
    const p=speechBubblePosition(anchor,width,height);
    button.style.left=p.left.toFixed(2)+'px';
    button.style.top=(p.top+(anchor.viewportTop??0)).toFixed(2)+'px';
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
