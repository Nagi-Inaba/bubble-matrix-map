import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { calculateBubbleRadius } from '../lib/echarts'
import { renderMatrixSvg } from './renderSvg'
import { hasOnlyGrayscalePixels, parseSvg, readPngMetadata, renderSvgGrayscalePng, renderSvgPng } from './svgVisualTestSupport'
import { emptyMatrixFixture, skewedCountsFixture, visualRegressionFixtures } from './visualRegressionFixtures'

type VisualFixture = (typeof visualRegressionFixtures)[number]

const visualReviewDirectory = process.env.BMM_VISUAL_REVIEW_DIR
  ? resolve(process.env.BMM_VISUAL_REVIEW_DIR)
  : undefined

async function exportVisualReview(
  name: string,
  svg: string,
  normalPng: Buffer,
  grayscalePng: Buffer,
): Promise<void> {
  if (!visualReviewDirectory) return
  await mkdir(visualReviewDirectory, { recursive: true })
  await Promise.all([
    writeFile(join(visualReviewDirectory, `${name}.svg`), svg, 'utf8'),
    writeFile(join(visualReviewDirectory, `${name}.png`), normalPng),
    writeFile(join(visualReviewDirectory, `${name}.grayscale.png`), grayscalePng),
  ])
}

function renderFixture(fixture: VisualFixture): string {
  return renderMatrixSvg(fixture.create(), 'metadata' in fixture ? fixture.metadata : undefined)
}

function readBubbleImageGeometry(svg: string): Array<Record<'href' | 'x' | 'y' | 'width' | 'height', string | null>> {
  return Array.from(parseSvg(svg).document.getElementsByTagName('image')).map((image) => ({
    href: image.getAttribute('href'),
    x: image.getAttribute('x'),
    y: image.getAttribute('y'),
    width: image.getAttribute('width'),
    height: image.getAttribute('height'),
  }))
}

describe('SVG visual regression harness', () => {
  it('builds every fixture deterministically', () => {
    for (const fixture of visualRegressionFixtures) {
      expect(fixture.create()).toEqual(fixture.create())
      expect(renderFixture(fixture)).toBe(renderFixture(fixture))
    }
  })

  it('parses and rasterizes the empty state in normal color and grayscale', async () => {
    const svg = renderMatrixSvg(emptyMatrixFixture())
    const parsed = parseSvg(svg)
    const normalPng = await renderSvgPng(svg)
    const grayscalePng = await renderSvgGrayscalePng(svg)
    const normalMetadata = await readPngMetadata(normalPng)
    const grayscaleMetadata = await readPngMetadata(grayscalePng)
    await exportVisualReview('empty', svg, normalPng, grayscalePng)

    expect(normalPng.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(normalMetadata).toMatchObject({ format: 'png', width: parsed.width, height: parsed.height })
    expect(grayscaleMetadata).toMatchObject({ format: 'png', width: parsed.width, height: parsed.height })
    expect(await hasOnlyGrayscalePixels(normalPng)).toBe(false)
    expect(await hasOnlyGrayscalePixels(grayscalePng)).toBe(true)
  })

  for (const fixture of visualRegressionFixtures.filter((candidate) => candidate.name !== 'empty' && candidate.name !== 'dense-eight-by-eight')) {
    it(`${fixture.name} is valid XML and rasterizes without repair`, async () => {
      const svg = renderFixture(fixture)
      const parsed = parseSvg(svg)
      const normalPng = await renderSvgPng(svg)
      const grayscalePng = await renderSvgGrayscalePng(svg)
      await exportVisualReview(fixture.name, svg, normalPng, grayscalePng)

      expect(await readPngMetadata(normalPng)).toMatchObject({ format: 'png', width: parsed.width, height: parsed.height })
      expect(await readPngMetadata(grayscalePng)).toMatchObject({ format: 'png', width: parsed.width, height: parsed.height })
      expect(await hasOnlyGrayscalePixels(normalPng)).toBe(false)
      expect(await hasOnlyGrayscalePixels(grayscalePng)).toBe(true)
    })
  }

  it('dense-eight-by-eight is valid XML and rasterizes without repair', async () => {
    const fixture = visualRegressionFixtures.find((candidate) => candidate.name === 'dense-eight-by-eight')
    if (!fixture) throw new Error('Missing dense visual regression fixture.')
    const svg = renderMatrixSvg(fixture.create())
    const parsed = parseSvg(svg)
    const normalPng = await renderSvgPng(svg)
    const grayscalePng = await renderSvgGrayscalePng(svg)
    await exportVisualReview('dense-eight-by-eight', svg, normalPng, grayscalePng)

    expect(await readPngMetadata(normalPng)).toMatchObject({ format: 'png', width: parsed.width, height: parsed.height })
    expect(await readPngMetadata(grayscalePng)).toMatchObject({ format: 'png', width: parsed.width, height: parsed.height })
    expect(await hasOnlyGrayscalePixels(normalPng)).toBe(false)
    expect(await hasOnlyGrayscalePixels(grayscalePng)).toBe(true)
  })

  it('renders the year-bucket production metadata in visible text and SVG metadata', () => {
    const fixture = visualRegressionFixtures.find((candidate) => candidate.name === 'year-bucket')
    if (!fixture) throw new Error('Missing year-bucket visual regression fixture.')
    const svg = renderFixture(fixture)
    const parsed = parseSvg(svg)

    expect(parsed.document.documentElement!.textContent).toContain('年分類：直近5年（2021〜2025）、それ以前')
    expect(parsed.document.documentElement!.textContent).toContain('CLI v0.1.0')
    expect(svg).toContain('&quot;periodLabel&quot;:&quot;年分類：直近5年（2021〜2025）、それ以前&quot;')
    expect(svg).toContain('&quot;resultJsonAvailable&quot;:true')
  })

  it('keeps long document metadata visible in the rasterized SVG', async () => {
    const axisName = `研究領域${'詳細分類'.repeat(30)}`
    const svg = renderMatrixSvg(visualRegressionFixtures[0].create(), {
      sourceName: `${'長い入力ファイル名'.repeat(8)}.csv`,
      xAxisName: axisName,
      yAxisName: `出願主体${'正式名称'.repeat(20)}`,
      periodLabel: '集計期間：2020〜2025年',
      cliVersion: '0.1.0',
      resultJsonAvailable: true,
      countDisplay: 'automatic',
    })
    const parsed = parseSvg(svg)
    const png = await renderSvgPng(svg)

    expect(parsed.width).toBeGreaterThanOrEqual(760)
    expect(parsed.document.documentElement!.textContent).toContain(axisName)
    expect(svg).toContain('表示条件（完全名）')
    expect(await readPngMetadata(png)).toMatchObject({ width: parsed.width, height: parsed.height })
  })

  it('shows the 100-to-2-to-1 quantity difference without numeric count labels', async () => {
    const result = skewedCountsFixture()
    const svg = renderMatrixSvg(result, {
      sourceName: 'skewed.csv',
      xAxisName: '技術分類',
      yAxisName: '出願人',
      periodLabel: '集計期間：全期間',
      cliVersion: '0.1.0',
      resultJsonAvailable: true,
      countDisplay: 'hidden',
    })
    const imageWidths = Array.from(svg.matchAll(/<image\b[^>]*\bwidth="([0-9.]+)"/g), (match) => Number(match[1]))
    const expectedRadii = [100, 2, 1].map((rowCount) =>
      calculateBubbleRadius({ rowCount, maxRowCount: 100, cellWidth: 86, cellHeight: 48 }),
    )
    const normalPng = await renderSvgPng(svg)
    const grayscalePng = await renderSvgGrayscalePng(svg)

    expect(imageWidths).toHaveLength(3)
    expect(imageWidths).toEqual(expectedRadii.map((radius) => radius * 2 + 4))
    expect(svg).not.toContain('font-size:10px')
    expect(await readPngMetadata(normalPng)).toMatchObject({ format: 'png' })
    expect(await hasOnlyGrayscalePixels(grayscalePng)).toBe(true)
  })

  it('adds one top-right count badge per cell without changing bubble geometry or aggregate data', async () => {
    const result = skewedCountsFixture()
    const before = structuredClone(result)
    const metadata = {
      sourceName: 'skewed.csv',
      xAxisName: '技術分類',
      yAxisName: '出願人',
      periodLabel: '集計期間：全期間',
      cliVersion: '0.1.0',
      resultJsonAvailable: true,
    }
    const hiddenSvg = renderMatrixSvg(result, { ...metadata, countDisplay: 'hidden' })
    const shownSvg = renderMatrixSvg(result, { ...metadata, countDisplay: 'shown' })
    const hidden = parseSvg(hiddenSvg)
    const shown = parseSvg(shownSvg)
    const shownElements = Array.from(shown.document.getElementsByTagName('*'))
    const badgeLabels = shownElements
      .filter((element) => element.tagName === 'text' && element.getAttribute('fill') === '#372f28')
      .map((element) => element.textContent)
    const badgeBackgrounds = shownElements.filter(
      (element) => element.getAttribute('fill') === '#fffdf8' && element.getAttribute('stroke') === '#1f2937',
    )

    expect(hidden.width).toBe(shown.width)
    expect(hidden.height).toBe(shown.height)
    expect(readBubbleImageGeometry(hiddenSvg)).toHaveLength(result.cells.length)
    expect(readBubbleImageGeometry(hiddenSvg)).toEqual(readBubbleImageGeometry(shownSvg))
    expect(badgeLabels).toEqual(['100', '2', '1'])
    expect(badgeBackgrounds).toHaveLength(result.cells.length)
    expect(hiddenSvg).not.toContain('fill="#372f28"')
    expect(shownSvg).toContain('&quot;countDisplay&quot;:&quot;shown&quot;')
    expect(result).toEqual(before)
    await expect(renderSvgPng(hiddenSvg)).resolves.toBeInstanceOf(Buffer)
    await expect(renderSvgPng(shownSvg)).resolves.toBeInstanceOf(Buffer)
  })

  for (const fixtureName of ['standard-three-category', 'long-labels', 'dense-eight-by-eight', 'skewed-counts']) {
    it(`${fixtureName} rasterizes with all-cell badges enabled and disabled`, async () => {
      const fixture = visualRegressionFixtures.find((candidate) => candidate.name === fixtureName)
      if (!fixture) throw new Error(`Missing visual regression fixture: ${fixtureName}`)
      const result = fixture.create()
      const metadata = {
        sourceName: `${fixtureName}.csv`,
        xAxisName: '技術分類',
        yAxisName: '出願人',
        periodLabel: '集計期間：全期間',
        cliVersion: '0.1.0',
        resultJsonAvailable: true,
      }
      const hiddenSvg = renderMatrixSvg(result, { ...metadata, countDisplay: 'hidden' })
      const shownSvg = renderMatrixSvg(result, { ...metadata, countDisplay: 'shown' })
      const hidden = parseSvg(hiddenSvg)
      const shown = parseSvg(shownSvg)
      const shownElements = Array.from(shown.document.getElementsByTagName('*'))
      const badgeLabels = shownElements.filter(
        (element) => element.tagName === 'text' && element.getAttribute('fill') === '#372f28',
      )
      const badgeBackgrounds = shownElements.filter(
        (element) => element.getAttribute('fill') === '#fffdf8' && element.getAttribute('stroke') === '#1f2937',
      )
      const hiddenPng = await renderSvgPng(hiddenSvg)
      const shownPng = await renderSvgPng(shownSvg)
      const shownGrayscalePng = await renderSvgGrayscalePng(shownSvg)

      expect(hidden.width).toBe(shown.width)
      expect(hidden.height).toBe(shown.height)
      expect(readBubbleImageGeometry(hiddenSvg)).toEqual(readBubbleImageGeometry(shownSvg))
      expect(badgeLabels).toHaveLength(result.cells.length)
      expect(badgeBackgrounds).toHaveLength(result.cells.length)
      expect(await readPngMetadata(hiddenPng)).toMatchObject({ format: 'png', width: hidden.width, height: hidden.height })
      expect(await readPngMetadata(shownPng)).toMatchObject({ format: 'png', width: shown.width, height: shown.height })
      expect(await hasOnlyGrayscalePixels(shownGrayscalePng)).toBe(true)
    })
  }
})
