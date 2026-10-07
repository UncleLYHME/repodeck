// Every test gets an isolated git config/identity and a throwaway cache and activity log,
// the same isolation tests/test_git.py gives the Python suite.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENV } from '../src/core/git/run'
import { Cache, setSharedCache } from '../src/core/cache'
import { ActivityLog, setSharedActivity } from '../src/core/activity'

Object.assign(ENV, {
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x',
})

const dir = mkdtempSync(join(tmpdir(), 'repodeck-test-cache-'))
setSharedCache(new Cache(join(dir, 'cache.json')))
setSharedActivity(new ActivityLog(join(dir, 'activity.jsonl')))
