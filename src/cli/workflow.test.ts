import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { generateOutput, inspectInput } from './workflow'
import { parseSvg } from './svgVisualTestSupport'
import { CLI_VERSION } from './version'

const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'matrix-map-cli-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('CLI workflow', () => {
  it('inspects a CSV and exposes inferred settings for automation', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\nG01N,B社,2023,評価\n', 'utf8')

    const receipt = await inspectInput({ command: 'inspect', input, includeSamples: false })

    expect(receipt).toMatchObject({ schemaVersion: 2, ok: true, command: 'inspect', rowCount: 2 })
    expect(receipt.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'IPC' }), expect.objectContaining({ name: '出願人' })]),
    )
    expect(receipt.columns).not.toEqual(expect.arrayContaining([expect.objectContaining({ samples: expect.anything() })]))
    expect(receipt.defaultSettings).toMatchObject({
      xAxis: 'IPC',
      yAxis: '出願人',
      yearColumn: '出願年',
      pieColumn: '用途',
      xLimit: 8,
      showCounts: false,
    })
  })

  it('returns cell samples only with explicit consent', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,要約\nG01N,機密になり得る本文\n', 'utf8')

    const receipt = await inspectInput({ command: 'inspect', input, includeSamples: true })

    expect(receipt.columns).toEqual(expect.arrayContaining([expect.objectContaining({ name: '要約', samples: ['機密になり得る本文'] })]))
  })

  it('keeps the bundled demo recommendation aligned with both config examples', async () => {
    const input = join(process.cwd(), 'examples', 'cli-demo.csv')
    const v1Config = JSON.parse(await readFile(join(process.cwd(), 'examples', 'matrix-config.example.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const v2Config = JSON.parse(
      await readFile(join(process.cwd(), 'examples', 'matrix-config.v2.example.json'), 'utf8'),
    ) as Record<string, unknown>
    const receipt = await inspectInput({ command: 'inspect', input, includeSamples: false })
    const recommended = receipt.defaultSettings as Record<string, unknown>

    for (const key of ['xAxis', 'yAxis', 'yearColumn', 'pieColumn']) {
      expect(recommended[key]).toBe(v1Config[key])
      expect(recommended[key]).toBe(v2Config[key])
    }
    expect(recommended).toMatchObject({ xAxis: 'IPC', yAxis: '出願人', yearColumn: '出願年', pieColumn: '用途' })
  })

  it('inspects an Excel workbook through the CLI file path', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.xlsx')
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('data')
    worksheet.addRow(['IPC', '出願人', '出願年', '用途'])
    worksheet.addRow(['G01N', 'A社', 2024, '検査'])
    await workbook.xlsx.writeFile(input)

    const receipt = await inspectInput({ command: 'inspect', input, includeSamples: false })

    expect(receipt).toMatchObject({
      schemaVersion: 2,
      ok: true,
      rowCount: 1,
      sourceInfo: { format: 'Excel' },
    })
  })

  it('keeps outputs inside the declared output root', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const outputRoot = join(directory, 'artifacts')
    await writeFile(input, 'IPC,出願人\nG01N,A社\n', 'utf8')

    await expect(
      generateOutput({
        command: 'generate',
        input,
        output: join(directory, 'outside.svg'),
        outputRoot,
        force: false,
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_OUTSIDE_ROOT', exitCode: 4 })
  })

  it('classifies an unusable output root as an output error', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const outputRoot = join(directory, 'not-a-directory.json')
    await writeFile(input, 'IPC,出願人\nG01N,A社\n', 'utf8')
    await writeFile(outputRoot, '{}', 'utf8')

    await expect(
      generateOutput({ command: 'generate', input, output: 'map.svg', outputRoot, force: false }),
    ).rejects.toMatchObject({ code: 'OUTPUT_ERROR', exitCode: 4 })
  })

  it('rejects a symbolic-link or junction inside the output path', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const outputRoot = join(directory, 'artifacts')
    const outside = join(directory, 'outside')
    const linkedDirectory = join(outputRoot, 'linked')
    await Promise.all([mkdir(outputRoot), mkdir(outside)])
    await symlink(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(input, 'IPC,出願人\nG01N,A社\n', 'utf8')

    await expect(
      generateOutput({ command: 'generate', input, output: 'linked/map.svg', outputRoot, force: false }),
    ).rejects.toMatchObject({ code: 'UNSAFE_OUTPUT_TARGET', exitCode: 4 })
    await expect(access(join(outside, 'map.svg'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a symbolic-link or junction used as the output root', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const realOutputRoot = join(directory, 'real-artifacts')
    const linkedOutputRoot = join(directory, 'linked-artifacts')
    await mkdir(realOutputRoot)
    await symlink(realOutputRoot, linkedOutputRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(input, 'IPC,出願人\nG01N,A社\n', 'utf8')

    await expect(
      generateOutput({ command: 'generate', input, output: 'map.svg', outputRoot: linkedOutputRoot, force: false }),
    ).rejects.toMatchObject({ code: 'UNSAFE_OUTPUT_TARGET', exitCode: 4 })
    await expect(access(join(realOutputRoot, 'map.svg'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('generates SVG and result JSON from the shared parser and aggregation logic', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const config = join(directory, 'config.json')
    const output = join(directory, 'out', 'map.svg')
    const result = join(directory, 'out', 'matrix.json')
    const manifestPath = join(directory, 'out', 'map.manifest.json')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\nG01N,A社,2023,評価\n', 'utf8')
    await writeFile(
      config,
      JSON.stringify({
        xAxis: 'IPC',
        yAxis: '出願人',
        yearColumn: '出願年',
        pieColumn: '用途',
        xLimit: 8,
        showCounts: true,
      }),
      'utf8',
    )

    const receipt = await generateOutput({ command: 'generate', input, output, config, result, outputRoot: directory, force: false })
    const svg = await readFile(output, 'utf8')
    const matrixDocument = JSON.parse(await readFile(result, 'utf8')) as {
      schemaVersion: number
      artifactId: string
      settings: Record<string, unknown>
      matrix: { totalRows: number; includedRows: number; cells: Array<{ rowCount: number }> }
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      schemaVersion: number
      artifactId: string
      files: Array<{ role: string; path: string; sha256: string; bytes: number }>
    }

    expect(receipt).toMatchObject({
      schemaVersion: 2,
      ok: true,
      command: 'generate',
      totalRows: 2,
      includedRows: 2,
      cells: 1,
      disposition: 'created',
      manifest: 'out/map.manifest.json',
    })
    expect(receipt.artifactId).toMatch(/^sha256:[a-f0-9]{64}$/)
    const parsedSvg = parseSvg(svg)
    expect(parsedSvg.document.documentElement!.getAttribute('role')).toBe('img')
    expect(svg).toContain('input.csvのバブルマトリクスマップ')
    expect(svg).toContain('X軸：IPC')
    expect(svg).toContain('Y軸：出願人')
    expect(svg).toContain(`CLI v${CLI_VERSION}`)
    expect(svg).toContain(String(receipt.artifactId))
    expect(svg).toContain('&quot;countDisplay&quot;:&quot;shown&quot;')
    expect(svg).toContain('fill="#372f28"')
    expect(svg).not.toContain(directory)
    expect(receipt).toMatchObject({ width: parsedSvg.width, height: parsedSvg.height })
    expect(matrixDocument).toMatchObject({
      schemaVersion: 2,
      artifactId: receipt.artifactId,
      matrix: { totalRows: 2, includedRows: 2 },
    })
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      artifactId: receipt.artifactId,
      files: [
        { role: 'svg', path: 'out/map.svg', sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: expect.any(Number) },
        {
          role: 'result',
          path: 'out/matrix.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          bytes: expect.any(Number),
        },
      ],
    })
    expect(JSON.stringify(manifest)).not.toContain(directory)
    expect(matrixDocument.settings).toMatchObject({ xLimit: 8, showCounts: true })
    expect(matrixDocument.matrix.cells[0]?.rowCount).toBe(2)

    const hiddenOutput = join(directory, 'out', 'map-hidden.svg')
    await generateOutput({ command: 'generate', input, output: hiddenOutput, outputRoot: directory, force: false })
    const hiddenSvg = await readFile(hiddenOutput, 'utf8')
    expect(hiddenSvg).toContain('&quot;countDisplay&quot;:&quot;hidden&quot;')
    expect(hiddenSvg).not.toContain('fill="#372f28"')

    const preservedTime = new Date('2000-01-01T00:00:00.000Z')
    await utimes(output, preservedTime, preservedTime)
    const svgBeforeReuse = await readFile(output, 'utf8')
    const reused = await generateOutput({ command: 'generate', input, output, config, result, outputRoot: directory, force: false })
    expect(reused).toMatchObject({ artifactId: receipt.artifactId, disposition: 'reused' })
    expect(await readFile(output, 'utf8')).toBe(svgBeforeReuse)
    expect((await stat(output)).mtimeMs).toBe(preservedTime.getTime())

    await writeFile(
      config,
      JSON.stringify({ xAxis: 'IPC', yAxis: '出願人', yearColumn: '出願年', pieColumn: '用途', showCounts: false }),
      'utf8',
    )
    await expect(
      generateOutput({ command: 'generate', input, output, config, result, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONFLICT', exitCode: 4, reason: 'artifact_id_mismatch' })
    expect(await readFile(output, 'utf8')).toBe(svgBeforeReuse)

    const replaced = await generateOutput({ command: 'generate', input, output, config, result, outputRoot: directory, force: true })
    expect(replaced).toMatchObject({ disposition: 'replaced' })
    expect(replaced.artifactId).not.toBe(receipt.artifactId)
  })

  it('rejects tampered artifacts and reports a busy output root without modifying files', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const output = join(directory, 'map.svg')
    const manifest = join(directory, 'map.manifest.json')
    const lock = join(directory, '.bubble-matrix-map.lock')
    await writeFile(input, 'IPC,出願人\nG01N,A社\n', 'utf8')

    const created = await generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false })
    const renderContractTamperedManifest = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>
    renderContractTamperedManifest.renderContractVersion = 1
    await writeFile(manifest, `${JSON.stringify(renderContractTamperedManifest, null, 2)}\n`, 'utf8')
    await expect(
      generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONFLICT', reason: 'manifest_invalid' })
    await generateOutput({ command: 'generate', input, output, outputRoot: directory, force: true })

    const versionTamperedManifest = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>
    versionTamperedManifest.cliVersion = '999.0.0'
    await writeFile(manifest, `${JSON.stringify(versionTamperedManifest, null, 2)}\n`, 'utf8')
    await expect(
      generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONFLICT', reason: 'manifest_invalid' })
    await generateOutput({ command: 'generate', input, output, outputRoot: directory, force: true })

    await writeFile(output, '<svg>tampered</svg>', 'utf8')
    await expect(
      generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONFLICT', reason: 'digest_mismatch', retryable: false })

    const replaced = await generateOutput({ command: 'generate', input, output, outputRoot: directory, force: true })
    expect(replaced).toMatchObject({ artifactId: created.artifactId, disposition: 'replaced' })
    expect(await readFile(output, 'utf8')).not.toContain('tampered')

    await rm(manifest)
    await expect(
      generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONFLICT', reason: 'manifest_missing' })
    await generateOutput({ command: 'generate', input, output, outputRoot: directory, force: true })

    await writeFile(manifest, '{"schemaVersion":2,"unexpected":true}\n', 'utf8')
    await expect(
      generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONFLICT', reason: 'manifest_invalid' })
    await generateOutput({ command: 'generate', input, output, outputRoot: directory, force: true })

    await rm(output)
    await expect(
      generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONFLICT', reason: 'artifact_missing' })
    await generateOutput({ command: 'generate', input, output, outputRoot: directory, force: true })

    await writeFile(lock, '{"pid":123}\n', 'utf8')
    const svgBeforeBusy = await readFile(output, 'utf8')
    const manifestBeforeBusy = await readFile(manifest, 'utf8')
    await expect(
      generateOutput({ command: 'generate', input, output, outputRoot: directory, force: false }),
    ).rejects.toMatchObject({ code: 'OUTPUT_BUSY', reason: 'output_busy', retryable: true })
    expect(await readFile(output, 'utf8')).toBe(svgBeforeBusy)
    expect(await readFile(manifest, 'utf8')).toBe(manifestBeforeBusy)
  })

  it('accepts a UTF-8 BOM at the start of a settings file', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const config = join(directory, 'config.json')
    const output = join(directory, 'map.svg')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')
    await writeFile(config, `\uFEFF${JSON.stringify({ xAxis: 'IPC', yAxis: '出願人', pieColumn: '用途' })}`, 'utf8')

    await expect(
      generateOutput({ command: 'generate', input, output, config, outputRoot: directory, force: false }),
    ).resolves.toMatchObject({ schemaVersion: 2, ok: true, command: 'generate' })
  })

  it('accepts a bounded UTF-8 JSON config with BOM from stdin', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const output = join(directory, 'map.svg')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')
    const stdin = Readable.from([`\uFEFF${JSON.stringify({ xAxis: 'IPC', yAxis: '出願人', pieColumn: '用途', showCounts: true })}`])

    await expect(
      generateOutput({ command: 'generate', input, output, config: '-', outputRoot: directory, force: false }, stdin),
    ).resolves.toMatchObject({ schemaVersion: 2, ok: true, config: 'stdin' })
  })

  it.each([
    ['', 'stdin_empty'],
    ['   \n', 'stdin_empty'],
    ['{"xAxis":', 'stdin_invalid_json'],
    [`{"xAxis":"${'x'.repeat(1_048_576)}"}`, 'stdin_too_large'],
  ])('classifies invalid stdin config without exposing content', async (content, reason) => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')

    await expect(
      generateOutput(
        { command: 'generate', input, output: 'map.svg', config: '-', outputRoot: directory, force: false },
        Readable.from([content]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG', reason })
  })

  it('classifies an interrupted stdin stream as retryable without exposing the stream error', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')
    async function* interrupted(): AsyncGenerator<string> {
      yield '{"showCounts":'
      throw new Error('private-stream-detail')
    }

    try {
      await generateOutput(
        { command: 'generate', input, output: 'map.svg', config: '-', outputRoot: directory, force: false },
        interrupted(),
      )
      expect.fail('stdin stream error should reject')
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_CONFIG', reason: 'stdin_read_error', retryable: true })
      expect(String((error as Error).message)).not.toContain('private-stream-detail')
    }
  })

  it('produces the same SVG from equivalent file and stdin settings', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const configPath = join(directory, 'config.json')
    const fileOutput = join(directory, 'file.svg')
    const stdinOutput = join(directory, 'stdin.svg')
    const config = JSON.stringify({ xAxis: 'IPC', yAxis: '出願人', pieColumn: '用途', showCounts: true })
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')
    await writeFile(configPath, config, 'utf8')

    await generateOutput({
      command: 'generate',
      input,
      output: fileOutput,
      config: configPath,
      outputRoot: directory,
      force: false,
    })
    await generateOutput(
      { command: 'generate', input, output: stdinOutput, config: '-', outputRoot: directory, force: false },
      Readable.from([config]),
    )

    expect(await readFile(stdinOutput, 'utf8')).toBe(await readFile(fileOutput, 'utf8'))
  })

  it('describes the actual year-bucket labels instead of a period filter', async () => {
    const directory = await makeTemporaryDirectory()
    const input = join(directory, 'input.csv')
    const config = join(directory, 'config.json')
    const output = join(directory, 'map.svg')
    await writeFile(
      input,
      'IPC,出願人,出願年\nG01N,A社,2022\nG01N,A社,2023\nG01N,A社,2024\n',
      'utf8',
    )
    await writeFile(
      config,
      JSON.stringify({
        xAxis: 'IPC',
        yAxis: '出願人',
        yearColumn: '出願年',
        pieSourceMode: 'year_bucket',
        yearBucketMode: 'recent_vs_other',
        recentYears: '2',
      }),
      'utf8',
    )

    await generateOutput({ command: 'generate', input, output, config, outputRoot: directory, force: false })
    const svg = await readFile(output, 'utf8')

    expect(svg).toContain('年分類：直近2年（2023〜2024）、それ以前')
    expect(svg).not.toContain('集計期間：全期間')
  })
})
