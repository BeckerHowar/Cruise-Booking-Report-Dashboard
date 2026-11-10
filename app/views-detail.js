/* The detail tabs. Each follows a group of slides in the booking report deck. */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util, E = CBR.engine, C = CBR.charts, V = CBR.views, H = V.h;
const Q = ['Q1', 'Q2', 'Q3', 'Q4'];
const cyOf = ctx => U.miYear(U.mi(ctx.asOf));
const keyQ = (v, m) => U.miQuarter(m);
const ratio = (a, b) => b ? a / b : null;
const heat = share => 'background:color-mix(in srgb, var(--accent) ' + Math.round(U.clamp(share, 0, 1) * 46) + '%, transparent)';
const sumRows = (rows, from, to, lo) => {
  const t = { book: 0, can: 0, canX: 0, fee: 0, count: 0, suites: 0, pcd: 0, guests: 0, list: 0, dil: 0, canCount: 0, ship: [], ch: [], bookers: 0, rep: 0 };
  for (let m = from; m <= to; m++) {
    const r = rows[m - lo];
    if (!r) continue;
    t.book += r.book; t.can += r.can; t.canX += r.canX; t.fee += r.fee; t.count += r.count; t.suites += r.suites; t.pcd += r.pcd; t.guests += r.guests;
    t.list += r.list; t.canCount += r.canCount; t.rep += r.rep; t.bookers += r.nBookers;
    t.dil += r.promoAmt + r.c2cDil + r.dt.reduce((s, x) => s + x, 0);
    r.ship.forEach((x, i) => { t.ship[i] = (t.ship[i] || 0) + x - r.shipCan[i]; });
    r.ch.forEach((x, i) => { t.ch[i] = (t.ch[i] || 0) + x; });
  }
  t.net = t.book - t.can + t.fee;
  return t;
};

/* ============================== PACE ============================== */
V.render.pace = function (D, ctx, ui) {
  const y = ctx.year, cy = cyOf(ctx), am = U.mi(ctx.asOf), tgt = E.targetLabel(D, y);
  const P = E.position(D, ctx, ctx.asOf), Pfinal = E.position(D, ctx, D.meta.pull);
  const cur = E.rollup(D, ctx, P, { ...E.yearRange(y), key: keyQ });
  const ly = E.stly(D, ctx, y, keyQ, 1), ly2 = E.stly(D, ctx, y, keyQ, 2);
  const fin = k => y - k < cy ? E.rollup(D, ctx, Pfinal, { ...E.yearRange(y - k), key: keyQ }) : null;
  const f1 = fin(1), f2 = fin(2);
  const tot = { tgt: 0, tix: 0, ly: 0, lyDen: 0, ly2: 0, ly2Den: 0 };
  const curveRows = [];
  for (let q = 0; q < 4; q++) {
    const a = cur.get(q), b = ly.get(q), c = ly2.get(q);
    if (!a) continue;
    const lyDen = b ? (f1 && f1.get(q) ? f1.get(q).tix : b.tgt) : 0, ly2Den = c ? (f2 && f2.get(q) ? f2.get(q).tix : c.tgt) : 0;
    tot.tgt += a.tgt; tot.tix += a.tix; tot.ly += b ? b.tix : 0; tot.lyDen += lyDen; tot.ly2 += c ? c.tix : 0; tot.ly2Den += ly2Den;
    curveRows.push({ q: Q[q], tgt: a.tgt, tix: a.tix, ly: b ? b.tix : null, lyDen, ly2: c ? c.tix : null, ly2Den });
  }
  curveRows.push({ q: 'FY' + y, tgt: tot.tgt, tix: tot.tix, ly: tot.ly, lyDen: tot.lyDen, ly2: tot.ly2, ly2Den: tot.ly2Den, sub: true });
  const curveTable = H.table(
    [{ h: 'Sailing period', l: 1 }, { h: tgt }, { h: 'Booked ITD' }, { h: '% booked' }, { h: 'STLY %', tip: 'Share secured by the prior year\'s sailings at the same calendar point a year earlier.' },
     { h: 'Pace gap' }, { h: 'STLY booked' }, { h: 'YoY' }, { h: 'Y-2 %' }, { h: 'vs Y-2' }],
    curveRows.map(r => {
      const p = ratio(r.tix, r.tgt), lp = ratio(r.ly, r.lyDen), l2 = ratio(r.ly2, r.ly2Den);
      return { cls: r.sub ? 'sub' : '', cells: [r.q, U.money(r.tgt), U.money(r.tix), U.pct(p), lp == null ? '—' : U.pct(lp),
        (p == null || lp == null) ? '—' : H.delta(p - lp, U.pp, true, 0.0005), r.ly == null ? '—' : U.money(r.ly),
        r.ly ? H.delta(r.tix / r.ly - 1, U.signedPct, true, 0.0005) : '—', l2 == null ? '—' : U.pct(l2), (p == null || l2 == null) ? '—' : H.delta(p - l2, U.pp, true, 0.0005)] };
    }));

  const prod = E.production(D, ctx, ctx.asOf), months = H.months(am - 12, am).filter(m => m >= prod.lo);
  const wkey = ctx.flags.charterEx ? 'winX' : 'win';
  const wname = ['Same-year sailings', 'Next-year sailings', 'Two years out and beyond'];
  const wser = wname.map((name, i) => ({ name, color: C.PAL[[0, 2, 4][i]], values: months.map(m => prod.rows[m - prod.lo][wkey][i]) }));
  const winBody = ui.tables.window
    ? H.table([{ h: 'Booking month', l: 1 }].concat(wname.map(n => ({ h: n }))).concat([{ h: 'Bookings' }]),
        months.map((m, i) => { const t = wser.reduce((s, x) => s + x.values[i], 0); return [U.miLabel(m)].concat(wser.map(x => U.pct(ratio(x.values[i], t), 0))).concat([U.money(t)]); }))
    : H.body(C.stack({ labels: months.map(U.miLabel), series: wser, pct: true, tipFmt: U.money, width: 1120, height: 280, every: 1, label: 'Booking window split' })) + C.legend(wser);

  const conRows = [];
  for (const yy of [cy, cy + 1, cy + 2]) {
    if (!D.voyages.some(v => v.year === yy)) continue;
    const a = E.rollup(D, ctx, P, { ...E.yearRange(yy), key: keyQ }), b = E.stly(D, ctx, yy, keyQ, 1);
    conRows.push({ cls: 'grp', cells: [yy + ' sailings', '', '', '', '', '', '', '', '', ''] });
    const T = { tix: 0, ly: 0, pcd: 0, lyPcd: 0, apcd: 0, lyApcd: 0 };
    const line = (label, x, z, sub) => ({ cls: sub ? 'sub' : '', cells: [label, U.money(x.tix), U.money(z.tix), z.tix ? H.delta(x.tix / z.tix - 1, U.signedPct, true, 0.0005) : '—',
      U.int(x.pcd), U.int(z.pcd), U.pct(ratio(x.pcd, x.apcd)), U.pct(ratio(z.pcd, z.apcd)), U.dollars(ratio(x.tix, x.pcd)), U.dollars(ratio(z.tix, z.pcd))] });
    for (let q = 0; q < 4; q++) {
      const x = a.get(q), z = b.get(q) || { tix: 0, pcd: 0, apcd: 0 };
      if (!x) continue;
      T.tix += x.tix; T.ly += z.tix; T.pcd += x.pcd; T.lyPcd += z.pcd; T.apcd += x.apcd; T.lyApcd += z.apcd;
      conRows.push(line(Q[q] + ' ' + yy, x, z));
    }
    conRows.push(line('FY' + yy, { tix: T.tix, pcd: T.pcd, apcd: T.apcd }, { tix: T.ly, pcd: T.lyPcd, apcd: T.lyApcd }, true));
  }

  return V.paceCard(D, ctx, y, '01', 'pace') +
    H.card('curvet', '02', 'Booking curve table', y + ' sailings by quarter against ' + tgt + ' and the two prior years · ' + H.shipName(D, ctx), curveTable +
      '<div class="foot-note">A completed prior year is measured against the revenue it finally delivered; an open one against its target.</div>') +
    H.card('window', '03', 'Booking window split', 'Share of each month\'s bookings by how far ahead the voyage sails' + (ctx.flags.charterEx ? ' · charters excluded' : ' · charters included'), winBody, H.tableBtn('window', ui)) +
    H.card('consol', '04', 'Consolidated booking report', 'Current year against the same time last year, by sailing quarter · ' + H.shipName(D, ctx),
      H.table([{ h: 'Sailing period', l: 1 }, { h: 'Booked' }, { h: 'STLY' }, { h: 'Change' }, { h: 'PCDs' }, { h: 'STLY PCDs' }, { h: 'LF' }, { h: 'STLY LF' }, { h: 'GPD' }, { h: 'STLY GPD' }], conRows));
};

/* ========================== REVENUE TO-GO ========================== */
V.render.togo = function (D, ctx, ui) {
  const y = ctx.year, tg = E.togo(D, ctx, y), tgt = E.targetLabel(D, y), dm = D.dims;
  const cell = a => !a || !a.tgt ? { v: '—' } : { v: '<b>' + (a.tgt >= a.tix ? U.money(a.tgt - a.tix) : U.money(a.tix - a.tgt) + ' over') + '</b><small>' + U.pct(a.tix / a.tgt, 0) + ' booked</small>', cls: 'tg', style: heat(a.tix / a.tgt) };
  const ships = dm.ships.map((s, i) => i).filter(i => ctx.ship < 0 || ctx.ship === i);
  const rows = ships.map(i => [dm.ships[i].name].concat([0, 1, 2, 3].map(q => cell(tg.byShipQ.get(i * 10 + q)))).concat([cell(tg.byShip.get(i))]));
  if (ctx.ship < 0) rows.push({ cls: 'sub', cells: ['Consolidated'].concat([0, 1, 2, 3].map(q => cell(tg.byQ.get(q)))).concat([cell(tg.total)]) });

  const regions = [...tg.byRegion.entries()].filter(([, a]) => a.tgt > 0).sort((a, b) => b[1].tgt - a[1].tgt);
  const maxT = Math.max(1, ...regions.map(([, a]) => Math.max(a.tgt, a.tix)));
  const bars = regions.map(([r, a]) => {
    const p = a.tix / a.tgt;
    return '<div class="rangerow"><div class="rr-head"><span class="rr-name">' + dm.regions[r] + '</span><span class="rr-base">' + U.money(a.tix) + ' of ' + U.money(a.tgt) +
      ' · <b>' + U.pct(p, 0) + '</b> · ' + (a.tgt - a.tix >= 0 ? U.money(a.tgt - a.tix) + ' to go' : U.money(a.tix - a.tgt) + ' over') + '</span></div>' +
      '<div class="rr-track" style="width:' + (a.tgt / maxT * 100).toFixed(1) + '%"><div class="rr-fill" style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></div></div></div>';
  }).join('');

  return H.card('matrix', '01', y + ' revenue to-go by ship and quarter', tgt + ' less booked to date · darker cells are further along',
      H.table([{ h: 'Ship', l: 1 }, { h: 'Q1' }, { h: 'Q2' }, { h: 'Q3' }, { h: 'Q4' }, { h: 'FY' + y }], rows, 'matrix')) +
    H.card('region', '02', y + ' revenue to-go by region', 'Bar length is the target; the fill is what is booked · ' + H.shipName(D, ctx), '<div class="pad">' + (bars || 'No targets in this scope.') + '</div>') +
    H.card('watchall', '03', 'Voyage watchlist', 'Every unsailed voyage in the next 400 days, furthest behind the booking curve first · ' + H.shipName(D, ctx),
      V.watchTable(D, E.watchlist(D, ctx)));
};

/* ============================= CHANNELS ============================= */
V.render.channels = function (D, ctx, ui) {
  const prod = E.production(D, ctx, ctx.asOf), am = U.mi(ctx.asOf), y0 = cyOf(ctx) * 12, dm = D.dims;
  const months = H.months(am - 12, am).filter(m => m >= prod.lo);
  const ser = dm.channels.map((name, i) => ({ name, color: C.PAL[i % 8], values: months.map(m => prod.rows[m - prod.lo].ch[i]) }));
  const mon = sumRows(prod.rows, am, am, prod.lo), ytd = sumRows(prod.rows, y0, am, prod.lo), lyt = sumRows(prod.rows, y0 - 12, am - 12, prod.lo);
  const rows = dm.channels.map((name, i) => {
    const sM = ratio(mon.ch[i] || 0, mon.book), sY = ratio(ytd.ch[i] || 0, ytd.book), sL = ratio(lyt.ch[i] || 0, lyt.book);
    return [name, U.money(mon.ch[i] || 0), U.pct(sM), U.money(ytd.ch[i] || 0), U.pct(sY), sL == null ? '—' : U.pct(sL),
            (sY == null || sL == null) ? '—' : H.delta(sY - sL, U.pp, true, 0.0005), lyt.ch[i] ? H.delta((ytd.ch[i] || 0) / lyt.ch[i] - 1, U.signedPct, true, 0.0005) : '—'];
  });
  rows.push({ cls: 'sub', cells: ['All channels', U.money(mon.book), '100.0%', U.money(ytd.book), '100.0%', '100.0%', '', lyt.book ? H.delta(ytd.book / lyt.book - 1, U.signedPct, true, 0.0005) : '—'] });

  const ta = E.tradeAccounts(D, ctx);
  const acctRows = ta.rows.map(a => [a.name, U.money(a.book), U.pct(a.share), U.money(a.ly), a.yoy == null ? '—' : H.delta(a.yoy, U.signedPct, true, 0.0005),
    U.int(a.count), U.dollars(a.gpd), U.pct(a.canRate)]);
  acctRows.push({ cls: 'sub', cells: ['Trade total', U.money(ta.total), '100.0%', U.money(ta.totalLy), ta.totalLy ? H.delta(ta.total / ta.totalLy - 1, U.signedPct, true, 0.0005) : '—', '', '', ''] });

  return H.card('chmix', '01', 'Channel mix', 'Share of each month\'s bookings by channel · ' + H.shipName(D, ctx),
      H.body(C.stack({ labels: months.map(U.miLabel), series: ser, pct: true, tipFmt: U.money, width: 1120, height: 280, every: 1, label: 'Channel mix by booking month' })) + C.legend(ser) +
      H.table([{ h: 'Channel', l: 1 }, { h: U.miLabel(am) }, { h: 'Share of month' }, { h: 'YTD' }, { h: 'Share of YTD' }, { h: 'STLY share' }, { h: 'Shift' }, { h: 'YTD vs STLY' }], rows)) +
    H.card('trade', '02', 'Strategic agency accounts', 'Trade bookings year to date, at agency headquarters level · ' + H.shipName(D, ctx),
      H.table([{ h: 'Account', l: 1 }, { h: 'YTD bookings' }, { h: 'Share of trade' }, { h: 'STLY' }, { h: 'YoY' }, { h: 'Bookings' }, { h: 'GPD' },
               { h: 'Cancelled', tip: 'Share of this year\'s bookings already cancelled.' }], acctRows));
};

/* ============================== SUITES ============================== */
V.render.suites = function (D, ctx, ui) {
  const tm = E.tierMix(D, ctx), dm = D.dims, tiers = dm.tiers;
  const ser = k => tiers.map((name, t) => ({ name, color: C.PAL[[4, 0, 5][t]], values: tm.map(c => c[k][t]) }));
  const grp = label => ({ cls: 'grp', cells: [label].concat(tm.map(() => '')) });
  const rows = [grp('Revenue share')].concat(tiers.map((n, t) => [n].concat(tm.map(c => U.pct(ratio(c.rev[t], c.revTot))))))
    .concat([grp('Suites share')]).concat(tiers.map((n, t) => [n].concat(tm.map(c => U.pct(ratio(c.suites[t], c.suitesTot))))))
    .concat([grp('Revenue per suite')]).concat(tiers.map((n, t) => [n].concat(tm.map(c => U.dollars(ratio(c.rev[t], c.suites[t]))))))
    .concat([{ cls: 'sub', cells: ['All tiers'].concat(tm.map(c => U.dollars(ratio(c.revTot, c.suitesTot)))) }])
    .concat([grp('Revenue per guest day')]).concat(tiers.map((n, t) => [n].concat(tm.map(c => U.dollars(ratio(c.rev[t], c.pcd[t]))))));
  const map = dm.ships.map(s => [s.name].concat(tiers.map((_, t) => (s.cats && s.cats[t] ? s.cats[t] + ' · ' : '') + (s.suites ? s.suites[t] + ' suites' : '—'))));
  return '<div class="row two">' +
    H.card('tmrev', '01', 'Revenue mix by suite tier', 'Share of ticket revenue · ' + H.shipName(D, ctx),
      H.body(C.stack({ labels: tm.map(c => c.label), series: ser('rev'), pct: true, tipFmt: U.money, every: 1, height: 250, label: 'Revenue mix by suite tier' })) + C.legend(ser('rev'))) +
    H.card('tmsuite', '02', 'Suite mix by tier', 'Share of suites sold', H.body(C.stack({ labels: tm.map(c => c.label), series: ser('suites'), pct: true, tipFmt: U.int, every: 1, height: 250, label: 'Suite mix by tier' })) + C.legend(ser('suites'))) +
    '</div>' +
    H.card('tecon', '03', 'Tier economics', 'Revenue share, suites share and what a suite earns in each tier',
      H.table([{ h: '', l: 1 }].concat(tm.map(c => ({ h: c.label }))), rows) +
      '<div class="foot-note">Budget columns spread budgeted discounts evenly across tiers. Next-year actuals lean towards premium tiers early because that inventory books first.</div>') +
    H.card('tmap', '04', 'Suite categories by ship', 'How each ship\'s suite categories map to the three tiers', H.table([{ h: 'Ship', l: 1 }].concat(tiers.map(t => ({ h: t, l: 1 }))), map));
};

/* ============================== GUESTS ============================== */
V.render.guests = function (D, ctx, ui) {
  const g = E.guests(D, ctx, ctx.year), am = U.mi(ctx.asOf), dm = D.dims, prod = E.production(D, ctx, ctx.asOf);
  const months = H.months(am - 12, am).filter(m => m >= g.lo), ix = m => m - g.lo;
  const shipSer = dm.ships.map((s, i) => ({ name: s.name, color: C.PAL[i % 8], values: months.map(m => g.byShip[i][ix(m)]) })).filter((s, i) => ctx.ship < 0 || ctx.ship === i);
  const repLine = { name: 'Repeat guests', color: 'var(--c5)', fmt: v => U.pct(v, 0), values: months.map(m => ratio(g.rep[ix(m)], g.sailed[ix(m)])) };
  const bk = months.map(m => prod.rows[m - prod.lo]);
  const fvc = months.map(m => ratio(g.fvc[ix(m)], g.sailed[ix(m)]));
  const rs = g.repeatShip.map((r, i) => ({ ...r, name: dm.ships[i].name })).filter((r, i) => ctx.ship < 0 || ctx.ship === i);
  const rsTot = rs.reduce((s, r) => ({ bookings: s.bookings + r.bookings, repeat: s.repeat + r.repeat }), { bookings: 0, repeat: 0 });

  const regs = dm.regions.map((n, r) => ({ n, r, tot: g.geo.reduce((s, row) => s + row[r], 0) })).filter(x => x.tot > 0);
  const geoRows = dm.markets.map((mk, i) => ({ mk, i, tot: g.geo[i].reduce((s, x) => s + x, 0) })).filter(x => x.tot > 0).sort((a, b) => b.tot - a.tot)
    .map(x => [x.mk].concat(regs.map(rg => { const s = g.geo[x.i][rg.r] / rg.tot; return { v: U.pct(s, 0), style: heat(s * 2.2) }; }))
      .concat([U.pct(x.tot / regs.reduce((s, rg) => s + rg.tot, 0), 0)]));
  geoRows.push({ cls: 'sub', cells: ['Guests'].concat(regs.map(rg => U.int(rg.tot))).concat([U.int(regs.reduce((s, rg) => s + rg.tot, 0))]) });

  return '<div class="row two">' +
    H.card('gsail', '01', 'Guests sailed', 'Revenue guests by sailing month, with the repeat-guest share · ' + H.shipName(D, ctx),
      H.body(C.stack({ labels: months.map(U.miLabel), series: shipSer, yFmt: U.int, tipFmt: U.int, line: repLine, label: 'Guests sailed by month' })) +
      C.legend(shipSer.concat([{ name: 'Repeat guests, % (right axis)', color: 'var(--c5)' }]))) +
    H.card('gbook', '02', 'Guests booking', 'Distinct bookers by booking month, with the share of bookings from repeat guests',
      H.body(C.stack({ labels: months.map(U.miLabel), series: [{ name: 'Distinct bookers', color: 'var(--c1)', values: bk.map(r => r.nBookers) }], yFmt: U.int, tipFmt: U.int,
        line: { name: 'Repeat share of bookings', color: 'var(--c5)', fmt: v => U.pct(v, 0), values: bk.map(r => ratio(r.rep, r.count)) }, label: 'Bookers by month' })) +
      C.legend([{ name: 'Distinct bookers', color: 'var(--c1)' }, { name: 'Repeat share, % (right axis)', color: 'var(--c5)' }])) +
    '</div><div class="row two">' +
    H.card('gfvc', '03', 'Future-voyage conversion', 'Guests booking their next voyage on board or within 14 days of sailing, as a share of guests sailed that month',
      H.body(C.lines({ labels: months.map(U.miLabel), yFmt: v => U.pct(v, 0), tipFmt: v => U.pct(v), every: 2,
        series: [{ name: 'FVC conversion', color: 'var(--c3)', values: fvc }], label: 'Future-voyage conversion by sailing month' }))) +
    H.card('grep', '04', 'Repeat bookings by ship', 'Bookings made this year by guests who have sailed before',
      H.table([{ h: 'Ship', l: 1 }, { h: 'Bookings YTD' }, { h: 'From repeat guests' }, { h: 'Repeat rate' }],
        rs.map(r => [r.name, U.int(r.bookings), U.int(r.repeat), U.pct(ratio(r.repeat, r.bookings))])
          .concat(rs.length > 1 ? [{ cls: 'sub', cells: ['All ships', U.int(rsTot.bookings), U.int(rsTot.repeat), U.pct(ratio(rsTot.repeat, rsTot.bookings))] }] : []))) +
    '</div>' +
    H.card('ggeo', '05', ctx.year + ' guest geography by sailing region', 'Where each region\'s guests come from · share of that region\'s guests on the books · ' + H.shipName(D, ctx),
      H.table([{ h: 'Guest market', l: 1 }].concat(regs.map(rg => ({ h: rg.n }))).concat([{ h: 'All regions' }]), geoRows, 'heat'));
};

/* ===================== DILUTION & CANCELLATIONS ===================== */
V.render.dilution = function (D, ctx, ui) {
  const cutoff = E.cutoff(D, ctx), prod = E.production(D, ctx, cutoff), last = U.mi(cutoff), dm = D.dims;
  const months = H.months(last - 12, last).filter(m => m >= prod.lo), rowsM = months.map(m => prod.rows[m - prod.lo]);
  const ser = dm.dtypes.map((name, i) => ({ name, color: C.PAL[(i + 1) % 8], values: rowsM.map(r => r.dt[i]) })).slice(1)
    .concat([{ name: 'Promotions', color: 'var(--c1)', values: rowsM.map(r => r.promoAmt) }, { name: 'C2C offset', color: 'var(--c8)', values: rowsM.map(r => r.c2cDil) }])
    .filter(s => s.values.some(v => v > 0));
  const take = rowsM.map(r => ratio(r.promoAmt + r.c2cDil + r.dt.reduce((s, x) => s + x, 0), r.list));
  const pser = dm.promos.map((name, i) => ({ name, color: C.PAL[(i + 1) % 8], values: rowsM.map(r => ratio(r.promoCnt[i], r.count)) })).slice(1).filter(s => s.values.some(v => v > 0));
  const partial = cutoff !== U.miEnd(last);

  const wk = E.weeklyCancel(D, ctx, 26);
  const prodA = E.production(D, ctx, ctx.asOf), am = U.mi(ctx.asOf), cm = H.months(am - 12, am).filter(m => m >= prodA.lo);
  const canRows = cm.map(m => { const r = prodA.rows[m - prodA.lo]; return [U.miLabel(m), U.money(r.book), U.money(r.can), U.pct(ratio(r.can, r.book)), U.money(r.can - r.canX), U.money(r.fee), U.pct(ratio(r.fee, r.can)), U.int(r.canCount)]; });

  const policy = D.source === 'simulated'
    ? H.table([{ h: 'Days before sailing', l: 1 }, { h: 'Penalty' }, { h: 'Non-refundable promotion' }],
        [['121 or more', 'None', 'Deposit forfeited'], ['120 to 91', '25% of fare', '25% of fare'], ['90 to 61', '50% of fare', '50% of fare'], ['60 to 31', '75% of fare', '75% of fare'], ['30 or fewer', '100% of fare', '100% of fare']]) +
      '<div class="pad policy"><p><b>Cruise-to-cruise transfers.</b> From ' + U.dateLabel(D.meta.c2cPolicy) + ' a transfer records the cancellation penalty on the booking being left, with dilution of the same amount on the replacement booking. ' +
      'Before that date transfers carried no penalty. The two entries net to nothing in ticket revenue but lift both the cancellation-fee and the dilution series, so neither compares cleanly year on year unless transfers are normalised.</p>' +
      '<p><b>Dilution types.</b> FAM: travel-adviser familiarisation rates. Single: single-supplement waivers. Family &amp; Friends: employee-sponsored rates. FVC: the incentive on a future-voyage booking made on board. ' +
      'Future Cruise Credit: credits from an earlier disruption redeemed against a new fare. Other: goodwill and price adjustments.</p>' +
      '<p><b>Weekly cancellation rate.</b> Revenue cancelled in the week over the unsailed booked revenue at the start of the week. Transfers are always excluded.</p></div>'
    : '<div class="pad policy"><p>Policy tables are not part of the booking extract. The weekly cancellation rate is revenue cancelled in the week over the unsailed booked revenue at the start of the week, with transfers excluded.</p></div>';

  return H.card('dil', '01', 'Dilution by type', 'Discount value by booking month, with the take rate against list fare · ' + H.shipName(D, ctx) +
      (ctx.flags.alignAsOf ? '' : ' · through the data pull of ' + U.dateLabel(D.meta.pull) + (partial ? ', so the last month is partial' : '')),
      H.body(C.stack({ labels: months.map(U.miLabel), series: ser, tipFmt: U.money, width: 1120, height: 290, every: 1, line: { name: 'Take rate', color: 'var(--ink-2)', fmt: v => U.pct(v, 1), values: take }, label: 'Dilution by type and month' })) +
      C.legend(ser.concat([{ name: 'Take rate, % of list (right axis)', color: 'var(--ink-2)' }]))) +
    H.card('promo', '02', 'Promotion take rates', 'Share of each month\'s bookings carrying each promotion',
      H.body(C.lines({ labels: months.map(U.miLabel), series: pser, yFmt: v => U.pct(v, 0), tipFmt: v => U.pct(v), every: 1, width: 1120, height: 280, label: 'Promotion take rates' })) + C.legend(pser)) +
    H.card('wcan', '03', 'Weekly cancellation rate', 'Cancelled revenue over the unsailed book, 26 weeks to ' + U.dateLabel(ctx.asOf) + ' · transfers excluded',
      H.body(C.lines({ labels: wk.map(w => U.shortDate(w.end).replace(/ \d\d$/, '')), series: [{ name: 'Weekly cancellation rate', color: 'var(--crit)', values: wk.map(w => w.rate) }],
        yFmt: v => U.pct(v, 2), every: 2, width: 1120, height: 260, label: 'Weekly cancellation rate' }))) +
    H.card('cmon', '04', 'Cancellations by month', 'Cancelled revenue, the share that was a transfer, and the fees kept · ' + H.shipName(D, ctx),
      H.table([{ h: 'Month', l: 1 }, { h: 'Bookings' }, { h: 'Cancelled' }, { h: '% of bookings' }, { h: 'Of which C2C' }, { h: 'Fees kept' }, { h: 'Fees, % of cancelled' }, { h: 'Count' }], canRows)) +
    H.card('policy', '05', 'Cancellation and dilution policy', 'The rules the two series above are produced under', policy);
};

/* ============================= VOYAGES ============================= */
V.render.voyages = function (D, ctx, ui) {
  const y = ctx.year, dm = D.dims;
  let rows = E.voyageTable(D, ctx, y);
  if (ui.voyQ !== 'all') rows = rows.filter(r => U.miQuarter(r.v.smi) === +ui.voyQ);
  const d = (a, b, fmt, eps) => (a == null || b == null) ? '—' : H.delta(a - b, fmt, true, eps);
  const body = H.table(
    [{ h: 'Voyage', l: 1 }, { h: 'Sails', l: 1 }, { h: 'Region', l: 1 }, { h: 'LF' }, { h: 'vs FCST' }, { h: 'vs BDGT' }, { h: 'GPD' }, { h: 'vs FCST' }, { h: 'vs BDGT' },
     { h: 'Revenue' }, { h: 'vs FCST' }, { h: 'vs BDGT' }, { h: '3 months ago', tip: 'Booked revenue on this voyage as the book stood 91 days before the as-of date.' }, { h: 'Pickup' }],
    rows.map(r => ({ cls: r.v.nonRev ? 'memo' : '', cells: [
      r.v.code + (r.v.charter ? ' <span class="pill">charter</span>' : '') + (r.v.nonRev ? ' <span class="pill">non-revenue</span>' : '') + (r.sailed ? '' : ' <span class="pill open">open</span>'),
      U.shortDate(r.v.sail) + ' · D' + r.v.days + (ctx.ship < 0 ? ' · ' + dm.ships[r.v.ship].name : ''), dm.regions[r.v.region],
      r.lf == null ? '—' : U.pct(r.lf), d(r.lf, r.lfFc, U.pp, 0.0005), d(r.lf, r.lfBud, U.pp, 0.0005),
      r.gpd == null ? '—' : U.dollars(r.gpd), d(r.gpd, r.gpdFc, v => (v >= 0 ? '+' : '−') + U.dollars(Math.abs(v)), 0.5), d(r.gpd, r.gpdBud, v => (v >= 0 ? '+' : '−') + U.dollars(Math.abs(v)), 0.5),
      U.money(r.tix), d(r.tix, r.revFc, U.signedMoney, 500), d(r.tix, r.revBud, U.signedMoney, 500), U.money(r.prev3), H.delta(r.tix - r.prev3, U.signedMoney, true, 500)] })), 'voy');
  return H.card('voy', '01', y + ' voyages against forecast, budget and three months ago', rows.length + ' voyages · ' + H.shipName(D, ctx) +
      ' · open voyages show the book to date, so their gaps to target are revenue still to come',
    body, H.tabs('voyq', [['all', 'All']].concat(Q.map((q, i) => [i, q])), ui.voyQ, 'Sailing quarter'));
};

/* ========================== REVENUE TABLES ========================== */
V.render.revenue = function (D, ctx, ui) {
  const prod = E.production(D, ctx, ctx.asOf), am = U.mi(ctx.asOf), dm = D.dims;
  const n = { month: 1, t3: 3, t12: 12 }[ui.revTab], from = am - n + 1;
  const cur = sumRows(prod.rows, from, am, prod.lo), py = sumRows(prod.rows, from - 12, am - 12, prod.lo);
  const line = (label, a, b, fmt, goodUp, tip) => [{ v: label, tip }, fmt(a), b == null ? '—' : fmt(b), (b ? H.delta(a / b - 1, U.signedPct, goodUp, 0.0005) : '—')];
  const rows = [
    line('Gross revenues', cur.net, py.net, U.money, true, 'Ticket revenue gross of commissions, net of the period\'s cancellations, net of dilution, plus cancellation fees. Revenue guests only.'),
    line('Bookings ($)', cur.book, py.book, U.money, true, 'Booked revenue produced in the period, net of dilution.'),
    line('Cancellations ($)', cur.can, py.can, U.money, false, 'Revenue on bookings cancelled in the period.'),
    line('Cancellation fees', cur.fee, py.fee, U.money, true, 'Penalties kept on those cancellations.'),
    line('Bookings (count)', cur.count, py.count, U.int, true, 'Each suite in a charter counts as one booking.'),
    line('Suites', cur.suites, py.suites, U.int, true), line('PCDs', cur.pcd, py.pcd, U.int, true, 'Passenger cruise days: guests × days.'),
    line('GPD', ratio(cur.book, cur.pcd), ratio(py.book, py.pcd), U.dollars, true, 'Gross price per day on the period\'s bookings.'),
    line('Dilution ($)', cur.dil, py.dil, U.money, false), line('Dilution, % of list', ratio(cur.dil, cur.list), ratio(py.dil, py.list), U.pct, false),
  ];
  const shipRows = dm.ships.map((s, i) => [s.name, U.money(cur.ship[i] || 0), U.money(py.ship[i] || 0), py.ship[i] ? H.delta((cur.ship[i] || 0) / py.ship[i] - 1, U.signedPct, true, 0.0005) : '—',
    U.pct(ratio(cur.ship[i] || 0, cur.book - cur.can))]).filter((r, i) => ctx.ship < 0 || ctx.ship === i);
  const months = H.months(am - 12, am).filter(m => m >= prod.lo);
  const ser = dm.ships.map((s, i) => ({ name: s.name, color: C.PAL[i % 8], values: months.map(m => { const r = prod.rows[m - prod.lo]; return Math.max(0, r.ship[i] - r.shipCan[i]); }) }))
    .filter((s, i) => ctx.ship < 0 || ctx.ship === i);
  const label = n === 1 ? U.miLabel(am) : U.miLabel(from) + ' – ' + U.miLabel(am), pyLabel = n === 1 ? U.miLabel(am - 12) : U.miLabel(from - 12) + ' – ' + U.miLabel(am - 12);
  return H.card('revsum', '01', 'Revenue summary', 'Booking production across all sailing years · ' + H.shipName(D, ctx),
      H.table([{ h: 'Measure', l: 1 }, { h: label }, { h: pyLabel }, { h: 'Change' }], rows),
      H.tabs('rev', [['month', 'Month'], ['t3', 'Trailing 3M'], ['t12', 'Trailing 12M']], ui.revTab, 'Period')) +
    '<div class="row two">' +
    H.card('revship', '02', 'Net bookings by ship', label + ' against ' + pyLabel,
      H.table([{ h: 'Ship', l: 1 }, { h: label }, { h: pyLabel }, { h: 'Change' }, { h: 'Share' }], shipRows)) +
    H.card('revtrend', '03', 'Net bookings by month', 'Bookings less cancellations, by ship',
      H.body(C.stack({ labels: months.map(U.miLabel), series: ser, tipFmt: U.money, label: 'Net bookings by month and ship' })) + C.legend(ser)) +
    '</div>';
};

/* ======================== DEFINITIONS & DATA ======================== */
const MEASURES = [
  ['Gross Revenues', 'Ticket revenue gross of commissions, net of the month\'s cancellations, net of dilution; revenue guests only', '$M', 'revenue'],
  ['Bookings ($)', 'Booked revenue produced in the period', '$', 'revenue'],
  ['Bookings (count)', 'Booking count; each suite in a charter counts as one booking', '#', 'revenue'],
  ['Suites', 'Suite count booked', '#', 'suites'],
  ['PCDs', 'Passenger cruise days = guests × days', '#', 'revenue'],
  ['APCDs', 'Available PCDs, net of non-revenue voyages', '#', 'voyages'],
  ['GPD / PPD', 'Gross price per day = gross revenue ÷ PCDs', '$', 'voyages'],
  ['LF %', 'Load factor = PCDs ÷ APCDs — booking pace to date, not final occupancy', '%', 'voyages'],
  ['Forecast (FCST)', 'Current-year full-year forecast; voyages prorated', '$M', 'togo'],
  ['Budget (BDGT / BP)', 'Budget for the year ahead and the baseline for every year', '$M', 'togo'],
  ['Outlook', 'Revised forecast: sailed voyages at actual plus the projected finish of the unsailed book', '$M', 'flight'],
  ['Revenue to-go', 'Target less booked to date, by voyage, ship, quarter and region', '$M', 'togo'],
  ['Cancellations ($ and %)', 'Cancelled revenue; cancellation fee revenue; share of ticket revenue', '$ / %', 'dilution'],
  ['Dilution ($ and %)', 'Discount value by type; share of bookings', '$ / %', 'dilution'],
  ['Guests sailed', 'Revenue guests sailing in the month', '#', 'guests'],
  ['Guests booking', 'Distinct bookers in the month', '#', 'guests'],
  ['Repeaters', 'Guests with a prior sailing', '# / %', 'guests'],
  ['FVC conversion', 'Booked on board or within 14 days of sailing', '# / %', 'guests'],
];
const DERIVED = [
  ['% of target booked ITD', 'Booked ÷ (forecast or budget), by ship, quarter, region and year', 'togo'],
  ['Target secured % vs STLY', 'The same calendar point in the prior year', 'pace'],
  ['YoY / MoM / vs Y-2 %', 'Period-over-period change on bookings', 'pace'],
  ['Pace gap (pp)', 'Current booking curve less the STLY curve, in percentage points', 'pace'],
  ['Actual vs FCST / BDGT delta', 'Per voyage, for load factor, GPD and revenue', 'voyages'],
  ['Revenue vs previous 3 months', 'Per voyage: the book now against the book 91 days earlier', 'voyages'],
  ['Channel mix %', 'Share of the month and share of year to date', 'channels'],
  ['Suite mix %', 'Prior-year actual, current-year budget and actual ITD, next-year budget and actual ITD', 'suites'],
  ['Tier economics', 'Revenue share, suites share and revenue per suite by tier', 'suites'],
  ['Repeater rate', 'On guests sailed and on bookers; repeat bookings by ship', 'guests'],
  ['Weekly cancellation %', 'Cancelled ÷ unsailed booked revenue, excluding C2C transfers', 'dilution'],
  ['Dilution take rate', 'Dilution ÷ bookings at list, by type and month', 'dilution'],
];
const SLIDES = [
  ['2–3, 7–8', 'Executive summary and outlook', 'flight'], ['4', 'Channel mix', 'channels'], ['5–6', 'Trade / strategic agency accounts', 'channels'],
  ['9–21', 'Revenue to-go by ship, quarter and region (current year, then next year)', 'togo'], ['22–23', 'Booking curve tables vs forecast and budget', 'pace'],
  ['24–28', 'Booking curves vs budget; booking window split', 'pace'], ['30–33', 'Suite tier mix and economics', 'suites'],
  ['34–37', 'Guests sailed, bookers, repeaters, FVC conversion', 'guests'], ['38–40', 'Dilution and promotion take rates', 'dilution'], ['41–42', 'Cancellations', 'dilution'],
  ['43–46', 'Voyage watchlists / revenue to-go by voyage', 'togo'], ['48–51', 'Revenue summary tables (month, trailing 3M, trailing 12M)', 'revenue'],
  ['54–58', 'Guest, repeater and FVC detail', 'guests'], ['59–60', 'Cancellation and dilution policy detail', 'dilution'],
  ['61–72', 'Per-voyage LF and GPD vs forecast and budget', 'voyages'], ['73–78', 'Guest geography by sailing region', 'guests'],
  ['79–84', 'Per-voyage revenue vs forecast, budget and prior 3 months', 'voyages'], ['85–88', 'Consolidated booking report, CY vs STLY by quarter', 'pace'],
];

V.render.defs = function (D, ctx, ui) {
  const dm = D.dims, name = id => V.LIST.find(v => v.id === id).label, go = id => '<a href="#" data-act="view:' + id + '">' + name(id) + '</a>';
  const years = [...new Set(D.voyages.map(v => v.year))].sort();
  const dims = [
    ['Ship', dm.ships.map(s => s.name).join(', ') + ', Consolidated'], ['Sailing year', years.join(', ') + ', all sailings'],
    ['Booking period', 'Booking month, cumulative ITD, YTD, STLY, trailing 3M, trailing 12M'],
    ['Sailing quarter / month', 'Two conventions: voyages prorated by sailing days, or assigned whole to the sail month'],
    ['Voyage', 'Voyage code, date, embark and debark port, duration (D7, D10, D14…), charter flag'], ['Region', dm.regions.join(', ')],
    ['Channel', dm.channels.join(', ')], ['Trade account', 'Strategic agency roster at headquarters level — ' + dm.accounts.length + ' accounts'],
    ['Suite tier', dm.tiers.join(' / ') + ', with a per-ship category mapping'], ['Promotion type', dm.promos.slice(1).join(', ')],
    ['Dilution type', dm.dtypes.slice(1).join(', ')], ['Guest market', 'Source geography × sailing region — ' + dm.markets.join(', ')],
    ['Booking window', 'Same year / next year / two years out'],
  ];
  const contract = k => H.table([{ h: 'Column', l: 1 }, { h: 'Type', l: 1 }, { h: 'Required', l: 1 }, { h: 'Meaning', l: 1 }],
    CBR.sigma.CONTRACT[k].map(c => ['<code>' + c[0] + '</code>', c[1], c[2] ? 'yes' : 'optional', c[3] || '']));
  return H.card('dsrc', '01', 'Where the numbers come from', 'One fact table at voyage × suite × booking-date grain, plus a voyage table',
      '<div class="pad policy"><p>Every view on this page resolves to two tables: a <b>bookings</b> table with one row per suite booked on a voyage on a booking date, and a <b>voyages</b> table carrying capacity, budget and forecast. ' +
      'Eighteen base measures and thirteen dimensions generate every view.</p><p><b>Now showing:</b> ' +
      (D.source === 'simulated' ? 'simulated data for ' + D.meta.company + ', a fictional line — ' : 'data from Sigma — ') + D.bookings.length.toLocaleString('en-US') + ' bookings on ' + D.voyages.length +
      ' voyages, extracted ' + U.dateLabel(D.meta.pull) + ' for a ' + U.dateLabel(D.meta.asOf) + ' close.' +
      (D.source === 'simulated' ? ' The simulated actuals are the plan run through deliberate deviations — a soft booking patch, regional demand shifts, a drydock overrun, a fuel spike — so every variance traces to something that moved.' : '') + '</p></div>') +
    H.card('dmeas', '02', 'Measures', 'Definitions as used in the booking report',
      H.table([{ h: 'Measure', l: 1 }, { h: 'Definition', l: 1 }, { h: 'Unit', l: 1 }, { h: 'See', l: 1 }], MEASURES.map(m => ['<b>' + m[0] + '</b>', m[1], m[2], go(m[3])]), 'wrapt')) +
    H.card('ddim', '03', 'Dimensions', 'Members in the data currently loaded', H.table([{ h: 'Dimension', l: 1 }, { h: 'Members / notes', l: 1 }], dims.map(d => ['<b>' + d[0] + '</b>', d[1]]), 'wrapt')) +
    H.card('dder', '04', 'Derived metrics', '', H.table([{ h: '#' }, { h: 'Derived metric', l: 1 }, { h: 'Calculation', l: 1 }, { h: 'See', l: 1 }], DERIVED.map((d, i) => [i + 1, '<b>' + d[0] + '</b>', d[1], go(d[2])]), 'wrapt')) +
    H.card('dadj', '05', 'Adjustments and filters', 'Each is a switch in the bar under the controls, applied to every view at once',
      H.table([{ h: 'Adjustment', l: 1 }, { h: 'Now', l: 1 }, { h: 'Impact on the pull', l: 1 }],
        V.ADJUSTMENTS.map(a => ['<b>' + a.on + '</b>', '<span class="pill ' + (ctx.flags[a.key] ? 'ok' : '') + '">' + (ctx.flags[a.key] ? 'on' : 'off') + '</span>', a.def]), 'wrapt')) +
    H.card('dmap', '06', 'Deck to dashboard map', 'Which tab replaces which slides of the 88-slide booking report',
      H.table([{ h: 'Slides', l: 1 }, { h: 'Deck view', l: 1 }, { h: 'Dashboard tab', l: 1 }], SLIDES.map(s => [s[0], s[1], go(s[2])]))) +
    H.card('dsig', '07', 'Sigma data contract', 'Embed this page in a Sigma workbook as a plugin, then point it at two elements with these column names',
      '<div class="pad policy"><p>Column names are matched ignoring case, spaces and punctuation. Dates may be Sigma datetimes or ISO strings. Sigma hands data over 25,000 rows at a time, so each element is read page by page ' +
      'and nothing is drawn until both tables are complete. Budget and forecast arrive as revenue and guest days per voyage; ' +
      'operating costs are not part of the extract, so with Sigma data the profit bridge stops at ticket revenue less commissions and the cash river shows refunds and commissions only. ' +
      '<b>The connector follows Sigma\'s published plugin API and is tested against a simulated host, but has not yet been run inside a workbook.</b></p></div>' +
      '<h3 class="subhead">Bookings element</h3>' + contract('bookings') + '<h3 class="subhead">Voyages element</h3>' + contract('voyages'));
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
