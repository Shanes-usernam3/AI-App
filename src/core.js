// Tabby core logic — pure functions, no DOM. Shared by the app and the tests.
// All money is stored as integer cents to avoid floating-point drift.

export const SCHEMA_VERSION = 1;

/** Parse a user-typed amount ("12", "12.5", "$1,234.56") into integer cents. Returns null if invalid. */
export function parseAmount(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

/** Format integer cents as a currency string. */
export function formatCents(cents, currency = 'CAD', locale = 'en-CA') {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  try {
    return sign + new Intl.NumberFormat(locale, { style: 'currency', currency }).format(abs / 100);
  } catch {
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }
}

/**
 * Split cents across ids by weight. Leftover cents (from rounding) go one at a time
 * to the ids with the largest fractional remainder, ties broken by list order —
 * so the parts always sum exactly to the total.
 */
export function splitByWeights(totalCents, weights) {
  const entries = Object.entries(weights).filter(([, w]) => Number(w) > 0);
  if (entries.length === 0) throw new Error('At least one person must share the expense');
  const sum = entries.reduce((a, [, w]) => a + Number(w), 0);
  const parts = entries.map(([id, w], i) => {
    const exact = (totalCents * Number(w)) / sum;
    const floor = Math.floor(exact);
    return { id, floor, rem: exact - floor, i };
  });
  let left = totalCents - parts.reduce((a, p) => a + p.floor, 0);
  const order = [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) order[k].floor++;
  return Object.fromEntries(parts.map((p) => [p.id, p.floor]));
}

export function splitEqual(totalCents, ids) {
  return splitByWeights(totalCents, Object.fromEntries(ids.map((id) => [id, 1])));
}

/** Who owes what for one expense: { [memberId]: cents }. */
export function sharesFor(expense) {
  if (expense.kind === 'payment') return { [expense.to]: expense.amount };
  return splitByWeights(expense.amount, expense.weights);
}

/** Net balance per member. Positive = is owed money, negative = owes money. Always sums to 0. */
export function computeBalances(group) {
  const bal = Object.fromEntries(group.members.map((m) => [m.id, 0]));
  for (const e of group.expenses) {
    if (!(e.paidBy in bal)) continue;
    bal[e.paidBy] += e.amount;
    for (const [id, cents] of Object.entries(sharesFor(e))) {
      if (id in bal) bal[id] -= cents;
      else bal[e.paidBy] -= cents; // share of a removed member falls back on the payer
    }
  }
  return bal;
}

/**
 * Suggest transfers that settle all balances. Greedy: repeatedly match the biggest
 * debtor with the biggest creditor. Produces at most n-1 transfers.
 */
export function settleUp(balances) {
  const debtors = [], creditors = [];
  for (const [id, c] of Object.entries(balances)) {
    if (c < 0) debtors.push({ id, amt: -c });
    else if (c > 0) creditors.push({ id, amt: c });
  }
  const byAmt = (a, b) => b.amt - a.amt || a.id.localeCompare(b.id);
  const out = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmt); creditors.sort(byAmt);
    const d = debtors[0], c = creditors[0];
    const amt = Math.min(d.amt, c.amt);
    out.push({ from: d.id, to: c.id, amount: amt });
    d.amt -= amt; c.amt -= amt;
    if (!d.amt) debtors.shift();
    if (!c.amt) creditors.shift();
  }
  return out;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newGroup(name, memberNames = []) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Group name is required');
  const g = { id: uid(), name: n, currency: 'CAD', members: [], expenses: [], createdAt: Date.now() };
  for (const m of memberNames) addMember(g, m);
  return g;
}

export function addMember(group, name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Name is required');
  if (group.members.some((m) => m.name.toLowerCase() === n.toLowerCase())) throw new Error(`${n} is already in this group`);
  const m = { id: uid(), name: n };
  group.members.push(m);
  return m;
}

/** A member can only be removed once their balance is zero, so nobody's money disappears. */
export function removeMember(group, memberId) {
  const bal = computeBalances(group)[memberId] ?? 0;
  if (bal !== 0) throw new Error('Settle this person\'s balance before removing them');
  group.members = group.members.filter((m) => m.id !== memberId);
}

export function addExpense(group, { description, amount, paidBy, weights, date }) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('Description is required');
  const cents = typeof amount === 'number' && Number.isInteger(amount) ? amount : parseAmount(amount);
  if (!cents) throw new Error('Enter a valid amount greater than 0');
  const ids = new Set(group.members.map((m) => m.id));
  if (!ids.has(paidBy)) throw new Error('Choose who paid');
  const w = Object.fromEntries(Object.entries(weights || {}).filter(([id, v]) => ids.has(id) && Number(v) > 0).map(([id, v]) => [id, Number(v)]));
  if (!Object.keys(w).length) throw new Error('Pick at least one person to split with');
  const e = { id: uid(), kind: 'expense', description: desc, amount: cents, paidBy, weights: w, date: date || new Date().toISOString().slice(0, 10), createdAt: Date.now() };
  group.expenses.push(e);
  return e;
}

export function recordPayment(group, { from, to, amount }) {
  if (from === to) throw new Error('Payer and receiver must differ');
  const e = { id: uid(), kind: 'payment', description: 'Payment', amount, paidBy: from, to, date: new Date().toISOString().slice(0, 10), createdAt: Date.now() };
  group.expenses.push(e);
  return e;
}

export function deleteExpense(group, id) {
  group.expenses = group.expenses.filter((e) => e.id !== id);
}

/** Plain-text summary suitable for pasting into a group chat. */
export function summaryText(group) {
  const name = (id) => group.members.find((m) => m.id === id)?.name ?? '?';
  const fmt = (c) => formatCents(c, group.currency);
  const total = group.expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
  const lines = [`${group.name} — total spent ${fmt(total)}`];
  const t = settleUp(computeBalances(group));
  lines.push(...(t.length ? t.map((x) => `• ${name(x.from)} pays ${name(x.to)} ${fmt(x.amount)}`) : ['• All settled up!']));
  return lines.join('\n');
}

/** Validate & normalize imported data. Throws on anything malformed. */
export function validateState(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.groups)) throw new Error('Not a Tabby backup file');
  for (const g of data.groups) {
    if (typeof g.id !== 'string' || typeof g.name !== 'string' || !Array.isArray(g.members) || !Array.isArray(g.expenses)) throw new Error('Invalid group in backup');
    for (const m of g.members) if (typeof m.id !== 'string' || typeof m.name !== 'string') throw new Error('Invalid member in backup');
    for (const e of g.expenses) {
      if (!Number.isSafeInteger(e.amount) || e.amount <= 0 || typeof e.paidBy !== 'string') throw new Error('Invalid expense in backup');
      if (e.kind === 'payment' ? typeof e.to !== 'string' : !e.weights || typeof e.weights !== 'object') throw new Error('Invalid expense in backup');
    }
    g.currency ||= 'CAD';
  }
  return { version: SCHEMA_VERSION, groups: data.groups };
}
