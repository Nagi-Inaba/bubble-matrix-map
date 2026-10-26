import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

type PackageDocument = {
  name: string
  private: boolean
  version: string
  bin: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  license?: string
  files?: string[]
  repository?: { type: string; url: string }
  homepage?: string
  bugs?: { url: string }
  overrides?: Record<string, string | Record<string, string>>
  scripts?: Record<string, string>
}

describe('repository boundary', () => {
  it('keeps the package private and uses the Bubble Matrix Map identity', async () => {
    const packageDocument = JSON.parse(await readFile('package.json', 'utf8')) as PackageDocument
    const version = (await readFile('VERSION', 'utf8')).trim()

    expect(packageDocument).toMatchObject({
      name: 'bubble-matrix-map',
      private: true,
      bin: { 'bubble-matrix-map': 'bin/bubble-matrix-map.mjs' },
    })
    expect(packageDocument.version).toBe(version)
    expect(version).toBe('0.1.1')
    expect(packageDocument.license).toBe('Apache-2.0')
    expect(packageDocument.files).toEqual(expect.arrayContaining(['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES', 'schemas/']))
    expect(packageDocument.files).not.toContain('docs/release-gates.md')
    expect(packageDocument.scripts?.['audit:public-copy']).toBe('node scripts/public-copy-audit.mjs')
    expect(packageDocument.scripts?.['verify:public-export']).toBe('node scripts/verify-public-export.mjs')
  })

  it('does not carry desktop runtime dependencies', async () => {
    const packageDocument = JSON.parse(await readFile('package.json', 'utf8')) as PackageDocument
    const allDependencies = {
      ...packageDocument.dependencies,
      ...packageDocument.devDependencies,
    }

    expect(allDependencies).not.toHaveProperty('electron')
    expect(allDependencies).not.toHaveProperty('react')
    expect(allDependencies).not.toHaveProperty('react-dom')
  })

  it('uses the approved GitHub metadata and contains required legal artifacts', async () => {
    const packageDocument = JSON.parse(await readFile('package.json', 'utf8')) as PackageDocument
    expect(packageDocument.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Nagi-Inaba/bubble-matrix-map.git',
    })
    expect(packageDocument.homepage).toBe('https://github.com/Nagi-Inaba/bubble-matrix-map#readme')
    expect(packageDocument.bugs).toEqual({ url: 'https://github.com/Nagi-Inaba/bubble-matrix-map/issues' })
    expect(packageDocument.dependencies ?? {}).not.toHaveProperty('exceljs')
    expect(packageDocument.devDependencies?.exceljs).toBe('4.4.0')
    expect(packageDocument.overrides).toEqual({
      'brace-expansion': '5.0.12',
      'fast-uri': '3.1.9',
      'source-map-js': '1.2.2',
      exceljs: {
        archiver: '8.0.0',
        unzipper: '0.12.5',
        uuid: '11.1.1',
      },
    })
    expect(packageDocument.scripts?.['audit:dependencies']).toBe('npm audit --audit-level=high')
    expect(packageDocument.scripts?.verify).toContain('npm run audit:dependencies')
    await expect(readFile('LICENSE', 'utf8')).resolves.toContain('Copyright 2026 Nagi Inaba')
    await expect(readFile('NOTICE', 'utf8')).resolves.toContain('Apache ECharts 6.1.0')
    const bundledLicenses = await readFile('licenses/BUNDLED_NPM_LICENSES.txt', 'utf8')
    expect(bundledLicenses.match(/^Declared license:/gm)).toHaveLength(68)
    for (const packageVersion of [
      'readable-stream@2.3.8',
      'readable-stream@3.6.2',
      'readable-stream@4.7.0',
      'safe-buffer@5.1.2',
      'safe-buffer@5.2.1',
      'string_decoder@1.1.1',
      'string_decoder@1.3.0',
    ]) {
      expect(bundledLicenses).toContain(packageVersion)
    }
    await expect(readFile('schemas/inspect-receipt.schema.json', 'utf8')).resolves.toContain('schemaVersion')
    await expect(readFile('docs/ai-integration.md', 'utf8')).resolves.toContain('stdout')
  })

  it('propagates native command failures from clean-room verification', async () => {
    const script = await readFile('scripts/clean-room-verify.ps1', 'utf8')
    expect(script).toContain("Invoke-Checked { npm ci } 'npm ci'")
    expect(script).toContain("Invoke-Checked { npm run verify } 'npm run verify'")
    expect(script).toContain("Invoke-Checked { npm run audit:public-tree } 'npm run audit:public-tree'")
    expect(script).toContain("Invoke-Checked { npm run audit:public-copy } 'npm run audit:public-copy'")
    expect(script).toContain('if ($LASTEXITCODE -ne 0)')
  })
})
