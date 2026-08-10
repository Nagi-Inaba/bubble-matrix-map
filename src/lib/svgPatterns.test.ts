import { describe, expect, it } from 'vitest'
import { parseSvg, renderSvgGrayscalePng } from '../cli/svgVisualTestSupport'
import {
  buildSvgPatternDefinition,
  CATEGORY_PATTERN_COUNT,
  getCategoryPatternSignature,
} from './svgPatterns'

describe('SVG category patterns', () => {
  it('defines twelve deterministic non-color signatures that cycle by legend order', () => {
    const signatures = Array.from({ length: CATEGORY_PATTERN_COUNT }, (_, index) =>
      getCategoryPatternSignature(index),
    )

    expect(CATEGORY_PATTERN_COUNT).toBe(12)
    expect(new Set(signatures)).toHaveLength(12)
    expect(getCategoryPatternSignature(12)).toBe(signatures[0])
    expect(getCategoryPatternSignature(25)).toBe(signatures[1])
  })

  it('renders all twelve patterns as distinct grayscale pixel masks', async () => {
    const masks: string[] = []
    for (let index = 0; index < CATEGORY_PATTERN_COUNT; index += 1) {
      const definition = buildSvgPatternDefinition(`test-pattern-${index}`, '#648fff', index)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><defs>${definition}</defs><rect width="48" height="48" fill="url(#test-pattern-${index})"></rect></svg>`
      parseSvg(svg)
      masks.push((await renderSvgGrayscalePng(svg)).toString('base64'))
    }

    expect(new Set(masks)).toHaveLength(CATEGORY_PATTERN_COUNT)
  })
})
