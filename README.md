# Mandate — Knesset Coalition Lab

An interactive reconstruction of coalition seat distributions from 12 Polymarket Israeli election seat markets. Select any combination of parties, compare sample groupings, inspect source prices, and export the full result. Groupings are editable examples, not assertions about coalition commitments.

## Run locally

Requires Node 22.13+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Use the Local URL printed by the development server. No Polymarket API key is required. The page reads a saved JSON batch. A scheduled Cloud Run job fetches Polymarket every 20 minutes; opening the site does not invoke the backend. The displayed “Last updated on” timestamp is the last successful batch time. A failed refresh preserves the previous batch and timestamp.

```sh
npm test
npm run typecheck
npm run build
```

## Google Cloud deployment

Project: `personal-383909`. Region: `europe-west1`. Custom hostname:
`poly2026poll.kanhar.art`.

- **Static frontend:** Next.js exports HTML, CSS, and JavaScript into `out/`, served by Firebase Hosting (`personal-383909-coalition`). There is no production web server or dynamic API route.
- **Saved data:** `https://storage.googleapis.com/personal-383909-coalition-data/markets.json`. The dedicated bucket contains only public market data and permits cross-origin GET requests.
- **Scheduled backend:** Cloud Run job `coalition-market-refresh`, invoked by Cloud Scheduler at `*/20 * * * *` UTC. One task fetches all 12 markets, validates them, and atomically replaces the JSON object. It exits after publishing; no container stays running between scheduled executions. A failed batch leaves the old data and timestamp intact.
- **Identity:** the job can write only to its data bucket; the scheduler identity can invoke only this job. No service-account keys or application secrets are required.

Deploy or update the scheduled job (requires gcloud authentication and enabled billing):

```sh
npm run deploy:gcloud -- personal-383909 europe-west1
```

Build and deploy the static frontend using the same gcloud login:

```sh
NEXT_PUBLIC_MARKETS_URL=https://storage.googleapis.com/personal-383909-coalition-data/markets.json npm run build:cloud
npm run deploy:hosting
```

The Hosting helper uploads the static files and prints the HTTPS URL and exact
DNS records for `poly2026poll.kanhar.art`. Add those records at your DNS provider;
Firebase provisions the certificate. The live static URL is
[personal-383909-coalition.web.app](https://personal-383909-coalition.web.app).
It works before custom DNS is connected. Hosting tokens stay in memory and are
never written to the repo.

The domain setup currently requires this record in the `kanhar.art` DNS zone:

| Type | Name | Target |
| --- | --- | --- |
| CNAME | `poly2026poll` | `personal-383909-coalition.web.app` |

The job container uses Node 24 with no installed npm dependencies. It has one
CPU, 512 MiB RAM, a 60-second timeout, and no automatic retries. Cloud Run Jobs
bill per execution with a minimum billable duration, so a short fetch does not
mean zero cost; there is no idle web-server charge. Cloud Scheduler, storage,
builds, and hosting follow their own quotas and billing.

Run a manual refresh or inspect its logs:

```sh
gcloud run jobs execute coalition-market-refresh --project=personal-383909 --region=europe-west1 --wait
gcloud run jobs logs read coalition-market-refresh --project=personal-383909 --region=europe-west1 --limit=30
```

Local development uses the bundled snapshot via `public/markets.json`. Set
`NEXT_PUBLIC_MARKETS_URL` to use the deployed data file locally. The “Check for
updates” button reloads the saved file; it never triggers a Polymarket fetch.

References: [Firebase static deployments](https://firebase.google.com/docs/hosting/api-deploy),
[scheduled Cloud Run jobs](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule).

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
- `scripts/refresh-markets.mjs` publishes complete validated batches. Invalid prices, missing brackets, and overlapping ranges fail the job without overwriting the last good batch. The UI retains the displayed data and timestamp if the saved file cannot be loaded.
- Shared URLs encode party selection, model identifier, and threshold. They load the latest saved batch on opening. Legacy tail parameters are removed because the joint model fits full bracket masses directly. Downloaded JSON includes the data batch, assumptions, fitted α parameters, concentration, fit diagnostics and all probabilities for reproducibility.
- Prices are market inputs, not calibrated probabilities. Normalization does not correct spreads, stale quotes or low liquidity.

Primary sources: [Polymarket Likud seat market](https://polymarket.com/event/israel-election-likud-of-seats), [public data documentation](https://docs.polymarket.com/market-data/discover-markets). Every party has a source link and resolution rules in the app.

## Implementation

React with a static Next.js export for Google Cloud hosting; the original Vinext local/Sites tooling remains available. The pure probability model runs in the browser and has no network dependencies. A separate scheduled Node.js job refreshes the public market JSON. No database, trading, or wallet integration is used.
