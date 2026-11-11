/* =====================================================================
   METRICS ENGINE (pure — no DOM). Everything on the page is computed here
   from two tables: bookings (voyage x suite x booking date) and voyages
   (capacity, budget, forecast). The same functions run on simulated data
   and on data delivered by the Sigma connector.

   ctx = { asOf, year, ship, window, flags, terms, scen }
     asOf    day number; a booking exists if booked on or before it, and is
             active if not cancelled on or before it
     year    sailing year in focus
     ship    ship index, or -1 for consolidated
     window  'ytd' | 'fy' | 'r12' — the period the profit bridge and cash river cover
     flags   the adjustment toggles (see ADJUSTMENTS in views.js)
     terms   payment terms: deposit share, final-payment days, commission rate
     scen    scenario cockpit deltas, applied to the unsailed portion only
   ===================================================================== */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util;
const E = CBR.engine = {};
const f64 = n => new Float64Array(n);
const sum3 = a => a[0] + a[1] + a[2];
const revOf = x => sum3(x.list) - x.dil + x.fee;

E.defaults = () => ({
  flags: { barter: true, c2cNorm: false, revOnly: true, apcdNet: true, prorate: true, alignAsOf: true, charterEx: true },
  terms: { deposit: 0.25, finalDays: 120, comm: 0.13 },
  scen: { vol: 0, price: 0, cancel: 0, dil: 0, fuel: 0 },
  window: 'fy', ship: -1,
});

const pkey = ctx => { const f = ctx.flags; return [f.barter, f.c2cNorm, f.revOnly, f.apcdNet].map(x => x ? 1 : 0).join(''); };
const fkey = ctx => pkey(ctx) + '|' + ctx.ship;
const skey = ctx => { const s = ctx.scen, t = ctx.terms; return [s.vol, s.price, s.cancel, s.dil, s.fuel, t.deposit, t.finalDays, t.comm].join(','); };

function memo(D, key, fn) {
  const c = D._cache;
  if (c.has(key)) return c.get(key);
  while (c.size > 240) c.delete(c.keys().next().value);        // drop the oldest entry, keep the rest warm
  const v = fn();
  c.set(key, v);
  return v;
}

// How each booking is read under the current adjustment flags.
function reader(ctx) {
  const f = ctx.flags;
  return {
    rev: b => b.nr ? 0 : b.list - b.pAmt - b.dAmt - (f.c2cNorm ? 0 : b.c2cDil),
    dil: b => b.nr ? 0 : b.pAmt + b.dAmt + (f.c2cNorm ? 0 : b.c2cDil),
    fee: b => (f.c2cNorm && b.c2c === 1) ? 0 : b.fee,
    skip: b => b.barter && !f.barter,
    counts: b => !(b.nr && f.revOnly),
  };
}

/* ---------------------------------------------------------------------
   PREPARE. Derives the fields every pass needs, and the empirical booking
   and cancellation curves the outlook projects with.
   --------------------------------------------------------------------- */
E.prepare = function (D) {
  const V = D.voyages, B = D.bookings;
  let minMi = Infinity, maxMi = -Infinity;
  V.forEach((v, i) => {
    v.i = i;
    v.end = v.sail + v.days;
    v.smi = U.mi(v.sail);
    v.year = U.miYear(v.smi);
    v.capSuites = sum3(v.cap);
    v.apcdFull = 2 * v.capSuites * v.days;
    v.mdays = [];
    for (let d = v.sail; d < v.end;) {
      const m = U.mi(d), stop = Math.min(v.end, U.miStart(m + 1));
      v.mdays.push([m, stop - d]);
      d = stop;
    }
    v.mshare = v.mdays.map(([m, d]) => [m, d / v.days]);
    v.msingle = [[v.smi, 1]];
    v.budRev = v.bud ? revOf(v.bud) : 0;
    v.budPcd = v.bud ? sum3(v.bud.pcd) : 0;
    v.fcRev = v.fc ? revOf(v.fc) : null;
    v.fcPcd = v.fc ? sum3(v.fc.pcd) : null;
    v.tgt = v.fc || v.bud;
    v.tgtRev = v.fc ? v.fcRev : v.budRev;
    v.tgtPcd = v.fc ? v.fcPcd : v.budPcd;
    minMi = Math.min(minMi, v.smi);
    maxMi = Math.max(maxMi, U.mi(v.end - 1));
  });
  for (const b of B) {
    b.bmi = U.mi(b.bd);
    b.cmi = b.cd ? U.mi(b.cd) : -1;
    if (!b.n) b.n = 1;                       // a grouped row stands for n bookings; g and the amounts are already sums
    if (b.bmi < minMi) minMi = b.bmi;
  }
  D.range = { minMi, maxMi };
  const nS = D.dims.ships.length, nM = maxMi - minMi + 1;
  D.shipDays = Array.from({ length: nS }, () => f64(nM));
  D.shipStart = new Array(nS).fill(Infinity);
  for (const v of V) {
    D.shipStart[v.ship] = Math.min(D.shipStart[v.ship], v.smi);
    for (const [m, d] of v.mdays) D.shipDays[v.ship][m - minMi] += d;
  }
  D._cache = new Map();
  return D;
};

// From voyages that had sailed by `asOf`: how much of the final book is on the
// books N days out, and how much of the eventual cancellation is still to come.
// Regions book on very different lead times, so each gets its own curve once it
// has enough history; thin regions fall back to the fleet curve. Only history up
// to `asOf` is used, so replaying an earlier close never borrows from its future.
function buildCurves(D, asOf) {
  const K = 81, V = D.voyages, nR = D.dims.regions.length;
  const mk = () => ({ book: f64(K), can: f64(K), fee: f64(K), gross: 0 });
  const all = mk(), byR = Array.from({ length: nR }, mk);
  const lead = new Map(), finalPcd = f64(V.length);
  for (const b of D.bookings) {
    const v = V[b.v];
    if (v.sail > asOf || v.charter || v.nonRev || b.barter || b.nr) continue;
    const r = b.list - b.pAmt - b.dAmt, kb = Math.min(K - 1, Math.max(0, Math.floor((v.sail - b.bd) / 10)));
    const kc = b.cd ? Math.min(K - 1, Math.max(0, Math.floor((v.sail - b.cd) / 10))) : -1;
    for (const h of [all, byR[v.region]]) {
      h.book[kb] += r; h.gross += r;
      if (kc >= 0) { h.can[kc] += r; h.fee[kc] += b.fee; }
    }
    let L = lead.get(b.v);
    if (!L) lead.set(b.v, L = f64(K));
    L[kb] += b.g * v.days;
    if (!b.cd) finalPcd[b.v] += b.g * v.days;
  }
  const finish = h => {
    const cumBook = f64(K), canAfter = f64(K), feeAfter = f64(K), canTot = U.sum(h.can);
    let s = 0;
    for (let k = K - 1; k >= 0; k--) { s += h.book[k]; cumBook[k] = h.gross ? s / h.gross : 1; }
    let c = 0, fsum = 0;
    for (let k = 0; k < K; k++) {
      canAfter[k] = canTot ? c / canTot : 0;
      feeAfter[k] = c ? fsum / c : 0;
      c += h.can[k]; fsum += h.fee[k];
    }
    return { cumBook, canAfter, feeAfter, baseCancel: h.gross ? canTot / h.gross : 0.1, gross: h.gross };
  };
  const fleet = finish(all);
  fleet.byRegion = byR.map(h => h.gross > all.gross * 0.02 ? finish(h) : fleet);

  // How much a voyage's pace N days out has actually said about where it finished.
  // For each lead-time bucket: finish / target - 1 = alpha + beta * (pace - 1), fitted
  // on the voyages that have sailed. Pace that proved to be noise earns a small beta,
  // and the projection then stays close to target instead of chasing it.
  const sx = f64(K), sy = f64(K), sxx = f64(K), sxy = f64(K), cnt = f64(K);
  for (const [vi, L] of lead) {
    const v = V[vi], T = v.tgt;
    if (!T || !(T.pcdGross > 0)) continue;
    const tp = sum3(T.pcd);
    if (!tp) continue;
    const C = fleet.byRegion[v.region], y = finalPcd[vi] / tp - 1;
    let cum = 0;
    for (let k = K - 1; k >= 1; k--) {
      cum += L[k];
      const x = U.clamp(cum / (Math.max(0.02, C.cumBook[k]) * T.pcdGross), 0.4, 1.8) - 1;
      sx[k] += x; sy[k] += y; sxx[k] += x * x; sxy[k] += x * y; cnt[k]++;
    }
  }
  fleet.alpha = f64(K); fleet.beta = f64(K); fleet.fitted = 0;
  for (let k = 1; k < K; k++) {
    let n = 0, a = 0, b = 0, aa = 0, ab = 0;
    for (let j = Math.max(1, k - 2); j <= Math.min(K - 1, k + 2); j++) { n += cnt[j]; a += sx[j]; b += sy[j]; aa += sxx[j]; ab += sxy[j]; }
    if (n >= 60) {
      const vx = aa - a * a / n;
      fleet.beta[k] = vx > 1e-9 ? U.clamp((ab - a * b / n) / vx, 0, 1.2) : 0;
      fleet.alpha[k] = U.clamp(b / n - fleet.beta[k] * a / n, -0.2, 0.2);
      fleet.fitted = Math.max(fleet.fitted, n);
    } else {
      fleet.beta[k] = Math.min(1, 2 * fleet.cumBook[k]);      // too little history: trust pace only as the book fills
    }
  }
  return fleet;
}
E.curve = (D, asOf) => memo(D, 'crv|' + asOf, () => buildCurves(D, asOf));
E.curveOf = (D, v, asOf) => E.curve(D, asOf).byRegion[v.region];

/* ---------------------------------------------------------------------
   POSITION. The book as it stood at day t, by voyage.
   --------------------------------------------------------------------- */
E.position = function (D, ctx, t) {
  return memo(D, 'pos|' + t + '|' + pkey(ctx), () => {
    const V = D.voyages, n = V.length, R = reader(ctx);
    const tri = () => [f64(n), f64(n), f64(n)];
    const P = { rev: f64(n), list: f64(n), dil: f64(n), fee: f64(n), pcd: f64(n), pcdGross: f64(n), guests: f64(n),
                suites: f64(n), canRev: f64(n), tradeRev: f64(n), repGuests: f64(n),
                pcdT: tri(), listT: tri(), revT: tri(), suitesT: tri() };
    for (const b of D.bookings) {
      if (b.bd > t || R.skip(b)) continue;
      const v = b.v, r = R.rev(b), cnt = R.counts(b), pcd = cnt ? b.g * V[v].days : 0;
      P.pcdGross[v] += pcd;
      if (b.cd && b.cd <= t) { P.fee[v] += R.fee(b); P.canRev[v] += r; continue; }
      const list = b.nr ? 0 : b.list;
      P.rev[v] += r; P.list[v] += list; P.dil[v] += R.dil(b); P.pcd[v] += pcd;
      if (b.ch === 1) P.tradeRev[v] += r;
      if (cnt) { P.guests[v] += b.g; P.suites[v] += b.n; P.suitesT[b.t][v] += b.n; if (b.rep) P.repGuests[v] += b.g; }
      P.pcdT[b.t][v] += pcd; P.listT[b.t][v] += list; P.revT[b.t][v] += r;
    }
    return P;
  });
};

// Booked ticket revenue by voyage at day t. Not cached: continuous replay asks for a new
// day many times a second and never for the same one twice.
E.bookedAt = function (D, ctx, t) {
  const R = reader(ctx), out = f64(D.voyages.length);
  for (const b of D.bookings) {
    if (b.bd > t || R.skip(b)) continue;
    out[b.v] += (b.cd && b.cd <= t) ? R.fee(b) : R.rev(b);
  }
  return out;
};

E.apcd = (v, ctx) => (v.nonRev && ctx.flags.apcdNet) ? 0 : v.apcdFull;

/* ---------------------------------------------------------------------
   ROLLUP. Sums a position over voyages, optionally splitting each voyage
   across the months it sails in (proration).
   --------------------------------------------------------------------- */
const newAcc = () => ({ n: 0, rev: 0, fee: 0, tix: 0, list: 0, dil: 0, pcd: 0, pcdGross: 0, apcd: 0, guests: 0, suites: 0,
                        canRev: 0, tradeRev: 0, repGuests: 0, bud: 0, budPcd: 0, budApcd: 0, fc: 0, fcPcd: 0, fcApcd: 0,
                        tgt: 0, tgtPcd: 0, tgtApcd: 0 });

E.rollup = function (D, ctx, P, opt) {
  const out = new Map();
  const ship = opt.ship == null ? ctx.ship : opt.ship;
  const prorate = opt.prorate == null ? ctx.flags.prorate : opt.prorate;
  const from = opt.from == null ? -Infinity : opt.from, to = opt.to == null ? Infinity : opt.to;
  for (const v of D.voyages) {
    if (ship >= 0 && v.ship !== ship) continue;
    if (opt.filter && !opt.filter(v)) continue;
    const i = v.i, ap = E.apcd(v, ctx);
    for (const [m, s] of (prorate ? v.mshare : v.msingle)) {
      if (m < from || m > to) continue;
      const k = opt.key ? opt.key(v, m) : 'all';
      let a = out.get(k);
      if (!a) out.set(k, a = newAcc());
      a.n += s;
      a.rev += P.rev[i] * s; a.fee += P.fee[i] * s; a.tix += (P.rev[i] + P.fee[i]) * s;
      a.list += P.list[i] * s; a.dil += P.dil[i] * s; a.pcd += P.pcd[i] * s; a.pcdGross += P.pcdGross[i] * s;
      a.apcd += ap * s; a.guests += P.guests[i] * s; a.suites += P.suites[i] * s;
      a.canRev += P.canRev[i] * s; a.tradeRev += P.tradeRev[i] * s; a.repGuests += P.repGuests[i] * s;
      if (v.bud) { a.bud += v.budRev * s; a.budPcd += v.budPcd * s; a.budApcd += v.bud.apcd * s; }
      const f = v.fc || v.bud;
      if (f) { a.fc += revOf(f) * s; a.fcPcd += sum3(f.pcd) * s; a.fcApcd += f.apcd * s; }
      if (v.tgt) { a.tgt += v.tgtRev * s; a.tgtPcd += v.tgtPcd * s; a.tgtApcd += v.tgt.apcd * s; }
    }
  }
  return out;
};
E.total = (D, ctx, P, opt) => E.rollup(D, ctx, P, { ...opt, key: null }).get('all') || newAcc();
E.yearRange = y => ({ from: y * 12, to: y * 12 + 11 });
E.targetLabel = (D, y) => D.voyages.some(v => v.year === y && v.fc) ? 'FCST' : 'BDGT';

/* ---------------------------------------------------------------------
   PRODUCTION. What was booked and cancelled in each calendar month.
   --------------------------------------------------------------------- */
E.production = function (D, ctx, cutoff) {
  return memo(D, 'prod|' + cutoff + '|' + fkey(ctx), () => {
    const lo = D.range.minMi, n = U.mi(cutoff) - lo + 1, R = reader(ctx), V = D.voyages, dm = D.dims;
    const z = k => new Array(k).fill(0);
    const rows = Array.from({ length: n }, (_, i) => ({
      mi: lo + i, book: 0, count: 0, suites: 0, pcd: 0, guests: 0, list: 0, can: 0, canX: 0, fee: 0, canCount: 0,
      ch: z(dm.channels.length), dt: z(dm.dtypes.length), promoAmt: 0, c2cDil: 0, promoCnt: z(dm.promos.length),
      win: z(3), winX: z(3), ship: z(dm.ships.length), shipCan: z(dm.ships.length), rep: 0, fvc: 0, bookers: new Set(), bookerN: 0, nBookers: 0,
    }));
    for (const b of D.bookings) {
      if (b.bd > cutoff || R.skip(b)) continue;
      const v = V[b.v];
      if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
      const r = R.rev(b), row = rows[b.bmi - lo];
      if (!b.nr) {
        row.book += r; row.count += b.n; row.list += b.list; row.ch[b.ch] += r; row.ship[v.ship] += r;
        row.dt[b.dt] += b.dAmt; row.promoAmt += b.pAmt; row.promoCnt[b.promo] += b.n;
        if (!ctx.flags.c2cNorm) row.c2cDil += b.c2cDil;
        const w = Math.min(2, Math.max(0, v.year - U.miYear(b.bmi)));
        row.win[w] += r; if (!v.charter) row.winX[w] += r;
        if (b.gid) row.bookers.add(b.gid); else row.bookerN += b.bk || 0;    // grouped rows carry a pre-counted figure
        if (b.rep) row.rep += b.n;
        if (b.fvc) row.fvc += b.n;
      }
      if (R.counts(b)) { row.suites += b.n; row.pcd += b.g * v.days; row.guests += b.g; }
      if (b.cd && b.cd <= cutoff) {
        const c = rows[b.cmi - lo];
        c.can += r; c.fee += R.fee(b); c.canCount += b.n; c.shipCan[v.ship] += r;
        if (b.c2c !== 1) c.canX += r;
      }
    }
    for (const r of rows) r.nBookers = r.bookers.size + r.bookerN;
    return { lo, rows };
  });
};
// Dilution and promotion views can follow the extract date instead of the close.
E.cutoff = (D, ctx) => ctx.flags.alignAsOf ? ctx.asOf : Math.max(ctx.asOf, D.meta.pull);

/* ---------------------------------------------------------------------
   BOOKING CURVES. Cumulative booked revenue for one sailing year, month
   by month, against the same point for the two years before it.
   --------------------------------------------------------------------- */
// The share of a voyage that belongs to sailing year y: all or nothing by sail date, or by
// sailing days when voyages are prorated. The curves use the same split as every table, so
// a voyage that straddles New Year cannot make the chart and the table beside it disagree.
E.yearShare = function (v, y, prorate) {
  if (!prorate) return v.year === y ? 1 : 0;
  let s = 0;
  for (const [m, w] of v.mshare) if (U.miYear(m) === y) s += w;
  return s;
};

E.curves = function (D, ctx, year) {
  return memo(D, 'curve|' + year + '|' + ctx.asOf + '|' + fkey(ctx) + (ctx.flags.prorate ? 'p' : 's'), () => {
    const N = 36, R = reader(ctx), V = D.voyages, asOfYear = U.miYear(U.mi(ctx.asOf));
    const build = (y, t) => {
      const off = (y - 2) * 12, ev = f64(N);
      let pre = 0;
      const add = (idx, x) => { if (idx < 0) pre += x; else if (idx < N) ev[idx] += x; };
      const share = V.map(v => (ctx.ship >= 0 && v.ship !== ctx.ship) ? 0 : E.yearShare(v, y, ctx.flags.prorate));
      for (const b of D.bookings) {
        const k = share[b.v];
        if (!k || b.bd > t || R.skip(b)) continue;
        const r = R.rev(b) * k;
        add(b.bmi - off, r);
        if (b.cd && b.cd <= t) add(b.cmi - off, R.fee(b) * k - r);
      }
      // A completed year is measured against what it finally delivered; an open one against its target.
      let denom = 0;
      if (y < asOfYear) denom = pre + U.sum(ev);
      else for (const v of V) denom += v.tgtRev * share[v.i];
      const last = Math.min(N - 1, U.mi(t) - off), cum = new Array(N).fill(null), pct = new Array(N).fill(null);
      let run = pre;
      for (let i = 0; i <= last; i++) { run += ev[i]; cum[i] = run; pct[i] = denom ? run / denom : null; }
      return { year: y, cum, pct, denom, last };
    };
    const cy = build(year, ctx.asOf), stly = build(year - 1, D.meta.pull), y2 = build(year - 2, D.meta.pull);
    const at = cy.last;
    return { N, startMi: (year - 2) * 12, cy, stly, y2, at,
             gap: (cy.pct[at] != null && stly.pct[at] != null) ? cy.pct[at] - stly.pct[at] : null,
             gap2: (cy.pct[at] != null && y2.pct[at] != null) ? cy.pct[at] - y2.pct[at] : null };
  });
};

/* ---------------------------------------------------------------------
   OUTLOOK. Sailed voyages are final. For each unsailed voyage the book is
   projected to sailing: the existing book less the cancellations still to
   come, plus the pickup the booking curve says is still ahead. The
   scenario cockpit moves only this projected portion.
   --------------------------------------------------------------------- */
E.outlook = function (D, ctx) {
  return memo(D, 'out|' + ctx.asOf + '|' + fkey(ctx) + '|' + skey(ctx), () => {
    const P = E.position(D, ctx, ctx.asOf), S = ctx.scen, V = D.voyages, n = V.length, F = E.curve(D, ctx.asOf);
    const tri = () => [f64(n), f64(n), f64(n)];
    const O = { pcd: f64(n), list: f64(n), dil: f64(n), fee: f64(n), tradeRev: f64(n), rev: f64(n), tix: f64(n),
                pcdT: tri(), listT: tri(), pickRev: f64(n), cRem: f64(n), feeRate: f64(n) };
    for (const v of V) {
      const i = v.i;
      O.pcd[i] = P.pcd[i]; O.list[i] = P.list[i]; O.dil[i] = P.dil[i]; O.fee[i] = P.fee[i]; O.tradeRev[i] = P.tradeRev[i];
      for (let t = 0; t < 3; t++) { O.pcdT[t][i] = P.pcdT[t][i]; O.listT[t][i] = P.listT[t][i]; }
      if (v.sail > ctx.asOf && !v.nonRev) {
        const C = F.byRegion[v.region], k = Math.min(80, Math.floor((v.sail - ctx.asOf) / 10));
        const share = Math.max(0.02, C.cumBook[k]), T = v.tgt;
        const cancelAt = mult => {
          const cAll = U.clamp(C.baseCancel * mult, 0, 0.6);
          return { rem: cAll * C.canAfter[k] / Math.max(0.05, 1 - cAll * (1 - C.canAfter[k])), pick: cAll * C.canAfter[k >> 1] };
        };
        const c0 = cancelAt(1), cS = cancelAt(1 + S.cancel), cRem = cS.rem, cPick = cS.pick, keep = 1 - cRem;
        // Where the voyage finishes: its target, corrected by how voyages at this pace
        // and this distance from sailing have finished before.
        let finish;
        if (T && T.pcdGross > 0) {
          const pace = U.clamp(P.pcdGross[i] / (share * T.pcdGross), 0.4, 1.8);
          finish = sum3(T.pcd) * (1 + F.alpha[k] + F.beta[k] * (pace - 1));
        } else finish = P.pcd[i] * (1 - c0.rem) / Math.max(share, 0.05);
        // The scenario scales the pickup and re-rates cancellations; the base case is the fitted finish.
        let pick = v.charter ? 0 : Math.max(0, finish - P.pcd[i] * (1 - c0.rem)) * (1 + S.vol) * (1 - cPick) / (1 - c0.pick);
        pick = Math.max(0, Math.min(pick, v.apcdFull * 0.985 - P.pcd[i] * keep));

        // Pickup lands in the inventory that is still open, at that tier's fare.
        const w = [0, 0, 0], f = [0, 0, 0];
        let wSum = 0;
        for (let t = 0; t < 3; t++) {
          w[t] = Math.max(0, 2 * v.cap[t] * v.days * 0.985 - P.pcdT[t][i] * keep);
          wSum += w[t];
          f[t] = P.pcdT[t][i] > 0 ? P.listT[t][i] / P.pcdT[t][i] : (T && T.pcd[t] > 0 ? T.list[t] / T.pcd[t] : 0);
        }
        const TL = T ? sum3(T.list) : 0;
        const dilRate = U.clamp((P.list[i] > 0 ? P.dil[i] / P.list[i] : (TL ? T.dil / TL : 0.085)) + S.dil, 0, 0.6);
        const tradeShare = P.rev[i] > 0 ? P.tradeRev[i] / P.rev[i] : (TL ? T.tradeRev / (TL - T.dil) : 0.55);
        let pickList = 0;
        for (let t = 0; t < 3; t++) {
          const pt = wSum ? pick * w[t] / wSum : 0, lt = pt * f[t] * (1 + S.price);
          O.pcdT[t][i] = P.pcdT[t][i] * keep + pt;
          O.listT[t][i] = P.listT[t][i] * keep + lt;
          pickList += lt;
        }
        const pickRev = pickList * (1 - dilRate);
        O.pcd[i] = P.pcd[i] * keep + pick;
        O.list[i] = P.list[i] * keep + pickList;
        O.dil[i] = P.dil[i] * keep + pickList * dilRate;
        O.fee[i] = P.fee[i] + (P.rev[i] * cRem + (cPick < 1 ? pickRev * cPick / (1 - cPick) : 0)) * C.feeAfter[k];
        O.tradeRev[i] = P.tradeRev[i] * keep + pickRev * tradeShare;
        O.pickRev[i] = pickRev; O.cRem[i] = cRem; O.feeRate[i] = C.feeAfter[k];
      }
      O.rev[i] = O.list[i] - O.dil[i];
      O.tix[i] = O.rev[i] + O.fee[i];
    }
    return O;
  });
};

E.outlookTotal = function (D, ctx, year) {
  const O = E.outlook(D, ctx), R = E.yearRange(year);
  let tix = 0, pcd = 0;
  for (const v of D.voyages) {
    if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
    for (const [m, s] of (ctx.flags.prorate ? v.mshare : v.msingle)) {
      if (m < R.from || m > R.to) continue;
      tix += O.tix[v.i] * s; pcd += O.pcd[v.i] * s;
    }
  }
  return { tix, pcd };
};

/* ---------------------------------------------------------------------
   WINDOW. The months the profit bridge and cash river cover.
   --------------------------------------------------------------------- */
E.windowMonths = function (D, ctx) {
  const am = U.mi(ctx.asOf), y0 = U.miYear(am) * 12;
  if (ctx.window === 'ytd') return { from: y0, to: am, label: 'YTD ' + U.miLabel(y0) + ' – ' + U.miLabel(am), short: 'YTD', forecast: false };
  if (ctx.window === 'r12') return { from: am + 1, to: am + 12, label: 'Rolling 12 months to ' + U.miLabel(am + 12), short: 'Rolling 12', forecast: true };
  const from = ctx.year * 12;
  return { from, to: from + 11, label: 'FY' + ctx.year + (from + 11 > am ? (from > am ? ' forecast' : ' actual + forecast') : ' actual'),
           short: 'FY' + ctx.year, forecast: from + 11 > am };
};

/* ---------------------------------------------------------------------
   OPERATING COSTS. Budget basis runs the cost drivers clean; actual basis
   applies the recorded deviations to closed months and the scenario to
   open ones. Shoreside cost is not allocated to a single ship.
   --------------------------------------------------------------------- */
E.opCosts = function (D, ctx, from, to, basis, pcdSM) {
  const K = D.costs, am = U.mi(ctx.asOf);
  const tot = { fuel: 0, port: 0, crew: 0, maint: 0, prov: 0, shore: 0, byMonth: [] };
  if (!K) return tot;
  for (let m = from; m <= to; m++) {
    const infl = Math.pow(1 + K.inflation, U.miYear(m) - K.baseYear);
    const dv = cat => basis === 'bud' ? 1 : m <= am ? ((K.dev[cat] || {})[m] || 1) : (cat === 'fuel' ? 1 + ctx.scen.fuel : 1);
    const row = { mi: m, fuel: 0, port: 0, crew: 0, maint: 0, prov: 0, shore: 0 };
    let inService = 0;
    K.ships.forEach((s, si) => {
      if (D.shipStart[si] > m) return;
      inService++;
      if (ctx.ship >= 0 && ctx.ship !== si) return;
      const idx = m - D.range.minMi;
      const days = (idx >= 0 && idx < D.shipDays[si].length) ? D.shipDays[si][idx] : 0;
      row.fuel += s.fuelT * days * K.fuelPrice * dv('fuel');
      row.port += s.port * days * infl;
      row.crew += s.crew * infl;
      row.maint += s.maint * infl * dv('maint');
      row.prov += (pcdSM.get(si * 100000 + m) || 0) * (K.provPCD + K.otherPCD) * infl * dv('prov');
    });
    if (ctx.ship < 0) row.shore = (K.marketing * dv('marketing') + K.shoreside + K.ga) * infl * (inService >= 3 ? K.fleetStep : 1);
    for (const k of ['fuel', 'port', 'crew', 'maint', 'prov', 'shore']) tot[k] += row[k];
    tot.byMonth.push(row);
  }
  return tot;
};

/* ---------------------------------------------------------------------
   PROFIT BRIDGE. Voyage profit = ticket revenue − commissions − voyage
   costs − shoreside. Each bar swaps one variable from the baseline to the
   actual-plus-outlook and holds the rest, so the bars sum to the gap with
   no residual. Always prorated by sailing days: profit is a period measure.
   --------------------------------------------------------------------- */
E.BRIDGE = [
  { key: 'volume', label: 'Volume',      def: 'Guest days sold against the baseline — capacity and load factor together, valued at the baseline fare, mix and discount.' },
  { key: 'mix',    label: 'Suite mix',   def: 'The shift between suite tiers, valued at baseline fares for each tier.' },
  { key: 'price',  label: 'Price',       def: 'List fare per guest day within each suite tier, at the actual volume and mix.' },
  { key: 'dil',    label: 'Dilution',    def: 'Promotions and other discounts as a share of list fare.' },
  { key: 'fees',   label: 'Cancel fees', def: 'Cancellation penalties kept.' },
  { key: 'comm',   label: 'Commissions', def: 'Commission on trade revenue — moves with the trade share and the commission rate.' },
  { key: 'voy',    label: 'Voyage costs', def: 'Fuel, crew, provisioning, port and maintenance.' },
  { key: 'shore',  label: 'Shoreside',   def: 'Marketing, shoreside operations and G&A. Not allocated when a single ship is selected.' },
];

function windowSide(D, ctx, kind, from, to, O) {
  const S = { apcd: 0, pcdT: [0, 0, 0], listT: [0, 0, 0], dil: 0, fee: 0, tradeRev: 0, pcdSM: new Map() };
  for (const v of D.voyages) {
    if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
    const src = kind === 'act' ? null : kind === 'fc' ? (v.fc || v.bud) : v.bud;
    if (kind !== 'act' && !src) continue;
    const i = v.i;
    for (const [m, s] of v.mshare) {
      if (m < from || m > to) continue;
      let pcd = 0;
      if (src) {
        S.apcd += src.apcd * s; S.dil += src.dil * s; S.fee += src.fee * s; S.tradeRev += src.tradeRev * s;
        for (let t = 0; t < 3; t++) { S.pcdT[t] += src.pcd[t] * s; S.listT[t] += src.list[t] * s; pcd += src.pcd[t] * s; }
      } else {
        S.apcd += E.apcd(v, ctx) * s; S.dil += O.dil[i] * s; S.fee += O.fee[i] * s; S.tradeRev += O.tradeRev[i] * s;
        for (let t = 0; t < 3; t++) { S.pcdT[t] += O.pcdT[t][i] * s; S.listT[t] += O.listT[t][i] * s; }
        pcd = O.pcd[i] * s;
      }
      const k = v.ship * 100000 + m;
      S.pcdSM.set(k, (S.pcdSM.get(k) || 0) + pcd);
    }
  }
  S.pcd = sum3(S.pcdT); S.list = sum3(S.listT); S.rev = S.list - S.dil + S.fee;
  return S;
}

E.bridge = function (D, ctx, baseline) {
  const W = E.windowMonths(D, ctx), O = E.outlook(D, ctx);
  const shift = baseline === 'stly' ? 12 : 0;
  const B = windowSide(D, ctx, baseline === 'stly' ? 'act' : baseline === 'fc' ? 'fc' : 'bud', W.from - shift, W.to - shift, O);
  const A = windowSide(D, ctx, 'act', W.from, W.to, O);
  const cB = E.opCosts(D, ctx, W.from - shift, W.to - shift, baseline === 'stly' ? 'act' : 'bud', B.pcdSM);
  const cA = E.opCosts(D, ctx, W.from, W.to, 'act', A.pcdSM);
  const voy = c => c.fuel + c.port + c.crew + c.maint + c.prov;
  B.comm = (baseline === 'stly' ? ctx.terms.comm : D.meta.budgetComm) * B.tradeRev;
  A.comm = ctx.terms.comm * A.tradeRev;
  B.voy = voy(cB); A.voy = voy(cA); B.shore = cB.shore; A.shore = cA.shore; B.cost = cB; A.cost = cA;
  B.profit = B.rev - B.comm - B.voy - B.shore;
  A.profit = A.rev - A.comm - A.voy - A.shore;

  const dB = B.list ? B.dil / B.list : 0, dA = A.list ? A.dil / A.list : 0;
  const sB = B.pcdT.map(x => B.pcd ? x / B.pcd : 0), sA = A.pcdT.map(x => A.pcd ? x / A.pcd : 0);
  const fB = B.pcdT.map((x, t) => x ? B.listT[t] / x : 0), fA = A.pcdT.map((x, t) => x ? A.listT[t] / x : (fB[t] || 0));
  let fareB = 0, mix = 0, price = 0;
  for (let t = 0; t < 3; t++) {
    const fb = fB[t] || fA[t];                // a tier absent from the baseline is valued at its own fare
    fareB += sB[t] * fb;
    mix += (sA[t] - sB[t]) * fb;
    price += sA[t] * (fA[t] - fb);
  }
  const c = {
    volume: (A.pcd - B.pcd) * fareB * (1 - dB),
    mix: A.pcd * mix * (1 - dB),
    price: A.pcd * price * (1 - dB),
    dil: -A.list * (dA - dB),
    fees: A.fee - B.fee,
    comm: -(A.comm - B.comm),
    voy: -(A.voy - B.voy),
    shore: -(A.shore - B.shore),
  };
  // Whatever the tier arithmetic leaves when a side is empty belongs to volume.
  const revGap = (A.list - A.dil) - (B.list - B.dil);
  c.volume += revGap - (c.volume + c.mix + c.price + c.dil);
  const gap = A.profit - B.profit;
  const residual = gap - Object.values(c).reduce((s, x) => s + x, 0);
  return { W, baseline, base: B, act: A, comps: c, gap, residual };
};

/* ---------------------------------------------------------------------
   CASH. Guest payments follow the payment terms: a deposit at booking and
   the balance at the final-payment date, or everything at once inside that
   window. Refunds leave when a booking cancels, commissions when the
   voyage sails, operating costs in the month they are incurred. Months
   after the close are the schedule the current book and outlook imply.
   --------------------------------------------------------------------- */
E.cash = function (D, ctx) {
  return memo(D, 'cash|' + ctx.asOf + '|' + fkey(ctx) + '|' + skey(ctx), () => {
    const lo = D.range.minMi, hi = D.range.maxMi, n = hi - lo + 1, A = ctx.asOf, am = U.mi(A);
    const V = D.voyages, O = E.outlook(D, ctx), T = ctx.terms, R = reader(ctx), nS = D.dims.ships.length;
    const rec = Array.from({ length: nS }, () => f64(n)), refunds = f64(n), comm = f64(n), debt = f64(n), dry = f64(n);
    const paidV = f64(V.length), revV = f64(V.length);
    let held = 0, stateCash = 0;
    const put = (arr, m, x) => { const i = m - lo; if (i >= 0 && i < n) arr[i] += x; };

    for (const b of D.bookings) {
      if (b.bd > A || b.barter || b.nr) continue;
      const v = V[b.v];
      if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
      const r = R.rev(b);
      if (r <= 0) continue;
      const F = v.sail - T.finalDays, early = b.bd < F;
      const dep = early ? T.deposit * r : r;
      put(rec[v.ship], b.bmi, dep);
      let paid = dep;
      const cancelled = b.cd && b.cd <= A;
      if (early && !(cancelled && b.cd <= F)) {
        if (F <= A) { put(rec[v.ship], U.mi(F), r - dep); paid = r; }
        else put(rec[v.ship], U.mi(F), (r - dep) * (1 - O.cRem[b.v]));
      }
      if (cancelled) {
        const fee = Math.min(paid, R.fee(b));
        put(refunds, b.cmi, paid - fee);
        stateCash += fee;
      } else {
        stateCash += paid;
        if (v.sail <= A) { if (b.ch === 1) put(comm, v.smi, T.comm * r); }
        else { paidV[b.v] += paid; revV[b.v] += r; held += paid; }
      }
    }
    // The unsailed book: cancellations still to come, pickup still to arrive.
    for (const v of V) {
      if (v.sail <= A || v.nonRev || (ctx.ship >= 0 && v.ship !== ctx.ship)) continue;
      const i = v.i, months = Math.max(1, v.smi - am), Fm = U.mi(v.sail - T.finalDays);
      const expRefund = O.cRem[i] * Math.max(0, paidV[i] - O.feeRate[i] * revV[i]);
      const pick = O.pickRev[i] / months;
      for (let m = am + 1; m <= Math.max(am + 1, v.smi); m++) {
        put(refunds, m, expRefund / months);
        if (m < Fm) { put(rec[v.ship], m, pick * T.deposit); put(rec[v.ship], Fm, pick * (1 - T.deposit)); }
        else put(rec[v.ship], m, pick);
      }
      put(comm, v.smi, T.comm * O.tradeRev[i]);
    }

    const pcdSM = new Map();
    for (const v of V) for (const [m, d] of v.mdays) {
      const k = v.ship * 100000 + m;
      pcdSM.set(k, (pcdSM.get(k) || 0) + O.pcd[v.i] * d / v.days);
    }
    const costs = E.opCosts(D, ctx, lo, hi, 'act', pcdSM).byMonth;
    if (D.costs) {
      if (ctx.ship < 0) for (const L of D.costs.debt) {
        const p = L.principal / L.termM;
        for (let k = 0; k < L.termM; k++) put(debt, L.startMi + k, p + (L.principal - p * k) * L.rate / 12);
      }
      for (const d of D.costs.drydock) if (ctx.ship < 0 || d.ship === ctx.ship) put(dry, d.mi, d.amount);
    }
    // Receipts less refunds through the close must equal what the booking-level state says was kept.
    let flow = 0;
    for (let i = 0; i <= am - lo && i < n; i++) { for (let s = 0; s < nS; s++) flow += rec[s][i]; flow -= refunds[i]; }
    return { lo, n, am, rec, refunds, comm, debt, dry, costs, held, tie: flow - stateCash };
  });
};

E.river = function (D, ctx) {
  const C = E.cash(D, ctx), W = E.windowMonths(D, ctx), dm = D.dims;
  const sumR = arr => { let s = 0; for (let m = W.from; m <= W.to; m++) { const i = m - C.lo; if (i >= 0 && i < C.n) s += arr[i]; } return s; };
  const cost = k => { let s = 0; for (let m = W.from; m <= W.to; m++) { const r = C.costs[m - C.lo]; if (r) s += r[k]; } return s; };
  const sources = dm.ships.map((sh, si) => ({ name: sh.name, value: sumR(C.rec[si]), kind: 'in' }))
    .filter((s, si) => ctx.ship < 0 || ctx.ship === si);
  const uses = [
    { name: 'Guest refunds', value: sumR(C.refunds) },
    { name: 'Trade commissions', value: sumR(C.comm) },
    { name: 'Crew', value: cost('crew') },
    { name: 'Provisioning', value: cost('prov') },
    { name: 'Fuel', value: cost('fuel') },
    { name: 'Port & maintenance', value: cost('port') + cost('maint') },
    { name: 'Marketing & shoreside', value: cost('shore') },
    { name: 'Debt service', value: sumR(C.debt) },
    { name: 'Drydock', value: sumR(C.dry) },
  ].filter(u => u.value > 0.5).map(u => ({ ...u, kind: 'out' }));
  const cashIn = sources.reduce((s, x) => s + x.value, 0), cashOut = uses.reduce((s, x) => s + x.value, 0);
  const net = cashIn - cashOut;
  if (net >= 0) uses.push({ name: 'To cash reserves', value: net, kind: 'reserve' });
  else sources.push({ name: 'From cash reserves', value: -net, kind: 'reserve' });
  return { W, sources, uses, cashIn, cashOut, net, moved: Math.max(cashIn, cashOut), held: C.held };
};

// Net cash by month either side of the close.
E.cashMonths = function (D, ctx, back, fwd) {
  const C = E.cash(D, ctx), out = [];
  for (let m = C.am - back; m <= C.am + fwd; m++) {
    const i = m - C.lo;
    if (i < 0 || i >= C.n) continue;
    let inn = 0;
    for (const r of C.rec) inn += r[i];
    const k = C.costs[i] || {};
    const ops = (k.fuel || 0) + (k.port || 0) + (k.crew || 0) + (k.maint || 0) + (k.prov || 0) + (k.shore || 0);
    const outflow = C.refunds[i] + C.comm[i] + ops + C.debt[i] + C.dry[i];
    out.push({ mi: m, cashIn: inn, refunds: C.refunds[i], comm: C.comm[i], ops, debt: C.debt[i], dry: C.dry[i],
               cashOut: outflow, net: inn - outflow, forecast: m > C.am });
  }
  return out;
};

/* ---------------------------------------------------------------------
   VIEW-LEVEL AGGREGATIONS
   --------------------------------------------------------------------- */
// Revenue to-go: target less booked, three ways. The three totals must agree.
E.togo = function (D, ctx, year) {
  const P = E.position(D, ctx, ctx.asOf), R = E.yearRange(year);
  const byShipQ = E.rollup(D, ctx, P, { ...R, key: (v, m) => v.ship * 10 + U.miQuarter(m) });
  const byRegion = E.rollup(D, ctx, P, { ...R, key: v => v.region });
  const byQ = E.rollup(D, ctx, P, { ...R, key: (v, m) => U.miQuarter(m) });
  const byShip = E.rollup(D, ctx, P, { ...R, key: v => v.ship });
  return { byShipQ, byRegion, byQ, byShip, total: E.total(D, ctx, P, R) };
};

// Same sailing period one year earlier, as the book stood one year earlier.
E.stly = function (D, ctx, year, key, yearsBack) {
  const k = yearsBack || 1;
  const P = E.position(D, ctx, ctx.asOf - 365 * k), R = E.yearRange(year - k);
  return E.rollup(D, ctx, P, { ...R, key });
};

// Unsailed voyages in the next 400 days, largest projected shortfall against target first.
// A voyage is flagged when the outlook finishes at least 5% and $150k short.
E.watchlist = function (D, ctx, limit) {
  const P = E.position(D, ctx, ctx.asOf), O = E.outlook(D, ctx), rows = [];
  for (const v of D.voyages) {
    if (v.sail <= ctx.asOf || v.nonRev || !v.tgt || (ctx.ship >= 0 && v.ship !== ctx.ship)) continue;
    const dts = v.sail - ctx.asOf;
    if (dts > 400) continue;
    const tix = P.rev[v.i] + P.fee[v.i], expected = E.curveOf(D, v, ctx.asOf).cumBook[Math.min(80, Math.floor(dts / 10))];
    const pct = v.tgtRev ? tix / v.tgtRev : 0, shortfall = v.tgtRev - O.tix[v.i];
    rows.push({ v, dts, tix, target: v.tgtRev, togo: v.tgtRev - tix, pct, expected, pace: pct - expected,
                lf: v.apcdFull ? P.pcd[v.i] / v.apcdFull : 0, outlook: O.tix[v.i], shortfall,
                flagged: !v.charter && shortfall > Math.max(150e3, 0.05 * v.tgtRev) });
  }
  rows.sort((a, b) => b.shortfall - a.shortfall);
  return limit ? rows.slice(0, limit) : rows;
};

E.voyageTable = function (D, ctx, year) {
  const P = E.position(D, ctx, ctx.asOf), P3 = E.position(D, ctx, ctx.asOf - 91), rows = [];
  for (const v of D.voyages) {
    if (v.year !== year || (ctx.ship >= 0 && v.ship !== ctx.ship)) continue;
    const i = v.i, tix = P.rev[i] + P.fee[i], ap = E.apcd(v, ctx), f = v.fc || null, b = v.bud;
    const lfOf = x => x && x.apcd ? sum3(x.pcd) / x.apcd : null, gpdOf = x => x && sum3(x.pcd) ? revOf(x) / sum3(x.pcd) : null;
    rows.push({ v, sailed: v.sail <= ctx.asOf, tix, pcd: P.pcd[i], apcd: ap,
                lf: ap ? P.pcd[i] / ap : null, gpd: P.pcd[i] ? tix / P.pcd[i] : null,
                lfFc: lfOf(f), lfBud: lfOf(b), gpdFc: gpdOf(f), gpdBud: gpdOf(b),
                revFc: f ? revOf(f) : null, revBud: b ? revOf(b) : null, prev3: P3.rev[i] + P3.fee[i] });
  }
  return rows;
};

E.tierMix = function (D, ctx) {
  const cy = U.miYear(U.mi(ctx.asOf)), P = E.position(D, ctx, ctx.asOf);
  const col = (label, y, kind) => {
    const rev = [0, 0, 0], suites = [0, 0, 0], pcd = [0, 0, 0];
    for (const v of D.voyages) {
      if (v.year !== y || (ctx.ship >= 0 && v.ship !== ctx.ship)) continue;
      for (let t = 0; t < 3; t++) {
        if (kind === 'bud') {
          if (!v.bud) continue;
          const L = sum3(v.bud.list);
          rev[t] += v.bud.list[t] * (L ? 1 - v.bud.dil / L : 1); pcd[t] += v.bud.pcd[t]; suites[t] += v.bud.pcd[t] / (2 * v.days);
        } else { rev[t] += P.revT[t][v.i]; pcd[t] += P.pcdT[t][v.i]; suites[t] += P.suitesT[t][v.i]; }
      }
    }
    return { label, rev, suites, pcd, revTot: sum3(rev), suitesTot: sum3(suites) };
  };
  return [col(String(cy - 1) + ' actual', cy - 1, 'act'), col(cy + ' budget', cy, 'bud'), col(cy + ' actual ITD', cy, 'act'),
          col((cy + 1) + ' budget', cy + 1, 'bud'), col((cy + 1) + ' actual ITD', cy + 1, 'act')];
};

E.tradeAccounts = function (D, ctx) {
  const R = reader(ctx), V = D.voyages, [y] = U.ymd(ctx.asOf), from = U.dn(y, 1, 1), n = D.dims.accounts.length;
  const rows = D.dims.accounts.map(name => ({ name, book: 0, ly: 0, count: 0, pcd: 0, can: 0 }));
  for (const b of D.bookings) {
    if (b.ch !== 1 || b.acct < 0 || b.acct >= n || R.skip(b) || b.nr) continue;
    const v = V[b.v];
    if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
    const r = R.rev(b), a = rows[b.acct];
    if (b.bd >= from && b.bd <= ctx.asOf) {
      a.book += r; a.count += b.n; a.pcd += b.g * v.days;
      if (b.cd && b.cd <= ctx.asOf) a.can += r;
    } else if (b.bd >= from - 365 && b.bd <= ctx.asOf - 365) a.ly += r;
  }
  const tot = rows.reduce((s, a) => s + a.book, 0);
  rows.forEach(a => { a.share = tot ? a.book / tot : 0; a.yoy = a.ly ? a.book / a.ly - 1 : null; a.gpd = a.pcd ? a.book / a.pcd : null; a.canRate = a.book ? a.can / a.book : 0; });
  return { rows: rows.slice().sort((a, b) => b.book - a.book), total: tot, totalLy: rows.reduce((s, a) => s + a.ly, 0) };
};

E.guests = function (D, ctx, year) {
  const R = reader(ctx), V = D.voyages, dm = D.dims, lo = D.range.minMi, n = U.mi(ctx.asOf) - lo + 1;
  const sailed = f64(n), rep = f64(n), fvc = f64(n), byShip = dm.ships.map(() => f64(n));
  const geo = dm.markets.map(() => new Array(dm.regions.length).fill(0));
  const repeatShip = dm.ships.map(() => ({ bookings: 0, repeat: 0 }));
  const [y] = U.ymd(ctx.asOf), ytd = U.dn(y, 1, 1);
  for (const b of D.bookings) {
    if (b.bd > ctx.asOf || R.skip(b)) continue;
    const v = V[b.v];
    if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
    if (!b.nr && b.bd >= ytd) { repeatShip[v.ship].bookings += b.n; if (b.rep) repeatShip[v.ship].repeat += b.n; }
    if (b.fvc && b.src >= 0) { const i = V[b.src].smi - lo; if (i >= 0 && i < n) fvc[i] += b.g; }
    if ((b.cd && b.cd <= ctx.asOf) || !R.counts(b)) continue;
    if (v.year === year) geo[b.mkt][v.region] += b.g;
    if (v.sail <= ctx.asOf) {
      const i = v.smi - lo;
      sailed[i] += b.g; byShip[v.ship][i] += b.g;
      if (b.rep) rep[i] += b.g;
    }
  }
  return { lo, n, sailed, rep, fvc, byShip, geo, repeatShip };
};

// Cancelled revenue in each week over the unsailed book at the start of that week. Transfers excluded.
E.weeklyCancel = function (D, ctx, weeks) {
  const R = reader(ctx), V = D.voyages, N = weeks || 26, end = ctx.asOf;
  const start = i => end - 7 * (N - i);                     // week i runs (start(i), start(i) + 7]
  const num = f64(N), diff = f64(N + 1);
  for (const b of D.bookings) {
    if (b.bd > end || R.skip(b) || b.nr) continue;
    const v = V[b.v];
    if (ctx.ship >= 0 && v.ship !== ctx.ship) continue;
    const r = R.rev(b), until = Math.min(b.cd && b.cd <= end ? b.cd : Infinity, v.sail);
    // active at start(i) when bd <= start(i) < until
    const a = Math.max(0, Math.ceil((b.bd - start(0)) / 7)), z = Math.min(N, Math.ceil((until - start(0)) / 7));
    if (z > a) { diff[a] += r; diff[z] -= r; }
    if (b.cd && b.cd <= end && b.c2c !== 1) {
      const i = Math.ceil((b.cd - start(0)) / 7) - 1;
      if (i >= 0 && i < N) num[i] += r;
    }
  }
  const rows = [];
  let den = 0;
  for (let i = 0; i < N; i++) { den += diff[i]; rows.push({ end: start(i) + 7, cancelled: num[i], book: den, rate: den ? num[i] / den : 0 }); }
  return rows;
};

/* ---------------------------------------------------------------------
   HEADLINES & INTEGRITY
   --------------------------------------------------------------------- */
E.headline = function (D, ctx) {
  const cy = U.miYear(U.mi(ctx.asOf)), P = E.position(D, ctx, ctx.asOf), am = U.mi(ctx.asOf);
  const yr = y => {
    const t = E.total(D, ctx, P, E.yearRange(y));
    const ly = E.total(D, ctx, E.position(D, ctx, ctx.asOf - 365), E.yearRange(y - 1));
    const lyDen = y - 1 < cy ? E.total(D, ctx, E.position(D, ctx, D.meta.pull), E.yearRange(y - 1)).tix : ly.tgt;
    const out = E.outlookTotal(D, ctx, y);
    return { year: y, label: E.targetLabel(D, y), tix: t.tix, tgt: t.tgt, pct: t.tgt ? t.tix / t.tgt : null, togo: t.tgt - t.tix,
             lf: t.apcd ? t.pcd / t.apcd : null, gpd: t.pcd ? t.tix / t.pcd : null, tgtGpd: t.tgtPcd ? t.tgt / t.tgtPcd : null,
             ly, lyPct: lyDen ? ly.tix / lyDen : null, lyLf: ly.apcd ? ly.pcd / ly.apcd : null, lyGpd: ly.pcd ? ly.tix / ly.pcd : null,
             outlook: out.tix, bud: t.bud };
  };
  const prod = E.production(D, ctx, ctx.asOf), row = m => prod.rows[m - prod.lo] || { book: 0, can: 0, fee: 0 };
  const net = r => r.book - r.can + r.fee;
  const has = y => D.voyages.some(v => v.year === y);
  return { cy, years: [ctx.year, ctx.year + 1].filter(has).map(yr), netMonth: net(row(am)), netPrev: net(row(am - 1)), netLy: net(row(am - 12)),
           held: E.cash(D, ctx).held };
};

// True when most voyages sailing in the bridge and river window carry a forecast.
E.hasForecast = function (D, ctx) {
  const W = E.windowMonths(D, ctx);
  let n = 0, fc = 0;
  for (const v of D.voyages) {
    if (v.smi < W.from || v.smi > W.to || !v.bud || (ctx.ship >= 0 && v.ship !== ctx.ship)) continue;
    n++; if (v.fc) fc++;
  }
  return n > 0 && fc * 2 >= n;
};

// What moved between the previous month-end and this one.
E.monthChange = function (D, ctx) {
  const prev = U.miEnd(U.mi(ctx.asOf) - 1), cP = { ...ctx, asOf: prev };
  const Pn = E.position(D, ctx, ctx.asOf), Pp = E.position(D, ctx, prev), movers = [];
  for (const v of D.voyages) {
    if (v.nonRev || v.sail <= prev || (ctx.ship >= 0 && v.ship !== ctx.ship)) continue;
    const delta = (Pn.rev[v.i] + Pn.fee[v.i]) - (Pp.rev[v.i] + Pp.fee[v.i]);
    if (Math.abs(delta) > 1) movers.push({ v, delta, tix: Pn.rev[v.i] + Pn.fee[v.i] });
  }
  movers.sort((a, b) => b.delta - a.delta);
  return { prev, now: E.headline(D, ctx), was: E.headline(D, cP), up: movers.slice(0, 5),
           down: movers.filter(m => m.delta < 0).slice(-3).reverse() };
};

// How the outlook would have done: project from earlier closes and score against what then sailed.
E.backtest = function (D, ctx) {
  return memo(D, 'bt|' + ctx.asOf + '|' + fkey(ctx), () => {
    const zero = { vol: 0, price: 0, cancel: 0, dil: 0, fuel: 0 }, Pn = E.position(D, ctx, ctx.asOf), rows = [];
    for (const back of [12, 9, 6, 3]) {
      const a = U.miEnd(U.mi(ctx.asOf) - back), c = { ...ctx, asOf: a, scen: zero };
      if (U.mi(a) <= D.range.minMi) continue;
      const O = E.outlook(D, c), Pt = E.position(D, c, a);
      const r = { back, asOf: a, n: 0, booked: 0, outlook: 0, actual: 0, target: 0, absOut: 0, absTgt: 0 };
      for (const v of D.voyages) {
        if (v.sail <= a || v.sail > ctx.asOf || v.nonRev || !v.tgt || (ctx.ship >= 0 && v.ship !== ctx.ship)) continue;
        const act = Pn.rev[v.i] + Pn.fee[v.i];
        r.n++; r.booked += Pt.rev[v.i] + Pt.fee[v.i]; r.outlook += O.tix[v.i]; r.actual += act; r.target += v.tgtRev;
        r.absOut += Math.abs(O.tix[v.i] - act); r.absTgt += Math.abs(v.tgtRev - act);
      }
      if (r.n) rows.push(r);
    }
    return rows;
  });
};

E.checks = function (D, ctx) {
  const P = E.position(D, ctx, ctx.asOf), out = [];
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1 : tol);
  const br = E.bridge(D, ctx, 'bud');
  out.push({ name: 'Profit bridge foots', ok: near(br.residual, 0), detail: 'Bars sum to the profit gap; residual ' + U.dollars(br.residual) });
  const rv = E.river(D, ctx);
  const inn = rv.sources.reduce((s, x) => s + x.value, 0), outv = rv.uses.reduce((s, x) => s + x.value, 0);
  out.push({ name: 'Cash river conserves', ok: near(inn, outv), detail: 'Cash in ' + U.money(inn) + ' equals cash out plus reserves ' + U.money(outv) });
  const tg = E.togo(D, ctx, ctx.year);
  const s = m => { let x = 0; for (const a of m.values()) x += a.tix; return x; };
  out.push({ name: 'Revenue to-go ties three ways', ok: near(s(tg.byShipQ), tg.total.tix) && near(s(tg.byRegion), tg.total.tix) && near(s(tg.byQ), tg.total.tix),
             detail: 'By ship and quarter, by region and by quarter all total ' + U.money(tg.total.tix) });
  const prod = E.production(D, ctx, ctx.asOf);
  let flow = 0;
  for (const r of prod.rows) flow += r.book - r.can;
  let stock = 0;
  for (const v of D.voyages) if (ctx.ship < 0 || v.ship === ctx.ship) stock += P.rev[v.i];
  out.push({ name: 'Bookings less cancellations equal the book', ok: near(flow, stock, 2), detail: 'Monthly production nets to the ' + U.money(stock) + ' active book' });
  const tm = E.tierMix(D, ctx), prodY = prod.rows[prod.rows.length - 1];
  const chTot = prodY.ch.reduce((a, b) => a + b, 0);
  out.push({ name: 'Mixes sum to the total', ok: tm.every(c => near(sum3(c.rev), c.revTot)) && near(chTot, prodY.book, 1),
             detail: 'Suite tiers and channels each add back to the total they split' });
  const cash = E.cash(D, ctx);
  out.push({ name: 'Cash ties to the booking ledger', ok: near(cash.tie, 0, 2), detail: 'Receipts less refunds to the close equal what each booking has paid in' });
  return out;
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
