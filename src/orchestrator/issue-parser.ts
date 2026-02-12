// src/orchestrator/issue-parser.ts
import type { ReviewIssue, ReviewerOutput, MergedIssue } from './types.js'

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'nitpick'] as const
const VALID_VERDICTS = ['approve', 'request_changes', 'comment'] as const
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, nitpick: 4 }

/**
 * Parse structured ReviewerOutput from a reviewer's response text.
 * Looks for a ```json block containing { issues, verdict, summary }.
 * Returns null if no valid JSON block found.
 */
export function parseReviewerOutput(response: string): ReviewerOutput | null {
  // Try ```json fenced block first, then raw JSON object
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/)
  let jsonStr = jsonMatch?.[1]

  if (!jsonStr) {
    // Try to find a raw JSON object with "issues" array
    const rawMatch = response.match(/\{[\s\S]*"issues"\s*:\s*\[[\s\S]*\][\s\S]*\}/)
    if (rawMatch) jsonStr = rawMatch[0]
  }

  if (!jsonStr) return null

  try {
    const parsed = JSON.parse(jsonStr)

    if (!Array.isArray(parsed.issues)) {
      return null
    }

    const verdict = (typeof parsed.verdict === 'string' && VALID_VERDICTS.includes(parsed.verdict))
      ? parsed.verdict : 'comment'

    const issues: ReviewIssue[] = parsed.issues
      .filter((issue: any) =>
        typeof issue === 'object' &&
        VALID_SEVERITIES.includes(issue.severity) &&
        typeof issue.file === 'string' &&
        typeof issue.title === 'string' &&
        typeof issue.description === 'string'
      )
      .map((issue: any) => ({
        severity: issue.severity,
        category: typeof issue.category === 'string' ? issue.category : 'general',
        file: issue.file,
        line: typeof issue.line === 'number' ? issue.line : undefined,
        endLine: typeof issue.endLine === 'number' ? issue.endLine : undefined,
        title: issue.title,
        description: issue.description,
        suggestedFix: typeof issue.suggestedFix === 'string' ? issue.suggestedFix : undefined,
        codeSnippet: typeof issue.codeSnippet === 'string' ? issue.codeSnippet : undefined
      }))

    return { issues, verdict, summary: parsed.summary || '' }
  } catch {
    return null
  }
}

/**
 * Deduplicate issues across multiple reviewers.
 * Issues with the same file + overlapping line + similar title are merged.
 * Merged issues keep the highest severity and track all contributing reviewers.
 */
export function deduplicateIssues(
  issuesByReviewer: Map<string, ReviewIssue[]>
): MergedIssue[] {
  const merged: MergedIssue[] = []

  for (const [reviewerId, issues] of issuesByReviewer) {
    for (const issue of issues) {
      const existing = merged.find(m => isSimilarIssue(m, issue))
      if (existing) {
        existing.raisedBy.push(reviewerId)
        existing.descriptions.push(issue.description)
        // Keep highest severity
        if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[existing.severity]) {
          existing.severity = issue.severity
        }
        // Keep suggested fix if we don't have one
        if (!existing.suggestedFix && issue.suggestedFix) {
          existing.suggestedFix = issue.suggestedFix
        }
      } else {
        merged.push({
          ...issue,
          raisedBy: [reviewerId],
          descriptions: [issue.description]
        })
      }
    }
  }

  // Sort by severity (critical first)
  merged.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return merged
}

/**
 * Extract suggested review focus areas from analyzer output.
 * Looks for a "## Suggested Review Focus" section with bullet points.
 */
export function parseFocusAreas(analysis: string): string[] {
  const match = analysis.match(/## Suggested Review Focus\s*\n([\s\S]*?)(?=\n##|\n*$)/)
  if (!match) return []

  const lines = match[1].trim().split('\n')
  return lines
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line.length > 0)
}

/** Check if two issues are similar enough to merge */
function isSimilarIssue(a: ReviewIssue, b: ReviewIssue): boolean {
  // Must be same file
  if (a.file !== b.file) return false

  // If both have line numbers, check proximity (within 5 lines)
  if (a.line != null && b.line != null) {
    if (Math.abs(a.line - b.line) > 5) return false
  }

  // Check title similarity (simple word overlap)
  const wordsA = new Set(a.title.toLowerCase().split(/\s+/))
  const wordsB = new Set(b.title.toLowerCase().split(/\s+/))
  const intersection = [...wordsA].filter(w => wordsB.has(w))
  const union = new Set([...wordsA, ...wordsB])
  const similarity = intersection.length / union.size

  return similarity > 0.4
}
