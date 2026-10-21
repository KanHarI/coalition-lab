# Mandate — Knesset Coalition Lab

An interactive reconstruction of coalition seat distributions from 12 Polymarket Israeli election seat markets. Select any combination of parties, compare sample groupings, inspect source prices, and export the full result. Groupings are editable examples, not assertions about coalition commitments.

## Run locally

Requires Node 22.13+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Use the Local URL printed by the development server. No Polymarket API key is required. The app fetches the configured public events server-side every five minutes while it is open. Its dated snapshot is available immediately and remains available if upstream fetches fail. There is no scheduled background refresh.

```sh
npm test
npm run typecheck
npm run build
```

## Model

1. Read each bracket's `Yes` outcome price by label, then divide all of a party's prices by their sum.
2. Spread each bracket's normalized mass uniformly over its integer support. Default open brackets span their full logical range: e.g. Likud `<20` is 0–19, `35+` is 35–120. This can produce implausibly long tails and is explicitly disclosed.
3. An optional sensitivity mode narrows each open bracket to the width of the adjacent bounded bracket, preserving its probability mass. Lower brackets whose upper bound is below four retain 0 as their lower endpoint. This is an extra assumption, not market-derived information.
4. Combine selected party distributions by exact discrete convolution. All cross-party covariances are zero. The empty coalition has probability one at zero seats.
5. Report the mean, equal-tailed 90% interval, and probability of at least the selected threshold (61 by default). These are model probabilities, not government-formation forecasts.

**Independence does not enforce a total of 120 seats.** Counts are not clipped or rescaled; totals above 120 remain in every summary. The methodology page reports the aggregate inconsistency. The chart limits its visible upper axis at approximately the 99.5th percentile and labels omitted mass; exported results retain the entire support. The model does not simulate the electoral threshold, surplus-vote agreements, or official seat-allocation mechanics, and may assign mass to 1–3 seats.

Replace `independentModel` through the `DependenceModel` interface in `lib/model.ts` to introduce a different joint model later. A fixed-total conditional model would introduce dependence and generally change the original marginals. A covariance matrix alone would not uniquely identify the full joint distribution.

## Data and reproducibility

- `data/market-slugs.json` is the explicit party catalog. Live refresh updates these events, not catalog membership. Check merger/joint-list rules before adding events to avoid double counting.
- `data/snapshot.json` stores the public API payload and retrieval time. Refresh it with `npm run refresh:snapshot` (Python 3 and curl).
- `lib/markets.ts` uses a five-minute cache and all-or-nothing batches. Invalid prices, missing brackets, and overlapping ranges cause fallback to the last complete batch (or bundled snapshot). The UI preserves its retrieval time and labels it as a snapshot.
- Shared URLs encode party selection, tail mode, and threshold. They use current prices on opening. Downloaded JSON includes the data batch, assumptions, effective supports and all probabilities for reproducibility.
- Prices are market inputs, not calibrated probabilities. Normalization does not correct spreads, stale quotes or low liquidity.

Primary sources: [Polymarket Likud seat market](https://polymarket.com/event/israel-election-likud-of-seats), [public data documentation](https://docs.polymarket.com/market-data/discover-markets). Every party has a source link and resolution rules in the app.

## Implementation

Vinext / React on the Sites Cloudflare Workers runtime. `app/api/markets/route.ts` proxies public market data; the pure probability model has no UI or network dependencies. No database, account credentials, trading or wallet integration is used. Sites identity lives in `.openai/hosting.json`.
