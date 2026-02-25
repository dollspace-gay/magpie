// tests/github/commenter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPRHeadSha, classifyComments, postReview } from '../../src/github/commenter'

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

  it('rejects non-numeric PR numbers', () => {
    expect(() => classifyComments('abc', [])).toThrow('Invalid PR number')
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
