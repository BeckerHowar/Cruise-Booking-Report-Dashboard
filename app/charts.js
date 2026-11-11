/* Hand-rolled SVG charts. Every function returns a string; nothing here touches
   the DOM. Hover detail is carried in data-tip attributes, which main.js shows
   in one shared tooltip for mouse and touch alike. All drawn at a real aspect
   ratio — never stretched. */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util;
const C = CBR.charts = {};

C.PAL = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
const FS = 11.5;                                     // axis and label text, in chart units
const tip = t => ' data-tip="' + U.esc(t).replace(/\n/g, '&#10;') + '"';

function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step * 0.001; v += step) ticks.push(v);
  return ticks;
}
C.axisMoney = v => {
  if (v === 0) return '0';
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'k' : String(Math.round(a));
  return (v < 0 ? '−$' : '$') + s;
};
C.axisPct = v => Math.round(v * 100) + '%';

// `bare` leaves the background off, for a chart that draws its own panels.
const frame = (W, H, label, inner, attrs, bare) =>
  '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img"' + (attrs || '') + ' aria-label="' + U.esc(label || 'chart') + '">' +
  (bare ? '' : '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="var(--chart-surface)" rx="6"/>') + inner + '</svg>';

function grid(ticks, y, x0, x1, fmt) {
  let g = '';
  for (const tv of ticks) {
    g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + y(tv) + '" y2="' + y(tv) + '" stroke="var(--grid)" stroke-width="1"/>' +
         '<text x="' + (x0 - 7) + '" y="' + (y(tv) + 4) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">' + fmt(tv) + '</text>';
  }
  return g;
}
const xLabel = (x, H, text) => '<text x="' + x + '" y="' + (H - 9) + '" text-anchor="middle" font-size="' + FS + '" fill="var(--ink-2)">' + text + '</text>';

/* Lines. o = { labels, series:[{name,color,values,dashed,width}], yFmt, tipFmt, every, markAt, markLabel, zero, width, height } */
C.lines = function (o) {
  const W = o.width || 640, H = o.height || 250, pL = o.padL || 58, pR = 16, pT = 16, pB = 30;
  const iw = W - pL - pR, ih = H - pT - pB, N = o.labels.length, fmt = o.yFmt || C.axisMoney, tf = o.tipFmt || fmt;
  let lo = o.zero === false ? Infinity : 0, hi = -Infinity;
  for (const s of o.series) for (const v of s.values) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!isFinite(hi)) { lo = 0; hi = 1; }
  if (hi <= lo) hi = lo + 1;
  const ticks = niceTicks(lo, hi, 4);
  lo = ticks[0]; hi = ticks[ticks.length - 1];
  const x = i => pL + (N > 1 ? i / (N - 1) : 0.5) * iw, y = v => pT + (1 - (v - lo) / (hi - lo)) * ih;
  let g = grid(ticks, y, pL, W - pR, fmt);
  if (lo < 0 && hi > 0) g += '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--axis)" stroke-width="1.25"/>';
  const every = o.every || Math.max(1, Math.ceil(N / 8));
  for (let i = 0; i < N; i += every) g += xLabel(x(i), H, o.labels[i]);
  if (o.markAt != null && o.markAt >= 0 && o.markAt < N) {
    const mx = x(o.markAt);
    g += '<line x1="' + mx + '" x2="' + mx + '" y1="' + pT + '" y2="' + (pT + ih) + '" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3" opacity="0.8"/>' +
         '<text x="' + (mx - 5) + '" y="' + (pT + 11) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">' + (o.markLabel || '') + '</text>';
  }
  let marks = '';
  for (const s of o.series) {
    let d = '', pen = false, lastI = -1;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
      pen = true; lastI = i;
    });
    if (!d) continue;
    marks += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '" stroke-linejoin="round"' +
      (s.dashed ? ' stroke-dasharray="' + s.dashed + '" opacity="0.9"' : '') + '/>';
    if (!s.dashed) marks += '<circle cx="' + x(lastI) + '" cy="' + y(s.values[lastI]) + '" r="3.4" fill="' + s.color + '" stroke="var(--chart-surface)" stroke-width="1.8"/>';
  }
  let hits = '';
  const step = N > 1 ? iw / (N - 1) : iw;
  for (let i = 0; i < N; i++) {
    const rows = o.series.filter(s => s.values[i] != null).map(s => s.name + ': ' + tf(s.values[i])).join('\n');
    if (rows) hits += '<rect x="' + (x(i) - step / 2) + '" y="' + pT + '" width="' + step + '" height="' + ih + '" fill="transparent"' + tip(o.labels[i] + '\n' + rows) + '/>';
  }
  return frame(W, H, o.label, g + marks + hits);
};

/* ---------------------------------------------------------------------
   BOOKING PACE. The three curves sit within a point or two of each other
   on a 0-100% scale, so the lines alone cannot show who is ahead. Each
   year gets its own colour, and a strip underneath plots the difference
   itself: points ahead of or behind the prior year at the same calendar
   point. Four layouts: every year on one plot as lines or as bars, or one
   panel a year set side by side or stacked, all on one scale. The current-year line, its
   tip, the marker and the gap bar for the month in progress are tagged so
   replay can move them in place.
   o = { labels, cy, stly, y2, at, year, denom, start, wide, layout }
   --------------------------------------------------------------------- */
const PACE_GAP_H = 72;
const paceAttrs = (o, N, g) => ' class="livepace" data-year="' + o.year + '" data-denom="' + o.denom + '" data-start="' + o.start + '" data-n="' + N +
  '" data-pl="' + g.pl + '" data-iw="' + g.iw + '" data-pt="' + g.pt + '" data-ih="' + g.ih + '" data-lo="0" data-hi="' + g.hi + '" data-basey="' + g.basey +
  '" data-gpl="' + g.gpl + '" data-giw="' + g.giw + '" data-ref="' + o.stly.map(v => v == null ? '' : v.toFixed(6)).join(',') +
  '" data-gy0="' + g.st.gy0 + '" data-gk="' + g.st.gk + '" data-gm="' + g.st.gm + '" data-bw="' + g.st.bw.toFixed(1) +
  '" data-boff="' + (g.boff || 0).toFixed(2) + '"';

// How the year in focus stands against an earlier year at the same point: the words, and their colour.
C.paceNote = (year, d) => Math.abs(d) < 0.0005 ? [year + ' is level with it', 'var(--ink-2)']
  : [year + ' is ' + (Math.abs(d) * 100).toFixed(1) + ' pp ' + (d > 0 ? 'ahead' : 'behind'), d > 0 ? 'var(--good-text)' : 'var(--neg)'];

// The gap strip: one bar a month between x0 and x1, with its zero line at the middle of the band starting at sT.
function paceStrip(o, gaps, x, x0, x1, sT, step) {
  const sH = PACE_GAP_H, bw = Math.min(22, step * 0.62);
  let gm = 0.02;
  for (const v of gaps) if (v != null) gm = Math.max(gm, Math.abs(v));
  gm = Math.ceil(gm * 100 - 1e-9) / 100;
  const gy0 = sT + sH / 2, gk = (sH / 2) / gm;
  let s = '<text x="' + x0 + '" y="' + (sT - 12) + '" font-size="' + FS + '" font-weight="650" fill="var(--ink)">Gap to ' + (o.year - 1) + ' sailings at the same calendar point</text>' +
    '<text x="' + x1 + '" y="' + (sT - 12) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">points of target · green ahead, red behind</text>';
  for (const [v, lab] of [[gm, '+' + Math.round(gm * 100) + ' pp'], [0, '0'], [-gm, '−' + Math.round(gm * 100) + ' pp']]) {
    const yy = gy0 - v * gk;
    s += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + yy + '" y2="' + yy + '" stroke="' + (v === 0 ? 'var(--axis)' : 'var(--grid)') + '" stroke-width="' + (v === 0 ? 1.25 : 1) + '"/>' +
      '<text x="' + (x0 - 7) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">' + lab + '</text>';
  }
  gaps.forEach((v, i) => {
    if (v == null) return;
    const h = Math.max(1, Math.abs(v) * gk);
    s += '<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + (v >= 0 ? gy0 - h : gy0).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + (v >= 0 ? 'var(--good)' : 'var(--crit)') + '"/>';
  });
  const now = gaps[o.at];
  if (now != null) s += '<text class="gap-now" x="' + x(o.at) + '" y="' + (now >= 0 ? gy0 - Math.abs(now) * gk - 5 : gy0 + Math.abs(now) * gk + 13).toFixed(1) +
    '" text-anchor="middle" font-size="12" font-weight="700" fill="' + (now >= 0 ? 'var(--good-text)' : 'var(--neg)') + '">' + U.pp(now, 1) + '</text>';
  s += '<rect class="live-gap" visibility="hidden" x="0" y="0" width="' + bw.toFixed(1) + '" height="0" rx="1.5"/>' +
    '<text class="live-gaplabel" visibility="hidden" text-anchor="middle" font-size="12" font-weight="700"></text>';
  return { svg: s, gy0, gk, gm, bw };
}
const NO_STRIP = { svg: '', gy0: 0, gk: 0, gm: 0.02, bw: 0 };

function paceOverlay(o, W, N, gaps, hasGap, ticks, hi) {
  const pL = 58, pR = 16, pT = 16, ih = o.wide ? 236 : 176;
  const sT = pT + ih + 40, H = hasGap ? sT + PACE_GAP_H + 32 : pT + ih + 30, iw = W - pL - pR;
  const x = i => pL + i / (N - 1) * iw, y = v => pT + (1 - v / hi) * ih, step = iw / (N - 1);
  let g = grid(ticks, y, pL, W - pR, C.axisPct);
  for (let i = 0; i < N; i += (o.wide ? 3 : 6)) g += xLabel(x(i), H, o.labels[i]);

  const path = arr => { let d = '', pen = false, last = -1; arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true; last = i; }); return { d, last }; };
  const p2 = path(o.y2), p1 = path(o.stly), p0 = path(o.cy);
  let marks = '';
  if (p2.d) marks += '<path d="' + p2.d + '" fill="none" stroke="var(--c8)" stroke-width="1.5" stroke-dasharray="3 4" stroke-linejoin="round"/>';
  if (p1.d) marks += '<path d="' + p1.d + '" fill="none" stroke="var(--c2)" stroke-width="2" stroke-linejoin="round"/>';
  if (p0.d) marks += '<path class="live-line" data-base="' + p0.d + '" d="' + p0.d + '" fill="none" stroke="var(--c1)" stroke-width="3" stroke-linejoin="round"/>' +
    '<circle class="live-dot" cx="' + x(p0.last) + '" cy="' + y(o.cy[p0.last]) + '" r="4.2" fill="var(--c1)" stroke="var(--chart-surface)" stroke-width="2"/>';

  const st = hasGap ? paceStrip(o, gaps, x, pL, W - pR, sT, step) : NO_STRIP;
  const mx = x(o.at), bottom = hasGap ? sT + PACE_GAP_H : pT + ih;
  const mark = '<g class="live-mark" data-x="' + mx.toFixed(1) + '"><line x1="' + mx + '" x2="' + mx + '" y1="' + pT + '" y2="' + bottom + '" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3" opacity="0.85"/>' +
    '<text x="' + (mx - 5) + '" y="' + (pT + 11) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">as of</text></g>';

  let hits = '';
  for (let i = 0; i < N; i++) {
    const rows = [];
    if (o.cy[i] != null) rows.push(o.year + ' sailings: ' + U.pct(o.cy[i]));
    if (o.stly[i] != null) rows.push((o.year - 1) + ', a year earlier: ' + U.pct(o.stly[i]));
    if (o.y2[i] != null) rows.push((o.year - 2) + ', two years earlier: ' + U.pct(o.y2[i]));
    if (gaps[i] != null) rows.push('Gap to ' + (o.year - 1) + ': ' + U.pp(gaps[i], 1));
    if (rows.length) hits += '<rect x="' + (x(i) - step / 2) + '" y="' + pT + '" width="' + step + '" height="' + (bottom - pT) + '" fill="transparent"' + tip(o.labels[i] + '\n' + rows.join('\n')) + '/>';
  }
  return frame(W, H, o.year + ' booking curve against the two prior years, with the gap to the prior year', g + marks + st.svg + mark + hits,
    paceAttrs(o, N, { pl: pL, iw, pt: pT, ih, hi, basey: 0, gpl: pL, giw: iw, st }));
}

// One panel a year, on one scale. Side by side reads oldest to newest; stacked puts the year in focus on top.
function paceSplit(o, W, N, gaps, hasGap, ticks, hi) {
  const stack = o.layout === 'stack', at = o.at, now = o.cy[at];
  const years = [{ k: 0, vals: o.cy, color: 'var(--c1)', w: 3 }, { k: 1, vals: o.stly, color: 'var(--c2)', w: 2.4 }, { k: 2, vals: o.y2, color: 'var(--c8)', w: 2.4 }]
    .filter(s => s.k === 0 || s.vals.some(v => v != null));
  if (!stack) years.reverse();
  const n = years.length, G = stack ? 14 : 24, pL = stack ? 58 : 46, pR = stack ? 16 : 14, pT = 36, pB = 26, ih = stack ? 110 : 216;
  const pw = stack ? W : (W - (n - 1) * G) / n, ph = pT + ih + pB, iw = pw - pL - pR, every = stack ? 3 : 6;
  const panelsH = stack ? n * ph + (n - 1) * G : ph;
  const sx0 = 58, sx1 = W - 16, sx = i => sx0 + i / (N - 1) * (sx1 - sx0), sStep = (sx1 - sx0) / (N - 1);
  const stripTop = panelsH + G, sT = stripTop + 34, H = hasGap ? sT + PACE_GAP_H + 32 : panelsH;
  const halo = ' stroke="var(--chart-surface)" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round"';
  const vline = (xx, y1, y2) => '<line x1="' + xx.toFixed(1) + '" x2="' + xx.toFixed(1) + '" y1="' + y1 + '" y2="' + y2 + '" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3" opacity="0.85"/>';
  let body = '', marks = '', hits = '', live = { pl: pL, pt: pT, basey: 0, mx: 0 };

  years.forEach((s, idx) => {
    const x0 = stack ? 0 : idx * (pw + G), y0 = stack ? idx * (ph + G) : 0, yr = o.year - s.k, top = y0 + pT, right = x0 + pw - pR;
    const x = i => x0 + pL + i / (N - 1) * iw, y = v => top + (1 - v / hi) * ih, step = iw / (N - 1);
    let p = '<rect x="' + x0.toFixed(1) + '" y="' + y0 + '" width="' + pw.toFixed(1) + '" height="' + ph + '" rx="6" fill="var(--chart-surface)"/>' + grid(ticks, y, x0 + pL, right, C.axisPct);
    for (let i = 0; i < N; i += every) {
      const edge = x(i) + 22 > x0 + pw;
      p += '<text x="' + (edge ? x0 + pw - 4 : x(i)).toFixed(1) + '" y="' + (y0 + ph - 8) + '" text-anchor="' + (edge ? 'end' : 'middle') + '" font-size="' + FS + '" fill="var(--ink-2)">' + U.miLabel(o.start + i - 12 * s.k) + '</text>';
    }

    // heading: which year this is, and how the year in focus compares at the same point
    const v = s.vals[at];
    let note = '', tone = 'var(--ink-2)';
    if (s.k === 0) { if (now != null) note = U.pct(now) + ' of target booked'; }
    else if (v != null && now != null) [note, tone] = C.paceNote(o.year, now - v);
    p += '<rect x="' + (x0 + pL).toFixed(1) + '" y="' + (y0 + 13) + '" width="16" height="4" rx="2" fill="' + s.color + '"/>' +
      '<text x="' + (x0 + pL + 22).toFixed(1) + '" y="' + (y0 + 19) + '" font-size="12.5" font-weight="650" fill="var(--ink)">' + yr + ' sailings</text>';
    const noteSvg = note ? '<text class="pn" x="' + right.toFixed(1) + '" y="' + (y0 + 19) + '" text-anchor="end" font-size="' + FS + '" font-weight="650" fill="' + tone + '">' + note + '</text>' : '';
    if (s.k === 0) p += noteSvg;

    // the focus year's current level, carried across the earlier years
    if (s.k > 0 && now != null) {
      const gy = y(now), left = at > N * 0.6, below = !left && gy + 16 < top + ih;
      p += '<g class="live-guide"><line x1="' + (x0 + pL).toFixed(1) + '" x2="' + right.toFixed(1) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="var(--c1)" stroke-width="1.25" stroke-dasharray="5 4"/>' +
        '<text x="' + (left ? x0 + pL + 5 : right - 5).toFixed(1) + '" y="' + (below ? gy + 13 : gy - 5).toFixed(1) + '" text-anchor="' + (left ? 'start' : 'end') + '" font-size="' + FS + '" fill="var(--ink-2)"' + halo + '>' + o.year + ' now</text></g>';
    }
    marks += vline(x(at), top, top + ih);

    const seg = (a, b) => { let d = '', pen = false, last = -1; for (let i = a; i <= b; i++) { const q = s.vals[i]; if (q == null) { pen = false; continue; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(q).toFixed(1) + ' '; pen = true; last = i; } return { d, last }; };
    let li = at;
    if (s.k === 0) {
      const a = seg(0, N - 1);
      li = a.last;
      if (a.d) p += '<path class="live-line" data-base="' + a.d + '" d="' + a.d + '" fill="none" stroke="' + s.color + '" stroke-width="' + s.w + '" stroke-linejoin="round"/>' +
        '<circle class="live-dot" cx="' + x(li).toFixed(1) + '" cy="' + y(s.vals[li]).toFixed(1) + '" r="4.2" fill="' + s.color + '" stroke="var(--chart-surface)" stroke-width="2"/>';
      live = { pl: x0 + pL, pt: top, basey: now != null ? y(now) : 0, mx: x(at) };
    } else {
      const a = seg(0, at), b = seg(at, N - 1);
      p += '<g class="live-prior" data-pl="' + (x0 + pL).toFixed(1) + '" data-pt="' + top + '" data-vals="' + s.vals.map(q => q == null ? '' : q.toFixed(6)).join(',') + '">' + noteSvg;
      if (b.d) p += '<path d="' + b.d + '" fill="none" stroke="' + s.color + '" stroke-width="1.6" opacity="0.45" stroke-linejoin="round"/>';
      if (a.d) p += '<path class="pl" data-base="' + a.d + '" d="' + a.d + '" fill="none" stroke="' + s.color + '" stroke-width="' + s.w + '" stroke-linejoin="round"/>';
      if (v != null) p += '<circle class="pd" cx="' + x(at).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.8" fill="' + s.color + '" stroke="var(--chart-surface)" stroke-width="2"/>';
    }
    const lv = li >= 0 ? s.vals[li] : null;
    if (lv != null) {
      const flip = x(li) - (x0 + pL) < 52;
      p += '<text class="' + (s.k === 0 ? 'live-val' : 'pv') + '" x="' + (x(li) + (flip ? 9 : -9)).toFixed(1) + '" y="' + Math.max(y(lv) - 9, top + 11).toFixed(1) + '" text-anchor="' + (flip ? 'start' : 'end') +
        '" font-size="12.5" font-weight="700" fill="var(--ink)"' + halo + '>' + U.pct(lv) + '</text>';
    }
    if (s.k > 0) p += '</g>';

    for (let i = 0; i < N; i++) {
      if (s.vals[i] == null) continue;
      const rows = [yr + ' sailings: ' + U.pct(s.vals[i])];
      if (s.k > 0 && i <= at && o.cy[i] != null) rows.push(o.year + ' at the same point: ' + U.pct(o.cy[i]), o.year + ' against ' + yr + ': ' + U.pp(o.cy[i] - s.vals[i], 1));
      hits += '<rect x="' + (x(i) - step / 2).toFixed(1) + '" y="' + top + '" width="' + step.toFixed(1) + '" height="' + ih + '" fill="transparent"' + tip(U.miLabel(o.start + i - 12 * s.k) + '\n' + rows.join('\n')) + '/>';
    }
    body += p;
  });

  let st = NO_STRIP;
  if (hasGap) {
    st = paceStrip(o, gaps, sx, sx0, sx1, sT, sStep);
    body += '<rect x="0" y="' + stripTop + '" width="' + W + '" height="' + (H - stripTop) + '" rx="6" fill="var(--chart-surface)"/>' + st.svg;
    for (let i = 0; i < N; i += 3) body += xLabel(sx(i), H, o.labels[i]);
    if (stack) marks += vline(sx(at), sT, sT + PACE_GAP_H);      // stacked panels share the strip's months, so one marker runs through all of them
    gaps.forEach((gv, i) => {
      if (gv != null) hits += '<rect x="' + (sx(i) - sStep / 2).toFixed(1) + '" y="' + sT + '" width="' + sStep.toFixed(1) + '" height="' + PACE_GAP_H + '" fill="transparent"' + tip(o.labels[i] + '\nGap to ' + (o.year - 1) + ': ' + U.pp(gv, 1)) + '/>';
    });
  }
  return frame(W, H, o.year + ' booking curve and the two prior years, one panel each, with the gap to the prior year',
    body + '<g class="live-mark" data-x="' + live.mx.toFixed(1) + '">' + marks + '</g>' + hits,
    paceAttrs(o, N, { pl: live.pl, iw, pt: live.pt, ih, hi, basey: live.basey, gpl: sx0, giw: sx1 - sx0, st }), true);
}

// The three years as bars side by side at each month-end, oldest on the left.
function paceBars(o, W, N, gaps, hasGap, ticks, hi) {
  const pL = 58, pR = 16, pT = 16, ih = 236, full = W - pL - pR, step = full / N, x0 = pL + step / 2, iw = full - step;
  const sT = pT + ih + 40, H = hasGap ? sT + PACE_GAP_H + 32 : pT + ih + 30, base = pT + ih;
  const x = i => x0 + i / (N - 1) * iw, y = v => pT + (1 - v / hi) * ih, gw = step * 0.8, bwid = gw / 3;
  let g = grid(ticks, y, pL, W - pR, C.axisPct), bars = '', hits = '';
  for (let i = 0; i < N; i += 3) g += xLabel(x(i), H, o.labels[i]);
  const series = [{ vals: o.y2, color: 'var(--c8)', name: (o.year - 2) + ', two years earlier' }, { vals: o.stly, color: 'var(--c2)', name: (o.year - 1) + ', a year earlier' },
                  { vals: o.cy, color: 'var(--c1)', name: o.year + ' sailings' }];
  const st = hasGap ? paceStrip(o, gaps, x, pL, W - pR, sT, step) : NO_STRIP, bottom = hasGap ? sT + PACE_GAP_H : base;
  for (let i = 0; i < N; i++) {
    const rows = [];
    series.forEach((s, k) => {
      const v = s.vals[i];
      if (v == null) return;
      const h = Math.max(1, v / hi * ih);
      bars += '<rect x="' + (x(i) - gw / 2 + k * bwid + 0.5).toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + (bwid - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + s.color + '"' +
        (k < 2 && i > o.at ? ' opacity="0.4"' : '') + '/>';
      rows.unshift(s.name + ': ' + U.pct(v));
    });
    if (gaps[i] != null) rows.push('Gap to ' + (o.year - 1) + ': ' + U.pp(gaps[i], 1));
    if (rows.length) hits += '<rect x="' + (x(i) - step / 2).toFixed(1) + '" y="' + pT + '" width="' + step.toFixed(1) + '" height="' + (bottom - pT) + '" fill="transparent"' + tip(o.labels[i] + '\n' + rows.join('\n')) + '/>';
  }
  bars += '<rect class="live-bar" visibility="hidden" x="0" y="' + base + '" width="' + (bwid - 1).toFixed(1) + '" height="0" fill="var(--c1)"/>';
  const mx = x(o.at) + step / 2;
  const mark = '<g class="live-mark" data-x="' + x(o.at).toFixed(1) + '"><line x1="' + mx.toFixed(1) + '" x2="' + mx.toFixed(1) + '" y1="' + pT + '" y2="' + bottom + '" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3" opacity="0.85"/>' +
    '<text x="' + (mx - 5).toFixed(1) + '" y="' + (pT + 11) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)" stroke="var(--chart-surface)" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">as of</text></g>';
  return frame(W, H, o.year + ' booking curve against the two prior years as bars, with the gap to the prior year', g + bars + st.svg + mark + hits,
    paceAttrs(o, N, { pl: x0, iw, pt: pT, ih, hi, basey: 0, gpl: x0, giw: iw, st, boff: -gw / 2 + 2 * bwid + 0.5 }));
}

C.pace = function (o) {
  const W = o.wide ? 1120 : 640, N = o.labels.length;
  const gaps = o.cy.map((v, i) => (v != null && o.stly[i] != null && i <= o.at) ? v - o.stly[i] : null), hasGap = gaps.some(v => v != null);
  let hi = 1;
  for (const arr of [o.cy, o.stly, o.y2]) for (const v of arr) if (v != null && v > hi) hi = v;
  // a year that finishes a little over target keeps the 0-100% gridlines and gets headroom, not an axis to 150%
  const ticks = hi <= 1.12 ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(0, hi, 4);
  hi = hi <= 1.12 ? Math.ceil(hi * 20 - 1e-9) / 20 : ticks[ticks.length - 1];
  const split = o.wide && (o.layout === 'side' || o.layout === 'stack');
  return (split ? paceSplit : (o.wide && o.layout === 'bars') ? paceBars : paceOverlay)(o, W, N, gaps, hasGap, ticks, hi);
};

/* Stacked bars. o = { labels, series:[{name,color,values}], pct, yFmt, tipFmt, line:{name,values,fmt,color}, fadeFrom, width, height } */
C.stack = function (o) {
  const W = o.width || 640, H = o.height || 250, pL = 58, pR = o.line ? 50 : 16, pT = 16, pB = 30;
  const iw = W - pL - pR, ih = H - pT - pB, N = o.labels.length;
  const fmt = o.pct ? C.axisPct : (o.yFmt || C.axisMoney), tf = o.tipFmt || o.yFmt || C.axisMoney;
  const tot = o.labels.map((_, i) => o.series.reduce((s, r) => s + Math.max(0, r.values[i] || 0), 0));
  const hi0 = o.pct ? 1 : Math.max(1e-9, ...tot);
  const ticks = o.pct ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(0, hi0, 4), hi = ticks[ticks.length - 1];
  const y = v => pT + (1 - v / hi) * ih, bw = iw / N, barW = Math.min(46, bw * 0.68);
  let g = grid(ticks, y, pL, W - pR, fmt), bars = '';
  const every = o.every || Math.max(1, Math.ceil(N / 9));
  for (let i = 0; i < N; i++) {
    const cx = pL + bw * i + bw / 2;
    if (i % every === 0) g += xLabel(cx, H, o.labels[i]);
    let run = 0;
    const fade = o.fadeFrom != null && i >= o.fadeFrom ? ' opacity="0.45"' : '';
    const tipRows = [];
    for (const s of o.series) {
      const raw = Math.max(0, s.values[i] || 0), v = o.pct ? (tot[i] ? raw / tot[i] : 0) : raw;
      if (raw > 0) tipRows.push(s.name + ': ' + tf(raw) + (o.pct || o.series.length > 1 ? ' (' + U.pct(tot[i] ? raw / tot[i] : 0, 0) + ')' : ''));
      if (v <= 0) continue;
      const y1 = y(run + v), h = Math.max(0.6, y(run) - y1);
      bars += '<rect x="' + (cx - barW / 2) + '" y="' + y1 + '" width="' + barW + '" height="' + h + '" fill="' + s.color + '"' + fade + '/>';
      run += v;
    }
    bars += '<rect x="' + (cx - bw / 2) + '" y="' + pT + '" width="' + bw + '" height="' + ih + '" fill="transparent"' +
      tip(o.labels[i] + '\n' + tipRows.join('\n') + (o.line && o.line.values[i] != null ? '\n' + o.line.name + ': ' + o.line.fmt(o.line.values[i]) : '')) + '/>';
  }
  let line = '';
  if (o.line) {
    const vals = o.line.values.filter(v => v != null), lt = niceTicks(0, Math.max(1e-9, ...vals), 4), lhi = lt[lt.length - 1];
    const ly = v => pT + (1 - v / lhi) * ih;
    for (const tv of lt) line += '<text x="' + (W - pR + 7) + '" y="' + (ly(tv) + 4) + '" font-size="' + FS + '" fill="' + o.line.color + '">' + o.line.fmt(tv) + '</text>';
    let d = '', pen = false, dots = '';
    o.line.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const cx = pL + bw * i + bw / 2;
      d += (pen ? 'L' : 'M') + cx.toFixed(1) + ' ' + ly(v).toFixed(1) + ' ';
      pen = true;
      dots += '<circle cx="' + cx + '" cy="' + ly(v) + '" r="2.6" fill="' + o.line.color + '"/>';
    });
    line += '<path d="' + d + '" fill="none" stroke="' + o.line.color + '" stroke-width="1.8"/>' + dots;
  }
  return frame(W, H, o.label, g + line + bars);
};

/* Signed bars. o = { labels, values, yFmt, tipFmt, tips, fadeFrom, markAt, width, height } */
C.signed = function (o) {
  const W = o.width || 640, H = o.height || 240, pL = 58, pR = 16, pT = 20, pB = 30;
  const iw = W - pL - pR, ih = H - pT - pB, N = o.labels.length, fmt = o.yFmt || C.axisMoney;
  const ticks = niceTicks(Math.min(0, ...o.values), Math.max(0, ...o.values), 4), lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = v => pT + (1 - (v - lo) / (hi - lo)) * ih, bw = iw / N, barW = Math.min(30, bw * 0.66);
  let g = grid(ticks, y, pL, W - pR, fmt), bars = '';
  g += '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--axis)" stroke-width="1.25"/>';
  const every = Math.max(1, Math.ceil(N / 8));
  o.values.forEach((v, i) => {
    const cx = pL + bw * i + bw / 2, top = y(Math.max(0, v)), h = Math.max(1, Math.abs(y(v) - y(0)));
    if (i % every === 0) g += xLabel(cx, H, o.labels[i]);
    bars += '<rect x="' + (cx - barW / 2) + '" y="' + top + '" width="' + barW + '" height="' + h + '" rx="2" fill="' + (v >= 0 ? 'var(--series-cash)' : 'var(--crit)') + '"' +
      (o.fadeFrom != null && i >= o.fadeFrom ? ' opacity="0.45"' : '') + '/>' +
      '<rect x="' + (cx - bw / 2) + '" y="' + pT + '" width="' + bw + '" height="' + ih + '" fill="transparent"' + tip(o.labels[i] + ': ' + (o.tipFmt || fmt)(v) + (o.tips ? '\n' + o.tips[i] : '')) + '/>';
  });
  if (o.markAt != null) {
    const mx = pL + bw * o.markAt;
    g += '<line x1="' + mx + '" x2="' + mx + '" y1="' + pT + '" y2="' + (pT + ih) + '" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3"/>' +
         '<text x="' + (mx - 5) + '" y="' + (pT - 5) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">actual</text>' +
         '<text x="' + (mx + 5) + '" y="' + (pT - 5) + '" font-size="' + FS + '" fill="var(--ink-2)">scheduled</text>';
  }
  return frame(W, H, o.label, g + bars);
};

/* Waterfall. steps = [{key,label,kind:'total'|'delta',value,tip}]; o = { focus, label }.
   The two totals dwarf the steps between them, so the axis is cut. The cut is drawn
   on the total bars and stated under the chart: the totals show a level, not a length. */
C.waterfall = function (steps, o) {
  o = o || {};
  let run = 0;
  const geom = steps.map(s => {
    if (s.kind === 'total') { run = s.value; return { ...s, base: Math.min(0, s.value), top: Math.max(0, s.value) }; }
    const start = run; run += s.value;
    return { ...s, base: Math.min(start, run), top: Math.max(start, run) };
  });
  const edges = geom.flatMap(s => s.kind === 'total' ? [s.value] : [s.base, s.top]);
  const minE = Math.min(...edges), maxE = Math.max(...edges), pad = (maxE - minE) * 0.35 || Math.abs(maxE) * 0.1 || 1;
  const floor = minE > 0 ? Math.max(0, minE - pad) : Math.min(0, minE - pad * 0.2);
  const ticks = niceTicks(floor, maxE, 4), lo = ticks[0], hi = ticks[ticks.length - 1], cutAxis = lo > 0;
  const W = 700, H = 300, pL = 60, pR = 12, pT = 22, pB = cutAxis ? 72 : 52;       // room for two-line labels
  const iw = W - pL - pR, ih = H - pT - pB;
  const y = v => pT + (1 - (Math.max(lo, v) - lo) / (hi - lo)) * ih;
  const bw = iw / geom.length, barW = Math.min(50, bw * 0.66);
  let g = grid(ticks, y, pL, W - pR, C.axisMoney), bars = '', prev = null;
  geom.forEach((s, i) => {
    const cx = pL + bw * i + bw / 2, x0 = cx - barW / 2, total = s.kind === 'total';
    const yTop = total ? y(s.value) : y(s.top), yBot = total ? y(lo) : y(s.base);
    const h = Math.max(1.5, yBot - yTop);
    const fill = total ? (i === 0 ? 'var(--c1)' : 'var(--outlook)') : (s.value >= 0 ? 'var(--good)' : 'var(--crit)');
    const dim = o.focus && !total && s.key !== o.focus ? ' dim' : '';
    if (prev !== null && !total) {
      const cy = y(s.value >= 0 ? s.base : s.top);
      bars += '<line x1="' + prev + '" x2="' + x0 + '" y1="' + cy + '" y2="' + cy + '" stroke="var(--axis)" stroke-width="1" stroke-dasharray="2 2"/>';
    }
    let brk = '';
    if (total && cutAxis && h > 26) {
      const by = yBot - 11, q = barW / 4;
      brk = '<polyline points="' + [0, 1, 2, 3, 4].map(j => (x0 - 1 + j * q + (j === 4 ? 2 : 0)) + ',' + (by + (j % 2 ? -4 : 4))).join(' ') +
        '" fill="none" stroke="var(--chart-surface)" stroke-width="4" stroke-linejoin="round"/>';
    }
    bars += '<g class="wf-bar' + dim + '" data-act="focus:' + s.key + '"' + tip(s.label + ': ' + (total ? U.money(s.value) : U.signedMoney(s.value)) + (s.tip ? '\n' + s.tip : '')) + '>' +
      '<rect x="' + x0 + '" y="' + yTop + '" width="' + barW + '" height="' + h + '" rx="3" fill="' + fill + '"/>' + brk +
      '<text x="' + cx + '" y="' + (yTop - 6) + '" text-anchor="middle" font-size="12" font-weight="650" fill="var(--ink)">' +
        (total ? U.money(s.value) : U.signedMoney(s.value)) + '</text>' +
      s.label.split(' ').map((word, j) => '<text x="' + cx + '" y="' + (pT + ih + 17 + j * 13) + '" text-anchor="middle" font-size="' + FS + '" fill="var(--ink-2)">' + word + '</text>').join('') + '</g>';
    prev = x0 + barW;
  });
  const note = cutAxis ? '<text x="' + pL + '" y="' + (H - 10) + '" font-size="' + FS + '" fill="var(--ink-2)">Axis cut below ' + C.axisMoney(lo) +
    ': the two totals mark a level, not a length. The steps between them are to scale.</text>' : '';
  return frame(W, H, o.label || 'Profit bridge', g + bars + note);
};

/* ---------------------------------------------------------------------
   CASH RIVER. Sources on the left flow into one "cash moved" bar and out
   to where the cash went. Band thickness is proportional to the amount on
   both sides, so the picture conserves cash exactly as the engine does.
   --------------------------------------------------------------------- */
C.river = function (sources, uses, o) {
  o = o || {};
  const W = 980, H = o.height || 410, pT = 36, pB = 14, nodeW = 8;
  const xL = 18, xC = Math.round(W * 0.40), xR = W - 18 - nodeW;
  const total = Math.max(1e-9, sources.reduce((s, x) => s + x.value, 0));
  const MINH = 5, GAP_L = 14, GAP_R = 10;
  const stackH = (items, gap, k) => items.reduce((s, x) => s + Math.max(MINH, x.value * k), 0) + gap * (items.length - 1);
  let k = (H - pT - pB) / total;
  for (let i = 0; i < 40 && Math.max(stackH(sources, GAP_L, k), stackH(uses, GAP_R, k)) > H - pT - pB; i++) k *= 0.97;

  const place = (items, gap) => {
    let y = pT + (H - pT - pB - stackH(items, gap, k)) / 2;
    return items.map(x => { const h = Math.max(MINH, x.value * k), r = { ...x, y, h }; y += h + gap; return r; });
  };
  const L = place(sources, GAP_L), R = place(uses, GAP_R);
  const cH = total * k, cY = pT + (H - pT - pB - cH) / 2;
  const colour = x => x.kind === 'reserve' ? 'var(--series-cash)' : x.kind === 'in' ? 'var(--c1)' : 'var(--c8)';

  const band = (x0, a0, a1, x1, b0, b1) => {
    const mx = (x0 + x1) / 2;
    return 'M' + x0 + ' ' + a0.toFixed(1) + ' C' + mx + ' ' + a0.toFixed(1) + ' ' + mx + ' ' + b0.toFixed(1) + ' ' + x1 + ' ' + b0.toFixed(1) +
           ' L' + x1 + ' ' + b1.toFixed(1) + ' C' + mx + ' ' + b1.toFixed(1) + ' ' + mx + ' ' + a1.toFixed(1) + ' ' + x0 + ' ' + a1.toFixed(1) + ' Z';
  };
  // Each dot stands for a fixed amount of cash, so a stream gains dots when the cockpit
  // pushes more through it. Every stream draws from its own seeded sequence: a stream
  // that grows keeps the dots it had and adds new ones, rather than reshuffling.
  const perDot = o.perDot || total / 480;
  const motes = (x0, a0, a1, x1, b0, b1, value, fill, name) => {
    if (o.still) return '';
    let seed = 7;
    for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) >>> 0;
    const rnd = U.rng(seed), n = Math.max(1, Math.min(320, Math.round(value / perDot)));
    let out = '';
    for (let i = 0; i < n; i++) {
      const f = 0.08 + rnd() * 0.84, ya = a0 + (a1 - a0) * f, yb = b0 + (b1 - b0) * f, mx = (x0 + x1) / 2;
      const dur = (5 + rnd() * 6).toFixed(1), delay = (rnd() * 11).toFixed(1);
      out += '<circle class="mote" r="0.85" fill="' + fill + '" opacity="0.75"><animateMotion dur="' + dur + 's" begin="-' + delay + 's" repeatCount="indefinite" path="M' +
        x0 + ' ' + ya.toFixed(1) + ' C' + mx + ' ' + ya.toFixed(1) + ' ' + mx + ' ' + yb.toFixed(1) + ' ' + x1 + ' ' + yb.toFixed(1) + '"/></circle>';
    }
    return out;
  };
  const share = v => U.money(v) + ' · ' + U.pct(v / total, 0) + ' of cash moved';

  let flows = '', dots = '', nodes = '', labels = '';
  let cy = cY;
  for (const s of L) {
    const seg = s.value * k;
    flows += '<path d="' + band(xL + nodeW, s.y, s.y + s.h, xC, cy, cy + seg) + '" fill="' + colour(s) + '" opacity="0.22"' + tip(s.name + '\n' + share(s.value)) + '/>';
    dots += motes(xL + nodeW, s.y, s.y + s.h, xC, cy, cy + seg, s.value, colour(s), 'in:' + s.name);
    nodes += '<rect x="' + xL + '" y="' + s.y + '" width="' + nodeW + '" height="' + s.h + '" rx="2" fill="' + colour(s) + '"/>';
    labels += '<text x="' + (xL + nodeW + 10) + '" y="' + (s.y + s.h / 2 + 4) + '" font-size="12.5" fill="var(--ink)" pointer-events="none">' + U.esc(s.name) +
      ' <tspan fill="var(--ink-2)" font-size="12">' + U.money(s.value) + '</tspan></text>';
    cy += seg;
  }
  cy = cY;
  for (const u of R) {
    const seg = u.value * k;
    flows += '<path d="' + band(xC + nodeW, cy, cy + seg, xR, u.y, u.y + u.h) + '" fill="' + colour(u) + '" opacity="' + (u.kind === 'reserve' ? 0.3 : 0.2) + '"' + tip(u.name + '\n' + share(u.value)) + '/>';
    dots += motes(xC + nodeW, cy, cy + seg, xR, u.y, u.y + u.h, u.value, u.kind === 'reserve' ? 'var(--series-cash)' : 'var(--ink-2)', 'out:' + u.name);
    nodes += '<rect x="' + xR + '" y="' + u.y + '" width="' + nodeW + '" height="' + u.h + '" rx="2" fill="' + colour(u) + '"/>';
    labels += '<text x="' + (xR - 9) + '" y="' + (u.y + u.h / 2 + 4) + '" text-anchor="end" font-size="12.5" fill="var(--ink)" pointer-events="none">' + U.esc(u.name) +
      ' <tspan fill="var(--ink-2)" font-size="12">' + U.money(u.value) + '</tspan></text>';
    cy += seg;
  }
  nodes += '<rect x="' + xC + '" y="' + cY + '" width="' + nodeW + '" height="' + cH + '" rx="2" fill="var(--ink-2)"/>';
  labels += '<text x="' + (xC + nodeW / 2) + '" y="' + (cY - 10) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--ink)">Cash moved ' + U.money(total) + '</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cash river: where cash came from and where it went">' + flows + dots + nodes + labels + '</svg>';
};

C.legend = items => '<div class="legend">' + items.map(i =>
  '<span class="chip"><span class="swatch' + (i.dash ? ' dash' : '') + '" style="' + (i.dash ? 'border-color:' : 'background:') + i.color + '"></span>' + U.esc(i.name) + '</span>').join('') + '</div>';
})(typeof globalThis !== 'undefined' ? globalThis : this);
