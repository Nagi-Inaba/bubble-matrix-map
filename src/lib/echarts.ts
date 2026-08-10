import type { EChartsOption } from 'echarts'
import type { MatrixCell, MatrixResult, MatrixSlice } from './types'
import { buildSvgPatternDefinition } from './svgPatterns'

type SeriesDatum = MatrixCell & {
  value: [number, number, number]
  cellKey: string
}

const MIN_BUBBLE_RADIUS = 6
const BUBBLE_CELL_PADDING = 6
const MATRIX_CELL_WIDTH = 86
const MATRIX_CELL_HEIGHT = 48
const GRID_LEFT = 196
const GRID_TOP = 142
const GRID_BOTTOM = 104
const GRID_RIGHT_WITH_LEGEND = 276
const GRID_RIGHT_WITH_TWO_COLUMN_LEGEND = 520
const GRID_RIGHT_WITHOUT_LEGEND = 52
const COUNT_BADGE_MARGIN = 4
const COUNT_BADGE_HEIGHT = 16
const COUNT_BADGE_MIN_WIDTH = 22
const COUNT_BADGE_HORIZONTAL_PADDING = 10
const COUNT_BADGE_CHARACTER_WIDTH = 6

type BubbleRadiusInput = {
  rowCount: number
  maxRowCount: number
  cellWidth: number
  cellHeight: number
}

type CountBadgeGeometryInput = {
  centerX: number
  centerY: number
  cellWidth: number
  cellHeight: number
  text: string
}

export type CountBadgeGeometry = {
  x: number
  y: number
  width: number
  height: number
}

export type PieBubbleChartSize = {
  width: number
  height: number
}

export type PieBubbleGeometry = {
  width: number
  height: number
  gridLeft: number
  gridTop: number
  gridBottom: number
  gridRight: number
  gridWidth: number
  gridHeight: number
  cellWidth: number
  cellHeight: number
}

export type PieBubblePresentation = {
  xAxisLabels?: ReadonlyMap<string, string>
  yAxisLabels?: ReadonlyMap<string, string>
  showCounts?: boolean
}

export function escapeTooltipHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatFixedInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function calculateCountBadgeGeometry({
  centerX,
  centerY,
  cellWidth,
  cellHeight,
  text,
}: CountBadgeGeometryInput): CountBadgeGeometry {
  const availableWidth = Math.max(COUNT_BADGE_MIN_WIDTH, cellWidth - COUNT_BADGE_MARGIN * 2)
  const width = Math.min(
    availableWidth,
    Math.max(COUNT_BADGE_MIN_WIDTH, text.length * COUNT_BADGE_CHARACTER_WIDTH + COUNT_BADGE_HORIZONTAL_PADDING),
  )
  const right = centerX + cellWidth / 2 - COUNT_BADGE_MARGIN
  return {
    x: right - width,
    y: centerY - cellHeight / 2 + COUNT_BADGE_MARGIN,
    width,
    height: COUNT_BADGE_HEIGHT,
  }
}

function buildTooltip(cell: MatrixCell): string {
  const slices = cell.slices
    .map((slice) => `${escapeTooltipHtml(slice.label)}: ${formatFixedInteger(slice.value)}件 (${Math.round(slice.share * 100)}%)`)
    .join('<br />')
  const countSummary =
    cell.total === cell.rowCount
      ? `対象行数: ${formatFixedInteger(cell.rowCount)}件`
      : `対象行数: ${formatFixedInteger(cell.rowCount)}件<br />pie分類出現数: ${formatFixedInteger(cell.total)}件`
  return `${escapeTooltipHtml(cell.yLabel)}<br />${escapeTooltipHtml(cell.xLabel)}<br />${countSummary}<br />${slices}`
}

function matrixCellKey(cell: Pick<MatrixCell, 'xLabel' | 'yLabel'>): string {
  return `${cell.yLabel}::${cell.xLabel}`
}

function polarPoint(centerX: number, centerY: number, radius: number, angle: number): [number, number] {
  return [centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)]
}

function buildSliceSvgPath(center: number, radius: number, startAngle: number, endAngle: number): string {
  const [startX, startY] = polarPoint(center, center, radius, startAngle)
  const [endX, endY] = polarPoint(center, center, radius, endAngle)
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} Z`
}

function buildPieSvgDataUri(
  slices: MatrixSlice[],
  radius: number,
  patternIndexByLabel: ReadonlyMap<string, number>,
): string {
  const padding = 2
  const size = Math.ceil(radius * 2 + padding * 2)
  const center = size / 2
  const safeRadius = Math.max(1, radius)
  const patternIndices = Array.from(
    new Set(slices.map((slice) => patternIndexByLabel.get(slice.label) ?? 0)),
  )
  const definitions = patternIndices
    .map((index) => {
      const slice = slices.find((candidate) => (patternIndexByLabel.get(candidate.label) ?? 0) === index)
      return buildSvgPatternDefinition(`slice-pattern-${index}`, slice?.color ?? '#64748b', index)
    })
    .join('')
  const fillFor = (slice: MatrixSlice) =>
    `url(#slice-pattern-${patternIndexByLabel.get(slice.label) ?? 0})`
  const content =
    slices.length === 1
      ? `<circle cx="${center}" cy="${center}" r="${safeRadius}" fill="${fillFor(slices[0])}" stroke="#f8f5ee" stroke-width="1.2" />`
      : slices
          .reduce<{ angle: number; parts: string[] }>(
            (state, slice) => {
              const endAngle = state.angle + slice.share * Math.PI * 2
              state.parts.push(`<path d="${buildSliceSvgPath(center, safeRadius, state.angle, endAngle)}" fill="${fillFor(slice)}" stroke="#f8f5ee" stroke-width="1.2" />`)
              state.angle = endAngle
              return state
            },
            { angle: -Math.PI / 2, parts: [] },
          )
          .parts.join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${definitions}</defs>${content}</svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export function calculateBubbleRadius({ rowCount, maxRowCount, cellWidth, cellHeight }: BubbleRadiusInput): number {
  if (rowCount <= 0) return 0
  const safeRadius = Math.max(0, Math.min(cellWidth, cellHeight) / 2 - BUBBLE_CELL_PADDING)
  const minimumRadius = Math.min(MIN_BUBBLE_RADIUS, safeRadius)
  if (safeRadius <= MIN_BUBBLE_RADIUS || maxRowCount <= 1) return minimumRadius
  const normalized = (Math.min(Math.max(1, rowCount), maxRowCount) - 1) / (maxRowCount - 1)
  return Math.min(safeRadius, minimumRadius + Math.sqrt(normalized) * (safeRadius - minimumRadius))
}

export function getPieBubbleGeometry(result: MatrixResult): PieBubbleGeometry {
  const gridRight =
    result.legend.length > 6
      ? GRID_RIGHT_WITH_TWO_COLUMN_LEGEND
      : result.legend.length > 0
        ? GRID_RIGHT_WITH_LEGEND
        : GRID_RIGHT_WITHOUT_LEGEND
  const gridWidth = Math.max(1, result.xCategories.length) * MATRIX_CELL_WIDTH
  const gridHeight = Math.max(1, result.yCategories.length) * MATRIX_CELL_HEIGHT
  return {
    width: GRID_LEFT + gridRight + gridWidth,
    height: GRID_TOP + GRID_BOTTOM + gridHeight,
    gridLeft: GRID_LEFT,
    gridTop: GRID_TOP,
    gridBottom: GRID_BOTTOM,
    gridRight,
    gridWidth,
    gridHeight,
    cellWidth: MATRIX_CELL_WIDTH,
    cellHeight: MATRIX_CELL_HEIGHT,
  }
}

export function getPieBubbleChartSize(result: MatrixResult): PieBubbleChartSize {
  const geometry = getPieBubbleGeometry(result)
  return { width: geometry.width, height: geometry.height }
}

export function buildPieBubbleOption(
  result: MatrixResult,
  selectedCellKey?: string | null,
  presentation: PieBubblePresentation = {},
): EChartsOption {
  if (result.cells.length === 0) {
    return {
      backgroundColor: '#fffdf8',
      title: {
        text: 'データを読み込み、設定を反映するとマトリクスマップが表示されます。',
        left: 'center',
        top: 'middle',
        textStyle: {
          color: '#6b6a65',
          fontSize: 16,
          fontWeight: 500,
        },
      },
    }
  }

  const data: SeriesDatum[] = result.cells.map((cell) => ({
    ...cell,
    cellKey: matrixCellKey(cell),
    value: [result.xCategories.indexOf(cell.xLabel), result.yCategories.indexOf(cell.yLabel), cell.rowCount],
  }))

  const maxRowCount = Math.max(1, ...result.cells.map((cell) => cell.rowCount))
  const patternIndexByLabel = new Map(result.legend.map((item, index) => [item.label, index]))
  const geometry = getPieBubbleGeometry(result)
  const series = {
    type: 'custom',
    coordinateSystem: 'cartesian2d',
    clip: true,
    data,
    renderItem: (params: unknown, api: {
      coord: (value: [number, number]) => [number, number]
      value: (index: number) => number
      size: (value: [number, number]) => [number, number]
    }) => {
      const dataItem = data[(params as { dataIndex: number }).dataIndex]
      const [centerX, centerY] = api.coord([api.value(0), api.value(1)])
      const [cellWidth, cellHeight] = api.size([1, 1])
      const isSelected = selectedCellKey === dataItem.cellKey
      const radius = calculateBubbleRadius({
        rowCount: dataItem.rowCount,
        maxRowCount,
        cellWidth,
        cellHeight,
      })

      const children: Array<Record<string, unknown>> = [
        {
          type: 'image',
          style: {
            image: buildPieSvgDataUri(dataItem.slices, radius, patternIndexByLabel),
            x: centerX - radius - 2,
            y: centerY - radius - 2,
            width: radius * 2 + 4,
            height: radius * 2 + 4,
          },
        },
      ]

      if (isSelected) {
        children.push({
          type: 'circle',
          shape: { cx: centerX, cy: centerY, r: radius + 2 },
          style: {
            stroke: '#111827',
            lineWidth: 3,
            fill: 'transparent',
            shadowBlur: 8,
            shadowColor: 'rgba(17, 24, 39, 0.22)',
          },
        })
      }

      if (presentation.showCounts) {
        const countText = formatFixedInteger(dataItem.rowCount)
        const badge = calculateCountBadgeGeometry({
          centerX,
          centerY,
          cellWidth,
          cellHeight,
          text: countText,
        })
        children.push({
          type: 'rect',
          shape: { ...badge, r: 3 },
          style: {
            fill: '#fffdf8',
            stroke: '#1f2937',
            lineWidth: 1,
          },
        })
        children.push({
          type: 'text',
          x: badge.x + badge.width / 2,
          y: badge.y + badge.height / 2,
          style: {
            text: countText,
            textAlign: 'center',
            textVerticalAlign: 'middle',
            fontWeight: 700,
            fontSize: 10,
            fontFamily: 'sans-serif',
            fill: '#372f28',
          },
        })
      }

      return {
        type: 'group',
        children,
      }
    },
    tooltip: {
      trigger: 'item',
    },
  }

  return {
    backgroundColor: '#fffdf8',
    animationDuration: 420,
    grid: {
      left: geometry.gridLeft,
      top: geometry.gridTop,
      width: geometry.gridWidth,
      height: geometry.gridHeight,
      show: true,
      borderColor: '#e3ddd2',
      borderWidth: 1,
      backgroundColor: '#fffdf8',
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => buildTooltip((params as { data: MatrixCell }).data),
      backgroundColor: 'rgba(32, 33, 30, 0.94)',
      borderWidth: 0,
      textStyle: {
        color: '#f7f5ef',
        fontSize: 12,
      },
      padding: 12,
    },
    xAxis: {
      type: 'category',
      data: result.xCategories,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#cfc7b8' } },
      splitLine: { show: true, lineStyle: { color: '#e7e0d5', width: 1 } },
      axisLabel: {
        color: '#46443f',
        interval: 0,
        rotate: 0,
        width: 112,
        overflow: 'break',
        lineHeight: 14,
        hideOverlap: false,
        margin: 12,
        formatter: (value: string) => presentation.xAxisLabels?.get(value) ?? value,
      },
    },
    yAxis: {
      type: 'category',
      data: result.yCategories,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#cfc7b8' } },
      splitLine: { show: true, lineStyle: { color: '#e7e0d5', width: 1 } },
      axisLabel: {
        color: '#46443f',
        width: 160,
        overflow: 'break',
        lineHeight: 14,
        margin: 12,
        formatter: (value: string) => presentation.yAxisLabels?.get(value) ?? value,
      },
    },
    series: [series] as unknown as EChartsOption['series'],
  }
}
