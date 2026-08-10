import { describe, expect, it } from 'vitest'
import { buildPieBubbleOption, calculateBubbleRadius, calculateCountBadgeGeometry, escapeTooltipHtml, getPieBubbleChartSize } from './echarts'
import type { MatrixResult } from './types'

describe('calculateBubbleRadius', () => {
  it('maps 1, 2, and 100 rows to the agreed standard-cell radii', () => {
    const input = { maxRowCount: 100, cellWidth: 86, cellHeight: 48 }

    expect(calculateBubbleRadius({ ...input, rowCount: 1 })).toBeCloseTo(6, 8)
    expect(calculateBubbleRadius({ ...input, rowCount: 2 })).toBeCloseTo(6 + Math.sqrt(1 / 99) * 12, 8)
    expect(calculateBubbleRadius({ ...input, rowCount: 100 })).toBeCloseTo(18, 8)
  })

  it('is strictly monotonic and makes the 100-to-2 diameter ratio visibly distinct', () => {
    const radii = [1, 2, 5, 25, 50, 100].map((rowCount) =>
      calculateBubbleRadius({ rowCount, maxRowCount: 100, cellWidth: 86, cellHeight: 48 }),
    )

    for (let index = 1; index < radii.length; index += 1) {
      expect(radii[index]).toBeGreaterThan(radii[index - 1] ?? 0)
    }
    expect(radii.at(-1)! / radii[1]).toBeGreaterThanOrEqual(2.2)
  })

  it('uses the minimum radius when every cell has one row and shrinks within undersized cells', () => {
    expect(calculateBubbleRadius({ rowCount: 1, maxRowCount: 1, cellWidth: 86, cellHeight: 48 })).toBe(6)
    expect(calculateBubbleRadius({ rowCount: 100, maxRowCount: 100, cellWidth: 20, cellHeight: 20 })).toBe(4)
    expect(calculateBubbleRadius({ rowCount: 0, maxRowCount: 100, cellWidth: 86, cellHeight: 48 })).toBe(0)
  })
})

describe('tooltip safety', () => {
  it('escapes HTML-sensitive characters before returning tooltip markup', () => {
    expect(escapeTooltipHtml(`<img src=x onerror="alert('x')"> & A&B`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; A&amp;B',
    )
  })
})

describe('bubble count badges', () => {
  it('places an opaque bordered badge in the cell top-right without covering the bubble center', () => {
    const badge = calculateCountBadgeGeometry({
      centerX: 200,
      centerY: 160,
      cellWidth: 86,
      cellHeight: 48,
      text: '100,000',
    })

    expect(badge.x + badge.width).toBe(200 + 86 / 2 - 4)
    expect(badge.y).toBe(160 - 48 / 2 + 4)
    expect(badge.y + badge.height).toBeLessThan(160)
    expect(badge.x > 200 || badge.y + badge.height < 160).toBe(true)
  })
})

describe('buildPieBubbleOption', () => {
  it('shows one top-right badge for every non-empty cell only when explicitly enabled', () => {
    const counts = [1, 2, 100]
    const result: MatrixResult = {
      xCategories: ['A', 'B', 'C'],
      yCategories: ['対象'],
      cells: counts.map((rowCount, index) => ({
        xLabel: ['A', 'B', 'C'][index]!,
        yLabel: '対象',
        total: rowCount,
        rowCount,
        slices: [{ label: '分類', value: rowCount, share: 1, color: '#0072b2' }],
      })),
      topCells: [],
      legend: [{ label: '分類', color: '#0072b2' }],
      totalRows: 103,
      scopedRows: 103,
      includedRows: 103,
      pieExcludedRows: 0,
      axisBlankRows: 0,
      axisOtherRows: 0,
      axisExcludedRows: 0,
      maxTotal: 100,
      summary: 'summary',
      warnings: [],
    }
    type RenderedChild = {
      type: string
      x?: number
      y?: number
      shape?: { x: number; y: number; width: number; height: number }
      style?: Record<string, unknown>
    }
    type RenderItem = (
      params: { dataIndex: number },
      api: {
        coord: (value: [number, number]) => [number, number]
        value: (index: number) => number
        size: (value: [number, number]) => [number, number]
      },
    ) => { children: RenderedChild[] }
    const renderChildren = (showCounts: boolean | undefined, dataIndex: number) => {
      const option = buildPieBubbleOption(result, null, { showCounts })
      const series = Array.isArray(option.series) ? option.series[0] : option.series
      const renderItem = (series as unknown as { renderItem: RenderItem }).renderItem
      const values: [number, number, number] = [dataIndex, 0, counts[dataIndex]!]
      return renderItem(
        { dataIndex },
        {
          coord: ([x, y]) => [200 + x * 86, 160 + y * 48],
          value: (index) => values[index]!,
          size: () => [86, 48],
        },
      ).children
    }

    expect(renderChildren(undefined, 0).map((child) => child.type)).toEqual(['image'])
    expect(renderChildren(false, 0).map((child) => child.type)).toEqual(['image'])

    for (const [dataIndex, count] of counts.entries()) {
      const children = renderChildren(true, dataIndex)
      const badge = children.find((child) => child.type === 'rect')
      const label = children.find((child) => child.type === 'text')

      expect(children.map((child) => child.type)).toEqual(['image', 'rect', 'text'])
      expect(badge).toBeDefined()
      expect(label).toBeDefined()
      expect(badge?.style).toMatchObject({ fill: '#fffdf8', stroke: '#1f2937', lineWidth: 1 })
      const badgeShape = badge!.shape!
      expect(badgeShape.y + badgeShape.height).toBeLessThan(160)
      expect(label?.style).toMatchObject({ text: String(count), fill: '#372f28' })
    }
  })

  it('stores represented row count as the bubble magnitude value', () => {
    const result: MatrixResult = {
      xCategories: ['A61K'],
      yCategories: ['A社'],
      cells: [
        {
          xLabel: 'A61K',
          yLabel: 'A社',
          total: 8,
          rowCount: 3,
          slices: [
            { label: '保湿', value: 2, share: 2 / 3, color: '#0f766e' },
            { label: '美白', value: 1, share: 1 / 3, color: '#d97706' },
          ],
        },
      ],
      topCells: [],
      legend: [],
      totalRows: 8,
      scopedRows: 8,
      includedRows: 8,
      pieExcludedRows: 0,
      axisBlankRows: 0,
      axisOtherRows: 0,
      axisExcludedRows: 0,
      maxTotal: 8,
      summary: 'summary',
      warnings: [],
    }

    const option = buildPieBubbleOption(result)
    const series = Array.isArray(option.series) ? option.series[0] : undefined
    const data = Array.isArray(series?.data) ? series.data[0] : undefined

    expect((data as { value: [number, number, number] }).value[2]).toBe(3)
  })

  it('escapes CSV-derived tooltip labels', () => {
    const result: MatrixResult = {
      xCategories: ['<x>'],
      yCategories: ['A&B'],
      cells: [
        {
          xLabel: '<x>',
          yLabel: 'A&B',
          total: 1,
          rowCount: 1,
          slices: [{ label: `bad "quote" 'single'`, value: 1, share: 1, color: '#0f766e' }],
        },
      ],
      topCells: [],
      legend: [],
      totalRows: 1,
      scopedRows: 1,
      includedRows: 1,
      pieExcludedRows: 0,
      axisBlankRows: 0,
      axisOtherRows: 0,
      axisExcludedRows: 0,
      maxTotal: 1,
      summary: 'summary',
      warnings: [],
    }
    const option = buildPieBubbleOption(result)
    const tooltip = option.tooltip as unknown as { formatter: (params: { data: MatrixResult['cells'][number] }) => string }

    expect(tooltip.formatter({ data: result.cells[0] })).toContain('A&amp;B<br />&lt;x&gt;')
    expect(tooltip.formatter({ data: result.cells[0] })).toContain('bad &quot;quote&quot; &#39;single&#39;')
  })

  it('reserves a right-side gutter for the in-chart legend', () => {
    const result: MatrixResult = {
      xCategories: ['A61K', 'A61Q', 'G01N'],
      yCategories: ['A社'],
      cells: [
        {
          xLabel: 'A61K',
          yLabel: 'A社',
          total: 8,
          rowCount: 3,
          slices: [{ label: '保湿', value: 3, share: 1, color: '#0f766e' }],
        },
      ],
      topCells: [],
      legend: [{ label: '保湿', color: '#0f766e' }],
      totalRows: 8,
      scopedRows: 8,
      includedRows: 8,
      pieExcludedRows: 0,
      axisBlankRows: 0,
      axisOtherRows: 0,
      axisExcludedRows: 0,
      maxTotal: 8,
      summary: 'summary',
      warnings: [],
    }

    const option = buildPieBubbleOption(result)
    const grid = option.grid

    expect(Array.isArray(grid) ? grid[0] : grid).toMatchObject({ left: 196, width: 258 })
    expect(getPieBubbleChartSize(result)).toEqual({ width: 730, height: 294 })
  })

  it('uses fixed matrix cell spacing instead of stretching cells to fill the panel', () => {
    const result: MatrixResult = {
      xCategories: ['A61K', 'A61Q', 'G01N', 'B65D'],
      yCategories: ['A社', 'B社', 'C社'],
      cells: [
        {
          xLabel: 'A61K',
          yLabel: 'A社',
          total: 8,
          rowCount: 3,
          slices: [{ label: '保湿', value: 3, share: 1, color: '#0f766e' }],
        },
      ],
      topCells: [],
      legend: [{ label: '保湿', color: '#0f766e' }],
      totalRows: 8,
      scopedRows: 8,
      includedRows: 8,
      pieExcludedRows: 0,
      axisBlankRows: 0,
      axisOtherRows: 0,
      axisExcludedRows: 0,
      maxTotal: 3,
      summary: 'summary',
      warnings: [],
    }

    const option = buildPieBubbleOption(result)
    const grid = Array.isArray(option.grid) ? option.grid[0] : option.grid
    const chartSize = getPieBubbleChartSize(result)

    expect(grid).toMatchObject({ width: 344, height: 144 })
    expect(chartSize).toEqual({ width: 816, height: 390 })
  })

  it('keeps fixed chart margins compact while reserving axis label outer bounds', () => {
    const result: MatrixResult = {
      xCategories: ['A61K', 'A61Q', 'G01N'],
      yCategories: ['長い出願人名'],
      cells: [
        {
          xLabel: 'A61K',
          yLabel: '長い出願人名',
          total: 8,
          rowCount: 3,
          slices: [{ label: '保湿', value: 3, share: 1, color: '#0f766e' }],
        },
      ],
      topCells: [],
      legend: [{ label: '保湿', color: '#0f766e' }],
      totalRows: 8,
      scopedRows: 8,
      includedRows: 8,
      pieExcludedRows: 0,
      axisBlankRows: 0,
      axisOtherRows: 0,
      axisExcludedRows: 0,
      maxTotal: 8,
      summary: 'summary',
      warnings: [],
    }

    const option = buildPieBubbleOption(result)
    const grid = Array.isArray(option.grid) ? option.grid[0] : option.grid

    expect(grid).toMatchObject({
      left: 196,
      top: 142,
      show: true,
      borderColor: '#e3ddd2',
    })
    expect(option.xAxis).toMatchObject({ splitLine: { show: true } })
    expect(option.yAxis).toMatchObject({ splitLine: { show: true } })
  })
})
