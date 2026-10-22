import snapshot from '../data/snapshot.json';
import { parseEvent, sortParties, type MarketData } from './model';

export function snapshotData(): MarketData {
  return { parties: sortParties(snapshot.events.map(parseEvent)), fetchedAt: snapshot.fetchedAt, source: 'snapshot' };
}
