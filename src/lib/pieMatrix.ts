import type {
  ClassificationLevel,
  ClassificationSplitMode,
  ColumnSliceStrategy,
  DataRow,
  MatrixCell,
  MatrixResult,
  MatrixSettings,
  MatrixSlice,
  StructuredNotice,
} from './types'
import { formatClassificationValue, isClassificationColumnName, isYearishColumnName, splitMultiValueCell } from './columnSemantics'

const palette = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#6f4e7c',
  '#0f766e',
  '#b91c1c',
  '#2f6f7e',
  '#7c3aed',
  '#64748b',
]

const BLANK_LABEL = '(空白)'
const AXIS_OTHER_LABEL = 'その他（上位外）'
const MIN_AXIS_LIMIT = 1
const MAX_AXIS_LIMIT = 20
const MIN_PIE_TOP_N = 2
const MAX_PIE_TOP_N = 12
const MIN_RECENT_YEARS = 2
const MAX_RECENT_YEARS = 15

function compareCodeUnit(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function formatFixedInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function getCell(row: DataRow, column: string): string {
  const value = row[column]?.trim()
  return value && value.length > 0 ? value : BLANK_LABEL
}

function normalizeLabelsForColumn(
  value: string,
  column: string,
  classificationLevel: ClassificationLevel,
  splitMode: ClassificationSplitMode,
): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  if (!isClassificationColumnName(column)) return [trimmed]

  const labels = splitMultiValueCell(trimmed)
  const selectedLabels = splitMode === 'first' ? labels.slice(0, 1) : labels
  return Array.from(new Set(selectedLabels.map((label) => formatClassificationValue(label, classificationLevel)).filter(Boolean)))
}

function getAxisLabels(row: DataRow, column: string, classificationLevel: ClassificationLevel, splitMode: ClassificationSplitMode): string[] {
  const value = row[column]?.trim() ?? ''
  if (!value) return []
  return normalizeLabelsForColumn(value, column, classificationLevel, splitMode)
}

function getPieLabels(row: DataRow, column: string, classificationLevel: ClassificationLevel, splitMode: ClassificationSplitMode): string[] {
  const value = row[column]?.trim() ?? ''
  if (!value) return [BLANK_LABEL]
  const labels = normalizeLabelsForColumn(value, column, classificationLevel, splitMode)
  return labels.length > 0 ? labels : [BLANK_LABEL]
}

export function extractYear(value: string): number | null {
  const matched = value.match(/(?:^|[^A-Za-z0-9])((?:19|20)\d{2})(?=$|[^A-Za-z0-9])/)
  return matched ? Number(matched[1]) : null
}

function parseBoundedInt(value: number, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

export function findDistinctYears(rows: DataRow[], column: string): number[] {
  return Array.from(
    new Set(
      rows
        .map((row) => extractYear(row[column] ?? ''))
        .filter((year): year is number => typeof year === 'number'),
    ),
  ).sort((left, right) => left - right)
}

export function buildDefaultBoundaries(years: number[]): number[] {
  if (years.length === 0) return [2012, 2016, 2020]
  const minYear = years[0]
  const maxYear = years[years.length - 1]
  const span = Math.max(4, maxYear - minYear + 1)
  const step = Math.max(1, Math.ceil(span / 4))
  const boundaries = [minYear + step - 1, minYear + step * 2 - 1, minYear + step * 3 - 1]
  return boundaries.reduce<number[]>((result, boundary, index) => {
    const previous = result[index - 1]
    const candidate = Math.max(boundary, previous ? previous + 1 : boundary)
    result.push(candidate)
    return result
  }, [])
}

function topCategories(rows: DataRow[], column: string, limit: number, classificationLevel: ClassificationLevel, splitMode: ClassificationSplitMode): string[] {
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    getAxisLabels(row, column, classificationLevel, splitMode).forEach((key) => {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
  })
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || compareCodeUnit(left[0], right[0]))
    .slice(0, limit)
    .map(([label]) => label)
}

function projectAxisLabels(labels: string[], topLabels: string[], includeOther: boolean): string[] {
  const topSet = new Set(topLabels)
  const projected = labels.filter((label) => topSet.has(label))
  if (includeOther && labels.some((label) => !topSet.has(label))) {
    projected.push(AXIS_OTHER_LABEL)
  }
  return Array.from(new Set(projected))
}

function withOther(
  items: Array<{ label: string; value: number }>,
  strategy: ColumnSliceStrategy,
  topN: number,
): Array<{ label: string; value: number }> {
  if (items.length <= topN) return items
  if (strategy === 'top_n_only') return items.slice(0, topN)
  const head = items.slice(0, topN)
  const otherValue = items.slice(topN).reduce((sum, item) => sum + item.value, 0)
  return [...head, { label: 'その他', value: otherValue }]
}

export function parseYearBoundaries(text: string, fallbackYears: number[]): number[] {
  const parsed = Array.from(
    new Set(
      text
        .split(/[,\n、]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => Number(part))
        .filter((value) => Number.isFinite(value)),
    ),
  ).sort((left, right) => left - right)
  if (parsed.length > 0) return parsed.slice(0, 3)
  return buildDefaultBoundaries(fallbackYears)
}

export function buildYearPeriodLabels(boundariesText: string, fallbackYears: number[]): string[] {
  const boundaries = parseYearBoundaries(boundariesText, fallbackYears)
  const labels = [`${boundaries[0]}年以前`]
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    labels.push(`${boundaries[index] + 1}〜${boundaries[index + 1]}年`)
  }
  labels.push(`${boundaries[boundaries.length - 1] + 1}年以降`)
  return labels.reverse()
}

function buildColorMap(labels: string[]): Map<string, string> {
  const colorMap = new Map<string, string>()
  labels.forEach((label, index) => {
    colorMap.set(label, palette[index % palette.length])
  })
  if (labels.includes('その他')) colorMap.set('その他', '#b8b2a5')
  return colorMap
}

function createSlices(items: Array<{ label: string; value: number }>, colorMap: Map<string, string>): MatrixSlice[] {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return items.map((item) => ({
    label: item.label,
    value: item.value,
    share: total > 0 ? item.value / total : 0,
    color: colorMap.get(item.label) ?? palette[0],
  }))
}

function sortColumnItems(items: Array<{ label: string; value: number }>, column: string): Array<{ label: string; value: number }> {
  const yearLabelCount = items.filter((item) => extractYear(item.label) !== null).length
  const isYearColumn = items.length > 0 && (isYearishColumnName(column) || yearLabelCount / items.length >= 0.8)
  if (isYearColumn) {
    return [...items].sort((left, right) => {
      const leftYear = extractYear(left.label) ?? Number.NEGATIVE_INFINITY
      const rightYear = extractYear(right.label) ?? Number.NEGATIVE_INFINITY
      return rightYear - leftYear || compareCodeUnit(left.label, right.label)
    })
  }
  return [...items].sort((left, right) => right.value - left.value || compareCodeUnit(left.label, right.label))
}

function filterRowsByRange(rows: DataRow[], yearColumn: string, periodStart: string, periodEnd: string): DataRow[] {
  const normalizedStart = periodStart.trim()
  const normalizedEnd = periodEnd.trim()
  if (!normalizedStart || !normalizedEnd) return rows
  const start = Number(normalizedStart)
  const end = Number(normalizedEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return rows
  const lower = Math.min(start, end)
  const upper = Math.max(start, end)
  return rows.filter((row) => {
    const year = extractYear(row[yearColumn] ?? '')
    return year !== null && year >= lower && year <= upper
  })
}

function buildColumnSlices(
  rows: DataRow[],
  settings: MatrixSettings,
  legendLabels: string[],
  colorMap: Map<string, string>,
): MatrixSlice[] {
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    getPieLabels(row, settings.pieColumn, settings.pieClassificationLevel, settings.classificationSplitMode).forEach((label) => {
      counts.set(label, (counts.get(label) ?? 0) + 1)
    })
  })
  const headLabels = legendLabels.filter((label) => label !== 'その他')
  const items = headLabels
    .map((label) => ({ label, value: counts.get(label) ?? 0 }))
    .filter((item) => item.value > 0)

  if (settings.columnSliceStrategy === 'top_n_with_other' && legendLabels.includes('その他')) {
    const otherValue = Array.from(counts.entries())
      .filter(([label]) => !headLabels.includes(label))
      .reduce((sum, [, value]) => sum + value, 0)
    if (otherValue > 0) items.push({ label: 'その他', value: otherValue })
  }

  return createSlices(items, colorMap)
}

function buildYearPeriodSlices(rows: DataRow[], yearColumn: string, boundariesText: string, fallbackYears: number[], colorMap: Map<string, string>): MatrixSlice[] {
  const boundaries = parseYearBoundaries(boundariesText, fallbackYears)
  const counts = Array.from({ length: boundaries.length + 1 }, () => 0)
  rows.forEach((row) => {
    const year = extractYear(row[yearColumn] ?? '')
    if (year === null) return
    const bucketIndex = boundaries.findIndex((boundary) => year <= boundary)
    counts[bucketIndex === -1 ? boundaries.length : bucketIndex] += 1
  })
  const labels = buildYearPeriodLabels(boundariesText, fallbackYears)
  return createSlices(
    labels
      .map((label, index) => ({ label, value: counts[counts.length - 1 - index] }))
      .filter((item) => item.value > 0),
    colorMap,
  )
}

function buildRecentVsOtherSlices(rows: DataRow[], yearColumn: string, recentYearsText: number, latestYear: number | undefined, colorMap: Map<string, string>): MatrixSlice[] {
  if (latestYear === undefined) return []
  const recentYears = parseBoundedInt(recentYearsText, 5, MIN_RECENT_YEARS, MAX_RECENT_YEARS)
  const recentStart = latestYear - recentYears + 1
  let recentCount = 0
  let olderCount = 0
  rows.forEach((row) => {
    const year = extractYear(row[yearColumn] ?? '')
    if (year === null) return
    if (year >= recentStart) recentCount += 1
    else olderCount += 1
  })
  return createSlices(
    [
      { label: `直近${recentYears}年 (${recentStart}〜${latestYear})`, value: recentCount },
      { label: 'それ以前', value: olderCount },
    ].filter((item) => item.value > 0),
    colorMap,
  )
}

function collectLegendLabels(baseRows: DataRow[], settings: MatrixSettings, visibleYears: number[], latestYearForRecent?: number): string[] {
  if (settings.pieSourceMode === 'column') {
    const counts = new Map<string, number>()
    baseRows.forEach((row) => {
      getPieLabels(row, settings.pieColumn, settings.pieClassificationLevel, settings.classificationSplitMode).forEach((label) => {
        counts.set(label, (counts.get(label) ?? 0) + 1)
      })
    })
    const topN = parseBoundedInt(settings.pieTopN, 5, MIN_PIE_TOP_N, MAX_PIE_TOP_N)
    return withOther(
      sortColumnItems(
        Array.from(counts.entries()).map(([label, value]) => ({ label, value })),
        settings.pieColumn,
      ),
      settings.columnSliceStrategy,
      topN,
    ).map((item) => item.label)
  }

  if (settings.yearBucketMode === 'four_periods') {
    return buildYearPeriodLabels(settings.periodBoundaries, visibleYears)
  }

  const latestYear = latestYearForRecent ?? visibleYears[visibleYears.length - 1]
  if (latestYear === undefined) return []
  const recentYears = parseBoundedInt(settings.recentYears, 5, MIN_RECENT_YEARS, MAX_RECENT_YEARS)
  const recentStart = latestYear - recentYears + 1
  return [`直近${recentYears}年（${recentStart}〜${latestYear}）`, 'それ以前']
}

function buildSummary(
  settings: MatrixSettings,
  includedRows: number,
  scopedRows: number,
  xCategories: string[],
  yCategories: string[],
  legendLabels: string[],
): string {
  const visibleText = `対象${formatFixedInteger(scopedRows)}件中${formatFixedInteger(includedRows)}件`
  if (settings.pieSourceMode === 'column') {
    const filterText =
      settings.periodStart && settings.periodEnd
        ? `対象期間 ${settings.periodStart}〜${settings.periodEnd}年`
        : '全期間'
    return `${filterText}。上位${xCategories.length}×上位${yCategories.length}のセルで、${visibleText}を可視化`
  }

  if (settings.yearBucketMode === 'four_periods') {
    return `出願年を${legendLabels.length}区間に分け、上位${xCategories.length}×上位${yCategories.length}のセルで、${visibleText}を可視化`
  }

  return `直近年とそれ以前を比較し、上位${xCategories.length}×上位${yCategories.length}のセルで、${visibleText}を可視化`
}

function matrixCellKey(xLabel: string, yLabel: string): string {
  return `${yLabel}\u0000${xLabel}`
}

export function buildPieMatrix(rows: DataRow[], settings: MatrixSettings): MatrixResult {
  if (rows.length === 0 || !settings.xAxis || !settings.yAxis) {
    return {
      xCategories: [],
      yCategories: [],
      cells: [],
      topCells: [],
      legend: [],
      totalRows: rows.length,
      scopedRows: 0,
      includedRows: 0,
      pieExcludedRows: 0,
      axisBlankRows: 0,
      axisOtherRows: 0,
      axisExcludedRows: 0,
      maxTotal: 0,
      summary: 'データを読み込むとここにマトリクスマップが表示されます。',
      warnings: [],
    }
  }

  const warnings: StructuredNotice[] = []
  const xLimit = parseBoundedInt(settings.xLimit, 8, MIN_AXIS_LIMIT, MAX_AXIS_LIMIT)
  const yLimit = parseBoundedInt(settings.yLimit, 8, MIN_AXIS_LIMIT, MAX_AXIS_LIMIT)
  const yearValues = findDistinctYears(rows, settings.yearColumn)

  const scopedRows =
    settings.pieSourceMode === 'column'
      ? filterRowsByRange(rows, settings.yearColumn, settings.periodStart, settings.periodEnd)
      : rows.filter((row) => extractYear(row[settings.yearColumn] ?? '') !== null)

  if (settings.pieSourceMode === 'column' && scopedRows.length === 0) {
    warnings.push({
      code: 'NO_ROWS_IN_PERIOD',
      message: '指定期間に該当する行がありません。',
      severity: 'warning',
      field: 'periodStart/periodEnd',
    })
  }
  if (settings.pieSourceMode === 'year_bucket' && scopedRows.length < rows.length) {
    warnings.push({
      code: 'YEAR_MISSING_ROWS_EXCLUDED',
      message: '年が取得できない行は年区分の集計から除外しました。',
      severity: 'warning',
      field: 'yearColumn',
      details: { count: rows.length - scopedRows.length },
    })
  }

  const topXCategories = topCategories(scopedRows, settings.xAxis, xLimit, settings.xClassificationLevel, settings.classificationSplitMode)
  const topYCategories = topCategories(scopedRows, settings.yAxis, yLimit, settings.yClassificationLevel, settings.classificationSplitMode)
  const axisRows = scopedRows.map((row) => {
    const xLabels = getAxisLabels(row, settings.xAxis, settings.xClassificationLevel, settings.classificationSplitMode)
    const yLabels = getAxisLabels(row, settings.yAxis, settings.yClassificationLevel, settings.classificationSplitMode)
    const projectedXLabels = projectAxisLabels(xLabels, topXCategories, settings.includeAxisOther)
    const projectedYLabels = projectAxisLabels(yLabels, topYCategories, settings.includeAxisOther)
    return { row, xLabels, yLabels, projectedXLabels, projectedYLabels }
  })
  const xCategories = [
    ...topXCategories,
    ...(settings.includeAxisOther && axisRows.some((item) => item.xLabels.some((label) => !topXCategories.includes(label))) ? [AXIS_OTHER_LABEL] : []),
  ]
  const yCategories = [
    ...topYCategories,
    ...(settings.includeAxisOther && axisRows.some((item) => item.yLabels.some((label) => !topYCategories.includes(label))) ? [AXIS_OTHER_LABEL] : []),
  ]
  const blankAxisRows = axisRows.filter((item) => item.xLabels.length === 0 || item.yLabels.length === 0).length
  if (blankAxisRows > 0) {
    warnings.push({
      code: 'AXIS_BLANK_ROWS_EXCLUDED',
      message: 'X軸またはY軸が空白の行は、軸カテゴリから除外しました。',
      severity: 'warning',
      details: { count: blankAxisRows },
    })
  }
  const axisOtherRows = axisRows.filter(
    (item) => item.xLabels.some((label) => !topXCategories.includes(label)) || item.yLabels.some((label) => !topYCategories.includes(label)),
  ).length
  const visibleAxisRows = axisRows.filter((item) => item.projectedXLabels.length > 0 && item.projectedYLabels.length > 0)
  const visibleRows = visibleAxisRows.map((item) => item.row)
  const axisExcludedRows = scopedRows.length - visibleRows.length
  const topNExcludedRows = axisRows.filter(
    (item) =>
      item.xLabels.length > 0 &&
      item.yLabels.length > 0 &&
      (item.projectedXLabels.length === 0 || item.projectedYLabels.length === 0),
  ).length
  if (topNExcludedRows > 0 && !settings.includeAxisOther) {
    warnings.push({
      code: 'AXIS_TOP_N_ROWS_EXCLUDED',
      message: '上位カテゴリ外の行は表示セルから除外しました。',
      severity: 'warning',
      details: { count: topNExcludedRows },
    })
  }
  if (axisOtherRows > 0 && settings.includeAxisOther) {
    warnings.push({
      code: 'AXIS_OTHER_GROUPED',
      message: '上位カテゴリ外の分類を「その他（上位外）」にまとめました。',
      severity: 'info',
      details: { count: axisOtherRows },
    })
  }
  const scopedYears = findDistinctYears(scopedRows, settings.yearColumn)
  const legendLabels = collectLegendLabels(visibleRows, settings, scopedYears)
  const colorMap = buildColorMap(legendLabels)
  const latestYear = scopedYears.at(-1) ?? yearValues.at(-1)

  const allowedPieLabels = new Set(legendLabels.filter((label) => label !== 'その他'))
  const representedAxisRows =
    settings.pieSourceMode === 'column' && settings.columnSliceStrategy === 'top_n_only'
      ? visibleAxisRows.filter((item) =>
          getPieLabels(item.row, settings.pieColumn, settings.pieClassificationLevel, settings.classificationSplitMode).some((label) =>
            allowedPieLabels.has(label),
          ),
        )
      : visibleAxisRows
  const representedRows = representedAxisRows.map((item) => item.row)
  const pieExcludedRows = visibleRows.length - representedRows.length
  if (pieExcludedRows > 0) {
    warnings.push({
      code: 'PIE_TOP_N_ROWS_EXCLUDED',
      message: '上位pie分類外の行を表示セルから除外しました。',
      severity: 'warning',
      details: { count: pieExcludedRows },
    })
  }

  const cellRowsByKey = new Map<string, { xLabel: string; yLabel: string; rows: DataRow[] }>()
  representedAxisRows.forEach((item) => {
    item.projectedYLabels.forEach((yLabel) => {
      item.projectedXLabels.forEach((xLabel) => {
        const key = matrixCellKey(xLabel, yLabel)
        const bucket = cellRowsByKey.get(key)
        if (bucket) {
          bucket.rows.push(item.row)
        } else {
          cellRowsByKey.set(key, { xLabel, yLabel, rows: [item.row] })
        }
      })
    })
  })

  const cells: MatrixCell[] = []
  for (const yLabel of yCategories) {
    for (const xLabel of xCategories) {
      const bucket = cellRowsByKey.get(matrixCellKey(xLabel, yLabel))
      if (!bucket) continue
      const cellRows = bucket.rows
      const slices =
        settings.pieSourceMode === 'column'
          ? buildColumnSlices(cellRows, settings, legendLabels, colorMap)
          : settings.yearBucketMode === 'four_periods'
            ? buildYearPeriodSlices(cellRows, settings.yearColumn, settings.periodBoundaries, yearValues, colorMap)
            : buildRecentVsOtherSlices(cellRows, settings.yearColumn, settings.recentYears, latestYear, colorMap)
      const representedTotal = slices.reduce((sum, slice) => sum + slice.value, 0)
      if (representedTotal === 0) continue
      cells.push({ xLabel, yLabel, total: representedTotal, rowCount: cellRows.length, slices })
    }
  }

  if (cells.some((cell) => cell.total !== cell.rowCount)) {
    warnings.push({
      code: 'MULTI_VALUE_FULL_COUNT',
      message: '複数のpie分類を持つ行は、対象行数とは別に分類出現数をフルカウントしました。',
      severity: 'info',
    })
  }
  const sortedCells = [...cells].sort((left, right) => right.total - left.total || compareCodeUnit(left.yLabel, right.yLabel))
  return {
    xCategories,
    yCategories,
    cells,
    topCells: sortedCells.slice(0, 12),
    legend: legendLabels.map((label) => ({ label, color: colorMap.get(label) ?? palette[0] })),
    totalRows: rows.length,
    scopedRows: scopedRows.length,
    includedRows: representedRows.length,
    pieExcludedRows,
    axisBlankRows: blankAxisRows,
    axisOtherRows,
    axisExcludedRows,
    maxTotal: sortedCells[0]?.total ?? 0,
    summary: buildSummary(settings, representedRows.length, scopedRows.length, xCategories, yCategories, legendLabels),
    warnings,
  }
}
