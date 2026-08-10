import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildArtifactId,
  buildArtifactManifest,
  canonicalJson,
  digestUtf8,
  getArtifactSidecarPaths,
  parseArtifactManifest,
} from './artifacts'

describe('artifact identity contract', () => {
  it('canonicalizes nested JSON by code-unit-sorted object keys', () => {
    expect(canonicalJson({ z: 1, a: { c: true, b: [2, { y: null, x: 'value' }] } })).toBe(
      '{"a":{"b":[2,{"x":"value","y":null}],"c":true},"z":1}',
    )
  })

  it('derives a stable lowercase sha256 ID without output paths or time', () => {
    const request = {
      inputSha256: 'a'.repeat(64),
      inputName: 'input.csv',
      exposedInput: 'input.csv',
      includePaths: false,
      settings: { yAxis: '出願人', xAxis: 'IPC', showCounts: false },
      resultJsonAvailable: true,
    }
    const canonical = canonicalJson({
      artifactContract: 'bubble-matrix-map-artifact-v1',
      cliVersion: '0.1.1',
      inputName: request.inputName,
      inputSha256: request.inputSha256,
      includePaths: request.includePaths,
      exposedInput: request.exposedInput,
      renderContractVersion: 2,
      resultJsonAvailable: request.resultJsonAvailable,
      settings: request.settings,
    })
    const expected = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
    const legacyCanonical = canonicalJson({
      artifactContract: 'bubble-matrix-map-artifact-v1',
      cliVersion: '0.1.1',
      inputName: request.inputName,
      inputSha256: request.inputSha256,
      includePaths: request.includePaths,
      exposedInput: request.exposedInput,
      renderContractVersion: 1,
      resultJsonAvailable: request.resultJsonAvailable,
      settings: request.settings,
    })
    const legacy = `sha256:${createHash('sha256').update(legacyCanonical, 'utf8').digest('hex')}`

    expect(buildArtifactId(request, '0.1.1')).toBe(expected)
    expect(buildArtifactId(request, '0.1.1')).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(buildArtifactId(request, '0.1.1')).not.toBe(legacy)
  })

  it('changes identity when content, effective settings, or output-affecting disclosure changes', () => {
    const base = {
      inputSha256: 'a'.repeat(64),
      inputName: 'input.csv',
      exposedInput: 'input.csv',
      includePaths: false,
      settings: { xAxis: 'IPC', yAxis: '出願人', showCounts: false },
      resultJsonAvailable: false,
    }
    const artifactId = buildArtifactId(base, '0.1.0')

    expect(buildArtifactId({ ...base, inputSha256: 'b'.repeat(64) }, '0.1.0')).not.toBe(artifactId)
    expect(buildArtifactId({ ...base, settings: { ...base.settings, showCounts: true } }, '0.1.0')).not.toBe(artifactId)
    expect(buildArtifactId({ ...base, resultJsonAvailable: true }, '0.1.0')).not.toBe(artifactId)
    expect(
      buildArtifactId(
        { ...base, includePaths: true, exposedInput: 'C:/private/input.csv' },
        '0.1.0',
      ),
    ).not.toBe(artifactId)
  })

  it('derives a manifest beside the SVG and one output-root lock', () => {
    const outputRoot = resolve('artifacts')
    const output = join(outputRoot, 'matrix.svg')
    const sidecars = getArtifactSidecarPaths(output, outputRoot)

    expect(sidecars.manifest).toBe(join(outputRoot, 'matrix.manifest.json'))
    expect(sidecars.lock).toBe(join(outputRoot, '.bubble-matrix-map.lock'))
    expect(getArtifactSidecarPaths(output, outputRoot)).toEqual(sidecars)
    expect(getArtifactSidecarPaths(join(outputRoot, 'other.svg'), outputRoot).lock).toBe(sidecars.lock)
  })

  it('builds a path-only manifest whose digests cover each requested artifact', () => {
    const svg = '<svg></svg>\n'
    const result = '{"ok":true}\n'
    const manifest = buildArtifactManifest({
      artifactId: `sha256:${'a'.repeat(64)}`,
      cliVersion: '0.1.0',
      files: [
        { role: 'svg', path: 'matrix.svg', content: svg },
        { role: 'result', path: 'matrix.json', content: result },
      ],
    })

    expect(manifest).toEqual({
      schemaVersion: 2,
      artifactId: `sha256:${'a'.repeat(64)}`,
      cliVersion: '0.1.0',
      renderContractVersion: 2,
      files: [
        { role: 'svg', path: 'matrix.svg', sha256: digestUtf8(svg), bytes: Buffer.byteLength(svg) },
        { role: 'result', path: 'matrix.json', sha256: digestUtf8(result), bytes: Buffer.byteLength(result) },
      ],
    })
  })

  it('rejects manifest roles and paths that violate runtime semantic constraints', () => {
    const file = { role: 'svg' as const, path: 'matrix.svg', sha256: 'b'.repeat(64), bytes: 10 }
    const base = {
      schemaVersion: 2 as const,
      artifactId: `sha256:${'a'.repeat(64)}`,
      cliVersion: '0.1.0',
      renderContractVersion: 2,
      files: [file],
    }

    expect(parseArtifactManifest(base)).toEqual(base)
    expect(parseArtifactManifest({ ...base, renderContractVersion: 1 })).toBeNull()
    expect(parseArtifactManifest({ ...base, files: [{ ...file, role: 'result' }] })).toBeNull()
    expect(parseArtifactManifest({ ...base, files: [file, { ...file, path: 'other.svg' }] })).toBeNull()
    expect(
      parseArtifactManifest({
        ...base,
        files: [file, { ...file, role: 'result', path: file.path }],
      }),
    ).toBeNull()
    for (const path of ['./matrix.svg', 'nested/./matrix.svg', 'nested//matrix.svg', 'nested/']) {
      expect(parseArtifactManifest({ ...base, files: [{ ...file, path }] })).toBeNull()
    }
  })
})
