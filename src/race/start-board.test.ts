import { describe, expect, it } from 'vitest'
import { TICK_HZ } from '../physics'
import { LapLoop } from './lap'
import { boardTime, startBoard, startLamps } from './start-board'
import { FLAT_OVAL } from './fixture.test-track'

describe('startLamps', () => {
  it.each([
    [null, ['off', 'off', 'off']],
    [3, ['red', 'off', 'off']],
    [2, ['red', 'red', 'off']],
    [1, ['red', 'red', 'red']],
    [0, ['green', 'green', 'green']],
  ] as const)('step %s lights %j', (step, lamps) => {
    expect(startLamps(step)).toEqual(lamps)
  })
})

describe('boardTime', () => {
  it.each([
    [0, '0:00.0'],
    [12_345, '0:12.3'],
    [12_399, '0:12.3'], // truncated, never ahead of the HUD
    [61_050, '1:01.0'],
    [-5, '0:00.0'],
  ])('%i ms reads %s', (ms, text) => {
    expect(boardTime(ms)).toBe(text)
  })
})

describe('startBoard', () => {
  it('shows READY and dark lights before Begin', () => {
    expect(startBoard('ready', null, 0)).toEqual({ lamps: ['off', 'off', 'off'], timer: '0:00.0', band: 'ready', bandText: 'READY' })
  })

  it('shows FINISH and the final time once finished', () => {
    expect(startBoard('finished', 0, 48_210)).toMatchObject({ timer: '0:48.2', band: 'finish', bandText: 'FINISH' })
  })

  // The real path: LapLoop's own countdown events drive the board, tick by tick, through GO and into the lap.
  it('follows the countdown red-red-red then green, 1 s per step, and runs the timer after GO', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    let step: number | null = null
    loop.on({ countdown: (_t, n) => (step = n) })
    let car = loop.spawn()
    loop.start(car.tick)
    const changes: [number, string, string, string][] = []
    for (let i = 1; i <= 5 * TICK_HZ; i++) {
      car = { ...car, tick: car.tick + 1 }
      loop.update(car)
      const b = startBoard(loop.phase, step, loop.lapTimeMs(car.tick))
      const row: [number, string, string, string] = [i, b.lamps.join(','), b.band, b.bandText]
      const prev = changes[changes.length - 1]
      if (!prev || prev[1] !== row[1] || prev[2] !== row[2]) changes.push(row)
    }
    expect(changes.map(([, ...rest]) => rest)).toEqual([
      ['red,off,off', 'count', '3'],
      ['red,red,off', 'count', '2'],
      ['red,red,red', 'count', '1'],
      ['green,green,green', 'go', 'GO!'],
    ])
    // One second per step: 2 and 1 land TICK_HZ apart, GO a further TICK_HZ later.
    expect(changes[2][0] - changes[1][0]).toBe(TICK_HZ)
    expect(changes[3][0] - changes[2][0]).toBe(TICK_HZ)
    // 5 s after Begin the run has been going for 2 s.
    expect(startBoard(loop.phase, step, loop.lapTimeMs(car.tick)).timer).toBe('0:02.0')
  })
})
