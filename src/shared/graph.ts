/* Commit-graph lane layout.

`layout` assigns every commit a column and lists the line segments crossing its row:
  pass  a lane running straight through the row
  in    a lane arriving at this commit (top half, may curve into the node)
  out   an edge leaving this commit for a parent's lane (bottom half)
Rows are drawn independently but edges meet exactly at row boundaries, so lines stay continuous.
*/

export type LineKind = 'pass' | 'in' | 'out'
export type Line = [LineKind, number, number, number] // kind, from col, to col, color

export interface GraphRow {
  col: number // -1 for a continuation row (lines only)
  color: number
  lines: Line[]
}

export const MAX_LANES = 12

function slot(lanes: (string | null)[], colors: number[]): number {
  const free = lanes.indexOf(null)
  if (free >= 0) return free
  lanes.push(null)
  colors.push(0)
  return lanes.length - 1
}

/** commits: [sha, parent shas] newest first, children before parents. */
export function layout(commits: [string, string[]][]): GraphRow[] {
  const lanes: (string | null)[] = [] // sha each column is waiting for
  const colors: number[] = [] // color index per column
  let nextColor = 0
  const rows: GraphRow[] = []
  for (const [sha, parents] of commits) {
    let col = lanes.indexOf(sha)
    if (col < 0) {
      // branch tip: start a new lane
      col = slot(lanes, colors)
      colors[col] = nextColor++
    }
    const nodeColor = colors[col]

    const lines: Line[] = []
    lanes.forEach((waiting, i) => {
      if (waiting === sha) {
        lines.push(['in', i, col, colors[i]])
        if (i !== col) lanes[i] = null // this branch line ends here
      } else if (waiting !== null) {
        lines.push(['pass', i, i, colors[i]])
      }
    })

    lanes[col] = parents.length ? parents[0] : null
    if (parents.length) lines.push(['out', col, col, colors[col]])
    for (const parent of parents.slice(1)) {
      let j = lanes.indexOf(parent)
      if (j < 0) {
        j = slot(lanes, colors)
        lanes[j] = parent
        colors[j] = nextColor++
      }
      lines.push(['out', col, j, colors[j]])
    }

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }
    rows.push({ col, color: nodeColor, lines })
  }
  return rows
}

/** A node-less row carrying the lanes below `row` straight down (for rows inserted under it). */
export function continuation(row: GraphRow): GraphRow {
  const lanes = new Map<number, number>()
  for (const [kind, , b, color] of row.lines) if (kind === 'pass' || kind === 'out') lanes.set(b, color)
  const lines: Line[] = [...lanes.entries()].sort((a, b) => a[0] - b[0]).map(([col, color]) => ['pass', col, col, color])
  return { col: -1, color: 0, lines }
}

export function laneCount(rows: GraphRow[]): number {
  let used = 1
  for (const r of rows) {
    let m = r.col
    for (const [, a, b] of r.lines) m = Math.max(m, a, b)
    used = Math.max(used, m + 1)
  }
  return Math.min(used, MAX_LANES)
}
