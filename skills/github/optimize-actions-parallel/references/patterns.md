# 並列化パターン集（before/after）

SKILL.md の「並列化パターンを選ぶ」で判断がついたあと、書き換えの具体イメージを掴むための例集。
プロジェクト固有の情報は含めず、パターンとして一般化してある。

## パターン1: 直列の待ちステップを並列化して完了時間を縮める

**状況**: 複数のデプロイ/ロールアウト先が互いに独立しているのに、直列に並んでいる。各ステップは
「安定するまで待つ」系のオプション（`wait-for-*: true` など）を持ち、CPU 負荷は低いが待ち時間が長い。

```yaml
# before（直列。片方の待ちが終わってからもう片方が始まる）
steps:
  - name: Deploy service A
    uses: some/deploy-action@v2
    with:
      wait-for-stability: true

  - name: Deploy service B
    uses: some/deploy-action@v2
    with:
      wait-for-stability: true
```

```yaml
# after（並列。待ち時間が重なるので、長い方の待ちにしか律速されない）
steps:
  - parallel:
      - name: Deploy service A
        uses: some/deploy-action@v2
        with:
          wait-for-stability: true

      - name: Deploy service B
        uses: some/deploy-action@v2
        with:
          wait-for-stability: true
```

**効く理由**: 各ステップの大半が「待ち」であり、CPU をほぼ使わない。並列にしても奪い合いが
起きず、合計時間は「長い方の待ち」に近づく。**効かない条件**: どちらかのデプロイがもう一方の
前提（DBマイグレーション等）に依存している場合は並列化できない。依存関係を必ず確認する。

## パターン2: 別ワークフロー/別jobの軽い独立チェックを1つに統合する

**状況**: 静的解析やLintなど、性質は違うが軽量な独立チェックが、別々のワークフロー（または別job）
として存在し、それぞれで `checkout` → 言語/ランタイムのセットアップ → 依存関係インストールを
繰り返している。

```yaml
# before: check-a.yml と check-b.yml に分かれていて、セットアップが重複
# check-a.yml
jobs:
  check-a:
    steps:
      - uses: actions/checkout@v7
      - uses: some/setup-action@v1
        with:
          cache: true
      - run: run-check-a

# check-b.yml
jobs:
  check-b:
    steps:
      - uses: actions/checkout@v7
      - uses: some/setup-action@v1
        with:
          cache: true
      - run: run-check-b
```

```yaml
# after: 1つのjobに統合し、セットアップは1回だけ
jobs:
  checks:
    steps:
      - uses: actions/checkout@v7
      - uses: some/setup-action@v1
        with:
          cache: true

      - parallel:
          - name: Run check A
            run: run-check-a
          - name: Run check B
            run: run-check-b
```

**効く理由**: セットアップ（checkout・環境構築・依存関係インストール）が1回で済み、ランナーの
合計消費時間（コスト）が下がる。**注意**: 完了までの時間はもともと別ランナーで並走していた分
大きくは縮まらない。`parallel:` ブロック全体の所要時間は、含めたチェックのうち一番長いものに
律速される。効果を「時間短縮」だと期待しすぎないこと。

## パターン3（罠）: 重い処理を混ぜると逆に遅くなる

**状況**: CPU/メモリを大きく使う重い処理（フルテストスイート、大規模ビルド等）まで、軽い
チェックと一緒の `parallel:` ブロックに詰め込んでしまった。

```yaml
# 悪い例: 重いテストと軽いチェックを同じランナー・同じparallel:ブロックに混在
steps:
  - parallel:
      - name: Run full test suite   # 重い。CPU/メモリを大きく使う
        run: run-tests
      - name: Run lint               # 軽い
        run: run-lint
      - name: Run formatter check    # 軽い
        run: run-formatter
      - name: Run type check         # 軽い
        run: run-typecheck
```

小さいランナー（1〜2 CPU）にこの4つを同時に走らせると、CPUを奪い合って全員が単独実行時より
遅くなる。特に一番重い処理（ここではテスト）の膨らみ方が大きく、他が先に終わってもテストの
完了までjob全体が待たされるため、合計の完了時間が「セットアップ統合前」より伸びることがある。

```yaml
# 改善: 重い処理は別jobに残し、軽い独立チェックだけをparallel:でまとめる
jobs:
  checks:
    steps:
      - uses: actions/checkout@v7
      - uses: some/setup-action@v1

      - parallel:
          - name: Run lint
            run: run-lint
          - name: Run formatter check
            run: run-formatter
          - name: Run type check
            run: run-typecheck

  test:
    steps:
      - uses: actions/checkout@v7
      - uses: some/setup-action@v1
      - name: Run full test suite
        run: run-tests
```

**教訓**: 「独立している」だけでは同じ `parallel:` ブロックに入れていい理由にならない。
「軽くて独立している」が条件。重い処理は別ランナー（別job）に出し、CPU/メモリの奪い合いを避ける。
結果として、元々別jobで並走していたときと完了時間はほぼ変わらないまま、セットアップの重複だけを
削減できる。

## 参考: 公式ドキュメント

構文の詳細仕様（`parallel:` / `background:` / `wait:` / `wait-all:` / `cancel:` の受け取る値や制約、
matrix・条件式との組み合わせなど）を確認したいときは、公式のワークフロー構文リファレンスを参照する。

- ワークフロー構文: https://docs.github.com/ja/actions/reference/workflows-and-actions/workflow-syntax
- GA アナウンス（2026-06-25）: https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/
