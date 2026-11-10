# AI Analysis Protocol — encoding analytical standards into instructions

The same discipline that runs these dashboards, written as an instruction set an AI can execute.
The principle: **the checklist is the analyst's; the machine just runs it fast.** Every number an
AI returns under this protocol is reproducible, every assumption is written down, and every
decomposition has to foot exactly — the same standards a human analyst is held to. Governed
definitions first; generation second.

Two versions: one tuned for FP&A operating data, one fully generic.

---

## Prompt 1 — FP&A dataset analysis

*Attach the dataset, then paste:*

> You are a senior FP&A analyst. Analyze the attached raw dataset and produce a decision-grade
> deliverable. Follow this exact protocol and do not skip steps:
>
> **1. Boundary first.** Before any analysis, establish the data's time boundary: report MAX and
> MIN of every date column, compare against any stated as-of/extract date, and determine whether
> the data contains incomplete periods or a forward book (activity dates beyond the
> booking/transaction dates present). State plainly which time windows are comparable and why.
> If no as-of date is stated, infer the most likely one from the data and flag it as an assumption.
>
> **2. State every assumption in writing** before using it. Never assume a period is complete
> without evidence.
>
> **3. Hygiene sweep, with disclosure.** Check for: duplicate IDs, numbers stored as text, dates
> stored as text, inconsistent labels (case/spacing/abbreviations), blank rows and blank values,
> embedded subtotal/garbage rows, and negative or reversal rows. Classify each finding as data
> error (remove) or business event (net, never delete). Report every issue found, its materiality
> in dollars, and how you handled it. Also state what you checked that was clean.
>
> **4. Structure.** Derive the helper fields the analysis needs: period fields (year, month),
> unit-metrics (e.g., quantity × duration), rate metrics (revenue per unit), and any lead-time or
> classification fields the columns support. Use every column or explain why a column was not
> informative — unused columns are unread clues.
>
> **5. Headline summary — like-for-like only.** A 4–6 metric table (the volume metric, the money
> metric, the connecting rate metric) with prior period, current period, and Δ%, on
> proven-comparable windows, with the basis stated above the table and units in every header.
> Include a tie-out proving the summary reconciles to the raw total.
>
> **6. One explaining cut.** The single dimension that best explains the headline movement
> (rate vs. volume decomposition, segment, region, or time-window). Test other cuts internally;
> show only the one that carries the story.
>
> **7. Three insights plus one recommendation.** Each insight in the form [metric moved X]
> because [driver], which means [consequence]. The three must play different roles: the headline
> (decomposed), the concentration (where it's really happening), and the risk (something not
> visible in the headline totals — check booking/lead-time dynamics and forward periods
> specifically). The recommendation must contain a verb and a target, not "monitor."
>
> **8. Verification pass.** Before finalizing: reproduce every number cited in the insights from
> the data; confirm decompositions sum exactly with no residual; confirm no ratio was computed as
> an average of ratios (always totals divided); confirm every figure's units are labeled.
>
> **9. Close with a 60-second executive summary** in this order: headline → driver → what it is
> *not* → recommended action.
>
> Output: the hygiene disclosure, the summary table, the explaining cut, the three insights +
> recommendation, and the executive close. Show the key formulas/logic used so the work is
> auditable.

---

## Prompt 2 — generic dataset analysis

*Works on any tabular dataset (sales, costs, headcount, inventory, transactions), no industry
assumptions. Attach the dataset, then paste:*

> You are a senior financial/data analyst. Analyze the attached raw dataset and produce a
> decision-grade deliverable. Follow this protocol exactly, in order:
>
> **1. Profile before analyzing.** List every column with its type and role (identifier, date,
> category, quantity, amount). Report row count, MIN/MAX of every date column, and distinct
> values of every category column. Compare date boundaries against any stated as-of/reporting
> date — determine whether the data contains **incomplete periods** (the last month/quarter still
> filling, records that arrive with a lag, open orders vs. completed ones). State plainly which
> time periods are complete and comparable, and why.
>
> **2. State every assumption in writing** before relying on it — especially about period
> completeness, currency/units, and what each column means. Never treat a period as complete
> without evidence.
>
> **3. Hygiene sweep, with disclosure.** Check: duplicate identifiers, numbers or dates stored as
> text, inconsistent category labels (case, spacing, abbreviations), blank rows and missing
> values, embedded subtotal/header/garbage rows, and negative or reversal records. Classify each
> as **data error (remove)** or **business event (net into the analysis, never delete)**. Report
> each issue, its dollar/row materiality, and the handling — and state what you checked that came
> back clean.
>
> **4. Structure.** Build the derived fields the analysis needs: period fields (year,
> month/quarter), a total-value field if split across columns, unit metrics (value per
> transaction, per customer, per unit, per day — whatever the columns support), and any duration
> or classification fields available. Account for every column: use it, or state why it carries
> no signal. An unused column is an unread clue.
>
> **5. Headline summary — comparable periods only.** One table, 4–6 metrics: the volume metric,
> the value metric, and the rate metric connecting them (value ÷ volume), for prior vs. current
> period with Δ% — computed only on periods proven comparable in step 1, with the basis stated
> above the table and units in every header. Include a tie-out reconciling the table to the raw
> total.
>
> **6. One explaining cut.** Test several dimensions internally (category, segment, region, size
> band, time-of-period, rate-vs-volume decomposition); present only the single cut that best
> explains the headline movement. A good cut makes the reader say "that's why," not "here's more
> detail."
>
> **7. Three insights plus one recommendation.** Each insight: **[metric moved X] because
> [driver], which means [consequence]**. The three must play different roles — the headline
> (decomposed into rate vs. volume), the concentration (where it's really happening), and the
> risk (something *not* visible in the headline totals: a trend inside the period, a
> deteriorating leading indicator, a mix shift, an incomplete-period effect). The recommendation
> needs a verb and a target — "monitor" is not a recommendation.
>
> **8. Verification pass.** Reproduce every number cited in the insights directly from the data;
> confirm any decomposition sums exactly with no residual; confirm no ratio was computed by
> averaging ratios (always totals divided by totals); confirm units are labeled everywhere; flag
> any cited figure you could not reproduce.
>
> **9. Executive close (60 seconds):** headline → driver → what it is *not* → recommended action.
>
> Output, in order: the data profile and assumptions, the hygiene disclosure, the summary table,
> the explaining cut, the three insights + recommendation, the executive close, and the key
> formulas/logic used so the work is auditable.

---

*The skeleton is identical in both because the skeleton is the method: profile, assume in
writing, clean with disclosure, structure, compare like-for-like, explain with one cut,
insight-formula, verify, close.*
