// Scene geometry lint over every shipped track: builds the same static world the game shows
// (createWorld + createPieceTrack, as createScene / createView do), minus the renderer, and fails on
// paper-thin parts and on structural parts floating with nothing under them (lint.ts). The checker's
// own bite is proven on fixtures in lint.test.ts.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { LAP_NAMES, loadLap } from '../track/registry'
import { lintScene, type Offender } from './lint'
import { createWorld } from './scene'
import { createPieceTrack } from './track/kenney'

/**
 * Known offenders too big to fix in the PR that added the lint: each one names its follow-up.
 * Listed here they show as `it.todo` instead of failing; they are never allow-listed with a `flat` tag.
 */
const KNOWN: readonly { track: string; check: Offender['check']; mesh: string; followUp: string }[] = []

/**
 * Headless loading: glTF and other assets resolve from the repo's own files (Vite's `?url` gives
 * `/assets/...`), and the canvas-drawn sign and screen textures get a no-op 2D context.
 */
beforeAll(() => {
  THREE.DefaultLoadingManager.setURLModifier((u) => (u.startsWith('/') ? `http://local${u}` : u))
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.host === 'local') return new Response(readFileSync(`${process.cwd()}${decodeURIComponent(url.pathname)}`))
    return realFetch(input, init)
  }) as typeof fetch
  const g = globalThis as Record<string, unknown>
  g.ProgressEvent ??= class extends Event {
    lengthComputable = false
    loaded = 0
    total = 0
  }
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined), set: () => true })
  g.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
})

const buildScene = async (name: string): Promise<THREE.Group> => {
  const track = loadLap(name)
  const root = new THREE.Group()
  root.add(await createWorld(track), await createPieceTrack(track))
  return root
}

const known = (track: string, o: Offender) => KNOWN.some((k) => k.track === track && k.check === o.check && k.mesh === o.mesh)

describe('scene geometry lint', () => {
  it('covers every shipped track', () => {
    expect(LAP_NAMES.length).toBeGreaterThanOrEqual(23)
  })

  for (const k of KNOWN) it.todo(`${k.track}: ${k.check} ${k.mesh} — ${k.followUp}`)

  it.each(LAP_NAMES)('%s: no paper-thin or floating geometry', async (name) => {
    const scene = await buildScene(name)
    const result = lintScene(scene)
    // Independent of the lint's own walk: a raw traverse over the same scene.
    let traversed = 0
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) traversed++
    })
    process.stdout.write(`geometry-lint ${name}: ${result.meshes} meshes checked, ${traversed} traversed, ${result.structural} structural, flat ${JSON.stringify(result.flatByReason)}\n`)
    expect(result.meshes).toBe(traversed)
    expect(result.structural).toBeGreaterThan(0)
    const fresh = result.offenders.filter((o) => !known(name, o))
    expect(fresh.map((o) => `${o.check}: ${o.mesh} — ${o.detail}`)).toEqual([])
  })
})
