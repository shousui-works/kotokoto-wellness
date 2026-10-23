import test from 'node:test';
import assert from 'node:assert/strict';
import {createKomugiConversation} from '../dist/komugi-conversation.mjs';

test('renaming refreshes named statuses without replacing other messages',async()=>{
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldObserver=globalThis.MutationObserver;
 const elements=new Map();
 const element=()=>({textContent:'',value:'',dataset:{},classList:{toggle(){}},addEventListener(){},setAttribute(){},replaceChildren(){},contains(){return false;}});
 globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},body:element(),addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}};
 globalThis.window={addEventListener(){}};
 globalThis.MutationObserver=class{observe(){}};
 try{
  let name='もち',finish;
  const conversation=createKomugiConversation({root:element(),storage:{getItem(){return null;}},getPetName:()=>name,fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});
  const opening=conversation.open(),status=elements.get('conversation-status');
  assert.equal(status.textContent,'もちにつないでいます…');
  name='きなこ';conversation.refreshPetName();assert.equal(status.textContent,'きなこにつないでいます…');
  finish({ok:true,json:async()=>({available:false,loginRequired:true})});await opening;
  assert.equal(status.textContent,'右上のメニューからログインして、きなこと話そう。');
  name='まめ';conversation.refreshPetName();assert.equal(status.textContent,'右上のメニューからログインして、まめと話そう。');
  status.textContent='通信エラー';name='そら';conversation.refreshPetName();assert.equal(status.textContent,'通信エラー');
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;globalThis.MutationObserver=oldObserver;}
});
