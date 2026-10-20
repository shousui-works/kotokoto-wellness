import {normalizeNickname} from './profile.mjs?v=name-1';

export function createNameIntro({form,chatForm,input,later,status,getNickname,saveNickname,onPrompt,onComplete,onCancel}){
  let active=false,saving=false;
  function close(){active=false;form.hidden=true;chatForm.hidden=false;}
  form.addEventListener('submit',event=>{
    event.preventDefault();if(saving)return;
    try{
      const name=normalizeNickname(input.value);
      if(!name)throw Error('呼ばれたい名前を教えてね。あとでも大丈夫だよ。');
      const complete=()=>{close();input.value='';status.textContent='';onComplete(name);};
      const result=saveNickname(name);
      if(result?.then){saving=true;later.disabled=true;input.disabled=true;status.textContent='名前を覚えています…';result.then(complete).catch(error=>{status.textContent=error.message;}).finally(()=>{saving=false;later.disabled=false;input.disabled=false;});}else complete();
    }catch(error){status.textContent=['QuotaExceededError','SecurityError'].includes(error.name)?'名前を保存できなかったよ。もう一度試すか、あとで教えてね。':error.message;}
  });
  later.addEventListener('click',()=>{if(saving)return;close();onCancel();});
  return {
    get active(){return active;},
    show(){if(active||getNickname())return;active=true;form.hidden=false;chatForm.hidden=true;status.textContent='';onPrompt();},
    refresh(){if(active&&getNickname()){close();onCancel();}},
    focus(){if(active)input.focus();}
  };
}
