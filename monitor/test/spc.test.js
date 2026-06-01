import test from 'node:test';
import assert from 'node:assert/strict';
import { imrLimits, detectSignals, parseCsv, assertSafeUrl } from '../spc.js';

test('imrLimits computes mean and 3-sigma limits', () => {
  const lim = imrLimits([10, 11, 9, 10, 11, 9, 10]);
  assert.ok(Math.abs(lim.mean - 10) < 0.5);
  assert.ok(lim.ucl > lim.mean && lim.lcl < lim.mean);
});

test('detectSignals flags a point beyond 3 sigma', () => {
  const vals = [10, 11, 9, 10, 11, 9, 10, 9, 11, 10, 40]; // 40 is a spike
  const { signals } = detectSignals(vals);
  const beyond = signals.filter((s) => s.rule === 'beyond_3sigma');
  assert.ok(beyond.length >= 1);
  assert.equal(beyond[beyond.length - 1].value, 40);
});

test('detectSignals flags a run of 9 on one side', () => {
  // 9 straight points above the mean after a low stretch → shift.
  const vals = [5, 5, 5, 5, 5, 9, 9, 9, 9, 9, 9, 9, 9, 9];
  const { signals } = detectSignals(vals);
  assert.ok(signals.some((s) => s.rule === 'run_of_9'));
});

test('stable process produces no signals', () => {
  const vals = [10, 10.2, 9.8, 10.1, 9.9, 10.0, 10.1, 9.9, 10.0, 10.2];
  const { signals } = detectSignals(vals);
  assert.equal(signals.length, 0);
});

test('parseCsv handles quotes and commas', () => {
  const rows = parseCsv('x,label\n10,"a,b"\n11,c');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].x, '10');
  assert.equal(rows[0].label, 'a,b');
});

test('assertSafeUrl blocks private and non-http', () => {
  assert.throws(() => assertSafeUrl('http://localhost/x'));
  assert.throws(() => assertSafeUrl('http://10.0.0.1/x'));
  assert.throws(() => assertSafeUrl('file:///etc/passwd'));
  assert.equal(assertSafeUrl('https://example.com/data.csv'), 'https://example.com/data.csv');
});
