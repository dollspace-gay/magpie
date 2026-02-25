// src/commands/review/utils.ts
import type { MergedIssue } from '../../orchestrator/types.js'
import type { ReviewFocus } from '../../orchestrator/repo-orchestrator.js'
import type { DebateResult } from '../../orchestrator/types.js'

// Fix malformed markdown from some LLMs (e.g., Codex uses indented lists)
export function fixMarkdown(text: string): string {
  return text
    // Convert indented bullet lists to standard format: "    * item" -> "- item"
    .replace(/^[ ]{2,}\* /gm, '- ')
    // Convert indented numbered lists: "    1. item" -> "1. item"
    .replace(/^[ ]{2,}(\d+)\. /gm, '$1. ')
    // Fix code blocks that use indentation instead of fences
    // (4+ spaces at start of line after a blank line = code block in markdown)
    // We leave these alone as they're valid markdown
}

// Cold jokes to display while waiting
const COLD_JOKES = [
  'Why do programmers confuse Halloween and Christmas? Because Oct 31 = Dec 25',
  'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"',
  'Why do programmers hate nature? It has too many bugs.',
  'There are only 10 types of people: those who understand binary and those who don\'t',
  'Why do Java developers wear glasses? Because they can\'t C#',
  'A programmer\'s wife: "Buy a loaf of bread. If they have eggs, buy a dozen." He returns with 12 loaves.',
  'Why did the developer go broke? Because he used up all his cache.',
  '99 little bugs in the code, take one down, patch it around... 127 little bugs in the code.',
  'There\'s no place like 127.0.0.1',
  'Why did the functions stop calling each other? They had too many arguments.',
  'I would tell you a UDP joke, but you might not get it.',
  'A TCP packet walks into a bar and says "I\'d like a beer." Bartender: "You want a beer?" "Yes, a beer."',
  'Why do backend devs wear glasses? Because they don\'t do C SS.',
  'How many programmers does it take to change a light bulb? None, that\'s a hardware problem.',
  'Programming is 10% writing code and 90% figuring out why it doesn\'t work.',
  'The best thing about a boolean is that even if you\'re wrong, you\'re only off by a bit.',
  'Why was the JavaScript developer sad? Because he didn\'t Node how to Express himself.',
  'In order to understand recursion, you must first understand recursion.',
  'I\'ve got a really good UDP joke to tell you but I don\'t know if you\'ll get it.',
  'A programmer puts two glasses on his bedside table before sleeping. One full of water in case he gets thirsty, one empty in case he doesn\'t.',
  'Why did the programmer quit his job? Because he didn\'t get arrays.',
  '!false - It\'s funny because it\'s true.',
  'There are two hard things in computer science: cache invalidation, naming things, and off-by-one errors.',
  'What\'s the object-oriented way to become wealthy? Inheritance.',
  'Why do C# and Java developers keep breaking their keyboards? Because they use a strongly typed language.',
  'A QA engineer walks into a bar. Orders 1 beer. Orders 0 beers. Orders -1 beers. Orders 999999 beers. Orders a lizard.',
  'Debugging: Being the detective in a crime movie where you are also the murderer.',
  'It works on my machine! Then we\'ll ship your machine.',
  'Software and cathedrals are much the same: first we build them, then we pray.',
  'The code that is the hardest to debug is the code you were sure would work.',
  'Copy-paste is not a design pattern.',
  'Why do Python programmers have low self-esteem? They\'re constantly comparing themselves to others.',
  'What\'s a pirate\'s favorite programming language? R... you\'d think it\'s R but it\'s actually the C.',
  'How does a computer get drunk? It takes screenshots.',
  'Real programmers count from 0.',
  'Git commit -m "fixed it for real this time"',
]

export function getRandomJoke(): string {
  return COLD_JOKES[Math.floor(Math.random() * COLD_JOKES.length)]
}

export function formatIssueForGitHub(issue: MergedIssue): string {
  let comment = `**[${issue.severity.toUpperCase()}]** ${issue.title}\n\n${issue.description}`
  if (issue.suggestedFix) {
    comment += `\n\n**Suggested fix:** ${issue.suggestedFix}`
  }
  comment += `\n\n_Found by: ${issue.raisedBy.join(', ')} via Magpie_`
  return comment
}

export const FOCUS_OPTIONS: { key: string; label: string; focus: ReviewFocus }[] = [
  { key: '1', label: 'Security', focus: 'security' },
  { key: '2', label: 'Performance', focus: 'performance' },
  { key: '3', label: 'Architecture', focus: 'architecture' },
  { key: '4', label: 'Code Quality', focus: 'code-quality' },
  { key: '5', label: 'Testing', focus: 'testing' },
  { key: '6', label: 'Documentation', focus: 'documentation' }
]

export function formatMarkdown(result: DebateResult): string {
  const isLocal = result.prNumber === 'Local Changes' || result.prNumber === 'Last Commit'
  let md = isLocal
    ? `# ${result.prNumber} Review\n\n`
    : `# Code Review: ${result.prNumber}\n\n`
  md += `## Analysis\n\n${result.analysis}\n\n`
  md += `## Debate\n\n`

  for (const msg of result.messages) {
    md += `### ${msg.reviewerId}\n\n${msg.content}\n\n`
  }

  md += `## Summaries\n\n`
  for (const summary of result.summaries) {
    md += `### ${summary.reviewerId}\n\n${summary.summary}\n\n`
  }

  md += `## Final Conclusion\n\n${result.finalConclusion}\n`

  return md
}
