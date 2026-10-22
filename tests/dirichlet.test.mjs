import test from 'node:test';
import assert from 'node:assert/strict';
import { betaBinomial, fitDirichlet, dirichletCoalition } from '../lib/dirichlet.ts';

const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const sum = values => values.reduce((a, b) => a + b, 0);
const rising = (a, n) => Array.from({ length: n }, (_, i) => a + i).reduce((a, b) => a * b, 1);
const factorial = n => rising(1, n);
// Independent closed-form oracle for small integer fixtures.
const exactMass = (n, a, b, k) => factorial(n) / factorial(k) / factorial(n - k) * rising(a, k) * rising(b, n - k) / rising(a + b, n);

test('beta-binomial matches a rational fixture, uniform case and Bernoulli case', () => {
  betaBinomial(4, 2, 3).forEach((p, k) => close(p, [3/14, 2/7, 9/35, 6/35, 1/14][k]));
  betaBinomial(120, 1, 1).forEach(p => close(p, 1/121));
  betaBinomial(1, 2, 3).forEach((p, k) => close(p, [.6, .4][k]));
});

test('beta-binomial remains finite and has correct moments across extreme shapes', () => {
  for (const [a, b] of [[1e-8, 2e-8], [1e6, 3e6], [1e-8, 100], [100, 1e-8], [.3, 4]]) {
    const pmf = betaBinomial(120, a, b);
    assert.ok(pmf.every(p => Number.isFinite(p) && p >= 0));
    close(sum(pmf), 1);
    const mean = sum(pmf.map((p, k) => p * k));
    const variance = sum(pmf.map((p, k) => p * (k - mean) ** 2));
    close(mean, 120 * a / (a + b), 1e-8);
    close(variance, 120 * (a / (a + b)) * (b / (a + b)) * (120 + a + b) / (1 + a + b), 1e-7);
  }
});

test('large concentration approaches a binomial and small concentration keeps both endpoints', () => {
  betaBinomial(4, 2e8, 3e8).forEach((p, k) => close(p, factorial(4) / factorial(k) / factorial(4 - k) * .4 ** k * .6 ** (4 - k), 1e-8));
  const pmf = betaBinomial(120, 1e-10, 2e-10);
  close(pmf[0], 2/3, 1e-8);
  close(pmf[120], 1/3, 1e-8);
});

test('degenerate coalitions and invalid shape parameters are handled explicitly', () => {
  assert.deepEqual(betaBinomial(0, 2, 3), [1]);
  assert.deepEqual(betaBinomial(4, 0, 2), [1, 0, 0, 0, 0]);
  assert.deepEqual(betaBinomial(4, 2, 0), [0, 0, 0, 0, 1]);
  for (const args of [[4, 0, 0], [4, -1, 2], [4, NaN, 2], [4, Infinity, 2], [4.5, 2, 3], [-1, 2, 3]]) {
    assert.throws(() => betaBinomial(...args));
  }
});

test('coalition aggregation matches enumeration of the joint Dirichlet–multinomial', () => {
  const n = 4, alphas = [2, 3, 5];
  const fit = { totalSeats: n, parties: alphas.map((alpha, i) => ({ id: String(i), alpha })) };
  const enumerated = Array(n + 1).fill(0);
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
    const c = n - a - b;
    enumerated[a + b] += factorial(n) / factorial(a) / factorial(b) / factorial(c)
      * rising(2, a) * rising(3, b) * rising(5, c) / rising(10, n);
  }
  dirichletCoalition(fit, ['0', '1']).forEach((p, k) => close(p, enumerated[k]));
});

const alphas = [3, 5, 2];
const fixture = alphas.map((alpha, i) => ({
  id: String(i),
  buckets: [[0, 2], [3, 5], [6, 8], [9, 12]].map(([low, high]) => ({
    low, high, probability: sum(Array.from({ length: high - low + 1 }, (_, k) => exactMass(12, alpha, 10 - alpha, low + k))),
  })),
}));

test('joint fitting recovers known Dirichlet parameters from grouped probabilities', () => {
  const fit = fitDirichlet(fixture, 12);
  assert.ok(fit.converged);
  assert.ok(fit.rmse < 1e-7);
  assert.deepEqual(fit.warnings, []);
  close(fit.concentration, 10, 1e-4);
  fit.parties.forEach((p, i) => close(p.alpha, alphas[i], 1e-4));
  assert.deepEqual(fitDirichlet([...fixture].reverse(), 12), fit);
});

test('joint fitting validates distinct parties, complete brackets and probabilities', () => {
  assert.throws(() => fitDirichlet([], 12));
  assert.throws(() => fitDirichlet([fixture[0]], 12));
  assert.throws(() => fitDirichlet([fixture[0], fixture[0]], 12));
  assert.throws(() => fitDirichlet(fixture, 0));
  assert.throws(() => fitDirichlet(fixture, 12.5));
  for (const mutate of [
    p => p[0].buckets.pop(),
    p => { p[0].buckets[0].probability = -1; },
    p => { p[0].buckets[0].probability = NaN; },
    p => { p[0].buckets[0].probability += .1; },
    p => { p[0].buckets[1].low--; },
  ]) {
    const bad = structuredClone(fixture);
    mutate(bad);
    assert.throws(() => fitDirichlet(bad, 12));
  }
});
