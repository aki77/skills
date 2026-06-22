# dependabot.yml 設定例（npm / bundler）

`package-ecosystem` 単位の完全なブロック例。固有名は、広く通用する実例（`@types/node` 等）は具体名で、それ以外は placeholder（`<package-name>` `<org>/<repo>` `<vX.Y.Z>`）にしてある。流用時はそのまま雛形として使い、依存名を差し替える。

- [npm](#npm)
- [bundler](#bundler)
- [github-actions](#github-actions)
- [git参照gem を tag pin する（Gemfile）](#git参照gem-を-tag-pin-する-gemfile)
- [ワークフロー側: Dependabot PR の権限明示 / スキップ](#ワークフロー側-dependabot-pr-の権限明示--スキップ)

## npm

minor/patch を1本のPRにまとめ（`groups`）、メジャーは上げたくない依存だけ `ignore` で抑える例。`@types/node` は「型定義パッケージをランタイム本体（Node）のメジャーに合わせて固定したい」典型例。

```yaml
  - package-ecosystem: "npm"
    directory: "/"
    cooldown:
      # リリース直後の不安定な版を避けるため、公開後N日経つまでPRを作らない
      default-days: 7
    ignore:
      # @types/node のメジャーは Node 本体のバージョン（package.json の engines など）に
      # 合わせて固定する。メジャー昇格PRは不要なので無視し、minor/patch は許可する。
      - dependency-name: "@types/node"
        update-types:
          - "version-update:semver-major"
    schedule:
      interval: "weekly"
    groups:
      npm-minor-and-patch:
        update-types:
          - "minor"
          - "patch"
```

ポイント：

- `ignore` の `version-update:semver-major` は**そのメジャー更新PRを作らせない**だけ。minor/patch は `groups` 側で引き続き上がる。
- マニフェスト（package.json）の `^24.x.x` のような range 制約も、それ自体がメジャー昇格を防ぐ。`ignore` と二重にすると、Dependabot が range ごと書き換えるPRも止められて堅い。

## bundler

npm と同型。`groups` で minor/patch をまとめ、固定したい gem は `ignore` する。

```yaml
  - package-ecosystem: "bundler"
    directory: "/"
    cooldown:
      default-days: 7
    ignore:
      # メジャーを上げたくない gem。理由を必ずコメントで残す（後任が誤って外さないように）。
      - dependency-name: "<package-name>"
        update-types:
          - "version-update:semver-major"
    schedule:
      interval: "weekly"
    groups:
      bundler-minor-and-patch:
        update-types:
          - "minor"
          - "patch"
```

## github-actions

`groups`（`patterns: ["*"]`）で全アクションを1本のPRにまとめ、**メジャータグ参照**しているアクションは minor/patch を `ignore` してメジャー更新だけ通す例。`actions/checkout` は `uses: actions/checkout@v7` のようにメジャータグ参照する典型。

```yaml
  - package-ecosystem: "github-actions"
    directory: "/"
    cooldown:
      default-days: 5
    ignore:
      # actions/checkout は @v7 のようにメジャータグ参照しているので、
      # minor/patch はタグ側が自動追従する。意味のあるメジャー更新だけ通す。
      - dependency-name: "actions/checkout"
        update-types:
          - "version-update:semver-minor"
          - "version-update:semver-patch"
      # 同様にメジャータグ参照している他アクションも列挙する
      - dependency-name: "<org>/<action>"
        update-types:
          - "version-update:semver-minor"
          - "version-update:semver-patch"
    schedule:
      interval: "weekly"
    groups:
      all-actions:
        patterns:
          - "*"
```

ポイント：

- minor/patch を `ignore` するのは**メジャータグ参照（`@vN`）しているアクションだけ**。`@v7.1.2` やフルSHAで pin しているアクションは、その粒度の更新PRに意味があるので ignore しない。
- フルSHA pin を使う運用では、逆に Dependabot がコメントの追従や SHA 更新PRを出すので、`ignore` ではなく `groups` でまとめる方向で整理する。

## git参照gem を tag pin する（Gemfile）

`dependabot.yml` ではなく **マニフェスト（Gemfile）側**の修正。ブランチ追従の git参照gemは、Dependabot がブランチHEADのコミットSHAを追従して新コミットの度にPRを作る。`ignore` の `version-update:semver-*` は semver が無いのでマッチしない。バージョン風タグに pin すると「新タグが切られた時だけPR」に変わる。

before（ブランチ追従 / 無指定）：

```ruby
gem '<gem-name>', github: '<org>/<repo>', branch: 'main'
gem '<other-gem>', github: '<org>/<repo>'              # branch 無指定はデフォルトブランチ追従
```

after（現在 lock 中の版に対応するタグへ pin）：

```ruby
gem '<gem-name>', github: '<org>/<repo>', tag: '<vX.Y.Z>'
gem '<other-gem>', github: '<org>/<repo>', tag: '<vX.Y.Z>'
```

注意：

- 対象gemが**バージョン風タグを運用している**ことが前提。タグが無ければ pin できない。
- **いま lock 中の版に対応するタグ**に合わせる（pin の目的は固定であって更新ではない）。
- 書き換え後は lock を再生成（`bundle install`）し、参照行が `branch:` → `tag:` に変わりバージョン番号が不変であることを確認する。詳細は SKILL.md の「lock を再生成して反映する」を参照。

## ワークフロー側: Dependabot PR の権限明示 / スキップ

`dependabot.yml` ではなく **GitHub Actions ワークフロー側**の修正。Dependabot PR は `GITHUB_TOKEN` がデフォルト read-only のため、PRへ書き込むジョブが `403 Resource not accessible by integration` で落ちる。背景は SKILL.md の「Dependabot PR で CI が権限不足（403）で失敗する」を参照。

### permissions を明示して動かす

書き込みが必要なジョブに、必要なスコープだけを最小権限で付与する。

```yaml
jobs:
  <job-name>:
    runs-on: ubuntu-latest
    # NOTE: Dependabot PR は GITHUB_TOKEN がデフォルト read-only のため、
    # PR への書き込みに必要な権限を明示する
    permissions:
      contents: read
      pull-requests: write   # PR更新・コメント・レビュー投稿（reviewdog 等）
      # checks: write        # チェック実行が必要なら追加（github-pr-check 等）
      # actions: read        # 他ワークフローの成果物を参照するなら追加（カバレッジ集計の Octocov 等）
    steps:
      - uses: actions/checkout@v7
      # ... 書き込みを行うステップ
```

- 書き込みの種別ごとに必要スコープが違う。コメントアウト分は必要なときだけ有効化する。
- ジョブに `permissions:` を書くと未指定スコープは絞られるので、必要なものを取りこぼさず、かつ付けすぎない。

### actor で重いジョブをスキップする

そもそも Dependabot PR で回したくないジョブ（重いレビューBot等）は、ジョブ／ステップの `if:` で除外する。

```yaml
jobs:
  <heavy-job>:
    # Dependabot のPRではスキップする
    if: github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      # ...
```

`if:` が複合条件のワークフローでは、既存式に `&& github.actor != 'dependabot[bot]'` を足す形で組み込む。
