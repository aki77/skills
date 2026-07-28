---
name: capybara-selenium-to-playwright
description: Rails + RSpec + Capybara の system spec を Selenium から Playwright ドライバへ移行する手順
license: MIT
disable-model-invocation: true
---

# Capybara: Selenium → Playwright ドライバ移行

## このスキルの前提と使い方

対象は **Rails + RSpec + Capybara で system spec を書いているプロジェクト**。移行の勘所は「ドライバを差し替える」ことよりも、**Selenium固有APIに依存した周辺コードの置換**と**gem/npm のバージョン結合**にある。ここを外すと、原因の分かりにくい失敗が全 system spec で起きる。

作業は次の順で進める。**Step 1 と 2 を先にやること**が重要で、依存が入っていないと以降の検証が一切できず、バージョンがズレていると全 spec が意味不明に落ちて原因調査に時間を取られる。

1. 現状調査（Selenium への依存箇所を洗い出す）
2. 依存の差し替えとバージョン固定
3. ドライバ登録とフックの書き換え
4. Selenium固有APIの置換
5. CI設定
6. 段階的に spec を実行して直す

Selenium API と Playwright の対応表、および移行後に遭遇しやすい失敗の対処は
`references/api-migration.md` に切り出してある。Step 4 と Step 6 で参照する。

## Step 1: 現状調査

移行のブラスト半径を先に確定させる。`spec/support/` に閉じているのか、spec 本体まで散っているのかで作業量が大きく変わる。

```bash
# ドライバ設定とSelenium固有API
grep -rn 'driven_by\|page\.driver\|Selenium::\|logs\.get' spec/
# Selenium依存のgem
grep -nE 'selenium|capybara' Gemfile Gemfile.lock
# 移行で挙動が変わりやすい箇所
grep -rn 'accept_confirm\|dismiss_confirm\|attach_file\|execute_script\|visible: false\|within_window\|using_session' spec/
# 待ち時間の現状設定
grep -rn 'default_max_wait_time\|using_wait_time' spec/
```

確認すべきこと:

- **`page.driver` を触っている spec が何件あるか**。0件なら support 配下だけで移行が完結する可能性が高い
- **`have_no_js_errors` 等、独自のJSエラー検出マッチャの出所**。gem由来のマッチャなら実装が `logs.get(:browser)`（Selenium専用）に依存している可能性があり使えなくなる。そのgemが他用途でも使われていないか確認してから Gemfile を触る
- **ダウンロードテストの有無**。`selenium_download_helper` は Selenium 固有APIに依存しており置換が必要
- **`Capybara.default_max_wait_time` の現在値**。未設定ならデフォルト（Capybara 3系は2秒）

## Step 2: 依存の差し替えとバージョン固定

ここが移行で最も事故りやすい。**`playwright-ruby-client` gem と npm の `playwright` はバージョン完全一致が必須**で、ズレると全 system spec が意味不明な失敗をする。

```ruby
# Gemfile
group :test do
  gem 'capybara'
  gem 'capybara-playwright-driver'
  # NOTE: capybara-playwright-driver 経由でも入るが、npm の playwright とバージョンを
  #   揃える必要があるgemなので、追従対象であることが見えるよう明示的に書く
  gem 'playwright-ruby-client'
end
```

`selenium-webdriver` と `selenium_download_helper` を削除する。ただし **Step 4 で `Selenium::WebDriver` への参照を消してからでないと NameError で全 spec が落ちる**。

npm 側に入れるバージョンは**最新版ではなく gem が要求する値**を使う。gem 1.61.0 が要求するのは npm 1.61.1 のように、gem とnpm でバージョンが一致しないことがあるため、必ず gem 側から引く:

```bash
bundle install
bundle exec ruby -e "require 'playwright'; puts Playwright::COMPATIBLE_PLAYWRIGHT_VERSION"
```

出た値を `package.json` の devDependencies に**キャレット無しで厳密固定**する。`^1.61.1` にすると次の `install` が 1.62.0 を取ってきて壊れる。

```json
"playwright": "1.61.1"
```

```bash
pnpm install   # または npm/yarn
pnpm exec playwright install chromium   # ローカルは --with-deps 不要
ls node_modules/.bin/playwright         # ドライバ設定がこのパスを指すので存在確認
```

### Dependabot / Renovate を使っている場合は必ず除外する

依存更新ツールを入れているなら、**`playwright` を自動更新の対象外にする**。npm の minor/patch をグループで一括更新する設定だと、`playwright` の minor 更新がグループPRに混ざり、gem 側とズレて全 system spec が壊れる。しかもグループPRなので「playwright だけ落とす」対処がしづらく、無関係なパッケージの更新までブロックされる。

```yaml
# .github/dependabot.yml の npm セクション
    ignore:
      # NOTE: playwright は gem の playwright-ruby-client が要求するバージョン
      #   （Playwright::COMPATIBLE_PLAYWRIGHT_VERSION）と完全一致が必須。
      #   単体で上げると全system specが壊れるため自動更新の対象外にし、
      #   gem更新時に手動で揃える
      - dependency-name: "playwright"
```

`update-types` を書かないことで全更新を無視する。これがないと「bundler が gem を上げたPR」と「npm が playwright を上げたPR」が別々に来て、どちらも単独では CI が落ちる詰みが起きる。

## Step 3: ドライバ登録とフックの書き換え

`Capybara.register_driver` で自前登録する。Rails 8.1 は `driven_by :playwright` を標準サポートするが、trace のコールバック（`on_save_trace`）を登録する隙間がないため、trace を使うなら自前登録が必要。

**trace は入れることを勧める**（下記コードに含めてある）。移行直後は「なぜ落ちたのか分からない」失敗が必ず出るが、CI で得られるのがスクリーンショット1枚だけだと調査が詰む。trace には DOM スナップショットとアクションのタイムラインが入るので、失敗時点の DOM を辿れる。失敗時のみ保存する実装なので成功時のコストは trace 収集分にとどまる。**trace を入れるなら Step 5 の artifact アップロードも必要**（保存しても CI から回収できないと意味がない）。入れない判断をするなら `on_save_trace` ブロックごと省き、Step 5 の artifact も省く。

```ruby
# NOTE: playwright-ruby-client と npm の playwright はバージョン完全一致が必須。
#   ズレると全system specが意味不明な失敗をするため、早い段階で明示的に落とす。
expected_playwright_version = Playwright::COMPATIBLE_PLAYWRIGHT_VERSION.strip
actual_playwright_version = JSON.parse(Rails.root.join('package.json').read).dig('devDependencies', 'playwright')
if expected_playwright_version != actual_playwright_version
  raise "playwrightのバージョン不一致: package.json=#{actual_playwright_version} " \
        "gem要求=#{expected_playwright_version}。package.jsonのplaywrightを更新してください。"
end

Capybara.register_driver :customized_playwright do |app|
  driver = Capybara::Playwright::Driver.new(
    app,
    browser_type: :chromium,
    # NOTE: 既定は 'npx playwright' でpnpm環境では解決できないため node_modules 直下を指す
    playwright_cli_executable_path: Rails.root.join('node_modules/.bin/playwright').to_s,
    # NOTE: CHROME=1 でブラウザを表示して実行できる（デバッグ用）
    headless: !ENV['CHROME'],
    viewport: { width: 1400, height: 1400 },
    # NOTE: 秒で渡すとgem内部でms化される。要素待ちをCapybara側と揃えることで、
    #   Playwright内部の待ちがCapybaraの待ち時間を食い潰す構図を避ける
    default_timeout: Capybara.default_max_wait_time,
    # NOTE: ページ遷移だけは要素待ちと別枠で長めに取る。アセットビルドのキャッシュが無い
    #   初回アクセスは数秒かかるため
    default_navigation_timeout: 30
  )

  # NOTE: on_save_traceの登録自体がtracingの有効化トリガーで、BrowserContext生成時に
  #   自動でtracing.startが走る。手動のstart_tracingは不要。
  #   保存しないzipはgemのtmpdir（finalizer付き）ごと消えるので自前の削除も要らない
  driver.on_save_trace do |zip_path|
    next unless RSpec.current_example&.exception

    # NOTE: gemの採番名（SecureRandom.hex(8)）のままだとどれがどのテストか分からないため、
    #   example名からファイル名を作る。日本語を残したいのでファイル名に使えない文字だけ置換する
    #   （parameterizeは日本語を全て落としてしまう）
    name = RSpec.current_example.full_description.gsub(%r{[/\\:*?"<>|\s]+}, '_')
    trace_dir = Rails.root.join('tmp/playwright_traces')
    FileUtils.mkdir_p(trace_dir)
    FileUtils.mv(zip_path, trace_dir.join("#{name.byteslice(0...200).scrub('')}.zip"))
  end

  driver
end

RSpec.configure do |config|
  config.before(:each, type: :system) do |example|
    if example.metadata[:rack_test]
      driven_by :rack_test
    else
      driven_by :customized_playwright
    end
  end
end
```

バージョンチェックをこのファイルの冒頭に置くのは、`spec/support/**/*.rb` が `rails_helper` で全 require されるため、**system spec に到達する前（model spec だけ流しても）に落ちる**から。Dependabot 除外の抜け漏れを拾う二重の保険になる。

### 削除できるもの

移行に伴って以下が不要になる。消し忘れると Selenium gem を外せない:

- `driven_by :selenium, using: :headless_chrome` と Chrome capabilities（`--headless=new`、`--window-size` 等）
- `Selenium::WebDriver::Error::*` を参照するワークアラウンド（Capybara issue #2800 の `invalid_element_errors` 対応など）
- `around` フックでの `Capybara.session_name` 保存/復元。**`within_window` / `using_session` を使っていないなら不要**（example中に `session_name` が書き換わる経路がない）。grep で0件を確認してから消す

### 待ち時間の扱い

Playwright の actionability チェック（可視→有効→位置安定→イベント受信可能を順に待つ）は Selenium より各操作で待つ時間が長い。Capybara デフォルトの2秒だと余裕がないため、5秒程度への引き上げを検討する。

ただし**プロジェクトのテスト規約で「`Capybara.default_max_wait_time` をグローバルに上げるな、`using_wait_time` で個別対応せよ」と決めている場合がある**（失敗時に全 example で待たされ CI が遅くなるため）。規約を確認し、抵触するなら引き上げの是非をユーザーに確認する。個別に長く待つ必要がある箇所は `using_wait_time` を使う。

## Step 4: Selenium固有APIの置換

`references/api-migration.md` の対応表に従って置換する。特に対応が必要なのは:

- **JSエラー検出**（`logs.get(:browser)`）→ `console_messages` + `page_errors`
- **ダウンロード**（`selenium_download_helper`）→ ドライバが `Capybara.save_path` に自動保存する挙動を利用した自前ヘルパー
- **WebAuthn の仮想認証器**（`add_virtual_authenticator`）→ CDP を直接叩く

## Step 5: CI設定

chromedriver / Chrome の明示セットアップを削除し、playwright のブラウザインストールとキャッシュを追加する。Selenium 時代に「chromium 用」として入れていた apt パッケージ（`libgbm1` 等）は `playwright install --with-deps` が面倒を見るので削除できる。**画像処理用の `libvips` など無関係なパッケージを巻き込んで消さないよう注意。**

```yaml
# pnpm install / npm install の直後に置く（node_modules/.bin/playwright を要求するため）
- name: Get playwright version
  id: playwright-version
  shell: bash
  run: echo "version=$(node -p "require('./package.json').devDependencies.playwright")" >> "$GITHUB_OUTPUT"

- name: Cache Playwright browsers
  id: playwright-cache
  uses: actions/cache@<SHA>  # SHA pin する場合は gh api repos/actions/cache/commits/<tag> --jq '.sha' で解決
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright-version.outputs.version }}

# NOTE: キャッシュが復元するのはブラウザ本体だけでaptの共有ライブラリは戻らないため、
#   ヒット時もinstall-depsだけは流す（--with-depsを丸ごと流すと再ダウンロードになる）
- name: Install Playwright browser
  shell: bash
  run: |
    if [ "${{ steps.playwright-cache.outputs.cache-hit }}" = "true" ]; then
      pnpm exec playwright install-deps chromium
    else
      pnpm exec playwright install --with-deps chromium
    fi
```

`package.json` の playwright を厳密固定してあるので、バージョン文字列をそのままキャッシュキーに使える。

Step 3 で `on_save_trace` を入れたなら、**artifact のアップロードも必ず追加する**（保存した trace を CI から回収できないと入れた意味がない）。`if-no-files-found: ignore` が必須で、これがないと全部緑のとき（trace が0件）に毎回警告が出る:

```yaml
- name: Archive Playwright trace artifacts
  uses: actions/upload-artifact@<SHA>
  with:
    name: playwright-trace
    path: tmp/playwright_traces
    if-no-files-found: ignore
  if: always()
```

## Step 6: 段階的に spec を実行して直す

全部まとめて流すと原因の切り分けが難しくなる。**リスクの高いものから順に当てる**。

```bash
# 1. support の require とバージョンチェックの確認（system spec を流さずに済む）
bin/rspec spec/models

# 2. 最小の system spec 1本で足場を確認（ブラウザ起動・driven_by・JSエラー検出フック）
bin/rspec spec/system/<軽いファイル>.rb -e '<1つのexample>'

# 3. Step 1 の調査で洗い出したリスク箇所を個別に
#    （visible: false を使う箇所 / ダウンロード / accept_confirm / attach_file / 重いジョブ）

# 4. 全 system spec → 全 spec
bin/rspec spec/system
bin/rspec
```

失敗したら `references/api-migration.md` の「移行後に遭遇する失敗と対処」を参照する。

### デバッグ手段

```bash
CHROME=1 bin/rspec spec/system/... -e '...'            # ブラウザを表示
PWDEBUG=1 CHROME=1 bin/rspec spec/system/... -e '...'  # Playwright Inspector でステップ実行
pnpm exec playwright show-trace tmp/playwright_traces/<file>.zip
```

`PWDEBUG=1` は actionability タイムアウトの原因（どの要素がクリックを遮っているか）の特定に最も速い。trace は https://trace.playwright.dev にドラッグ&ドロップでも開ける。

## 落ちたテストへの向き合い方

Playwright は Selenium より厳密なので、**移行で初めて落ちるテストは「Playwright が実ユーザー体験との乖離を炙り出した」ケースが多い**。テストを緩める方向で通すと、移行の価値を捨てることになる。

- **JSエラーが新規に検出された** → `page_errors` は Selenium が拾えていなかった未捕捉例外・Promise rejection を含む。まずアプリ側の実バグを疑う。`skip_js_error` で逃げるのは、テスト都合と確認できてからにする
- **非表示要素の操作でタイムアウト** → 実ユーザーには操作できない要素を操作していた可能性。開く操作を足すのが正しい対処
- **待ち時間不足** → グローバル値を上げる前に、その操作が本当に遅いのか（重いジョブの同期実行など）を確認し、`using_wait_time` で個別対応する

「なぜ Selenium では通っていたのか」を理解してから直すこと。分からないまま `sleep` や `skip` を足すと、移行後に別の形で問題が再発する。
