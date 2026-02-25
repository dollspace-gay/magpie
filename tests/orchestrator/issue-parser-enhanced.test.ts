import { describe, it, expect } from 'vitest'
import { parseReviewerOutput, deduplicateIssues } from '../../src/orchestrator/issue-parser.js'

describe('parseReviewerOutput - validation', () => {
  it('rejects issues with line <= 0', () => {
    const response = '```json\n' + JSON.stringify({
      issues: [{
        severity: 'medium',
        file: 'test.ts',
        line: 0,
        title: 'Bad line',
        description: 'Line is zero'
      }, {
        severity: 'medium',
        file: 'test.ts',
        line: -5,
        title: 'Negative line',
        description: 'Negative line number'
      }, {
        severity: 'medium',
        file: 'test.ts',
        line: 10,
        title: 'Good line',
        description: 'Valid line number'
      }],
      verdict: 'comment',
      summary: 'test'
    }) + '\n```'

    const result = parseReviewerOutput(response)
    expect(result).not.toBeNull()
    expect(result!.issues).toHaveLength(3)
    // line 0 and -5 should become undefined, line 10 should be kept
    expect(result!.issues[0].line).toBeUndefined()
    expect(result!.issues[1].line).toBeUndefined()
    expect(result!.issues[2].line).toBe(10)
  })

  it('rejects endLine < line', () => {
    const response = '```json\n' + JSON.stringify({
      issues: [{
        severity: 'high',
        file: 'test.ts',
        line: 20,
        endLine: 15,
        title: 'Bad endLine',
        description: 'endLine before line'
      }, {
        severity: 'high',
        file: 'test.ts',
        line: 10,
        endLine: 20,
        title: 'Good endLine',
        description: 'Valid range'
      }],
      verdict: 'comment',
      summary: 'test'
    }) + '\n```'

    const result = parseReviewerOutput(response)
    expect(result).not.toBeNull()
    expect(result!.issues[0].endLine).toBeUndefined()
    expect(result!.issues[1].endLine).toBe(20)
  })

  it('rejects empty title or description', () => {
    const response = '```json\n' + JSON.stringify({
      issues: [{
        severity: 'low',
        file: 'test.ts',
        title: '',
        description: 'has description'
      }, {
        severity: 'low',
        file: 'test.ts',
        title: 'has title',
        description: ''
      }, {
        severity: 'low',
        file: 'test.ts',
        title: '   ',
        description: 'has description'
      }, {
        severity: 'low',
        file: 'test.ts',
        title: 'valid',
        description: 'also valid'
      }],
      verdict: 'comment',
      summary: 'test'
    }) + '\n```'

    const result = parseReviewerOutput(response)
    expect(result).not.toBeNull()
    // Only the last issue with non-empty title AND description should pass
    expect(result!.issues).toHaveLength(1)
    expect(result!.issues[0].title).toBe('valid')
  })
})

describe('deduplicateIssues - enhanced similarity', () => {
  it('merges issues with similar titles (stop words ignored)', () => {
    const issuesByReviewer = new Map([
      ['reviewer-a', [{
        severity: 'high' as const,
        category: 'security',
        file: 'auth.ts',
        line: 10,
        title: 'Missing input validation in the login handler',
        description: 'The login handler does not validate user input properly'
      }]],
      ['reviewer-b', [{
        severity: 'medium' as const,
        category: 'security',
        file: 'auth.ts',
        line: 12,
        title: 'Input validation missing for login handler',
        description: 'User input is not validated in the login function'
      }]]
    ])

    const merged = deduplicateIssues(issuesByReviewer)
    expect(merged).toHaveLength(1)
    expect(merged[0].raisedBy).toEqual(['reviewer-a', 'reviewer-b'])
    expect(merged[0].severity).toBe('high') // Keeps highest severity
  })

  it('does not merge issues from different files', () => {
    const issuesByReviewer = new Map([
      ['reviewer-a', [{
        severity: 'medium' as const,
        category: 'bug',
        file: 'auth.ts',
        line: 10,
        title: 'Missing null check',
        description: 'Missing null check'
      }]],
      ['reviewer-b', [{
        severity: 'medium' as const,
        category: 'bug',
        file: 'api.ts',
        line: 10,
        title: 'Missing null check',
        description: 'Missing null check'
      }]]
    ])

    const merged = deduplicateIssues(issuesByReviewer)
    expect(merged).toHaveLength(2)
  })

  it('does not merge issues with non-overlapping line ranges', () => {
    const issuesByReviewer = new Map([
      ['reviewer-a', [{
        severity: 'medium' as const,
        category: 'bug',
        file: 'auth.ts',
        line: 10,
        endLine: 15,
        title: 'Missing null check',
        description: 'Null check needed'
      }]],
      ['reviewer-b', [{
        severity: 'medium' as const,
        category: 'bug',
        file: 'auth.ts',
        line: 100,
        endLine: 110,
        title: 'Missing null check',
        description: 'Null check needed'
      }]]
    ])

    const merged = deduplicateIssues(issuesByReviewer)
    expect(merged).toHaveLength(2)
  })

  it('merges issues with overlapping endLine ranges', () => {
    const issuesByReviewer = new Map([
      ['reviewer-a', [{
        severity: 'medium' as const,
        category: 'bug',
        file: 'auth.ts',
        line: 10,
        endLine: 20,
        title: 'Buffer overflow risk in parser',
        description: 'The parser may overflow'
      }]],
      ['reviewer-b', [{
        severity: 'high' as const,
        category: 'bug',
        file: 'auth.ts',
        line: 15,
        endLine: 25,
        title: 'Buffer overflow in parser code',
        description: 'Parser buffer overflow risk'
      }]]
    ])

    const merged = deduplicateIssues(issuesByReviewer)
    expect(merged).toHaveLength(1)
    expect(merged[0].raisedBy).toEqual(['reviewer-a', 'reviewer-b'])
    expect(merged[0].severity).toBe('high')
  })

  it('considers description similarity for borderline cases', () => {
    const issuesByReviewer = new Map([
      ['reviewer-a', [{
        severity: 'low' as const,
        category: 'quality',
        file: 'utils.ts',
        line: 5,
        title: 'Complexity too high',
        description: 'The processData function has cyclomatic complexity above threshold and should be split'
      }]],
      ['reviewer-b', [{
        severity: 'low' as const,
        category: 'quality',
        file: 'utils.ts',
        line: 5,
        title: 'High complexity found',
        description: 'The processData function has cyclomatic complexity above threshold and needs refactoring'
      }]]
    ])

    const merged = deduplicateIssues(issuesByReviewer)
    // These should be merged due to both title + description similarity
    expect(merged).toHaveLength(1)
    expect(merged[0].raisedBy).toEqual(['reviewer-a', 'reviewer-b'])
  })
})
