import { spawn } from 'child_process'
import type { AIProvider, Message, ProviderOptions } from './types.js'

export class CodexCliProvider implements AIProvider {
  name = 'codex-cli'
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  // Session support: Codex CLI outputs JSONL with thread_id,
  // and supports `codex exec resume <thread_id>` for continuing sessions
  sessionId?: string
  private sessionEnabled = false
  private isFirstMessage = true
  private sessionName?: string

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
    this.isFirstMessage = true
    this.sessionId = undefined  // Will be set from first response's JSONL
    this.sessionName = name
  }

  endSession(): void {
    this.sessionEnabled = false
    this.isFirstMessage = true
    this.sessionId = undefined
    this.sessionName = undefined
  }

  async chat(messages: Message[], systemPrompt?: string): Promise<string> {
    // In session mode, only send the last user message (history is in session)
    const prompt = this.sessionEnabled && !this.isFirstMessage
      ? this.buildPromptLastOnly(messages)
      : this.buildPrompt(messages, systemPrompt)
    const result = await this.runCodex(prompt)
    this.isFirstMessage = false
    return result
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    // In session mode, only send the last user message (history is in session)
    const prompt = this.sessionEnabled && !this.isFirstMessage
      ? this.buildPromptLastOnly(messages)
      : this.buildPrompt(messages, systemPrompt)
    yield* this.runCodexStream(prompt)
    this.isFirstMessage = false
  }

  private buildPrompt(messages: Message[], systemPrompt?: string): string {
    let prompt = ''
    if (this.sessionName && this.isFirstMessage) {
      prompt += `[${this.sessionName}]\n\n`
    }
    if (systemPrompt) {
      prompt += `System: ${systemPrompt}\n\n`
    }
    for (const msg of messages) {
      prompt += `${msg.role}: ${msg.content}\n\n`
    }
    return prompt
  }

  // Only get the last user message for session continuation
  private buildPromptLastOnly(messages: Message[]): string {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    return lastUserMsg?.content || ''
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
          this.sessionId = event.thread_id
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
        if (code !== 0) {
          reject(new Error(`Codex CLI exited with code ${code}: ${error}`))
        } else {
          resolve(this.parseJsonlOutput(output))
        }
      })

      child.on('error', (err) => {
        reject(new Error(`Failed to run codex CLI: ${err.message}`))
      })

      // Write prompt to stdin and close
      child.stdin.write(prompt)
      child.stdin.end()
    })
  }

  private async *runCodexStream(prompt: string): AsyncGenerator<string, void, unknown> {
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
            this.sessionId = event.thread_id
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
      if (timeoutChecker) clearInterval(timeoutChecker)
      // Process any remaining data in line buffer
      if (lineBuf.trim()) {
        try {
          const event = JSON.parse(lineBuf.trim())
          if (event.type === 'thread.started' && event.thread_id && this.sessionEnabled) {
            this.sessionId = event.thread_id
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
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run codex CLI: ${err.message}`)
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    // Write prompt to stdin and close
    child.stdin.write(prompt)
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
