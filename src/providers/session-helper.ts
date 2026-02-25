// src/providers/session-helper.ts
import { randomUUID } from 'crypto'
import type { Message } from './types.js'

/**
 * Shared session management for CLI-based providers.
 * Eliminates duplicated session/prompt logic across claude-code, qwen-code, codex-cli, gemini-cli.
 */
export class CliSessionHelper {
  sessionId?: string
  isFirstMessage: boolean = true
  sessionName?: string

  start(name?: string): void {
    this.sessionId = randomUUID()
    this.isFirstMessage = true
    this.sessionName = name
  }

  end(): void {
    this.sessionId = undefined
    this.isFirstMessage = true
    this.sessionName = undefined
  }

  /** Whether the next call should send full history (first message) or just the last user message */
  shouldSendFullHistory(): boolean {
    return !(this.sessionId && !this.isFirstMessage)
  }

  markMessageSent(): void {
    this.isFirstMessage = false
  }

  /** Build full prompt from messages and system prompt (for first call or non-session mode) */
  buildPrompt(messages: Message[], systemPrompt?: string): string {
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

  /** Get only the last user message (for session continuation) */
  buildPromptLastOnly(messages: Message[]): string {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    return lastUserMsg?.content || ''
  }
}
