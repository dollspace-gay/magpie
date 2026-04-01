import { spawn } from 'child_process'
import type { AIProvider, Message, CliProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'
import { logger } from '../utils/logger.js'
import { preparePromptForCli } from '../utils/prompt-file.js'
import { withRetry } from '../utils/retry.js'

export class QwenCodeProvider implements AIProvider {
  name = 'qwen-code'
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  private cliModel?: string
  private session = new CliSessionHelper()

  get sessionId() { return this.session.sessionId }

  constructor(options?: CliProviderOptions) {
    // No API key needed for Qwen Code CLI (uses OAuth)
    this.cwd = process.cwd()
    this.timeout = 15 * 60 * 1000  // 15 minutes default
    this.cliModel = options?.cliModel
  }

  setCwd(cwd: string) {
    this.cwd = cwd
  }

  startSession(name?: string): void {
    this.session.start(name)
  }

  endSession(): void {
    this.session.end()
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const prompt = this.session.shouldSendFullHistory()
      ? this.session.buildPrompt(messages, systemPrompt)
      : this.session.buildPromptLastOnly(messages)
    const result = await withRetry(() => this.runQwen(prompt, systemPrompt, options))
    this.session.markMessageSent()
    return result
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const prompt = this.session.shouldSendFullHistory()
      ? this.session.buildPrompt(messages, systemPrompt)
      : this.session.buildPromptLastOnly(messages)
    yield* this.runQwenStream(prompt, systemPrompt)
    this.session.markMessageSent()
  }

  private runQwen(prompt: string, systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const { prompt: stdinPrompt, cleanup } = preparePromptForCli(prompt)

    return new Promise((resolve, reject) => {
      // qwen -p - reads from stdin; -y auto-approves; text output
      // Limit session turns to prevent autonomous tool abuse (e.g., fetching GitHub data that leaks revert info)
      const args = ['-p', '-', '-y', '--max-session-turns', '5', '--output-format', 'text']
      if (this.cliModel) {
        args.push('--model', this.cliModel)
      }
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
        cleanup()
        if (code !== 0) {
          logger.debug(`[qwen-code] exit=${code} stderr=${error.slice(0, 500)}`)
          reject(new Error(`Qwen CLI exited with code ${code}: ${error}`))
        } else {
          resolve(output.trim())
        }
      })

      child.on('error', (err) => {
        cleanup()
        reject(new Error(`Failed to run qwen CLI: ${err.message}`))
      })

      // Write prompt to stdin and close
      // Suppress EPIPE: if child exits early, close handler reports the real error
      child.stdin.on('error', () => {})
      child.stdin.write(stdinPrompt)
      child.stdin.end()
    })
  }

  private async *runQwenStream(prompt: string, systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const { prompt: stdinPrompt, cleanup } = preparePromptForCli(prompt)

    // Limit session turns to prevent autonomous tool abuse
    const args = ['-p', '-', '-y', '--max-session-turns', '5', '--output-format', 'text']
    if (this.cliModel) {
      args.push('--model', this.cliModel)
    }

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
        // Force kill if SIGTERM is ignored
        const forceKill = setTimeout(() => {
          try { child.kill('SIGKILL') } catch {}
        }, 5000)
        forceKill.unref()
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
      cleanup()
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
      cleanup()
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run qwen CLI: ${err.message}`)
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
