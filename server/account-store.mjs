import {normalizeCollection} from '../dist/collection-model.mjs';
import {emptyMemory,normalizeMemory,MAX_MEMORY_MESSAGES} from './owner-memory.mjs';
import {randomUUID} from 'node:crypto';
import {emptyAccount,problem,dayKey} from './account-model.mjs';
const clean=value=>JSON.parse(JSON.stringify(value));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const docId=value=>Buffer.from(value).toString('base64url');
const MAX_RECORDS=5000;

export class FirestoreAccountStore {
  constructor(db){this.db=db;}
  user(uid){return this.db.collection('users').doc(uid);}
  async load(tx,uid){
    const user=this.user(uid),meta=(await tx.get(user)).data();
    if(!meta?.initialized)return {...emptyAccount(),revision:meta?.revision??0,chatLease:meta?.chatLease??null};
    const dataset=user.collection('datasets').doc(meta.datasetId);
    const [days,activities,messages,profile,companion,memory,collection]=await Promise.all([
      tx.get(dataset.collection('legacyDays').limit(MAX_RECORDS+1)),tx.get(dataset.collection('activities').limit(MAX_RECORDS+1)),
      tx.get(dataset.collection('threads').doc(`main-${meta.historyEpoch??'0'}`).collection('messages').orderBy('sequence').limitToLast(60)),
      tx.get(dataset.collection('settings').doc('profile')),tx.get(dataset.collection('companion').doc('state')),tx.get(dataset.collection('memory').doc('owner')),tx.get(user.collection('collection').doc('state')),
    ]);
    if(days.size>MAX_RECORDS||activities.size>MAX_RECORDS)throw problem(413,'account_too_large','記録が多いため、読み込み方法の更新が必要です。記録はクラウドに残っています。');
    const saved=companion.data();
    return {revision:meta.revision,initialized:true,datasetId:meta.datasetId,chatLease:meta.chatLease??null,historyEpoch:meta.historyEpoch??"0",messageCounter:meta.messageCounter??0,
      legacy:{...saved.legacy,days:Object.fromEntries(days.docs.map(d=>[d.data().date,d.data().value]))},
      progress:{...saved.progress,activities:activities.docs.map(d=>d.data()),processed:saved.progress.legacyProcessed??[]},
      collection:normalizeCollection(collection.data()),memory:normalizeMemory(memory.data()),profile:profile.data().profile,chatEnabled:profile.data().chatEnabled!==false,
      conversation:{version:1,messages:messages.docs.map(d=>{const {sequence,text,...rest}=d.data();return {...rest,content:text};})}};
  }
  async loadMemoryWindow(tx,uid,state){
    if(!state.initialized)return [];
    const ref=this.user(uid).collection('datasets').doc(state.datasetId).collection('threads').doc(`main-${state.historyEpoch??'0'}`).collection('messages');
    const docs=await tx.get(ref.where('sequence','>',(state.memory??emptyMemory()).throughSequence).orderBy('sequence').limit(MAX_MEMORY_MESSAGES+1));
    if(docs.size>MAX_MEMORY_MESSAGES)throw Error('Memory backlog too large');
    return docs.docs.map(doc=>{const {text,...rest}=doc.data();return {...rest,content:text};});
  }
  async readIfChanged(uid,revision){const meta=(await this.user(uid).get()).data();if(meta?.revision===revision)return null;return this.read(uid);}
  async read(uid){return this.db.runTransaction(tx=>this.load(tx,uid));}
  writeState(tx,uid,before,after,{requestId,clearConversation=false}={}){
    const user=this.user(uid),dataset=user.collection('datasets').doc(after.datasetId);
    tx.set(user,{revision:after.revision,initialized:after.initialized,datasetId:after.datasetId,chatLease:after.chatLease??null,historyEpoch:after.historyEpoch??"0",messageCounter:after.messageCounter??0});
    if(!after.initialized)return;
    const write=(ref,value)=>tx.set(ref,clean(value));
    if(!equal(before.collection,after.collection))write(user.collection('collection').doc('state'),normalizeCollection(after.collection));
    if(!equal(before.memory,after.memory))write(dataset.collection('memory').doc('owner'),normalizeMemory(after.memory));
    const {days,...legacy}=after.legacy,{activities,processed,...progress}=after.progress;
    if(!equal({...before.legacy,days:{}},{...after.legacy,days:{}})||!equal({...before.progress,activities:[],processed:[]},{...after.progress,activities:[],processed:[]})||!before.initialized)write(dataset.collection('companion').doc('state'),{legacy,progress:{...progress,legacyProcessed:before.progress.processed}});
    if(!equal(before.profile,after.profile)||before.chatEnabled!==after.chatEnabled||!before.initialized)write(dataset.collection('settings').doc('profile'),{profile:after.profile,chatEnabled:after.chatEnabled});
    for(const date of new Set([...Object.keys(before.legacy.days),...Object.keys(days)])){
      if(equal(before.legacy.days[date],days[date]))continue;
      const ref=dataset.collection('legacyDays').doc(date);if(days[date])write(ref,{date,value:days[date]});else tx.delete(ref);
    }
    const old=new Map(before.progress.activities.map(a=>[a.id,a]));
    for(const a of activities)if(!equal(old.get(a.id),a))write(dataset.collection('activities').doc(docId(a.id)),a);
    const history=dataset.collection('threads').doc(`main-${after.historyEpoch??'0'}`).collection('messages');
    if(clearConversation){
      // A generation change hides all older messages immediately; old bodies are deleted separately.
      tx.set(dataset.collection('threads').doc(`main-${after.historyEpoch}`),{clearedAt:new Date()});
    }else if(requestId&&after.conversation.messages.length){
      const pair=after.conversation.messages.slice(-2);
      for(const [i,value]of pair.entries())write(history.doc(`${requestId}-${i}`),{sequence:after.messageCounter*2+i,...Object.fromEntries(Object.entries(value).filter(([key])=>key!=='content')),text:value.content});
    }
  }
  async atomic(uid,requestId,run,{quota=false,now=Date.now(),memoryWindow=false}={}){
    return this.db.runTransaction(async tx=>{
      const state=await this.load(tx,uid),opRef=this.user(uid).collection('operations').doc(requestId),op=(await tx.get(opRef)).data()??null;
      const day=dayKey(now),globalRef=this.db.collection('usage').doc(`global_${day}`),quotaRef=this.db.collection('usage').doc(`${docId(uid)}_${day}`);
      const usage=quota?{global:(await tx.get(globalRef)).data()??{count:0,leases:[]},user:(await tx.get(quotaRef)).data()??{count:0,recent:[]}}:null;
      const rows=memoryWindow&&!op?await this.loadMemoryWindow(tx,uid,state):null;
      const result=await run(structuredClone(state),op,usage,rows);
      if(result.state)this.writeState(tx,uid,state,result.state,{requestId:result.appendMessages?requestId:null,clearConversation:result.clearConversation});
      if(result.operation)tx.set(opRef,clean(result.operation));
      if(result.usage){const expireAt=new Date(now+30*86400000);tx.set(globalRef,{...result.usage.global,expireAt});tx.set(quotaRef,{...result.usage.user,expireAt});}
      return result.value;
    });
  }
  async gacha(uid,id,run){
    return this.db.runTransaction(async tx=>{
      const state=await this.load(tx,uid),ref=this.user(uid).collection('plushTransactions').doc(id);
      const opRef=this.user(uid).collection('operations').doc(id);
      const [old,feature,op]=await Promise.all([tx.get(ref),tx.get(this.db.collection('features').doc('plushGacha')),tx.get(opRef)]);
      if(!old.exists&&op.exists)throw problem(409,'request_conflict','同じ要求IDに別の操作があります。');
      const result=await run(state,old.data()??null,feature.data()?.enabled!==false);
      if(result.state)this.writeState(tx,uid,state,result.state);
      if(result.transaction){tx.set(ref,clean(result.transaction));tx.set(opRef,{id,fingerprint:result.transaction.fingerprint??'',status:'complete',at:Date.parse(result.transaction.at)});}return result.value;
    });
  }
  async plushHistory(uid,cursor=null){
    const collection=this.user(uid).collection('plushTransactions');let query=collection.orderBy('at','desc').limit(21);
    if(cursor){const doc=await collection.doc(cursor).get();if(!doc.exists)throw problem(400,'invalid_cursor','履歴を最初から読み直してね。');query=query.startAfter(doc);}
    const result=await query.get(),docs=result.docs.slice(0,20);
    return {rows:docs.map(d=>{const {fingerprint,...row}=d.data();return row;}),nextCursor:result.size>20?docs.at(-1).id:null};
  }
  async import(uid,id,state,hash){
    const user=this.user(uid),datasetId=`import-${id}`,target=user.collection('datasets').doc(datasetId),manifest=user.collection('imports').doc(id),worker=randomUUID(),until=Date.now()+120000;
    const already=await this.db.runTransaction(async tx=>{
      const meta=(await tx.get(user)).data(),old=(await tx.get(manifest)).data();
      if(old&&old.hash!==hash)throw problem(409,'request_conflict','同じ取り込みIDに違う内容は使えません。');
      if(meta?.initialized){if(meta.datasetId===datasetId&&old?.hash===hash)return true;throw problem(409,'cloud_exists','クラウドに記録があります。自動で混ぜず、元のデータを残しました。');}
      if(meta?.importLease?.until>Date.now())throw problem(409,'import_busy','取り込み中です。少し待ってから確認してね。');
      tx.set(user,{initialized:false,revision:0,importLease:{id,worker,until}});
      tx.set(manifest,{hash,status:'staging',worker,createdAt:new Date()});return false;
    });
    if(already)return this.read(uid);
    const writes=[];
    const {days,...legacy}=state.legacy,{activities,processed,...progress}=state.progress;
    writes.push([target.collection('companion').doc('state'),{legacy,progress:{...progress,legacyProcessed:processed}}],[target.collection('settings').doc('profile'),{profile:state.profile,chatEnabled:state.chatEnabled}]);
    for(const [date,value]of Object.entries(days))writes.push([target.collection('legacyDays').doc(date),{date,value}]);
    for(const value of activities)writes.push([target.collection('activities').doc(docId(value.id)),value]);
    for(const [sequence,value]of state.conversation.messages.entries()){const {content,...rest}=value;writes.push([target.collection('threads').doc('main-0').collection('messages').doc(`import-${sequence}`),{sequence,...rest,text:content}]);}
    for(let n=0;n<writes.length;n+=350)await this.db.runTransaction(async tx=>{
      const meta=(await tx.get(user)).data();if(meta?.initialized||meta?.importLease?.worker!==worker)throw problem(409,'import_conflict','別の操作が進んだため取り込みを止めました。');
      for(const [ref,value]of writes.slice(n,n+350))tx.set(ref,clean(value));
    });
    await this.db.runTransaction(async tx=>{
      const meta=(await tx.get(user)).data();if(meta?.initialized||meta?.importLease?.worker!==worker)throw problem(409,'import_conflict','別の端末で記録が選ばれました。');
      tx.set(user,{revision:1,initialized:true,datasetId,chatLease:null,historyEpoch:'0',messageCounter:state.messageCounter});tx.set(manifest,{hash,status:'complete',completedAt:new Date()});
    });
    return this.read(uid);
  }
  async clearHistoryBodies(uid,state,cutoff=Date.now()){
    const dataset=this.user(uid).collection('datasets').doc(state.datasetId);
    for(const collection of [dataset.collection('threads').doc(`main-${state.historyEpoch??'0'}`).collection('messages'),this.user(uid).collection('operations')]){
      let last=null;
      for(;;){let q=collection.orderBy('__name__').limit(250);if(last)q=q.startAfter(last);const docs=await q.get();if(docs.empty)break;
        const batch=this.db.batch();for(const doc of docs.docs){if(collection.id==='messages')batch.delete(doc.ref);else{const value=doc.data();if(value.at>cutoff)continue;delete value.result;batch.set(doc.ref,{...value,bodyCleared:true});}}
        await batch.commit();last=docs.docs.at(-1);
      }
    }
  }
}

// Deterministic in-memory repository for tests only; never selected by production config.
export class MemoryAccountStore {
  constructor(){this.accounts=new Map();this.transcripts=new Map();this.ops=new Map();this.usages=new Map();this.tail=Promise.resolve();this.plushTransactions=new Map();this.gachaEnabled=true;}
  readIfChanged(uid,revision){return this.read(uid).then(state=>state.revision===revision?null:state);}
  read(uid){return Promise.resolve(structuredClone(this.accounts.get(uid)??emptyAccount()));}
  atomic(uid,id,run,{quota=false,now=Date.now(),memoryWindow=false}={}){
    const work=this.tail.then(async()=>{const state=await this.read(uid),key=`${uid}/${id}`,day=dayKey(now),g=`g:${day}`,u=`${uid}:${day}`;
      const usage=quota?structuredClone({global:this.usages.get(g)??{count:0,leases:[]},user:this.usages.get(u)??{count:0,recent:[]}}):null;
      const rows=memoryWindow&&!this.ops.has(key)?structuredClone((this.transcripts.get(uid)??[]).filter(m=>m.sequence>(state.memory??emptyMemory()).throughSequence)):null;
      const result=await run(state,structuredClone(this.ops.get(key)??null),usage,rows);
      if(result.clearConversation)this.transcripts.set(uid,[]);
      if(result.appendMessages){const pair=result.state.conversation.messages.slice(-2).map((m,i)=>({...m,sequence:result.state.messageCounter*2+i}));this.transcripts.set(uid,[...(this.transcripts.get(uid)??[]),...pair]);}
      if(result.state)this.accounts.set(uid,structuredClone(result.state));if(result.operation)this.ops.set(key,structuredClone(result.operation));if(result.usage){this.usages.set(g,result.usage.global);this.usages.set(u,result.usage.user);}return result.value;});
    this.tail=work.catch(()=>{});return work;
  }
  async import(uid,id,state,hash){const result=await this.atomic(uid,id,(current,old)=>{if(old&&old.hash!==hash)throw problem(409,'request_conflict','ID conflict');if(current.initialized){if(old?.hash===hash)return {value:current};throw problem(409,'cloud_exists','Cloud exists');}state={...state,datasetId:`import-${id}`,revision:1};return {state,operation:{hash},value:state};});if(!this.transcripts.has(uid))this.transcripts.set(uid,state.conversation.messages.map((m,sequence)=>({...m,sequence})));return result;}
  async gacha(uid,id,run){
    const work=this.tail.then(async()=>{const state=await this.read(uid),key=uid+'/'+id;if(!this.plushTransactions.has(key)&&this.ops.has(key))throw problem(409,'request_conflict','同じ要求IDに別の操作があります。');const result=await run(state,structuredClone(this.plushTransactions.get(key)??null),this.gachaEnabled);
      if(result.state)this.accounts.set(uid,structuredClone(result.state));if(result.transaction){this.plushTransactions.set(key,structuredClone(result.transaction));this.ops.set(key,{id,fingerprint:result.transaction.fingerprint??'',status:'complete',at:Date.parse(result.transaction.at)});}return result.value;});this.tail=work.catch(()=>{});return work;
  }
  async plushHistory(uid,cursor=null){const rows=[...this.plushTransactions].filter(([key])=>key.startsWith(uid+'/')).map(([,row])=>row).sort((a,b)=>b.at.localeCompare(a.at)||b.requestId.localeCompare(a.requestId));const start=cursor?rows.findIndex(r=>r.requestId===cursor)+1:0;if(cursor&&!start)throw problem(400,'invalid_cursor','Invalid cursor');const selected=rows.slice(start,start+20);return {rows:selected.map(({fingerprint,...row})=>row),nextCursor:rows.length>start+20?selected.at(-1).requestId:null};}
  async clearHistoryBodies(uid){for(const [key,value]of this.ops)if(key.startsWith(uid+'/'))this.ops.set(key,{fingerprint:value.fingerprint,status:value.status,bodyCleared:true});}
}
