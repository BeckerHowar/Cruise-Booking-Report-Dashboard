/* State and wiring. Nothing is computed here: every control mutates ctx or ui
   and calls render(), which asks the views for fresh HTML. */
(function () {
'use strict';
const { util: U, engine: E, views: V } = CBR;
const $ = id => document.getElementById(id);
const SAVE_KEY = 'cbr.savedScenario';

const SLIDERS = [
  { key: 'vol',    label: 'Volume',        min: -0.30, max: 0.30, step: 0.05,  fmt: v => U.signedPct(v, 0), tip: 'Bookings still to come on unsailed voyages, against what the booking curve expects.' },
  { key: 'price',  label: 'Price',         min: -0.10, max: 0.10, step: 0.01,  fmt: v => U.signedPct(v, 0), tip: 'List fare on the bookings still to come.' },
  { key: 'cancel', label: 'Cancellations', min: -0.50, max: 1.00, step: 0.10,  fmt: v => U.signedPct(v, 0), tip: 'Cancellation rate on the unsailed book, relative to the rate history shows.' },
  { key: 'dil',    label: 'Dilution',      min: -0.03, max: 0.05, step: 0.005, fmt: v => U.pp(v, 1),        tip: 'Discounting on the bookings still to come, in points of list fare.' },
  { key: 'fuel',   label: 'Fuel',          min: -0.30, max: 0.50, step: 0.05,  fmt: v => U.signedPct(v, 0), tip: 'Fuel price in the months after the close.' },
];

let D = null, simD = null, replay = null;
const ctx = E.defaults();
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ui = { view: 'flight', tables: {}, bridgeBase: 'bud', focus: null, revTab: 'month', voyQ: 'all', saved: null,
             source: 'simulated', sigma: { state: 'idle', message: '' }, still: reduced };

try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && typeof s.vol === 'number') ui.saved = s; } catch (e) { /* storage unavailable */ }

function load(dataset) {
  D = E.prepare(dataset);
  ctx.asOf = D.meta.asOf;
  ctx.year = U.miYear(U.mi(ctx.asOf));
  ctx.ship = -1;
  buildSelects();
  render();
}

function buildSelects() {
  const am = U.mi(D.meta.asOf), cy = U.miYear(am);
  const closes = [];
  for (let m = am - 11; m <= am; m++) if (m > D.range.minMi) closes.push(m === am ? D.meta.asOf : U.miEnd(m));
  $('asOfSel').innerHTML = closes.map(d => '<option value="' + d + '">' + U.dateLabel(d) + '</option>').join('');
  const years = [...new Set(D.voyages.map(v => v.year))].filter(y => y >= cy).sort();
  $('yearSel').innerHTML = years.map(y => '<option value="' + y + '">' + y + '</option>').join('');
  $('shipSel').innerHTML = '<option value="-1">Consolidated</option>' + D.dims.ships.map((s, i) => '<option value="' + i + '">' + U.esc(s.name) + '</option>').join('');
  $('viewTabs').innerHTML = V.LIST.map(v => '<button role="tab" data-act="view:' + v.id + '">' + v.label + '</button>').join('');
  $('flagbar').innerHTML = '<span class="fl-label">Adjustments</span>' + V.ADJUSTMENTS.map(a =>
    '<button type="button" class="flag" data-flag="' + a.key + '" title="' + U.esc(a.def) + '"></button>').join('');
  $('cockpit').innerHTML =
    '<span class="ck-title" title="Each slider moves the unsailed book only. Closed months never restate, so the outlook, the profit bridge and the cash river move while the booked position stays put.">Scenario cockpit</span>' +
    SLIDERS.map(s => '<div class="ck-s"><label class="ck-top" for="ck_' + s.key + '" title="' + U.esc(s.tip) + '"><span>' + s.label + '</span><span class="ck-val" id="ckv_' + s.key + '"></span></label>' +
      '<input type="range" id="ck_' + s.key + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '"></div>').join('') +
    '<div class="ck-actions"><button type="button" class="btn" id="ckReset" title="Return every slider to zero">Reset</button>' +
    '<button type="button" class="btn primary" id="ckSave" title="Keep this slider set as the saved scenario, shown beside base in the scenarios table">Save</button></div>';
  for (const s of SLIDERS) $('ck_' + s.key).addEventListener('input', ev => { ctx.scen[s.key] = parseFloat(ev.target.value); render(); });
  $('ckReset').addEventListener('click', () => { for (const s of SLIDERS) ctx.scen[s.key] = 0; render(); });
  $('ckSave').addEventListener('click', () => {
    ui.saved = { ...ctx.scen };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(ui.saved)); } catch (e) { /* storage unavailable */ }
    render();
  });
}

function render() {
  if (!D) return;
  $('asOfSel').value = String(ctx.asOf);
  $('yearSel').value = String(ctx.year);
  $('shipSel').value = String(ctx.ship);
  const cy = U.miYear(U.mi(ctx.asOf));
  $('winTabs').innerHTML = [['ytd', 'YTD'], ['fy', 'FY' + ctx.year], ['r12', 'Rolling 12']].map(([k, l]) =>
    '<button role="tab" data-act="win:' + k + '" aria-selected="' + (ctx.window === k) + '">' + l + '</button>').join('');
  document.querySelectorAll('#srcTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.src === ui.source)));
  document.querySelectorAll('#viewTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.act === 'view:' + ui.view)));
  document.querySelectorAll('#flagbar .flag').forEach(b => {
    const a = V.ADJUSTMENTS.find(x => x.key === b.dataset.flag), on = !!ctx.flags[a.key];
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? a.on : a.off;
  });
  for (const s of SLIDERS) { $('ck_' + s.key).value = ctx.scen[s.key]; $('ckv_' + s.key).textContent = s.fmt(ctx.scen[s.key]); }

  const view = V.LIST.find(v => v.id === ui.view);
  $('viewNote').innerHTML = view.note + (view.slides === 'all' ? '' : ' <span class="deck">Deck slides ' + view.slides + '.</span>');

  const checks = E.checks(D, ctx), pass = checks.filter(c => c.ok).length, badge = $('integrity');
  badge.className = 'tie-badge' + (pass === checks.length ? '' : ' bad');
  badge.textContent = (pass === checks.length ? '✓ ' : '! ') + 'Integrity ' + pass + '/' + checks.length;
  badge.title = checks.map(c => (c.ok ? '✓ ' : '✗ ') + c.name + ' — ' + c.detail).join('\n');

  const note = $('srcNote');
  if (ui.source === 'sigma') {
    const st = ui.sigma.state, live = st === 'connected' && D.source === 'sigma';
    const head = { loading: 'Loading from Sigma', waiting: 'Waiting for Sigma', error: 'Sigma error', standalone: 'Sigma is not connected', connected: 'Live from Sigma' }[st] || 'Sigma';
    note.hidden = false;
    note.innerHTML = '<b>' + head + '.</b> ' + U.esc(ui.sigma.message || '') +
      (live ? '' : D.source === 'sigma' ? ' The figures below are from the previous load.'
                 : ' The figures below are still the simulated data. The column contract is under <a href="#" data-act="view:defs">Definitions &amp; data</a>.');
  } else note.hidden = true;

  $('view').innerHTML = V.render[ui.view](D, ctx, ui);
  $('playBtn').textContent = replay ? '■ Stop' : '▶ Replay';
  $('foot').innerHTML = D.source === 'simulated'
    ? '<b>' + D.meta.company + ' is fictional.</b> Every figure on this page is synthetic and generated by the page itself. Nothing originates from any real business, and this project is not affiliated with any cruise line or hotel brand. ' +
      'Data as extracted ' + U.dateLabel(D.meta.pull) + ' for a ' + U.dateLabel(D.meta.asOf) + ' close · ' + (cy) + ' is the current sailing year.'
    : 'Data delivered by the Sigma workbook this page is embedded in. Extracted ' + U.dateLabel(D.meta.pull) + '.';
}

function stopReplay() { if (replay) { clearInterval(replay); replay = null; } }

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  const [act, arg] = el.dataset.act.split(':');
  if (act === 'view') {
    ui.view = arg; ui.focus = null;
    const top = $('viewTabs').getBoundingClientRect().top;
    if (top < 0) window.scrollTo({ top: top + window.scrollY - 12 });      // a link further down the page
  }
  else if (act === 'table') ui.tables[arg] = !ui.tables[arg];
  else if (act === 'bridge') { ui.bridgeBase = arg; ui.focus = null; }
  else if (act === 'focus') ui.focus = (arg[0] === '_' || ui.focus === arg) ? null : arg;
  else if (act === 'rev') ui.revTab = arg;
  else if (act === 'voyq') ui.voyQ = arg;
  else if (act === 'win') ctx.window = arg;
  render();
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
  const opts = [...$('asOfSel').options].map(o => +o.value);
  let i = 0;
  ctx.asOf = opts[0]; render();
  replay = setInterval(() => {
    i++;
    if (i >= opts.length) { stopReplay(); render(); return; }
    ctx.asOf = opts[i]; render();
  }, 1100);
  render();
});
$('resetBtn').addEventListener('click', () => {
  stopReplay();
  const d = E.defaults();
  Object.assign(ctx.flags, d.flags); Object.assign(ctx.terms, d.terms); Object.assign(ctx.scen, d.scen);
  ctx.window = d.window; ctx.ship = -1; ctx.asOf = D.meta.asOf; ctx.year = U.miYear(U.mi(ctx.asOf));
  ui.tables = {}; ui.bridgeBase = 'bud'; ui.focus = null; ui.revTab = 'month'; ui.voyQ = 'all';
  render();
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

simD = CBR.buildSimulated();
load(simD);
})();
