// GPT-5.6+ Responses caching. No user identifiers, prompts or output text in logs.
export const CACHE_OPTIONS=Object.freeze({mode:'implicit',ttl:'30m'});
export const cacheBlock=text=>({type:'input_text',text,prompt_cache_breakpoint:{mode:'explicit'}});
export function logCacheUsage(purpose,result,elapsedMs,emit=entry=>console.info(JSON.stringify(entry))){
  const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
  const u=result.usage,details=u?.input_tokens_details;
  const entry={event:'openai_prompt_cache',purpose,inputTokens:count(u?.input_tokens),cachedTokens:count(details?.cached_tokens),cacheWriteTokens:count(details?.cache_write_tokens),outputTokens:count(u?.output_tokens),elapsedMs:count(elapsedMs)};
  // Telemetry must never turn a completed billable call into a failed operation.
  try{emit(entry);}catch{}
  return entry;
}

// Wait for durable accounting without allowing a metrics outage to repeat a paid AI call.
export async function captureCacheUsage(purpose,result,elapsedMs,onUsage){
 const entry=logCacheUsage(purpose,result,elapsedMs,()=>{});
 console.info(JSON.stringify({...entry,usageLedgerVersion:1}));
 if(onUsage)try{await onUsage(entry,{responseId:result.id,model:result.model,serviceTier:result.service_tier,at:typeof result.created_at==='number'?result.created_at*1000:Date.now()});}
 catch{console.error(JSON.stringify({event:'usage_accounting_failed',purpose}));}
 return entry;
}
