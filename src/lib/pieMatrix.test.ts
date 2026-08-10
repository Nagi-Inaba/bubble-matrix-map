import { describe, expect, it } from 'vitest'
import { buildPieMatrix } from './pieMatrix'
import type { DataRow, MatrixSettings } from './types'

const rows: DataRow[] = [
  { x: 'A61K', y: 'A社', year: '2019', kind: '保湿' },
  { x: 'A61K', y: 'A社', year: '2020', kind: '保湿' },
  { x: 'A61K', y: 'A社', year: '2021', kind: '美白' },
  { x: 'A61K', y: 'A社', year: '2022', kind: 'UV' },
  { x: 'A61Q', y: 'B社', year: '2023', kind: '洗浄' },
  { x: 'A61Q', y: 'B社', year: '2024', kind: '洗浄' },
  { x: 'G01N', y: 'A社', year: '2024', kind: '評価' },
  { x: 'G01N', y: 'A社', year: '2025', kind: '評価' },
]

const baseSettings: MatrixSettings = {
  xAxis: 'x',
  yAxis: 'y',
  yearColumn: 'year',
  xLimit: 3,
  yLimit: 3,
  pieSourceMode: 'column',
  pieColumn: 'kind',
  columnSliceStrategy: 'top_n_with_other',
  pieTopN: 2,
  periodStart: '2019',
  periodEnd: '2024',
  yearBucketMode: 'recent_vs_other',
  periodBoundaries: '2020, 2022, 2024',
  recentYears: 3,
  includeAxisOther: false,
  showCounts: false,
  classificationSplitMode: 'all',
  xClassificationLevel: 'full',
  yClassificationLevel: 'full',
  pieClassificationLevel: 'full',
}

describe('buildPieMatrix', () => {
  it('keeps aggregation identical when only optional count display changes', () => {
    expect(buildPieMatrix(rows, { ...baseSettings, showCounts: true })).toEqual(
      buildPieMatrix(rows, { ...baseSettings, showCounts: false }),
    )
  })

  it('builds globally consistent top-N plus other slices inside each matrix cell', () => {
    const result = buildPieMatrix(rows, baseSettings)
    const targetCell = result.cells.find((cell) => cell.xLabel === 'A61K' && cell.yLabel === 'A社')

    expect(targetCell?.total).toBe(4)
    expect(targetCell?.slices.map((slice) => ({ label: slice.label, value: slice.value }))).toEqual([
      { label: '保湿', value: 2 },
      { label: 'その他', value: 2 },
    ])
    expect(targetCell?.slices.every((slice) => result.legend.some((item) => item.label === slice.label))).toBe(true)
  })

  it('does not apply a year filter when the period is left blank', () => {
    const result = buildPieMatrix(rows, {
      ...baseSettings,
      periodStart: '',
      periodEnd: '',
    })

    expect(result.includedRows).toBe(rows.length)
    expect(result.scopedRows).toBe(rows.length)
    expect(result.cells.length).toBeGreaterThan(0)
    expect(result.summary).toContain('全期間')
  })

  it('keeps period-scoped rows separate from rows visible inside top axis categories', () => {
    const result = buildPieMatrix(rows, {
      ...baseSettings,
      xLimit: 1,
      yLimit: 1,
      periodStart: '',
      periodEnd: '',
    })

    expect(result.scopedRows).toBe(rows.length)
    expect(result.includedRows).toBeLessThan(result.scopedRows)
    expect(result.summary).toContain(`対象${result.scopedRows}件中${result.includedRows}件`)
  })

  it('reports only rows represented by top_n_only pie slices', () => {
    const result = buildPieMatrix(
      [
        { x: 'A', y: 'Y', year: '2024', kind: 'P1' },
        { x: 'A', y: 'Y', year: '2024', kind: 'P1' },
        { x: 'A', y: 'Y', year: '2024', kind: 'P2' },
        { x: 'B', y: 'Y', year: '2024', kind: 'P3' },
      ],
      {
        ...baseSettings,
        xLimit: 3,
        yLimit: 3,
        pieTopN: 2,
        columnSliceStrategy: 'top_n_only',
        periodStart: '',
        periodEnd: '',
      },
    )

    expect(result.scopedRows).toBe(4)
    expect(result.includedRows).toBe(3)
    expect(result.pieExcludedRows).toBe(1)
    expect(result.summary).toContain('対象4件中3件')
    expect(result.cells).toHaveLength(1)
    expect(result.cells[0]?.rowCount).toBe(3)
    expect(result.cells[0]?.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(3)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PIE_TOP_N_ROWS_EXCLUDED', details: { count: 1 } })]),
    )
  })

  it('separates unique rows from full-counted pie occurrences for multi-value classifications', () => {
    const result = buildPieMatrix(
      [
        { x: 'A', y: 'Y', year: '2024', IC: 'A61K-008/02|G01N-033/50' },
        { x: 'A', y: 'Y', year: '2024', IC: 'A61K-008/02' },
        { x: 'A', y: 'Y', year: '2024', IC: 'G01N-033/50' },
      ],
      {
        ...baseSettings,
        pieColumn: 'IC',
        pieTopN: 2,
        columnSliceStrategy: 'top_n_only',
        periodStart: '',
        periodEnd: '',
      },
    )

    expect(result.includedRows).toBe(3)
    expect(result.cells[0]).toMatchObject({ rowCount: 3, total: 4 })
    expect(result.cells[0]?.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(4)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MULTI_VALUE_FULL_COUNT', severity: 'info' })]),
    )
  })

  it('excludes blank axis values from matrix categories', () => {
    const result = buildPieMatrix(
      [
        ...rows,
        { x: 'A61K', y: '', year: '2024', kind: '評価' },
        { x: '', y: 'B社', year: '2024', kind: '評価' },
      ],
      {
        ...baseSettings,
        periodStart: '',
        periodEnd: '',
      },
    )

    expect(result.xCategories).not.toContain('(空白)')
    expect(result.yCategories).not.toContain('(空白)')
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'AXIS_BLANK_ROWS_EXCLUDED', details: { count: 2 } })]),
    )
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'AXIS_TOP_N_ROWS_EXCLUDED' })]),
    )
  })

  it('groups application years into four periods when requested', () => {
    const result = buildPieMatrix(rows, {
      ...baseSettings,
      pieSourceMode: 'year_bucket',
      yearBucketMode: 'four_periods',
      periodBoundaries: '2020, 2022, 2024',
    })
    const targetCell = result.cells.find((cell) => cell.xLabel === 'A61K' && cell.yLabel === 'A社')

    expect(targetCell?.slices.map((slice) => slice.label)).toEqual([
      '2021〜2022年',
      '2020年以前',
    ])
    expect(targetCell?.slices.map((slice) => slice.value)).toEqual([2, 2])
    expect(targetCell?.rowCount).toBe(4)
    expect(targetCell?.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(targetCell?.rowCount)
  })

  it('uses two typed year boundaries instead of falling back to default boundaries', () => {
    const result = buildPieMatrix(rows, {
      ...baseSettings,
      pieSourceMode: 'year_bucket',
      yearBucketMode: 'four_periods',
      periodBoundaries: '2020, 2023',
    })
    const targetCell = result.cells.find((cell) => cell.xLabel === 'A61K' && cell.yLabel === 'A社')

    expect(result.legend.map((item) => item.label)).toEqual(['2024年以降', '2021〜2023年', '2020年以前'])
    expect(result.legend.map((item) => item.label)).not.toContain('2023〜2024年')
    expect(result.summary).toContain('3区間')
    expect(targetCell?.slices.map((slice) => ({ label: slice.label, value: slice.value }))).toEqual([
      { label: '2021〜2023年', value: 2 },
      { label: '2020年以前', value: 2 },
    ])
  })

  it('orders year labels from newest to oldest when a year column is used for pie slices', () => {
    const result = buildPieMatrix(
      [
        { x: 'A61K', y: 'A社', year: '2021', kind: '保湿' },
        { x: 'A61K', y: 'A社', year: '2024', kind: '保湿' },
        { x: 'A61K', y: 'A社', year: '2023', kind: '保湿' },
      ],
      {
        ...baseSettings,
        pieColumn: 'year',
        pieTopN: 3,
      },
    )
    const targetCell = result.cells.find((cell) => cell.xLabel === 'A61K' && cell.yLabel === 'A社')

    expect(result.legend.map((item) => item.label)).toEqual(['2024', '2023', '2021'])
    expect(targetCell?.slices.map((slice) => slice.label)).toEqual(['2024', '2023', '2021'])
  })

  it('splits multi-value patent classification fields when they are used as matrix axes', () => {
    const result = buildPieMatrix(
      [
        { IC: 'A61K-008/02|A61Q-001/00', assignee: 'KAO', year: '2024', kind: '保湿' },
        { IC: 'A61K-008/02', assignee: 'KOSE', year: '2024', kind: '保湿' },
        { IC: 'G01N-033/50|A61Q-001/00', assignee: 'KAO', year: '2024', kind: '評価' },
      ],
      {
        ...baseSettings,
        xAxis: 'IC',
        yAxis: 'assignee',
        xLimit: 4,
        yLimit: 3,
      },
    )

    expect(result.xCategories).toContain('A61K-008/02')
    expect(result.xCategories).toContain('A61Q-001/00')
    expect(result.xCategories).not.toContain('A61K-008/02|A61Q-001/00')
    expect(result.cells.find((cell) => cell.xLabel === 'A61K-008/02' && cell.yLabel === 'KAO')?.rowCount).toBe(1)
    expect(result.cells.find((cell) => cell.xLabel === 'A61Q-001/00' && cell.yLabel === 'KAO')?.rowCount).toBe(2)
  })

  it('keeps multi-value X and Y axis cell combinations after bucketed aggregation', () => {
    const result = buildPieMatrix(
      [
        { IC: 'A61K-008/02|G01N-033/50', FI: 'A61K8/02|G01N33/50', year: '2024', kind: '保湿' },
      ],
      {
        ...baseSettings,
        xAxis: 'IC',
        yAxis: 'FI',
        xLimit: 4,
        yLimit: 4,
      },
    )

    expect(result.cells).toHaveLength(4)
    expect(result.cells.map((cell) => `${cell.yLabel} x ${cell.xLabel}`).sort()).toEqual([
      'A61K8/02 x A61K-008/02',
      'A61K8/02 x G01N-033/50',
      'G01N33/50 x A61K-008/02',
      'G01N33/50 x G01N-033/50',
    ])
    expect(result.cells.every((cell) => cell.rowCount === 1)).toBe(true)
  })

  it('aggregates classification axes at subclass and main-group levels', () => {
    const result = buildPieMatrix(
      [
        { IC: 'A61K-008/02|A61K-008/73', assignee: 'KAO', year: '2024', FI: 'A61K8/02' },
        { IC: 'A61K-031/00', assignee: 'KAO', year: '2024', FI: 'A61K31/00' },
        { IC: 'G01N-033/50', assignee: 'KOSE', year: '2024', FI: 'G01N33/50' },
      ],
      {
        ...baseSettings,
        xAxis: 'IC',
        yAxis: 'assignee',
        pieColumn: 'FI',
        xClassificationLevel: 'subclass',
        pieClassificationLevel: 'main_group',
        xLimit: 4,
        yLimit: 3,
        pieTopN: 4,
      },
    )

    expect(result.xCategories).toEqual(['A61K', 'G01N'])
    expect(result.legend.map((item) => item.label)).toEqual(['A61K31', 'A61K8', 'G01N33'])
    expect(result.cells.find((cell) => cell.xLabel === 'A61K' && cell.yLabel === 'KAO')?.rowCount).toBe(2)
  })

  it('can use only the first classification in multi-value cells', () => {
    const result = buildPieMatrix(
      [
        { IC: 'A61K-008/02|G01N-033/50', assignee: 'KAO', year: '2024', kind: '保湿' },
        { IC: 'G01N-033/50|A61K-008/02', assignee: 'KAO', year: '2024', kind: '評価' },
      ],
      {
        ...baseSettings,
        xAxis: 'IC',
        yAxis: 'assignee',
        classificationSplitMode: 'first',
        xClassificationLevel: 'subclass',
        xLimit: 3,
        yLimit: 3,
      },
    )

    expect(result.xCategories).toEqual(['A61K', 'G01N'])
    expect(result.cells.find((cell) => cell.xLabel === 'A61K')?.rowCount).toBe(1)
    expect(result.cells.find((cell) => cell.xLabel === 'G01N')?.rowCount).toBe(1)
  })

  it('can keep rows outside top categories by grouping them into axis other', () => {
    const result = buildPieMatrix(
      [
        { x: 'A', y: 'KAO', year: '2024', kind: '保湿' },
        { x: 'B', y: 'KAO', year: '2024', kind: '保湿' },
        { x: 'C', y: 'KAO', year: '2024', kind: '評価' },
      ],
      {
        ...baseSettings,
        xLimit: 1,
        yLimit: 1,
        includeAxisOther: true,
      },
    )

    expect(result.xCategories).toEqual(['A', 'その他（上位外）'])
    expect(result.includedRows).toBe(3)
    expect(result.axisOtherRows).toBe(2)
    expect(result.cells.find((cell) => cell.xLabel === 'その他（上位外）')?.rowCount).toBe(2)
  })

  it('clamps oversized numeric settings in domain logic', () => {
    const manyRows = Array.from({ length: 25 }, (_, index) => ({
      x: `X${index + 1}`,
      y: `Y${index + 1}`,
      year: '2024',
      kind: `K${index + 1}`,
    }))
    const result = buildPieMatrix(manyRows, {
      ...baseSettings,
      xLimit: 999,
      yLimit: 999,
      pieTopN: 999,
      periodStart: '',
      periodEnd: '',
    })

    expect(result.xCategories).toHaveLength(20)
    expect(result.yCategories).toHaveLength(20)
    expect(result.legend).toHaveLength(13)
    expect(result.legend.at(-1)?.label).toBe('その他')
  })

  it('assigns a deterministic twelve-color qualitative palette before pattern rendering', () => {
    const paletteRows = Array.from({ length: 12 }, (_, index) => ({
      x: 'A',
      y: '企業',
      year: '2024',
      kind: `分類${index + 1}`,
    }))
    const result = buildPieMatrix(paletteRows, {
      ...baseSettings,
      pieTopN: 12,
      periodStart: '',
      periodEnd: '',
    })

    expect(result.legend).toHaveLength(12)
    expect(new Set(result.legend.map((item) => item.color))).toHaveLength(12)
    expect(buildPieMatrix(paletteRows, { ...baseSettings, pieTopN: 12, periodStart: '', periodEnd: '' }).legend).toEqual(
      result.legend,
    )
  })

  it('clamps oversized recent-year settings in year-bucket mode', () => {
    const result = buildPieMatrix(
      [
        { x: 'A', y: 'KAO', year: '2000', kind: '保湿' },
        { x: 'A', y: 'KAO', year: '2024', kind: '評価' },
      ],
      {
        ...baseSettings,
        pieSourceMode: 'year_bucket',
        yearBucketMode: 'recent_vs_other',
        recentYears: 999,
      },
    )

    expect(result.legend[0]?.label).toContain('直近15年')
  })

  it('compares recent years against older years', () => {
    const result = buildPieMatrix(rows, {
      ...baseSettings,
      pieSourceMode: 'year_bucket',
      yearBucketMode: 'recent_vs_other',
      recentYears: 2,
    })
    const targetCell = result.cells.find((cell) => cell.xLabel === 'G01N' && cell.yLabel === 'A社')

    expect(targetCell?.slices[0]?.label).toContain('直近2年')
    expect(targetCell?.slices.map((slice) => slice.value)).toEqual([2])
  })

  it('uses the dataset year range, not the visible cell range, for recent-year buckets', () => {
    const result = buildPieMatrix(
      [
        { x: 'A61K', y: 'A社', year: '2018', kind: '保湿' },
        { x: 'A61K', y: 'A社', year: '2019', kind: '保湿' },
        { x: 'G01N', y: 'B社', year: '2025', kind: '評価' },
      ],
      {
        ...baseSettings,
        xLimit: 1,
        yLimit: 1,
        pieSourceMode: 'year_bucket',
        yearBucketMode: 'recent_vs_other',
        recentYears: 2,
      },
    )
    const targetCell = result.cells.find((cell) => cell.xLabel === 'A61K' && cell.yLabel === 'A社')

    expect(result.legend.map((item) => item.label)).toEqual(['直近2年（2024〜2025）', 'それ以前'])
    expect(targetCell?.slices.map((slice) => ({ label: slice.label, value: slice.value }))).toEqual([
      { label: 'それ以前', value: 2 },
    ])
    expect(targetCell?.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(targetCell?.rowCount)
  })
})
