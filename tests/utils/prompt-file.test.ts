import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { preparePromptForCli } from '../../src/utils/prompt-file.js'

describe('preparePromptForCli', () => {
  it('should return original prompt when under threshold', () => {
    const result = preparePromptForCli('small prompt')
    expect(result.prompt).toBe('small prompt')
    result.cleanup()
  })

  it('should write large prompts to temp file and cleanup', () => {
    const largePrompt = 'x'.repeat(200 * 1024)
    const result = preparePromptForCli(largePrompt)
    expect(result.prompt).toContain('file')
    expect(result.prompt).not.toBe(largePrompt)

    const pathMatch = result.prompt.match(/\/.*magpie_prompt_\S+/)
    expect(pathMatch).toBeTruthy()
    const tmpPath = pathMatch![0]
    expect(existsSync(tmpPath)).toBe(true)

    result.cleanup()
    expect(existsSync(tmpPath)).toBe(false)
  })
})
