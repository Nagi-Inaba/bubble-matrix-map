import type { ColumnProfile, DataRow, DatasetFile, MatrixSettings, StructuredNotice } from './types'
import { buildDefaultBoundaries, extractYear, findDistinctYears } from './pieMatrix'
import { getOrbitBaseHeader, isYearishColumnName, normalizeColumnName } from './columnSemantics'
import { validateXlsxSafety } from './xlsxSafety'

const MAX_DELIMITED_FILE_BYTES = 256 * 1024 * 1024
const MAX_XLSX_FILE_BYTES = 96 * 1024 * 1024
const LARGE_FILE_WARNING_BYTES = 50 * 1024 * 1024
const MAX_ROWS = 100_000
const MAX_COLUMNS = 500
const MAX_TOTAL_CELLS = 5_000_000
// Patent exports can include very long claim, abstract, and concept fields.
const MAX_CELL_LENGTH = 1_000_000

const orbitHeaderAliases: Record<string, string> = {
  FAN: 'OrbitファミリーID',
  TI: 'タイトル',
  ETI: '英語タイトル',
  APID: '出願ID',
  AP: '出願番号',
  APD: '出願日',
  EAPD: '最先出願日',
  XPN: '拡張公報番号',
  PN: '公報番号',
  AB: '要約',
  EAB: '英語要約',
  IMG: '代表図URL',
  CLMS: '請求項',
  OCLM: '原文請求項',
  PA: '出願人',
  NPA: '正規化出願人',
  IN: '発明者',
  IC: 'IPC分類',
  XPR: '引用・審査情報',
  CTGN: '技術カテゴリ',
  FI: 'FI分類',
  FTM: 'Fターム',
  PCL: 'PCL',
}

const orbitYearHeaders = new Set(['APD', 'EAPD'])
const orbitNumericHeaders = new Set(['FAN', 'APID'])

function normalizeForMatch(value: string): string {
  return normalizeColumnName(value)
}

function getOrbitHeaderAlias(name: string): string | undefined {
  return orbitHeaderAliases[getOrbitBaseHeader(name)]
}

function getSearchableColumnName(name: string): string {
  const alias = getOrbitHeaderAlias(name)
  return alias ? `${name} ${alias}` : name
}

export function formatColumnLabel(name: string): string {
  const alias = getOrbitHeaderAlias(name)
  return alias ? `${alias} (${name})` : name
}

function uniqueColumnName(name: string, used: Set<string>): string {
  const base = name.trim() || '列'
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) index += 1
  const next = `${base}_${index}`
  used.add(next)
  return next
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === delimiter && !quoted) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }

  cells.push(cell.trim())
  return cells
}

function detectDelimiter(headerLine: string): string {
  const candidates = [',', '\t', ';']
  return candidates
    .map((delimiter) => ({ delimiter, count: splitCsvLine(headerLine, delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ','
}

function formatFixedInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function assertTabularShapeWithinLimits(rowCount: number, columnCount: number): void {
  if (rowCount > MAX_ROWS) throw new Error(`行数が上限（${formatFixedInteger(MAX_ROWS)}行）を超えています。`)
  if (columnCount > MAX_COLUMNS) throw new Error(`列数が上限（${formatFixedInteger(MAX_COLUMNS)}列）を超えています。`)
  if (rowCount * columnCount > MAX_TOTAL_CELLS) {
    throw new Error(`総セル数が上限（${formatFixedInteger(MAX_TOTAL_CELLS)}セル）を超えています。`)
  }
}

export function assertParsedCellCountWithinLimit(cellCount: number): void {
  if (cellCount > MAX_TOTAL_CELLS) {
    throw new Error(`解析セル数が上限（${formatFixedInteger(MAX_TOTAL_CELLS)}セル）を超えています。`)
  }
}

function splitCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let parsedCellCount = 0
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === delimiter && !quoted) {
      row.push(cell.trim())
      cell = ''
      continue
    }
    if (char === '\n' && !quoted) {
      row.push(cell.trim())
      if (row.some((value) => value.length > 0)) {
        parsedCellCount += row.length
        assertParsedCellCountWithinLimit(parsedCellCount)
        records.push(row)
      }
      if (records.length > 1) assertTabularShapeWithinLimits(records.length - 1, records[0].length)
      row = []
      cell = ''
      continue
    }
    cell += char
    if (cell.length > MAX_CELL_LENGTH) throw new Error(`1セルの文字数が上限（${formatFixedInteger(MAX_CELL_LENGTH)}文字）を超えています。`)
  }

  row.push(cell.trim())
  if (row.some((value) => value.length > 0)) {
    parsedCellCount += row.length
    assertParsedCellCountWithinLimit(parsedCellCount)
    records.push(row)
  }
  if (records.length > 1) assertTabularShapeWithinLimits(records.length - 1, records[0].length)
  if (quoted) throw new Error('CSVの引用符が閉じていません。')
  return records
}

type SourceInfo = NonNullable<DatasetFile['sourceInfo']>

function describeDelimiter(delimiter: string): string {
  if (delimiter === '\t') return 'タブ'
  if (delimiter === ',') return 'カンマ'
  if (delimiter === ';') return 'セミコロン'
  return delimiter
}

function recordsToDataset(
  fileName: string,
  records: string[][],
  sourceInfo: SourceInfo,
  initialDiagnostics: StructuredNotice[] = [],
): DatasetFile {
  if (records.length < 2) {
    throw new Error('ヘッダーと1行以上のデータが必要です。')
  }

  const diagnostics = [...initialDiagnostics]
  assertTabularShapeWithinLimits(records.length - 1, records[0].length)

  const used = new Set<string>()
  const renamedHeaders: string[] = []
  const blankHeaders: number[] = []
  const columns = records[0].map((column, index) => {
    if (column.trim().length === 0) blankHeaders.push(index + 1)
    const renamed = uniqueColumnName(column, used)
    if (renamed !== column.trim()) renamedHeaders.push(`${column.trim() || '空の列名'} -> ${renamed}`)
    return renamed
  })
  if (blankHeaders.length > 0) {
    diagnostics.push({
      code: 'BLANK_HEADERS_FILLED',
      message: `空の列名を${blankHeaders.length}件補完しました。`,
      severity: 'warning',
      field: 'columns',
      details: { count: blankHeaders.length },
    })
  }
  if (renamedHeaders.length > 0) {
    diagnostics.push({
      code: 'DUPLICATE_HEADERS_RENAMED',
      message: `重複する列名を${renamedHeaders.length}件リネームしました。`,
      severity: 'warning',
      field: 'columns',
      details: { count: renamedHeaders.length },
    })
  }

  let shortRows = 0
  let longRows = 0
  const rows = records.slice(1).map((cells, rowIndex) => {
    if (cells.length < columns.length) shortRows += 1
    if (cells.length > columns.length) longRows += 1
    return columns.reduce<DataRow>((row, column, index) => {
      const value = cells[index] ?? ''
      if (value.length > MAX_CELL_LENGTH) {
        throw new Error(`行${rowIndex + 2}のセル文字数が上限（${formatFixedInteger(MAX_CELL_LENGTH)}文字）を超えています。`)
      }
      ;(row as Record<string, string>)[column] = value
      return row
    }, Object.create(null))
  })
  if (shortRows > 0) {
    diagnostics.push({
      code: 'SHORT_ROWS_PADDED',
      message: `列数が少ない行を${formatFixedInteger(shortRows)}件、空欄で補完しました。`,
      severity: 'warning',
      details: { count: shortRows },
    })
  }
  if (longRows > 0) {
    diagnostics.push({
      code: 'LONG_ROWS_TRUNCATED',
      message: `ヘッダーより列数が多い行を${formatFixedInteger(longRows)}件検出し、余剰セルは読み込み対象外にしました。`,
      severity: 'warning',
      details: { count: longRows },
    })
  }

  return { fileName, columns, rows, diagnostics, sourceInfo }
}

function decodeDelimitedBuffer(buffer: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16LE' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16BE' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'Shift_JIS' }
  }
}

function parseDelimitedBuffer(fileName: string, buffer: ArrayBuffer, format: 'CSV' | 'TSV', fileSize: number): DatasetFile {
  const decoded = decodeDelimitedBuffer(buffer)
  const text = decoded.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const delimiter = format === 'TSV' ? '\t' : detectDelimiter(text.split('\n')[0] ?? '')
  const diagnostics: StructuredNotice[] =
    fileSize >= LARGE_FILE_WARNING_BYTES
      ? [
          {
            code: 'LARGE_INPUT_FILE',
            message: 'ファイルサイズが大きいため、読み込みに時間がかかる場合があります。',
            severity: 'warning',
            details: { bytes: fileSize },
          },
        ]
      : []
  diagnostics.push({
    code: 'SOURCE_FORMAT_DETECTED',
    message: `${format}を${decoded.encoding}、${describeDelimiter(delimiter)}区切りとして読み込みました。`,
    severity: 'info',
    details: { format, encoding: decoded.encoding, delimiter },
  })
  return recordsToDataset(fileName, splitCsvRecords(text, delimiter), { format, encoding: decoded.encoding, delimiter }, diagnostics)
}

export function excelCellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return String(value)

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>
    if (typeof objectValue.error === 'string' || typeof objectValue.error === 'number') {
      throw new Error(`Excelセルの数式エラー: ${String(objectValue.error)}`)
    }
    if (typeof objectValue.error === 'object') {
      throw new Error('Excelセルの数式エラー: 不明なエラー')
    }
    if (objectValue.hyperlink && typeof objectValue.text === 'string') {
      return objectValue.text
    }
    if (Array.isArray(objectValue.richText)) {
      return objectValue
        .richText.map((entry) => (typeof (entry as Record<string, unknown>).text === 'string' ? String((entry as Record<string, unknown>).text) : ''))
        .join('')
    }
    if (typeof objectValue.text === 'string') {
      return objectValue.text
    }
    if ('formula' in objectValue || 'sharedFormula' in objectValue) {
      if (!('result' in objectValue)) {
        throw new Error('Excel数式の結果が保存されていません。')
      }
      const result = objectValue.result
      if (result === null || result === undefined) {
        throw new Error('Excel数式の結果が保存されていません。')
      }
      if (result instanceof Date) return result.toISOString().slice(0, 10)
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') return String(result)
      if (typeof result === 'object' && result !== null && 'error' in (result as Record<string, unknown>)) {
        throw new Error(`Excel数式の計算結果がエラーです: ${String((result as Record<string, unknown>).error)}`)
      }
      throw new Error('Excel数式の結果型が未対応です。')
    }
    if (typeof objectValue.result !== 'undefined') {
      const result = objectValue.result
      if (result === null || result === undefined) {
        throw new Error('Excel数式の結果が保存されていません。')
      }
      if (result instanceof Date) return result.toISOString().slice(0, 10)
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') return String(result)
      throw new Error('Excelセルの値がサポートされていない形式です。')
    }
    throw new Error('Excelセルの値がサポートされていない形式です。')
  }

  throw new Error('Excelセルの値がサポートされていない形式です。')
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = attributes.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`))
  return match ? decodeXmlAttribute(match[1]) : undefined
}

export async function findCachedFormulaFallbacks(buffer: ArrayBuffer, worksheetName: string): Promise<Map<string, string>> {
  const JSZip = (await import('jszip')).default
  const archive = await JSZip.loadAsync(buffer)
  const workbookXml = await archive.file('xl/workbook.xml')?.async('string')
  const relationshipsXml = await archive.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!workbookXml || !relationshipsXml) return new Map()

  let relationshipId: string | undefined
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attributes = match[1]
    if (xmlAttribute(attributes, 'name') === worksheetName) {
      relationshipId = xmlAttribute(attributes, 'r:id')
      break
    }
  }
  if (!relationshipId) return new Map()

  let target: string | undefined
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const attributes = match[1]
    if (xmlAttribute(attributes, 'Id') === relationshipId) {
      target = xmlAttribute(attributes, 'Target')
      break
    }
  }
  if (!target) return new Map()
  const normalizedTarget = target.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalizedTarget.split('/').includes('..')) return new Map()
  const worksheetPath = normalizedTarget.startsWith('xl/') ? normalizedTarget : `xl/${normalizedTarget}`
  const worksheetXml = await archive.file(worksheetPath)?.async('string')
  if (!worksheetXml) return new Map()

  const cells = new Map<string, string>()
  for (const match of worksheetXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attributes = match[1]
    const body = match[2]
    if (!/<f\b/.test(body)) continue
    const address = xmlAttribute(attributes, 'r')
    if (!address || !/^[A-Z]+[1-9]\d*$/.test(address)) continue
    const cachedValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    if (cachedValue === undefined) continue
    const cellType = xmlAttribute(attributes, 't')
    if (cellType === 'b' && /^\s*[01]\s*$/.test(cachedValue)) {
      cells.set(address, cachedValue.trim() === '1' ? 'true' : 'false')
    } else if (cellType === 'str') {
      cells.set(address, decodeXmlAttribute(cachedValue))
    } else if ((cellType === undefined || cellType === 'n') && /^\s*-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(cachedValue)) {
      cells.set(address, cachedValue.trim())
    }
  }
  return cells
}

async function parseWorkbookBuffer(fileName: string, buffer: ArrayBuffer): Promise<DatasetFile> {
  validateXlsxSafety(buffer)
  const ExcelJsModule = await import('exceljs')
  const ExcelJS = ExcelJsModule.default ?? ExcelJsModule
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const worksheet = workbook.worksheets.find((sheet) => sheet.state === undefined || sheet.state === 'visible')
  if (!worksheet) throw new Error('表示可能なExcelシートが見つかりません。')
  const cachedFormulaFallbacks = await findCachedFormulaFallbacks(buffer, worksheet.name)

  const records: string[][] = []
  let cumulativeCellCount = 0
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.cellCount > MAX_COLUMNS) {
      throw new Error(`列数が上限（${formatFixedInteger(MAX_COLUMNS)}列）を超えています。`)
    }
    cumulativeCellCount += row.cellCount
    assertParsedCellCountWithinLimit(cumulativeCellCount)
    const cells = Array.from({ length: row.cellCount }, (_, index) => {
      const cell = row.getCell(index + 1)
      const cachedFormulaFallback = cachedFormulaFallbacks.get(cell.address)
      return (cachedFormulaFallback ?? excelCellToString(cell.value)).trimEnd()
    })
    if (cells.some((value) => value.length > 0)) records.push(cells)
    if (records.length > MAX_ROWS + 1) throw new Error(`行数が上限（${formatFixedInteger(MAX_ROWS)}行）を超えています。`)
  })

  return recordsToDataset(fileName, records, { format: 'Excel', worksheetName: worksheet.name })
}

export function getTabularFileLimit(fileName: string): number {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xls')) {
    throw new Error('.xls は未対応です。Excelで .xlsx か CSV に保存し直して読み込んでください。')
  }
  const isCsv = lower.endsWith('.csv')
  const isTsv = lower.endsWith('.tsv')
  const isXlsx = lower.endsWith('.xlsx')
  if (!isCsv && !isTsv && !isXlsx) {
    throw new Error('読み込めるファイルは CSV、TSV、Excel .xlsx のみです。')
  }
  return isXlsx ? MAX_XLSX_FILE_BYTES : MAX_DELIMITED_FILE_BYTES
}

export async function readTabularBuffer(fileName: string, buffer: ArrayBuffer): Promise<DatasetFile> {
  const lower = fileName.toLowerCase()
  const maxBytes = getTabularFileLimit(fileName)
  if (buffer.byteLength > maxBytes) {
    throw new Error(`ファイルサイズが上限（${Math.floor(maxBytes / 1024 / 1024)}MB）を超えています。`)
  }
  if (lower.endsWith('.xlsx')) {
    return parseWorkbookBuffer(fileName, buffer)
  }
  return parseDelimitedBuffer(fileName, buffer, lower.endsWith('.tsv') ? 'TSV' : 'CSV', buffer.byteLength)
}

export async function readTabularFile(file: File): Promise<DatasetFile> {
  const maxBytes = getTabularFileLimit(file.name)
  if (file.size > maxBytes) {
    throw new Error(`ファイルサイズが上限（${Math.floor(maxBytes / 1024 / 1024)}MB）を超えています。`)
  }
  return readTabularBuffer(file.name, await file.arrayBuffer())
}

function isNumericValue(value: string): boolean {
  const normalized = value.trim().replace(/,/g, '')
  return normalized.length > 0 && /^-?\d+(\.\d+)?$/.test(normalized)
}

function detectColumnKind(name: string, values: string[]): ColumnProfile['kind'] {
  const nonEmpty = values.filter((value) => value.trim().length > 0)
  if (nonEmpty.length === 0) return 'text'
  const orbitBaseHeader = getOrbitBaseHeader(name)
  if (orbitYearHeaders.has(orbitBaseHeader)) return 'year'
  if (orbitNumericHeaders.has(orbitBaseHeader)) return 'numeric'
  if (getOrbitHeaderAlias(name)) return 'text'
  const normalizedName = normalizeForMatch(getSearchableColumnName(name))
  if (isYearishColumnName(getSearchableColumnName(name)) || /(year|date)$/.test(normalizedName)) return 'year'
  const yearRatio = nonEmpty.filter((value) => extractYear(value) !== null).length / nonEmpty.length
  if (yearRatio >= 0.65) return 'year'
  const numericRatio = nonEmpty.filter((value) => isNumericValue(value)).length / nonEmpty.length
  if (numericRatio >= 0.75) return 'numeric'
  return 'text'
}

export function profileColumns(columns: string[], rows: DataRow[]): ColumnProfile[] {
  return columns.map((name) => {
    const values = rows.map((row) => row[name] ?? '')
    const nonEmptyValues = values.filter((value) => value.trim().length > 0)
    const samples = Array.from(new Set(nonEmptyValues)).slice(0, 3)
    return {
      name,
      kind: detectColumnKind(name, values),
      nonEmpty: nonEmptyValues.length,
      blankCount: values.length - nonEmptyValues.length,
      uniqueCount: new Set(nonEmptyValues.map((value) => value.trim())).size,
      samples,
    }
  })
}

function choosePreferredColumn(columns: string[], expressions: RegExp[], fallback: string): string {
  for (const expression of expressions) {
    const matched = columns.find((column) => expression.test(getSearchableColumnName(column)))
    if (matched) return matched
  }
  return fallback
}

export function buildInitialSettings(dataset: DatasetFile): MatrixSettings {
  const profiles = profileColumns(dataset.columns, dataset.rows)
  const populatedColumns = profiles.filter((profile) => profile.nonEmpty > 0).map((profile) => profile.name)
  const fallbackColumns = populatedColumns.length > 0 ? populatedColumns : dataset.columns
  const yearCandidates = profiles
    .filter((profile) => profile.kind === 'year' && profile.nonEmpty > 0)
    .map((profile) => profile.name)
  const yearColumn = choosePreferredColumn(
    yearCandidates,
    [/出願日|最先出願日|優先日|公開日|登録日|year|date/i],
    yearCandidates[0] ?? '',
  )
  const preferredAxisColumns = fallbackColumns.filter((column) => column !== yearColumn)
  const xCandidates = preferredAxisColumns.length > 0 ? preferredAxisColumns : fallbackColumns
  const xAxis = choosePreferredColumn(
    xCandidates,
    [/\bic\b|ipc/i, /\bfi\b|fi分類/i, /fターム|fterm|ftm/i, /技術カテゴリ|カテゴリ|theme|tag/i, /\bpcl\b/i],
    xCandidates[0] ?? '',
  )
  const preferredYColumns = fallbackColumns.filter((column) => column !== xAxis && column !== yearColumn)
  const yCandidates =
    preferredYColumns.length > 0 ? preferredYColumns : fallbackColumns.filter((column) => column !== xAxis)
  const yAxis = choosePreferredColumn(
    yCandidates,
    [/正規化出願人|normalizedapplicant|npa/i, /出願人|assignee|applicant|権利者/i, /会社|企業|発明者|inventor/i],
    yCandidates[0] ?? fallbackColumns[0] ?? '',
  )
  const nonAxisColumns = fallbackColumns.filter((column) => column !== xAxis && column !== yAxis)
  const dedicatedPieColumns = nonAxisColumns.filter((column) => column !== yearColumn)
  const pieSourceMode = dedicatedPieColumns.length === 0 && yearColumn ? 'year_bucket' : 'column'
  const pieCandidates =
    dedicatedPieColumns.length > 0
      ? dedicatedPieColumns
      : fallbackColumns.filter((column) => column !== yearColumn)
  const pieColumn =
    pieSourceMode === 'year_bucket'
      ? ''
      : choosePreferredColumn(
          pieCandidates,
          [
            /\bfi\b|fi分類/i,
            /fターム|fterm|ftm/i,
            /\bic\b|ipc/i,
            /技術カテゴリ|カテゴリ/i,
            /\bpcl\b/i,
            /用途|use|application|purpose|分野|区分/i,
            /出願人|assignee|applicant|権利者|発明者|inventor/i,
          ],
          pieCandidates[0] ?? '',
        )

  const years = findDistinctYears(dataset.rows, yearColumn)
  const boundaries = buildDefaultBoundaries(years)

  return {
    xAxis,
    yAxis,
    yearColumn,
    xLimit: 8,
    yLimit: 8,
    pieSourceMode,
    pieColumn,
    columnSliceStrategy: 'top_n_with_other',
    pieTopN: 5,
    periodStart: '',
    periodEnd: '',
    yearBucketMode: 'recent_vs_other',
    periodBoundaries: boundaries.join(', '),
    recentYears: 5,
    includeAxisOther: false,
    showCounts: false,
    classificationSplitMode: 'all',
    xClassificationLevel: 'full',
    yClassificationLevel: 'full',
    pieClassificationLevel: 'full',
  }
}
