# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # Vite dev server (localStorage-only, no backend)
npm run build          # tsc typecheck + vite build -> dist/
npm test               # vitest run (one-shot, all tests)
npx vitest run src/lib/brackets.test.ts   # single test file
npx vitest -t "round robin"               # single test by name
npm run dev:server     # run the Node backend against an existing dist/ build
npm start              # production: node server/index.js (serves dist/ + API)
```

There is no lint step. Typechecking happens via `tsc` inside `npm run build`. Tests are vitest, configured in `vite.config.ts` with `environment: 'node'` and `globals: true`, and only cover the pure logic in `src/lib/` (no component/DOM tests).

To exercise the backend locally you must build first, since the server serves the built `dist/`:

```bash
npm run build && ADMIN_PASSCODE=local-admin npm run dev:server
```

## Architecture

A BJJ (Brazilian Jiu-Jitsu) tournament desk: a Vite + React 19 single-page app backed by a tiny dependency-free Node HTTP server for shared storage. Deployed on Railway (`railway.json`, healthcheck `/api/health`).

### Two halves that must stay in sync

1. **Client** (`src/`): all UI in one large `src/App.tsx` (~3800 lines, many sub-components in the same file), with pure domain logic factored into `src/lib/`.
2. **Server** (`server/index.js`): vanilla `node:http`, no framework, no dependencies. Serves static `dist/` with SPA fallback to `index.html`, plus a small JSON API.

Critically, `server/index.js` **re-implements** several functions that also live in `src/lib/` — `isTournamentStore`, `normalizeTournamentStore`, `isTournamentState`, `syncDivisionSeeds`, `createId`, and the application-draft logic. These are intentional duplicates (the server can't import TS modules). When you change store shape, validation, or the application/seed logic in `src/lib/storage.ts` or `src/App.tsx`, mirror it in `server/index.js`, and vice versa.

### Storage and the local/remote model

State is a `TournamentStore` = `{ activeTournamentId, tournaments: StoredTournament[] }` — the app holds **multiple** tournaments and switches the active one. The single source of truth in the UI is the `tournamentStore` React state in `App`; `commitTournament(updater)` is the one funnel that mutates the active tournament and bumps `updatedAt`.

Persistence is layered:
- **localStorage** always (`src/lib/storage.ts`, keys `bjj-tournament-desk-*`). `loadTournamentStore` also migrates a legacy single-tournament key.
- **Remote** (`src/lib/remoteStorage.ts`) is enabled when `VITE_API_BASE_URL` is set **or** the build is production (`import.meta.env.PROD`). When enabled, the app loads the store from `GET /api/tournament-store` on mount, and an **admin** session pushes the entire store via a 300ms-debounced `PUT` (see the effect in `App`). Writes authenticate with the `X-Admin-Passcode` header against `ADMIN_PASSCODE`.

The server stores everything in one JSON file (`data/tournament-store.json`, override with `DATA_DIR`; Railway volumes via `RAILWAY_VOLUME_MOUNT_PATH`). Writes are atomic (temp file + `rename`). If `ADMIN_PASSCODE` is unset, remote writes are **open** (logged as a warning).

### Session modes

`App` runs in one of three `SessionMode`s gated by `EntryScreen`:
- `entry` — landing screen; anyone can submit a competitor **application** (`POST /api/tournament-store/:id/applications`), which appends a competitor and re-seeds the chosen division server-side.
- `admin` — full editing tabs (competitors, divisions, brackets, schedule, results, import/export). Only admin sessions push to the backend.
- `guest` — read-only views (brackets, schedule, results) via `GuestApp` / `ReadOnly*` components.

### Bracket engine (`src/lib/brackets.ts`)

The most logic-dense module; covered by `brackets.test.ts`. Key concepts:
- A `Bracket` is a flat `Match[]`. A `Match` has `slotA`/`slotB`, each a `MatchSlot` that is one of: a fixed `competitorId`, a `bye`, or a **reference** to another match's `winner`/`loser` (`sourceMatchId` + `sourceOutcome`).
- `resolveSlot` / `resolveMatch` lazily walk those references to figure out who actually plays a match, with a `seen` set to guard against cycles. Nothing is "advanced" by mutation — winners propagate purely by resolving source references on read.
- Supported `TournamentFormat`s: `single-elimination`, `double-elimination-bronze` (adds a bronze bracket fed by main-bracket losers), `round-robin`, and `custom` (manually built matches). Seeding uses standard `seededPositions` with auto-byes to the next power of two.
- `normalizeBracketResults` runs after every edit and **invalidates** any recorded result whose winner/loser is no longer a valid participant, cascading until stable. Editing a slot can therefore wipe downstream results.
- `computeTournamentSchedule` lays matches across mats trying to maximize rest between an athlete's matches, and forces bronze finals then gold finals to the end. Placements come from `getPlacements` (final match winner/loser, or round-robin standings).

### Other `src/lib` modules
- `rulesets.ts` — win methods per ruleset (`points` / `submission-only` / `ebi`); `isSubmissionMethod` drives submission-type/time capture.
- `csv.ts` — hand-rolled CSV parser (quote-aware) with header aliasing for bulk competitor import.
- `types.ts` — all shared domain types; start here to understand the data model.
- `id.ts` — `createId(prefix)`, the client-side id scheme (mirrored in the server).
