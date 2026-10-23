export const speechDuration=text=>Math.min(12000,Math.max(5000,Array.from(text).length*120));
// Every page gets a fresh reading interval after resuming; hidden time never counts.
export function createSpeechTimer({advance,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,text=null,paused=false;
 function stop(){if(timer!==null)clearTimer(timer);timer=null;}
 function schedule(){stop();if(text!==null&&!paused)timer=setTimer(()=>{timer=null;text=null;advance();},speechDuration(text));}
 return {page(value){text=value;schedule();},pause(value){if(paused===value)return;paused=value;schedule();},clear(){stop();text=null;}};
}
