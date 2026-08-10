import { describe, expect, it } from 'vitest'
import { getMatrixSvgSize, renderMatrixSvg, renderMatrixSvgDocument, SvgPresentationError } from './renderSvg'
import { parseSvg, readPngMetadata, renderSvgPng } from './svgVisualTestSupport'
import type { MatrixResult } from '../lib/types'

const result: MatrixResult = {
  xCategories: ['G01N & test'],
  yCategories: ['A社 <研究>'],
  cells: [
    {
      xLabel: 'G01N & test',
      yLabel: 'A社 <研究>',
      total: 2,
      rowCount: 2,
      slices: [
        { label: '検査', value: 1, share: 0.5, color: '#0072b2' },
        { label: '評価', value: 1, share: 0.5, color: '#d55e00' },
      ],
    },
  ],
  topCells: [],
  legend: [
    { label: '検査', color: '#0072b2' },
    { label: '評価', color: '#d55e00' },
  ],
  totalRows: 2,
  scopedRows: 2,
  includedRows: 2,
  pieExcludedRows: 0,
  axisBlankRows: 0,
  axisOtherRows: 0,
  axisExcludedRows: 0,
  maxTotal: 2,
  summary: '2件を集計',
  warnings: [],
}

const metadata = {
  sourceName: 'input.csv',
  xAxisName: 'IPC分類',
  yAxisName: '出願人',
  periodLabel: '集計期間：2020〜2025年',
  cliVersion: '0.1.0',
  resultJsonAvailable: true,
  countDisplay: 'automatic' as const,
}

describe('renderMatrixSvg', () => {
  it('renders a deterministic standalone SVG at the chart size', () => {
    const first = renderMatrixSvg(result)
    const second = renderMatrixSvg(result)
    const size = getMatrixSvgSize(result)

    expect(first).toBe(second)
    expect(first).toContain('<svg')
    expect(first).toContain(`width="${size.width}"`)
    expect(first).toContain(`height="${size.height}"`)
    const textContent = parseSvg(first).document.documentElement!.textContent
    expect(textContent).toContain('G01N & tes')
    expect(textContent).toContain('\nt')
    expect(textContent).toContain('A社 <研究>')
    expect(textContent).toContain('検査')
    expect(textContent).toContain('評価')
  })

  it('wraps long legend labels without synthetic legend numbers', () => {
    const longLabel = '極めて長い分類名でSVGの凡例領域を越える可能性がある項目'
    const svg = renderMatrixSvg({ ...result, legend: [{ label: longLabel, color: '#0072b2' }] })
    const parsed = parseSvg(svg)

    expect(parsed.document.documentElement!.textContent).toContain(longLabel)
    expect(svg).toContain(`<title>${longLabel}</title>`)
    expect(svg).not.toContain('L1 ')
  })

  it('embeds standalone context, accessibility names, and canonical render metadata', () => {
    const rendered = renderMatrixSvgDocument(result, metadata)
    const parsed = parseSvg(rendered.svg)
    const root = parsed.document.documentElement!

    expect(root.getAttribute('role')).toBe('img')
    expect(root.getAttribute('aria-labelledby')).toBe('bubble-matrix-map-title bubble-matrix-map-description')
    expect(rendered.svg).toContain('<title id="bubble-matrix-map-title">input.csvのバブルマトリクスマップ</title>')
    expect(rendered.svg).toContain('X軸：IPC分類')
    expect(rendered.svg).toContain('Y軸：出願人')
    expect(rendered.svg).toContain('集計期間：2020〜2025年')
    expect(rendered.svg).toContain('CLI v0.1.0')
    expect(rendered.svg).toContain('&quot;renderContractVersion&quot;:2')
    expect(rendered.svg).toContain(
      '<desc id="bubble-matrix-map-description">input.csvのバブルマトリクスマップ。X軸はIPC分類、Y軸は出願人です。集計期間：2020〜2025年。バブルサイズは件数の相対的な多さ、円内の区分は分類構成を表します。2件を表示し、0件を除外しました。件数表示は描画条件に従います。詳細は同時生成した結果JSONで確認できます。</desc>',
    )
    expect(rendered.svg).toContain('aria-label="円グラフの凡例"')
    expect(rendered.width).toBe(parsed.width)
    expect(rendered.height).toBe(parsed.height)
  })

  it('explains the optional top-right count badges only when they are shown', () => {
    const hiddenSvg = renderMatrixSvg(result, { ...metadata, countDisplay: 'hidden' })
    const shownSvg = renderMatrixSvg(result, { ...metadata, countDisplay: 'shown' })

    expect(hiddenSvg).not.toContain('セル右上：件数')
    expect(shownSvg).toContain('セル右上：件数')
    expect(parseSvg(shownSvg).document.documentElement!.textContent).toContain('件数バッジを表示しています。')
  })

  it('switches from wrapped axis labels to a complete mapping table after 30 graphemes', () => {
    const thirty = 'あ'.repeat(30)
    const thirtyOne = '界'.repeat(31)
    const shortSvg = renderMatrixSvg({
      ...result,
      xCategories: [thirty],
      cells: [{ ...result.cells[0], xLabel: thirty }],
    })
    const longSvg = renderMatrixSvg({
      ...result,
      xCategories: [thirtyOne],
      cells: [{ ...result.cells[0], xLabel: thirtyOne }],
    })

    expect(shortSvg).not.toContain('X軸カテゴリ対応表')
    expect(longSvg).toContain('X軸カテゴリ対応表')
    expect(longSvg).toContain('>X1</text>')
    expect(parseSvg(longSvg).document.documentElement!.textContent).toContain(thirtyOne)
  })

  it('avoids a generated axis code that collides with an original short category', () => {
    const longLabel = '長'.repeat(31)
    const svg = renderMatrixSvg({
      ...result,
      xCategories: [longLabel, 'X1'],
      cells: [{ ...result.cells[0], xLabel: longLabel }],
    })

    expect(svg).toContain('>_X1</text>')
  })

  it('accepts a 120-grapheme category and rejects 121 without reflecting its value', () => {
    const accepted = '界'.repeat(120)
    const rejected = '秘'.repeat(121)

    expect(() => renderMatrixSvg({ ...result, xCategories: [accepted], cells: [] })).not.toThrow()
    expect(() => renderMatrixSvg({ ...result, xCategories: [rejected], cells: [] })).toThrowError(
      expect.objectContaining({ code: 'LABEL_TOO_LONG' }),
    )
    try {
      renderMatrixSvg({ ...result, xCategories: [rejected], cells: [] })
      throw new Error('expected a presentation error')
    } catch (error) {
      expect((error as Error).message).not.toContain(rejected)
    }
  })

  it('keeps a schema-valid 512-grapheme axis name visibly available', async () => {
    const longAxisName = '界'.repeat(512)
    const svg = renderMatrixSvg(result, { ...metadata, xAxisName: longAxisName })
    const parsed = parseSvg(svg)
    const png = await renderSvgPng(svg)

    expect(parsed.document.documentElement!.textContent).toContain(longAxisName)
    expect(svg).toContain('表示条件（完全名）')
    expect(await readPngMetadata(png)).toMatchObject({ width: parsed.width, height: parsed.height })
  })

  it('includes CLI version and artifact identity in the aggregate text budget', () => {
    const rejected = '秘'.repeat(25_001)

    expect(() => renderMatrixSvg(result, { ...metadata, cliVersion: rejected })).toThrowError(
      expect.objectContaining({ code: 'SVG_DIMENSION_LIMIT' }),
    )
    expect(() => renderMatrixSvg(result, { ...metadata, artifactId: rejected })).toThrowError(
      expect.objectContaining({ code: 'SVG_DIMENSION_LIMIT' }),
    )
  })

  it('uses one legend column through six items and two columns from seven through twelve', () => {
    const createLegend = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ label: `分類${index + 1}`, color: '#0072b2' }))
    const widthAtOne = getMatrixSvgSize({ ...result, legend: createLegend(1) }).width
    const widthAtSix = getMatrixSvgSize({ ...result, legend: createLegend(6) }).width
    const widthAtSeven = getMatrixSvgSize({ ...result, legend: createLegend(7) }).width
    const widthAtTwelve = getMatrixSvgSize({ ...result, legend: createLegend(12) }).width

    expect(widthAtSix).toBe(widthAtOne)
    expect(widthAtSeven).toBeGreaterThan(widthAtSix)
    expect(widthAtTwelve).toBe(widthAtSeven)
    expect(parseSvg(renderMatrixSvg({ ...result, legend: createLegend(12) })).document.documentElement!.textContent).toContain(
      '分類12',
    )
  })

  it('uses the same deterministic pattern indices in pie slices and twelve legend swatches', () => {
    const legend = Array.from({ length: 12 }, (_, index) => ({
      label: `分類${index + 1}`,
      color: '#648fff',
    }))
    const slices = legend.map((item) => ({
      ...item,
      value: 1,
      share: 1 / legend.length,
    }))
    const svg = renderMatrixSvg({
      ...result,
      legend,
      cells: [{ ...result.cells[0], total: 12, rowCount: 12, slices }],
      maxTotal: 12,
    })
    const imageHref = svg.match(/<image href="([^"]+)"/)?.[1]

    expect(imageHref).toBeDefined()
    const embeddedPieSvg = decodeURIComponent(imageHref!.replace('data:image/svg+xml;charset=UTF-8,', ''))
    for (let index = 0; index < 12; index += 1) {
      expect(svg).toContain(`id="legend-pattern-${index}"`)
      expect(svg).toContain(`fill="url(#legend-pattern-${index})"`)
      expect(embeddedPieSvg).toContain(`id="slice-pattern-${index}"`)
      expect(embeddedPieSvg).toContain(`fill="url(#slice-pattern-${index})"`)
    }
  })

  it('rejects dimensions above the resource limit before rendering', () => {
    const xCategories = Array.from({ length: 45 }, (_, index) => `X${index + 1}`)

    expect(() => renderMatrixSvg({ ...result, xCategories, cells: [] })).toThrowError(SvgPresentationError)
    try {
      renderMatrixSvg({ ...result, xCategories, cells: [] })
      throw new Error('expected a presentation error')
    } catch (error) {
      expect(error).toMatchObject({ code: 'SVG_DIMENSION_LIMIT' })
    }
  })

  it('rejects a document above the height limit', () => {
    const yCategories = Array.from({ length: 170 }, (_, index) => `Y${index + 1}`)

    expect(() => renderMatrixSvg({ ...result, yCategories, cells: [] })).toThrowError(
      expect.objectContaining({ code: 'SVG_DIMENSION_LIMIT' }),
    )
  })

  it('rejects aggregate SVG text above the resource budget before layout', () => {
    const yCategories = Array.from(
      { length: 210 },
      (_, index) => `${String(index).padStart(3, '0')}${'界'.repeat(117)}`,
    )

    expect(() => renderMatrixSvg({ ...result, yCategories, cells: [] })).toThrowError(
      expect.objectContaining({
        code: 'SVG_DIMENSION_LIMIT',
        message: expect.stringContaining('表示テキスト量'),
      }),
    )
  })

  it('counts emoji sequences by grapheme when applying the axis code boundary', () => {
    const family = '👨‍👩‍👧‍👦'
    const thirty = family.repeat(30)
    const thirtyOne = family.repeat(31)

    expect(renderMatrixSvg({ ...result, xCategories: [thirty], cells: [] })).not.toContain('X軸カテゴリ対応表')
    expect(renderMatrixSvg({ ...result, xCategories: [thirtyOne], cells: [] })).toContain('X軸カテゴリ対応表')
  })

  it('derives exclusions from total and included rows without double-counting overlapping reasons', () => {
    const svg = renderMatrixSvg(
      {
        ...result,
        totalRows: 10,
        includedRows: 6,
        axisExcludedRows: 5,
        pieExcludedRows: 4,
      },
      metadata,
    )

    expect(svg).toContain('入力10件、表示6件、除外4件')
    expect(svg).toContain('6件を表示し、4件を除外しました。')
  })
})
