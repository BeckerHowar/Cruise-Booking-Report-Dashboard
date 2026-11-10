/* View helpers and the flight deck. Each view is a function (D, ctx, ui) that
   returns an HTML string; main.js owns state and re-renders on every change. */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util, E = CBR.engine, C = CBR.charts;
const V = CBR.views = { render: {} };

V.LIST = [
  { id: 'flight',   label: 'Flight deck',     slides: '2–3, 7–8', note: 'The one-page read: where the book stands, what moved profit, where the cash went. Every figure is assembled from the booking table.' },
  { id: 'pace',     label: 'Pace',            slides: '22–28, 85–88', note: 'Booking curves against the same point in prior years, the booking window split, and the consolidated report by quarter.' },
  { id: 'togo',     label: 'Revenue to-go',   slides: '9–21, 43–46', note: 'Target less booked, by ship, quarter, region and voyage.' },
  { id: 'channels', label: 'Channels',        slides: '4–6', note: 'Channel mix and the strategic agency roster.' },
  { id: 'suites',   label: 'Suites',          slides: '30–33', note: 'Suite tier mix against budget, and what each tier earns.' },
  { id: 'guests',   label: 'Guests',          slides: '34–37, 54–58, 73–78', note: 'Guests sailed, bookers, repeaters, future-voyage conversion and guest geography.' },
  { id: 'dilution', label: 'Dilution & cancellations', slides: '38–42, 59–60', note: 'Discount take rates, cancellation behaviour and the policies behind both.' },
  { id: 'voyages',  label: 'Voyages',         slides: '61–72, 79–84', note: 'Every voyage against forecast, budget and its own position three months ago.' },
  { id: 'revenue',  label: 'Revenue tables',  slides: '48–51', note: 'Booking production for the month, the trailing three months and the trailing twelve.' },
  { id: 'defs',     label: 'Definitions & data', slides: 'all', note: 'Every measure, dimension and adjustment, the deck-to-view map, and the Sigma data contract.' },
];

V.ADJUSTMENTS = [
  { key: 'barter',    on: 'Barter included',        off: 'Barter excluded',
    def: 'Non-cash barter revenue recognised under IFRS — suites exchanged for media. Included in some deck views and excluded in others, which is the largest consistency trap in the pack. One switch here applies to every view.' },
  { key: 'c2cNorm',   on: 'C2C transfers normalised', off: 'C2C transfers as recorded',
    def: 'Since the policy change, a cruise-to-cruise transfer records a cancellation penalty on the old booking and offsetting dilution on the new one. That inflates both series and breaks year-on-year comparison. Normalising removes the penalty and its offset.' },
  { key: 'revOnly',   on: 'Revenue guests only',     off: 'All guests',
    def: 'Hosted and complimentary guests are left out of guest counts and passenger cruise days.' },
  { key: 'apcdNet',   on: 'APCDs net of non-revenue voyages', off: 'APCDs include non-revenue voyages',
    def: 'Capacity excludes voyages that sailed without revenue guests. This changes the denominator of every load factor.' },
  { key: 'prorate',   on: 'Voyages prorated',        off: 'Voyages on sail date',
    def: 'A voyage that spans a month end is either split by sailing days or assigned whole to its sail month. The deck prorates forecast and does not prorate booked revenue; this switch applies one convention to both. The profit bridge always prorates.' },
  { key: 'alignAsOf', on: 'Dilution held to as-of date', off: 'Dilution through data pull',
    def: 'The extract is pulled a few days after the close. With this off, the dilution and promotion views include bookings up to the pull date, as the deck does.' },
  { key: 'charterEx', on: 'Charters out of window split', off: 'Charters in window split',
    def: 'Full-ship charters are booked in one block and distort the booking-window split, so they are excluded from it.' },
];

/* ---------- building blocks ---------- */
const H = V.h = {};
H.card = (id, num, title, sub, body, tools) =>
  '<section class="card" id="card-' + id + '"><div class="card-head"><div><h2><span class="num">' + num + '</span>' + title + '</h2>' +
  (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' + (tools ? '<div class="tools">' + tools + '</div>' : '') + '</div>' + body + '</section>';
H.tableBtn = (id, ui) => '<button type="button" class="tbl-btn" data-act="table:' + id + '" aria-pressed="' + !!ui.tables[id] + '">' + (ui.tables[id] ? 'Chart' : 'Table') + '</button>';
H.tabs = (act, items, cur, label) => '<div class="tabs" role="tablist" aria-label="' + (label || '') + '">' + items.map(([k, l]) =>
  '<button role="tab" data-act="' + act + ':' + k + '" aria-selected="' + (String(k) === String(cur)) + '">' + l + '</button>').join('') + '</div>';
H.stat = (label, def, value, ctx, cls) =>
  '<div class="stat"><div class="st-l" title="' + U.esc(def || '') + '"><u>' + label + '</u></div><div class="st-v' + (cls ? ' ' + cls : '') + '">' + value + '</div>' +
  (ctx ? '<div class="st-c">' + ctx + '</div>' : '') + '</div>';
H.table = function (cols, rows, cls) {
  let h = '<div class="tblwrap"><table class="grid ' + (cls || '') + '"><thead><tr>' +
    cols.map(c => '<th class="' + (c.l ? 'l' : '') + '"' + (c.tip ? ' title="' + U.esc(c.tip) + '"' : '') + '>' + c.h + '</th>').join('') + '</tr></thead><tbody>';
  for (const r of rows) {
    const cells = r.cells || r;
    h += '<tr class="' + (r.cls || '') + '">' + cells.map((c, i) => {
      const o = (c !== null && typeof c === 'object') ? c : { v: c };
      return '<td class="' + ((cols[i] && cols[i].l) ? 'l ' : '') + (o.cls || '') + '"' + (o.style ? ' style="' + o.style + '"' : '') + (o.tip ? ' title="' + U.esc(o.tip) + '"' : '') + '>' + (o.v == null ? '—' : o.v) + '</td>';
    }).join('') + '</tr>';
  }
  return h + '</tbody></table></div>';
};
// A signed cell coloured by whether the direction is good news.
H.delta = (v, fmt, goodUp, eps) => (v == null || !isFinite(v)) ? { v: '—' }
  : { v: fmt(v), cls: Math.abs(v) < (eps == null ? 1e-9 : eps) ? '' : ((v > 0) === (goodUp !== false) ? 'fav' : 'unfav') };
H.body = html => '<div class="chart-body">' + html + '</div>';
H.lead = html => '<p class="lead">' + html + '</p>';
H.shipName = (D, ctx) => ctx.ship < 0 ? 'Consolidated' : D.dims.ships[ctx.ship].name;
H.months = (from, to) => { const a = []; for (let m = from; m <= to; m++) a.push(m); return a; };
H.listOf = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];

V.scenTag = function (ctx) {
  const s = ctx.scen, p = [];
  if (s.vol) p.push('Volume ' + U.signedPct(s.vol, 0));
  if (s.price) p.push('Price ' + U.signedPct(s.price, 0));
  if (s.cancel) p.push('Cancellations ' + U.signedPct(s.cancel, 0));
  if (s.dil) p.push('Dilution ' + U.pp(s.dil, 1));
  if (s.fuel) p.push('Fuel ' + U.signedPct(s.fuel, 0));
  return p;
};

/* =====================================================================
   FLIGHT DECK
   ===================================================================== */
function kpis(D, ctx) {
  const Hd = E.headline(D, ctx), [a, b] = Hd.years, am = U.mi(ctx.asOf);
  const tile = (label, value, sub, cls, tip) =>
    '<div class="kpi"' + (tip ? ' title="' + U.esc(tip) + '"' : '') + '><div class="k-label">' + label + '</div><div class="k-value">' + value + '</div>' +
    '<div class="k-ctx' + (cls ? ' ' + cls : '') + '">' + sub + '</div></div>';
  const sign = (v, good) => Math.abs(v) < 1e-9 ? '' : ((v > 0) === good ? 'fav' : 'unfav');
  const dOut = a.outlook - a.tgt, yoy = Hd.netLy ? Hd.netMonth / Hd.netLy - 1 : null;
  return '<div class="kpis">' +
    tile(a.year + ' booked', U.money(a.tix), U.pct(a.pct) + ' of ' + a.label + ' · ' + U.money(Math.max(0, a.togo)) + ' to go', '',
         'Ticket revenue on the books for ' + a.year + ' sailings: active bookings net of dilution, plus cancellation fees kept.') +
    tile(b.year + ' booked', U.money(b.tix), U.pct(b.pct) + ' of ' + b.label + ' · ' + U.pp(b.pct - b.lyPct) + ' vs STLY', sign(b.pct - b.lyPct, true),
         'Share of target secured, against the share ' + (b.year - 1) + ' sailings had secured at the same calendar point a year earlier.') +
    tile(a.year + ' outlook', U.money(a.outlook), U.signedMoney(dOut) + ' vs ' + a.label, sign(dOut, true),
         'Sailed voyages at actual plus the projected finish of every unsailed voyage. The scenario cockpit moves the projected part.') +
    tile('Load factor ' + a.year, U.pct(a.lf), U.pp(a.lf - a.lyLf) + ' vs STLY', sign(a.lf - a.lyLf, true),
         'Passenger cruise days booked over available passenger cruise days. Booking pace to date, not final occupancy.') +
    tile('GPD ' + a.year, U.dollars(a.gpd), U.signedMoney(a.gpd - a.tgtGpd) + ' vs ' + a.label, sign(a.gpd - a.tgtGpd, true),
         'Gross price per day: ticket revenue over passenger cruise days.') +
    tile('Net bookings, ' + U.miLabel(am), U.money(Hd.netMonth), yoy == null ? 'no prior-year month' : U.signedPct(yoy) + ' vs ' + U.miLabel(am - 12), yoy == null ? '' : sign(yoy, true),
         'Bookings produced in the month, less the month\'s cancellations, plus cancellation fees.') +
    tile('Guest deposits held', U.money(Hd.held), 'paid in on unsailed voyages', '',
         'Cash already collected from guests for voyages that have not sailed yet.') +
    '</div>';
}

function bridgeSteps(D, br, baseName) {
  const steps = [{ key: '_b', label: baseName, kind: 'total', value: br.base.profit }];
  for (const s of E.BRIDGE) {
    if ((s.key === 'voy' || s.key === 'shore') && !D.costs) continue;
    steps.push({ key: s.key, label: s.label, kind: 'delta', value: br.comps[s.key], tip: s.def });
  }
  steps.push({ key: '_a', label: br.W.forecast ? 'Outlook' : 'Actual', kind: 'total', value: br.act.profit });
  return steps;
}

function bridgeCard(D, ctx, ui) {
  const br = E.bridge(D, ctx, ui.bridgeBase), names = { bud: 'Budget', fc: 'Forecast', stly: 'Prior year' };
  const B = br.base, A = br.act, gp = (x, y) => y ? x / y : null;
  let body;
  if (ui.tables.bridge) {
    const row = (comp, label, b, a, fmt, impact, sub) => ({
      cls: (sub ? 'sub' : '') + (ui.focus && comp !== ui.focus && !sub ? ' dim' : ''),
      cells: [label, b == null ? '—' : fmt(b), a == null ? '—' : fmt(a),
              (b == null || a == null) ? '—' : fmt === U.pct ? U.pp(a - b) : (a - b >= 0 ? '+' : '−') + fmt(Math.abs(a - b)),
              impact == null ? '' : H.delta(impact, U.signedMoney, true, 0.5)] });
    const rows = [
      row('volume', 'Passenger cruise days', B.pcd, A.pcd, U.int, br.comps.volume),
      row('volume', 'Load factor', gp(B.pcd, B.apcd), gp(A.pcd, A.apcd), U.pct, null),
      row('mix', 'Premium share of guest days', gp(B.pcdT[0], B.pcd), gp(A.pcdT[0], A.pcd), U.pct, br.comps.mix),
      row('price', 'List fare per guest day', gp(B.list, B.pcd), gp(A.list, A.pcd), U.dollars, br.comps.price),
      row('dil', 'Dilution, % of list', gp(B.dil, B.list), gp(A.dil, A.list), U.pct, br.comps.dil),
      row('fees', 'Cancellation fees kept', B.fee, A.fee, U.money, br.comps.fees),
      row(null, 'Ticket revenue', B.rev, A.rev, U.money, br.comps.volume + br.comps.mix + br.comps.price + br.comps.dil + br.comps.fees, true),
      row('comm', 'Trade commissions', -B.comm, -A.comm, U.money, br.comps.comm),
    ];
    if (D.costs) rows.push(
      row('voy', 'Fuel', -B.cost.fuel, -A.cost.fuel, U.money, null),
      row('voy', 'Crew', -B.cost.crew, -A.cost.crew, U.money, null),
      row('voy', 'Provisioning', -B.cost.prov, -A.cost.prov, U.money, null),
      row('voy', 'Port and maintenance', -(B.cost.port + B.cost.maint), -(A.cost.port + A.cost.maint), U.money, null),
      row('voy', 'Voyage costs', -B.voy, -A.voy, U.money, br.comps.voy, true),
      row('shore', 'Marketing, shoreside and G&A', -B.shore, -A.shore, U.money, br.comps.shore));
    rows.push(row(null, 'Voyage profit', B.profit, A.profit, U.money, br.gap, true));
    body = H.table([{ h: 'Driver / line', l: 1 }, { h: names[br.baseline] }, { h: br.W.forecast ? 'Outlook' : 'Actual' }, { h: 'Change' }, { h: 'Profit impact' }], rows, 'varn');
  } else {
    body = H.body(C.waterfall(bridgeSteps(D, br, names[br.baseline]), { focus: ui.focus, label: 'Profit bridge, ' + names[br.baseline] + ' to ' + (br.W.forecast ? 'outlook' : 'actual') }));
  }
  const pct = B.profit ? br.gap / Math.abs(B.profit) : null;
  return H.card('bridge', '02', 'Profit bridge',
    'Voyage profit, ' + names[br.baseline].toLowerCase() + ' to ' + (br.W.forecast ? 'outlook' : 'actual') + ' · ' + br.W.label + ' · ' + H.shipName(D, ctx) +
    ' · ' + (br.gap >= 0 ? 'favourable ' : 'unfavourable ') + U.money(Math.abs(br.gap)) + (pct == null ? '' : ' (' + U.signedPct(pct, 0) + ')'),
    body + '<div class="foot-note">Each bar swaps one driver from ' + names[br.baseline].toLowerCase() + ' to ' + (br.W.forecast ? 'outlook' : 'actual') +
    ' and holds the rest. The bars sum to the gap exactly, with no residual. Click a bar to isolate it.' +
    (D.costs ? '' : ' Operating costs are not in the booking extract, so this bridge stops at ticket revenue less commissions.') + '</div>',
    H.tabs('bridge', [['bud', 'vs Budget'], ['fc', 'vs Forecast'], ['stly', 'vs Prior year']], ui.bridgeBase, 'Bridge baseline') + H.tableBtn('bridge', ui));
}

function riverCard(D, ctx, ui) {
  const rv = E.river(D, ctx);
  let body;
  if (ui.tables.river) {
    const n = Math.max(rv.sources.length, rv.uses.length), rows = [];
    for (let i = 0; i < n; i++) {
      const s = rv.sources[i], u = rv.uses[i];
      rows.push([s ? s.name : '', s ? U.money(s.value) : '', s ? U.pct(s.value / rv.moved, 0) : '', u ? u.name : '', u ? U.money(u.value) : '', u ? U.pct(u.value / rv.moved, 0) : '']);
    }
    rows.push({ cls: 'sub', cells: ['Cash in', U.money(rv.moved), '100%', 'Cash out and reserves', U.money(rv.moved), '100%'] });
    body = H.table([{ h: 'Where it came from', l: 1 }, { h: 'Amount' }, { h: 'Share' }, { h: 'Where it went', l: 1 }, { h: 'Amount' }, { h: 'Share' }], rows);
  } else {
    body = '<div class="river">' + C.river(rv.sources, rv.uses, { still: ui.still }) + '</div>';
  }
  const note = rv.W.forecast
    ? 'Months after the close are the schedule the current book implies: final payments falling due, pickup still to arrive, refunds on the cancellations still to come.'
    : 'Every month in this window is closed, so this is cash that has actually moved.';
  return H.card('river', '03', 'Cash river', 'Cash in and out · ' + rv.W.label + ' · ' + H.shipName(D, ctx),
    body + '<div class="foot-note">Guest payments follow the payment terms: a ' + U.pct(ctx.terms.deposit, 0) + ' deposit at booking and the balance ' +
    ctx.terms.finalDays + ' days before sailing. ' + note +
    (D.costs ? (ctx.ship >= 0 ? ' Shoreside cost and debt service are fleet-level and are left out for a single ship.' : '')
             : ' Operating costs are not in the booking extract, so only refunds and commissions flow out.') + '</div>',
    H.tableBtn('river', ui));
}

function cashMonthsCard(D, ctx, ui) {
  const rows = E.cashMonths(D, ctx, 9, 12), cut = rows.findIndex(r => r.forecast);
  let body;
  if (ui.tables.cashm) {
    body = H.table([{ h: 'Month', l: 1 }, { h: 'Guest receipts' }, { h: 'Refunds' }, { h: 'Commissions' }, { h: 'Operating' }, { h: 'Debt & drydock' }, { h: 'Net cash' }],
      rows.map(r => ({ cls: r.forecast ? 'memo' : '', cells: [U.miLabel(r.mi) + (r.forecast ? ' · sched.' : ''), U.money(r.cashIn), U.money(-r.refunds), U.money(-r.comm),
                       U.money(-r.ops), U.money(-(r.debt + r.dry)), H.delta(r.net, U.signedMoney, true, 0.5)] })));
  } else {
    body = H.body(C.signed({ labels: rows.map(r => U.miLabel(r.mi)), values: rows.map(r => r.net), fadeFrom: cut < 0 ? null : cut, markAt: cut < 0 ? null : cut,
      tips: rows.map(r => 'Receipts ' + U.money(r.cashIn) + ', out ' + U.money(r.cashOut)), tipFmt: U.signedMoney, label: 'Net cash by month' }));
  }
  return H.card('cashm', '04', 'Net cash by month', 'Receipts less everything paid out · nine months closed, twelve scheduled', body, H.tableBtn('cashm', ui));
}

V.scenarioMetrics = function (D, ctx, scen) {
  const c = { ...ctx, scen }, cy = U.miYear(U.mi(ctx.asOf));
  const br = E.bridge(D, c, 'bud'), rv = E.river(D, c);
  return { out0: E.outlookTotal(D, c, cy).tix, out1: E.outlookTotal(D, c, cy + 1).tix, profit: br.act.profit, gap: br.gap, reserves: rv.net, cy, W: br.W };
};

function scenariosCard(D, ctx, ui) {
  const zero = { vol: 0, price: 0, cancel: 0, dil: 0, fuel: 0 };
  const base = V.scenarioMetrics(D, ctx, zero), live = V.scenarioMetrics(D, ctx, ctx.scen);
  const saved = ui.saved ? V.scenarioMetrics(D, ctx, ui.saved) : null;
  const tagOf = s => V.scenTag({ scen: s }).join(' · ') || 'no adjustments';
  const cell = (m, k, isBase) => {
    if (!m) return { v: '—' };
    if (isBase) return U.money(m[k]);
    const d = m[k] - base[k];
    return { v: U.money(m[k]) + (Math.abs(d) > 500 ? ' <small>' + U.signedMoney(d) + '</small>' : ''), cls: Math.abs(d) < 500 ? '' : d > 0 ? 'fav' : 'unfav' };
  };
  const line = (label, k) => [label, cell(base, k, true), cell(saved, k), cell(live, k)];
  const rows = [
    line(base.cy + ' revenue outlook', 'out0'),
    line((base.cy + 1) + ' revenue outlook', 'out1'),
    line('Voyage profit · ' + base.W.short, 'profit'),
    line('Profit vs budget · ' + base.W.short, 'gap'),
    line('Cash to reserves · ' + base.W.short, 'reserves'),
  ];
  return H.card('scen', '05', 'Scenarios, side by side', 'Colour shows better or worse than base',
    H.table([{ h: '', l: 1 }, { h: 'Base' }, { h: 'Saved', tip: ui.saved ? tagOf(ui.saved) : 'Nothing saved yet. Set the cockpit and press Save.' }, { h: 'Cockpit now', tip: tagOf(ctx.scen) }], rows, 'scen') +
    '<div class="foot-note"><b>Saved:</b> ' + (ui.saved ? tagOf(ui.saved) : 'nothing saved yet — set the cockpit and press Save') +
    '. <b>Cockpit now:</b> ' + tagOf(ctx.scen) + '. The cockpit moves the unsailed book only; closed months never restate' +
    (base.W.forecast ? '.' : ', so the ' + base.W.short + ' rows do not respond to it.') + '</div>');
}

function paceCard(D, ctx, year, num, id) {
  const cv = E.curves(D, ctx, year), labels = H.months(cv.startMi, cv.startMi + cv.N - 1).map(U.miLabel);
  const tgt = E.targetLabel(D, year);
  return H.card(id, num, year + ' booking pace', 'Cumulative booked revenue as a share of ' + tgt + ' · ' + H.shipName(D, ctx) +
    (cv.gap == null ? '' : ' · ' + U.pp(cv.gap) + ' vs the same point last year'),
    H.body(C.lines({ labels, every: 3, width: 1120, height: 300, yFmt: C.axisPct, tipFmt: v => U.pct(v), markAt: cv.at, markLabel: 'as of',
      series: [{ name: (year - 2) + ' sailings', color: 'var(--c8)', values: cv.y2.pct, dashed: '2 3', width: 1.5 },
               { name: (year - 1) + ' sailings', color: 'var(--muted)', values: cv.stly.pct, dashed: '5 3', width: 1.6 },
               { name: year + ' sailings', color: 'var(--c1)', values: cv.cy.pct, width: 2.4 }],
      label: year + ' booking curve against prior years' })) +
    C.legend([{ name: year + ' sailings', color: 'var(--c1)' }, { name: (year - 1) + ', one year earlier', color: 'var(--muted)', dash: 1 }, { name: (year - 2) + ', two years earlier', color: 'var(--c8)', dash: 1 }]));
}
V.paceCard = paceCard;

function watchTable(D, rows) {
  return H.table(
    [{ h: 'Voyage', l: 1 }, { h: 'Ship', l: 1 }, { h: 'Sails', l: 1 }, { h: 'Region', l: 1 }, { h: 'Days out' }, { h: 'Target' }, { h: 'Booked' }, { h: '% booked' },
     { h: 'Curve says', tip: 'The share of the final book a typical voyage has secured this many days before sailing, from voyages that have already sailed.' },
     { h: 'Pace' }, { h: 'To go' }, { h: 'Outlook' }],
    rows.map(r => [r.v.code + (r.v.charter ? ' <span class="pill">charter</span>' : ''), D.dims.ships[r.v.ship].name, U.shortDate(r.v.sail) + ' · D' + r.v.days, D.dims.regions[r.v.region],
      r.dts, U.money(r.target), U.money(r.tix), U.pct(r.pct, 0), U.pct(r.expected, 0), H.delta(r.pace, v => U.pp(v, 0), true, 0.005),
      U.money(r.togo), H.delta(r.outlook - r.target, U.signedMoney, true, 500)]));
}
V.watchTable = watchTable;

function narrative(D, ctx, ui) {
  const br = E.bridge(D, ctx, ui.bridgeBase), rv = E.river(D, ctx), Hd = E.headline(D, ctx), [, b] = Hd.years;
  const names = { bud: 'budget', fc: 'forecast', stly: 'the prior year' };
  const comps = E.BRIDGE.map(s => ({ ...s, value: br.comps[s.key] })).filter(c => Math.abs(c.value) > 5e4).sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const miss = br.gap < 0, same = comps.filter(c => (c.value < 0) === miss).slice(0, 3), against = comps.filter(c => (c.value < 0) !== miss).slice(0, 2);
  const fmtC = c => c.label.toLowerCase() + ' (<span class="' + (c.value >= 0 ? 'up' : 'dn') + '">' + U.signedMoney(c.value) + '</span>)';
  const verb = br.W.forecast ? 'is tracking to' : 'closed at';
  let what = '<p><b>Voyage profit ' + verb + ' ' + U.money(br.act.profit) + '</b> for ' + br.W.label + ' against ' + names[br.baseline] + ' of ' + U.money(br.base.profit) + ' — ' +
    (Math.abs(br.gap) < 5e4 ? 'in line' : '<span class="' + (miss ? 'dn' : 'up') + '">' + U.signedMoney(br.gap) + '</span>') + '. ';
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  if (same.length) what += cap(H.listOf(same.map(fmtC))) + ' drove the ' + (miss ? 'shortfall' : 'beat') + (against.length ? ', held back by ' + H.listOf(against.map(fmtC)) : '') + '.';
  what += '</p><p>' + b.year + ' sailings are <b>' + U.pct(b.pct) + ' booked</b> against ' + b.label + ', <span class="' + (b.pct - b.lyPct >= 0 ? 'up' : 'dn') + '">' +
    U.pp(b.pct - b.lyPct) + '</span> against the same point a year earlier. ' +
    'The river moved <b>' + U.money(rv.moved) + '</b> of cash, of which ' + (rv.net >= 0 ? '<span class="up">' + U.money(rv.net) + ' reached reserves</span>' : '<span class="dn">' + U.money(-rv.net) + ' came out of reserves</span>') +
    '; <b>' + U.money(rv.held) + '</b> of guest deposits is held against voyages still to sail.</p>';

  const watch = E.watchlist(D, ctx).filter(r => r.pace < -0.08 && !r.v.charter);
  let decide;
  if (watch.length) {
    const top = watch.slice(0, 3), togo = watch.reduce((s, r) => s + Math.max(0, r.togo), 0);
    const byRegion = new Map();
    for (const r of watch) byRegion.set(r.v.region, (byRegion.get(r.v.region) || 0) + 1);
    const lead = [...byRegion.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2);
    const where = watch.length > 3 ? ' — concentrated in ' + H.listOf(lead.map(([r, k]) => D.dims.regions[r] + ' (' + k + ')')) : '';
    decide = '<p><b>' + watch.length + ' voyage' + (watch.length > 1 ? 's' : '') + '</b> inside 400 days ' + (watch.length > 1 ? 'are' : 'is') + ' more than 8 points behind the booking curve, carrying <b>' +
      U.money(togo) + '</b> of revenue to go' + where + '. The furthest behind: ' +
      H.listOf(top.map(r => '<b>' + r.v.code + '</b> (' + D.dims.regions[r.v.region] + ', ' + U.pct(r.pct, 0) + ' booked ' + r.dts + ' days out)')) +
      '. Decide whether to release promotional inventory on these sailings or hold price and accept the load factor.</p>';
  } else {
    decide = '<p>No voyage inside 400 days is more than 8 points behind the booking curve. Hold price and let the curve run.</p>';
  }
  const dil = comps.find(c => c.key === 'dil');
  if (dil && dil.value < 0) decide += '<p>Dilution has cost <span class="dn">' + U.money(-dil.value) + '</span> against ' + names[br.baseline] + '. Decide which promotions are buying volume and which are discounting bookings that would have come anyway.</p>';
  const tag = V.scenTag(ctx);
  return H.card('story', '01', 'What happened', 'Written by the model from the figures on this page',
    '<div class="story"><div class="board-prose">' + what + '</div><h3>What to decide</h3><div class="board-prose">' + decide + '</div>' +
    '<div class="regen">Regenerated from the model · ' + br.W.short + ' · ' + H.shipName(D, ctx) + (tag.length ? ' · ' + tag.join(' · ') : ' · no scenario adjustments') + '</div></div>');
}

V.render.flight = function (D, ctx, ui) {
  const cy = U.miYear(U.mi(ctx.asOf));
  const watch = E.watchlist(D, ctx, 8);
  return kpis(D, ctx) +
    '<div class="row two">' + narrative(D, ctx, ui) + bridgeCard(D, ctx, ui) + '</div>' +
    riverCard(D, ctx, ui) +
    '<div class="row two">' + cashMonthsCard(D, ctx, ui) + scenariosCard(D, ctx, ui) + '</div>' +
    paceCard(D, ctx, cy + 1, '06', 'pace1') +
    H.card('watch', '07', 'Voyage watchlist', 'Unsailed voyages furthest behind the booking curve · next 400 days',
      watchTable(D, watch) + '<div class="foot-note">The full list is under <a href="#" data-act="view:togo">Revenue to-go</a>.</div>');
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
