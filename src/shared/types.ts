// Plain data shared by the core (git, stats) and the renderer. Everything here crosses a
// MessagePort, so it stays JSON-shaped: no classes, no Maps, no Dates.

export type ChangeKind = 'tracked' | 'untracked' | 'conflict'

export interface Change {
  path: string
  x: string // index status ("." when unchanged)
  y: string // worktree status
  kind: ChangeKind
  orig: string | null // rename/copy source
}

export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect'

export interface Status {
  branch: string
  oid: string
  upstream: string | null
  ahead: number
  behind: number
  operation: Operation | null // in progress
  changes: Change[]
}

export type RefKind = 'head' | 'tag' | 'remote' | 'branch'

export interface LogRow {
  sha: string
  fullSha: string
  parents: string[]
  refs: [RefKind, string][]
  subject: string
  author: string
  when: string // "3 hours ago"
}

export interface CommitFile {
  path: string
  letter: string // M A D R C T
  orig: string | null
}

export interface Hunk {
  header: string // the file's diff header lines
  body: string // "@@ ... @@" and its lines
}

export interface Branches {
  current: string
  local: [string, string][] // [name, upstream] most recent first
  remote: string[] // "origin/feature" with no local branch yet
}

export interface Profile {
  label: string
  name: string
  email: string
}

// -- what the core pushes to the renderer -----------------------------------------------

export interface Settings {
  autoFetch: boolean
  autoPull: boolean
  notify: boolean
  fetchMinutes: number
  updateChecks: boolean
  bannerMotion: boolean
  diffLayout: 'side' | 'unified'
  autostart: boolean
}

export interface GroupState {
  folder: string
  expanded: boolean
  watching: boolean // add projects that appear in the folder
  autoPull: boolean
  repos: string[]
}

export interface DeckState {
  settings: Settings
  groups: GroupState[]
  pinned: string[]
}

export interface Pending {
  label: string // "pull pending" | "syncs on push"
  why: string
}

export interface RepoState {
  path: string
  status: Status | null
  error: string | null
  identity: { name: string; email: string } | null
  stashes: string[] // "stash@{0}\x1fmessage"
  slug: string | null // GitHub owner/name
  busy: string | null // running user action
  fetchError: string | null
  fetchedAt: string | null // "14:05"
  pending: Pending | null
}

export interface HistoryState {
  path: string
  rows: LogRow[]
}

export type Who = 'auto' | 'you'
export type Level = 'info' | 'warn' | 'error'

export interface ActivityEntry {
  ts: number // seconds since the epoch
  message: string
  repo: string | null
  who: Who
  level: Level
}

export interface UpdateInfo {
  version: string
  // disk/remote: a git checkout (restart, or fast-forward then restart);
  // download: an installed copy has downloaded it (restart installs); manual: open the download page
  source: 'disk' | 'remote' | 'download' | 'manual'
  notes: string[]
  url?: string
}

export interface Capabilities {
  code: boolean // the `code` launcher is on PATH
  platform: string
}

export interface Snapshot {
  deck: DeckState
  repos: RepoState[]
  histories: HistoryState[]
  activity: ActivityEntry[]
  version: string
  update: UpdateInfo | null
  capabilities: Capabilities
  configDir: string
}

// -- dashboard and analytics ----------------------------------------------------------------

export interface DashboardActivity {
  days: [string, number][] // [YYYY-MM-DD, commits] oldest first
  total: number
  added: number
  deleted: number
  perRepo: Record<string, number>
  recent: [number, string, string, string, string][] // [ts, repo, subject, author, short sha]
}

export interface Services {
  found: [number, string, string][] // [port, repo, process]
  others: number
}

export interface PullRequest {
  repo: string
  number: number
  title: string
  url: string
  draft: boolean
}

export interface CiRun {
  workflowName: string
  headBranch: string
  conclusion?: string | null
  status?: string
  url: string
  createdAt: string
  displayTitle?: string
  repo?: string
}

export interface GithubDashboard {
  prs: { review: PullRequest[]; mine: PullRequest[] }
  ci: CiRun[]
  error: string | null
  stale?: string
  fetchedAt?: number
}

export interface ProjectStats {
  days: [string, number][] // last 30 days
  commits30: number
  commitsPrev30: number
  added30: number
  deleted30: number
  streak: number
  punchcard: [number, number, number][] // [weekday 0=Mon, hour, commits]
  hotFiles: [string, number, number][] // [path, commits, churn]
  authors: [string, number][]
  totalCommits: number
  firstCommit: number
  languages: [string, number][]
  branches: [string, number, string, boolean][] // [name, last commit ts, track, current]
  recent: [number, string, string, string][] // [ts, subject, author, short sha]
}

export interface ProjectGithub {
  prs: { number: number; title: string; url: string; isDraft: boolean; author?: { login: string }; headRefName?: string }[]
  runs: CiRun[]
  error: string | null
  slug: string | null
  stale?: string
  fetchedAt?: number
}

export interface CompareTexts {
  old: string
  new: string
  error?: string // binary, too large, unreadable
}

export interface HunkSet {
  unstaged: Hunk[]
  staged: Hunk[]
}

export interface DataInfo {
  cacheBytes: number
  activityEntries: number
  activityBytes: number
  configDir: string
}
