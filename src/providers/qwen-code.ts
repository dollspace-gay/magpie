import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'

export class QwenCodeProvider implements AIProvider {
  name = 'qwen-code'
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  sessionId?: string
  private isFirstMessage: boolean = true
  private sessionName?: string

  constructor(_options?: ProviderOptions) {
    // No API key needed for Qwen Code CLI (uses OAuth)
    this.cwd = process.cwd()
    this.timeout = 15 * 60 * 1000  // 15 minutes default
  }

  setCwd(cwd: string) {
    this.cwd = cwd
  }

  startSession(name?: string): void {
    this.sessionId = randomUUID()
    this.isFirstMessage = true
    this.sessionName = name
  }

  endSession(): void {
    this.sessionId = undefined
    this.isFirstMessage = true
    this.sessionName = undefined
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    // In session mode, only send the last user message (history is in session)
    const prompt = this.sessionId && !this.isFirstMessage
      ? this.buildPromptLastOnly(messages)
      : this.buildPrompt(messages, systemPrompt)
    const result = await this.runQwen(prompt, systemPrompt, options)
    this.isFirstMessage = false
    return result
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    // In session mode, only send the last user message (history is in session)
    const prompt = this.sessionId && !this.isFirstMessage
      ? this.buildPromptLastOnly(messages)
      : this.buildPrompt(messages, systemPrompt)
    yield* this.runQwenStream(prompt, systemPrompt)
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

  private runQwen(prompt: string, systemPrompt?: string, options?: ChatOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      // qwen -p - reads from stdin; -y auto-approves; text output
      // Limit session turns to prevent autonomous tool abuse (e.g., fetching GitHub data that leaks revert info)
      const args = ['-p', '-', '-y', '--max-session-turns', '5', '--output-format', 'text']
      console.error(`[qwen-code] runQwen: prompt_len=${prompt.length} cwd=${this.cwd} first200="${prompt.slice(0, 200)}"`)

      const child = spawn('qwen', args, {
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
          console.error(`[qwen-code] exit=${code} stderr=${error.slice(0, 500)} stdout_len=${output.length} prompt_len=${prompt.length}`)
          reject(new Error(`Qwen CLI exited with code ${code}: ${error}`))
        } else {
          resolve(output.trim())
        }
      })

      child.on('error', (err) => {
        reject(new Error(`Failed to run qwen CLI: ${err.message}`))
      })

      // Write prompt to stdin and close
      child.stdin.write(prompt)
      child.stdin.end()
    })
  }

  private async *runQwenStream(prompt: string, systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    // Limit session turns to prevent autonomous tool abuse
    const args = ['-p', '-', '-y', '--max-session-turns', '5', '--output-format', 'text']

    const child = spawn('qwen', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const chunks: string[] = []
    let resolveNext: ((value: { chunk: string | null }) => void) | null = null
    let done = false
    let error: Error | null = null
    let lastActivity = Date.now()

    // Timeout checker - kill if no activity for too long
    const timeoutChecker = this.timeout > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > this.timeout) {
        child.kill('SIGTERM')
        done = true
        error = new Error(`Qwen CLI timed out after ${this.timeout / 1000}s of inactivity`)
        if (resolveNext) {
          resolveNext({ chunk: null })
        }
      }
    }, 10000) : null  // Check every 10s

    child.stdout.on('data', (data) => {
      lastActivity = Date.now()
      const chunk = data.toString()
      if (resolveNext) {
        resolveNext({ chunk })
        resolveNext = null
      } else {
        chunks.push(chunk)
      }
    })

    child.stderr.on('data', (_data) => {
      lastActivity = Date.now()  // Activity on stderr also counts
    })

    child.on('close', (code) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      if (code !== 0 && !error) {
        error = new Error(`Qwen CLI exited with code ${code}`)
      }
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    child.on('error', (err) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run qwen CLI: ${err.message}`)
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
