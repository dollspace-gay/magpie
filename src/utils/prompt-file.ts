import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// CLI tools (claude, gemini, codex, qwen) may reject prompts above ~100 KB via stdin.
// When a prompt exceeds this threshold, write it to a temp file and send a short
// instruction via stdin instead. The CLI tool reads the file using its built-in tools.
const PROMPT_SIZE_THRESHOLD = 100 * 1024 // 100 KB

export interface PreparedPrompt {
  prompt: string
  cleanup: () => void
}

export function preparePromptForCli(prompt: string): PreparedPrompt {
  if (Buffer.byteLength(prompt, 'utf-8') <= PROMPT_SIZE_THRESHOLD) {
    return { prompt, cleanup: () => {} }
  }

  const tmpFile = join(tmpdir(), `magpie_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(tmpFile, prompt, 'utf-8')

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
      try { unlinkSync(tmpFile) } catch {}
    }
  }
}
