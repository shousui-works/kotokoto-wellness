// Offline meal responses shared by the account preview and its regression test.
import {extractReport} from '../server/komugi-chat.mjs';

export function mealTextFixture(input){
  const text=input.messages.at(-1).content;
  if(!['朝ごはんにご飯を茶碗一杯食べたよ','朝ごはんのご飯は半分残したよ'].includes(text))return null;
  const half=text.includes('半分');
  const targets=(input.context.activities??[]).filter(a=>a.kind==='meal_log'&&a.date===input.context.date&&a.intake?.mealType==='breakfast');
  if(half&&targets.length!==1)return {status:200,body:{reply:'半分残したのは、どの朝ごはんか教えてもらえる？',actions:[]}};
  const item={name:'白いご飯',portion:half?'茶碗半分、約75gと仮定':'茶碗1杯、約150gと仮定',kcal:half?117:234};
  const action={operation:half?'update':'create',targetId:half?targets[0].id:null,kind:'meal_log',date:input.context.date,title:'朝ごはん',evidence:text,minutes:null,kcal:null,estimatedKcal:null,estimateBasis:null,weightKg:null,detail:'朝食：白いご飯 '+item.portion,additional:false,mealIntake:{source:'text',mealType:'breakfast',items:[item],basis:'架空のUI検証用。一般的な茶碗の量を仮定した固定の目安。'}};
  const report=extractReport({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:half?'半分残したんだね。食べた量を教えてくれてありがとう。':'朝ごはんを食べたんだね。',actions:[action]})}]}]},input);
  return report?{status:200,body:report}:{status:502,body:{error:{message:'Offline fixture validation failed'}}};
}
