# Failure Table (premortem gate)

A thesis starts as a draft. It cannot leave draft until its Failure Table is complete. The rule runs on the server, in `POST /api/saved-theses/:id/advance`, so no page or script can skip it.

## What counts as complete

- 3 to 5 failure paths on the table.
- Every path is decided: **Accept**, **Modify**, or **Reject**. A rejection needs a reason of at least 10 characters.
- At least 2 paths are kept (accepted or modified). Rejecting nearly everything is not a premortem.

## What a path must contain

| Field        | Rule                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| Condition    | 20 to 400 characters and at least one number (a price, percent, count or date)        |
| Probability  | Above 0 and below 1                                                                   |
| Impact       | Above 0 and at most 100, as a percent of the portfolio                                |
| Deadline     | A future date, within five years                                                      |
| Trigger      | `price_below`, `price_above` (need a level and a Bitget-listed stock), `date`, `manual` |

The same checks run on Uncle's output and on your edits (`src/thesis/premortem.ts`). Uncle's paths that fail them are dropped, never repaired or invented. If Uncle writes too few valid paths, the page says so and you can write your own.

## Ownership

Theses belong to the signed-in user (`u:<id>`) or to a guest cookie (`iroh_guest`, `g:<id>`). Nobody can read or change another owner's thesis. Rows created before this change have no owner and are not shown.

## Resurfacing

`GET /api/saved-theses/watch` checks every kept path against the latest Bitget hourly close and the clock. It returns paths that are `breached`, `expired`, or `approaching` (within 5% of the level, or within 7 days for date triggers). The Failure Table shows them first.

## Routes

| Route                                                  | Purpose                                         |
| ------------------------------------------------------ | ----------------------------------------------- |
| `GET/POST /api/saved-theses`                           | List yours, start a draft                       |
| `GET/DELETE /api/saved-theses/:id`                     | Read one, delete a draft                        |
| `POST /api/saved-theses/:id/failure-paths`             | Add a path you wrote                            |
| `POST /api/saved-theses/:id/failure-paths/generate`    | Ask Uncle (Qwen) for paths                      |
| `PATCH/DELETE /api/saved-theses/:id/failure-paths/:pid`| Accept, Modify, Reject; remove your own path    |
| `POST /api/saved-theses/:id/advance`                   | Move to the next stage if the gate allows       |
| `GET /api/saved-theses/watch`                          | Paths that need attention                       |

`evidence_reviewed` opens through Source Lock (below) and `sealed` through the Probability Seal (below). `locked` through the Balance Scale (below).

# Source Lock (Evidence Shelf)

After the Failure Table is signed off, a thesis goes to the Evidence Shelf. It cannot reach `evidence_reviewed` until the shelf passes its gate on the server.

## Claim colors

| Color | State          | Meaning                                                                                   |
| ----- | -------------- | ----------------------------------------------------------------------------------------- |
| Green | `observed`     | A fact read from its source: a Bitget price, or an SEC / central bank page you linked     |
| Amber | `inferred`     | Arithmetic done by this app (for example a change over 30 daily candles), or a company page it cannot verify as official |
| Red   | `insufficient` | The evidence is missing. The value is withheld on the server and never shown              |

Every claim stores its source, source link, the time the source observed it, and the time it was fetched. Open a claim on the shelf to see them.

## Gate

- At least one observed claim.
- Every amber inference is acknowledged by you.
- Bitget evidence fetched in the last 24 hours (your own linked sources do not expire).

## Sources

- **Bitget market data:** built by the app from the hourly price, 30 daily candles and the catalog's weekend-trading field.
- **SEC filings:** you supply the link and the figure. The link must be on `sec.gov` (https). The server then reads the page and the figure must appear on it, near the words of your claim, or the claim is refused (HTTP 422). A match turns the claim green and stores a short excerpt and the time it was checked.
- **Central bank statements:** same check, on a known central bank host (`federalreserve.gov`, `ecb.europa.eu`, `bankofengland.co.uk`, `bis.org`, `cbn.gov.ng`).
- **Company releases:** accepted but always amber. The app does not fetch arbitrary company sites, and cannot check that a page is the official release.
- **Unreadable pages** (a PDF, an error, a timeout, a missing `SOURCE_FETCH_USER_AGENT`) stay amber with the reason in the note, so they cannot satisfy the gate on their own.

### Fetching: what the server will and will not do

- Only https, and only the primary hosts for the claim's kind. A redirect off those hosts is not followed. No other address is ever requested.
- 10 second timeout, 4 MB cap, text, HTML or XML only.
- sec.gov requires a declared User-Agent. Set `SOURCE_FETCH_USER_AGENT` to something like `YourApp you@example.com`. Without it SEC claims stay amber.
- A match shows the figure is on the page. It does not show the page means what you say. Read the excerpt.

## Market closed flag

A price is flagged when the US cash market (09:30 to 16:00 New York time, weekdays) is closed at the time of the price or the fetch. US exchange holidays are not checked.

## Routes

| Route                                              | Purpose                                      |
| -------------------------------------------------- | -------------------------------------------- |
| `POST /api/saved-theses/:id/evidence/refresh`      | Rebuild the Bitget claims                    |
| `POST /api/saved-theses/:id/evidence`              | Add an SEC, central bank or company source   |
| `PATCH /api/saved-theses/:id/evidence/:claimId`    | Acknowledge an inference                     |
| `DELETE /api/saved-theses/:id/evidence/:claimId`   | Remove a source you added                    |

## Answer guard (Uncle's replies)

`POST /api/bitget/research` now checks Uncle's reply before it leaves the server (`src/thesis/answer-lock.ts`). Every figure that looks like a market claim (a price, a percent, a number with million or billion, or a number of 100 or more) must match a number in the Bitget evidence the reply was written from, at the precision it was written, ignoring sign. Figures from your own question are allowed.

- An unmatched figure is replaced with `[figure withheld]`.
- If at least half of three or more figures fail, or there is no evidence at all, the whole answer is refused.
- The chat shows a line such as "Source Lock: 4 of 5 figures matched the Bitget evidence, 1 withheld", and a note when the US market is closed and the answer is about stocks.

Limits: it matches numbers, not meaning. A figure that equals some other number in the evidence still passes. It ignores years, dates, times, whole numbers under 100 and counts of days or periods. It cannot check words such as "rising".

## Numbers you can tap

Prices and moves on the Observatorium board, the stock leaves and the thesis meter are source-bound. Tap one to see the source, instrument, observed time, fetch time, whether it is observed or computed here, and a market-closed warning. The board shows a banner when the US market is closed. Rows Bitget could not supply show "Withheld" and no number.

Not yet tappable: the small price figure on each leaf header and the thesis plaques, because they sit inside buttons (a button cannot hold another button). Their numbers are available inside the opened leaf. The Smart Wallet shelf shows counts, not prices, and is unchanged.

# Probability Seal and calibration

After the Evidence Shelf is signed off, you seal one statement about price. The seal is created by `POST /api/saved-theses/:id/seal`, which also moves the thesis to `sealed`. The `advance` route refuses `sealed` on purpose, because a seal needs your forecast.

## The statement

You choose a direction (up or down), a probability that you are right (1% to 99%) and a horizon (1 to 90 days). The statement is: *the Bitget daily close on the day the horizon falls on (UTC) will be above (up) or below (down) the reference price.* The reference price is the latest Bitget daily candle close at the moment of sealing. A tie counts as "no". Only stocks Bitget lists can be sealed, because only those can be judged.

## Two probabilities

Uncle produces his probability for the same statement from the thesis, the Evidence Shelf claims, the failure paths you kept and a base rate. He never receives your number. His number is the headline; yours sits beside it. Uncle's one-line reason goes through the same answer guard as his chat replies.

If the model is unavailable, the seal falls back to the base rate (how often past windows of this length moved this way, clamped to 5% to 95%) and says so. With fewer than 10 past windows there is no base rate, and the seal is refused rather than invented.

## Scoring

The Brier score is the squared gap between the probability and what happened (1 if the statement came true, else 0). It runs from 0 (perfect) to 1. Always saying 50% scores 0.25. Lower is better.

A seal is judged once, when you open your theses or the ledger after the resolving day has ended. It uses the Bitget daily close of that day and never changes after. If Bitget no longer returns that candle (it keeps 100 daily candles), the seal is marked `unresolvable`. No background job runs, so a seal is judged the next time you open the page, not at midnight.

`GET /api/saved-theses/calibration` returns your ledger: every seal, plus the mean Brier score of you and Uncle over the judged ones. A handful of seals says little. The ledger says so until there are 10.

A sealed thesis cannot be deleted or changed.

# Balance Scale (serving the thesis)

The last gate. A sealed thesis becomes `locked` ("served") through `POST /api/saved-theses/:id/lock`. The `advance` route refuses `locked` on purpose, because serving needs your position size.

## What you type in

Your portfolio (`PUT /api/portfolio`): total value, optional collateral and margin used, and up to 20 holdings by symbol and value. **Nothing is read from an exchange or wallet.** The scale is only as true as what you type. Reading a live Bitget account would need each person's own API keys, which this version does not collect.

Then the position: its size in USD and its leverage (1 to 20).

## What is measured

| Metric | How | Warn | Hard limit |
| --- | --- | --- | --- |
| Concentration | (what you already hold of this stock + the new position) / total portfolio | 10% | 25% |
| Correlation | Value-weighted average correlation of daily returns with holdings Bitget lists, over up to 100 daily candles and at least 20 shared days | 0.70, when those holdings are 20% or more of the portfolio | 0.90, when 40% or more |
| Weekend and overnight gap | The worst 3-day move in the available candles, applied to this position, as a share of the portfolio | 3% | 8% |
| Collateral and margin | With collateral: (margin used + position / leverage) / collateral. Without: position / leverage against free cash | 60% | 90%, or no free cash |

The thresholds are in `src/thesis/risk.ts`. A holding Bitget does not list, or with too little history, is reported as "not measured" and left out of the correlation. It is never guessed. The gap figure is a historical worst case from at most 100 daily candles; it does not cap future moves, and it does not model Bitget's own overnight session.

## The gate

The server measures again when you lock, so an old preview cannot be reused.

- Every warned or breached metric must be acknowledged by name.
- A breached hard limit also needs a written reason of at least 20 characters. The reason, the metrics at that moment, and the verdict (`clear`, `warn`, `override`) are stored with the thesis permanently.
- Without a saved portfolio nothing can be measured, so nothing can be served.
- Unmeasured metrics do not block, and are recorded as unmeasured.

A served thesis cannot be changed or deleted.

## Routes

| Route | Purpose |
| --- | --- |
| `GET/PUT /api/portfolio` | Read or save the portfolio you typed in |
| `POST /api/saved-theses/:id/risk` | Read the scale for a position size. Changes nothing |
| `POST /api/saved-theses/:id/lock` | Serve the thesis. Body: `plannedUsd`, `leverage`, `acknowledged[]`, `overrideReason` |

# Path of Discipline

A thesis walks five stops in order: Thesis Table, Failure Table, Evidence Shelf, Probability Seal, Balance Scale. Serving it ends the path.

- **The order is enforced on the server.** Each stop's routes refuse a thesis that has not finished the stop before it (HTTP 409), however the request is sent. See the gate tables above.
- **Progress is saved.** It is the thesis's status in the database, so it survives closing the page and signing in on another device (signed-in users) or returning to the same browser (guests).
- **Progress is visible.** The Counter panel shows a five-stop rail on every thesis: finished stops show a tick, the current stop is marked, and the stops after it are greyed out and cannot be opened. Finished stops fold away but stay readable. The thesis list shows "Stop 3 of 5: Evidence Shelf" for each thesis.
- The path model is `src/thesis/path.ts`.

## What this is not

The five stops are shown in the Counter panel, not as separate rooms you walk through in the 3D shop. The existing shop stations (Counter, Observatorium, Host, Shelf, Waiting room) are unchanged. The 3D shop could not be rendered while building this, so I did not move the camera or add rooms to it. A later step can map the stops to places in the shop once they can be previewed.
