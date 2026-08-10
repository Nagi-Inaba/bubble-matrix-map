# AI統合ガイド

`bubble-matrix-map`は、AIを内蔵しない決定的なローカルCLIです。
AIエージェントは、`contract --json`で自己記述契約を取得し、設定を`--config -`のstdin JSONで渡せます。
receipt、結果、エラー、診断はversion 2の配布Schemaで検証できます。
SVGは人が図の意味と全体傾向を読む経路、`--result`の結果JSONはセル詳細、実効設定、全警告・診断を取得する経路です。
AIは図から詳細値を再推定せず、結果JSONをSchema検証して使用してください。

成果物ID、manifest、output-root単位のlock、同一成果物の非破壊再利用に対応しています。
contractの`capabilities.artifactIdentity`と`capabilities.idempotentReuse`は`true`です。
`generate`は`artifactId`、`manifest`、`disposition`を返し、
SVG metadata、結果JSON、manifest、receiptを同じIDで対応付けられます。
同一要求と検証済み成果物は無変更で再利用し、要求差、manifest異常、欠落、digest不一致は自動置換せず停止します。

CLI `0.1.1`の描画契約はversion 2です。
artifact manifest Schema version 2は、描画契約version 1と2を形式検証できます。
ただし、現在のCLIが再利用するのは描画契約version 2の成果物だけです。
描画契約version 1のmanifestが同じ出力先にある場合は、`ARTIFACT_CONFLICT`と`reason: manifest_invalid`で停止します。
AIエージェントは自動で`--force`を追加せず、別の出力先を選ぶか、人間へ判断を引き渡してください。

## バージョンと契約

- CLIのバージョンは`bubble-matrix-map --version`で確認する
- `bubble-matrix-map contract --json`で機能とSchemaを取得する
- 成功receipt、失敗receipt、設定、生成結果を配布Schemaで検証する
- `schemaVersion`が未対応なら処理を停止する
- `1.0.0`より前はCLIの正確なバージョンを固定する
- Schemaの破壊的変更では`schemaVersion`を更新する

従来の設定入力Schemaは`matrix-settings.schema.json`です。
JSON整数と`showCounts`を受理する新しい設定入力Schemaは`schemas/v2/matrix-settings.schema.json`です。
CLIはversion 1の数字文字列とversion 2のJSON整数を受理し、内部では整数へ正規化します。
`inspect`が返す`defaultSettings`と生成結果の`settings`は、version 2の全項目必須`matrix-settings-effective.schema.json`へ適合します。
receiptと生成結果は`schemaVersion: 2`で、数値設定はJSON整数、`showCounts`はbooleanです。
root直下のversion 1 Schemaはbyte-frozenで同梱しますが、現在のCLIはversion 1 receiptを返しません。
入力設定で`showCounts: true`を指定すると、全非空セルの右上へ件数バッジを表示します。
既定値は`false`で、AIが必要性を確認せず有効化する設定ではありません。

Schemaは参照先を自動取得しません。
contractの`schemas[].dependsOn`に列挙されたSchemaを、対象Schemaと同じregistryへ登録してください。

## 推奨フロー

1. 信頼できるローカル入力か確認する。
2. contractを取得し、CLIバージョンと対応するSchemaを固定する。
3. `inspect`を実行し、stdoutの1行JSONを検証する。
4. 利用者が軸、期間、分類粒度を確認する。
5. 信頼境界ごとに専用output rootを選ぶ。
6. `generate`を`--force`なしで実行する。
7. exit code、stdout、stderrを別々に取得する。
8. 成功receipt、生成結果JSON、manifestをSchema検証する。
9. `disposition`を記録し、`artifactId`が各成果物で一致することを確認する。

## ストリームと終了コード

成功した`contract`、`inspect`、`generate`はstdoutへ1行JSONを書き、stderrを空にします。
失敗時はstdoutを空にし、stderrへ1行JSONを書きます。

| 終了コード | 分類 | 自動処理 |
| --- | --- | --- |
| 0 | 成功 | receiptをSchema検証して次へ進む |
| 1 | 未分類の内部エラー | 自動再試行せず、人間へ引き渡す |
| 2 | 引数または設定 | 入力契約を修正する |
| 3 | 入力読込または解析 | 入力形式と信頼性を人間が確認する |
| 4 | 出力または書込 | `code`と`reason`に従い、競合、lock、権限を区別する |

stderrの自然言語`message`を分岐条件に使わないでください。
分岐には`code`、`reason`、`retryable`と終了コードを使います。
command、option、JSON propertyはASCIIの機械契約です。
`code`、`reason`、enum、Schema URIもASCII表記を維持します。
help、contractとnoticeの`message`や`description`は、日本語の人向け文字列です。
unsupportedの説明、SVGの見出し、説明、アクセシビリティ注記も人向け文字列です。
これらの文言は、互換性を固定する分岐契約ではありません。
OSや依存ライブラリに由来する安全化済みの断片は環境によって表記が変わる場合があります。
`field`、`allowedValues`、`details`は該当する場合だけ返ります。
`details`には上限や件数などの安全な値だけを含め、設定本文や絶対パスを反射しません。

診断と警告にも安定した`code`と`severity`があります。
`warnings`配列には`severity: "info"`の通知も含まれるため、プロパティ名だけで再試行や停止を決めないでください。

## stdin設定

`--config`の供給元は、未指定、単一ファイル、`-`で選ぶstdinのいずれか一つです。
入力データから推定した初期値に、選択した設定を上書きします。
stdinはUTF-8 JSON、上限1,048,576バイトで、BOMを許容します。
空入力、不正JSON、上限超過、stream errorは、設定本文を反射しない構造化エラーになります。
stream errorだけは`retryable: true`で、正常EOF後の不完全JSONは再試行不可です。

## 既定で無効にするオプション

- `--include-samples`：入力セル値がstdoutへ出る
- `--include-paths`：利用者名やプロジェクト名を含む絶対パスが出る
- `--force`：既存成果物を置き換える

AIエージェントが独自判断でこれらを有効にしてはいけません。
利用者が目的と出力先を確認した場合だけ、個別に許可してください。

## 再試行と部分確定

`generate`はoutput root直下の`.bubble-matrix-map.lock`を排他的に作成します。
同じoutput rootで別処理が進行中なら`OUTPUT_BUSY`、`retryable: true`で停止します。
別の出力名でも同じrootでは並行生成しない設計です。

初回に全対象が存在しなければ`created`、manifest、成果物集合、digestが完全一致すれば`reused`です。
`reused`では`--force`の有無にかかわらずファイルと更新時刻を変更しません。
一部欠落、manifest異常、要求差、digest不一致は`ARTIFACT_CONFLICT`、`retryable: false`です。
AIは自動で`--force`を追加せず、人間が既存成果物を確認した場合だけ置換を実行してください。
置換成功時の`disposition`は`replaced`です。
新しい要求から外れた旧result JSONは自動削除しません。
manifestの`files`にない旧ファイルを削除する判断は、人間へ引き渡してください。

競合置換では古いmanifestを先に除去し、SVGと結果JSONの後に新しいmanifestを最後に確定します。
強制終了後は構造化receiptを保証しませんが、不完全な集合は次回に正常な再利用対象になりません。
lockが残った場合は、同じoutput rootでプロセスが動いていないことを外部で確認してからlockだけを除去し、
まず同じ要求を`--force`なしで再試行してください。

manifestのファイルパスはoutput rootからの相対形式です。
Schema検証後も`files[].path`の重複がないことを確認してください。
JSON Schema標準では配列内の別オブジェクトにある文字列値を相互比較できないため、この一意性はmanifestの意味検証に含まれます。
成果物IDは入力バイト列、実効設定、CLI・描画契約、結果JSONの有無、パス開示モードなどから導出します。
入力本文を直接含みませんが、同じ要求を相関できる安定IDであり、秘密値ではありません。
低エントロピーの入力を推測される懸念がある外部環境では、receiptとmanifestも機密成果物として扱ってください。

## 決定性と責任分界

同じCLIバージョン、入力バイト列、設定、対応Node.js環境では、同じ集計順とSVGを生成します。
この性質は、選んだ軸、期間、分類粒度が業務上適切であることを保証しません。

AIは`inspect`の推奨設定を確定判断として扱わず、利用者へ実効設定を提示してください。
入力内容、分析目的、出力の解釈は利用者が確認します。
