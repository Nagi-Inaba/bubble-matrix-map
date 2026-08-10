import { lstat, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertPolicyCoverage, classifyPath, listCandidateFiles, loadWorkingPolicy } from './public-source-policy.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const japanesePattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const internalMarkers = [
  'Co' + 'dex',
  'docs' + '-only',
  'status ' + 'follow-up',
  'private ' + 'GitHub',
  '公開' + '候補',
  '非公開' + '候補',
  '承認' + '待ち',
  '未承認',
  '作業引継ぎ',
  '内部作業',
  '公開判定',
  'Matrix Map ' + 'Desktop',
  'デスクトップ画面',
  'starting ' + 'HEAD',
]

function stripMarkdownTarget(value) {
  const target = value.trim().replace(/^<|>$/g, '').split(/\s+["']/)[0]
  return target.split('#')[0]
}

async function auditLinks(root, path, lines, policy, failures) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g
  for (const { line, lineNumber } of lines) {
    for (const match of line.matchAll(linkPattern)) {
      const target = stripMarkdownTarget(match[1])
      if (!target || /^(?:https?:|mailto:)/i.test(target)) continue
      let decoded
      try {
        decoded = decodeURIComponent(target)
      } catch {
        failures.push(`${path}:${lineNumber}: linkをdecodeできません: ${target}`)
        continue
      }
      const absoluteTarget = resolve(dirname(resolve(root, path)), decoded)
      const targetRelative = relative(root, absoluteTarget)
      if (targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
        failures.push(`${path}:${lineNumber}: linkがrepository外を参照しています: ${target}`)
        continue
      }
      try {
        const metadata = await lstat(absoluteTarget)
        const normalized = targetRelative.replaceAll('\\', '/')
        const isPublicTarget = metadata.isDirectory()
          ? policy.publicDirectories.some((prefix) => `${normalized}/`.startsWith(prefix) || prefix.startsWith(`${normalized}/`))
          : classifyPath(normalized, policy) === 'public'
        if (!isPublicTarget) {
          failures.push(`${path}:${lineNumber}: linkが非公開対象を参照しています: ${target}`)
        }
      } catch {
        failures.push(`${path}:${lineNumber}: link先がありません: ${target}`)
      }
    }
  }
}

function proseLines(markdown) {
  const result = []
  let inFence = false
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence) result.push({ line, lineNumber: index + 1 })
  }
  return result
}

export function auditMarkdown(path, markdown) {
  const failures = []
  const shortSentences = []
  for (const marker of internalMarkers) {
    if (markdown.includes(marker)) failures.push(`${path}: 内部向け表現があります: ${marker}`)
  }
  if (/\b[a-f0-9]{40}\b/i.test(markdown)) failures.push(`${path}: 40桁のcommit SHAがあります。`)
  if (/[A-Za-z]:[\\/](?:Users|dev|Work|Program Files)[\\/]|\/(?:Users|home|root)\/[^\s/]+\//i.test(markdown)) {
    failures.push(`${path}: local absolute pathがあります。`)
  }
  if (/GitHub Actions run\s+\d+/i.test(markdown)) failures.push(`${path}: 内部CI runの記録があります。`)

  for (const { line, lineNumber } of proseLines(markdown)) {
    if (/、。|。、|、、|。。/.test(line)) failures.push(`${path}:${lineNumber}: 句読点が重複または逆順です。`)
    if (japanesePattern.test(line) && /\s(?:\/|x)\s/.test(line)) failures.push(`${path}:${lineNumber}: 半角の区切り記号があります。`)
    if (/(?:\d|\})\s+(?:件|行|列|種類|区間|年|文字|個)/.test(line)) failures.push(`${path}:${lineNumber}: 助数詞の前に不要な空白があります。`)
    if (/標準入力を示す\s+-|\s-\sです/.test(line)) failures.push(`${path}:${lineNumber}: 「-」の説明が不自然です。`)
    if (/^\s*(?:#|[-*+]\s|\d+\.\s|>|\|)/.test(line) || line.trim().length === 0) continue
    const withoutUrls = line.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    for (const sentence of withoutUrls.split('。').map((value) => value.trim()).filter(Boolean)) {
      if (!japanesePattern.test(sentence)) continue
      const length = [...sentence].length
      const commas = (sentence.match(/、/g) ?? []).length
      if (length > 120) failures.push(`${path}:${lineNumber}: 一文が${length}文字あります。`)
      if (commas >= 6) failures.push(`${path}:${lineNumber}: 一文に読点が${commas}個あります。`)
      if (length <= 15) shortSentences.push(`${path}:${lineNumber}`)
    }
  }
  return { failures, shortSentences }
}

export function auditUserFacingSource(path, content) {
  const failures = []
  if (path !== 'scripts/public-copy-audit.mjs') {
    for (const marker of internalMarkers) {
      if (content.includes(marker)) failures.push(`${path}: 人向け文言に内部向け表現があります: ${marker}`)
    }
  }
  if (/\.(?:ts|js|mjs)$/.test(path) && /\b[a-f0-9]{40}\b/i.test(content)) {
    failures.push(`${path}: 人向け文言のsourceに40桁のcommit SHAがあります。`)
  }
  const contextualSeparator = /(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}」）}]|\$\{[^}]+\})\s+(?:\/|x)\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}「（]|[A-Za-z]+[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|\$\{[^}]+\}[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/u
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!japanesePattern.test(line)) continue
    const isOwnPunctuationDetector = path === 'scripts/public-copy-audit.mjs' && line.includes('/、。|。、|、、|。。/')
    if (contextualSeparator.test(line)) failures.push(`${path}:${index + 1}: 人向け文言に半角の区切り記号があります。`)
    if (/(?:\d|\})\s+(?:件|行|列|種類|区間|年|文字|個)/.test(line)) failures.push(`${path}:${index + 1}: 人向け文言の助数詞前に空白があります。`)
    if (/標準入力を示す\s+-|\s-\sです/.test(line)) failures.push(`${path}:${index + 1}: 「-」の説明が不自然です。`)
    if (!isOwnPunctuationDetector && /、。|。、|、、|。。/.test(line)) failures.push(`${path}:${index + 1}: 句読点が重複または逆順です。`)
  }
  return failures
}

export async function runPublicCopyAudit(root = repositoryRoot) {
  const policy = await loadWorkingPolicy(root)
  const candidates = await listCandidateFiles(root)
  assertPolicyCoverage(candidates, policy)
  const publicFiles = candidates.filter((path) => classifyPath(path, policy) === 'public')
  const failures = []
  const shortSentences = []
  for (const path of publicFiles) {
    const content = await readFile(resolve(root, path), 'utf8')
    if (path.endsWith('.md')) {
      const result = auditMarkdown(path, content)
      failures.push(...result.failures)
      shortSentences.push(...result.shortSentences)
      await auditLinks(root, path, proseLines(content), policy, failures)
    }
    if (/\.(?:ts|js|mjs|ya?ml)$/.test(path)) failures.push(...auditUserFacingSource(path, content))
  }
  if (failures.length > 0) throw new Error(`public-copy audit failed:\n${failures.join('\n')}`)
  return { ok: true, checked: publicFiles.length, shortSentenceCount: shortSentences.length, shortSentences }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    process.stdout.write(`${JSON.stringify(await runPublicCopyAudit())}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
