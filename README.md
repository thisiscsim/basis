# Basis

An LLM investing copilot for people who are smart but new to investing. Watch companies' SEC filings, generate due-diligence briefs where every claim carries a verified citation, x-ray what your portfolio is actually exposed to, and let a coach hold you to the rules you wrote when you were calm.

Basis is **local-first, not local-only**: your holdings, rules, and research live on your machine; the AI steps (briefs, filing diffs, digests, chat, the friction gate) call a configurable LLM API (OpenAI GPT-5.5 by default), and filings come from SEC EDGAR (free, no account). Without a model configured, the deterministic parts (monitoring, X-ray, filings-list digests) still work.

Basis is a research and discipline tool, **not** a prediction machine and not investment advice. It never tells you what to buy or sell.

## The end-to-end flow

Basis is single-player: one portfolio, one IPS, one watchlist — the app opens straight into its three surfaces (Digest / Research / Coach), backed by a single data folder.

1. **Input** — enter your holdings (weights or cost basis make the X-ray meaningful), write your Investment Policy Statement (goals, horizon, rules), add tickers to the watchlist.
2. **Update filings** — the monitor checks EDGAR for new filings on watched tickers; new 10-K/10-Qs get "what changed vs the prior filing" summaries (Risk Factors + MD&A, diff-first to keep token spend sane).
3. **Research** — generate a brief for any US-listed ticker: business model, financial trends, competition, the bear case, red flags. Every claim must quote its filing verbatim; a verification pass drops anything that doesn't check out, and the UI shows how many claims were dropped.
4. **X-ray** — deterministic exposure analysis (sectors via EDGAR SIC codes, concentration, warnings) with an optional LLM narrative that may not contradict the numbers.
5. **Digest** — a short "what happened and why it matters" readout composed from recent alerts + the X-ray.
6. **Coach** — streaming chat with two personas (tutor for learning, coach that knows your IPS/portfolio), plus the **friction gate**: describe a trade you're about to make and get an argument from your own rules before you do it. Either decision is logged to `decisions.log.jsonl` so you can review your own track record honestly.

## Architecture

Three layers, bridged by one folder of validated files:

- **Electron app** (`app/`) — the Digest / Research / Coach surfaces; streaming chat runs in the main process (AI SDK `streamText`).
- **Node scripts** (`app/scripts/`) — the engine: EDGAR client, monitor, filing diffs, briefs (with citation verification), X-ray, digests. Spawned by the app on a `PHASE`/`PROGRESS`/`DONE` line protocol.
- **Agent harness** (`AGENTS.md`) — coding agents read/write the same data files under the same schemas.

**The contract:** the data folder's JSON documents (`portfolio.json`, `ips.json`, `watchlist.json`, `alerts.json`, `xray.json`, `briefs/*`, `digests/*`) are validated by the zod schemas in `packages/schema`. LLM-authored documents (briefs, digests) are parsed with error feedback for a repair retry; app-owned documents parse with defaults. Every numeric is finite and bounded, every URL is https-only, and every research claim needs a verifiable quote.

```
basis/
  app/
    src/                  Electron main + preload + React renderer
    scripts/              monitor, diff-llm, brief-llm, xray, digest-llm, llm
                          lib/: edgar, filings, portfolio, data-dir, cli
    resources/            app icon
  packages/schema/        Shared data schemas + llm-config + extractJson (zod)
  docs/                   PRD and notes
```

## Getting started

```bash
npm install
cp app/.env.local.example app/.env.local   # add your OpenAI (or other) key
npm run dev
```

- Storage: your data lives in `~/Documents/Basis` (configurable in Settings; `BASIS_HOME` / `BASIS_DATA_DIR` override in dev).
- EDGAR asks for a contact email in the User-Agent (fair-access policy) — set it in Settings → Data Sources or `BASIS_EDGAR_CONTACT`.
- Model config is env-driven (`BASIS_LLM_PROVIDER` / `BASIS_LLM_MODEL` / `BASIS_LLM_BASE_URL`): OpenAI, Anthropic, or any OpenAI-compatible endpoint (Ollama, vLLM, gateways).

## Development

- Gate before every push: `npm run typecheck && npm test && npm run build`.
- Tests: vitest, two projects — Node (`packages/schema`, `app/scripts`) and jsdom (renderer).
- `packages/schema` must be built before anything imports it (`npm run build:schema`, wired as a `pre*` hook).
- Main-process/preload/engine-script changes need a dev-app restart (HMR only covers the renderer).
