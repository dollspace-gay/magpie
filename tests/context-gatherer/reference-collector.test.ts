// tests/context-gatherer/reference-collector.test.ts
import { describe, it, expect } from 'vitest'
import { extractSymbolsFromDiff, formatCallChainForReviewer } from '../../src/context-gatherer/collectors/reference-collector.js'
import type { RawReference } from '../../src/context-gatherer/types.js'

describe('extractSymbolsFromDiff', () => {
  it('should extract function names', () => {
    const diff = `
+function createOrder(data) {
+  return data
+}
`
    const symbols = extractSymbolsFromDiff(diff)
    expect(symbols).toContain('createOrder')
  })

  it('should extract class names', () => {
    const diff = `
+class OrderService {
+  constructor() {}
+}
`
    const symbols = extractSymbolsFromDiff(diff)
    expect(symbols).toContain('OrderService')
  })

  it('should extract arrow functions', () => {
    const diff = `
+const processOrder = async (order) => {
+  return order
+}
`
    const symbols = extractSymbolsFromDiff(diff)
    expect(symbols).toContain('processOrder')
  })

  it('should filter out short names and keywords', () => {
    const diff = `
+function do() {}
+const x = 1
`
    const symbols = extractSymbolsFromDiff(diff)
    expect(symbols).not.toContain('do')
    expect(symbols).not.toContain('x')
  })
})

describe('formatCallChainForReviewer', () => {
  it('should format references as structured call chain text', () => {
    const references: RawReference[] = [{
      symbol: 'parseAuth',
      foundInFiles: [
        { file: 'src/api/login.ts', line: 34, content: 'const user = parseAuth(req.token, opts)' },
        { file: 'src/middleware/auth.ts', line: 12, content: 'const u = parseAuth(header, {})' }
      ]
    }]
    const result = formatCallChainForReviewer(references)
    expect(result).toContain('parseAuth')
    expect(result).toContain('src/api/login.ts:34')
    expect(result).toContain('src/middleware/auth.ts:12')
  })

  it('should return empty string for no references', () => {
    const result = formatCallChainForReviewer([])
    expect(result).toBe('')
  })

  it('should limit to 10 callers per symbol', () => {
    const manyFiles = Array.from({ length: 15 }, (_, i) => ({
      file: `src/file${i}.ts`, line: i + 1, content: `call${i}()`
    }))
    const references: RawReference[] = [{ symbol: 'myFunc', foundInFiles: manyFiles }]
    const result = formatCallChainForReviewer(references)
    // Should only contain first 10, not all 15
    expect(result).toContain('src/file0.ts:1')
    expect(result).toContain('src/file9.ts:10')
    expect(result).not.toContain('src/file10.ts:11')
  })
})
