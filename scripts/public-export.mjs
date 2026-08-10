import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { assertPolicyCoverage, classifyPath, loadCommittedPolicy, normalizeRepositoryPath } from './public-source-policy.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')

async function gitText(root, args) {
  return (
    await execFileAsync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    })
  ).stdout.trim()
}

async function gitBuffer(root, args) {
  return (
    await execFileAsync('git', args, {
      cwd: root,
      encoding: 'buffer',
      windowsHide: true,
      maxBuffer: 30 * 1024 * 1024,
    })
  ).stdout
}

async function readTree(root, source) {
  const output = await gitBuffer(root, ['ls-tree', '-r', '-z', source])
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d{6}) (\w+) ([a-f0-9]+)\t(.+)$/.exec(line)
      if (!match) throw new Error(`git tree entryを解析できません: ${line}`)
      return { mode: match[1], type: match[2], object: match[3], path: normalizeRepositoryPath(match[4]) }
    })
}

async function assertNoLinkedAncestors(path) {
  let current = resolve(path)
  for (;;) {
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink()) throw new Error(`destinationのancestorがlinkです: ${current}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function prepareDestination(root, destination) {
  const target = resolve(destination)
  const relativeToRoot = relative(root, target)
  if (relativeToRoot === '' || (!relativeToRoot.startsWith('..') && !isAbsolute(relativeToRoot))) {
    throw new Error('公開destinationをsource repository内には作成できません。')
  }
  await assertNoLinkedAncestors(target)
  try {
    const metadata = await lstat(target)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('公開destinationは通常のdirectoryである必要があります。')
    if ((await readdir(target)).length > 0) throw new Error('公開destinationが空ではありません。')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(target, { recursive: true })
  }
  return target
}

function treeDigest(files) {
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0${file.bytes}\n`, 'utf8')
  return hash.digest('hex')
}

export async function exportPublicSource({ root = repositoryRoot, source = 'origin/main', destination }) {
  if (!destination) throw new Error('--destinationが必要です。')
  const status = await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status.length > 0) throw new Error('source repositoryのworktreeがcleanではありません。')
  const sourceSha = await gitText(root, ['rev-parse', '--verify', '--end-of-options', `${source}^{commit}`])
  const originMainSha = await gitText(root, ['rev-parse', '--verify', 'origin/main^{commit}'])
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{40}$/.test(originMainSha)) {
    throw new Error('source commitのSHAを確定できません。')
  }
  if (sourceSha !== originMainSha) throw new Error('source commitがorigin/mainと一致しません。')

  const policy = await loadCommittedPolicy(root, sourceSha)
  const entries = await readTree(root, sourceSha)
  assertPolicyCoverage(entries.map((entry) => entry.path), policy)
  const publicEntries = entries.filter((entry) => classifyPath(entry.path, policy) === 'public')
  for (const entry of publicEntries) {
    if (entry.type !== 'blob' || entry.mode === '120000') throw new Error(`公開対象が通常fileではありません: ${entry.path}`)
  }

  const target = await prepareDestination(root, destination)
  const receiptFiles = []
  for (const entry of publicEntries.sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
    const outputPath = resolve(target, entry.path)
    const relativeToTarget = relative(target, outputPath)
    if (relativeToTarget.startsWith('..') || isAbsolute(relativeToTarget)) throw new Error(`公開pathがdestination外です: ${entry.path}`)
    await mkdir(dirname(outputPath), { recursive: true })
    const content = await gitBuffer(root, ['show', `${sourceSha}:${entry.path}`])
    await writeFile(outputPath, content, { flag: 'wx' })
    const written = await stat(outputPath)
    if (!written.isFile() || written.size !== content.length) throw new Error(`公開fileの書込検証に失敗しました: ${entry.path}`)
    receiptFiles.push({
      path: entry.path,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.length,
    })
  }

  return {
    ok: true,
    sourceSha,
    fileCount: receiptFiles.length,
    treeSha256: treeDigest(receiptFiles),
  }
}

function parseArguments(argv) {
  const result = { source: 'origin/main', destination: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--source' || option === '--destination') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${option}の値がありません。`)
      result[option.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`未知のoptionです: ${option}`)
  }
  return result
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    process.stdout.write(`${JSON.stringify(await exportPublicSource(parseArguments(process.argv.slice(2))))}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  }
}
