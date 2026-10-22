import { readFileSync, writeFileSync } from 'node:fs';
import { parseEvent, sortParties } from '../lib/model.ts';

const snapshot = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
writeFileSync(new URL('../public/markets.json', import.meta.url), JSON.stringify({
  parties: sortParties(snapshot.events.map(parseEvent)),
  fetchedAt: snapshot.fetchedAt,
  source: 'snapshot',
}));
