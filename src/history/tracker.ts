// src/history/tracker.ts
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { MergedIssue } from '../orchestrator/types.js'

interface ReviewRecord {
  timestamp: string
  issues: MergedIssue[]
}

export interface ReviewDiff {
  fixed: MergedIssue[]
  stillOpen: MergedIssue[]
  new: MergedIssue[]
  previousTimestamp: string
}

export class HistoryTracker {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = join(baseDir, '.magpie', 'history')
  }

  private getDir(repo: string, prId: string): string {
    return join(this.baseDir, repo, prId)
  }

  async saveReview(repo: string, prId: string, issues: MergedIssue[]): Promise<void> {
    const dir = this.getDir(repo, prId)
    mkdirSync(dir, { recursive: true })

    const record: ReviewRecord = {
      timestamp: new Date().toISOString(),
      issues
    }

    const filename = `review-${record.timestamp.replace(/[:.]/g, '-')}.json`
    writeFileSync(join(dir, filename), JSON.stringify(record, null, 2))
  }

  async loadReviews(repo: string, prId: string): Promise<ReviewRecord[]> {
    const dir = this.getDir(repo, prId)
    if (!existsSync(dir)) return []

    const files = readdirSync(dir)
      .filter(f => f.startsWith('review-') && f.endsWith('.json'))
      .sort()

    return files.map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')))
  }

  async diffLatest(repo: string, prId: string): Promise<ReviewDiff | null> {
    const reviews = await this.loadReviews(repo, prId)
    if (reviews.length < 2) return null

    const previous = reviews[reviews.length - 2]
    const current = reviews[reviews.length - 1]

    const fixed: MergedIssue[] = []
    const stillOpen: MergedIssue[] = []
    const newIssues: MergedIssue[] = []

    // Check which previous issues are still present
    for (const prevIssue of previous.issues) {
      const match = current.issues.find(ci =>
        ci.file === prevIssue.file && isSimilarTitle(ci.title, prevIssue.title)
      )
      if (match) {
        stillOpen.push(match)
      } else {
        fixed.push(prevIssue)
      }
    }

    // Find new issues not in previous
    for (const currIssue of current.issues) {
      const match = previous.issues.find(pi =>
        pi.file === currIssue.file && isSimilarTitle(pi.title, currIssue.title)
      )
      if (!match) {
        newIssues.push(currIssue)
      }
    }

    return { fixed, stillOpen, new: newIssues, previousTimestamp: previous.timestamp }
  }
}

function isSimilarTitle(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\s+/))
  const wordsB = new Set(b.toLowerCase().split(/\s+/))
  const intersection = [...wordsA].filter(w => wordsB.has(w))
  const union = new Set([...wordsA, ...wordsB])
  return intersection.length / union.size > 0.4
}
