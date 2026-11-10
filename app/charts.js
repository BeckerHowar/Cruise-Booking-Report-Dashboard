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

const frame = (W, H, label, inner, attrs) =>
  '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img"' + (attrs || '') + ' aria-label="' + U.esc(label || 'chart') + '">' +
  '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="var(--chart-surface)" rx="6"/>' + inner + '</svg>';

function grid(ticks, y, x0, x1, fmt) {
  let g = '';
  for (const tv of ticks) {
    g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + y(tv) + '" y2="' + y(tv) + '" stroke="var(--grid)" stroke-width="1"/>' +
         '<text x="' + (x0 - 7) + '" y="' + (y(tv) + 4) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">' + fmt(tv) + '</text>';
  }
  return g;
}
const xLabel = (x, H, text) => '<text x="' + x + '" y="' + (H - 9) + '" text-anchor="middle" font-size="' + FS + '" fill="var(--ink-2)">' + text + '</text>';

/* Lines. o = { labels, series:[{name,color,values,dashed,width,live}], yFmt, tipFmt, every, markAt, markLabel, zero, width, height, live }
   With o.live = { year, denom, start }, the series flagged live, its end dot and the marker are tagged, and the
   plot geometry is written onto the svg, so replay can extend that one line in place instead of redrawing the chart. */
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
    g += '<g class="live-mark" data-x="' + mx.toFixed(1) + '"><line x1="' + mx + '" x2="' + mx + '" y1="' + pT + '" y2="' + (pT + ih) + '" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3" opacity="0.8"/>' +
         '<text x="' + (mx - 5) + '" y="' + (pT + 11) + '" text-anchor="end" font-size="' + FS + '" fill="var(--ink-2)">' + (o.markLabel || '') + '</text></g>';
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
    const live = o.live && s.live;
    marks += '<path' + (live ? ' class="live-line" data-base="' + d + '"' : '') + ' d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '" stroke-linejoin="round"' +
      (s.dashed ? ' stroke-dasharray="' + s.dashed + '" opacity="0.9"' : '') + '/>';
    if (!s.dashed) marks += '<circle' + (live ? ' class="live-dot"' : '') + ' cx="' + x(lastI) + '" cy="' + y(s.values[lastI]) + '" r="3.4" fill="' + s.color + '" stroke="var(--chart-surface)" stroke-width="1.8"/>';
  }
  let hits = '';
  const step = N > 1 ? iw / (N - 1) : iw;
  for (let i = 0; i < N; i++) {
    const rows = o.series.filter(s => s.values[i] != null).map(s => s.name + ': ' + tf(s.values[i])).join('\n');
    if (rows) hits += '<rect x="' + (x(i) - step / 2) + '" y="' + pT + '" width="' + step + '" height="' + ih + '" fill="transparent"' + tip(o.labels[i] + '\n' + rows) + '/>';
  }
  const L = o.live;
  return frame(W, H, o.label, g + marks + hits, L ? ' class="livepace" data-year="' + L.year + '" data-denom="' + L.denom + '" data-start="' + L.start + '" data-n="' + N +
    '" data-pl="' + pL + '" data-iw="' + iw + '" data-pt="' + pT + '" data-ih="' + ih + '" data-lo="' + lo + '" data-hi="' + hi + '"' : '');
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

/* ---------------------------------------------------------------------
   FLEET FILL MAP. One cell per voyage: a row per ship, placed by sail date
   and as wide as the voyage is long. Shade is the share of target booked
   (or, in pace mode, how far ahead or behind the booking curve it is).
   Voyages left of the as-of line have sailed and are final.
   o = { rows:[ship index], ships:[names], regions:[names], asOf, mode }
   --------------------------------------------------------------------- */
C.fillShade = function (pct, pace, sailed, mode) {
  if (pct == null) return 'none';
  if (mode === 'pace') {
    const k = Math.round(U.clamp(Math.abs(pace) / (sailed ? 0.10 : 0.15), 0, 1) * 82);
    return 'color-mix(in srgb, var(' + (pace >= 0 ? '--good' : '--crit') + ') ' + k + '%, var(--surface-2))';
  }
  return 'color-mix(in srgb, var(--accent) ' + Math.round(U.clamp(pct, 0, 1) * 92) + '%, var(--surface-2))';
};
C.fillMap = function (M, o) {
  const W = 1120, pL = 86, pR = 14, pT = 52, rowH = 42, gap = 12;      // two label lines above the rows: the as-of marker, then the months
  const H = pT + o.rows.length * (rowH + gap) + 6, iw = W - pL - pR;
  const x = d => pL + (d - M.t0) / (M.t1 - M.t0) * iw;
  let g = '';
  for (let m = M.from; m <= M.to + 1; m++) {
    const xm = x(U.miStart(m)), jan = m % 12 === 0;
    g += '<line x1="' + xm + '" x2="' + xm + '" y1="' + (pT - 8) + '" y2="' + (H - 6) + '" stroke="' + (jan ? 'var(--axis)' : 'var(--grid)') + '" stroke-width="' + (jan ? 1.25 : 1) + '"/>';
    if (m <= M.to && (m - M.from) % 3 === 0) g += '<text x="' + (xm + 4) + '" y="' + (pT - 12) + '" font-size="' + FS + '" fill="var(--ink-2)">' + U.miLabel(m) + '</text>';
  }
  o.rows.forEach((s, r) => {
    g += '<text x="' + (pL - 10) + '" y="' + (pT + r * (rowH + gap) + rowH / 2 + 4) + '" text-anchor="end" font-size="12.5" font-weight="600" fill="var(--ink)">' + U.esc(o.ships[s]) + '</text>';
  });
  let cells = '';
  for (const c of M.cells) {
    const r = o.rows.indexOf(c.v.ship);
    if (r < 0) continue;
    const x0 = Math.max(pL, x(c.v.sail)), x1 = Math.min(W - pR, x(c.v.end)), w = Math.max(2, x1 - x0 - 1.2), y = pT + r * (rowH + gap);
    const lines = [c.v.code + ' · ' + o.ships[c.v.ship] + ' · ' + o.regions[c.v.region],
      'Sails ' + U.shortDate(c.v.sail) + ' · ' + c.v.days + ' days' + (c.v.charter ? ' · charter' : '') + (c.v.nonRev ? ' · non-revenue' : '')];
    if (c.pct != null) {
      lines.push('Booked ' + U.money(c.tix) + ' of ' + U.money(c.target) + ' target (' + U.pct(c.pct, 0) + ')');
      lines.push(c.sailed ? 'Sailed — final, ' + U.pp(c.pace, 0) + ' against target'
                          : 'Curve says ' + U.pct(c.expected, 0) + ' by now · pace ' + U.pp(c.pace, 0) + ' · outlook ' + U.money(c.outlook));
      if (c.flagged) lines.push('On the watchlist: projected to finish 5% or more short');
    } else lines.push('No target: sailed without revenue guests');
    cells += '<rect data-v="' + c.v.i + '" x="' + x0.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + rowH + '" rx="2" style="fill:' + C.fillShade(c.pct, c.pace, c.sailed, o.mode) + '" stroke="' +
      (c.flagged ? 'var(--crit)' : 'var(--hairline-2)') + '" stroke-width="' + (c.flagged ? 1.8 : 0.8) + '"' + (c.pct == null ? ' stroke-dasharray="2 2"' : '') + tip(lines.join('\n')) + '/>';
  }
  // The marker is one group so replay can slide it without redrawing the map.
  const xa = x(o.asOf + 1);
  const mark = '<g class="fm-mark" data-x="' + xa.toFixed(1) + '"' + ((xa >= pL && xa <= W - pR) ? '' : ' visibility="hidden"') + '>' +
    '<line x1="' + xa + '" x2="' + xa + '" y1="' + (pT - 44) + '" y2="' + (H - 4) + '" stroke="var(--ink)" stroke-width="1.6"/>' +
    '<text x="' + (xa - 7) + '" y="' + (pT - 32) + '" text-anchor="end" font-size="' + FS + '" font-weight="700" fill="var(--ink)">sailed</text>' +
    '<text class="fm-date" x="' + (xa + 7) + '" y="' + (pT - 32) + '" font-size="' + FS + '" font-weight="700" fill="var(--ink)">still filling · as of ' + U.shortDate(o.asOf) + '</text></g>';
  return '<svg class="fillmap" viewBox="0 0 ' + W + ' ' + H + '" role="img" data-mode="' + o.mode + '" data-t0="' + M.t0 + '" data-t1="' + M.t1 + '" data-pl="' + pL + '" data-iw="' + iw +
    '" aria-label="Fleet fill map: every voyage by ship and sail date, shaded by ' + (o.mode === 'pace' ? 'pace against the booking curve' : 'share of target booked') + '">' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="var(--chart-surface)" rx="6"/>' + g + cells + mark + '</svg>';
};

C.legend = items => '<div class="legend">' + items.map(i =>
  '<span class="chip"><span class="swatch' + (i.dash ? ' dash' : '') + '" style="' + (i.dash ? 'border-color:' : 'background:') + i.color + '"></span>' + U.esc(i.name) + '</span>').join('') + '</div>';
})(typeof globalThis !== 'undefined' ? globalThis : this);
