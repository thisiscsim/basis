# Basis

LLM investing copilot. You (the agent) help a beginner investor understand, monitor, and stay disciplined about their money by reading/writing validated data files that a local Electron app renders. The system multiplies understanding, discipline, and coverage — it is **not** a prediction machine, and it never gives personalized buy/sell advice.

Basis is single-player: there is exactly one portfolio/IPS/watchlist, living in one data folder.

## How it works

The full user journey (front to back):

1. The app opens straight into its three surfaces (Digest / Research / Coach), backed by a single data folder (default `~/Documents/Basis`, scaffolded on first launch with `portfolio.json`, `ips.json`, `watchlist.json`, `alerts.json`, and `briefs/ digests/ filings/`).
2. The user enters their holdings into `portfolio.json`, writes their goals/rules into `ips.json` (the Investment Policy Statement), and adds tickers to `watchlist.json`.
3. **Monitor** (`monitor.mjs`) checks SEC EDGAR for new filings on watched tickers, appends them to `alerts.json`, and caches 10-K/10-Q documents; **diff** (`diff-llm.mjs`) writes "what changed vs the prior filing" summaries onto the alerts.
4. **Briefs** (`brief-llm.mjs`) write due-diligence briefs into `briefs/<ticker>-<date>.json`. Every claim must carry an exact verbatim quote from the filing; a verification pass drops any claim whose quote is not an exact excerpt of the source.
5. **X-ray** (`xray.mjs`) computes the portfolio's real exposure deterministically (sectors via EDGAR SIC descriptions, concentration, warnings); the LLM only writes a narrative that may not contradict the numbers.
6. **Digest** (`digest-llm.mjs`) composes a short "what happened and why it matters" readout into `digests/<date>.json`.
7. The **Coach** surface is streaming chat (tutor + coach personas) plus the **friction gate**: before a trade, the model argues from the user's own IPS rules and the decision is appended to `decisions.log.jsonl` either way.

The app live-reloads the data files when you (or the engine scripts) change them.

## The contract: validated data files

Every file in the data folder is validated by the zod schemas in `packages/schema` (`packages/schema/src/schema.ts`). Never write a file that fails its schema.

- `portfolio.json` (`PortfolioSchema`) — user-entered holdings (ticker, shares/weight/cost basis).
- `ips.json` (`IpsSchema`) — goals, horizon, risk tolerance, target allocation, and the rules the friction gate argues from.
- `watchlist.json` (`WatchlistSchema`) — monitored tickers + the monitor's per-ticker cursor.
- `alerts.json` (`AlertsSchema`) — the filing inbox (form, date, accession, url, optional diff summary).
- `ideas.json` (`IdeasSchema`) — the idea log: every brief and gate decision, graded later against daily closes vs SPY (`grade-ideas.mjs`).
- `briefs/<ticker>-<date>.json` (`BriefSchema`) — DD briefs; every claim carries `{quote, source, sourceUrl, verified}`.
- `digests/<date>.json` (`DigestSchema`) — periodic digests.
- `xray.json` (`XraySchema`) — deterministic exposure analysis + drift vs the IPS + optional LLM narrative.
- `paper.json` (`PaperAccountSchema`) — the paper-trading gauntlet: orders fill at the NEXT day's close, equity marked vs SPY.
- `plan.json` (`PlanSchema`) — reminder config (DCA day, rebalance band) + cursors; the monitor appends plan alerts. Reminders only — Basis never executes trades.
- `lab/backtests/<id>.json` (`BacktestSchema`) — preset backtests with deterministic warnings + LLM bias-audit notes.

Two parse strategies (`packages/schema/src/index.ts`): defaults-filling throwing parsers for app-owned files, and `ParseResult`-returning parsers (`parseBrief`, `parseDigest`) for LLM-authored documents whose errors are fed back to the model in a repair retry.

## Helper scripts (`app/scripts/`)

`monitor.mjs` (fetch new EDGAR filings + plan reminders), `diff-llm.mjs` (filing change summaries), `brief-llm.mjs` (cited DD brief + citation verification), `xray.mjs` (deterministic exposure + drift vs the IPS + narrative), `digest-llm.mjs` (digest, deterministic fallback), `grade-ideas.mjs` (idea-log returns vs SPY), `backtest.mjs` (preset engine `lib/backtest.mjs`, no lookahead by construction, LLM audits only), `paper-mark.mjs` (next-close fills + marking, `lib/paper.mjs`). Shared libs: `lib/edgar.mjs` (EDGAR client: CIK mapping, submissions, doc cache, 10 req/s throttle, contact-email User-Agent), `lib/prices.mjs` (daily closes: free Yahoo default, keyed Tiingo option, cached), `lib/filings.mjs` (HTML→text, Item extraction, quote verification), `lib/drift.mjs`, `lib/portfolio.mjs`, `lib/ideas.mjs`, `lib/data-dir.mjs`, `lib/cli.mjs`, and `llm.mjs` (provider resolver over `@basis/schema` llm-config).

Read-only broker sync (Plaid Investments, user-supplied credentials) lives in the main process (`app/src/main/plaid.ts`); it only ever calls `/investments/holdings/get` and maps into `portfolio.json` (`source: "broker"` rows replaced wholesale; manual rows survive).

## Scoped conventions

Area-specific rules live in `.cursor/rules/` (IPC/main-process, renderer design system, engine scripts, schema, delivery workflow). They activate by file glob in Cursor; other agents should skim the relevant file before working in that area.

## Boundaries

- Generated artifacts live in the data folder. In the app it resolves to the user's Basis home (`~/Documents/Basis`, configurable); the scripts honor `BASIS_DATA_DIR` and fall back to the repo's `data/` in dev. Don't write outside the data folder except code changes you were explicitly asked to make.
- **Honesty rules are product rules**: no buy/sell/hold instructions, no price predictions, every research claim needs a verifiable citation, deterministic numbers are ground truth the model may not contradict, and the boring foundation (diversified low-fee indexing) is never talked down.
- Data sources: SEC EDGAR (filings; respect the fair-access policy — declarative User-Agent with contact email, ≤10 requests/second, cache aggressively), Yahoo Finance or Tiingo (daily closes only, cached ~20h), and optionally the user's own Plaid credentials (holdings, read-only). Never add a data dependency that requires an account without a free path.
- Only reference filings that actually exist; unverified claims are dropped, not shown.
