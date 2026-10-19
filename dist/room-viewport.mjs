// Layout and visual viewports differ while a phone's keyboard is on screen.
// Keep the room, fixed composer and speech in the same visible coordinate space.
export function viewportGeometry(win){
  const view=win.visualViewport;
  const usable=view&&Math.abs((view.scale??1)-1)<.05;
  const height=usable?view.height:win.innerHeight;
  const top=usable?Math.max(0,view.offsetTop):0;
  return {height,top,bottom:Math.max(0,win.innerHeight-height-top),zoomed:Boolean(view&&!usable)};
}

export function createRoomViewport({win=window,root=document.documentElement,input,extraInputs=[],onChange=()=>{}}){
  const inputs=[input,...extraInputs];
  let baseline=win.innerHeight,lastWidth=win.innerWidth,keyboard=false,frame=0;
  function sync(){
    frame=0;
    const geometry=viewportGeometry(win);
    if(Math.abs(win.innerWidth-lastWidth)>80){baseline=win.innerHeight;keyboard=false;}
    lastWidth=win.innerWidth;
    baseline=Math.max(baseline,win.innerHeight,geometry.height);
    const focused=inputs.includes(input.ownerDocument.activeElement);
    keyboard=!geometry.zoomed&&(focused||keyboard)&&baseline-geometry.height>120;
    root.style.setProperty('--room-height',geometry.height+'px');
    root.style.setProperty('--room-top',geometry.top+'px');
    root.style.setProperty('--room-bottom',geometry.bottom+'px');
    root.classList.toggle('keyboard-open',keyboard);
    root.classList.toggle('room-compact',geometry.height<=600);
    root.classList.toggle('room-tight',geometry.height<=400&&win.innerWidth<600);
    root.classList.toggle('room-landscape',win.innerWidth>baseline);
    onChange(geometry);
  }
  function schedule(){if(!frame)frame=win.requestAnimationFrame(sync);}
  const events=[[win,'resize'],[win,'pageshow'],[win.visualViewport,'resize'],[win.visualViewport,'scroll'],...inputs.flatMap(field=>[[field,'focus'],[field,'blur']])].filter(([target])=>target);
  events.forEach(([target,event])=>target.addEventListener(event,schedule));
  sync();
  return {refresh:schedule,destroy(){events.forEach(([target,event])=>target.removeEventListener(event,schedule));win.cancelAnimationFrame(frame);}};
}
