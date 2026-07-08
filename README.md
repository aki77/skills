# skills

個人用の AI エージェント skill 集。Claude Code をはじめとする複数の AI エージェントプラットフォームで利用できる skill をまとめたリポジトリ。

各 skill は対応プラットフォームのフォーマットに従ったファイルとして管理する。

## git

| スキル名 | 説明 |
|----------|------|
| [commit](skills/git/commit/) | Git コミットを作成する |
| [commit-push-pr](skills/git/commit-push-pr/) | コミット・プッシュして PR を作成する |

## github

| スキル名 | 説明 |
|----------|------|
| [pr-summary](skills/github/pr-summary/) | GitHub PR URLを受け取り、日本語でサマリーを生成する |
| [pr-tidy-classifier](skills/github/pr-tidy-classifier/) | GitHub PR を Tidy First? パターンで分類し、構造的リファクタリングかを判定する |
| [dependabot-triage](skills/github/dependabot-triage/) | Dependabot のPR・設定を診断し、ノイズPRや不要な更新を抑える正しい対処を選ぶスキル |
| [pr-review-comments-resolve](skills/github/pr-review-comments-resolve/) | GitHub PRのレビューコメントのうち、Hide・解決済みでないものだけを抽出して対応する |

## claude

| スキル名 | 説明 |
|----------|------|
| [claude-md-to-rules](skills/claude/claude-md-to-rules/) | サブディレクトリの CLAUDE.md を `.claude/rules/` 配下のパス固有ルールファイルへ変換する |
| [claude-rules-import](skills/claude/claude-rules-import/) | 別プロジェクトの `.claude/rules` から固有情報を取り除いて自プロジェクトに取り込む |
| [trim-agent-doc](skills/claude/trim-agent-doc/) | 指定した Markdown ドキュメントから AI エージェントに自明・冗長な記述を削って簡潔にする |
| [code-review-guideline](skills/claude/code-review-guideline/) | 指定した観点でリポジトリ全体を並列レビューし、重要度別・根拠つきの結果を Markdown 出力する |
| [migrate-rules-to-apm](skills/claude/migrate-rules-to-apm/) | APM未管理の `.claude/rules` ルールと CLAUDE.md を `.apm/instructions/` へ一括移行する |
| [dedupe-apm-local-rules](skills/claude/dedupe-apm-local-rules/) | APMパッケージ由来ルールと重複するプロジェクト固有ローカルルールを検出し縮小・削除する |
| [implement-plan](skills/claude/implement-plan/) | プランモードで作成したプランファイルの内容に沿って、軽量なsonnetモデルで実装フェーズを実行する |

## knowledge

| スキル名 | 説明 |
|----------|------|
| [llm-wiki](skills/knowledge/llm-wiki/) | 個人の知識をWiki・ナレッジベースとして永続的に蓄積・管理する |
| [doc-sync](skills/knowledge/doc-sync/) | コードドキュメントを実際のコード変更に同期させる |

## ruby

| スキル名 | 説明 |
|----------|------|
| [ruby-rails-ci-matrix](skills/ruby/ruby-rails-ci-matrix/) | Ruby gem の CI でテストする Ruby・Rails のバージョンマトリクスを保守する |
| [database-consistency-enable](skills/ruby/database-consistency-enable/) | database_consistency のチェッカーを1つずつ段階的に有効化し、違反を修正または理由付きで個別無効化する |
| [herb-enable-rule](skills/ruby/herb-enable-rule/) | herb-lint の無効化中ルールを1つ有効化する。違反抽出・自動修正の振り分け・exclude 設定・検証・コミットまで一連の流れを再現する |
| [erblint-todo-init](skills/ruby/erblint-todo-init/) | erblint の既存違反をファイル単位で無効化する todo ファイル群を生成・初期化する |

## misc

| スキル名 | 説明 |
|----------|------|
| [icon-generator](skills/misc/icon-generator/) | SVGソースからPNGアイコンアセットを生成する |
| [diy-drawing](skills/misc/diy-drawing/) | 自然言語からDIY家具・木工図面（カット図・寸法図・組み立て図・材料リスト）を生成する |
| [japan-finance-expert](skills/misc/japan-finance-expert/) | 日本の個人金融制度（新NISA・iDeCo等）に関する質問に専門家として回答する |
