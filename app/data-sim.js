/* =====================================================================
   SIMULATED DATA. Generates the same two tables the Sigma connector
   delivers — a booking fact table at voyage x suite x booking-date grain
   and a voyage table carrying capacity, budget and forecast — for a
   fictional three-ship yacht line. Deterministic: the same seed always
   produces the same book.

   Actuals are the plan run through deliberate deviations (a soft booking
   patch, regional demand shifts, a drydock overrun, a fuel spike), so
   every dollar of variance traces back to something that moved.
   ===================================================================== */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util;

const PULL = U.dn(2026, 10, 6);            // the extract only knows bookings up to here
const AS_OF = U.dn(2026, 9, 30);           // the close the extract was pulled for
const C2C_POLICY = U.dn(2026, 1, 1);       // penalties on cruise-to-cruise transfers recognised from here
const SOFT = [U.dn(2026, 3, 15), U.dn(2026, 5, 31)];   // soft booking patch
const END = U.dn(2028, 12, 31);

const TIERS = ['Premium', 'Upper', 'Lower'];
const PPD = [2700, 1600, 1100];            // list fare per guest per day, 2026 base
const TIER_LF = [0.93, 1.0, 1.02];
const TIER_LEAD = [1.18, 1.03, 0.94];      // premium inventory books earliest

const SHIPS = [
  { code: 'AU', name: 'Aurora',   suites: [16, 49, 84],  fare: 1.04, lf: 1.00, start: U.dn(2024, 1, 4),
    cats: ["Owner's Residence, Penthouse", 'Grand Veranda', 'Veranda'] },
  { code: 'HA', name: 'Halcyon',  suites: [26, 76, 124], fare: 1.00, lf: 1.00, start: U.dn(2024, 1, 6),
    cats: ["Owner's Residence, Penthouse, Loft", 'Grand Veranda, Horizon', 'Veranda, Classic'] },
  { code: 'ME', name: 'Meridian', suites: [28, 76, 122], fare: 1.03, lf: 0.99, start: U.dn(2025, 7, 12),
    cats: ["Owner's Residence, Penthouse, Loft", 'Grand Veranda, Horizon', 'Veranda, Classic'] },
];

const REGIONS = ['Caribbean', 'Mediterranean', 'Northern Europe', 'Alaska', 'Asia', 'Pacific', 'Crossing', 'Tahiti'];
const RP = {
  'Caribbean':       { fare: 0.93, lf: 0.86, lead: 185, can: 0.105, dur: [7, 7, 7, 10], ports: ['San Juan', 'Bridgetown', 'Fort Lauderdale', 'Philipsburg'],
                       mkt: [24, 26, 12, 14, 7, 5, 4, 5, 1, 2] },
  'Mediterranean':   { fare: 1.12, lf: 0.91, lead: 245, can: 0.110, dur: [7, 7, 10, 10, 7], ports: ['Barcelona', 'Civitavecchia', 'Piraeus', 'Lisbon', 'Monte Carlo', 'Valletta'],
                       mkt: [22, 14, 16, 11, 6, 12, 12, 3, 2, 2] },
  'Northern Europe': { fare: 1.16, lf: 0.89, lead: 265, can: 0.115, dur: [10, 12, 14], ports: ['Copenhagen', 'Reykjavik', 'Stockholm', 'Southampton'],
                       mkt: [20, 11, 14, 10, 6, 18, 15, 2, 2, 2] },
  'Alaska':          { fare: 1.04, lf: 0.87, lead: 235, can: 0.110, dur: [7, 7, 10], ports: ['Vancouver', 'Seward', 'Juneau'],
                       mkt: [17, 12, 30, 15, 10, 5, 4, 2, 3, 2] },
  'Asia':            { fare: 1.06, lf: 0.76, lead: 225, can: 0.125, dur: [10, 12, 14], ports: ['Tokyo', 'Singapore', 'Hong Kong', 'Osaka'],
                       mkt: [14, 9, 22, 8, 6, 9, 8, 2, 20, 2] },
  'Pacific':         { fare: 0.88, lf: 0.66, lead: 195, can: 0.120, dur: [14, 16], ports: ['Honolulu', 'Papeete', 'Vancouver', 'Tokyo'],
                       mkt: [14, 9, 28, 9, 7, 7, 6, 2, 16, 2] },
  'Crossing':        { fare: 0.68, lf: 0.60, lead: 150, can: 0.100, dur: [12, 14], ports: ['Lisbon', 'Fort Lauderdale', 'Bridgetown', 'Barcelona'],
                       mkt: [22, 20, 12, 10, 6, 14, 11, 2, 1, 2] },
  'Tahiti':          { fare: 1.10, lf: 0.82, lead: 215, can: 0.110, dur: [7, 10], ports: ['Papeete', 'Bora Bora'],
                       mkt: [16, 10, 32, 10, 7, 7, 7, 2, 7, 2] },
};
// Seasonal deployment by ship and calendar month.
const DEPLOY = [
  m => (m <= 3 || m === 12) ? 'Caribbean' : (m === 4 || m === 11) ? 'Crossing' : 'Mediterranean',
  m => m <= 3 ? 'Caribbean' : m === 4 ? 'Crossing' : (m === 7 || m === 8) ? 'Northern Europe' : m <= 10 ? 'Mediterranean' : m === 11 ? 'Crossing' : 'Caribbean',
  m => m <= 3 ? 'Asia' : m === 4 ? 'Pacific' : m <= 9 ? 'Alaska' : m === 10 ? 'Pacific' : 'Tahiti',
];
const SEAS = [0.96, 0.95, 0.97, 0.98, 1.02, 1.06, 1.10, 1.09, 1.03, 0.99, 0.95, 1.02];      // fare by sailing month
const WAVE = [1.35, 1.30, 1.20, 1.00, 0.95, 0.90, 0.85, 0.85, 1.00, 1.05, 1.00, 0.80];      // booking intake by calendar month
const YEAR_PLAN = { 2024: 0.97, 2025: 0.985, 2026: 1.0, 2027: 1.01, 2028: 1.015 };
const esc = y => Math.pow(1.04, y - 2026);

const CHANNELS = ['Direct', 'Trade', 'MICE/Charter', 'Incentive/Group'];
const ACCOUNTS = ['Halden & Wythe', 'Corsair Luxury Network', 'Bellweather Travel Group', 'Marlowe Voyages',
  'Sable & Stone', 'Northlight Consortium', 'Fenwick Privé', 'Calloway Collective', 'Orchard Lane Travel',
  'Pemberton Reserve', 'Kestrel Luxe', 'Thornbury & Vale', 'All other trade'];
const ACCT_W = [9.5, 8.1, 6.9, 5.8, 5.0, 4.4, 3.9, 3.4, 3.0, 2.7, 2.4, 2.1, 42.8];
const PROMOS = [
  { name: 'None', pct: 0 }, { name: '3% ACH', pct: 0.03 }, { name: '5% Non-Refundable', pct: 0.05 },
  { name: 'Early Booking Savings', pct: 0.10 }, { name: 'Back-to-Back', pct: 0.05 }, { name: 'Limited-Time Savings', pct: 0.12 },
];
const DTYPES = ['None', 'FAM', 'Single', 'Family & Friends', 'FVC', 'Future Cruise Credit', 'Other'];
const MARKETS = ['US Northeast', 'US Southeast', 'US West', 'US Central', 'Canada', 'United Kingdom', 'Europe', 'Latin America', 'Asia Pacific', 'Other'];
const REPEAT = { 2024: 0.10, 2025: 0.17, 2026: 0.24, 2027: 0.29, 2028: 0.33 };

const C_PLAN = 0.093, D_PLAN = 0.048, FEE_PLAN = 0.018, TRADE_PLAN = 0.56, BUD_COMM = 0.13;
const OCC = 0.985;                         // guests per suite against the two-berth capacity basis
const LIST_ADJ = 1.015;                    // single supplements and third guests against the two-guest fare

const DRYDOCK = [
  { ship: 0, at: U.dn(2025, 10, 6), days: 14, capex: 9.0e6 },
  { ship: 1, at: U.dn(2026, 4, 8),  days: 16, capex: 12.0e6, overrun: true },
  { ship: 2, at: U.dn(2027, 10, 4), days: 12, capex: 11.0e6 },
  { ship: 0, at: U.dn(2027, 11, 8), days: 14, capex: 9.5e6 },
];

// Where actual demand, price, lead time, discounting and cancellations departed from plan.
function deviation(y, region, shipIdx, sail) {
  const d = { lf: 1, fare: 1, lead: 1, dil: 1, can: 1 };
  if (y === 2025) {
    if (region === 'Caribbean') d.lf = 0.97;
    if (shipIdx === 2) d.lf = 0.90;                           // launch-year ramp
  } else if (y === 2026) {
    if (region === 'Caribbean') { d.lf = 0.975; d.fare = 0.98; d.dil = 1.12; }
    if (region === 'Mediterranean') { d.lf = 1.02; d.fare = 1.04; }
    if (region === 'Northern Europe') { d.lf = 1.03; d.fare = 1.02; }
    if (region === 'Alaska') { d.lf = 0.955; d.fare = 0.97; d.dil = 1.18; d.can = 1.15; }
    if (region === 'Asia') { d.lf = 0.93; d.can = 1.2; }
    if (region === 'Crossing') d.lf = 0.95;
  } else if (y === 2027) {
    if (region === 'Mediterranean') { d.lf = 1.03; d.lead = 1.10; d.fare = 1.04; }
    if (region === 'Alaska') { d.lf = 0.93; d.lead = 0.90; }
    if (region === 'Caribbean') { d.lf = 1.01; d.lead = 1.04; }
    if (region === 'Asia') { d.lf = 0.95; d.lead = 0.90; }
    if (region === 'Tahiti') d.lf = 0.97;
  }
  return d;
}

function pickW(weights, total, r) {
  let x = r * total;
  for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
  return weights.length - 1;
}

function buildVoyages(rnd) {
  const voyages = [];
  SHIPS.forEach((sh, si) => {
    const docks = DRYDOCK.filter(x => x.ship === si).map(x => ({ ...x }));
    let d = sh.start, first = true, forceNonRev = false;
    while (d <= END) {
      const dock = docks.find(x => !x.done && d >= x.at);
      if (dock) {
        dock.done = true;
        d += dock.days;
        voyages.push(makeVoyage(si, d, 3, { nonRev: true, planned: true }));     // planned shakedown
        d += 3;
        forceNonRev = !!dock.overrun;       // the overrun costs the first revenue voyage after it
        continue;
      }
      const m = U.ymd(d)[1];
      const region = DEPLOY[si](m);
      const durs = RP[region].dur;
      const days = durs[Math.floor(rnd() * durs.length)];
      const lateDelivery = si === 2 && first;                 // budgeted to earn, sailed without guests
      const nonRev = lateDelivery || forceNonRev;
      voyages.push(makeVoyage(si, d, days, { nonRev, planned: false, region }));
      first = false; forceNonRev = false;
      d += days;
    }
  });

  function makeVoyage(si, sail, days, o) {
    const [y, m, dd] = U.ymd(sail);
    const region = o.region || DEPLOY[si](m);
    const R = RP[region];
    const ports = R.ports;
    const embark = ports[Math.floor(rnd() * ports.length)];
    let debark = ports[Math.floor(rnd() * ports.length)];
    if (region === 'Crossing' && debark === embark) debark = ports[(ports.indexOf(embark) + 1) % ports.length];
    const charterDate = sail - (240 + Math.floor(rnd() * 180));
    const charter = !o.nonRev && days <= 10 && rnd() < 0.035 && charterDate <= PULL;
    const code = SHIPS[si].code + String(y).slice(2) + String(m).padStart(2, '0') + String(dd).padStart(2, '0');
    return { code, ship: si, sail, days, region: REGIONS.indexOf(region), embark, debark,
             charter, nonRev: !!o.nonRev, cap: SHIPS[si].suites.slice(),
             _planned: !!o.planned, _charterDate: charterDate, _y: y, _m: m, _region: region };
  }
  voyages.sort((a, b) => a.sail - b.sail || a.ship - b.ship);
  return voyages;
}

function addTargets(v) {
  const sh = SHIPS[v.ship], R = RP[v._region], y = v._y;
  const dev = v._dev = deviation(y, v._region, v.ship, v.sail);
  if (v._planned) { v.bud = null; v.fc = null; return; }      // planned non-revenue days carry no budget
  const planLF = Math.min(0.97, R.lf * YEAR_PLAN[y] * sh.lf);
  const fareBase = sh.fare * R.fare * SEAS[v._m - 1] * esc(y);
  const mk = (lfF, fareF, dilF, canF, zero) => {
    const pcd = [0, 0, 0], list = [0, 0, 0];
    for (let t = 0; t < 3; t++) {
      pcd[t] = zero ? 0 : 2 * OCC * v.cap[t] * v.days * Math.min(0.99, planLF * TIER_LF[t] * lfF);
      list[t] = pcd[t] * PPD[t] * fareBase * fareF * LIST_ADJ;
    }
    const L = list[0] + list[1] + list[2], P = pcd[0] + pcd[1] + pcd[2];
    const dil = L * D_PLAN * dilF;
    return { apcd: zero ? 0 : 2 * (v.cap[0] + v.cap[1] + v.cap[2]) * v.days, pcd, list,
             pcdGross: P / (1 - C_PLAN * canF), dil, fee: (L - dil) * FEE_PLAN * canF, tradeRev: (L - dil) * TRADE_PLAN };
  };
  v.bud = mk(1, 1, 1, 1, false);
  const f = 0.6;                                              // the reforecast caught 60% of each deviation
  v.fc = y <= 2026 ? mk(1 + f * (dev.lf - 1), 1 + f * (dev.fare - 1), 1 + f * (dev.dil - 1), 1 + f * (dev.can - 1), v.nonRev) : null;
}

function feePct(daysOut, nonRefundable) {
  if (daysOut >= 121) return nonRefundable ? 0.25 : 0;
  if (daysOut >= 91) return 0.25;
  if (daysOut >= 61) return 0.50;
  if (daysOut >= 31) return 0.75;
  return 1.0;
}

function buildSimulated(seed) {
  const rnd = U.rng(seed == null ? 20260930 : seed);
  const voyages = buildVoyages(rnd);
  voyages.forEach(addTargets);

  const byShip = SHIPS.map((_, si) => voyages.map((v, i) => i).filter(i => voyages[i].ship === si));
  // The voyage a guest was on, or had just left, when they booked — the test for a future-voyage booking.
  // One ship is tried, so fewer ships at sea means fewer of these bookings.
  function sailingAround(day) {
    const list = byShip[Math.floor(rnd() * SHIPS.length)];
    let lo = 0, hi = list.length - 1, hit = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (voyages[list[mid]].sail <= day) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
    if (hit < 0) return -1;
    const v = voyages[list[hit]];
    return (!v.nonRev && day <= v.sail + v.days + 14) ? list[hit] : -1;
  }

  const bookings = [];
  const sold = voyages.map(() => [0, 0, 0]);
  const transfers = [];
  let nextGuest = 1;
  const mktTotal = 100, acctTotal = U.sum(ACCT_W);

  voyages.forEach((v, vi) => {
    if (v.nonRev) {
      if (!v._planned) {                                       // a handful of hosted guests on the non-revenue sailing
        for (let i = 0; i < 6; i++) bookings.push(blank(vi, 2, v.sail - 30, { nr: true }));
      }
      return;
    }
    const sh = SHIPS[v.ship], R = RP[v._region], y = v._y, dev = v._dev;
    const fareBase = sh.fare * R.fare * SEAS[v._m - 1] * esc(y) * dev.fare;

    if (v.charter) {
      for (let t = 0; t < 3; t++) for (let i = 0; i < v.cap[t]; i++) {
        const b = blank(vi, t, v._charterDate, {});
        b.ch = 2; b.list = PPD[t] * fareBase * v.days * 2; b.dt = 6; b.dAmt = b.list * 0.14;
        b.mkt = pickW(R.mkt, mktTotal, rnd());
        bookings.push(b); sold[vi][t]++;
      }
      return;
    }

    const planLF = Math.min(0.97, R.lf * YEAR_PLAN[y] * sh.lf);
    const noise = 1 + (rnd() + rnd() + rnd() - 1.5) * 0.045;
    const actLF = U.clamp(planLF * dev.lf * noise, 0.3, 0.985);
    const cBase = R.can * dev.can;
    const barterVoyage = y === 2026 && v.ship > 0 && (vi % 4 === 0);

    for (let t = 0; t < 3; t++) {
      if (barterVoyage && t === 1) {                           // suites exchanged for media, no cash changes hands
        for (let i = 0; i < 6; i++) {
          const b = blank(vi, 1, U.dn(2025, 11, 17), { barter: true });
          b.ch = 3; b.list = PPD[1] * fareBase * v.days * 2; b.mkt = pickW(R.mkt, mktTotal, rnd());
          bookings.push(b); sold[vi][1]++;
        }
      }
      const nNet = Math.min(v.cap[t] - sold[vi][t], Math.round(v.cap[t] * Math.min(0.99, actLF * TIER_LF[t])));
      const nGross = Math.round(nNet / (1 - cBase));
      const scale = R.lead * dev.lead * TIER_LEAD[t] / 0.9314;
      for (let i = 0; i < nGross; i++) {
        // Weibull lead time, reshaped by the calendar: wave season pulls bookings into Q1.
        let lead = 1, bd = 0;
        for (let k = 0; k < 6; k++) {
          lead = U.clamp(Math.round(scale * Math.pow(-Math.log(1 - rnd()), 0.8)), 1, 780);
          bd = v.sail - lead;
          if (rnd() < WAVE[U.ymd(bd)[1] - 1] / 1.35) break;
        }
        const inSoft = bd >= SOFT[0] && bd <= SOFT[1];
        if (inSoft && rnd() < 0.15) continue;                  // demand that never arrived
        if (bd > PULL) continue;                               // not booked yet as of the extract

        const b = blank(vi, t, bd, {});
        const u = rnd();
        b.g = u < 0.09 ? 1 : (u < 0.95 || t === 2) ? 2 : 3;
        if (rnd() < 0.012) {                                   // hosted, non-revenue guests
          b.nr = true; b.mkt = pickW(R.mkt, mktTotal, rnd());
          bookings.push(b); sold[vi][t]++; continue;
        }
        const direct = 0.34 + 0.015 * (y - 2024) + (v._region === 'Caribbean' ? 0.03 : 0);
        const c = rnd();
        b.ch = c < direct ? 0 : c < direct + 0.02 ? 2 : c < direct + 0.08 ? 3 : 1;
        if (b.ch === 1) b.acct = pickW(ACCT_W, acctTotal, rnd());
        b.mkt = pickW(R.mkt, mktTotal, rnd());
        b.list = PPD[t] * fareBase * v.days * (b.g === 1 ? 1.5 : b.g === 2 ? 2 : 2.5) * (1 + (rnd() - 0.5) * 0.08);

        // promotion
        const p = rnd(), promoPush = dev.dil;
        if (inSoft && rnd() < 0.28) b.promo = 5;
        else if (lead > 300 && p < 0.40 * promoPush) b.promo = 3;
        else if (p < (b.ch === 0 ? 0.30 : 0.14)) b.promo = 1;
        else if (p < (b.ch === 0 ? 0.30 : 0.14) + 0.14 * promoPush) b.promo = 2;
        else if (p > 0.97) b.promo = 4;
        b.pAmt = b.list * PROMOS[b.promo].pct;

        // repeat guests and future-voyage bookings made on board
        b.rep = rnd() < REPEAT[y] + (b.ch === 0 ? 0.06 : 0);
        if (b.rep && rnd() < 0.42) { b.src = sailingAround(bd); b.fvc = b.src >= 0; }
        b.gid = b.rep ? 1 + Math.floor(rnd() * Math.max(50, nextGuest * 0.5)) : nextGuest++;

        // dilution, one type per booking
        const q = rnd();
        if (b.ch === 1 && q < 0.015) { b.dt = 1; b.dAmt = b.list * 0.50; }
        else if (q > 0.985) { b.dt = 3; b.dAmt = b.list * 0.35; }
        else if (b.fvc) { b.dt = 4; b.dAmt = b.list * 0.05; }
        else if (b.g === 1 && q < 0.40) { b.dt = 2; b.dAmt = b.list * (0.25 / 1.5); }
        else if (q > 0.5 && q < 0.5 + (y <= 2025 ? 0.08 : 0.04)) { b.dt = 5; b.dAmt = b.list * 0.10; }
        else if (q > 0.6 && q < 0.6 + 0.05 * promoPush) { b.dt = 6; b.dAmt = b.list * 0.08; }

        // cancellation
        const rev = b.list - b.pAmt - b.dAmt;
        const nrf = b.promo === 2;
        let cd = 0;
        if (bd < U.dn(2026, 4, 1) && v.sail > U.dn(2026, 5, 20) && rnd() < 0.03) {
          cd = U.dn(2026, 4, 1) + Math.floor(rnd() * 50);      // the cancellation spike inside the soft patch
        } else if (rnd() < cBase * U.clamp(lead / 190, 0.25, 1.5) * (nrf ? 0.25 : 1)) {
          // The longer a booking is held the likelier it cancels, and most do so before the penalty window opens.
          if (lead > 125 && rnd() < 0.88) cd = bd + 1 + Math.floor(rnd() * (lead - 122));
          else cd = v.sail - 1 - Math.floor(rnd() * Math.min(lead - 1, 119));
        }
        if (cd && cd <= PULL && cd < v.sail) {
          b.cd = cd;
          const out = v.sail - cd;
          const transfer = out >= 45 && rnd() < 0.20;
          if (transfer) {
            b.c2c = 1;
            b.fee = cd >= C2C_POLICY ? rev * Math.max(0.10, feePct(out, nrf)) : 0;   // waived before the policy change
            transfers.push({ ship: v.ship, day: cd, t, g: b.g, fee: b.fee, from: b });
          } else {
            b.fee = rev * feePct(out, nrf);
          }
        } else {
          sold[vi][t]++;
        }
        bookings.push(b);
      }
    }
  });

  // Cruise-to-cruise transfers land on a later voyage of the same ship. Since the
  // policy change the penalty is offset by dilution on the new booking.
  for (const tr of transfers) {
    const cands = byShip[tr.ship].filter(i => {
      const v = voyages[i];
      return !v.nonRev && !v.charter && v.sail >= tr.day + 40 && v.sail <= tr.day + 420 && sold[i][tr.t] < v.cap[tr.t];
    });
    if (!cands.length) { tr.from.c2c = 0; continue; }
    const vi = cands[Math.floor(rnd() * cands.length)], v = voyages[vi];
    const sh = SHIPS[v.ship], R = RP[v._region];
    const b = blank(vi, tr.t, tr.day, {});
    b.g = tr.g; b.ch = tr.from.ch; b.acct = tr.from.acct; b.mkt = tr.from.mkt; b.rep = tr.from.rep; b.gid = tr.from.gid;
    b.list = PPD[tr.t] * sh.fare * R.fare * SEAS[v._m - 1] * esc(v._y) * v._dev.fare * v.days * (b.g === 1 ? 1.5 : b.g === 2 ? 2 : 2.5);
    b.c2c = 2; b.c2cDil = Math.min(tr.fee, b.list * 0.6);
    bookings.push(b); sold[vi][tr.t]++;
  }

  function blank(v, t, bd, o) {
    return { v, t, bd, cd: 0, ch: 0, acct: -1, promo: 0, dt: 0, g: 2, list: 0, pAmt: 0, dAmt: 0,
             c2c: 0, c2cDil: 0, fee: 0, mkt: 9, rep: false, fvc: false, src: -1,
             barter: !!o.barter, nr: !!o.nr, gid: 0 };
  }

  for (const v of voyages) { delete v._planned; delete v._charterDate; delete v._y; delete v._m; delete v._region; delete v._dev; }

  const mi = U.miOf;
  const dev = { fuel: {}, prov: {}, marketing: {}, maint: {} };
  for (let m = mi(2025, 10); m <= mi(2025, 12); m++) dev.fuel[m] = 1.05;
  for (let m = mi(2026, 6); m <= mi(2026, 9); m++) dev.fuel[m] = 1.12;        // fuel spike
  for (let m = mi(2026, 1); m <= mi(2026, 9); m++) dev.prov[m] = 1.03;        // provisioning inflation
  for (let m = mi(2026, 4); m <= mi(2026, 6); m++) dev.marketing[m] = 1.09;   // spend into the soft patch
  dev.maint[mi(2026, 4)] = 1.6;                                               // drydock overrun

  return {
    source: 'simulated',
    meta: { company: 'Meridian Yacht Collection', pull: PULL, asOf: AS_OF, c2cPolicy: C2C_POLICY, budgetComm: BUD_COMM },
    dims: {
      ships: SHIPS.map(s => ({ code: s.code, name: s.name, suites: s.suites.slice(), cats: s.cats })),
      tiers: TIERS, regions: REGIONS, channels: CHANNELS, accounts: ACCOUNTS,
      promos: PROMOS.map(p => p.name), dtypes: DTYPES, markets: MARKETS,
    },
    voyages, bookings,
    costs: {
      ships: [{ fuelT: 30, port: 14000, crew: 2.6e6, maint: 450e3 },
              { fuelT: 42, port: 20000, crew: 3.6e6, maint: 650e3 },
              { fuelT: 42, port: 20000, crew: 3.6e6, maint: 650e3 }],
      fuelPrice: 700, provPCD: 185, otherPCD: 12,
      marketing: 1.15e6, shoreside: 1.5e6, ga: 0.85e6, fleetStep: 1.32,
      inflation: 0.025, baseYear: 2025,
      debt: [{ name: 'Fleet loan', principal: 220.5e6, rate: 0.062, termM: 252, startMi: mi(2024, 1) },
             { name: 'Meridian facility', principal: 208e6, rate: 0.065, termM: 180, startMi: mi(2025, 7) }],
      drydock: DRYDOCK.map(d => ({ ship: d.ship, mi: U.mi(d.at), amount: d.capex })),
      dev,
    },
  };
}

CBR.buildSimulated = buildSimulated;
})(typeof globalThis !== 'undefined' ? globalThis : this);
