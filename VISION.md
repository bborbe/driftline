# Vision

driftline is a single-player, Trackmania-like racing game that runs in the browser. It is a hobby project in a public repo: the goal is a build that loads at an unlisted GitHub Pages site (https://bborbe.github.io/driftline/), shared with the owner and a few friends and auto-deployed on every merge to `master`, with a campaign of hand-built tracks (A01–A05) and one style track per Trackmania map style (S01–S07), a lap timer with checkpoints and instant respawn, per-track medals, a best-run ghost and gold / author medal ghosts that drive alongside you, shareable challenge links, and play by keyboard or gamepad.

Handling is the heart of the game. The car should grip on asphalt, drift controllably under handbrake, land stably after airtime, and never feel floaty or twitchy at speed. Physics runs on a fixed 100 Hz timestep and is fully deterministic, so a recorded input stream replays the same run every time — the foundation for ghosts.

## Principles

- **Original assets only** — no Nadeo assets, branding, or decompiled code.
- **Deterministic physics** — same inputs, same run, on every machine.
- **Agent-friendly repo** — small isolated modules with fast unit tests, so most iteration can run autonomously.

## Non-goals

- A track editor
- Mobile or touch controls
- Access control on the site (the URL is unlisted, not gated)

## On hold

- Online leaderboard (the server in `server/` is built but not deployed)
- Live multiplayer
