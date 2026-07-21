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

### Added (video-studio era, pre-pivot)

- **Editor redesign (Figma V0, 4 phases)** — new shell (header with centered
  filename, undo/redo, presets dropdown, export; left input rail with prompt +
  generate, clips and audio upload/record; floating device preview; pill-tab
  right panel), a combined Inspector (Design: alignment/padding/typography/
  palette/captions; Format: fps, aspect ratio, resolution; Back-headed clip
  subflows for text/video/audio), Style tab with reference modes
  (literal/inspired) and read-only style guide, Critique tab with score card +
  detail subflow and Auto-improve, timeline rework (dynamic renamable layers,
  music/voiceover split tracks, Layer button, transport bar with Space
  play/pause, action-token chips, text-sketch and click-to-add empty lanes,
  drag assets from the rail), EDL undo/redo history (Cmd+Z / Shift+Cmd+Z) and
  a tabbed Settings modal (General / Export / Agent). Schema gains
  `theme.textAlignment`, `styleProfile.referenceMode`, and optional track
  `name`; generation prompts are format-aware.

- **Visual language refactor (Home + New Project dialog)** — new design-token
  system (`styles/tokens.css`, light authoritative + derived dark), Bradford
  brand font scaffolding with SF Pro as the UI stack, a custom icon set
  harvested from Figma (38 SVGs, `currentColor`-normalized) behind a typed
  `Icon` component, componentized UI primitives (`Button`, `IconButton`,
  `Badge`, `Modal`, `Field`/`Input`/`TextArea`/`Select`), a Figma-faithful Home
  page (header, welcome hero, 240x300 project cards with status badges +
  relative time, dashed new-project card) and restyled New Project dialog. The
  editor is retinted onto the new tokens pending its own redesign.

- **Testing foundation** — Vitest with two projects (Node for `packages/edl` +
  `app/scripts`, jsdom for the renderer), covering the EDL schema, the
  `sanitizeEdl`/`enforceStyle`/`metrics` helpers, critique scoring, EDL edits,
  text animations, the store (autosave/routing/theme), and a `LeftPanel` render
  regression guard for the rules-of-hooks crash. `npm test` / `npm run test:watch`.
- **CI** — GitHub Actions workflow running `npm ci`, build, typecheck, and tests
  on every pull request and push to `main`.
- **Repo hygiene** — this changelog and a pull request template.
- **Style Library** — a reusable, creator-level look: bulk-import a folder of
  reference videos (native picker), analyze once (`analyze-collection.mjs`,
  GPT-5.5 vision distills a style guide + per-reference exemplars, with a
  deterministic fallback), and reuse across projects; per-project `references/`
  override when present.
- **Color grade** — `theme.grade` (brightness/contrast/saturation/temperature/
  vignette) rendered as a CSS filter on clips in preview and export.
- **LLM everywhere** — provider-agnostic layer (Vercel AI SDK, default OpenAI
  GPT-5.5, env-configurable) powering Generate, Critique, and Auto-improve, each
  with an offline deterministic fallback. Local, gitignored `app/.env.local`.
- **Creator pipeline** — project homepage (create/open/delete, thumbnails),
  clip upload, editable prompt, music attach + bundled library, voiceover
  upload/record with auto-transcribed captions and music ducking, per-project
  aesthetic learning, named style presets, and benchmark-aware critique.
- **Editor/platform** — `edl.json` autosave + file-watch live reload, light/dark
  theme, root error boundary, and toasts.

### Changed

- Rebranded **Reel Studio -> Aperture** (window title, macOS app/dock name, icon,
  docs).
- Generation is style-faithful: injects the style guide + top exemplars and
  deterministically stamps palette/font/captions/grade.
- EDL package: added `meta`, `style`, and `benchmark` schemas; audio-clip `role`;
  `theme.stylePreset` and `theme.grade`; fixed the ESM build so the schema
  imports cleanly from Node scripts.

### Fixed

- Rules-of-hooks crash that blanked the editor when a project loaded.
- Generation silently falling back to the baseline when the model omitted a
  required `anim.name` (now repaired by `sanitizeEdl`).
- Reasoning-model incompatibility (dropped unsupported `temperature`).

## [0.1.0] - Initial commit

- Scaffold: Electron + Vite + React editor, shared `packages/edl` schema,
  Remotion preview/export spine, and the `create-social-video` /
  `critique-video` Claude Code skills.
