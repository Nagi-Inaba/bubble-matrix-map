import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import type { AnySchema } from 'ajv'
import { afterEach, describe, expect, it } from 'vitest'
import { CLI_ERROR_CODES, CLI_ERROR_REASONS, CliError, toErrorReceipt } from '../src/cli/args'
import { buildCliContract } from '../src/cli/contract'
import { generateOutput, inspectInput } from '../src/cli/workflow'
import { NOTICE_CODES } from '../src/lib/types'

const temporaryDirectories: string[] = []

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function readSchema(path: string): Promise<AnySchema> {
  return (await readJson(path)) as AnySchema
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('distributed JSON schemas', () => {
  it('validate the example settings and real CLI artifacts', async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    const settingsSchema = await readSchema('schemas/matrix-settings.schema.json')
    const effectiveSettingsSchema = await readSchema('schemas/matrix-settings-effective.schema.json')
    const inspectSchema = await readSchema('schemas/inspect-receipt.schema.json')
    const generateSchema = await readSchema('schemas/generate-receipt.schema.json')
    const resultSchema = await readSchema('schemas/matrix-result.schema.json')
    const errorSchema = await readSchema('schemas/error-receipt.schema.json')
    const settingsV2Schema = await readSchema('schemas/v2/matrix-settings.schema.json')
    const effectiveSettingsV2Schema = await readSchema('schemas/v2/matrix-settings-effective.schema.json')
    const noticeV2Schema = await readSchema('schemas/v2/notice.schema.json')
    const inspectV2Schema = await readSchema('schemas/v2/inspect-receipt.schema.json')
    const generateV2Schema = await readSchema('schemas/v2/generate-receipt.schema.json')
    const resultV2Schema = await readSchema('schemas/v2/matrix-result.schema.json')
    const errorV2Schema = await readSchema('schemas/v2/error-receipt.schema.json')
    const contractV2Schema = await readSchema('schemas/v2/cli-contract.schema.json')
    const manifestV2Schema = await readSchema('schemas/v2/artifact-manifest.schema.json')
    for (const schema of [
      settingsSchema,
      effectiveSettingsSchema,
      inspectSchema,
      generateSchema,
      resultSchema,
      errorSchema,
      settingsV2Schema,
      effectiveSettingsV2Schema,
      noticeV2Schema,
      inspectV2Schema,
      generateV2Schema,
      resultV2Schema,
      errorV2Schema,
      contractV2Schema,
      manifestV2Schema,
    ]) {
      ajv.addSchema(schema)
    }
    const validateSettings = ajv.getSchema('urn:bubble-matrix-map:schema:matrix-settings:1')!
    const validateEffectiveSettings = ajv.getSchema('urn:bubble-matrix-map:schema:matrix-settings-effective:1')!
    const validateError = ajv.getSchema('urn:bubble-matrix-map:schema:error-receipt:1')!
    const validateSettingsV2 = ajv.getSchema('urn:bubble-matrix-map:schema:matrix-settings:2')!
    const validateEffectiveSettingsV2 = ajv.getSchema('urn:bubble-matrix-map:schema:matrix-settings-effective:2')!
    const validateInspectV2 = ajv.getSchema('urn:bubble-matrix-map:schema:inspect-receipt:2')!
    const validateGenerateV2 = ajv.getSchema('urn:bubble-matrix-map:schema:generate-receipt:2')!
    const validateResultV2 = ajv.getSchema('urn:bubble-matrix-map:schema:matrix-result:2')!
    const validateErrorV2 = ajv.getSchema('urn:bubble-matrix-map:schema:error-receipt:2')!
    const validateContractV2 = ajv.getSchema('urn:bubble-matrix-map:schema:cli-contract:2')!
    const validateManifestV2 = ajv.getSchema('urn:bubble-matrix-map:schema:artifact-manifest:2')!

    const legacyExample = (await readJson('examples/matrix-config.example.json')) as Record<string, unknown>
    expect(validateSettings(legacyExample), JSON.stringify(validateSettings.errors)).toBe(true)
    expect(validateEffectiveSettings(legacyExample)).toBe(false)
    expect(validateSettingsV2(legacyExample), JSON.stringify(validateSettingsV2.errors)).toBe(true)
    expect(
      validateSettingsV2(await readJson('examples/matrix-config.v2.example.json')),
      JSON.stringify(validateSettingsV2.errors),
    ).toBe(true)
    const effectiveV2 = {
      ...legacyExample,
      xLimit: 8,
      yLimit: 8,
      pieTopN: 5,
      recentYears: 5,
      showCounts: false,
      columnSliceStrategy: 'top_n_with_other',
      periodStart: '',
      periodEnd: '',
      yearBucketMode: 'recent_vs_other',
      periodBoundaries: '2012, 2016, 2020',
      includeAxisOther: false,
      classificationSplitMode: 'all',
      xClassificationLevel: 'full',
      yClassificationLevel: 'full',
      pieClassificationLevel: 'full',
    }
    expect(validateEffectiveSettingsV2(effectiveV2), JSON.stringify(validateEffectiveSettingsV2.errors)).toBe(true)
    expect(validateSettingsV2({ xLimit: 8, showCounts: true })).toBe(true)
    expect(validateSettingsV2({ xLimit: 2.5 })).toBe(false)
    expect(validateSettingsV2({ xLimit: '8.0' })).toBe(false)

    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-schema-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    const output = join(directory, 'map.svg')
    const result = join(directory, 'matrix.json')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')

    const inspectReceipt = await inspectInput({ command: 'inspect', input, includeSamples: false })
    const generateReceipt = await generateOutput({
      command: 'generate',
      input,
      output,
      result,
      outputRoot: directory,
      force: false,
    })
    const resultDocument = await readJson(result)
    const manifestDocument = await readJson(join(directory, 'map.manifest.json'))
    const legacyErrorReceipt = { schemaVersion: 1, ok: false, code: 'UNKNOWN_COMMAND', message: 'unknown command' }
    const errorReceipt = toErrorReceipt(new CliError('UNKNOWN_COMMAND', 'unknown command'))
    const contractReceipt = buildCliContract()

    expect(validateError(legacyErrorReceipt), JSON.stringify(validateError.errors)).toBe(true)
    expect(validateInspectV2(inspectReceipt), JSON.stringify(validateInspectV2.errors)).toBe(true)
    expect(validateEffectiveSettingsV2(inspectReceipt.defaultSettings), JSON.stringify(validateEffectiveSettingsV2.errors)).toBe(true)
    expect(validateGenerateV2(generateReceipt), JSON.stringify(validateGenerateV2.errors)).toBe(true)
    expect(validateResultV2(resultDocument), JSON.stringify(validateResultV2.errors)).toBe(true)
    expect(validateErrorV2(errorReceipt), JSON.stringify(validateErrorV2.errors)).toBe(true)
    expect(validateContractV2(contractReceipt), JSON.stringify(validateContractV2.errors)).toBe(true)
    expect(validateManifestV2(manifestDocument), JSON.stringify(validateManifestV2.errors)).toBe(true)
    expect(
      validateManifestV2({ ...(manifestDocument as object), renderContractVersion: 1 }),
      JSON.stringify(validateManifestV2.errors),
    ).toBe(true)
    const manifest = manifestDocument as {
      files: Array<{ role: string; path: string; sha256: string; bytes: number }>
    }
    const svgFile = manifest.files.find((file) => file.role === 'svg')!
    expect(validateManifestV2({ ...(manifestDocument as object), files: [{ ...svgFile, role: 'result' }] })).toBe(false)
    expect(validateManifestV2({ ...(manifestDocument as object), files: [svgFile, { ...svgFile, path: 'other.svg' }] })).toBe(
      false,
    )
    for (const path of ['./map.svg', 'nested/./map.svg', 'nested//map.svg', 'nested/']) {
      expect(validateManifestV2({ ...(manifestDocument as object), files: [{ ...svgFile, path }] })).toBe(false)
    }
  })

  it('keeps the public error code enum synchronized with the CLI', async () => {
    const errorSchema = (await readSchema('schemas/v2/error-receipt.schema.json')) as {
      properties?: { code?: { enum?: unknown[] }; reason?: { enum?: unknown[] } }
    }
    expect(errorSchema.properties?.code?.enum).toEqual([...CLI_ERROR_CODES])
    expect(errorSchema.properties?.reason?.enum).toEqual([...CLI_ERROR_REASONS])
  })

  it('keeps notice codes synchronized and every contract schema resolvable', async () => {
    const noticeSchema = (await readSchema('schemas/v2/notice.schema.json')) as {
      properties?: { code?: { enum?: unknown[] } }
    }
    expect(noticeSchema.properties?.code?.enum).toEqual([...NOTICE_CODES])

    const contract = buildCliContract() as {
      schemas: Array<{ path: string; uri: string; dependsOn: string[] }>
    }
    for (const schemaDescriptor of contract.schemas) {
      const schema = (await readSchema(schemaDescriptor.path)) as { $id?: string }
      expect(schema.$id).toBe(schemaDescriptor.uri)
      for (const dependency of schemaDescriptor.dependsOn) {
        expect(contract.schemas.some((candidate) => candidate.uri === dependency)).toBe(true)
      }
    }
  })

  it('keeps every root version 1 schema byte-for-byte unchanged', async () => {
    expect(await sha256('schemas/error-receipt.schema.json')).toBe(
      'd9cbd723fa3fab2a69ba309fddf2bad8372dcbbcae59a9bb2217e0a7109dc335',
    )
    expect(await sha256('schemas/generate-receipt.schema.json')).toBe(
      'c347db5cdfa4c0715db271c4b172ab3f808c9e5aea71f33950446ab9178a1610',
    )
    expect(await sha256('schemas/inspect-receipt.schema.json')).toBe(
      'f9a9597499ceb585d543f8c4b07a7024efc600532a6984c9e44337180f280700',
    )
    expect(await sha256('schemas/matrix-result.schema.json')).toBe(
      '71626229c04ffd0f9af49f1bac7bd09f49023eb09766c8ac7bbf42002c4912a6',
    )
    expect(await sha256('schemas/matrix-settings.schema.json')).toBe(
      '9e011877931f6db7c8d716b69719aaaf3d29a1c0c4417d65123e84ee3180acc8',
    )
    expect(await sha256('schemas/matrix-settings-effective.schema.json')).toBe(
      'd11898cb4d573ec6538f66a8afa8c2e7276ac3bd494b22a079fa57ad72794522',
    )
  })
})
