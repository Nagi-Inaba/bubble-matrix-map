import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const cliPath = resolve('bin/bubble-matrix-map.mjs')
const temporaryDirectories: string[] = []

type ProcessResult = {
  code: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[], stdin = ''): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolveResult({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

function runDocumentedNpmCli(args: string[]): Promise<ProcessResult> {
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [npmCli, 'run', '--silent', 'cli', '--', ...args], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolveResult({ code, stdout, stderr }))
  })
}

function runNpm(args: string[]): Promise<ProcessResult> {
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolveResult({ code, stdout, stderr }))
  })
}

function parseSingleJsonLine(output: string): Record<string, unknown> {
  const lines = output.trimEnd().split(/\r?\n/)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0]) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('CLI process contract', () => {
  it('keeps the documented npm invocation to one JSON line', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年\nG01N,A社,2024\n', 'utf8')

    const result = await runDocumentedNpmCli(['inspect', '--input', input])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({ schemaVersion: 2, ok: true, command: 'inspect' })
  })

  it('keeps the documented pack preview parseable as one JSON document', async () => {
    const result = await runNpm(['pack', '--dry-run', '--silent', '--json'])
    const report = JSON.parse(result.stdout) as Array<{ filename?: string }>
    const packageDocument = JSON.parse(await readFile('package.json', 'utf8')) as { name: string; version: string }

    expect(result.code).toBe(0)
    expect(report).toHaveLength(1)
    expect(report[0]?.filename).toBe(`${packageDocument.name}-${packageDocument.version}.tgz`)
  })

  it('executes the documented PowerShell pack pipeline unchanged on Windows', async () => {
    if (process.platform !== 'win32') return
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const result = await new Promise<ProcessResult>((resolveResult, reject) => {
      const child = spawn(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference='Stop'; $pack = npm pack --dry-run --silent --json | ConvertFrom-Json; $pack.filename",
        ],
        { windowsHide: true },
      )
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => resolveResult({ code, stdout, stderr }))
    })
    const packageDocument = JSON.parse(await readFile('package.json', 'utf8')) as { name: string; version: string }

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(`${packageDocument.name}-${packageDocument.version}.tgz`)
  })

  it('passes Japanese stdin config as UTF-8 from Windows PowerShell 5.1', async () => {
    if (process.platform !== 'win32') return
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-powershell-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const quote = (value: string): string => value.replaceAll("'", "''")
    const command = [
      '$utf8NoBom = New-Object System.Text.UTF8Encoding($false)',
      '[Console]::OutputEncoding = $utf8NoBom',
      '$OutputEncoding = $utf8NoBom',
      `'{"xAxis":"IPC","yAxis":"出願人","showCounts":false}' | & '${quote(process.execPath)}' '${quote(cliPath)}' generate --input '${quote(input)}' --output-root '${quote(directory)}' --output 'powershell-map.svg' --config -`,
    ].join('; ')
    const result = await new Promise<ProcessResult>((resolveResult, reject) => {
      const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => resolveResult({ code, stdout, stderr }))
    })

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({ schemaVersion: 2, ok: true, config: 'stdin' })
  })

  it('emits one metadata-only JSON line for inspect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年\nG01N,A社,2024\n', 'utf8')

    const result = await runCli(['inspect', '--input', input])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const receipt = parseSingleJsonLine(result.stdout)
    expect(receipt).toMatchObject({ schemaVersion: 2, ok: true, command: 'inspect', rowCount: 1 })
    expect(receipt.input).toBe('input.csv')
    expect(JSON.stringify(receipt)).not.toContain(directory)
    expect(JSON.stringify(receipt)).not.toContain('A社')
  })

  it('reports its packaged version and exposes absolute paths only by explicit request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年\nG01N,A社,2024\n', 'utf8')

    const version = await runCli(['--version'])
    const expectedVersion = (await readFile('VERSION', 'utf8')).trim()
    const disclosed = await runCli(['inspect', '--input', input, '--include-paths'])

    expect(version).toMatchObject({ code: 0, stderr: '' })
    expect(version.stdout.trim()).toBe(expectedVersion)
    expect(parseSingleJsonLine(disclosed.stdout).input).toBe(input)
  })

  it('provides complete top-level and subcommand help without emitting errors', async () => {
    const top = await runCli(['--help'])
    const inspect = await runCli(['inspect', '--help'])
    const inspectAlias = await runCli(['help', 'inspect'])
    const generate = await runCli(['generate', '--help'])
    const generateAlias = await runCli(['help', 'generate'])

    for (const result of [top, inspect, inspectAlias, generate, generateAlias]) {
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
    }
    expect(top.stdout).toContain('Bubble Matrix Map CLI')
    expect(inspect.stdout).toBe(inspectAlias.stdout)
    expect(inspect.stdout).toContain('必須引数')
    expect(inspect.stdout).toContain('--include-samples')
    expect(inspect.stdout).toContain('取り扱いに注意が必要なオプション')
    expect(inspect.stdout).toContain('終了コード')
    expect(inspect.stdout).toContain('例')
    expect(generate.stdout).toBe(generateAlias.stdout)
    expect(generate.stdout).toContain('必須引数')
    expect(generate.stdout).toContain('--force')
    expect(generate.stdout).toContain('取り扱いに注意が必要なオプション')
    expect(generate.stdout).toContain('終了コード')
    expect(generate.stdout).toContain('例')
  })

  it('publishes one machine-readable contract line', async () => {
    const result = await runCli(['contract', '--json'])
    const contract = parseSingleJsonLine(result.stdout)

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(contract).toMatchObject({
      schemaVersion: 2,
      ok: true,
      command: 'contract',
      capabilities: { contractDiscovery: true, stdinConfig: true, artifactIdentity: true, idempotentReuse: true },
    })
    const commands = contract.commands as Array<{ name: string; arguments: Array<{ name: string; description: string }> }>
    expect(commands.find((command) => command.name === 'generate')?.arguments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '--config', description: '設定JSONのパスです。「-」は標準入力を表します。' }),
      ]),
    )
  })

  it('emits one JSON error line and exit code 2 for an unknown command', async () => {
    const result = await runCli(['unknown-command'])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(parseSingleJsonLine(result.stderr)).toMatchObject({
      schemaVersion: 2,
      ok: false,
      code: 'UNKNOWN_COMMAND',
      retryable: false,
    })
  })

  it('keeps unknown subcommand options as one structured error receipt', async () => {
    const result = await runCli(['inspect', '--wat'])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(parseSingleJsonLine(result.stderr)).toMatchObject({
      schemaVersion: 2,
      ok: false,
      code: 'UNKNOWN_ARGUMENT',
      retryable: false,
    })
  })

  it('does not reflect unknown command or argument values in error receipts', async () => {
    const privateValue = 'C:\\Users\\private-user\\secret-config.json'
    const cases = [
      [privateValue],
      ['help', privateValue],
      ['help', 'inspect', privateValue],
      ['inspect', privateValue],
      ['contract', privateValue],
      ['contract', '--json', privateValue],
    ]

    for (const args of cases) {
      const result = await runCli(args)
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(parseSingleJsonLine(result.stderr)).toMatchObject({ schemaVersion: 2, ok: false, retryable: false })
      expect(result.stderr).not.toContain(privateValue)
      expect(result.stderr).not.toContain('private-user')
    }
  })

  it('does not expose an absolute output root in write errors by default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    const invalidOutputRoot = join(directory, 'not-a-directory')
    await writeFile(input, 'IPC,出願人,出願年\nG01N,A社,2024\n', 'utf8')
    await writeFile(invalidOutputRoot, 'file', 'utf8')

    const result = await runCli([
      'generate',
      '--input',
      input,
      '--output-root',
      invalidOutputRoot,
      '--output',
      'map.svg',
    ])

    expect(result.code).toBe(4)
    expect(result.stdout).toBe('')
    expect(parseSingleJsonLine(result.stderr)).toMatchObject({ code: 'OUTPUT_ERROR', ok: false })
    expect(result.stderr).not.toContain(directory)
    expect(result.stderr).not.toContain(invalidOutputRoot)
  })

  it('creates, reuses, detects conflicts, and explicitly replaces one artifact set', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    const output = join(directory, 'map.svg')
    const matrixResult = join(directory, 'matrix.json')
    const manifestPath = join(directory, 'map.manifest.json')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\nG01N,A社,2023,評価\n', 'utf8')

    const first = await runCli([
      'generate',
      '--input',
      input,
      '--output-root',
      directory,
      '--output',
      'map.svg',
      '--result',
      'matrix.json',
    ])

    expect(first.code).toBe(0)
    expect(first.stderr).toBe('')
    const firstReceipt = parseSingleJsonLine(first.stdout)
    expect(firstReceipt).toMatchObject({
      schemaVersion: 2,
      ok: true,
      command: 'generate',
      disposition: 'created',
      manifest: 'map.manifest.json',
    })
    expect(firstReceipt.artifactId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(await readFile(output, 'utf8')).toContain('<svg')
    const resultDocument = JSON.parse(await readFile(matrixResult, 'utf8')) as {
      artifactId: string
      source: { input: string }
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      artifactId: string
      files: Array<{ path: string }>
    }
    expect(resultDocument).toMatchObject({ schemaVersion: 2, artifactId: firstReceipt.artifactId })
    expect(resultDocument.source.input).toBe('input.csv')
    expect(JSON.stringify(resultDocument)).not.toContain(directory)
    expect(manifest).toMatchObject({
      artifactId: firstReceipt.artifactId,
      files: [{ path: 'map.svg' }, { path: 'matrix.json' }],
    })
    expect(JSON.stringify(manifest)).not.toContain(directory)

    const svgBeforeReuse = await readFile(output, 'utf8')
    const second = await runCli([
      'generate',
      '--input',
      input,
      '--output-root',
      directory,
      '--output',
      'map.svg',
      '--result',
      'matrix.json',
    ])

    expect(second).toMatchObject({ code: 0, stderr: '' })
    expect(parseSingleJsonLine(second.stdout)).toMatchObject({
      artifactId: firstReceipt.artifactId,
      disposition: 'reused',
    })
    expect(await readFile(output, 'utf8')).toBe(svgBeforeReuse)

    await writeFile(output, '<svg>tampered</svg>', 'utf8')
    const conflicted = await runCli([
      'generate',
      '--input',
      input,
      '--output-root',
      directory,
      '--output',
      'map.svg',
      '--result',
      'matrix.json',
    ])
    expect(conflicted).toMatchObject({ code: 4, stdout: '' })
    expect(parseSingleJsonLine(conflicted.stderr)).toMatchObject({
      code: 'ARTIFACT_CONFLICT',
      reason: 'digest_mismatch',
      retryable: false,
    })

    const replaced = await runCli([
      'generate',
      '--input',
      input,
      '--output-root',
      directory,
      '--output',
      'map.svg',
      '--result',
      'matrix.json',
      '--force',
    ])
    expect(replaced).toMatchObject({ code: 0, stderr: '' })
    expect(parseSingleJsonLine(replaced.stdout)).toMatchObject({
      artifactId: firstReceipt.artifactId,
      disposition: 'replaced',
    })
    expect(await readFile(output, 'utf8')).not.toContain('tampered')
  })

  it('reads config from stdin and reports stdin without reflecting its JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')
    const config = JSON.stringify({ xAxis: 'IPC', yAxis: '出願人', pieColumn: '用途', showCounts: true })

    const result = await runCli(
      ['generate', '--input', input, '--output-root', directory, '--output', 'stdin-map.svg', '--config', '-'],
      config,
    )

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({ schemaVersion: 2, config: 'stdin', ok: true })
    expect(result.stdout).not.toContain(config)
  })

  it('does not reflect invalid stdin configuration content in an error receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    const secretMarker = 'private-stdin-setting-name'
    await writeFile(input, 'IPC,出願人,出願年,用途\nG01N,A社,2024,検査\n', 'utf8')

    const result = await runCli(
      ['generate', '--input', input, '--output-root', directory, '--output', 'map.svg', '--config', '-'],
      JSON.stringify({ [secretMarker]: true }),
    )

    expect(result).toMatchObject({ code: 2, stdout: '' })
    expect(parseSingleJsonLine(result.stderr)).toMatchObject({
      schemaVersion: 2,
      code: 'UNKNOWN_CONFIG_KEY',
      field: 'settings',
      retryable: false,
    })
    expect(result.stderr).not.toContain(secretMarker)
    expect(result.stderr).not.toContain(directory)
  })

  it('emits a stable label-limit error and commits no output artifacts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-process-'))
    temporaryDirectories.push(directory)
    const input = join(directory, 'input.csv')
    const config = join(directory, 'config.json')
    const output = join(directory, 'map.svg')
    const matrixResult = join(directory, 'matrix.json')
    const oversizedCategory = '秘'.repeat(121)
    await writeFile(input, `X,Y,Year,Kind\n${oversizedCategory},企業,2024,分類\n`, 'utf8')
    await writeFile(
      config,
      JSON.stringify({ xAxis: 'X', yAxis: 'Y', yearColumn: 'Year', pieColumn: 'Kind' }),
      'utf8',
    )

    const result = await runCli([
      'generate',
      '--input',
      input,
      '--config',
      config,
      '--output-root',
      directory,
      '--output',
      'map.svg',
      '--result',
      'matrix.json',
    ])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(parseSingleJsonLine(result.stderr)).toMatchObject({ code: 'LABEL_TOO_LONG', ok: false })
    expect(result.stderr).not.toContain(oversizedCategory)
    await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(matrixResult)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
