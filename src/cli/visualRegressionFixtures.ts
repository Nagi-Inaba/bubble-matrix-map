import type { LegendItem, MatrixCell, MatrixResult, MatrixSlice } from '../lib/types'

const COLORS = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#f0e442',
  '#000000',
  '#6b5b95',
  '#8c6d31',
  '#4d4d4d',
  '#1b9e77',
] as const

function createLegend(count: number, prefix = '分類'): LegendItem[] {
  return Array.from({ length: count }, (_, index) => ({
    label: `${prefix}${index + 1}`,
    color: COLORS[index % COLORS.length] ?? '#4d4d4d',
  }))
}

function createSlices(total: number, legend: LegendItem[]): MatrixSlice[] {
  if (legend.length === 0 || total <= 0) return []
  const base = Math.floor(total / legend.length)
  let remainder = total % legend.length
  const values = legend.map(() => {
    const value = base + (remainder > 0 ? 1 : 0)
    remainder = Math.max(0, remainder - 1)
    return value
  })
  return legend
    .map((item, index) => ({
      label: item.label,
      value: values[index] ?? 0,
      share: (values[index] ?? 0) / total,
      color: item.color,
    }))
    .filter((slice) => slice.value > 0)
}

function createCell(xLabel: string, yLabel: string, total: number, legend: LegendItem[]): MatrixCell {
  return {
    xLabel,
    yLabel,
    total,
    rowCount: total,
    slices: createSlices(total, legend),
  }
}

export function createMatrixResult(overrides: Partial<MatrixResult> = {}): MatrixResult {
  const xCategories = overrides.xCategories ?? ['X1']
  const yCategories = overrides.yCategories ?? ['Y1']
  const legend = overrides.legend ?? createLegend(1)
  const cells = overrides.cells ?? [createCell(xCategories[0] ?? 'X1', yCategories[0] ?? 'Y1', 1, legend)]
  const totalRows = overrides.totalRows ?? cells.reduce((sum, cell) => sum + cell.rowCount, 0)
  return {
    xCategories,
    yCategories,
    cells,
    topCells: overrides.topCells ?? cells.slice(0, 10),
    legend,
    totalRows,
    scopedRows: overrides.scopedRows ?? totalRows,
    includedRows: overrides.includedRows ?? totalRows,
    pieExcludedRows: overrides.pieExcludedRows ?? 0,
    axisBlankRows: overrides.axisBlankRows ?? 0,
    axisOtherRows: overrides.axisOtherRows ?? 0,
    axisExcludedRows: overrides.axisExcludedRows ?? 0,
    maxTotal: overrides.maxTotal ?? Math.max(0, ...cells.map((cell) => cell.total)),
    summary: overrides.summary ?? `${totalRows}件を集計`,
    warnings: overrides.warnings ?? [],
  }
}

export function standardThreeCategoryFixture(): MatrixResult {
  const legend = createLegend(3)
  const xCategories = ['技術A', '技術B', '技術C']
  const yCategories = ['企業1', '企業2']
  const cells = [
    createCell(xCategories[0], yCategories[0], 6, legend),
    createCell(xCategories[1], yCategories[0], 3, legend),
    createCell(xCategories[2], yCategories[1], 1, legend),
  ]
  return createMatrixResult({ xCategories, yCategories, legend, cells, summary: '10件を3分類で集計' })
}

export function longLabelsFixture(): MatrixResult {
  const legend: LegendItem[] = [
    { label: '長い用途分類名で凡例の折返しを検証する項目', color: COLORS[0] },
    { label: '別の長い用途分類名で完全な名称を保持する項目', color: COLORS[1] },
  ]
  const xCategories = [
    '非常に長い技術分類名称でX軸ラベルの表示境界を確認するカテゴリ',
    'LONG-ALPHANUMERIC-CLASSIFICATION-CODE-1234567890-ABCDEFGHIJ',
  ]
  const yCategories = ['非常に長い出願人名称でY軸ラベルの表示境界を確認する企業']
  return createMatrixResult({
    xCategories,
    yCategories,
    legend,
    cells: [createCell(xCategories[0], yCategories[0], 4, legend), createCell(xCategories[1], yCategories[0], 2, legend)],
    summary: '長いラベル6件を集計',
  })
}

export function denseEightByEightFixture(): MatrixResult {
  const legend = createLegend(8)
  const xCategories = Array.from({ length: 8 }, (_, index) => `X分類${index + 1}`)
  const yCategories = Array.from({ length: 8 }, (_, index) => `Y企業${index + 1}`)
  const cells = yCategories.flatMap((yLabel, yIndex) =>
    xCategories.map((xLabel, xIndex) => createCell(xLabel, yLabel, ((xIndex + yIndex) % 8) + 1, legend)),
  )
  return createMatrixResult({ xCategories, yCategories, legend, cells, summary: '8×8の密集ケース' })
}

export function skewedCountsFixture(): MatrixResult {
  const legend = createLegend(3)
  const xCategories = ['多数セル', '少数セル', '最小セル']
  const yCategories = ['比較対象']
  const cells = [
    createCell(xCategories[0], yCategories[0], 100, legend),
    createCell(xCategories[1], yCategories[0], 2, legend),
    createCell(xCategories[2], yCategories[0], 1, legend),
  ]
  return createMatrixResult({ xCategories, yCategories, legend, cells, summary: '100件対2件対1件の偏りケース' })
}

export function legendCardinalityFixture(count: 1 | 3 | 8 | 12): MatrixResult {
  const legend = createLegend(count, '凡例分類')
  const xCategories = [`${count}分類`]
  const yCategories = ['凡例確認']
  return createMatrixResult({
    xCategories,
    yCategories,
    legend,
    cells: [createCell(xCategories[0], yCategories[0], count, legend)],
    summary: `${count}分類の凡例ケース`,
  })
}

export function emptyMatrixFixture(): MatrixResult {
  return createMatrixResult({
    xCategories: [],
    yCategories: [],
    cells: [],
    topCells: [],
    legend: [],
    totalRows: 0,
    scopedRows: 0,
    includedRows: 0,
    maxTotal: 0,
    summary: '表示対象なし',
  })
}

export function yearBucketFixture(): MatrixResult {
  const legend: LegendItem[] = [
    { label: '直近5年（2021〜2025）', color: COLORS[0] },
    { label: 'それ以前', color: COLORS[1] },
  ]
  const xCategories = ['検査技術', '評価技術']
  const yCategories = ['企業A', '企業B']
  const cells = [
    createCell(xCategories[0], yCategories[0], 9, legend),
    createCell(xCategories[1], yCategories[1], 4, legend),
  ]
  return createMatrixResult({
    xCategories,
    yCategories,
    legend,
    cells,
    totalRows: 13,
    summary: '年分類：直近5年（2021〜2025）、それ以前',
  })
}

export function topNOnlyFixture(): MatrixResult {
  const legend: LegendItem[] = [
    { label: '主要用途A', color: COLORS[0] },
    { label: '主要用途B', color: COLORS[1] },
  ]
  const cell: MatrixCell = {
    xLabel: '検査技術',
    yLabel: '企業A',
    total: 8,
    rowCount: 8,
    slices: [
      { label: legend[0].label, value: 5, share: 5 / 8, color: legend[0].color },
      { label: legend[1].label, value: 3, share: 3 / 8, color: legend[1].color },
    ],
  }
  return createMatrixResult({
    xCategories: [cell.xLabel],
    yCategories: [cell.yLabel],
    legend,
    cells: [cell],
    totalRows: 12,
    scopedRows: 12,
    includedRows: 8,
    pieExcludedRows: 4,
    maxTotal: 8,
    summary: '上位2分類のみ表示。4件を除外',
  })
}

export function topNWithOtherFixture(): MatrixResult {
  const legend: LegendItem[] = [
    { label: '主要用途A', color: COLORS[0] },
    { label: '主要用途B', color: COLORS[1] },
    { label: 'その他', color: COLORS[2] },
  ]
  const cell: MatrixCell = {
    xLabel: '検査技術',
    yLabel: '企業A',
    total: 12,
    rowCount: 12,
    slices: [
      { label: legend[0].label, value: 5, share: 5 / 12, color: legend[0].color },
      { label: legend[1].label, value: 3, share: 3 / 12, color: legend[1].color },
      { label: legend[2].label, value: 4, share: 4 / 12, color: legend[2].color },
    ],
  }
  return createMatrixResult({
    xCategories: [cell.xLabel],
    yCategories: [cell.yLabel],
    legend,
    cells: [cell],
    totalRows: 12,
    scopedRows: 12,
    includedRows: 12,
    pieExcludedRows: 0,
    maxTotal: 12,
    summary: '上位2分類とその他を表示',
  })
}

export const visualRegressionFixtures = [
  { name: 'standard-three-category', create: standardThreeCategoryFixture },
  { name: 'long-labels', create: longLabelsFixture },
  { name: 'dense-eight-by-eight', create: denseEightByEightFixture },
  { name: 'skewed-counts', create: skewedCountsFixture },
  { name: 'legend-1', create: () => legendCardinalityFixture(1) },
  { name: 'legend-3', create: () => legendCardinalityFixture(3) },
  { name: 'legend-8', create: () => legendCardinalityFixture(8) },
  { name: 'legend-12', create: () => legendCardinalityFixture(12) },
  { name: 'empty', create: emptyMatrixFixture },
  {
    name: 'year-bucket',
    create: yearBucketFixture,
    metadata: {
      sourceName: 'year-bucket.csv',
      xAxisName: '技術分類',
      yAxisName: '出願人',
      periodLabel: '年分類：直近5年（2021〜2025）、それ以前',
      cliVersion: '0.1.0',
      resultJsonAvailable: true,
      countDisplay: 'hidden' as const,
    },
  },
  { name: 'top-n-only', create: topNOnlyFixture },
  { name: 'top-n-with-other', create: topNWithOtherFixture },
] as const
