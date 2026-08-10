import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { exportPublicSource } from './public-export.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const npmCli = process.env.npm_execpath ?? join(resolve(process.execPath, '..'), 'node_modules', 'npm', 'bin', 'npm-cli.js')

async function run(command, args, cwd) {
  return execFileAsync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  })
}

async function runNpm(args, cwd) {
  return run(process.execPath, [npmCli, ...args], cwd)
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'bubble-matrix-map-public-verify-'))
const destination = join(temporaryRoot, 'public')
const verifiedTemporaryRoot = resolve(temporaryRoot)
const expectedTemporaryPrefix = resolve(tmpdir())
if (!verifiedTemporaryRoot.startsWith(expectedTemporaryPrefix) || !verifiedTemporaryRoot.includes('bubble-matrix-map-public-verify-')) {
  throw new Error(`一時directoryの使用を拒否しました: ${verifiedTemporaryRoot}`)
}
try {
  const exportReceipt = await exportPublicSource({ root, source: 'origin/main', destination })
  await run('git', ['init', '-q', '-b', 'main'], destination)
  await run('git', ['add', '--all'], destination)
  await runNpm(['ci'], destination)
  await runNpm(['run', 'verify'], destination)
  await runNpm(['run', 'audit:public-tree'], destination)
  const copyAudit = JSON.parse((await runNpm(['run', '--silent', 'audit:public-copy'], destination)).stdout.trim())
  await run('git', ['diff', '--cached', '--check'], destination)
  process.stdout.write(`${JSON.stringify({ ok: true, export: exportReceipt, copyAudit })}\n`)
} finally {
  await rm(verifiedTemporaryRoot, { recursive: true, force: true })
}
