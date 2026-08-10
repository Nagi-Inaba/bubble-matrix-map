import type { DatasetFile, MatrixSettings, MatrixSettingsV1 } from '../lib/types'
import { findDistinctYears } from '../lib/pieMatrix'
import { CliError, type CliErrorMetadata } from './args'

const settingsKeys = new Set<keyof MatrixSettings>([
  'xAxis',
  'yAxis',
  'yearColumn',
  'xLimit',
  'yLimit',
  'pieSourceMode',
  'pieColumn',
  'columnSliceStrategy',
  'pieTopN',
  'periodStart',
  'periodEnd',
  'yearBucketMode',
  'periodBoundaries',
  'recentYears',
  'includeAxisOther',
  'showCounts',
  'classificationSplitMode',
  'xClassificationLevel',
  'yClassificationLevel',
  'pieClassificationLevel',
])

const integerSettings = new Set<keyof MatrixSettings>(['xLimit', 'yLimit', 'pieTopN', 'recentYears'])

const enumValues: Partial<Record<keyof MatrixSettings, readonly string[]>> = {
  pieSourceMode: ['column', 'year_bucket'],
  columnSliceStrategy: ['top_n_with_other', 'top_n_only'],
  yearBucketMode: ['four_periods', 'recent_vs_other'],
  classificationSplitMode: ['all', 'first'],
  xClassificationLevel: ['full', 'class', 'subclass', 'main_group', 'subgroup'],
  yClassificationLevel: ['full', 'class', 'subclass', 'main_group', 'subgroup'],
  pieClassificationLevel: ['full', 'class', 'subclass', 'main_group', 'subgroup'],
}

function invalidValue(key: string, detail: string, metadata: CliErrorMetadata = {}): never {
  throw new CliError('INVALID_CONFIG_VALUE', `設定 ${key} が不正です。${detail}`, 2, {
    field: key,
    reason: 'invalid_config_value',
    ...metadata,
  })
}

function validateIntegerSetting(settings: MatrixSettings, key: 'xLimit' | 'yLimit' | 'pieTopN' | 'recentYears', min: number, max: number): void {
  const value = settings[key]
  if (!Number.isInteger(value) || value < min || value > max) {
    invalidValue(key, `${min}〜${max} の整数を指定してください。`, {
      details: { minimum: min, maximum: max },
    })
  }
}

function validateYear(value: string, key: string): number {
  if (!/^(?:19|20)\d{2}$/.test(value)) {
    invalidValue(key, '1900〜2099 の西暦4桁で指定してください。')
  }
  return Number(value)
}

function validatePeriodSettings(settings: MatrixSettings): void {
  const start = settings.periodStart.trim()
  const end = settings.periodEnd.trim()
  if (Boolean(start) !== Boolean(end)) {
    invalidValue('periodStart/periodEnd', '期間の開始年と終了年は両方を指定するか、両方を空欄にしてください。')
  }
  if (start && end) {
    const startYear = validateYear(start, 'periodStart')
    const endYear = validateYear(end, 'periodEnd')
    if (startYear > endYear) invalidValue('periodStart/periodEnd', '開始年は終了年以前にしてください。')
  }

  const boundaries = settings.periodBoundaries
    .split(/[,\n、]+/)
    .map((value) => value.trim())
    .filter(Boolean)
  if (boundaries.length !== 3) {
    invalidValue('periodBoundaries', '昇順の境界年を3件指定してください。')
  }
  const years = boundaries.map((value) => validateYear(value, 'periodBoundaries'))
  if (!(years[0] < years[1] && years[1] < years[2])) {
    invalidValue('periodBoundaries', '重複しない境界年を昇順で指定してください。')
  }
}

export function mergeAndValidateSettings(dataset: DatasetFile, defaults: MatrixSettings, config: unknown): MatrixSettings {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new CliError('INVALID_CONFIG', '設定JSONのルートはオブジェクトにしてください。')
  }

  const raw = config as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!settingsKeys.has(key as keyof MatrixSettings)) {
      throw new CliError('UNKNOWN_CONFIG_KEY', '不明な設定キーがあります。', 2, {
        field: 'settings',
        reason: 'unknown_config_key',
        allowedValues: [...settingsKeys],
      })
    }
    if (key === 'includeAxisOther' || key === 'showCounts') {
      if (typeof raw[key] !== 'boolean') {
        invalidValue(key, 'true または false を指定してください。', { allowedValues: ['true', 'false'] })
      }
    } else if (integerSettings.has(key as keyof MatrixSettings)) {
      if (typeof raw[key] !== 'string' && typeof raw[key] !== 'number') {
        invalidValue(key, 'JSON整数または整数の文字列で指定してください。')
      }
      if (typeof raw[key] === 'string' && !/^[1-9]\d*$/.test(raw[key])) {
        invalidValue(key, '整数の文字列は先頭ゼロ、指数、小数を使わず指定してください。')
      }
    } else if (typeof raw[key] !== 'string') {
      invalidValue(key, '文字列で指定してください。')
    } else if (raw[key].length > 512) {
      invalidValue(key, '512文字以内で指定してください。')
    }
  }

  const normalizedRaw = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      if (integerSettings.has(key as keyof MatrixSettings)) {
        return [key, typeof value === 'string' ? Number(value) : value]
      }
      if (typeof value !== 'string') return [key, value]
      if (key === 'periodBoundaries') {
        return [key, value.split(/[,\n、]+/).map((part) => part.trim()).filter(Boolean).join(', ')]
      }
      return [key, value.trim()]
    }),
  )
  const settings = { ...defaults, ...normalizedRaw } as MatrixSettings
  for (const [key, allowed] of Object.entries(enumValues)) {
    const value = settings[key as keyof MatrixSettings]
    if (!allowed?.includes(String(value))) {
      invalidValue(key, `許可値: ${allowed?.join(', ')}`, { allowedValues: [...(allowed ?? [])] })
    }
  }

  validateIntegerSetting(settings, 'xLimit', 1, 20)
  validateIntegerSetting(settings, 'yLimit', 1, 20)
  validateIntegerSetting(settings, 'pieTopN', 2, 12)
  validateIntegerSetting(settings, 'recentYears', 2, 15)
  validatePeriodSettings(settings)

  const requiredColumns: Array<[keyof MatrixSettings, boolean]> = [
    ['xAxis', true],
    ['yAxis', true],
    ['yearColumn', settings.pieSourceMode === 'year_bucket'],
    ['pieColumn', settings.pieSourceMode === 'column'],
  ]
  for (const [key, required] of requiredColumns) {
    const column = String(settings[key])
    if (!column && !required) continue
    if (!dataset.columns.includes(column)) {
      throw new CliError('UNKNOWN_COLUMN', `設定 ${key} の列が入力にありません。`, 2, {
        field: key,
        reason: 'unknown_column',
      })
    }
  }

  if (settings.pieSourceMode === 'year_bucket' && findDistinctYears(dataset.rows, settings.yearColumn).length === 0) {
    invalidValue('yearColumn', '年区分には西暦年を取得できる列を指定してください。')
  }

  return settings
}

export function toVersion1Settings(settings: MatrixSettings): MatrixSettingsV1 {
  const { showCounts: _showCounts, ...legacy } = settings
  void _showCounts
  return {
    ...legacy,
    xLimit: String(settings.xLimit),
    yLimit: String(settings.yLimit),
    pieTopN: String(settings.pieTopN),
    recentYears: String(settings.recentYears),
  }
}
