// src/github/commenter.ts
import { execSync } from 'child_process'

export interface CommentResult {
  success: boolean
  inline: boolean
  error?: string
}

export interface ReviewCommentInput {
  path: string
  line?: number
  body: string
}

export interface ClassifiedComment {
  input: ReviewCommentInput
  mode: 'inline' | 'file' | 'global'
}

export interface ReviewResult {
  posted: number
  inline: number
  fileLevel: number
  global: number
  failed: number
  details: Array<{
    path: string
    line?: number
    success: boolean
    mode: 'inline' | 'file' | 'global' | 'failed'
  }>
}

function validatePRNumber(prNumber: string): void {
  if (!/^\d+$/.test(prNumber)) {
    throw new Error(`Invalid PR number: ${prNumber}`)
  }
}

function getRepo(repo?: string): string {
  if (repo) return repo
  const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
  const repoMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/)
  if (!repoMatch) throw new Error('Could not detect GitHub repo from git remote')
  return repoMatch[1]
}

/**
 * Get the HEAD commit SHA for a PR.
 */
export function getPRHeadSha(prNumber: string, repo?: string): string {
  validatePRNumber(prNumber)
  const repoFlag = repo ? ` --repo ${repo}` : ''
  const result = execSync(
    `gh pr view ${prNumber}${repoFlag} --json headRefOid --jq .headRefOid`,
    { encoding: 'utf-8' }
  )
  return result.trim()
}

/**
 * Parse a unified diff patch to extract valid right-side line numbers.
 */
function parseDiffLines(patch: string): Set<number> {
  const lines = new Set<number>()
  const patchLines = patch.split('\n')
  let rightLine = 0

  for (const line of patchLines) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      rightLine = parseInt(hunkMatch[1])
      continue
    }

    if (rightLine === 0) continue

    if (line.startsWith('+')) {
      lines.add(rightLine)
      rightLine++
    } else if (line.startsWith('-')) {
      // Left side only — don't increment right line counter
    } else if (line.startsWith(' ')) {
      // Context line — valid on both sides
      lines.add(rightLine)
      rightLine++
    }
    // Skip anything else ("\ No newline at end of file", trailing empty lines)
  }

  return lines
}

/**
 * Get diff info for a PR: maps file path → set of right-side line numbers.
 */
function getDiffInfo(prNumber: string, repo: string): Map<string, Set<number>> {
  const result = execSync(
    `gh api repos/${repo}/pulls/${prNumber}/files --paginate`,
    { encoding: 'utf-8' }
  )
  const files = JSON.parse(result)
  const diffInfo = new Map<string, Set<number>>()

  for (const file of files) {
    diffInfo.set(file.filename, file.patch ? parseDiffLines(file.patch) : new Set())
  }

  return diffInfo
}

/**
 * Post a single comment on a PR.
 * Tries: inline (exact line) → file-level (attached to file) → global PR comment.
 */
export function postComment(
  prNumber: string,
  opts: { path: string; line?: number; body: string; commitSha: string; repo?: string }
): CommentResult {
  validatePRNumber(prNumber)
  const repo = getRepo(opts.repo)

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
      // Line not in diff — try file-level
    }
  }

  // Try file-level review comment (still attached to the file in "Files changed" tab)
  try {
    const lineRef = opts.line ? `**Line ${opts.line}:**\n\n` : ''
    const payload = JSON.stringify({
      body: lineRef + opts.body,
      commit_id: opts.commitSha,
      path: opts.path,
      subject_type: 'file',
    })
    execSync(
      `gh api repos/${repo}/pulls/${prNumber}/comments --input -`,
      { input: payload, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return { success: true, inline: true }
  } catch {
    // File not in diff — fall back to global PR comment
  }

  // Last resort: regular PR comment
  const location = opts.line ? `**${opts.path}:${opts.line}**\n\n` : `**${opts.path}**\n\n`
  const body = location + opts.body
  const repoFlag = opts.repo ? ` --repo ${opts.repo}` : ''
  try {
    execSync(
      `gh pr comment ${prNumber}${repoFlag} --body-file -`,
      { input: body, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return { success: true, inline: false }
  } catch (e: any) {
    return { success: false, inline: false, error: e.message?.slice(0, 200) }
  }
}

/**
 * Classify comments by how they can be placed on a PR.
 * Returns each comment with its placement mode based on the PR diff.
 */
export function classifyComments(
  prNumber: string,
  comments: ReviewCommentInput[],
  repo?: string
): ClassifiedComment[] {
  validatePRNumber(prNumber)
  const resolvedRepo = getRepo(repo)
  const diffInfo = getDiffInfo(prNumber, resolvedRepo)

  return comments.map(c => {
    const fileLines = diffInfo.get(c.path)
    if (fileLines && c.line != null && fileLines.has(c.line)) {
      return { input: c, mode: 'inline' as const }
    } else if (fileLines) {
      return { input: c, mode: 'file' as const }
    } else {
      return { input: c, mode: 'global' as const }
    }
  })
}

/**
 * Post pre-classified comments to a PR.
 * Uses the PR Reviews API for inline/file-level comments,
 * and falls back to regular PR comments for global ones.
 */
export function postReview(
  prNumber: string,
  classified: ClassifiedComment[],
  commitSha: string,
  repo?: string
): ReviewResult {
  validatePRNumber(prNumber)
  const resolvedRepo = getRepo(repo)

  const details: ReviewResult['details'] = []
  const reviewComments: any[] = []
  const reviewDetailIndices: number[] = []
  const globalEntries: Array<{ input: ReviewCommentInput; detailIndex: number }> = []

  // Build payloads based on pre-classified modes
  for (const { input: c, mode } of classified) {
    if (mode === 'inline') {
      reviewComments.push({
        path: c.path,
        line: c.line,
        side: 'RIGHT',
        body: c.body,
      })
      details.push({ path: c.path, line: c.line, success: false, mode: 'inline' })
      reviewDetailIndices.push(details.length - 1)
    } else if (mode === 'file') {
      const lineRef = c.line ? `**Line ${c.line}:**\n\n` : ''
      reviewComments.push({
        path: c.path,
        body: lineRef + c.body,
        subject_type: 'file',
      })
      details.push({ path: c.path, line: c.line, success: false, mode: 'file' })
      reviewDetailIndices.push(details.length - 1)
    } else {
      details.push({ path: c.path, line: c.line, success: false, mode: 'global' })
      globalEntries.push({ input: c, detailIndex: details.length - 1 })
    }
  }

  // Post the batch review (inline + file-level)
  if (reviewComments.length > 0) {
    try {
      const payload = JSON.stringify({
        commit_id: commitSha,
        event: 'COMMENT',
        comments: reviewComments,
      })
      execSync(
        `gh api repos/${resolvedRepo}/pulls/${prNumber}/reviews --input -`,
        { input: payload, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      for (const idx of reviewDetailIndices) {
        details[idx].success = true
      }
    } catch {
      // Batch failed — try posting individually
      for (let j = 0; j < reviewComments.length; j++) {
        const idx = reviewDetailIndices[j]
        const orig = classified.find(
          cc => cc.input.path === details[idx].path && cc.input.line === details[idx].line
        )
        if (!orig) continue
        const result = postComment(prNumber, {
          path: orig.input.path,
          line: orig.input.line,
          body: orig.input.body,
          commitSha,
          repo,
        })
        details[idx].success = result.success
        if (!result.success) details[idx].mode = 'failed'
        else if (!result.inline) details[idx].mode = 'global'
      }
    }
  }

  // Post global comments
  const repoFlag = repo ? ` --repo ${repo}` : ''
  for (const { input: c, detailIndex } of globalEntries) {
    const location = c.line ? `**${c.path}:${c.line}**\n\n` : `**${c.path}**\n\n`
    try {
      execSync(
        `gh pr comment ${prNumber}${repoFlag} --body-file -`,
        { input: location + c.body, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      details[detailIndex].success = true
    } catch {
      details[detailIndex].mode = 'failed'
    }
  }

  return {
    posted: details.filter(d => d.success).length,
    inline: details.filter(d => d.success && d.mode === 'inline').length,
    fileLevel: details.filter(d => d.success && d.mode === 'file').length,
    global: details.filter(d => d.success && d.mode === 'global').length,
    failed: details.filter(d => !d.success).length,
    details,
  }
}
