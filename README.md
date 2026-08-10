# Bubble Matrix Map

`bubble-matrix-map`は、CSV、TSV、Excel `.xlsx`から円グラフ付きのバブルマトリクスマップを生成するCLIです。

入力データを外部へ送信せず、SVGと集計JSONをローカルに生成します。

CLI自体にAI機能、外部API、インターネット通信はありません。

現在のバージョンは`0.1.1`です。

## 生成できる成果物

- 入力列、空欄数、ユニーク数、初期設定候補を含む実行結果JSON
- 任意のX軸、Y軸、円グラフ区分から作るSVG
- 実効設定、セル集計、凡例、除外件数を含む結果JSON
- 成果物ID、相対パス、SHA-256、バイト数を記録するマニフェスト
- IPC、FI、Fタームなどを指定した粒度へまとめた集計

成功する`contract`、`inspect`、`generate`は、標準出力へ一行の実行結果JSONを返します。

失敗時は、標準エラーへ一行のエラーJSONを返します。

## 必要な環境

- Node.js 22以降
- Node.jsに付属するnpm
- Git（`git clone`を使う場合）
- WindowsまたはUbuntu

以下の実行例はWindows PowerShell向けです。

同じCLI契約をUbuntu上のCIでも検証しています。

## ソースから実行する

```powershell
git clone https://github.com/Nagi-Inaba/bubble-matrix-map.git
cd bubble-matrix-map
npm ci
npm run build:cli
node .\bin\bubble-matrix-map.mjs --version
```

npmレジストリからのインストールは提供していません。

Gitを使わない場合は、GitHubの「Code」から「Download ZIP」を選びます。

ZIPを展開したフォルダで`npm ci`と`npm run build:cli`を実行してください。

## 入力を検査する

初めて扱うファイルでは、先に`inspect`で列と初期設定候補を確認します。

```powershell
$receipt = node .\bin\bubble-matrix-map.mjs inspect `
  --input .\examples\cli-demo.csv |
  ConvertFrom-Json

$receipt.columns
$receipt.defaultSettings
```

セル値は機密情報になり得るため、既定の出力には含めません。

各列のセル例が必要な場合だけ、内容を確認して`--include-samples`を指定してください。

## SVGと結果JSONを生成する

`inspect`で確認した設定を使って`generate`を実行します。

```powershell
node .\bin\bubble-matrix-map.mjs generate `
  --input .\examples\cli-demo.csv `
  --output-root .\output `
  --output matrix-map.svg `
  --config .\examples\matrix-config.v2.example.json `
  --result matrix-result.json

Invoke-Item .\output\matrix-map.svg
```

成功すると、SVG、結果JSON、成果物マニフェストを`output`フォルダへ保存します。

標準出力には、`artifactId`と`disposition`を含む一行の実行結果JSONが出ます。

同一の要求と検証済み成果物は、`disposition: "reused"`として書き換えずに再利用します。

内容または条件が異なる既存成果物は、`ARTIFACT_CONFLICT`で停止します。

CLIが既存成果物を暗黙に置き換えることはありません。

## 設定を標準入力から渡す

設定JSONをファイルへ保存しない場合は、`--config -`で標準入力から渡せます。

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

'{"xAxis":"IPC","yAxis":"出願人","showCounts":false}' |
  node .\bin\bubble-matrix-map.mjs generate `
    --input .\examples\cli-demo.csv `
    --output-root .\output `
    --output matrix-map-stdin.svg `
    --config -
```

先頭の三行は、Windows PowerShell 5.1から日本語のJSONをUTF-8で渡すために必要です。

PowerShell 7でも同じ例を使用できます。

## SVGと結果JSONの役割

SVGには、図のタイトル、軸名、対象期間、入力件数を含めます。

表示件数、除外件数、凡例もSVGから確認できます。

バブルサイズと分類パターンの読み方もSVGから確認できます。

セルごとの完全な集計、実効設定、警告、診断、元の長いラベルは、`--result`で生成する結果JSONに記録します。

SVGのmetadata、結果JSON、成果物マニフェスト、実行結果JSONは、同じ`artifactId`で対応付けられます。

## 成果物の互換性

バージョン`0.1.1`の描画契約は`2`です。

描画契約`1`で作成した既存マニフェストは、Schemaによる形式確認には使用できます。

ただし、`0.1.1`は描画契約`1`の成果物を同一成果物として再利用しません。

同じ出力先を使うと`ARTIFACT_CONFLICT`で停止するため、別の出力先を選ぶか、内容を確認して`--force`を指定してください。

## Excel入力

`.xlsx`はCSVと同じ`--input`へ指定できます。

CLIは最初の可視シートだけを読みます。

数式は再計算せず、ファイルへ保存された計算結果を使用します。

`.xls`は対象外なので、Excelで`.xlsx`またはCSVへ保存し直してください。

## 決定性と設定確認

同じCLIバージョン、入力バイト列、設定、対応Node.js環境では、同じ集計順とSVGを生成します。

`inspect`の初期設定候補は、列の種類と並びから求めます。

業務上適切な軸、期間、分類粒度を保証するものではありません。

生成前に利用者が実効設定を確認してください。

## 入力と出力の安全性

信頼できるローカルのCSV、TSV、Excel `.xlsx`だけを入力してください。

実データをリポジトリへコピーしないでください。

共有書込フォルダと、管理者権限を必要とする出力先は対象外です。

既定のJSONには、絶対パスとセル例を含めません。

必要性を確認した場合だけ、`--include-paths`または`--include-samples`を指定してください。

`--force`は既存成果物を置き換えるため、内容を確認した利用者だけが指定してください。

## 機械可読な契約

自動処理では、実行前にCLI契約を取得できます。

```powershell
$contract = node .\bin\bubble-matrix-map.mjs contract --json |
  ConvertFrom-Json

$contract.capabilities
$contract.schemas
```

既定の実行結果JSONと結果JSONは`schemaVersion: 2`です。

現在の契約は[version 2 JSON Schema](schemas/v2/)で確認できます。

root直下のversion 1 Schemaは、旧契約を検証するために保持しています。

AIワークフローへ組み込む場合は、[AI統合ガイド](docs/ai-integration.md)の再試行条件と禁止事項を確認してください。

## 開発時の検証

```powershell
npm run verify
npm run audit:public-tree
npm run audit:public-copy
```

`npm run verify`は、テスト、型検査、lint、buildを実行します。

依存関係監査、ライセンス監査、npm tarball検査も同じコマンドに含まれます。

## 文書と連絡先

- [CLI操作ガイド](docs/cli.md)
- [AI統合ガイド](docs/ai-integration.md)
- [セキュリティモデル](docs/security-model.md)
- [脆弱性の報告](SECURITY.md)
- [利用支援](SUPPORT.md)
- [変更提案](CONTRIBUTING.md)
- [ライセンス](LICENSE)
- [第三者通知](THIRD_PARTY_NOTICES)
