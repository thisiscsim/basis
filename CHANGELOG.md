# Changelog

All notable changes to Basis are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so everything lives under "Unreleased" until we start tagging
versions.

## [Unreleased]

### Added (life plan — playbooks + cited steps)

- **Playbooks** — drop your own copy of a book or notes (PDF/EPUB/txt/md,
  e.g. "I Will Teach You To Be Rich") into the app; `playbook-llm.mjs`
  distills it into actionable principles, each carrying an exact verbatim
  quote verified against the source (unverified principles dropped). Big
  books resume across runs (12 chunks per run). Sources stay local.
- **Cited plan steps** — `lifeplan-llm.mjs` layers 5-10 concrete steps onto
  the deterministic core, every step citing playbook principles by id;
  steps with citations that don't resolve are dropped deterministically.
  The Plan tab renders citation chips that expand to the verified quote,
  plus a playbook browser. Falls back to the numbers-only plan without a
  model or playbooks.

### Changed (bank connectivity)

- **Teller replaces Plaid.** Teller's free developer tier (100 live
  connections, no-certificate sandbox) fits a single-player app far better
  than Plaid's 10-item trial, and its accounts/balances/transactions API
  feeds the life plan directly. Plaid Investments (and with it brokerage-
  position syncing) is removed — portfolio holdings return to manual entry.
  Teller Connect runs in the same isolated window pattern; mTLS client
  certificates (development/production) load from user-configured paths;
  only read endpoints are ever called.

### Added (life plan — bank ingestion)

- **Bank sync into the snapshot** — depository balances become cash-asset
  rows and credit accounts become credit-card debt rows (`source: "bank"`,
  replaced wholesale on sync; manual rows and user-entered APR/minimum terms
  survive). ~90 days of transactions drive recurring-fixed-cost suggestions
  (same-merchant, stable-amount, monthly cadence) and the measured average
  monthly spend, shown against the declared number — the honesty feature.

### Added (life plan — snapshot, goals, projections)

- **Financial snapshot** (`finances.json`) — income, fixed monthly costs,
  debts (balance/APR/minimum), non-brokerage assets, and committed savings,
  edited Conscious-Spending-Plan style on the new **Plan** tab.
- **Goals** (`goals.json`) — purchase (house down payment, with target date),
  recurring (trips, $/year), and lifestyle (permanent $/month upgrades),
  funded in priority order.
- **Deterministic plan core** (`lifeplan.mjs` + pure `lib/projection.mjs`,
  known-answer tested): monthly surplus breakdown, debt avalanche schedule
  (highest APR first, freed minimums roll forward, never-pays-off flagged),
  purchase-goal feasibility per scenario (funded-by dates or deadline
  shortfalls), and a 25-year net-worth projection in today's dollars under
  three named scenarios (conservative 4% / expected 7% / optimistic 10%
  nominal, 3% inflation — assumptions printed on the chart). Warnings for
  deficits, unpayable debts, high-APR debt, and underfunded goals.
  Projections are assumption math, not predictions.

### Added (Phase 5 — knowledge graph)

- **Relationship extraction** (`graph.json` + `graph-llm.mjs`) — for watched/
  held companies with cached filings, the agent extracts named business
  relationships (supplier/customer/partner/competitor/investor/subsidiary)
  from 10-K Item 1/1A text. Same citation discipline as briefs: every edge
  carries an exact verbatim quote, verified against the filing; unverified
  edges are dropped. Runs during Update filings (capped at 3 tickers/run),
  merged + deduped by filer/relationship/normalized-counterparty.
- **Second-order inference** — when the monitor lands a new filing alert, a
  deterministic 1-2 hop traversal connects the filer to the user's holdings/
  watchlist ("X lists Y as a supplier", "both A and B relate to C") and
  annotates the alert with `related[]`; the inbox shows related-holding
  badges. The Research view gains a **Connections** section listing every
  quoted edge touching the open ticker. Coverage, not edge.

### Added (Phase 4 — the Lab)

- **Backtest copilot** — a pure, preset-based engine (`lib/backtest.mjs`:
  buy-and-hold, DCA-monthly, 200-day trend, momentum rotation) with explicit
  trading costs, time-weighted returns, and no lookahead by construction;
  every run is compared against buy-and-hold of the same tickers and ships
  with deterministic honesty warnings plus an optional LLM bias audit
  (lookahead/survivorship/overfitting review — the model never generates
  signals). Results land in `lab/backtests/` and render with an equity
  sparkline in the new **Lab** tab.
- **Paper-trading gauntlet** (`paper.json`) — $100k of pretend money; orders
  fill at the *next* day's close (same-day fills would be lookahead), equity
  is marked vs buy-and-hold SPY, and the UI tracks day N of the 180-day
  gauntlet. Marking runs on Update filings and on demand.
- **Plan reminders** (`plan.json`) — the no-execution "boring bots": a
  monthly DCA nudge and an IPS drift-band check appended to the alerts inbox
  by the monitor (once per month / at most weekly, cursor-tracked).

### Added (Phase 3 — discipline layer)

- **Price layer** (`lib/prices.mjs`) — daily closes from Yahoo Finance (free, no key)
  or Tiingo (keyed, Settings → Data Sources), cached ~20h under the shared
  cache dir. Powers everything below; degrades gracefully when a ticker
  doesn't resolve.
- **Read-only broker sync (Plaid)** — bring-your-own Plaid credentials
  (sandbox free); Plaid Link opens in an isolated window, only
  `/investments/holdings/get` is ever called, and holdings map into
  `portfolio.json` (`source: "broker"` rows replaced wholesale, manual rows
  survive, cash/unmapped securities skipped and counted). Secrets stay
  main-side; the renderer only sees booleans.
- **Drift detection** — IPS allocation buckets now carry assigned tickers;
  the X-ray values holdings at market (shares × close) when possible and
  reports actual vs target per bucket with a ±5-point band, drift meters with
  target ticks in the Digest view, and an informational rebalance note
  (Basis never executes trades).
- **Idea log** (`ideas.json`) — every brief and friction-gate decision is
  logged and graded against daily closes vs SPY (`grade-ideas.mjs`, chained
  into Update filings). The Coach view gains a Track record modal — the
  honest mirror.

### Changed

- **Single-player: removed workspaces and folders.** There is exactly one
  portfolio/IPS/watchlist, living in one data folder (`~/Documents/Basis`,
  scaffolded on first launch; `BASIS_DATA_DIR` override in dev). The app opens
  straight into the Digest / Research / Coach shell — the Home grid, folder
  (album) grouping, workspace CRUD, slugs, and the per-slug containment
  machinery are gone, along with the `Tile` UI kit component and the Home
  styles. Engine scripts drop `--slug` and resolve `lib/data-dir.mjs`; the
  friction-gate log lives at the data root.

- **Product pivot: Basis is now an LLM investing copilot** (from the AI video
  studio). The video domain (Remotion preview/export, timeline, EDL schema,
  transcription/TTS/voices, ffmpeg media plumbing, style/benchmark learning)
  was removed; the proven foundation was kept: the Electron shell (window/CSP
  hardening, `{ok,error}` IPC contract, settings + `.env.local` layering with
  key locking, atomic writes, workspace file watcher with self-write
  suppression, `PHASE`/`PROGRESS`/`DONE` script harness), the renderer chassis
  (zustand store, Home tiles/folders, UI kit, design tokens, Storybook), and
  the provider-agnostic LLM layer.

### Added (investing copilot)

- **`packages/schema`** (was `packages/edl`) — zod schemas for the workspace
  contract: `portfolio.json`, `ips.json`, `watchlist.json`, `alerts.json`,
  `briefs/*.json` (per-claim verified citations), `digests/*.json`,
  `xray.json`; shared `llm-config` (kills the main-process/scripts config
  duplication) and `extractJson`; hostile-input tests.
- **EDGAR engine scripts** — `lib/edgar.mjs` (ticker→CIK, submissions, doc
  cache, 10 req/s throttle, contact-email User-Agent per SEC fair-access),
  `monitor.mjs` (new-filing alerts + doc caching), `diff-llm.mjs` (Risk
  Factors/MD&A "what changed" summaries vs the prior filing), `brief-llm.mjs`
  (DD briefs with an exact-quote citation verification pass that drops
  unverifiable claims), `xray.mjs` (deterministic sector/concentration
  exposure via SIC codes + optional narrative), `digest-llm.mjs` (LLM digest
  with a deterministic fallback).
- **Workspace surfaces** — Digest (digest + X-ray + filing-alert inbox),
  Research (brief list + cited-claim reader, sec.gov source links), Coach
  (streaming tutor/coach chat via main-process `streamText`, plus the
  pre-trade **friction gate** that argues from the user's own IPS and logs
  every decision to `decisions.log.jsonl`).
- **Home** — workspaces with stat covers (holdings/watching/alerts), folders,
  seeded watchlists at creation; Settings gains a Data Sources tab (EDGAR
  contact email).

### Pre-pivot history (video-studio era, summarized)

Before the pivot, this repo was an AI-assisted short-form video studio. That
era built the foundation the current product runs on: the Electron + Vite +
React shell, the design-token system and UI kit, the shared zod schema
package, the provider-agnostic LLM layer, the engine-script harness, the
two-project Vitest setup, and the GitHub Actions CI pipeline. The
video-specific features it shipped (timeline editor with Remotion
preview/export, aesthetic learning and style library, benchmark-aware
critique, auto-improve loop, transcription/voiceover) were removed in the
pivot; see the git history before the pivot commit for their details.

## [0.1.0] - Initial commit

- Scaffold: Electron + Vite + React editor, shared schema package, and the
  original video-generation spine.
