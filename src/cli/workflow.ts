import { createHash, randomUUID } from 'node:crypto'
import { access, link, lstat, mkdir, open, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { buildInitialSettings, getTabularFileLimit, profileColumns, readTabularBuffer } from '../lib/dataset'
import { UnsafeXlsxError } from '../lib/xlsxSafety'
import { buildPieMatrix } from '../lib/pieMatrix'
import type { DatasetFile, MatrixResult, MatrixSettings } from '../lib/types'
import type { CliArgs, GenerateArgs, InspectArgs } from './args'
import { CliError } from './args'
import { mergeAndValidateSettings } from './config'
import { buildCliContract } from './contract'
import { renderMatrixSvgDocument, SvgPresentationError } from './renderSvg'
import { CLI_VERSION } from './version'
import {
  buildArtifactId,
  buildArtifactManifest,
  getArtifactSidecarPaths,
  parseArtifactManifest,
  type ArtifactFileRole,
  type ArtifactManifest,
} from './artifacts'
type JsonRecord = Record<string, unknown>
type ConfigStdin = AsyncIterable<string | Uint8Array>
const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024

function describePeriod(settings: MatrixSettings, matrix: MatrixResult): string {
  if (settings.pieSourceMode === 'year_bucket') {
    const labels = matrix.legend.map((item) => item.label)
    return labels.length > 0 ? `年分類：${labels.join('、')}` : '年分類：表示対象なし'
  }
  const start = settings.periodStart.trim()
  const end = settings.periodEnd.trim()
  return start && end ? `集計期間：${start}〜${end}年` : '集計期間：全期間'
}

function toPortablePath(path: string): string {
  return path.split(sep).join('/')
}

function displayInputPath(path: string, includePaths: boolean): string {
  return includePaths ? path : basename(path)
}

function displayOutputPath(root: string, path: string, includePaths: boolean): string {
  return includePaths ? path : toPortablePath(relative(root, path) || '.')
}

function redactResolvedPath(message: string, path: string): string {
  return message.split(path).join(basename(path))
}

function redactOutputError(message: string, outputRoot: string, writes: PendingWrite[]): string {
  let redacted = message
  for (const write of writes) {
    redacted = redacted
      .split(write.temporary)
      .join(`${toPortablePath(relative(outputRoot, write.path))}.tmp`)
      .split(write.path)
      .join(toPortablePath(relative(outputRoot, write.path)))
  }
  redacted = redacted.split(outputRoot).join('.')
  return redacted.replace(/[A-Za-z]:\\[^\r\n'"]+/g, '[local path]')
}

function toArrayBuffer(content: Uint8Array): ArrayBuffer {
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer
}

async function readBoundedFile(
  handle: Awaited<ReturnType<typeof open>>,
  initialSize: number,
  limit: number,
): Promise<Buffer> {
  const capacity = Math.min(limit + 1, initialSize + 1)
  const content = Buffer.allocUnsafe(capacity)
  let offset = 0
  while (offset < capacity) {
    const { bytesRead } = await handle.read(content, offset, capacity - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset > limit || offset > initialSize) throw new Error('ファイルがサイズ検査後に拡大したため、読み込みを中止しました。')
  return content.subarray(0, offset)
}

async function loadDataset(inputPath: string): Promise<{ dataset: DatasetFile; input: string; inputSha256: string }> {
  const input = resolve(inputPath)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const limit = getTabularFileLimit(basename(input))
    handle = await open(input, 'r')
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error('入力パスは通常ファイルではありません。')
    if (metadata.size > limit) {
      throw new Error(`ファイルサイズが上限（${Math.floor(limit / 1024 / 1024)}MB）を超えています。`)
    }
    const content = await readBoundedFile(handle, metadata.size, limit)
    const arrayBuffer = toArrayBuffer(content)
    return {
      dataset: await readTabularBuffer(basename(input), arrayBuffer),
      input,
      inputSha256: createHash('sha256').update(content).digest('hex'),
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    if (error instanceof UnsafeXlsxError) {
      throw new CliError('UNSAFE_XLSX', error.message, 3)
    }
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = redactResolvedPath(rawMessage, input)
    throw new CliError('INPUT_ERROR', `入力ファイルを読み込めません: ${message}`, 3)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function readStdinConfig(stdin: ConfigStdin): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    for await (const chunk of stdin) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
      totalBytes += buffer.byteLength
      if (totalBytes > MAX_CONFIG_BYTES) {
        throw new CliError('INVALID_CONFIG', '標準入力の設定JSONは1MB以内にしてください。', 2, {
          field: '--config',
          reason: 'stdin_too_large',
          details: { maxBytes: MAX_CONFIG_BYTES },
        })
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('INVALID_CONFIG', '標準入力から設定JSONを読み込めません。', 2, {
      retryable: true,
      field: '--config',
      reason: 'stdin_read_error',
    })
  }

  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
  if (text.trim().length === 0) {
    throw new CliError('INVALID_CONFIG', '標準入力の設定JSONが空です。', 2, {
      field: '--config',
      reason: 'stdin_empty',
    })
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new CliError('INVALID_CONFIG', '標準入力の設定JSONが正しいJSONではありません。', 2, {
      field: '--config',
      reason: 'stdin_invalid_json',
    })
  }
}

async function loadConfig(
  configPath: string | undefined,
  stdin: ConfigStdin,
): Promise<{ config: unknown; path?: string; receipt: string | null }> {
  if (!configPath) return { config: {}, receipt: null }
  if (configPath === '-') {
    return { config: await readStdinConfig(stdin), receipt: 'stdin' }
  }
  const path = resolve(configPath)
  if (extname(path).toLowerCase() !== '.json') {
    throw new CliError('INVALID_CONFIG_PATH', '設定ファイルは .json で指定してください。', 2, {
      field: '--config',
      reason: 'unsupported_config_extension',
      allowedValues: ['.json', '-'],
    })
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error('設定パスは通常ファイルではありません。')
    if (metadata.size > MAX_CONFIG_BYTES) throw new Error('設定JSONは1MB以内にしてください。')
    const content = await readBoundedFile(handle, metadata.size, MAX_CONFIG_BYTES)
    const text = content.toString('utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) {
      throw new CliError('INVALID_CONFIG', '設定JSONが空です。', 2, {
        field: '--config',
        reason: 'config_empty',
      })
    }
    try {
      return { config: JSON.parse(text) as unknown, path, receipt: path }
    } catch {
      throw new CliError('INVALID_CONFIG', '設定ファイルが正しいJSONではありません。', 2, {
        field: '--config',
        reason: 'config_invalid_json',
      })
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = redactResolvedPath(rawMessage, path)
    throw new CliError('INVALID_CONFIG', `設定JSONを読み込めません: ${message}`, 2, {
      field: '--config',
      reason: 'config_read_error',
    })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

type PendingWrite = {
  path: string
  content: string
  temporary: string
  committed: boolean
}

function isWithinRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

function resolveOutputPath(outputRoot: string, value: string): string {
  const path = resolve(outputRoot, value)
  if (!isWithinRoot(outputRoot, path)) {
    throw new CliError('OUTPUT_OUTSIDE_ROOT', `出力先はoutput rootの配下にしてください: ${basename(path)}`, 4)
  }
  return path
}

async function existingPathsReferToSameFile(left: string, right: string): Promise<boolean> {
  try {
    const [leftStat, rightStat] = await Promise.all([
      stat(left, { bigint: true }),
      stat(right, { bigint: true }),
    ])
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
  } catch {
    return false
  }
}

async function assertParentWithinRoot(root: string, path: string): Promise<void> {
  const [realRoot, realParent] = await Promise.all([realpath(root), realpath(dirname(path))])
  if (!isWithinRoot(realRoot, realParent)) {
    throw new CliError('OUTPUT_OUTSIDE_ROOT', `出力先の実体はoutput rootの配下にありません: ${toPortablePath(relative(root, path))}`, 4)
  }
}

async function ensureOutputParent(root: string, path: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const rootMetadata = await lstat(root)
  if (rootMetadata.isSymbolicLink()) {
    throw new CliError('UNSAFE_OUTPUT_TARGET', `output rootにシンボリックリンクまたはジャンクションは使えません: ${basename(root)}`, 4)
  }
  if (!rootMetadata.isDirectory()) {
    throw new CliError('UNSAFE_OUTPUT_TARGET', `output rootはディレクトリではありません: ${basename(root)}`, 4)
  }
  const parent = dirname(path)
  const pathFromRoot = relative(root, parent)
  let current = root
  for (const part of pathFromRoot.split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink()) {
        throw new CliError('UNSAFE_OUTPUT_TARGET', `出力先の親要素にシンボリックリンクまたはジャンクションは使えません: ${toPortablePath(relative(root, current))}`, 4)
      }
      if (!metadata.isDirectory()) {
        throw new CliError('UNSAFE_OUTPUT_TARGET', `出力先の親要素はディレクトリではありません: ${toPortablePath(relative(root, current))}`, 4)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
    }
    const [realRoot, realCurrent] = await Promise.all([realpath(root), realpath(current)])
    if (!isWithinRoot(realRoot, realCurrent)) {
      throw new CliError('OUTPUT_OUTSIDE_ROOT', `出力先の親要素がoutput rootの外部を指しています: ${toPortablePath(relative(root, current))}`, 4)
    }
  }
  await assertParentWithinRoot(root, path)
}

async function validateOutputTarget(root: string, path: string): Promise<void> {
  await ensureOutputParent(root, path)
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new CliError('UNSAFE_OUTPUT_TARGET', `既存の出力先は通常ファイルではありません: ${toPortablePath(relative(root, path))}`, 4)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function writeOutputs(outputs: Array<{ path: string; content: string }>, force: boolean, outputRoot: string): Promise<void> {
  const paths = outputs.map((output) => resolve(output.path))
  if (new Set(paths).size !== paths.length) {
    throw new CliError('OUTPUT_PATH_CONFLICT', 'SVGと集計JSONには異なる出力先を指定してください。', 4)
  }

  const writes: PendingWrite[] = []
  let commitStarted = false
  try {
    await mkdir(outputRoot, { recursive: true, mode: 0o700 })
    for (const output of outputs) {
      const path = resolve(output.path)
      await validateOutputTarget(outputRoot, path)
      const exists = await pathExists(path)
      if (exists && !force) {
        throw new CliError('OUTPUT_EXISTS', `出力先が既に存在します。上書きする場合は --force を指定してください: ${toPortablePath(relative(outputRoot, path))}`, 4)
      }
      writes.push({
        path,
        content: output.content,
        temporary: `${path}.${process.pid}.${randomUUID()}.tmp`,
        committed: false,
      })
    }
    for (const write of writes) {
      await assertParentWithinRoot(outputRoot, write.path)
      await writeFile(write.temporary, write.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    }
    commitStarted = true
    for (const write of writes) {
      await assertParentWithinRoot(outputRoot, write.path)
      if (force) {
        await rename(write.temporary, write.path)
        write.committed = true
      } else {
        await link(write.temporary, write.path)
        write.committed = true
        await rm(write.temporary)
      }
    }
  } catch (error) {
    for (const write of writes) {
      await rm(write.temporary, { force: true }).catch(() => undefined)
    }
    if (error instanceof CliError) {
      const committed = writes
        .filter((write) => write.committed)
        .map((write) => toPortablePath(relative(outputRoot, write.path)))
      if (committed.length > 0) {
        throw new CliError(error.code, `${error.message} 確定済み成果物: ${committed.join(', ')}`, error.exitCode, {
          retryable: error.retryable,
          field: error.field,
          reason: error.reason,
          allowedValues: error.allowedValues,
          details: error.details,
        })
      }
      throw error
    }
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === 'EEXIST' && commitStarted && !force) {
      const committed = writes
        .filter((write) => write.committed)
        .map((write) => toPortablePath(relative(outputRoot, write.path)))
      const partial = committed.length > 0 ? ` 確定済み成果物: ${committed.join(', ')}` : ''
      throw new CliError('OUTPUT_EXISTS', `出力先が同時に作成されました。--force なしでは置き換えません。${partial}`, 4)
    }
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = redactOutputError(rawMessage, outputRoot, writes)
    const partial = writes.some((write) => write.committed) ? ' 一部の成果物はファイル単位で確定済みです。' : ''
    throw new CliError('OUTPUT_ERROR', `成果物を書き込めません: ${message}${partial}`, 4)
  }
}

type ArtifactConflictReason =
  | 'artifact_id_mismatch'
  | 'artifact_missing'
  | 'digest_mismatch'
  | 'file_set_mismatch'
  | 'manifest_invalid'
  | 'manifest_missing'

type ExpectedArtifactFile = {
  role: ArtifactFileRole
  path: string
  relativePath: string
  content: string
}

type ArtifactState =
  | { kind: 'absent' }
  | { kind: 'reusable' }
  | { kind: 'conflict'; reason: ArtifactConflictReason }

function normalizedPathKey(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function validateArtifactPaths(
  outputRoot: string,
  artifactPaths: string[],
  lockPath: string,
  protectedPaths: string[],
): Promise<void> {
  try {
    const allTargets = [...artifactPaths, lockPath]
    const keys = allTargets.map(normalizedPathKey)
    if (new Set(keys).size !== keys.length) {
      throw new CliError('OUTPUT_PATH_CONFLICT', '成果物、manifest、lockには異なる出力先が必要です。', 4)
    }
    for (const target of allTargets) {
      if (!isWithinRoot(outputRoot, target)) {
        throw new CliError('OUTPUT_OUTSIDE_ROOT', '成果物、manifest、lockはoutput rootの配下にしてください。', 4)
      }
      for (const protectedPath of protectedPaths) {
        if (
          normalizedPathKey(target) === normalizedPathKey(protectedPath) ||
          (await existingPathsReferToSameFile(target, protectedPath))
        ) {
          throw new CliError('OUTPUT_PATH_CONFLICT', '入力または設定ファイルを成果物、manifest、lockには指定できません。', 4)
        }
      }
    }
    for (const target of artifactPaths) {
      await validateOutputTarget(outputRoot, target)
    }
    await ensureOutputParent(outputRoot, lockPath)
    try {
      const metadata = await lstat(lockPath)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new CliError('UNSAFE_OUTPUT_TARGET', '既存のlockは通常ファイルではありません。', 4)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('OUTPUT_ERROR', '成果物の出力先を準備できません。', 4, {
      retryable: false,
      field: 'outputRoot',
      reason: 'output_prepare_failed',
    })
  }
}

async function acquireOutputLock(
  outputRoot: string,
  lockPath: string,
  artifactId: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  await ensureOutputParent(outputRoot, lockPath)
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(lockPath, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const metadata = await lstat(lockPath).catch(() => undefined)
      if (metadata && (metadata.isSymbolicLink() || !metadata.isFile())) {
        throw new CliError('UNSAFE_OUTPUT_TARGET', '既存のlockは通常ファイルではありません。', 4)
      }
      throw new CliError('OUTPUT_BUSY', '同じoutput rootで別の生成処理が進行中です。', 4, {
        retryable: true,
        field: 'outputRoot',
        reason: 'output_busy',
      })
    }
    throw new CliError('OUTPUT_ERROR', '生成処理のlockを作成できません。', 4, {
      field: 'outputRoot',
      reason: 'lock_create_failed',
    })
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, artifactId, cliVersion: CLI_VERSION })}\n`, 'utf8')
    return handle
  } catch {
    await handle.close().catch(() => undefined)
    await rm(lockPath, { force: true }).catch(() => undefined)
    throw new CliError('OUTPUT_ERROR', '生成処理のlockを書き込めません。', 4, {
      field: 'outputRoot',
      reason: 'lock_create_failed',
    })
  }
}

async function releaseOutputLock(
  handle: Awaited<ReturnType<typeof open>>,
  lockPath: string,
): Promise<void> {
  let failed = false
  try {
    await handle.close()
  } catch {
    failed = true
  }
  try {
    await rm(lockPath)
  } catch {
    failed = true
  }
  if (failed) {
    throw new CliError('OUTPUT_ERROR', '生成処理のlockを解放できません。手動で状態を確認してください。', 4, {
      retryable: false,
      field: 'outputRoot',
      reason: 'lock_release_failed',
    })
  }
}

async function readArtifactManifest(path: string): Promise<ArtifactManifest | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return null
    const content = await readBoundedFile(handle, metadata.size, MAX_MANIFEST_BYTES)
    return parseArtifactManifest(JSON.parse(content.toString('utf8')) as unknown)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function digestArtifactFile(path: string): Promise<{ sha256: string; bytes: number } | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const pathMetadata = await lstat(path)
    if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) return null
    handle = await open(path, 'r')
    const metadata = await handle.stat()
    if (!metadata.isFile()) return null
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < metadata.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, metadata.size - offset), offset)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    if (offset !== metadata.size) return null
    return { sha256: hash.digest('hex'), bytes: metadata.size }
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function inspectArtifactState(
  manifestPath: string,
  expectedManifest: ArtifactManifest,
  expectedFiles: ExpectedArtifactFile[],
): Promise<ArtifactState> {
  const existence = await Promise.all([manifestPath, ...expectedFiles.map((file) => file.path)].map(pathExists))
  if (existence.every((exists) => !exists)) return { kind: 'absent' }
  if (!existence[0]) return { kind: 'conflict', reason: 'manifest_missing' }

  const actualManifest = await readArtifactManifest(manifestPath)
  if (!actualManifest) return { kind: 'conflict', reason: 'manifest_invalid' }
  if (
    actualManifest.cliVersion !== expectedManifest.cliVersion ||
    actualManifest.renderContractVersion !== expectedManifest.renderContractVersion
  ) {
    return { kind: 'conflict', reason: 'manifest_invalid' }
  }
  if (actualManifest.artifactId !== expectedManifest.artifactId) {
    return { kind: 'conflict', reason: 'artifact_id_mismatch' }
  }

  const expectedByRole = new Map(expectedManifest.files.map((file) => [file.role, file]))
  const actualByRole = new Map(actualManifest.files.map((file) => [file.role, file]))
  if (
    expectedByRole.size !== actualByRole.size ||
    Array.from(expectedByRole.entries()).some(([role, expected]) => {
      const actual = actualByRole.get(role)
      return !actual || actual.path !== expected.path
    })
  ) {
    return { kind: 'conflict', reason: 'file_set_mismatch' }
  }

  for (const expectedFile of expectedFiles) {
    if (!(await pathExists(expectedFile.path))) return { kind: 'conflict', reason: 'artifact_missing' }
    const expected = expectedByRole.get(expectedFile.role)!
    const declared = actualByRole.get(expectedFile.role)!
    if (declared.sha256 !== expected.sha256 || declared.bytes !== expected.bytes) {
      return { kind: 'conflict', reason: 'digest_mismatch' }
    }
    const actual = await digestArtifactFile(expectedFile.path)
    if (!actual) return { kind: 'conflict', reason: 'artifact_missing' }
    if (actual.sha256 !== declared.sha256 || actual.bytes !== declared.bytes) {
      return { kind: 'conflict', reason: 'digest_mismatch' }
    }
  }
  return { kind: 'reusable' }
}

function throwArtifactConflict(reason: ArtifactConflictReason): never {
  throw new CliError('ARTIFACT_CONFLICT', '既存成果物を安全に再利用できません。必要な場合だけ --force で置き換えてください。', 4, {
    retryable: false,
    field: 'output',
    reason,
  })
}

async function commitArtifactSet(input: {
  outputRoot: string
  lockPath: string
  manifestPath: string
  artifactId: string
  files: ExpectedArtifactFile[]
  manifest: ArtifactManifest
  force: boolean
  protectedPaths: string[]
}): Promise<'created' | 'reused' | 'replaced'> {
  const artifactPaths = [...input.files.map((file) => file.path), input.manifestPath]
  await validateArtifactPaths(input.outputRoot, artifactPaths, input.lockPath, input.protectedPaths)
  const lock = await acquireOutputLock(input.outputRoot, input.lockPath, input.artifactId)
  try {
    await validateArtifactPaths(input.outputRoot, artifactPaths, input.lockPath, input.protectedPaths)
    const state = await inspectArtifactState(input.manifestPath, input.manifest, input.files)
    if (state.kind === 'reusable') return 'reused'
    if (state.kind === 'conflict' && !input.force) throwArtifactConflict(state.reason)

    const disposition = state.kind === 'absent' ? 'created' : 'replaced'
    if (state.kind === 'conflict') {
      await rm(input.manifestPath, { force: true })
    }
    const manifestContent = `${JSON.stringify(input.manifest, null, 2)}\n`
    await writeOutputs(
      [
        ...input.files.map((file) => ({ path: file.path, content: file.content })),
        { path: input.manifestPath, content: manifestContent },
      ],
      state.kind === 'conflict',
      input.outputRoot,
    )
    return disposition
  } finally {
    await releaseOutputLock(lock, input.lockPath)
  }
}

export async function inspectInput(args: InspectArgs): Promise<JsonRecord> {
  const { dataset, input } = await loadDataset(args.input)
  return {
    schemaVersion: 2,
    ok: true,
    command: 'inspect',
    input: displayInputPath(input, Boolean(args.includePaths)),
    fileName: dataset.fileName,
    sourceInfo: dataset.sourceInfo ?? null,
    rowCount: dataset.rows.length,
    columns: profileColumns(dataset.columns, dataset.rows).map((profile) => ({
      name: profile.name,
      kind: profile.kind,
      nonEmpty: profile.nonEmpty,
      blankCount: profile.blankCount,
      uniqueCount: profile.uniqueCount,
      ...(args.includeSamples ? { samples: profile.samples } : {}),
    })),
    defaultSettings: buildInitialSettings(dataset),
    diagnostics: dataset.diagnostics ?? [],
  }
}

export async function generateOutput(args: GenerateArgs, configStdin: ConfigStdin = process.stdin): Promise<JsonRecord> {
  const outputRoot = resolve(args.outputRoot ?? process.cwd())
  const output = resolveOutputPath(outputRoot, args.output)
  if (extname(output).toLowerCase() !== '.svg') {
    throw new CliError('INVALID_OUTPUT_PATH', 'グラフ出力は .svg で指定してください。')
  }
  const resultPath = args.result ? resolveOutputPath(outputRoot, args.result) : undefined
  if (resultPath && extname(resultPath).toLowerCase() !== '.json') {
    throw new CliError('INVALID_RESULT_PATH', '集計結果の出力は .json で指定してください。')
  }
  const sidecars = getArtifactSidecarPaths(output, outputRoot)

  const { dataset, input, inputSha256 } = await loadDataset(args.input)
  const loadedConfig = await loadConfig(args.config, configStdin)
  const protectedPaths = [input, loadedConfig.path].filter((path): path is string => Boolean(path))
  const artifactPaths = [output, resultPath, sidecars.manifest].filter((path): path is string => Boolean(path))
  await validateArtifactPaths(outputRoot, artifactPaths, sidecars.lock, protectedPaths)

  const settings = mergeAndValidateSettings(dataset, buildInitialSettings(dataset), loadedConfig.config)
  const matrix = buildPieMatrix(dataset.rows, settings)
  const exposedInput = displayInputPath(input, Boolean(args.includePaths))
  const artifactId = buildArtifactId(
    {
      inputSha256,
      inputName: dataset.fileName,
      exposedInput,
      includePaths: Boolean(args.includePaths),
      settings,
      resultJsonAvailable: Boolean(resultPath),
    },
    CLI_VERSION,
  )
  let renderedSvg: ReturnType<typeof renderMatrixSvgDocument>
  try {
    renderedSvg = renderMatrixSvgDocument(matrix, {
      sourceName: dataset.fileName,
      xAxisName: settings.xAxis,
      yAxisName: settings.yAxis,
      periodLabel: describePeriod(settings, matrix),
      cliVersion: CLI_VERSION,
      resultJsonAvailable: Boolean(resultPath),
      countDisplay: settings.showCounts ? 'shown' : 'hidden',
      artifactId,
    })
  } catch (error) {
    if (error instanceof SvgPresentationError) {
      throw new CliError(error.code, error.message)
    }
    throw error
  }
  const resultDocument = {
    schemaVersion: 2,
    artifactId,
    source: {
      input: exposedInput,
      fileName: dataset.fileName,
      sourceInfo: dataset.sourceInfo ?? null,
      rowCount: dataset.rows.length,
      diagnostics: dataset.diagnostics ?? [],
    },
    settings,
    matrix,
  }

  const files: ExpectedArtifactFile[] = [
    {
      role: 'svg',
      path: output,
      relativePath: toPortablePath(relative(outputRoot, output)),
      content: renderedSvg.svg,
    },
  ]
  if (resultPath) {
    files.push({
      role: 'result',
      path: resultPath,
      relativePath: toPortablePath(relative(outputRoot, resultPath)),
      content: `${JSON.stringify(resultDocument, null, 2)}\n`,
    })
  }
  const manifest = buildArtifactManifest({
    artifactId,
    cliVersion: CLI_VERSION,
    files: files.map((file) => ({ role: file.role, path: file.relativePath, content: file.content })),
  })
  const disposition = await commitArtifactSet({
    outputRoot,
    lockPath: sidecars.lock,
    manifestPath: sidecars.manifest,
    artifactId,
    files,
    manifest,
    force: args.force,
    protectedPaths,
  })

  return {
    schemaVersion: 2,
    ok: true,
    command: 'generate',
    input: exposedInput,
    config:
      loadedConfig.receipt === 'stdin'
        ? 'stdin'
        : loadedConfig.path
          ? displayInputPath(loadedConfig.path, Boolean(args.includePaths))
          : null,
    output: displayOutputPath(outputRoot, output, Boolean(args.includePaths)),
    result: resultPath ? displayOutputPath(outputRoot, resultPath, Boolean(args.includePaths)) : null,
    outputRoot: args.includePaths ? outputRoot : '.',
    width: renderedSvg.width,
    height: renderedSvg.height,
    totalRows: matrix.totalRows,
    scopedRows: matrix.scopedRows,
    includedRows: matrix.includedRows,
    pieExcludedRows: matrix.pieExcludedRows,
    cells: matrix.cells.length,
    summary: matrix.summary,
    warnings: [...(dataset.diagnostics ?? []), ...matrix.warnings],
    artifactId,
    disposition,
    manifest: displayOutputPath(outputRoot, sidecars.manifest, Boolean(args.includePaths)),
  }
}

export async function executeCli(args: CliArgs): Promise<JsonRecord | string> {
  if (args.command === 'help') {
    const topLevelHelp = [
      'Bubble Matrix Map CLI',
      '',
      '使い方:',
      '  bubble-matrix-map inspect --input <data.csv|data.tsv|data.xlsx> [--include-samples] [--include-paths]',
      '  bubble-matrix-map generate --input <data> --output <map.svg> [--output-root <directory>] [--config <settings.json>] [--result <matrix.json>] [--force] [--include-paths]',
      '  bubble-matrix-map contract --json',
      '  bubble-matrix-map --version',
      '',
      '詳細:',
      '  bubble-matrix-map help inspect',
      '  bubble-matrix-map help generate',
      '',
      'inspectとgenerateは、自動処理向けの1行JSONを標準出力へ返します。',
    ].join('\n')
    const inspectHelp = [
      'Bubble Matrix Map CLI - inspect',
      '',
      '使い方:',
      '  bubble-matrix-map inspect --input <data.csv|data.tsv|data.xlsx> [options]',
      '',
      '必須引数:',
      '  --input <path>       読み込むCSV、TSV、またはExcel .xlsx',
      '',
      '任意引数:',
      '  -h, --help           このhelpを表示する',
      '',
      '取り扱いに注意が必要なオプション:',
      '  --include-samples    各列のセル例を最大3件までreceiptへ含める',
      '  --include-paths      入力の絶対パスをreceiptへ含める',
      '',
      '終了コード:',
      '  0  成功',
      '  2  引数または設定の誤り',
      '  3  入力ファイルの読込または解析エラー',
      '  1  分類外の内部エラー',
      '',
      '例:',
      '  bubble-matrix-map inspect --input .\\examples\\cli-demo.csv',
      '',
      '既定ではセル例と絶対パスを出力しません。',
    ].join('\n')
    const generateHelp = [
      'Bubble Matrix Map CLI - generate',
      '',
      '使い方:',
      '  bubble-matrix-map generate --input <data> --output <map.svg> [options]',
      '',
      '必須引数:',
      '  --input <path>            読み込むCSV、TSV、またはExcel .xlsx',
      '  --output <path>           生成するSVGの出力先',
      '',
      '任意引数:',
      '  --config <path|->         設定JSONファイル。「-」は標準入力を表す',
      '  --result <path>           集計結果JSONの出力先',
      '  --output-root <directory> SVGと結果JSONを許可する出力ルート',
      '  -h, --help                このhelpを表示する',
      '',
      '取り扱いに注意が必要なオプション:',
      '  --force                   確認済みの競合成果物を置き換える',
      '  --include-paths           絶対パスをreceiptへ含める',
      '',
      '終了コード:',
      '  0  成功',
      '  2  引数または設定の誤り',
      '  3  入力ファイルの読込または解析エラー',
      '  4  出力先または書込エラー',
      '  1  分類外の内部エラー',
      '',
      '例:',
      '  bubble-matrix-map generate --input .\\examples\\cli-demo.csv --output-root .\\output --output matrix-map.svg --config .\\examples\\matrix-config.example.json --result matrix-result.json',
      '  Get-Content -Raw .\\settings.json | bubble-matrix-map generate --input .\\data.csv --output matrix-map.svg --config -',
      '',
      '既定では同一成果物を無変更で再利用し、競合成果物を置き換えず、絶対パスを出力しません。',
    ].join('\n')
    return args.topic === 'inspect' ? inspectHelp : args.topic === 'generate' ? generateHelp : topLevelHelp
  }
  if (args.command === 'version') return CLI_VERSION
  if (args.command === 'contract') return buildCliContract()
  return args.command === 'inspect' ? inspectInput(args) : generateOutput(args)
}
