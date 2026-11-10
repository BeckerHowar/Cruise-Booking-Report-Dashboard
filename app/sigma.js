/* =====================================================================
   SIGMA CONNECTOR. When this page is embedded in a Sigma workbook as a
   plugin, two workbook elements — a bookings table and a voyages table —
   are read through Sigma's plugin API and reshaped into the same dataset
   the simulated generator produces. Columns are matched by name, so the
   contract below is the whole integration surface.

   Sigma delivers element data 25,000 rows at a time. Each element is
   therefore read page by page until it is complete, and nothing is drawn
   from a partial table. A row normally stands for one booking; the
   optional `bookings` column lets one row stand for several identical
   ones (a charter held as a single contract row, say). Dates stay exact
   days: truncating them to weeks or months moves cancellations across
   month ends, and grouping barely shrinks a book this sparse anyway.

   Status: written against @sigmacomputing/plugin 1.3.2 and exercised
   against a simulated host; not yet run inside a workbook.
   ===================================================================== */
(function (root) {
'use strict';
const CBR = root.CBR, U = CBR.util;
const PLUGIN_URL = 'https://cdn.jsdelivr.net/npm/@sigmacomputing/plugin@1.3.2/+esm';
const PAGE = 25000;                 // rows Sigma sends per page
const STALL_MS = 15000;             // how long to wait for a page before concluding there are no more

const CONTRACT = {
  bookings: [
    ['voyage_code', 'text', true, 'Joins to the voyage table'],
    ['suite_tier', 'text', true, 'Premium, Upper or Lower'],
    ['booking_date', 'date', true, 'The exact day the suite was booked'],
    ['cancel_date', 'date', false, 'The exact day it was cancelled; blank while the booking is active'],
    ['channel', 'text', true, 'Direct, Trade, MICE/Charter, Incentive/Group'],
    ['trade_account', 'text', false, 'Agency at HQ level, trade bookings only'],
    ['promotion_type', 'text', false, 'Blank or None when no promotion applies'],
    ['dilution_type', 'text', false, 'FAM, Single, Family & Friends, FVC, Future Cruise Credit, Other'],
    ['guests', 'number', true, 'Guests in the suite; the total when the row stands for several bookings'],
    ['bookings', 'number', false, 'How many identical bookings the row stands for. Leave the column out when every row is one booking'],
    ['bookers', 'number', false, 'Distinct bookers in the row, used in place of guest_id when a row stands for several bookings'],
    ['list_fare', 'number', true, 'Ticket fare before promotions and dilution; this and the other amounts are totals for the row'],
    ['promotion_amount', 'number', false, 'Value of the promotion'],
    ['dilution_amount', 'number', false, 'Value of the dilution'],
    ['cancel_fee', 'number', false, 'Penalty kept on a cancelled booking'],
    ['guest_market', 'text', false, 'Source geography'],
    ['guest_id', 'text', false, 'Used for distinct-booker counts'],
    ['is_repeater', 'boolean', false, 'Guest has sailed before'],
    ['is_fvc', 'boolean', false, 'Booked on board or within 14 days of sailing'],
    ['fvc_source_voyage', 'text', false, 'Voyage the future-voyage booking was made on'],
    ['is_barter', 'boolean', false, 'Non-cash barter revenue'],
    ['is_non_revenue', 'boolean', false, 'Hosted or complimentary guests'],
    ['c2c_role', 'text', false, "'out' on the booking transferred away, 'in' on its replacement"],
    ['c2c_offset_dilution', 'number', false, 'Dilution on the replacement that offsets the transfer penalty'],
  ],
  voyages: [
    ['voyage_code', 'text', true, 'Unique voyage identifier'],
    ['ship', 'text', true, 'Ship name'],
    ['sail_date', 'date', true, 'Embarkation day'],
    ['days', 'number', true, 'Voyage length'],
    ['region', 'text', true, 'Sailing region'],
    ['embark_port', 'text', false, ''],
    ['debark_port', 'text', false, ''],
    ['is_charter', 'boolean', false, 'Full-ship charter'],
    ['is_non_revenue', 'boolean', false, 'Voyage sailed without revenue guests'],
    ['suites_premium', 'number', true, 'Sellable suites by tier'],
    ['suites_upper', 'number', true, ''],
    ['suites_lower', 'number', true, ''],
    ['budget_revenue', 'number', false, 'Budget ticket revenue'],
    ['budget_pcd', 'number', false, 'Budget passenger cruise days'],
    ['forecast_revenue', 'number', false, 'Current-year forecast, where one exists'],
    ['forecast_pcd', 'number', false, ''],
  ],
};

const norm = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const yes = x => x === true || x === 1 || /^(y|yes|true|1)$/i.test(String(x == null ? '' : x).trim());
const num = x => { const v = typeof x === 'number' ? x : parseFloat(String(x == null ? '' : x).replace(/[$,]/g, '')); return isFinite(v) ? v : 0; };

// Sigma delivers { columnId: values[] } plus { columnId: { name } }; turn that into row objects keyed by column name.
function toRows(data, cols) {
  const ids = Object.keys(data || {}), names = ids.map(id => norm((cols[id] && cols[id].name) || id));
  const n = ids.length ? data[ids[0]].length : 0, rows = new Array(n);
  for (let r = 0; r < n; r++) { const o = {}; for (let c = 0; c < ids.length; c++) o[names[c]] = data[ids[c]][r]; rows[r] = o; }
  return rows;
}

function build(bRows, vRows) {
  const dims = { ships: [], tiers: ['Premium', 'Upper', 'Lower'], regions: [], channels: ['Direct', 'Trade'], accounts: [],
                 promos: ['None'], dtypes: ['None'], markets: [] };
  const idx = (list, name, fallback) => {
    const s = (name == null || name === '') ? fallback : String(name);
    let i = list.indexOf(s);
    if (i < 0) { list.push(s); i = list.length - 1; }
    return i;
  };
  const shipIdx = name => {
    let i = dims.ships.findIndex(s => s.name === name);
    if (i < 0) { dims.ships.push({ code: name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase(), name, suites: null, cats: ['', '', ''] }); i = dims.ships.length - 1; }
    return i;
  };
  const target = (rev, pcd, v) => {
    if (!(rev > 0) || !(pcd > 0)) return null;
    const capTot = v.cap[0] + v.cap[1] + v.cap[2] || 1;
    return { apcd: 2 * capTot * v.days, pcd: v.cap.map(c => pcd * c / capTot), list: v.cap.map(c => rev * c / capTot),
             pcdGross: pcd / 0.9, dil: 0, fee: 0, tradeRev: 0 };
  };

  const voyages = vRows.filter(r => r.voyage_code != null && r.voyage_code !== '').map(r => {
    const v = { code: String(r.voyage_code), ship: shipIdx(String(r.ship || 'Ship')), sail: U.toDay(r.sail_date), days: Math.max(1, Math.round(num(r.days))),
                region: idx(dims.regions, r.region, 'Unassigned'), embark: r.embark_port || '', debark: r.debark_port || '',
                charter: yes(r.is_charter), nonRev: yes(r.is_non_revenue),
                cap: [num(r.suites_premium), num(r.suites_upper), num(r.suites_lower)] };
    v.bud = target(num(r.budget_revenue), num(r.budget_pcd), v);
    v.fc = target(num(r.forecast_revenue), num(r.forecast_pcd), v);
    if (!dims.ships[v.ship].suites) dims.ships[v.ship].suites = v.cap.slice();
    return v;
  }).sort((a, b) => a.sail - b.sail);
  const byCode = new Map(voyages.map((v, i) => [v.code, i]));

  const guestIds = new Map();
  const bookings = [];
  let skipped = 0, pull = 0, trade = 0, all = 0;
  for (const r of bRows) {
    const vi = byCode.get(String(r.voyage_code));
    if (vi == null) { skipped++; continue; }
    const tier = String(r.suite_tier || ''), ch = String(r.channel || 'Direct'), role = String(r.c2c_role || '').toLowerCase();
    const b = {
      v: vi, t: /prem/i.test(tier) ? 0 : /upper|mid/i.test(tier) ? 1 : 2,
      bd: U.toDay(r.booking_date), cd: U.toDay(r.cancel_date),
      ch: /direct/i.test(ch) ? 0 : /trade|agen/i.test(ch) ? 1 : idx(dims.channels, ch, 'Other'),
      acct: -1, promo: idx(dims.promos, r.promotion_type, 'None'), dt: idx(dims.dtypes, r.dilution_type, 'None'),
      g: Math.max(1, Math.round(num(r.guests)) || 2), n: Math.max(1, Math.round(num(r.bookings)) || 1), bk: num(r.bookers), list: num(r.list_fare), pAmt: num(r.promotion_amount), dAmt: num(r.dilution_amount),
      c2c: role === 'out' ? 1 : role === 'in' ? 2 : 0, c2cDil: num(r.c2c_offset_dilution), fee: num(r.cancel_fee),
      mkt: idx(dims.markets, r.guest_market, 'Unknown'), rep: yes(r.is_repeater), fvc: yes(r.is_fvc),
      src: r.fvc_source_voyage != null && byCode.has(String(r.fvc_source_voyage)) ? byCode.get(String(r.fvc_source_voyage)) : -1,
      barter: yes(r.is_barter), nr: yes(r.is_non_revenue), gid: 0,
    };
    if (b.ch === 1) b.acct = idx(dims.accounts, r.trade_account, 'Unassigned trade');
    if (r.guest_id != null && r.guest_id !== '') {
      const k = String(r.guest_id);
      if (!guestIds.has(k)) guestIds.set(k, guestIds.size + 1);
      b.gid = guestIds.get(k);
    }
    const rev = b.list - b.pAmt - b.dAmt;
    all += rev; if (b.ch === 1) trade += rev;
    if (b.bd > pull) pull = b.bd;
    bookings.push(b);
  }
  // Budgets arrive as revenue and guest days only; trade revenue is assumed at the share the book shows.
  const tradeShare = all ? trade / all : 0;
  for (const v of voyages) for (const x of [v.bud, v.fc]) if (x) x.tradeRev = (x.list[0] + x.list[1] + x.list[2]) * tradeShare;

  const pm = U.mi(pull), asOf = pull === U.miEnd(pm) ? pull : U.miEnd(pm - 1);
  return { source: 'sigma', meta: { company: 'Sigma workbook', pull, asOf, c2cPolicy: null, budgetComm: 0.13, skipped },
           dims, voyages, bookings, costs: null };
}

/* ---------------------------------------------------------------------
   PAGING. Rows arrive as chunks at an absolute offset. A newer Sigma host
   sends only the new rows and says when the last page has gone; an older
   one resends everything so far and never says it is finished, so the end
   is inferred from a short page, or from a request that adds nothing.
   --------------------------------------------------------------------- */
function accumulator() {
  const st = { data: {}, rows: 0, complete: false, inferred: false, failed: false, total: null };
  // Returns true when the chunk added rows.
  st.apply = function (chunk) {
    if (!chunk || !chunk.data) { st.failed = true; return false; }          // a failed evaluation ends the stream
    const ids = Object.keys(chunk.data), len = ids.length ? chunk.data[ids[0]].length : 0;
    const before = st.rows, offset = chunk.offset | 0;
    if (offset === 0) { st.data = {}; st.rows = 0; st.complete = false; st.inferred = false; st.failed = false; }   // a restart replaces everything
    if (offset > st.rows) return false;                                      // a gap: the rows cannot be placed
    for (const id of ids) {
      const col = st.data[id] || (st.data[id] = []), src = chunk.data[id];
      col.length = offset;
      for (let i = 0; i < len; i++) col.push(src[i]);
    }
    st.rows = offset + len;
    if (chunk.totalRows != null) st.total = chunk.totalRows;
    if (chunk.isComplete) st.complete = true;
    return st.rows > before;
  };
  return st;
}

// Reads one element to the end, calling onChange on every step.
function watchElement(client, name, onChange, opt) {
  const acc = accumulator(), page = opt.page, stall = opt.stallMs;
  let timer = null, asked = false;
  const settle = inferred => { acc.complete = true; acc.inferred = inferred; };
  const next = () => {
    clearTimeout(timer);
    if (!acc.failed && !acc.complete && acc.rows > 0) {
      if (acc.rows % page !== 0) settle(true);                               // a short page is the last page
      else {
        asked = true;
        client.elements.fetchMoreElementData(name);
        timer = setTimeout(() => { settle(true); onChange(); }, stall);
      }
    }
    onChange();
  };
  acc.stop = client.elements.subscribeToIncrementalElementData(name, chunk => {
    const grew = acc.apply(chunk), wasAsked = asked;
    asked = false;
    if (wasAsked && !grew && !acc.complete && !acc.failed) settle(true);     // asked for more and nothing came
    next();
  });
  return acc;
}

// emit({ state, message, dataset }) — state is standalone | loading | waiting | connected | error
function attach(client, emit, options) {
  const opt = { page: PAGE, stallMs: STALL_MS, ...(options || {}) };
  const cols = {}, acc = {};
  const busy = on => { try { client.config.setLoadingState(on); } catch (e) { /* older hosts */ } };
  const count = a => a.rows.toLocaleString('en-US') + (a.total != null ? ' of ' + a.total.toLocaleString('en-US') : '');
  const update = () => {
    const b = acc.bookings, v = acc.voyages;
    if (!b || !v) return;
    if (b.failed || v.failed) {
      busy(false);
      emit({ state: 'error', message: 'Sigma could not evaluate the ' + (b.failed ? 'bookings' : 'voyages') + ' element. Nothing is shown from a partial table.' });
      return;
    }
    if (!cols.bookings || !cols.voyages || (!b.rows && !v.rows)) {
      emit({ state: 'waiting', message: 'Waiting for Sigma: choose the bookings and voyages elements in the plugin panel.' });
      return;
    }
    if (!b.complete || !v.complete) {
      busy(true);
      emit({ state: 'loading', message: 'Loading from Sigma — bookings ' + count(b) + ' rows, voyages ' + count(v) + ' rows. Nothing is drawn until both tables are complete.' });
      return;
    }
    busy(false);
    try {
      const ds = build(toRows(b.data, cols.bookings), toRows(v.data, cols.voyages));
      if (!ds.voyages.length || !ds.bookings.length) {
        emit({ state: 'waiting', message: 'The selected elements returned no usable rows. Check the column names against the data contract.' });
        return;
      }
      emit({ state: 'connected', dataset: ds, message:
        b.rows.toLocaleString('en-US') + ' booking rows on ' + ds.voyages.length + ' voyages, read in full.' +
        (ds.meta.skipped ? ' ' + ds.meta.skipped + ' rows skipped: no matching voyage.' : '') +
        ((b.inferred || v.inferred) ? ' This Sigma host does not confirm the last page, so completeness is inferred from the page sizes.' : '') });
    } catch (err) { emit({ state: 'error', message: 'Could not read the Sigma elements: ' + err.message }); }
  };
  client.config.configureEditorPanel([{ name: 'bookings', type: 'element' }, { name: 'voyages', type: 'element' }]);
  for (const name of ['bookings', 'voyages']) {
    client.elements.subscribeToElementColumns(name, c => { cols[name] = c; update(); });
    acc[name] = watchElement(client, name, update, opt);
  }
  update();
  return acc;
}

async function connect(emit) {
  if (root.parent === root) {
    emit({ state: 'standalone', message: 'This page is not running inside a Sigma workbook, so there is nothing to connect to. Add it to a workbook as a plugin and choose a bookings element and a voyages element.' });
    return;
  }
  try {
    emit({ state: 'loading', message: 'Loading the Sigma plugin library.' });
    const { client } = await import(PLUGIN_URL);
    attach(client, emit);
  } catch (err) {
    emit({ state: 'error', message: 'The Sigma plugin library did not load: ' + err.message });
  }
}

CBR.sigma = { CONTRACT, build, toRows, connect, attach, accumulator, PAGE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
