/** A Dirichlet prior on party shares, with a multinomial allocation of seats.
 * Party and coalition marginals are beta-binomial; no simulation is necessary.
 */
type PartyInput = { id: string; buckets: { low: number; high: number; probability: number }[] };
export type DirichletPartyFit = {
  id: string;
  alpha: number;
  share: number;
  probabilities: number[];
  residuals: number[];
};
export type DirichletFit = {
  model: "dirichlet-multinomial-v1";
  totalSeats: number;
  concentration: number;
  parties: DirichletPartyFit[];
  squaredError: number;
  rmse: number;
  maxError: number;
  converged: boolean;
  warnings: string[];
};

/** Evaluate relative log masses, then normalize. This avoids gamma-function
 * cancellation at large concentration and underflow in the endpoint masses.
 * Zero shape parameters are supported as limits for empty/full coalitions.
 */
export function betaBinomial(totalSeats: number, alpha: number, beta: number): number[] {
  if (!Number.isInteger(totalSeats) || totalSeats < 0 || !Number.isFinite(alpha + beta) || alpha < 0 || beta < 0 || alpha + beta <= 0) {
    throw new Error("Invalid beta-binomial parameters");
  }
  const masses = Array(totalSeats + 1).fill(0) as number[];
  if (totalSeats === 0 || alpha === 0 || beta === 0) {
    masses[alpha === 0 ? 0 : totalSeats] = 1;
    return masses;
  }
  let maximum = 0;
  for (let k = 0; k < totalSeats; k++) {
    masses[k + 1] = masses[k] + Math.log((totalSeats - k) / (k + 1))
      + Math.log(alpha + k) - Math.log(beta + (totalSeats - k - 1));
    maximum = Math.max(maximum, masses[k + 1]);
  }
  let sum = 0;
  for (let k = 0; k <= totalSeats; k++) sum += masses[k] = Math.exp(masses[k] - maximum);
  return masses.map(p => p / sum);
}

const MIN_LOG_CONCENTRATION = Math.log(.01);
const MAX_LOG_CONCENTRATION = Math.log(1e6);

/** Deterministic bounded Nelder–Mead, with several concentration starts below. */
function minimize(initial: number[], loss: (point: number[]) => number) {
  const dimension = initial.length;
  const bound = (point: number[]) => point.map((x, i) => i === dimension - 1
    ? Math.max(MIN_LOG_CONCENTRATION, Math.min(MAX_LOG_CONCENTRATION, x))
    : Math.max(-16, Math.min(16, x)));
  const evaluate = (point: number[]) => { const x = bound(point); return { x, loss: loss(x) }; };
  const simplex = [evaluate(initial), ...initial.map((_, i) => evaluate(initial.map((x, j) => x + (i === j ? .3 : 0))))];
  let converged = false;
  for (let iteration = 0; iteration < 3500; iteration++) {
    simplex.sort((a, b) => a.loss - b.loss);
    const best = simplex[0], worst = simplex[dimension];
    if (worst.loss - best.loss < 1e-12 && simplex.every(p => p.x.every((x, j) => Math.abs(x - best.x[j]) < 1e-6))) {
      converged = true;
      break;
    }
    const center = initial.map((_, j) => simplex.slice(0, dimension).reduce((sum, p) => sum + p.x[j], 0) / dimension);
    const reflected = evaluate(center.map((x, j) => 2 * x - worst.x[j]));
    if (reflected.loss < best.loss) {
      const expanded = evaluate(center.map((x, j) => x + 2 * (reflected.x[j] - x)));
      simplex[dimension] = expanded.loss < reflected.loss ? expanded : reflected;
    } else if (reflected.loss < simplex[dimension - 1].loss) {
      simplex[dimension] = reflected;
    } else {
      const outside = reflected.loss < worst.loss;
      const endpoint = outside ? reflected : worst;
      const contracted = evaluate(center.map((x, j) => x + .5 * (endpoint.x[j] - x)));
      if (contracted.loss < endpoint.loss) simplex[dimension] = contracted;
      else for (let i = 1; i <= dimension; i++) simplex[i] = evaluate(simplex[i].x.map((x, j) => (x + best.x[j]) / 2));
    }
  }
  simplex.sort((a, b) => a.loss - b.loss);
  return { ...simplex[0], converged };
}

/** Fit all parties together to normalized bracket probabilities by unweighted
 * least squares. Prices are calibration targets, not observed vote counts.
 * Log-ratios parameterize shares; a separate concentration controls dispersion.
 */
export function fitDirichlet(parties: PartyInput[], totalSeats = 120): DirichletFit {
  if (!Number.isInteger(totalSeats) || totalSeats < 1 || parties.length < 2 || new Set(parties.map(p => p.id)).size !== parties.length) {
    throw new Error("A Dirichlet fit requires a positive seat total and at least two distinct parties");
  }
  // Canonical order makes the numerical fit invariant to catalog ordering.
  const ordered = [...parties].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const party of ordered) {
    let next = 0, probability = 0;
    for (const bucket of party.buckets) {
      if (!Number.isInteger(bucket.low) || !Number.isInteger(bucket.high) || bucket.low !== next || bucket.high < bucket.low || bucket.high > totalSeats || !Number.isFinite(bucket.probability) || bucket.probability < 0) {
        throw new Error(`Invalid probability brackets for ${party.id}`);
      }
      next = bucket.high + 1;
      probability += bucket.probability;
    }
    if (next !== totalSeats + 1 || Math.abs(probability - 1) > 1e-8) throw new Error(`Incomplete or unnormalized brackets for ${party.id}`);
  }
  const decode = (point: number[]) => {
    const logits = [...point.slice(0, -1), 0];
    const maximum = Math.max(...logits);
    const weights = logits.map(x => Math.exp(x - maximum));
    const sum = weights.reduce((a, b) => a + b, 0);
    const concentration = Math.exp(point.at(-1)!);
    return { concentration, shares: weights.map(x => x / sum) };
  };
  const evaluate = (point: number[]) => {
    const { concentration, shares } = decode(point);
    return ordered.map((party, i) => {
      const alpha = concentration * shares[i];
      // Sum the complement explicitly to preserve tiny positive shapes.
      const beta = concentration * shares.reduce((sum, share, j) => sum + (i === j ? 0 : share), 0);
      const pmf = betaBinomial(totalSeats, alpha, beta);
      const probabilities = party.buckets.map(b => pmf.slice(b.low, b.high + 1).reduce((a, p) => a + p, 0));
      return { id: party.id, alpha, share: shares[i], probabilities, residuals: probabilities.map((p, j) => p - party.buckets[j].probability) };
    });
  };
  const loss = (point: number[]) => evaluate(point).reduce((sum, p) => sum + p.residuals.reduce((s, r) => s + r * r, 0), 0);
  // Midpoints seed the search only. Open tails use the neighboring bracket's
  // width for this seed; the objective always integrates their full support.
  const seeds = ordered.map(p => Math.max(.01, p.buckets.reduce((sum, b, i) => {
    const neighbor = p.buckets[i === 0 ? 1 : i - 1];
    const width = neighbor ? neighbor.high - neighbor.low + 1 : 1;
    const low = i === 0 ? Math.max(b.low, b.high - width + 1) : b.low;
    const high = i === p.buckets.length - 1 ? Math.min(b.high, b.low + width - 1) : b.high;
    return sum + b.probability * (low + high) / 2;
  }, 0)));
  const ratios = seeds.slice(0, -1).map(mean => Math.log(mean / seeds.at(-1)!));
  const candidates = [10, 100, 10000].map(concentration => minimize([...ratios, Math.log(concentration)], loss));
  const best = candidates.sort((a, b) => a.loss - b.loss)[0];
  const fitted = evaluate(best.x);
  const residuals = fitted.flatMap(p => p.residuals);
  const { concentration } = decode(best.x);
  const warnings: string[] = [];
  if (!best.converged) warnings.push("The parameter search did not converge. Treat the fit as approximate.");
  if (concentration >= 1e6 * .99) warnings.push("Concentration reached its upper search limit. The fit is near the multinomial limit; its concentration is not precisely identified.");
  if (concentration <= .01 * 1.01 || best.x.slice(0, -1).some(x => Math.abs(x) >= 15.99)) warnings.push("The fit reached a parameter search limit. Inspect the fitted bracket probabilities.");
  if (ordered.some(p => p.buckets.length === 1)) warnings.push("Some parties have no informative bracket boundaries; their parameters may not be identified by the prices.");
  return {
    model: "dirichlet-multinomial-v1", totalSeats, concentration, parties: fitted,
    squaredError: best.loss, rmse: Math.sqrt(best.loss / residuals.length),
    maxError: Math.max(...residuals.map(Math.abs)), converged: best.converged, warnings,
  };
}

/** Dirichlet aggregation: sum shapes within the coalition and its complement. */
export function dirichletCoalition(fit: DirichletFit, selected: string[]): number[] {
  const ids = new Set(selected);
  let alpha = 0, beta = 0;
  for (const party of fit.parties) {
    if (ids.has(party.id)) alpha += party.alpha;
    else beta += party.alpha;
  }
  return betaBinomial(fit.totalSeats, alpha, beta);
}
