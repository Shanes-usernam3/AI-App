import * as T from './core.js';

const KEY = 'tabby:v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// ---------- state ----------
let state = load();
let ui = { groupId: null, tab: 'expenses', splitMode: 'equal' };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return T.validateState(JSON.parse(raw));
  } catch (e) { console.warn('Could not load saved data', e); }
  return { version: T.SCHEMA_VERSION, groups: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Could not save — storage is full or blocked'); }
}
const group = () => state.groups.find((g) => g.id === ui.groupId);
const memberName = (g, id) => g.members.find((m) => m.id === id)?.name ?? 'Former member';
const fmt = (g, c) => T.formatCents(c, g.currency);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- routing ----------
function go(groupId, tab) {
  ui.groupId = groupId; if (tab) ui.tab = tab;
  const hash = groupId ? `#/g/${groupId}/${ui.tab}` : '#/';
  if (location.hash !== hash) history.pushState(null, '', hash);
  render();
}
function fromHash() {
  const m = location.hash.match(/^#\/g\/([^/]+)(?:\/(\w+))?/);
  ui.groupId = m && state.groups.some((g) => g.id === m[1]) ? m[1] : null;
  if (m?.[2]) ui.tab = m[2];
  render();
}
addEventListener('popstate', fromHash);

// ---------- rendering ----------
function render() {
  const g = group();
  $('#backBtn').hidden = !g;
  $('#fab').hidden = !g || g.members.length === 0;
  $('#title').textContent = g ? g.name : 'Tabby';
  document.title = g ? `${g.name} · Tabby` : 'Tabby — split expenses';
  $('#view').innerHTML = g ? renderGroup(g) : renderHome();
}

function renderHome() {
  const items = state.groups.map((g) => {
    const total = g.expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
    const open = T.settleUp(T.computeBalances(g)).length;
    return `<li><button class="group-link" data-action="open" data-id="${g.id}">
      <span class="avatar">${esc(initials(g.name))}</span>
      <span class="grow"><strong>${esc(g.name)}</strong><br><span class="sub">${g.members.length} people · ${open ? `${open} payment${open > 1 ? 's' : ''} to settle` : 'settled'}</span></span>
      <span class="amt">${fmt(g, total)}</span></button></li>`;
  }).join('');
  return `
    <form class="card inline-form" data-form="new-group">
      <input name="name" placeholder="New group — e.g. Cabin trip" maxlength="60" aria-label="New group name" autocomplete="off" />
      <button class="primary">Create</button>
    </form>
    ${state.groups.length ? `<div class="card"><ul class="list">${items}</ul></div>` :
      `<div class="empty"><div class="big">🧾</div><p>Split costs for trips, roommates or dinners.<br>Everything stays on this device.</p>
       <button class="small" data-action="demo">Try a sample group</button></div>`}`;
}

function renderGroup(g) {
  const tabs = ['expenses', 'balances', 'people'].map((t) =>
    `<button data-action="tab" data-tab="${t}" class="${ui.tab === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('');
  const body = ui.tab === 'balances' ? renderBalances(g) : ui.tab === 'people' ? renderPeople(g) : renderExpenses(g);
  return `<nav class="tabs" role="tablist">${tabs}</nav>${body}`;
}

function renderExpenses(g) {
  if (!g.members.length) return `<div class="empty"><div class="big">👥</div><p>Add the people in this group first.</p>
    <button class="primary" data-action="tab" data-tab="people">Add people</button></div>`;
  const total = g.expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
  const rows = [...g.expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).map((e) => {
    const isPay = e.kind === 'payment';
    const title = isPay ? `${esc(memberName(g, e.paidBy))} paid ${esc(memberName(g, e.to))}` : esc(e.description);
    const sub = isPay ? 'Settlement' : `${esc(memberName(g, e.paidBy))} paid · split ${Object.keys(e.weights).length} way${Object.keys(e.weights).length > 1 ? 's' : ''}`;
    return `<li><span class="avatar">${isPay ? '⇄' : esc(initials(e.description))}</span>
      <span class="grow"><strong>${title}</strong><br><span class="sub">${e.date} · ${sub}</span></span>
      <span class="amt">${fmt(g, e.amount)}</span>
      <button class="del" data-action="del-expense" data-id="${e.id}" aria-label="Delete">✕</button></li>`;
  }).join('');
  return `<div class="card stat"><span class="sub">Total spent</span><span class="amt">${fmt(g, total)}</span></div>
    ${rows ? `<div class="card"><ul class="list">${rows}</ul></div>` :
      `<div class="empty"><div class="big">💸</div><p>No expenses yet. Tap ＋ to add one.</p></div>`}`;
}

function renderBalances(g) {
  const bal = T.computeBalances(g);
  const people = g.members.map((m) => {
    const c = bal[m.id];
    const cls = c > 0 ? 'owed' : c < 0 ? 'owes' : '';
    const label = c > 0 ? 'gets back' : c < 0 ? 'owes' : 'settled';
    return `<li><span class="avatar">${esc(initials(m.name))}</span><span class="grow">${esc(m.name)}<br><span class="sub">${label}</span></span>
      <span class="amt ${cls}">${c ? fmt(g, Math.abs(c)) : '—'}</span></li>`;
  }).join('');
  const transfers = T.settleUp(bal);
  const tr = transfers.map((t, i) => `<li><span class="grow"><strong>${esc(memberName(g, t.from))}</strong> → <strong>${esc(memberName(g, t.to))}</strong></span>
      <span class="amt">${fmt(g, t.amount)}</span><button class="small" data-action="settle" data-i="${i}">Mark paid</button></li>`).join('');
  return `<div class="card"><h3>Balances</h3><ul class="list">${people || '<li class="sub">No people yet</li>'}</ul></div>
    <div class="card"><h3>Settle up</h3>${tr ? `<ul class="list">${tr}</ul>` : '<p class="sub">Everyone is square. 🎉</p>'}
    <div class="row-end" style="margin-top:10px"><button class="small" data-action="share">Copy summary</button></div></div>`;
}

function renderPeople(g) {
  const bal = T.computeBalances(g);
  const rows = g.members.map((m) => `<li><span class="avatar">${esc(initials(m.name))}</span><span class="grow">${esc(m.name)}</span>
    <button class="del" data-action="del-member" data-id="${m.id}" aria-label="Remove ${esc(m.name)}" ${bal[m.id] ? 'disabled title="Settle up first"' : ''}>✕</button></li>`).join('');
  return `<form class="card inline-form" data-form="add-member">
      <input name="name" placeholder="Add a person" maxlength="40" aria-label="Person name" autocomplete="off" />
      <button class="primary">Add</button></form>
    ${rows ? `<div class="card"><ul class="list">${rows}</ul></div>` : ''}
    <div class="card"><button class="small danger" data-action="del-group">Delete this group</button></div>`;
}

// ---------- expense dialog ----------
const dlg = $('#expenseDialog'), form = $('#expenseForm');

function openExpense() {
  const g = group();
  form.reset(); $('#expenseError').textContent = '';
  form.paidBy.innerHTML = g.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  setSplitMode('equal');
  $('#splitRows').innerHTML = g.members.map((m) => `<div class="split-row" data-id="${m.id}">
      <label><input type="checkbox" checked /> ${esc(m.name)}</label>
      <input type="number" min="0" step="1" value="1" aria-label="Shares for ${esc(m.name)}" hidden />
      <span class="amt"></span></div>`).join('');
  updatePreview();
  dlg.showModal();
  form.description.focus();
}
function setSplitMode(mode) {
  ui.splitMode = mode;
  form.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  form.querySelectorAll('.split-row input[type=number]').forEach((i) => (i.hidden = mode !== 'shares'));
  updatePreview();
}
function readWeights() {
  const w = {};
  form.querySelectorAll('.split-row').forEach((row) => {
    const on = row.querySelector('input[type=checkbox]').checked;
    const shares = ui.splitMode === 'shares' ? Number(row.querySelector('input[type=number]').value) : 1;
    if (on && shares > 0) w[row.dataset.id] = shares;
  });
  return w;
}
function updatePreview() {
  const g = group(); if (!g) return;
  const cents = T.parseAmount(form.amount.value);
  const w = readWeights();
  let parts = {};
  try { if (cents) parts = T.splitByWeights(cents, w); } catch {}
  form.querySelectorAll('.split-row').forEach((row) => {
    row.querySelector('.amt').textContent = parts[row.dataset.id] != null ? fmt(g, parts[row.dataset.id]) : '';
  });
  const n = Object.keys(w).length;
  $('#splitPreview').textContent = !n ? 'Pick at least one person.' : cents ? `${n} ${n === 1 ? 'person' : 'people'} · ${fmt(g, cents)} total` : '';
}
form.addEventListener('input', updatePreview);
form.addEventListener('click', (e) => { const b = e.target.closest('.seg button'); if (b) setSplitMode(b.dataset.mode); });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const g = group();
  try {
    T.addExpense(g, { description: form.description.value, amount: form.amount.value, paidBy: form.paidBy.value, weights: readWeights() });
    save(); dlg.close(); render(); toast('Expense added');
  } catch (err) { $('#expenseError').textContent = err.message; }
});

// ---------- actions ----------
const actions = {
  home: () => go(null),
  open: (el) => go(el.dataset.id, 'expenses'),
  tab: (el) => go(ui.groupId, el.dataset.tab),
  'new-expense': openExpense,
  'close-dialog': (el) => el.closest('dialog').close(),
  menu: () => $('#menuDialog').showModal(),
  demo: () => {
    const g = T.newGroup('Cabin weekend (sample)', ['Shane', 'Alex', 'Jo', 'Sam']);
    const [s, a, j, m] = g.members.map((x) => x.id);
    const all = { [s]: 1, [a]: 1, [j]: 1, [m]: 1 };
    T.addExpense(g, { description: 'Cabin rental', amount: '480', paidBy: s, weights: all });
    T.addExpense(g, { description: 'Groceries', amount: '136.40', paidBy: a, weights: all });
    T.addExpense(g, { description: 'Gas', amount: '72', paidBy: j, weights: { [s]: 1, [j]: 1 } });
    T.addExpense(g, { description: 'Firewood & ice', amount: '28.75', paidBy: m, weights: all });
    state.groups.unshift(g); save(); go(g.id, 'balances');
  },
  'del-expense': (el) => {
    const g = group(); if (!confirm('Delete this entry?')) return;
    T.deleteExpense(g, el.dataset.id); save(); render();
  },
  'del-member': (el) => {
    try { T.removeMember(group(), el.dataset.id); save(); render(); } catch (e) { toast(e.message); }
  },
  'del-group': () => {
    const g = group(); if (!confirm(`Delete “${g.name}” and all its expenses?`)) return;
    state.groups = state.groups.filter((x) => x.id !== g.id); save(); go(null);
  },
  settle: (el) => {
    const g = group(); const t = T.settleUp(T.computeBalances(g))[Number(el.dataset.i)];
    if (!t) return;
    T.recordPayment(g, t); save(); render(); toast(`Recorded ${memberName(g, t.from)} → ${memberName(g, t.to)}`);
  },
  share: async () => {
    const text = T.summaryText(group());
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Summary copied'); }
    } catch (e) { if (e?.name !== 'AbortError') prompt('Copy this summary:', text); }
  },
  export: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tabby-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#menuDialog').close(); toast('Backup downloaded');
  },
  about: () => { $('#menuDialog').close(); alert('Tabby 1.0 — split costs offline.\nYour data never leaves this device. Use Export to back it up.'); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled && actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](el); }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  const name = f.querySelector('input').value;
  try {
    if (f.dataset.form === 'new-group') { const g = T.newGroup(name); state.groups.unshift(g); save(); go(g.id, 'people'); }
    if (f.dataset.form === 'add-member') { T.addMember(group(), name); save(); render(); $('[data-form=add-member] input').focus(); }
  } catch (err) { toast(err.message); }
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = T.validateState(JSON.parse(await file.text()));
    if (!confirm(`Replace current data with ${data.groups.length} group(s) from backup?`)) return;
    state = data; save(); $('#menuDialog').close(); go(null); toast('Backup restored');
  } catch (err) { toast('Import failed: ' + err.message); }
  finally { e.target.value = ''; }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
fromHash();
