import { describe, expect, it } from 'vitest'
import { mergeAndValidateSettings, toVersion1Settings } from './config'
import type { DatasetFile, MatrixSettings } from '../lib/types'

const dataset: DatasetFile = {
  fileName: 'data.csv',
  columns: ['IPC', '出願人', '出願年', '用途'],
  rows: [{ IPC: 'G01N', 出願人: 'A社', 出願年: '2024', 用途: '検査' }],
}

const defaults: MatrixSettings = {
  xAxis: 'IPC',
  yAxis: '出願人',
  yearColumn: '出願年',
  xLimit: 8,
  yLimit: 8,
  pieSourceMode: 'column',
  pieColumn: '用途',
  columnSliceStrategy: 'top_n_with_other',
  pieTopN: 5,
  periodStart: '',
  periodEnd: '',
  yearBucketMode: 'recent_vs_other',
  periodBoundaries: '2012, 2016, 2020',
  recentYears: 5,
  includeAxisOther: false,
  showCounts: false,
  classificationSplitMode: 'all',
  xClassificationLevel: 'full',
  yClassificationLevel: 'full',
  pieClassificationLevel: 'full',
}

describe('mergeAndValidateSettings', () => {
  it('merges a partial config over inferred defaults', () => {
    expect(mergeAndValidateSettings(dataset, defaults, { xLimit: 4, includeAxisOther: true, showCounts: true })).toMatchObject({
      xAxis: 'IPC',
      xLimit: 4,
      includeAxisOther: true,
      showCounts: true,
    })
  })

  it('normalizes legacy numeric strings to integer effective settings', () => {
    expect(
      mergeAndValidateSettings(dataset, defaults, {
        xLimit: '2',
        periodStart: ' 2023 ',
        periodEnd: ' 2024 ',
        periodBoundaries: ' 2010、 2015,2020 ',
      }),
    ).toMatchObject({
      xLimit: 2,
      periodStart: '2023',
      periodEnd: '2024',
      periodBoundaries: '2010, 2015, 2020',
    })
  })

  it('serializes only the legacy settings surface for version 1 receipts', () => {
    const legacy = toVersion1Settings({ ...defaults, showCounts: true })

    expect(legacy).toMatchObject({ xLimit: '8', yLimit: '8', pieTopN: '5', recentYears: '5' })
    expect(legacy).not.toHaveProperty('showCounts')
  })

  it('normalizes matching legacy strings and JSON integers to the same settings', () => {
    const legacy = mergeAndValidateSettings(dataset, defaults, {
      xLimit: '4',
      yLimit: '7',
      pieTopN: '12',
      recentYears: '15',
    })
    const natural = mergeAndValidateSettings(dataset, defaults, {
      xLimit: 4,
      yLimit: 7,
      pieTopN: 12,
      recentYears: 15,
    })

    expect(legacy).toEqual(natural)
  })

  it.each([
    [{ xLimit: 4 }, { xLimit: 4 }],
    [{ yLimit: 7 }, { yLimit: 7 }],
    [{ pieTopN: 12 }, { pieTopN: 12 }],
    [{ recentYears: 15 }, { recentYears: 15 }],
  ])('accepts natural JSON integers %#', (config, expected) => {
    expect(mergeAndValidateSettings(dataset, defaults, config)).toMatchObject(expected)
  })

  it.each([
    [{ typo: 'value' }, 'UNKNOWN_CONFIG_KEY'],
    [{ xAxis: 'missing' }, 'UNKNOWN_COLUMN'],
    [{ pieSourceMode: 'invalid' }, 'INVALID_CONFIG_VALUE'],
    [{ includeAxisOther: 'yes' }, 'INVALID_CONFIG_VALUE'],
    [{ showCounts: 'yes' }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: '21' }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: 2.5 }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: 'two' }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: '8.0' }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: '8e0' }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: '0x8' }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: '08' }, 'INVALID_CONFIG_VALUE'],
    [{ xLimit: ' 8 ' }, 'INVALID_CONFIG_VALUE'],
    [{ periodStart: 'abc', periodEnd: '2024' }, 'INVALID_CONFIG_VALUE'],
    [{ periodStart: '2025', periodEnd: '2024' }, 'INVALID_CONFIG_VALUE'],
    [{ periodStart: '2024', periodEnd: '' }, 'INVALID_CONFIG_VALUE'],
    [{ periodBoundaries: '2020, nope, 2024' }, 'INVALID_CONFIG_VALUE'],
  ])('rejects invalid config %#', (config, code) => {
    expect(() => mergeAndValidateSettings(dataset, defaults, config)).toThrowError(expect.objectContaining({ code, exitCode: 2 }))
  })

  it('rejects a year-bucket column that contains no parseable years', () => {
    expect(() =>
      mergeAndValidateSettings(dataset, defaults, { pieSourceMode: 'year_bucket', yearColumn: '用途' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG_VALUE', exitCode: 2 }))
  })

  it('provides stable fields without reflecting unknown keys or column values', () => {
    const privateKey = 'private-setting-name'
    const privateColumn = 'private-column-value'

    for (const [config, expected] of [
      [{ [privateKey]: true }, { code: 'UNKNOWN_CONFIG_KEY', field: 'settings', reason: 'unknown_config_key' }],
      [{ xAxis: privateColumn }, { code: 'UNKNOWN_COLUMN', field: 'xAxis', reason: 'unknown_column' }],
    ] as const) {
      try {
        mergeAndValidateSettings(dataset, defaults, config)
        expect.fail('invalid config should reject')
      } catch (error) {
        expect(error).toMatchObject(expected)
        expect(String((error as Error).message)).not.toContain(privateKey)
        expect(String((error as Error).message)).not.toContain(privateColumn)
      }
    }
  })
})
