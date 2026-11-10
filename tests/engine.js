/* Known-answer check: node tests/engine.js
   A book of nine bookings on three voyages, small enough to work by hand.
   Every expected figure below was calculated on paper from the definitions,
   not copied from the engine's output, so this catches the engine being
   consistently wrong — which the integrity checks alone cannot. */
const path = require('path');
const app = path.join(__dirname, '..', 'app');
for (const f of ['util', 'engine']) require(path.join(app, f + '.js'));
const { util: U, engine: E } = globalThis.CBR;

const problems = [];
const eq = (got, want, label, tol) => { if (!(Math.abs(got - want) <= (tol == null ? 0.01 : tol))) problems.push(label + ': expected ' + want + ', got ' + got); };

const AS_OF = U.dn(2026, 4, 30);
const blank = { cd: 0, ch: 0, acct: -1, promo: 0, dt: 0, g: 2, list: 0, pAmt: 0, dAmt: 0, c2c: 0, c2cDil: 0, fee: 0, mkt: 0, rep: false, fvc: false, src: -1, barter: false, nr: false, gid: 0 };
const target = (pcd, list, dil, fee, tradeRev, pcdGross, apcd) => ({ pcd, list, dil, fee, tradeRev, pcdGross, apcd });

function book() {
  return {
    source: 'test',
    meta: { company: 'Test', pull: U.dn(2026, 5, 31), asOf: AS_OF, c2cPolicy: null, budgetComm: 0.13 },
    dims: { ships: [{ code: 'TS', name: 'Test', suites: [2, 4, 4] }], tiers: ['Premium', 'Upper', 'Lower'], regions: ['Sea'],
            channels: ['Direct', 'Trade'], accounts: ['Agency'], promos: ['None', 'Promo'], dtypes: ['None', 'Other'], markets: ['Home'] },
    voyages: [
      // T1 sails 27 March for 10 days: five days in March, five in April. Capacity 10 suites x 2 guests x 10 days = 200.
      { code: 'T1', ship: 0, sail: U.dn(2026, 3, 27), days: 10, region: 0, embark: '', debark: '', charter: false, nonRev: false, cap: [2, 4, 4],
        bud: target([20, 60, 60], [40000, 90000, 60000], 10000, 2000, 90000, 160, 200), fc: null },
      // T3 sailed without revenue guests: 10 x 2 x 5 = 100 of capacity that only counts when the adjustment is off.
      { code: 'T3', ship: 0, sail: U.dn(2026, 5, 1), days: 5, region: 0, embark: '', debark: '', charter: false, nonRev: true, cap: [2, 4, 4], bud: null, fc: null },
      // T2 sails 1 June for 7 days. Capacity 140. Final payment falls due 120 days earlier, on 1 February.
      { code: 'T2', ship: 0, sail: U.dn(2026, 6, 1), days: 7, region: 0, embark: '', debark: '', charter: false, nonRev: false, cap: [2, 4, 4],
        bud: target([14, 42, 42], [28000, 63000, 42000], 7000, 1000, 60000, 110, 140), fc: null },
    ],
    bookings: [
      { ...blank, v: 0, t: 0, bd: U.dn(2025, 10, 10), list: 20000, pAmt: 1000, promo: 1 },                                              // b1 direct, revenue 19,000
      { ...blank, v: 0, t: 1, bd: U.dn(2025, 11, 5), list: 15000, dAmt: 1500, dt: 1, ch: 1, acct: 0 },                                  // b2 trade, revenue 13,500
      { ...blank, v: 0, t: 2, bd: U.dn(2025, 12, 1), g: 1, list: 9000, ch: 1, acct: 0, cd: U.dn(2026, 1, 15), fee: 2250 },              // b3 cancelled, fee 2,250
      { ...blank, v: 0, t: 2, bd: U.dn(2026, 2, 10), list: 12000, barter: true },                                                       // b4 barter, revenue 12,000
      { ...blank, v: 0, t: 2, bd: U.dn(2026, 2, 20), nr: true },                                                                        // b5 hosted guests, no revenue
      { ...blank, v: 0, t: 1, bd: U.dn(2025, 12, 10), list: 14000, cd: U.dn(2026, 2, 1), c2c: 1, fee: 1400 },                           // b6 transferred away, penalty 1,400
      { ...blank, v: 2, t: 1, bd: U.dn(2026, 2, 1), list: 14000, c2c: 2, c2cDil: 1400, ch: 1, acct: 0 },                                // b7 its replacement, offset 1,400
      { ...blank, v: 2, t: 0, bd: U.dn(2026, 4, 15), g: 3, list: 30000, pAmt: 3000, promo: 1 },                                         // b8 direct, revenue 27,000
      { ...blank, v: 2, t: 2, bd: U.dn(2026, 5, 10), list: 10000 },                                                                     // b9 booked after the as-of date
    ],
    costs: null,
  };
}
const D = E.prepare(book());
const ctx = (over, flags) => { const c = { ...E.defaults(), asOf: AS_OF, year: 2026, ...over }; c.flags = { ...c.flags, ...(flags || {}) }; return c; };
const yr = c => E.total(D, c, E.position(D, c, c.asOf), E.yearRange(2026));

/* ---------- the booked position ---------- */
{
  const t = yr(ctx());
  // T1: b1 19,000 + b2 13,500 + b4 12,000 = 44,500 active, plus fees 2,250 + 1,400. T2: b7 12,600 + b8 27,000 = 39,600. b9 is not booked yet.
  eq(t.rev, 84100, 'active revenue');
  eq(t.fee, 3650, 'cancellation fees kept');
  eq(t.tix, 87750, 'booked ticket revenue');
  eq(t.dil, 6900, 'dilution (1,000 + 1,500 on T1; 1,400 offset + 3,000 on T2)');
  eq(t.canRev, 23000, 'cancelled revenue (9,000 + 14,000)');
  // Guest days: T1 20 + 20 + 20 (hosted guests left out); T2 2 x 7 + 3 x 7 = 35.
  eq(t.pcd, 95, 'passenger cruise days');
  eq(t.apcd, 340, 'capacity, non-revenue voyage excluded (200 + 140)');
  eq(t.pcd / t.apcd, 95 / 340, 'load factor', 1e-12);
  eq(t.tix / t.pcd, 87750 / 95, 'gross price per day', 1e-9);
  eq(t.tgt, 309000, 'target (182,000 + 127,000)');
  eq(t.suites, 5, 'suites booked');
}

/* ---------- each adjustment does what it says ---------- */
eq(yr(ctx({}, { barter: false })).tix, 75750, 'barter excluded: 12,000 comes out');
eq(yr(ctx({}, { barter: false })).pcd, 75, 'barter excluded: 20 guest days come out');
eq(yr(ctx({}, { revOnly: false })).pcd, 115, 'all guests: 20 hosted guest days go in');
eq(yr(ctx({}, { apcdNet: false })).apcd, 440, 'capacity including the non-revenue voyage (+100)');
{
  const n = yr(ctx({}, { c2cNorm: true }));
  // The penalty leaves the fees and the offset leaves dilution: the two cancel, so the total does not move.
  eq(n.fee, 2250, 'transfers normalised: the 1,400 penalty is removed');
  eq(n.dil, 5500, 'transfers normalised: the 1,400 offset is removed');
  eq(n.tix, 87750, 'transfers normalised: ticket revenue is unchanged');
}
{
  const P = E.position(D, ctx(), AS_OF), mar = U.miOf(2026, 3);
  eq(E.total(D, ctx(), P, { from: mar, to: mar }).tix, 24075, 'prorated: half of T1 lands in March (5 of 10 days)');
  const c = ctx({}, { prorate: false });
  eq(E.total(D, c, E.position(D, c, AS_OF), { from: mar, to: mar }).tix, 48150, 'not prorated: all of T1 lands in March');
}
eq(yr(ctx({ asOf: U.dn(2026, 1, 31) })).tix, 48750, 'as of 31 January: 19,000 + 13,500 + 14,000 still active, plus the 2,250 fee');

/* ---------- monthly production ---------- */
{
  const p = E.production(D, ctx(), AS_OF), row = (y, m) => p.rows[U.miOf(y, m) - p.lo];
  eq(row(2025, 12).book, 23000, 'December bookings (9,000 + 14,000)');
  eq(row(2025, 12).count, 2, 'December booking count');
  eq(row(2026, 1).can, 9000, 'January cancellations');
  eq(row(2026, 1).fee, 2250, 'January cancellation fees');
  eq(row(2026, 2).book, 24600, 'February bookings (12,000 + 12,600; hosted guests carry none)');
  eq(row(2026, 2).can, 14000, 'February cancellations');
  eq(row(2026, 2).canX, 0, 'February cancellations excluding transfers');
  eq(row(2026, 4).book, 27000, 'April bookings');
  eq(p.rows.reduce((s, r) => s + r.book - r.can, 0), 84100, 'bookings less cancellations equal the active book');
}

/* ---------- cash, on a 25% deposit and a balance 120 days before sailing ---------- */
{
  const C = E.cash(D, ctx()), at = (arr, y, m) => arr[U.miOf(y, m) - C.lo];
  eq(at(C.rec[0], 2025, 10), 4750, 'October receipts: b1 deposit');
  // T1's balance falls due 27 November. b1 pays 14,250; b2 pays its 3,375 deposit and 10,125 balance the same month.
  eq(at(C.rec[0], 2025, 11), 27750, 'November receipts');
  eq(at(C.rec[0], 2025, 12), 23000, 'December receipts: b3 and b6 book inside the final-payment window and pay in full');
  eq(at(C.refunds, 2026, 1), 6750, 'January refund: 9,000 paid less the 2,250 penalty');
  eq(at(C.refunds, 2026, 2), 12600, 'February refund: 14,000 paid less the 1,400 penalty');
  eq(at(C.rec[0], 2026, 2), 12600, 'February receipts: b7 books on the due date and pays in full');
  eq(at(C.comm, 2026, 3), 1755, 'March commission: 13% of 13,500, paid when T1 sails');
  eq(C.held, 39600, 'guest deposits held on the unsailed voyage');
  eq(C.tie, 0, 'receipts less refunds equal what each booking has paid in');
  const rv = E.river(D, ctx({ window: 'ytd' }));
  eq(rv.cashIn, 39600, 'river, January to April: cash in');
  eq(rv.cashOut, 21105, 'river: refunds 19,350 plus commission 1,755');
  eq(rv.net, 18495, 'river: to reserves');
}

/* ---------- the profit bridge, January to April against budget ----------
   Only T1 sails in the window. Budget: 140 guest days, list 190,000, dilution 10,000, fees 2,000, trade revenue 90,000.
   Actual: 60 guest days, list 47,000, dilution 2,500, fees 3,650, trade revenue 13,500. */
{
  const br = E.bridge(D, ctx({ window: 'ytd' }), 'bud'), c = br.comps;
  eq(br.base.profit, 170300, 'budget profit: 182,000 revenue less 11,700 commission');
  eq(br.act.profit, 46395, 'actual profit: 48,150 revenue less 1,755 commission');
  eq(br.gap, -123905, 'profit gap');
  eq(c.volume, -80 * (9500 / 7) * (18 / 19), 'volume: 80 fewer guest days at the budget fare, mix and discount', 0.01);
  eq(c.mix, 60 * (1000 / 7) * (18 / 19), 'suite mix: more premium than budget, at budget fares', 0.01);
  eq(c.price, 60 * (-2150 / 3) * (18 / 19), 'price: fares below budget in every tier', 0.01);
  eq(c.dil, -47000 * (2500 / 47000 - 10000 / 190000), 'dilution: 5.32% of list against 5.26%', 0.01);
  eq(c.fees, 1650, 'cancellation fees: 3,650 against 2,000');
  eq(c.comm, 9945, 'commissions: 1,755 against 11,700');
  eq(br.residual, 0, 'the bridge leaves no residual', 1e-6);
}

/* ---------- the outlook and the scenario cockpit ---------- */
{
  const base = E.outlook(D, ctx()), up = E.outlook(D, ctx({ scen: { vol: 0.3, price: 0, cancel: 0, dil: 0, fuel: 0 } }));
  eq(base.tix[0], 48150, 'a sailed voyage is final in the outlook');
  eq(up.tix[0], 48150, 'the cockpit does not move a sailed voyage');
  if (!(up.tix[2] > base.tix[2])) problems.push('raising volume should raise the outlook for the unsailed voyage');
  if (!(base.pcd[2] <= 140 * 0.985 + 1e-9)) problems.push('the outlook must not project past capacity');
}

for (const c of E.checks(D, ctx())) if (!c.ok) problems.push('integrity check failed: ' + c.name + ' — ' + c.detail);

console.log('known-answer checks: ' + problems.length + ' problems');
for (const p of problems) console.log('  ' + p);
process.exit(problems.length ? 1 : 0);
