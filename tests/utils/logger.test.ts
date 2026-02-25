import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Logger', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.MAGPIE_LOG_LEVEL
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MAGPIE_LOG_LEVEL = originalEnv
    } else {
      delete process.env.MAGPIE_LOG_LEVEL
    }
    vi.restoreAllMocks()
    // Clear module cache so Logger re-reads env
    vi.resetModules()
  })

  it('defaults to info level', async () => {
    delete process.env.MAGPIE_LOG_LEVEL
    const { logger } = await import('../../src/utils/logger.js')
    expect(logger.getLevel()).toBe('info')
  })

  it('reads MAGPIE_LOG_LEVEL env var', async () => {
    process.env.MAGPIE_LOG_LEVEL = 'debug'
    const { logger } = await import('../../src/utils/logger.js')
    expect(logger.getLevel()).toBe('debug')
  })

  it('filters debug when level is info', async () => {
    delete process.env.MAGPIE_LOG_LEVEL
    const { logger } = await import('../../src/utils/logger.js')
    logger.setLevel('info')
    logger.debug('should not appear')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs warn at info level', async () => {
    delete process.env.MAGPIE_LOG_LEVEL
    const { logger } = await import('../../src/utils/logger.js')
    logger.setLevel('info')
    logger.warn('warning message')
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('logs debug at debug level', async () => {
    process.env.MAGPIE_LOG_LEVEL = 'debug'
    const { logger } = await import('../../src/utils/logger.js')
    logger.debug('debug message')
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('filters info when level is error', async () => {
    delete process.env.MAGPIE_LOG_LEVEL
    const { logger } = await import('../../src/utils/logger.js')
    logger.setLevel('error')
    logger.info('should not appear')
    logger.warn('should not appear')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('setLevel updates the level', async () => {
    delete process.env.MAGPIE_LOG_LEVEL
    const { logger } = await import('../../src/utils/logger.js')
    logger.setLevel('warn')
    expect(logger.getLevel()).toBe('warn')
  })
})
