/* The tabs. Each one follows a section of the board deck: a heading for every slide
   in the deck's order, with the cards that carry it underneath. A slide the two
   booking tables cannot produce stays in place as a one-line note, so the order of
   the deck is kept even where the content is narrative. */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util, E = CBR.engine, C = CBR.charts, V = CBR.views, H = V.h, K = V.cards, P = V.parts;
const Q = ['Q1', 'Q2', 'Q3', 'Q4'];
const cyOf = ctx => U.miYear(U.mi(ctx.asOf));
const ratio = (a, b) => b ? a / b : null;
const has = (D, y) => D.voyages.some(v => v.year === y);
const two = (a, b) => '<div class="row two">' + a + b + '</div>';
const go = (id, text) => '<a href="#" data-act="view:' + id + '">' + text + '</a>';
const NARR = 'Narrative';
const slide = (title, note, tag) => '<div class="slide' + (tag ? ' narr' : '') + '"><h3>' + title + '</h3>' + (tag ? '<span class="pill">' + tag + '</span>' : '') +
  (note ? '<span class="s-note">' + note + '</span>' : '') + '</div>';
// Cards are numbered in the order they appear on the tab, whatever number they were built with.
const numbered = html => { let n = 0; return html.replace(/<span class="num">[^<]*<\/span>/g, () => '<span class="num">' + String(++n).padStart(2, '0') + '</span>'); };

/* ---------- cards the board deck asks for ---------- */
function agendaCard(D, ctx) {
  const list = items => '<ol>' + items.map(i => '<li>' + i + '</li>').join('') + '</ol>';
  return H.card('agenda', '', 'Agenda', 'The meeting, the presentation, and where each part sits in this dashboard',
    '<div class="agenda"><div><h3>Board meeting</h3>' + list(['Call to order', 'Attendance', 'Notice and quorum', 'Approval of minutes', go('financial', 'Business and yacht update'),
      go('actions', 'Management action plan'), go('budget', 'Initial budget discussion'), 'Executive session']) +
    '</div><div><h3>Presentation</h3>' + list([go('summary', 'Executive summary'), go('financial', 'Financial performance for the month and year to date, guest satisfaction and status of yachts'),
      go('bookings', ctx.year + ' booking performance'), go('actions', 'Management action plan'), go('budget', 'Initial budget discussion'), go('bonds', 'Bond update')]) + '</div></div>');
}

// A P&L for one window: the month, the year to date, or a full sailing year with the outlook for what has not sailed.
function plCard(D, ctx, win, id, title) {
  const c = { ...ctx, window: win }, b = E.bridge(D, c, 'bud'), A = b.act, B = b.base, L = E.bridge(D, c, 'stly').base;
  const end = b.W.forecast ? 'Outlook' : 'Actual', hasLy = L.rev > 0;
  const FMT = {
    money: [U.money, U.signedMoney, 500], pct: [v => U.pct(v), U.pp, 0.0005], int: [U.int, v => (v >= 0 ? '+' : '−') + U.int(Math.abs(v)), 0.5],
    dollars: [U.dollars, v => (v >= 0 ? '+' : '−') + U.dollars(Math.abs(v)), 0.5],
  };
  const row = (label, f, cls, kind) => {
    const [fmt, dfmt, eps] = FMT[kind || 'money'], a = f(A), bu = f(B), ly = hasLy ? f(L) : null;
    const d = (x, y) => (x == null || y == null) ? '—' : H.delta(x - y, dfmt, true, eps);
    const cells = [label, a == null ? '—' : fmt(a), bu == null ? '—' : fmt(bu), d(a, bu)];
    if (hasLy) cells.push(ly == null ? '—' : fmt(ly), d(a, ly));
    return { cls: cls || '', cells };
  };
  const rows = [row('List fare', x => x.list), row('Dilution', x => -x.dil), row('Cancellation fees kept', x => x.fee), row('Ticket revenue', x => x.rev, 'sub'),
                row('Trade commissions', x => -x.comm)];
  if (D.costs) rows.push(row('Fuel', x => -x.cost.fuel), row('Crew', x => -x.cost.crew), row('Provisioning', x => -x.cost.prov),
    row('Port and maintenance', x => -(x.cost.port + x.cost.maint)), row('Voyage costs', x => -x.voy, 'sub'), row('Marketing, shoreside and G&A', x => -x.shore));
  rows.push(row(D.costs ? 'Voyage profit' : 'Revenue less commissions', x => x.profit, 'sub'), row('Margin on ticket revenue', x => ratio(x.profit, x.rev), '', 'pct'),
    row('Passenger cruise days', x => x.pcd, 'memo', 'int'), row('Load factor', x => ratio(x.pcd, x.apcd), 'memo', 'pct'), row('Ticket revenue per guest day', x => ratio(x.rev, x.pcd), 'memo', 'dollars'));
  const cols = [{ h: '', l: 1 }, { h: end }, { h: 'Budget' }, { h: 'vs budget' }];
  if (hasLy) cols.push({ h: 'Prior year' }, { h: 'vs prior year' });
  return H.card(id, '', title, b.W.label + ' · ' + H.shipName(D, ctx) + ' · ' + (D.costs ? 'voyage profit ' : 'revenue less commissions ') +
      '<span class="' + H.tone(b.gap, true, 5e4) + '">' + U.signedMoney(b.gap) + '</span> against budget',
    H.table(cols, rows, 'varn') + '<div class="foot-note">Revenue and cost fall in the months a voyage sails, split by sailing days. Costs are shown as negatives, so a positive variance is always favourable.' +
    (b.W.forecast ? ' Months after the close carry the outlook, which the scenario cockpit moves.' : '') +
    (D.costs ? (ctx.ship >= 0 ? ' Shoreside cost is not allocated to a single ship.' : '') : ' Operating costs are not in the booking extract.') + '</div>');
}

// What each ship has sailed this year, from the bookings: the part of "status of yachts" the tables can show.
function fleetCard(D, ctx) {
  const cy = cyOf(ctx), am = U.mi(ctx.asOf), y0 = cy * 12, dm = D.dims, P0 = E.position(D, ctx, ctx.asOf);
  const now = E.rollup(D, ctx, P0, { from: y0, to: am, key: v => v.ship }), ly = E.rollup(D, ctx, P0, { from: y0 - 12, to: am - 12, key: v => v.ship });
  const tot = E.total(D, ctx, P0, { from: y0, to: am }), totLy = E.total(D, ctx, P0, { from: y0 - 12, to: am - 12 });
  const count = (si, f) => D.voyages.filter(v => v.year === cy && (si < 0 ? (ctx.ship < 0 || v.ship === ctx.ship) : v.ship === si) && f(v)).length;
  const dock = si => { const d = D.costs ? D.costs.drydock.filter(x => x.ship === si && x.mi > am).sort((a, b) => a.mi - b.mi)[0] : null; return d ? U.miLabel(d.mi) : '—'; };
  const line = (name, si, a, z, cls) => {
    const lf = ratio(a.pcd, a.apcd), lfLy = z ? ratio(z.pcd, z.apcd) : null;
    return { cls: cls || '', cells: [name, count(si, v => v.sail <= ctx.asOf), count(si, v => v.sail > ctx.asOf), U.int(a.pcd), lf == null ? '—' : U.pct(lf),
      (lf == null || lfLy == null) ? '—' : H.delta(lf - lfLy, U.pp, true, 0.0005), a.pcd ? U.dollars(a.tix / a.pcd) : '—', U.money(a.tix), si < 0 ? '' : dock(si)] };
  };
  const rows = dm.ships.map((s, si) => ({ s, si, a: now.get(si) })).filter(x => x.a).map(x => line(x.s.name, x.si, x.a, ly.get(x.si)));
  if (rows.length > 1) rows.push(line('Fleet', -1, tot, totLy, 'sub'));
  return H.card('fleet', '', 'Fleet record, year to date', U.miLabel(y0) + ' to ' + U.miLabel(am) + ' · sailed voyages, split by sailing days',
    H.table([{ h: 'Ship', l: 1 }, { h: 'Voyages sailed' }, { h: 'Still to sail in ' + cy }, { h: 'PCDs' }, { h: 'LF' }, { h: 'LF vs prior year' }, { h: 'GPD' }, { h: 'Ticket revenue' },
             { h: 'Next drydock', tip: 'The next scheduled drydock after the close.' }], rows));
}

function drydockCard(D, ctx) {
  if (!D.costs) return '';
  const am = U.mi(ctx.asOf), list = D.costs.drydock.filter(d => ctx.ship < 0 || d.ship === ctx.ship).sort((a, b) => a.mi - b.mi);
  if (!list.length) return '';
  const done = list.filter(d => d.mi <= am), ahead = list.filter(d => d.mi > am);
  return H.card('dock', '', 'Drydock schedule', done.length + ' completed, ' + ahead.length + ' scheduled · ' + H.shipName(D, ctx),
    H.table([{ h: 'Ship', l: 1 }, { h: 'Month', l: 1 }, { h: 'Status', l: 1 }, { h: 'Budgeted cost' }],
      list.map(d => [D.dims.ships[d.ship].name, { v: U.miLabel(d.mi), s: d.mi }, '<span class="pill ' + (d.mi <= am ? 'ok' : 'open') + '">' + (d.mi <= am ? 'completed' : 'scheduled') + '</span>', U.money(d.amount)])
        .concat([{ cls: 'sub', cells: ['Scheduled ahead', '', '', U.money(ahead.reduce((s, d) => s + d.amount, 0))] }])) +
    '<div class="foot-note">Drydock cost leaves in the month of the docking and is part of the cash forecast under ' + go('bookings', 'Booking performance') + '.</div>');
}

// The outlook for one sailing year by quarter, and how much of it is already on the books.
function outlookQuarters(D, ctx, y) {
  const tg = E.togo(D, ctx, y), O = E.outlook(D, ctx), R = E.yearRange(y), out = [0, 0, 0, 0];
  for (const v of D.voyages) {
    if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
    for (const [m, s] of (ctx.flags.prorate ? v.mshare : v.msingle)) if (m >= R.from && m <= R.to) out[U.miQuarter(m)] += O.tix[v.i] * s;
  }
  const total = out.reduce((s, x) => s + x, 0);
  return { tg, out, total, secured: ratio(tg.total.tix, total) };
}
function outlookCard(D, ctx, y) {
  const o = outlookQuarters(D, ctx, y), tgt = E.targetLabel(D, y);
  const line = (label, a, out, cls) => ({ cls: cls || '', cells: [label, U.money(a.tgt), U.money(a.tix), U.money(out), H.delta(out - a.tgt, U.signedMoney, true, 5e4),
    out ? U.pct(a.tix / out) : '—'] });
  const rows = [0, 1, 2, 3].filter(q => o.tg.byQ.get(q)).map(q => line(Q[q] + ' ' + y, o.tg.byQ.get(q), o.out[q]));
  rows.push(line('FY' + y, o.tg.total, o.total, 'sub'));
  return H.card('outq', '', y + ' outlook by quarter', 'Sailed voyages at actual plus the projected finish of the rest · ' + H.shipName(D, ctx),
    H.table([{ h: 'Sailing period', l: 1 }, { h: tgt }, { h: 'Booked' }, { h: 'Outlook' }, { h: 'Outlook vs ' + tgt },
             { h: 'Secured', tip: 'Booked revenue as a share of the outlook: how much of the projected finish is already on the books.' }], rows) +
    '<div class="foot-note">How far to trust the outlook is tested under ' + go('detail', 'Booking detail') + '.</div>');
}

// Bookings produced in each month of the calendar year, by channel, against the same month a year earlier.
function channelMonths(D, ctx) {
  const prod = E.production(D, ctx, ctx.asOf), am = U.mi(ctx.asOf), cy = cyOf(ctx), y0 = cy * 12;
  const row = m => (m >= prod.lo && m <= am) ? prod.rows[m - prod.lo] : null;
  return { prod, am, cy, y0, row, months: H.months(y0, am).filter(m => row(m)), names: D.dims.channels };
}
function chMonthCard(D, ctx) {
  const X = channelMonths(D, ctx), nC = X.names.length;
  const ser = X.names.map((name, i) => ({ name, color: C.PAL[i % 8], values: X.months.map(m => X.row(m).ch[i]) }));
  const T = { ch: new Array(nC).fill(0), book: 0, ly: 0 };
  const rows = X.months.map(m => {
    const r = X.row(m), z = X.row(m - 12);
    r.ch.forEach((x, i) => { T.ch[i] += x; }); T.book += r.book; T.ly += z ? z.book : 0;
    return [U.miLabel(m)].concat(r.ch.map(x => U.money(x))).concat([U.money(r.book), z ? U.money(z.book) : '—', z && z.book ? H.delta(r.book / z.book - 1, U.signedPct, true, 0.0005) : '—']);
  });
  rows.push({ cls: 'sub', cells: ['Year to date'].concat(T.ch.map(x => U.money(x))).concat([U.money(T.book), U.money(T.ly), T.ly ? H.delta(T.book / T.ly - 1, U.signedPct, true, 0.0005) : '—']) });
  return H.card('chmon', '', X.cy + ' bookings by channel, month by month', 'Bookings produced in each month, across all sailing years · ' + H.shipName(D, ctx),
    H.body(C.stack({ labels: X.months.map(U.miLabel), series: ser, tipFmt: U.money, width: 1120, height: 270, every: 1, label: 'Bookings by channel and month' })) + C.legend(ser) +
    H.table([{ h: 'Booking month', l: 1 }].concat(X.names.map(n => ({ h: n }))).concat([{ h: 'All channels' }, { h: 'Prior year' }, { h: 'Change' }]), rows));
}
function chPaceCard(D, ctx) {
  const X = channelMonths(D, ctx), all = H.months(X.y0, X.y0 + 11);
  const cum = (i, shift, upTo) => { let s = 0; return all.map(m => { const r = X.row(m - shift); if (!r || m - shift > upTo) return null; s += r.ch[i]; return s; }); };
  const series = [];
  X.names.forEach((name, i) => {
    series.push({ name: name + ', ' + (X.cy - 1), color: C.PAL[i % 8], values: cum(i, 12, X.am), dashed: '4 4', width: 1.5 });
    series.push({ name: name + ', ' + X.cy, color: C.PAL[i % 8], values: cum(i, 0, X.am), width: 2.4 });
  });
  return H.card('chpace', '', X.cy + ' booking pace by channel', 'Cumulative bookings since January, each channel against the same channel a year earlier · ' + H.shipName(D, ctx),
    H.body(C.lines({ labels: all.map(m => U.miLabel(m).replace(/-\d+$/, '')), series, tipFmt: U.money, width: 1120, height: 290, every: 1, label: 'Cumulative bookings by channel' })) +
    C.legend(X.names.map((name, i) => ({ name, color: C.PAL[i % 8] })).concat([{ name: 'Dashed: the same channel in ' + (X.cy - 1), color: 'var(--ink-2)', dash: 1 }])));
}

// Next year's sales by channel: what is on the books, what is still to book, and the budget they build to.
function chBuildCard(D, ctx, by) {
  const now = E.channelBook(D, ctx, by, ctx.asOf), ly = E.channelBook(D, ctx, by - 1, ctx.asOf - 365), tot = E.togo(D, ctx, by).total, tgt = E.targetLabel(D, by);
  const booked = U.sum(now), lyTot = U.sum(ly), yoy = (a, b) => b ? H.delta(a / b - 1, U.signedPct, true, 0.0005) : '—';
  const rows = D.dims.channels.map((name, i) => [name, U.money(now[i]), U.pct(ratio(now[i], booked)), U.pct(ratio(now[i], tot.tgt)), U.money(ly[i]), yoy(now[i], ly[i])]);
  rows.push({ cls: 'sub', cells: ['Booked to date', U.money(booked), '100.0%', U.pct(ratio(booked, tot.tgt)), U.money(lyTot), yoy(booked, lyTot)] },
    [tot.tgt >= booked ? 'Still to book' : 'Over ' + tgt, U.money(Math.abs(tot.tgt - booked)), '', U.pct(ratio(Math.abs(tot.tgt - booked), tot.tgt)), '', ''],
    { cls: 'sub', cells: [by + ' ' + tgt, U.money(tot.tgt), '', '100.0%', '', ''] });
  return H.card('chbuild', '', by + ' sales build-up by channel', 'Ticket revenue for ' + by + ' sailings: booked to date by channel, and what is left to reach ' + tgt + ' · ' + H.shipName(D, ctx),
    H.table([{ h: 'Channel', l: 1 }, { h: 'Booked to date' }, { h: 'Share of booked' }, { h: 'Share of ' + tgt },
             { h: (by - 1) + ' at the same point', tip: 'What ' + (by - 1) + ' sailings had booked through the same channel at the same calendar date a year earlier.' }, { h: 'Change' }], rows) +
    '<div class="foot-note">The budget is set per voyage, not per channel, so the split of what is still to book is not in the tables.</div>');
}

function yearsCard(D, ctx) {
  const cy = cyOf(ctx), rows = [];
  for (const y of [cy, cy + 1, cy + 2]) {
    if (!has(D, y)) continue;
    const h = E.headline(D, { ...ctx, year: y }).years[0], gap = h.lyPct == null ? null : h.pct - h.lyPct;
    rows.push([y + ' sailings', h.label, U.money(h.tgt), U.money(h.tix), U.pct(h.pct), h.lyPct == null ? '—' : U.pct(h.lyPct), gap == null ? '—' : H.delta(gap, U.pp, true, 0.0005),
      U.money(h.outlook), H.delta(h.outlook - h.tgt, U.signedMoney, true, 5e4), h.togo >= 0 ? U.money(h.togo) : U.money(-h.togo) + ' over']);
  }
  return H.card('years', '', 'Outlook and targets by sailing year', 'This year, the budget year and the year after, as the book stands · ' + H.shipName(D, ctx),
    H.table([{ h: 'Sailing year', l: 1 }, { h: 'Target is', l: 1 }, { h: 'Target' }, { h: 'Booked' }, { h: '% booked' }, { h: 'STLY %' }, { h: 'Pace gap' }, { h: 'Outlook' }, { h: 'Outlook vs target' },
             { h: 'Still to book' }], rows));
}

function heldCard(D, ctx, ui) {
  const hp = E.heldPath(D, ctx, 24), rows = hp.rows;
  if (!rows.length) return '';
  const last = rows[rows.length - 1], lastYear = Math.max(...D.voyages.map(v => v.year));
  const body = H.showTable(ui, 'held')
    ? H.table([{ h: 'Month', l: 1 }, { h: 'Guest receipts' }, { h: 'Refunds' }, { h: 'Released as voyages sail' }, { h: 'Deposits held' }],
        [{ cls: 'sub', cells: ['At the close', '', '', '', U.money(hp.start)] }].concat(rows.map(r => [U.miLabel(r.mi), U.money(r.cashIn), U.money(-r.refunds), U.money(-r.release), U.money(r.held)])))
    : H.body(C.lines({ labels: rows.map(r => U.miLabel(r.mi)), series: [{ name: 'Guest deposits held', color: 'var(--series-cash)', values: rows.map(r => r.held), width: 2.6 }],
        tipFmt: U.money, width: 1120, height: 260, every: 2, label: 'Guest deposits held, next ' + rows.length + ' months' }));
  return H.card('held', '', 'Guest deposits held, next ' + rows.length + ' months', U.money(hp.start) + ' at the close, ' + U.money(last.held) + ' by ' + U.miLabel(last.mi) + ' · ' + H.shipName(D, ctx),
    body + '<div class="foot-note">Guest deposits are cash collected for voyages that have not sailed. Receipts follow the payment terms and the outlook, refunds follow the cancellations still expected, ' +
    'and a voyage\'s cash is released in the month it sails. Sailings after ' + lastYear + ' are not yet in the book and add nothing, so the far end of the line understates.</div>', H.tableBtn('held', ui));
}

function debtCard(D, ctx) {
  const list = E.debt(D, ctx);
  if (!list.length) return '';
  const T = list.reduce((s, r) => ({ principal: s.principal + r.principal, outstanding: s.outstanding + r.outstanding, next12: s.next12 + r.next12 }), { principal: 0, outstanding: 0, next12: 0 });
  return H.card('debt', '', 'Debt outstanding and service', 'Each facility at ' + U.dateLabel(ctx.asOf),
    H.table([{ h: 'Facility', l: 1 }, { h: 'Drawn', l: 1 }, { h: 'Final payment', l: 1 }, { h: 'Original principal' }, { h: 'Rate' }, { h: 'Outstanding' }, { h: 'Service, next 12 months' }],
      list.map(r => [r.name, U.miLabel(r.startMi), U.miLabel(r.endMi), U.money(r.principal), U.pct(r.rate), U.money(r.outstanding), U.money(r.next12)])
        .concat([{ cls: 'sub', cells: ['All facilities', '', '', U.money(T.principal), '', U.money(T.outstanding), U.money(T.next12)] }])) +
    '<div class="foot-note">Level principal with interest on the balance. Debt service is part of the cash forecast under ' + go('bookings', 'Booking performance') + '.</div>');
}

/* =====================================================================
   THE TABS, in the order of the board agenda
   ===================================================================== */
V.render.summary = function (D, ctx, ui) {
  return numbered(K.hero(D, ctx, ui) +
    slide('Executive summary', 'Status and takeaways, written from the figures on the page. The 100-day plan and the commercial engine are under ' + go('actions', 'Action plan') + '.') +
    two(K.story(D, ctx, ui), agendaCard(D, ctx)));
};

V.render.financial = function (D, ctx, ui) {
  const am = U.mi(ctx.asOf), g = P.guests(D, ctx, ui);
  return numbered(
    slide(ctx.year + ' overview: key performance indicators') + K.kpis(D, ctx) +
    slide('Guest satisfaction', 'Satisfaction scores are not in the booking tables. The nearest signals the bookings carry are whether guests book again on board and whether they come back.') +
    two(g.gfvc, g.grep) +
    slide('Yacht status and safety', 'Safety and technical status are reported separately. From the bookings: what each ship has sailed this year.') + fleetCard(D, ctx) +
    slide(U.miLabel(am) + ' P&L') + plCard(D, ctx, 'month', 'plmonth', 'P&L for the month') +
    slide('Year-to-date P&L') + plCard(D, ctx, 'ytd', 'plytd', 'P&L, year to date'));
};

V.render.bookings = function (D, ctx, ui) {
  const y = ctx.year, cy = cyOf(ctx), pc = P.pace(D, ctx, ui), rv = P.revenue(D, ctx, ui), o = outlookQuarters(D, ctx, y);
  return numbered(
    slide('Cumulative ' + y + ' bookings against target') + K.pace(D, ctx, y, '', 'pace', true, ui.paceLayout || 'overlay') +
    slide(cy + ' booking outlook: monthly bookings by channel', 'A booking budget by month and channel is not in the two tables, so each month is set against the same month a year earlier.') + chMonthCard(D, ctx) +
    slide(cy + ' monthly booking pace by channel') + chPaceCard(D, ctx) +
    slide(y + ' budget-to-outlook bridge and booking curve') + two(K.bridge(D, ctx, ui), K.scenarios(D, ctx, ui)) + pc.curvet +
    slide(y + ' financial outlook') + plCard(D, ctx, 'fy', 'plfy', 'P&L for the full year') + outlookCard(D, ctx, y) +
    slide(y + ' cash forecast') + K.river(D, ctx, ui) + K.cashMonths(D, ctx, ui, true) +
    slide('Marketing spend update', 'Incremental spend and what it bought are not in the booking tables.', NARR) +
    slide('Macro and travel trends', 'Market, industry and competitive context is narrative.', NARR) +
    slide('Booking momentum and ' + y + ' forecast coverage', o.secured == null ? '' : '<b>' + U.pct(o.secured) + '</b> of the ' + y + ' outlook is already on the books.') +
    two(rv.revtrend, K.since(D, ctx)));
};

V.render.actions = function (D, ctx, ui) {
  const tg = P.togo(D, ctx, ui), dl = P.dilution(D, ctx, ui), ch = P.channels(D, ctx, ui), dock = drydockCard(D, ctx);
  return numbered(
    slide('Management action plan', 'The plan itself is narrative: the 100-day plan, the commercial engine and what is being stopped. The slides below are the evidence each function\'s update draws on.', NARR) +
    slide('Commercial engine: short-term price and promotion actions', 'The watchlist shows where the book needs action. The scenario cockpit at the foot of the page tests what a price, volume or promotion move would do.') + tg.watchall +
    slide('Promotion impact and performance', 'What promotions cost and how often they are taken. Breakeven is not calculated: the tables show the discount given, not the bookings it added.') + dl.dil + dl.promo +
    slide('Direct sales update') + ch.chmix +
    slide('Trade and group update') + ch.trade +
    slide('Marketing update', 'Campaigns and the website are narrative.', NARR) +
    slide('Operations and shore excursions update', 'Not in the booking tables.', NARR) +
    slide('IT: reservation system and organisation update', 'Not in the booking tables.', NARR) +
    (dock ? slide('Drydock update') + dock : slide('Drydock update', 'The drydock schedule is not in the booking extract.', NARR)));
};

V.render.budget = function (D, ctx, ui) {
  const by = cyOf(ctx) + 1;
  if (!has(D, by)) return slide('Initial budget discussion', 'There are no ' + by + ' sailings in the data loaded, so there is no budget year to show.', NARR);
  const b = { ...ctx, year: by }, tg = P.togo(D, b, ui), ch = P.channels(D, ctx, ui);
  return numbered(
    slide(by + ' sales build-up by channel') + chBuildCard(D, ctx, by) +
    slide('Trade sales') + ch.trade +
    slide('Direct sales', 'Direct is the first line of the build-up above. A plan by direct sub-channel is not in the tables.', NARR) +
    slide('Marketing', 'The marketing budget is narrative.', NARR) +
    slide('Cost reductions', 'Planned cost actions are narrative. Budgeted cost by line is in the target P&L below.', NARR) +
    slide(by + ' target P&L and revenue still to go') + plCard(D, b, 'fy', 'plby', by + ' target P&L') + tg.matrix + tg.region +
    slide('Capital spending', 'Scheduled drydocks are under ' + go('actions', 'Action plan') + '. Other capital spending is not in the tables.', NARR) +
    slide('Resulting ' + (by + 1) + ' outlook and targets') + yearsCard(D, ctx) +
    slide('Restricted cash position, next 24 months') + heldCard(D, ctx, ui));
};

V.render.bonds = function (D, ctx, ui) {
  const debt = debtCard(D, ctx);
  return numbered(
    slide('Update on bonds: investor relations', 'Investor meetings and changes since the last update are narrative.', NARR) +
    (debt ? slide('Refinancing: what is outstanding') + debt
          : slide('Refinancing', D.costs ? 'Debt is held at fleet level. Select Consolidated to see it.' : 'Debt facilities are not in the booking extract.', NARR)) +
    slide('Newbuild and financing', 'Held back from this meeting.', 'Not for this meeting') +
    slide('Future growth framework', 'Held back from this meeting.', 'Not for this meeting') +
    slide('Fleet expansion scenarios', 'Held back from this meeting.', 'Not for this meeting') +
    slide('Closing', '', NARR));
};

V.render.detail = function (D, ctx, ui) {
  const tg = P.togo(D, ctx, ui), pc = P.pace(D, ctx, ui), rv = P.revenue(D, ctx, ui), dl = P.dilution(D, ctx, ui);
  return numbered(tg.matrix + tg.region + pc.window + pc.consol + pc.accuracy + rv.revsum + two(rv.revship, rv.revtrend) + dl.wcan + dl.cmon + dl.policy);
};
V.render.voyages = (D, ctx, ui) => numbered(P.voyages(D, ctx, ui).voy);
V.render.guests = function (D, ctx, ui) {
  const st = P.suites(D, ctx, ui), g = P.guests(D, ctx, ui);
  return numbered(two(st.tmrev, st.tmsuite) + st.tecon + st.tmap + two(g.gsail, g.gbook) + g.ggeo);
};
V.render.defs = function (D, ctx, ui) {
  const d = P.defs(D, ctx, ui);
  return numbered(d.dsrc + d.dmeas + d.ddim + d.dder + d.dadj + d.dmap + d.dsig);
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
