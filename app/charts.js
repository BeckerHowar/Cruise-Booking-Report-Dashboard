/* Hand-rolled SVG charts. Every function returns a string; nothing here touches
   the DOM. Hover detail uses native <title> on hit areas so the charts need no
   per-chart event wiring. All drawn at a real aspect ratio — never stretched. */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util;
const C = CBR.charts = {};

C.PAL = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

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

const frame = (W, H, label, inner) =>
  '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + U.esc(label || 'chart') + '">' +
  '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="var(--chart-surface)" rx="6"/>' + inner + '</svg>';

function grid(ticks, y, x0, x1, fmt) {
  let g = '';
  for (const tv of ticks) {
    g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + y(tv) + '" y2="' + y(tv) + '" stroke="var(--grid)" stroke-width="1"/>' +
         '<text x="' + (x0 - 7) + '" y="' + (y(tv) + 3.5) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + fmt(tv) + '</text>';
  }
  return g;
}

/* Lines. o = { labels, series:[{name,color,values,dashed,width}], yFmt, tipFmt, every, markAt, markLabel, zero, height } */
C.lines = function (o) {
  const W = o.width || 640, H = o.height || 240, pL = o.padL || 52, pR = 14, pT = 14, pB = 26;
  const iw = W - pL - pR, ih = H - pT - pB, N = o.labels.length, fmt = o.yFmt || C.axisMoney, tip = o.tipFmt || fmt;
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
  for (let i = 0; i < N; i += every) g += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + o.labels[i] + '</text>';
  if (o.markAt != null && o.markAt >= 0 && o.markAt < N) {
    const mx = x(o.markAt);
    g += '<line x1="' + mx + '" x2="' + mx + '" y1="' + pT + '" y2="' + (pT + ih) + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3" opacity="0.8"/>' +
         '<text x="' + (mx - 4) + '" y="' + (pT + 10) + '" text-anchor="end" font-size="9" fill="var(--muted)">' + (o.markLabel || '') + '</text>';
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
      (s.dashed ? ' stroke-dasharray="' + s.dashed + '" opacity="0.85"' : '') + '/>';
    if (!s.dashed) marks += '<circle cx="' + x(lastI) + '" cy="' + y(s.values[lastI]) + '" r="3.2" fill="' + s.color + '" stroke="var(--chart-surface)" stroke-width="1.8"/>';
  }
  let hits = '';
  const step = N > 1 ? iw / (N - 1) : iw;
  for (let i = 0; i < N; i++) {
    const rows = o.series.filter(s => s.values[i] != null).map(s => s.name + ': ' + tip(s.values[i])).join('\n');
    if (rows) hits += '<rect x="' + (x(i) - step / 2) + '" y="' + pT + '" width="' + step + '" height="' + ih + '" fill="transparent"><title>' + U.esc(o.labels[i] + '\n' + rows) + '</title></rect>';
  }
  return frame(W, H, o.label, g + marks + hits);
};

/* Stacked bars. o = { labels, series:[{name,color,values}], pct, yFmt, tipFmt, line:{name,values,fmt,color}, fadeFrom, height } */
C.stack = function (o) {
  const W = o.width || 640, H = o.height || 240, pL = 52, pR = o.line ? 44 : 14, pT = 14, pB = 26;
  const iw = W - pL - pR, ih = H - pT - pB, N = o.labels.length;
  const fmt = o.pct ? C.axisPct : (o.yFmt || C.axisMoney), tip = o.tipFmt || o.yFmt || C.axisMoney;
  const tot = o.labels.map((_, i) => o.series.reduce((s, r) => s + Math.max(0, r.values[i] || 0), 0));
  const hi0 = o.pct ? 1 : Math.max(1e-9, ...tot);
  const ticks = o.pct ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(0, hi0, 4), hi = ticks[ticks.length - 1];
  const y = v => pT + (1 - v / hi) * ih, bw = iw / N, barW = Math.min(46, bw * 0.68);
  let g = grid(ticks, y, pL, W - pR, fmt), bars = '';
  const every = o.every || Math.max(1, Math.ceil(N / 9));
  for (let i = 0; i < N; i++) {
    const cx = pL + bw * i + bw / 2;
    if (i % every === 0) g += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + o.labels[i] + '</text>';
    let run = 0;
    const fade = o.fadeFrom != null && i >= o.fadeFrom ? ' opacity="0.45"' : '';
    const tipRows = [];
    for (const s of o.series) {
      const raw = Math.max(0, s.values[i] || 0), v = o.pct ? (tot[i] ? raw / tot[i] : 0) : raw;
      if (raw > 0) tipRows.push(s.name + ': ' + tip(raw) + (o.pct || o.series.length > 1 ? ' (' + U.pct(tot[i] ? raw / tot[i] : 0, 0) + ')' : ''));
      if (v <= 0) continue;
      const y1 = y(run + v), h = Math.max(0.6, y(run) - y1);
      bars += '<rect x="' + (cx - barW / 2) + '" y="' + y1 + '" width="' + barW + '" height="' + h + '" fill="' + s.color + '"' + fade + '/>';
      run += v;
    }
    bars += '<rect x="' + (cx - bw / 2) + '" y="' + pT + '" width="' + bw + '" height="' + ih + '" fill="transparent"><title>' +
      U.esc(o.labels[i] + '\n' + tipRows.join('\n') + (o.line && o.line.values[i] != null ? '\n' + o.line.name + ': ' + o.line.fmt(o.line.values[i]) : '')) + '</title></rect>';
  }
  let line = '';
  if (o.line) {
    const vals = o.line.values.filter(v => v != null), lt = niceTicks(0, Math.max(1e-9, ...vals), 4), lhi = lt[lt.length - 1];
    const ly = v => pT + (1 - v / lhi) * ih;
    for (const tv of lt) line += '<text x="' + (W - pR + 6) + '" y="' + (ly(tv) + 3.5) + '" font-size="10" fill="' + o.line.color + '">' + o.line.fmt(tv) + '</text>';
    let d = '', pen = false;
    o.line.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const cx = pL + bw * i + bw / 2;
      d += (pen ? 'L' : 'M') + cx.toFixed(1) + ' ' + ly(v).toFixed(1) + ' ';
      pen = true;
      line += '<circle cx="' + cx + '" cy="' + ly(v) + '" r="2.4" fill="' + o.line.color + '"/>';
    });
    line = '<path d="' + d + '" fill="none" stroke="' + o.line.color + '" stroke-width="1.8"/>' + line;
  }
  return frame(W, H, o.label, g + line + bars);
};

/* Signed bars. o = { labels, values, yFmt, fadeFrom, markAt, markLabel, height } */
C.signed = function (o) {
  const W = o.width || 640, H = o.height || 220, pL = 52, pR = 14, pT = 16, pB = 26;
  const iw = W - pL - pR, ih = H - pT - pB, N = o.labels.length, fmt = o.yFmt || C.axisMoney;
  const ticks = niceTicks(Math.min(0, ...o.values), Math.max(0, ...o.values), 4), lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = v => pT + (1 - (v - lo) / (hi - lo)) * ih, bw = iw / N, barW = Math.min(30, bw * 0.66);
  let g = grid(ticks, y, pL, W - pR, fmt), bars = '';
  g += '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--axis)" stroke-width="1.25"/>';
  const every = Math.max(1, Math.ceil(N / 10));
  o.values.forEach((v, i) => {
    const cx = pL + bw * i + bw / 2, top = y(Math.max(0, v)), h = Math.max(1, Math.abs(y(v) - y(0)));
    if (i % every === 0) g += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + o.labels[i] + '</text>';
    bars += '<rect x="' + (cx - barW / 2) + '" y="' + top + '" width="' + barW + '" height="' + h + '" rx="2" fill="' + (v >= 0 ? 'var(--series-cash)' : 'var(--crit)') + '"' +
      (o.fadeFrom != null && i >= o.fadeFrom ? ' opacity="0.45"' : '') + '><title>' + U.esc(o.labels[i] + ': ' + (o.tipFmt || fmt)(v) + (o.tips ? '\n' + o.tips[i] : '')) + '</title></rect>';
  });
  if (o.markAt != null) {
    const mx = pL + bw * o.markAt;
    g += '<line x1="' + mx + '" x2="' + mx + '" y1="' + pT + '" y2="' + (pT + ih) + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/>' +
         '<text x="' + (mx - 4) + '" y="' + (pT + 6) + '" text-anchor="end" font-size="9" fill="var(--muted)">actual</text>' +
         '<text x="' + (mx + 4) + '" y="' + (pT + 6) + '" font-size="9" fill="var(--muted)">scheduled</text>';
  }
  return frame(W, H, o.label, g + bars);
};

/* Waterfall. steps = [{key,label,kind:'total'|'delta',value,tip}]; o = { focus, compact, label } */
C.waterfall = function (steps, o) {
  o = o || {};
  let run = 0;
  const geom = steps.map(s => {
    if (s.kind === 'total') { run = s.value; return { ...s, base: Math.min(0, s.value), top: Math.max(0, s.value) }; }
    const start = run; run += s.value;
    return { ...s, base: Math.min(start, run), top: Math.max(start, run) };
  });
  // Totals dwarf the deltas, so the axis starts just under the lowest bar edge rather than at zero.
  const edges = geom.flatMap(s => s.kind === 'total' ? [s.value] : [s.base, s.top]);
  const minE = Math.min(...edges), maxE = Math.max(...edges), pad = (maxE - minE) * 0.35 || Math.abs(maxE) * 0.1 || 1;
  const floor = minE > 0 ? Math.max(0, minE - pad) : Math.min(0, minE - pad * 0.2);
  const ticks = niceTicks(floor, maxE, 4), lo = ticks[0], hi = ticks[ticks.length - 1];
  const W = o.compact ? 520 : 760, H = o.compact ? 210 : 260, pL = 56, pR = 12, pT = 18, pB = 40;
  const iw = W - pL - pR, ih = H - pT - pB;
  const y = v => pT + (1 - (Math.max(lo, v) - lo) / (hi - lo)) * ih;
  const bw = iw / geom.length, barW = Math.min(o.compact ? 36 : 54, bw * 0.64);
  let g = grid(ticks, y, pL, W - pR, C.axisMoney), bars = '', prev = null;
  geom.forEach((s, i) => {
    const cx = pL + bw * i + bw / 2, x0 = cx - barW / 2;
    const yTop = s.kind === 'total' ? y(s.value) : y(s.top), yBot = s.kind === 'total' ? y(lo) : y(s.base);
    const h = Math.max(1.5, yBot - yTop);
    const fill = s.kind === 'total' ? (i === 0 ? 'var(--c1)' : 'var(--c5)') : (s.value >= 0 ? 'var(--good)' : 'var(--crit)');
    const dim = o.focus && s.kind === 'delta' && s.key !== o.focus ? ' dim' : '';
    if (prev !== null && s.kind === 'delta') {
      const cy = y(s.value >= 0 ? s.base : s.top);
      bars += '<line x1="' + prev + '" x2="' + x0 + '" y1="' + cy + '" y2="' + cy + '" stroke="var(--axis)" stroke-width="1" stroke-dasharray="2 2"/>';
    }
    bars += '<g class="wf-bar' + dim + '" data-act="focus:' + s.key + '">' +
      '<rect x="' + x0 + '" y="' + yTop + '" width="' + barW + '" height="' + h + '" rx="3" fill="' + fill + '"/>' +
      '<text x="' + cx + '" y="' + (yTop - 5) + '" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--ink)">' +
        (s.kind === 'total' ? U.money(s.value) : U.signedMoney(s.value)) + '</text>' +
      '<text x="' + cx + '" y="' + (H - 22) + '" text-anchor="middle" font-size="10.5" fill="var(--ink-2)">' + s.label + '</text>' +
      '<title>' + U.esc(s.label + ': ' + U.money(s.value) + (s.tip ? '\n' + s.tip : '')) + '</title></g>';
    prev = x0 + barW;
  });
  const cut = lo > 0 ? '<text x="' + pL + '" y="' + (H - 6) + '" font-size="10" fill="var(--muted)">Axis starts at ' + C.axisMoney(lo) + ' so the bars between the totals are readable.</text>' : '';
  return frame(W, H, o.label || 'Profit bridge', g + bars + cut);
};

/* ---------------------------------------------------------------------
   CASH RIVER. Sources on the left flow into one "cash moved" bar and out
   to where the cash went. Band thickness is proportional to the amount on
   both sides, so the picture conserves cash exactly as the engine does.
   --------------------------------------------------------------------- */
C.river = function (sources, uses, o) {
  o = o || {};
  const W = 980, H = o.height || 400, pT = 34, pB = 14, nodeW = 8;
  const xL = 18, xC = Math.round(W * 0.40), xR = W - 18 - nodeW;
  const total = Math.max(1e-9, sources.reduce((s, x) => s + x.value, 0));
  const MINH = 5, GAP_L = 14, GAP_R = 9;
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
  const rnd = U.rng(7);
  const motes = (x0, a0, a1, x1, b0, b1, value, fill) => {
    if (o.still) return '';
    const n = Math.max(1, Math.min(26, Math.round(value / total * 70)));
    let out = '';
    for (let i = 0; i < n; i++) {
      const f = 0.12 + rnd() * 0.76, ya = a0 + (a1 - a0) * f, yb = b0 + (b1 - b0) * f, mx = (x0 + x1) / 2;
      const dur = (5 + rnd() * 6).toFixed(1), delay = (rnd() * 11).toFixed(1);
      out += '<circle r="1.35" fill="' + fill + '" opacity="0.7"><animateMotion dur="' + dur + 's" begin="-' + delay + 's" repeatCount="indefinite" path="M' +
        x0 + ' ' + ya.toFixed(1) + ' C' + mx + ' ' + ya.toFixed(1) + ' ' + mx + ' ' + yb.toFixed(1) + ' ' + x1 + ' ' + yb.toFixed(1) + '"/></circle>';
    }
    return out;
  };

  let flows = '', dots = '', nodes = '', labels = '';
  let cy = cY;
  for (const s of L) {
    const seg = s.value * k;
    flows += '<path d="' + band(xL + nodeW, s.y, s.y + s.h, xC, cy, cy + seg) + '" fill="' + colour(s) + '" opacity="0.22"><title>' + U.esc(s.name + ': ' + U.money(s.value)) + '</title></path>';
    dots += motes(xL + nodeW, s.y, s.y + s.h, xC, cy, cy + seg, s.value, colour(s));
    nodes += '<rect x="' + xL + '" y="' + s.y + '" width="' + nodeW + '" height="' + s.h + '" rx="2" fill="' + colour(s) + '"/>';
    labels += '<text x="' + (xL + nodeW + 10) + '" y="' + (s.y + s.h / 2 + 4) + '" font-size="12" fill="var(--ink)">' + U.esc(s.name) +
      ' <tspan fill="var(--ink-2)" font-size="11.5">' + U.money(s.value) + '</tspan></text>';
    cy += seg;
  }
  cy = cY;
  for (const u of R) {
    const seg = u.value * k;
    flows += '<path d="' + band(xC + nodeW, cy, cy + seg, xR, u.y, u.y + u.h) + '" fill="' + colour(u) + '" opacity="' + (u.kind === 'reserve' ? 0.3 : 0.2) + '"><title>' + U.esc(u.name + ': ' + U.money(u.value)) + '</title></path>';
    dots += motes(xC + nodeW, cy, cy + seg, xR, u.y, u.y + u.h, u.value, u.kind === 'reserve' ? 'var(--series-cash)' : 'var(--ink-2)');
    nodes += '<rect x="' + xR + '" y="' + u.y + '" width="' + nodeW + '" height="' + u.h + '" rx="2" fill="' + colour(u) + '"/>';
    labels += '<text x="' + (xR - 9) + '" y="' + (u.y + u.h / 2 + 4) + '" text-anchor="end" font-size="12" fill="var(--ink)">' + U.esc(u.name) +
      ' <tspan fill="var(--ink-2)" font-size="11.5">' + U.money(u.value) + '</tspan></text>';
    cy += seg;
  }
  nodes += '<rect x="' + xC + '" y="' + cY + '" width="' + nodeW + '" height="' + cH + '" rx="2" fill="var(--c5)"/>';
  labels += '<text x="' + (xC + nodeW / 2) + '" y="' + (cY - 9) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--c5)">Cash moved ' + U.money(total) + '</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cash river: where cash came from and where it went">' + flows + dots + nodes + labels + '</svg>';
};

C.legend = items => '<div class="legend">' + items.map(i =>
  '<span class="chip"><span class="swatch' + (i.dash ? ' dash' : '') + '" style="' + (i.dash ? 'border-color:' : 'background:') + i.color + '"></span>' + U.esc(i.name) + '</span>').join('') + '</div>';
})(typeof globalThis !== 'undefined' ? globalThis : this);
