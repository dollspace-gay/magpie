import { describe, it, expect, vi } from 'vitest'
import { AnthropicProvider } from '../../src/providers/anthropic.js'

// Mock the SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock response' }]
      }),
      stream: vi.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk1' } }
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk2' } }
        },
        abort: vi.fn()
      })
    }
  }
}))

describe('AnthropicProvider', () => {
  it('should have correct name', () => {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    expect(provider.name).toBe('anthropic')
  })

  it('should call chat and return response', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    const result = await provider.chat([{ role: 'user', content: 'Hello' }])
    expect(result).toBe('Mock response')
  })

  it('should stream responses', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hello' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['chunk1', 'chunk2'])
  })
})
