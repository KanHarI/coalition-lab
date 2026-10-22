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
2. Fit one **Dirichlet distribution over party shares**, `p ~ Dirichlet(α)`, jointly to all normalized bracket probabilities. The parameters determine both mean shares (`αᵢ / Σα`) and their dispersion (concentration `Σα`). Prices are calibration targets, not multinomial observations or vote counts.
3. Allocate the fixed parliament conditionally: `Seats | p ~ Multinomial(120, p)`. Integrating out `p` gives the **Dirichlet–multinomial** seat distribution. Every joint outcome totals exactly 120; party seat counts have negative covariance.
4. For a selected coalition, sum its parameters into `A` and the remaining parties' parameters into `B`. Its seat total is exactly `BetaBinomial(120, A, B)`. Empty and full coalitions are point masses at 0 and 120, respectively. No Monte Carlo sampling is used.
5. Report the mean, equal-tailed 90% interval, and probability of at least the selected threshold (61 by default). These are model probabilities, not government-formation forecasts.

`lib/dirichlet.ts` fits the parameters by unweighted least squares on **bracket masses**, using deterministic multistart Nelder–Mead in share log-ratios and log concentration. Open brackets retain their full integer bounds, including 0 and 120. Bracket midpoints only initialize the search; no uniform-within-bracket assumption enters the fitted probabilities. Concentration is searched over `[0.01, 1,000,000]`, and share log-ratios over `[-16, 16]`. Search limits and incomplete convergence produce visible warnings. The numerical search is approximate and does not guarantee a global optimum.

Party marginals are beta-binomial. The model evaluates their masses in log space and sums them over each bracket for calibration. A single joint distribution generally cannot reproduce every market probability: the UI and export include fitted bracket probabilities, residuals, RMSE and maximum error. The bundled snapshot reaches the upper concentration limit, approaching the multinomial model; this limit is disclosed rather than interpreted as a precisely estimated concentration. Dirichlet mixing can increase dispersion above a multinomial, but cannot explain narrower marginals.

**The tracked lists are assumed to be disjoint and exhaustive.** No untracked “other” category is inferred. Merger and joint-list market rules must be checked against that assumption. The model does not simulate the electoral threshold, surplus-vote agreements, or official seat-allocation mechanics, and may assign mass to 1–3 seats. Expected seats add across parties; variances do not, because parties share a fixed total.

The chart shows up to approximately the 99.5th percentile, capped at 120, and labels omitted mass; summaries and exports retain the full 0–120 support. Model references: [SciPy Dirichlet–multinomial](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.dirichlet_multinomial.html), [beta-binomial formula](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.betabinom.html).

## Data and reproducibility

- `data/market-slugs.json` is the explicit party catalog. Live refresh updates these events, not catalog membership. Check merger/joint-list rules before adding events to avoid double counting.
- `data/snapshot.json` stores the public API payload and retrieval time. Refresh it with `npm run refresh:snapshot` (Python 3 and curl).
- `lib/markets.ts` uses a five-minute cache and all-or-nothing batches. Invalid prices, missing brackets, and overlapping ranges cause fallback to the last complete batch (or bundled snapshot). The UI preserves its retrieval time and labels it as a snapshot.
- Shared URLs encode party selection, model identifier, and threshold. They use current prices on opening. Legacy tail parameters are removed because the joint model fits full bracket masses directly. Downloaded JSON includes the data batch, assumptions, fitted α parameters, concentration, fit diagnostics and all probabilities for reproducibility.
- Prices are market inputs, not calibrated probabilities. Normalization does not correct spreads, stale quotes or low liquidity.

Primary sources: [Polymarket Likud seat market](https://polymarket.com/event/israel-election-likud-of-seats), [public data documentation](https://docs.polymarket.com/market-data/discover-markets). Every party has a source link and resolution rules in the app.

## Implementation

Vinext / React on the Sites Cloudflare Workers runtime. `app/api/markets/route.ts` proxies public market data; the pure probability model has no UI or network dependencies. No database, account credentials, trading or wallet integration is used. Sites identity lives in `.openai/hosting.json`.
