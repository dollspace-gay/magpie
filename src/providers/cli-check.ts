import { spawnSync } from 'child_process'

/**
 * Verify a CLI binary exists before attempting to use it.
 * Throws a user-friendly error if the binary is not found.
 */
export function checkCliBinary(binary: string, displayName: string): void {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [binary], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    throw new Error(
      `${displayName} CLI ('${binary}') not found. Please install it first.\n` +
      `See the Magpie README for setup instructions.`
    )
  }
}
