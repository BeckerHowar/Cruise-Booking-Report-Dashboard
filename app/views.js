/* View helpers and the flight deck. Each view is a function (D, ctx, ui) that
   returns an HTML string; main.js owns state and re-renders on every change. */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util, E = CBR.engine, C = CBR.charts;
const V = CBR.views = { render: {} };

// scope lists the controls, beyond the as-of date and ship, that change a tab.
V.LIST = [
  { id: 'flight',   label: 'Flight deck',     slides: '2–3, 7–8', scope: ['year', 'window', 'cockpit'],
    note: 'The one-page read: where the book stands, what moved profit, where the cash went.' },
  { id: 'pace',     label: 'Pace',            slides: '22–28, 85–88', scope: ['year'],
    note: 'Booking curves against the same point in prior years, the booking window split, and the consolidated report by quarter.' },
  { id: 'togo',     label: 'Revenue to-go',   slides: '9–21, 43–46', scope: ['year', 'cockpit'],
    note: 'Target less booked, by ship, quarter, region and voyage.' },
  { id: 'channels', label: 'Channels',        slides: '4–6', scope: [],
    note: 'Channel mix and the strategic agency roster, for bookings made this calendar year.' },
  { id: 'suites',   label: 'Suites',          slides: '30–33', scope: [],
    note: 'Suite tier mix against budget, and what each tier earns.' },
  { id: 'guests',   label: 'Guests',          slides: '34–37, 54–58, 73–78', scope: ['year'],
    note: 'Guests sailed, bookers, repeaters, future-voyage conversion and guest geography.' },
  { id: 'dilution', label: 'Dilution & cancellations', slides: '38–42, 59–60', scope: [],
    note: 'Discount take rates, cancellation behaviour and the policies behind both.' },
  { id: 'voyages',  label: 'Voyages',         slides: '61–72, 79–84', scope: ['year'],
    note: 'Every voyage against forecast, budget and its own position three months ago.' },
  { id: 'revenue',  label: 'Revenue tables',  slides: '48–51', scope: [],
    note: 'Booking production for the month, the trailing three months and the trailing twelve, across all sailing years.' },
  { id: 'defs',     label: 'Definitions & data', slides: 'all', scope: [],
    note: 'Every measure, dimension and adjustment, the deck-to-view map, and the Sigma data contract.' },
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

V.GLOSSARY = [
  ['STLY', 'Same time last year: the prior year\'s sailings, as their book stood on the same calendar date a year earlier.'],
  ['ITD', 'Inception to date: everything booked so far, since the voyage opened for sale.'],
  ['YTD', 'Year to date: January through the as-of month.'],
  ['YoY', 'Year on year: against the same period a year earlier.'],
  ['Y-2', 'Two years earlier, at the same calendar point.'],
  ['APCD', 'Available passenger cruise days: capacity, at two guests per suite, for every sailing day.'],
  ['PCD', 'Passenger cruise day: one guest on board for one day. Guests × days.'],
  ['LF', 'Load factor: PCDs ÷ APCDs. For unsailed voyages this is booking pace to date, not final occupancy.'],
  ['GPD', 'Gross price per day: ticket revenue ÷ PCDs.'],
  ['FCST', 'Forecast: the current-year full-year forecast.'],
  ['BDGT', 'Budget.'],
  ['C2C', 'Cruise-to-cruise transfer: a guest moving a booking from one voyage to another.'],
  ['FVC', 'Future voyage booking: made on board or within 14 days of sailing.'],
  ['Outlook', 'Sailed voyages at actual, plus the projected finish of every unsailed voyage.'],
  ['Pace', 'Share of target booked, against where history says a voyage normally is this far from sailing.'],
  ['pp', 'Percentage points: the gap between two percentages.'],
];
const GLOSS_RE = V.GLOSSARY.map(([t, d]) => [new RegExp('(^|[^A-Za-z])' + t.replace('-', '\\-') + 's?($|[^A-Za-z])'), t + ' — ' + d]);

/* ---------- building blocks ---------- */
const H = V.h = {};
H.gloss = text => { const plain = String(text).replace(/<[^>]*>/g, ''); return GLOSS_RE.filter(([re]) => re.test(plain)).slice(0, 3).map(x => x[1]).join('\n'); };
H.card = (id, num, title, sub, body, tools) =>
  '<section class="card" id="card-' + id + '"><div class="card-head"><div><h2><span class="num">' + num + '</span>' + title + '</h2>' +
  (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div><div class="tools">' + (tools || '') + '</div></div>' + body + '</section>';
H.showTable = (ui, id) => ui.tables[id] != null ? !!ui.tables[id] : !!ui.narrow;       // phones start on the numbers
H.tableBtn = (id, ui) => '<button type="button" class="tbl-btn" data-act="table:' + id + '" aria-pressed="' + H.showTable(ui, id) + '">' + (H.showTable(ui, id) ? 'Chart' : 'Table') + '</button>';
H.tabs = (act, items, cur, label) => '<div class="tabs" role="group" aria-label="' + (label || '') + '">' + items.map(([k, l, off]) =>
  '<button type="button" data-act="' + act + ':' + k + '" aria-pressed="' + (String(k) === String(cur)) + '"' + (off ? ' disabled title="' + U.esc(off) + '"' : '') + '>' + l + '</button>').join('') + '</div>';
H.table = function (cols, rows, cls, sortId) {
  let h = '<div class="tblwrap"><table class="grid ' + (cls || '') + (sortId ? ' sortable' : '') + '"' + (sortId ? ' data-sort-id="' + sortId + '"' : '') + '><thead><tr>' +
    cols.map(c => { const t = c.tip || H.gloss(c.h); return '<th class="' + (c.l ? 'l' : '') + '"' + (t ? ' title="' + U.esc(t) + '"' : '') + (sortId ? ' tabindex="0"' : '') + '>' + c.h + '</th>'; }).join('') + '</tr></thead><tbody>';
  for (const r of rows) {
    const cells = r.cells || r;
    h += '<tr class="' + (r.cls || '') + '">' + cells.map((c, i) => {
      const o = (c !== null && typeof c === 'object') ? c : { v: c };
      return '<td class="' + ((cols[i] && cols[i].l) ? 'l ' : '') + (o.cls || '') + '"' + (o.style ? ' style="' + o.style + '"' : '') + (o.tip ? ' title="' + U.esc(o.tip) + '"' : '') +
        (o.s != null ? ' data-s="' + o.s + '"' : '') + '>' + (o.v == null ? '—' : o.v) + '</td>';
    }).join('') + '</tr>';
  }
  return h + '</tbody></table></div>';
};
// A signed cell coloured by whether the direction is good news.
H.delta = (v, fmt, goodUp, eps) => (v == null || !isFinite(v)) ? { v: '—' }
  : { v: fmt(v), s: v, cls: Math.abs(v) < (eps == null ? 1e-9 : eps) ? '' : ((v > 0) === (goodUp !== false) ? 'fav' : 'unfav') };
H.tone = (v, goodUp, eps) => Math.abs(v) < (eps == null ? 1e-9 : eps) ? '' : ((v > 0) === (goodUp !== false) ? 'up' : 'dn');
H.body = html => '<div class="chart-body">' + html + '</div>';
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
V.bridgeBase = (D, ctx, ui) => ui.bridgeBase === 'fc' && !E.hasForecast(D, ctx) ? 'bud' : ui.bridgeBase;
const BASE_NAME = { bud: 'Budget', fc: 'Forecast', stly: 'Prior year' };

/* =====================================================================
   FLIGHT DECK
   ===================================================================== */
// One sentence and three figures: the read for someone who stops here.
function hero(D, ctx, ui) {
  const Hd = E.headline(D, ctx), [a, b] = Hd.years, br = E.bridge(D, ctx, 'bud');
  if (!a) return '';
  const fig = (label, value, sub, tone, tipText) => '<div class="hero-fig"' + (tipText ? ' title="' + U.esc(tipText) + '"' : '') + '><div class="hf-l">' + label + '</div><div class="hf-v">' + value +
    '</div><div class="hf-s' + (tone ? ' ' + tone : '') + '">' + sub + '</div></div>';
  const over = a.togo < 0;
  const paceGap = b && b.lyPct != null ? b.pct - b.lyPct : null;
  const parts = [
    a.year + ' is <b>' + U.pct(a.pct) + ' booked</b> against ' + a.label + ', with ' + (over ? U.money(-a.togo) + ' over target' : '<b>' + U.money(a.togo) + '</b> still to go'),
    'voyage profit ' + (br.W.forecast ? 'is tracking ' : 'closed ') + (Math.abs(br.gap) < 5e4 ? 'in line with budget' : '<span class="' + (br.gap < 0 ? 'dn' : 'up') + '">' + U.money(Math.abs(br.gap)) + (br.gap < 0 ? ' below' : ' above') + ' budget</span>') + ' for ' + br.W.short,
  ];
  if (paceGap != null) parts.push(b.year + ' bookings are <span class="' + (paceGap < 0 ? 'dn' : 'up') + '">' + (Math.abs(paceGap) < 0.0005 ? 'level with' : U.pct(Math.abs(paceGap)).replace('%', ' points') + (paceGap < 0 ? ' behind' : ' ahead of')) +
    '</span> where ' + (b.year - 1) + ' stood a year ago');
  const sentence = parts.join('; ') + '.';
  return '<section class="hero"><p class="hero-line">' + sentence.charAt(0).toUpperCase() + sentence.slice(1) + '</p><div class="hero-figs">' +
    fig(a.year + ' booked', U.money(a.tix), U.pct(a.pct) + ' of ' + a.label + ' · ' + (over ? U.money(-a.togo) + ' over' : U.money(a.togo) + ' to go'), '',
        'Ticket revenue on the books for ' + a.year + ' sailings: active bookings net of dilution, plus cancellation fees kept.') +
    fig('Voyage profit · ' + br.W.short, U.money(br.act.profit), U.signedMoney(br.gap) + ' vs budget', H.tone(br.gap, true, 5e4),
        'Ticket revenue less commissions, voyage costs and shoreside cost, for the window selected in the control bar.') +
    (b ? fig(b.year + ' booked', U.pct(b.pct), 'of ' + b.label + (paceGap == null ? '' : ' · ' + U.pp(paceGap) + ' vs STLY'), paceGap == null ? '' : H.tone(paceGap, true, 0.0005),
             'Share of target secured, against the share ' + (b.year - 1) + ' sailings had secured at the same calendar point a year earlier.')
       : fig('Load factor ' + a.year, U.pct(a.lf), 'booking pace to date', '', H.gloss('LF'))) +
    '</div></section>';
}

function kpis(D, ctx) {
  const Hd = E.headline(D, ctx), a = Hd.years[0], am = U.mi(ctx.asOf);
  if (!a) return '';
  const tile = (label, value, plain, delta, tone, tipText) =>
    '<div class="kpi"' + (tipText ? ' title="' + U.esc(tipText) + '"' : '') + '><div class="k-label">' + label + '</div><div class="k-value">' + value + '</div>' +
    '<div class="k-ctx">' + (delta ? '<span class="' + (tone || '') + '">' + delta + '</span> ' : '') + plain + '</div></div>';
  const dOut = a.outlook - a.tgt, yoy = Hd.netLy ? Hd.netMonth / Hd.netLy - 1 : null;
  return '<div class="kpis">' +
    tile(a.year + ' outlook', U.money(a.outlook), 'vs ' + a.label, U.signedMoney(dOut), H.tone(dOut, true, 5e4),
         'Sailed voyages at actual plus the projected finish of every unsailed voyage. The scenario cockpit moves the projected part.') +
    tile('Load factor ' + a.year, U.pct(a.lf), 'vs STLY', a.lyLf == null ? '' : U.pp(a.lf - a.lyLf), a.lyLf == null ? '' : H.tone(a.lf - a.lyLf, true, 0.0005), H.gloss('LF STLY')) +
    tile('GPD ' + a.year, U.dollars(a.gpd), 'vs ' + a.label, a.tgtGpd ? (a.gpd - a.tgtGpd >= 0 ? '+' : '−') + U.dollars(Math.abs(a.gpd - a.tgtGpd)) : '', a.tgtGpd ? H.tone(a.gpd - a.tgtGpd, true, 0.5) : '', H.gloss('GPD')) +
    tile('Net bookings, ' + U.miLabel(am), U.money(Hd.netMonth), yoy == null ? 'no prior-year month' : 'vs ' + U.miLabel(am - 12), yoy == null ? '' : U.signedPct(yoy), yoy == null ? '' : H.tone(yoy, true, 0.0005),
         'Bookings produced in the month across all sailing years, less the month\'s cancellations, plus cancellation fees.') +
    tile('Guest deposits held', U.money(Hd.held), 'paid in on unsailed voyages', '', '', 'Cash already collected from guests for voyages that have not sailed yet.') +
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
  const base = V.bridgeBase(D, ctx, ui), br = E.bridge(D, ctx, base), hasFc = E.hasForecast(D, ctx);
  const B = br.base, A = br.act, gp = (x, y) => y ? x / y : null, end = br.W.forecast ? 'Outlook' : 'Actual';
  let body;
  if (H.showTable(ui, 'bridge')) {
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
    body = H.table([{ h: 'Driver / line', l: 1 }, { h: BASE_NAME[base] }, { h: end }, { h: 'Change' }, { h: 'Profit impact' }], rows, 'varn');
  } else {
    body = H.body(C.waterfall(bridgeSteps(D, br, BASE_NAME[base]), { focus: ui.focus, label: 'Profit bridge, ' + BASE_NAME[base] + ' to ' + end.toLowerCase() }));
  }
  const pct = B.profit ? br.gap / Math.abs(B.profit) : null;
  return H.card('bridge', '02', 'Profit bridge',
    'Voyage profit, ' + BASE_NAME[base].toLowerCase() + ' to ' + end.toLowerCase() + ' · ' + br.W.label + ' · ' + H.shipName(D, ctx) +
    ' · ' + (br.gap >= 0 ? 'favourable ' : 'unfavourable ') + U.money(Math.abs(br.gap)) + (pct == null ? '' : ' (' + U.signedPct(pct, 0) + ')'),
    body + '<div class="foot-note">Each bar swaps one driver from ' + BASE_NAME[base].toLowerCase() + ' to ' + end.toLowerCase() +
    ' and holds the rest, so the bars sum to the gap exactly. Click a bar to isolate it.' +
    (ui.bridgeBase === 'fc' && !hasFc ? ' There is no forecast for this window, so the comparison is against budget.' : '') +
    (D.costs ? '' : ' Operating costs are not in the booking extract, so this bridge stops at ticket revenue less commissions.') + '</div>',
    H.tabs('bridge', [['bud', 'vs Budget'], ['fc', 'vs Forecast', hasFc ? '' : 'No forecast exists for this window; forecasts cover the current sailing year only.'], ['stly', 'vs Prior year']], base, 'Bridge baseline') +
    H.tableBtn('bridge', ui));
}

function riverCard(D, ctx, ui) {
  const rv = E.river(D, ctx);
  // One dot is a fixed amount of cash: the fleet's base-case year spread over 480 dots.
  // A single ship, a shorter period or a cockpit setting then shows as more or fewer dots.
  const ref = E.river(D, { ...ctx, ship: -1, window: 'fy', scen: { vol: 0, price: 0, cancel: 0, dil: 0, fuel: 0 } });
  const perDot = (ref.moved || rv.moved || 1) / 480;
  let body;
  if (H.showTable(ui, 'river')) {
    const n = Math.max(rv.sources.length, rv.uses.length), rows = [];
    for (let i = 0; i < n; i++) {
      const s = rv.sources[i], u = rv.uses[i];
      rows.push([s ? s.name : '', s ? U.money(s.value) : '', s ? U.pct(s.value / rv.moved, 0) : '', u ? u.name : '', u ? U.money(u.value) : '', u ? U.pct(u.value / rv.moved, 0) : '']);
    }
    rows.push({ cls: 'sub', cells: ['Cash in', U.money(rv.moved), '100%', 'Cash out and reserves', U.money(rv.moved), '100%'] });
    body = H.table([{ h: 'Where it came from', l: 1 }, { h: 'Amount' }, { h: 'Share' }, { h: 'Where it went', l: 1 }, { h: 'Amount' }, { h: 'Share' }], rows);
  } else {
    body = '<div class="river">' + C.river(rv.sources, rv.uses, { still: ui.still, perDot }) + '</div>';
  }
  const note = rv.W.forecast
    ? 'Months after the close are the schedule the current book implies: final payments falling due, pickup still to arrive, refunds on the cancellations still to come.'
    : 'Every month in this window is closed, so this is cash that has actually moved.';
  return H.card('river', '03', 'Cash river', 'Cash in and out · ' + rv.W.label + ' · ' + H.shipName(D, ctx),
    body + '<div class="foot-note">Guest payments follow the payment terms: a ' + U.pct(ctx.terms.deposit, 0) + ' deposit at booking and the balance ' +
    ctx.terms.finalDays + ' days before sailing. ' + note + (ui.still ? '' : ' Each dot is about ' + U.money(perDot) + ' of cash, so a stream gains or loses dots as the cockpit moves it.') +
    (D.costs ? (ctx.ship >= 0 ? ' Shoreside cost and debt service are fleet-level and are left out for a single ship.' : '')
             : ' Operating costs are not in the booking extract, so only refunds and commissions flow out.') + '</div>',
    H.tableBtn('river', ui));
}

function cashMonthsCard(D, ctx, ui) {
  const rows = E.cashMonths(D, ctx, 9, 12), cut = rows.findIndex(r => r.forecast);
  let body;
  if (H.showTable(ui, 'cashm')) {
    body = H.table([{ h: 'Month', l: 1 }, { h: 'Guest receipts' }, { h: 'Refunds' }, { h: 'Commissions' }, { h: 'Operating' }, { h: 'Debt & drydock' }, { h: 'Net cash' }],
      rows.map(r => ({ cls: r.forecast ? 'memo' : '', cells: [U.miLabel(r.mi) + (r.forecast ? ' · sched.' : ''), U.money(r.cashIn), U.money(-r.refunds), U.money(-r.comm),
                       U.money(-r.ops), U.money(-(r.debt + r.dry)), H.delta(r.net, U.signedMoney, true, 0.5)] })));
  } else {
    body = H.body(C.signed({ labels: rows.map(r => U.miLabel(r.mi)), values: rows.map(r => r.net), fadeFrom: cut < 0 ? null : cut, markAt: cut < 0 ? null : cut,
      tips: rows.map(r => 'Receipts ' + U.money(r.cashIn) + ', paid out ' + U.money(r.cashOut)), tipFmt: U.signedMoney, label: 'Net cash by month' }));
  }
  return H.card('cashm', '06', 'Net cash by month', 'Receipts less everything paid out · closed months, then the schedule ahead', body, H.tableBtn('cashm', ui));
}

V.scenarioMetrics = function (D, ctx, scen) {
  const c = { ...ctx, scen }, y = ctx.year, has = D.voyages.some(v => v.year === y + 1);
  const br = E.bridge(D, c, 'bud'), rv = E.river(D, c);
  return { y, out0: E.outlookTotal(D, c, y).tix, out1: has ? E.outlookTotal(D, c, y + 1).tix : null, profit: br.act.profit, gap: br.gap, reserves: rv.net, W: br.W };
};

function scenariosCard(D, ctx, ui) {
  const zero = { vol: 0, price: 0, cancel: 0, dil: 0, fuel: 0 };
  const base = V.scenarioMetrics(D, ctx, zero), live = V.scenarioMetrics(D, ctx, ctx.scen);
  const saved = ui.saved ? V.scenarioMetrics(D, ctx, ui.saved) : null;
  const tagOf = s => V.scenTag({ scen: s }).join(' · ') || 'no adjustments';
  const cell = (m, k, isBase) => {
    if (!m || m[k] == null) return { v: '—' };
    if (isBase) return U.money(m[k]);
    const d = m[k] - base[k];
    return { v: U.money(m[k]) + (Math.abs(d) > 500 ? ' <small>' + U.signedMoney(d) + '</small>' : ''), cls: Math.abs(d) < 500 ? '' : d > 0 ? 'fav' : 'unfav' };
  };
  const line = (label, k) => [label, cell(base, k, true), cell(saved, k), cell(live, k)];
  const rows = [line(base.y + ' revenue outlook', 'out0')];
  if (base.out1 != null) rows.push(line((base.y + 1) + ' revenue outlook', 'out1'));
  rows.push(line('Voyage profit · ' + base.W.short, 'profit'), line('Profit vs budget · ' + base.W.short, 'gap'), line('Cash to reserves · ' + base.W.short, 'reserves'));
  return H.card('scen', '05', 'Scenarios, side by side', 'The base case against a saved scenario and the cockpit as it is set now',
    H.table([{ h: '', l: 1 }, { h: 'Base' }, { h: 'Saved', tip: ui.saved ? tagOf(ui.saved) : 'Nothing saved yet. Set the cockpit and press Save.' }, { h: 'Cockpit now', tip: tagOf(ctx.scen) }], rows, 'scen') +
    '<div class="foot-note"><b>Saved:</b> ' + (ui.saved ? tagOf(ui.saved) : 'nothing yet — set the cockpit and press Save') +
    '. <b>Cockpit now:</b> ' + tagOf(ctx.scen) + '. The cockpit moves unsailed voyages only' +
    (base.W.forecast ? '.' : ', so the ' + base.W.short + ' rows, which cover closed months, do not respond to it.') + '</div>');
}

function sinceCard(D, ctx) {
  const m = E.monthChange(D, ctx), rows = [], am = U.mi(ctx.asOf);
  const line = (label, was, now, fmt, dfmt, goodUp, eps) => rows.push([label, was == null ? '—' : fmt(was), now == null ? '—' : fmt(now),
    (was == null || now == null) ? '—' : H.delta(now - was, dfmt, goodUp, eps)]);
  m.now.years.forEach((n, i) => {
    const w = m.was.years[i];
    if (!w) return;
    line(n.year + ' booked', w.tix, n.tix, U.money, U.signedMoney, true, 500);
    line(n.year + ' share of ' + n.label, w.pct, n.pct, U.pct, U.pp, true, 0.0005);
    if (i === 0) line(n.year + ' outlook', w.outlook, n.outlook, U.money, U.signedMoney, true, 5e4);
    if (n.lyPct != null && w.lyPct != null) line(n.year + ' gap to STLY', w.pct - w.lyPct, n.pct - n.lyPct, U.pp, U.pp, true, 0.0005);
  });
  line('Net bookings in the month', m.was.netMonth, m.now.netMonth, U.money, U.signedMoney, true, 500);
  line('Guest deposits held', m.was.held, m.now.held, U.money, U.signedMoney, true, 500);
  const mv = x => '<b>' + x.v.code + '</b> ' + U.signedMoney(x.delta);
  return H.card('since', '04', 'Since the last close', U.dateLabel(m.prev) + ' to ' + U.dateLabel(ctx.asOf) + ' · ' + H.shipName(D, ctx),
    H.table([{ h: '', l: 1 }, { h: U.miLabel(am - 1) }, { h: U.miLabel(am) }, { h: 'Change' }], rows) +
    '<div class="foot-note">' + (m.up.length ? 'Biggest pickup: ' + m.up.slice(0, 3).map(mv).join(', ') + '. ' : '') +
    (m.down.length ? 'Lost ground: ' + m.down.map(mv).join(', ') + '.' : 'No unsailed voyage lost ground in the month.') + '</div>');
}

function paceCard(D, ctx, year, num, id, wide) {
  const cv = E.curves(D, ctx, year), labels = H.months(cv.startMi, cv.startMi + cv.N - 1).map(U.miLabel);
  const tgt = E.targetLabel(D, year), series = [
    { name: (year - 2) + ' sailings', color: 'var(--c8)', values: cv.y2.pct, dashed: '2 3', width: 1.5 },
    { name: (year - 1) + ' sailings', color: 'var(--ink-2)', values: cv.stly.pct, dashed: '5 3', width: 1.6 },
    { name: year + ' sailings', color: 'var(--c1)', values: cv.cy.pct, width: 2.4, live: true }].filter(s => s.values.some(v => v != null));
  return H.card(id, num, year + ' booking pace', 'Cumulative booked revenue as a share of ' + tgt + ' · ' + H.shipName(D, ctx) +
    (cv.gap == null ? '' : ' · ' + U.pp(cv.gap) + ' vs the same point last year'),
    H.body(C.lines({ labels, every: wide ? 3 : 6, width: wide ? 1120 : 640, height: wide ? 310 : 250, yFmt: C.axisPct, tipFmt: v => U.pct(v), markAt: cv.at, markLabel: 'as of', series, live: { year, denom: cv.cy.denom, start: cv.startMi },
      label: year + ' booking curve against prior years' })) +
    C.legend([{ name: year + ' sailings', color: 'var(--c1)' }, { name: (year - 1) + ', one year earlier', color: 'var(--ink-2)', dash: 1 }, { name: (year - 2) + ', two years earlier', color: 'var(--c8)', dash: 1 }]));
}
V.paceCard = paceCard;

function watchTable(D, rows, sortId) {
  return H.table(
    [{ h: 'Voyage', l: 1 }, { h: 'Ship', l: 1 }, { h: 'Sails', l: 1 }, { h: 'Region', l: 1 }, { h: 'Days out' }, { h: 'Target' }, { h: 'Booked' }, { h: '% booked' },
     { h: 'Curve says', tip: 'The share of its final book a voyage in this region has normally secured this many days before sailing, from voyages that have already sailed.' },
     { h: 'Outlook' }, { h: 'Shortfall', tip: 'Target less outlook: how far short of target this voyage is projected to finish. Flagged at 5% of target and $150k.' }],
    rows.map(r => ({ cls: r.flagged ? 'flagrow' : '', cells: [r.v.code + (r.v.charter ? ' <span class="pill">charter</span>' : '') + (r.flagged ? ' <span class="pill warn">watch</span>' : ''),
      D.dims.ships[r.v.ship].name, { v: U.shortDate(r.v.sail) + ' · D' + r.v.days, s: r.v.sail }, D.dims.regions[r.v.region],
      r.dts, U.money(r.target), U.money(r.tix), U.pct(r.pct, 0), U.pct(r.expected, 0), U.money(r.outlook),
      r.shortfall > 500 ? { v: U.money(r.shortfall), s: r.shortfall, cls: r.flagged ? 'unfav' : '' } : { v: r.shortfall < -500 ? U.money(-r.shortfall) + ' over' : '$0', s: r.shortfall, cls: r.shortfall < -500 ? 'fav' : '' }] })), '', sortId);
}
V.watchTable = watchTable;

function story(D, ctx, ui) {
  const base = V.bridgeBase(D, ctx, ui), br = E.bridge(D, ctx, base), rv = E.river(D, ctx);
  const names = { bud: 'budget', fc: 'forecast', stly: 'the prior year' };
  const comps = E.BRIDGE.map(s => ({ ...s, value: br.comps[s.key] })).filter(c => Math.abs(c.value) > 5e4).sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const miss = br.gap < 0, same = comps.filter(c => (c.value < 0) === miss).slice(0, 3), against = comps.filter(c => (c.value < 0) !== miss).slice(0, 2);
  const fmtC = c => c.label.toLowerCase() + ' (<span class="' + (c.value >= 0 ? 'up' : 'dn') + '">' + U.signedMoney(c.value) + '</span>)';
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  let what = '<p><b>Voyage profit ' + (br.W.forecast ? 'is tracking to' : 'closed at') + ' ' + U.money(br.act.profit) + '</b> for ' + br.W.label + ', against ' + names[base] + ' of ' + U.money(br.base.profit) +
    (Math.abs(br.gap) < 5e4 ? ' — in line.' : ': <span class="' + (miss ? 'dn' : 'up') + '">' + U.money(Math.abs(br.gap)) + (miss ? ' short' : ' ahead') + '</span>.') + ' ';
  if (same.length) what += cap(H.listOf(same.map(fmtC))) + ' drove the ' + (miss ? 'shortfall' : 'beat') + (against.length ? ', held back by ' + H.listOf(against.map(fmtC)) : '') + '.';
  what += '</p><p>The river moved <b>' + U.money(rv.moved) + '</b> of cash, of which ' +
    (rv.net >= 0 ? '<span class="up">' + U.money(rv.net) + ' reached reserves</span>' : '<span class="dn">' + U.money(-rv.net) + ' came out of reserves</span>') +
    '; <b>' + U.money(rv.held) + '</b> of guest deposits is held against voyages still to sail.</p>';

  const watch = E.watchlist(D, ctx).filter(r => r.flagged);
  let decide;
  if (watch.length) {
    const total = watch.reduce((s, r) => s + r.shortfall, 0);
    decide = '<p><b>' + watch.length + ' voyage' + (watch.length > 1 ? 's are' : ' is') + ' projected to finish at least 5% short of target</b>, ' + U.money(total) + ' in all. The largest: ' +
      H.listOf(watch.slice(0, 3).map(r => '<b>' + r.v.code + '</b> (' + D.dims.regions[r.v.region] + ', ' + r.dts + ' days out, ' + U.money(r.shortfall) + ' short)')) +
      '. Decide whether to release promotional inventory on these sailings or hold price and accept the load factor.</p>';
  } else {
    decide = '<p>No voyage in the next 400 days is projected to finish 5% or more short of target. Hold price and let the curve run.</p>';
  }
  const dil = comps.find(c => c.key === 'dil');
  if (dil && dil.value < 0) decide += '<p>Dilution has cost <span class="dn">' + U.money(-dil.value) + '</span> against ' + names[base] + '. Decide which promotions are buying volume and which are discounting bookings that would have come anyway.</p>';
  const tag = V.scenTag(ctx);
  return H.card('story', '01', 'What happened', 'Written by the model from the figures on this page',
    '<div class="story"><div class="board-prose">' + what + '</div><h3>What to decide</h3><div class="board-prose">' + decide + '</div>' +
    '<div class="regen">Regenerated from the model · ' + br.W.short + ' · ' + H.shipName(D, ctx) +
    (tag.length ? ' · ' + tag.join(' · ') + (br.W.forecast ? '' : ' (the cockpit moves unsailed voyages, so this closed window is unchanged)') : ' · no scenario adjustments') + '</div></div>');
}

V.render.flight = function (D, ctx, ui) {
  const cy = U.miYear(U.mi(ctx.asOf)), next = Math.max(ctx.year, cy) + (ctx.year > cy ? 0 : 1);
  const paceYear = D.voyages.some(v => v.year === next) ? next : ctx.year;
  return hero(D, ctx, ui) + kpis(D, ctx) +
    '<div class="row two">' + story(D, ctx, ui) + bridgeCard(D, ctx, ui) + '</div>' +
    riverCard(D, ctx, ui) +
    '<div class="row two">' + sinceCard(D, ctx) + scenariosCard(D, ctx, ui) + '</div>' +
    '<div class="row two">' + cashMonthsCard(D, ctx, ui) + paceCard(D, ctx, paceYear, '07', 'pace1') + '</div>' +
    H.card('watch', '08', 'Voyage watchlist', 'The five unsailed voyages projected to finish furthest short of target · next 400 days',
      watchTable(D, E.watchlist(D, ctx, 5)) + '<div class="foot-note">The full, sortable list is under <a href="#" data-act="view:togo">Revenue to-go</a>.</div>');
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
