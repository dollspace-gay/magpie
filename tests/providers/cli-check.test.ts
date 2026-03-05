import { describe, it, expect } from 'vitest'
import { checkCliBinary } from '../../src/providers/cli-check.js'

describe('checkCliBinary', () => {
  it('should not throw for a binary that exists', () => {
    expect(() => checkCliBinary('node', 'Node.js')).not.toThrow()
  })

  it('should throw with helpful message for missing binary', () => {
    expect(() => checkCliBinary('nonexistent-tool-xyz', 'NonExistent Tool'))
      .toThrow(/not found.*install/i)
  })
})
