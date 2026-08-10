import { CLI_ERROR_CODES, CLI_ERROR_REASONS } from './args'
import { CLI_VERSION } from './version'

export function buildCliContract(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    ok: true,
    command: 'contract',
    cliVersion: CLI_VERSION,
    compatibility: {
      activeOutputSchemaVersion: 2,
      acceptedSettingsSchemaVersions: [1, 2],
      preservedSchemaVersions: [1],
      migration: '既定のreceiptと結果JSONはversion 2です。version 1 Schemaは参照用に同梱します。',
    },
    commands: [
      {
        name: 'contract',
        description: '機械可読なCLI契約を返します。',
        arguments: [
          {
            name: '--json',
            required: true,
            takesValue: false,
            sensitive: false,
            description: '契約を1行JSONで標準出力へ返します。',
          },
        ],
      },
      {
        name: 'inspect',
        description: '入力の列構造と推奨設定を検査します。',
        arguments: [
          { name: '--input', required: true, takesValue: true, sensitive: false, description: 'CSV、TSV、Excel .xlsxの入力パスです。' },
          { name: '--include-samples', required: false, takesValue: false, default: false, sensitive: true, description: 'セル例をreceiptへ含めます。' },
          { name: '--include-paths', required: false, takesValue: false, default: false, sensitive: true, description: '絶対パスをreceiptへ含めます。' },
        ],
      },
      {
        name: 'generate',
        description: 'Bubble Matrix MapのSVGと任意の結果JSONを生成します。',
        arguments: [
          { name: '--input', required: true, takesValue: true, sensitive: false, description: 'CSV、TSV、Excel .xlsxの入力パスです。' },
          { name: '--output', required: true, takesValue: true, sensitive: false, description: 'SVGの出力先です。' },
          { name: '--config', required: false, takesValue: true, default: null, sensitive: false, description: '設定JSONのパスです。「-」は標準入力を表します。' },
          { name: '--result', required: false, takesValue: true, default: null, sensitive: false, description: '結果JSONの出力先です。' },
          { name: '--output-root', required: false, takesValue: true, defaultSource: 'current_working_directory', sensitive: false, description: '成果物を許可する出力ルートです。' },
          { name: '--force', required: false, takesValue: false, default: false, sensitive: true, description: '確認済みの競合成果物を置き換えます。同一成果物は再利用します。' },
          { name: '--include-paths', required: false, takesValue: false, default: false, sensitive: true, description: '絶対パスをreceiptへ含めます。' },
        ],
      },
      {
        name: 'help',
        description: '利用者向けのコマンド説明を返します。',
        arguments: [],
      },
      {
        name: 'version',
        description: 'CLIバージョンを返します。',
        arguments: [],
      },
    ],
    streams: {
      success: {
        stream: 'stdout',
        format: 'single-json-line',
        commands: ['contract', 'inspect', 'generate'],
      },
      textSuccess: {
        stream: 'stdout',
        format: 'text',
        commands: ['help', 'version'],
      },
      failure: {
        stream: 'stderr',
        format: 'single-json-line',
        commands: ['contract', 'inspect', 'generate', 'help', 'version'],
      },
      configStdin: {
        selector: '--config -',
        format: 'JSON object',
        maxBytes: 1_048_576,
        precedence: 'dataset-derived defaults < selected config',
        receiptValue: 'stdin',
      },
    },
    schemas: [
      {
        name: 'artifact-manifest',
        role: 'output',
        path: 'schemas/v2/artifact-manifest.schema.json',
        uri: 'urn:bubble-matrix-map:schema:artifact-manifest:2',
        dependsOn: [],
      },
      {
        name: 'cli-contract',
        role: 'output',
        path: 'schemas/v2/cli-contract.schema.json',
        uri: 'urn:bubble-matrix-map:schema:cli-contract:2',
        dependsOn: [],
      },
      {
        name: 'notice',
        role: 'shared',
        path: 'schemas/v2/notice.schema.json',
        uri: 'urn:bubble-matrix-map:schema:notice:2',
        dependsOn: [],
      },
      {
        name: 'error-receipt',
        role: 'output',
        path: 'schemas/v2/error-receipt.schema.json',
        uri: 'urn:bubble-matrix-map:schema:error-receipt:2',
        dependsOn: [],
      },
      {
        name: 'inspect-receipt',
        role: 'output',
        path: 'schemas/v2/inspect-receipt.schema.json',
        uri: 'urn:bubble-matrix-map:schema:inspect-receipt:2',
        dependsOn: [
          'urn:bubble-matrix-map:schema:matrix-settings-effective:2',
          'urn:bubble-matrix-map:schema:notice:2',
        ],
      },
      {
        name: 'generate-receipt',
        role: 'output',
        path: 'schemas/v2/generate-receipt.schema.json',
        uri: 'urn:bubble-matrix-map:schema:generate-receipt:2',
        dependsOn: ['urn:bubble-matrix-map:schema:notice:2'],
      },
      {
        name: 'matrix-result',
        role: 'output',
        path: 'schemas/v2/matrix-result.schema.json',
        uri: 'urn:bubble-matrix-map:schema:matrix-result:2',
        dependsOn: [
          'urn:bubble-matrix-map:schema:matrix-settings-effective:2',
          'urn:bubble-matrix-map:schema:notice:2',
        ],
      },
      {
        name: 'matrix-settings',
        role: 'input',
        path: 'schemas/v2/matrix-settings.schema.json',
        uri: 'urn:bubble-matrix-map:schema:matrix-settings:2',
        dependsOn: [],
      },
      {
        name: 'matrix-settings-effective',
        role: 'shared',
        path: 'schemas/v2/matrix-settings-effective.schema.json',
        uri: 'urn:bubble-matrix-map:schema:matrix-settings-effective:2',
        dependsOn: [],
      },
    ],
    exitCodes: [
      { code: 0, meaning: 'success' },
      { code: 1, meaning: 'internal_error' },
      { code: 2, meaning: 'argument_or_config_error' },
      { code: 3, meaning: 'input_error' },
      { code: 4, meaning: 'output_error' },
    ],
    errorCodes: [...CLI_ERROR_CODES],
    errorReasons: [...CLI_ERROR_REASONS],
    capabilities: {
      contractDiscovery: true,
      stdinConfig: true,
      structuredDiagnostics: true,
      localOnly: true,
      deterministicProcessing: true,
      idempotentReuse: true,
      artifactIdentity: true,
      networkAccess: false,
    },
    unsupported: [
      { code: 'NETWORK_DATA_UNAVAILABLE', message: '外部APIやネットワークデータは使用しません。' },
      { code: 'FORCED_TERMINATION_RECEIPT_UNAVAILABLE', message: 'プロセス強制終了後のreceiptは保証しません。' },
    ],
    reservedOutputFields: {
      status: 'emitted',
      generateReceipt: ['artifactId', 'disposition', 'manifest'],
      matrixResult: ['artifactId'],
    },
  }
}
