import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  assertParsedCellCountWithinLimit,
  assertTabularShapeWithinLimits,
  buildInitialSettings,
  formatColumnLabel,
  findCachedFormulaFallbacks,
  profileColumns,
  readTabularBuffer,
  readTabularFile,
} from './dataset'
import type { DatasetFile } from './types'

const dataset: DatasetFile = {
  fileName: 'sample.csv',
  columns: ['出願人', 'IPCサブクラス', '出願年', '用途分類'],
  rows: [
    { 出願人: 'A社', IPCサブクラス: 'A61K', 出願年: '2021', 用途分類: '保湿' },
    { 出願人: 'B社', IPCサブクラス: 'A61Q', 出願年: '2022', 用途分類: 'UV' },
    { 出願人: 'A社', IPCサブクラス: 'G01N', 出願年: '2024', 用途分類: '評価' },
  ],
}

const orbitDataset: DatasetFile = {
  fileName: 'orbit.csv',
  columns: ['FAN', 'TI', 'ETI', 'AP', 'APD', 'EAPD', 'PA', 'IN', 'IC', 'PA_2', 'NPA', 'IN_2', 'CTGN', 'FI', 'FTM', 'PCL'],
  rows: [
    {
      FAN: '000000001',
      TI: '(ZZ0000000001)|架空の判定方法および判定装置',
      ETI: '(ZZ0000000001)|Fictitious determination method and apparatus',
      AP: 'ZZ0000000001 2022-09-20 [2022ZZ-0000001]',
      APD: '2022-09-20',
      EAPD: '2022-09-20',
      PA: 'EXAMPLE RESEARCH ORGANIZATION',
      IN: 'ALPHA TARO|BETA HANAKO',
      IC: 'A01G-007/00|G06Q-050/02',
      PA_2: 'EXAMPLE RESEARCH ORGANIZATION',
      NPA: 'EXAMPLE RESEARCH ORGANIZATION',
      IN_2: 'ALPHA TARO|BETA HANAKO',
      CTGN: '',
      FI: 'A01G7/00|G06Q50/02',
      FTM: '5L049 CC01|5L050 CC01',
      PCL: '',
    },
  ],
}

function textFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/plain' })
}

async function xlsxFile(name: string, rows: Array<Array<string | number | Date>>): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('data')
  rows.forEach((row) => worksheet.addRow(row))
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

async function workbookArrayBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer], 'workbook.xlsx').arrayBuffer()
}

async function sparseXlsxFile(name: string): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('data')
  worksheet.getCell('A1').value = '会社'
  worksheet.getCell('C1').value = '年'
  worksheet.getCell('A2').value = 'A社'
  worksheet.getCell('C2').value = '2024'
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function oversizedXlsxArchiveHeader(): ArrayBuffer {
  const bytes = new Uint8Array(46 + 1 + 22)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint32(20, 1, true)
  view.setUint32(24, 600 * 1024 * 1024, true)
  view.setUint16(28, 1, true)
  bytes[46] = 'x'.charCodeAt(0)
  const end = 47
  view.setUint32(end, 0x06054b50, true)
  view.setUint16(end + 8, 1, true)
  view.setUint16(end + 10, 1, true)
  view.setUint32(end + 12, 47, true)
  view.setUint32(end + 16, 0, true)
  return bytes.buffer
}

describe('dataset helpers', () => {
  it('caps the total cell count before materializing row objects', () => {
    expect(() => assertTabularShapeWithinLimits(100_000, 50)).not.toThrow()
    expect(() => assertTabularShapeWithinLimits(100_000, 51)).toThrow('総セル数')
    expect(() => assertParsedCellCountWithinLimit(5_000_001)).toThrow('解析セル数')
  })

  it('detects year-like columns from content', () => {
    const profiles = profileColumns(dataset.columns, dataset.rows)
    expect(profiles.find((profile) => profile.name === '出願年')?.kind).toBe('year')
  })

  it('builds sensible initial settings for matrix defaults', () => {
    const settings = buildInitialSettings(dataset)
    expect(settings.xAxis).toBe('IPCサブクラス')
    expect(settings.yAxis).toBe('出願人')
    expect(settings.yearColumn).toBe('出願年')
    expect(settings.pieColumn).toBe('用途分類')
    expect(new Set([settings.xAxis, settings.yAxis, settings.yearColumn, settings.pieColumn])).toHaveLength(4)
    expect(settings.periodStart).toBe('')
    expect(settings.periodEnd).toBe('')
  })

  it('does not recommend the year or axis columns for pie when a natural alternative exists', () => {
    const settings = buildInitialSettings({
      fileName: 'demo.csv',
      columns: ['IPC', '出願人', '出願年', '要約', '用途'],
      rows: [{ IPC: 'G01N', 出願人: 'A社', 出願年: '2024', 要約: '架空の要約', 用途: '検査' }],
    })

    expect(settings).toMatchObject({ xAxis: 'IPC', yAxis: '出願人', yearColumn: '出願年', pieColumn: '用途' })
  })

  it('falls back to year buckets when only axis and year columns exist', () => {
    const settings = buildInitialSettings({
      fileName: 'minimal.csv',
      columns: ['IPC', '出願人', '出願年'],
      rows: [{ IPC: 'G01N', 出願人: 'A社', 出願年: '2024' }],
    })

    expect(settings).toMatchObject({ pieSourceMode: 'year_bucket', pieColumn: '', yearColumn: '出願年' })
  })

  it('uses a non-year fallback when a dataset has no year or dedicated pie column', () => {
    const settings = buildInitialSettings({
      fileName: 'minimal.csv',
      columns: ['IPC', '出願人'],
      rows: [{ IPC: 'G01N', 出願人: 'A社' }],
    })

    expect(settings).toMatchObject({ pieSourceMode: 'column', pieColumn: 'IPC', yearColumn: '' })
  })

  it('understands Orbit short headers for defaults and labels', () => {
    const settings = buildInitialSettings(orbitDataset)
    const profiles = profileColumns(orbitDataset.columns, orbitDataset.rows)

    expect(settings.yearColumn).toBe('APD')
    expect(settings.xAxis).toBe('IC')
    expect(settings.yAxis).toBe('NPA')
    expect(settings.pieColumn).toBe('FI')
    expect(formatColumnLabel('APD')).toBe('出願日 (APD)')
    expect(formatColumnLabel('PA_2')).toBe('出願人 (PA_2)')
    expect(profiles.find((profile) => profile.name === 'ETI')?.kind).toBe('text')
    expect(profiles.find((profile) => profile.name === 'AP')?.kind).toBe('text')
    expect(profiles.find((profile) => profile.name === 'APD')?.kind).toBe('year')
  })

  it('reports delimited parse diagnostics for uneven rows and duplicate headers', async () => {
    const parsed = await readTabularFile(textFile('uneven.csv', '会社,会社,年\nA社,B社,2024,余剰\nC社,,2025\nD社\n'))

    expect(parsed.columns).toEqual(['会社', '会社_2', '年'])
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.sourceInfo).toMatchObject({ format: 'CSV', encoding: 'UTF-8', delimiter: ',' })
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SOURCE_FORMAT_DETECTED', message: 'CSVをUTF-8、カンマ区切りとして読み込みました。' }),
        expect.objectContaining({ code: 'DUPLICATE_HEADERS_RENAMED', message: '重複する列名を1件リネームしました。', details: { count: 1 } }),
        expect.objectContaining({ code: 'SHORT_ROWS_PADDED', message: '列数が少ない行を1件、空欄で補完しました。', details: { count: 1 } }),
        expect.objectContaining({ code: 'LONG_ROWS_TRUNCATED', message: 'ヘッダーより列数が多い行を1件検出し、余剰セルは読み込み対象外にしました。', details: { count: 1 } }),
      ]),
    )
  })

  it('preserves JavaScript special property names as ordinary columns', async () => {
    const parsed = await readTabularFile(textFile('special-columns.csv', '__proto__,constructor,prototype,toString\nalpha,beta,gamma,delta\n'))
    const row = parsed.rows[0]

    expect(Object.getPrototypeOf(row)).toBeNull()
    expect(Object.hasOwn(row, '__proto__')).toBe(true)
    expect(row).toMatchObject({ __proto__: 'alpha', constructor: 'beta', prototype: 'gamma', toString: 'delta' })
    expect(JSON.parse(JSON.stringify(row))).toMatchObject({ __proto__: 'alpha', constructor: 'beta' })
  })

  it('accepts long patent text cells from large CSV exports', async () => {
    const longAbstract = '特許本文'.repeat(12_000)
    const parsed = await readTabularFile(textFile('long-patent.csv', `会社,要約,年\nA社,${longAbstract},2024\n`))

    expect(parsed.rows[0]?.要約).toHaveLength(longAbstract.length)
  })

  it('parses Excel .xlsx files through the workbook importer', async () => {
    const parsed = await readTabularFile(
      await xlsxFile('patent-map.xlsx', [
        ['会社', '分類', '出願日', '件数'],
        ['A社', 'A01G', new Date('2024-02-03T00:00:00.000Z'), 3],
        ['B社', 'G06Q', '2025', 7],
      ]),
    )

    expect(parsed.columns).toEqual(['会社', '分類', '出願日', '件数'])
    expect(parsed.rows).toEqual([
      { 会社: 'A社', 分類: 'A01G', 出願日: '2024-02-03', 件数: '3' },
      { 会社: 'B社', 分類: 'G06Q', 出願日: '2025', 件数: '7' },
    ])
    expect(parsed.sourceInfo).toMatchObject({ format: 'Excel' })
  })

  it('rejects an XLSX archive that declares an excessive expanded size', async () => {
    await expect(readTabularBuffer('archive-bomb.xlsx', oversizedXlsxArchiveHeader())).rejects.toThrow('展開上限')
  })

  it('uses cached primitive formula results and rejects formulas without results', async () => {
    const cachedWorkbook = new ExcelJS.Workbook()
    const cachedSheet = cachedWorkbook.addWorksheet('data')
    cachedSheet.addRow(['number', 'zero', 'boolean', 'false', 'text'])
    cachedSheet.getCell('A2').value = { formula: '1+1', result: 2 }
    cachedSheet.getCell('B2').value = { formula: '1-1', result: 0 }
    cachedSheet.getCell('C2').value = { formula: '1=1', result: true }
    cachedSheet.getCell('D2').value = { formula: '1=0', result: false }
    cachedSheet.getCell('E2').value = { formula: '"ok"', result: 'ok' }
    const cachedBuffer = await workbookArrayBuffer(cachedWorkbook)
    expect(await findCachedFormulaFallbacks(cachedBuffer, 'data')).toEqual(
      new Map([
        ['A2', '2'],
        ['B2', '0'],
        ['C2', 'true'],
        ['D2', 'false'],
        ['E2', 'ok'],
      ]),
    )
    const cached = await readTabularBuffer('formula.xlsx', cachedBuffer)

    expect(cached.rows[0]).toMatchObject({ number: '2', zero: '0', boolean: 'true', false: 'false', text: 'ok' })

    const missingWorkbook = new ExcelJS.Workbook()
    const missingSheet = missingWorkbook.addWorksheet('data')
    missingSheet.addRow(['formula'])
    missingSheet.getCell('A2').value = { formula: '1+1' }
    await expect(readTabularBuffer('missing-result.xlsx', await workbookArrayBuffer(missingWorkbook))).rejects.toThrow('結果が保存されていません')
  })

  it('rejects an Excel row wider than 500 cells before materializing it', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('data')
    worksheet.getCell('A1').value = 'header'
    worksheet.getCell('A2').value = 'value'
    worksheet.getCell(2, 501).value = 'outside-header'
    await expect(readTabularBuffer('wide.xlsx', await workbookArrayBuffer(workbook))).rejects.toThrow('500列')
  })

  it('reads the first visible worksheet and records its name', async () => {
    const workbook = new ExcelJS.Workbook()
    const hidden = workbook.addWorksheet('hidden')
    hidden.state = 'hidden'
    hidden.addRow(['wrong'])
    hidden.addRow(['hidden-value'])
    const visible = workbook.addWorksheet('visible-data')
    visible.addRow(['company'])
    visible.addRow(['Example'])
    const parsed = await readTabularBuffer('sheets.xlsx', await workbookArrayBuffer(workbook))

    expect(parsed.columns).toEqual(['company'])
    expect(parsed.rows[0]?.company).toBe('Example')
    expect(parsed.sourceInfo).toMatchObject({ format: 'Excel', worksheetName: 'visible-data' })
  })

  it('keeps sparse Excel rows aligned by preserving blank middle cells', async () => {
    const parsed = await readTabularFile(await sparseXlsxFile('sparse-columns.xlsx'))

    expect(parsed.columns).toEqual(['会社', '列', '年'])
    expect(parsed.rows).toEqual([{ 会社: 'A社', 列: '', 年: '2024' }])
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BLANK_HEADERS_FILLED', message: '空の列名を1件補完しました。', details: { count: 1 } }),
      ]),
    )
  })

  it('accepts TSV explicitly and rejects unsupported extensions', async () => {
    await expect(readTabularFile(textFile('table.tsv', '会社\t年\nA社\t2024\n'))).resolves.toMatchObject({
      sourceInfo: { format: 'TSV', delimiter: '\t' },
    })
    await expect(readTabularFile(textFile('notes.txt', '会社,年\nA社,2024\n'))).rejects.toThrow('CSV、TSV、Excel .xlsx')
    await expect(readTabularFile(textFile('legacy.xls', 'not really xls'))).rejects.toThrow('.xls は未対応')
  })
})
