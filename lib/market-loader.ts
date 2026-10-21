import { parseEvent, sortParties, type MarketData } from './model.ts';

/** Injected transport/clock keep all-or-nothing refresh and fallback behavior testable. */
export function createMarketLoader(fallback: MarketData, slugs: string[], fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { data: MarketData; expires: number } | undefined;
  let pending: Promise<MarketData> | undefined;
  return async function getMarkets(): Promise<MarketData> {
    if (cached && now() < cached.expires) return cached.data;
    if (pending) return pending;
    pending = (async () => {
      try {
        const parties = await Promise.all(slugs.map(async slug => {
          const response = await fetcher(`https://gamma-api.polymarket.com/events/slug/${slug}`, {
            headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
          const event = await response.json() as { slug?: string };
          if (event.slug !== slug) throw new Error('Unexpected event returned');
          return parseEvent(event);
        }));
        const data: MarketData = { parties: sortParties(parties), fetchedAt: new Date(now()).toISOString(), source: 'live' };
        cached = { data, expires: now() + 300000 };
        return data;
      } catch {
        return cached
          ? { ...cached.data, source: 'snapshot', warning: 'Refresh failed. Showing the last complete batch; its original retrieval time is retained.' }
          : { ...fallback, source: 'snapshot', warning: 'Live prices could not be retrieved. Showing the bundled, dated market snapshot.' };
      } finally { pending = undefined; }
    })();
    return pending;
  };
}
