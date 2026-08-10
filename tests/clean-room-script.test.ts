import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('clean-room verification script', () => {
  it.runIf(process.platform === 'win32')('returns non-zero when a native command fails', () => {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve('scripts/clean-room-verify.ps1'),
        '-ProbeNativeFailure',
      ],
      { encoding: 'utf8', windowsHide: true },
    )

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('intentional failure probe failed with exit code 7')
  })
})
