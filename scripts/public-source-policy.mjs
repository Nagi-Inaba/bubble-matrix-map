import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const policyPath = 'scripts/public-source-policy.json'

function assertSafePolicyPath(path, kind) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${kind}に安全でないpathがあります: ${String(path)}`)
  }
}

export function validatePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('公開policyがJSON objectではありません。')
  const policy = value
  if (policy.schemaVersion !== 1) throw new Error('未対応の公開policy versionです。')
  for (const key of ['publicFiles', 'publicDirectories', 'privateFiles', 'privateDirectories']) {
    if (!Array.isArray(policy[key])) throw new Error(`公開policyの${key}が配列ではありません。`)
    if (new Set(policy[key]).size !== policy[key].length) throw new Error(`公開policyの${key}に重複があります。`)
    for (const path of policy[key]) {
      const directory = key.endsWith('Directories')
      const normalized = directory ? path.slice(0, -1) : path
      if (directory && !path.endsWith('/')) throw new Error(`${key}のpathは/で終える必要があります: ${path}`)
      assertSafePolicyPath(normalized, key)
    }
  }
  const allExact = [...policy.publicFiles, ...policy.privateFiles]
  if (new Set(allExact).size !== allExact.length) throw new Error('公開policyのfile分類が重複しています。')
  for (const publicPath of policy.publicFiles) {
    if (policy.privateFiles.includes(publicPath) || policy.privateDirectories.some((prefix) => publicPath.startsWith(prefix))) {
      throw new Error(`公開policyのpublicとprivateが重複しています: ${publicPath}`)
    }
  }
  for (const privatePath of policy.privateFiles) {
    if (policy.publicDirectories.some((prefix) => privatePath.startsWith(prefix))) {
      throw new Error(`公開policyのpublicとprivateが重複しています: ${privatePath}`)
    }
  }
  for (const publicPrefix of policy.publicDirectories) {
    if (policy.privateDirectories.some((privatePrefix) => publicPrefix.startsWith(privatePrefix) || privatePrefix.startsWith(publicPrefix))) {
      throw new Error(`公開policyのpublicとprivateが重複しています: ${publicPrefix}`)
    }
  }
  return policy
}

export async function loadWorkingPolicy(root) {
  return validatePolicy(JSON.parse(await readFile(resolve(root, policyPath), 'utf8')))
}

export async function loadCommittedPolicy(root, source) {
  const { stdout } = await execFileAsync('git', ['show', `${source}:${policyPath}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return validatePolicy(JSON.parse(stdout))
}

export function normalizeRepositoryPath(path) {
  if (typeof path !== 'string') throw new Error('repository pathが文字列ではありません。')
  const normalized = path.replaceAll('\\', '/')
  assertSafePolicyPath(normalized, 'repository')
  return normalized
}

export function classifyPath(path, policy) {
  const normalized = normalizeRepositoryPath(path)
  if (policy.publicFiles.includes(normalized) || policy.publicDirectories.some((prefix) => normalized.startsWith(prefix))) {
    return 'public'
  }
  if (policy.privateFiles.includes(normalized) || policy.privateDirectories.some((prefix) => normalized.startsWith(prefix))) {
    return 'private'
  }
  return 'unknown'
}

export async function listCandidateFiles(root) {
  const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  })
  return [...new Set(stdout.split(/\r?\n/).filter(Boolean).map(normalizeRepositoryPath))].sort()
}

export function assertPolicyCoverage(paths, policy) {
  const pathSet = new Set(paths)
  const unknown = paths.filter((path) => classifyPath(path, policy) === 'unknown')
  if (unknown.length > 0) throw new Error(`公開policyで未分類のfileがあります:\n${unknown.join('\n')}`)
  const missing = policy.publicFiles.filter((path) => !pathSet.has(path))
  if (missing.length > 0) throw new Error(`公開必須fileがありません:\n${missing.join('\n')}`)
}
