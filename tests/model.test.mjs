import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRange, parseEvent, fitPartyModel, partyDistribution, coalitionDistribution, summarize } from '../lib/model.ts';
const snapshot = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
const parties = snapshot.events.map(parseEvent);
const fit = fitPartyModel(parties);
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const sum = a => a.reduce((x, y) => x + y, 0);

test('range parsing supports exact seats, inclusive ranges and open tails', () => {
  assert.deepEqual(parseRange('<20'), { low: 0, high: 19, open: 'lower' });
  assert.deepEqual(parseRange('20–24'), { low: 20, high: 24, open: null });
  assert.deepEqual(parseRange('35+'), { low: 35, high: 120, open: 'upper' });
  assert.deepEqual(parseRange('4'), { low: 4, high: 4, open: null });
  for (const label of ['a lot', '122+', '9-8', '<0']) assert.throws(() => parseRange(label));
});

test('real market snapshot fits normalized, finite party marginals sharing 120 seats', () => {
  assert.equal(parties.length, 12);
  assert.equal(fit.model, 'dirichlet-multinomial-v1');
  const means = [];
  for (const party of parties) {
    close(sum(party.buckets.map(b => b.probability)), 1);
    const pmf = partyDistribution(fit, party.id);
    assert.equal(pmf.length, 121);
    close(sum(pmf), 1);
    assert.ok(pmf.every(p => Number.isFinite(p) && p >= 0));
    const fitted = fit.parties.find(p => p.id === party.id);
    assert.ok(fitted.alpha > 0);
    for (const [i, bucket] of party.buckets.entries()) {
      close(sum(pmf.slice(bucket.low, bucket.high + 1)), fitted.probabilities[i]);
      close(fitted.probabilities[i] - bucket.probability, fitted.residuals[i]);
    }
    means.push(summarize(pmf).mean);
  }
  close(sum(means), 120);
  close(sum(fit.parties.map(p => p.alpha)), fit.concentration, 1e-8);
  assert.ok(Number.isFinite(fit.rmse));
  assert.ok(fit.converged);
  assert.ok(fit.warnings.some(w => w.includes('multinomial limit')));
});

test('Yes price is found by outcome label, not position; zero is valid', () => {
  const event = structuredClone(snapshot.events[0]);
  for (const m of event.markets) { m.outcomes = '["No","Yes"]'; m.outcomePrices = '["0.7","0.3"]'; }
  const p = parseEvent(event);
  close(p.buckets[0].price, .3);
  event.markets[0].outcomePrices = '["1","0"]';
  assert.equal(parseEvent(event).buckets[0].probability, 0);
});

test('missing, nonfinite and invalid prices are rejected, not filled with zeros', () => {
  for (const value of ['[null,1]', '["",1]', '[-0.1,1]', '[1.1,0]', '["NaN",0]', '[true,0]']) {
    const event = structuredClone(snapshot.events[0]);
    event.markets[0].outcomePrices = value;
    assert.throws(() => parseEvent(event));
  }
  const event = structuredClone(snapshot.events[0]);
  event.markets.forEach(m => m.outcomePrices = '[0,1]');
  assert.throws(() => parseEvent(event));
});

test('incomplete and overlapping market partitions fail validation', () => {
  const event = structuredClone(snapshot.events[0]);
  event.markets.pop();
  assert.throws(() => parseEvent(event));
  const duplicate = structuredClone(snapshot.events[0]);
  duplicate.markets.push(duplicate.markets[0]);
  assert.throws(() => parseEvent(duplicate));
});

test('coalitions share a fixed 120 seats and include negative party covariance', () => {
  const all = coalitionDistribution(fit, parties.map(p => p.id));
  assert.equal(all.length, 121);
  assert.equal(all[120], 1);
  const stats = summarize(all);
  assert.equal(stats.mean, 120);
  assert.equal(stats.variance, 0);
  assert.equal(stats.over120, 0);
  assert.equal(stats.low, 120);
  assert.equal(stats.high, 120);
  const ids = ['likud', 'shas'];
  const coalition = summarize(coalitionDistribution(fit, ids));
  const singles = ids.map(id => summarize(partyDistribution(fit, id)));
  close(coalition.mean, sum(singles.map(p => p.mean)));
  const shares = ids.map(id => fit.parties.find(p => p.id === id).share);
  const covariance = -120 * shares[0] * shares[1] * (120 + fit.concentration) / (1 + fit.concentration);
  close(coalition.variance, sum(singles.map(p => p.variance)) + 2 * covariance);
  assert.ok(coalition.variance < sum(singles.map(p => p.variance)));
});

test('complementary coalitions mirror each other around 120', () => {
  const ids = ['likud', 'shas', 'utj'];
  const pmf = coalitionDistribution(fit, ids);
  const complement = coalitionDistribution(fit, parties.filter(p => !ids.includes(p.id)).map(p => p.id));
  pmf.forEach((p, n) => close(p, complement[120 - n]));
});

test('61-seat threshold is inclusive, discrete quantiles are exact', () => {
  const pmf = Array(63).fill(0); pmf[60] = .2; pmf[61] = .5; pmf[62] = .3;
  const stats = summarize(pmf, 61);
  close(stats.majority, .8);
  assert.equal(stats.median, 61);
  assert.equal(stats.low, 60);
  assert.equal(stats.high, 62);
});

test('empty and unknown selections have zero seats; repeated IDs do not double count', () => {
  const empty = coalitionDistribution(fit, []);
  assert.equal(empty[0], 1);
  assert.equal(sum(empty), 1);
  assert.equal(summarize(empty).majority, 0);
  assert.deepEqual(coalitionDistribution(fit, ['unknown']), empty);
  assert.deepEqual(coalitionDistribution(fit, ['likud', 'likud']), partyDistribution(fit, 'likud'));
});
