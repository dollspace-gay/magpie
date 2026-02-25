import { describe, it, expect, beforeEach } from 'vitest'
import { CliSessionHelper } from '../../src/providers/session-helper.js'

describe('CliSessionHelper', () => {
  let helper: CliSessionHelper

  beforeEach(() => {
    helper = new CliSessionHelper()
  })

  describe('start/end', () => {
    it('generates a session ID on start', () => {
      helper.start()
      expect(helper.sessionId).toBeDefined()
      expect(typeof helper.sessionId).toBe('string')
      expect(helper.sessionId!.length).toBeGreaterThan(0)
    })

    it('stores session name', () => {
      helper.start('test-session')
      expect(helper.sessionName).toBe('test-session')
    })

    it('resets state on end', () => {
      helper.start('test')
      helper.markMessageSent()
      helper.end()
      expect(helper.sessionId).toBeUndefined()
      expect(helper.isFirstMessage).toBe(true)
      expect(helper.sessionName).toBeUndefined()
    })
  })

  describe('shouldSendFullHistory', () => {
    it('returns true when no session', () => {
      expect(helper.shouldSendFullHistory()).toBe(true)
    })

    it('returns true on first message of session', () => {
      helper.start()
      expect(helper.shouldSendFullHistory()).toBe(true)
    })

    it('returns false after first message sent', () => {
      helper.start()
      helper.markMessageSent()
      expect(helper.shouldSendFullHistory()).toBe(false)
    })
  })

  describe('buildPrompt', () => {
    it('includes system prompt and messages', () => {
      const result = helper.buildPrompt(
        [{ role: 'user', content: 'hello' }],
        'You are a reviewer'
      )
      expect(result).toContain('System: You are a reviewer')
      expect(result).toContain('user: hello')
    })

    it('includes session name on first message', () => {
      helper.start('review-1')
      const result = helper.buildPrompt(
        [{ role: 'user', content: 'review this' }]
      )
      expect(result).toContain('[review-1]')
    })

    it('omits session name after first message', () => {
      helper.start('review-1')
      helper.markMessageSent()
      const result = helper.buildPrompt(
        [{ role: 'user', content: 'review this' }]
      )
      expect(result).not.toContain('[review-1]')
    })

    it('handles multiple messages', () => {
      const result = helper.buildPrompt([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' }
      ])
      expect(result).toContain('user: first')
      expect(result).toContain('assistant: reply')
      expect(result).toContain('user: second')
    })
  })

  describe('buildPromptLastOnly', () => {
    it('returns last user message content', () => {
      const result = helper.buildPromptLastOnly([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'latest question' }
      ])
      expect(result).toBe('latest question')
    })

    it('returns empty string when no user messages', () => {
      const result = helper.buildPromptLastOnly([
        { role: 'assistant', content: 'unsolicited' }
      ])
      expect(result).toBe('')
    })
  })
})
