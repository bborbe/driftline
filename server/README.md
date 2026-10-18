# driftline leaderboard server

Go service behind the online leaderboard: it stores submitted runs in SQLite and will serve the per-track best times. This is the skeleton (milestone L1): health endpoints and the database schema only — no submit / list API yet, no deployment.

## Run locally

```bash
cd server
make run          # listens on localhost:8080, database in server/data/leaderboard.db
curl localhost:8080/healthz      # {"status":"ok"}
curl localhost:8080/readiness    # OK while the database answers
```

`make run` sets a local token and allows the Vite dev server (`http://localhost:5173`) as origin. `PORT=9090 make run` picks another port.

## Configuration

Every setting is an environment variable (or the matching `-flag`):

| Env | Flag | Required | Meaning |
|---|---|---|---|
| `DB_PATH` | `-db-path` | yes | SQLite database file; created with its schema if missing. The directory must exist. The image defaults it to `/data/leaderboard.db` |
| `TOKEN` | `-token` | yes | Shared token the game sends with a submitted run (printed only as its length) |
| `ALLOWED_ORIGIN` | `-allowed-origin` | yes | Origin allowed to call the API, `scheme://host[:port]` with no path, e.g. `https://bborbe.github.io` |
| `LISTEN` | `-listen` | no | Listen address, default `:8080` |
| `SENTRY_DSN` | `-sentry-dsn` | no | Sentry DSN; empty disables error reporting |

## Endpoints

| Path | Answers |
|---|---|
| `/healthz` | `200 {"status":"ok"}` while the process runs (liveness) |
| `/readiness` | `200 OK` while the database answers a ping, else `503` |
| `/metrics` | Prometheus metrics |

## Storage

SQLite through `modernc.org/sqlite` (pure Go, no cgo), one file, WAL mode. `pkg/storage` applies the numbered migrations in `migrations` on open, each once, recorded in `schema_migrations`; append a new migration, never edit a shipped one.

`runs` (migration 1): `id`, `player`, `track`, `total_ticks` (lap time in 100 Hz physics ticks), `checkpoint_ticks` (JSON array of the split ticks), `ghost` (the recorded inputs, BLOB), `created_at` (UTC, RFC 3339).

## Docker

```bash
cd server
make build                                      # image driftline-leaderboard:dev
docker run --rm -p 8080:8080 -v "$PWD/data:/data" \
  -e TOKEN=local-dev-token -e ALLOWED_ORIGIN=http://localhost:5173 \
  driftline-leaderboard:dev
```

The image is `scratch` with a static binary; the database lives on the `/data` volume.

## Checks

`make test` runs the Go tests (CI job `server` in `.github/workflows/ci.yml`); `make precommit` adds formatting, mock generation, lint, vet, errcheck, govulncheck, osv-scanner, gosec and trivy — run it before every commit that touches `server/`.
