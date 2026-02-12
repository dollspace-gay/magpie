// tests/orchestrator/types.test.ts
import { describe, it, expect } from 'vitest'
import type { ReviewIssue, ReviewerOutput, MergedIssue } from '../../src/orchestrator/types'

describe('ReviewIssue types', () => {
  it('should accept valid ReviewIssue', () => {
    const issue: ReviewIssue = {
      severity: 'critical',
      category: 'security',
      file: 'src/auth.ts',
      line: 42,
      title: 'SQL injection risk',
      description: 'User input is directly concatenated into SQL query'
    }
    expect(issue.severity).toBe('critical')
    expect(issue.file).toBe('src/auth.ts')
  })

  it('should accept valid ReviewerOutput', () => {
    const output: ReviewerOutput = {
      issues: [],
      verdict: 'approve',
      summary: 'Code looks good'
    }
    expect(output.verdict).toBe('approve')
  })

  it('should accept MergedIssue with raisedBy', () => {
    const merged: MergedIssue = {
      severity: 'high',
      category: 'performance',
      file: 'src/db.ts',
      line: 10,
      title: 'Unbounded query',
      description: 'No LIMIT clause',
      raisedBy: ['claude-code', 'gemini-cli'],
      descriptions: ['No LIMIT clause']
    }
    expect(merged.raisedBy).toHaveLength(2)
  })
})
