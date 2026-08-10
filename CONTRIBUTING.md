# 変更提案

Bubble Matrix Mapへの変更は、ローカル処理と決定的なCLI契約の範囲に限定します。

Electron、React、組込みAI、外部API、インターネット検索、実データは追加しません。

## Issueを作成する

実装前に、変更提案または不具合報告のIssue templateを使用してください。

Issueには、目的と利用者、対象範囲、対象外、受入条件、契約とセキュリティへの影響を記載します。

不具合の場合は、CLIバージョン、OS、再現コマンド、架空の最小データを添えてください。

実データ、絶対パス、認証情報、脆弱性の詳細はIssueへ投稿しないでください。

脆弱性は[セキュリティポリシー](SECURITY.md)に従って非公開で報告してください。

## 変更を実装する

一つのpull requestでは、一つの目的に必要な変更だけを扱います。

CLI command、option、Schema、出力、ファイル境界が変わる場合は、互換性と移行方法を文書へ記載してください。

version付きSchemaを変更する場合は、旧契約を保持できるか確認してください。

SVGの表示が変わる場合は、描画契約と視覚回帰fixtureを更新してください。

## 検証する

reviewを依頼する前に、次のコマンドを実行します。

```powershell
npm run verify
npm run audit:public-tree
npm run audit:public-copy
git diff --check
```

依存関係を変更した場合は、`npm run audit:licenses -- --write`も実行します。

生成されたライセンス一覧の差分を確認し、意図しない依存が入っていないことを確かめてください。

## Pull requestを作成する

pull request templateに、目的、対象範囲、対象外、受入条件を記載します。

契約への影響と検証結果も記載してください。

検証していない項目は、成功したように記載せず、未実施の理由を明示してください。
