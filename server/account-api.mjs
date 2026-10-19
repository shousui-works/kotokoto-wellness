import {emptyMemory,normalizeMemory,splitMemoryWindow,conversationInput,memoryDay} from './owner-memory.mjs';
import {randomUUID} from 'node:crypto';
import {emptyAccount,publicAccount,importAccount,applyCommand,requireRevision,requireSetup,problem,uuid,fingerprint,dayKey} from './account-model.mjs';
import {progressContext,applyInterpretation,progressCompanion} from '../dist/progress.mjs';
import {growthForXP} from '../dist/model.mjs';
import {appendExchange} from '../dist/komugi-conversation.mjs';
import {validateChatRequest} from './komugi-chat.mjs';
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
const originOK=req=>{try{return req.headers['sec-fetch-site']!=='cross-site'&&new URL(req.headers.origin).origin===req.headers.origin&&new URL(req.headers.origin).host===req.headers.host;}catch{return false;}};
async function body(req,limit=2*1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw problem(413,'too_large','記録が大きすぎるため、取り込めませんでした。元のデータは残っています。');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw problem(400,'invalid_json','送信内容を確認してね。');}}
const known=error=>fail(error.status??503,error.code??'storage_unavailable',error.status?error.message:'今は記録につながりません。入力を残して、少し待ってから試してね。');

export function createAccountAPI({store,verify,config,generate,summarize=null,now=Date.now,apiAvailable=true,proxy=globalThis.fetch}){
  async function identity(req){const match=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'');if(!match)throw problem(401,'login_required','Googleでログインして、こむぎと話そう。');
    try{const user=await verify(match[1]);if(!user?.uid||user.uid.includes('/'))throw Error();return user;}catch{throw problem(401,'login_expired','ログインし直してね。入力は残してあります。');}}
  const packet=state=>({state:publicAccount(state)});
  function replay(op,hash,state){if(!op)return null;if(op.fingerprint!==hash)throw problem(409,'request_conflict','同じ要求IDの内容が違います。');
    if(op.status==='pending')return fail(409,op.until>now()?'request_pending':'outcome_unknown',op.until>now()?'返事を待っています。少し待ってから確認してね。':'返事の結果を確認できませんでした。必要なら、もう一度送ってね。');
    if(op.bodyCleared)return fail(409,'history_cleared','この会話の履歴は削除されています。');
    return {status:op.httpStatus??200,body:{requestId:op.id,...op.result,...packet(state)}};
  }
  return async function accountAPI(req,res,pathname){
    if(pathname.startsWith('/__/auth/')||pathname==='/__/firebase/init.json'){
      try{
        const allowed=new Set(['handler','handler.js','iframe','iframe.js','experiments.js','links','links.js']);
        const file=pathname.slice('/__/auth/'.length);
        if(!['GET','POST'].includes(req.method)||pathname!=='/__/firebase/init.json'&&!allowed.has(file))throw problem(404,'not_found','Not found');
        let payload;if(req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>128*1024)throw problem(413,'too_large','Too large');chunks.push(chunk);}payload=Buffer.concat(chunks);}
        const query=new URL(req.url,'https://app.invalid').search;
        const upstream=await proxy(`https://${config.projectId}.firebaseapp.com${pathname}${query}`,{method:req.method,body:payload,headers:{'Content-Type':req.headers['content-type']??'application/octet-stream'},redirect:'manual',signal:AbortSignal.timeout(15000)});
        if(upstream.status>=300&&upstream.status<400)throw problem(502,'auth_proxy_redirect','認証の接続先を確認できませんでした。');
        res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')??'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(Buffer.from(await upstream.arrayBuffer()));
      }catch(error){const result=known(error);send(res,result.status,result.body);}return true;
    }
    if(!pathname.startsWith('/api/'))return false;
    try{
      if(pathname==='/api/account/config'&&req.method==='GET'){send(res,200,{mode:'required',firebase:config});return true;}
      const user=await identity(req),uid=user.uid;
      if(!['GET','HEAD'].includes(req.method)&&!originOK(req))throw problem(403,'origin_rejected','この画面からもう一度試してね。');
      if(pathname==='/api/chat/session'&&req.method==='GET'){send(res,200,{available:apiAvailable});return true;}
      if(pathname==='/api/sync'&&req.method==='GET'){const revision=new URL(req.url,'https://app.invalid').searchParams.get('revision');if(revision!==null&&/^\d+$/.test(revision)){const state=await store.readIfChanged(uid,Number(revision));send(res,200,state?packet(state):{unchanged:true});return true;}}
      if(['/api/sync','/api/me','/api/export'].includes(pathname)&&req.method==='GET'){send(res,200,packet(await store.read(uid)));return true;}
      if(pathname.startsWith('/api/operations/')&&req.method==='GET'){
        const id=pathname.split('/').at(-1);if(!uuid(id))throw problem(400,'invalid_id','要求IDを確認してね。');
        const result=await store.atomic(uid,id,(state,op)=>({value:op?{status:op.status,bodyCleared:!!op.bodyCleared,revision:state.revision}:null}));if(!result)throw problem(404,'not_found','まだ保存が確認できません。');send(res,200,result);return true;
      }
      if(pathname==='/api/import'&&req.method==='POST'){
        const input=await body(req);if(!uuid(input.requestId))throw problem(400,'invalid_id','要求IDを確認してね。');
        const state=importAccount(input.data),hash=fingerprint(state);send(res,200,packet(await store.import(uid,input.requestId,state,hash)));return true;
      }
      if(pathname==='/api/commands'&&req.method==='POST'){
        const input=await body(req,32*1024);if(!uuid(input.requestId))throw problem(400,'invalid_id','要求IDを確認してね。');const hash=fingerprint(input);
        const result=await store.atomic(uid,input.requestId,(state,op)=>{
          const repeated=replay(op,hash,state);if(repeated)return {value:repeated};requireRevision(state,input.revision);
          let next;
          if(input.command?.type==='initialize'){
            if(state.initialized)throw problem(409,'cloud_exists','すでに記録があります。クラウドの内容を読み直してね。');
            next={...emptyAccount(),...(input.command.profile?{profile:importAccount({legacy:emptyAccount().legacy,profile:input.command.profile}).profile}:{}),initialized:true,datasetId:`data-${input.requestId}`,revision:1};
          }else{try{next=applyCommand(state,input.command,now());}catch(error){throw error.status?error:problem(400,'invalid_command','入力した値を確認してね。');}}
          return {state:next,operation:{id:input.requestId,fingerprint:hash,status:'complete',at:now()},value:{status:200,body:{requestId:input.requestId,...packet(next)}}};
        });send(res,result.status,result.body);return true;
      }
      if(pathname==='/api/conversations'&&req.method==='DELETE'){
        const input=await body(req,4096);if(!uuid(input.requestId))throw problem(400,'invalid_id','要求IDを確認してね。');const hash=fingerprint(input);let old;
        const result=await store.atomic(uid,input.requestId,(state,op)=>{
          const repeated=replay(op,hash,state);if(repeated)return {value:repeated};requireSetup(state);requireRevision(state,input.revision);
          if(state.chatLease?.until>now())throw problem(409,'chat_busy','こむぎの返事を待ってから消してね。');old=state;
          const next={...state,memory:{...emptyMemory(),revision:(state.memory?.revision??0)+1,updatedAt:new Date(now()).toISOString()},conversation:{version:1,messages:[]},historyEpoch:input.requestId,revision:state.revision+1};
          return {state:next,clearConversation:true,operation:{id:input.requestId,fingerprint:hash,status:'complete',at:now()},value:{status:200,body:packet(next)}};
        });
        if(old)await store.clearHistoryBodies(uid,old,now());send(res,result.status,result.body);return true;
      }
      if(pathname==='/api/chat'&&req.method==='POST'){
        if(!apiAvailable)throw problem(503,'chat_unavailable','おはなしの準備中です。');
        const raw=await body(req,40*1024),text=(raw.text??raw.messages?.at(-1)?.content??'').trim();
        if(!uuid(raw.requestId)||!text||text.length>600)throw problem(400,'invalid_chat','600文字以内で聞かせてね。');
        const hash=fingerprint({requestId:raw.requestId,text,selectedId:raw.selectedId??raw.context?.activities?.find(a=>a.selected)?.id??null});let input,baseRevision,memoryPlan,turnTime;
        const reserved=await store.atomic(uid,raw.requestId,(state,op,usage,rows)=>{
          const repeated=replay(op,hash,state);if(repeated)return {value:repeated};requireSetup(state);
          if(state.progress.processed.includes(raw.requestId))throw problem(409,'imported_request','取り込み済みの会話です。重ねて実行しません。');
          const time=now(),global=usage.global,personal=usage.user;turnTime=time;
          const window=splitMemoryWindow(rows??[],dayKey(time));memoryPlan={previous:normalizeMemory(state.memory),rows:window.past,throughDate:window.past.length?memoryDay(window.past.at(-2).at):null,epoch:state.historyEpoch};
          const cost=memoryPlan.rows.length?2:1;global.leases=global.leases.filter(l=>l.until>time);personal.recent=personal.recent.filter(t=>t>time-60000);
          if(state.chatLease?.until>time)throw problem(409,'chat_busy','別の画面でこむぎが返事を考えています。少し待ってね。');
          if(global.count+cost>120||personal.count>=30||personal.recent.length>=6||global.leases.length>=2)throw problem(429,'rate_limited','少しひと息ついてから、また話しかけてね。');
          const today=dayKey(time),context={date:today,hour:Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Asia/Tokyo'}).format(new Date(time))),stage:growthForXP(progressCompanion(state.progress,state.legacy).xp).stage.id,nickname:state.profile.nickname,petName:state.profile.petName??'こむぎ',...progressContext(state.legacy,state.progress,today,raw.selectedId??raw.context?.activities?.find(a=>a.selected)?.id)};
          input=validateChatRequest({requestId:raw.requestId,messages:[{role:'user',content:text}],context});if(!input)throw problem(400,'invalid_chat','内容を確認してね。');input.messages=conversationInput(window.current,text);input.context.ownerMemory=memoryPlan.previous.summary;input.context.memoryThroughDate=memoryPlan.previous.throughDate;baseRevision=state.revision;
          const until=time+90000;global.count+=cost;personal.count++;personal.recent.push(time);global.leases.push({key:`${uid}/${raw.requestId}`,until});
          return {state:{...state,chatLease:{id:raw.requestId,until}},operation:{id:raw.requestId,fingerprint:hash,status:'pending',until,at:time},usage,value:null};
        },{quota:true,now:now(),memoryWindow:true});
        if(reserved){send(res,reserved.status,reserved.body);return true;}
        let generated;
        try{
          if(memoryPlan.rows.length){
            if(!summarize)throw Error('Memory summarizer unavailable');
            const compacted=await summarize(memoryPlan,uid);
            const nextMemory=normalizeMemory({...memoryPlan.previous,...compacted,revision:memoryPlan.previous.revision+1,throughDate:memoryPlan.throughDate,throughSequence:memoryPlan.rows.at(-1).sequence,updatedAt:new Date(now()).toISOString()});
            const committed=await store.atomic(uid,raw.requestId,(state,op)=>{
              if(op?.status!=='pending'||state.chatLease?.id!==raw.requestId||state.revision!==baseRevision||state.historyEpoch!==memoryPlan.epoch||(state.memory?.revision??0)!==memoryPlan.previous.revision)throw problem(409,'context_changed','別の画面で更新されました。もう一度聞かせてね。');
              state.memory=nextMemory;state.revision++;return {state,value:state.revision};
            });baseRevision=committed;input.context.ownerMemory=nextMemory.summary;input.context.memoryThroughDate=nextMemory.throughDate;
          }
          generated=await generate(input,uid);
        }catch(error){generated=error.status?known(error):{status:503,body:{error:{code:'memory_unavailable',message:'前のおはなしを整理できませんでした。記録は残してあるので、少し待ってもう一度送ってね。',retryable:true}}};}

        const result=await store.atomic(uid,raw.requestId,(state,op,usage)=>{
          if(op?.status!=='pending')return {value:replay(op,hash,state)??fail(409,'outcome_unknown','結果を確認できませんでした。')};
          usage.global.leases=usage.global.leases.filter(l=>l.key!==`${uid}/${raw.requestId}`);const ownsLease=state.chatLease?.id===raw.requestId;if(ownsLease)state.chatLease=null;
          let outcome=generated,appendMessages=false;
          if(!ownsLease||state.revision!==baseRevision)outcome=fail(409,'context_changed','別の端末で記録が変わりました。入力を残してあるので、もう一度聞かせてね。');
          if(outcome.status===200){
            const applied=applyInterpretation(state.progress,{requestId:raw.requestId,actions:outcome.body.actions,text,reply:outcome.body.reply,today:dayKey(turnTime),at:new Date(turnTime).toISOString()},state.legacy);
            state.progress=applied.progress;state.revision++;state.messageCounter++;state.conversation=appendExchange(state.conversation,text,applied.reply,new Date(turnTime).toISOString(),applied.receipts);appendMessages=true;
            outcome={status:200,body:{requestId:raw.requestId,reply:applied.reply,receipts:applied.receipts,actions:[],...packet(state)}};
          }
          const {state:ignored,...storedResult}=outcome.body;
          return {state,appendMessages,usage,operation:{...op,status:'complete',httpStatus:outcome.status,result:storedResult},value:outcome};
        },{quota:true,now:now()});send(res,result.status,result.body);return true;
      }
      throw problem(404,'not_found','見つかりませんでした。');
    }catch(error){const result=known(error);send(res,result.status,result.body);}return true;
  };
}
