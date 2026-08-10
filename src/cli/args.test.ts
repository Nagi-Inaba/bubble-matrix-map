import { describe, expect, it } from 'vitest'
import { CliError, normalizeCliError, parseCliArgs, toErrorReceipt } from './args'

describe('parseCliArgs', () => {
  it('parses inspect input', () => {
    expect(parseCliArgs(['inspect', '--input', 'data.csv'])).toEqual({
      command: 'inspect',
      input: 'data.csv',
      includeSamples: false,
      includePaths: false,
    })
  })

  it('requires explicit consent before returning cell samples', () => {
    expect(parseCliArgs(['inspect', '--input', 'data.csv', '--include-samples'])).toEqual({
      command: 'inspect',
      input: 'data.csv',
      includeSamples: true,
      includePaths: false,
    })
  })

  it('parses generate paths and force', () => {
    expect(
      parseCliArgs([
        'generate',
        '--input',
        'data.xlsx',
        '--output',
        'map.svg',
        '--config',
        'config.json',
        '--result',
        'result.json',
        '--output-root',
        'artifacts',
      '--force',
        '--include-paths',
      ]),
    ).toEqual({
      command: 'generate',
      input: 'data.xlsx',
      output: 'map.svg',
      config: 'config.json',
      result: 'result.json',
      outputRoot: 'artifacts',
      force: true,
      includePaths: true,
    })
  })

  it('parses version and explicit path disclosure', () => {
    expect(parseCliArgs(['--version'])).toEqual({ command: 'version' })
    expect(parseCliArgs(['-V'])).toEqual({ command: 'version' })
    expect(parseCliArgs(['inspect', '--input', 'data.csv', '--include-paths'])).toEqual({
      command: 'inspect',
      input: 'data.csv',
      includeSamples: false,
      includePaths: true,
    })
  })

  it('parses the machine-readable contract command', () => {
    expect(parseCliArgs(['contract', '--json'])).toEqual({ command: 'contract' })
    expect(() => parseCliArgs(['contract'])).toThrowError(CliError)
    try {
      parseCliArgs(['contract'])
    } catch (error) {
      expect(error).toMatchObject({
        code: 'MISSING_ARGUMENT',
        reason: 'required_argument_missing',
        field: '--json',
      })
    }
    expect(() => parseCliArgs(['contract', '--json', '--extra'])).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_ARGUMENT', field: 'argument' }),
    )
    expect(() => parseCliArgs(['contract', '--json', '--json'])).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_ARGUMENT', field: '--json' }),
    )
  })

  it('parses top-level and subcommand help without requiring command arguments', () => {
    expect(parseCliArgs(['--help'])).toEqual({ command: 'help' })
    expect(parseCliArgs(['inspect', '--help'])).toEqual({ command: 'help', topic: 'inspect' })
    expect(parseCliArgs(['generate', '-h'])).toEqual({ command: 'help', topic: 'generate' })
    expect(parseCliArgs(['help', 'inspect'])).toEqual({ command: 'help', topic: 'inspect' })
    expect(parseCliArgs(['help', 'generate'])).toEqual({ command: 'help', topic: 'generate' })
  })

  it.each([
    [['inspect'], 'MISSING_ARGUMENT'],
    [['generate', '--input', 'data.csv'], 'MISSING_ARGUMENT'],
    [['inspect', '--input', 'data.csv', '--wat'], 'UNKNOWN_ARGUMENT'],
    [['help', 'unknown'], 'UNKNOWN_COMMAND'],
    [['inspect', '--input', 'a.csv', '--input', 'b.csv'], 'DUPLICATE_ARGUMENT'],
  ])('rejects invalid arguments', (args, code) => {
    expect(() => parseCliArgs(args)).toThrowError(CliError)
    try {
      parseCliArgs(args)
    } catch (error) {
      expect(error).toMatchObject({ code, exitCode: 2 })
    }
  })
})

describe('normalizeCliError', () => {
  it('preserves classified errors', () => {
    const error = new CliError('INPUT_ERROR', '入力エラー', 3)
    expect(normalizeCliError(error)).toBe(error)
  })

  it('does not expose details from unclassified errors', () => {
    const normalized = normalizeCliError(new Error('C:\\Users\\name\\private.csv'))
    expect(normalized).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '予期しない内部エラーが発生しました。',
      exitCode: 1,
      reason: 'unclassified_internal_error',
    })
    expect(normalized.message).not.toContain('private.csv')
  })

  it('serializes safe structured metadata into a version 2 error receipt', () => {
    const receipt = toErrorReceipt(
      new CliError('INVALID_CONFIG_VALUE', '範囲外です。', 2, {
        field: 'xLimit',
        reason: 'invalid_config_value',
        retryable: false,
        allowedValues: ['1', '2'],
        details: { minimum: 1, maximum: 2 },
      }),
    )

    expect(receipt).toEqual({
      schemaVersion: 2,
      ok: false,
      code: 'INVALID_CONFIG_VALUE',
      message: '範囲外です。',
      reason: 'invalid_config_value',
      retryable: false,
      field: 'xLimit',
      allowedValues: ['1', '2'],
      details: { minimum: 1, maximum: 2 },
    })
  })
})
