import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MagpieConfig } from '../../src/config/types.js'

// Mock fs and yaml
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}))
vi.mock('yaml', () => ({
  parse: vi.fn()
}))

// Mock logger to suppress output
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { loadConfig } from '../../src/config/loader.js'
import { existsSync, readFileSync } from 'fs'
import { parse } from 'yaml'
import { logger } from '../../src/utils/logger.js'

const validConfig: MagpieConfig = {
  defaults: { max_rounds: 3, check_convergence: true },
  providers: {
    anthropic: { api_key: 'test-key' }
  },
  reviewers: {
    claude: { model: 'anthropic:claude-3-5-sonnet', prompt: 'Review this code' }
  },
  summarizer: { model: 'anthropic:claude-3-5-sonnet', prompt: 'Summarize' },
  analyzer: { model: 'anthropic:claude-3-5-sonnet', prompt: 'Analyze' }
}

describe('loadConfig - validation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('yaml content')
  })

  it('loads valid config without error', () => {
    vi.mocked(parse).mockReturnValue(structuredClone(validConfig))
    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('throws when max_rounds <= 0', () => {
    const bad = structuredClone(validConfig)
    bad.defaults.max_rounds = 0
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('max_rounds must be > 0')
  })

  it('throws when no reviewers defined', () => {
    const bad = structuredClone(validConfig)
    bad.reviewers = {}
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('at least one reviewer')
  })

  it('throws when reviewer missing model', () => {
    const bad = structuredClone(validConfig)
    bad.reviewers = { claude: { model: '', prompt: 'test' } }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('missing a "model" field')
  })

  it('throws when reviewer missing prompt', () => {
    const bad = structuredClone(validConfig)
    bad.reviewers = { claude: { model: 'test:model', prompt: '' } }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('missing a "prompt" field')
  })

  it('throws when summarizer missing model', () => {
    const bad = structuredClone(validConfig)
    bad.summarizer = { model: '', prompt: 'summarize' }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('summarizer is missing a "model"')
  })

  it('warns on empty API key', () => {
    const config = structuredClone(validConfig)
    config.providers = { anthropic: { api_key: '' } }
    vi.mocked(parse).mockReturnValue(config)
    loadConfig('/path/to/config.yaml')
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('api_key is empty')
    )
  })

  it('does not warn when API key is set', () => {
    vi.mocked(parse).mockReturnValue(structuredClone(validConfig))
    loadConfig('/path/to/config.yaml')
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })

  it('throws when config file not found', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(() => loadConfig('/path/to/missing.yaml')).toThrow('Config file not found')
  })
})
