// tests/history/tracker.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { HistoryTracker } from '../../src/history/tracker'
import type { MergedIssue } from '../../src/orchestrator/types'

describe('HistoryTracker', () => {
  let tempDir: string
  let tracker: HistoryTracker

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'magpie-test-'))
    tracker = new HistoryTracker(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true })
  })

  const makeIssue = (title: string, file: string, severity = 'high' as const): MergedIssue => ({
    severity, category: 'test', file, title,
    description: 'desc', raisedBy: ['claude'], descriptions: ['desc']
  })

  it('should save and load review', async () => {
    const issues = [makeIssue('Bug 1', 'a.ts')]
    await tracker.saveReview('test-repo', 'pr-1', issues)
    const history = await tracker.loadReviews('test-repo', 'pr-1')
    expect(history).toHaveLength(1)
    expect(history[0].issues).toHaveLength(1)
  })

  it('should diff issues between reviews', async () => {
    const issues1 = [makeIssue('Bug 1', 'a.ts'), makeIssue('Bug 2', 'b.ts')]
    const issues2 = [makeIssue('Bug 1', 'a.ts'), makeIssue('Bug 3', 'c.ts')]
    await tracker.saveReview('repo', 'pr-1', issues1)
    await tracker.saveReview('repo', 'pr-1', issues2)

    const diff = await tracker.diffLatest('repo', 'pr-1')
    expect(diff).not.toBeNull()
    expect(diff!.fixed).toHaveLength(1)     // Bug 2 gone
    expect(diff!.stillOpen).toHaveLength(1)  // Bug 1 still there
    expect(diff!.new).toHaveLength(1)        // Bug 3 is new
  })

  it('should return null diff for first review', async () => {
    await tracker.saveReview('repo', 'pr-1', [makeIssue('Bug 1', 'a.ts')])
    const diff = await tracker.diffLatest('repo', 'pr-1')
    expect(diff).toBeNull()
  })

  it('should handle empty review history', async () => {
    const history = await tracker.loadReviews('repo', 'nonexistent')
    expect(history).toHaveLength(0)
  })
})
