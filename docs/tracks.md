# Tracks

How the track list is built, what each track checks, and the optional per-track `theme` block. Players: see the [README](../README.md).

The start screen shows three groups (↑/↓ switches group, ←/→ picks a track); **Next track** on the finish panel stays inside the group.

- **Campaign** — numbered levels (`A01`, `A02`, …) in difficulty tiers (white → green → blue → red → black), each with author/gold/silver/bronze medals. Order and tiers live in `src/track/catalogue.ts`; a level is listed once its `assets/track/<name>.json` ships.
  - `A01 crossover` and `A02 tower` are multi-level: the road climbs onto concrete decks on pillars and passes over itself. crossover is a figure-eight with an 8 m bridge over the start straight, then a 10 m gap jump (a `gap` segment is open air) onto a 74 m landing slope. tower has a 60 m climb into a steep 34° banked 180 at 12 m, a bridge over the start straight and a 12 m drop into a banked turn. A checkpoint counts from 2 m below its road to 20 m above, so a road under a deck gate never triggers it, while a full-throttle jump over the arch still does.
  - `A03 plunge`, `A04 knot` and `A05 leap` are built entirely from the [track piece kit](track-kit.md), in rising difficulty. plunge climbs onto an 8 m deck and plunges two levels straight into a banked 180. knot is a figure-eight whose 8 m deck, entered and left through banked and deck curves, crosses over the start straight, then a dirt run and a hairpin switchback. leap climbs to 12 m and jumps a `gap-jump` onto a 4 m deck, banks round at 4 m, then ice into a banked 180, a red turbo and dirt.
- **Styles** — one kit track per Trackmania map style, `S01`–`S06`, each with medals and its own theme; listed in `STYLES` in `src/track/catalogue.ts`, and lapped by the surface-aware autopilot line (`surfaceLine()` in `src/race/autopilot.test-driver.ts`), which takes tight and low-grip corners slower. `src/race/styles.test.ts` checks each track has its own style and none of the others; see the table below.
- **Test** — tracks for checking one thing fast. `test1` and `test2` are the original lap1/lap2 (`?track=lap1` / `?track=lap2` still open them, and their best times, boards and medals carry over). The single-feature tracks are short ovals that an autopilot laps in ≤ 20 s with no respawn:

| Track | Checks |
|---|---|
| `test-flat` | grip, acceleration, top speed, hairpins; a turbo pad and 120 m straight into a gentle S-bend (r 150 m) taken at ~140 km/h |
| `test-ramp` | ramp jump and landing; a 120 m run-up reaches the ramp at ~135 km/h flat out |
| `test-bank` | banked 180° turns |
| `test-surfaces` | asphalt → dirt → ice → grass strips, and dirt mid-way round the first hairpin |
| `test-turbo` | yellow and red turbo pads |
| `test-effects` | effect pads: no-steer, cruise, fragile, engine-off, slow-mo, then reset |
| `test-checkpoint` | four checkpoints in a row: split deltas, respawn at the last one |
| `test-loop` | one full vertical loop (r 15 m): stays on through the top at speed, falls off and respawns when too slow |
| `test-wallride` | two velodrome 180s (r 30 m) whose outer edge rises into a near-vertical wall: held from 9.3 m/s, slides down when slower |
| `test-spiral` | a corkscrew loop (r 15 m) whose road drifts 20 m sideways, checkpoint at the top |

| Style level | Track | Style | What makes it that style |
|---|---|---|---|
| `S01` | `switchback` | Tech | ten tight turns (r 10 m kinks and hairpins) on asphalt and dirt; lift and turn in, again and again |
| `S02` | `flatout` | Fullspeed | throttle held all lap, never a brake: two r 80 m banked 180s (`bank-180-wide`) and two 8 m climbs and drops |
| `S03` | `dustbowl` | Dirt | an asphalt lap (~70 %) with three short walled dirt sections — a dirt chicane, a dirt corner, a dirt straight — a wide r 30 m sweeper, a bridge corner over a hill, a tight r 10 m into the finish |
| `S04` | `glacier` | Ice | an asphalt lap (~75 %) with two short walled ice sections, each through a banked ice turn; tight S-bends, an overpass straight over a hill, wide r 30 m sweepers |
| `S05` | `washboard` | LOL | a red turbo straight into five bumps in a row; a 10–20 s lap |
| `S06` | `looping` | Loop | a turbo straight into one full vertical loop, then a banked 180 and two climbs and drops |
| `S07` | `velodrome` | Wallride | a climb and a turbo into a velodrome wall, a left and a right spiral down the back straight, a second wall home |

Any other `assets/track/test*.json` joins the Test group; any other track not in `STYLES` joins the end of the campaign.

## Track themes

A track file may carry an optional `theme` block that changes its look without touching its layout: it is render-only, not part of the layout id (records carry over), and it works the same in spline tracks and `kit` tracks. Every field is optional; an absent field keeps the default stadium look, and a track with no `theme` renders exactly as before. Test tracks stay on the default. Format and validation: `src/track/theme.ts`; defaults: `src/render/theme.ts`.

```json
"theme": {
  "sky": "night",
  "skyLight": 0.6,
  "exposure": 0.9,
  "fog": "#141c33", "fogNear": 120, "fogFar": 700,
  "sun": "#9fb4ff", "sunIntensity": 0.7,
  "ground": "#3d5a6b",
  "curb": "#00c8ff",
  "sign": "#ff3df0",
  "screen": "#7a1fa8",
  "scenery": ["tree_default_dark", "rock_tallA"]
}
```

| Field | Default | What it changes |
|---|---|---|
| `sky` | `day` | Background and image-based light: `day`, `sunset`, `dusk`, `night` or `overcast` (Poly Haven CC0 HDRIs in `assets/sky/`) |
| `skyLight` | `0.45` | Strength of the light the sky casts |
| `exposure` | `1` | Tone-mapping exposure; below 1 darkens the whole frame |
| `fog`, `fogNear`, `fogFar` | `#b9d4e8`, 250, 1200 | Distance fog colour (match the sky's horizon) and its start / full distance in metres |
| `sun`, `sunIntensity` | `#fff4e0`, 2.2 | Sun colour and strength (shadows follow it) |
| `ground` | `#7fc25a` | Grass tint |
| `curb` | red | Curb stripe accent, alternating with white |
| `sign` | yellow | Turn-sign chevrons on the black boards; turbo signs keep their yellow / red |
| `screen` | navy blue | Arena screen background |
| `scenery` | six trees and rocks | Kenney Nature Kit models (`assets/nature-kit/<name>.glb`) the roadside scenery picks from; add a model's glb there to use it |

Colours are `#rrggbb`. An unknown key, a bad colour or an unknown sky fails validation, so a typo never silently does nothing.
