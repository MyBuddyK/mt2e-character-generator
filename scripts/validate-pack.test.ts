import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/** Runs `npm run -s validate-pack <file>` and returns its exit code and combined output. */
function validate(file: string): { status: number | null; output: string } {
  const run = spawnSync('npm', ['run', '-s', 'validate-pack', file], { encoding: 'utf8' })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

// Tests for scripts/validate-pack.ts, run as a child process on the e2e fixtures.
describe('validate-pack', () => {
  // Runs it on the valid fixture and expects exit code 0 and the loaded message.
  it('exits 0 for a valid pack', () => {
    const { status, output } = validate('e2e/fixtures/valid-pack.json')
    expect(output).toContain('Loaded "Test core pack" revision 1: 2 careers.')
    expect(status).toBe(0)
  })

  // Runs it on the partly invalid fixture and expects exit code 1 and the skipped career's message.
  it('exits 1 and lists the skipped career for a partly invalid pack', () => {
    const { status, output } = validate('e2e/fixtures/partly-invalid-pack.json')
    expect(output).toMatch(/careers\.1 \(test-surveyor\): qualification\.target: /)
    expect(status).toBe(1)
  })

  // Runs it on the later-version fixture and expects exit code 1 and the supported version message.
  it('exits 1 for a pack it rejects', () => {
    const { status, output } = validate('e2e/fixtures/later-version-pack.json')
    expect(output).toContain('this app supports versions 1 and 2')
    expect(status).toBe(1)
  })
})
