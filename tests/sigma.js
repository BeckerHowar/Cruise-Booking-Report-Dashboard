/* Sigma connector check: node tests/sigma.js
   Drives the connector with a stand-in for the Sigma host and confirms that a
   table larger than one 25,000-row page is read to the end on both kinds of
   host, that nothing is published from a partial table, and that rows
   standing for several bookings reproduce the one-row-per-booking figures. */
const path = require('path');
const app = path.join(__dirname, '..', 'app');
for (const f of ['util', 'data-sim', 'engine', 'sigma']) require(path.join(app, f + '.js'));
const { util: U, engine: E, sigma: S } = globalThis.CBR;

const problems = [];
const check = (ok, label) => { if (!ok) problems.push(label); };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1 : tol);

/* ---------- the simulated book, exported the way Sigma would hold it ---------- */
const D = E.prepare(CBR.buildSimulated());
const dm = D.dims, ms = 864e5, iso = d => new Date(d * ms).toISOString().slice(0, 10);
const vRows = D.voyages.map(v => ({ voyage_code: v.code, ship: dm.ships[v.ship].name, sail_date: iso(v.sail), days: v.days, region: dm.regions[v.region],
  is_charter: v.charter, is_non_revenue: v.nonRev, suites_premium: v.cap[0], suites_upper: v.cap[1], suites_lower: v.cap[2],
  budget_revenue: v.budRev, budget_pcd: v.budPcd, forecast_revenue: v.fcRev, forecast_pcd: v.fcPcd }));
const rowOf = b => ({ voyage_code: D.voyages[b.v].code, suite_tier: dm.tiers[b.t], booking_date: b.bd * ms, cancel_date: b.cd ? b.cd * ms : null, channel: dm.channels[b.ch],
  trade_account: b.acct >= 0 ? dm.accounts[b.acct] : null, promotion_type: dm.promos[b.promo], dilution_type: dm.dtypes[b.dt], guests: b.g, list_fare: b.list,
  promotion_amount: b.pAmt, dilution_amount: b.dAmt, cancel_fee: b.fee, guest_market: dm.markets[b.mkt], guest_id: b.gid || null, is_repeater: b.rep, is_fvc: b.fvc,
  fvc_source_voyage: b.src >= 0 ? D.voyages[b.src].code : null, is_barter: b.barter, is_non_revenue: b.nr, c2c_role: b.c2c === 1 ? 'out' : b.c2c === 2 ? 'in' : '', c2c_offset_dilution: b.c2cDil });
const bRows = D.bookings.map(rowOf);

const table = rows => {
  const keys = Object.keys(rows[0]), cols = {}, data = {};
  keys.forEach((k, i) => { cols['c' + i] = { id: 'c' + i, name: k.replace(/_/g, ' ').toUpperCase() }; data['c' + i] = rows.map(r => r[k]); });
  return { cols, data, n: rows.length };
};
const slice = (t, from, to) => { const o = {}; for (const id of Object.keys(t.data)) o[id] = t.data[id].slice(from, to); return o; };

/* ---------- a stand-in Sigma host ----------
   incremental  sends each page once, with its offset, and flags the last one
   cumulative   resends everything so far at offset 0 and never flags the end
   silent       cumulative, and ignores a request once it has nothing more     */
function host(tables, mode, page) {
  const subs = {}, sent = {};
  const send = (name, asked) => {
    const t = tables[name], cb = subs[name];
    if (!cb) return;
    if (mode === 'incremental') {
      if (sent[name] >= t.n) return;
      const from = sent[name], to = Math.min(t.n, from + page);
      sent[name] = to;
      cb({ data: slice(t, from, to), offset: from, isComplete: to >= t.n, totalRows: t.n });
    } else {
      if (mode === 'silent' && asked && sent[name] >= t.n) return;
      sent[name] = Math.min(t.n, sent[name] + page);
      cb({ data: slice(t, 0, sent[name]), offset: 0, isComplete: false });
    }
  };
  return {
    config: { configureEditorPanel() {}, setLoadingState() {} },
    elements: {
      subscribeToElementColumns(name, cb) { setTimeout(() => cb(tables[name].cols), 0); return () => {}; },
      subscribeToIncrementalElementData(name, cb) { subs[name] = cb; sent[name] = 0; setTimeout(() => send(name), 0); return () => {}; },
      fetchMoreElementData(name) { setTimeout(() => send(name, true), 0); },
    },
    restart(name, t) { tables[name] = t; sent[name] = 0; send(name); },
    fail(name) { subs[name](null); },
  };
}

// Runs the connector against a host until it settles, recording everything it emitted.
function run(tables, mode, page, stallMs) {
  return new Promise(resolve => {
    const events = [], client = host(tables, mode, page);
    let quiet = null;
    S.attach(client, e => { events.push(e); clearTimeout(quiet); quiet = setTimeout(() => resolve({ events, client }), stallMs * 3 + 60); }, { page, stallMs });
  });
}
const lastOf = (events, state) => [...events].reverse().find(e => e.state === state);

(async () => {
  const full = { bookings: table(bRows), voyages: table(vRows) };
  const want = E.headline(D, { ...E.defaults(), asOf: D.meta.asOf, year: U.miYear(U.mi(D.meta.asOf)) }).years[0];
  check(bRows.length > S.PAGE, 'the test book should be larger than one Sigma page (' + bRows.length + ' rows)');

  for (const mode of ['incremental', 'cumulative']) {
    const { events } = await run({ ...full }, mode, S.PAGE, 40);
    const connected = events.filter(e => e.state === 'connected');
    check(connected.length === 1, mode + ': expected to publish once, published ' + connected.length + ' times');
    const ds = connected[0] && connected[0].dataset;
    check(ds && ds.bookings.length === bRows.length, mode + ': read ' + (ds ? ds.bookings.length : 0) + ' of ' + bRows.length + ' bookings');
    check(events.some(e => e.state === 'loading' && /25,000/.test(e.message)), mode + ': no progress message while the first page was in');
    check(events.findIndex(e => e.state === 'connected') > events.findIndex(e => e.state === 'loading'), mode + ': published before loading finished');
    if (ds) {
      const G = E.prepare(ds), got = E.headline(G, { ...E.defaults(), asOf: G.meta.asOf, year: want.year }).years[0];
      check(near(got.tix, want.tix) && near(got.lf, want.lf, 1e-9), mode + ': booked ' + U.money(got.tix) + ' / LF ' + U.pct(got.lf) + ' differ from the source');
    }
    console.log(mode.padEnd(12) + 'read ' + (ds ? ds.bookings.length.toLocaleString('en-US') : 0) + ' rows in ' + events.filter(e => e.state === 'loading').length + ' loading steps');
  }

  // A host that never confirms the end and goes quiet on an exact multiple of the page size.
  {
    const page = 1000, t = { bookings: table(bRows.slice(0, 3000)), voyages: table(vRows) };
    const { events } = await run(t, 'silent', page, 40);
    const c = lastOf(events, 'connected');
    check(c && c.dataset.bookings.length === 3000, 'silent host: expected 3,000 rows, got ' + (c ? c.dataset.bookings.length : 'no dataset'));
    check(c && /inferred/.test(c.message), 'silent host: the inferred-completeness note is missing');
    console.log('silent'.padEnd(12) + 'settled on ' + (c ? c.dataset.bookings.length.toLocaleString('en-US') : 0) + ' rows after the host stopped answering');
  }

  // The workbook changes a filter: the host restarts the stream with fewer rows.
  {
    const page = 1000, t = { bookings: table(bRows.slice(0, 2500)), voyages: table(vRows) };
    const { events, client } = await run(t, 'incremental', page, 40);
    client.restart('bookings', table(bRows.slice(0, 700)));
    await new Promise(r => setTimeout(r, 120));
    const c = lastOf(events, 'connected');
    check(c && c.dataset.bookings.length === 700, 'restart: expected the 700-row table, got ' + (c ? c.dataset.bookings.length : 'none'));
    client.fail('bookings');
    check(events[events.length - 1].state === 'error', 'failed evaluation: expected an error state, got ' + events[events.length - 1].state);
    console.log('restart'.padEnd(12) + 'rebuilt on the new table, and a failed evaluation reports an error');
  }

  // Rows that cannot be placed are refused rather than appended in the wrong position.
  {
    const a = S.accumulator();
    a.apply({ data: { x: [1, 2, 3] }, offset: 0, isComplete: false });
    check(a.apply({ data: { x: [9, 9] }, offset: 5, isComplete: false }) === false && a.rows === 3, 'gap: a chunk past the end was accepted');
    a.apply({ data: { x: [4, 5] }, offset: 3, isComplete: true });
    check(a.rows === 5 && a.complete && a.data.x.join() === '1,2,3,4,5', 'append: rows out of order');
  }

  /* ---------- rows that stand for several bookings ----------
     Identical bookings are merged into one row carrying a count, the way a
     charter held as a single contract row would arrive. Every figure must
     match the one-row-per-booking table exactly. */
  const groups = new Map();
  const keyCols = ['voyage_code', 'suite_tier', 'booking_date', 'cancel_date', 'channel', 'trade_account', 'promotion_type', 'dilution_type', 'guest_market',
                   'is_repeater', 'is_fvc', 'fvc_source_voyage', 'is_barter', 'is_non_revenue', 'c2c_role'];
  const sumCols = ['guests', 'list_fare', 'promotion_amount', 'dilution_amount', 'cancel_fee', 'c2c_offset_dilution'];
  for (const b of D.bookings) {
    const r = rowOf(b);
    delete r.guest_id;
    const k = keyCols.map(c => r[c]).join('|');
    let g = groups.get(k);
    if (!g) { g = { ...r, bookings: 0, bookers: 0 }; for (const c of sumCols) g[c] = 0; groups.set(k, g); }
    g.bookings++; if (b.gid) g.bookers++;
    for (const c of sumCols) g[c] += r[c];
  }
  const gRows = [...groups.values()];
  const merged = gRows.filter(r => r.bookings > 1).length;
  check(merged > 0, 'merged rows: the test book produced no row standing for more than one booking');
  const { events } = await run({ bookings: table(gRows), voyages: table(vRows) }, 'incremental', S.PAGE, 40);
  const c = lastOf(events, 'connected');
  check(!!c, 'merged rows: the connector did not publish');
  if (c) {
    const G = E.prepare(c.dataset), ctxG = { ...E.defaults(), asOf: D.meta.asOf, year: want.year }, ctxD = { ...E.defaults(), asOf: D.meta.asOf, year: want.year };
    const got = E.headline(G, ctxG).years;
    E.headline(D, ctxD).years.forEach((w, i) => check(near(got[i].tix, w.tix, 2) && near(got[i].lf, w.lf, 1e-9),
      'merged rows: ' + w.year + ' booked ' + U.money(got[i].tix) + ' / LF ' + U.pct(got[i].lf) + ' against ' + U.money(w.tix) + ' / ' + U.pct(w.lf)));
    const am = U.mi(D.meta.asOf), pd = E.production(D, ctxD, D.meta.asOf), pg = E.production(G, ctxG, D.meta.asOf);
    for (let m = am - 12; m <= am; m++) {
      const a = pd.rows[m - pd.lo], b = pg.rows[m - pg.lo];
      check(near(a.book, b.book, 2) && near(a.can, b.can, 2) && a.count === b.count && a.suites === b.suites && a.guests === b.guests && a.rep === b.rep && a.canCount === b.canCount,
        'merged rows: ' + U.miLabel(m) + ' production differs (bookings ' + b.count + ' vs ' + a.count + ', cancelled ' + U.money(b.can) + ' vs ' + U.money(a.can) + ')');
    }
    const wd = E.weeklyCancel(D, ctxD, 26), wg = E.weeklyCancel(G, ctxG, 26);
    check(wd.every((w, i) => near(w.cancelled, wg[i].cancelled, 2) && near(w.book, wg[i].book, 2)), 'merged rows: the weekly cancellation series differs');
    const ck = E.checks(G, ctxG).filter(x => !x.ok);
    check(!ck.length, 'merged rows: integrity checks failed — ' + ck.map(x => x.name).join(', '));
    console.log('merged rows'.padEnd(12) + ' ' + gRows.length.toLocaleString('en-US') + ' rows stand for ' + bRows.length.toLocaleString('en-US') + ' bookings (' + merged +
      ' rows carry more than one); position, monthly production and weekly cancellations match exactly');
  }

  console.log(problems.length + ' problems');
  for (const p of problems) console.log('  ' + p);
  process.exit(problems.length ? 1 : 0);
})();
