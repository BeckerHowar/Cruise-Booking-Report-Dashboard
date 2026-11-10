/* Shared helpers: integer day numbers, month indices, a seeded PRNG and formatting.
   Dates are stored as whole days since 1970-01-01 UTC so that comparing two
   dates is an integer compare and no timezone can move a booking across midnight. */
(function (root) {
'use strict';
const CBR = root.CBR = root.CBR || {};
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const U = CBR.util = {
  MON,
  dn: (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY),
  ymd(n) { const t = new Date(n * DAY); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; },
  // month index = year * 12 + (month - 1)
  mi(n) { const t = new Date(n * DAY); return t.getUTCFullYear() * 12 + t.getUTCMonth(); },
  miOf: (y, m) => y * 12 + (m - 1),
  miYear: mi => Math.floor(mi / 12),
  miQuarter: mi => Math.floor((mi % 12) / 3),          // 0..3
  miStart: mi => U.dn(Math.floor(mi / 12), (mi % 12) + 1, 1),
  miEnd: mi => U.miStart(mi + 1) - 1,
  miLabel: mi => MON[mi % 12] + '-' + String(Math.floor(mi / 12)).slice(2),
  dateLabel(n) { const [y, m, d] = U.ymd(n); return d + ' ' + MON[m - 1] + ' ' + y; },
  shortDate(n) { const [y, m, d] = U.ymd(n); return d + ' ' + MON[m - 1] + ' ' + String(y).slice(2); },
  // Accepts a day number, epoch milliseconds, a Date or an ISO string.
  toDay(x) {
    if (x == null || x === '') return 0;
    if (x instanceof Date) return Math.floor(x.getTime() / DAY);
    if (typeof x === 'number') return x > 1e7 ? Math.floor(x / DAY) : Math.floor(x);
    const t = Date.parse(String(x).length <= 10 ? x + 'T00:00:00Z' : x);
    return isNaN(t) ? 0 : Math.floor(t / DAY);
  },

  rng(seed) {                                        // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  sum: arr => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s; },

  /* ---------- formatting ---------- */
  money(v, dec) {                                    // $12.3M / $840k / $95
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    let s;
    if (a >= 1e6) s = '$' + (a / 1e6).toFixed(dec == null ? 1 : dec) + 'M';
    else if (a >= 1e3) s = '$' + (a / 1e3).toFixed(0) + 'k';
    else s = '$' + a.toFixed(0);
    return v < -0.5 ? '−' + s : s;
  },
  signedMoney: v => !isFinite(v) ? '—' : Math.abs(v) < 0.5 ? '$0' : (v > 0 ? '+' : '−') + U.money(Math.abs(v)),
  dollars: v => isFinite(v) ? (v < -0.5 ? '−' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US') : '—',
  int: v => isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—',
  // A value that rounds to zero carries no sign, so "−0.0%" never appears.
  signed(v, d, unit, plus) {
    if (!isFinite(v)) return '—';
    const s = (Math.abs(v) * 100).toFixed(d == null ? 1 : d);
    return (+s === 0 ? '' : v < 0 ? '−' : plus ? '+' : '') + s + unit;
  },
  pct: (v, d) => U.signed(v, d, '%', false),
  signedPct: (v, d) => U.signed(v, d, '%', true),
  pp: (v, d) => U.signed(v, d, ' pp', true),
  esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
