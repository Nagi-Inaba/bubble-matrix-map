import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const rangePattern = /from\s+v?(\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)\s+to\s+v?(\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)/gi
const metadataPattern = /update-type:\s*version-update:semver-(major|minor|patch)/g
const failingResults = new Set(['ACTION_REQUIRED', 'ERROR', 'FAILURE', 'STARTUP_FAILURE', 'TIMED_OUT'])

function log(message) {
  process.stderr.write(`${message}\n`)
}

function parseVersion(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  }
}

export function classifyRange(from, to) {
  const previous = parseVersion(from)
  const next = parseVersion(to)
  if (!previous || !next) return 'unknown'
  if (next.major !== previous.major) return next.major > previous.major ? 'major' : 'unknown'
  if (next.minor !== previous.minor) return next.minor > previous.minor ? 'minor' : 'unknown'
  if (next.patch !== previous.patch) return next.patch > previous.patch ? 'patch' : 'unknown'
  return 'unknown'
}

function combine(types) {
  if (types.includes('major')) return 'major'
  if (types.includes('unknown')) return 'unknown'
  if (types.includes('minor')) return 'minor'
  if (types.includes('patch')) return 'patch'
  return 'unknown'
}

function introduction(body) {
  const lines = []
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === '' || line.includes('<details')) break
    lines.push(line)
  }
  return lines.join('\n')
}

function rangesIn(text) {
  return [...text.matchAll(rangePattern)].map((match) => classifyRange(match[1], match[2]))
}

export function classifyPullRequest(pullRequest) {
  const body = typeof pullRequest.body === 'string' ? pullRequest.body : ''
  const metadata = [...body.matchAll(metadataPattern)].map((match) => match[1])
  if (metadata.length > 0) return combine(metadata)
  const title = typeof pullRequest.title === 'string' ? pullRequest.title : ''
  const found = [...rangesIn(title), ...rangesIn(introduction(body))]
  if (found.length === 0) return 'unknown'
  return combine(found)
}

export function hasFailingChecks(statusCheckRollup) {
  const checks = Array.isArray(statusCheckRollup) ? statusCheckRollup : []
  return checks.some((check) => failingResults.has(String(check?.conclusion || check?.state || '').toUpperCase()))
}

export function selectReviewTargets(pullRequests) {
  if (!Array.isArray(pullRequests)) throw new Error('dependabot pull requests must be an array')
  const selected = []
  for (const pullRequest of pullRequests) {
    if (!pullRequest || typeof pullRequest.number !== 'number') continue
    if (typeof pullRequest.state === 'string' && pullRequest.state.toLowerCase() !== 'open') continue
    const updateType = classifyPullRequest(pullRequest)
    const reasons = []
    if (updateType === 'major') reasons.push('semver-major')
    if (updateType === 'unknown') reasons.push('unclassified')
    if (hasFailingChecks(pullRequest.statusCheckRollup)) reasons.push('failing-checks')
    if (reasons.length === 0) continue
    selected.push({
      number: pullRequest.number,
      updateType,
      reasons: reasons.join(','),
    })
  }
  selected.sort((left, right) => left.number - right.number)
  return selected
}

function main() {
  const raw = readFileSync(0, 'utf8')
  if (raw.trim() === '') throw new Error('expected a JSON array of pull requests on stdin')
  const selected = selectReviewTargets(JSON.parse(raw))
  for (const pullRequest of selected) {
    log(`#${pullRequest.number} ${pullRequest.updateType} ${pullRequest.reasons}`)
  }
  log(`selected ${selected.length} pull request(s)`)
  process.stdout.write(`${JSON.stringify(selected)}\n`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
