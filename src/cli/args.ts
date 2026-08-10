export const CLI_ERROR_CODES = [
  'ARTIFACT_CONFLICT',
  'DUPLICATE_ARGUMENT',
  'INPUT_ERROR',
  'INTERNAL_ERROR',
  'INVALID_CONFIG',
  'INVALID_CONFIG_PATH',
  'INVALID_CONFIG_VALUE',
  'INVALID_OUTPUT_PATH',
  'INVALID_RESULT_PATH',
  'LABEL_TOO_LONG',
  'MISSING_ARGUMENT',
  'OUTPUT_ERROR',
  'OUTPUT_BUSY',
  'OUTPUT_EXISTS',
  'OUTPUT_OUTSIDE_ROOT',
  'OUTPUT_PATH_CONFLICT',
  'SVG_DIMENSION_LIMIT',
  'UNKNOWN_ARGUMENT',
  'UNKNOWN_COLUMN',
  'UNKNOWN_COMMAND',
  'UNKNOWN_CONFIG_KEY',
  'UNSAFE_OUTPUT_TARGET',
  'UNSAFE_XLSX',
] as const

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number]

export const CLI_ERROR_REASONS = [
  ...CLI_ERROR_CODES.map((code) => code.toLowerCase()),
  'config_empty',
  'config_invalid_json',
  'config_read_error',
  'artifact_id_mismatch',
  'artifact_missing',
  'digest_mismatch',
  'file_set_mismatch',
  'lock_create_failed',
  'lock_release_failed',
  'manifest_invalid',
  'manifest_missing',
  'output_prepare_failed',
  'required_argument_missing',
  'stdin_empty',
  'stdin_invalid_json',
  'stdin_read_error',
  'stdin_too_large',
  'unclassified_internal_error',
  'unknown_contract_argument',
  'unsupported_config_extension',
] as const

export type CliErrorReason = (typeof CLI_ERROR_REASONS)[number]

export type CliErrorDetailValue = number | boolean | null

export type CliErrorDetails = {
  minimum?: number
  maximum?: number
  maxBytes?: number
  actual?: CliErrorDetailValue
  count?: number
  bytes?: number
  unit?: string
}

export type CliErrorMetadata = {
  retryable?: boolean
  field?: string
  reason?: CliErrorReason
  allowedValues?: string[]
  details?: CliErrorDetails
}

export class CliError extends Error {
  readonly code: CliErrorCode
  readonly exitCode: number
  readonly retryable: boolean
  readonly field?: string
  readonly reason: CliErrorReason
  readonly allowedValues?: string[]
  readonly details?: CliErrorDetails

  constructor(code: CliErrorCode, message: string, exitCode = 2, metadata: CliErrorMetadata = {}) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.exitCode = exitCode
    this.retryable = metadata.retryable ?? false
    this.field = metadata.field
    this.reason = metadata.reason ?? (code.toLowerCase() as CliErrorReason)
    this.allowedValues = metadata.allowedValues
    this.details = metadata.details
  }
}

export function normalizeCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  return new CliError('INTERNAL_ERROR', '予期しない内部エラーが発生しました。', 1, {
    reason: 'unclassified_internal_error',
  })
}

export function toErrorReceipt(error: CliError): Record<string, unknown> {
  return {
    schemaVersion: 2,
    ok: false,
    code: error.code,
    message: error.message,
    reason: error.reason,
    retryable: error.retryable,
    ...(error.field ? { field: error.field } : {}),
    ...(error.allowedValues ? { allowedValues: error.allowedValues } : {}),
    ...(error.details ? { details: error.details } : {}),
  }
}

export type HelpTopic = 'inspect' | 'generate'
export type HelpArgs = { command: 'help'; topic?: HelpTopic }
export type VersionArgs = { command: 'version' }
export type ContractArgs = { command: 'contract' }
export type InspectArgs = { command: 'inspect'; input: string; includeSamples: boolean; includePaths?: boolean }
export type GenerateArgs = {
  command: 'generate'
  input: string
  output: string
  config?: string
  result?: string
  outputRoot?: string
  force: boolean
  includePaths?: boolean
}

export type CliArgs = HelpArgs | VersionArgs | ContractArgs | InspectArgs | GenerateArgs

function missingArgument(name: string): never {
  throw new CliError('MISSING_ARGUMENT', `必須引数 ${name} がありません。`, 2, {
    field: name,
    reason: 'required_argument_missing',
  })
}

export function parseCliArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))) {
    return { command: 'help' }
  }
  if (argv[0] === 'help') {
    if (argv.length === 1) return { command: 'help' }
    if (argv.length === 2 && (argv[1] === 'inspect' || argv[1] === 'generate')) {
      return { command: 'help', topic: argv[1] }
    }
    if (argv.length === 2) {
      throw new CliError('UNKNOWN_COMMAND', 'helpの対象として不明なコマンドです。', 2, {
        field: 'helpTopic',
        reason: 'unknown_command',
        allowedValues: ['inspect', 'generate'],
      })
    }
    throw new CliError('UNKNOWN_ARGUMENT', 'helpに不要な引数があります。', 2, {
      field: 'argument',
      reason: 'unknown_argument',
    })
  }
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-V' || argv[0] === 'version')) {
    return { command: 'version' }
  }
  if (argv[0] === 'contract') {
    const options = argv.slice(1)
    const jsonOptionCount = options.filter((option) => option === '--json').length
    if (jsonOptionCount === 0 && options.length === 0) missingArgument('--json')
    if (jsonOptionCount > 1) {
      throw new CliError('DUPLICATE_ARGUMENT', '引数が重複しています: --json', 2, {
        field: '--json',
        reason: 'duplicate_argument',
      })
    }
    const unknownOption = options.find((option) => option !== '--json')
    if (unknownOption) {
      throw new CliError('UNKNOWN_ARGUMENT', 'contractに不要な引数があります。', 2, {
        field: 'argument',
        reason: 'unknown_contract_argument',
        allowedValues: ['--json'],
      })
    }
    if (jsonOptionCount === 1) return { command: 'contract' }
    throw new CliError('UNKNOWN_ARGUMENT', 'contractの引数が不正です。', 2, {
      field: 'argument',
      reason: 'unknown_contract_argument',
      allowedValues: ['--json'],
    })
  }

  const command = argv[0]
  if (command !== 'inspect' && command !== 'generate') {
    throw new CliError('UNKNOWN_COMMAND', '不明なコマンドです。', 2, {
      field: 'command',
      reason: 'unknown_command',
      allowedValues: ['contract', 'inspect', 'generate', 'help', 'version'],
    })
  }
  if (argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')) {
    return { command: 'help', topic: command }
  }

  const allowed =
    command === 'inspect'
      ? new Set(['--input', '--include-samples', '--include-paths'])
      : new Set(['--input', '--output', '--config', '--result', '--output-root', '--force', '--include-paths'])
  const values = new Map<string, string | true>()

  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]
    if (!allowed.has(option)) {
      throw new CliError('UNKNOWN_ARGUMENT', '不明な引数です。', 2, {
        field: 'argument',
        reason: 'unknown_argument',
      })
    }
    if (values.has(option)) {
      throw new CliError('DUPLICATE_ARGUMENT', `引数が重複しています: ${option}`)
    }
    if (option === '--force' || option === '--include-samples' || option === '--include-paths') {
      values.set(option, true)
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      missingArgument(option)
    }
    values.set(option, value)
    index += 1
  }

  const input = values.get('--input')
  if (typeof input !== 'string') missingArgument('--input')

  if (command === 'inspect') {
    return {
      command,
      input,
      includeSamples: values.get('--include-samples') === true,
      includePaths: values.get('--include-paths') === true,
    }
  }

  const output = values.get('--output')
  if (typeof output !== 'string') missingArgument('--output')
  const config = values.get('--config')
  const result = values.get('--result')
  const outputRoot = values.get('--output-root')
  return {
    command,
    input,
    output,
    config: typeof config === 'string' ? config : undefined,
    result: typeof result === 'string' ? result : undefined,
    outputRoot: typeof outputRoot === 'string' ? outputRoot : undefined,
    force: values.get('--force') === true,
    includePaths: values.get('--include-paths') === true,
  }
}
