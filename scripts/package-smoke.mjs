import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import ExcelJS from 'exceljs'
import Ajv2020 from 'ajv/dist/2020.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const npmCli = process.env.npm_execpath ?? join(resolve(process.execPath, '..'), 'node_modules', 'npm', 'bin', 'npm-cli.js')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function runNpm(args, cwd) {
  return execFileAsync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  })
}

function runWithInput(command, args, options, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolveResult({ stdout, stderr })
      else reject(Object.assign(new Error(`process exited with code ${code}`), { code, stdout, stderr }))
    })
    child.stdin.end(input)
  })
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-pack-'))
  try {
    const packageDirectory = join(temporaryRoot, 'package')
    const installDirectory = join(temporaryRoot, 'install')
    await Promise.all([
      mkdir(packageDirectory, { recursive: true }),
      mkdir(installDirectory, { recursive: true }),
    ])

    const packed = await runNpm(
      ['pack', '--silent', '--json', '--pack-destination', packageDirectory],
      repositoryRoot,
    )
    const report = JSON.parse(packed.stdout)
    const pack = report[0]
    assert(pack?.filename, 'npm packのファイル名を取得できませんでした。')
    const packedPaths = pack.files.map((file) => file.path)
    const expectedPaths = [
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'LICENSE',
      'NOTICE',
      'README.md',
      'SECURITY.md',
      'SUPPORT.md',
      'THIRD_PARTY_NOTICES',
      'VERSION',
      'bin/bubble-matrix-map.mjs',
      'dist-cli/bubble-matrix-map.mjs',
      'docs/ai-integration.md',
      'docs/cli.md',
      'docs/security-model.md',
      'examples/cli-demo.csv',
      'examples/matrix-config.example.json',
      'examples/matrix-config.v2.example.json',
      'package.json',
      'licenses/LICENSE-d3',
      'licenses/LICENSE-echarts',
      'licenses/LICENSE-exceljs',
      'licenses/LICENSE-saxes',
      'licenses/NOTICE-echarts',
      'licenses/BUNDLED_NPM_LICENSES.txt',
      'schemas/error-receipt.schema.json',
      'schemas/generate-receipt.schema.json',
      'schemas/inspect-receipt.schema.json',
      'schemas/matrix-settings.schema.json',
      'schemas/matrix-settings-effective.schema.json',
      'schemas/matrix-result.schema.json',
      'schemas/v2/matrix-settings.schema.json',
      'schemas/v2/matrix-settings-effective.schema.json',
      'schemas/v2/artifact-manifest.schema.json',
      'schemas/v2/cli-contract.schema.json',
      'schemas/v2/error-receipt.schema.json',
      'schemas/v2/generate-receipt.schema.json',
      'schemas/v2/inspect-receipt.schema.json',
      'schemas/v2/matrix-result.schema.json',
      'schemas/v2/notice.schema.json',
    ]
    for (const required of expectedPaths) {
      assert(packedPaths.includes(required), `tarballに必要なファイルがありません: ${required}`)
    }
    const unexpectedPaths = packedPaths.filter((path) => !expectedPaths.includes(path))
    assert(unexpectedPaths.length === 0, `allowlist外のファイルがtarballへ入りました: ${unexpectedPaths.join(', ')}`)

    await writeFile(join(installDirectory, 'package.json'), JSON.stringify({ private: true }), 'utf8')
    const tarball = join(packageDirectory, pack.filename)
    await runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], installDirectory)

    const installedPackageRoot = join(installDirectory, 'node_modules', 'bubble-matrix-map')
    const installedPackage = JSON.parse(await readFile(join(installedPackageRoot, 'package.json'), 'utf8'))
    const installedAudit = JSON.parse(
      (await runNpm(['audit', '--omit=dev', '--json', '--audit-level=critical'], installDirectory)).stdout,
    )
    assert(
      installedAudit.metadata?.vulnerabilities?.total === 0,
      `単独インストール後の本番依存に既知脆弱性があります: ${JSON.stringify(installedAudit.metadata?.vulnerabilities)}`,
    )
    assert(
      Object.keys(installedPackage.dependencies ?? {}).length === 0,
      '単独インストール用packageに外部実行依存が残っています。',
    )
    for (const required of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES']) {
      assert((await readFile(join(installedPackageRoot, required), 'utf8')).length > 0, `法務ファイルが空です: ${required}`)
    }
    const schemas = {}
    for (const name of ['matrix-settings', 'matrix-settings-effective', 'inspect-receipt', 'generate-receipt', 'error-receipt', 'matrix-result']) {
      schemas[name] = JSON.parse(await readFile(join(installedPackageRoot, 'schemas', `${name}.schema.json`), 'utf8'))
    }
    schemas['matrix-settings-v2'] = JSON.parse(
      await readFile(join(installedPackageRoot, 'schemas', 'v2', 'matrix-settings.schema.json'), 'utf8'),
    )
    schemas['matrix-settings-effective-v2'] = JSON.parse(
      await readFile(join(installedPackageRoot, 'schemas', 'v2', 'matrix-settings-effective.schema.json'), 'utf8'),
    )
    schemas['artifact-manifest-v2'] = JSON.parse(
      await readFile(join(installedPackageRoot, 'schemas', 'v2', 'artifact-manifest.schema.json'), 'utf8'),
    )
    for (const name of ['cli-contract', 'notice', 'inspect-receipt', 'generate-receipt', 'error-receipt', 'matrix-result']) {
      schemas[`${name}-v2`] = JSON.parse(
        await readFile(join(installedPackageRoot, 'schemas', 'v2', `${name}.schema.json`), 'utf8'),
      )
    }
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    for (const schema of Object.values(schemas)) ajv.addSchema(schema)
    const validators = Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => [name, ajv.getSchema(schema.$id)]),
    )
    const assertSchema = (name, value, label) => {
      const validate = validators[name]
      assert(validate(value), `${label}が配布Schemaに適合しません: ${JSON.stringify(validate.errors)}`)
    }
    assertSchema('matrix-settings-v2', { xLimit: 8, showCounts: false }, 'version 2 settings')

    const input = join(installDirectory, 'input.csv')
    await writeFile(input, 'IPC,出願人,出願年\nG01N,A社,2024\n', 'utf8')
    const installedBin = join(installedPackageRoot, 'bin', 'bubble-matrix-map.mjs')
    const executed = await execFileAsync(process.execPath, [installedBin, 'inspect', '--input', input], {
      cwd: installDirectory,
      encoding: 'utf8',
      windowsHide: true,
    })
    const receipt = JSON.parse(executed.stdout.trim())
    assert(receipt.schemaVersion === 2 && receipt.ok === true && receipt.rowCount === 1, '単独インストール後のinspect結果が不正です。')
    assert(!executed.stdout.includes('A社'), 'inspectの既定出力へセル値が含まれました。')
    assert(receipt.input === 'input.csv', 'inspectの既定入力パスがbasenameではありません。')
    assert(!executed.stdout.includes(installDirectory), 'inspectの既定出力へ絶対パスが含まれました。')
    assertSchema('inspect-receipt-v2', receipt, 'inspect receipt v2')

    const disclosed = await execFileAsync(process.execPath, [installedBin, 'inspect', '--input', input, '--include-paths'], {
      cwd: installDirectory,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert(JSON.parse(disclosed.stdout.trim()).input === input, '--include-pathsが入力絶対パスを返しません。')

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('visible-data')
    worksheet.addRow(['IPC', '出願人', '出願年'])
    worksheet.addRow(['G01N', 'A社', 2024])
    const xlsxInput = join(installDirectory, 'input.xlsx')
    await workbook.xlsx.writeFile(xlsxInput)
    const inspectedXlsx = await execFileAsync(process.execPath, [installedBin, 'inspect', '--input', xlsxInput], {
      cwd: installDirectory,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert(JSON.parse(inspectedXlsx.stdout.trim()).sourceInfo?.worksheetName === 'visible-data', '単独インストール後のExcel読込が不正です。')

    const xlsxOutput = join(installDirectory, 'xlsx-artifacts', 'matrix.svg')
    const xlsxResult = join(installDirectory, 'xlsx-artifacts', 'matrix.json')
    const generatedXlsx = await execFileAsync(
      process.execPath,
      [installedBin, 'generate', '--input', xlsxInput, '--output', xlsxOutput, '--result', xlsxResult],
      { cwd: installDirectory, encoding: 'utf8', windowsHide: true },
    )
    const generatedXlsxReceipt = JSON.parse(generatedXlsx.stdout.trim())
    assert(generatedXlsxReceipt.ok === true && generatedXlsxReceipt.disposition === 'created', '単独インストール後のExcel generate結果が不正です。')
    assert((await readFile(xlsxOutput, 'utf8')).includes('<svg'), 'Excel入力から生成したSVG成果物を検出できません。')
    const xlsxMatrixDocument = JSON.parse(await readFile(xlsxResult, 'utf8'))
    assert(xlsxMatrixDocument.source?.input === 'input.xlsx', 'Excel generate結果の入力名が不正です。')

    const output = join(installDirectory, 'artifacts', 'matrix.svg')
    const result = join(installDirectory, 'artifacts', 'matrix.json')
    const manifestPath = join(installDirectory, 'artifacts', 'matrix.manifest.json')
    const config = join(installDirectory, 'matrix-config.json')
    await writeFile(config, '{}', 'utf8')
    const generateArgs = [installedBin, 'generate', '--input', input, '--output', output, '--result', result, '--config', config]
    const generated = await execFileAsync(process.execPath, generateArgs, { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    const generatedReceipt = JSON.parse(generated.stdout.trim())
    assert(generatedReceipt.ok === true, '単独インストール後のgenerate結果が不正です。')
    assert(generatedReceipt.output === 'artifacts/matrix.svg', 'generateの既定出力パスが相対形式ではありません。')
    assert(generatedReceipt.disposition === 'created', '初回generateがcreatedではありません。')
    assert(generatedReceipt.manifest === 'artifacts/matrix.manifest.json', 'manifestの既定出力パスが相対形式ではありません。')
    assert(!generated.stdout.includes(installDirectory), 'generate receiptへ絶対パスが含まれました。')
    assertSchema('generate-receipt-v2', generatedReceipt, 'generate receipt v2')
    assert((await readFile(output, 'utf8')).includes('<svg'), 'SVG成果物を検出できません。')
    const matrixDocument = JSON.parse(await readFile(result, 'utf8'))
    assert(matrixDocument.source?.input === 'input.csv', '結果JSONへ既定で絶対入力パスが含まれました。')
    assert(!JSON.stringify(matrixDocument).includes(installDirectory), '結果JSONへ絶対パスが含まれました。')
    assertSchema('matrix-settings-effective-v2', matrixDocument.settings, 'effective matrix settings v2')
    assertSchema('matrix-result-v2', matrixDocument, 'matrix result v2')
    const artifactManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assertSchema('artifact-manifest-v2', artifactManifest, 'artifact manifest v2')
    assert(artifactManifest.artifactId === generatedReceipt.artifactId, 'manifestとreceiptのartifactIdが一致しません。')
    assert(!JSON.stringify(artifactManifest).includes(installDirectory), 'manifestへ絶対パスが含まれました。')
    for (const file of artifactManifest.files) {
      const artifactPath = join(installDirectory, file.path)
      const content = await readFile(artifactPath)
      assert(createHash('sha256').update(content).digest('hex') === file.sha256, `manifest digestが一致しません: ${file.path}`)
      assert((await stat(artifactPath)).size === file.bytes, `manifest bytesが一致しません: ${file.path}`)
    }

    const reused = await execFileAsync(process.execPath, generateArgs, {
      cwd: installDirectory,
      encoding: 'utf8',
      windowsHide: true,
    })
    const reusedReceipt = JSON.parse(reused.stdout.trim())
    assert(reusedReceipt.disposition === 'reused', '同一generateがreusedではありません。')
    assert(reusedReceipt.artifactId === generatedReceipt.artifactId, 'reusedのartifactIdが変化しました。')

    await writeFile(output, '<svg>tampered</svg>', 'utf8')
    let conflictRejected = false
    try {
      await execFileAsync(process.execPath, generateArgs, { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    } catch (error) {
      conflictRejected = true
      const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
      assert(stderr.length > 0, '成果物競合でJSONエラーreceiptが返りません。')
      const conflictReceipt = JSON.parse(stderr)
      assertSchema('error-receipt-v2', conflictReceipt, 'error receipt v2')
      assert(conflictReceipt.code === 'ARTIFACT_CONFLICT' && conflictReceipt.reason === 'digest_mismatch', '改変成果物を競合として検出できません。')
    }
    assert(conflictRejected, '改変成果物の競合拒否がありません。')

    const replaced = await execFileAsync(process.execPath, [...generateArgs, '--force'], {
      cwd: installDirectory,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert(JSON.parse(replaced.stdout.trim()).disposition === 'replaced', '--forceが競合成果物をreplacedとして置換しません。')

    const help = await execFileAsync(process.execPath, [installedBin, '--help'], { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    assert(help.stdout.includes('Bubble Matrix Map CLI'), 'help出力が不正です。')
    const inspectHelp = await execFileAsync(process.execPath, [installedBin, 'inspect', '--help'], { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    const inspectHelpAlias = await execFileAsync(process.execPath, [installedBin, 'help', 'inspect'], { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    const generateHelp = await execFileAsync(process.execPath, [installedBin, 'generate', '--help'], { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    const generateHelpAlias = await execFileAsync(process.execPath, [installedBin, 'help', 'generate'], { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    assert(inspectHelp.stdout === inspectHelpAlias.stdout && inspectHelp.stdout.includes('取り扱いに注意が必要なオプション'), 'inspect helpが不正です。')
    assert(generateHelp.stdout === generateHelpAlias.stdout && generateHelp.stdout.includes('取り扱いに注意が必要なオプション'), 'generate helpが不正です。')
    const contract = await execFileAsync(process.execPath, [installedBin, 'contract', '--json'], {
      cwd: installDirectory,
      encoding: 'utf8',
      windowsHide: true,
    })
    const contractReceipt = JSON.parse(contract.stdout.trim())
    assertSchema('cli-contract-v2', contractReceipt, 'CLI contract v2')
    for (const descriptor of contractReceipt.schemas) {
      const distributed = JSON.parse(await readFile(join(installedPackageRoot, descriptor.path), 'utf8'))
      assert(distributed.$id === descriptor.uri, `contractのSchema URIが配布物と一致しません: ${descriptor.path}`)
    }

    const stdinOutput = join(installDirectory, 'artifacts', 'stdin.svg')
    const stdinGenerated = await runWithInput(
      process.execPath,
      [installedBin, 'generate', '--input', input, '--output', stdinOutput, '--config', '-'],
      { cwd: installDirectory, windowsHide: true },
      '{"showCounts":true}',
    )
    assert(JSON.parse(stdinGenerated.stdout.trim()).config === 'stdin', '単独インストール後にstdin設定を識別できません。')
    const version = await execFileAsync(process.execPath, [installedBin, '--version'], { cwd: installDirectory, encoding: 'utf8', windowsHide: true })
    assert(version.stdout.trim() === installedPackage.version, 'CLIとpackage.jsonのversionが一致しません。')

    process.stdout.write(`${JSON.stringify({ ok: true, package: pack.filename, files: packedPaths.length, version: installedPackage.version })}\n`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
