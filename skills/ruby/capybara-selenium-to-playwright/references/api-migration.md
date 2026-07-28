# Selenium → Playwright API対応と失敗対処

## 目次

- [API対応表](#api対応表)
- [JSエラー検出の置換](#jsエラー検出の置換)
- [ダウンロードテストの置換](#ダウンロードテストの置換)
- [WebAuthn仮想認証器の置換](#webauthn仮想認証器の置換)
- [移行後に遭遇する失敗と対処](#移行後に遭遇する失敗と対処)
- [Capybaraの可視判定とPlaywrightのactionability](#capybaraの可視判定とplaywrightのactionability)

## API対応表

| Selenium | Playwright | 備考 |
| --- | --- | --- |
| `driven_by :selenium, using: :headless_chrome` | `driven_by :customized_playwright`（自前登録） | SKILL.md Step 3 |
| `page.driver.browser.logs.get(:browser)` | `console_messages` + `page_errors` | 下記参照。等価APIは無い |
| `page.driver.browser` | `page.driver.with_playwright_page { \|pw\| ... }` | `driver.browser` は `Capybara::Playwright::Browser` で Selenium とは別物 |
| `Selenium::WebDriver::Error::*` | 対応する例外クラスは無い | 参照している回避策ごと削除する |
| `selenium_download_helper` の `wait_for_downloaded` | 自前ヘルパー | 下記参照 |
| `add_virtual_authenticator` | CDP を直接叩く | 下記参照 |
| `capabilities.add_argument('--headless=new')` | `headless: true`（既定） | Chrome起因の回避策は不要になる |
| `screen_size: [W, H]` | `viewport: { width: W, height: H }` | |
| `page.execute_script` / `evaluate_script` | そのまま使える | ただしクリック前の自動スクロールがあるため不要になる場合が多い |
| `accept_confirm` / `dismiss_confirm` | そのまま使える | **ブロック形式が必須**。下記参照 |
| `attach_file`（複数ファイル配列 / Tempfile） | そのまま使える | Playwright はファイル未存在時に即エラーになる（Seleniumより早く失敗する＝良い） |

## JSエラー検出の置換

Selenium の `logs.get(:browser)` は SEVERE / WARNING レベルのログを返すが、Playwright に等価なAPIは無い。`console_messages`（consoleに出たもの）と `page_errors`（未捕捉例外・未処理Promise rejection）の**両方**を見る必要がある。

`page_errors` を省くと検出漏れになる。Selenium の SEVERE は未捕捉例外も含んでいたため、片方だけでは以前より検出範囲が狭くなる。

```ruby
config.after(:each, type: :system) do |example|
  next if example.metadata[:rack_test]
  next if example.metadata[:skip_js_error]

  page.driver.with_playwright_page do |playwright_page|
    # NOTE: console_messages / page_errors はPlaywrightサーバ側のバッファを取りに行くAPIで、
    #   Seleniumのlogs.get(:browser)と同じくリスナの事前登録が要らない
    console_messages = playwright_page.console_messages
    console_messages.select { |message| message.type == 'warning' }.each do |message|
      warn "WARN: javascript warning in #{example.full_description}"
      warn message.text
    end

    # NOTE: page_errors はconsoleに出ない未捕捉例外・未処理Promise rejectionを拾う。
    #   Seleniumの logs.get(:browser) のSEVEREはこれらも含んでいたため、
    #   両方見ないと検出漏れになる
    errors = console_messages.select { |message| message.type == 'error' }.map(&:text) +
             playwright_page.page_errors.map(&:message)
    expect(errors).to be_empty, "JSエラーが発生しました:\n#{errors.join("\n")}"
  end
end
```

`ConsoleMessage#type` の値は `'log' / 'debug' / 'info' / 'error' / 'warning' / 'trace'` 等。Selenium の `SEVERE` ≒ `'error'`、`WARNING` ≒ `'warning'`。

`after(:each)` は `Capybara.reset_sessions!` より前に走るため、この時点で `page` はまだ生きている。

**独自のJSエラー検出マッチャ（`have_no_js_errors` 等）をgem経由で使っていた場合**: 実装が `page_or_logs.driver.browser.logs.get(:browser)` に依存しているため Playwright では動かない。マッチャの include を外して上記をインライン化する。ただし **そのgem自体は他用途（データ移行系のヘルパー等）で使われている可能性があるので Gemfile から消す前に確認する**。

## ダウンロードテストの置換

`selenium_download_helper` は `page.driver.browser.download_path = ...`（Selenium固有）に依存しており使えない。

一方、**capybara-playwright-driver は `download` イベントを自前でハンドルし、`Capybara.save_path` に `download.suggested_filename` の名前で保存する**（gem の `lib/capybara/playwright/page.rb` 参照）。保存は別スレッドの `download.save_as` で行われる。つまり保存先の指定もダウンロードの受け取りもドライバがやってくれるので、自前ヘルパーの責務は「ファイルが出現し、書き込みが完了するまで待つ」だけになる。

なお `browser_options.rb` に `downloadsPath` はあるが、`page.rb` のハンドラはこれを参照せず常に `Capybara.save_path` に保存するため、**ダウンロード専用ディレクトリへの分離はこのgemではできない**。

```ruby
module DownloadTestHelper
  extend ActiveSupport::Concern

  # NOTE: download.save_as は別スレッドで最終ファイル名に直接書き込むため
  #   （capybara-playwright-driverが一時ファイル経由のリネームを行わない実装のため）、
  #   ファイルが見えた瞬間から書き込み中の可能性があり、0バイトの空ファイルが
  #   通信開始直後の一瞬存在することもある。出力対象データが存在しないCSVエクスポート等では
  #   完了後も0バイトのままなので、0バイトを書き込み途中と決めつけて早期returnはできない。
  #   そのため0バイトかどうかに関わらず、サイズが3回連続で同じことを完了の目安にする
  #   （2回連続だと、通信開始直後の0バイトが0.1秒以上続くケースを誤って完了と判定しうる）
  STABLE_CHECK_COUNT = 3
  STABLE_CHECK_INTERVAL = 0.2

  included do
    # NOTE: Capybara.save_path はスクリーンショットと共用のため、ディレクトリごと消すと
    #   同一プロセスの他exampleが撮ったスクリーンショットを巻き込む。
    #   exampleごとに「事前に存在したファイル」を記録して差分だけを見る方式にする
    before { @files_before_download = existing_download_files }
  end

  def wait_for_downloaded(timeout: 10)
    yield

    downloaded = nil
    Timeout.timeout(timeout) do
      loop do
        downloaded = new_download_files
        break if downloaded.any? && downloaded.all? { |file| download_complete?(file) }

        sleep 0.1
      end
    end

    downloaded.first
  rescue Timeout::Error
    raise "#{timeout}秒以内にダウンロードが完了しませんでした（#{Capybara.save_path} に新規ファイルなし）"
  end

  private

  def existing_download_files
    Pathname.glob(File.join(Capybara.save_path, '*')).to_set
  end

  def new_download_files
    (existing_download_files - @files_before_download).to_a.sort
  end

  def download_complete?(file)
    size = file.size
    (STABLE_CHECK_COUNT - 1).times do
      sleep STABLE_CHECK_INTERVAL
      return false if file.size != size
    end
    true
  rescue Errno::ENOENT
    false
  end
end
```

返り値が `Pathname` なので、`file.extname` / `file.read` を使う既存の呼び出し側はそのまま通る。

`Capybara.save_path` を `rm_rf` しない設計にしているのは、スクリーンショット保存先と共用のため。差分方式なら残留ファイルがあっても誤検知しない。CI の screenshot artifact にダウンロードファイルが混ざるが実害は無い。

## WebAuthn仮想認証器の置換

Playwright には Selenium の `add_virtual_authenticator` 相当が無いため CDP を直接叩く。パラメータは Selenium の `VirtualAuthenticatorOptions` が生成していた JSON と同等にする。

```ruby
page.driver.with_playwright_page do |playwright_page|
  cdp_session = playwright_page.context.new_cdp_session(playwright_page)
  cdp_session.send_message('WebAuthn.enable')
  cdp_session.send_message(
    'WebAuthn.addVirtualAuthenticator',
    params: {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    }
  )
end
```

後片付けは不要（example毎の `reset!` が BrowserContext を破棄し CDP セッションごと消える）。

## 移行後に遭遇する失敗と対処

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| 全 system spec が起動時に失敗 | `playwright_cli_executable_path` が解決できない / npm 側未インストール | `pnpm exec playwright install chromium`。`ls node_modules/.bin/playwright` で確認 |
| 全 system spec が謎の失敗 | gem と npm のバージョンズレ | SKILL.md Step 3 のバージョンチェックで先に落ちるはず。落ちないなら `COMPATIBLE_PLAYWRIGHT_VERSION` を確認 |
| `NameError: uninitialized constant Selenium` | `Selenium::WebDriver::*` の参照が残っている | 回避策ごと削除する（SKILL.md Step 3） |
| クリックがタイムアウト（エラーにならず待ち続ける） | `disabled` 要素をクリックしようとしている | Playwright は actionability を待つのでタイムアウトする。「押せないこと」は `expect(page).to have_button '保存', disabled: true` で検証する |
| クリックが `element intercepts pointer events` で失敗 | 対象要素の上に別の要素が重なっている | 重なっている要素側をクリックする。何が遮っているかは `PWDEBUG=1` で特定するのが速い |
| 「要素が安定しない」でタイムアウト | CSS transition 中で位置が動いている | その操作を `using_wait_time` で囲む |
| `have_content` が非表示要素のテキストに一致しない | `have_content` がブラウザの `innerText` 準拠になり、`display: none` のテキストは対象外 | 表示状態を作ってから検証する。Seleniumより厳密なので、非表示テキストを当てにしたテストは書き換えが必要 |
| `content-visibility: hidden` 配下の要素が操作できない | レンダリングツリーから外れバウンディングボックスが0になる | 開く操作（アコーディオンのトグル等）を足す。Selenium では通っていた場合、実ユーザーには操作できない状態を操作していたということ |
| ナビゲーションを伴う操作がタイムアウト | ジョブの同期実行等でサーバのレスポンスが遅い（`perform_enqueued_jobs` 内など）。Playwright はクリックが起こしたナビゲーション完了まで待つ | その箇所を `using_wait_time(30)` で囲む |
| 確認ダイアログで操作が進まない | `click → accept_confirm` の順で書いている | **ブロック形式にする**。下記参照 |
| `accept_confirm` 漏れが「操作されていない」失敗として出る | Playwright はハンドルしないダイアログを**自動 dismiss** する（Selenium はダイアログが開いたままエラーになる） | 失敗の読み方が変わるので注意。「ダイアログエラー」ではなくアサーション失敗として現れる |

### 確認ダイアログはブロック形式で書く

`data-turbo-confirm`（または `confirm`）付きの操作は、`accept_confirm` / `dismiss_confirm` の**ブロック内でクリックする**。クリックしてから `accept_confirm` を呼ぶ形式は、ダイアログが処理されるまでクリック自体が完了せず、クリックの行でタイムアウトする。

```ruby
# NG: クリックの行でタイムアウトする
click_on 'アーカイブ'
accept_confirm

# OK: ダイアログを開くアクションをブロックに入れる
accept_confirm { click_on 'アーカイブ' }
```

Turbo の `data-turbo-confirm` は既定で `window.confirm`（ネイティブダイアログ）を呼ぶので `accept_confirm` で処理できる。ただし `Turbo.setConfirmMethod` でカスタムダイアログ（`<dialog>` 要素）に差し替えている場合は `accept_confirm` が何も掴まないため、素直な DOM 操作（`within('dialog') { click_button 'OK' }` 等）に書き換える。移行前に `grep -rn 'setConfirmMethod\|confirmMethod' app/` で確認しておく。

## Capybaraの可視判定とPlaywrightのactionability

移行時に最も誤解しやすい点なので、混同しないよう分けて理解する。

**Capybara の `visible?`（要素を「探す」ときの判定）は `opacity: 0` を不可視として扱う。** capybara-playwright-driver の実装（`lib/capybara/playwright/node.rb` の `visible?`）は computed style を祖先方向に遡り、以下のいずれかで `false` を返す:

- `display: none`
- `visibility: hidden`（祖先に `visibility: visible` があれば打ち消される）
- **`parseFloat(style.opacity) == 0`**

つまり `opacity: 0` の要素を探すには `visible: false` オプションが**必須**で、これは Selenium 時代から変わらない。「Playwright だから `visible: false` が不要になる」わけではないので、既存の `visible: false` を安易に外すと要素が見つからなくなる。

**Playwright の actionability（要素を「操作する」ときの判定）は opacity を見ない。** 空でないバウンディングボックスがあり、他の要素に遮られていなければクリックできる。

この2つが食い違うため、`opacity: 0` で実体のあるクリックターゲット（DaisyUI のアコーディオンなど、透明な input をタイトル全面に敷く実装）は「Capybara からは `visible: false` で探し、Playwright は普通にクリックできる」という組み合わせになる。

### 透明な要素をクリックする必要がある場合

CSS クラスや DOM 構造に依存したセレクタ（`.some-component > input[type="checkbox"]`）は、スタイル変更や構造変更で壊れる。**テキストもラベルも持たない要素は `data-test-selector` 属性をビュー側に足して明示する**のが、規約にも沿い壊れにくい。

```erb
<%= check_box_tag('details_toggle', '1', expanded, data: { test_selector: 'details-toggle' }) %>
```

```ruby
find(:data_test, 'details-toggle', visible: false).click
```

「テスト都合でプロダクションコードを触る」トレードオフはあるが、属性1つの追加で済み、多くのプロジェクトのテスト規約が `data-test-selector` を第3の選択肢として明示的に認めている。プロジェクトの規約を確認してから判断する。
