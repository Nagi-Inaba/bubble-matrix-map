import type { ClassificationLevel } from './types'

export function normalizeColumnName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

export function getOrbitBaseHeader(name: string): string {
  const matched = name.trim().match(/^([A-Z]+)(?:_(\d+))?$/)
  return matched?.[1] ?? name.trim()
}

export function isClassificationColumnName(name: string): boolean {
  const baseHeader = getOrbitBaseHeader(name)
  if (['IC', 'FI', 'FTM', 'PCL'].includes(baseHeader)) return true

  const normalized = normalizeColumnName(name)
  return (
    /\b(ipc|cpc|fi|fterm|ftm|pcl)\b/i.test(name) ||
    /(internationalclassification|cooperativeclassification|fileindex|fileformingterm)/i.test(normalized) ||
    /(ipc分類|fi分類|fターム|特許分類|分類コード)/.test(name)
  )
}

export function isYearishColumnName(name: string): boolean {
  return /(year|date)$/i.test(normalizeColumnName(name)) || /(出願年|出願日|優先日|公開日|登録日|最先出願日)/.test(name)
}

export function splitMultiValueCell(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\s*(?:\||;|\r?\n)\s*/g)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  )
}

type ClassificationParts = {
  classCode: string
  subclass: string
  mainGroup?: string
  subgroup?: string
}

function parseClassificationParts(value: string): ClassificationParts | null {
  const normalized = value
    .trim()
    .replace(/[－ー―–—]/g, '-')
    .replace(/\s+/g, ' ')
  const matched = normalized.match(/\b([A-HY])\s*(\d{2})\s*([A-Z])\s*-?\s*0*(\d{1,4})(?:\s*\/\s*0*(\d{1,6}))?/i)
  if (!matched) {
    const subclassOnly = normalized.match(/\b([A-HY])\s*(\d{2})\s*([A-Z])\b/i)
    if (!subclassOnly) return null
    const classCode = `${subclassOnly[1].toUpperCase()}${subclassOnly[2]}`
    return {
      classCode,
      subclass: `${classCode}${subclassOnly[3].toUpperCase()}`,
    }
  }

  const classCode = `${matched[1].toUpperCase()}${matched[2]}`
  const subclass = `${classCode}${matched[3].toUpperCase()}`
  const mainGroup = `${subclass}${Number(matched[4])}`
  const subgroup = matched[5] ? `${mainGroup}/${matched[5]}` : mainGroup
  return { classCode, subclass, mainGroup, subgroup }
}

export function formatClassificationValue(value: string, level: ClassificationLevel): string {
  const trimmed = value.trim()
  if (!trimmed || level === 'full') return trimmed

  const parsed = parseClassificationParts(trimmed)
  if (!parsed) return trimmed
  if (level === 'class') return parsed.classCode
  if (level === 'subclass') return parsed.subclass
  if (level === 'main_group') return parsed.mainGroup ?? parsed.subclass
  return parsed.subgroup ?? parsed.mainGroup ?? parsed.subclass
}
