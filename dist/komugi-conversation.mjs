import {createWelcomeConversation,WELCOME_TEXT} from './welcome-conversation.mjs';
import {createVoiceInput} from './voice-input.mjs?v=auto-send-1';
export const CONVERSATION_STORAGE = 'kotokoto-komugi-conversation-v1';
export const MESSAGE_LIMIT = 600;
const HISTORY_LIMIT = 60;

export function bindChatEnter(input,form,now=Date.now){
  let composing=false,compositionEnded=-Infinity,allowNewline=false;
  const confirming=event=>composing||event.isComposing||event.keyCode===229||now()-compositionEnded<50;
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;compositionEnded=now();});
  input.addEventListener('keydown',event=>{
    if(event.key!=='Enter')return;
    allowNewline=event.shiftKey;
    if(confirming(event)||allowNewline)return;
    event.preventDefault();
    if(!event.repeat)form.requestSubmit();
  });
  input.addEventListener('keyup',event=>{if(event.key==='Enter')allowNewline=false;});
  // Some phone keyboards emit a line-break input without an Enter keydown.
  input.addEventListener('beforeinput',event=>{
    if(!['insertLineBreak','insertParagraph'].includes(event.inputType)||confirming(event))return;
    if(allowNewline){allowNewline=false;return;}
    event.preventDefault();form.requestSubmit();
  });
}

export function normalizeConversation(value) {
  if (value?.version !== 1 || !Array.isArray(value.messages) || value.messages.length % 2) throw new Error('Invalid conversation');
  const messages = value.messages.map((message, i) => {
    if (message?.role !== (i % 2 ? 'assistant' : 'user') || typeof message.content !== 'string'
        || !message.content.trim() || message.content.length > MESSAGE_LIMIT
        || typeof message.at !== 'string' || Number.isNaN(Date.parse(message.at))) throw new Error('Invalid message');
    const out={role: message.role, content: message.content, at: message.at};
    if(message.role==='assistant'&&Array.isArray(message.receipts))out.receipts=message.receipts.slice(0,16).filter(r=>r&&typeof r.label==='string'&&r.label.length<=180&&typeof r.delta==='number'&&Number.isFinite(r.delta)).map(r=>({label:r.label,delta:r.delta,status:r.status==='pending'?'pending':'recorded'}));
    return out;
  });
  return {version: 1, messages: messages.slice(-HISTORY_LIMIT)};
}

export function loadConversation(storage) {
  try {
    const raw = storage.getItem(CONVERSATION_STORAGE);
    return {data: raw === null ? {version: 1, messages: []} : normalizeConversation(JSON.parse(raw)), raw, writable: true};
  } catch {
    return {data: {version: 1, messages: []}, raw: null, writable: false};
  }
}

export function appendExchange(data, text, reply, at = new Date().toISOString(), receipts = []) {
  return normalizeConversation({version: 1, messages: [...data.messages.slice(-(HISTORY_LIMIT - 2)),
    {role: 'user', content: text, at}, {role: 'assistant', content: reply, at,...(receipts.length?{receipts}:{})}]});
}

export function requestMessages(data, text) {
  const messages = [...data.messages.slice(-16).map(({role, content, at}) => ({role, content, at})), {role: 'user', content: text}];
  while (messages.length > 1 && messages.reduce((sum, message) => sum + message.content.length, 0) > 5000) messages.splice(0, 2);
  return messages;
}

export function createKomugiConversation({root, storage, fetchImpl = globalThis.fetch, getContext = () => ({}), onReply = () => {},onSend=()=>{},onFailure=()=>{},onResult = result=>result,onInteraction=()=>{},onClearTarget=()=>{},getPetName=()=> 'こむぎ',canWelcome=()=>false,cloud=false,pendingStore=null,onClearHistory=async()=>{}}) {
  if (!storage) {
    try { storage = globalThis.localStorage; }
    catch { storage = {getItem() { throw new Error('Storage unavailable'); }}; }
  }
  const $ = id => document.getElementById(id);
  const historyDialog=$('conversation-history-dialog'),historyToggle=$('conversation-history-toggle');
  const thread = $('conversation-thread'), form = $('conversation-form'), input = $('conversation-input');
  const status = $('conversation-status'), warning = $('conversation-warning'), send = $('conversation-send'), clear = $('conversation-clear');
  let saved = loadConversation(storage), busy = false, available = false, sessionPromise = null, pending = pendingStore?.read()??null,expanded=false,recentReceipts=[];
  let voiceActive=false;
  const voiceButton=$('conversation-voice'),voiceStatus=$('conversation-voice-status');
  const voice=createVoiceInput({input,canStart:()=>available&&!busy&&!expanded&&!form.hidden&&!document.hidden&&!document.querySelector('dialog[open]'),
    onInput:()=>input.dispatchEvent(new Event('input',{bubbles:true})),
    onComplete:()=>{if(available&&!busy&&!expanded&&!form.hidden&&!document.hidden&&!document.querySelector('dialog[open]'))form.requestSubmit();},
    onState:({active,phase,notice,supported})=>{
      voiceActive=active;input.readOnly=active;
      voiceButton.classList.toggle('is-listening',active);voiceButton.dataset.phase=phase;
      voiceButton.setAttribute('aria-pressed',String(active));
      voiceButton.setAttribute('aria-label',active?'音声入力を終えて送信':supported?'音声入力をはじめる':'音声入力の使い方');
      voiceStatus.textContent=notice;voiceStatus.hidden=!notice;render();
    },
  });
  voiceButton.addEventListener('click',()=>voice.start());
  const stopHiddenVoice=()=>{if(document.hidden)voice.cancel();};
  document.addEventListener('visibilitychange',stopHiddenVoice);
  window.addEventListener('pagehide',()=>voice.cancel());
  const voicePanels=new MutationObserver(()=>{if(form.hidden||document.querySelector('dialog[open]'))voice.cancel();});
  voicePanels.observe(form,{attributes:true,attributeFilter:['hidden']});
  document.querySelectorAll('dialog').forEach(dialog=>voicePanels.observe(dialog,{attributes:true,attributeFilter:['open']}));

  let namedStatus=null;
  function petStatus(kind){
    const name=getPetName();
    const text=kind==='login'?`右上のメニューからログインして、${name}と話そう。`:kind==='connecting'?`${name}につないでいます…`:`${name}が考え中…`;
    namedStatus={kind,text};return text;
  }
  function refreshPetName(){
    if(namedStatus&&status.textContent===namedStatus.text)status.textContent=petStatus(namedStatus.kind);
  }

  function storageWarning(text = '') {
    warning.textContent = text || (!saved.writable ? '保存済みのおはなしを読み込めませんでした。元のデータは上書きせず、今回のおはなしは画面を閉じるまで表示します。' : '');
    warning.hidden = !warning.textContent;
  }

  function bubble(role, content, at, receipts=[]) {
    const article = document.createElement('article');
    article.className = 'conversation-message conversation-message--' + role;
    const name = document.createElement('span');
    name.className = 'conversation-author';
    name.textContent = role === 'user' ? (content===WELCOME_TEXT?'画面を開いたとき':'あなた') : getPetName();
    const text = document.createElement('p');
    text.textContent = content;
    article.append(name, text);
    if (at) {
      const time = document.createElement('time');
      time.dateTime = at;
      time.textContent = new Intl.DateTimeFormat('ja-JP', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(new Date(at));
      article.append(time);
    }
    if(receipts.length){
      const details=document.createElement('div');details.className='conversation-receipts';
      for(const r of receipts){const item=document.createElement('span');item.className='conversation-receipt'+(r.status==='pending'?' conversation-receipt--pending':'');item.textContent=r.label;if(r.delta>0){const n=document.createElement('b');n.textContent='＋'+r.delta;item.append(n);}details.append(item);}
      article.append(details);
    }
    return article;
  }

  function setExpanded(value){
    if(value)voice.cancel();
    expanded=value;document.body.classList.toggle('reading-conversation',expanded);
    historyToggle.setAttribute('aria-expanded',String(expanded));
    if(expanded&&!historyDialog.open)historyDialog.showModal();
    if(!expanded&&historyDialog.open)historyDialog.close();
  }

  function render() {
    const nodes = expanded?saved.data.messages.map(message => bubble(message.role, message.content, message.at,message.receipts)):[];
    if (expanded&&busy&&pending) nodes.push(bubble('user', pending.text));
    thread.replaceChildren(...nodes);
    thread.hidden=!expanded||!nodes.length;
    $('conversation-history-empty').hidden=!expanded||Boolean(nodes.length);
    thread.scrollTop = thread.scrollHeight;
    root.classList.toggle('is-sending', busy);
    thread.setAttribute('aria-busy', String(busy));
    send.disabled = busy || voiceActive || !available || !input.value.trim();
    voiceButton.disabled=busy||!available;
    input.disabled = busy || !available;
    clear.disabled = busy || !saved.data.messages.length;
    $('conversation-count').textContent = `${input.value.length} / ${MESSAGE_LIMIT}`;
    $('conversation-reconnect').hidden=available||busy;
    const result=$('conversation-result');result.replaceChildren();result.hidden=expanded||busy||!recentReceipts.length;
    if(!result.hidden)for(const r of recentReceipts){
      const item=document.createElement('span');item.className='conversation-receipt'+(r.status==='pending'?' conversation-receipt--pending':'');
      item.textContent=r.label+(r.delta>0?' ＋'+r.delta:'');result.append(item);
    }
    onInteraction(busy||voiceActive||expanded||root.contains(document.activeElement));
  }

  async function session() {
    const response = await fetchImpl('/api/chat/session', {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('おはなしにつながりませんでした。少し待って、もう一度開いてね。');
    const data = await response.json().catch(() => { throw new Error('おはなしにつながりませんでした。少し待って、もう一度開いてね。'); });
    available = data.available === true;
    if (!available) throw new Error(data.loginRequired?petStatus('login'):data.setupRequired?'アカウントで使う記録を選んでね。':'おはなしの準備中です。もう少し待ってね。');
  }

  const welcome=createWelcomeConversation({
    canStart:()=>cloud&&available&&!busy&&!voiceActive&&!expanded&&!pending&&!input.value.trim()&&document.activeElement!==input&&!document.hidden&&!form.hidden&&!document.querySelector('dialog[open]')&&canWelcome(),
    request:async()=>{const requestId=crypto.randomUUID();const response=await fetchImpl('/api/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,mode:'welcome'}),signal:AbortSignal.timeout(55000)});if(!response.ok)return null;const data=await response.json();if(data.skipped)return null;if(data.requestId!==requestId||typeof data.reply!=='string'||!data.reply.trim()||data.reply.length>MESSAGE_LIMIT)return null;return data;},
    approach:onSend,reply:onReply,cancel:onFailure,saved:()=>{saved=loadConversation(storage);render();},
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)welcome.interrupt();});
  root.addEventListener('focusin',()=>welcome.interrupt());
  input.addEventListener('input',()=>welcome.interrupt());
  const welcomePanels=new MutationObserver(()=>{if(form.hidden||document.querySelector('dialog[open]'))welcome.interrupt();});
  welcomePanels.observe(form,{attributes:true,attributeFilter:['hidden']});
  document.querySelectorAll('dialog').forEach(dialog=>welcomePanels.observe(dialog,{attributes:true,attributeFilter:['open']}));

  async function open() {
    if (busy) return;
    saved = loadConversation(storage); storageWarning(); render();
    status.textContent = petStatus('connecting');
    try { sessionPromise = session(); await sessionPromise; status.textContent = ''; }
    catch (error) { available = false; sessionPromise = null; status.textContent = error.message; }
    render();
    void welcome.start();
  }

  function save(data) {
    if(cloud){saved=loadConversation(storage);storageWarning();return;}
    if (!saved.writable) { saved.data = data; return; }
    try {
      if (storage.getItem(CONVERSATION_STORAGE) !== saved.raw) {
        saved = {...saved, data, writable: false};
        storageWarning('別のタブでおはなしが更新されました。この返事は保存していません。おはなしを開き直すと、保存済みの続きが表示されます。');
        return;
      }
      const raw = JSON.stringify(data);
      storage.setItem(CONVERSATION_STORAGE, raw);
      saved = {data, raw, writable: true};
    } catch {
      saved = {...saved, data, writable: false};
      storageWarning('このブラウザにおはなしを保存できません。今回のおはなしは、画面を閉じるまで表示します。');
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (busy || voiceActive || !available || !text || text.length > MESSAGE_LIMIT) return;
    welcome.interrupt();voice.clearNotice();
    // Unknown network outcomes reuse the same ID and payload for five minutes.
    if (!pending || pending.text !== text || (!cloud&&Date.now() - pending.at > 4 * 60000)) {
      pending = {text, at: Date.now(), body: {requestId: crypto.randomUUID(), messages: requestMessages(saved.data, text), context: getContext()}};
    }
    pendingStore?.write(pending);
    setExpanded(false);busy = true; status.textContent = petStatus('thinking'); render();
    try {
      const arrival=Promise.resolve(onSend()).catch(()=>{});
      await sessionPromise;
      await welcome.pending;
      let response = await fetchImpl('/api/chat', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(pending.body), signal: AbortSignal.timeout(45000)});
      if (response.status === 401) {
        sessionPromise = session(); await sessionPromise;
        response = await fetchImpl('/api/chat', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(pending.body), signal: AbortSignal.timeout(45000)});
      }
      const data = await response.json().catch(() => { throw new Error('お返事を読み込めませんでした。もう一度送ってね。'); });
      if (!response.ok) { if((response.status<500||data.error?.retryable)&&!['request_pending','outcome_unknown'].includes(data.error?.code)){pending = null;pendingStore?.write(null);} throw new Error(data.error?.message || 'お返事が届きませんでした。もう一度送ってね。'); }
      if (data.requestId !== pending.body.requestId || typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > MESSAGE_LIMIT) throw new Error('お返事を読み込めませんでした。もう一度送ってね。');
      const applied=await onResult(data,text,pending.body.context),reply=applied?.reply??data.reply;
      save(appendExchange(saved.data, text, reply,new Date().toISOString(),applied?.receipts??[]));
      recentReceipts=applied?.receipts??[];
      await arrival;
      input.value = '';input.style.height=''; pending = null;pendingStore?.write(null); status.textContent = '';
      onReply(reply);
    } catch (error) {
      onFailure();
      status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'お返事が届きませんでした。入力は残してあるので、もう一度送ってね。' : error.message;
    } finally { busy = false; render(); }
  });

  input.addEventListener('input', () => { if(!voiceActive)voice.clearNotice();send.disabled = busy || voiceActive || !available || !input.value.trim(); $('conversation-count').textContent = `${input.value.length} / ${MESSAGE_LIMIT}`;input.style.height='auto';input.style.height=Math.min(90,input.scrollHeight)+'px'; });
  bindChatEnter(input,form);
  historyToggle.addEventListener('click',()=>{setExpanded(true);render();});
  $('conversation-history-close').addEventListener('click',()=>historyDialog.close());
  historyDialog.addEventListener('close',()=>{setExpanded(false);render();});
  historyDialog.addEventListener('click',event=>{if(event.target!==historyDialog)return;const r=historyDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)historyDialog.close();});
  $('conversation-reconnect').addEventListener('click',()=>{open();});
  root.addEventListener('focusin',()=>onInteraction(true));root.addEventListener('focusout',()=>queueMicrotask(()=>onInteraction(busy||voiceActive||expanded||root.contains(document.activeElement))));
  clear.addEventListener('click', async () => {
    if (busy || !globalThis.confirm(cloud?'このアカウントのおはなし履歴と、会話から覚えたことを消しますか？ 行動の記録とポイントは残ります。':'このブラウザのおはなし履歴を消しますか？')) return;
    try { if(cloud)await onClearHistory();else storage.removeItem(CONVERSATION_STORAGE); saved = loadConversation(storage); pending = null;pendingStore?.write(null); recentReceipts=[]; storageWarning(); status.textContent = 'おはなし履歴を消しました。'; render(); }
    catch { status.textContent = '履歴を消せませんでした。ブラウザの設定をご確認ください。'; }
  });
  storageWarning(); render();
  return {open,refreshPetName,reload(){saved=loadConversation(storage);if(!available)voice.cancel();render();},get shouldPauseReply(){return busy||voiceActive||expanded||Boolean(input.value.trim());},get isInteracting(){return busy||voiceActive||expanded||root.contains(document.activeElement);},focus(label=''){
    const target=$('conversation-target');target.replaceChildren();target.hidden=!label;
    if(label){target.append(document.createTextNode(label+'のつづき'));const cancel=document.createElement('button');cancel.type='button';cancel.textContent='×';cancel.setAttribute('aria-label','補足する対象を解除');cancel.addEventListener('click',()=>{target.hidden=true;onClearTarget();});target.append(cancel);}
    input.focus();
  }};
}
