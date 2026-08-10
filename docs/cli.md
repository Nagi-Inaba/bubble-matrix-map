# CLI操作ガイド

## 目的

`bubble-matrix-map` は、ローカルのCSV、TSV、Excel `.xlsx` からバブルマトリクスマップを自動生成するためのCLIです。

AIエージェントやスクリプトから呼び出せますが、CLI自体はAI機能、外部API、インターネット通信を持ちません。

AIワークフローへ組み込む場合は、[AI統合ガイド](ai-integration.md)の安全な呼出し条件も確認してください。

## 列と推奨設定の確認

初めて扱うファイルでは、先に `inspect` を実行します。

```powershell
npm run --silent cli -- inspect --input .\examples\cli-demo.csv
```

標準出力は1行のJSONです。

列名、列種別、空欄数、ユニーク数、推奨設定、読込診断を取得できます。

セル値は機密情報になり得るため、既定のJSONには含めません。

内容を標準出力へ出してよい場合だけ `--include-samples` を追加すると、各列の先頭3種類までを取得できます。

## SVGの生成

`generate` は、グラフをSVGとして保存します。

```powershell
npm run --silent cli -- generate `
  --input .\examples\cli-demo.csv `
  --output .\output\matrix-map.svg `
  --config .\examples\matrix-config.v2.example.json `
  --result .\output\matrix-result.json
```

`--result` を指定すると、実効設定と集計結果をJSONでも保存します。
SVGへ収めきれないセル単位の完全な集計、全警告・診断、設定値は、この結果JSONを詳細データの代替経路として確認してください。

SVGと同じディレクトリには、`<SVG名>.manifest.json`も生成します。
manifestは成果物ID、CLIと描画契約のversion、成果物の相対パス、SHA-256、バイト数を記録します。

CLI `0.1.1`の描画契約はversion 2です。
描画契約version 1のmanifestは形式検証できますが、現在のCLIでは再利用できません。
同じ出力先に旧manifestがある場合は`ARTIFACT_CONFLICT`で停止します。
別の出力先を選ぶか、成果物を確認してから`--force`を指定してください。

同じ要求でmanifestと全成果物が一致する場合は、ファイルを変更せず`disposition: "reused"`で成功します。
要求、ファイル集合、digestのいずれかが異なる場合は`ARTIFACT_CONFLICT`で停止します。
確認済みの競合を置き換える場合だけ `--force` を追加してください。
`--force`を付けても完全一致の成果物は書き換えず、`reused`のままです。

出力先は既定で現在の作業ディレクトリ配下に制限されます。

別の場所へ保存する場合は、その保存先を `--output-root <directory>` で明示し、SVGと集計JSONをその配下へ置いてください。

生成中はoutput root直下の`.bubble-matrix-map.lock`で、同じoutput rootへの並行書込を防ぎます。
競合置換では古いmanifestを先に外し、SVG、結果JSON、manifestの順に確定します。
manifestが最後に確定するため、中断後に不完全な集合を正常成果物として再利用しません。

## 繰り返し実行

`npm run cli` は実行前にCLIを再ビルドします。

同じソースを繰り返し使う場合は、一度だけビルドしてから直接起動できます。

```powershell
npm run build:cli
node .\bin\bubble-matrix-map.mjs inspect --input .\examples\cli-demo.csv
```

CLIバンドルはNode.js 22以降を対象にしています。

バージョンは次のコマンドで確認できます。

```powershell
node .\bin\bubble-matrix-map.mjs --version
```

サブコマンドごとの必須引数、任意引数、取り扱いに注意が必要なオプションは、次のhelpで確認できます。
終了コードと実行例も同じhelpに表示します。

```powershell
node .\bin\bubble-matrix-map.mjs inspect --help
node .\bin\bubble-matrix-map.mjs generate --help
```

`help inspect`と`help generate`も同じ内容を表示します。

機械可読なコマンド、オプション、Schema、終了コード、機能対応状況は次の1行JSONで取得できます。

```powershell
node .\bin\bubble-matrix-map.mjs contract --json
```

npm tarballとして使う場合は `npm pack` でCLIバンドルを含むパッケージを作成できます。

## 設定JSON

設定JSONは、`MatrixSettings`で定義した項目の一部または全部を指定します。

省略値には入力データから推定した設定を使います。

未知のキー、存在しない列、範囲外の数値、許可されていない選択値は終了コード2で拒否します。

`--config -`を指定すると、UTF-8のJSON設定を標準入力から受け取ります。
供給元は「省略」「単一の設定ファイル」「stdin」のいずれか一つです。
入力データから推定した初期値に、選択した設定だけを上書きします。
`--input`、`--output`、`--force`などのCLI制御値は`MatrixSettings`へマージしません。

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

Get-Content -Raw -Encoding UTF8 .\examples\matrix-config.v2.example.json |
  node .\bin\bubble-matrix-map.mjs generate `
    --input .\examples\cli-demo.csv `
    --output-root .\output `
    --output matrix-map.svg `
    --config -
```

Windows PowerShell 5.1は、既定ではnative processへのpipeをUTF-8で送らないため、先頭の3行を省略しないでください。

主な設定は次のとおりです。

- `xAxis`、`yAxis`：マトリクスの軸に使う列名
- `pieSourceMode`：`column` または `year_bucket`
- `pieColumn`：円グラフの区分に使う列名
- `yearColumn`：年区分に使う列名
- `xLimit`、`yLimit`：表示する上位カテゴリ数。1から20
- `pieTopN`：表示する円グラフ区分数。2から12
- `includeAxisOther`：上位外を「その他」として含めるか
- `periodStart`、`periodEnd`：両方を西暦4桁で指定する対象期間
- `periodBoundaries`：昇順に並べた3件の西暦境界年

`xLimit`、`yLimit`、`pieTopN`、`recentYears`は、JSON整数で指定できます。
既存の設定との互換性のため、`"8"`のような数字だけの文字列も受理し、内部では整数へ正規化します。
値として小数になるJSON数値は受理しません。
数字文字列では、`"8.0"`のような小数表記、`"8e0"`のような指数表記、`"08"`のような先頭ゼロ付き表記を受理しません。
期間の年と`periodBoundaries`は、引き続き`"2020"`、`"2018, 2021, 2024"`のような文字列で指定します。

件数の数字表示は`showCounts`で切り替え、既定値は`false`です。
`true`にすると、すべての非空セルの右上へ、背景と境界を持つ件数バッジを表示します。
バッジはpieの中央を隠さず、表示の有無によって集計値、バブルサイズ、SVG寸法は変わりません。

`classificationSplitMode` が `all` の場合、1行に複数のpie分類があれば各分類をフルカウントします。結果JSONの `rowCount` はセルに含まれる一意な行数、`total` と各 `slices[].value` はpie分類の出現数です。単一分類または年区分では `rowCount` と `total` は一致します。

従来の文字列数値だけを表すversion 1契約は[設定JSON Schema v1](../schemas/matrix-settings.schema.json)、
JSON整数と`showCounts`を受理する入力契約は[設定JSON Schema v2](../schemas/v2/matrix-settings.schema.json)を参照してください。
成功receiptと生成結果は`schemaVersion: 2`で、実効設定の数値はJSON整数、`showCounts`はbooleanです。
root直下のversion 1 Schemaは旧契約の検証用に保持していますが、現在のCLIはversion 1 receiptを生成しません。

## 自動処理向けの契約

`contract`、`inspect`、`generate`の成功時は、標準出力に`schemaVersion: 2`と`ok: true`を含む1行JSONを出します。

既定の成功JSONと生成結果JSONは、入力をbasename、出力をoutput rootからの相対パスで記録します。

ローカル自動化で絶対パスが必要な場合だけ、`inspect`または`generate`へ`--include-paths`を追加してください。

成功receipt、エラーreceipt、生成結果の配布契約は [schemas](../schemas/) を参照してください。
`generate` receiptの`disposition`は、初回作成の`created`、検証済み再利用の`reused`、`--force`による競合置換の`replaced`です。
`artifactId`はSVG metadata、結果JSON、manifest、receiptで一致します。

失敗時は標準エラーに`ok: false`、`code`、`reason`、`retryable`、人向けの日本語`message`を含む1行JSONを出します。
分岐には`message`の部分一致ではなく、安定した`code`と`reason`を使ってください。
人向け文言は改善時に変わり得ます。OSや依存ライブラリに由来する安全化済みの断片は環境依存です。
診断と警告も`code`、`severity`、`message`、任意の`field`と安全な集計`details`を持ちます。
`warnings`というプロパティ名だけで重大度を決めず、各要素の`severity`を確認してください。

終了コードは次のとおりです。

- `0`：成功
- `1`：分類外の内部エラー
- `2`：コマンド、引数、設定の誤り
- `3`：入力ファイルの読込または解析エラー
- `4`：出力先または書込エラー

### 失敗時の復旧

| 症状 | 確認すること | 次の操作 |
| --- | --- | --- |
| 終了コード2 | 引数、設定JSON、列名、数値範囲 | stderrの`code`を確認し、設定を修正する |
| 終了コード3 | 入力形式、文字コード、Excel保存状態 | CSVを対応文字コードで保存するか、Excelを再計算して保存する |
| `ARTIFACT_CONFLICT` | manifest、成果物、要求条件の不一致 | `reason`を確認し、内容を確認した場合だけ`--force`を使う |
| `OUTPUT_BUSY` | 同じoutput rootの生成処理、残存lock | 実行中なら待つ。実行中でないと確認できた場合だけlockを除去して再試行する |
| その他の終了コード4 | 出力ルート、書込権限 | 出力先と権限を確認し、必要な場合だけ`--output-root`を変更する |
| `.xls`を読めない | `.xls`は対象外 | Excelで`.xlsx`またはCSVへ保存し直す |
| 読みたいExcelシートが違う | 最初の可視シートだけを読む | 対象シートを最初の可視シートにして保存する |
| CSVが文字化けする | UTF-8、UTF-16LE、UTF-16BE、Shift_JIS以外の可能性 | 対応文字コードへ保存し直す |

Excel数式はCLI内で再計算しません。
保存済みの計算結果がない場合は、Excelで再計算して保存してから読み込んでください。
`--force`は既存ファイルを置き換えるため、内容を確認した利用者だけが指定してください。
`--force`はlockを迂回しません。
中断後にlockが残った場合は、同じoutput rootで生成処理が動いていないことを確認してから、
`.bubble-matrix-map.lock`だけを削除し、まず`--force`なしで再試行してください。
manifest欠落やdigest不一致が返った場合は成果物を確認し、置換してよいと判断した場合だけ`--force`を使います。
以前は`--result`を指定し、次の要求では省略した場合、古い結果JSONをCLIが自動削除することはありません。
新しいmanifestの対象外になったファイルは、内容と利用状況を確認してから利用者が別途整理してください。

実データはリポジトリへコピーせず、入力パスから直接読み込みます。

## 決定性の範囲

同じCLIバージョン、入力バイト列、設定では、同じカテゴリ順と集計値を生成します。
対応Node.js環境も同じであれば、同じSVGを生成します。
OS固有のパス表現は既定receiptへ含めません。
成果物IDは入力バイト列と実効設定などから導出する安定した相関識別子です。
入力本文やパスを直接表しませんが、同じ要求の照合に使えるため、外部公開時は識別情報として扱ってください。

`inspect`の推奨設定は列種別と列順から作る初期候補です。
業務上適切な軸、期間、分類粒度や、分析上の妥当性は保証しません。
生成前に利用者が実効設定を確認してください。

## 入力と出力の安全上限

- CSVとTSVは256MBまで、Excel `.xlsx` は96MBまで読み込む
- データは10万行、500列、合計500万セルまで受け付ける
- Excel内の1エントリは展開後64MB、全体は展開後256MBまで検査する
- ファイルとstdinの設定JSONは1,048,576バイトまでとし、UTF-8 BOM付きJSONも読み込む
- 出力パス内のシンボリックリンクとWindowsジャンクションは拒否する

入力ファイルはリポジトリ外へ置いてください。
`.gitignore` は任意のCSV、TSV、Excelファイルを既定で除外し、`examples/` の小さな架空データだけを許可します。

ExcelはZIP展開検査後もワークブック全体をメモリへ読み込みます。
読み取り対象は最初の可視シートです。
出所不明のExcelファイルや、上限近くの複数ワークシートを含むファイルは読み込まないでください。

出力先には、現在の利用者だけが書き換えられるローカルディレクトリを指定してください。
他の利用者が同時に書き換えられる出力先へ、管理者権限で実行する使い方は対象外です。
