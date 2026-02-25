import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DebateOrchestrator } from '../../src/orchestrator/orchestrator.js'
import type { Reviewer, OrchestratorOptions } from '../../src/orchestrator/types.js'
import { parseReviewerOutput, parseFocusAreas, deduplicateIssues } from '../../src/orchestrator/issue-parser.js'

// Mock issue-parser to return minimal valid output
vi.mock('../../src/orchestrator/issue-parser.js', () => ({
  parseReviewerOutput: vi.fn(),
  parseFocusAreas: vi.fn(),
  deduplicateIssues: vi.fn()
}))

vi.mock('../../src/context-gatherer/collectors/reference-collector.js', () => ({
  formatCallChainForReviewer: vi.fn().mockReturnValue('')
}))

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

function createMockReviewer(id: string): Reviewer {
  return {
    id,
    systemPrompt: 'test prompt',
    provider: {
      name: 'mock',
      chat: vi.fn().mockResolvedValue('mock response'),
      chatStream: vi.fn().mockImplementation(async function* () { yield 'mock' }),
      startSession: vi.fn(),
      endSession: vi.fn(),
      setCwd: vi.fn()
    }
  }
}

describe('DebateOrchestrator - session cleanup', () => {
  let reviewerA: Reviewer
  let reviewerB: Reviewer
  let summarizer: Reviewer
  let analyzer: Reviewer

  beforeEach(() => {
    vi.resetAllMocks()
    // Re-setup module mocks after reset
    vi.mocked(parseReviewerOutput).mockReturnValue({ issues: [], verdict: 'comment', summary: 'no issues' })
    vi.mocked(parseFocusAreas).mockReturnValue([])
    vi.mocked(deduplicateIssues).mockReturnValue([])
    reviewerA = createMockReviewer('a')
    reviewerB = createMockReviewer('b')
    summarizer = createMockReviewer('summarizer')
    analyzer = createMockReviewer('analyzer')
  })

  it('calls endSession on all providers after successful run', async () => {
    const options: OrchestratorOptions = {
      maxRounds: 1,
      checkConvergence: false
    }
    const orchestrator = new DebateOrchestrator(
      [reviewerA, reviewerB], summarizer, analyzer, options
    )

    await orchestrator.run('test', 'test prompt')

    expect(reviewerA.provider.endSession).toHaveBeenCalled()
    expect(reviewerB.provider.endSession).toHaveBeenCalled()
    expect(summarizer.provider.endSession).toHaveBeenCalled()
    expect(analyzer.provider.endSession).toHaveBeenCalled()
  })

  it('calls endSession on all providers even when error occurs', async () => {
    // Make analyzer throw
    analyzer.provider.chat = vi.fn().mockRejectedValue(new Error('analyzer crashed'))

    const options: OrchestratorOptions = {
      maxRounds: 1,
      checkConvergence: false
    }
    const orchestrator = new DebateOrchestrator(
      [reviewerA], summarizer, analyzer, options
    )

    await expect(orchestrator.run('test', 'test prompt')).rejects.toThrow('analyzer crashed')

    // Sessions should still be cleaned up
    expect(reviewerA.provider.endSession).toHaveBeenCalled()
    expect(analyzer.provider.endSession).toHaveBeenCalled()
    expect(summarizer.provider.endSession).toHaveBeenCalled()
  })
})
