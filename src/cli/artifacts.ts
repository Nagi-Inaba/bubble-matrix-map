import { createHash } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'

export const RENDER_CONTRACT_VERSION = 2
const ARTIFACT_CONTRACT = 'bubble-matrix-map-artifact-v1'

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue }

export type ArtifactIdentityInput = {
  inputSha256: string
  inputName: string
  exposedInput: string
  includePaths: boolean
  settings: CanonicalValue
  resultJsonAvailable: boolean
}

export type ArtifactFileRole = 'svg' | 'result'

export type ArtifactManifestFile = {
  role: ArtifactFileRole
  path: string
  sha256: string
  bytes: number
}

export type ArtifactManifest = {
  schemaVersion: 2
  artifactId: string
  cliVersion: string
  renderContractVersion: number
  files: ArtifactManifestFile[]
}

export function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

export function digestUtf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function buildArtifactId(input: ArtifactIdentityInput, cliVersion: string): string {
  const document: CanonicalValue = {
    artifactContract: ARTIFACT_CONTRACT,
    cliVersion,
    inputName: input.inputName,
    inputSha256: input.inputSha256,
    includePaths: input.includePaths,
    exposedInput: input.exposedInput,
    renderContractVersion: RENDER_CONTRACT_VERSION,
    resultJsonAvailable: input.resultJsonAvailable,
    settings: input.settings,
  }
  return `sha256:${digestUtf8(canonicalJson(document))}`
}

function toPortablePath(path: string): string {
  return path.split(sep).join('/')
}

export function getArtifactSidecarPaths(output: string, outputRoot: string): {
  manifest: string
  lock: string
} {
  const outputPath = resolve(output)
  const stem = basename(outputPath, extname(outputPath))
  const manifest = join(dirname(outputPath), `${stem}.manifest.json`)
  return {
    manifest,
    lock: join(resolve(outputRoot), '.bubble-matrix-map.lock'),
  }
}

export function buildArtifactManifest(input: {
  artifactId: string
  cliVersion: string
  files: Array<{ role: ArtifactFileRole; path: string; content: string }>
}): ArtifactManifest {
  return {
    schemaVersion: 2,
    artifactId: input.artifactId,
    cliVersion: input.cliVersion,
    renderContractVersion: RENDER_CONTRACT_VERSION,
    files: input.files.map((file) => ({
      role: file.role,
      path: toPortablePath(file.path),
      sha256: digestUtf8(file.content),
      bytes: Buffer.byteLength(file.content, 'utf8'),
    })),
  }
}

function isSafeRelativePath(value: string): boolean {
  if (!value || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]/.test(value)) return false
  const parts = value.replaceAll('\\', '/').split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export function parseArtifactManifest(value: unknown): ArtifactManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const document = value as Record<string, unknown>
  if (
    !hasExactKeys(document, ['schemaVersion', 'artifactId', 'cliVersion', 'renderContractVersion', 'files']) ||
    document.schemaVersion !== 2 ||
    typeof document.artifactId !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(document.artifactId) ||
    typeof document.cliVersion !== 'string' ||
    document.renderContractVersion !== RENDER_CONTRACT_VERSION ||
    !Array.isArray(document.files) ||
    document.files.length < 1 ||
    document.files.length > 2
  ) {
    return null
  }
  const files: ArtifactManifestFile[] = []
  const roles = new Set<ArtifactFileRole>()
  const paths = new Set<string>()
  for (const item of document.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const file = item as Record<string, unknown>
    if (
      !hasExactKeys(file, ['role', 'path', 'sha256', 'bytes']) ||
      (file.role !== 'svg' && file.role !== 'result') ||
      typeof file.path !== 'string' ||
      !isSafeRelativePath(file.path) ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      typeof file.bytes !== 'number' ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    ) {
      return null
    }
    if (roles.has(file.role) || paths.has(file.path)) return null
    roles.add(file.role)
    paths.add(file.path)
    files.push({
      role: file.role,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })
  }
  if (!roles.has('svg')) return null
  return {
    schemaVersion: 2,
    artifactId: document.artifactId,
    cliVersion: document.cliVersion,
    renderContractVersion: document.renderContractVersion,
    files,
  }
}
