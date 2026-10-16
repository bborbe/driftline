# Vision

driftline is a single-player, Trackmania-like racing game that runs in the browser. It is a private hobby project: the goal is a build that loads at a private Cloudflare Pages URL, gated by Cloudflare Access to the owner and a few allow-listed friends, with one hand-built track, a lap timer with checkpoints and instant respawn, and a best-run ghost that drives alongside you on the next lap.

Handling is the heart of the game. The car should grip on asphalt, drift controllably under handbrake, land stably after airtime, and never feel floaty or twitchy at speed. Physics runs on a fixed 100 Hz timestep and is fully deterministic, so a recorded input stream replays the same run every time — the foundation for ghosts.

## Principles

- **Original assets only** — no Nadeo assets, branding, or decompiled code.
- **Deterministic physics** — same inputs, same run, on every machine.
- **Agent-friendly repo** — small isolated modules with fast unit tests, so most iteration can run autonomously.

## Non-goals

- Multiplayer or online leaderboards
- Multiple tracks or a track editor
- Polished gamepad or mobile controls
- Public access
