# database_consistency の CI 整備ガイド

[SKILL.md](../SKILL.md) の「1-4. CI（継続的検証）を整える」から参照する、CI セットアップの
詳細ガイド。**プロジェクト非依存の要点**を先にまとめ、後半に具体例（ある Rails プロジェクトの
GitHub Actions を素材に汎用化したもの）を置く。具体例の固有値は自分のプロジェクトの CI 規約に
読み替えること。

## 目次

1. [なぜ CI が要るのか](#なぜ-ci-が要るのか)
2. [CI に必要な要素（プロジェクト非依存）](#ci-に必要な要素プロジェクト非依存)
3. [具体例（GitHub Actions）](#具体例github-actions)
4. [導入時のチェックリスト](#導入時のチェックリスト)

## なぜ CI が要るのか

段階導入の価値は「**一度有効化したチェッカーを以後リグレッションさせない**」点にある。
チェッカーを `.database_consistency.yml` の列挙から削除して有効化しても、CI で回していなければ
その後のモデル追加・スキーマ変更で違反が再混入しても気づけない。`bundle exec
database_consistency` は違反検出時に**非ゼロ終了**するので、これを PR で回せば「有効化済みの
チェッカーに反する変更」を自動で fail にできる。これが段階導入を「やりっぱなし」にしない要。

## CI に必要な要素（プロジェクト非依存）

database_consistency を CI で動かすには、最低限この4つが要る。どの CI サービスでも本質は同じ。

1. **DB サービス** — gem は DB スキーマを読むため DB 接続が必須。アプリが使う RDBMS と同じ
   種類・できれば同じメジャーバージョンのサービスを立てる（環境差を小さく保つ）。
2. **スキーマのロード** — 空の DB にスキーマを反映する。`db:schema:load`（schema.rb/structure.sql
   から）か `db:migrate`（マイグレーション適用）のどちらか、プロジェクトの流儀に合わせる。
3. **`bundle exec database_consistency` の実行** — これが本体。違反があれば非ゼロ終了で
   ジョブが fail する。
4. **発火条件を絞る（任意だが推奨）** — チェック対象に影響するファイルが変わったときだけ
   走らせると速い。具体的にはモデル定義・スキーマ・`.database_consistency.yml` の変更時。
   関係ない変更でも毎回フル実行するのは無駄になりやすい。

これらに加え、Ruby のセットアップと `bundle install`（依存解決）は通常のテストジョブと共通。
**プロジェクトに既存の「テスト環境セットアップ」があれば、それを再利用するのが最も確実**
（Ruby/Node/DB 作成などを二重に書かずに済み、本体ジョブと環境差も出ない）。

## 具体例（GitHub Actions）

以下は、ある Rails プロジェクト（PostgreSQL + 既存の composite action でテスト環境を構築）の
`.github/workflows/database_consistency.yml` を素材にした例。**`runs-on` の値・postgres の
バージョン・ロケール・composite action のパスなどはすべてプロジェクト依存**なので、自分の
CI 規約・既存ワークフローに読み替えること。コピペ用ではなく「構造の参考」として読む。

```yaml
name: DatabaseConsistency

on:
  pull_request:
    # 発火条件を絞る: チェック結果に影響するファイルが変わったときだけ走らせる
    paths:
      - "app/models/**"
      - "db/schema.rb"
      - ".database_consistency.yml"
      - ".github/workflows/database_consistency.yml"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  database_consistency:
    runs-on: ubuntu-latest        # プロジェクト依存（self-hosted / arm ランナー等に読み替え）
    timeout-minutes: 10

    # 1. DB サービス: アプリが使う RDBMS と同種・同バージョンを立てる
    services:
      postgres:
        image: postgres:17        # プロジェクト依存: アプリの DB バージョンに合わせる
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5

    env:
      RAILS_ENV: test
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres

    steps:
      - uses: actions/checkout@v6

      # 2. テスト環境セットアップ（Ruby/依存解決/DB作成・schema:load）。
      #    既存の composite action があれば再利用するのが確実。
      #    無ければ ruby/setup-ruby + bundle install + rake db:create db:schema:load を並べる。
      - name: Setup environment
        uses: ./.github/actions/project-setup

      # 3. 本体: 違反があれば非ゼロ終了でジョブが fail する
      - name: Run database_consistency
        run: bundle exec database_consistency
```

### 再利用する composite action（参考）

上の例の `./.github/actions/project-setup` のような composite action は、Ruby セットアップ・
`bundle install`・**DB 作成と `db:schema:load`** までを1箇所にまとめておくと、テスト系の
複数ワークフローで使い回せる。要点だけ抜くと次の構造になる（固有のパッケージ導入や
ロケール設定はプロジェクト依存なので割愛）。

```yaml
# .github/actions/project-setup/action.yml （抜粋・要点のみ）
runs:
  using: 'composite'
  steps:
    - uses: ruby/setup-ruby@v1
      with:
        bundler-cache: true        # bundle install をキャッシュ付きで実行
    - name: Setup database
      shell: bash
      run: |
        bundle exec rake db:create
        bundle exec rake db:schema:load
```

> NOTE: ここで `db:schema:load` を使っているのは schema.rb からスキーマを一発で反映するため。
> マイグレーションの適用順を検証したい場合は `db:migrate` に置き換えるなど、プロジェクトの
> 方針に合わせる。

## 導入時のチェックリスト

- [ ] DB サービスはアプリと同種・できれば同バージョンか
- [ ] スキーマがロードされているか（`db:schema:load` または `db:migrate`）
- [ ] `bundle exec database_consistency` が実行され、fail が CI に伝播するか
- [ ] 発火条件をモデル/スキーマ/設定ファイルの変更に絞れているか
- [ ] 既存のテスト環境セットアップ（composite action 等）を再利用できていないか確認したか
