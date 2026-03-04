// tests/github/commenter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPRHeadSha, classifyComments, postReview, parseDiffLines, findNearestLine } from '../../src/github/commenter'

// Mock child_process — all exported functions use execSync
vi.mock('child_process', () => ({
  execSync: vi.fn()
}))

import { execSync } from 'child_process'

beforeEach(() => {
  vi.resetAllMocks()
  // Default: getRepo returns a repo string
  vi.mocked(execSync).mockImplementation((cmd: string) => {
    if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
      return 'https://github.com/owner/repo.git'
    }
    return ''
  })
})

describe('getPRHeadSha', () => {
  it('returns head SHA for valid PR number', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('headRefOid')) return 'abc123\n'
      return 'https://github.com/owner/repo.git'
    })
    expect(getPRHeadSha('42')).toBe('abc123')
  })

  it('rejects non-numeric PR numbers', () => {
    expect(() => getPRHeadSha('123; rm -rf /')).toThrow('Invalid PR number')
  })

  it('rejects alphabetic PR numbers', () => {
    expect(() => getPRHeadSha('abc')).toThrow('Invalid PR number')
  })
})

describe('classifyComments', () => {
  it('classifies inline comments when line is in diff', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/files')) {
        return JSON.stringify([{
          filename: 'src/auth.ts',
          patch: '@@ -1,3 +1,5 @@\n context\n+added line 2\n+added line 3\n context\n context'
        }])
      }
      return ''
    })

    const result = classifyComments('1', [
      { path: 'src/auth.ts', line: 2, body: 'issue here' }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].mode).toBe('inline')
  })

  it('classifies file-level when line not in diff', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/files')) {
        return JSON.stringify([{
          filename: 'src/auth.ts',
          patch: '@@ -1,3 +1,3 @@\n context\n-old\n+new\n context'
        }])
      }
      return ''
    })

    const result = classifyComments('1', [
      { path: 'src/auth.ts', line: 999, body: 'not on diff' }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].mode).toBe('file')
  })

  it('classifies global when file not in diff', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/files')) {
        return JSON.stringify([{
          filename: 'src/other.ts',
          patch: '@@ -1,3 +1,3 @@\n context'
        }])
      }
      return ''
    })

    const result = classifyComments('1', [
      { path: 'src/missing.ts', line: 10, body: 'file not in PR' }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].mode).toBe('global')
  })

  it('reclassifies as inline with nearest diff line when exact line not found', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/files')) {
        // Diff hunk covers lines 1-5
        return JSON.stringify([{
          filename: 'src/auth.ts',
          patch: '@@ -1,5 +1,5 @@\n context\n-old\n+new\n context\n context\n context'
        }])
      }
      return ''
    })

    const result = classifyComments('1', [
      { path: 'src/auth.ts', line: 7, body: 'issue near diff' }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].mode).toBe('inline')
    // Line adjusted to nearest diff line, body prefixed with original line reference
    expect(result[0].input.body).toContain('**Line 7:**')
    expect(result[0].input.body).toContain('issue near diff')
  })

  it('falls back to file mode when line is too far from diff', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/files')) {
        // Diff hunk covers lines 1-3
        return JSON.stringify([{
          filename: 'src/auth.ts',
          patch: '@@ -1,3 +1,3 @@\n context\n-old\n+new\n context'
        }])
      }
      return ''
    })

    const result = classifyComments('1', [
      { path: 'src/auth.ts', line: 100, body: 'way too far' }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].mode).toBe('file')
  })

  it('rejects non-numeric PR numbers', () => {
    expect(() => classifyComments('abc', [])).toThrow('Invalid PR number')
  })
})

describe('parseDiffLines', () => {
  it('extracts right-side line numbers from a unified diff', () => {
    const patch = '@@ -1,3 +1,4 @@\n context\n+added\n context\n context'
    const lines = parseDiffLines(patch)
    // Line 1 = context, line 2 = added, line 3 = context, line 4 = context
    expect(lines.has(1)).toBe(true)
    expect(lines.has(2)).toBe(true)
    expect(lines.has(3)).toBe(true)
    expect(lines.has(4)).toBe(true)
  })

  it('skips removed lines', () => {
    const patch = '@@ -1,3 +1,2 @@\n context\n-removed\n context'
    const lines = parseDiffLines(patch)
    expect(lines.has(1)).toBe(true)
    expect(lines.has(2)).toBe(true)
    expect(lines.size).toBe(2)
  })
})

describe('findNearestLine', () => {
  it('returns exact match', () => {
    expect(findNearestLine(new Set([5, 10, 15]), 10)).toBe(10)
  })

  it('returns closest line within threshold', () => {
    expect(findNearestLine(new Set([5, 10, 15]), 12)).toBe(10)
  })

  it('returns null when empty set', () => {
    expect(findNearestLine(new Set(), 10)).toBeNull()
  })

  it('returns null when all lines are too far away', () => {
    expect(findNearestLine(new Set([1, 2, 3]), 50)).toBeNull()
  })

  it('returns line at exactly 20 distance', () => {
    expect(findNearestLine(new Set([30]), 10)).toBe(30)
  })

  it('returns null at 21 distance', () => {
    expect(findNearestLine(new Set([31]), 10)).toBeNull()
  })
})

describe('postReview', () => {
  it('rejects non-numeric PR numbers', () => {
    expect(() => postReview('abc', [], 'SHA')).toThrow('Invalid PR number')
  })

  it('posts inline comments via reviews API', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/comments --paginate')) {
        return ''
      }
      if (typeof cmd === 'string' && cmd.includes('/reviews')) {
        return '{}'
      }
      return ''
    })

    const classified = [
      { input: { path: 'src/auth.ts', line: 10, body: 'fix this' }, mode: 'inline' as const }
    ]
    const result = postReview('1', classified, 'SHA123')
    expect(result.posted).toBe(1)
    expect(result.inline).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('skips duplicate comments', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/comments --paginate')) {
        return '{"path":"src/auth.ts","line":10,"body":"fix this already posted"}'
      }
      return ''
    })

    const classified = [
      { input: { path: 'src/auth.ts', line: 10, body: 'fix this already posted' }, mode: 'inline' as const }
    ]
    const result = postReview('1', classified, 'SHA123')
    expect(result.skipped).toBe(1)
    expect(result.posted).toBe(0)
  })

  it('reports empty result when no comments', () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git remote get-url')) {
        return 'https://github.com/owner/repo.git'
      }
      if (typeof cmd === 'string' && cmd.includes('/comments --paginate')) {
        return ''
      }
      return ''
    })

    const result = postReview('1', [], 'SHA')
    expect(result.posted).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.details).toHaveLength(0)
  })
})
