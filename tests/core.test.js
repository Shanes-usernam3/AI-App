import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/core.js';

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('parseAmount handles common inputs', () => {
  assert.equal(T.parseAmount('12'), 1200);
  assert.equal(T.parseAmount('12.5'), 1250);
  assert.equal(T.parseAmount('12.05'), 1205);
  assert.equal(T.parseAmount('$1,234.56'), 123456);
  assert.equal(T.parseAmount('.99'), 99);
  assert.equal(T.parseAmount(' 7. '), 700);
  for (const bad of ['', 'abc', '-5', '0', '0.00', '1.234', '1e3', null, undefined]) assert.equal(T.parseAmount(bad), null, String(bad));
});

test('splitEqual always sums to the total', () => {
  assert.deepEqual(T.splitEqual(1000, ['a', 'b', 'c']), { a: 334, b: 333, c: 333 });
  for (let total = 1; total < 2000; total += 37) {
    for (let n = 1; n <= 7; n++) {
      const ids = Array.from({ length: n }, (_, i) => 'p' + i);
      const parts = T.splitEqual(total, ids);
      assert.equal(sum(parts), total);
      const vals = Object.values(parts);
      assert.ok(Math.max(...vals) - Math.min(...vals) <= 1);
    }
  }
});

test('splitByWeights respects weights and ignores zero weights', () => {
  assert.deepEqual(T.splitByWeights(900, { a: 2, b: 1, c: 0 }), { a: 600, b: 300 });
  assert.equal(sum(T.splitByWeights(1001, { a: 1.5, b: 2.5, c: 3 })), 1001);
  assert.throws(() => T.splitByWeights(100, { a: 0 }));
});

function demo() {
  const g = T.newGroup('Cabin trip', ['Shane', 'Alex', 'Jo']);
  const [s, a, j] = g.members.map((m) => m.id);
  return { g, s, a, j };
}

test('balances sum to zero and reflect who paid', () => {
  const { g, s, a, j } = demo();
  T.addExpense(g, { description: 'Groceries', amount: '90', paidBy: s, weights: { [s]: 1, [a]: 1, [j]: 1 } });
  T.addExpense(g, { description: 'Gas', amount: '40', paidBy: a, weights: { [s]: 1, [a]: 1 } });
  const b = T.computeBalances(g);
  assert.equal(sum(b), 0);
  assert.deepEqual(b, { [s]: 6000 - 2000, [a]: 4000 - 3000 - 2000, [j]: -3000 });
});

test('settleUp clears every balance with at most n-1 transfers', () => {
  const { g, s, a, j } = demo();
  T.addExpense(g, { description: 'Cabin', amount: '600', paidBy: s, weights: { [s]: 1, [a]: 1, [j]: 1 } });
  T.addExpense(g, { description: 'Food', amount: '123.45', paidBy: j, weights: { [s]: 1, [a]: 2, [j]: 1 } });
  const t = T.settleUp(T.computeBalances(g));
  assert.ok(t.length <= 2);
  for (const x of t) T.recordPayment(g, x);
  assert.ok(Object.values(T.computeBalances(g)).every((v) => v === 0));
});

test('settleUp fuzz: random groups always settle to zero', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let round = 0; round < 300; round++) {
    const n = 2 + Math.floor(rnd() * 6);
    const g = T.newGroup('G', Array.from({ length: n }, (_, i) => 'P' + i));
    const ids = g.members.map((m) => m.id);
    const ne = 1 + Math.floor(rnd() * 10);
    for (let k = 0; k < ne; k++) {
      const weights = {};
      for (const id of ids) if (rnd() < 0.7) weights[id] = 1 + Math.floor(rnd() * 3);
      if (!Object.keys(weights).length) weights[ids[0]] = 1;
      T.addExpense(g, { description: 'x', amount: 1 + Math.floor(rnd() * 50000), paidBy: ids[Math.floor(rnd() * n)], weights });
    }
    const b = T.computeBalances(g);
    assert.equal(sum(b), 0);
    const t = T.settleUp(b);
    assert.ok(t.length <= n - 1);
    for (const x of t) { assert.ok(x.amount > 0); T.recordPayment(g, x); }
    assert.ok(Object.values(T.computeBalances(g)).every((v) => v === 0));
  }
});

test('validation errors are friendly', () => {
  const { g, s } = demo();
  assert.throws(() => T.addExpense(g, { description: '', amount: '5', paidBy: s, weights: { [s]: 1 } }), /Description/);
  assert.throws(() => T.addExpense(g, { description: 'x', amount: 'abc', paidBy: s, weights: { [s]: 1 } }), /valid amount/);
  assert.throws(() => T.addExpense(g, { description: 'x', amount: '5', paidBy: 'nope', weights: { [s]: 1 } }), /who paid/);
  assert.throws(() => T.addExpense(g, { description: 'x', amount: '5', paidBy: s, weights: {} }), /at least one/);
  assert.throws(() => T.addMember(g, 'shane'), /already/);
  assert.throws(() => T.newGroup('  '), /required/);
});

test('members with a balance cannot be removed; settled ones can', () => {
  const { g, s, a, j } = demo();
  T.addExpense(g, { description: 'x', amount: '10', paidBy: s, weights: { [s]: 1, [a]: 1 } });
  assert.throws(() => T.removeMember(g, a), /Settle/);
  T.removeMember(g, j);
  assert.equal(g.members.length, 2);
});

test('deleting an expense updates balances', () => {
  const { g, s, a } = demo();
  const e = T.addExpense(g, { description: 'x', amount: '10', paidBy: s, weights: { [s]: 1, [a]: 1 } });
  T.deleteExpense(g, e.id);
  assert.ok(Object.values(T.computeBalances(g)).every((v) => v === 0));
});

test('summaryText and validateState round-trip', () => {
  const { g, s, a } = demo();
  T.addExpense(g, { description: 'Pizza', amount: '30', paidBy: s, weights: { [s]: 1, [a]: 1 } });
  const txt = T.summaryText(g);
  assert.match(txt, /Alex pays Shane \$15\.00/);
  const restored = T.validateState(JSON.parse(JSON.stringify({ groups: [g] })));
  assert.deepEqual(T.computeBalances(restored.groups[0]), T.computeBalances(g));
  assert.throws(() => T.validateState({ nope: 1 }), /backup/);
  assert.throws(() => T.validateState({ groups: [{ id: 'x', name: 'y', members: [], expenses: [{ amount: -1, paidBy: 'a' }] }] }), /expense/);
});

test('formatCents', () => {
  assert.equal(T.formatCents(123456), '$1,234.56');
  assert.equal(T.formatCents(-500), '-$5.00');
});
