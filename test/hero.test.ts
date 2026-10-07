import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { greeting, phaseFor } from '../src/shared/time'

describe('hero', () => {
  it('picks the phase and greeting by hour', () => {
    expect([4, 5, 7, 8, 16, 17, 19, 20, 23].map(phaseFor))
      .toEqual(['night', 'dawn', 'dawn', 'day', 'day', 'dusk', 'dusk', 'night', 'night'])
    expect([6, 13, 18, 2].map(greeting))
      .toEqual(['Good morning', 'Good afternoon', 'Good evening', 'Burning the midnight oil'])
  })

  it('has every layer for every phase', () => {
    for (const phase of ['dawn', 'day', 'dusk', 'night']) {
      for (const layer of ['sky', 'sky2', 'clouds', 'beam', 'fg']) {
        expect(existsSync(join('data/hero', phase, `${layer}.png`)), `${phase}/${layer}`).toBe(true)
      }
    }
  })
})
