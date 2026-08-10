import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const inventoryPath = join(repositoryRoot, 'licenses', 'BUNDLED_NPM_LICENSES.txt')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function packageRootFromSource(source, outDir) {
  const normalized = resolve(outDir, source).replaceAll('\\', '/')
  const marker = '/node_modules/'
  const index = normalized.lastIndexOf(marker)
  if (index < 0) return undefined
  const parts = normalized.slice(index + marker.length).split('/')
  const packageParts = parts[0].startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)
  return normalized.slice(0, index + marker.length) + packageParts.join('/')
}

async function bundledPackageRecords() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-license-'))
  try {
    const outDir = join(temporaryRoot, 'dist-cli')
    const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
    await execFileAsync(
      process.execPath,
      [viteCli, 'build', '--config', join(repositoryRoot, 'vite.cli.config.ts'), '--sourcemap', '--outDir', outDir],
      { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    )
    const sourceMap = JSON.parse(await readFile(join(outDir, 'bubble-matrix-map.mjs.map'), 'utf8'))
    const packageRoots = [
      ...new Set(
        sourceMap.sources
          .map((source) => packageRootFromSource(source, outDir))
          .filter((packageRoot) => typeof packageRoot === 'string'),
      ),
    ]
    const recordsByNameAndVersion = new Map()
    for (const packageRoot of packageRoots) {
      const packageDocument = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      const key = `${packageDocument.name}@${packageDocument.version}`
      if (!recordsByNameAndVersion.has(key)) {
        recordsByNameAndVersion.set(key, {
          name: packageDocument.name,
          version: packageDocument.version,
          declaredLicense:
            typeof packageDocument.license === 'string'
              ? packageDocument.license
              : JSON.stringify(packageDocument.license),
          packageRoot,
        })
      }
    }
    return [...recordsByNameAndVersion.values()].sort((left, right) => {
      const leftKey = `${left.name}@${left.version}`
      const rightKey = `${right.name}@${right.version}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function packageLicenseSections(packageRecord) {
  const { name, version, declaredLicense, packageRoot } = packageRecord
  const rootFiles = await readdir(packageRoot)
  const licenseFiles = rootFiles
    .filter((file) => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(file))
    .sort()
  const sections = []

  for (const file of licenseFiles) {
    sections.push({ label: file, body: await readFile(join(packageRoot, file), 'utf8') })
  }

  if (name === 'isarray' && sections.length === 0) {
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8')
    const licenseStart = readme.indexOf('## License')
    assert(licenseStart >= 0, 'isarray license section is missing')
    sections.push({ label: 'README.md license section', body: readme.slice(licenseStart) })
  }

  if (name === 'pako') {
    sections.push({
      label: 'lib/zlib/README',
      body: await readFile(join(packageRoot, 'lib', 'zlib', 'README'), 'utf8'),
    })
  }

  if (name === 'saxes' && version === '5.0.1' && sections.length === 0) {
    sections.push({
      label: 'upstream LICENSE from saxes v5.0.1',
      body: await readFile(join(repositoryRoot, 'licenses', 'LICENSE-saxes'), 'utf8'),
    })
  }

  return {
    name,
    version,
    declaredLicense,
    sections,
  }
}

async function renderInventory() {
  const bundledRecords = await bundledPackageRecords()
  assert(
    bundledRecords.some((packageRecord) => packageRecord.name === 'exceljs'),
    'ExcelJS must be present in the self-contained CLI bundle.',
  )
  const packages = await Promise.all(bundledRecords.map(packageLicenseSections))
  const missingLicenseTexts = packages.filter((packageRecord) => packageRecord.sections.length === 0)
  assert(
    missingLicenseTexts.length === 0,
    `No license text found for bundled packages: ${missingLicenseTexts.map((packageRecord) => `${packageRecord.name}@${packageRecord.version}`).join(', ')}`,
  )
  const lines = [
    'BUNDLED NPM DEPENDENCY LICENSES',
    '',
    'Generated from the Vite production bundle source map.',
    'The CLI bundle is self-contained and includes ExcelJS.',
    'Run `npm run audit:licenses -- --write` after an intentional dependency change.',
    '',
  ]

  for (const packageRecord of packages) {
    lines.push(
      `================================================================================`,
      `${packageRecord.name}@${packageRecord.version}`,
      `Declared license: ${packageRecord.declaredLicense}`,
      `================================================================================`,
      '',
    )
    for (const section of packageRecord.sections) {
      const normalizedBody = section.body
        .replaceAll('\r\n', '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trimEnd()
      lines.push(`--- ${section.label} ---`, '', normalizedBody, '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

const expected = (await renderInventory()).replaceAll('\r\n', '\n')
if (process.argv.includes('--write')) {
  await writeFile(inventoryPath, expected, 'utf8')
  process.stdout.write(`${JSON.stringify({ ok: true, action: 'written', path: 'licenses/BUNDLED_NPM_LICENSES.txt' })}\n`)
} else {
  const actual = await readFile(inventoryPath, 'utf8')
  assert(
    actual.replaceAll('\r\n', '\n') === expected,
    'Bundled license inventory is stale. Run npm run audit:licenses -- --write.',
  )
  process.stdout.write(`${JSON.stringify({ ok: true, packages: (expected.match(/^Declared license:/gm) ?? []).length })}\n`)
}
