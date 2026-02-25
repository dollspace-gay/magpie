// src/commands/review/session-cmds.ts
import chalk from 'chalk'
import ora from 'ora'
import type { MagpieConfig } from '../../config/types.js'
import { StateManager } from '../../state/index.js'
import { resumeReview } from './repo-review.js'

export async function handleListSessions(spinner: ReturnType<typeof ora>): Promise<void> {
  const cwd = process.cwd()
  const stateManager = new StateManager(cwd)
  await stateManager.init()

  const sessions = await stateManager.findIncompleteSessions()
  // Also get completed sessions by listing all session files
  const allSessions = await stateManager.listAllSessions()

  if (allSessions.length === 0) {
    spinner.info('No review sessions found.')
    return
  }

  console.log()
  console.log(chalk.bgBlue.white.bold(' Review Sessions '))
  console.log(chalk.dim('─'.repeat(70)))

  for (const session of allSessions) {
    const statusColor = session.status === 'completed' ? chalk.green :
                        session.status === 'paused' ? chalk.yellow :
                        session.status === 'in_progress' ? chalk.cyan :
                        chalk.dim
    const statusIcon = session.status === 'completed' ? '✓' :
                       session.status === 'paused' ? '⏸' :
                       session.status === 'in_progress' ? '▶' : '○'

    const completed = session.progress.completedFeatures.length
    const total = session.config.selectedFeatures.length
    const progress = `${completed}/${total} features`

    console.log(statusColor(`  ${statusIcon} ${session.id.slice(0, 8)}  ${session.status.padEnd(12)} ${progress.padEnd(15)} ${new Date(session.startedAt).toLocaleDateString()}`))
  }

  console.log(chalk.dim('─'.repeat(70)))
  console.log(chalk.dim(`  Use --session <id> to resume a session`))
  console.log(chalk.dim(`  Use --export <file> to export a completed session`))
  console.log()
}

export async function handleResumeSession(
  sessionId: string,
  config: MagpieConfig,
  spinner: ReturnType<typeof ora>
): Promise<void> {
  const cwd = process.cwd()
  const stateManager = new StateManager(cwd)
  await stateManager.init()

  // Support partial ID match
  const allSessions = await stateManager.listAllSessions()
  const matchingSessions = allSessions.filter(s =>
    s.id.startsWith(sessionId) || s.id === sessionId
  )

  if (matchingSessions.length === 0) {
    spinner.fail(`No session found matching "${sessionId}"`)
    console.log(chalk.dim('  Use --list-sessions to see available sessions'))
    return
  }

  if (matchingSessions.length > 1) {
    spinner.fail(`Multiple sessions match "${sessionId}"`)
    for (const s of matchingSessions) {
      console.log(chalk.dim(`  - ${s.id}`))
    }
    console.log(chalk.dim('  Please provide a more specific ID'))
    return
  }

  const session = matchingSessions[0]

  if (session.status === 'completed') {
    console.log(chalk.green('\nThis session is already completed.'))
    console.log(chalk.dim(`  Use --export <file> to export the results`))
    return
  }

  console.log(chalk.cyan(`\nResuming session ${session.id.slice(0, 8)}...`))
  await resumeReview(session, stateManager, config, spinner)
}

export async function handleExportSession(
  outputPath: string,
  spinner: ReturnType<typeof ora>
): Promise<void> {
  const cwd = process.cwd()
  const stateManager = new StateManager(cwd)
  await stateManager.init()

  const allSessions = await stateManager.listAllSessions()
  const completedSessions = allSessions.filter(s => s.status === 'completed')

  if (completedSessions.length === 0) {
    spinner.fail('No completed sessions to export')
    return
  }

  // Use the most recent completed session
  const session = completedSessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0]

  spinner.text = 'Generating export...'

  const { writeFileSync } = await import('fs')

  let markdown = `# Code Review Report\n\n`
  markdown += `**Session:** ${session.id}\n`
  markdown += `**Date:** ${new Date(session.startedAt).toLocaleDateString()}\n`
  markdown += `**Status:** ${session.status}\n`
  markdown += `**Features Reviewed:** ${session.progress.completedFeatures.length}/${session.config.selectedFeatures.length}\n\n`
  markdown += `---\n\n`

  for (const featureId of session.progress.completedFeatures) {
    const result = session.progress.featureResults[featureId]
    if (!result) continue

    markdown += `## ${featureId}\n\n`
    markdown += `**Summary:** ${result.summary}\n\n`

    if (result.issues.length > 0) {
      markdown += `### Issues (${result.issues.length})\n\n`
      for (const issue of result.issues) {
        const severity = issue.severity === 'high' ? '🔴' :
                        issue.severity === 'medium' ? '🟠' : '🟡'
        markdown += `${severity} **[${issue.severity.toUpperCase()}]** ${issue.description}\n`
        if (issue.location) {
          markdown += `   📍 ${issue.location}\n`
        }
        if (issue.suggestedFix) {
          markdown += `   💡 ${issue.suggestedFix}\n`
        }
        markdown += `\n`
      }
    } else {
      markdown += `*No issues found.*\n\n`
    }

    markdown += `---\n\n`
  }

  writeFileSync(outputPath, markdown)
  spinner.succeed(`Exported to ${outputPath}`)
}
