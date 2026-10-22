import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseEvent, sortParties } from '../lib/model.ts';

const slugs = JSON.parse(readFileSync(new URL('../data/market-slugs.json', import.meta.url)));

/** Publish only a complete, validated batch. A failed fetch leaves the last
 * successful object and its timestamp untouched. */
export async function refreshMarkets(publish, fetcher = fetch, now = () => new Date()) {
  const parties = await Promise.all(slugs.map(async slug => {
    const response = await fetcher(`https://gamma-api.polymarket.com/events/slug/${slug}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Market ${slug}: HTTP ${response.status}`);
    const event = await response.json();
    if (event.slug !== slug) throw new Error(`Unexpected market returned for ${slug}`);
    return parseEvent(event);
  }));
  const data = { parties: sortParties(parties), fetchedAt: now().toISOString(), source: 'live' };
  await publish(data);
  return data;
}

async function publishToStorage(data) {
  const bucket = process.env.DATA_BUCKET;
  if (!bucket) throw new Error('DATA_BUCKET is required');
  const credentials = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(10000),
  });
  if (!credentials.ok) throw new Error(`Runtime identity: HTTP ${credentials.status}`);
  const { access_token: token } = await credentials.json();
  const boundary = randomUUID();
  const metadata = JSON.stringify({ name: 'markets.json', contentType: 'application/json', cacheControl: 'public,max-age=60' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--\r\n`;
  const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Snapshot upload: HTTP ${response.status}: ${await response.text()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2] === '--output' ? process.argv[3] : null;
  const data = await refreshMarkets(output
    ? async data => writeFileSync(output, JSON.stringify(data))
    : publishToStorage);
  console.log(`Published ${data.parties.length} parties; last updated on ${data.fetchedAt}`);
}
