export const WELCOME_TEXT='（画面を開いたときのごあいさつ）';
// One attempt per page. A cancelled presentation may still finish saving its history.
export function createWelcomeConversation({canStart,request,approach,reply,cancel,saved}){
 let attempted=false,epoch=0,presenting=false,pending=Promise.resolve();
 function interrupt(){epoch++;if(presenting){presenting=false;cancel();}}
 return {interrupt,get pending(){return pending;},start(){
   if(attempted||!canStart())return pending;attempted=true;const current=++epoch;
   pending=(async()=>{
     try{
       const result=await request();if(!result)return;
       saved(result);
       if(current!==epoch||!canStart())return;
       presenting=true;await approach();
       if(current!==epoch)return;
       if(!canStart()){interrupt();return;}
       presenting=false;reply(result.reply);
     }catch{if(current===epoch)interrupt();}
   })();return pending;
 }};
}
