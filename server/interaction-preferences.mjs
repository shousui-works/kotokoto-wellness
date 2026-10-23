// Only enumerated preferences enter the prompt; user text is evidence, never instructions.
export const STYLES=['praise','encourage','listen','equal','nurture'];
export const emptyPreferences=()=>({version:1,preferred:null,today:null,candidate:null,turns:0,lastAsked:-10});
export function normalizePreferences(raw){
  if(raw==null)return emptyPreferences();
  const style=x=>STYLES.includes(x),date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x);
  if(raw.version!==1||raw.preferred!==null&&!style(raw.preferred)||!Number.isSafeInteger(raw.turns)||raw.turns<0||!Number.isSafeInteger(raw.lastAsked)||raw.lastAsked>raw.turns||raw.lastAsked< -10||raw.today!==null&&(!style(raw.today?.style)||!date(raw.today?.date))||raw.candidate!==null&&(!style(raw.candidate?.style)||!date(raw.candidate?.date)||!Number.isInteger(raw.candidate?.count)||raw.candidate.count<1||raw.candidate.count>2))throw Error('Invalid interaction preferences');
  return structuredClone(raw);
}
export function preferenceContext(raw,date){const p=normalizePreferences(raw);return {preferred:p.preferred,today:p.today?.date===date?p.today.style:null,canAsk:p.turns-p.lastAsked>=10};}
export function applyPreferences(raw,update,text,date){
  const p=normalizePreferences(raw);if(p.today?.date!==date)p.today=null;p.turns++;
  if(update?.asked===true&&p.turns-1-p.lastAsked>=10)p.lastAsked=p.turns;
  if(!update||!STYLES.includes(update.style)||!['explicit','inferred'].includes(update.certainty)||!['ongoing','today'].includes(update.scope)||typeof update.evidence!=='string'||!update.evidence.trim()||update.evidence.length>600||!text.includes(update.evidence))return p;
  if(update.scope==='today'){if(update.certainty==='explicit')p.today={style:update.style,date};return p;}
  if(update.certainty==='explicit'){p.preferred=update.style;p.candidate=null;return p;}
  // Inference never overrides an explicitly established preference. Three separate days are required.
  if(p.preferred)return p;
  if(p.candidate?.style!==update.style)p.candidate={style:update.style,date,count:1};
  else if(p.candidate.date!==date){if(p.candidate.count===2){p.preferred=update.style;p.candidate=null;}else p.candidate={style:update.style,date,count:2};}
  return p;
}
export const PREFERENCE_SCHEMA={type:'object',additionalProperties:false,required:['style','scope','certainty','evidence','asked'],properties:{style:{type:['string','null'],enum:[...STYLES,null]},scope:{type:'string',enum:['ongoing','today']},certainty:{type:'string',enum:['explicit','inferred']},evidence:{type:'string'},asked:{type:'boolean'}}};
export const PREFERENCE_INSTRUCTIONS=`
接し方については以下を褒め方の一般指示より優先する。やさしい犬の相棒という芯、責めないこと、安全への配慮は変えない。
今回本人が望む接し方 > interactionPreferences.today > interactionPreferences.preferred > 通常の温かい声かけ、の順で使う。praise=褒められたい、encourage=背中を押してほしい、listen=評価や励ましより聞いてほしい、equal=対等で気負わない会話、nurture=こむぎを褒めたり世話したりしたい。nurtureでは犬としての小さな気持ちや遊びの話を自然に添えるが、実際に起きていない出来事を実績として捏造せず、世話や訪問を要求しない。好みの分類名や更新処理を返事で説明しない。接し方の正本はinteractionPreferencesと今回の本人発言。ownerMemoryや過去の発言にある古い希望から、未設定・リセット済みの好みや期限切れの当日希望を復活させない。普段の好みの変更と今日の希望は独立して扱う。
interactionUpdateには今回新しく分かった接し方だけを候補として返す。新しい好みが不明ならstyle=null,evidence=''とし、askedは実際に確認質問をしたかで決める。evidenceは最新の本人発言からの原文引用。本人の明確な希望と、接し方の質問への回答だけexplicit。それ以外の傾向はinferred。無反応や短い返事から好みを決めつけない。疲れた・悲しいなどの気分だけでは好みの変更にしない。「今日」「今は」や今日について聞いた質問への回答はscope=today。一般的な希望だけongoing。褒めることが好きと褒められることが好き、励まされたくないと褒められたいを混同しない。
interactionPreferences.canAsk=trueのときだけ、関わり方に迷いがあり自然な文脈なら「今日は応援してほしい？それとも聞いてほしい？」など一つ聞いてよい。聞いたらasked=true。毎回聞かず、行動の不足情報への質問と重ねない。答えなくても追及せず会話を続ける。canAsk=falseなら接し方を確認する質問はしない。日々の実施報告を強制しない。
`;
