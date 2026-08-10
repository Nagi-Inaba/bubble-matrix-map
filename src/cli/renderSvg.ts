import { CustomChart } from 'echarts/charts'
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { init, use as registerEChartsModules } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import {
  buildPieBubbleOption,
  getPieBubbleGeometry,
  type PieBubblePresentation,
} from '../lib/echarts'
import { buildSvgPatternDefinition } from '../lib/svgPatterns'
import type { LegendItem, MatrixResult } from '../lib/types'
import { RENDER_CONTRACT_VERSION } from './artifacts'

registerEChartsModules([GridComponent, TitleComponent, TooltipComponent, CustomChart, SVGRenderer])

const MAX_LABEL_GRAPHEMES = 120
const MAX_SVG_WIDTH = 4096
const MAX_SVG_HEIGHT = 8192
const MAX_SVG_TEXT_GRAPHEMES = 25_000
const AXIS_INLINE_LIMIT = 30
const AXIS_LINE_GRAPHEMES = 10
const LEGEND_LINE_GRAPHEMES = 17
const MIN_DOCUMENT_WIDTH = 760
const TITLE_VISIBLE_LIMIT = 38
const CONTEXT_VISIBLE_LIMIT = 18
const APPENDIX_LINE_HEIGHT = 15
const LEGEND_LINE_HEIGHT = 15
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })

export type SvgDocumentMetadata = {
  sourceName: string
  xAxisName: string
  yAxisName: string
  periodLabel: string
  cliVersion: string
  resultJsonAvailable: boolean
  countDisplay?: 'automatic' | 'hidden' | 'shown'
  artifactId?: string
}

export type RenderedMatrixSvg = {
  svg: string
  width: number
  height: number
}

export class SvgPresentationError extends Error {
  readonly code: 'LABEL_TOO_LONG' | 'SVG_DIMENSION_LIMIT'

  constructor(code: 'LABEL_TOO_LONG' | 'SVG_DIMENSION_LIMIT', message: string) {
    super(message)
    this.name = 'SvgPresentationError'
    this.code = code
  }
}

type AxisAppendixEntry = {
  code: string
  label: string
}

type AxisPresentation = {
  labels: ReadonlyMap<string, string>
  appendix: AxisAppendixEntry[]
}

type LegendRenderItem = {
  item: LegendItem
  lines: string[]
  column: number
  y: number
}

type LegendLayout = {
  items: LegendRenderItem[]
  bottom: number
  columns: number
  columnWidth: number
  startX: number
}

type AppendixColumn = {
  title: string
  entries: Array<AxisAppendixEntry & { lines: string[]; y: number }>
  x: number
  bottom: number
}

type PresentationLayout = {
  chart: PieBubblePresentation
  xAppendix: AxisAppendixEntry[]
  yAppendix: AxisAppendixEntry[]
  legend: LegendLayout
  appendixColumns: AppendixColumn[]
  appendixTop: number
  width: number
  height: number
}

function splitGraphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), (part) => part.segment)
}

function countGraphemes(value: string): number {
  return splitGraphemes(value).length
}

function wrapText(value: string, width: number): string[] {
  const characters = splitGraphemes(value)
  if (characters.length === 0) return ['']
  const lines: string[] = []
  for (let index = 0; index < characters.length; index += width) {
    lines.push(characters.slice(index, index + width).join(''))
  }
  return lines
}

function compactText(value: string, limit: number): string {
  const characters = splitGraphemes(value)
  if (characters.length <= limit) return value
  return `${characters.slice(0, Math.max(1, limit - 1)).join('')}…`
}

function assertLabelLengths(result: MatrixResult): void {
  const labels = [...result.xCategories, ...result.yCategories, ...result.legend.map((item) => item.label)]
  const oversizedIndex = labels.findIndex((label) => countGraphemes(label) > MAX_LABEL_GRAPHEMES)
  if (oversizedIndex >= 0) {
    throw new SvgPresentationError(
      'LABEL_TOO_LONG',
      `軸カテゴリまたは凡例の名称は${MAX_LABEL_GRAPHEMES}書記素以内にしてください。対象値は安全のため表示していません。`,
    )
  }
}

function buildAxisPresentation(categories: string[], prefix: 'X' | 'Y'): AxisPresentation {
  const labels = new Map<string, string>()
  const appendix: AxisAppendixEntry[] = []
  const reservedCodes = new Set(categories.filter((label) => countGraphemes(label) <= AXIS_INLINE_LIMIT))
  const usedCodes = new Set<string>()
  categories.forEach((label, index) => {
    if (countGraphemes(label) > AXIS_INLINE_LIMIT) {
      let code = `${prefix}${index + 1}`
      while (reservedCodes.has(code) || usedCodes.has(code)) code = `_${code}`
      usedCodes.add(code)
      labels.set(label, code)
      appendix.push({ code, label })
      return
    }
    labels.set(label, wrapText(label, AXIS_LINE_GRAPHEMES).join('\n'))
  })
  return { labels, appendix }
}

function buildContextAppendix(metadata: SvgDocumentMetadata): AxisAppendixEntry[] {
  const entries: AxisAppendixEntry[] = []
  if (countGraphemes(`${metadata.sourceName}のバブルマトリクスマップ`) > TITLE_VISIBLE_LIMIT) {
    entries.push({ code: '入力', label: metadata.sourceName })
  }
  if (countGraphemes(metadata.xAxisName) > CONTEXT_VISIBLE_LIMIT) {
    entries.push({ code: 'X軸', label: metadata.xAxisName })
  }
  if (countGraphemes(metadata.yAxisName) > CONTEXT_VISIBLE_LIMIT) {
    entries.push({ code: 'Y軸', label: metadata.yAxisName })
  }
  if (countGraphemes(metadata.periodLabel) > CONTEXT_VISIBLE_LIMIT) {
    entries.push({ code: '期間', label: metadata.periodLabel })
  }
  return entries
}

function buildLegendLayout(result: MatrixResult, width: number): LegendLayout {
  const geometry = getPieBubbleGeometry(result)
  const columns = result.legend.length > 6 ? 2 : 1
  const startX = width - geometry.gridRight + 24
  const columnWidth = (geometry.gridRight - 40) / columns
  const rows = Math.ceil(result.legend.length / columns)
  const items: LegendRenderItem[] = []
  let y = geometry.gridTop + 34

  for (let row = 0; row < rows; row += 1) {
    const rowItems: Array<{ item: LegendItem; lines: string[]; column: number }> = []
    for (let column = 0; column < columns; column += 1) {
      const index = row + column * rows
      const item = result.legend[index]
      if (!item) continue
      rowItems.push({ item, lines: wrapText(item.label, LEGEND_LINE_GRAPHEMES), column })
    }
    const rowHeight = Math.max(28, ...rowItems.map((entry) => entry.lines.length * LEGEND_LINE_HEIGHT + 8))
    for (const entry of rowItems) items.push({ ...entry, y })
    y += rowHeight
  }
  return { items, bottom: y, columns, columnWidth, startX }
}

function buildAppendixColumns(
  width: number,
  top: number,
  xAppendix: AxisAppendixEntry[],
  yAppendix: AxisAppendixEntry[],
  contextAppendix: AxisAppendixEntry[],
): AppendixColumn[] {
  if (xAppendix.length === 0 && yAppendix.length === 0 && contextAppendix.length === 0) return []
  const margin = 24
  const gap = 28
  const sources = [
    { title: 'X軸カテゴリ対応表', source: xAppendix, x: margin },
    { title: 'Y軸カテゴリ対応表', source: yAppendix, x: margin },
    { title: '表示条件（完全名）', source: contextAppendix, x: margin },
  ].filter(({ source }) => source.length > 0)
  const columnWidth = (width - margin * 2 - gap * (sources.length - 1)) / sources.length
  const lineWidth = Math.max(
    8,
    Math.min(sources.length === 1 ? 48 : 24, Math.floor((columnWidth - 44) / 12)),
  )
  return sources.map(({ title, source }, columnIndex) => {
    const x = margin + columnIndex * (columnWidth + gap)
    let y = top + 36
    const entries = source.map((entry) => {
      const lines = wrapText(entry.label, lineWidth)
      const rendered = { ...entry, lines, y }
      y += lines.length * APPENDIX_LINE_HEIGHT + 10
      return rendered
    })
    return { title, entries, x, bottom: y }
  })
}

function buildPresentationLayout(result: MatrixResult, metadata: SvgDocumentMetadata): PresentationLayout {
  assertLabelLengths(result)
  const xAxis = buildAxisPresentation(result.xCategories, 'X')
  const yAxis = buildAxisPresentation(result.yCategories, 'Y')
  const contextAppendix = buildContextAppendix(metadata)
  const geometry = getPieBubbleGeometry(result)
  const width = Math.max(MIN_DOCUMENT_WIDTH, geometry.width)
  const legend = buildLegendLayout(result, width)
  const contentBottom = Math.max(geometry.height, legend.bottom + 18)
  const hasAppendix = xAxis.appendix.length > 0 || yAxis.appendix.length > 0 || contextAppendix.length > 0
  const appendixTop = hasAppendix ? contentBottom + 18 : contentBottom
  const appendixColumns = buildAppendixColumns(
    width,
    appendixTop,
    xAxis.appendix,
    yAxis.appendix,
    contextAppendix,
  )
  const appendixBottom = Math.max(appendixTop, ...appendixColumns.map((column) => column.bottom + 18))
  const height = hasAppendix ? appendixBottom : contentBottom

  if (width > MAX_SVG_WIDTH || height > MAX_SVG_HEIGHT) {
    throw new SvgPresentationError(
      'SVG_DIMENSION_LIMIT',
      `SVG寸法が上限（幅${MAX_SVG_WIDTH}px、高さ${MAX_SVG_HEIGHT}px）を超えます。軸カテゴリ数またはラベル長を減らしてください。`,
    )
  }
  return {
    chart: {
      xAxisLabels: xAxis.labels,
      yAxisLabels: yAxis.labels,
      showCounts: metadata.countDisplay === 'shown',
    },
    xAppendix: xAxis.appendix,
    yAppendix: yAxis.appendix,
    legend,
    appendixColumns,
    appendixTop,
    width,
    height,
  }
}

function normalizeGeneratedIds(svg: string): string {
  const replacements = new Map<string, string>()
  let classIndex = 0
  let clipIndex = 0
  return svg
    .replace(/zr\d+-cls-\d+/g, (value) => {
      const replacement = replacements.get(value) ?? `matrix-map-class-${classIndex++}`
      replacements.set(value, replacement)
      return replacement
    })
    .replace(/zr\d+-c\d+/g, (value) => {
      const replacement = replacements.get(value) ?? `matrix-map-clip-${clipIndex++}`
      replacements.set(value, replacement)
      return replacement
    })
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function textLines(x: number, y: number, lines: string[], attributes: string): string {
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : LEGEND_LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
    .join('')
  return `<text x="${x}" y="${y}" ${attributes}>${tspans}</text>`
}

function appendLegend(result: MatrixResult, layout: PresentationLayout): string {
  if (result.legend.length === 0) return ''
  const definitions = result.legend
    .map((item, index) => buildSvgPatternDefinition(`legend-pattern-${index}`, item.color, index))
    .join('')
  const heading = `<text x="${layout.legend.startX}" y="${getPieBubbleGeometry(result).gridTop}" fill="#1f2937" font-size="13" font-weight="700" font-family="Yu Gothic UI, Segoe UI, sans-serif">凡例</text>`
  const items = layout.legend.items
    .map((entry) => {
      const x = layout.legend.startX + entry.column * layout.legend.columnWidth
      const patternIndex = result.legend.indexOf(entry.item)
      return `<g><title>${escapeXml(entry.item.label)}</title><circle cx="${x + 7}" cy="${entry.y - 4}" r="6" fill="url(#legend-pattern-${patternIndex})" stroke="#f8f5ee" stroke-width="1"></circle>${textLines(
        x + 20,
        entry.y,
        entry.lines,
        'fill="#46443f" font-size="12" font-family="Yu Gothic UI, Segoe UI, sans-serif"',
      )}</g>`
    })
    .join('')
  return `<g aria-label="円グラフの凡例"><defs>${definitions}</defs>${heading}${items}</g>`
}

function appendAxisAppendix(layout: PresentationLayout): string {
  if (layout.appendixColumns.length === 0) return ''
  const separator = `<line x1="24" y1="${layout.appendixTop}" x2="${layout.width - 24}" y2="${layout.appendixTop}" stroke="#d8d0c4" stroke-width="1"></line>`
  const columns = layout.appendixColumns
    .map((column) => {
      const heading = `<text x="${column.x}" y="${layout.appendixTop + 20}" fill="#1f2937" font-size="13" font-weight="700" font-family="Yu Gothic UI, Segoe UI, sans-serif">${escapeXml(column.title)}</text>`
      const entries = column.entries
        .map(
          (entry) =>
            `<g><text x="${column.x}" y="${entry.y}" fill="#1f2937" font-size="12" font-weight="700" font-family="Yu Gothic UI, Segoe UI, sans-serif">${escapeXml(entry.code)}</text>${textLines(
              column.x + 34,
              entry.y,
              entry.lines,
              'fill="#46443f" font-size="12" font-family="Yu Gothic UI, Segoe UI, sans-serif"',
            )}</g>`,
        )
        .join('')
      return `<g>${heading}${entries}</g>`
    })
    .join('')
  return `<g aria-label="省略コードと完全なカテゴリ名の対応表">${separator}${columns}</g>`
}

function defaultMetadata(): SvgDocumentMetadata {
  return {
    sourceName: '入力データ',
    xAxisName: 'X軸',
    yAxisName: 'Y軸',
    periodLabel: '集計期間は結果JSONを参照',
    cliVersion: 'unknown',
    resultJsonAvailable: false,
    countDisplay: 'hidden',
  }
}

function buildDescription(result: MatrixResult, metadata: SvgDocumentMetadata): string {
  const resultPath = metadata.resultJsonAvailable ? '詳細は同時生成した結果JSONで確認できます。' : '詳細な結果JSONは生成されていません。'
  const countState =
    metadata.countDisplay === 'shown'
      ? '件数バッジを表示しています。'
      : metadata.countDisplay === 'hidden'
        ? '件数バッジは表示していません。'
        : '件数表示は描画条件に従います。'
  return [
    `${metadata.sourceName}のバブルマトリクスマップ。`,
    `X軸は${metadata.xAxisName}、Y軸は${metadata.yAxisName}です。`,
    `${metadata.periodLabel}。`,
    `バブルサイズは件数の相対的な多さ、円内の区分は分類構成を表します。`,
    `${result.includedRows}件を表示し、${Math.max(0, result.totalRows - result.includedRows)}件を除外しました。`,
    countState,
    resultPath,
  ].join('')
}

function appendDocumentChrome(svg: string, result: MatrixResult, metadata: SvgDocumentMetadata, layout: PresentationLayout): string {
  const geometry = getPieBubbleGeometry(result)
  const title = `${metadata.sourceName}のバブルマトリクスマップ`
  const description = buildDescription(result, metadata)
  const rootTag = svg.match(/^<svg\b[^>]*>/)?.[0]
  if (!rootTag) throw new SvgPresentationError('SVG_DIMENSION_LIMIT', 'SVGルート要素を生成できませんでした。')
  const accessibleRoot = `${rootTag.slice(0, -1)} role="img" aria-labelledby="bubble-matrix-map-title bubble-matrix-map-description">`
  const metadataDocument = JSON.stringify({
    renderContractVersion: RENDER_CONTRACT_VERSION,
    sourceName: metadata.sourceName,
    xAxisName: metadata.xAxisName,
    yAxisName: metadata.yAxisName,
    periodLabel: metadata.periodLabel,
    cliVersion: metadata.cliVersion,
    resultJsonAvailable: metadata.resultJsonAvailable,
    countDisplay: metadata.countDisplay ?? 'automatic',
    ...(metadata.artifactId ? { artifactId: metadata.artifactId } : {}),
  })
  const accessibility = `<title id="bubble-matrix-map-title">${escapeXml(title)}</title><desc id="bubble-matrix-map-description">${escapeXml(description)}</desc><metadata id="bubble-matrix-map-metadata">${escapeXml(metadataDocument)}</metadata>`
  const countMeaning = metadata.countDisplay === 'shown' ? '、セル右上：件数' : ''
  const header = `<g aria-label="図の要約"><text x="24" y="30" fill="#1f2937" font-size="18" font-weight="700" font-family="Yu Gothic UI, Segoe UI, sans-serif">${escapeXml(
    compactText(title, TITLE_VISIBLE_LIMIT),
  )}</text><text x="24" y="54" fill="#46443f" font-size="12" font-family="Yu Gothic UI, Segoe UI, sans-serif">X軸：${escapeXml(
    compactText(metadata.xAxisName, CONTEXT_VISIBLE_LIMIT),
  )}、Y軸：${escapeXml(compactText(metadata.yAxisName, CONTEXT_VISIBLE_LIMIT))}、${escapeXml(
    compactText(metadata.periodLabel, CONTEXT_VISIBLE_LIMIT),
  )}</text><text x="24" y="76" fill="#5f5b54" font-size="12" font-family="Yu Gothic UI, Segoe UI, sans-serif">入力${result.totalRows}件、表示${result.includedRows}件、除外${
    Math.max(0, result.totalRows - result.includedRows)
  }件、CLI v${escapeXml(compactText(metadata.cliVersion, 24))}</text><text x="24" y="98" fill="#5f5b54" font-size="12" font-family="Yu Gothic UI, Segoe UI, sans-serif">バブルサイズ：件数（相対）、円内：分類構成${countMeaning}</text></g>`
  const xAxisTitle = `<text x="${geometry.gridLeft + geometry.gridWidth / 2}" y="${
    geometry.gridTop + geometry.gridHeight + 88
  }" text-anchor="middle" fill="#1f2937" font-size="13" font-weight="700" font-family="Yu Gothic UI, Segoe UI, sans-serif">X軸：${escapeXml(
    compactText(metadata.xAxisName, CONTEXT_VISIBLE_LIMIT),
  )}</text>`
  const yAxisCenter = geometry.gridTop + geometry.gridHeight / 2
  const yAxisTitle = `<text x="26" y="${yAxisCenter}" text-anchor="middle" transform="rotate(-90 26 ${yAxisCenter})" fill="#1f2937" font-size="13" font-weight="700" font-family="Yu Gothic UI, Segoe UI, sans-serif">Y軸：${escapeXml(
    compactText(metadata.yAxisName, 6),
  )}</text>`
  const overlays = `${header}${xAxisTitle}${yAxisTitle}${appendLegend(result, layout)}${appendAxisAppendix(layout)}`
  return svg.replace(rootTag, `${accessibleRoot}${accessibility}`).replace('</svg>', `${overlays}</svg>`)
}

function assertTextBudget(result: MatrixResult, metadata: SvgDocumentMetadata): void {
  const values = [
    ...result.xCategories,
    ...result.yCategories,
    ...result.legend.map((item) => item.label),
    metadata.sourceName,
    metadata.xAxisName,
    metadata.yAxisName,
    metadata.periodLabel,
    metadata.cliVersion,
    ...(metadata.artifactId ? [metadata.artifactId] : []),
  ]
  const total = values.reduce((sum, value) => sum + countGraphemes(value), 0)
  if (total > MAX_SVG_TEXT_GRAPHEMES) {
    throw new SvgPresentationError(
      'SVG_DIMENSION_LIMIT',
      `SVGの表示テキスト量が上限（${MAX_SVG_TEXT_GRAPHEMES}書記素）を超えます。カテゴリ数またはラベル長を減らしてください。`,
    )
  }
}

export function getMatrixSvgSize(
  result: MatrixResult,
  suppliedMetadata?: SvgDocumentMetadata,
): { width: number; height: number } {
  const metadata = suppliedMetadata ?? defaultMetadata()
  assertTextBudget(result, metadata)
  const layout = buildPresentationLayout(result, metadata)
  return { width: layout.width, height: layout.height }
}

export function renderMatrixSvgDocument(
  result: MatrixResult,
  suppliedMetadata?: SvgDocumentMetadata,
): RenderedMatrixSvg {
  const metadata = suppliedMetadata ?? defaultMetadata()
  assertTextBudget(result, metadata)
  const layout = buildPresentationLayout(result, metadata)
  const chart = init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: layout.width,
    height: layout.height,
  })
  try {
    chart.setOption({ ...buildPieBubbleOption(result, null, layout.chart), animation: false })
    const svg = normalizeGeneratedIds(chart.renderToSVGString())
    return {
      svg: appendDocumentChrome(svg, result, metadata, layout),
      width: layout.width,
      height: layout.height,
    }
  } finally {
    chart.dispose()
  }
}

export function renderMatrixSvg(result: MatrixResult, suppliedMetadata?: SvgDocumentMetadata): string {
  return renderMatrixSvgDocument(result, suppliedMetadata).svg
}
