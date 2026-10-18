# driftline leaderboard server

Go service behind the online leaderboard: it validates submitted laps, keeps each player's best per track in SQLite, and serves the per-track board and the stored ghosts. Milestones L1 (skeleton) and L2 (API); not deployed yet.

## Run locally

```bash
cd server
make run          # listens on localhost:9090, database in server/data/leaderboard.db
curl localhost:9090/healthz      # {"status":"ok"}
curl localhost:9090/readiness    # OK while the database answers
```

`make run` sets a local token and allows the Vite dev server (`http://localhost:5173`) as origin. `PORT=9091 make run` picks another port.

## Configuration

Every setting is an environment variable (or the matching `-flag`):

| Env | Flag | Required | Meaning |
|---|---|---|---|
| `DB_PATH` | `-db-path` | yes | SQLite database file; created with its schema if missing. The directory must exist. The image defaults it to `/data/leaderboard.db` |
| `TOKEN` | `-token` | yes | Shared token the game sends with a submitted run (printed only as its length) |
| `ALLOWED_ORIGIN` | `-allowed-origin` | yes | Origin allowed to call the API, `scheme://host[:port]` with no path, e.g. `https://bborbe.github.io` |
| `LISTEN` | `-listen` | no | Listen address, default `:9090` (the bborbe admin port; the API shares it under `/api/1.0/`) |
| `SENTRY_DSN` | `-sentry-dsn` | no | Sentry DSN; empty disables error reporting |

## Endpoints

| Path | Answers |
|---|---|
| `/healthz` | `200 {"status":"ok"}` while the process runs (liveness) |
| `/readiness` | `200 OK` while the database answers a ping, else `503` with a JSON error (`UNAVAILABLE`) |
| `/metrics` | Prometheus metrics |
| `/setloglevel/{level}` | Raise the glog verbosity for 5 minutes |
| `/gc` | Run the garbage collector |

## API

Every `/api/1.0/` request needs the header `X-Driftline-Token: <TOKEN>` and `Origin: <ALLOWED_ORIGIN>`; a wrong or missing token is `401`, any other origin `403`. A CORS preflight (`OPTIONS`) from the allowed origin answers `204` with `Access-Control-Allow-Origin`, `-Methods: GET, POST, OPTIONS` and `-Headers: Content-Type, X-Driftline-Token`. This deters, it does not secure: the token ships in the game's JavaScript. Errors are JSON, `{"error":{"code":"VALIDATION_ERROR","message":"<reason>"}}`.

| Method + path | Request | Answer |
|---|---|---|
| `POST /api/1.0/runs` | `{"name","track","totalTicks","checkpointTicks","ghost"}` — one finished lap; `ghost` is the game's ghost object (`ghostPayload` in `src/challenge/link.ts`: `{s, keys, scale?, ms}` or `{s, r, ms}`) | `201 {"id","best":true}` when stored as the player's best on the track, `200 {"id","best":false}` when an equal or faster run is already stored (`id` is the stored run) |
| `GET /api/1.0/tracks/{track}/runs?limit=N` | `limit` 1–100, default 10 | `200 [{"id","name","totalTicks","checkpointTicks","createdAt"}]`, fastest first, ties earlier first; unknown track `404` |
| `GET /api/1.0/runs/{id}/ghost` | — | `200` the stored ghost object (compacted JSON); unknown id `404` |

A submission is rejected, and nothing is stored, when:

| Check | Rule | Status |
|---|---|---|
| body size | at most 256 KiB | 413 |
| body shape | one JSON object, all five fields, no other field | 400 |
| name | 1–12 characters of `A-Z 0-9 space _ . -`, no leading or trailing space | 400 |
| track | listed in `pkg/track/tracks.json` | 400 |
| total ticks | at least the track's `floorTicks`, at most 60 000 | 400 |
| checkpoints | one split per checkpoint gate, strictly increasing, each inside the lap (`0 < t < totalTicks`) | 400 |
| ghost | `s` is 17 numbers; packed `keys` or numeric runs `r` (counts integer ≥ 1) decode; decoded ticks equal `totalTicks`; `ms` equals `totalTicks × 10` | 400 |

Ticks are 100 Hz physics ticks counted from the lap's start; splits too.

### Track table

`pkg/track/tracks.json` (embedded) lists every shipped track with a start-finish gate and an author medal: its checkpoint count and `floorTicks`, half the author medal in ticks. It is generated from the game's own track loader — never edit it — together with the Go tests' golden run (`pkg/run/testdata/golden-run.json`, one autopilot lap on `test1` encoded by the game):

```bash
UPDATE_SERVER_TRACKS=1 npx vitest run src/leaderboard/server-tables.test.ts   # repo root
```

`npm test` fails when `tracks.json` no longer matches the tracks. Re-generate after a track, medal or ghost-encoding change.

## Storage

Why Go + SQLite: `docs/adr/0001-leaderboard-server-go-sqlite.md`.

SQLite through `modernc.org/sqlite` (pure Go, no cgo), one file, WAL mode. `pkg/storage` applies the numbered migrations in `migrations` on open, each once, recorded in `schema_migrations`; append a new migration, never edit a shipped one.

`runs` (migration 1): `id`, `player`, `track`, `total_ticks` (lap time in 100 Hz physics ticks), `checkpoint_ticks` (JSON array of the split ticks), `ghost` (the ghost object as JSON, BLOB), `created_at` (UTC, RFC 3339). Migration 2 makes `(player, track)` unique: a faster run replaces the player's row in place (same `id`, new `created_at`).

## Docker

```bash
cd server
make build                                      # image driftline-leaderboard:dev
docker run --rm -p 9090:9090 -v "$PWD/data:/data" \
  -e TOKEN=local-dev-token -e ALLOWED_ORIGIN=http://localhost:5173 \
  driftline-leaderboard:dev
```

The image is `scratch` with a static binary; the database lives on the `/data` volume.

## Checks

`make test` runs the Go tests (CI job `server` in `.github/workflows/ci.yml`); `make precommit` adds formatting, mock generation, lint, vet, errcheck, govulncheck, osv-scanner, gosec and trivy — run it before every commit that touches `server/`.
