import snapshot from '../data/snapshot.json';
import slugs from '../data/market-slugs.json';
import { parseEvent, sortParties, type MarketData } from './model';
import { createMarketLoader } from './market-loader';

export function snapshotData(): MarketData {
  return { parties: sortParties(snapshot.events.map(parseEvent)), fetchedAt: snapshot.fetchedAt, source: 'snapshot' };
}

export const getMarkets = createMarketLoader(snapshotData(), slugs);
