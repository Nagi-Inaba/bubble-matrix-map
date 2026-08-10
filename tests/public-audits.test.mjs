import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { auditMarkdown, auditUserFacingSource } from '../scripts/public-copy-audit.mjs'
import { auditPublicFile } from '../scripts/public-tree-audit.mjs'

describe('public copy audit', () => {
  it('rejects internal operation language and commit identifiers in Markdown', () => {
    const internalTool = ['Co', 'dex'].join('')
    const handoff = ['作業', '引継ぎ'].join('')
    const markdown = `# 公開文書\n\n${internalTool}の作業記録です。\n\n${handoff}の記録です。\n\n${'a'.repeat(40)}\n`
    const result = auditMarkdown('README.md', markdown)

    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('内部向け表現'),
        expect.stringContaining('40桁のcommit SHA'),
      ]),
    )
  })

  it('rejects malformed punctuation, separators, counters, and dense prose', () => {
    const duplicatePunctuation = ['説明', '、', '、', '続きます。'].join('')
    const separator = ['入力', ' ', '/', ' ', '出力を確認します。'].join('')
    const spacedCounter = ['3', ' 件を処理します。'].join('')
    const dense = `${'長い説明を分割せずに続けます'.repeat(12)}。`
    const result = auditMarkdown('README.md', [duplicatePunctuation, separator, spacedCounter, dense].join('\n'))

    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('句読点'),
        expect.stringContaining('半角の区切り記号'),
        expect.stringContaining('助数詞'),
        expect.stringContaining('一文が'),
      ]),
    )
  })

  it('reports short prose without rejecting it', () => {
    const result = auditMarkdown('README.md', '短い説明です。\n')

    expect(result.failures).toEqual([])
    expect(result.shortSentences).toEqual(['README.md:1'])
  })

  it('checks Japanese strings in source files', () => {
    const source = `const label = '${['入力', ' ', 'x', ' ', '出力'].join('')}'`

    expect(auditUserFacingSource('src/example.ts', source)).toEqual([
      expect.stringContaining('半角の区切り記号'),
    ])
  })

  it('rejects internal language in source and GitHub form text', () => {
    const internalTool = ['Co', 'dex'].join('')

    expect(auditUserFacingSource('src/example.ts', `const message = '${internalTool}の作業記録です。'`)).toEqual([
      expect.stringContaining('内部向け表現'),
    ])
    expect(auditUserFacingSource('.github/ISSUE_TEMPLATE/change.yml', `description: ${internalTool}の記録`)).toEqual([
      expect.stringContaining('内部向け表現'),
    ])
  })

  it('keeps the audit self-exemption limited to its detector definition', () => {
    const detector = ['if (/', '、。|。、|、、|。。', '/.test(line))'].join('')
    const malformedMessage = ['const message = \'説明', '、', '、', '続きます。\''].join('')

    expect(auditUserFacingSource('scripts/public-copy-audit.mjs', detector)).toEqual([])
    expect(auditUserFacingSource('scripts/public-copy-audit.mjs', malformedMessage)).toEqual([
      expect.stringContaining('句読点'),
    ])
  })
})

describe('public tree audit', () => {
  it('rejects secret material, local paths, and runtime network imports', () => {
    const secret = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
    const localPath = ['C:', '\\', 'dev', '\\', 'private', '\\', 'input.csv'].join('')
    const unixLocalPath = ['/', 'home', '/', 'example', '/', 'private', '/', 'input.csv'].join('')
    const networkImport = ['import client from ', "'open", "ai'"].join('')

    expect(auditPublicFile('notes.txt', Buffer.from(secret))).toEqual([expect.stringContaining('possible secret')])
    expect(auditPublicFile('notes.txt', Buffer.from(localPath))).toEqual([expect.stringContaining('absolute local path')])
    expect(auditPublicFile('notes.txt', Buffer.from(unixLocalPath))).toEqual([
      expect.stringContaining('absolute local path'),
    ])
    expect(auditPublicFile('src/client.ts', Buffer.from(networkImport))).toEqual([
      expect.stringContaining('AI or network boundary violation'),
    ])
  })

  it('allows only the fictional tabular example', () => {
    expect(auditPublicFile('examples/cli-demo.csv', Buffer.from('a,b\n1,2\n'))).toEqual([])
    expect(auditPublicFile('private/data.csv', Buffer.from('a,b\n1,2\n'))).toEqual([
      expect.stringContaining('tabular input'),
    ])
  })
})
