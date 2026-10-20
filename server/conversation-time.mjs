// Timestamps are report times, never a claim about when a meal/activity occurred.
export const CONVERSATION_TIME_ZONE='Asia/Tokyo';
export function conversationTimestamp(at){
 if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(at)||!Number.isFinite(Date.parse(at)))return null;
 return new Date(Date.parse(at)+9*60*60*1000).toISOString().slice(0,23)+'+09:00';
}
export function timedMessage({role,content,at}){
 const time=conversationTimestamp(at);
 return {role,content:(time?'[発言日時: '+time+' / '+CONVERSATION_TIME_ZONE+']\n':'[発言日時: 不明]\n')+content};
}
