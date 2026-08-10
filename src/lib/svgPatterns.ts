export const CATEGORY_PATTERN_COUNT = 12

const PATTERN_SIGNATURES = [
  'horizontal',
  'vertical',
  'diagonal-down',
  'diagonal-up',
  'orthogonal-cross',
  'diagonal-cross',
  'sparse-dots',
  'dense-dots',
  'horizontal-dots',
  'vertical-dots',
  'diagonal-down-dots',
  'diagonal-up-dots',
] as const

function normalizePatternIndex(index: number): number {
  const integer = Number.isFinite(index) ? Math.trunc(index) : 0
  return ((integer % CATEGORY_PATTERN_COUNT) + CATEGORY_PATTERN_COUNT) % CATEGORY_PATTERN_COUNT
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function patternMarks(index: number): string {
  const line = 'fill="none" stroke="#172033" stroke-opacity="0.62" stroke-width="1"'
  const dot = 'fill="#172033" fill-opacity="0.68"'
  switch (normalizePatternIndex(index)) {
    case 0:
      return `<path d="M0 2H8M0 6H8" ${line}></path>`
    case 1:
      return `<path d="M2 0V8M6 0V8" ${line}></path>`
    case 2:
      return `<path d="M-2 0L8 10M2-2L10 6" ${line}></path>`
    case 3:
      return `<path d="M-2 8L8-2M2 10L10 2" ${line}></path>`
    case 4:
      return `<path d="M0 4H8M4 0V8" ${line}></path>`
    case 5:
      return `<path d="M-2 0L8 10M2-2L10 6M-2 8L8-2M2 10L10 2" ${line}></path>`
    case 6:
      return `<circle cx="2" cy="2" r="1" ${dot}></circle><circle cx="6" cy="6" r="1" ${dot}></circle>`
    case 7:
      return `<circle cx="2" cy="2" r="1" ${dot}></circle><circle cx="6" cy="2" r="1" ${dot}></circle><circle cx="2" cy="6" r="1" ${dot}></circle><circle cx="6" cy="6" r="1" ${dot}></circle>`
    case 8:
      return `<path d="M0 2H8M0 6H8" ${line}></path><circle cx="4" cy="4" r="1" ${dot}></circle>`
    case 9:
      return `<path d="M2 0V8M6 0V8" ${line}></path><circle cx="4" cy="4" r="1" ${dot}></circle>`
    case 10:
      return `<path d="M-2 0L8 10M2-2L10 6" ${line}></path><circle cx="2" cy="6" r="1" ${dot}></circle>`
    default:
      return `<path d="M-2 8L8-2M2 10L10 2" ${line}></path><circle cx="6" cy="6" r="1" ${dot}></circle>`
  }
}

export function getCategoryPatternSignature(index: number): string {
  return PATTERN_SIGNATURES[normalizePatternIndex(index)]
}

export function buildSvgPatternDefinition(id: string, color: string, index: number): string {
  return `<pattern id="${escapeXmlAttribute(id)}" patternUnits="userSpaceOnUse" width="8" height="8" data-pattern="${getCategoryPatternSignature(
    index,
  )}"><rect width="8" height="8" fill="${escapeXmlAttribute(color)}"></rect>${patternMarks(index)}</pattern>`
}
