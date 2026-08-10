import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { exportPublicSource } from '../scripts/public-export.mjs'

const execFileAsync = promisify(execFile)
const temporaryDirectories = []

async function git(root, args) {
  return execFileAsync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
}

async function createRepository(policyOverride) {
  const root = await mkdtemp(join(tmpdir(), 'bubble-public-export-test-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'scripts'), { recursive: true })
  const policy =
    policyOverride ??
    {
      schemaVersion: 1,
      publicFiles: ['README.md', 'scripts/public-source-policy.json'],
      publicDirectories: [],
      privateFiles: ['internal.md'],
      privateDirectories: [],
    }
  await writeFile(join(root, 'README.md'), '# Public\n', 'utf8')
  await writeFile(join(root, 'internal.md'), '# Internal\n', 'utf8')
  await writeFile(join(root, 'scripts', 'public-source-policy.json'), `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
  await git(root, ['init', '-q', '-b', 'main'])
  await git(root, ['config', 'user.name', 'Test User'])
  await git(root, ['config', 'user.email', 'test@example.invalid'])
  await git(root, ['add', '--all'])
  await git(root, ['commit', '-q', '-m', 'test fixture'])
  await git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe.sequential('public source export', () => {
  it('exports only public files with a deterministic receipt', async () => {
    const root = await createRepository()
    const first = join(await mkdtemp(join(tmpdir(), 'bubble-public-output-')), 'first')
    const second = join(await mkdtemp(join(tmpdir(), 'bubble-public-output-')), 'second')
    temporaryDirectories.push(join(first, '..'), join(second, '..'))

    const firstReceipt = await exportPublicSource({ root, source: 'origin/main', destination: first })
    const secondReceipt = await exportPublicSource({ root, source: 'origin/main', destination: second })

    expect(firstReceipt).toEqual(secondReceipt)
    expect(firstReceipt).toMatchObject({ ok: true, fileCount: 2, treeSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    await expect(readFile(join(first, 'README.md'), 'utf8')).resolves.toBe('# Public\n')
    await expect(readFile(join(first, 'internal.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a dirty source and a nonempty destination', async () => {
    const root = await createRepository()
    const destinationRoot = await mkdtemp(join(tmpdir(), 'bubble-public-output-'))
    temporaryDirectories.push(destinationRoot)
    const destination = join(destinationRoot, 'public')
    await mkdir(destination)
    await writeFile(join(destination, 'existing.txt'), 'keep\n', 'utf8')

    await expect(exportPublicSource({ root, source: 'origin/main', destination })).rejects.toThrow('空ではありません')
    await writeFile(join(root, 'README.md'), '# Dirty\n', 'utf8')
    await expect(exportPublicSource({ root, source: 'origin/main', destination: join(destinationRoot, 'dirty') })).rejects.toThrow(
      'cleanではありません',
    )
  })

  it('rejects unknown tracked files', async () => {
    const root = await createRepository()
    await writeFile(join(root, 'unknown.txt'), 'unknown\n', 'utf8')
    await git(root, ['add', '--all'])
    await git(root, ['commit', '-q', '-m', 'unknown file'])
    await git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    const outputRoot = await mkdtemp(join(tmpdir(), 'bubble-public-output-'))
    temporaryDirectories.push(outputRoot)
    await expect(exportPublicSource({ root, source: 'origin/main', destination: join(outputRoot, 'unknown') })).rejects.toThrow(
      '未分類',
    )

  }, 30_000)

  it('rejects a source commit that differs from origin/main', async () => {
    const root = await createRepository()
    const previous = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
    await writeFile(join(root, 'README.md'), '# Newer public content\n', 'utf8')
    await git(root, ['add', '--all'])
    await git(root, ['commit', '-q', '-m', 'newer source'])
    await git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    const outputRoot = await mkdtemp(join(tmpdir(), 'bubble-public-output-'))
    temporaryDirectories.push(outputRoot)

    await expect(exportPublicSource({ root, source: previous, destination: join(outputRoot, 'mismatch') })).rejects.toThrow(
      'origin/mainと一致しません',
    )
  })

  it('rejects unsafe policy paths', async () => {
    const unsafeRoot = await createRepository({
      schemaVersion: 1,
      publicFiles: ['../escape'],
      publicDirectories: [],
      privateFiles: [],
      privateDirectories: [],
    })
    const outputRoot = await mkdtemp(join(tmpdir(), 'bubble-public-output-'))
    temporaryDirectories.push(outputRoot)
    await expect(exportPublicSource({ root: unsafeRoot, source: 'origin/main', destination: join(outputRoot, 'unsafe') })).rejects.toThrow(
      '安全でないpath',
    )
  }, 30_000)

  it('rejects a private file nested below a public directory', async () => {
    const overlapRoot = await createRepository({
      schemaVersion: 1,
      publicFiles: ['README.md', 'scripts/public-source-policy.json'],
      publicDirectories: ['private/'],
      privateFiles: ['private/data.txt', 'internal.md'],
      privateDirectories: [],
    })
    await mkdir(join(overlapRoot, 'private'))
    await writeFile(join(overlapRoot, 'private', 'data.txt'), 'private\n', 'utf8')
    await git(overlapRoot, ['add', '--all'])
    await git(overlapRoot, ['commit', '-q', '-m', 'overlapping policy'])
    await git(overlapRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    const outputRoot = await mkdtemp(join(tmpdir(), 'bubble-public-output-'))
    temporaryDirectories.push(outputRoot)

    await expect(exportPublicSource({ root: overlapRoot, source: 'origin/main', destination: join(outputRoot, 'overlap') })).rejects.toThrow(
      'publicとprivateが重複',
    )
  })

  it('rejects linked destinations', async () => {
    const root = await createRepository()
    const outputRoot = await mkdtemp(join(tmpdir(), 'bubble-public-output-'))
    temporaryDirectories.push(outputRoot)
    const real = join(outputRoot, 'real')
    const linked = join(outputRoot, 'linked')
    await mkdir(real)
    await symlink(real, linked, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(exportPublicSource({ root, source: 'origin/main', destination: linked })).rejects.toThrow(/link|directory/)
  })

  it.runIf(process.platform !== 'win32')('rejects a tracked symbolic link', async () => {
    const root = await createRepository()
    await rm(join(root, 'README.md'))
    await symlink('internal.md', join(root, 'README.md'))
    await git(root, ['add', '--all'])
    await git(root, ['commit', '-q', '-m', 'linked public file'])
    await git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    const outputRoot = await mkdtemp(join(tmpdir(), 'bubble-public-output-'))
    temporaryDirectories.push(outputRoot)

    await expect(exportPublicSource({ root, source: 'origin/main', destination: join(outputRoot, 'linked-source') })).rejects.toThrow(
      '通常fileではありません',
    )
  })
})
