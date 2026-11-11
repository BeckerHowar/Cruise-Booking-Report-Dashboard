<h1 align="center">Cruise Booking Report Dashboard</h1>

<p align="center">
  An 88-slide monthly booking report rebuilt as one live page —<br>
  pace, revenue to-go, a profit bridge, a cash river and a scenario cockpit, all from one booking table.
</p>

<p align="center">
  <a href="https://beckerhowar.github.io/Cruise-Booking-Report-Dashboard/">
    <img src="https://img.shields.io/badge/%E2%96%B6%20Open%20the%20live%20dashboard-1d6b52?style=for-the-badge&logoColor=white" alt="Open the live dashboard">
  </a>
</p>

<p align="center"><sub>Opens in the browser · nothing to install · simulated data for a fictional line</sub></p>

---

## What it is

A cruise line's monthly booking report usually lives in a slide deck: dozens of tables and charts, each
pulled separately, each with its own filters. This page replaces that deck with a single dashboard for
**Meridian Yacht Collection**, a fictional three-ship yacht line.

Every view resolves to two tables: one row per suite booked on a voyage on a booking date, and one row
per voyage carrying capacity, budget and forecast. Eighteen base measures and thirteen dimensions
generate everything on the page. Move the as-of date, flip an adjustment or pull a cockpit slider and
every view recomputes.

## The tabs

| Tab | What it answers | Deck slides it replaces |
|---|---|---|
| Flight deck | Where the book stands, what moved profit, where the cash went | 2–3, 7–8 |
| Pace | Booking curves against prior years, booking window split, consolidated report by quarter | 22–28, 85–88 |
| Revenue to-go | Target less booked, by ship, quarter, region and voyage | 9–21, 43–46 |
| Channels | Channel mix and the strategic agency roster | 4–6 |
| Suites | Suite tier mix against budget, and what each tier earns | 30–33 |
| Guests | Guests sailed, bookers, repeaters, future-voyage conversion, guest geography | 34–37, 54–58, 73–78 |
| Dilution & cancellations | Discount take rates, cancellation behaviour, the policies behind both | 38–42, 59–60 |
| Voyages | Every voyage against forecast, budget and its own position three months ago | 61–72, 79–84 |
| Revenue tables | Booking production for the month, trailing 3 months and trailing 12 | 48–51 |
| Definitions & data | Every measure, dimension and adjustment, and the Sigma data contract | — |

## Things worth trying

- **Pull a slider in the scenario cockpit** pinned to the bottom of the screen. Volume, price,
  cancellations, dilution and fuel move the unsailed book only — closed months never restate — so the
  outlook, the profit bridge and the cash river respond while the booked position stays put. Save a
  scenario and it sits beside the base case in the scenarios table.
- **Watch the cash river.** Guest receipts by ship flow in on the left; refunds, commissions, crew,
  provisioning, fuel, debt service and reserves flow out on the right. Switch the window between YTD,
  the full year and the next rolling twelve months.
- **Click a bar in the profit bridge** to isolate one driver, or switch the baseline between budget,
  forecast and the prior year. The bars always sum to the gap with no residual.
- **Flip an adjustment.** Barter revenue, cruise-to-cruise transfers, non-revenue guests and voyages,
  and proration are handled inconsistently from slide to slide in a deck. Here each is one switch
  applied to every view at once.
- **Press Replay on the Pace tab** and watch the booking pace line draw itself day by day through the
  last twelve closes, with the gap to the prior year tracked in the strip beneath it. The tables and
  figures update as each month-end passes.
- **Watch the dots in the cash river.** Each one is a fixed amount of cash, so a stream gains or loses
  dots as the cockpit moves it.
- **Open a card's Table view** to see the numbers behind any chart, or **CSV** to download them.
- **Sort and filter the voyage tables** by clicking a column heading or typing a ship, region or code.
- **Copy link** captures the whole state — tab, date, ship, adjustments, scenario — in the address,
  so a colleague opens exactly what you were looking at. **Print** lays the current tab out for paper.
- **Switch theme.** Light is a soft paper grey rather than white; dark is one click away.

## How far to trust the outlook

The outlook projects every unsailed voyage to its finish. It starts from the voyage's target and moves
it by how much booking pace at that distance from sailing has actually predicted the finish, fitted on
voyages that have already sailed. Pace that history shows to be noise is given little weight.

The Pace tab carries a standing backtest: the outlook projected from 12, 9, 6 and 3 months earlier,
scored against what those voyages then delivered, beside the simplest forecast there is — assume every
voyage lands on target. On the simulated book the outlook beats that benchmark voyage by voyage at all
four horizons for the fleet, by a small margin, and does not for every single ship. The card shows
whichever is true for the data on screen. The watchlist flags a voyage only when the outlook finishes
at least 5% and $150k short of target.

## Data sources

The data source is a switch in the control bar.

**Simulated** generates a deterministic book — about 60,000 bookings on 540 voyages across five sailing
years. Actuals are the plan run through deliberate deviations (a soft booking patch, regional demand
shifts, a drydock overrun, a fuel spike), so every variance traces back to something that moved.

**Sigma** reads the same two tables from a Sigma workbook when this page is embedded there as a plugin.
Columns are matched by name; the full contract is listed on the Definitions & data tab and in
[`app/sigma.js`](app/sigma.js). Sigma hands data over 25,000 rows at a time, so the connector reads each
table page by page and draws nothing until both are complete. It follows Sigma's published plugin API
and is tested against a simulated Sigma host, but **it has not yet been run inside a workbook**.
Operating costs are not part of a booking extract, so with Sigma data the profit bridge
stops at ticket revenue less commissions and the cash river shows refunds and commissions only.

## Integrity checks

On every change the engine re-verifies six things, and the badge in the control bar turns red if any fails:

1. The profit bridge bars sum to the profit gap.
2. The cash river conserves: cash in equals cash out plus reserves.
3. Revenue to-go totals the same by ship and quarter, by region, and by quarter.
4. Monthly bookings less cancellations equal the active book.
5. Suite tiers and channels each add back to the total they split.
6. Receipts less refunds to the close equal what each booking has paid in.

## Running it

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 5178
```

Run the known-answer check: a nine-booking book whose every figure was worked out by hand:

```bash
node tests/engine.js
```

Run the headless check, which renders every tab under a spread of control settings:

```bash
node tests/smoke.js
```

Run the Sigma connector check, which reads a 61,000-row table through a stand-in Sigma host:

```bash
node tests/sigma.js
```

## Construction

Plain HTML, CSS and JavaScript. No frameworks, no build step, and no network requests in simulated mode.

| File | Role |
|---|---|
| `index.html` | Page shell and styling |
| `app/data-sim.js` | Simulated booking and voyage tables |
| `app/sigma.js` | Sigma connector and data contract |
| `app/engine.js` | Every measure: position, pace, outlook, profit bridge, cash river, integrity checks |
| `app/charts.js` | Hand-rolled SVG charts, including the cash river |
| `app/views.js`, `app/views-detail.js` | The tabs |
| `app/main.js` | State and wiring |

I specified the measures, dimensions, adjustments and the deck-to-view map; the build was AI-assisted.

## About the data

**Every figure is synthetic.** Meridian Yacht Collection does not exist. Its ships, agencies, guests
and all of its numbers were generated for this demonstration. Nothing originates from any real
business, and this project is not affiliated with any cruise line or hotel brand.
