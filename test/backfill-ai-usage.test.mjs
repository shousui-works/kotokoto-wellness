import test from 'node:test';
import assert from 'node:assert/strict';
import {backfillArgs} from '../scripts/backfill-ai-usage.mjs';
const range={project:'kotokoto-biyori',from:'2020-01-01T00:00:00Z',to:'2020-02-01T00:00:00Z'};

test('backfill requests the explicit historical range instead of the implicit last day',()=>{
 const args=backfillArgs(range),filter=args[2];
 assert.deepEqual(args.slice(0,2),['logging','read']);
 assert.ok(filter.includes('timestamp>="'+range.from+'"'));
 assert.ok(filter.includes('timestamp<"'+range.to+'"'));
 assert.ok(filter.includes('NOT jsonPayload.usageLedgerVersion:*'));
 assert.ok(filter.includes('jsonPayload.event="openai_prompt_cache"'));
 assert.deepEqual(args.slice(3),['--project','kotokoto-biyori','--limit','5000','--format=json']);
});

test('backfill rejects missing bounds, invalid dates and unexpected projects before any external work',()=>{
 for(const change of [{project:'other-project'},{from:undefined},{to:undefined},{from:range.to},{from:'2021-01-01T00:00:00Z'},{from:'2020-02-30T00:00:00Z'},{from:'2020-01-01'},{from:'2020-01-01T00:00:00Z" OR severity>=INFO'}]){
  assert.throws(()=>backfillArgs({...range,...change}),/required|Explicit/);
 }
});

test('backfill accepts precise UTC bounds without changing their half-open interval',()=>{
 const from='2020-01-01T00:00:00.123Z',to='2020-01-01T00:00:00.124Z';
 const filter=backfillArgs({...range,from,to})[2];
 assert.ok(filter.includes('timestamp>="'+from+'"'));
 assert.ok(filter.includes('timestamp<"'+to+'"'));
});
