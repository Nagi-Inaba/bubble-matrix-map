# 変更履歴

## 0.1.1 - 2026-08-10

- READMEと利用者向けガイドを、初めて実行する開発者向けに更新しました。
- CLI、診断、SVGに表示する日本語の区切り、空白、用語を統一しました。
- 描画契約をversion 2へ更新し、表示内容が異なる成果物を別のartifact IDとして扱うようにしました。
- artifact manifest Schema version 2で、描画契約version 1と2を検証できるようにしました。
- 描画契約version 1の既存成果物を暗黙に再利用せず、`ARTIFACT_CONFLICT`で停止する移行手順を追加しました。
- ソース配布物のallowlist、機密情報と文書品質の監査、安全なclean export検証を追加しました。
- Issueとpull requestのtemplateへ、目的、対象範囲、受入条件、契約への影響、検証結果を追加しました。
- npm tarballの収録文書を、利用者向けガイドに限定しました。

## 0.1.0 - 2026-07-23

- Bubble Matrix Map CLIの初版を追加しました。
- package名と実行ファイル名を`bubble-matrix-map`へ変更しました。
- CSV、TSV、Excel `.xlsx`の入力と、SVG、結果JSON、成果物マニフェストの出力を追加しました。
- `contract --json`、`inspect`、`generate`、`help`、`version`を追加しました。
- version 2の設定、実行結果、結果JSON、診断、エラーSchemaを追加しました。
- version 1 Schemaを旧契約の検証用として保持しました。
- 成果物ID、SHA-256、出力ルートのlock、同一成果物の再利用、競合停止を追加しました。
- 出力先のsymlinkとjunctionを拒否し、入力と出力の資源上限を追加しました。
- SVGへタイトル、軸、期間、凡例、アクセシビリティmetadataを追加しました。
- バブルの平方根scale、非色pattern、通常色とgrayscaleの視覚回帰testを追加しました。
- JSON整数を受理する設定Schemaと、件数badgeを表示する`showCounts`を追加しました。
- npm tarball、依存関係、ライセンス、WindowsとUbuntuのCI検証を追加しました。
