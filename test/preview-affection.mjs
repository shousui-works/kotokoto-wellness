// Offline visual fixture; query score changes only the rendered affection, never saved data.
import {readFile} from 'node:fs/promises';import {createAppServer} from '../server/index.mjs';import {createKomugiChat} from '../server/komugi-chat.mjs';
const chatHandler=createKomugiChat({apiKey:'offline-fixture',fetchImpl:async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'おかえり。会いに来てくれて、ぼくもうれしいな。そばでいっしょにのんびりしようね。',actions:[]})}]}]})});
createAppServer({chatHandler,accountHandler:async(req,res,path)=>{
 if(path!=='/app.mjs')return false;let source=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');source=source.replace('const affectionFor=s=>baseAffectionFor(s,progress?.companion);',"const affectionFor=s=>({...baseAffectionFor(s,progress?.companion),score:Number(new URLSearchParams(location.search).get('affection')??0)});");res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(source);return true;
}}).listen(8085,'127.0.0.1',()=>console.log('Offline affection fixture on 127.0.0.1:8085; synthetic replies only'));
