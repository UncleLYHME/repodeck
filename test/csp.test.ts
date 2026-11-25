import { describe, expect, it } from 'vitest'
import { CSP } from '../src/shared/csp'

const policy = new Map(CSP.split(';').map((directive) => {
  const [name, ...sources] = directive.trim().split(/\s+/)
  return [name, sources] as const
}))

describe('content security policy', () => {
  it('lets the page run only its own script files', () => {
    expect(policy.get('script-src')).toEqual(["'self'"])
    expect(CSP).not.toMatch(/unsafe-eval|wasm-unsafe-eval|strict-dynamic|unsafe-hashes/)
    for (const name of ['script-src-elem', 'script-src-attr']) expect(policy.has(name), name).toBe(false) // nothing widens script-src
  })

  it('refuses whatever it does not name, and names nothing on the network', () => {
    expect(policy.get('default-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'none'"]) // default-src doesn't cover these two
    expect(policy.get('form-action')).toEqual(["'none'"])
    for (const name of ['connect-src', 'frame-src', 'child-src', 'worker-src', 'object-src', 'media-src', 'font-src']) {
      expect(policy.has(name), name).toBe(false) // left to default-src 'none'
    }
    expect(CSP).not.toMatch(/https?:|wss?:|blob:|filesystem:|\*/)
  })

  it('allows inline styles and bundled images, the two things the page needs beyond its files', () => {
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(policy.get('img-src')).toEqual(["'self'", 'data:'])
    expect([...policy.keys()].sort()).toEqual(['base-uri', 'default-src', 'form-action', 'img-src', 'script-src', 'style-src'])
  })
})
