import { describe, expect, it } from 'vitest'
import { continuation, layout, type GraphRow, type LineKind } from '../src/shared/graph'

const edges = (row: GraphRow, kind: LineKind) =>
  row.lines.filter(([k]) => k === kind).map(([, a, b]) => [a, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1])

describe('graph layout', () => {
  it('keeps linear history in one lane', () => {
    const rows = layout([['c', ['b']], ['b', ['a']], ['a', []]])
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0])
    expect(edges(rows[0], 'in')).toEqual([]) // branch tip: nothing above
    expect(edges(rows[1], 'in')).toEqual([[0, 0]])
    expect(edges(rows[2], 'out')).toEqual([]) // root: nothing below
  })

  it('opens a lane for a merge and rejoins the branch', () => {
    // M merges F into main; F and B both sit on A.
    const [m, f, b, a] = layout([['M', ['B', 'F']], ['F', ['A']], ['B', ['A']], ['A', []]])
    expect(edges(m, 'out')).toEqual([[0, 0], [0, 1]])
    expect([f.col, edges(f, 'pass')]).toEqual([1, [[0, 0]]])
    expect([b.col, edges(b, 'pass')]).toEqual([0, [[1, 1]]])
    expect(edges(a, 'in')).toEqual([[0, 0], [1, 0]]) // both lines converge on A
    expect(edges(a, 'pass')).toEqual([])
  })

  it('keeps lanes continuous between rows', () => {
    // Every line leaving the bottom of a row must enter the top of the next row in the same column.
    const rows = layout([['T2', ['X']], ['M', ['B', 'F']], ['X', ['B']], ['F', ['A']], ['B', ['A']], ['A', []]])
    for (let i = 0; i + 1 < rows.length; i++) {
      const bottoms = new Set(rows[i].lines.filter(([k]) => k === 'pass' || k === 'out').map(([, , b]) => b))
      const tops = new Set(rows[i + 1].lines.filter(([k]) => k === 'pass' || k === 'in').map(([, a]) => a))
      expect(tops).toEqual(bottoms)
    }
  })

  it('carries lanes below a commit with continuation rows', () => {
    const rows = layout([['M', ['B', 'F']], ['F', ['A']], ['B', ['A']], ['A', []]])
    const cont = continuation(rows[0])
    expect(cont.col).toBe(-1)
    expect(edges(cont, 'pass')).toEqual([[0, 0], [1, 1]]) // merge opened lane 1 below M
    expect(edges(continuation(rows[3]), 'pass')).toEqual([]) // nothing below the root
  })
})
