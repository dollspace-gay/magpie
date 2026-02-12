// tests/github/commenter.test.ts
import { describe, it, expect } from 'vitest'
import { buildPRReviewPayload, getPRHeadSha, postPRReview } from '../../src/github/commenter'
import type { MergedIssue } from '../../src/orchestrator/types'

describe('buildPRReviewPayload', () => {
  it('should build inline comments for issues with file+line', () => {
    const issues: MergedIssue[] = [{
      severity: 'high',
      category: 'security',
      file: 'src/auth.ts',
      line: 42,
      title: 'SQL injection',
      description: 'Unsafe query',
      raisedBy: ['claude'],
      descriptions: ['Unsafe query']
    }]
    const payload = buildPRReviewPayload(issues, 'request_changes', 'HEAD_SHA')
    expect(payload.event).toBe('REQUEST_CHANGES')
    expect(payload.comments).toHaveLength(1)
    expect(payload.comments[0].path).toBe('src/auth.ts')
    expect(payload.comments[0].line).toBe(42)
  })

  it('should put issues without line in body', () => {
    const issues: MergedIssue[] = [{
      severity: 'medium',
      category: 'architecture',
      file: 'src/api.ts',
      title: 'Missing abstraction',
      description: 'Should use repository pattern',
      raisedBy: ['gemini'],
      descriptions: ['Should use repository pattern']
    }]
    const payload = buildPRReviewPayload(issues, 'comment', 'HEAD_SHA')
    expect(payload.comments).toHaveLength(0)
    expect(payload.body).toContain('Missing abstraction')
  })

  it('should map verdict to GitHub event', () => {
    const payload = buildPRReviewPayload([], 'approve', 'SHA')
    expect(payload.event).toBe('APPROVE')
  })

  it('should include suggested fix when available', () => {
    const issues: MergedIssue[] = [{
      severity: 'high',
      category: 'security',
      file: 'src/auth.ts',
      line: 10,
      title: 'Bug',
      description: 'Details',
      suggestedFix: 'Use parameterized queries',
      raisedBy: ['claude'],
      descriptions: ['Details']
    }]
    const payload = buildPRReviewPayload(issues, 'comment', 'SHA')
    expect(payload.comments[0].body).toContain('parameterized queries')
  })

  it('should include reviewer attribution', () => {
    const issues: MergedIssue[] = [{
      severity: 'low',
      category: 'style',
      file: 'src/utils.ts',
      line: 5,
      title: 'Style issue',
      description: 'Naming',
      raisedBy: ['claude', 'gemini'],
      descriptions: ['Naming']
    }]
    const payload = buildPRReviewPayload(issues, 'comment', 'SHA')
    expect(payload.comments[0].body).toContain('claude')
    expect(payload.comments[0].body).toContain('gemini')
  })
})

describe('PR number validation', () => {
  it('should reject non-numeric PR numbers in getPRHeadSha', () => {
    expect(() => getPRHeadSha('123; rm -rf /')).toThrow('Invalid PR number')
  })

  it('should reject non-numeric PR numbers in postPRReview', () => {
    const payload = buildPRReviewPayload([], 'approve', 'SHA')
    expect(() => postPRReview('abc', payload)).toThrow('Invalid PR number')
  })
})
