# skills

個人用の AI エージェント skill 集。Claude Code をはじめとする複数の AI エージェントプラットフォームで利用できる skill をまとめたリポジトリ。

各 skill は対応プラットフォームのフォーマットに従ったファイルとして管理する。

## スキル一覧

| スキル名 | 説明 |
|----------|------|
| [icon-generator](skills/icon-generator/) | SVGソースからPNGアイコンアセットを生成する |
| [pr-summary](skills/pr-summary/) | GitHub PR URLを受け取り、日本語でサマリーを生成する |
| [diy-drawing](skills/diy-drawing/) | 自然言語からDIY家具・木工図面（カット図・寸法図・組み立て図・材料リスト）を生成する |
| [claude-md-to-rules](skills/claude-md-to-rules/) | サブディレクトリの CLAUDE.md を `.claude/rules/` 配下のパス固有ルールファイルへ変換する |
| [llm-wiki](skills/llm-wiki/) | 個人の知識をWiki・ナレッジベースとして永続的に蓄積・管理する |
| [japan-finance-expert](skills/japan-finance-expert/) | 日本の個人金融制度（新NISA・iDeCo等）に関する質問に専門家として回答する |
| [pr-tidy-classifier](skills/pr-tidy-classifier/) | GitHub PR を Tidy First? パターンで分類し、構造的リファクタリングかを判定する |
| [claude-rules-import](skills/claude-rules-import/) | 別プロジェクトの `.claude/rules` から固有情報を取り除いて自プロジェクトに取り込む |
| [commit](skills/commit/) | Git コミットを作成する |
| [commit-push-pr](skills/commit-push-pr/) | コミット・プッシュして PR を作成する |
| [trim-agent-doc](skills/trim-agent-doc/) | 指定した Markdown ドキュメントから AI エージェントに自明・冗長な記述を削って簡潔にする |
| [ruby-rails-ci-matrix](skills/ruby-rails-ci-matrix/) | Ruby gem の CI でテストする Ruby・Rails のバージョンマトリクスを保守する |
