const limitText=(text,max)=>{let out=text.slice(0,max);if(/[\uD800-\uDBFF]$/.test(out))out=out.slice(0,-1);return out;};
const ERRORS={
  'not-allowed':'マイクを使えません。ブラウザのマイク許可を確認してね。',
  'service-not-allowed':'このブラウザでは音声入力を使えません。キーボードのマイクから入力してね。',
  'audio-capture':'マイクを見つけられませんでした。接続や設定を確認してね。',
  'no-speech':'声を聞き取れなかったよ。もう一度マイクを押して話してね。',
  network:'音声入力につながりませんでした。接続を確認して、もう一度試してね。',
  'language-not-supported':'日本語の音声入力を使えません。キーボードのマイクから入力してね。',
};

// Recognition fills a draft and emits one successful completion. Audio is never stored here.
export function createVoiceInput({input,Recognition=globalThis.SpeechRecognition??globalThis.webkitSpeechRecognition,
  canStart=()=>true,onState=()=>{},onInput=()=>{},onComplete=()=>{},schedule=setTimeout,cancel=clearTimeout}){
  let session=null,notice='';
  const emit=(phase,message)=>{notice=message;onState({active:Boolean(session),phase,notice,supported:typeof Recognition==='function'});};
  function clearTimers(s){for(const key of ['timer','fallback'])if(s[key]){cancel(s[key]);s[key]=null;}}
  const completeNotice=s=>s.limitNotice??(s.hasText?'入力できたよ。確認して送ってね。':'声を聞き取れなかったよ。もう一度マイクを押してね。');
  function finish(message,abort=false,completed=false){
    const s=session;if(!s)return;
    session=null;clearTimers(s);
    // Detach before abort: some browsers dispatch error/end synchronously.
    s.rec.onstart=s.rec.onresult=s.rec.onerror=s.rec.onend=null;
    if(abort)try{s.rec.abort();}catch{}
    emit('idle',message);
    if(completed)onComplete();
  }
  function stop(){
    const s=session;if(!s||s.stopping)return;
    s.stopping=true;clearTimers(s);emit('stopping','聞き取りを仕上げているよ…');
    s.fallback=schedule(()=>finish(completeNotice(s),true),3000);
    try{s.rec.stop();}catch{finish('音声入力を終了したよ。',true);}
  }
  function start(){
    if(session){stop();return;}
    if(!canStart())return;
    if(typeof Recognition!=='function'){
      emit('idle','このブラウザでは音声入力を使えません。キーボードのマイクから入力してね。');input.focus();return;
    }
    const value=input.value,start=input.selectionStart??value.length,end=input.selectionEnd??start;
    let rec;try{rec=new Recognition();}catch{emit('idle','音声入力を始められませんでした。キーボードのマイクから入力してね。');return;}
    const s={rec,prefix:value.slice(0,start),suffix:value.slice(end),hasText:false,hasFinal:false,hasInterim:false,stopping:false};session=s;
    rec.lang='ja-JP';rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=1;
    rec.onstart=()=>{if(session!==s||s.stopping)return;clearTimers(s);emit('listening','聞いているよ… 話し終わると送るよ');s.timer=schedule(stop,30000);};
    rec.onresult=event=>{
      if(session!==s)return;
      let transcript='';s.hasFinal=false;s.hasInterim=false;
      for(let i=0;i<event.results.length;i++){
        const result=event.results[i],text=result[0]?.transcript??'';transcript+=text;
        if(text.trim()){if(result.isFinal)s.hasFinal=true;else s.hasInterim=true;}
      }
      if(!transcript.trim())return;
      const max=input.maxLength>0?input.maxLength:600;
      const spoken=limitText(transcript,Math.max(0,max-s.prefix.length-s.suffix.length));
      input.value=s.prefix+spoken+s.suffix;input.setSelectionRange?.(s.prefix.length+spoken.length,s.prefix.length+spoken.length);s.hasText=Boolean(spoken);onInput();
      if(spoken.length<transcript.length){s.limitNotice=`入力は${max}文字までだよ。確認して送ってね。`;stop();}
    };
    rec.onerror=event=>{if(session===s)finish(ERRORS[event.error]??'音声入力を続けられませんでした。入力した文字は残してあるよ。',true);};
    rec.onend=()=>{
      if(session!==s)return;
      const completed=s.hasText&&s.hasFinal&&!s.hasInterim&&!s.limitNotice;
      finish(completed?'':completeNotice(s),false,completed);
    };
    emit('starting','マイクを準備しているよ…');
    s.timer=schedule(()=>finish('マイクを使えませんでした。許可や設定を確認してね。',true),15000);
    // Keep start synchronous with the user's click so Safari retains user activation.
    try{rec.start();}catch{finish('音声入力を始められませんでした。マイクの許可や設定を確認してね。',true);}
  }
  return {start,stop,cancel(){finish('音声入力を終了したよ。',true);},
    clearNotice(){if(!session&&notice)emit('idle','');},get active(){return Boolean(session);},get notice(){return notice;},
    destroy(){finish('',true);},
  };
}
