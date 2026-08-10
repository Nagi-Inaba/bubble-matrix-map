import { DOMParser } from '@xmldom/xmldom'
import sharp from 'sharp'

export type ParsedSvg = {
  document: ReturnType<DOMParser['parseFromString']>
  width: number
  height: number
}

function parseSvgDimension(value: string | null, name: 'width' | 'height'): number {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`SVG ${name} must be a positive numeric attribute.`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`SVG ${name} must be greater than zero.`)
  }
  return parsed
}

export function parseSvg(svg: string): ParsedSvg {
  const parserIssues: string[] = []
  const document = new DOMParser({
    onError: (level, message) => {
      parserIssues.push(`${level}: ${message}`)
    },
  }).parseFromString(svg, 'image/svg+xml')

  const parserErrors = document.getElementsByTagName('parsererror')
  if (parserIssues.length > 0 || parserErrors.length > 0) {
    throw new Error(`Invalid SVG XML: ${[...parserIssues, ...Array.from({ length: parserErrors.length }, () => 'parsererror element')].join('; ')}`)
  }
  const root = document.documentElement
  if (!root || root.tagName !== 'svg') {
    throw new Error(`Expected an svg root element, received ${root?.tagName || '(none)'}.`)
  }
  return {
    document,
    width: parseSvgDimension(root.getAttribute('width'), 'width'),
    height: parseSvgDimension(root.getAttribute('height'), 'height'),
  }
}

const PNG_OPTIONS = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
} as const

export async function renderSvgPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf8'), { density: 72, limitInputPixels: false }).png(PNG_OPTIONS).toBuffer()
}

export async function renderSvgGrayscalePng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf8'), { density: 72, limitInputPixels: false }).grayscale().png(PNG_OPTIONS).toBuffer()
}

export async function readPngMetadata(
  png: Buffer,
): Promise<{ format: string | undefined; width: number | undefined; height: number | undefined; space: string | undefined; channels: number | undefined }> {
  const metadata = await sharp(png).metadata()
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    space: metadata.space,
    channels: metadata.channels,
  }
}

export async function hasOnlyGrayscalePixels(png: Buffer): Promise<boolean> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  if (info.channels < 3) return true
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] !== data[offset + 1] || data[offset] !== data[offset + 2]) return false
  }
  return true
}
