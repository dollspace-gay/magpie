// src/utils/large-diff.ts
// Utilities for fetching and truncating large PR diffs that exceed GitHub's 20k line limit.

import { execSync } from 'child_process'
import { logger } from './logger.js'

export interface LargeDiffOptions {
  /** Max total lines to include in the diff (default: 15000) */
  maxLines?: number
  /** Glob patterns for files to exclude (passed to filterDiff externally) */
  excludePatterns?: string[]
}

interface FileDiffSection {
  filename: string
  content: string  // Full unified diff section for this file
  lineCount: number
}

/**
 * Fetch PR diff for large PRs that exceed GitHub's 20k line limit.
 *
 * Strategy:
 * 1. Get PR commit SHAs
 * 2. Fetch diff via the commit diff endpoint (which has no 20k limit)
 * 3. For multi-commit PRs, use the compare endpoint
 * 4. Split into per-file sections, prioritize core files, truncate to fit budget
 */
export function fetchLargePRDiff(repo: string, prNumber: string, options: LargeDiffOptions = {}): {
  diff: string
  totalFiles: number
  includedFiles: number
  truncated: boolean
  summary: string
} {
  const maxLines = options.maxLines ?? 15000

  // Step 1: Get PR metadata (base SHA, head SHA, commit count)
  let baseSha: string
  let headSha: string
  let commitCount: number
  try {
    const prInfo = JSON.parse(execSync(
      `gh api repos/${repo}/pulls/${prNumber} --jq '{base: .base.sha, head: .head.sha, commits: .commits}'`,
      { encoding: 'utf-8', timeout: 30000 }
    ))
    baseSha = prInfo.base
    headSha = prInfo.head
    commitCount = prInfo.commits || 1
  } catch (e) {
    throw new Error(`Failed to get PR info: ${e instanceof Error ? e.message.slice(0, 200) : e}`)
  }

  // Step 2: Fetch the full diff
  let fullDiff: string
  try {
    if (commitCount === 1) {
      // Single commit: use commit diff endpoint (no 20k limit)
      fullDiff = execSync(
        `gh api repos/${repo}/commits/${headSha} -H "Accept: application/vnd.github.v3.diff"`,
        { encoding: 'utf-8', timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
      )
    } else {
      // Multi-commit: try compare endpoint
      fullDiff = execSync(
        `gh api repos/${repo}/compare/${baseSha}...${headSha} -H "Accept: application/vnd.github.v3.diff"`,
        { encoding: 'utf-8', timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
      )
    }
  } catch {
    // Fallback: try per-commit diffs concatenated
    try {
      const commits = JSON.parse(execSync(
        `gh api repos/${repo}/pulls/${prNumber}/commits --jq '[.[].sha]'`,
        { encoding: 'utf-8', timeout: 30000 }
      ))
      const diffs: string[] = []
      for (const sha of commits) {
        try {
          const d = execSync(
            `gh api repos/${repo}/commits/${sha} -H "Accept: application/vnd.github.v3.diff"`,
            { encoding: 'utf-8', timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
          )
          diffs.push(d)
        } catch {
          // Skip failed commits
        }
      }
      fullDiff = diffs.join('\n')
    } catch (e) {
      throw new Error(`Failed to fetch diff: ${e instanceof Error ? e.message.slice(0, 200) : e}`)
    }
  }

  if (!fullDiff || !fullDiff.trim()) {
    throw new Error('Empty diff returned')
  }

  // Step 3: Split into per-file sections
  const fileSections = splitDiffIntoFiles(fullDiff)
  const totalFiles = fileSections.length
  const totalLines = fullDiff.split('\n').length

  // Step 4: Categorize and prioritize
  const coreFiles: FileDiffSection[] = []
  const testFiles: FileDiffSection[] = []

  for (const section of fileSections) {
    if (isTestFile(section.filename)) {
      testFiles.push(section)
    } else {
      coreFiles.push(section)
    }
  }

  // Sort each category: smaller files first (to maximize coverage)
  coreFiles.sort((a, b) => a.lineCount - b.lineCount)
  testFiles.sort((a, b) => a.lineCount - b.lineCount)

  // Step 5: Build diff within budget
  let lineCount = 0
  let truncated = false
  const includedSections: string[] = []
  const excludedSummary: string[] = []

  // Phase 1: include core files
  for (const section of coreFiles) {
    if (lineCount + section.lineCount <= maxLines) {
      includedSections.push(section.content)
      lineCount += section.lineCount
    } else {
      // Try truncating this file
      const remaining = maxLines - lineCount
      if (remaining > 50) {
        const truncatedContent = truncateSection(section, remaining)
        includedSections.push(truncatedContent)
        lineCount += truncatedContent.split('\n').length
        excludedSummary.push(`  ${section.filename} (truncated: ${section.lineCount} lines)`)
      } else {
        excludedSummary.push(`  ${section.filename} (${section.lineCount} lines)`)
      }
      truncated = true
    }
  }

  // Phase 2: include test files if budget allows
  for (const section of testFiles) {
    if (lineCount + section.lineCount <= maxLines) {
      includedSections.push(section.content)
      lineCount += section.lineCount
    } else {
      excludedSummary.push(`  ${section.filename} [test] (${section.lineCount} lines)`)
      truncated = true
    }
  }

  const diff = includedSections.join('\n')
  const includedFiles = includedSections.length

  // Build summary
  let summary = `PR has ${totalFiles} files (~${totalLines} lines total). `
  if (truncated) {
    summary += `Diff truncated to fit context: ${includedFiles}/${totalFiles} files included (~${lineCount} lines).`
    if (excludedSummary.length > 0) {
      summary += `\nExcluded/truncated files:\n${excludedSummary.join('\n')}`
    }
  } else {
    summary += `All ${includedFiles} files included (~${lineCount} lines).`
  }

  logger.info(`Large diff fetch: ${includedFiles}/${totalFiles} files, ~${lineCount} lines, truncated=${truncated}`)

  return { diff, totalFiles, includedFiles, truncated, summary }
}

/** Split a unified diff into per-file sections. */
function splitDiffIntoFiles(diff: string): FileDiffSection[] {
  const sections: FileDiffSection[] = []
  const lines = diff.split('\n')
  let currentLines: string[] = []
  let currentFile = ''

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\//)
    if (fileMatch) {
      // Save previous section
      if (currentLines.length > 0 && currentFile) {
        const content = currentLines.join('\n') + '\n'
        sections.push({
          filename: currentFile,
          content,
          lineCount: currentLines.length
        })
      }
      currentFile = fileMatch[1]
      currentLines = [line]
    } else {
      currentLines.push(line)
    }
  }

  // Save last section
  if (currentLines.length > 0 && currentFile) {
    const content = currentLines.join('\n')
    sections.push({
      filename: currentFile,
      content,
      lineCount: currentLines.length
    })
  }

  return sections
}

/** Truncate a file's diff section to fit within a line budget. */
function truncateSection(section: FileDiffSection, maxLines: number): string {
  const lines = section.content.split('\n')
  const budget = maxLines - 2 // reserve for truncation notice
  const kept = lines.slice(0, budget)
  const truncatedCount = lines.length - budget

  return kept.join('\n') + `\n... (${truncatedCount} more lines truncated in ${section.filename})\n`
}

/** Heuristic: is this file a test file? */
function isTestFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return lower.includes('_test.') ||
    lower.includes('.test.') ||
    lower.includes('test_') ||
    lower.includes('/tests/') ||
    lower.includes('/test/') ||
    lower.includes('_bench_test.') ||
    lower.includes('.spec.')
}
