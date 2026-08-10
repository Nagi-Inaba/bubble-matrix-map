import { lstat, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertPolicyCoverage, classifyPath, listCandidateFiles, loadWorkingPolicy } from './public-source-policy.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const textExtensions = new Set(['.md', '.ts', '.mjs', '.js', '.json', '.yml', '.yaml', '.ps1', '.txt', ''])
const forbiddenSecretExtensions = new Set(['.der', '.jks', '.key', '.kdbx', '.keystore', '.p12', '.pem', '.pfx'])
const maxAuditFileBytes = 25 * 1024 * 1024

function isText(path) {
  return textExtensions.has(extname(path).toLowerCase())
}

export function auditPublicFile(path, buffer) {
  const failures = []
  if (/\.(?:csv|tsv|xlsx)$/i.test(path) && path !== 'examples/cli-demo.csv') {
    failures.push(`${path}: tabular input is not on the public allowlist`)
  }
  const extension = extname(path).toLowerCase()
  if (forbiddenSecretExtensions.has(extension) || /(^|\/)\.env(?:\.|$)/i.test(path)) {
    failures.push(`${path}: secret-bearing file type is not allowed`)
  }
  if (!isText(path)) return failures

  const content = buffer.toString('utf8')
  if (
    path !== 'scripts/public-tree-audit.mjs' &&
    (content.includes(`openssh-key-v1${String.fromCharCode(0)}`) ||
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['"][^'"]{8,}/i.test(content))
  ) {
    failures.push(`${path}: possible secret`)
  }
  if (
    path !== 'scripts/public-tree-audit.mjs' &&
    (/[A-Za-z]:[\\/](?:Users|dev|Work|Program Files)[\\/]/i.test(content) || /\/(?:Users|home|root)\/[^\s/]+\//i.test(content))
  ) {
    failures.push(`${path}: absolute local path`)
  }
  if (path !== 'scripts/public-tree-audit.mjs' && /patent-analysis-workbench/i.test(content)) {
    failures.push(`${path}: parent workbench reference`)
  }

  if (/\.(?:ts|js|mjs)$/.test(path)) {
    if (/(?:from\s+|require\(|import\()\s*['"](?:electron|react|react-dom)['"]/.test(content)) {
      failures.push(`${path}: desktop runtime dependency`)
    }
    if (/(?:from\s+|require\(|import\()\s*['"](?:openai|anthropic)['"]|fetch\s*\(\s*['"]https?:/i.test(content)) {
      failures.push(`${path}: AI or network boundary violation`)
    }
  }
  return failures
}

export async function runPublicTreeAudit(root = repositoryRoot) {
  const policy = await loadWorkingPolicy(root)
  const candidates = await listCandidateFiles(root)
  assertPolicyCoverage(candidates, policy)
  const failures = []
  let checked = 0
  let privateFiles = 0
  for (const path of candidates) {
    const classification = classifyPath(path, policy)
    if (classification === 'private') {
      privateFiles += 1
      continue
    }
    const absolutePath = resolve(root, path)
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      failures.push(`${path}: public candidate must be a regular file`)
      continue
    }
    if (metadata.size > maxAuditFileBytes) {
      failures.push(`${path}: file is too large for complete secret scanning`)
      continue
    }
    checked += 1
    failures.push(...auditPublicFile(path, await readFile(absolutePath)))
  }
  if (failures.length > 0) throw new Error(`public-tree audit failed:\n${failures.join('\n')}`)
  return { ok: true, checked, privateFiles }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    process.stdout.write(`${JSON.stringify(await runPublicTreeAudit())}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
