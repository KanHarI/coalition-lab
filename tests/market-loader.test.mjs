import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMarketLoader } from '../lib/market-loader.ts';
import { parseEvent } from '../lib/model.ts';
const snapshot=JSON.parse(readFileSync(new URL('../data/snapshot.json',import.meta.url)));
const fallback={parties:snapshot.events.map(parseEvent),fetchedAt:snapshot.fetchedAt,source:'snapshot'};
const slugs=snapshot.events.map(e=>e.slug);

test('a complete batch is cached for five minutes; concurrent refreshes are deduplicated',async()=>{
  let calls=0, now=Date.parse('2026-10-21T18:00:00Z');
  const loader=createMarketLoader(fallback,slugs,async url=>{ calls++;return Response.json(snapshot.events.find(e=>url.endsWith(e.slug))); },()=>now);
  const [a,b]=await Promise.all([loader(),loader()]);
  assert.equal(calls,12); assert.deepEqual(a,b);assert.equal(a.source,'live');
  now+=299999;await loader();assert.equal(calls,12);
  now+=2;await loader();assert.equal(calls,24);
});

test('one failed event causes a complete snapshot fallback, never mixed timestamps',async()=>{
  const loader=createMarketLoader(fallback,slugs,async url=>url.endsWith(slugs[0])?new Response('Unavailable',{status:503}):Response.json(snapshot.events.find(e=>url.endsWith(e.slug))));
  const result=await loader();assert.equal(result.source,'snapshot');
  assert.equal(result.fetchedAt,fallback.fetchedAt);assert.deepEqual(result.parties,fallback.parties);assert.ok(result.warning);
});

test('refresh failure retains the last successful batch and its original timestamp',async()=>{
  let failed=false,now=Date.parse('2026-10-21T18:00:00Z');
  const loader=createMarketLoader(fallback,slugs,async url=>{if(failed)throw new Error('offline');return Response.json(snapshot.events.find(e=>url.endsWith(e.slug)));},()=>now);
  const live=await loader();failed=true;now+=300001;const stale=await loader();
  assert.equal(stale.source,'snapshot');assert.equal(stale.fetchedAt,live.fetchedAt);assert.deepEqual(stale.parties,live.parties);
});

test('malformed upstream prices trigger fallback, followed by successful recovery',async()=>{
  let bad=true;
  const loader=createMarketLoader(fallback,slugs,async url=>{const event=structuredClone(snapshot.events.find(e=>url.endsWith(e.slug)));if(bad)event.markets[0].outcomePrices='[null,null]';return Response.json(event);});
  assert.equal((await loader()).source,'snapshot');bad=false;assert.equal((await loader()).source,'live');
});
