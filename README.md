<h1 align="center">Cruise Booking Report Dashboard</h1>

<p align="center">
  An interactive, driver-based financial planning model —<br>
  three tied statements, variance analysis, scenario planning and a self-writing board summary.
</p>

<p align="center">
  <a href="https://beckerhowar.github.io/FP-A-command-center/">
    <img src="https://img.shields.io/badge/%E2%96%B6%20Open%20the%20live%20dashboard-1d6b52?style=for-the-badge&logoColor=white" alt="Open the live dashboard">
  </a>
</p>

<p align="center"><sub>Opens in the browser · nothing to install · all figures synthetic</sub></p>

---

<!--
  ADD SCREENSHOTS HERE (optional, takes about a minute):
  1. Open your live dashboard and take two screenshots — the Board view and the Working model.
  2. On GitHub, open this README and click the pencil icon to edit.
  3. Drag each image file straight into the editor. GitHub uploads it and inserts the
     markdown for you. Move the inserted lines to sit just below this comment.
  4. Commit the change.
  Delete this comment block once you have done it.
-->

## What it is

A complete monthly operating model for **Voltway** — a fictional Energy-as-a-Service company that
installs efficiency equipment at customer sites, retains ownership, leases it back for a fixed
monthly fee, and funds the build-out with an equipment debt facility.

Every figure on the page is generated from an editable assumption. Nothing is hard-coded, and every
line item shows its formula on hover.

The page opens on a **Board view** — the one-page summary an executive team would receive. Switch to
**Working model** for the machinery behind it: drivers on the left, statements and analysis on the
right.

## What it demonstrates

| Capability | Where to see it |
|---|---|
| Driver-based budgeting and rolling forecasts | Driver panel · rolling 12-month forecast |
| Budget-vs-actual variance analysis with a P&L bridge | EBITDA bridge, drillable to the line item |
| Scenario and sensitivity analysis | Scenario lab · tornado chart with three metric views |
| KPI dashboards with real-time visibility | Board view · KPI strip |
| Subscription metrics: ARR, unit economics, retention | ARR walk · per-site payback · cohort grid |
| Three-statement modelling | P&L → balance sheet → cash flow, tied every month |
| Capital allocation: CAPEX, payback, ROI | Candidate deal ranking at an editable discount rate |
| Board reporting that turns numbers into narrative | Board view — the variance commentary writes itself |
| Automation applied to recurring finance work | Invoice guard — contracted-rate control |

## Things worth trying

- **Edit any driver** and watch the forecast rebuild. Actuals stay fixed — history does not restate.
- **Move the close** ("Actuals through") and the variance bridge, rolling forecast and board
  commentary all re-cut around the new cutover. At a June close the narrative re-ranks its own
  drivers and reports a different lead cause.
- **Switch the business model** between a contracted lease and month-to-month cancellation to see
  how retention structure changes the accounting for churned equipment.
- **Flip the tornado metric** between EBITDA and cash. The ranking reorders completely — the drivers
  that protect margin are not the drivers that protect the balance sheet.
- **Compare scenarios.** The upside case earns more EBITDA and ends with *less* cash, because every
  additional site deploys capital years before it pays back.
- **Hover any line item or metric label** for its definition and formula.

The badge beside the statements confirms the balance sheet ties in all 36 months. It is recomputed
live and turns red if any assumption ever breaks the model.

## Modelling conventions

The full list sits in "The Fine Print" panel inside the app, where conventions describing
operating methodology are deliberately blurred; the accounting and modeling conventions remain
readable. The ones that matter most:

- Equipment is leased under **operating leases** — the asset stays on Voltway's books and
  depreciates, and the asset retains residual value at lease expiry.
- Tax accrues on year-to-date pre-tax income within each fiscal year, trued up monthly.
- Candidate investments are valued over their contracted term **plus** residual book value released
  at lease end. No renewal revenue is assumed.
- The EBITDA bridge is a chained decomposition: volume, rate and margin explain the gross profit
  variance exactly, and with the cost lines the six components sum to the gap with no residual.

## About the data

**Every figure is synthetic.** Voltway does not exist. The company, its customers, its vendors and
all of its numbers were generated for this demonstration. Nothing originates from any real business.

The "actuals" are produced by the same engine as the forecast, run with deliberate month-by-month
deviations — install slippage, a customer bankruptcy, pricing concessions, cost inflation, an
unplanned legal settlement. Because they come from the model rather than being typed in, every
dollar of variance decomposes back to a driver that moved.

## Construction

A single self-contained HTML file. No frameworks, no build step, no external requests, no data
stored anywhere. The finance engine is plain JavaScript — search the source for `MODEL ENGINE`.

I specified the driver map, statement structure and accounting conventions, then had the logic
stress-tested for technical accounting articulation and Energy-as-a-Service industry realism
before implementation. The build was AI-assisted; the
financial logic, conventions and design decisions are mine, and I can defend any of them.

Verification ran to roughly 230,000 automated assertions across randomised assumption sets: the
balance sheet ties every month, cash reconciles, debt rolls forward, the variance bridge and ARR
walk foot with no residual, NPV cross-checks against the closed-form annuity formula, and actuals
are provably immune to forecast edits.

## AI analysis protocol

The analytical standards behind this model, written as an instruction set an AI can execute —
governed definitions first, generation second: [AI_ANALYSIS_PROTOCOL.md](AI_ANALYSIS_PROTOCOL.md).
The checklist is the analyst's; the machine just runs it fast.

## Running it locally

Clone the repository and open `index.html` in any browser. There is nothing to install.

---

<p align="center">
  <b>Becker Howar</b> · <a href="mailto:becker.howar@gmail.com">becker.howar@gmail.com</a>
</p>
