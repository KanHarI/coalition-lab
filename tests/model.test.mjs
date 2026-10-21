import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRange, parseEvent, partyDistribution, convolve, coalitionDistribution, summarize, effectiveRange } from '../lib/model.ts';
const snapshot = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
const parties = snapshot.events.map(parseEvent);
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const sum = a => a.reduce((x, y) => x + y, 0);

test('range parsing supports exact seats, inclusive ranges and open tails', () => {
  assert.deepEqual(parseRange('<20'), { low: 0, high: 19, open: 'lower' });
  assert.deepEqual(parseRange('20–24'), { low: 20, high: 24, open: null });
  assert.deepEqual(parseRange('35+'), { low: 35, high: 120, open: 'upper' });
  assert.deepEqual(parseRange('4'), { low: 4, high: 4, open: null });
  for (const label of ['a lot', '122+', '9-8', '<0']) assert.throws(() => parseRange(label));
});

test('real market snapshots form complete, normalized distributions in both tail modes', () => {
  assert.equal(parties.length, 12);
  for (const party of parties) for (const mode of ['full', 'adjacent']) {
    close(sum(party.buckets.map(b => b.probability)), 1);
    const pmf = partyDistribution(party, mode);
    close(sum(pmf), 1);
    assert.ok(pmf.every(p => Number.isFinite(p) && p >= 0));
    for (const b of party.buckets) {
      close(sum(pmf.slice(b.low, b.high + 1)), b.probability);
      const { low, high } = effectiveRange(b, party.buckets, mode);
      close(pmf[low], pmf[high]);
    }
  }
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

test('convolution matches enumerated dice outcomes', () => {
  const die = [0, 1/6, 1/6, 1/6, 1/6, 1/6, 1/6];
  const actual = convolve(die, die);
  const counts = Array(13).fill(0);
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) counts[a + b]++;
  actual.forEach((p, i) => close(p, counts[i] / 36));
  close(summarize(actual).mean, 7);
  close(summarize(actual).variance, 35/6);
});

test('independent coalition mean and variance are additive; no 120-seat clipping', () => {
  const selected = parties.map(p => p.id);
  const pmf = coalitionDistribution(parties, selected, 'full');
  const stats = summarize(pmf);
  const singles = parties.map(p => summarize(partyDistribution(p, 'full')));
  close(sum(pmf), 1);
  close(stats.mean, sum(singles.map(p => p.mean)));
  close(stats.variance, sum(singles.map(p => p.variance)), 1e-8);
  assert.ok(stats.over120 > 0);
  assert.ok(pmf.length > 121);
});

test('61-seat threshold is inclusive, discrete quantiles are exact', () => {
  const pmf = Array(63).fill(0); pmf[60] = .2; pmf[61] = .5; pmf[62] = .3;
  const stats = summarize(pmf, 61);
  close(stats.majority, .8);
  assert.equal(stats.median, 61);
  assert.equal(stats.low, 60);
  assert.equal(stats.high, 62);
});

test('empty selection has zero seats, and repeated IDs do not double count', () => {
  assert.deepEqual(coalitionDistribution(parties, [], 'full'), [1]);
  assert.equal(summarize([1]).majority, 0);
  assert.deepEqual(coalitionDistribution(parties, ['likud', 'likud'], 'full'), partyDistribution(parties.find(p => p.id === 'likud'), 'full'));
});

test('the dependence strategy is replaceable independently of market reconstruction', () => {
  const custom = { id: 'fixture', combine: distributions => { assert.equal(distributions.length, 2); return [0, 1]; } };
  assert.deepEqual(coalitionDistribution(parties, ['likud', 'shas'], 'full', custom), [0, 1]);
});
