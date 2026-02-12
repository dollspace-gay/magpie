// src/github/commenter.ts
import { execSync } from 'child_process'
import type { MergedIssue } from '../orchestrator/types.js'

interface PRReviewComment {
  path: string
  line: number
  body: string
}

interface PRReviewPayload {
  body: string
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments: PRReviewComment[]
  commit_id: string
}

/**
 * Build a GitHub PR review payload from merged issues.
 */
export function buildPRReviewPayload(
  issues: MergedIssue[],
  verdict: string,
  commitSha: string
): PRReviewPayload {
  const inlineIssues = issues.filter(i => i.line != null)
  const bodyIssues = issues.filter(i => i.line == null)

  const comments: PRReviewComment[] = inlineIssues.map(issue => ({
    path: issue.file,
    line: issue.line!,
    body: formatIssueComment(issue)
  }))

  let body = ''
  if (bodyIssues.length > 0) {
    body = '## Magpie Review Issues\n\n' +
      bodyIssues.map(issue => formatIssueComment(issue)).join('\n\n---\n\n')
  }

  const event = verdict === 'approve' ? 'APPROVE'
    : verdict === 'request_changes' ? 'REQUEST_CHANGES'
    : 'COMMENT'

  return { body, event, comments, commit_id: commitSha }
}

function formatIssueComment(issue: MergedIssue): string {
  const severity = issue.severity.toUpperCase()
  let comment = `**[${severity}]** ${issue.title}\n\n${issue.description}`
  if (issue.suggestedFix) {
    comment += `\n\n**Suggested fix:** ${issue.suggestedFix}`
  }
  comment += `\n\n_Found by: ${issue.raisedBy.join(', ')} via Magpie_`
  return comment
}

function validatePRNumber(prNumber: string): void {
  if (!/^\d+$/.test(prNumber)) {
    throw new Error(`Invalid PR number: ${prNumber}`)
  }
}

/**
 * Post a PR review to GitHub using gh CLI.
 */
export function postPRReview(
  prNumber: string,
  payload: PRReviewPayload
): void {
  validatePRNumber(prNumber)
  const jsonPayload = JSON.stringify(payload)
  const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
  const repoMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/)
  if (!repoMatch) throw new Error('Could not detect GitHub repo from git remote')

  const repo = repoMatch[1]
  execSync(
    `gh api repos/${repo}/pulls/${prNumber}/reviews --input -`,
    { input: jsonPayload, encoding: 'utf-8' }
  )
}

/**
 * Get the HEAD commit SHA for a PR.
 */
export function getPRHeadSha(prNumber: string): string {
  validatePRNumber(prNumber)
  const result = execSync(
    `gh pr view ${prNumber} --json headRefOid --jq .headRefOid`,
    { encoding: 'utf-8' }
  )
  return result.trim()
}
