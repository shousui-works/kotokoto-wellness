// Cabinet-front bounds in the approved room artwork, before background-size: cover.
const ROOMS={portrait:{width:941,height:1672,front:{x:558,y:441,width:288,height:110}},landscape:{width:1672,height:941,front:{x:962,y:330,width:279,height:81}}};
export function shelfGeometry(width,height,landscape=false){
 const room=ROOMS[landscape?'landscape':'portrait'],scale=Math.max(width/room.width,height/room.height),front=room.front;
 return {left:front.x*scale+(width-room.width*scale)/2,top:front.y*scale+(height-room.height*scale)/2,width:front.width*scale,height:front.height*scale,frame:4*scale};
}
export function createShelfPosition({shelf,scene,backdrop,win=window}){
 function place(){const rect=scene.getBoundingClientRect();if(!rect.width||!rect.height)return;
  // Use the actual artwork: the keyboard can change the viewport aspect without changing the room orientation.
  const landscape=win.getComputedStyle(backdrop).backgroundImage.includes('room-landscape-v2');
  const p=shelfGeometry(rect.width,rect.height,landscape);
  for(const key of ['left','top','width','height'])shelf.style[key]=p[key]+'px';shelf.style.setProperty('--shelf-frame',p.frame+'px');shelf.dataset.positioned='true';
 }
 const observer=new ResizeObserver(place);observer.observe(scene);win.addEventListener('resize',place);place();
 return {refresh:place,destroy(){observer.disconnect();win.removeEventListener('resize',place);}};
}
