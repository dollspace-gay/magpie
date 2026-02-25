import { describe, it, expect, vi } from 'vitest'
import { withRetry } from '../../src/utils/retry.js'

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on transient error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
      .mockResolvedValue('ok')
    const result = await withRetry(fn, { backoffMs: [1, 1, 1] })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 429 status error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValue('ok')
    const result = await withRetry(fn, { backoffMs: [1, 1, 1] })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 5xx status error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 503, message: 'service unavailable' })
      .mockResolvedValue('ok')
    const result = await withRetry(fn, { backoffMs: [1, 1, 1] })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws immediately on non-transient error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('auth failed'))
    await expect(withRetry(fn, { backoffMs: [1, 1, 1] })).rejects.toThrow('auth failed')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('exhausts all attempts and throws last error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'reset 1' })
      .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'reset 2' })
      .mockRejectedValue({ code: 'ECONNRESET', message: 'reset 3' })
    await expect(withRetry(fn, { maxAttempts: 3, backoffMs: [1, 1, 1] })).rejects.toEqual(
      expect.objectContaining({ code: 'ECONNRESET', message: 'reset 3' })
    )
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('respects custom shouldRetry', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('custom retryable'))
      .mockResolvedValue('ok')
    const result = await withRetry(fn, {
      backoffMs: [1],
      shouldRetry: (err) => err instanceof Error && err.message.includes('retryable')
    })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on message-based transient detection', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('connection timeout occurred'))
      .mockResolvedValue('ok')
    const result = await withRetry(fn, { backoffMs: [1] })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
