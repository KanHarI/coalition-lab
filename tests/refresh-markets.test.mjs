import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refreshMarkets } from '../scripts/refresh-markets.mjs';

const snapshot = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
const fetcher = async url => Response.json(snapshot.events.find(e => url.endsWith(e.slug)));

test('scheduled refresh publishes one complete batch with the actual successful fetch timestamp', async () => {
  const writes = [];
  const now = new Date('2026-10-22T09:20:00Z');
  const data = await refreshMarkets(async data => writes.push(data), fetcher, () => now);
  assert.equal(writes.length, 1);
  assert.equal(writes[0], data);
  assert.equal(data.parties.length, 12);
  assert.equal(data.fetchedAt, now.toISOString());
  assert.equal(data.source, 'live');
});

test('failed or malformed markets never overwrite the saved batch or timestamp', async () => {
  for (const broken of [
    async () => new Response('Unavailable', { status: 503 }),
    async () => Response.json({ slug: 'wrong-event', markets: [] }),
    async url => { const event = structuredClone(snapshot.events.find(e => url.endsWith(e.slug))); event.markets.pop(); return Response.json(event); },
  ]) {
    let writes = 0;
    await assert.rejects(refreshMarkets(async () => { writes++; }, async url => url.endsWith(snapshot.events[0].slug) ? broken(url) : fetcher(url)));
    assert.equal(writes, 0);
  }
});

test('storage failures fail the scheduled execution instead of reporting a successful refresh', async () => {
  await assert.rejects(refreshMarkets(async () => { throw new Error('Upload failed'); }, fetcher), /Upload failed/);
});
