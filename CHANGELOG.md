# Changelog

All notable changes to Basis are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so everything lives under "Unreleased" until we start tagging
versions.

## [Unreleased]

### Changed

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
