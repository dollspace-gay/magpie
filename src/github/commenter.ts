// src/github/commenter.ts
import { execSync } from 'child_process'

interface CommentResult {
  success: boolean
  inline: boolean
  error?: string
}

function validatePRNumber(prNumber: string): void {
  if (!/^\d+$/.test(prNumber)) {
    throw new Error(`Invalid PR number: ${prNumber}`)
  }
}

function getRepo(): string {
  const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
  const repoMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/)
  if (!repoMatch) throw new Error('Could not detect GitHub repo from git remote')
  return repoMatch[1]
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

/**
 * Post a single inline comment on a specific line of a PR.
 * Falls back to a regular PR comment if the line is not in the diff.
 */
export function postComment(
  prNumber: string,
  opts: { path: string; line?: number; body: string; commitSha: string }
): CommentResult {
  validatePRNumber(prNumber)
  const repo = getRepo()

  // Try inline comment first if we have a line number
  if (opts.line != null) {
    try {
      const payload = JSON.stringify({
        body: opts.body,
        commit_id: opts.commitSha,
        path: opts.path,
        line: opts.line,
        side: 'RIGHT',
      })
      execSync(
        `gh api repos/${repo}/pulls/${prNumber}/comments --input -`,
        { input: payload, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      return { success: true, inline: true }
    } catch {
      // Line not in diff — fall back to regular comment with file/line context
    }
  }

  // Regular PR comment (not inline)
  const location = opts.line ? `**${opts.path}:${opts.line}**\n\n` : `**${opts.path}**\n\n`
  const body = location + opts.body
  try {
    execSync(
      `gh pr comment ${prNumber} --body-file -`,
      { input: body, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return { success: true, inline: false }
  } catch (e: any) {
    return { success: false, inline: false, error: e.message?.slice(0, 200) }
  }
}
