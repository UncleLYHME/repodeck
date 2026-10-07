// The commit-graph slice for one history row, drawn edge to edge so lanes join the rows above and below.

import { memo } from 'react'
import type { GraphRow } from '@shared/graph'

export const COLORS = ['#3584e4', '#ff7800', '#2ec27e', '#c061cb', '#e5a50a', '#e01b24', '#26c6da', '#f66151']
export const LANE_WIDTH = 14
const NODE_RADIUS = 4.5

const x = (col: number) => LANE_WIDTH * col + LANE_WIDTH / 2 + 2
const color = (i: number) => COLORS[i % COLORS.length]

export const GraphCell = memo(function GraphCell({ row, lanes, height }: { row: GraphRow; lanes: number; height: number }) {
  const width = lanes * LANE_WIDTH + 4
  const mid = height / 2
  return (
    <svg width={width} height={height} className="flex-none overflow-visible" aria-hidden="true">
      {row.lines.map(([kind, a, b, c], i) => {
        const xa = x(a)
        const xb = x(b)
        let d: string
        if (kind === 'pass') d = `M${xa} 0V${height}`
        else if (kind === 'in') d = a === b ? `M${xa} 0L${xb} ${mid}` : `M${xa} 0C${xa} ${mid * 0.6} ${xb} ${mid * 0.4} ${xb} ${mid}`
        else d = a === b ? `M${xa} ${mid}L${xb} ${height}` : `M${xa} ${mid}C${xa} ${mid * 1.6} ${xb} ${mid * 1.4} ${xb} ${height}`
        return <path key={i} d={d} stroke={color(c)} strokeWidth={2} strokeLinecap="round" fill="none" />
      })}
      {row.col >= 0 && <circle cx={x(row.col)} cy={mid} r={NODE_RADIUS} fill={color(row.color)} />}
    </svg>
  )
})
