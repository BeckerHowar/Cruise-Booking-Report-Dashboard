/* State and wiring. Nothing is computed here: every control mutates ctx or ui
   and calls render(), which asks the views for fresh HTML. */
(function () {
'use strict';
const { util: U, engine: E, views: V } = CBR;
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('cbr.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('cbr.' + k, v); } catch (e) { /* storage unavailable */ } },
};

const SLIDERS = [
  { key: 'vol',    label: 'Volume',        min: -0.30, max: 0.30, step: 0.05,  fmt: v => U.signedPct(v, 0), tip: 'Bookings still to come on unsailed voyages, against what the outlook expects.' },
  { key: 'price',  label: 'Price',         min: -0.10, max: 0.10, step: 0.01,  fmt: v => U.signedPct(v, 0), tip: 'List fare on the bookings still to come.' },
  { key: 'cancel', label: 'Cancellations', min: -0.50, max: 1.00, step: 0.10,  fmt: v => U.signedPct(v, 0), tip: 'Cancellation rate on the unsailed book, relative to the rate history shows.' },
  { key: 'dil',    label: 'Dilution',      min: -0.03, max: 0.05, step: 0.005, fmt: v => U.pp(v, 1),        tip: 'Discounting on the bookings still to come, in points of list fare.' },
  { key: 'fuel',   label: 'Fuel',          min: -0.30, max: 0.50, step: 0.05,  fmt: v => U.signedPct(v, 0), tip: 'Fuel price in the months after the close.' },
];
const FLAG_KEYS = V.ADJUSTMENTS.map(a => a.key);

let D = null, simD = null, replay = null;
const ctx = E.defaults();
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => window.innerWidth < 720;
const ui = { view: 'flight', tables: {}, bridgeBase: 'bud', focus: null, revTab: 'month', voyQ: 'all', saved: null,
             source: 'simulated', sigma: { state: 'idle', message: '' }, still: reduced, narrow: isNarrow(),
             sort: {}, filter: {}, flagsOpen: false, glossOpen: false, cockpitMin: store.get('cockpitMin') === '1', showDeck: store.get('deck') !== '0' };
try { const s = JSON.parse(store.get('savedScenario') || 'null'); if (s && typeof s.vol === 'number') ui.saved = s; } catch (e) { /* unreadable */ }

/* ---------- shareable link: the whole state lives in the address ---------- */
function writeHash() {
  const p = new URLSearchParams();
  p.set('v', ui.view); p.set('a', ctx.asOf); p.set('y', ctx.year); p.set('s', ctx.ship); p.set('w', ctx.window);
  p.set('f', FLAG_KEYS.map(k => ctx.flags[k] ? 1 : 0).join(''));
  if (SLIDERS.some(s => ctx.scen[s.key])) p.set('c', SLIDERS.map(s => ctx.scen[s.key]).join(','));
  if (ui.bridgeBase !== 'bud') p.set('b', ui.bridgeBase);
  try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* file: pages in some browsers */ }
}
function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (V.LIST.some(v => v.id === p.get('v'))) ui.view = p.get('v');
  const a = +p.get('a'), y = +p.get('y'), s = p.get('s');
  if ([...$('asOfSel').options].some(o => +o.value === a)) ctx.asOf = a;
  if ([...$('yearSel').options].some(o => +o.value === y)) ctx.year = y;
  if (s !== null && +s >= -1 && +s < D.dims.ships.length) ctx.ship = +s;
  if (['ytd', 'fy', 'r12'].includes(p.get('w'))) ctx.window = p.get('w');
  const f = p.get('f');
  if (f && f.length === FLAG_KEYS.length) FLAG_KEYS.forEach((k, i) => { ctx.flags[k] = f[i] === '1'; });
  const c = (p.get('c') || '').split(',').map(Number);
  if (c.length === SLIDERS.length) SLIDERS.forEach((sl, i) => { if (isFinite(c[i])) ctx.scen[sl.key] = U.clamp(c[i], sl.min, sl.max); });
  if (['bud', 'fc', 'stly'].includes(p.get('b'))) ui.bridgeBase = p.get('b');
}

function load(dataset, fromLink) {
  D = E.prepare(dataset);
  ctx.asOf = D.meta.asOf;
  ctx.year = U.miYear(U.mi(ctx.asOf));
  ctx.ship = -1;
  buildControls();
  if (fromLink) readHash();
  render();
}

function buildControls() {
  const am = U.mi(D.meta.asOf);
  const closes = [];
  for (let m = am - 11; m <= am; m++) if (m > D.range.minMi) closes.push(m === am ? D.meta.asOf : U.miEnd(m));
  $('asOfSel').innerHTML = closes.map(d => '<option value="' + d + '">' + U.dateLabel(d) + '</option>').join('');
  const years = [...new Set(D.voyages.map(v => v.year))].sort();
  $('yearSel').innerHTML = years.map(y => '<option value="' + y + '">' + y + '</option>').join('');
  $('shipSel').innerHTML = '<option value="-1">Consolidated</option>' + D.dims.ships.map((s, i) => '<option value="' + i + '">' + U.esc(s.name) + '</option>').join('');
  $('viewTabs').innerHTML = V.LIST.map(v => '<button role="tab" data-act="view:' + v.id + '">' + v.label + '</button>').join('');
  $('glossList').innerHTML = V.GLOSSARY.map(([t, d]) => '<dt>' + t + '</dt><dd>' + d + '</dd>').join('');
}

function renderCockpit(view) {
  const el = $('cockpit'), idle = !view.scope.includes('cockpit'), tag = V.scenTag(ctx);
  el.className = 'cockpit' + (ui.cockpitMin ? ' min' : '') + (idle ? ' idle' : '');
  const title = '<span class="ck-title" title="Each slider moves unsailed voyages only. Closed months never restate, so the outlook, the profit bridge and the cash river move while the booked position stays put.">Scenario cockpit</span>';
  // The sliders are rebuilt only when the layout changes, so a drag in progress is never interrupted.
  const mode = (ui.cockpitMin ? 'min' : 'full') + (idle ? '-idle' : '');
  if (el.dataset.mode !== mode) {
    el.dataset.mode = mode;
    el.innerHTML = ui.cockpitMin
      ? title + '<span class="ck-sum" id="ckSum"></span><button type="button" class="btn" id="ckOpen" title="Show the sliders">Open</button>'
      : title + (idle ? '<span class="ck-idle">no effect on this tab</span>' : '') +
        SLIDERS.map(s => '<div class="ck-s"><label class="ck-top" for="ck_' + s.key + '" title="' + U.esc(s.tip) + '"><span>' + s.label + '</span><span class="ck-val" id="ckv_' + s.key + '"></span></label>' +
          '<input type="range" id="ck_' + s.key + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '"></div>').join('') +
        '<div class="ck-actions"><button type="button" class="btn" id="ckReset" title="Return every slider to zero">Reset</button>' +
        '<button type="button" class="btn primary" id="ckSave" title="Keep this slider set as the saved scenario, shown beside the base case in the scenarios table">Save</button>' +
        '<button type="button" class="btn" id="ckMin" title="Tuck the cockpit into the corner">Hide</button></div>';
    if (ui.cockpitMin) {
      $('ckOpen').addEventListener('click', () => { ui.cockpitMin = false; store.set('cockpitMin', '0'); render(); });
    } else {
      for (const s of SLIDERS) $('ck_' + s.key).addEventListener('input', ev => { ctx.scen[s.key] = parseFloat(ev.target.value); render(); });
      $('ckReset').addEventListener('click', () => { for (const s of SLIDERS) ctx.scen[s.key] = 0; render(); });
      $('ckSave').addEventListener('click', () => { ui.saved = { ...ctx.scen }; store.set('savedScenario', JSON.stringify(ui.saved)); render(); });
      $('ckMin').addEventListener('click', () => { ui.cockpitMin = true; store.set('cockpitMin', '1'); render(); });
    }
  }
  if (ui.cockpitMin) $('ckSum').textContent = tag.length ? tag.join(' · ') : 'base case';
  else for (const s of SLIDERS) { $('ck_' + s.key).value = ctx.scen[s.key]; $('ckv_' + s.key).textContent = s.fmt(ctx.scen[s.key]); }
}

function renderFlags() {
  const def = E.defaults().flags, changed = V.ADJUSTMENTS.filter(a => ctx.flags[a.key] !== def[a.key]);
  const show = ui.flagsOpen ? V.ADJUSTMENTS : changed;
  $('flagbar').innerHTML =
    '<button type="button" class="flag-toggle" data-act="flags:toggle" aria-expanded="' + ui.flagsOpen + '" title="Seven switches that settle how barter, transfers, non-revenue guests and voyages, proration and charters are treated. Each applies to every view at once.">' +
    'Adjustments · ' + (changed.length ? changed.length + ' changed' : 'all standard') + (ui.flagsOpen ? ' ▾' : ' ▸') + '</button>' +
    '<button type="button" class="flag-toggle" data-act="gloss:toggle" aria-expanded="' + ui.glossOpen + '" title="STLY, ITD, PCD, APCD, GPD, LF and the rest, spelled out">Abbreviations' + (ui.glossOpen ? ' ▾' : ' ▸') + '</button>' +
    show.map(a => { const on = !!ctx.flags[a.key]; return '<button type="button" class="flag' + (on !== def[a.key] ? ' changed' : '') + '" data-flag="' + a.key + '" aria-pressed="' + on + '" title="' + U.esc(a.def) + '">' + (on ? a.on : a.off) + '</button>'; }).join('');
}

/* ---------- tables: sort, filter, export ---------- */
function cellValue(td) {
  if (td.dataset.s != null) return +td.dataset.s;
  const t = td.textContent.trim();
  const m = t.match(/^([+−-]?)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(M|k|%)?/);
  if (!m) return t === '' || t === '—' ? null : t.toLowerCase();
  const n = parseFloat(m[2].replace(/,/g, '')) * (m[3] === 'M' ? 1e6 : m[3] === 'k' ? 1e3 : 1);
  return (m[1] === '−' || m[1] === '-' ? -n : n) * (/ over$/.test(t) ? -1 : 1);
}
function applySort(table) {
  const st = ui.sort[table.dataset.sortId];
  table.querySelectorAll('thead th').forEach((th, i) => th.setAttribute('aria-sort', st && st.col === i ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'));
  if (!st) return;
  const body = table.tBodies[0], rows = [...body.rows].filter(r => !/\b(sub|grp)\b/.test(r.className));
  const keyed = rows.map(r => ({ r, v: r.cells[st.col] ? cellValue(r.cells[st.col]) : null }));
  keyed.sort((a, b) => a.v === null ? 1 : b.v === null ? -1 : (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))) * st.dir);
  for (const k of keyed) body.insertBefore(k.r, body.querySelector('tr.sub'));
}
function applyFilter(input) {
  const words = (ui.filter[input.dataset.filter] || '').toLowerCase().split(/\s+/).filter(Boolean);
  const table = input.closest('.card').querySelector('table.grid');
  if (!table) return;
  for (const r of table.tBodies[0].rows) r.hidden = words.length > 0 && !words.every(w => r.textContent.toLowerCase().includes(w));
}
function exportCsv(cardId) {
  const table = document.querySelector('#card-' + cardId + ' table.grid');
  if (!table) return;
  const q = s => '"' + s.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
  const lines = [...table.rows].filter(r => !r.hidden).map(r => [...r.cells].map(c => q(c.textContent)).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
  a.download = 'cruise-booking-' + cardId + '-' + new Date(ctx.asOf * 864e5).toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function decorate() {
  document.querySelectorAll('#view .card').forEach(card => {
    if (card.querySelector('table.grid')) card.querySelector('.tools').insertAdjacentHTML('beforeend',
      '<button type="button" class="tbl-btn" data-act="csv:' + card.id.replace('card-', '') + '" title="Download this table as a CSV file">CSV</button>');
  });
  document.querySelectorAll('#view table.sortable').forEach(applySort);
  document.querySelectorAll('#view input.filter').forEach(applyFilter);
}

function render() {
  if (!D) return;
  const view = V.LIST.find(v => v.id === ui.view), isDefs = view.id === 'defs';
  $('asOfSel').value = String(ctx.asOf);
  $('yearSel').value = String(ctx.year);
  $('shipSel').value = String(ctx.ship);
  $('winTabs').innerHTML = [['ytd', 'YTD'], ['fy', 'FY' + ctx.year], ['r12', 'Rolling 12']].map(([k, l]) =>
    '<button type="button" data-act="win:' + k + '" aria-pressed="' + (ctx.window === k) + '">' + l + '</button>').join('');
  document.querySelectorAll('#srcTabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.src === ui.source)));
  document.querySelectorAll('#viewTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.act === 'view:' + ui.view)));
  $('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? 'Light theme' : 'Dark theme';

  // Controls that do not change the tab on screen are dimmed, so it is clear what a control will do before it is touched.
  const dim = (id, off, why) => { const el = $(id); el.classList.toggle('na', off); el.title = off ? why : ''; };
  dim('grpAsOf', isDefs, 'This tab does not depend on the as-of date');
  dim('grpShip', isDefs, 'This tab does not depend on the ship');
  dim('grpYear', !view.scope.includes('year'), 'The ' + view.label + ' tab is not split by sailing year');
  dim('grpWin', !view.scope.includes('window'), 'The period only changes the profit bridge, cash river and scenarios on the Flight deck');
  $('flagbar').classList.toggle('na', isDefs);
  renderFlags();
  $('gloss').hidden = !ui.glossOpen;
  renderCockpit(view);

  $('viewNote').innerHTML = view.note + (view.slides === 'all' ? '' : (ui.showDeck ? ' <span class="deck">Replaces deck slides ' + view.slides + '.</span>' : '') +
    '<button type="button" data-act="deck:toggle">' + (ui.showDeck ? 'hide deck references' : 'show deck references') + '</button>');
  $('printHead').textContent = view.label + ' · as of ' + U.dateLabel(ctx.asOf) + ' · ' + (ctx.ship < 0 ? 'Consolidated' : D.dims.ships[ctx.ship].name) +
    ' · sailing year ' + ctx.year + (V.scenTag(ctx).length ? ' · scenario: ' + V.scenTag(ctx).join(', ') : '');

  const checks = E.checks(D, ctx), pass = checks.filter(c => c.ok).length, badge = $('integrity');
  badge.className = 'tie-badge' + (pass === checks.length ? '' : ' bad');
  badge.textContent = (pass === checks.length ? '✓ ' : '! ') + 'Integrity ' + pass + '/' + checks.length;
  badge.title = 'Six cross-checks re-run on every change.\n' + checks.map(c => (c.ok ? '✓ ' : '✗ ') + c.name + ' — ' + c.detail).join('\n');

  const note = $('srcNote');
  if (ui.source === 'sigma') {
    const st = ui.sigma.state, live = st === 'connected' && D.source === 'sigma';
    const head = { loading: 'Loading from Sigma', waiting: 'Waiting for Sigma', error: 'Sigma error', standalone: 'Sigma is not connected', connected: 'Live from Sigma' }[st] || 'Sigma';
    note.hidden = false;
    note.innerHTML = '<b>' + head + '.</b> ' + U.esc(ui.sigma.message || '') +
      (live ? '' : D.source === 'sigma' ? ' The figures below are from the previous load.'
                 : ' The figures below are still the simulated data. The column contract is under <a href="#" data-act="view:defs">Definitions &amp; data</a>.');
  } else note.hidden = true;

  // Re-rendering replaces the view, so carry over what would otherwise be lost: keyboard focus and the river's animation clock.
  const host = $('view'), act = document.activeElement;
  const focusKey = act && host.contains(act) ? (act.dataset.act ? '[data-act="' + act.dataset.act + '"]' : act.dataset.filter ? '[data-filter="' + act.dataset.filter + '"]' : null) : null;
  const oldRiver = host.querySelector('.river svg'), clock = oldRiver && oldRiver.getCurrentTime ? oldRiver.getCurrentTime() : null;
  host.innerHTML = V.render[ui.view](D, ctx, ui);
  decorate();
  const newRiver = host.querySelector('.river svg');
  if (clock != null && newRiver && newRiver.setCurrentTime) newRiver.setCurrentTime(clock);
  if (focusKey) { const el = host.querySelector(focusKey); if (el) el.focus({ preventScroll: true }); }

  $('playBtn').textContent = replay ? '■ Stop' : '▶ Replay';
  $('foot').innerHTML = D.source === 'simulated'
    ? '<b>' + D.meta.company + ' is fictional.</b> Every figure on this page is synthetic and generated by the page itself. Nothing originates from any real business, and this project is not affiliated with any cruise line or hotel brand. ' +
      'Data as extracted ' + U.dateLabel(D.meta.pull) + ' for a ' + U.dateLabel(D.meta.asOf) + ' close.'
    : 'Data delivered by the Sigma workbook this page is embedded in. Extracted ' + U.dateLabel(D.meta.pull) + '.';
  writeHash();
}

/* ---------- replay ----------
   One clock runs from the first close to the last. The booking pace line is extended in
   place as the clock moves, so it flows; everything else on the tab is redrawn as each
   month-end goes by. Every close is computed once before the clock
   starts, so those redraws do not stall the motion. */
const REPLAY_SECONDS = 18;
function stopReplay() {
  if (!replay) return;
  cancelAnimationFrame(replay.raf); clearInterval(replay.timer);
  replay = null;
}
// The booking pace line: its tip, end dot and "as of" marker move to where the given moment falls.
// `at` is a fractional day, so the tip slides between days; the height uses the book at the whole day.
function paintPace(at, tix) {
  document.querySelectorAll('#view svg.livepace').forEach(svg => {
    const d = svg.dataset, denom = +d.denom, line = svg.querySelector('.live-line');
    if (!denom || !line) return;
    let booked = 0;
    for (const v of D.voyages) if (ctx.ship < 0 || v.ship === ctx.ship) booked += tix[v.i] * E.yearShare(v, +d.year, ctx.flags.prorate);
    // month-end points sit on whole indices; a day part-way through a month sits that far towards the next
    const m = U.mi(Math.floor(at)), first = U.miStart(m), pos = (m - d.start - 1) + (at - first + 1) / (U.miEnd(m) - first + 1);
    if (pos < 0 || pos > d.n - 1) return;
    const x = +d.pl + pos / (d.n - 1) * d.iw;
    const y = +d.pt + (1 - (U.clamp(booked / denom, +d.lo, +d.hi) - d.lo) / (d.hi - d.lo)) * d.ih;
    line.setAttribute('d', line.dataset.base + 'L' + x.toFixed(1) + ' ' + y.toFixed(1));
    const dot = svg.querySelector('.live-dot'), mark = svg.querySelector('.live-mark');
    if (dot) { dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1)); }
    if (mark) mark.setAttribute('transform', 'translate(' + (x - mark.dataset.x).toFixed(1) + ',0)');

    // the gap strip: a bar for the month in progress, measured against the prior-year line at this exact point
    const bar = svg.querySelector('.live-gap'), lab = svg.querySelector('.live-gaplabel'), now = svg.querySelector('.gap-now');
    if (!bar) return;
    const ref = svg._ref || (svg._ref = d.ref.split(',').map(t => t === '' ? null : +t));
    const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, d.n - 1), r0 = ref[i0], r1 = ref[i1];
    const show = r0 != null && r1 != null && pos - i0 > 1e-6;
    bar.setAttribute('visibility', show ? 'visible' : 'hidden'); lab.setAttribute('visibility', show ? 'visible' : 'hidden');
    if (now) now.setAttribute('visibility', show ? 'hidden' : 'visible');
    if (!show) return;
    const gap = booked / denom - (r0 + (r1 - r0) * (pos - i0)), h = Math.max(1, Math.min(Math.abs(gap), +d.gm) * d.gk), cx = +d.pl + i1 / (d.n - 1) * d.iw;
    bar.setAttribute('x', (cx - d.bw / 2).toFixed(1)); bar.setAttribute('y', (gap >= 0 ? d.gy0 - h : +d.gy0).toFixed(1)); bar.setAttribute('height', h.toFixed(1));
    bar.setAttribute('fill', gap >= 0 ? 'var(--good)' : 'var(--crit)');
    lab.setAttribute('x', cx.toFixed(1)); lab.setAttribute('y', (gap >= 0 ? d.gy0 - h - 5 : +d.gy0 + h + 13).toFixed(1));
    lab.setAttribute('fill', gap >= 0 ? 'var(--good-text)' : 'var(--neg)');
    lab.textContent = U.pp(gap, 1);
  });
}
function startReplay() {
  const opts = [...$('asOfSel').options].map(o => +o.value), last = opts[opts.length - 1];
  if (opts.length < 2) return;
  if (reduced) {                                   // reduced motion: one step per close, no animation
    let i = 0;
    replay = { timer: setInterval(() => { i++; if (i >= opts.length) { stopReplay(); render(); return; } ctx.asOf = opts[i]; render(); }, 1100) };
    ctx.asOf = opts[0]; render();
    return;
  }
  replay = { raf: 0, i: 0, day: opts[0], t: 0 };
  $('playBtn').textContent = 'Preparing…';
  setTimeout(() => {
    if (!replay) return;
    for (const a of opts) { ctx.asOf = a; V.render[ui.view](D, ctx, ui); E.checks(D, ctx); }
    ctx.asOf = opts[0]; render();
    const tick = now => {
      if (!replay) return;
      const R = replay;
      // a tab left in the background stops getting frames; the cap makes it carry on from where it was, not leap to the end
      if (R.t) R.day += Math.min(now - R.t, 100) / 1000 * (last - opts[0]) / REPLAY_SECONDS;
      R.t = now;
      if (R.day >= last) { stopReplay(); ctx.asOf = last; render(); return; }
      let crossed = false;
      while (R.i + 1 < opts.length && R.day >= opts[R.i + 1]) { R.i++; crossed = true; }
      if (crossed) { ctx.asOf = opts[R.i]; render(); }
      const day = Math.floor(R.day);
      if (day !== R.painted) { R.tix = E.bookedAt(D, ctx, day); R.painted = day; }
      paintPace(R.day, R.tix);
      R.raf = requestAnimationFrame(tick);
    };
    replay.raf = requestAnimationFrame(tick);
  }, 30);
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const th = ev.target.closest('table.sortable thead th');
  if (th) { sortBy(th); return; }
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  ev.preventDefault();
  const [act, arg] = el.dataset.act.split(':');
  if (act === 'csv') { exportCsv(arg); return; }
  if (act === 'view') {
    ui.view = arg; ui.focus = null;
    const top = $('viewTabs').getBoundingClientRect().top;
    if (top < 0) window.scrollTo({ top: top + window.scrollY - 12 });      // a link further down the page
  }
  else if (act === 'table') ui.tables[arg] = !V.h.showTable(ui, arg);
  else if (act === 'bridge') { ui.bridgeBase = arg; ui.focus = null; }
  else if (act === 'focus') ui.focus = (arg[0] === '_' || ui.focus === arg) ? null : arg;
  else if (act === 'rev') ui.revTab = arg;
  else if (act === 'voyq') ui.voyQ = arg;
  else if (act === 'win') ctx.window = arg;
  else if (act === 'flags') ui.flagsOpen = !ui.flagsOpen;
  else if (act === 'gloss') ui.glossOpen = !ui.glossOpen;
  else if (act === 'deck') { ui.showDeck = !ui.showDeck; store.set('deck', ui.showDeck ? '1' : '0'); }
  render();
});
function sortBy(th) {
  const table = th.closest('table'), id = table.dataset.sortId, col = th.cellIndex, cur = ui.sort[id];
  ui.sort[id] = { col, dir: cur && cur.col === col ? -cur.dir : (th.classList.contains('l') ? 1 : -1) };
  applySort(table);
}
document.addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('table.sortable thead th')) { ev.preventDefault(); sortBy(ev.target); }
});
document.addEventListener('input', ev => {
  const f = ev.target.closest && ev.target.closest('input.filter');
  if (f) { ui.filter[f.dataset.filter] = f.value; applyFilter(f); }
});
$('flagbar').addEventListener('click', ev => {
  const b = ev.target.closest('.flag');
  if (!b) return;
  ctx.flags[b.dataset.flag] = !ctx.flags[b.dataset.flag];
  render();
});
$('asOfSel').addEventListener('change', ev => { stopReplay(); ctx.asOf = +ev.target.value; render(); });
$('yearSel').addEventListener('change', ev => { ctx.year = +ev.target.value; render(); });
$('shipSel').addEventListener('change', ev => { ctx.ship = +ev.target.value; render(); });
$('playBtn').addEventListener('click', () => {
  if (replay) { stopReplay(); render(); return; }
  startReplay();
});
$('resetBtn').addEventListener('click', () => {
  stopReplay();
  const d = E.defaults();
  Object.assign(ctx.flags, d.flags); Object.assign(ctx.terms, d.terms); Object.assign(ctx.scen, d.scen);
  ctx.window = d.window; ctx.ship = -1; ctx.asOf = D.meta.asOf; ctx.year = U.miYear(U.mi(ctx.asOf));
  ui.tables = {}; ui.bridgeBase = 'bud'; ui.focus = null; ui.revTab = 'month'; ui.voyQ = 'all'; ui.sort = {}; ui.filter = {}; ui.flagsOpen = false;
  render();
});
$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
  render();
});
$('printBtn').addEventListener('click', () => window.print());
$('linkBtn').addEventListener('click', () => {
  const btn = $('linkBtn'), done = ok => { btn.textContent = ok ? 'Link copied' : 'Copy from the address bar'; setTimeout(() => { btn.textContent = 'Copy link'; }, 1800); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(() => done(true), () => done(false));
  else done(false);
});
$('srcTabs').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-src]');
  if (!b || b.dataset.src === ui.source) return;
  stopReplay();
  ui.source = b.dataset.src;
  if (ui.source === 'simulated') { load(simD); return; }
  ui.sigma = { state: 'loading', message: 'Connecting to Sigma.' };
  render();
  CBR.sigma.connect(s => {
    ui.sigma = s;
    if (ui.source !== 'sigma') return;
    if (s.state === 'connected' && s.dataset) load(s.dataset); else render();
  });
});

/* ---------- one tooltip for every chart, by mouse or touch ---------- */
const tipEl = $('tip');
let tipTimer = null;
function showTip(ev) {
  const el = ev.target.closest && ev.target.closest('[data-tip]');
  if (!el) { tipEl.style.display = 'none'; return; }
  tipEl.textContent = el.dataset.tip;
  tipEl.style.display = 'block';
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, ev.clientX + 14)) + 'px';
  tipEl.style.top = Math.max(8, ev.clientY + 16 + h > window.innerHeight ? ev.clientY - h - 12 : ev.clientY + 16) + 'px';
  clearTimeout(tipTimer);
  if (ev.pointerType === 'touch') tipTimer = setTimeout(() => { tipEl.style.display = 'none'; }, 3500);
}
document.addEventListener('pointermove', showTip);
document.addEventListener('pointerdown', showTip);
document.addEventListener('scroll', () => { tipEl.style.display = 'none'; }, { passive: true });

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const n = isNarrow(); if (n !== ui.narrow) { ui.narrow = n; render(); } }, 150);
});

simD = CBR.buildSimulated();
load(simD, true);
})();
