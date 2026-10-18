# 0001 — Leaderboard server: Go service with SQLite, in this repo

- Status: accepted
- Date: 2026-10-18

## Context

The online leaderboard (phase 5) needs a server that stores submitted runs — player, track, lap ticks, checkpoint splits and the ghost — and serves per-track best times to the game on GitHub Pages. Traffic is tiny (one game, a handful of players), there is one writer, and the operator already runs Go services on a home Kubernetes cluster.

## Decision

- **Go**, in the bborbe go-skeleton layout (`bborbe/service`, `pkg/factory`, `pkg/handler`, Ginkgo tests), so it builds, tests and deploys like the operator's other services.
- **SQLite** through the pure-Go `modernc.org/sqlite` driver: one file on a persistent volume, no cgo, so the image stays a static `scratch` binary. Schema changes are numbered migrations applied on open.
- **In this repo** under `server/`, as its own Go module, so a change to the run format and the server that validates it land in one pull request.
- **Hosted on the operator's Kubernetes cluster**, called from the game with a shared token and an origin allow-list (deployment is a later milestone).

## Alternatives rejected

- **Postgres** — a second stateful service to run and back up for a dataset that fits in one file.
- **A hosted backend (Firebase, Supabase)** — an external account and SDK in a game that has none, and data outside the operator's infrastructure.
- **cgo SQLite (`mattn/go-sqlite3`)** — needs a C toolchain in the build and a libc in the image.
- **A separate repository** — the server validates the game's own run format; splitting them invites drift between the two.

## Consequences

- One writer at a time (`SetMaxOpenConns(1)`, WAL mode); fine at this scale, the first thing to revisit if writes ever contend.
- The database is a single file on a volume: backup is a file copy, and the pod cannot scale horizontally.
- Migrating to Postgres later means a data export plus a driver and SQL dialect change in `pkg/storage`.
