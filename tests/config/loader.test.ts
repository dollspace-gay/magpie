// tests/config/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, expandEnvVars, getConfigPath } from '../../src/config/loader.js'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Config Loader', () => {
  const testDir = join(tmpdir(), 'magpie-test-' + Date.now())

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('expandEnvVars', () => {
    it('should expand environment variables', () => {
      process.env.TEST_API_KEY = 'secret123'
      const result = expandEnvVars('${TEST_API_KEY}')
      expect(result).toBe('secret123')
      delete process.env.TEST_API_KEY
    })

    it('should leave non-env strings unchanged', () => {
      const result = expandEnvVars('plain-string')
      expect(result).toBe('plain-string')
    })
  })

  describe('loadConfig', () => {
    it('should load and parse yaml config', () => {
      const configPath = join(testDir, 'config.yaml')
      writeFileSync(configPath, `
providers:
  anthropic:
    api_key: test-key
defaults:
  max_rounds: 3
  output_format: markdown
reviewers:
  test-reviewer:
    model: claude-sonnet-4-20250514
    prompt: Test prompt
summarizer:
  model: claude-sonnet-4-20250514
  prompt: Summarizer prompt
analyzer:
  model: claude-sonnet-4-20250514
  prompt: Analyzer prompt
`)
      const config = loadConfig(configPath)
      expect(config.defaults.max_rounds).toBe(3)
      expect(config.reviewers['test-reviewer'].model).toBe('claude-sonnet-4-20250514')
    })
  })

  describe('getConfigPath', () => {
    it('should return custom path if provided', () => {
      const result = getConfigPath('/custom/path.yaml')
      expect(result).toBe('/custom/path.yaml')
    })

    it('should return default path if not provided', () => {
      const result = getConfigPath()
      expect(result).toContain('.magpie/config.yaml')
    })
  })
})
