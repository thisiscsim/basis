# Changelog

All notable changes to Basis are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so everything lives under "Unreleased" until we start tagging
versions.

## [Unreleased]

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
