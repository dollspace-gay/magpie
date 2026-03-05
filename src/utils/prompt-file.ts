import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PROMPT_SIZE_THRESHOLD = 100 * 1024 // 100 KB

// Track active temp files for cleanup on unexpected exit
const activeTempFiles = new Set<string>()

let exitHandlerRegistered = false
function registerExitHandler() {
  if (exitHandlerRegistered) return
  exitHandlerRegistered = true
  process.on('exit', () => {
    for (const f of activeTempFiles) {
      try { unlinkSync(f) } catch {}
    }
  })
}

export interface PreparedPrompt {
  prompt: string
  cleanup: () => void
}

export function preparePromptForCli(prompt: string): PreparedPrompt {
  if (Buffer.byteLength(prompt, 'utf-8') <= PROMPT_SIZE_THRESHOLD) {
    return { prompt, cleanup: () => {} }
  }

  registerExitHandler()

  const tmpFile = join(tmpdir(), `magpie_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(tmpFile, prompt, 'utf-8')
  activeTempFiles.add(tmpFile)

  const shortPrompt = [
    `The full review prompt is too large for stdin. It has been written to a file.`,
    ``,
    `Please read the file at: ${tmpFile}`,
    `Then follow all the instructions contained within it exactly.`,
    `The file contains the complete code review prompt including the diff and all context.`,
  ].join('\n')

  return {
    prompt: shortPrompt,
    cleanup: () => {
      activeTempFiles.delete(tmpFile)
      try { unlinkSync(tmpFile) } catch {}
    }
  }
}
