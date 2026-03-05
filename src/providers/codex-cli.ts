import { spawn } from 'child_process'
import type { AIProvider, Message, ProviderOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'
import { preparePromptForCli } from '../utils/prompt-file.js'
import { withRetry } from '../utils/retry.js'

export class CodexCliProvider implements AIProvider {
  name = 'codex-cli'
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  private session = new CliSessionHelper()
  // Codex gets its session ID from the first response (thread_id in JSONL)
  private sessionEnabled = false

  get sessionId() { return this.session.sessionId }

  constructor(_options?: ProviderOptions) {
    // No API key needed for Codex CLI (uses subscription)
    this.cwd = process.cwd()
    this.timeout = 15 * 60 * 1000  // 15 minutes default
  }

  setCwd(cwd: string) {
    this.cwd = cwd
  }

  startSession(name?: string): void {
    this.sessionEnabled = true
    this.session.start(name)
    this.session.sessionId = undefined  // Will be set from first response's JSONL
  }

  endSession(): void {
    this.sessionEnabled = false
    this.session.end()
  }

  async chat(messages: Message[], systemPrompt?: string): Promise<string> {
    const prompt = this.sessionEnabled && !this.session.shouldSendFullHistory()
      ? this.session.buildPromptLastOnly(messages)
      : this.session.buildPrompt(messages, systemPrompt)
    const result = await withRetry(() => this.runCodex(prompt))
    this.session.markMessageSent()
    return result
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const prompt = this.sessionEnabled && !this.session.shouldSendFullHistory()
      ? this.session.buildPromptLastOnly(messages)
      : this.session.buildPrompt(messages, systemPrompt)
    yield* this.runCodexStream(prompt)
    this.session.markMessageSent()
  }

  private buildArgs(): string[] {
    const baseArgs = ['--json', '--dangerously-bypass-approvals-and-sandbox']
    if (this.sessionEnabled && this.sessionId) {
      // Resume existing session
      return ['exec', 'resume', this.sessionId, ...baseArgs, '-']
    }
    // New session or no session
    return ['exec', ...baseArgs, '-']
  }

  // Parse JSONL output: extract thread_id and agent_message text
  private parseJsonlOutput(output: string): string {
    let text = ''
    for (const line of output.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed)
        if (event.type === 'thread.started' && event.thread_id && this.sessionEnabled) {
          this.session.sessionId = event.thread_id
        } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
          text += event.item.text
        }
      } catch {
        // Not valid JSON, ignore
      }
    }
    return text
  }

  private runCodex(prompt: string): Promise<string> {
    const { prompt: stdinPrompt, cleanup } = preparePromptForCli(prompt)

    return new Promise((resolve, reject) => {
      const args = this.buildArgs()
      const child = spawn('codex', args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      let error = ''

      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.stderr.on('data', (data) => {
        error += data.toString()
      })

      child.on('close', (code) => {
        cleanup()
        if (code !== 0) {
          reject(new Error(`Codex CLI exited with code ${code}: ${error}`))
        } else {
          resolve(this.parseJsonlOutput(output))
        }
      })

      child.on('error', (err) => {
        cleanup()
        reject(new Error(`Failed to run codex CLI: ${err.message}`))
      })

      // Write prompt to stdin and close
      // Suppress EPIPE: if child exits early, close handler reports the real error
      child.stdin.on('error', () => {})
      child.stdin.write(stdinPrompt)
      child.stdin.end()
    })
  }

  private async *runCodexStream(prompt: string): AsyncGenerator<string, void, unknown> {
    const { prompt: stdinPrompt, cleanup } = preparePromptForCli(prompt)

    const args = this.buildArgs()
    const child = spawn('codex', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const chunks: string[] = []
    let resolveNext: ((value: { chunk: string | null }) => void) | null = null
    let done = false
    let error: Error | null = null
    let lastActivity = Date.now()
    let stderrOutput = ''
    let lineBuf = ''  // Buffer for JSONL line parsing

    // Timeout checker - kill if no activity for too long
    const timeoutChecker = this.timeout > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > this.timeout) {
        child.kill('SIGTERM')
        done = true
        error = new Error(`Codex CLI timed out after ${this.timeout / 1000}s of inactivity`)
        if (resolveNext) {
          resolveNext({ chunk: null })
        }
      }
    }, 10000) : null  // Check every 10s

    const pushChunk = (chunk: string) => {
      if (resolveNext) {
        resolveNext({ chunk })
        resolveNext = null
      } else {
        chunks.push(chunk)
      }
    }

    child.stdout.on('data', (data) => {
      lastActivity = Date.now()
      lineBuf += data.toString()

      // Parse complete JSONL lines
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() || ''  // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed)
          if (event.type === 'thread.started' && event.thread_id && this.sessionEnabled) {
            this.session.sessionId = event.thread_id
          } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
            pushChunk(event.item.text)
          }
        } catch {
          // Not valid JSON, ignore
        }
      }
    })

    child.stderr.on('data', (data) => {
      lastActivity = Date.now()  // Activity on stderr also counts
      stderrOutput += data.toString()
    })

    child.on('close', (code) => {
      cleanup()
      if (timeoutChecker) clearInterval(timeoutChecker)
      // Process any remaining data in line buffer
      if (lineBuf.trim()) {
        try {
          const event = JSON.parse(lineBuf.trim())
          if (event.type === 'thread.started' && event.thread_id && this.sessionEnabled) {
            this.session.sessionId = event.thread_id
          } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
            pushChunk(event.item.text)
          }
        } catch {
          // ignore
        }
      }
      done = true
      if (code !== 0 && !error) {
        error = new Error(`Codex CLI exited with code ${code}${stderrOutput ? ': ' + stderrOutput : ''}`)
      }
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    child.on('error', (err) => {
      cleanup()
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run codex CLI: ${err.message}`)
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    // Write prompt to stdin and close
    // Suppress EPIPE: if child exits early, close handler reports the real error
    child.stdin.on('error', () => {})
    child.stdin.write(stdinPrompt)
    child.stdin.end()

    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!
      } else if (!done) {
        const result = await new Promise<{ chunk: string | null }>((resolve) => {
          resolveNext = resolve
        })
        if (result.chunk !== null) {
          yield result.chunk
        }
      }
    }

    if (error) {
      throw error
    }
  }
}
