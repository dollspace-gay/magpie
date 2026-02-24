// src/providers/mock.ts
import { readFileSync } from 'fs'
import type { AIProvider, Message } from './types.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getResponse(messages: Message[]): string {
  const envResponse = process.env.MAGPIE_MOCK_RESPONSE
  if (envResponse) {
    return envResponse
  }

  const envFile = process.env.MAGPIE_MOCK_FILE
  if (envFile) {
    return readFileSync(envFile, 'utf-8')
  }

  // Echo last user message
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  return `[MOCK] received: ${lastUserMsg?.content ?? '(no user message)'}`
}

function getDelay(): number {
  const envDelay = process.env.MAGPIE_MOCK_DELAY
  return envDelay ? parseInt(envDelay, 10) : 50
}

export class MockProvider implements AIProvider {
  name = 'mock'

  async chat(messages: Message[], _systemPrompt?: string): Promise<string> {
    return getResponse(messages)
  }

  async *chatStream(messages: Message[], _systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const text = getResponse(messages)
    const delay = getDelay()
    const words = text.split(/(\s+)/)

    for (const word of words) {
      yield word
      if (word.trim()) {
        await sleep(delay)
      }
    }
  }
}
