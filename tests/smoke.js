/* Headless check: node tests/smoke.js
   Builds the simulated book, renders every view under a spread of control
   settings, and fails if any view throws, prints a broken number, or any
   integrity check breaks. Also round-trips the book through the Sigma
   connector's column format and confirms the same position comes back. */
const path = require('path');
const app = path.join(__dirname, '..', 'app');
for (const f of ['util', 'data-sim', 'engine', 'charts', 'sigma', 'views', 'views-detail']) require(path.join(app, f + '.js'));
const { util: U, engine: E, views: V, sigma: S } = globalThis.CBR;

const D = E.prepare(CBR.buildSimulated());
const base = () => ({ ...E.defaults(), asOf: D.meta.asOf, year: U.miYear(U.mi(D.meta.asOf)) });
const ui = () => ({ view: 'flight', tables: {}, bridgeBase: 'bud', focus: null, revTab: 'month', voyQ: 'all', saved: null, still: true, narrow: false, filter: {} });
let renders = 0;
const problems = [];

function run(label, data, ctx, u) {
  for (const v of V.LIST) {
    try {
      const html = V.render[v.id](data, ctx, u);
      renders++;
      if (/NaN|undefined|Infinity/.test(html.replace(/<title>[\s\S]*?<\/title>/g, ''))) problems.push(label + ' / ' + v.id + ': broken number in output');
    } catch (e) { problems.push(label + ' / ' + v.id + ': ' + e.message); }
  }
  for (const c of E.checks(data, ctx)) if (!c.ok) problems.push(label + ': integrity check failed — ' + c.name + ' (' + c.detail + ')');
}

const cy = base().year;
run('default', D, base(), ui());
D.dims.ships.forEach((_, ship) => run('ship ' + ship, D, { ...base(), ship }, ui()));
for (const year of [cy - 2, cy - 1, cy + 1, cy + 2]) run('year ' + year, D, { ...base(), year }, ui());
run('phone', D, base(), { ...ui(), narrow: true });
run('pace side by side', D, base(), { ...ui(), paceLayout: 'side' });
run('pace stacked', D, base(), { ...ui(), paceLayout: 'stack' });
run('pace bars', D, base(), { ...ui(), paceLayout: 'bars' });
for (const window of ['ytd', 'r12']) for (const bridgeBase of ['bud', 'fc', 'stly']) run(window + ' ' + bridgeBase, D, { ...base(), window }, { ...ui(), bridgeBase });
for (const k of Object.keys(E.defaults().flags)) { const c = base(); c.flags = { ...c.flags, [k]: !c.flags[k] }; run('flag ' + k, D, c, ui()); }
run('tables', D, base(), { ...ui(), tables: { bridge: 1, river: 1, cashm: 1, window: 1 }, revTab: 't12', voyQ: '2', saved: { vol: 0.1, price: 0, cancel: 0, dil: 0, fuel: 0 } });
run('scenario', D, { ...base(), scen: { vol: 0.2, price: -0.05, cancel: 0.5, dil: 0.02, fuel: 0.3 } }, ui());
for (let m = 1; m <= 11; m++) run('as of -' + m, D, { ...base(), asOf: U.miEnd(U.mi(D.meta.asOf) - m) }, ui());

// Sigma round trip
const dm = D.dims, ms = 864e5;
const vRows = D.voyages.map(v => ({ voyage_code: v.code, ship: dm.ships[v.ship].name, sail_date: new Date(v.sail * ms).toISOString().slice(0, 10), days: v.days, region: dm.regions[v.region],
  is_charter: v.charter, is_non_revenue: v.nonRev, suites_premium: v.cap[0], suites_upper: v.cap[1], suites_lower: v.cap[2],
  budget_revenue: v.budRev, budget_pcd: v.budPcd, forecast_revenue: v.fcRev, forecast_pcd: v.fcPcd }));
const bRows = D.bookings.map(b => ({ voyage_code: D.voyages[b.v].code, suite_tier: dm.tiers[b.t], booking_date: b.bd * ms, cancel_date: b.cd ? b.cd * ms : null, channel: dm.channels[b.ch],
  trade_account: b.acct >= 0 ? dm.accounts[b.acct] : null, promotion_type: dm.promos[b.promo], dilution_type: dm.dtypes[b.dt], guests: b.g, list_fare: b.list,
  promotion_amount: b.pAmt, dilution_amount: b.dAmt, cancel_fee: b.fee, guest_market: dm.markets[b.mkt], guest_id: b.gid || null, is_repeater: b.rep, is_fvc: b.fvc,
  fvc_source_voyage: b.src >= 0 ? D.voyages[b.src].code : null, is_barter: b.barter, is_non_revenue: b.nr, c2c_role: b.c2c === 1 ? 'out' : b.c2c === 2 ? 'in' : '', c2c_offset_dilution: b.c2cDil }));
const columnar = rows => { const data = {}, cols = {}; Object.keys(rows[0]).forEach((k, i) => { cols['c' + i] = { id: 'c' + i, name: k.replace(/_/g, ' ').toUpperCase() }; data['c' + i] = rows.map(r => r[k]); }); return [data, cols]; };
const [bd, bc] = columnar(bRows), [vd, vc] = columnar(vRows);
const G = E.prepare(S.build(S.toRows(bd, bc), S.toRows(vd, vc)));
const gctx = { ...E.defaults(), asOf: G.meta.asOf, year: cy };
run('sigma round trip', G, gctx, ui());
const a = E.headline(D, base()).years[0], b = E.headline(G, gctx).years[0];
if (Math.abs(a.tix - b.tix) > 1 || Math.abs(a.lf - b.lf) > 1e-9) problems.push('sigma round trip: booked ' + U.money(b.tix) + ' and LF ' + U.pct(b.lf) + ' differ from the source ' + U.money(a.tix) + ' and ' + U.pct(a.lf));

console.log(D.bookings.length + ' bookings on ' + D.voyages.length + ' voyages · ' + renders + ' renders · ' + problems.length + ' problems');
for (const p of problems) console.log('  ' + p);
process.exit(problems.length ? 1 : 0);
