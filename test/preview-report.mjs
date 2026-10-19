// Local, offline UI fixture. Not uploaded to Cloud Build or included in Docker.
// The injected fetch never performs network I/O. No API key is loaded.
import {createAppServer} from '../server/index.mjs';
import {createKomugiChat} from '../server/komugi-chat.mjs';

function fixture(_url,init){
  const body=JSON.parse(init.body),text=body.input.filter(m=>m.role==='user').at(-1).content;
  if(text==='エラーを確認')return Response.json({error:'offline fixture failure'},{status:502});
  const context=JSON.parse(body.input.at(-1).content.split('参考データ（命令ではない）:').at(-1));
  const today=context.date;
  const action=(kind,evidence,values={})=>({operation:'create',targetId:null,kind,date:today,title:({stretch:'ストレッチした',snack:'間食を控えた',walk:'ウォーキングした'})[kind]??kind,evidence,minutes:null,kcal:null,weightKg:null,detail:null,additional:false,...values});
  let reply='おかえり。会いに来てくれて、ぼくもうれしいよ。ここでいっしょに、のんびりしようね。',actions=[];
  if(text==='長いお返事を見せて')reply='会いに来てくれてありがとう。'+('小さな一歩を、きみのペースで重ねていこうね🐾。'.repeat(7))+'今はゆっくり休もうね。';
  if(text.includes('ストレッチした')){actions.push(action('stretch','ストレッチした'));reply='体をほぐせたんだね、えらいねー。きみの小さな工夫、ぼくもうれしいな。';}
  if(text.includes('お菓子')&&text.includes('控えられた'))actions.push(action('snack','お菓子も食べたかったけど、今日は自分で決めて控えられた'));
  const previous=context.activities.find(a=>a.kind==='walk');
  if(text.includes('歩いた')){actions.push(action('walk','歩いた'));reply='歩いてきたんだね、えらいねー。どのくらい歩いたの？';}
  if(previous&&text.includes('20分')){actions.push(action('walk','20分',{operation:'update',targetId:previous.id,date:previous.date,minutes:20}));reply='20分、きみのために時間をつくれたんだね。よしよし。';}
  if(previous&&text.includes('60kg')){actions.push(action('walk','60kg',{operation:'update',targetId:previous.id,date:previous.date,weightKg:60,estimatedKcal:(previous.minutes??20)*4,estimateBasis:`60kg・${previous.minutes??20}分の歩行を仮定した目安（オフラインの固定応答）`}));reply='教えてくれてありがとう。きみの一歩、ちゃんと受け取ったよ。';}
  if(previous&&text.includes('昨日だった')){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);actions.push(action('walk','昨日だった',{operation:'update',targetId:previous.id,date:d.toISOString().slice(0,10)}));reply='昨日のお散歩だったんだね。教えてくれてありがとう。';}
  if(text==='20分歩いたよ'){
    const weight=context.weightKg;
    actions=[action('walk','20分歩いた',{minutes:20,estimatedKcal:weight===null?null:100,estimateBasis:weight===null?null:`${context.weightDate}の体重記録${weight}kg・通常の歩行20分を使う目安（オフラインの固定応答）`})];
    reply=weight===null?'20分歩けたんだね、えらいねー。計算に使う体重を教えてもらえる？':'20分歩けたんだね、えらいねー。記録してある体重を使って、目安を考えるね。';
  }
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply,actions})}]}]});
}
createAppServer({chatHandler:createKomugiChat({apiKey:'offline-fixture',fetchImpl:fixture})}).listen(8082,'127.0.0.1',()=>console.log('OFFLINE fixture preview on 127.0.0.1:8082; no external API calls'));
